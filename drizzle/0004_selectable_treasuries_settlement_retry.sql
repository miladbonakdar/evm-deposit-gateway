ALTER TABLE treasury_wallets
  ADD COLUMN IF NOT EXISTS label text;

UPDATE treasury_wallets
SET label = network || ' ' || token || ' treasury'
WHERE label IS NULL OR label = '';

ALTER TABLE treasury_wallets
  ALTER COLUMN label SET NOT NULL;

ALTER TABLE treasury_wallets
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

ALTER TABLE treasury_wallets
  ADD COLUMN IF NOT EXISTS operational_wallet_id uuid REFERENCES operational_wallets(id) ON DELETE SET NULL;

DROP INDEX IF EXISTS treasury_wallets_merchant_asset_unique;

UPDATE treasury_wallets
SET is_default = true
WHERE is_default = false;

CREATE UNIQUE INDEX IF NOT EXISTS treasury_wallets_merchant_asset_address_unique
  ON treasury_wallets(merchant_id, network, token, address);

CREATE UNIQUE INDEX IF NOT EXISTS treasury_wallets_default_unique
  ON treasury_wallets(merchant_id, network, token)
  WHERE is_default = true;

ALTER TABLE deposit_addresses
  ADD COLUMN IF NOT EXISTS treasury_wallet_id uuid REFERENCES treasury_wallets(id) ON DELETE SET NULL;

UPDATE deposit_addresses AS deposit
SET treasury_wallet_id = treasury.id
FROM treasury_wallets AS treasury
WHERE deposit.treasury_wallet_id IS NULL
  AND treasury.merchant_id = deposit.merchant_id
  AND treasury.network = deposit.network
  AND treasury.token = deposit.token
  AND treasury.is_default = true;

ALTER TABLE token_transfers
  ADD COLUMN IF NOT EXISTS settlement_status text NOT NULL DEFAULT 'pending';

ALTER TABLE token_transfers
  ADD COLUMN IF NOT EXISTS settlement_step text;

ALTER TABLE token_transfers
  ADD COLUMN IF NOT EXISTS settlement_failure_reason text;

ALTER TABLE token_transfers
  ADD COLUMN IF NOT EXISTS settlement_updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE gas_top_ups
  ADD COLUMN IF NOT EXISTS attempt_number integer NOT NULL DEFAULT 1;

DROP INDEX IF EXISTS gas_top_ups_transfer_unique;

CREATE UNIQUE INDEX IF NOT EXISTS gas_top_ups_transfer_attempt_unique
  ON gas_top_ups(transfer_id, attempt_number);

CREATE INDEX IF NOT EXISTS gas_top_ups_transfer_idx
  ON gas_top_ups(transfer_id);

ALTER TABLE sweeps
  ADD COLUMN IF NOT EXISTS attempt_number integer NOT NULL DEFAULT 1;

DROP INDEX IF EXISTS sweeps_transfer_unique;

CREATE UNIQUE INDEX IF NOT EXISTS sweeps_transfer_attempt_unique
  ON sweeps(transfer_id, attempt_number);

CREATE INDEX IF NOT EXISTS sweeps_transfer_idx
  ON sweeps(transfer_id);
