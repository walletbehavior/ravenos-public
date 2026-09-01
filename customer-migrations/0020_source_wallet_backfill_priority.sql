PRAGMA foreign_keys = ON;

-- A large Nexus research universe must not make a trader wait behind bulk
-- indexing. Priority remains attached to the one shared public-wallet job;
-- no subscriber identity, policy, follower count, or execution authority is
-- copied into this queue.
ALTER TABLE ravenos_source_wallet_backfill_jobs
  ADD COLUMN demand_class TEXT NOT NULL DEFAULT 'indexed_research'
  CHECK (demand_class IN (
    'customer_watch',
    'saved_research',
    'interactive_lookup',
    'nexus_research',
    'indexed_research'
  ));

ALTER TABLE ravenos_source_wallet_backfill_jobs
  ADD COLUMN demand_priority INTEGER NOT NULL DEFAULT 100
  CHECK (demand_priority IN (100, 200, 300, 400, 500));

ALTER TABLE ravenos_source_wallet_backfill_jobs
  ADD COLUMN evidence_priority INTEGER NOT NULL DEFAULT 0
  CHECK (evidence_priority BETWEEN 0 AND 1000);

ALTER TABLE ravenos_source_wallet_backfill_jobs
  ADD COLUMN last_demand_at INTEGER NOT NULL DEFAULT 0
  CHECK (last_demand_at >= 0);

-- Preserve customer intent that predates this migration without retaining who
-- expressed it. A saved wallet outranks bulk research; any copy watch outranks
-- a save. Existing history cursors, attempts, leases, and retry timing remain
-- untouched.
UPDATE ravenos_source_wallet_backfill_jobs AS j
SET
  demand_class = 'saved_research',
  demand_priority = 400,
  last_demand_at = MAX(
    last_demand_at,
    COALESCE((
      SELECT MAX(s.updated_at)
      FROM ravenos_customer_wallet_research_saves AS s
      WHERE s.source_wallet_id = j.source_wallet_id
    ), 0)
  )
WHERE EXISTS (
  SELECT 1
  FROM ravenos_customer_wallet_research_saves AS s
  WHERE s.source_wallet_id = j.source_wallet_id
);

UPDATE ravenos_source_wallet_backfill_jobs AS j
SET
  demand_class = 'customer_watch',
  demand_priority = 500,
  last_demand_at = MAX(
    last_demand_at,
    COALESCE((
      SELECT MAX(w.updated_at)
      FROM ravenos_customer_wallet_copy_watches AS w
      WHERE w.source_wallet_id = j.source_wallet_id
    ), 0)
  )
WHERE EXISTS (
  SELECT 1
  FROM ravenos_customer_wallet_copy_watches AS w
  WHERE w.source_wallet_id = j.source_wallet_id
);

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

DROP INDEX IF EXISTS ravenos_source_wallet_backfill_due_idx;

CREATE INDEX ravenos_source_wallet_backfill_due_priority_idx
  ON ravenos_source_wallet_backfill_jobs(
    state,
    demand_priority DESC,
    evidence_priority DESC,
    next_attempt_at,
    created_at,
    job_id
  );

CREATE INDEX ravenos_source_wallet_backfill_profile_priority_idx
  ON ravenos_source_wallet_backfill_jobs(
    demand_priority DESC,
    evidence_priority DESC,
    updated_at,
    job_id
  )
  WHERE signatures_seen > 0;
