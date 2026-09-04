import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  CommunityBoardDefinitions,
  createCommunityPerformanceEvidence,
  createD1CustomerCommunityStore,
  defaultCommunitySettings,
  normalizeCommunitySettings,
  routeCustomerCommunity,
} from "../lib/customer_community.mjs";

const NOW = 1_788_472_800;
const APP = "https://app.ravenos.xyz";

function sqliteD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync("customer-migrations/0001_customer_identity.sql", "utf8"));
  sqlite.exec(readFileSync("customer-migrations/0028_customer_username.sql", "utf8"));
  sqlite.exec(readFileSync("customer-migrations/0029_customer_community.sql", "utf8"));
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
    async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); },
  };
}

function user(db, id, username = null, createdAt = NOW - 100_000) {
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
  const store = createD1CustomerCommunityStore(db);
  const calls = [];
  let currentUser = "usr_one";
  const rateStore = { async rateLimit() { return { allowed: true, retry_after_seconds: 900 }; } };
  const authorizeRequest = async (_request, _env, _deps, options) => {
    calls.push(options);
    return {
      principal: { user_id: currentUser, session_public_id: "sespub_test" },
      store: rateStore,
      now: NOW,
      response_headers: new Headers({ "cache-control": "no-store" }),
    };
  };
  return {
    db,
    store,
    calls,
    deps: { store, authorizeRequest },
    env: { RAVENOS_COMMUNITY_ENABLED: "1", RAVENOS_AUTH_HASH_PEPPER: "test-pepper" },
    as(id) { currentUser = id; },
  };
}

async function payload(response) {
  return response.json();
}

const publicSettings = Object.freeze({
  public_profile_enabled: true,
  performance_visible: true,
  positions_visible: false,
  trade_history_visible: false,
  strategy_breakdown_visible: true,
  wallet_addresses_visible: false,
  followers_visibility: "public",
  allow_following: true,
  allow_shadowing: false,
  allow_raven_copy: false,
  referral_link_public: false,
});

test("community settings are private by default and reject unknown or ambiguous values", () => {
  assert.deepEqual(defaultCommunitySettings(), {
    public_profile_enabled: false,
    performance_visible: false,
    positions_visible: false,
    trade_history_visible: false,
    strategy_breakdown_visible: false,
    wallet_addresses_visible: false,
    followers_visibility: "private",
    allow_following: false,
    allow_shadowing: false,
    allow_raven_copy: false,
    referral_link_public: false,
  });
  assert.throws(() => normalizeCommunitySettings({ ...publicSettings, surprise: true }), /community_settings_invalid/);
  assert.throws(() => normalizeCommunitySettings({ ...publicSettings, performance_visible: "yes" }), /performance_visible_invalid/);
});

test("choosing a username does not publish a profile and opt-in requires that username", async () => {
  const h = harness();
  user(h.db, "usr_one");
  let response = await routeCustomerCommunity(request("/api/v1/community/me"), h.env, h.deps);
  let body = await payload(response);
  assert.equal(response.status, 200);
  assert.equal(body.profile.username_required, true);
  assert.equal(body.profile.profile_url, null);
  assert.equal(body.profile.settings.public_profile_enabled, false);

  response = await routeCustomerCommunity(request("/api/v1/community/me", {
    method: "PUT",
    body: { settings: publicSettings, expected_revision: 0 },
  }), h.env, h.deps);
  assert.equal(response.status, 409);
  assert.equal((await payload(response)).error, "username_required");

  h.db.sqlite.prepare("UPDATE ravenos_users SET username = ? WHERE user_id = ?").run("chart_witch", "usr_one");
  response = await routeCustomerCommunity(request("/api/v1/community/me", {
    method: "PUT",
    body: { settings: publicSettings, expected_revision: 7 },
  }), h.env, h.deps);
  assert.equal(response.status, 409);
  assert.equal((await payload(response)).error, "community_profile_revision_conflict");

  response = await routeCustomerCommunity(request("/api/v1/community/me", {
    method: "PUT",
    body: { settings: publicSettings, expected_revision: 0 },
  }), h.env, h.deps);
  body = await payload(response);
  assert.equal(response.status, 200);
  assert.equal(body.profile.profile_url, "https://ravenos.xyz/@chart_witch");
  assert.equal(body.profile.profile_revision, 1);
  assert.equal(h.calls.at(-1).require_csrf, true);
});

