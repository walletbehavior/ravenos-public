import { accessConfig, fetchSplTokenBalance, resolveAccessFromSignals } from "./lib/ravenos_access.mjs";
import {
  findSubscriptionStatus,
  subscriptionActiveFromRow,
  subscriptionConfig,
} from "./lib/ravenos_subscriptions.mjs";
import { processStripeWebhookEvent } from "./lib/ravenos_stripe_webhooks.mjs";
import { verifyWalletSignature, walletAuthMessage } from "./lib/solana_wallet_auth.mjs";
import { normalizeHyperliquidPerps } from "./lib/ravenos_perps_intelligence.mjs";
import {
  normalizeHyperliquidBook,
  normalizeHyperliquidCoin,
  normalizeHyperliquidTrades,
} from "./lib/hyperliquid_market.mjs";
import { buildPerpTerminalContext } from "./lib/perp_terminal_context.mjs";
import {
  attachDelivery,
  loadOriginControlDocument,
  loadPublicProjection,
  projectionFreshness,
  projectionHeaders,
  sanitizeOriginControlDocument,
} from "./lib/ravenos_public_origin.mjs";
import {
  CHART_INSTRUMENT_TYPES,
  normalizeChartInstrument,
} from "./ravenos-chart-data-plane.js";
import { resolveCustomerTradeFlags } from "./lib/customer_trade/feature_flags.mjs";
import { getDirectSolanaQuote } from "./lib/customer_trade/quote_service.mjs";
import { buildSolanaTransactionInspection } from "./lib/customer_trade/inspection_service.mjs";
import { createAndPersistReviewPacket, lookupReviewPacket } from "./lib/customer_trade/review_packets.mjs";
import {
  applyAssetSecurityHeaders,
  boundedJsonResponse,
  buildTerminalHealthProjection,
  byteLengthUtf8,
  createTerminalRequestContext,
  finishTerminalRequestContext,
  getTerminalDiagnosticsSummary,
  parseBoundedJsonBody,
  recordProviderComponentEvent,
  routeBudget,
  runProviderOperation,
  withOperationBudget,
} from "./lib/customer_trade/terminal_runtime.mjs";

const dexCache = new Map();
const hyperliquidCache = new Map();
const terminalChartCache = new Map();
const DEXSCREENER_BASE_URL = "https://api.dexscreener.com";
const GECKOTERMINAL_BASE_URL = "https://api.geckoterminal.com/api/v2";
const HYPERLIQUID_INFO_URL = "https://api.hyperliquid.xyz/info";
const YAHOO_CHART_BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const DEFAULT_RAVENOS_SPOT_CHART_ORIGIN_URL = "https://ravenos-public-origin.ravenos.xyz/public/ravenos/chart.json";
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const EVM_CHAINS = ["base", "ethereum", "arbitrum", "optimism", "bsc", "polygon"];
const QUOTE_RANK = { USDC: 90, USDT: 85, SOL: 80, WETH: 80, ETH: 75, WSOL: 75 };
const CHAIN_ROUTE_MAP = {
  solana: { aliases: ["solana"], label: "Solana" },
  base: { aliases: ["base"], label: "Base" },
  ethereum: { aliases: ["eth", "ethereum"], label: "Ethereum" },
};
const GECKOTERMINAL_NETWORKS = Object.freeze({
  solana: "solana",
  base: "base",
  ethereum: "eth",
  eth: "eth",
  avalanche: "avax",
  avax: "avax",
});

function json(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {}),
    },
  });
}

function terminalJson(context, payload, init = {}, {
  resultCategory = null,
  degradedReason = null,
  providerComponent = null,
  fallbackPayload = null,
} = {}) {
  const budget = routeBudget(context?.route || "");
  const response = boundedJsonResponse(payload, init, {
    max_bytes: budget.max_response_bytes,
    fallback_payload: fallbackPayload,
  });
  const statusCode = Number(response.status || init.status || 200);
  finishTerminalRequestContext(context, {
    status_code: statusCode,
    result_category: resultCategory || (statusCode >= 200 && statusCode < 400 ? "ok" : "error"),
    degraded_reason: degradedReason,
    response_bytes: byteLengthUtf8(JSON.stringify(payload)),
    provider_component: providerComponent,
  });
  return response;
}

async function terminalBuildId(env, request) {
  const buildPayload = env.ASSETS ? await readAssetPayload(env, request, "/ravenos_build.json") : null;
  return String(env.RAVENOS_PUBLIC_BUILD_ID || buildPayload?.public_build_id || "");
}

async function assetJson(env, request, assetPath, fallback = {}) {
  const assetResponse = await env.ASSETS.fetch(new Request(new URL(assetPath, request.url).toString(), { method: "GET" }));
  if (!assetResponse.ok) return json({ ok: false, error: "asset_unavailable", ...fallback }, { status: 503 });
  const payload = await assetResponse.json().catch(() => null);
  if (!payload || typeof payload !== "object") return json({ ok: false, error: "asset_invalid_json", ...fallback }, { status: 503 });
  return json(payload);
}

async function readAssetPayload(env, request, assetPath) {
  if (!env?.ASSETS || typeof env.ASSETS.fetch !== "function") return null;
  const assetResponse = await env.ASSETS.fetch(new Request(new URL(assetPath, request.url).toString(), { method: "GET" }));
  if (!assetResponse.ok) return null;
  const payload = await assetResponse.json().catch(() => null);
  return payload && typeof payload === "object" ? payload : null;
}

async function readPublicProjection(env, request, key, assetPath = `/ravenos/${key}.json`) {
  const fallbackPayload = await readAssetPayload(env, request, assetPath);
  return loadPublicProjection({ env, key, fallbackPayload });
}

function aggregateDeliveries(results = []) {
  const deliveries = results.map((result) => result?.delivery).filter(Boolean);
  const rank = { fresh: 0, delayed: 1, stale: 2, unavailable: 3 };
  const freshnessState = deliveries.reduce((worst, delivery) => (
    (rank[delivery.freshness_state] ?? 3) > (rank[worst] ?? 3) ? delivery.freshness_state : worst
  ), deliveries.length ? "fresh" : "unavailable");
  const sources = [...new Set(deliveries.map((delivery) => delivery.source))];
  return {
    schema_version: "ravenos.delivery-set.v1",
    source: sources.length === 1 ? sources[0] : sources.length ? "mixed" : "unavailable",
    freshness_state: freshnessState,
    fallback: deliveries.some((delivery) => delivery.fallback),
    endpoints: Object.fromEntries(deliveries.map((delivery) => [delivery.key, delivery])),
  };
}

function controlDelivery(key, payload, { source = "current_public_origin", reason = null, targetSeconds = 900 } = {}) {
  const nowMs = Date.now();
  const freshness = projectionFreshness({
    generated_at: payload?.generated_at,
    freshness_target_seconds: targetSeconds,
  }, { nowMs, defaultTargetSeconds: targetSeconds });
  return {
    schema_version: "ravenos.delivery.v1",
    source: payload ? source : "unavailable",
    key,
    fetched_at: new Date(nowMs).toISOString(),
    source_generated_at: freshness.generated_at,
    origin_updated_at: null,
    age_seconds: freshness.age_seconds,
    freshness_target_seconds: freshness.target_seconds,
    freshness_state: payload ? freshness.state : "unavailable",
    fallback: source !== "current_public_origin",
    reason: reason || freshness.reason || null,
  };
}

function projectionRouteHeaders(pathname, delivery) {
  const base = routeCacheHeaders(pathname);
  const freshness = delivery?.freshness_state || "unavailable";
  const cacheControl = (delivery?.fallback || freshness === "stale" || freshness === "unavailable")
    ? "public, max-age=15, stale-while-revalidate=30"
    : base["cache-control"];
  return {
    ...base,
    "cache-control": cacheControl,
    ...projectionHeaders(delivery),
  };
}

