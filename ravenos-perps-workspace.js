import { ravenOSContext } from "./ravenos-context-store.js";
import { RAVENOS_CHART_TIMEFRAMES, getChartDataPlaneDiagnostics } from "./ravenos-chart-data-plane.js";

const TIMEFRAMES = RAVENOS_CHART_TIMEFRAMES;
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
  if (value === null || value === undefined || value === "") return null;
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

function strictFinite(value) {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function appendText(parent, tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = String(value ?? "");
  parent.append(node);
  return node;
}

function currentPublicPerps(payload) {
  const delivery = payload?.delivery || {};
  if (
    payload?.ok === true
    && payload?.schema_version === "ravenos.customer_intelligence_projection.v1"
    && payload?.intelligence_kind === "perps"
    && payload?.access_scope === "free"
    && payload?.advanced === null
    && ["fresh", "delayed"].includes(payload?.provenance?.freshness?.state)
    && ["fresh", "delayed"].includes(delivery.freshness_state)
    && Array.isArray(payload.market_overview)
    && payload.market_overview.length <= 6
    && payload.market_overview.every((row) => /^hyperliquid:perp:[A-Z0-9][A-Z0-9._-]{0,28}$/.test(String(row?.instrument_id || "")))
  ) {
    return { accessScope: "free", projection: payload, delivery, generatedAt: payload.generated_at };
  }
  const data = payload?.data;
  const tables = data?.tables;
  if (
    payload?.ok !== true
    || payload?.safe_public !== true
    || payload?.schema_version !== "ravenos_perps_public_origin_v1"
    || payload?.redaction_policy !== "aggregate_public_market_context_only"
    || delivery.source !== "current_public_origin"
    || delivery.fallback !== false
    || !["fresh", "delayed"].includes(delivery.freshness_state)
    || data?.schema_version !== "ravenos_perps_evidence_public_v2"
    || data?.safe_public !== true
    || data?.public_safe !== true
    || !data?.summary
    || !tables
    || !["top_volume", "top_pressure", "tightest_books", "wide_or_thin_books"].every((key) => Array.isArray(tables[key]))
  ) return null;
  return { accessScope: "legacy_full", data, delivery, generatedAt: data.generated_at || payload.generated_at };
}

function intelligencePanel(name) {
  return document.querySelector(`[data-perps-intel-panel="${name}"]`);
}

function renderIntelligenceUnavailable(message = "Current Perps Intelligence is unavailable. Older data was not substituted.") {
  setState("perpsIntelligenceState", "unavailable", "Unavailable");
  setText("perpsIntelligenceObserved", "No current artifact");
  for (const panel of document.querySelectorAll("[data-perps-intel-panel]")) {
    panel.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "perps-intelligence-unavailable";
    appendText(empty, "strong", "", "Current intelligence unavailable");
    appendText(empty, "p", "", message);
    panel.append(empty);
  }
}

function appendMetricGrid(host, metrics, className = "") {
  const grid = document.createElement("div");
  grid.className = `perps-intel-metrics${className ? ` ${className}` : ""}`;
  for (const [label, value, detail, stateName] of metrics) {
    const card = document.createElement("article");
    if (stateName) card.dataset.state = stateName;
    appendText(card, "span", "", label);
    appendText(card, "strong", "", value);
    if (detail) appendText(card, "small", "", detail);
    grid.append(card);
  }
  host.append(grid);
  return grid;
}

function appendBucketSet(host, title, buckets = {}) {
  const values = (Array.isArray(buckets)
    ? buckets.map((row) => [row?.label, row?.count])
    : Object.entries(buckets || {})).filter(([label, value]) => label && strictFinite(value) !== null);
  if (!values.length) return;
  const section = document.createElement("section");
  section.className = "perps-intel-section";
  appendText(section, "h3", "", title);
  appendMetricGrid(section, values.map(([label, value]) => [titleCase(label), Number(value).toLocaleString("en-US"), "markets", ""]), "compact");
  host.append(section);
}

function setProBoundaryVisible(visible) {
  const boundary = document.getElementById("perpsProBoundary");
  if (boundary) boundary.hidden = !visible;
}

function syncProWorkspaceLink(row = state.row) {
  const link = document.getElementById("perpsProWorkspaceLink");
  if (!link) return;
  const target = new URL("https://app.ravenos.xyz/account/intelligence/");
  target.searchParams.set("view", "perps");
  const instrumentId = String(row?.instrument_id || "").trim();
  if (/^hyperliquid:perp:[A-Z0-9][A-Z0-9._-]{0,28}$/.test(instrumentId)) {
    target.searchParams.set("instrument_id", instrumentId);
  }
  link.href = target.toString();
}

function renderFreePerps(projection) {
  const overview = projection.overview || {};
  const participantContext = overview.participant_context || {};
  const rows = Array.isArray(projection.market_overview) ? projection.market_overview : [];

  const overviewHost = intelligencePanel("overview");
  overviewHost.replaceChildren();
  appendMetricGrid(overviewHost, [
    ["Markets observed", Number(overview.markets_observed || 0).toLocaleString("en-US"), `${Number(overview.books_observed || 0).toLocaleString("en-US")} books observed`, "current"],
    ["Free market view", `${rows.length} markets`, "Bounded server projection", "current"],
    ["Participant context", titleCase(participantContext.freshness), participantContext.privacy === "aggregate_status_only" ? "Aggregate state only; identities withheld" : "Unavailable", participantContext.freshness || "unavailable"],
    ["Liquidation stream", "Unavailable", "No qualified public liquidation source is attached; nothing is synthesized", "unavailable"],
  ]);
  const read = document.createElement("div");
  read.className = "perps-intel-boundary";
  appendText(read, "strong", "", "Current public Perps overview");
  appendText(read, "span", "", overview.public_read || "Current venue context is forming.");
  overviewHost.append(read);
  appendBucketSet(overviewHost, "Pressure states", overview.pressure_buckets);
  appendBucketSet(overviewHost, "Liquidity quality", overview.liquidity_buckets);

  const positioningHost = intelligencePanel("positioning");
  positioningHost.replaceChildren();
  appendDataTable(positioningHost, {
    title: "Six-market positioning overview",
    detail: "Current funding and open interest remain free. The server sends no additional positioning rows to this page.",
    columns: [
      { label: "Market", value: "symbol" },
      { label: "Funding regime", value: (row) => row.funding_regime || "Unavailable" },
      { label: "Funding", value: (row) => rate(row.funding_rate) },
      { label: "Open interest", value: (row) => strictFinite(row.open_interest_usd) === null ? "—" : `$${compact(row.open_interest_usd)}` },
      { label: "24h volume", value: (row) => strictFinite(row.day_volume_usd) === null ? "—" : `$${compact(row.day_volume_usd)}` },
    ],
    rows,
  });

  const pressureHost = intelligencePanel("pressure");
  pressureHost.replaceChildren();
  appendBucketSet(pressureHost, "Current pressure distribution", overview.pressure_buckets);
  appendDataTable(pressureHost, {
    title: "Basic pressure overview",
    detail: "A bounded current state is shown without the complete cross-market pressure and crowding matrix.",
    columns: [
      { label: "Market", value: "symbol" },
      { label: "Pressure state", value: "pressure_state" },
      { label: "Funding regime", value: "funding_regime" },
      { label: "Open interest", value: (row) => strictFinite(row.open_interest_usd) === null ? "—" : `$${compact(row.open_interest_usd)}` },
    ],
    rows,
  });

  const liquidityHost = intelligencePanel("liquidity");
  liquidityHost.replaceChildren();
  appendBucketSet(liquidityHost, "Current liquidity distribution", overview.liquidity_buckets);
  const liquidityBoundary = document.createElement("div");
  liquidityBoundary.className = "perps-intel-boundary";
  appendText(liquidityBoundary, "strong", "", "Spread and depth comparisons are not in the Free response");
  appendText(liquidityBoundary, "span", "", "Exact-market book and tape remain available in the Terminal. Cross-market tightest-book and wide/thin-book rows require an authorized private projection.");
  liquidityHost.append(liquidityBoundary);

  const outcomesHost = intelligencePanel("outcomes");
  outcomesHost.replaceChildren();
  const outcomesBoundary = document.createElement("div");
  outcomesBoundary.className = "perps-intel-boundary";
  appendText(outcomesBoundary, "strong", "", "Outcome attribution is not in the Free response");
  appendText(outcomesBoundary, "span", "", "Current Raven Reads and their evidence timestamps remain public. The complete cross-market attribution tables are available only through an authorized private projection.");
  outcomesHost.append(outcomesBoundary);
  setProBoundaryVisible(true);
}

function appendDataTable(host, { title, detail = "", columns = [], rows = [] } = {}) {
  const section = document.createElement("section");
  section.className = "perps-intel-section";
  const header = document.createElement("header");
  const copy = document.createElement("div");
  appendText(copy, "h3", "", title);
  if (detail) appendText(copy, "p", "", detail);
  header.append(copy);
  section.append(header);
  if (!rows.length) {
    appendText(section, "p", "perps-intel-empty", "Current rows are unavailable.");
    host.append(section);
    return;
  }
  const wrap = document.createElement("div");
  wrap.className = "perps-intel-table-wrap";
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const column of columns) {
    const cell = appendText(headRow, "th", "", column.label);
    cell.scope = "col";
  }
  thead.append(headRow);
  table.append(thead);
  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    columns.forEach((column, index) => {
      const value = typeof column.value === "function" ? column.value(row) : row?.[column.value];
      const cell = appendText(tr, index === 0 ? "th" : "td", "", value ?? "—");
      cell.dataset.label = column.label;
      if (index === 0) cell.scope = "row";
    });
    tbody.append(tr);
  }
  table.append(tbody);
  wrap.append(table);
  section.append(wrap);
  host.append(section);
}

