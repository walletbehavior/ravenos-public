const CAPABILITIES = Object.freeze({
  perps: Object.freeze({ key: "intelligence.perps_advanced", route: "/api/v1/intelligence/perps" }),
  participants: Object.freeze({ key: "intelligence.participant_advanced", route: "/api/v1/intelligence/participants" }),
});

const state = {
  view: "perps",
  perpsSection: "positioning",
  selectedInstrumentId: null,
  capabilities: new Map(),
  projections: new Map(),
  perpsFilters: { instrument_group: "", funding_regime: "", pressure_state: "", liquidity_quality: "" },
  participantFilters: {
    query: "",
    chain: "",
    capitalization_band: "",
    window: "",
    participation_trend: "",
    behavior_state: "",
    average_outcome_classification: "",
    confidence: "",
    minimum_usable_sample: "",
    sort: "usable_desc",
  },
};

function text(value, fallback = "Unavailable") {
  const clean = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return clean || fallback;
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compact(value, { currency = false } = {}) {
  const number = finite(value);
  if (number === null) return "—";
  const formatted = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(number);
  return currency ? `$${formatted}` : formatted;
}

function rate(value) {
  const number = finite(value);
  if (number === null) return "—";
  const scaled = number * 100;
  return `${scaled >= 0 ? "+" : ""}${scaled.toFixed(Math.abs(scaled) < 0.1 ? 4 : 2)}%`;
}

function percentPoint(value) {
  const number = finite(value);
  if (number === null) return "—";
  return `${number >= 0 ? "+" : ""}${number.toFixed(Math.abs(number) < 1 ? 2 : 1)}%`;
}

function readable(value) {
  return text(value, "unavailable").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function node(tag, className = "", value = null) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== null) element.textContent = String(value);
  return element;
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = String(value ?? "");
}

function exactPerpInstrumentId(value) {
  const clean = String(value || "").trim();
  return /^hyperliquid:perp:[A-Z0-9][A-Z0-9._-]{0,28}$/.test(clean) ? clean : null;
}

function requestedContext() {
  const params = new URLSearchParams(window.location.search);
  const view = ["perps", "participants"].includes(params.get("view")) ? params.get("view") : "perps";
  const instrumentId = exactPerpInstrumentId(params.get("instrument_id"));
  return { view, instrumentId };
}

function canonicalReturnTo() {
  const target = new URL("/account/intelligence/", window.location.origin);
  target.searchParams.set("view", state.view);
  if (state.selectedInstrumentId) target.searchParams.set("instrument_id", state.selectedInstrumentId);
  return `${target.pathname}${target.search}`;
}

function syncReturnTo() {
  document.querySelectorAll("[data-pro-return-to]").forEach((input) => { input.value = canonicalReturnTo(); });
}

async function getJson(path) {
  const response = await fetch(path, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function submitAuthStart(form) {
  const button = form.querySelector('button[type="submit"]');
  const status = document.getElementById("proAuthStatus");
  if (button) button.disabled = true;
  if (status) {
    status.dataset.tone = "";
    status.textContent = "Opening secure sign-in…";
  }
  try {
    const response = await fetch("/api/v1/auth/start", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    const payload = await response.json().catch(() => null);
    const target = new URL(payload?.authorization_url || "");
    if (!response.ok || target.protocol !== "https:" || target.hostname !== "api.workos.com") throw new Error("authorization_unavailable");
    window.location.assign(target.toString());
  } catch {
    if (button) button.disabled = false;
    if (status) {
      status.dataset.tone = "error";
      status.textContent = "Secure sign-in could not be opened. Try again.";
    }
  }
}

function bindAuthStartForms() {
  document.querySelectorAll("[data-auth-start]").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitAuthStart(form);
  }));
}

