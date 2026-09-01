PRAGMA foreign_keys = ON;

-- Raven Agents is paper-only in this release. The durable model stores typed,
-- hash-bound records and operational saga state. It deliberately contains no
-- key, signature, calldata, destination-address, or broadcast-material fields.
CREATE TABLE ravenos_agents (
  agent_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  current_spec_id TEXT,
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN (
    'draft', 'validated', 'paper', 'paper_paused', 'paper_accepted',
    'live_candidate', 'live', 'paused', 'killed', 'expired', 'failed'
  )),
  environment TEXT NOT NULL DEFAULT 'paper' CHECK (environment = 'paper'),
  live_execution_enabled INTEGER NOT NULL DEFAULT 0 CHECK (live_execution_enabled = 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (agent_id GLOB 'agt_*' AND length(agent_id) BETWEEN 20 AND 100),
  CHECK (updated_at >= created_at)
);

CREATE INDEX ravenos_agents_user_state_idx
  ON ravenos_agents(user_id, lifecycle_state, updated_at DESC, agent_id);

CREATE TABLE ravenos_agent_specs (
  spec_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES ravenos_agents(agent_id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version >= 1),
  schema_version TEXT NOT NULL,
  specification_hash TEXT NOT NULL CHECK (length(specification_hash) = 64),
  record_hash TEXT NOT NULL CHECK (length(record_hash) = 64),
  spec_json TEXT NOT NULL CHECK (json_valid(spec_json) AND length(spec_json) <= 262144),
  created_at INTEGER NOT NULL,
  UNIQUE (agent_id, version),
  UNIQUE (agent_id, specification_hash)
);

CREATE INDEX ravenos_agent_specs_user_idx
  ON ravenos_agent_specs(user_id, agent_id, version DESC);

CREATE TABLE ravenos_agent_evidence_packets (
  evidence_packet_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES ravenos_agents(agent_id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE RESTRICT,
  spec_id TEXT NOT NULL REFERENCES ravenos_agent_specs(spec_id) ON DELETE RESTRICT,
  schema_version TEXT NOT NULL,
  record_hash TEXT NOT NULL CHECK (length(record_hash) = 64),
  observed_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json) AND length(evidence_json) <= 524288),
  CHECK (expires_at > observed_at)
);

CREATE INDEX ravenos_agent_evidence_due_idx
  ON ravenos_agent_evidence_packets(user_id, agent_id, observed_at DESC, evidence_packet_id);

CREATE TABLE ravenos_agent_trade_plans (
  plan_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES ravenos_agents(agent_id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE RESTRICT,
  spec_id TEXT NOT NULL REFERENCES ravenos_agent_specs(spec_id) ON DELETE RESTRICT,
  evidence_packet_id TEXT NOT NULL REFERENCES ravenos_agent_evidence_packets(evidence_packet_id) ON DELETE RESTRICT,
  schema_version TEXT NOT NULL,
  record_hash TEXT NOT NULL CHECK (length(record_hash) = 64),
  idempotency_key TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('preview', 'paper')),
  expires_at INTEGER NOT NULL,
  plan_json TEXT NOT NULL CHECK (json_valid(plan_json) AND length(plan_json) <= 262144),
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, idempotency_key),
  CHECK (expires_at > created_at)
);

CREATE INDEX ravenos_agent_trade_plans_user_idx
  ON ravenos_agent_trade_plans(user_id, agent_id, created_at DESC, plan_id);

