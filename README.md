# EVM Deposit Gateway

Hono + TypeScript service for temporary USDT/USDC deposit addresses on configured EVM and TRON networks, with an admin operations dashboard.

The service creates temporary merchant deposit wallets, watches ERC-20/TRC-20 `Transfer` activity, sends signed lifecycle webhooks, tops up native gas when needed, sweeps token balances to configured treasury wallets, and gives admins a browser dashboard for monitoring and controlled wallet operations.

## What it does

EVM Deposit Gateway lets a merchant application request a temporary wallet address for an enabled token/network pair, such as USDT on Ethereum or TRON. A payer sends funds to that address. The worker detects the token transfer, confirms it after the configured block depth, notifies the merchant by signed webhook, funds the temporary wallet with native gas if needed, and sweeps the full token balance to the merchant treasury wallet.

The v1 scope is stablecoin deposits plus admin-controlled treasury/gas wallet operations. It does not provide exchange, customer account balances, or end-user wallet accounts.

## Flow

1. Admin creates a merchant.
2. Admin creates a merchant API key and configures webhook + treasury wallets.
3. Merchant calls `POST /v1/deposit-addresses` with HMAC-signed headers.
4. API generates an encrypted temporary wallet and returns the public address plus optional QR output.
5. Worker scans enabled ERC-20/TRC-20 transfers and matches deposits to generated addresses.
6. Worker emits lifecycle webhooks, tops up gas when required, and sweeps tokens to treasury.
7. Admins use `/dashboard` to monitor deposits, webhooks, gas top-ups, sweeps, and dashboard-submitted wallet transactions.

## Features

- Multi-merchant admin and merchant APIs
- HMAC-signed merchant requests with timestamp and nonce replay protection
- AES-256-GCM encryption for generated private keys, API secrets, and webhook secrets
- Postgres persistence through Drizzle ORM table definitions and checked-in SQL migrations
- Config-driven EVM and TRON network/token support
- `viem` for EVM address generation, log polling, gas top-ups, and token sweeps
- `tronweb` for TRON address generation, event polling, TRX top-ups, and TRC-20 sweeps
- Signed webhook outbox with retries
- React admin dashboard at `/dashboard`
- Dashboard-generated encrypted gas and treasury wallets
- Dashboard-submitted transfers from generated wallets to saved or external addresses
- OpenAPI JSON at `/openapi.json`

## More docs

- [Docker and Compose](docs/DOCKER.md)
- [Testnet setup](docs/TESTNET.md)
- [Callbacks, payloads, and lifecycle](docs/CALLBACKS.md)

