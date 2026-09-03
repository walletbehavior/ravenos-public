import { normalizeAssetIdentity } from "./agentic_trading/identity.mjs";

export const DEXCH_PROVIDER_ID = "dexch";
export const DEXCH_PROVIDER_BASE_URL = "https://api.dexch.art";
export const DEXCH_DISCOVERY_SCHEMA = "ravenos.token_discovery.dexch.v1";
export const DEXCH_TOKEN_SCHEMA = "ravenos.provider_token.dexch.v1";
export const DEXCH_HOLDERS_SCHEMA = "ravenos.provider_holders.dexch.v1";
export const DEXCH_TRADES_SCHEMA = "ravenos.provider_trades.dexch.v1";
export const DEXCH_CANDLES_SCHEMA = "ravenos.provider_candles.dexch.v1";

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const CURSOR_RE = /^[A-Za-z0-9_=+\/-]{1,512}$/;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 240;

const CHAIN_CONFIG = Object.freeze({
  solana: Object.freeze({
    chain_id: "solana:mainnet-beta",
    label: "Solana",
    address_pattern: SOLANA_ADDRESS_RE,
    token_standard: "solana-mint",
  }),
  robinhood: Object.freeze({
    chain_id: "eip155:4663",
    label: "Robinhood Chain",
    address_pattern: EVM_ADDRESS_RE,
    token_standard: "erc20",
  }),
  bsc: Object.freeze({
    chain_id: "eip155:56",
    label: "BNB Chain",
    address_pattern: EVM_ADDRESS_RE,
    token_standard: "erc20",
  }),
});

const PRESETS = new Set(["new", "almost", "graduated"]);
const FEEDS = new Set(["trending", "new", "bonded", "hot"]);
const SORTS = new Set([
  "trending",
  "new",
  "volume24h",
  "marketCap",
  "liquidity",
  "txns24h",
  "holders",
  "progress",
  "priceChange24h",
  "priceChange1h",
  "lastActivity",
  "migratedAt",
]);
const TIMEFRAMES = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);

const TOKEN_FILTERS = Object.freeze({
  min_market_cap_usd: "minMcap",
  max_market_cap_usd: "maxMcap",
  min_liquidity_usd: "minLiq",
  max_liquidity_usd: "maxLiq",
  min_volume_24h_usd: "minVol",
  max_volume_24h_usd: "maxVol",
  min_transactions_24h: "minTxns",
  max_transactions_24h: "maxTxns",
  min_holders: "minHolders",
  max_holders: "maxHolders",
  min_progress_bps: "minProgress",
  max_progress_bps: "maxProgress",
  min_age_minutes: "minAge",
  max_age_minutes: "maxAge",
});

function cleanText(value, maximum = 160) {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, maximum) : "";
}

function optionalNumber(value, { minimum = -Number.MAX_VALUE, maximum = Number.MAX_VALUE } = {}) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function optionalInteger(value, options = {}) {
  const parsed = optionalNumber(value, options);
  return parsed !== null && Number.isSafeInteger(parsed) ? parsed : null;
}

function rawUnsignedInteger(value) {
  const normalized = String(value ?? "").trim();
  return /^(?:0|[1-9][0-9]*)$/.test(normalized) ? normalized : null;
}

function isoTimestamp(value, nowMs = Date.now()) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed) || parsed > nowMs + 300_000) return null;
  return new Date(parsed).toISOString();
}

function safeHttpsUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "https:" && parsed.username === "" && parsed.password === ""
      ? parsed.toString().slice(0, 800)
      : null;
  } catch {
    return null;
  }
}

