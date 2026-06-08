# Callbacks, Payloads, and Lifecycle

This document is the integration contract for outgoing webhooks.

## Delivery

Webhook requests are `POST` requests to the callback URL supplied for that specific deposit address.

Your application creates the callback route with `POST /v1/deposit-addresses`:

```json
{
  "network": "ethereum",
  "token": "USDT",
  "callbackUrl": "https://app.example/webhooks/crypto/invoice-123",
  "callbackSecret": "use-a-long-random-per-deposit-secret",
  "ttlSeconds": 3600,
  "externalId": "invoice-123"
}
```

`callbackSecret` is stored encrypted and is never returned. All lifecycle events for this deposit address use this callback URL and secret. The owner webhook configuration remains a fallback for old deposit rows or events that are not tied to a deposit address.

Headers:

```http
Content-Type: application/json
User-Agent: evm-deposit-gateway-webhooks/0.1
X-Webhook-Id: <event-id>
X-Webhook-Timestamp: <unix-seconds>
X-Webhook-Signature: sha256=<hmac-hex>
```

Signature payload:

```text
timestamp.raw_json_body
```

Signature algorithm:

```text
HMAC-SHA256(callbackSecret, signaturePayload)
```

Receivers should reject stale timestamps and use `X-Webhook-Id` or body `id` for idempotency.

## Envelope

All event bodies use this envelope:

```ts
interface WebhookEnvelope<TType extends WebhookEventType, TData> {
  id: string;
  type: TType;
  merchantId: string;
  createdAt: string;
  data: TData;
}
```

Dates are ISO 8601 strings. Token amounts include both raw base units and formatted decimal strings.

## Event Types

```ts
type WebhookEventType =
  | "wallet.created"
  | "wallet.expired"
  | "transfer.detected"
  | "deposit.confirmed"
  | "deposit.late_detected"
  | "gas.topup.submitted"
  | "gas.topup.confirmed"
  | "gas.topup.failed"
  | "sweep.submitted"
  | "sweep.confirmed"
  | "sweep.failed";
```

## Shared Data Types

```ts
type NetworkSlug =
  | "ethereum"
  | "bsc"
  | "polygon"
  | "arbitrum"
  | "optimism"
  | "base"
  | "sepolia"
  | "bscTestnet"
  | "polygonAmoy"
  | "arbitrumSepolia"
  | "optimismSepolia"
  | "baseSepolia"
  | "tron"
  | "nile";

type TokenSymbol = "USDT" | "USDC";
type DepositAddressStatus = "active" | "expired";
type TransferStatus = "detected" | "confirmed" | "late";
type TransactionStatus = "submitted" | "confirmed" | "failed";

interface DepositAddressPayload {
  id: string;
  merchantId: string;
  network: NetworkSlug;
  token: TokenSymbol;
  address: string;
  callbackUrl: string | null;
  status: DepositAddressStatus;
  expiresAt: string;
  externalId: string | null;
  metadata: unknown;
  createdAt: string;
}

interface TransferPayload {
  id: string;
  merchantId: string;
  depositAddressId: string;
  network: NetworkSlug;
  token: TokenSymbol;
  txHash: string;
  logIndex: number;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  amountFormatted: string;
  blockNumber: string;
  confirmations: number;
  status: TransferStatus;
  detectedAt: string;
  confirmedAt: string | null;
}

interface GasTopUpPayload {
  id: string;
  transferId: string;
  network: NetworkSlug;
  txHash: string | null;
  amountWei: string;
  status: TransactionStatus;
  failureReason: string | null;
  createdAt: string;
  confirmedAt: string | null;
}

interface SweepPayload {
  id: string;
  transferId: string;
  network: NetworkSlug;
  token: TokenSymbol;
  txHash: string | null;
  amountRaw: string;
  amountFormatted: string;
  toAddress: string;
  status: TransactionStatus;
  failureReason: string | null;
  createdAt: string;
  confirmedAt: string | null;
}
```

## Payloads By Event

