import { authorizeCustomerApiRequest, consumeCustomerRateLimit } from "./customer_identity.mjs";
import { readProductAccess } from "./customer_pro.mjs";
import { boundedJsonResponse, parseBoundedJsonBody } from "./customer_trade/terminal_runtime.mjs";
import { NearIntentsShieldedProvider, resolveShieldedAsset, amountForUsd, SHIELDED_ASSETS } from "./customer_trade/shielded_route_providers.mjs";
import { shieldedCapabilities, assertShadowAccess, assertNoShieldedSecrets, createShieldedIntent, decimalMicrosFloor, SHIELDED_BOUNDARY } from "./customer_trade/shielded_reserve.mjs";
import { compareShieldedRoutes, RESERVE_COMPARISON_ASSETS } from "./customer_trade/shielded_route_comparison.mjs";

export const CUSTOMER_SHIELDED_ROUTE = "/api/v1/portfolio/shielded";
// Only public test-vector quotes are cached. No customer balances, addresses or keys.
export function createShieldedQuoteCache() { return { catalog: null, catalogAt: 0, catalogPending: null, quotes: new Map() }; }
const cache = createShieldedQuoteCache();
const names = { solana_usdc: "Solana · USDC", solana_sol: "Solana · SOL", base_usdc: "Base · USDC", base_eth: "Base · ETH", arbitrum_usdc: "Arbitrum · USDC", ethereum_usdc: "Ethereum · USDC", avalanche_usdc: "Avalanche · USDC", hyperliquid_usdc: "Hyperliquid · perps USDC" };
const json = (payload, status = 200, headers) => boundedJsonResponse(payload, { status, headers: { ...Object.fromEntries(headers || []), "cache-control": "private, no-store", "referrer-policy": "no-referrer", vary: "Cookie, Origin" } }, { max_bytes: 64 * 1024, terminal_security: true });

async function catalogFor(provider, state, now) {
  if (state.catalog && now - state.catalogAt < 60_000) return state.catalog;
  if (!state.catalogPending) state.catalogPending = provider.tokens().then(value => { state.catalog = value; state.catalogAt = now; return value; }).finally(() => { state.catalogPending = null; });
  return state.catalogPending;
}

