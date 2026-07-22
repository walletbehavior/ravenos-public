const DEFAULT_ORIGIN_BASE_URL = "https://ravenos-public-origin.ravenos.xyz/public/ravenos";
const PUBLIC_REDACTION_POLICY = "aggregate_public_market_context_only";
const DEFAULT_TIMEOUT_MS = 3_000;
const INSTRUMENT_LOOKUP_CONTRACT = Object.freeze({
  schema: "ravenos.instrument_lookup.v1",
  maxBytes: 256 * 1024,
  maxResults: 12,
});
const INSTRUMENT_CHART_CONTRACT = Object.freeze({
  schema: "ravenos.instrument_chart.v1",
  maxBytes: 512 * 1024,
  maxCandles: 1000,
  timeframes: Object.freeze(new Set(["1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M"])),
});

export const PUBLIC_PROJECTION_ENDPOINTS = Object.freeze({
  brief: Object.freeze({ schema: "ravenos_brief_public_origin_v1", maxBytes: 512 * 1024 }),
  replay: Object.freeze({ schema: "ravenos_replay_public_origin_v1", maxBytes: 2 * 1024 * 1024 }),
  outcomes: Object.freeze({ schema: "ravenos_outcomes_public_origin_v1", maxBytes: 4 * 1024 * 1024 }),
  memory: Object.freeze({ schema: "ravenos_memory_public_origin_v1", maxBytes: 1024 * 1024 }),
  behavior: Object.freeze({ schema: "ravenos_behavior_public_origin_v1", maxBytes: 2 * 1024 * 1024 }),
  research: Object.freeze({ schema: "ravenos_research_public_origin_v1", maxBytes: 4 * 1024 * 1024 }),
  perps: Object.freeze({ schema: "ravenos_perps_public_origin_v1", maxBytes: 4 * 1024 * 1024 }),
  opportunities: Object.freeze({ schema: "ravenos_opportunity_census_public_origin_v1", maxBytes: 2 * 1024 * 1024 }),
  atlas: Object.freeze({ schema: "ravenos_atlas_public_origin_v1", maxBytes: 1024 * 1024 }),
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

function instrumentLookupRequest(env, query) {
  const base = configuredOriginBase(env);
  const token = String(env.RAVENOS_PUBLIC_ORIGIN_TOKEN || "").trim();
  if (!base) return { ok: false, reason: "origin_url_invalid" };
  if (!token) return { ok: false, reason: "origin_token_not_configured" };
  const url = new URL(`${base}/instrument_lookup.json`);
  url.searchParams.set("q", query);
  return {
    ok: true,
    url: url.toString(),
    headers: {
      accept: "application/json",
      "x-ravenos-public-token": token,
    },
  };
}

function instrumentChartRequest(env, { query, instrumentId, timeframe, limit }) {
  const base = configuredOriginBase(env);
  const token = String(env.RAVENOS_PUBLIC_ORIGIN_TOKEN || "").trim();
  if (!base) return { ok: false, reason: "origin_url_invalid" };
  if (!token) return { ok: false, reason: "origin_token_not_configured" };
  const url = new URL(`${base}/instrument_chart.json`);
  url.searchParams.set("q", query);
  url.searchParams.set("instrument_id", instrumentId);
  url.searchParams.set("timeframe", timeframe);
  url.searchParams.set("limit", String(limit));
  return {
    ok: true,
    url: url.toString(),
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

async function fetchJsonDocument({ env, key, contract, fetchImpl, timeoutMs, target: requestedTarget = null }) {
  const target = requestedTarget || originRequest(env, key);
  if (!target.ok) return { ok: false, reason: target.reason };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("origin_request_timeout"), timeoutMs);
  try {
    const response = await fetchImpl(target.url, {
      method: "GET",
      headers: target.headers,
      redirect: "manual",
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      return { ok: false, reason: "origin_redirect_rejected" };
    }
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

function cleanInstrumentLookupQuery(value) {
  const clean = String(value || "").trim().replace(/\s+/g, " ");
  return /^[A-Za-z0-9][A-Za-z0-9 .&'/-]{0,63}$/.test(clean) ? clean : null;
}

function cleanInstrumentId(value) {
  const clean = String(value || "").trim().toLowerCase();
  return /^(?:equity|etf):[a-z0-9.-]+:[a-z0-9.-]+$/.test(clean) && clean.length <= 128 ? clean : null;
}

function boundedInstrumentChartLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 360;
  return Math.max(2, Math.min(INSTRUMENT_CHART_CONTRACT.maxCandles, Math.trunc(parsed)));
}

function validInstrumentLookupRow(row) {
  const type = String(row?.instrument_type || "");
  const symbol = String(row?.symbol || "");
  const venue = String(row?.venue || "");
  const symbolSlug = symbol.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "");
  return row?.schema_version === "ravenos.instrument.v1"
    && typeof row.instrument_id === "string"
    && /^(?:equity|etf):[a-z0-9.-]+:[a-z0-9.-]+$/.test(row.instrument_id)
    && /^[A-Z0-9][A-Z0-9./-]{0,19}$/.test(symbol)
    && ["equity", "etf"].includes(type)
    && row.asset_class === type
    && row.identity_scope === "exact_instrument"
    && row.chain === "none"
    && venue.length > 0
    && row.instrument_id === `${type}:${venue}:${symbolSlug}`
    && row.market_identity?.market_id === symbol
    && typeof row.market_identity?.listing === "string"
    && row.market_identity.listing.length > 0
    && row.quote_asset?.symbol === "USD"
    && row.settlement_asset?.symbol === "USD"
    && row.capabilities?.execution === false
    && row.capabilities?.quote_preview === false;
}

function validateInstrumentLookup(payload, query) {
  const results = payload?.results;
  const execution = payload?.execution_boundary || {};
  return payload?.ok === true
    && payload?.safe_public === true
    && payload?.redaction_policy === PUBLIC_REDACTION_POLICY
    && payload?.schema_version === INSTRUMENT_LOOKUP_CONTRACT.schema
    && String(payload?.query || "").toLowerCase() === query.toLowerCase()
    && payload?.provider === "Tradier"
    && Number(payload?.freshness_target_seconds) === 300
    && Array.isArray(results)
    && results.length <= INSTRUMENT_LOOKUP_CONTRACT.maxResults
    && results.every(validInstrumentLookupRow)
    && execution.broker_connection_available === false
    && execution.quote_preview_available === false
    && execution.signing_available === false
    && execution.submission_available === false;
}

function sanitizeInstrumentLookup(payload) {
  const results = payload.results.map((row) => ({
    schema_version: "ravenos.instrument.v1",
    instrument_id: row.instrument_id,
    symbol: row.symbol,
    display_name: typeof row.display_name === "string" ? row.display_name.slice(0, 160) : row.symbol,
    asset_class: row.asset_class,
    instrument_type: row.instrument_type,
    identity_scope: "exact_instrument",
    venue: row.venue,
    chain: "none",
    market_identity: {
      market_id: row.symbol,
      listing: row.market_identity.listing,
    },
    base_asset: { symbol: row.symbol, asset_id: row.symbol },
    quote_asset: { symbol: "USD", asset_id: "USD" },
    settlement_asset: { symbol: "USD", asset_id: "USD" },
    preferred_cash_asset: { symbol: "USD", asset_id: "USD" },
    economic_numeraire: "USDC",
    chart_source: "ravenos_terminal_chart",
    market_session: {
      state: typeof row.market_session?.state === "string" ? row.market_session.state.slice(0, 32) : "unknown",
      timezone: "America/New_York",
      observed_at: typeof row.market_session?.observed_at === "string" ? row.market_session.observed_at : null,
    },
    capabilities: {
      chart: row.capabilities?.chart === true,
      live_price: row.capabilities?.live_price === true,
      atlas_intelligence: row.capabilities?.atlas_intelligence === true,
      raven_intelligence: row.capabilities?.raven_intelligence === true,
      options_summary: row.capabilities?.options_summary === true,
      quote_preview: false,
      execution: false,
    },
    route_compatibility: ["inspect"],
    account_compatibility: [],
  }));
  return {
    ok: true,
    safe_public: true,
    redaction_policy: PUBLIC_REDACTION_POLICY,
    schema_version: INSTRUMENT_LOOKUP_CONTRACT.schema,
    generated_at: payload.generated_at,
    freshness_target_seconds: 300,
    query: payload.query,
    provider: "Tradier",
    results,
    execution_boundary: {
      broker_connection_available: false,
      quote_preview_available: false,
      signing_available: false,
      submission_available: false,
    },
  };
}

function validInstrumentChartCandle(candle, previousTime) {
  const time = candle?.time;
  const open = candle?.open;
  const high = candle?.high;
  const low = candle?.low;
  const close = candle?.close;
  const volume = candle?.volume;
  return Number.isInteger(time)
    && time > 0
    && time > previousTime
    && [open, high, low, close, volume].every(Number.isFinite)
    && [open, high, low, close].every((value) => value > 0)
    && volume >= 0
    && high >= Math.max(open, low, close)
    && low <= Math.min(open, high, close);
}

function validateInstrumentChart(payload, { query, instrumentId, timeframe }) {
  const execution = payload?.execution_boundary || {};
  const candles = payload?.candles;
  const instrument = payload?.instrument;
  if (
    payload?.ok !== true
    || payload?.safe_public !== true
    || payload?.redaction_policy !== PUBLIC_REDACTION_POLICY
    || payload?.schema_version !== INSTRUMENT_CHART_CONTRACT.schema
    || String(payload?.query || "").toLowerCase() !== query.toLowerCase()
    || payload?.instrument_id !== instrumentId
    || payload?.timeframe !== timeframe
    || payload?.provider !== "Yahoo Finance"
    || payload?.identity_provider !== "Tradier"
    || Number(payload?.freshness_target_seconds) !== 300
    || !validInstrumentLookupRow(instrument)
    || instrument.instrument_id !== instrumentId
    || instrument.symbol !== query.toUpperCase()
    || !Array.isArray(candles)
    || candles.length < 1
    || candles.length > INSTRUMENT_CHART_CONTRACT.maxCandles
    || execution.broker_connection_available !== false
    || execution.quote_preview_available !== false
    || execution.signing_available !== false
    || execution.submission_available !== false
    || execution.position_monitoring_available !== false
  ) return false;
  let previousTime = 0;
  for (const candle of candles) {
    if (!validInstrumentChartCandle(candle, previousTime)) return false;
    previousTime = candle.time;
  }
  const observedMs = Date.parse(String(payload?.market_data_observed_at || ""));
  return Number.isFinite(observedMs) && Math.abs(observedMs / 1000 - previousTime) <= 1;
}

function sanitizeInstrumentChart(payload) {
  const instrument = sanitizeInstrumentLookup({ ...payload, results: [payload.instrument] }).results[0];
  return {
    ok: true,
    safe_public: true,
    redaction_policy: PUBLIC_REDACTION_POLICY,
    schema_version: INSTRUMENT_CHART_CONTRACT.schema,
    generated_at: payload.generated_at,
    freshness_target_seconds: 300,
    query: payload.query,
    instrument_id: payload.instrument_id,
    timeframe: payload.timeframe,
    provider: "Yahoo Finance",
    identity_provider: "Tradier",
    instrument,
    candles: payload.candles.map((candle) => ({
      time: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    })),
    market_data_observed_at: payload.market_data_observed_at,
    execution_boundary: {
      broker_connection_available: false,
      quote_preview_available: false,
      signing_available: false,
      submission_available: false,
      position_monitoring_available: false,
    },
  };
}

export async function loadPublicInstrumentLookup({
  env = {},
  query = "",
  fetchImpl = globalThis.fetch,
  nowMs = Date.now(),
  timeoutMs = finitePositive(env.RAVENOS_PUBLIC_ORIGIN_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
} = {}) {
  const cleanQuery = cleanInstrumentLookupQuery(query);
  if (!cleanQuery) {
    return {
      payload: null,
      available: false,
      delivery: {
        schema_version: "ravenos.delivery.v1",
        source: "unavailable",
        key: "instrument_lookup",
        fetched_at: isoNow(nowMs),
        source_generated_at: null,
        origin_updated_at: null,
        age_seconds: null,
        freshness_target_seconds: null,
        freshness_state: "unavailable",
        fallback: false,
        reason: "invalid_instrument_query",
      },
    };
  }
  const target = instrumentLookupRequest(env, cleanQuery);
  const fetched = target.ok
    ? await fetchJsonDocument({
      env,
      key: "instrument_lookup",
      contract: INSTRUMENT_LOOKUP_CONTRACT,
      fetchImpl,
      timeoutMs,
      target,
    })
    : target;
  if (fetched.ok && validateInstrumentLookup(fetched.payload, cleanQuery)) {
    const payload = sanitizeInstrumentLookup(fetched.payload);
    const delivery = deliveryMetadata({
      key: "instrument_lookup",
      source: "current_public_origin",
      payload,
      fallback: false,
      reason: null,
      nowMs,
    });
    return { payload, delivery, available: true };
  }
  return {
    payload: null,
    available: false,
    delivery: {
      schema_version: "ravenos.delivery.v1",
      source: "unavailable",
      key: "instrument_lookup",
      fetched_at: isoNow(nowMs),
      source_generated_at: null,
      origin_updated_at: null,
      age_seconds: null,
      freshness_target_seconds: null,
      freshness_state: "unavailable",
      fallback: false,
      reason: fetched.reason || "instrument_lookup_contract_rejected",
    },
  };
}

export async function loadPublicInstrumentChart({
  env = {},
  query = "",
  instrumentId = "",
  timeframe = "1h",
  limit = 360,
  fetchImpl = globalThis.fetch,
  nowMs = Date.now(),
  timeoutMs = finitePositive(env.RAVENOS_PUBLIC_ORIGIN_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
} = {}) {
  const cleanQuery = cleanInstrumentLookupQuery(query);
  const cleanId = cleanInstrumentId(instrumentId);
  const cleanTimeframe = String(timeframe || "1h").trim().toLowerCase();
  const cleanLimit = boundedInstrumentChartLimit(limit);
  const validRequest = cleanQuery
    && cleanId
    && INSTRUMENT_CHART_CONTRACT.timeframes.has(cleanTimeframe);
  if (!validRequest) {
    return {
      payload: null,
      available: false,
      delivery: {
        schema_version: "ravenos.delivery.v1",
        source: "unavailable",
        key: "instrument_chart",
        fetched_at: isoNow(nowMs),
        source_generated_at: null,
        origin_updated_at: null,
        age_seconds: null,
        freshness_target_seconds: null,
        freshness_state: "unavailable",
        fallback: false,
        reason: "invalid_instrument_chart_query",
      },
    };
  }
  const target = instrumentChartRequest(env, {
    query: cleanQuery,
    instrumentId: cleanId,
    timeframe: cleanTimeframe,
    limit: cleanLimit,
  });
  const fetched = target.ok
    ? await fetchJsonDocument({
      env,
      key: "instrument_chart",
      contract: INSTRUMENT_CHART_CONTRACT,
      fetchImpl,
      timeoutMs,
      target,
    })
    : target;
  if (fetched.ok && validateInstrumentChart(fetched.payload, {
    query: cleanQuery,
    instrumentId: cleanId,
    timeframe: cleanTimeframe,
  })) {
    const payload = sanitizeInstrumentChart(fetched.payload);
    const delivery = deliveryMetadata({
      key: "instrument_chart",
      source: "current_public_origin",
      payload,
      fallback: false,
      reason: null,
      nowMs,
    });
    return { payload, delivery, available: true };
  }
  return {
    payload: null,
    available: false,
    delivery: {
      schema_version: "ravenos.delivery.v1",
      source: "unavailable",
      key: "instrument_chart",
      fetched_at: isoNow(nowMs),
      source_generated_at: null,
      origin_updated_at: null,
      age_seconds: null,
      freshness_target_seconds: null,
      freshness_state: "unavailable",
      fallback: false,
      reason: fetched.reason || "instrument_chart_contract_rejected",
    },
  };
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
