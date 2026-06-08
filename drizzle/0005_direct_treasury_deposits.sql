ALTER TABLE deposit_addresses
  ADD COLUMN IF NOT EXISTS flow text NOT NULL DEFAULT 'temporary_wallet';

ALTER TABLE deposit_addresses
  ALTER COLUMN private_key_encrypted DROP NOT NULL;

ALTER TABLE deposit_addresses
  ADD COLUMN IF NOT EXISTS requested_amount_raw text,
  ADD COLUMN IF NOT EXISTS requested_amount_formatted text,
  ADD COLUMN IF NOT EXISTS received_amount_raw text,
  ADD COLUMN IF NOT EXISTS received_amount_formatted text,
  ADD COLUMN IF NOT EXISTS match_status text,
  ADD COLUMN IF NOT EXISTS matched_transfer_id uuid,
  ADD COLUMN IF NOT EXISTS match_source text,
  ADD COLUMN IF NOT EXISTS matched_at timestamp with time zone;

UPDATE deposit_addresses
SET flow = 'temporary_wallet'
WHERE flow IS NULL;

DROP INDEX IF EXISTS deposit_addresses_address_asset_unique;

CREATE UNIQUE INDEX IF NOT EXISTS deposit_addresses_address_asset_unique
  ON deposit_addresses(network, token, address)
  WHERE flow = 'temporary_wallet';

CREATE INDEX IF NOT EXISTS deposit_addresses_direct_match_idx
  ON deposit_addresses(merchant_id, network, token, treasury_wallet_id, flow, status, match_status);

CREATE TABLE IF NOT EXISTS treasury_transfers (
  id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  treasury_wallet_id uuid NOT NULL REFERENCES treasury_wallets(id) ON DELETE CASCADE,
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
  status text NOT NULL,
  candidate_deposit_address_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  matched_deposit_address_id uuid REFERENCES deposit_addresses(id) ON DELETE SET NULL,
  match_source text,
  detected_at timestamp with time zone NOT NULL DEFAULT now(),
  matched_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS treasury_transfers_chain_log_unique
  ON treasury_transfers(network, tx_hash, log_index);

CREATE INDEX IF NOT EXISTS treasury_transfers_merchant_idx
  ON treasury_transfers(merchant_id);

CREATE INDEX IF NOT EXISTS treasury_transfers_treasury_idx
  ON treasury_transfers(treasury_wallet_id);

CREATE INDEX IF NOT EXISTS treasury_transfers_status_idx
  ON treasury_transfers(status);
