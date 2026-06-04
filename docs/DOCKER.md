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
```

Fill the required values in `.env`:

- `ADMIN_API_KEY`
- `ENCRYPTION_MASTER_KEY_BASE64`
- at least one `RPC_URL_*`
- at least one token contract and decimals for that network
- gas wallet private key for any network that needs automatic gas top-ups

Then run:

```bash
docker compose up --build
```

The API will be available at:

```text
http://localhost:3000
```

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

## Production Notes

- Do not use the Compose default Postgres password in production.
- Prefer managed Postgres for production.
- Treat gas wallet private keys as production secrets.
- Keep API and worker as separate processes.
- Run only one worker until Postgres advisory locks are added for multi-worker scan coordination.
- Monitor worker logs, webhook failures, gas wallet balances, and stuck submitted transactions.
