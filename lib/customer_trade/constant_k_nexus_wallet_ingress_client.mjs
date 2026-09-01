import { randomUUID } from "node:crypto";

import {
  SOURCE_WALLET_WATCH_MANIFEST_SCHEMA,
  buildSourceWalletWatchManifest,
} from "./source_wallet_watch_manifest.mjs";
import {
  SOURCE_WALLET_INGRESS_BATCH_SCHEMA,
  SourceWalletIngressLimits,
  createSourceWalletIngressBatch,
  sha256Hex,
  signSourceWalletIngressRequest,
  sourceWalletIngressBodyBytes,
  sourceWalletIngressReceipt,
} from "./source_wallet_ingress_protocol.mjs";
import {
  SOURCE_WALLET_INGRESS_DELIVERIES_ROUTE,
  SOURCE_WALLET_INGRESS_MANIFEST_ROUTE,
} from "./source_wallet_ingress.mjs";
import {
  SOURCE_WALLET_DISCOVERY_BATCH_SCHEMA,
  SourceWalletDiscoveryIngressLimits,
  createSourceWalletDiscoveryBatch,
  sourceWalletDiscoveryReceipt,
} from "./source_wallet_discovery_ingress_protocol.mjs";
import { SOURCE_WALLET_DISCOVERY_INGRESS_ROUTE } from "./source_wallet_discovery_ingress.mjs";

export const CONSTANT_K_NEXUS_INGRESS_CLIENT_SCHEMA = "ravenos.constant_k_nexus_ingress_client.v1";

export const ConstantKNexusIngressClientLimits = Object.freeze({
  request_timeout_ms: 10_000,
  maximum_error_response_bytes: 16 * 1024,
});

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

function origin(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    fail("constant_k_ingress_origin_invalid");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    fail("constant_k_ingress_origin_invalid");
  }
  return parsed.origin;
}

function credentials(input = {}) {
  const keyId = String(input.key_id || "").trim();
  const secret = String(input.secret || "");
  if (!keyId || !secret) fail("constant_k_ingress_credentials_invalid");
  return freeze({
    key_id: keyId,
    secret,
    access_client_id: String(input.access_client_id || "").trim() || null,
    access_client_secret: String(input.access_client_secret || "").trim() || null,
  });
}

function safeErrorCode(value, fallback) {
  const code = String(value || "").trim();
  return /^[a-z0-9_:-]{3,100}$/i.test(code) ? code : fallback;
}

async function responseText(response, maximumBytes) {
  const length = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(length) && length > maximumBytes) fail("constant_k_ingress_response_too_large");
  const text = await response.text();
  if (sourceWalletIngressBodyBytes(text) > maximumBytes) fail("constant_k_ingress_response_too_large");
  return text;
}

