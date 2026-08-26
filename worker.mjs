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
  loadPublicAtlasUniverse,
  loadPublicInstrumentChart,
  loadPublicInstrumentLookup,
  loadPublicProjection,
  projectionFreshness,
  projectionHeaders,
  sanitizeOriginControlDocument,
} from "./lib/ravenos_public_origin.mjs";
import {
  CHART_INSTRUMENT_TYPES,
  RAVENOS_CHART_CANDLE_SERIES_SCHEMA,
  normalizeChartInstrument,
  resolveChartCapability,
  timeframeSeconds,
} from "./ravenos-chart-data-plane.js";
import { resolveCustomerTradeFlags } from "./lib/customer_trade/feature_flags.mjs";
import {
  createHyperliquidMarketPreview,
  HYPERLIQUID_MARKET_PREVIEW_SCHEMA,
} from "./lib/customer_trade/hyperliquid_quote_preview.mjs";
import {
  createHyperliquidOrderPlan,
  HYPERLIQUID_ORDER_PLAN_SCHEMA,
} from "./lib/customer_trade/hyperliquid_order_plan.mjs";
import {
  createHyperliquidAccountSnapshot,
  HYPERLIQUID_ACCOUNT_SNAPSHOT_SCHEMA,
  normalizeHyperliquidAddress,
} from "./lib/customer_trade/hyperliquid_account_snapshot.mjs";
import {
  createHyperliquidAccountScenario,
  HYPERLIQUID_ACCOUNT_SCENARIO_SCHEMA,
} from "./lib/customer_trade/hyperliquid_account_scenario.mjs";
import {
  createHyperliquidAccountHistory,
  HYPERLIQUID_ACCOUNT_HISTORY_SCHEMA,
} from "./lib/customer_trade/hyperliquid_account_history.mjs";
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
  recordCandleProviderUsage,
  recordProviderComponentEvent,
  routeBudget,
  runProviderOperation,
  withOperationBudget,
} from "./lib/customer_trade/terminal_runtime.mjs";
import {
  evaluateReleaseCohesion,
  expectedReleaseFromEnv,
} from "./lib/release_contract.mjs";
import {
  RAVENOS_ONCHAIN_CHART_PROVIDER_REGISTRY_SCHEMA,
  normalizeProviderPoolAddress,
  onchainChartProviderOrder,
  onchainProviderNetwork,
  onchainProviderRuntime,
} from "./lib/onchain_chart_providers.mjs";
import {
  PRIMARY_PROVIDER_DERIVATIONS,
  auditCandleContinuity,
  deriveCompleteCandleInterval,
  validateExactCandleIdentity,
} from "./lib/chart_continuity.mjs";
import { classifyOnchainMarketState } from "./lib/onchain_market_state.mjs";
import { buildParticipationPayoffProjection } from "./lib/participation_payoff.mjs";
import { routeCustomerIdentity } from "./lib/customer_identity.mjs";
import {
  CUSTOMER_RESEARCH_STATE_ROUTE,
  routeCustomerResearchState,
} from "./lib/customer_research_state.mjs";
import {
  PORTFOLIO_GOVERNOR_PREVIEW_ROUTE,
  routePortfolioGovernorPreview,
} from "./lib/portfolio_governor/preview.mjs";

const AUTHENTICATED_APP_HOST = "app.ravenos.xyz";
const PUBLIC_ORIGIN = "https://ravenos.xyz";
const AUTHENTICATED_APP_STATIC_PATHS = new Set([
  "/favicon.ico",
  "/ravenos-account.css",
  "/ravenos-account.js",
  "/ravenos-monitor.css",
  "/ravenos-monitor.js",
  "/ravenos-shell.css",
  "/ravenos-shell.js",
  "/ravenos-workspace.css",
]);
const PUBLIC_APP_REDIRECT_ROUTES = new Set([
  "",
  "atlas",
  "behavior",
  "brief",
  "chains",
  "claims",
  "discover",
  "docs",
  "faq",
  "memory",
  "opportunity",
  "outcomes",
  "perps",
  "portfolio",
  "pricing",
  "privacy",
  "replay",
  "research",
  "terminal",
  "terms",
]);
const SAVED_MONITOR_HANDOFF_FIELDS = new Set([
  "action",
  "instrument_id",
  "instrument_type",
  "identity_scope",
  "asset_class",
  "chain",
  "venue",
  "market",
  "timeframe",
  "indicators",
  "raven_overlays",
  "density",
  "panel",
]);

function savedMonitorRedirectTarget(sourceUrl) {
  const target = new URL("/monitor/", `https://${AUTHENTICATED_APP_HOST}`);
  for (const field of SAVED_MONITOR_HANDOFF_FIELDS) {
    const value = sourceUrl.searchParams.get(field);
    if (value !== null) target.searchParams.set(field, String(value).slice(0, field === "instrument_id" ? 220 : 300));
  }
  return target;
}

function authenticatedAppBoundary(request) {
  const url = new URL(request.url);
  if (url.hostname.toLowerCase() !== AUTHENTICATED_APP_HOST) return null;
  const readRequest = request.method === "GET" || request.method === "HEAD";
  const accountPath = url.pathname === "/account" || url.pathname === "/account/" || url.pathname === "/account/index.html";
  const monitorPath = url.pathname === "/monitor" || url.pathname === "/monitor/" || url.pathname === "/monitor/index.html";
  const identityApi = url.pathname === "/api/v1/auth/config"
    || url.pathname === "/api/v1/auth/start"
    || url.pathname === "/api/v1/auth/callback"
    || url.pathname === "/api/v1/auth/session"
    || url.pathname === "/api/v1/auth/logout"
    || url.pathname === "/api/v1/sessions"
    || url.pathname.startsWith("/api/v1/sessions/");
  const portfolioPreviewApi = url.pathname === PORTFOLIO_GOVERNOR_PREVIEW_ROUTE;
  const researchStateApi = url.pathname === CUSTOMER_RESEARCH_STATE_ROUTE
    || url.pathname === `${CUSTOMER_RESEARCH_STATE_ROUTE}/watch-items`
    || url.pathname.startsWith(`${CUSTOMER_RESEARCH_STATE_ROUTE}/watch-items/`);
  const releaseProbe = readRequest && url.pathname === "/api/build";
  const immutableAsset = readRequest && (url.pathname.startsWith("/assets/") || AUTHENTICATED_APP_STATIC_PATHS.has(url.pathname));
  if ((readRequest && (accountPath || monitorPath)) || identityApi || portfolioPreviewApi || researchStateApi || releaseProbe || immutableAsset) return { allowed: true, response: null };

  const firstSegment = url.pathname.split("/").filter(Boolean)[0] || "";
  if (readRequest && firstSegment === "brief") {
    const target = new URL("/terminal/", PUBLIC_ORIGIN);
    target.search = url.search;
    return { allowed: false, response: Response.redirect(target, 308) };
  }
  if (readRequest && PUBLIC_APP_REDIRECT_ROUTES.has(firstSegment)) {
    const targetPath = firstSegment ? `/${firstSegment}/` : "/";
    return { allowed: false, response: Response.redirect(`${PUBLIC_ORIGIN}${targetPath}`, 308) };
  }
  return { allowed: false, response: new Response("Not found", {
    status: 404,
    headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
  }) };
}

