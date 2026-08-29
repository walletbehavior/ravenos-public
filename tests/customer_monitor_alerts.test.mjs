import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CUSTOMER_MONITOR_ALERTS_ROUTE,
  CustomerMonitorError,
  CustomerMonitorAlertContract,
  CustomerMonitorAlertLimits,
  compareMonitorEvidence,
  normalizeMonitorEvidence,
  resolveMonitorAlertActivation,
  resolveMonitorAlertFlags,
  routeCustomerMonitorAlerts,
  runCustomerMonitorEvaluator,
} from "../lib/customer_monitor_alerts.mjs";
import {
  CustomerEntitlementContract,
  resolveCapabilityAccess,
  resolveEntitlementFeatureFlags,
} from "../lib/customer_entitlements.mjs";

const APP = "https://app.ravenos.xyz";
const NOW = Math.floor(Date.parse("2026-08-26T20:00:00Z") / 1000);
const USER_A = `usr_${"a".repeat(32)}`;
const USER_B = `usr_${"b".repeat(32)}`;

function env(overrides = {}) {
  return {
    RAVENOS_ENTITLEMENT_RESOLUTION_ENABLE: "1",
    RAVENOS_RESEARCH_ALERTS_ENABLE: "1",
    RAVENOS_RESEARCH_ALERT_RULE_ROUTES_ENABLE: "1",
    RAVENOS_RESEARCH_ALERT_EVALUATION_ENABLE: "1",
    RAVENOS_NOTIFICATION_HISTORY_ENABLE: "1",
    ...overrides,
  };
}

function grant(overrides = {}) {
  return {
    grant_id: `ent_${"a".repeat(20)}`,
    user_id: USER_A,
    capability_key: "research.alerts",
    state: "active",
    activation_at: NOW - 60,
    expires_at: NOW + 3600,
    revision: 1,
    ...overrides,
  };
}

function request(path, { method = "GET", body = null, origin = APP, csrf = true, fetchSite = "same-origin", suppliedOrigin = APP } = {}) {
  const headers = new Headers({ accept: "application/json", "sec-fetch-site": fetchSite, referer: `${APP}/monitor/` });
  if (suppliedOrigin !== null) headers.set("origin", suppliedOrigin);
  if (body !== null) headers.set("content-type", "application/json");
  if (csrf) headers.set("x-ravenos-csrf", "csrf_test");
  return new Request(`${origin}${path}`, { method, headers, body: body === null ? undefined : JSON.stringify(body) });
}

function authorize(userId = USER_A) {
  return async (req, _env, _deps, options = {}) => {
    if (options.require_csrf && req.headers.get("x-ravenos-csrf") !== "csrf_test") {
      return { response: new Response(JSON.stringify({ ok: false, error: "csrf_invalid" }), { status: 403, headers: { "content-type": "application/json" } }) };
    }
    return { principal: { user_id: userId }, store: {}, now: NOW, response_headers: new Headers() };
  };
}

function entitlementStore(rows = [grant()]) {
  return { async listOwnedGrants() { return rows.map((row) => ({ ...row })); } };
}

function evidence(instrumentId = "hyperliquid:perp:BTC", overrides = {}) {
  return {
    instrument_id: instrumentId,
    source_timestamp: NOW - 30,
    source_state: "qualified",
    source_kind: "raven_perps_public_safe_projection",
    evidence_role: "raven_measurement",
    maximum_age_seconds: 900,
    classifications: {
      evidence_strength: "qualified",
      pressure_regime: "balanced",
      funding_regime: "neutral",
      liquidity_quality: "healthy",
      availability_state: "available",
    },
    limitations: ["Research only."],
    ...overrides,
  };
}

function watch(overrides = {}) {
  return {
    watch_id: `wat_${"w".repeat(18)}`,
    user_id: USER_A,
    instrument_id: "hyperliquid:perp:BTC",
    instrument_type: "perpetual",
    identity_scope: "exact_instrument",
    asset_class: "crypto",
    chain_id: "hyperliquid",
    venue_id: "hyperliquid",
    market_type: "perpetual",
    base_symbol: "BTC",
    quote_symbol: "USD",
    display_label: "BTC perpetual",
    timeframe: "1h",
    indicators_json: "[]",
    raven_overlays_json: "[]",
    density: "comfortable",
    selected_panel: "chart",
    availability_state: "available",
    availability_checked_at: NOW - 30,
    ...overrides,
  };
}