CREATE TABLE ravenos_agent_trade_intents (
  intent_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES ravenos_agent_trade_plans(plan_id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE RESTRICT,
  leg_id TEXT NOT NULL,
  chain_id TEXT NOT NULL,
  venue_id TEXT NOT NULL,
  instrument_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  record_hash TEXT NOT NULL CHECK (length(record_hash) = 64),
  intent_json TEXT NOT NULL CHECK (json_valid(intent_json) AND length(intent_json) <= 131072),
  created_at INTEGER NOT NULL,
  UNIQUE (plan_id, leg_id)
);

CREATE INDEX ravenos_agent_trade_intents_scope_idx
  ON ravenos_agent_trade_intents(user_id, chain_id, venue_id, created_at DESC, intent_id);

CREATE TABLE ravenos_agent_policy_decisions (
  decision_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES ravenos_agent_trade_plans(plan_id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE RESTRICT,
  result TEXT NOT NULL CHECK (result IN ('allow', 'block', 'require_approval', 'indeterminate')),
  policy_id TEXT NOT NULL,
  policy_hash TEXT NOT NULL CHECK (length(policy_hash) = 64),
  plan_hash TEXT NOT NULL CHECK (length(plan_hash) = 64),
  evidence_hash TEXT NOT NULL CHECK (length(evidence_hash) = 64),
  portfolio_hash TEXT NOT NULL CHECK (length(portfolio_hash) = 64),
  decision_hash TEXT NOT NULL CHECK (length(decision_hash) = 64),
  expires_at INTEGER NOT NULL,
  decision_json TEXT NOT NULL CHECK (json_valid(decision_json) AND length(decision_json) <= 262144),
  created_at INTEGER NOT NULL,
  CHECK (expires_at > created_at)
);

CREATE INDEX ravenos_agent_policy_decisions_plan_idx
  ON ravenos_agent_policy_decisions(user_id, plan_id, created_at DESC, decision_id);

CREATE TABLE ravenos_agent_execution_receipts (
  receipt_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES ravenos_agent_trade_plans(plan_id) ON DELETE RESTRICT,
  intent_id TEXT NOT NULL REFERENCES ravenos_agent_trade_intents(intent_id) ON DELETE RESTRICT,
  decision_id TEXT NOT NULL REFERENCES ravenos_agent_policy_decisions(decision_id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE RESTRICT,
  environment TEXT NOT NULL CHECK (environment IN ('preview', 'paper')),
  status TEXT NOT NULL,
  receipt_hash TEXT NOT NULL CHECK (length(receipt_hash) = 64),
  reconciliation_status TEXT NOT NULL,
  receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json) AND length(receipt_json) <= 262144),
  observed_at INTEGER NOT NULL
);

CREATE INDEX ravenos_agent_execution_receipts_plan_idx
  ON ravenos_agent_execution_receipts(user_id, plan_id, observed_at, receipt_id);

CREATE TABLE ravenos_agent_outcomes (
  outcome_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES ravenos_agent_trade_plans(plan_id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE RESTRICT,
  outcome_type TEXT NOT NULL,
  record_hash TEXT NOT NULL CHECK (length(record_hash) = 64),
  outcome_json TEXT NOT NULL CHECK (json_valid(outcome_json) AND length(outcome_json) <= 262144),
  observed_at INTEGER NOT NULL
);

CREATE INDEX ravenos_agent_outcomes_user_idx
  ON ravenos_agent_outcomes(user_id, observed_at DESC, outcome_id);

CREATE TABLE ravenos_agent_audit_events (
  event_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE RESTRICT,
  agent_id TEXT NOT NULL REFERENCES ravenos_agents(agent_id) ON DELETE RESTRICT,
  plan_id TEXT,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  event_type TEXT NOT NULL,
  previous_event_hash TEXT,
  event_hash TEXT NOT NULL CHECK (length(event_hash) = 64),
  event_json TEXT NOT NULL CHECK (json_valid(event_json) AND length(event_json) <= 131072),
  observed_at INTEGER NOT NULL,
  UNIQUE (agent_id, sequence)
);

CREATE INDEX ravenos_agent_audit_events_plan_idx
  ON ravenos_agent_audit_events(user_id, plan_id, sequence, event_id);

-- Mutable orchestration state is separate from immutable economic evidence.
CREATE TABLE ravenos_agent_plan_sagas (
  plan_id TEXT PRIMARY KEY REFERENCES ravenos_agent_trade_plans(plan_id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN (
    'proposed', 'validated', 'policy_pending', 'approval_required', 'approved',
    'previewing', 'ready', 'executing', 'partially_executed',
    'reconciliation_required', 'completed', 'compensation_required',
    'compensating', 'compensated', 'failed', 'cancelled', 'expired'
  )),
  state_version INTEGER NOT NULL DEFAULT 1 CHECK (state_version >= 1),
  unresolved_required_legs INTEGER NOT NULL DEFAULT 0 CHECK (unresolved_required_legs >= 0),
  saga_json TEXT NOT NULL CHECK (json_valid(saga_json) AND length(saga_json) <= 262144),
  updated_at INTEGER NOT NULL
);

CREATE INDEX ravenos_agent_plan_sagas_work_idx
  ON ravenos_agent_plan_sagas(state, updated_at, plan_id);

CREATE TABLE ravenos_agent_capital_reservations (
  reservation_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES ravenos_agent_trade_plans(plan_id) ON DELETE RESTRICT,
  intent_id TEXT NOT NULL REFERENCES ravenos_agent_trade_intents(intent_id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  chain_id TEXT NOT NULL,
  venue_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  amount_atomic TEXT NOT NULL CHECK (amount_atomic NOT GLOB '*[^0-9]*'),
  gas_asset_id TEXT,
  gas_amount_atomic TEXT NOT NULL DEFAULT '0' CHECK (gas_amount_atomic NOT GLOB '*[^0-9]*'),
  state TEXT NOT NULL CHECK (state IN ('reserved', 'consumed', 'released')),
  reservation_hash TEXT NOT NULL CHECK (length(reservation_hash) = 64),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (updated_at >= created_at)
);

CREATE INDEX ravenos_agent_capital_reservations_location_idx
  ON ravenos_agent_capital_reservations(user_id, chain_id, venue_id, asset_id, state, updated_at);

CREATE TABLE ravenos_agent_outbox (
  outbox_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES ravenos_agent_trade_plans(plan_id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN ('paper_preview', 'paper_place', 'reconcile')),
  idempotency_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'leased', 'completed', 'failed', 'cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 20),
  available_at INTEGER NOT NULL,
  lease_expires_at INTEGER,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json) AND length(payload_json) <= 131072),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, idempotency_key),
  CHECK (updated_at >= created_at)
);

