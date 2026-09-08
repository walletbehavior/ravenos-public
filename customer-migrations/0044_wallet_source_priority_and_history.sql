-- Public discovery provenance extends the existing chain/address registry.
-- Provider labels are intake evidence, never Raven performance or Copy scores.
ALTER TABLE ravenos_source_wallets ADD COLUMN discovery_priority INTEGER NOT NULL DEFAULT 0 CHECK (discovery_priority BETWEEN 0 AND 1000);
ALTER TABLE ravenos_source_wallets ADD COLUMN discovery_priority_expires_at INTEGER NOT NULL DEFAULT 0;
CREATE TABLE ravenos_wallet_discovery_sources (
  source_wallet_id TEXT NOT NULL REFERENCES ravenos_source_wallets(source_wallet_id),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('kol','smart_money','top_holder','top_trader','active_trader')),
  provider TEXT NOT NULL,
  source_reference TEXT NOT NULL CHECK (length(source_reference) <= 500),
  source_rank INTEGER CHECK (source_rank BETWEEN 1 AND 100000),
  priority INTEGER NOT NULL CHECK (priority BETWEEN 0 AND 1000),
  observed_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (source_wallet_id,source_kind,provider,source_reference)
);
CREATE INDEX ravenos_wallet_discovery_sources_priority ON ravenos_wallet_discovery_sources(priority DESC,expires_at,source_wallet_id);
CREATE INDEX ravenos_wallet_registry_priority ON ravenos_source_wallets(discovery_priority DESC,discovery_priority_expires_at,source_wallet_id);

-- Deep requests retain up to 50,000 Solana events; bulk intake can warm 1,000.
-- A promotion resumes the same job/cursor. Existing decoded evidence survives.
ALTER TABLE ravenos_source_wallet_backfill_jobs ADD COLUMN history_target INTEGER NOT NULL DEFAULT 10000 CHECK (history_target BETWEEN 100 AND 50000);
UPDATE ravenos_source_wallet_backfill_jobs SET history_target=50000
WHERE demand_priority>=300 AND source_wallet_id IN (SELECT source_wallet_id FROM ravenos_source_wallets WHERE chain='solana');
UPDATE ravenos_source_wallet_backfill_jobs SET state='queued',completed_at=NULL,next_attempt_at=unixepoch()
WHERE state='bounded_partial' AND history_exhausted=0 AND signatures_seen<history_target;

-- Query-time keyset pagination reads stored history without sorting the archive.
CREATE INDEX ravenos_wallet_event_activity_order ON ravenos_source_wallet_events(source_wallet_id,COALESCE(block_time,chain_event_time,observed_at) DESC,event_id DESC);
CREATE INDEX ravenos_wallet_event_filtered_activity_order ON ravenos_source_wallet_events(source_wallet_id,classification,COALESCE(block_time,chain_event_time,observed_at) DESC,event_id DESC);

-- Reservation uses worst-case documented credits, before any Helius request.
CREATE TABLE ravenos_wallet_history_budget (
  hour_start INTEGER PRIMARY KEY,
  reserved_credits INTEGER NOT NULL CHECK (reserved_credits>=0)
);

-- Public-list reads are shared across users and Workers, not done by browsers.
CREATE TABLE ravenos_public_wallet_list_refresh (
  provider TEXT PRIMARY KEY,
  next_refresh_at INTEGER NOT NULL,
  last_success_at INTEGER,
  wallet_count INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','refreshing','current','unavailable'))
);
