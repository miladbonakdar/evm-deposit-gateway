import { describe, expect, it } from "vitest";
import type { NetworkConfig, TokenConfig } from "../src/config/networks.js";
import { MemoryRepository } from "../src/repositories/memory.js";
import { DepositService } from "../src/services/deposit-service.js";
import { MerchantService } from "../src/services/merchant-service.js";
import { DefaultWebhookService } from "../src/services/webhook-service.js";
import { DepositWorker } from "../src/worker/deposit-worker.js";
import type { ChainProvider, TokenTransferLog, TransactionReceiptSummary } from "../src/worker/chain-provider.js";
import { createTestConfig, testTreasuryAddress } from "./helpers.js";

class MockChainProvider implements ChainProvider {
  latestBlock = 120n;
  nativeBalance = 10_000_000_000_000_000n;
  tokenBalance = 50_000_000n;
  logs: TokenTransferLog[] = [];
  nativeTransfers: { to: string; value: bigint }[] = [];
  tokenTransfers: { to: string; value: bigint }[] = [];
  receipts = new Map<string, TransactionReceiptSummary>();

  async getLatestBlockNumber(): Promise<bigint> {
    return this.latestBlock;
  }

  async getTransferLogs(
    network: NetworkConfig,
    token: TokenConfig,
    fromBlock: bigint,
    toBlock: bigint
  ): Promise<TokenTransferLog[]> {
    return this.logs.filter(
      (log) =>
        log.network === network.slug &&
        log.token === token.symbol &&
        log.blockNumber >= fromBlock &&
        log.blockNumber <= toBlock
    );
  }

  async getNativeBalance(): Promise<bigint> {
    return this.nativeBalance;
  }

  async getTokenBalance(): Promise<bigint> {
    return this.tokenBalance;
  }

  async sendNativeTransfer(_network: NetworkConfig, _fromPrivateKey: string, to: string, value: bigint): Promise<string> {
    this.nativeTransfers.push({ to, value });
    const hash = `0x${"1".repeat(64)}`;
    return hash;
  }

  async sendTokenTransfer(
    _network: NetworkConfig,
    _token: TokenConfig,
    _fromPrivateKey: string,
    to: string,
    value: bigint
  ): Promise<string> {
    this.tokenTransfers.push({ to, value });
    const hash = `0x${"2".repeat(64)}`;
    this.receipts.set(hash, { status: "success", blockNumber: this.latestBlock });
    return hash;
  }

  async getTransactionReceipt(_network: NetworkConfig, txHash: string): Promise<TransactionReceiptSummary | null> {
    return this.receipts.get(txHash) ?? null;
  }
}

async function setupWorker(ttlSeconds = 3600) {
  const config = createTestConfig();
  const repo = new MemoryRepository();
  const webhooks = new DefaultWebhookService(repo, config.encryptor);
  const merchantService = new MerchantService(repo, config.encryptor, config.networks);
  const depositService = new DepositService(repo, config.encryptor, config.networks, webhooks);
  const merchant = await merchantService.createMerchant("Acme");

  await repo.upsertWebhookConfig({
    merchantId: merchant.id,
    url: "https://example.com/webhook",
    active: true,
    secretEncrypted: config.encryptor.encryptString("merchant-webhook-secret")
  });
  await merchantService.configureTreasuryWallet(merchant.id, "ethereum", "USDT", testTreasuryAddress);
  const depositAddress = await depositService.createDepositAddress({
    merchantId: merchant.id,
    network: "ethereum",
    token: "USDT",
    ttlSeconds
  });
  const evm = new MockChainProvider();
  const worker = new DepositWorker({
    repo,
    networks: config.networks,
    encryptor: config.encryptor,
    chainProvider: evm,
    webhooks
  });

  return { repo, merchant, depositAddress, evm, worker };
}

describe("deposit worker", () => {
  it("emits a wallet.expired callback once when a temporary wallet expires", async () => {
    const { repo, worker } = await setupWorker(-1);

    await worker.runOnce();
    await worker.runOnce();

    const events = await repo.listDueWebhookEvents(new Date(), 20);
    expect(events.map((event) => event.type).filter((type) => type === "wallet.expired")).toHaveLength(1);
  });

  it("detects confirmed ERC-20 deposits and sweeps them to treasury", async () => {
    const { repo, merchant, depositAddress, evm, worker } = await setupWorker();
    evm.logs.push({
      network: "ethereum",
      token: "USDT",
      txHash: `0x${"a".repeat(64)}`,
      logIndex: 0,
      blockNumber: 100n,
      blockHash: `0x${"b".repeat(64)}`,
      from: "0x0000000000000000000000000000000000000def",
      to: depositAddress.address,
      value: 25_000_000n
    });

    await worker.runOnce();

    const deposits = await repo.listTransfersForMerchant(merchant.id, { limit: 10 });
    const events = await repo.listDueWebhookEvents(new Date(), 20);

    expect(deposits).toHaveLength(1);
    expect(deposits[0]?.status).toBe("confirmed");
    expect(evm.tokenTransfers).toEqual([{ to: testTreasuryAddress, value: 50_000_000n }]);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["wallet.created", "transfer.detected", "deposit.confirmed", "sweep.submitted", "sweep.confirmed"])
    );
  });

  it("tops up gas before sweeping when the deposit wallet lacks native gas", async () => {
    const { repo, merchant, depositAddress, evm, worker } = await setupWorker();
    evm.nativeBalance = 0n;
    evm.logs.push({
      network: "ethereum",
      token: "USDT",
      txHash: `0x${"c".repeat(64)}`,
      logIndex: 0,
      blockNumber: 100n,
      blockHash: `0x${"d".repeat(64)}`,
      from: "0x0000000000000000000000000000000000000def",
      to: depositAddress.address,
      value: 10_000_000n
    });

    await worker.runOnce();
    expect(evm.nativeTransfers).toHaveLength(1);
    expect(evm.tokenTransfers).toHaveLength(0);

    evm.nativeBalance = 10_000_000_000_000_000n;
    evm.receipts.set(`0x${"1".repeat(64)}`, { status: "success", blockNumber: evm.latestBlock });
    await worker.runOnce();

    const events = await repo.listDueWebhookEvents(new Date(), 20);
    expect(evm.tokenTransfers).toEqual([{ to: testTreasuryAddress, value: 50_000_000n }]);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["gas.topup.submitted", "gas.topup.confirmed", "sweep.submitted", "sweep.confirmed"])
    );
    expect((await repo.listTransfersForMerchant(merchant.id, { limit: 10 }))[0]?.status).toBe("confirmed");
  });
});
