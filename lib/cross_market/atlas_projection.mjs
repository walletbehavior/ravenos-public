export const RAVENOS_ATLAS_PROJECTION_SCHEMA = "ravenos.atlas_projection.v1";

function text(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isoFromSeconds(value) {
  const seconds = finite(value);
  if (seconds === null) return null;
  return new Date(seconds * 1000).toISOString();
}

function ageSeconds(observedAt, nowMs) {
  const parsed = Date.parse(observedAt || "");
  return Number.isFinite(parsed) ? Math.max(0, Math.round((nowMs - parsed) / 1000)) : null;
}

function freshness(observedAt, targetSeconds, nowMs) {
  const age = ageSeconds(observedAt, nowMs);
  if (age === null) return { state: "unavailable", age_seconds: null, target_seconds: targetSeconds };
  if (age <= targetSeconds) return { state: "fresh", age_seconds: age, target_seconds: targetSeconds };
  if (age <= targetSeconds * 4) return { state: "delayed", age_seconds: age, target_seconds: targetSeconds };
  return { state: "stale", age_seconds: age, target_seconds: targetSeconds };
}

function publicRailHealth(health = {}, nowMs) {
  return Object.fromEntries(Object.entries(health || {}).map(([key, row]) => {
    const observedAt = isoFromSeconds(row.last_success_ts);
    return [key, {
      state: text(row.status, row.enabled === false ? "unavailable" : "unknown"),
      provider: text(row.provider, "unavailable"),
      observed_at: observedAt,
      freshness: freshness(observedAt, key === "energy" ? 21600 : key === "rates" ? 3600 : 1800, nowMs),
      degraded: text(row.degraded_reason, "ok") !== "ok" || Boolean(row.fallback_used),
    }];
  }));
}

function publicRailBreadth(breadth = {}) {
  const permittedRails = ["crypto", "equity", "rates", "fx", "energy"];
  const permittedFields = ["trend", "breadth", "momentum", "participation", "confidence", "degraded"];
  return Object.fromEntries(permittedRails.flatMap((rail) => {
    const source = breadth?.[rail];
    if (!source || typeof source !== "object") return [];
    return [[rail, Object.fromEntries(permittedFields.map((field) => [field, source[field] ?? null]))]];
  }));
}

export function buildPublicAtlasProjection({
  atlas = {},
  market = {},
  options = {},
  nowMs = Date.now(),
  allowedInstrumentHints = ["SPY", "QQQ", "IWM"],
  maxMarketRows = 64,
  maxOptionsRows = 24,
} = {}) {
  const generatedAt = isoFromSeconds(atlas.ts || market.ts || options.ts);
  const allowed = new Set((Array.isArray(allowedInstrumentHints) ? allowedInstrumentHints : []).map((value) => text(value).toUpperCase()).filter(Boolean));
  const marketSourceRows = Object.entries(market.prices || {});
  const markets = marketSourceRows
    .filter(([key, row]) => !allowed.size || allowed.has(text(row.ticker || key).toUpperCase()))
    .slice(0, Math.max(0, Math.min(256, Number(maxMarketRows) || 0)))
    .map(([key, row]) => ({
      instrument_hint: text(row.ticker || key).toUpperCase(),
      price: finite(row.price),
      change_5d: finite(row.ret_5d),
      change_21d: finite(row.ret_21d),
      change_63d: finite(row.ret_63d),
      sample_points: finite(row.points),
      provider: text(row.provider || market.market_provider, "unavailable"),
      observed_at: isoFromSeconds(market.last_success_ts || market.ts),
    }));
  const optionsSourceRows = Object.values(options.options_contexts || atlas.options_contexts || {});
  const optionsContexts = optionsSourceRows
    .filter((row) => !allowed.size || allowed.has(text(row.underlying).toUpperCase()))
    .slice(0, Math.max(0, Math.min(64, Number(maxOptionsRows) || 0)))
    .map((row) => ({
      underlying: text(row.underlying).toUpperCase(),
      regime: text(row.regime, "unavailable"),
      skew_state: text(row.skew_state, "unavailable"),
      demand_state: text(row.demand_state, "unavailable"),
      quality: text(row.quality, "unavailable"),
      panic_bid: Boolean(row.panic_bid),
      complacency: Boolean(row.complacency_flag),
      breakout: Boolean(row.breakout_flag),
      provider: "Tradier",
      delayed: Boolean(options.delayed_data),
      observed_at: isoFromSeconds(options.ts),
    }));
  const railHealth = publicRailHealth(atlas.rail_health, nowMs);
  const projectionFreshness = freshness(generatedAt, 1800, nowMs);
  const providerStates = Object.values(railHealth);
  const degraded = Boolean(atlas.degraded) || providerStates.some((row) => row.degraded || ["stale", "unavailable"].includes(row.freshness.state));
  return {
    schema_version: RAVENOS_ATLAS_PROJECTION_SCHEMA,
    generated_at: generatedAt,
    freshness: projectionFreshness,
    state: generatedAt ? (degraded ? "degraded" : "available") : "unavailable",
    posture: {
      state: text(atlas.atlas_posture, "unavailable"),
      confidence: text(atlas.confidence, "unknown"),
      alignment: text(atlas.rail_alignment?.alignment_state, "unknown"),
    },
    market_context: {
      risk_regime: text(market.features?.risk_regime, "unknown"),
      equity_regime: text(market.features?.equity_regime, "unknown"),
      sector_breadth: text(market.features?.equity_extended?.sector_breadth, "unknown"),
      participation_quality: text(market.features?.equity_extended?.participation_quality, "unknown"),
      rows: markets,
    },
    options_context: optionsContexts,
    rail_breadth: publicRailBreadth(atlas.rail_breadth),
    bounds: {
      market_rows: markets.length,
      market_rows_available: marketSourceRows.length,
      options_rows: optionsContexts.length,
      options_rows_available: optionsSourceRows.length,
      allowed_instrument_hints: [...allowed],
      truncated: markets.length < marketSourceRows.filter(([key, row]) => !allowed.size || allowed.has(text(row.ticker || key).toUpperCase())).length
        || optionsContexts.length < optionsSourceRows.filter((row) => !allowed.size || allowed.has(text(row.underlying).toUpperCase())).length,
    },
    provider_health: railHealth,
    capabilities: {
      market_map: markets.length > 0,
      equity_quotes: markets.length > 0,
      arbitrary_equity_lookup: false,
      options_summary: optionsContexts.length > 0,
      full_options_chain: false,
      company_fundamentals: false,
      filings: false,
      earnings_calendar: false,
      relationships: false,
      browser_provider_credentials: false,
    },
    public_safety: {
      aggregate_only: true,
      provider_payloads_removed: true,
      provider_urls_removed: true,
      credentials_removed: true,
      paper_engine_removed: true,
      internal_thresholds_removed: true,
    },
    unavailable: {
      company_context: "not_projected",
      full_options_chain: "not_projected",
      arbitrary_equity_quote: "not_projected",
      events: "not_projected",
      relationships: "not_projected",
    },
  };
}