## Setup

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run dev
```

Run the worker in a second process:

```bash
npm run dev:worker
```

Production build:

```bash
npm run build
npm start
npm run start:worker
```

Docker Compose:

```bash
cp .env.example .env
docker compose up --build
```

Testnet Compose:

```bash
cp .env.testnet.example .env.testnet
docker compose -f docker-compose.yml -f docker-compose.testnet.yml up --build
```

## Local development checklist

1. Create a Postgres database.
2. Fill `.env` with `DATABASE_URL`, `ADMIN_API_KEY`, dashboard login variables, and `ENCRYPTION_MASTER_KEY_BASE64`.
3. Configure at least one network RPC URL and token contract pair.
4. Run `npm run db:migrate`, or let Docker Compose run the `migrate` service.
5. Start API and worker in separate processes, or use Docker Compose.
6. Create a merchant, API key, webhook config, and treasury wallet through admin endpoints.

## Environment

Required:

- `DATABASE_URL`
- `ADMIN_API_KEY`
- `ADMIN_DASHBOARD_USERNAME`
- `ADMIN_DASHBOARD_PASSWORD`
- `ADMIN_SESSION_SECRET`
- `ENCRYPTION_MASTER_KEY_BASE64`, a 32-byte base64 key

Enable a network by setting `RPC_URL_<NETWORK>` and at least one token contract plus decimals, for example:

```bash
RPC_URL_ETHEREUM=https://...
USDT_CONTRACT_ETHEREUM=0x...
USDT_DECIMALS_ETHEREUM=6
GAS_WALLET_PRIVATE_KEY_ETHEREUM=0x...
```

The supported v1 mainnet slugs are `ethereum`, `bsc`, `polygon`, `arbitrum`, `optimism`, `base`, and `tron`.

The supported v1 testnet slugs are `sepolia`, `bscTestnet`, `polygonAmoy`, `arbitrumSepolia`, `optimismSepolia`, `baseSepolia`, and `nile`.

## Admin Dashboard

The dashboard is served by the API process at:

```text
http://localhost:3000/dashboard
```

Login uses:

- `ADMIN_DASHBOARD_USERNAME`
- `ADMIN_DASHBOARD_PASSWORD`
- `ADMIN_SESSION_SECRET`
- `ADMIN_SESSION_TTL_SECONDS`

Dashboard capabilities:

- View enabled networks, merchants, deposit addresses, deposits, gas top-ups, sweeps, webhook events, and dashboard wallet transactions.
- Create merchants.
- Generate encrypted platform gas wallets per network.
- Generate encrypted merchant treasury wallets per network/token. This also configures the merchant treasury address used by automatic sweeps.
- Register an externally managed treasury address without storing a private key.
- Submit native-token transfers from generated gas wallets.
- Submit treasury token transfers from generated treasury wallets to saved or external addresses.

Generated dashboard wallet private keys are encrypted at rest and are never returned in API or dashboard responses. Only generated operational wallets are spendable by the dashboard. A treasury address registered without a stored private key remains a sweep destination only.

## Admin API

Admin requests use either:

```http
Authorization: Bearer <ADMIN_API_KEY>
```

or:

```http
X-Admin-Api-Key: <ADMIN_API_KEY>
```

Main endpoints:

- `POST /admin/merchants`
- `POST /admin/merchants/:merchantId/api-keys`
- `POST /admin/merchants/:merchantId/api-keys/:apiKeyId/rotate`
- `POST /admin/merchants/:merchantId/api-keys/:apiKeyId/revoke`
- `PUT /admin/merchants/:merchantId/webhook`
- `PUT /admin/merchants/:merchantId/treasury-wallets`
- `GET /admin/networks`

API key and webhook secret responses include the raw secret once. Store them in the client application; the service stores encrypted copies.

Example bootstrap:

```bash
curl -X POST http://localhost:3000/admin/merchants \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Acme"}'
```

```bash
curl -X POST http://localhost:3000/admin/merchants/$MERCHANT_ID/api-keys \
  -H "Authorization: Bearer $ADMIN_API_KEY"
```

```bash
curl -X PUT http://localhost:3000/admin/merchants/$MERCHANT_ID/webhook \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://merchant.example/webhooks/crypto","secret":"use-a-long-random-secret"}'
```

```bash
curl -X PUT http://localhost:3000/admin/merchants/$MERCHANT_ID/treasury-wallets \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"network":"ethereum","token":"USDT","address":"0x..."}'
```

## Merchant HMAC Auth

Merchant requests send:

```http
X-Api-Key: pk_...
X-Timestamp: 1710000000
X-Nonce: unique-random-string
X-Signature: sha256=<hex-hmac>
```

Canonical request:

```text
METHOD
/path?query
timestamp
nonce
sha256(raw_request_body)
```

The signature is `HMAC-SHA256(apiSecret, canonicalRequest)`.

Node.js signing example:

```ts
import { createHash, createHmac, randomUUID } from "node:crypto";

const method = "POST";
const path = "/v1/deposit-addresses";
const timestamp = Math.floor(Date.now() / 1000).toString();
const nonce = randomUUID();
const body = JSON.stringify({
  network: "ethereum",
  token: "USDT",
  ttlSeconds: 3600,
  externalId: "invoice-123",
  qrFormat: "pngDataUrl"
});

