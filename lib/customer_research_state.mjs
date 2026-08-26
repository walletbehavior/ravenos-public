import bs58 from "bs58";

import {
  authorizeCustomerApiRequest,
  consumeCustomerRateLimit,
  randomOpaqueId,
  sha256,
} from "./customer_identity.mjs";
import {
  boundedJsonResponse,
  parseBoundedJsonBody,
} from "./customer_trade/terminal_runtime.mjs";

export const CUSTOMER_RESEARCH_STATE_ROUTE = "/api/v1/research-state";
export const CUSTOMER_RESEARCH_STATE_SCHEMA = "ravenos.customer_research_state.v1";
export const SAVED_EXACT_MARKET_SCHEMA = "ravenos.saved_exact_market.v1";
export const SAVED_WORKSPACE_SCHEMA = "ravenos.saved_workspace.v1";

export const CustomerResearchStateLimits = Object.freeze({
  maximum_request_bytes: 8 * 1024,
  maximum_response_bytes: 128 * 1024,
  maximum_saved_markets: 100,
  maximum_indicators: 6,
  maximum_raven_overlays: 12,
  save_requests_per_15_minutes: 40,
  delete_requests_per_15_minutes: 80,
  list_requests_per_15_minutes: 120,
  refresh_requests_per_15_minutes: 30,
  availability_reuse_seconds: 15 * 60,
});

const TIMEFRAMES = new Set(["1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M"]);
const INDICATORS = new Set(["ema20", "ema50", "vwap", "bb20", "rsi14", "macd"]);
const RAVEN_OVERLAYS = new Set([
  "structure",
  "pressure",
  "participation",
  "replay",
  "risk",
  "pressure-zone",
  "history-window",
  "breadth-line",
  "compression-band",
  "regime-marker",
  "liquidity-zone",
  "participant-shift",
]);
const DENSITIES = new Set(["compact", "comfortable"]);
const PANELS = new Set(["chart", "raven", "book", "trade", "account"]);
const AVAILABILITY_STATES = new Set(["available", "unavailable", "superseded", "unverified"]);
const EVM_CHAINS = new Set(["base", "ethereum", "robinhood", "arbitrum", "optimism", "bsc", "polygon"]);
const LISTED_TYPES = new Set(["equity", "etf"]);
const TOP_LEVEL_SAVE_FIELDS = new Set(["market", "workspace", "expected_revision"]);
const MARKET_ASSERTION_FIELDS = new Set([
  "instrument_id",
  "instrument_type",
  "identity_scope",
  "asset_class",
  "chain",
  "venue",
  "market",
]);
const WORKSPACE_FIELDS = new Set([
  "schema_version",
  "timeframe",
  "indicators",
  "raven_overlays",
  "density",
  "selected_panel",
]);
const textEncoder = new TextEncoder();

function text(value, maximum = 300) {
  return String(value ?? "").trim().slice(0, maximum);
}

function plainText(value, maximum = 120) {
  return text(value, maximum)
    .replace(/[<>]/g, "")
    .replace(/\bon[a-z]+\s*=/gi, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function exactObject(value, fields, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ResearchStateError(code);
  if (Object.keys(value).some((key) => !fields.has(key))) throw new ResearchStateError(code);
  return value;
}

function strictPositiveInteger(value, code) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new ResearchStateError(code);
  return number;
}

function validSolanaAddress(value) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  try {
    return bs58.decode(value).length === 32;
  } catch {
    return false;
  }
}

function shortIdentity(value) {
  const identity = text(value, 180);
  return identity.length > 16 ? `${identity.slice(0, 7)}…${identity.slice(-5)}` : identity;
}

function asserted(value, expected, code) {
  const assertion = text(value, 100).toLowerCase();
  if (assertion && assertion !== String(expected).toLowerCase()) throw new ResearchStateError(code);
}

function assertedOneOf(value, expected, code) {
  const assertion = text(value, 100).toLowerCase();
  if (assertion && !expected.includes(assertion)) throw new ResearchStateError(code);
}

export class ResearchStateError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "ResearchStateError";
    this.code = code;
  }
}

