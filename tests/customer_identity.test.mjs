import assert from "node:assert/strict";
import test from "node:test";

import {
  CustomerIdentityContract,
  customerIdentityConfigured,
  publicCustomerIdentityConfig,
  routeCustomerIdentity,
  sha256,
} from "../lib/customer_identity.mjs";

const ORIGIN = "https://app.ravenos.xyz";
const NOW_MS = Date.parse("2026-08-26T15:00:00.000Z");

function configuredEnv() {
  return {
    RAVENOS_CUSTOMER_ACCOUNTS_ENABLE: "1",
    RAVENOS_AUTH_ORIGIN: ORIGIN,
    RAVENOS_AUTH_REDIRECT_URI: `${ORIGIN}/api/v1/auth/callback`,
    WORKOS_CLIENT_ID: "client_test_ravenos",
    WORKOS_API_KEY: "sk_test_not_returned",
    RAVENOS_AUTH_HASH_PEPPER: "test-pepper-not-returned",
    RAVENOS_CUSTOMER_DB: { prepare() {}, batch() {} },
  };
}

class MemoryIdentityStore {
  constructor() {
    this.authStates = new Map();
    this.identities = new Map();
    this.sessions = new Map();
    this.events = [];
    this.rateAttempts = 0;
  }

  async rateLimit() {
    this.rateAttempts += 1;
    return { allowed: this.rateAttempts <= 20, retry_after_seconds: 900 };
  }

  async createAuthState(record) {
    this.authStates.set(record.state_hash, { ...record, consumed_at: null });
  }

  async consumeAuthState(hash, now) {
    const row = this.authStates.get(hash);
    if (!row || row.consumed_at || row.expires_at <= now) return null;
    row.consumed_at = now;
    return { ...row };
  }

  async redactAuthState(hash) {
    const row = this.authStates.get(hash);
    if (row) row.code_verifier = "";
  }

  async resolveOrCreateIdentity(identity) {
    const key = `${identity.issuer}:${identity.provider_subject}`;
    let row = this.identities.get(key);
    if (!row) {
      row = {
        user_id: `usr_${"a".repeat(32)}`,
        credential_id: `crd_${"b".repeat(24)}`,
        state: "active",
        primary_email: identity.email,
        display_name: identity.display_name,
        user_created_at: identity.now,
        created: true,
      };
      this.identities.set(key, row);
    }
    return { ...row };
  }

  async createSession(record) {
    this.sessions.set(record.session_verifier, { ...record, user_state: "active", primary_email: "raven@example.com", display_name: "Raven Trader", user_created_at: record.created_at, revoked_at: null });
  }

  async findSession(verifier) {
    const row = this.sessions.get(verifier);
    return row ? { ...row } : null;
  }

  async touchSession(publicId, now, idleExpiresAt, csrfVerifier = null) {
    const row = [...this.sessions.values()].find((candidate) => candidate.session_public_id === publicId);
    if (!row) return;
    row.last_seen_at = now;
    row.idle_expires_at = idleExpiresAt;
    if (csrfVerifier) row.csrf_verifier = csrfVerifier;
  }

  async revokeSession(publicId, userId, now, reason) {
    const row = [...this.sessions.values()].find((candidate) => candidate.session_public_id === publicId && candidate.user_id === userId && !candidate.revoked_at);
    if (!row) return false;
    row.revoked_at = now;
    row.revocation_reason = reason;
    return true;
  }

  async listSessions(userId, now) {
    return [...this.sessions.values()].filter((row) => row.user_id === userId && !row.revoked_at && row.idle_expires_at > now && row.absolute_expires_at > now).map((row) => ({ ...row }));
  }

  async recordEvent(event) {
    this.events.push({ ...event });
  }
}

function request(path, init = {}) {
  return new Request(`${ORIGIN}${path}`, init);
}

function stateCookie(response) {
  const header = response.headers.get("set-cookie") || "";
  return header.match(/__Host-ravenos_auth_state=([^;,]+)/)?.[1] || "";
}

function sessionCookies(response) {
  const header = response.headers.get("set-cookie") || "";
  return {
    session: header.match(/__Host-ravenos_session=([^;,]+)/)?.[1] || "",
    csrf: header.match(/__Host-ravenos_csrf=([^;,]+)/)?.[1] || "",
    header,
  };
}

