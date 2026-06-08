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
  testTokenAddress,
  testTreasuryAddress,
  testTronTokenAddress,
  testTronTreasuryAddress
} from "./helpers.js";

interface ApiKeyResponse {
  id: string;
  apiKey: string;
  apiSecret: string;
}

interface DepositAddressResponse {
  id: string;
  address: string;
  treasuryWalletId: string;
  callbackUrl: string | null;
  clientId: string;
  status: "active" | "expired" | "completed" | "closed";
  flow: "temporary_wallet" | "direct_treasury";
  requestedAmountFormatted: string | null;
  receivedAmountFormatted: string | null;
  matchStatus: "pending" | "matched" | null;
  qr: {
    base64?: string;
  };
  privateKey?: string;
}

class MockChainProvider implements ChainProvider {
  tokenTransfers: Array<{ to: string; value: bigint }> = [];
  nativeTransfers: Array<{ to: string; value: bigint }> = [];
  latestBlock = 100n;
  nativeBalance = 10_000_000_000_000_000n;
  failLatestBlock = false;
  failTokenBalance = false;
  failTokenTransfer = false;

  async getLatestBlockNumber(): Promise<bigint> {
    if (this.failLatestBlock) {
      throw new Error("mock latest block failed");
    }
    return this.latestBlock;
  }

  async getTransferLogs(): Promise<TokenTransferLog[]> {
    return [];
  }

  async getNativeBalance(): Promise<bigint> {
    return this.nativeBalance;
  }