function routeCacheHeaders(pathname) {
  if (pathname === "/api/hyperliquid/instrument") return { "cache-control": "public, max-age=2, stale-while-revalidate=5" };
  if (pathname === "/api/perps/instrument") return { "cache-control": "public, max-age=2, stale-while-revalidate=10" };
  if (pathname === "/api/terminal/chart") return { "cache-control": "public, max-age=2, stale-while-revalidate=10" };
  if (pathname === "/api/terminal") return { "cache-control": "public, max-age=15, stale-while-revalidate=60" };
  if (pathname === "/api/opportunity") return { "cache-control": "public, max-age=60, stale-while-revalidate=120" };
  if (pathname === "/api/brief") return { "cache-control": "public, max-age=300, stale-while-revalidate=900" };
  if (pathname === "/api/status" || pathname === "/api/claims") return { "cache-control": "public, max-age=60, stale-while-revalidate=120" };
  return { "cache-control": "public, max-age=900, stale-while-revalidate=1800" };
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function cacheGet(map, key) {
  const hit = map.get(key);
  return hit && hit.expires > Date.now() ? hit.payload : null;
}

function cacheSet(map, key, payload, ttlMs) {
  map.set(key, { payload, expires: Date.now() + ttlMs });
  if (map.size > 300) map.delete(map.keys().next().value);
}

function chartEdgeCacheRequest(cacheKey, tier = "fresh") {
  return new Request(`https://ravenos.xyz/__chart_cache/v1/${tier}/${encodeURIComponent(cacheKey)}`, { method: "GET" });
}

async function chartEdgeCacheRead(cacheKey, tier = "fresh") {
  if (typeof caches === "undefined" || !caches?.default) return null;
  try {
    const response = await caches.default.match(chartEdgeCacheRequest(cacheKey, tier));
    if (!response?.ok) return null;
    const payload = await response.json().catch(() => null);
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

async function chartEdgeCacheWrite(cacheKey, payload, { freshTtlSeconds = 20, rescueTtlSeconds = 21_600 } = {}) {
  if (typeof caches === "undefined" || !caches?.default || !payload?.ok) return;
  const body = JSON.stringify(payload);
  const write = async (tier, ttlSeconds) => {
    const response = new Response(body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": `public, s-maxage=${Math.max(1, Number(ttlSeconds) || 1)}`,
      },
    });
    await caches.default.put(chartEdgeCacheRequest(cacheKey, tier), response);
  };
  try {
    await Promise.all([
      write("fresh", freshTtlSeconds),
      write("rescue", rescueTtlSeconds),
    ]);
  } catch {
    // The chart cache is opportunistic; provider truth remains authoritative.
  }
}

function degradedChartCachePayload(payload, error) {
  const cachedAt = Date.parse(payload?.observed_at || payload?.updated_at || "");
  return {
    ...payload,
    stale: true,
    freshness_state: "degraded",
    coverage: "Delayed",
    source_label: `${payload?.source || "Market provider"} cached exact-pool history`,
    cache_state: "stale_rescue",
    provider_status: "degraded",
    age_seconds: Number.isFinite(cachedAt) ? Math.max(0, Math.round((Date.now() - cachedAt) / 1000)) : null,
    message: "The live history provider is throttled. Showing the last verified exact-pool history.",
    warning: "Cached provider history; current market state may have advanced.",
    provider_error: String(error?.message || "provider_unavailable"),
    from_cache: true,
  };
}

function chainRouteInfo(slug = "") {
  return CHAIN_ROUTE_MAP[String(slug || "").toLowerCase()] || null;
}

function chainMatches(value, aliases = []) {
  const clean = String(value || "").toLowerCase();
  return aliases.includes(clean);
}

async function cachedDex(path) {
  const now = Date.now();
  const hit = dexCache.get(path);
  if (hit && hit.expires > now) return hit.payload;
  const response = await fetch(`${DEXSCREENER_BASE_URL}${path}`, {
    headers: { accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`dexscreener_http_${response.status}`);
  dexCache.set(path, { payload, expires: now + 30_000 });
  if (dexCache.size > 200) dexCache.delete(dexCache.keys().next().value);
  return payload;
}

function normalizeDexPair(pair = {}) {
  const base = pair.baseToken || {};
  const quote = pair.quoteToken || {};
  return {
    id: `${pair.chainId || "unknown"}:${pair.pairAddress || base.address || ""}`,
    chainId: pair.chainId || "unknown",
    dexId: pair.dexId || "unknown",
    pairAddress: pair.pairAddress || "",
    tokenAddress: base.address || "",
    quoteTokenAddress: quote.address || "",
    symbol: base.symbol || "UNKNOWN",
    name: base.name || base.symbol || "Unknown token",
    quoteSymbol: quote.symbol || "",
    priceUsd: num(pair.priceUsd),
    liquidityUsd: num(pair.liquidity?.usd),
    volume24h: num(pair.volume?.h24),
    txns24h: num(pair.txns?.h24?.buys) + num(pair.txns?.h24?.sells),
    marketCap: num(pair.marketCap),
    fdv: num(pair.fdv),
    priceChange24h: num(pair.priceChange?.h24),
    pairAgeMs: pair.pairCreatedAt ? Date.now() - Number(pair.pairCreatedAt) : null,
    provider: "Dexscreener",
    coverage: "Public fallback",
    isLive: false,
    isCached: false,
    isSample: false,
    lastUpdated: new Date().toISOString(),
    warning: "Limited public coverage",
  };
}

function rankDexPair(pair = {}) {
  const quote = String(pair.quoteToken?.symbol || "").toUpperCase();
  const age = pair.pairCreatedAt ? Math.min(20, Math.max(0, (Date.now() - Number(pair.pairCreatedAt)) / 86_400_000)) : 0;
  return num(pair.liquidity?.usd) / 10_000
    + num(pair.volume?.h24) / 25_000
    + (num(pair.txns?.h24?.buys) + num(pair.txns?.h24?.sells)) / 20
    + (QUOTE_RANK[quote] || 0)
    + age;
}

function sortedDexResults(pairs = []) {
  return [...pairs].sort((a, b) => rankDexPair(b) - rankDexPair(a)).map(normalizeDexPair);
}

async function hyperliquidPerps() {
  const key = "metaAndAssetCtxs";
  const now = Date.now();
  const hit = hyperliquidCache.get(key);
  if (hit && hit.expires > now) return hit.payload;
  const payload = await hyperliquidInfo({ type: "metaAndAssetCtxs" }, { maxBytes: 2 * 1024 * 1024 });
  const rows = normalizeHyperliquidPerps(payload);
  const result = {
    ok: true,
    schema_version: "ravenos.hyperliquid.markets.v2",
    provider: "Hyperliquid",
    coverage: "Live",
    isLive: true,
    lastUpdated: new Date().toISOString(),
    count: rows.length,
    contract_notes: {
      observed_market_facts_only: true,
      synthetic_actor_composition: false,
      synthetic_historical_replay: false,
      raven_evidence_join: "separate_selected_instrument_context",
    },
    results: rows,
  };
  hyperliquidCache.set(key, { payload: result, expires: now + 15_000 });
  return result;
}

async function hyperliquidInfo(body, { maxBytes = 512 * 1024, timeoutMs = 4_000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(HYPERLIQUID_INFO_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`hyperliquid_http_${response.status}`);
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > maxBytes) throw new Error("hyperliquid_payload_too_large");
    const text = await response.text();
    if (byteLengthUtf8(text) > maxBytes) throw new Error("hyperliquid_payload_too_large");
    const payload = JSON.parse(text);
    if (payload === null || typeof payload !== "object") throw new Error("hyperliquid_invalid_payload");
    return payload;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("hyperliquid_timeout");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function hyperliquidInstrument(coinInput) {
  const coin = normalizeHyperliquidCoin(coinInput);
  if (!coin) return { ok: false, error: "invalid_instrument", status: 400 };
  const markets = await hyperliquidPerps();
  const market = markets.results.find((row) => row.symbol === coin || row.coin === coin);
  if (!market) return { ok: false, error: "instrument_not_found", status: 404 };
  const cacheKey = `instrument:${coin}`;
  const cached = cacheGet(hyperliquidCache, cacheKey);
  if (cached) return { ...cached, cache_state: "edge_memory_hit" };

  const [bookResult, tradesResult] = await Promise.allSettled([
    hyperliquidInfo({ type: "l2Book", coin }, { maxBytes: 512 * 1024, timeoutMs: 3_500 }),
    hyperliquidInfo({ type: "recentTrades", coin }, { maxBytes: 512 * 1024, timeoutMs: 3_500 }),
  ]);
  const book = bookResult.status === "fulfilled" ? normalizeHyperliquidBook(bookResult.value) : null;
  const tape = tradesResult.status === "fulfilled" ? normalizeHyperliquidTrades(tradesResult.value) : null;
  const payload = {
    ok: Boolean(book || tape),
    schema_version: "ravenos.hyperliquid.instrument.v1",
    generated_at: new Date().toISOString(),
    instrument: {
      instrument_id: market.instrument_id,
      instrument_scope: market.instrument_scope,
      symbol: market.symbol,
      asset: market.asset,
      venue: "hyperliquid",
      market_type: "perpetual",
    },
    market,
    book,
    tape,
    components: {
      market: "fresh",
      book: book ? "fresh" : "unavailable",
      tape: tape ? "fresh" : "unavailable",
    },
    privacy: {
      participant_addresses_exposed: false,
      transaction_hashes_exposed: false,
      provider_trade_ids_exposed: false,
    },
    execution: {
      signing_available: false,
      submission_available: false,
      position_monitoring_available: false,
    },
    cache_state: "provider_read",
  };
  cacheSet(hyperliquidCache, cacheKey, payload, 2_000);
  return payload;
}

function timeframeSpec(timeframe = "1h") {
  const tf = String(timeframe || "1h").toLowerCase();
  if (tf === "5m") return { yahooInterval: "5m", yahooRange: "5d", hyperInterval: "5m", displayTimeframe: "5m", lookbackMs: 2 * 24 * 60 * 60 * 1000, hyperMaxItems: 576, yahooMaxItems: 576 };
  if (tf === "15m") return { yahooInterval: "15m", yahooRange: "5d", hyperInterval: "15m", lookbackMs: 3 * 24 * 60 * 60 * 1000 };
  if (tf === "4h") return { yahooInterval: "1h", yahooRange: "1mo", hyperInterval: "4h", lookbackMs: 21 * 24 * 60 * 60 * 1000 };
  if (tf === "1d") return { yahooInterval: "1d", yahooRange: "6mo", hyperInterval: "1d", lookbackMs: 180 * 24 * 60 * 60 * 1000 };
  if (tf === "1w") return { yahooInterval: "1wk", yahooRange: "5y", hyperInterval: "1w", displayTimeframe: "1w", lookbackMs: 3 * 365 * 24 * 60 * 60 * 1000, hyperMaxItems: 260, yahooMaxItems: 260 };
  if (tf === "1m") return { yahooInterval: "1mo", yahooRange: "10y", hyperInterval: "1M", displayTimeframe: "1m", lookbackMs: 6 * 365 * 24 * 60 * 60 * 1000, hyperMaxItems: 120, yahooMaxItems: 120 };
  return { yahooInterval: "1h", yahooRange: "1mo", hyperInterval: "1h", displayTimeframe: "1h", lookbackMs: 14 * 24 * 60 * 60 * 1000, hyperMaxItems: 360, yahooMaxItems: 360 };
}

function sanitizeChartCandles(candles = [], { maxItems = 360 } = {}) {
  const deduped = [];
  const seen = new Set();
  for (const candle of Array.isArray(candles) ? candles : []) {
    const open = num(candle?.open);
    const high = num(candle?.high);
    const low = num(candle?.low);
    const close = num(candle?.close);
    const volume = num(candle?.volume);
    const rawTime = candle?.time;
    if (rawTime === null || rawTime === undefined || !open || !high || !low || !close) continue;
    if ([open, high, low, close].some((value) => value <= 0)) continue;
    const time = typeof rawTime === "number" ? Math.trunc(rawTime) : String(rawTime);
    const key = `${time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      time,
      open,
      high: Math.max(high, open, close, low),
      low: Math.min(low, open, close, high),
      close,
      volume: volume >= 0 ? volume : 0,
    });
  }
  deduped.sort((left, right) => {
    const leftTime = typeof left.time === "number" ? left.time : Date.parse(left.time);
    const rightTime = typeof right.time === "number" ? right.time : Date.parse(right.time);
    return leftTime - rightTime;
  });
  return deduped.slice(-Math.max(1, maxItems));
}

function aggregateCandles(candles = [], bucketSize = 4, { maxItems = 240 } = {}) {
  const clean = sanitizeChartCandles(candles, { maxItems: 1000 });
  if (!Number.isFinite(bucketSize) || bucketSize <= 1) return clean.slice(-Math.max(1, maxItems));
  const buckets = [];
  for (let index = 0; index < clean.length; index += bucketSize) {
    const group = clean.slice(index, index + bucketSize);
    if (!group.length) continue;
    buckets.push({
      time: group[0].time,
      open: group[0].open,
      high: Math.max(...group.map((candle) => candle.high)),
      low: Math.min(...group.map((candle) => candle.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, candle) => sum + (Number.isFinite(Number(candle.volume)) ? Number(candle.volume) : 0), 0),
    });
  }
  return buckets.slice(-Math.max(1, maxItems));
}

function normalizeChartCandle(row = {}) {
  const open = num(row.open ?? row.o);
  const high = num(row.high ?? row.h);
  const low = num(row.low ?? row.l);
  const close = num(row.close ?? row.c);
  const volume = num(row.volume ?? row.v);
  const rawTime = row.time ?? row.t;
  const time = typeof rawTime === "string" ? rawTime : Math.floor(num(rawTime) / (num(rawTime) > 10_000_000_000 ? 1000 : 1));
  if (!time || !open || !high || !low || !close) return null;
  return { time, open, high, low, close, volume };
}

function geckoTimeframeSpec(timeframe = "1h") {
  const tf = String(timeframe || "1h").toLowerCase();
  if (tf === "5m") return { providerTimeframe: "minute", aggregate: 5, limit: 576, intervalSeconds: 300 };
  if (tf === "15m") return { providerTimeframe: "minute", aggregate: 15, limit: 480, intervalSeconds: 900 };
  if (tf === "4h") return { providerTimeframe: "hour", aggregate: 4, limit: 240, intervalSeconds: 14_400 };
  if (tf === "1d") return { providerTimeframe: "day", aggregate: 1, limit: 180, intervalSeconds: 86_400 };
  if (tf === "1w") return { providerTimeframe: "day", aggregate: 7, limit: 260, intervalSeconds: 604_800 };
  if (tf === "1m") return { providerTimeframe: "day", aggregate: 30, limit: 120, intervalSeconds: 2_592_000 };
  return { providerTimeframe: "hour", aggregate: 1, limit: 360, intervalSeconds: 3_600 };
}

function boundedChartLimit(value, fallback, max = 1000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(2, Math.min(max, Math.trunc(parsed)));
}

function chartBeforeSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed > 10_000_000_000 ? parsed / 1000 : parsed);
}

function canonicalChartInstrument({
  market = "",
  asset = "",
  chain = "",
  venue = "",
  pairAddress = "",
  tokenAddress = "",
  quoteAsset = "",
  provider = "",
} = {}) {
  const perpetual = String(market || "").toLowerCase() === "perpetuals" || String(asset || "").toUpperCase().endsWith("-PERP");
  const exactPool = !perpetual && Boolean(pairAddress);
  const symbol = String(asset || "").replace(/\s+Spot$/i, "").replace(/-PERP$/i, "").toUpperCase();
  return normalizeChartInstrument({
    instrumentType: perpetual
      ? CHART_INSTRUMENT_TYPES.PERPETUAL
      : exactPool
        ? CHART_INSTRUMENT_TYPES.SPOT_POOL
        : CHART_INSTRUMENT_TYPES.SPOT_TOKEN,
    marketType: perpetual ? "perp" : "spot",
    chain: perpetual ? "hyperliquid" : chain,
    venue: venue || (perpetual ? "hyperliquid" : provider || "aggregate"),
    symbol,
    baseAsset: symbol,
    quoteAsset: quoteAsset || (perpetual ? "USD" : "USD"),
    tokenAddress,
    pairAddress,
    marketStatus: "active",
    ravenCoverageState: exactPool || perpetual ? "provider_backed" : "provider_proxy",
    providerRouting: {
      history: provider || "unavailable",
      live: perpetual ? "hyperliquid_websocket" : exactPool ? "bounded_provider_poll" : "bounded_provider_poll",
      providerAsset: perpetual ? symbol : tokenAddress || symbol,
      providerNetwork: perpetual ? "hyperliquid" : chain,
    },
  });
}

function normalizeGeckoCandle(row = []) {
  if (!Array.isArray(row) || row.length < 6) return null;
  return normalizeChartCandle({
    time: row[0],
    open: row[1],
    high: row[2],
    low: row[3],
    close: row[4],
    volume: row[5],
  });
}

function ravenProjectionInstrument(payload = {}, { asset = "", chain = "", pairAddress = "", tokenAddress = "" } = {}) {
  const aggregate = payload.instrument_scope === "token_aggregate";
  return canonicalChartInstrument({
    market: "crypto_spot",
    asset,
    chain,
    venue: "raven_exact_observations",
    pairAddress: aggregate ? "" : (payload.pair_address || pairAddress),
    tokenAddress: payload.token_address || tokenAddress,
    quoteAsset: payload.quote_address || "QUOTE",
    provider: "raven_spot_projection",
  });
}

async function fetchRavenSpotProjection({
  env = {},
  chain = "",
  pairAddress = "",
  tokenAddress = "",
  quoteAddress = "",
  instrumentScope = "exact_pool",
  asset = "",
  timeframe = "1h",
  before = null,
  limit = null,
} = {}) {
  const token = String(env.RAVENOS_SPOT_CHART_ORIGIN_TOKEN || "").trim();
  if (!token) return null;
  const endpoint = String(env.RAVENOS_SPOT_CHART_ORIGIN_URL || DEFAULT_RAVENOS_SPOT_CHART_ORIGIN_URL).trim();
  if (!endpoint.startsWith("https://")) return null;
  const params = new URLSearchParams({
    chain: String(chain || "").toLowerCase(),
    timeframe: String(timeframe || "1h").toLowerCase(),
    limit: String(boundedChartLimit(limit, 240, 1000)),
    instrument_scope: instrumentScope === "token_aggregate" ? "token_aggregate" : "exact_pool",
  });
  if (pairAddress) params.set("pair_address", String(pairAddress));
  if (tokenAddress) params.set("token_address", String(tokenAddress));
  if (quoteAddress) params.set("quote_address", String(quoteAddress));
  if (before) params.set("before", String(before));
  const cacheKey = `raven-spot:${params.toString()}`;
  const cached = cacheGet(terminalChartCache, cacheKey);
  if (cached) return cached;
  const payload = await runProviderOperation({
    component: "market_chart_data",
    operation_key: cacheKey,
    fn: async () => {
      const response = await fetch(`${endpoint}?${params.toString()}`, {
        headers: {
          accept: "application/json",
          "x-ravenos-public-token": token,
          "user-agent": "RavenOS/1.0 spot-chart-gateway",
        },
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body || typeof body !== "object") throw new Error(`raven_spot_projection_${response.status}`);
      if (!body.ok) return body;
      const instrument = ravenProjectionInstrument(body, { asset, chain, pairAddress, tokenAddress });
      const result = {
        ...body,
        asset,
        source: body.source || "Raven exact observations",
        source_type: "raven_native_projection",
        source_label: body.instrument_scope === "token_aggregate"
          ? "Raven observed swaps · token aggregate"
          : "Raven exact-pool observations",
        instrument,
        capabilities: {
          ...(body.capabilities || {}),
          raven_overlays: true,
        },
      };
      cacheSet(terminalChartCache, cacheKey, result, 2_000);
      return result;
    },
  });
  return payload;
}

function mergeExactPoolHistory(providerPayload, ravenPayload, { limit = 240 } = {}) {
  if (!providerPayload?.ok || !ravenPayload?.ok || ravenPayload.price_unit !== "usd_per_token") return ravenPayload?.ok ? ravenPayload : providerPayload;
  const merged = new Map();
  for (const candle of sanitizeChartCandles(providerPayload.candles, { maxItems: 1000 })) merged.set(String(candle.time), candle);
  for (const ravenCandle of sanitizeChartCandles(ravenPayload.candles, { maxItems: 1000 })) {
    const key = String(ravenCandle.time);
    const providerCandle = merged.get(key);
    merged.set(key, providerCandle
      ? {
          ...providerCandle,
          high: Math.max(providerCandle.high, ravenCandle.high),
          low: Math.min(providerCandle.low, ravenCandle.low),
          close: ravenCandle.close,
        }
      : ravenCandle);
  }
  const candles = sanitizeChartCandles([...merged.values()], { maxItems: boundedChartLimit(limit, 240, 1000) });
  const latestObserved = [providerPayload.observed_at, ravenPayload.observed_at]
    .filter(Boolean)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || null;
  return {
    ...providerPayload,
    ok: Boolean(candles.length),
    source: "Raven + GeckoTerminal",
    source_type: "hybrid_exact_pool",
    source_label: "Provider history + Raven exact-pair observations",
    observed_at: latestObserved,
    updated_at: new Date().toISOString(),
    freshness_state: ravenPayload.freshness_state === "live" || providerPayload.freshness_state === "live" ? "live" : "delayed",
    coverage: ravenPayload.freshness_state === "live" || providerPayload.freshness_state === "live" ? "Live" : "Delayed",
    stale: ravenPayload.freshness_state !== "live" && providerPayload.freshness_state !== "live",
    candles,
    recent_trades: ravenPayload.recent_trades || [],
    available_scopes: ravenPayload.available_scopes || {},
    capabilities: {
      ...(providerPayload.capabilities || {}),
      ...(ravenPayload.capabilities || {}),
      historical_bars: true,
      older_bar_backfill: true,
      live_bars: true,
      live_trades: Boolean(ravenPayload.recent_trades?.length),
    },
    market_state: { ...(providerPayload.market_state || {}), ...(ravenPayload.market_state || {}) },
    lineage: {
      provider_history: providerPayload.lineage || null,
      raven_projection: ravenPayload.lineage || null,
      identity_scope: "exact_pool",
      price_unit: "usd_per_token",
      source_precedence: "Raven observations correct the current provider bucket; provider history remains preserved",
    },
  };
}

async function fetchGeckoPoolCandles({ chain = "", pairAddress = "", tokenAddress = "", asset = "", timeframe = "1h", before = null, limit = null } = {}) {
  const network = GECKOTERMINAL_NETWORKS[String(chain || "").toLowerCase()];
  const pool = String(pairAddress || "").trim();
  if (!network || !pool) {
    return unresolvedChart(asset, "Exact-pool chart identity is unavailable for this market.", {
      source: "GeckoTerminal",
      sourceType: "identity_unavailable",
      timeframe,
    });
  }
  const spec = geckoTimeframeSpec(timeframe);
  const requestedLimit = boundedChartLimit(limit, spec.limit, spec.limit);
  const beforeSeconds = chartBeforeSeconds(before);
  const cacheKey = `gecko:${network}:${pool}:${tokenAddress || "base"}:${timeframe}:${beforeSeconds || "latest"}:${requestedLimit}`;
  const cached = cacheGet(terminalChartCache, cacheKey);
  if (cached) {
    recordProviderComponentEvent({
      component: "market_chart_data",
      category: "success",
      cache_hit: true,
      reason_code: "exact_pool_chart_cache_hit",
    });
    return cached;
  }
  const edgeCached = await chartEdgeCacheRead(cacheKey, "fresh");
  if (edgeCached?.ok) {
    const payload = { ...edgeCached, from_cache: true, cache_state: "edge_fresh" };
    cacheSet(terminalChartCache, cacheKey, payload, 20_000);
    recordProviderComponentEvent({
      component: "market_chart_data",
      category: "success",
      cache_hit: true,
      reason_code: "exact_pool_edge_cache_hit",
    });
    return payload;
  }
  try {
    const payload = await runProviderOperation({
      component: "market_chart_data",
      operation_key: cacheKey,
      fn: async () => {
        const params = new URLSearchParams({
          aggregate: String(spec.aggregate),
          limit: String(requestedLimit),
          currency: "usd",
          token: "base",
          include_empty_intervals: "false",
        });
        if (beforeSeconds) params.set("before_timestamp", String(beforeSeconds));
        const url = `${GECKOTERMINAL_BASE_URL}/networks/${encodeURIComponent(network)}/pools/${encodeURIComponent(pool)}/ohlcv/${spec.providerTimeframe}?${params.toString()}`;
        const response = await fetch(url, {
          headers: {
            accept: "application/json",
            "user-agent": "RavenOS/1.0 market-chart",
          },
        });
        if (!response.ok) throw new Error(`geckoterminal_ohlcv_${response.status}`);
        const payload = await response.json().catch(() => ({}));
        const rows = payload?.data?.attributes?.ohlcv_list;
        const candles = sanitizeChartCandles((Array.isArray(rows) ? rows : []).map(normalizeGeckoCandle).filter(Boolean), {
          maxItems: requestedLimit,
        });
        const fetchedAt = new Date().toISOString();
        const lastCandleTime = candles[candles.length - 1]?.time;
        const lastCandleMs = typeof lastCandleTime === "number" ? lastCandleTime * 1000 : Date.parse(lastCandleTime || "");
        const ageSeconds = Number.isFinite(lastCandleMs) ? Math.max(0, Math.round((Date.now() - lastCandleMs) / 1000)) : null;
        const delayed = ageSeconds === null || ageSeconds > Math.max(spec.intervalSeconds * 2, 600);
        const instrument = canonicalChartInstrument({
          market: "crypto_spot",
          asset,
          chain,
          venue: "geckoterminal",
          pairAddress: pool,
          tokenAddress,
          provider: "geckoterminal",
        });
        const lastCandleAt = Number.isFinite(lastCandleMs) ? new Date(lastCandleMs).toISOString() : null;
        const result = {
          ok: candles.length > 0,
          asset,
          provider_asset: tokenAddress || null,
          market_identity: `${network}:${pool}`,
          chain: String(chain || "").toLowerCase(),
          pair_address: pool,
          token_address: tokenAddress || null,
          source: "GeckoTerminal",
          source_type: "provider",
          source_label: "Exact-pool OHLCV",
          coverage: candles.length ? (delayed ? "Delayed" : "Live") : "Data unavailable",
          stale: delayed,
          freshness_state: delayed ? "delayed" : "live",
          timeframe,
          updated_at: fetchedAt,
          observed_at: fetchedAt,
          age_seconds: 0,
          last_candle_at: lastCandleAt,
          last_candle_age_seconds: ageSeconds,
          instrument,
          capabilities: {
            historical_bars: true,
            older_bar_backfill: true,
            live_bars: true,
            live_trades: false,
            liquidity: true,
            order_book: false,
            funding: false,
            open_interest: false,
            raven_overlays: true,
          },
          history_window: {
            before: beforeSeconds,
            returned: candles.length,
            oldest: candles[0]?.time || null,
            newest: candles[candles.length - 1]?.time || null,
          },
          market_state: {
            last: candles[candles.length - 1]?.close || null,
            liquidity_usd: null,
            volume: candles[candles.length - 1]?.volume || null,
            observed_at: fetchedAt,
          },
          build_id: null,
          lineage: {
            provider: "GeckoTerminal",
            network,
            pool_address: pool,
            token_address: tokenAddress || null,
            price_currency: "usd",
            token_orientation: "base",
            last_candle_at: lastCandleAt,
          },
          candles,
        };
        cacheSet(terminalChartCache, cacheKey, result, 30_000);
        return result;
      },
    });
    await chartEdgeCacheWrite(cacheKey, payload);
    return payload;
  } catch (error) {
    const rescued = await chartEdgeCacheRead(cacheKey, "rescue");
    if (!rescued?.ok) throw error;
    const payload = degradedChartCachePayload(rescued, error);
    cacheSet(terminalChartCache, cacheKey, payload, 15_000);
    recordProviderComponentEvent({
      component: "market_chart_data",
      category: "degraded",
      cache_hit: true,
      reason_code: "exact_pool_stale_rescue",
      rate_limited: String(error?.message || "").includes("429"),
    });
    return payload;
  }
}

async function fetchHyperliquidCandles(symbol, timeframe, { before = null, limit = null } = {}) {
  const spec = timeframeSpec(timeframe);
  const coin = String(symbol || "").replace(/-PERP$/i, "").trim().toUpperCase();
  const beforeSeconds = chartBeforeSeconds(before);
  const requestedLimit = boundedChartLimit(limit, spec.hyperMaxItems || (spec.hyperInterval === "15m" ? 480 : spec.hyperInterval === "1h" ? 360 : spec.hyperInterval === "4h" ? 240 : 220), 1000);
  const cacheKey = `hyper:${coin}:${spec.hyperInterval}:${beforeSeconds || "latest"}:${requestedLimit}`;
  const cached = cacheGet(terminalChartCache, cacheKey);
  if (cached) {
    recordProviderComponentEvent({
      component: "market_chart_data",
      category: "success",
      cache_hit: true,
      reason_code: "chart_cache_hit",
    });
    return cached;
  }
  return runProviderOperation({
    component: "market_chart_data",
    operation_key: cacheKey,
    fn: async () => {
      const endTime = beforeSeconds ? beforeSeconds * 1000 : Date.now();
      const response = await fetch(HYPERLIQUID_INFO_URL, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          type: "candleSnapshot",
          req: { coin, interval: spec.hyperInterval, startTime: endTime - spec.lookbackMs, endTime },
        }),
      });
      if (!response.ok) throw new Error(`hyperliquid_candles_${response.status}`);
      const payload = await response.json().catch(() => []);
      const candles = sanitizeChartCandles((Array.isArray(payload) ? payload : []).map(normalizeChartCandle).filter(Boolean), {
        maxItems: requestedLimit,
      });
      const observedAt = new Date().toISOString();
      const instrument = canonicalChartInstrument({
        market: "perpetuals",
        asset: `${coin}-PERP`,
        chain: "hyperliquid",
        venue: "hyperliquid",
        quoteAsset: "USD",
        provider: "hyperliquid",
      });
      const result = {
        ok: candles.length > 0,
        asset: `${coin}-PERP`,
        instrument_scope: "exact_instrument",
        available_scopes: { exact_instrument: true },
        source: "Hyperliquid",
        source_type: "provider",
        source_label: "Live perps market price",
        coverage: candles.length ? "Live" : "Coverage Developing",
        stale: false,
        freshness_state: "fresh",
        timeframe: spec.displayTimeframe || spec.hyperInterval,
        updated_at: observedAt,
        observed_at: observedAt,
        age_seconds: 0,
        instrument,
        capabilities: {
          historical_bars: true,
          older_bar_backfill: true,
          live_bars: true,
          live_trades: true,
          liquidity: true,
          order_book: true,
          funding: true,
          open_interest: true,
          raven_overlays: true,
        },
        history_window: {
          before: beforeSeconds,
          returned: candles.length,
          oldest: candles[0]?.time || null,
          newest: candles[candles.length - 1]?.time || null,
        },
        market_state: {
          last: candles[candles.length - 1]?.close || null,
          mark: null,
          oracle: null,
          funding: null,
          open_interest: null,
        },
        build_id: null,
        candles,
      };
      cacheSet(terminalChartCache, cacheKey, result, 15_000);
      return result;
    },
  });
}

async function fetchYahooCandles(ticker, timeframe, { assetLabel = ticker, assetType = "equity", limit = null } = {}) {
  const spec = timeframeSpec(timeframe);
  const requestedTimeframe = String(timeframe || "1h").toLowerCase();
  const cacheKey = `yahoo:${ticker}:${requestedTimeframe}:${spec.yahooInterval}:${spec.yahooRange}`;
  const cached = cacheGet(terminalChartCache, cacheKey);
  if (cached) {
    recordProviderComponentEvent({
      component: "market_chart_data",
      category: "success",
      cache_hit: true,
      reason_code: "chart_cache_hit",
    });
    return cached;
  }
  return runProviderOperation({
    component: "market_chart_data",
    operation_key: cacheKey,
    fn: async () => {
      const url = `${YAHOO_CHART_BASE_URL}/${encodeURIComponent(ticker)}?interval=${encodeURIComponent(spec.yahooInterval)}&range=${encodeURIComponent(spec.yahooRange)}&includePrePost=false&events=div%2Csplits`;
      const response = await fetch(url, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`yahoo_chart_${response.status}`);
      const payload = await response.json().catch(() => ({}));
      const resultNode = payload?.chart?.result?.[0];
      const timestamps = Array.isArray(resultNode?.timestamp) ? resultNode.timestamp : [];
      const quote = resultNode?.indicators?.quote?.[0] || {};
      const providerCandles = sanitizeChartCandles(timestamps.map((ts, index) => normalizeChartCandle({
        time: ts,
        open: quote.open?.[index],
        high: quote.high?.[index],
        low: quote.low?.[index],
        close: quote.close?.[index],
        volume: quote.volume?.[index],
      })).filter(Boolean), {
        maxItems: requestedTimeframe === "4h" ? 1000 : spec.yahooMaxItems || (spec.yahooInterval === "15m" ? 480 : spec.yahooInterval === "1h" ? 360 : 220),
      });
      const candles = requestedTimeframe === "4h"
        ? aggregateCandles(providerCandles, 4, { maxItems: 240 })
        : providerCandles;
      const observedAt = new Date().toISOString();
      const requestedLimit = boundedChartLimit(limit, candles.length || 220, 1000);
      const limitedCandles = candles.slice(-requestedLimit);
      const instrument = canonicalChartInstrument({
        market: assetType === "crypto_spot" ? "crypto_spot" : assetType,
        asset: assetLabel,
        chain: assetType === "crypto_spot" ? "aggregate" : "traditional",
        venue: "yahoo_finance",
        provider: "yahoo_finance",
      });
      const result = {
        ok: candles.length > 0,
        asset: assetLabel,
        source: "Yahoo Finance",
        source_type: "provider",
        source_label: assetType === "equity" || assetType === "etf" ? "Live market price" : "Live spot proxy price",
        coverage: candles.length ? "Live" : "Coverage Developing",
        stale: false,
        freshness_state: "fresh",
        timeframe: spec.displayTimeframe || (requestedTimeframe === "4h" ? "4h" : spec.yahooInterval),
        updated_at: observedAt,
        observed_at: observedAt,
        age_seconds: 0,
        instrument,
        capabilities: {
          historical_bars: true,
          older_bar_backfill: false,
          live_bars: true,
          live_trades: false,
          liquidity: false,
          order_book: false,
          funding: false,
          open_interest: false,
          raven_overlays: true,
        },
        history_window: {
          before: null,
          returned: limitedCandles.length,
          oldest: limitedCandles[0]?.time || null,
          newest: limitedCandles[limitedCandles.length - 1]?.time || null,
        },
        market_state: {
          last: limitedCandles[limitedCandles.length - 1]?.close || null,
        },
        build_id: null,
        candles: limitedCandles,
      };
      cacheSet(terminalChartCache, cacheKey, result, 60_000);
      return result;
    },
  });
}

function unresolvedChart(asset, message, { source = "Coverage Developing", sourceType = "coverage_developing", timeframe = "", providerAsset = null } = {}) {
  return {
    ok: false,
    asset,
    provider_asset: providerAsset,
    source,
    source_type: sourceType,
    source_label: sourceType === "structure_proxy" ? "Structure Proxy" : "Coverage Developing",
    coverage: "Coverage Developing",
    stale: false,
    freshness_state: sourceType === "structure_proxy" ? "degraded" : "unavailable",
    timeframe,
    updated_at: new Date().toISOString(),
    observed_at: null,
    age_seconds: null,
    build_id: null,
    message,
    candles: [],
  };
}

function chartDegradedReason(payload = {}) {
  if (payload.ok) return null;
  if (payload.freshness_state) return `chart_${String(payload.freshness_state)}`;
  if (payload.source_type) return `chart_${String(payload.source_type)}`;
  return "chart_unavailable";
}

async function terminalChartPayload({
  env = {},
  market = "",
  asset = "",
  timeframe = "1h",
  chain = "",
  pairAddress = "",
  tokenAddress = "",
  quoteAddress = "",
  instrumentScope = "exact_pool",
  before = null,
  limit = null,
} = {}) {
  const cleanAsset = String(asset || "").trim();
  const cleanMarket = String(market || "").trim().toLowerCase();
  if (!cleanAsset) return unresolvedChart(cleanAsset, "Select an asset.", { timeframe });
  if (cleanMarket === "perpetuals" || cleanAsset.endsWith("-PERP")) {
    const payload = await fetchHyperliquidCandles(cleanAsset, timeframe, { before, limit });
    if (!before && payload.ok) {
      const coin = cleanAsset.replace(/-PERP$/i, "").toUpperCase();
      const row = (await hyperliquidPerps()).results.find((candidate) => candidate.symbol === coin);
      if (row) payload.market_state = {
        last: row.lastPrice,
        mark: row.markPx,
        oracle: row.oraclePx,
        mid: row.midPx,
        funding: row.funding,
        open_interest: row.openInterest,
        volume_24h: row.dayNtlVlm,
        previous_day_price: row.prevDayPx,
        max_leverage: row.maxLeverage,
      };
    }
    return payload;
  }
  const equityMap = {
    "AAPL": "AAPL",
    "NVDA": "NVDA",
    "MSFT": "MSFT",
    "SPY": "SPY",
    "QQQ": "QQQ",
  };
  if (cleanMarket === "equities" || equityMap[cleanAsset]) {
    const ticker = equityMap[cleanAsset] || cleanAsset.replace(/\s+Watch$/i, "");
    return fetchYahooCandles(ticker, timeframe, { assetLabel: cleanAsset, assetType: ["SPY", "QQQ"].includes(ticker) ? "etf" : "equity", limit });
  }
  const spotMap = {
    "BTC Spot": "BTC-USD",
    "ETH Spot": "ETH-USD",
    "SOL Spot": "SOL-USD",
    "ARB Spot": "ARB-USD",
  };
  if (cleanMarket === "crypto_spot" && spotMap[cleanAsset]) {
    return fetchYahooCandles(spotMap[cleanAsset], timeframe, { assetLabel: cleanAsset, assetType: "crypto_spot", limit });
  }
  if (cleanMarket === "crypto_spot") {
    const requestedScope = instrumentScope === "token_aggregate" ? "token_aggregate" : "exact_pool";
    const ravenPayload = await fetchRavenSpotProjection({
      env,
      chain,
      pairAddress,
      tokenAddress,
      quoteAddress,
      instrumentScope: requestedScope,
      asset: cleanAsset,
      timeframe,
      before,
      limit,
    }).catch(() => null);
    if (requestedScope === "token_aggregate") {
      if (ravenPayload?.ok) return ravenPayload;
      return unresolvedChart(cleanAsset, `${cleanAsset} has no bounded Raven-native aggregate swap history for this exact token and quote orientation.`, {
        source: "Raven exact observations",
        sourceType: ravenPayload?.error || "instrument_not_observed",
        timeframe,
      });
    }
    if (pairAddress) {
      let aggregateProbe = null;
      if (!before && tokenAddress && String(chain || "").toLowerCase() === "solana" && !ravenPayload?.available_scopes?.token_aggregate) {
        aggregateProbe = await fetchRavenSpotProjection({
          env,
          chain,
          pairAddress,
          tokenAddress,
          quoteAddress,
          instrumentScope: "token_aggregate",
          asset: cleanAsset,
          timeframe,
          limit: 2,
        }).catch(() => null);
      }
      let payload;
      if (ravenPayload?.ok && ravenPayload.price_unit !== "usd_per_token" && ravenPayload.candles?.length >= 2) {
        payload = ravenPayload;
      } else {
        try {
          const providerPayload = await fetchGeckoPoolCandles({ chain, pairAddress, tokenAddress, asset: cleanAsset, timeframe, before, limit });
          payload = ravenPayload?.ok && ravenPayload.price_unit === "usd_per_token"
            ? mergeExactPoolHistory(providerPayload, ravenPayload, { limit })
            : providerPayload;
        } catch (providerError) {
          if (!ravenPayload?.ok) throw providerError;
          payload = {
            ...ravenPayload,
            message: ravenPayload.message || "Provider history is unavailable; showing bounded Raven-native observations.",
            provider_history_state: "unavailable",
          };
        }
      }
      payload.available_scopes = {
        exact_pool: true,
        token_aggregate: Boolean(ravenPayload?.available_scopes?.token_aggregate || aggregateProbe?.ok),
      };
      payload.instrument_scope = "exact_pool";
      if (!before && payload.ok) {
        const pair = (await pairDex(String(chain || "").toLowerCase(), pairAddress))[0];
        if (pair) payload.market_state = {
          ...(payload.market_state || {}),
          last: pair.priceUsd,
          liquidity_usd: pair.liquidityUsd,
          volume_24h: pair.volume24h,
          transactions_24h: pair.txns24h,
          market_cap: pair.marketCap,
          fully_diluted_value: pair.fdv,
        };
      }
      return payload;
    }
    return unresolvedChart(cleanAsset, `${cleanAsset} requires an exact pool identity before Terminal can request spot candles.`, {
      source: "GeckoTerminal",
      sourceType: "identity_unavailable",
      timeframe,
    });
  }
  return unresolvedChart(cleanAsset, `${cleanAsset} chart coverage is still developing.`, { timeframe });
}

async function searchDex(query) {
  if (!query) return [];
  const payload = await cachedDex(`/latest/dex/search?q=${encodeURIComponent(query)}`);
  return sortedDexResults(Array.isArray(payload.pairs) ? payload.pairs : []);
}

async function tokenDex(chainId, tokenAddress) {
  if (!chainId || !tokenAddress) return [];
  const payload = await cachedDex(`/token-pairs/v1/${encodeURIComponent(chainId)}/${encodeURIComponent(tokenAddress)}`);
  return sortedDexResults(Array.isArray(payload) ? payload : []);
}

async function pairDex(chainId, pairAddress) {
  if (!chainId || !pairAddress) return [];
  const payload = await cachedDex(`/latest/dex/pairs/${encodeURIComponent(chainId)}/${encodeURIComponent(pairAddress)}`);
  return sortedDexResults(Array.isArray(payload.pairs) ? payload.pairs : []);
}

async function tokensDex(chainId, tokenAddresses) {
  if (!chainId || !tokenAddresses) return [];
  const payload = await cachedDex(`/tokens/v1/${encodeURIComponent(chainId)}/${encodeURIComponent(tokenAddresses)}`);
  return sortedDexResults(Array.isArray(payload) ? payload : []);
}

async function resolveDexInput(input) {
  const q = String(input || "").trim();
  if (!q) return [];
  if (SOLANA_ADDRESS_RE.test(q)) return tokenDex("solana", q);
  if (EVM_ADDRESS_RE.test(q)) {
    const settled = await Promise.allSettled(EVM_CHAINS.map((chain) => tokensDex(chain, q)));
    return settled.flatMap((item) => item.status === "fulfilled" ? item.value : []).sort((a, b) => b.liquidityUsd - a.liquidityUsd);
  }
  const pair = q.match(/^([a-z0-9_-]+):([A-Za-z0-9x]+)$/i);
  if (pair) return pairDex(pair[1], pair[2]);
  return searchDex(q);
}

async function readJson(request) {
  return request.json().catch(() => ({}));
}

function featureEnabled(env = {}, name) {
  return String(env[name] || "").trim() === "1";
}

function customerAccountsEnabled(env = {}) {
  return featureEnabled(env, "RAVENOS_CUSTOMER_ACCOUNTS_ENABLE")
    && featureEnabled(env, "RAVENOS_AUTH_ENABLE");
}

function customerBillingEnabled(env = {}) {
  return customerAccountsEnabled(env) && featureEnabled(env, "RAVENOS_BILLING_ENABLE");
}

function customerFoundationUnavailable(error) {
  return json({
    ok: false,
    error,
    customer_system: {
      authentication: "not_configured",
      session: "not_configured",
      billing: "not_configured",
      entitlements: "not_enforced",
      wallet_role: "optional_market_context_only",
      signing: "disabled",
      submission: "disabled",
    },
  }, { status: 503, headers: { "cache-control": "no-store" } });
}

function freeAccess(env = {}, extra = {}) {
  const config = accessConfig(env);
  return {
    ok: true,
    status: "disconnected",
    tier: "free",
    reason: "Free",
    balance: 0,
    mintConfigured: Boolean(config.mint),
    tokenAccessConfigured: config.tokenAccessConfigured,
    tokenAccessStatus: config.tokenAccessConfigured ? "configured" : "not_configured",
    thresholds: config.thresholds,
    subscription: null,
    stripeSubscriptionActive: false,
    ...extra,
  };
}

function unavailable(error, status = 503, env = {}) {
  return json(freeAccess(env, { ok: false, error }), { status });
}

async function handleAccess(request, env) {
  const url = new URL(request.url);
  let wallet = String(url.searchParams.get("wallet") || "").trim();
  if (request.method === "POST") {
    const body = await readJson(request);
    wallet = String(body.wallet || wallet || "").trim();
  }
  if (!wallet) return json(freeAccess(env));

  const config = accessConfig(env);
  let subscription = null;
  let subscriptionError = "";
  try {
    subscription = await findSubscriptionStatus(env, { wallet });
  } catch (error) {
    subscriptionError = error instanceof Error ? error.message : "subscription_unavailable";
  }

  let balance = 0;
  let tokenError = "";
  if (config.tokenAccessConfigured) {
    try {
      balance = await fetchSplTokenBalance({
        owner: wallet,
        mint: config.mint,
        rpcUrl: config.rpcUrl,
        fetchImpl: fetch,
      });
    } catch (error) {
      tokenError = error instanceof Error ? error.message : "token_balance_unavailable";
    }
  }

  const access = resolveAccessFromSignals({
    tokenBalance: balance,
    stripeActive: subscriptionActiveFromRow(subscription),
    stripeStatus: subscription?.status || "",
    env,
  });

  return json({
    ok: true,
    wallet,
    mintConfigured: Boolean(config.mint),
    tokenAccessConfigured: config.tokenAccessConfigured,
    tokenAccessStatus: config.tokenAccessConfigured ? (tokenError ? "unavailable" : "configured") : "not_configured",
    tokenError,
    subscriptionError,
    subscription: subscription
      ? {
          status: subscription.status,
          plan_type: subscription.plan_type || "unknown",
          current_period_end: subscription.current_period_end,
        }
      : null,
    ...access,
  });
}

async function stripeRequest(env, path, params) {
  const config = subscriptionConfig(env);
  if (!config.secretKey) throw new Error("missing_stripe_secret_key");
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") body.append(key, String(value));
  }
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || "stripe_request_failed");
  return payload;
}

async function stripeGet(env, path, params = {}) {
  const config = subscriptionConfig(env);
  if (!config.secretKey) throw new Error("missing_stripe_secret_key");
  const query = new URLSearchParams(params);
  const response = await fetch(`https://api.stripe.com/v1${path}${query.size ? `?${query}` : ""}`, {
    headers: { authorization: `Bearer ${config.secretKey}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || "stripe_request_failed");
  return payload;
}

function planPriceId(config, plan) {
  if (plan === "annual" && config.yearlyPriceId) return config.yearlyPriceId;
  if (config.monthlyPriceId) return config.monthlyPriceId;
  if (config.proPriceId) return config.proPriceId;
  return "";
}

async function handleCheckout(request, env) {
  const config = subscriptionConfig(env);
  if (!config.secretKey) return unavailable("missing_stripe_secret_key", 503, env);
  const body = await readJson(request);
  const wallet = String(body.wallet || "").trim();
  const email = String(body.email || "").trim();
  const plan = String(body.plan || "monthly").toLowerCase() === "annual" ? "annual" : "monthly";
  const priceId = planPriceId(config, plan);
  if (!wallet) return json({ ok: false, error: "missing_wallet" }, { status: 400 });
  if (!priceId) return json({ ok: false, error: "missing_stripe_price_id" }, { status: 503 });
  try {
    const session = await stripeRequest(env, "/checkout/sessions", {
      mode: "subscription",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": 1,
      customer_email: email || undefined,
      client_reference_id: wallet,
      "metadata[wallet_public_key]": wallet,
      "metadata[plan_type]": plan,
      "subscription_data[metadata][wallet_public_key]": wallet,
      "subscription_data[metadata][plan_type]": plan,
      success_url: config.successUrl,
      cancel_url: config.cancelUrl,
      allow_promotion_codes: "false",
    });
    return json({ ok: true, url: session.url, id: session.id });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "checkout_failed" }, { status: 502 });
  }
}

async function handlePortal(request, env) {
  const config = subscriptionConfig(env);
  if (!config.secretKey) return unavailable("missing_stripe_secret_key", 503, env);
  const body = await readJson(request);
  const wallet = String(body.wallet || "").trim();
  const signature = String(body.signature || "").trim();
  const message = String(body.message || "");
  if (!wallet) return json({ ok: false, error: "missing_wallet" }, { status: 400 });
  const expectedMessage = walletAuthMessage({ wallet, origin: new URL(request.url).origin });
  if (message !== expectedMessage || !verifyWalletSignature({ wallet, message, signature })) {
    return json({ ok: false, error: "wallet_signature_required" }, { status: 401 });
  }
  let subscription = null;
  try {
    subscription = await findSubscriptionStatus(env, { wallet });
  } catch {
    return unavailable("subscription_store_unavailable", 503, env);
  }
  if (!subscription?.stripe_customer_id) return json({ ok: false, error: "subscription_not_found" }, { status: 404 });
  try {
    const session = await stripeRequest(env, "/billing_portal/sessions", {
      customer: subscription.stripe_customer_id,
      return_url: config.portalReturnUrl,
    });
    return json({ ok: true, url: session.url });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "portal_failed" }, { status: 502 });
  }
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function verifyStripeSignature(rawBody, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((part) => {
    const [key, value] = part.split("=");
    return [key, value];
  }));
  const signedPayload = `${parts.t}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload)));
  return timingSafeEqual(digest, parts.v1);
}

async function handleWebhook(request, env) {
  const config = subscriptionConfig(env);
  if (!config.secretKey || !config.webhookSecret) return unavailable("missing_stripe_webhook_config", 503, env);
  const rawBody = await request.text();
  const valid = await verifyStripeSignature(rawBody, request.headers.get("stripe-signature") || "", config.webhookSecret);
  if (!valid) return json({ ok: false, error: "invalid_signature" }, { status: 400 });
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: "invalid_event_json" }, { status: 400 });
  }
  const stripe = {
    subscriptions: {
      retrieve: (id) => stripeGet(env, `/subscriptions/${encodeURIComponent(id)}`, { "expand[]": "items.data.price" }),
    },
  };
  try {
    return json(await processStripeWebhookEvent({ env, event, stripe }));
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "webhook_store_failed" }, { status: 500 });
  }
}

