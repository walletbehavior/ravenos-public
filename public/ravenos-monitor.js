const RESEARCH_ROUTE = "/api/v1/research-state";
const ENTITLEMENT_ROUTE = "/api/v1/entitlements";
const ALERT_ROUTE = "/api/v1/monitor-alerts";
const WORKSPACE_SCHEMA = "ravenos.saved_workspace.v1";
const ALLOWED_TIMEFRAMES = new Set(["1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M"]);
const ALLOWED_INDICATORS = new Set(["ema20", "ema50", "vwap", "bb20", "rsi14", "macd"]);
const ALLOWED_RAVEN_OVERLAYS = new Set(["structure", "pressure", "participation", "replay", "risk", "pressure-zone", "history-window", "breadth-line", "compression-band", "regime-marker", "liquidity-zone", "participant-shift"]);
const ALLOWED_DENSITIES = new Set(["compact", "comfortable"]);
const ALLOWED_PANELS = new Set(["chart", "raven", "book", "trade", "account"]);
const EVENT_LABELS = Object.freeze({
  setup_state_changed: "Raven setup state",
  evidence_strengthened: "Evidence strengthened",
  evidence_weakened: "Evidence weakened",
  evidence_invalid_or_unavailable: "Evidence invalid / unavailable",
  pressure_regime_changed: "Pressure / crowding regime",
  funding_regime_changed: "Funding regime",
  liquidity_quality_changed: "Liquidity quality",
  attention_state_changed: "Attention accelerated / faded",
  launch_lifecycle_changed: "Launch lifecycle",
  exact_market_availability_changed: "Exact-market availability",
});
const DEFAULT_PERP_EVENTS = ["evidence_strengthened", "evidence_weakened", "evidence_invalid_or_unavailable", "pressure_regime_changed", "funding_regime_changed", "liquidity_quality_changed", "exact_market_availability_changed"];
const DEFAULT_EXACT_EVENTS = ["evidence_strengthened", "evidence_weakened", "evidence_invalid_or_unavailable", "exact_market_availability_changed"];

const page = document.querySelector(".monitor-page");
const auth = document.getElementById("monitorAuth");
const authActions = document.getElementById("monitorAuthActions");
const workspaceNode = document.getElementById("monitorWorkspace");
const pendingNode = document.getElementById("monitorPending");
const listNode = document.getElementById("monitorList");
const notificationNode = document.getElementById("monitorNotifications");
const saveButton = document.getElementById("monitorSave");
const unwatchButton = document.getElementById("monitorUnwatch");
const state = { csrf: "", items: [], rules: [], notifications: [], pending: null, pendingIntent: "save", config: null, alerts: { available: false, state: "loading" } };

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
  state.pendingIntent = params.get("action") === "monitor" ? "monitor" : "save";
  const instrumentId = String(params.get("instrument_id") || "").trim().slice(0, 220);
  if (!instrumentId) return null;
  const market = { instrument_id: instrumentId };
  for (const key of ["instrument_type", "identity_scope", "asset_class", "chain", "venue", "market"]) {
    const value = String(params.get(key) || "").trim().slice(0, 100);
    if (value) market[key] = value;
  }
  return {
    market,
    workspace: {
      schema_version: WORKSPACE_SCHEMA,
      timeframe: ALLOWED_TIMEFRAMES.has(params.get("timeframe")) ? params.get("timeframe") : "1h",
      indicators: csv(params.get("indicators"), ALLOWED_INDICATORS),
      raven_overlays: csv(params.get("raven_overlays"), ALLOWED_RAVEN_OVERLAYS),
      density: ALLOWED_DENSITIES.has(params.get("density")) ? params.get("density") : "comfortable",
      selected_panel: ALLOWED_PANELS.has(params.get("panel")) ? params.get("panel") : "chart",
    },
  };
}

