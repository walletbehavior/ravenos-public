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
  SOL: { chainId: "solana", tokenAddress: "So11111111111111111111111111111111111111112" },
  ETH: { chainId: "ethereum", tokenAddress: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" },
  WETH: { chainId: "ethereum", tokenAddress: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" },
  BTC: { chainId: "ethereum", tokenAddress: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" },
  WBTC: { chainId: "ethereum", tokenAddress: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" },
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
  const response = await fetch(`${COINGECKO_BASE_URL}/simple/price?ids=${encodeURIComponent(ids.join(","))}&vs_currencies=usd`, {
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
    const quoteScore = (quote) => ({ USDC: 4, USDT: 3, WETH: 2, ETH: 2, SOL: 2, WBNB: 1 }[String(quote || "").toUpperCase()] || 0);
    return (quoteScore(b.quoteSymbol) - quoteScore(a.quoteSymbol))
      || (num(b.liquidityUsd) - num(a.liquidityUsd))
      || (num(b.volume24h) - num(a.volume24h));
  })[0] || null;
}

async function marketPrices(symbols = [], { market = "mixed" } = {}) {
  const wanted = [...new Set(symbols.map(normalizedMarketSymbol).filter(Boolean))].slice(0, 80);
  const usePerps = String(market || "mixed").toLowerCase() !== "spot";
  const useSpotCatalog = String(market || "mixed").toLowerCase() === "spot";
  const perps = usePerps ? await hyperliquidPerps().catch(() => null) : null;
  const perpsBySymbol = new Map((perps?.results || []).map((row) => [normalizedMarketSymbol(row.asset || row.symbol), row]));
  const catalogPrices = useSpotCatalog ? await coingeckoPrices(wanted).catch(() => new Map()) : new Map();

  const settled = await Promise.allSettled(wanted.map(async (symbol) => {
    const catalog = catalogPrices.get(symbol);
    if (catalog) return catalog;

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
    const dexResults = canonical ? await tokenDex(canonical.chainId, canonical.tokenAddress) : await searchDex(symbol);
    const dex = preferredDexPriceResult(symbol, dexResults);
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

async function routeApi(request, env) {
  const url = new URL(request.url);
  const pathname = apiPath(url.pathname);
  if (pathname === "/api/health" && request.method === "GET") return handleHealth(env);
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
      return json({ ok: true, results: await marketPrices(symbols, { market: url.searchParams.get("market") || "mixed" }) });
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