export function canonicalizeSavedMarket(input = {}) {
  const market = exactObject(input, MARKET_ASSERTION_FIELDS, "saved_market_invalid");
  const suppliedId = text(market.instrument_id, 220);
  if (!suppliedId || suppliedId.includes("?") || suppliedId.includes("#")) throw new ResearchStateError("exact_market_identity_required");

  const pool = suppliedId.match(/^([a-z0-9-]+):pool:([^:]+)$/);
  if (pool) {
    const chain = pool[1].toLowerCase();
    let address = pool[2];
    if (chain === "solana") {
      if (!validSolanaAddress(address)) throw new ResearchStateError("exact_market_identity_invalid");
    } else if (EVM_CHAINS.has(chain)) {
      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) throw new ResearchStateError("exact_market_identity_invalid");
      address = address.toLowerCase();
    } else {
      throw new ResearchStateError("exact_market_identity_unsupported");
    }
    asserted(market.instrument_type, "exact_pool", "exact_market_identity_mismatch");
    asserted(market.identity_scope, "exact_pool", "exact_market_identity_mismatch");
    asserted(market.asset_class, "crypto", "exact_market_identity_mismatch");
    asserted(market.chain, chain, "exact_market_identity_mismatch");
    assertedOneOf(market.market, ["spot", "crypto_spot"], "exact_market_identity_mismatch");
    return Object.freeze({
      instrument_id: `${chain}:pool:${address}`,
      instrument_type: "exact_pool",
      identity_scope: "exact_pool",
      asset_class: "crypto",
      chain_id: chain,
      venue_id: "onchain",
      market_type: "spot",
      base_symbol: null,
      quote_symbol: null,
      display_label: `${chain.charAt(0).toUpperCase()}${chain.slice(1)} pool ${shortIdentity(address)}`,
    });
  }

  const perp = suppliedId.match(/^hyperliquid:perp:([A-Za-z0-9._-]{1,40})$/);
  if (perp) {
    const symbol = perp[1].toUpperCase();
    asserted(market.instrument_type, "perpetual", "exact_market_identity_mismatch");
    asserted(market.identity_scope, "exact_instrument", "exact_market_identity_mismatch");
    asserted(market.asset_class, "crypto", "exact_market_identity_mismatch");
    asserted(market.chain, "hyperliquid", "exact_market_identity_mismatch");
    asserted(market.venue, "hyperliquid", "exact_market_identity_mismatch");
    assertedOneOf(market.market, ["perp", "perpetual", "perpetuals"], "exact_market_identity_mismatch");
    return Object.freeze({
      instrument_id: `hyperliquid:perp:${symbol}`,
      instrument_type: "perpetual",
      identity_scope: "exact_instrument",
      asset_class: "crypto",
      chain_id: "hyperliquid",
      venue_id: "hyperliquid",
      market_type: "perpetual",
      base_symbol: symbol,
      quote_symbol: "USD",
      display_label: `${symbol} perpetual`,
    });
  }

  const listed = suppliedId.match(/^(equity|etf):([a-z0-9.-]{1,40}):([a-z0-9.-]{1,32})$/i);
  if (listed) {
    const instrumentType = listed[1].toLowerCase();
    const venue = listed[2].toLowerCase();
    const symbol = listed[3].toUpperCase();
    if (!LISTED_TYPES.has(instrumentType)) throw new ResearchStateError("exact_market_identity_unsupported");
    asserted(market.instrument_type, instrumentType, "exact_market_identity_mismatch");
    asserted(market.identity_scope, "exact_instrument", "exact_market_identity_mismatch");
    assertedOneOf(market.asset_class, instrumentType === "etf" ? ["etf", "equity"] : ["equity"], "exact_market_identity_mismatch");
    asserted(market.chain, "none", "exact_market_identity_mismatch");
    asserted(market.venue, venue, "exact_market_identity_mismatch");
    assertedOneOf(market.market, ["listed", "equity", "equities", "etf"], "exact_market_identity_mismatch");
    return Object.freeze({
      instrument_id: `${instrumentType}:${venue}:${symbol.toLowerCase()}`,
      instrument_type: instrumentType,
      identity_scope: "exact_instrument",
      asset_class: instrumentType,
      chain_id: null,
      venue_id: venue,
      market_type: "listed",
      base_symbol: symbol,
      quote_symbol: "USD",
      display_label: `${symbol} · ${venue.toUpperCase()}`,
    });
  }

  throw new ResearchStateError("exact_market_identity_required");
}

