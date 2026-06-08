# Testnet Setup

Testnets are supported as first-class network slugs:

- `sepolia`
- `bscTestnet`
- `polygonAmoy`
- `arbitrumSepolia`
- `optimismSepolia`
- `baseSepolia`
- `nile`

## Important Note About Testnet Tokens

There is no universal canonical USDT/USDC contract on every EVM or TRON testnet. For reliable testing, use one of these approaches:

- Use a verified faucet token contract for the target testnet.
- Deploy your own ERC-20 mock token named USDT or USDC.
- Use Circle faucet USDC where available, then set that contract address.

The gateway only requires an ERC-20 or TRC-20 contract address and decimals. The token symbol in this app is operational metadata for routing and treasury configuration.

## Configure Testnet Environment

```bash
cp .env.testnet.example .env.testnet
cp config/networks.testnet.example.json config/networks.testnet.local.json
```

Fill `.env.testnet`:

- `ADMIN_API_KEY`
- `ADMIN_DASHBOARD_USERNAME`
- `ADMIN_DASHBOARD_PASSWORD`
- `ADMIN_SESSION_SECRET`
- `ENCRYPTION_MASTER_KEY_BASE64`
- `RPC_URL_<TESTNET>`
- `EVENT_SERVER_URL_<TESTNET>` for TRON networks when the event server differs from the full node
- `GAS_WALLET_PRIVATE_KEY_<TESTNET>` or generate a gas wallet in `/dashboard`

Fill `config/networks.testnet.local.json`:

- `USDT` or `USDC` `contractAddress` for any enabled testnet
- matching decimals
- confirmations
- `scanFromBlock`
- `maxScanBlocks`
- gas balance and top-up thresholds

Fund the configured or generated gas wallet with native testnet gas.

## Run Testnet Stack With Docker

```bash
docker compose -f docker-compose.yml -f docker-compose.testnet.yml up --build
```

This starts Postgres, runs migrations, starts the API, and starts the worker using `.env.testnet`.

Validate the testnet Compose config:

```bash
APP_ENV_FILE=.env.testnet.example docker compose -f docker-compose.yml -f docker-compose.testnet.yml config
```

## Testnet Smoke Flow

1. Start the stack.
2. Open `/dashboard` or use the admin API.
3. Create an owner API key in the dashboard, or call `POST /admin/api-keys`.
4. Store the one-time API secret shown in the response.
5. Generate or register a treasury wallet for the testnet/token pair.
6. Generate a gas wallet in the dashboard if no env gas wallet is configured.
7. Create a deposit address with the Deposit API, including `callbackUrl` and `callbackSecret`.
8. Send a small test token amount to the generated address.
9. Watch worker logs for detection, confirmation, gas top-up, and sweep.
10. Verify signed callbacks are received.
11. Verify the treasury wallet receives the swept token balance.

## Example Testnet Deposit Request

```json
{
  "network": "baseSepolia",
  "token": "USDC",
  "callbackUrl": "https://app.example/webhooks/crypto/testnet-invoice-001",
  "callbackSecret": "testnet-invoice-001-callback-secret",
  "ttlSeconds": 3600,
  "externalId": "testnet-invoice-001",
  "metadata": {
    "environment": "testnet"
  },
  "qrFormat": "pngDataUrl"
}
```

TRON Nile example:

```json
{
  "network": "nile",
  "token": "USDT",
  "callbackUrl": "https://app.example/webhooks/crypto/nile-invoice-001",
  "callbackSecret": "nile-invoice-001-callback-secret",
  "ttlSeconds": 3600,
  "externalId": "nile-invoice-001",
  "metadata": {
    "environment": "testnet"
  },
  "qrFormat": "pngDataUrl"
}
```

## Scan From Block

Set `networks.<testnet>.scanFromBlock` in `config/networks.testnet.local.json` close to your deployment block for faster first scans. If it is `0`, the worker may scan a large historical range in chunks before reaching current activity.

## Safe Testnet Defaults

Use low confirmation counts for testnets:

- Sepolia: `3`
- BSC Testnet: `6`
- L2 testnets: `12`

Use tiny token amounts first and confirm the webhook receiver handles duplicate-safe event IDs.