const bodyHash = createHash("sha256").update(body).digest("hex");
const canonical = [method, path, timestamp, nonce, bodyHash].join("\n");
const signature = createHmac("sha256", process.env.API_SECRET!).update(canonical).digest("hex");

const response = await fetch("http://localhost:3000/v1/deposit-addresses", {
  method,
  headers: {
    "Content-Type": "application/json",
    "Idempotency-Key": "invoice-123",
    "X-Api-Key": process.env.API_KEY!,
    "X-Timestamp": timestamp,
    "X-Nonce": nonce,
    "X-Signature": `sha256=${signature}`
  },
  body
});
```

## Merchant API

Create a temporary deposit address:

```http
POST /v1/deposit-addresses
Idempotency-Key: invoice-123
Content-Type: application/json
```

```json
{
  "network": "ethereum",
  "token": "USDT",
  "ttlSeconds": 3600,
  "externalId": "invoice-123",
  "metadata": { "customerId": "cus_123" },
  "qrFormat": "pngDataUrl"
}
```

Other endpoints:

- `GET /v1/deposit-addresses/:id`
- `GET /v1/deposits?status=confirmed&limit=50`

Generated private keys are never returned by the API.

Response shape:

```json
{
  "id": "uuid",
  "merchantId": "uuid",
  "network": "ethereum",
  "token": "USDT",
  "address": "0x...",
  "status": "active",
  "expiresAt": "2026-06-04T20:00:00.000Z",
  "externalId": "invoice-123",
  "metadata": { "customerId": "cus_123" },
  "createdAt": "2026-06-04T19:00:00.000Z",
  "qr": {
    "text": "0x...",
    "pngDataUrl": "data:image/png;base64,..."
  }
}
```

## Webhooks

Outgoing webhooks are signed with the configured merchant webhook secret:

```http
X-Webhook-Id: <event-id>
X-Webhook-Timestamp: 1710000000
X-Webhook-Signature: sha256=<hex-hmac>
```

Signature payload:

```text
timestamp.raw_json_body
```

Lifecycle event types:

- `wallet.created`
- `wallet.expired`
- `transfer.detected`
- `deposit.confirmed`
- `deposit.late_detected`
- `gas.topup.submitted`
- `gas.topup.confirmed`
- `gas.topup.failed`
- `sweep.submitted`
- `sweep.confirmed`
- `sweep.failed`

Webhook receivers should use `id` from the JSON body or `X-Webhook-Id` for idempotency.

See [Callbacks, payloads, and lifecycle](docs/CALLBACKS.md) for full event data types and transaction flow.

Webhook body shape:

```json
{
  "id": "uuid",
  "type": "deposit.confirmed",
  "merchantId": "uuid",
  "createdAt": "2026-06-04T19:10:00.000Z",
  "data": {
    "transfer": {
      "id": "uuid",
      "network": "ethereum",
      "token": "USDT",
      "txHash": "0x...",
      "amountRaw": "10000000",
      "amountFormatted": "10",
      "status": "confirmed"
    }
  }
}
```

Verification rule:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

const expected = createHmac("sha256", webhookSecret)
  .update(`${timestamp}.${rawJsonBody}`)
  .digest("hex");

const valid = timingSafeEqual(
  Buffer.from(signature.replace(/^sha256=/, ""), "hex"),
  Buffer.from(expected, "hex")
);
```

## Tests

```bash
npm run typecheck
npm test
npm run build
npm audit --audit-level=moderate
```

Postgres integration tests are skipped by default. To run them, migrate a test database and set:

```bash
INTEGRATION_DATABASE_URL=postgres://...
npm test
```

Live RPC smoke tests are intentionally not automatic; enable networks in `.env` and run the worker against a controlled wallet setup only.
