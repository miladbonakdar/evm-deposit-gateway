# Application Flows

This document maps the main runtime flows in the gateway: dashboard setup, merchant deposit creation, worker settlement, webhook delivery, and dashboard-submitted wallet transactions.

## End-to-End System Flow

```mermaid
flowchart TD
  Admin["Admin / dashboard user"] --> Login["POST /dashboard/api/login"]
  Login --> Session["Bearer dashboard session"]
  Session --> DashAPI["/dashboard/api/*"]
  Admin --> AdminAPI["/admin/* with ADMIN_API_KEY"]

  DashAPI --> Owner["Lazy-create single owner account"]
  AdminAPI --> Owner
  Owner --> ApiKeys["Create, rotate, revoke merchant API keys"]
  Owner --> WebhookCfg["Configure callback URL + signing secret"]
  Owner --> Treasury["Configure selectable treasury wallets"]
  DashAPI --> OpWallets["Generate operational gas / treasury wallets"]
  DashAPI --> ManualTx["Submit dashboard wallet transaction"]

  Merchant["Merchant app"] --> HMAC["/v1/* HMAC auth<br/>api key + timestamp + nonce + signature"]
  HMAC --> DepositReq["POST /v1/deposit-addresses"]
  DepositReq --> Idem{"Idempotency-Key<br/>already seen?"}
  Idem -->|same body| Replay["Replay stored response"]
  Idem -->|new| SelectTreasury["Resolve requested treasury ID<br/>or default by asset"]
  SelectTreasury --> FlowType{"Deposit flow"}
  FlowType -->|temporary_wallet| CheckTreasury{"Treasury wallet<br/>configured?"}
  FlowType -->|direct_treasury| DirectSelect["Select requested or<br/>least-pending treasury"]
  DirectSelect --> DirectRow[("deposit_addresses<br/>flow=direct_treasury")]
  DirectRow --> DirectCreated["Enqueue direct_deposit.created webhook"]
  DirectCreated --> ReturnAddress["Return address + optional QR"]
  CheckTreasury -->|no| Reject["422 treasury_wallet_missing"]
  CheckTreasury -->|yes| TempWallet["Generate temp EVM/TRON wallet<br/>encrypt private key + callback secret"]
  TempWallet --> DepositRow[("deposit_addresses<br/>with treasury_wallet_id")]
  TempWallet --> WalletCreated["Enqueue wallet.created webhook"]
  TempWallet --> ReturnAddress

  Payer["Payer sends USDT/USDC"] --> Chain["Enabled EVM/TRON chain"]

  Worker["Worker loop"] --> Expire["Expire old temp wallets"]
  Worker --> Scan["Scan enabled network/token Transfer events"]
  Scan --> Cursor[("chain_cursors")]
  Scan --> Match{"Transfer to known<br/>temporary address?"}
  Match -->|no| Ignore["Ignore"]
  Match -->|yes| TransferRow[("token_transfers")]
  Match -->|treasury address| DirectMatch["Match open direct request<br/>by treasury + amount tolerance"]
  DirectMatch -->|one candidate| TransferRow
  DirectMatch -->|none / many| TreasuryTransfer[("treasury_transfers<br/>unmatched or ambiguous")]
  TransferRow --> Late{"Address expired?"}
  Late -->|yes| LateEvent["deposit.late_detected"]
  Late -->|no| DetectedEvent["transfer.detected"]
  Worker --> ConfirmDeposit["Confirm transfers after configured depth"]
  ConfirmDeposit --> ConfirmedEvent["deposit.confirmed"]

  LateEvent --> Settle["Ensure settlement"]
  ConfirmedEvent --> Settle
  Settle --> GasCheck{"Deposit wallet has<br/>enough native gas?"}
  GasCheck -->|no| TopUp["Submit gas top-up<br/>env key or generated gas wallet"]
  TopUp --> GasRow[("gas_top_ups")]
  Worker --> ConfirmGas["Confirm gas top-ups"]
  ConfirmGas -->|success| GasConfirmed["gas.topup.confirmed"]
  ConfirmGas -->|reverted / missing key| GasFailed["gas.topup.failed<br/>settlement stays pending"]
  GasConfirmed --> Settle
  GasCheck -->|yes| Sweep["Sweep full token balance<br/>to treasury wallet"]
  Sweep --> SweepRow[("sweeps")]
  Worker --> ConfirmSweep["Confirm sweeps"]
  ConfirmSweep -->|success| SweepConfirmed["sweep.confirmed"]
  ConfirmSweep -->|reverted / send error| SweepFailed["sweep.failed<br/>settlement stays pending"]
  Admin --> RetrySettlement["Retry Settlement"]
  RetrySettlement --> Settle

  Worker --> ConfirmManual["Confirm dashboard wallet transactions"]
  ManualTx --> WalletTxRow[("wallet_transactions")]
  ConfirmManual --> WalletTxRow

  WalletCreated --> Outbox[("webhook_events outbox")]
  DetectedEvent --> Outbox
  LateEvent --> Outbox
  ConfirmedEvent --> Outbox
  GasConfirmed --> Outbox
  GasFailed --> Outbox
  SweepConfirmed --> Outbox
  SweepFailed --> Outbox

  Worker --> Delivery["WebhookDeliveryService"]
  Delivery --> Outbox
  Delivery --> SignedPost["POST callback with<br/>X-Webhook-Signature"]
  SignedPost --> Receiver["Merchant callback receiver"]
  SignedPost -->|2xx| Sent["Mark sent"]
  SignedPost -->|error / non-2xx| Retry["Exponential retry, then failed"]
```