const dexCache = new Map();
const dexPaprikaCache = new Map();
const geckoIdentityCache = new Map();
const geckoMarketProfileCache = new Map();
const onchainPulseCache = new Map();
const jupiterVelocityCache = new Map();
const hyperliquidCache = new Map();
const terminalChartCache = new Map();
const spotAttentionCache = new Map();
const DEXSCREENER_BASE_URL = "https://api.dexscreener.com";
const JUPITER_TOKENS_BASE_URL = "https://api.jup.ag/tokens/v2";
const HYPERLIQUID_INFO_URL = "https://api.hyperliquid.xyz/info";
const YAHOO_CHART_BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const LISTED_MARKET_PUBLIC_DISPLAY_ALLOWED = false;
const DEFAULT_RAVENOS_SPOT_CHART_ORIGIN_URL = "https://ravenos-public-origin.ravenos.xyz/public/ravenos/chart.json";
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const EVM_CHAINS = ["base", "ethereum", "robinhood", "arbitrum", "optimism", "bsc", "polygon"];
const QUOTE_RANK = { USDC: 90, USDT: 85, USDG: 84, SOL: 80, WETH: 80, ETH: 75, WSOL: 75 };
const CHAIN_ROUTE_MAP = {
  solana: { aliases: ["solana"], label: "Solana" },
  base: { aliases: ["base"], label: "Base" },
  ethereum: { aliases: ["eth", "ethereum"], label: "Ethereum" },
  robinhood: { aliases: ["robinhood"], label: "Robinhood Chain" },
};
const ONCHAIN_PULSE_NETWORKS = Object.freeze({
  solana: Object.freeze({ provider_network: "solana", label: "Solana" }),
  base: Object.freeze({ provider_network: "base", label: "Base" }),
  ethereum: Object.freeze({ provider_network: "eth", label: "Ethereum" }),
  robinhood: Object.freeze({ provider_network: "robinhood", label: "Robinhood Chain" }),
});
const ONCHAIN_PULSE_DURATIONS = Object.freeze({
  "5m": "m5",
  "1h": "h1",
  "24h": "h24",
});
const STABLE_TOKEN_SYMBOLS = new Set(["USDC", "USDT", "USDG", "DAI", "USDE", "USDS", "FDUSD", "USDBC"]);
const EXACT_TRADITIONAL_INSTRUMENTS = Object.freeze({
  SPY: Object.freeze({ instrument_id: "etf:nyse-arca:spy", instrument_type: "etf", venue: "nyse-arca", listing: "NYSE Arca" }),
  QQQ: Object.freeze({ instrument_id: "etf:nasdaq:qqq", instrument_type: "etf", venue: "nasdaq", listing: "Nasdaq Stock Market" }),
  IWM: Object.freeze({ instrument_id: "etf:nyse-arca:iwm", instrument_type: "etf", venue: "nyse-arca", listing: "NYSE Arca" }),
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

async function resolveReleaseState(env, request, { force = false } = {}) {
  const expected = expectedReleaseFromEnv(env);
  if (!expected.enforced && !force) {
    return {
      release: null,
      build: null,
      deploy: null,
      cohesion: evaluateReleaseCohesion({ expected, version: env?.CF_VERSION_METADATA }),
    };
  }
  const [release, build, deploy] = await Promise.all([
    readAssetPayload(env, request, "/ravenos_release.json"),
    readAssetPayload(env, request, "/ravenos_build.json"),
    readAssetPayload(env, request, "/ravenos_deploy_manifest.json"),
  ]);
  return {
    release,
    build,
    deploy,
    cohesion: evaluateReleaseCohesion({
      expected,
      release,
      build,
      deploy,
      version: env?.CF_VERSION_METADATA,
    }),
  };
}

function attachReleaseHeaders(response, releaseState, pathname = "") {
  const headers = new Headers(response.headers);
  const releaseId = String(releaseState?.release?.release_id || releaseState?.cohesion?.expected?.release_id || "").trim();
  const workerVersionId = String(releaseState?.cohesion?.worker_version?.id || "").trim();
  if (releaseId) headers.set("x-ravenos-release-id", releaseId);
  if (workerVersionId) headers.set("x-ravenos-worker-version", workerVersionId);
  if (pathname.startsWith("/assets/")) {
    headers.set("cache-control", "public, max-age=31536000, immutable");
  } else if ([
    "/ravenos_release.json",
    "/ravenos_asset_manifest.json",
    "/ravenos_build.json",
    "/ravenos_deploy_manifest.json",
  ].includes(pathname)) {
    headers.set("cache-control", "no-store");
  } else if (
    pathname === "/account/"
    || pathname === "/account"
    || pathname.endsWith("/account/index.html")
    || pathname === "/monitor/"
    || pathname === "/monitor"
    || pathname.endsWith("/monitor/index.html")
  ) {
    headers.set("cache-control", "no-store, max-age=0");
  } else if (String(headers.get("content-type") || "").toLowerCase().includes("text/html")) {
    headers.set("cache-control", "public, max-age=0, must-revalidate");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function releaseUnavailable(releaseState) {
  return json({
    ok: false,
    error: "release_incoherent",
    state: "unavailable",
    release_id: releaseState?.cohesion?.expected?.release_id || null,
    worker_version_id: releaseState?.cohesion?.worker_version?.id || null,
    reasons: releaseState?.cohesion?.reasons || ["release_state_unavailable"],
    fail_closed: true,
  }, { status: 503, headers: { "cache-control": "no-store" } });
}

function handleBuildIdentity(releaseState) {
  const { release, build, deploy, cohesion } = releaseState;
  return json({
    ok: Boolean(cohesion?.ok),
    schema_version: "ravenos.build_identity.v1",
    generated_at: new Date().toISOString(),
    release: release ? {
      schema_version: release.schema_version,
      release_id: release.release_id,
      source_commit: release.source_commit,
      public_build_id: release.public_build_id,
      built_at: release.built_at,
      release_content_seed_sha256: release.release_content_seed_sha256,
      static_asset_manifest_sha256: release.static_asset_manifest_sha256,
    } : null,
    worker: {
      version_id: cohesion?.worker_version?.id || null,
      version_tag: cohesion?.worker_version?.tag || null,
      expected_version_tag: cohesion?.expected?.release_id || null,
      version_tag_visibility: cohesion?.worker_version_tag_visibility || "external_verification_required",
      version_created_at: cohesion?.worker_version?.timestamp || null,
    },
    assets: deploy ? {
      release_id: deploy.release_id,
      artifact_content_sha256: deploy.artifact_content_sha256,
      static_asset_manifest_sha256: deploy.static_asset_manifest_sha256,
      file_count: Array.isArray(deploy.files) ? deploy.files.length : null,
    } : null,
    public_origin: release ? {
      contract_version: release.public_origin_contract_version,
      endpoint_contract_sha256: release.public_origin_endpoint_contract_sha256,
    } : null,
    build: build ? {
      release_id: build.release_id,
      public_build_id: build.public_build_id,
      source_commit: build.source_commit,
    } : null,
    cohesion: {
      enforced: Boolean(cohesion?.enforced),
      state: cohesion?.state || "incoherent",
      reasons: cohesion?.reasons || ["release_state_unavailable"],
      fail_closed: true,
    },
  }, {
    status: cohesion?.ok ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
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
  if (pathname === "/api/atlas") return { "cache-control": "public, max-age=60, stale-while-revalidate=120" };
  if (pathname === "/api/atlas/featured") return { "cache-control": "public, max-age=30, stale-while-revalidate=60" };
  if (pathname === "/api/atlas/search") return { "cache-control": "public, max-age=15, stale-while-revalidate=30" };
  if (pathname.startsWith("/api/atlas/")) return { "cache-control": "private, no-store" };
  if (pathname === "/api/instruments/search") return { "cache-control": "public, max-age=30, stale-while-revalidate=60" };
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

async function boundedProviderJson(url, {
  headers = {},
  maxBytes = 768 * 1024,
  timeoutMs = 5_000,
  errorPrefix = "provider",
} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json", ...headers },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${errorPrefix}_http_${response.status}`);
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > maxBytes) throw new Error(`${errorPrefix}_payload_too_large`);
    const body = await response.text();
    if (byteLengthUtf8(body) > maxBytes) throw new Error(`${errorPrefix}_payload_too_large`);
    const payload = JSON.parse(body);
    if (payload === null || typeof payload !== "object") throw new Error(`${errorPrefix}_invalid_payload`);
    return payload;
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`${errorPrefix}_timeout`);
    if (error instanceof SyntaxError) throw new Error(`${errorPrefix}_invalid_json`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function cachedDexPaprika(path, { ttlMs = 30_000, maxBytes = 768 * 1024 } = {}) {
  const cacheKey = `dexpaprika:${path}`;
  const cached = cacheGet(dexPaprikaCache, cacheKey);
  if (cached) return cached;
  const runtime = onchainProviderRuntime("dexpaprika");
  const payload = await boundedProviderJson(`${runtime.base_url}${path}`, {
    headers: runtime.request_headers,
    maxBytes,
    timeoutMs: 5_000,
    errorPrefix: "dexpaprika",
  });
  cacheSet(dexPaprikaCache, cacheKey, payload, ttlMs);
  return payload;
}

function normalizeDexPair(pair = {}) {
  const base = pair.baseToken || {};
  const quote = pair.quoteToken || {};
  const imageUrl = safeDexImageUrl(pair.info?.imageUrl);
  const buys24h = optionalFiniteNumber(pair.txns?.h24?.buys);
  const sells24h = optionalFiniteNumber(pair.txns?.h24?.sells);
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
    txns24h: (buys24h || 0) + (sells24h || 0),
    buys24h,
    sells24h,
    marketCap: num(pair.marketCap),
    fdv: num(pair.fdv),
    priceChange24h: num(pair.priceChange?.h24),
    pairAgeMs: pair.pairCreatedAt ? Date.now() - Number(pair.pairCreatedAt) : null,
    imageUrl,
    provider: "Dexscreener",
    coverage: "Public fallback",
    isLive: false,
    isCached: false,
    isSample: false,
    lastUpdated: new Date().toISOString(),
    warning: "Limited public coverage",
  };
}

function safeDexImageUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.hostname !== "cdn.dexscreener.com") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function boundedSolanaTokenAddresses(value) {
  const deduped = new Set();
  for (const address of String(value || "").split(",")) {
    const clean = address.trim();
    if (!SOLANA_ADDRESS_RE.test(clean)) continue;
    deduped.add(clean);
    if (deduped.size >= 30) break;
  }
  return [...deduped];
}

async function solanaTokenMetadata(addresses = []) {
  if (!addresses.length) return [];
  const rows = await tokensDex("solana", addresses.join(","));
  const requested = new Set(addresses);
  const selected = new Map();
  for (const row of rows) {
    if (!requested.has(row.tokenAddress) || selected.has(row.tokenAddress)) continue;
    selected.set(row.tokenAddress, {
      token_address: row.tokenAddress,
      symbol: row.symbol,
      name: row.name,
      image_url: row.imageUrl,
      pair_address: row.pairAddress,
      venue: row.dexId,
      observed_at: row.lastUpdated,
    });
  }
  return addresses.flatMap((address) => selected.has(address) ? [selected.get(address)] : []);
}

function matchingDexPaprikaToken(pool = {}, query = "") {
  const cleanQuery = String(query || "").trim().toLowerCase();
  const tokens = Array.isArray(pool?.tokens) ? pool.tokens.slice(0, 4) : [];
  if (!cleanQuery) return null;
  return tokens.find((token) => String(token?.id || "").toLowerCase() === cleanQuery)
    || tokens.find((token) => String(token?.symbol || "").toLowerCase() === cleanQuery)
    || tokens.find((token) => String(token?.name || "").toLowerCase() === cleanQuery)
    || tokens.find((token) => String(token?.name || "").toLowerCase().includes(cleanQuery))
    || null;
}

function normalizeDexPaprikaPool(pool = {}, query = "") {
  const base = matchingDexPaprikaToken(pool, query);
  if (!base) return null;
  const quote = (Array.isArray(pool?.tokens) ? pool.tokens : []).find((token) => token?.id && token.id !== base.id) || {};
  const createdAtMs = Date.parse(String(pool?.created_at || ""));
  return {
    id: `${pool.chain || "unknown"}:${pool.id || base.id || ""}`,
    chainId: String(pool.chain || "unknown").toLowerCase(),
    dexId: pool.dex_id || pool.dex_name || "unknown",
    pairAddress: pool.id || "",
    tokenAddress: base.id || "",
    quoteTokenAddress: quote.id || "",
    symbol: base.symbol || "UNKNOWN",
    name: base.name || base.symbol || "Unknown token",
    quoteSymbol: quote.symbol || "",
    priceUsd: null,
    liquidityUsd: null,
    volume24h: num(pool.volume_usd),
    txns24h: num(pool.transactions),
    buys24h: null,
    sells24h: null,
    marketCap: null,
    fdv: Number.isFinite(Number(base.fdv)) ? Number(base.fdv) : null,
    priceChange24h: Number.isFinite(Number(pool.last_price_change_usd_24h)) ? Number(pool.last_price_change_usd_24h) : null,
    pairAgeMs: Number.isFinite(createdAtMs) ? Date.now() - createdAtMs : null,
    provider: "DexPaprika",
    coverage: "Exact provider pool",
    isLive: false,
    isCached: false,
    isSample: false,
    lastUpdated: new Date().toISOString(),
    warning: "Exact pool identity; current price loads from the selected market.",
  };
}

function mergeOnchainSearchRows(rows = []) {
  const deduped = new Map();
  const finiteMetric = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
  for (const row of rows.filter(Boolean)) {
    const key = `${String(row.chainId || "").toLowerCase()}:${String(row.pairAddress || "").toLowerCase()}:${String(row.tokenAddress || "").toLowerCase()}`;
    if (!row.chainId || !row.pairAddress || !row.tokenAddress) continue;
    const previous = deduped.get(key);
    if (!previous) {
      deduped.set(key, row);
      continue;
    }
    const preferred = finiteMetric(row.priceUsd) && !finiteMetric(previous.priceUsd)
      ? row
      : finiteMetric(previous.priceUsd) && !finiteMetric(row.priceUsd)
        ? previous
        : Number(row.liquidityUsd || 0) > Number(previous.liquidityUsd || 0) ? row : previous;
    const secondary = preferred === row ? previous : row;
    deduped.set(key, {
      ...secondary,
      ...preferred,
      provider: [...new Set([previous.provider, row.provider].filter(Boolean))].join(" + "),
      priceUsd: finiteMetric(preferred.priceUsd) ? Number(preferred.priceUsd) : (finiteMetric(secondary.priceUsd) ? Number(secondary.priceUsd) : null),
      liquidityUsd: finiteMetric(preferred.liquidityUsd) ? Number(preferred.liquidityUsd) : (finiteMetric(secondary.liquidityUsd) ? Number(secondary.liquidityUsd) : null),
    });
  }
  return [...deduped.values()];
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

async function hyperliquidPerps({ forceRefresh = false } = {}) {
  const key = "metaAndAssetCtxs";
  const now = Date.now();
  const hit = hyperliquidCache.get(key);
  if (!forceRefresh && hit && hit.expires > now) return hit.payload;
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
  let markets = await hyperliquidPerps();
  let market = markets.results.find((row) => row.symbol === coin || row.coin === coin);
  if (!market) {
    markets = await hyperliquidPerps({ forceRefresh: true });
    market = markets.results.find((row) => row.symbol === coin || row.coin === coin);
  }
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
    ok: true,
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

async function hyperliquidAccountSnapshot(addressInput) {
  const address = normalizeHyperliquidAddress(addressInput);
  if (!address) throw new Error("invalid_hyperliquid_address");
  const cacheKey = `account-snapshot:${address}`;
  const cached = cacheGet(hyperliquidCache, cacheKey);
  if (cached) return { ...cached, cache_state: "edge_memory_hit" };
  const observedAt = new Date().toISOString();
  const [clearinghouse, spotState, openOrders, fills] = await Promise.all([
    hyperliquidInfo({ type: "clearinghouseState", user: address }, { maxBytes: 512 * 1024, timeoutMs: 5_000 }),
    hyperliquidInfo({ type: "spotClearinghouseState", user: address }, { maxBytes: 256 * 1024, timeoutMs: 5_000 }),
    hyperliquidInfo({ type: "frontendOpenOrders", user: address }, { maxBytes: 512 * 1024, timeoutMs: 5_000 }),
    hyperliquidInfo({ type: "userFills", user: address, aggregateByTime: true }, { maxBytes: 1024 * 1024, timeoutMs: 5_000 }),
  ]);
  const payload = {
    ...createHyperliquidAccountSnapshot({ address, clearinghouse, spotState, openOrders, fills }, { observedAt }),
    cache_state: "provider_read",
  };
  cacheSet(hyperliquidCache, cacheKey, payload, 3_000);
  return payload;
}

async function hyperliquidAccountHistory(addressInput) {
  const address = normalizeHyperliquidAddress(addressInput);
  if (!address) throw new Error("invalid_hyperliquid_address");
  const cacheKey = `account-history:${address}`;
  const cached = cacheGet(hyperliquidCache, cacheKey);
  if (cached) return { ...cached, cache_state: "edge_memory_hit" };
  const historicalOrders = await hyperliquidInfo(
    { type: "historicalOrders", user: address },
    { maxBytes: 1024 * 1024, timeoutMs: 5_000 },
  );
  const payload = {
    ...createHyperliquidAccountHistory({ address, historicalOrders }, { observedAt: new Date().toISOString() }),
    cache_state: "provider_read",
  };
  cacheSet(hyperliquidCache, cacheKey, payload, 10_000);
  return payload;
}

async function hyperliquidUserFees(addressInput) {
  const address = normalizeHyperliquidAddress(addressInput);
  if (!address) throw new Error("invalid_hyperliquid_address");
  const cacheKey = `account-fees:${address}`;
  const cached = cacheGet(hyperliquidCache, cacheKey);
  if (cached) return cached;
  const fees = await hyperliquidInfo(
    { type: "userFees", user: address },
    { maxBytes: 512 * 1024, timeoutMs: 5_000 },
  );
  cacheSet(hyperliquidCache, cacheKey, fees, 10_000);
  return fees;
}

function timeframeSpec(timeframe = "1h") {
  const requested = String(timeframe || "1h");
  const tf = requested.toLowerCase();
  if (requested === "1M") return { yahooInterval: "1mo", yahooRange: "10y", hyperInterval: "1M", displayTimeframe: "1M", lookbackMs: 10 * 365 * 24 * 60 * 60 * 1000, hyperMaxItems: 120, yahooMaxItems: 120 };
  if (tf === "1m") return { yahooInterval: "1m", yahooRange: "1d", hyperInterval: "1m", displayTimeframe: "1m", lookbackMs: 12 * 60 * 60 * 1000, hyperMaxItems: 720, yahooMaxItems: 480 };
  if (tf === "5m") return { yahooInterval: "5m", yahooRange: "5d", hyperInterval: "5m", displayTimeframe: "5m", lookbackMs: 3 * 24 * 60 * 60 * 1000, hyperMaxItems: 720, yahooMaxItems: 576 };
  if (tf === "15m") return { yahooInterval: "15m", yahooRange: "5d", hyperInterval: "15m", lookbackMs: 8 * 24 * 60 * 60 * 1000, hyperMaxItems: 720 };
  if (tf === "4h") return { yahooInterval: "1h", yahooRange: "1mo", hyperInterval: "4h", lookbackMs: 120 * 24 * 60 * 60 * 1000, hyperMaxItems: 720 };
  if (tf === "1d") return { yahooInterval: "1d", yahooRange: "6mo", hyperInterval: "1d", lookbackMs: 2 * 365 * 24 * 60 * 60 * 1000, hyperMaxItems: 720 };
  if (tf === "1w") return { yahooInterval: "1wk", yahooRange: "5y", hyperInterval: "1w", displayTimeframe: "1w", lookbackMs: 10 * 365 * 24 * 60 * 60 * 1000, hyperMaxItems: 520, yahooMaxItems: 260 };
  return { yahooInterval: "1h", yahooRange: "1mo", hyperInterval: "1h", displayTimeframe: "1h", lookbackMs: 30 * 24 * 60 * 60 * 1000, hyperMaxItems: 720, yahooMaxItems: 360 };
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
  const requested = String(timeframe || "1h");
  const tf = requested.toLowerCase();
  if (requested === "1M") return { providerTimeframe: "day", aggregate: 30, limit: 120, intervalSeconds: 2_592_000 };
  if (tf === "1m") return { providerTimeframe: "minute", aggregate: 1, limit: 480, intervalSeconds: 60 };
  if (tf === "5m") return { providerTimeframe: "minute", aggregate: 5, limit: 576, intervalSeconds: 300 };
  if (tf === "15m") return { providerTimeframe: "minute", aggregate: 15, limit: 480, intervalSeconds: 900 };
  if (tf === "4h") return { providerTimeframe: "hour", aggregate: 4, limit: 240, intervalSeconds: 14_400 };
  if (tf === "1d") return { providerTimeframe: "day", aggregate: 1, limit: 180, intervalSeconds: 86_400 };
  if (tf === "1w") return { providerTimeframe: "day", aggregate: 7, limit: 260, intervalSeconds: 604_800 };
  return { providerTimeframe: "hour", aggregate: 1, limit: 360, intervalSeconds: 3_600 };
}

function dexPaprikaTimeframeSpec(timeframe = "1h") {
  const requested = String(timeframe || "1h");
  const tf = requested.toLowerCase();
  if (tf === "1m") return { directInterval: "1m", intervalSeconds: 60, limit: 366, derivation: null };
  // 1m -> 5m is deliberately not allowed. The bake-off found incomplete
  // source buckets and material volume disagreement on active exact pools.
  if (tf === "5m") return { directInterval: "5m", intervalSeconds: 300, limit: 366, derivation: null };
  if (tf === "15m") return { directInterval: "15m", intervalSeconds: 900, limit: 366, derivation: PRIMARY_PROVIDER_DERIVATIONS["15m"] };
  if (tf === "4h") return { directInterval: null, intervalSeconds: 14_400, limit: 91, derivation: PRIMARY_PROVIDER_DERIVATIONS["4h"] };
  if (tf === "1d") return { directInterval: "24h", intervalSeconds: 86_400, limit: 180, derivation: PRIMARY_PROVIDER_DERIVATIONS["1d"] };
  return { directInterval: "1h", intervalSeconds: 3_600, limit: 366, derivation: PRIMARY_PROVIDER_DERIVATIONS["1h"] };
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

function normalizeDexPaprikaCandle(row = {}) {
  return normalizeChartCandle({
    time: Math.trunc(Date.parse(String(row?.time_open || "")) / 1_000),
    open: row?.open,
    high: row?.high,
    low: row?.low,
    close: row?.close,
    volume: row?.volume,
  });
}

function aggregateCandlesByTime(candles = [], intervalSeconds = 14_400, { maxItems = 240 } = {}) {
  const clean = sanitizeChartCandles(candles, { maxItems: 1000 });
  const buckets = new Map();
  for (const candle of clean) {
    const timestamp = Number(candle.time);
    if (!Number.isFinite(timestamp)) continue;
    const bucketTime = Math.floor(timestamp / intervalSeconds) * intervalSeconds;
    const existing = buckets.get(bucketTime);
    if (!existing) {
      buckets.set(bucketTime, { ...candle, time: bucketTime });
      continue;
    }
    existing.high = Math.max(existing.high, candle.high);
    existing.low = Math.min(existing.low, candle.low);
    existing.close = candle.close;
    existing.volume += Number.isFinite(Number(candle.volume)) ? Number(candle.volume) : 0;
  }
  return [...buckets.values()].sort((left, right) => left.time - right.time).slice(-Math.max(1, maxItems));
}

function sameOnchainAddress(chain, left, right) {
  const a = String(left || "").trim();
  const b = String(right || "").trim();
  if (!a || !b) return false;
  return String(chain || "").toLowerCase() === "solana" ? a === b : a.toLowerCase() === b.toLowerCase();
}

function boundedOperatorText(value, maxLength = 320) {
  const clean = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean ? clean.slice(0, maxLength) : null;
}

function boundedPublicNumber(value, { minimum = -1_000_000_000, maximum = 1_000_000_000_000_000 } = {}) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function publicIsoTimestamp(value) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed) || parsed > Date.now() + 300_000) return null;
  return new Date(parsed).toISOString();
}

function sanitizeSpotAttentionRow(row, {
  chain = "",
  pairAddress = "",
  tokenAddress = "",
  projectionGeneratedAt = null,
  sourceAgeSeconds = null,
} = {}) {
  if (!row || typeof row !== "object" || row.market_type !== "spot") return null;
  const requestedChain = String(chain || "").trim().toLowerCase();
  const rowChain = String(row.chain || "").trim().toLowerCase();
  if (!requestedChain || requestedChain !== rowChain) return null;
  if (!sameOnchainAddress(requestedChain, row.token_address, tokenAddress)) return null;
  const tokenFlowBoundToPoolRoute = row.evidence_scope === "exact_token_flow_plus_exact_pool_route";
  const identityScope = tokenFlowBoundToPoolRoute
    ? "exact_token"
    : row.identity_scope === "exact_pool" ? "exact_pool" : row.identity_scope === "exact_token" ? "exact_token" : null;
  if (!identityScope) return null;
  if (
    (identityScope === "exact_pool" || tokenFlowBoundToPoolRoute)
    && (!row.pool_address || !sameOnchainAddress(requestedChain, row.pool_address, pairAddress))
  ) return null;
  if (row.research_only !== true || row.actionable !== false || row.execution_available !== false) return null;

  const market = row.market && typeof row.market === "object" ? row.market : {};
  const broader = row.broader_attention && typeof row.broader_attention === "object"
    ? row.broader_attention
    : {};
  const observedAt = publicIsoTimestamp(row.observed_at);
  const currentProjectionAt = publicIsoTimestamp(projectionGeneratedAt);
  if (!observedAt || !currentProjectionAt) return null;

  const publicMarket = {
    price_usd: boundedPublicNumber(market.price_usd, { minimum: 0 }),
    market_cap_usd: boundedPublicNumber(market.market_cap_usd, { minimum: 0 }),
    liquidity_usd: boundedPublicNumber(market.liquidity_usd, { minimum: 0 }),
    market_age_seconds: boundedPublicNumber(market.market_age_seconds, { minimum: 0 }),
    holder_count: boundedPublicNumber(market.holder_count, { minimum: 0 }),
    holder_change_5m_pct: boundedPublicNumber(market.holder_change_5m_pct),
    holder_change_1h_pct: boundedPublicNumber(market.holder_change_1h_pct),
    holder_change_24h_pct: boundedPublicNumber(market.holder_change_24h_pct),
    price_change_5m_pct: boundedPublicNumber(market.price_change_5m_pct),
    price_change_1h_pct: boundedPublicNumber(market.price_change_1h_pct),
    price_change_24h_pct: boundedPublicNumber(market.price_change_24h_pct),
    liquidity_change_5m_pct: boundedPublicNumber(market.liquidity_change_5m_pct),
    liquidity_change_1h_pct: boundedPublicNumber(market.liquidity_change_1h_pct),
    liquidity_change_24h_pct: boundedPublicNumber(market.liquidity_change_24h_pct),
    volume_usd_5m: boundedPublicNumber(market.volume_usd_5m, { minimum: 0 }),
    volume_usd_1h: boundedPublicNumber(market.volume_usd_1h, { minimum: 0 }),
    volume_usd_24h: boundedPublicNumber(market.volume_usd_24h, { minimum: 0 }),
    buys_5m: boundedPublicNumber(market.buys_5m, { minimum: 0 }),
    sells_5m: boundedPublicNumber(market.sells_5m, { minimum: 0 }),
    traders_5m: boundedPublicNumber(market.traders_5m, { minimum: 0 }),
    buys_1h: boundedPublicNumber(market.buys_1h, { minimum: 0 }),
    sells_1h: boundedPublicNumber(market.sells_1h, { minimum: 0 }),
    traders_1h: boundedPublicNumber(market.traders_1h, { minimum: 0 }),
    buys_24h: boundedPublicNumber(market.buys_24h, { minimum: 0 }),
    sells_24h: boundedPublicNumber(market.sells_24h, { minimum: 0 }),
    traders_24h: boundedPublicNumber(market.traders_24h, { minimum: 0 }),
  };
  return {
    schema_version: "ravenos.spot_market_context.v1",
    state: "current",
    evidence_scope: identityScope,
    scope_label: identityScope === "exact_pool" ? "This exact pool" : "Token-wide activity",
    chain: requestedChain,
    token_address: String(tokenAddress || ""),
    selected_pool_address: String(pairAddress || ""),
    evidence_pool_address: identityScope === "exact_pool" ? String(row.pool_address || "") : null,
    symbol: boundedOperatorText(row.symbol, 32),
    name: boundedOperatorText(row.name, 120),
    observed_at: observedAt,
    projection_generated_at: currentProjectionAt,
    source_age_seconds: boundedPublicNumber(sourceAgeSeconds, { minimum: 0, maximum: 86_400 }),
    movement_state: boundedOperatorText(row.movement_state, 120),
    what_changed: boundedOperatorText(row.what_changed, 420),
    risk: boundedOperatorText(row.risk, 320),
    market: publicMarket,
    broader_attention: {
      state: boundedOperatorText(broader.state, 64),
      raven_observed_first: broader.raven_observed_first === true,
      lead_seconds: boundedPublicNumber(broader.lead_seconds, { minimum: 0, maximum: 31_536_000 }),
      observed_at: publicIsoTimestamp(broader.observed_at),
      summary: boundedOperatorText(broader.summary, 320),
    },
    evidence_state: "observed",
    research_only: true,
    actionable: false,
    execution_available: false,
    signing_available: false,
    submission_available: false,
  };
}

async function loadCurrentSpotAttentionContext({
  env = {},
  chain = "",
  pairAddress = "",
  tokenAddress = "",
} = {}) {
  if (!chain || !pairAddress || !tokenAddress) return null;
  const cacheKey = `spot-attention:${String(chain).toLowerCase()}:${String(pairAddress)}:${String(tokenAddress)}`;
  const cached = cacheGet(spotAttentionCache, cacheKey);
  if (cached) return cached;
  const result = await loadPublicProjection({
    env,
    key: "opportunities",
    fallbackPayload: null,
    timeoutMs: 1_200,
  }).catch(() => null);
  const attention = result?.payload?.data?.spot_attention;
  const generatedAt = publicIsoTimestamp(attention?.generated_at);
  const generatedMs = Date.parse(generatedAt || "");
  const boundary = attention?.execution_boundary;
  const currentRavenAttention = result?.available
    && result.delivery?.source === "current_public_origin"
    && result.delivery?.fallback === false
    && result.delivery?.freshness_state === "fresh"
    && attention?.schema_version === "ravenos.token_attention.v1"
    && attention?.state === "current"
    && Array.isArray(attention?.rows)
    && attention.rows.length <= 100
    && Number.isFinite(generatedMs)
    && Date.now() - generatedMs <= 3_600_000
    && (!boundary || (
      boundary.research_only === true
      && boundary.actionable === false
      && boundary.signing_available === false
      && boundary.submission_available === false
    ));
  const candidates = currentRavenAttention
    ? attention.rows
      .map((row) => sanitizeSpotAttentionRow(row, {
        chain,
        pairAddress,
        tokenAddress,
        projectionGeneratedAt: generatedAt,
        sourceAgeSeconds: result.delivery.age_seconds,
      }))
      .filter(Boolean)
      .sort((left, right) => (left.evidence_scope === "exact_pool" ? -1 : 0) - (right.evidence_scope === "exact_pool" ? -1 : 0))
    : [];
  let context = candidates[0] || null;
  if (!context && String(chain).toLowerCase() === "solana" && String(env.JUPITER_API_KEY || "").trim()) {
    const velocityFetchedAt = new Date().toISOString();
    const velocityRows = await jupiterVelocityRows({
      env,
      duration: "5m",
      fetchedAt: velocityFetchedAt,
    }).catch(() => []);
    const velocityRow = velocityRows.find((row) => (
      sameOnchainAddress("solana", row.pool_address, pairAddress)
      && sameOnchainAddress("solana", row.token_address, tokenAddress)
    ));
    context = sanitizeSpotAttentionRow(velocityRow, {
      chain,
      pairAddress,
      tokenAddress,
      projectionGeneratedAt: velocityRow?.observed_at || velocityFetchedAt,
      sourceAgeSeconds: 0,
    });
  }
  if (context) cacheSet(spotAttentionCache, cacheKey, context, 20_000);
  return context;
}

function minimumUsefulProviderBars(timeframe, requestedLimit, { poolCreatedAt = null, windowStartSeconds, windowEndSeconds } = {}) {
  const target = { "1m": 120, "5m": 120, "15m": 96, "1h": 60, "4h": 30, "1d": 14 }[String(timeframe || "1h")] || 60;
  const interval = timeframeSeconds(timeframe);
  const createdSeconds = Math.trunc(Date.parse(String(poolCreatedAt || "")) / 1_000);
  const effectiveStart = Number.isFinite(createdSeconds) && createdSeconds > 0
    ? Math.max(windowStartSeconds, createdSeconds)
    : windowStartSeconds;
  const possible = Math.max(2, Math.min(
    Math.max(2, Number(requestedLimit) || target),
    Math.floor(Math.max(0, windowEndSeconds - effectiveStart) / Math.max(1, interval)) + 1,
  ));
  return possible >= target ? Math.min(target, Math.max(2, Number(requestedLimit) || target)) : Math.max(2, Math.floor(possible * 0.5));
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
  instrumentId = "",
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
    timeframe: String(timeframe || "1h"),
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

function candleSeriesContract({
  instrument,
  provider,
  providerMarketId,
  timeframe,
  priceCurrency = "USD",
  tokenOrientation = "base",
  sourceInterval = null,
  derivation = null,
  continuity = null,
  freshnessState = null,
  candles = [],
} = {}) {
  return {
    schema_version: RAVENOS_CHART_CANDLE_SERIES_SCHEMA,
    role: "base_ohlcv",
    instrument_id: instrument?.canonical_id || null,
    identity_scope: instrument?.identity_scope || null,
    exact_identity: ["exact_pool", "venue_market"].includes(instrument?.identity_scope),
    provider,
    provider_market_id: providerMarketId || null,
    timeframe,
    price_currency: priceCurrency,
    token_orientation: tokenOrientation,
    source_interval: sourceInterval || timeframe,
    derivation: derivation || {
      state: "direct",
      source_interval: sourceInterval || timeframe,
      target_interval: timeframe,
    },
    continuity_state: continuity?.state || null,
    freshness_state: freshnessState,
    bar_count: Array.isArray(candles) ? candles.length : 0,
    raven_observations_are_candles: false,
  };
}

function sameExactPool(providerPayload, ravenPayload) {
  const same = (left, right) => String(left || "").toLowerCase() === String(right || "").toLowerCase();
  return Boolean(
    providerPayload?.instrument?.identity_scope === "exact_pool"
    && ravenPayload?.instrument_scope === "exact_pool"
    && same(providerPayload.chain, ravenPayload.chain)
    && same(providerPayload.pair_address, ravenPayload.pair_address)
    && (!providerPayload.token_address || !ravenPayload.token_address || same(providerPayload.token_address, ravenPayload.token_address))
  );
}

function ravenAnnotationEvents(ravenPayload, candles = [], { timeframe = "1h", instrumentId = null } = {}) {
  const providerCandles = Array.isArray(candles) ? candles : [];
  if (!providerCandles.length) return [];
  const firstCandleTime = Number(providerCandles[0]?.time);
  const lastCandleTime = Number(providerCandles.at(-1)?.time);
  const finalBucketEnd = lastCandleTime + timeframeSeconds(timeframe);
  const epochSeconds = (value) => {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return Math.trunc(numeric > 10_000_000_000 ? numeric / 1000 : numeric);
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? Math.trunc(parsed / 1000) : null;
  };
  return (Array.isArray(ravenPayload?.recent_trades) ? ravenPayload.recent_trades : [])
    .slice(-64)
    .map((row, index) => {
      const observed = epochSeconds(row?.time ?? row?.observed_at ?? row?.timestamp);
      if (!observed) return null;
      if (observed < firstCandleTime || observed >= finalBucketEnd) return null;
      const nearest = providerCandles.reduce((best, candle) => (
        Math.abs(Number(candle.time) - observed) < Math.abs(Number(best.time) - observed) ? candle : best
      ), providerCandles[0]);
      const compatiblePrice = ravenPayload.price_unit === "usd_per_token" && Number.isFinite(Number(row?.price))
        ? Number(row.price)
        : null;
      return {
        type: "raven-observation",
        severity: "info",
        time: nearest.time,
        exact_observed_at: new Date(observed * 1000).toISOString(),
        event_id: String(row?.event_id || row?.id || `raven-observation-${observed}-${index}`).slice(0, 160),
        instrument_id: instrumentId,
        inspection: {
          source_evidence: {
            label: "Raven exact-pool observation",
            observed_at: new Date(observed * 1000).toISOString(),
            public_reference: String(row?.event_id || row?.id || `raven-observation-${observed}-${index}`).slice(0, 160),
          },
          support: [],
          contradiction: [],
          path_transition: null,
          historical_outcome: null,
          evidence_maturity: "observation_only",
        },
        ...(compatiblePrice !== null ? { price: compatiblePrice } : {}),
      };
    })
    .filter(Boolean);
}

function publicRavenChartLineage(ravenPayload = {}) {
  const observedAt = String(ravenPayload.observed_at || "").trim();
  const observedTimestamp = Date.parse(observedAt);
  return {
    role: "annotation_only",
    identity_scope: "exact_pool",
    ...(Number.isFinite(observedTimestamp) ? { observed_at: new Date(observedTimestamp).toISOString() } : {}),
  };
}

function attachRavenChartAnnotations(providerPayload, ravenPayload) {
  if (!providerPayload?.ok || !ravenPayload?.ok || !sameExactPool(providerPayload, ravenPayload)) return providerPayload;
  const comparableUsdPrices = ravenPayload.price_unit === "usd_per_token";
  const events = ravenAnnotationEvents(ravenPayload, providerPayload.candles, {
    timeframe: providerPayload.timeframe,
    instrumentId: providerPayload.instrument?.canonical_id || null,
  });
  const publicLineage = publicRavenChartLineage(ravenPayload);
  const publicSource = "Raven exact-pool observations";
  return {
    ...providerPayload,
    recent_trades: comparableUsdPrices ? (ravenPayload.recent_trades || []) : [],
    available_scopes: {
      exact_pool: ravenPayload.available_scopes?.exact_pool === true,
      token_aggregate: ravenPayload.available_scopes?.token_aggregate === true,
    },
    capabilities: {
      ...(providerPayload.capabilities || {}),
      raven_overlays: true,
      live_trades: comparableUsdPrices && Boolean(ravenPayload.recent_trades?.length),
    },
    raven_annotations: {
      schema_version: "ravenos.chart_annotations.v1",
      role: "annotation_only",
      source: publicSource,
      observed_at: publicLineage.observed_at || null,
      freshness_state: ravenPayload.freshness_state || "unknown",
      identity_scope: "exact_pool",
      instrument_id: providerPayload.instrument?.canonical_id || null,
      market_identity: providerPayload.market_identity || null,
      price_unit: ravenPayload.price_unit || "unknown",
      event_count: events.length,
      events,
      overlays: [],
      price_axis_compatible: comparableUsdPrices,
      candle_replacement_allowed: false,
      lineage: {
        ...publicLineage,
        source: publicSource,
      },
    },
    lineage: {
      ...(providerPayload.lineage || {}),
      raven_projection: publicLineage,
      raven_observed_at: publicLineage.observed_at || null,
      source_precedence: "provider_ohlcv_base_raven_annotations_only",
    },
  };
}

async function fetchDexPaprikaPoolIdentity({ env = {}, chain = "", pairAddress = "", tokenAddress = "", quoteAddress = "" } = {}) {
  const providerId = "dexpaprika";
  const runtime = onchainProviderRuntime(providerId, env);
  const providerNetwork = onchainProviderNetwork(providerId, chain);
  const pool = normalizeProviderPoolAddress(chain, pairAddress);
  if (!providerNetwork || !pool) throw new Error("dexpaprika_coverage_unavailable");
  if (!String(tokenAddress || "").trim()) throw new Error("dexpaprika_token_identity_required");
  const path = `/networks/${encodeURIComponent(providerNetwork)}/pools/${encodeURIComponent(pool)}`;
  const payload = await cachedDexPaprika(path, { ttlMs: 24 * 60 * 60 * 1_000, maxBytes: 256 * 1024 });
  const tokens = Array.isArray(payload?.tokens) ? payload.tokens.slice(0, 4) : [];
  if (!sameOnchainAddress(chain, payload?.id, pool) || String(payload?.chain || "").toLowerCase() !== providerNetwork) {
    throw new Error("dexpaprika_pool_identity_mismatch");
  }
  const selectedIndex = tokens.findIndex((token) => sameOnchainAddress(chain, token?.id, tokenAddress));
  if (selectedIndex < 0) throw new Error("dexpaprika_token_identity_mismatch");
  const providerBaseAddress = String(payload?.base_token_id || "");
  const providerQuoteAddress = String(payload?.quote_token_id || "");
  const selectedIsBase = sameOnchainAddress(chain, providerBaseAddress, tokenAddress);
  const selectedIsQuote = sameOnchainAddress(chain, providerQuoteAddress, tokenAddress);
  if (!selectedIsBase && !selectedIsQuote) throw new Error("dexpaprika_token_orientation_mismatch");
  const counterAddress = selectedIsBase ? providerQuoteAddress : providerBaseAddress;
  const quoteIndex = tokens.findIndex((token, index) => index !== selectedIndex && sameOnchainAddress(chain, token?.id, counterAddress));
  if (quoteIndex < 0) throw new Error("dexpaprika_quote_identity_mismatch");
  if (quoteAddress && !sameOnchainAddress(chain, quoteAddress, counterAddress)) throw new Error("dexpaprika_quote_identity_mismatch");
  const selectedToken = tokens[selectedIndex] || {};
  const quoteToken = tokens[quoteIndex] || {};
  const selectedTokenDecimals = Number(selectedToken.decimals);
  const quoteTokenDecimals = Number(quoteToken.decimals);
  return {
    schema_version: RAVENOS_ONCHAIN_CHART_PROVIDER_REGISTRY_SCHEMA,
    provider_id: providerId,
    provider_label: runtime.label,
    provider_network: providerNetwork,
    pool_address: pool,
    selected_token_address: String(selectedToken.id || tokenAddress),
    selected_token_symbol: String(selectedToken.symbol || "TOKEN"),
    selected_token_decimals: Number.isInteger(selectedTokenDecimals) && selectedTokenDecimals >= 0 && selectedTokenDecimals <= 36
      ? selectedTokenDecimals
      : null,
    quote_token_address: String(quoteToken.id || quoteAddress || ""),
    quote_token_symbol: String(quoteToken.symbol || "QUOTE"),
    quote_token_decimals: Number.isInteger(quoteTokenDecimals) && quoteTokenDecimals >= 0 && quoteTokenDecimals <= 36
      ? quoteTokenDecimals
      : null,
    selected_token_index: selectedIndex,
    inversed: selectedIsQuote,
    orientation: "selected_token_usd",
    dex_id: String(payload?.dex_id || ""),
    dex_name: String(payload?.dex_name || ""),
    pool_created_at: payload?.created_at || null,
    pool_liquidity_usd: Number.isFinite(Number(payload?.liquidity_usd)) ? Number(payload.liquidity_usd) : null,
    provider_price_time: payload?.price_time || null,
  };
}

async function fetchDexPaprikaPoolCandles({ env = {}, chain = "", pairAddress = "", tokenAddress = "", quoteAddress = "", asset = "", timeframe = "1h", before = null, limit = null } = {}) {
  const providerId = "dexpaprika";
  const capability = resolveChartCapability({ market: "crypto_spot", chain, instrumentType: "spot_pool", pairAddress, timeframe, providerId });
  const runtime = onchainProviderRuntime(providerId, env);
  const network = capability.provider_network;
  const pool = normalizeProviderPoolAddress(chain, pairAddress);
  if (!capability.chart_ready || !network || !pool) {
    return unresolvedChart(asset, capability.unavailable_reason || "DexPaprika exact-pool chart coverage is unavailable for this market.", {
      source: runtime.label,
      sourceType: network ? "interval_unavailable" : "coverage_unavailable",
      timeframe,
    });
  }
  const identity = await fetchDexPaprikaPoolIdentity({ env, chain, pairAddress: pool, tokenAddress, quoteAddress });
  const spec = dexPaprikaTimeframeSpec(timeframe);
  const requestedLimit = boundedChartLimit(limit, spec.limit, spec.limit);
  const beforeSeconds = chartBeforeSeconds(before);
  const windowEndSeconds = beforeSeconds || Math.trunc(Date.now() / 1_000);
  const cacheKey = `dexpaprika:v2:${network}:${pool}:${identity.selected_token_address}:${timeframe}:${beforeSeconds || "latest"}:${requestedLimit}`;
  const withCacheUsage = (payload, cacheState) => ({
    ...payload,
    from_cache: true,
    cache_state: cacheState,
    provider_usage: {
      ...(payload.provider_usage || {}),
      cache_hit: true,
      cache_state: cacheState,
      active_viewer_signal: 1,
    },
  });
  const cached = cacheGet(terminalChartCache, cacheKey);
  if (cached) {
    recordProviderComponentEvent({ component: "market_chart_data", category: "success", cache_hit: true, reason_code: "dexpaprika_exact_pool_cache_hit" });
    return withCacheUsage(cached, "isolate_fresh");
  }
  const edgeCached = await chartEdgeCacheRead(cacheKey, "fresh");
  if (edgeCached?.ok) {
    const payload = withCacheUsage(edgeCached, "edge_fresh");
    cacheSet(terminalChartCache, cacheKey, payload, 20_000);
    recordProviderComponentEvent({ component: "market_chart_data", category: "success", cache_hit: true, reason_code: "dexpaprika_exact_pool_edge_cache_hit" });
    return payload;
  }
  let providerRequestCount = 0;
  let directAttempt = spec.directInterval ? null : {
    state: "not_available",
    reason: "provider_has_no_native_interval",
  };
  const fetchInterval = async (providerInterval, continuityInterval, sourceLimit) => {
    const sourceSeconds = timeframeSeconds(continuityInterval);
    const windowStartSeconds = windowEndSeconds - (sourceLimit * sourceSeconds);
    const params = new URLSearchParams({
      start: new Date(windowStartSeconds * 1_000).toISOString(),
      end: new Date(windowEndSeconds * 1_000).toISOString(),
      limit: String(sourceLimit),
      interval: providerInterval,
      inversed: String(identity.inversed),
    });
    const url = `${runtime.base_url}/networks/${encodeURIComponent(network)}/pools/${encodeURIComponent(pool)}/ohlcv?${params.toString()}`;
    providerRequestCount += 1;
    const raw = await boundedProviderJson(url, {
      headers: runtime.request_headers,
      maxBytes: 512 * 1024,
      timeoutMs: 5_000,
      errorPrefix: "dexpaprika_ohlcv",
    });
    if (!Array.isArray(raw) || raw.length > runtime.maximum_source_bars_per_request) throw new Error("dexpaprika_ohlcv_malformed");
    const audit = auditCandleContinuity(raw, {
      interval: continuityInterval,
      nowSeconds: windowEndSeconds,
      volumeSemantics: "provider_reported_additive_volume",
    });
    if (audit.state === "rejected") throw new Error("dexpaprika_ohlcv_continuity_rejected");
    return { raw, audit, windowStartSeconds, sourceLimit };
  };
  try {
    const result = await runProviderOperation({
      component: "market_chart_data",
      operation_key: cacheKey,
      fn: async () => {
        let candles = [];
        let candleAudit = null;
        let directError = null;
        let sourceInterval = spec.directInterval;
        let derivation = {
          state: "direct",
          source_interval: spec.directInterval,
          target_interval: timeframe,
          source_bar_count: 0,
          missing_buckets_filled: 0,
          interpolation_used: false,
        };
        let selectedWindowStart = windowEndSeconds - (requestedLimit * spec.intervalSeconds);
        if (spec.directInterval) {
          try {
            const directLimit = Math.min(runtime.maximum_source_bars_per_request, requestedLimit);
            const continuityInterval = spec.directInterval === "24h" ? "1d" : spec.directInterval;
            const direct = await fetchInterval(spec.directInterval, continuityInterval, directLimit);
            const directCandles = direct.audit.candles.slice(-requestedLimit);
            const minimumBars = minimumUsefulProviderBars(timeframe, requestedLimit, {
              poolCreatedAt: identity.pool_created_at,
              windowStartSeconds: direct.windowStartSeconds,
              windowEndSeconds,
            });
            if (directCandles.length < minimumBars) {
              directAttempt = {
                state: "insufficient_history",
                bars: directCandles.length,
                minimum_bars: minimumBars,
              };
            } else {
              candles = directCandles;
              candleAudit = direct.audit;
              selectedWindowStart = direct.windowStartSeconds;
              derivation.source_bar_count = direct.audit.normalized_rows;
              directAttempt = { state: "selected", bars: directCandles.length };
            }
          } catch (error) {
            directError = error;
            directAttempt = {
              state: publicProviderFailure(error),
              reason: String(error?.message || "direct_interval_unavailable").slice(0, 96),
            };
          }
        }
        if (!candles.length && spec.derivation) {
          sourceInterval = spec.derivation.source_interval;
          const ratio = spec.derivation.expected_source_bars;
          const sourceLimit = Math.min(runtime.maximum_source_bars_per_request, (requestedLimit * ratio) + ratio);
          const derivedSource = await fetchInterval(sourceInterval, sourceInterval, sourceLimit);
          const derived = deriveCompleteCandleInterval(derivedSource.raw, {
            sourceInterval,
            targetInterval: timeframe,
            maxItems: requestedLimit,
            windowEndSeconds,
            allowFormingCurrentBucket: !beforeSeconds,
            volumeSemantics: "provider_reported_additive_volume",
          });
          candles = sanitizeChartCandles(derived.candles, { maxItems: requestedLimit });
          const minimumBars = minimumUsefulProviderBars(timeframe, requestedLimit, {
            poolCreatedAt: identity.pool_created_at,
            windowStartSeconds: derivedSource.windowStartSeconds,
            windowEndSeconds,
          });
          if (derived.state !== "verified" || candles.length < minimumBars) {
            const error = new Error(`dexpaprika_insufficient_depth:${candles.length}:${minimumBars}`);
            error.providerIdentity = identity;
            error.directAttempt = directAttempt;
            error.derivationAttempt = {
              state: derived.state,
              source_interval: sourceInterval,
              bars: candles.length,
              minimum_bars: minimumBars,
              dropped_incomplete_buckets: derived.dropped_incomplete_buckets,
            };
            throw error;
          }
          selectedWindowStart = derivedSource.windowStartSeconds;
          candleAudit = auditCandleContinuity(candles, {
            interval: timeframe,
            nowSeconds: windowEndSeconds,
            volumeSemantics: derived.volume_semantics,
          });
          derivation = {
            state: "derived",
            source_interval: sourceInterval,
            target_interval: timeframe,
            expected_source_bars: ratio,
            source_bar_count: derivedSource.audit.normalized_rows,
            complete_buckets: derived.complete_buckets,
            forming_buckets: derived.forming_buckets,
            dropped_incomplete_buckets: derived.dropped_incomplete_buckets,
            missing_buckets_filled: 0,
            interpolation_used: false,
            direct_attempt: directAttempt,
          };
        }
        if (!candles.length || !candleAudit || candleAudit.state === "rejected") {
          if (!spec.derivation && directError) {
            directError.providerIdentity = identity;
            throw directError;
          }
          const error = new Error("dexpaprika_exact_pool_history_unavailable");
          error.providerIdentity = identity;
          error.directAttempt = directAttempt;
          throw error;
        }
        const minimumBars = minimumUsefulProviderBars(timeframe, requestedLimit, {
          poolCreatedAt: identity.pool_created_at,
          windowStartSeconds: selectedWindowStart,
          windowEndSeconds,
        });
        if (candles.length < minimumBars) throw new Error(`dexpaprika_insufficient_depth:${candles.length}:${minimumBars}`);
        const fetchedAt = new Date().toISOString();
        const lastCandleTime = Number(candles.at(-1)?.time);
        const lastCandleMs = Number.isFinite(lastCandleTime) ? lastCandleTime * 1_000 : null;
        const ageSeconds = Number.isFinite(lastCandleMs) ? Math.max(0, Math.round((Date.now() - lastCandleMs) / 1_000)) : null;
        const delayed = ageSeconds === null || ageSeconds > Math.max(spec.intervalSeconds * 2, 600);
        const instrument = canonicalChartInstrument({
          market: "crypto_spot",
          asset,
          chain,
          venue: identity.dex_id || "onchain_pool",
          pairAddress: pool,
          tokenAddress: identity.selected_token_address,
          quoteAsset: identity.quote_token_symbol,
          provider: providerId,
        });
        const lastCandleAt = Number.isFinite(lastCandleMs) ? new Date(lastCandleMs).toISOString() : null;
        const requestedIdentity = {
          chain: String(chain || "").toLowerCase(),
          pool_address: pool,
          selected_token_address: String(tokenAddress || ""),
          quote_token_address: String(quoteAddress || identity.quote_token_address || ""),
          orientation: "selected_token_usd",
          selected_token_decimals: identity.selected_token_decimals,
          quote_token_decimals: identity.quote_token_decimals,
        };
        const providerIdentity = {
          chain: String(chain || "").toLowerCase(),
          pool_address: identity.pool_address,
          selected_token_address: identity.selected_token_address,
          quote_token_address: identity.quote_token_address,
          orientation: identity.orientation,
          selected_token_decimals: identity.selected_token_decimals,
          quote_token_decimals: identity.quote_token_decimals,
        };
        const identityContinuity = validateExactCandleIdentity({ expected: requestedIdentity, actual: providerIdentity });
        if (!identityContinuity.exact_market_preserved) throw new Error("dexpaprika_identity_continuity_rejected");
        const publicCandleAudit = { ...candleAudit };
        delete publicCandleAudit.candles;
        const payload = {
          ok: true,
          schema_version: "ravenos.onchain_chart.v1",
          provider_contract_version: RAVENOS_ONCHAIN_CHART_PROVIDER_REGISTRY_SCHEMA,
          asset,
          provider_asset: identity.selected_token_address,
          market_identity: `${String(chain || "").toLowerCase()}:${pool}`,
          chain: String(chain || "").toLowerCase(),
          pair_address: pool,
          token_address: identity.selected_token_address,
          quote_address: identity.quote_token_address || null,
          source: runtime.label,
          source_type: "provider",
          source_label: derivation.state === "derived" ? `Exact-pool OHLCV · derived ${sourceInterval}` : "Exact-pool OHLCV",
          provider_status: delayed ? "delayed" : "healthy",
          coverage: delayed ? "Delayed" : "Live",
          stale: delayed,
          freshness_state: delayed ? "delayed" : "live",
          provider_freshness_state: "current",
          candle_freshness_state: delayed ? "delayed" : "current",
          market_activity_state: "unavailable",
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
            live_poll_interval_ms: 20_000,
            liquidity: false,
            order_book: false,
            funding: false,
            open_interest: false,
            raven_overlays: true,
          },
          history_window: {
            before: beforeSeconds,
            returned: candles.length,
            minimum_useful_bars: minimumBars,
            source_rows: derivation.source_bar_count,
            oldest: candles[0]?.time || null,
            newest: candles.at(-1)?.time || null,
          },
          market_state: {
            last: candles.at(-1)?.close || null,
            liquidity_usd: identity.pool_liquidity_usd,
            volume: candles.at(-1)?.volume || null,
            pool_created_at: identity.pool_created_at,
            dex_id: identity.dex_id || null,
            observed_at: fetchedAt,
          },
          build_id: null,
          attribution: {
            required: true,
            label: runtime.attribution_label,
            url: "https://dexpaprika.com/",
          },
          commercial_state: runtime.commercial_state,
          production_state: runtime.production_state,
          continuity: {
            schema_version: "ravenos.chart_continuity.v1",
            state: candleAudit.state === "verified" && identityContinuity.exact_market_preserved ? "verified" : "rejected",
            identity: identityContinuity,
            candles: publicCandleAudit,
            exact_pool_fingerprint: `${String(chain || "").toLowerCase()}:${pool}:${identity.selected_token_address}:${identity.quote_token_address}`,
            selected_token_decimals: identity.selected_token_decimals,
            quote_token_decimals: identity.quote_token_decimals,
            token_orientation: "selected_token_usd",
          },
          derivation,
          provider_usage: {
            schema_version: "ravenos.provider_usage.v1",
            provider: providerId,
            pool: `${network}:${pool}`,
            interval: timeframe,
            source_interval: sourceInterval || timeframe,
            cache_hit: false,
            cache_state: "miss",
            candle_mode: derivation.state,
            provider_request_count: providerRequestCount,
            fallback_event: false,
            active_viewer_signal: 1,
            active_viewer_measurement: "request_signal_only",
            projected_cost_state: "unpriced_evaluation",
            projected_provider_requests_per_active_refresh: providerRequestCount,
          },
          lineage: {
            provider: runtime.label,
            provider_tier: runtime.provider_tier,
            network,
            pool_address: pool,
            token_address: identity.selected_token_address,
            quote_address: identity.quote_token_address || null,
            price_currency: "USD",
            token_orientation: "selected_token_usd",
            provider_interval: sourceInterval || timeframe,
            requested_interval: timeframe,
            derived_interval: derivation.state === "derived",
            derivation_state: derivation.state,
            continuity_state: candleAudit.state,
            last_candle_at: lastCandleAt,
          },
          candles,
        };
        payload.candle_series = candleSeriesContract({
          instrument,
          provider: providerId,
          providerMarketId: `${network}:${pool}`,
          timeframe,
          priceCurrency: "USD",
          tokenOrientation: "selected_token_usd",
          sourceInterval: sourceInterval || timeframe,
          derivation,
          continuity: candleAudit,
          freshnessState: delayed ? "delayed" : "live",
          candles,
        });
        cacheSet(terminalChartCache, cacheKey, payload, 30_000);
        return payload;
      },
    });
    await chartEdgeCacheWrite(cacheKey, result);
    return result;
  } catch (error) {
    if (!error.providerIdentity) error.providerIdentity = identity;
    if (!error.directAttempt) error.directAttempt = directAttempt;
    const rescued = await chartEdgeCacheRead(cacheKey, "rescue");
    if (!rescued?.ok) throw error;
    const payload = withCacheUsage(degradedChartCachePayload(rescued, error), "edge_stale_rescue");
    cacheSet(terminalChartCache, cacheKey, payload, 15_000);
    recordProviderComponentEvent({
      component: "market_chart_data",
      category: "degraded",
      cache_hit: true,
      reason_code: "dexpaprika_exact_pool_stale_rescue",
      rate_limited: String(error?.message || "").includes("429"),
    });
    return payload;
  }
}

function geckoRelationshipAddress(relationshipId, network) {
  const value = String(relationshipId || "");
  const prefix = `${String(network || "")}_`;
  return value.startsWith(prefix) ? value.slice(prefix.length) : "";
}

function geckoIncludedToken(payload, address, network) {
  const match = (Array.isArray(payload?.included) ? payload.included : []).find((row) => (
    row?.type === "token"
    && sameOnchainAddress(network === "solana" ? "solana" : "evm", row?.attributes?.address || geckoRelationshipAddress(row?.id, network), address)
  ));
  const decimals = Number(match?.attributes?.decimals);
  return {
    address: String(match?.attributes?.address || address || ""),
    decimals: Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? decimals : null,
  };
}

function optionalFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function boundedPublicLabel(value, fallback = "", limit = 80) {
  const clean = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (clean || fallback).slice(0, limit);
}

function safeGeckoImageUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (
      url.protocol !== "https:"
      || !["coin-images.coingecko.com", "assets.coingecko.com", "assets.geckoterminal.com"].includes(url.hostname)
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function safePublicLink(value, kind = "website") {
  const raw = String(value || "").trim();
  if (!raw) return null;
  let candidate = raw;
  if (kind === "x" && !/^https?:\/\//i.test(candidate)) {
    const handle = candidate.replace(/^@/, "");
    if (!/^[A-Za-z0-9_]{1,32}$/.test(handle)) return null;
    candidate = `https://x.com/${handle}`;
  } else if (kind === "telegram" && !/^https?:\/\//i.test(candidate)) {
    const handle = candidate.replace(/^@/, "");
    if (!/^[A-Za-z0-9_]{3,64}$/.test(handle)) return null;
    candidate = `https://t.me/${handle}`;
  }
  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || !host
      || host === "localhost"
      || host.endsWith(".local")
      || host === "0.0.0.0"
      || host === "127.0.0.1"
      || host === "::1"
      || host === "[::1]"
      || host.startsWith("[")
      || /^10\./.test(host)
      || /^192\.168\./.test(host)
      || /^169\.254\./.test(host)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) return null;
    const allowed = {
      x: ["x.com", "www.x.com", "twitter.com", "www.twitter.com"],
      telegram: ["t.me", "www.t.me", "telegram.me", "www.telegram.me"],
      discord: ["discord.gg", "www.discord.gg", "discord.com", "www.discord.com"],
      farcaster: ["warpcast.com", "www.warpcast.com", "farcaster.xyz", "www.farcaster.xyz"],
      zora: ["zora.co", "www.zora.co"],
    };
    if (allowed[kind] && !allowed[kind].includes(host)) return null;
    url.hash = "";
    const normalized = url.toString();
    return normalized.length <= 512 ? normalized : null;
  } catch {
    return null;
  }
}

function publicPercentage(value) {
  const parsed = optionalFiniteNumber(value);
  return parsed !== null && parsed >= 0 && parsed <= 100 ? parsed : null;
}

function normalizeTokenControl(value) {
  if (value === false || String(value || "").trim().toLowerCase() === "no") return "disabled";
  if (value === true || String(value || "").trim().toLowerCase() === "yes") return "enabled";
  if (
    typeof value === "string"
    && value.trim()
    && !["unknown", "null", "none"].includes(value.trim().toLowerCase())
  ) return "enabled";
  return "unknown";
}

function normalizeHoneypotState(value) {
  if (value === true || String(value || "").trim().toLowerCase() === "true") return "flagged";
  if (value === false || String(value || "").trim().toLowerCase() === "false") return "not_flagged";
  return "unknown";
}

function normalizeGeckoHolderDistribution(value = {}) {
  const count = optionalFiniteNumber(value?.count);
  const distribution = value?.distribution_percentage || {};
  const top10 = publicPercentage(distribution.top_10);
  const next10 = publicPercentage(distribution["11_20"]);
  const next20 = publicPercentage(distribution["21_40"]);
  const rest = publicPercentage(distribution.rest);
  const percentages = [top10, next10, next20, rest];
  const complete = percentages.every((item) => item !== null);
  const total = complete ? percentages.reduce((sum, item) => sum + item, 0) : null;
  const observedAt = publicIsoTimestamp(value?.last_updated);
  if (
    count === null
    || count < 0
    || count > 10_000_000_000
    || !complete
    || total < 99
    || total > 101
    || !observedAt
  ) return null;
  return {
    state: "available",
    holder_count: Math.round(count),
    observed_at: observedAt,
    top_10_pct: top10,
    next_10_pct: next10,
    next_20_pct: next20,
    rest_pct: rest,
  };
}

function geckoProfileLinks(attributes = {}) {
  const links = [];
  const seenUrls = new Set();
  const seenKinds = new Set();
  const socialKindByHost = new Map([
    ["x.com", ["x", "X"]],
    ["twitter.com", ["x", "X"]],
    ["t.me", ["telegram", "Telegram"]],
    ["telegram.me", ["telegram", "Telegram"]],
    ["discord.gg", ["discord", "Discord"]],
    ["discord.com", ["discord", "Discord"]],
    ["warpcast.com", ["farcaster", "Farcaster"]],
    ["farcaster.xyz", ["farcaster", "Farcaster"]],
    ["zora.co", ["zora", "Zora"]],
  ]);
  const add = (kind, label, value) => {
    const url = safePublicLink(value, kind);
    if (!url || seenUrls.has(url)) return;
    let key = kind;
    if (kind === "website") {
      try {
        key = `website:${new URL(url).hostname.replace(/^www\./, "").toLowerCase()}`;
      } catch {
        return;
      }
    }
    if (seenKinds.has(key)) return;
    seenUrls.add(url);
    seenKinds.add(key);
    links.push({ kind, label, url });
  };
  for (const website of (Array.isArray(attributes.websites) ? attributes.websites : []).slice(0, 6)) {
    const url = safePublicLink(website, "website");
    if (!url) continue;
    let label = "Website";
    let kind = "website";
    try {
      const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
      const social = socialKindByHost.get(host);
      if (social) [kind, label] = social;
      else label = host.slice(0, 48);
    } catch {
      // The URL was already validated; retain the generic label.
    }
    add(kind, label, url);
  }
  add("x", "X", attributes.twitter_handle);
  add("telegram", "Telegram", attributes.telegram_handle);
  add("discord", "Discord", attributes.discord_url);
  add("farcaster", "Farcaster", attributes.farcaster_url);
  add("zora", "Zora", attributes.zora_url);
  return links.slice(0, 6);
}

async function fetchGeckoPoolMarketProfile({
  env = {},
  chain = "",
  pairAddress = "",
  tokenAddress = "",
  quoteAddress = "",
} = {}) {
  const providerId = "coingecko_onchain";
  const runtime = onchainProviderRuntime(providerId, env);
  const network = onchainProviderNetwork(providerId, chain);
  const pool = normalizeProviderPoolAddress(chain, pairAddress);
  if (!network || !pool || !String(tokenAddress || "").trim()) {
    throw new Error("coingecko_market_profile_identity_required");
  }
  if (!runtime.runtime_allowed || !runtime.credential_present) {
    throw new Error(runtime.runtime_block_reason || "coingecko_market_profile_provider_unavailable");
  }
  const canonicalToken = String(chain || "").toLowerCase() === "solana"
    ? String(tokenAddress)
    : String(tokenAddress).toLowerCase();
  const cacheKey = `${runtime.provider_tier}:${network}:${pool}:${canonicalToken}`;
  const cached = cacheGet(geckoMarketProfileCache, cacheKey);
  if (cached) {
    return {
      ...cached,
      usage: {
        provider: providerId,
        cache_hit: true,
        provider_request_count: 0,
      },
    };
  }
  const edgeCacheKey = `market-profile:${cacheKey}`;
  const edgeCached = await chartEdgeCacheRead(edgeCacheKey, "fresh");
  if (edgeCached?.schema_version === "ravenos.onchain_market_profile.v1") {
    const { ok: _edgeOk, ...profile } = edgeCached;
    const result = {
      ...profile,
      usage: {
        provider: providerId,
        cache_hit: true,
        provider_request_count: 0,
      },
    };
    cacheSet(geckoMarketProfileCache, cacheKey, result, 10 * 60 * 1_000);
    return result;
  }
  const payload = await runProviderOperation({
    component: "onchain_market_profile",
    operation_key: `profile:${cacheKey}`,
    fn: () => boundedProviderJson(
      `${runtime.base_url}/networks/${encodeURIComponent(network)}/pools/${encodeURIComponent(pool)}/info`,
      {
        headers: {
          "user-agent": "RavenOS/1.0 exact-market-profile",
          ...runtime.request_headers,
        },
        maxBytes: 256 * 1024,
        timeoutMs: 3_500,
        errorPrefix: "coingecko_market_profile",
      },
    ),
  });
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const tokenRows = rows.filter((row) => row?.type === "token" && String(row?.attributes?.address || "").trim());
  const selected = tokenRows.find((row) => (
    row?.type === "token"
    && sameOnchainAddress(chain, row?.attributes?.address, tokenAddress)
  ));
  if (!selected) throw new Error("coingecko_market_profile_token_identity_mismatch");
  const counterRows = tokenRows.filter((row) => !sameOnchainAddress(chain, row?.attributes?.address, tokenAddress));
  if (counterRows.length !== 1) throw new Error("coingecko_market_profile_quote_identity_malformed");
  const providerQuoteAddress = String(counterRows[0]?.attributes?.address || "");
  if (
    quoteAddress
    && !sameOnchainAddress(chain, providerQuoteAddress, quoteAddress)
  ) throw new Error("coingecko_market_profile_quote_identity_mismatch");
  const attributes = selected.attributes || {};
  const developerHolding = publicPercentage(attributes.developer_holding_percentage);
  const launchCompletedAt = publicIsoTimestamp(attributes.launchpad_details?.completed_at);
  const result = {
    schema_version: "ravenos.onchain_market_profile.v1",
    identity: {
      state: "exact",
      chain: String(chain || "").toLowerCase(),
      pool_address: pool,
      token_address: String(tokenAddress),
      quote_token_address: String(quoteAddress || providerQuoteAddress),
    },
    token: {
      name: boundedPublicLabel(attributes.name, "", 80) || null,
      symbol: boundedPublicLabel(attributes.symbol, "", 24) || null,
      decimals: Number.isInteger(Number(attributes.decimals)) && Number(attributes.decimals) >= 0 && Number(attributes.decimals) <= 36
        ? Number(attributes.decimals)
        : null,
      image_url: safeGeckoImageUrl(attributes.image_url || attributes.image),
    },
    holder_distribution: normalizeGeckoHolderDistribution(attributes.holders),
    token_controls: {
      mint_authority: normalizeTokenControl(attributes.mint_authority),
      freeze_authority: normalizeTokenControl(attributes.freeze_authority),
      honeypot: normalizeHoneypotState(attributes.is_honeypot),
      developer_holding_pct: developerHolding,
    },
    launch: attributes.launchpad_details && typeof attributes.launchpad_details === "object"
      ? {
        completed: attributes.launchpad_details.completed === true,
        completed_at: launchCompletedAt,
      }
      : null,
    links: geckoProfileLinks(attributes),
    fetched_at: new Date().toISOString(),
    attribution: {
      required: runtime.attribution_required === true,
      label: runtime.attribution_label,
      url: runtime.attribution_url,
    },
    usage: {
      provider: providerId,
      cache_hit: false,
      provider_request_count: 1,
    },
  };
  cacheSet(geckoMarketProfileCache, cacheKey, result, 10 * 60 * 1_000);
  await chartEdgeCacheWrite(edgeCacheKey, { ...result, ok: true }, {
    freshTtlSeconds: 10 * 60,
    rescueTtlSeconds: 10 * 60,
  });
  return result;
}

function geckoIncludedResource(payload, id, type) {
  if (!id) return null;
  return (Array.isArray(payload?.included) ? payload.included : []).find((row) => (
    row?.id === id && row?.type === type
  )) || null;
}

function pulseTransactionMetrics(attributes = {}, providerWindow = "") {
  const row = attributes?.transactions?.[providerWindow] || {};
  const buys = optionalFiniteNumber(row.buys);
  const sells = optionalFiniteNumber(row.sells);
  const buyers = optionalFiniteNumber(row.buyers);
  const sellers = optionalFiniteNumber(row.sellers);
  return {
    buys: buys === null ? null : Math.max(0, Math.round(buys)),
    sells: sells === null ? null : Math.max(0, Math.round(sells)),
    buyers: buyers === null ? null : Math.max(0, Math.round(buyers)),
    sellers: sellers === null ? null : Math.max(0, Math.round(sellers)),
  };
}

function marketPulseRead({ duration, movement, buys, sells, volumeUsd }) {
  const parts = [];
  if (movement !== null) {
    const direction = movement > 0.05 ? "up" : movement < -0.05 ? "down" : "nearly flat";
    parts.push(direction === "nearly flat"
      ? `Price is nearly flat over ${duration}`
      : `Price is ${direction} ${Math.abs(movement).toFixed(Math.abs(movement) < 0.1 ? 3 : 2)}% over ${duration}`);
  }
  if (buys !== null && sells !== null) {
    if (buys >= sells * 1.35 && buys - sells >= 5) parts.push(`buy flow leads ${buys} to ${sells}`);
    else if (sells >= buys * 1.35 && sells - buys >= 5) parts.push(`sell flow leads ${sells} to ${buys}`);
    else parts.push(`${buys + sells} trades are balanced`);
  }
  if (volumeUsd !== null) {
    const formatted = new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(volumeUsd);
    parts.push(`$${formatted} volume`);
  }
  if (!parts.length) return `Current ${duration} pool activity is available.`;
  return `${parts.join(" · ")}.`;
}

function marketPulseRisk({ liquidityUsd, movement }) {
  if (liquidityUsd !== null && liquidityUsd < 25_000) {
    return "Liquidity is thin; slippage and reversals can be sharp.";
  }
  if (movement !== null && Math.abs(movement) >= 20) {
    return "The short-window move is extended and can reverse quickly.";
  }
  return null;
}

function normalizeMarketPulseAddress(chain, value) {
  const address = String(value || "").trim();
  if (String(chain || "").toLowerCase() === "solana") {
    return SOLANA_ADDRESS_RE.test(address) ? address : "";
  }
  const normalized = address.toLowerCase();
  return EVM_ADDRESS_RE.test(normalized) ? normalized : "";
}

function normalizeGeckoTrendingPool(payload, row, {
  chain,
  chainLabel,
  duration,
  providerWindow,
  providerRank,
  fetchedAt,
} = {}) {
  if (row?.type !== "pool") return null;
  const poolAddress = normalizeMarketPulseAddress(chain, row?.attributes?.address);
  if (!poolAddress) return null;
  const baseRelationship = row?.relationships?.base_token?.data?.id;
  const quoteRelationship = row?.relationships?.quote_token?.data?.id;
  const dexRelationship = row?.relationships?.dex?.data?.id;
  const base = geckoIncludedResource(payload, baseRelationship, "token");
  const quote = geckoIncludedResource(payload, quoteRelationship, "token");
  if (!base || !quote) return null;
  const baseAddress = normalizeMarketPulseAddress(
    chain,
    base?.attributes?.address || geckoRelationshipAddress(base?.id, chain),
  );
  const quoteAddress = normalizeMarketPulseAddress(
    chain,
    quote?.attributes?.address || geckoRelationshipAddress(quote?.id, chain),
  );
  if (!baseAddress || !quoteAddress || sameOnchainAddress(chain, baseAddress, quoteAddress)) return null;
  const baseSymbol = boundedPublicLabel(base?.attributes?.symbol, "TOKEN", 24);
  const quoteSymbol = boundedPublicLabel(quote?.attributes?.symbol, "TOKEN", 24);
  const baseStable = STABLE_TOKEN_SYMBOLS.has(baseSymbol.toUpperCase());
  const quoteStable = STABLE_TOKEN_SYMBOLS.has(quoteSymbol.toUpperCase());
  if (baseStable && quoteStable) return null;
  const selectQuote = baseStable && !quoteStable;
  const selected = selectQuote ? quote : base;
  const counter = selectQuote ? base : quote;
  const tokenAddress = selectQuote ? quoteAddress : baseAddress;
  const quoteTokenAddress = selectQuote ? baseAddress : quoteAddress;
  const symbol = boundedPublicLabel(selected?.attributes?.symbol, "TOKEN", 24);
  const quoteAsset = boundedPublicLabel(counter?.attributes?.symbol, "TOKEN", 24);
  const name = boundedPublicLabel(selected?.attributes?.name, symbol, 80);
  const attributes = row.attributes || {};
  const movement = optionalFiniteNumber(attributes?.price_change_percentage?.[providerWindow]);
  const transaction = pulseTransactionMetrics(attributes, providerWindow);
  const volumeUsd = optionalFiniteNumber(attributes?.volume_usd?.[providerWindow]);
  const liquidityUsd = optionalFiniteNumber(attributes.reserve_in_usd);
  const priceUsd = optionalFiniteNumber(
    selectQuote ? attributes.quote_token_price_usd : attributes.base_token_price_usd,
  );
  if (liquidityUsd === null || liquidityUsd <= 0 || priceUsd === null || priceUsd <= 0) return null;
  const poolCreatedAt = Date.parse(attributes.pool_created_at || "");
  const marketAgeSeconds = Number.isFinite(poolCreatedAt)
    ? Math.max(0, Math.round((Date.now() - poolCreatedAt) / 1_000))
    : null;
  const dex = geckoIncludedResource(payload, dexRelationship, "dex");
  const venue = boundedPublicLabel(dex?.attributes?.name, boundedPublicLabel(dexRelationship, "On-chain pool", 60), 60);
  const windowMetrics = {};
  for (const [publicWindow, sourceWindow] of Object.entries(ONCHAIN_PULSE_DURATIONS)) {
    const tx = pulseTransactionMetrics(attributes, sourceWindow);
    windowMetrics[`price_change_${publicWindow}_pct`] = optionalFiniteNumber(
      attributes?.price_change_percentage?.[sourceWindow],
    );
    windowMetrics[`volume_usd_${publicWindow}`] = optionalFiniteNumber(attributes?.volume_usd?.[sourceWindow]);
    windowMetrics[`buys_${publicWindow}`] = tx.buys;
    windowMetrics[`sells_${publicWindow}`] = tx.sells;
    windowMetrics[`buyers_${publicWindow}`] = tx.buyers;
    windowMetrics[`sellers_${publicWindow}`] = tx.sellers;
  }
  return {
    public_attention_id: `market:${chain}:${poolAddress}`,
    instrument_id: `${chain}:pool:${poolAddress}`,
    source_type: "market_activity",
    discovery_source: chain === "robinhood" ? "coingecko_robinhood_trending" : "coingecko_trending_pools",
    market_type: "spot",
    chain: chainLabel,
    chain_id: chain,
    venue,
    identity_scope: "exact_pool",
    symbol,
    name,
    token_address: tokenAddress,
    quote_token_address: quoteTokenAddress,
    quote_symbol: quoteAsset,
    pool_address: poolAddress,
    image_url: safeGeckoImageUrl(selected?.attributes?.image_url),
    observed_at: fetchedAt,
    age_seconds: 0,
    context_state: "current",
    movement_state: movement === null
      ? "Active pool"
      : movement > 0.5 ? "Rising activity" : movement < -0.5 ? "Falling activity" : "Active and range-bound",
    what_changed: marketPulseRead({
      duration,
      movement,
      buys: transaction.buys,
      sells: transaction.sells,
      volumeUsd,
    }),
    risk: marketPulseRisk({ liquidityUsd, movement }),
    provider_rank: providerRank,
    ranking_duration: duration,
    market: {
      price_usd: priceUsd,
      liquidity_usd: liquidityUsd,
      market_cap_usd: selectQuote ? null : optionalFiniteNumber(attributes.market_cap_usd),
      fdv_usd: selectQuote ? null : optionalFiniteNumber(attributes.fdv_usd),
      market_age_seconds: marketAgeSeconds,
      pool_created_at: Number.isFinite(poolCreatedAt) ? new Date(poolCreatedAt).toISOString() : null,
      ...windowMetrics,
    },
    inspection: {
      state: "exact_pool_ready",
      silent_pool_selection: false,
    },
    research_only: true,
    actionable: false,
    execution_available: false,
  };
}

function parseOnchainPulseChains(value) {
  const requested = String(value || "solana,base,ethereum,robinhood")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (!requested.length || requested.some((chain) => !ONCHAIN_PULSE_NETWORKS[chain])) return null;
  return [...new Set(requested)].slice(0, 4);
}

function jupiterVelocityStats(token = {}, duration = "5m") {
  const key = duration === "24h" ? "stats24h" : duration === "1h" ? "stats1h" : "stats5m";
  const stats = token?.[key] || {};
  const buyVolume = optionalFiniteNumber(stats.buyVolume);
  const sellVolume = optionalFiniteNumber(stats.sellVolume);
  return {
    price_change_pct: optionalFiniteNumber(stats.priceChange),
    liquidity_change_pct: optionalFiniteNumber(stats.liquidityChange),
    volume_change_pct: optionalFiniteNumber(stats.volumeChange),
    volume_usd: buyVolume === null && sellVolume === null ? null : (buyVolume || 0) + (sellVolume || 0),
    buys: optionalFiniteNumber(stats.numBuys),
    sells: optionalFiniteNumber(stats.numSells),
    traders: optionalFiniteNumber(stats.numTraders),
    organic_buyers: optionalFiniteNumber(stats.numOrganicBuyers),
    net_buyers: optionalFiniteNumber(stats.numNetBuyers),
  };
}

function normalizeJupiterVelocityToken(token = {}, pair = {}, { duration = "5m", rank = 0, fetchedAt } = {}) {
  const tokenAddress = String(token.id || "").trim();
  if (!SOLANA_ADDRESS_RE.test(tokenAddress) || pair.chainId !== "solana" || pair.tokenAddress !== tokenAddress) return null;
  const poolAddress = String(pair.pairAddress || "").trim();
  const liquidityUsd = optionalFiniteNumber(pair.liquidityUsd);
  const priceUsd = optionalFiniteNumber(token.usdPrice ?? pair.priceUsd);
  if (!poolAddress || !(liquidityUsd > 0) || !(priceUsd > 0)) return null;
  const metrics = Object.fromEntries(["5m", "1h", "24h"].flatMap((window) => {
    const stats = jupiterVelocityStats(token, window);
    return [
      [`price_change_${window}_pct`, stats.price_change_pct],
      [`liquidity_change_${window}_pct`, stats.liquidity_change_pct],
      [`volume_change_${window}_pct`, stats.volume_change_pct],
      [`volume_usd_${window}`, stats.volume_usd],
      [`buys_${window}`, stats.buys],
      [`sells_${window}`, stats.sells],
      [`traders_${window}`, stats.traders],
    ];
  }));
  const current = jupiterVelocityStats(token, duration);
  const firstPoolAt = Date.parse(token?.firstPool?.createdAt || "");
  const pairAgeMs = optionalFiniteNumber(pair.pairAgeMs);
  const marketAgeSeconds = pairAgeMs !== null && pairAgeMs >= 0
    ? Math.round(pairAgeMs / 1_000)
    : Number.isFinite(firstPoolAt) ? Math.max(0, Math.round((Date.now() - firstPoolAt) / 1_000)) : null;
  const symbol = boundedPublicLabel(token.symbol, pair.symbol || "TOKEN", 24);
  return {
    public_attention_id: `jupiter:velocity:${duration}:${tokenAddress}`,
    instrument_id: `solana:pool:${poolAddress}`,
    source_type: "jupiter_velocity",
    discovery_source: "jupiter_toptrending",
    market_type: "spot",
    chain: "Solana",
    chain_id: "solana",
    venue: boundedPublicLabel(pair.dexId, "Solana pool", 60),
    identity_scope: "exact_pool",
    evidence_scope: "exact_token_flow_plus_exact_pool_route",
    symbol,
    name: boundedPublicLabel(token.name, pair.name || symbol, 80),
    token_address: tokenAddress,
    quote_token_address: String(pair.quoteTokenAddress || ""),
    quote_symbol: boundedPublicLabel(pair.quoteSymbol, "", 20),
    pool_address: poolAddress,
    image_url: pair.imageUrl || null,
    observed_at: fetchedAt,
    age_seconds: 0,
    context_state: "current",
    movement_state: current.price_change_pct === null
      ? "Jupiter flow accelerating"
      : current.price_change_pct >= 0 ? "Jupiter upside velocity" : "Jupiter downside velocity",
    what_changed: [
      current.price_change_pct === null ? "" : `Price ${current.price_change_pct >= 0 ? "rose" : "fell"} ${Math.abs(current.price_change_pct).toFixed(2)}% over ${duration}`,
      current.volume_change_pct === null ? "" : `volume ${current.volume_change_pct >= 0 ? "expanded" : "contracted"} ${Math.abs(current.volume_change_pct).toFixed(1)}%`,
      current.buys !== null && current.sells !== null ? `${Math.round(current.buys)} buys · ${Math.round(current.sells)} sells` : "",
      current.traders === null ? "" : `${Math.round(current.traders)} traders`,
    ].filter(Boolean).join(" · ") || "Current Jupiter token flow cleared the discovery feed.",
    risk: "Jupiter flow is token-wide; Terminal revalidates the selected exact pool before showing chart or strategy evidence.",
    provider_rank: rank,
    ranking_duration: duration,
    market: {
      price_usd: priceUsd,
      liquidity_usd: liquidityUsd,
      market_cap_usd: optionalFiniteNumber(token.mcap ?? pair.marketCap),
      fdv_usd: optionalFiniteNumber(token.fdv ?? pair.fdv),
      holder_count: optionalFiniteNumber(token.holderCount),
      market_age_seconds: marketAgeSeconds,
      pool_created_at: marketAgeSeconds === null ? null : new Date(Date.now() - marketAgeSeconds * 1_000).toISOString(),
      ...metrics,
    },
    jupiter: {
      category: "toptrending",
      interval: duration,
      rank,
      organic_score: optionalFiniteNumber(token.organicScore),
      organic_score_label: boundedPublicLabel(token.organicScoreLabel, "", 24) || null,
      verified: token.isVerified === true,
      organic_buyers: current.organic_buyers,
      net_buyers: current.net_buyers,
      metric_scope: "exact_token",
      route_scope: "best_current_exact_pool",
    },
    inspection: { state: "exact_pool_ready", silent_pool_selection: false },
    research_only: true,
    actionable: false,
    execution_available: false,
  };
}

async function jupiterVelocityRows({ env = {}, duration = "5m", fetchedAt = new Date().toISOString() } = {}) {
  const apiKey = String(env.JUPITER_API_KEY || "").trim();
  if (!apiKey) return [];
  const cacheKey = `toptrending:${duration}:configured`;
  const cached = cacheGet(jupiterVelocityCache, cacheKey);
  if (cached) return cached;
  const payload = await runProviderOperation({
    component: "jupiter_token_discovery",
    operation_key: cacheKey,
    fn: () => boundedProviderJson(`${JUPITER_TOKENS_BASE_URL}/toptrending/${encodeURIComponent(duration)}?limit=20`, {
      headers: { "x-api-key": apiKey },
      maxBytes: 512 * 1024,
      timeoutMs: 5_000,
      errorPrefix: "jupiter_tokens",
    }),
  });
  const tokens = (Array.isArray(payload) ? payload : [])
    .filter((row) => SOLANA_ADDRESS_RE.test(String(row?.id || "")))
    .filter((row) => !STABLE_TOKEN_SYMBOLS.has(String(row?.symbol || "").toUpperCase()))
    .slice(0, 20);
  if (!tokens.length) return [];
  const pairs = await runProviderOperation({
    component: "jupiter_token_discovery",
    operation_key: `exact-pools:${tokens.map((row) => row.id).join(",")}`,
    fn: async () => {
      const addresses = tokens.map((row) => row.id).join(",");
      const exactPools = await boundedProviderJson(
        `${DEXSCREENER_BASE_URL}/tokens/v1/solana/${encodeURIComponent(addresses)}`,
        {
          maxBytes: 768 * 1024,
          timeoutMs: 4_000,
          errorPrefix: "dexscreener_jupiter_exact_pools",
        },
      );
      return sortedDexResults(Array.isArray(exactPools) ? exactPools : []);
    },
  });
  const bestPair = new Map();
  for (const pair of pairs) {
    if (!bestPair.has(pair.tokenAddress)) bestPair.set(pair.tokenAddress, pair);
  }
  const rows = tokens
    .map((token, index) => normalizeJupiterVelocityToken(token, bestPair.get(token.id), { duration, rank: index + 1, fetchedAt }))
    .filter(Boolean)
    .slice(0, 10);
  cacheSet(jupiterVelocityCache, cacheKey, rows, 30_000);
  return rows;
}

async function onchainMarketPulse({ env = {}, chains = [], duration = "5m" } = {}) {
  const providerWindow = ONCHAIN_PULSE_DURATIONS[duration];
  if (!providerWindow || !chains.length) throw new Error("onchain_market_pulse_request_invalid");
  const runtime = onchainProviderRuntime("coingecko_onchain", env);
  if (!runtime.runtime_allowed || !runtime.credential_present) {
    throw new Error(runtime.runtime_block_reason || "onchain_market_pulse_provider_unavailable");
  }
  const jupiterConfigured = chains.includes("solana") && Boolean(String(env.JUPITER_API_KEY || "").trim());
  const cacheKey = `${runtime.provider_tier}:${chains.join(",")}:${duration}:jupiter-${jupiterConfigured ? "on" : "off"}`;
  const cached = cacheGet(onchainPulseCache, cacheKey);
  if (cached) return cached;
  const fetchedAt = new Date().toISOString();
  const geckoSettledPromise = Promise.allSettled(chains.map(async (chain) => {
    const network = ONCHAIN_PULSE_NETWORKS[chain];
    const payload = await runProviderOperation({
      component: "onchain_market_pulse",
      operation_key: `trending:${runtime.provider_tier}:${network.provider_network}:${duration}`,
      fn: () => boundedProviderJson(
        `${runtime.base_url}/networks/${encodeURIComponent(network.provider_network)}/trending_pools?include=base_token%2Cquote_token%2Cdex&duration=${encodeURIComponent(duration)}&page=1`,
        {
          headers: runtime.request_headers,
          maxBytes: 384 * 1024,
          timeoutMs: 5_000,
          errorPrefix: "coingecko_trending",
        },
      ),
    });
    const deduped = new Set();
    const rows = [];
    for (const [index, row] of (Array.isArray(payload?.data) ? payload.data : []).slice(0, 20).entries()) {
      const normalized = normalizeGeckoTrendingPool(payload, row, {
        chain,
        chainLabel: network.label,
        duration,
        providerWindow,
        providerRank: index + 1,
        fetchedAt,
      });
      if (!normalized || deduped.has(normalized.token_address)) continue;
      deduped.add(normalized.token_address);
      rows.push(normalized);
      if (rows.length >= 8) break;
    }
    if (!rows.length) throw new Error("coingecko_trending_rows_unavailable");
    return { chain, rows };
  }));
  const jupiterPromise = chains.includes("solana")
    ? jupiterVelocityRows({ env, duration, fetchedAt }).catch(() => [])
    : Promise.resolve([]);
  const [settled, jupiterRows] = await Promise.all([geckoSettledPromise, jupiterPromise]);
  const providerRows = [];
  const failures = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") providerRows.push(...result.value.rows);
    else failures.push({
      chain: chains[index],
      state: "temporarily_unavailable",
    });
  });
  const rowsByToken = new Map();
  for (const row of [...jupiterRows, ...providerRows]) {
    const tokenKey = `${String(row.chain_id || row.chain || "").toLowerCase()}:${String(row.token_address || "")}`;
    if (!rowsByToken.has(tokenKey)) rowsByToken.set(tokenKey, row);
  }
  const rows = [...rowsByToken.values()];
  if (!rows.length) throw new Error("onchain_market_pulse_unavailable");
  const result = {
    ok: true,
    safe_public: true,
    schema_version: "ravenos.onchain_market_pulse.v1",
    generated_at: fetchedAt,
    state: failures.length ? "degraded" : "current",
    freshness: {
      state: "current",
      observed_at: fetchedAt,
      expected_update_seconds: 30,
    },
    duration,
    chains,
    rows,
    unavailable: failures,
    provenance: {
      provider: jupiterRows.length ? "jupiter_tokens_v2 + coingecko_onchain" : "coingecko_onchain",
      role: jupiterRows.length ? "token_velocity_plus_exact_pool_market_activity" : "exact_pool_market_activity",
      raven_signal: false,
      attribution_required: true,
      attribution_label: runtime.attribution_label,
      attribution_url: runtime.attribution_url,
    },
    discovery_lanes: {
      raven_tracked: false,
      jupiter_velocity: jupiterRows.length > 0,
      meteora_exact_pools: rows.some((row) => /meteora/i.test(String(row.venue || ""))),
      robinhood_velocity: rows.some((row) => String(row.chain_id || "").toLowerCase() === "robinhood"),
    },
    execution_boundary: {
      research_only: true,
      signing_available: false,
      submission_available: false,
    },
  };
  cacheSet(onchainPulseCache, cacheKey, result, 30_000);
  return result;
}

async function fetchGeckoPoolIdentity({ env = {}, chain = "", pairAddress = "", tokenAddress = "", quoteAddress = "" } = {}) {
  const providerId = "coingecko_onchain";
  const runtime = onchainProviderRuntime(providerId, env);
  const network = onchainProviderNetwork(providerId, chain);
  const pool = normalizeProviderPoolAddress(chain, pairAddress);
  if (!network || !pool) throw new Error("coingecko_coverage_unavailable");
  if (!runtime.runtime_allowed) throw new Error(runtime.runtime_block_reason || "coingecko_runtime_forbidden");
  if (!String(tokenAddress || "").trim()) throw new Error("coingecko_token_identity_required");
  const cacheKey = `${runtime.provider_tier}:${network}:${pool}`;
  let identity = cacheGet(geckoIdentityCache, cacheKey);
  if (!identity) {
    const payload = await boundedProviderJson(`${runtime.base_url}/networks/${encodeURIComponent(network)}/pools/${encodeURIComponent(pool)}?include=base_token%2Cquote_token`, {
      headers: runtime.request_headers,
      maxBytes: 256 * 1024,
      timeoutMs: 5_000,
      errorPrefix: "coingecko_pool",
    });
    const providerPool = String(payload?.data?.attributes?.address || "");
    const baseAddress = geckoRelationshipAddress(payload?.data?.relationships?.base_token?.data?.id, network);
    const providerQuoteAddress = geckoRelationshipAddress(payload?.data?.relationships?.quote_token?.data?.id, network);
    if (!sameOnchainAddress(chain, providerPool, pool)) throw new Error("coingecko_pool_identity_mismatch");
    if (!baseAddress || !providerQuoteAddress) throw new Error("coingecko_pool_identity_malformed");
    const baseToken = geckoIncludedToken(payload, baseAddress, network);
    const quoteToken = geckoIncludedToken(payload, providerQuoteAddress, network);
    identity = {
      base_address: baseAddress,
      base_decimals: baseToken.decimals,
      quote_address: providerQuoteAddress,
      quote_decimals: quoteToken.decimals,
    };
    cacheSet(geckoIdentityCache, cacheKey, identity, 24 * 60 * 60 * 1_000);
  }
  const selectedIsBase = sameOnchainAddress(chain, identity.base_address, tokenAddress);
  const selectedIsQuote = sameOnchainAddress(chain, identity.quote_address, tokenAddress);
  if (!selectedIsBase && !selectedIsQuote) throw new Error("coingecko_token_identity_mismatch");
  const counterAddress = selectedIsBase ? identity.quote_address : identity.base_address;
  if (quoteAddress && !sameOnchainAddress(chain, quoteAddress, counterAddress)) throw new Error("coingecko_quote_identity_mismatch");
  return {
    selected_token_address: String(tokenAddress),
    quote_token_address: counterAddress,
    token_parameter: selectedIsBase ? "base" : "quote",
    selected_token_decimals: selectedIsBase ? identity.base_decimals : identity.quote_decimals,
    quote_token_decimals: selectedIsBase ? identity.quote_decimals : identity.base_decimals,
    orientation: "selected_token_usd",
  };
}

async function fetchGeckoPoolCandles({ env = {}, chain = "", pairAddress = "", tokenAddress = "", quoteAddress = "", asset = "", timeframe = "1h", before = null, limit = null } = {}) {
  const providerId = "coingecko_onchain";
  const capability = resolveChartCapability({ market: "crypto_spot", chain, instrumentType: "spot_pool", pairAddress, timeframe, providerId });
  const network = capability.provider_network;
  const pool = String(pairAddress || "").trim();
  if (!capability.chart_ready || !network || !pool) {
    return unresolvedChart(asset, capability.unavailable_reason || "Exact-pool chart identity is unavailable for this market.", {
      source: "Onchain market provider",
      sourceType: network ? "interval_unavailable" : "coverage_unavailable",
      timeframe,
    });
  }
  const spec = geckoTimeframeSpec(timeframe);
  const requestedLimit = boundedChartLimit(limit, spec.limit, spec.limit);
  const beforeSeconds = chartBeforeSeconds(before);
  const runtime = onchainProviderRuntime(providerId, env);
  if (!runtime.runtime_allowed) throw new Error(runtime.runtime_block_reason || "coingecko_runtime_forbidden");
  const credentialedProvider = runtime.credential_present;
  const providerTier = runtime.provider_tier;
  const providerName = credentialedProvider ? runtime.label : runtime.public_label;
  const providerBaseUrl = runtime.base_url;
  const cacheKey = `gecko:${providerTier}:${network}:${pool}:${tokenAddress || "base"}:${timeframe}:${beforeSeconds || "latest"}:${requestedLimit}`;
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
        const identity = await fetchGeckoPoolIdentity({ env, chain, pairAddress: pool, tokenAddress, quoteAddress });
        const params = new URLSearchParams({
          aggregate: String(spec.aggregate),
          limit: String(requestedLimit),
          currency: "usd",
          token: identity.token_parameter,
          include_empty_intervals: credentialedProvider ? "true" : "false",
        });
        if (beforeSeconds) params.set("before_timestamp", String(beforeSeconds));
        const url = `${providerBaseUrl}/networks/${encodeURIComponent(network)}/pools/${encodeURIComponent(pool)}/ohlcv/${spec.providerTimeframe}?${params.toString()}`;
        const response = await fetch(url, {
          headers: {
            accept: "application/json",
            "user-agent": "RavenOS/1.0 market-chart",
            ...runtime.request_headers,
          },
        });
        if (!response.ok) throw new Error(`onchain_ohlcv_${response.status}`);
        const payload = await response.json().catch(() => ({}));
        const rows = payload?.data?.attributes?.ohlcv_list;
        const candles = sanitizeChartCandles((Array.isArray(rows) ? rows : []).map(normalizeGeckoCandle).filter(Boolean), {
          maxItems: requestedLimit,
        });
        const candleAudit = auditCandleContinuity(candles, {
          interval: timeframe,
          volumeSemantics: "provider_reported_additive_volume",
        });
        if (candleAudit.state === "rejected") throw new Error("coingecko_ohlcv_continuity_rejected");
        const fetchedAt = new Date().toISOString();
        const lastCandleTime = candles[candles.length - 1]?.time;
        const lastCandleMs = typeof lastCandleTime === "number" ? lastCandleTime * 1000 : Date.parse(lastCandleTime || "");
        const ageSeconds = Number.isFinite(lastCandleMs) ? Math.max(0, Math.round((Date.now() - lastCandleMs) / 1000)) : null;
        const delayed = ageSeconds === null || ageSeconds > Math.max(spec.intervalSeconds * 2, 600);
        const instrument = canonicalChartInstrument({
          market: "crypto_spot",
          asset,
          chain,
          venue: "onchain_pool",
          pairAddress: pool,
          tokenAddress,
          provider: "coingecko_onchain",
        });
        const lastCandleAt = Number.isFinite(lastCandleMs) ? new Date(lastCandleMs).toISOString() : null;
        const identityContinuity = validateExactCandleIdentity({
          expected: {
            chain: String(chain || "").toLowerCase(),
            pool_address: pool,
            selected_token_address: String(tokenAddress || ""),
            quote_token_address: String(quoteAddress || identity.quote_token_address || ""),
            orientation: "selected_token_usd",
            selected_token_decimals: identity.selected_token_decimals,
            quote_token_decimals: identity.quote_token_decimals,
          },
          actual: {
            chain: String(chain || "").toLowerCase(),
            pool_address: pool,
            selected_token_address: identity.selected_token_address,
            quote_token_address: identity.quote_token_address,
            orientation: identity.orientation,
            selected_token_decimals: identity.selected_token_decimals,
            quote_token_decimals: identity.quote_token_decimals,
          },
        });
        if (!identityContinuity.exact_market_preserved) throw new Error("coingecko_identity_continuity_rejected");
        const publicCandleAudit = { ...candleAudit };
        delete publicCandleAudit.candles;
        const result = {
          ok: candles.length > 0,
          asset,
          provider_asset: tokenAddress || null,
          market_identity: `${String(chain || "").toLowerCase()}:${pool}`,
          chain: String(chain || "").toLowerCase(),
          pair_address: pool,
          token_address: identity.selected_token_address,
          quote_address: identity.quote_token_address,
          source: providerName,
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
            live_poll_interval_ms: Number(runtime.refresh_seconds || 60) * 1_000,
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
          attribution: {
            required: runtime.attribution_required === true,
            label: runtime.attribution_label,
            url: runtime.attribution_url,
          },
          build_id: null,
          continuity: {
            schema_version: "ravenos.chart_continuity.v1",
            state: candleAudit.state === "verified" && identityContinuity.exact_market_preserved ? "verified" : "rejected",
            identity: identityContinuity,
            candles: publicCandleAudit,
            exact_pool_fingerprint: `${String(chain || "").toLowerCase()}:${pool}:${identity.selected_token_address}:${identity.quote_token_address}`,
            selected_token_decimals: identity.selected_token_decimals,
            quote_token_decimals: identity.quote_token_decimals,
            token_orientation: "selected_token_usd",
          },
          derivation: {
            state: "direct",
            source_interval: timeframe,
            target_interval: timeframe,
            source_bar_count: candles.length,
            missing_buckets_filled: 0,
            interpolation_used: false,
          },
          provider_usage: {
            schema_version: "ravenos.provider_usage.v1",
            provider: providerId,
            pool: `${network}:${pool}`,
            interval: timeframe,
            source_interval: timeframe,
            cache_hit: false,
            cache_state: "miss",
            candle_mode: "direct",
            provider_request_count: 2,
            fallback_event: false,
            active_viewer_signal: 1,
            active_viewer_measurement: "request_signal_only",
            projected_cost_state: runtime.provider_plan === "demo"
              ? "demo_monthly_budget"
              : runtime.commercial_configured ? "commercial_plan_configured" : "evaluation_only",
            projected_provider_requests_per_active_refresh: 1,
          },
          lineage: {
            provider: providerName,
            provider_tier: providerTier,
            provider_plan: runtime.provider_plan,
            commercial_state: runtime.commercial_state,
            empty_interval_policy: credentialedProvider ? "provider_previous_close_zero_volume" : "excluded",
            network,
            pool_address: pool,
            token_address: identity.selected_token_address,
            quote_address: identity.quote_token_address,
            price_currency: "usd",
            token_orientation: "selected_token_usd",
            last_candle_at: lastCandleAt,
          },
          candles,
        };
        result.candle_series = candleSeriesContract({
          instrument,
          provider: "coingecko_onchain",
          providerMarketId: `${network}:${pool}`,
          timeframe,
          priceCurrency: "USD",
          tokenOrientation: "selected_token_usd",
          sourceInterval: timeframe,
          derivation: result.derivation,
          continuity: candleAudit,
          freshnessState: delayed ? "delayed" : "live",
          candles,
        });
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

function publicProviderFailure(error) {
  const message = String(error?.message || "");
  if (message.includes("insufficient_depth")) return "insufficient_history";
  if (message.includes("429")) return "rate_limited";
  if (message.includes("404") || message.includes("coverage_unavailable")) return "coverage_unavailable";
  if (message.includes("timeout")) return "timed_out";
  if (message.includes("identity")) return "identity_rejected";
  if (message.includes("ohlcv_continuity_rejected")) return "candle_continuity_rejected";
  if (message.includes("keyless_geckoterminal_forbidden")) return "production_capacity_forbidden";
  if (message.includes("keyless_geckoterminal_application_fallback_forbidden") || message.includes("provider_secret_missing")) return "provider_configuration_unavailable";
  if (message.includes("malformed") || message.includes("invalid")) return "invalid_provider_response";
  return "unavailable";
}

async function fetchOnchainPoolCandles(options = {}) {
  const providerOrder = onchainChartProviderOrder(options.env || {});
  const attempts = [];
  let priorProviderIdentity = null;
  for (const providerId of providerOrder) {
    if (!onchainProviderNetwork(providerId, options.chain)) {
      attempts.push({ provider: providerId, state: "not_supported" });
      continue;
    }
    try {
      const payload = providerId === "dexpaprika"
        ? await fetchDexPaprikaPoolCandles(options)
        : await fetchGeckoPoolCandles(options);
      if (!payload?.ok) {
        attempts.push({ provider: providerId, state: payload?.source_type || "unavailable" });
        continue;
      }
      const runtime = onchainProviderRuntime(providerId, options.env || {});
      const selectedIdentity = {
        chain: payload.chain,
        pool_address: payload.pair_address,
        selected_token_address: payload.token_address,
        quote_token_address: payload.quote_address,
        orientation: payload.continuity?.token_orientation || "selected_token_usd",
        selected_token_decimals: payload.continuity?.selected_token_decimals,
        quote_token_decimals: payload.continuity?.quote_token_decimals,
      };
      const transitionContinuity = priorProviderIdentity
        ? validateExactCandleIdentity({
          expected: {
            chain: String(options.chain || "").toLowerCase(),
            pool_address: priorProviderIdentity.pool_address,
            selected_token_address: priorProviderIdentity.selected_token_address,
            quote_token_address: priorProviderIdentity.quote_token_address,
            orientation: priorProviderIdentity.orientation || "selected_token_usd",
            selected_token_decimals: priorProviderIdentity.selected_token_decimals,
            quote_token_decimals: priorProviderIdentity.quote_token_decimals,
          },
          actual: selectedIdentity,
        })
        : null;
      if (
        transitionContinuity
        && (
          !transitionContinuity.exact_market_preserved
          || (String(options.env?.RAVENOS_RELEASE_ENFORCE || "") === "1" && transitionContinuity.state !== "verified")
        )
      ) {
        const error = new Error("onchain_provider_transition_continuity_rejected");
        error.providerAttempts = [...attempts, { provider: providerId, state: "continuity_rejected" }];
        throw error;
      }
      return {
        ...payload,
        chart_readiness: {
          schema_version: "ravenos.exact_market_chart_readiness.v1",
          state: ["fresh", "live"].includes(payload.freshness_state) ? "verified_current" : "verified_with_visible_staleness",
          exact_market_verified: true,
          provider_id: providerId,
          timeframe: payload.timeframe || options.timeframe || null,
          bars: Array.isArray(payload.candles) ? payload.candles.length : 0,
          one_minute_requirement: (payload.timeframe || options.timeframe) === "1m"
            ? (Array.isArray(payload.candles) && payload.candles.length >= 120 ? "verified" : "insufficient_depth")
            : "not_evaluated_by_this_request",
        },
        provider_usage: {
          ...(payload.provider_usage || {}),
          fallback_event: attempts.length > 0,
        },
        provider_selection: {
          schema_version: RAVENOS_ONCHAIN_CHART_PROVIDER_REGISTRY_SCHEMA,
          selected: providerId,
          attempted: [...attempts, { provider: providerId, state: "selected" }],
          fallback: attempts.length > 0,
          exact_market_preserved: true,
          transition_continuity: transitionContinuity || {
            schema_version: "ravenos.chart_continuity.v1",
            state: "not_required",
            exact_market_preserved: true,
            decimals_verified: payload.continuity?.identity?.decimals_verified === true,
          },
          commercial_state: runtime.commercial_state,
          production_state: runtime.production_state,
        },
      };
    } catch (error) {
      const reason = publicProviderFailure(error);
      attempts.push({ provider: providerId, state: reason });
      if (error?.providerIdentity) priorProviderIdentity = error.providerIdentity;
      if (reason === "identity_rejected") {
        error.providerAttempts = attempts;
        throw error;
      }
    }
  }
  const error = new Error("onchain_chart_providers_unavailable");
  error.providerAttempts = attempts;
  error.providerState = attempts.at(-1)?.state || "unavailable";
  throw error;
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
      result.candle_series = candleSeriesContract({
        instrument,
        provider: "hyperliquid_native",
        providerMarketId: `hyperliquid:${coin}`,
        timeframe: spec.displayTimeframe || spec.hyperInterval,
        candles,
      });
      cacheSet(terminalChartCache, cacheKey, result, 15_000);
      return result;
    },
  });
}