function normalizeStringList(input, allowlist, maximum, code) {
  if (!Array.isArray(input)) throw new ResearchStateError(code);
  if (input.length > maximum) throw new ResearchStateError(code);
  const output = [];
  for (const value of input) {
    const normalized = text(value, 60);
    if (!allowlist.has(normalized)) throw new ResearchStateError(code);
    if (!output.includes(normalized)) output.push(normalized);
  }
  return Object.freeze(output);
}

export function normalizeSavedWorkspace(input = {}) {
  const workspace = exactObject(input, WORKSPACE_FIELDS, "saved_workspace_invalid");
  const schemaVersion = text(workspace.schema_version || SAVED_WORKSPACE_SCHEMA, 80);
  if (schemaVersion !== SAVED_WORKSPACE_SCHEMA) throw new ResearchStateError("saved_workspace_schema_unsupported");
  const timeframe = text(workspace.timeframe || "1h", 8);
  const density = text(workspace.density || "comfortable", 20);
  const selectedPanel = text(workspace.selected_panel || "chart", 20);
  if (!TIMEFRAMES.has(timeframe) || !DENSITIES.has(density) || !PANELS.has(selectedPanel)) {
    throw new ResearchStateError("saved_workspace_invalid");
  }
  return Object.freeze({
    schema_version: SAVED_WORKSPACE_SCHEMA,
    timeframe,
    indicators: normalizeStringList(workspace.indicators || [], INDICATORS, CustomerResearchStateLimits.maximum_indicators, "saved_workspace_indicators_invalid"),
    raven_overlays: normalizeStringList(workspace.raven_overlays || [], RAVEN_OVERLAYS, CustomerResearchStateLimits.maximum_raven_overlays, "saved_workspace_overlays_invalid"),
    density,
    selected_panel: selectedPanel,
  });
}

function stableWorkspace(workspace) {
  return JSON.stringify({
    schema_version: workspace.schema_version,
    timeframe: workspace.timeframe,
    indicators: [...workspace.indicators],
    raven_overlays: [...workspace.raven_overlays],
    density: workspace.density,
    selected_panel: workspace.selected_panel,
  });
}

function normalizedAvailability(input, now) {
  const state = text(input?.availability_state || "unverified", 30).toLowerCase();
  const availabilityState = AVAILABILITY_STATES.has(state) ? state : "unverified";
  const reason = plainText(input?.availability_reason || (availabilityState === "unverified" ? "not_checked" : ""), 100) || null;
  const checked = Number(input?.availability_checked_at);
  return Object.freeze({
    availability_state: availabilityState,
    availability_reason: reason,
    availability_checked_at: Number.isSafeInteger(checked) && checked > 0 ? checked : (availabilityState === "unverified" ? null : now),
    display_label: plainText(input?.display_label, 120) || null,
    base_symbol: plainText(input?.base_symbol, 32) || null,
    quote_symbol: plainText(input?.quote_symbol, 32) || null,
    venue_id: /^[a-z0-9.-]{1,40}$/.test(text(input?.venue_id, 40).toLowerCase()) ? text(input.venue_id, 40).toLowerCase() : null,
  });
}

function parseJsonList(value, allowlist, maximum) {
  try {
    return normalizeStringList(JSON.parse(String(value || "[]")), allowlist, maximum, "stored_workspace_invalid");
  } catch {
    throw new ResearchStateError("stored_research_state_invalid");
  }
}

function iso(seconds) {
  return Number.isSafeInteger(Number(seconds)) && Number(seconds) > 0 ? new Date(Number(seconds) * 1000).toISOString() : null;
}

