import { describe, expect, it } from "vitest";
import type { NetworkConfig, TokenConfig } from "../src/config/networks.js";
import { MemoryRepository } from "../src/repositories/memory.js";
import { DepositService } from "../src/services/deposit-service.js";
import { MerchantService } from "../src/services/merchant-service.js";
import { SettlementService } from "../src/services/settlement-service.js";
import { DefaultWebhookService } from "../src/services/webhook-service.js";
import { DepositWorker } from "../src/worker/deposit-worker.js";
import type { ChainProvider, TokenTransferLog, TransactionReceiptSummary } from "../src/worker/chain-provider.js";
import { createTestConfig, testTreasuryAddress } from "./helpers.js";
import { newId } from "../src/utils/id.js";
import { operationalWalletScopeKey } from "../src/utils/wallet.js";

class MockChainProvider implements ChainProvider {
  latestBlock = 120n;
  nativeBalance = 10_000_000_000_000_000n;
  tokenBalance = 50_000_000n;
  logs: TokenTransferLog[] = [];
  nativeTransfers: { to: string; value: bigint }[] = [];
  tokenTransfers: { to: string; value: bigint }[] = [];
  receipts = new Map<string, TransactionReceiptSummary>();
  failTokenTransfer = false;

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
    if (this.failTokenTransfer) {
      throw new Error("mock token transfer failed");
    }
    this.tokenTransfers.push({ to, value });
    const hash = `0x${"2".repeat(64)}`;
    this.receipts.set(hash, { status: "success", blockNumber: this.latestBlock });
    return hash;
  }

  async getTransactionReceipt(_network: NetworkConfig, txHash: string): Promise<TransactionReceiptSummary | null> {
    return this.receipts.get(txHash) ?? null;
  }
}

