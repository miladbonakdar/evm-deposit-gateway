import { describe, expect, it } from "vitest";
import { createApp } from "../src/api/app.js";
import type { NetworkConfig, TokenConfig } from "../src/config/networks.js";
import { MemoryRepository } from "../src/repositories/memory.js";
import type { ChainProvider, TokenTransferLog, TransactionReceiptSummary } from "../src/worker/chain-provider.js";
import {
  adminHeaders,
  createTestConfig,
  createTestNetworks,
  signedHeaders,
  testTreasuryAddress,
  testTronTokenAddress,
  testTronTreasuryAddress
} from "./helpers.js";

interface MerchantResponse {
  id: string;
}

interface ApiKeyResponse {
  apiKey: string;
  apiSecret: string;
}

interface DepositAddressResponse {
  id: string;
  address: string;
  qr: {
    base64?: string;
  };
  privateKey?: string;
}

class MockChainProvider implements ChainProvider {
  tokenTransfers: Array<{ to: string; value: bigint }> = [];
  nativeTransfers: Array<{ to: string; value: bigint }> = [];
  failTokenTransfer = false;

  async getLatestBlockNumber(): Promise<bigint> {
    return 100n;
  }

  async getTransferLogs(): Promise<TokenTransferLog[]> {
    return [];
  }

  async getNativeBalance(): Promise<bigint> {
    return 10_000_000_000_000_000n;
  }

  async getTokenBalance(): Promise<bigint> {
    return 0n;
  }

  async sendNativeTransfer(_network: NetworkConfig, _fromPrivateKey: string, to: string, value: bigint): Promise<string> {
    this.nativeTransfers.push({ to, value });
    return `0x${"3".repeat(64)}`;
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
    return `0x${"4".repeat(64)}`;
  }

  async getTransactionReceipt(): Promise<TransactionReceiptSummary | null> {
    return { status: "success", blockNumber: 100n };
  }
}

async function setupApi() {
  const repo = new MemoryRepository();
  const config = createTestConfig();
  const app = createApp({ repo, config });

  const merchantResponse = await app.request("/admin/merchants", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ name: "Acme" })
  });
  const merchant = (await merchantResponse.json()) as MerchantResponse;

  const apiKeyResponse = await app.request(`/admin/merchants/${merchant.id}/api-keys`, {
    method: "POST",
    headers: adminHeaders()
  });
  const apiKey = (await apiKeyResponse.json()) as ApiKeyResponse;

  await app.request(`/admin/merchants/${merchant.id}/webhook`, {
    method: "PUT",
    headers: adminHeaders(),
    body: JSON.stringify({ url: "https://example.com/webhook", secret: "merchant-webhook-secret" })
  });

  await app.request(`/admin/merchants/${merchant.id}/treasury-wallets`, {
    method: "PUT",
    headers: adminHeaders(),
    body: JSON.stringify({ network: "ethereum", token: "USDT", address: testTreasuryAddress })
  });

  return { app, repo, merchant, apiKey };
}

async function dashboardToken(app: ReturnType<typeof createApp>) {
  const response = await app.request("/dashboard/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "test-dashboard-password" })
  });
  const body = (await response.json()) as { token: string };
  return body.token;
}

async function setupTronApi() {
  const repo = new MemoryRepository();
  const networks = createTestNetworks();
  networks.tron = {
    slug: "tron",
    kind: "tron",
    rpcUrl: "https://api.trongrid.io",
    eventServerUrl: "https://api.trongrid.io",
    confirmations: 20,
    scanFromBlock: 0n,
    maxScanBlocks: 500n,
    gasWalletPrivateKey: "0x" + "1".repeat(64),
    minGasWei: 5_000_000n,
    gasTopUpWei: 10_000_000n,
    tokens: {
      USDT: {
        symbol: "USDT",
        contractAddress: testTronTokenAddress,
        decimals: 6
      },
      USDC: undefined
    }
  };
  const config = createTestConfig({ networks });
  const app = createApp({ repo, config });

  const merchantResponse = await app.request("/admin/merchants", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ name: "Tron Merchant" })
  });
  const merchant = (await merchantResponse.json()) as MerchantResponse;
  const apiKeyResponse = await app.request(`/admin/merchants/${merchant.id}/api-keys`, {
    method: "POST",
    headers: adminHeaders()
  });
  const apiKey = (await apiKeyResponse.json()) as ApiKeyResponse;

  await app.request(`/admin/merchants/${merchant.id}/treasury-wallets`, {
    method: "PUT",
    headers: adminHeaders(),
    body: JSON.stringify({ network: "tron", token: "USDT", address: testTronTreasuryAddress })
  });

  return { app, apiKey };
}