function manifestEndpointHealth(row) {
  const ageSeconds = Number(row?.payload_age_seconds);
  const targetSeconds = Number(row?.freshness_target_seconds);
  let state = "unavailable";
  if (Number.isFinite(ageSeconds) && Number.isFinite(targetSeconds) && targetSeconds > 0) {
    state = ageSeconds <= targetSeconds
      ? "fresh"
      : ageSeconds <= Math.max(targetSeconds * 4, targetSeconds + 300)
        ? "delayed"
        : "stale";
  }
  return {
    key: row?.key || null,
    state,
    age_seconds: Number.isFinite(ageSeconds) ? ageSeconds : null,
    freshness_target_seconds: Number.isFinite(targetSeconds) ? targetSeconds : null,
    generated_at: row?.generated_at || null,
  };
}

function worstFreshness(states = []) {
  const rank = { fresh: 0, delayed: 1, stale: 2, unavailable: 3, unknown: 3 };
  return states.reduce((worst, state) => (
    (rank[state] ?? 3) > (rank[worst] ?? 3) ? state : worst
  ), states.length ? "fresh" : "unavailable");
}

async function handleHealth(request, env = {}) {
  const context = createTerminalRequestContext({
    request,
    route: "health",
    buildId: String(env.RAVENOS_PUBLIC_BUILD_ID || ""),
    schemaVersion: "customer_trade_terminal_health_snapshot.v1",
    clientOperationType: "health_check",
  });
  const accountsEnabled = customerAccountsEnabled(env);
  const billingEnabled = customerBillingEnabled(env);
  const stripeConfigured = billingEnabled && Boolean(env.STRIPE_SECRET_KEY || env.STRIPE_API_KEY);
  const tokenConfigured = accountsEnabled && Boolean(env.RAVENOS_SOLANA_MINT && env.RAVENOS_SOLANA_RPC_URL);
  const dbConfigured = accountsEnabled && Boolean(env.RAVENOS_DB);
  const [manifestResult, statusResult, terminalHealthResult, narratorPayload] = await Promise.all([
    loadOriginControlDocument({ env, key: "manifest" }),
    loadOriginControlDocument({ env, key: "status" }),
    loadOriginControlDocument({ env, key: "terminal_health" }),
    readAssetPayload(env, request, "/ravenos/ravenos_narrator_terminal.json"),
  ]);
  const manifest = manifestResult.ok ? sanitizeOriginControlDocument("manifest", manifestResult.payload) : null;
  const projectionStatus = statusResult.ok ? sanitizeOriginControlDocument("status", statusResult.payload) : null;
  const terminalHealth = terminalHealthResult.ok ? sanitizeOriginControlDocument("terminal_health", terminalHealthResult.payload) : null;
  const endpointHealth = (manifest?.endpoints || []).map(manifestEndpointHealth);
  const coreKeys = new Set(["brief", "replay", "outcomes", "memory", "behavior", "perps", "opportunities", "claims"]);
  const coreEndpointHealth = endpointHealth.filter((row) => coreKeys.has(row.key));
  const researchEndpoint = endpointHealth.find((row) => row.key === "research") || {
    key: "research",
    state: "unavailable",
    age_seconds: null,
    freshness_target_seconds: null,
    generated_at: null,
  };
  const intelligenceState = coreEndpointHealth.length === coreKeys.size
    ? worstFreshness(coreEndpointHealth.map((row) => row.state))
    : "unavailable";
  const narratorFreshness = projectionFreshness({
    generated_at: narratorPayload?.generated_at || narratorPayload?.updated_at,
    freshness_target_seconds: 3600,
  }, { defaultTargetSeconds: 3600 });
  const marketState = String(terminalHealth?.market_data_availability || "unavailable");
  const projectionState = manifestResult.ok
    && statusResult.ok
    && projectionStatus?.private_leak_guard_passed
    && Number(projectionStatus.endpoints_failed || 0) === 0
      ? "operational"
      : manifestResult.ok || statusResult.ok
        ? "degraded"
        : "unavailable";
  const checks = {
    worker: "ok",
    assets: env.ASSETS ? "ok" : "unavailable",
    customerAccounts: accountsEnabled ? "enabled" : "not_configured",
    accessApi: accountsEnabled ? "enabled" : "not_configured",
    hyperliquid: "configured_public_endpoint",
    dexscreener: "configured_public_endpoint",
    stripe: stripeConfigured ? "configured" : "not_configured",
    tokenAccess: tokenConfigured ? "configured" : "not_configured",
    database: dbConfigured ? "configured" : "not_configured",
  };
  const requiredHealthy = checks.worker === "ok" && checks.assets === "ok";
  const status = !requiredHealthy
    ? "unavailable"
    : intelligenceState === "fresh" && marketState === "fresh" && narratorFreshness.state === "fresh" && projectionState === "operational"
      ? "ok"
      : "degraded";
  return terminalJson(context, {
    ok: requiredHealthy,
    status,
    service: "ravenos-public",
    timestamp: new Date().toISOString(),
    health_contract_version: "ravenos.health.v2",
    process_health: {
      state: requiredHealthy ? "operational" : "unavailable",
      checks,
    },
    market_data_health: {
      state: marketState,
      generated_at: terminalHealth?.generated_at || null,
      terminal_availability: terminalHealth?.terminal_availability || "unknown",
      component_states: Array.isArray(terminalHealth?.components)
        ? Object.fromEntries(terminalHealth.components.map((row) => [String(row?.component || "unknown"), String(row?.state || "unknown")]))
        : {},
    },
    intelligence_freshness: {
      state: intelligenceState,
      core_endpoints: coreEndpointHealth,
      research: researchEndpoint,
      note: researchEndpoint.state === "stale" ? "Research is historical and is not counted as current intelligence." : null,
    },
    narrator_freshness: {
      state: narratorFreshness.state,
      generated_at: narratorFreshness.generated_at,
      age_seconds: narratorFreshness.age_seconds,
      freshness_target_seconds: narratorFreshness.target_seconds,
      reason: narratorFreshness.reason,
    },
    projection_health: {
      state: projectionState,
      generated_at: projectionStatus?.generated_at || manifest?.generated_at || null,
      endpoints_published: projectionStatus?.endpoints_published ?? endpointHealth.length,
      endpoints_failed: projectionStatus?.endpoints_failed ?? null,
      private_leak_guard_passed: projectionStatus?.private_leak_guard_passed ?? false,
      source_status: statusResult.ok ? "current_public_origin" : "unavailable",
      manifest_status: manifestResult.ok ? "current_public_origin" : "unavailable",
    },
    publisher_health: {
      state: "unknown",
      reason: "repository_publisher_state_not_exposed_to_worker",
      note: "The protected public-origin projection is authoritative for current Worker intelligence.",
    },
    checks,
    terminal_diagnostics: getTerminalDiagnosticsSummary(),
  }, { status: requiredHealthy ? 200 : 503, headers: { "cache-control": "no-store" } }, {
    resultCategory: status === "ok" ? "ok" : "degraded",
    degradedReason: requiredHealthy ? null : "required_health_checks_failed",
  });
}

