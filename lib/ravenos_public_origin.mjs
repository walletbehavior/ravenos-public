const DEFAULT_ORIGIN_BASE_URL = "https://ravenos-public-origin.ravenos.xyz/public/ravenos";
const PUBLIC_REDACTION_POLICY = "aggregate_public_market_context_only";
const ATLAS_UNIVERSE_REDACTION_POLICY = "atlas_public_metadata_and_rights_admitted_observations_only";
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
const INSTRUMENT_CHART_INTERVAL_SECONDS = Object.freeze({
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3_600,
  "4h": 14_400,
  "1d": 86_400,
  "1w": 604_800,
});

export const ATLAS_UNIVERSE_ENDPOINTS = Object.freeze({
  featured: Object.freeze({ schema: "atlas_featured_state_v1", path: "atlas/featured.json", maxBytes: 1024 * 1024 }),
  search: Object.freeze({ schema: "atlas_search_result_v1", path: "atlas/search.json", maxBytes: 512 * 1024 }),
  entity: Object.freeze({ schema: "atlas_entity_detail_v1", path: "atlas/entity.json", maxBytes: 512 * 1024 }),
  history: Object.freeze({ schema: "atlas_history_v1", path: "atlas/history.json", maxBytes: 1024 * 1024 }),
  options_expirations: Object.freeze({ schema: "atlas_options_expirations_v1", path: "atlas/options/expirations.json", maxBytes: 256 * 1024 }),
  options_chain: Object.freeze({ schema: "atlas_options_chain_v1", path: "atlas/options/chain.json", maxBytes: 1024 * 1024 }),
  sec_filings: Object.freeze({ schema: "atlas_sec_filings_v1", path: "atlas/sec/filings.json", maxBytes: 1024 * 1024 }),
  sec_insiders: Object.freeze({ schema: "atlas_sec_insiders_v1", path: "atlas/sec/insiders.json", maxBytes: 1024 * 1024 }),
  eia_facets: Object.freeze({ schema: "atlas_eia_facets_v1", path: "atlas/eia/facets.json", maxBytes: 512 * 1024 }),
  eia_series: Object.freeze({ schema: "atlas_eia_materialized_series_v1", path: "atlas/eia/series.json", maxBytes: 1024 * 1024 }),
  provider_health: Object.freeze({ schema: "atlas_provider_health_v1", path: "atlas/provider_health.json", maxBytes: 512 * 1024 }),
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

function cleanAtlasEntityId(value) {
  const clean = String(value || "").trim();
  return /^[a-z][a-z0-9_]*:[A-Za-z0-9][A-Za-z0-9:._/-]{0,190}$/.test(clean) ? clean : null;
}

function cleanAtlasSearchQuery(value) {
  const clean = String(value || "").trim().replace(/\s+/g, " ");
  return clean.length >= 2 && clean.length <= 160 && !/[<>\\\u0000-\u001f]/.test(clean) ? clean : null;
}

function cleanAtlasViewerToken(value) {
  const clean = String(value || "").trim();
  return /^[A-Za-z0-9_-]{16,128}$/.test(clean) ? clean : null;
}

function cleanAtlasEiaField(value, maxLength = 64) {
  const clean = String(value || "").trim();
  return clean.length <= maxLength && /^[A-Za-z0-9_-]+$/.test(clean) ? clean : null;
}

function cleanAtlasEiaFacetValue(value) {
  const clean = String(value || "").trim();
  return clean.length <= 120 && /^[A-Za-z0-9 .,_:/()-]+$/.test(clean) ? clean : null;
}

function atlasUniverseRequest(env, endpoint, params = {}, viewerToken = "") {
  const contract = ATLAS_UNIVERSE_ENDPOINTS[endpoint];
  const base = configuredOriginBase(env);
  const token = String(env.RAVENOS_PUBLIC_ORIGIN_TOKEN || "").trim();
  if (!contract) return { ok: false, reason: "atlas_endpoint_unsupported" };
  if (!base) return { ok: false, reason: "origin_url_invalid" };
  if (!token) return { ok: false, reason: "origin_token_not_configured" };
  const url = new URL(`${base}/${contract.path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && String(value) !== "") url.searchParams.set(key, String(value));
  }
  const headers = { accept: "application/json", "x-ravenos-public-token": token };
  const cleanViewer = cleanAtlasViewerToken(viewerToken);
  if (cleanViewer) headers["x-ravenos-atlas-viewer"] = cleanViewer;
  return { ok: true, url: url.toString(), headers };
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

function cleanInstrumentChartTimeframe(value) {
  const clean = String(value || "1h").trim();
  return clean === "1M" ? "1M" : clean.toLowerCase();
}

function instrumentChartIntervalMatches(candles, timeframe) {
  if (!Array.isArray(candles) || candles.length < 2) return true;
  const deltas = candles.slice(1).map((candle, index) => candle.time - candles[index].time);
  if (timeframe === "1M") {
    const minimumMonth = 28 * 86_400;
    const maximumMonth = 31 * 86_400;
    return deltas.every((delta) => delta >= minimumMonth)
      && deltas.some((delta) => delta >= minimumMonth && delta <= maximumMonth);
  }
  const expected = INSTRUMENT_CHART_INTERVAL_SECONDS[timeframe];
  return Number.isFinite(expected)
    && deltas.every((delta) => delta >= expected)
    && deltas.some((delta) => delta === expected);
}

function normalizeTrailingListedQuote(candles, timeframe) {
  const rows = Array.isArray(candles)
    ? candles.map((candle) => ({
      time: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    }))
    : [];
  const expected = INSTRUMENT_CHART_INTERVAL_SECONDS[timeframe];
  if (!Number.isFinite(expected) || rows.length < 2) return rows;
  const quote = rows.at(-1);
  const previous = rows.at(-2);
  const flatZeroVolumeQuote = quote.volume === 0
    && quote.open === quote.high
    && quote.high === quote.low
    && quote.low === quote.close;
  const delta = quote.time - previous.time;
  if (!flatZeroVolumeQuote || delta <= 0 || delta >= expected * 2) return rows;

  if (delta < expected) {
    rows[rows.length - 2] = {
      ...previous,
      high: Math.max(previous.high, quote.close),
      low: Math.min(previous.low, quote.close),
      close: quote.close,
    };
    rows.pop();
    return rows;
  }

  rows[rows.length - 1] = {
    ...quote,
    time: previous.time + expected,
  };
  return rows;
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
  const normalizedCandles = normalizeTrailingListedQuote(candles, timeframe);
  if (!instrumentChartIntervalMatches(normalizedCandles, timeframe)) return false;
  const observedMs = Date.parse(String(payload?.market_data_observed_at || ""));
  return Number.isFinite(observedMs) && Math.abs(observedMs / 1000 - previousTime) <= 1;
}

function sanitizeInstrumentChart(payload) {
  const instrument = sanitizeInstrumentLookup({ ...payload, results: [payload.instrument] }).results[0];
  const candles = normalizeTrailingListedQuote(payload.candles, payload.timeframe);
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
    candles,
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
  const cleanTimeframe = cleanInstrumentChartTimeframe(timeframe);
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

const ATLAS_ENTITY_KINDS = new Set([
  "equity", "etf", "index", "forex_pair", "future_root", "future_contract",
  "economic_series", "rate_series", "energy_series", "crypto_context_asset", "sec_issuer", "sec_filing",
]);
const ATLAS_ENTITY_CLASSES = new Set(["tradable_quote", "reference_series", "document_entity", "proxy"]);
const ATLAS_DISPLAY_DECISIONS = new Set(["allowed", "restricted", "internal_only", "unknown"]);
const ATLAS_PROVIDER_STATES = new Set(["available", "degraded", "display_restricted", "unavailable", "document_entity"]);
const ATLAS_FORBIDDEN_KEYS = new Set([
  "api_key", "authorization", "credential", "credentials", "secret", "token", "raw_payload",
  "provider_payload", "request_headers", "private_path", "account_id", "order_id", "position_id",
]);

function atlasExecutionBoundaryIsClosed(boundary) {
  return boundary
    && typeof boundary === "object"
    && Object.keys(boundary).length >= 5
    && Object.values(boundary).every((value) => value === false);
}

function atlasObjectIsPublicSafe(value, depth = 0) {
  if (depth > 18) return false;
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    return typeof value !== "string" || (!value.includes("/srv/") && !value.includes("/root/") && !/bearer\s+[a-z0-9._-]+/i.test(value));
  }
  if (Array.isArray(value)) return value.length <= 5000 && value.every((item) => atlasObjectIsPublicSafe(item, depth + 1));
  if (typeof value !== "object") return false;
  return Object.entries(value).every(([key, item]) => !ATLAS_FORBIDDEN_KEYS.has(String(key).toLowerCase()) && atlasObjectIsPublicSafe(item, depth + 1));
}

function validAtlasSearchRow(row) {
  return row?.schema_version === "atlas_search_result_v1"
    && cleanAtlasEntityId(row.entity_id) === row.entity_id
    && typeof row.name === "string" && row.name.length > 0 && row.name.length <= 240
    && typeof row.symbol === "string" && row.symbol.length > 0 && row.symbol.length <= 80
    && ATLAS_ENTITY_KINDS.has(row.entity_kind)
    && ATLAS_ENTITY_CLASSES.has(row.entity_class)
    && typeof row.provider === "string" && row.provider.length <= 80
    && ATLAS_DISPLAY_DECISIONS.has(row.public_display_eligibility)
    && typeof row.cached_snapshot_available === "boolean"
    && (!row.data_timing || typeof row.data_timing === "string")
    && (!row.catalog_state || row.catalog_state === "cataloged")
    && (!row.observation_display_eligibility || ATLAS_DISPLAY_DECISIONS.has(row.observation_display_eligibility))
    && typeof row.featured === "boolean"
    && typeof row.selectable === "boolean"
    && !("price" in row) && !("last" in row) && !("quote" in row);
}

function validAtlasFeaturedSnapshot(snapshot, row) {
  if (snapshot === null) return true;
  return snapshot?.schema_version === "atlas_market_snapshot_v1"
    && snapshot.atlas_entity_id === row.entity_id
    && typeof snapshot.instrument_id === "string"
    && /^(?:equity|etf):[a-z0-9.-]+:[a-z0-9.-]+$/.test(snapshot.instrument_id)
    && snapshot.identity_scope === "exact_instrument"
    && String(snapshot.symbol || "").toUpperCase() === String(row.symbol || "").toUpperCase()
    && Number.isFinite(Number(snapshot.last)) && Number(snapshot.last) > 0
    && typeof snapshot.provider === "string" && snapshot.provider.length <= 80
    && Number.isFinite(Date.parse(String(snapshot.provider_timestamp || "")));
}

function validAtlasDisplayPolicy(policy) {
  return policy && typeof policy === "object"
    && ATLAS_DISPLAY_DECISIONS.has(policy.decision)
    && typeof policy.raw_redistribution_allowed === "boolean"
    && typeof policy.cache_allowed === "boolean"
    && Number.isInteger(Number(policy.max_cache_seconds))
    && Number.isInteger(Number(policy.delay_requirement_seconds))
    && typeof policy.attribution_required === "boolean";
}

function validAtlasProviderView(view) {
  if (!view || typeof view !== "object" || !ATLAS_PROVIDER_STATES.has(view.state)) return false;
  if (view.display_policy && !validAtlasDisplayPolicy(view.display_policy)) return false;
  if (view.state === "display_restricted" && view.data !== null) return false;
  if (view.display_policy?.decision !== "allowed" && view.data !== null && view.state !== "document_entity") return false;
  return typeof view.provider === "string" && Array.isArray(view.refusal_reasons);
}

function validAtlasEiaFacetData(data, facetId) {
  return data && typeof data === "object"
    && typeof data.route === "string" && /^[a-z0-9-]+(?:\/[a-z0-9-]+){0,5}$/.test(data.route)
    && data.facet_id === facetId
    && Array.isArray(data.values) && data.values.length <= 250
    && data.values.every((row) => row && typeof row.id === "string" && row.id.length <= 120 && typeof row.name === "string" && row.name.length <= 240)
    && Number.isInteger(Number(data.total)) && typeof data.truncated === "boolean";
}

function validAtlasEiaDataset(data) {
  return data && typeof data === "object"
    && Array.isArray(data.facets) && data.facets.length <= 20
    && data.facets.every((row) => row && cleanAtlasEiaField(row.id) === row.id && typeof row.name === "string" && row.name.length <= 120)
    && Array.isArray(data.frequencies) && data.frequencies.length <= 20
    && data.frequencies.every((row) => row && cleanAtlasEiaField(row.id, 32)?.toLowerCase() === row.id && typeof row.description === "string" && row.description.length <= 240)
    && Array.isArray(data.data_fields) && data.data_fields.length <= 20
    && data.data_fields.every((value) => cleanAtlasEiaField(value) === value);
}

function sanitizeAtlasEiaDataset(data) {
  if (!validAtlasEiaDataset(data)) return null;
  return {
    facets: data.facets.map((row) => ({ id: row.id, name: row.name.slice(0, 120) })),
    frequencies: data.frequencies.map((row) => ({ id: row.id, description: row.description.slice(0, 240) })),
    data_fields: data.data_fields.slice(0, 20),
  };
}

function validAtlasEiaSeriesData(data, selection) {
  return data && typeof data === "object"
    && typeof data.route === "string" && /^[a-z0-9-]+(?:\/[a-z0-9-]+){0,5}$/.test(data.route)
    && data.frequency === selection.frequency
    && data.data_field === selection.dataField
    && data.selection_exact === true
    && data.facets && data.facets[selection.facetId] === selection.facetValue
    && Object.keys(data.facets).length === 1
    && Array.isArray(data.observations) && data.observations.length <= 1000
    && data.observations.every((row) => row && typeof row.period === "string" && row.period.length <= 32 && Number.isFinite(Number(row.value)) && (!row.unit || typeof row.unit === "string"));
}

function validSecArchiveUrl(value, { xml = false } = {}) {
  if (value === null || value === undefined || value === "") return !xml;
  try {
    const url = new URL(String(value));
    return url.protocol === "https:"
      && url.hostname === "www.sec.gov"
      && !url.username && !url.password && !url.port
      && url.pathname.startsWith("/Archives/edgar/data/")
      && !/(?:^|\/)(?:\.|%2e){2}(?:\/|$)/i.test(url.pathname)
      && (!xml || url.pathname.toLowerCase().endsWith(".xml"));
  } catch {
    return false;
  }
}

function validAtlasSecFiling(row) {
  return row?.schema_version === "atlas_sec_filing_event_v1"
    && typeof row.event_id === "string" && row.event_id.length <= 120
    && typeof row.accession_number === "string" && /^[0-9-]{12,32}$/.test(row.accession_number)
    && typeof row.form === "string" && row.form.length > 0 && row.form.length <= 24
    && typeof row.issuer_name === "string" && row.issuer_name.length > 0 && row.issuer_name.length <= 240
    && validSecArchiveUrl(row.filing_url)
    && (!row.ownership_xml_url || validSecArchiveUrl(row.ownership_xml_url, { xml: true }))
    && row.public_display_allowed === true
    && Array.isArray(row.refusal_reasons) && row.refusal_reasons.length <= 20;
}

function sanitizeAtlasSecFiling(row) {
  return {
    schema_version: "atlas_sec_filing_event_v1",
    event_id: String(row.event_id).slice(0, 120),
    cik: typeof row.cik === "string" ? row.cik.slice(0, 24) : null,
    canonical_entity_id: cleanAtlasEntityId(row.canonical_entity_id),
    issuer_name: String(row.issuer_name).slice(0, 240),
    ticker: typeof row.ticker === "string" ? row.ticker.slice(0, 32) : null,
    accession_number: String(row.accession_number).slice(0, 32),
    form: String(row.form).slice(0, 24),
    filed_at: row.filed_at || null,
    accepted_at: row.accepted_at || null,
    reporting_period: row.reporting_period || null,
    primary_document: typeof row.primary_document === "string" ? row.primary_document.slice(0, 240) : "",
    primary_document_description: typeof row.primary_document_description === "string" ? row.primary_document_description.slice(0, 500) : "",
    amendment: row.amendment === true,
    amended_accession: typeof row.amended_accession === "string" ? row.amended_accession.slice(0, 32) : null,
    filing_url: String(row.filing_url),
    ownership_xml_url: row.ownership_xml_url ? String(row.ownership_xml_url) : null,
    source: typeof row.source === "string" ? row.source.slice(0, 120) : "SEC EDGAR",
    freshness: "document",
    parser_status: typeof row.parser_status === "string" ? row.parser_status.slice(0, 80) : "metadata_only",
    public_display_allowed: true,
    refusal_reasons: row.refusal_reasons.slice(0, 20).map((value) => String(value).slice(0, 240)),
  };
}

function nullableFinite(value) {
  return value === null || value === undefined ? null : Number.isFinite(Number(value)) ? Number(value) : null;
}

function validAtlasInsiderEvent(row) {
  const relationship = row?.relationship;
  return row?.schema_version === "atlas_insider_event_v1"
    && typeof row.event_id === "string" && row.event_id.length <= 160
    && typeof row.reporting_owner === "string" && row.reporting_owner.length > 0 && row.reporting_owner.length <= 240
    && relationship && typeof relationship === "object"
    && ["non_derivative", "derivative"].includes(row.table_kind)
    && typeof row.transaction_class === "string" && row.transaction_class.length <= 80
    && validSecArchiveUrl(row.original_document, { xml: true })
    && row.public_display_allowed === true
    && Array.isArray(row.footnotes) && row.footnotes.length <= 50
    && row.footnotes.every((item) => item && typeof item.id === "string" && item.id.length <= 40 && typeof item.text === "string" && item.text.length <= 4000)
    && Array.isArray(row.refusal_or_ambiguity_reasons) && row.refusal_or_ambiguity_reasons.length <= 20;
}

function sanitizeAtlasInsiderEvent(row) {
  const relationship = row.relationship || {};
  return {
    schema_version: "atlas_insider_event_v1",
    event_id: String(row.event_id).slice(0, 160),
    issuer: typeof row.issuer === "string" ? row.issuer.slice(0, 240) : "",
    issuer_cik: typeof row.issuer_cik === "string" ? row.issuer_cik.slice(0, 24) : null,
    canonical_entity_id: cleanAtlasEntityId(row.canonical_entity_id),
    ticker: typeof row.ticker === "string" ? row.ticker.slice(0, 32) : null,
    filing_accession: typeof row.filing_accession === "string" ? row.filing_accession.slice(0, 32) : null,
    filed_at: row.filed_at || null,
    accepted_at: row.accepted_at || null,
    transaction_at: row.transaction_at || null,
    reporting_owner: String(row.reporting_owner).slice(0, 240),
    owner_cik: typeof row.owner_cik === "string" ? row.owner_cik.slice(0, 24) : null,
    relationship: {
      officer: relationship.officer === true ? true : relationship.officer === false ? false : null,
      director: relationship.director === true ? true : relationship.director === false ? false : null,
      ten_percent_owner: relationship.ten_percent_owner === true ? true : relationship.ten_percent_owner === false ? false : null,
      other: relationship.other === true ? true : relationship.other === false ? false : null,
      officer_title: typeof relationship.officer_title === "string" ? relationship.officer_title.slice(0, 240) : null,
      other_text: typeof relationship.other_text === "string" ? relationship.other_text.slice(0, 500) : null,
    },
    table_kind: row.table_kind,
    security_title: typeof row.security_title === "string" ? row.security_title.slice(0, 240) : "",
    underlying_security_title: typeof row.underlying_security_title === "string" ? row.underlying_security_title.slice(0, 240) : null,
    transaction_code: typeof row.transaction_code === "string" ? row.transaction_code.slice(0, 8) : null,
    transaction_class: String(row.transaction_class).slice(0, 80),
    acquired_or_disposed: typeof row.acquired_or_disposed === "string" ? row.acquired_or_disposed.slice(0, 8) : null,
    side: typeof row.side === "string" ? row.side.slice(0, 16) : "other",
    shares: nullableFinite(row.shares),
    price: nullableFinite(row.price),
    gross_transaction_value: nullableFinite(row.gross_transaction_value),
    post_transaction_holdings: nullableFinite(row.post_transaction_holdings),
    direct_or_indirect_ownership: typeof row.direct_or_indirect_ownership === "string" ? row.direct_or_indirect_ownership.slice(0, 8) : null,
    nature_of_indirect_ownership: typeof row.nature_of_indirect_ownership === "string" ? row.nature_of_indirect_ownership.slice(0, 500) : null,
    conversion_or_exercise_price: nullableFinite(row.conversion_or_exercise_price),
    derivative_expiration: row.derivative_expiration || null,
    rule_10b5_1: row.rule_10b5_1 === true ? true : row.rule_10b5_1 === false ? false : null,
    footnotes: row.footnotes.slice(0, 50).map((item) => ({ id: String(item.id).slice(0, 40), text: String(item.text).slice(0, 4000) })),
    amendment: row.amendment === true,
    original_document: String(row.original_document),
    parser_confidence: typeof row.parser_confidence === "string" ? row.parser_confidence.slice(0, 40) : "bounded",
    refusal_or_ambiguity_reasons: row.refusal_or_ambiguity_reasons.slice(0, 20).map((value) => String(value).slice(0, 240)),
    public_display_allowed: true,
    source: typeof row.source === "string" ? row.source.slice(0, 120) : "SEC EDGAR ownership XML",
    fetched_at: row.fetched_at || null,
  };
}

function validAtlasLease(lease) {
  if (lease === null || lease === undefined) return true;
  return lease?.schema_version === "atlas_interest_lease_v1"
    && typeof lease.lease_id === "string" && /^[a-f0-9]{40}$/.test(lease.lease_id)
    && cleanAtlasEntityId(lease.entity_id) === lease.entity_id
    && typeof lease.data_product === "string"
    && (!lease.data_variant || typeof lease.data_variant === "string")
    && !Object.prototype.hasOwnProperty.call(lease, "user_or_session_hash");
}

function sanitizeAtlasLease(lease) {
  if (!lease || typeof lease !== "object") return null;
  return {
    schema_version: "atlas_interest_lease_v1",
    lease_id: String(lease.lease_id || ""),
    entity_id: String(lease.entity_id || ""),
    data_product: String(lease.data_product || ""),
    data_variant: typeof lease.data_variant === "string" ? lease.data_variant.slice(0, 120) : "",
    interest_source: String(lease.interest_source || ""),
    priority: Number(lease.priority || 0),
    requested_cadence: Number(lease.requested_cadence || 0),
    created_at: lease.created_at || null,
    renewed_at: lease.renewed_at || null,
    expires_at: lease.expires_at || null,
    persistent: lease.persistent === true,
    reason: typeof lease.reason === "string" ? lease.reason.slice(0, 240) : "",
  };
}

function sanitizeAtlasProviderView(view) {
  if (!view || typeof view !== "object") return null;
  const policy = view.display_policy && typeof view.display_policy === "object" ? {
    decision: view.display_policy.decision,
    raw_redistribution_allowed: view.display_policy.raw_redistribution_allowed === true,
    cache_allowed: view.display_policy.cache_allowed === true,
    max_cache_seconds: Number(view.display_policy.max_cache_seconds || 0),
    delay_requirement_seconds: Number(view.display_policy.delay_requirement_seconds || 0),
    attribution_required: view.display_policy.attribution_required === true,
    attribution_text: typeof view.display_policy.attribution_text === "string" ? view.display_policy.attribution_text.slice(0, 500) : "",
    decision_source: typeof view.display_policy.decision_source === "string" ? view.display_policy.decision_source.slice(0, 500) : "",
    last_reviewed: view.display_policy.last_reviewed || null,
    reason: typeof view.display_policy.reason === "string" ? view.display_policy.reason.slice(0, 240) : "",
  } : null;
  return {
    state: view.state,
    provider: String(view.provider || "unknown").slice(0, 80),
    provider_timestamp: view.provider_timestamp || null,
    fetched_at: view.fetched_at || null,
    delay_class: String(view.delay_class || "unknown").slice(0, 32),
    delayed: view.delayed === true,
    degraded: view.degraded === true,
    stale: view.stale === true,
    cache_hit: view.cache_hit === true,
    display_policy: policy,
    attribution: typeof view.attribution === "string" ? view.attribution.slice(0, 500) : null,
    refusal_reasons: Array.isArray(view.refusal_reasons) ? view.refusal_reasons.slice(0, 20).map((reason) => String(reason).slice(0, 240)) : [],
    data: policy?.decision === "allowed" ? view.data : null,
  };
}

function atlasBaseContractValid(payload, contract) {
  return payload?.ok === true
    && payload?.safe_public === true
    && payload?.redaction_policy === ATLAS_UNIVERSE_REDACTION_POLICY
    && payload?.schema_version === contract.schema
    && Number.isFinite(Date.parse(String(payload?.generated_at || "")))
    && atlasExecutionBoundaryIsClosed(payload.execution_boundary)
    && atlasObjectIsPublicSafe(payload);
}

function validateAtlasUniversePayload(endpoint, payload, request = {}) {
  const contract = ATLAS_UNIVERSE_ENDPOINTS[endpoint];
  if (!contract || !atlasBaseContractValid(payload, contract)) return false;
  if (endpoint === "search") {
    return String(payload.query || "").toLowerCase() === String(request.query || "").toLowerCase()
      && Array.isArray(payload.results) && payload.results.length <= 50
      && payload.results.every(validAtlasSearchRow)
      && payload.quote_fetch_triggered === false && payload.observer_created === false;
  }
  if (endpoint === "featured") {
    return Array.isArray(payload.sections) && payload.sections.length <= 12
      && payload.sections.every((section) => typeof section?.section_id === "string"
        && Array.isArray(section.entities) && section.entities.length <= 20
        && section.entities.every((row) => validAtlasSearchRow(row) && validAtlasFeaturedSnapshot(row.snapshot, row)));
  }
  if (endpoint === "entity") {
    return payload.entity?.entity_id === request.entityId
      && validAtlasSearchRow(payload.entity)
      && validAtlasProviderView(payload.snapshot)
      && validAtlasLease(payload.lease);
  }
  if (endpoint === "history") {
    if (payload.entity_id !== request.entityId) return false;
    if (payload.state === "facet_selection_required") {
      return payload.history === undefined
        && Array.isArray(payload.observations) && payload.observations.length === 0
        && validAtlasEiaDataset(payload.dataset);
    }
    return payload.dataset === undefined && (payload.history === undefined || validAtlasProviderView(payload.history));
  }
  if (endpoint === "options_expirations") return payload.entity_id === request.entityId && payload.full_chain_fetched === false && validAtlasLease(payload.lease) && (payload.options === undefined || validAtlasProviderView(payload.options));
  if (endpoint === "options_chain") return payload.entity_id === request.entityId && payload.expiration === request.expiration && payload.selected_expiration_only === true && payload.coherence_observer_active === false && validAtlasLease(payload.lease) && (payload.chain === undefined || validAtlasProviderView(payload.chain));
  if (endpoint === "sec_filings") return payload.entity_id === request.entityId
    && payload.metadata_is_not_a_filing_summary === true
    && validAtlasProviderView(payload.filings)
    && (payload.filings.state !== "available" || (Array.isArray(payload.filings.data) && payload.filings.data.length <= 100 && payload.filings.data.every(validAtlasSecFiling)));
  if (endpoint === "sec_insiders") return payload.entity_id === request.entityId
    && Array.isArray(payload.events) && payload.events.length <= 200 && payload.events.every(validAtlasInsiderEvent)
    && payload.market_enrichment_active === false && payload.options_enrichment_active === false && payload.misconduct_inference_emitted === false;
  if (endpoint === "eia_facets") return payload.entity_id === request.entityId
    && payload.facet_id === request.facetId
    && payload.observations_fetched === false
    && validAtlasProviderView(payload.facets)
    && (payload.facets.state !== "available" || validAtlasEiaFacetData(payload.facets.data, request.facetId));
  if (endpoint === "eia_series") return payload.entity_id === request.entityId
    && typeof payload.concrete_series_id === "string" && payload.concrete_series_id.startsWith(`${request.entityId}:`)
    && payload.selection_exact === true
    && payload.selection?.frequency === request.frequency
    && payload.selection?.data_field === request.dataField
    && payload.selection?.facets?.[request.facetId] === request.facetValue
    && Object.keys(payload.selection?.facets || {}).length === 1
    && validAtlasProviderView(payload.series)
    && (payload.series.state !== "available" || validAtlasEiaSeriesData(payload.series.data, request));
  if (endpoint === "provider_health") return payload.providers && typeof payload.providers === "object";
  return false;
}

function sanitizeAtlasSearchRow(row) {
  return {
    schema_version: "atlas_search_result_v1",
    entity_id: row.entity_id,
    name: String(row.name).slice(0, 240),
    symbol: String(row.symbol).slice(0, 80),
    entity_kind: row.entity_kind,
    entity_class: row.entity_class,
    provider: String(row.provider).slice(0, 80),
    data_frequency: typeof row.data_frequency === "string" ? row.data_frequency.slice(0, 120) : "unknown",
    status: typeof row.status === "string" ? row.status.slice(0, 40) : "UNAVAILABLE",
    data_timing: typeof row.data_timing === "string" ? row.data_timing.slice(0, 40) : null,
    catalog_state: row.catalog_state === "cataloged" ? "cataloged" : null,
    optionable: row.optionable === true,
    cached_snapshot_available: row.cached_snapshot_available === true,
    public_display_eligibility: row.public_display_eligibility,
    observation_display_eligibility: ATLAS_DISPLAY_DECISIONS.has(row.observation_display_eligibility) ? row.observation_display_eligibility : row.public_display_eligibility,
    description: typeof row.description === "string" ? row.description.slice(0, 300) : "",
    featured: row.featured === true,
    selectable: row.selectable === true,
    refusal_reason: typeof row.refusal_reason === "string" ? row.refusal_reason.slice(0, 240) : null,
  };
}

function sanitizeAtlasUniversePayload(endpoint, payload) {
  const base = {
    ok: true,
    safe_public: true,
    redaction_policy: ATLAS_UNIVERSE_REDACTION_POLICY,
    schema_version: payload.schema_version,
    generated_at: payload.generated_at,
    execution_boundary: Object.fromEntries(Object.keys(payload.execution_boundary).map((key) => [key, false])),
  };
  if (endpoint === "search") return { ...base, query: payload.query, results: payload.results.map(sanitizeAtlasSearchRow), groups: Object.fromEntries(Object.entries(payload.groups || {}).map(([group, rows]) => [String(group).slice(0, 80), Array.isArray(rows) ? rows.map(sanitizeAtlasSearchRow) : []])), local_first: payload.local_first === true, provider_assisted: payload.provider_assisted === true, assisted_provider: payload.assisted_provider || null, provider_refusal: payload.provider_refusal || null, quote_fetch_triggered: false, observer_created: false, elapsed_ms: Number(payload.elapsed_ms || 0) };
  if (endpoint === "featured") return { ...base, state: payload.state, sections: payload.sections.map((section) => ({ section_id: String(section.section_id).slice(0, 80), label: String(section.label || "").slice(0, 120), entities: section.entities.map((row) => ({ ...sanitizeAtlasSearchRow(row), snapshot: row.snapshot && typeof row.snapshot === "object" ? row.snapshot : null })) })), catalog_only_entities_do_not_refresh: true, featured_refresh: payload.featured_refresh, public_projection_generated_at: payload.public_projection_generated_at || null };
  if (endpoint === "entity") return { ...base, entity: sanitizeAtlasSearchRow(payload.entity), snapshot: sanitizeAtlasProviderView(payload.snapshot), lease: sanitizeAtlasLease(payload.lease), searchable: payload.searchable === true, hydrated: payload.hydrated === true, featured: payload.featured === true, active: payload.active === true, watched: false, alerted: false, deep_observed: false };
  if (endpoint === "history") return { ...base, entity_id: payload.entity_id, entity_class: payload.entity_class || null, state: payload.state || null, observations: Array.isArray(payload.observations) ? payload.observations : undefined, refusal_reasons: Array.isArray(payload.refusal_reasons) ? payload.refusal_reasons.map(String) : undefined, dataset: payload.dataset ? sanitizeAtlasEiaDataset(payload.dataset) : undefined, history: payload.history ? sanitizeAtlasProviderView(payload.history) : undefined };
  if (endpoint === "options_expirations") return { ...base, entity_id: payload.entity_id, state: payload.state || null, expirations: Array.isArray(payload.expirations) ? payload.expirations.slice(0, 250).map(String) : undefined, refusal_reasons: Array.isArray(payload.refusal_reasons) ? payload.refusal_reasons.map(String) : undefined, options: payload.options ? sanitizeAtlasProviderView(payload.options) : undefined, lease: sanitizeAtlasLease(payload.lease), full_chain_fetched: false };
  if (endpoint === "options_chain") return { ...base, entity_id: payload.entity_id, expiration: payload.expiration, state: payload.state || null, contracts: Array.isArray(payload.contracts) ? payload.contracts.slice(0, 2000) : undefined, refusal_reasons: Array.isArray(payload.refusal_reasons) ? payload.refusal_reasons.map(String) : undefined, chain: payload.chain ? sanitizeAtlasProviderView(payload.chain) : undefined, lease: sanitizeAtlasLease(payload.lease), selected_expiration_only: true, coherence_observer_active: false };
  if (endpoint === "sec_filings") {
    const filings = sanitizeAtlasProviderView(payload.filings);
    if (filings?.data) filings.data = filings.data.slice(0, 100).map(sanitizeAtlasSecFiling);
    return { ...base, entity_id: payload.entity_id, filings, metadata_is_not_a_filing_summary: true };
  }
  if (endpoint === "sec_insiders") return { ...base, entity_id: payload.entity_id, events: payload.events.slice(0, 200).map(sanitizeAtlasInsiderEvent), filings_considered: Number(payload.filings_considered || 0), parse_failures: Array.isArray(payload.parse_failures) ? payload.parse_failures.slice(0, 20).map((value) => String(value).slice(0, 240)) : [], market_enrichment_active: false, options_enrichment_active: false, misconduct_inference_emitted: false };
  if (endpoint === "eia_facets") {
    const facets = sanitizeAtlasProviderView(payload.facets);
    if (facets?.data) facets.data = {
      route: String(facets.data.route).slice(0, 240),
      facet_id: payload.facet_id,
      values: facets.data.values.slice(0, 250).map((row) => ({ id: String(row.id).slice(0, 120), name: String(row.name).slice(0, 240) })),
      total: Number(facets.data.total || 0),
      truncated: facets.data.truncated === true,
    };
    return { ...base, entity_id: payload.entity_id, facet_id: payload.facet_id, facets, observations_fetched: false };
  }
  if (endpoint === "eia_series") {
    const series = sanitizeAtlasProviderView(payload.series);
    if (series?.data) series.data = {
      route: String(series.data.route).slice(0, 240),
      frequency: payload.selection.frequency,
      data_field: payload.selection.data_field,
      facets: { ...payload.selection.facets },
      observations: series.data.observations.slice(0, 1000).map((row) => ({ period: String(row.period).slice(0, 32), value: Number(row.value), unit: typeof row.unit === "string" ? row.unit.slice(0, 120) : "" })),
      total: Number(series.data.total || 0),
      selection_exact: true,
    };
    return { ...base, entity_id: payload.entity_id, concrete_series_id: payload.concrete_series_id, selection: payload.selection, selection_exact: true, series };
  }
  if (endpoint === "provider_health") return { ...base, providers: payload.providers, usage: payload.usage };
  return null;
}

export async function loadPublicAtlasUniverse({
  env = {},
  endpoint,
  query = "",
  entityId = "",
  expiration = "",
  facetId = "",
  facetValue = "",
  frequency = "",
  dataField = "",
  limit = 20,
  viewerToken = "",
  fetchImpl = globalThis.fetch,
  nowMs = Date.now(),
  timeoutMs = finitePositive(env.RAVENOS_PUBLIC_ORIGIN_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
} = {}) {
  const contract = ATLAS_UNIVERSE_ENDPOINTS[endpoint];
  if (!contract) throw new Error(`unsupported_atlas_universe_endpoint:${String(endpoint || "")}`);
  const cleanQuery = endpoint === "search" ? cleanAtlasSearchQuery(query) : null;
  const entityEndpoints = ["entity", "history", "options_expirations", "options_chain", "sec_filings", "sec_insiders", "eia_facets", "eia_series"];
  const cleanEntityId = entityEndpoints.includes(endpoint) ? cleanAtlasEntityId(entityId) : null;
  const cleanExpiration = endpoint === "options_chain" && /^\d{4}-\d{2}-\d{2}$/.test(String(expiration || "")) ? String(expiration) : null;
  const cleanFacetId = ["eia_facets", "eia_series"].includes(endpoint) ? cleanAtlasEiaField(facetId) : null;
  const cleanFacetValue = endpoint === "eia_series" ? cleanAtlasEiaFacetValue(facetValue) : null;
  const cleanFrequency = endpoint === "eia_series" ? cleanAtlasEiaField(frequency, 32)?.toLowerCase() : null;
  const cleanDataField = endpoint === "eia_series" ? cleanAtlasEiaField(dataField) : null;
  if ((endpoint === "search" && !cleanQuery) || (entityEndpoints.includes(endpoint) && !cleanEntityId) || (endpoint === "options_chain" && !cleanExpiration) || (["eia_facets", "eia_series"].includes(endpoint) && !cleanFacetId) || (endpoint === "eia_series" && (!cleanFacetValue || !cleanFrequency || !cleanDataField))) {
    return { payload: null, available: false, delivery: { schema_version: "ravenos.delivery.v1", source: "unavailable", key: `atlas_${endpoint}`, fetched_at: isoNow(nowMs), source_generated_at: null, origin_updated_at: null, age_seconds: null, freshness_target_seconds: null, freshness_state: "unavailable", fallback: false, reason: "invalid_atlas_request" } };
  }
  const cap = Math.max(1, Math.min(Number(limit) || 20, endpoint === "search" ? 50 : 1000));
  const params = {};
  if (cleanQuery) params.q = cleanQuery;
  if (cleanEntityId) params.entity_id = cleanEntityId;
  if (cleanExpiration) params.expiration = cleanExpiration;
  if (cleanFacetId) params.facet_id = cleanFacetId;
  if (cleanFacetValue) params.facet_value = cleanFacetValue;
  if (cleanFrequency) params.frequency = cleanFrequency;
  if (cleanDataField) params.data_field = cleanDataField;
  if (["search", "featured", "history", "sec_filings", "sec_insiders"].includes(endpoint)) params.limit = cap;
  const target = atlasUniverseRequest(env, endpoint, params, viewerToken);
  const fetched = target.ok ? await fetchJsonDocument({ env, key: `atlas_${endpoint}`, contract, fetchImpl, timeoutMs, target }) : target;
  const request = { query: cleanQuery, entityId: cleanEntityId, expiration: cleanExpiration, facetId: cleanFacetId, facetValue: cleanFacetValue, frequency: cleanFrequency, dataField: cleanDataField };
  if (fetched.ok && validateAtlasUniversePayload(endpoint, fetched.payload, request)) {
    const payload = sanitizeAtlasUniversePayload(endpoint, fetched.payload);
    const delivery = deliveryMetadata({ key: `atlas_${endpoint}`, source: "current_public_origin", payload, fallback: false, reason: null, nowMs });
    return { payload, delivery, available: true };
  }
  return { payload: null, available: false, delivery: { schema_version: "ravenos.delivery.v1", source: "unavailable", key: `atlas_${endpoint}`, fetched_at: isoNow(nowMs), source_generated_at: null, origin_updated_at: null, age_seconds: null, freshness_target_seconds: null, freshness_state: "unavailable", fallback: false, reason: fetched.reason || "atlas_contract_rejected" } };
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