function renderPerpsOverview(data) {
  const host = intelligencePanel("overview");
  host.replaceChildren();
  const summary = data.summary || {};
  appendMetricGrid(host, [
    ["Markets observed", Number(summary.markets_observed || 0).toLocaleString("en-US"), `${Number(summary.books_observed || 0).toLocaleString("en-US")} books observed`, "current"],
    ["Forward observations", Number(summary.forward_observations || 0).toLocaleString("en-US"), `${Number(summary.matured_12h_windows || 0).toLocaleString("en-US")} matured through 12h`, "forming"],
    ["Participant context", titleCase(data.actor_evidence?.actor_evidence_freshness, "Unavailable"), data.actor_evidence?.actor_evidence_freshness === "stale" ? "Stale aggregate evidence is withheld from live leaderboards" : "Aggregate status only; identities withheld", data.actor_evidence?.actor_evidence_freshness || "unavailable"],
    ["Liquidation stream", "Unavailable", "No qualified public liquidation source is attached; nothing is synthesized", "unavailable"],
  ]);
  const participant = document.createElement("div");
  participant.className = "perps-intel-boundary";
  appendText(participant, "strong", "", data.actor_evidence?.actor_evidence_freshness === "stale" ? "Participant context is stale" : "Participant context is aggregate");
  appendText(participant, "span", "", data.actor_evidence?.actor_evidence_freshness === "stale"
    ? `Last aggregate participant observation: ${timestamp(data.actor_evidence?.observed_at)}. No live leaderboard is shown.`
    : "No wallet identities, labels, relationship graphs, or smart-money ranking is exposed.");
  host.append(participant);
  appendBucketSet(host, "Pressure states", summary.pressure_buckets);
  appendBucketSet(host, "Liquidity quality", summary.liquidity_buckets);
}

