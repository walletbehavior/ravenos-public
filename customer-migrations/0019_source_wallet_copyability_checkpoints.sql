PRAGMA foreign_keys = ON;

-- A source opportunity checkpoint answers a deliberately narrow question:
-- what could the exact source-received quantity have liquidated for at this
-- prospective horizon? It is not the source wallet's actual exit or P&L.
CREATE TABLE ravenos_source_wallet_opportunity_checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.source_wallet_opportunity_checkpoint.v1',
  source_wallet_id TEXT NOT NULL
    REFERENCES ravenos_source_wallets(source_wallet_id) ON DELETE CASCADE,
  source_event_id TEXT NOT NULL
    REFERENCES ravenos_source_wallet_events(event_id) ON DELETE RESTRICT,
  horizon_seconds INTEGER NOT NULL CHECK (
    horizon_seconds IN (30, 60, 90, 300, 900, 3600, 14400, 86400)
  ),
  state TEXT NOT NULL CHECK (length(state) BETWEEN 1 AND 64),
  route_available INTEGER NOT NULL CHECK (route_available IN (0, 1)),
  token_mint TEXT NOT NULL CHECK (length(token_mint) BETWEEN 32 AND 44),
  source_quantity_base_units TEXT NOT NULL CHECK (
    source_quantity_base_units GLOB '[1-9]*'
    AND source_quantity_base_units NOT GLOB '*[^0-9]*'
    AND length(source_quantity_base_units) <= 80
  ),
  source_notional_usdc REAL CHECK (source_notional_usdc IS NULL OR source_notional_usdc > 0),
  gross_exit_usdc REAL CHECK (gross_exit_usdc IS NULL OR gross_exit_usdc >= 0),
  minimum_exit_usdc REAL CHECK (minimum_exit_usdc IS NULL OR minimum_exit_usdc >= 0),
  gross_return_pct REAL,
  minimum_return_pct REAL,
  provider_id TEXT NOT NULL CHECK (length(provider_id) BETWEEN 1 AND 64),
  provider_latency_ms INTEGER CHECK (provider_latency_ms IS NULL OR provider_latency_ms >= 0),
  reason_code TEXT CHECK (reason_code IS NULL OR length(reason_code) BETWEEN 1 AND 100),
  checkpoint_json TEXT NOT NULL CHECK (
    json_valid(checkpoint_json)
    AND length(checkpoint_json) <= 32768
    AND json_extract(checkpoint_json, '$.counterfactual_liquidation.actual_source_exit_claimed') = 0
    AND json_extract(checkpoint_json, '$.counterfactual_liquidation.realized_source_pnl_claimed') = 0
    AND json_extract(checkpoint_json, '$.counterfactual_liquidation.current_mark_substituted') = 0
    AND json_extract(checkpoint_json, '$.route_evidence.expected_quote_not_fill') = 1
    AND json_extract(checkpoint_json, '$.route_evidence.raw_provider_payload_included') = 0
    AND json_extract(checkpoint_json, '$.privacy.subscriber_identity_included') = 0
    AND json_extract(checkpoint_json, '$.privacy.watch_identity_included') = 0
    AND json_extract(checkpoint_json, '$.privacy.signer_material_included') = 0
    AND json_extract(checkpoint_json, '$.privacy.transaction_material_included') = 0
    AND json_extract(checkpoint_json, '$.execution_boundary.shadow_research_only') = 1
    AND json_extract(checkpoint_json, '$.execution_boundary.live_copy') = 0
    AND json_extract(checkpoint_json, '$.execution_boundary.signing') = 0
    AND json_extract(checkpoint_json, '$.execution_boundary.broadcasting') = 0
    AND json_extract(checkpoint_json, '$.execution_boundary.custody') = 0
    AND json_extract(checkpoint_json, '$.execution_boundary.fee_collection') = 0
    AND json_extract(checkpoint_json, '$.execution_boundary.transaction_hash') IS NULL
  ),
  evaluated_at INTEGER NOT NULL CHECK (evaluated_at >= 0),
  UNIQUE (source_event_id, horizon_seconds),
  CHECK (checkpoint_id GLOB 'swoc_*' AND length(checkpoint_id) BETWEEN 20 AND 100),
  CHECK (route_available = 0 OR (gross_exit_usdc IS NOT NULL AND minimum_exit_usdc IS NOT NULL))
);

CREATE INDEX ravenos_source_wallet_opportunity_checkpoints_source_idx
  ON ravenos_source_wallet_opportunity_checkpoints(
    source_wallet_id, horizon_seconds, evaluated_at DESC, checkpoint_id
  );

