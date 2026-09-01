PRAGMA foreign_keys = ON;

-- Provider candidates are a research frontier, not source wallets yet. This
-- mutable projection is rebuilt from append-only candidate observations and
-- never contains subscriber identity or execution authority.
CREATE TABLE ravenos_source_wallet_discovery_candidates (
  candidate_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.source_wallet_discovery_candidate.v1',
  source_wallet_id TEXT NOT NULL,
  chain TEXT NOT NULL CHECK (chain = 'solana'),
  network TEXT NOT NULL CHECK (network = 'mainnet'),
  address TEXT NOT NULL CHECK (length(address) BETWEEN 32 AND 44),
  state TEXT NOT NULL CHECK (state IN (
    'provider_candidate', 'hydration_eligible', 'leased', 'retry_wait',
    'insufficient_evidence', 'admitted', 'dead_letter'
  )),
  evidence_tier TEXT NOT NULL CHECK (evidence_tier IN ('single_observation', 'recurring', 'high_signal')),
  observation_count INTEGER NOT NULL DEFAULT 0 CHECK (observation_count >= 0),
  exact_swap_shape_count INTEGER NOT NULL DEFAULT 0 CHECK (exact_swap_shape_count BETWEEN 0 AND observation_count),
  reviewed_buy_instruction_count INTEGER NOT NULL DEFAULT 0 CHECK (reviewed_buy_instruction_count BETWEEN 0 AND observation_count),
  distinct_mint_count INTEGER NOT NULL DEFAULT 0 CHECK (distinct_mint_count >= 0),
  first_observed_at INTEGER NOT NULL CHECK (first_observed_at >= 0),
  last_observed_at INTEGER NOT NULL CHECK (last_observed_at >= first_observed_at),
  latest_observation_id TEXT,
  latest_signature TEXT NOT NULL CHECK (length(latest_signature) BETWEEN 64 AND 100),
  latest_slot INTEGER NOT NULL CHECK (latest_slot >= 0),
  hydration_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (hydration_attempt_count BETWEEN 0 AND 100),
  next_hydration_at INTEGER NOT NULL CHECK (next_hydration_at >= 0),
  lease_token TEXT,
  lease_expires_at INTEGER,
  last_error_code TEXT CHECK (last_error_code IS NULL OR length(last_error_code) BETWEEN 1 AND 100),
  admitted_source_wallet_id TEXT REFERENCES ravenos_source_wallets(source_wallet_id) ON DELETE SET NULL,
  admitted_at INTEGER,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  UNIQUE (chain, network, address),
  CHECK (candidate_id GLOB 'swc_*' AND length(candidate_id) BETWEEN 20 AND 100),
  CHECK (source_wallet_id GLOB 'sw_sol_*' AND length(source_wallet_id) BETWEEN 20 AND 100),
  CHECK ((state = 'leased') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (lease_token IS NULL OR length(lease_token) BETWEEN 20 AND 200),
  CHECK ((state = 'admitted') = (admitted_source_wallet_id IS NOT NULL AND admitted_at IS NOT NULL))
);

CREATE INDEX ravenos_source_wallet_discovery_due_idx
  ON ravenos_source_wallet_discovery_candidates(state, next_hydration_at, observation_count DESC, last_observed_at DESC, candidate_id);
CREATE INDEX ravenos_source_wallet_discovery_rank_idx
  ON ravenos_source_wallet_discovery_candidates(evidence_tier, observation_count DESC, distinct_mint_count DESC, last_observed_at DESC, candidate_id);

-- The compact provider observation is retained append-only. It includes only
-- exact public-chain identity and reduced economic evidence, never balances,
-- amounts, raw provider payloads, subscribers, policies, or signer material.
CREATE TABLE ravenos_source_wallet_discovery_observations (
  observation_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.constant_k_nexus_wallet_candidate_observation.v1',
  candidate_id TEXT NOT NULL REFERENCES ravenos_source_wallet_discovery_candidates(candidate_id) ON DELETE CASCADE,
  source_wallet_id TEXT NOT NULL,
  signature TEXT NOT NULL CHECK (length(signature) BETWEEN 64 AND 100),
  slot INTEGER NOT NULL CHECK (slot >= 0),
  provider TEXT NOT NULL CHECK (provider = 'constant_k_nexus'),
  transport TEXT NOT NULL CHECK (transport = 'geyser_grpc'),
  finality TEXT NOT NULL CHECK (finality = 'processed'),
  evidence_kind TEXT NOT NULL CHECK (evidence_kind IN ('exact_opposing_token_deltas', 'reviewed_pump_buy_instruction')),
  observation_hash TEXT NOT NULL CHECK (length(observation_hash) = 40),
  observation_json TEXT NOT NULL CHECK (
    json_valid(observation_json)
    AND length(observation_json) <= 16384
    AND json_extract(observation_json, '$.economic_evidence.amounts_included') = 0
    AND json_extract(observation_json, '$.economic_evidence.trade_direction_claimed') = 0
    AND json_extract(observation_json, '$.privacy.raw_provider_payload_included') = 0
    AND json_extract(observation_json, '$.privacy.subscriber_identity_included') = 0
    AND json_extract(observation_json, '$.privacy.signer_material_included') = 0
    AND json_extract(observation_json, '$.privacy.transaction_material_included') = 0
    AND json_extract(observation_json, '$.execution_boundary.live_copy') = 0
    AND json_extract(observation_json, '$.execution_boundary.broadcasting') = 0
  ),
  provider_observed_at INTEGER NOT NULL CHECK (provider_observed_at >= 0),
  received_at INTEGER NOT NULL CHECK (received_at >= 0),
  retention_expires_at INTEGER NOT NULL CHECK (retention_expires_at > received_at),
  UNIQUE (candidate_id, signature, slot),
  CHECK (observation_id GLOB 'swco_*' AND length(observation_id) BETWEEN 20 AND 100),
  CHECK (source_wallet_id GLOB 'sw_sol_*' AND length(source_wallet_id) BETWEEN 20 AND 100)
);

CREATE INDEX ravenos_source_wallet_discovery_observation_candidate_idx
  ON ravenos_source_wallet_discovery_observations(candidate_id, provider_observed_at DESC, observation_id);

CREATE TRIGGER ravenos_source_wallet_discovery_observations_append_only
BEFORE UPDATE ON ravenos_source_wallet_discovery_observations
BEGIN
  SELECT RAISE(ABORT, 'source_wallet_discovery_observation_append_only');
END;

CREATE TABLE ravenos_source_wallet_discovery_candidate_mints (
  candidate_id TEXT NOT NULL REFERENCES ravenos_source_wallet_discovery_candidates(candidate_id) ON DELETE CASCADE,
  mint TEXT NOT NULL CHECK (length(mint) BETWEEN 32 AND 44),
  first_observed_at INTEGER NOT NULL CHECK (first_observed_at >= 0),
  last_observed_at INTEGER NOT NULL CHECK (last_observed_at >= first_observed_at),
  observation_count INTEGER NOT NULL DEFAULT 1 CHECK (observation_count >= 1),
  PRIMARY KEY (candidate_id, mint)
);

-- Each independent Raven hydration is immutable evidence. Unknown and
-- provider failure are not stored as zero or rewritten after a later retry.
CREATE TABLE ravenos_source_wallet_discovery_hydrations (
  hydration_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.source_wallet_discovery_hydration.v1',
  candidate_id TEXT NOT NULL REFERENCES ravenos_source_wallet_discovery_candidates(candidate_id) ON DELETE CASCADE,
  observation_id TEXT NOT NULL REFERENCES ravenos_source_wallet_discovery_observations(observation_id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('verified_trade', 'verified_non_trade', 'retry', 'dead_letter')),
  reason_code TEXT NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 100),
  normalized_event_id TEXT REFERENCES ravenos_source_wallet_events(event_id) ON DELETE SET NULL,
  classification TEXT,
  hydration_json TEXT NOT NULL CHECK (
    json_valid(hydration_json)
    AND length(hydration_json) <= 16384
    AND json_extract(hydration_json, '$.raw_transaction_included') = 0
    AND json_extract(hydration_json, '$.raw_provider_payload_included') = 0
    AND json_extract(hydration_json, '$.subscriber_identity_included') = 0
    AND json_extract(hydration_json, '$.execution_boundary.live_copy') = 0
    AND json_extract(hydration_json, '$.execution_boundary.broadcasting') = 0
  ),
  started_at INTEGER NOT NULL CHECK (started_at >= 0),
  completed_at INTEGER NOT NULL CHECK (completed_at >= started_at),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (hydration_id GLOB 'swdh_*' AND length(hydration_id) BETWEEN 20 AND 100)
);