async function fetchYahooCandles(ticker, timeframe, {
  assetLabel = ticker,
  assetType = "equity",
  instrumentId = "",
  venue = "traditional",
  listing = "",
  limit = null,
} = {}) {
  const spec = timeframeSpec(timeframe);
  const requestedValue = String(timeframe || "1h");
  const requestedTimeframe = requestedValue === "1M" ? "1M" : requestedValue.toLowerCase();
  const cacheKey = `yahoo:${ticker}:${instrumentId || "aggregate"}:${requestedTimeframe}:${spec.yahooInterval}:${spec.yahooRange}`;
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
      const instrument = assetType === "equity" || assetType === "etf"
        ? normalizeChartInstrument({
          canonicalId: instrumentId,
          instrumentType: assetType === "etf" ? CHART_INSTRUMENT_TYPES.ETF : CHART_INSTRUMENT_TYPES.EQUITY,
          chain: "none",
          venue,
          symbol: ticker,
          baseAsset: ticker,
          quoteAsset: "USD",
          marketStatus: "unknown",
          ravenCoverageState: "atlas_context",
          providerRouting: {
            history: "yahoo_finance",
            live: "bounded_provider_poll",
            providerAsset: ticker,
            providerNetwork: listing || venue,
          },
        })
        : canonicalChartInstrument({
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
        market_identity: instrumentId || instrument.canonical_id,
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
          raven_overlays: !["equity", "etf"].includes(assetType),
          atlas_overlays: false,
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
      result.candle_series = candleSeriesContract({
        instrument,
        provider: assetType === "equity" || assetType === "etf" ? "atlas_listed_market" : "yahoo_finance",
        providerMarketId: instrumentId || ticker,
        timeframe: result.timeframe,
        candles: limitedCandles,
      });
      cacheSet(terminalChartCache, cacheKey, result, 60_000);
      return result;
    },
  });
}