class MemoryStore {
  constructor({ watches = [watch()], rules = [], notifications = [] } = {}) {
    this.watches = watches.map((row) => ({ ...row }));
    this.rules = rules.map((row) => ({ ...row }));
    this.notifications = notifications.map((row) => ({ ...row }));
    this.lease = null;
    this.commitAllowed = true;
  }
  async getWatchOwned(userId, watchId) { return this.watches.find((row) => row.user_id === userId && row.watch_id === watchId) || null; }
  join(rule) { return rule ? { ...this.watches.find((row) => row.watch_id === rule.watch_id), ...rule } : null; }
  async listRules(userId) { return this.rules.filter((row) => row.user_id === userId).map((row) => this.join(row)); }
  async getRuleOwned(userId, ruleId) { return this.join(this.rules.find((row) => row.user_id === userId && row.rule_id === ruleId)); }
  async getRuleByWatch(userId, watchId) { return this.rules.find((row) => row.user_id === userId && row.watch_id === watchId) || null; }
  async createRule({ rule_id, user_id, watch: sourceWatch, event_types, evidence: sourceEvidence, now }) {
    const existing = await this.getRuleByWatch(user_id, sourceWatch.watch_id);
    if (existing) return { row: this.join(existing), created: false };
    if (this.rules.filter((row) => row.user_id === user_id).length >= CustomerMonitorAlertLimits.maximum_monitor_rules) throw new CustomerMonitorError("monitor_rule_quota_exceeded");
    const row = { rule_id, schema_version: "ravenos.monitor_rule.v1", user_id, watch_id: sourceWatch.watch_id, instrument_id: sourceWatch.instrument_id, chain_id: sourceWatch.chain_id, venue_id: sourceWatch.venue_id, event_types_json: JSON.stringify(event_types), state: "active", cooldown_seconds: 900, last_source_timestamp: sourceEvidence.source_timestamp, last_evidence_json: JSON.stringify(sourceEvidence), next_eligible_evaluation_at: now + 300, revision: 1, created_at: now, updated_at: now };
    this.rules.push(row);
    return { row: this.join(row), created: true };
  }
  async updateRule(userId, ruleId, update) {
    const row = this.rules.find((candidate) => candidate.user_id === userId && candidate.rule_id === ruleId && candidate.revision === update.expected_revision);
    if (!row) return null;
    row.state = update.state; row.event_types_json = JSON.stringify(update.event_types); row.revision += 1; row.updated_at = update.now;
    return this.join(row);
  }
  async deleteRule(userId, ruleId) { const before = this.rules.length; this.rules = this.rules.filter((row) => !(row.user_id === userId && row.rule_id === ruleId)); this.notifications = this.notifications.filter((row) => row.rule_id !== ruleId); return before - this.rules.length; }
  async listNotifications(userId, now) { return this.notifications.filter((row) => row.user_id === userId && row.retention_expires_at > now).map((row) => this.join({ ...row, watch_id: this.rules.find((rule) => rule.rule_id === row.rule_id)?.watch_id })); }
  async markNotificationRead(userId, notificationId, now) { const row = this.notifications.find((item) => item.user_id === userId && item.notification_id === notificationId && item.retention_expires_at > now); if (!row) return null; row.read_at ||= now; return row; }
  async deleteNotificationHistory(userId) { const before = this.notifications.length; this.notifications = this.notifications.filter((row) => row.user_id !== userId); return before - this.notifications.length; }
  async deleteAllOwned(userId) { const notifications = await this.deleteNotificationHistory(userId); const before = this.rules.length; this.rules = this.rules.filter((row) => row.user_id !== userId); return { notifications, rules: before - this.rules.length }; }
  async acquireLease(token) { if (this.lease && this.lease !== token) return { acquired: false, cursor: null }; this.lease = token; return { acquired: true, cursor: null }; }
  async listDueRules() { return this.rules.filter((row) => row.state === "active").map((row) => this.join(row)); }
  async latestNotificationAt(ruleId, eventType) { return Math.max(0, ...this.notifications.filter((row) => row.rule_id === ruleId && row.event_type === eventType).map((row) => row.detected_at)); }
  async deleteExpiredNotifications(now) { const before = this.notifications.length; this.notifications = this.notifications.filter((row) => row.retention_expires_at > now); return before - this.notifications.length; }
  async notificationCount(userId, now) { return this.notifications.filter((row) => row.user_id === userId && row.retention_expires_at > now).length; }
  async insertNotification(record) { if (this.notifications.some((row) => row.dedupe_key === record.dedupe_key)) return false; this.notifications.push({ ...record, before_state_json: JSON.stringify(record.before_state), after_state_json: JSON.stringify(record.after_state), limitations_json: JSON.stringify(record.limitations), deep_link_context_json: JSON.stringify(record.deep_link_context), read_at: null }); return true; }
  async commitEvaluation(ruleId, previous, sourceEvidence, now) { const row = this.rules.find((item) => item.rule_id === ruleId); if (!row || !this.commitAllowed || Number(row.last_source_timestamp) !== Number(previous)) return false; row.last_source_timestamp = sourceEvidence.source_timestamp; row.last_evidence_json = JSON.stringify(sourceEvidence); row.updated_at = now; return true; }
  async releaseLease() { this.lease = null; }
}