function renderPerpsPositioning(data) {
  const host = intelligencePanel("positioning");
  host.replaceChildren();
  appendDataTable(host, {
    title: "Funding and open interest",
    detail: "Highest current venue volume, with funding posture and outstanding open interest kept separate.",
    columns: [
      { label: "Market", value: "symbol" },
      { label: "Funding regime", value: (row) => row.funding_regime || "Unavailable" },
      { label: "Funding", value: (row) => rate(row.funding_rate) },
      { label: "Open interest", value: (row) => strictFinite(row.open_interest_usd) === null ? "—" : `$${compact(row.open_interest_usd)}` },
      { label: "24h volume", value: (row) => strictFinite(row.day_volume_usd) === null ? "—" : `$${compact(row.day_volume_usd)}` },
    ],
    rows: data.tables.top_volume.slice(0, 12),
  });
}

function renderPerpsPressure(data) {
  const host = intelligencePanel("pressure");
  host.replaceChildren();
  appendBucketSet(host, "Current pressure distribution", data.summary?.pressure_buckets);
  appendDataTable(host, {
    title: "Highest-pressure markets",
    detail: "Pressure and crowding are Raven measurements derived from current public venue structure, not liquidation events.",
    columns: [
      { label: "Market", value: "symbol" },
      { label: "Pressure state", value: "pressure_state" },
      { label: "Direction context", value: "pressure_direction" },
      { label: "Funding regime", value: "funding_regime" },
      { label: "Open interest", value: (row) => strictFinite(row.open_interest_usd) === null ? "—" : `$${compact(row.open_interest_usd)}` },
    ],
    rows: data.tables.top_pressure.slice(0, 12),
  });
}

