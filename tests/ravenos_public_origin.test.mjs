import assert from "node:assert/strict";
import test from "node:test";

import {
  attachDelivery,
  loadOriginControlDocument,
  loadPublicInstrumentChart,
  loadPublicInstrumentLookup,
  loadPublicProjection,
  projectionFreshness,
  projectionHeaders,
  sanitizeOriginControlDocument,
} from "../lib/ravenos_public_origin.mjs";

const NOW = Date.parse("2026-07-21T10:00:00Z");
const ENV = {
  RAVENOS_PUBLIC_ORIGIN_URL: "https://origin.example/public/ravenos",
  RAVENOS_PUBLIC_ORIGIN_TOKEN: "test-token",
};

function envelope(overrides = {}) {
  return {
    ok: true,
    safe_public: true,
    key: "brief",
    schema_version: "ravenos_brief_public_origin_v1",
    generated_at: "2026-07-21T09:59:30Z",
    updated_at: "2026-07-21T09:59:45Z",
    freshness_target_seconds: 900,
    redaction_policy: "aggregate_public_market_context_only",
    data: { one_sentence_read: "Current evidence remains constructive." },
    ...overrides,
  };
}

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status || 200,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  });
}

function instrumentLookupEnvelope(overrides = {}) {
  return {
    ok: true,
    safe_public: true,
    redaction_policy: "aggregate_public_market_context_only",
    schema_version: "ravenos.instrument_lookup.v1",
    generated_at: "2026-07-21T09:59:30Z",
    freshness_target_seconds: 300,
    query: "AAPL",
    provider: "Tradier",
    results: [{
      schema_version: "ravenos.instrument.v1",
      instrument_id: "equity:nasdaq:aapl",
      symbol: "AAPL",
      display_name: "Apple Inc.",
      asset_class: "equity",
      instrument_type: "equity",
      identity_scope: "exact_instrument",
      venue: "nasdaq",
      chain: "none",
      market_identity: { market_id: "AAPL", listing: "Nasdaq" },
      base_asset: { symbol: "AAPL", asset_id: "AAPL" },
      quote_asset: { symbol: "USD", asset_id: "USD" },
      settlement_asset: { symbol: "USD", asset_id: "USD" },
      preferred_cash_asset: { symbol: "USD", asset_id: "USD" },
      economic_numeraire: "USDC",
      capabilities: { chart: true, quote_preview: false, execution: false },
    }],
    execution_boundary: {
      broker_connection_available: false,
      quote_preview_available: false,
      signing_available: false,
      submission_available: false,
    },
    ...overrides,
  };
}

function instrumentChartEnvelope(overrides = {}) {
  const lastTime = 1_753_003_600;
  return {
    ok: true,
    safe_public: true,
    redaction_policy: "aggregate_public_market_context_only",
    schema_version: "ravenos.instrument_chart.v1",
    generated_at: "2026-07-21T09:59:30Z",
    freshness_target_seconds: 300,
    query: "AAPL",
    instrument_id: "equity:nasdaq:aapl",
    timeframe: "1h",
    provider: "Yahoo Finance",
    identity_provider: "Tradier",
    instrument: instrumentLookupEnvelope().results[0],
    candles: [
      { time: 1_753_000_000, open: 210, high: 212, low: 209, close: 211, volume: 100 },
      { time: lastTime, open: 211, high: 213, low: 210, close: 212, volume: 120 },
    ],
    market_data_observed_at: new Date(lastTime * 1_000).toISOString(),
    execution_boundary: {
      broker_connection_available: false,
      quote_preview_available: false,
      signing_available: false,
      submission_available: false,
      position_monitoring_available: false,
    },
    ...overrides,
  };
}

test("loads a valid current public projection through the protected origin", async () => {
  let observed;
  const result = await loadPublicProjection({
    env: ENV,
    key: "brief",
    nowMs: NOW,
    fetchImpl: async (url, init) => {
      observed = { url, init };
      return jsonResponse(envelope());
    },
  });
  assert.equal(observed.url, "https://origin.example/public/ravenos/brief.json?projection=2");
  assert.equal(observed.init.headers["x-ravenos-public-token"], "test-token");
  assert.equal(observed.init.redirect, "manual");
  assert.equal(result.available, true);
  assert.equal(result.delivery.source, "current_public_origin");
  assert.equal(result.delivery.freshness_state, "fresh");
  assert.equal(result.delivery.fallback, false);
  assert.deepEqual(projectionHeaders(result.delivery), {
    "x-ravenos-data-source": "current_public_origin",
    "x-ravenos-freshness": "fresh",
  });
  assert.equal(attachDelivery(result.payload, result.delivery).delivery.key, "brief");
});

