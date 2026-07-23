import { canonicalInstrumentId, RAVENOS_CHART_INSTRUMENT_SCHEMA } from "./ravenos-chart-data-plane.js";
import { customerFacingText } from "./ravenos-intelligence-contract.js";
import { createPriceWorkspace } from "./ravenos-price-workspace.js";

const state = {
  opportunities: [],
  markets: new Map(),
  atlas: null,
  selected: null,
  timeframe: "1h",
  chartRequest: 0,
  workspace: null,
};

function text(value, fallback = "Unavailable") { const clean = String(value ?? "").trim(); return clean || fallback; }
function finite(value) { if (value === null || value === undefined || value === "") return null; const number = Number(value); return Number.isFinite(number) ? number : null; }
function title(value) { return text(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function price(value) { const number = finite(value); return number === null ? "—" : number >= 1000 ? `$${number.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `$${number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 5 })}`; }
function percent(value, { ratio = false } = {}) { const number = finite(value); if (number === null) return "—"; const amount = ratio ? number * 100 : number; return `${amount >= 0 ? "+" : ""}${amount.toFixed(Math.abs(amount) < .1 ? 3 : 2)}%`; }
function compact(value) { const number = finite(value); return number === null ? "—" : `$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(number)}`; }
function when(value) { const date = new Date(value || ""); return Number.isNaN(date.getTime()) ? "Timestamp unavailable" : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(date) + " UTC"; }
function setText(id, value, fallback = "—") { const node = document.getElementById(id); if (node) node.textContent = value === null || value === undefined || value === "" ? fallback : String(value); }
async function json(url) { const response = await fetch(url, { cache: "no-store", headers: { accept: "application/json" } }); return { response, payload: await response.json().catch(() => null) }; }

function pathLabel(value) {
  const normalized = text(value, "").toLowerCase().replaceAll("_", " ");
  if (!normalized || normalized === "unavailable") return "Unavailable";
  if (normalized === "forward path reviewing" || normalized === "forward outcome reviewing") return "Outcome window maturing";
  if (normalized === "matured" || normalized === "complete") return "Comparable outcomes matured";
  if (normalized === "rejected" || normalized === "invalidated") return "Earlier path did not hold";
  return title(normalized);
}

function exactHyperliquidChartIdentity(row, chartState) {
  const match = /^hyperliquid:perp:([A-Z0-9._-]+)$/.exec(String(row?.instrument_id || ""));
  if (!match || !chartState?.instrument) return false;
  const asset = match[1];
  const instrument = chartState.instrument;
  const canonicalId = canonicalInstrumentId({ instrumentType: "perpetual", chain: "hyperliquid", venue: "hyperliquid", baseAsset: asset, quoteAsset: "USD" });
  return chartState.instrumentScope === "exact_instrument"
    && instrument.schema_version === RAVENOS_CHART_INSTRUMENT_SCHEMA
    && instrument.canonical_id === canonicalId
    && instrument.instrument_type === "perpetual"
    && instrument.identity_scope === "venue_market"
    && instrument.chain === "hyperliquid"
    && instrument.venue === "hyperliquid"
    && instrument.symbol === `${asset}-PERP`
    && instrument.base_asset === asset
    && instrument.quote_asset === "USD"
    && instrument.aggregate_token === false
    && instrument.provider_routing?.history === "hyperliquid"
    && instrument.provider_routing?.provider_asset === asset
    && instrument.provider_routing?.provider_network === "hyperliquid";
}

function terminalHref(row) {
  const params = new URLSearchParams({ asset: row.instrument, instrument_id: row.instrument_id, instrument_type: "perpetual", asset_class: "crypto", identity_scope: "exact_instrument", chain: "hyperliquid", venue: "hyperliquid", market: "perp", quote: "USD", settlement: "USDC", numeraire: "USDC", timeframe: "1h" });
  return `/terminal/?${params.toString()}`;
}

function validOpportunities(payload) {
  const rows = payload?.census?.opportunities?.rows;
  if (payload?.delivery?.source !== "current_public_origin" || payload?.delivery?.fallback !== false || payload?.delivery?.freshness_state !== "fresh" || payload?.census?.source_state !== "current" || !Array.isArray(rows)) return null;
  return rows.filter((row) => row?.instrument_id?.startsWith("hyperliquid:perp:") && row?.instrument);
}

function validAtlas(payload) {
  const rows = payload?.market_context?.rows;
  if (payload?.schema_version !== "ravenos.atlas_projection.v1" || payload?.delivery?.source !== "current_public_origin" || payload?.delivery?.fallback !== false || !["fresh", "delayed"].includes(payload?.freshness?.state) || !Array.isArray(rows) || payload?.execution_boundary?.signing_available !== false || payload?.execution_boundary?.submission_available !== false) return null;
  return rows.filter((row) => row?.instrument_id && row?.instrument?.instrument_id === row.instrument_id && row.instrument?.identity_scope === "exact_instrument" && row.instrument?.capabilities?.execution === false);
}

function renderOpportunityList() {
  const host = document.getElementById("landingOpportunityList");
  host.replaceChildren();
  if (!state.opportunities.length) {
    const node = document.createElement("div"); node.className = "landing-unavailable";
    const strong = document.createElement("strong"); strong.textContent = "Current opportunities unavailable";
    const span = document.createElement("span"); span.textContent = "Live markets may remain available, but no older Raven observation is substituted.";
    node.append(strong, span); host.append(node); return;
  }
  for (const row of state.opportunities.slice(0, 5)) {
    const button = document.createElement("button"); button.type = "button"; button.className = "landing-opportunity"; button.dataset.instrumentId = row.instrument_id;
    const copy = document.createElement("span"); const strong = document.createElement("strong"); strong.textContent = row.instrument; const small = document.createElement("small"); small.textContent = customerFacingText(row.why_raven_noticed, "Current Raven observation"); copy.append(strong, small);
    const freshness = document.createElement("span"); freshness.textContent = title(row.context_state || "current"); button.append(copy, freshness);
    button.addEventListener("click", () => selectOpportunity(row)); host.append(button);
  }
}

async function loadChart(row) {
  const generation = ++state.chartRequest;
  const wrap = document.getElementById("landingChartWrap");
  wrap.dataset.state = "loading";
  const asset = /^hyperliquid:perp:([A-Z0-9._-]+)$/.exec(String(row.instrument_id || ""))?.[1];
  const expectedCanonicalId = asset
    ? canonicalInstrumentId({ instrumentType: "perpetual", chain: "hyperliquid", venue: "hyperliquid", baseAsset: asset, quoteAsset: "USD" })
    : null;
  const chartState = await state.workspace.load({
    market: "perpetuals",
    asset: row.instrument,
    instrumentId: row.instrument_id,
    expectedCanonicalId,
    timeframe: state.timeframe,
    limit: 240,
    chain: "hyperliquid",
    source: "Hyperliquid",
    marketIdentity: row.instrument_id,
    instrumentScope: "exact_instrument",
    expectedIdentity: {
      instrumentType: "perpetual",
      identityScope: "venue_market",
      chain: "hyperliquid",
      venue: "hyperliquid",
      baseAsset: asset,
      quoteAsset: "USD",
    },
  });
  if (generation !== state.chartRequest) return;
  if (!chartState?.candles?.length || !exactHyperliquidChartIdentity(row, chartState)) {
    state.workspace.showUnavailable({
      message: "Exact market history is unavailable. No other market was substituted.",
      marketIdentity: row.instrument_id,
      instrumentScope: "exact_instrument",
      source: "Hyperliquid",
      timeframe: state.timeframe,
    });
    wrap.dataset.state = "unavailable";
    return;
  }
  wrap.dataset.state = chartState.state;
  setText("landingFreshness", title(chartState.state));
}

function selectOpportunity(row) {
  state.selected = row;
  document.querySelectorAll(".landing-opportunity").forEach((button) => button.classList.toggle("active", button.dataset.instrumentId === row.instrument_id));
  const market = state.markets.get(row.instrument_id) || {};
  setText("landingInstrumentType", "Hyperliquid perpetual / exact contract"); setText("landingInstrument", row.instrument); setText("landingInstrumentId", row.instrument_id);
  setText("landingPrice", price(market.last_price ?? market.lastPrice)); const change = finite(market.day_change_pct ?? market.dayChangePct); setText("landingChange", percent(change));
  const changeNode = document.getElementById("landingChange"); changeNode.classList.toggle("positive", change !== null && change >= 0); changeNode.classList.toggle("negative", change !== null && change < 0);
  setText("landingVenue", "Hyperliquid"); setText("landingFunding", percent(market.funding_rate ?? market.funding, { ratio: true })); setText("landingOpenInterest", compact(market.open_interest_usd)); setText("landingFreshness", title(row.context_state));
  setText("landingReadState", `${title(row.context_state)} · research only`); setText("landingWhy", customerFacingText(row.why_raven_noticed, "No current public explanation is available.")); setText("landingReadSummary", `${title(row.pressure_state)}. Exact market facts and Raven evidence retain separate source timestamps.`); setText("landingPath", pathLabel(row.path_review?.state)); setText("landingEvidence", title(row.context_state));
  const comparableCount = finite(row.matured_comparables?.sample_size);
  const comparableCell = document.getElementById("landingComparables")?.closest("div");
  if (comparableCell) comparableCell.hidden = !(comparableCount > 0);
  setText("landingComparables", comparableCount > 0 ? comparableCount.toLocaleString() : "");
  const inspect = document.getElementById("landingInspect"); inspect.href = terminalHref(row);
  loadChart(row);
}

function renderAtlas(rows, payload) {
  const host = document.getElementById("landingAtlasList"); host.replaceChildren();
  if (!rows?.length) {
    const node = document.createElement("div"); node.className = "landing-unavailable";
    const strong = document.createElement("strong"); strong.textContent = "Atlas context unavailable";
    const span = document.createElement("span"); span.textContent = "No older equity or ETF row was substituted.";
    node.append(strong, span); host.append(node); return;
  }
  for (const row of rows.slice(0, 4)) {
    const instrument = row.instrument; const params = new URLSearchParams({ asset: row.symbol, instrument_id: row.instrument_id, instrument_type: instrument.instrument_type, asset_class: instrument.asset_class, identity_scope: "exact_instrument", venue: instrument.venue, market: "equities", quote: instrument.quote_asset?.symbol || "USD", settlement: instrument.settlement_asset?.symbol || "USD", numeraire: instrument.economic_numeraire || "USDC" });
    const link = document.createElement("a"); link.className = "landing-atlas-row"; link.href = `/terminal/?${params.toString()}`;
    const identity = document.createElement("span"); const strong = document.createElement("strong"); strong.textContent = row.symbol; const small = document.createElement("small"); small.textContent = `${instrument.market_identity?.listing || instrument.venue} · exact listing`; identity.append(strong, small);
    const value = document.createElement("span"); value.textContent = price(row.price); const change = document.createElement("span"); const amount = finite(row.change_21d); change.textContent = percent(amount, { ratio: true }); if (amount !== null) change.className = amount >= 0 ? "positive" : "negative";
    link.append(identity, value, change); host.append(link);
  }
  state.atlas = payload;
}

async function boot() {
  state.workspace = createPriceWorkspace(document.getElementById("landingChart"), {
    timeframe: state.timeframe,
    tradeLimit: 60,
    onTimeframeChange: async (timeframe) => {
      if (!state.selected || timeframe === state.timeframe) return;
      state.timeframe = timeframe;
      await loadChart(state.selected);
    },
  });
  const [opportunityResult, marketResult, atlasResult, healthResult] = await Promise.allSettled([json("/api/opportunity"), json("/api/hyperliquid/perps"), json("/api/atlas"), json("/api/health")]);
  const marketPayload = marketResult.status === "fulfilled" && marketResult.value.response.ok ? marketResult.value.payload : null;
  for (const row of marketPayload?.results || []) if (row?.instrument_id) state.markets.set(row.instrument_id, row);
  const opportunityPayload = opportunityResult.status === "fulfilled" && opportunityResult.value.response.ok ? opportunityResult.value.payload : null;
  state.opportunities = validOpportunities(opportunityPayload) || [];
  renderOpportunityList(); setText("landingOpportunityCount", state.opportunities.length ? `${state.opportunities.length} current exact rows` : "Current Census unavailable");
  const atlasPayload = atlasResult.status === "fulfilled" && atlasResult.value.response.ok ? atlasResult.value.payload : null; renderAtlas(validAtlas(atlasPayload), atlasPayload);
  const health = healthResult.status === "fulfilled" && healthResult.value.response.ok ? healthResult.value.payload : null;
  const marketState = health?.market_data_health?.state || (state.markets.size ? "live" : "unavailable"); const intelligenceState = health?.intelligence_freshness?.state || (state.opportunities.length ? "fresh" : "unavailable");
  setText("landingMarketState", `Market ${title(marketState)}`); document.getElementById("landingMarketState").dataset.state = marketState;
  setText("landingIntelligenceState", `Raven ${title(intelligenceState)}`); document.getElementById("landingIntelligenceState").dataset.state = intelligenceState;
  const originCurrent = state.opportunities.length > 0 || Boolean(validAtlas(atlasPayload)?.length); setText("landingOriginState", originCurrent ? "Current opportunities" : "Current opportunities unavailable"); document.getElementById("landingOriginDot").dataset.state = originCurrent ? "live" : "unavailable";
  setText("landingGeneratedAt", when(opportunityPayload?.census?.generated_at || atlasPayload?.generated_at));
  if (state.opportunities[0]) selectOpportunity(state.opportunities[0]);
  else {
    setText("landingReadState", "Unavailable"); setText("landingWhy", "Current Raven opportunity evidence is unavailable."); setText("landingReadSummary", "No older observation was substituted. Live provider markets remain available separately."); document.getElementById("landingChartWrap").dataset.state = "unavailable";
    state.workspace.showUnavailable({
      message: "No exact current opportunity is selected. No substitute market was loaded.",
      instrumentScope: "exact_instrument",
      source: "Hyperliquid",
      timeframe: state.timeframe,
    });
  }
  window.__RAVENOS_LANDING__ = Object.freeze({
    getState: () => {
      const diagnostics = state.workspace?.diagnostics?.() || {};
      return {
        opportunityCount: state.opportunities.length,
        marketCount: state.markets.size,
        atlasCount: validAtlas(state.atlas)?.length || 0,
        instrumentId: state.selected?.instrument_id || null,
        candleCount: state.workspace?.state?.candles?.length || 0,
        chartType: diagnostics.chart ? "candlestick" : null,
        chartInstrumentId: state.workspace?.state?.instrument?.canonical_id || null,
        renderedCandles: diagnostics.chart?.loaded_bars || 0,
        timeframe: state.workspace?.state?.timeframe || state.timeframe,
        connectionState: state.workspace?.state?.connectionState || null,
        signingAvailable: false,
        submissionAvailable: false,
      };
    },
  });
}

boot().catch(() => { setText("landingOriginState", "Current opportunities unavailable"); document.getElementById("landingOriginDot").dataset.state = "unavailable"; });
