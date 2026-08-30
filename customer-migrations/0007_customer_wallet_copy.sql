PRAGMA foreign_keys = ON;

-- Expand the existing server-owned Pro grant registry without creating a
-- second subscription system. This migration preserves every existing grant
-- and adds the single wallet.copy capability used by Raven Pro.
CREATE TABLE ravenos_customer_entitlement_grants_v2 (
  grant_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.customer_entitlement_grant.v1',
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  capability_key TEXT NOT NULL CHECK (capability_key IN (
    'intelligence.perps_advanced',
    'intelligence.participant_advanced',
    'intelligence.replay_advanced',
    'intelligence.export',
    'research.saved_state_extended',
    'research.saved_scans',
    'research.alerts',
    'atlas.native_breadth',
    'atlas.filing_comparisons',
    'atlas.native_filing_marks',
    'atlas.portfolio_context',
    'atlas.options_intelligence',
    'atlas.authenticated_broker_overlay',
    'wallet.copy'
  )),
  state TEXT NOT NULL CHECK (state IN ('active', 'expired', 'revoked', 'suspended')),
  grant_source TEXT NOT NULL CHECK (grant_source IN ('operator', 'test_fixture', 'migration')),
  activation_at INTEGER,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  source_reference TEXT NOT NULL CHECK (length(source_reference) BETWEEN 1 AND 160),
  CHECK (grant_id GLOB 'ent_*' AND length(grant_id) BETWEEN 20 AND 100),
  CHECK (activation_at IS NULL OR activation_at >= 0),
  CHECK (expires_at IS NULL OR expires_at >= 0),
  CHECK (expires_at IS NULL OR activation_at IS NULL OR expires_at > activation_at),
  CHECK (created_at >= 0 AND updated_at >= created_at),
  UNIQUE (user_id, capability_key, grant_id)
);

INSERT INTO ravenos_customer_entitlement_grants_v2 (
  grant_id, schema_version, user_id, capability_key, state, grant_source,
  activation_at, expires_at, created_at, updated_at, revision, source_reference
)
SELECT
  grant_id, schema_version, user_id, capability_key, state, grant_source,
  activation_at, expires_at, created_at, updated_at, revision, source_reference
FROM ravenos_customer_entitlement_grants;

DROP TABLE ravenos_customer_entitlement_grants;
ALTER TABLE ravenos_customer_entitlement_grants_v2 RENAME TO ravenos_customer_entitlement_grants;

CREATE INDEX ravenos_customer_entitlement_owner_capability_idx
  ON ravenos_customer_entitlement_grants(user_id, capability_key, state, expires_at, updated_at DESC);

-- Public-chain source wallets and decoded evidence are shared globally. A
-- source wallet is observed once even when many Raven Pro users follow it.
CREATE TABLE ravenos_source_wallets (
  source_wallet_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.source_wallet.v1',
  chain TEXT NOT NULL CHECK (chain = 'solana'),
  network TEXT NOT NULL CHECK (network = 'mainnet'),
  address TEXT NOT NULL CHECK (length(address) BETWEEN 32 AND 44),
  observation_state TEXT NOT NULL CHECK (observation_state IN ('requested', 'backfilled', 'current', 'delayed', 'unavailable')),
  provider_scope TEXT NOT NULL CHECK (length(provider_scope) BETWEEN 1 AND 80),
  first_requested_at INTEGER NOT NULL CHECK (first_requested_at >= 0),
  last_observed_at INTEGER,
  last_signature TEXT,
  updated_at INTEGER NOT NULL CHECK (updated_at >= first_requested_at),
  UNIQUE (chain, network, address),
  CHECK (source_wallet_id GLOB 'sw_sol_*' AND length(source_wallet_id) BETWEEN 20 AND 100),
  CHECK (last_observed_at IS NULL OR last_observed_at >= 0),
  CHECK (last_signature IS NULL OR length(last_signature) BETWEEN 64 AND 100)
);

CREATE INDEX ravenos_source_wallet_recency_idx
  ON ravenos_source_wallets(last_observed_at DESC, source_wallet_id);

