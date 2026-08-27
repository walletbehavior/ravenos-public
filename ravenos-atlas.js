import { ravenOSContext } from "/ravenos-context-store.js";
import {
  mountTradingViewBreadth,
  mountTradingViewChart,
  resolveTradingViewChart,
  resolveTradingViewReference,
} from "/ravenos-tradingview-adapter.js";

const SEARCH_DELAY_MS = 240;
const SEARCH_MIN_LENGTH = 2;
const MAX_VISIBLE_CONTRACTS = 80;
const GROUP_ORDER = ["Stocks & ETFs", "Indices", "Forex", "Futures", "Rates", "Economy", "Energy", "SEC Issuers", "SEC Filings", "Other"];
const DETAIL_VIEWS = new Set(["overview", "chart", "options", "filings", "insiders"]);

const state = {
  projection: null,
  featured: null,
  entity: null,
  viewerToken: createViewerToken(),
  searchController: null,
  detailController: null,
  tabController: null,
  searchTimer: null,
  chart: null,
  chartObserver: null,
  filingRailController: null,
  filingRailCache: new Map(),
  activeRefreshTimer: null,
  selectedSection: "major_etfs",
  activeTab: "overview",
};

function createViewerToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function text(value, fallback = "Unavailable") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function title(value, fallback = "Unavailable") {
  return text(value, fallback).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function number(value, digits = 2) {
  const result = finite(value);
  return result === null ? "—" : result.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function money(value, digits = 2) {
  const result = finite(value);
  return result === null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits }).format(result);
}

function percent(value) {
  const result = finite(value);
  return result === null ? "—" : `${result >= 0 ? "+" : ""}${result.toFixed(2)}%`;
}

function compact(value) {
  const result = finite(value);
  return result === null ? "—" : Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(result);
}

function dateTime(value, fallback = "Time unavailable") {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed)
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(parsed)
    : fallback;
}

function dateOnly(value, fallback = "Date unavailable") {
  const clean = String(value || "");
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(clean) ? Date.parse(`${clean}T00:00:00Z`) : Date.parse(clean);
  return Number.isFinite(parsed)
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(parsed)
    : fallback;
}

function append(host, tag, className = "", value = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  host.append(node);
  return node;
}

function setState(id, value, label = "") {
  const node = document.getElementById(id);
  if (!node) return;
  node.dataset.state = text(value, "unavailable").toLowerCase();
  node.textContent = label || title(value);
}

function setHeader({ title: heading, summary, detail = false }) {
  document.getElementById("atlasPageTitle").textContent = heading;
  document.getElementById("atlasPageSummary").textContent = summary;
  document.getElementById("atlasDetailActions").hidden = !detail;
  document.querySelector(".atlas-page")?.setAttribute("data-detail", String(detail));
}

function cleanReason(reason) {
  const value = String(reason || "").toLowerCase();
  if (!value) return "The required data is not available for this view.";
  if (value.includes("redistribution") || value.includes("display") || value.includes("restricted")) return "The provider permits RavenOS to resolve this market, but its values are not cleared for public display here.";
  if (value.includes("rights") || value.includes("license")) return "Public display rights have not been verified for this data.";
  if (value.includes("mapping") || value.includes("issuer")) return "An exact issuer match has not been established.";
  if (value.includes("optionable")) return "This exact instrument does not have a supported options path.";
  if (value.includes("provider") || value.includes("unavailable") || value.includes("circuit")) return "The required provider path is currently unavailable. No substitute was used.";
  if (value.includes("history")) return "Public historical coverage has not been established for this exact entity.";
  return "The required data did not meet RavenOS identity, freshness, or display requirements.";
}

function providerLabel(value) {
  const map = { fred: "FRED", eia: "EIA", sec: "SEC EDGAR", tradier: "Tradier", massive: "Massive", coingecko: "CoinGecko" };
  return map[String(value || "").toLowerCase()] || title(value, "Provider unavailable");
}

function safeSecUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "www.sec.gov" || host === "sec.gov") && url.pathname.startsWith("/Archives/") ? url.toString() : null;
  } catch {
    return null;
  }
}

function entityKindLabel(kind) {
  const map = {
    equity: "Stock", etf: "ETF", index: "Index", forex_pair: "Forex", future_root: "Futures market",
    future_contract: "Futures contract", rate_series: "Rate series", economic_series: "Economic series",
    energy_series: "Energy series", sec_issuer: "SEC issuer", sec_filing: "SEC filing", crypto_context_asset: "Crypto context",
  };
  return map[kind] || title(kind);
}

function timingLabel(row = {}) {
  const status = String(row.data_timing || row.status || "").toUpperCase();
  if (row.entity_class === "document_entity" || status === "DOCUMENT") return "Document record";
  if (["future_root", "future_contract"].includes(row.entity_kind) && status === "PERIODIC") return "Exact futures identity";
  if (status === "DELAYED") return "Delayed when opened";
  if (status === "PERIODIC") return "Periodic series";
  if (status === "LIVE") return row.public_display_eligibility === "allowed" ? "Market timing shown at source" : "Identity resolved";
  if (status === "DISPLAY RESTRICTED") return "Values restricted";
  return "Availability checked on open";
}

function stateNode(host, heading, detail, mark = "A") {
  const outer = append(host, "div", "workspace-state");
  const inner = append(outer, "div");
  append(inner, "span", "workspace-state-mark", mark);
  append(inner, "h2", "", heading);
  append(inner, "p", "", detail);
  return outer;
}