function byteLength(value) {
  return new TextEncoder().encode(String(value || "")).byteLength;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function providerError(code, status = 502) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function chainConfig(value) {
  const chain = cleanText(value, 32).toLowerCase();
  const config = CHAIN_CONFIG[chain];
  if (!config) throw providerError("dexch_chain_unsupported", 400);
  return { chain, ...config };
}

function normalizeAddress(chain, value, field = "address") {
  const config = chainConfig(chain);
  const address = cleanText(value, 80);
  if (!config.address_pattern.test(address)) throw providerError(`dexch_${field}_invalid`, 422);
  return config.chain === "solana" ? address : address.toLowerCase();
}

function lifecycleState(row, migratedAt) {
  const status = cleanText(row?.status, 40).toUpperCase();
  if (migratedAt || status === "MIGRATED" || cleanText(row?.tier, 40).toUpperCase() === "GRADUATED") return "GRADUATED";
  if (status === "BONDING") return "BONDING";
  if (cleanText(row?.kind, 40).toUpperCase() === "POOL") return "ACTIVE_POOL";
  return "DISCOVERED";
}

function canonicalAsset(row, chain, address, symbol, decimals) {
  const config = CHAIN_CONFIG[chain];
  return normalizeAssetIdentity({
    chain_id: config.chain_id,
    kind: "fungible_token",
    standard: config.token_standard,
    reference: address,
    symbol: symbol || "UNKNOWN",
    decimals,
    representation: "canonical",
    verification_state: chain === "solana"
      ? "provider_reported_token_program_unresolved"
      : "provider_reported_contract",
  });
}

function qualityForToken(row, normalized) {
  const contradictions = [];
  const unknownFields = [];
  if (normalized.market.holder_count === null) unknownFields.push("holder_count");
  if (normalized.market.top_10_supply_pct === null) unknownFields.push("top_10_supply_pct");
  if (normalized.market.liquidity_usd === null) unknownFields.push("liquidity_usd");
  if (normalized.market.market_cap_usd === null) unknownFields.push("market_cap_usd");
  if (normalized.lifecycle.created_at === null) unknownFields.push("created_at");
  const providerHolderCount = optionalInteger(row?.holderCount, { minimum: 0 });
  if (providerHolderCount === 0 && (normalized.market.transactions_24h ?? 0) > 0) {
    contradictions.push("provider_reported_zero_holders_with_trading_activity");
  }
  if (row?.top10Pct !== null && row?.top10Pct !== undefined && optionalNumber(row.top10Pct, { minimum: 0, maximum: 100 }) === null) {
    contradictions.push("provider_holder_percentage_out_of_range");
  }
  const totalSupply = rawUnsignedInteger(row?.totalSupply);
  const circulatingSupply = rawUnsignedInteger(row?.circulatingSupply);
  if (totalSupply === "0" && circulatingSupply && circulatingSupply !== "0") {
    contradictions.push("provider_total_supply_zero_but_circulating_supply_positive");
  }
  return Object.freeze({
    state: contradictions.length ? "contradictory" : unknownFields.length ? "partial" : "provider_reported",
    contradictions: Object.freeze(contradictions),
    unknown_fields: Object.freeze([...new Set(unknownFields)]),
    raven_verified: false,
  });
}

export function normalizeDexchToken(row = {}, {
  endpoint = "/api/v1/tokens",
  retrievedAt = new Date().toISOString(),
  responseDigest = null,
  nowMs = Date.now(),
} = {}) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  let config;
  let address;
  try {
    config = chainConfig(row.chain);
    address = normalizeAddress(config.chain, row.address);
  } catch {
    return null;
  }
  const symbol = cleanText(row.symbol, 32).toUpperCase() || "UNKNOWN";
  const decimals = optionalInteger(row.decimals, { minimum: 0, maximum: 255 });
  const createdAt = isoTimestamp(row.launchTime, nowMs);
  const migratedAt = isoTimestamp(row.migratedAt, nowMs);
  const lastActivityAt = isoTimestamp(row.lastActivityAt, nowMs);
  const txns24h = optionalInteger(row.txns24h, { minimum: 0 });
  const providerHolderCount = optionalInteger(row.holderCount, { minimum: 0 });
  const holderCount = providerHolderCount === 0 && (txns24h ?? 0) > 0 ? null : providerHolderCount;
  const providerTop10 = optionalNumber(row.top10Pct, { minimum: 0, maximum: 100 });
  const top10Pct = providerTop10 === 0 && holderCount === null ? null : providerTop10;
  const normalized = {
    schema_version: DEXCH_TOKEN_SCHEMA,
    provider: DEXCH_PROVIDER_ID,
    evidence_class: "DEXCH_REPORTED",
    provider_token_id: `${config.chain}:${address}`,
    canonical_identity: canonicalAsset(row, config.chain, address, symbol, decimals),
    chain: config.chain,
    chain_id: config.chain_id,
    address,
    symbol,
    name: cleanText(row.name, 100) || symbol,
    description: cleanText(row.description, 500) || null,
    image_url: safeHttpsUrl(row.imageUrl),
    creator_address: (() => {
      try {
        return row.creator ? normalizeAddress(config.chain, row.creator, "creator_address") : null;
      } catch {
        return null;
      }
    })(),
    market: Object.freeze({
      price_usd: optionalNumber(row.priceUsd, { minimum: 0 }),
      price_native: optionalNumber(row.priceNative, { minimum: 0 }),
      market_cap_usd: optionalNumber(row.marketCapUsd, { minimum: 0 }),
      fully_diluted_value_usd: optionalNumber(row.fdvUsd, { minimum: 0 }),
      liquidity_usd: optionalNumber(row.liquidityUsd, { minimum: 0 }),
      volume_5m_usd: optionalNumber(row.volume5mUsd, { minimum: 0 }),
      volume_1h_usd: optionalNumber(row.volume1hUsd, { minimum: 0 }),
      volume_6h_usd: optionalNumber(row.volume6hUsd, { minimum: 0 }),
      volume_24h_usd: optionalNumber(row.volume24hUsd, { minimum: 0 }),
      transactions_24h: txns24h,
      buys_24h: optionalInteger(row.buys24h, { minimum: 0 }),
      sells_24h: optionalInteger(row.sells24h, { minimum: 0 }),
      holder_count: holderCount,
      top_10_supply_pct: top10Pct,
      price_change_5m_pct: optionalNumber(row.priceChange5m),
      price_change_1h_pct: optionalNumber(row.priceChange1h),
      price_change_6h_pct: optionalNumber(row.priceChange6h),
      price_change_24h_pct: optionalNumber(row.priceChange24h),
      total_supply_raw: rawUnsignedInteger(row.totalSupply),
      circulating_supply_raw: rawUnsignedInteger(row.circulatingSupply),
    }),
    lifecycle: Object.freeze({
      state: lifecycleState(row, migratedAt),
      provider_status: cleanText(row.status, 40).toUpperCase() || null,
      provider_tier: cleanText(row.tier, 40).toUpperCase() || null,
      kind: cleanText(row.kind, 40).toUpperCase() || null,
      launchpad: cleanText(row.launchpad, 60) || null,
      created_at: createdAt,
      creation_time_semantics: "dexch_launch_time_undocumented",
      token_age_seconds: createdAt ? Math.max(0, Math.floor((nowMs - Date.parse(createdAt)) / 1_000)) : null,
      migrated_at: migratedAt,
      last_activity_at: lastActivityAt,
      progress_bps: optionalInteger(row.progressBps, { minimum: 0, maximum: 10_000 }),
      launch_transaction: cleanText(row.launchTx, 180) || null,
    }),
    venue: Object.freeze({
      pool_address: (() => {
        try {
          return row.poolAddress ? normalizeAddress(config.chain, row.poolAddress, "pool_address") : null;
        } catch {
          return null;
        }
      })(),
      dex_id: cleanText(row.dexId, 60).toLowerCase() || null,
      dex_type: cleanText(row.dexType, 40).toUpperCase() || null,
      quote_token_address: (() => {
        try {
          return row.quoteToken ? normalizeAddress(config.chain, row.quoteToken, "quote_address") : null;
        } catch {
          return null;
        }
      })(),
      quote_symbol: cleanText(row.quoteSymbol, 32).toUpperCase() || null,
    }),
    provider_claims: Object.freeze({
      risk: cleanText(row.risk, 40).toLowerCase() || null,
      risk_warning_count: optionalInteger(row.riskWarnings, { minimum: 0 }),
      safety_semantics: "undocumented_provider_claim_not_raven_verdict",
      dex_paid: typeof row.dexPaid === "boolean" ? row.dexPaid : null,
      dex_paid_semantics: "undocumented_provider_claim",
      has_socials: typeof row.hasSocials === "boolean" ? row.hasSocials : null,
      buy_tax_bps: optionalInteger(row.buyTaxBps, { minimum: 0, maximum: 10_000 }),
      sell_tax_bps: optionalInteger(row.sellTaxBps, { minimum: 0, maximum: 10_000 }),
      developer_supply_pct: optionalNumber(row.devPct, { minimum: 0, maximum: 100 }),
      bundler_supply_pct: optionalNumber(row.bundlerPct, { minimum: 0, maximum: 100 }),
      sniper_count: optionalInteger(row.sniperCount, { minimum: 0 }),
      boosts: optionalNumber(row.boosts, { minimum: 0 }),
    }),
    socials: Object.freeze({
      website_url: safeHttpsUrl(row.websiteUrl),
      twitter_url: safeHttpsUrl(row.twitterUrl),
      telegram_url: safeHttpsUrl(row.telegramUrl),
    }),
    provenance: Object.freeze({
      provider: DEXCH_PROVIDER_ID,
      endpoint: cleanText(endpoint, 240),
      retrieved_at: isoTimestamp(retrievedAt, nowMs) || new Date(nowMs).toISOString(),
      provider_observed_at: lastActivityAt,
      raw_response_sha256: cleanText(responseDigest, 64) || null,
      raw_payload_exposed: false,
      current_price_authority: false,
      execution_authority: false,
      wallet_pnl_authority: false,
      raven_verified: false,
    }),
  };
  normalized.quality = qualityForToken(row, normalized);
  return Object.freeze(normalized);
}