async function setupWorker(ttlSeconds = 3600, config = createTestConfig()) {
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
    callbackUrl: "https://example.com/deposit-callback",
    callbackSecret: "deposit-callback-secret",
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

  return { config, repo, merchant, depositAddress, evm, worker };
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
    const { config, repo, merchant, depositAddress, evm, worker } = await setupWorker();
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
    const { config, repo, merchant, depositAddress, evm, worker } = await setupWorker();
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

  it("uses an encrypted generated gas wallet when env gas key is not configured", async () => {
    const config = createTestConfig({
      networks: createTestConfig().networks
    });
    if (config.networks.ethereum) {
      config.networks.ethereum.gasWalletPrivateKey = undefined;
    }
    const repo = new MemoryRepository();
    const webhooks = new DefaultWebhookService(repo, config.encryptor);
    const merchantService = new MerchantService(repo, config.encryptor, config.networks);
    const depositService = new DepositService(repo, config.encryptor, config.networks, webhooks);
    const merchant = await merchantService.createMerchant("Stored Gas");
    await repo.upsertWebhookConfig({
      merchantId: merchant.id,
      url: "https://example.com/webhook",
      active: true,
      secretEncrypted: config.encryptor.encryptString("merchant-webhook-secret")
    });
    await merchantService.configureTreasuryWallet(merchant.id, "ethereum", "USDT", testTreasuryAddress);
    await repo.upsertOperationalWallet({
      id: newId(),
      scopeKey: operationalWalletScopeKey("gas", null, "ethereum", null),
      merchantId: null,
      purpose: "gas",
      network: "ethereum",
      token: null,
      address: "0x0000000000000000000000000000000000000aaa",
      privateKeyEncrypted: config.encryptor.encryptString(`0x${"3".repeat(64)}`),
      label: "Stored gas wallet"
    });
    const depositAddress = await depositService.createDepositAddress({
      merchantId: merchant.id,
      network: "ethereum",
      token: "USDT",
      callbackUrl: "https://example.com/stored-gas-callback",
      callbackSecret: "stored-gas-callback-secret",
      ttlSeconds: 3600
    });
    const evm = new MockChainProvider();
    evm.nativeBalance = 0n;
    evm.logs.push({
      network: "ethereum",
      token: "USDT",
      txHash: `0x${"e".repeat(64)}`,
      logIndex: 0,
      blockNumber: 100n,
      blockHash: `0x${"f".repeat(64)}`,
      from: "0x0000000000000000000000000000000000000def",
      to: depositAddress.address,
      value: 10_000_000n
    });
    const worker = new DepositWorker({
      repo,
      networks: config.networks,
      encryptor: config.encryptor,
      chainProvider: evm,
      webhooks
    });

    await worker.runOnce();

    expect(evm.nativeTransfers).toEqual([{ to: depositAddress.address, value: 5_000_000_000_000_000n }]);
  });

  it("keeps failed gas top-ups pending until settlement is retried", async () => {
    const config = createTestConfig();
    if (config.networks.ethereum) {
      config.networks.ethereum.gasWalletPrivateKey = undefined;
    }
    const { repo, merchant, depositAddress, evm, worker } = await setupWorker(3600, config);
    evm.nativeBalance = 0n;
    evm.logs.push({
      network: "ethereum",
      token: "USDT",
      txHash: `0x${"9".repeat(64)}`,
      logIndex: 0,
      blockNumber: 100n,
      blockHash: `0x${"7".repeat(64)}`,
      from: "0x0000000000000000000000000000000000000def",
      to: depositAddress.address,
      value: 10_000_000n
    });

    await worker.runOnce();

    const transfer = (await repo.listTransfersForMerchant(merchant.id, { limit: 10 }))[0];
    if (!transfer) {
      throw new Error("Expected transfer");
    }
    expect(transfer.settlementStatus).toBe("pending");
    expect(transfer.settlementStep).toBe("gas_top_up");
    expect((await repo.listGasTopUps(10))).toEqual([
      expect.objectContaining({ attemptNumber: 1, status: "failed" })
    ]);

    await repo.upsertOperationalWallet({
      id: newId(),
      scopeKey: operationalWalletScopeKey("gas", null, "ethereum", null),
      merchantId: null,
      purpose: "gas",
      network: "ethereum",
      token: null,
      address: "0x0000000000000000000000000000000000000aaa",
      privateKeyEncrypted: config.encryptor.encryptString(`0x${"3".repeat(64)}`),
      label: "Stored gas wallet"
    });

    await worker.runOnce();
    expect(evm.nativeTransfers).toHaveLength(0);
    expect(await repo.listGasTopUps(10)).toHaveLength(1);

    const settlement = new SettlementService({
      repo,
      networks: config.networks,
      encryptor: config.encryptor,
      chainProvider: evm,
      webhooks: new DefaultWebhookService(repo, config.encryptor)
    });
    await settlement.ensureSettlement(transfer, { forceRetry: true });

    expect(evm.nativeTransfers).toEqual([{ to: depositAddress.address, value: 5_000_000_000_000_000n }]);
    expect(await repo.listGasTopUps(10)).toEqual([
      expect.objectContaining({ attemptNumber: 2, status: "submitted" }),
      expect.objectContaining({ attemptNumber: 1, status: "failed" })
    ]);
  });

  it("preserves failed sweep attempts and confirms a forced retry", async () => {
    const { config, repo, merchant, depositAddress, evm, worker } = await setupWorker();
    evm.failTokenTransfer = true;
    evm.logs.push({
      network: "ethereum",
      token: "USDT",
      txHash: `0x${"6".repeat(64)}`,
      logIndex: 0,
      blockNumber: 100n,
      blockHash: `0x${"5".repeat(64)}`,
      from: "0x0000000000000000000000000000000000000def",
      to: depositAddress.address,
      value: 10_000_000n
    });

    await worker.runOnce();

    const transfer = (await repo.listTransfersForMerchant(merchant.id, { limit: 10 }))[0];
    if (!transfer) {
      throw new Error("Expected transfer");
    }
    expect((await repo.listSweeps(10))).toEqual([
      expect.objectContaining({ attemptNumber: 1, status: "failed" })
    ]);
    expect((await repo.getTokenTransfer(transfer.id))?.settlementStep).toBe("sweep");

    evm.failTokenTransfer = false;
    await worker.runOnce();
    expect(await repo.listSweeps(10)).toHaveLength(1);

    const settlement = new SettlementService({
      repo,
      networks: config.networks,
      encryptor: config.encryptor,
      chainProvider: evm,
      webhooks: new DefaultWebhookService(repo, config.encryptor)
    });
    await settlement.ensureSettlement(transfer, { forceRetry: true });
    await worker.runOnce();

    expect(await repo.listSweeps(10)).toEqual([
      expect.objectContaining({ attemptNumber: 2, status: "confirmed" }),
      expect.objectContaining({ attemptNumber: 1, status: "failed" })
    ]);
    expect((await repo.getTokenTransfer(transfer.id))?.settlementStatus).toBe("settled");
  });

  it("confirms dashboard wallet transactions", async () => {
    const config = createTestConfig();
    const repo = new MemoryRepository();
    const webhooks = new DefaultWebhookService(repo, config.encryptor);
    const evm = new MockChainProvider();
    const wallet = await repo.upsertOperationalWallet({
      id: newId(),
      scopeKey: operationalWalletScopeKey("gas", null, "ethereum", null),
      merchantId: null,
      purpose: "gas",
      network: "ethereum",
      token: null,
      address: "0x0000000000000000000000000000000000000aaa",
      privateKeyEncrypted: config.encryptor.encryptString(`0x${"3".repeat(64)}`),
      label: "Gas wallet"
    });
    const txHash = `0x${"8".repeat(64)}`;
    await repo.createWalletTransaction({
      id: newId(),
      merchantId: null,
      sourceWalletId: wallet.id,
      network: "ethereum",
      token: null,
      asset: "NATIVE",
      txHash,
      fromAddress: wallet.address,
      toAddress: testTreasuryAddress,
      amountRaw: "1000000000000000",
      amountFormatted: "0.001",
      status: "submitted"
    });
    evm.receipts.set(txHash, { status: "success", blockNumber: evm.latestBlock });
    const worker = new DepositWorker({
      repo,
      networks: config.networks,
      encryptor: config.encryptor,
      chainProvider: evm,
      webhooks
    });

    await worker.runOnce();

    expect((await repo.listWalletTransactions(10))[0]?.status).toBe("confirmed");
  });
});
