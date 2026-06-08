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
      description: "USDT/USDC deposit requests for supported EVM and TRON networks, using temporary wallets or direct treasury payments."
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
      "/admin/treasury-wallets": {
        put: {
          security: [{ AdminBearer: [] }],
          summary: "Configure owner treasury wallet",
          responses: { "200": { description: "Treasury wallet" } }
        }
      },
      "/admin/webhook": {
        put: {
          security: [{ AdminBearer: [] }],
          summary: "Configure owner callback URL and signing secret",
          responses: { "200": { description: "Callback configuration. Secret is returned only when created or rotated." } }
        }
      },
      "/v1/deposit-addresses": {
        post: {
          summary: "Create a deposit request",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["network", "token"],
                  properties: {
                    network: { type: "string" },
                    token: { type: "string", enum: ["USDT", "USDC"] },
                    flow: {
                      type: "string",
                      enum: ["temporary_wallet", "direct_treasury"],
                      default: "temporary_wallet",
                      description: "Temporary wallet preserves the sweep flow. Direct treasury returns a treasury address and requires amount."
                    },
                    amount: {
                      type: "string",
                      description: "Required for direct_treasury requests. Decimal token amount expected from the payer."
                    },
                    treasuryWalletId: {
                      type: "string",
                      format: "uuid",
                      description: "Optional selectable treasury wallet ID. Defaults to the asset's default treasury wallet."
                    },
                    callbackUrl: {
                      type: "string",
                      format: "uri",
                      description: "Optional per-deposit callback URL override. Defaults to the dashboard callback URL."
                    },
                    callbackSecret: {
                      type: "string",
                      minLength: 16,
                      description: "Optional per-deposit signing secret override. Defaults to the dashboard callback secret."
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
          responses: { "201": { description: "Deposit request with payable address and optional QR data" } }
        }
      },
      "/v1/treasury-wallets": {
        get: {
          summary: "List selectable treasury wallets",
          parameters: [
            { name: "network", in: "query", schema: { type: "string" } },
            { name: "token", in: "query", schema: { type: "string", enum: ["USDT", "USDC"] } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } }
          ],
          responses: { "200": { description: "Selectable treasury wallet list" } }
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
      },
      "/v1/treasury-transfers": {
        get: {
          summary: "List unmatched, ambiguous, or matched direct treasury transfers",
          parameters: [
            { name: "status", in: "query", schema: { type: "string", enum: ["unmatched", "ambiguous", "matched"] } },
            { name: "network", in: "query", schema: { type: "string" } },
            { name: "token", in: "query", schema: { type: "string", enum: ["USDT", "USDC"] } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } }
          ],
          responses: { "200": { description: "Treasury transfer review list" } }
        }
      },
      "/v1/treasury-transfers/{treasuryTransferId}/match": {
        post: {
          summary: "Manually match an unmatched treasury transfer to a direct deposit request",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["depositAddressId"],
                  properties: {
                    depositAddressId: { type: "string", format: "uuid" }
                  }
                }
              }
            }
          },
          responses: { "200": { description: "Matched treasury transfer, deposit request, and transfer" } }
        }
      }
    },
    "x-enabled-assets": enabledAssets
  };
}
