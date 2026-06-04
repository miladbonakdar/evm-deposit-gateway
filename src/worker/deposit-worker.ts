import { assertEnabledToken, enabledNetworks, enabledTokens, type SupportedNetworks } from "../config/networks.js";
import type { Encryptor } from "../security/encryption.js";
import { formatTokenAmount } from "../utils/amount.js";
import { normalizeAddress } from "../utils/address.js";
import { newId } from "../utils/id.js";
import type { Repository } from "../repositories/repository.js";
import type { WebhookService } from "../services/webhook-service.js";
import { publicDepositAddress, publicTransfer } from "../services/deposit-service.js";
import type { GasTopUp, NetworkSlug, Sweep, TokenSymbol, TokenTransfer } from "../types/domain.js";
import type { ChainProvider } from "./chain-provider.js";

export interface DepositWorkerDependencies {
  repo: Repository;
  networks: SupportedNetworks;
  encryptor: Encryptor;
  chainProvider: ChainProvider;
  webhooks: WebhookService;
}

export class DepositWorker {
  constructor(private readonly deps: DepositWorkerDependencies) {}

  async runOnce(): Promise<void> {
    await this.expireDepositAddresses();
    await this.scanEnabledAssets();
    await this.confirmPendingTransfers();
    await this.confirmGasTopUps();
    await this.confirmSweeps();
    await this.confirmWalletTransactions();
  }

  private async expireDepositAddresses(): Promise<void> {
    const expired = await this.deps.repo.expireDepositAddresses(new Date());

    for (const depositAddress of expired) {
      await this.deps.webhooks.enqueueMerchantEvent(depositAddress.merchantId, "wallet.expired", {
        depositAddress: publicDepositAddress(depositAddress)
      });
    }
  }

  private async scanEnabledAssets(): Promise<void> {
    for (const networkConfig of enabledNetworks(this.deps.networks)) {
      for (const tokenConfig of enabledTokens(networkConfig)) {
        const latestBlock = await this.deps.chainProvider.getLatestBlockNumber(networkConfig);
        const confirmedHead = latestBlock - BigInt(networkConfig.confirmations);
        const cursor = await this.deps.repo.getChainCursor(networkConfig.slug, tokenConfig.symbol);
        const fromBlock = cursor ? cursor.lastScannedBlock + 1n : networkConfig.scanFromBlock;
        const toBlock = minBigInt(confirmedHead, fromBlock + networkConfig.maxScanBlocks - 1n);

        if (toBlock < fromBlock) {
          continue;
        }

        const logs = await this.deps.chainProvider.getTransferLogs(networkConfig, tokenConfig, fromBlock, toBlock);

        for (const log of logs) {
          const depositAddress = await this.deps.repo.getDepositAddressByAddress(
            networkConfig.slug,
            tokenConfig.symbol,
            normalizeAddress(networkConfig, log.to)
          );

          if (!depositAddress) {
            continue;
          }

          const isLate = depositAddress.expiresAt < new Date();
          const { transfer, created } = await this.deps.repo.createTokenTransferIfNotExists({
            id: newId(),
            merchantId: depositAddress.merchantId,
            depositAddressId: depositAddress.id,
            network: networkConfig.slug,
            token: tokenConfig.symbol,
            txHash: log.txHash,
            logIndex: log.logIndex,
            fromAddress: normalizeAddress(networkConfig, log.from),
            toAddress: normalizeAddress(networkConfig, log.to),
            amountRaw: log.value.toString(10),
            amountFormatted: formatTokenAmount(log.value, tokenConfig.decimals),
            blockNumber: log.blockNumber,
            blockHash: log.blockHash,
            confirmations: Number(latestBlock - log.blockNumber),
            status: isLate ? "late" : "detected"
          });

          if (created) {
            await this.deps.webhooks.enqueueMerchantEvent(
              transfer.merchantId,
              isLate ? "deposit.late_detected" : "transfer.detected",
              { transfer: publicTransfer(transfer), depositAddress: publicDepositAddress(depositAddress) }
            );
            if (isLate) {
              await this.ensureSettlement(transfer);
            }
          }
        }

        await this.deps.repo.upsertChainCursor(networkConfig.slug, tokenConfig.symbol, toBlock);
      }
    }
  }