function routeDeps(store, { grants = [grant()], userId = USER_A, resolveEvidence = evidence(), authorizeRequest = authorize(userId) } = {}) {
  return {
    monitorStore: store,
    entitlementStore: entitlementStore(grants),
    authorizeRequest,
    consumeRateLimit: async () => ({ allowed: true, retry_after_seconds: 0 }),
    resolveCurrentEvidence: async () => resolveEvidence,
  };
}

async function json(response) { return JSON.parse(await response.text()); }

function seededRule(overrides = {}) {
  const sourceEvidence = evidence();
  return {
    rule_id: `mon_${"r".repeat(18)}`,
    user_id: USER_A,
    watch_id: watch().watch_id,
    instrument_id: "hyperliquid:perp:BTC",
    chain_id: "hyperliquid",
    venue_id: "hyperliquid",
    event_types_json: JSON.stringify(["pressure_regime_changed", "funding_regime_changed", "liquidity_quality_changed", "exact_market_availability_changed"]),
    state: "active",
    cooldown_seconds: 900,
    last_source_timestamp: sourceEvidence.source_timestamp,
    last_evidence_json: JSON.stringify(sourceEvidence),
    next_eligible_evaluation_at: NOW,
    revision: 1,
    created_at: NOW - 100,
    updated_at: NOW - 100,
    ...overrides,
  };
}

test("monitor capability is implemented-dormant behind independent default-off controls", () => {
  assert.deepEqual(resolveMonitorAlertFlags({}), { entitlement_resolution: false, capability: false, customer_rule_routes: false, evaluation: false, notification_history: false });
  assert.deepEqual(resolveMonitorAlertActivation({}), { rules: false, notifications: false, evaluator: false });
  assert.deepEqual(resolveMonitorAlertActivation(env()), { rules: true, notifications: true, evaluator: true });
  for (const key of Object.keys(resolveMonitorAlertFlags({}))) assert.equal(resolveMonitorAlertActivation(env({ [CustomerMonitorAlertContract.activation_flags[key]]: "0" })).evaluator, false);
  assert.equal(CustomerEntitlementContract.capabilities["research.alerts"].implementation_state, "implemented_dormant");
  assert.equal(resolveEntitlementFeatureFlags({}).capability_enablement["research.alerts"], false);
  assert.equal(resolveCapabilityAccess({ capability: "research.alerts", user_id: USER_A, grants: [grant()], now: NOW, flags: resolveEntitlementFeatureFlags(env()) }).available, true);
  assert.equal(CustomerMonitorAlertContract.plan_prices_stored, false);
  assert.equal(CustomerMonitorAlertContract.out_of_app_delivery_active, false);
});

test("migration preserves exact ownership, quotas, append-only history, lease, retention, and prohibited-data boundaries", () => {
  const sql = readFileSync("customer-migrations/0004_customer_monitor_alerts.sql", "utf8");
  assert.match(sql, /REFERENCES ravenos_users\(user_id\) ON DELETE CASCADE/);
  assert.match(sql, /REFERENCES ravenos_customer_watch_items\(watch_id\) ON DELETE CASCADE/);
  assert.match(sql, /instrument_id = exact_market_identity/);
  assert.match(sql, /monitor_rule_quota_exceeded/);
  assert.match(sql, /notification_quota_exceeded/);
  assert.match(sql, /notification_event_append_only/);
  assert.match(sql, /notification_read_state_immutable/);
  assert.match(sql, /ravenos_monitor_evaluator_leases/);
  assert.match(sql, /retention_expires_at/);
  assert(!/wallet|position|order|private_key|seed_phrase|provider_payload|entry_price|target_price|invalidation_price|html|script/i.test(sql.replace(/--[^\n]*/g, "")));
});

