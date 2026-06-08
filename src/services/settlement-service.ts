import { assertEnabledToken, type SupportedNetworks } from "../config/networks.js";
import type { Repository } from "../repositories/repository.js";
import type { Encryptor } from "../security/encryption.js";
import type { GasTopUp, NetworkSlug, Sweep, TokenTransfer } from "../types/domain.js";
import { formatTokenAmount } from "../utils/amount.js";
import { newId } from "../utils/id.js";
import type { ChainProvider } from "../worker/chain-provider.js";
import type { WebhookService } from "./webhook-service.js";

export interface SettlementServiceDependencies {
  repo: Repository;
  networks: SupportedNetworks;
  encryptor: Encryptor;
  chainProvider: ChainProvider;
  webhooks: WebhookService;
}

export interface EnsureSettlementOptions {
  forceRetry?: boolean;
}

export class SettlementService {
  constructor(private readonly deps: SettlementServiceDependencies) {}

  async ensureSettlement(transfer: TokenTransfer, options: EnsureSettlementOptions = {}): Promise<void> {
    const { network, token } = assertEnabledToken(this.deps.networks, transfer.network, transfer.token);
    const depositAddress = await this.deps.repo.getDepositAddressForMerchant(transfer.merchantId, transfer.depositAddressId);
    if (!depositAddress) {
      return;
    }

    const latestSweep = await this.deps.repo.getLatestSweepByTransfer(transfer.id);
    if (latestSweep?.status === "confirmed") {
      await this.markSettlement(transfer.id, "settled", null, null);
      return;
    }
    if (latestSweep?.status === "submitted") {
      await this.markSettlement(transfer.id, "submitted", "sweep", null);
      return;
    }
    if (latestSweep?.status === "failed" && !options.forceRetry) {
      await this.markSettlement(transfer.id, "pending", "sweep", latestSweep.failureReason);
      return;
    }

    const nativeBalance = await this.deps.chainProvider.getNativeBalance(network, depositAddress.address);
    if (nativeBalance < network.minGasWei) {
      const latestTopUp = await this.deps.repo.getLatestGasTopUpByTransfer(transfer.id);
      if (latestTopUp?.status === "submitted") {
        await this.markSettlement(transfer.id, "submitted", "gas_top_up", null);
        return;
      }
      if (latestTopUp?.status === "failed" && !options.forceRetry) {
        await this.markSettlement(transfer.id, "pending", "gas_top_up", latestTopUp.failureReason);
        return;
      }

      await this.submitGasTopUp(transfer, depositAddress.address, latestTopUp?.attemptNumber ?? 0);
      return;
    }

    await this.submitSweep(transfer, latestSweep?.attemptNumber ?? 0);
    void token;
  }

  async confirmGasTopUps(): Promise<void> {
    const submitted = await this.deps.repo.listSubmittedGasTopUps(100);

    for (const topUp of submitted) {
      if (!topUp.txHash) {
        continue;
      }

      const network = this.deps.networks[topUp.network];
      if (!network) {
        continue;
      }

      const receipt = await this.deps.chainProvider.getTransactionReceipt(network, topUp.txHash);
      if (!receipt) {
        continue;
      }

      if (receipt.status === "success") {
        const confirmed = await this.deps.repo.updateGasTopUpStatus(topUp.id, "confirmed", topUp.txHash);
        if (confirmed) {
          await this.deps.webhooks.enqueueMerchantEvent(confirmed.merchantId, "gas.topup.confirmed", {
            gasTopUp: publicGasTopUp(confirmed)
          }, { depositAddressId: confirmed.depositAddressId });

          const transfer = await this.deps.repo.getTokenTransfer(confirmed.transferId);
          if (transfer) {
            await this.ensureSettlement(transfer);
          }
        }
      } else {
        await this.failGasTopUp(topUp, "Gas top-up transaction reverted");
      }
    }
  }

  async confirmSweeps(): Promise<void> {
    const submitted = await this.deps.repo.listSubmittedSweeps(100);

    for (const sweep of submitted) {
      if (!sweep.txHash) {
        continue;
      }

      const network = this.deps.networks[sweep.network];
      if (!network) {
        continue;
      }

      const receipt = await this.deps.chainProvider.getTransactionReceipt(network, sweep.txHash);
      if (!receipt) {
        continue;
      }

      if (receipt.status === "success") {
        const confirmed = await this.deps.repo.updateSweepStatus(sweep.id, "confirmed", sweep.txHash);
        if (confirmed) {
          await this.deps.webhooks.enqueueMerchantEvent(confirmed.merchantId, "sweep.confirmed", {
            sweep: publicSweep(confirmed)
          }, { depositAddressId: confirmed.depositAddressId });
          await this.markSettlement(confirmed.transferId, "settled", null, null);
        }
      } else {
        await this.failSweep(sweep, "Sweep transaction reverted");
      }
    }
  }

