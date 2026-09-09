-- Shared public market read model. This is not a trading/accounting ledger.
CREATE TABLE IF NOT EXISTS ravenos_participation_snapshot (
  scope TEXT PRIMARY KEY CHECK (scope = 'onchain'),
  body_json TEXT,
  updated_at INTEGER NOT NULL DEFAULT 0,
  next_refresh_at INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_expires_at INTEGER NOT NULL DEFAULT 0
);