function publicBoundary() {
  return Object.freeze({
    research_only: true,
    affects_execution: false,
    transaction_construction: false,
    signing: false,
    order_submission: false,
    broadcast: false,
  });
}

function tokenEnvelope(rows, evidence, { nextCursor = null, kind = "tokens", state = "current" } = {}) {
  return Object.freeze({
    ok: true,
    safe_public: true,
    schema_version: DEXCH_DISCOVERY_SCHEMA,
    provider: DEXCH_PROVIDER_ID,
    provider_role: "replaceable_discovery_and_enrichment",
    state,
    generated_at: evidence.retrieved_at,
    result_kind: kind,
    row_count: rows.length,
    rows: Object.freeze(rows),
    next_cursor: nextCursor,
    provenance: Object.freeze({
      provider: DEXCH_PROVIDER_ID,
      endpoint: evidence.endpoint,
      retrieved_at: evidence.retrieved_at,
      response_bytes: evidence.response_bytes,
      raw_response_sha256: evidence.raw_response_sha256,
      authentication: "not_required_by_current_public_docs",
      rate_limit_contract: "UNKNOWN",
      commercial_use_rights: "UNKNOWN",
      raw_payload_exposed: false,
    }),
    execution_boundary: publicBoundary(),
  });
}

function addBoundedNumber(params, name, value) {
  if (value === null || value === undefined || value === "") return;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw providerError(`dexch_filter_${name}_invalid`, 400);
  params.set(name, String(parsed));
}

function cleanChains(values) {
  const source = Array.isArray(values) ? values : String(values || "").split(",");
  const chains = [...new Set(source.map((value) => cleanText(value, 32).toLowerCase()).filter(Boolean))];
  if (!chains.length || chains.some((chain) => !CHAIN_CONFIG[chain])) throw providerError("dexch_chains_invalid", 400);
  return chains;
}