CREATE INDEX ravenos_agent_outbox_due_idx
  ON ravenos_agent_outbox(state, available_at, outbox_id);

-- Resource-bounded Robinhood Chain ingestion keeps only cursors and derived
-- watched-contract evidence. It is not a raw-block archive or full node.
CREATE TABLE ravenos_robinhood_ingestion_cursors (
  cursor_id TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL CHECK (chain_id IN (4663, 46630)),
  network TEXT NOT NULL CHECK (network IN ('mainnet', 'testnet')),
  next_block INTEGER NOT NULL CHECK (next_block >= 0),
  last_canonical_block INTEGER,
  last_canonical_hash TEXT,
  state_version INTEGER NOT NULL DEFAULT 1 CHECK (state_version >= 1),
  cursor_json TEXT NOT NULL CHECK (json_valid(cursor_json) AND length(cursor_json) <= 65536),
  updated_at INTEGER NOT NULL,
  UNIQUE (chain_id, network)
);

CREATE TABLE ravenos_robinhood_log_observations (
  observation_id TEXT PRIMARY KEY,
  event_position_id TEXT NOT NULL,
  chain_id INTEGER NOT NULL CHECK (chain_id IN (4663, 46630)),
  network TEXT NOT NULL CHECK (network IN ('mainnet', 'testnet')),
  block_number INTEGER NOT NULL CHECK (block_number >= 0),
  block_hash TEXT NOT NULL CHECK (block_hash GLOB '0x*' AND length(block_hash) = 66),
  transaction_hash TEXT NOT NULL CHECK (transaction_hash GLOB '0x*' AND length(transaction_hash) = 66),
  transaction_index INTEGER NOT NULL CHECK (transaction_index >= 0),
  log_index INTEGER NOT NULL CHECK (log_index >= 0),
  contract_address TEXT NOT NULL CHECK (contract_address GLOB '0x*' AND length(contract_address) = 42),
  registry_id TEXT NOT NULL,
  registry_category TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  observation_hash TEXT NOT NULL CHECK (length(observation_hash) = 64),
  observation_json TEXT NOT NULL CHECK (json_valid(observation_json) AND length(observation_json) <= 131072),
  observed_at INTEGER NOT NULL
);

