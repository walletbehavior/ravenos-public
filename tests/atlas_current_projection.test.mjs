import assert from "node:assert/strict";
import test from "node:test";

import worker from "../worker.mjs";

const ORIGIN = "https://origin.example/public/ravenos";
const TOKEN = "server-only-atlas-test-token";

function isoAgo(seconds) {
  return new Date(Date.now() - seconds * 1_000).toISOString();
}

function atlasData(overrides = {}) {
  return {
    schema_version: "ravenos.atlas_projection.v1",
    generated_at: isoAgo(10),
    freshness: { state: "fresh", age_seconds: 10, target_seconds: 1800 },
    state: "available",
    posture: { state: "caution", confidence: "low", alignment: "fragmented" },
    market_context: {
      risk_regime: "risk_off",
      equity_regime: "down",
      sector_breadth: "mixed",
      participation_quality: "weak",
      rows: [{
        instrument_id: "etf:nyse-arca:spy",
        instrument: {
          schema_version: "ravenos.instrument.v1",
          instrument_id: "etf:nyse-arca:spy",
          symbol: "SPY",
          asset_class: "etf",
          instrument_type: "etf",
          identity_scope: "exact_instrument",
          venue: "nyse-arca",
          chain: "none",
          settlement_asset: { symbol: "USD", asset_id: "USD" },
          economic_numeraire: "USDC",
          capabilities: { chart: true, atlas_intelligence: true, options_summary: true, execution: false },
        },
        symbol: "SPY",
        price: 742.09,
        provider: "Massive",
        observed_at: isoAgo(10),
      }],
    },
    options_context: [{ underlying: "SPY", underlying_instrument_id: "etf:nyse-arca:spy", provider: "Tradier", delayed: true }],
    provider_health: {},
    capabilities: { market_map: true, options_summary: true, browser_provider_credentials: false },
    execution_boundary: { research_only: true, broker_connection_available: false, signing_available: false, submission_available: false, position_monitoring_available: false },
    public_safety: { aggregate_only: true, provider_payloads_removed: true, provider_urls_removed: true, credentials_removed: true, paper_engine_removed: true, proprietary_calibration_removed: true },
    unavailable: {},
    ...overrides,
  };
}

function envelope({ generatedAt = isoAgo(10), data = atlasData(), envelopeOverrides = {} } = {}) {
  return {
    ok: true,
    safe_public: true,
    key: "atlas",
    schema_version: "ravenos_atlas_public_origin_v1",
    generated_at: generatedAt,
    updated_at: isoAgo(2),
    source_artifact: "atlas_public_projection",
    freshness_target_seconds: 1800,
    redaction_policy: "aggregate_public_market_context_only",
    data,
    ...envelopeOverrides,
  };
}

function listedInstrument(overrides = {}) {
  return {
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
    capabilities: {
      chart: true,
      live_price: true,
      atlas_intelligence: false,
      quote_preview: false,
      execution: false,
    },
    ...overrides,
  };
}

function instrumentLookup({ query = "AAPL", rows = [listedInstrument()], generatedAt = isoAgo(10), overrides = {} } = {}) {
  return {
    ok: true,
    safe_public: true,
    redaction_policy: "aggregate_public_market_context_only",
    schema_version: "ravenos.instrument_lookup.v1",
    generated_at: generatedAt,
    freshness_target_seconds: 300,
    query,
    provider: "Tradier",
    results: rows,
    execution_boundary: {
      broker_connection_available: false,
      quote_preview_available: false,
      signing_available: false,
      submission_available: false,
    },
    ...overrides,
  };
}

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function env() {
  return {
    RAVENOS_PUBLIC_ORIGIN_URL: ORIGIN,
    RAVENOS_PUBLIC_ORIGIN_TOKEN: TOKEN,
    ASSETS: {
      async fetch() {
        return response(envelope({ data: atlasData({ posture: { state: "embedded must not ship" } }) }));
      },
    },
  };
}

async function withOrigin(handler, callback) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(String(url), `${ORIGIN}/atlas.json`);
    assert.equal(init.headers?.["x-ravenos-public-token"], TOKEN);
    return handler(url, init);
  };
  try {
    return await callback();
  } finally {
    globalThis.fetch = previous;
  }
}

async function requestAtlas() {
  return worker.fetch(new Request("https://ravenos.xyz/api/atlas"), env());
}

async function requestInstrumentSearch(query = "AAPL") {
  return worker.fetch(new Request(`https://ravenos.xyz/api/instruments/search?q=${encodeURIComponent(query)}`), env());
}

test("current fresh Atlas projection preserves exact ETF identity and safety boundary", async () => {
  await withOrigin(async () => response(envelope()), async () => {
    const result = await requestAtlas();
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("x-ravenos-data-source"), "current_public_origin");
    assert.equal(result.headers.get("x-ravenos-freshness"), "fresh");
    const body = await result.json();
    assert.equal(body.schema_version, "ravenos.atlas_projection.v1");
    assert.equal(body.market_context.rows[0].instrument_id, "etf:nyse-arca:spy");
    assert.equal(body.market_context.rows[0].instrument.settlement_asset.symbol, "USD");
    assert.equal(body.market_context.rows[0].instrument.economic_numeraire, "USDC");
    assert.equal(body.execution_boundary.signing_available, false);
    assert.equal(body.execution_boundary.submission_available, false);
    assert.equal(body.delivery.fallback, false);
    assert.equal(JSON.stringify(body).includes(TOKEN), false);
  });
});

