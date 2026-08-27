import { atlasObservationDecision } from "../atlas_display_rights.mjs";

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

function exactPublicInstrument(row = {}, { observedAt = null, freshnessState = "unavailable", provider = "unavailable", livePrice = false, optionsSummary = false } = {}) {
  const symbol = text(row.symbol).toUpperCase();
  const instrumentId = text(row.instrument_id);
  if (!symbol || !instrumentId || !["equity", "etf"].includes(text(row.instrument_type).toLowerCase())) return null;
  return {
    schema_version: "ravenos.instrument.v1",
    instrument_id: instrumentId,
    symbol,
    display_name: text(row.display_name, symbol),
    asset_class: text(row.asset_class, row.instrument_type).toLowerCase(),
    instrument_type: text(row.instrument_type).toLowerCase(),
    identity_scope: "exact_instrument",
    venue: text(row.venue, "unknown").toLowerCase(),
    chain: "none",
    market_identity: { market_id: symbol, listing: text(row.listing) },
    underlying_instrument_id: null,
    base_asset: { symbol, asset_id: symbol },
    quote_asset: { symbol: text(row.quote_asset, "USD").toUpperCase(), asset_id: "USD" },
    settlement_asset: { symbol: text(row.settlement_asset, "USD").toUpperCase(), asset_id: "USD" },
    economic_numeraire: text(row.economic_numeraire, "USDC").toUpperCase(),
    chart_source: "ravenos_terminal_chart",
    market_session: { state: "unknown", timezone: "America/New_York", observed_at: observedAt },
    capabilities: {
      chart: true,
      live_price: livePrice,
      book: false,
      tape: false,
      funding: false,
      open_interest: false,
      options_chain: false,
      raven_intelligence: false,
      atlas_intelligence: true,
      participant_context: false,
      quote_preview: false,
      execution: false,
      portfolio_valuation: false,
      options_summary: optionsSummary,
    },
    freshness: { state: freshnessState, observed_at: observedAt, source: provider },
    entitlement: { level: "public", server_enforced: false },
    route_compatibility: ["inspect"],
    account_compatibility: [],
  };
}