function setCapabilityState(kind, capability, message = "") {
  const id = kind === "perps" ? "proPerpsState" : "proParticipantsState";
  const messageId = kind === "perps" ? "proPerpsMessage" : "proParticipantsMessage";
  const status = document.getElementById(id);
  const host = document.getElementById(messageId);
  const capabilityState = text(capability?.state, "unavailable").toLowerCase();
  if (status) {
    status.dataset.state = capabilityState;
    status.textContent = readable(capabilityState);
  }
  if (!host) return;
  host.replaceChildren();
  if (capability?.available && !message) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  const title = node("strong", "", capabilityState === "expired"
    ? "Access expired"
    : capabilityState === "revoked"
      ? "Access removed"
      : capabilityState === "suspended"
        ? "Access suspended"
        : capabilityState === "not_granted"
          ? "Pro access not available"
          : "Pro access unavailable");
  const detail = node("p", "", message || (capabilityState === "expired"
    ? "Your Pro access has expired. Advanced intelligence is unavailable."
    : capabilityState === "revoked"
      ? "Your Pro access has been removed. Advanced intelligence is unavailable."
    : capabilityState === "suspended"
        ? "Your Pro access is paused. Public Intelligence remains available."
        : capabilityState === "not_granted"
          ? "Pro access isn’t available for this account yet. Public Intelligence remains available."
          : "Advanced intelligence is unavailable right now. Public Intelligence remains available."));
  host.append(title, detail);
}

function validProProjection(kind, payload) {
  const projection = payload?.projection;
  const expectedCapability = CAPABILITIES[kind].key;
  const expectedKind = kind === "participants" ? "participants" : "perps";
  if (
    payload?.ok !== true
    || payload.capability !== expectedCapability
    || projection?.ok !== true
    || projection?.schema_version !== "ravenos.customer_intelligence_projection.v1"
    || projection?.intelligence_kind !== expectedKind
    || projection?.access_scope !== "pro"
    || !projection.advanced
    || !["fresh", "delayed"].includes(projection?.provenance?.freshness?.state)
  ) return null;
  if (kind === "perps") {
    if (!Array.isArray(projection.advanced.positioning) || projection.advanced.positioning.length > 40) return null;
    if (!Array.isArray(projection.advanced.pressure_and_crowding) || projection.advanced.pressure_and_crowding.length > 40) return null;
    if (!Array.isArray(projection.advanced.liquidity?.tightest_books) || projection.advanced.liquidity.tightest_books.length > 40) return null;
    if (!Array.isArray(projection.advanced.liquidity?.wide_or_thin_books) || projection.advanced.liquidity.wide_or_thin_books.length > 40) return null;
  } else if (!Array.isArray(projection.advanced.condition_matrix) || projection.advanced.condition_matrix.length > 160) return null;
  return projection;
}

function table(title, detail, columns, rows) {
  const section = node("section", "pro-table-section");
  const header = node("header");
  const copy = node("div");
  copy.append(node("h3", "", title), node("p", "", detail));
  header.append(copy, node("strong", "", `${rows.length} rows`));
  section.append(header);
  if (!rows.length) {
    section.append(node("p", "pro-empty", "No rows match the current authorized filters."));
    return section;
  }
  const wrap = node("div", "pro-table-wrap");
  const element = node("table");
  const thead = node("thead");
  const headRow = node("tr");
  for (const column of columns) {
    const cell = node("th", "", column.label);
    cell.scope = "col";
    headRow.append(cell);
  }
  thead.append(headRow);
  const tbody = node("tbody");
  for (const row of rows) {
    const tr = node("tr");
    tr.dataset.columns = String(columns.length);
    if (row?.instrument_id && row.instrument_id === state.selectedInstrumentId) tr.dataset.selectedMarket = "true";
    columns.forEach((column, index) => {
      const raw = typeof column.value === "function" ? column.value(row) : row?.[column.value];
      const cell = node(index === 0 ? "th" : "td", "", raw ?? "—");
      cell.dataset.label = column.label;
      if (index === 0) cell.scope = "row";
      tr.append(cell);
    });
    tbody.append(tr);
  }
  element.append(thead, tbody);
  wrap.append(element);
  section.append(wrap);
  return section;
}

