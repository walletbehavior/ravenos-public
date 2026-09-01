PRAGMA foreign_keys = ON;

-- A prospective source-wallet sale is evaluated once for each private watch.
-- The decision remains visible even when Raven refuses it or ignores inventory
-- that predates the watch. No row can authorize, sign, broadcast, or claim a
-- live asset movement.
CREATE TABLE ravenos_customer_shadow_copy_exit_decisions (
  exit_decision_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.shadow_copy_exit_decision.v1',
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  watch_id TEXT NOT NULL REFERENCES ravenos_customer_wallet_copy_watches(watch_id) ON DELETE CASCADE,
  source_event_id TEXT NOT NULL REFERENCES ravenos_source_wallet_events(event_id) ON DELETE RESTRICT,
  asset_mint TEXT NOT NULL CHECK (length(asset_mint) BETWEEN 32 AND 44),
  decision_state TEXT NOT NULL CHECK (decision_state IN (
    'SHADOW_EXIT_EXECUTABLE', 'POLICY_REJECTED', 'EXIT_UNAVAILABLE',
    'ROUTE_STALE', 'SIMULATION_FAILED', 'PROVIDER_UNAVAILABLE',
    'INDETERMINATE', 'IGNORED_PRE_SUBSCRIPTION_INVENTORY'
  )),
  reason_code TEXT NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 100),
  policy_version INTEGER NOT NULL CHECK (policy_version >= 1),
  policy_hash TEXT NOT NULL CHECK (length(policy_hash) = 40),
  source_event_at INTEGER,
  decided_at INTEGER NOT NULL CHECK (decided_at >= 0),
  exit_json TEXT NOT NULL CHECK (json_valid(exit_json) AND length(exit_json) <= 65536),
  live_execution_authorized INTEGER NOT NULL DEFAULT 0 CHECK (live_execution_authorized = 0),
  fee_collection_authorized INTEGER NOT NULL DEFAULT 0 CHECK (fee_collection_authorized = 0),
  transaction_hash TEXT CHECK (transaction_hash IS NULL),
  retention_expires_at INTEGER NOT NULL CHECK (retention_expires_at > decided_at),
  CHECK (exit_decision_id GLOB 'sce_*' AND length(exit_decision_id) BETWEEN 20 AND 100),
  UNIQUE (user_id, watch_id, source_event_id, policy_hash)
);

CREATE INDEX ravenos_shadow_copy_exits_owner_time_idx
  ON ravenos_customer_shadow_copy_exit_decisions(user_id, decided_at DESC, exit_decision_id);
CREATE INDEX ravenos_shadow_copy_exits_watch_time_idx
  ON ravenos_customer_shadow_copy_exit_decisions(watch_id, decided_at DESC, exit_decision_id);

CREATE TRIGGER ravenos_shadow_copy_exit_decisions_append_only
BEFORE UPDATE ON ravenos_customer_shadow_copy_exit_decisions
BEGIN
  SELECT RAISE(ABORT, 'shadow_copy_exit_decision_append_only');
END;

-- One exit decision can proportionally map across several Raven-created lots.
-- Allocations are append-only evidence. Current position state is derived from
-- applied allocations so a crash cannot leave a mutable projection ahead of
-- its economic evidence.
CREATE TABLE ravenos_customer_shadow_copy_exit_allocations (
  allocation_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.shadow_copy_exit_allocation.v1',
  exit_decision_id TEXT NOT NULL REFERENCES ravenos_customer_shadow_copy_exit_decisions(exit_decision_id) ON DELETE CASCADE,
  position_id TEXT NOT NULL REFERENCES ravenos_customer_shadow_copy_positions(position_id) ON DELETE CASCADE,
  quantity_base_units TEXT NOT NULL CHECK (
    length(quantity_base_units) BETWEEN 1 AND 80
    AND quantity_base_units NOT GLOB '*[^0-9]*'
  ),
  applied INTEGER NOT NULL CHECK (applied IN (0, 1)),
  allocation_json TEXT NOT NULL CHECK (json_valid(allocation_json) AND length(allocation_json) <= 16384),
  live_assets_held INTEGER NOT NULL DEFAULT 0 CHECK (live_assets_held = 0),
  transaction_hash TEXT CHECK (transaction_hash IS NULL),
  recorded_at INTEGER NOT NULL CHECK (recorded_at >= 0),
  CHECK (allocation_id GLOB 'sca_*' AND length(allocation_id) BETWEEN 20 AND 100),
  UNIQUE (exit_decision_id, position_id)
);

CREATE INDEX ravenos_shadow_copy_exit_allocations_position_idx
  ON ravenos_customer_shadow_copy_exit_allocations(position_id, recorded_at, allocation_id);

CREATE TRIGGER ravenos_shadow_copy_exit_allocations_append_only
BEFORE UPDATE ON ravenos_customer_shadow_copy_exit_allocations
BEGIN
  SELECT RAISE(ABORT, 'shadow_copy_exit_allocation_append_only');
END;
