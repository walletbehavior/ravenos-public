-- Existing shared backfill queue, now with provider-specific resumable cursors.
-- Tokens and pinned block boundaries stay server-side; public evidence holds hashes.
ALTER TABLE ravenos_source_wallet_backfill_jobs ADD COLUMN provider_cursor_json TEXT
  CHECK (provider_cursor_json IS NULL OR (json_valid(provider_cursor_json) AND length(provider_cursor_json) <= 16384));

CREATE INDEX ravenos_wallet_event_decode_revision_idx
  ON ravenos_source_wallet_events(source_wallet_id,transaction_reference,decode_version);
-- Retain older decoding evidence; counts and activity select one revision.
CREATE VIEW ravenos_wallet_latest_events AS
  SELECT e.* FROM ravenos_source_wallet_events e WHERE NOT EXISTS (
    SELECT 1 FROM ravenos_source_wallet_events newer
    WHERE newer.source_wallet_id=e.source_wallet_id
      AND newer.transaction_reference=e.transaction_reference
      AND newer.decode_version>e.decode_version
  );

-- Public historical FX evidence is shared across wallets and retained separately
-- from immutable transaction evidence and from Raven fee/reward accounting.
CREATE TABLE ravenos_wallet_historical_prices (
  symbol TEXT NOT NULL CHECK (symbol IN ('ETH','SOL','BNB')),
  bucket_at INTEGER NOT NULL,
  price_usd TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  provider TEXT NOT NULL,
  PRIMARY KEY (symbol, bucket_at)
);

CREATE TABLE ravenos_wallet_price_windows (
  symbol TEXT NOT NULL CHECK (symbol IN ('ETH','SOL','BNB')),
  day_at INTEGER NOT NULL,
  retry_after INTEGER NOT NULL,
  PRIMARY KEY (symbol, day_at)
);
