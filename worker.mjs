import { accessConfig, fetchSplTokenBalance, resolveAccessFromSignals } from "./lib/ravenos_access.mjs";
import {
  findSubscriptionStatus,
  subscriptionActiveFromRow,
  subscriptionConfig,
} from "./lib/ravenos_subscriptions.mjs";
import { processStripeWebhookEvent } from "./lib/ravenos_stripe_webhooks.mjs";
import { verifyWalletSignature, walletAuthMessage } from "./lib/solana_wallet_auth.mjs";
import { normalizeHyperliquidPerps } from "./lib/ravenos_perps_intelligence.mjs";
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
const HYPERLIQUID_INFO_URL = "https://api.hyperliquid.xyz/info";
const YAHOO_CHART_BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const EVM_CHAINS = ["base", "ethereum", "arbitrum", "optimism", "bsc", "polygon"];
const QUOTE_RANK = { USDC: 90, USDT: 85, SOL: 80, WETH: 80, ETH: 75, WSOL: 75 };
const CHAIN_ROUTE_MAP = {
  solana: { aliases: ["solana"], label: "Solana" },
  base: { aliases: ["base"], label: "Base" },
  ethereum: { aliases: ["eth", "ethereum"], label: "Ethereum" },
};

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
  const assetResponse = await env.ASSETS.fetch(new Request(new URL(assetPath, request.url).toString(), { method: "GET" }));
  if (!assetResponse.ok) return null;
  const payload = await assetResponse.json().catch(() => null);
  return payload && typeof payload === "object" ? payload : null;
}

function routeCacheHeaders(pathname) {
  if (pathname === "/api/terminal" || pathname === "/api/terminal/chart") return { "cache-control": "public, max-age=15, stale-while-revalidate=60" };
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
  const response = await fetch(HYPERLIQUID_INFO_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ type: "metaAndAssetCtxs" }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`hyperliquid_http_${response.status}`);
  const rows = normalizeHyperliquidPerps(payload);
  const result = {
    ok: true,
    provider: "Hyperliquid",
    coverage: "Live",
    isLive: true,
    lastUpdated: new Date().toISOString(),
    count: rows.length,
    results: rows,
  };
  hyperliquidCache.set(key, { payload: result, expires: now + 15_000 });
  return result;
}

function timeframeSpec(timeframe = "1h") {
  const tf = String(timeframe || "1h").toLowerCase();
  if (tf === "15m") return { yahooInterval: "15m", yahooRange: "5d", hyperInterval: "15m", lookbackMs: 3 * 24 * 60 * 60 * 1000 };
  if (tf === "4h") return { yahooInterval: "1h", yahooRange: "1mo", hyperInterval: "4h", lookbackMs: 21 * 24 * 60 * 60 * 1000 };
  if (tf === "1d") return { yahooInterval: "1d", yahooRange: "6mo", hyperInterval: "1d", lookbackMs: 180 * 24 * 60 * 60 * 1000 };
  return { yahooInterval: "1h", yahooRange: "1mo", hyperInterval: "1h", lookbackMs: 14 * 24 * 60 * 60 * 1000 };
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

async function fetchHyperliquidCandles(symbol, timeframe) {
  const spec = timeframeSpec(timeframe);
  const coin = String(symbol || "").replace(/-PERP$/i, "").trim().toUpperCase();
  const cacheKey = `hyper:${coin}:${spec.hyperInterval}`;
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
      const endTime = Date.now();
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
        maxItems: spec.hyperInterval === "15m" ? 480 : spec.hyperInterval === "1h" ? 360 : spec.hyperInterval === "4h" ? 240 : 220,
      });
      const observedAt = new Date().toISOString();
      const result = {
        ok: candles.length > 0,
        asset: `${coin}-PERP`,
        source: "Hyperliquid",
        source_type: "provider",
        source_label: "Live perps market price",
        coverage: candles.length ? "Live" : "Coverage Developing",
        stale: false,
        freshness_state: "fresh",
        timeframe: spec.hyperInterval,
        updated_at: observedAt,
        observed_at: observedAt,
        age_seconds: 0,
        build_id: null,
        candles,
      };
      cacheSet(terminalChartCache, cacheKey, result, 15_000);
      return result;
    },
  });
}

