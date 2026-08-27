import { canonicalInstrumentId, RAVENOS_CHART_INSTRUMENT_SCHEMA } from "./ravenos-chart-data-plane.js";
import { customerFacingText } from "./ravenos-intelligence-contract.js";
import { createPriceWorkspace } from "./ravenos-price-workspace.js";

const state = {
  opportunities: [],
  displayRows: [],
  listMode: "unavailable",
  markets: new Map(),
  atlas: null,
  selected: null,
  timeframe: "1h",
  chartRequest: 0,
  workspace: null,
};

function text(value, fallback = "") { const clean = String(value ?? "").trim(); return clean || fallback; }
function finite(value) { if (value === null || value === undefined || value === "") return null; const number = Number(value); return Number.isFinite(number) ? number : null; }
function title(value, fallback = "") { return text(value, fallback).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function price(value) { const number = finite(value); return number === null ? "—" : number >= 1000 ? `$${number.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `$${number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 5 })}`; }
function percent(value, { ratio = false } = {}) { const number = finite(value); if (number === null) return "—"; const amount = ratio ? number * 100 : number; return `${amount >= 0 ? "+" : ""}${amount.toFixed(Math.abs(amount) < .1 ? 3 : 2)}%`; }
function compact(value) { const number = finite(value); return number === null ? "—" : `$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(number)}`; }
function when(value) { const date = new Date(value || ""); return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(date) + " UTC"; }
function setText(id, value, fallback = "—") { const node = document.getElementById(id); if (node) node.textContent = value === null || value === undefined || value === "" ? fallback : String(value); }
async function json(url) { const response = await fetch(url, { cache: "no-store", headers: { accept: "application/json" } }); return { response, payload: await response.json().catch(() => null) }; }

function setOptionalFact(wrapperId, value, { label = "" } = {}) {
  const wrapper = document.getElementById(wrapperId);
  if (!wrapper) return;
  const usable = text(value);
  wrapper.hidden = !usable;
  if (label) {
    const term = wrapper.querySelector("dt");
    if (term) term.textContent = label;
  }
  const detail = wrapper.querySelector("dd");
  if (detail && usable) detail.textContent = usable;
}

function duration(seconds) {
  const value = finite(seconds);
  if (value === null || value < 0) return "";
  const minutes = Math.round(value / 60);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const dayHours = hours % 24;
    return dayHours ? `${days}d ${dayHours}h` : `${days}d`;
  }
  if (hours) return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
  return `${Math.max(1, minutes)}m`;
}

function ravenReadTiming(row = {}) {
  const age = duration(row.context_age_seconds);
  const contextState = String(row.context_state || "").toLowerCase();
  if (contextState === "fresh" || contextState === "current") return "New read";
  if (age) return `Observed ${age} ago`;
  if (contextState === "stale" || contextState === "delayed") return "Earlier read";
  return "Raven read";
}

function validAttentionBenchmark(payload) {
  const benchmark = payload?.census?.attention_benchmark;
  const observation = benchmark?.raven_lead?.observation;
  const behavior = benchmark?.raven_lead?.behavior;
  const exact = benchmark?.raven_lead?.exact_decision_context;
  if (
    benchmark?.schema_version !== "ravenos_market_attention_benchmark_public_v1"
    || !["current", "delayed"].includes(benchmark?.freshness?.state)
    || finite(benchmark?.reference_scope?.episode_count) <= 0
    || finite(benchmark?.reference_scope?.distinct_markets) <= 0
    || finite(observation?.episodes) <= 0
    || finite(observation?.median_lead_seconds) === null
    || finite(behavior?.episodes) <= 0
    || finite(exact?.episodes) <= 0
    || benchmark?.interpretation?.profitability_claimed !== false
    || benchmark?.interpretation?.tradeable_rule_claimed !== false
    || benchmark?.interpretation?.selected_instrument_claimed !== false
    || benchmark?.public_safety?.reference_source_identity_exposed !== false
  ) return null;
  return benchmark;
}

function renderAttentionBenchmark(payload) {
  const host = document.getElementById("landingEdge");
  const benchmark = validAttentionBenchmark(payload);
  if (!host) return;
  host.hidden = !benchmark;
  if (!benchmark) return;
  const observation = benchmark.raven_lead.observation;
  const behavior = benchmark.raven_lead.behavior;
  const exact = benchmark.raven_lead.exact_decision_context;
  const episodeCount = finite(benchmark.reference_scope.episode_count);
  const distinctMarkets = finite(benchmark.reference_scope.distinct_markets);
  const observationShare = finite(observation.share_of_reference_episodes);
  setText("landingEdgeObserved", finite(observation.episodes)?.toLocaleString());
  setText("landingEdgeObservedShare", observationShare === null ? "" : `${Math.round(observationShare * 100)}% of matched attention episodes`, "");
  setText("landingEdgeLead", duration(observation.median_lead_seconds));
  setText("landingEdgeBehavior", finite(behavior.episodes)?.toLocaleString());
  setText("landingEdgeBehaviorLead", `${duration(behavior.median_lead_seconds)} median lead`, "");
  setText("landingEdgeExact", finite(exact.episodes)?.toLocaleString());
  setText("landingEdgeExactLead", `${duration(exact.median_lead_seconds)} median lead`, "");
  setText("landingEdgeSample", `${episodeCount.toLocaleString()} attention episodes · ${distinctMarkets.toLocaleString()} exact markets`);
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

function validLiveMarkets(payload) {
  if (payload?.ok !== true || payload?.schema_version !== "ravenos.hyperliquid.markets.v2" || payload?.isLive !== true || !Array.isArray(payload?.results)) return null;
  const seen = new Set();
  return payload.results.filter((row) => {
    const match = /^hyperliquid:perp:([A-Z0-9._-]+)$/.exec(String(row?.instrument_id || ""));
    if (!match || seen.has(row.instrument_id)) return false;
    const asset = match[1];
    const observedAt = Date.parse(String(row?.observed_at || ""));
    const exact = row?.instrument_scope === "exact_instrument"
      && row?.market_type === "perpetual"
      && String(row?.venue || "").toLowerCase() === "hyperliquid"
      && row?.asset === `${asset}-PERP`
      && row?.symbol === asset;
    const qualified = exact
      && row?.coverage === "live"
      && row?.freshness_state === "fresh"
      && row?.is_live === true
      && row?.is_synthetic === false
      && Number.isFinite(observedAt)
      && finite(row?.last_price ?? row?.lastPrice) !== null;
    if (qualified) seen.add(row.instrument_id);
    return qualified;
  }).sort((left, right) => (finite(right.day_notional_volume_usd ?? right.dayNtlVlm) || 0) - (finite(left.day_notional_volume_usd ?? left.dayNtlVlm) || 0));
}

function marketFactRow(row) {
  return {
    instrument_id: row.instrument_id,
    instrument: row.asset,
    market_type: "perpetual",
    context_state: row.freshness_state,
    observed_at: row.observed_at,
    landing_context_kind: "market_fact",
  };
}

function validAtlas(payload) {
  const rows = payload?.market_context?.rows;
  if (payload?.schema_version !== "ravenos.atlas_projection.v1" || payload?.delivery?.source !== "current_public_origin" || payload?.delivery?.fallback !== false || !["fresh", "delayed"].includes(payload?.freshness?.state) || !Array.isArray(rows) || payload?.execution_boundary?.signing_available !== false || payload?.execution_boundary?.submission_available !== false) return null;
  return rows.filter((row) => row?.instrument_id && row?.instrument?.instrument_id === row.instrument_id && row.instrument?.identity_scope === "exact_instrument" && row.instrument?.capabilities?.execution === false);
}

function renderOpportunityList() {
  const host = document.getElementById("landingOpportunityList");
  host.replaceChildren();
  setText("landingListEyebrow", state.listMode === "market_facts" ? "Market facts" : "Discover");
  setText("landingListTitle", state.listMode === "market_facts" ? "Live markets" : state.listMode === "raven" ? "Current attention" : "Market data");
  if (!state.displayRows.length) {
    const node = document.createElement("div"); node.className = "landing-empty-action";
    const strong = document.createElement("strong"); strong.textContent = "Current market data is refreshing";
    const span = document.createElement("span"); span.textContent = "Search any supported exact market while the next market cycle completes.";
    const link = document.createElement("a"); link.href = "/terminal/"; link.textContent = "Search markets →";
    node.append(strong, span, link); host.append(node); return;
  }
  for (const row of state.displayRows.slice(0, 5)) {
    const button = document.createElement("button"); button.type = "button"; button.className = "landing-opportunity"; button.dataset.instrumentId = row.instrument_id;
    const copy = document.createElement("span"); const strong = document.createElement("strong"); strong.textContent = row.instrument;
    const small = document.createElement("small");
    small.textContent = state.listMode === "market_facts"
      ? "Exact live market · Raven Read refreshing"
      : customerFacingText(row.why_raven_noticed, "Current Raven observation");
    copy.append(strong, small);
    const freshness = document.createElement("span"); freshness.textContent = state.listMode === "market_facts" ? "Market live" : ravenReadTiming(row); button.append(copy, freshness);
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
  setText("landingFreshness", chartState.operatorStateLabel || title(chartState.state));
}

function selectOpportunity(row) {
  state.selected = row;
  document.querySelectorAll(".landing-opportunity").forEach((button) => button.classList.toggle("active", button.dataset.instrumentId === row.instrument_id));
  const market = state.markets.get(row.instrument_id) || {};
  setText("landingInstrumentType", "Hyperliquid perpetual / exact contract"); setText("landingInstrument", row.instrument); setText("landingInstrumentId", row.instrument_id);
  setText("landingPrice", price(market.last_price ?? market.lastPrice)); const change = finite(market.day_change_pct ?? market.dayChangePct); setText("landingChange", percent(change));
  const changeNode = document.getElementById("landingChange"); changeNode.classList.toggle("positive", change !== null && change >= 0); changeNode.classList.toggle("negative", change !== null && change < 0);
  setText("landingVenue", "Hyperliquid"); setText("landingFunding", percent(market.funding_rate ?? market.funding, { ratio: true })); setText("landingOpenInterest", compact(market.open_interest_usd)); setText("landingFreshness", "Checking chart");
  const why = row.landing_context_kind === "market_fact" ? "" : customerFacingText(row.why_raven_noticed, "");
  const read = document.querySelector(".landing-read");
  const productGrid = document.querySelector(".landing-product-grid");
  if (read) read.hidden = !why;
  if (productGrid) productGrid.dataset.read = why ? "visible" : "hidden";
  setText("landingReadState", ravenReadTiming(row));
  setText("landingWhy", why, "");
  const pressure = title(row.pressure_state);
  const friction = finite(row.market_context?.roundtrip_bps);
  setText("landingReadSummary", [pressure, friction === null ? "" : `${friction.toFixed(1)} bps observed round trip`].filter(Boolean).join(" · "), "");
  setOptionalFact("landingPathFact", title(row.observed_direction), { label: "Observed direction" });
  setOptionalFact("landingEvidenceFact", Array.isArray(row.raven_atoms) ? row.raven_atoms.map((value) => title(value)).filter(Boolean).join(" · ") : "", { label: "What changed" });
  const comparableCount = finite(row.matured_comparables?.sample_size);
  setOptionalFact("landingComparablesFact", comparableCount > 0 ? comparableCount.toLocaleString() : "", { label: "Comparable paths" });
  const inspect = document.getElementById("landingInspect"); inspect.href = terminalHref(row);
  loadChart(row);
}

function renderAtlas(rows, payload) {
  const host = document.getElementById("landingAtlasList"); const band = document.querySelector(".landing-atlas-band"); host.replaceChildren();
  if (!rows?.length) {
    if (band) band.hidden = true;
    return;
  }
  if (band) band.hidden = false;
  for (const row of rows.slice(0, 4)) {
    const instrument = row.instrument; const params = new URLSearchParams({ asset: row.symbol, instrument_id: row.instrument_id, instrument_type: instrument.instrument_type, asset_class: instrument.asset_class, identity_scope: "exact_instrument", venue: instrument.venue, market: "equities", quote: instrument.quote_asset?.symbol || "USD", settlement: instrument.settlement_asset?.symbol || "USD", numeraire: instrument.economic_numeraire || "USDC" });
    const link = document.createElement("a"); link.className = "landing-atlas-row"; link.href = `/terminal/?${params.toString()}`;
    const identity = document.createElement("span"); const strong = document.createElement("strong"); strong.textContent = row.symbol; const small = document.createElement("small"); small.textContent = `${instrument.market_identity?.listing || instrument.venue} · listed market`; identity.append(strong, small);
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
  const liveMarkets = validLiveMarkets(marketPayload) || [];
  for (const row of liveMarkets) state.markets.set(row.instrument_id, row);
  const opportunityPayload = opportunityResult.status === "fulfilled" && opportunityResult.value.response.ok ? opportunityResult.value.payload : null;
  state.opportunities = validOpportunities(opportunityPayload) || [];
  state.listMode = state.opportunities.length ? "raven" : liveMarkets.length ? "market_facts" : "unavailable";
  state.displayRows = state.opportunities.length ? state.opportunities : liveMarkets.slice(0, 5).map(marketFactRow);
  renderOpportunityList(); renderAttentionBenchmark(opportunityPayload);
  setText("landingOpportunityCount", state.listMode === "raven" ? `${state.opportunities.length} current markets` : state.listMode === "market_facts" ? `${liveMarkets.length} live markets · Raven refreshing` : "Refreshing");
  const atlasPayload = atlasResult.status === "fulfilled" && atlasResult.value.response.ok ? atlasResult.value.payload : null; renderAtlas(validAtlas(atlasPayload), atlasPayload);
  const health = healthResult.status === "fulfilled" && healthResult.value.response.ok ? healthResult.value.payload : null;
  const marketState = health?.market_data_health?.state || (state.markets.size ? "live" : "waiting"); const intelligenceState = health?.intelligence_freshness?.state || (state.opportunities.length ? "fresh" : "waiting");
  const marketStateNode = document.getElementById("landingMarketState");
  setText("landingMarketState", `Market ${title(marketState)}`);
  marketStateNode.dataset.state = marketState;
  marketStateNode.hidden = ["waiting", "unavailable", "unknown"].includes(String(marketState).toLowerCase());
  const intelligenceStateNode = document.getElementById("landingIntelligenceState");
  setText("landingIntelligenceState", intelligenceState === "delayed" ? "Raven updating" : `Raven ${title(intelligenceState)}`);
  intelligenceStateNode.dataset.state = intelligenceState;
  intelligenceStateNode.hidden = ["waiting", "unavailable", "unknown"].includes(String(intelligenceState).toLowerCase());
  const originCurrent = state.displayRows.length > 0;
  setText("landingOriginState", state.listMode === "raven" ? "Current opportunities" : state.listMode === "market_facts" ? "Live markets · Raven refreshing" : "Market data refreshing");
  document.getElementById("landingOriginDot").dataset.state = originCurrent ? "live" : "waiting";
  setText("landingGeneratedAt", when(state.listMode === "raven" ? opportunityPayload?.census?.generated_at : liveMarkets[0]?.observed_at || atlasPayload?.generated_at), "Updating source time");
  if (state.displayRows[0]) selectOpportunity(state.displayRows[0]);
  else {
    const read = document.querySelector(".landing-read"); const productGrid = document.querySelector(".landing-product-grid"); if (read) read.hidden = true; if (productGrid) productGrid.dataset.read = "hidden"; document.getElementById("landingChartWrap").dataset.state = "unavailable";
    state.workspace.showUnavailable({
      message: "Current live market data is refreshing. Search an exact market to continue.",
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
        listMode: state.listMode,
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

boot().catch(() => { setText("landingOriginState", "Raven refreshing"); document.getElementById("landingOriginDot").dataset.state = "waiting"; });
