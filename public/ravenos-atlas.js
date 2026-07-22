import { ravenOSContext } from "/ravenos-context-store.js";

function text(value, fallback = "Unavailable") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function title(value, fallback = "Unavailable") {
  return text(value, fallback).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function finite(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function price(value) {
  const result = finite(value);
  return result === null ? "—" : `$${result.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
}

function percent(value) {
  const result = finite(value);
  return result === null ? "—" : `${result >= 0 ? "+" : ""}${(Math.abs(result) <= 1 ? result * 100 : result).toFixed(2)}%`;
}

function append(host, tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  host.append(node);
  return node;
}

function setState(id, state, label) {
  const node = document.getElementById(id);
  node.dataset.state = text(state, "unavailable").toLowerCase();
  node.textContent = label || title(state);
}

function unavailable(reason) {
  const host = document.getElementById("atlasContent");
  host.replaceChildren();
  const outer = append(host, "div", "workspace-state", "");
  outer.textContent = "";
  const inner = append(outer, "div", "", "");
  inner.textContent = "";
  append(inner, "span", "workspace-state-mark", "A");
  append(inner, "h2", "", "Broader-market context unavailable");
  append(inner, "p", "", reason);
  setState("atlasProjectionState", "unavailable", "Unavailable");
  setState("atlasMarketState", "unavailable", "Unavailable");
  setState("atlasOptionsState", "unavailable", "Unavailable");
  window.RavenOSShell?.setCapabilities?.({ market: "Atlas unavailable · Raven independent", mode: "Read only", evidence: "No Atlas projection", wallet: "No customer session", signing: "Sign off", broadcast: "Broadcast off" });
}

function regimeCell(host, label, value) {
  const cell = append(host, "div", "", "");
  cell.textContent = "";
  append(cell, "span", "", label);
  append(cell, "strong", "", title(value));
}

function exactTerminalHref(row = {}) {
  const instrument = row.instrument || {};
  if (!row.instrument_id || instrument.instrument_id !== row.instrument_id || instrument.identity_scope !== "exact_instrument") return null;
  const params = new URLSearchParams({
    asset: row.symbol || instrument.symbol || "",
    instrument_id: row.instrument_id,
    instrument_type: instrument.instrument_type || "equity",
    asset_class: instrument.asset_class || "equity",
    identity_scope: "exact_instrument",
    venue: instrument.venue || "",
    market: "equities",
    quote: instrument.quote_asset?.symbol || "USD",
    settlement: instrument.settlement_asset?.symbol || "USD",
    cash: instrument.preferred_cash_asset?.symbol || "USD",
    numeraire: instrument.economic_numeraire || "USDC",
  });
  return `/terminal/?${params.toString()}`;
}

function renderMarkets(host, rows) {
  const table = append(host, "table", "atlas-market-table", "");
  table.textContent = "";
  const head = table.createTHead().insertRow();
  ["Instrument", "Price", "5d", "21d", "63d"].forEach((label) => append(head, "th", "", label));
  const body = table.createTBody();
  for (const row of rows) {
    const line = body.insertRow();
    const identity = line.insertCell();
    const href = exactTerminalHref(row);
    const label = text(row.symbol || row.instrument?.symbol || row.instrument_hint);
    if (href) {
      const link = append(identity, "a", "atlas-instrument-link", "");
      link.href = href;
      append(link, "strong", "", label);
    } else append(identity, "strong", "", label);
    append(identity, "small", "", href
      ? `${text(row.instrument?.market_identity?.listing, title(row.instrument?.venue))} · exact listing`
      : "Exact listing unavailable");
    [price(row.price), percent(row.change_5d), percent(row.change_21d), percent(row.change_63d)].forEach((value) => append(line, "td", "", value));
  }
}

function renderOptions(host, rows) {
  if (!rows.length) {
    const empty = append(host, "div", "atlas-module-unavailable", "");
    empty.textContent = "";
    append(empty, "strong", "", "Options summary unavailable");
    append(empty, "p", "", "No current options posture is available for the supported underlyings.");
    return;
  }
  for (const row of rows) {
    const item = append(host, "div", "atlas-list-row", "");
    item.textContent = "";
    const copy = append(item, "div", "", "");
    copy.textContent = "";
    append(copy, "strong", "", text(row.underlying));
    append(copy, "span", "", `${title(row.regime)} · skew ${title(row.skew_state)} · demand ${title(row.demand_state)}`);
    append(item, "small", "", `${text(row.provider)}${row.delayed ? " · delayed" : ""}`);
  }
}

function render(payload) {
  const projection = payload?.data?.schema_version === "ravenos.atlas_projection.v1" ? payload.data : payload;
  if (projection?.schema_version !== "ravenos.atlas_projection.v1") throw new Error("atlas_schema_rejected");
  if (!["available", "degraded"].includes(projection.state) || !["fresh", "delayed"].includes(projection.freshness?.state)) throw new Error(`atlas_${projection.state || "unavailable"}_${projection.freshness?.state || "unavailable"}`);
  if (payload?.delivery && (payload.delivery.source !== "current_public_origin" || payload.delivery.fallback !== false)) throw new Error("atlas_delivery_rejected");

  const host = document.getElementById("atlasContent");
  host.replaceChildren();
  const overview = append(host, "section", "atlas-overview", "");
  overview.textContent = "";
  const posture = append(overview, "article", "atlas-posture", "");
  posture.textContent = "";
  append(posture, "span", "workspace-label", "Cross-market posture");
  append(posture, "h2", "", title(projection.posture?.state));
  append(posture, "p", "", `Atlas sees ${title(projection.posture?.alignment).toLowerCase()} cross-market alignment with ${title(projection.posture?.confidence).toLowerCase()} confidence. This broader-market context does not replace Raven's behavioral read and is not a trade instruction.`);
  const regimes = append(overview, "div", "atlas-regime-grid", "");
  regimes.textContent = "";
  regimeCell(regimes, "Risk regime", projection.market_context?.risk_regime);
  regimeCell(regimes, "Equity regime", projection.market_context?.equity_regime);
  regimeCell(regimes, "Sector breadth", projection.market_context?.sector_breadth);
  regimeCell(regimes, "Participation", projection.market_context?.participation_quality);

  const grid = append(host, "section", "atlas-grid", "");
  grid.textContent = "";
  const markets = append(grid, "div", "workspace-main", "");
  markets.textContent = "";
  const marketHeader = append(markets, "header", "workspace-section-head", "");
  marketHeader.textContent = "";
  const marketCopy = append(marketHeader, "div", "", "");
  marketCopy.textContent = "";
  append(marketCopy, "span", "workspace-label", "Market map");
  append(marketCopy, "h2", "", "Exact listed markets");
  append(marketCopy, "p", "", "Select a supported listing to open the same instrument in Terminal. Atlas will not infer a different listing.");
  renderMarkets(markets, Array.isArray(projection.market_context?.rows) ? projection.market_context.rows : []);

  const side = append(grid, "aside", "workspace-side", "");
  side.textContent = "";
  const optionsHeader = append(side, "header", "workspace-section-head", "");
  optionsHeader.textContent = "";
  const optionsCopy = append(optionsHeader, "div", "", "");
  optionsCopy.textContent = "";
  append(optionsCopy, "span", "workspace-label", "Options context");
  append(optionsCopy, "h2", "", "Options posture by underlying");
  renderOptions(side, Array.isArray(projection.options_context) ? projection.options_context : []);

  setState("atlasProjectionState", projection.state, title(projection.state));
  setState("atlasMarketState", projection.capabilities?.market_map ? projection.freshness?.state : "unavailable", projection.capabilities?.market_map ? title(projection.freshness?.state) : "Unavailable");
  setState("atlasOptionsState", projection.capabilities?.options_summary ? projection.freshness?.state : "unavailable", projection.capabilities?.options_summary ? title(projection.freshness?.state) : "Unavailable");
  window.RavenOSShell?.setCapabilities?.({ market: `Atlas ${title(projection.state)}`, mode: "Read only", evidence: "Aggregate public context", wallet: "No customer session", signing: "Sign off", broadcast: "Broadcast off" });
  window.RavenOSShell?.setIntelligence?.({
    subject: ravenOSContext.getState().subject,
    marketState: { label: title(projection.posture?.state), regime: title(projection.market_context?.risk_regime) },
    setupState: { state: text(projection.posture?.alignment, "unknown"), confirmation: "Atlas context only" },
    thesis: `Cross-market rails are ${title(projection.posture?.alignment).toLowerCase()} with ${title(projection.posture?.confidence).toLowerCase()} confidence.`,
    supportingEvidence: Object.entries(projection.rail_breadth || {}).slice(0, 5).map(([rail, row]) => `${title(rail)}: ${title(row.trend)} trend, ${title(row.participation)} participation.`),
    contradictingEvidence: Object.entries(projection.provider_health || {}).filter(([, row]) => row.degraded).map(([rail]) => `${title(rail)} provider rail is degraded.`),
    invalidation: [],
    timeHorizon: "current Atlas cycle",
    confidence: { label: text(projection.posture?.confidence, "unknown") },
    evidenceQuality: { state: text(projection.freshness?.state, "unavailable"), lineageComplete: true },
    freshness: { state: projection.freshness?.state === "fresh" ? "live" : "delayed", observedAt: projection.generated_at },
    nextExpectedTransition: "Open an exact supported listing in the universal Terminal; unavailable listings are never inferred.",
  });
}

document.getElementById("atlasSearchTrigger").addEventListener("click", () => window.RavenOSShell?.openCommandPalette?.());
fetch("/api/atlas", { cache: "no-store", headers: { accept: "application/json" } })
  .then(async (response) => {
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error || `atlas_http_${response.status}`);
    render(payload);
    window.__RAVENOS_ATLAS__ = Object.freeze({ state: "available", schemaVersion: "ravenos.atlas_projection.v1", signingAvailable: false });
  })
  .catch((error) => {
    unavailable("Atlas could not establish current broader-market context. Raven opportunities, live perpetuals, and exact crypto charts remain available independently.");
    window.__RAVENOS_ATLAS__ = Object.freeze({ state: "unavailable", error: error.message, signingAvailable: false });
  });