function authenticatedReturnTo(pending) {
  if (!pending) return "/monitor/";
  const params = new URLSearchParams({ action: state.pendingIntent, instrument_id: pending.market.instrument_id });
  for (const key of ["instrument_type", "identity_scope", "asset_class", "chain", "venue", "market"]) if (pending.market[key]) params.set(key, pending.market[key]);
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
  return { response, payload: await response.json().catch(() => null) };
}

function formatWhen(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? "Not yet" : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function listLabel(values, fallback = "None") { return Array.isArray(values) && values.length ? values.join(", ") : fallback; }
function eventLabel(value) { return EVENT_LABELS[value] || "Raven change"; }

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

function defaultEvents(item) { return item.market?.instrument_id?.startsWith("hyperliquid:perp:") ? DEFAULT_PERP_EVENTS : DEFAULT_EXACT_EVENTS; }

function eventEditor(item, rule = null) {
  const details = document.createElement("details");
  details.className = "monitor-rule-editor";
  details.dataset.monitorEditor = item.watch_id;
  const summary = document.createElement("summary");
  summary.textContent = rule ? "Edit alert settings" : "Choose changes";
  const grid = document.createElement("div");
  grid.className = "monitor-event-grid";
  const selected = new Set(rule?.event_types || defaultEvents(item));
  for (const [eventType, label] of Object.entries(EVENT_LABELS)) {
    const control = document.createElement("label");
    const input = document.createElement("input");
    const copy = document.createElement("span");
    input.type = "checkbox";
    input.value = eventType;
    input.checked = selected.has(eventType);
    copy.textContent = label;
    control.append(input, copy);
    grid.append(control);
  }
  const action = button(rule ? "Update alerts" : "Turn on Raven alerts", "", async (node) => {
    const eventTypes = [...grid.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
    if (!eventTypes.length) return setText("monitorAlertSummary", "Select at least one change.");
    node.disabled = true;
    const result = rule
      ? await api(`${ALERT_ROUTE}/rules/${encodeURIComponent(rule.rule_id)}`, { method: "PATCH", body: JSON.stringify({ state: rule.state, event_types: eventTypes, expected_revision: rule.revision }) })
      : await api(`${ALERT_ROUTE}/rules`, { method: "POST", body: JSON.stringify({ watch_id: item.watch_id, event_types: eventTypes }) });
    node.disabled = false;
    if (!result.response.ok) return setText("monitorAlertSummary", "This alert could not be saved. Please try again.");
    setText("monitorAlertSummary", rule ? "Alert settings updated." : "Raven alerts are on for this exact market.");
    await loadRules();
  });
  details.append(summary, grid, action);
  return details;
}

function ruleNode(item) {
  const host = document.createElement("section");
  host.className = "monitor-rule";
  const summary = document.createElement("div");
  summary.className = "monitor-rule-summary";
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  const note = document.createElement("p");
  const actions = document.createElement("div");
  actions.className = "monitor-rule-actions";
  copy.append(title, note);
  summary.append(copy, actions);
  if (!state.alerts.available) {
    title.textContent = "Raven alerts aren’t available yet";
    note.textContent = state.alerts.state === "loading" ? "Checking alert access…" : "Your saved markets still work normally. Alert controls will appear here when they’re ready for your account.";
    host.append(summary);
    return host;
  }
  const rule = state.rules.find((candidate) => candidate.watch_id === item.watch_id);
  if (!rule) {
    title.textContent = "Alerts off";
    note.textContent = "Choose the Raven changes you want to review for this market. Price targets and plan levels are not saved as alert rules.";
    host.append(summary, eventEditor(item));
    return host;
  }
  title.textContent = `Raven alerts · ${rule.state}`;
  note.textContent = `${rule.event_types.map(eventLabel).join(" · ")} · last checked ${formatWhen(rule.last_qualified_evaluation_at)}`;
  actions.append(
    button(rule.state === "active" ? "Pause" : "Resume", "", async (node) => {
      node.disabled = true;
      const nextState = rule.state === "active" ? "paused" : "active";
      const result = await api(`${ALERT_ROUTE}/rules/${encodeURIComponent(rule.rule_id)}`, { method: "PATCH", body: JSON.stringify({ state: nextState, event_types: rule.event_types, expected_revision: rule.revision }) });
      if (!result.response.ok) setText("monitorAlertSummary", "Alert settings could not be updated. Please try again.");
      await loadRules();
    }),
    button("Delete alert", "danger", async (node) => {
      node.disabled = true;
      const result = await api(`${ALERT_ROUTE}/rules/${encodeURIComponent(rule.rule_id)}`, { method: "DELETE", body: "{}" });
      if (!result.response.ok) setText("monitorAlertSummary", "This alert could not be deleted. Please try again.");
      await Promise.all([loadRules(), loadNotifications()]);
    }),
  );
  host.append(summary, eventEditor(item, rule));
  return host;
}

function itemNode(item) {
  const row = document.createElement("article");
  row.className = "monitor-item";
  row.dataset.watchId = item.watch_id;
  const main = document.createElement("div");
  main.className = "monitor-item-main";
  const headline = document.createElement("div");
  const title = document.createElement("h3");
  const chip = document.createElement("span");
  const identity = document.createElement("span");
  title.textContent = item.market?.display_label || "Exact market";
  chip.className = "monitor-state-chip";
  chip.dataset.state = item.availability?.state || "unverified";
  chip.textContent = item.availability?.state || "unverified";
  identity.className = "monitor-identity";
  identity.textContent = item.market?.instrument_id || "Identity unavailable";
  headline.append(title, chip);
  main.append(headline, identity);
  const facts = document.createElement("div");
  facts.className = "monitor-item-facts";
  facts.append(
    fact("Workspace", `${item.workspace?.timeframe || "1h"} · ${item.workspace?.density || "comfortable"} · ${item.workspace?.selected_panel || "chart"}`),
    fact("Raven overlays", listLabel(item.workspace?.raven_overlays)),
    fact("Indicators", listLabel(item.workspace?.indicators)),
    fact("Last checked", formatWhen(item.availability?.checked_at)),
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
      if (!result.response.ok) setText("monitorListSummary", "Market availability could not be refreshed. Please try again.");
      await loadItems();
    }),
    button("Remove", "danger", async (node) => { node.disabled = true; await removeItem(item.watch_id); }),
  );
  row.append(main, facts, actions, ruleNode(item));
  return row;
}

