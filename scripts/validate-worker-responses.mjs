import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

import worker from "../worker.mjs";
import { scanJsonValue, scanPublicTextFile } from "./validate-public-no-leak.mjs";

const repoRoot = process.cwd();
const deployRoot = join(repoRoot, ".deploy-public");

const assets = {
  async fetch(request) {
    const pathname = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, "");
    const normalized = normalize(pathname || "index.html");
    if (normalized.startsWith("..")) return new Response("not found", { status: 404 });
    try {
      const body = await readFile(join(deployRoot, normalized));
      const type = extname(normalized) === ".json" ? "application/json" : "application/octet-stream";
      return new Response(body, { headers: { "content-type": type } });
    } catch {
      return new Response("not found", { status: 404 });
    }
  },
};

const env = {
  ASSETS: assets,
  ONCHAIN_CHART_PROVIDER: "coingecko",
  ONCHAIN_CHART_PROVIDER_PLAN: "demo",
  ONCHAIN_CHART_PROVIDER_COMMERCIAL: "false",
  ONCHAIN_CHART_PROVIDER_SECRET: "worker-response-provider-validation-token",
  RAVENOS_PUBLIC_ORIGIN_URL: "https://validation-origin.example/public/ravenos",
  RAVENOS_PUBLIC_ORIGIN_TOKEN: "worker-response-validation-token",
  RAVENOS_SPOT_CHART_ORIGIN_URL: "https://validation-origin.example/public/ravenos/chart.json",
  RAVENOS_SPOT_CHART_ORIGIN_TOKEN: "worker-response-validation-token",
};
const checks = [
  ["GET", "/api/health"],
  ["GET", "/api/status"],
  ["GET", "/api/brief"],
  ["GET", "/api/replay"],
  ["GET", "/api/outcomes"],
  ["GET", "/api/memory"],
  ["GET", "/api/behavior"],
  ["GET", "/api/perps"],
  ["GET", "/api/perps/instrument?symbol=SOL"],
  ["GET", "/api/hyperliquid/instrument?symbol=SOL"],
  ["GET", "/api/research"],
  ["GET", "/api/claims/not-a-real-claim"],
  ["GET", "/api/opportunity"],
  ["GET", "/api/atlas"],
  ["GET", "/api/instruments/search?q=AAPL"],
  ["GET", "/api/terminal/chart?market=equities&asset=AAPL&timeframe=1h&instrument_id=equity%3Anasdaq%3Aaapl"],
  ["GET", "/api/terminal/chart?market=crypto_spot&asset=TEST%2FUSDC&timeframe=15m&chain=base&pair_address=0x1111111111111111111111111111111111111111&token_address=0x2222222222222222222222222222222222222222"],
  ["GET", "/api/terminal"],
  ["GET", "/api/chains/solana"],
  ["GET", "/api/chains/base"],
  ["GET", "/api/chains/ethereum"],
  ["GET", "/api/trade/flags"],
  ["GET", "/api/access"],
  ["GET", "/api/not-a-route"],
  ["POST", "/api/trade/quote", {}],
  ["POST", "/api/trade/inspect", {}],
  ["POST", "/api/stripe/checkout", {}],
];

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url || input);
  if (url.includes("validation-origin.example/public/ravenos/chart.json")) {
    const now = Math.floor(Date.now() / 900_000) * 900;
    return new Response(JSON.stringify({
      schema_version: "ravenos.spot_chart_projection.v1",
      ok: true,
      chain: "base",
      instrument_scope: "exact_pool",
      pair_address: "0x1111111111111111111111111111111111111111",
      token_address: "0x2222222222222222222222222222222222222222",
      quote_address: "0x3333333333333333333333333333333333333333",
      price_unit: "quote_per_token",
      source: "Raven EVM exact swap",
      freshness_state: "live",
      observed_at: new Date(now * 1_000).toISOString(),
      available_scopes: { exact_pool: true, token_aggregate: false },
      lineage: {
        identity_scope: "exact_pool",
        latest_source_event_id: "private:event:123",
        latest_source_name: "private-source.json",
        source_registry_paths: ["/srv/raven/app/data/runtime/private-registry.json"],
      },
      recent_trades: [{ id: "raven-event", time: now - 900, price: 1, size: 1, side: "buy" }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("api.dexpaprika.com") && url.includes("/ohlcv?")) {
    const now = Math.floor(Date.now() / 900_000) * 900;
    const rows = Array.from({ length: 120 }, (_, index) => ({
      time_open: new Date((now - (119 - index) * 900) * 1_000).toISOString(),
      open: 1,
      high: 1.1,
      low: 0.9,
      close: 1.05,
      volume: 10,
    }));
    return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("api.dexpaprika.com/networks/base/pools/0x1111111111111111111111111111111111111111")) {
    return new Response(JSON.stringify({
      id: "0x1111111111111111111111111111111111111111",
      chain: "base",
      dex_id: "validation_pool",
      created_at: "2024-01-01T00:00:00Z",
      base_token_id: "0x2222222222222222222222222222222222222222",
      quote_token_id: "0x3333333333333333333333333333333333333333",
      liquidity_usd: 100_000,
      tokens: [
        { id: "0x2222222222222222222222222222222222222222", symbol: "TEST" },
        { id: "0x3333333333333333333333333333333333333333", symbol: "USDC" },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("api.coingecko.com/api/v3/onchain")) {
    if (init.headers?.["x-cg-demo-api-key"] !== env.ONCHAIN_CHART_PROVIDER_SECRET) throw new Error("server-only provider credential was not bound to the provider request");
    if (url.includes(env.ONCHAIN_CHART_PROVIDER_SECRET)) throw new Error("provider credential entered the request URL");
    if (!url.includes("/ohlcv/")) {
      return new Response(JSON.stringify({
        data: {
          id: "base_0x1111111111111111111111111111111111111111",
          type: "pool",
          attributes: { address: "0x1111111111111111111111111111111111111111" },
          relationships: {
            base_token: { data: { id: "base_0x2222222222222222222222222222222222222222" } },
            quote_token: { data: { id: "base_0x3333333333333333333333333333333333333333" } },
          },
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const now = Math.floor(Date.now() / 900_000) * 900;
    const rows = Array.from({ length: 120 }, (_, index) => [now - (119 - index) * 900, 1, 1.1, 0.9, 1.05, 10]);
    return new Response(JSON.stringify({ data: { attributes: { ohlcv_list: rows } } }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("api.dexscreener.com")) {
    return new Response(JSON.stringify({ pairs: [] }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/instrument_chart.json?q=AAPL&instrument_id=equity%3Anasdaq%3Aaapl&timeframe=1h&limit=360")) {
    const lastTime = Math.floor(Date.now() / 1_000) - 60;
    return new Response(JSON.stringify({
      ok: true,
      safe_public: true,
      redaction_policy: "aggregate_public_market_context_only",
      schema_version: "ravenos.instrument_chart.v1",
      generated_at: new Date().toISOString(),
      freshness_target_seconds: 300,
      query: "AAPL",
      instrument_id: "equity:nasdaq:aapl",
      timeframe: "1h",
      provider: "Yahoo Finance",
      identity_provider: "Tradier",
      instrument: {
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
        quote_asset: { symbol: "USD", asset_id: "USD" },
        settlement_asset: { symbol: "USD", asset_id: "USD" },
        capabilities: { chart: true, live_price: true, quote_preview: false, execution: false },
      },
      candles: [
        { time: lastTime - 3600, open: 210, high: 212, low: 209, close: 211, volume: 100 },
        { time: lastTime, open: 211, high: 213, low: 210, close: 212, volume: 120 },
      ],
      market_data_observed_at: new Date(lastTime * 1_000).toISOString(),
      provider_debug: { credential: "must-be-stripped" },
      execution_boundary: { broker_connection_available: false, quote_preview_available: false, signing_available: false, submission_available: false, position_monitoring_available: false },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/instrument_lookup.json?q=AAPL")) {
    return new Response(JSON.stringify({
      ok: true,
      safe_public: true,
      redaction_policy: "aggregate_public_market_context_only",
      schema_version: "ravenos.instrument_lookup.v1",
      generated_at: new Date().toISOString(),
      freshness_target_seconds: 300,
      query: "AAPL",
      provider: "Tradier",
      provider_debug: { credential: "must-be-stripped" },
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
        quote_asset: { symbol: "USD", asset_id: "USD" },
        settlement_asset: { symbol: "USD", asset_id: "USD" },
        capabilities: { chart: true, live_price: true, quote_preview: false, execution: false },
        provider_payload: { credential: "must-be-stripped" },
      }],
      execution_boundary: { broker_connection_available: false, quote_preview_available: false, signing_available: false, submission_available: false },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify({ ok: false }), {
    status: 503,
    headers: { "content-type": "application/json" },
  });
};

const findings = [];
try {
  for (const [method, path, body] of checks) {
    const request = new Request(`https://ravenos.xyz${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const response = await worker.fetch(request, env);
    const text = await response.text();
    const label = `worker:${method}:${path}:${response.status}`;
    if (text.includes(env.ONCHAIN_CHART_PROVIDER_SECRET)) findings.push({ file: label, path: "", term: "provider_secret_value" });
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      try {
        findings.push(...scanJsonValue(JSON.parse(text), label));
      } catch {
        findings.push({ file: label, path: "", term: "invalid_json_response" });
      }
    } else {
      findings.push(...scanPublicTextFile(text, `${label}.txt`));
    }
  }
} finally {
  globalThis.fetch = originalFetch;
}

if (findings.length) {
  for (const finding of findings) console.error(`file=${finding.file} path=${finding.path || ""} term=${finding.term}`);
  console.error(`RavenOS Worker response no-leak validation failed: ${findings.length} finding(s).`);
  process.exit(1);
}

console.log(`Validated Worker responses: routes=${checks.length} public_no_leak=true`);