async function fetchPublicListedCandles(env, ticker, timeframe, {
  assetLabel = ticker,
  assetType = "equity",
  instrumentId = "",
  venue = "traditional",
  listing = "",
  limit = null,
} = {}) {
  const requestedValue = String(timeframe || "1h");
  const requestedTimeframe = requestedValue === "1M" ? "1M" : requestedValue.toLowerCase();
  const defaultLimit = timeframeSpec(requestedTimeframe).yahooMaxItems || 360;
  const requestedLimit = limit === null || limit === undefined || limit === ""
    ? defaultLimit
    : boundedChartLimit(limit, defaultLimit, 1000);
  const cacheKey = `listed-origin:${ticker}:${instrumentId}:${requestedTimeframe}:${requestedLimit}`;
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
      const configuredTimeout = Number(env.RAVENOS_PUBLIC_ORIGIN_CHART_TIMEOUT_MS);
      const loaded = await loadPublicInstrumentChart({
        env,
        query: ticker,
        instrumentId,
        timeframe: requestedTimeframe,
        limit: requestedLimit,
        timeoutMs: Number.isFinite(configuredTimeout) && configuredTimeout > 0
          ? Math.min(4_500, configuredTimeout)
          : 4_500,
      });
      if (
        !loaded.available
        || loaded.delivery?.source !== "current_public_origin"
        || loaded.delivery?.fallback !== false
        || loaded.delivery?.freshness_state !== "fresh"
      ) throw new Error("listed_chart_current_origin_unavailable");
      const projection = loaded.payload;
      if (
        projection.instrument_id !== instrumentId
        || projection.instrument?.instrument_id !== instrumentId
        || projection.instrument?.symbol !== ticker
      ) throw new Error("listed_chart_identity_mismatch");
      const candles = sanitizeChartCandles(projection.candles, { maxItems: requestedLimit });
      if (!candles.length) throw new Error("listed_chart_empty");
      const instrument = normalizeChartInstrument({
        canonicalId: instrumentId,
        instrumentType: assetType === "etf" ? CHART_INSTRUMENT_TYPES.ETF : CHART_INSTRUMENT_TYPES.EQUITY,
        chain: "none",
        venue,
        symbol: ticker,
        baseAsset: ticker,
        quoteAsset: "USD",
        marketStatus: projection.instrument?.market_session?.state || "unknown",
        ravenCoverageState: "atlas_context",
        providerRouting: {
          history: "listed_market_history",
          live: "bounded_provider_poll",
          providerAsset: ticker,
          providerNetwork: listing || venue,
        },
      });
      const result = {
        ok: true,
        asset: assetLabel,
        source: projection.provider,
        source_type: "provider",
        source_label: "Market history",
        coverage: "Current provider response",
        stale: false,
        freshness_state: "fresh",
        timeframe: projection.timeframe,
        updated_at: projection.generated_at,
        observed_at: projection.market_data_observed_at,
        market_identity: instrumentId,
        age_seconds: loaded.delivery.age_seconds,
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
          raven_overlays: false,
          atlas_overlays: false,
        },
        history_window: {
          before: null,
          returned: candles.length,
          oldest: candles[0]?.time || null,
          newest: candles[candles.length - 1]?.time || null,
        },
        market_state: {
          last: candles[candles.length - 1]?.close || null,
        },
        delivery: loaded.delivery,
        build_id: null,
        candles,
      };
      result.candle_series = candleSeriesContract({
        instrument,
        provider: "atlas_listed_market",
        providerMarketId: instrumentId,
        timeframe: projection.timeframe,
        candles,
      });
      cacheSet(terminalChartCache, cacheKey, result, 60_000);
      return result;
    },
  });
}

