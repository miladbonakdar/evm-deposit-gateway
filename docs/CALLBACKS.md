# Callbacks, Payloads, and Lifecycle

This document is the integration contract for outgoing webhooks.

## Delivery

Webhook requests are `POST` requests to the dashboard callback URL by default. A deposit request can optionally provide a per-deposit `callbackUrl` override.

Configure the default callback URL and signing secret in the dashboard. The raw secret is shown only when it is first created or rotated. Your application can then create deposit requests without sending a callback secret each time:

```json
{
  "network": "ethereum",
  "token": "USDT",
  "ttlSeconds": 3600,
  "externalId": "invoice-123"
}
```

If a request supplies `callbackUrl` but not `callbackSecret`, lifecycle events for that deposit are delivered to the supplied URL and signed with the dashboard-managed secret. A per-deposit `callbackSecret` remains an advanced override; when supplied, it is stored encrypted and never returned. The dashboard notification settings can enable or disable specific lifecycle event types globally.

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
HMAC-SHA256(callbackSigningSecret, signaturePayload)
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
  | "direct_deposit.created"
  | "direct_deposit.expired"
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
  | "avalancheFuji"
  | "lineaSepolia"
  | "scrollSepolia"
  | "tron"
  | "nile";

type TokenSymbol = "USDT" | "USDC";
type DepositAddressStatus = "active" | "expired" | "completed";
type DepositFlow = "temporary_wallet" | "direct_treasury";
type DepositMatchStatus = "pending" | "matched";
type DepositMatchSource = "auto" | "manual";
type TransferStatus = "detected" | "confirmed" | "late";
type TransactionStatus = "submitted" | "confirmed" | "failed";

interface DepositAddressPayload {
  id: string;
  merchantId: string;
  network: NetworkSlug;
  token: TokenSymbol;
  address: string;
  treasuryWalletId: string | null;
  callbackUrl: string | null;
  status: DepositAddressStatus;
  flow: DepositFlow;
  requestedAmountRaw: string | null;
  requestedAmountFormatted: string | null;
  receivedAmountRaw: string | null;
  receivedAmountFormatted: string | null;
  amountDeltaRaw: string | null;
  matchStatus: DepositMatchStatus | null;
  matchedTransferId: string | null;
  matchSource: DepositMatchSource | null;
  matchedAt: string | null;
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
  attemptNumber: number;
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
  attemptNumber: number;
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
  treasuryWalletId: string;
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

### direct_deposit.created

Sent after the API creates a direct treasury deposit request and returns the selected treasury address as the payable address.

```ts
interface DirectDepositCreatedData {
  depositAddress: DepositAddressPayload;
  treasuryWallet: string;
  treasuryWalletId: string;
}
```

### direct_deposit.expired

Sent once when an unmatched direct treasury request reaches its payment deadline.

```ts
interface DirectDepositExpiredData {
  depositAddress: DepositAddressPayload;
}
```

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
  depositAddress?: DepositAddressPayload;
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

The related deposit settlement remains pending. After the gas source is funded or configured, an operator can use dashboard **Retry Settlement** to create a new gas top-up attempt.

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

The related deposit settlement remains pending. After the sweep issue is resolved, dashboard **Retry Settlement** creates a new sweep attempt.

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

Direct treasury deposit:

```text
direct_deposit.created
transfer.detected          only after auto or manual match
deposit.confirmed
```

If a treasury transfer is outside tolerance or ambiguous, it is stored for dashboard or merchant API review and does not emit `transfer.detected` / `deposit.confirmed` until it is manually matched.

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
