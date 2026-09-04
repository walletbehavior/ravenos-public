import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  CustomerReferralContract,
  createD1CustomerReferralStore,
  createReferralAttributionRecord,
  createReferralCodeRecord,
  createReferralCodeValue,
  createReferralSubscriptionEvidence,
  normalizeReferralCode,
  resolveReferralRuntime,
  routeCustomerReferrals,
} from "../lib/customer_referrals.mjs";

const NOW = 1_788_472_800;
const APP = "https://app.ravenos.xyz";
const CODE_ONE = "RVN23456789ABCD";
const CODE_TWO = "RVNABCDEFGHJKLM";

function sqliteD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync("customer-migrations/0001_customer_identity.sql", "utf8"));
  sqlite.exec(readFileSync("customer-migrations/0003_customer_entitlements.sql", "utf8"));
  sqlite.exec(readFileSync("customer-migrations/0028_customer_username.sql", "utf8"));
  sqlite.exec(readFileSync("customer-migrations/0030_customer_referrals.sql", "utf8"));
  return {
    sqlite,
    prepare(sql) {
      return {
        bind(...values) {
          const statement = sqlite.prepare(sql);
          return {
            async first() { return statement.get(...values) || null; },
            async all() { return { results: statement.all(...values) }; },
            async run() {
              const result = statement.run(...values);
              return { meta: { changes: Number(result.changes) } };
            },
          };
        },
      };
    },
  };
}

function user(db, id, username, createdAt = NOW - 10_000) {
  db.sqlite.prepare(`
    INSERT INTO ravenos_users (user_id, state, primary_email, username, display_name, created_at, updated_at, last_authenticated_at)
    VALUES (?, 'active', ?, ?, NULL, ?, ?, ?)
  `).run(id, `${id}@example.test`, username, createdAt, createdAt, createdAt);
}

function request(path, { method = "GET", body = null } = {}) {
  const headers = new Headers({ origin: APP, "sec-fetch-site": "same-origin" });
  if (body !== null) headers.set("content-type", "application/json");
  return new Request(`${APP}${path}`, { method, headers, body: body === null ? null : JSON.stringify(body) });
}

function harness() {
  const db = sqliteD1();
  const store = createD1CustomerReferralStore(db);
  const authorizationCalls = [];
  let currentUser = "usr_one";
  const rateStore = { async rateLimit() { return { allowed: true, retry_after_seconds: 900 }; } };
  const authorizeRequest = async (_request, _env, _deps, options) => {
    authorizationCalls.push(options);
    return {
      principal: { user_id: currentUser, session_public_id: "sespub_referral" },
      store: rateStore,
      now: NOW,
      response_headers: new Headers({ "cache-control": "no-store" }),
    };
  };
  return {
    db,
    store,
    authorizationCalls,
    deps: { store, authorizeRequest },
    env: { RAVENOS_REFERRALS_ENABLED: "1", RAVENOS_AUTH_HASH_PEPPER: "test-pepper" },
    as(userId) { currentUser = userId; },
  };
}

test("referral codes are opaque, bounded, normalized, and generated from 60 bits", () => {
  assert.equal(createReferralCodeValue(new Uint8Array(12)), "RVN222222222222");
  assert.equal(normalizeReferralCode("rvn23456789abcd"), CODE_ONE);
  assert.throws(() => normalizeReferralCode("RVN000000000000"), /referral_code_invalid/);
  assert.throws(() => normalizeReferralCode("@chart_witch"), /referral_code_invalid/);
  assert.throws(() => createReferralCodeValue(new Uint8Array(11)), /referral_entropy_invalid/);
  assert.equal(CustomerReferralContract.referral_code_contains_public_identity, false);
  assert.equal(CustomerReferralContract.browser_storage_state_permitted, false);
  assert.equal(CustomerReferralContract.trade_volume_affects_reward, false);
  assert.equal(CustomerReferralContract.trading_performance_affects_reward, false);
});

test("referrals fail closed unless the dedicated database-backed control is enabled", () => {
  assert.deepEqual(resolveReferralRuntime({}, {}), {
    enabled: false,
    state: "disabled",
    reason: "referrals_disabled",
    billing_reconciliation_enabled: false,
    reward_policy_configured: false,
    payouts_available: false,
  });
  assert.equal(resolveReferralRuntime({ RAVENOS_REFERRALS_ENABLED: "1" }, {}).state, "database_unavailable");
  assert.equal(resolveReferralRuntime({ RAVENOS_REFERRALS_ENABLED: "1" }, { store: {} }).enabled, true);
  assert.equal(resolveReferralRuntime({ RAVENOS_REFERRALS_ENABLED: "1" }, { store: {} }).billing_reconciliation_enabled, false);
});

