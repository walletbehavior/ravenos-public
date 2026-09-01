-- Extend Raven's shared source-wallet evidence ledger to Robinhood Chain
-- without representing EVM transactions as Solana signatures or blocks as
-- slots. Existing Solana rows and identifiers remain byte-for-byte stable.
--
-- D1 applies migrations with foreign keys enabled. Renaming an existing
-- parent table would rewrite every child reference to the temporary name, and
-- defer_foreign_keys does not suppress ON DELETE actions. This migration uses
-- SQLite's safe create/copy/drop/rename sequence instead. Every dependent row
-- is snapshotted, removed before the parent swap, and restored before commit.
-- The surrounding D1 transaction makes the entire operation atomic.
PRAGMA defer_foreign_keys = ON;

-- Preserve the complete source-wallet dependency graph before either parent
-- table is replaced. These are migration-only tables and are dropped below.
CREATE TABLE ravenos_m0023_customer_shadow_copy_checkpoints AS SELECT * FROM ravenos_customer_shadow_copy_checkpoints;
CREATE TABLE ravenos_m0023_customer_shadow_copy_decisions AS SELECT * FROM ravenos_customer_shadow_copy_decisions;
CREATE TABLE ravenos_m0023_customer_shadow_copy_exit_allocations AS SELECT * FROM ravenos_customer_shadow_copy_exit_allocations;
CREATE TABLE ravenos_m0023_customer_shadow_copy_exit_decisions AS SELECT * FROM ravenos_customer_shadow_copy_exit_decisions;
CREATE TABLE ravenos_m0023_customer_shadow_copy_positions AS SELECT * FROM ravenos_customer_shadow_copy_positions;
CREATE TABLE ravenos_m0023_customer_wallet_copy_watches AS SELECT * FROM ravenos_customer_wallet_copy_watches;
CREATE TABLE ravenos_m0023_customer_wallet_research_saves AS SELECT * FROM ravenos_customer_wallet_research_saves;
CREATE TABLE ravenos_m0023_source_wallet_backfill_jobs AS SELECT * FROM ravenos_source_wallet_backfill_jobs;
CREATE TABLE ravenos_m0023_source_wallet_backfill_pages AS SELECT * FROM ravenos_source_wallet_backfill_pages;
CREATE TABLE ravenos_m0023_source_wallet_copy_crowding_observations AS SELECT * FROM ravenos_source_wallet_copy_crowding_observations;
CREATE TABLE ravenos_m0023_source_wallet_copy_demand_snapshots AS SELECT * FROM ravenos_source_wallet_copy_demand_snapshots;
CREATE TABLE ravenos_m0023_source_wallet_copyability_checkpoints AS SELECT * FROM ravenos_source_wallet_copyability_checkpoints;
CREATE TABLE ravenos_m0023_source_wallet_copyability_current AS SELECT * FROM ravenos_source_wallet_copyability_current;
CREATE TABLE ravenos_m0023_source_wallet_copyability_observations AS SELECT * FROM ravenos_source_wallet_copyability_observations;
CREATE TABLE ravenos_m0023_source_wallet_current_profiles AS SELECT * FROM ravenos_source_wallet_current_profiles;
CREATE TABLE ravenos_m0023_source_wallet_discovery_candidate_mints AS SELECT * FROM ravenos_source_wallet_discovery_candidate_mints;
CREATE TABLE ravenos_m0023_source_wallet_discovery_candidates AS SELECT * FROM ravenos_source_wallet_discovery_candidates;
CREATE TABLE ravenos_m0023_source_wallet_discovery_hydrations AS SELECT * FROM ravenos_source_wallet_discovery_hydrations;
CREATE TABLE ravenos_m0023_source_wallet_discovery_observations AS SELECT * FROM ravenos_source_wallet_discovery_observations;
CREATE TABLE ravenos_m0023_source_wallet_event_finality_observations AS SELECT * FROM ravenos_source_wallet_event_finality_observations;
CREATE TABLE ravenos_m0023_source_wallet_observer_deliveries AS SELECT * FROM ravenos_source_wallet_observer_deliveries;
CREATE TABLE ravenos_m0023_source_wallet_observer_jobs AS SELECT * FROM ravenos_source_wallet_observer_jobs;
CREATE TABLE ravenos_m0023_source_wallet_observer_latency AS SELECT * FROM ravenos_source_wallet_observer_latency;
CREATE TABLE ravenos_m0023_source_wallet_opportunity_checkpoints AS SELECT * FROM ravenos_source_wallet_opportunity_checkpoints;
CREATE TABLE ravenos_m0023_source_wallet_profiles AS SELECT * FROM ravenos_source_wallet_profiles;
CREATE TABLE ravenos_m0023_source_wallet_research_cohort AS SELECT * FROM ravenos_source_wallet_research_cohort;

