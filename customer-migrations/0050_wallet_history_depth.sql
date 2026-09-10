-- Align durable history counters with the existing 50,000-event policy.
-- D1 applies the replacement transactionally. Child evidence is copied before
-- removing the old parent because deferred foreign keys do not suppress CASCADE.
-- Source wallets, event history, profiles and financial ledgers are untouched.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE ravenos_m0050_backfill_pages AS SELECT * FROM ravenos_source_wallet_backfill_pages;
CREATE TABLE ravenos_m0050_reference_retries AS SELECT * FROM ravenos_wallet_reference_retries;

CREATE TABLE ravenos_source_wallet_backfill_jobs_m0050 (
  job_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.source_wallet_backfill_job.v1',
  source_wallet_id TEXT NOT NULL UNIQUE REFERENCES ravenos_source_wallets(source_wallet_id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('queued', 'leased', 'retry_wait', 'complete', 'bounded_partial', 'dead_letter')),
  provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 80),
  cursor_before TEXT CHECK (cursor_before IS NULL OR length(cursor_before) BETWEEN 64 AND 100),
  page_count INTEGER NOT NULL DEFAULT 0 CHECK (page_count BETWEEN 0 AND 10000),
  signatures_seen INTEGER NOT NULL DEFAULT 0 CHECK (signatures_seen BETWEEN 0 AND 50000),
  transactions_decoded INTEGER NOT NULL DEFAULT 0 CHECK (transactions_decoded BETWEEN 0 AND signatures_seen),
  decode_failures INTEGER NOT NULL DEFAULT 0 CHECK (decode_failures >= 0),
  history_exhausted INTEGER NOT NULL DEFAULT 0 CHECK (history_exhausted IN (0, 1)),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 100),
  next_attempt_at INTEGER NOT NULL CHECK (next_attempt_at >= 0),
  lease_token TEXT,
  lease_expires_at INTEGER,
  last_error_code TEXT CHECK (last_error_code IS NULL OR length(last_error_code) BETWEEN 1 AND 100),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  completed_at INTEGER,
  demand_class TEXT NOT NULL DEFAULT 'indexed_research'
  CHECK (demand_class IN (
    'customer_watch',
    'saved_research',
    'interactive_lookup',
    'nexus_research',
    'indexed_research'
  )),
  demand_priority INTEGER NOT NULL DEFAULT 100
  CHECK (demand_priority IN (100, 200, 300, 400, 500)),
  evidence_priority INTEGER NOT NULL DEFAULT 0
  CHECK (evidence_priority BETWEEN 0 AND 1000),
  last_demand_at INTEGER NOT NULL DEFAULT 0
  CHECK (last_demand_at >= 0),
  provider_cursor_json TEXT
  CHECK (provider_cursor_json IS NULL OR (json_valid(provider_cursor_json) AND length(provider_cursor_json) <= 16384)),
  history_target INTEGER NOT NULL DEFAULT 10000 CHECK (history_target BETWEEN 100 AND 50000),
  CHECK (job_id GLOB 'swb_*' AND length(job_id) BETWEEN 20 AND 100),
  CHECK ((state = 'leased') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (lease_token IS NULL OR length(lease_token) BETWEEN 20 AND 200),
  CHECK (history_exhausted = 0 OR state = 'complete'),
  CHECK (completed_at IS NULL OR completed_at >= created_at)
);

INSERT INTO ravenos_source_wallet_backfill_jobs_m0050 SELECT * FROM ravenos_source_wallet_backfill_jobs;
DELETE FROM ravenos_wallet_reference_retries;
DELETE FROM ravenos_source_wallet_backfill_pages;
DROP TABLE ravenos_source_wallet_backfill_jobs;
ALTER TABLE ravenos_source_wallet_backfill_jobs_m0050 RENAME TO ravenos_source_wallet_backfill_jobs;
INSERT INTO ravenos_source_wallet_backfill_pages SELECT * FROM ravenos_m0050_backfill_pages;
INSERT INTO ravenos_wallet_reference_retries SELECT * FROM ravenos_m0050_reference_retries;
DROP TABLE ravenos_m0050_backfill_pages;
DROP TABLE ravenos_m0050_reference_retries;

CREATE INDEX ravenos_source_wallet_backfill_due_priority_idx
  ON ravenos_source_wallet_backfill_jobs(
    state,
    demand_priority DESC,
    evidence_priority DESC,
    next_attempt_at,
    created_at,
    job_id
  );

CREATE INDEX ravenos_source_wallet_backfill_lease_idx
  ON ravenos_source_wallet_backfill_jobs(state, lease_expires_at, job_id);

CREATE INDEX ravenos_source_wallet_backfill_profile_priority_idx
  ON ravenos_source_wallet_backfill_jobs(
    demand_priority DESC,
    evidence_priority DESC,
    updated_at,
    job_id
  )
  WHERE signatures_seen > 0;

CREATE TRIGGER ravenos_source_wallet_backfill_demand_insert_guard
BEFORE INSERT ON ravenos_source_wallet_backfill_jobs
WHEN NOT (
  (NEW.demand_class = 'customer_watch' AND NEW.demand_priority = 500)
  OR (NEW.demand_class = 'saved_research' AND NEW.demand_priority = 400)
  OR (NEW.demand_class = 'interactive_lookup' AND NEW.demand_priority = 300)
  OR (NEW.demand_class = 'nexus_research' AND NEW.demand_priority = 200)
  OR (NEW.demand_class = 'indexed_research' AND NEW.demand_priority = 100)
)
BEGIN
  SELECT RAISE(ABORT, 'source_wallet_backfill_demand_priority_mismatch');
END;

CREATE TRIGGER ravenos_source_wallet_backfill_demand_update_guard
BEFORE UPDATE OF demand_class, demand_priority ON ravenos_source_wallet_backfill_jobs
WHEN NOT (
  (NEW.demand_class = 'customer_watch' AND NEW.demand_priority = 500)
  OR (NEW.demand_class = 'saved_research' AND NEW.demand_priority = 400)
  OR (NEW.demand_class = 'interactive_lookup' AND NEW.demand_priority = 300)
  OR (NEW.demand_class = 'nexus_research' AND NEW.demand_priority = 200)
  OR (NEW.demand_class = 'indexed_research' AND NEW.demand_priority = 100)
)
BEGIN
  SELECT RAISE(ABORT, 'source_wallet_backfill_demand_priority_mismatch');
END;

-- Resume only the diagnosed Solana jobs stopped exactly at the old ceiling.
-- Their saved cursors/counters are preserved; provider failures elsewhere and
-- active leases are not reset. Collection still uses the existing paid budget.
UPDATE ravenos_source_wallet_backfill_jobs
SET state='queued', attempt_count=0, completed_at=NULL, last_error_code=NULL,
    next_attempt_at=unixepoch(), updated_at=MAX(updated_at,unixepoch())
WHERE state='dead_letter' AND provider='helius_address_history'
  AND signatures_seen=10000 AND transactions_decoded=10000
  AND history_target>10000 AND history_exhausted=0
  AND last_error_code='source_wallet_backfill_provider_failed'
  AND source_wallet_id IN (SELECT source_wallet_id FROM ravenos_source_wallets WHERE chain='solana');
