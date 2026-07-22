export const RAVENOS_INSTRUMENT_SCHEMA = "ravenos.instrument.v1";
export const RAVENOS_INSTRUMENT_SELECTION_SCHEMA = "ravenos.instrument_selection.v1";

export const AssetClasses = Object.freeze({
  CRYPTO: "crypto",
  EQUITY: "equity",
  ETF: "etf",
  OPTION: "option",
  INDEX: "index",
  SECTOR: "sector",
  MACRO: "macro",
});

export const InstrumentTypes = Object.freeze({
  TOKEN: "token",
  EXACT_POOL: "exact_pool",
  PERPETUAL: "perpetual",
  EQUITY: "equity",
  ETF: "etf",
  OPTION: "option",
  INDEX: "index",
  SECTOR: "sector",
  MACRO_SERIES: "macro_series",
});

const ASSET_CLASSES = new Set(Object.values(AssetClasses));
const INSTRUMENT_TYPES = new Set(Object.values(InstrumentTypes));
const OPTION_RIGHTS = new Set(["call", "put"]);

function text(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function lower(value, fallback = "") {
  return text(value, fallback).toLowerCase();
}

function upper(value, fallback = "") {
  return text(value, fallback).toUpperCase();
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanIdentityPart(value, fallback = "unknown") {
  return lower(value, fallback).replace(/[^a-z0-9._:-]+/g, "-");
}

function inferAssetClass(type) {
  if ([InstrumentTypes.TOKEN, InstrumentTypes.EXACT_POOL, InstrumentTypes.PERPETUAL].includes(type)) return AssetClasses.CRYPTO;
  if (type === InstrumentTypes.ETF) return AssetClasses.ETF;
  if (type === InstrumentTypes.OPTION) return AssetClasses.OPTION;
  if (type === InstrumentTypes.INDEX) return AssetClasses.INDEX;
  if (type === InstrumentTypes.SECTOR) return AssetClasses.SECTOR;
  if (type === InstrumentTypes.MACRO_SERIES) return AssetClasses.MACRO;
  return AssetClasses.EQUITY;
}

function inferInstrumentType(input = {}) {
  const explicit = lower(input.instrument_type || input.instrumentType || input.type);
  if (INSTRUMENT_TYPES.has(explicit)) return explicit;
  if (input.option || input.expiry || input.expiration || input.strike || input.right) return InstrumentTypes.OPTION;
  if (input.pool_address || input.poolAddress || input.pair_address || input.pairAddress) return InstrumentTypes.EXACT_POOL;
  if (lower(input.market_type || input.marketType).includes("perp")) return InstrumentTypes.PERPETUAL;
  const assetClass = lower(input.asset_class || input.assetClass);
  if (assetClass === AssetClasses.ETF) return InstrumentTypes.ETF;
  if (assetClass === AssetClasses.INDEX) return InstrumentTypes.INDEX;
  if (assetClass === AssetClasses.MACRO) return InstrumentTypes.MACRO_SERIES;
  if (assetClass === AssetClasses.CRYPTO) return InstrumentTypes.TOKEN;
  return InstrumentTypes.EQUITY;
}

function optionIdentity(input = {}) {
  const option = input.option && typeof input.option === "object" ? input.option : input;
  const right = lower(option.right || option.option_right || option.put_call);
  const expiry = text(option.expiry || option.expiration || option.expiration_date);
  const strike = finite(option.strike);
  return {
    occ_symbol: upper(option.occ_symbol || option.contract_symbol),
    expiry,
    strike,
    right: OPTION_RIGHTS.has(right) ? right : "unknown",
    multiplier: finite(option.multiplier) || 100,
    exercise_style: lower(option.exercise_style, "unknown"),
  };
}

export function canonicalInstrumentId(input = {}) {
  const type = inferInstrumentType(input);
  const explicit = text(input.instrument_id || input.instrumentId || input.canonical_id || input.canonicalId);
  if (explicit) return explicit;
  const venue = cleanIdentityPart(input.venue || input.exchange || input.broker, "unknown");
  const chain = cleanIdentityPart(input.chain, type === InstrumentTypes.PERPETUAL ? venue : "none");
  const symbol = cleanIdentityPart(input.symbol || input.asset || input.ticker, "unknown").replace(/-perp$/, "");
  const quote = cleanIdentityPart(input.quote_asset?.symbol || input.quote_asset || input.quoteAsset, type === InstrumentTypes.PERPETUAL ? "usd" : "unknown");
  if (type === InstrumentTypes.EXACT_POOL) {
    const pool = cleanIdentityPart(input.pool_address || input.poolAddress || input.pair_address || input.pairAddress, "missing-pool");
    return `crypto:pool:${chain}:${venue}:${pool}`;
  }
  if (type === InstrumentTypes.TOKEN) {
    const token = cleanIdentityPart(input.token_address || input.tokenAddress || input.contract_address || input.contractAddress || symbol);
    return `crypto:token:${chain}:${token}`;
  }
  if (type === InstrumentTypes.PERPETUAL) return `${venue}:perp:${symbol.toUpperCase()}`;
  if (type === InstrumentTypes.OPTION) {
    const option = optionIdentity(input);
    const underlying = cleanIdentityPart(input.underlying_instrument_id || input.underlyingInstrumentId || input.underlying || symbol);
    const contract = option.occ_symbol || [underlying, option.expiry || "unknown-expiry", option.right, option.strike ?? "unknown-strike"].join(":");
    return `option:${venue}:${contract}`;
  }
  if (type === InstrumentTypes.MACRO_SERIES) return `macro:${venue}:${symbol}`;
  return `${type}:${venue}:${symbol}`;
}

function defaultNumeraire(assetClass) {
  return assetClass === AssetClasses.CRYPTO ? "USDC" : "USD";
}

function normalizeCapabilities(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return Object.freeze({
    chart: Boolean(source.chart),
    live_price: Boolean(source.live_price),
    book: Boolean(source.book),
    tape: Boolean(source.tape),
    funding: Boolean(source.funding),
    open_interest: Boolean(source.open_interest),
    options_chain: Boolean(source.options_chain),
    raven_intelligence: Boolean(source.raven_intelligence),
    atlas_intelligence: Boolean(source.atlas_intelligence),
    participant_context: Boolean(source.participant_context),
    quote_preview: Boolean(source.quote_preview),
    execution: Boolean(source.execution),
    portfolio_valuation: Boolean(source.portfolio_valuation),
  });
}

export function normalizeInstrument(input = {}) {
  const instrumentType = inferInstrumentType(input);
  const inferredClass = inferAssetClass(instrumentType);
  const assetClass = inferredClass;
  const venue = lower(input.venue || input.exchange || input.broker, "unknown");
  const chain = lower(input.chain, assetClass === AssetClasses.CRYPTO ? (venue || "unknown") : "none");
  const baseSymbol = upper(input.base_asset?.symbol || input.baseAsset || input.symbol || input.asset || input.ticker, "UNKNOWN").replace(/-PERP$/, "");
  const quoteSymbol = upper(input.quote_asset?.symbol || input.quoteAsset || input.quote_asset, instrumentType === InstrumentTypes.PERPETUAL ? "USD" : "UNKNOWN");
  const settlementSymbol = upper(input.settlement_asset?.symbol || input.settlementAsset || input.settlement_asset, assetClass === AssetClasses.CRYPTO ? quoteSymbol : "USD");
  const preferredCashSymbol = upper(
    input.preferred_cash_asset?.symbol || input.preferredCashAsset?.symbol || input.preferredCashAsset || input.preferred_cash_asset,
    assetClass === AssetClasses.CRYPTO ? "USDC" : settlementSymbol,
  );
  const option = instrumentType === InstrumentTypes.OPTION ? optionIdentity(input) : null;
  const identityScope = instrumentType === InstrumentTypes.EXACT_POOL
    ? "exact_pool"
    : instrumentType === InstrumentTypes.TOKEN
      ? "token_aggregate"
      : "exact_instrument";
  const instrument = {
    schema_version: RAVENOS_INSTRUMENT_SCHEMA,
    instrument_id: canonicalInstrumentId(input),
    symbol: instrumentType === InstrumentTypes.PERPETUAL ? `${baseSymbol}-PERP` : baseSymbol,
    display_name: text(input.display_name || input.displayName || input.name, instrumentType === InstrumentTypes.PERPETUAL ? `${baseSymbol} Perpetual` : baseSymbol),
    asset_class: assetClass,
    instrument_type: instrumentType,
    identity_scope: identityScope,
    venue,
    chain,
    market_identity: {
      market_id: text(input.market_id || input.marketId || input.contract_id || input.contractId) || null,
      listing: text(input.listing || input.exchange_listing) || null,
      token_address: text(input.token_address || input.tokenAddress || input.contract_address || input.contractAddress) || null,
      pool_address: text(input.pool_address || input.poolAddress || input.pair_address || input.pairAddress) || null,
      option,
    },
    underlying_instrument_id: text(input.underlying_instrument_id || input.underlyingInstrumentId) || null,
    base_asset: { symbol: baseSymbol, asset_id: text(input.base_asset?.asset_id || input.baseAssetId, baseSymbol) },
    quote_asset: { symbol: quoteSymbol, asset_id: text(input.quote_asset?.asset_id || input.quoteAssetId, quoteSymbol) },
    settlement_asset: { symbol: settlementSymbol, asset_id: text(input.settlement_asset?.asset_id || input.settlementAssetId, settlementSymbol) },
    preferred_cash_asset: {
      symbol: preferredCashSymbol,
      asset_id: text(input.preferred_cash_asset?.asset_id || input.preferredCashAsset?.asset_id || input.preferredCashAssetId, preferredCashSymbol),
    },
    economic_numeraire: upper(input.economic_numeraire || input.economicNumeraire, defaultNumeraire(assetClass)),
    chart_source: text(input.chart_source || input.chartSource, "unavailable"),
    market_session: {
      state: lower(input.market_session?.state || input.session_state || input.sessionState, assetClass === AssetClasses.CRYPTO ? "continuous" : "unknown"),
      timezone: text(input.market_session?.timezone || input.session_timezone, assetClass === AssetClasses.CRYPTO ? "UTC" : "America/New_York"),
      observed_at: text(input.market_session?.observed_at || input.session_observed_at) || null,
    },
    capabilities: normalizeCapabilities(input.capabilities),
    freshness: {
      state: lower(input.freshness?.state || input.freshness_state, "unavailable"),
      observed_at: text(input.freshness?.observed_at || input.observed_at || input.generated_at) || null,
      source: text(input.freshness?.source || input.source || input.provider, "unavailable"),
    },
    entitlement: {
      level: lower(input.entitlement?.level || input.entitlement_level, "public"),
      server_enforced: Boolean(input.entitlement?.server_enforced || input.entitlement_server_enforced),
    },
    route_compatibility: Array.isArray(input.route_compatibility) ? [...new Set(input.route_compatibility.map((value) => lower(value)).filter(Boolean))] : [],
    account_compatibility: Array.isArray(input.account_compatibility) ? [...new Set(input.account_compatibility.map((value) => lower(value)).filter(Boolean))] : [],
  };
  return Object.freeze(instrument);
}

export function validateInstrument(value = {}) {
  const instrument = normalizeInstrument(value);
  const errors = [];
  const declaredAssetClass = lower(value.asset_class || value.assetClass);
  if (ASSET_CLASSES.has(declaredAssetClass) && declaredAssetClass !== inferAssetClass(instrument.instrument_type)) {
    errors.push("asset_class_incompatible");
  }
  if (!instrument.instrument_id || instrument.instrument_id.includes("missing-pool")) errors.push("exact_identity_missing");
  if (instrument.instrument_type === InstrumentTypes.EXACT_POOL && !instrument.market_identity.pool_address) errors.push("pool_address_required");
  if (instrument.instrument_type === InstrumentTypes.OPTION) {
    if (!instrument.underlying_instrument_id) errors.push("option_underlying_required");
    if (!instrument.market_identity.option?.expiry) errors.push("option_expiry_required");
    if (!OPTION_RIGHTS.has(instrument.market_identity.option?.right)) errors.push("option_right_required");
    if (!(instrument.market_identity.option?.strike > 0)) errors.push("option_strike_required");
  }
  if (instrument.instrument_type === InstrumentTypes.PERPETUAL && instrument.venue === "unknown") errors.push("perpetual_venue_required");
  return { ok: errors.length === 0, instrument, errors };
}

export function resolveInstrumentSelection(candidates = [], selection = {}) {
  const instruments = candidates.map(normalizeInstrument);
  const requestedId = text(selection.instrument_id || selection.instrumentId || selection.canonical_id);
  if (requestedId) {
    const exact = instruments.find((instrument) => instrument.instrument_id === requestedId);
    return exact
      ? { schema_version: RAVENOS_INSTRUMENT_SELECTION_SCHEMA, state: "resolved", instrument: exact, candidates: [exact], exact: true }
      : { schema_version: RAVENOS_INSTRUMENT_SELECTION_SCHEMA, state: "not_found", instrument: null, candidates: [], exact: true };
  }
  const symbol = upper(selection.symbol || selection.asset || selection.query);
  const matches = instruments.filter((instrument) => instrument.symbol === symbol || instrument.symbol.replace(/-PERP$/, "") === symbol.replace(/-PERP$/, ""));
  if (matches.length === 1) return { schema_version: RAVENOS_INSTRUMENT_SELECTION_SCHEMA, state: "resolved", instrument: matches[0], candidates: matches, exact: false };
  return {
    schema_version: RAVENOS_INSTRUMENT_SELECTION_SCHEMA,
    state: matches.length > 1 ? "ambiguous" : "not_found",
    instrument: null,
    candidates: matches,
    exact: false,
  };
}