test("loads a bounded exact listed-instrument lookup through the protected origin", async () => {
  let observed;
  const result = await loadPublicInstrumentLookup({
    env: ENV,
    query: "  AAPL  ",
    nowMs: NOW,
    fetchImpl: async (url, init) => {
      observed = { url, init };
      const payload = instrumentLookupEnvelope({ provider_debug: { api_key: "must-not-ship" } });
      payload.results[0].provider_payload = { credential: "must-not-ship" };
      return jsonResponse(payload);
    },
  });
  assert.equal(observed.url, "https://origin.example/public/ravenos/instrument_lookup.json?q=AAPL");
  assert.equal(observed.init.headers["x-ravenos-public-token"], "test-token");
  assert.equal(observed.init.redirect, "manual");
  assert.equal(result.available, true);
  assert.equal(result.delivery.source, "current_public_origin");
  assert.equal(result.delivery.freshness_state, "fresh");
  assert.equal(result.delivery.fallback, false);
  assert.equal(result.payload.results[0].instrument_id, "equity:nasdaq:aapl");
  assert.equal(result.payload.results[0].settlement_asset.symbol, "USD");
  assert.equal(result.payload.results[0].capabilities.execution, false);
  assert.equal(JSON.stringify(result).includes("test-token"), false);
  assert.equal(JSON.stringify(result).includes("must-not-ship"), false);
  assert.equal("provider_payload" in result.payload.results[0], false);
});

test("loads bounded listed-market candles through the protected origin and strips provider extras", async () => {
  let observed;
  const result = await loadPublicInstrumentChart({
    env: ENV,
    query: "AAPL",
    instrumentId: "equity:nasdaq:aapl",
    timeframe: "1h",
    limit: 360,
    nowMs: NOW,
    fetchImpl: async (url, init) => {
      observed = { url, init };
      const payload = instrumentChartEnvelope({ provider_debug: { credential: "must-not-ship" } });
      payload.candles[0].provider_trade_id = "must-not-ship";
      return jsonResponse(payload);
    },
  });
  assert.equal(observed.url, "https://origin.example/public/ravenos/instrument_chart.json?q=AAPL&instrument_id=equity%3Anasdaq%3Aaapl&timeframe=1h&limit=360");
  assert.equal(observed.init.headers["x-ravenos-public-token"], "test-token");
  assert.equal(observed.init.redirect, "manual");
  assert.equal(result.available, true);
  assert.equal(result.delivery.source, "current_public_origin");
  assert.equal(result.delivery.freshness_state, "fresh");
  assert.equal(result.delivery.fallback, false);
  assert.equal(result.payload.instrument_id, "equity:nasdaq:aapl");
  assert.equal(result.payload.candles.length, 2);
  assert.equal(result.payload.execution_boundary.submission_available, false);
  assert.equal(JSON.stringify(result).includes("test-token"), false);
  assert.equal(JSON.stringify(result).includes("must-not-ship"), false);
});

test("listed-market one-minute and one-month contracts remain distinct", async () => {
  const minute = instrumentChartEnvelope({
    timeframe: "1m",
    candles: [
      { time: 1_753_000_000, open: 210, high: 212, low: 209, close: 211, volume: 100 },
      { time: 1_753_000_060, open: 211, high: 213, low: 210, close: 212, volume: 120 },
    ],
    market_data_observed_at: new Date(1_753_000_060 * 1_000).toISOString(),
  });
  const monthly = instrumentChartEnvelope({
    timeframe: "1M",
    candles: [
      { time: 1_748_736_000, open: 200, high: 215, low: 198, close: 210, volume: 1_000 },
      { time: 1_751_155_200, open: 210, high: 220, low: 205, close: 212, volume: 1_200 },
    ],
    market_data_observed_at: new Date(1_751_155_200 * 1_000).toISOString(),
  });
  const observed = [];
  for (const [timeframe, payload] of [["1m", minute], ["1M", monthly]]) {
    const result = await loadPublicInstrumentChart({
      env: ENV,
      query: "AAPL",
      instrumentId: "equity:nasdaq:aapl",
      timeframe,
      limit: 120,
      nowMs: NOW,
      fetchImpl: async (url) => {
        observed.push(url);
        return jsonResponse(payload);
      },
    });
    assert.equal(result.available, true);
    assert.equal(result.payload.timeframe, timeframe);
  }
  assert.match(observed[0], /timeframe=1m/);
  assert.match(observed[1], /timeframe=1M/);
});

