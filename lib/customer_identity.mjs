const AUTH_SCHEMA = "ravenos.customer_auth.v1";
const SESSION_COOKIE = "__Host-ravenos_session";
const CSRF_COOKIE = "__Host-ravenos_csrf";
const AUTH_STATE_COOKIE = "__Host-ravenos_auth_state";
const SESSION_IDLE_SECONDS = 30 * 60;
const SESSION_ABSOLUTE_SECONDS = 12 * 60 * 60;
const RECENT_AUTH_SECONDS = 5 * 60;
const AUTH_STATE_SECONDS = 10 * 60;
const textEncoder = new TextEncoder();

function clean(value, max = 256) {
  return String(value ?? "").trim().slice(0, max);
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function randomOpaqueId(prefix, byteLength) {
  return `${prefix}${base64Url(randomBytes(byteLength))}`;
}

export async function sha256(value) {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(String(value)))));
}

async function hmacSha256(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(String(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, textEncoder.encode(String(value)))));
}

function constantTimeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a.charCodeAt(index % Math.max(1, a.length)) || 0) ^ (b.charCodeAt(index % Math.max(1, b.length)) || 0);
  }
  return mismatch === 0;
}

function parseCookies(request) {
  const values = {};
  for (const pair of String(request.headers.get("cookie") || "").split(";")) {
    const index = pair.indexOf("=");
    if (index < 1) continue;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (key && !(key in values)) values[key] = value;
  }
  return values;
}

function cookie(name, value, { httpOnly = true, maxAge = SESSION_ABSOLUTE_SECONDS } = {}) {
  return [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
    "Secure",
    httpOnly ? "HttpOnly" : "",
    "SameSite=Lax",
  ].filter(Boolean).join("; ");
}

function clearCookie(name, { httpOnly = true } = {}) {
  return cookie(name, "", { httpOnly, maxAge: 0 });
}

function responseHeaders(extra = {}) {
  return new Headers({
    "cache-control": "no-store, max-age=0",
    pragma: "no-cache",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    vary: "Cookie",
    ...extra,
  });
}

function json(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status || 200,
    headers: responseHeaders(init.headers || {}),
  });
}

function redirect(location, { status = 303, cookies = [] } = {}) {
  const headers = responseHeaders({ location });
  headers.delete("content-type");
  for (const value of cookies) headers.append("set-cookie", value);
  return new Response(null, { status, headers });
}

function originFromEnv(env) {
  try {
    const value = new URL(clean(env.RAVENOS_AUTH_ORIGIN, 300));
    if (value.protocol !== "https:" || value.pathname !== "/") return null;
    return value.origin;
  } catch {
    return null;
  }
}

function redirectUriFromEnv(env, origin) {
  try {
    const value = new URL(clean(env.RAVENOS_AUTH_REDIRECT_URI, 400) || `${origin}/api/v1/auth/callback`);
    if (value.origin !== origin || value.pathname !== "/api/v1/auth/callback" || value.search || value.hash) return null;
    return value.toString();
  } catch {
    return null;
  }
}

export function customerIdentityConfigured(env = {}) {
  const origin = originFromEnv(env);
  return env.RAVENOS_CUSTOMER_ACCOUNTS_ENABLE === "1"
    && Boolean(origin)
    && Boolean(redirectUriFromEnv(env, origin))
    && Boolean(clean(env.WORKOS_CLIENT_ID, 200))
    && Boolean(clean(env.WORKOS_API_KEY, 300))
    && Boolean(clean(env.RAVENOS_AUTH_HASH_PEPPER, 300))
    && Boolean(env.RAVENOS_CUSTOMER_DB?.prepare && env.RAVENOS_CUSTOMER_DB?.batch);
}