function renderItems() {
  listNode.replaceChildren();
  if (!state.items.length) {
    const empty = document.createElement("p");
    empty.className = "monitor-empty";
    empty.textContent = "No exact markets saved. Open a market in Discover or Terminal and choose Save or Monitor with Raven.";
    listNode.append(empty);
  } else listNode.append(...state.items.map(itemNode));
  setText("monitorListSummary", `${state.items.length} of 100 exact markets saved across this account.`);
  const current = state.pending ? state.items.find((item) => item.market?.instrument_id === state.pending.market.instrument_id) : null;
  pendingNode.dataset.state = current ? "saved" : "pending";
  setText("monitorPendingState", current ? "Saved" : "Not saved");
  saveButton.textContent = current ? "Update chart setup" : state.pendingIntent === "monitor" ? "Save exact market first" : "Save exact market";
  unwatchButton.hidden = !current;
  unwatchButton.dataset.watchId = current?.watch_id || "";
}

async function loadItems() {
  const { response, payload } = await api(RESEARCH_ROUTE);
  if (!response.ok || !Array.isArray(payload?.items)) {
    setText("monitorListSummary", "Your saved markets could not be loaded. Please refresh and try again.");
    return false;
  }
  state.items = payload.items;
  renderItems();
  return true;
}

function renderPending() {
  if (!state.pending) return;
  pendingNode.hidden = false;
  pendingNode.querySelector("h2").textContent = state.pendingIntent === "monitor" ? "Save this market and add alerts" : "Save this exact market";
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
  setText("monitorPendingMessage", "Confirming the exact market and saving…");
  const current = state.items.find((item) => item.market?.instrument_id === state.pending.market.instrument_id);
  const body = current ? { ...state.pending, expected_revision: current.revision } : state.pending;
  const { response, payload } = await api(`${RESEARCH_ROUTE}/watch-items`, { method: "POST", body: JSON.stringify(body) });
  saveButton.disabled = false;
  if (!response.ok) {
    pendingNode.dataset.state = "invalid";
    setText("monitorPendingState", "Couldn’t save");
    return setText("monitorPendingMessage", "This market could not be saved. Please return to its exact Terminal page and try again.");
  }
  history.replaceState({}, "", "/monitor/");
  setText("monitorPendingMessage", state.pendingIntent === "monitor" ? "Saved. Choose which Raven changes you want to follow below." : "Saved to your account. RavenOS will always reopen this exact market.");
  await loadItems();
  if (state.pendingIntent === "monitor") {
    const currentItem = state.items.find((item) => item.market?.instrument_id === state.pending.market.instrument_id);
    const editor = currentItem ? document.querySelector(`[data-monitor-editor="${currentItem.watch_id}"]`) : null;
    if (editor) { editor.open = true; editor.scrollIntoView({ behavior: "smooth", block: "center" }); editor.querySelector("input")?.focus({ preventScroll: true }); }
  }
}

