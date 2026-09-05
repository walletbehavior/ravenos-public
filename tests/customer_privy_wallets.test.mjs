import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  PrivyWalletContract,
  createD1PrivyWalletStore,
  routeCustomerPrivyWallets,
  verifyPrivyIdentityToken,
} from "../lib/customer_privy_wallets.mjs";

const ORIGIN = "https://app.ravenos.xyz";
const NOW = 1_788_480_000;
const APP_ID = "cmtna91zp004m0cjss6lill1d";
const TEST_USER_ID = `usr_${"a".repeat(32)}`;

function b64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

async function keyMaterial(kid = "test-key") {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicJwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid, alg: "ES256", use: "sig" };
  const privateJwk = { ...(await crypto.subtle.exportKey("jwk", pair.privateKey)), kid, alg: "ES256", use: "sig" };
  return { pair, publicJwk, privateJwk };
}

async function token(pair, kid, claims) {
  const header = b64(new TextEncoder().encode(JSON.stringify({ alg: "ES256", typ: "JWT", kid })));
  const payload = b64(new TextEncoder().encode(JSON.stringify(claims)));
  const input = `${header}.${payload}`;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(input));
  return `${input}.${b64(new Uint8Array(signature))}`;
}

function env(keys = null, identityPublicJwk = null) {
  return {
    RAVENOS_PRIVY_ENABLED: keys ? "1" : "0",
    RAVENOS_PRIVY_WALLETS_ENABLED: keys ? "1" : "0",
    RAVENOS_PRIVY_SOLANA_ENABLED: keys ? "1" : "0",
    RAVENOS_PRIVY_EVM_ENABLED: keys ? "1" : "0",
    RAVENOS_PRIVY_MANUAL_SIGNING_ENABLED: "0",
    RAVENOS_PRIVY_DELEGATED_SIGNING_ENABLED: "0",
    RAVENOS_PRIVY_DEFAULT_WALLET_ONBOARDING: "0",
    RAVENOS_PRIVY_WALLET_USERS: TEST_USER_ID,
    RAVENOS_PRIVY_APP_ID: APP_ID,
    RAVENOS_PRIVY_CLIENT_ID: "client-test-ravenos",
    RAVENOS_PRIVY_CUSTOM_AUTH_PUBLIC_JWK: keys ? JSON.stringify(keys.publicJwk) : "",
    RAVENOS_PRIVY_CUSTOM_AUTH_PRIVATE_JWK: keys ? JSON.stringify(keys.privateJwk) : "",
    RAVENOS_PRIVY_IDENTITY_JWKS: identityPublicJwk ? JSON.stringify({ keys: Array.isArray(identityPublicJwk) ? identityPublicJwk : [identityPublicJwk] }) : "",
    RAVENOS_CUSTOMER_DB: { prepare() {}, batch() {} },
  };
}

function authorize(userId = TEST_USER_ID) {
  return async () => ({ principal: { user_id: userId, session_public_id: "ses_test", authenticated_at: NOW - 60 }, now: NOW });
}

class MemoryStore {
  identities = new Map();
  wallets = new Map();
  async getIdentity(userId) { return this.identities.get(userId) || null; }
  async listWallets(userId) { return this.wallets.get(userId) || []; }
  async link({ userId, privyUserId, wallets, now }) {
    const owner = [...this.identities.entries()].find(([, row]) => row.privy_user_id === privyUserId)?.[0];
    if (owner && owner !== userId) throw new Error("privy_identity_conflict");
    const existing = this.identities.get(userId);
    if (existing && existing.privy_user_id !== privyUserId) throw new Error("privy_identity_conflict");
    const identity = { raven_user_id: userId, privy_user_id: privyUserId, state: "active", linked_at: existing?.linked_at || now, last_verified_at: now };
    this.identities.set(userId, identity);
    const rows = wallets.map((wallet, index) => ({ wallet_record_id: `rpw_${index}${"a".repeat(25)}`, provider_wallet_id: wallet.provider_wallet_id, ecosystem: wallet.ecosystem, public_address: wallet.address, wallet_type: "privy_embedded", state: "active", created_at: now, last_verified_at: now }));
    this.wallets.set(userId, rows);
    return { identity, wallets: rows };
  }
}