test("an account creates one stable code and receives no invented reward or entitlement", async () => {
  const h = harness();
  user(h.db, "usr_one", "chart_witch");

  const before = await routeCustomerReferrals(request("/api/v1/referrals/me"), h.env, h.deps);
  assert.equal(before.status, 200);
  assert.deepEqual((await before.json()).referral, {
    schema_version: "ravenos.customer_referrals.v1",
    state: "not_created",
    referral_code: null,
    referral_url: null,
    code_created_at: null,
    attribution: null,
    referred_accounts: 0,
    qualified_pro_subscriptions: 0,
    economics: { reward_policy_state: "not_configured", earnings: null, payout_state: "unavailable" },
    boundaries: {
      pro_subscription_evidence_required: true,
      customer_claim_can_create_entitlement: false,
      customer_claim_can_create_credit: false,
      trade_volume_affects_reward: false,
      trading_performance_affects_reward: false,
      referral_is_investment_endorsement: false,
      attribution_replaceable: false,
      billing_reconciliation_enabled: false,
      payouts_available: false,
    },
  });

  const created = await routeCustomerReferrals(request("/api/v1/referrals/code", { method: "PUT", body: {} }), h.env, h.deps);
  assert.equal(created.status, 200);
  const createdBody = await created.json();
  assert.match(createdBody.referral.referral_code, /^RVN[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/);
  assert.equal(createdBody.referral.referral_url, `${APP}/account/?ref=${createdBody.referral.referral_code}`);
  assert.equal(createdBody.referral.economics.earnings, null);
  assert.equal(h.db.sqlite.prepare("SELECT COUNT(*) AS count FROM ravenos_customer_entitlement_grants").get().count, 0);
  assert.equal(h.db.sqlite.prepare("SELECT COUNT(*) AS count FROM ravenos_referral_subscription_evidence").get().count, 0);

  const replay = await routeCustomerReferrals(request("/api/v1/referrals/code", { method: "PUT", body: {} }), h.env, h.deps);
  assert.equal((await replay.json()).referral.referral_code, createdBody.referral.referral_code);
  assert.deepEqual(h.authorizationCalls.map((call) => call.require_csrf), [false, true, true]);
});

test("attribution is deliberate, one-time, idempotent, and self-referral safe", async () => {
  const h = harness();
  user(h.db, "usr_one", "new_trader");
  user(h.db, "usr_two", "edge_scout");
  user(h.db, "usr_three", "quiet_risk");
  await h.store.createCode(await createReferralCodeRecord({ user_id: "usr_two", code: CODE_ONE, now: NOW - 100 }));
  await h.store.createCode(await createReferralCodeRecord({ user_id: "usr_three", code: CODE_TWO, now: NOW - 50 }));

  h.as("usr_two");
  const self = await routeCustomerReferrals(request("/api/v1/referrals/claim", { method: "PUT", body: { referral_code: CODE_ONE } }), h.env, h.deps);
  assert.equal(self.status, 409);
  assert.equal((await self.json()).error, "self_referral_not_allowed");

  h.as("usr_one");
  const accepted = await routeCustomerReferrals(request("/api/v1/referrals/claim", { method: "PUT", body: { referral_code: CODE_ONE.toLowerCase() } }), h.env, h.deps);
  assert.equal(accepted.status, 200);
  const acceptedBody = await accepted.json();
  assert.equal(acceptedBody.idempotent, false);
  assert.equal(acceptedBody.referral.attribution.state, "recorded");
  assert.equal(acceptedBody.referral.boundaries.customer_claim_can_create_entitlement, false);

  const replay = await routeCustomerReferrals(request("/api/v1/referrals/claim", { method: "PUT", body: { referral_code: CODE_ONE } }), h.env, h.deps);
  assert.equal((await replay.json()).idempotent, true);

  const replacement = await routeCustomerReferrals(request("/api/v1/referrals/claim", { method: "PUT", body: { referral_code: CODE_TWO } }), h.env, h.deps);
  assert.equal(replacement.status, 409);
  assert.equal((await replacement.json()).error, "referral_already_attributed");
  assert.equal(h.db.sqlite.prepare("SELECT COUNT(*) AS count FROM ravenos_referral_attributions").get().count, 1);
});

test("only append-only authoritative subscription evidence can qualify a referral", async () => {
  const h = harness();
  user(h.db, "usr_one", "new_trader");
  user(h.db, "usr_two", "edge_scout");
  await h.store.createCode(await createReferralCodeRecord({ user_id: "usr_two", code: CODE_ONE, now: NOW - 100 }));
  const attribution = await createReferralAttributionRecord({ referred_user_id: "usr_one", referrer_user_id: "usr_two", referral_code: CODE_ONE, now: NOW - 90 });
  await h.store.insertAttribution(attribution);

  h.as("usr_two");
  assert.equal((await (await routeCustomerReferrals(request("/api/v1/referrals/me"), h.env, h.deps)).json()).referral.qualified_pro_subscriptions, 0);
  const activated = await createReferralSubscriptionEvidence({
    event_id: "rse_activated_reference",
    attribution_id: attribution.attribution_id,
    event_type: "pro_subscription_activated",
    source_contract_id: "ravenos.billing.reconciliation.v1",
    source_reference_digest: "A".repeat(43),
    effective_at: NOW - 50,
  }, { now: NOW - 49 });
  assert.equal(await h.store.insertSubscriptionEvidence(activated), true);
  assert.equal((await (await routeCustomerReferrals(request("/api/v1/referrals/me"), h.env, h.deps)).json()).referral.qualified_pro_subscriptions, 1);

  const cancelled = await createReferralSubscriptionEvidence({
    event_id: "rse_cancelled_reference",
    attribution_id: attribution.attribution_id,
    event_type: "pro_subscription_cancelled",
    source_contract_id: "ravenos.billing.reconciliation.v1",
    source_reference_digest: "B".repeat(43),
    effective_at: NOW - 10,
  }, { now: NOW - 9 });
  assert.equal(await h.store.insertSubscriptionEvidence(cancelled), true);
  assert.equal((await (await routeCustomerReferrals(request("/api/v1/referrals/me"), h.env, h.deps)).json()).referral.qualified_pro_subscriptions, 0);
  assert.equal(await routeCustomerReferrals(request("/api/v1/referrals/subscription-evidence", { method: "PUT", body: {} }), h.env, h.deps), null);
});

test("referral evidence and attribution tables are physically append-only", async () => {
  const h = harness();
  user(h.db, "usr_one", "new_trader");
  user(h.db, "usr_two", "edge_scout");
  const attribution = await createReferralAttributionRecord({ referred_user_id: "usr_one", referrer_user_id: "usr_two", referral_code: CODE_ONE, now: NOW - 90 });
  await h.store.insertAttribution(attribution);
  const evidence = await createReferralSubscriptionEvidence({
    event_id: "rse_append_only_test",
    attribution_id: attribution.attribution_id,
    event_type: "pro_subscription_activated",
    source_contract_id: "ravenos.billing.reconciliation.v1",
    source_reference_digest: "C".repeat(43),
    effective_at: NOW - 50,
  }, { now: NOW - 49 });
  await h.store.insertSubscriptionEvidence(evidence);
  await h.store.recordAudit({ user_id: "usr_one", event_type: "referral_attributed", attribution_id: attribution.attribution_id, now: NOW });

  assert.throws(() => h.db.sqlite.prepare("UPDATE ravenos_referral_attributions SET referral_code_snapshot = ?").run(CODE_TWO), /referral_attribution_append_only/);
  assert.throws(() => h.db.sqlite.prepare("DELETE FROM ravenos_referral_subscription_evidence").run(), /referral_subscription_evidence_append_only/);
  assert.throws(() => h.db.sqlite.prepare("UPDATE ravenos_referral_audit_events SET event_type = 'referral_code_created'").run(), /referral_audit_event_append_only/);
});

test("malformed customer input stays unavailable rather than becoming attribution", async () => {
  const h = harness();
  user(h.db, "usr_one", "new_trader");
  const malformed = await routeCustomerReferrals(request("/api/v1/referrals/claim", { method: "PUT", body: { referral_code: "chart_witch", earnings: 1000 } }), h.env, h.deps);
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error, "referral_claim_request_invalid");
  assert.equal(h.db.sqlite.prepare("SELECT COUNT(*) AS count FROM ravenos_referral_attributions").get().count, 0);
});