export function buildPublicAtlasProjection({
  atlas = {},
  market = {},
  options = {},
  nowMs = Date.now(),
  instrumentRegistry = {},
  allowedInstrumentHints = ["SPY", "QQQ", "IWM"],
  maxMarketRows = 64,
  maxOptionsRows = 24,
} = {}) {
  const generatedAt = isoFromSeconds(atlas.ts || market.ts || options.ts);
  const allowed = new Set((Array.isArray(allowedInstrumentHints) ? allowedInstrumentHints : []).map((value) => text(value).toUpperCase()).filter(Boolean));
  const marketSourceRows = Object.entries(market.prices || {});
  const eligibleMarketRows = marketSourceRows
    .filter(([key, row]) => !allowed.size || allowed.has(text(row.ticker || key).toUpperCase()))
    .filter(([key, row]) => Boolean(instrumentRegistry[text(row.ticker || key).toUpperCase()]));
  const optionsSourceRows = Object.values(options.options_contexts || atlas.options_contexts || {});
  const optionsContexts = optionsSourceRows
    .filter((row) => !allowed.size || allowed.has(text(row.underlying).toUpperCase()))
    .flatMap((row) => {
      const provider = text(row.provider || options.provider, "Tradier");
      const decision = atlasObservationDecision(provider, row.display_policy);
      if (decision.decision !== "allowed") return [];
      return [{
        underlying: text(row.underlying).toUpperCase(),
        underlying_instrument_id: instrumentRegistry[text(row.underlying).toUpperCase()]?.instrument_id || null,
        regime: text(row.regime, "unavailable"),
        skew_state: text(row.skew_state, "unavailable"),
        demand_state: text(row.demand_state, "unavailable"),
        quality: text(row.quality, "unavailable"),
        panic_bid: Boolean(row.panic_bid),
        complacency: Boolean(row.complacency_flag),
        breakout: Boolean(row.breakout_flag),
        provider,
        delayed: Boolean(options.delayed_data),
        observed_at: isoFromSeconds(options.ts),
        display_policy: row.display_policy,
      }];
    })
    .slice(0, Math.max(0, Math.min(64, Number(maxOptionsRows) || 0)));
  const allowedOptionSymbols = new Set(optionsContexts.map((row) => row.underlying));
  let allowedMarketRows = 0;
  const markets = eligibleMarketRows
    .slice(0, Math.max(0, Math.min(256, Number(maxMarketRows) || 0)))
    .flatMap(([key, row]) => {
      const symbol = text(row.ticker || key).toUpperCase();
      const observedAt = isoFromSeconds(market.last_success_ts || market.ts);
      const source = text(row.provider || market.market_provider, "unavailable");
      const displayDecision = atlasObservationDecision(source, row.display_policy);
      const observationAllowed = displayDecision.decision === "allowed";
      const instrument = exactPublicInstrument(instrumentRegistry[symbol], {
        observedAt,
        freshnessState: freshness(observedAt, 1800, nowMs).state,
        provider: source,
        livePrice: observationAllowed,
        optionsSummary: observationAllowed && allowedOptionSymbols.has(symbol),
      });
      if (instrument && observationAllowed) allowedMarketRows += 1;
      return instrument ? [{
        instrument_id: instrument.instrument_id,
        instrument,
        instrument_hint: symbol,
        symbol,
        state: observationAllowed ? "available" : "display_restricted",
        price: observationAllowed ? finite(row.price) : null,
        change_5d: observationAllowed ? finite(row.ret_5d) : null,
        change_21d: observationAllowed ? finite(row.ret_21d) : null,
        change_63d: observationAllowed ? finite(row.ret_63d) : null,
        sample_points: observationAllowed ? finite(row.points) : null,
        provider: source,
        observed_at: observationAllowed ? observedAt : null,
        display_policy: {
          decision: displayDecision.decision,
          raw_redistribution_allowed: observationAllowed,
          reason: displayDecision.reason,
          decision_source: displayDecision.source,
        },
      }] : [];
    });
  const admittedOptionsAvailable = optionsSourceRows.filter((row) => !allowed.size || allowed.has(text(row.underlying).toUpperCase())).length;
  const rightsRestricted = allowedMarketRows < markets.length || optionsContexts.length < admittedOptionsAvailable;
  const railHealth = publicRailHealth(atlas.rail_health, nowMs);
  const projectionFreshness = freshness(generatedAt, 1800, nowMs);
  const providerStates = Object.values(railHealth);
  const degraded = Boolean(atlas.degraded) || providerStates.some((row) => row.degraded || ["stale", "unavailable"].includes(row.freshness.state));
  return {
    schema_version: RAVENOS_ATLAS_PROJECTION_SCHEMA,
    generated_at: generatedAt,
    freshness: projectionFreshness,
    state: generatedAt ? (degraded || rightsRestricted ? "degraded" : "available") : "unavailable",
    posture: { state: "unavailable", confidence: "unknown", alignment: "unknown" },
    market_context: {
      risk_regime: "unknown",
      equity_regime: "unknown",
      sector_breadth: "unknown",
      participation_quality: "unknown",
      rows: markets,
    },
    options_context: optionsContexts,
    rail_breadth: {},
    bounds: {
      market_rows: markets.length,
      market_rows_available: eligibleMarketRows.length,
      options_rows: optionsContexts.length,
      options_rows_available: optionsSourceRows.length,
      allowed_instrument_hints: [...allowed],
      truncated: markets.length < eligibleMarketRows.length
        || optionsContexts.length < optionsSourceRows.filter((row) => !allowed.size || allowed.has(text(row.underlying).toUpperCase())).length,
    },
    provider_health: railHealth,
    capabilities: {
      market_map: allowedMarketRows > 0,
      exact_instrument_context: markets.length > 0,
      equity_quotes: allowedMarketRows > 0,
      arbitrary_equity_lookup: false,
      options_summary: optionsContexts.length > 0,
      full_options_chain: false,
      company_fundamentals: false,
      filings: false,
      earnings_calendar: false,
      relationships: false,
      browser_provider_credentials: false,
    },
    execution_boundary: {
      research_only: true,
      broker_connection_available: false,
      quote_preview_available: false,
      signing_available: false,
      submission_available: false,
      position_monitoring_available: false,
    },
    public_safety: {
      aggregate_only: true,
      provider_payloads_removed: true,
      provider_urls_removed: true,
      credentials_removed: true,
      paper_engine_removed: true,
      proprietary_calibration_removed: true,
      display_entitlements_enforced: true,
      restricted_observations_removed: true,
    },
    unavailable: {
      company_context: "not_projected",
      full_options_chain: "not_projected",
      arbitrary_equity_quote: "not_projected",
      ...(rightsRestricted ? {
        listed_market_observations: "public_display_rights_not_configured",
        options_summary: "public_display_rights_not_configured",
      } : {}),
      events: "not_projected",
      relationships: "not_projected",
    },
  };
}
