# EVM Deposit Gateway

Hono + TypeScript service for USDT/USDC deposits on configured EVM and TRON networks, with temporary-wallet and direct-treasury payment flows plus an admin operations dashboard.

The service creates temporary deposit wallets or direct treasury deposit requests for one owner account, watches ERC-20/TRC-20 `Transfer` activity, sends signed lifecycle callbacks, tops up native gas when needed, sweeps temporary-wallet balances to configured treasury wallets, and provides a browser dashboard for monitoring, reconciliation, and controlled wallet operations.

## What it does

EVM Deposit Gateway lets your application request either a temporary wallet address or a direct treasury payment address for an enabled token/network pair, such as USDT on Ethereum or TRON. In the temporary flow, the worker detects the token transfer, confirms it after the configured block depth, notifies your callback URL, funds the temporary wallet with native gas if needed, and sweeps the full token balance to the owner treasury wallet. In the direct treasury flow, the payer sends funds to a selected treasury wallet and the worker matches by treasury, amount tolerance, and time window.

The v1 scope is stablecoin deposits plus admin-controlled treasury/gas wallet operations. It does not provide exchange, customer account balances, or end-user wallet accounts.

## Flow

1. Dashboard automatically bootstraps the single internal owner account.
2. Dashboard creates an API key and configures treasury/gas wallets for that owner.
3. Dashboard configures the merchant callback URL and copyable callback signing secret.
4. Your application calls `POST /v1/deposit-addresses` with HMAC-signed headers and its own `externalId`.
5. API either generates an encrypted temporary wallet or selects a treasury wallet for direct payment, then returns the payable address plus optional QR output.
6. Worker scans enabled ERC-20/TRC-20 transfers and matches deposits to generated addresses or open direct treasury requests.
7. Worker emits lifecycle callbacks, tops up gas when required, sweeps temporary-wallet tokens to treasury, and stores unmatched direct treasury transfers for review.
8. Use `/dashboard` to monitor deposits, unmatched treasury transfers, callbacks, gas top-ups, sweeps, and dashboard-submitted wallet transactions.

## Features

- Single-owner dashboard and operations flow
- HMAC-signed client requests with timestamp and nonce replay protection
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
- [Application flows and diagrams](docs/FLOWS.md)
- [Callbacks, payloads, and lifecycle](docs/CALLBACKS.md)

## Setup

```bash
npm install
cp .env.example .env
cp config/networks.example.json config/networks.local.json
set -a
source .env
set +a
npm run db:migrate
npm run dev
```

Run API and worker together with hot reload:

```bash
npm run dev:all
```

For the local testnet config:

```bash
npm run dev:testnet
```

Or run the worker in a second process:

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
cp config/networks.example.json config/networks.local.json
docker compose up --build
```

Testnet Compose:

```bash
cp .env.testnet.example .env.testnet
cp config/networks.testnet.example.json config/networks.testnet.local.json
docker compose -f docker-compose.yml -f docker-compose.testnet.yml up --build
```

## Local development checklist

1. Create a Postgres database, or start the Compose database on `localhost:5432` with `docker compose up -d db`.
2. Fill `.env` with `DATABASE_URL`, `ADMIN_API_KEY`, dashboard login variables, and `ENCRYPTION_MASTER_KEY_BASE64`.
3. Copy `config/networks.example.json` to `config/networks.local.json`.
4. Configure at least one network RPC URL in `.env` and at least one token contract/decimals pair in `config/networks.local.json`.
5. Run `npm run db:migrate`, or let Docker Compose run the `migrate` service.
6. Start API and worker in separate processes, or use Docker Compose.
7. Create an API key and treasury wallet through the dashboard.

## Environment

Required:

- `DATABASE_URL`
- `ADMIN_API_KEY`
- `ADMIN_DASHBOARD_USERNAME`
- `ADMIN_DASHBOARD_PASSWORD`
- `ADMIN_SESSION_SECRET`
- `ENCRYPTION_MASTER_KEY_BASE64`, a 32-byte base64 key
- `NETWORK_CONFIG_PATH`, usually `config/networks.local.json` or `config/networks.testnet.local.json`

Business settings such as token contracts, decimals, confirmations, scan windows, and gas thresholds live in JSON:

```bash
cp config/networks.example.json config/networks.local.json
```

Enable a network by setting its RPC URL in `.env` and at least one token contract in `NETWORK_CONFIG_PATH`:

```bash
RPC_URL_ETHEREUM=https://...
GAS_WALLET_PRIVATE_KEY_ETHEREUM=0x...
```

```json
{
  "networks": {
    "ethereum": {
      "confirmations": 12,
      "scanFromBlock": "0",
      "maxScanBlocks": "1000",
      "minGasWei": "2000000000000000",
      "gasTopUpWei": "5000000000000000",
      "tokens": {
        "USDT": {
          "contractAddress": "0x...",
          "decimals": 6
        }
      }
    }
  }
}
```

The supported v1 mainnet slugs are `ethereum`, `bsc`, `polygon`, `arbitrum`, `optimism`, `base`, and `tron`.

The supported v1 testnet slugs are `sepolia`, `bscTestnet`, `polygonAmoy`, `arbitrumSepolia`, `optimismSepolia`, `baseSepolia`, `avalancheFuji`, `lineaSepolia`, `scrollSepolia`, and `nile`.

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

- View enabled networks, deposit addresses, deposits, gas top-ups, sweeps, callback events, and dashboard wallet transactions.
- View charts for deposit activity, confirmed token volume, deposit status, wallet transaction status, and callback status.
- Browse paginated, filterable histories for deposits, deposit addresses, wallet transactions, gas top-ups, sweeps, and callback events.
- Create owner API keys and copy the one-time API secret.
- Choose which lifecycle event types should trigger per-request callbacks.
- Generate encrypted platform gas wallets per network.
- Generate encrypted owner treasury wallets per network/token. The first treasury for an asset becomes the default sweep destination.
- Register externally managed treasury addresses without storing private keys.
- Mark one treasury wallet as the default for each network/token, while merchants may select any treasury ID per deposit request.
- Retry blocked deposit settlement after gas wallet funding/configuration or sweep failures.
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

Owner-scoped endpoints:

- `GET /admin/owner`
- `POST /admin/api-keys`
- `POST /admin/api-keys/:apiKeyId/rotate`
- `POST /admin/api-keys/:apiKeyId/revoke`
- `PUT /admin/treasury-wallets`
- `GET /admin/networks`

API key responses include the raw secret once. Store them in the client application; the service stores encrypted copies. Deposit callback secrets are supplied per `POST /v1/deposit-addresses` request and are stored encrypted.

Example owner bootstrap:

```bash
curl http://localhost:3000/admin/owner \
  -H "Authorization: Bearer $ADMIN_API_KEY"