-- Normalized public-chain observations are append-only and provider-neutral.
-- Raw provider payloads and transaction construction material are excluded.
CREATE TABLE ravenos_source_wallet_events (
  event_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.solana_wallet_event.v1',
  source_wallet_id TEXT NOT NULL REFERENCES ravenos_source_wallets(source_wallet_id) ON DELETE CASCADE,
  signature TEXT NOT NULL CHECK (length(signature) BETWEEN 64 AND 100),
  slot INTEGER NOT NULL CHECK (slot >= 0),
  block_time INTEGER,
  finality TEXT NOT NULL CHECK (finality IN ('processed', 'confirmed', 'finalized')),
  classification TEXT NOT NULL CHECK (classification IN (
    'SWAP_BUY', 'SWAP_SELL', 'MULTIHOP_SWAP', 'SPLIT_ROUTE_SWAP',
    'TRANSFER_IN', 'TRANSFER_OUT', 'AIRDROP', 'TOKEN_CREATION', 'MINT', 'BURN',
    'LIQUIDITY_ADD', 'LIQUIDITY_REMOVE', 'STAKE', 'UNSTAKE', 'BORROW', 'REPAY',
    'INTERNAL_ACCOUNT_MOVEMENT', 'FAILED_TRANSACTION', 'NON_TRADE', 'AMBIGUOUS', 'UNSUPPORTED'
  )),
  decode_version INTEGER NOT NULL CHECK (decode_version >= 1),
  evidence_hash TEXT NOT NULL CHECK (length(evidence_hash) = 40),
  event_json TEXT NOT NULL CHECK (json_valid(event_json) AND length(event_json) <= 49152),
  observed_at INTEGER NOT NULL CHECK (observed_at >= 0),
  retention_expires_at INTEGER NOT NULL CHECK (retention_expires_at > observed_at),
  UNIQUE (source_wallet_id, signature, decode_version),
  CHECK (event_id GLOB 'swe_*' AND length(event_id) BETWEEN 20 AND 100)
);

CREATE INDEX ravenos_source_wallet_events_wallet_time_idx
  ON ravenos_source_wallet_events(source_wallet_id, block_time DESC, observed_at DESC, event_id);

CREATE TRIGGER ravenos_source_wallet_events_append_only
BEFORE UPDATE ON ravenos_source_wallet_events
BEGIN
  SELECT RAISE(ABORT, 'source_wallet_event_append_only');
END;

-- Finality is an observation about an economic event, not a second trade.
-- Preserve each upgrade append-only without rewriting or duplicating the event.
CREATE TABLE ravenos_source_wallet_event_finality_observations (
  finality_observation_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES ravenos_source_wallet_events(event_id) ON DELETE CASCADE,
  finality TEXT NOT NULL CHECK (finality IN ('processed', 'confirmed', 'finalized')),
  provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 80),
  observed_at INTEGER NOT NULL CHECK (observed_at >= 0),
  UNIQUE (event_id, finality),
  CHECK (finality_observation_id GLOB 'swf_*' AND length(finality_observation_id) BETWEEN 20 AND 100)
);

CREATE INDEX ravenos_source_wallet_event_finality_idx
  ON ravenos_source_wallet_event_finality_observations(event_id, observed_at DESC);

CREATE TRIGGER ravenos_source_wallet_event_finality_append_only
BEFORE UPDATE ON ravenos_source_wallet_event_finality_observations
BEGIN
  SELECT RAISE(ABORT, 'source_wallet_event_finality_append_only');
END;

CREATE TABLE ravenos_source_wallet_profiles (
  profile_snapshot_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.solana_wallet_profile.v1',
  source_wallet_id TEXT NOT NULL REFERENCES ravenos_source_wallets(source_wallet_id) ON DELETE CASCADE,
  profile_version INTEGER NOT NULL CHECK (profile_version >= 1),
  history_start_at INTEGER,
  history_end_at INTEGER,
  normalized_event_count INTEGER NOT NULL CHECK (normalized_event_count >= 0),
  profile_json TEXT NOT NULL CHECK (json_valid(profile_json) AND length(profile_json) <= 65536),
  generated_at INTEGER NOT NULL CHECK (generated_at >= 0),
  retention_expires_at INTEGER NOT NULL CHECK (retention_expires_at > generated_at),
  CHECK (profile_snapshot_id GLOB 'swp_*' AND length(profile_snapshot_id) BETWEEN 20 AND 100)
);