-- Build the replacement parents while the old canonical tables are still
-- readable. The replacement event table points to the replacement source
-- table, so dropping the old source cannot cascade into the copied events.
CREATE TABLE ravenos_source_wallets_m0023_new (
  source_wallet_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.source_wallet.v2',
  chain TEXT NOT NULL CHECK (chain IN ('solana', 'robinhood')),
  network TEXT NOT NULL CHECK (network = 'mainnet'),
  chain_id TEXT NOT NULL DEFAULT 'solana',
  vm_family TEXT NOT NULL DEFAULT 'svm' CHECK (vm_family IN ('svm', 'evm')),
  address TEXT NOT NULL,
  observation_state TEXT NOT NULL CHECK (observation_state IN ('requested', 'backfilled', 'current', 'delayed', 'unavailable')),
  provider_scope TEXT NOT NULL CHECK (length(provider_scope) BETWEEN 1 AND 80),
  first_requested_at INTEGER NOT NULL CHECK (first_requested_at >= 0),
  last_observed_at INTEGER,
  last_transaction_reference TEXT,
  last_block_number INTEGER,
  -- Compatibility cursor for the existing Solana observer. Robinhood rows
  -- must leave this NULL and use last_transaction_reference/block_number.
  last_signature TEXT,
  updated_at INTEGER NOT NULL CHECK (updated_at >= first_requested_at),
  UNIQUE (chain, network, address),
  CHECK (last_observed_at IS NULL OR last_observed_at >= 0),
  CHECK (last_block_number IS NULL OR last_block_number >= 0),
  CHECK (
    (chain = 'solana'
      AND chain_id = 'solana'
      AND vm_family = 'svm'
      AND source_wallet_id GLOB 'sw_sol_*'
      AND length(address) BETWEEN 32 AND 44
      AND (last_signature IS NULL OR length(last_signature) BETWEEN 64 AND 100)
      AND (last_transaction_reference IS NULL OR length(last_transaction_reference) BETWEEN 64 AND 100))
    OR
    (chain = 'robinhood'
      AND chain_id = '4663'
      AND vm_family = 'evm'
      AND source_wallet_id GLOB 'sw_rh_*'
      AND length(address) = 42
      AND address = lower(address)
      AND substr(address, 1, 2) = '0x'
      AND substr(address, 3) NOT GLOB '*[^0-9a-f]*'
      AND last_signature IS NULL
      AND (last_transaction_reference IS NULL OR (
        length(last_transaction_reference) = 66
        AND last_transaction_reference = lower(last_transaction_reference)
        AND substr(last_transaction_reference, 1, 2) = '0x'
        AND substr(last_transaction_reference, 3) NOT GLOB '*[^0-9a-f]*'
      )))
  ),
  CHECK (length(source_wallet_id) BETWEEN 20 AND 100)
);

INSERT INTO ravenos_source_wallets_m0023_new (
  source_wallet_id, schema_version, chain, network, chain_id, vm_family,
  address, observation_state, provider_scope, first_requested_at,
  last_observed_at, last_transaction_reference, last_block_number,
  last_signature, updated_at
)
SELECT
  source_wallet_id, 'ravenos.source_wallet.v2', chain, network,
  'solana', 'svm', address, observation_state, provider_scope,
  first_requested_at, last_observed_at, last_signature, NULL,
  last_signature, updated_at
FROM ravenos_source_wallets;