function filterRows(rows, filters, mappings) {
  return rows.filter((row) => Object.entries(filters).every(([key, selected]) => {
    if (!selected) return true;
    const rowKey = mappings[key] || key;
    return String(row?.[rowKey] || "") === selected;
  }));
}

function filterSelect(label, key, values, selected, onChange) {
  const wrapper = node("label");
  wrapper.append(node("span", "", label));
  const select = node("select");
  select.dataset.filter = key;
  select.append(new Option(`All ${label.toLowerCase()}`, ""));
  for (const value of Array.isArray(values) ? values.slice(0, 80) : []) select.append(new Option(text(value), String(value)));
  select.value = selected || "";
  select.addEventListener("change", () => onChange(select.value));
  wrapper.append(select);
  return wrapper;
}

function filterInput(label, key, value, placeholder, onInput) {
  const wrapper = node("label");
  wrapper.append(node("span", "", label));
  const input = node("input");
  input.type = "search";
  input.dataset.filter = key;
  input.value = value || "";
  input.placeholder = placeholder;
  input.autocomplete = "off";
  input.addEventListener("input", () => onInput(input.value.slice(0, 80)));
  wrapper.append(input);
  return wrapper;
}

function choiceSelect(label, key, choices, selected, onChange) {
  const wrapper = node("label");
  wrapper.append(node("span", "", label));
  const select = node("select");
  select.dataset.filter = key;
  for (const choice of choices) select.append(new Option(choice.label, choice.value));
  select.value = selected || choices[0]?.value || "";
  select.addEventListener("change", () => onChange(select.value));
  wrapper.append(select);
  return wrapper;
}

function renderPerpsFilters(projection) {
  const host = document.getElementById("proPerpsFilters");
  const filters = projection.advanced.filters || {};
  host.replaceChildren(
    filterSelect("Instrument group", "instrument_group", filters.instrument_groups, state.perpsFilters.instrument_group, (value) => { state.perpsFilters.instrument_group = value; renderPerpsProjection(projection); }),
    filterSelect("Funding regime", "funding_regime", filters.funding_regimes, state.perpsFilters.funding_regime, (value) => { state.perpsFilters.funding_regime = value; renderPerpsProjection(projection); }),
    filterSelect("Pressure state", "pressure_state", filters.pressure_states, state.perpsFilters.pressure_state, (value) => { state.perpsFilters.pressure_state = value; renderPerpsProjection(projection); }),
    filterSelect("Liquidity", "liquidity_quality", filters.liquidity_qualities, state.perpsFilters.liquidity_quality, (value) => { state.perpsFilters.liquidity_quality = value; renderPerpsProjection(projection); }),
  );
}

const PERPS_COLUMNS = Object.freeze({
  positioning: Object.freeze([
    { label: "Market", value: "symbol" },
    { label: "Funding regime", value: (row) => text(row.funding_regime) },
    { label: "Funding", value: (row) => rate(row.funding_rate) },
    { label: "Open interest", value: (row) => compact(row.open_interest_usd, { currency: true }) },
    { label: "24h volume", value: (row) => compact(row.day_volume_usd, { currency: true }) },
  ]),
  pressure: Object.freeze([
    { label: "Market", value: "symbol" },
    { label: "Pressure", value: (row) => text(row.pressure_state) },
    { label: "Direction context", value: (row) => text(row.pressure_direction) },
    { label: "Funding regime", value: (row) => text(row.funding_regime) },
    { label: "Open interest", value: (row) => compact(row.open_interest_usd, { currency: true }) },
  ]),
  liquidity: Object.freeze([
    { label: "Market", value: "symbol" },
    { label: "Quality", value: (row) => text(row.liquidity_quality) },
    { label: "Spread", value: (row) => finite(row.spread_bps) === null ? "—" : `${Number(row.spread_bps).toFixed(2)} bps` },
    { label: "20-level depth", value: (row) => compact(row.depth_20_usd, { currency: true }) },
    { label: "24h volume", value: (row) => compact(row.day_volume_usd, { currency: true }) },
  ]),
});

