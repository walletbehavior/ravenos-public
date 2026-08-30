PRAGMA foreign_keys = ON;

-- Provider deliveries are append-only, public-chain evidence. They contain a
-- bounded Raven envelope or a normalized wallet event, never a raw provider
-- response, transaction construction material, signer data, or subscriber ID.
CREATE TABLE ravenos_source_wallet_observer_deliveries (
  delivery_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.source_wallet_observer_delivery.v1',
  source_wallet_id TEXT NOT NULL REFERENCES ravenos_source_wallets(source_wallet_id) ON DELETE CASCADE,
  signature TEXT NOT NULL CHECK (length(signature) BETWEEN 64 AND 100),
  slot INTEGER NOT NULL CHECK (slot >= 0),
  finality TEXT NOT NULL CHECK (finality IN ('processed', 'confirmed', 'finalized')),
  provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 80),
  transport TEXT NOT NULL CHECK (transport IN ('rpc_poll', 'geyser_grpc', 'shredstream', 'replay')),
  chain_event_at INTEGER,
  provider_observed_at INTEGER,
  received_at INTEGER NOT NULL CHECK (received_at >= 0),
  evidence_reference TEXT NOT NULL CHECK (length(evidence_reference) BETWEEN 1 AND 180),
  normalized_event_json TEXT CHECK (
    normalized_event_json IS NULL OR (
      json_valid(normalized_event_json)
      AND length(normalized_event_json) <= 49152
      AND json_extract(normalized_event_json, '$.privacy.provider_payload_included') = 0
      AND json_extract(normalized_event_json, '$.privacy.signer_material_included') = 0
      AND json_extract(normalized_event_json, '$.privacy.transaction_material_included') = 0
      AND json_extract(normalized_event_json, '$.privacy.subscriber_identity_included') = 0
    )
  ),
  delivery_json TEXT NOT NULL CHECK (json_valid(delivery_json) AND length(delivery_json) <= 65536),
  retention_expires_at INTEGER NOT NULL CHECK (retention_expires_at > received_at),
  CHECK (delivery_id GLOB 'swd_*' AND length(delivery_id) BETWEEN 20 AND 100),
  CHECK (chain_event_at IS NULL OR chain_event_at >= 0),
  CHECK (provider_observed_at IS NULL OR provider_observed_at >= 0)
);

CREATE INDEX ravenos_source_wallet_observer_delivery_source_idx
  ON ravenos_source_wallet_observer_deliveries(source_wallet_id, received_at DESC, delivery_id);
CREATE INDEX ravenos_source_wallet_observer_delivery_signature_idx
  ON ravenos_source_wallet_observer_deliveries(signature, finality, received_at DESC);

CREATE TRIGGER ravenos_source_wallet_observer_deliveries_append_only
BEFORE UPDATE ON ravenos_source_wallet_observer_deliveries
BEGIN
  SELECT RAISE(ABORT, 'source_wallet_observer_delivery_append_only');
END;

-- This table is mutable operational queue state, not historical evidence.
-- One source-wallet signature has one decode job globally even if thousands
-- of subscribers follow that wallet. Finality upgrades may requeue the same
-- job, while downstream decision IDs remain idempotent.
CREATE TABLE ravenos_source_wallet_observer_jobs (
  job_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.source_wallet_observer_job.v1',
  source_wallet_id TEXT NOT NULL REFERENCES ravenos_source_wallets(source_wallet_id) ON DELETE CASCADE,
  signature TEXT NOT NULL CHECK (length(signature) BETWEEN 64 AND 100),
  decode_version INTEGER NOT NULL CHECK (decode_version >= 1),
  state TEXT NOT NULL CHECK (state IN ('queued', 'leased', 'retry_wait', 'processed', 'dead_letter')),
  delivery_id TEXT NOT NULL REFERENCES ravenos_source_wallet_observer_deliveries(delivery_id) ON DELETE RESTRICT,
  best_finality TEXT NOT NULL CHECK (best_finality IN ('processed', 'confirmed', 'finalized')),
  priority INTEGER NOT NULL CHECK (priority BETWEEN 0 AND 100),
  delivery_count INTEGER NOT NULL DEFAULT 1 CHECK (delivery_count >= 1),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 100),
  first_received_at INTEGER NOT NULL CHECK (first_received_at >= 0),
  last_received_at INTEGER NOT NULL CHECK (last_received_at >= first_received_at),
  next_attempt_at INTEGER NOT NULL CHECK (next_attempt_at >= 0),
  lease_token TEXT,
  lease_expires_at INTEGER,
  last_error_code TEXT,
  processed_event_id TEXT REFERENCES ravenos_source_wallet_events(event_id) ON DELETE RESTRICT,
  processed_finality TEXT CHECK (processed_finality IS NULL OR processed_finality IN ('processed', 'confirmed', 'finalized')),
  processed_at INTEGER,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  UNIQUE (source_wallet_id, signature, decode_version),
  CHECK (job_id GLOB 'swo_*' AND length(job_id) BETWEEN 20 AND 100),
  CHECK ((state = 'leased') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (lease_token IS NULL OR length(lease_token) BETWEEN 20 AND 200),
  CHECK (last_error_code IS NULL OR length(last_error_code) BETWEEN 1 AND 100),
  CHECK (processed_at IS NULL OR processed_at >= first_received_at)
);