  private async submitGasTopUp(transfer: TokenTransfer, depositAddress: string, latestAttemptNumber: number): Promise<void> {
    const { network } = assertEnabledToken(this.deps.networks, transfer.network, transfer.token);
    const attemptNumber = latestAttemptNumber + 1;
    const gasWalletPrivateKey = await this.getGasWalletPrivateKey(network.slug, network.gasWalletPrivateKey);

    if (!gasWalletPrivateKey) {
      const gasTopUp = await this.deps.repo.createGasTopUp({
        id: newId(),
        transferId: transfer.id,
        merchantId: transfer.merchantId,
        depositAddressId: transfer.depositAddressId,
        network: transfer.network,
        txHash: null,
        amountWei: network.gasTopUpWei.toString(10),
        attemptNumber,
        status: "failed",
        failureReason: "Gas wallet private key is not configured"
      });
      await this.markSettlement(transfer.id, "pending", "gas_top_up", gasTopUp.failureReason);
      await this.deps.webhooks.enqueueMerchantEvent(transfer.merchantId, "gas.topup.failed", {
        gasTopUp: publicGasTopUp(gasTopUp)
      }, { depositAddressId: transfer.depositAddressId });
      return;
    }

    try {
      const txHash = await this.deps.chainProvider.sendNativeTransfer(
        network,
        gasWalletPrivateKey,
        depositAddress,
        network.gasTopUpWei
      );
      const gasTopUp = await this.deps.repo.createGasTopUp({
        id: newId(),
        transferId: transfer.id,
        merchantId: transfer.merchantId,
        depositAddressId: transfer.depositAddressId,
        network: transfer.network,
        txHash,
        amountWei: network.gasTopUpWei.toString(10),
        attemptNumber,
        status: "submitted"
      });

      await this.markSettlement(transfer.id, "submitted", "gas_top_up", null);
      await this.deps.webhooks.enqueueMerchantEvent(transfer.merchantId, "gas.topup.submitted", {
        gasTopUp: publicGasTopUp(gasTopUp)
      }, { depositAddressId: transfer.depositAddressId });
    } catch (error) {
      const gasTopUp = await this.deps.repo.createGasTopUp({
        id: newId(),
        transferId: transfer.id,
        merchantId: transfer.merchantId,
        depositAddressId: transfer.depositAddressId,
        network: transfer.network,
        txHash: null,
        amountWei: network.gasTopUpWei.toString(10),
        attemptNumber,
        status: "failed",
        failureReason: error instanceof Error ? error.message : "Gas top-up failed"
      });
      await this.markSettlement(transfer.id, "pending", "gas_top_up", gasTopUp.failureReason);
      await this.deps.webhooks.enqueueMerchantEvent(transfer.merchantId, "gas.topup.failed", {
        gasTopUp: publicGasTopUp(gasTopUp)
      }, { depositAddressId: transfer.depositAddressId });
    }
  }

