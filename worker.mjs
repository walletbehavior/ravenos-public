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
  ALERT_TYPES,
  createAlert,
  deleteAlert,
  listAlertEvents,
  listAlerts,
  updateAlert,
} from "./lib/ravenos_alerts.mjs";
import {
  addWatchlistItem,
  createWatchlist,
  deleteWatchlist,
  deleteWatchlistItem,
  listWatchlists,
  updateWatchlist,
  watchlistLimits,
} from "./lib/ravenos_watchlists.mjs";

const dexCache = new Map();
const hyperliquidCache = new Map();
const priceCache = new Map();
const DEXSCREENER_BASE_URL = "https://api.dexscreener.com";
const COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3";
const HYPERLIQUID_INFO_URL = "https://api.hyperliquid.xyz/info";
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const EVM_CHAINS = ["base", "ethereum", "arbitrum", "optimism", "bsc", "polygon"];
const QUOTE_RANK = { USDC: 90, USDT: 85, SOL: 80, WETH: 80, ETH: 75, WSOL: 75 };
const CANONICAL_PRICE_TOKENS = {
  AAVE: { chainId: "ethereum", tokenAddress: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9" },
  AERO: { chainId: "base", tokenAddress: "0x940181a94A35A4569E4529A3CDfB74e38FD98631" },
  AIXBT: { chainId: "base", tokenAddress: "0x4f9fd6be4a90f2620860d680c0d4d5fb53d1a825" },
  ARB: { chainId: "arbitrum", tokenAddress: "0x912CE59144191C1204E64559FE8253a0e49E6548" },
  BONK: { chainId: "solana", tokenAddress: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
  BRETT: { chainId: "base", tokenAddress: "0x532f27101965dd16442E59d40670FaF5eBB142E4" },
  DEGEN: { chainId: "base", tokenAddress: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed" },
  SOL: { chainId: "solana", tokenAddress: "So11111111111111111111111111111111111111112" },
  ETH: { chainId: "ethereum", tokenAddress: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" },
  WETH: { chainId: "ethereum", tokenAddress: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" },
  BTC: { chainId: "ethereum", tokenAddress: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" },
  WBTC: { chainId: "ethereum", tokenAddress: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" },
  JUP: { chainId: "solana", tokenAddress: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" },
  LINK: { chainId: "ethereum", tokenAddress: "0x514910771AF9Ca656af840dff83E8264EcF986CA" },
  MORPHO: { chainId: "ethereum", tokenAddress: "0x58D97B57BB95320F9a05dC918Aef65434969c2B2" },
  PEPE: { chainId: "ethereum", tokenAddress: "0x6982508145454Ce325dDbE47a25d4ec3d2311933" },
  PENDLE: { chainId: "arbitrum", tokenAddress: "0x0c880f6761F1af8d9Aa9C466984b80DAb9a8c9e8" },
  TOSHI: { chainId: "base", tokenAddress: "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4" },
  VIRTUAL: { chainId: "base", tokenAddress: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b" },
  WELL: { chainId: "base", tokenAddress: "0xA88594D404727625A9437C3f886C7643872296AE" },
  WIF: { chainId: "solana", tokenAddress: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
  ZORA: { chainId: "base", tokenAddress: "0x1111111111166b7FE7bd91427724B487980aFc69" },
};
const COINGECKO_PRICE_IDS = {
  AAVE: "aave",
  ADA: "cardano",
  AERO: "aerodrome-finance",
  AIXBT: "aixbt",
  ARB: "arbitrum",
  BNB: "binancecoin",
  BONK: "bonk",
  BRETT: "based-brett",
  BTC: "bitcoin",
  DEGEN: "degen-base",
  DOGE: "dogecoin",
  ENA: "ethena",
  ETH: "ethereum",
  FET: "artificial-superintelligence-alliance",
  HYPE: "hyperliquid",
  JUP: "jupiter-exchange-solana",
  KAITO: "kaito",
  LDO: "lido-dao",
  LINK: "chainlink",
  MORPHO: "morpho",
  ONDO: "ondo-finance",
  PENDLE: "pendle",
  PEPE: "pepe",
  PYTH: "pyth-network",
  SEI: "sei-network",
  SOL: "solana",
  SUI: "sui",
  TIA: "celestia",
  TOSHI: "toshi",
  UNI: "uniswap",
  VIRTUAL: "virtual-protocol",
  WELL: "moonwell",
  WIF: "dogwifcoin",
  XRP: "ripple",
  ZORA: "zora",
};
const MARKET_PREVIEW_SYMBOLS = new Set([
  "AAPL", "NVDA", "TSLA", "META", "MSFT", "AMZN", "GOOGL", "AMD", "AVGO", "BRK.B",
  "JPM", "LLY", "V", "MA", "UNH", "XOM", "ORCL", "NFLX", "COIN", "MSTR",
  "SPY", "QQQ", "IWM", "DIA", "VOO", "SMH", "XLF", "XLK", "XLE", "TLT", "GLD",
  "EEM", "EFA",
]);

const PUBLIC_API_ENDPOINTS = {
  terminal: {
    endpoint: "/api/terminal",
    artifactPath: "/ravenos_participant_heatmap.json",
    freshnessTargetSeconds: 60,
    cacheControl: "public, max-age=15, stale-while-revalidate=60",
    schemaVersion: "ravenos_terminal_public_v1",
    liveProvider: "hyperliquid_public",
  },
  opportunity: {
    endpoint: "/api/opportunity",
    artifactPath: "/ravenos_participant_heatmap.json",
    freshnessTargetSeconds: 120,
    cacheControl: "public, max-age=60, stale-while-revalidate=120",
    schemaVersion: "ravenos_opportunity_public_v1",
    liveProvider: "dexscreener_public",
  },
  brief: {
    endpoint: "/api/brief",
    artifactPath: "/public/data/ravenos_summary.json",
    originPath: "/public/ravenos/brief.json",
    freshnessTargetSeconds: 900,
    cacheControl: "public, max-age=300, stale-while-revalidate=900",
    schemaVersion: "ravenos_brief_public_v1",
  },
  replay: {
    endpoint: "/api/replay",
    artifactPath: "/ravenos_historical_replay.json",
    originPath: "/public/ravenos/replay.json",
    freshnessTargetSeconds: 3600,
    cacheControl: "public, max-age=900, stale-while-revalidate=3600",
    schemaVersion: "ravenos_replay_public_v1",
  },
  outcomes: {
    endpoint: "/api/outcomes",
    artifactPath: "/ravenos_participant_outcomes.json",
    originPath: "/public/ravenos/outcomes.json",
    freshnessTargetSeconds: 3600,
    cacheControl: "public, max-age=60, stale-while-revalidate=300",
    schemaVersion: "ravenos_outcomes_public_v1",
  },
  memory: {
    endpoint: "/api/memory",
    artifactPath: "/ravenos_recent_memory.json",
    originPath: "/public/ravenos/memory.json",
    freshnessTargetSeconds: 3600,
    cacheControl: "public, max-age=900, stale-while-revalidate=3600",
    schemaVersion: "ravenos_memory_public_v1",
  },
  behavior: {
    endpoint: "/api/behavior",
    artifactPath: "/ravenos_participant_heatmap.json",
    originPath: "/public/ravenos/behavior.json",
    freshnessTargetSeconds: 900,
    cacheControl: "public, max-age=60, stale-while-revalidate=300",
    schemaVersion: "ravenos_behavior_public_v1",
  },
  research: {
    endpoint: "/api/research",
    artifactPath: "/ravenos_participant_outcomes.json",
    freshnessTargetSeconds: 900,
    cacheControl: "public, max-age=60, stale-while-revalidate=300",
    schemaVersion: "ravenos_research_public_v1",
    derivedFrom: ["outcomes", "replay", "memory", "behavior"],
  },
  "chains/solana": {
    endpoint: "/api/chains/solana",
    artifactPath: "/ravenos_participant_heatmap.json",
    freshnessTargetSeconds: 120,
    cacheControl: "public, max-age=120, stale-while-revalidate=300",
    schemaVersion: "ravenos_chain_public_v1",
    chain: "solana",
    liveProvider: "dexscreener_public",
  },
  "chains/base": {
    endpoint: "/api/chains/base",
    artifactPath: "/ravenos_participant_heatmap.json",
    freshnessTargetSeconds: 120,
    cacheControl: "public, max-age=120, stale-while-revalidate=300",
    schemaVersion: "ravenos_chain_public_v1",
    chain: "base",
    liveProvider: "dexscreener_public",
  },
  "chains/ethereum": {
    endpoint: "/api/chains/ethereum",
    artifactPath: "/ravenos_participant_heatmap.json",
    freshnessTargetSeconds: 120,
    cacheControl: "public, max-age=120, stale-while-revalidate=300",
    schemaVersion: "ravenos_chain_public_v1",
    chain: "eth",
    liveProvider: "dexscreener_public",
  },
};

const PUBLIC_FORBIDDEN_PATTERNS = [
  /WalletMemory/i,
  /ShadowMirror/i,
  /canary/i,
  /live execution/i,
  /private wallet/i,
  /private token target/i,
  /raw trade intent/i,
  /Turnkey/i,
  /signer/i,
  /treasury/i,
];

const PUBLIC_WALLET_LIKE_PATTERNS = [
  /\b0x[a-fA-F0-9]{40}\b/,
  /\b[1-9A-HJ-NP-Za-km-z]{42,44}\b/,
];

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

function publicJson(payload, endpointConfig, init = {}) {
  return json(payload, {
    status: init.status || 200,
    headers: {
      "cache-control": endpointConfig?.cacheControl || "public, max-age=60, stale-while-revalidate=120",
      "x-ravenos-public-api": "true",
      ...(init.headers || {}),
    },
  });
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
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
    coverage: "Developing",
    isLive: false,
    isCached: false,
    isSample: false,
    lastUpdated: new Date().toISOString(),
    warning: "Coverage developing",
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

function capBandForDex(row = {}) {
  const cap = num(row.marketCap) || num(row.fdv);
  if (cap > 0 && cap < 100_000) return "nano_caps";
  if (cap >= 100_000 && cap < 1_000_000) return "micro_caps";
  if (cap >= 1_000_000 && cap < 10_000_000) return "small_caps";
  if (cap >= 10_000_000 && cap < 100_000_000) return "mid_caps";
  if (cap >= 100_000_000) return "large_caps";
  return "";
}

function chainMatchesCategory(row = {}, category = "") {
  const chain = String(row.chainId || "").toLowerCase();
  if (category === "solana") return chain === "solana";
  if (category === "base") return chain === "base";
  if (category === "ethereum") return chain === "ethereum";
  return true;
}

function categoryMatchesDexRow(row = {}, category = "") {
  if (["nano_caps", "micro_caps", "small_caps", "mid_caps", "large_caps"].includes(category)) return capBandForDex(row) === category;
  if (["solana", "base", "ethereum"].includes(category)) return chainMatchesCategory(row, category);
  if (category === "memes") return /meme|dog|pepe|inu|cat|frog|bonk|wif|toshi|brett/i.test(`${row.symbol || ""} ${row.name || ""}`);
  return true;
}

async function trendingDex(category = "market_cap_heatmap", { limit = 50 } = {}) {
  const normalizedCategory = String(category || "market_cap_heatmap").toLowerCase();
  const wantedChains = normalizedCategory === "solana" ? new Set(["solana"])
    : normalizedCategory === "base" ? new Set(["base"])
      : normalizedCategory === "ethereum" ? new Set(["ethereum"])
        : new Set(["solana", "base", "ethereum", "bsc"]);
  const [boosts, profiles] = await Promise.all([
    cachedDex("/token-boosts/top/v1").catch(() => []),
    cachedDex("/token-profiles/latest/v1").catch(() => []),
  ]);
  const seeds = [...(Array.isArray(boosts) ? boosts : []), ...(Array.isArray(profiles) ? profiles : [])]
    .filter((item) => item?.chainId && item?.tokenAddress && wantedChains.has(String(item.chainId).toLowerCase()));
  const seen = new Set();
  const uniqueSeeds = seeds.filter((item) => {
    const key = `${item.chainId}:${item.tokenAddress}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 40);
  const settled = await Promise.allSettled(uniqueSeeds.map((item) => tokenDex(item.chainId, item.tokenAddress)));
  const rows = settled
    .flatMap((item) => item.status === "fulfilled" ? item.value.slice(0, 1) : [])
    .filter((row) => categoryMatchesDexRow(row, normalizedCategory));
  return rows
    .sort((a, b) => (num(b.volume24h) - num(a.volume24h)) || (num(b.txns24h) - num(a.txns24h)) || (num(b.liquidityUsd) - num(a.liquidityUsd)))
    .slice(0, Math.max(1, Math.min(100, Number(limit) || 50)));
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

function hyperliquidInterval(timeframe = "1h") {
  const value = String(timeframe || "1h").toLowerCase();
  return ["15m", "1h", "4h", "1d"].includes(value) ? value : "1h";
}

async function hyperliquidCandles(symbol = "", timeframe = "1h") {
  const coin = normalizedMarketSymbol(symbol);
  if (!coin || !/^[A-Z0-9]+$/.test(coin)) throw new Error("invalid_symbol");
  const interval = hyperliquidInterval(timeframe);
  const intervalMs = { "15m": 15 * 60_000, "1h": 60 * 60_000, "4h": 4 * 60 * 60_000, "1d": 24 * 60 * 60_000 }[interval];
  const count = { "15m": 96, "1h": 96, "4h": 90, "1d": 120 }[interval];
  const endTime = Date.now();
  const startTime = endTime - intervalMs * count;
  const key = `candles:${coin}:${interval}:${Math.floor(endTime / 30_000)}`;
  const hit = hyperliquidCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.payload;
  const response = await fetch(HYPERLIQUID_INFO_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      type: "candleSnapshot",
      req: { coin, interval, startTime, endTime },
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`hyperliquid_candles_http_${response.status}`);
  const candles = (Array.isArray(payload) ? payload : [])
    .map((row) => ({
      time: Math.floor(num(row.t || row.T || row.time) / 1000),
      open: num(row.o || row.open),
      high: num(row.h || row.high),
      low: num(row.l || row.low),
      close: num(row.c || row.close),
      volume: num(row.v || row.volume),
    }))
    .filter((row) => row.time && row.open > 0 && row.high > 0 && row.low > 0 && row.close > 0)
    .sort((a, b) => a.time - b.time);
  const result = {
    ok: true,
    provider: "Hyperliquid",
    coverage: "Live",
    isLive: true,
    symbol: coin,
    timeframe: interval,
    generated_at: new Date().toISOString(),
    count: candles.length,
    candles,
  };
  hyperliquidCache.set(key, { payload: result, expires: Date.now() + 30_000 });
  return result;
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

async function coingeckoPrices(symbols = []) {
  const wanted = [...new Set(symbols.map(normalizedMarketSymbol).filter((symbol) => COINGECKO_PRICE_IDS[symbol]))];
  if (!wanted.length) return new Map();
  const ids = [...new Set(wanted.map((symbol) => COINGECKO_PRICE_IDS[symbol]))];
  const cacheKey = `coingecko:${ids.sort().join(",")}`;
  const now = Date.now();
  const hit = priceCache.get(cacheKey);
  if (hit && hit.expires > now) return hit.payload;
  const encodedIds = ids.map((id) => encodeURIComponent(id)).join(",");
  const response = await fetch(`${COINGECKO_BASE_URL}/simple/price?ids=${encodedIds}&vs_currencies=usd`, {
    headers: { accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`coingecko_http_${response.status}`);
  const rows = new Map();
  wanted.forEach((symbol) => {
    const id = COINGECKO_PRICE_IDS[symbol];
    const price = num(payload[id]?.usd);
    if (price > 0) rows.set(symbol, {
      symbol,
      priceUsd: price,
      provider: "CoinGecko",
      coverage: "Developing",
      isLive: false,
      isCached: false,
      isSample: false,
      lastUpdated: new Date().toISOString(),
      warning: "Coverage developing",
    });
  });
  priceCache.set(cacheKey, { payload: rows, expires: now + 30_000 });
  if (priceCache.size > 100) priceCache.delete(priceCache.keys().next().value);
  return rows;
}

function normalizedMarketSymbol(value = "") {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\/.*$/, "")
    .replace(/\s+SPOT$/, "")
    .replace(/-PERP$/, "");
}

function preferredDexPriceResult(symbol, results = []) {
  const base = normalizedMarketSymbol(symbol);
  const exact = results.filter((row) => normalizedMarketSymbol(row.symbol) === base);
  const pool = exact.length ? exact : results;
  return [...pool].sort((a, b) => {
    const quoteScore = (quote) => ({ USDC: 8, USDT: 7, USD1: 6, WETH: 5, SOL: 5, WBNB: 4, WBTC: 3, ETH: 3, WSOL: 3 }[String(quote || "").toUpperCase()] || 0);
    return (quoteScore(b.quoteSymbol) - quoteScore(a.quoteSymbol))
      || (num(b.liquidityUsd) - num(a.liquidityUsd))
      || (num(b.volume24h) - num(a.volume24h));
  })[0] || null;
}

async function marketPrices(symbols = [], { market = "mixed" } = {}) {
  const wanted = [...new Set(symbols.map(normalizedMarketSymbol).filter(Boolean))].slice(0, 80);
  const marketKind = String(market || "mixed").toLowerCase();
  if (["equity", "equities", "etf", "etfs", "market_preview"].includes(marketKind)) {
    return wanted
      .filter((symbol) => MARKET_PREVIEW_SYMBOLS.has(symbol) || /^[A-Z][A-Z.]{0,5}$/.test(symbol))
      .map((symbol) => ({
        symbol,
        priceUsd: null,
        provider: "Market provider",
        coverage: "Developing",
        isLive: false,
        isCached: false,
        isSample: false,
        lastUpdated: new Date().toISOString(),
        warning: "Coverage developing",
      }));
  }
  const usePerps = marketKind !== "spot";
  const useSpotCatalog = marketKind === "spot";
  const perps = usePerps ? await hyperliquidPerps().catch(() => null) : null;
  const perpsBySymbol = new Map((perps?.results || []).map((row) => [normalizedMarketSymbol(row.asset || row.symbol), row]));
  const catalogPrices = useSpotCatalog ? await coingeckoPrices(wanted).catch(() => new Map()) : new Map();

  const settled = await Promise.allSettled(wanted.map(async (symbol) => {
    const catalog = catalogPrices.get(symbol);
    if (catalog) return catalog;

    if (MARKET_PREVIEW_SYMBOLS.has(symbol)) {
      return {
        symbol,
        priceUsd: null,
        provider: "Market provider",
        coverage: "Developing",
        isLive: false,
        isCached: false,
        isSample: false,
        lastUpdated: new Date().toISOString(),
        warning: "Coverage developing",
      };
    }

    const perp = perpsBySymbol.get(symbol);
    if (perp && num(perp.lastPrice || perp.markPx)) {
      return {
        symbol,
        priceUsd: num(perp.lastPrice || perp.markPx),
        provider: "Hyperliquid",
        coverage: "Live",
        isLive: true,
        isCached: false,
        isSample: false,
        lastUpdated: perps.lastUpdated || new Date().toISOString(),
        warning: "",
      };
    }

    const canonical = CANONICAL_PRICE_TOKENS[symbol];
    const isKnownCatalogSymbol = Boolean(COINGECKO_PRICE_IDS[symbol]);
    const dexResults = canonical ? await tokenDex(canonical.chainId, canonical.tokenAddress) : (isKnownCatalogSymbol ? [] : await searchDex(symbol));
    const dex = preferredDexPriceResult(symbol, dexResults);
    if (!dex && isKnownCatalogSymbol) return null;
    if (!dex || !num(dex.priceUsd)) return null;
    return {
      symbol,
      priceUsd: num(dex.priceUsd),
      provider: dex.provider || "Dexscreener",
      coverage: dex.coverage || "Developing",
      isLive: false,
      isCached: false,
      isSample: false,
      lastUpdated: dex.lastUpdated || new Date().toISOString(),
      warning: dex.warning || "Coverage developing",
      chainId: dex.chainId,
      dexId: dex.dexId,
      pairAddress: dex.pairAddress,
      liquidityUsd: dex.liquidityUsd,
      volume24h: dex.volume24h,
    };
  }));

  return settled.flatMap((item) => item.status === "fulfilled" && item.value ? [item.value] : []);
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
    entitlements: ["free"],
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
    stripePlanType: subscription?.plan_type || "",
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

async function resolveAccessForWallet(wallet, env) {
  if (!wallet) return freeAccess(env);
  const config = accessConfig(env);
  let subscription = null;
  try {
    subscription = await findSubscriptionStatus(env, { wallet });
  } catch (_) {}
  let balance = 0;
  if (config.tokenAccessConfigured) {
    try {
      balance = await fetchSplTokenBalance({ owner: wallet, mint: config.mint, rpcUrl: config.rpcUrl, fetchImpl: fetch });
    } catch (_) {}
  }
  return resolveAccessFromSignals({
    tokenBalance: balance,
    stripeActive: subscriptionActiveFromRow(subscription),
    stripeStatus: subscription?.status || "",
    stripePlanType: subscription?.plan_type || "",
    env,
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
  if (plan === "atlas_annual" && config.atlasYearlyPriceId) return config.atlasYearlyPriceId;
  if (plan === "atlas_monthly" && config.atlasMonthlyPriceId) return config.atlasMonthlyPriceId;
  if (plan === "annual" && config.yearlyPriceId) return config.yearlyPriceId;
  if (config.monthlyPriceId) return config.monthlyPriceId;
  if (config.proPriceId) return config.proPriceId;
  return "";
}

function normalizeCheckoutPlan(value = "") {
  const plan = String(value || "monthly").toLowerCase();
  if (plan === "atlas_annual" || plan === "atlas-yearly" || plan === "atlas_yearly") return "atlas_annual";
  if (plan === "atlas" || plan === "atlas_monthly" || plan === "atlas-monthly") return "atlas_monthly";
  if (plan === "annual" || plan === "yearly") return "annual";
  return "monthly";
}

async function handleCheckout(request, env) {
  const config = subscriptionConfig(env);
  if (!config.secretKey) return unavailable("missing_stripe_secret_key", 503, env);
  const body = await readJson(request);
  const wallet = String(body.wallet || "").trim();
  const email = String(body.email || "").trim();
  const plan = normalizeCheckoutPlan(body.plan || "monthly");
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

function alertIdFromPath(pathname) {
  const match = pathname.match(/^\/api\/alerts\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function apiPath(pathname) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function watchlistPath(pathname) {
  const parts = apiPath(pathname).split("/").filter(Boolean);
  return {
    listId: parts[2] || "",
    action: parts[3] || "",
    itemId: parts[4] || "",
  };
}

async function handleAlerts(request, env) {
  const url = new URL(request.url);
  const pathname = apiPath(url.pathname);
  const body = request.method === "GET" ? {} : await readJson(request);
  const wallet = String(url.searchParams.get("wallet") || body.wallet || body.user_id || body.userId || "").trim();
  const access = await resolveAccessForWallet(wallet, env);
  const entitlements = access.entitlements || ["free"];
  if (!wallet) return json({ ok: false, error: "missing_wallet", alertTypes: ALERT_TYPES, preview: true }, { status: 400 });
  const id = alertIdFromPath(pathname);
  try {
    if (pathname === "/api/alerts/events" && request.method === "GET") {
      return json({ ok: true, events: await listAlertEvents(env, wallet), access });
    }
    if (request.method === "GET") return json({ ok: true, alerts: await listAlerts(env, wallet), alertTypes: ALERT_TYPES, access });
    if (request.method === "POST" && pathname === "/api/alerts") {
      return json({ ok: true, alert: await createAlert(env, { ...body, user_id: wallet }, entitlements), access }, { status: 201 });
    }
    if (request.method === "PATCH" && id) {
      return json({ ok: true, alert: await updateAlert(env, wallet, id, body, entitlements), access });
    }
    if (request.method === "DELETE" && id) {
      return json({ ok: true, ...(await deleteAlert(env, wallet, id)), access });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "alerts_request_failed";
    const status = message === "pro_required" || error?.errors?.includes?.("pro_required") ? 403
      : message === "alerts_db_unavailable" ? 503
        : message === "alert_not_found" ? 404
          : 400;
    return json({ ok: false, error: message, errors: error?.errors || [], alertTypes: ALERT_TYPES, access }, { status });
  }
  return json({ ok: false, error: "not_found" }, { status: 404 });
}

async function handleWatchlists(request, env) {
  const url = new URL(request.url);
  const pathname = apiPath(url.pathname);
  const body = request.method === "GET" ? {} : await readJson(request);
  const wallet = String(url.searchParams.get("wallet") || body.wallet || body.user_id || body.userId || "").trim();
  const access = await resolveAccessForWallet(wallet, env);
  const entitlements = access.entitlements || ["free"];
  if (!wallet) return json({ ok: false, error: "missing_wallet", limits: watchlistLimits(entitlements), access }, { status: 400 });
  const { listId, action, itemId } = watchlistPath(pathname);
  try {
    if (pathname === "/api/watchlists" && request.method === "GET") {
      return json({ ok: true, watchlists: await listWatchlists(env, wallet), limits: watchlistLimits(entitlements), access });
    }
    if (pathname === "/api/watchlists" && request.method === "POST") {
      return json({ ok: true, watchlist: await createWatchlist(env, { ...body, user_id: wallet }, entitlements), limits: watchlistLimits(entitlements), access }, { status: 201 });
    }
    if (pathname === "/api/watchlists/items" && request.method === "POST") {
      return json({ ok: true, item: await addWatchlistItem(env, { ...body, user_id: wallet }, entitlements), limits: watchlistLimits(entitlements), access }, { status: 201 });
    }
    if (listId && !action && request.method === "PATCH") {
      return json({ ok: true, watchlist: await updateWatchlist(env, wallet, listId, body), limits: watchlistLimits(entitlements), access });
    }
    if (listId && !action && request.method === "DELETE") {
      return json({ ok: true, ...(await deleteWatchlist(env, wallet, listId)), limits: watchlistLimits(entitlements), access });
    }
    if (listId && action === "items" && request.method === "POST") {
      return json({ ok: true, item: await addWatchlistItem(env, { ...body, user_id: wallet, watchlist_id: listId }, entitlements), limits: watchlistLimits(entitlements), access }, { status: 201 });
    }
    if (listId && action === "items" && itemId && request.method === "DELETE") {
      return json({ ok: true, ...(await deleteWatchlistItem(env, wallet, itemId)), limits: watchlistLimits(entitlements), access });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "watchlists_request_failed";
    const status = message === "watchlists_db_unavailable" ? 503
      : message.includes("limit_reached") ? 403
        : message.startsWith("missing_") ? 400
          : 400;
    return json({ ok: false, error: message, limits: watchlistLimits(entitlements), access }, { status });
  }
  return json({ ok: false, error: "not_found" }, { status: 404 });
}

function handleHealth(env = {}) {
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
  return json({
    ok: requiredHealthy,
    status: requiredHealthy ? "ok" : "degraded",
    service: "ravenos-public",
    timestamp: new Date().toISOString(),
    checks,
  }, { status: requiredHealthy ? 200 : 503 });
}

function generatedAtOf(payload = {}) {
  return payload.generated_at || payload.updated_at || payload.freshness?.generated_at || "";
}

function ageSeconds(generatedAt) {
  if (!generatedAt) return null;
  const ts = Date.parse(String(generatedAt));
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, Math.floor((Date.now() - ts) / 1000));
}

function validatePublicPayload(payload) {
  const text = JSON.stringify(payload || {});
  const forbidden = PUBLIC_FORBIDDEN_PATTERNS.find((pattern) => pattern.test(text));
  if (forbidden) return { ok: false, reason: "private_label_detected" };
  const addressLike = PUBLIC_WALLET_LIKE_PATTERNS.find((pattern) => pattern.test(text));
  if (addressLike) return { ok: false, reason: "address_like_value_detected" };
  return { ok: true, reason: "" };
}

function publicTextSafe(payload) {
  return validatePublicPayload(payload).ok;
}

function isOriginSource(source = "") {
  return source === "origin" || source === "origin_cache";
}

function normalizePublicSource(source = "") {
  return isOriginSource(source) ? "public_origin" : source;
}

function publicSourceLabel(source = "") {
  return isOriginSource(source) || source === "public_origin" ? "public artifact origin" : "bundled public artifact";
}

function originPathForKey(key, config = {}) {
  if (config.originPath) return config.originPath;
  return "";
}

async function readOriginJson(request, env, key, config) {
  const base = String(env?.RAVENOS_PUBLIC_ORIGIN_URL || env?.RAVENOS_PUBLIC_ARTIFACT_ORIGIN || "").replace(/\/+$/, "");
  if (!base) return { payload: null, source: "origin_not_configured", error: "" };
  const originPath = originPathForKey(key, config);
  if (!originPath) return { payload: null, source: "origin_not_allowed", error: "" };
  const originUrl = new URL(`${base}${originPath}`);
  const headers = { accept: "application/json" };
  if (env?.RAVENOS_PUBLIC_ORIGIN_TOKEN) {
    headers.authorization = `Bearer ${env.RAVENOS_PUBLIC_ORIGIN_TOKEN}`;
    headers["x-ravenos-public-token"] = env.RAVENOS_PUBLIC_ORIGIN_TOKEN;
  }
  const cacheKey = new Request(originUrl.toString(), { method: "GET" });
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cached = cache ? await cache.match(cacheKey).catch(() => null) : null;
  if (cached) {
    const payload = await cached.clone().json().catch(() => null);
    if (payload && validatePublicPayload(payload).ok) {
      const publicPayload = payload.safe_public === true && payload.data && typeof payload.data === "object"
        ? payload.data
        : payload;
      const cachedAge = ageSeconds(generatedAtOf(publicPayload));
      const cacheFreshSeconds = Math.max(15, Math.min(60, Number(config.freshnessTargetSeconds || 120)));
      if (cachedAge !== null && cachedAge <= cacheFreshSeconds) {
        return { payload: publicPayload, source: "origin_cache", error: "" };
      }
    }
  }
  const response = await fetch(originUrl.toString(), { headers });
  if (!response.ok) return { payload: null, source: "origin", error: `origin_http_${response.status}` };
  const payload = await response.json().catch(() => null);
  const validation = validatePublicPayload(payload);
  if (!payload || typeof payload !== "object" || !validation.ok) {
    return { payload: null, source: "origin", error: validation.reason || "origin_invalid_json" };
  }
  const publicPayload = payload.safe_public === true && payload.data && typeof payload.data === "object"
    ? payload.data
    : payload;
  if (cache) {
    const ttl = Math.max(15, Math.min(60, Number(config.freshnessTargetSeconds || 120)));
    const cachedResponse = new Response(JSON.stringify(payload), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": `public, max-age=${ttl}`,
      },
    });
    await cache.put(cacheKey, cachedResponse).catch(() => {});
  }
  return { payload: publicPayload, source: "origin", error: "" };
}

async function readAssetJson(request, env, path) {
  if (!env?.ASSETS || !path) return null;
  const url = new URL(request.url);
  url.pathname = path;
  url.search = "";
  const response = await env.ASSETS.fetch(new Request(url.toString(), { method: "GET" }));
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object" || !publicTextSafe(payload)) return null;
  return payload;
}

async function readPublicArtifact(request, env, key, config) {
  const origin = await readOriginJson(request, env, key, config).catch((error) => ({
    payload: null,
    source: "origin",
    error: error instanceof Error ? error.message : "origin_unavailable",
  }));
  if (origin.payload) return origin;
  const asset = await readAssetJson(request, env, config.artifactPath);
  if (asset) return { payload: asset, source: "bundled_artifact", error: origin.error || "" };
  return { payload: null, source: origin.source || "bundled_artifact", error: origin.error || "artifact_unavailable" };
}

function publicEnvelope(key, config, payload, extra = {}) {
  const { source: extraSource, source_detail: _extraSourceDetail, source_label: _extraSourceLabel, ...restExtra } = extra;
  const generatedAt = extra.generated_at || generatedAtOf(payload) || new Date().toISOString();
  const age = ageSeconds(generatedAt);
  const stale = age === null ? true : age > Number(config.freshnessTargetSeconds || 900);
  const rawSource = extraSource || "bundled_artifact";
  const source = normalizePublicSource(rawSource);
  return {
    ok: true,
    key,
    endpoint: config.endpoint,
    schema_version: config.schemaVersion,
    generated_at: generatedAt,
    updated_at: new Date().toISOString(),
    freshness_target_seconds: config.freshnessTargetSeconds,
    freshness_age_seconds: age,
    stale,
    safe_public: true,
    redaction_policy: "aggregate_public_market_context_only",
    coverage: stale ? "delayed context" : "active",
    status: stale ? "stale" : "live_public_read",
    source,
    source_detail: rawSource,
    source_label: publicSourceLabel(source),
    artifact_path: config.artifactPath,
    data: payload || {},
    ...restExtra,
  };
}

function degradedEnvelope(key, config, message = "current read forming") {
  return {
    ok: false,
    key,
    endpoint: config.endpoint,
    schema_version: config.schemaVersion,
    generated_at: "",
    updated_at: new Date().toISOString(),
    freshness_target_seconds: config.freshnessTargetSeconds,
    freshness_age_seconds: null,
    stale: true,
    safe_public: true,
    redaction_policy: "aggregate_public_market_context_only",
    coverage: "developing",
    status: "degraded",
    source: "none",
    source_label: "current read forming",
    message,
    data: {},
  };
}

function heatmapRows(payload = {}) {
  const rows = Array.isArray(payload.rows) ? payload.rows : Array.isArray(payload.outcomes) ? payload.outcomes : [];
  return rows.filter((row) => row && typeof row === "object");
}

function rowScore(row = {}) {
  const confidence = { high: 25, medium: 14, low: 4 }[String(row.confidence || "").toLowerCase()] || 0;
  const state = String(row.derived_state || row.participant_outcome || "").toLowerCase();
  const stateScore = state.includes("reward") || state.includes("favorable") ? 45
    : state.includes("punish") ? -15
      : state.includes("unclear") || state.includes("mixed") ? 10
        : 0;
  return stateScore + confidence + num(row.sample_size || row.clean_sample || row.observed_sample) / 10;
}

function publicVenueLabel(value = "") {
  return /^hyperliquid$/i.test(String(value || "")) ? "Perps" : researchLabel(value || "market");
}

function publicCapBandLabel(value = "") {
  const text = String(value || "all");
  const labels = {
    fresh_pairs: "Fresh Pairs",
    live_activity: "Live Activity",
    jupiter_velocity: "Solana Routing Context",
    participant_cohorts: "Participant Cohort Validation",
    perps_all: "Perps Context",
    perps_alts: "Perps Alts",
    perps_large_alts: "Perps Large Alts",
    perps_majors: "Perps Majors",
  };
  return labels[text] || researchLabel(text);
}

function isPerpsOpportunityRow(row = {}) {
  const chain = String(row.chain || "").toLowerCase();
  const band = String(row.cap_band || "").toLowerCase();
  return chain === "hyperliquid" || band.startsWith("perps_");
}

function isSupportingContextRow(row = {}) {
  const band = String(row.cap_band || "").toLowerCase();
  return band === "live_activity" || band === "jupiter_velocity";
}

function isSpecificSpotSurface(row = {}) {
  const chain = String(row.chain || "").toLowerCase();
  const band = String(row.cap_band || "").toLowerCase();
  if (!chain || chain === "all") return false;
  if (!band || band === "all") return false;
  if (isPerpsOpportunityRow(row) || isSupportingContextRow(row)) return false;
  return true;
}

function aggregateOpportunityRows(rows = [], groupKey = "chain") {
  const groups = new Map();
  for (const row of rows) {
    const key = String(row[groupKey] || "all").toLowerCase();
    const current = groups.get(key) || {
      key,
      label: groupKey === "chain" ? publicVenueLabel(key) : publicCapBandLabel(key),
      observed: 0,
      usable: 0,
      rewarding: 0,
      punishing: 0,
      mixed: 0,
      sample_size: 0,
      top_row: null,
      top_assets: [],
      score: 0,
    };
    const sample = sampleSizeOf(row);
    current.observed += 1;
    current.usable += sample > 0 ? 1 : 0;
    current.sample_size += sample;
    if (/reward|favorable|constructive/i.test(publicOutcomeRead(row))) current.rewarding += 1;
    else if (/punish|weak|negative/i.test(publicOutcomeRead(row))) current.punishing += 1;
    else current.mixed += 1;
    current.score += rowScore(row);
    if (!current.top_row || rowScore(row) > rowScore(current.top_row)) current.top_row = row;
    if (Array.isArray(row.top_public_symbols)) current.top_assets.push(...row.top_public_symbols.slice(0, 4));
    groups.set(key, current);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      top_assets: [...new Set(group.top_assets)].slice(0, 8),
      confidence: confidenceFromPublicSample(group.sample_size, group.top_row?.confidence),
      read: group.rewarding > group.punishing ? "Participation constructive"
        : group.punishing > group.rewarding ? "Outcome evidence weak"
          : "Mixed outcome evidence",
      opportunity_label: group.rewarding > group.punishing ? "Improving"
        : group.punishing > group.rewarding ? "Fragile"
          : "Mixed",
      outcome_direction: group.rewarding > group.punishing ? "constructive"
        : group.punishing > group.rewarding ? "weak"
          : "mixed",
      participation_status: researchLabel(group.top_row?.participation_status || group.top_row?.derived_state || "observable"),
      reward_punishment_status: `${group.rewarding} rewarding / ${group.punishing} weak`,
    }))
    .sort((a, b) => b.score - a.score);
}

function opportunitySummaryFromHeatmap(payload = {}) {
  const rows = heatmapRows(payload);
  const spotRows = rows.filter((row) => !isPerpsOpportunityRow(row));
  const surfaceRows = spotRows.filter(isSpecificSpotSurface);
  const rankingRows = surfaceRows.length ? surfaceRows : spotRows;
  const perpsRows = rows.filter(isPerpsOpportunityRow);
  const sorted = [...rankingRows].sort((a, b) => rowScore(b) - rowScore(a));
  const top = sorted[0] || null;
  const rewarding = spotRows.filter((row) => /reward|favorable/i.test(`${row.derived_state || ""} ${row.participant_outcome || ""}`)).length;
  const punishing = spotRows.filter((row) => /punish|struggling/i.test(`${row.derived_state || ""} ${row.participant_outcome || ""}`)).length;
  const chainRows = aggregateOpportunityRows(spotRows.filter((row) => String(row.chain || "").toLowerCase() !== "all"), "chain");
  const capRows = aggregateOpportunityRows(spotRows.filter((row) => !isSupportingContextRow(row)), "cap_band");
  const perpsContext = aggregateOpportunityRows(perpsRows, "cap_band");
  const matrix = chainRows.slice(0, 8).flatMap((chain) => {
    return capRows.slice(0, 12).map((band) => {
      const matching = spotRows.filter((row) => String(row.chain || "").toLowerCase() === chain.key && String(row.cap_band || "").toLowerCase() === band.key);
      const aggregate = aggregateOpportunityRows(matching, "cap_band")[0] || null;
      return aggregate ? {
        chain: chain.key,
        chain_label: chain.label,
        cap_band: band.key,
        cap_band_label: band.label,
        opportunity_label: aggregate.opportunity_label,
        outcome_direction: aggregate.outcome_direction,
        participation_status: aggregate.participation_status,
        reward_punishment_status: aggregate.reward_punishment_status,
        confidence: aggregate.confidence,
        sample_size: aggregate.sample_size,
        top_assets: aggregate.top_assets,
        read: aggregate.read,
      } : null;
    }).filter(Boolean);
  });
  return {
    observed_rows: spotRows.length,
    total_observed_rows: rows.length,
    best_surface: top ? {
      chain: top.chain || "all",
      cap_band: top.cap_band || "all",
      sample_size: num(top.sample_size || top.clean_sample),
      confidence: top.confidence || "developing",
      read: top.derived_state || top.plain_language_summary || "current read forming",
    } : null,
    rewarding_count: rewarding,
    punishing_count: punishing,
    mixed_count: Math.max(0, spotRows.length - rewarding - punishing),
    chain_rows: chainRows,
    cap_band_rows: capRows,
    matrix,
    perps_context: {
      observed_rows: perpsRows.length,
      rows: perpsContext.slice(0, 6),
      read: perpsRows.length
        ? "Perps are tracked as separate market-pressure context, not as a chain participation surface."
        : "Perps context is forming.",
    },
    top_opportunities: sorted.slice(0, 6).map((row) => ({
      chain: row.chain,
      chain_label: publicVenueLabel(row.chain),
      cap_band: row.cap_band,
      cap_band_label: publicCapBandLabel(row.cap_band),
      why_now: row.plain_language_summary || publicOutcomeRead(row),
      what_is_working: [
        `Participation: ${researchLabel(row.participation_status || row.derived_state || "observable")}`,
        `Sample depth: ${sampleSizeOf(row).toLocaleString("en-US")}`,
      ],
      what_could_fail: [
        /punish|weak/i.test(publicOutcomeRead(row)) ? "Weak outcome evidence remains visible" : "Confirmation could narrow",
        "Liquidity and survival need continued followthrough",
      ],
      confidence: confidenceFromPublicSample(sampleSizeOf(row), row.confidence),
      top_assets: Array.isArray(row.top_public_symbols) ? row.top_public_symbols.slice(0, 6) : [],
      sample_size: sampleSizeOf(row),
      read: publicOutcomeRead(row),
    })),
    top_rows: sorted.slice(0, 8).map((row) => ({
      chain: row.chain,
      chain_label: publicVenueLabel(row.chain),
      cap_band: row.cap_band,
      cap_band_label: publicCapBandLabel(row.cap_band),
      sample_size: row.sample_size || row.clean_sample || row.observed_sample,
      confidence: row.confidence,
      read: row.derived_state || row.participant_outcome,
      summary: row.plain_language_summary || "",
      top_assets: Array.isArray(row.top_public_symbols) ? row.top_public_symbols.slice(0, 6) : [],
    })),
  };
}

function researchLabel(value = "") {
  return String(value || "current")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function sampleSizeOf(row = {}) {
  return num(row.sample_size || row.clean_sample || row.observed_sample || row.observed || row.count);
}

function confidenceFromPublicSample(sample = 0, confidence = "") {
  const text = String(confidence || "").toLowerCase();
  if (text === "high" || sample >= 1000) return "High";
  if (text === "medium" || sample >= 100) return "Moderate";
  if (sample >= 20) return "Developing";
  return "Low";
}

function publicOutcomeRead(row = {}) {
  const text = String(row.derived_state || row.participant_outcome || row.profitability_label || row.avg_outcome || "mixed outcome evidence");
  return text.replace(/outcomes unclear/gi, "mixed outcome evidence")
    .replace(/punishing outcomes/gi, "weak outcome evidence")
    .replace(/rewarding outcomes/gi, "constructive outcome evidence");
}

function researchRowsFromPublic(outcomes = {}, replay = {}, memory = {}, behavior = {}) {
  const outcomeRows = heatmapRows(outcomes);
  const behaviorRows = heatmapRows(behavior);
  const comparableRows = Array.isArray(replay.comparables) ? replay.comparables : [];
  const memoryFamilies = memory.frequent_condition_families && typeof memory.frequent_condition_families === "object"
    ? Object.entries(memory.frequent_condition_families)
    : [];
  const fromCohortValidation = outcomeRows
    .filter((row) => String(row.source || "") === "jupiter_helius_public_cohort_validation" || String(row.cap_band || "") === "participant_cohorts")
    .map((row) => ({
      view: "setup_families",
      finding: "Participant Cohort Validation",
      structure: "Observation-visible settled cohorts showed post-observation expansion evidence",
      status: "Observed",
      confidence: confidenceFromPublicSample(sampleSizeOf(row), row.confidence),
      sample_depth: sampleSizeOf(row),
      outcome_quality: Number(row.median_mfe_pct || 0) > 0 ? "Constructive" : "Mixed",
      replay_strength: "Proof Context",
      supports: [
        `${sampleSizeOf(row).toLocaleString("en-US")} settled cohort rows`,
        `Median post-observation MFE ${Number(row.median_mfe_pct || 0).toFixed(2)}%`,
        `P75 post-observation MFE ${Number(row.p75_mfe_pct || 0).toFixed(2)}%`,
        `Repeat participation ${Number(row.repeat_participation_pct || 0).toFixed(2)}%`,
      ],
      risks: Array.isArray(row.caveats) && row.caveats.length
        ? row.caveats.slice(0, 3).map(researchLabel)
        : ["Aggregate cohort evidence only", "Post-entry MFE is descriptive research", "Thin liquidity can distort extreme rows"],
      source_module: "cohort_validation",
    }));
  const fromOutcomes = outcomeRows.map((row) => ({
    view: "setup_families",
    finding: `${researchLabel(row.chain)} ${researchLabel(row.cap_band)}`,
    structure: publicOutcomeRead(row),
    status: /reward|favorable|constructive/i.test(publicOutcomeRead(row)) ? "Developing" : /punish|weak/i.test(publicOutcomeRead(row)) ? "Not useful" : "Observed",
    confidence: confidenceFromPublicSample(sampleSizeOf(row), row.confidence),
    sample_depth: sampleSizeOf(row),
    outcome_quality: /reward|favorable|constructive/i.test(publicOutcomeRead(row)) ? "Constructive" : /punish|weak/i.test(publicOutcomeRead(row)) ? "Weak" : "Mixed",
    replay_strength: "Contextual",
    supports: [
      `Participation status: ${researchLabel(row.participation_status || row.derived_state || "observable")}`,
      `Public sample: ${sampleSizeOf(row).toLocaleString("en-US")} observations`,
    ],
    risks: [
      Number(row.punishing_pct || 0) > Number(row.rewarding_pct || 0) ? "Weak outcome evidence remains visible" : "Confirmation still needs broader followthrough",
      "Public aggregate only",
    ],
    source_module: "outcomes",
  }));
  const fromBehavior = behaviorRows.slice(0, 30).map((row) => ({
    view: "failure_analysis",
    finding: `${researchLabel(row.chain)} ${researchLabel(row.cap_band)}`,
    structure: publicOutcomeRead(row),
    status: /punish|weak|fragile/i.test(publicOutcomeRead(row)) ? "Not useful" : "Observed",
    confidence: confidenceFromPublicSample(sampleSizeOf(row), row.confidence),
    sample_depth: sampleSizeOf(row),
    outcome_quality: /punish|weak|fragile/i.test(publicOutcomeRead(row)) ? "Weak" : "Mixed",
    replay_strength: "Contextual",
    supports: [row.plain_language_summary || "Aggregate behavior is observable"],
    risks: ["Concentration can distort the read", "Survival evidence still forming"],
    source_module: "behavior",
  }));
  const fromReplay = comparableRows.map((row) => ({
    view: "replay_analysis",
    finding: `${researchLabel(row.chain)} ${researchLabel(row.cap_band)}`,
    structure: "Historical analogue",
    status: "Observed",
    confidence: Number(row.similarity_score || 0) >= 0.75 ? "Moderate" : "Developing",
    sample_depth: 1,
    outcome_quality: "Descriptive",
    replay_strength: Number(row.similarity_score || 0) >= 0.8 ? "Strong" : "Moderate",
    supports: Array.isArray(row.match_reasons) ? row.match_reasons.slice(0, 3).map(researchLabel) : ["Comparable structure exists"],
    risks: ["Historical similarity is descriptive, not predictive"],
    source_module: "replay",
  }));
  const fromMemory = memoryFamilies.map(([family, count]) => ({
    view: "symbol_concentration",
    finding: researchLabel(family),
    structure: "Recurring condition family",
    status: "Observed",
    confidence: confidenceFromPublicSample(Number(count || 0), ""),
    sample_depth: Number(count || 0),
    outcome_quality: "Contextual",
    replay_strength: "Memory",
    supports: ["Condition keeps appearing in public memory"],
    risks: ["Frequent conditions still need outcome confirmation"],
    source_module: "memory",
  }));
  return [...fromCohortValidation, ...fromOutcomes, ...fromBehavior, ...fromReplay, ...fromMemory]
    .filter((row) => row.finding && row.structure)
    .slice(0, 300);
}

function newestGeneratedAt(payloads = []) {
  const parsed = payloads.map(generatedAtOf).filter(Boolean).map((value) => [value, Date.parse(value)]).filter(([, ts]) => Number.isFinite(ts));
  if (!parsed.length) return "";
  return parsed.sort((a, b) => b[1] - a[1])[0][0];
}

async function researchPublicPayload(request, env, config) {
  const [outcomes, replay, memory, behavior] = await Promise.all([
    readPublicArtifact(request, env, "outcomes", PUBLIC_API_ENDPOINTS.outcomes),
    readPublicArtifact(request, env, "replay", PUBLIC_API_ENDPOINTS.replay),
    readPublicArtifact(request, env, "memory", PUBLIC_API_ENDPOINTS.memory),
    readPublicArtifact(request, env, "behavior", PUBLIC_API_ENDPOINTS.behavior),
  ]);
  const payloads = [outcomes.payload, replay.payload, memory.payload, behavior.payload].filter(Boolean);
  if (!payloads.length) return degradedEnvelope("research", config, "research read forming");
  const rows = researchRowsFromPublic(outcomes.payload || {}, replay.payload || {}, memory.payload || {}, behavior.payload || {});
  const sources = [outcomes.source, replay.source, memory.source, behavior.source].filter(Boolean);
  const source = sources.some(isOriginSource) ? "public_origin" : sources[0] || "bundled_artifact";
  const sampleDepth = rows.reduce((sum, row) => sum + num(row.sample_depth), 0);
  const strongest = rows.find((row) => /constructive|developing|observed/i.test(`${row.outcome_quality} ${row.status}`)) || rows[0] || null;
  const weakest = rows.find((row) => /weak|not useful/i.test(`${row.outcome_quality} ${row.status}`)) || rows[rows.length - 1] || null;
  return publicEnvelope("research", config, {
    generated_at: newestGeneratedAt(payloads) || new Date().toISOString(),
    source_modules: ["outcomes", "replay", "memory", "behavior"],
    rows,
    summary: {
      findings_reviewed: rows.length,
      forward_observations: heatmapRows(outcomes.payload || {}).length + (Array.isArray(replay.payload?.comparables) ? replay.payload.comparables.length : 0),
      sample_depth: sampleDepth,
      strongest_condition: strongest ? strongest.finding : "Research read forming",
      weakest_condition: weakest ? weakest.finding : "Weak condition forming",
      what_raven_learned: "Current public research is strongest where participation and outcome evidence align, and weakest where concentration or thin confirmation dominates.",
      what_worked: strongest ? strongest.structure : "Constructive evidence is still forming.",
      what_failed: weakest ? weakest.structure : "Weak evidence is still forming.",
      what_changed_recently: "Research is now derived from fresh public-origin outcomes, replay, memory, and behavior artifacts.",
    },
    modules: {
      outcomes: { source: normalizePublicSource(outcomes.source), age_seconds: ageSeconds(generatedAtOf(outcomes.payload || {})), stale: false },
      replay: { source: normalizePublicSource(replay.source), age_seconds: ageSeconds(generatedAtOf(replay.payload || {})), stale: false },
      memory: { source: normalizePublicSource(memory.source), age_seconds: ageSeconds(generatedAtOf(memory.payload || {})), stale: false },
      behavior: { source: normalizePublicSource(behavior.source), age_seconds: ageSeconds(generatedAtOf(behavior.payload || {})), stale: false },
    },
  }, {
    source,
    generated_at: newestGeneratedAt(payloads) || new Date().toISOString(),
    summary: {
      findings_reviewed: rows.length,
      sample_depth: sampleDepth,
      source_modules: ["outcomes", "replay", "memory", "behavior"],
    },
  });
}

async function liveOpportunityPayload(request, env, config) {
  const artifact = await readPublicArtifact(request, env, "opportunity", config);
  const heatmap = artifact.payload;
  const summary = opportunitySummaryFromHeatmap(heatmap || {});
  let trending = [];
  if (String(env?.RAVENOS_DISABLE_LIVE_PROVIDER_FETCH || "").toLowerCase() !== "true") {
    try {
      trending = await trendingDex("market_cap_heatmap", { limit: 20 });
    } catch (_) {
      trending = [];
    }
  }
  return publicEnvelope("opportunity", config, heatmap || {}, {
    source: trending.length ? `${config.liveProvider}+${artifact.source}` : artifact.source,
    generated_at: trending.length ? new Date().toISOString() : generatedAtOf(heatmap || {}),
    summary: {
      ...summary,
      live_public_markets: trending.length,
      live_top_symbols: trending.slice(0, 8).map((row) => ({
        symbol: row.symbol,
        chain: row.chainId,
        liquidity_usd: row.liquidityUsd,
        volume_24h: row.volume24h,
        market_cap: row.marketCap || row.fdv,
      })),
    },
  });
}

async function liveTerminalPayload(request, env, config) {
  const artifact = await readPublicArtifact(request, env, "terminal", config);
  const heatmap = artifact.payload;
  let perps = null;
  try {
    perps = await hyperliquidPerps();
  } catch (_) {
    perps = null;
  }
  return publicEnvelope("terminal", config, heatmap || {}, {
    source: artifact.source,
    generated_at: perps?.lastUpdated || generatedAtOf(heatmap || {}),
    summary: {
      heatmap: opportunitySummaryFromHeatmap(heatmap || {}),
      perps: perps ? {
        provider: "Hyperliquid",
        count: perps.count,
        lastUpdated: perps.lastUpdated,
        top: (perps.results || []).slice(0, 12).map((row) => ({
          symbol: row.symbol || row.asset,
          price: row.lastPrice || row.markPx,
          pressureScore: row.pressureScore,
          pressureState: row.pressureState,
          liquidityPosture: row.liquidityPosture,
        })),
      } : {
        provider: "Hyperliquid",
        count: 0,
        warning: "perps public context forming",
      },
    },
  });
}

async function staticPublicPayload(request, env, key, config) {
  const artifact = await readPublicArtifact(request, env, key, config);
  if (!artifact.payload) return degradedEnvelope(key, config, "using page fallback; public artifact unavailable");
  return publicEnvelope(key, config, artifact.payload, { source: artifact.source });
}

async function chainPublicPayload(request, env, key, config) {
  const artifact = await readPublicArtifact(request, env, key, config);
  const payload = artifact.payload;
  if (!payload) return degradedEnvelope(key, config, "chain read forming");
  const rows = heatmapRows(payload).filter((row) => String(row.chain || "").toLowerCase() === config.chain);
  const summary = opportunitySummaryFromHeatmap({ rows });
  const capBands = aggregateOpportunityRows(rows, "cap_band");
  const best = capBands[0] || null;
  const weakest = [...capBands].sort((a, b) => (b.punishing - b.rewarding) - (a.punishing - a.rewarding))[0] || null;
  const liveCategory = config.chain === "eth" ? "ethereum" : config.chain;
  let liveRows = [];
  let liveProviderChecked = false;
  if (String(env?.RAVENOS_DISABLE_LIVE_PROVIDER_FETCH || "").toLowerCase() !== "true") {
    try {
      liveProviderChecked = true;
      liveRows = await trendingDex(liveCategory, { limit: 20 });
    } catch (_) {
      liveProviderChecked = true;
      liveRows = [];
    }
  }
  const liveAssets = liveRows
    .map((row) => row.symbol)
    .filter(Boolean)
    .slice(0, 12);
  const artifactAssets = rows.flatMap((row) => Array.isArray(row.top_public_symbols) ? row.top_public_symbols : []);
  return publicEnvelope(key, config, payload, {
    source: liveProviderChecked ? `${config.liveProvider}+${artifact.source}` : artifact.source,
    generated_at: liveProviderChecked ? new Date().toISOString() : generatedAtOf(payload),
    summary: {
      ...summary,
      cap_band_rows: capBands,
      best_cap_band: best,
      weakest_cap_band: weakest,
      live_public_markets: liveRows.length,
      live_top_symbols: liveRows.slice(0, 8).map((row) => ({
        symbol: row.symbol,
        chain: row.chainId,
        liquidity_usd: row.liquidityUsd,
        volume_24h: row.volume24h,
        market_cap: row.marketCap || row.fdv,
      })),
      top_assets: [...new Set([...liveAssets, ...artifactAssets])].slice(0, 12),
      current_read: best
        ? `${publicVenueLabel(config.chain)} ${best.label} is the clearest current surface; ${weakest?.label || "weaker cohorts"} remains the main caveat.`
        : `${publicVenueLabel(config.chain)} read is forming from public context.`,
    },
    rows,
  });
}

async function handlePublicRead(request, env, key) {
  const config = PUBLIC_API_ENDPOINTS[key];
  if (!config) return json({ ok: false, error: "not_found" }, { status: 404 });
  try {
    if (key === "terminal") return publicJson(await liveTerminalPayload(request, env, config), config);
    if (key === "opportunity") return publicJson(await liveOpportunityPayload(request, env, config), config);
    if (key === "research") return publicJson(await researchPublicPayload(request, env, config), config);
    if (key.startsWith("chains/")) return publicJson(await chainPublicPayload(request, env, key, config), config);
    return publicJson(await staticPublicPayload(request, env, key, config), config);
  } catch (error) {
    return publicJson(degradedEnvelope(key, config, error instanceof Error ? error.message : "public read unavailable"), config, { status: 200 });
  }
}

async function handlePublicStatus(request, env) {
  const entries = await Promise.all(Object.entries(PUBLIC_API_ENDPOINTS).map(async ([key, config]) => {
    if (key === "research") {
      const envelope = await researchPublicPayload(request, env, config);
      const generatedAt = generatedAtOf(envelope);
      const artifactAge = ageSeconds(generatedAt);
      return {
        key,
        endpoint: config.endpoint,
        artifact_path: "derived:outcomes+replay+memory+behavior",
        source: envelope.source,
        source_detail: envelope.source_detail || envelope.source,
        source_label: envelope.source_label,
        freshness_target_seconds: config.freshnessTargetSeconds,
        last_generated_at: generatedAt || null,
        artifact_generated_at: generatedAt || null,
        freshness_age_seconds: artifactAge,
        artifact_age_seconds: artifactAge,
        last_known_good_age_seconds: artifactAge,
        stale: artifactAge === null ? true : artifactAge > Number(config.freshnessTargetSeconds || 900),
        safe_public: true,
        leak_guard: envelope.ok ? "pass" : "unavailable",
        schema_version: config.schemaVersion,
        redaction_policy: "aggregate_public_market_context_only",
        status: envelope.ok ? "available" : "degraded",
        origin_fetch_failed: false,
        error: envelope.ok ? "" : envelope.message || "research_read_forming",
      };
    }
    const artifact = await readPublicArtifact(request, env, key, config);
    const payload = artifact.payload;
    const generatedAt = generatedAtOf(payload || {});
    const artifactAge = ageSeconds(generatedAt);
    const liveProviderActive = Boolean(config.liveProvider) && String(env?.RAVENOS_DISABLE_LIVE_PROVIDER_FETCH || "").toLowerCase() !== "true";
    const effectiveGeneratedAt = liveProviderActive ? new Date().toISOString() : generatedAt;
    const effectiveAge = ageSeconds(effectiveGeneratedAt);
    const normalizedSource = normalizePublicSource(artifact.source);
    return {
      key,
      endpoint: config.endpoint,
      artifact_path: config.artifactPath,
      source: liveProviderActive ? `${config.liveProvider}+${normalizedSource}` : normalizedSource,
      source_detail: artifact.source,
      source_label: liveProviderActive ? "live public provider with verified artifact context" : publicSourceLabel(normalizedSource),
      freshness_target_seconds: config.freshnessTargetSeconds,
      last_generated_at: effectiveGeneratedAt || null,
      artifact_generated_at: generatedAt || null,
      freshness_age_seconds: effectiveAge,
      artifact_age_seconds: artifactAge,
      last_known_good_age_seconds: artifactAge,
      stale: effectiveAge === null ? true : effectiveAge > Number(config.freshnessTargetSeconds || 900),
      safe_public: true,
      leak_guard: payload ? "pass" : "unavailable",
      schema_version: config.schemaVersion,
      redaction_policy: "aggregate_public_market_context_only",
      status: payload ? "available" : "degraded",
      origin_fetch_failed: Boolean(config.originPath && !isOriginSource(artifact.source) && artifact.error),
      error: artifact.error || "",
    };
  }));
  return publicJson({
    ok: true,
    generated_at: new Date().toISOString(),
    status: entries.some((entry) => entry.status === "degraded") ? "degraded" : "live_public_api",
    endpoints: entries,
    private_leak_guard: "public_artifacts_only",
    normal_pages_rebuild_required_for_data: false,
  }, { cacheControl: "public, max-age=30, stale-while-revalidate=120" });
}

async function routeApi(request, env) {
  const url = new URL(request.url);
  const pathname = apiPath(url.pathname);
  if (pathname === "/api/health" && request.method === "GET") return handleHealth(env);
  if (pathname === "/api/status" && request.method === "GET") return handlePublicStatus(request, env);
  if (request.method === "GET") {
    const publicKey = pathname.replace(/^\/api\//, "");
    if (PUBLIC_API_ENDPOINTS[publicKey]) return handlePublicRead(request, env, publicKey);
  }
  if (pathname === "/api/access" && (request.method === "GET" || request.method === "POST")) return handleAccess(request, env);
  if (pathname === "/api/stripe/checkout" && request.method === "POST") return handleCheckout(request, env);
  if (pathname === "/api/stripe/portal" && request.method === "POST") return handlePortal(request, env);
  if (pathname === "/api/stripe/webhook" && request.method === "POST") return handleWebhook(request, env);
  if ((pathname === "/api/alerts" || pathname === "/api/alerts/events" || pathname.startsWith("/api/alerts/"))
      && ["GET", "POST", "PATCH", "DELETE"].includes(request.method)) return handleAlerts(request, env);
  if ((pathname === "/api/watchlists" || pathname === "/api/watchlists/items" || pathname.startsWith("/api/watchlists/"))
      && ["GET", "POST", "PATCH", "DELETE"].includes(request.method)) return handleWatchlists(request, env);
  if (pathname === "/api/dexscreener/search" && request.method === "GET") {
    try {
      return json({ ok: true, results: (await resolveDexInput(url.searchParams.get("q") || "")).slice(0, 30) });
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "dexscreener_search_failed", results: [] }, { status: 502 });
    }
  }
  if (pathname === "/api/dexscreener/trending" && request.method === "GET") {
    try {
      return json({ ok: true, coverage: "Developing", results: await trendingDex(url.searchParams.get("category") || "market_cap_heatmap", { limit: url.searchParams.get("limit") || 50 }) });
    } catch (error) {
      return json({ ok: false, coverage: "Limited", error: error instanceof Error ? error.message : "dexscreener_trending_failed", results: [] }, { status: 502 });
    }
  }
  if (pathname === "/api/dexscreener/token" && request.method === "GET") {
    try {
      return json({ ok: true, results: await tokenDex(url.searchParams.get("chainId") || "", url.searchParams.get("tokenAddress") || "") });
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "dexscreener_token_failed", results: [] }, { status: 502 });
    }
  }
  if (pathname === "/api/dexscreener/pair" && request.method === "GET") {
    try {
      return json({ ok: true, results: await pairDex(url.searchParams.get("chainId") || "", url.searchParams.get("pairAddress") || "") });
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "dexscreener_pair_failed", results: [] }, { status: 502 });
    }
  }
  if (pathname === "/api/market/prices" && request.method === "GET") {
    try {
      const symbols = String(url.searchParams.get("symbols") || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      return json({ ok: true, resolverVersion: "canonical-price-v3", results: await marketPrices(symbols, { market: url.searchParams.get("market") || "mixed" }) });
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "market_prices_failed", results: [] }, { status: 502 });
    }
  }
  if (pathname === "/api/hyperliquid/perps" && request.method === "GET") {
    try {
      return json(await hyperliquidPerps());
    } catch (error) {
      return json({ ok: false, provider: "Hyperliquid", coverage: "Unavailable", isLive: false, warning: "Hyperliquid unavailable", error: error instanceof Error ? error.message : "hyperliquid_perps_failed", results: [] }, { status: 502 });
    }
  }
  if (pathname === "/api/hyperliquid/candles" && request.method === "GET") {
    try {
      const symbol = url.searchParams.get("symbol") || "";
      const timeframe = url.searchParams.get("timeframe") || "1h";
      return json(await hyperliquidCandles(symbol, timeframe));
    } catch (error) {
      return json({ ok: false, provider: "Hyperliquid", coverage: "Unavailable", isLive: false, warning: "Hyperliquid candles unavailable", error: error instanceof Error ? error.message : "hyperliquid_candles_failed", candles: [] }, { status: 502 });
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
    return env.ASSETS.fetch(request);
  },
};