export function dexchTokenSearchParams(filters = {}) {
  const params = new URLSearchParams();
  const chains = cleanChains(filters.chains || Object.keys(CHAIN_CONFIG));
  params.set("chains", chains.join(","));
  const preset = cleanText(filters.preset, 30).toLowerCase();
  if (preset) {
    if (!PRESETS.has(preset)) throw providerError("dexch_preset_invalid", 400);
    params.set("preset", preset);
  }
  const sort = cleanText(filters.sort || "trending", 30);
  if (!SORTS.has(sort)) throw providerError("dexch_sort_invalid", 400);
  params.set("sort", sort);
  const order = cleanText(filters.order || "desc", 8).toLowerCase();
  if (!new Set(["asc", "desc"]).has(order)) throw providerError("dexch_order_invalid", 400);
  params.set("order", order);
  const limit = optionalInteger(filters.limit ?? 50, { minimum: 1, maximum: 100 });
  if (limit === null) throw providerError("dexch_limit_invalid", 400);
  params.set("limit", String(limit));
  const search = cleanText(filters.search, 100);
  if (search) params.set("search", search);
  const cursor = cleanText(filters.cursor, 512);
  if (cursor) {
    if (!CURSOR_RE.test(cursor)) throw providerError("dexch_cursor_invalid", 400);
    params.set("cursor", cursor);
  }
  for (const [input, provider] of Object.entries(TOKEN_FILTERS)) addBoundedNumber(params, provider, filters[input]);
  for (const [input, provider] of [["has_socials", "hasSocials"], ["dex_paid", "dexPaid"], ["safe_only", "safeOnly"]]) {
    if (filters[input] === true || filters[input] === false) params.set(provider, String(filters[input]));
  }
  return params;
}

export function resolveDexchDiscoveryRuntime(env = {}) {
  const enabled = String(env.RAVENOS_DEXCH_DISCOVERY_ENABLED || "") === "1";
  const releaseEnforced = String(env.RAVENOS_RELEASE_ENFORCE || "") === "1";
  const commercialAcknowledged = String(env.RAVENOS_DEXCH_COMMERCIAL_USE_ACKNOWLEDGED || "") === "1";
  const runtimeAllowed = enabled && (!releaseEnforced || commercialAcknowledged);
  return Object.freeze({
    provider: DEXCH_PROVIDER_ID,
    enabled,
    runtime_allowed: runtimeAllowed,
    state: runtimeAllowed ? "enabled" : enabled ? "blocked" : "disabled",
    reason: runtimeAllowed
      ? null
      : enabled ? "dexch_commercial_use_rights_not_acknowledged" : "dexch_discovery_disabled",
    base_url: DEXCH_PROVIDER_BASE_URL,
    authentication: "none",
    commercial_use_rights: commercialAcknowledged ? "operator_acknowledged" : "UNKNOWN",
    execution_authority: false,
  });
}

export class DexchDiscoveryProvider {
  constructor({ fetchFn = globalThis.fetch, now = () => Date.now(), maximumResponseBytes = MAX_RESPONSE_BYTES } = {}) {
    if (typeof fetchFn !== "function") throw new TypeError("dexch_fetch_required");
    this.fetchFn = fetchFn;
    this.now = now;
    this.maximumResponseBytes = Math.max(1_024, Math.min(MAX_RESPONSE_BYTES, Number(maximumResponseBytes) || MAX_RESPONSE_BYTES));
    this.cache = new Map();
    this.inflight = new Map();
    this.health = { last_success_at: null, last_error_at: null, last_error_code: null, request_count: 0 };
  }

  healthSnapshot() {
    return Object.freeze({
      schema_version: "ravenos.provider_health.dexch.v1",
      provider: DEXCH_PROVIDER_ID,
      state: this.health.last_error_at && !this.health.last_success_at ? "unavailable" : this.health.last_error_code ? "degraded" : this.health.last_success_at ? "healthy" : "unknown",
      ...this.health,
      cache_entries: this.cache.size,
      inflight_requests: this.inflight.size,
    });
  }