function renderPerpsLiquidity(data) {
  const host = intelligencePanel("liquidity");
  host.replaceChildren();
  appendBucketSet(host, "Current liquidity distribution", data.summary?.liquidity_buckets);
  const columns = [
    { label: "Market", value: "symbol" },
    { label: "Quality", value: "liquidity_quality" },
    { label: "Spread", value: (row) => strictFinite(row.spread_bps) === null ? "—" : `${Number(row.spread_bps).toFixed(2)} bps` },
    { label: "20-level depth", value: (row) => strictFinite(row.depth_20_usd) === null ? "—" : `$${compact(row.depth_20_usd)}` },
    { label: "24h volume", value: (row) => strictFinite(row.day_volume_usd) === null ? "—" : `$${compact(row.day_volume_usd)}` },
  ];
  appendDataTable(host, { title: "Tightest books", detail: "Lowest observed spreads among current qualified books.", columns, rows: data.tables.tightest_books.slice(0, 10) });
  appendDataTable(host, { title: "Wide or thin books", detail: "Markets where visible depth or spread warrants explicit friction caution.", columns, rows: data.tables.wide_or_thin_books.slice(0, 10) });
}

function renderPerpsOutcomes(data) {
  const host = intelligencePanel("outcomes");
  host.replaceChildren();
  const forward = data.forward_observation || {};
  const windows = ["15m", "1h", "4h", "12h"];
  appendMetricGrid(host, windows.map((windowName) => {
    const matured = strictFinite(forward.matured_windows?.[windowName]);
    const observed = strictFinite(forward.median_observed_change_pct?.[windowName]);
    const favorable = strictFinite(forward.median_max_favorable_movement_pct?.[windowName]);
    return [
      `${windowName} maturity`,
      matured === null ? "Unavailable" : `${matured.toLocaleString("en-US")} / ${Number(forward.observations || 0).toLocaleString("en-US")}`,
      observed === null ? "No matured median" : `Median ${percentagePoint(observed)} · favorable ${percentagePoint(favorable)}`,
      matured ? "forming" : "unavailable",
    ];
  }));
  const caveat = document.createElement("div");
  caveat.className = "perps-intel-boundary";
  appendText(caveat, "strong", "", "Forward-observation maturity");
  appendText(caveat, "span", "", forward.sample_caveat || "The public forward sample is forming and is not a recommendation.");
  host.append(caveat);
  const attribution = data.outcome_attribution || {};
  const grouped = attribution.grouped || {};
  const outcomeRows = [
    ...(Array.isArray(grouped.funding_regime) ? grouped.funding_regime : []),
    ...(Array.isArray(grouped.pressure_bucket) ? grouped.pressure_bucket : []),
    ...(Array.isArray(grouped.instrument_group) ? grouped.instrument_group : []),
  ].slice(0, 12);
  appendDataTable(host, {
    title: "Aggregate outcome attribution",
    detail: attribution.public_caveat || "Outcome attribution is aggregate validation context.",
    columns: [
      { label: "Group", value: (row) => `${row.label || "Context"}: ${row.group || "Unavailable"}` },
      { label: "Read", value: "read" },
      { label: "Sample", value: (row) => Number(row.sample_size || 0).toLocaleString("en-US") },
      { label: "Confidence", value: "confidence" },
      { label: "Median observed", value: (row) => percentagePoint(row.median_observed_change_pct) },
    ],
    rows: outcomeRows,
  });
}

