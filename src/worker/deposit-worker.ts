import { enabledNetworks, enabledTokens, type SupportedNetworks } from "../config/networks.js";
import type { Encryptor } from "../security/encryption.js";
import { formatTokenAmount } from "../utils/amount.js";
import { normalizeAddress } from "../utils/address.js";
import { newId } from "../utils/id.js";
import type { Repository } from "../repositories/repository.js";
import { SettlementService } from "../services/settlement-service.js";
import type { WebhookService } from "../services/webhook-service.js";
import { publicDepositAddress, publicTransfer } from "../services/deposit-service.js";
import type { ChainProvider, TokenTransferLog } from "./chain-provider.js";

export interface DepositWorkerDependencies {
  repo: Repository;
  networks: SupportedNetworks;
  encryptor: Encryptor;
  chainProvider: ChainProvider;
  webhooks: WebhookService;
  directTreasuryMatchToleranceBps?: number;
}

export class DepositWorker {
  private readonly settlementService: SettlementService;

  constructor(private readonly deps: DepositWorkerDependencies) {
    this.settlementService = new SettlementService(deps);
  }

  async runOnce(): Promise<void> {
    await this.expireDepositAddresses();
    await this.scanEnabledAssets();
    await this.confirmPendingTransfers();
    await this.settlementService.confirmGasTopUps();
    await this.settlementService.confirmSweeps();
    await this.confirmWalletTransactions();
  }

