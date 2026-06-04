import { Hono } from "hono";
import { ZodError } from "zod";
import type { AppConfig } from "../config/env.js";
import { enabledNetworks, enabledTokens } from "../config/networks.js";
import { AppError } from "../errors.js";
import { sha256Hex } from "../security/hmac.js";
import { DepositService } from "../services/deposit-service.js";
import { MerchantService } from "../services/merchant-service.js";
import { DefaultWebhookService } from "../services/webhook-service.js";
import type { Repository } from "../repositories/repository.js";
import { buildOpenApiSpec } from "./openapi.js";
import {
  adminAuthMiddleware,
  merchantAuthMiddleware,
  parseJson,
  type AppVariables
} from "./middleware.js";
import {
  configureTreasuryWalletSchema,
  configureWebhookSchema,
  createDepositAddressSchema,
  createMerchantSchema,
  listDepositsQuerySchema
} from "./schemas.js";

export interface CreateAppDependencies {
  repo: Repository;
  config: AppConfig;
}

export function createApp({ repo, config }: CreateAppDependencies) {
  const app = new Hono<{ Variables: AppVariables }>();
  const webhookService = new DefaultWebhookService(repo, config.encryptor);
  const merchantService = new MerchantService(repo, config.encryptor, config.networks);
  const depositService = new DepositService(repo, config.encryptor, config.networks, webhookService);

  app.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json({ error: { code: error.code, message: error.message, details: error.details } }, error.status as never);
    }

    if (error instanceof ZodError) {
      return c.json(
        {
          error: {
            code: "validation_error",
            message: "Request validation failed",
            details: error.flatten()
          }
        },
        422
      );
    }

    console.error(error);
    return c.json({ error: { code: "internal_error", message: "Internal server error" } }, 500);
  });

  app.get("/health", (c) => c.json({ status: "ok", uptimeSeconds: Math.round(process.uptime()) }));
  app.get("/openapi.json", (c) => c.json(buildOpenApiSpec(config.networks)));

  app.use("/admin/*", adminAuthMiddleware(config.adminApiKey));

  app.post("/admin/merchants", async (c) => {
    const body = await parseJson(c, createMerchantSchema);
    const merchant = await merchantService.createMerchant(body.name);
    return c.json(
      {
        id: merchant.id,
        name: merchant.name,
        status: merchant.status,
        createdAt: merchant.createdAt.toISOString()
      },
      201
    );
  });

  app.post("/admin/merchants/:merchantId/api-keys", async (c) => {
    const result = await merchantService.createApiKey(c.req.param("merchantId"));
    return c.json(result, 201);
  });

  app.post("/admin/merchants/:merchantId/api-keys/:apiKeyId/rotate", async (c) => {
    const result = await merchantService.rotateApiKey(c.req.param("merchantId"), c.req.param("apiKeyId"));
    return c.json(result);
  });

  app.post("/admin/merchants/:merchantId/api-keys/:apiKeyId/revoke", async (c) => {
    const result = await merchantService.revokeApiKey(c.req.param("merchantId"), c.req.param("apiKeyId"));
    return c.json(result);
  });

  app.put("/admin/merchants/:merchantId/webhook", async (c) => {
    const body = await parseJson(c, configureWebhookSchema);
    const result = await merchantService.configureWebhook(c.req.param("merchantId"), body.url, body.secret, body.active);
    return c.json(result);
  });

  app.put("/admin/merchants/:merchantId/treasury-wallets", async (c) => {
    const body = await parseJson(c, configureTreasuryWalletSchema);
    const result = await merchantService.configureTreasuryWallet(
      c.req.param("merchantId"),
      body.network,
      body.token,
      body.address
    );
    return c.json(result);
  });

  app.get("/admin/networks", (c) => {
    const enabled = enabledNetworks(config.networks)
      .map((network) => ({
        network: network.slug,
        kind: network.kind,
        chainId: network.chainId,
        confirmations: network.confirmations,
        tokens: enabledTokens(network)
          .map((token) => ({
            symbol: token.symbol,
            contractAddress: token.contractAddress,
            decimals: token.decimals
          }))
      }));
    return c.json({ networks: enabled });
  });

  app.use("/v1/*", merchantAuthMiddleware(repo, config));

  app.post("/v1/deposit-addresses", async (c) => {
    const auth = c.get("auth");
    const rawBody = c.get("rawBody");
    const idempotencyKey = c.req.header("idempotency-key");
    const route = "POST /v1/deposit-addresses";
    const requestHash = sha256Hex(rawBody);
    const replay = await depositService.assertIdempotency(auth.merchant.id, route, idempotencyKey, requestHash);

    if (replay.replay) {
      return c.json(replay.response, (replay.status ?? 200) as never);
    }

    const body = createDepositAddressSchema.parse(await c.req.json());
    const response = await depositService.createDepositAddress({
      merchantId: auth.merchant.id,
      network: body.network,
      token: body.token,
      ttlSeconds: body.ttlSeconds,
      externalId: body.externalId,
      metadata: body.metadata,
      qrFormat: body.qrFormat
    });
    await depositService.storeIdempotency(auth.merchant.id, route, idempotencyKey, requestHash, 201, response);

    return c.json(response, 201);
  });

  app.get("/v1/deposit-addresses/:id", async (c) => {
    const auth = c.get("auth");
    return c.json(await depositService.getDepositAddress(auth.merchant.id, c.req.param("id")));
  });

  app.get("/v1/deposits", async (c) => {
    const auth = c.get("auth");
    const query = listDepositsQuerySchema.parse({
      status: c.req.query("status"),
      limit: c.req.query("limit")
    });
    return c.json(await depositService.listDeposits(auth.merchant.id, query.status, query.limit));
  });

  return app;
}