function renderPublicPerps(payload) {
  const projection = currentPublicPerps(payload);
  if (!projection) {
    setProBoundaryVisible(false);
    renderIntelligenceUnavailable();
    return;
  }
  const { delivery, generatedAt } = projection;
  setState("perpsIntelligenceState", delivery.freshness_state, delivery.freshness_state === "delayed" ? "Delayed · current origin" : "Current");
  setText("perpsIntelligenceObserved", timestamp(generatedAt));
  if (projection.accessScope === "free") {
    renderFreePerps(projection.projection);
    return;
  }
  setProBoundaryVisible(false);
  const { data } = projection;
  renderPerpsOverview(data);
  renderPerpsPositioning(data);
  renderPerpsPressure(data);
  renderPerpsLiquidity(data);
  renderPerpsOutcomes(data);
}

function selectPerpsIntelligenceTab(name, { focus = false } = {}) {
  const buttons = [...document.querySelectorAll("[data-perps-intel-tab]")];
  for (const button of buttons) {
    const selected = button.dataset.perpsIntelTab === name;
    button.setAttribute("aria-selected", selected ? "true" : "false");
    button.tabIndex = selected ? 0 : -1;
    if (selected && focus) button.focus();
  }
  document.querySelectorAll("[data-perps-intel-panel]").forEach((panel) => { panel.hidden = panel.dataset.perpsIntelPanel !== name; });
}

function bindPerpsIntelligenceTabs() {
  const buttons = [...document.querySelectorAll("[data-perps-intel-tab]")];
  buttons.forEach((button, index) => {
    button.addEventListener("click", () => selectPerpsIntelligenceTab(button.dataset.perpsIntelTab));
    button.addEventListener("keydown", (event) => {
      let next = index;
      if (event.key === "ArrowRight") next = (index + 1) % buttons.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + buttons.length) % buttons.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = buttons.length - 1;
      else return;
      event.preventDefault();
      selectPerpsIntelligenceTab(buttons[next].dataset.perpsIntelTab, { focus: true });
    });
  });
}

function biasLabel(value) {
  return ({ long: "Upside", short: "Downside", neutral: "Two-sided" })[String(value || "").toLowerCase()] || "Two-sided";
}

function syncEvidenceDeckLayout() {
  const deck = document.querySelector(".perps-evidence-deck");
  if (!deck) return;
  const historyCount = ["perpsComparablePanel", "perpsPlanPanel"]
    .filter((id) => document.getElementById(id)?.hidden === false)
    .length;
  deck.dataset.history = String(historyCount);
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
  const panel = document.getElementById("perpsComparablePanel");
  if (panel) panel.hidden = sample <= 0;
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
  syncEvidenceDeckLayout();
}