export async function routeCustomerShielded(request, env = {}, deps = {}) {
  const url = new URL(request.url), path = url.pathname;
  if (path !== CUSTOMER_SHIELDED_ROUTE && !path.startsWith(`${CUSTOMER_SHIELDED_ROUTE}/`)) return null;
  if (url.origin !== "https://app.ravenos.xyz") return json({ ok: false, error: "not_found" }, 404);
  const compare = path === `${CUSTOMER_SHIELDED_ROUTE}/compare`;
  const quote = path === `${CUSTOMER_SHIELDED_ROUTE}/quote` || compare;
  if (path !== CUSTOMER_SHIELDED_ROUTE && !quote) return json({ ok: false, error: "not_found" }, 404);
  if (request.method !== (quote ? "POST" : "GET")) return json({ ok: false, error: "method_not_allowed" }, 405);
  if (url.search) return json({ ok: false, error: "query_not_supported" }, 400);
  let auth;
  try {
    auth = await (deps.authorizeRequest || authorizeCustomerApiRequest)(request, env, deps.identity || {}, { require_csrf: quote });
    if (auth.response) return auth.response;
    const flags = shieldedCapabilities(env);
    if (!flags.enabled || !flags.SHIELDED_ROUTE_QUOTES_ENABLED) return json({ ok: false, error: "shielded_disabled", boundary: SHIELDED_BOUNDARY }, 503, auth.response_headers);
    const access = await (deps.readAccess || readProductAccess)(env.RAVENOS_CUSTOMER_DB, auth.principal.user_id, { now: auth.now });
    if (!access.pro) return json({ ok: false, error: "pro_required", boundary: SHIELDED_BOUNDARY }, 403, auth.response_headers);
    // Shared D1 limiter runs even on cache hits and catalog reads.
    const limited = await (deps.rateLimit || consumeCustomerRateLimit)({ store: auth.store, env, request, action: "shielded_preview", scope: "user", subject: auth.principal.user_id, now: auth.now, window_seconds: 60, limit: 8 });
    if (!limited.allowed) return json({ ok: false, error: "shielded_rate_limited" }, 429, auth.response_headers);
    let input, usd;
    if (quote) {
      input = await parseBoundedJsonBody(request, { max_bytes: 1024, stream_bounded: true });
      assertNoShieldedSecrets(input);
      const keys = compare ? ["source", "destination", "amount_usd"] : ["action", "network", "amount_usd"];
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(k => !keys.includes(k))) throw Error("request_invalid");
      if (compare) {
        if (!RESERVE_COMPARISON_ASSETS.includes(input.source) || !RESERVE_COMPARISON_ASSETS.includes(input.destination) || input.source === input.destination) throw Error("request_invalid");
        assertShadowAccess(env, "SHIELDED_RETURN"); assertShadowAccess(env, "SHIELDED_DEPLOY");
      } else {
        if (!["SHIELDED_DEPLOY", "SHIELDED_RETURN", "SHIELDED_SEND"].includes(input.action) || typeof input.network !== "string" || !Object.hasOwn(names, input.network)) throw Error("request_invalid");
        assertShadowAccess(env, input.action);
      }
      if (typeof input.amount_usd !== "string" || !/^(0|[1-9][0-9]{0,5})(\.[0-9]{1,2})?$/.test(input.amount_usd)) throw Error("request_invalid");
      usd = decimalMicrosFloor(input.amount_usd);
      if (BigInt(usd) < 1_000000n || BigInt(usd) > 50000_000000n) throw Error("request_invalid");
      if (compare) {
        const comparisonLimit = await (deps.rateLimit || consumeCustomerRateLimit)({ store: auth.store, env, request, action: "shielded_comparison", scope: "user", subject: auth.principal.user_id, now: auth.now, window_seconds: 60, limit: 2 });
        if (!comparisonLimit.allowed) return json({ ok: false, error: "shielded_comparison_rate_limited" }, 429, auth.response_headers);
      }
    }
    const now = deps.nowMs ?? Date.now(), state = deps.cache || cache;
    const provider = deps.provider || new NearIntentsShieldedProvider({ env });
    const catalog = await catalogFor(provider, state, now);
    if (!quote) {
      const zec = resolveShieldedAsset(catalog, "zec");
      const fresh = zec && zec.price_usd_micros !== "0" && Math.abs(now - Date.parse(zec.price_observed_at)) < 600_000;
      return json({ ok: true, mode: "pro_shadow_preview", boundary: SHIELDED_BOUNDARY,
        reserve: { balance_zatoshis: null, verified: false, connection_state: "wallet_integration_unavailable", wallet_connection_enabled: false },
        readiness: { stage: "route_preview", live_transfers: false, wallet_connection: false,
          settlement_reconciliation: false, refund_recovery: false, shielded_receipt_verification: false },
        zec_price: fresh ? { usd_micros: zec.price_usd_micros, observed_at: zec.price_observed_at } : null,
        assets: Object.entries(names).map(([key, label]) => ({ key, label, supported: Boolean(resolveShieldedAsset(catalog, key)), ...SHIELDED_ASSETS[key] })),
        actions: { deploy: flags.SHIELDED_DEPLOY_ENABLED, return: flags.SHIELDED_RETURN_ENABLED, send: flags.SHIELDED_SEND_ENABLED },
        comparison: { enabled: flags.SHIELDED_DEPLOY_ENABLED && flags.SHIELDED_RETURN_ENABLED, assets: RESERVE_COMPARISON_ASSETS },
        unsupported: [{ key: "robinhood_usdc", label: "Robinhood", reason: "No supported reserve route in the current provider catalog." }],
        provider: { id: provider.id, customer_destinations_sent: false, cache_seconds: 60 },
      }, 200, auth.response_headers);
    }
    const key = compare ? `compare|${input.source}|${input.destination}|${usd}` : `${input.action}|${input.network}|${usd}`;
    const resultKey = compare ? "comparison" : "quote";
    const existing = state.quotes.get(key);
    if (existing && existing.expires > now) return json({ ok: true, [resultKey]: await existing.promise, cached: true }, 200, auth.response_headers);
    if (state.quotes.size >= 64) state.quotes.delete(state.quotes.keys().next().value);
    if (compare) {
      const entry = { expires: now + 25000, promise: compareShieldedRoutes({ source: input.source, destination: input.destination, usd_micros: usd }, { provider, catalog, env, now: deps.now || (() => Date.now()) }) };
      state.quotes.set(key, entry);
      try {
        const result = await entry.promise;
        if (!result.available) state.quotes.delete(key);
        else entry.expires = Math.min(entry.expires, Date.parse(result.research_expires_at));
        return json({ ok: true, comparison: result, cached: false }, 200, auth.response_headers);
      } catch { state.quotes.delete(key); throw Error("provider_unavailable"); }
    }
    const reverse = input.action === "SHIELDED_RETURN";
    const source = reverse ? input.network : "zec", destination = reverse ? "zec" : input.network;
    const amountAsset = resolveShieldedAsset(catalog, input.action === "SHIELDED_SEND" ? destination : source);
    if (!amountAsset) return json({ ok: true, quote: { available: false, reason: "unsupported_chain_or_asset", boundary: SHIELDED_BOUNDARY } }, 200, auth.response_headers);
    const intent = createShieldedIntent({ action: input.action, source, destination, amount_atomic: amountForUsd(amountAsset, usd), expires_at: new Date(now + 60_000).toISOString() }, { now });
    const entry = { expires: now + 25_000, promise: provider.quote(intent, catalog) };
    state.quotes.set(key, entry);
    try {
      const result = await entry.promise;
      if (!result.available) state.quotes.delete(key);
      else entry.expires = Math.min(entry.expires, Date.parse(result.research_expires_at));
      return json({ ok: true, quote: result, cached: false }, 200, auth.response_headers);
    } catch { state.quotes.delete(key); throw Error("provider_unavailable"); }
  } catch (error) {
    if (["invalid_json", "unsupported_content_type", "request_too_large"].includes(error.code)) return json({ ok: false, error: "shielded_request_invalid" }, error.code === "request_too_large" ? 413 : 400, auth?.response_headers);
    const invalid = ["request_invalid", "sensitive_wallet_material_rejected", "shielded_action_disabled"].includes(error.message);
    return json({ ok: false, error: invalid ? "shielded_request_invalid" : "shielded_provider_unavailable", boundary: SHIELDED_BOUNDARY }, invalid ? 400 : 503, auth?.response_headers);
  }
}
