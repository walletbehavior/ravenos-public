const state = { opportunities: [], markets: new Map(), atlas: null, selected: null, candles: [], chartRequest: 0 };

function text(value, fallback = "Unavailable") { const clean = String(value ?? "").trim(); return clean || fallback; }
function finite(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function title(value) { return text(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function price(value) { const number = finite(value); return number === null ? "—" : number >= 1000 ? `$${number.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `$${number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 5 })}`; }
function percent(value, { ratio = false } = {}) { const number = finite(value); if (number === null) return "—"; const amount = ratio ? number * 100 : number; return `${amount >= 0 ? "+" : ""}${amount.toFixed(Math.abs(amount) < .1 ? 3 : 2)}%`; }
function compact(value) { const number = finite(value); return number === null ? "—" : `$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(number)}`; }
function when(value) { const date = new Date(value || ""); return Number.isNaN(date.getTime()) ? "Timestamp unavailable" : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(date) + " UTC"; }
function setText(id, value, fallback = "—") { const node = document.getElementById(id); if (node) node.textContent = value === null || value === undefined || value === "" ? fallback : String(value); }
async function json(url) { const response = await fetch(url, { cache: "no-store", headers: { accept: "application/json" } }); return { response, payload: await response.json().catch(() => null) }; }

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
    const strong = document.createElement("strong"); strong.textContent = "Current Census unavailable";
    const span = document.createElement("span"); span.textContent = "Live markets may remain available, but no prior Raven claim is substituted.";
    node.append(strong, span); host.append(node); return;
  }
  for (const row of state.opportunities.slice(0, 5)) {
    const button = document.createElement("button"); button.type = "button"; button.className = "landing-opportunity"; button.dataset.instrumentId = row.instrument_id;
    const copy = document.createElement("span"); const strong = document.createElement("strong"); strong.textContent = row.instrument; const small = document.createElement("small"); small.textContent = row.why_raven_noticed || "Current Raven observation"; copy.append(strong, small);
    const freshness = document.createElement("span"); freshness.textContent = title(row.context_state || "current"); button.append(copy, freshness);
    button.addEventListener("click", () => selectOpportunity(row)); host.append(button);
  }
}

function drawChart() {
  const canvas = document.getElementById("landingChart");
  const wrap = document.getElementById("landingChartWrap");
  const candles = state.candles;
  if (!candles.length || !canvas.clientWidth || !canvas.clientHeight) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth; const height = canvas.clientHeight;
  canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d"); context.scale(ratio, ratio); context.clearRect(0, 0, width, height);
  const values = candles.map((row) => Number(row.close)).filter(Number.isFinite);
  const low = Math.min(...values); const high = Math.max(...values); const spread = Math.max(high - low, Math.abs(high) * .002, 1e-9);
  const x = (index) => 10 + index / Math.max(1, values.length - 1) * (width - 20);
  const y = (value) => 18 + (high - value) / spread * (height - 48);
  const gradient = context.createLinearGradient(0, 0, 0, height); gradient.addColorStop(0, "rgba(185,243,74,.22)"); gradient.addColorStop(1, "rgba(185,243,74,0)");
  context.beginPath(); values.forEach((value, index) => index ? context.lineTo(x(index), y(value)) : context.moveTo(x(index), y(value))); context.lineTo(x(values.length - 1), height - 22); context.lineTo(x(0), height - 22); context.closePath(); context.fillStyle = gradient; context.fill();
  context.beginPath(); values.forEach((value, index) => index ? context.lineTo(x(index), y(value)) : context.moveTo(x(index), y(value))); context.strokeStyle = "#b9f34a"; context.lineWidth = 1.7; context.stroke();
  const lastX = x(values.length - 1); const lastY = y(values.at(-1)); context.beginPath(); context.arc(lastX, lastY, 3, 0, Math.PI * 2); context.fillStyle = "#b9f34a"; context.fill();
  wrap.dataset.state = "live";
}

async function loadChart(row) {
  const generation = ++state.chartRequest;
  state.candles = [];
  const wrap = document.getElementById("landingChartWrap"); wrap.dataset.state = "loading";
  setText("landingChartState", "Requesting provider-backed candles");
  try {
    const params = new URLSearchParams({ market: "perpetuals", asset: row.instrument, instrument_id: row.instrument_id, timeframe: "1h", limit: "120", instrument_scope: "exact_instrument" });
    const { response, payload: outer } = await json(`/api/terminal/chart?${params.toString()}`);
    const payload = outer?.data || outer;
    if (generation !== state.chartRequest) return;
    if (!response.ok || !payload?.ok || payload?.market_identity !== row.instrument_id || payload?.instrument?.canonical_id !== row.instrument_id || !Array.isArray(payload.candles) || !payload.candles.length) throw new Error("Exact provider chart unavailable");
    state.candles = payload.candles.filter((candle) => [candle.time, candle.open, candle.high, candle.low, candle.close].every((value) => finite(value) !== null));
    if (!state.candles.length) throw new Error("No admissible provider candles");
    setText("landingFreshness", title(payload.freshness_state));
    drawChart();
  } catch (error) {
    wrap.dataset.state = "unavailable";
    setText("landingChartState", `${error.message}. No fallback series was generated.`);
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
  setText("landingReadState", `${title(row.context_state)} · research only`); setText("landingWhy", row.why_raven_noticed, "No current public explanation is available."); setText("landingReadSummary", `${title(row.pressure_state)}. Exact market facts and Raven evidence retain separate source timestamps.`); setText("landingPath", title(row.path_review?.state)); setText("landingEvidence", title(row.context_state)); setText("landingComparables", finite(row.matured_comparables?.sample_size)?.toLocaleString() || "Unavailable");
  const inspect = document.getElementById("landingInspect"); inspect.href = terminalHref(row);
  loadChart(row);
}

function renderAtlas(rows, payload) {
  const host = document.getElementById("landingAtlasList"); host.replaceChildren();
  if (!rows?.length) {
    const node = document.createElement("div"); node.className = "landing-unavailable";
    const strong = document.createElement("strong"); strong.textContent = "Atlas unavailable";
    const span = document.createElement("span"); span.textContent = "No stale equity or ETF row was substituted.";
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
  setText("landingMarketState", `Market data ${title(marketState)}`); document.getElementById("landingMarketState").dataset.state = marketState;
  setText("landingIntelligenceState", `Intelligence ${title(intelligenceState)}`); document.getElementById("landingIntelligenceState").dataset.state = intelligenceState;
  const originCurrent = state.opportunities.length > 0 || Boolean(validAtlas(atlasPayload)?.length); setText("landingOriginState", originCurrent ? "Current public origin" : "Current origin unavailable"); document.getElementById("landingOriginDot").dataset.state = originCurrent ? "live" : "unavailable";
  setText("landingGeneratedAt", when(opportunityPayload?.census?.generated_at || atlasPayload?.generated_at));
  if (state.opportunities[0]) selectOpportunity(state.opportunities[0]);
  else {
    setText("landingReadState", "Unavailable"); setText("landingWhy", "Current Raven opportunity evidence is unavailable."); setText("landingReadSummary", "No historical claim was substituted. Live provider markets remain a separate surface."); document.getElementById("landingChartWrap").dataset.state = "unavailable"; setText("landingChartState", "No exact Raven opportunity selected. No fallback series was generated.");
  }
  window.__RAVENOS_LANDING__ = Object.freeze({ getState: () => ({ opportunityCount: state.opportunities.length, marketCount: state.markets.size, atlasCount: validAtlas(state.atlas)?.length || 0, instrumentId: state.selected?.instrument_id || null, candleCount: state.candles.length, signingAvailable: false, submissionAvailable: false }) });
}

new ResizeObserver(() => { if (state.candles.length) drawChart(); }).observe(document.getElementById("landingChartWrap"));
boot().catch(() => { setText("landingOriginState", "Current origin unavailable"); document.getElementById("landingOriginDot").dataset.state = "unavailable"; });