async function resolveTraditionalExactInstrument(env, ticker, instrumentId = "") {
  const symbol = String(ticker || "").trim().toUpperCase();
  const requestedId = String(instrumentId || "").trim().toLowerCase();
  const fixed = EXACT_TRADITIONAL_INSTRUMENTS[symbol];
  if (fixed) {
    if (requestedId && fixed.instrument_id !== requestedId) return null;
    return { ...fixed, symbol };
  }
  if (!requestedId) return null;
  const result = await loadPublicInstrumentLookup({ env, query: symbol });
  if (
    !result.available
    || result.delivery?.source !== "current_public_origin"
    || result.delivery?.fallback !== false
    || result.delivery?.freshness_state !== "fresh"
  ) throw new Error("listed_identity_current_origin_unavailable");
  const matches = (result.payload?.results || []).filter((row) => (
    String(row?.instrument_id || "").toLowerCase() === requestedId
    && String(row?.symbol || "").toUpperCase() === symbol
  ));
  if (matches.length !== 1) return null;
  const row = matches[0];
  return {
    instrument_id: row.instrument_id,
    instrument_type: row.instrument_type,
    venue: row.venue,
    listing: row.market_identity?.listing || row.venue,
    symbol: row.symbol,
  };
}

async function resolveSavedMarketAvailability(env, market) {
  const checkedAt = Math.floor(Date.now() / 1000);
  if (market.instrument_type === "exact_pool") {
    const pairAddress = market.instrument_id.slice(`${market.chain_id}:pool:`.length);
    const rows = await pairDex(market.chain_id, pairAddress);
    const sameAddress = market.chain_id === "solana"
      ? (value) => String(value || "") === pairAddress
      : (value) => String(value || "").toLowerCase() === pairAddress.toLowerCase();
    const exact = rows.find((row) => String(row.chainId || "").toLowerCase() === market.chain_id && sameAddress(row.pairAddress));
    if (!exact) {
      return {
        availability_state: "unavailable",
        availability_reason: "exact_market_not_found",
        availability_checked_at: checkedAt,
      };
    }
    const base = String(exact.symbol || "").trim().slice(0, 32);
    const quote = String(exact.quoteSymbol || "").trim().slice(0, 32);
    return {
      availability_state: "available",
      availability_reason: "exact_market_verified",
      availability_checked_at: checkedAt,
      display_label: [base, quote].filter(Boolean).join("/") || market.display_label,
      base_symbol: base || null,
      quote_symbol: quote || null,
      venue_id: String(exact.dexId || "onchain").toLowerCase(),
    };
  }

  if (market.instrument_type === "perpetual") {
    const payload = await hyperliquidPerps();
    const exact = (payload.results || []).find((row) => String(row.instrument_id || "") === market.instrument_id);
    if (!exact) {
      return {
        availability_state: "unavailable",
        availability_reason: "exact_market_not_found",
        availability_checked_at: checkedAt,
      };
    }
    return {
      availability_state: "available",
      availability_reason: "exact_market_verified",
      availability_checked_at: checkedAt,
      display_label: `${String(exact.symbol || market.base_symbol).slice(0, 32)} perpetual`,
      base_symbol: String(exact.symbol || market.base_symbol).slice(0, 32),
      quote_symbol: "USD",
      venue_id: "hyperliquid",
    };
  }

  if (market.instrument_type === "equity" || market.instrument_type === "etf") {
    const exact = await resolveTraditionalExactInstrument(env, market.base_symbol, market.instrument_id);
    if (!exact) {
      return {
        availability_state: "unavailable",
        availability_reason: "exact_market_not_found",
        availability_checked_at: checkedAt,
      };
    }
    return {
      availability_state: "available",
      availability_reason: "exact_market_verified",
      availability_checked_at: checkedAt,
      display_label: `${String(exact.symbol || market.base_symbol).slice(0, 32)} · ${String(exact.venue || market.venue_id).toUpperCase().slice(0, 40)}`,
      base_symbol: String(exact.symbol || market.base_symbol).slice(0, 32),
      quote_symbol: "USD",
      venue_id: String(exact.venue || market.venue_id).toLowerCase(),
    };
  }

  return {
    availability_state: "unverified",
    availability_reason: "instrument_type_unsupported",
    availability_checked_at: null,
  };
}