test("a public profile discloses only opted-in public-safe fields", async () => {
  const h = harness();
  user(h.db, "usr_one", "chart_witch");
  await h.store.saveOwnProfile({ user_id: "usr_one", settings: publicSettings, settings_digest: "d".repeat(43), expected_revision: 0, now: NOW });
  const response = await routeCustomerCommunity(request("/api/v1/community/profiles/chart_witch"), h.env, h.deps);
  const body = await payload(response);
  assert.equal(response.status, 200);
  assert.equal(body.profile.username, "chart_witch");
  assert.equal(body.profile.public_disclosures.wallet_addresses, false);
  assert.equal(body.profile.boundaries.account_balance_public, false);
  assert.equal(body.profile.performance.length, 0);
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /example\.test|usr_one|primary_email|"legal_name"\s*:/);
});

test("performance records preserve classification and user-reported results cannot enter boards", async () => {
  const h = harness();
  user(h.db, "usr_one", "reported_only");
  user(h.db, "usr_two", "verified_edge");
  await h.store.saveOwnProfile({ user_id: "usr_one", settings: publicSettings, settings_digest: "a".repeat(43), expected_revision: 0, now: NOW });
  await h.store.saveOwnProfile({ user_id: "usr_two", settings: publicSettings, settings_digest: "b".repeat(43), expected_revision: 0, now: NOW });

  const reported = await createCommunityPerformanceEvidence({
    user_id: "usr_one",
    period: "90d",
    observation_type: "user_reported",
    evidence_state: "available",
    source_contract_id: "ravenos.user_report.v1",
    source_reference_digest: "r".repeat(64),
    observed_from: NOW - 90 * 86_400,
    observed_through: NOW,
    sample_count: 500,
    evidence_confidence_pct: 100,
    return_pct: 4_000,
    maximum_drawdown_pct: 1,
    profit_factor: 99,
    profitable_periods: 13,
    active_periods: 13,
  }, { now: NOW });
  const observed = await createCommunityPerformanceEvidence({
    user_id: "usr_two",
    period: "90d",
    observation_type: "raven_observed",
    evidence_state: "available",
    source_contract_id: "ravenos.portfolio_outcome.v1",
    source_reference_digest: "o".repeat(64),
    observed_from: NOW - 90 * 86_400,
    observed_through: NOW,
    sample_count: 42,
    evidence_confidence_pct: 92,
    return_pct: 18,
    maximum_drawdown_pct: 7,
    profit_factor: 1.7,
    profitable_periods: 9,
    active_periods: 13,
    top_1_profit_concentration_pct: 24,
  }, { now: NOW + 1 });
  await h.store.insertEvidence(reported);
  await h.store.insertEvidence(observed);
  await h.store.insertEvidence(await createCommunityPerformanceEvidence({
    user_id: "usr_two",
    period: "90d",
    observation_type: "user_reported",
    evidence_state: "available",
    source_contract_id: "ravenos.user_report.v1",
    source_reference_digest: "s".repeat(64),
    observed_from: NOW - 90 * 86_400,
    observed_through: NOW,
    sample_count: 900,
    evidence_confidence_pct: 100,
    return_pct: 9_999,
    maximum_drawdown_pct: 0,
    profit_factor: 999,
    profitable_periods: 13,
    active_periods: 13,
  }, { now: NOW + 2 }));

  const response = await routeCustomerCommunity(request("/api/v1/community/boards?board=most_consistent"), h.env, h.deps);
  const body = await payload(response);
  assert.equal(response.status, 200);
  assert.equal(body.rows.length, 1);
  assert.equal(body.rows[0].username, "verified_edge");
  assert.equal(body.rows[0].evidence.classification, "raven_observed");
  assert.equal(body.boundaries.user_reported_eligible, false);

  const profile = await payload(await routeCustomerCommunity(request("/api/v1/community/profiles/verified_edge"), h.env, h.deps));
  assert.deepEqual(profile.profile.performance.map((row) => row.classification), ["raven_observed", "user_reported"]);
});