async function removeItem(watchId) {
  const { response, payload } = await api(`${RESEARCH_ROUTE}/watch-items/${encodeURIComponent(watchId)}`, { method: "DELETE", body: "{}" });
  if (!response.ok) setText("monitorListSummary", "This saved market could not be removed. Please try again.");
  await Promise.all([loadItems(), state.alerts.available ? loadNotifications() : Promise.resolve()]);
}

async function deleteAll() {
  const control = document.getElementById("monitorDeleteAllConfirm");
  control.disabled = true;
  const { response, payload } = await api(RESEARCH_ROUTE, { method: "DELETE", body: JSON.stringify({ confirm: "delete_all_saved_research_state" }) });
  control.disabled = false;
  if (!response.ok) return setText("monitorListSummary", "Your saved markets could not be deleted. Please try again.");
  document.getElementById("monitorDeleteDialog").close();
  state.items = []; state.rules = []; state.notifications = [];
  renderItems(); renderNotifications();
  setText("monitorListSummary", `Deleted ${payload.deleted_count || 0} saved market${payload.deleted_count === 1 ? "" : "s"}.`);
}

function renderAlertState() {
  const available = state.alerts.available;
  for (const id of ["monitorReloadAlerts", "monitorDeleteNotifications", "monitorDeleteAlertState"]) document.getElementById(id).disabled = !available;
  if (!available) {
    notificationNode.replaceChildren();
    const empty = document.createElement("p");
    empty.className = "monitor-empty";
    empty.textContent = "Raven alerts aren’t available for this account yet. Your saved markets still work normally.";
    notificationNode.append(empty);
    setText("monitorAlertSummary", "Alerts aren’t available for this account yet.");
  }
  renderItems();
}

async function loadRules() {
  const { response, payload } = await api(`${ALERT_ROUTE}/rules`);
  if (!response.ok || !Array.isArray(payload?.rules)) {
    state.alerts = { available: false, state: payload?.state || payload?.error || "unavailable" };
    renderAlertState();
    return false;
  }
  state.rules = payload.rules;
  renderItems();
  updateAlertSummary();
  return true;
}