function handleTradeFlags(env = {}) {
  const context = createTerminalRequestContext({
    route: "trade_flags",
    buildId: String(env.RAVENOS_PUBLIC_BUILD_ID || ""),
    schemaVersion: "customer_trade_flags.v1",
    clientOperationType: "flags",
  });
  const flags = resolveCustomerTradeFlags(env);
  return terminalJson(context, {
    ok: true,
    quote_only: true,
    signing_available: false,
    submission_available: false,
    fees_enabled: false,
    flags,
  }, { status: 200 }, { resultCategory: "ok" });
}

function quoteFeatureDisabled(flags) {
  return !flags.RAVENOS_CUSTOMER_TRADE_UI_ENABLE || !flags.RAVENOS_CUSTOMER_TRADE_QUOTE_ENABLE;
}

async function handleTradeQuote(request, env = {}) {
  const buildId = await terminalBuildId(env, request);
  const context = createTerminalRequestContext({
    request,
    route: "trade_quote",
    buildId,
    schemaVersion: "customer_trade_quote_response.v1",
    clientOperationType: "quote_request",
    providerComponent: "jupiter_direct_quote",
  });
  const flags = resolveCustomerTradeFlags(env);
  if (quoteFeatureDisabled(flags)) {
    return terminalJson(context, {
      ok: false,
      error: "customer_trade_quote_disabled",
      quote_only: true,
      signing_disabled: true,
      submission_disabled: true,
      message: "Quote-only preview. No transaction will be submitted.",
      flags,
    }, { status: 403 }, { resultCategory: "disabled", degradedReason: "customer_trade_quote_disabled" });
  }
  if (!flags.RAVENOS_CUSTOMER_TRADE_SOLANA_ENABLE) {
    return terminalJson(context, {
      ok: false,
      error: "customer_trade_solana_quote_disabled",
      quote_only: true,
      signing_disabled: true,
      submission_disabled: true,
      message: "Solana quote preview is disabled.",
      flags,
    }, { status: 403 }, { resultCategory: "disabled", degradedReason: "customer_trade_solana_quote_disabled" });
  }
  return withOperationBudget(async () => {
    let body;
    try {
      body = await parseBoundedJsonBody(request, { max_bytes: routeBudget("trade_quote").max_request_bytes });
    } catch (error) {
      const badType = error?.code === "unsupported_content_type";
      return terminalJson(context, {
        ok: false,
        error: error?.code === "request_too_large"
          ? "quote_request_too_large"
          : badType
            ? "quote_request_unsupported_content_type"
            : "invalid_quote_request_json",
        quote_only: true,
        signing_disabled: true,
        submission_disabled: true,
        message: error?.code === "request_too_large"
          ? "Quote request exceeds byte budget."
          : badType
            ? "Quote request must use JSON content."
            : "Invalid quote request.",
        flags,
      }, { status: error?.code === "request_too_large" ? 413 : badType ? 415 : 400 }, {
        resultCategory: "validation_failed",
        degradedReason: error?.code || "invalid_quote_request_json",
      });
    }
    const out = await getDirectSolanaQuote(body, {
      buildId,
      fetchImpl: fetch,
      fixtureMode: env.RAVENOS_CUSTOMER_TRADE_FIXTURE_MODE,
    });
    const status = out.ok ? 200 : (
      out.error === "quote_provider_rate_limited" ? 429 :
      out.error === "quote_provider_timeout" ? 504 :
      out.error === "quote_provider_malformed" ? 502 :
      out.error?.startsWith("quote_provider_http_") ? 502 :
      out.error === "quote_expired" ? 409 :
      out.error === "unsupported_chain" || out.error === "unsupported_pair" || out.error === "unsupported_asset" || out.error === "unsupported_slippage_bps" || out.error === "amount_below_minimum" || out.error === "amount_above_maximum" || out.error === "input_asset_decimal_mismatch" || out.error === "display_amount_mismatch" || out.error === "display_amount_precision_exceeds_decimals" || out.error === "invalid_display_amount" || out.error?.startsWith("invalid_base_units") ? 400 :
      502
    );
    return terminalJson(context, {
      ...out,
      flags,
    }, { status, headers: { "cache-control": "no-store" } }, {
      resultCategory: out.ok ? (out.from_cache ? "cache_hit" : "ok") : "provider_error",
      degradedReason: out.ok ? null : out.error,
      providerComponent: "jupiter_direct_quote",
    });
  }, {
    timeout_ms: routeBudget("trade_quote").timeout_ms,
    on_timeout: () => terminalJson(context, {
      ok: false,
      error: "quote_route_timeout",
      quote_only: true,
      signing_disabled: true,
      submission_disabled: true,
      message: "Quote request timed out.",
      flags,
    }, { status: 504 }, { resultCategory: "timeout", degradedReason: "quote_route_timeout", providerComponent: "jupiter_direct_quote" }),
  });
}

