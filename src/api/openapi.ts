import type { SupportedNetworks } from "../config/networks.js";
import { enabledNetworks, enabledTokens } from "../config/networks.js";

export function buildOpenApiSpec(networks: SupportedNetworks) {
  const enabledAssets = enabledNetworks(networks)
    .flatMap((network) =>
      enabledTokens(network)
        .map((token) => ({
          network: network.slug,
          kind: network.kind,
          token: token.symbol,
          contractAddress: token.contractAddress,
          decimals: token.decimals
        }))
    );

  return {
    openapi: "3.1.0",
    info: {
      title: "Crypto Deposit API",
      version: "0.1.0",
      description: "Temporary USDT/USDC deposit addresses for supported EVM networks."
    },
    security: [{ ClientHmac: [] }],
    components: {
      securitySchemes: {
        AdminBearer: {
          type: "http",
          scheme: "bearer"
        },
        ClientHmac: {
          type: "apiKey",
          in: "header",
          name: "X-Signature",
          description:
            "Send X-Api-Key, X-Timestamp, X-Nonce, and X-Signature. Signature is HMAC-SHA256 over method, path+query, timestamp, nonce, and SHA-256 body hash."
        }
      }
    },
    paths: {
      "/health": {
        get: {
          security: [],
          responses: {
            "200": { description: "Service health" }
          }
        }
      },
      "/admin/owner": {
        get: {
          security: [{ AdminBearer: [] }],
          summary: "Fetch the configured owner account",
          responses: { "200": { description: "Owner account" } }
        }
      },
      "/admin/api-keys": {
        post: {
          security: [{ AdminBearer: [] }],
          summary: "Create owner API key",
          responses: { "201": { description: "API key and one-time secret" } }
        }
      },
      "/admin/api-keys/{apiKeyId}/rotate": {
        post: {
          security: [{ AdminBearer: [] }],
          summary: "Rotate owner API key secret",
          responses: { "200": { description: "API key and one-time secret" } }
        }
      },
      "/admin/api-keys/{apiKeyId}/revoke": {
        post: {
          security: [{ AdminBearer: [] }],
          summary: "Revoke owner API key",
          responses: { "200": { description: "API key status" } }
        }
      },
      "/admin/webhook": {
        put: {
          security: [{ AdminBearer: [] }],
          summary: "Configure fallback owner webhook",
          responses: { "200": { description: "Webhook configuration" } }
        }
      },
      "/admin/treasury-wallets": {
        put: {
          security: [{ AdminBearer: [] }],
          summary: "Configure owner treasury wallet",
          responses: { "200": { description: "Treasury wallet" } }
        }
      },
      "/v1/deposit-addresses": {
        post: {
          summary: "Create a temporary deposit address",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["network", "token", "callbackUrl", "callbackSecret"],
                  properties: {
                    network: { type: "string" },
                    token: { type: "string", enum: ["USDT", "USDC"] },
                    callbackUrl: { type: "string", format: "uri" },
                    callbackSecret: {
                      type: "string",
                      minLength: 16,
                      description: "Per-deposit webhook signing secret. Stored encrypted and never returned."
                    },
                    ttlSeconds: { type: "integer", minimum: 60, maximum: 2592000 },
                    externalId: { type: "string" },
                    metadata: { type: "object" },
                    qrFormat: { type: "string", enum: ["none", "pngDataUrl", "svg", "base64"] }
                  }
                }
              }
            }
          },
          responses: { "201": { description: "Deposit address with optional QR data" } }
        }
      },
      "/v1/deposit-addresses/{id}": {
        get: {
          summary: "Fetch a deposit address and observed transfers",
          responses: { "200": { description: "Deposit address" } }
        }
      },
      "/v1/deposits": {
        get: {
          summary: "List detected or confirmed deposits",
          responses: { "200": { description: "Deposit list" } }
        }
      }
    },
    "x-enabled-assets": enabledAssets
  };
}
