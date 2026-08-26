import { createReadStream, existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import worker from "../worker.mjs";

const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const originToken = randomBytes(32).toString("hex");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function safeAssetPath(pathname) {
  const trimmed = pathname === "/" ? "/index.html" : pathname;
  const withIndex = trimmed.endsWith("/") ? `${trimmed}index.html` : trimmed;
  const normalized = normalize(withIndex).replace(/^(\.\.[/\\])+/, "");
  return join(root, normalized.replace(/^[/\\]+/, ""));
}

async function assetFetch(request) {
  const url = new URL(request.url);
  const path = safeAssetPath(url.pathname);
  if (!existsSync(path) || !statSync(path).isFile()) {
    return new Response("Not found", { status: 404 });
  }
  const body = await readFile(path);
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": MIME[extname(path)] || "application/octet-stream",
      "cache-control": "no-store",
    },
  });
}

const env = {
  ASSETS: {
    fetch: assetFetch,
  },
  RAVENOS_CUSTOMER_TRADE_UI_ENABLE: "1",
  RAVENOS_CUSTOMER_TRADE_QUOTE_ENABLE: "1",
  RAVENOS_CUSTOMER_TRADE_SOLANA_ENABLE: "1",
  RAVENOS_CUSTOMER_TRADE_FIXTURE_MODE: "1",
  RAVENOS_PUBLIC_ORIGIN_URL: `http://127.0.0.1:${port}/__playwright_public_origin`,
  RAVENOS_PUBLIC_ORIGIN_TOKEN: originToken,
};

const listedInstrumentFixtures = Object.freeze([
  Object.freeze({ symbol: "AAPL", name: "Apple Inc.", type: "equity", venue: "nasdaq", listing: "Nasdaq" }),
  Object.freeze({ symbol: "SPY", name: "State Street SPDR S&P 500 ETF Trust", type: "etf", venue: "nyse-arca", listing: "NYSE Arca" }),
  Object.freeze({ symbol: "QQQ", name: "Invesco QQQ Trust", type: "etf", venue: "nasdaq", listing: "Nasdaq" }),
]);

function listedInstrument(row) {
  const instrumentId = `${row.type}:${row.venue}:${row.symbol.toLowerCase()}`;
  return {
    schema_version: "ravenos.instrument.v1",
    instrument_id: instrumentId,
    symbol: row.symbol,
    display_name: row.name,
    asset_class: row.type,
    instrument_type: row.type,
    identity_scope: "exact_instrument",
    venue: row.venue,
    chain: "none",
    market_identity: { market_id: row.symbol, listing: row.listing },
    base_asset: { symbol: row.symbol, asset_id: row.symbol },
    quote_asset: { symbol: "USD", asset_id: "USD" },
    settlement_asset: { symbol: "USD", asset_id: "USD" },
    preferred_cash_asset: { symbol: "USD", asset_id: "USD" },
    economic_numeraire: "USDC",
    chart_source: "ravenos_terminal_chart",
    market_session: { state: "open", timezone: "America/New_York", observed_at: new Date().toISOString() },
    capabilities: {
      chart: true,
      live_price: true,
      atlas_intelligence: false,
      raven_intelligence: false,
      options_summary: false,
      quote_preview: false,
      execution: false,
    },
    route_compatibility: ["inspect"],
    account_compatibility: [],
  };
}