test("qualified evidence preserves exact lineage while stale, fallback, malformed, and mismatched evidence fail closed", () => {
  assert.equal(normalizeMonitorEvidence(evidence(), { expected_instrument_id: "hyperliquid:perp:BTC", now: NOW }).qualified, true);
  assert.equal(normalizeMonitorEvidence(evidence("hyperliquid:perp:ETH"), { expected_instrument_id: "hyperliquid:perp:BTC", now: NOW }).reason, "evidence_lineage_mismatch");
  assert.equal(normalizeMonitorEvidence(evidence(undefined, { source_state: "stale" }), { expected_instrument_id: "hyperliquid:perp:BTC", now: NOW }).reason, "evidence_stale");
  assert.equal(normalizeMonitorEvidence(evidence(undefined, { source_state: "fallback" }), { expected_instrument_id: "hyperliquid:perp:BTC", now: NOW }).reason, "evidence_unqualified");
  assert.equal(normalizeMonitorEvidence({ nope: true }, { expected_instrument_id: "hyperliquid:perp:BTC", now: NOW }).qualified, false);
});

test("classification changes are deterministic and ordinary numerical fluctuations have no transition contract", () => {
  const before = normalizeMonitorEvidence(evidence(), { expected_instrument_id: "hyperliquid:perp:BTC", now: NOW });
  const after = normalizeMonitorEvidence(evidence(undefined, { source_timestamp: NOW, classifications: { ...evidence().classifications, pressure_regime: "crowded long", funding_regime: "positive", liquidity_quality: "thin" }, mark_price: 999 }), { expected_instrument_id: "hyperliquid:perp:BTC", now: NOW });
  assert.deepEqual(compareMonitorEvidence(before, after).map((row) => row.event_type), ["pressure_regime_changed", "funding_regime_changed", "liquidity_quality_changed"]);
  assert.equal(JSON.stringify(compareMonitorEvidence(before, after)), JSON.stringify(compareMonitorEvidence(before, after)));
});

test("authenticated create is exact, idempotent, owner-scoped, and refuses unsupported event types", async () => {
  const store = new MemoryStore();
  const path = `${CUSTOMER_MONITOR_ALERTS_ROUTE}/rules`;
  const body = { watch_id: watch().watch_id, event_types: ["pressure_regime_changed"] };
  const first = await routeCustomerMonitorAlerts(request(path, { method: "POST", body }), env(), routeDeps(store));
  const second = await routeCustomerMonitorAlerts(request(path, { method: "POST", body }), env(), routeDeps(store));
  assert.equal(first.status, 201);
  assert.equal((await json(first)).rule.market.instrument_id, "hyperliquid:perp:BTC");
  assert.equal(second.status, 200);
  assert.equal(store.rules.length, 1);
  const unsupported = await routeCustomerMonitorAlerts(request(path, { method: "POST", body: { ...body, event_types: ["launch_lifecycle_changed"] } }), env(), routeDeps(new MemoryStore()));
  assert.equal(unsupported.status, 400);
  const crossAccount = await routeCustomerMonitorAlerts(request(path, { method: "POST", body }), env(), routeDeps(store, { userId: USER_B, grants: [grant({ user_id: USER_B })] }));
  assert.equal(crossAccount.status, 404);
});