test("Privy wallet contract is authority-bounded", () => {
  assert.equal(PrivyWalletContract.raven_identity_is_canonical, true);
  assert.equal(PrivyWalletContract.stores_private_keys, false);
  assert.equal(PrivyWalletContract.delegated_signing_enabled, false);
  assert.equal(PrivyWalletContract.default_wallet_onboarding, false);
});

test("Privy is default-off and does not affect Raven login routes", async () => {
  const response = await routeCustomerPrivyWallets(new Request(`${ORIGIN}/api/v1/wallets/privy/config`), env());
  const payload = await response.json();
  assert.equal(payload.available, false);
  assert.equal(payload.app_id, null);
  assert.deepEqual(payload.capabilities, { evm: false, solana: false, manual_signing: false, delegated_signing: false });
  assert.equal(await routeCustomerPrivyWallets(new Request(`${ORIGIN}/api/v1/auth/session`), env()), null);
});

test("Raven issues a short-lived, wallet-only custom-auth token", async () => {
  const keys = await keyMaterial("raven-wallet-auth");
  const response = await routeCustomerPrivyWallets(new Request(`${ORIGIN}/api/v1/wallets/privy/session`, { method: "POST" }), env(keys, keys.publicJwk), { authorize: authorize() });
  assert.equal(response.status, 200);
  const payload = await response.json();
  const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload.token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(payload.token.split(".")[1].length / 4) * 4, "=")), (character) => character.charCodeAt(0))));
  assert.equal(claims.aud, APP_ID);
  assert.equal(claims.scope, "privy_wallet_auth");
  assert.equal(claims.exp - claims.iat, 300);
  assert.equal("email" in claims, false);
  assert.equal("entitlement" in claims, false);
});

test("Privy wallet creation is limited to an explicit Raven user allowlist", async () => {
  const keys = await keyMaterial("raven-wallet-auth");
  const response = await routeCustomerPrivyWallets(
    new Request(`${ORIGIN}/api/v1/wallets/privy`),
    env(keys, keys.publicJwk),
    { authorize: authorize(`usr_${"z".repeat(32)}`) },
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "privy_wallet_not_available");
});

test("Privy publishes only Raven's public custom-auth verification key", async () => {
  const keys = await keyMaterial("raven-wallet-auth");
  const bootstrap = {
    ...env(keys, keys.publicJwk),
    RAVENOS_PRIVY_ENABLED: "0",
    RAVENOS_PRIVY_WALLETS_ENABLED: "0",
  };
  const response = await routeCustomerPrivyWallets(new Request(`${ORIGIN}/api/v1/wallets/privy/jwks`), bootstrap);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /max-age=300/);
  const payload = await response.json();
  assert.equal(payload.keys.length, 1);
  assert.equal(payload.keys[0].kid, "raven-wallet-auth");
  assert.equal("d" in payload.keys[0], false);
  const walletResponse = await routeCustomerPrivyWallets(new Request(`${ORIGIN}/api/v1/wallets/privy`), bootstrap);
  assert.equal(walletResponse.status, 503);
});

test("Privy identity verification accepts the active key from a bounded rotating JWKS set", async () => {
  const oldKeys = await keyMaterial("privy-old");
  const activeKeys = await keyMaterial("privy-active");
  const identityToken = await token(activeKeys.pair, "privy-active", {
    iss: "privy.io", aud: APP_ID, sub: "did:privy:rotating-user", iat: NOW - 10, exp: NOW + 300,
  });
  const verified = await verifyPrivyIdentityToken(identityToken, {
    app_id: APP_ID,
    identity_jwks: [oldKeys.publicJwk, activeKeys.publicJwk],
  }, { now: NOW });
  assert.equal(verified.sub, "did:privy:rotating-user");
});

