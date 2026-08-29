PRAGMA foreign_keys = ON;

-- Append-only hypothetical fee sensitivity linked to an existing read-only
-- route observation. Amounts use canonical-USDC microunits so later policy
-- analysis never depends on floating-point fee arithmetic.
--
-- These rows contain no customer, wallet, network address, collector address,
-- recipient, provider payload, transaction, calldata, signature, or tx hash.
CREATE TABLE IF NOT EXISTS ravenos_shadow_fee_evidence (
  fee_evidence_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.shadow_fee_evidence.v1',
  observation_id TEXT NOT NULL REFERENCES ravenos_shadow_route_observations(observation_id) ON DELETE CASCADE,
  calculation_version INTEGER NOT NULL CHECK (calculation_version = 1),
  scenario_bps INTEGER NOT NULL CHECK (scenario_bps IN (0, 5, 10, 20)),
  entry_basis_usdc_micros INTEGER NOT NULL CHECK (entry_basis_usdc_micros >= 0),
  entry_fee_usdc_micros INTEGER NOT NULL CHECK (entry_fee_usdc_micros >= 0),
  exit_basis_usdc_micros INTEGER NOT NULL CHECK (exit_basis_usdc_micros >= 0),
  exit_fee_usdc_micros INTEGER NOT NULL CHECK (exit_fee_usdc_micros >= 0),
  round_trip_fee_usdc_micros INTEGER NOT NULL CHECK (round_trip_fee_usdc_micros >= 0),
  gross_terminal_usdc_micros INTEGER NOT NULL CHECK (gross_terminal_usdc_micros >= 0),
  minimum_net_terminal_usdc_micros INTEGER NOT NULL CHECK (minimum_net_terminal_usdc_micros >= 0),
  round_trip_friction_excluding_raven_pct REAL,
  round_trip_friction_including_raven_pct REAL,
  entry_collection_state TEXT NOT NULL,
  exit_collection_state TEXT NOT NULL,
  collection_evidence_complete INTEGER NOT NULL CHECK (collection_evidence_complete IN (0, 1)),
  actual_collection_authorized INTEGER NOT NULL DEFAULT 0 CHECK (actual_collection_authorized = 0),
  actual_collected_usdc_micros INTEGER CHECK (actual_collected_usdc_micros IS NULL),
  observed_at INTEGER NOT NULL CHECK (observed_at >= 0),
  retention_expires_at INTEGER NOT NULL CHECK (retention_expires_at > observed_at),
  UNIQUE (observation_id, scenario_bps, calculation_version),
  CHECK (fee_evidence_id GLOB 'shfev_*' AND length(fee_evidence_id) BETWEEN 20 AND 100)
);

CREATE INDEX IF NOT EXISTS ravenos_shadow_fee_evidence_time_idx
  ON ravenos_shadow_fee_evidence(observed_at DESC, fee_evidence_id);

CREATE INDEX IF NOT EXISTS ravenos_shadow_fee_evidence_observation_idx
  ON ravenos_shadow_fee_evidence(observation_id, scenario_bps, calculation_version);

CREATE TRIGGER IF NOT EXISTS ravenos_shadow_fee_evidence_append_only
BEFORE UPDATE ON ravenos_shadow_fee_evidence
BEGIN
  SELECT RAISE(ABORT, 'shadow_fee_evidence_append_only');
END;