test("same-symbol pools remain independent exact identities", async () => {
  const a = watch({ watch_id: `wat_${"a".repeat(18)}`, instrument_id: "solana:pool:11111111111111111111111111111111", instrument_type: "exact_pool", identity_scope: "exact_pool", chain_id: "solana", venue_id: "onchain", market_type: "spot", base_symbol: null, quote_symbol: null, display_label: "SAME / USDC" });
  const b = watch({ watch_id: `wat_${"b".repeat(18)}`, instrument_id: "solana:pool:So11111111111111111111111111111111111111112", instrument_type: "exact_pool", identity_scope: "exact_pool", chain_id: "solana", venue_id: "onchain", market_type: "spot", base_symbol: null, quote_symbol: null, display_label: "SAME / USDC" });
  const store = new MemoryStore({ watches: [a, b] });
  for (const item of [a, b]) {
    const result = await routeCustomerMonitorAlerts(request(`${CUSTOMER_MONITOR_ALERTS_ROUTE}/rules`, { method: "POST", body: { watch_id: item.watch_id, event_types: ["exact_market_availability_changed"] } }), env(), routeDeps(store, { resolveEvidence: evidence(item.instrument_id, { evidence_role: "market_fact", classifications: { availability_state: "available" } }) }));
    assert.equal(result.status, 201);
  }
  assert.equal(store.rules.length, 2);
  assert.notEqual(store.rules[0].instrument_id, store.rules[1].instrument_id);
});

test("anonymous, cross-origin, missing-CSRF, malformed, and oversized requests fail closed", async () => {
  const path = `${CUSTOMER_MONITOR_ALERTS_ROUTE}/rules`;
  const store = new MemoryStore();
  const denied = async () => ({ response: new Response("{}", { status: 401 }) });
  assert.equal((await routeCustomerMonitorAlerts(request(path), env(), routeDeps(store, { authorizeRequest: denied }))).status, 401);
  assert.equal((await routeCustomerMonitorAlerts(request(path, { suppliedOrigin: "https://evil.example" }), env(), routeDeps(store))).status, 403);
  assert.equal((await routeCustomerMonitorAlerts(request(path, { fetchSite: "cross-site" }), env(), routeDeps(store))).status, 403);
  assert.equal((await routeCustomerMonitorAlerts(request(path, { method: "POST", body: {}, csrf: false }), env(), routeDeps(store))).status, 403);
  assert.equal((await routeCustomerMonitorAlerts(request(path, { method: "POST", body: { watch_id: "x", event_types: [], extra: true } }), env(), routeDeps(store))).status, 400);
  const huge = request(path, { method: "POST", body: { data: "x".repeat(CustomerMonitorAlertLimits.maximum_request_bytes + 1) } });
  assert.equal((await routeCustomerMonitorAlerts(huge, env(), routeDeps(store))).status, 413);
});

test("expired, revoked, suspended, absent, and partial activation fail closed", async () => {
  const path = `${CUSTOMER_MONITOR_ALERTS_ROUTE}/rules`;
  for (const state of ["expired", "revoked", "suspended"]) {
    const response = await routeCustomerMonitorAlerts(request(path), env(), routeDeps(new MemoryStore(), { grants: [grant({ state, expires_at: state === "expired" ? NOW - 1 : NOW + 1 })] }));
    assert.equal(response.status, 403, state);
  }
  assert.equal((await routeCustomerMonitorAlerts(request(path), env(), routeDeps(new MemoryStore(), { grants: [] }))).status, 403);
  assert.equal((await routeCustomerMonitorAlerts(request(path), env({ RAVENOS_RESEARCH_ALERT_RULE_ROUTES_ENABLE: "0" }), routeDeps(new MemoryStore()))).status, 503);
  assert.equal((await routeCustomerMonitorAlerts(request(`${CUSTOMER_MONITOR_ALERTS_ROUTE}/notifications`), env({ RAVENOS_NOTIFICATION_HISTORY_ENABLE: "0" }), routeDeps(new MemoryStore()))).status, 503);
  const moduleSource = readFileSync("lib/customer_monitor_alerts.mjs", "utf8");
  assert.match(moduleSource, /g\.capability_key = 'research\.alerts' AND g\.state = 'active'/);
  assert.match(moduleSource, /g\.activation_at IS NULL OR g\.activation_at <= \?/);
  assert.match(moduleSource, /g\.expires_at IS NULL OR g\.expires_at > \?/);
});

