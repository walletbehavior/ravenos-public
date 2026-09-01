PRAGMA foreign_keys = ON;

-- Broad Nexus coverage can produce more candidates than the bounded Raven
-- hydrator can inspect immediately. This rebuildable, public-chain-only score
-- ranks stronger exact economic evidence and asset breadth ahead of raw event
-- volume. It is not profitability, safety, identity, or copyability evidence.
ALTER TABLE ravenos_source_wallet_discovery_candidates
  ADD COLUMN research_priority_score INTEGER NOT NULL DEFAULT 0
  CHECK (research_priority_score BETWEEN 0 AND 1000);

ALTER TABLE ravenos_source_wallet_discovery_candidates
  ADD COLUMN research_priority_version INTEGER NOT NULL DEFAULT 1
  CHECK (research_priority_version = 1);

UPDATE ravenos_source_wallet_discovery_candidates
SET research_priority_score = MIN(
  1000,
  CASE evidence_tier
    WHEN 'high_signal' THEN 200
    WHEN 'recurring' THEN 100
    ELSE 0
  END
  + MIN(200, observation_count * 20)
  + MIN(200, distinct_mint_count * 40)
  + CASE
      WHEN observation_count > 0
        THEN CAST(ROUND((exact_swap_shape_count * 400.0) / observation_count) AS INTEGER)
      ELSE 0
    END
);

CREATE INDEX ravenos_source_wallet_discovery_quality_due_idx
  ON ravenos_source_wallet_discovery_candidates(
    state, next_hydration_at, research_priority_score DESC,
    last_observed_at DESC, distinct_mint_count DESC,
    observation_count DESC, candidate_id
  );

CREATE TRIGGER ravenos_source_wallet_discovery_priority_version_insert
BEFORE INSERT ON ravenos_source_wallet_discovery_candidates
WHEN NEW.research_priority_version != 1
BEGIN
  SELECT RAISE(ABORT, 'source_wallet_discovery_priority_version_invalid');
END;

CREATE TRIGGER ravenos_source_wallet_discovery_priority_version_update
BEFORE UPDATE OF research_priority_version ON ravenos_source_wallet_discovery_candidates
WHEN NEW.research_priority_version != 1
BEGIN
  SELECT RAISE(ABORT, 'source_wallet_discovery_priority_version_invalid');
END;