async function startFlow(store, { provider = "google", intent = "sign_up" } = {}) {
  const body = new URLSearchParams({ provider, intent, return_to: "/account/" });
  const response = await routeCustomerIdentity(request("/api/v1/auth/start", {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      "content-type": "application/x-www-form-urlencoded",
      "cf-connecting-ip": "203.0.113.4",
    },
    body,
  }), configuredEnv(), { store, nowMs: NOW_MS });
  return response;
}

async function startJsonFlow(store, { provider = "google", intent = "sign_up" } = {}) {
  return routeCustomerIdentity(request("/api/v1/auth/start", {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      "cf-connecting-ip": "203.0.113.4",
    },
    body: JSON.stringify({ provider, intent, return_to: "/account/" }),
  }), configuredEnv(), { store, nowMs: NOW_MS });
}

async function finishFlow(store, start, fetchImpl = async () => new Response(JSON.stringify({
  user: {
    id: "user_01RAVENOS",
    email: "raven@example.com",
    email_verified: true,
    first_name: "Raven",
    last_name: "Trader",
  },
  authentication_method: "GoogleOAuth",
  access_token: "must_be_discarded",
  refresh_token: "must_be_discarded",
}), { headers: { "content-type": "application/json" } }), existingSession = "") {
  const location = new URL(start.headers.get("location"));
  const state = location.searchParams.get("state");
  const cookieHeader = [
    `__Host-ravenos_auth_state=${stateCookie(start)}`,
    existingSession ? `__Host-ravenos_session=${existingSession}` : "",
  ].filter(Boolean).join("; ");
  return routeCustomerIdentity(request(`/api/v1/auth/callback?code=one_time_code&state=${encodeURIComponent(state)}`, {
    headers: { cookie: cookieHeader, "user-agent": "Mozilla/5.0 (Macintosh) AppleWebKit Safari/605.1.15" },
  }), configuredEnv(), { store, nowMs: NOW_MS + 1_000, fetchImpl });
}

test("managed account configuration is fail closed and keeps wallets separate", () => {
  const disabled = publicCustomerIdentityConfig({}, "https://ravenos.xyz/account/");
  assert.equal(disabled.available, false);
  const enabled = publicCustomerIdentityConfig(configuredEnv(), `${ORIGIN}/account/`);
  assert.equal(enabled.methods.google, true);
  assert.equal(enabled.methods.password, true);
  assert.equal(enabled.methods.magic_auth, true);
  assert.equal(enabled.methods.passkey, false);
  assert.equal(disabled.account_model.wallet_connection_is_sign_in, false);
  assert.equal(disabled.execution_boundary.transaction_signing_available, false);
  assert.equal(customerIdentityConfigured(configuredEnv()), true);
  assert.equal(CustomerIdentityContract.idle_timeout_seconds, 1800);
  assert.equal(CustomerIdentityContract.absolute_timeout_seconds, 43200);
  assert.equal(CustomerIdentityContract.wallet_connection_is_authentication, false);
});