### wallet.created

Sent after the API creates and encrypts a temporary deposit wallet.

```ts
interface WalletCreatedData {
  depositAddress: DepositAddressPayload;
  treasuryWallet: string;
}
```

### wallet.expired

Sent once when the worker moves a temporary deposit address from `active` to `expired`.

```ts
interface WalletExpiredData {
  depositAddress: DepositAddressPayload;
}
```

Expiration means the intended payment window has closed. Late deposits can still be detected and settled.

### transfer.detected

Sent when a confirmed-depth scan first sees an ERC-20 transfer into an active generated deposit address.

```ts
interface TransferDetectedData {
  transfer: TransferPayload;
  depositAddress: DepositAddressPayload;
}
```

### deposit.confirmed

Sent after the transfer reaches the configured confirmation depth and the deposit is marked confirmed.

```ts
interface DepositConfirmedData {
  transfer: TransferPayload;
}
```

### deposit.late_detected

Sent when funds arrive after the deposit address expired. The worker still attempts gas top-up and sweep for late deposits.

```ts
interface DepositLateDetectedData {
  transfer: TransferPayload;
  depositAddress: DepositAddressPayload;
}
```

### gas.topup.submitted

Sent after the worker submits a native gas transfer from the platform gas wallet to the temporary deposit wallet.

```ts
interface GasTopUpSubmittedData {
  gasTopUp: GasTopUpPayload;
}
```

### gas.topup.confirmed

Sent after the gas top-up transaction succeeds on chain.

```ts
interface GasTopUpConfirmedData {
  gasTopUp: GasTopUpPayload;
}
```

### gas.topup.failed

Sent if gas top-up cannot be submitted or if the submitted transaction reverts.

```ts
interface GasTopUpFailedData {
  gasTopUp: GasTopUpPayload;
}
```

### sweep.submitted

Sent after the worker submits the ERC-20 sweep transaction from temporary wallet to treasury wallet.

```ts
interface SweepSubmittedData {
  sweep: SweepPayload;
}
```

### sweep.confirmed

Sent after the sweep transaction succeeds on chain.

```ts
interface SweepConfirmedData {
  sweep: SweepPayload;
}
```

### sweep.failed

Sent if the sweep cannot be submitted or if the submitted transaction reverts.

```ts
interface SweepFailedData {
  sweep: SweepPayload;
}
```

## Transaction Lifecycle

Normal active-address deposit:

```text
wallet.created
transfer.detected
deposit.confirmed
gas.topup.submitted        optional, only if wallet lacks native gas
gas.topup.confirmed        optional
sweep.submitted
sweep.confirmed
wallet.expired             later, when the temporary address TTL ends
```

Late deposit:

```text
wallet.created
wallet.expired
deposit.late_detected
gas.topup.submitted        optional
gas.topup.confirmed        optional
sweep.submitted
sweep.confirmed
```

Gas top-up failure:

```text
deposit.confirmed
gas.topup.failed
```

Sweep failure:

```text
deposit.confirmed
sweep.failed
```

## Retry Behavior

Webhook events are stored in an outbox and retried with exponential backoff.

Config:

- `WEBHOOK_TIMEOUT_MS`
- `WEBHOOK_MAX_ATTEMPTS`, default `5`
- `WEBHOOK_BASE_RETRY_SECONDS`, default `5`
- `WEBHOOK_MAX_RETRY_DELAY_SECONDS`, default `86400`

Every event tracks `status`, `attempts`, `nextAttemptAt`, `lastError`, `responseStatus`, and `sentAt`. Events tied to deposits also store `depositAddressId`.

Any 2xx response marks the event `sent`. Non-2xx responses, timeouts, and network errors are retried until max attempts, then marked `failed` internally.

## Receiver Requirements

- Verify `X-Webhook-Signature`.
- Reject stale `X-Webhook-Timestamp`.
- Process each event ID idempotently.
- Return a 2xx status only after durable processing.
- Do not assume events from different transaction branches arrive at the exact same time.