test("listed-market adapter folds Yahoo's trailing live quote into its current interval", async () => {
  const hour = 3_600;
  const firstTime = 1_753_000_000;
  const secondTime = firstTime + hour;
  const quoteTime = secondTime + 1_410;
  const payload = instrumentChartEnvelope({
    timeframe: "1h",
    candles: [
      { time: firstTime, open: 210, high: 212, low: 209, close: 211, volume: 100 },
      { time: secondTime, open: 211, high: 213, low: 210, close: 212, volume: 120 },
      { time: quoteTime, open: 213.5, high: 213.5, low: 213.5, close: 213.5, volume: 0 },
    ],
    market_data_observed_at: new Date(quoteTime * 1_000).toISOString(),
  });
  const result = await loadPublicInstrumentChart({
    env: ENV,
    query: "AAPL",
    instrumentId: "equity:nasdaq:aapl",
    timeframe: "1h",
    limit: 360,
    nowMs: NOW,
    fetchImpl: async () => jsonResponse(payload),
  });
  assert.equal(result.available, true);
  assert.equal(result.payload.candles.length, 2);
  assert.deepEqual(result.payload.candles.at(-1), {
    time: secondTime,
    open: 211,
    high: 213.5,
    low: 210,
    close: 213.5,
    volume: 120,
  });
  assert.equal(result.payload.market_data_observed_at, new Date(quoteTime * 1_000).toISOString());
});

test("listed-market adapter aligns a trailing one-minute quote without inventing intermediate bars", async () => {
  const firstTime = 1_753_000_000;
  const secondTime = firstTime + 60;
  const quoteTime = secondTime + 90;
  const payload = instrumentChartEnvelope({
    timeframe: "1m",
    candles: [
      { time: firstTime, open: 210, high: 212, low: 209, close: 211, volume: 100 },
      { time: secondTime, open: 211, high: 213, low: 210, close: 212, volume: 120 },
      { time: quoteTime, open: 212.5, high: 212.5, low: 212.5, close: 212.5, volume: 0 },
    ],
    market_data_observed_at: new Date(quoteTime * 1_000).toISOString(),
  });
  const result = await loadPublicInstrumentChart({
    env: ENV,
    query: "AAPL",
    instrumentId: "equity:nasdaq:aapl",
    timeframe: "1m",
    limit: 360,
    nowMs: NOW,
    fetchImpl: async () => jsonResponse(payload),
  });
  assert.equal(result.available, true);
  assert.equal(result.payload.candles.length, 3);
  assert.equal(result.payload.candles.at(-1).time, secondTime + 60);
  assert.equal(result.payload.candles.at(-1).close, 212.5);
  assert.equal(result.payload.candles.at(-1).volume, 0);
});

test("listed-market chart rejects invalid identity before network access", async () => {
  let called = false;
  const result = await loadPublicInstrumentChart({
    env: ENV,
    query: "AAPL",
    instrumentId: "not-an-exact-id",
    timeframe: "1h",
    nowMs: NOW,
    fetchImpl: async () => {
      called = true;
      return jsonResponse(instrumentChartEnvelope());
    },
  });
  assert.equal(called, false);
  assert.equal(result.available, false);
  assert.equal(result.delivery.reason, "invalid_instrument_chart_query");
  assert.equal(result.delivery.fallback, false);
});

