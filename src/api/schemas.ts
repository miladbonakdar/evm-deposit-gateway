import { z } from "zod";
import { networkSchema, tokenSchema } from "../config/networks.js";

export const createMerchantSchema = z.object({
  name: z.string().trim().min(1).max(120)
});

export const configureWebhookSchema = z.object({
  url: z.string().url(),
  secret: z.string().min(16).max(256).optional(),
  active: z.boolean().default(true)
});

export const configureTreasuryWalletSchema = z.object({
  network: networkSchema,
  token: tokenSchema,
  address: z.string().min(1)
});

export const dashboardLoginSchema = z.object({
  username: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(512)
});

export const dashboardListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(250)
});

export const dashboardHistoryQuerySchema = z.object({
  resource: z.enum(["depositAddresses", "deposits", "walletTransactions", "gasTopUps", "sweeps", "webhooks"]),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.string().trim().min(1).max(40).optional(),
  network: networkSchema.optional(),
  token: tokenSchema.optional(),
  q: z.string().trim().min(1).max(160).optional()
});

export const generateGasWalletSchema = z.object({
  network: networkSchema,
  label: z.string().trim().min(1).max(120).optional()
});

export const generateTreasuryWalletSchema = z.object({
  merchantId: z.string().uuid(),
  network: networkSchema,
  token: tokenSchema,
  label: z.string().trim().min(1).max(120).optional()
});

export const registerTreasuryWalletSchema = z.object({
  merchantId: z.string().uuid(),
  network: networkSchema,
  token: tokenSchema,
  address: z.string().min(1)
});

export const createWalletTransactionSchema = z.object({
  sourceWalletId: z.string().uuid(),
  asset: z.enum(["NATIVE", "USDT", "USDC"]),
  toAddress: z.string().min(1),
  amount: z.string().trim().regex(/^\d+(\.\d+)?$/, "Amount must be a positive decimal string")
});

export const createDepositAddressSchema = z.object({
  network: networkSchema,
  token: tokenSchema,
  ttlSeconds: z.number().int().min(60).max(2_592_000).optional(),
  externalId: z.string().trim().min(1).max(128).optional(),
  metadata: z.record(z.unknown()).default({}),
  qrFormat: z.enum(["none", "pngDataUrl", "svg", "base64"]).default("none")
});

export const listDepositsQuerySchema = z.object({
  status: z.enum(["detected", "confirmed", "late"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});
