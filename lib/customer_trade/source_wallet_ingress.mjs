import {
  SourceWalletWatchManifestLimits,
  buildSourceWalletWatchManifest,
} from "./source_wallet_watch_manifest.mjs";
import {
  resolveSourceWalletResearchCohortActivation,
} from "./source_wallet_research_cohort.mjs";
import {
  SourceWalletIngressLimits,
  assertSourceWalletIngressBatchFresh,
  normalizeSourceWalletIngressBatch,
  sourceWalletIngressBodyBytes,
  sourceWalletIngressReceipt,
  verifySourceWalletIngressRequest,
} from "./source_wallet_ingress_protocol.mjs";

export const SOURCE_WALLET_INGRESS_MANIFEST_ROUTE = "/api/internal/v1/wallet-observer/watch-manifest";
export const SOURCE_WALLET_INGRESS_DELIVERIES_ROUTE = "/api/internal/v1/wallet-observer/deliveries";
const MANIFEST_CACHE_MS = 5_000;
const manifestCache = new WeakMap();

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

function json(payload, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cross-origin-resource-policy": "same-origin",
      ...headers,
    },
  });
}

function epoch(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1_000) : null;
}

function parseJson(value) {
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function cleanHost(value) {
  const host = String(value || "").trim().toLowerCase();
  if (!host || host.includes(":") || host.includes("/") || host.length > 253) return null;
  return host;
}

function configuredSecrets(env = {}) {
  const output = new Map();
  const add = (keyId, secret) => {
    const id = String(keyId || "").trim();
    const value = String(secret || "");
    if (id && value) output.set(id, value);
  };
  add(env.RAVENOS_WALLET_OBSERVER_INGRESS_KEY_ID, env.RAVENOS_WALLET_OBSERVER_INGRESS_HMAC_SECRET);
  add(env.RAVENOS_WALLET_OBSERVER_INGRESS_PREVIOUS_KEY_ID, env.RAVENOS_WALLET_OBSERVER_INGRESS_PREVIOUS_HMAC_SECRET);
  return output;
}

function routeError(error) {
  const code = String(error?.code || error?.message || "observer_ingress_unavailable");
  if (code === "observer_ingress_request_too_large") {
    return json({ ok: false, error: code }, { status: 413 });
  }
  if (
    code.startsWith("observer_ingress_request_")
    || code.startsWith("observer_ingress_signature_")
    || code.startsWith("observer_ingress_key_")
    || code === "observer_ingress_body_hash_invalid"
    || code === "observer_ingress_secret_invalid"
    || code === "observer_ingress_timestamp_invalid"
  ) return json({ ok: false, error: "observer_ingress_unauthorized" }, { status: 401 });
  if (code === "observer_ingress_batch_replay_mismatch" || code === "observer_ingress_manifest_mismatch") {
    return json({ ok: false, error: code }, { status: 409 });
  }
  if (
    code.endsWith("_invalid")
    || code.endsWith("_forbidden")
    || code.endsWith("_duplicate")
    || code === "observer_ingress_delivery_outside_manifest"
    || code === "observer_ingress_batch_expired"
  ) return json({ ok: false, error: code }, { status: 400 });
  return json({ ok: false, error: "observer_ingress_unavailable" }, { status: 503 });
}

async function rawBody(request) {
  const contentType = String(request.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("application/json")) fail("observer_ingress_content_type_invalid");
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > SourceWalletIngressLimits.maximum_request_bytes) {
    fail("observer_ingress_request_too_large");
  }
  const body = await request.text();
  if (sourceWalletIngressBodyBytes(body) > SourceWalletIngressLimits.maximum_request_bytes) {
    fail("observer_ingress_request_too_large");
  }
  return body;
}

async function authenticate(request, env, body, now) {
  const secrets = configuredSecrets(env);
  if (!secrets.size) fail("observer_ingress_secret_invalid");
  const requiredAccessClientId = String(env.RAVENOS_WALLET_OBSERVER_INGRESS_ACCESS_CLIENT_ID || "").trim();
  if (requiredAccessClientId && request.headers.get("cf-access-client-id") !== requiredAccessClientId) {
    fail("observer_ingress_key_unknown");
  }
  const url = new URL(request.url);
  return verifySourceWalletIngressRequest({
    method: request.method,
    path: url.pathname,
    body,
    headers: request.headers,
    secrets_by_key_id: secrets,
    now,
  });
}