async function fetchYahooCandles(ticker, timeframe, { assetLabel = ticker, assetType = "equity" } = {}) {
  const spec = timeframeSpec(timeframe);
  const cacheKey = `yahoo:${ticker}:${spec.yahooInterval}:${spec.yahooRange}`;
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
      const candles = sanitizeChartCandles(timestamps.map((ts, index) => normalizeChartCandle({
        time: ts,
        open: quote.open?.[index],
        high: quote.high?.[index],
        low: quote.low?.[index],
        close: quote.close?.[index],
        volume: quote.volume?.[index],
      })).filter(Boolean), {
        maxItems: spec.yahooInterval === "15m" ? 480 : spec.yahooInterval === "1h" ? 360 : 220,
      });
      const observedAt = new Date().toISOString();
      const result = {
        ok: candles.length > 0,
        asset: assetLabel,
        source: "Yahoo Finance",
        source_type: "provider",
        source_label: assetType === "equity" || assetType === "etf" ? "Live market price" : "Live spot proxy price",
        coverage: candles.length ? "Live" : "Coverage Developing",
        stale: false,
        freshness_state: "fresh",
        timeframe: spec.yahooInterval,
        updated_at: observedAt,
        observed_at: observedAt,
        age_seconds: 0,
        build_id: null,
        candles,
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

async function terminalChartPayload({ market = "", asset = "", timeframe = "1h" } = {}) {
  const cleanAsset = String(asset || "").trim();
  const cleanMarket = String(market || "").trim().toLowerCase();
  if (!cleanAsset) return unresolvedChart(cleanAsset, "Select an asset.", { timeframe });
  if (cleanMarket === "perpetuals" || cleanAsset.endsWith("-PERP")) {
    return fetchHyperliquidCandles(cleanAsset, timeframe);
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
    return fetchYahooCandles(ticker, timeframe, { assetLabel: cleanAsset, assetType: ["SPY", "QQQ"].includes(ticker) ? "etf" : "equity" });
  }
  const spotMap = {
    "BTC Spot": "BTC-USD",
    "ETH Spot": "ETH-USD",
    "SOL Spot": "SOL-USD",
    "ARB Spot": "ARB-USD",
  };
  if (cleanMarket === "crypto_spot" && spotMap[cleanAsset]) {
    return fetchYahooCandles(spotMap[cleanAsset], timeframe, { assetLabel: cleanAsset, assetType: "crypto_spot" });
  }
  if (cleanMarket === "crypto_spot") {
    return unresolvedChart(cleanAsset, `${cleanAsset} does not yet have a reliable public candle feed in Terminal.`, {
      source: "Structure Proxy",
      sourceType: "structure_proxy",
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

function handleHealth(env = {}) {
  const context = createTerminalRequestContext({
    route: "health",
    buildId: String(env.RAVENOS_PUBLIC_BUILD_ID || ""),
    schemaVersion: "customer_trade_terminal_health_snapshot.v1",
    clientOperationType: "health_check",
  });
  const stripeConfigured = Boolean(env.STRIPE_SECRET_KEY || env.STRIPE_API_KEY);
  const tokenConfigured = Boolean(env.RAVENOS_SOLANA_MINT && env.RAVENOS_SOLANA_RPC_URL);
  const dbConfigured = Boolean(env.RAVENOS_DB);
  const checks = {
    worker: "ok",
    assets: env.ASSETS ? "ok" : "unavailable",
    accessApi: "ok",
    hyperliquid: "configured_public_endpoint",
    dexscreener: "configured_public_endpoint",
    stripe: stripeConfigured ? "configured" : "not_configured",
    tokenAccess: tokenConfigured ? "configured" : "not_configured",
    database: dbConfigured ? "configured" : "not_configured",
  };
  const requiredHealthy = checks.worker === "ok" && checks.assets === "ok" && checks.accessApi === "ok";
  return terminalJson(context, {
    ok: requiredHealthy,
    status: requiredHealthy ? "ok" : "degraded",
    service: "ravenos-public",
    timestamp: new Date().toISOString(),
    checks,
    terminal_diagnostics: getTerminalDiagnosticsSummary(),
  }, { status: requiredHealthy ? 200 : 503 }, {
    resultCategory: requiredHealthy ? "ok" : "degraded",
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

async function handlePublicArtifact(env, request, pathname, assetPath, fallback) {
  const payload = await readAssetPayload(env, request, assetPath);
  if (!payload) return json({ ok: false, error: "asset_unavailable", ...fallback }, { status: 503, headers: routeCacheHeaders(pathname) });
  return json(payload, { headers: routeCacheHeaders(pathname) });
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
  const payload = await readAssetPayload(env, request, "/ravenos/research.json");
  if (payload) return json(payload, { headers: routeCacheHeaders("/api/research") });
  return json({ ok: false, error: "asset_unavailable", ...researchFallback() }, { status: 503, headers: routeCacheHeaders("/api/research") });
}

async function handleClaims(request, env, claimId = "") {
  const payload = await readAssetPayload(env, request, "/ravenos/claims.json");
  if (!payload) {
    return json({ ok: false, error: "asset_unavailable", data: { current_claims: [], claim_history: [], claim_observations: [], claim_settlements: [] } }, { status: 503, headers: routeCacheHeaders("/api/claims") });
  }
  if (!claimId) return json(payload, { headers: routeCacheHeaders("/api/claims") });
  const data = payload.data || {};
  const claim = (data.claim_history || []).find((row) => row.claim_id === claimId) || (data.current_claims || []).find((row) => row.claim_id === claimId);
  if (!claim) return json({ ok: false, error: "claim_not_found" }, { status: 404, headers: routeCacheHeaders("/api/claims") });
  const observations = (data.claim_observations || []).filter((row) => row.claim_id === claimId);
  const settlements = (data.claim_settlements || []).filter((row) => row.claim_id === claimId);
  return json({
    ok: true,
    lineage_version: data.lineage_version,
    claim,
    observations,
    settlements,
    related_recent_reads: (data.recent_raven_reads || []).filter((row) => row.claim_id === claimId),
  }, { headers: routeCacheHeaders("/api/claims") });
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
    const [statusPayload, claimsPayload, buildPayload, terminalHealthPayload] = await Promise.all([
      readAssetPayload(env, request, "/ravenos/status.json"),
      readAssetPayload(env, request, "/ravenos/claims.json"),
      readAssetPayload(env, request, "/ravenos_build.json"),
      readAssetPayload(env, request, "/ravenos/terminal_health.json"),
    ]);
    if (!statusPayload) {
      return terminalJson(context, { ok: false, error: "asset_unavailable", status: "degraded" }, {
        status: 503,
        headers: routeCacheHeaders("/api/status"),
      }, { resultCategory: "asset_unavailable", degradedReason: "status_asset_unavailable" });
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
    };
    if (claimsPayload?.data) {
      out.current_claim_heads = (claimsPayload.data.current_claims || []).map((row) => ({
        claim_id: row.claim_id,
        headline: row.headline,
        surface: row.surface,
        validation_status: row.validation_status,
      }));
    }
    return terminalJson(context, out, { headers: routeCacheHeaders("/api/status") }, {
      resultCategory: out.terminal_availability === "fresh" ? "ok" : "degraded",
      degradedReason: out.degraded_reasons?.[0] || null,
    });
  }, {
    timeout_ms: routeBudget("status").timeout_ms,
    on_timeout: () => terminalJson(context, {
      ok: false,
      error: "status_route_timeout",
      status: "degraded",
    }, { status: 504, headers: routeCacheHeaders("/api/status") }, {
      resultCategory: "timeout",
      degradedReason: "status_route_timeout",
    }),
  });
}

async function handleOpportunity(request, env) {
  const [claimsPayload, outcomesPayload, behaviorPayload] = await Promise.all([
    readAssetPayload(env, request, "/ravenos/claims.json"),
    readAssetPayload(env, request, "/ravenos/outcomes.json"),
    readAssetPayload(env, request, "/ravenos/behavior.json"),
  ]);
  if (!claimsPayload) {
    return json({ ok: false, error: "asset_unavailable", status: "degraded", message: "Current opportunity surface forming." }, { status: 503, headers: routeCacheHeaders("/api/opportunity") });
  }
  const current = ((claimsPayload.data || {}).current_claims || []).find((row) => row.surface === "opportunity") || null;
  return json({
    ok: true,
    generated_at: claimsPayload.generated_at || claimsPayload.updated_at || null,
    evidence_contract_version: "1.0",
    claim_lineage_version: (claimsPayload.data || {}).lineage_version || "2.0",
    current_opportunity: current,
    recent_raven_reads: (claimsPayload.data || {}).recent_raven_reads || [],
    outcomes_context: outcomesPayload?.data?.recent_raven_reads?.slice(0, 12) || [],
    behavior_context: behaviorPayload?.data || null,
  }, { headers: routeCacheHeaders("/api/opportunity") });
}

async function handleTerminal(request, env) {
  const [briefPayload, perpsPayload, claimsPayload] = await Promise.all([
    readAssetPayload(env, request, "/ravenos/brief.json"),
    readAssetPayload(env, request, "/ravenos/perps.json"),
    readAssetPayload(env, request, "/ravenos/claims.json"),
  ]);
  return json({
    ok: true,
    evidence_contract_version: "1.0",
    claim_lineage_version: (claimsPayload?.data || {}).lineage_version || "2.0",
    brief: briefPayload?.data || null,
    perps_context: perpsPayload?.data || null,
    current_claims: (claimsPayload?.data || {}).current_claims || [],
  }, { headers: routeCacheHeaders("/api/terminal") });
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
        market: url.searchParams.get("market") || "",
        asset: url.searchParams.get("asset") || "",
        timeframe: url.searchParams.get("timeframe") || "1h",
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
  const [claimsPayload, outcomesPayload, behaviorPayload, replayPayload, memoryPayload] = await Promise.all([
    readAssetPayload(env, request, "/ravenos/claims.json"),
    readAssetPayload(env, request, "/ravenos/outcomes.json"),
    readAssetPayload(env, request, "/ravenos/behavior.json"),
    readAssetPayload(env, request, "/ravenos/replay.json"),
    readAssetPayload(env, request, "/ravenos/memory.json"),
  ]);
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
    }, { status: 503, headers: routeCacheHeaders(`/api/chains/${slug}`) });
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
  }, { headers: routeCacheHeaders(`/api/chains/${slug}`) });
}

async function routeApi(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/health" && request.method === "GET") return handleHealth(env);
  if (url.pathname === "/api/status" && request.method === "GET") return handleStatus(request, env);
  if (url.pathname === "/api/brief" && request.method === "GET") {
    return handlePublicArtifact(env, request, url.pathname, "/ravenos/brief.json", { status: "degraded", message: "Current brief forming." });
  }
  if (url.pathname === "/api/replay" && request.method === "GET") {
    return handlePublicArtifact(env, request, url.pathname, "/ravenos/replay.json", { status: "degraded", message: "Current replay context forming." });
  }
  if (url.pathname === "/api/outcomes" && request.method === "GET") {
    return handlePublicArtifact(env, request, url.pathname, "/ravenos/outcomes.json", { status: "degraded", message: "Current outcomes context forming." });
  }
  if (url.pathname === "/api/memory" && request.method === "GET") {
    return handlePublicArtifact(env, request, url.pathname, "/ravenos/memory.json", { status: "degraded", message: "Current memory context forming." });
  }
  if (url.pathname === "/api/behavior" && request.method === "GET") {
    return handlePublicArtifact(env, request, url.pathname, "/ravenos/behavior.json", { status: "degraded", message: "Current behavior context forming." });
  }
  if (url.pathname === "/api/perps" && request.method === "GET") {
    return handlePublicArtifact(env, request, url.pathname, "/ravenos/perps.json", { status: "degraded", message: "Current perps context forming." });
  }
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
  if (url.pathname === "/api/access" && (request.method === "GET" || request.method === "POST")) return handleAccess(request, env);
  if (url.pathname === "/api/stripe/checkout" && request.method === "POST") return handleCheckout(request, env);
  if (url.pathname === "/api/stripe/portal" && request.method === "POST") return handlePortal(request, env);
  if (url.pathname === "/api/stripe/webhook" && request.method === "POST") return handleWebhook(request, env);
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
    } catch (error) {
      return json({ ok: false, provider: "Hyperliquid", coverage: "Unavailable", isLive: false, warning: "Hyperliquid unavailable", error: error instanceof Error ? error.message : "hyperliquid_perps_failed", results: [] }, { status: 502 });
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
    const assetResponse = await env.ASSETS.fetch(request);
    return applyAssetSecurityHeaders(assetResponse, url.pathname);
  },
};
