ALTER TABLE deposit_addresses
  ADD COLUMN IF NOT EXISTS callback_url text;

ALTER TABLE deposit_addresses
  ADD COLUMN IF NOT EXISTS callback_secret_encrypted text;

ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS deposit_address_id uuid REFERENCES deposit_addresses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS webhook_events_deposit_address_idx
  ON webhook_events(deposit_address_id);