for (const [name, mutate] of [
  ["wrong identity", (payload) => ({ ...payload, instrument_id: "equity:nasdaq:msft" })],
  ["enabled execution", (payload) => ({ ...payload, execution_boundary: { ...payload.execution_boundary, submission_available: true } })],
  ["malformed candle", (payload) => ({ ...payload, candles: [{ ...payload.candles[0], high: 1 }] })],
  ["out-of-order candles", (payload) => ({ ...payload, candles: [...payload.candles].reverse() })],
]) {
  test(`listed-market chart fails closed on ${name}`, async () => {
    const result = await loadPublicInstrumentChart({
      env: ENV,
      query: "AAPL",
      instrumentId: "equity:nasdaq:aapl",
      timeframe: "1h",
      nowMs: NOW,
      fetchImpl: async () => jsonResponse(mutate(instrumentChartEnvelope())),
    });
    assert.equal(result.available, false);
    assert.equal(result.payload, null);
    assert.equal(result.delivery.reason, "instrument_chart_contract_rejected");
    assert.equal(result.delivery.fallback, false);
  });
}

test("listed-market chart rejects oversized responses", async () => {
  const result = await loadPublicInstrumentChart({
    env: ENV,
    query: "AAPL",
    instrumentId: "equity:nasdaq:aapl",
    timeframe: "1h",
    nowMs: NOW,
    fetchImpl: async () => jsonResponse(instrumentChartEnvelope(), { headers: { "content-length": String(513 * 1024) } }),
  });
  assert.equal(result.available, false);
  assert.equal(result.delivery.reason, "origin_payload_too_large");
});

test("listed-instrument lookup rejects invalid queries before network access", async () => {
  let called = false;
  const result = await loadPublicInstrumentLookup({
    env: ENV,
    query: "<script>alert(1)</script>",
    nowMs: NOW,
    fetchImpl: async () => {
      called = true;
      return jsonResponse(instrumentLookupEnvelope());
    },
  });
  assert.equal(called, false);
  assert.equal(result.available, false);
  assert.equal(result.delivery.reason, "invalid_instrument_query");
  assert.equal(result.delivery.fallback, false);
});

for (const [name, mutate, expectedReason] of [
  ["wrong query", (payload) => ({ ...payload, query: "MSFT" }), "instrument_lookup_contract_rejected"],
  ["wrong identity", (payload) => ({ ...payload, results: [{ ...payload.results[0], instrument_id: "equity:nasdaq:msft" }] }), "instrument_lookup_contract_rejected"],
  ["enabled execution", (payload) => ({ ...payload, results: [{ ...payload.results[0], capabilities: { ...payload.results[0].capabilities, execution: true } }] }), "instrument_lookup_contract_rejected"],
  ["enabled submission", (payload) => ({ ...payload, execution_boundary: { ...payload.execution_boundary, submission_available: true } }), "instrument_lookup_contract_rejected"],
]) {
  test(`listed-instrument lookup fails closed on ${name}`, async () => {
    const result = await loadPublicInstrumentLookup({
      env: ENV,
      query: "AAPL",
      nowMs: NOW,
      fetchImpl: async () => jsonResponse(mutate(instrumentLookupEnvelope())),
    });
    assert.equal(result.available, false);
    assert.equal(result.payload, null);
    assert.equal(result.delivery.reason, expectedReason);
    assert.equal(result.delivery.fallback, false);
  });
}

test("listed-instrument lookup rejects oversized responses", async () => {
  const result = await loadPublicInstrumentLookup({
    env: ENV,
    query: "AAPL",
    nowMs: NOW,
    fetchImpl: async () => jsonResponse(instrumentLookupEnvelope(), { headers: { "content-length": String(257 * 1024) } }),
  });
  assert.equal(result.available, false);
  assert.equal(result.delivery.reason, "origin_payload_too_large");
});

test("rejects protected-origin redirects without following them", async () => {
  const result = await loadPublicProjection({
    env: ENV,
    key: "brief",
    nowMs: NOW,
    fetchImpl: async () => new Response(null, {
      status: 302,
      headers: { location: "https://untrusted.example/brief.json" },
    }),
  });
  assert.equal(result.available, false);
  assert.equal(result.delivery.source, "unavailable");
  assert.equal(result.delivery.reason, "origin_redirect_rejected");
});