function outcomeRows(projection) {
  const groups = projection.advanced.outcomes?.attribution?.groups || {};
  return [
    ...(groups.funding_regime || []),
    ...(groups.pressure_bucket || []),
    ...(groups.instrument_group || []),
    ...(groups.liquidity_attraction || []),
    ...(groups.structure || []),
  ].slice(0, 40);
}

function renderPerpsProjection(projection) {
  renderPerpsFilters(projection);
  const host = document.getElementById("proPerpsContent");
  host.replaceChildren();
  const advanced = projection.advanced;
  const mappings = {};
  if (state.perpsSection === "positioning") {
    const rows = filterRows(advanced.positioning, state.perpsFilters, mappings);
    host.append(table("Funding and open interest", "Current positioning across the available Pro market set.", PERPS_COLUMNS.positioning, rows));
  } else if (state.perpsSection === "pressure") {
    const rows = filterRows(advanced.pressure_and_crowding, state.perpsFilters, mappings);
    host.append(table("Pressure and crowding", "Raven measurements from current venue structure. These are not liquidation events.", PERPS_COLUMNS.pressure, rows));
  } else if (state.perpsSection === "liquidity") {
    const tight = filterRows(advanced.liquidity.tightest_books, state.perpsFilters, mappings);
    const thin = filterRows(advanced.liquidity.wide_or_thin_books, state.perpsFilters, mappings);
    host.append(
      table("Tightest books", "Lowest observed spreads among current books.", PERPS_COLUMNS.liquidity, tight),
      table("Wide or thin books", "Markets where visible depth or spread warrants explicit friction caution.", PERPS_COLUMNS.liquidity, thin),
    );
  } else {
    const forward = advanced.outcomes?.forward_observation || {};
    const metrics = node("section", "pro-outcome-metrics");
    for (const windowName of ["15m", "1h", "4h", "12h"]) {
      const card = node("article");
      card.append(node("span", "", `${windowName} matured`), node("strong", "", compact(forward.matured_windows?.[windowName])), node("small", "", `of ${compact(forward.observations)} observations`));
      metrics.append(card);
    }
    host.append(metrics, table("Outcome attribution", text(advanced.outcomes?.attribution?.public_caveat, "Aggregate validation context only."), [
      { label: "Condition", value: (row) => `${text(row.label, "Context")} · ${text(row.group)}` },
      { label: "Read", value: (row) => text(row.read) },
      { label: "Sample", value: (row) => compact(row.sample_size) },
      { label: "Confidence", value: (row) => readable(row.confidence) },
      { label: "Median observed", value: (row) => percentPoint(row.median_observed_change_pct) },
    ], outcomeRows(projection)));
  }
}