  private async confirmPendingTransfers(): Promise<void> {
    for (const networkConfig of enabledNetworks(this.deps.networks)) {
      for (const tokenConfig of enabledTokens(networkConfig)) {
        const latestBlock = await this.deps.chainProvider.getLatestBlockNumber(networkConfig);
        const confirmedHead = latestBlock - BigInt(networkConfig.confirmations);
        const transfers = await this.deps.repo.listTransfersReadyForConfirmation(
          networkConfig.slug,
          tokenConfig.symbol,
          confirmedHead
        );

        for (const transfer of transfers) {
          const confirmed = await this.deps.repo.markTransferConfirmed(
            transfer.id,
            Number(latestBlock - transfer.blockNumber),
            new Date()
          );
          if (!confirmed) {
            continue;
          }

          await this.deps.webhooks.enqueueMerchantEvent(confirmed.merchantId, "deposit.confirmed", {
            transfer: publicTransfer(confirmed)
          });
          await this.ensureSettlement(confirmed);
        }
      }
    }
  }

  private async confirmGasTopUps(): Promise<void> {
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
          });
          const transfer = await this.findTransferForSettlement(confirmed.transferId);
          if (transfer) {
            await this.ensureSettlement(transfer);
          }
        }
      } else {
        await this.failGasTopUp(topUp, "Gas top-up transaction reverted");
      }
    }
  }

  private async confirmSweeps(): Promise<void> {
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
          });
        }
      } else {
        await this.failSweep(sweep, "Sweep transaction reverted");
      }
    }
  }

  private async ensureSettlement(transfer: TokenTransfer): Promise<void> {
    const { network, token } = assertEnabledToken(this.deps.networks, transfer.network, transfer.token);
    const depositAddress = await this.deps.repo.getDepositAddressForMerchant(transfer.merchantId, transfer.depositAddressId);
    if (!depositAddress) {
      return;
    }

    const sweep = await this.deps.repo.getSweepByTransfer(transfer.id);
    if (sweep) {
      return;
    }

    const nativeBalance = await this.deps.chainProvider.getNativeBalance(network, depositAddress.address);
    if (nativeBalance < network.minGasWei) {
      const existingTopUp = await this.deps.repo.getGasTopUpByTransfer(transfer.id);
      if (existingTopUp?.status === "confirmed") {
        await this.submitSweep(transfer);
        return;
      }

      if (existingTopUp) {
        return;
      }

      const gasWalletPrivateKey = await this.getGasWalletPrivateKey(network.slug, network.gasWalletPrivateKey);
      if (!gasWalletPrivateKey) {
        const { gasTopUp } = await this.deps.repo.createGasTopUpIfNotExists({
          id: newId(),
          transferId: transfer.id,
          merchantId: transfer.merchantId,
          depositAddressId: transfer.depositAddressId,
          network: transfer.network,
          txHash: null,
          amountWei: network.gasTopUpWei.toString(10),
          status: "failed",
          failureReason: "Gas wallet private key is not configured"
        });
        await this.deps.webhooks.enqueueMerchantEvent(transfer.merchantId, "gas.topup.failed", {
          gasTopUp: publicGasTopUp(gasTopUp)
        });
        return;
      }

      try {
        const txHash = await this.deps.chainProvider.sendNativeTransfer(
          network,
          gasWalletPrivateKey,
          depositAddress.address,
          network.gasTopUpWei
        );
        const { gasTopUp, created } = await this.deps.repo.createGasTopUpIfNotExists({
          id: newId(),
          transferId: transfer.id,
          merchantId: transfer.merchantId,
          depositAddressId: transfer.depositAddressId,
          network: transfer.network,
          txHash,
          amountWei: network.gasTopUpWei.toString(10),
          status: "submitted"
        });

        if (created) {
          await this.deps.webhooks.enqueueMerchantEvent(transfer.merchantId, "gas.topup.submitted", {
            gasTopUp: publicGasTopUp(gasTopUp)
          });
        }
      } catch (error) {
        const { gasTopUp } = await this.deps.repo.createGasTopUpIfNotExists({
          id: newId(),
          transferId: transfer.id,
          merchantId: transfer.merchantId,
          depositAddressId: transfer.depositAddressId,
          network: transfer.network,
          txHash: null,
          amountWei: network.gasTopUpWei.toString(10),
          status: "failed",
          failureReason: error instanceof Error ? error.message : "Gas top-up failed"
        });
        await this.deps.webhooks.enqueueMerchantEvent(transfer.merchantId, "gas.topup.failed", {
          gasTopUp: publicGasTopUp(gasTopUp)
        });
      }
      void token;
      return;
    }

    await this.submitSweep(transfer);
  }

  private async confirmWalletTransactions(): Promise<void> {
    const submitted = await this.deps.repo.listSubmittedWalletTransactions(100);

    for (const transaction of submitted) {
      if (!transaction.txHash) {
        continue;
      }

      const network = this.deps.networks[transaction.network];
      if (!network) {
        continue;
      }

      const receipt = await this.deps.chainProvider.getTransactionReceipt(network, transaction.txHash);
      if (!receipt) {
        continue;
      }

      await this.deps.repo.updateWalletTransactionStatus(
        transaction.id,
        receipt.status === "success" ? "confirmed" : "failed",
        transaction.txHash,
        receipt.status === "success" ? null : "Wallet transaction reverted"
      );
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

  private async submitSweep(transfer: TokenTransfer): Promise<void> {
    const { network, token } = assertEnabledToken(this.deps.networks, transfer.network, transfer.token);
    const depositAddress = await this.deps.repo.getDepositAddressForMerchant(transfer.merchantId, transfer.depositAddressId);
    const treasury = await this.deps.repo.getTreasuryWallet(transfer.merchantId, transfer.network, transfer.token);

    if (!depositAddress || !treasury) {
      return;
    }

    const privateKey = this.deps.encryptor.decryptString(depositAddress.privateKeyEncrypted);
    const balance = await this.deps.chainProvider.getTokenBalance(network, token, depositAddress.address);
    if (balance === 0n) {
      return;
    }

    try {
      const txHash = await this.deps.chainProvider.sendTokenTransfer(network, token, privateKey, treasury.address, balance);
      const { sweep, created } = await this.deps.repo.createSweepIfNotExists({
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
        status: "submitted"
      });

      if (created) {
        await this.deps.webhooks.enqueueMerchantEvent(transfer.merchantId, "sweep.submitted", {
          sweep: publicSweep(sweep)
        });
      }
    } catch (error) {
      const { sweep } = await this.deps.repo.createSweepIfNotExists({
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
        status: "failed",
        failureReason: error instanceof Error ? error.message : "Sweep failed"
      });
      await this.deps.webhooks.enqueueMerchantEvent(transfer.merchantId, "sweep.failed", {
        sweep: publicSweep(sweep)
      });
    }
  }

  private async findTransferForSettlement(transferId: string): Promise<TokenTransfer | null> {
    return this.deps.repo.getTokenTransfer(transferId);
  }

  private async failGasTopUp(topUp: GasTopUp, reason: string): Promise<void> {
    const failed = await this.deps.repo.updateGasTopUpStatus(topUp.id, "failed", topUp.txHash, reason);
    if (failed) {
      await this.deps.webhooks.enqueueMerchantEvent(failed.merchantId, "gas.topup.failed", {
        gasTopUp: publicGasTopUp(failed)
      });
    }
  }

  private async failSweep(sweep: Sweep, reason: string): Promise<void> {
    const failed = await this.deps.repo.updateSweepStatus(sweep.id, "failed", sweep.txHash, reason);
    if (failed) {
      await this.deps.webhooks.enqueueMerchantEvent(failed.merchantId, "sweep.failed", {
        sweep: publicSweep(failed)
      });
    }
  }
}

function minBigInt(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function publicGasTopUp(gasTopUp: GasTopUp) {
  return {
    id: gasTopUp.id,
    transferId: gasTopUp.transferId,
    network: gasTopUp.network,
    txHash: gasTopUp.txHash,
    amountWei: gasTopUp.amountWei,
    status: gasTopUp.status,
    failureReason: gasTopUp.failureReason,
    createdAt: gasTopUp.createdAt.toISOString(),
    confirmedAt: gasTopUp.confirmedAt?.toISOString() ?? null
  };
}

function publicSweep(sweep: Sweep) {
  return {
    id: sweep.id,
    transferId: sweep.transferId,
    network: sweep.network,
    token: sweep.token,
    txHash: sweep.txHash,
    amountRaw: sweep.amountRaw,
    amountFormatted: sweep.amountFormatted,
    toAddress: sweep.toAddress,
    status: sweep.status,
    failureReason: sweep.failureReason,
    createdAt: sweep.createdAt.toISOString(),
    confirmedAt: sweep.confirmedAt?.toISOString() ?? null
  };
}