function notificationItem(item) {
  const row = document.createElement("article");
  row.className = "monitor-notification";
  row.dataset.read = item.read_at ? "true" : "false";
  const main = document.createElement("div");
  main.className = "monitor-notification-main";
  const title = document.createElement("h3");
  const identity = document.createElement("span");
  title.textContent = item.market?.display_label || "Exact market";
  identity.textContent = item.market?.instrument_id || "Identity unavailable";
  main.append(title, identity);
  const copy = document.createElement("div");
  copy.className = "monitor-notification-copy";
  const explanation = document.createElement("strong");
  const transition = document.createElement("p");
  const limitation = document.createElement("p");
  explanation.textContent = item.explanation || eventLabel(item.event_type);
  transition.textContent = `${item.before?.value || "Unavailable"} → ${item.after?.value || "Unavailable"} · observed ${formatWhen(item.source_as_of)} · alerted ${formatWhen(item.detected_at)}`;
  limitation.textContent = listLabel(item.limitations, "This alert is research context, not an instruction to trade.");
  copy.append(explanation, transition, limitation);
  const actions = document.createElement("div");
  actions.className = "monitor-notification-actions";
  const open = document.createElement("a");
  open.href = item.terminal_url || "https://ravenos.xyz/terminal/";
  open.textContent = "Open exact chart";
  open.rel = "noopener";
  actions.append(open);
  if (!item.read_at) actions.append(button("Mark read", "", async (node) => {
    node.disabled = true;
    const result = await api(`${ALERT_ROUTE}/notifications/${encodeURIComponent(item.notification_id)}/read`, { method: "POST", body: JSON.stringify({ read: true }) });
    if (!result.response.ok) setText("monitorAlertSummary", "This notification could not be marked as read. Please try again.");
    await loadNotifications();
  }));
  row.append(main, copy, actions);
  return row;
}

function renderNotifications() {
  notificationNode.replaceChildren();
  if (!state.alerts.available || !state.notifications.length) {
    const empty = document.createElement("p");
    empty.className = "monitor-empty";
    empty.textContent = state.alerts.available ? "No Raven changes have been recorded yet." : "Raven alerts aren’t available for this account yet.";
    notificationNode.append(empty);
  } else notificationNode.append(...state.notifications.map(notificationItem));
}

function updateAlertSummary() {
  const active = state.rules.filter((rule) => rule.state === "active").length;
  const unread = state.notifications.filter((item) => !item.read_at).length;
  setText("monitorAlertSummary", `${active} active alert${active === 1 ? "" : "s"} · ${unread} unread notification${unread === 1 ? "" : "s"}.`);
}

async function loadNotifications() {
  const { response, payload } = await api(`${ALERT_ROUTE}/notifications`);
  if (!response.ok || !Array.isArray(payload?.notifications)) {
    setText("monitorAlertSummary", "Notifications could not be loaded. Please try again.");
    return false;
  }
  state.notifications = payload.notifications;
  renderNotifications(); updateAlertSummary();
  return true;
}

async function loadAlertAccess() {
  const entitlements = await api(ENTITLEMENT_ROUTE);
  const capability = Array.isArray(entitlements.payload?.capabilities) ? entitlements.payload.capabilities.find((item) => item.capability === "research.alerts") : null;
  if (!entitlements.response.ok || capability?.available !== true) {
    state.alerts = { available: false, state: capability?.state || entitlements.payload?.state || entitlements.payload?.error || "server_disabled" };
    return renderAlertState();
  }
  const contract = await api(ALERT_ROUTE);
  if (!contract.response.ok) {
    state.alerts = { available: false, state: contract.payload?.state || contract.payload?.error || "server_disabled" };
    return renderAlertState();
  }
  state.alerts = { available: true, state: "available" };
  await Promise.all([loadRules(), loadNotifications()]);
  renderAlertState();
}