CREATE INDEX ravenos_source_wallet_profiles_wallet_time_idx
  ON ravenos_source_wallet_profiles(source_wallet_id, generated_at DESC, profile_snapshot_id);

CREATE TRIGGER ravenos_source_wallet_profiles_append_only
BEFORE UPDATE ON ravenos_source_wallet_profiles
BEGIN
  SELECT RAISE(ABORT, 'source_wallet_profile_append_only');
END;

-- Subscriber-to-wallet relationships are private, owner-bound, quota-limited,
-- and cascade on account deletion. Multiple policies may follow one source.
CREATE TABLE ravenos_customer_wallet_copy_watches (
  watch_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.customer_wallet_copy_watch.v1',
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  source_wallet_id TEXT NOT NULL REFERENCES ravenos_source_wallets(source_wallet_id) ON DELETE RESTRICT,
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  state TEXT NOT NULL CHECK (state IN ('active', 'paused')),
  copy_mode TEXT NOT NULL CHECK (copy_mode IN ('MIRROR', 'RAVEN_COPY')),
  policy_version INTEGER NOT NULL CHECK (policy_version >= 1),
  policy_hash TEXT NOT NULL CHECK (length(policy_hash) = 40),
  policy_json TEXT NOT NULL CHECK (json_valid(policy_json) AND length(policy_json) <= 16384),
  cursor_signature TEXT,
  cursor_slot INTEGER,
  backfill_complete INTEGER NOT NULL DEFAULT 0 CHECK (backfill_complete IN (0, 1)),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  CHECK (watch_id GLOB 'wcw_*' AND length(watch_id) BETWEEN 20 AND 100),
  CHECK (cursor_signature IS NULL OR length(cursor_signature) BETWEEN 64 AND 100),
  CHECK (cursor_slot IS NULL OR cursor_slot >= 0)
);

CREATE INDEX ravenos_customer_wallet_copy_owner_idx
  ON ravenos_customer_wallet_copy_watches(user_id, updated_at DESC, watch_id);
CREATE INDEX ravenos_customer_wallet_copy_source_idx
  ON ravenos_customer_wallet_copy_watches(source_wallet_id, state, updated_at DESC);

-- Every prospective execute/refuse/indeterminate result remains visible.
-- Refusals are not converted into zero-return trades or silently dropped.
CREATE TABLE ravenos_customer_shadow_copy_decisions (
  decision_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.shadow_copy_decision.v1',
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  watch_id TEXT NOT NULL REFERENCES ravenos_customer_wallet_copy_watches(watch_id) ON DELETE CASCADE,
  source_event_id TEXT NOT NULL REFERENCES ravenos_source_wallet_events(event_id) ON DELETE RESTRICT,
  decision_state TEXT NOT NULL CHECK (decision_state IN (
    'SHADOW_EXECUTABLE', 'POLICY_REJECTED', 'ENTRY_UNAVAILABLE', 'EXIT_UNAVAILABLE',
    'ROUTE_STALE', 'SIMULATION_FAILED', 'FUNDING_NOT_READY', 'FRICTION_TOO_HIGH',
    'LIQUIDITY_TOO_LOW', 'COPY_DELAY_TOO_HIGH', 'ASSET_RESTRICTED',
    'PROVIDER_UNAVAILABLE', 'INDETERMINATE'
  )),
  reason_code TEXT NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 100),
  policy_version INTEGER NOT NULL CHECK (policy_version >= 1),
  policy_hash TEXT NOT NULL CHECK (length(policy_hash) = 40),
  source_event_at INTEGER,
  decided_at INTEGER NOT NULL CHECK (decided_at >= 0),
  decision_json TEXT NOT NULL CHECK (json_valid(decision_json) AND length(decision_json) <= 65536),
  live_execution_authorized INTEGER NOT NULL DEFAULT 0 CHECK (live_execution_authorized = 0),
  fee_collection_authorized INTEGER NOT NULL DEFAULT 0 CHECK (fee_collection_authorized = 0),
  transaction_hash TEXT CHECK (transaction_hash IS NULL),
  retention_expires_at INTEGER NOT NULL CHECK (retention_expires_at > decided_at),
  CHECK (decision_id GLOB 'scd_*' AND length(decision_id) BETWEEN 20 AND 100),
  UNIQUE (user_id, watch_id, decision_id)
);