async function handleTradeInspect(request, env = {}) {
  const buildId = await terminalBuildId(env, request);
  const context = createTerminalRequestContext({
    request,
    route: "trade_inspect",
    buildId,
    schemaVersion: "customer_trade_transaction_inspection.v1",
    clientOperationType: "route_inspection",
    providerComponent: "transaction_construction",
  });
  const flags = resolveCustomerTradeFlags(env);
  if (quoteFeatureDisabled(flags)) {
    return terminalJson(context, {
      ok: false,
      error: "customer_trade_quote_disabled",
      quote_only: true,
      signing_disabled: true,
      submission_disabled: true,
      message: "Quote-only preview. No transaction will be submitted.",
      flags,
    }, { status: 403 }, { resultCategory: "disabled", degradedReason: "customer_trade_quote_disabled" });
  }
  if (!flags.RAVENOS_CUSTOMER_TRADE_SOLANA_ENABLE) {
    return terminalJson(context, {
      ok: false,
      error: "customer_trade_solana_quote_disabled",
      quote_only: true,
      signing_disabled: true,
      submission_disabled: true,
      message: "Solana quote preview is disabled.",
      flags,
    }, { status: 403 }, { resultCategory: "disabled", degradedReason: "customer_trade_solana_quote_disabled" });
  }
  return withOperationBudget(async () => {
    let body;
    try {
      body = await parseBoundedJsonBody(request, { max_bytes: routeBudget("trade_inspect").max_request_bytes });
    } catch (error) {
      const badType = error?.code === "unsupported_content_type";
      return terminalJson(context, {
        ok: false,
        error: error?.code === "request_too_large"
          ? "inspection_request_too_large"
          : badType
            ? "inspection_request_unsupported_content_type"
            : "invalid_inspection_request_json",
        quote_only: true,
        signing_disabled: true,
        submission_disabled: true,
        message: error?.code === "request_too_large"
          ? "Inspection request exceeds byte budget."
          : badType
            ? "Inspection request must use JSON content."
            : "Invalid inspection request.",
        flags,
      }, { status: error?.code === "request_too_large" ? 413 : badType ? 415 : 400 }, {
        resultCategory: "validation_failed",
        degradedReason: error?.code || "invalid_inspection_request_json",
      });
    }
    const out = await buildSolanaTransactionInspection(body, {
      buildId,
      fetchImpl: fetch,
      fixtureMode: env.RAVENOS_CUSTOMER_TRADE_FIXTURE_MODE,
    });
    const status = out.ok ? 200 : (
      out.error === "quote_expired" ? 409 :
      out.error === "transaction_construction_timeout" ? 504 :
      out.error === "transaction_construction_malformed" ? 502 :
      out.error === "invalid_quote_payload" ? 400 :
      502
    );
    return terminalJson(context, {
      ...out,
      flags,
    }, { status, headers: { "cache-control": "no-store" } }, {
      resultCategory: out.ok ? "ok" : "provider_error",
      degradedReason: out.ok ? null : out.error,
      providerComponent: "transaction_construction",
    });
  }, {
    timeout_ms: routeBudget("trade_inspect").timeout_ms,
    on_timeout: () => terminalJson(context, {
      ok: false,
      error: "inspection_route_timeout",
      quote_only: true,
      signing_disabled: true,
      submission_disabled: true,
      message: "Route inspection timed out.",
      flags,
    }, { status: 504 }, { resultCategory: "timeout", degradedReason: "inspection_route_timeout", providerComponent: "transaction_construction" }),
  });
}

