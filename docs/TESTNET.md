# Testnet Setup

Testnets are supported as first-class network slugs:

- `sepolia`
- `bscTestnet`
- `polygonAmoy`
- `arbitrumSepolia`
- `optimismSepolia`
- `baseSepolia`
- `avalancheFuji`
- `lineaSepolia`
- `scrollSepolia`
- `nile`

## Important Note About Testnet Tokens

There is no universal canonical USDT contract on every EVM or TRON testnet. The bundled testnet config uses real test ERC-20/TRC-20 contracts that are good enough to exercise address generation, detection, callbacks, gas top-up, and sweep flows. For production-like acceptance tests, verify faucet and mint availability before relying on a token.

For reliable testing, use one of these approaches:

- Use a verified faucet token contract for the target testnet.
- Deploy your own ERC-20 mock token named USDT or USDC.
- Use Circle faucet USDC where available, then set that contract address.

The gateway only requires an ERC-20 or TRC-20 contract address and decimals. The token symbol in this app is operational metadata for routing and treasury configuration.

## Bundled Testnet Token Matrix

`config/networks.testnet.example.json` is prefilled with:

| Network | USDT | USDT decimals | USDC | USDC decimals |
| --- | --- | ---: | --- | ---: |
| `sepolia` | `0x27cea6eb8a21aae05eb29c91c5ca10592892f584` | 6 | `0x1c7d4b196cb0c7b01d743fbc6116a902379c7238` | 6 |
| `bscTestnet` | `0xe37bdc6f09dab6ce6e4ebc4d2e72792994ef3765` | 6 | `0x64544969ed7ebf5f083679233325356ebe738930` | 18 |
| `polygonAmoy` | `0xc29312dcfd763e61f72dc854a829bfa2259a1d92` | 6 | `0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582` | 6 |
| `arbitrumSepolia` | `0x3dd1a7a99cfa2554da8b3483e6ed739120fc35cb` | 8 | `0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d` | 6 |
| `optimismSepolia` | `0xc04d2869665be874881133943523723be5782720` | 18 | `0x5fd84259d66cd46123540766be93dfe6d43130d7` | 6 |
| `baseSepolia` | `0x915052b4ada5354939272639cdf0246405f78162` | 6 | `0x036cbd53842c5426634e7929541ec2318f3dcf7e` | 6 |
| `avalancheFuji` | `0x144843929df063312a083db6f0a0ff5697abed4a` | 6 | `0x5425890298aed601595a70ab815c96711a31bc65` | 6 |
| `lineaSepolia` | `0xf63d68323401584018f5b98e109eb3dee5b77492` | 6 | `0xfece4462d57bd51a6a552365a011b95f0e16d9b7` | 6 |
| `scrollSepolia` | `0x03c262b4a2374888c7c70506d248b0bbb2b888ac` | 6 | blank | - |
| `nile` | `TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf` | 6 | blank | - |

Circle-published USDC addresses are used where available. Chainflip and Stargate testnet token addresses are used for several USDT routes. Remaining USDT entries are verified/mock test contracts whose decimals were checked by RPC.

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

The checked-in `.env.testnet.example` keeps RPC values blank. The local ignored `.env.testnet` in this workspace is prefilled with public RPC URLs for the bundled testnets so you can run `npm run dev:testnet` immediately after funding/generated wallet setup.

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
  "token": "USDT",
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
- Avalanche Fuji: `6`
- L2 testnets: `12`

Use tiny token amounts first and confirm the webhook receiver handles duplicate-safe event IDs.
