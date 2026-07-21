import { ravenOSContext } from "./ravenos-context-store.js";
import { getChartDataPlaneDiagnostics } from "./ravenos-chart-data-plane.js";

document.body.classList.add("ros-terminal-live-shell");

const TIMEFRAMES = new Set(["5m", "15m", "1h", "4h", "1d", "1w", "1m"]);
const state = {
  lane: "perps",
  markets: [],
  publicPerps: null,
  selected: null,
  timeframe: "1h",
  workspace: null,
  context: null,
  flags: null,
  searchGeneration: 0,
  selectionGeneration: 0,
  searchTimer: null,
};

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

function unwrap(payload) {
  return payload?.data && typeof payload.data === "object" ? payload.data : payload;
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, { cache: "no-store", headers: { accept: "application/json", ...(init.headers || {}) }, ...init });
  const payload = await response.json().catch(() => null);
  return { response, payload: unwrap(payload) };
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
}

function renderSpotFacts(row = state.selected) {
  setText("terminalInstrumentScope", "Exact public pool");
  setText("terminalInstrument", row ? `${row.symbol}/${row.quoteSymbol || "QUOTE"}` : "No pool selected");
  setText("terminalInstrumentMeta", row ? `${titleCase(row.chainId)} · ${row.dexId || "venue unavailable"} · lookup snapshot` : "Search for a symbol, token, or contract");
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
    time: nearest.time,
    exact_observed_at: event.observed_at,
    event_id: event.event_id,
    instrument_id: event.instrument_id,
    lineage: event.lineage,
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

function renderPerpContext(payload) {
  state.context = payload;
  const context = payload?.raven_context || {};
  const read = payload?.raven_read || {};
  const delivery = payload?.delivery || {};
  const available = context.context_available === true;
  setText("terminalReadHeadline", read.headline || `${state.selected?.asset || "Instrument"} · Raven context unavailable`);
  setText("terminalReadSummary", read.summary || "Live market data remains available, but no frozen Raven observation joined to this instrument.");
  setText("terminalWhy", read.why_raven_noticed || context.why_raven_noticed || "No current decision-time Raven observation is available for this instrument.");
  setText("terminalContextIdentity", payload?.instrument?.instrument_id || state.selected?.instrument_id);
  setText("terminalBehavior", available ? context.behavior_family || "Observed, family unavailable" : "Unavailable");
  setText("terminalPath", available ? context.current_path || context.pressure_state || context.context_state : "Unavailable");
  setText("terminalEvidenceMaturity", available ? titleCase(context.outcomes?.evidence_maturity, "Forming") : "Unavailable");
  setText("terminalEvidenceState", available ? `${titleCase(context.context_state)} · ${titleCase(delivery.freshness_state)}` : "Context unavailable");
  setState("terminalContextFreshness", delivery.freshness_state || "unavailable", delivery.fallback ? `Fallback · ${titleCase(delivery.freshness_state)}` : titleCase(delivery.freshness_state));
  renderComparables(payload?.matured_comparables || {});
  applyContextChartEvent(payload);
  updateShell({
    subject: { id: payload?.instrument?.instrument_id || state.selected?.instrument_id, label: state.selected?.asset, type: "instrument", chain: "hyperliquid", venue: "hyperliquid", marketType: "perp" },
    marketLabel: read.headline || `${state.selected?.asset} market`,
    thesis: read.summary || "No exact Raven thesis is currently available.",
    setup: available ? context.context_state || "observed" : "unavailable",
    supporting: Array.isArray(read.what_would_strengthen) ? read.what_would_strengthen : [],
    contradicting: Array.isArray(read.what_would_weaken) ? read.what_would_weaken : [],
    evidenceState: available ? context.outcomes?.evidence_maturity || "forming" : "unavailable",
    freshnessState: delivery.freshness_state || "data_unavailable",
    observedAt: context.observed_at || payload?.market_data?.generated_at || null,
  });
}

function updateShell({ subject, marketLabel, thesis, setup, supporting = [], contradicting = [], evidenceState, freshnessState, observedAt }) {
  ravenOSContext.setSelection({ subject, timeframe: state.timeframe, workspace: "market-monitor" });
  window.RavenOSShell?.setCapabilities?.({
    market: state.workspace?.state?.state === "live" ? `Live · ${state.workspace.state.source}` : titleCase(state.workspace?.state?.state),
    wallet: "No customer session",
    mode: "Read only",
    signing: "Sign off",
    broadcast: "Broadcast off",
    evidence: evidenceState && evidenceState !== "unavailable" ? "Exact evidence linked" : "Evidence unavailable",
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
    evidenceQuality: { state: evidenceState || "unavailable", lineageComplete: Boolean(state.context?.raven_context?.context_available) },
    freshness: { state: freshnessState || "data_unavailable", observedAt },
    nextExpectedTransition: state.lane === "perps" ? "Wait for the next timestamped Raven context or market update." : "Exact spot Raven context is not yet projected.",
  });
}

function updateQuoteBoundary() {
  const flags = state.flags?.flags || {};
  const enabled = state.flags?.quote_only === true
    && flags.RAVENOS_CUSTOMER_TRADE_UI_ENABLE === true
    && flags.RAVENOS_CUSTOMER_TRADE_QUOTE_ENABLE === true;
  const selectedSolanaSpot = state.lane === "spot" && String(state.selected?.chainId || "").toLowerCase() === "solana";
  setText("terminalQuoteState", enabled ? "Preview contract enabled" : "Preview contract disabled");
  setText("terminalQuoteContract", enabled ? "Read-only review only" : "Disabled by server flags");
  setText("terminalQuoteNote", enabled && selectedSolanaSpot
    ? "A compatible reviewed-quote client may request a quote. This workspace still requests no transaction payload and exposes no signing action."
    : enabled
      ? "Quote review is limited to supported Solana pairs. Signing and submission remain unavailable."
      : "The server-side quote contract is present but disabled. No transaction payload is requested or prepared by this workspace.");
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
  document.getElementById("assetSelect").value = row.asset;
  document.getElementById("venueSelect").replaceChildren(new Option("Hyperliquid", "hyperliquid"));
  setText("terminalChartTitle", `${row.asset} · ${state.timeframe}`);
  setText("terminalChartStatus", "Requesting provider-backed candles and exact Raven context.");
  setText("terminalDeepLink", "Open Raven Perps");
  document.getElementById("terminalDeepLink").href = `/perps/?asset=${encodeURIComponent(row.asset)}&timeframe=${encodeURIComponent(state.timeframe)}`;
  renderPerpFacts();
  setContextUnavailable({ headline: "Decision context checking", identity: row.instrument_id, reason: "Exact public Raven context is being resolved." });
  updateQuoteBoundary();
  if (updateUrl) history.replaceState({}, "", `?asset=${encodeURIComponent(row.asset)}&timeframe=${encodeURIComponent(state.timeframe)}`);

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
  setText("terminalChartStatus", chartState?.candles?.length
    ? `${chartState.candles.length.toLocaleString()} provider-backed bars · ${titleCase(chartState.connectionState)}`
    : chartState?.message || "Provider-backed candles unavailable.");
  if (contextResult?.response?.ok && contextResult.payload?.ok) renderPerpContext(contextResult.payload);
  else {
    setContextUnavailable({ identity: row.instrument_id });
    updateShell({
      subject: { id: row.instrument_id, label: row.asset, type: "instrument", chain: "hyperliquid", venue: "hyperliquid", marketType: "perp" },
      marketLabel: `${row.asset} provider market`,
      thesis: "Live market data is available; exact Raven context is unavailable.",
      setup: "unavailable",
      evidenceState: "unavailable",
      freshnessState: chartState?.state || "data_unavailable",
      observedAt: chartState?.observedAt || row.observed_at,
    });
  }
}

function setLane(lane) {
  if (!new Set(["perps", "spot"]).has(lane)) return;
  state.lane = lane;
  document.getElementById("terminalModeSelect").value = lane;
  document.getElementById("terminalPerpControl").hidden = lane !== "perps";
  document.getElementById("terminalSpotControl").hidden = lane !== "spot";
  document.getElementById("terminalSpotResults").hidden = true;
  if (lane === "perps") {
    document.getElementById("venueSelect").replaceChildren(new Option("Hyperliquid", "hyperliquid"));
    selectPerp(state.selected?.asset?.endsWith("-PERP") ? state.selected.asset : state.markets[0]?.asset || "SOL-PERP");
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
  history.replaceState({}, "", `?lane=spot&timeframe=${encodeURIComponent(state.timeframe)}`);
  updateShell({
    subject: { id: "spot-pool-unselected", label: "No spot pool selected", type: "market", chain: "all", venue: "all", marketType: "spot" },
    marketLabel: "Exact spot pool required",
    thesis: "No market data or Raven context is shown until an exact public pool is selected.",
    setup: "unavailable",
    evidenceState: "unavailable",
    freshnessState: "data_unavailable",
    observedAt: null,
  });
}

function createSpotResult(row, index) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "terminal-search-result";
  button.dataset.index = String(index);
  const identity = document.createElement("strong");
  identity.textContent = `${row.symbol || "UNKNOWN"}/${row.quoteSymbol || "QUOTE"}`;
  const venue = document.createElement("span");
  venue.textContent = `${titleCase(row.chainId)} · ${row.dexId || "venue unavailable"}`;
  const liquidity = document.createElement("span");
  liquidity.textContent = `Liquidity ${compact(row.liquidityUsd, { currency: true })}`;
  const price = document.createElement("small");
  price.textContent = formatPrice(row.priceUsd);
  button.append(identity, venue, liquidity, price);
  button.addEventListener("click", () => selectSpot(row));
  return button;
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
    const rows = response.ok && Array.isArray(payload?.results) ? payload.results.filter((row) => row?.pairAddress && row?.tokenAddress && finite(row?.priceUsd) > 0) : [];
    renderSpotResults(rows, response.ok ? "No verified public pool matched this search." : "Public spot lookup is unavailable.");
  } catch {
    if (generation === state.searchGeneration) renderSpotResults([], "Public spot lookup is unavailable.");
  }
}