async function handleTradeReview(request, env = {}) {
  const buildId = await terminalBuildId(env, request);
  const context = createTerminalRequestContext({
    request,
    route: request.method === "GET" ? "trade_review_get" : "trade_review_post",
    buildId,
    schemaVersion: "customer_trade_terminal_review_packet.v1",
    clientOperationType: request.method === "GET" ? "review_proof_lookup" : "review_packet_create",
    providerComponent: "evidence_persistence",
  });
  const flags = resolveCustomerTradeFlags(env);
  if (request.method === "GET") {
    const url = new URL(request.url);
    const evidenceId = String(url.searchParams.get("id") || "").trim();
    if (!evidenceId) {
      return terminalJson(context, {
        ok: false,
        error: "missing_evidence_id",
        quote_only: true,
        signing_disabled: true,
        submission_disabled: true,
        message: "Evidence ID required.",
        flags,
      }, { status: 400 }, { resultCategory: "validation_failed", degradedReason: "missing_evidence_id" });
    }
    const proof = await lookupReviewPacket(evidenceId, { env }).catch(() => null);
    if (!proof) {
      return terminalJson(context, {
        ok: false,
        error: "review_packet_not_found",
        quote_only: true,
        signing_disabled: true,
        submission_disabled: true,
        message: "Review proof unavailable.",
        flags,
      }, { status: 404 }, { resultCategory: "not_found", degradedReason: "review_packet_not_found", providerComponent: "evidence_persistence" });
    }
    return terminalJson(context, {
      ok: true,
      quote_only: true,
      signing_disabled: true,
      submission_disabled: true,
      proof,
      flags,
    }, { status: 200, headers: { "cache-control": "public, max-age=60, stale-while-revalidate=120" } }, {
      resultCategory: "ok",
      providerComponent: "evidence_persistence",
    });
  }
  if (quoteFeatureDisabled(flags)) {
    return terminalJson(context, {
      ok: false,
      error: "customer_trade_quote_disabled",
      quote_only: true,
      signing_disabled: true,
      submission_disabled: true,
      message: "Quote-only preview. No transaction will be submitted.",
      flags,
    }, { status: 403 }, { resultCategory: "disabled", degradedReason: "customer_trade_quote_disabled" });
  }
  return withOperationBudget(async () => {
    let body;
    try {
      body = await parseBoundedJsonBody(request, { max_bytes: routeBudget("trade_review_post").max_request_bytes });
    } catch (error) {
      const badType = error?.code === "unsupported_content_type";
      return terminalJson(context, {
        ok: false,
        error: error?.code === "request_too_large"
          ? "review_request_too_large"
          : badType
            ? "review_request_unsupported_content_type"
            : "invalid_review_request_json",
        quote_only: true,
        signing_disabled: true,
        submission_disabled: true,
        message: error?.code === "request_too_large"
          ? "Review request exceeds byte budget."
          : badType
            ? "Review request must use JSON content."
            : "Invalid review request.",
        flags,
      }, { status: error?.code === "request_too_large" ? 413 : badType ? 415 : 400 }, {
        resultCategory: "validation_failed",
        degradedReason: error?.code || "invalid_review_request_json",
      });
    }
    const review = await createAndPersistReviewPacket(body, {
      env,
      buildId,
      marketContext: body.market_context_reference || body.market_context || null,
    });
    const status = review.ok ? 200 : 503;
    return terminalJson(context, {
      ...review,
      quote_only: true,
      signing_disabled: true,
      submission_disabled: true,
      flags,
    }, { status }, {
      resultCategory: review.ok ? "ok" : "persistence_failed",
      degradedReason: review.ok ? null : review.error,
      providerComponent: "evidence_persistence",
    });
  }, {
    timeout_ms: routeBudget("trade_review_post").timeout_ms,
    on_timeout: () => terminalJson(context, {
      ok: false,
      error: "review_route_timeout",
      quote_only: true,
      signing_disabled: true,
      submission_disabled: true,
      message: "Review packet creation timed out.",
      flags,
    }, { status: 504 }, { resultCategory: "timeout", degradedReason: "review_route_timeout", providerComponent: "evidence_persistence" }),
  });
}

async function handlePublicArtifact(env, request, pathname, key, assetPath, fallback) {
  const result = await readPublicProjection(env, request, key, assetPath);
  if (!result.available) {
    return json({ ok: false, error: "projection_unavailable", ...fallback, delivery: result.delivery }, {
      status: 503,
      headers: projectionRouteHeaders(pathname, result.delivery),
    });
  }
  return json(attachDelivery(result.payload, result.delivery), {
    headers: projectionRouteHeaders(pathname, result.delivery),
  });
}

function researchFallback() {
  return {
    source: "last known research snapshot",
    stale: true,
    freshness_age_seconds: null,
    research_state: "unavailable",
    latest_completed_cohort: null,
    current_forming_cohort: null,
    findings_count: null,
    forward_observations: null,
    sample_depth: { value: null, unit: "public research observations" },
    observation_window: { label: "sample forming", start: null, end: null },
    validation_window: { label: "pending", start: null, end: null },
    last_known_good_age_seconds: null,
    methodology_version: "ravenos_public_methodology_v2",
    artifact_version: "ravenos_research_public_origin_v1",
    historical_snapshot_available: false,
    data: {
      summary: {
        findings_reviewed: null,
        forward_observations: null,
        strongest_condition: "Current public research snapshot unavailable",
        weakest_condition: "No zero should be interpreted as measured evidence",
        sample_depth: null,
        product_state: "unavailable",
        caveat: "Research fallback is unavailable, not a measured zero.",
      },
      rows: [],
      modules: {},
    },
  };
}

async function handleResearch(request, env) {
  const result = await readPublicProjection(env, request, "research");
  if (result.available) {
    return json(attachDelivery(result.payload, result.delivery), {
      headers: projectionRouteHeaders("/api/research", result.delivery),
    });
  }
  return json({ ok: false, error: "projection_unavailable", ...researchFallback(), delivery: result.delivery }, {
    status: 503,
    headers: projectionRouteHeaders("/api/research", result.delivery),
  });
}

