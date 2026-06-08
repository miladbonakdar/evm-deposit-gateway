import { randomBytes } from "node:crypto";
import { mainnet } from "viem/chains";
import type { AppConfig } from "../src/config/env.js";
import type { SupportedNetworks } from "../src/config/networks.js";
import { Encryptor } from "../src/security/encryption.js";
import { signRequest } from "../src/security/hmac.js";

export const testAdminApiKey = "test-admin-api-key-1234567890";
export const testTreasuryAddress = "0x0000000000000000000000000000000000000abc";
export const testTokenAddress = "0x0000000000000000000000000000000000000001";
export const testGasPrivateKey = `0x${"0123456789abcdef".repeat(4)}`;
export const testTronTreasuryAddress = "TFsyngiXwzZE5NqQmAwZ421bTRLyAvJANi";
export const testTronTokenAddress = "TMAsPnWJUfj58iEPn55V8efb2FAWskrwDw";

export function createTestEncryptor(): Encryptor {
  return new Encryptor(randomBytes(32));
}

export function createTestNetworks(overrides: Partial<SupportedNetworks["ethereum"]> = {}): SupportedNetworks {
  return {
    ethereum: {
      slug: "ethereum",
      kind: "evm",
      chain: mainnet,
      chainId: mainnet.id,
      rpcUrl: "http://localhost:8545",
      confirmations: 12,
      scanFromBlock: 0n,
      maxScanBlocks: 1000n,
      gasWalletPrivateKey: testGasPrivateKey,
      minGasWei: 2_000_000_000_000_000n,
      gasTopUpWei: 5_000_000_000_000_000n,
      tokens: {
        USDT: {
          symbol: "USDT",
          contractAddress: testTokenAddress,
          decimals: 6
        },
        USDC: undefined
      },
      ...overrides
    },
    bsc: undefined,
    polygon: undefined,
    arbitrum: undefined,
    optimism: undefined,
    base: undefined,
    sepolia: undefined,
    bscTestnet: undefined,
    polygonAmoy: undefined,
    arbitrumSepolia: undefined,
    optimismSepolia: undefined,
    baseSepolia: undefined,
    tron: undefined,
    nile: undefined
  };
}

export function createTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: "test",
    port: 3000,
    databaseUrl: "postgres://postgres:postgres@localhost:5432/crypto_payment_test",
    networkConfigPath: "config/networks.example.json",
    adminApiKey: testAdminApiKey,
    ownerMerchantId: "00000000-0000-4000-8000-000000000001",
    ownerMerchantName: "Owner",
    adminDashboardUsername: "admin",
    adminDashboardPassword: "test-dashboard-password",
    adminSessionSecret: "test-dashboard-session-secret-123456",
    adminSessionTtlSeconds: 28_800,
    encryptor: createTestEncryptor(),
    requestMaxSkewSeconds: 300,
    webhookTimeoutMs: 1000,
    webhookMaxAttempts: 5,
    webhookBaseRetrySeconds: 1,
    webhookMaxRetryDelaySeconds: 86_400,
    workerPollIntervalMs: 1000,
    networks: createTestNetworks(),
    ...overrides
  };
}

export function adminHeaders() {
  return { authorization: `Bearer ${testAdminApiKey}`, "content-type": "application/json" };
}

export function signedHeaders({
  apiKey,
  apiSecret,
  method,
  path,
  body = "",
  nonce = `nonce-${crypto.randomUUID()}`,
  timestamp = Math.floor(Date.now() / 1000).toString()
}: {
  apiKey: string;
  apiSecret: string;
  method: string;
  path: string;
  body?: string;
  nonce?: string;
  timestamp?: string;
}) {
  const signature = signRequest(apiSecret, {
    method,
    pathWithQuery: path,
    timestamp,
    nonce,
    body
  });

  return {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "x-timestamp": timestamp,
    "x-nonce": nonce,
    "x-signature": `sha256=${signature}`
  };
}