  private async expireDepositAddresses(): Promise<void> {
    const expired = await this.deps.repo.expireDepositAddresses(new Date());
    for (const depositAddress of expired) {
      await this.deps.webhooks.enqueueMerchantEvent(
        depositAddress.merchantId,
        depositAddress.flow === "direct_treasury" ? "direct_deposit.expired" : "wallet.expired",
        { depositAddress: publicDepositAddress(depositAddress) },
        { depositAddressId: depositAddress.id }
      );
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
          const toAddress = normalizeAddress(networkConfig, log.to);
          const depositAddress = await this.deps.repo.getDepositAddressByAddress(networkConfig.slug, tokenConfig.symbol, toAddress);
          if (depositAddress) {
            const isLate = depositAddress.status !== "active" || depositAddress.expiresAt < new Date();
            const { transfer, created } = await this.deps.repo.createTokenTransferIfNotExists({
              id: newId(),
              merchantId: depositAddress.merchantId,
              depositAddressId: depositAddress.id,
              network: networkConfig.slug,
              token: tokenConfig.symbol,
              txHash: log.txHash,
              logIndex: log.logIndex,
              fromAddress: normalizeAddress(networkConfig, log.from),
              toAddress,
              amountRaw: log.value.toString(10),
              amountFormatted: formatTokenAmount(log.value, tokenConfig.decimals),
              blockNumber: log.blockNumber,
              blockHash: log.blockHash,
              confirmations: Number(latestBlock - log.blockNumber),
              status: isLate ? "late" : "detected"
            });
            if (created) {
              await this.deps.webhooks.enqueueMerchantEvent(
                depositAddress.merchantId,
                isLate ? "deposit.late_detected" : "transfer.detected",
                { transfer: publicTransfer(transfer), depositAddress: publicDepositAddress(depositAddress) },
                { depositAddressId: depositAddress.id }
              );
              if (isLate) {
                await this.settlementService.ensureSettlement(transfer);
              }
            }
            continue;
          }

          await this.matchDirectTreasuryTransfer(log, Number(latestBlock - log.blockNumber));
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
        const transfers = await this.deps.repo.listTransfersReadyForConfirmation(networkConfig.slug, tokenConfig.symbol, confirmedHead);
        for (const transfer of transfers) {
          const confirmed = await this.deps.repo.markTransferConfirmed(transfer.id, Number(latestBlock - transfer.blockNumber), new Date());
          if (!confirmed) {
            continue;
          }
          const depositAddress = await this.deps.repo.getDepositAddressForMerchant(confirmed.merchantId, confirmed.depositAddressId);
          await this.deps.webhooks.enqueueMerchantEvent(
            confirmed.merchantId,
            "deposit.confirmed",
            {
              transfer: publicTransfer(confirmed),
              depositAddress: depositAddress ? publicDepositAddress(depositAddress) : undefined
            },
            { depositAddressId: confirmed.depositAddressId }
          );
          await this.settlementService.ensureSettlement(confirmed);
        }
      }
    }
  }

  private async matchDirectTreasuryTransfer(log: TokenTransferLog, confirmations: number): Promise<void> {
    const networkConfig = this.deps.networks[log.network];
    const tokenConfig = networkConfig?.tokens[log.token];
    if (!networkConfig || !tokenConfig) {
      return;
    }
    const toAddress = normalizeAddress(networkConfig, log.to);
    const fromAddress = normalizeAddress(networkConfig, log.from);
    const sweep = await this.deps.repo.getSweepByTxHash(log.network, log.token, log.txHash);
    if (sweep && sweep.toAddress === toAddress) {
      return;
    }

    const treasuryWallets = await this.deps.repo.listTreasuryWalletsByAddress(log.network, log.token, toAddress);
    const treasury = treasuryWallets[0];
    if (!treasury) {
      return;
    }
    const openRequests = await this.deps.repo.listDepositAddresses({
      merchantId: treasury.merchantId,
      network: log.network,
      token: log.token,
      treasuryWalletId: treasury.id,
      flow: "direct_treasury",
      status: "active",
      matchStatus: "pending",
      limit: 250
    });
    const candidates = openRequests.filter((request) =>
      request.requestedAmountRaw
        ? withinTolerance(log.value, BigInt(request.requestedAmountRaw), this.deps.directTreasuryMatchToleranceBps ?? 500)
        : false
    );

    if (candidates.length !== 1) {
      await this.deps.repo.createTreasuryTransferIfNotExists({
        id: newId(),
        merchantId: treasury.merchantId,
        treasuryWalletId: treasury.id,
        network: log.network,
        token: log.token,
        txHash: log.txHash,
        logIndex: log.logIndex,
        fromAddress,
        toAddress,
        amountRaw: log.value.toString(10),
        amountFormatted: formatTokenAmount(log.value, tokenConfig.decimals),
        blockNumber: log.blockNumber,
        blockHash: log.blockHash,
        confirmations,
        status: candidates.length === 0 ? "unmatched" : "ambiguous",
        candidateDepositAddressIds: candidates.map((candidate) => candidate.id)
      });
      return;
    }

    const depositAddress = candidates[0];
    if (!depositAddress) {
      return;
    }
    const { transfer, created } = await this.deps.repo.createTokenTransferIfNotExists({
      id: newId(),
      merchantId: depositAddress.merchantId,
      depositAddressId: depositAddress.id,
      network: log.network,
      token: log.token,
      txHash: log.txHash,
      logIndex: log.logIndex,
      fromAddress,
      toAddress,
      amountRaw: log.value.toString(10),
      amountFormatted: formatTokenAmount(log.value, tokenConfig.decimals),
      blockNumber: log.blockNumber,
      blockHash: log.blockHash,
      confirmations,
      status: "detected"
    });
    if (!created) {
      return;
    }

    const matched = await this.deps.repo.markDepositAddressMatched(depositAddress.id, {
      transferId: transfer.id,
      receivedAmountRaw: transfer.amountRaw,
      receivedAmountFormatted: transfer.amountFormatted,
      matchSource: "auto",
      matchedAt: new Date()
    });
    await this.deps.repo.updateTransferSettlement(transfer.id, {
      settlementStatus: "settled",
      settlementStep: null,
      settlementFailureReason: null
    });
    await this.deps.webhooks.enqueueMerchantEvent(
      depositAddress.merchantId,
      "transfer.detected",
      { transfer: publicTransfer(transfer), depositAddress: publicDepositAddress(matched ?? depositAddress) },
      { depositAddressId: depositAddress.id }
    );
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
}

function minBigInt(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function withinTolerance(received: bigint, requested: bigint, toleranceBps: number): boolean {
  if (requested <= 0n) {
    return false;
  }
  const delta = received > requested ? received - requested : requested - received;
  return delta * 10_000n <= requested * BigInt(toleranceBps);
}