function renderParticipantFilters(projection) {
  const host = document.getElementById("proParticipantFilters");
  const filters = projection.advanced.filters || {};
  host.replaceChildren(
    filterInput("Search cohorts", "query", state.participantFilters.query, "chain, cohort, behavior…", (value) => { state.participantFilters.query = value; renderParticipantProjection(projection, { refreshFilters: false }); }),
    filterSelect("Chain", "chain", filters.chains, state.participantFilters.chain, (value) => { state.participantFilters.chain = value; renderParticipantProjection(projection); }),
    filterSelect("Capitalization", "capitalization_band", filters.capitalization_bands, state.participantFilters.capitalization_band, (value) => { state.participantFilters.capitalization_band = value; renderParticipantProjection(projection); }),
    filterSelect("Window", "window", filters.windows, state.participantFilters.window, (value) => { state.participantFilters.window = value; renderParticipantProjection(projection); }),
    filterSelect("Participation", "participation_trend", filters.participation_trends, state.participantFilters.participation_trend, (value) => { state.participantFilters.participation_trend = value; renderParticipantProjection(projection); }),
    filterSelect("Behavior", "behavior_state", filters.behavior_states, state.participantFilters.behavior_state, (value) => { state.participantFilters.behavior_state = value; renderParticipantProjection(projection); }),
    filterSelect("Outcome", "average_outcome_classification", filters.outcome_classes, state.participantFilters.average_outcome_classification, (value) => { state.participantFilters.average_outcome_classification = value; renderParticipantProjection(projection); }),
    filterSelect("Confidence", "confidence", filters.confidences, state.participantFilters.confidence, (value) => { state.participantFilters.confidence = value; renderParticipantProjection(projection); }),
    choiceSelect("Minimum usable sample", "minimum_usable_sample", [
      { label: "Any sample", value: "" },
      { label: "25+ usable", value: "25" },
      { label: "50+ usable", value: "50" },
      { label: "100+ usable", value: "100" },
    ], state.participantFilters.minimum_usable_sample, (value) => { state.participantFilters.minimum_usable_sample = value; renderParticipantProjection(projection); }),
    choiceSelect("Sort", "sort", [
      { label: "Largest usable sample", value: "usable_desc" },
      { label: "Highest outcome score", value: "outcome_desc" },
      { label: "Highest success rate", value: "success_desc" },
      { label: "Chain and cohort", value: "cohort_asc" },
    ], state.participantFilters.sort, (value) => { state.participantFilters.sort = value; renderParticipantProjection(projection); }),
  );
}

