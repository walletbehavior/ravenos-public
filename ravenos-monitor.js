const RESEARCH_ROUTE = "/api/v1/research-state";
const WORKSPACE_SCHEMA = "ravenos.saved_workspace.v1";
const ALLOWED_TIMEFRAMES = new Set(["1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M"]);
const ALLOWED_INDICATORS = new Set(["ema20", "ema50", "vwap", "bb20", "rsi14", "macd"]);
const ALLOWED_RAVEN_OVERLAYS = new Set(["structure", "pressure", "participation", "replay", "risk", "pressure-zone", "history-window", "breadth-line", "compression-band", "regime-marker", "liquidity-zone", "participant-shift"]);
const ALLOWED_DENSITIES = new Set(["compact", "comfortable"]);
const ALLOWED_PANELS = new Set(["chart", "raven", "book", "trade", "account"]);

const page = document.querySelector(".monitor-page");
const auth = document.getElementById("monitorAuth");
const authActions = document.getElementById("monitorAuthActions");
const workspaceNode = document.getElementById("monitorWorkspace");
const pendingNode = document.getElementById("monitorPending");
const listNode = document.getElementById("monitorList");
const saveButton = document.getElementById("monitorSave");
const unwatchButton = document.getElementById("monitorUnwatch");
const state = { csrf: "", items: [], pending: null, config: null };

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = String(value ?? "");
}

function csv(value, allowlist) {
  const output = [];
  for (const entry of String(value || "").split(",")) {
    const clean = entry.trim();
    if (allowlist.has(clean) && !output.includes(clean)) output.push(clean);
  }
  return output;
}

function safeQueryHandoff() {
  const params = new URLSearchParams(location.search);
  const instrumentId = String(params.get("instrument_id") || "").trim().slice(0, 220);
  if (!instrumentId) return null;
  const timeframe = ALLOWED_TIMEFRAMES.has(params.get("timeframe")) ? params.get("timeframe") : "1h";
  const density = ALLOWED_DENSITIES.has(params.get("density")) ? params.get("density") : "comfortable";
  const selectedPanel = ALLOWED_PANELS.has(params.get("panel")) ? params.get("panel") : "chart";
  const market = { instrument_id: instrumentId };
  for (const key of ["instrument_type", "identity_scope", "asset_class", "chain", "venue", "market"]) {
    const value = String(params.get(key) || "").trim().slice(0, 100);
    if (value) market[key] = value;
  }
  return {
    market,
    workspace: {
      schema_version: WORKSPACE_SCHEMA,
      timeframe,
      indicators: csv(params.get("indicators"), ALLOWED_INDICATORS),
      raven_overlays: csv(params.get("raven_overlays"), ALLOWED_RAVEN_OVERLAYS),
      density,
      selected_panel: selectedPanel,
    },
  };
}

function authenticatedReturnTo(pending) {
  if (!pending) return "/monitor/";
  const params = new URLSearchParams({ action: "save", instrument_id: pending.market.instrument_id });
  for (const key of ["instrument_type", "identity_scope", "asset_class", "chain", "venue", "market"]) {
    if (pending.market[key]) params.set(key, pending.market[key]);
  }
  params.set("timeframe", pending.workspace.timeframe);
  params.set("indicators", pending.workspace.indicators.join(","));
  params.set("raven_overlays", pending.workspace.raven_overlays.join(","));
  params.set("density", pending.workspace.density);
  params.set("panel", pending.workspace.selected_panel);
  return `/monitor/?${params}`;
}