  async getTokenBalance(): Promise<bigint> {
    if (this.failTokenBalance) {
      throw new Error("mock token balance failed");
    }
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

async function setupApi({
  config = createTestConfig(),
  chainProvider = new MockChainProvider()
}: {
  config?: ReturnType<typeof createTestConfig>;
  chainProvider?: MockChainProvider;
} = {}) {
  const repo = new MemoryRepository();
  const app = createApp({ repo, config, chainProvider });

  const ownerResponse = await app.request("/admin/owner", {
    headers: adminHeaders()
  });
  expect(ownerResponse.status).toBe(200);

  const apiKeyResponse = await app.request("/admin/api-keys", {
    method: "POST",
    headers: adminHeaders()
  });
  const apiKey = (await apiKeyResponse.json()) as ApiKeyResponse;

  await app.request("/admin/webhook", {
    method: "PUT",
    headers: adminHeaders(),
    body: JSON.stringify({ url: "https://example.com/webhook", secret: "merchant-webhook-secret" })
  });

  await app.request("/admin/treasury-wallets", {
    method: "PUT",
    headers: adminHeaders(),
    body: JSON.stringify({ network: "ethereum", token: "USDT", address: testTreasuryAddress })
  });

  return { app, repo, apiKey, chainProvider, config };
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

let depositClientSequence = 0;

function depositBody(input: Record<string, unknown>) {
  depositClientSequence += 1;
  return JSON.stringify({
    clientId: `client-${depositClientSequence}`,
    ...input
  });
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
  const chainProvider = new MockChainProvider();
  const app = createApp({ repo, config, chainProvider });

  const apiKeyResponse = await app.request("/admin/api-keys", {
    method: "POST",
    headers: adminHeaders()
  });
  const apiKey = (await apiKeyResponse.json()) as ApiKeyResponse;

  await app.request("/admin/treasury-wallets", {
    method: "PUT",
    headers: adminHeaders(),
    body: JSON.stringify({ network: "tron", token: "USDT", address: testTronTreasuryAddress })
  });

  return { app, apiKey, chainProvider };
}

describe("Hono API", () => {
  it("creates owner credentials, treasury wallets, and deposit addresses", async () => {
    const { app, apiKey, repo } = await setupApi();
    const body = depositBody({
      network: "ethereum",
      token: "USDT",
      callbackUrl: "https://example.com/invoice-1-callback",
      callbackSecret: "invoice-1-callback-secret",
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
    expect(depositAddress.flow).toBe("temporary_wallet");
    expect(depositAddress.requestedAmountFormatted).toBeNull();
    expect(depositAddress.matchStatus).toBeNull();
    expect(depositAddress.treasuryWalletId).toEqual(expect.any(String));
    expect(depositAddress.callbackUrl).toBe("https://example.com/invoice-1-callback");
    expect(depositAddress.qr.base64).toEqual(expect.any(String));
    expect(depositAddress.privateKey).toBeUndefined();
    const callbacks = await repo.listDueWebhookEvents(new Date(), 10);
    expect(callbacks[0]).toEqual(
      expect.objectContaining({
        type: "wallet.created",
        url: "https://example.com/invoice-1-callback",
        depositAddressId: depositAddress.id,
        payload: expect.objectContaining({
          data: expect.objectContaining({
            treasuryWallet: testTreasuryAddress,
            treasuryWalletId: depositAddress.treasuryWalletId
          })
        })
      })
    );

    const treasuryList = await app.request("/v1/treasury-wallets?network=ethereum&token=USDT", {
      headers: signedHeaders({
        apiKey: apiKey.apiKey,
        apiSecret: apiKey.apiSecret,
        method: "GET",
        path: "/v1/treasury-wallets?network=ethereum&token=USDT"
      })
    });
    const treasuryBody = (await treasuryList.json()) as {
      treasuryWallets: Array<{ id: string; isDefault: boolean; address: string }>;
    };
    expect(treasuryList.status).toBe(200);
    expect(treasuryBody.treasuryWallets).toEqual([
      expect.objectContaining({ id: depositAddress.treasuryWalletId, isDefault: true, address: testTreasuryAddress })
    ]);

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

  it("uses the dashboard callback secret when deposit requests omit callbackSecret", async () => {
    const { app, apiKey, repo, config } = await setupApi();
    const body = depositBody({
      network: "ethereum",
      token: "USDT",
      externalId: "invoice-dashboard-callback"
    });
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
    expect(depositAddress.callbackUrl).toBeNull();

    const callbacks = await repo.listDueWebhookEvents(new Date(), 10);
    const callback = callbacks.find((event) => event.depositAddressId === depositAddress.id);
    expect(callback).toEqual(expect.objectContaining({
      type: "wallet.created",
      url: "https://example.com/webhook"
    }));
    expect(config.encryptor.decryptString(callback?.secretEncrypted ?? "")).toBe("merchant-webhook-secret");
  });

  it("allows per-deposit callback URLs without per-deposit callback secrets", async () => {
    const { app, apiKey, repo, config } = await setupApi();
    const body = depositBody({
      network: "ethereum",
      token: "USDT",
      callbackUrl: "https://example.com/order-specific-callback"
    });
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
    expect(depositAddress.callbackUrl).toBe("https://example.com/order-specific-callback");

    const callbacks = await repo.listDueWebhookEvents(new Date(), 10);
    const callback = callbacks.find((event) => event.depositAddressId === depositAddress.id);
    expect(callback).toEqual(expect.objectContaining({
      type: "wallet.created",
      url: "https://example.com/order-specific-callback"
    }));
    expect(config.encryptor.decryptString(callback?.secretEncrypted ?? "")).toBe("merchant-webhook-secret");
  });

  it("rejects duplicate active deposit requests for the same merchant client by default", async () => {
    const { app, apiKey } = await setupApi();
    const firstBody = JSON.stringify({
      network: "ethereum",
      token: "USDT",
      clientId: "merchant-client-1"
    });
    const first = await app.request("/v1/deposit-addresses", {
      method: "POST",
      headers: signedHeaders({
        apiKey: apiKey.apiKey,
        apiSecret: apiKey.apiSecret,
        method: "POST",
        path: "/v1/deposit-addresses",
        body: firstBody
      }),
      body: firstBody
    });
    expect(first.status).toBe(201);

    const secondBody = JSON.stringify({
      network: "ethereum",
      token: "USDT",
      clientId: "merchant-client-1",
      externalId: "second-order"
    });
    const second = await app.request("/v1/deposit-addresses", {
      method: "POST",
      headers: signedHeaders({
        apiKey: apiKey.apiKey,
        apiSecret: apiKey.apiSecret,
        method: "POST",
        path: "/v1/deposit-addresses",
        body: secondBody
      }),
      body: secondBody
    });
    const result = (await second.json()) as { error: { code: string; details: { clientId: string; depositAddressId: string } } };

    expect(second.status).toBe(409);
    expect(result.error.code).toBe("client_pending_deposit_exists");
    expect(result.error.details.clientId).toBe("merchant-client-1");
    expect(result.error.details.depositAddressId).toEqual(expect.any(String));
  });

  it("lets merchants close an active deposit request and create another for the same client", async () => {
    const { app, apiKey } = await setupApi();
    const firstBody = JSON.stringify({
      network: "ethereum",
      token: "USDT",
      clientId: "merchant-client-close"
    });
    const first = await app.request("/v1/deposit-addresses", {
      method: "POST",
      headers: signedHeaders({
        apiKey: apiKey.apiKey,
        apiSecret: apiKey.apiSecret,
        method: "POST",
        path: "/v1/deposit-addresses",
        body: firstBody
      }),
      body: firstBody
    });
    const firstDeposit = (await first.json()) as DepositAddressResponse;
    const closePath = `/v1/deposit-addresses/${firstDeposit.id}/close`;
    const close = await app.request(closePath, {
      method: "POST",
      headers: signedHeaders({
        apiKey: apiKey.apiKey,
        apiSecret: apiKey.apiSecret,
        method: "POST",
        path: closePath
      })
    });
    const closed = (await close.json()) as DepositAddressResponse;
    expect(close.status).toBe(200);
    expect(closed.status).toBe("closed");

    const secondBody = JSON.stringify({
      network: "ethereum",
      token: "USDT",
      clientId: "merchant-client-close",
      externalId: "after-close"
    });
    const second = await app.request("/v1/deposit-addresses", {
      method: "POST",
      headers: signedHeaders({
        apiKey: apiKey.apiKey,
        apiSecret: apiKey.apiSecret,
        method: "POST",
        path: "/v1/deposit-addresses",
        body: secondBody
      }),
      body: secondBody
    });

    expect(second.status).toBe(201);
  });

  it("allows duplicate active client requests when the merchant setting is disabled", async () => {
    const { app, apiKey } = await setupApi();
    const token = await dashboardToken(app);
    const settings = await app.request("/dashboard/api/merchant-settings", {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ rejectDuplicateClientPendingDeposits: false })
    });
    expect(settings.status).toBe(200);

    for (const externalId of ["duplicate-setting-1", "duplicate-setting-2"]) {
      const body = JSON.stringify({
        network: "ethereum",
        token: "USDT",
        clientId: "merchant-client-duplicates-allowed",
        externalId
      });
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
    }
  });

  it("lets merchants list treasuries and choose a non-default treasury for a deposit", async () => {
    const { app, apiKey, repo } = await setupApi();
    const altTreasuryAddress = "0x0000000000000000000000000000000000000abd";

    const firstList = await app.request("/v1/treasury-wallets?network=ethereum&token=USDT", {
      headers: signedHeaders({
        apiKey: apiKey.apiKey,
        apiSecret: apiKey.apiSecret,
        method: "GET",
        path: "/v1/treasury-wallets?network=ethereum&token=USDT"
      })
    });
    const firstListBody = (await firstList.json()) as {
      treasuryWallets: Array<{ id: string; address: string; isDefault: boolean }>;
    };
    const firstTreasury = firstListBody.treasuryWallets[0];
    if (!firstTreasury) {
      throw new Error("Expected initial treasury wallet");
    }
    expect(firstTreasury).toEqual(expect.objectContaining({ address: testTreasuryAddress, isDefault: true }));

    await app.request("/admin/treasury-wallets", {
      method: "PUT",
      headers: adminHeaders(),
      body: JSON.stringify({ network: "ethereum", token: "USDT", address: altTreasuryAddress })
    });

    const secondList = await app.request("/v1/treasury-wallets?network=ethereum&token=USDT", {
      headers: signedHeaders({
        apiKey: apiKey.apiKey,
        apiSecret: apiKey.apiSecret,
        method: "GET",
        path: "/v1/treasury-wallets?network=ethereum&token=USDT"
      })
    });
    const secondListBody = (await secondList.json()) as {
      treasuryWallets: Array<{ id: string; address: string; isDefault: boolean }>;
    };
    expect(secondListBody.treasuryWallets).toHaveLength(2);
    expect(secondListBody.treasuryWallets[0]).toEqual(expect.objectContaining({
      address: altTreasuryAddress,
      isDefault: true
    }));

    const body = depositBody({
      network: "ethereum",
      token: "USDT",
      treasuryWalletId: firstTreasury.id,
      callbackUrl: "https://example.com/non-default-callback",
      callbackSecret: "non-default-callback-secret"
    });
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
    const depositAddress = (await response.json()) as DepositAddressResponse;
    expect(response.status).toBe(201);
    expect(depositAddress.treasuryWalletId).toBe(firstTreasury.id);

    const callbacks = await repo.listDueWebhookEvents(new Date(), 10);
    expect(callbacks.at(-1)).toEqual(
      expect.objectContaining({
        type: "wallet.created",
        payload: expect.objectContaining({
          data: expect.objectContaining({
            treasuryWallet: testTreasuryAddress,
            treasuryWalletId: firstTreasury.id
          })
        })
      })
    );
  });

  it("creates direct treasury requests and selects the least-pending treasury", async () => {
    const { app, apiKey } = await setupApi();
    const altTreasuryAddress = "0x0000000000000000000000000000000000000abe";
    await app.request("/admin/treasury-wallets", {
      method: "PUT",
      headers: adminHeaders(),
      body: JSON.stringify({ network: "ethereum", token: "USDT", address: altTreasuryAddress })
    });

    const firstBody = depositBody({
      network: "ethereum",
      token: "USDT",
      flow: "direct_treasury",
      amount: "100",
      callbackUrl: "https://example.com/direct-1-callback",
      callbackSecret: "direct-1-callback-secret"
    });
    const first = await app.request("/v1/deposit-addresses", {
      method: "POST",
      headers: signedHeaders({
        apiKey: apiKey.apiKey,
        apiSecret: apiKey.apiSecret,
        method: "POST",
        path: "/v1/deposit-addresses",
        body: firstBody
      }),
      body: firstBody
    });
    const firstRequest = (await first.json()) as DepositAddressResponse;

    const secondBody = depositBody({
      network: "ethereum",
      token: "USDT",
      flow: "direct_treasury",
      amount: "50",
      callbackUrl: "https://example.com/direct-2-callback",
      callbackSecret: "direct-2-callback-secret"
    });
    const second = await app.request("/v1/deposit-addresses", {
      method: "POST",
      headers: signedHeaders({
        apiKey: apiKey.apiKey,
        apiSecret: apiKey.apiSecret,
        method: "POST",
        path: "/v1/deposit-addresses",
        body: secondBody
      }),
      body: secondBody
    });
    const secondRequest = (await second.json()) as DepositAddressResponse;

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(firstRequest.flow).toBe("direct_treasury");
    expect(firstRequest.requestedAmountFormatted).toBe("100");
    expect(firstRequest.matchStatus).toBe("pending");
    expect(secondRequest.treasuryWalletId).not.toBe(firstRequest.treasuryWalletId);
  });

  it("requires amount for direct treasury requests", async () => {
    const { app, apiKey } = await setupApi();
    const body = depositBody({
      network: "ethereum",
      token: "USDT",
      flow: "direct_treasury",
      callbackUrl: "https://example.com/direct-missing-callback",
      callbackSecret: "direct-missing-callback-secret"
    });
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

    expect(response.status).toBe(422);
  });

  it("allows merchants to manually match unmatched treasury transfers to direct requests", async () => {
    const { app, apiKey, repo } = await setupApi();
    const body = depositBody({
      network: "ethereum",
      token: "USDT",
      flow: "direct_treasury",
      amount: "100",
      callbackUrl: "https://example.com/direct-manual-callback",
      callbackSecret: "direct-manual-callback-secret"
    });
    const direct = await app.request("/v1/deposit-addresses", {
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
    const directRequest = (await direct.json()) as DepositAddressResponse;
    const merchantId = (await repo.getApiKeyByPublicKey(apiKey.apiKey))?.merchantId;
    if (!merchantId) {
      throw new Error("Expected merchant id");
    }
    const { transfer: treasuryTransfer } = await repo.createTreasuryTransferIfNotExists({
      id: crypto.randomUUID(),
      merchantId,
      treasuryWalletId: directRequest.treasuryWalletId,
      network: "ethereum",
      token: "USDT",
      txHash: `0x${"8".repeat(64)}`,
      logIndex: 0,
      fromAddress: "0x0000000000000000000000000000000000000def",
      toAddress: directRequest.address,
      amountRaw: "80000000",
      amountFormatted: "80",
      blockNumber: 100n,
      blockHash: `0x${"9".repeat(64)}`,
      confirmations: 12,
      status: "unmatched",
      candidateDepositAddressIds: []
    });
    const matchBody = JSON.stringify({ depositAddressId: directRequest.id });
    const response = await app.request(`/v1/treasury-transfers/${treasuryTransfer.id}/match`, {
      method: "POST",
      headers: signedHeaders({
        apiKey: apiKey.apiKey,
        apiSecret: apiKey.apiSecret,
        method: "POST",
        path: `/v1/treasury-transfers/${treasuryTransfer.id}/match`,
        body: matchBody
      }),
      body: matchBody
    });
    const result = (await response.json()) as { depositAddress: DepositAddressResponse; transfer: { status: string; amountFormatted: string } };

    expect(response.status).toBe(200);
    expect(result.depositAddress.matchStatus).toBe("matched");
    expect(result.depositAddress.receivedAmountFormatted).toBe("80");
    expect(result.transfer.status).toBe("confirmed");
  });

  it("rejects treasury IDs that do not match the requested asset", async () => {
    const repo = new MemoryRepository();
    const networks = createTestNetworks({
      tokens: {
        USDT: {
          symbol: "USDT",
          contractAddress: testTokenAddress,
          decimals: 6
        },
        USDC: {
          symbol: "USDC",
          contractAddress: "0x0000000000000000000000000000000000000002",
          decimals: 6
        }
      }
    });
    const config = createTestConfig({ networks });
    const app = createApp({ repo, config, chainProvider: new MockChainProvider() });

    const apiKeyResponse = await app.request("/admin/api-keys", {
      method: "POST",
      headers: adminHeaders()
    });
    const apiKey = (await apiKeyResponse.json()) as ApiKeyResponse;

    await app.request("/admin/treasury-wallets", {
      method: "PUT",
      headers: adminHeaders(),
      body: JSON.stringify({ network: "ethereum", token: "USDT", address: testTreasuryAddress })
    });

    const treasuryList = await app.request("/v1/treasury-wallets?network=ethereum&token=USDT", {
      headers: signedHeaders({
        apiKey: apiKey.apiKey,
        apiSecret: apiKey.apiSecret,
        method: "GET",
        path: "/v1/treasury-wallets?network=ethereum&token=USDT"
      })
    });
    const treasuryBody = (await treasuryList.json()) as { treasuryWallets: Array<{ id: string }> };
    const treasury = treasuryBody.treasuryWallets[0];
    if (!treasury) {
      throw new Error("Expected treasury wallet");
    }

    const body = depositBody({
      network: "ethereum",
      token: "USDC",
      treasuryWalletId: treasury.id,
      callbackUrl: "https://example.com/mismatch-callback",
      callbackSecret: "mismatch-callback-secret"
    });
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
    const result = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(422);
    expect(result.error.code).toBe("treasury_wallet_mismatch");
  });

  it("rejects deposit address creation when the gas wallet is not configured", async () => {
    const config = createTestConfig({
      networks: createTestNetworks({ gasWalletPrivateKey: undefined })
    });
    const { app, apiKey, repo } = await setupApi({ config });
    const body = depositBody({
      network: "ethereum",
      token: "USDT",
      callbackUrl: "https://example.com/missing-gas-callback",
      callbackSecret: "missing-gas-callback-secret"
    });
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
    const result = (await response.json()) as { error: { code: string; message: string } };

    expect(response.status).toBe(422);
    expect(result.error.code).toBe("gas_wallet_missing");
    expect(result.error.message).toContain("Gas wallet must be configured");
    expect(await repo.listDepositAddresses({ merchantId: config.ownerAccountId, limit: 10 })).toHaveLength(0);
  });

  it("rejects deposit address creation when the gas top-up is below the minimum threshold", async () => {
    const config = createTestConfig({
      networks: createTestNetworks({
        minGasWei: 10_000n,
        gasTopUpWei: 5_000n
      })
    });
    const { app, apiKey } = await setupApi({ config });
    const body = depositBody({
      network: "ethereum",
      token: "USDT",
      callbackUrl: "https://example.com/low-top-up-callback",
      callbackSecret: "low-top-up-callback-secret"
    });
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
    const result = (await response.json()) as {
      error: { code: string; details: { minGasWei: string; gasTopUpWei: string } };
    };

    expect(response.status).toBe(422);
    expect(result.error.code).toBe("gas_top_up_below_minimum");
    expect(result.error.details).toEqual(expect.objectContaining({
      minGasWei: "10000",
      gasTopUpWei: "5000"
    }));
  });

  it("rejects deposit address creation when the gas wallet balance is too low", async () => {
    const chainProvider = new MockChainProvider();
    chainProvider.nativeBalance = 4_999_999_999_999_999n;
    const { app, apiKey } = await setupApi({ chainProvider });
    const body = depositBody({
      network: "ethereum",
      token: "USDT",
      callbackUrl: "https://example.com/low-gas-callback",
      callbackSecret: "low-gas-callback-secret"
    });
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
    const result = (await response.json()) as {
      error: { code: string; details: { balanceWei: string; requiredWei: string } };
    };

    expect(response.status).toBe(422);
    expect(result.error.code).toBe("gas_wallet_insufficient_balance");
    expect(result.error.details).toEqual(expect.objectContaining({
      balanceWei: "4999999999999999",
      requiredWei: "5000000000000000"
    }));
  });

  it("returns all missing deposit configuration issues before creating a deposit address", async () => {
    const repo = new MemoryRepository();
    const config = createTestConfig({
      networks: createTestNetworks({
        gasWalletPrivateKey: undefined,
        minGasWei: 0n,
        gasTopUpWei: 0n,
        maxScanBlocks: 0n
      })
    });
    const app = createApp({ repo, config, chainProvider: new MockChainProvider() });
    const apiKeyResponse = await app.request("/admin/api-keys", {
      method: "POST",
      headers: adminHeaders()
    });
    const apiKey = (await apiKeyResponse.json()) as ApiKeyResponse;
    const body = depositBody({
      network: "ethereum",
      token: "USDT",
      callbackUrl: "https://example.com/missing-config-callback",
      callbackSecret: "missing-config-callback-secret"
    });
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
    const result = (await response.json()) as {
      error: { code: string; details: { issues: Array<{ code: string }> } };
    };

    expect(response.status).toBe(422);
    expect(result.error.code).toBe("deposit_configuration_incomplete");
    expect(result.error.details.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "treasury_wallet_missing",
        "worker_scan_window_invalid",
        "minimum_gas_not_configured",
        "gas_top_up_not_configured",
        "gas_wallet_missing"
      ])
    );
    expect(await repo.listDepositAddresses({ merchantId: config.ownerAccountId, limit: 10 })).toHaveLength(0);
  });

  it("rejects deposit address creation when worker RPC connectivity cannot be verified", async () => {
    const chainProvider = new MockChainProvider();
    chainProvider.failLatestBlock = true;
    const { app, apiKey } = await setupApi({ chainProvider });
    const body = depositBody({
      network: "ethereum",
      token: "USDT",
      callbackUrl: "https://example.com/rpc-unavailable-callback",
      callbackSecret: "rpc-unavailable-callback-secret"
    });
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
    const result = (await response.json()) as { error: { code: string; details: { reason: string } } };

    expect(response.status).toBe(422);
    expect(result.error.code).toBe("network_rpc_unavailable");
    expect(result.error.details.reason).toBe("mock latest block failed");
  });

  it("rejects deposit address creation when the token contract cannot be read", async () => {
    const chainProvider = new MockChainProvider();
    chainProvider.failTokenBalance = true;
    const { app, apiKey } = await setupApi({ chainProvider });
    const body = depositBody({
      network: "ethereum",
      token: "USDT",
      callbackUrl: "https://example.com/token-unavailable-callback",
      callbackSecret: "token-unavailable-callback-secret"
    });
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
    const result = (await response.json()) as { error: { code: string; details: { reason: string } } };

    expect(response.status).toBe(422);
    expect(result.error.code).toBe("token_contract_unavailable");
    expect(result.error.details.reason).toBe("mock token balance failed");
  });

  it("rejects reused nonces and unsupported assets", async () => {
    const { app, apiKey } = await setupApi();
    const body = depositBody({
      network: "ethereum",
      token: "USDC",
      callbackUrl: "https://example.com/unsupported-callback",
      callbackSecret: "unsupported-callback-secret"
    });
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
    const body = depositBody({
      network: "tron",
      token: "USDT",
      callbackUrl: "https://example.com/tron-callback",
      callbackSecret: "tron-callback-secret",
      ttlSeconds: 3600
    });
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
    chainProvider.nativeBalance = 0n;
    const app = createApp({ repo, config, chainProvider });
    const login = await app.request("/dashboard/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "wrong-password" })
    });

    expect(login.status).toBe(401);
    const token = await dashboardToken(app);
    const dashboardApiKey = await app.request("/dashboard/api/api-keys", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({})
    });
    expect(dashboardApiKey.status).toBe(201);
    const dashboardApiKeyBody = (await dashboardApiKey.json()) as ApiKeyResponse;
    expect(dashboardApiKeyBody.apiSecret).toEqual(expect.any(String));

    const dashboardWebhook = await app.request("/dashboard/api/webhook", {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/dashboard-webhook" })
    });
    expect(dashboardWebhook.status).toBe(200);
    const dashboardWebhookBody = (await dashboardWebhook.json()) as { webhookSecret: string };
    expect(dashboardWebhookBody.webhookSecret).toMatch(/^whsec_/);

    const rotatedWebhook = await app.request("/dashboard/api/webhook", {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/dashboard-webhook", rotateSecret: true })
    });
    expect(rotatedWebhook.status).toBe(200);
    const rotatedWebhookBody = (await rotatedWebhook.json()) as { webhookSecret: string };
    expect(rotatedWebhookBody.webhookSecret).toMatch(/^whsec_/);
    expect(rotatedWebhookBody.webhookSecret).not.toBe(dashboardWebhookBody.webhookSecret);

    const notificationPreferences = await app.request("/dashboard/api/notification-preferences", {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ enabledEvents: ["wallet.created", "deposit.confirmed"] })
    });
    expect(notificationPreferences.status).toBe(200);
    expect(await notificationPreferences.json()).toEqual(expect.objectContaining({
      enabledEvents: ["wallet.created", "deposit.confirmed"]
    }));

    const gasWallet = await app.request("/dashboard/api/wallets/gas", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ network: "ethereum" })
    });
    expect(gasWallet.status).toBe(201);

    const treasuryWallet = await app.request("/dashboard/api/wallets/treasury", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ network: "ethereum", token: "USDT" })
    });
    expect(treasuryWallet.status).toBe(201);
    const treasuryBody = (await treasuryWallet.json()) as { operationalWallet: { id: string; privateKey?: string } };
    expect(treasuryBody.operationalWallet.privateKey).toBeUndefined();

    const registeredTreasury = await app.request("/dashboard/api/treasury-wallets", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        network: "ethereum",
        token: "USDT",
        address: "0x0000000000000000000000000000000000000abe",
        label: "External settlement treasury"
      })
    });
    expect(registeredTreasury.status).toBe(200);
    const registeredTreasuryBody = (await registeredTreasury.json()) as { id: string; isDefault: boolean; label: string };
    expect(registeredTreasuryBody.isDefault).toBe(false);

    const defaultTreasury = await app.request(`/dashboard/api/treasury-wallets/${registeredTreasuryBody.id}/default`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({})
    });
    expect(defaultTreasury.status).toBe(200);
    expect(await defaultTreasury.json()).toEqual(expect.objectContaining({
      id: registeredTreasuryBody.id,
      isDefault: true,
      label: "External settlement treasury"
    }));

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
      webhookConfig: { url: string; active: boolean };
      notificationPreferences: { enabledEvents: unknown[] };
      treasuryWallets: unknown[];
      operationalWallets: unknown[];
      walletTransactions: unknown[];
    };
    expect(dataBody.apiKeys).toHaveLength(1);
    expect(dataBody.webhookConfig).toEqual(expect.objectContaining({
      url: "https://example.com/dashboard-webhook",
      active: true
    }));
    expect(dataBody.notificationPreferences.enabledEvents).toEqual(["wallet.created", "deposit.confirmed"]);
    expect(dataBody.treasuryWallets).toHaveLength(2);
    expect(dataBody.operationalWallets).toHaveLength(2);
    expect(dataBody.walletTransactions).toHaveLength(1);

    const overview = await app.request("/dashboard/api/overview", {
      headers: { authorization: `Bearer ${token}` }
    });
    const overviewBody = (await overview.json()) as { charts: { depositTrend: unknown[]; walletTransactionStatus: unknown[] } };
    expect(overview.status).toBe(200);
    expect(overviewBody.charts.depositTrend).toHaveLength(14);
    expect(overviewBody.charts.walletTransactionStatus).toEqual([{ name: "submitted", value: 1 }]);

    const history = await app.request("/dashboard/api/history?resource=walletTransactions&limit=1&offset=0&status=submitted&q=4444", {
      headers: { authorization: `Bearer ${token}` }
    });
    const historyBody = (await history.json()) as { total: number; items: unknown[]; nextOffset: number | null };
    expect(history.status).toBe(200);
    expect(historyBody.total).toBe(1);
    expect(historyBody.items).toHaveLength(1);
    expect(historyBody.nextOffset).toBeNull();
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
    const treasuryWallet = await app.request("/dashboard/api/wallets/treasury", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ network: "ethereum", token: "USDT" })
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
