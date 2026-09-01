PRAGMA foreign_keys = ON;

-- One authenticated machine-to-machine batch receipt proves what RavenOS
-- accepted from the private Constant-K receiver. Source addresses and
-- signatures remain in the existing observer delivery evidence; this table
-- contains only hashes and aggregate counts needed for idempotency, replay
-- detection, recovery, and reconciliation.
CREATE TABLE ravenos_source_wallet_ingress_batches (
  batch_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.source_wallet_ingress_receipt.v1',
  body_sha256 TEXT NOT NULL CHECK (length(body_sha256) = 64),
  request_key_id TEXT NOT NULL CHECK (length(request_key_id) BETWEEN 3 AND 64),
  watch_manifest_hash TEXT NOT NULL CHECK (length(watch_manifest_hash) = 40),
  provider TEXT NOT NULL CHECK (provider = 'constant_k_nexus'),
  transport TEXT NOT NULL CHECK (transport = 'geyser_grpc'),
  delivery_count INTEGER NOT NULL CHECK (delivery_count BETWEEN 1 AND 50),
  inserted_count INTEGER NOT NULL CHECK (inserted_count BETWEEN 0 AND delivery_count),
  duplicate_count INTEGER NOT NULL CHECK (duplicate_count = delivery_count - inserted_count),
  sent_at INTEGER NOT NULL CHECK (sent_at >= 0),
  received_at INTEGER NOT NULL CHECK (received_at >= 0),
  receipt_json TEXT NOT NULL CHECK (
    json_valid(receipt_json)
    AND length(receipt_json) <= 16384
    AND json_extract(receipt_json, '$.raw_provider_payload_persisted') = 0
    AND json_extract(receipt_json, '$.subscriber_identity_included') = 0
    AND json_extract(receipt_json, '$.signing_authorized') = 0
    AND json_extract(receipt_json, '$.broadcasting_authorized') = 0
    AND json_extract(receipt_json, '$.live_copy_authorized') = 0
  ),
  retention_expires_at INTEGER NOT NULL CHECK (retention_expires_at > received_at),
  CHECK (batch_id GLOB 'swib_*' AND length(batch_id) = 45),
  CHECK (body_sha256 NOT GLOB '*[^a-f0-9]*'),
  CHECK (watch_manifest_hash NOT GLOB '*[^a-f0-9]*')
);

CREATE INDEX ravenos_source_wallet_ingress_received_idx
  ON ravenos_source_wallet_ingress_batches(received_at DESC, batch_id);
CREATE INDEX ravenos_source_wallet_ingress_manifest_idx
  ON ravenos_source_wallet_ingress_batches(watch_manifest_hash, received_at DESC, batch_id);

CREATE TRIGGER ravenos_source_wallet_ingress_batches_append_only
BEFORE UPDATE ON ravenos_source_wallet_ingress_batches
BEGIN
  SELECT RAISE(ABORT, 'source_wallet_ingress_batch_append_only');
END;