async function fetchJson(path, { signal, viewer = false } = {}) {
  const headers = { accept: "application/json" };
  if (viewer) headers["x-ravenos-atlas-viewer"] = state.viewerToken;
  const response = await fetch(path, { cache: "no-store", signal, headers });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    const error = new Error(payload?.message || payload?.error || `atlas_http_${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  const unsafeBoundary = Object.entries(payload?.execution_boundary || {}).some(([key, value]) => (
    value === true
    && (
      key.endsWith("_available")
      || ["execution", "signing", "submission", "broadcast", "order_submission"].includes(key)
    )
  ));
  if (unsafeBoundary) throw new Error("atlas_execution_boundary_rejected");
  return payload;
}

function destroyChart() {
  state.chartObserver?.disconnect();
  state.chartObserver = null;
  state.chart?.destroy?.();
  if (!state.chart?.destroy) state.chart?.remove?.();
  state.chart = null;
}

function clearActiveRefresh() {
  clearTimeout(state.activeRefreshTimer);
  state.activeRefreshTimer = null;
}

function clearFilingRailRequest() {
  state.filingRailController?.abort();
  state.filingRailController = null;
}

function scheduleActiveRefresh(callback, delayMs) {
  clearActiveRefresh();
  state.activeRefreshTimer = setTimeout(async () => {
    if (document.hidden) return scheduleActiveRefresh(callback, delayMs);
    await callback();
  }, delayMs);
}

function detailView(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return DETAIL_VIEWS.has(normalized) ? normalized : "overview";
}

function updateUrl(entityId = "", { replace = false, view = "overview" } = {}) {
  const url = new URL(location.href);
  if (entityId) url.searchParams.set("entity_id", entityId);
  else url.searchParams.delete("entity_id");
  ["instrument_id", "asset", "tab"].forEach((key) => url.searchParams.delete(key));
  const normalizedView = detailView(view);
  if (entityId && normalizedView !== "overview") url.searchParams.set("view", normalizedView);
  else url.searchParams.delete("view");
  history[replace ? "replaceState" : "pushState"]({ atlasEntityId: entityId, atlasView: normalizedView }, "", url);
}

function closeSearch() {
  const host = document.getElementById("atlasSearchResults");
  host.hidden = true;
  host.replaceChildren();
}

function groupRows(payload) {
  if (payload.groups && typeof payload.groups === "object") return payload.groups;
  const groups = {};
  for (const row of payload.results || []) {
    const group = row.entity_kind === "equity" || row.entity_kind === "etf" ? "Stocks & ETFs" : entityKindLabel(row.entity_kind);
    (groups[group] ||= []).push(row);
  }
  return groups;
}

function renderSearchResults(payload) {
  const host = document.getElementById("atlasSearchResults");
  host.replaceChildren();
  const groups = groupRows(payload);
  const ordered = Object.entries(groups).sort(([a], [b]) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b));
  if (!ordered.some(([, rows]) => Array.isArray(rows) && rows.length)) {
    const empty = append(host, "div", "atlas-search-empty");
    append(empty, "strong", "", "No exact Atlas entity found");
    append(empty, "span", "", "Try a ticker, company name, FRED series ID, energy concept, SEC issuer, or CIK. RavenOS will not invent a match.");
  }
  for (const [group, rows] of ordered) {
    if (!Array.isArray(rows) || !rows.length) continue;
    const section = append(host, "section", "atlas-search-group");
    append(section, "span", "atlas-search-group-label", group);
    for (const row of rows) {
      const button = append(section, "button", "atlas-search-row");
      button.type = "button";
      button.dataset.entityId = row.entity_id;
      const identity = append(button, "span", "atlas-search-identity");
      append(identity, "strong", "", text(row.symbol));
      append(identity, "small", "", text(row.name));
      const semantics = append(button, "span", "atlas-search-semantics");
      append(semantics, "strong", "", entityKindLabel(row.entity_kind));
      append(semantics, "small", "", `${providerLabel(row.provider)} · ${timingLabel(row)}`);
      const stateLabel = row.cached_snapshot_available ? "Recent snapshot" : "Open context";
      append(button, "span", "atlas-search-open", stateLabel);
      button.addEventListener("click", () => selectEntity(row.entity_id));
    }
  }
  host.hidden = false;
}

async function runSearch(query, { autoSelect = false } = {}) {
  const clean = String(query || "").trim();
  if (clean.length < SEARCH_MIN_LENGTH) {
    closeSearch();
    return null;
  }
  state.searchController?.abort();
  state.searchController = new AbortController();
  const host = document.getElementById("atlasSearchResults");
  host.replaceChildren();
  const loading = append(host, "div", "atlas-search-progress", "Searching Atlas…");
  loading.setAttribute("role", "status");
  host.hidden = false;
  try {
    const payload = await fetchJson(`/api/atlas/search?q=${encodeURIComponent(clean)}&limit=20`, { signal: state.searchController.signal });
    renderSearchResults(payload);
    if (autoSelect) {
      const upper = clean.toUpperCase();
      const matches = (payload.results || []).filter((row) => String(row.symbol || "").toUpperCase() === upper);
      if (matches.length === 1) await selectEntity(matches[0].entity_id, { updateHistory: false });
    }
    return payload;
  } catch (error) {
    if (error.name === "AbortError") return null;
    host.replaceChildren();
    const message = append(host, "div", "atlas-search-empty");
    append(message, "strong", "", "Search is temporarily unavailable");
    append(message, "span", "", "Try again shortly. No alternate market was loaded.");
    host.hidden = false;
    return null;
  }
}

function bindSearch() {
  const form = document.getElementById("atlasSearchForm");
  const input = document.getElementById("atlasSearchInput");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    clearTimeout(state.searchTimer);
    runSearch(input.value);
  });
  input.addEventListener("input", () => {
    clearTimeout(state.searchTimer);
    if (input.value.trim().length < SEARCH_MIN_LENGTH) return closeSearch();
    state.searchTimer = setTimeout(() => runSearch(input.value), SEARCH_DELAY_MS);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSearch();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!form.contains(event.target)) closeSearch();
  });
}

function relativeAge(value) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
  if (seconds < 60) return "Updated just now";
  if (seconds < 3600) return `Updated ${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `Updated ${Math.floor(seconds / 3600)}h ago`;
  return `Updated ${Math.floor(seconds / 86_400)}d ago`;
}

function marketFrameHeading(projection) {
  const risk = String(projection?.market_context?.risk_regime || "").toLowerCase();
  const alignment = String(projection?.posture?.alignment || "").toLowerCase();
  if (risk.includes("risk_on") || risk === "constructive") return "Risk appetite is expanding.";
  if (risk.includes("risk_off") || risk === "defensive") return "Risk appetite is defensive.";
  if (risk === "mixed" || alignment === "fragmented") return "Risk appetite is fragmented.";
  if (alignment === "aligned") return "Cross-market signals are aligned.";
  if ([risk, alignment].some((value) => value && !["unknown", "unavailable", "forming"].includes(value))) return "Cross-market signals are mixed.";
  return "Risk posture is forming.";
}

function marketFrameSummary(projection) {
  const context = projection?.market_context || {};
  const known = (value) => {
    const normalized = String(value || "").trim().toLowerCase();
    return normalized && !["unknown", "unavailable", "forming"].includes(normalized) ? normalized : "";
  };
  const parts = [
    known(context.equity_regime) ? `Equities are ${title(context.equity_regime).toLowerCase()}` : "",
    known(context.sector_breadth) ? `breadth is ${title(context.sector_breadth).toLowerCase()}` : "",
    known(context.participation_quality) ? `participation is ${title(context.participation_quality).toLowerCase()}` : "",
  ].filter(Boolean);
  return parts.length
    ? `${parts.join(", ")}.`
    : "Atlas is waiting for enough public-display-qualified signals to call risk-on or risk-off. No proxy score is being substituted.";
}

function marketReturn(value) {
  const result = finite(value);
  if (result === null) return "—";
  const percentValue = result * 100;
  return `${percentValue >= 0 ? "+" : ""}${percentValue.toFixed(2)}%`;
}

function renderPosture(host, projection) {
  const overview = append(host, "section", "atlas-overview");
  const posture = append(overview, "article", "atlas-posture");
  const postureHead = append(posture, "div", "atlas-posture-head");
  append(postureHead, "span", "workspace-label", "Cross-market risk posture");
  const postureAvailable = marketFrameHeading(projection) !== "Risk posture is forming.";
  const freshnessLabel = postureAvailable && projection?.generated_at
    ? relativeAge(projection.generated_at)
    : "Awaiting qualified signals";
  const freshness = append(postureHead, "span", "atlas-frame-freshness", freshnessLabel);
  freshness.dataset.state = postureAvailable ? projection?.freshness?.state || "available" : "forming";
  append(posture, "h2", "", marketFrameHeading(projection));
  append(posture, "p", "", marketFrameSummary(projection));
  const contextRows = Array.isArray(projection?.market_context?.rows)
    ? projection.market_context.rows
      .filter((row) => finite(row?.change_5d) !== null || finite(row?.change_21d) !== null)
      .slice(0, 4)
    : [];
  if (contextRows.length) {
    const tape = append(posture, "div", "atlas-frame-tape");
    for (const row of contextRows) {
      const cell = append(tape, "div");
      append(cell, "strong", "", text(row.symbol, "Market"));
      append(cell, "span", "", `5d ${marketReturn(row.change_5d)}`);
      append(cell, "small", "", `21d ${marketReturn(row.change_21d)}`);
    }
  }
  const regimes = append(overview, "div", "atlas-regime-grid");
  const facts = postureAvailable
    ? [
      ["Risk tone", projection?.market_context?.risk_regime],
      ["Equities", projection?.market_context?.equity_regime],
      ["Breadth", projection?.market_context?.sector_breadth],
      ["Participation", projection?.market_context?.participation_quality],
    ]
    : [
      ["Risk posture", "Forming"],
      ["Equity breadth", "Visual view below"],
      ["Signal standard", "Public-display qualified"],
      ["Assessment", "No proxy score"],
    ];
  for (const [label, value] of facts) {
    const cell = append(regimes, "div");
    append(cell, "span", "", label);
    append(cell, "strong", "", title(value));
  }
}

function renderBreadthPresentation(host) {
  const section = append(host, "section", "atlas-breadth-presentation");
  const head = append(section, "header", "workspace-section-head");
  const copy = append(head, "div");
  append(copy, "span", "workspace-label", "Equity participation");
  append(copy, "h2", "", "See where participation is broad or narrow");
  append(copy, "p", "", "A TradingView S&P 500 heatmap provides visual breadth context while Atlas's own quantified breadth assessment remains in development.");
  const badge = append(head, "span", "atlas-breadth-badge", "TradingView presentation");
  const frameHost = append(section, "div", "atlas-breadth-host");
  const mounted = mountTradingViewBreadth(frameHost);
  if (!mounted) {
    frameHost.replaceChildren();
    stateNode(frameHost, "Breadth view unavailable", "The TradingView presentation could not be mounted. Atlas did not create a replacement score.");
  }
  const footer = append(section, "footer", "atlas-breadth-meta");
  append(footer, "span", "", "Visual context only · not an Atlas-derived breadth score");
  const link = append(footer, "a", "", "Market data and heatmap by TradingView ↗");
  link.href = "https://www.tradingview.com/heatmap/stock/";
  link.target = "_blank";
  link.rel = "noopener nofollow";
  append(footer, "small", "", "Displayed inside TradingView's isolated frame; values are not copied into RavenOS.");
}

function featuredValue(row) {
  const snapshot = row.snapshot;
  if (!snapshot || finite(snapshot.last) === null) return { value: "Open for detail", change: "", state: "catalog" };
  return { value: money(snapshot.last), change: percent(snapshot.change_percent), state: snapshot.stale ? "stale" : snapshot.delay_class === "delayed_15m" ? "delayed" : "available" };
}

function renderFeatured(host, featured) {
  const sections = Array.isArray(featured?.sections) ? featured.sections : [];
  if (!sections.length) return;
  const shell = append(host, "section", "atlas-pulse");
  const head = append(shell, "header", "workspace-section-head");
  const copy = append(head, "div");
  append(copy, "span", "workspace-label", "Market map");
  append(copy, "h2", "", "Explore the broader market");
  append(copy, "p", "", "Open a market for its chart, events, options, filings, and cross-market context.");
  const nav = append(shell, "div", "atlas-section-tabs");
  nav.setAttribute("role", "tablist");
  const board = append(shell, "div", "atlas-pulse-board");
  if (!sections.some((section) => section.section_id === state.selectedSection)) state.selectedSection = sections[0].section_id;
  const draw = (sectionId) => {
    state.selectedSection = sectionId;
    nav.querySelectorAll("button").forEach((button) => {
      const active = button.dataset.sectionId === sectionId;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    board.replaceChildren();
    const section = sections.find((candidate) => candidate.section_id === sectionId);
    for (const row of section?.entities || []) {
      const button = append(board, "button", "atlas-pulse-row");
      button.type = "button";
      const identity = append(button, "span", "atlas-pulse-identity");
      append(identity, "strong", "", text(row.symbol));
      append(identity, "small", "", text(row.name));
      const semantics = append(button, "span", "atlas-pulse-semantics");
      append(semantics, "strong", "", entityKindLabel(row.entity_kind));
      append(semantics, "small", "", `${providerLabel(row.provider)} · ${timingLabel(row)}`);
      const shown = featuredValue(row);
      const value = append(button, "span", "atlas-pulse-value");
      value.dataset.state = shown.state;
      append(value, "strong", "", shown.value);
      append(value, "small", "", shown.change || (row.public_display_eligibility === "allowed" ? "Open chart and context" : "Identity available"));
      append(button, "span", "atlas-pulse-open", "→");
      button.addEventListener("click", () => selectEntity(row.entity_id));
    }
  };
  for (const section of sections) {
    const button = append(nav, "button", "", section.label);
    button.type = "button";
    button.dataset.sectionId = section.section_id;
    button.setAttribute("role", "tab");
    button.addEventListener("click", () => draw(section.section_id));
  }
  draw(state.selectedSection);
}

function renderAtlasRoadmap(host) {
  const section = append(host, "section", "atlas-roadmap");
  const copy = append(section, "div");
  append(copy, "span", "workspace-label", "Atlas Pro roadmap");
  append(copy, "h2", "", "Deeper intelligence when the data rights are ready");
  append(copy, "p", "", "Planned paid capabilities include Raven-native breadth, true filing marks on Raven charts, richer filing comparisons, and portfolio-aware research.");
  const state = append(section, "span", "atlas-roadmap-state", "Planned · not yet available");
  state.dataset.state = "forming";
}

function renderLanding() {
  destroyChart();
  clearActiveRefresh();
  state.entity = null;
  setHeader({
    title: "One market, resolved in context.",
    summary: "Search markets, rates, energy, companies, options, and filings from one research desk.",
  });
  const host = document.getElementById("atlasContent");
  host.replaceChildren();
  renderPosture(host, state.projection);
  renderBreadthPresentation(host);
  renderFeatured(host, state.featured);
  const sec = append(host, "section", "atlas-sec-entry");
  const secCopy = append(sec, "div");
  append(secCopy, "span", "workspace-label", "SEC context");
  append(secCopy, "h2", "", "Follow the issuer behind the move");
  append(secCopy, "p", "", "Search a company, ticker, or CIK to inspect recent filings and reported insider activity. Filing time and transaction time remain separate.");
  const trigger = append(sec, "button", "workspace-secondary-action", "Search SEC issuers");
  trigger.type = "button";
  trigger.addEventListener("click", () => {
    const input = document.getElementById("atlasSearchInput");
    input.focus();
    input.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  renderAtlasRoadmap(host);
  setState("atlasProjectionState", state.featured ? "available" : "unavailable", state.featured ? "Searchable" : "Unavailable");
  setState("atlasMarketState", state.projection?.freshness?.state || (state.featured ? "available" : "unavailable"), state.projection ? title(state.projection.freshness?.state) : state.featured ? "Catalog ready" : "Unavailable");
  setState("atlasOptionsState", "available", "Protected");
  window.RavenOSShell?.setCapabilities?.({ market: "Atlas searchable", mode: "Research", evidence: "Source timing visible", signing: "Unavailable", broadcast: "Unavailable" });
}

function providerStateView(host, view, heading = "Current observation") {
  const outer = append(host, "section", "atlas-provider-state");
  const head = append(outer, "div", "atlas-provider-state-head");
  const copy = append(head, "div");
  append(copy, "span", "workspace-label", heading);
  append(copy, "strong", "", providerLabel(view?.provider));
  const badge = append(head, "span", "atlas-state-badge", title(view?.state));
  badge.dataset.state = view?.state || "unavailable";
  const timing = append(outer, "div", "atlas-source-ledger");
  const cells = [
    ["Source time", view?.provider_timestamp ? dateTime(view.provider_timestamp) : "Not supplied"],
    ["Seen by RavenOS", view?.fetched_at ? dateTime(view.fetched_at) : "Not retrieved"],
    ["Data timing", title(view?.delay_class, "Unknown")],
    ["Availability", view?.state === "available" ? "Values available" : view?.state === "display_restricted" ? "Visual context only" : "Unavailable"],
  ];
  for (const [label, value] of cells) {
    const cell = append(timing, "div");
    append(cell, "span", "", label);
    append(cell, "strong", "", value);
  }
  if (view?.attribution) append(outer, "small", "atlas-attribution", view.attribution);
  if (view?.state === "display_restricted" || view?.state === "unavailable") {
    const reason = Array.isArray(view.refusal_reasons) ? view.refusal_reasons[0] : "";
    const note = append(outer, "div", "atlas-decision-note");
    append(note, "strong", "", view.state === "display_restricted" ? "Why values are not shown" : "Why this is unavailable");
    append(note, "p", "", cleanReason(reason));
  }
  return outer;
}

function detailTabsFor(row) {
  const tabs = [{ id: "overview", label: "Overview" }];
  if (["rate_series", "economic_series", "energy_series"].includes(row.entity_kind)) tabs.push({ id: "chart", label: "History" });
  if (row.optionable) tabs.push({ id: "options", label: "Options" });
  if (["equity", "etf", "sec_issuer"].includes(row.entity_kind)) {
    tabs.push({ id: "filings", label: "Filings" });
    tabs.push({ id: "insiders", label: "Insiders" });
  }
  return tabs;
}

async function resolveExactListedInstrument(row, { signal } = {}) {
  if (!["equity", "etf"].includes(row?.entity_kind) || !row?.symbol) return null;
  try {
    const payload = await fetchJson(`/api/instruments/search?q=${encodeURIComponent(row.symbol)}`, { signal });
    const matches = (payload.results || []).filter((candidate) => (
      String(candidate.symbol || "").toUpperCase() === String(row.symbol).toUpperCase()
      && candidate.schema_version === "ravenos.instrument.v1"
      && candidate.identity_scope === "exact_instrument"
      && candidate.instrument_type === row.entity_kind
    ));
    return matches.length === 1 ? matches[0] : null;
  } catch (error) {
    if (error.name === "AbortError") throw error;
    return null;
  }
}

function renderMetric(host, label, value, detail = "") {
  const cell = append(host, "div", "atlas-detail-metric");
  append(cell, "span", "", label);
  append(cell, "strong", "", value);
  if (detail) append(cell, "small", "", detail);
}

function renderChartResearchNav(host, payload) {
  const row = payload.entity;
  if (!["equity", "etf"].includes(row.entity_kind)) return;
  const availableViews = new Set(detailTabsFor(row).map((tab) => tab.id));
  const actions = [
    { id: "filings", mark: "SEC", label: "Filings", detail: "Forms and source documents" },
    { id: "insiders", mark: "F4", label: "Insider activity", detail: "Reported Form 4 transactions" },
    { id: "options", mark: "IV", label: "Options research", detail: "Expirations and selected chain" },
  ].filter((action) => availableViews.has(action.id));
  if (!actions.length) return;
  const rail = append(host, "section", "atlas-chart-research");
  rail.setAttribute("aria-label", "Research this chart");
  const head = append(rail, "div", "atlas-chart-research-head");
  const copy = append(head, "div");
  append(copy, "span", "workspace-label", "Chart intelligence");
  append(copy, "strong", "", "Research this move");
  append(head, "small", "", "Jump from price structure to source evidence for this exact instrument.");
  const links = append(rail, "div", "atlas-chart-research-links");
  for (const action of actions) {
    const button = append(links, "button", "", "");
    button.type = "button";
    button.dataset.researchView = action.id;
    button.setAttribute("aria-label", `Open ${action.label} for ${row.symbol}`);
    append(button, "b", "", action.mark);
    const buttonCopy = append(button, "span");
    append(buttonCopy, "strong", "", action.label);
    append(buttonCopy, "small", "", action.detail);
    append(button, "i", "", "→");
    button.addEventListener("click", () => showTab(action.id, payload, { updateHistory: true }));
  }
}

function filingEventKind(formValue) {
  const form = String(formValue || "").toUpperCase().replace("/A", "").trim();
  if (form === "8-K" || form === "6-K") return "Material event";
  if (["10-K", "10-Q", "20-F", "40-F"].includes(form)) return "Financial report";
  if (["3", "4", "5"].includes(form)) return "Insider ownership";
  if (form.includes("13D") || form.includes("13G")) return "Beneficial ownership";
  if (form.includes("13F")) return "Institutional holdings";
  if (form.includes("NPORT") || form.includes("N-PORT")) return "Fund holdings";
  if (form.includes("DEF 14A") || form.includes("DEFA14A")) return "Governance & proxy";
  if (form.startsWith("S-1") || form.startsWith("424B")) return "Offering document";
  return "SEC filing";
}

function drawChartFilingEvents(host, rows, payload) {
  host.replaceChildren();
  const sorted = [...rows]
    .filter((row) => row && row.form && row.filed_at)
    .sort((left, right) => Date.parse(right.accepted_at || right.filed_at || "") - Date.parse(left.accepted_at || left.filed_at || ""))
    .slice(0, 8);
  if (!sorted.length) {
    const empty = append(host, "div", "atlas-filing-event-empty");
    append(empty, "strong", "", "No recent filing events returned");
    append(empty, "span", "", "Atlas did not infer an event or substitute another issuer.");
    return;
  }
  const track = append(host, "div", "atlas-filing-event-track");
  for (const row of sorted) {
    const article = append(track, "article", "atlas-filing-event-card");
    const marker = append(article, "span", "atlas-filing-event-marker", text(row.form, "SEC"));
    marker.setAttribute("aria-hidden", "true");
    const copy = append(article, "div");
    append(copy, "time", "", dateOnly(row.filed_at));
    append(copy, "strong", "", filingEventKind(row.form));
    append(copy, "small", "", `${text(row.form, "SEC filing")}${row.amendment ? " amendment" : ""}${row.reporting_period ? ` · period ${row.reporting_period}` : ""}`);
    const filingUrl = safeSecUrl(row.filing_url);
    if (filingUrl) {
      const link = append(article, "a", "", "Open filing ↗");
      link.href = filingUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
  }
  const more = append(host, "button", "atlas-filing-event-more", "Open complete filing list →");
  more.type = "button";
  more.addEventListener("click", () => showTab("filings", payload, { updateHistory: true }));
}

function renderChartFilingRail(host, payload) {
  if (!["equity", "etf"].includes(payload.entity?.entity_kind)) return;
  const section = append(host, "section", "atlas-filing-event-rail");
  section.setAttribute("aria-label", `SEC filing events for ${payload.entity.symbol}`);
  const head = append(section, "header", "atlas-filing-event-head");
  const copy = append(head, "div");
  append(copy, "span", "workspace-label", "SEC filing events");
  append(copy, "strong", "", `What was filed around ${payload.entity.symbol}`);
  append(head, "small", "", "Chronological event rail · not plotted to TradingView's time axis");
  const body = append(section, "div", "atlas-filing-event-body");
  const cached = state.filingRailCache.get(payload.entity.entity_id);
  if (cached) {
    drawChartFilingEvents(body, cached, payload);
    return;
  }
  const loading = append(body, "div", "atlas-filing-event-empty");
  append(loading, "strong", "", "Checking recent SEC filings");
  append(loading, "span", "", "Exact issuer only; no filing content is being summarized.");
  clearFilingRailRequest();
  const controller = new AbortController();
  state.filingRailController = controller;
  fetchJson(`/api/atlas/sec/filings?entity_id=${encodeURIComponent(payload.entity.entity_id)}&limit=16`, { signal: controller.signal, viewer: true })
    .then((result) => {
      if (controller.signal.aborted || state.entity?.entity?.entity_id !== payload.entity.entity_id) return;
      const rows = result.filings?.state === "available" && Array.isArray(result.filings.data) ? result.filings.data : [];
      state.filingRailCache.set(payload.entity.entity_id, rows);
      drawChartFilingEvents(body, rows, payload);
    })
    .catch((error) => {
      if (error.name === "AbortError" || controller.signal.aborted) return;
      body.replaceChildren();
      const unavailable = append(body, "div", "atlas-filing-event-empty");
      append(unavailable, "strong", "", "Filing events unavailable");
      append(unavailable, "span", "", "Atlas could not establish the exact SEC issuer. No event was inferred.");
    })
    .finally(() => {
      if (state.filingRailController === controller) state.filingRailController = null;
    });
}

function renderOverview(host, payload) {
  const row = payload.entity;
  const view = payload.snapshot || {};
  const data = view.data && typeof view.data === "object" ? view.data : null;
  const main = append(host, "div", "atlas-detail-layout");
  const primary = append(main, "section", "atlas-detail-primary");
  const head = append(primary, "header", "workspace-section-head");
  const copy = append(head, "div");
  append(copy, "span", "workspace-label", "Market context");
  append(copy, "h2", "", row.entity_class === "reference_series" ? "Latest published observation" : row.entity_class === "document_entity" ? "Issuer document context" : "See the exact market before the narrative");
  const externalReference = !data && ["equity", "etf", "index", "forex_pair", "future_root"].includes(row.entity_kind)
    ? resolveTradingViewReference(row, { exactInstrument: payload.exact_instrument })
    : null;
  const externalChart = externalReference?.widget_supported
    ? resolveTradingViewChart(row, { exactInstrument: payload.exact_instrument })
    : null;
  if (data) {
    const metrics = append(primary, "div", "atlas-detail-metrics");
    if (row.entity_class === "reference_series") {
      renderMetric(metrics, "Latest", number(payload.snapshot.latest?.value ?? data.observations?.at?.(-1)?.value, 4), payload.snapshot.latest?.period || data.observations?.at?.(-1)?.period || "Period unavailable");
      renderMetric(metrics, "Previous", number(payload.snapshot.previous?.value ?? data.observations?.at?.(-2)?.value, 4), payload.snapshot.previous?.period || data.observations?.at?.(-2)?.period || "Period unavailable");
      renderMetric(metrics, "Frequency", text(data.frequency, row.data_frequency));
      renderMetric(metrics, "Class", entityKindLabel(row.entity_kind));
    } else if (row.entity_class === "document_entity") {
      renderMetric(metrics, "Form", text(data.form, entityKindLabel(row.entity_kind)));
      renderMetric(metrics, "Filed", dateTime(data.filed_at), data.accepted_at ? `Accepted ${dateTime(data.accepted_at)}` : "Acceptance time unavailable");
      renderMetric(metrics, "Reporting period", dateOnly(data.reporting_period));
      renderMetric(metrics, "Record", data.amendment ? "Amendment" : "Original filing", text(data.accession_number));
      const filingUrl = safeSecUrl(data.filing_url);
      if (filingUrl) {
        const link = append(primary, "a", "atlas-source-link", "Open authoritative SEC filing ↗");
        link.href = filingUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
    } else {
      renderMetric(metrics, "Last", money(data.last, 4));
      renderMetric(metrics, "Change", percent(data.change_percent), money(data.change));
      renderMetric(metrics, "Range", `${money(data.low, 4)} – ${money(data.high, 4)}`, `Open ${money(data.open, 4)}`);
      renderMetric(metrics, "Volume", compact(data.volume), `Previous close ${money(data.previous_close, 4)}`);
    }
  } else if (externalChart) {
    const chartPanel = append(primary, "section", "atlas-visual-chart");
    const chartHost = append(chartPanel, "div", "atlas-visual-chart-host");
    const resolved = mountTradingViewChart(chartHost, row, { exactInstrument: payload.exact_instrument });
    const footer = append(chartPanel, "footer", "atlas-visual-chart-meta");
    append(footer, "span", "", `${resolved.timing} · ${resolved.session}`);
    const link = append(footer, "a", "", resolved.attribution);
    link.href = resolved.attribution_url;
    link.target = "_blank";
    link.rel = "noopener nofollow";
    append(footer, "small", "", "Visual context only. It is not Raven evidence, an order price, or a portfolio valuation.");
    renderChartFilingRail(primary, payload);
  } else if (externalReference) {
    const unavailable = append(primary, "div", "atlas-detail-refusal atlas-external-only");
    append(unavailable, "strong", "", `${row.symbol} remains exact`);
    append(unavailable, "p", "", `This exchange feed cannot be displayed inside RavenOS. We will not replace ${row.symbol} with a different index, ETF, contract, or CFD.`);
    const link = append(unavailable, "a", "atlas-source-link", `Open exact ${row.symbol} chart on TradingView ↗`);
    link.href = externalReference.attribution_url;
    link.target = "_blank";
    link.rel = "noopener nofollow";
  } else {
    const unavailable = append(primary, "div", "atlas-detail-refusal");
    append(unavailable, "strong", "", view.state === "document_entity" ? "Open a filing view for source documents" : "Market values are not shown");
    append(unavailable, "p", "", view.state === "document_entity"
      ? "Atlas resolves the issuer and retrieves filing metadata only when you open Filings or Insiders."
      : cleanReason(view.refusal_reasons?.[0]));
  }
  renderChartResearchNav(primary, payload);
  const semantics = append(primary, "section", "atlas-decision-grid");
  const decisions = [
    ["Exact market", `${row.name} resolves as a ${entityKindLabel(row.entity_kind).toLowerCase()} through ${providerLabel(row.provider)}. No alternate listing is substituted.`],
    ["Decision boundary", row.entity_class === "document_entity" ? "A filing record is not a quote or a complete filing summary." : "Visual context is not a Raven recommendation, order price, or personalized plan."],
    ["Inspect next", row.optionable ? "Open Options for one selected expiration, or continue into Terminal with this exact identity." : row.entity_class === "reference_series" ? "Open History for the published series, with its units and observation dates intact." : "Continue into Terminal only when this exact listing is supported there."],
  ];
  for (const [label, value] of decisions) {
    const cell = append(semantics, "div");
    append(cell, "span", "", label);
    append(cell, "p", "", value);
  }
  const side = append(main, "aside", "atlas-detail-side");
  providerStateView(side, view, "Source & timing");
  const meaning = append(side, "section", "atlas-market-meaning");
  append(meaning, "span", "workspace-label", "What this view can answer");
  append(meaning, "strong", "", externalChart ? "Price structure is visible" : externalReference ? "Exact identity is preserved" : data ? "A source-qualified observation is available" : "Identity is established; values are not");
  append(meaning, "p", "", externalChart
    ? "Use the chart for visual market context. Atlas events, filings, options, and Raven evidence remain separate so their authority stays clear."
    : externalReference
      ? `The exact ${row.symbol} market is retained even though its chart cannot be embedded. No proxy is shown in its place.`
    : data
      ? "The source and its timing travel with the observation. A successful data retrieval does not become a recommendation."
      : "RavenOS will not fill the gap with another listing, a stale snapshot, or a proxy that was not selected.");
  if (["equity", "etf"].includes(row.entity_kind) && view.state === "available" && view.delay_class === "current") {
    const entityId = row.entity_id;
    scheduleActiveRefresh(async () => {
      if (state.entity?.entity?.entity_id !== entityId || state.activeTab !== "overview") return;
      try {
        const refreshed = await fetchJson(`/api/atlas/entity?entity_id=${encodeURIComponent(entityId)}`, { viewer: true });
        if (refreshed.entity?.entity_id !== entityId || state.activeTab !== "overview") return;
        state.entity = refreshed;
        const panel = document.getElementById("atlasDetailPanel");
        panel?.replaceChildren();
        if (panel) renderOverview(panel, refreshed);
      } catch {
        scheduleActiveRefresh(() => Promise.resolve(), 30_000);
      }
    }, 15_000);
  }
}

function normalizeChartTime(period) {
  const clean = String(period || "");
  let normalized = clean;
  const quarter = /^(\d{4})-Q([1-4])$/.exec(clean);
  const week = /^(\d{4})-W(\d{2})$/.exec(clean);
  if (quarter) normalized = `${quarter[1]}-${String((Number(quarter[2]) - 1) * 3 + 1).padStart(2, "0")}-01T00:00:00Z`;
  else if (week) {
    const year = Number(week[1]);
    const weekNumber = Number(week[2]);
    const januaryFourth = new Date(Date.UTC(year, 0, 4));
    const monday = new Date(januaryFourth);
    monday.setUTCDate(januaryFourth.getUTCDate() - ((januaryFourth.getUTCDay() + 6) % 7) + ((weekNumber - 1) * 7));
    normalized = monday.toISOString();
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) normalized = `${clean}T00:00:00Z`;
  else if (/^\d{4}-\d{2}$/.test(clean)) normalized = `${clean}-01T00:00:00Z`;
  else if (/^\d{4}$/.test(clean)) normalized = `${clean}-01-01T00:00:00Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function renderHistoryChart(host, observations, label) {
  const candidates = (Array.isArray(observations) ? observations : [])
    .map((row) => ({ time: normalizeChartTime(row.period), value: finite(row.value), period: row.period }))
    .filter((row) => row.time && row.value !== null);
  const byTime = new Map();
  let conflictingPeriod = false;
  for (const row of candidates) {
    const prior = byTime.get(row.time);
    if (prior && prior.value !== row.value) conflictingPeriod = true;
    else if (!prior) byTime.set(row.time, row);
  }
  if (conflictingPeriod) {
    stateNode(host, "History unavailable", "The provider returned more than one value for the same exact period. Atlas did not collapse distinct series into one chart.");
    return;
  }
  const rows = [...byTime.values()].sort((left, right) => left.time - right.time);
  if (rows.length < 2 || typeof window.RavenSeriesChart !== "function") {
    const table = append(host, "div", "atlas-history-list");
    for (const row of rows.slice(-20).reverse()) {
      const item = append(table, "div");
      append(item, "span", "", text(row.period));
      append(item, "strong", "", number(row.value, 4));
    }
    if (!rows.length) stateNode(host, "History unavailable", "No chartable public observations were returned for this exact series.");
    return;
  }
  const wrap = append(host, "div", "atlas-history-chart");
  wrap.setAttribute("aria-label", `${label} historical chart`);
  state.chart = window.RavenSeriesChart(wrap, {
    rows,
    label,
    units: (Array.isArray(observations) ? observations : []).find((row) => row?.unit)?.unit || "Published value",
    height: 420,
    timeVisible: false,
  });
}

function option(select, value, label, { selected = false, disabled = false } = {}) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  node.selected = selected;
  node.disabled = disabled;
  select.append(node);
  return node;
}

function eiaExactFacet(dataset = {}) {
  const facets = Array.isArray(dataset.facets) ? dataset.facets.filter((row) => row?.id) : [];
  return facets.find((row) => row.id === "series") || (facets.length === 1 ? facets[0] : null);
}

function eiaControl(host, label, values, valueLabel) {
  const wrapper = append(host, "label", "atlas-eia-control");
  append(wrapper, "span", "", label);
  const select = append(wrapper, "select");
  select.setAttribute("aria-label", label);
  for (const value of values) option(select, value.id, valueLabel(value));
  return select;
}

async function renderEiaDatasetHistory(host, payload, dataset) {
  const exactFacet = eiaExactFacet(dataset);
  const frequencies = Array.isArray(dataset?.frequencies) ? dataset.frequencies.filter((row) => row?.id) : [];
  const dataFields = Array.isArray(dataset?.data_fields) ? dataset.data_fields.filter(Boolean).map((id) => ({ id: String(id) })) : [];
  const head = append(host, "header", "workspace-section-head");
  const copy = append(head, "div");
  append(copy, "span", "workspace-label", "EIA dataset explorer");
  append(copy, "h2", "", payload.entity.name);
  append(copy, "p", "", "Choose one exact published series. Atlas fetches no observations until you confirm the selection.");

  if (!exactFacet || !frequencies.length || !dataFields.length) {
    const reason = !exactFacet
      ? "This dataset needs one exact series selection. Atlas will not guess a partial combination."
      : "The source did not provide enough information to select an exact series.";
    stateNode(host, "Exact series selection unavailable", reason);
    return;
  }

  const explorer = append(host, "section", "atlas-eia-explorer");
  const controls = append(explorer, "div", "atlas-eia-controls");
  const frequency = eiaControl(controls, "Frequency", frequencies, (row) => row.description || title(row.id));
  const dataField = eiaControl(controls, "Measure", dataFields, (row) => title(row.id));
  const facet = eiaControl(controls, "Exact dimension", [{ id: exactFacet.id }], () => exactFacet.name || title(exactFacet.id));
  facet.disabled = true;
  const valueWrapper = append(controls, "label", "atlas-eia-control atlas-eia-series-control");
  append(valueWrapper, "span", "", "Published series");
  const facetValue = append(valueWrapper, "select");
  facetValue.setAttribute("aria-label", "Published series");
  option(facetValue, "", "Loading available series…", { selected: true, disabled: true });
  facetValue.disabled = true;
  const load = append(controls, "button", "workspace-primary-action", "Load exact series");
  load.type = "button";
  load.disabled = true;
  const status = append(explorer, "p", "atlas-eia-status", "Loading available series choices.");
  const output = append(explorer, "div", "atlas-eia-output");

  try {
    const params = new URLSearchParams({ entity_id: payload.entity.entity_id, facet_id: exactFacet.id });
    const facetPayload = await fetchJson(`/api/atlas/eia/facets?${params.toString()}`, { signal: state.tabController.signal, viewer: true });
    const view = facetPayload.facets;
    const values = view?.state === "available" && Array.isArray(view.data?.values) ? view.data.values : [];
    facetValue.replaceChildren();
    option(facetValue, "", values.length ? "Choose an exact published series" : "No public series returned", { selected: true, disabled: true });
    for (const row of values) option(facetValue, row.id, `${row.name || row.id} · ${row.id}`);
    facetValue.disabled = !values.length;
    load.disabled = !values.length;
    status.textContent = values.length
      ? `${values.length} published series available${view.data.truncated ? " · refine the selection for more" : ""}.`
      : "No public series identifiers were returned. Atlas did not broaden the query.";
    if (!values.length) providerStateView(output, view || { state: "unavailable", provider: "eia", refusal_reasons: ["series_identifiers_unavailable"] }, "EIA facet source");
  } catch (error) {
    if (error.name === "AbortError") return;
    facetValue.replaceChildren();
    option(facetValue, "", "Series lookup unavailable", { selected: true, disabled: true });
    status.textContent = "EIA series identifiers are unavailable. No observation query was attempted.";
    stateNode(output, "Series lookup unavailable", "Atlas could not retrieve the available series choices. Try again shortly.");
  }

  load.addEventListener("click", async () => {
    const selectedValue = facetValue.value;
    if (!selectedValue || !frequency.value || !dataField.value) return;
    destroyChart();
    state.tabController?.abort();
    state.tabController = new AbortController();
    load.disabled = true;
    output.replaceChildren();
    stateNode(output, "Loading the selected series", "Retrieving its published observations and history.");
    const params = new URLSearchParams({
      entity_id: payload.entity.entity_id,
      frequency: frequency.value,
      data_field: dataField.value,
      facet_id: exactFacet.id,
      facet_value: selectedValue,
    });
    try {
      const seriesPayload = await fetchJson(`/api/atlas/eia/series?${params.toString()}`, { signal: state.tabController.signal, viewer: true });
      const view = seriesPayload.series;
      const selection = seriesPayload.selection || {};
      const exact = seriesPayload.selection_exact === true
        && selection.frequency === frequency.value
        && selection.data_field === dataField.value
        && selection.facets?.[exactFacet.id] === selectedValue;
      output.replaceChildren();
      if (!exact || view?.state !== "available" || !Array.isArray(view.data?.observations)) {
        providerStateView(output, view || { state: "unavailable", provider: "eia", refusal_reasons: ["exact_series_unavailable"] }, "EIA series source");
        return;
      }
      const resultHead = append(output, "div", "atlas-options-note");
      append(resultHead, "strong", "", facetValue.selectedOptions[0]?.textContent || selectedValue);
      const unit = view.data.observations.find((row) => row.unit)?.unit || "published units";
      append(resultHead, "span", "", `${title(frequency.value)} · ${title(dataField.value)} · ${unit} · PERIODIC`);
      renderHistoryChart(output, view.data.observations, facetValue.selectedOptions[0]?.textContent || payload.entity.name);
      providerStateView(output, view, "EIA history provenance");
      status.textContent = `Exact series ${selectedValue} loaded. Original EIA periods and units are preserved.`;
    } catch (error) {
      if (error.name === "AbortError") return;
      output.replaceChildren();
      stateNode(output, "Exact series unavailable", "The selected EIA series could not be retrieved. Atlas did not substitute another route, facet, or benchmark.");
    } finally {
      load.disabled = false;
    }
  });
}

async function renderHistory(host, payload) {
  state.tabController?.abort();
  state.tabController = new AbortController();
  stateNode(host, "Loading exact series history", "Atlas is requesting only this selected series.");
  try {
    const response = await fetchJson(`/api/atlas/history?entity_id=${encodeURIComponent(payload.entity.entity_id)}&limit=360`, { signal: state.tabController.signal, viewer: true });
    host.replaceChildren();
    if (response.state === "facet_selection_required" && response.dataset && payload.entity.entity_kind === "energy_series") {
      await renderEiaDatasetHistory(host, payload, response.dataset);
      return;
    }
    const view = response.history;
    if (!view || view.state !== "available" || !view.data) {
      providerStateView(host, view || { state: "unavailable", provider: payload.entity.provider, refusal_reasons: response.refusal_reasons || [] }, "Historical source");
      return;
    }
    const head = append(host, "header", "workspace-section-head");
    const copy = append(head, "div");
    append(copy, "span", "workspace-label", "Published history");
    append(copy, "h2", "", payload.entity.name);
    append(copy, "p", "", `${text(payload.entity.data_frequency)} · original observation periods preserved`);
    renderHistoryChart(host, view.data.observations, payload.entity.name);
    providerStateView(host, view, "History provenance");
  } catch (error) {
    if (error.name === "AbortError") return;
    host.replaceChildren();
    stateNode(host, "History unavailable", "The exact public series could not be retrieved. No proxy series was substituted.");
  }
}

function renderContracts(host, payload, view) {
  const data = view.data || {};
  const rows = Array.isArray(data.contracts) ? data.contracts : [];
  const head = append(host, "div", "atlas-options-note");
  append(head, "strong", "", `${payload.entity.symbol} · ${dateOnly(data.expiration || payload.expiration)}`);
  append(head, "span", "", `${rows.length} contracts returned · quotes ${title(view.delay_class)} · Greeks update hourly`);
  const tableWrap = append(host, "div", "atlas-table-wrap");
  const table = append(tableWrap, "table", "atlas-options-table");
  const tableHead = table.createTHead().insertRow();
  ["Type", "Strike", "Bid", "Ask", "Last", "Volume", "Open interest", "IV", "Delta"].forEach((label) => append(tableHead, "th", "", label));
  const body = table.createTBody();
  for (const row of rows.slice(0, MAX_VISIBLE_CONTRACTS)) {
    const line = body.insertRow();
    [title(row.right), money(row.strike), money(row.bid), money(row.ask), money(row.last), compact(row.volume), compact(row.open_interest), finite(row.iv) === null ? "—" : percent(row.iv * 100), number(row.delta, 3)].forEach((value) => append(line, "td", "", value));
  }
  if (rows.length > MAX_VISIBLE_CONTRACTS) append(host, "small", "atlas-attribution", `Showing the first ${MAX_VISIBLE_CONTRACTS} contracts from the selected expiration. No other expiration was fetched.`);
}

async function loadOptionChain(host, entityPayload, expiration) {
  clearActiveRefresh();
  state.tabController?.abort();
  state.tabController = new AbortController();
  const results = host.querySelector("[data-options-results]");
  results.replaceChildren();
  stateNode(results, "Loading one selected chain", `${dateOnly(expiration)} only. No other expiration is being retrieved.`);
  try {
    const payload = await fetchJson(`/api/atlas/options/chain?entity_id=${encodeURIComponent(entityPayload.entity.entity_id)}&expiration=${encodeURIComponent(expiration)}`, { signal: state.tabController.signal, viewer: true });
    results.replaceChildren();
    if (payload.chain?.state !== "available" || !payload.chain.data) {
      providerStateView(results, payload.chain || { state: "unavailable", provider: entityPayload.entity.provider, refusal_reasons: payload.refusal_reasons || [] }, "Selected option chain");
      return;
    }
    renderContracts(results, entityPayload, payload.chain);
    providerStateView(results, payload.chain, "Option quote provenance");
    if (payload.chain.delay_class === "current") {
      const entityId = entityPayload.entity.entity_id;
      scheduleActiveRefresh(async () => {
        if (state.entity?.entity?.entity_id !== entityId || state.activeTab !== "options") return;
        await loadOptionChain(host, entityPayload, expiration);
      }, 15_000);
    }
  } catch (error) {
    if (error.name === "AbortError") return;
    results.replaceChildren();
    stateNode(results, "Selected chain unavailable", "No other expiration or provider was substituted.");
  }
}

async function renderOptions(host, entityPayload) {
  state.tabController?.abort();
  state.tabController = new AbortController();
  stateNode(host, "Checking expirations", "Options work begins only because this tab is open.");
  try {
    const payload = await fetchJson(`/api/atlas/options/expirations?entity_id=${encodeURIComponent(entityPayload.entity.entity_id)}`, { signal: state.tabController.signal, viewer: true });
    host.replaceChildren();
    const view = payload.options;
    if (!view || view.state !== "available" || !view.data) {
      providerStateView(host, view || { state: "unavailable", provider: entityPayload.entity.provider, refusal_reasons: payload.refusal_reasons || [] }, "Options availability");
      return;
    }
    const expirations = Array.isArray(view.data.expirations) ? view.data.expirations : [];
    if (!expirations.length) return stateNode(host, "No supported expirations", "The exact underlying returned no option expirations. No alternate root was used.");
    const controls = append(host, "div", "atlas-options-controls");
    const label = append(controls, "label", "", "Expiration");
    const select = append(label, "select");
    for (const expiration of expirations) select.add(new Option(dateOnly(expiration), expiration));
    const status = append(controls, "span", "", `${expirations.length} expirations available · one chain at a time`);
    status.setAttribute("role", "status");
    const results = append(host, "div");
    results.dataset.optionsResults = "true";
    select.addEventListener("change", () => loadOptionChain(host, entityPayload, select.value));
    await loadOptionChain(host, entityPayload, select.value);
  } catch (error) {
    if (error.name === "AbortError") return;
    host.replaceChildren();
    stateNode(host, "Options unavailable", "The selected underlying's options path could not be verified. No chain was inferred.");
  }
}

function renderFilingRows(host, rows) {
  if (!rows.length) return stateNode(host, "No recent supported filings", "Atlas found no supported recent filing metadata for this exact issuer.");
  const filters = append(host, "div", "atlas-filing-filters");
  const forms = ["All", ...new Set(rows.map((row) => String(row.form || "")).filter(Boolean))];
  const list = append(host, "div", "atlas-filing-list");
  const draw = (form) => {
    list.replaceChildren();
    for (const row of rows.filter((item) => form === "All" || item.form === form)) {
      const article = append(list, "article", "atlas-filing-row");
      const identity = append(article, "div");
      append(identity, "strong", "", `${text(row.form)} · ${text(row.issuer_name, "Issuer")}`);
      append(identity, "span", "", `${dateTime(row.filed_at)} filed${row.reporting_period ? ` · period ${row.reporting_period}` : ""}`);
      append(identity, "small", "", row.amendment ? "Amendment · linked to the original filing when available" : "Original filing metadata");
      const filingUrl = safeSecUrl(row.filing_url);
      if (filingUrl) {
        const link = append(article, "a", "", "Open SEC filing ↗");
        link.href = filingUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
    }
  };
  for (const form of forms) {
    const button = append(filters, "button", form === "All" ? "active" : "", form);
    button.type = "button";
    button.addEventListener("click", () => {
      filters.querySelectorAll("button").forEach((candidate) => candidate.classList.toggle("active", candidate === button));
      draw(form);
    });
  }
  draw("All");
}

async function renderFilings(host, entityPayload) {
  state.tabController?.abort();
  state.tabController = new AbortController();
  stateNode(host, "Loading recent filing metadata", "Atlas is requesting the exact SEC issuer. Metadata is not presented as a filing summary.");
  try {
    const payload = await fetchJson(`/api/atlas/sec/filings?entity_id=${encodeURIComponent(entityPayload.entity.entity_id)}&limit=100`, { signal: state.tabController.signal, viewer: true });
    host.replaceChildren();
    if (payload.filings?.state !== "available" || !Array.isArray(payload.filings.data)) {
      providerStateView(host, payload.filings || { state: "unavailable", provider: "sec", refusal_reasons: [] }, "SEC filing source");
      return;
    }
    const note = append(host, "div", "atlas-options-note");
    append(note, "strong", "", "SEC filing metadata");
    append(note, "span", "", "Use the original document for authoritative filing content. Atlas has not generated a filing summary here.");
    renderFilingRows(host, payload.filings.data);
    providerStateView(host, payload.filings, "Filing provenance");
  } catch (error) {
    if (error.name === "AbortError") return;
    host.replaceChildren();
    stateNode(host, "Filings unavailable", "An exact SEC issuer could not be established or EDGAR could not be reached. No issuer was guessed.");
  }
}

function insiderClassLabel(row) {
  const value = String(row.transaction_class || "other");
  return title(value.replace("open_market_", "open_market "));
}

function renderInsiderRows(host, rows) {
  if (!rows.length) return stateNode(host, "No normalized Form 4 activity", "No supported natural Form 4 transaction was available for this exact issuer.");
  const controls = append(host, "div", "atlas-insider-filters");
  const classSelect = append(controls, "select");
  classSelect.setAttribute("aria-label", "Insider transaction class");
  ["all", "open_market_purchase", "open_market_sale", "grant_or_award", "option_exercise_or_conversion", "tax_withholding", "gift", "transfer", "other"].forEach((value) => classSelect.add(new Option(value === "all" ? "All transaction classes" : title(value), value)));
  const roleSelect = append(controls, "select");
  roleSelect.setAttribute("aria-label", "Insider role");
  [["all", "All roles"], ["officer", "Officer"], ["director", "Director"], ["ten_percent_owner", "10% owner"]].forEach(([value, label]) => roleSelect.add(new Option(label, value)));
  const list = append(host, "div", "atlas-insider-list");
  const draw = () => {
    list.replaceChildren();
    const filtered = rows.filter((row) => {
      const classMatch = classSelect.value === "all" || row.transaction_class === classSelect.value;
      const roleMatch = roleSelect.value === "all" || row.relationship?.[roleSelect.value] === true;
      return classMatch && roleMatch;
    });
    if (!filtered.length) return stateNode(list, "No matching transactions", "No normalized filing events match these neutral filters.");
    for (const row of filtered) {
      const article = append(list, "article", "atlas-insider-row");
      const head = append(article, "div", "atlas-insider-head");
      const identity = append(head, "div");
      append(identity, "strong", "", text(row.reporting_owner, "Reporting owner"));
      append(identity, "span", "", `${text(row.relationship?.officer_title, "Role not stated")} · ${insiderClassLabel(row)}`);
      const side = append(head, "div");
      append(side, "strong", "", row.acquired_or_disposed === "A" ? "Acquired" : row.acquired_or_disposed === "D" ? "Disposed" : "Reported");
      append(side, "span", "", row.gross_transaction_value === null || row.gross_transaction_value === undefined ? "Value not stated" : money(row.gross_transaction_value, 0));
      const ledger = append(article, "div", "atlas-insider-ledger");
      [["Transaction", dateOnly(row.transaction_at)], ["Filed", dateTime(row.filed_at)], ["Shares", number(row.shares, 2)], ["Price", money(row.price, 4)], ["After", number(row.post_transaction_holdings, 2)], ["Ownership", title(row.direct_or_indirect_ownership)]].forEach(([label, value]) => {
        const cell = append(ledger, "div");
        append(cell, "span", "", label);
        append(cell, "strong", "", value);
      });
      const flags = append(article, "p", "", `${row.rule_10b5_1 === true ? "10b5-1 indicated" : row.rule_10b5_1 === false ? "10b5-1 not indicated" : "10b5-1 state not stated"}${row.amendment ? " · Amendment" : ""}. Transaction date and public filing time are shown separately; no motive or causation is inferred.`);
      const documentUrl = safeSecUrl(row.original_document);
      if (documentUrl) {
        const link = append(article, "a", "", "Open original Form 4 ↗");
        link.href = documentUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
    }
  };
  classSelect.addEventListener("change", draw);
  roleSelect.addEventListener("change", draw);
  draw();
}

async function renderInsiders(host, entityPayload) {
  state.tabController?.abort();
  state.tabController = new AbortController();
  stateNode(host, "Normalizing recent Form 4 filings", "Atlas preserves transaction time, public filing time, transaction class, and ambiguity separately.");
  try {
    const payload = await fetchJson(`/api/atlas/sec/insiders?entity_id=${encodeURIComponent(entityPayload.entity.entity_id)}&limit=5`, { signal: state.tabController.signal, viewer: true });
    host.replaceChildren();
    const note = append(host, "div", "atlas-options-note");
    append(note, "strong", "", "Reported insider activity");
    append(note, "span", "", "Neutral Form 4 normalization · no options enrichment · no misconduct inference");
    renderInsiderRows(host, Array.isArray(payload.events) ? payload.events : []);
    const source = append(host, "small", "atlas-attribution", "Source: U.S. Securities and Exchange Commission EDGAR. Filing documents remain authoritative.");
    source.dataset.state = payload.parse_failures?.length ? "degraded" : "available";
  } catch (error) {
    if (error.name === "AbortError") return;
    host.replaceChildren();
    stateNode(host, "Insider activity unavailable", "Form 4 data could not be normalized for this exact issuer. No inference or substitute event was produced.");
  }
}

async function resolveTerminalLink(row, exactInstrument = null) {
  const link = document.getElementById("atlasOpenTerminal");
  link.hidden = true;
  link.removeAttribute("href");
  if (!["equity", "etf"].includes(row.entity_kind)) return;
  try {
    const exact = exactInstrument || await resolveExactListedInstrument(row);
    if (!exact) return;
    const params = new URLSearchParams({
      asset: exact.symbol,
      instrument_id: exact.instrument_id,
      instrument_type: exact.instrument_type,
      asset_class: exact.asset_class,
      identity_scope: "exact_instrument",
      venue: exact.venue,
      market: "equities",
      quote: exact.quote_asset?.symbol || "USD",
      settlement: exact.settlement_asset?.symbol || "USD",
    });
    link.href = `/terminal/?${params.toString()}`;
    link.hidden = false;
  } catch {
    link.hidden = true;
  }
}

async function showTab(tabId, payload, { updateHistory = false } = {}) {
  if (!detailTabsFor(payload.entity).some((tab) => tab.id === tabId)) return;
  destroyChart();
  clearActiveRefresh();
  clearFilingRailRequest();
  state.tabController?.abort();
  state.activeTab = tabId;
  if (updateHistory) {
    const url = new URL(location.href);
    const currentEntity = url.searchParams.get("entity_id");
    const currentView = detailView(url.searchParams.get("view"));
    if (currentEntity !== payload.entity.entity_id || currentView !== tabId) {
      updateUrl(payload.entity.entity_id, { view: tabId });
    }
  }
  const nav = document.querySelector(".atlas-detail-tabs");
  nav?.querySelectorAll("button").forEach((button) => {
    const active = button.dataset.tab === tabId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  const host = document.getElementById("atlasDetailPanel");
  host.replaceChildren();
  if (tabId === "overview") renderOverview(host, payload);
  else if (tabId === "chart") await renderHistory(host, payload);
  else if (tabId === "options") await renderOptions(host, payload);
  else if (tabId === "filings") await renderFilings(host, payload);
  else if (tabId === "insiders") await renderInsiders(host, payload);
  window.__RAVENOS_ATLAS__ = Object.freeze({ state: "detail", entityId: payload.entity.entity_id, activeTab: state.activeTab, signingAvailable: false, submissionAvailable: false });
}

function renderDetail(payload) {
  destroyChart();
  state.entity = payload;
  const row = payload.entity;
  setHeader({ title: `${row.symbol} · ${row.name}`, summary: `Chart, events, options, filings, and cross-market context for this market.`, detail: true });
  const host = document.getElementById("atlasContent");
  host.replaceChildren();
  const identity = append(host, "section", "atlas-detail-identity");
  const mark = append(identity, "div", "atlas-detail-symbol", row.symbol.slice(0, 6));
  mark.setAttribute("aria-hidden", "true");
  const copy = append(identity, "div");
  append(copy, "span", "workspace-label", entityKindLabel(row.entity_kind));
  append(copy, "h2", "", row.name);
  const visualIdentity = resolveTradingViewReference(row, { exactInstrument: payload.exact_instrument });
  append(copy, "p", "", `${visualIdentity ? visualIdentity.tradingview_symbol.replace(":", " · ") : row.symbol} · ${providerLabel(row.provider)} · ${timingLabel(row)}`);
  const badges = append(identity, "div", "atlas-detail-badges");
  [timingLabel(row), row.optionable ? "Options available" : null].filter(Boolean).forEach((label) => append(badges, "span", "", label));
  const tabs = append(host, "nav", "atlas-detail-tabs");
  tabs.setAttribute("role", "tablist");
  const validTabs = detailTabsFor(row);
  if (!validTabs.some((tab) => tab.id === state.activeTab)) state.activeTab = "overview";
  for (const tab of validTabs) {
    const button = append(tabs, "button", tab.id === state.activeTab ? "active" : "", tab.label);
    button.type = "button";
    button.dataset.tab = tab.id;
    button.setAttribute("role", "tab");
    button.addEventListener("click", () => showTab(tab.id, payload, { updateHistory: true }));
  }
  const panel = append(host, "section");
  panel.id = "atlasDetailPanel";
  panel.setAttribute("role", "tabpanel");
  showTab(state.activeTab, payload, { updateHistory: false });
  setState("atlasProjectionState", "available", "Exact entity");
  setState("atlasMarketState", payload.snapshot?.state || "unavailable", title(payload.snapshot?.state));
  setState("atlasOptionsState", row.public_display_eligibility === "allowed" ? "available" : "degraded", row.public_display_eligibility === "allowed" ? "Rights checked" : "Restricted");
  resolveTerminalLink(row, payload.exact_instrument);
  ravenOSContext.setSelection({ subject: { id: row.entity_id, symbol: row.symbol, name: row.name, type: row.entity_kind }, workspace: "atlas" }, { updateUrl: false });
  window.RavenOSShell?.setCapabilities?.({ market: `${entityKindLabel(row.entity_kind)} · ${timingLabel(row)}`, mode: "Research", evidence: `${providerLabel(row.provider)} source`, signing: "Unavailable", broadcast: "Unavailable" });
  window.RavenOSShell?.setIntelligence?.({
    presentation: { status: false, context: false },
    subject: { id: row.entity_id, symbol: row.symbol, name: row.name, type: row.entity_kind },
    marketState: { label: timingLabel(row), regime: entityKindLabel(row.entity_kind) },
    setupState: { state: payload.snapshot?.state || "unavailable", confirmation: "Atlas context only" },
    thesis: `${row.name} is resolved exactly through ${providerLabel(row.provider)}. Atlas context does not substitute for Raven behavioral evidence.`,
    supportingEvidence: [`Exact ${entityKindLabel(row.entity_kind).toLowerCase()} identity resolved`, `Source: ${providerLabel(row.provider)}`, `Source timing: ${timingLabel(row)}`],
    contradictingEvidence: payload.snapshot?.state === "display_restricted" ? ["Market values are withheld because public display rights are not established."] : [],
    invalidation: [],
    timeHorizon: "current selected entity",
    confidence: { label: payload.snapshot?.state === "available" ? "source verified" : "limited" },
    evidenceQuality: { state: payload.snapshot?.state || "unavailable", lineageComplete: true },
    freshness: {
      state: payload.snapshot?.stale ? "stale" : payload.snapshot?.delayed ? "delayed" : payload.snapshot?.state === "available" ? "live" : "unavailable",
      label: payload.snapshot?.state === "available" ? "Atlas current" : "Raven unavailable",
      observedAt: payload.snapshot?.provider_timestamp,
    },
    nextExpectedTransition: "Open the context needed for this decision; unsupported detail remains explicitly unavailable.",
  });
  window.__RAVENOS_ATLAS__ = Object.freeze({ state: "detail", entityId: row.entity_id, activeTab: state.activeTab, signingAvailable: false, submissionAvailable: false });
}

async function selectEntity(entityId, { updateHistory = true, view = "overview" } = {}) {
  const exact = String(entityId || "").trim();
  if (!/^[a-z][a-z0-9_]*:[A-Za-z0-9][A-Za-z0-9:._/-]{0,190}$/.test(exact)) return;
  closeSearch();
  clearActiveRefresh();
  state.detailController?.abort();
  state.detailController = new AbortController();
  state.activeTab = detailView(view);
  if (updateHistory) updateUrl(exact, { view: state.activeTab });
  const host = document.getElementById("atlasContent");
  host.replaceChildren();
  stateNode(host, "Opening market context", "Loading the chart, source timing, events, and available research.");
  try {
    const payload = await fetchJson(`/api/atlas/entity?entity_id=${encodeURIComponent(exact)}`, { signal: state.detailController.signal, viewer: true });
    if (payload.entity?.entity_id !== exact) throw new Error("atlas_entity_identity_mismatch");
    payload.exact_instrument = await resolveExactListedInstrument(payload.entity, { signal: state.detailController.signal });
    renderDetail(payload);
  } catch (error) {
    if (error.name === "AbortError") return;
    host.replaceChildren();
    stateNode(host, "Exact entity unavailable", "Atlas could not establish the selected identity, provider path, and public-display state together. No alternate market was loaded.");
    setHeader({ title: "This exact entity is unavailable.", summary: "Search for another supported market or series. RavenOS will not silently switch instruments." });
    setState("atlasMarketState", "unavailable", "Unavailable");
  }
}

async function loadLandingData() {
  const [projection, featured] = await Promise.allSettled([
    fetchJson("/api/atlas"),
    fetchJson("/api/atlas/featured?limit=8"),
  ]);
  if (projection.status === "fulfilled") {
    const candidate = projection.value?.data?.schema_version === "ravenos.atlas_projection.v1" ? projection.value.data : projection.value;
    if (candidate?.schema_version === "ravenos.atlas_projection.v1") state.projection = candidate;
  }
  if (featured.status === "fulfilled" && featured.value?.schema_version === "atlas_featured_state_v1") state.featured = featured.value;
}

async function boot() {
  bindSearch();
  await loadLandingData();
  const params = new URLSearchParams(location.search);
  const entityId = params.get("entity_id");
  if (entityId) await selectEntity(entityId, { updateHistory: false, view: params.get("view") });
  else {
    renderLanding();
    const legacyAsset = String(params.get("asset") || "").trim();
    if (legacyAsset) {
      document.getElementById("atlasSearchInput").value = legacyAsset;
      await runSearch(legacyAsset, { autoSelect: true });
    }
  }
  window.addEventListener("popstate", async () => {
    const nextParams = new URLSearchParams(location.search);
    const selected = nextParams.get("entity_id");
    if (selected) await selectEntity(selected, { updateHistory: false, view: nextParams.get("view") });
    else renderLanding();
  });
  window.__RAVENOS_ATLAS__ = Object.freeze({ state: state.entity ? "detail" : state.featured ? "available" : "degraded", schemaVersion: "atlas_featured_state_v1", signingAvailable: false, submissionAvailable: false });
}

boot().catch(() => {
  const host = document.getElementById("atlasContent");
  host.replaceChildren();
  stateNode(host, "Atlas is temporarily unavailable", "Search and market context could not be reached. Try again shortly.");
  setState("atlasProjectionState", "unavailable", "Unavailable");
  setState("atlasMarketState", "unavailable", "Unavailable");
  setState("atlasOptionsState", "available", "Protected");
  window.RavenOSShell?.setCapabilities?.({ market: "Atlas unavailable", mode: "Research", evidence: "No alternate market loaded", signing: "Unavailable", broadcast: "Unavailable" });
  window.__RAVENOS_ATLAS__ = Object.freeze({ state: "unavailable", signingAvailable: false, submissionAvailable: false });
});
