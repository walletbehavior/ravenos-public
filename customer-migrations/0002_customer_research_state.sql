PRAGMA foreign_keys = ON;

-- Customer-authored research continuity only. This table deliberately excludes
-- provider payloads, wallet data, cohorts, alerts, and every execution object.
CREATE TABLE IF NOT EXISTS ravenos_customer_watch_items (
  watch_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.saved_exact_market.v1',
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  instrument_id TEXT NOT NULL,
  instrument_type TEXT NOT NULL CHECK (instrument_type IN ('exact_pool', 'perpetual', 'equity', 'etf')),
  identity_scope TEXT NOT NULL CHECK (identity_scope IN ('exact_pool', 'exact_instrument')),
  asset_class TEXT NOT NULL CHECK (asset_class IN ('crypto', 'equity', 'etf')),
  chain_id TEXT,
  venue_id TEXT NOT NULL,
  market_type TEXT NOT NULL CHECK (market_type IN ('spot', 'perpetual', 'listed')),
  base_symbol TEXT,
  quote_symbol TEXT,
  display_label TEXT NOT NULL,
  workspace_schema_version TEXT NOT NULL DEFAULT 'ravenos.saved_workspace.v1',
  timeframe TEXT NOT NULL CHECK (timeframe IN ('1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M')),
  indicators_json TEXT NOT NULL,
  raven_overlays_json TEXT NOT NULL,
  density TEXT NOT NULL CHECK (density IN ('compact', 'comfortable')),
  selected_panel TEXT NOT NULL CHECK (selected_panel IN ('chart', 'raven', 'book', 'trade', 'account')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  content_hash TEXT NOT NULL,
  availability_state TEXT NOT NULL CHECK (availability_state IN ('available', 'unavailable', 'superseded', 'unverified')),
  availability_reason TEXT,
  availability_checked_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, instrument_id)
);

CREATE INDEX IF NOT EXISTS ravenos_customer_watch_items_owner_updated_idx
  ON ravenos_customer_watch_items(user_id, updated_at DESC, watch_id);

CREATE TRIGGER IF NOT EXISTS ravenos_customer_watch_items_quota
BEFORE INSERT ON ravenos_customer_watch_items
WHEN
  (SELECT COUNT(*) FROM ravenos_customer_watch_items WHERE user_id = NEW.user_id) >= 100
  AND NOT EXISTS (
    SELECT 1 FROM ravenos_customer_watch_items
    WHERE user_id = NEW.user_id AND instrument_id = NEW.instrument_id
  )
BEGIN
  SELECT RAISE(ABORT, 'saved_research_quota_exceeded');
END;
