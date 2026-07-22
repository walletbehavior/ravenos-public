import { ravenOSContext } from "./ravenos-context-store.js";
import {
  RAVENOS_CHART_TIMEFRAMES,
  getChartDataPlaneDiagnostics,
  resolveChartCapability,
} from "./ravenos-chart-data-plane.js";
import { customerFacingText } from "./ravenos-intelligence-contract.js";

document.body.classList.add("ros-terminal-live-shell");

const TIMEFRAMES = new Set(RAVENOS_CHART_TIMEFRAMES);
const state = {
  lane: "perps",
  markets: [],
  publicPerps: null,
  atlas: null,
  selected: null,
  timeframe: "1h",
  workspace: null,
  context: null,
  flags: null,
  searchGeneration: 0,
  selectionGeneration: 0,
  searchTimer: null,
};

function spotChartCapability(row = {}, timeframe = "1h") {
  const market = row || {};
  const coverage = market.chart_coverage;
  const resolved = resolveChartCapability({
    market: "crypto_spot",
    chain: market.chainId,
    instrumentType: "spot_pool",
    pairAddress: market.pairAddress,
    timeframe,
    providerId: coverage?.provider_id || "",
  });
  if (coverage?.schema_version === "ravenos.search_chart_coverage.v1" && coverage.state === "unavailable") {
    return {
      ...resolved,
      chart_ready: false,
      chart_request_supported: false,
      unavailable_reason: coverage.reason || resolved.unavailable_reason,
    };
  }
  return resolved;
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function setText(id, value, fallback = "--") {
  const element = document.getElementById(id);
  if (element) element.textContent = value === null || value === undefined || value === "" ? fallback : String(value);
}

function setState(id, value, label = null) {
  const element = document.getElementById(id);
  if (!element) return;
  element.dataset.state = String(value || "unavailable").toLowerCase();
  element.textContent = label || titleCase(value);
}

function titleCase(value, fallback = "Unavailable") {
  const clean = String(value || "").trim();
  if (!clean) return fallback;
  return clean.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function chainDisplayName(value) {
  const chain = String(value || "").trim().toLowerCase();
  return chain === "robinhood" ? "Robinhood Chain" : titleCase(chain, "Unknown chain");
}

function formatPrice(value) {
  const result = finite(value);
  if (result === null || result <= 0) return "--";
  if (result >= 1000) return `$${result.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (result >= 1) return `$${result.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 5 })}`;
  return `$${result.toLocaleString("en-US", { maximumSignificantDigits: 7 })}`;
}

function compact(value, { currency = false } = {}) {
  const result = finite(value);
  if (result === null) return "--";
  const label = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(result);
  return currency ? `$${label}` : label;
}

function percent(value, { ratio = false, precision = 2 } = {}) {
  const result = finite(value);
  if (result === null) return "--";
  const scaled = ratio ? result * 100 : result;
  return `${scaled >= 0 ? "+" : ""}${scaled.toFixed(Math.abs(scaled) < 0.1 ? 4 : precision)}%`;
}

function timestamp(value) {
  const parsed = new Date(value || "");
  if (Number.isNaN(parsed.getTime())) return "Timestamp unavailable";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(parsed) + " UTC";
}

function durationLabel(seconds) {
  const value = Math.max(0, Math.trunc(finite(seconds) || 0));
  if (value < 60) return `${value}s ago`;
  if (value < 3600) return `${Math.max(1, Math.round(value / 60))}m ago`;
  if (value < 86_400) return `${Math.max(1, Math.round(value / 3600))}h ago`;
  return `${Math.max(1, Math.round(value / 86_400))}d ago`;
}

function ageLabel(milliseconds) {
  const value = finite(milliseconds);
  if (value === null || value < 0) return "Unavailable";
  const days = value / 86_400_000;
  if (days < 1) return `${Math.max(1, Math.round(value / 3_600_000))}h`;
  if (days < 90) return `${Math.round(days)}d`;
  if (days < 730) return `${(days / 365).toFixed(1)}y`;
  return `${Math.round(days / 365)}y`;
}

function readableProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  const labels = {
    atlas_listed_market: "Atlas listed market",
    coingecko_onchain: "CoinGecko Onchain",
    dexpaprika: "DexPaprika",
    hyperliquid_native: "Hyperliquid",
    yahoo_finance: "Listed-market provider",
  };
  return labels[provider] || titleCase(value, "Provider unavailable");
}

function operatorList(value, fallback = "Unavailable") {
  if (Array.isArray(value)) {
    const rows = value.map((item) => customerFacingText(item, "")).filter(Boolean);
    return rows.length ? rows.join(" · ") : fallback;
  }
  if (value && typeof value === "object") {
    if (value.label) return customerFacingText(value.label, fallback);
    if (value.summary) return customerFacingText(value.summary, fallback);
  }
  return customerFacingText(value, fallback);
}

function setAnatomySlot(index, label, value) {
  setText(`terminalAnatomy${index}Label`, label);
  setText(`terminalAnatomy${index}`, value, "Unavailable");
}

function renderSourceDetails(workspace = state.workspace?.state || {}) {
  const series = workspace?.candleSeries || {};
  const derivation = workspace?.derivation || series.derivation || {};
  const continuity = workspace?.continuity || {};
  const candleAudit = continuity.candles || {};
  const provider = readableProvider(series.provider || workspace?.source);
  const requestedInterval = series.timeframe || workspace?.timeframe || state.timeframe;
  const sourceInterval = series.source_interval || derivation.source_interval || requestedInterval;
  const mode = derivation.state === "derived" ? "Derived" : "Direct";
  const gaps = finite(candleAudit.missing_source_buckets);
  const duplicates = finite(candleAudit.conflicting_duplicates);
  const continuityLabel = continuity.state
    ? `${titleCase(continuity.state)}${gaps ? ` · ${gaps} missing source bucket${gaps === 1 ? "" : "s"}` : ""}${duplicates ? ` · ${duplicates} conflicting duplicate${duplicates === 1 ? "" : "s"}` : ""}`
    : "Not reported by this venue";
  const age = finite(workspace?.ageSeconds ?? candleAudit.age_seconds);
  const freshness = workspace?.state || series.freshness_state || candleAudit.freshness_state || "unavailable";

  setText("terminalSourceSummary", "Source details");
  setText("terminalSourceProvider", provider);
  setText("terminalSourceInterval", derivation.state === "derived"
    ? `${requestedInterval} from complete ${sourceInterval} bars`
    : `${mode} ${sourceInterval} bars`);
  setText("terminalSourceContinuity", continuityLabel);
  setText("terminalSourceFreshness", `${titleCase(freshness)}${age !== null ? ` · ${durationLabel(age)}` : workspace?.observedAt ? ` · ${timestamp(workspace.observedAt)}` : ""}`);
}

function renderMarketAnatomy(workspace = state.workspace?.state || {}) {
  const anatomy = workspace?.marketAnatomy || {};
  const chartProvider = readableProvider(workspace?.candleSeries?.provider || workspace?.source);
  if (state.lane === "perps") {
    const market = selectedPerpSnapshot();
    const spread = finite(
      state.context?.market_data?.book?.summary?.spread_bps
      ?? workspace?.orderBook?.summary?.spread_bps,
    );
    setAnatomySlot(1, "Open interest", compact(market.openInterestUsd, { currency: true }));
    setAnatomySlot(2, "24h volume", compact(market.volume, { currency: true }));
    setAnatomySlot(3, "Funding", percent(market.funding, { ratio: true }));
    setAnatomySlot(4, "Book spread", spread === null ? "Unavailable" : `${spread.toFixed(spread < 1 ? 3 : 2)} bps`);
    setAnatomySlot(5, "Collateral", "USDC · venue custody");
    setAnatomySlot(6, "Route", "Read only · no order review");
    setText("terminalFingerprint", state.selected?.instrument_id, "Exact contract unavailable");
    setText("terminalAnatomyState", `${chartProvider} · exact contract`);
    return;
  }

  if (state.lane === "spot") {
    const holderState = anatomy.holder_distribution?.state === "available"
      ? operatorList(anatomy.holder_distribution?.summary)
      : "Not projected";
    setAnatomySlot(1, "Liquidity", compact(anatomy.liquidity_usd ?? state.selected?.liquidityUsd, { currency: true }));
    setAnatomySlot(2, "24h volume", compact(anatomy.volume_24h_usd ?? state.selected?.volume24h, { currency: true }));
    setAnatomySlot(3, "24h transactions", compact(anatomy.transactions_24h ?? state.selected?.txns24h));
    setAnatomySlot(4, "Pool age", ageLabel(anatomy.pool_age_ms ?? state.selected?.pairAgeMs));
    setAnatomySlot(5, "Holder distribution", holderState);
    setAnatomySlot(6, "Route", titleCase(anatomy.route?.state, "Unavailable"));
    setText("terminalFingerprint", anatomy.pool_fingerprint || `${state.selected?.chainId || "unknown"}:pool:${state.selected?.pairAddress || "unresolved"}`);
    setText("terminalAnatomyState", anatomy.exact_identity === false ? "Identity unavailable" : `${chartProvider} · exact pool`);
    return;
  }

  const subject = atlasSubject(state.selected || {});
  const instrument = state.selected?.instrument?.schema_version === "ravenos.instrument.v1" ? state.selected.instrument : state.selected || {};
  const options = atlasOptionsFor(state.selected);
  setAnatomySlot(1, "Session", titleCase(instrument.market_session?.state));
  setAnatomySlot(2, "5d move", percent(state.selected?.change_5d, { ratio: true }));
  setAnatomySlot(3, "Options context", options ? titleCase(options.regime) : "Unavailable");
  setAnatomySlot(4, "Settlement", `${subject.settlementAsset || "USD"} · broker custody`);
  setAnatomySlot(5, "Atlas context", state.context?.atlas_context?.context_available ? "Available" : "Unavailable");
  setAnatomySlot(6, "Route", "Broker order review unavailable");
  setText("terminalFingerprint", subject.instrumentId, "Exact listing unavailable");
  setText("terminalAnatomyState", `${chartProvider} · exact listing`);
}

function renderTradeConsequences() {
  if (state.lane === "perps") {
    setText("terminalSettlementConsequence", "USDC margin remains at Hyperliquid; no order is prepared");
    setText("terminalPortfolioConsequence", "No customer venue account or exposure is connected");
    return;
  }
  if (state.lane === "spot") {
    const quote = String(state.selected?.quoteSymbol || "quote asset").toUpperCase();
    setText("terminalSettlementConsequence", `${quote} pool settlement; USDC intent requires an exact reviewed route`);
    setText("terminalPortfolioConsequence", "No wallet balance, custody, or resulting holding is inferred");
    return;
  }
  const subject = atlasSubject(state.selected || {});
  setText("terminalSettlementConsequence", `${subject.settlementAsset || "USD"} settles at the broker; RavenOS does not hold funds`);
  setText("terminalPortfolioConsequence", "No broker account, buying power, or resulting position is connected");
}

function historicalOutcomeText(value = {}) {
  const outcome = value && typeof value === "object" ? value : {};
  const sample = Math.max(0, Math.trunc(finite(outcome.sample_size) || 0));
  if (!sample) return "No matured comparable outcome is projected for this marker";
  const change = percent(outcome.median_change_pct);
  return `${sample} matured path${sample === 1 ? "" : "s"} · median ${change}${outcome.matured_through ? ` · through ${timestamp(outcome.matured_through)}` : ""}`;
}

function pathTransitionText(value = {}) {
  if (!value || typeof value !== "object") return operatorList(value);
  const parts = [value.behavior, value.pressure, value.observed_side, value.state]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .map((item) => titleCase(item));
  return parts.length ? parts.join(" · ") : "Unavailable";
}

function renderMarkerDetail(marker = {}) {
  const detail = document.getElementById("terminalMarkerDetail");
  if (!detail) return;
  const inspection = marker.inspection || {};
  const read = marker.raven_read || {};
  const source = inspection.source_evidence || read.evidence?.[0] || marker.metadata || {};
  const sourceLabel = source.label || source.source || marker.source || "Public Raven evidence unavailable";
  const sourceTime = source.observed_at || marker.exact_observed_at || marker.observed_at;
  setText("terminalMarkerTitle", marker.label || read.title || "Raven decision detail");
  setText("terminalMarkerSource", `${customerFacingText(sourceLabel, "Public Raven evidence unavailable")}${sourceTime ? ` · ${timestamp(sourceTime)}` : ""}`);
  setText("terminalMarkerMaturity", titleCase(inspection.evidence_maturity || read.confidence, "Unavailable"));
  setText("terminalMarkerPath", pathTransitionText(inspection.path_transition));
  setText("terminalMarkerOutcome", historicalOutcomeText(inspection.historical_outcome));
  setText("terminalMarkerSupport", operatorList(inspection.support, "No public supporting detail is projected"));
  setText("terminalMarkerContradiction", operatorList(inspection.contradiction, "No public contradiction detail is projected"));
  detail.hidden = false;
}

function unwrap(payload) {
  return payload?.data && typeof payload.data === "object" ? payload.data : payload;
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, { cache: "no-store", headers: { accept: "application/json", ...(init.headers || {}) }, ...init });
  const payload = await response.json().catch(() => null);
  return { response, payload: unwrap(payload) };
}

function perpSubject(row = {}) {
  return {
    id: row.instrument_id,
    instrumentId: row.instrument_id,
    type: "instrument",
    label: row.asset,
    symbol: row.asset,
    assetClass: "crypto",
    instrumentType: "perpetual",
    identityScope: "exact_instrument",
    chain: "hyperliquid",
    venue: "hyperliquid",
    marketType: "perp",
    quoteAsset: "USD",
    settlementAsset: "USDC",
    preferredCashAsset: "USDC",
    economicNumeraire: "USDC",
    capabilities: {
      chart: true,
      live_price: true,
      book: true,
      tape: true,
      funding: true,
      open_interest: true,
      raven_intelligence: true,
      quote_preview: false,
      execution: false,
    },
  };
}

function spotSubject(row = {}) {
  const chain = String(row.chainId || "").toLowerCase();
  const pairAddress = String(row.pairAddress || "");
  const label = `${row.symbol || "UNKNOWN"}/${row.quoteSymbol || "QUOTE"}`;
  return {
    id: `${chain}:pool:${pairAddress}`,
    instrumentId: `${chain}:pool:${pairAddress}`,
    type: "pool",
    label,
    symbol: row.symbol || "",
    assetClass: "crypto",
    instrumentType: "exact_pool",
    identityScope: "exact_pool",
    chain,
    venue: String(row.dexId || "unknown").toLowerCase(),
    marketType: "spot",
    quoteAsset: String(row.quoteSymbol || "").toUpperCase(),
    settlementAsset: String(row.quoteSymbol || "").toUpperCase(),
    preferredCashAsset: "USDC",
    economicNumeraire: "USDC",
    capabilities: {
      chart: spotChartCapability(row, state.timeframe).chart_ready,
      live_price: true,
      liquidity: true,
      route_preview: chain === "solana",
      raven_intelligence: false,
      execution: false,
    },
  };
}

function atlasSubject(row = {}) {
  const instrument = row.instrument?.schema_version === "ravenos.instrument.v1"
    ? row.instrument
    : row.schema_version === "ravenos.instrument.v1"
      ? row
      : {};
  const symbol = String(row.symbol || instrument.symbol || "").toUpperCase();
  const quote = instrument.quote_asset?.symbol || "USD";
  const settlement = instrument.settlement_asset?.symbol || "USD";
  return {
    id: row.instrument_id || instrument.instrument_id,
    instrumentId: row.instrument_id || instrument.instrument_id,
    type: "instrument",
    label: symbol || instrument.display_name || "Traditional market",
    symbol,
    assetClass: instrument.asset_class || "equity",
    instrumentType: instrument.instrument_type || "equity",
    identityScope: instrument.identity_scope || "exact_instrument",
    chain: instrument.chain || "none",
    venue: instrument.venue || "unknown",
    marketType: "equities",
    quoteAsset: quote,
    settlementAsset: settlement,
    preferredCashAsset: instrument.preferred_cash_asset?.symbol || "USD",
    economicNumeraire: instrument.economic_numeraire || "USDC",
    capabilities: { ...(instrument.capabilities || {}), execution: false },
  };
}

function setWhyLabel(value = "Why Raven noticed this") {
  setText("terminalWhyLabel", value);
}

function selectedPerpSnapshot(row = state.selected, streamed = state.workspace?.state?.marketState || {}) {
  const last = finite(streamed.last ?? row?.last_price ?? row?.lastPrice);
  const mark = finite(streamed.mark ?? row?.mark_price ?? row?.markPx);
  const oracle = finite(streamed.oracle ?? row?.oracle_price ?? row?.oraclePx);
  const funding = finite(streamed.funding ?? row?.funding_rate ?? row?.funding);
  const openInterestUsd = finite(row?.open_interest_usd) ?? (
    finite(streamed.open_interest ?? row?.open_interest_base ?? row?.openInterest) !== null && (mark || last)
      ? finite(streamed.open_interest ?? row?.open_interest_base ?? row?.openInterest) * (mark || last)
      : null
  );
  const volume = finite(streamed.volume_24h ?? row?.day_notional_volume_usd ?? row?.dayNtlVlm);
  const previous = finite(streamed.previous_day_price ?? row?.previous_day_price ?? row?.prevDayPx);
  const change = last && previous ? (last / previous - 1) * 100 : finite(row?.day_change_pct);
  return { last, mark, oracle, funding, openInterestUsd, volume, change };
}

function renderPerpFacts() {
  const row = state.selected;
  const market = selectedPerpSnapshot(row);
  setText("terminalInstrumentScope", "Exact instrument");
  setText("terminalInstrument", row?.asset);
  setText("terminalInstrumentMeta", row ? `${row.instrument_id} · ${timestamp(row.observed_at)}` : "Hyperliquid perpetual · unavailable");
  setText("terminalPickerSymbol", row?.asset, "No instrument");
  setText("terminalPickerMeta", row?.instrument_id, "Search any supported market");
  setText("terminalVenueLabel", "Hyperliquid");
  setText("terminalCapabilityLabel", "Perpetual · USDC collateral · exact contract");
  setText("terminalLast", formatPrice(market.last));
  setText("terminalMetric2Label", "Mark");
  setText("terminalMetric2", formatPrice(market.mark));
  setText("terminalMetric3Label", "Funding");
  setText("terminalMetric3", percent(market.funding, { ratio: true }));
  setText("terminalMetric4Label", "Open interest");
  setText("terminalMetric4", compact(market.openInterestUsd, { currency: true }));
  setText("terminalMetric5Label", "24h volume");
  setText("terminalMetric5", compact(market.volume, { currency: true }));
  setText("terminalMetric6Label", "24h change");
  setText("terminalMetric6", percent(market.change));
  const changeNode = document.getElementById("terminalMetric6");
  changeNode?.classList.toggle("terminal-positive", market.change !== null && market.change >= 0);
  changeNode?.classList.toggle("terminal-negative", market.change !== null && market.change < 0);
  renderMarketAnatomy();
  renderTradeConsequences();
}

function renderSpotFacts(row = state.selected) {
  const chartRequestSupported = spotChartCapability(row, state.timeframe).chart_request_supported;
  setText("terminalInstrumentScope", "Exact public pool");
  setText("terminalInstrument", row ? `${row.symbol}/${row.quoteSymbol || "QUOTE"}` : "No pool selected");
  setText("terminalInstrumentMeta", row ? `${chainDisplayName(row.chainId)} · ${row.dexId || "venue unavailable"} · lookup snapshot` : "Search for a symbol, token, or contract");
  setText("terminalPickerSymbol", row ? `${row.symbol || "UNKNOWN"}/${row.quoteSymbol || "QUOTE"}` : "Exact spot market required");
  setText("terminalPickerMeta", row ? `${row.chainId}:pool:${row.pairAddress}` : "Search symbol, token, pool, or contract");
  setText("terminalVenueLabel", row ? `${chainDisplayName(row.chainId)} · ${row.dexId || "pool"}` : "Unresolved");
  setText("terminalCapabilityLabel", row ? `Spot · ${row.quoteSymbol || "quote"} pool quote · ${chartRequestSupported ? "coverage check on open" : "chart unavailable"} · USDC economic intent` : "No chain or venue selected");
  setText("terminalLast", formatPrice(row?.priceUsd));
  setText("terminalMetric2Label", "Market cap");
  setText("terminalMetric2", compact(row?.marketCap ?? row?.fdv, { currency: true }));
  setText("terminalMetric3Label", "Liquidity");
  setText("terminalMetric3", compact(row?.liquidityUsd, { currency: true }));
  setText("terminalMetric4Label", "24h volume");
  setText("terminalMetric4", compact(row?.volume24h, { currency: true }));
  setText("terminalMetric5Label", "24h transactions");
  setText("terminalMetric5", compact(row?.txns24h));
  setText("terminalMetric6Label", "24h change");
  setText("terminalMetric6", percent(row?.priceChange24h));
  const change = finite(row?.priceChange24h);
  const changeNode = document.getElementById("terminalMetric6");
  changeNode?.classList.toggle("terminal-positive", change !== null && change >= 0);
  changeNode?.classList.toggle("terminal-negative", change !== null && change < 0);
  renderMarketAnatomy();
  renderTradeConsequences();
}

function atlasOptionsFor(row = state.selected) {
  const subject = atlasSubject(row || {});
  return (state.atlas?.options_context || []).find((option) => (
    option?.underlying_instrument_id === subject.instrumentId
    || String(option?.underlying || "").toUpperCase() === subject.symbol
  )) || null;
}

function renderAtlasFacts(row = state.selected) {
  const subject = atlasSubject(row || {});
  const instrument = row?.instrument || {};
  const options = atlasOptionsFor(row);
  const session = instrument.market_session?.state || "unknown";
  setText("terminalInstrumentScope", "Exact listed instrument");
  setText("terminalInstrument", subject.symbol || "No instrument selected");
  setText("terminalInstrumentMeta", row ? `${titleCase(instrument.market_identity?.listing || subject.venue)} · ${subject.instrumentId} · ${timestamp(row.observed_at)}` : "Select an exact listed instrument");
  setText("terminalPickerSymbol", subject.symbol, "Exact listed instrument required");
  setText("terminalPickerMeta", subject.instrumentId, "Search equities and ETFs");
  setText("terminalVenueLabel", titleCase(instrument.market_identity?.listing || subject.venue));
  setText("terminalCapabilityLabel", `${titleCase(subject.instrumentType)} · ${subject.settlementAsset} settlement · ${titleCase(session)} session`);
  setText("terminalLast", formatPrice(row?.price));
  setText("terminalMetric2Label", "5d change");
  setText("terminalMetric2", percent(row?.change_5d, { ratio: true }));
  setText("terminalMetric3Label", "21d change");
  setText("terminalMetric3", percent(row?.change_21d, { ratio: true }));
  setText("terminalMetric4Label", "63d change");
  setText("terminalMetric4", percent(row?.change_63d, { ratio: true }));
  setText("terminalMetric5Label", "Options context");
  setText("terminalMetric5", options ? titleCase(options.regime) : "Unavailable");
  setText("terminalMetric6Label", "Market session");
  setText("terminalMetric6", titleCase(session));
  const changeNode = document.getElementById("terminalMetric6");
  changeNode?.classList.remove("terminal-positive", "terminal-negative");
  renderMarketAnatomy();
  renderTradeConsequences();
}

function renderListedFacts(row = state.selected) {
  const subject = atlasSubject(row || {});
  const instrument = row?.instrument?.schema_version === "ravenos.instrument.v1" ? row.instrument : row || {};
  const session = instrument.market_session?.state || "unknown";
  const listing = instrument.market_identity?.listing || subject.venue;
  setText("terminalInstrumentScope", "Exact listed instrument");
  setText("terminalInstrument", subject.symbol || "No instrument selected");
  setText("terminalInstrumentMeta", subject.instrumentId ? `${titleCase(listing)} · ${subject.instrumentId}` : "Select an exact listed instrument");
  setText("terminalPickerSymbol", subject.symbol, "Exact listed instrument required");
  setText("terminalPickerMeta", subject.instrumentId, "Search equities and ETFs");
  setText("terminalVenueLabel", titleCase(listing));
  setText("terminalCapabilityLabel", `${titleCase(subject.instrumentType)} · ${subject.settlementAsset} settlement · market-data inspection only`);
  setText("terminalLast", "--");
  setText("terminalMetric2Label", "Settlement");
  setText("terminalMetric2", subject.settlementAsset);
  setText("terminalMetric3Label", "Economic view");
  setText("terminalMetric3", subject.economicNumeraire);
  setText("terminalMetric4Label", "Market session");
  setText("terminalMetric4", titleCase(session));
  setText("terminalMetric5Label", "Atlas context");
  setText("terminalMetric5", "Unavailable");
  setText("terminalMetric6Label", "Execution");
  setText("terminalMetric6", "Read only");
  document.getElementById("terminalMetric6")?.classList.remove("terminal-positive", "terminal-negative");
  renderMarketAnatomy();
  renderTradeConsequences();
}

function resetComparableEvidence() {
  setText("terminalComparableState", "Unavailable");
  setText("terminalComparableN", "0");
  setText("terminalComparableChange", "--");
  setText("terminalComparableFavorable", "--");
  setText("terminalComparableAdverse", "--");
  setText("terminalComparableNote", "No exact matured sample has been verified.");
}

function renderComparables(comparables = {}) {
  const sample = Math.max(0, Math.trunc(finite(comparables.sample_size) || 0));
  setText("terminalComparableState", titleCase(comparables.evidence_maturity, sample ? "Observed" : "Forming"));
  setText("terminalComparableN", sample.toLocaleString());
  setText("terminalComparableChange", percent(comparables.median_observed_change_pct));
  setText("terminalComparableFavorable", percent(comparables.median_favorable_excursion_pct));
  setText("terminalComparableAdverse", percent(comparables.median_adverse_excursion_pct));
  setText("terminalComparableNote", sample
    ? `${sample} completed future-only path${sample === 1 ? "" : "s"}; matured through ${timestamp(comparables.matured_through)}.`
    : "No exact matured sample has been verified.");
}

function setContextUnavailable({ headline, summary, identity, reason = "No exact public Raven decision context is available for this market." } = {}) {
  state.context = null;
  setText("terminalReadHeadline", headline || "Raven context unavailable");
  setText("terminalReadSummary", summary || "The provider-backed chart remains available independently.");
  setText("terminalWhy", reason);
  setText("terminalContextIdentity", identity || "Unavailable");
  setText("terminalBehavior", "Unavailable");
  setText("terminalPath", "Unavailable");
  setText("terminalEvidenceMaturity", "Unavailable");
  setText("terminalEvidenceState", "Unavailable");
  setState("terminalContextFreshness", "unavailable", "Unavailable");
  resetComparableEvidence();
}

function setContextChecking({ identity } = {}) {
  state.context = null;
  setText("terminalReadHeadline", "Resolving Raven context");
  setText("terminalReadSummary", "The live market and timestamped Raven evidence are loading independently.");
  setText("terminalWhy", "Raven is checking for an exact decision-time observation for this instrument.");
  setText("terminalContextIdentity", identity || "Exact instrument resolving");
  setText("terminalBehavior", "Checking");
  setText("terminalPath", "Checking");
  setText("terminalEvidenceMaturity", "Checking");
  setText("terminalEvidenceState", "Checking current evidence");
  setState("terminalContextFreshness", "loading", "Checking");
  resetComparableEvidence();
  setText("terminalComparableNote", "Checking for exact matured comparisons.");
}

function contextChartEvent(payload) {
  const event = payload?.chart_event;
  const candles = state.workspace?.state?.candles || [];
  const observed = Math.trunc(Date.parse(event?.observed_at || "") / 1000);
  if (!event?.event_id || !event?.instrument_id || !event?.lineage?.public_context_id || !Number.isFinite(observed) || !candles.length) return null;
  const nearest = candles.reduce((best, candle) => (
    Math.abs(Number(candle.time) - observed) < Math.abs(Number(best.time) - observed) ? candle : best
  ), candles[0]);
  return {
    type: "opportunity-marker",
    severity: "info",
    label: event.label || "Raven observation",
    time: nearest.time,
    exact_observed_at: event.observed_at,
    event_id: event.event_id,
    instrument_id: event.instrument_id,
    lineage: event.lineage,
    inspection: event.inspection || null,
  };
}

function applyContextChartEvent(payload) {
  const event = contextChartEvent(payload);
  state.workspace?.render?.({
    asset: state.selected?.asset,
    market: "perp",
    venue: "hyperliquid",
    chain: "hyperliquid",
    timeframe: state.timeframe,
    events: event ? [event] : [],
    overlays: [],
    visibleOverlayTypes: [],
    showVolume: true,
    chartDataSource: "terminal_chart_api",
    indicatorSourceState: "provider_backed",
  });
}

function renderPerpContext(payload, { updateUrl = true } = {}) {
  state.context = payload;
  const context = payload?.raven_context || {};
  const read = payload?.raven_read || {};
  const delivery = payload?.delivery || {};
  const available = context.context_available === true;
  const observationLabel = context.context_state === "fresh"
    ? "Current observation"
    : finite(context.context_age_seconds) !== null
      ? `Observed ${durationLabel(context.context_age_seconds)}`
      : "Timestamped observation";
  const deliveryLabel = delivery.freshness_state === "fresh" ? "current feed" : `${titleCase(delivery.freshness_state)} feed`;
  setText("terminalReadHeadline", read.headline || `${state.selected?.asset || "Instrument"} · Raven context unavailable`);
  setText("terminalReadSummary", customerFacingText(read.summary, "Live market data remains available, but no timestamped Raven observation matches this instrument."));
  setText("terminalWhy", customerFacingText(read.why_raven_noticed || context.why_raven_noticed, "No current Raven observation is available for this instrument."));
  setText("terminalContextIdentity", payload?.instrument?.instrument_id || state.selected?.instrument_id);
  setText("terminalBehavior", available ? context.behavior_family || "Observed, family unavailable" : "Unavailable");
  setText("terminalPath", available ? context.current_path || context.pressure_state || context.context_state : "Unavailable");
  setText("terminalEvidenceMaturity", available ? titleCase(context.outcomes?.evidence_maturity, "Forming") : "Unavailable");
  setText("terminalEvidenceState", available ? `${observationLabel} · ${deliveryLabel}` : "Context unavailable");
  setState("terminalContextFreshness", delivery.freshness_state || "unavailable", delivery.fallback ? `Fallback · ${titleCase(delivery.freshness_state)}` : delivery.freshness_state === "fresh" ? "Current" : titleCase(delivery.freshness_state));
  renderComparables(payload?.matured_comparables || {});
  applyContextChartEvent(payload);
  renderMarketAnatomy();
  updateShell({
    subject: perpSubject({ ...state.selected, instrument_id: payload?.instrument?.instrument_id || state.selected?.instrument_id }),
    marketLabel: read.headline || `${state.selected?.asset} market`,
    thesis: customerFacingText(read.summary, "No exact Raven thesis is currently available."),
    setup: available ? context.context_state || "observed" : "unavailable",
    supporting: Array.isArray(read.what_would_strengthen) ? read.what_would_strengthen : [],
    contradicting: Array.isArray(read.what_would_weaken) ? read.what_would_weaken : [],
    evidenceState: available ? context.outcomes?.evidence_maturity || "forming" : "unavailable",
    freshnessState: delivery.freshness_state || "data_unavailable",
    observedAt: context.observed_at || payload?.market_data?.generated_at || null,
  }, { updateUrl });
}

function updateShell({ subject, marketLabel, thesis, setup, supporting = [], contradicting = [], evidenceState, freshnessState, observedAt }, { updateUrl = true } = {}) {
  ravenOSContext.setSelection({ subject, timeframe: state.timeframe, workspace: "market-monitor" }, { updateUrl });
  window.RavenOSShell?.setCapabilities?.({
    market: state.workspace?.state?.state === "live" ? `Live · ${state.workspace.state.source}` : titleCase(state.workspace?.state?.state),
    wallet: "No customer session",
    mode: "Read only",
    signing: "Sign off",
    broadcast: "Broadcast off",
    evidence: evidenceState === "atlas_context" ? "Atlas context linked · Raven unavailable" : evidenceState && evidenceState !== "unavailable" ? "Exact evidence linked" : "Evidence unavailable",
  });
  window.RavenOSShell?.setIntelligence?.({
    subject,
    evidenceRole: "selected_market_context",
    marketState: { label: marketLabel || "Market data available", regime: state.lane },
    setupState: { state: setup || "unavailable", confirmation: "read only" },
    thesis: thesis || "No verified Raven thesis is available for this selection.",
    supportingEvidence: supporting,
    contradictingEvidence: contradicting,
    invalidation: [],
    timeHorizon: state.timeframe,
    confidence: { label: evidenceState || "unrated" },
    evidenceQuality: { state: evidenceState || "unavailable", lineageComplete: Boolean(state.context?.raven_context?.context_available || state.context?.atlas_context?.context_available) },
    freshness: { state: freshnessState || "data_unavailable", observedAt },
    nextExpectedTransition: state.lane === "perps"
      ? "Wait for the next timestamped Raven context or market update."
      : state.lane === "equity"
        ? "Atlas context is current; Raven has no exact behavioral read for this listing."
        : "Raven has no exact behavioral read for this spot market yet.",
  });
}

function updateQuoteBoundary() {
  const flags = state.flags?.flags || {};
  const enabled = state.flags?.quote_only === true
    && flags.RAVENOS_CUSTOMER_TRADE_UI_ENABLE === true
    && flags.RAVENOS_CUSTOMER_TRADE_QUOTE_ENABLE === true;
  const selectedSolanaSpot = state.lane === "spot" && String(state.selected?.chainId || "").toLowerCase() === "solana";
  setText("terminalQuoteState", enabled ? "Review only" : "Read only");
  setText("terminalQuoteContract", enabled ? "Read-only quote review" : "Quote preview not enabled");
  setText("terminalQuoteNote", enabled && selectedSolanaSpot
    ? "A current route and quote may be reviewed. No transaction is prepared, signed, or sent."
    : enabled
      ? "Quote review is available only for supported Solana pairs. No order can be signed or sent."
      : "RavenOS cannot review a current route for this exact market. No transaction is prepared, signed, or sent.");
  renderTradeConsequences();
}

async function loadTradeFlags() {
  try {
    const { response, payload } = await fetchJson("/api/trade/flags");
    state.flags = response.ok ? payload : null;
  } catch {
    state.flags = null;
  }
  updateQuoteBoundary();
}

async function selectPerp(asset, { updateUrl = true } = {}) {
  const row = state.markets.find((item) => item.asset === asset);
  if (!row) return;
  const generation = ++state.selectionGeneration;
  state.lane = "perps";
  state.selected = row;
  state.context = null;
  setWhyLabel("Why Raven noticed this");
  setText("terminalReadTrigger", "Raven Read");
  document.getElementById("assetSelect").value = row.asset;
  document.getElementById("venueSelect").replaceChildren(new Option("Hyperliquid", "hyperliquid"));
  setText("terminalChartTitle", `${row.asset} · ${state.timeframe}`);
  setText("terminalChartStatus", "Requesting provider-backed candles and exact Raven context.");
  setText("terminalDeepLink", "Perp depth");
  document.getElementById("terminalDeepLink").href = `/perps/?asset=${encodeURIComponent(row.asset)}&timeframe=${encodeURIComponent(state.timeframe)}`;
  renderPerpFacts();
  setContextChecking({ identity: row.instrument_id });
  updateQuoteBoundary();
  ravenOSContext.setSelection({ subject: perpSubject(row), timeframe: state.timeframe, workspace: "market-monitor" }, { updateUrl });

  const chartPromise = state.workspace.load({
    market: "perpetuals",
    asset: row.asset,
    timeframe: state.timeframe,
    chain: "hyperliquid",
    marketIdentity: row.instrument_id,
    instrumentScope: "exact_instrument",
  });
  const contextPromise = fetchJson(`/api/perps/instrument?symbol=${encodeURIComponent(row.asset)}`).catch(() => null);
  const [chartState, contextResult] = await Promise.all([chartPromise, contextPromise]);
  if (generation !== state.selectionGeneration) return;
  renderPerpFacts();
  renderWorkspaceState(state.workspace?.state || chartState);
  if (contextResult?.response?.ok && contextResult.payload?.ok) renderPerpContext(contextResult.payload, { updateUrl });
  else {
    setContextUnavailable({ identity: row.instrument_id });
    updateShell({
      subject: perpSubject(row),
      marketLabel: `${row.asset} provider market`,
      thesis: "Live market data is available; exact Raven context is unavailable.",
      setup: "unavailable",
      evidenceState: "unavailable",
      freshnessState: chartState?.state || "data_unavailable",
      observedAt: chartState?.observedAt || row.observed_at,
    }, { updateUrl });
  }
}

function setLane(lane, { updateUrl = true, selectDefault = true } = {}) {
  if (!new Set(["perps", "spot", "equity"]).has(lane)) return;
  state.lane = lane;
  document.getElementById("terminalModeSelect").value = lane;
  document.getElementById("terminalSpotControl").hidden = true;
  document.getElementById("terminalSpotResults").hidden = true;
  if (lane === "perps") {
    document.getElementById("venueSelect").replaceChildren(new Option("Hyperliquid", "hyperliquid"));
    if (selectDefault) {
      const selected = state.markets.some((row) => row.instrument_id === state.selected?.instrument_id)
        ? state.selected.asset
        : defaultPerp();
      if (selected) selectPerp(selected, { updateUrl });
    }
    return;
  }
  if (lane === "equity") {
    document.getElementById("venueSelect").replaceChildren(new Option("Select exact listing", "unavailable"));
    if (!selectDefault) return;
    renderExplicitSelectionUnavailable({ lane: "equity", reason: "Select an exact equity or ETF. RavenOS will not choose a listing for you." });
    return;
  }
  ++state.selectionGeneration;
  state.selected = null;
  document.getElementById("venueSelect").replaceChildren(new Option("Select exact pool", "unavailable"));
  renderSpotFacts(null);
  setText("terminalChartTitle", "Spot pool · no selection");
  setText("terminalChartStatus", "Search for an exact public pool. No default token or synthetic chart is substituted.");
  setText("terminalDeepLink", "Open Spot coverage");
  document.getElementById("terminalDeepLink").href = "/chains/solana/";
  setContextUnavailable({
    headline: "Exact spot context unavailable",
    summary: "Select a verified public pool to load provider-backed candles. Exact Raven decision context is not yet projected for spot markets.",
    reason: "Raven will not infer a token-level decision context from an unrelated pool or aggregate row.",
  });
  state.workspace.load({ market: "crypto_spot", asset: "", timeframe: state.timeframe, instrumentScope: "exact_pool" });
  updateQuoteBoundary();
  updateShell({
    subject: { id: "spot-pool-unselected", label: "No spot pool selected", type: "market", assetClass: "crypto", instrumentType: "exact_pool", identityScope: "unselected", chain: "all", venue: "all", marketType: "spot", economicNumeraire: "USDC", capabilities: {} },
    marketLabel: "Exact spot pool required",
    thesis: "No market data or Raven context is shown until an exact public pool is selected.",
    setup: "unavailable",
    evidenceState: "unavailable",
    freshnessState: "data_unavailable",
    observedAt: null,
  }, { updateUrl });
}

function createSpotResult(row, index) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "terminal-search-result";
  button.dataset.index = String(index);
  const identity = document.createElement("strong");
  identity.textContent = `${row.symbol || "UNKNOWN"}/${row.quoteSymbol || "QUOTE"}`;
  const venue = document.createElement("span");
  const coverage = row.chart_coverage || {};
  const chartLabel = coverage.request_supported ? "chart check on open" : "chart unavailable";
  const providerLabel = coverage.provider_id ? ` · ${String(coverage.provider_id).replace("_onchain", "")}` : "";
  venue.textContent = `${chainDisplayName(row.chainId)} · ${row.dexId || "venue unavailable"}${providerLabel} · ${chartLabel}`;
  const liquidity = document.createElement("span");
  liquidity.textContent = `Liquidity ${compact(row.liquidityUsd, { currency: true })}`;
  const price = document.createElement("small");
  price.textContent = formatPrice(row.priceUsd);
  button.append(identity, venue, liquidity, price);
  button.addEventListener("click", () => selectSpot(row));
  return button;
}

function rankSpotRows(rows = [], query = "") {
  const normalized = String(query || "").trim().toLowerCase();
  return [...rows].sort((left, right) => {
    const quality = (row) => {
      const exactAddress = normalized && [row.tokenAddress, row.quoteTokenAddress, row.pairAddress]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase() === normalized);
      const exactName = normalized && [row.symbol, row.name].filter(Boolean).some((value) => String(value).toLowerCase() === normalized);
      return {
        exactAddress,
        exactName,
        chartReady: spotChartCapability(row, "1h").chart_request_supported,
        volume: Math.max(0, finite(row.volume24h) || 0),
        liquidity: Math.max(0, finite(row.liquidityUsd) || 0),
      };
    };
    const a = quality(left);
    const b = quality(right);
    return Number(b.exactAddress) - Number(a.exactAddress)
      || Number(b.exactName) - Number(a.exactName)
      || Number(b.chartReady) - Number(a.chartReady)
      || Number(b.volume > 0) - Number(a.volume > 0)
      || Number(b.liquidity > 0) - Number(a.liquidity > 0)
      || b.volume - a.volume
      || b.liquidity - a.liquidity;
  });
}

function renderSpotResults(rows, message = "") {
  const host = document.getElementById("terminalSpotResults");
  host.replaceChildren();
  host.hidden = false;
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "terminal-search-empty";
    empty.textContent = message || "No verified public pool matched this search.";
    host.append(empty);
    return;
  }
  host.append(...rows.slice(0, 12).map(createSpotResult));
}

async function searchSpot(query) {
  const clean = String(query || "").trim();
  const generation = ++state.searchGeneration;
  if (clean.length < 2) {
    document.getElementById("terminalSpotResults").hidden = true;
    return;
  }
  renderSpotResults([], "Searching public market coverage…");
  try {
    const { response, payload } = await fetchJson(`/api/dexscreener/search?q=${encodeURIComponent(clean)}`);
    if (generation !== state.searchGeneration) return;
    const rows = response.ok && Array.isArray(payload?.results)
      ? rankSpotRows(payload.results.filter((row) => row?.chainId && row?.pairAddress && row?.tokenAddress && finite(row?.priceUsd) > 0), clean)
      : [];
    renderSpotResults(rows, response.ok ? "No verified public pool matched this search." : "Public spot lookup is unavailable.");
  } catch {
    if (generation === state.searchGeneration) renderSpotResults([], "Public spot lookup is unavailable.");
  }
}

async function selectSpot(row, { updateUrl = true } = {}) {
  const generation = ++state.selectionGeneration;
  state.lane = "spot";
  state.selected = row;
  state.context = null;
  setWhyLabel("Why Raven noticed this");
  setText("terminalReadTrigger", "Raven Read");
  document.getElementById("terminalSpotResults").hidden = true;
  document.getElementById("terminalSpotSearch").value = `${row.symbol || "UNKNOWN"}/${row.quoteSymbol || "QUOTE"}`;
  document.getElementById("venueSelect").replaceChildren(new Option(`${chainDisplayName(row.chainId)} · ${row.dexId || "pool"}`, String(row.chainId || "spot")));
  renderSpotFacts(row);
  setText("terminalChartTitle", `${row.symbol || "UNKNOWN"}/${row.quoteSymbol || "QUOTE"} · ${state.timeframe}`);
  setText("terminalChartStatus", "Requesting exact-pool provider candles.");
  const chartCapability = spotChartCapability(row, state.timeframe);
  const hasChartCoverage = chartCapability.chart_request_supported;
  setText("terminalDeepLink", hasChartCoverage ? `Open ${chainDisplayName(row.chainId)} coverage` : "Coverage unavailable");
  document.getElementById("terminalDeepLink").href = hasChartCoverage ? `/chains/${String(row.chainId).toLowerCase()}/` : "/docs/#availability";
  setContextUnavailable({
    headline: `${row.symbol || "Spot"} · Raven context unavailable`,
    summary: "The exact public pool chart is independent from Raven decision evidence.",
    identity: `${row.chainId || "chain"}:pool:${row.pairAddress}`,
    reason: "No deterministic exact-pool Raven decision join is currently projected. Aggregate token or chain evidence is not substituted.",
  });
  updateQuoteBoundary();
  ravenOSContext.setSelection({ subject: spotSubject(row), timeframe: state.timeframe, workspace: "market-monitor" }, { updateUrl });
  const chartState = await state.workspace.load({
    market: "crypto_spot",
    asset: `${row.symbol || "UNKNOWN"}/${row.quoteSymbol || "QUOTE"}`,
    timeframe: state.timeframe,
    chain: row.chainId,
    pairAddress: row.pairAddress,
    tokenAddress: row.tokenAddress,
    quoteAddress: row.quoteTokenAddress,
    instrumentScope: "exact_pool",
    marketIdentity: `${row.chainId}:pool:${row.pairAddress}`,
  });
  if (generation !== state.selectionGeneration) return;
  setText("terminalChartStatus", chartState?.candles?.length
    ? `${chartState.candles.length.toLocaleString()} provider-backed bars · exact pool`
    : chartState?.message || "Exact-pool candles unavailable.");
  setText("terminalCapabilityLabel", `Spot · ${row.quoteSymbol || "quote"} pool quote · ${chartState?.candles?.length ? "exact chart verified" : "chart unavailable"} · USDC economic intent`);
  updateShell({
    subject: spotSubject(row),
    marketLabel: `${row.symbol}/${row.quoteSymbol} exact pool`,
    thesis: "Provider-backed market data is available. Exact Raven decision context is unavailable and has not been inferred.",
    setup: "unavailable",
    evidenceState: "unavailable",
    freshnessState: chartState?.state || "data_unavailable",
    observedAt: chartState?.observedAt || row.lastUpdated,
  }, { updateUrl });
}

async function loadMarkets() {
  const { response, payload } = await fetchJson("/api/hyperliquid/perps");
  if (!response.ok || !payload?.ok || !Array.isArray(payload.results) || !payload.results.length) throw new Error("hyperliquid_markets_unavailable");
  state.markets = payload.results;
  const select = document.getElementById("assetSelect");
  select.replaceChildren(...state.markets.map((row) => new Option(row.asset, row.asset)));
}

async function loadPublicPerps() {
  try {
    const { response, payload } = await fetchJson("/api/perps");
    state.publicPerps = response.ok ? payload : null;
  } catch {
    state.publicPerps = null;
  }
}

function currentAtlasProjection(payload) {
  const execution = payload?.execution_boundary || {};
  const rows = payload?.market_context?.rows;
  const exactRows = Array.isArray(rows) && rows.length > 0 && rows.every((row) => (
    row?.instrument_id
    && row.instrument?.instrument_id === row.instrument_id
    && row.instrument?.identity_scope === "exact_instrument"
    && ["equity", "etf"].includes(row.instrument?.instrument_type)
    && row.instrument?.capabilities?.execution === false
  ));
  return payload?.schema_version === "ravenos.atlas_projection.v1"
    && ["available", "degraded"].includes(payload.state)
    && ["fresh", "delayed"].includes(payload.freshness?.state)
    && payload.delivery?.source === "current_public_origin"
    && payload.delivery?.fallback === false
    && exactRows
    && execution.signing_available === false
    && execution.submission_available === false;
}

async function loadAtlasProjection() {
  const { response, payload } = await fetchJson("/api/atlas");
  if (!response.ok || !currentAtlasProjection(payload)) throw new Error("atlas_current_projection_unavailable");
  state.atlas = payload;
  return payload;
}

function requestedAtlas(params) {
  const instrumentId = String(params.get("instrument_id") || params.get("subject_id") || "").trim().toLowerCase();
  const asset = String(params.get("asset") || "").trim().toUpperCase();
  const rows = state.atlas?.market_context?.rows || [];
  if (instrumentId) {
    const row = rows.find((item) => String(item.instrument_id || "").toLowerCase() === instrumentId);
    if (!row) return { error: "The exact listed instrument is not available in the current Atlas registry.", instrumentId, asset };
    if (asset && String(row.symbol || "").toUpperCase() !== asset) return { error: "The requested symbol and exact listed-instrument identity do not match.", instrumentId, asset };
    return { row };
  }
  if (asset) {
    const matches = rows.filter((item) => String(item.symbol || "").toUpperCase() === asset);
    if (matches.length !== 1) return { error: matches.length ? "The symbol is ambiguous. Select an exact listed instrument." : "The requested listed instrument is not available in the current Atlas registry.", asset };
    return { row: matches[0] };
  }
  return { error: "Select an exact equity or ETF. RavenOS will not choose a listing for you.", asset };
}

function currentListedLookup(payload, query) {
  const execution = payload?.execution_boundary || {};
  const rows = payload?.results;
  return payload?.ok === true
    && payload?.schema_version === "ravenos.instrument_lookup.v1"
    && String(payload?.query || "").toUpperCase() === String(query || "").toUpperCase()
    && payload?.delivery?.source === "current_public_origin"
    && payload?.delivery?.freshness_state === "fresh"
    && payload?.delivery?.fallback === false
    && Array.isArray(rows)
    && rows.length <= 12
    && rows.every((row) => (
      row?.schema_version === "ravenos.instrument.v1"
      && row.identity_scope === "exact_instrument"
      && ["equity", "etf"].includes(row.instrument_type)
      && row.asset_class === row.instrument_type
      && row.chain === "none"
      && row.quote_asset?.symbol === "USD"
      && row.settlement_asset?.symbol === "USD"
      && row.capabilities?.execution === false
      && row.capabilities?.quote_preview === false
    ))
    && execution.broker_connection_available === false
    && execution.quote_preview_available === false
    && execution.signing_available === false
    && execution.submission_available === false;
}

async function resolveListedSelection({ instrumentId = "", asset = "" } = {}) {
  const exactId = String(instrumentId || "").trim().toLowerCase();
  const symbol = String(asset || "").trim().toUpperCase();
  if (!exactId || !symbol) {
    return { error: "Select an exact listed instrument from universal search. RavenOS will not infer a listing from a symbol alone." };
  }
  const { response, payload } = await fetchJson(`/api/instruments/search?q=${encodeURIComponent(symbol)}`);
  if (!response.ok || !currentListedLookup(payload, symbol)) {
    return { error: "Current listed-market identity lookup is unavailable. No older listing or alternate symbol was substituted." };
  }
  const matches = payload.results.filter((row) => (
    String(row.instrument_id || "").toLowerCase() === exactId
    && String(row.symbol || "").toUpperCase() === symbol
  ));
  if (matches.length !== 1) {
    return { error: "The requested symbol and exact listed-instrument identity do not match. No substitute was loaded." };
  }
  return { row: matches[0] };
}

async function selectAtlasInstrument(row, { updateUrl = true } = {}) {
  const subject = atlasSubject(row);
  const atlasRow = row?.instrument?.schema_version === "ravenos.instrument.v1"
    && state.atlas?.market_context?.rows?.some((candidate) => candidate?.instrument_id === subject.instrumentId);
  if (!subject.instrumentId || !subject.symbol) {
    await renderExplicitSelectionUnavailable({ instrumentId: subject.instrumentId, asset: subject.symbol, lane: "equity", reason: "The selected row does not contain a complete exact listed-instrument identity." });
    return;
  }
  const generation = ++state.selectionGeneration;
  state.lane = "equity";
  state.selected = row;
  const options = atlasRow ? atlasOptionsFor(row) : null;
  state.context = atlasRow ? { atlas_context: { context_available: true, instrument_id: subject.instrumentId } } : null;
  document.getElementById("terminalModeSelect").value = "equity";
  document.getElementById("terminalSpotControl").hidden = true;
  document.getElementById("terminalSpotResults").hidden = true;
  const instrument = row?.instrument?.schema_version === "ravenos.instrument.v1" ? row.instrument : row;
  document.getElementById("venueSelect").replaceChildren(new Option(titleCase(instrument?.market_identity?.listing || subject.venue), subject.venue));
  setWhyLabel(atlasRow ? "What Atlas adds" : "Why this market");
  setText("terminalReadTrigger", atlasRow ? "Atlas Context" : "Market Context");
  if (atlasRow) renderAtlasFacts(row);
  else renderListedFacts(row);
  setText("terminalChartTitle", `${subject.symbol} · ${state.timeframe}`);
  setText("terminalChartStatus", "Requesting provider-backed candles for the exact listing.");
  setText("terminalDeepLink", atlasRow ? "Open Atlas context" : "Atlas context unavailable");
  document.getElementById("terminalDeepLink").href = atlasRow
    ? `/atlas/?instrument_id=${encodeURIComponent(subject.instrumentId)}&asset=${encodeURIComponent(subject.symbol)}`
    : "/docs/#availability";
  setText("terminalReadHeadline", atlasRow ? `${subject.symbol} · Atlas cross-market context` : `${subject.symbol} · exact listed market`);
  setText("terminalReadSummary", atlasRow
    ? `Current ${titleCase(state.atlas?.market_context?.equity_regime).toLowerCase()} equity regime and ${titleCase(state.atlas?.posture?.alignment).toLowerCase()} cross-market alignment. Atlas context is research-only.`
    : `RavenOS resolved ${subject.symbol} to ${titleCase(instrument?.market_identity?.listing || subject.venue)} with USD settlement. Current Raven and Atlas intelligence are unavailable for this exact listing.`);
  setText("terminalWhy", atlasRow
    ? options
      ? `Atlas adds ${titleCase(options.regime).toLowerCase()} aggregate options context and current rail posture. No Raven behavioral claim has been substituted.`
      : "Atlas adds current market and cross-asset context. No Raven behavioral claim or options context has been substituted."
    : "The exact provider listing matched the selected symbol and identity. RavenOS is showing market data only; no behavioral claim, analogue, or broker capability was inferred.");
  setText("terminalContextIdentity", subject.instrumentId);
  setText("terminalBehavior", "Raven evidence unavailable");
  setText("terminalPath", atlasRow ? titleCase(state.atlas?.market_context?.equity_regime) : "Unavailable");
  setText("terminalEvidenceMaturity", atlasRow ? "Atlas context only" : "Market data only");
  setText("terminalEvidenceState", atlasRow ? "Atlas context · Raven unavailable" : "Intelligence unavailable");
  setState("terminalContextFreshness", atlasRow ? state.atlas?.freshness?.state || "unavailable" : "unavailable", atlasRow ? titleCase(state.atlas?.freshness?.state) : "Unavailable");
  resetComparableEvidence();
  setText("terminalComparableNote", atlasRow
    ? "No exact matured Raven behavioral sample is projected for this listing. Atlas context is not presented as a comparable outcome set."
    : "No exact Raven or Atlas comparison is projected for this listing. Market-price history is not presented as behavioral evidence.");
  updateQuoteBoundary();
  ravenOSContext.setSelection({ subject, timeframe: state.timeframe, workspace: "market-monitor" }, { updateUrl });
  const chartState = await state.workspace.load({
    market: "equities",
    asset: subject.symbol,
    instrumentId: subject.instrumentId,
    instrumentType: subject.instrumentType,
    timeframe: state.timeframe,
    chain: "none",
    marketIdentity: subject.instrumentId,
    instrumentScope: "exact_instrument",
  });
  if (generation !== state.selectionGeneration) return;
  state.workspace.render({
    asset: subject.symbol,
    market: "equities",
    venue: subject.venue,
    chain: "none",
    timeframe: state.timeframe,
    events: [],
    overlays: [],
    visibleOverlayTypes: [],
    showVolume: true,
    chartDataSource: "terminal_chart_api",
    indicatorSourceState: "provider_backed",
  });
  setText("terminalChartStatus", chartState?.candles?.length
    ? `${chartState.candles.length.toLocaleString()} provider-backed bars · exact ${titleCase(subject.instrumentType)}`
    : chartState?.message || "Exact listed-instrument candles unavailable.");
  if (!atlasRow && chartState?.candles?.length) setText("terminalLast", formatPrice(chartState.candles.at(-1)?.close));
  updateShell({
    subject,
    marketLabel: atlasRow ? `${subject.symbol} · ${titleCase(state.atlas?.market_context?.equity_regime)} equity regime` : `${subject.symbol} · exact listed market`,
    thesis: atlasRow
      ? `Atlas cross-market alignment is ${titleCase(state.atlas?.posture?.alignment).toLowerCase()}. Raven behavioral evidence is unavailable for this exact listing and has not been inferred.`
      : "Provider-backed candles are available for the exact listing. Raven and Atlas intelligence are unavailable and have not been inferred.",
    setup: atlasRow ? state.atlas?.posture?.state || "atlas_context" : "market_data_only",
    supporting: atlasRow ? Object.entries(state.atlas?.rail_breadth || {}).slice(0, 4).map(([rail, value]) => `${titleCase(rail)}: ${titleCase(value?.trend)} trend · ${titleCase(value?.participation)} participation.`) : [],
    contradicting: atlasRow ? Object.entries(state.atlas?.provider_health || {}).filter(([, value]) => value?.degraded).map(([rail]) => `${titleCase(rail)} provider rail is degraded.`) : ["Raven and Atlas intelligence are unavailable for this exact listing."],
    evidenceState: atlasRow ? "atlas_context" : "unavailable",
    freshnessState: atlasRow ? state.atlas?.freshness?.state === "fresh" ? "live" : "delayed" : chartState?.state || "data_unavailable",
    observedAt: atlasRow ? row.observed_at || state.atlas?.generated_at : chartState?.observedAt,
  }, { updateUrl });
}

function defaultPerp(requested = "") {
  const exact = String(requested || "").toUpperCase();
  if (exact && state.markets.some((row) => row.asset === exact)) return exact;
  const contexts = state.publicPerps?.data?.instrument_context?.rows || state.publicPerps?.instrument_context?.rows;
  if (Array.isArray(contexts)) {
    const freshnessRank = { fresh: 3, delayed: 2, stale: 1 };
    const best = contexts
      .filter((row) => row?.context_available === true && state.markets.some((market) => market.asset === row.instrument))
      .sort((left, right) => (
        (freshnessRank[right.context_state] || 0) - (freshnessRank[left.context_state] || 0)
        || (finite(left.context_age_seconds) ?? Infinity) - (finite(right.context_age_seconds) ?? Infinity)
        || Number(right.outcomes?.sample_size || 0) - Number(left.outcomes?.sample_size || 0)
      ))[0];
    if (best) return best.instrument;
  }
  return state.markets.some((row) => row.asset === "SOL-PERP") ? "SOL-PERP" : state.markets[0]?.asset;
}

function requestedPerp(params) {
  const instrumentId = String(params.get("instrument_id") || params.get("subject_id") || "").trim();
  const asset = String(params.get("asset") || "").trim().toUpperCase();
  if (instrumentId) {
    const row = state.markets.find((item) => String(item.instrument_id || "").toLowerCase() === instrumentId.toLowerCase());
    if (!row) return { error: "The exact perpetual instrument is not available in the current Hyperliquid registry.", instrumentId, asset };
    if (asset && row.asset !== asset) return { error: "The requested symbol and exact instrument identity do not match.", instrumentId, asset };
    return { row };
  }
  if (asset) {
    const row = state.markets.find((item) => item.asset === asset);
    return row ? { row } : { error: "The requested perpetual symbol is not available in the current Hyperliquid registry.", asset };
  }
  return { row: null };
}

function parsePoolIdentity(value = "") {
  const parts = String(value || "").trim().split(":").filter(Boolean);
  if (parts.length === 3 && parts[1] === "pool") return { chainId: parts[0], pairAddress: parts[2] };
  if (parts.length >= 5 && parts[0] === "crypto" && parts[1] === "pool") {
    return { chainId: parts[2], pairAddress: parts.slice(4).join(":") };
  }
  return null;
}

function explicitUnavailableSubject({ instrumentId = "", asset = "", lane = "perps" } = {}) {
  const pool = parsePoolIdentity(instrumentId);
  if (pool || lane === "spot") {
    return {
      id: instrumentId || "spot-pool-unresolved",
      instrumentId: instrumentId || "spot-pool-unresolved",
      type: "pool",
      label: asset || "Requested spot market",
      symbol: asset,
      assetClass: "crypto",
      instrumentType: "exact_pool",
      identityScope: instrumentId ? "exact_pool" : "unselected",
      chain: pool?.chainId || "unknown",
      venue: "unknown",
      marketType: "spot",
      preferredCashAsset: "USDC",
      economicNumeraire: "USDC",
      capabilities: {},
    };
  }
  if (lane === "equity") {
    const instrumentType = instrumentId.startsWith("etf:") ? "etf" : "equity";
    return {
      id: instrumentId || "traditional-instrument-unresolved",
      instrumentId: instrumentId || "traditional-instrument-unresolved",
      type: "instrument",
      label: asset || "Requested listed instrument",
      symbol: asset,
      assetClass: instrumentType,
      instrumentType,
      identityScope: instrumentId ? "exact_instrument" : "unselected",
      chain: "none",
      venue: "unknown",
      marketType: "equities",
      quoteAsset: "USD",
      settlementAsset: "USD",
      preferredCashAsset: "USD",
      economicNumeraire: "USDC",
      capabilities: {},
    };
  }
  return {
    id: instrumentId || `hyperliquid:perp:${asset.replace(/-PERP$/, "") || "unknown"}`,
    instrumentId: instrumentId || `hyperliquid:perp:${asset.replace(/-PERP$/, "") || "unknown"}`,
    type: "instrument",
    label: asset || "Requested perpetual",
    symbol: asset,
    assetClass: "crypto",
    instrumentType: "perpetual",
    identityScope: "exact_instrument",
    chain: "hyperliquid",
    venue: "hyperliquid",
    marketType: "perp",
    quoteAsset: "USD",
    settlementAsset: "USDC",
    preferredCashAsset: "USDC",
    economicNumeraire: "USDC",
    capabilities: {},
  };
}

async function renderExplicitSelectionUnavailable({ instrumentId = "", asset = "", lane = "perps", reason } = {}) {
  ++state.selectionGeneration;
  state.lane = lane;
  state.selected = null;
  state.context = null;
  document.getElementById("terminalModeSelect").value = lane;
  document.getElementById("terminalSpotControl").hidden = true;
  document.getElementById("terminalSpotResults").hidden = true;
  const subject = explicitUnavailableSubject({ instrumentId, asset, lane });
  setWhyLabel(lane === "equity" ? "What Atlas adds" : "Why Raven noticed this");
  setText("terminalReadTrigger", lane === "equity" ? "Atlas Context" : "Raven Read");
  setText("terminalPickerSymbol", subject.label, "Requested market");
  setText("terminalPickerMeta", subject.id, "Exact identity unavailable");
  setText("terminalVenueLabel", subject.venue === "unknown" ? "Unresolved" : titleCase(subject.venue));
  setText("terminalCapabilityLabel", "Exact selection unavailable · no substitute loaded");
  setText("terminalInstrumentScope", subject.identityScope === "exact_pool" ? "Exact public pool" : "Exact instrument");
  setText("terminalInstrument", subject.label);
  setText("terminalInstrumentMeta", subject.id);
  setText("terminalChartTitle", `${subject.label} · unavailable`);
  setText("terminalChartStatus", reason || "The exact requested market is unavailable. RavenOS did not choose a substitute.");
  setText("terminalLast", "--");
  for (const id of ["terminalMetric2", "terminalMetric3", "terminalMetric4", "terminalMetric5", "terminalMetric6"]) setText(id, "--");
  setState("terminalMarketFreshness", "unavailable", "Unavailable");
  setContextUnavailable({
    headline: "Exact market unavailable",
    summary: "The requested identity could not be resolved against the current provider registry.",
    identity: subject.id,
    reason: reason || "No alternate symbol, pool, venue, or instrument was substituted.",
  });
  state.workspace.showUnavailable({
    message: reason || "The exact requested market is unavailable. No substitute data was loaded.",
    marketIdentity: subject.id,
    instrumentScope: subject.identityScope,
    timeframe: state.timeframe,
  });
  updateShell({
    subject,
    marketLabel: "Exact selection unavailable",
    thesis: "No market or Raven state is shown because the requested identity did not resolve exactly.",
    setup: "unavailable",
    evidenceState: "unavailable",
    freshnessState: "data_unavailable",
    observedAt: null,
  }, { updateUrl: false });
}

async function loadExactPool(instrumentId, { updateUrl = false } = {}) {
  const identity = parsePoolIdentity(instrumentId);
  if (!identity) {
    await renderExplicitSelectionUnavailable({ instrumentId, lane: "spot", reason: "The requested exact-pool identity is malformed." });
    return;
  }
  try {
    const { response, payload } = await fetchJson(`/api/dexscreener/pair?chainId=${encodeURIComponent(identity.chainId)}&pairAddress=${encodeURIComponent(identity.pairAddress)}`);
    const rows = response.ok && Array.isArray(payload?.results) ? payload.results : [];
    const row = rows.find((item) => String(item.pairAddress || "").toLowerCase() === identity.pairAddress.toLowerCase()
      && String(item.chainId || "").toLowerCase() === identity.chainId.toLowerCase());
    if (!row) {
      await renderExplicitSelectionUnavailable({ instrumentId, lane: "spot", reason: "The exact requested pool is not available from the current public provider." });
      return;
    }
    setLane("spot", { updateUrl: false, selectDefault: false });
    await selectSpot(row, { updateUrl });
  } catch {
    await renderExplicitSelectionUnavailable({ instrumentId, lane: "spot", reason: "The exact-pool provider lookup is currently unavailable." });
  }
}

function bindControls() {
  document.getElementById("terminalModeSelect").addEventListener("change", (event) => setLane(event.target.value));
  document.getElementById("assetSelect").addEventListener("change", (event) => selectPerp(event.target.value));
  document.getElementById("terminalInstrumentTrigger").addEventListener("click", () => window.RavenOSShell?.openCommandPalette?.());
  document.getElementById("terminalReadTrigger").addEventListener("click", () => window.RavenOSShell?.openContext?.());
  document.getElementById("timeframeSelect").addEventListener("change", (event) => {
    const timeframe = TIMEFRAMES.has(event.target.value) ? event.target.value : "1h";
    if (timeframe === state.timeframe) return;
    state.timeframe = timeframe;
    if (state.lane === "perps" && state.selected) selectPerp(state.selected.asset);
    else if (state.lane === "spot" && state.selected) selectSpot(state.selected);
    else if (state.lane === "equity" && state.selected) selectAtlasInstrument(state.selected);
  });
  const spotSearch = document.getElementById("terminalSpotSearch");
  spotSearch.addEventListener("input", (event) => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => searchSpot(event.target.value), 180);
  });
  spotSearch.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    document.getElementById("terminalSpotResults").hidden = true;
    spotSearch.focus();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#terminalSpotControl, #terminalSpotResults")) document.getElementById("terminalSpotResults").hidden = true;
  });
  document.getElementById("terminalMarkerClose")?.addEventListener("click", () => {
    document.getElementById("terminalMarkerDetail").hidden = true;
  });
}

function renderWorkspaceState(workspace = {}) {
  const workspaceState = workspace?.state || "unavailable";
  setState("terminalMarketFreshness", workspaceState, titleCase(workspaceState));
  setText("terminalChartStatus", workspace?.candles?.length
    ? `${workspace.candles.length.toLocaleString()} provider-backed bars · ${titleCase(workspace.connectionState)}`
    : workspace?.message || titleCase(workspaceState));
  renderSourceDetails(workspace);
  renderMarketAnatomy(workspace);
  renderTradeConsequences();
  const boundary = document.getElementById("terminalBoundary");
  if (!boundary) return;
  const connection = String(workspace?.connectionState || "").toLowerCase();
  const liveLabel = connection === "snapshot_only"
    ? "Provider snapshot available"
    : ["live", "connected"].includes(connection)
      ? "Provider market connected"
      : connection === "connecting"
        ? "Provider live feed connecting"
        : "Provider market data available";
  boundary.dataset.state = workspaceState;
  boundary.querySelector("strong").textContent = workspaceState === "live" ? liveLabel : titleCase(workspaceState);
}

function bindWorkspaceEvents() {
  document.addEventListener("ravenos:priceworkspace", (event) => {
    if (event.detail?.instrument?.canonical_id !== state.workspace?.state?.instrument?.canonical_id && event.detail?.state !== "loading") return;
    renderWorkspaceState(event.detail);
  });
  document.addEventListener("ravenos:chartmarket", (event) => {
    if (event.detail?.instrument?.canonical_id !== state.workspace?.state?.instrument?.canonical_id) return;
    if (state.lane === "perps") renderPerpFacts();
  });
}

async function loadBuildIdentity() {
  try {
    const { response, payload } = await fetchJson("/ravenos_build.json");
    setText("terminalBuildId", response.ok ? payload?.public_build_id : null, "Build unavailable");
    const marker = document.querySelector("[data-ravenos-build-id]");
    if (marker) marker.textContent = response.ok ? payload?.public_build_id || "Build unavailable" : "Build unavailable";
  } catch {
    const marker = document.querySelector("[data-ravenos-build-id]");
    if (marker) marker.textContent = "Build unavailable";
  }
}

async function boot() {
  const params = new URLSearchParams(location.search);
  state.timeframe = TIMEFRAMES.has(params.get("timeframe")) ? params.get("timeframe") : TIMEFRAMES.has(ravenOSContext.getState().timeframe) ? ravenOSContext.getState().timeframe : "1h";
  document.getElementById("timeframeSelect").value = state.timeframe;
  state.workspace = window.RavenOSPriceWorkspace?.create?.(document.getElementById("terminalChart"), {
    timeframe: state.timeframe,
    tradeLimit: 60,
    onTimeframeChange: (timeframe) => {
      if (!TIMEFRAMES.has(timeframe)) return;
      document.getElementById("timeframeSelect").value = timeframe;
      document.getElementById("timeframeSelect").dispatchEvent(new Event("change", { bubbles: true }));
    },
    onMarkerSelect: (marker) => renderMarkerDetail(marker),
  });
  if (!state.workspace) throw new Error("chart_runtime_unavailable");
  bindControls();
  bindWorkspaceEvents();
  const instrumentId = String(params.get("instrument_id") || params.get("subject_id") || "").trim();
  const poolIdentity = parsePoolIdentity(instrumentId);
  const requestedType = String(params.get("instrument_type") || "").toLowerCase();
  const requestedClass = String(params.get("asset_class") || "").toLowerCase();
  const requestedMarket = String(params.get("market") || "").toLowerCase();
  const requestedLane = params.get("lane") === "equity"
      || requestedMarket === "equities"
      || ["equity", "etf"].includes(requestedType)
      || ["equity", "etf"].includes(requestedClass)
      || /^(equity|etf):/i.test(instrumentId)
    ? "equity"
    : params.get("lane") === "spot" || requestedMarket === "spot" || requestedMarket === "crypto_spot" || requestedType === "exact_pool" || Boolean(poolIdentity)
      ? "spot"
      : "perps";
  await Promise.all([loadTradeFlags(), loadBuildIdentity()]);
  if (requestedLane === "spot") {
    if (instrumentId) await loadExactPool(instrumentId, { updateUrl: false });
    else {
      setLane("spot", { updateUrl: false, selectDefault: false });
      const query = String(params.get("search") || params.get("asset") || "").trim();
      if (query) {
        document.getElementById("terminalSpotSearch").value = query;
        await searchSpot(query);
      }
    }
  } else if (requestedLane === "equity") {
    let atlasRequest = null;
    try {
      await loadAtlasProjection();
      atlasRequest = requestedAtlas(params);
    } catch {
      state.atlas = null;
    }
    if (atlasRequest?.row) {
      await selectAtlasInstrument(atlasRequest.row, { updateUrl: false });
    } else {
      try {
        const listed = await resolveListedSelection({ instrumentId, asset: params.get("asset") || "" });
        if (listed.error) {
          await renderExplicitSelectionUnavailable({ instrumentId, asset: params.get("asset") || "", lane: "equity", reason: listed.error });
        } else {
          await selectAtlasInstrument(listed.row, { updateUrl: false });
        }
      } catch {
        await renderExplicitSelectionUnavailable({ instrumentId, asset: params.get("asset") || "", lane: "equity", reason: "Current listed-market identity lookup is unavailable. No older listing or alternate symbol was substituted." });
      }
    }
  } else {
    await Promise.all([loadMarkets(), loadPublicPerps()]);
    const request = requestedPerp(params);
    if (request.error) await renderExplicitSelectionUnavailable({ instrumentId: request.instrumentId, asset: request.asset, lane: "perps", reason: request.error });
    else await selectPerp(request.row?.asset || defaultPerp(), { updateUrl: !request.row });
  }
  window.__RAVENOS_TERMINAL__ = {
    getState: () => ({
      lane: state.lane,
      instrument: state.lane === "perps"
        ? state.selected?.asset || null
        : state.lane === "equity"
          ? state.selected?.symbol || null
          : state.selected ? `${state.selected.symbol}/${state.selected.quoteSymbol}` : null,
      instrumentId: state.workspace?.state?.instrument?.canonical_id || null,
      timeframe: state.timeframe,
      candleCount: state.workspace?.state?.candles?.length || 0,
      chartState: state.workspace?.state?.state || "unavailable",
      connectionState: state.workspace?.state?.connectionState || "disconnected",
      candleSource: state.workspace?.state?.candleSeries?.provider || null,
      sourceInterval: state.workspace?.state?.candleSeries?.source_interval || null,
      derivationState: state.workspace?.state?.derivation?.state || null,
      continuityState: state.workspace?.state?.continuity?.state || null,
      marketAnatomy: state.workspace?.state?.marketAnatomy || null,
      providerTransitionCount: state.workspace?.state?.providerTransitionCount || 0,
      contextState: state.context?.raven_context?.context_state || (state.context?.atlas_context?.context_available ? "atlas_context" : "unavailable"),
      quoteOnly: state.flags?.quote_only === true,
      signingAvailable: false,
      submissionAvailable: false,
      diagnostics: state.workspace?.diagnostics?.() || null,
      dataPlane: getChartDataPlaneDiagnostics(),
    }),
  };
}

boot().catch((error) => {
  setState("terminalMarketFreshness", "unavailable", "Unavailable");
  setState("terminalContextFreshness", "unavailable", "Unavailable");
  setText("terminalChartStatus", "The verified market path could not be established. No substitute data is shown.");
  const boundary = document.getElementById("terminalBoundary");
  if (boundary) {
    boundary.dataset.state = "unavailable";
    boundary.querySelector("strong").textContent = "Market path unavailable";
    boundary.querySelector("small").textContent = "No fallback market state was generated";
  }
  window.RavenOSShell?.setCapabilities?.({ market: "Data unavailable", wallet: "No customer session", mode: "Read only", signing: "Sign off", broadcast: "Broadcast off", evidence: "Evidence unavailable" });
  window.__RAVENOS_TERMINAL_BOOT_ERROR__ = error instanceof Error ? error.message : "terminal_boot_failed";
});
