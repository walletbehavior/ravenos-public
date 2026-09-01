import { createHash } from "node:crypto";

import {
  CONSTANT_K_NEXUS_WALLET_CANDIDATE_OBSERVATION_SCHEMA,
  normalizeConstantKNexusWalletCandidateObservation,
} from "./constant_k_nexus_wallet_discovery.mjs";

export const SOURCE_WALLET_DISCOVERY_BATCH_SCHEMA = "ravenos.source_wallet_discovery_batch.v1";
export const SOURCE_WALLET_DISCOVERY_RECEIPT_SCHEMA = "ravenos.source_wallet_discovery_receipt.v1";

export const SourceWalletDiscoveryIngressLimits = Object.freeze({
  maximum_request_bytes: 384 * 1024,
  maximum_observations_per_batch: 50,
  maximum_request_clock_skew_ms: 90 * 1_000,
  receipt_retention_seconds: 90 * 24 * 60 * 60,
});

const textEncoder = new TextEncoder();
const BATCH_ID_RE = /^swdcb_[a-f0-9]{40}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const CHECKPOINT_REFERENCE_RE = /^ckr_[a-f0-9]{24,64}$/;
const BATCH_FIELDS = new Set([
  "schema_version", "batch_id", "sent_at", "source", "observations", "privacy", "execution_boundary",
]);
const SOURCE_FIELDS = new Set(["provider", "transport", "receiver_checkpoint_reference"]);
const PRIVACY_FIELDS = new Set([
  "public_wallet_addresses_only", "raw_provider_payload_included", "subscriber_identity_included",
  "policy_included", "follower_count_included", "signer_material_included", "transaction_material_included",
]);
const EXECUTION_FIELDS = new Set([
  "signing", "submission", "broadcasting", "custody", "live_copy", "fee_collection",
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

function digest(parts, length = 40) {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, length);
}

function exactExecutionBoundary(value) {
  const boundary = exactObject(value, EXECUTION_FIELDS, "wallet_discovery_execution_boundary_invalid");
  for (const field of EXECUTION_FIELDS) if (boundary[field] !== false) fail("wallet_discovery_execution_boundary_invalid");
  return boundary;
}

function exactPrivacyBoundary(value) {
  const privacy = exactObject(value, PRIVACY_FIELDS, "wallet_discovery_privacy_invalid");
  if (privacy.public_wallet_addresses_only !== true) fail("wallet_discovery_privacy_invalid");
  for (const field of PRIVACY_FIELDS) {
    if (field !== "public_wallet_addresses_only" && privacy[field] !== false) fail("wallet_discovery_privacy_invalid");
  }
  return privacy;
}

export function sourceWalletDiscoveryBodyBytes(value) {
  return textEncoder.encode(String(value ?? "")).byteLength;
}

export function normalizeSourceWalletDiscoveryBatch(input) {
  const row = exactObject(input, BATCH_FIELDS, "wallet_discovery_batch_invalid");
  if (row.schema_version !== SOURCE_WALLET_DISCOVERY_BATCH_SCHEMA || !BATCH_ID_RE.test(String(row.batch_id || ""))) {
    fail("wallet_discovery_batch_invalid");
  }
  const source = exactObject(row.source, SOURCE_FIELDS, "wallet_discovery_source_invalid");
  if (
    source.provider !== "constant_k_nexus"
    || source.transport !== "geyser_grpc"
    || !CHECKPOINT_REFERENCE_RE.test(String(source.receiver_checkpoint_reference || ""))
  ) fail("wallet_discovery_source_invalid");
  exactPrivacyBoundary(row.privacy);
  exactExecutionBoundary(row.execution_boundary);
  if (!Array.isArray(row.observations) || !row.observations.length || row.observations.length > SourceWalletDiscoveryIngressLimits.maximum_observations_per_batch) {
    fail("wallet_discovery_observations_invalid");
  }
  const seen = new Set();
  const observations = row.observations.map((inputObservation) => {
    const observation = normalizeConstantKNexusWalletCandidateObservation(inputObservation);
    if (seen.has(observation.observation_id)) fail("wallet_discovery_observation_duplicate");
    seen.add(observation.observation_id);
    return observation;
  });
  const sentAt = timestamp(row.sent_at, "wallet_discovery_sent_at");
  const expectedBatchId = `swdcb_${digest([
    source.receiver_checkpoint_reference,
    sentAt,
    ...observations.map((observation) => observation.observation_id),
  ])}`;
  if (row.batch_id !== expectedBatchId) fail("wallet_discovery_batch_identity_mismatch");
  return freeze({
    schema_version: SOURCE_WALLET_DISCOVERY_BATCH_SCHEMA,
    batch_id: expectedBatchId,
    sent_at: sentAt,
    source: {
      provider: "constant_k_nexus",
      transport: "geyser_grpc",
      receiver_checkpoint_reference: source.receiver_checkpoint_reference,
    },
    observations: freeze(observations),
    privacy: {
      public_wallet_addresses_only: true,
      raw_provider_payload_included: false,
      subscriber_identity_included: false,
      policy_included: false,
      follower_count_included: false,
      signer_material_included: false,
      transaction_material_included: false,
    },
    execution_boundary: Object.fromEntries([...EXECUTION_FIELDS].map((field) => [field, false])),
  });
}

export function createSourceWalletDiscoveryBatch({
  observations,
  sent_at: sentAt = new Date().toISOString(),
  receiver_checkpoint_reference: checkpointReference,
} = {}) {
  const normalizedSentAt = timestamp(sentAt, "wallet_discovery_sent_at");
  const normalizedObservations = (Array.isArray(observations) ? observations : []).map(normalizeConstantKNexusWalletCandidateObservation);
  const checkpoint = String(checkpointReference || "").trim();
  const batchId = `swdcb_${digest([checkpoint, normalizedSentAt, ...normalizedObservations.map((row) => row.observation_id)])}`;
  return normalizeSourceWalletDiscoveryBatch({
    schema_version: SOURCE_WALLET_DISCOVERY_BATCH_SCHEMA,
    batch_id: batchId,
    sent_at: normalizedSentAt,
    source: {
      provider: "constant_k_nexus",
      transport: "geyser_grpc",
      receiver_checkpoint_reference: checkpoint,
    },
    observations: normalizedObservations,
    privacy: {
      public_wallet_addresses_only: true,
      raw_provider_payload_included: false,
      subscriber_identity_included: false,
      policy_included: false,
      follower_count_included: false,
      signer_material_included: false,
      transaction_material_included: false,
    },
    execution_boundary: Object.fromEntries([...EXECUTION_FIELDS].map((field) => [field, false])),
  });
}

export function assertSourceWalletDiscoveryBatchFresh(batchInput, { now = Date.now() } = {}) {
  const batch = normalizeSourceWalletDiscoveryBatch(batchInput);
  const nowMs = Number(now);
  if (!Number.isFinite(nowMs) || Math.abs(nowMs - Date.parse(batch.sent_at)) > SourceWalletDiscoveryIngressLimits.maximum_request_clock_skew_ms) {
    fail("wallet_discovery_batch_expired");
  }
  return batch;
}

export function sourceWalletDiscoveryReceipt(input) {
  const row = exactObject(input, new Set([
    "schema_version", "batch_id", "body_sha256", "key_id", "observation_count",
    "inserted_count", "duplicate_count", "eligible_candidate_count", "sent_at",
    "received_at", "replayed",
  ]), "wallet_discovery_receipt_invalid");
  if (
    row.schema_version !== SOURCE_WALLET_DISCOVERY_RECEIPT_SCHEMA
    || !BATCH_ID_RE.test(String(row.batch_id || ""))
    || !SHA256_RE.test(String(row.body_sha256 || ""))
    || !/^[A-Za-z0-9._-]{3,64}$/.test(String(row.key_id || ""))
  ) fail("wallet_discovery_receipt_invalid");
  const observationCount = Number(row.observation_count);
  const insertedCount = Number(row.inserted_count);
  const duplicateCount = Number(row.duplicate_count);
  const eligibleCandidateCount = Number(row.eligible_candidate_count);
  if (
    !Number.isSafeInteger(observationCount) || observationCount < 1 || observationCount > SourceWalletDiscoveryIngressLimits.maximum_observations_per_batch
    || !Number.isSafeInteger(insertedCount) || insertedCount < 0 || insertedCount > observationCount
    || !Number.isSafeInteger(duplicateCount) || duplicateCount !== observationCount - insertedCount
    || !Number.isSafeInteger(eligibleCandidateCount) || eligibleCandidateCount < 0 || eligibleCandidateCount > observationCount
    || typeof row.replayed !== "boolean"
  ) fail("wallet_discovery_receipt_invalid");
  return freeze({
    schema_version: SOURCE_WALLET_DISCOVERY_RECEIPT_SCHEMA,
    batch_id: row.batch_id,
    body_sha256: row.body_sha256,
    key_id: row.key_id,
    observation_count: observationCount,
    inserted_count: insertedCount,
    duplicate_count: duplicateCount,
    eligible_candidate_count: eligibleCandidateCount,
    sent_at: timestamp(row.sent_at, "wallet_discovery_receipt_sent_at"),
    received_at: timestamp(row.received_at, "wallet_discovery_receipt_received_at"),
    replayed: row.replayed,
  });
}

export function assertDiscoveryObservationSchema(value) {
  return value?.schema_version === CONSTANT_K_NEXUS_WALLET_CANDIDATE_OBSERVATION_SCHEMA;
}