## Normal Deposit Sequence

```mermaid
sequenceDiagram
  participant Merchant
  participant API
  participant DB
  participant Worker
  participant Chain
  participant Callback

  Merchant->>API: POST /v1/deposit-addresses
  API->>DB: Store encrypted temp wallet
  API->>DB: Enqueue wallet.created
  API-->>Merchant: Deposit address + QR

  Merchant->>Chain: Payer sends token to temp address
  Worker->>Chain: Scan Transfer logs
  Worker->>DB: Create token_transfer detected
  Worker->>DB: Enqueue transfer.detected
  Worker->>DB: Mark confirmed after required depth
  Worker->>DB: Enqueue deposit.confirmed

  Worker->>Chain: Check native gas
  alt Needs gas
    Worker->>Chain: Send native gas top-up
    Worker->>DB: Create gas.topup.submitted
    Worker->>Chain: Confirm gas transaction
    Worker->>DB: Enqueue gas.topup.confirmed
  end

  Worker->>Chain: Sweep token balance to treasury
  Worker->>DB: Enqueue sweep.submitted
  Worker->>Chain: Confirm sweep transaction
  Worker->>DB: Enqueue sweep.confirmed

  Worker->>Callback: Deliver signed webhook events from outbox
```

## Flow Notes

The dashboard and admin API operate on a single internal owner account. The owner account is created lazily when dashboard or admin routes need it. From there, operators create merchant API keys, configure the callback URL and copyable signing secret, configure selectable treasury wallets, generate operational wallets, retry blocked deposit settlement, and submit manual wallet transfers.

Merchant API calls under `/v1/*` require HMAC authentication. The request includes the public API key, timestamp, nonce, and signature. The server rejects stale timestamps, reused nonces, invalid signatures, revoked API keys, and disabled merchants.

`POST /v1/deposit-addresses` is idempotency-aware. If the same `Idempotency-Key` is reused with the same request body, the stored response is replayed. If the same key is reused with a different body, the request is rejected.

