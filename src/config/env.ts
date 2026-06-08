import { z } from "zod";
import { createEncryptorFromBase64, type Encryptor } from "../security/encryption.js";
import { loadSupportedNetworks, type SupportedNetworks } from "./networks.js";

const appEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  NETWORK_CONFIG_PATH: z.string().trim().min(1).default("config/networks.example.json"),
  ADMIN_API_KEY: z.string().min(24, "ADMIN_API_KEY must be at least 24 characters"),
  OWNER_MERCHANT_ID: z.string().uuid().default("00000000-0000-4000-8000-000000000001"),
  OWNER_MERCHANT_NAME: z.string().trim().min(1).max(120).default("Owner"),
  ADMIN_DASHBOARD_USERNAME: z.string().trim().min(1).max(120),
  ADMIN_DASHBOARD_PASSWORD: z.string().min(12, "ADMIN_DASHBOARD_PASSWORD must be at least 12 characters"),
  ADMIN_SESSION_SECRET: z.string().min(32, "ADMIN_SESSION_SECRET must be at least 32 characters"),
  ADMIN_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(28_800),
  ENCRYPTION_MASTER_KEY_BASE64: z.string().min(1),
  REQUEST_MAX_SKEW_SECONDS: z.coerce.number().int().positive().default(300),
  WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  WEBHOOK_BASE_RETRY_SECONDS: z.coerce.number().int().positive().default(5),
  WEBHOOK_MAX_RETRY_DELAY_SECONDS: z.coerce.number().int().positive().default(86_400),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(15000)
});

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  networkConfigPath: string;
  adminApiKey: string;
  ownerMerchantId: string;
  ownerMerchantName: string;
  adminDashboardUsername: string;
  adminDashboardPassword: string;
  adminSessionSecret: string;
  adminSessionTtlSeconds: number;
  encryptor: Encryptor;
  requestMaxSkewSeconds: number;
  webhookTimeoutMs: number;
  webhookMaxAttempts: number;
  webhookBaseRetrySeconds: number;
  webhookMaxRetryDelaySeconds: number;
  workerPollIntervalMs: number;
  networks: SupportedNetworks;
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = appEnvSchema.parse(env);
  const encryptor = createEncryptorFromBase64(parsed.ENCRYPTION_MASTER_KEY_BASE64);

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    networkConfigPath: parsed.NETWORK_CONFIG_PATH,
    adminApiKey: parsed.ADMIN_API_KEY,
    ownerMerchantId: parsed.OWNER_MERCHANT_ID,
    ownerMerchantName: parsed.OWNER_MERCHANT_NAME,
    adminDashboardUsername: parsed.ADMIN_DASHBOARD_USERNAME,
    adminDashboardPassword: parsed.ADMIN_DASHBOARD_PASSWORD,
    adminSessionSecret: parsed.ADMIN_SESSION_SECRET,
    adminSessionTtlSeconds: parsed.ADMIN_SESSION_TTL_SECONDS,
    encryptor,
    requestMaxSkewSeconds: parsed.REQUEST_MAX_SKEW_SECONDS,
    webhookTimeoutMs: parsed.WEBHOOK_TIMEOUT_MS,
    webhookMaxAttempts: parsed.WEBHOOK_MAX_ATTEMPTS,
    webhookBaseRetrySeconds: parsed.WEBHOOK_BASE_RETRY_SECONDS,
    webhookMaxRetryDelaySeconds: parsed.WEBHOOK_MAX_RETRY_DELAY_SECONDS,
    workerPollIntervalMs: parsed.WORKER_POLL_INTERVAL_MS,
    networks: loadSupportedNetworks(env, parsed.NETWORK_CONFIG_PATH)
  };
}
