PRAGMA foreign_keys = ON;

-- Privacy-safe, append-only observations of read-only route checks. These rows
-- deliberately contain no customer ID, wallet address, network address,
-- provider payload, plan price, approval, signature, transaction, or calldata.
CREATE TABLE IF NOT EXISTS ravenos_shadow_route_observations (
  observation_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.shadow_route_observation.v1',
  sample_key TEXT NOT NULL UNIQUE,
  instrument_id TEXT NOT NULL,
  chain_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  amount_bucket TEXT NOT NULL,
  source_amount_usdc REAL,
  provider_id TEXT NOT NULL,
  route_state TEXT NOT NULL,
  entry_state TEXT NOT NULL,
  exit_state TEXT NOT NULL,
  exit_verified INTEGER NOT NULL CHECK (exit_verified IN (0, 1)),
  friction_complete INTEGER NOT NULL CHECK (friction_complete IN (0, 1)),
  trade_available INTEGER NOT NULL CHECK (trade_available IN (0, 1)),
  destination_asset_id TEXT NOT NULL,
  destination_amount_base_units TEXT,
  expected_output REAL,
  minimum_output REAL,
  current_exit_usdc REAL,
  minimum_exit_usdc REAL,
  round_trip_friction_pct REAL,
  slippage_bps INTEGER NOT NULL CHECK (slippage_bps BETWEEN 1 AND 3000),
  provider_latency_ms INTEGER,
  quoted_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  limitations_json TEXT NOT NULL,
  retention_expires_at INTEGER NOT NULL,
  CHECK (observation_id GLOB 'shr_*' AND length(observation_id) BETWEEN 20 AND 100),
  CHECK (length(sample_key) = 64),
  CHECK (quoted_at >= 0 AND expires_at > quoted_at AND observed_at >= quoted_at),
  CHECK (retention_expires_at > observed_at),
  CHECK (provider_latency_ms IS NULL OR provider_latency_ms >= 0),
  CHECK (destination_amount_base_units IS NULL OR destination_amount_base_units NOT GLOB '*[^0-9]*')
);

CREATE INDEX IF NOT EXISTS ravenos_shadow_observations_time_idx
  ON ravenos_shadow_route_observations(observed_at DESC, observation_id);
CREATE INDEX IF NOT EXISTS ravenos_shadow_observations_due_idx
  ON ravenos_shadow_route_observations(chain_id, observed_at, retention_expires_at, observation_id);
CREATE INDEX IF NOT EXISTS ravenos_shadow_observations_slice_idx
  ON ravenos_shadow_route_observations(chain_id, provider_id, amount_bucket, observed_at DESC);

CREATE TRIGGER IF NOT EXISTS ravenos_shadow_observations_append_only
BEFORE UPDATE ON ravenos_shadow_route_observations
BEGIN
  SELECT RAISE(ABORT, 'shadow_route_observation_append_only');
END;

-- Later route checks are separate immutable evidence, never rewrites of what
-- Raven observed at admission time.
CREATE TABLE IF NOT EXISTS ravenos_shadow_route_checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.shadow_route_checkpoint.v1',
  observation_id TEXT NOT NULL REFERENCES ravenos_shadow_route_observations(observation_id) ON DELETE CASCADE,
  horizon_seconds INTEGER NOT NULL CHECK (horizon_seconds IN (300, 3600, 14400, 86400, 604800)),
  state TEXT NOT NULL,
  route_available INTEGER NOT NULL CHECK (route_available IN (0, 1)),
  current_exit_usdc REAL,
  minimum_exit_usdc REAL,
  exit_value_change_pct REAL,
  provider_latency_ms INTEGER,
  reason_code TEXT,
  evaluated_at INTEGER NOT NULL,
  UNIQUE (observation_id, horizon_seconds),
  CHECK (checkpoint_id GLOB 'shc_*' AND length(checkpoint_id) BETWEEN 20 AND 100),
  CHECK (provider_latency_ms IS NULL OR provider_latency_ms >= 0),
  CHECK (evaluated_at >= 0)
);

CREATE INDEX IF NOT EXISTS ravenos_shadow_checkpoints_time_idx
  ON ravenos_shadow_route_checkpoints(evaluated_at DESC, checkpoint_id);

CREATE TRIGGER IF NOT EXISTS ravenos_shadow_checkpoints_append_only
BEFORE UPDATE ON ravenos_shadow_route_checkpoints
BEGIN
  SELECT RAISE(ABORT, 'shadow_route_checkpoint_append_only');
END;

-- One bounded lease keeps overlapping scheduled evaluations from multiplying
-- provider load. The lease stores no market or customer data.
CREATE TABLE IF NOT EXISTS ravenos_shadow_evaluator_lease (
  lease_key TEXT PRIMARY KEY CHECK (lease_key = 'universal_shadow_v1'),
  lease_token TEXT,
  lease_expires_at INTEGER,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at INTEGER NOT NULL
);