export function publicCustomerIdentityConfig(env = {}, requestUrl = "https://ravenos.xyz/") {
  const requestOrigin = new URL(requestUrl).origin;
  const canonicalOrigin = originFromEnv(env);
  const available = customerIdentityConfigured(env);
  return {
    ok: true,
    schema_version: AUTH_SCHEMA,
    available,
    state: available ? "available" : "activation_pending",
    canonical_origin: canonicalOrigin,
    current_origin: requestOrigin,
    on_authenticated_origin: Boolean(available && canonicalOrigin === requestOrigin),
    methods: {
      google: available,
      email: available,
      passkey: available,
    },
    account_model: {
      principal: "ravenos_account",
      wallet_connection_is_sign_in: false,
      wallet_linking_available: false,
      wallet_linking_stage: "after_account_sign_in",
    },
    execution_boundary: {
      wallet_signature_for_authentication: false,
      transaction_signing_available: false,
      submission_available: false,
    },
  };
}

function safeReturnTo(value) {
  const path = clean(value || "/account/", 300);
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || /[\r\n]/.test(path)) return "/account/";
  try {
    const parsed = new URL(path, "https://ravenos.invalid");
    if (parsed.origin !== "https://ravenos.invalid" || parsed.pathname.startsWith("/api/")) return "/account/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/account/";
  }
}

function requestBoundaryOk(request, expectedOrigin) {
  if (request.headers.get("origin") !== expectedOrigin) return false;
  const fetchSite = clean(request.headers.get("sec-fetch-site"), 32).toLowerCase();
  return !fetchSite || fetchSite === "same-origin";
}

function requestIpPrefix(request) {
  const value = clean(request.headers.get("cf-connecting-ip"), 96);
  if (!value) return "unavailable";
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return value.split(".").slice(0, 3).join(".");
  if (value.includes(":")) return value.split(":").slice(0, 4).join(":");
  return "unavailable";
}