CREATE TABLE ravenos_source_wallet_events_m0023_new (
  event_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  source_wallet_id TEXT NOT NULL REFERENCES ravenos_source_wallets_m0023_new(source_wallet_id) ON DELETE CASCADE,
  chain TEXT NOT NULL CHECK (chain IN ('solana', 'robinhood')),
  network TEXT NOT NULL CHECK (network = 'mainnet'),
  transaction_reference TEXT NOT NULL,
  -- Solana compatibility columns. They remain NULL for Robinhood events.
  signature TEXT,
  slot INTEGER,
  block_time INTEGER,
  -- EVM-native evidence. It remains NULL for Solana events.
  block_number INTEGER,
  block_hash TEXT,
  chain_event_time INTEGER,
  finality TEXT NOT NULL CHECK (finality IN ('pending', 'processed', 'confirmed', 'safe', 'finalized')),
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
  UNIQUE (source_wallet_id, transaction_reference, decode_version),
  CHECK (event_id GLOB 'swe_*' AND length(event_id) BETWEEN 20 AND 100),
  CHECK (slot IS NULL OR slot >= 0),
  CHECK (block_time IS NULL OR block_time >= 0),
  CHECK (block_number IS NULL OR block_number >= 0),
  CHECK (chain_event_time IS NULL OR chain_event_time >= 0),
  CHECK (
    (chain = 'solana'
      AND schema_version = 'ravenos.solana_wallet_event.v1'
      AND signature = transaction_reference
      AND length(signature) BETWEEN 64 AND 100
      AND slot IS NOT NULL
      AND block_number IS NULL
      AND block_hash IS NULL)
    OR
    (chain = 'robinhood'
      AND schema_version = 'ravenos.source_wallet_chain_event.v1'
      AND signature IS NULL
      AND slot IS NULL
      AND block_time IS NULL
      AND length(transaction_reference) = 66
      AND transaction_reference = lower(transaction_reference)
      AND substr(transaction_reference, 1, 2) = '0x'
      AND substr(transaction_reference, 3) NOT GLOB '*[^0-9a-f]*'
      AND block_number IS NOT NULL
      AND length(block_hash) = 66
      AND block_hash = lower(block_hash)
      AND substr(block_hash, 1, 2) = '0x'
      AND substr(block_hash, 3) NOT GLOB '*[^0-9a-f]*')
  )
);

INSERT INTO ravenos_source_wallet_events_m0023_new (
  event_id, schema_version, source_wallet_id, chain, network,
  transaction_reference, signature, slot, block_time, block_number,
  block_hash, chain_event_time, finality, classification, decode_version,
  evidence_hash, event_json, observed_at, retention_expires_at
)
SELECT
  event_id, schema_version, source_wallet_id, 'solana', 'mainnet',
  signature, signature, slot, block_time, NULL, NULL, block_time,
  finality, classification, decode_version, evidence_hash, event_json,
  observed_at, retention_expires_at
FROM ravenos_source_wallet_events;

-- Empty the dependency graph in child-first order. All rows are already in
-- the migration snapshots above; no observation is converted to a zero or
-- silently discarded.
DELETE FROM ravenos_customer_shadow_copy_checkpoints;
DELETE FROM ravenos_customer_shadow_copy_exit_allocations;
DELETE FROM ravenos_customer_shadow_copy_positions;
DELETE FROM ravenos_customer_shadow_copy_exit_decisions;
DELETE FROM ravenos_customer_shadow_copy_decisions;
DELETE FROM ravenos_customer_wallet_copy_watches;
DELETE FROM ravenos_customer_wallet_research_saves;
DELETE FROM ravenos_source_wallet_backfill_pages;
DELETE FROM ravenos_source_wallet_backfill_jobs;
DELETE FROM ravenos_source_wallet_copyability_checkpoints;
DELETE FROM ravenos_source_wallet_copyability_current;
DELETE FROM ravenos_source_wallet_copyability_observations;
DELETE FROM ravenos_source_wallet_copy_crowding_observations;
DELETE FROM ravenos_source_wallet_copy_demand_snapshots;
DELETE FROM ravenos_source_wallet_current_profiles;
DELETE FROM ravenos_source_wallet_profiles;
DELETE FROM ravenos_source_wallet_observer_jobs;
DELETE FROM ravenos_source_wallet_observer_latency;
DELETE FROM ravenos_source_wallet_observer_deliveries;
DELETE FROM ravenos_source_wallet_research_cohort;
DELETE FROM ravenos_source_wallet_discovery_hydrations;
DELETE FROM ravenos_source_wallet_discovery_candidate_mints;
DELETE FROM ravenos_source_wallet_discovery_observations;
DELETE FROM ravenos_source_wallet_discovery_candidates;
DELETE FROM ravenos_source_wallet_opportunity_checkpoints;
DELETE FROM ravenos_source_wallet_event_finality_observations;