```

```bash
curl -X POST http://localhost:3000/admin/api-keys \
  -H "Authorization: Bearer $ADMIN_API_KEY"
```

```bash
curl -X PUT http://localhost:3000/admin/treasury-wallets \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"network":"ethereum","token":"USDT","address":"0x..."}'
```

## Client HMAC Auth

Deposit API requests send:

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
  treasuryWalletId: "optional-selected-treasury-uuid",
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

## Deposit API

Create a deposit request. Omit `flow` for the existing temporary-wallet flow:

```http
POST /v1/deposit-addresses
Idempotency-Key: invoice-123
Content-Type: application/json
```

```json
{
  "network": "ethereum",
  "token": "USDT",
  "treasuryWalletId": "optional-selected-treasury-uuid",
  "ttlSeconds": 3600,
  "externalId": "invoice-123",
  "metadata": { "customerId": "cus_123" },
  "qrFormat": "pngDataUrl"
}
```

Create a direct treasury request by adding `flow: "direct_treasury"` and the requested token amount:

```json
{
  "network": "ethereum",
  "token": "USDT",
  "flow": "direct_treasury",
  "amount": "100",
  "ttlSeconds": 86400,
  "externalId": "invoice-124",
  "qrFormat": "pngDataUrl"
}
```

Other endpoints:

- `GET /v1/treasury-wallets?network=ethereum&token=USDT`
- `GET /v1/deposit-addresses/:id`
- `GET /v1/deposits?status=confirmed&limit=50`
- `GET /v1/treasury-transfers?status=unmatched&limit=50`
- `POST /v1/treasury-transfers/:id/match`

If `treasuryWalletId` is omitted for `temporary_wallet`, the deposit uses the default treasury wallet for the requested network/token. If it is omitted for `direct_treasury`, the API selects the treasury wallet with the fewest active direct requests for that asset. Direct treasury auto-matching uses `DIRECT_TREASURY_MATCH_TOLERANCE_BPS` and defaults to 5%. Transfers that are out of tolerance or match multiple open direct requests are stored as unmatched/ambiguous treasury transfers for dashboard or merchant API reconciliation. Temporary deposit address creation also verifies that the selected treasury matches the requested asset, worker scan settings are usable, the chain RPC and token contract can be read, a gas wallet is configured, the gas top-up amount meets the network minimum, and the gas wallet currently has at least one top-up amount of native gas. If any check fails, the API returns a `422` before creating the temporary wallet; multiple missing items are returned together as `deposit_configuration_incomplete` with an `issues` list. Generated private keys are never returned by the API. `merchantId` in API and webhook payloads is the internal owner id used to relate records.

Callbacks use the dashboard callback configuration by default. The dashboard returns the callback signing secret only when it is first created or rotated, so copy it into the merchant webhook receiver at that time. Deposit requests may still pass `callbackUrl` as a per-order URL override; if no `callbackSecret` is supplied, that URL is signed with the dashboard-managed secret.

Response shape:

```json
{
  "id": "uuid",
  "merchantId": "uuid",
  "network": "ethereum",
  "token": "USDT",
  "address": "0x...",
  "treasuryWalletId": "uuid",
  "callbackUrl": null,
  "status": "active",
  "flow": "direct_treasury",
  "requestedAmountRaw": "100000000",
  "requestedAmountFormatted": "100",
  "receivedAmountRaw": null,
  "receivedAmountFormatted": null,
  "amountDeltaRaw": null,
  "matchStatus": "pending",
  "matchedTransferId": null,
  "matchSource": null,
  "matchedAt": null,
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

Gas top-up and sweep failures can still emit `gas.topup.failed` or `sweep.failed` callbacks if the gas source is depleted after address creation or a transaction fails, but the deposit settlement remains pending in the dashboard. After an operator funds/configures the gas wallet or resolves the sweep issue, use **Retry Settlement** in the deposit history to create a new gas top-up or sweep attempt while preserving the failed attempt history.

## Webhooks

Callbacks use the dashboard callback URL and signing secret by default. A deposit request can optionally provide `callbackUrl` to route one order to a different URL; unless it also provides an advanced per-deposit `callbackSecret`, that URL is signed with the dashboard-managed secret. The dashboard notification settings can enable or disable specific lifecycle event types globally.

Outgoing webhooks are signed with the dashboard callback secret, or with a per-deposit secret only when one was explicitly supplied:

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
- `direct_deposit.created`
- `direct_deposit.expired`
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

The service stores every callback attempt in the webhook outbox. A 2xx response marks the callback `sent`; non-2xx responses, timeouts, and network errors are retried with exponential backoff. Defaults are 5 attempts, 5-second base delay, and a 1-day maximum retry delay.

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
