import type { SupportedNetworks } from "../config/networks.js";
import { enabledNetworks, enabledTokens } from "../config/networks.js";

export function buildOpenApiSpec(networks: SupportedNetworks) {
  const enabledAssets = enabledNetworks(networks)
    .flatMap((network) =>
      enabledTokens(network)
        .map((token) => ({
          network: network.slug,
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
    security: [{ MerchantHmac: [] }],
    components: {
      securitySchemes: {
        AdminBearer: {
          type: "http",
          scheme: "bearer"
        },
        MerchantHmac: {
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
      "/admin/merchants": {
        post: {
          security: [{ AdminBearer: [] }],
          summary: "Create merchant",
          responses: { "201": { description: "Merchant created" } }
        }
      },
      "/admin/merchants/{merchantId}/api-keys": {
        post: {
          security: [{ AdminBearer: [] }],
          summary: "Create merchant API key",
          responses: { "201": { description: "API key and one-time secret" } }
        }
      },
      "/admin/merchants/{merchantId}/webhook": {
        put: {
          security: [{ AdminBearer: [] }],
          summary: "Configure merchant webhook",
          responses: { "200": { description: "Webhook configuration" } }
        }
      },
      "/admin/merchants/{merchantId}/treasury-wallets": {
        put: {
          security: [{ AdminBearer: [] }],
          summary: "Configure merchant treasury wallet",
          responses: { "200": { description: "Treasury wallet" } }
        }
      },
      "/v1/deposit-addresses": {
        post: {
          summary: "Create a temporary deposit address",
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