DROP TRIGGER ravenos_source_wallet_event_finality_append_only;
DROP INDEX ravenos_source_wallet_event_finality_idx;
DROP TABLE ravenos_source_wallet_event_finality_observations;

DROP INDEX ravenos_source_wallet_recency_idx;
DROP TABLE ravenos_source_wallets;
ALTER TABLE ravenos_source_wallets_m0023_new RENAME TO ravenos_source_wallets;

DROP TRIGGER ravenos_source_wallet_events_append_only;
DROP INDEX ravenos_source_wallet_events_wallet_time_idx;
DROP TABLE ravenos_source_wallet_events;
ALTER TABLE ravenos_source_wallet_events_m0023_new RENAME TO ravenos_source_wallet_events;

CREATE INDEX ravenos_source_wallet_recency_idx
  ON ravenos_source_wallets(chain, network, last_observed_at DESC, source_wallet_id);

CREATE INDEX ravenos_source_wallet_events_wallet_time_idx
  ON ravenos_source_wallet_events(
    source_wallet_id,
    block_time DESC,
    chain_event_time DESC,
    observed_at DESC,
    event_id
  );

CREATE INDEX ravenos_source_wallet_events_chain_transaction_idx
  ON ravenos_source_wallet_events(chain, network, transaction_reference, decode_version);

CREATE TRIGGER ravenos_source_wallet_events_append_only
BEFORE UPDATE ON ravenos_source_wallet_events
BEGIN
  SELECT RAISE(ABORT, 'source_wallet_event_append_only');
END;

CREATE TABLE ravenos_source_wallet_event_finality_observations (
  finality_observation_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES ravenos_source_wallet_events(event_id) ON DELETE CASCADE,
  finality TEXT NOT NULL CHECK (finality IN ('pending', 'processed', 'confirmed', 'safe', 'finalized')),
  provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 80),
  observed_at INTEGER NOT NULL CHECK (observed_at >= 0),
  UNIQUE (event_id, finality, provider),
  CHECK (finality_observation_id GLOB 'swf_*' AND length(finality_observation_id) BETWEEN 20 AND 100)
);

CREATE INDEX ravenos_source_wallet_event_finality_idx
  ON ravenos_source_wallet_event_finality_observations(event_id, observed_at DESC);

CREATE TRIGGER ravenos_source_wallet_event_finality_append_only
BEFORE UPDATE ON ravenos_source_wallet_event_finality_observations
BEGIN
  SELECT RAISE(ABORT, 'source_wallet_event_finality_append_only');
END;