async function signedFetch({
  ingress_origin: ingressOrigin,
  path,
  method,
  body = "",
  request_id: requestId,
  credentials: credentialInput,
  fetch_impl: fetchImpl = fetch,
  timeout_ms: timeoutMs = ConstantKNexusIngressClientLimits.request_timeout_ms,
  now = Date.now(),
} = {}) {
  const auth = credentials(credentialInput);
  const normalizedOrigin = origin(ingressOrigin);
  const headers = await signSourceWalletIngressRequest({
    method,
    path,
    body,
    key_id: auth.key_id,
    secret: auth.secret,
    request_id: requestId,
    timestamp_seconds: Math.floor((now instanceof Date ? now.getTime() : Number(now)) / 1_000),
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("constant_k_ingress_timeout"), Math.max(500, Math.min(30_000, Number(timeoutMs) || 10_000)));
  try {
    const requestHeaders = {
      ...headers,
      accept: "application/json",
    };
    if (method === "POST") requestHeaders["content-type"] = "application/json; charset=utf-8";
    if (auth.access_client_id && auth.access_client_secret) {
      requestHeaders["cf-access-client-id"] = auth.access_client_id;
      requestHeaders["cf-access-client-secret"] = auth.access_client_secret;
    }
    return await fetchImpl(`${normalizedOrigin}${path}`, {
      method,
      headers: requestHeaders,
      body: method === "POST" ? body : undefined,
      redirect: "error",
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") fail("constant_k_ingress_timeout");
    fail("constant_k_ingress_unavailable");
  } finally {
    clearTimeout(timer);
  }
}

function validateManifest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || input.schema_version !== SOURCE_WALLET_WATCH_MANIFEST_SCHEMA) {
    fail("constant_k_ingress_manifest_invalid");
  }
  const addresses = Array.isArray(input.shards) ? input.shards.flatMap((shard) => Array.isArray(shard?.addresses) ? shard.addresses : []) : [];
  const rebuilt = buildSourceWalletWatchManifest(addresses, { generated_at: input.generated_at });
  if (
    rebuilt.manifest_hash !== input.manifest_hash
    || rebuilt.wallet_count !== Number(input.wallet_count)
    || rebuilt.shard_count !== Number(input.shard_count)
    || JSON.stringify(rebuilt.shards) !== JSON.stringify(input.shards)
  ) fail("constant_k_ingress_manifest_invalid");
  return rebuilt;
}

export async function fetchConstantKNexusWatchManifest({
  ingress_origin: ingressOrigin,
  credentials: credentialInput,
  fetch_impl: fetchImpl = fetch,
  request_id: requestId = `swim_${randomUUID().replaceAll("-", "")}`,
  now = Date.now(),
} = {}) {
  const response = await signedFetch({
    ingress_origin: ingressOrigin,
    path: SOURCE_WALLET_INGRESS_MANIFEST_ROUTE,
    method: "GET",
    request_id: requestId,
    credentials: credentialInput,
    fetch_impl: fetchImpl,
    now,
  });
  const text = await responseText(response, SourceWalletIngressLimits.maximum_manifest_response_bytes);
  let payload;
  try { payload = JSON.parse(text); } catch { fail("constant_k_ingress_manifest_invalid"); }
  if (!response.ok) fail(safeErrorCode(payload?.error, `constant_k_ingress_http_${response.status}`));
  return validateManifest(payload);
}

export async function postConstantKNexusDeliveryBatch({
  ingress_origin: ingressOrigin,
  credentials: credentialInput,
  batch,
  fetch_impl: fetchImpl = fetch,
  now = Date.now(),
} = {}) {
  if (batch?.schema_version !== SOURCE_WALLET_INGRESS_BATCH_SCHEMA) fail("constant_k_ingress_batch_invalid");
  const body = JSON.stringify(batch);
  const expectedBodyHash = await sha256Hex(body);
  const response = await signedFetch({
    ingress_origin: ingressOrigin,
    path: SOURCE_WALLET_INGRESS_DELIVERIES_ROUTE,
    method: "POST",
    body,
    request_id: batch.batch_id,
    credentials: credentialInput,
    fetch_impl: fetchImpl,
    now,
  });
  const text = await responseText(response, ConstantKNexusIngressClientLimits.maximum_error_response_bytes);
  let payload;
  try { payload = JSON.parse(text); } catch { fail("constant_k_ingress_response_invalid"); }
  if (!response.ok) fail(safeErrorCode(payload?.error, `constant_k_ingress_http_${response.status}`));
  const receipt = sourceWalletIngressReceipt(payload?.receipt);
  if (!payload?.ok || !payload?.accepted || receipt.batch_id !== batch.batch_id || receipt.body_sha256 !== expectedBodyHash) {
    fail("constant_k_ingress_receipt_mismatch");
  }
  return freeze({
    schema_version: CONSTANT_K_NEXUS_INGRESS_CLIENT_SCHEMA,
    accepted: true,
    receipt,
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

export async function constantKNexusCheckpointReference(checkpoint) {
  const digest = await sha256Hex(JSON.stringify(checkpoint || {}));
  return `ckr_${digest.slice(0, 40)}`;
}

export async function postConstantKNexusDeliveries({
  ingress_origin: ingressOrigin,
  credentials: credentialInput,
  deliveries = [],
  manifest,
  coverage_acknowledged_at: coverageAcknowledgedAt = null,
  receiver_checkpoint: receiverCheckpoint,
  fetch_impl: fetchImpl = fetch,
  sent_at: sentAt = new Date().toISOString(),
  now = Date.now(),
} = {}) {
  const validatedManifest = validateManifest(manifest);
  if (!Array.isArray(deliveries)) fail("constant_k_ingress_deliveries_invalid");
  if (!deliveries.length) return freeze({ batches: 0, deliveries: 0, inserted: 0, duplicates: 0, receipts: [] });
  const checkpointReference = await constantKNexusCheckpointReference(receiverCheckpoint);
  const receipts = [];
  for (let offset = 0; offset < deliveries.length; offset += SourceWalletIngressLimits.maximum_deliveries_per_batch) {
    const batch = await createSourceWalletIngressBatch({
      deliveries: deliveries.slice(offset, offset + SourceWalletIngressLimits.maximum_deliveries_per_batch),
      watch_manifest_hash: validatedManifest.manifest_hash,
      coverage_acknowledged_at: coverageAcknowledgedAt || validatedManifest.generated_at,
      receiver_checkpoint_reference: checkpointReference,
      sent_at: sentAt,
    });
    const result = await postConstantKNexusDeliveryBatch({
      ingress_origin: ingressOrigin,
      credentials: credentialInput,
      batch,
      fetch_impl: fetchImpl,
      now,
    });
    receipts.push(result.receipt);
  }
  return freeze({
    batches: receipts.length,
    deliveries: receipts.reduce((sum, row) => sum + row.delivery_count, 0),
    // A replay receipt preserves the original durable write counts. Report
    // what happened during this client cycle, not those historical counts.
    inserted: receipts.reduce((sum, row) => sum + (row.replayed ? 0 : row.inserted_count), 0),
    duplicates: receipts.reduce((sum, row) => sum + (row.replayed ? row.delivery_count : row.duplicate_count), 0),
    receipts,
  });
}

export async function postConstantKNexusWalletDiscoveryBatch({
  ingress_origin: ingressOrigin,
  credentials: credentialInput,
  batch,
  fetch_impl: fetchImpl = fetch,
  now = Date.now(),
} = {}) {
  if (batch?.schema_version !== SOURCE_WALLET_DISCOVERY_BATCH_SCHEMA) fail("constant_k_discovery_ingress_batch_invalid");
  const body = JSON.stringify(batch);
  const expectedBodyHash = await sha256Hex(body);
  const response = await signedFetch({
    ingress_origin: ingressOrigin,
    path: SOURCE_WALLET_DISCOVERY_INGRESS_ROUTE,
    method: "POST",
    body,
    request_id: batch.batch_id,
    credentials: credentialInput,
    fetch_impl: fetchImpl,
    now,
  });
  const text = await responseText(response, ConstantKNexusIngressClientLimits.maximum_error_response_bytes);
  let payload;
  try { payload = JSON.parse(text); } catch { fail("constant_k_discovery_ingress_response_invalid"); }
  if (!response.ok) fail(safeErrorCode(payload?.error, `constant_k_discovery_ingress_http_${response.status}`));
  const receipt = sourceWalletDiscoveryReceipt(payload?.receipt);
  if (!payload?.ok || !payload?.accepted || receipt.batch_id !== batch.batch_id || receipt.body_sha256 !== expectedBodyHash) {
    fail("constant_k_discovery_ingress_receipt_mismatch");
  }
  return freeze({
    accepted: true,
    receipt,
    claim_boundary: payload.claim_boundary,
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

export async function postConstantKNexusWalletDiscoveryObservations({
  ingress_origin: ingressOrigin,
  credentials: credentialInput,
  observations = [],
  receiver_checkpoint: receiverCheckpoint,
  fetch_impl: fetchImpl = fetch,
  sent_at: sentAt = new Date().toISOString(),
  now = Date.now(),
} = {}) {
  if (!Array.isArray(observations)) fail("constant_k_discovery_ingress_observations_invalid");
  if (!observations.length) return freeze({ batches: 0, observations: 0, inserted: 0, duplicates: 0, eligible_candidates: 0 });
  const checkpointReference = await constantKNexusCheckpointReference(receiverCheckpoint);
  const receipts = [];
  for (let offset = 0; offset < observations.length; offset += SourceWalletDiscoveryIngressLimits.maximum_observations_per_batch) {
    const batch = createSourceWalletDiscoveryBatch({
      observations: observations.slice(offset, offset + SourceWalletDiscoveryIngressLimits.maximum_observations_per_batch),
      receiver_checkpoint_reference: checkpointReference,
      sent_at: sentAt,
    });
    const result = await postConstantKNexusWalletDiscoveryBatch({
      ingress_origin: ingressOrigin,
      credentials: credentialInput,
      batch,
      fetch_impl: fetchImpl,
      now,
    });
    receipts.push(result.receipt);
  }
  return freeze({
    batches: receipts.length,
    observations: receipts.reduce((sum, row) => sum + row.observation_count, 0),
    inserted: receipts.reduce((sum, row) => sum + (row.replayed ? 0 : row.inserted_count), 0),
    duplicates: receipts.reduce((sum, row) => sum + (row.replayed ? row.observation_count : row.duplicate_count), 0),
    eligible_candidates: receipts.reduce((sum, row) => sum + row.eligible_candidate_count, 0),
  });
}