async function handleClaims(request, env, claimId = "") {
  const result = await readPublicProjection(env, request, "claims");
  const payload = result.payload;
  if (!result.available || !payload) {
    return json({
      ok: false,
      error: "projection_unavailable",
      data: { current_claims: [], claim_history: [], claim_observations: [], claim_settlements: [] },
      delivery: result.delivery,
    }, { status: 503, headers: projectionRouteHeaders("/api/claims", result.delivery) });
  }
  if (!claimId) {
    return json(attachDelivery(payload, result.delivery), {
      headers: projectionRouteHeaders("/api/claims", result.delivery),
    });
  }
  const data = payload.data || {};
  const claim = (data.claim_history || []).find((row) => row.claim_id === claimId) || (data.current_claims || []).find((row) => row.claim_id === claimId);
  if (!claim) return json({ ok: false, error: "claim_not_found", delivery: result.delivery }, { status: 404, headers: projectionRouteHeaders("/api/claims", result.delivery) });
  const observations = (data.claim_observations || []).filter((row) => row.claim_id === claimId);
  const settlements = (data.claim_settlements || []).filter((row) => row.claim_id === claimId);
  return json({
    ok: true,
    lineage_version: data.lineage_version,
    claim,
    observations,
    settlements,
    related_recent_reads: (data.recent_raven_reads || []).filter((row) => row.claim_id === claimId),
    delivery: result.delivery,
  }, { headers: projectionRouteHeaders("/api/claims", result.delivery) });
}

async function handleStatus(request, env) {
  const buildId = await terminalBuildId(env, request);
  const context = createTerminalRequestContext({
    request,
    route: "status",
    buildId,
    schemaVersion: "customer_trade_terminal_health_snapshot.v1",
    clientOperationType: "status_snapshot",
  });
  return withOperationBudget(async () => {
    const [originStatus, originTerminalHealth, claimsResult, buildPayload, embeddedStatus, embeddedTerminalHealth] = await Promise.all([
      loadOriginControlDocument({ env, key: "status" }),
      loadOriginControlDocument({ env, key: "terminal_health" }),
      readPublicProjection(env, request, "claims"),
      readAssetPayload(env, request, "/ravenos_build.json"),
      readAssetPayload(env, request, "/ravenos/status.json"),
      readAssetPayload(env, request, "/ravenos/terminal_health.json"),
    ]);
    const statusSource = originStatus.ok ? originStatus.payload : embeddedStatus;
    const statusPayload = sanitizeOriginControlDocument("status", statusSource);
    const terminalHealthPayload = originTerminalHealth.ok ? originTerminalHealth.payload : embeddedTerminalHealth;
    const statusDelivery = controlDelivery("projection_status", statusPayload, {
      source: originStatus.ok ? "current_public_origin" : statusPayload ? "embedded_snapshot" : "unavailable",
      reason: originStatus.ok ? null : originStatus.reason,
    });
    const terminalHealthDelivery = controlDelivery("terminal_health", terminalHealthPayload, {
      source: originTerminalHealth.ok ? "current_public_origin" : terminalHealthPayload ? "embedded_snapshot" : "unavailable",
      reason: originTerminalHealth.ok ? null : originTerminalHealth.reason,
      targetSeconds: 300,
    });
    const delivery = aggregateDeliveries([
      claimsResult,
      { delivery: statusDelivery },
      { delivery: terminalHealthDelivery },
    ]);
    if (!statusPayload) {
      return terminalJson(context, { ok: false, error: "projection_unavailable", status: "degraded", delivery }, {
        status: 503,
        headers: projectionRouteHeaders("/api/status", delivery),
      }, { resultCategory: "projection_unavailable", degradedReason: "status_projection_unavailable" });
    }
    const healthProjection = buildTerminalHealthProjection(terminalHealthPayload);
    const out = {
      ...statusPayload,
      public_build: buildPayload || null,
      schema_version: healthProjection.schema_version || statusPayload.schema_version || "customer_trade_terminal_health_snapshot.v1",
      generated_at: healthProjection.generated_at || statusPayload.generated_at || null,
      terminal_availability: healthProjection.terminal_availability,
      market_data_availability: healthProjection.market_data_availability,
      quote_availability: healthProjection.quote_availability,
      review_availability: healthProjection.review_availability,
      component_health: healthProjection.component_health,
      public_warnings: healthProjection.public_warnings,
      degraded_reasons: healthProjection.degraded_reasons,
      recovery_state: healthProjection.recovery_state,
      delivery,
    };
    if (claimsResult.payload?.data) {
      out.current_claim_heads = (claimsResult.payload.data.current_claims || []).map((row) => ({
        claim_id: row.claim_id,
        headline: row.headline,
        surface: row.surface,
        validation_status: row.validation_status,
      }));
    }
    return terminalJson(context, out, { headers: projectionRouteHeaders("/api/status", delivery) }, {
      resultCategory: out.terminal_availability === "fresh" ? "ok" : "degraded",
      degradedReason: out.degraded_reasons?.[0] || null,
    });
  }, {
    timeout_ms: routeBudget("status").timeout_ms,
    on_timeout: () => terminalJson(context, {
      ok: false,
      error: "status_route_timeout",
      status: "degraded",
    }, { status: 504, headers: { ...routeCacheHeaders("/api/status"), "x-ravenos-freshness": "unavailable" } }, {
      resultCategory: "timeout",
      degradedReason: "status_route_timeout",
    }),
  });
}

const CURRENT_OPPORTUNITY_SCHEMA = "ravenos_opportunity_census_public_origin_v1";
const CURRENT_OPPORTUNITY_DATA_SCHEMA = "ravenos_opportunity_census_public_v1";
const CURRENT_OPPORTUNITY_SOURCE = "raven_opportunity_projection";
const CURRENT_OPPORTUNITY_MAX_AGE_SECONDS = 3_600;

function validateCurrentOpportunityProjection(result, nowMs = Date.now()) {
  const payload = result?.payload;
  const delivery = result?.delivery;
  if (!result?.available || !payload?.data) {
    return { ok: false, reason: delivery?.reason || "current_opportunity_unavailable" };
  }
  if (
    delivery?.source !== "current_public_origin"
    || delivery?.fallback === true
    || delivery?.freshness_state !== "fresh"
  ) {
    return { ok: false, reason: delivery?.reason || "current_opportunity_delivery_rejected" };
  }
  if (
    payload.fallback === true
    || payload.source === "embedded_snapshot"
    || payload.delivery?.fallback === true
    || payload.delivery?.source === "embedded_snapshot"
  ) {
    return { ok: false, reason: "current_opportunity_fallback_rejected" };
  }
  if (
    payload.ok !== true
    || payload.safe_public !== true
    || payload.key !== "opportunities"
    || payload.schema_version !== CURRENT_OPPORTUNITY_SCHEMA
    || payload.redaction_policy !== "aggregate_public_market_context_only"
    || payload.source_artifact !== CURRENT_OPPORTUNITY_SOURCE
  ) {
    return { ok: false, reason: "current_opportunity_contract_rejected" };
  }
  const freshnessTargetSeconds = Number(payload.freshness_target_seconds);
  const generatedAt = String(payload.generated_at || "");
  const generatedMs = Date.parse(generatedAt);
  if (
    freshnessTargetSeconds !== CURRENT_OPPORTUNITY_MAX_AGE_SECONDS
    || !Number.isFinite(generatedMs)
    || generatedMs > nowMs + 300_000
    || nowMs - generatedMs > CURRENT_OPPORTUNITY_MAX_AGE_SECONDS * 1_000
  ) {
    return { ok: false, reason: "current_opportunity_freshness_rejected" };
  }
  const census = payload.data;
  if (
    census.schema_version !== CURRENT_OPPORTUNITY_DATA_SCHEMA
    || census.source_state !== "current"
    || String(census.generated_at || "") !== generatedAt
    || !census.opportunities
    || !Array.isArray(census.opportunities.rows)
  ) {
    return { ok: false, reason: "current_opportunity_schema_rejected" };
  }
  return { ok: true, payload, census };
}

function currentOnlyContext(result) {
  const delivery = result?.delivery;
  if (
    !result?.available
    || !result?.payload
    || delivery?.source !== "current_public_origin"
    || delivery?.fallback === true
    || delivery?.freshness_state !== "fresh"
  ) return null;
  return result.payload;
}

function requestedOpportunityIdentity(request) {
  const url = new URL(request.url);
  const instrumentId = String(url.searchParams.get("instrument_id") || "").trim().slice(0, 128);
  const instrument = String(url.searchParams.get("instrument") || "").trim().slice(0, 128);
  if (!instrumentId && !instrument) return null;
  return {
    instrument_id: instrumentId || null,
    instrument: instrument || null,
  };
}

function selectOpportunityRow(rows, requested) {
  if (!requested) return rows[0] || null;
  const requestedId = String(requested.instrument_id || "").toLowerCase();
  const requestedInstrument = String(requested.instrument || "").toUpperCase();
  return rows.find((row) => {
    const idMatches = !requestedId || String(row?.instrument_id || "").toLowerCase() === requestedId;
    const instrumentMatches = !requestedInstrument || String(row?.instrument || "").toUpperCase() === requestedInstrument;
    return idMatches && instrumentMatches;
  }) || null;
}

async function handleOpportunity(request, env) {
  const [opportunitiesResult, claimsResult, outcomesResult, behaviorResult] = await Promise.all([
    readPublicProjection(env, request, "opportunities"),
    readPublicProjection(env, request, "claims"),
    readPublicProjection(env, request, "outcomes"),
    readPublicProjection(env, request, "behavior"),
  ]);
  const currentProjection = validateCurrentOpportunityProjection(opportunitiesResult);
  const delivery = opportunitiesResult.delivery;
  if (!currentProjection.ok) {
    const unavailableDelivery = {
      ...delivery,
      source: "unavailable",
      freshness_state: "unavailable",
      fallback: false,
      reason: currentProjection.reason,
      rejected_source: delivery?.source || "unavailable",
      rejected_freshness_state: delivery?.freshness_state || "unavailable",
    };
    return json({
      ok: false,
      error: "opportunity_census_projection_unavailable",
      status: "unavailable",
      message: "The current Raven opportunity projection is unavailable; older claims are not substituted as current opportunities.",
      census: null,
      current_opportunity: null,
      selected_opportunity: null,
      historical_context: {
        current_data_substituted: false,
        replay_contract: "/api/replay",
      },
      rejection_reason: currentProjection.reason,
      delivery: unavailableDelivery,
    }, { status: 503, headers: projectionRouteHeaders("/api/opportunity", unavailableDelivery) });
  }
  const claimsPayload = currentOnlyContext(claimsResult);
  const outcomesPayload = currentOnlyContext(outcomesResult);
  const behaviorPayload = currentOnlyContext(behaviorResult);
  const contextDelivery = aggregateDeliveries([claimsResult, outcomesResult, behaviorResult]);
  const rows = currentProjection.census.opportunities.rows;
  const requested = requestedOpportunityIdentity(request);
  const selected = selectOpportunityRow(rows, requested);
  const current = ((claimsPayload?.data || {}).current_claims || []).find((row) => row.surface === "opportunity") || null;
  return json({
    ok: true,
    schema_version: "ravenos.opportunity_workspace.v2",
    generated_at: currentProjection.payload.generated_at,
    source_updated_at: currentProjection.payload.updated_at || null,
    source_artifact: currentProjection.payload.source_artifact,
    evidence_contract_version: "1.0",
    claim_lineage_version: (claimsPayload?.data || {}).lineage_version || null,
    census: currentProjection.census,
    current_claim_context: current,
    current_opportunity: selected,
    selected_opportunity: selected,
    selection: {
      requested: Boolean(requested),
      requested_identity: requested,
      state: requested ? (selected ? "matched" : "not_present") : (selected ? "default_current_row" : "no_current_rows"),
      silently_replaced: false,
    },
    recent_raven_reads: (claimsPayload?.data || {}).recent_raven_reads || [],
    outcomes_context: outcomesPayload?.data?.recent_raven_reads?.slice(0, 12) || [],
    behavior_context: behaviorPayload?.data || null,
    context_delivery: contextDelivery,
    delivery,
  }, { headers: projectionRouteHeaders("/api/opportunity", delivery) });
}

async function handleTerminal(request, env) {
  const [briefResult, perpsResult, opportunitiesResult, claimsResult] = await Promise.all([
    readPublicProjection(env, request, "brief"),
    readPublicProjection(env, request, "perps"),
    readPublicProjection(env, request, "opportunities"),
    readPublicProjection(env, request, "claims"),
  ]);
  const briefPayload = briefResult.payload;
  const perpsPayload = perpsResult.payload;
  const opportunitiesPayload = opportunitiesResult.payload;
  const claimsPayload = claimsResult.payload;
  const delivery = aggregateDeliveries([briefResult, perpsResult, opportunitiesResult, claimsResult]);
  return json({
    ok: Boolean(briefPayload || perpsPayload || opportunitiesPayload || claimsPayload),
    evidence_contract_version: "1.0",
    claim_lineage_version: (claimsPayload?.data || {}).lineage_version || "2.0",
    brief: briefPayload?.data || null,
    perps_context: perpsPayload?.data || null,
    opportunity_census: opportunitiesPayload?.data || null,
    current_claims: (claimsPayload?.data || {}).current_claims || [],
    delivery,
  }, { status: (briefPayload || perpsPayload || opportunitiesPayload || claimsPayload) ? 200 : 503, headers: projectionRouteHeaders("/api/terminal", delivery) });
}

async function handlePerpInstrumentContext(request, env) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol") || url.searchParams.get("coin") || "";
  const coin = normalizeHyperliquidCoin(symbol);
  if (!coin) return json({ ok: false, error: "invalid_instrument" }, { status: 400 });
  const [perpsResult, marketResult] = await Promise.all([
    readPublicProjection(env, request, "perps"),
    hyperliquidInstrument(coin).catch(() => ({
      ok: false,
      error: "hyperliquid_instrument_unavailable",
      components: { market: "unavailable", book: "unavailable", tape: "unavailable" },
    })),
  ]);
  const payload = buildPerpTerminalContext({
    publicPerpsPayload: perpsResult.payload,
    marketPayload: marketResult,
    symbol: coin,
  });
  payload.delivery = perpsResult.delivery;
  const status = payload.ok ? 200 : perpsResult.available ? 503 : 502;
  return json(payload, {
    status,
    headers: projectionRouteHeaders("/api/perps/instrument", perpsResult.delivery),
  });
}