async function boundedBody(request, maxBytes = 4096) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error("request_too_large");
  const text = await request.text();
  if (textEncoder.encode(text).byteLength > maxBytes) throw new Error("request_too_large");
  const type = clean(request.headers.get("content-type"), 100).toLowerCase();
  if (type.startsWith("application/json")) return JSON.parse(text || "{}");
  if (type.startsWith("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(text));
  throw new Error("content_type_invalid");
}

function normalizeAuthenticationMethod(value) {
  const allowed = new Set(["Passkey", "GoogleOAuth", "MicrosoftOAuth", "AppleOAuth", "Password", "MagicAuth", "SSO"]);
  const method = clean(value, 40);
  return allowed.has(method) ? method : "ManagedIdentity";
}

function authenticationStrength(method) {
  if (method === "Passkey") return "phishing_resistant";
  if (["GoogleOAuth", "MicrosoftOAuth", "AppleOAuth", "SSO"].includes(method)) return "federated";
  if (method === "MagicAuth") return "email_possession";
  return "single_factor";
}

function deviceLabel(request) {
  const ua = clean(request.headers.get("user-agent"), 300).toLowerCase();
  const browser = ua.includes("edg/") ? "Edge" : ua.includes("firefox/") ? "Firefox" : ua.includes("chrome/") || ua.includes("crios/") ? "Chrome" : ua.includes("safari/") ? "Safari" : "Browser";
  const platform = ua.includes("iphone") || ua.includes("ipad") ? "iOS" : ua.includes("android") ? "Android" : ua.includes("mac os") ? "macOS" : ua.includes("windows") ? "Windows" : ua.includes("linux") ? "Linux" : "device";
  return `${browser} on ${platform}`.slice(0, 80);
}

function publicProfile(row) {
  return {
    display_name: clean(row.display_name, 120) || null,
    email: clean(row.primary_email, 254),
    member_since: new Date(Number(row.user_created_at || row.created_at) * 1000).toISOString(),
  };
}

function publicSession(row, currentSessionPublicId = "") {
  return {
    session_public_id: row.session_public_id,
    current: row.session_public_id === currentSessionPublicId,
    device_label: row.device_label,
    authenticated_at: new Date(Number(row.authenticated_at) * 1000).toISOString(),
    last_seen_at: new Date(Number(row.last_seen_at) * 1000).toISOString(),
    expires_at: new Date(Math.min(Number(row.idle_expires_at), Number(row.absolute_expires_at)) * 1000).toISOString(),
    authentication_methods: JSON.parse(row.authentication_methods || "[]"),
    authentication_strength: row.authentication_strength,
  };
}

export function createD1CustomerIdentityStore(db) {
  return {
    async rateLimit({ rateKey, action, now, windowSeconds, limit }) {
      await db.batch([
        db.prepare("DELETE FROM ravenos_auth_states WHERE expires_at <= ?").bind(now - 24 * 60 * 60),
        db.prepare("DELETE FROM ravenos_auth_rate_limits WHERE expires_at <= ?").bind(now),
      ]);
      const resetBefore = now - windowSeconds;
      const row = await db.prepare(`
        INSERT INTO ravenos_auth_rate_limits (rate_key, action, window_started_at, attempt_count, expires_at)
        VALUES (?, ?, ?, 1, ?)
        ON CONFLICT(rate_key, action) DO UPDATE SET
          attempt_count = CASE WHEN ravenos_auth_rate_limits.window_started_at <= ? THEN 1 ELSE ravenos_auth_rate_limits.attempt_count + 1 END,
          window_started_at = CASE WHEN ravenos_auth_rate_limits.window_started_at <= ? THEN excluded.window_started_at ELSE ravenos_auth_rate_limits.window_started_at END,
          expires_at = excluded.expires_at
        RETURNING attempt_count, window_started_at
      `).bind(rateKey, action, now, now + windowSeconds, resetBefore, resetBefore).first();
      return { allowed: Number(row?.attempt_count || 1) <= limit, retry_after_seconds: windowSeconds };
    },

    async createAuthState(record) {
      await db.prepare(`
        INSERT INTO ravenos_auth_states
          (state_hash, code_verifier, provider, intent, return_to, created_at, expires_at, consumed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
      `).bind(record.state_hash, record.code_verifier, record.provider, record.intent, record.return_to, record.created_at, record.expires_at).run();
    },

    async consumeAuthState(stateHash, now) {
      return db.prepare(`
        UPDATE ravenos_auth_states
        SET consumed_at = ?
        WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > ?
        RETURNING state_hash, code_verifier, provider, intent, return_to, created_at, expires_at, consumed_at
      `).bind(now, stateHash, now).first();
    },

    async redactAuthState(stateHash) {
      await db.prepare("UPDATE ravenos_auth_states SET code_verifier = '' WHERE state_hash = ?").bind(stateHash).run();
    },

    async resolveOrCreateIdentity(identity) {
      const find = () => db.prepare(`
        SELECT c.credential_id, c.user_id, u.state, u.primary_email, u.display_name, u.created_at AS user_created_at
        FROM ravenos_credentials c
        JOIN ravenos_users u ON u.user_id = c.user_id
        WHERE c.issuer = ? AND c.provider_subject = ? AND c.revoked_at IS NULL
        LIMIT 1
      `).bind(identity.issuer, identity.provider_subject).first();
      let row = await find();
      let created = false;
      if (!row) {
        const userId = randomOpaqueId("usr_", 24);
        const credentialId = randomOpaqueId("crd_", 18);
        try {
          await db.batch([
            db.prepare(`INSERT INTO ravenos_users (user_id, state, primary_email, display_name, created_at, updated_at, last_authenticated_at) VALUES (?, 'active', ?, ?, ?, ?, ?)`)
              .bind(userId, identity.email, identity.display_name, identity.now, identity.now, identity.now),
            db.prepare(`INSERT INTO ravenos_credentials (credential_id, user_id, issuer, provider_subject, authentication_method, email_verified, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
              .bind(credentialId, userId, identity.issuer, identity.provider_subject, identity.authentication_method, identity.now, identity.now),
            db.prepare(`INSERT INTO ravenos_security_events (audit_id, event_type, user_id, outcome, reason_code, created_at) VALUES (?, 'account_created', ?, 'success', 'managed_identity_verified', ?)`)
              .bind(randomOpaqueId("aud_", 18), userId, identity.now),
          ]);
          created = true;
        } catch {
          // A concurrent callback may have won the unique provider identity.
        }
        row = await find();
        if (!row) throw new Error("identity_resolution_failed");
      }
      await db.batch([
        db.prepare("UPDATE ravenos_users SET primary_email = ?, display_name = ?, updated_at = ?, last_authenticated_at = ? WHERE user_id = ?")
          .bind(identity.email, identity.display_name, identity.now, identity.now, row.user_id),
        db.prepare("UPDATE ravenos_credentials SET authentication_method = ?, last_used_at = ? WHERE credential_id = ?")
          .bind(identity.authentication_method, identity.now, row.credential_id),
      ]);
      return { ...row, primary_email: identity.email, display_name: identity.display_name, created };
    },

    async createSession(record) {
      await db.batch([
        db.prepare(`
          INSERT INTO ravenos_sessions
            (session_public_id, session_verifier, csrf_verifier, user_id, credential_id, created_at, authenticated_at, last_seen_at,
             idle_expires_at, absolute_expires_at, authentication_methods, authentication_strength, device_label, risk_state, rotation_parent_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'normal', ?)
        `).bind(
          record.session_public_id, record.session_verifier, record.csrf_verifier, record.user_id, record.credential_id,
          record.created_at, record.authenticated_at, record.last_seen_at, record.idle_expires_at, record.absolute_expires_at,
          record.authentication_methods, record.authentication_strength, record.device_label, record.rotation_parent_id,
        ),
        db.prepare(`INSERT INTO ravenos_security_events (audit_id, event_type, user_id, session_public_id, outcome, reason_code, created_at) VALUES (?, 'authentication_succeeded', ?, ?, 'success', ?, ?)`)
          .bind(randomOpaqueId("aud_", 18), record.user_id, record.session_public_id, record.authentication_strength, record.created_at),
      ]);
    },

    async findSession(sessionVerifier) {
      return db.prepare(`
        SELECT s.*, u.state AS user_state, u.primary_email, u.display_name, u.created_at AS user_created_at
        FROM ravenos_sessions s
        JOIN ravenos_users u ON u.user_id = s.user_id
        WHERE s.session_verifier = ?
        LIMIT 1
      `).bind(sessionVerifier).first();
    },

    async touchSession(sessionPublicId, now, idleExpiresAt, csrfVerifier = null) {
      if (csrfVerifier) {
        await db.prepare("UPDATE ravenos_sessions SET last_seen_at = ?, idle_expires_at = ?, csrf_verifier = ? WHERE session_public_id = ? AND revoked_at IS NULL")
          .bind(now, idleExpiresAt, csrfVerifier, sessionPublicId).run();
      } else {
        await db.prepare("UPDATE ravenos_sessions SET last_seen_at = ?, idle_expires_at = ? WHERE session_public_id = ? AND revoked_at IS NULL")
          .bind(now, idleExpiresAt, sessionPublicId).run();
      }
    },

    async revokeSession(sessionPublicId, userId, now, reason) {
      const result = await db.prepare("UPDATE ravenos_sessions SET revoked_at = ?, revocation_reason = ? WHERE session_public_id = ? AND user_id = ? AND revoked_at IS NULL")
        .bind(now, clean(reason, 80), sessionPublicId, userId).run();
      return Number(result?.meta?.changes || 0) === 1;
    },

    async listSessions(userId, now) {
      const result = await db.prepare(`
        SELECT session_public_id, device_label, authenticated_at, last_seen_at, idle_expires_at, absolute_expires_at,
               authentication_methods, authentication_strength
        FROM ravenos_sessions
        WHERE user_id = ? AND revoked_at IS NULL AND idle_expires_at > ? AND absolute_expires_at > ?
        ORDER BY last_seen_at DESC LIMIT 20
      `).bind(userId, now, now).all();
      return Array.isArray(result?.results) ? result.results : [];
    },

    async recordEvent(event) {
      await db.prepare(`INSERT INTO ravenos_security_events (audit_id, event_type, user_id, session_public_id, outcome, reason_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(randomOpaqueId("aud_", 18), clean(event.event_type, 80), event.user_id || null, event.session_public_id || null, clean(event.outcome, 20), clean(event.reason_code, 80) || null, event.created_at).run();
    },
  };
}

async function rateLimit(store, env, request, action, now) {
  const key = await hmacSha256(env.RAVENOS_AUTH_HASH_PEPPER, `${action}:${requestIpPrefix(request)}`);
  return store.rateLimit({ rateKey: key, action, now, windowSeconds: 15 * 60, limit: action === "auth_start" ? 20 : 30 });
}

function authorizationUrl(env, { state, codeChallenge, provider, intent }) {
  const origin = originFromEnv(env);
  const url = new URL("https://api.workos.com/user_management/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clean(env.WORKOS_CLIENT_ID, 200));
  url.searchParams.set("redirect_uri", redirectUriFromEnv(env, origin));
  url.searchParams.set("state", state);
  url.searchParams.set("provider", provider);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (provider === "authkit") url.searchParams.set("screen_hint", intent === "sign_up" ? "sign-up" : "sign-in");
  return url.toString();
}

async function exchangeManagedIdentity(env, state, code, fetchImpl) {
  const response = await fetchImpl("https://api.workos.com/user_management/authenticate", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_id: clean(env.WORKOS_CLIENT_ID, 200),
      client_secret: clean(env.WORKOS_API_KEY, 300),
      grant_type: "authorization_code",
      code,
      code_verifier: state.code_verifier,
    }),
    signal: AbortSignal.timeout(8_000),
  });
  const payload = await response.json().catch(() => null);
  const user = payload?.user;
  if (!response.ok || !user || payload?.impersonator || user.email_verified !== true) throw new Error("managed_identity_rejected");
  const providerSubject = clean(user.id, 160);
  const email = clean(user.email, 254).toLowerCase();
  if (!/^user_[A-Za-z0-9_]+$/.test(providerSubject) || !email || !email.includes("@")) throw new Error("managed_identity_invalid");
  return {
    issuer: "https://api.workos.com/user_management",
    provider_subject: providerSubject,
    email,
    display_name: clean([user.first_name, user.last_name].filter(Boolean).join(" "), 120) || email.split("@")[0].slice(0, 80),
    authentication_method: normalizeAuthenticationMethod(payload.authentication_method),
  };
}

async function resolveSession(request, store, now, { touch = true } = {}) {
  const cookies = parseCookies(request);
  const rawSession = clean(cookies[SESSION_COOKIE], 180);
  if (!rawSession.startsWith("ses_") || rawSession.length < 40) return { authenticated: false };
  const row = await store.findSession(await sha256(rawSession));
  if (!row || row.revoked_at || row.user_state !== "active") return { authenticated: false };
  if (Number(row.idle_expires_at) <= now || Number(row.absolute_expires_at) <= now) {
    await store.revokeSession(row.session_public_id, row.user_id, now, "expired");
    return { authenticated: false, clear: true };
  }
  let csrfToken = clean(cookies[CSRF_COOKIE], 180);
  let csrfRotated = false;
  if (!csrfToken || !constantTimeEqual(await sha256(csrfToken), row.csrf_verifier)) {
    csrfToken = randomOpaqueId("csrf_", 32);
    row.csrf_verifier = await sha256(csrfToken);
    csrfRotated = true;
  }
  const idleExpiresAt = Math.min(now + SESSION_IDLE_SECONDS, Number(row.absolute_expires_at));
  if (touch && (csrfRotated || now - Number(row.last_seen_at) >= 60)) {
    await store.touchSession(row.session_public_id, now, idleExpiresAt, csrfRotated ? row.csrf_verifier : null);
    row.last_seen_at = now;
    row.idle_expires_at = idleExpiresAt;
  }
  return { authenticated: true, row, csrfToken, csrfRotated };
}

function unauthenticatedResponse({ clear = false } = {}) {
  const headers = responseHeaders();
  if (clear) {
    headers.append("set-cookie", clearCookie(SESSION_COOKIE));
    headers.append("set-cookie", clearCookie(CSRF_COOKIE, { httpOnly: false }));
  }
  return new Response(JSON.stringify({ ok: true, schema_version: AUTH_SCHEMA, authenticated: false }), { status: 200, headers });
}

function configuredStore(env, deps) {
  return deps.store || createD1CustomerIdentityStore(env.RAVENOS_CUSTOMER_DB);
}

async function handleAuthStart(request, env, store, now) {
  const expectedOrigin = originFromEnv(env);
  if (!requestBoundaryOk(request, expectedOrigin)) return json({ ok: false, error: "request_not_allowed" }, { status: 403 });
  const limited = await rateLimit(store, env, request, "auth_start", now);
  if (!limited.allowed) return json({ ok: false, error: "try_again_later" }, { status: 429, headers: { "retry-after": String(limited.retry_after_seconds) } });
  let body;
  try {
    body = await boundedBody(request, 4096);
  } catch {
    return json({ ok: false, error: "request_invalid" }, { status: 400 });
  }
  const intent = body.intent === "sign_in" ? "sign_in" : "sign_up";
  const provider = body.provider === "google" ? "GoogleOAuth" : "authkit";
  const returnTo = safeReturnTo(body.return_to);
  const state = randomOpaqueId("ast_", 32);
  const verifier = base64Url(randomBytes(48));
  const stateHash = await sha256(state);
  await store.createAuthState({
    state_hash: stateHash,
    code_verifier: verifier,
    provider,
    intent,
    return_to: returnTo,
    created_at: now,
    expires_at: now + AUTH_STATE_SECONDS,
  });
  const authorization = authorizationUrl(env, {
    state,
    codeChallenge: await sha256(verifier),
    provider,
    intent,
  });
  const stateCookie = cookie(AUTH_STATE_COOKIE, state, { maxAge: AUTH_STATE_SECONDS });
  if (clean(request.headers.get("content-type"), 100).toLowerCase().startsWith("application/json")) {
    return json({ ok: true, schema_version: AUTH_SCHEMA, authorization_url: authorization }, {
      headers: { "set-cookie": stateCookie },
    });
  }
  return redirect(authorization, { cookies: [stateCookie] });
}

async function handleAuthCallback(request, env, store, now, fetchImpl) {
  const url = new URL(request.url);
  const origin = originFromEnv(env);
  const cookies = parseCookies(request);
  const state = clean(url.searchParams.get("state"), 180);
  const code = clean(url.searchParams.get("code"), 300);
  const expectedState = clean(cookies[AUTH_STATE_COOKIE], 180);
  const failure = () => redirect(`${origin}/account/?auth=failed`, { cookies: [clearCookie(AUTH_STATE_COOKIE)] });
  if (!state || !code || !expectedState || !constantTimeEqual(state, expectedState)) return failure();
  const stateHash = await sha256(state);
  const authState = await store.consumeAuthState(stateHash, now);
  if (!authState) return failure();
  try {
    const identity = await exchangeManagedIdentity(env, authState, code, fetchImpl);
    const account = await store.resolveOrCreateIdentity({ ...identity, now });
    if (account.state !== "active") return failure();
    const previousSession = await resolveSession(request, store, now, { touch: false });
    const rawSession = randomOpaqueId("ses_", 32);
    const csrfToken = randomOpaqueId("csrf_", 32);
    const sessionPublicId = randomOpaqueId("sespub_", 18);
    const method = identity.authentication_method;
    await store.createSession({
      session_public_id: sessionPublicId,
      session_verifier: await sha256(rawSession),
      csrf_verifier: await sha256(csrfToken),
      user_id: account.user_id,
      credential_id: account.credential_id,
      created_at: now,
      authenticated_at: now,
      last_seen_at: now,
      idle_expires_at: now + SESSION_IDLE_SECONDS,
      absolute_expires_at: now + SESSION_ABSOLUTE_SECONDS,
      authentication_methods: JSON.stringify([method]),
      authentication_strength: authenticationStrength(method),
      device_label: deviceLabel(request),
      rotation_parent_id: previousSession.authenticated && previousSession.row.user_id === account.user_id
        ? previousSession.row.session_public_id
        : null,
    });
    if (previousSession.authenticated) {
      await store.revokeSession(previousSession.row.session_public_id, previousSession.row.user_id, now, "authentication_rotated");
      await store.recordEvent({
        event_type: "session_rotated",
        user_id: previousSession.row.user_id,
        session_public_id: previousSession.row.session_public_id,
        outcome: "success",
        reason_code: "authentication_completed",
        created_at: now,
      }).catch(() => {});
    }
    const target = safeReturnTo(authState.return_to);
    const separator = target.includes("?") ? "&" : "?";
    return redirect(`${origin}${target}${separator}auth=success`, {
      cookies: [
        clearCookie(AUTH_STATE_COOKIE),
        cookie(SESSION_COOKIE, rawSession),
        cookie(CSRF_COOKIE, csrfToken, { httpOnly: false }),
      ],
    });
  } catch {
    return failure();
  } finally {
    await store.redactAuthState(stateHash).catch(() => {});
  }
}

async function handleSession(request, store, now) {
  const session = await resolveSession(request, store, now);
  if (!session.authenticated) return unauthenticatedResponse({ clear: session.clear });
  const headers = responseHeaders();
  if (session.csrfRotated) headers.append("set-cookie", cookie(CSRF_COOKIE, session.csrfToken, { httpOnly: false }));
  return new Response(JSON.stringify({
    ok: true,
    schema_version: AUTH_SCHEMA,
    authenticated: true,
    account: publicProfile(session.row),
    session: publicSession(session.row, session.row.session_public_id),
    csrf_token: session.csrfToken,
    wallet_links: [],
    wallet_linking_available: false,
    execution_boundary: { signing_available: false, submission_available: false },
  }), { status: 200, headers });
}

async function requireMutationSession(request, env, store, now) {
  const origin = originFromEnv(env);
  if (!requestBoundaryOk(request, origin)) return { response: json({ ok: false, error: "request_not_allowed" }, { status: 403 }) };
  if (!clean(request.headers.get("content-type"), 80).toLowerCase().startsWith("application/json")) {
    return { response: json({ ok: false, error: "request_invalid" }, { status: 400 }) };
  }
  const session = await resolveSession(request, store, now, { touch: false });
  if (!session.authenticated) return { response: json({ ok: false, error: "authentication_required" }, { status: 401 }) };
  const supplied = clean(request.headers.get("x-ravenos-csrf"), 180);
  if (!supplied || !constantTimeEqual(await sha256(supplied), session.row.csrf_verifier)) {
    await store.recordEvent({ event_type: "csrf_rejected", user_id: session.row.user_id, session_public_id: session.row.session_public_id, outcome: "denied", reason_code: "csrf_invalid", created_at: now });
    return { response: json({ ok: false, error: "request_not_allowed" }, { status: 403 }) };
  }
  return { session };
}

async function handleLogout(request, env, store, now) {
  const required = await requireMutationSession(request, env, store, now);
  if (required.response) return required.response;
  const row = required.session.row;
  await store.revokeSession(row.session_public_id, row.user_id, now, "logout");
  await store.recordEvent({ event_type: "session_revoked", user_id: row.user_id, session_public_id: row.session_public_id, outcome: "success", reason_code: "logout", created_at: now });
  const headers = responseHeaders();
  headers.append("set-cookie", clearCookie(SESSION_COOKIE));
  headers.append("set-cookie", clearCookie(CSRF_COOKIE, { httpOnly: false }));
  return new Response(JSON.stringify({ ok: true, schema_version: AUTH_SCHEMA, authenticated: false }), { status: 200, headers });
}

async function handleSessions(request, store, now) {
  const session = await resolveSession(request, store, now);
  if (!session.authenticated) return json({ ok: false, error: "authentication_required" }, { status: 401 });
  const rows = await store.listSessions(session.row.user_id, now);
  const headers = responseHeaders();
  if (session.csrfRotated) headers.append("set-cookie", cookie(CSRF_COOKIE, session.csrfToken, { httpOnly: false }));
  return new Response(JSON.stringify({
    ok: true,
    schema_version: "ravenos.session_inventory.v1",
    sessions: rows.map((row) => publicSession(row, session.row.session_public_id)),
    csrf_token: session.csrfToken,
  }), { status: 200, headers });
}

async function handleSessionRevoke(request, env, store, now, sessionPublicId) {
  const required = await requireMutationSession(request, env, store, now);
  if (required.response) return required.response;
  const current = required.session.row;
  const target = clean(sessionPublicId, 100);
  if (!target.startsWith("sespub_")) return json({ ok: false, error: "session_not_found" }, { status: 404 });
  const currentTarget = target === current.session_public_id;
  if (!currentTarget && now - Number(current.authenticated_at) > RECENT_AUTH_SECONDS) {
    return json({ ok: false, error: "recent_authentication_required" }, { status: 403 });
  }
  const revoked = await store.revokeSession(target, current.user_id, now, currentTarget ? "logout" : "user_revoked");
  if (!revoked) return json({ ok: false, error: "session_not_found" }, { status: 404 });
  const headers = responseHeaders();
  if (currentTarget) {
    headers.append("set-cookie", clearCookie(SESSION_COOKIE));
    headers.append("set-cookie", clearCookie(CSRF_COOKIE, { httpOnly: false }));
  }
  return new Response(JSON.stringify({ ok: true, schema_version: "ravenos.session_revocation.v1", revoked: true, current: currentTarget }), { status: 200, headers });
}

function unavailable(env, request) {
  const config = publicCustomerIdentityConfig(env, request.url);
  return json({
    ok: false,
    error: "account_activation_pending",
    customer_system: {
      state: config.state,
      canonical_origin: config.canonical_origin,
      authentication: "not_active",
      sessions: "not_active",
      wallet_linking: "not_active",
      signing: "disabled",
      submission: "disabled",
    },
  }, { status: 503 });
}

export async function routeCustomerIdentity(request, env = {}, deps = {}) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === "/api/v1/auth/config" && request.method === "GET") {
    return json(publicCustomerIdentityConfig(env, request.url));
  }
  const matchesRoute = path === "/api/v1/auth/start"
    || path === "/api/v1/auth/callback"
    || path === "/api/v1/auth/session"
    || path === "/api/v1/auth/logout"
    || path === "/api/v1/sessions"
    || path.startsWith("/api/v1/sessions/");
  if (!matchesRoute) return null;
  if (!customerIdentityConfigured(env)) return unavailable(env, request);
  const origin = originFromEnv(env);
  if (url.origin !== origin) return json({ ok: false, error: "authenticated_origin_required", canonical_origin: origin }, { status: 409 });
  const store = configuredStore(env, deps);
  const now = Math.floor((deps.nowMs ?? Date.now()) / 1000);
  const fetchImpl = deps.fetchImpl || fetch;
  try {
    if (path === "/api/v1/auth/start" && request.method === "POST") return handleAuthStart(request, env, store, now);
    if (path === "/api/v1/auth/callback" && request.method === "GET") return handleAuthCallback(request, env, store, now, fetchImpl);
    if (path === "/api/v1/auth/session" && request.method === "GET") return handleSession(request, store, now);
    if (path === "/api/v1/auth/logout" && request.method === "POST") return handleLogout(request, env, store, now);
    if (path === "/api/v1/sessions" && request.method === "GET") return handleSessions(request, store, now);
    if (path.startsWith("/api/v1/sessions/") && request.method === "DELETE") {
      return handleSessionRevoke(request, env, store, now, decodeURIComponent(path.slice("/api/v1/sessions/".length)));
    }
    return json({ ok: false, error: "method_not_allowed" }, { status: 405, headers: { allow: path === "/api/v1/auth/start" || path === "/api/v1/auth/logout" ? "POST" : "GET" } });
  } catch {
    return json({ ok: false, error: "account_service_unavailable" }, { status: 503 });
  }
}

export const CustomerIdentityContract = Object.freeze({
  schema_version: AUTH_SCHEMA,
  session_cookie: SESSION_COOKIE,
  csrf_cookie: CSRF_COOKIE,
  auth_state_cookie: AUTH_STATE_COOKIE,
  idle_timeout_seconds: SESSION_IDLE_SECONDS,
  absolute_timeout_seconds: SESSION_ABSOLUTE_SECONDS,
  recent_authentication_seconds: RECENT_AUTH_SECONDS,
  wallet_connection_is_authentication: false,
  transaction_signing_available: false,
  submission_available: false,
});