test("qualified transition creates one notification; repeated, older, stale, and malformed evidence create none", async () => {
  const rule = seededRule();
  const store = new MemoryStore({ rules: [rule] });
  let calls = 0;
  const next = evidence(undefined, { source_timestamp: NOW, classifications: { ...evidence().classifications, pressure_regime: "crowded long" } });
  const deps = { monitorStore: store, nowMs: NOW * 1000, async loadEvidenceBatch(ids) { calls += 1; assert.deepEqual(ids, [rule.instrument_id]); return { source_calls: 1, evidence: { [rule.instrument_id]: next } }; } };
  const first = await runCustomerMonitorEvaluator(env(), deps);
  assert.equal(first.notifications_created, 1);
  assert.equal(store.notifications.length, 1);
  const repeated = await runCustomerMonitorEvaluator(env(), deps);
  assert.equal(repeated.notifications_created, 0);
  assert.equal(store.notifications.length, 1);
  assert.equal(calls, 2);
  const oldStore = new MemoryStore({ rules: [seededRule()] });
  const older = await runCustomerMonitorEvaluator(env(), { monitorStore: oldStore, nowMs: NOW * 1000, async loadEvidenceBatch() { return { source_calls: 1, evidence: { [rule.instrument_id]: evidence(undefined, { source_timestamp: NOW - 60 }) } }; } });
  assert.equal(older.out_of_order_skipped, 1);
  const staleStore = new MemoryStore({ rules: [seededRule()] });
  const stale = await runCustomerMonitorEvaluator(env(), { monitorStore: staleStore, nowMs: NOW * 1000, async loadEvidenceBatch() { return { source_calls: 1, evidence: { [rule.instrument_id]: evidence(undefined, { source_state: "stale" }) } }; } });
  assert.equal(stale.stale_or_invalid_skipped, 1);
});

test("one exact unavailable transition is emitted and never remapped or repeated", async () => {
  const rule = seededRule({ event_types_json: JSON.stringify(["exact_market_availability_changed"]) });
  const store = new MemoryStore({ rules: [rule] });
  const unavailable = evidence(undefined, { source_timestamp: NOW, evidence_role: "market_fact", classifications: { availability_state: "unavailable" } });
  const deps = { monitorStore: store, nowMs: NOW * 1000, async loadEvidenceBatch() { return { source_calls: 1, evidence: { [rule.instrument_id]: unavailable } }; } };
  assert.equal((await runCustomerMonitorEvaluator(env(), deps)).notifications_created, 1);
  assert.equal(store.notifications[0].instrument_id, rule.instrument_id);
  assert.equal(store.notifications[0].explanation, "This exact market is no longer available.");
  assert.equal((await runCustomerMonitorEvaluator(env(), deps)).notifications_created, 0);
});

test("batch evaluator reuses one source load across owners and exact rules", async () => {
  const secondWatch = watch({ watch_id: `wat_${"z".repeat(18)}`, user_id: USER_B });
  const rules = [seededRule(), seededRule({ rule_id: `mon_${"s".repeat(18)}`, user_id: USER_B, watch_id: secondWatch.watch_id })];
  const store = new MemoryStore({ watches: [watch(), secondWatch], rules });
  let calls = 0;
  const result = await runCustomerMonitorEvaluator(env(), { monitorStore: store, nowMs: NOW * 1000, async loadEvidenceBatch(ids) { calls += 1; assert.equal(ids.length, 1); return { source_calls: 2, evidence: { "hyperliquid:perp:BTC": evidence(undefined, { source_timestamp: NOW, classifications: { ...evidence().classifications, pressure_regime: "crowded long" } }) } }; } });
  assert.equal(calls, 1);
  assert.equal(result.rules_seen, 2);
  assert.equal(result.sources_loaded, 2);
  assert.equal(result.notifications_created, 2);
});

test("lease, optimistic commits, cooldown, notification quota, and paused rules prevent duplicates", async () => {
  const rule = seededRule();
  const store = new MemoryStore({ rules: [rule] });
  store.lease = "other";
  assert.equal((await runCustomerMonitorEvaluator(env(), { monitorStore: store, nowMs: NOW * 1000, loadEvidenceBatch: async () => ({}) })).state, "lease_unavailable");
  store.lease = null;
  store.commitAllowed = false;
  const changed = evidence(undefined, { source_timestamp: NOW, classifications: { ...evidence().classifications, pressure_regime: "crowded long" } });
  assert.equal((await runCustomerMonitorEvaluator(env(), { monitorStore: store, nowMs: NOW * 1000, loadEvidenceBatch: async () => ({ evidence: { [rule.instrument_id]: changed } }) })).concurrent_skipped, 1);
  const paused = new MemoryStore({ rules: [seededRule({ state: "paused" })] });
  assert.equal((await runCustomerMonitorEvaluator(env(), { monitorStore: paused, nowMs: NOW * 1000, loadEvidenceBatch: async () => { throw new Error("must not load"); } })).rules_seen, 0);
});