function publicWatchItem(row) {
  const market = {
    instrument_id: text(row.instrument_id, 220),
    instrument_type: text(row.instrument_type, 40),
    identity_scope: text(row.identity_scope, 40),
    asset_class: text(row.asset_class, 20),
    chain: text(row.chain_id, 40) || null,
    venue: text(row.venue_id, 40),
    market: text(row.market_type, 30),
    base_symbol: plainText(row.base_symbol, 32) || null,
    quote_symbol: plainText(row.quote_symbol, 32) || null,
    display_label: plainText(row.display_label, 120) || "Exact market",
  };
  const workspace = {
    schema_version: SAVED_WORKSPACE_SCHEMA,
    timeframe: text(row.timeframe, 8),
    indicators: parseJsonList(row.indicators_json, INDICATORS, CustomerResearchStateLimits.maximum_indicators),
    raven_overlays: parseJsonList(row.raven_overlays_json, RAVEN_OVERLAYS, CustomerResearchStateLimits.maximum_raven_overlays),
    density: text(row.density, 20),
    selected_panel: text(row.selected_panel, 20),
  };
  return Object.freeze({
    watch_id: text(row.watch_id, 100),
    schema_version: SAVED_EXACT_MARKET_SCHEMA,
    market,
    workspace,
    revision: Number(row.revision),
    availability: {
      state: AVAILABILITY_STATES.has(row.availability_state) ? row.availability_state : "unverified",
      reason: plainText(row.availability_reason, 100) || null,
      checked_at: iso(row.availability_checked_at),
    },
    terminal_url: buildSavedMarketTerminalUrl({ market, workspace }),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  });
}

export function buildSavedMarketTerminalUrl({ market, workspace }) {
  const canonical = canonicalizeSavedMarket({
    instrument_id: market?.instrument_id,
    instrument_type: market?.instrument_type,
    identity_scope: market?.identity_scope,
    asset_class: market?.asset_class,
    chain: market?.chain,
    venue: market?.instrument_type === "exact_pool" ? undefined : market?.venue,
    market: market?.market,
  });
  const saved = normalizeSavedWorkspace(workspace);
  const url = new URL("/terminal/", "https://ravenos.xyz");
  url.searchParams.set("instrument_id", canonical.instrument_id);
  url.searchParams.set("instrument_type", canonical.instrument_type);
  url.searchParams.set("identity_scope", canonical.identity_scope);
  url.searchParams.set("asset_class", canonical.asset_class);
  if (canonical.chain_id) url.searchParams.set("chain", canonical.chain_id);
  const persistedVenue = text(market?.venue, 40).toLowerCase();
  url.searchParams.set("venue", /^[a-z0-9.-]{1,40}$/.test(persistedVenue) ? persistedVenue : canonical.venue_id);
  url.searchParams.set("market", canonical.market_type);
  if (canonical.base_symbol) url.searchParams.set("asset", canonical.base_symbol);
  if (canonical.quote_symbol) url.searchParams.set("quote", canonical.quote_symbol);
  url.searchParams.set("timeframe", saved.timeframe);
  url.searchParams.set("indicators", saved.indicators.join(","));
  if (saved.raven_overlays.length) url.searchParams.set("raven_overlays", saved.raven_overlays.join(","));
  url.searchParams.set("density", saved.density);
  url.searchParams.set("panel", saved.selected_panel);
  return url.toString();
}

