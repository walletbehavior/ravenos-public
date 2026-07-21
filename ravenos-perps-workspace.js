import { ravenOSContext } from "./ravenos-context-store.js";
import { getChartDataPlaneDiagnostics } from "./ravenos-chart-data-plane.js";

const TIMEFRAMES = Object.freeze(["5m", "15m", "1h", "4h", "1d", "1w"]);
const state = {
  rows: [],
  row: null,
  timeframe: ravenOSContext.getState().timeframe || "1h",
  evidence: null,
  workspace: null,
  overlays: [],
  marketState: {},
  orderBook: null,
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

function percent(value, scale = 100) {
  const result = finite(value);
  if (result === null) return "--";
  const scaled = result * scale;
  return `${scaled >= 0 ? "+" : ""}${scaled.toFixed(Math.abs(scaled) < 0.1 ? 4 : 2)}%`;
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function fundingCountdown() {
  const now = new Date();
  const next = new Date(now);
  next.setUTCMinutes(60, 0, 0);
  const seconds = Math.max(0, Math.floor((next.getTime() - now.getTime()) / 1000));
  setText("perpsFundingCountdown", `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`);
}

function marketSnapshot(row = state.row, streamed = state.marketState) {
  return {
    last: finite(streamed.last ?? row?.lastPrice),
    mark: finite(streamed.mark ?? row?.markPx),
    oracle: finite(streamed.oracle ?? row?.oraclePx),
    mid: finite(streamed.mid ?? row?.midPx),
    funding: finite(streamed.funding ?? row?.funding),
    openInterest: finite(streamed.open_interest ?? row?.openInterest),
    volume24h: finite(streamed.volume_24h ?? row?.dayNtlVlm),
    previousDayPrice: finite(streamed.previous_day_price ?? row?.prevDayPx),
    maxLeverage: finite(streamed.max_leverage ?? row?.maxLeverage),
  };
}

function renderMarket() {
  const market = marketSnapshot();
  setText("perpsLast", price(market.last));
  setText("perpsMark", price(market.mark));
  setText("perpsOracle", price(market.oracle));
  setText("perpsFunding", percent(market.funding));
  setText("perpsOpenInterest", market.openInterest === null ? "--" : `$${compact(market.openInterest * (market.mark || market.last || 0))}`);
  setText("perpsVolume", market.volume24h === null ? "--" : `$${compact(market.volume24h)}`);
  setText("perpsLeverage", market.maxLeverage === null ? "--" : `${market.maxLeverage}x max`);
  const basis = market.mark && market.oracle ? market.mark / market.oracle - 1 : null;
  const change = market.last && market.previousDayPrice ? market.last / market.previousDayPrice - 1 : null;
  setText("perpsBasis", basis === null ? "--" : percent(basis));
  setText("perpsChange", change === null ? "--" : percent(change));
  document.getElementById("perpsChange")?.classList.toggle("perps-positive", change !== null && change >= 0);
  document.getElementById("perpsChange")?.classList.toggle("perps-negative", change !== null && change < 0);
  renderRavenRead();
}

function renderBook(book = state.orderBook) {
  const host = document.getElementById("perpsBook");
  if (!host) return;
  const bids = Array.isArray(book?.bids) ? book.bids.filter((row) => row.price && row.size).slice(0, 11) : [];
  const asks = Array.isArray(book?.asks) ? book.asks.filter((row) => row.price && row.size).slice(0, 11) : [];
  if (!bids.length || !asks.length) {
    host.innerHTML = '<div class="perps-empty">Order-book snapshot pending.</div>';
    return;
  }
  const maxSize = Math.max(...bids.map((row) => row.size), ...asks.map((row) => row.size), 1);
  const rowMarkup = (row, side) => `<div class="perps-book-row ${side}" style="--depth:${Math.min(100, row.size / maxSize * 100).toFixed(1)}%"><span>${price(row.price)}</span><span>${compact(row.size)}</span><span>${Math.trunc(row.orders || 0)}</span></div>`;
  const bestBid = bids[0]?.price;
  const bestAsk = asks[0]?.price;
  const spread = bestBid && bestAsk ? (bestAsk - bestBid) / ((bestAsk + bestBid) / 2) : null;
  host.innerHTML = `${asks.slice().reverse().map((row) => rowMarkup(row, "ask")).join("")}<div class="perps-book-spread"><span>Spread</span><strong>${spread === null ? "--" : `${(spread * 10_000).toFixed(2)} bps`}</strong></div>${bids.map((row) => rowMarkup(row, "bid")).join("")}`;
  setText("perpsSpread", spread === null ? "--" : `${(spread * 10_000).toFixed(2)} bps`);
  setText("perpsBookState", "Live venue snapshot");
}

function evidenceForward() {
  return state.evidence?.data?.forward_observation || state.evidence?.forward_observation || {};
}

function renderEvidence() {
  const forward = evidenceForward();
  const windows = forward.matured_windows || {};
  setText("perpsForwardN", Number.isFinite(Number(forward.observations)) ? Number(forward.observations).toLocaleString() : "--");
  setText("perpsMatured1h", Number.isFinite(Number(windows["1h"])) ? Number(windows["1h"]).toLocaleString() : "--");
  setText("perpsMatured12h", Number.isFinite(Number(windows["12h"])) ? Number(windows["12h"]).toLocaleString() : "--");
  const generatedAt = state.evidence?.generated_at || state.evidence?.data?.generated_at;
  setText("perpsEvidenceState", forward.observations ? `${forward.observations} forward observations` : "Insufficient evidence");
  if (generatedAt) document.getElementById("perpsEvidenceState").title = `Evidence generated ${generatedAt}`;
  renderRavenRead();
}

function renderRavenRead() {
  const host = document.getElementById("perpsRavenRead");
  if (!host || !state.row) return;
  const market = marketSnapshot();
  const basis = market.mark && market.oracle ? (market.mark / market.oracle - 1) * 10_000 : null;
  const funding = market.funding === null ? "unavailable" : percent(market.funding);
  const oi = market.openInterest === null ? "unavailable" : `$${compact(market.openInterest * (market.mark || market.last || 0))}`;
  const pressure = state.row.pressureState || "Unclassified";
  const evidenceCount = finite(evidenceForward().observations) || 0;
  host.innerHTML = `<strong>${pressure} market structure</strong><p>Funding is ${funding}, open interest is ${oi}, and mark is ${basis === null ? "not comparable with oracle" : `${Math.abs(basis).toFixed(2)} bps ${basis >= 0 ? "above" : "below"} oracle`}. This is current market context, not a trade instruction.</p><dl><dt>Confirms</dt><dd>${state.row.participantActivity || "Open-interest confirmation unavailable"}</dd><dt>Weakens</dt><dd>${state.row.risk === "Elevated" ? "Crowding and sequence risk are elevated" : "A loss of OI or liquidity would weaken the read"}</dd><dt>Forward evidence</dt><dd>${evidenceCount ? `${evidenceCount} observations; calibration remains separate` : "Insufficient model-bound outcomes"}</dd></dl>`;
}

function chartContext() {
  return {
    asset: state.row?.asset,
    timeframe: state.timeframe,
    candles: state.workspace?.state?.candles || [],
    sourceLabel: state.workspace?.state?.source,
    freshnessState: state.workspace?.state?.state,
    observedAt: state.workspace?.state?.observedAt,
    chartDataSource: "terminal_chart_api",
    marketIdentity: state.workspace?.state?.instrument?.canonical_id,
    lineage: state.workspace?.state?.lineage,
  };
}

function renderChartOverlays() {
  if (!state.workspace || !state.row) return;
  const context = chartContext();
  state.overlays = window.RavenChartOverlays?.getOverlays?.({
    symbol: state.row.asset,
    market: "perp",
    candles: context.candles,
    tier: "pro",
    pressureContext: state.row,
    evidenceContext: state.evidence || {},
    chartContext: context,
  }) || [];
  state.workspace.attachIntelligence({ evidence: state.evidence, narrator: window.RavenOSShell?.getIntelligence?.() });
  state.workspace.render({
    events: [],
    overlays: state.overlays,
    visibleOverlayTypes: state.overlays.some((row) => row.type === "pressure-zone") ? ["pressure"] : [],
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

function dispatchContext() {
  if (!state.row) return;
  const market = marketSnapshot();
  const basis = market.mark && market.oracle ? market.mark / market.oracle - 1 : null;
  document.dispatchEvent(new CustomEvent("ravenos:terminalcontext", { detail: {
    subject: { id: state.row.asset, type: "market", label: state.row.asset, symbol: state.row.symbol, chain: "hyperliquid", venue: "hyperliquid", marketType: "perp" },
    workspace: "market-monitor",
    marketState: state.row.pressureState || "Perpetual market context",
    setupState: "observation_only",
    thesis: `Funding ${percent(market.funding)}; OI ${market.openInterest === null ? "unavailable" : `$${compact(market.openInterest * (market.mark || market.last || 0))}`}; basis ${basis === null ? "unavailable" : percent(basis)}.`,
    supportingEvidence: [state.row.participantActivity, state.row.liquidityPosture].filter(Boolean),
    contradictingEvidence: [state.row.risk === "Elevated" ? "Crowding and sequence risk elevated" : "Confirmation can weaken if OI or liquidity contracts"],
    invalidation: ["Venue feed degrades", "Mark/oracle divergence loses current structure"],
    timeHorizon: state.timeframe,
    confidence: { label: "unrated" },
    evidenceQuality: { state: state.workspace?.state?.lineage ? "provider_lineage_present" : "market_only", lineageComplete: Boolean(state.workspace?.state?.lineage) },
    dataState: state.workspace?.state?.state || "data_unavailable",
    observedAt: state.workspace?.state?.observedAt,
    marketSource: state.workspace?.state?.source || "Hyperliquid",
    sourceReferences: [state.workspace?.state?.source, "Hyperliquid", "Raven forward evidence"].filter(Boolean),
  } }));
}

async function selectInstrument(asset, { updateContext = true } = {}) {
  const row = state.rows.find((candidate) => candidate.asset === asset) || state.rows[0];
  if (!row) return;
  state.row = row;
  state.marketState = {};
  state.orderBook = null;
  document.getElementById("perpsInstrument").value = row.asset;
  setText("perpsInstrumentTitle", row.asset);
  setText("perpsVenueState", "Hyperliquid · requesting provider history");
  renderMarket();
  renderBook(null);
  const result = await state.workspace.load({ market: "perpetuals", asset: row.asset, timeframe: state.timeframe, chain: "hyperliquid", marketIdentity: `hyperliquid:${row.asset}`, limit: 240 });
  state.marketState = { ...(result.marketState || {}) };
  setText("perpsVenueState", `Hyperliquid · ${String(result.connectionState || result.state).replaceAll("_", " ")}`);
  renderMarket();
  renderChartOverlays();
  dispatchContext();
  if (updateContext) ravenOSContext.setSelection({ subject: { id: row.asset, type: "market", label: row.asset, symbol: row.symbol, chain: "hyperliquid", venue: "hyperliquid", marketType: "perp" }, timeframe: state.timeframe, workspace: "market-monitor" });
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
      host.querySelectorAll("button").forEach((row) => row.setAttribute("aria-pressed", row === button ? "true" : "false"));
      await selectInstrument(state.row?.asset || "SOL-PERP");
    });
    return button;
  }));
}

