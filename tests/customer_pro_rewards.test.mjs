import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { trialEligibility, resolveProductAccess, ensureProTrial, readProductAccess, expireProTrials } from "../lib/customer_pro.mjs";
import { cashbackMicros, publicProductPolicy } from "../lib/customer_product.mjs";
import { feePolicyFor } from "../lib/customer_trade/fee_policy.mjs";
import { routeCustomerIdentity } from "../lib/customer_identity.mjs";
import { createD1CustomerEntitlementStore, routeCustomerEntitlements } from "../lib/customer_entitlements.mjs";

const NOW = 1788739200;
const USER = "usr_" + "a".repeat(32);
export function sqliteStore() {
  const raw = new DatabaseSync(":memory:");
  for (const name of readdirSync("customer-migrations").filter((name) => /^\d+.*\.sql$/.test(name)).sort()) raw.exec(readFileSync(`customer-migrations/${name}`, "utf8"));
  const db = {
    raw,
    prepare(sql) {
      return { bind(...bindings) {
        const statement = raw.prepare(sql);
        return { async first() { return statement.get(...bindings) || null; }, async all() { return { results: statement.all(...bindings) }; }, async run() { return { meta: { changes: Number(statement.run(...bindings).changes) } }; }, _run() { return statement.run(...bindings); } };
      } };
    },
    async batch(statements) {
      raw.exec("BEGIN");
      try { const result = statements.map((s) => ({ meta: { changes: Number(s._run().changes) } })); raw.exec("COMMIT"); return result; }
      catch (error) { raw.exec("ROLLBACK"); throw error; }
    },
  };
  return db;
}
const identity = { issuer: "https://api.workos.com", provider_subject: "user_verified", email: "verified@example.test", verified: true };
function user(db, id = USER) { db.raw.prepare("INSERT INTO ravenos_users (user_id,state,primary_email,created_at,updated_at,last_authenticated_at) VALUES (?,'active',?,?,?,?)").run(id, identity.email, NOW, NOW, NOW); }