export function createD1CustomerResearchStateStore(db) {
  if (!db?.prepare) throw new Error("customer_research_state_database_required");
  return {
    async getByInstrument(userId, instrumentId) {
      return db.prepare("SELECT * FROM ravenos_customer_watch_items WHERE user_id = ? AND instrument_id = ? LIMIT 1")
        .bind(userId, instrumentId).first();
    },
    async list(userId) {
      const result = await db.prepare("SELECT * FROM ravenos_customer_watch_items WHERE user_id = ? ORDER BY updated_at DESC, watch_id ASC LIMIT 100")
        .bind(userId).all();
      return Array.isArray(result?.results) ? result.results : [];
    },
    async upsert({ user_id: userId, market, workspace, availability, content_hash: contentHash, now, expected_revision: expectedRevision }) {
      let existing = await this.getByInstrument(userId, market.instrument_id);
      if (existing && expectedRevision !== null && Number(existing.revision) !== expectedRevision) throw new ResearchStateError("saved_research_revision_conflict");
      const label = availability.display_label || existing?.display_label || market.display_label;
      const baseSymbol = availability.base_symbol || existing?.base_symbol || market.base_symbol;
      const quoteSymbol = availability.quote_symbol || existing?.quote_symbol || market.quote_symbol;
      const venueId = availability.venue_id || existing?.venue_id || market.venue_id;
      if (existing) {
        const unchanged = existing.content_hash === contentHash
          && String(existing.display_label || "") === String(label || "")
          && String(existing.base_symbol || "") === String(baseSymbol || "")
          && String(existing.quote_symbol || "") === String(quoteSymbol || "")
          && String(existing.venue_id || "") === String(venueId || "")
          && String(existing.availability_state || "") === String(availability.availability_state || "")
          && String(existing.availability_reason || "") === String(availability.availability_reason || "")
          && Number(existing.availability_checked_at || 0) === Number(availability.availability_checked_at || 0);
        if (unchanged) return existing;
        const revision = existing.content_hash === contentHash ? Number(existing.revision) : Number(existing.revision) + 1;
        return db.prepare(`
          UPDATE ravenos_customer_watch_items SET
            display_label = ?, base_symbol = ?, quote_symbol = ?, venue_id = ?,
            workspace_schema_version = ?, timeframe = ?, indicators_json = ?, raven_overlays_json = ?, density = ?, selected_panel = ?,
            revision = ?, content_hash = ?, availability_state = ?, availability_reason = ?, availability_checked_at = ?, updated_at = ?
          WHERE watch_id = ? AND user_id = ? RETURNING *
        `).bind(
          label, baseSymbol, quoteSymbol, venueId,
          workspace.schema_version, workspace.timeframe, JSON.stringify(workspace.indicators), JSON.stringify(workspace.raven_overlays), workspace.density, workspace.selected_panel,
          revision, contentHash, availability.availability_state, availability.availability_reason, availability.availability_checked_at, now,
          existing.watch_id, userId,
        ).first();
      }
      const watchId = randomOpaqueId("wat_", 18);
      try {
        return await db.prepare(`
          INSERT INTO ravenos_customer_watch_items (
            watch_id, schema_version, user_id, instrument_id, instrument_type, identity_scope, asset_class, chain_id, venue_id, market_type,
            base_symbol, quote_symbol, display_label, workspace_schema_version, timeframe, indicators_json, raven_overlays_json, density,
            selected_panel, revision, content_hash, availability_state, availability_reason, availability_checked_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?) RETURNING *
        `).bind(
          watchId, SAVED_EXACT_MARKET_SCHEMA, userId, market.instrument_id, market.instrument_type, market.identity_scope, market.asset_class,
          market.chain_id, venueId, market.market_type, baseSymbol, quoteSymbol, label, workspace.schema_version, workspace.timeframe,
          JSON.stringify(workspace.indicators), JSON.stringify(workspace.raven_overlays), workspace.density, workspace.selected_panel,
          contentHash, availability.availability_state, availability.availability_reason, availability.availability_checked_at, now, now,
        ).first();
      } catch (error) {
        if (String(error?.message || error).includes("saved_research_quota_exceeded")) throw new ResearchStateError("saved_research_quota_exceeded");
        existing = await this.getByInstrument(userId, market.instrument_id);
        if (!existing) throw error;
        return this.upsert({ user_id: userId, market, workspace, availability, content_hash: contentHash, now, expected_revision: expectedRevision });
      }
    },
    async updateAvailability(userId, watchId, availability, now) {
      return db.prepare(`
        UPDATE ravenos_customer_watch_items SET
          display_label = COALESCE(?, display_label), base_symbol = COALESCE(?, base_symbol), quote_symbol = COALESCE(?, quote_symbol),
          venue_id = COALESCE(?, venue_id), availability_state = ?, availability_reason = ?, availability_checked_at = ?, updated_at = ?
        WHERE user_id = ? AND watch_id = ? RETURNING *
      `).bind(
        availability.display_label, availability.base_symbol, availability.quote_symbol, availability.venue_id,
        availability.availability_state, availability.availability_reason, availability.availability_checked_at, now, userId, watchId,
      ).first();
    },
    async getOwned(userId, watchId) {
      return db.prepare("SELECT * FROM ravenos_customer_watch_items WHERE user_id = ? AND watch_id = ? LIMIT 1").bind(userId, watchId).first();
    },
    async deleteOwned(userId, watchId) {
      const result = await db.prepare("DELETE FROM ravenos_customer_watch_items WHERE user_id = ? AND watch_id = ?").bind(userId, watchId).run();
      return Number(result?.meta?.changes || 0);
    },
    async deleteAllOwned(userId) {
      const result = await db.prepare("DELETE FROM ravenos_customer_watch_items WHERE user_id = ?").bind(userId).run();
      return Number(result?.meta?.changes || 0);
    },
  };
}