async function selectSpot(row) {
  const generation = ++state.selectionGeneration;
  state.lane = "spot";
  state.selected = row;
  state.context = null;
  document.getElementById("terminalSpotResults").hidden = true;
  document.getElementById("terminalSpotSearch").value = `${row.symbol || "UNKNOWN"}/${row.quoteSymbol || "QUOTE"}`;
  document.getElementById("venueSelect").replaceChildren(new Option(`${titleCase(row.chainId)} · ${row.dexId || "pool"}`, String(row.chainId || "spot")));
  renderSpotFacts(row);
  setText("terminalChartTitle", `${row.symbol || "UNKNOWN"}/${row.quoteSymbol || "QUOTE"} · ${state.timeframe}`);
  setText("terminalChartStatus", "Requesting exact-pool provider candles.");
  setText("terminalDeepLink", `Open ${titleCase(row.chainId)} coverage`);
  document.getElementById("terminalDeepLink").href = ["solana", "base", "ethereum"].includes(String(row.chainId || "").toLowerCase()) ? `/chains/${String(row.chainId).toLowerCase()}/` : "/chains/solana/";
  setContextUnavailable({
    headline: `${row.symbol || "Spot"} · Raven context unavailable`,
    summary: "The exact public pool chart is independent from Raven decision evidence.",
    identity: `${row.chainId || "chain"}:pool:${row.pairAddress}`,
    reason: "No deterministic exact-pool Raven decision join is currently projected. Aggregate token or chain evidence is not substituted.",
  });
  updateQuoteBoundary();
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
  updateShell({
    subject: { id: `${row.chainId}:pool:${row.pairAddress}`, label: `${row.symbol}/${row.quoteSymbol}`, type: "pool", chain: row.chainId, venue: row.dexId, marketType: "spot" },
    marketLabel: `${row.symbol}/${row.quoteSymbol} exact pool`,
    thesis: "Provider-backed market data is available. Exact Raven decision context is unavailable and has not been inferred.",
    setup: "unavailable",
    evidenceState: "unavailable",
    freshnessState: chartState?.state || "data_unavailable",
    observedAt: chartState?.observedAt || row.lastUpdated,
  });
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
        || Number(right.outcomes?.sample_size || 0) - Number(left.outcomes?.sample_size || 0)
        || Number(left.context_age_seconds || Infinity) - Number(right.context_age_seconds || Infinity)
      ))[0];
    if (best) return best.instrument;
  }
  return state.markets.some((row) => row.asset === "SOL-PERP") ? "SOL-PERP" : state.markets[0]?.asset;
}

