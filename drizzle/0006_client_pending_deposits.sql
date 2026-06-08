ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS reject_duplicate_client_pending_deposits boolean NOT NULL DEFAULT true;

ALTER TABLE deposit_addresses
  ADD COLUMN IF NOT EXISTS client_id text;

UPDATE deposit_addresses
SET client_id = COALESCE(NULLIF(external_id, ''), id::text)
WHERE client_id IS NULL OR client_id = '';

ALTER TABLE deposit_addresses
  ALTER COLUMN client_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS deposit_addresses_client_status_idx
  ON deposit_addresses(merchant_id, client_id, status);