function researchStore(env, deps) {
  return deps.researchStore || createD1CustomerResearchStateStore(env.RAVENOS_CUSTOMER_DB);
}

async function rateLimit(authorization, env, request, action, limit) {
  return consumeCustomerRateLimit({
    store: authorization.store,
    env,
    request,
    action: "customer_research_state",
    scope: action,
    subject: authorization.principal.user_id,
    now: authorization.now,
    window_seconds: 15 * 60,
    limit,
    include_network: action === "save" || action === "refresh",
  });
}

function withAuthHeaders(response, authorization) {
  if (!authorization?.response_headers) return response;
  const headers = new Headers(response.headers);
  const setCookie = authorization.response_headers.get("set-cookie");
  if (setCookie) headers.append("set-cookie", setCookie);
  headers.set("vary", "Cookie");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function json(payload, init = {}, authorization = null) {
  return withAuthHeaders(boundedJsonResponse(payload, init, {
    max_bytes: CustomerResearchStateLimits.maximum_response_bytes,
    fallback_payload: { ok: false, schema_version: CUSTOMER_RESEARCH_STATE_SCHEMA, error: "saved_research_response_too_large" },
  }), authorization);
}

async function parseBody(request) {
  try {
    return await parseBoundedJsonBody(request, { max_bytes: CustomerResearchStateLimits.maximum_request_bytes });
  } catch (error) {
    if (error?.code === "request_too_large") throw new ResearchStateError("saved_research_request_too_large");
    throw new ResearchStateError("saved_research_request_invalid");
  }
}

function ownedWatchId(value) {
  const watchId = text(value, 100);
  if (!/^wat_[A-Za-z0-9_-]{12,80}$/.test(watchId)) throw new ResearchStateError("saved_research_item_not_found");
  return watchId;
}

function routeMatch(pathname) {
  if (pathname === CUSTOMER_RESEARCH_STATE_ROUTE) return { kind: "collection" };
  if (pathname === `${CUSTOMER_RESEARCH_STATE_ROUTE}/watch-items`) return { kind: "items" };
  const refresh = pathname.match(/^\/api\/v1\/research-state\/watch-items\/([^/]+)\/refresh$/);
  if (refresh) return { kind: "refresh", watch_id: refresh[1] };
  const item = pathname.match(/^\/api\/v1\/research-state\/watch-items\/([^/]+)$/);
  if (item) return { kind: "item", watch_id: item[1] };
  return null;
}

function methodAllowed(route, method) {
  return (route.kind === "collection" && (method === "GET" || method === "DELETE"))
    || (route.kind === "items" && method === "POST")
    || (route.kind === "item" && method === "DELETE")
    || (route.kind === "refresh" && method === "POST");
}

function sameOriginReadBoundary(request) {
  const requestOrigin = new URL(request.url).origin;
  const suppliedOrigin = text(request.headers.get("origin"), 300);
  if (suppliedOrigin && suppliedOrigin !== requestOrigin) return false;
  const fetchSite = text(request.headers.get("sec-fetch-site"), 32).toLowerCase();
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

async function resolveAvailability(deps, market, now) {
  if (typeof deps.resolveMarketAvailability !== "function") return normalizedAvailability({}, now);
  try {
    return normalizedAvailability(await deps.resolveMarketAvailability(market), now);
  } catch {
    return normalizedAvailability({ availability_state: "unverified", availability_reason: "provider_unavailable" }, now);
  }
}

function errorResponse(error, authorization = null) {
  const code = error instanceof ResearchStateError ? error.code : "saved_research_state_unavailable";
  const status = code === "saved_research_request_too_large" ? 413
    : code === "saved_research_revision_conflict" || code === "saved_research_quota_exceeded" ? 409
      : code === "saved_research_item_not_found" ? 404
        : code === "saved_research_state_unavailable" || code === "stored_research_state_invalid" ? 503
          : 400;
  return json({ ok: false, schema_version: CUSTOMER_RESEARCH_STATE_SCHEMA, error: code }, { status }, authorization);
}

export async function routeCustomerResearchState(request, env = {}, deps = {}) {
  const url = new URL(request.url);
  const route = routeMatch(url.pathname);
  if (!route) return null;
  if (!methodAllowed(route, request.method)) {
    return json({ ok: false, schema_version: CUSTOMER_RESEARCH_STATE_SCHEMA, error: "method_not_allowed" }, { status: 405 });
  }
  const mutation = request.method !== "GET";
  if (!mutation && !sameOriginReadBoundary(request)) {
    return json({ ok: false, schema_version: CUSTOMER_RESEARCH_STATE_SCHEMA, error: "request_not_allowed" }, { status: 403 });
  }
  const authorization = await authorizeCustomerApiRequest(request, env, deps, { require_csrf: mutation });
  if (authorization.response) return authorization.response;
  const store = researchStore(env, deps);
  const userId = authorization.principal.user_id;
  try {
    if (route.kind === "collection" && request.method === "GET") {
      const limited = await rateLimit(authorization, env, request, "list", CustomerResearchStateLimits.list_requests_per_15_minutes);
      if (!limited.allowed) return json({ ok: false, schema_version: CUSTOMER_RESEARCH_STATE_SCHEMA, error: "saved_research_rate_limited" }, { status: 429, headers: { "retry-after": String(limited.retry_after_seconds) } }, authorization);
      const rows = await store.list(userId);
      return json({
        ok: true,
        schema_version: CUSTOMER_RESEARCH_STATE_SCHEMA,
        state: rows.length ? "available" : "empty",
        items: rows.map(publicWatchItem),
        limits: { maximum_saved_markets: CustomerResearchStateLimits.maximum_saved_markets, remaining: Math.max(0, CustomerResearchStateLimits.maximum_saved_markets - rows.length) },
        boundaries: { exact_identity_only: true, alerts: false, wallets: false, execution: false, provider_payloads_persisted: false },
      }, {}, authorization);
    }

    if (route.kind === "items") {
      const limited = await rateLimit(authorization, env, request, "save", CustomerResearchStateLimits.save_requests_per_15_minutes);
      if (!limited.allowed) return json({ ok: false, schema_version: CUSTOMER_RESEARCH_STATE_SCHEMA, error: "saved_research_rate_limited" }, { status: 429, headers: { "retry-after": String(limited.retry_after_seconds) } }, authorization);
      const body = exactObject(await parseBody(request), TOP_LEVEL_SAVE_FIELDS, "saved_research_request_invalid");
      const market = canonicalizeSavedMarket(body.market);
      const workspace = normalizeSavedWorkspace(body.workspace || {});
      const expectedRevision = body.expected_revision === undefined || body.expected_revision === null
        ? null
        : strictPositiveInteger(body.expected_revision, "saved_research_revision_invalid");
      const current = await store.getByInstrument(userId, market.instrument_id);
      const checkedAt = Number(current?.availability_checked_at || 0);
      const availability = current && checkedAt > 0 && authorization.now - checkedAt < CustomerResearchStateLimits.availability_reuse_seconds
        ? normalizedAvailability(current, authorization.now)
        : await resolveAvailability(deps, market, authorization.now);
      const contentHash = await sha256(JSON.stringify({ instrument_id: market.instrument_id, workspace: JSON.parse(stableWorkspace(workspace)) }));
      const row = await store.upsert({
        user_id: userId,
        market,
        workspace,
        availability,
        content_hash: contentHash,
        now: authorization.now,
        expected_revision: expectedRevision,
      });
      return json({ ok: true, schema_version: CUSTOMER_RESEARCH_STATE_SCHEMA, created: !current, item: publicWatchItem(row) }, { status: current ? 200 : 201 }, authorization);
    }

    if (route.kind === "refresh") {
      const limited = await rateLimit(authorization, env, request, "refresh", CustomerResearchStateLimits.refresh_requests_per_15_minutes);
      if (!limited.allowed) return json({ ok: false, schema_version: CUSTOMER_RESEARCH_STATE_SCHEMA, error: "saved_research_rate_limited" }, { status: 429, headers: { "retry-after": String(limited.retry_after_seconds) } }, authorization);
      const body = await parseBody(request);
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length) throw new ResearchStateError("saved_research_request_invalid");
      const watchId = ownedWatchId(route.watch_id);
      const current = await store.getOwned(userId, watchId);
      if (!current) throw new ResearchStateError("saved_research_item_not_found");
      const market = canonicalizeSavedMarket({ instrument_id: current.instrument_id });
      const availability = await resolveAvailability(deps, market, authorization.now);
      const row = await store.updateAvailability(userId, watchId, availability, authorization.now);
      if (!row) throw new ResearchStateError("saved_research_item_not_found");
      return json({ ok: true, schema_version: CUSTOMER_RESEARCH_STATE_SCHEMA, item: publicWatchItem(row) }, {}, authorization);
    }

    if (route.kind === "item") {
      const limited = await rateLimit(authorization, env, request, "delete", CustomerResearchStateLimits.delete_requests_per_15_minutes);
      if (!limited.allowed) return json({ ok: false, schema_version: CUSTOMER_RESEARCH_STATE_SCHEMA, error: "saved_research_rate_limited" }, { status: 429, headers: { "retry-after": String(limited.retry_after_seconds) } }, authorization);
      const body = await parseBody(request);
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length) throw new ResearchStateError("saved_research_request_invalid");
      const watchId = ownedWatchId(route.watch_id);
      const deletedCount = await store.deleteOwned(userId, watchId);
      return json({ ok: true, schema_version: CUSTOMER_RESEARCH_STATE_SCHEMA, deleted: deletedCount > 0 }, {}, authorization);
    }

    const limited = await rateLimit(authorization, env, request, "delete", CustomerResearchStateLimits.delete_requests_per_15_minutes);
    if (!limited.allowed) return json({ ok: false, schema_version: CUSTOMER_RESEARCH_STATE_SCHEMA, error: "saved_research_rate_limited" }, { status: 429, headers: { "retry-after": String(limited.retry_after_seconds) } }, authorization);
    const body = await parseBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || body.confirm !== "delete_all_saved_research_state") {
      throw new ResearchStateError("saved_research_delete_confirmation_required");
    }
    const deletedCount = await store.deleteAllOwned(userId);
    return json({ ok: true, schema_version: CUSTOMER_RESEARCH_STATE_SCHEMA, deleted_count: deletedCount, state: "empty" }, {}, authorization);
  } catch (error) {
    return errorResponse(error, authorization);
  }
}

export const CustomerResearchStateContract = Object.freeze({
  schema_version: CUSTOMER_RESEARCH_STATE_SCHEMA,
  route: CUSTOMER_RESEARCH_STATE_ROUTE,
  exact_market_schema: SAVED_EXACT_MARKET_SCHEMA,
  workspace_schema: SAVED_WORKSPACE_SCHEMA,
  persistence: "customer_owned_d1",
  raw_provider_payloads_persisted: false,
  wallets_persisted: false,
  alerts_available: false,
  execution_available: false,
  quotas: Object.freeze({ saved_markets: CustomerResearchStateLimits.maximum_saved_markets }),
});
