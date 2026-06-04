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