CREATE INDEX ravenos_source_wallet_discovery_hydration_candidate_idx
  ON ravenos_source_wallet_discovery_hydrations(candidate_id, completed_at DESC, hydration_id);

CREATE TRIGGER ravenos_source_wallet_discovery_hydrations_append_only
BEFORE UPDATE ON ravenos_source_wallet_discovery_hydrations
BEGIN
  SELECT RAISE(ABORT, 'source_wallet_discovery_hydration_append_only');
END;

-- HMAC batch receipts make partial failure and exact replay recoverable.
CREATE TABLE ravenos_source_wallet_discovery_batches (
  batch_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.source_wallet_discovery_receipt.v1',
  body_sha256 TEXT NOT NULL CHECK (length(body_sha256) = 64),
  request_key_id TEXT NOT NULL CHECK (length(request_key_id) BETWEEN 3 AND 64),
  observation_count INTEGER NOT NULL CHECK (observation_count BETWEEN 1 AND 50),
  inserted_count INTEGER NOT NULL CHECK (inserted_count BETWEEN 0 AND observation_count),
  duplicate_count INTEGER NOT NULL CHECK (duplicate_count = observation_count - inserted_count),
  eligible_candidate_count INTEGER NOT NULL CHECK (eligible_candidate_count BETWEEN 0 AND observation_count),
  sent_at INTEGER NOT NULL CHECK (sent_at >= 0),
  received_at INTEGER NOT NULL CHECK (received_at >= 0),
  receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json) AND length(receipt_json) <= 8192),
  retention_expires_at INTEGER NOT NULL CHECK (retention_expires_at > received_at),
  CHECK (batch_id GLOB 'swdcb_*' AND length(batch_id) BETWEEN 20 AND 100)
);

CREATE INDEX ravenos_source_wallet_discovery_batches_retention_idx
  ON ravenos_source_wallet_discovery_batches(retention_expires_at, batch_id);

CREATE TRIGGER ravenos_source_wallet_discovery_batches_append_only
BEFORE UPDATE ON ravenos_source_wallet_discovery_batches
BEGIN
  SELECT RAISE(ABORT, 'source_wallet_discovery_batch_append_only');
END;
