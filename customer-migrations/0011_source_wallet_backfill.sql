PRAGMA foreign_keys = ON;

-- Deep public-wallet history is reconstructed once per exact source wallet.
-- This is operational queue state, not subscriber state. A job is complete
-- only when the provider returns an exhausted page; the 10,000-signature
-- safety ceiling remains explicitly bounded_partial.
CREATE TABLE ravenos_source_wallet_backfill_jobs (
  job_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.source_wallet_backfill_job.v1',
  source_wallet_id TEXT NOT NULL UNIQUE REFERENCES ravenos_source_wallets(source_wallet_id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('queued', 'leased', 'retry_wait', 'complete', 'bounded_partial', 'dead_letter')),
  provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 80),
  cursor_before TEXT CHECK (cursor_before IS NULL OR length(cursor_before) BETWEEN 64 AND 100),
  page_count INTEGER NOT NULL DEFAULT 0 CHECK (page_count BETWEEN 0 AND 10000),
  signatures_seen INTEGER NOT NULL DEFAULT 0 CHECK (signatures_seen BETWEEN 0 AND 10000),
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
  CHECK (job_id GLOB 'swb_*' AND length(job_id) BETWEEN 20 AND 100),
  CHECK ((state = 'leased') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (lease_token IS NULL OR length(lease_token) BETWEEN 20 AND 200),
  CHECK (history_exhausted = 0 OR state = 'complete'),
  CHECK (completed_at IS NULL OR completed_at >= created_at)
);

CREATE INDEX ravenos_source_wallet_backfill_due_idx
  ON ravenos_source_wallet_backfill_jobs(state, next_attempt_at, created_at, job_id);
CREATE INDEX ravenos_source_wallet_backfill_lease_idx
  ON ravenos_source_wallet_backfill_jobs(state, lease_expires_at, job_id);

-- Every provider page attempt is append-only evidence. It stores only hashed
-- cursor references and normalized counts, never raw RPC responses or decoded
-- transaction material.
CREATE TABLE ravenos_source_wallet_backfill_pages (
  page_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.source_wallet_backfill_page.v1',
  job_id TEXT NOT NULL REFERENCES ravenos_source_wallet_backfill_jobs(job_id) ON DELETE CASCADE,
  source_wallet_id TEXT NOT NULL REFERENCES ravenos_source_wallets(source_wallet_id) ON DELETE CASCADE,
  cursor_before_reference TEXT NOT NULL CHECK (length(cursor_before_reference) BETWEEN 4 AND 80),
  next_cursor_reference TEXT CHECK (next_cursor_reference IS NULL OR length(next_cursor_reference) BETWEEN 20 AND 80),
  state TEXT NOT NULL CHECK (state IN ('complete', 'partial')),
  signature_count INTEGER NOT NULL CHECK (signature_count BETWEEN 0 AND 100),
  decoded_count INTEGER NOT NULL CHECK (decoded_count BETWEEN 0 AND signature_count),
  failure_count INTEGER NOT NULL CHECK (failure_count = signature_count - decoded_count),
  history_exhausted INTEGER NOT NULL CHECK (history_exhausted IN (0, 1)),
  page_hash TEXT NOT NULL CHECK (length(page_hash) = 40),
  provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 80),
  evidence_json TEXT NOT NULL CHECK (
    json_valid(evidence_json)
    AND length(evidence_json) <= 16384
    AND json_extract(evidence_json, '$.raw_provider_payload_persisted') = 0
    AND json_extract(evidence_json, '$.transaction_material_persisted') = 0
    AND json_extract(evidence_json, '$.subscriber_identity_included') = 0
  ),
  observed_at INTEGER NOT NULL CHECK (observed_at >= 0),
  CHECK (page_id GLOB 'swbp_*' AND length(page_id) BETWEEN 20 AND 100)
);

CREATE INDEX ravenos_source_wallet_backfill_pages_job_idx
  ON ravenos_source_wallet_backfill_pages(job_id, observed_at DESC, page_id);
CREATE INDEX ravenos_source_wallet_backfill_pages_source_idx
  ON ravenos_source_wallet_backfill_pages(source_wallet_id, observed_at DESC, page_id);

CREATE TRIGGER ravenos_source_wallet_backfill_pages_append_only
BEFORE UPDATE ON ravenos_source_wallet_backfill_pages
BEGIN
  SELECT RAISE(ABORT, 'source_wallet_backfill_page_append_only');
END;

CREATE TABLE ravenos_source_wallet_backfill_runs (
  run_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.source_wallet_backfill_run.v1',
  worker_id TEXT NOT NULL CHECK (length(worker_id) BETWEEN 1 AND 100),
  started_at INTEGER NOT NULL CHECK (started_at >= 0),
  completed_at INTEGER NOT NULL CHECK (completed_at >= started_at),
  run_json TEXT NOT NULL CHECK (json_valid(run_json) AND length(run_json) <= 16384),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (run_id GLOB 'swbr_*' AND length(run_id) BETWEEN 20 AND 100)
);

CREATE INDEX ravenos_source_wallet_backfill_runs_time_idx
  ON ravenos_source_wallet_backfill_runs(completed_at DESC, run_id);

CREATE TRIGGER ravenos_source_wallet_backfill_runs_append_only
BEFORE UPDATE ON ravenos_source_wallet_backfill_runs
BEGIN
  SELECT RAISE(ABORT, 'source_wallet_backfill_run_append_only');
END;