test("a persisted no-card trial unlocks all four released Pro workspaces on no-referrer account reads", async () => {
  const db = sqliteStore(); user(db);
  const now = Math.floor(Date.now() / 1000);
  const env = {
    RAVENOS_CUSTOMER_DB: db, RAVENOS_PRO_FREE_TRIAL_ENABLED: "1", RAVENOS_AUTH_HASH_PEPPER: "test-identity-pepper-for-rewards",
    RAVENOS_ENTITLEMENT_RESOLUTION_ENABLE: "1", RAVENOS_PRO_INTELLIGENCE_ROUTES_ENABLE: "1", RAVENOS_PUBLIC_PROJECTION_SPLIT_ENABLE: "1",
    RAVENOS_PRO_PERPS_ADVANCED_ENABLE: "1", RAVENOS_PRO_PARTICIPANT_ADVANCED_ENABLE: "1", RAVENOS_AGENTIC_PAPER_ENABLED: "1",
    RAVENOS_WALLET_INTELLIGENCE_ENABLED: "1", RAVENOS_WALLET_COPY_ROUTES_ENABLED: "1",
  };
  const access = await ensureProTrial(env, { user_id: USER, created: true, state: "active", user_created_at: now }, identity, { now });
  assert.equal(access.state, "PRO_TRIAL_ACTIVE");
  assert.equal(access.trial.card_required, false);
  const check = async (userId, at) => {
    const response = await routeCustomerEntitlements(new Request("https://app.ravenos.xyz/api/v1/entitlements", { headers: { "sec-fetch-site": "same-origin" } }), env, {
      entitlementStore: createD1CustomerEntitlementStore(db),
      authorizeRequest: async () => ({ principal: { user_id: userId }, now: at, response_headers: new Headers() }),
      consumeRateLimit: async () => ({ allowed: true }),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /private.*no-store/);
    return (await response.json()).capabilities.filter((capability) => capability.available).map((capability) => capability.capability).sort();
  };
  assert.deepEqual(await check(USER, now), ["agents.paper", "intelligence.participant_advanced", "intelligence.perps_advanced", "wallet.copy"]);
  assert.deepEqual(await check("usr_" + "b".repeat(32), now), []);
  assert.deepEqual(await check(USER, access.trial.trial_ends_at), []);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM ravenos_pro_subscriptions").get().n, 0);
  assert.equal(db.raw.prepare("SELECT trial_ends_at FROM ravenos_pro_trials").get().trial_ends_at, access.trial.trial_ends_at);
  db.raw.close();
});

test("eligible new verified account receives exactly 30 days with no card or Stripe subscription", async () => {
  const db = sqliteStore(); user(db);
  const env = { RAVENOS_PRO_FREE_TRIAL_ENABLED: "1", RAVENOS_AUTH_HASH_PEPPER: "test-identity-pepper-for-rewards", RAVENOS_CUSTOMER_DB: db };
  const account = { user_id: USER, created: true, state: "active", user_created_at: NOW };
  const access = await ensureProTrial(env, account, identity, { now: NOW });
  assert.equal(access.state, "PRO_TRIAL_ACTIVE");
  assert.equal(access.trial.trial_ends_at - NOW, 30 * 86400);
  assert.equal(access.trial.card_required, false);
  assert.equal(access.trial.automatic_charge, false);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM ravenos_pro_subscriptions").get().n, 0);
  await ensureProTrial(env, account, identity, { now: NOW + 1000 });
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM ravenos_pro_trials").get().n, 1);
  assert.equal((await readProductAccess(db, USER, { now: NOW + 30 * 86400 })).state, "STANDARD");
  await expireProTrials(db, NOW + 30 * 86400);
  assert.equal(db.raw.prepare("SELECT trial_status FROM ravenos_pro_trials").get().trial_status, "EXPIRED");
  const another = "usr_" + "b".repeat(32); user(db, another);
  assert.equal((await ensureProTrial(env, { ...account, user_id: another }, identity, { now: NOW })).status, "ABUSE_BLOCKED");
  assert.throws(() => db.raw.exec("DELETE FROM ravenos_pro_trials"), /retained/);
  db.raw.close();
});

test("existing users require the configured opt-in policy and prior paid users cannot cycle trials", () => {
  assert.equal(trialEligibility({ verified: true }).eligible, false);
  assert.equal(trialEligibility({ verified: true, existing_policy: "opt_in" }).status, "ELIGIBLE");
  assert.equal(trialEligibility({ verified: true, existing_policy: "opt_in", explicit_request: true }).eligible, true);
  assert.equal(trialEligibility({ verified: true, account_created: true, paid_history: true }).eligible, false);
  assert.equal(trialEligibility({ verified: true, account_created: true, security_hold: true }).status, "ABUSE_BLOCKED");
});

test("managed signup persists a trial with real account SQL while billing is unavailable", async () => {
  const db = sqliteStore();
  const origin = "https://app.ravenos.xyz";
  const env = {
    RAVENOS_CUSTOMER_ACCOUNTS_ENABLE: "1", RAVENOS_AUTH_ORIGIN: origin,
    RAVENOS_AUTH_REDIRECT_URI: `${origin}/api/v1/auth/callback`,
    WORKOS_CLIENT_ID: "client_test_ravenos", WORKOS_API_KEY: "sk_test_not_returned",
    RAVENOS_AUTH_HASH_PEPPER: "test-identity-pepper-for-rewards", RAVENOS_CUSTOMER_DB: db,
    RAVENOS_PRO_FREE_TRIAL_ENABLED: "1", RAVENOS_PRO_ACCOUNT_BILLING_ENABLED: "0",
    RAVENOS_PRO_TRIAL_ELIGIBILITY_START_AT: String(NOW),
    RAVENOS_PRO_TRIAL_EXISTING_USERS: "opt_in",
  };
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    assert.equal(String(url), "https://api.workos.com/user_management/authenticate");
    return Response.json({ user: { id: "user_signup_trial", email: "signup@example.test", email_verified: true }, authentication_method: "GoogleOAuth" });
  };
  async function signIn(intent, now) {
    const start = await routeCustomerIdentity(new Request(`${origin}/api/v1/auth/start`, {
      method: "POST", headers: { origin, "sec-fetch-site": "same-origin", "content-type": "application/json", "cf-connecting-ip": "203.0.113.4" },
      body: JSON.stringify({ provider: "google", intent, return_to: "/account/" }),
    }), env, { nowMs: now * 1000 });
    assert.equal(start.status, 200);
    const location = new URL((await start.json()).authorization_url);
    const cookie = start.headers.get("set-cookie").match(/__Host-ravenos_auth_state=([^;,]+)/)[1];
    const result = await routeCustomerIdentity(new Request(`${origin}/api/v1/auth/callback?code=test_code&state=${location.searchParams.get("state")}`, {
      headers: { cookie: `__Host-ravenos_auth_state=${cookie}` },
    }), env, { nowMs: (now + 1) * 1000, fetchImpl });
    assert.equal(result.status, 303);
    assert.match(result.headers.get("set-cookie"), /__Host-ravenos_session=/);
  }
  await signIn("sign_up", NOW);
  const account = db.raw.prepare("SELECT user_id, created_at FROM ravenos_users").get();
  const trial = db.raw.prepare("SELECT * FROM ravenos_pro_trials").get();
  assert.equal(trial.user_id, account.user_id);
  assert.equal(trial.trial_started_at, account.created_at);
  assert.equal(trial.trial_ends_at, account.created_at + 30 * 86400);
  assert.equal((await readProductAccess(db, account.user_id, { now: NOW + 2 })).state, "PRO_TRIAL_ACTIVE");
  await signIn("sign_in", NOW + 60);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM ravenos_pro_trials").get().n, 1);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM ravenos_pro_subscriptions").get().n, 0);
  await expireProTrials(db, trial.trial_ends_at);
  assert.equal((await readProductAccess(db, account.user_id, { now: trial.trial_ends_at })).state, "STANDARD");
  assert.equal(calls.length, 2);
  db.raw.close();
});

