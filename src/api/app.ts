import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { Hono, type Context } from "hono";
import { ZodError } from "zod";
import type { AppConfig } from "../config/env.js";
import { enabledNetworks, enabledTokens } from "../config/networks.js";
import { AppError } from "../errors.js";
import { constantTimeStringEqual, createAdminSessionToken } from "../security/admin-session.js";
import { sha256Hex } from "../security/hmac.js";
import { DashboardService } from "../services/dashboard-service.js";
import { DepositService } from "../services/deposit-service.js";
import { MerchantService } from "../services/merchant-service.js";
import { DefaultWebhookService } from "../services/webhook-service.js";
import type { Repository } from "../repositories/repository.js";
import type { ChainProvider } from "../worker/chain-provider.js";
import { ViemEvmProvider } from "../worker/evm-provider.js";
import { MultiChainProvider } from "../worker/multi-chain-provider.js";
import { TronProvider } from "../worker/tron-provider.js";
import { buildOpenApiSpec } from "./openapi.js";
import {
  adminAuthMiddleware,
  dashboardAuthMiddleware,
  merchantAuthMiddleware,
  parseJson,
  type AppVariables
} from "./middleware.js";
import {
  configureTreasuryWalletSchema,
  configureWebhookSchema,
  createDepositAddressSchema,
  createWalletTransactionSchema,
  dashboardListQuerySchema,
  dashboardHistoryQuerySchema,
  dashboardLoginSchema,
  createMerchantSchema,
  generateGasWalletSchema,
  generateTreasuryWalletSchema,
  listDepositsQuerySchema,
  registerTreasuryWalletSchema
} from "./schemas.js";

export interface CreateAppDependencies {
  repo: Repository;
  config: AppConfig;
  chainProvider?: ChainProvider;
}

export function createApp({ repo, config, chainProvider: suppliedChainProvider }: CreateAppDependencies) {
  const app = new Hono<{ Variables: AppVariables }>();
  const webhookService = new DefaultWebhookService(repo, config.encryptor);
  const merchantService = new MerchantService(repo, config.encryptor, config.networks);
  const depositService = new DepositService(repo, config.encryptor, config.networks, webhookService);
  const chainProvider = suppliedChainProvider ?? new MultiChainProvider(new ViemEvmProvider(), new TronProvider());
  const dashboardService = new DashboardService(repo, config.encryptor, config.networks, chainProvider);

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

  app.post("/dashboard/api/login", async (c) => {
    const body = await parseJson(c, dashboardLoginSchema);
    const usernameMatches = constantTimeStringEqual(body.username, config.adminDashboardUsername);
    const passwordMatches = constantTimeStringEqual(body.password, config.adminDashboardPassword);

    if (!usernameMatches || !passwordMatches) {
      return c.json({ error: { code: "invalid_login", message: "Invalid dashboard username or password" } }, 401);
    }

    const token = createAdminSessionToken(
      config.adminDashboardUsername,
      config.adminSessionSecret,
      config.adminSessionTtlSeconds
    );
    return c.json({
      token,
      expiresInSeconds: config.adminSessionTtlSeconds,
      user: { username: config.adminDashboardUsername }
    });
  });

  app.use("/dashboard/api/*", dashboardAuthMiddleware(config));

  app.get("/dashboard/api/session", (c) => {
    const session = c.get("adminSession");
    return c.json({ user: { username: session.sub }, expiresAt: new Date(session.exp * 1000).toISOString() });
  });

  app.get("/dashboard/api/overview", async (c) => c.json(await dashboardService.getOverview()));

  app.get("/dashboard/api/data", async (c) => {
    const query = dashboardListQuerySchema.parse({ limit: c.req.query("limit") });
    return c.json(await dashboardService.listDashboardData(query.limit));
  });

  app.get("/dashboard/api/history", async (c) => {
    const query = dashboardHistoryQuerySchema.parse({
      resource: c.req.query("resource"),
      limit: c.req.query("limit"),
      offset: c.req.query("offset"),
      status: c.req.query("status"),
      network: c.req.query("network"),
      token: c.req.query("token"),
      q: c.req.query("q")
    });
    return c.json(await dashboardService.getHistory(query));
  });

  app.post("/dashboard/api/merchants", async (c) => {
    const body = await parseJson(c, createMerchantSchema);
    const merchant = await merchantService.createMerchant(body.name);
    return c.json(
      {
        id: merchant.id,
        name: merchant.name,
        status: merchant.status,
        createdAt: merchant.createdAt.toISOString(),
        updatedAt: merchant.updatedAt.toISOString()
      },
      201
    );
  });

  app.post("/dashboard/api/merchants/:merchantId/api-keys", async (c) => {
    const result = await merchantService.createApiKey(c.req.param("merchantId"));
    return c.json(result, 201);
  });

  app.put("/dashboard/api/merchants/:merchantId/webhook", async (c) => {
    const body = await parseJson(c, configureWebhookSchema);
    return c.json(await merchantService.configureWebhook(c.req.param("merchantId"), body.url, body.secret, body.active));
  });

  app.post("/dashboard/api/wallets/gas", async (c) => {
    const body = await parseJson(c, generateGasWalletSchema);
    return c.json(await dashboardService.generateGasWallet(body), 201);
  });

  app.post("/dashboard/api/wallets/treasury", async (c) => {
    const body = await parseJson(c, generateTreasuryWalletSchema);
    return c.json(await dashboardService.generateTreasuryWallet(body), 201);
  });

  app.post("/dashboard/api/treasury-wallets", async (c) => {
    const body = await parseJson(c, registerTreasuryWalletSchema);
    return c.json(await dashboardService.registerTreasuryWallet(body));
  });

  app.post("/dashboard/api/wallet-transactions", async (c) => {
    const body = await parseJson(c, createWalletTransactionSchema);
    return c.json(await dashboardService.createWalletTransaction(body), 201);
  });

  app.all("/dashboard/api/*", (c) => c.json({ error: { code: "not_found", message: "Dashboard API route not found" } }, 404));

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

  app.get("/dashboard/assets/*", (c) => serveDashboardFile(c));
  app.get("/dashboard", (c) => serveDashboardIndex(c));
  app.get("/dashboard/*", (c) => serveDashboardIndex(c));

  return app;
}

const dashboardRoot = join(process.cwd(), "public", "dashboard");

async function serveDashboardFile(c: Context): Promise<Response> {
  const url = new URL(c.req.url);
  const relativePath = url.pathname.replace(/^\/dashboard\//, "");
  const filePath = normalize(join(dashboardRoot, relativePath));

  if (!filePath.startsWith(`${dashboardRoot}${sep}`)) {
    return c.text("Not found", 404);
  }

  return serveFile(c, filePath);
}

async function serveDashboardIndex(c: Context): Promise<Response> {
  return serveFile(c, join(dashboardRoot, "index.html"));
}

async function serveFile(c: Context, filePath: string): Promise<Response> {
  try {
    const body = await readFile(filePath);
    return c.body(body, 200, { "content-type": contentType(filePath) });
  } catch {
    return c.text("Dashboard build not found. Run npm run build:dashboard.", 404);
  }
}

function contentType(filePath: string): string {
  switch (extname(filePath)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}