async function handleTerminalChart(request, env = {}) {
  const context = createTerminalRequestContext({
    request,
    route: "terminal_chart",
    buildId: String(env.RAVENOS_PUBLIC_BUILD_ID || ""),
    schemaVersion: "customer_trade_terminal_market_context.v1",
    clientOperationType: "chart_request",
    providerComponent: "market_chart_data",
  });
  const url = new URL(request.url);
  return withOperationBudget(async () => {
    try {
      const payload = await terminalChartPayload({
        env,
        market: url.searchParams.get("market") || "",
        asset: url.searchParams.get("asset") || "",
        timeframe: url.searchParams.get("timeframe") || "1h",
        chain: url.searchParams.get("chain") || "",
        pairAddress: url.searchParams.get("pair_address") || "",
        tokenAddress: url.searchParams.get("token_address") || "",
        quoteAddress: url.searchParams.get("quote_address") || "",
        instrumentScope: url.searchParams.get("instrument_scope") || "exact_pool",
        before: url.searchParams.get("before"),
        limit: url.searchParams.get("limit"),
      });
      return terminalJson(context, payload, { headers: routeCacheHeaders("/api/terminal/chart") }, {
        resultCategory: payload.ok ? "ok" : "degraded",
        degradedReason: chartDegradedReason(payload),
        providerComponent: "market_chart_data",
      });
    } catch (error) {
      return terminalJson(context, unresolvedChart(url.searchParams.get("asset") || "", "Current chart coverage is unavailable.", {
        source: "Coverage Developing",
        sourceType: "coverage_developing",
        timeframe: url.searchParams.get("timeframe") || "1h",
      }), { status: 503, headers: routeCacheHeaders("/api/terminal/chart") }, {
        resultCategory: "provider_error",
        degradedReason: "chart_provider_unavailable",
        providerComponent: "market_chart_data",
      });
    }
  }, {
    timeout_ms: routeBudget("terminal_chart").timeout_ms,
    on_timeout: () => terminalJson(context, unresolvedChart(url.searchParams.get("asset") || "", "Current chart coverage is temporarily unavailable.", {
      source: "Coverage Developing",
      sourceType: "coverage_developing",
      timeframe: url.searchParams.get("timeframe") || "1h",
    }), { status: 504, headers: routeCacheHeaders("/api/terminal/chart") }, {
      resultCategory: "timeout",
      degradedReason: "chart_route_timeout",
      providerComponent: "market_chart_data",
    }),
  });
}

async function handleChain(request, env, slug) {
  const info = chainRouteInfo(slug);
  if (!info) return json({ ok: false, error: "chain_not_supported" }, { status: 404 });
  const [claimsResult, outcomesResult, behaviorResult, replayResult, memoryResult] = await Promise.all([
    readPublicProjection(env, request, "claims"),
    readPublicProjection(env, request, "outcomes"),
    readPublicProjection(env, request, "behavior"),
    readPublicProjection(env, request, "replay"),
    readPublicProjection(env, request, "memory"),
  ]);
  const claimsPayload = claimsResult.payload;
  const outcomesPayload = outcomesResult.payload;
  const behaviorPayload = behaviorResult.payload;
  const replayPayload = replayResult.payload;
  const memoryPayload = memoryResult.payload;
  const delivery = aggregateDeliveries([claimsResult, outcomesResult, behaviorResult, replayResult, memoryResult]);
  const claimsData = claimsPayload?.data || {};
  const outcomesData = outcomesPayload?.data || {};
  const behaviorData = behaviorPayload?.data || {};
  const replayData = replayPayload?.data || {};
  const memoryData = memoryPayload?.data || {};
  const aliases = info.aliases;

  const currentClaim = (claimsData.current_claims || []).find((row) => chainMatches(row.market_scope?.chain, aliases)) || null;
  const behaviorRows = (behaviorData.rows || []).filter((row) => chainMatches(row.chain, aliases));
  const outcomeRows = (outcomesData.outcomes || []).filter((row) => chainMatches(row.chain, aliases));
  const replayRows = (replayData.comparables || []).filter((row) => chainMatches(row.chain, aliases));
  const bestBehavior = behaviorRows[0] || null;
  const weakestBehavior = [...behaviorRows].sort((a, b) => num(a.outcome_score) - num(b.outcome_score))[0] || null;
  const claimBand = currentClaim?.market_scope?.cap_band || bestBehavior?.cap_band || null;
  const matchedOutcomeRows = claimBand ? outcomeRows.filter((row) => String(row.cap_band || "") === String(claimBand)) : [];
  const latestValidation = [...(matchedOutcomeRows.length ? matchedOutcomeRows : outcomeRows)]
    .sort((a, b) => num(b.clean_sample || b.sample_size) - num(a.clean_sample || a.sample_size))[0] || null;
  const replayContext = replayRows[0] || null;
  const memoryContext = (memoryData.cards || [])[0] || null;

  if (!claimsPayload && !behaviorRows.length && !outcomeRows.length && !replayRows.length) {
    return json({
      ok: false,
      error: "asset_unavailable",
      chain: slug,
      chain_label: info.label,
      coverage: "developing",
      current_summary: `${info.label} coverage is developing.`,
      current_read: "Verified public chain context is still forming.",
      delivery,
    }, { status: 503, headers: projectionRouteHeaders(`/api/chains/${slug}`, delivery) });
  }

  return json({
    ok: true,
    chain: slug,
    chain_label: info.label,
    evidence_contract_version: "1.0",
    claim_lineage_version: claimsData.lineage_version || "2.0",
    generated_at: claimsPayload?.generated_at || outcomesPayload?.generated_at || behaviorPayload?.generated_at || null,
    coverage: behaviorRows.length || outcomeRows.length || replayRows.length ? "active" : "developing",
    current_claim: currentClaim,
    current_summary: currentClaim?.headline || bestBehavior?.plain_language_summary || `${info.label} coverage is developing.`,
    current_read: currentClaim?.summary || bestBehavior?.participant_outcome_context || "Current chain synthesis is forming from public behavior, replay, and outcomes context.",
    best_surface: bestBehavior?.cap_band || latestValidation?.cap_band || null,
    weakest_surface: weakestBehavior?.cap_band || null,
    latest_validation: latestValidation
      ? {
          claim_id: latestValidation.claim_id,
          validation_status: latestValidation.validation_status,
          settled_result: latestValidation.direction,
          participant_outcome: latestValidation.participant_outcome,
          sample_size: latestValidation.sample_size,
          cap_band: latestValidation.cap_band,
          evidence_contract: latestValidation.evidence_contract,
        }
      : null,
    behavior_context: bestBehavior,
    replay_context: replayContext,
    memory_context: memoryContext,
    behavior_rows: behaviorRows,
    outcome_rows: outcomeRows,
    replay_rows: replayRows,
    delivery,
  }, { headers: projectionRouteHeaders(`/api/chains/${slug}`, delivery) });
}

async function routeApi(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/health" && request.method === "GET") return handleHealth(request, env);
  if (url.pathname === "/api/status" && request.method === "GET") return handleStatus(request, env);
  if (url.pathname === "/api/brief" && request.method === "GET") {
    return handlePublicArtifact(env, request, url.pathname, "brief", "/ravenos/brief.json", { status: "degraded", message: "Current brief forming." });
  }
  if (url.pathname === "/api/replay" && request.method === "GET") {
    return handlePublicArtifact(env, request, url.pathname, "replay", "/ravenos/replay.json", { status: "degraded", message: "Current replay context forming." });
  }
  if (url.pathname === "/api/outcomes" && request.method === "GET") {
    return handlePublicArtifact(env, request, url.pathname, "outcomes", "/ravenos/outcomes.json", { status: "degraded", message: "Current outcomes context forming." });
  }
  if (url.pathname === "/api/memory" && request.method === "GET") {
    return handlePublicArtifact(env, request, url.pathname, "memory", "/ravenos/memory.json", { status: "degraded", message: "Current memory context forming." });
  }
  if (url.pathname === "/api/behavior" && request.method === "GET") {
    return handlePublicArtifact(env, request, url.pathname, "behavior", "/ravenos/behavior.json", { status: "degraded", message: "Current behavior context forming." });
  }
  if (url.pathname === "/api/perps" && request.method === "GET") {
    return handlePublicArtifact(env, request, url.pathname, "perps", "/ravenos/perps.json", { status: "degraded", message: "Current perps context forming." });
  }
  if (url.pathname === "/api/perps/instrument" && request.method === "GET") return handlePerpInstrumentContext(request, env);
  if (url.pathname === "/api/research" && request.method === "GET") return handleResearch(request, env);
  if (url.pathname === "/api/claims" && request.method === "GET") return handleClaims(request, env);
  if (url.pathname.startsWith("/api/claims/") && request.method === "GET") return handleClaims(request, env, decodeURIComponent(url.pathname.split("/").pop() || ""));
  if (url.pathname === "/api/opportunity" && request.method === "GET") return handleOpportunity(request, env);
  if (url.pathname === "/api/terminal" && request.method === "GET") return handleTerminal(request, env);
  if (url.pathname === "/api/terminal/chart" && request.method === "GET") return handleTerminalChart(request, env);
  if (url.pathname.startsWith("/api/chains/") && request.method === "GET") return handleChain(request, env, decodeURIComponent(url.pathname.split("/").pop() || ""));
  if (url.pathname === "/api/trade/flags" && request.method === "GET") return handleTradeFlags(env);
  if (url.pathname === "/api/trade/quote" && request.method === "POST") return handleTradeQuote(request, env);
  if (url.pathname === "/api/trade/inspect" && request.method === "POST") return handleTradeInspect(request, env);
  if (url.pathname === "/api/trade/review" && (request.method === "POST" || request.method === "GET")) return handleTradeReview(request, env);
  if (url.pathname === "/api/access" && (request.method === "GET" || request.method === "POST")) {
    return customerAccountsEnabled(env) ? handleAccess(request, env) : customerFoundationUnavailable("customer_accounts_not_configured");
  }
  if (url.pathname === "/api/stripe/checkout" && request.method === "POST") {
    return customerBillingEnabled(env) ? handleCheckout(request, env) : customerFoundationUnavailable("billing_not_configured");
  }
  if (url.pathname === "/api/stripe/portal" && request.method === "POST") {
    return customerBillingEnabled(env) ? handlePortal(request, env) : customerFoundationUnavailable("billing_not_configured");
  }
  if (url.pathname === "/api/stripe/webhook" && request.method === "POST") {
    return customerBillingEnabled(env) ? handleWebhook(request, env) : customerFoundationUnavailable("billing_not_configured");
  }
  if (url.pathname === "/api/dexscreener/search" && request.method === "GET") {
    try {
      return json({ ok: true, results: (await resolveDexInput(url.searchParams.get("q") || "")).slice(0, 30) });
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "dexscreener_search_failed", results: [] }, { status: 502 });
    }
  }
  if (url.pathname === "/api/dexscreener/token" && request.method === "GET") {
    try {
      return json({ ok: true, results: await tokenDex(url.searchParams.get("chainId") || "", url.searchParams.get("tokenAddress") || "") });
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "dexscreener_token_failed", results: [] }, { status: 502 });
    }
  }
  if (url.pathname === "/api/dexscreener/pair" && request.method === "GET") {
    try {
      return json({ ok: true, results: await pairDex(url.searchParams.get("chainId") || "", url.searchParams.get("pairAddress") || "") });
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "dexscreener_pair_failed", results: [] }, { status: 502 });
    }
  }
  if (url.pathname === "/api/hyperliquid/perps" && request.method === "GET") {
    try {
      return json(await hyperliquidPerps());
    } catch {
      return json({ ok: false, provider: "Hyperliquid", coverage: "Unavailable", isLive: false, warning: "Hyperliquid unavailable", error: "hyperliquid_perps_unavailable", results: [] }, { status: 502 });
    }
  }
  if (url.pathname === "/api/hyperliquid/instrument" && request.method === "GET") {
    try {
      const payload = await hyperliquidInstrument(url.searchParams.get("symbol") || url.searchParams.get("coin") || "");
      return json(payload, { status: payload.status || (payload.ok ? 200 : 503), headers: routeCacheHeaders(url.pathname) });
    } catch {
      return json({
        ok: false,
        error: "hyperliquid_instrument_unavailable",
        components: { market: "unavailable", book: "unavailable", tape: "unavailable" },
      }, { status: 502, headers: routeCacheHeaders(url.pathname) });
    }
  }
  return json({ ok: false, error: "not_found" }, { status: 404 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/.git") || url.pathname.startsWith("/.wrangler")) {
      return new Response("Not found", { status: 404 });
    }
    if (url.pathname.startsWith("/api/")) return routeApi(request, env || {});
    if (["GET", "HEAD"].includes(request.method)) {
      const legacyRedirects = {
        "/pro": "/pricing/",
        "/pro/": "/pricing/",
        "/upgrade": "/pricing/",
        "/upgrade/": "/pricing/",
        "/token": "/terminal/",
        "/token/": "/terminal/",
      };
      const target = legacyRedirects[url.pathname];
      if (target) return applyAssetSecurityHeaders(Response.redirect(new URL(target, url), 308), url.pathname);
    }
    const assetResponse = await env.ASSETS.fetch(request);
    return applyAssetSecurityHeaders(assetResponse, url.pathname);
  },
};