for (const [name, handler] of [
  ["origin unavailable", async () => response({ ok: false }, 503)],
  ["origin missing endpoint", async () => response({ ok: false }, 404)],
  ["stale origin", async () => response(envelope({ generatedAt: isoAgo(20_000) }))],
]) {
  test(`${name} produces 503 and never uses an embedded Atlas snapshot`, async () => {
    await withOrigin(handler, async () => {
      const result = await requestAtlas();
      assert.equal(result.status, 503);
      const body = await result.json();
      assert.equal(body.error, "atlas_projection_unavailable");
      assert.equal(body.atlas, null);
      assert.equal(body.historical_context_substituted, false);
      assert.equal(JSON.stringify(body).includes("embedded must not ship"), false);
    });
  });
}

test("malformed exact identity or an enabled execution capability rejects the whole projection", async () => {
  const malformed = atlasData();
  malformed.market_context.rows[0].instrument.instrument_id = "etf:nasdaq:qqq";
  malformed.market_context.rows[0].instrument.capabilities.execution = true;
  await withOrigin(async () => response(envelope({ data: malformed })), async () => {
    const result = await requestAtlas();
    assert.equal(result.status, 503);
    const body = await result.json();
    assert.equal(body.error, "atlas_projection_unavailable");
  });
});

test("Atlas browser-facing response contains no private provider or credential structures", async () => {
  await withOrigin(async () => response(envelope()), async () => {
    const body = await (await requestAtlas()).json();
    const publicText = JSON.stringify(body).toLowerCase();
    for (const forbidden of ["provider_debug", "quote_url", "api_key", "tradier_production", "massive_csv", "/srv/", TOKEN.toLowerCase()]) {
      assert.equal(publicText.includes(forbidden), false, forbidden);
    }
  });
});

test("current listed-market search returns exact Tradier identity without exposing the origin token", async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init = {}) => {
      assert.equal(String(url), `${ORIGIN}/instrument_lookup.json?q=AAPL`);
      assert.equal(init.headers?.["x-ravenos-public-token"], TOKEN);
      return response(instrumentLookup());
    };
    const result = await requestInstrumentSearch();
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("x-ravenos-data-source"), "current_public_origin");
    assert.equal(result.headers.get("x-ravenos-freshness"), "fresh");
    const body = await result.json();
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].instrument_id, "equity:nasdaq:aapl");
    assert.equal(body.results[0].market_identity.listing, "Nasdaq");
    assert.equal(body.results[0].settlement_asset.symbol, "USD");
    assert.equal(body.results[0].economic_numeraire, "USDC");
    assert.equal(body.results[0].capabilities.execution, false);
    assert.equal(body.delivery.fallback, false);
    assert.equal(JSON.stringify(body).includes(TOKEN), false);
  } finally {
    globalThis.fetch = previous;
  }
});

for (const [name, originResponse] of [
  ["origin unavailable", () => response({ ok: false }, 503)],
  ["origin endpoint missing", () => response({ ok: false }, 404)],
  ["origin stale", () => response(instrumentLookup({ generatedAt: isoAgo(5_000) }))],
  ["origin malformed", () => response(instrumentLookup({ rows: [{ ...listedInstrument(), capabilities: { execution: true } }] }))],
]) {
  test(`listed-market search fails closed when ${name}`, async () => {
    const previous = globalThis.fetch;
    try {
      globalThis.fetch = async () => originResponse();
      const result = await requestInstrumentSearch();
      assert.equal(result.status, 503);
      const body = await result.json();
      assert.equal(body.error, "instrument_lookup_unavailable");
      assert.deepEqual(body.results, []);
      assert.equal(body.delivery.fallback, false);
    } finally {
      globalThis.fetch = previous;
    }
  });
}

test("dynamic equity chart re-verifies exact listing identity before requesting provider candles", async () => {
  const previous = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input?.url || input);
      calls.push(url);
      if (url === `${ORIGIN}/instrument_lookup.json?q=AAPL`) {
        assert.equal(init.headers?.["x-ravenos-public-token"], TOKEN);
        return response(instrumentLookup());
      }
      if (url.includes("query1.finance.yahoo.com/v8/finance/chart/AAPL")) {
        return response({
          chart: {
            result: [{
              timestamp: [1_800_000_000, 1_800_003_600],
              indicators: { quote: [{ open: [210, 211], high: [212, 213], low: [209, 210], close: [211, 212], volume: [100, 120] }] },
            }],
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    };
    const result = await worker.fetch(new Request("https://ravenos.xyz/api/terminal/chart?market=equities&asset=AAPL&timeframe=1h&instrument_id=equity%3Anasdaq%3Aaapl"), env());
    assert.equal(result.status, 200);
    const body = await result.json();
    const payload = body.data || body;
    assert.equal(payload.ok, true);
    assert.equal(payload.market_identity, "equity:nasdaq:aapl");
    assert.equal(payload.instrument.canonical_id, "equity:nasdaq:aapl");
    assert.equal(payload.instrument.venue, "nasdaq");
    assert.equal(payload.candles.length, 2);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = previous;
  }
});

test("dynamic equity chart refuses an identity mismatch without calling the candle provider", async () => {
  const previous = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (input) => {
      const url = String(input?.url || input);
      calls.push(url);
      return response(instrumentLookup());
    };
    const result = await worker.fetch(new Request("https://ravenos.xyz/api/terminal/chart?market=equities&asset=AAPL&timeframe=1h&instrument_id=equity%3Anasdaq%3Amsft"), env());
    assert.equal(result.status, 200);
    const body = await result.json();
    const payload = body.data || body;
    assert.equal(payload.ok, false);
    assert.equal(payload.source_type, "identity_mismatch");
    assert.equal(payload.candles.length, 0);
    assert.deepEqual(calls, [`${ORIGIN}/instrument_lookup.json?q=AAPL`]);
  } finally {
    globalThis.fetch = previous;
  }
});