CREATE INDEX ravenos_robinhood_log_block_idx
  ON ravenos_robinhood_log_observations(chain_id, block_number, log_index, observation_id);
CREATE INDEX ravenos_robinhood_log_contract_idx
  ON ravenos_robinhood_log_observations(chain_id, contract_address, block_number DESC, observation_id);
CREATE INDEX ravenos_robinhood_log_position_idx
  ON ravenos_robinhood_log_observations(chain_id, network, event_position_id, observed_at DESC, observation_id);

CREATE TABLE ravenos_robinhood_block_anchors (
  anchor_id TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL CHECK (chain_id IN (4663, 46630)),
  network TEXT NOT NULL CHECK (network IN ('mainnet', 'testnet')),
  block_number INTEGER NOT NULL CHECK (block_number >= 0),
  block_hash TEXT NOT NULL CHECK (block_hash GLOB '0x*' AND length(block_hash) = 66),
  parent_hash TEXT NOT NULL CHECK (parent_hash GLOB '0x*' AND length(parent_hash) = 66),
  block_time TEXT,
  provider_id TEXT NOT NULL CHECK (length(provider_id) BETWEEN 1 AND 80),
  anchor_hash TEXT NOT NULL CHECK (length(anchor_hash) = 64),
  anchor_json TEXT NOT NULL CHECK (json_valid(anchor_json) AND length(anchor_json) <= 65536),
  observed_at INTEGER NOT NULL,
  UNIQUE (chain_id, network, block_number, block_hash)
);

CREATE INDEX ravenos_robinhood_block_anchor_height_idx
  ON ravenos_robinhood_block_anchors(chain_id, network, block_number, observed_at DESC, anchor_id);

-- Consumers must read canonical observations through the latest persisted
-- block anchor. Reorged rows stay immutable evidence but cannot re-enter a
-- derived projection merely because they still exist in the append-only log.
CREATE VIEW ravenos_robinhood_canonical_log_observations AS
SELECT observations.*
FROM ravenos_robinhood_log_observations observations
WHERE observations.block_hash = (
  SELECT anchors.block_hash
  FROM ravenos_robinhood_block_anchors anchors
  WHERE anchors.chain_id = observations.chain_id
    AND anchors.network = observations.network
    AND anchors.block_number = observations.block_number
  ORDER BY anchors.observed_at DESC, anchors.rowid DESC
  LIMIT 1
);

CREATE TABLE ravenos_robinhood_ingestion_audit_events (
  event_id TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL CHECK (chain_id IN (4663, 46630)),
  network TEXT NOT NULL CHECK (network IN ('mainnet', 'testnet')),
  event_type TEXT NOT NULL,
  event_hash TEXT NOT NULL CHECK (length(event_hash) = 64),
  event_json TEXT NOT NULL CHECK (json_valid(event_json) AND length(event_json) <= 131072),
  observed_at INTEGER NOT NULL
);

CREATE INDEX ravenos_robinhood_ingestion_audit_time_idx
  ON ravenos_robinhood_ingestion_audit_events(chain_id, network, observed_at DESC, event_id);

CREATE TABLE ravenos_robinhood_canonicality_events (
  event_id TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL CHECK (chain_id IN (4663, 46630)),
  from_block INTEGER NOT NULL CHECK (from_block >= 0),
  to_block INTEGER NOT NULL CHECK (to_block >= from_block),
  state TEXT NOT NULL CHECK (state IN ('canonical', 'invalidated', 'replacement_observed')),
  reason TEXT NOT NULL,
  provider_id TEXT,
  evidence_hash TEXT NOT NULL CHECK (length(evidence_hash) = 64),
  event_json TEXT NOT NULL CHECK (json_valid(event_json) AND length(event_json) <= 65536),
  observed_at INTEGER NOT NULL
);