function participantRows(projection) {
  const filters = state.participantFilters;
  const queryTokens = String(filters.query || "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  const minimumUsable = Math.max(0, Number(filters.minimum_usable_sample) || 0);
  const exactFilters = {
    chain: filters.chain,
    capitalization_band: filters.capitalization_band,
    window: filters.window,
    participation_trend: filters.participation_trend,
    behavior_state: filters.behavior_state,
    average_outcome_classification: filters.average_outcome_classification,
    confidence: filters.confidence,
  };
  const rows = filterRows(projection.advanced.condition_matrix, exactFilters, {}).filter((row) => {
    if ((finite(row.sample_integrity?.usable) || 0) < minimumUsable) return false;
    if (!queryTokens.length) return true;
    const haystack = [
      row.cohort_id,
      row.chain,
      row.capitalization_band,
      row.window,
      row.participation_trend,
      row.behavior_state,
      row.average_outcome_classification,
      row.outcome_context,
      ...(Array.isArray(row.search_terms) ? row.search_terms : []),
    ].join(" ").toLowerCase();
    return queryTokens.every((token) => haystack.includes(token));
  });
  const sorters = {
    outcome_desc: (left, right) => (finite(right.outcome_score) ?? -1) - (finite(left.outcome_score) ?? -1),
    success_desc: (left, right) => (finite(right.participant_success_rate) ?? -1) - (finite(left.participant_success_rate) ?? -1),
    cohort_asc: (left, right) => String(left.cohort_id || "").localeCompare(String(right.cohort_id || "")),
    usable_desc: (left, right) => (finite(right.sample_integrity?.usable) ?? -1) - (finite(left.sample_integrity?.usable) ?? -1),
  };
  return rows.sort(sorters[filters.sort] || sorters.usable_desc);
}

function renderParticipantProjection(projection, { refreshFilters = true } = {}) {
  if (refreshFilters) renderParticipantFilters(projection);
  const rows = participantRows(projection);
  const host = document.getElementById("proParticipantsContent");
  host.replaceChildren(table("Behavior cohort relationships", "Searchable aggregate Raven conditions with observed forward outcomes, denominators, and exclusions attached.", [
    { label: "Cohort", value: (row) => `${readable(row.chain)} · ${readable(row.capitalization_band)}` },
    { label: "Window", value: (row) => text(row.window) },
    { label: "Participation", value: (row) => readable(row.participation_trend) },
    { label: "Observed association", value: (row) => `${readable(row.behavior_state)} · ${readable(row.association_direction)}` },
    { label: "Success rate", value: (row) => finite(row.participant_success_rate) === null ? "—" : `${(Number(row.participant_success_rate) * 100).toFixed(1)}%` },
    { label: "Forward outcome", value: (row) => `${readable(row.outcome_strength)} · ${readable(row.average_outcome_classification)}${finite(row.outcome_score) === null ? "" : ` · score ${Number(row.outcome_score).toFixed(3)}`}` },
    { label: "Confidence", value: (row) => `${readable(row.confidence)} · ${readable(row.score_strength)}` },
    { label: "Sample integrity", value: (row) => `${compact(row.sample_integrity?.usable)} usable / ${compact(row.sample_integrity?.observed)} observed / ${compact(row.sample_integrity?.excluded_or_unusable)} excluded` },
    { label: "Association read", value: (row) => text(row.outcome_context) },
  ], rows));
}

function selectView(view, { focus = false, updateUrl = true } = {}) {
  state.view = ["perps", "participants"].includes(view) ? view : "perps";
  document.querySelectorAll("[data-pro-view]").forEach((button) => {
    const selected = button.dataset.proView === state.view;
    button.setAttribute("aria-selected", selected ? "true" : "false");
    button.tabIndex = selected ? 0 : -1;
    if (selected && focus) button.focus();
  });
  document.querySelectorAll("[data-pro-panel]").forEach((panel) => { panel.hidden = panel.dataset.proPanel !== state.view; });
  if (updateUrl) {
    const target = new URL(window.location.pathname, window.location.origin);
    target.searchParams.set("view", state.view);
    if (state.selectedInstrumentId) target.searchParams.set("instrument_id", state.selectedInstrumentId);
    window.history.replaceState({}, "", `${target.pathname}${target.search}`);
  }
  syncReturnTo();
}

function bindTabs() {
  const tabs = [...document.querySelectorAll("[data-pro-view]")];
  tabs.forEach((button, index) => {
    button.addEventListener("click", () => selectView(button.dataset.proView));
    button.addEventListener("keydown", (event) => {
      let next = index;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else return;
      event.preventDefault();
      selectView(tabs[next].dataset.proView, { focus: true });
    });
  });
  const subtabs = [...document.querySelectorAll("[data-pro-perps-section]")];
  subtabs.forEach((button, index) => {
    const select = (focus = false) => {
      state.perpsSection = button.dataset.proPerpsSection;
      subtabs.forEach((item) => {
        const active = item === button;
        item.setAttribute("aria-selected", active ? "true" : "false");
        item.tabIndex = active ? 0 : -1;
      });
      if (focus) button.focus();
      const projection = state.projections.get("perps");
      if (projection) renderPerpsProjection(projection);
    };
    button.addEventListener("click", () => select());
    button.addEventListener("keydown", (event) => {
      let next = index;
      if (event.key === "ArrowRight") next = (index + 1) % subtabs.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + subtabs.length) % subtabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = subtabs.length - 1;
      else return;
      event.preventDefault();
      subtabs[next].click();
      subtabs[next].focus();
    });
  });
}