test("preserves a stale origin payload and labels its source timestamp honestly", async () => {
  const result = await loadPublicProjection({
    env: ENV,
    key: "brief",
    nowMs: NOW,
    fetchImpl: async () => jsonResponse(envelope({ generated_at: "2026-06-24T10:00:00Z" })),
  });
  assert.equal(result.delivery.source, "current_public_origin");
  assert.equal(result.delivery.freshness_state, "stale");
  assert.equal(result.delivery.fallback, false);
});

test("fails closed to an explicitly labeled embedded snapshot on contract mismatch", async () => {
  const fallbackPayload = envelope({ generated_at: "2026-07-12T00:00:00Z" });
  const result = await loadPublicProjection({
    env: ENV,
    key: "brief",
    fallbackPayload,
    nowMs: NOW,
    fetchImpl: async () => jsonResponse(envelope({ safe_public: false })),
  });
  assert.equal(result.available, true);
  assert.equal(result.delivery.source, "embedded_snapshot");
  assert.equal(result.delivery.freshness_state, "stale");
  assert.equal(result.delivery.fallback, true);
  assert.equal(result.delivery.reason, "origin_public_safety_mismatch");
});

test("reports unavailable when neither the origin nor a fallback is usable", async () => {
  const result = await loadPublicProjection({
    env: {},
    key: "brief",
    nowMs: NOW,
    fetchImpl: async () => {
      throw new Error("should not be called");
    },
  });
  assert.equal(result.available, false);
  assert.equal(result.delivery.source, "unavailable");
  assert.equal(result.delivery.freshness_state, "unavailable");
  assert.equal(result.delivery.reason, "origin_token_not_configured");
});

test("rejects oversized origin responses before parsing", async () => {
  const fallbackPayload = envelope({ generated_at: "2026-07-12T00:00:00Z" });
  const result = await loadPublicProjection({
    env: ENV,
    key: "brief",
    fallbackPayload,
    nowMs: NOW,
    fetchImpl: async () => jsonResponse(envelope(), { headers: { "content-length": String(600 * 1024) } }),
  });
  assert.equal(result.delivery.source, "embedded_snapshot");
  assert.equal(result.delivery.reason, "origin_payload_too_large");
});

test("cancels an oversized streamed origin response", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(513 * 1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  const result = await loadPublicProjection({
    env: ENV,
    key: "brief",
    fallbackPayload: envelope({ generated_at: "2026-07-12T00:00:00Z" }),
    nowMs: NOW,
    fetchImpl: async () => new Response(body, {
      headers: { "content-type": "application/json" },
    }),
  });
  assert.equal(result.delivery.source, "embedded_snapshot");
  assert.equal(result.delivery.reason, "origin_payload_too_large");
  assert.equal(cancelled, true);
});

test("freshness is derived from source generation time, not republish time", () => {
  const freshness = projectionFreshness({
    generated_at: "2026-06-24T10:00:00Z",
    updated_at: "2026-07-21T09:59:59Z",
    freshness_target_seconds: 900,
  }, { nowMs: NOW });
  assert.equal(freshness.state, "stale");
  assert.ok(freshness.age_seconds > 2_000_000);
});

test("control documents are schema checked and stripped of filesystem paths", async () => {
  const manifest = {
    schema_version: "ravenos_public_origin_manifest_v1",
    generated_at: "2026-07-21T09:59:59Z",
    safe_public: true,
    redaction_policy: "aggregate_public_market_context_only",
    endpoints: [{
      key: "brief",
      endpoint: "/api/brief",
      schema_version: "ravenos_brief_public_origin_v1",
      generated_at: "2026-07-21T09:59:30Z",
      payload_age_seconds: 30,
      freshness_target_seconds: 900,
      status: "published",
      source: "/srv/raven/app/private/data.json",
      target: "/srv/raven/app/data/public/brief.json",
    }],
    failed: [],
  };
  const result = await loadOriginControlDocument({
    env: ENV,
    key: "manifest",
    fetchImpl: async () => jsonResponse(manifest),
  });
  assert.equal(result.ok, true);
  const sanitized = sanitizeOriginControlDocument("manifest", result.payload);
  assert.equal(sanitized.endpoints[0].key, "brief");
  assert.equal("source" in sanitized.endpoints[0], false);
  assert.equal(JSON.stringify(sanitized).includes("/srv/"), false);
});
