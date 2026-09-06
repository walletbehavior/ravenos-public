import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { trialEligibility, resolveProductAccess, ensureProTrial, readProductAccess, expireProTrials } from "../lib/customer_pro.mjs";
import { cashbackMicros, publicProductPolicy } from "../lib/customer_product.mjs";
import { feePolicyFor } from "../lib/customer_trade/fee_policy.mjs";

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
