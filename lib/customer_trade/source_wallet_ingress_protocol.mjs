import {
  SOURCE_WALLET_OBSERVER_DELIVERY_SCHEMA,
  SourceWalletObserverLimits,
  createSourceWalletObserverDelivery,
} from "./source_wallet_observer.mjs";

export const SOURCE_WALLET_INGRESS_BATCH_SCHEMA = "ravenos.source_wallet_ingress_batch.v1";
export const SOURCE_WALLET_INGRESS_RECEIPT_SCHEMA = "ravenos.source_wallet_ingress_receipt.v1";
export const SOURCE_WALLET_INGRESS_AUTH_SCHEME = "RAVENOS-OBSERVER-INGRESS-V1";

export const SourceWalletIngressLimits = Object.freeze({
  maximum_request_bytes: 384 * 1024,
  maximum_deliveries_per_batch: 50,
  maximum_manifest_response_bytes: 2 * 1024 * 1024,
  maximum_request_clock_skew_ms: 90 * 1_000,
  minimum_hmac_secret_bytes: 32,
  receipt_retention_seconds: 90 * 24 * 60 * 60,
});

const textEncoder = new TextEncoder();
const BATCH_ID_RE = /^swib_[a-f0-9]{40}$/;
const REQUEST_ID_RE = /^swi[brm]_[A-Za-z0-9_-]{16,96}$/;
const KEY_ID_RE = /^[A-Za-z0-9._-]{3,64}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const MANIFEST_HASH_RE = /^[a-f0-9]{40}$/;
const CHECKPOINT_REFERENCE_RE = /^ckr_[a-f0-9]{24,64}$/;
const DELIVERY_FIELDS = new Set([
  "schema_version",
  "delivery_id",
  "source_wallet_id",
  "source_wallet",
  "signature",
  "slot",
  "finality",
  "provider",
  "transport",
  "chain_event_at",
  "provider_observed_at",
  "raven_received_at",
  "evidence_reference",
  "normalized_event",
  "decode_required",
  "priority",
  "privacy",
]);
const BATCH_FIELDS = new Set([
  "schema_version",
  "batch_id",
  "sent_at",
  "source",
  "deliveries",
  "privacy",
  "execution_boundary",
]);
const SOURCE_FIELDS = new Set([
  "provider",
  "transport",
  "watch_manifest_hash",
  "coverage_acknowledged_at",
  "receiver_checkpoint_reference",
]);
const DELIVERY_PRIVACY_FIELDS = new Set([
  "public_source_wallet_only",
  "raw_provider_payload_persisted",
  "subscriber_identity_included",
  "signer_material_included",
  "transaction_material_included",
]);
const BATCH_PRIVACY_FIELDS = new Set([
  "public_wallet_addresses_only",
  "raw_provider_payload_included",
  "subscriber_identity_included",
  "signer_material_included",
  "transaction_material_included",
]);
const EXECUTION_FIELDS = new Set([
  "signing",
  "submission",
  "broadcasting",
  "custody",
  "live_copy",
  "fee_collection",
]);

function fail(code, details = null) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  throw error;
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function exactObject(value, fields, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  if (Object.keys(value).some((key) => !fields.has(key))) fail(code);
  return value;
}

function timestamp(value, field) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) fail(`${field}_invalid`);
  return new Date(parsed).toISOString();
}

function utf8Bytes(value) {
  return textEncoder.encode(String(value ?? ""));
}

function bytesToHex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value) {
  if (!SHA256_RE.test(String(value || ""))) fail("observer_ingress_signature_invalid");
  const output = new Uint8Array(32);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Number.parseInt(value.slice(index * 2, (index * 2) + 2), 16);
  }
  return output;
}

function normalizedMethod(value) {
  const method = String(value || "").trim().toUpperCase();
  if (!new Set(["GET", "POST"]).has(method)) fail("observer_ingress_method_invalid");
  return method;
}

function normalizedPath(value) {
  const path = String(value || "").trim();
  if (!path.startsWith("/") || path.includes("?") || path.includes("#") || path.length > 180) {
    fail("observer_ingress_path_invalid");
  }
  return path;
}

function normalizedRequestId(value) {
  const requestId = String(value || "").trim();
  if (!REQUEST_ID_RE.test(requestId)) fail("observer_ingress_request_id_invalid");
  return requestId;
}

function normalizedKeyId(value) {
  const keyId = String(value || "").trim();
  if (!KEY_ID_RE.test(keyId)) fail("observer_ingress_key_id_invalid");
  return keyId;
}

function normalizedSecret(value) {
  const secret = String(value || "");
  if (utf8Bytes(secret).byteLength < SourceWalletIngressLimits.minimum_hmac_secret_bytes) {
    fail("observer_ingress_secret_invalid");
  }
  return secret;
}