test("Privy identity token verifies and embedded wallets link idempotently", async () => {
  const ravenKeys = await keyMaterial("raven-wallet-auth");
  const privyKeys = await keyMaterial("privy-identity");
  const identityToken = await token(privyKeys.pair, "privy-identity", {
    iss: "privy.io", aud: APP_ID, sub: "did:privy:test-user", iat: NOW - 10, exp: NOW + 36_000,
    linked_accounts: JSON.stringify([
      { type: "custom_auth", custom_user_id: `usr_${"a".repeat(32)}` },
      { type: "wallet", id: "wallet-evm", wallet_client_type: "privy", chain_type: "ethereum", address: "0xA31872140ebE5eEfB6c4dfAd1fF2489d25F1E227" },
      { type: "wallet", id: "wallet-sol", wallet_client_type: "privy", chain_type: "solana", address: "NFDReixLdyRD5rYyVeqLWfCRwr75hhiBuKz6e3XnBRX" },
      { type: "wallet", wallet_client_type: "metamask", chain_type: "ethereum", address: "0x1111111111111111111111111111111111111111" },
    ]),
  });
  const verified = await verifyPrivyIdentityToken(identityToken, { app_id: APP_ID, identity_public_jwk: privyKeys.publicJwk }, { now: NOW });
  assert.equal(verified.sub, "did:privy:test-user");
  const store = new MemoryStore();
  const request = () => new Request(`${ORIGIN}/api/v1/wallets/privy/link`, { method: "POST", headers: { "privy-id-token": identityToken } });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await routeCustomerPrivyWallets(request(), env(ravenKeys, privyKeys.publicJwk), { authorize: authorize(), store });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.wallets.map((wallet) => wallet.ecosystem), ["evm", "solana"]);
    assert.equal(payload.wallets[0].address, "0xa31872140ebe5eefb6c4dfad1ff2489d25f1e227");
  }
  assert.equal(store.identities.size, 1);
  assert.equal(store.wallets.size, 1);
});

test("one Privy identity cannot link to two Raven users", async () => {
  const ravenKeys = await keyMaterial("raven-wallet-auth");
  const privyKeys = await keyMaterial("privy-identity");
  const identityToken = await token(privyKeys.pair, "privy-identity", {
    iss: "privy.io", aud: APP_ID, sub: "did:privy:one-owner", iat: NOW - 10, exp: NOW + 300,
    linked_accounts: [
      { type: "custom_auth", custom_user_id: `usr_${"a".repeat(32)}` },
      { type: "wallet", wallet_client_type: "privy", chain_type: "ethereum", address: "0x1111111111111111111111111111111111111111" },
    ],
  });
  const store = new MemoryStore();
  const request = () => new Request(`${ORIGIN}/api/v1/wallets/privy/link`, { method: "POST", headers: { "privy-id-token": identityToken } });
  assert.equal((await routeCustomerPrivyWallets(request(), env(ravenKeys, privyKeys.publicJwk), { authorize: authorize(`usr_${"a".repeat(32)}`), store })).status, 200);
  assert.equal((await routeCustomerPrivyWallets(request(), env(ravenKeys, privyKeys.publicJwk), { authorize: authorize(`usr_${"b".repeat(32)}`), store })).status, 403);
});

test("migration stores public metadata only and usage is append-only", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON; CREATE TABLE ravenos_users (user_id TEXT PRIMARY KEY);");
  db.exec(`INSERT INTO ravenos_users (user_id) VALUES ('usr_${"a".repeat(32)}');`);
  db.exec(readFileSync(new URL("../customer-migrations/0032_privy_embedded_wallets.sql", import.meta.url), "utf8"));
  const columns = db.prepare("PRAGMA table_info(ravenos_privy_wallets)").all().map((row) => row.name);
  assert.equal(columns.some((name) => /private|secret|seed|recovery_material/.test(name)), false);
  const store = createD1PrivyWalletStore({
    prepare(sql) {
      const statement = db.prepare(sql);
      return { bind(...values) { return { first: () => statement.get(...values), all: () => ({ results: statement.all(...values) }), run: () => statement.run(...values) }; } };
    },
    async batch(statements) { for (const statement of statements) await statement.run(); },
  });
  await store.link({
    userId: `usr_${"a".repeat(32)}`, privyUserId: "did:privy:sqlite-user", now: NOW,
    wallets: [{ ecosystem: "evm", address: "0x1111111111111111111111111111111111111111", provider_wallet_id: "wallet-1" }],
  });
  assert.equal((await store.listWallets(`usr_${"a".repeat(32)}`)).length, 1);
  assert.throws(() => db.exec("UPDATE ravenos_privy_usage_events SET quantity = 2"), /append_only/);
  db.close();
});
