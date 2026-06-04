# Testnet Setup

Testnets are supported as first-class network slugs:

- `sepolia`
- `bscTestnet`
- `polygonAmoy`
- `arbitrumSepolia`
- `optimismSepolia`
- `baseSepolia`

## Important Note About Testnet Tokens

There is no universal canonical USDT/USDC contract on every testnet. For reliable testing, use one of these approaches:

- Use a verified faucet token contract for the target testnet.
- Deploy your own ERC-20 mock token named USDT or USDC.
- Use Circle faucet USDC where available, then set that contract address.

The gateway only requires an ERC-20 contract address and decimals. The token symbol in this app is operational metadata for routing and treasury configuration.

## Configure Testnet Environment

```bash
cp .env.testnet.example .env.testnet
```

Fill:

- `ADMIN_API_KEY`
- `ENCRYPTION_MASTER_KEY_BASE64`
- `RPC_URL_<TESTNET>`
- `USDT_CONTRACT_<TESTNET>` or `USDC_CONTRACT_<TESTNET>`
- matching decimals
- `GAS_WALLET_PRIVATE_KEY_<TESTNET>`

Fund the gas wallet with native testnet gas.

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
2. Create a merchant with the admin API.
3. Create a merchant API key.
4. Configure webhook URL and secret.
5. Configure treasury wallet for the testnet/token pair.
6. Create a deposit address with the merchant API.
7. Send a small test token amount to the generated address.
8. Watch worker logs for detection, confirmation, gas top-up, and sweep.
9. Verify signed webhooks are received.
10. Verify the treasury wallet receives the swept token balance.

## Example Testnet Deposit Request

```json
{
  "network": "baseSepolia",
  "token": "USDC",
  "ttlSeconds": 3600,
  "externalId": "testnet-invoice-001",
  "metadata": {
    "environment": "testnet"
  },
  "qrFormat": "pngDataUrl"
}
```

## Scan From Block

Set `SCAN_FROM_BLOCK_<TESTNET>` close to your deployment block for faster first scans. If it is `0`, the worker may scan a large historical range in chunks before reaching current activity.

## Safe Testnet Defaults

Use low confirmation counts for testnets:

- Sepolia: `3`
- BSC Testnet: `6`
- L2 testnets: `12`

Use tiny token amounts first and confirm the webhook receiver handles duplicate-safe event IDs.
