-- Widen only the receipt page-size check. Existing receipt rows/hashes survive.
-- D1 applies this migration as one transaction; no child table references pages.
CREATE TABLE ravenos_backfill_pages_v2 (
  page_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.source_wallet_backfill_page.v1',
  job_id TEXT NOT NULL REFERENCES ravenos_source_wallet_backfill_jobs(job_id) ON DELETE CASCADE,
  source_wallet_id TEXT NOT NULL REFERENCES ravenos_source_wallets(source_wallet_id) ON DELETE CASCADE,
  cursor_before_reference TEXT NOT NULL CHECK (length(cursor_before_reference) BETWEEN 4 AND 80),
  next_cursor_reference TEXT CHECK (next_cursor_reference IS NULL OR length(next_cursor_reference) BETWEEN 20 AND 80),
  state TEXT NOT NULL CHECK (state IN ('complete', 'partial')),
  signature_count INTEGER NOT NULL CHECK (signature_count BETWEEN 0 AND 1000),
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

INSERT INTO ravenos_backfill_pages_v2 SELECT * FROM ravenos_source_wallet_backfill_pages;
DROP TABLE ravenos_source_wallet_backfill_pages;
ALTER TABLE ravenos_backfill_pages_v2 RENAME TO ravenos_source_wallet_backfill_pages;

CREATE INDEX ravenos_source_wallet_backfill_pages_job_idx
  ON ravenos_source_wallet_backfill_pages(job_id, observed_at DESC, page_id);
CREATE INDEX ravenos_source_wallet_backfill_pages_source_idx
  ON ravenos_source_wallet_backfill_pages(source_wallet_id, observed_at DESC, page_id);

CREATE TRIGGER ravenos_source_wallet_backfill_pages_append_only
BEFORE UPDATE ON ravenos_source_wallet_backfill_pages
BEGIN
  SELECT RAISE(ABORT, 'source_wallet_backfill_page_append_only');
END;

ALTER TABLE ravenos_public_wallet_list_refresh ADD COLUMN last_error_code TEXT;
-- Retry with provider-health evidence after this update; keep prior identities.
UPDATE ravenos_public_wallet_list_refresh SET next_refresh_at=0 WHERE state='unavailable';