CREATE INDEX ravenos_robinhood_canonicality_range_idx
  ON ravenos_robinhood_canonicality_events(chain_id, from_block, to_block, observed_at);

CREATE TABLE ravenos_agent_radar_projections (
  projection_id TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL CHECK (chain_id IN (4663, 46630)),
  entity_id TEXT NOT NULL,
  token_contract TEXT NOT NULL CHECK (token_contract GLOB '0x*' AND length(token_contract) = 42),
  schema_version TEXT NOT NULL,
  projection_hash TEXT NOT NULL CHECK (length(projection_hash) = 64),
  projection_json TEXT NOT NULL CHECK (json_valid(projection_json) AND length(projection_json) <= 524288),
  generated_at INTEGER NOT NULL,
  UNIQUE (entity_id, projection_hash)
);

CREATE INDEX ravenos_agent_radar_entity_idx
  ON ravenos_agent_radar_projections(chain_id, entity_id, generated_at DESC, projection_id);

CREATE TABLE ravenos_agent_provider_health_events (
  health_event_id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  chain_id TEXT NOT NULL,
  venue_id TEXT,
  operation TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('healthy', 'degraded', 'unavailable', 'timeout', 'malformed', 'rate_limited')),
  latency_ms INTEGER,
  event_hash TEXT NOT NULL CHECK (length(event_hash) = 64),
  event_json TEXT NOT NULL CHECK (json_valid(event_json) AND length(event_json) <= 65536),
  observed_at INTEGER NOT NULL
);

CREATE INDEX ravenos_agent_provider_health_time_idx
  ON ravenos_agent_provider_health_events(provider_id, operation, observed_at DESC, health_event_id);