function exactIngressHost(request, env) {
  const configured = cleanHost(env.RAVENOS_WALLET_OBSERVER_INGRESS_HOST);
  if (!configured) return false;
  return new URL(request.url).hostname.toLowerCase() === configured;
}

export function resolveSourceWalletIngressActivation(env = {}) {
  const requested = String(env.RAVENOS_WALLET_OBSERVER_INGRESS_ENABLED || "") === "1";
  const intelligence = String(env.RAVENOS_WALLET_INTELLIGENCE_ENABLED || "") === "1";
  const observer = String(env.RAVENOS_WALLET_OBSERVER_ENABLED || "") === "1";
  const researchCohort = resolveSourceWalletResearchCohortActivation(env);
  return freeze({
    configured: requested,
    manifest: requested && intelligence,
    ingest: requested && intelligence && observer,
    research_cohort_requested: researchCohort.requested,
    research_cohort_manifest: researchCohort.manifest,
    signing: false,
    submission: false,
    broadcasting: false,
    custody: false,
    live_copy: false,
    fee_collection: false,
  });
}

export function createD1SourceWalletIngressStore(db) {
  if (!db?.prepare) fail("observer_ingress_store_unavailable");
  const read = async (batchId) => {
    const row = await db.prepare(`
      SELECT receipt_json FROM ravenos_source_wallet_ingress_batches
      WHERE batch_id = ? LIMIT 1
    `).bind(batchId).first();
    const receipt = parseJson(row?.receipt_json);
    return receipt ? sourceWalletIngressReceipt(receipt) : null;
  };
  return freeze({
    getReceipt: read,
    async recordReceipt(receipt, { now = Date.now() } = {}) {
      const normalized = sourceWalletIngressReceipt(receipt);
      const seconds = Math.floor(Number(now) / 1_000);
      await db.prepare(`
        INSERT OR IGNORE INTO ravenos_source_wallet_ingress_batches (
          batch_id, body_sha256, request_key_id, watch_manifest_hash, provider,
          transport, delivery_count, inserted_count, duplicate_count, sent_at,
          received_at, receipt_json, retention_expires_at
        ) VALUES (?, ?, ?, ?, 'constant_k_nexus', 'geyser_grpc', ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        normalized.batch_id,
        normalized.body_sha256,
        normalized.key_id,
        normalized.watch_manifest_hash,
        normalized.delivery_count,
        normalized.inserted_count,
        normalized.duplicate_count,
        epoch(normalized.sent_at),
        epoch(normalized.received_at),
        JSON.stringify({ ...normalized, replayed: false }),
        seconds + SourceWalletIngressLimits.receipt_retention_seconds,
      ).run();
      const stored = await read(normalized.batch_id);
      if (!stored || stored.body_sha256 !== normalized.body_sha256) fail("observer_ingress_batch_replay_mismatch");
      return stored;
    },
  });
}

async function currentManifest(walletStore, now = new Date().toISOString(), cacheKey = walletStore, { include_research_cohort: includeResearchCohort = false } = {}) {
  if (!walletStore?.listObserverWatchUniverse) fail("observer_ingress_watch_store_unavailable");
  const nowMs = Date.parse(now);
  const usableCacheKey = cacheKey && typeof cacheKey === "object" ? cacheKey : walletStore;
  const cached = manifestCache.get(usableCacheKey);
  const coverageKey = includeResearchCohort ? "protected_plus_research" : "protected_only";
  if (cached && cached.expires_at > nowMs && cached.coverage_key === coverageKey) return cached.manifest;
  const rows = await walletStore.listObserverWatchUniverse(SourceWalletWatchManifestLimits.maximum_wallets, {
    include_research_cohort: includeResearchCohort,
  });
  const manifest = buildSourceWalletWatchManifest(rows, { generated_at: now });
  manifestCache.set(usableCacheKey, { manifest, expires_at: nowMs + MANIFEST_CACHE_MS, coverage_key: coverageKey });
  return manifest;
}

function acceptedPayload(receipt, { replayed = false } = {}) {
  return {
    ok: true,
    accepted: true,
    receipt: sourceWalletIngressReceipt({ ...receipt, replayed }),
    execution_boundary: {
      signing: false,
      submission: false,
      broadcasting: false,
      custody: false,
      live_copy: false,
      fee_collection: false,
    },
  };
}

export async function routeSourceWalletIngress(request, env = {}, deps = {}) {
  const url = new URL(request.url);
  if (![SOURCE_WALLET_INGRESS_MANIFEST_ROUTE, SOURCE_WALLET_INGRESS_DELIVERIES_ROUTE].includes(url.pathname)) return null;
  const activation = resolveSourceWalletIngressActivation(env);
  const required = url.pathname === SOURCE_WALLET_INGRESS_MANIFEST_ROUTE ? activation.manifest : activation.ingest;
  if (!required || !exactIngressHost(request, env)) return new Response("Not found", {
    status: 404,
    headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
  });
  if (url.search) return json({ ok: false, error: "observer_ingress_query_invalid" }, { status: 400 });
  const expectedMethod = url.pathname === SOURCE_WALLET_INGRESS_MANIFEST_ROUTE ? "GET" : "POST";
  if (request.method !== expectedMethod) {
    return json({ ok: false, error: "method_not_allowed" }, { status: 405, headers: { allow: expectedMethod } });
  }
  try {
    const clockValue = typeof deps.now === "function" ? deps.now() : deps.now;
    const now = clockValue instanceof Date ? clockValue.getTime() : Number.isFinite(Number(clockValue)) ? Number(clockValue) : Date.now();
    const body = expectedMethod === "POST" ? await rawBody(request) : "";
    const authorization = await authenticate(request, env, body, now);
    const walletStore = deps.walletStore;
    if (url.pathname === SOURCE_WALLET_INGRESS_MANIFEST_ROUTE) {
      const manifest = await currentManifest(walletStore, new Date(now).toISOString(), deps.manifestCacheKey, {
        include_research_cohort: activation.research_cohort_manifest,
      });
      const serialized = JSON.stringify(manifest);
      if (sourceWalletIngressBodyBytes(serialized) > SourceWalletIngressLimits.maximum_manifest_response_bytes) {
        fail("observer_ingress_manifest_response_too_large");
      }
      return new Response(serialized, {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "x-ravenos-ingress-request-id": authorization.request_id,
        },
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      fail("observer_ingress_json_invalid");
    }
    const batch = assertSourceWalletIngressBatchFresh(normalizeSourceWalletIngressBatch(parsed), { now });
    if (authorization.request_id !== batch.batch_id) fail("observer_ingress_request_id_invalid");
    const ingressStore = deps.ingressStore;
    const observerStore = deps.observerStore;
    if (!ingressStore?.getReceipt || !ingressStore?.recordReceipt || !observerStore?.ingestDelivery) {
      fail("observer_ingress_store_unavailable");
    }
    const existing = await ingressStore.getReceipt(batch.batch_id);
    if (existing) {
      if (existing.body_sha256 !== authorization.body_sha256) fail("observer_ingress_batch_replay_mismatch");
      return json(acceptedPayload(existing, { replayed: true }));
    }

    const manifest = await currentManifest(walletStore, new Date(now).toISOString(), deps.manifestCacheKey, {
      include_research_cohort: activation.research_cohort_manifest,
    });
    if (manifest.manifest_hash !== batch.source.watch_manifest_hash) fail("observer_ingress_manifest_mismatch");
    const allowedAddresses = new Set(manifest.shards.flatMap((shard) => shard.addresses));
    if (batch.deliveries.some((delivery) => !allowedAddresses.has(delivery.source_wallet.address))) {
      fail("observer_ingress_delivery_outside_manifest");
    }
    let insertedCount = 0;
    for (const delivery of batch.deliveries) {
      const result = await observerStore.ingestDelivery(delivery);
      if (result?.inserted) insertedCount += 1;
    }
    const receivedAt = new Date(now).toISOString();
    const receipt = sourceWalletIngressReceipt({
      batch_id: batch.batch_id,
      body_sha256: authorization.body_sha256,
      key_id: authorization.key_id,
      watch_manifest_hash: batch.source.watch_manifest_hash,
      delivery_count: batch.deliveries.length,
      inserted_count: insertedCount,
      duplicate_count: batch.deliveries.length - insertedCount,
      sent_at: batch.sent_at,
      received_at: receivedAt,
      replayed: false,
    });
    const stored = await ingressStore.recordReceipt(receipt, { now: Date.parse(receivedAt) });
    return json(acceptedPayload(stored));
  } catch (error) {
    return routeError(error);
  }
}
