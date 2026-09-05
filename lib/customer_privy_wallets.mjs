import { authorizeCustomerApiRequest, randomOpaqueId, sha256 } from "./customer_identity.mjs";

const SCHEMA = "ravenos.privy_wallets.v1";
const PRIVY_ISSUER = "privy.io";
const SESSION_SECONDS = 5 * 60;
const encoder = new TextEncoder();

function clean(value, max = 300) {
  return String(value ?? "").trim().slice(0, max);
}

function enabled(value) {
  return clean(value, 8) === "1";
}

function allowedUsers(value) {
  return new Set(clean(value, 8_192)
    .split(",")
    .map((entry) => clean(entry, 180))
    .filter((entry) => entry === "*" || /^usr_[A-Za-z0-9_-]{8,120}$/.test(entry)));
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function decodeBase64Url(value) {
  const input = String(value || "").replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(input.padEnd(Math.ceil(input.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function parseJson(value, maxBytes = 16_384) {
  if (typeof value !== "string" || encoder.encode(value).byteLength > maxBytes) throw new Error("payload_invalid");
  return JSON.parse(value);
}

function parseJwk(value, privateKey = false) {
  const source = clean(value, privateKey ? 8_192 : 4_096);
  if (!source) return null;
  try {
    const jwk = JSON.parse(source);
    if (jwk?.kty !== "EC" || jwk?.crv !== "P-256" || !jwk?.x || !jwk?.y) return null;
    if (privateKey && !jwk.d) return null;
    return jwk;
  } catch {
    return null;
  }
}

function validPublicJwk(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && value.kty === "EC" && value.crv === "P-256"
    && clean(value.kid, 180) && value.x && value.y
    && !value.d
    && (!value.alg || value.alg === "ES256")
    && (!value.use || value.use === "sig");
}

function parseIdentityJwks(value, legacyValue = "") {
  const source = clean(value || legacyValue, 16_384);
  if (!source) return [];
  try {
    const parsed = JSON.parse(source);
    const candidates = Array.isArray(parsed?.keys) ? parsed.keys : [parsed];
    if (!candidates.length || candidates.length > 5) return [];
    const keys = candidates.filter(validPublicJwk).map((key) => Object.freeze({ ...key }));
    if (keys.length !== candidates.length || new Set(keys.map((key) => key.kid)).size !== keys.length) return [];
    return Object.freeze(keys);
  } catch {
    return [];
  }
}

function config(env = {}) {
  const active = enabled(env.RAVENOS_PRIVY_ENABLED) && enabled(env.RAVENOS_PRIVY_WALLETS_ENABLED);
  const appId = clean(env.RAVENOS_PRIVY_APP_ID, 180);
  const publicJwk = parseJwk(env.RAVENOS_PRIVY_CUSTOM_AUTH_PUBLIC_JWK);
  const privateJwk = parseJwk(env.RAVENOS_PRIVY_CUSTOM_AUTH_PRIVATE_JWK, true);
  const identityJwks = parseIdentityJwks(env.RAVENOS_PRIVY_IDENTITY_JWKS, env.RAVENOS_PRIVY_IDENTITY_PUBLIC_JWK);
  const walletUsers = allowedUsers(env.RAVENOS_PRIVY_WALLET_USERS);
  return Object.freeze({
    active,
    app_id: appId,
    client_id: clean(env.RAVENOS_PRIVY_CLIENT_ID, 180) || null,
    solana_enabled: active && enabled(env.RAVENOS_PRIVY_SOLANA_ENABLED),
    evm_enabled: active && enabled(env.RAVENOS_PRIVY_EVM_ENABLED),
    manual_signing_enabled: active && enabled(env.RAVENOS_PRIVY_MANUAL_SIGNING_ENABLED),
    delegated_signing_enabled: false,
    default_wallet_onboarding: false,
    public_jwk: publicJwk,
    private_jwk: privateJwk,
    identity_jwks: identityJwks,
    wallet_users: walletUsers,
    configured: Boolean(active && walletUsers.size && appId && clean(env.RAVENOS_PRIVY_CLIENT_ID, 180) && publicJwk && privateJwk && identityJwks.length && env.RAVENOS_CUSTOMER_DB?.prepare),
  });
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

function json(payload, status = 200, extra = {}) {
  return new Response(JSON.stringify(payload), { status, headers: responseHeaders(extra) });
}

function publicConfig(env) {
  const value = config(env);
  return {
    ok: true,
    schema_version: SCHEMA,
    available: value.configured,
    state: value.configured ? "available" : "disabled",
    app_id: value.configured ? value.app_id : null,
    client_id: value.configured ? value.client_id : null,
    capabilities: {
      evm: value.configured && value.evm_enabled,
      solana: value.configured && value.solana_enabled,
      manual_signing: value.configured && value.manual_signing_enabled,
      delegated_signing: false,
    },
    wallets: { solana: value.solana_enabled, evm: value.evm_enabled },
    manual_signing_enabled: value.manual_signing_enabled,
    delegated_signing_enabled: false,
    default_wallet_onboarding: false,
    identity_authority: "raven_session",
  };
}

function walletUserAllowed(cfg, principal) {
  const userId = clean(principal?.user_id, 180);
  return Boolean(userId && (cfg.wallet_users.has(userId) || cfg.wallet_users.has("*")));
}

function d1Result(result) {
  return result?.results || result?.result || [];
}

export function createD1PrivyWalletStore(db) {
  return {
    async getIdentity(userId) {
      return db.prepare("SELECT * FROM ravenos_user_privy_identities WHERE raven_user_id = ? LIMIT 1").bind(userId).first();
    },
    async listWallets(userId) {
      return d1Result(await db.prepare(`SELECT wallet_record_id, provider_wallet_id, ecosystem, public_address, wallet_type, state, created_at, last_verified_at
        FROM ravenos_privy_wallets WHERE raven_user_id = ? ORDER BY ecosystem, created_at`).bind(userId).all());
    },
    async link({ userId, privyUserId, wallets, now }) {
      const existing = await this.getIdentity(userId);
      if (existing && existing.privy_user_id !== privyUserId) throw new Error("privy_identity_conflict");
      const owner = await db.prepare("SELECT raven_user_id FROM ravenos_user_privy_identities WHERE privy_user_id = ? LIMIT 1").bind(privyUserId).first();
      if (owner && owner.raven_user_id !== userId) throw new Error("privy_identity_conflict");
      const statements = [db.prepare(`INSERT INTO ravenos_user_privy_identities
        (raven_user_id, privy_user_id, state, linked_at, last_verified_at, updated_at, revision)
        VALUES (?, ?, 'active', ?, ?, ?, 1)
        ON CONFLICT(raven_user_id) DO UPDATE SET last_verified_at = excluded.last_verified_at,
          updated_at = excluded.updated_at, revision = ravenos_user_privy_identities.revision + 1
        WHERE ravenos_user_privy_identities.privy_user_id = excluded.privy_user_id`).bind(userId, privyUserId, existing?.linked_at || now, now, now)];
      for (const wallet of wallets) {
        const walletRecordId = `rpw_${await sha256(`${privyUserId}:${wallet.ecosystem}:${wallet.address}`)}`;
        statements.push(db.prepare(`INSERT INTO ravenos_privy_wallets
          (wallet_record_id, raven_user_id, privy_user_id, provider_wallet_id, ecosystem, public_address, wallet_type, state, created_at, last_verified_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'privy_embedded', 'active', ?, ?, ?)
          ON CONFLICT(raven_user_id, ecosystem) DO UPDATE SET
            provider_wallet_id = excluded.provider_wallet_id, public_address = excluded.public_address,
            state = 'active', last_verified_at = excluded.last_verified_at, updated_at = excluded.updated_at
          WHERE ravenos_privy_wallets.privy_user_id = excluded.privy_user_id`).bind(
          walletRecordId, userId, privyUserId, wallet.provider_wallet_id, wallet.ecosystem, wallet.address, now, now, now,
        ));
      }
      statements.push(db.prepare(`INSERT INTO ravenos_privy_usage_events
        (event_id, raven_user_id, event_type, ecosystem, outcome, quantity, observed_at)
        VALUES (?, ?, ?, NULL, 'success', 1, ?)`).bind(randomOpaqueId("pue_", 24), userId, existing ? "session_synced" : "identity_linked", now));
      await db.batch(statements);
      return { identity: await this.getIdentity(userId), wallets: await this.listWallets(userId) };
    },
  };
}

function publicWallet(row) {
  return {
    wallet_id: clean(row.wallet_record_id, 100),
    provider_wallet_id: clean(row.provider_wallet_id, 180) || null,
    ecosystem: row.ecosystem,
    address: row.public_address,
    wallet_type: row.wallet_type,
    state: row.state,
    created_at: new Date(Number(row.created_at) * 1000).toISOString(),
    last_verified_at: new Date(Number(row.last_verified_at) * 1000).toISOString(),
  };
}

async function signWalletSession(cfg, principal, now) {
  const header = { alg: "ES256", typ: "JWT", kid: clean(cfg.public_jwk.kid, 180) || "ravenos-privy-wallet-auth-v1" };
  const payload = {
    iss: "https://app.ravenos.xyz",
    aud: cfg.app_id,
    sub: principal.user_id,
    iat: now,
    nbf: now - 5,
    exp: now + SESSION_SECONDS,
    jti: randomOpaqueId("pjt_", 24),
    scope: "privy_wallet_auth",
  };
  const encoded = `${base64Url(encoder.encode(JSON.stringify(header)))}.${base64Url(encoder.encode(JSON.stringify(payload)))}`;
  const key = await crypto.subtle.importKey("jwk", cfg.private_jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(encoded));
  return { token: `${encoded}.${base64Url(new Uint8Array(signature))}`, expires_at: new Date((now + SESSION_SECONDS) * 1000).toISOString() };
}

function numericClaim(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export async function verifyPrivyIdentityToken(token, cfg, { now = Math.floor(Date.now() / 1000) } = {}) {
  const compact = clean(token, 24_000);
  const parts = compact.split(".");
  if (parts.length !== 3) throw new Error("privy_identity_token_invalid");
  const header = parseJson(new TextDecoder().decode(decodeBase64Url(parts[0])), 2_048);
  const claims = parseJson(new TextDecoder().decode(decodeBase64Url(parts[1])), 16_384);
  if (header.alg !== "ES256" || !clean(header.kid, 180)) throw new Error("privy_identity_token_invalid");
  if (claims.iss !== PRIVY_ISSUER || claims.aud !== cfg.app_id || !/^did:privy:[A-Za-z0-9_-]+$/.test(clean(claims.sub, 180))) {
    throw new Error("privy_identity_token_invalid");
  }
  const exp = numericClaim(claims.exp);
  const iat = numericClaim(claims.iat);
  if (!exp || !iat || exp <= now || iat > now + 60 || exp - iat > 86_400) throw new Error("privy_identity_token_expired");
  const identityKeys = Array.isArray(cfg.identity_jwks)
    ? cfg.identity_jwks
    : cfg.identity_public_jwk ? [cfg.identity_public_jwk] : [];
  const jwk = identityKeys.find((candidate) => candidate?.kid === header.kid);
  if (!validPublicJwk(jwk)) throw new Error("privy_identity_key_unavailable");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const verified = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, decodeBase64Url(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`));
  if (!verified) throw new Error("privy_identity_token_invalid");
  return claims;
}

function linkedAccounts(claims) {
  let accounts = claims.linked_accounts;
  if (typeof accounts === "string") {
    try { accounts = JSON.parse(accounts); } catch { accounts = []; }
  }
  return Array.isArray(accounts) ? accounts : [];
}

function customAuthUserId(claims) {
  const account = linkedAccounts(claims).find((candidate) => candidate?.type === "custom_auth");
  return clean(account?.custom_user_id || account?.customUserId, 180);
}

function normalizedEmbeddedWallets(claims) {
  const wallets = [];
  for (const account of linkedAccounts(claims)) {
    if (account?.type !== "wallet") continue;
    const embedded = account.wallet_client_type === "privy" || account.connector_type === "embedded" || account.wallet_type === "embedded";
    if (!embedded) continue;
    const chain = account.chain_type === "ethereum" ? "evm" : account.chain_type === "solana" ? "solana" : null;
    const raw = clean(account.address, 80);
    const address = chain === "evm" ? raw.toLowerCase() : raw;
    const valid = chain === "evm"
      ? /^0x[0-9a-f]{40}$/.test(address)
      : chain === "solana" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
    if (!valid || wallets.some((wallet) => wallet.ecosystem === chain)) continue;
    wallets.push({ ecosystem: chain, address, provider_wallet_id: clean(account.id || account.wallet_id, 180) || null });
  }
  return wallets;
}

async function boundedIdentityToken(request) {
  const token = clean(request.headers.get("privy-id-token"), 24_000);
  if (!token || token.split(".").length !== 3) throw new Error("privy_identity_token_required");
  return token;
}

export async function routeCustomerPrivyWallets(request, env = {}, deps = {}) {
  const url = new URL(request.url);
  const path = url.pathname;
  const matches = path === "/api/v1/wallets/privy/config"
    || path === "/api/v1/wallets/privy/jwks"
    || path === "/api/v1/wallets/privy"
    || path === "/api/v1/wallets/privy/session"
    || path === "/api/v1/wallets/privy/link";
  if (!matches) return null;
  if (path === "/api/v1/wallets/privy/config" && request.method === "GET") return json(publicConfig(env));
  const cfg = config(env);
  if (path === "/api/v1/wallets/privy/jwks" && request.method === "GET") {
    if (!validPublicJwk(cfg.public_jwk)) return json({ ok: false, error: "privy_jwks_unavailable" }, 404);
    const { d: _private, ...publicKey } = cfg.public_jwk;
    return json({ keys: [publicKey] }, 200, { "cache-control": "public, max-age=300, stale-while-revalidate=300", vary: "Accept-Encoding" });
  }
  if (!cfg.configured) return json({ ok: false, schema_version: SCHEMA, error: "privy_wallets_disabled" }, 503);
  const auth = await (deps.authorize || authorizeCustomerApiRequest)(request, env, deps.identity || {}, {
    require_csrf: request.method !== "GET",
  });
  if (auth.response) return auth.response;
  if (!walletUserAllowed(cfg, auth.principal)) {
    return json({ ok: false, schema_version: SCHEMA, error: "privy_wallet_not_available" }, 403);
  }
  const store = deps.store || createD1PrivyWalletStore(env.RAVENOS_CUSTOMER_DB);
  try {
    if (path === "/api/v1/wallets/privy" && request.method === "GET") {
      const identity = await store.getIdentity(auth.principal.user_id);
      const wallets = identity ? await store.listWallets(auth.principal.user_id) : [];
      return json({
        ...publicConfig(env),
        linked: Boolean(identity?.state === "active"),
        wallets: wallets.map(publicWallet),
        recovery: { state: "provider_managed_user_recovery", tested: false },
      });
    }
    if (path === "/api/v1/wallets/privy/session" && request.method === "POST") {
      const signed = await signWalletSession(cfg, auth.principal, auth.now);
      return json({ ok: true, schema_version: SCHEMA, ...signed, wallets: { solana: cfg.solana_enabled, evm: cfg.evm_enabled } });
    }
    if (path === "/api/v1/wallets/privy/link" && request.method === "POST") {
      const claims = await verifyPrivyIdentityToken(await boundedIdentityToken(request), cfg, { now: auth.now });
      if (customAuthUserId(claims) !== auth.principal.user_id) {
        return json({ ok: false, schema_version: SCHEMA, error: "privy_raven_identity_mismatch" }, 403);
      }
      const wallets = normalizedEmbeddedWallets(claims).filter((wallet) => wallet.ecosystem === "evm" ? cfg.evm_enabled : cfg.solana_enabled);
      if (!wallets.length) return json({ ok: false, schema_version: SCHEMA, error: "embedded_wallets_unavailable" }, 409);
      const result = await store.link({ userId: auth.principal.user_id, privyUserId: claims.sub, wallets, now: auth.now });
      return json({ ok: true, schema_version: SCHEMA, linked: true, wallets: result.wallets.map(publicWallet) });
    }
    return json({ ok: false, error: "method_not_allowed" }, 405, { allow: path.endsWith("/session") || path.endsWith("/link") ? "POST" : "GET" });
  } catch (error) {
    const code = clean(error?.message, 80);
    const conflict = code === "privy_identity_conflict";
    const invalid = code.startsWith("privy_identity_") || code === "embedded_wallets_unavailable";
    return json({ ok: false, schema_version: SCHEMA, error: conflict ? code : invalid ? code : "privy_wallet_service_unavailable" }, conflict ? 409 : invalid ? 401 : 503);
  }
}

export const PrivyWalletContract = Object.freeze({
  schema_version: SCHEMA,
  session_ttl_seconds: SESSION_SECONDS,
  raven_identity_is_canonical: true,
  stores_private_keys: false,
  delegated_signing_enabled: false,
  default_wallet_onboarding: false,
});