CREATE TRIGGER ravenos_source_wallet_opportunity_checkpoints_append_only
BEFORE UPDATE ON ravenos_source_wallet_opportunity_checkpoints
BEGIN
  SELECT RAISE(ABORT, 'source_wallet_opportunity_checkpoint_append_only');
END;

-- One follower checkpoint is retained for each executable opening observation
-- and horizon. Provider failures remain rows with NULL economics, never a
-- fabricated zero return. No user/watch identity or transaction authority is
-- present in this shared research ledger.
CREATE TABLE ravenos_source_wallet_copyability_checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.source_wallet_copyability_checkpoint.v1',
  observation_id TEXT NOT NULL
    REFERENCES ravenos_source_wallet_copyability_observations(observation_id) ON DELETE CASCADE,
  source_checkpoint_id TEXT NOT NULL
    REFERENCES ravenos_source_wallet_opportunity_checkpoints(checkpoint_id) ON DELETE RESTRICT,
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
  policy_hash TEXT NOT NULL CHECK (length(policy_hash) = 40),
  horizon_seconds INTEGER NOT NULL CHECK (
    horizon_seconds IN (30, 60, 90, 300, 900, 3600, 14400, 86400)
  ),
  state TEXT NOT NULL CHECK (length(state) BETWEEN 1 AND 64),
  route_available INTEGER NOT NULL CHECK (route_available IN (0, 1)),
  token_mint TEXT NOT NULL CHECK (length(token_mint) BETWEEN 32 AND 44),
  follower_quantity_base_units TEXT NOT NULL CHECK (
    follower_quantity_base_units GLOB '[1-9]*'
    AND follower_quantity_base_units NOT GLOB '*[^0-9]*'
    AND length(follower_quantity_base_units) <= 80
  ),
  gross_exit_usdc REAL CHECK (gross_exit_usdc IS NULL OR gross_exit_usdc >= 0),
  minimum_exit_usdc REAL CHECK (minimum_exit_usdc IS NULL OR minimum_exit_usdc >= 0),
  initial_economic_cost_usdc REAL NOT NULL CHECK (initial_economic_cost_usdc > 0),
  net_exit_usdc REAL CHECK (net_exit_usdc IS NULL OR net_exit_usdc >= 0),
  minimum_net_exit_usdc REAL CHECK (minimum_net_exit_usdc IS NULL OR minimum_net_exit_usdc >= 0),
  follower_return_pct REAL,
  minimum_follower_return_pct REAL,
  source_counterfactual_return_pct REAL,
  follower_capture_ratio_pct REAL,
  follower_minus_source_return_pct REAL,
  provider_id TEXT NOT NULL CHECK (length(provider_id) BETWEEN 1 AND 64),
  provider_latency_ms INTEGER CHECK (provider_latency_ms IS NULL OR provider_latency_ms >= 0),
  reason_code TEXT CHECK (reason_code IS NULL OR length(reason_code) BETWEEN 1 AND 100),
  checkpoint_json TEXT NOT NULL CHECK (
    json_valid(checkpoint_json)
    AND length(checkpoint_json) <= 49152
    AND json_extract(checkpoint_json, '$.follower_outcome.expected_quote_not_fill') = 1
    AND json_extract(checkpoint_json, '$.follower_outcome.actual_position_created') = 0
    AND json_extract(checkpoint_json, '$.follower_outcome.actual_assets_held') = 0
    AND json_extract(checkpoint_json, '$.source_comparison.actual_source_performance_substituted') = 0
    AND json_extract(checkpoint_json, '$.source_comparison.source_counterfactual_is_realized_pnl') = 0
    AND json_extract(checkpoint_json, '$.source_comparison.capture_ratio_capped') = 0
    AND json_extract(checkpoint_json, '$.hypothetical_raven_fee.collection_authorized') = 0
    AND json_extract(checkpoint_json, '$.hypothetical_raven_fee.collected') = 0
    AND json_extract(checkpoint_json, '$.route_evidence.raw_provider_payload_included') = 0
    AND json_extract(checkpoint_json, '$.privacy.subscriber_identity_included') = 0
    AND json_extract(checkpoint_json, '$.privacy.watch_identity_included') = 0
    AND json_extract(checkpoint_json, '$.privacy.signer_material_included') = 0
    AND json_extract(checkpoint_json, '$.privacy.transaction_material_included') = 0
    AND json_extract(checkpoint_json, '$.execution_boundary.shadow_research_only') = 1
    AND json_extract(checkpoint_json, '$.execution_boundary.live_copy') = 0
    AND json_extract(checkpoint_json, '$.execution_boundary.signing') = 0
    AND json_extract(checkpoint_json, '$.execution_boundary.broadcasting') = 0
    AND json_extract(checkpoint_json, '$.execution_boundary.custody') = 0
    AND json_extract(checkpoint_json, '$.execution_boundary.fee_collection') = 0
    AND json_extract(checkpoint_json, '$.execution_boundary.transaction_hash') IS NULL
  ),
  evaluated_at INTEGER NOT NULL CHECK (evaluated_at >= 0),
  UNIQUE (observation_id, horizon_seconds),
  CHECK (checkpoint_id GLOB 'swfc_*' AND length(checkpoint_id) BETWEEN 20 AND 100),
  CHECK (route_available = 0 OR (
    gross_exit_usdc IS NOT NULL AND minimum_exit_usdc IS NOT NULL
    AND net_exit_usdc IS NOT NULL AND minimum_net_exit_usdc IS NOT NULL
  )),
  CHECK (follower_capture_ratio_pct IS NULL OR source_counterfactual_return_pct > 0)
);