test("auth start uses exact Origin, PKCE, state, bounded return paths, and no session cookie", async () => {
  const store = new MemoryIdentityStore();
  const rejected = await routeCustomerIdentity(request("/api/v1/auth/start", {
    method: "POST",
    headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site", "content-type": "application/x-www-form-urlencoded" },
    body: "provider=google",
  }), configuredEnv(), { store, nowMs: NOW_MS });
  assert.equal(rejected.status, 403);

  const response = await startFlow(store);
  assert.equal(response.status, 303);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.origin, "https://api.workos.com");
  assert.equal(location.pathname, "/user_management/authorize");
  assert.equal(location.searchParams.get("provider"), "GoogleOAuth");
  assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  assert.match(location.searchParams.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
  assert.match(location.searchParams.get("state"), /^ast_/);
  const setCookie = response.headers.get("set-cookie") || "";
  assert.match(setCookie, /__Host-ravenos_auth_state=/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert(!setCookie.includes("__Host-ravenos_session="));
  assert.equal(store.authStates.size, 1);
});

test("JavaScript auth start returns only a bounded authorization navigation and state cookie", async () => {
  const store = new MemoryIdentityStore();
  const response = await startJsonFlow(store, { provider: "managed", intent: "sign_in" });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") || "", /no-store/);
  assert.match(response.headers.get("set-cookie") || "", /__Host-ravenos_auth_state=/);
  const payload = await response.json();
  const authorization = new URL(payload.authorization_url);
  assert.equal(authorization.origin, "https://api.workos.com");
  assert.equal(authorization.searchParams.get("provider"), "authkit");
  assert.equal(authorization.searchParams.get("screen_hint"), "sign-in");
  assert(!JSON.stringify(payload).includes("code_verifier"));
  assert(!JSON.stringify(payload).includes("session"));
});

test("verified provider callback creates an opaque Raven account and revocable server session", async () => {
  const store = new MemoryIdentityStore();
  const start = await startFlow(store);
  const callback = await finishFlow(store, start);
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.get("location"), `${ORIGIN}/account/?auth=success`);
  const cookies = sessionCookies(callback);
  assert.match(cookies.session, /^ses_/);
  assert.match(cookies.csrf, /^csrf_/);
  assert.match(cookies.header, /__Host-ravenos_session=.*HttpOnly/);
  assert(!cookies.header.includes("must_be_discarded"));
  assert.equal(store.identities.size, 1);
  assert.equal(store.sessions.size, 1);
  const stored = [...store.sessions.values()][0];
  assert.notEqual(stored.session_verifier, cookies.session);
  assert.equal(stored.session_verifier, await sha256(cookies.session));
  assert.equal(stored.authentication_strength, "federated");
  assert.equal([...store.authStates.values()][0].code_verifier, "");

  const session = await routeCustomerIdentity(request("/api/v1/auth/session", {
    headers: { cookie: `__Host-ravenos_session=${cookies.session}; __Host-ravenos_csrf=${cookies.csrf}` },
  }), configuredEnv(), { store, nowMs: NOW_MS + 2_000 });
  assert.equal(session.status, 200);
  const payload = await session.json();
  assert.equal(payload.authenticated, true);
  assert.equal(payload.account.email, "raven@example.com");
  assert.equal(payload.session.authentication_strength, "federated");
  assert.equal(payload.wallet_linking_available, false);
  assert.equal(payload.execution_boundary.signing_available, false);
  assert(!JSON.stringify(payload).includes("usr_"));
  assert(!JSON.stringify(payload).includes("ses_"));
});

test("a completed authentication rotates an existing browser session instead of promoting or retaining it", async () => {
  const store = new MemoryIdentityStore();
  const firstCallback = await finishFlow(store, await startFlow(store));
  const firstCookies = sessionCookies(firstCallback);
  const firstSession = [...store.sessions.values()][0];

  const secondCallback = await finishFlow(store, await startFlow(store), undefined, firstCookies.session);
  const secondCookies = sessionCookies(secondCallback);
  const sessions = [...store.sessions.values()];
  const rotated = sessions.find((row) => row.session_public_id === firstSession.session_public_id);
  const replacement = sessions.find((row) => row.session_public_id !== firstSession.session_public_id);

  assert.equal(secondCallback.status, 303);
  assert.notEqual(secondCookies.session, firstCookies.session);
  assert.equal(rotated.revocation_reason, "authentication_rotated");
  assert.equal(replacement.rotation_parent_id, firstSession.session_public_id);

  const reused = await routeCustomerIdentity(request("/api/v1/auth/session", {
    headers: { cookie: `__Host-ravenos_session=${firstCookies.session}` },
  }), configuredEnv(), { store, nowMs: NOW_MS + 2_000 });
  assert.equal((await reused.json()).authenticated, false);
});

