PRAGMA foreign_keys = ON;

-- Shared prospective research is evaluated once per source trade and standard
-- order size. It contains no subscriber/watch identity and cannot create a
-- position or transaction. Refusals and provider failures remain observations.
CREATE TABLE ravenos_source_wallet_copyability_observations (
  observation_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.source_wallet_copyability_observation.v1',
  source_wallet_id TEXT NOT NULL
    REFERENCES ravenos_source_wallets(source_wallet_id) ON DELETE CASCADE,
  source_event_id TEXT NOT NULL
    REFERENCES ravenos_source_wallet_events(event_id) ON DELETE RESTRICT,
  standard_order_size_usdc REAL NOT NULL CHECK (
    standard_order_size_usdc IN (25, 100, 500, 1000, 5000)
  ),
  hypothetical_raven_fee_bps INTEGER NOT NULL CHECK (
    hypothetical_raven_fee_bps IN (0, 5, 10, 20, 25, 50)
  ),
  policy_version INTEGER NOT NULL CHECK (policy_version >= 1),
  policy_hash TEXT NOT NULL CHECK (length(policy_hash) = 40),
  decision_state TEXT NOT NULL CHECK (decision_state IN (
    'SHADOW_EXECUTABLE', 'POLICY_REJECTED', 'ENTRY_UNAVAILABLE', 'EXIT_UNAVAILABLE',
    'ROUTE_STALE', 'SIMULATION_FAILED', 'FUNDING_NOT_READY', 'FRICTION_TOO_HIGH',
    'LIQUIDITY_TOO_LOW', 'COPY_DELAY_TOO_HIGH', 'ASSET_RESTRICTED',
    'PROVIDER_UNAVAILABLE', 'INDETERMINATE'
  )),
  reason_code TEXT NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 100),
  observation_json TEXT NOT NULL CHECK (
    json_valid(observation_json)
    AND length(observation_json) <= 65536
    AND json_extract(observation_json, '$.privacy.subscriber_identity_included') = 0
    AND json_extract(observation_json, '$.privacy.watch_identity_included') = 0
    AND json_extract(observation_json, '$.privacy.raw_provider_payload_included') = 0
    AND json_extract(observation_json, '$.privacy.signer_material_included') = 0
    AND json_extract(observation_json, '$.privacy.transaction_material_included') = 0
    AND json_extract(observation_json, '$.execution_boundary.shadow_research_only') = 1
    AND json_extract(observation_json, '$.execution_boundary.live_copy') = 0
    AND json_extract(observation_json, '$.execution_boundary.signing') = 0
    AND json_extract(observation_json, '$.execution_boundary.broadcasting') = 0
    AND json_extract(observation_json, '$.execution_boundary.custody') = 0
    AND json_extract(observation_json, '$.execution_boundary.fee_collection') = 0
    AND json_extract(observation_json, '$.execution_boundary.transaction_hash') IS NULL
    AND json_extract(observation_json, '$.evaluation.execution_boundary.transaction_hash') IS NULL
    AND json_extract(observation_json, '$.evaluation.decision.shadow_position_created') = 0
    AND json_type(observation_json, '$.evaluation.watch_id') IS NULL
    AND json_type(observation_json, '$.evaluation.user_id') IS NULL
  ),
  observed_at INTEGER NOT NULL CHECK (observed_at >= 0),
  retention_expires_at INTEGER NOT NULL CHECK (retention_expires_at > observed_at),
  UNIQUE (source_event_id, standard_order_size_usdc, hypothetical_raven_fee_bps, policy_hash),
  CHECK (observation_id GLOB 'swcp_*' AND length(observation_id) BETWEEN 20 AND 100)
);

CREATE INDEX ravenos_source_wallet_copyability_source_time_idx
  ON ravenos_source_wallet_copyability_observations(
    source_wallet_id, observed_at DESC, source_event_id, standard_order_size_usdc
  );

CREATE INDEX ravenos_source_wallet_copyability_source_size_idx
  ON ravenos_source_wallet_copyability_observations(
    source_wallet_id, standard_order_size_usdc, observed_at DESC, observation_id
  );

CREATE INDEX ravenos_source_wallet_copyability_event_idx
  ON ravenos_source_wallet_copyability_observations(
    source_event_id, hypothetical_raven_fee_bps, standard_order_size_usdc
  );

CREATE TRIGGER ravenos_source_wallet_copyability_observations_append_only
BEFORE UPDATE ON ravenos_source_wallet_copyability_observations
BEGIN
  SELECT RAISE(ABORT, 'source_wallet_copyability_observation_append_only');
END;
