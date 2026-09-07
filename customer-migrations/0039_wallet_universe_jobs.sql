-- Shared public-market observation frontier. No subscriber or signer data.
CREATE TABLE ravenos_wallet_universe_markets (
  market_id TEXT PRIMARY KEY,
  chain TEXT NOT NULL CHECK (chain IN ('solana','robinhood','base','ethereum','bsc')),
  identity_json TEXT NOT NULL CHECK (json_valid(identity_json) AND length(identity_json) < 2000),
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  next_scan_at INTEGER NOT NULL,
  lease_token TEXT,
  lease_expires_at INTEGER,
  scan_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_wallet_count INTEGER,
  last_error TEXT,
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL))
);
CREATE INDEX ravenos_wallet_universe_due ON ravenos_wallet_universe_markets(next_scan_at,chain,market_id);
-- Prevent simultaneous cold lookups from multiplying paid provider calls.
CREATE TABLE ravenos_wallet_lookup_leases (
  source_wallet_id TEXT PRIMARY KEY,
  lease_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
-- Durable per-hour budget shared by scheduler/overlapping Worker instances.
CREATE TABLE ravenos_wallet_universe_budget (
  hour_start INTEGER PRIMARY KEY,
  used_requests INTEGER NOT NULL CHECK (used_requests >= 0)
);
CREATE TABLE ravenos_wallet_universe_runs (
  run_id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  attempted INTEGER NOT NULL,
  succeeded INTEGER NOT NULL,
  wallets_observed INTEGER NOT NULL,
  failure_count INTEGER NOT NULL,
  report_json TEXT NOT NULL CHECK (json_valid(report_json))
);