function normalizedUnixTimestamp(value) {
  const timestampSeconds = Number(value);
  if (!Number.isSafeInteger(timestampSeconds) || timestampSeconds < 0) fail("observer_ingress_timestamp_invalid");
  return timestampSeconds;
}

function exactFalseBoundary(value, fields, code) {
  const row = exactObject(value, fields, code);
  for (const field of fields) if (row[field] !== false) fail(code);
  return row;
}

function exactDeliveryPrivacy(value) {
  const privacy = exactObject(value, DELIVERY_PRIVACY_FIELDS, "observer_ingress_delivery_privacy_invalid");
  if (
    privacy.public_source_wallet_only !== true
    || privacy.raw_provider_payload_persisted !== false
    || privacy.subscriber_identity_included !== false
    || privacy.signer_material_included !== false
    || privacy.transaction_material_included !== false
  ) fail("observer_ingress_delivery_privacy_invalid");
  return privacy;
}

function exactBatchPrivacy(value) {
  const privacy = exactObject(value, BATCH_PRIVACY_FIELDS, "observer_ingress_batch_privacy_invalid");
  if (
    privacy.public_wallet_addresses_only !== true
    || privacy.raw_provider_payload_included !== false
    || privacy.subscriber_identity_included !== false
    || privacy.signer_material_included !== false
    || privacy.transaction_material_included !== false
  ) fail("observer_ingress_batch_privacy_invalid");
  return privacy;
}

function canonicalAuthMessage({ method, path, timestamp_seconds: timestampSeconds, request_id: requestId, body_sha256: bodySha256 }) {
  return [
    SOURCE_WALLET_INGRESS_AUTH_SCHEME,
    normalizedMethod(method),
    normalizedPath(path),
    String(normalizedUnixTimestamp(timestampSeconds)),
    normalizedRequestId(requestId),
    SHA256_RE.test(String(bodySha256 || "")) ? bodySha256 : fail("observer_ingress_body_hash_invalid"),
  ].join("\n");
}

