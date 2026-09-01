PRAGMA foreign_keys = ON;

-- Rebuildable current projection for server-side wallet screening. The
-- append-only observation ledger remains authoritative; this row only avoids
-- rescanning every prospective decision on every screener request.
CREATE TABLE ravenos_source_wallet_copyability_current (
  source_wallet_id TEXT NOT NULL
    REFERENCES ravenos_source_wallets(source_wallet_id) ON DELETE CASCADE,
  hypothetical_raven_fee_bps INTEGER NOT NULL CHECK (
    hypothetical_raven_fee_bps IN (0, 5, 10, 20, 25, 50)
  ),
  matrix_policy_hash TEXT NOT NULL CHECK (length(matrix_policy_hash) = 40),
  policy_version INTEGER NOT NULL CHECK (policy_version >= 1),
  reference_order_size_usdc REAL NOT NULL CHECK (reference_order_size_usdc = 100),
  state TEXT NOT NULL CHECK (state IN ('available', 'forming', 'insufficient_evidence')),
  prospective_signal_count INTEGER NOT NULL CHECK (prospective_signal_count >= 0),
  probe_observation_count INTEGER NOT NULL CHECK (probe_observation_count >= 0),
  reference_sample_count INTEGER NOT NULL CHECK (reference_sample_count >= 0),
  reference_score INTEGER CHECK (reference_score IS NULL OR reference_score BETWEEN 0 AND 100),
  reference_confidence TEXT NOT NULL CHECK (
    reference_confidence IN ('mature', 'developing', 'early', 'insufficient')
  ),
  entry_executable_pct REAL CHECK (entry_executable_pct IS NULL OR entry_executable_pct BETWEEN 0 AND 100),
  exit_executable_pct REAL CHECK (exit_executable_pct IS NULL OR exit_executable_pct BETWEEN 0 AND 100),
  policy_pass_pct REAL CHECK (policy_pass_pct IS NULL OR policy_pass_pct BETWEEN 0 AND 100),
  median_entry_degradation_bps REAL,
  median_round_trip_friction_pct REAL,
  matrix_json TEXT NOT NULL CHECK (
    json_valid(matrix_json)
    AND length(matrix_json) <= 65536
    AND json_extract(matrix_json, '$.source_performance_used_as_follower_performance') = 0
    AND json_extract(matrix_json, '$.unavailable_decisions_dropped') = 0
    AND json_extract(matrix_json, '$.subscriber_identity_included') = 0
    AND json_extract(matrix_json, '$.execution_boundary.shadow_research_only') = 1
    AND json_extract(matrix_json, '$.execution_boundary.live_copy') = 0
    AND json_extract(matrix_json, '$.execution_boundary.signing') = 0
    AND json_extract(matrix_json, '$.execution_boundary.broadcasting') = 0
    AND json_extract(matrix_json, '$.execution_boundary.custody') = 0
    AND json_extract(matrix_json, '$.execution_boundary.fee_collection') = 0
    AND json_extract(matrix_json, '$.execution_boundary.transaction_hash') IS NULL
  ),
  last_observed_at INTEGER,
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  PRIMARY KEY (source_wallet_id, hypothetical_raven_fee_bps, matrix_policy_hash),
  CHECK (last_observed_at IS NULL OR last_observed_at >= 0)
);

CREATE INDEX ravenos_source_wallet_copyability_rank_idx
  ON ravenos_source_wallet_copyability_current(
    hypothetical_raven_fee_bps, matrix_policy_hash,
    reference_score DESC, reference_sample_count DESC, source_wallet_id
  );

CREATE INDEX ravenos_source_wallet_copyability_pass_idx
  ON ravenos_source_wallet_copyability_current(
    hypothetical_raven_fee_bps, matrix_policy_hash,
    policy_pass_pct DESC, exit_executable_pct DESC, reference_sample_count DESC,
    source_wallet_id
  );

CREATE INDEX ravenos_source_wallet_copyability_friction_idx
  ON ravenos_source_wallet_copyability_current(
    hypothetical_raven_fee_bps, matrix_policy_hash,
    median_round_trip_friction_pct ASC, reference_sample_count DESC,
    source_wallet_id
  );
