import { describe, expect, it } from "vitest";
import { createApp } from "../src/api/app.js";
import { MemoryRepository } from "../src/repositories/memory.js";
import { adminHeaders, createTestConfig, signedHeaders, testTreasuryAddress } from "./helpers.js";

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
});