CREATE INDEX ravenos_source_wallet_copyability_checkpoints_source_idx
  ON ravenos_source_wallet_copyability_checkpoints(
    source_wallet_id, standard_order_size_usdc, horizon_seconds,
    evaluated_at DESC, checkpoint_id
  );

CREATE INDEX ravenos_source_wallet_copyability_checkpoints_outcome_idx
  ON ravenos_source_wallet_copyability_checkpoints(
    hypothetical_raven_fee_bps, standard_order_size_usdc, horizon_seconds,
    route_available DESC, follower_capture_ratio_pct DESC, source_wallet_id
  );

CREATE TRIGGER ravenos_source_wallet_copyability_checkpoints_append_only
BEFORE UPDATE ON ravenos_source_wallet_copyability_checkpoints
BEGIN
  SELECT RAISE(ABORT, 'source_wallet_copyability_checkpoint_append_only');
END;

-- This lease contains no market, wallet, subscriber, or transaction data. It
-- only prevents overlapping scheduled jobs from multiplying provider calls.
CREATE TABLE ravenos_source_wallet_copyability_checkpoint_lease (
  lease_key TEXT PRIMARY KEY CHECK (lease_key = 'shared_copyability_checkpoints_v1'),
  lease_token TEXT,
  lease_expires_at INTEGER,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
);

-- Rebuildable current projection fields. The append-only checkpoint ledgers
-- remain authoritative and these values always refer to $100 at +1 hour.
ALTER TABLE ravenos_source_wallet_copyability_current
  ADD COLUMN outcome_checkpoint_count INTEGER NOT NULL DEFAULT 0
  CHECK (outcome_checkpoint_count >= 0);

ALTER TABLE ravenos_source_wallet_copyability_current
  ADD COLUMN outcome_reference_horizon_seconds INTEGER NOT NULL DEFAULT 3600
  CHECK (outcome_reference_horizon_seconds = 3600);

ALTER TABLE ravenos_source_wallet_copyability_current
  ADD COLUMN follower_route_persistence_pct REAL
  CHECK (follower_route_persistence_pct IS NULL OR follower_route_persistence_pct BETWEEN 0 AND 100);

ALTER TABLE ravenos_source_wallet_copyability_current
  ADD COLUMN median_follower_return_pct REAL;

ALTER TABLE ravenos_source_wallet_copyability_current
  ADD COLUMN follower_win_rate_pct REAL
  CHECK (follower_win_rate_pct IS NULL OR follower_win_rate_pct BETWEEN 0 AND 100);

ALTER TABLE ravenos_source_wallet_copyability_current
  ADD COLUMN follower_capture_sample_count INTEGER NOT NULL DEFAULT 0
  CHECK (follower_capture_sample_count >= 0);

ALTER TABLE ravenos_source_wallet_copyability_current
  ADD COLUMN follower_capture_ratio_pct REAL;

ALTER TABLE ravenos_source_wallet_copyability_current
  ADD COLUMN follower_minus_source_return_pct REAL;

CREATE INDEX ravenos_source_wallet_copyability_follower_capture_idx
  ON ravenos_source_wallet_copyability_current(
    hypothetical_raven_fee_bps, matrix_policy_hash,
    follower_capture_ratio_pct DESC, follower_capture_sample_count DESC,
    source_wallet_id
  );

CREATE INDEX ravenos_source_wallet_copyability_follower_return_idx
  ON ravenos_source_wallet_copyability_current(
    hypothetical_raven_fee_bps, matrix_policy_hash,
    median_follower_return_pct DESC, outcome_checkpoint_count DESC,
    source_wallet_id
  );
