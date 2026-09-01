-- RavenOS prospective aggregate copy-demand evidence.
-- Internal demand totals are retained only to test whether one Raven-wide route
-- remains credible. Public projections never disclose follower counts, pooled
-- capital, subscriber associations, transaction material, or execution authority.

PRAGMA foreign_keys = ON;

CREATE TABLE ravenos_source_wallet_copy_demand_snapshots (
  demand_id TEXT PRIMARY KEY CHECK (demand_id GLOB 'swcd_[0-9a-f]*' AND length(demand_id) = 45),
  schema_version TEXT NOT NULL DEFAULT 'ravenos.source_wallet_copy_demand.v1'
    CHECK (schema_version = 'ravenos.source_wallet_copy_demand.v1'),
  source_wallet_id TEXT NOT NULL
    REFERENCES ravenos_source_wallets(source_wallet_id) ON DELETE CASCADE,
  source_event_id TEXT NOT NULL UNIQUE
    REFERENCES ravenos_source_wallet_events(event_id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('no_active_demand', 'fully_resolved', 'policy_mix_unresolved')),
  active_policy_count INTEGER NOT NULL CHECK (active_policy_count >= 0 AND active_policy_count <= 10000),
  supported_policy_count INTEGER NOT NULL CHECK (
    supported_policy_count >= 0 AND supported_policy_count <= active_policy_count
  ),
  aggregate_requested_usdc REAL NOT NULL CHECK (aggregate_requested_usdc >= 0),
  demand_hash TEXT NOT NULL CHECK (demand_hash GLOB '[0-9a-f]*' AND length(demand_hash) = 40),
  demand_json TEXT NOT NULL CHECK (
    json_valid(demand_json)
    AND json_extract(demand_json, '$.schema_version') = 'ravenos.source_wallet_copy_demand.v1'
    AND json_extract(demand_json, '$.demand_id') = demand_id
    AND json_extract(demand_json, '$.source_wallet_id') = source_wallet_id
    AND json_extract(demand_json, '$.source_event_id') = source_event_id
    AND json_extract(demand_json, '$.state') = state
    AND json_extract(demand_json, '$.active_policy_count_internal') = active_policy_count
    AND json_extract(demand_json, '$.supported_policy_count_internal') = supported_policy_count
    AND json_extract(demand_json, '$.aggregate_requested_usdc_internal') = aggregate_requested_usdc
    AND json_extract(demand_json, '$.privacy.aggregate_internal_only') = 1
    AND json_extract(demand_json, '$.privacy.subscriber_identity_included') = 0
    AND json_extract(demand_json, '$.privacy.subscriber_associations_included') = 0
    AND json_extract(demand_json, '$.privacy.user_id_included') = 0
    AND json_extract(demand_json, '$.privacy.watch_id_included') = 0
    AND json_extract(demand_json, '$.privacy.policy_payloads_included') = 0
    AND json_extract(demand_json, '$.privacy.public_follower_count_disclosed') = 0
    AND json_extract(demand_json, '$.privacy.public_aggregate_capital_disclosed') = 0
    AND json_extract(demand_json, '$.execution_boundary.live_copy') = 0
    AND json_extract(demand_json, '$.execution_boundary.signing') = 0
    AND json_extract(demand_json, '$.execution_boundary.broadcasting') = 0
    AND json_extract(demand_json, '$.execution_boundary.custody') = 0
    AND json_extract(demand_json, '$.execution_boundary.fee_collection') = 0
    AND json_extract(demand_json, '$.execution_boundary.transaction_hash') IS NULL
  ),
  captured_at INTEGER NOT NULL CHECK (captured_at >= 0),
  retention_expires_at INTEGER NOT NULL CHECK (retention_expires_at > captured_at)
);

CREATE INDEX ravenos_source_wallet_copy_demand_source_time_idx
  ON ravenos_source_wallet_copy_demand_snapshots(source_wallet_id, captured_at DESC, demand_id);

CREATE TRIGGER ravenos_source_wallet_copy_demand_append_only
BEFORE UPDATE ON ravenos_source_wallet_copy_demand_snapshots
BEGIN
  SELECT RAISE(ABORT, 'source_wallet_copy_demand_append_only');
END;