function unresolvedChart(asset, message, {
  source = "Coverage Developing",
  sourceType = "coverage_developing",
  timeframe = "",
  providerAsset = null,
  marketIdentity = null,
  instrument = null,
  providerState = null,
} = {}) {
  return {
    ok: false,
    asset,
    provider_asset: providerAsset,
    market_identity: marketIdentity,
    instrument,
    provider_state: providerState,
    source,
    source_type: sourceType,
    source_label: sourceType === "structure_proxy" ? "Structure Proxy" : sourceType === "display_restricted" ? "Display restricted" : "Coverage Developing",
    coverage: sourceType === "display_restricted" ? "Display restricted" : "Coverage Developing",
    stale: false,
    freshness_state: sourceType === "structure_proxy" ? "degraded" : "unavailable",
    timeframe,
    updated_at: new Date().toISOString(),
    observed_at: null,
    age_seconds: null,
    build_id: null,
    message,
    candle_series: null,
    raven_annotations: null,
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
  instrumentId = "",
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
    "IWM": "IWM",
  };
  if (cleanMarket === "equities" || equityMap[cleanAsset]) {
    const ticker = equityMap[cleanAsset] || cleanAsset.replace(/\s+Watch$/i, "");
    const exact = await resolveTraditionalExactInstrument(env, ticker, instrumentId);
    if (!exact) {
      return unresolvedChart(cleanAsset, "The requested symbol and exact traditional-market identity do not match.", {
        source: "Identity registry",
        sourceType: "identity_mismatch",
        timeframe,
      });
    }
    if (!LISTED_MARKET_PUBLIC_DISPLAY_ALLOWED) {
      const listedInstrument = normalizeChartInstrument({
        canonicalId: exact.instrument_id,
        instrumentType: exact.instrument_type === "etf" ? CHART_INSTRUMENT_TYPES.ETF : CHART_INSTRUMENT_TYPES.EQUITY,
        chain: "none",
        venue: exact.venue,
        symbol: ticker,
        baseAsset: ticker,
        quoteAsset: "USD",
        marketStatus: "unknown",
        ravenCoverageState: "atlas_context",
        providerRouting: {
          history: null,
          live: null,
          providerAsset: ticker,
          providerNetwork: exact.listing || exact.venue,
        },
      });
      return unresolvedChart(cleanAsset, "This exact listed market is searchable, but public chart display is unavailable until a commercially qualified data license is configured.", {
        source: "Listed-market data rights",
        sourceType: "display_restricted",
        timeframe,
        providerAsset: ticker,
        marketIdentity: exact.instrument_id,
        instrument: listedInstrument,
        providerState: "display_restricted",
      });
    }
    return fetchPublicListedCandles(env, ticker, timeframe, {
      assetLabel: cleanAsset,
      assetType: exact.instrument_type,
      instrumentId: exact.instrument_id,
      venue: exact.venue,
      listing: exact.listing,
      limit,
    });
  }
  const spotMap = {
    "BTC Spot": "BTC-USD",
    "ETH Spot": "ETH-USD",
    "SOL Spot": "SOL-USD",
    "ARB Spot": "ARB-USD",
  };
  if (cleanMarket === "crypto_spot" && spotMap[cleanAsset]) {
    return unresolvedChart(cleanAsset, "Select an exact provider-supported market. The aggregate proxy chart is unavailable because its public display rights are not qualified.", {
      source: "Aggregate market-data rights",
      sourceType: "display_restricted",
      timeframe,
    });
  }
  if (cleanMarket === "crypto_spot") {
    const requestedScope = instrumentScope === "token_aggregate" ? "token_aggregate" : "exact_pool";
    const spotAttentionPromise = requestedScope === "exact_pool" && !before && pairAddress && tokenAddress
      ? loadCurrentSpotAttentionContext({ env, chain, pairAddress, tokenAddress }).catch(() => null)
      : Promise.resolve(null);
    const marketProfilePromise = requestedScope === "exact_pool" && !before && pairAddress && tokenAddress
      ? fetchGeckoPoolMarketProfile({ env, chain, pairAddress, tokenAddress, quoteAddress }).catch(() => null)
      : Promise.resolve(null);
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
      return unresolvedChart(cleanAsset, `${cleanAsset} does not have enough exact-market trading history for this token and quote orientation.`, {
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
      try {
        const providerPayload = await fetchOnchainPoolCandles({ env, chain, pairAddress, tokenAddress, quoteAddress, asset: cleanAsset, timeframe, before, limit });
        payload = attachRavenChartAnnotations(providerPayload, ravenPayload);
      } catch (providerError) {
        const providerReason = publicProviderFailure(providerError);
        payload = unresolvedChart(cleanAsset, providerReason === "identity_rejected"
          ? "The selected token or quote does not match the exact provider pool. No alternate market was substituted."
          : "Exact-pool candle history is temporarily unavailable. Raven observations were not substituted for market candles.", {
          source: "Onchain market provider",
          sourceType: providerReason === "identity_rejected" ? "identity_mismatch" : "provider_unavailable",
          timeframe,
        });
        payload.failed_layer = "historical_ohlcv";
        payload.provider_state = providerError?.providerState || providerReason;
        payload.provider_attempts = Array.isArray(providerError?.providerAttempts) ? providerError.providerAttempts : [];
        payload.raven_annotations_available = Boolean(ravenPayload?.ok);
      }
      payload.available_scopes = {
        exact_pool: true,
        token_aggregate: Boolean(ravenPayload?.available_scopes?.token_aggregate || aggregateProbe?.ok),
      };
      payload.instrument_scope = "exact_pool";
      let spotAttention = null;
      let marketProfile = null;
      if (!before && payload.ok) {
        const pair = (await pairDex(String(chain || "").toLowerCase(), pairAddress).catch(() => []))[0];
        if (pair) payload.market_state = {
          ...(payload.market_state || {}),
          last: pair.priceUsd,
          liquidity_usd: pair.liquidityUsd,
          volume_24h: pair.volume24h,
          transactions_24h: pair.txns24h,
          buys_24h: pair.buys24h,
          sells_24h: pair.sells24h,
          market_cap: pair.marketCap,
          fully_diluted_value: pair.fdv,
          pool_age_ms: pair.pairAgeMs,
        };
        const marketHealth = classifyOnchainMarketState({
          providerRequestSucceeded: true,
          lastCandleAgeSeconds: payload.last_candle_age_seconds,
          intervalSeconds: timeframeSeconds(payload.timeframe || timeframe),
          lastCandleClose: payload.candles?.at(-1)?.close,
          snapshotPrice: pair?.priceUsd,
          transactions24h: pair?.txns24h,
        });
        payload.market_health = marketHealth;
        payload.provider_freshness_state = marketHealth.provider_delivery_state;
        payload.candle_freshness_state = marketHealth.candle_recency_state;
        payload.market_activity_state = marketHealth.market_activity_state;
        if (marketHealth.chart_state === "current_no_recent_trades") {
          payload.freshness_state = "live";
          payload.stale = false;
          payload.coverage = "Current · no recent trades";
        } else if (marketHealth.chart_state === "delayed") {
          payload.freshness_state = "delayed";
          payload.stale = true;
          payload.coverage = "Chart delayed";
        }
        spotAttention = await spotAttentionPromise.catch(() => null);
      }
      if (!before) marketProfile = await marketProfilePromise.catch(() => null);
      if (marketProfile && payload.provider_usage) {
        const profileRequests = Math.max(0, Math.round(optionalFiniteNumber(marketProfile.usage?.provider_request_count) || 0));
        payload.provider_usage = {
          ...payload.provider_usage,
          provider_request_count: Math.max(0, Math.round(optionalFiniteNumber(payload.provider_usage.provider_request_count) || 0)) + profileRequests,
          market_profile_provider: marketProfile.usage?.provider || null,
          market_profile_cache_hit: marketProfile.usage?.cache_hit === true,
          market_profile_request_count: profileRequests,
        };
      }
      const attentionMarket = spotAttention?.market || {};
      const profileHolderDistribution = marketProfile?.holder_distribution || null;
      const holderCount = profileHolderDistribution?.holder_count ?? attentionMarket.holder_count;
      payload.market_anatomy = {
        schema_version: "ravenos.market_anatomy.v1",
        exact_identity: payload.ok && payload.instrument?.identity_scope === "exact_pool",
        pool_fingerprint: payload.continuity?.exact_pool_fingerprint || `${String(chain || "").toLowerCase()}:${String(pairAddress || "")}`,
        liquidity_usd: payload.market_state?.liquidity_usd ?? null,
        volume_24h_usd: payload.market_state?.volume_24h ?? null,
        transactions_24h: payload.market_state?.transactions_24h ?? null,
        buys_24h: payload.market_state?.buys_24h ?? null,
        sells_24h: payload.market_state?.sells_24h ?? null,
        market_cap_usd: payload.market_state?.market_cap ?? attentionMarket.market_cap_usd ?? null,
        fully_diluted_value_usd: payload.market_state?.fully_diluted_value ?? null,
        pool_created_at: payload.market_state?.pool_created_at || null,
        pool_age_ms: payload.market_state?.pool_age_ms ?? null,
        holder_distribution: profileHolderDistribution ? {
          ...profileHolderDistribution,
          scope: "exact_token",
          change_5m_pct: attentionMarket.holder_change_5m_pct ?? null,
          change_1h_pct: attentionMarket.holder_change_1h_pct ?? null,
          change_24h_pct: attentionMarket.holder_change_24h_pct ?? null,
        } : holderCount !== null && holderCount !== undefined ? {
          state: "available",
          scope: spotAttention.evidence_scope,
          observed_at: spotAttention.projection_generated_at,
          holder_count: holderCount,
          change_5m_pct: attentionMarket.holder_change_5m_pct,
          change_1h_pct: attentionMarket.holder_change_1h_pct,
          change_24h_pct: attentionMarket.holder_change_24h_pct,
        } : { state: "unavailable" },
        market_profile: marketProfile,
        current_activity: spotAttention ? {
          observed_at: spotAttention.projection_generated_at,
          market_age_seconds: attentionMarket.market_age_seconds,
          volume_usd_5m: attentionMarket.volume_usd_5m,
          volume_usd_1h: attentionMarket.volume_usd_1h,
          volume_usd_24h: attentionMarket.volume_usd_24h,
          buys_5m: attentionMarket.buys_5m,
          sells_5m: attentionMarket.sells_5m,
          traders_5m: attentionMarket.traders_5m,
          buys_1h: attentionMarket.buys_1h,
          sells_1h: attentionMarket.sells_1h,
          traders_1h: attentionMarket.traders_1h,
          buys_24h: attentionMarket.buys_24h,
          sells_24h: attentionMarket.sells_24h,
          traders_24h: attentionMarket.traders_24h,
        } : null,
        raven_context: spotAttention,
        route: {
          state: String(chain || "").toLowerCase() === "solana" ? "review_capability_check_required" : "unavailable",
          signing_available: false,
          submission_available: false,
        },
        candle_source: payload.candle_series?.provider || null,
        source_interval: payload.candle_series?.source_interval || payload.timeframe || null,
        derivation_state: payload.candle_series?.derivation?.state || null,
        freshness_state: payload.freshness_state || "unavailable",
        provider_freshness_state: payload.provider_freshness_state || "unavailable",
        candle_freshness_state: payload.candle_freshness_state || "unavailable",
        market_activity_state: payload.market_activity_state || "unavailable",
        last_candle_at: payload.last_candle_at || null,
        last_candle_age_seconds: payload.last_candle_age_seconds ?? null,
        continuity_state: payload.continuity?.state || "unavailable",
      };
      return payload;
    }
    return unresolvedChart(cleanAsset, `${cleanAsset} requires an exact pool identity before Terminal can request spot candles.`, {
      source: "On-chain market provider",
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

async function searchDexPaprika(query) {
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery) return [];
  const payload = await cachedDexPaprika(`/search?query=${encodeURIComponent(cleanQuery)}`, { ttlMs: 30_000, maxBytes: 1024 * 1024 });
  return (Array.isArray(payload?.pools) ? payload.pools : [])
    .slice(0, 100)
    .map((pool) => normalizeDexPaprikaPool(pool, cleanQuery))
    .filter(Boolean);
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

function exactTokenDexResults(rows, tokenAddress, { caseSensitive = false } = {}) {
  const expected = String(tokenAddress || "");
  const same = caseSensitive
    ? (value) => String(value || "") === expected
    : (value) => String(value || "").toLowerCase() === expected.toLowerCase();
  const deduped = new Map();
  for (const row of rows) {
    if (!same(row?.tokenAddress)) continue;
    const key = `${String(row.chainId || "").toLowerCase()}:${String(row.pairAddress || "").toLowerCase()}`;
    if (!row?.chainId || !row?.pairAddress || deduped.has(key)) continue;
    deduped.set(key, row);
  }
  return [...deduped.values()].sort((left, right) => num(right.liquidityUsd) - num(left.liquidityUsd));
}

async function resolveDexInput(input) {
  const q = String(input || "").trim();
  if (!q) return [];
  if (SOLANA_ADDRESS_RE.test(q)) {
    const settled = await Promise.allSettled([tokenDex("solana", q), searchDex(q), searchDexPaprika(q)]);
    return exactTokenDexResults(mergeOnchainSearchRows(settled.flatMap((item) => item.status === "fulfilled" ? item.value : [])), q, { caseSensitive: true });
  }
  if (EVM_ADDRESS_RE.test(q)) {
    const settled = await Promise.allSettled([
      searchDex(q),
      searchDexPaprika(q),
      ...EVM_CHAINS.map((chain) => tokensDex(chain, q)),
    ]);
    return exactTokenDexResults(mergeOnchainSearchRows(settled.flatMap((item) => item.status === "fulfilled" ? item.value : [])), q);
  }
  const pair = q.match(/^([a-z0-9_-]+):([A-Za-z0-9x]+)$/i);
  if (pair) return pairDex(pair[1], pair[2]);
  const settled = await Promise.allSettled([searchDex(q), searchDexPaprika(q)]);
  return mergeOnchainSearchRows(settled.flatMap((item) => item.status === "fulfilled" ? item.value : []));
}

function onchainSearchChartCoverage(row = {}, env = {}) {
  let providerId = null;
  let runtime = null;
  try {
    providerId = onchainChartProviderOrder(env)[0] || null;
    runtime = providerId ? onchainProviderRuntime(providerId, env) : null;
  } catch {
    providerId = null;
  }
  const input = {
    market: "crypto_spot",
    chain: row.chainId,
    instrumentType: "spot_pool",
    pairAddress: row.pairAddress,
    providerId: providerId || "",
  };
  const minute = resolveChartCapability({ ...input, timeframe: "1m" });
  const hour = resolveChartCapability({ ...input, timeframe: "1h" });
  const requestSupported = minute.chart_request_supported === true && hour.chart_request_supported === true;
  return {
    schema_version: "ravenos.search_chart_coverage.v1",
    state: requestSupported ? "probe_required" : "unavailable",
    exact_market_verified: false,
    request_supported: requestSupported,
    one_minute_required: true,
    one_minute_request_supported: minute.chart_request_supported === true,
    one_hour_request_supported: hour.chart_request_supported === true,
    provider_id: providerId,
    provider_plan: runtime?.provider_plan || null,
    provider_runtime_state: runtime?.runtime_allowed ? "configured" : "unavailable",
    reason: requestSupported
      ? "Exact-pool coverage is verified when this market is opened."
      : minute.unavailable_reason || hour.unavailable_reason || "No selected provider route is available for this exact market.",
  };
}

// Legacy wallet-address access and billing scaffolding is intentionally
// quarantined. It predates the customer identity/session security contract and
// must never become reachable through environment flags. A future customer
// service will use separate account, session, wallet-proof, entitlement, and
// transaction-authorization contracts behind a new implementation gate.
function customerAccountsEnabled() {
  return false;
}

function customerBillingEnabled() {
  return false;
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

function publicPublisherHealth(projectionStatus, projectionState, nowMs = Date.now()) {
  const cadenceTargetSeconds = 1_200;
  const freshness = projectionFreshness({
    generated_at: projectionStatus?.last_success_at
      || projectionStatus?.last_publish_at
      || projectionStatus?.generated_at,
    freshness_target_seconds: cadenceTargetSeconds,
  }, { nowMs, defaultTargetSeconds: cadenceTargetSeconds });
  const successful = projectionState === "operational"
    && Number(projectionStatus?.endpoints_published || 0) > 0
    && Number(projectionStatus?.endpoints_failed || 0) === 0
    && projectionStatus?.private_leak_guard_passed === true;
  const state = successful && freshness.state === "fresh"
    ? "operational"
    : successful && freshness.state === "delayed"
      ? "delayed"
      : projectionState === "unavailable" || freshness.state === "unavailable"
        ? "unavailable"
        : "degraded";
  return {
    state,
    blocking: true,
    observation: "current_protected_projection",
    last_success_at: freshness.generated_at,
    age_seconds: freshness.age_seconds,
    cadence_target_seconds: freshness.target_seconds,
    endpoints_published: Number(projectionStatus?.endpoints_published || 0),
    endpoints_failed: Number(projectionStatus?.endpoints_failed || 0),
    private_leak_guard_passed: projectionStatus?.private_leak_guard_passed === true,
    process_visibility: "indirect",
    reason: state === "operational"
      ? null
      : freshness.reason || (successful ? "publisher_cadence_missed" : "publisher_output_not_healthy"),
  };
}

function archivalResearchHealth(researchEndpoint = {}) {
  const sourceFreshnessState = String(researchEndpoint.state || "unavailable");
  return {
    ...researchEndpoint,
    state: sourceFreshnessState === "fresh"
      ? "fresh"
      : sourceFreshnessState === "unavailable"
        ? "unavailable"
        : "historical",
    source_freshness_state: sourceFreshnessState,
    role: "historical_archive",
    current_intelligence: sourceFreshnessState === "fresh",
    blocking: false,
  };
}

function validateCurrentAtlasProjection(result = {}) {
  const payload = result.payload;
  const delivery = result.delivery || {};
  const atlas = payload?.data;
  const execution = atlas?.execution_boundary || {};
  const publicSafety = atlas?.public_safety || {};
  const marketRows = atlas?.market_context?.rows;
  const validIdentityRows = Array.isArray(marketRows) && marketRows.every((row) => (
    typeof row?.instrument_id === "string"
    && row.instrument_id.length > 0
    && row?.instrument?.schema_version === "ravenos.instrument.v1"
    && row.instrument.instrument_id === row.instrument_id
    && row.instrument.identity_scope === "exact_instrument"
    && row.instrument.capabilities?.execution === false
  ));
  if (
    delivery.source !== "current_public_origin"
    || delivery.fallback !== false
    || !["fresh", "delayed"].includes(delivery.freshness_state)
    || payload?.schema_version !== "ravenos_atlas_public_origin_v1"
    || payload?.safe_public !== true
    || payload?.redaction_policy !== "aggregate_public_market_context_only"
    || atlas?.schema_version !== "ravenos.atlas_projection.v1"
    || !["available", "degraded"].includes(atlas?.state)
    || !["fresh", "delayed"].includes(atlas?.freshness?.state)
    || !validIdentityRows
    || execution.signing_available !== false
    || execution.submission_available !== false
    || execution.broker_connection_available !== false
    || publicSafety.credentials_removed !== true
    || publicSafety.provider_payloads_removed !== true
    || atlas?.capabilities?.browser_provider_credentials !== false
  ) return { ok: false, reason: "atlas_current_projection_rejected" };
  return { ok: true, atlas };
}

async function handleAtlas(request, env = {}) {
  const result = await loadPublicProjection({ env, key: "atlas", fallbackPayload: null });
  const current = validateCurrentAtlasProjection(result);
  if (!current.ok) {
    return json({
      ok: false,
      status: "unavailable",
      error: "atlas_projection_unavailable",
      atlas: null,
      historical_context_substituted: false,
      message: "Current public-safe Atlas context is unavailable. No embedded or historical Atlas snapshot was substituted.",
      delivery: result.delivery,
    }, { status: 503, headers: projectionRouteHeaders("/api/atlas", result.delivery) });
  }
  return json(attachDelivery({ ok: true, ...current.atlas }, result.delivery), {
    status: 200,
    headers: projectionRouteHeaders("/api/atlas", result.delivery),
  });
}

async function handleInstrumentSearch(request, env = {}) {
  const url = new URL(request.url);
  const query = String(url.searchParams.get("q") || "").trim().replace(/\s+/g, " ");
  if (!/^[A-Za-z0-9][A-Za-z0-9 .&'/-]{0,63}$/.test(query)) {
    return json({ ok: false, error: "invalid_instrument_query", results: [] }, {
      status: 400,
      headers: { ...routeCacheHeaders("/api/instruments/search"), "x-ravenos-freshness": "unavailable" },
    });
  }
  const result = await loadPublicInstrumentLookup({ env, query });
  if (
    !result.available
    || result.delivery?.source !== "current_public_origin"
    || result.delivery?.fallback !== false
    || result.delivery?.freshness_state !== "fresh"
  ) {
    return json({
      ok: false,
      error: "instrument_lookup_unavailable",
      query,
      results: [],
      delivery: result.delivery,
    }, { status: 503, headers: projectionRouteHeaders("/api/instruments/search", result.delivery) });
  }
  return json(attachDelivery(result.payload, result.delivery), {
    status: 200,
    headers: projectionRouteHeaders("/api/instruments/search", result.delivery),
  });
}

const ATLAS_API_ENDPOINTS = Object.freeze({
  "/api/atlas/featured": "featured",
  "/api/atlas/search": "search",
  "/api/atlas/entity": "entity",
  "/api/atlas/history": "history",
  "/api/atlas/options/expirations": "options_expirations",
  "/api/atlas/options/chain": "options_chain",
  "/api/atlas/sec/filings": "sec_filings",
  "/api/atlas/sec/insiders": "sec_insiders",
  "/api/atlas/eia/facets": "eia_facets",
  "/api/atlas/eia/series": "eia_series",
  "/api/atlas/provider-health": "provider_health",
});

const ATLAS_PUBLIC_QUERY_ALIASES = Object.freeze({
  US02Y: "DGS2",
  US10Y: "DGS10",
  FEDFUNDS: "DFF",
});

function atlasOriginSearchQuery(query = "") {
  const clean = String(query || "").trim().replace(/\s+/g, " ");
  return ATLAS_PUBLIC_QUERY_ALIASES[clean.toUpperCase()] || clean;
}

async function handleAtlasUniverse(request, env = {}, endpoint = "") {
  const url = new URL(request.url);
  const query = String(url.searchParams.get("q") || "");
  const entityId = String(url.searchParams.get("entity_id") || "");
  const expiration = String(url.searchParams.get("expiration") || "");
  const facetId = String(url.searchParams.get("facet_id") || "");
  const facetValue = String(url.searchParams.get("facet_value") || "");
  const frequency = String(url.searchParams.get("frequency") || "");
  const dataField = String(url.searchParams.get("data_field") || "");
  const limit = Number(url.searchParams.get("limit") || (endpoint === "featured" ? 8 : endpoint === "search" ? 20 : 240));
  const viewerToken = String(request.headers.get("x-ravenos-atlas-viewer") || "");
  const originQuery = endpoint === "search" ? atlasOriginSearchQuery(query) : query;
  const result = await loadPublicAtlasUniverse({ env, endpoint, query: originQuery, entityId, expiration, facetId, facetValue, frequency, dataField, limit, viewerToken });
  if (!result.available || result.delivery?.source !== "current_public_origin" || result.delivery?.fallback !== false) {
    const invalid = result.delivery?.reason === "invalid_atlas_request";
    return json({
      ok: false,
      status: "unavailable",
      error: invalid ? "invalid_atlas_request" : "atlas_universe_unavailable",
      endpoint,
      data: null,
      historical_context_substituted: false,
      message: invalid
        ? "The Atlas request could not be resolved to an exact supported entity."
        : "Current public-safe Atlas data is unavailable. No private provider payload or historical substitute was returned.",
      delivery: result.delivery,
    }, {
      status: invalid ? 400 : 503,
      headers: projectionRouteHeaders(url.pathname, result.delivery),
    });
  }
  const payload = endpoint === "search" && originQuery !== query.trim()
    ? { ...result.payload, query: query.trim() }
    : result.payload;
  return json(attachDelivery(payload, result.delivery), {
    status: 200,
    headers: projectionRouteHeaders(url.pathname, result.delivery),
  });
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
  const [manifestResult, statusResult, terminalHealthResult] = await Promise.all([
    loadOriginControlDocument({ env, key: "manifest" }),
    loadOriginControlDocument({ env, key: "status" }),
    loadOriginControlDocument({ env, key: "terminal_health" }),
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
  const atlasEndpoint = endpointHealth.find((row) => row.key === "atlas") || {
    key: "atlas",
    state: "unavailable",
    age_seconds: null,
    freshness_target_seconds: null,
    generated_at: null,
  };
  const intelligenceState = coreEndpointHealth.length === coreKeys.size
    ? worstFreshness(coreEndpointHealth.map((row) => row.state))
    : "unavailable";
  const ravenReadKeys = new Set(["brief", "opportunities", "claims"]);
  const ravenReadEndpoints = endpointHealth.filter((row) => ravenReadKeys.has(row.key));
  const ravenReadState = ravenReadEndpoints.length === ravenReadKeys.size
    ? worstFreshness(ravenReadEndpoints.map((row) => row.state))
    : "unavailable";
  const marketState = String(terminalHealth?.market_data_availability || "unavailable");
  const projectionState = manifestResult.ok
    && statusResult.ok
    && projectionStatus?.private_leak_guard_passed
    && Number(projectionStatus.endpoints_failed || 0) === 0
      ? "operational"
      : manifestResult.ok || statusResult.ok
        ? "degraded"
        : "unavailable";
  const publisherHealth = publicPublisherHealth(projectionStatus, projectionState);
  const researchHealth = archivalResearchHealth(researchEndpoint);
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
  const atlasOperational = atlasEndpoint.state === "fresh" || atlasEndpoint.state === "delayed";
  const productHealthy = intelligenceState === "fresh"
    && ravenReadState === "fresh"
    && marketState === "fresh"
    && atlasOperational
    && projectionState === "operational"
    && publisherHealth.state === "operational";
  const status = !requiredHealthy
    ? "unavailable"
    : productHealthy
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
      research: researchHealth,
      note: researchHealth.state === "historical"
        ? "Research is an explicitly historical archive and does not affect current site health."
        : null,
    },
    atlas_health: {
      ...atlasEndpoint,
      blocking: true,
      independent: true,
      operational: atlasOperational,
      note: atlasEndpoint.state === "delayed"
        ? "Atlas remains usable with its source delay exposed; stale or unavailable Atlas degrades site health."
        : "Atlas is measured independently and is required for complete RavenOS site health.",
    },
    raven_read_health: {
      state: ravenReadState,
      blocking: true,
      mode: "deterministic_structured_projection",
      endpoints: ravenReadEndpoints,
      note: "Current Raven Reads are rendered from structured public-safe evidence rather than a generated-prose sidecar.",
    },
    narrator_freshness: {
      state: "not_required",
      blocking: false,
      mode: "legacy_sidecar_retired",
      generated_at: null,
      age_seconds: null,
      freshness_target_seconds: null,
      reason: "current_product_uses_deterministic_structured_reads",
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
    publisher_health: publisherHealth,
    execution_health: {
      state: "disabled",
      blocking: false,
      mode: "read_only_review",
      quote_only: true,
      signing_available: false,
      submission_available: false,
      note: "Disabled customer execution is an intentional safety boundary, not a site-health failure.",
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
    market_preview_available: true,
    market_preview_markets: ["hyperliquid_perpetual"],
    order_plan_available: true,
    order_plan_markets: ["hyperliquid_perpetual"],
    order_plan_types: ["market", "limit", "trigger"],
    public_account_view_available: true,
    public_account_view_venues: ["hyperliquid"],
    browser_wallet_connection_available: true,
    wallet_connection_scope: "public_address_observation_only",
    wallet_signature_requested: false,
    wallet_connection_persisted: false,
    account_scenario_available: true,
    account_scenario_venues: ["hyperliquid"],
    account_history_available: true,
    account_history_types: ["orders"],
    signing_available: false,
    submission_available: false,
    fees_enabled: false,
    flags,
  }, { status: 200 }, { resultCategory: "ok" });
}

async function handleTradeAccountSnapshot(request, env = {}) {
  const buildId = await terminalBuildId(env, request);
  const context = createTerminalRequestContext({
    request,
    route: "trade_account_snapshot",
    buildId,
    schemaVersion: HYPERLIQUID_ACCOUNT_SNAPSHOT_SCHEMA,
    clientOperationType: "public_account_observation",
    providerComponent: "hyperliquid_account_snapshot",
  });
  let body;
  try {
    body = await parseBoundedJsonBody(request, { max_bytes: routeBudget("trade_account_snapshot").max_request_bytes });
  } catch (error) {
    const badType = error?.code === "unsupported_content_type";
    return terminalJson(context, {
      ok: false,
      schema_version: HYPERLIQUID_ACCOUNT_SNAPSHOT_SCHEMA,
      error: error?.code === "request_too_large"
        ? "account_snapshot_request_too_large"
        : badType
          ? "account_snapshot_unsupported_content_type"
          : "invalid_account_snapshot_json",
      public_account_observation_only: true,
      signing_available: false,
      submission_available: false,
    }, { status: error?.code === "request_too_large" ? 413 : badType ? 415 : 400 }, {
      resultCategory: "validation_failed",
      degradedReason: error?.code || "invalid_account_snapshot_json",
    });
  }

  const address = normalizeHyperliquidAddress(body?.address);
  if (!address) {
    return terminalJson(context, {
      ok: false,
      schema_version: HYPERLIQUID_ACCOUNT_SNAPSHOT_SCHEMA,
      error: "invalid_hyperliquid_address",
      public_account_observation_only: true,
      signing_available: false,
      submission_available: false,
    }, { status: 400, headers: { "cache-control": "no-store" } }, {
      resultCategory: "validation_failed",
      degradedReason: "invalid_hyperliquid_address",
    });
  }

  return withOperationBudget(async () => {
    try {
      const snapshot = await runProviderOperation({
        component: "hyperliquid_account_snapshot",
        operation_key: address,
        fn: () => hyperliquidAccountSnapshot(address),
      });
      return terminalJson(context, snapshot, { status: 200, headers: { "cache-control": "no-store" } }, {
        resultCategory: "ok",
        providerComponent: "hyperliquid_account_snapshot",
      });
    } catch {
      return terminalJson(context, {
        ok: false,
        schema_version: HYPERLIQUID_ACCOUNT_SNAPSHOT_SCHEMA,
        error: "account_snapshot_provider_error",
        public_account_observation_only: true,
        signing_available: false,
        submission_available: false,
      }, { status: 503, headers: { "cache-control": "no-store" } }, {
        resultCategory: "provider_error",
        degradedReason: "account_snapshot_provider_error",
        providerComponent: "hyperliquid_account_snapshot",
      });
    }
  }, {
    timeout_ms: routeBudget("trade_account_snapshot").timeout_ms,
    on_timeout: () => terminalJson(context, {
      ok: false,
      schema_version: HYPERLIQUID_ACCOUNT_SNAPSHOT_SCHEMA,
      error: "account_snapshot_timeout",
      public_account_observation_only: true,
      signing_available: false,
      submission_available: false,
    }, { status: 504, headers: { "cache-control": "no-store" } }, {
      resultCategory: "timeout",
      degradedReason: "account_snapshot_timeout",
      providerComponent: "hyperliquid_account_snapshot",
    }),
  });
}

async function handleTradeAccountHistory(request, env = {}) {
  const buildId = await terminalBuildId(env, request);
  const context = createTerminalRequestContext({
    request,
    route: "trade_account_history",
    buildId,
    schemaVersion: HYPERLIQUID_ACCOUNT_HISTORY_SCHEMA,
    clientOperationType: "public_account_order_history",
    providerComponent: "hyperliquid_account_history",
  });
  let body;
  try {
    body = await parseBoundedJsonBody(request, { max_bytes: routeBudget("trade_account_history").max_request_bytes });
  } catch (error) {
    const badType = error?.code === "unsupported_content_type";
    return terminalJson(context, {
      ok: false,
      schema_version: HYPERLIQUID_ACCOUNT_HISTORY_SCHEMA,
      error: error?.code === "request_too_large"
        ? "account_history_request_too_large"
        : badType
          ? "account_history_unsupported_content_type"
          : "invalid_account_history_json",
      public_account_observation_only: true,
      signing_available: false,
      submission_available: false,
    }, { status: error?.code === "request_too_large" ? 413 : badType ? 415 : 400 }, {
      resultCategory: "validation_failed",
      degradedReason: error?.code || "invalid_account_history_json",
    });
  }

  const address = normalizeHyperliquidAddress(body?.address);
  const kind = String(body?.kind || "orders").trim().toLowerCase();
  if (!address || kind !== "orders") {
    return terminalJson(context, {
      ok: false,
      schema_version: HYPERLIQUID_ACCOUNT_HISTORY_SCHEMA,
      error: address ? "account_history_kind_invalid" : "invalid_hyperliquid_address",
      public_account_observation_only: true,
      signing_available: false,
      submission_available: false,
    }, { status: 400, headers: { "cache-control": "no-store" } }, {
      resultCategory: "validation_failed",
      degradedReason: address ? "account_history_kind_invalid" : "invalid_hyperliquid_address",
    });
  }

  return withOperationBudget(async () => {
    try {
      const history = await runProviderOperation({
        component: "hyperliquid_account_history",
        operation_key: address,
        fn: () => hyperliquidAccountHistory(address),
      });
      return terminalJson(context, history, { status: 200, headers: { "cache-control": "no-store" } }, {
        resultCategory: "ok",
        providerComponent: "hyperliquid_account_history",
      });
    } catch {
      return terminalJson(context, {
        ok: false,
        schema_version: HYPERLIQUID_ACCOUNT_HISTORY_SCHEMA,
        error: "account_history_provider_error",
        public_account_observation_only: true,
        signing_available: false,
        submission_available: false,
      }, { status: 503, headers: { "cache-control": "no-store" } }, {
        resultCategory: "provider_error",
        degradedReason: "account_history_provider_error",
        providerComponent: "hyperliquid_account_history",
      });
    }
  }, {
    timeout_ms: routeBudget("trade_account_history").timeout_ms,
    on_timeout: () => terminalJson(context, {
      ok: false,
      schema_version: HYPERLIQUID_ACCOUNT_HISTORY_SCHEMA,
      error: "account_history_timeout",
      public_account_observation_only: true,
      signing_available: false,
      submission_available: false,
    }, { status: 504, headers: { "cache-control": "no-store" } }, {
      resultCategory: "timeout",
      degradedReason: "account_history_timeout",
      providerComponent: "hyperliquid_account_history",
    }),
  });
}

function orderPlanStatus(plan = {}) {
  if (plan.ok) return 200;
  if (new Set([
    "exact_instrument_identity_mismatch",
    "market_identity_mismatch",
    "side_invalid",
    "order_type_invalid",
    "notional_out_of_bounds",
    "leverage_invalid",
    "leverage_exceeds_market_maximum",
    "impact_limit_invalid",
    "limit_price_invalid",
    "trigger_price_invalid",
    "time_in_force_invalid",
    "take_profit_price_invalid",
    "stop_loss_price_invalid",
  ]).has(plan.unavailable_reason)) return 400;
  if (new Set([
    "post_only_would_cross",
    "ioc_not_marketable",
    "trigger_side_mismatch",
    "take_profit_side_mismatch",
    "stop_loss_side_mismatch",
    "price_impact_limit_exceeded",
  ]).has(plan.unavailable_reason)) return 409;
  if (new Set(["insufficient_depth_inside_limit", "insufficient_visible_depth"]).has(plan.unavailable_reason)) return 422;
  return 503;
}

async function handleTradeOrderPlan(request, env = {}) {
  const buildId = await terminalBuildId(env, request);
  const context = createTerminalRequestContext({
    request,
    route: "trade_order_plan",
    buildId,
    schemaVersion: HYPERLIQUID_ORDER_PLAN_SCHEMA,
    clientOperationType: "exact_market_order_plan",
    providerComponent: "hyperliquid_order_plan",
  });
  let body;
  try {
    body = await parseBoundedJsonBody(request, { max_bytes: routeBudget("trade_order_plan").max_request_bytes });
  } catch (error) {
    const badType = error?.code === "unsupported_content_type";
    return terminalJson(context, {
      ok: false,
      schema_version: HYPERLIQUID_ORDER_PLAN_SCHEMA,
      error: error?.code === "request_too_large"
        ? "order_plan_request_too_large"
        : badType
          ? "order_plan_unsupported_content_type"
          : "invalid_order_plan_json",
      order_plan_only: true,
      signing_available: false,
      submission_available: false,
    }, { status: error?.code === "request_too_large" ? 413 : badType ? 415 : 400 }, {
      resultCategory: "validation_failed",
      degradedReason: error?.code || "invalid_order_plan_json",
    });
  }

  const instrumentId = String(body?.instrument_id || "").trim();
  const match = instrumentId.match(/^hyperliquid:perp:([A-Z0-9][A-Z0-9._:-]{0,31})$/);
  if (!match) {
    const plan = createHyperliquidOrderPlan({ ...body, instrument_id: instrumentId });
    return terminalJson(context, plan, { status: 400, headers: { "cache-control": "no-store" } }, {
      resultCategory: "validation_failed",
      degradedReason: plan.unavailable_reason,
    });
  }

  return withOperationBudget(async () => {
    try {
      const instrument = await runProviderOperation({
        component: "hyperliquid_order_plan",
        operation_key: match[1],
        fn: () => hyperliquidInstrument(match[1]),
      });
      const plan = createHyperliquidOrderPlan({
        ...body,
        instrument_id: instrumentId,
        book: instrument?.book,
        market: instrument?.market,
      });
      const status = orderPlanStatus(plan);
      return terminalJson(context, plan, { status, headers: { "cache-control": "no-store" } }, {
        resultCategory: plan.ok ? "ok" : "unavailable",
        degradedReason: plan.ok ? null : plan.unavailable_reason,
        providerComponent: "hyperliquid_order_plan",
      });
    } catch {
      return terminalJson(context, {
        ok: false,
        schema_version: HYPERLIQUID_ORDER_PLAN_SCHEMA,
        state: "unavailable",
        unavailable_reason: "current_exact_book_unavailable",
        instrument: {
          instrument_id: instrumentId,
          exact_market_id: match[1],
          venue: "hyperliquid",
          identity_scope: "exact_instrument",
        },
        execution_boundary: {
          order_plan_only: true,
          prepared_order_available: false,
          signing_available: false,
          submission_available: false,
        },
      }, { status: 503, headers: { "cache-control": "no-store" } }, {
        resultCategory: "provider_error",
        degradedReason: "current_exact_book_unavailable",
        providerComponent: "hyperliquid_order_plan",
      });
    }
  }, {
    timeout_ms: routeBudget("trade_order_plan").timeout_ms,
    on_timeout: () => terminalJson(context, {
      ok: false,
      schema_version: HYPERLIQUID_ORDER_PLAN_SCHEMA,
      state: "unavailable",
      unavailable_reason: "order_plan_timeout",
      execution_boundary: {
        order_plan_only: true,
        prepared_order_available: false,
        signing_available: false,
        submission_available: false,
      },
    }, { status: 504, headers: { "cache-control": "no-store" } }, {
      resultCategory: "timeout",
      degradedReason: "order_plan_timeout",
      providerComponent: "hyperliquid_order_plan",
    }),
  });
}

function accountScenarioStatus(scenario = {}) {
  if (scenario.ok) return 200;
  if (new Set([
    "account_identity_mismatch",
    "margin_mode_invalid",
    "order_plan_semantics_invalid",
    "exact_instrument_identity_mismatch",
    "market_identity_mismatch",
    "side_invalid",
    "order_type_invalid",
    "notional_out_of_bounds",
    "leverage_invalid",
    "leverage_exceeds_market_maximum",
    "impact_limit_invalid",
    "limit_price_invalid",
    "trigger_price_invalid",
    "time_in_force_invalid",
    "take_profit_price_invalid",
    "stop_loss_price_invalid",
  ]).has(scenario.unavailable_reason)) return 400;
  if (new Set([
    "reduce_only_would_not_reduce_position",
    "post_only_would_cross",
    "ioc_not_marketable",
    "trigger_side_mismatch",
    "take_profit_side_mismatch",
    "stop_loss_side_mismatch",
    "price_impact_limit_exceeded",
  ]).has(scenario.unavailable_reason)) return 409;
  if (new Set(["insufficient_depth_inside_limit", "insufficient_visible_depth"]).has(scenario.unavailable_reason)) return 422;
  return 503;
}

async function handleTradeAccountScenario(request, env = {}) {
  const buildId = await terminalBuildId(env, request);
  const context = createTerminalRequestContext({
    request,
    route: "trade_account_scenario",
    buildId,
    schemaVersion: HYPERLIQUID_ACCOUNT_SCENARIO_SCHEMA,
    clientOperationType: "public_account_order_scenario",
    providerComponent: "hyperliquid_account_scenario",
  });
  let body;
  try {
    body = await parseBoundedJsonBody(request, { max_bytes: routeBudget("trade_account_scenario").max_request_bytes });
  } catch (error) {
    const badType = error?.code === "unsupported_content_type";
    return terminalJson(context, {
      ok: false,
      schema_version: HYPERLIQUID_ACCOUNT_SCENARIO_SCHEMA,
      error: error?.code === "request_too_large"
        ? "account_scenario_request_too_large"
        : badType
          ? "account_scenario_unsupported_content_type"
          : "invalid_account_scenario_json",
      account_scenario_only: true,
      signing_available: false,
      submission_available: false,
    }, { status: error?.code === "request_too_large" ? 413 : badType ? 415 : 400 }, {
      resultCategory: "validation_failed",
      degradedReason: error?.code || "invalid_account_scenario_json",
    });
  }

  const address = normalizeHyperliquidAddress(body?.address);
  const instrumentId = String(body?.instrument_id || "").trim();
  const match = instrumentId.match(/^hyperliquid:perp:([A-Z0-9][A-Z0-9._:-]{0,31})$/);
  if (!address || !match) {
    return terminalJson(context, {
      ok: false,
      schema_version: HYPERLIQUID_ACCOUNT_SCENARIO_SCHEMA,
      state: "unavailable",
      unavailable_reason: address ? "exact_instrument_identity_mismatch" : "account_identity_mismatch",
      execution_boundary: {
        account_scenario_only: true,
        prepared_order_available: false,
        wallet_confirmation_available: false,
        signing_available: false,
        submission_available: false,
      },
    }, { status: 400, headers: { "cache-control": "no-store" } }, {
      resultCategory: "validation_failed",
      degradedReason: address ? "exact_instrument_identity_mismatch" : "account_identity_mismatch",
    });
  }

  return withOperationBudget(async () => {
    try {
      const [instrument, snapshot, fees] = await runProviderOperation({
        component: "hyperliquid_account_scenario",
        operation_key: `${address}:${match[1]}`,
        fn: () => Promise.all([
          hyperliquidInstrument(match[1]),
          hyperliquidAccountSnapshot(address),
          hyperliquidUserFees(address),
        ]),
      });
      const plan = createHyperliquidOrderPlan({
        ...body,
        instrument_id: instrumentId,
        book: instrument?.book,
        market: instrument?.market,
      });
      const scenario = createHyperliquidAccountScenario({
        address,
        margin_mode: body?.margin_mode,
        reduce_only: body?.reduce_only === true,
        plan,
        snapshot,
        fees,
      });
      const status = accountScenarioStatus(scenario);
      return terminalJson(context, scenario, { status, headers: { "cache-control": "no-store" } }, {
        resultCategory: scenario.ok ? "ok" : "unavailable",
        degradedReason: scenario.ok ? null : scenario.unavailable_reason,
        providerComponent: "hyperliquid_account_scenario",
      });
    } catch {
      return terminalJson(context, {
        ok: false,
        schema_version: HYPERLIQUID_ACCOUNT_SCENARIO_SCHEMA,
        state: "unavailable",
        unavailable_reason: "account_scenario_provider_error",
        execution_boundary: {
          account_scenario_only: true,
          prepared_order_available: false,
          wallet_confirmation_available: false,
          signing_available: false,
          submission_available: false,
        },
      }, { status: 503, headers: { "cache-control": "no-store" } }, {
        resultCategory: "provider_error",
        degradedReason: "account_scenario_provider_error",
        providerComponent: "hyperliquid_account_scenario",
      });
    }
  }, {
    timeout_ms: routeBudget("trade_account_scenario").timeout_ms,
    on_timeout: () => terminalJson(context, {
      ok: false,
      schema_version: HYPERLIQUID_ACCOUNT_SCENARIO_SCHEMA,
      state: "unavailable",
      unavailable_reason: "account_scenario_timeout",
      execution_boundary: {
        account_scenario_only: true,
        prepared_order_available: false,
        wallet_confirmation_available: false,
        signing_available: false,
        submission_available: false,
      },
    }, { status: 504, headers: { "cache-control": "no-store" } }, {
      resultCategory: "timeout",
      degradedReason: "account_scenario_timeout",
      providerComponent: "hyperliquid_account_scenario",
    }),
  });
}

function quoteFeatureDisabled(flags) {
  return !flags.RAVENOS_CUSTOMER_TRADE_UI_ENABLE || !flags.RAVENOS_CUSTOMER_TRADE_QUOTE_ENABLE;
}

function marketPreviewStatus(preview = {}) {
  if (preview.ok) return 200;
  if (new Set([
    "exact_instrument_identity_mismatch",
    "market_identity_mismatch",
    "side_invalid",
    "notional_out_of_bounds",
    "leverage_invalid",
    "leverage_exceeds_market_maximum",
    "impact_limit_invalid",
  ]).has(preview.unavailable_reason)) return 400;
  if (preview.unavailable_reason === "price_impact_limit_exceeded") return 409;
  if (preview.unavailable_reason === "insufficient_visible_depth") return 422;
  return 503;
}

async function handleTradeMarketPreview(request, env = {}) {
  const buildId = await terminalBuildId(env, request);
  const context = createTerminalRequestContext({
    request,
    route: "trade_market_preview",
    buildId,
    schemaVersion: HYPERLIQUID_MARKET_PREVIEW_SCHEMA,
    clientOperationType: "market_fill_preview",
    providerComponent: "hyperliquid_market_preview",
  });
  let body;
  try {
    body = await parseBoundedJsonBody(request, { max_bytes: routeBudget("trade_market_preview").max_request_bytes });
  } catch (error) {
    const badType = error?.code === "unsupported_content_type";
    return terminalJson(context, {
      ok: false,
      error: error?.code === "request_too_large"
        ? "market_preview_request_too_large"
        : badType
          ? "market_preview_unsupported_content_type"
          : "invalid_market_preview_json",
      market_preview_only: true,
      signing_available: false,
      submission_available: false,
    }, { status: error?.code === "request_too_large" ? 413 : badType ? 415 : 400 }, {
      resultCategory: "validation_failed",
      degradedReason: error?.code || "invalid_market_preview_json",
    });
  }

  const instrumentId = String(body?.instrument_id || "").trim();
  const match = instrumentId.match(/^hyperliquid:perp:([A-Z0-9][A-Z0-9._:-]{0,31})$/);
  if (!match) {
    const preview = createHyperliquidMarketPreview({ ...body, instrument_id: instrumentId });
    return terminalJson(context, preview, { status: 400, headers: { "cache-control": "no-store" } }, {
      resultCategory: "validation_failed",
      degradedReason: preview.unavailable_reason,
    });
  }

  return withOperationBudget(async () => {
    try {
      const instrument = await runProviderOperation({
        component: "hyperliquid_market_preview",
        operation_key: match[1],
        fn: () => hyperliquidInstrument(match[1]),
      });
      if (!instrument?.ok || !instrument?.book || !instrument?.market) {
        return terminalJson(context, {
          ok: false,
          schema_version: HYPERLIQUID_MARKET_PREVIEW_SCHEMA,
          state: "unavailable",
          unavailable_reason: "current_exact_book_unavailable",
          instrument: {
            instrument_id: instrumentId,
            exact_market_id: match[1],
            venue: "hyperliquid",
            identity_scope: "exact_instrument",
          },
          execution_boundary: {
            market_preview_only: true,
            prepared_order_available: false,
            signing_available: false,
            submission_available: false,
            position_monitoring_available: false,
          },
        }, { status: 503, headers: { "cache-control": "no-store" } }, {
          resultCategory: "provider_error",
          degradedReason: "current_exact_book_unavailable",
          providerComponent: "hyperliquid_market_preview",
        });
      }
      const preview = createHyperliquidMarketPreview({
        ...body,
        instrument_id: instrumentId,
        book: instrument.book,
        market: instrument.market,
      });
      const status = marketPreviewStatus(preview);
      return terminalJson(context, preview, { status, headers: { "cache-control": "no-store" } }, {
        resultCategory: preview.ok ? "ok" : "unavailable",
        degradedReason: preview.ok ? null : preview.unavailable_reason,
        providerComponent: "hyperliquid_market_preview",
      });
    } catch {
      return terminalJson(context, {
        ok: false,
        schema_version: HYPERLIQUID_MARKET_PREVIEW_SCHEMA,
        state: "unavailable",
        unavailable_reason: "current_exact_book_unavailable",
        instrument: {
          instrument_id: instrumentId,
          exact_market_id: match[1],
          venue: "hyperliquid",
          identity_scope: "exact_instrument",
        },
        execution_boundary: {
          market_preview_only: true,
          prepared_order_available: false,
          signing_available: false,
          submission_available: false,
          position_monitoring_available: false,
        },
      }, { status: 503, headers: { "cache-control": "no-store" } }, {
        resultCategory: "provider_error",
        degradedReason: "current_exact_book_unavailable",
        providerComponent: "hyperliquid_market_preview",
      });
    }
  }, {
    timeout_ms: routeBudget("trade_market_preview").timeout_ms,
    on_timeout: () => terminalJson(context, {
      ok: false,
      schema_version: HYPERLIQUID_MARKET_PREVIEW_SCHEMA,
      state: "unavailable",
      unavailable_reason: "market_preview_timeout",
      execution_boundary: {
        market_preview_only: true,
        prepared_order_available: false,
        signing_available: false,
        submission_available: false,
        position_monitoring_available: false,
      },
    }, { status: 504, headers: { "cache-control": "no-store" } }, {
      resultCategory: "timeout",
      degradedReason: "market_preview_timeout",
      providerComponent: "hyperliquid_market_preview",
    }),
  });
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

function opportunitySurvivalState(row = {}) {
  if (String(row?.market_type || "").toLowerCase() !== "spot") {
    return { state: "active", reasons: [] };
  }
  const market = row.market && typeof row.market === "object" ? row.market : {};
  const reasons = [];
  const ageSeconds = optionalFiniteNumber(row.age_seconds);
  const price = optionalFiniteNumber(market.price_usd);
  const liquidity = optionalFiniteNumber(market.liquidity_usd);
  const marketCap = optionalFiniteNumber(market.market_cap_usd);
  const volume5m = optionalFiniteNumber(market.volume_usd_5m);
  const volume1h = optionalFiniteNumber(market.volume_usd_1h);
  const volume24h = optionalFiniteNumber(market.volume_usd_24h);
  const buys5m = optionalFiniteNumber(market.buys_5m);
  const sells5m = optionalFiniteNumber(market.sells_5m);
  const buys1h = optionalFiniteNumber(market.buys_1h);
  const sells1h = optionalFiniteNumber(market.sells_1h);
  const buys24h = optionalFiniteNumber(market.buys_24h);
  const sells24h = optionalFiniteNumber(market.sells_24h);
  const change1h = optionalFiniteNumber(market.price_change_1h_pct);
  const change24h = optionalFiniteNumber(market.price_change_24h_pct);
  const liquidityChanges = [
    market.liquidity_change_5m_pct,
    market.liquidity_change_1h_pct,
    market.liquidity_change_24h_pct,
  ].map(optionalFiniteNumber).filter((value) => value !== null);

  if (ageSeconds !== null && ageSeconds > CURRENT_OPPORTUNITY_MAX_AGE_SECONDS) reasons.push("market_state_expired");
  if (price !== null && price <= 0) reasons.push("price_collapsed");
  if (liquidity !== null && liquidity <= 0) reasons.push("liquidity_gone");
  if (marketCap !== null && marketCap < 1_000) reasons.push("market_cap_near_zero");
  if ((change1h !== null && change1h <= -85) || (change24h !== null && change24h <= -95)) reasons.push("price_collapse");
  if (liquidityChanges.some((value) => value <= -85)) reasons.push("liquidity_collapse");

  const shortVolumesKnown = volume5m !== null && volume1h !== null;
  const shortTransactionsKnown = [buys5m, sells5m, buys1h, sells1h].every((value) => value !== null);
  if (
    shortVolumesKnown
    && shortTransactionsKnown
    && volume5m <= 0
    && volume1h <= 0
    && buys5m + sells5m + buys1h + sells1h <= 0
  ) reasons.push("activity_gone");
  if (
    volume24h !== null
    && buys24h !== null
    && sells24h !== null
    && volume24h < 50
    && buys24h + sells24h <= 2
  ) reasons.push("market_dormant");
  if (liquidity !== null && liquidity < 250 && volume24h !== null && volume24h < 100) reasons.push("nonviable_market_depth");

  return reasons.length
    ? { state: "invalidated", reasons: [...new Set(reasons)] }
    : { state: "active", reasons: [] };
}

function applyOpportunitySurvivalGate(census = {}) {
  const reasonCounts = {};
  let evaluated = 0;
  let invalidated = 0;
  const gateRows = (rows = []) => rows.filter((row) => {
    const result = opportunitySurvivalState(row);
    evaluated += 1;
    if (result.state === "active") return true;
    invalidated += 1;
    result.reasons.forEach((reason) => { reasonCounts[reason] = Number(reasonCounts[reason] || 0) + 1; });
    return false;
  });
  const opportunities = census.opportunities || {};
  const spotAttention = census.spot_attention;
  const opportunityRows = gateRows(Array.isArray(opportunities.rows) ? opportunities.rows : []);
  const spotRows = spotAttention && Array.isArray(spotAttention.rows) ? gateRows(spotAttention.rows) : null;
  return {
    ...census,
    opportunities: { ...opportunities, rows: opportunityRows },
    ...(spotAttention ? {
      spot_attention: {
        ...spotAttention,
        rows: spotRows || [],
        row_count: spotRows?.length || 0,
      },
    } : {}),
    survival_gate: {
      schema_version: "ravenos.opportunity_survival_gate.v1",
      state: "enforced",
      evaluated,
      active: evaluated - invalidated,
      invalidated,
      reasons: reasonCounts,
      historical_context_substituted: false,
    },
  };
}

function opportunityObservationMs(row = {}) {
  for (const value of [row.decision_at, row.observed_at]) {
    const parsed = Date.parse(String(value || ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function recoverCurrentOpportunityLanes(census = {}, nowMs = Date.now()) {
  const maxFutureSkewMs = 300_000;
  const rowIsCurrent = (row) => {
    const observedMs = opportunityObservationMs(row);
    return Number.isFinite(observedMs)
      && observedMs <= nowMs + maxFutureSkewMs
      && nowMs - observedMs <= CURRENT_OPPORTUNITY_MAX_AGE_SECONDS * 1_000;
  };
  const perpRows = (Array.isArray(census?.opportunities?.rows) ? census.opportunities.rows : []).filter((row) => {
    const instrument = String(row?.instrument || "").toUpperCase();
    const instrumentId = String(row?.instrument_id || "").toLowerCase();
    const contextAge = optionalFiniteNumber(row?.context_age_seconds);
    return String(row?.market_type || "").toLowerCase() === "perpetual"
      && /^hyperliquid:perp:[a-z0-9._-]{1,24}$/.test(instrumentId)
      && /^[A-Z0-9._-]{1,24}-PERP$/.test(instrument)
      && ["fresh", "current", "delayed"].includes(String(row?.context_state || "").toLowerCase())
      && (contextAge === null || contextAge <= CURRENT_OPPORTUNITY_MAX_AGE_SECONDS)
      && row?.research_only === true
      && row?.actionable === false
      && row?.execution_available === false
      && rowIsCurrent(row);
  });

  const spot = census?.spot_attention;
  const spotBoundary = spot?.execution_boundary || {};
  const spotGeneratedMs = Date.parse(String(spot?.generated_at || ""));
  const spotContractCurrent = spot?.schema_version === "ravenos.token_attention.v1"
    && ["current", "delayed"].includes(String(spot?.state || "").toLowerCase())
    && Number.isFinite(spotGeneratedMs)
    && spotGeneratedMs <= nowMs + maxFutureSkewMs
    && nowMs - spotGeneratedMs <= CURRENT_OPPORTUNITY_MAX_AGE_SECONDS * 1_000
    && spotBoundary.research_only === true
    && spotBoundary.actionable === false
    && spotBoundary.signing_available === false
    && spotBoundary.submission_available === false
    && Number(spotBoundary.capital_assigned || 0) === 0;
  const spotRows = (spotContractCurrent && Array.isArray(spot?.rows) ? spot.rows : []).filter((row) => (
    row?.market_type === "spot"
    && row?.chain === "Solana"
    && ["exact_token", "exact_pool"].includes(row?.identity_scope)
    && typeof row?.token_address === "string"
    && row.token_address.length > 0
    && row?.research_only === true
    && row?.actionable === false
    && row?.execution_available === false
    && rowIsCurrent(row)
  ));
  if (!perpRows.length && !spotRows.length) return null;

  const rowTimes = [...perpRows, ...spotRows]
    .map(opportunityObservationMs)
    .filter(Number.isFinite);
  if (spotRows.length) rowTimes.push(spotGeneratedMs);
  const generatedMs = Math.max(...rowTimes);
  const rowStates = [
    ...perpRows.map((row) => String(row.context_state || "").toLowerCase()),
    ...(spotRows.length ? [String(spot.state || "").toLowerCase()] : []),
  ];
  const sourceState = rowStates.every((state) => ["fresh", "current"].includes(state)) ? "current" : "delayed";
  return {
    schema_version: CURRENT_OPPORTUNITY_DATA_SCHEMA,
    generated_at: new Date(generatedMs).toISOString(),
    source_state: sourceState,
    source_age_seconds: Math.max(0, Math.floor((nowMs - generatedMs) / 1_000)),
    contract: census.contract,
    opportunities: {
      ...census.opportunities,
      rows: perpRows,
    },
    ...(spotRows.length ? {
      spot_attention: {
        ...spot,
        rows: spotRows,
        row_count: spotRows.length,
      },
    } : {}),
    execution_boundary: census.execution_boundary,
    public_safety: census.public_safety,
    lane_freshness: {
      schema_version: "ravenos.opportunity_lane_freshness.v1",
      state: sourceState,
      current_rows_only: true,
      stale_aggregate_counts_included: false,
      historical_context_substituted: false,
    },
  };
}

function validateCurrentOpportunityProjection(result, nowMs = Date.now()) {
  const payload = result?.payload;
  const delivery = result?.delivery;
  if (!result?.available || !payload?.data) {
    return { ok: false, reason: delivery?.reason || "current_opportunity_unavailable" };
  }
  if (delivery?.source !== "current_public_origin" || delivery?.fallback === true) {
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
  const census = payload.data;
  if (
    census.schema_version !== CURRENT_OPPORTUNITY_DATA_SCHEMA
    || !census.opportunities
    || !Array.isArray(census.opportunities.rows)
  ) {
    return { ok: false, reason: "current_opportunity_schema_rejected" };
  }
  const fullyCurrent = delivery?.freshness_state === "fresh"
    && freshnessTargetSeconds === CURRENT_OPPORTUNITY_MAX_AGE_SECONDS
    && Number.isFinite(generatedMs)
    && generatedMs <= nowMs + 300_000
    && nowMs - generatedMs <= CURRENT_OPPORTUNITY_MAX_AGE_SECONDS * 1_000
    && census.source_state === "current"
    && String(census.generated_at || "") === generatedAt;
  if (fullyCurrent) return { ok: true, payload, census, delivery, projection_scope: "full_current_census" };

  const recoveredCensus = recoverCurrentOpportunityLanes(census, nowMs);
  if (!recoveredCensus) return { ok: false, reason: "current_opportunity_freshness_rejected" };
  const recoveredGeneratedMs = Date.parse(recoveredCensus.generated_at);
  const recoveredDelivery = {
    ...delivery,
    source: "current_public_origin",
    source_generated_at: recoveredCensus.generated_at,
    age_seconds: Math.max(0, Math.floor((nowMs - recoveredGeneratedMs) / 1_000)),
    freshness_target_seconds: CURRENT_OPPORTUNITY_MAX_AGE_SECONDS,
    freshness_state: "fresh",
    fallback: false,
    reason: null,
    projection_scope: "current_rows_only",
    aggregate_freshness_state: delivery?.freshness_state || "unavailable",
  };
  return {
    ok: true,
    payload: { ...payload, generated_at: recoveredCensus.generated_at, data: recoveredCensus },
    census: recoveredCensus,
    delivery: recoveredDelivery,
    projection_scope: "current_rows_only",
  };
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
  const delivery = currentProjection.ok ? currentProjection.delivery : opportunitiesResult.delivery;
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
  const survivingCensus = applyOpportunitySurvivalGate(currentProjection.census);
  const rows = survivingCensus.opportunities.rows;
  const requested = requestedOpportunityIdentity(request);
  const selected = selectOpportunityRow(rows, requested);
  const current = ((claimsPayload?.data || {}).current_claims || []).find((row) => row.surface === "opportunity") || null;
  const participationPayoff = buildParticipationPayoffProjection(
    outcomesPayload?.data || {},
    behaviorPayload?.data || {},
  );
  return json({
    ok: true,
    schema_version: "ravenos.opportunity_workspace.v2",
    generated_at: currentProjection.payload.generated_at,
    source_updated_at: currentProjection.payload.updated_at || null,
    source_artifact: currentProjection.payload.source_artifact,
    projection_scope: currentProjection.projection_scope,
    evidence_contract_version: "1.0",
    claim_lineage_version: (claimsPayload?.data || {}).lineage_version || null,
    census: survivingCensus,
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
    participation_payoff: participationPayoff,
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
        instrumentId: url.searchParams.get("instrument_id") || "",
        before: url.searchParams.get("before"),
        limit: url.searchParams.get("limit"),
      });
      const usage = payload.provider_usage || {
        schema_version: "ravenos.provider_usage.v1",
        provider: payload.candle_series?.provider || payload.source_type || "unavailable",
        pool: payload.candle_series?.provider_market_id || payload.market_identity || "unavailable",
        interval: payload.timeframe || url.searchParams.get("timeframe") || "1h",
        source_interval: payload.candle_series?.source_interval || payload.timeframe || "1h",
        cache_hit: Boolean(payload.from_cache),
        candle_mode: payload.candle_series?.derivation?.state || "direct",
        provider_request_count: payload.ok ? 1 : 0,
        fallback_event: Boolean(payload.provider_selection?.fallback),
        active_viewer_signal: 1,
        projected_cost_state: payload.ok ? "provider_contract_not_metered_here" : "unavailable",
      };
      recordCandleProviderUsage(usage, {
        emit_structured_log: String(env.RAVENOS_RELEASE_ENFORCE || "") === "1",
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
  const identityResponse = await routeCustomerIdentity(request, env);
  if (identityResponse) return identityResponse;
  const researchStateResponse = await routeCustomerResearchState(request, env, {
    resolveMarketAvailability: (market) => resolveSavedMarketAvailability(env, market),
  });
  if (researchStateResponse) return researchStateResponse;
  const portfolioPreviewResponse = await routePortfolioGovernorPreview(request, env);
  if (portfolioPreviewResponse) return portfolioPreviewResponse;
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
  if (url.pathname === "/api/atlas" && request.method === "GET") return handleAtlas(request, env);
  if (ATLAS_API_ENDPOINTS[url.pathname] && request.method === "GET") return handleAtlasUniverse(request, env, ATLAS_API_ENDPOINTS[url.pathname]);
  if (url.pathname === "/api/instruments/search" && request.method === "GET") return handleInstrumentSearch(request, env);
  if (url.pathname === "/api/terminal" && request.method === "GET") return handleTerminal(request, env);
  if (url.pathname === "/api/terminal/chart" && request.method === "GET") return handleTerminalChart(request, env);
  if (url.pathname.startsWith("/api/chains/") && request.method === "GET") return handleChain(request, env, decodeURIComponent(url.pathname.split("/").pop() || ""));
  if (url.pathname === "/api/trade/flags" && request.method === "GET") return handleTradeFlags(env);
  if (url.pathname === "/api/trade/market-preview" && request.method === "POST") return handleTradeMarketPreview(request, env);
  if (url.pathname === "/api/trade/order-plan" && request.method === "POST") return handleTradeOrderPlan(request, env);
  if (url.pathname === "/api/trade/account-snapshot" && request.method === "POST") return handleTradeAccountSnapshot(request, env);
  if (url.pathname === "/api/trade/account-scenario" && request.method === "POST") return handleTradeAccountScenario(request, env);
  if (url.pathname === "/api/trade/account-history" && request.method === "POST") return handleTradeAccountHistory(request, env);
  if (url.pathname === "/api/trade/quote" && request.method === "POST") return handleTradeQuote(request, env);
  if (url.pathname === "/api/trade/inspect" && request.method === "POST") return handleTradeInspect(request, env);
  if (url.pathname === "/api/trade/review" && (request.method === "POST" || request.method === "GET")) return handleTradeReview(request, env);
  if (url.pathname === "/api/access" && (request.method === "GET" || request.method === "POST")) {
    return customerFoundationUnavailable("legacy_customer_access_quarantined");
  }
  if (url.pathname === "/api/stripe/checkout" && request.method === "POST") {
    return customerFoundationUnavailable("legacy_billing_quarantined");
  }
  if (url.pathname === "/api/stripe/portal" && request.method === "POST") {
    return customerFoundationUnavailable("legacy_billing_quarantined");
  }
  if (url.pathname === "/api/stripe/webhook" && request.method === "POST") {
    return customerFoundationUnavailable("legacy_billing_quarantined");
  }
  if (url.pathname === "/api/dexscreener/search" && request.method === "GET") {
    try {
      const results = (await resolveDexInput(url.searchParams.get("q") || ""))
        .slice(0, 30)
        .map((row) => ({ ...row, chart_coverage: onchainSearchChartCoverage(row, env) }));
      return json({
        ok: true,
        schema_version: "ravenos.onchain_market_search.v1",
        providers: ["DexScreener", "DexPaprika"],
        attribution: { label: "Powered by DexPaprika", url: "https://dexpaprika.com/" },
        results,
      });
    } catch (error) {
      return json({ ok: false, error: "onchain_market_search_unavailable", results: [] }, { status: 502 });
    }
  }
  if (url.pathname === "/api/onchain/trending" && request.method === "GET") {
    const chains = parseOnchainPulseChains(url.searchParams.get("chains") || "");
    const duration = String(url.searchParams.get("duration") || "5m").trim().toLowerCase();
    if (!chains || !ONCHAIN_PULSE_DURATIONS[duration]) {
      return json({
        ok: false,
        error: "onchain_market_pulse_request_invalid",
        allowed_chains: Object.keys(ONCHAIN_PULSE_NETWORKS),
        allowed_durations: Object.keys(ONCHAIN_PULSE_DURATIONS),
      }, { status: 400 });
    }
    try {
      return json(await onchainMarketPulse({ env, chains, duration }), {
        headers: {
          "cache-control": "public, max-age=15, s-maxage=30, stale-while-revalidate=60",
        },
      });
    } catch {
      return json({
        ok: false,
        safe_public: true,
        schema_version: "ravenos.onchain_market_pulse.v1",
        state: "unavailable",
        error: "onchain_market_pulse_unavailable",
        rows: [],
        execution_boundary: {
          research_only: true,
          signing_available: false,
          submission_available: false,
        },
      }, { status: 502 });
    }
  }
  if (url.pathname === "/api/onchain/token-metadata" && request.method === "GET") {
    const chain = String(url.searchParams.get("chain") || "").trim().toLowerCase();
    if (chain !== "solana") {
      return json({ ok: false, error: "token_metadata_chain_unsupported", results: [] }, { status: 400 });
    }
    const addresses = boundedSolanaTokenAddresses(url.searchParams.get("addresses") || "");
    if (!addresses.length) {
      return json({ ok: false, error: "token_metadata_addresses_required", results: [] }, { status: 400 });
    }
    try {
      return json({
        ok: true,
        schema_version: "ravenos.onchain_token_metadata.v1",
        chain,
        generated_at: new Date().toISOString(),
        results: await solanaTokenMetadata(addresses),
      }, { headers: { "cache-control": "public, max-age=30, s-maxage=300, stale-while-revalidate=900" } });
    } catch {
      return json({
        ok: false,
        error: "token_metadata_unavailable",
        results: [],
      }, { status: 502 });
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
    const releaseState = await resolveReleaseState(env || {}, request, {
      force: url.pathname === "/api/build",
    });
    if (url.pathname === "/api/build" && request.method === "GET") {
      return attachReleaseHeaders(applyAssetSecurityHeaders(handleBuildIdentity(releaseState), url.pathname), releaseState, url.pathname);
    }
    if (releaseState.cohesion.enforced && !releaseState.cohesion.ok) {
      return attachReleaseHeaders(applyAssetSecurityHeaders(releaseUnavailable(releaseState), url.pathname), releaseState, url.pathname);
    }
    const authenticatedBoundary = authenticatedAppBoundary(request);
    if (authenticatedBoundary && !authenticatedBoundary.allowed) {
      return attachReleaseHeaders(applyAssetSecurityHeaders(authenticatedBoundary.response, url.pathname), releaseState, url.pathname);
    }
    if (url.pathname.startsWith("/api/")) {
      const response = await routeApi(request, env || {});
      return attachReleaseHeaders(applyAssetSecurityHeaders(response, url.pathname), releaseState, url.pathname);
    }
    if (["GET", "HEAD"].includes(request.method)) {
      if (url.hostname.toLowerCase() === "ravenos.xyz" && (url.pathname === "/monitor" || url.pathname === "/monitor/" || url.pathname === "/monitor/index.html")) {
        const target = savedMonitorRedirectTarget(url);
        return attachReleaseHeaders(
          applyAssetSecurityHeaders(Response.redirect(target, 308), url.pathname),
          releaseState,
          url.pathname,
        );
      }
      if (url.pathname === "/brief" || url.pathname === "/brief/") {
        const target = new URL("/terminal/", url);
        target.search = url.search;
        return attachReleaseHeaders(
          applyAssetSecurityHeaders(Response.redirect(target, 308), url.pathname),
          releaseState,
          url.pathname,
        );
      }
      const legacyRedirects = {
        "/pro": "/pricing/",
        "/pro/": "/pricing/",
        "/upgrade": "/pricing/",
        "/upgrade/": "/pricing/",
        "/token": "/terminal/",
        "/token/": "/terminal/",
      };
      const target = legacyRedirects[url.pathname];
      if (target) {
        return attachReleaseHeaders(
          applyAssetSecurityHeaders(Response.redirect(new URL(target, url), 308), url.pathname),
          releaseState,
          url.pathname,
        );
      }
    }
    const assetResponse = await env.ASSETS.fetch(request);
    return attachReleaseHeaders(applyAssetSecurityHeaders(assetResponse, url.pathname), releaseState, url.pathname);
  },
};