async function importHmacKey(secret, usages) {
  return globalThis.crypto.subtle.importKey(
    "raw",
    utf8Bytes(normalizedSecret(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

export async function sha256Hex(value) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", utf8Bytes(value));
  return bytesToHex(new Uint8Array(digest));
}

export async function signSourceWalletIngressRequest({
  method,
  path,
  body = "",
  key_id: keyId,
  secret,
  timestamp_seconds: timestampSeconds = Math.floor(Date.now() / 1_000),
  request_id: requestId,
} = {}) {
  const normalizedBody = String(body ?? "");
  if (utf8Bytes(normalizedBody).byteLength > SourceWalletIngressLimits.maximum_request_bytes) {
    fail("observer_ingress_request_too_large");
  }
  const bodySha256 = await sha256Hex(normalizedBody);
  const canonical = canonicalAuthMessage({ method, path, timestamp_seconds: timestampSeconds, request_id: requestId, body_sha256: bodySha256 });
  const key = await importHmacKey(secret, ["sign"]);
  const signature = await globalThis.crypto.subtle.sign("HMAC", key, utf8Bytes(canonical));
  return freeze({
    "x-ravenos-ingress-key-id": normalizedKeyId(keyId),
    "x-ravenos-ingress-timestamp": String(normalizedUnixTimestamp(timestampSeconds)),
    "x-ravenos-ingress-request-id": normalizedRequestId(requestId),
    "x-ravenos-ingress-body-sha256": bodySha256,
    "x-ravenos-ingress-signature": bytesToHex(new Uint8Array(signature)),
  });
}

export async function verifySourceWalletIngressRequest({
  method,
  path,
  body = "",
  headers,
  secrets_by_key_id: secretsByKeyId,
  now = Date.now(),
} = {}) {
  const readHeader = (name) => headers?.get ? headers.get(name) : headers?.[name] || headers?.[name.toLowerCase()];
  const keyId = normalizedKeyId(readHeader("x-ravenos-ingress-key-id"));
  const timestampSeconds = normalizedUnixTimestamp(readHeader("x-ravenos-ingress-timestamp"));
  const requestId = normalizedRequestId(readHeader("x-ravenos-ingress-request-id"));
  const suppliedBodyHash = String(readHeader("x-ravenos-ingress-body-sha256") || "").trim().toLowerCase();
  const suppliedSignature = String(readHeader("x-ravenos-ingress-signature") || "").trim().toLowerCase();
  const nowMs = Number(now);
  if (!Number.isFinite(nowMs) || Math.abs(nowMs - (timestampSeconds * 1_000)) > SourceWalletIngressLimits.maximum_request_clock_skew_ms) {
    fail("observer_ingress_request_expired");
  }
  const normalizedBody = String(body ?? "");
  if (utf8Bytes(normalizedBody).byteLength > SourceWalletIngressLimits.maximum_request_bytes) {
    fail("observer_ingress_request_too_large");
  }
  const actualBodyHash = await sha256Hex(normalizedBody);
  if (!SHA256_RE.test(suppliedBodyHash) || suppliedBodyHash !== actualBodyHash) fail("observer_ingress_body_hash_invalid");
  const secret = secretsByKeyId instanceof Map ? secretsByKeyId.get(keyId) : secretsByKeyId?.[keyId];
  if (!secret) fail("observer_ingress_key_unknown");
  const canonical = canonicalAuthMessage({ method, path, timestamp_seconds: timestampSeconds, request_id: requestId, body_sha256: actualBodyHash });
  const key = await importHmacKey(secret, ["verify"]);
  const verified = await globalThis.crypto.subtle.verify("HMAC", key, hexToBytes(suppliedSignature), utf8Bytes(canonical));
  if (!verified) fail("observer_ingress_signature_invalid");
  return freeze({
    key_id: keyId,
    timestamp_seconds: timestampSeconds,
    request_id: requestId,
    body_sha256: actualBodyHash,
  });
}

export function normalizeSourceWalletIngressDelivery(input) {
  const row = exactObject(input, DELIVERY_FIELDS, "observer_ingress_delivery_invalid");
  if (row.schema_version !== SOURCE_WALLET_OBSERVER_DELIVERY_SCHEMA) fail("observer_ingress_delivery_invalid");
  if (row.normalized_event !== null || row.decode_required !== true) fail("observer_ingress_transaction_material_forbidden");
  exactDeliveryPrivacy(row.privacy);
  if (row.provider !== "constant_k_nexus" || row.transport !== "geyser_grpc") fail("observer_ingress_delivery_source_invalid");
  const normalized = createSourceWalletObserverDelivery({
    source_wallet_id: row.source_wallet_id,
    source_wallet: row.source_wallet,
    signature: row.signature,
    slot: row.slot,
    finality: row.finality,
    provider: row.provider,
    transport: row.transport,
    chain_event_at: row.chain_event_at,
    provider_observed_at: row.provider_observed_at,
    raven_received_at: row.raven_received_at,
    evidence_reference: row.evidence_reference,
  }, { received_at: row.raven_received_at });
  if (row.delivery_id !== normalized.delivery_id || Number(row.priority) !== normalized.priority) {
    fail("observer_ingress_delivery_identity_mismatch");
  }
  return normalized;
}

export function normalizeSourceWalletIngressBatch(input) {
  const row = exactObject(input, BATCH_FIELDS, "observer_ingress_batch_invalid");
  if (row.schema_version !== SOURCE_WALLET_INGRESS_BATCH_SCHEMA || !BATCH_ID_RE.test(String(row.batch_id || ""))) {
    fail("observer_ingress_batch_invalid");
  }
  const source = exactObject(row.source, SOURCE_FIELDS, "observer_ingress_source_invalid");
  if (
    source.provider !== "constant_k_nexus"
    || source.transport !== "geyser_grpc"
    || !MANIFEST_HASH_RE.test(String(source.watch_manifest_hash || ""))
    || !CHECKPOINT_REFERENCE_RE.test(String(source.receiver_checkpoint_reference || ""))
  ) fail("observer_ingress_source_invalid");
  const coverageAcknowledgedAt = timestamp(source.coverage_acknowledged_at, "observer_ingress_coverage_acknowledged_at");
  if (!Array.isArray(row.deliveries) || row.deliveries.length < 1 || row.deliveries.length > SourceWalletIngressLimits.maximum_deliveries_per_batch) {
    fail("observer_ingress_delivery_batch_invalid");
  }
  const deliveries = row.deliveries.map(normalizeSourceWalletIngressDelivery);
  if (new Set(deliveries.map((delivery) => delivery.delivery_id)).size !== deliveries.length) {
    fail("observer_ingress_delivery_batch_duplicate");
  }
  exactBatchPrivacy(row.privacy);
  exactFalseBoundary(row.execution_boundary, EXECUTION_FIELDS, "observer_ingress_execution_boundary_invalid");
  return freeze({
    schema_version: SOURCE_WALLET_INGRESS_BATCH_SCHEMA,
    batch_id: row.batch_id,
    sent_at: timestamp(row.sent_at, "observer_ingress_sent_at"),
    source: {
      provider: source.provider,
      transport: source.transport,
      watch_manifest_hash: source.watch_manifest_hash,
      coverage_acknowledged_at: coverageAcknowledgedAt,
      receiver_checkpoint_reference: source.receiver_checkpoint_reference,
    },
    deliveries,
    privacy: {
      public_wallet_addresses_only: true,
      raw_provider_payload_included: false,
      subscriber_identity_included: false,
      signer_material_included: false,
      transaction_material_included: false,
    },
    execution_boundary: {
      signing: false,
      submission: false,
      broadcasting: false,
      custody: false,
      live_copy: false,
      fee_collection: false,
    },
  });
}

export async function createSourceWalletIngressBatch({
  deliveries,
  watch_manifest_hash: watchManifestHash,
  coverage_acknowledged_at: coverageAcknowledgedAt,
  receiver_checkpoint_reference: receiverCheckpointReference,
  sent_at: sentAt = new Date().toISOString(),
} = {}) {
  const normalizedSentAt = timestamp(sentAt, "observer_ingress_sent_at");
  const source = {
    provider: "constant_k_nexus",
    transport: "geyser_grpc",
    watch_manifest_hash: String(watchManifestHash || ""),
    coverage_acknowledged_at: timestamp(coverageAcknowledgedAt, "observer_ingress_coverage_acknowledged_at"),
    receiver_checkpoint_reference: String(receiverCheckpointReference || ""),
  };
  if (!MANIFEST_HASH_RE.test(source.watch_manifest_hash) || !CHECKPOINT_REFERENCE_RE.test(source.receiver_checkpoint_reference)) {
    fail("observer_ingress_source_invalid");
  }
  if (!Array.isArray(deliveries) || deliveries.length < 1 || deliveries.length > SourceWalletIngressLimits.maximum_deliveries_per_batch) {
    fail("observer_ingress_delivery_batch_invalid");
  }
  const normalizedDeliveries = deliveries.map(normalizeSourceWalletIngressDelivery);
  const batchDigest = await sha256Hex(JSON.stringify({
    sent_at: normalizedSentAt,
    source,
    delivery_ids: normalizedDeliveries.map((delivery) => delivery.delivery_id),
  }));
  return normalizeSourceWalletIngressBatch({
    schema_version: SOURCE_WALLET_INGRESS_BATCH_SCHEMA,
    batch_id: `swib_${batchDigest.slice(0, 40)}`,
    sent_at: normalizedSentAt,
    source,
    deliveries: normalizedDeliveries,
    privacy: {
      public_wallet_addresses_only: true,
      raw_provider_payload_included: false,
      subscriber_identity_included: false,
      signer_material_included: false,
      transaction_material_included: false,
    },
    execution_boundary: {
      signing: false,
      submission: false,
      broadcasting: false,
      custody: false,
      live_copy: false,
      fee_collection: false,
    },
  });
}

export function sourceWalletIngressRequestId(value) {
  return normalizedRequestId(value);
}

export function sourceWalletIngressBodyBytes(value) {
  return utf8Bytes(value).byteLength;
}

export function sourceWalletIngressReceipt(record) {
  if (!record || typeof record !== "object") fail("observer_ingress_receipt_invalid");
  const receipt = {
    schema_version: SOURCE_WALLET_INGRESS_RECEIPT_SCHEMA,
    batch_id: String(record.batch_id || ""),
    body_sha256: String(record.body_sha256 || ""),
    key_id: normalizedKeyId(record.key_id),
    watch_manifest_hash: String(record.watch_manifest_hash || ""),
    provider: "constant_k_nexus",
    transport: "geyser_grpc",
    delivery_count: Number(record.delivery_count),
    inserted_count: Number(record.inserted_count),
    duplicate_count: Number(record.duplicate_count),
    sent_at: timestamp(record.sent_at, "observer_ingress_sent_at"),
    received_at: timestamp(record.received_at, "observer_ingress_received_at"),
    replayed: record.replayed === true,
    raw_provider_payload_persisted: false,
    subscriber_identity_included: false,
    signing_authorized: false,
    broadcasting_authorized: false,
    live_copy_authorized: false,
  };
  if (
    !BATCH_ID_RE.test(receipt.batch_id)
    || !SHA256_RE.test(receipt.body_sha256)
    || !MANIFEST_HASH_RE.test(receipt.watch_manifest_hash)
    || !Number.isSafeInteger(receipt.delivery_count)
    || !Number.isSafeInteger(receipt.inserted_count)
    || !Number.isSafeInteger(receipt.duplicate_count)
    || receipt.delivery_count < 1
    || receipt.inserted_count < 0
    || receipt.duplicate_count < 0
    || receipt.inserted_count + receipt.duplicate_count !== receipt.delivery_count
  ) fail("observer_ingress_receipt_invalid");
  return freeze(receipt);
}

export function assertSourceWalletIngressBatchFresh(batch, { now = Date.now() } = {}) {
  const sentAt = Date.parse(String(batch?.sent_at || ""));
  if (!Number.isFinite(sentAt) || Math.abs(Number(now) - sentAt) > SourceWalletObserverLimits.maximum_clock_skew_ms) {
    fail("observer_ingress_batch_expired");
  }
  return batch;
}