  async request(path, { ttlMs = 15_000, timeoutMs = 5_000 } = {}) {
    if (!String(path || "").startsWith("/api/v1/")) throw providerError("dexch_path_invalid", 500);
    const url = new URL(path, DEXCH_PROVIDER_BASE_URL);
    if (url.origin !== DEXCH_PROVIDER_BASE_URL) throw providerError("dexch_origin_invalid", 500);
    const key = url.toString();
    const cached = this.cache.get(key);
    if (cached && cached.expires_at > this.now()) return cached.value;
    if (this.inflight.has(key)) return this.inflight.get(key);
    const operation = this.fetchBounded(url, { timeoutMs })
      .then((value) => {
        this.cache.set(key, { value, expires_at: this.now() + Math.max(0, ttlMs) });
        while (this.cache.size > MAX_CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value);
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, operation);
    return operation;
  }

  async fetchBounded(url, { timeoutMs = 5_000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(250, Math.min(10_000, timeoutMs)));
    this.health.request_count += 1;
    try {
      const response = await this.fetchFn(url.toString(), {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response?.ok) throw providerError(`dexch_http_${response?.status || 502}`, response?.status || 502);
      const declared = Number(response.headers?.get?.("content-length") || 0);
      if (declared > this.maximumResponseBytes) throw providerError("dexch_payload_too_large", 502);
      const body = await response.text();
      const responseBytes = byteLength(body);
      if (responseBytes > this.maximumResponseBytes) throw providerError("dexch_payload_too_large", 502);
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        throw providerError("dexch_invalid_json", 502);
      }
      if (!payload || typeof payload !== "object" || !("data" in payload)) throw providerError("dexch_invalid_envelope", 502);
      const retrievedAt = new Date(this.now()).toISOString();
      const evidence = Object.freeze({
        endpoint: `${url.pathname}${url.search}`,
        retrieved_at: retrievedAt,
        response_bytes: responseBytes,
        raw_response_sha256: await sha256Hex(body),
      });
      this.health.last_success_at = retrievedAt;
      this.health.last_error_code = null;
      return Object.freeze({ payload, evidence });
    } catch (error) {
      const code = controller.signal.aborted ? "dexch_timeout" : cleanText(error?.code || error?.message, 100) || "dexch_unavailable";
      this.health.last_error_at = new Date(this.now()).toISOString();
      this.health.last_error_code = code;
      throw providerError(code, Number(error?.status) || 502);
    } finally {
      clearTimeout(timer);
    }
  }

  async tokens(filters = {}) {
    const params = dexchTokenSearchParams(filters);
    const { payload, evidence } = await this.request(`/api/v1/tokens?${params}`, { ttlMs: 15_000 });
    const rows = (Array.isArray(payload.data) ? payload.data : [])
      .map((row) => normalizeDexchToken(row, {
        endpoint: evidence.endpoint,
        retrievedAt: evidence.retrieved_at,
        responseDigest: evidence.raw_response_sha256,
        nowMs: this.now(),
      }))
      .filter(Boolean)
      .slice(0, Number(params.get("limit")));
    return tokenEnvelope(rows, evidence, {
      nextCursor: CURSOR_RE.test(String(payload.nextCursor || "")) ? payload.nextCursor : null,
    });
  }

  async feed(name, { chains = Object.keys(CHAIN_CONFIG), limit = 50, offset = 0 } = {}) {
    const feed = cleanText(name, 30).toLowerCase();
    if (!FEEDS.has(feed)) throw providerError("dexch_feed_invalid", 400);
    const normalizedChains = cleanChains(chains);
    const normalizedLimit = optionalInteger(limit, { minimum: 1, maximum: 100 });
    const normalizedOffset = optionalInteger(offset, { minimum: 0, maximum: 10_000 });
    if (normalizedLimit === null || normalizedOffset === null) throw providerError("dexch_feed_range_invalid", 400);
    const params = new URLSearchParams({ chains: normalizedChains.join(","), limit: String(normalizedLimit), offset: String(normalizedOffset) });
    const { payload, evidence } = await this.request(`/api/v1/feeds/${feed}?${params}`, { ttlMs: 10_000 });
    const rows = (Array.isArray(payload.data) ? payload.data : [])
      .map((row) => normalizeDexchToken(row, {
        endpoint: evidence.endpoint,
        retrievedAt: evidence.retrieved_at,
        responseDigest: evidence.raw_response_sha256,
        nowMs: this.now(),
      }))
      .filter(Boolean)
      .slice(0, normalizedLimit);
    return tokenEnvelope(rows, evidence, { kind: `feed:${feed}` });
  }

  async batch(keys = []) {
    const normalized = [];
    const seen = new Set();
    for (const item of Array.isArray(keys) ? keys : []) {
      const config = chainConfig(item?.chain);
      const address = normalizeAddress(config.chain, item?.address);
      const key = `${config.chain}:${address}`;
      if (!seen.has(key)) normalized.push(key);
      seen.add(key);
      if (normalized.length >= 100) break;
    }
    if (!normalized.length) throw providerError("dexch_batch_keys_required", 400);
    const params = new URLSearchParams({ keys: normalized.join(",") });
    const { payload, evidence } = await this.request(`/api/v1/tokens/batch?${params}`, { ttlMs: 15_000 });
    const rows = (Array.isArray(payload.data) ? payload.data : [])
      .map((row) => normalizeDexchToken(row, {
        endpoint: evidence.endpoint,
        retrievedAt: evidence.retrieved_at,
        responseDigest: evidence.raw_response_sha256,
        nowMs: this.now(),
      }))
      .filter(Boolean);
    return tokenEnvelope(rows, evidence, { kind: "batch" });
  }

  async token(chain, address) {
    const config = chainConfig(chain);
    const normalizedAddress = normalizeAddress(config.chain, address);
    const path = `/api/v1/tokens/${encodeURIComponent(config.chain)}/${encodeURIComponent(normalizedAddress)}`;
    const { payload, evidence } = await this.request(path, { ttlMs: 30_000 });
    const token = normalizeDexchToken(payload.data, {
      endpoint: evidence.endpoint,
      retrievedAt: evidence.retrieved_at,
      responseDigest: evidence.raw_response_sha256,
      nowMs: this.now(),
    });
    if (!token || token.chain !== config.chain || token.address !== normalizedAddress) throw providerError("dexch_token_identity_mismatch", 502);
    return tokenEnvelope([token], evidence, { kind: "token_detail" });
  }

  async holders(chain, address, { limit = 20 } = {}) {
    const config = chainConfig(chain);
    const normalizedAddress = normalizeAddress(config.chain, address);
    const normalizedLimit = optionalInteger(limit, { minimum: 1, maximum: 100 });
    if (normalizedLimit === null) throw providerError("dexch_holder_limit_invalid", 400);
    const path = `/api/v1/tokens/${encodeURIComponent(config.chain)}/${encodeURIComponent(normalizedAddress)}/holders?limit=${normalizedLimit}`;
    const { payload, evidence } = await this.request(path, { ttlMs: 60_000 });
    const contradictions = [];
    const rows = (Array.isArray(payload.data) ? payload.data : []).slice(0, normalizedLimit).map((row, index) => {
      let holderAddress = null;
      try {
        holderAddress = normalizeAddress(config.chain, row?.address, "holder_address");
      } catch {
        return null;
      }
      const providerPct = optionalNumber(row?.pct);
      const pct = optionalNumber(row?.pct, { minimum: 0, maximum: 100 });
      if (providerPct !== null && pct === null) contradictions.push(`holder_${index + 1}_percentage_out_of_range`);
      return Object.freeze({
        rank: index + 1,
        address: holderAddress,
        balance: optionalNumber(row?.balance, { minimum: 0 }),
        supply_pct: pct,
        provider_creator_label: row?.isCreator === true,
        provider_sniper_label: row?.isSniper === true,
        labels_raven_verified: false,
      });
    }).filter(Boolean);
    return Object.freeze({
      ok: true,
      safe_public: true,
      schema_version: DEXCH_HOLDERS_SCHEMA,
      provider: DEXCH_PROVIDER_ID,
      chain: config.chain,
      chain_id: config.chain_id,
      token_address: normalizedAddress,
      rows: Object.freeze(rows),
      coverage: Object.freeze({
        scope: "provider_top_n",
        requested_limit: normalizedLimit,
        returned_rows: rows.length,
        complete_census: false,
        top_n_supply_coverage_pct: null,
      }),
      quality: Object.freeze({ state: contradictions.length ? "contradictory" : rows.length ? "provider_reported" : "unavailable", contradictions: Object.freeze(contradictions) }),
      provenance: Object.freeze({ ...evidence, provider: DEXCH_PROVIDER_ID, raw_payload_exposed: false, raven_verified: false }),
      execution_boundary: publicBoundary(),
    });
  }

  async trades(chain, address, { limit = 50, before = null } = {}) {
    const config = chainConfig(chain);
    const normalizedAddress = normalizeAddress(config.chain, address);
    const normalizedLimit = optionalInteger(limit, { minimum: 1, maximum: 200 });
    if (normalizedLimit === null) throw providerError("dexch_trade_limit_invalid", 400);
    const params = new URLSearchParams({ limit: String(normalizedLimit) });
    const beforeIso = before ? isoTimestamp(before, this.now()) : null;
    if (before && !beforeIso) throw providerError("dexch_trade_before_invalid", 400);
    if (beforeIso) params.set("before", beforeIso);
    const path = `/api/v1/tokens/${encodeURIComponent(config.chain)}/${encodeURIComponent(normalizedAddress)}/trades?${params}`;
    const { payload, evidence } = await this.request(path, { ttlMs: 2_000 });
    const rows = (Array.isArray(payload.data) ? payload.data : []).slice(0, normalizedLimit).map((row) => {
      const observedAt = isoTimestamp(row?.timestamp, this.now());
      const side = cleanText(row?.side, 10).toLowerCase();
      if (!observedAt || !new Set(["buy", "sell"]).has(side)) return null;
      return Object.freeze({
        provider_trade_id: cleanText(row?.id, 200) || null,
        transaction_hash: cleanText(row?.txHash, 180) || null,
        trader_address: (() => {
          try {
            return normalizeAddress(config.chain, row?.trader, "trader_address");
          } catch {
            return null;
          }
        })(),
        side,
        source: cleanText(row?.source, 60) || null,
        token_amount: optionalNumber(row?.amountToken, { minimum: 0 }),
        quote_amount: optionalNumber(row?.amountQuote, { minimum: 0 }),
        price_usd: optionalNumber(row?.priceUsd, { minimum: 0 }),
        volume_usd: optionalNumber(row?.volumeUsd, { minimum: 0 }),
        observed_at: observedAt,
      });
    }).filter(Boolean);
    return Object.freeze({
      ok: true,
      safe_public: true,
      schema_version: DEXCH_TRADES_SCHEMA,
      provider: DEXCH_PROVIDER_ID,
      chain: config.chain,
      chain_id: config.chain_id,
      token_address: normalizedAddress,
      rows: Object.freeze(rows),
      completeness: "provider_level_unknown",
      provenance: Object.freeze({ ...evidence, provider: DEXCH_PROVIDER_ID, raw_payload_exposed: false, raven_verified: false }),
      execution_boundary: publicBoundary(),
    });
  }

  async candles(chain, address, { timeframe = "5m", limit = 240 } = {}) {
    const config = chainConfig(chain);
    const normalizedAddress = normalizeAddress(config.chain, address);
    const normalizedTimeframe = cleanText(timeframe, 8);
    const normalizedLimit = optionalInteger(limit, { minimum: 1, maximum: 1_000 });
    if (!TIMEFRAMES.has(normalizedTimeframe) || normalizedLimit === null) throw providerError("dexch_candle_request_invalid", 400);
    const path = `/api/v1/tokens/${encodeURIComponent(config.chain)}/${encodeURIComponent(normalizedAddress)}/candles?timeframe=${normalizedTimeframe}&limit=${normalizedLimit}`;
    const { payload, evidence } = await this.request(path, { ttlMs: 10_000 });
    const rows = (Array.isArray(payload.data) ? payload.data : []).slice(0, normalizedLimit).map((row) => {
      const time = optionalInteger(row?.time, { minimum: 1 });
      const open = optionalNumber(row?.open, { minimum: 0 });
      const high = optionalNumber(row?.high, { minimum: 0 });
      const low = optionalNumber(row?.low, { minimum: 0 });
      const close = optionalNumber(row?.close, { minimum: 0 });
      if (!time || !(open > 0) || !(high > 0) || !(low > 0) || !(close > 0)) return null;
      return Object.freeze({
        time,
        open,
        high: Math.max(open, high, low, close),
        low: Math.min(open, high, low, close),
        close,
        volume: optionalNumber(row?.volume, { minimum: 0 }),
      });
    }).filter(Boolean).sort((left, right) => left.time - right.time);
    return Object.freeze({
      ok: true,
      safe_public: true,
      schema_version: DEXCH_CANDLES_SCHEMA,
      provider: DEXCH_PROVIDER_ID,
      role: "fallback_ohlcv_enrichment",
      chain: config.chain,
      chain_id: config.chain_id,
      token_address: normalizedAddress,
      timeframe: normalizedTimeframe,
      rows: Object.freeze(rows),
      historical_retention: "UNKNOWN",
      provenance: Object.freeze({ ...evidence, provider: DEXCH_PROVIDER_ID, raw_payload_exposed: false, raven_verified: false }),
      execution_boundary: publicBoundary(),
    });
  }
}

export function dexchLifecycleEnrichment(token, { nowMs = Date.now() } = {}) {
  if (!token || token.schema_version !== DEXCH_TOKEN_SCHEMA) return null;
  const createdAt = isoTimestamp(token.lifecycle?.created_at, nowMs);
  const migratedAt = isoTimestamp(token.lifecycle?.migrated_at, nowMs);
  return Object.freeze({
    schema_version: "ravenos.token_lifecycle.dexch.v1",
    provider: DEXCH_PROVIDER_ID,
    evidence_class: "DEXCH_REPORTED",
    canonical_asset_id: token.canonical_identity?.asset_id || null,
    chain_id: token.chain_id,
    token_address: token.address,
    state: token.lifecycle?.state || "DISCOVERED",
    created_at: createdAt,
    creation_time_semantics: token.lifecycle?.creation_time_semantics || "UNKNOWN",
    token_age_seconds: createdAt ? Math.max(0, Math.floor((nowMs - Date.parse(createdAt)) / 1_000)) : null,
    migrated_at: migratedAt,
    launchpad: token.lifecycle?.launchpad || null,
    progress_bps: token.lifecycle?.progress_bps ?? null,
    dex_paid: token.provider_claims?.dex_paid ?? null,
    dex_paid_semantics: token.provider_claims?.dex_paid_semantics || "UNKNOWN",
    observed_at: token.provenance?.retrieved_at || new Date(nowMs).toISOString(),
    raven_verified: false,
    execution_authority: false,
    quality: token.quality,
  });
}

export function dexchWalletEntryContext(token, {
  entryObservedAt,
  maximumObservationDistanceSeconds = 120,
  nowMs = Date.now(),
} = {}) {
  const entryAt = isoTimestamp(entryObservedAt, nowMs);
  const providerObservedAt = isoTimestamp(token?.provenance?.retrieved_at, nowMs);
  const maximumDistance = optionalInteger(maximumObservationDistanceSeconds, { minimum: 1, maximum: 3_600 });
  const validToken = token?.schema_version === DEXCH_TOKEN_SCHEMA;
  const distanceSeconds = entryAt && providerObservedAt
    ? Math.abs(Date.parse(entryAt) - Date.parse(providerObservedAt)) / 1_000
    : null;
  const contemporaneous = validToken
    && maximumDistance !== null
    && distanceSeconds !== null
    && distanceSeconds <= maximumDistance;
  const createdAt = contemporaneous ? isoTimestamp(token.lifecycle?.created_at, nowMs) : null;
  const createdBeforeEntry = createdAt && Date.parse(createdAt) <= Date.parse(entryAt);
  const tokenAgeAtEntry = createdBeforeEntry
    ? Math.max(0, Math.floor((Date.parse(entryAt) - Date.parse(createdAt)) / 1_000))
    : null;
  const contradictions = [
    ...(Array.isArray(token?.quality?.contradictions) ? token.quality.contradictions : []),
    ...(contemporaneous && createdAt && !createdBeforeEntry ? ["provider_creation_after_wallet_entry"] : []),
  ];
  return Object.freeze({
    schema_version: "ravenos.wallet_entry_market_context.dexch.v1",
    state: contemporaneous ? "provider_reported" : "unavailable",
    reason: contemporaneous
      ? null
      : !validToken ? "invalid_provider_token"
        : !entryAt ? "wallet_entry_time_unavailable"
          : !providerObservedAt ? "provider_observation_time_unavailable"
            : "no_contemporaneous_provider_observation",
    canonical_asset_id: validToken ? token.canonical_identity?.asset_id || null : null,
    chain_id: validToken ? token.chain_id : null,
    token_address: validToken ? token.address : null,
    entry_observed_at: entryAt,
    provider_observed_at: providerObservedAt,
    observation_distance_seconds: distanceSeconds,
    maximum_observation_distance_seconds: maximumDistance,
    token_age_at_entry_seconds: contemporaneous ? tokenAgeAtEntry : null,
    market_cap_at_entry_usd: contemporaneous ? token.market?.market_cap_usd ?? null : null,
    liquidity_at_entry_usd: contemporaneous ? token.market?.liquidity_usd ?? null : null,
    lifecycle_state_at_entry: contemporaneous ? token.lifecycle?.state || null : null,
    bonding_progress_at_entry_bps: contemporaneous ? token.lifecycle?.progress_bps ?? null : null,
    launchpad_at_entry: contemporaneous ? token.lifecycle?.launchpad || null : null,
    historical_value_claimed: contemporaneous,
    current_value_substituted_for_history: false,
    evidence_class: "DEXCH_REPORTED",
    raven_verified: false,
    execution_authority: false,
    contradictions: Object.freeze([...new Set(contradictions)]),
  });
}

export function dexchLifecycleTransitionEvents(previousToken, currentToken) {
  if (currentToken?.schema_version !== DEXCH_TOKEN_SCHEMA) return Object.freeze([]);
  if (
    previousToken
    && (
      previousToken.schema_version !== DEXCH_TOKEN_SCHEMA
      || previousToken.provider_token_id !== currentToken.provider_token_id
    )
  ) return Object.freeze([]);
  const prior = previousToken || {};
  const currentLifecycle = currentToken.lifecycle || {};
  const priorLifecycle = prior.lifecycle || {};
  const observedAt = currentToken.provenance?.retrieved_at || null;
  const base = {
    schema_version: "ravenos.token_lifecycle_event.dexch.v1",
    provider: DEXCH_PROVIDER_ID,
    evidence_class: "DEXCH_REPORTED",
    provider_token_id: currentToken.provider_token_id,
    canonical_asset_id: currentToken.canonical_identity?.asset_id || null,
    chain_id: currentToken.chain_id,
    token_address: currentToken.address,
    observed_at: observedAt,
    raven_verified: false,
    execution_authority: false,
  };
  const events = [];
  if (!previousToken && currentLifecycle.created_at) events.push(Object.freeze({
    ...base,
    event_id: `${currentToken.provider_token_id}:created:${currentLifecycle.created_at}`,
    type: "TOKEN_CREATED",
    event_at: currentLifecycle.created_at,
    event_time_semantics: currentLifecycle.creation_time_semantics || "UNKNOWN",
  }));
  if (currentLifecycle.migrated_at && currentLifecycle.migrated_at !== priorLifecycle.migrated_at) events.push(Object.freeze({
    ...base,
    event_id: `${currentToken.provider_token_id}:migrated:${currentLifecycle.migrated_at}`,
    type: "TOKEN_MIGRATED",
    event_at: currentLifecycle.migrated_at,
    event_time_semantics: "dexch_reported_migration_time",
  }));
  const priorProgress = optionalInteger(priorLifecycle.progress_bps, { minimum: 0, maximum: 10_000 });
  const currentProgress = optionalInteger(currentLifecycle.progress_bps, { minimum: 0, maximum: 10_000 });
  if (currentProgress !== null && currentProgress >= 9_000 && (priorProgress === null || priorProgress < 9_000)) events.push(Object.freeze({
    ...base,
    event_id: `${currentToken.provider_token_id}:near-graduation:${observedAt}`,
    type: "TOKEN_NEAR_GRADUATION",
    event_at: observedAt,
    event_time_semantics: "provider_observation_time",
    progress_bps: currentProgress,
  }));
  if (currentToken.provider_claims?.dex_paid === true && prior.provider_claims?.dex_paid !== true) events.push(Object.freeze({
    ...base,
    event_id: `${currentToken.provider_token_id}:dex-paid-observed:${observedAt}`,
    type: "DEX_PAID_REPORTED",
    event_at: observedAt,
    event_time_semantics: "first_raven_observation_not_payment_time",
  }));
  return Object.freeze(events);
}

export function dexchProviderChains() {
  return Object.freeze(Object.entries(CHAIN_CONFIG).map(([chain, config]) => Object.freeze({
    chain,
    chain_id: config.chain_id,
    label: config.label,
  })));
}