describe("Hono API", () => {
  it("creates merchants, credentials, webhook config, treasury wallets, and deposit addresses", async () => {
    const { app, apiKey } = await setupApi();
    const body = JSON.stringify({
      network: "ethereum",
      token: "USDT",
      ttlSeconds: 3600,
      externalId: "invoice-1",
      metadata: { customerId: "cus_1" },
      qrFormat: "base64"
    });
    const response = await app.request("/v1/deposit-addresses", {
      method: "POST",
      headers: {
        ...signedHeaders({
          apiKey: apiKey.apiKey,
          apiSecret: apiKey.apiSecret,
          method: "POST",
          path: "/v1/deposit-addresses",
          body
        }),
        "idempotency-key": "idem-1"
      },
      body
    });

    expect(response.status).toBe(201);
    const depositAddress = (await response.json()) as DepositAddressResponse;
    expect(depositAddress.address).toMatch(/^0x[a-f0-9]{40}$/);
    expect(depositAddress.qr.base64).toEqual(expect.any(String));
    expect(depositAddress.privateKey).toBeUndefined();

    const replay = await app.request("/v1/deposit-addresses", {
      method: "POST",
      headers: {
        ...signedHeaders({
          apiKey: apiKey.apiKey,
          apiSecret: apiKey.apiSecret,
          method: "POST",
          path: "/v1/deposit-addresses",
          body
        }),
        "idempotency-key": "idem-1"
      },
      body
    });
    const replayBody = (await replay.json()) as DepositAddressResponse;

    expect(replay.status).toBe(201);
    expect(replayBody.id).toBe(depositAddress.id);
  });

  it("rejects reused nonces and unsupported assets", async () => {
    const { app, apiKey } = await setupApi();
    const body = JSON.stringify({ network: "ethereum", token: "USDC" });
    const headers = signedHeaders({
      apiKey: apiKey.apiKey,
      apiSecret: apiKey.apiSecret,
      method: "POST",
      path: "/v1/deposit-addresses",
      body,
      nonce: "fixed-nonce"
    });

    const unsupported = await app.request("/v1/deposit-addresses", {
      method: "POST",
      headers,
      body
    });
    expect(unsupported.status).toBe(400);

    const replay = await app.request("/v1/deposit-addresses", {
      method: "POST",
      headers,
      body
    });
    expect(replay.status).toBe(401);
  });

  it("serves OpenAPI metadata with enabled assets", async () => {
    const { app } = await setupApi();
    const response = await app.request("/openapi.json");
    const body = (await response.json()) as { openapi: string; "x-enabled-assets": unknown[] };

    expect(response.status).toBe(200);
    expect(body.openapi).toBe("3.1.0");
    expect(body["x-enabled-assets"]).toEqual([
      expect.objectContaining({ network: "ethereum", token: "USDT", decimals: 6 })
    ]);
  });

  it("creates TRON deposit addresses when TRON is configured", async () => {
    const { app, apiKey } = await setupTronApi();
    const body = JSON.stringify({ network: "tron", token: "USDT", ttlSeconds: 3600 });
    const response = await app.request("/v1/deposit-addresses", {
      method: "POST",
      headers: signedHeaders({
        apiKey: apiKey.apiKey,
        apiSecret: apiKey.apiSecret,
        method: "POST",
        path: "/v1/deposit-addresses",
        body
      }),
      body
    });

    expect(response.status).toBe(201);
    const depositAddress = (await response.json()) as DepositAddressResponse;
    expect(depositAddress.address).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
  });

  it("serves dashboard login, data, generated wallets, and manual wallet transactions", async () => {
    const repo = new MemoryRepository();
    const config = createTestConfig();
    const chainProvider = new MockChainProvider();
    const app = createApp({ repo, config, chainProvider });
    const login = await app.request("/dashboard/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "wrong-password" })
    });

    expect(login.status).toBe(401);
    const token = await dashboardToken(app);
    const merchantResponse = await app.request("/dashboard/api/merchants", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "Dashboard Merchant" })
    });
    const merchant = (await merchantResponse.json()) as MerchantResponse;

    const dashboardApiKey = await app.request(`/dashboard/api/merchants/${merchant.id}/api-keys`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({})
    });
    expect(dashboardApiKey.status).toBe(201);
    const dashboardApiKeyBody = (await dashboardApiKey.json()) as ApiKeyResponse;
    expect(dashboardApiKeyBody.apiSecret).toEqual(expect.any(String));

    const dashboardWebhook = await app.request(`/dashboard/api/merchants/${merchant.id}/webhook`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/dashboard-webhook", secret: "dashboard-webhook-secret" })
    });
    expect(dashboardWebhook.status).toBe(200);

    const gasWallet = await app.request("/dashboard/api/wallets/gas", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ network: "ethereum" })
    });
    expect(gasWallet.status).toBe(201);

    const treasuryWallet = await app.request("/dashboard/api/wallets/treasury", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ merchantId: merchant.id, network: "ethereum", token: "USDT" })
    });
    expect(treasuryWallet.status).toBe(201);
    const treasuryBody = (await treasuryWallet.json()) as { operationalWallet: { id: string; privateKey?: string } };
    expect(treasuryBody.operationalWallet.privateKey).toBeUndefined();

    const transfer = await app.request("/dashboard/api/wallet-transactions", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        sourceWalletId: treasuryBody.operationalWallet.id,
        asset: "USDT",
        toAddress: testTreasuryAddress,
        amount: "12.5"
      })
    });
    expect(transfer.status).toBe(201);
    expect(chainProvider.tokenTransfers).toEqual([{ to: testTreasuryAddress, value: 12_500_000n }]);

    const data = await app.request("/dashboard/api/data", {
      headers: { authorization: `Bearer ${token}` }
    });
    const dataBody = (await data.json()) as {
      apiKeys: unknown[];
      webhookConfigs: unknown[];
      operationalWallets: unknown[];
      walletTransactions: unknown[];
    };
    expect(dataBody.apiKeys).toHaveLength(1);
    expect(dataBody.webhookConfigs).toHaveLength(1);
    expect(dataBody.operationalWallets).toHaveLength(2);
    expect(dataBody.walletTransactions).toHaveLength(1);
  });

  it("does not serve SPA HTML for missing dashboard API routes", async () => {
    const repo = new MemoryRepository();
    const config = createTestConfig();
    const app = createApp({ repo, config, chainProvider: new MockChainProvider() });
    const token = await dashboardToken(app);
    const response = await app.request("/dashboard/api/missing-route", {
      headers: { authorization: `Bearer ${token}` }
    });
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("not_found");
  });

  it("returns validation errors for invalid dashboard transfer amounts and failed sends", async () => {
    const repo = new MemoryRepository();
    const config = createTestConfig();
    const chainProvider = new MockChainProvider();
    const app = createApp({ repo, config, chainProvider });
    const token = await dashboardToken(app);
    const merchantResponse = await app.request("/dashboard/api/merchants", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "Failure Merchant" })
    });
    const merchant = (await merchantResponse.json()) as MerchantResponse;
    const treasuryWallet = await app.request("/dashboard/api/wallets/treasury", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ merchantId: merchant.id, network: "ethereum", token: "USDT" })
    });
    const treasuryBody = (await treasuryWallet.json()) as { operationalWallet: { id: string } };

    const invalidAmount = await app.request("/dashboard/api/wallet-transactions", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        sourceWalletId: treasuryBody.operationalWallet.id,
        asset: "USDT",
        toAddress: testTreasuryAddress,
        amount: "1.1234567"
      })
    });
    expect(invalidAmount.status).toBe(400);

    chainProvider.failTokenTransfer = true;
    const failedSend = await app.request("/dashboard/api/wallet-transactions", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        sourceWalletId: treasuryBody.operationalWallet.id,
        asset: "USDT",
        toAddress: testTreasuryAddress,
        amount: "1.1"
      })
    });
    const failedBody = (await failedSend.json()) as { error: { code: string; details: { status: string } } };

    expect(failedSend.status).toBe(422);
    expect(failedBody.error.code).toBe("wallet_transaction_failed");
    expect(failedBody.error.details.status).toBe("failed");
    expect((await repo.listWalletTransactions(10))[0]?.status).toBe("failed");
  });
});
