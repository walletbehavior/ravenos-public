PRAGMA foreign_keys = ON;

-- A bounded operational cohort keeps independently verified Nexus-discovered
-- wallets under prospective observation. Subscriber-requested wallets remain
-- higher priority and this membership never claims profitability or copyability.
CREATE TABLE ravenos_source_wallet_research_cohort (
  source_wallet_id TEXT PRIMARY KEY
    REFERENCES ravenos_source_wallets(source_wallet_id) ON DELETE CASCADE,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.source_wallet_research_cohort_admission.v1',
  admission_id TEXT NOT NULL UNIQUE CHECK (
    admission_id GLOB 'swrca_*' AND length(admission_id) BETWEEN 20 AND 100
  ),
  candidate_id TEXT NOT NULL
    REFERENCES ravenos_source_wallet_discovery_candidates(candidate_id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('active', 'paused', 'retired')),
  admission_basis TEXT NOT NULL CHECK (admission_basis = 'constant_k_nexus_verified_trade'),
  evidence_tier TEXT NOT NULL CHECK (evidence_tier IN ('recurring', 'high_signal')),
  priority_score INTEGER NOT NULL CHECK (priority_score BETWEEN 0 AND 1000),
  qualified_observation_count INTEGER NOT NULL CHECK (qualified_observation_count >= 2),
  distinct_mint_count INTEGER NOT NULL CHECK (distinct_mint_count >= 0),
  admission_json TEXT NOT NULL CHECK (
    json_valid(admission_json)
    AND length(admission_json) <= 16384
    AND json_extract(admission_json, '$.claim_boundary.profitable_wallet_claimed') = 0
    AND json_extract(admission_json, '$.claim_boundary.copyable_wallet_claimed') = 0
    AND json_extract(admission_json, '$.privacy.subscriber_identity_included') = 0
    AND json_extract(admission_json, '$.privacy.signer_material_included') = 0
    AND json_extract(admission_json, '$.execution_boundary.signing') = 0
    AND json_extract(admission_json, '$.execution_boundary.submission') = 0
    AND json_extract(admission_json, '$.execution_boundary.broadcasting') = 0
    AND json_extract(admission_json, '$.execution_boundary.custody') = 0
    AND json_extract(admission_json, '$.execution_boundary.live_copy') = 0
    AND json_extract(admission_json, '$.execution_boundary.fee_collection') = 0
  ),
  first_qualified_at INTEGER NOT NULL CHECK (first_qualified_at >= 0),
  last_qualified_at INTEGER NOT NULL CHECK (last_qualified_at >= first_qualified_at),
  updated_at INTEGER NOT NULL CHECK (updated_at >= last_qualified_at)
);

CREATE INDEX ravenos_source_wallet_research_cohort_priority_idx
  ON ravenos_source_wallet_research_cohort(
    state, priority_score DESC, last_qualified_at DESC, source_wallet_id
  );

CREATE INDEX ravenos_source_wallet_research_cohort_candidate_idx
  ON ravenos_source_wallet_research_cohort(candidate_id, state, source_wallet_id);