test("logout rejects CSRF and cross-site attempts, then revokes before clearing cookies", async () => {
  const store = new MemoryIdentityStore();
  const callback = await finishFlow(store, await startFlow(store));
  const cookies = sessionCookies(callback);
  const baseHeaders = {
    cookie: `__Host-ravenos_session=${cookies.session}; __Host-ravenos_csrf=${cookies.csrf}`,
    origin: ORIGIN,
    "sec-fetch-site": "same-origin",
    "content-type": "application/json",
  };
  const wrongCsrf = await routeCustomerIdentity(request("/api/v1/auth/logout", {
    method: "POST",
    headers: { ...baseHeaders, "x-ravenos-csrf": "csrf_wrong" },
    body: "{}",
  }), configuredEnv(), { store, nowMs: NOW_MS + 3_000 });
  assert.equal(wrongCsrf.status, 403);
  assert.equal(store.events.at(-1).event_type, "csrf_rejected");

  const crossSite = await routeCustomerIdentity(request("/api/v1/auth/logout", {
    method: "POST",
    headers: { ...baseHeaders, origin: "https://evil.example", "sec-fetch-site": "cross-site", "x-ravenos-csrf": cookies.csrf },
    body: "{}",
  }), configuredEnv(), { store, nowMs: NOW_MS + 3_000 });
  assert.equal(crossSite.status, 403);

  const logout = await routeCustomerIdentity(request("/api/v1/auth/logout", {
    method: "POST",
    headers: { ...baseHeaders, "x-ravenos-csrf": cookies.csrf },
    body: "{}",
  }), configuredEnv(), { store, nowMs: NOW_MS + 3_000 });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie") || "", /Max-Age=0/);
  assert.equal([...store.sessions.values()][0].revocation_reason, "logout");

  const reused = await routeCustomerIdentity(request("/api/v1/auth/session", { headers: { cookie: `__Host-ravenos_session=${cookies.session}` } }), configuredEnv(), { store, nowMs: NOW_MS + 4_000 });
  assert.equal((await reused.json()).authenticated, false);
});

test("expired sessions and cross-user session IDs fail closed", async () => {
  const store = new MemoryIdentityStore();
  const callback = await finishFlow(store, await startFlow(store));
  const cookies = sessionCookies(callback);
  const expired = await routeCustomerIdentity(request("/api/v1/auth/session", { headers: { cookie: `__Host-ravenos_session=${cookies.session}` } }), configuredEnv(), { store, nowMs: NOW_MS + 43_300_000 });
  assert.equal((await expired.json()).authenticated, false);
  assert.equal([...store.sessions.values()][0].revocation_reason, "expired");

  const secondStore = new MemoryIdentityStore();
  const secondCallback = await finishFlow(secondStore, await startFlow(secondStore));
  const secondCookies = sessionCookies(secondCallback);
  const missing = await routeCustomerIdentity(request(`/api/v1/sessions/sespub_${"z".repeat(24)}`, {
    method: "DELETE",
    headers: {
      cookie: `__Host-ravenos_session=${secondCookies.session}; __Host-ravenos_csrf=${secondCookies.csrf}`,
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      "x-ravenos-csrf": secondCookies.csrf,
    },
    body: "{}",
  }), configuredEnv(), { store: secondStore, nowMs: NOW_MS + 2_000 });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, "session_not_found");
});

test("callback failures use one generic redirect and never reveal account existence", async () => {
  const store = new MemoryIdentityStore();
  const start = await startFlow(store);
  const goodState = new URL(start.headers.get("location")).searchParams.get("state");
  const wrongState = await routeCustomerIdentity(request("/api/v1/auth/callback?code=x&state=ast_wrong", { headers: { cookie: `__Host-ravenos_auth_state=${goodState}` } }), configuredEnv(), { store, nowMs: NOW_MS + 1_000 });
  assert.equal(wrongState.headers.get("location"), `${ORIGIN}/account/?auth=failed`);

  const providerFailure = await finishFlow(store, start, async () => new Response(JSON.stringify({ error: "invalid_grant", email_exists: true }), { status: 401 }));
  assert.equal(providerFailure.headers.get("location"), `${ORIGIN}/account/?auth=failed`);
  assert(!String(providerFailure.headers.get("location")).includes("email"));
});

test("account client never stores session, CSRF, email, or wallet identity in browser storage", async () => {
  const source = await import("node:fs").then(({ readFileSync }) => readFileSync("ravenos-account.js", "utf8"));
  assert(!source.includes("localStorage"));
  assert(!source.includes("sessionStorage"));
  assert(!source.includes("document.cookie"));
  assert.match(source, /walletConnectionIsAuthentication: false/);
  assert.match(source, /signingAvailable: false/);
  assert.match(source, /submissionAvailable: false/);
});