  private async submitSweep(transfer: TokenTransfer, latestAttemptNumber: number): Promise<void> {
    const { network, token } = assertEnabledToken(this.deps.networks, transfer.network, transfer.token);
    const depositAddress = await this.deps.repo.getDepositAddressForMerchant(transfer.merchantId, transfer.depositAddressId);
    if (!depositAddress) {
      return;
    }

    const treasury = depositAddress.treasuryWalletId
      ? await this.deps.repo.getTreasuryWalletById(transfer.merchantId, depositAddress.treasuryWalletId)
      : await this.deps.repo.getTreasuryWallet(transfer.merchantId, transfer.network, transfer.token);
    if (!treasury || treasury.network !== transfer.network || treasury.token !== transfer.token) {
      await this.markSettlement(transfer.id, "pending", "sweep", "Treasury wallet is not configured");
      return;
    }

    const privateKey = this.deps.encryptor.decryptString(depositAddress.privateKeyEncrypted);
    const balance = await this.deps.chainProvider.getTokenBalance(network, token, depositAddress.address);
    if (balance === 0n) {
      return;
    }

    const attemptNumber = latestAttemptNumber + 1;
    try {
      const txHash = await this.deps.chainProvider.sendTokenTransfer(network, token, privateKey, treasury.address, balance);
      const sweep = await this.deps.repo.createSweep({
        id: newId(),
        transferId: transfer.id,
        merchantId: transfer.merchantId,
        depositAddressId: transfer.depositAddressId,
        network: transfer.network,
        token: transfer.token,
        txHash,
        amountRaw: balance.toString(10),
        amountFormatted: formatTokenAmount(balance, token.decimals),
        toAddress: treasury.address,
        attemptNumber,
        status: "submitted"
      });

      await this.markSettlement(transfer.id, "submitted", "sweep", null);
      await this.deps.webhooks.enqueueMerchantEvent(transfer.merchantId, "sweep.submitted", {
        sweep: publicSweep(sweep)
      }, { depositAddressId: transfer.depositAddressId });
    } catch (error) {
      const sweep = await this.deps.repo.createSweep({
        id: newId(),
        transferId: transfer.id,
        merchantId: transfer.merchantId,
        depositAddressId: transfer.depositAddressId,
        network: transfer.network,
        token: transfer.token,
        txHash: null,
        amountRaw: balance.toString(10),
        amountFormatted: formatTokenAmount(balance, token.decimals),
        toAddress: treasury.address,
        attemptNumber,
        status: "failed",
        failureReason: error instanceof Error ? error.message : "Sweep failed"
      });
      await this.markSettlement(transfer.id, "pending", "sweep", sweep.failureReason);
      await this.deps.webhooks.enqueueMerchantEvent(transfer.merchantId, "sweep.failed", {
        sweep: publicSweep(sweep)
      }, { depositAddressId: transfer.depositAddressId });
    }
  }

  private async getGasWalletPrivateKey(network: NetworkSlug, envPrivateKey: string | undefined): Promise<string | undefined> {
    if (envPrivateKey) {
      return envPrivateKey;
    }

    const wallet = await this.deps.repo.getOperationalGasWallet(network);
    if (!wallet) {
      return undefined;
    }

    return this.deps.encryptor.decryptString(wallet.privateKeyEncrypted);
  }

  private async failGasTopUp(topUp: GasTopUp, reason: string): Promise<void> {
    const failed = await this.deps.repo.updateGasTopUpStatus(topUp.id, "failed", topUp.txHash, reason);
    if (failed) {
      await this.markSettlement(failed.transferId, "pending", "gas_top_up", reason);
      await this.deps.webhooks.enqueueMerchantEvent(failed.merchantId, "gas.topup.failed", {
        gasTopUp: publicGasTopUp(failed)
      }, { depositAddressId: failed.depositAddressId });
    }
  }

  private async failSweep(sweep: Sweep, reason: string): Promise<void> {
    const failed = await this.deps.repo.updateSweepStatus(sweep.id, "failed", sweep.txHash, reason);
    if (failed) {
      await this.markSettlement(failed.transferId, "pending", "sweep", reason);
      await this.deps.webhooks.enqueueMerchantEvent(failed.merchantId, "sweep.failed", {
        sweep: publicSweep(failed)
      }, { depositAddressId: failed.depositAddressId });
    }
  }

  private async markSettlement(
    transferId: string,
    settlementStatus: "pending" | "submitted" | "settled",
    settlementStep: "gas_top_up" | "sweep" | null,
    settlementFailureReason: string | null
  ): Promise<void> {
    await this.deps.repo.updateTransferSettlement(transferId, {
      settlementStatus,
      settlementStep,
      settlementFailureReason
    });
  }
}

export function publicGasTopUp(gasTopUp: GasTopUp) {
  return {
    id: gasTopUp.id,
    transferId: gasTopUp.transferId,
    network: gasTopUp.network,
    txHash: gasTopUp.txHash,
    amountWei: gasTopUp.amountWei,
    attemptNumber: gasTopUp.attemptNumber,
    status: gasTopUp.status,
    failureReason: gasTopUp.failureReason,
    createdAt: gasTopUp.createdAt.toISOString(),
    confirmedAt: gasTopUp.confirmedAt?.toISOString() ?? null
  };
}

export function publicSweep(sweep: Sweep) {
  return {
    id: sweep.id,
    transferId: sweep.transferId,
    network: sweep.network,
    token: sweep.token,
    txHash: sweep.txHash,
    amountRaw: sweep.amountRaw,
    amountFormatted: sweep.amountFormatted,
    toAddress: sweep.toAddress,
    attemptNumber: sweep.attemptNumber,
    status: sweep.status,
    failureReason: sweep.failureReason,
    createdAt: sweep.createdAt.toISOString(),
    confirmedAt: sweep.confirmedAt?.toISOString() ?? null
  };
}