function renderPlan(plan = {}) {
  const available = plan.state === "research_only";
  const panel = document.getElementById("perpsPlanPanel");
  if (panel) panel.hidden = !available;
  setText("perpsPlanState", available ? "Research only" : "Unavailable");
  setText("perpsPlanDirection", available ? titleCase(plan.directional_context) : "--");
  setText("perpsPlanReference", available ? price(plan.reference_price) : "--");
  setText("perpsPlanHorizon", available ? plan.review_horizon || "Research window" : "--");
  setText("perpsPlanSample", Math.max(0, Math.trunc(finite(plan.sample_size) || 0)).toLocaleString());
  setText("perpsPlanNote", available
    ? `${plan.note || "Historical excursions are context only."} Not personalized, production-qualified, or executable.`
    : "Not personalized. Not production-qualified. No entry, target, stop, signing, or order is available.");
  syncEvidenceDeckLayout();
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
  const overlays = Array.isArray(state.context?.chart_overlays?.overlays)
    ? state.context.chart_overlays.overlays
    : [];
  state.workspace.attachIntelligence({ evidence: state.context, narrator: null });
  state.workspace.render({
    events: markerEnabled && chartEvent ? [chartEvent] : [],
    overlays,
    visibleOverlayTypes: [...new Set(overlays.map((row) => row.type).filter(Boolean))],
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
  const liveRead = payload?.live_market_read || (read.role === "live_market_read" ? read : null);
  const activeRead = liveRead || read;
  const delivery = payload?.delivery || {};
  const marketData = payload?.market_data || {};
  const decisionHistoryAvailable = context.context_available === true;
  const liveReadAvailable = Boolean(liveRead && ["current", "partial"].includes(liveRead.state));
  state.orderBook = marketData.book || state.orderBook;
  state.tapeRows = marketData.tape?.trades || state.tapeRows;

  setState("perpsMarketFreshness", marketData.components?.market || "unavailable", titleCase(marketData.components?.market));
  setState("perpsContextState", liveRead?.state || "unavailable", liveReadAvailable ? titleCase(liveRead.state) : "Read paused");
  setState("perpsDeliveryState", decisionHistoryAvailable ? context.context_state : "not_attached", decisionHistoryAvailable ? "Attached" : "Not attached");
  setText("perpsObservedAt", timestamp(liveRead?.observed_at || marketData.generated_at || context.observed_at));
  setText("perpsContinuityMessage", liveReadAvailable
    ? decisionHistoryAvailable
      ? "Current Hyperliquid inputs power the live Raven read; the timestamped decision history is attached separately."
      : "Current Hyperliquid inputs power the live Raven read. No retained decision history is required for this market read."
    : "The exact Hyperliquid market remains visible while Raven waits for enough current inputs to form a read.");

  setText("perpsReadHeadline", activeRead.headline || `${state.row?.asset || "Instrument"} · live read paused`);
  setText("perpsReadSummary", activeRead.summary || "The exact market remains live while Raven waits for aligned price, positioning, depth, and tape inputs.");
  setText("perpsWhy", activeRead.why_raven_noticed || "Current exact-market inputs do not yet form a directional edge.");
  setText("perpsPathFamily", liveRead?.setup_label || context.behavior_family || "Read forming");
  setText("perpsPathPressure", liveRead?.flow_label || context.pressure_state || "Flow forming");
  setText("perpsPathSide", liveRead ? biasLabel(liveRead.directional_bias) : context.context_available ? titleCase(context.observed_side) : "Two-sided");
  const spread = finite(liveRead?.market_facts?.spread_bps);
  const friction = finite(context.friction_context?.roundtrip_bps);
  setText("perpsPathFriction", spread !== null ? `${spread.toFixed(2)} bps` : context.friction_context?.state === "observed" && friction !== null ? `${friction.toFixed(2)} bps` : "Read forming");
  setList("perpsStrengthen", activeRead.what_would_strengthen, "Price, visible depth, and recent tape align in the same direction.");
  setList("perpsWeaken", activeRead.what_would_weaken, "Current flow thins or the exact-market structure reverses.");
  setText("perpsEvidenceState", liveReadAvailable
    ? `${titleCase(liveRead.state)} · ${liveRead.input_count}/${liveRead.input_total} live inputs · ${liveRead.evidence_grade}${liveRead.evidence_score}`
    : "Waiting for live inputs");

  renderComparables(payload?.matured_comparables || {});
  renderPlan(payload?.plan_preview || {});
  renderBook(state.orderBook);
  renderTape(state.tapeRows);

  const marker = document.getElementById("perpsRavenMarker");
  const eventAvailable = Boolean(payload?.chart_event?.event_id && payload?.chart_event?.observed_at);
  marker.disabled = !eventAvailable;
  marker.textContent = eventAvailable ? "Decision event" : "No retained event";
  marker.setAttribute("aria-pressed", eventAvailable ? "true" : "false");
  setText("perpsChartEventState", eventAvailable ? `Retained observation ${timestamp(payload.chart_event.observed_at)}` : "Live Raven overlays remain available");

  setText("perpsProofMarket", [marketData.components?.book, marketData.components?.tape].every((value) => value === "fresh") ? "Live market flow" : "Partially unavailable");
  setText("perpsProofContext", liveReadAvailable ? `${titleCase(liveRead.state)} · exact Hyperliquid inputs` : "Waiting for enough current inputs");
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
  const liveRead = state.context?.live_market_read || (read.role === "live_market_read" ? read : null);
  const activeRead = liveRead || read;
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
    marketState: liveRead?.flow_label || context.pressure_state || "Live exact market",
    setupState: liveRead?.signal_state || (context.context_available ? "research_observation" : "forming"),
    thesis: activeRead.summary || "Current exact-market inputs are still forming.",
    supportingEvidence: activeRead.what_would_strengthen || [],
    contradictingEvidence: activeRead.what_would_weaken || [],
    invalidation: activeRead.what_would_weaken || [],
    timeHorizon: state.timeframe,
    confidence: { label: liveRead?.evidence_grade ? `Evidence ${liveRead.evidence_grade}${liveRead.evidence_score}` : titleCase(context.outcomes?.evidence_maturity, "Forming") },
    evidenceQuality: { state: liveRead?.state || context.context_state || "forming", lineageComplete: liveRead?.source === "hyperliquid_public_api" || Boolean(context.public_context_id) },
    dataState: state.workspace?.state?.state || "data_unavailable",
    observedAt: liveRead?.observed_at || context.observed_at || state.workspace?.state?.observedAt,
    marketSource: state.workspace?.state?.source || "Hyperliquid",
    sourceReferences: [state.workspace?.state?.source, liveRead?.source === "hyperliquid_public_api" ? "Current Hyperliquid market read" : null, context.public_context_id ? "Retained Raven decision history" : null].filter(Boolean),
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
  syncProWorkspaceLink(row);
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
    expectedIdentity: {
      instrumentType: "perpetual",
      identityScope: "venue_market",
      chain: "hyperliquid",
      venue: "hyperliquid",
      baseAsset: String(row.asset || "").replace(/-PERP$/i, ""),
      quoteAsset: "USD",
    },
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
    if (state.publicPerps) renderPublicPerps(state.publicPerps);
    else renderIntelligenceUnavailable();
  } catch {
    state.publicPerps = null;
    renderIntelligenceUnavailable();
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
  bindPerpsIntelligenceTabs();
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
    evidence: state.context?.live_market_read ? "Live Raven read" : state.context?.raven_context?.context_available ? "Decision history linked" : "Read forming",
  });

  setInterval(() => {
    if (document.visibilityState !== "visible" || !state.row) return;
    fetchSelectedContext(state.row, state.selectionGeneration);
  }, 15_000);

  window.__RAVENOS_PERPS_WORKSPACE__ = {
    getState: () => ({
      instrument: state.row?.asset || null,
      instrumentId: state.context?.instrument?.instrument_id || state.row?.instrument_id || null,
      timeframe: state.timeframe,
      candleCount: state.workspace?.state?.candles?.length || 0,
      backfillCount: state.workspace?.state?.backfillCount || 0,
      source: state.workspace?.state?.source || null,
      connectionState: state.workspace?.state?.connectionState || null,
      contextState: state.context?.live_market_read?.state || state.context?.raven_context?.context_state || "unavailable",
      liveReadState: state.context?.live_market_read?.state || "unavailable",
      liveReadSignal: state.context?.live_market_read?.signal_state || null,
      liveReadInputCount: state.context?.live_market_read?.input_count || 0,
      decisionHistoryState: state.context?.raven_context?.context_available ? state.context.raven_context.context_state : "not_attached",
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
