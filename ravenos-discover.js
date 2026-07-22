import { ravenOSContext } from "/ravenos-context-store.js";
import { customerFacingText } from "/ravenos-intelligence-contract.js";

const REFRESH_MS = 45_000;
const state = {
  rows: new Map(),
  order: [],
  markets: new Map(),
  atlasRows: [],
  paused: false,
  expanded: false,
  loading: false,
  lastRefresh: null,
  timer: null,
};

function text(value, fallback = "Unavailable") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function finite(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function title(value, fallback = "Unavailable") {
  const result = text(value, fallback);
  return result.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function compact(value, { currency = false } = {}) {
  const result = finite(value);
  if (result === null) return "—";
  const formatted = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(result);
  return currency ? `$${formatted}` : formatted;
}

function percent(value) {
  const result = finite(value);
  return result === null ? "—" : `${result >= 0 ? "+" : ""}${result.toFixed(Math.abs(result) < 0.1 ? 3 : 2)}%`;
}

function when(value) {
  const parsed = new Date(value || "");
  if (Number.isNaN(parsed.getTime())) return "Timestamp unavailable";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(parsed) + " UTC";
}

async function json(url) {
  const response = await fetch(url, { cache: "no-store", headers: { accept: "application/json" } });
  return { response, payload: await response.json().catch(() => null) };
}

function setState(id, value, label = null) {
  const node = document.getElementById(id);
  if (!node) return;
  node.dataset.state = text(value, "unavailable").toLowerCase();
  node.textContent = label || title(value);
}

function terminalHref(row) {
  if (row.source_type === "atlas_context") {
    const instrument = row.instrument_contract || {};
    const params = new URLSearchParams({
      asset: text(row.instrument, ""),
      instrument_id: text(row.instrument_id, ""),
      instrument_type: text(instrument.instrument_type, "equity"),
      asset_class: text(instrument.asset_class, "equity"),
      identity_scope: "exact_instrument",
      chain: "none",
      venue: text(instrument.venue, ""),
      market: "equities",
      quote: text(instrument.quote_asset?.symbol, "USD"),
      settlement: text(instrument.settlement_asset?.symbol, "USD"),
      cash: text(instrument.preferred_cash_asset?.symbol, "USD"),
      numeraire: text(instrument.economic_numeraire, "USDC"),
      timeframe: "1h",
    });
    return `/terminal/?${params.toString()}`;
  }
  const params = new URLSearchParams({
    asset: text(row.instrument, ""),
    instrument_id: text(row.instrument_id, ""),
    instrument_type: "perpetual",
    asset_class: "crypto",
    identity_scope: "exact_instrument",
    chain: "hyperliquid",
    venue: "hyperliquid",
    market: "perp",
    quote: "USD",
    settlement: "USDC",
    cash: "USDC",
    numeraire: "USDC",
    timeframe: "1h",
  });
  return `/terminal/?${params.toString()}`;
}

function append(node, tag, className, value) {
  const child = document.createElement(tag);
  if (className) child.className = className;
  child.textContent = value;
  node.append(child);
  return child;
}

function createOpportunityRow(row) {
  const atlas = row.source_type === "atlas_context";
  const anchor = document.createElement("a");
  anchor.className = "discover-row";
  anchor.dataset.opportunityId = text(row.public_opportunity_id, row.instrument_id);
  anchor.dataset.marketType = atlas ? "equity" : text(row.market_type, "unknown").toLowerCase();
  anchor.dataset.sourceType = atlas ? "atlas" : "raven";
  anchor.dataset.freshness = text(row.context_state, "unavailable").toLowerCase();
  anchor.href = terminalHref(row);

  const identity = append(anchor, "div", "discover-identity", "");
  identity.textContent = "";
  append(identity, "span", "", atlas ? `${title(row.market_type)} · Atlas` : title(row.market_type));
  append(identity, "strong", "", text(row.instrument));
  append(identity, "small", "", atlas
    ? `${text(row.instrument_contract?.market_identity?.listing, title(row.instrument_contract?.venue))} · exact listing`
    : "Hyperliquid · exact perpetual");

  const thesis = append(anchor, "div", "discover-thesis", "");
  thesis.textContent = "";
  append(thesis, "span", "", atlas ? "What changed" : "Why now");
  append(thesis, "strong", "", customerFacingText(atlas ? row.what_changed : row.why_raven_noticed, atlas ? "Current Atlas context is available." : "No public explanation is available."));

  const evidence = append(anchor, "div", "discover-evidence", "");
  evidence.textContent = "";
  append(evidence, "span", "", "What supports it");
  append(evidence, "strong", "", atlas ? `${title(row.context_state)} · behavior view unavailable` : `${title(row.context_state)} · ${title(row.path_review?.state, "History unavailable")}`);
  append(evidence, "small", "", atlas ? text(row.context_note, "Atlas context only") : `${compact(row.matured_comparables?.sample_size)} exact historical comparisons`);

  const market = append(anchor, "div", "discover-market", "");
  market.textContent = "";
  append(market, "span", "", "Market state");
  append(market, "strong", "", atlas ? text(row.market_state) : text(row.pressure_state));
  append(market, "small", "", atlas
    ? text(row.market_detail, "Current exact listing")
    : `OI ${compact(row.market_context?.open_interest, { currency: true })} · funding ${percent(finite(row.market_context?.funding_rate) === null ? null : Number(row.market_context.funding_rate) * 100)}`);

  append(anchor, "span", "discover-open", "Inspect");
  return anchor;
}

function updateOpportunityNode(node, row) {
  const replacement = createOpportunityRow(row);
  node.replaceWith(replacement);
  return replacement;
}

function renderOpportunityState({ heading, detail, code = "" }) {
  const host = document.getElementById("discoverStream");
  host.replaceChildren();
  document.getElementById("discoverStreamControl").hidden = true;
  const stateNode = append(host, "div", "workspace-state", "");
  stateNode.textContent = "";
  const inner = append(stateNode, "div", "", "");
  inner.textContent = "";
  append(inner, "span", "workspace-state-mark", "R");
  append(inner, "h2", "", heading);
  append(inner, "p", "", detail);
  if (code) append(inner, "code", "", code);
}

function renderSourceNotice(source, detail) {
  const host = document.getElementById("discoverStream");
  host.querySelector(`[data-discover-source-notice="${source}"]`)?.remove();
  if (!detail) return;
  const notice = document.createElement("div");
  notice.className = "discover-source-notice";
  notice.dataset.discoverSourceNotice = source;
  append(notice, "strong", "", source === "raven" ? "Raven opportunities unavailable" : "Atlas context unavailable");
  append(notice, "span", "", detail);
  host.prepend(notice);
}

function applyFilter() {
  const active = document.querySelector("[data-discover-filter].active")?.dataset.discoverFilter || "all";
  const rows = [...document.querySelectorAll(".discover-row")];
  const matching = rows.filter((row) => active === "all" || row.dataset.marketType === active);
  const limit = state.expanded ? Number.POSITIVE_INFINITY : window.matchMedia("(max-width: 560px)").matches ? 8 : 12;
  let shown = 0;
  rows.forEach((row) => {
    const matches = active === "all" || row.dataset.marketType === active;
    row.hidden = !matches || shown >= limit;
    if (matches) shown += 1;
  });
  const control = document.getElementById("discoverStreamControl");
  if (!control) return;
  control.hidden = matching.length <= (Number.isFinite(limit) ? limit : 12);
  control.textContent = state.expanded
    ? "Show the attention queue"
    : `Show ${Math.max(0, matching.length - limit).toLocaleString()} more exact markets`;
}

function renderOpportunities(rows, { generatedAt, appendOnly = false } = {}) {
  const host = document.getElementById("discoverStream");
  if (!appendOnly || !host.querySelector(".discover-row")) host.replaceChildren();
  const incomingIds = new Set();
  for (const row of rows) {
    const id = text(row.public_opportunity_id, row.instrument_id);
    incomingIds.add(id);
    state.rows.set(id, row);
    const existing = host.querySelector(`[data-opportunity-id="${CSS.escape(id)}"]`);
    if (existing) updateOpportunityNode(existing, row);
    else {
      state.order.push(id);
      host.append(createOpportunityRow(row));
    }
  }
  for (const id of [...state.rows.keys()]) {
    if (incomingIds.has(id)) continue;
    state.rows.delete(id);
    state.order = state.order.filter((value) => value !== id);
    host.querySelector(`[data-opportunity-id="${CSS.escape(id)}"]`)?.remove();
  }
  document.getElementById("discoverRowCount").textContent = rows.length.toLocaleString();
  document.getElementById("discoverUpdatedAt").textContent = when(generatedAt);
  document.getElementById("discoverStreamControl").hidden = false;
  applyFilter();
}

function createPulseRow(row) {
  const anchor = document.createElement("a");
  anchor.className = "pulse-row";
  anchor.href = terminalHref({ instrument: row.asset, instrument_id: row.instrument_id });
  const identity = append(anchor, "div", "", "");
  identity.textContent = "";
  append(identity, "strong", "", text(row.asset));
  append(identity, "span", "", `${text(row.instrument_id)} · OI ${compact(row.open_interest_usd, { currency: true })}`);
  const change = append(anchor, "span", "pulse-change", percent(row.day_change_pct));
  const amount = finite(row.day_change_pct);
  if (amount !== null) change.classList.add(amount >= 0 ? "positive" : "negative");
  return anchor;
}

function renderMarkets(rows) {
  const host = document.getElementById("discoverPulse");
  host.replaceChildren();
  const ranked = [...rows].sort((left, right) => (finite(right.day_notional_volume_usd) || 0) - (finite(left.day_notional_volume_usd) || 0)).slice(0, 10);
  if (!ranked.length) {
    const container = append(host, "div", "workspace-state", "");
    container.textContent = "Live venue markets unavailable.";
    return;
  }
  ranked.forEach((row) => host.append(createPulseRow(row)));
  setState("discoverMarketState", "live", "Live provider");
}

function currentOpportunityPayload(payload) {
  const delivery = payload?.delivery || {};
  const census = payload?.census;
  const rows = census?.opportunities?.rows;
  if (delivery.source !== "current_public_origin" || delivery.fallback !== false) throw new Error("current_origin_contract_rejected");
  if (delivery.freshness_state !== "fresh") throw new Error(`current_origin_${delivery.freshness_state || "unavailable"}`);
  if (!census || census.source_state !== "current" || !Array.isArray(rows)) throw new Error("current_census_schema_rejected");
  return { census, rows, generatedAt: census.generated_at || delivery.generated_at };
}

function currentAtlasPayload(payload) {
  const rows = payload?.market_context?.rows;
  const execution = payload?.execution_boundary || {};
  if (payload?.delivery?.source !== "current_public_origin" || payload?.delivery?.fallback !== false) throw new Error("atlas_current_origin_rejected");
  if (!payload?.schema_version || payload.schema_version !== "ravenos.atlas_projection.v1") throw new Error("atlas_schema_rejected");
  if (!["fresh", "delayed"].includes(payload?.freshness?.state) || !["available", "degraded"].includes(payload?.state)) throw new Error("atlas_freshness_rejected");
  if (!Array.isArray(rows)) throw new Error("atlas_rows_rejected");
  if (execution.signing_available !== false || execution.submission_available !== false) throw new Error("atlas_execution_boundary_rejected");
  const optionsById = new Map((payload.options_context || []).map((row) => [row.underlying_instrument_id, row]));
  const exactRows = rows.flatMap((row) => {
    const instrument = row?.instrument || {};
    if (!row?.instrument_id || instrument.instrument_id !== row.instrument_id || instrument.identity_scope !== "exact_instrument" || !["equity", "etf"].includes(instrument.instrument_type) || instrument.capabilities?.execution !== false) return [];
    const option = optionsById.get(row.instrument_id);
    const changes = [
      ["5d", row.change_5d],
      ["21d", row.change_21d],
      ["63d", row.change_63d],
    ].filter(([, value]) => finite(value) !== null).map(([label, value]) => `${label} ${percent(Number(value) * 100)}`);
    return [{
      public_opportunity_id: `atlas:${row.instrument_id}`,
      source_type: "atlas_context",
      instrument_id: row.instrument_id,
      instrument: row.symbol || instrument.symbol,
      instrument_contract: instrument,
      market_type: instrument.instrument_type,
      context_state: payload.freshness.state,
      what_changed: changes.length ? changes.join(" · ") : "Current price context is available; period change fields are unavailable.",
      context_note: option ? `${title(option.regime)} options · ${option.delayed ? "delayed" : "current"}` : "Options context unavailable",
      market_state: `${title(payload.market_context?.equity_regime)} equity regime`,
      market_detail: `${text(instrument.market_identity?.listing, title(instrument.venue))} · ${row.price === null || row.price === undefined ? "price unavailable" : `$${Number(row.price).toLocaleString("en-US", { maximumFractionDigits: 4 })}`}`,
      observed_at: row.observed_at || payload.generated_at,
    }];
  });
  return { rows: exactRows, generatedAt: payload.generated_at, state: payload.state, freshness: payload.freshness.state };
}

async function refresh({ manual = false } = {}) {
  if (state.loading || (state.paused && !manual)) return;
  state.loading = true;
  document.getElementById("discoverRefresh").textContent = "Refreshing…";
  const [opportunities, markets, atlas] = await Promise.allSettled([
    json("/api/opportunity"),
    json("/api/hyperliquid/perps"),
    json("/api/atlas"),
  ]);

  let ravenRows = [];
  let ravenGeneratedAt = null;
  let ravenFailure = "";
  if (opportunities.status === "fulfilled" && opportunities.value.response.ok) {
    try {
      const current = currentOpportunityPayload(opportunities.value.payload);
      ravenRows = current.rows.map((row) => ({ ...row, source_type: "raven_opportunity" }));
      ravenGeneratedAt = current.generatedAt;
      setState("discoverCensusState", "fresh", "Current");
    } catch {
      setState("discoverCensusState", "unavailable", "Unavailable");
      ravenFailure = "Current Raven data did not meet freshness or identity requirements. Older observations were not substituted.";
    }
  } else {
    setState("discoverCensusState", "unavailable", "Unavailable");
    const status = opportunities.status === "fulfilled" ? opportunities.value.response.status : "network";
    ravenFailure = `The current Raven read could not be reached${status === "network" ? "" : ` (${status})`}. Older observations were not substituted.`;
  }

  let atlasRows = [];
  let atlasGeneratedAt = null;
  let atlasFailure = "";
  if (atlas.status === "fulfilled" && atlas.value.response.ok) {
    try {
      const current = currentAtlasPayload(atlas.value.payload);
      atlasRows = current.rows;
      atlasGeneratedAt = current.generatedAt;
      state.atlasRows = atlasRows;
      setState("discoverAtlasState", current.freshness, current.state === "degraded" ? `Degraded · ${title(current.freshness)}` : title(current.freshness));
    } catch {
      state.atlasRows = [];
      setState("discoverAtlasState", "unavailable", "Unavailable");
      atlasFailure = "Current Atlas context did not meet freshness or identity requirements. Older context was not substituted.";
    }
  } else {
    state.atlasRows = [];
    setState("discoverAtlasState", "unavailable", "Unavailable");
    const status = atlas.status === "fulfilled" ? atlas.value.response.status : "network";
    atlasFailure = `Current Atlas context could not be reached${status === "network" ? "" : ` (${status})`}. Older context was not substituted.`;
  }

  const combinedRows = [...ravenRows, ...atlasRows];
  if (combinedRows.length) {
    const generatedAt = [ravenGeneratedAt, atlasGeneratedAt]
      .filter(Boolean)
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
    renderOpportunities(combinedRows, { generatedAt, appendOnly: state.rows.size > 0 });
    renderSourceNotice("raven", ravenFailure);
    renderSourceNotice("atlas", atlasFailure);
    const firstRaven = ravenRows[0];
    const firstAtlas = atlasRows[0];
    window.RavenOSShell?.setCapabilities?.({
      market: "Live markets + current projections",
      mode: "Read only",
      evidence: `${ravenRows.length} Raven · ${atlasRows.length} Atlas`,
      wallet: "No customer session",
      signing: "Sign off",
      broadcast: "Broadcast off",
    });
    window.RavenOSShell?.setIntelligence?.({
      subject: ravenOSContext.getState().subject,
      marketState: { label: `${combinedRows.length} current cross-market rows`, regime: "cross-market discovery" },
      setupState: { state: firstRaven ? "current_signal" : "broader_market_context", confirmation: "research only" },
      thesis: customerFacingText(firstRaven?.why_raven_noticed || firstAtlas?.what_changed, "Current market context is available."),
      supportingEvidence: [
        firstRaven ? `${firstRaven.instrument} retains exact ${firstRaven.identity_scope || "instrument"} identity.` : null,
        firstAtlas ? `${firstAtlas.instrument} retains exact listed identity; Atlas provenance remains separate.` : null,
      ].filter(Boolean),
      contradictingEvidence: [ravenFailure, atlasFailure].filter(Boolean),
      invalidation: [],
      timeHorizon: "current cycle",
      confidence: { label: "source bound" },
      evidenceQuality: { state: ravenRows.length ? "current" : "atlas_context", lineageComplete: true },
      freshness: { state: "live", observedAt: generatedAt },
      nextExpectedTransition: "Open an exact market to inspect its available Raven and Atlas context.",
    });
  } else {
    state.rows.clear();
    state.order = [];
    document.getElementById("discoverRowCount").textContent = "0";
    renderOpportunityState({
      heading: "No current opportunities can be shown",
      detail: "Raven and Atlas did not return current exact markets. Older observations were not substituted; live venue prices may still be available.",
    });
  }

  if (markets.status === "fulfilled" && markets.value.response.ok && Array.isArray(markets.value.payload?.results)) {
    markets.value.payload.results.forEach((row) => state.markets.set(row.instrument_id, row));
    renderMarkets(markets.value.payload.results);
  } else {
    setState("discoverMarketState", "unavailable", "Unavailable");
    document.getElementById("discoverPulse").replaceChildren();
  }

  state.lastRefresh = new Date().toISOString();
  state.loading = false;
  document.getElementById("discoverRefresh").textContent = "Refresh now";
}

function bind() {
  document.getElementById("discoverSearchTrigger").addEventListener("click", () => window.RavenOSShell?.openCommandPalette?.());
  document.querySelectorAll("[data-discover-filter]").forEach((button) => button.addEventListener("click", () => {
    if (button.disabled) return;
    document.querySelectorAll("[data-discover-filter]").forEach((item) => item.classList.toggle("active", item === button));
    state.expanded = false;
    applyFilter();
  }));
  document.getElementById("discoverStreamControl").addEventListener("click", () => {
    state.expanded = !state.expanded;
    applyFilter();
  });
  document.getElementById("discoverRefresh").addEventListener("click", () => refresh({ manual: true }));
  document.getElementById("discoverPause").addEventListener("click", (event) => {
    state.paused = !state.paused;
    event.currentTarget.textContent = state.paused ? "Resume updates" : "Pause updates";
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !state.paused && state.lastRefresh && Date.now() - Date.parse(state.lastRefresh) > REFRESH_MS) refresh();
  });
}

bind();
refresh();
state.timer = setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
window.__RAVENOS_DISCOVER__ = Object.freeze({
  getState: () => ({ rowCount: state.rows.size, marketCount: state.markets.size, paused: state.paused, expanded: state.expanded, loading: state.loading, lastRefresh: state.lastRefresh }),
  refresh: () => refresh({ manual: true }),
});