CREATE INDEX ravenos_customer_shadow_copy_decisions_owner_time_idx
  ON ravenos_customer_shadow_copy_decisions(user_id, decided_at DESC, decision_id);
CREATE INDEX ravenos_customer_shadow_copy_decisions_watch_time_idx
  ON ravenos_customer_shadow_copy_decisions(watch_id, decided_at DESC, decision_id);

CREATE TRIGGER ravenos_customer_shadow_copy_decisions_append_only
BEFORE UPDATE ON ravenos_customer_shadow_copy_decisions
BEGIN
  SELECT RAISE(ABORT, 'shadow_copy_decision_append_only');
END;

CREATE TABLE ravenos_customer_shadow_copy_positions (
  position_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.shadow_copy_position.v1',
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  watch_id TEXT NOT NULL REFERENCES ravenos_customer_wallet_copy_watches(watch_id) ON DELETE CASCADE,
  source_event_id TEXT NOT NULL REFERENCES ravenos_source_wallet_events(event_id) ON DELETE RESTRICT,
  opening_decision_id TEXT NOT NULL REFERENCES ravenos_customer_shadow_copy_decisions(decision_id) ON DELETE RESTRICT,
  asset_mint TEXT NOT NULL CHECK (length(asset_mint) BETWEEN 32 AND 44),
  state TEXT NOT NULL CHECK (state IN ('SHADOW_OPEN', 'SHADOW_PARTIAL_EXIT', 'SHADOW_CLOSED')),
  position_json TEXT NOT NULL CHECK (json_valid(position_json) AND length(position_json) <= 32768),
  opened_at INTEGER NOT NULL CHECK (opened_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= opened_at),
  live_assets_held INTEGER NOT NULL DEFAULT 0 CHECK (live_assets_held = 0),
  transaction_hash TEXT CHECK (transaction_hash IS NULL),
  CHECK (position_id GLOB 'scp_*' AND length(position_id) BETWEEN 20 AND 100)
);

CREATE INDEX ravenos_customer_shadow_copy_positions_owner_idx
  ON ravenos_customer_shadow_copy_positions(user_id, state, updated_at DESC, position_id);

CREATE TABLE ravenos_customer_shadow_copy_checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.shadow_copy_checkpoint.v1',
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  position_id TEXT NOT NULL REFERENCES ravenos_customer_shadow_copy_positions(position_id) ON DELETE CASCADE,
  horizon_seconds INTEGER NOT NULL CHECK (horizon_seconds IN (30, 60, 90, 300, 900, 3600, 14400, 86400)),
  state TEXT NOT NULL CHECK (state IN ('served', 'unavailable', 'unserved')),
  checkpoint_json TEXT NOT NULL CHECK (json_valid(checkpoint_json) AND length(checkpoint_json) <= 32768),
  observed_at INTEGER NOT NULL CHECK (observed_at >= 0),
  retention_expires_at INTEGER NOT NULL CHECK (retention_expires_at > observed_at),
  UNIQUE (position_id, horizon_seconds),
  CHECK (checkpoint_id GLOB 'scc_*' AND length(checkpoint_id) BETWEEN 20 AND 100)
);

CREATE INDEX ravenos_customer_shadow_copy_checkpoints_owner_time_idx
  ON ravenos_customer_shadow_copy_checkpoints(user_id, observed_at DESC, checkpoint_id);

CREATE TRIGGER ravenos_customer_shadow_copy_checkpoints_append_only
BEFORE UPDATE ON ravenos_customer_shadow_copy_checkpoints
BEGIN
  SELECT RAISE(ABORT, 'shadow_copy_checkpoint_append_only');
END;
