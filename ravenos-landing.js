import { canonicalInstrumentId, RAVENOS_CHART_INSTRUMENT_SCHEMA } from "./ravenos-chart-data-plane.js";
import { customerFacingText } from "./ravenos-intelligence-contract.js";

const state = { opportunities: [], markets: new Map(), atlas: null, selected: null, candles: [], chartRequest: 0 };

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

function exactHyperliquidChartIdentity(row, payload) {
  const match = /^hyperliquid:perp:([A-Z0-9._-]+)$/.exec(String(row?.instrument_id || ""));
  if (!match || !payload?.instrument) return false;
  const asset = match[1];
  const instrument = payload.instrument;
  const canonicalId = canonicalInstrumentId({ instrumentType: "perpetual", chain: "hyperliquid", venue: "hyperliquid", baseAsset: asset, quoteAsset: "USD" });
  return payload.instrument_scope === "exact_instrument"
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

function drawChart() {
  const canvas = document.getElementById("landingChart");
  const wrap = document.getElementById("landingChartWrap");
  const candles = state.candles
    .map((row) => ({
      time: finite(row.time),
      open: finite(row.open),
      high: finite(row.high),
      low: finite(row.low),
      close: finite(row.close),
    }))
    .filter((row) => Object.values(row).every((value) => value !== null)
      && row.high >= Math.max(row.open, row.close)
      && row.low <= Math.min(row.open, row.close));
  if (!candles.length || !canvas.clientWidth || !canvas.clientHeight) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth; const height = canvas.clientHeight;
  canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d"); context.scale(ratio, ratio); context.clearRect(0, 0, width, height);
  const plot = { top: 14, right: 10, bottom: 22, left: 10 };
  const plotWidth = Math.max(1, width - plot.left - plot.right);
  const plotHeight = Math.max(1, height - plot.top - plot.bottom);
  const targetSlotWidth = width < 600 ? 4.2 : 5.8;
  const visibleCount = Math.max(1, Math.min(candles.length, Math.floor(plotWidth / targetSlotWidth)));
  const visible = candles.slice(-visibleCount);
  const rawLow = Math.min(...visible.map((row) => row.low));
  const rawHigh = Math.max(...visible.map((row) => row.high));
  const rawSpread = Math.max(rawHigh - rawLow, Math.abs(rawHigh) * .002, 1e-9);
  const low = rawLow - rawSpread * .055;
  const high = rawHigh + rawSpread * .055;
  const spread = high - low;
  const slotWidth = plotWidth / visible.length;
  const bodyWidth = Math.max(1.25, Math.min(5, slotWidth * .64));
  const y = (value) => plot.top + (high - value) / spread * plotHeight;
  const styles = getComputedStyle(document.documentElement);
  const upColor = styles.getPropertyValue("--green").trim() || "#3fa675";
  const downColor = styles.getPropertyValue("--red").trim() || "#cf5968";

  visible.forEach((row, index) => {
    const x = plot.left + (index + .5) * slotWidth;
    const color = row.close >= row.open ? upColor : downColor;
    context.strokeStyle = color;
    context.lineWidth = Math.max(1, Math.min(1.35, slotWidth * .18));
    context.beginPath();
    context.moveTo(x, y(row.high));
    context.lineTo(x, y(row.low));
    context.stroke();

    const openY = y(row.open);
    const closeY = y(row.close);
    const bodyTop = Math.min(openY, closeY);
    const bodyHeight = Math.max(1.25, Math.abs(closeY - openY));
    context.fillStyle = color;
    context.fillRect(x - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);
  });

  const last = visible.at(-1);
  const lastY = y(last.close);
  context.save();
  context.setLineDash([3, 4]);
  context.strokeStyle = last.close >= last.open ? "rgba(63,166,117,.45)" : "rgba(207,89,104,.45)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(plot.left, lastY);
  context.lineTo(width - plot.right, lastY);
  context.stroke();
  context.restore();

  canvas.dataset.chartType = "candlestick";
  canvas.dataset.instrumentId = state.selected?.instrument_id || "";
  canvas.dataset.renderedCandles = String(visible.length);
  wrap.dataset.state = "live";
}

function clearChart() {
  const canvas = document.getElementById("landingChart");
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  delete canvas.dataset.chartType;
  delete canvas.dataset.instrumentId;
  delete canvas.dataset.renderedCandles;
}

async function loadChart(row) {
  const generation = ++state.chartRequest;
  state.candles = [];
  clearChart();
  const wrap = document.getElementById("landingChartWrap"); wrap.dataset.state = "loading";
  setText("landingChartState", "Requesting provider-backed candles");
  try {
    const params = new URLSearchParams({ market: "perpetuals", asset: row.instrument, instrument_id: row.instrument_id, timeframe: "1h", limit: "120", instrument_scope: "exact_instrument" });
    const { response, payload: outer } = await json(`/api/terminal/chart?${params.toString()}`);
    const payload = outer?.data || outer;
    if (generation !== state.chartRequest) return;
    if (!response.ok || !payload?.ok || !exactHyperliquidChartIdentity(row, payload) || !Array.isArray(payload.candles) || !payload.candles.length) throw new Error("Exact provider chart unavailable");
    state.candles = payload.candles.filter((candle) => [candle.time, candle.open, candle.high, candle.low, candle.close].every((value) => finite(value) !== null));
    if (!state.candles.length) throw new Error("No admissible provider candles");
    setText("landingFreshness", title(payload.freshness_state));
    drawChart();
  } catch (error) {
    clearChart();
    wrap.dataset.state = "unavailable";
    setText("landingChartState", `${error.message}. The chart stays unavailable until exact provider history is verified.`);
  }
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
    setText("landingReadState", "Unavailable"); setText("landingWhy", "Current Raven opportunity evidence is unavailable."); setText("landingReadSummary", "No older observation was substituted. Live provider markets remain available separately."); document.getElementById("landingChartWrap").dataset.state = "unavailable"; setText("landingChartState", "No exact Raven opportunity is selected. The chart remains unavailable rather than showing a substitute market.");
  }
  window.__RAVENOS_LANDING__ = Object.freeze({ getState: () => ({ opportunityCount: state.opportunities.length, marketCount: state.markets.size, atlasCount: validAtlas(state.atlas)?.length || 0, instrumentId: state.selected?.instrument_id || null, candleCount: state.candles.length, chartType: document.getElementById("landingChart").dataset.chartType || null, chartInstrumentId: document.getElementById("landingChart").dataset.instrumentId || null, renderedCandles: finite(document.getElementById("landingChart").dataset.renderedCandles), signingAvailable: false, submissionAvailable: false }) });
}

new ResizeObserver(() => { if (state.candles.length) drawChart(); }).observe(document.getElementById("landingChartWrap"));
boot().catch(() => { setText("landingOriginState", "Current opportunities unavailable"); document.getElementById("landingOriginDot").dataset.state = "unavailable"; });