function bindControls() {
  document.getElementById("terminalModeSelect").addEventListener("change", (event) => setLane(event.target.value));
  document.getElementById("assetSelect").addEventListener("change", (event) => selectPerp(event.target.value));
  document.getElementById("timeframeSelect").addEventListener("change", (event) => {
    const timeframe = TIMEFRAMES.has(event.target.value) ? event.target.value : "1h";
    if (timeframe === state.timeframe) return;
    state.timeframe = timeframe;
    if (state.lane === "perps" && state.selected) selectPerp(state.selected.asset);
    else if (state.lane === "spot" && state.selected) selectSpot(state.selected);
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
}

function bindWorkspaceEvents() {
  document.addEventListener("ravenos:priceworkspace", (event) => {
    if (event.detail?.instrument?.canonical_id !== state.workspace?.state?.instrument?.canonical_id && event.detail?.state !== "loading") return;
    const workspaceState = event.detail?.state || "unavailable";
    setState("terminalMarketFreshness", workspaceState, titleCase(workspaceState));
    setText("terminalChartStatus", event.detail?.candles?.length
      ? `${event.detail.candles.length.toLocaleString()} provider-backed bars · ${titleCase(event.detail.connectionState)}`
      : event.detail?.message || titleCase(workspaceState));
    const boundary = document.getElementById("terminalBoundary");
    if (boundary) {
      boundary.dataset.state = workspaceState;
      boundary.querySelector("strong").textContent = workspaceState === "live" ? "Provider market connected" : titleCase(workspaceState);
    }
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
  });
  if (!state.workspace) throw new Error("chart_runtime_unavailable");
  bindControls();
  bindWorkspaceEvents();
  await Promise.all([loadMarkets(), loadPublicPerps(), loadTradeFlags(), loadBuildIdentity()]);
  if (params.get("lane") === "spot") {
    setLane("spot");
  } else {
    await selectPerp(defaultPerp(params.get("asset")), { updateUrl: false });
  }
  window.__RAVENOS_TERMINAL__ = {
    getState: () => ({
      lane: state.lane,
      instrument: state.lane === "perps" ? state.selected?.asset || null : state.selected ? `${state.selected.symbol}/${state.selected.quoteSymbol}` : null,
      instrumentId: state.workspace?.state?.instrument?.canonical_id || null,
      timeframe: state.timeframe,
      candleCount: state.workspace?.state?.candles?.length || 0,
      chartState: state.workspace?.state?.state || "unavailable",
      connectionState: state.workspace?.state?.connectionState || "disconnected",
      contextState: state.context?.raven_context?.context_state || "unavailable",
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
