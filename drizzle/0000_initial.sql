CREATE TABLE IF NOT EXISTS merchants (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS merchant_api_keys (
  id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  public_key text NOT NULL,
  secret_encrypted text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS merchant_api_keys_public_key_unique ON merchant_api_keys(public_key);
CREATE INDEX IF NOT EXISTS merchant_api_keys_merchant_idx ON merchant_api_keys(merchant_id);

CREATE TABLE IF NOT EXISTS request_nonces (
  api_key_id uuid NOT NULL REFERENCES merchant_api_keys(id) ON DELETE CASCADE,
  nonce text NOT NULL,
  timestamp timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (api_key_id, nonce)
);

CREATE TABLE IF NOT EXISTS webhook_configs (
  merchant_id uuid PRIMARY KEY REFERENCES merchants(id) ON DELETE CASCADE,
  url text NOT NULL,
  secret_encrypted text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS treasury_wallets (
  id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  network text NOT NULL,
  token text NOT NULL,
  address text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS treasury_wallets_merchant_asset_unique ON treasury_wallets(merchant_id, network, token);

CREATE TABLE IF NOT EXISTS deposit_addresses (
  id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  network text NOT NULL,
  token text NOT NULL,
  address text NOT NULL,
  private_key_encrypted text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  expires_at timestamptz NOT NULL,
  external_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS deposit_addresses_address_asset_unique ON deposit_addresses(network, token, address);
CREATE INDEX IF NOT EXISTS deposit_addresses_merchant_idx ON deposit_addresses(merchant_id);
CREATE INDEX IF NOT EXISTS deposit_addresses_external_idx ON deposit_addresses(merchant_id, external_id);

CREATE TABLE IF NOT EXISTS chain_cursors (
  network text NOT NULL,
  token text NOT NULL,
  last_scanned_block bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (network, token)
);

CREATE TABLE IF NOT EXISTS token_transfers (
  id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  deposit_address_id uuid NOT NULL REFERENCES deposit_addresses(id) ON DELETE CASCADE,
  network text NOT NULL,
  token text NOT NULL,
  tx_hash text NOT NULL,
  log_index integer NOT NULL,
  from_address text NOT NULL,
  to_address text NOT NULL,
  amount_raw text NOT NULL,
  amount_formatted text NOT NULL,
  block_number bigint NOT NULL,
  block_hash text,
  confirmations integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'detected',
  detected_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS token_transfers_chain_log_unique ON token_transfers(network, tx_hash, log_index);
CREATE INDEX IF NOT EXISTS token_transfers_deposit_idx ON token_transfers(deposit_address_id);
CREATE INDEX IF NOT EXISTS token_transfers_status_idx ON token_transfers(status);

CREATE TABLE IF NOT EXISTS gas_top_ups (
  id uuid PRIMARY KEY,
  transfer_id uuid NOT NULL REFERENCES token_transfers(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  deposit_address_id uuid NOT NULL REFERENCES deposit_addresses(id) ON DELETE CASCADE,
  network text NOT NULL,
  tx_hash text,
  amount_wei text NOT NULL,
  status text NOT NULL,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS gas_top_ups_transfer_unique ON gas_top_ups(transfer_id);
CREATE INDEX IF NOT EXISTS gas_top_ups_status_idx ON gas_top_ups(status);

CREATE TABLE IF NOT EXISTS sweeps (
  id uuid PRIMARY KEY,
  transfer_id uuid NOT NULL REFERENCES token_transfers(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  deposit_address_id uuid NOT NULL REFERENCES deposit_addresses(id) ON DELETE CASCADE,
  network text NOT NULL,
  token text NOT NULL,
  tx_hash text,
  amount_raw text NOT NULL,
  amount_formatted text NOT NULL,
  to_address text NOT NULL,
  status text NOT NULL,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS sweeps_transfer_unique ON sweeps(transfer_id);
CREATE INDEX IF NOT EXISTS sweeps_status_idx ON sweeps(status);

CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  type text NOT NULL,
  url text NOT NULL,
  secret_encrypted text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  response_status integer,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_events_due_idx ON webhook_events(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS webhook_events_merchant_idx ON webhook_events(merchant_id);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  route text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  response_status integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idempotency_keys_route_key_unique ON idempotency_keys(merchant_id, route, key);