test("rule and notification quotas fail explicitly without relaxing bounded state", async () => {
  const target = watch({ watch_id: `wat_${"q".repeat(18)}` });
  const fullRuleStore = new MemoryStore({
    watches: [target],
    rules: Array.from({ length: CustomerMonitorAlertLimits.maximum_monitor_rules }, (_, index) => seededRule({
      rule_id: `mon_${String(index).padStart(18, "0")}`,
      watch_id: `wat_${String(index).padStart(18, "0")}`,
    })),
  });
  const quotaResponse = await routeCustomerMonitorAlerts(request(`${CUSTOMER_MONITOR_ALERTS_ROUTE}/rules`, {
    method: "POST",
    body: { watch_id: target.watch_id, event_types: ["pressure_regime_changed"] },
  }), env(), routeDeps(fullRuleStore));
  assert.equal(quotaResponse.status, 409);
  assert.equal((await json(quotaResponse)).error, "monitor_rule_quota_exceeded");

  const rule = seededRule();
  const fullNotificationStore = new MemoryStore({
    rules: [rule],
    notifications: Array.from({ length: CustomerMonitorAlertLimits.maximum_notification_history }, (_, index) => ({
      notification_id: `ntf_${String(index).padStart(18, "0")}`,
      user_id: USER_A,
      rule_id: `mon_unrelated_${index}`,
      event_type: "funding_regime_changed",
      detected_at: NOW - 60,
      dedupe_key: `existing-${index}`,
      retention_expires_at: NOW + 3600,
    })),
  });
  const changed = evidence(undefined, { source_timestamp: NOW, classifications: { ...evidence().classifications, pressure_regime: "crowded long" } });
  const result = await runCustomerMonitorEvaluator(env(), {
    monitorStore: fullNotificationStore,
    nowMs: NOW * 1000,
    loadEvidenceBatch: async () => ({ evidence: { [rule.instrument_id]: changed } }),
  });
  assert.equal(result.notifications_created, 0);
  assert.equal(result.quota_skipped, 1);
  assert.equal(fullNotificationStore.notifications.length, CustomerMonitorAlertLimits.maximum_notification_history);
});

test("expired notification evidence is hidden, unreadable, and purged before evaluation", async () => {
  const rule = seededRule({ state: "paused" });
  const common = {
    schema_version: "ravenos.notification_event.v1",
    user_id: USER_A,
    rule_id: rule.rule_id,
    instrument_id: rule.instrument_id,
    event_type: "pressure_regime_changed",
    before_state_json: JSON.stringify({ field: "pressure_regime", value: "balanced" }),
    after_state_json: JSON.stringify({ field: "pressure_regime", value: "crowded long" }),
    qualified_source_timestamp: NOW - 60,
    detected_at: NOW - 30,
    explanation: "Pressure changed.",
    evidence_role: "raven_measurement",
    limitations_json: JSON.stringify(["Research only."]),
    deep_link_context_json: JSON.stringify({ instrument_id: rule.instrument_id, watch_id: rule.watch_id }),
    read_at: null,
  };
  const expired = { ...common, notification_id: `ntf_${"e".repeat(18)}`, dedupe_key: "expired", retention_expires_at: NOW };
  const current = { ...common, notification_id: `ntf_${"c".repeat(18)}`, dedupe_key: "current", retention_expires_at: NOW + 3600 };
  const store = new MemoryStore({ rules: [rule], notifications: [expired, current] });
  const response = await routeCustomerMonitorAlerts(request(`${CUSTOMER_MONITOR_ALERTS_ROUTE}/notifications`), env(), routeDeps(store));
  const payload = await json(response);
  assert.equal(response.status, 200);
  assert.deepEqual(payload.notifications.map((item) => item.notification_id), [current.notification_id]);
  const expiredRead = await routeCustomerMonitorAlerts(request(`${CUSTOMER_MONITOR_ALERTS_ROUTE}/notifications/${expired.notification_id}/read`, { method: "POST", body: { read: true } }), env(), routeDeps(store));
  assert.equal(expiredRead.status, 404);
  const evaluation = await runCustomerMonitorEvaluator(env(), { monitorStore: store, nowMs: NOW * 1000, loadEvidenceBatch: async () => { throw new Error("must not load"); } });
  assert.equal(evaluation.expired_notifications_deleted, 1);
  assert.deepEqual(store.notifications.map((item) => item.notification_id), [current.notification_id]);
});

