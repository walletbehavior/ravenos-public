import { loadPublicProjection } from "./ravenos_public_origin.mjs";

export const PUBLIC_PROJECTION_TRANSPORT_POLICY = Object.freeze({
  schema_version: "ravenos.public_projection_transport.v1",
  cache_namespace: "ravenos-public-projections-v1",
  cache_revision: "1",
  fresh_transport_seconds: 30,
  retained_transport_seconds: 6 * 60 * 60,
  rescue_freshness_states: Object.freeze(["fresh", "delayed"]),
  embedded_snapshot_promoted: false,
});

const projectionFlights = new Map();

function cacheRequest(key) {
  const clean = String(key || "").trim().toLowerCase();
  return new Request(`https://projection-cache.ravenos.invalid/${PUBLIC_PROJECTION_TRANSPORT_POLICY.cache_revision}/${encodeURIComponent(clean)}.json`, {
    method: "GET",
  });
}

function storedAtMs(response) {
  const parsed = Date.parse(String(response?.headers?.get("x-ravenos-cache-stored-at") || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function transportDelivery(delivery, {
  state,
  storedAt = null,
  originFailureReason = null,
  nowMs = Date.now(),
} = {}) {
  const storedMs = Date.parse(String(storedAt || ""));
  return {
    ...delivery,
    transport: {
      schema_version: PUBLIC_PROJECTION_TRANSPORT_POLICY.schema_version,
      state,
      cached_at: Number.isFinite(storedMs) ? new Date(storedMs).toISOString() : null,
      cache_age_seconds: Number.isFinite(storedMs) ? Math.max(0, Math.floor((nowMs - storedMs) / 1_000)) : null,
      origin_failure_reason: originFailureReason || null,
      historical_snapshot_substituted: false,
    },
  };
}

async function cachedProjection({ cache, env, key, nowMs }) {
  if (!cache || typeof cache.match !== "function") return null;
  try {
    const response = await cache.match(cacheRequest(key));
    if (!response?.ok) return null;
    const cachedAt = storedAtMs(response);
    if (cachedAt === null || cachedAt > nowMs + 300_000) return null;
    const result = await loadPublicProjection({
      env,
      key,
      fallbackPayload: null,
      nowMs,
      fetchImpl: async () => response.clone(),
    });
    if (
      result?.available !== true
      || result?.delivery?.source !== "current_public_origin"
      || result?.delivery?.fallback !== false
    ) return null;
    return { result, cachedAt };
  } catch {
    return null;
  }
}

async function storeProjection({ cache, key, payload, nowMs }) {
  if (!cache || typeof cache.put !== "function" || !payload || typeof payload !== "object") return;
  const body = JSON.stringify(payload);
  const response = new Response(body, {
    status: 200,
    headers: {
      "cache-control": `public, max-age=${PUBLIC_PROJECTION_TRANSPORT_POLICY.retained_transport_seconds}`,
      "content-length": String(new TextEncoder().encode(body).byteLength),
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      "x-ravenos-cache-stored-at": new Date(nowMs).toISOString(),
    },
  });
  try {
    await cache.put(cacheRequest(key), response);
  } catch {
    // The current origin result remains authoritative when edge storage is
    // unavailable or a local cache object rejects the write.
  }
}

function flightKey(env, key) {
  return `${String(env?.RAVENOS_PUBLIC_ORIGIN_URL || "default")}:${String(key || "")}`;
}

async function loadOriginOnce(options) {
  const key = flightKey(options.env, options.key);
  const pending = projectionFlights.get(key);
  if (pending) return pending;
  const flight = loadPublicProjection(options).finally(() => {
    if (projectionFlights.get(key) === flight) projectionFlights.delete(key);
  });
  projectionFlights.set(key, flight);
  return flight;
}

export async function loadResilientPublicProjection({
  env = {},
  key,
  fallbackPayload = null,
  fetchImpl = globalThis.fetch,
  cache = null,
  nowMs = Date.now(),
} = {}) {
  const cached = await cachedProjection({ cache, env, key, nowMs });
  const freshTransportMs = PUBLIC_PROJECTION_TRANSPORT_POLICY.fresh_transport_seconds * 1_000;
  if (cached && nowMs - cached.cachedAt <= freshTransportMs) {
    return {
      ...cached.result,
      delivery: transportDelivery(cached.result.delivery, {
        state: "edge_cache_fresh",
        storedAt: new Date(cached.cachedAt).toISOString(),
        nowMs,
      }),
    };
  }

  const origin = await loadOriginOnce({
    env,
    key,
    fallbackPayload,
    fetchImpl,
    nowMs,
  });
  if (
    origin?.available === true
    && origin?.delivery?.source === "current_public_origin"
    && origin?.delivery?.fallback === false
  ) {
    await storeProjection({ cache, key, payload: origin.payload, nowMs });
    return {
      ...origin,
      delivery: transportDelivery(origin.delivery, {
        state: "origin_current",
        storedAt: new Date(nowMs).toISOString(),
        nowMs,
      }),
    };
  }

  if (
    cached
    && PUBLIC_PROJECTION_TRANSPORT_POLICY.rescue_freshness_states.includes(cached.result.delivery?.freshness_state)
  ) {
    return {
      ...cached.result,
      delivery: transportDelivery(cached.result.delivery, {
        state: "edge_cache_rescue",
        storedAt: new Date(cached.cachedAt).toISOString(),
        originFailureReason: origin?.delivery?.reason || "origin_unavailable",
        nowMs,
      }),
    };
  }

  return {
    ...origin,
    delivery: transportDelivery(origin?.delivery, {
      state: "origin_unavailable",
      originFailureReason: origin?.delivery?.reason || "origin_unavailable",
      nowMs,
    }),
  };
}

export function resetPublicProjectionTransportForTests() {
  projectionFlights.clear();
}
