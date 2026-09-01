import {
  resolveSourceWalletDiscoveryAdmissionActivation,
} from "./source_wallet_discovery_admission.mjs";
import {
  SourceWalletDiscoveryIngressLimits,
  assertSourceWalletDiscoveryBatchFresh,
  normalizeSourceWalletDiscoveryBatch,
  sourceWalletDiscoveryBodyBytes,
  sourceWalletDiscoveryReceipt,
} from "./source_wallet_discovery_ingress_protocol.mjs";
import { verifySourceWalletIngressRequest } from "./source_wallet_ingress_protocol.mjs";

export const SOURCE_WALLET_DISCOVERY_INGRESS_ROUTE = "/api/internal/v1/wallet-discovery/candidates";

function fail(code, details = null) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  throw error;
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

function cleanHost(value) {
  const host = String(value || "").trim().toLowerCase();
  if (!host || host.includes(":") || host.includes("/") || host.length > 253) return null;
  return host;
}

function exactIngressHost(request, env) {
  const configured = cleanHost(env.RAVENOS_WALLET_DISCOVERY_INGRESS_HOST);
  if (!configured) return false;
  return new URL(request.url).hostname.toLowerCase() === configured;
}

function configuredSecrets(env = {}) {
  const output = new Map();
  const add = (keyId, secret) => {
    const id = String(keyId || "").trim();
    const value = String(secret || "");
    if (id && value) output.set(id, value);
  };
  add(env.RAVENOS_WALLET_DISCOVERY_INGRESS_KEY_ID, env.RAVENOS_WALLET_DISCOVERY_INGRESS_HMAC_SECRET);
  add(env.RAVENOS_WALLET_DISCOVERY_INGRESS_PREVIOUS_KEY_ID, env.RAVENOS_WALLET_DISCOVERY_INGRESS_PREVIOUS_HMAC_SECRET);
  return output;
}

async function rawBody(request) {
  const contentType = String(request.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("application/json")) fail("wallet_discovery_content_type_invalid");
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > SourceWalletDiscoveryIngressLimits.maximum_request_bytes) {
    fail("wallet_discovery_request_too_large");
  }
  const body = await request.text();
  if (sourceWalletDiscoveryBodyBytes(body) > SourceWalletDiscoveryIngressLimits.maximum_request_bytes) {
    fail("wallet_discovery_request_too_large");
  }
  return body;
}

async function authenticate(request, env, body, now) {
  const secrets = configuredSecrets(env);
  if (!secrets.size) fail("wallet_discovery_secret_invalid");
  const requiredAccessClientId = String(env.RAVENOS_WALLET_DISCOVERY_INGRESS_ACCESS_CLIENT_ID || "").trim();
  if (requiredAccessClientId && request.headers.get("cf-access-client-id") !== requiredAccessClientId) {
    fail("wallet_discovery_key_unknown");
  }
  const url = new URL(request.url);
  try {
    return await verifySourceWalletIngressRequest({
      method: request.method,
      path: url.pathname,
      body,
      headers: request.headers,
      secrets_by_key_id: secrets,
      now,
    });
  } catch {
    fail("wallet_discovery_unauthorized");
  }
}

function routeError(error) {
  const code = String(error?.code || error?.message || "wallet_discovery_unavailable");
  if (code === "wallet_discovery_request_too_large") return json({ ok: false, error: code }, { status: 413 });
  if (code === "wallet_discovery_unauthorized" || code.endsWith("_secret_invalid") || code.endsWith("_key_unknown")) {
    return json({ ok: false, error: "wallet_discovery_unauthorized" }, { status: 401 });
  }
  if (code === "wallet_discovery_batch_replay_mismatch") return json({ ok: false, error: code }, { status: 409 });
  if (code.endsWith("_invalid") || code.endsWith("_mismatch") || code.endsWith("_duplicate") || code === "wallet_discovery_batch_expired") {
    return json({ ok: false, error: code }, { status: 400 });
  }
  return json({ ok: false, error: "wallet_discovery_unavailable" }, { status: 503 });
}

function acceptedPayload(receipt, { replayed = false } = {}) {
  return {
    ok: true,
    accepted: true,
    receipt: sourceWalletDiscoveryReceipt({ ...receipt, replayed }),
    claim_boundary: {
      provider_candidate_is_normalized_trade: false,
      provider_candidate_is_profitable_wallet: false,
      provider_candidate_is_copyable_wallet: false,
    },
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

export async function routeSourceWalletDiscoveryIngress(request, env = {}, deps = {}) {
  const url = new URL(request.url);
  if (url.pathname !== SOURCE_WALLET_DISCOVERY_INGRESS_ROUTE) return null;
  const activation = resolveSourceWalletDiscoveryAdmissionActivation(env);
  if (!activation.ingress || !exactIngressHost(request, env)) {
    return new Response("Not found", {
      status: 404,
      headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
    });
  }
  if (url.search) return json({ ok: false, error: "wallet_discovery_query_invalid" }, { status: 400 });
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, { status: 405, headers: { allow: "POST" } });
  try {
    const clockValue = typeof deps.now === "function" ? deps.now() : deps.now;
    const now = clockValue instanceof Date ? clockValue.getTime() : Number.isFinite(Number(clockValue)) ? Number(clockValue) : Date.now();
    const body = await rawBody(request);
    const authorization = await authenticate(request, env, body, now);
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      fail("wallet_discovery_json_invalid");
    }
    const batch = assertSourceWalletDiscoveryBatchFresh(normalizeSourceWalletDiscoveryBatch(parsed), { now });
    if (authorization.request_id !== batch.batch_id) fail("wallet_discovery_request_id_mismatch");
    if (!deps.store?.ingestBatch || !deps.store?.getReceipt) fail("wallet_discovery_store_unavailable");
    const existing = await deps.store.getReceipt(batch.batch_id);
    if (existing) {
      if (existing.body_sha256 !== authorization.body_sha256) fail("wallet_discovery_batch_replay_mismatch");
      return json(acceptedPayload(existing, { replayed: true }));
    }
    const receipt = await deps.store.ingestBatch(batch, {
      body_sha256: authorization.body_sha256,
      key_id: authorization.key_id,
      now,
    });
    return json(acceptedPayload(receipt));
  } catch (error) {
    return routeError(error);
  }
}