async function deleteNotificationHistory() {
  const result = await api(`${ALERT_ROUTE}/notifications`, { method: "DELETE", body: JSON.stringify({ confirm: "delete_notification_history" }) });
  if (!result.response.ok) return setText("monitorAlertSummary", "Notification history could not be cleared. Please try again.");
  state.notifications = []; renderNotifications();
  setText("monitorAlertSummary", `Cleared ${result.payload.deleted_count || 0} notification${result.payload.deleted_count === 1 ? "" : "s"}. Your alerts remain active.`);
}

async function deleteAlertState() {
  const control = document.getElementById("monitorDeleteAlertStateConfirm");
  control.disabled = true;
  const result = await api(ALERT_ROUTE, { method: "DELETE", body: JSON.stringify({ confirm: "delete_all_alert_research_state" }) });
  control.disabled = false;
  if (!result.response.ok) return setText("monitorAlertSummary", "Your Raven alerts could not be deleted. Please try again.");
  document.getElementById("monitorAlertDeleteDialog").close();
  state.rules = []; state.notifications = [];
  renderItems(); renderNotifications();
  setText("monitorAlertSummary", `Deleted ${result.payload.deleted?.rules || 0} alert${result.payload.deleted?.rules === 1 ? "" : "s"} and ${result.payload.deleted?.notifications || 0} notification${result.payload.deleted?.notifications === 1 ? "" : "s"}. Saved markets remain.`);
}

async function submitAuth(form) {
  const status = document.getElementById("monitorAuthStatus");
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  status.textContent = "Opening secure sign-in…";
  const values = Object.fromEntries(new FormData(form));
  values.return_to = authenticatedReturnTo(state.pending);
  const result = await api("/api/v1/auth/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) });
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
  for (const form of document.querySelectorAll("[data-monitor-auth]")) form.addEventListener("submit", (event) => { event.preventDefault(); submitAuth(form); });
  saveButton.addEventListener("click", savePending);
  unwatchButton.addEventListener("click", () => removeItem(unwatchButton.dataset.watchId));
  document.getElementById("monitorReload").addEventListener("click", loadItems);
  document.getElementById("monitorReloadAlerts").addEventListener("click", async () => Promise.all([loadRules(), loadNotifications()]));
  document.getElementById("monitorDeleteNotifications").addEventListener("click", deleteNotificationHistory);
  document.getElementById("monitorDeleteAlertState").addEventListener("click", () => document.getElementById("monitorAlertDeleteDialog").showModal());
  document.getElementById("monitorDeleteAlertStateConfirm").addEventListener("click", deleteAlertState);
  document.getElementById("monitorDeleteAll").addEventListener("click", () => document.getElementById("monitorDeleteDialog").showModal());
  document.getElementById("monitorDeleteAllConfirm").addEventListener("click", deleteAll);
  const config = await api("/api/v1/auth/config");
  state.config = config.payload;
  if (!config.response.ok || !config.payload?.available || !config.payload?.on_authenticated_origin) {
    page.dataset.monitorState = "unavailable"; auth.hidden = false; document.getElementById("monitorServiceUnavailable").hidden = false; return;
  }
  const session = await api("/api/v1/auth/session");
  if (!session.response.ok || !session.payload?.authenticated) { page.dataset.monitorState = "anonymous"; auth.hidden = false; authActions.hidden = false; return; }
  state.csrf = session.payload.csrf_token || "";
  page.dataset.monitorState = "authenticated";
  workspaceNode.hidden = false;
  await loadItems();
  await loadAlertAccess();
}

window.__RAVENOS_SAVED_MONITOR__ = Object.freeze({
  schemaVersion: "ravenos.saved_monitor_surface.v2",
  exactIdentityOnly: true,
  browserStoredBearerTokens: false,
  alertsImplementation: "implemented_dormant",
  inAppOnly: true,
  planPricesStored: false,
  walletsPersisted: false,
  executionAvailable: false,
});

initialize().catch(() => {
  page.dataset.monitorState = "unavailable";
  auth.hidden = false;
  document.getElementById("monitorServiceUnavailable").hidden = false;
});
