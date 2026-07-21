import { ravenOSContext } from "./ravenos-context-store.js";
import { getChartDataPlaneDiagnostics } from "./ravenos-chart-data-plane.js";

const TIMEFRAMES = Object.freeze(["5m", "15m", "1h", "4h", "1d", "1w"]);
const state = {
  rows: [],
  row: null,
  timeframe: TIMEFRAMES.includes(ravenOSContext.getState().timeframe) ? ravenOSContext.getState().timeframe : "1h",
  publicPerps: null,
  context: null,
  workspace: null,
  marketState: {},
  orderBook: null,
  tapeRows: [],
  selectionGeneration: 0,
};

function finite(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function price(value) {
  const result = finite(value);
  if (result === null || result <= 0) return "--";
  if (result >= 1000) return `$${result.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (result >= 1) return `$${result.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  return `$${result.toLocaleString("en-US", { maximumSignificantDigits: 7 })}`;
}

function compact(value) {
  const result = finite(value);
  if (result === null) return "--";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(result);
}

function rate(value, scale = 100) {
  const result = finite(value);
  if (result === null) return "--";
  const scaled = result * scale;
  return `${scaled >= 0 ? "+" : ""}${scaled.toFixed(Math.abs(scaled) < 0.1 ? 4 : 2)}%`;
}

function percentagePoint(value) {
  const result = finite(value);
  if (result === null) return "--";
  return `${result >= 0 ? "+" : ""}${result.toFixed(Math.abs(result) < 1 ? 2 : 1)}%`;
}

function titleCase(value, fallback = "Unavailable") {
  const clean = String(value || "").trim();
  if (!clean) return fallback;
  return clean.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function timestamp(value, { timeOnly = false } = {}) {
  const parsed = new Date(value || "");
  if (Number.isNaN(parsed.getTime())) return timeOnly ? "--" : "Timestamp unavailable";
  return new Intl.DateTimeFormat("en", {
    month: timeOnly ? undefined : "short",
    day: timeOnly ? undefined : "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: timeOnly ? "2-digit" : undefined,
    hour12: false,
    timeZone: "UTC",
  }).format(parsed) + (timeOnly ? "" : " UTC");
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value === null || value === undefined || value === "" ? "--" : String(value);
}

function setState(id, value, label = null) {
  const element = document.getElementById(id);
  if (!element) return;
  element.dataset.state = String(value || "unavailable").toLowerCase();
  element.textContent = label || titleCase(value);
}

function setList(id, values, fallback) {
  const host = document.getElementById(id);
  if (!host) return;
  host.replaceChildren();
  const rows = Array.isArray(values) && values.length ? values.slice(0, 3) : [fallback];
  for (const value of rows) {
    const item = document.createElement("li");
    item.textContent = String(value || fallback);
    host.append(item);
  }
}

function marketSnapshot(row = state.row, streamed = state.marketState, exact = state.context?.market_data?.market) {
  return {
    last: finite(streamed.last ?? exact?.last_price ?? exact?.lastPrice ?? row?.last_price ?? row?.lastPrice),
    mark: finite(streamed.mark ?? exact?.mark_price ?? exact?.markPx ?? row?.mark_price ?? row?.markPx),
    oracle: finite(streamed.oracle ?? exact?.oracle_price ?? exact?.oraclePx ?? row?.oracle_price ?? row?.oraclePx),
    mid: finite(streamed.mid ?? exact?.mid_price ?? exact?.midPx ?? row?.mid_price ?? row?.midPx),
    funding: finite(streamed.funding ?? exact?.funding_rate ?? exact?.funding ?? row?.funding_rate ?? row?.funding),
    openInterestUsd: finite(exact?.open_interest_usd ?? row?.open_interest_usd),
    openInterestBase: finite(streamed.open_interest ?? exact?.open_interest_base ?? exact?.openInterest ?? row?.open_interest_base ?? row?.openInterest),
    volume24h: finite(streamed.volume_24h ?? exact?.day_notional_volume_usd ?? exact?.dayNtlVlm ?? row?.day_notional_volume_usd ?? row?.dayNtlVlm),
    previousDayPrice: finite(streamed.previous_day_price ?? exact?.previous_day_price ?? exact?.prevDayPx ?? row?.previous_day_price ?? row?.prevDayPx),
  };
}

function renderMarket() {
  const market = marketSnapshot();
  setText("perpsLast", price(market.last));
  setText("perpsMark", price(market.mark));
  setText("perpsOracle", price(market.oracle));
  setText("perpsFunding", rate(market.funding));
  const openInterestUsd = market.openInterestUsd ?? (
    market.openInterestBase !== null && (market.mark || market.last)
      ? market.openInterestBase * (market.mark || market.last)
      : null
  );
  setText("perpsOpenInterest", openInterestUsd === null ? "--" : `$${compact(openInterestUsd)}`);
  setText("perpsVolume", market.volume24h === null ? "--" : `$${compact(market.volume24h)}`);
  const change = market.last && market.previousDayPrice ? market.last / market.previousDayPrice - 1 : null;
  setText("perpsChange", change === null ? "--" : rate(change));
  document.getElementById("perpsChange")?.classList.toggle("perps-positive", change !== null && change >= 0);
  document.getElementById("perpsChange")?.classList.toggle("perps-negative", change !== null && change < 0);
}

function renderBook(book = state.orderBook) {
  const host = document.getElementById("perpsBook");
  if (!host) return;
  const bids = (Array.isArray(book?.bids) ? book.bids : []).filter((row) => finite(row?.price) && finite(row?.size) !== null).slice(0, 12);
  const asks = (Array.isArray(book?.asks) ? book.asks : []).filter((row) => finite(row?.price) && finite(row?.size) !== null).slice(0, 12);
  host.replaceChildren();
  if (!bids.length || !asks.length) {
    const empty = document.createElement("div");
    empty.className = "perps-empty";
    empty.textContent = "Order-book snapshot unavailable.";
    host.append(empty);
    setText("perpsBookState", "Unavailable");
    return;
  }
  const maxSize = Math.max(...bids.map((row) => finite(row.size) || 0), ...asks.map((row) => finite(row.size) || 0), 1);
  const appendLevel = (row, side) => {
    const line = document.createElement("div");
    line.className = `perps-book-row ${side}`;
    line.style.setProperty("--depth", `${Math.min(100, ((finite(row.size) || 0) / maxSize) * 100).toFixed(1)}%`);
    const values = [price(row.price), compact(row.size), Math.trunc(finite(row.order_count ?? row.orders) || 0)];
    for (const value of values) {
      const cell = document.createElement("span");
      cell.textContent = String(value);
      line.append(cell);
    }
    host.append(line);
  };
  asks.slice().reverse().forEach((row) => appendLevel(row, "ask"));
  const summary = book?.summary || {};
  const bestBid = finite(summary.best_bid ?? bids[0]?.price);
  const bestAsk = finite(summary.best_ask ?? asks[0]?.price);
  const mid = bestBid && bestAsk ? (bestAsk + bestBid) / 2 : null;
  const spread = finite(summary.spread_bps) ?? (mid ? ((bestAsk - bestBid) / mid) * 10_000 : null);
  const separator = document.createElement("div");
  separator.className = "perps-book-spread";
  const spreadLabel = document.createElement("span");
  spreadLabel.textContent = "Spread";
  const spreadValue = document.createElement("strong");
  spreadValue.textContent = spread === null ? "--" : `${spread.toFixed(2)} bps`;
  separator.append(spreadLabel, spreadValue);
  host.append(separator);
  bids.forEach((row) => appendLevel(row, "bid"));
  setText("perpsBookState", `${Math.max(bids.length, asks.length)} levels / side`);
}

function normalizeTapeRow(row = {}) {
  const observed = row.observed_at || (finite(row.time) !== null ? new Date(finite(row.time) > 10_000_000_000 ? finite(row.time) : finite(row.time) * 1000).toISOString() : null);
  const side = row.book_side || (row.side === "buy" ? "bid" : row.side === "sell" ? "ask" : "unknown");
  const rowPrice = finite(row.price);
  const size = finite(row.size);
  if (!observed || rowPrice === null || size === null) return null;
  return {
    observed_at: observed,
    book_side: side,
    price: rowPrice,
    size,
    notional_usd: finite(row.notional_usd) ?? rowPrice * size,
  };
}

function renderTape(rows = state.tapeRows) {
  const host = document.getElementById("perpsTape");
  if (!host) return;
  host.replaceChildren();
  const safeRows = (Array.isArray(rows) ? rows : []).map(normalizeTapeRow).filter(Boolean).slice(0, 40);
  state.tapeRows = safeRows;
  if (!safeRows.length) {
    const empty = document.createElement("div");
    empty.className = "perps-empty";
    empty.textContent = "Recent public trades unavailable.";
    host.append(empty);
    setText("perpsTapeState", "Unavailable");
    return;
  }
  for (const row of safeRows) {
    const line = document.createElement("div");
    line.className = `perps-tape-row ${row.book_side}`;
    for (const value of [timestamp(row.observed_at, { timeOnly: true }), price(row.price), `$${compact(row.notional_usd)}`]) {
      const cell = document.createElement("span");
      cell.textContent = value;
      line.append(cell);
    }
    host.append(line);
  }
  setText("perpsTapeState", `${safeRows.length} public trades`);
}

function renderComparables(comparables = {}) {
  const sample = Math.max(0, Math.trunc(finite(comparables.sample_size) || 0));
  setText("perpsComparableN", sample.toLocaleString());
  setText("perpsComparableMaturity", titleCase(comparables.evidence_maturity, "Forming"));
  setText("perpsMedianChange", percentagePoint(comparables.median_observed_change_pct));
  setText("perpsMedianFavorable", percentagePoint(comparables.median_favorable_excursion_pct));
  setText("perpsMedianAdverse", percentagePoint(comparables.median_adverse_excursion_pct));
  const positive = finite(comparables.positive_followthrough_rate);
  setText("perpsPositiveRate", positive === null ? "--" : `${(positive * 100).toFixed(1)}%`);
  setText("perpsComparableNote", sample
    ? `${sample} completed future-only ${state.row?.asset || "instrument"} path${sample === 1 ? "" : "s"}; matured through ${timestamp(comparables.matured_through)}.`
    : "No matured same-instrument public sample is available yet.");
}

function renderPlan(plan = {}) {
  const available = plan.state === "research_only";
  setText("perpsPlanState", available ? "Research only" : "Unavailable");
  setText("perpsPlanDirection", available ? titleCase(plan.directional_context) : "--");
  setText("perpsPlanReference", available ? price(plan.reference_price) : "--");
  setText("perpsPlanHorizon", available ? plan.review_horizon || "Research window" : "--");
  setText("perpsPlanSample", Math.max(0, Math.trunc(finite(plan.sample_size) || 0)).toLocaleString());
  setText("perpsPlanNote", available
    ? `${plan.note || "Historical excursions are context only."} Not personalized, production-qualified, or executable.`
    : "Not personalized. Not production-qualified. No entry, target, stop, signing, or order is available.");
}

function chartPresentationEvent() {
  const event = state.context?.chart_event;
  const context = state.context?.raven_context;
  const candles = state.workspace?.state?.candles || [];
  const observedSeconds = Math.trunc(Date.parse(event?.observed_at || "") / 1000);
  if (!event?.event_id || !event?.instrument_id || !event?.lineage?.public_context_id || !Number.isFinite(observedSeconds) || !candles.length) return null;
  const nearest = candles.reduce((best, candle) => (
    Math.abs(Number(candle.time) - observedSeconds) < Math.abs(Number(best.time) - observedSeconds) ? candle : best
  ), candles[0]);
  return {
    type: "opportunity-marker",
    severity: "info",
    time: nearest.time,
    exact_observed_at: event.observed_at,
    time_semantics: "nearest_provider_candle_to_exact_observation",
    event_id: event.event_id,
    instrument_id: event.instrument_id,
    lineage: event.lineage,
    price: finite(context?.entry_reference?.price),
  };
}

function renderChartLayers() {
  if (!state.workspace || !state.row) return;
  const markerEnabled = document.getElementById("perpsRavenMarker")?.getAttribute("aria-pressed") === "true";
  const chartEvent = chartPresentationEvent();
  state.workspace.attachIntelligence({ evidence: state.context, narrator: null });
  state.workspace.render({
    events: markerEnabled && chartEvent ? [chartEvent] : [],
    overlays: [],
    visibleOverlayTypes: [],
    showVolume: true,
    chartDataSource: "terminal_chart_api",
    indicatorSourceState: "provider_backed",
    asset: state.row.asset,
    market: "perp",
    venue: "hyperliquid",
    chain: "hyperliquid",
    timeframe: state.timeframe,
  });
}

function renderContext(payload) {
  state.context = payload;
  const context = payload?.raven_context || {};
  const read = payload?.raven_read || {};
  const delivery = payload?.delivery || {};
  const marketData = payload?.market_data || {};
  state.orderBook = marketData.book || state.orderBook;
  state.tapeRows = marketData.tape?.trades || state.tapeRows;

  setState("perpsMarketFreshness", marketData.components?.market || "unavailable", titleCase(marketData.components?.market));
  setState("perpsContextState", context.context_state || "unavailable", context.context_available ? titleCase(context.context_state) : "Unavailable");
  setState("perpsDeliveryState", delivery.freshness_state || "unavailable", delivery.fallback ? `Fallback · ${titleCase(delivery.freshness_state)}` : titleCase(delivery.freshness_state));
  setText("perpsObservedAt", timestamp(context.observed_at || marketData.generated_at));
  setText("perpsContinuityMessage", delivery.fallback
    ? "Current-origin projection is unavailable. A labeled embedded snapshot is shown; it is not presented as current."
    : delivery.source === "current_public_origin"
      ? "Live venue facts and the protected current Raven projection are joined by exact instrument identity."
      : "Live market data may remain available while Raven context is explicitly unavailable.");

  setText("perpsReadHeadline", read.headline || `${state.row?.asset || "Instrument"} · Raven context unavailable`);
  setText("perpsReadSummary", read.summary || "Live market data remains available, but no current frozen Raven observation is available.");
  setText("perpsWhy", read.why_raven_noticed || context.why_raven_noticed || "No current decision-time Raven observation is available for this instrument.");
  setText("perpsPathFamily", context.behavior_family || "Unavailable");
  setText("perpsPathPressure", context.pressure_state || "Unavailable");
  setText("perpsPathSide", context.context_available ? titleCase(context.observed_side) : "Unavailable");
  const friction = finite(context.friction_context?.roundtrip_bps);
  setText("perpsPathFriction", context.friction_context?.state === "observed" && friction !== null ? `${friction.toFixed(2)} bps` : "Unavailable");
  setList("perpsStrengthen", read.what_would_strengthen, "No strengthening condition is currently declared.");
  setList("perpsWeaken", read.what_would_weaken, "No weakening condition is currently declared.");
  setText("perpsEvidenceState", context.context_available ? `${titleCase(context.context_state)} · ${titleCase(context.outcomes?.evidence_maturity, "forming")}` : "Context unavailable");

  renderComparables(payload?.matured_comparables || {});
  renderPlan(payload?.plan_preview || {});
  renderBook(state.orderBook);
  renderTape(state.tapeRows);

  const marker = document.getElementById("perpsRavenMarker");
  const eventAvailable = Boolean(payload?.chart_event?.event_id && payload?.chart_event?.observed_at);
  marker.disabled = !eventAvailable;
  marker.textContent = eventAvailable ? "Raven event" : "Raven event unavailable";
  marker.setAttribute("aria-pressed", eventAvailable ? "true" : "false");
  setText("perpsChartEventState", eventAvailable ? `Exact observation ${timestamp(payload.chart_event.observed_at)}` : "No exact event for this instrument");

  setText("perpsProofMarket", [marketData.components?.book, marketData.components?.tape].every((value) => value === "fresh") ? "Live, privacy-bounded" : "Partially unavailable");
  setText("perpsProofContext", context.context_available ? `${titleCase(context.context_state)} public projection` : "Explicitly unavailable");
  renderChartLayers();
  dispatchContext();
}

function renderContextUnavailable() {
  renderContext({
    ok: false,
    raven_context: { context_available: false, context_state: "unavailable", outcomes: {}, friction_context: {} },
    raven_read: {
      headline: `${state.row?.asset || "Instrument"} · Raven context unavailable`,
      summary: "Live chart data can continue independently, but the exact public Raven projection could not be verified.",
      why_raven_noticed: "No verified public decision context is available.",
      what_would_strengthen: [],
      what_would_weaken: [],
    },
    matured_comparables: {},
    plan_preview: { state: "unavailable" },
    market_data: { components: { market: "unavailable", book: "unavailable", tape: "unavailable" } },
    delivery: { source: "unavailable", freshness_state: "unavailable", fallback: false },
    chart_event: null,
  });
}

function dispatchContext() {
  if (!state.row) return;
  const context = state.context?.raven_context || {};
  const read = state.context?.raven_read || {};
  document.dispatchEvent(new CustomEvent("ravenos:terminalcontext", { detail: {
    subject: {
      id: context.instrument_id || state.row.instrument_id,
      type: "market",
      label: state.row.asset,
      symbol: state.row.symbol,
      chain: "hyperliquid",
      venue: "hyperliquid",
      marketType: "perp",
    },
    workspace: "market-monitor",
    marketState: context.pressure_state || "Live market only",
    setupState: context.context_available ? "research_observation" : "unavailable",
    thesis: read.summary || "No current Raven thesis is available for this exact instrument.",
    supportingEvidence: read.what_would_strengthen || [],
    contradictingEvidence: read.what_would_weaken || [],
    invalidation: context.context_available ? ["The frozen decision-time structure fades or reverses."] : [],
    timeHorizon: state.timeframe,
    confidence: { label: titleCase(context.outcomes?.evidence_maturity, "unrated") },
    evidenceQuality: { state: context.context_available ? context.context_state : "unavailable", lineageComplete: Boolean(context.public_context_id) },
    dataState: state.workspace?.state?.state || "data_unavailable",
    observedAt: context.observed_at || state.workspace?.state?.observedAt,
    marketSource: state.workspace?.state?.source || "Hyperliquid",
    sourceReferences: [state.workspace?.state?.source, context.public_context_id ? "Public Raven context" : null].filter(Boolean),
  } }));
}

async function fetchSelectedContext(row, generation) {
  try {
    const response = await fetch(`/api/perps/instrument?symbol=${encodeURIComponent(row.symbol)}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (generation !== state.selectionGeneration) return;
    if (!response.ok || !payload || typeof payload !== "object") renderContextUnavailable();
    else renderContext(payload);
  } catch {
    if (generation === state.selectionGeneration) renderContextUnavailable();
  }
}

async function selectInstrument(asset, { updateContext = true } = {}) {
  const row = state.rows.find((item) => item.asset === asset) || state.rows[0];
  if (!row) return;
  const generation = ++state.selectionGeneration;
  state.row = row;
  state.context = null;
  state.marketState = {};
  state.orderBook = null;
  state.tapeRows = [];
  document.getElementById("perpsInstrument").value = row.asset;
  setText("perpsInstrumentTitle", row.asset);
  setText("perpsVenueState", "Hyperliquid · requesting exact market");
  setState("perpsContextState", "checking", "Checking");
  setState("perpsDeliveryState", "checking", "Checking");
  renderMarket();
  renderBook(null);
  renderTape([]);

  const chartPromise = state.workspace.load({
    market: "perpetuals",
    asset: row.asset,
    timeframe: state.timeframe,
    chain: "hyperliquid",
    marketIdentity: row.instrument_id,
    limit: 240,
  });
  const contextPromise = fetchSelectedContext(row, generation);
  const chartResult = await chartPromise;
  if (generation !== state.selectionGeneration) return;
  state.marketState = { ...(chartResult.marketState || {}) };
  setText("perpsVenueState", `Hyperliquid · ${titleCase(chartResult.connectionState || chartResult.state)}`);
  setText("perpsProofCandles", chartResult.candles?.length ? `${chartResult.candles.length} provider candles · ${titleCase(chartResult.state)}` : "Provider candles unavailable");
  setState("perpsMarketFreshness", chartResult.state || "unavailable", titleCase(chartResult.state));
  renderMarket();
  await contextPromise;
  if (generation !== state.selectionGeneration) return;
  renderChartLayers();
  if (updateContext) {
    ravenOSContext.setSelection({
      subject: { id: row.instrument_id, type: "market", label: row.asset, symbol: row.symbol, chain: "hyperliquid", venue: "hyperliquid", marketType: "perp" },
      timeframe: state.timeframe,
      workspace: "market-monitor",
    });
  }
}

function buildTimeframes() {
  const host = document.getElementById("perpsTimeframes");
  host.replaceChildren(...TIMEFRAMES.map((timeframe) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = timeframe;
    button.setAttribute("aria-pressed", timeframe === state.timeframe ? "true" : "false");
    button.addEventListener("click", async () => {
      if (timeframe === state.timeframe) return;
      state.timeframe = timeframe;
      ravenOSContext.setContext({ timeframe });
      buildTimeframes();
      await selectInstrument(state.row?.asset || "SOL-PERP");
    });
    return button;
  }));
}

async function loadPublicPerps() {
  try {
    const response = await fetch("/api/perps", { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    state.publicPerps = response.ok ? payload : null;
  } catch {
    state.publicPerps = null;
  }
}

async function loadMarkets() {
  const response = await fetch("/api/hyperliquid/perps", { cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok || !Array.isArray(payload.results) || !payload.results.length) throw new Error("markets_unavailable");
  state.rows = payload.results;
  const select = document.getElementById("perpsInstrument");
  select.replaceChildren(...state.rows.map((row) => {
    const option = document.createElement("option");
    option.value = row.asset;
    option.textContent = row.asset;
    return option;
  }));
}

function defaultInstrument() {
  const stored = ravenOSContext.getState().subject;
  if (stored.marketType === "perp" && state.rows.some((row) => row.asset === stored.label)) return stored.label;
  const contexts = state.publicPerps?.data?.instrument_context?.rows;
  if (Array.isArray(contexts)) {
    const best = contexts
      .filter((row) => row?.context_available && state.rows.some((market) => market.asset === row.instrument))
      .sort((left, right) => {
        const freshness = { fresh: 2, delayed: 1 };
        return (freshness[right.context_state] || 0) - (freshness[left.context_state] || 0)
          || Number(right.outcomes?.sample_size || 0) - Number(left.outcomes?.sample_size || 0)
          || Number(left.context_age_seconds || Infinity) - Number(right.context_age_seconds || Infinity);
      })[0];
    if (best) return best.instrument;
  }
  return state.rows.some((row) => row.asset === "SOL-PERP") ? "SOL-PERP" : state.rows[0]?.asset;
}

function bindMobilePanes() {
  document.querySelectorAll("[data-perps-mobile-pane]").forEach((button) => {
    button.addEventListener("click", () => {
      const pane = button.dataset.perpsMobilePane || "chart";
      const workspace = document.querySelector(".perps-workspace");
      workspace?.classList.remove("perps-mobile-pane-market", "perps-mobile-pane-raven");
      if (pane !== "chart") workspace?.classList.add(`perps-mobile-pane-${pane}`);
      document.querySelectorAll("[data-perps-mobile-pane]").forEach((item) => item.setAttribute("aria-pressed", item === button ? "true" : "false"));
      if (pane === "chart") requestAnimationFrame(() => state.workspace?.chartHandle?.resize?.());
    });
  });
}

async function boot() {
  state.workspace = window.RavenOSPriceWorkspace?.create?.(document.getElementById("perpsChart"), {
    timeframe: state.timeframe,
    tradeLimit: 80,
    fluidHeight: true,
    onTimeframeChange: async (timeframe) => {
      if (!TIMEFRAMES.includes(timeframe) || timeframe === state.timeframe) return;
      state.timeframe = timeframe;
      buildTimeframes();
      await selectInstrument(state.row?.asset || "SOL-PERP");
    },
  });
  if (!state.workspace) throw new Error("chart_runtime_unavailable");
  buildTimeframes();
  bindMobilePanes();
  document.getElementById("perpsInstrument").addEventListener("change", (event) => selectInstrument(event.target.value));
  document.getElementById("perpsRavenMarker").addEventListener("click", (event) => {
    if (event.currentTarget.disabled) return;
    event.currentTarget.setAttribute("aria-pressed", event.currentTarget.getAttribute("aria-pressed") === "true" ? "false" : "true");
    renderChartLayers();
  });

  document.addEventListener("ravenos:chartmarket", (event) => {
    if (event.detail?.instrument?.canonical_id !== state.workspace?.state?.instrument?.canonical_id) return;
    state.marketState = { ...state.marketState, ...(event.detail.marketState || {}) };
    state.orderBook = event.detail.orderBook || state.orderBook;
    renderMarket();
    renderBook(state.orderBook);
    setText("perpsVenueState", `Hyperliquid · ${titleCase(state.workspace.state.connectionState)}`);
  });
  document.addEventListener("ravenos:chartevent", (event) => {
    if (event.detail?.instrument_id !== state.workspace?.state?.instrument?.canonical_id) return;
    if (event.detail.type === "trade.append") {
      const row = normalizeTapeRow(event.detail.payload);
      if (row) renderTape([row, ...state.tapeRows].slice(0, 40));
    }
  });
  document.addEventListener("ravenos:priceworkspace", (event) => {
    if (event.detail?.instrument?.canonical_id !== state.workspace?.state?.instrument?.canonical_id) return;
    setText("perpsVenueState", `Hyperliquid · ${titleCase(event.detail.connectionState || event.detail.state)}`);
    setState("perpsMarketFreshness", event.detail.state || "unavailable", titleCase(event.detail.state));
  });

  await Promise.all([loadPublicPerps(), loadMarkets()]);
  await selectInstrument(defaultInstrument(), { updateContext: false });
  window.RavenOSShell?.setCapabilities?.({
    market: "Live Hyperliquid",
    wallet: "No account session",
    mode: "Read only",
    signing: "Sign off",
    broadcast: "Broadcast off",
    evidence: state.context?.raven_context?.context_available ? "Exact evidence linked" : "Evidence unavailable",
  });

  setInterval(() => {
    if (document.visibilityState !== "visible" || !state.row) return;
    fetchSelectedContext(state.row, state.selectionGeneration);
  }, 60_000);

  window.__RAVENOS_PERPS_WORKSPACE__ = {
    getState: () => ({
      instrument: state.row?.asset || null,
      instrumentId: state.context?.instrument?.instrument_id || state.row?.instrument_id || null,
      timeframe: state.timeframe,
      candleCount: state.workspace?.state?.candles?.length || 0,
      backfillCount: state.workspace?.state?.backfillCount || 0,
      source: state.workspace?.state?.source || null,
      connectionState: state.workspace?.state?.connectionState || null,
      contextState: state.context?.raven_context?.context_state || "unavailable",
      deliveryState: state.context?.delivery?.freshness_state || "unavailable",
      comparableSample: state.context?.matured_comparables?.sample_size || 0,
      planExecutable: state.context?.plan_preview?.executable === true,
      hasOrderBook: Boolean(state.orderBook?.bids?.length && state.orderBook?.asks?.length),
      tapeCount: state.tapeRows.length,
      workspaceDiagnostics: state.workspace?.diagnostics?.() || null,
      diagnostics: getChartDataPlaneDiagnostics(),
    }),
  };
}

boot().catch(() => {
  setText("perpsVenueState", "Data unavailable");
  setState("perpsMarketFreshness", "unavailable", "Unavailable");
  setState("perpsContextState", "unavailable", "Unavailable");
  setState("perpsDeliveryState", "unavailable", "Unavailable");
  setText("perpsContinuityMessage", "The market workspace could not establish a verified data path. No substitute data is shown.");
  window.RavenOSShell?.setCapabilities?.({ market: "Data unavailable", mode: "Read only", signing: "Sign off", broadcast: "Broadcast off" });
});