test("activation cutoff retries a new account trial without silently enrolling existing accounts", async () => {
  const db = sqliteStore(); user(db);
  const env = { RAVENOS_PRO_FREE_TRIAL_ENABLED: "1", RAVENOS_AUTH_HASH_PEPPER: "test-identity-pepper-for-rewards", RAVENOS_CUSTOMER_DB: db,
    RAVENOS_PRO_TRIAL_ELIGIBILITY_START_AT: String(NOW), RAVENOS_PRO_TRIAL_EXISTING_USERS: "opt_in" };
  const existing = { user_id: USER, created: false, state: "active", user_created_at: NOW - 1 };
  await ensureProTrial(env, existing, identity, { now: NOW + 1 });
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM ravenos_pro_trials").get().n, 0);
  const access = await ensureProTrial(env, existing, identity, { now: NOW + 2, explicit_request: true });
  assert.equal(access.state, "PRO_TRIAL_ACTIVE");
  assert.equal(access.trial.trial_started_at, NOW + 2);
  const newId = "usr_" + "c".repeat(32); user(db, newId);
  const recovered = await ensureProTrial(env, { ...existing, user_id: newId, user_created_at: NOW }, { ...identity, provider_subject: "user_recovered", email: "recovered@example.test" }, { now: NOW + 100 });
  assert.equal(recovered.state, "PRO_TRIAL_ACTIVE");
  assert.equal(recovered.trial.trial_started_at, NOW);
  db.raw.close();
});

test("native Standard and Pro fees are 100 bps, with a separate rebate and no Copy surcharge", () => {
  for (const provider of ["jupiter", "0x"]) for (const access_tier of ["free", "pro"]) {
    const policy = feePolicyFor({ provider, trade_type: "spot", access_tier, enabled: true, fee_recipient: provider === "jupiter" ? "So11111111111111111111111111111111111111112" : "0x" + "12".repeat(20) });
    assert.equal(policy.fee_bps, 100);
    assert.equal(policy.copy_additional_fee_bps, 0);
    assert.equal(policy.cashback_percent, access_tier === "pro" ? 30 : 0);
  }
  assert.equal(feePolicyFor({ provider: "hyperliquid", trade_type: "perpetual", access_tier: "pro" }).configured_fee_bps, 7);
  assert.equal(feePolicyFor({ provider: "hyperliquid", trade_type: "perpetual", access_tier: "pro" }).cashback_percent, 0);
  assert.equal(publicProductPolicy().pro_execution_fee_bps, 100);
  assert.equal(cashbackMicros("10000000"), "3000000");
  assert.equal(cashbackMicros("11"), "3");
  assert.throws(() => cashbackMicros(10.01), /integer_string/);
});