async function loadCapabilityProjection(kind, capability) {
  setCapabilityState(kind, capability);
  if (!capability?.available) return;
  try {
    const { response, payload } = await getJson(CAPABILITIES[kind].route);
    if (!response.ok) {
      const denied = { ...capability, available: false, state: payload?.state || "unavailable" };
      setCapabilityState(kind, denied);
      return;
    }
    const projection = validProProjection(kind, payload);
    if (!projection) {
      setCapabilityState(kind, { ...capability, available: false, state: "unavailable" }, "Advanced intelligence could not be verified and was not shown.");
      return;
    }
    state.projections.set(kind, projection);
    setCapabilityState(kind, { ...capability, state: "active", available: true });
    const status = document.getElementById(kind === "perps" ? "proPerpsState" : "proParticipantsState");
    if (status) status.textContent = `${readable(projection.provenance.freshness.state)} · Active`;
    if (kind === "perps") {
      document.getElementById("proPerpsProjection").hidden = false;
      renderPerpsProjection(projection);
    } else {
      document.getElementById("proParticipantsProjection").hidden = false;
      renderParticipantProjection(projection);
    }
  } catch {
    setCapabilityState(kind, { ...capability, available: false, state: "unavailable" }, "Advanced intelligence could not be loaded. Public Intelligence remains available.");
  }
}

async function loadEntitlements() {
  try {
    const { response, payload } = await getJson("/api/v1/entitlements");
    if (!response.ok || !Array.isArray(payload?.capabilities)) {
      const unavailable = { available: false, state: payload?.state || "unavailable" };
      setCapabilityState("perps", unavailable);
      setCapabilityState("participants", unavailable);
      setText("proWorkspaceState", "Pro access unavailable");
      return;
    }
    for (const kind of Object.keys(CAPABILITIES)) {
      const capability = payload.capabilities.find((row) => row?.capability === CAPABILITIES[kind].key)
        || { capability: CAPABILITIES[kind].key, available: false, state: "unavailable" };
      state.capabilities.set(kind, capability);
    }
    await Promise.all(Object.keys(CAPABILITIES).map((kind) => loadCapabilityProjection(kind, state.capabilities.get(kind))));
    const active = [...state.projections.keys()].length;
    setText("proWorkspaceState", active ? `${active} Pro view${active === 1 ? "" : "s"} ready` : "Pro access not available");
  } catch {
    setCapabilityState("perps", { available: false, state: "unavailable" });
    setCapabilityState("participants", { available: false, state: "unavailable" });
    setText("proWorkspaceState", "Pro access unavailable");
  }
}

async function boot() {
  const context = requestedContext();
  state.view = context.view;
  state.selectedInstrumentId = context.instrumentId;
  bindTabs();
  selectView(state.view);
  syncReturnTo();
  setText("proPerpsContext", state.selectedInstrumentId
    ? `Exact selected market: ${state.selectedInstrumentId}. No symbol substitution is allowed.`
    : "No exact market context selected. Filters do not change market identity.");

  let config;
  try {
    ({ payload: config } = await getJson("/api/v1/auth/config"));
  } catch {
    config = null;
  }
  if (config?.available !== true || config?.on_authenticated_origin !== true) {
    document.getElementById("proWorkspaceSignIn").hidden = false;
    document.getElementById("proWorkspaceSignInActions").hidden = true;
    setText("proWorkspaceState", "Account service unavailable");
    document.querySelector(".pro-intelligence-page").dataset.workspaceState = "unavailable";
    return;
  }

  let session;
  try {
    ({ payload: session } = await getJson("/api/v1/auth/session"));
  } catch {
    session = null;
  }
  if (session?.authenticated !== true) {
    document.getElementById("proWorkspaceSignIn").hidden = false;
    setText("proWorkspaceState", "Sign in required");
    document.querySelector(".pro-intelligence-page").dataset.workspaceState = "signed_out";
    return;
  }

  document.getElementById("proWorkspace").hidden = false;
  setText("proWorkspaceState", "Resolving capabilities");
  const username = String(session.account?.username || "").trim().toLowerCase();
  setText("proWorkspaceIdentity", /^[a-z][a-z0-9_]{2,23}$/.test(username) ? `@${username}` : "Authenticated RavenOS account");
  document.querySelector(".pro-intelligence-page").dataset.workspaceState = "authenticated";
  await loadEntitlements();
}

bindAuthStartForms();
boot();
