const page = document.querySelector(".account-page");
const authWorkspace = document.getElementById("accountAuthWorkspace");
const dashboard = document.getElementById("accountDashboard");
const actions = document.getElementById("accountAuthActions");
const activation = document.getElementById("accountActivation");
const serviceState = document.getElementById("accountServiceState");
const authStatus = document.getElementById("accountAuthStatus");
const state = { config: null, session: null, csrf: "", intent: "sign_up" };

async function getJson(url, init = {}) {
  const { headers = {}, ...rest } = init;
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", ...rest, headers: { accept: "application/json", ...headers } });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

function initial(value) {
  return String(value || "R").trim().charAt(0).toUpperCase() || "R";
}

function formatSeen(value) {
  const parsed = new Date(value || "");
  if (Number.isNaN(parsed.getTime())) return "Active session";
  return `Active ${new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(parsed)}`;
}

function setIntent(intent) {
  state.intent = intent === "sign_in" ? "sign_in" : "sign_up";
  document.querySelectorAll("[data-account-intent]").forEach((button) => {
    const active = button.dataset.accountIntent === state.intent;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll('.account-auth-actions input[name="intent"]').forEach((input) => { input.value = state.intent; });
  const action = state.intent === "sign_up" ? "Create your account" : "Sign in to your desk";
  serviceState.textContent = state.config?.available ? action : serviceState.textContent;
}

function renderActivationPending() {
  page.dataset.accountState = "pending";
  serviceState.textContent = "Secure activation pending";
  actions.hidden = true;
  activation.hidden = false;
  authWorkspace.hidden = false;
  dashboard.hidden = true;
}

function sessionRowNode(session) {
  const row = document.createElement("article");
  row.className = "account-session-row";
  const mark = document.createElement("span");
  mark.className = "account-provider-mark";
  mark.textContent = session.current ? "●" : "S";
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = `${session.device_label}${session.current ? " · This session" : ""}`;
  const detail = document.createElement("span");
  detail.textContent = `${formatSeen(session.last_seen_at)} · ${String(session.authentication_strength || "managed").replaceAll("_", " ")}`;
  copy.append(title, detail);
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = session.current ? "Sign out" : "Revoke";
  button.addEventListener("click", () => revokeSession(session.session_public_id));
  row.append(mark, copy, button);
  return row;
}

async function loadSessions() {
  const { response, payload } = await getJson("/api/v1/sessions");
  if (!response.ok || !Array.isArray(payload?.sessions)) return;
  if (payload.csrf_token) state.csrf = payload.csrf_token;
  document.getElementById("accountSessionCount").textContent = `${payload.sessions.length} ${payload.sessions.length === 1 ? "session" : "sessions"}`;
  const list = document.getElementById("accountSessionList");
  list.replaceChildren(...payload.sessions.map(sessionRowNode));
}

function renderAuthenticated(payload) {
  state.session = payload;
  state.csrf = payload.csrf_token || "";
  page.dataset.accountState = "authenticated";
  serviceState.textContent = "Signed in securely";
  authWorkspace.hidden = true;
  dashboard.hidden = false;
  const name = payload.account?.display_name || "RavenOS account";
  document.getElementById("accountDisplayName").textContent = name;
  document.getElementById("accountEmail").textContent = payload.account?.email || "";
  document.getElementById("accountProfileMark").textContent = initial(name);
  window.dispatchEvent(new CustomEvent("ravenos:accountstate", { detail: { authenticated: true, display_name: name } }));
  loadSessions();
}

async function revokeSession(sessionPublicId) {
  if (!state.csrf) return;
  const { response, payload } = await getJson(`/api/v1/sessions/${encodeURIComponent(sessionPublicId)}`, {
    method: "DELETE",
    headers: { "content-type": "application/json", "x-ravenos-csrf": state.csrf },
    body: "{}",
  });
  if (!response.ok || !payload?.revoked) {
    authStatus.dataset.tone = "error";
    authStatus.textContent = payload?.error === "recent_authentication_required" ? "Sign in again before revoking another session." : "That session could not be revoked.";
    return;
  }
  if (payload.current) location.assign("/account/");
  else loadSessions();
}

async function logout() {
  if (!state.csrf) return;
  const button = document.getElementById("accountLogout");
  button.disabled = true;
  const { response } = await getJson("/api/v1/auth/logout", {
    method: "POST",
    headers: { "content-type": "application/json", "x-ravenos-csrf": state.csrf },
    body: "{}",
  });
  if (response.ok) location.assign("/account/");
  else button.disabled = false;
}

async function submitAuth(form) {
  if (!state.config?.available) return renderActivationPending();
  if (!state.config.on_authenticated_origin) {
    const canonical = new URL("/account/", state.config.canonical_origin);
    canonical.searchParams.set("intent", state.intent === "sign_in" ? "sign_in" : "sign_up");
    location.assign(canonical.toString());
    return;
  }
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  authStatus.dataset.tone = "";
  authStatus.textContent = "Opening secure sign-in…";
  try {
    const values = Object.fromEntries(new FormData(form));
    const { response, payload } = await getJson("/api/v1/auth/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    });
    const target = new URL(payload?.authorization_url || "");
    if (!response.ok || target.protocol !== "https:" || target.hostname !== "api.workos.com") throw new Error("authorization_unavailable");
    location.assign(target.toString());
  } catch {
    button.disabled = false;
    authStatus.dataset.tone = "error";
    authStatus.textContent = "Secure sign-in could not be opened. Please try again.";
  }
}

function bindAuthForms() {
  for (const form of [document.getElementById("accountGoogleForm"), document.getElementById("accountManagedForm")]) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitAuth(form);
    });
  }
}

async function initialize() {
  const requestedIntent = new URLSearchParams(location.search).get("intent");
  if (requestedIntent === "sign_in") state.intent = "sign_in";
  document.querySelectorAll("[data-account-intent]").forEach((button) => button.addEventListener("click", () => setIntent(button.dataset.accountIntent)));
  document.getElementById("accountLogout").addEventListener("click", logout);
  bindAuthForms();
  setIntent(state.intent);

  const authResult = new URLSearchParams(location.search).get("auth");
  if (authResult === "failed") {
    authStatus.dataset.tone = "error";
    authStatus.textContent = "Sign-in could not be completed. Nothing was connected or authorized; please try again.";
  }
  if (authResult) history.replaceState({}, "", "/account/");

  const { response, payload } = await getJson("/api/v1/auth/config");
  if (!response.ok || !payload) return renderActivationPending();
  state.config = payload;
  if (!payload.available) return renderActivationPending();
  page.dataset.accountState = "available";
  serviceState.textContent = state.intent === "sign_up" ? "Ready to create your account" : "Ready to sign in";
  actions.hidden = false;
  activation.hidden = true;
  if (!payload.on_authenticated_origin) return;

  const session = await getJson("/api/v1/auth/session");
  if (session.response.ok && session.payload?.authenticated) renderAuthenticated(session.payload);
}

window.__RAVENOS_ACCOUNT__ = Object.freeze({
  schemaVersion: "ravenos.account_surface.v1",
  walletConnectionIsAuthentication: false,
  walletLinkingAvailable: false,
  signingAvailable: false,
  submissionAvailable: false,
});

initialize().catch(renderActivationPending);