CREATE TABLE ravenos_source_wallet_copy_crowding_observations (
  observation_id TEXT PRIMARY KEY CHECK (observation_id GLOB 'swcr_[0-9a-f]*' AND length(observation_id) = 45),
  schema_version TEXT NOT NULL DEFAULT 'ravenos.source_wallet_copy_crowding_observation.v1'
    CHECK (schema_version = 'ravenos.source_wallet_copy_crowding_observation.v1'),
  demand_id TEXT NOT NULL
    REFERENCES ravenos_source_wallet_copy_demand_snapshots(demand_id) ON DELETE CASCADE,
  source_wallet_id TEXT NOT NULL
    REFERENCES ravenos_source_wallets(source_wallet_id) ON DELETE CASCADE,
  source_event_id TEXT NOT NULL
    REFERENCES ravenos_source_wallet_events(event_id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN (
    'NO_ACTIVE_DEMAND',
    'POLICY_MIX_UNRESOLVED',
    'ABOVE_QUOTE_LIMIT',
    'AGGREGATE_ROUTE_AVAILABLE',
    'AGGREGATE_ROUTE_CONSTRAINED',
    'AGGREGATE_ROUTE_UNAVAILABLE',
    'INDETERMINATE'
  )),
  reason_code TEXT NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 100),
  hypothetical_raven_fee_bps INTEGER NOT NULL CHECK (hypothetical_raven_fee_bps IN (0, 5, 10, 20, 25, 50)),
  observation_json TEXT NOT NULL CHECK (
    json_valid(observation_json)
    AND json_extract(observation_json, '$.schema_version') = 'ravenos.source_wallet_copy_crowding_observation.v1'
    AND json_extract(observation_json, '$.observation_id') = observation_id
    AND json_extract(observation_json, '$.demand_id') = demand_id
    AND json_extract(observation_json, '$.source_wallet_id') = source_wallet_id
    AND json_extract(observation_json, '$.source_event_id') = source_event_id
    AND json_extract(observation_json, '$.state') = state
    AND json_extract(observation_json, '$.reason_code') = reason_code
    AND json_extract(observation_json, '$.hypothetical_raven_fee_bps') = hypothetical_raven_fee_bps
    AND json_extract(observation_json, '$.privacy.aggregate_internal_only') = 1
    AND json_extract(observation_json, '$.privacy.subscriber_identity_included') = 0
    AND json_extract(observation_json, '$.privacy.subscriber_associations_included') = 0
    AND json_extract(observation_json, '$.privacy.user_id_included') = 0
    AND json_extract(observation_json, '$.privacy.watch_id_included') = 0
    AND json_extract(observation_json, '$.privacy.public_follower_count_disclosed') = 0
    AND json_extract(observation_json, '$.privacy.public_aggregate_capital_disclosed') = 0
    AND json_extract(observation_json, '$.provenance.expected_quote_not_fill') = 1
    AND json_extract(observation_json, '$.provenance.isolated_size_ladder_substituted') = 0
    AND json_extract(observation_json, '$.execution_boundary.position_creation') = 0
    AND json_extract(observation_json, '$.execution_boundary.live_copy') = 0
    AND json_extract(observation_json, '$.execution_boundary.signing') = 0
    AND json_extract(observation_json, '$.execution_boundary.broadcasting') = 0
    AND json_extract(observation_json, '$.execution_boundary.custody') = 0
    AND json_extract(observation_json, '$.execution_boundary.fee_collection') = 0
    AND json_extract(observation_json, '$.execution_boundary.transaction_hash') IS NULL
  ),
  observed_at INTEGER NOT NULL CHECK (observed_at >= 0),
  retention_expires_at INTEGER NOT NULL CHECK (retention_expires_at > observed_at),
  UNIQUE(source_event_id, hypothetical_raven_fee_bps)
);

CREATE INDEX ravenos_source_wallet_copy_crowding_source_time_idx
  ON ravenos_source_wallet_copy_crowding_observations(
    source_wallet_id, hypothetical_raven_fee_bps, observed_at DESC, observation_id
  );

CREATE INDEX ravenos_source_wallet_copy_crowding_state_idx
  ON ravenos_source_wallet_copy_crowding_observations(state, observed_at DESC, observation_id);

CREATE TRIGGER ravenos_source_wallet_copy_crowding_append_only
BEFORE UPDATE ON ravenos_source_wallet_copy_crowding_observations
BEGIN
  SELECT RAISE(ABORT, 'source_wallet_copy_crowding_observation_append_only');
END;
