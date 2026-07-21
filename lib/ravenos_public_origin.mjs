const DEFAULT_ORIGIN_BASE_URL = "https://ravenos-public-origin.ravenos.xyz/public/ravenos";
const PUBLIC_REDACTION_POLICY = "aggregate_public_market_context_only";
const DEFAULT_TIMEOUT_MS = 3_000;

export const PUBLIC_PROJECTION_ENDPOINTS = Object.freeze({
  brief: Object.freeze({ schema: "ravenos_brief_public_origin_v1", maxBytes: 512 * 1024 }),
  replay: Object.freeze({ schema: "ravenos_replay_public_origin_v1", maxBytes: 2 * 1024 * 1024 }),
  outcomes: Object.freeze({ schema: "ravenos_outcomes_public_origin_v1", maxBytes: 4 * 1024 * 1024 }),
  memory: Object.freeze({ schema: "ravenos_memory_public_origin_v1", maxBytes: 1024 * 1024 }),
  behavior: Object.freeze({ schema: "ravenos_behavior_public_origin_v1", maxBytes: 2 * 1024 * 1024 }),
  research: Object.freeze({ schema: "ravenos_research_public_origin_v1", maxBytes: 4 * 1024 * 1024 }),
  perps: Object.freeze({ schema: "ravenos_perps_public_origin_v1", maxBytes: 4 * 1024 * 1024 }),
  opportunities: Object.freeze({ schema: "ravenos_opportunity_census_public_origin_v1", maxBytes: 2 * 1024 * 1024 }),
  claims: Object.freeze({ schema: "ravenos_claim_lineage_public_origin_v2", maxBytes: 8 * 1024 * 1024 }),
});

const CONTROL_DOCUMENTS = Object.freeze({
  manifest: Object.freeze({ schema: "ravenos_public_origin_manifest_v1", maxBytes: 512 * 1024 }),
  status: Object.freeze({ schema: "ravenos_public_publish_status_v1", maxBytes: 512 * 1024 }),
  terminal_health: Object.freeze({ schema: "customer_trade_terminal_health_snapshot.v1", maxBytes: 512 * 1024 }),
});

function finitePositive(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isoNow(nowMs) {
  return new Date(nowMs).toISOString();
}

function configuredOriginBase(env = {}) {
  const raw = String(env.RAVENOS_PUBLIC_ORIGIN_URL || DEFAULT_ORIGIN_BASE_URL).trim();
  try {
    const url = new URL(raw);
    url.search = "";
    url.hash = "";
    let pathname = url.pathname.replace(/\/+$/, "");
    if (pathname.endsWith(".json")) pathname = pathname.slice(0, pathname.lastIndexOf("/"));
    if (!pathname || pathname === "/") pathname = "/public/ravenos";
    url.pathname = pathname;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function originRequest(env, key) {
  const base = configuredOriginBase(env);
  const token = String(env.RAVENOS_PUBLIC_ORIGIN_TOKEN || "").trim();
  if (!base) return { ok: false, reason: "origin_url_invalid" };
  if (!token) return { ok: false, reason: "origin_token_not_configured" };
  return {
    ok: true,
    url: `${base}/${encodeURIComponent(key)}.json`,
    headers: {
      accept: "application/json",
      "x-ravenos-public-token": token,
    },
  };
}

async function readBoundedText(response, maxBytes) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) throw new Error("origin_payload_too_large");
  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error("origin_payload_too_large");
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) throw new Error("origin_payload_too_large");
      chunks.push(value);
    }
  } finally {
    if (!complete) {
      try {
        await reader.cancel("origin_read_incomplete");
      } catch {
        // The original read error remains authoritative.
      }
    }
    reader.releaseLock();
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(joined);
}

function safeFailureReason(error, fallback = "origin_unavailable") {
  const code = error instanceof Error ? error.message : "";
  return [
    "origin_payload_too_large",
    "origin_invalid_json",
    "origin_invalid_payload",
    "origin_contract_mismatch",
    "origin_public_safety_mismatch",
    "origin_request_timeout",
  ].includes(code) ? code : fallback;
}