Deposit request creation requires a configured treasury wallet for the requested network and token. It also requires an active dashboard callback configuration unless the request supplies both a per-deposit callback URL and secret. The merchant may pass `treasuryWalletId`. For the temporary-wallet flow, the API uses the default treasury when omitted, verifies worker scan settings, chain RPC connectivity, token contract readability, gas wallet configuration, gas top-up sizing, and current gas wallet native balance. If any of those checks fail, the API returns a `422` before creating the temporary wallet; multiple setup issues are returned together as `deposit_configuration_incomplete`. Otherwise, it generates an EVM or TRON temporary wallet, encrypts the private key, stores the public address and selected treasury ID, enqueues `wallet.created`, and returns the public address with optional QR output.

For `direct_treasury`, the API requires `amount`. If `treasuryWalletId` is omitted, it selects the treasury wallet with the fewest active direct requests for that asset. The worker first ignores known internal sweep transactions, then auto-matches a treasury transfer only when exactly one active direct request for the same merchant/network/token/treasury is within the configured tolerance. Out-of-tolerance and ambiguous transfers are stored in `treasury_transfers` for dashboard or merchant API manual matching.

The worker is the settlement state machine. Each tick expires old deposit addresses, scans configured token `Transfer` events, records matching deposits, confirms deposits after the configured block depth, checks native gas, tops up gas when needed, sweeps token balances to treasury, confirms submitted top-ups and sweeps, and confirms dashboard wallet transactions.

Callbacks are not a single callback for the whole deposit. The gateway creates one webhook event per lifecycle step, and each event may have multiple delivery attempts until it is marked `sent` or permanently `failed`.

Common event order for an active deposit:

```text
wallet.created
transfer.detected
deposit.confirmed
gas.topup.submitted        optional
gas.topup.confirmed        optional
sweep.submitted
sweep.confirmed
wallet.expired             later, when the temporary address TTL ends
```

Common event order for a late deposit:

```text
wallet.created
wallet.expired
deposit.late_detected
gas.topup.submitted        optional
gas.topup.confirmed        optional
sweep.submitted
sweep.confirmed
```

## Zero-Gas Behavior

Temporary deposit wallets often receive only tokens and may have `0` native gas. The worker handles that by checking the deposit wallet native balance before sweeping. If the balance is below the configured threshold, it sends a native gas top-up from either:

- the network's configured `GAS_WALLET_PRIVATE_KEY_*` environment key, or
- a generated operational gas wallet stored encrypted in the database.

If the top-up is submitted and later confirmed, the worker retries settlement and submits the token sweep.

For deposits whose gas source is depleted after address creation, or whose top-up transaction fails, the gateway records `gas.topup.failed`, enqueues a callback, and keeps the transfer settlement pending at the gas top-up step. The worker does not automatically create a second attempt after a failed attempt. Recovery is operational but first-class: fund or configure the gas source, then use **Retry Settlement** in the dashboard to create a new gas top-up attempt.

Sweep submission or receipt failures behave the same way: the gateway records `sweep.failed`, sends the callback, keeps settlement pending at the sweep step, and preserves the failed attempt. After the issue is resolved, **Retry Settlement** creates a new sweep attempt.

## Dashboard Wallet Transactions

Dashboard wallet transfers are separate from automatic deposit settlement.

```mermaid
flowchart TD
  Operator["Dashboard operator"] --> Form["Transfers tab<br/>source wallet + asset + destination + amount"]
  Form --> Rules{"Wallet asset rules"}
  Rules -->|gas wallet| NativeOnly["Only NATIVE is allowed"]
  Rules -->|treasury wallet| NativeOrToken["NATIVE or configured token"]
  NativeOnly --> Submit["POST /dashboard/api/wallet-transactions"]
  NativeOrToken --> Submit
  Submit --> Decrypt["Decrypt operational wallet private key"]
  Decrypt --> ChainSend["Submit native or token transfer"]
  ChainSend -->|success| Submitted[("wallet_transactions: submitted")]
  ChainSend -->|error| Failed[("wallet_transactions: failed")]
  Worker["Worker receipt check"] --> Submitted
  Worker --> Receipt{"Transaction receipt"}
  Receipt -->|success| Confirmed[("wallet_transactions: confirmed")]
  Receipt -->|reverted| TxFailed[("wallet_transactions: failed")]
```