async function loadPerps() {
  const response = await fetch("/api/hyperliquid/perps", { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok || !Array.isArray(payload.results) || !payload.results.length) throw new Error(payload?.error || "Hyperliquid markets unavailable");
  state.rows = payload.results;
  const select = document.getElementById("perpsInstrument");
  select.replaceChildren(...state.rows.map((row) => {
    const option = document.createElement("option");
    option.value = row.asset;
    option.textContent = row.asset;
    return option;
  }));
  const stored = ravenOSContext.getState().subject;
  const requested = stored.marketType === "perp" && state.rows.some((row) => row.asset === stored.label) ? stored.label : "SOL-PERP";
  await selectInstrument(requested, { updateContext: false });
}

async function loadEvidence() {
  try {
    const response = await fetch("/api/perps", { cache: "no-store" });
    state.evidence = await response.json().catch(() => null);
  } catch {
    state.evidence = null;
  }
  renderEvidence();
}

async function boot() {
  state.workspace = window.RavenOSPriceWorkspace?.create?.(document.getElementById("perpsChart"), {
    timeframe: state.timeframe,
    tradeLimit: 80,
    onTimeframeChange: async (timeframe) => {
      if (!TIMEFRAMES.includes(timeframe) || timeframe === state.timeframe) return;
      state.timeframe = timeframe;
      buildTimeframes();
      await selectInstrument(state.row?.asset || "SOL-PERP");
    },
  });
  if (!state.workspace) throw new Error("PriceWorkspace unavailable");
  buildTimeframes();
  document.getElementById("perpsInstrument").addEventListener("change", (event) => selectInstrument(event.target.value));
  document.querySelectorAll("[data-perps-mobile-pane]").forEach((button) => {
    button.addEventListener("click", () => {
      const pane = button.dataset.perpsMobilePane || "chart";
      const workspace = document.querySelector(".perps-workspace");
      workspace?.classList.remove("perps-mobile-pane-book", "perps-mobile-pane-raven");
      if (pane !== "chart") workspace?.classList.add(`perps-mobile-pane-${pane}`);
      document.querySelectorAll("[data-perps-mobile-pane]").forEach((candidate) => {
        candidate.setAttribute("aria-pressed", candidate === button ? "true" : "false");
      });
      if (pane === "chart") requestAnimationFrame(() => state.workspace?.chartHandle?.resize?.());
    });
  });
  document.addEventListener("ravenos:chartmarket", (event) => {
    if (event.detail?.instrument?.canonical_id !== state.workspace?.state?.instrument?.canonical_id) return;
    state.marketState = { ...state.marketState, ...(event.detail.marketState || {}) };
    state.orderBook = event.detail.orderBook || state.orderBook;
    renderMarket();
    renderBook(state.orderBook);
    setText("perpsVenueState", `Hyperliquid · ${state.workspace.state.connectionState}`);
    dispatchContext();
  });
  document.addEventListener("ravenos:priceworkspace", (event) => {
    if (event.detail?.instrument?.canonical_id !== state.workspace?.state?.instrument?.canonical_id) return;
    setText("perpsVenueState", `Hyperliquid · ${String(event.detail.connectionState || event.detail.state).replaceAll("_", " ")}`);
  });
  await Promise.all([loadEvidence(), loadPerps()]);
  fundingCountdown();
  setInterval(fundingCountdown, 1000);
  window.__RAVENOS_PERPS_WORKSPACE__ = {
    getState: () => ({
      instrument: state.row?.asset || null,
      timeframe: state.timeframe,
      candleCount: state.workspace?.state?.candles?.length || 0,
      backfillCount: state.workspace?.state?.backfillCount || 0,
      source: state.workspace?.state?.source || null,
      connectionState: state.workspace?.state?.connectionState || null,
      tradeCount: state.workspace?.tradeBuffer?.values?.().length || 0,
      hasOrderBook: Boolean(state.orderBook?.bids?.length && state.orderBook?.asks?.length),
      workspaceDiagnostics: state.workspace?.diagnostics?.() || null,
      diagnostics: getChartDataPlaneDiagnostics(),
    }),
  };
}

boot().catch((error) => {
  setText("perpsVenueState", `Data unavailable · ${error instanceof Error ? error.message : "workspace failed"}`);
  window.RavenOSShell?.setCapabilities?.({ market: "Data unavailable", mode: "Read only", signing: "Sign off", broadcast: "Broadcast off" });
});