async function fetchJsonDocument({ env, key, contract, fetchImpl, timeoutMs }) {
  const target = originRequest(env, key);
  if (!target.ok) return { ok: false, reason: target.reason };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("origin_request_timeout"), timeoutMs);
  try {
    const response = await fetchImpl(target.url, {
      method: "GET",
      headers: target.headers,
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, reason: `origin_http_${response.status}` };
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("application/json")) return { ok: false, reason: "origin_invalid_content_type" };
    const text = await readBoundedText(response, contract.maxBytes);
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("origin_invalid_json");
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("origin_invalid_payload");
    if (String(payload.schema_version || "") !== contract.schema) throw new Error("origin_contract_mismatch");
    return { ok: true, payload };
  } catch (error) {
    const aborted = controller.signal.aborted;
    return { ok: false, reason: aborted ? "origin_request_timeout" : safeFailureReason(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function validatePublicProjection(payload, key, contract) {
  if (
    payload.ok !== true
    || payload.safe_public !== true
    || payload.redaction_policy !== PUBLIC_REDACTION_POLICY
  ) return { ok: false, reason: "origin_public_safety_mismatch" };
  if (payload.key !== key || payload.schema_version !== contract.schema) {
    return { ok: false, reason: "origin_contract_mismatch" };
  }
  return { ok: true };
}

export function projectionFreshness(payload, { nowMs = Date.now(), defaultTargetSeconds = 900 } = {}) {
  const generatedAt = String(payload?.generated_at || "");
  const generatedMs = Date.parse(generatedAt);
  const targetSeconds = finitePositive(payload?.freshness_target_seconds, defaultTargetSeconds);
  if (!Number.isFinite(generatedMs)) {
    return {
      state: "unavailable",
      age_seconds: null,
      target_seconds: targetSeconds,
      generated_at: generatedAt || null,
      reason: "source_timestamp_unavailable",
    };
  }
  const ageSeconds = Math.max(0, Math.floor((nowMs - generatedMs) / 1000));
  const delayedLimit = Math.max(targetSeconds * 4, targetSeconds + 300);
  const state = ageSeconds <= targetSeconds ? "fresh" : ageSeconds <= delayedLimit ? "delayed" : "stale";
  return {
    state,
    age_seconds: ageSeconds,
    target_seconds: targetSeconds,
    generated_at: new Date(generatedMs).toISOString(),
    reason: state === "fresh" ? null : state === "delayed" ? "freshness_target_missed" : "source_stale",
  };
}

function deliveryMetadata({ key, source, payload, fallback, reason, nowMs }) {
  const freshness = projectionFreshness(payload, { nowMs });
  return {
    schema_version: "ravenos.delivery.v1",
    source,
    key,
    fetched_at: isoNow(nowMs),
    source_generated_at: freshness.generated_at,
    origin_updated_at: source === "current_public_origin" ? String(payload?.updated_at || "") || null : null,
    age_seconds: freshness.age_seconds,
    freshness_target_seconds: freshness.target_seconds,
    freshness_state: freshness.state,
    fallback: Boolean(fallback),
    reason: reason || freshness.reason || null,
  };
}

export function attachDelivery(payload, delivery) {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? { ...payload, delivery }
    : { ok: false, error: "projection_unavailable", delivery };
}

export function projectionHeaders(delivery) {
  return {
    "x-ravenos-data-source": String(delivery?.source || "unavailable"),
    "x-ravenos-freshness": String(delivery?.freshness_state || "unavailable"),
  };
}

export async function loadPublicProjection({
  env = {},
  key,
  fallbackPayload = null,
  fetchImpl = globalThis.fetch,
  nowMs = Date.now(),
  timeoutMs = finitePositive(env.RAVENOS_PUBLIC_ORIGIN_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
} = {}) {
  const contract = PUBLIC_PROJECTION_ENDPOINTS[key];
  if (!contract) throw new Error(`unsupported_public_projection:${String(key || "")}`);

  const fetched = await fetchJsonDocument({ env, key, contract, fetchImpl, timeoutMs });
  if (fetched.ok) {
    const validation = validatePublicProjection(fetched.payload, key, contract);
    if (validation.ok) {
      const delivery = deliveryMetadata({
        key,
        source: "current_public_origin",
        payload: fetched.payload,
        fallback: false,
        reason: null,
        nowMs,
      });
      return { payload: fetched.payload, delivery, available: true };
    }
    fetched.reason = validation.reason;
  }

  if (fallbackPayload && typeof fallbackPayload === "object" && !Array.isArray(fallbackPayload)) {
    const delivery = deliveryMetadata({
      key,
      source: "embedded_snapshot",
      payload: fallbackPayload,
      fallback: true,
      reason: fetched.reason || "origin_unavailable",
      nowMs,
    });
    return { payload: fallbackPayload, delivery, available: true };
  }

  const delivery = {
    schema_version: "ravenos.delivery.v1",
    source: "unavailable",
    key,
    fetched_at: isoNow(nowMs),
    source_generated_at: null,
    origin_updated_at: null,
    age_seconds: null,
    freshness_target_seconds: null,
    freshness_state: "unavailable",
    fallback: false,
    reason: fetched.reason || "origin_unavailable",
  };
  return { payload: null, delivery, available: false };
}

export async function loadOriginControlDocument({
  env = {},
  key,
  fetchImpl = globalThis.fetch,
  timeoutMs = finitePositive(env.RAVENOS_PUBLIC_ORIGIN_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
} = {}) {
  const contract = CONTROL_DOCUMENTS[key];
  if (!contract) throw new Error(`unsupported_origin_control_document:${String(key || "")}`);
  const fetched = await fetchJsonDocument({ env, key, contract, fetchImpl, timeoutMs });
  if (!fetched.ok) return fetched;
  if (key === "manifest" && (
    fetched.payload.safe_public !== true
    || fetched.payload.redaction_policy !== PUBLIC_REDACTION_POLICY
  )) return { ok: false, reason: "origin_public_safety_mismatch" };
  return fetched;
}

export function sanitizeOriginControlDocument(key, payload) {
  if (!payload || typeof payload !== "object") return null;
  if (key === "manifest") {
    return {
      schema_version: payload.schema_version,
      generated_at: payload.generated_at || null,
      safe_public: payload.safe_public === true,
      redaction_policy: payload.redaction_policy || null,
      endpoints: Array.isArray(payload.endpoints) ? payload.endpoints.map((row) => ({
        key: row?.key || null,
        endpoint: row?.endpoint || row?.endpoint_path || null,
        schema_version: row?.schema_version || null,
        generated_at: row?.generated_at || null,
        payload_age_seconds: Number.isFinite(Number(row?.payload_age_seconds)) ? Number(row.payload_age_seconds) : null,
        freshness_target_seconds: Number.isFinite(Number(row?.freshness_target_seconds)) ? Number(row.freshness_target_seconds) : null,
        status: row?.status || null,
      })) : [],
      failed_count: Array.isArray(payload.failed) ? payload.failed.length : 0,
    };
  }
  if (key === "status") {
    return {
      schema_version: payload.schema_version,
      generated_at: payload.generated_at || null,
      last_publish_at: payload.last_publish_at || null,
      last_success_at: payload.last_success_at || null,
      next_publish_eta: payload.next_publish_eta || null,
      endpoints_published: Number(payload.endpoints_published || 0),
      endpoints_failed: Number(payload.endpoints_failed || 0),
      private_leak_guard_passed: payload.private_leak_guard_passed === true,
      stale_endpoints: Array.isArray(payload.stale_endpoints) ? payload.stale_endpoints.map(String) : [],
      validation_failure_count: Array.isArray(payload.validation_failures) ? payload.validation_failures.length : Number(payload.validation_failures || 0),
    };
  }
  if (key === "terminal_health") {
    return {
      schema_version: payload.schema_version,
      generated_at: payload.generated_at || null,
      terminal_availability: payload.terminal_availability || "unknown",
      market_data_availability: payload.market_data_availability || "unknown",
      quote_availability: payload.quote_availability || "unknown",
      review_availability: payload.review_availability || "unknown",
      components: payload.components && typeof payload.components === "object" ? payload.components : {},
      public_warnings: Array.isArray(payload.public_warnings) ? payload.public_warnings.map(String) : [],
      degraded_reasons: Array.isArray(payload.degraded_reasons) ? payload.degraded_reasons.map(String) : [],
      recovery_state: payload.recovery_state || null,
    };
  }
  return null;
}