CREATE INDEX ravenos_source_wallet_observer_jobs_due_idx
  ON ravenos_source_wallet_observer_jobs(state, next_attempt_at, priority DESC, first_received_at, job_id);
CREATE INDEX ravenos_source_wallet_observer_jobs_lease_idx
  ON ravenos_source_wallet_observer_jobs(state, lease_expires_at, job_id);
CREATE INDEX ravenos_source_wallet_observer_jobs_source_idx
  ON ravenos_source_wallet_observer_jobs(source_wallet_id, state, updated_at DESC, job_id);

-- Phase timings are append-only and contain no subscriber identity. They are
-- the calibration evidence for p50/p90/p95/p99 speed claims by transport.
CREATE TABLE ravenos_source_wallet_observer_latency (
  latency_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.source_wallet_observer_latency.v1',
  source_wallet_id TEXT NOT NULL REFERENCES ravenos_source_wallets(source_wallet_id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES ravenos_source_wallet_events(event_id) ON DELETE RESTRICT,
  signature TEXT NOT NULL CHECK (length(signature) BETWEEN 64 AND 100),
  provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 80),
  transport TEXT NOT NULL CHECK (transport IN ('rpc_poll', 'geyser_grpc', 'shredstream', 'replay')),
  finality TEXT NOT NULL CHECK (finality IN ('processed', 'confirmed', 'finalized')),
  chain_event_at INTEGER,
  provider_observed_at INTEGER,
  received_at INTEGER NOT NULL CHECK (received_at >= 0),
  decode_completed_at INTEGER,
  fanout_completed_at INTEGER,
  decision_completed_at INTEGER,
  detection_delay_ms INTEGER,
  provider_delay_ms INTEGER,
  ingress_delay_ms INTEGER,
  decode_latency_ms INTEGER,
  fanout_latency_ms INTEGER,
  total_decision_latency_ms INTEGER,
  subscriber_policy_count INTEGER NOT NULL DEFAULT 0 CHECK (subscriber_policy_count >= 0),
  decision_count INTEGER NOT NULL DEFAULT 0 CHECK (decision_count >= 0),
  latency_json TEXT NOT NULL CHECK (json_valid(latency_json) AND length(latency_json) <= 16384),
  recorded_at INTEGER NOT NULL CHECK (recorded_at >= 0),
  retention_expires_at INTEGER NOT NULL CHECK (retention_expires_at > recorded_at),
  CHECK (latency_id GLOB 'swl_*' AND length(latency_id) BETWEEN 20 AND 100),
  CHECK (detection_delay_ms IS NULL OR detection_delay_ms >= 0),
  CHECK (provider_delay_ms IS NULL OR provider_delay_ms >= 0),
  CHECK (ingress_delay_ms IS NULL OR ingress_delay_ms >= 0),
  CHECK (decode_latency_ms IS NULL OR decode_latency_ms >= 0),
  CHECK (fanout_latency_ms IS NULL OR fanout_latency_ms >= 0),
  CHECK (total_decision_latency_ms IS NULL OR total_decision_latency_ms >= 0)
);

CREATE INDEX ravenos_source_wallet_observer_latency_transport_idx
  ON ravenos_source_wallet_observer_latency(transport, recorded_at DESC, latency_id);
CREATE INDEX ravenos_source_wallet_observer_latency_source_idx
  ON ravenos_source_wallet_observer_latency(source_wallet_id, recorded_at DESC, latency_id);

CREATE TRIGGER ravenos_source_wallet_observer_latency_append_only
BEFORE UPDATE ON ravenos_source_wallet_observer_latency
BEGIN
  SELECT RAISE(ABORT, 'source_wallet_observer_latency_append_only');
END;

-- One bounded summary per evaluator invocation supports restart recovery,
-- backpressure monitoring, and unit-economics measurements without logging
-- wallet payloads or subscriber relationships.
CREATE TABLE ravenos_source_wallet_observer_runs (
  run_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.source_wallet_observer_run.v1',
  worker_id TEXT NOT NULL CHECK (length(worker_id) BETWEEN 1 AND 100),
  started_at INTEGER NOT NULL CHECK (started_at >= 0),
  completed_at INTEGER NOT NULL CHECK (completed_at >= started_at),
  run_json TEXT NOT NULL CHECK (json_valid(run_json) AND length(run_json) <= 16384),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (run_id GLOB 'swr_*' AND length(run_id) BETWEEN 20 AND 100)
);

CREATE INDEX ravenos_source_wallet_observer_runs_time_idx
  ON ravenos_source_wallet_observer_runs(completed_at DESC, run_id);

CREATE TRIGGER ravenos_source_wallet_observer_runs_append_only
BEFORE UPDATE ON ravenos_source_wallet_observer_runs
BEGIN
  SELECT RAISE(ABORT, 'source_wallet_observer_run_append_only');
END;