function instrumentLookupFixture(query) {
  const normalized = String(query || "").trim().toLowerCase();
  const generatedAt = new Date().toISOString();
  const results = listedInstrumentFixtures
    .filter((row) => `${row.symbol} ${row.name}`.toLowerCase().includes(normalized))
    .map(listedInstrument);
  return {
    ok: true,
    safe_public: true,
    redaction_policy: "aggregate_public_market_context_only",
    schema_version: "ravenos.instrument_lookup.v1",
    generated_at: generatedAt,
    freshness_target_seconds: 300,
    query: String(query || "").trim(),
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

function instrumentChartFixture(query, instrumentId, timeframe = "1h", limit = 360) {
  const symbol = String(query || "").trim().toUpperCase();
  const fixture = listedInstrumentFixtures.find((row) => row.symbol === symbol);
  const instrument = fixture ? listedInstrument(fixture) : null;
  if (!instrument || instrument.instrument_id !== String(instrumentId || "").trim().toLowerCase()) return null;
  const count = Math.max(2, Math.min(Number(limit) || 360, 96));
  const intervalSeconds = timeframe === "5m" ? 300 : timeframe === "15m" ? 900 : timeframe === "4h" ? 14_400 : timeframe === "1d" ? 86_400 : 3_600;
  const lastTime = Math.floor(Date.now() / 1_000 / intervalSeconds) * intervalSeconds;
  const candles = Array.from({ length: count }, (_, index) => {
    const base = symbol === "SPY" ? 700 : symbol === "QQQ" ? 620 : 210;
    const close = base + index * 0.15;
    return {
      time: lastTime - (count - index - 1) * intervalSeconds,
      open: close - 0.1,
      high: close + 0.4,
      low: close - 0.4,
      close,
      volume: 10_000 + index * 100,
    };
  });
  const generatedAt = new Date().toISOString();
  return {
    ok: true,
    safe_public: true,
    redaction_policy: "aggregate_public_market_context_only",
    schema_version: "ravenos.instrument_chart.v1",
    generated_at: generatedAt,
    freshness_target_seconds: 300,
    query: symbol,
    instrument_id: instrument.instrument_id,
    timeframe,
    provider: "Yahoo Finance",
    identity_provider: "Tradier",
    instrument,
    candles,
    market_data_observed_at: new Date(candles.at(-1).time * 1_000).toISOString(),
    execution_boundary: {
      broker_connection_available: false,
      quote_preview_available: false,
      signing_available: false,
      submission_available: false,
      position_monitoring_available: false,
    },
  };
}

function atlasFixture() {
  const generatedAt = new Date().toISOString();
  const spy = listedInstrument(listedInstrumentFixtures[1]);
  spy.capabilities.atlas_intelligence = true;
  spy.capabilities.options_summary = true;
  return {
    ok: true,
    safe_public: true,
    key: "atlas",
    schema_version: "ravenos_atlas_public_origin_v1",
    generated_at: generatedAt,
    updated_at: generatedAt,
    source_artifact: "playwright_atlas_projection",
    freshness_target_seconds: 1800,
    redaction_policy: "aggregate_public_market_context_only",
    data: {
      schema_version: "ravenos.atlas_projection.v1",
      generated_at: generatedAt,
      freshness: { state: "fresh", age_seconds: 0, target_seconds: 1800 },
      state: "available",
      posture: { state: "balanced", confidence: "forming", alignment: "mixed" },
      market_context: {
        risk_regime: "balanced",
        equity_regime: "mixed",
        sector_breadth: "mixed",
        participation_quality: "forming",
        rows: [{ instrument_id: spy.instrument_id, instrument: spy, symbol: spy.symbol, price: 742.09, provider: "Test projection", observed_at: generatedAt }],
      },
      options_context: [],
      provider_health: {},
      capabilities: { market_map: true, options_summary: true, browser_provider_credentials: false },
      execution_boundary: { research_only: true, broker_connection_available: false, signing_available: false, submission_available: false, position_monitoring_available: false },
      public_safety: { aggregate_only: true, provider_payloads_removed: true, provider_urls_removed: true, credentials_removed: true, paper_engine_removed: true, proprietary_calibration_removed: true },
      unavailable: {},
    },
  };
}

async function servePublicOriginFixture(req, res) {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
  if (!url.pathname.startsWith("/__playwright_public_origin/")) return false;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
    return true;
  }
  if (req.headers["x-ravenos-public-token"] !== originToken) {
    res.statusCode = 401;
    res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
    return true;
  }
  if (url.pathname === "/__playwright_public_origin/instrument_lookup.json") {
    res.statusCode = 200;
    res.end(JSON.stringify(instrumentLookupFixture(url.searchParams.get("q") || "")));
    return true;
  }
  if (url.pathname === "/__playwright_public_origin/instrument_chart.json") {
    const payload = instrumentChartFixture(
      url.searchParams.get("q") || "",
      url.searchParams.get("instrument_id") || "",
      url.searchParams.get("timeframe") || "1h",
      url.searchParams.get("limit") || "360",
    );
    res.statusCode = payload ? 200 : 503;
    res.end(JSON.stringify(payload || { ok: false, error: "instrument_chart_unavailable", candles: [] }));
    return true;
  }
  if (url.pathname === "/__playwright_public_origin/atlas.json") {
    res.statusCode = 200;
    res.end(JSON.stringify(atlasFixture()));
    return true;
  }
  if (["/__playwright_public_origin/behavior.json", "/__playwright_public_origin/perps.json"].includes(url.pathname)) {
    const filename = url.pathname.endsWith("behavior.json") ? "behavior.json" : "perps.json";
    const payload = JSON.parse(await readFile(join(root, "ravenos", filename), "utf8"));
    const generatedAt = new Date().toISOString();
    payload.generated_at = generatedAt;
    payload.updated_at = generatedAt;
    payload.data = { ...payload.data, generated_at: generatedAt, source_generated_at: generatedAt };
    res.statusCode = 200;
    res.end(JSON.stringify(payload));
    return true;
  }
  if (url.pathname !== "/__playwright_public_origin/opportunities.json") {
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: "fixture_not_found" }));
    return true;
  }
  const payload = JSON.parse(await readFile(join(root, "ravenos", "opportunities.json"), "utf8"));
  const generatedAt = new Date().toISOString();
  payload.generated_at = generatedAt;
  payload.updated_at = generatedAt;
  payload.data = {
    ...payload.data,
    generated_at: generatedAt,
    source_state: "current",
    source_age_seconds: 0,
    opportunities: {
      ...payload.data?.opportunities,
      rows: (payload.data?.opportunities?.rows || []).map((row) => ({
        ...row,
        decision_at: generatedAt,
        context_age_seconds: 0,
        context_state: "fresh",
      })),
    },
    attention_benchmark: {
      schema_version: "ravenos_market_attention_benchmark_public_v1",
      generated_at: generatedAt,
      freshness: { state: "current", age_seconds: 0, target_seconds: 3_600 },
      public_safety: {
        market_addresses_exposed: false,
        participant_identities_exposed: false,
        private_lineage_exposed: false,
        raw_reference_payloads_exposed: false,
        reference_source_identity_exposed: false,
      },
      interpretation: {
        headline: "Raven frequently observed the market before broader attention arrived.",
        scope: "Descriptive timing overlap in the retained benchmark only.",
        profitability_claimed: false,
        selected_instrument_claimed: false,
        tradeable_rule_claimed: false,
      },
      reference_scope: {
        episode_count: 3_799,
        distinct_markets: 3_460,
        label: "Third-party market-attention episodes",
        deduplication: "Exact chain and market identity within a thirty-minute attention session",
      },
      raven_lead: {
        observation: { episodes: 745, label: "Raven observation", median_lead_seconds: 2_206.45, share_of_reference_episodes: 745 / 3_799 },
        behavior: { episodes: 555, label: "Behavioral change", median_lead_seconds: 8_259.73, share_of_reference_episodes: 555 / 3_799 },
        exact_decision_context: { episodes: 109, label: "Exact market and friction context", median_lead_seconds: 3_872, share_of_reference_episodes: 109 / 3_799 },
      },
    },
  };
  res.statusCode = 200;
  res.end(JSON.stringify(payload));
  return true;
}

const server = createServer(async (req, res) => {
  try {
    if (await servePublicOriginFixture(req, res)) return;
    const request = new Request(`http://127.0.0.1:${port}${req.url || "/"}`, {
      method: req.method,
      headers: req.headers,
      body: req.method && !["GET", "HEAD"].includes(req.method) ? req : undefined,
      duplex: req.method && !["GET", "HEAD"].includes(req.method) ? "half" : undefined,
    });
    const response = await worker.fetch(request, env);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (!response.body) {
      res.end();
      return;
    }
    const stream = response.body.getReader();
    async function pump() {
      while (true) {
        const { done, value } = await stream.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    }
    await pump();
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: "playwright_server_failure", message: error instanceof Error ? error.message : String(error) }));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`RavenOS Playwright terminal server listening on http://127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