async function api(url, init = {}) {
  const headers = { accept: "application/json", ...(init.headers || {}) };
  if (init.method && init.method !== "GET") {
    headers["content-type"] = "application/json";
    headers["x-ravenos-csrf"] = state.csrf;
  }
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", ...init, headers });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

function formatWhen(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "Not checked";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function listLabel(values, fallback = "None") {
  return Array.isArray(values) && values.length ? values.join(", ") : fallback;
}

function button(label, className, handler) {
  const node = document.createElement("button");
  node.type = "button";
  node.textContent = label;
  if (className) node.className = className;
  node.addEventListener("click", () => handler(node));
  return node;
}

function fact(label, value) {
  const node = document.createElement("div");
  node.className = "monitor-item-fact";
  const key = document.createElement("span");
  const content = document.createElement("strong");
  key.textContent = label;
  content.textContent = value;
  node.append(key, content);
  return node;
}

function itemNode(item) {
  const row = document.createElement("article");
  row.className = "monitor-item";
  row.dataset.watchId = item.watch_id;

  const main = document.createElement("div");
  main.className = "monitor-item-main";
  const headline = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = item.market?.display_label || "Exact market";
  const chip = document.createElement("span");
  chip.className = "monitor-state-chip";
  chip.dataset.state = item.availability?.state || "unverified";
  chip.textContent = item.availability?.state || "unverified";
  headline.append(title, chip);
  const identity = document.createElement("span");
  identity.className = "monitor-identity";
  identity.textContent = item.market?.instrument_id || "Identity unavailable";
  main.append(headline, identity);

  const facts = document.createElement("div");
  facts.className = "monitor-item-facts";
  facts.append(
    fact("Workspace", `${item.workspace?.timeframe || "1h"} · ${item.workspace?.density || "comfortable"} · ${item.workspace?.selected_panel || "chart"}`),
    fact("Raven overlays", listLabel(item.workspace?.raven_overlays)),
    fact("Indicators", listLabel(item.workspace?.indicators)),
    fact("Last checked", `${formatWhen(item.availability?.checked_at)} · revision ${item.revision || 1}`),
  );

  const actions = document.createElement("div");
  actions.className = "monitor-item-actions";
  const open = document.createElement("a");
  open.href = item.terminal_url;
  open.textContent = item.availability?.state === "available" ? "Open exact market" : "Open unavailable market";
  open.rel = "noopener";
  actions.append(
    open,
    button("Check availability", "", async (node) => {
      node.disabled = true;
      const result = await api(`${RESEARCH_ROUTE}/watch-items/${encodeURIComponent(item.watch_id)}/refresh`, { method: "POST", body: "{}" });
      if (!result.response.ok) setText("monitorListSummary", `Availability check refused: ${result.payload?.error || "unavailable"}.`);
      await loadItems();
    }),
    button("Remove", "danger", async (node) => {
      node.disabled = true;
      await removeItem(item.watch_id);
    }),
  );
  row.append(main, facts, actions);
  return row;
}

function renderItems() {
  listNode.replaceChildren();
  if (!state.items.length) {
    const empty = document.createElement("p");
    empty.className = "monitor-empty";
    empty.textContent = "No exact markets saved. Open a public Discover or Terminal market and choose Save market.";
    listNode.append(empty);
  } else {
    listNode.append(...state.items.map(itemNode));
  }
  setText("monitorListSummary", `${state.items.length} of 100 exact markets saved across this account.`);
  const current = state.pending ? state.items.find((item) => item.market?.instrument_id === state.pending.market.instrument_id) : null;
  pendingNode.dataset.state = current ? "saved" : "pending";
  setText("monitorPendingState", current ? `Saved · revision ${current.revision}` : "Not saved");
  saveButton.textContent = current ? "Update saved workspace" : "Save exact market";
  unwatchButton.hidden = !current;
  unwatchButton.dataset.watchId = current?.watch_id || "";
}

async function loadItems() {
  const { response, payload } = await api(RESEARCH_ROUTE);
  if (!response.ok || !Array.isArray(payload?.items)) {
    setText("monitorListSummary", `Saved research state unavailable: ${payload?.error || "request failed"}.`);
    return false;
  }
  state.items = payload.items;
  renderItems();
  return true;
}

function renderPending() {
  if (!state.pending) return;
  pendingNode.hidden = false;
  setText("monitorPendingIdentity", state.pending.market.instrument_id);
  setText("monitorPendingTimeframe", state.pending.workspace.timeframe);
  setText("monitorPendingIndicators", listLabel(state.pending.workspace.indicators));
  setText("monitorPendingOverlays", listLabel(state.pending.workspace.raven_overlays));
  setText("monitorPendingDensity", state.pending.workspace.density);
  setText("monitorPendingPanel", state.pending.workspace.selected_panel);
}

async function savePending() {
  if (!state.pending) return;
  saveButton.disabled = true;
  setText("monitorPendingMessage", "Validating canonical identity and saving…");
  const current = state.items.find((item) => item.market?.instrument_id === state.pending.market.instrument_id);
  const body = current ? { ...state.pending, expected_revision: current.revision } : state.pending;
  const { response, payload } = await api(`${RESEARCH_ROUTE}/watch-items`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  saveButton.disabled = false;
  if (!response.ok) {
    pendingNode.dataset.state = "invalid";
    setText("monitorPendingState", "Save refused");
    setText("monitorPendingMessage", `RavenOS refused this handoff: ${String(payload?.error || "request unavailable").replaceAll("_", " ")}.`);
    return;
  }
  history.replaceState({}, "", "/monitor/");
  setText("monitorPendingMessage", "Saved to this RavenOS account. The exact identity will never be replaced by a similarly named market.");
  await loadItems();
}

async function removeItem(watchId) {
  const { response, payload } = await api(`${RESEARCH_ROUTE}/watch-items/${encodeURIComponent(watchId)}`, { method: "DELETE", body: "{}" });
  if (!response.ok) setText("monitorListSummary", `Deletion refused: ${payload?.error || "request unavailable"}.`);
  await loadItems();
}

async function deleteAll() {
  const buttonNode = document.getElementById("monitorDeleteAllConfirm");
  buttonNode.disabled = true;
  const { response, payload } = await api(RESEARCH_ROUTE, {
    method: "DELETE",
    body: JSON.stringify({ confirm: "delete_all_saved_research_state" }),
  });
  buttonNode.disabled = false;
  if (!response.ok) {
    setText("monitorListSummary", `Delete-all refused: ${payload?.error || "request unavailable"}.`);
    return;
  }
  document.getElementById("monitorDeleteDialog").close();
  state.items = [];
  renderItems();
  setText("monitorListSummary", `Deleted ${payload.deleted_count || 0} saved research-state record${payload.deleted_count === 1 ? "" : "s"}.`);
}

async function submitAuth(form) {
  const status = document.getElementById("monitorAuthStatus");
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  status.textContent = "Opening secure sign-in…";
  const values = Object.fromEntries(new FormData(form));
  values.return_to = authenticatedReturnTo(state.pending);
  const result = await api("/api/v1/auth/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(values),
  });
  try {
    const target = new URL(result.payload?.authorization_url || "");
    if (!result.response.ok || target.protocol !== "https:" || target.hostname !== "api.workos.com") throw new Error("invalid_authorization_url");
    location.assign(target.toString());
  } catch {
    submit.disabled = false;
    status.textContent = "Secure sign-in could not be opened. Please try again.";
  }
}

async function initialize() {
  state.pending = safeQueryHandoff();
  renderPending();
  for (const form of document.querySelectorAll("[data-monitor-auth]")) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitAuth(form);
    });
  }
  saveButton.addEventListener("click", savePending);
  unwatchButton.addEventListener("click", () => removeItem(unwatchButton.dataset.watchId));
  document.getElementById("monitorReload").addEventListener("click", loadItems);
  document.getElementById("monitorDeleteAll").addEventListener("click", () => document.getElementById("monitorDeleteDialog").showModal());
  document.getElementById("monitorDeleteAllConfirm").addEventListener("click", deleteAll);

  const config = await api("/api/v1/auth/config");
  state.config = config.payload;
  if (!config.response.ok || !config.payload?.available || !config.payload?.on_authenticated_origin) {
    page.dataset.monitorState = "unavailable";
    auth.hidden = false;
    document.getElementById("monitorServiceUnavailable").hidden = false;
    return;
  }
  const session = await api("/api/v1/auth/session");
  if (!session.response.ok || !session.payload?.authenticated) {
    page.dataset.monitorState = "anonymous";
    auth.hidden = false;
    authActions.hidden = false;
    return;
  }
  state.csrf = session.payload.csrf_token || "";
  page.dataset.monitorState = "authenticated";
  workspaceNode.hidden = false;
  await loadItems();
}

window.__RAVENOS_SAVED_MONITOR__ = Object.freeze({
  schemaVersion: "ravenos.saved_monitor_surface.v1",
  exactIdentityOnly: true,
  browserStoredBearerTokens: false,
  alertsAvailable: false,
  walletsPersisted: false,
  executionAvailable: false,
});

initialize().catch(() => {
  page.dataset.monitorState = "unavailable";
  auth.hidden = false;
  document.getElementById("monitorServiceUnavailable").hidden = false;
});