test("public usernames fail explicitly and evidence ledgers are physically append-only", async () => {
  const h = harness();
  user(h.db, "usr_one", "observer");
  const malformed = await routeCustomerCommunity(request("/api/v1/community/profiles/%25invalid"), h.env, h.deps);
  assert.equal(malformed.status, 400);
  assert.equal((await payload(malformed)).error, "community_username_invalid");

  const evidence = await createCommunityPerformanceEvidence({
    user_id: "usr_one",
    period: "30d",
    observation_type: "raven_observed",
    evidence_state: "partial",
    source_contract_id: "ravenos.portfolio_outcome.v1",
    source_reference_digest: "e".repeat(64),
    observed_from: NOW - 30 * 86_400,
    observed_through: NOW,
    sample_count: 4,
    evidence_confidence_pct: 60,
  }, { now: NOW });
  await h.store.insertEvidence(evidence);
  assert.throws(
    () => h.db.sqlite.prepare("UPDATE ravenos_community_performance_evidence SET sample_count = 5 WHERE evidence_id = ?").run(evidence.evidence_id),
    /community_performance_evidence_append_only/,
  );
  assert.throws(
    () => h.db.sqlite.prepare("DELETE FROM ravenos_community_performance_evidence WHERE evidence_id = ?").run(evidence.evidence_id),
    /community_performance_evidence_append_only/,
  );
});

test("following and Useful recognition are idempotent, positive-only, and respect profile controls", async () => {
  const h = harness();
  user(h.db, "usr_one", "observer");
  user(h.db, "usr_two", "open_trader");
  user(h.db, "usr_three", "closed_trader");
  await h.store.saveOwnProfile({ user_id: "usr_two", settings: publicSettings, settings_digest: "b".repeat(43), expected_revision: 0, now: NOW });
  await h.store.saveOwnProfile({
    user_id: "usr_three",
    settings: { ...publicSettings, allow_following: false },
    settings_digest: "c".repeat(43),
    expected_revision: 0,
    now: NOW,
  });

  let response = await routeCustomerCommunity(request("/api/v1/community/profiles/open_trader/follow", { method: "PUT", body: {} }), h.env, h.deps);
  assert.equal(response.status, 200);
  response = await routeCustomerCommunity(request("/api/v1/community/profiles/open_trader/follow", { method: "PUT", body: {} }), h.env, h.deps);
  assert.equal(response.status, 200);
  response = await routeCustomerCommunity(request("/api/v1/community/profiles/closed_trader/follow", { method: "PUT", body: {} }), h.env, h.deps);
  assert.equal(response.status, 409);
  response = await routeCustomerCommunity(request("/api/v1/community/profiles/observer/follow", { method: "PUT", body: {} }), h.env, h.deps);
  assert.equal(response.status, 404);

  response = await routeCustomerCommunity(request("/api/v1/community/profiles/open_trader/recognitions/useful", { method: "PUT", body: {} }), h.env, h.deps);
  assert.equal(response.status, 200);
  response = await routeCustomerCommunity(request("/api/v1/community/profiles/open_trader/recognitions/useful", { method: "PUT", body: {} }), h.env, h.deps);
  assert.equal(response.status, 200);

  response = await routeCustomerCommunity(request("/api/v1/community/following"), h.env, h.deps);
  const body = await payload(response);
  assert.equal(body.rows.length, 1);
  assert.equal(body.rows[0].profile.username, "open_trader");
  const counts = h.db.sqlite.prepare("SELECT COUNT(*) AS count FROM ravenos_community_follows").get();
  const recognitions = h.db.sqlite.prepare("SELECT COUNT(*) AS count FROM ravenos_community_recognitions").get();
  assert.equal(Number(counts.count), 1);
  assert.equal(Number(recognitions.count), 1);
});

test("community is fail-closed until its feature flag and database are available", async () => {
  const h = harness();
  user(h.db, "usr_one", "observer");
  const disabled = await routeCustomerCommunity(request("/api/v1/community/boards"), { ...h.env, RAVENOS_COMMUNITY_ENABLED: "0" }, h.deps);
  assert.equal(disabled.status, 503);
  assert.equal((await payload(disabled)).error, "community_disabled");
  assert.equal(CommunityBoardDefinitions.most_consistent.ranking_basis, "profitable_period_share");
});