-- Restore every child table in dependency order while foreign-key checks are
-- deferred. Existing table definitions, triggers, private ownership, and
-- append-only evidence remain unchanged.
INSERT INTO ravenos_source_wallet_event_finality_observations SELECT * FROM ravenos_m0023_source_wallet_event_finality_observations;
INSERT INTO ravenos_source_wallet_profiles SELECT * FROM ravenos_m0023_source_wallet_profiles;
INSERT INTO ravenos_source_wallet_current_profiles SELECT * FROM ravenos_m0023_source_wallet_current_profiles;
INSERT INTO ravenos_source_wallet_discovery_candidates SELECT * FROM ravenos_m0023_source_wallet_discovery_candidates;
INSERT INTO ravenos_source_wallet_discovery_candidate_mints SELECT * FROM ravenos_m0023_source_wallet_discovery_candidate_mints;
INSERT INTO ravenos_source_wallet_discovery_observations SELECT * FROM ravenos_m0023_source_wallet_discovery_observations;
INSERT INTO ravenos_source_wallet_discovery_hydrations SELECT * FROM ravenos_m0023_source_wallet_discovery_hydrations;
INSERT INTO ravenos_source_wallet_research_cohort SELECT * FROM ravenos_m0023_source_wallet_research_cohort;
INSERT INTO ravenos_source_wallet_observer_deliveries SELECT * FROM ravenos_m0023_source_wallet_observer_deliveries;
INSERT INTO ravenos_source_wallet_observer_jobs SELECT * FROM ravenos_m0023_source_wallet_observer_jobs;
INSERT INTO ravenos_source_wallet_observer_latency SELECT * FROM ravenos_m0023_source_wallet_observer_latency;
INSERT INTO ravenos_source_wallet_backfill_jobs SELECT * FROM ravenos_m0023_source_wallet_backfill_jobs;
INSERT INTO ravenos_source_wallet_backfill_pages SELECT * FROM ravenos_m0023_source_wallet_backfill_pages;
INSERT INTO ravenos_customer_wallet_copy_watches SELECT * FROM ravenos_m0023_customer_wallet_copy_watches;
INSERT INTO ravenos_customer_shadow_copy_decisions SELECT * FROM ravenos_m0023_customer_shadow_copy_decisions;
INSERT INTO ravenos_customer_shadow_copy_positions SELECT * FROM ravenos_m0023_customer_shadow_copy_positions;
INSERT INTO ravenos_customer_shadow_copy_checkpoints SELECT * FROM ravenos_m0023_customer_shadow_copy_checkpoints;
INSERT INTO ravenos_customer_shadow_copy_exit_decisions SELECT * FROM ravenos_m0023_customer_shadow_copy_exit_decisions;
INSERT INTO ravenos_customer_shadow_copy_exit_allocations SELECT * FROM ravenos_m0023_customer_shadow_copy_exit_allocations;
INSERT INTO ravenos_source_wallet_opportunity_checkpoints SELECT * FROM ravenos_m0023_source_wallet_opportunity_checkpoints;
INSERT INTO ravenos_source_wallet_copyability_observations SELECT * FROM ravenos_m0023_source_wallet_copyability_observations;
INSERT INTO ravenos_source_wallet_copyability_checkpoints SELECT * FROM ravenos_m0023_source_wallet_copyability_checkpoints;
INSERT INTO ravenos_source_wallet_copyability_current SELECT * FROM ravenos_m0023_source_wallet_copyability_current;
INSERT INTO ravenos_source_wallet_copy_demand_snapshots SELECT * FROM ravenos_m0023_source_wallet_copy_demand_snapshots;
INSERT INTO ravenos_source_wallet_copy_crowding_observations SELECT * FROM ravenos_m0023_source_wallet_copy_crowding_observations;
INSERT INTO ravenos_customer_wallet_research_saves SELECT * FROM ravenos_m0023_customer_wallet_research_saves;

DROP TABLE ravenos_m0023_customer_shadow_copy_checkpoints;
DROP TABLE ravenos_m0023_customer_shadow_copy_decisions;
DROP TABLE ravenos_m0023_customer_shadow_copy_exit_allocations;
DROP TABLE ravenos_m0023_customer_shadow_copy_exit_decisions;
DROP TABLE ravenos_m0023_customer_shadow_copy_positions;
DROP TABLE ravenos_m0023_customer_wallet_copy_watches;
DROP TABLE ravenos_m0023_customer_wallet_research_saves;
DROP TABLE ravenos_m0023_source_wallet_backfill_jobs;
DROP TABLE ravenos_m0023_source_wallet_backfill_pages;
DROP TABLE ravenos_m0023_source_wallet_copy_crowding_observations;
DROP TABLE ravenos_m0023_source_wallet_copy_demand_snapshots;
DROP TABLE ravenos_m0023_source_wallet_copyability_checkpoints;
DROP TABLE ravenos_m0023_source_wallet_copyability_current;
DROP TABLE ravenos_m0023_source_wallet_copyability_observations;
DROP TABLE ravenos_m0023_source_wallet_current_profiles;
DROP TABLE ravenos_m0023_source_wallet_discovery_candidate_mints;
DROP TABLE ravenos_m0023_source_wallet_discovery_candidates;
DROP TABLE ravenos_m0023_source_wallet_discovery_hydrations;
DROP TABLE ravenos_m0023_source_wallet_discovery_observations;
DROP TABLE ravenos_m0023_source_wallet_event_finality_observations;
DROP TABLE ravenos_m0023_source_wallet_observer_deliveries;
DROP TABLE ravenos_m0023_source_wallet_observer_jobs;
DROP TABLE ravenos_m0023_source_wallet_observer_latency;
DROP TABLE ravenos_m0023_source_wallet_opportunity_checkpoints;
DROP TABLE ravenos_m0023_source_wallet_profiles;
DROP TABLE ravenos_m0023_source_wallet_research_cohort;

PRAGMA foreign_key_check;
