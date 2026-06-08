# Docker and Compose

This project ships a production-style Dockerfile and a Docker Compose stack for local or testnet runs.

## Services

`docker-compose.yml` starts:

- `db`: Postgres 17 with a persistent named volume.
- `migrate`: one-shot migration service that runs `node dist/db/migrate.js`.
- `api`: Hono API server on port `3000`.
- `worker`: background worker for chain polling, webhooks, gas top-ups, and sweeps.

The API and worker use the same image but different commands.

## Quick Start

```bash
cp .env.example .env
cp config/networks.example.json config/networks.local.json
```

Fill the required environment and secret values in `.env`:

- `ADMIN_API_KEY`
- `ADMIN_DASHBOARD_USERNAME`
- `ADMIN_DASHBOARD_PASSWORD`
- `ADMIN_SESSION_SECRET`
- `ENCRYPTION_MASTER_KEY_BASE64`
- at least one `RPC_URL_*`
- gas wallet private key or a generated dashboard gas wallet for any network that needs automatic gas top-ups

Fill the business network settings in `config/networks.local.json`:

- at least one token contract and decimals for any network with an `RPC_URL_*`
- confirmations
- `scanFromBlock`
- `maxScanBlocks`
- gas balance and top-up thresholds

Then run:

```bash
docker compose up --build
```

The API will be available at:

```text
http://localhost:3000
```

The dashboard will be available at:

```text
http://localhost:3000/dashboard
```

Postgres is reachable from your host at:

```text
postgres://postgres:postgres@localhost:5432/crypto_payment
```

Inside Compose containers, the app still uses `postgres://postgres:postgres@db:5432/crypto_payment`.

Health check:

```bash
curl http://localhost:3000/health
```

## Common Commands

Run in foreground:

```bash
docker compose up --build
```

Run in background:

```bash
docker compose up --build -d
```

Show logs:

```bash
docker compose logs -f api worker
```

Stop services:

```bash
docker compose down
```

Stop and remove Postgres data:

```bash
docker compose down -v
```

Run migrations again:

```bash
docker compose run --rm migrate
```

Validate Compose without a local `.env`:

```bash
APP_ENV_FILE=.env.example docker compose config
```

Use a different host database port if `5432` is busy:

```bash
POSTGRES_HOST_PORT=5433 docker compose up -d db
```

## Production Notes

- Do not use the Compose default Postgres password in production.
- Prefer managed Postgres for production.
- Treat gas wallet private keys, dashboard-generated wallet keys, and the encryption master key as production secrets.
- Keep API and worker as separate processes.
- Run only one worker until Postgres advisory locks are added for multi-worker scan coordination.
- Monitor worker logs, webhook failures, gas wallet balances, and stuck submitted transactions.