test("notification history is escaped by construction, owner-scoped, idempotently read, deletable, and delete-all is bounded", async () => {
  const rule = seededRule();
  const notification = {
    notification_id: `ntf_${"n".repeat(18)}`,
    schema_version: "ravenos.notification_event.v1",
    user_id: USER_A,
    rule_id: rule.rule_id,
    instrument_id: rule.instrument_id,
    event_type: "pressure_regime_changed",
    before_state_json: JSON.stringify({ field: "pressure_regime", value: '<img src=x onerror="globalThis.pwned=1">' }),
    after_state_json: JSON.stringify({ field: "pressure_regime", value: "crowded long" }),
    qualified_source_timestamp: NOW - 30,
    detected_at: NOW,
    dedupe_key: "x",
    explanation: '<script>globalThis.pwned=1</script>Pressure changed.',
    evidence_role: "raven_measurement",
    limitations_json: JSON.stringify(["Research only."]),
    deep_link_context_json: JSON.stringify({ instrument_id: rule.instrument_id, watch_id: rule.watch_id }),
    read_at: null,
    retention_expires_at: NOW + 90 * 86400,
  };
  const store = new MemoryStore({ rules: [rule], notifications: [notification] });
  const listResponse = await routeCustomerMonitorAlerts(request(`${CUSTOMER_MONITOR_ALERTS_ROUTE}/notifications`), env(), routeDeps(store));
  const payload = await json(listResponse);
  assert.equal(listResponse.status, 200);
  assert(!JSON.stringify(payload).includes("<script>"));
  assert(!JSON.stringify(payload).includes("onerror"));
  const readPath = `${CUSTOMER_MONITOR_ALERTS_ROUTE}/notifications/${notification.notification_id}/read`;
  assert.equal((await routeCustomerMonitorAlerts(request(readPath, { method: "POST", body: { read: true } }), env(), routeDeps(store))).status, 200);
  assert.equal((await routeCustomerMonitorAlerts(request(readPath, { method: "POST", body: { read: true } }), env(), routeDeps(store))).status, 200);
  const cross = await routeCustomerMonitorAlerts(request(readPath, { method: "POST", body: { read: true } }), env(), routeDeps(store, { userId: USER_B, grants: [grant({ user_id: USER_B })] }));
  assert.equal(cross.status, 404);
  const deleted = await routeCustomerMonitorAlerts(request(CUSTOMER_MONITOR_ALERTS_ROUTE, { method: "DELETE", body: { confirm: "delete_all_alert_research_state" } }), env(), routeDeps(store));
  assert.deepEqual((await json(deleted)).deleted, { notifications: 1, rules: 1 });
});

test("no storage or delivery surface includes plan prices, wallets, provider payloads, positions, or execution objects", () => {
  const moduleSource = readFileSync("lib/customer_monitor_alerts.mjs", "utf8");
  assert(!/entry_price|target_price|invalidation_price|wallet_address|private_key|transaction_intent|execution_fill|raw_provider_payload/i.test(moduleSource));
  assert.equal(CustomerMonitorAlertContract.provider_payloads_stored, false);
  assert.equal(CustomerMonitorAlertContract.wallet_data_stored, false);
  assert.equal(CustomerMonitorAlertContract.execution_data_stored, false);
});

test("worker keeps Monitor dormant even when the shared shadow-evidence scheduler is active", () => {
  const worker = readFileSync("worker.mjs", "utf8");
  assert.match(worker, /routeCustomerMonitorAlerts/);
  assert.match(worker, /runCustomerMonitorEvaluator/);
  assert.match(worker, /async scheduled/);
  assert.match(worker, /loadMonitorEvidenceBatch/);
  assert(!/RAVENOS_RESEARCH_ALERTS_ENABLE.*[=:]\s*["']1["']/i.test(worker));
  const wrangler = readFileSync("wrangler.jsonc", "utf8");
  for (const flag of Object.values(CustomerMonitorAlertContract.activation_flags)) assert(!wrangler.includes(flag), flag);
  assert.match(wrangler, /"crons"\s*:\s*\[\s*"\*\/5 \* \* \* \*"/);
  assert.match(wrangler, /"RAVENOS_SHADOW_LEDGER_ENABLED"\s*:\s*"1"/);
});
