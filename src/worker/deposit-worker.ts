import { enabledNetworks, enabledTokens, type SupportedNetworks } from "../config/networks.js";
import type { Encryptor } from "../security/encryption.js";
import { formatTokenAmount } from "../utils/amount.js";
import { normalizeAddress } from "../utils/address.js";
import { newId } from "../utils/id.js";
import type { Repository } from "../repositories/repository.js";
import { SettlementService } from "../services/settlement-service.js";
import type { WebhookService } from "../services/webhook-service.js";
import { publicDepositAddress, publicTransfer } from "../services/deposit-service.js";
import type { ChainProvider } from "./chain-provider.js";

export interface DepositWorkerDependencies {
  repo: Repository;
  networks: SupportedNetworks;
  encryptor: Encryptor;
  chainProvider: ChainProvider;
  webhooks: WebhookService;
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
      await this.deps.webhooks.enqueueMerchantEvent(depositAddress.merchantId, "wallet.expired", {
        depositAddress: publicDepositAddress(depositAddress)
      }, { depositAddressId: depositAddress.id });
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
              { transfer: publicTransfer(transfer), depositAddress: publicDepositAddress(depositAddress) },
              { depositAddressId: depositAddress.id }
            );
            if (isLate) {
              await this.settlementService.ensureSettlement(transfer);
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
          }, { depositAddressId: confirmed.depositAddressId });
          await this.settlementService.ensureSettlement(confirmed);
        }
      }
    }
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
