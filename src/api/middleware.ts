import { timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import type { AppConfig } from "../config/env.js";
import { badRequest, forbidden, unauthorized } from "../errors.js";
import { buildCanonicalRequest, signCanonicalRequest, timingSafeEqualHex } from "../security/hmac.js";
import type { AuthenticatedMerchant } from "../types/domain.js";
import type { Repository } from "../repositories/repository.js";

export interface AppVariables {
  auth: AuthenticatedMerchant;
  rawBody: Buffer;
}

function constantTimeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function adminAuthMiddleware(adminApiKey: string): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (c, next) => {
    const authorization = c.req.header("authorization");
    const headerKey = c.req.header("x-admin-api-key");
    const bearerKey = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
    const supplied = headerKey ?? bearerKey;

    if (!supplied || !constantTimeStringEqual(supplied, adminApiKey)) {
      throw unauthorized("invalid_admin_api_key", "Missing or invalid admin API key");
    }

    await next();
  };
}

export function merchantAuthMiddleware(
  repo: Repository,
  config: Pick<AppConfig, "encryptor" | "requestMaxSkewSeconds">
): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (c, next) => {
    const publicKey = c.req.header("x-api-key");
    const timestamp = c.req.header("x-timestamp");
    const nonce = c.req.header("x-nonce");
    const signature = c.req.header("x-signature");

    if (!publicKey || !timestamp || !nonce || !signature) {
      throw unauthorized("missing_signature_headers", "Missing merchant authentication headers");
    }

    const timestampSeconds = Number(timestamp);
    if (!Number.isInteger(timestampSeconds)) {
      throw unauthorized("invalid_timestamp", "X-Timestamp must be a Unix timestamp in seconds");
    }

    const skew = Math.abs(Date.now() / 1000 - timestampSeconds);
    if (skew > config.requestMaxSkewSeconds) {
      throw unauthorized("stale_request", "Request timestamp is outside the accepted window");
    }

    const apiKey = await repo.getApiKeyByPublicKey(publicKey);
    if (!apiKey || apiKey.status !== "active") {
      throw unauthorized("invalid_api_key", "Invalid API key");
    }

    const merchant = await repo.getMerchant(apiKey.merchantId);
    if (!merchant || merchant.status !== "active") {
      throw forbidden("merchant_disabled", "Merchant is disabled");
    }

    const rawBody = Buffer.from(await c.req.raw.clone().arrayBuffer());
    const url = new URL(c.req.url);
    const canonical = buildCanonicalRequest({
      method: c.req.method,
      pathWithQuery: `${url.pathname}${url.search}`,
      timestamp,
      nonce,
      body: rawBody
    });
    const expectedSignature = signCanonicalRequest(config.encryptor.decryptString(apiKey.secretEncrypted), canonical);

    if (!timingSafeEqualHex(signature, expectedSignature)) {
      throw unauthorized("invalid_signature", "Invalid request signature");
    }

    const inserted = await repo.insertRequestNonce(apiKey.id, nonce, new Date(timestampSeconds * 1000));
    if (!inserted) {
      throw unauthorized("replayed_request", "Request nonce has already been used");
    }

    await repo.updateApiKeyLastUsed(apiKey.id, new Date());
    c.set("auth", { merchant, apiKey });
    c.set("rawBody", rawBody);
    await next();
  };
}

export async function parseJson<T>(c: Context, schema: { parse(input: unknown): T }): Promise<T> {
  const body = await c.req.json().catch(() => {
    throw badRequest("invalid_json", "Expected a JSON request body");
  });
  return schema.parse(body);
}