-- Economic records are append-only. Corrections are new records referencing
-- the prior evidence; mutation must never rewrite historical decisions.
CREATE TRIGGER ravenos_agent_specs_append_only_update BEFORE UPDATE ON ravenos_agent_specs BEGIN SELECT RAISE(ABORT, 'agent_spec_append_only'); END;
CREATE TRIGGER ravenos_agent_specs_append_only_delete BEFORE DELETE ON ravenos_agent_specs BEGIN SELECT RAISE(ABORT, 'agent_spec_append_only'); END;
CREATE TRIGGER ravenos_agent_evidence_append_only_update BEFORE UPDATE ON ravenos_agent_evidence_packets BEGIN SELECT RAISE(ABORT, 'agent_evidence_append_only'); END;
CREATE TRIGGER ravenos_agent_evidence_append_only_delete BEFORE DELETE ON ravenos_agent_evidence_packets BEGIN SELECT RAISE(ABORT, 'agent_evidence_append_only'); END;
CREATE TRIGGER ravenos_agent_plans_append_only_update BEFORE UPDATE ON ravenos_agent_trade_plans BEGIN SELECT RAISE(ABORT, 'agent_plan_append_only'); END;
CREATE TRIGGER ravenos_agent_plans_append_only_delete BEFORE DELETE ON ravenos_agent_trade_plans BEGIN SELECT RAISE(ABORT, 'agent_plan_append_only'); END;
CREATE TRIGGER ravenos_agent_intents_append_only_update BEFORE UPDATE ON ravenos_agent_trade_intents BEGIN SELECT RAISE(ABORT, 'agent_intent_append_only'); END;
CREATE TRIGGER ravenos_agent_intents_append_only_delete BEFORE DELETE ON ravenos_agent_trade_intents BEGIN SELECT RAISE(ABORT, 'agent_intent_append_only'); END;
CREATE TRIGGER ravenos_agent_decisions_append_only_update BEFORE UPDATE ON ravenos_agent_policy_decisions BEGIN SELECT RAISE(ABORT, 'agent_decision_append_only'); END;
CREATE TRIGGER ravenos_agent_decisions_append_only_delete BEFORE DELETE ON ravenos_agent_policy_decisions BEGIN SELECT RAISE(ABORT, 'agent_decision_append_only'); END;
CREATE TRIGGER ravenos_agent_receipts_append_only_update BEFORE UPDATE ON ravenos_agent_execution_receipts BEGIN SELECT RAISE(ABORT, 'agent_receipt_append_only'); END;
CREATE TRIGGER ravenos_agent_receipts_append_only_delete BEFORE DELETE ON ravenos_agent_execution_receipts BEGIN SELECT RAISE(ABORT, 'agent_receipt_append_only'); END;
CREATE TRIGGER ravenos_agent_outcomes_append_only_update BEFORE UPDATE ON ravenos_agent_outcomes BEGIN SELECT RAISE(ABORT, 'agent_outcome_append_only'); END;
CREATE TRIGGER ravenos_agent_outcomes_append_only_delete BEFORE DELETE ON ravenos_agent_outcomes BEGIN SELECT RAISE(ABORT, 'agent_outcome_append_only'); END;
CREATE TRIGGER ravenos_agent_audit_append_only_update BEFORE UPDATE ON ravenos_agent_audit_events BEGIN SELECT RAISE(ABORT, 'agent_audit_append_only'); END;
CREATE TRIGGER ravenos_agent_audit_append_only_delete BEFORE DELETE ON ravenos_agent_audit_events BEGIN SELECT RAISE(ABORT, 'agent_audit_append_only'); END;
CREATE TRIGGER ravenos_robinhood_logs_append_only_update BEFORE UPDATE ON ravenos_robinhood_log_observations BEGIN SELECT RAISE(ABORT, 'robinhood_log_append_only'); END;
CREATE TRIGGER ravenos_robinhood_logs_append_only_delete BEFORE DELETE ON ravenos_robinhood_log_observations BEGIN SELECT RAISE(ABORT, 'robinhood_log_append_only'); END;
CREATE TRIGGER ravenos_robinhood_anchors_append_only_update BEFORE UPDATE ON ravenos_robinhood_block_anchors BEGIN SELECT RAISE(ABORT, 'robinhood_anchor_append_only'); END;
CREATE TRIGGER ravenos_robinhood_anchors_append_only_delete BEFORE DELETE ON ravenos_robinhood_block_anchors BEGIN SELECT RAISE(ABORT, 'robinhood_anchor_append_only'); END;
CREATE TRIGGER ravenos_robinhood_ingestion_audit_append_only_update BEFORE UPDATE ON ravenos_robinhood_ingestion_audit_events BEGIN SELECT RAISE(ABORT, 'robinhood_ingestion_audit_append_only'); END;
CREATE TRIGGER ravenos_robinhood_ingestion_audit_append_only_delete BEFORE DELETE ON ravenos_robinhood_ingestion_audit_events BEGIN SELECT RAISE(ABORT, 'robinhood_ingestion_audit_append_only'); END;
CREATE TRIGGER ravenos_robinhood_canonicality_append_only_update BEFORE UPDATE ON ravenos_robinhood_canonicality_events BEGIN SELECT RAISE(ABORT, 'robinhood_canonicality_append_only'); END;
CREATE TRIGGER ravenos_robinhood_canonicality_append_only_delete BEFORE DELETE ON ravenos_robinhood_canonicality_events BEGIN SELECT RAISE(ABORT, 'robinhood_canonicality_append_only'); END;
CREATE TRIGGER ravenos_agent_radar_append_only_update BEFORE UPDATE ON ravenos_agent_radar_projections BEGIN SELECT RAISE(ABORT, 'agent_radar_append_only'); END;
CREATE TRIGGER ravenos_agent_radar_append_only_delete BEFORE DELETE ON ravenos_agent_radar_projections BEGIN SELECT RAISE(ABORT, 'agent_radar_append_only'); END;
CREATE TRIGGER ravenos_agent_provider_health_append_only_update BEFORE UPDATE ON ravenos_agent_provider_health_events BEGIN SELECT RAISE(ABORT, 'agent_provider_health_append_only'); END;
CREATE TRIGGER ravenos_agent_provider_health_append_only_delete BEFORE DELETE ON ravenos_agent_provider_health_events BEGIN SELECT RAISE(ABORT, 'agent_provider_health_append_only'); END;
