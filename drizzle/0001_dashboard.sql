CREATE TABLE IF NOT EXISTS "operational_wallets" (
  "id" uuid PRIMARY KEY,
  "scope_key" text NOT NULL,
  "merchant_id" uuid REFERENCES "merchants"("id") ON DELETE cascade,
  "purpose" text NOT NULL,
  "network" text NOT NULL,
  "token" text,
  "address" text NOT NULL,
  "private_key_encrypted" text NOT NULL,
  "label" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "operational_wallets_scope_unique"
  ON "operational_wallets" ("scope_key");

CREATE INDEX IF NOT EXISTS "operational_wallets_merchant_idx"
  ON "operational_wallets" ("merchant_id");

CREATE INDEX IF NOT EXISTS "operational_wallets_network_idx"
  ON "operational_wallets" ("network");

CREATE TABLE IF NOT EXISTS "wallet_transactions" (
  "id" uuid PRIMARY KEY,
  "merchant_id" uuid REFERENCES "merchants"("id") ON DELETE set null,
  "source_wallet_id" uuid NOT NULL REFERENCES "operational_wallets"("id") ON DELETE restrict,
  "network" text NOT NULL,
  "token" text,
  "asset" text NOT NULL,
  "tx_hash" text,
  "from_address" text NOT NULL,
  "to_address" text NOT NULL,
  "amount_raw" text NOT NULL,
  "amount_formatted" text NOT NULL,
  "status" text NOT NULL,
  "failure_reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "confirmed_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "wallet_transactions_source_idx"
  ON "wallet_transactions" ("source_wallet_id");

CREATE INDEX IF NOT EXISTS "wallet_transactions_status_idx"
  ON "wallet_transactions" ("status");

CREATE INDEX IF NOT EXISTS "wallet_transactions_network_idx"
  ON "wallet_transactions" ("network");
