import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createD1CustomerMonitorAlertStore } from '../lib/customer_monitor_alerts.mjs';
import { resolveProductAccess } from '../lib/customer_pro.mjs';

const NOW = 1_789_038_000, USER = 'usr_' + 'a'.repeat(32), WATCH = 'wat_' + 'w'.repeat(18), RULE = 'mon_' + 'r'.repeat(18);
function database(t) {
  const raw = new DatabaseSync(':memory:'); t.after(() => raw.close());
  for (const name of readdirSync('customer-migrations').filter(name => /^\d+.*\.sql$/.test(name)).sort()) raw.exec(readFileSync(`customer-migrations/${name}`, 'utf8'));
  const db = { raw, async batch(statements) {
    raw.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); raw.exec('COMMIT'); return results; }
    catch (error) { raw.exec('ROLLBACK'); throw error; }
  }, prepare(sql) {
    const prepare = bindings => ({ async first() { return raw.prepare(sql).get(...bindings) || null; }, async all() { return { results: raw.prepare(sql).all(...bindings) }; }, async run() { return { meta: { changes: Number(raw.prepare(sql).run(...bindings).changes) } }; } });
    return { ...prepare([]), bind: (...bindings) => prepare(bindings) };
  } };
  raw.prepare("INSERT INTO ravenos_users (user_id,state,primary_email,created_at,updated_at,last_authenticated_at) VALUES (?,'active','fixture@example.test',?,?,?)").run(USER, NOW - 1000, NOW - 1000, NOW - 1000);
  raw.prepare(`INSERT INTO ravenos_customer_watch_items (watch_id,user_id,instrument_id,instrument_type,identity_scope,asset_class,chain_id,venue_id,market_type,display_label,timeframe,indicators_json,raven_overlays_json,density,selected_panel,content_hash,availability_state,created_at,updated_at)
    VALUES (?,?,'hyperliquid:perp:BTC','perpetual','exact_instrument','crypto','hyperliquid','hyperliquid','perpetual','BTC perpetual','1h','[]','[]','comfortable','chart','fixture','available',?,?)`).run(WATCH, USER, NOW - 1000, NOW - 1000);
  raw.prepare(`INSERT INTO ravenos_customer_monitor_rules (rule_id,user_id,watch_id,instrument_id,chain_id,venue_id,exact_market_identity,event_types_json,state,last_source_timestamp,last_evidence_json,next_eligible_evaluation_at,created_at,updated_at)
    VALUES (?,?,?,'hyperliquid:perp:BTC','hyperliquid','hyperliquid','hyperliquid:perp:BTC','["pressure_regime_changed"]','active',?,'{}',?,?,?)`).run(RULE, USER, WATCH, NOW - 600, NOW, NOW - 1000, NOW - 1000);
  return { db, store: createD1CustomerMonitorAlertStore(db) };
}
function grant(db) {
  db.raw.prepare(`INSERT INTO ravenos_customer_entitlement_grants (grant_id,user_id,capability_key,state,grant_source,activation_at,expires_at,created_at,updated_at,source_reference)
    VALUES (?,?,'research.alerts','active','test_fixture',?,?,?,?,'fixture')`).run('ent_' + 'g'.repeat(20), USER, NOW - 10, NOW + 1000, NOW - 10, NOW - 10);
}
function subscription(db, value = {}) {
  const s = { status: 'active', period_start: NOW - 100, period_end: NOW + 100, paid_history: 1, cancel_at_period_end: 0, ...value };
  db.raw.prepare(`INSERT INTO ravenos_pro_subscriptions (user_id,stripe_customer_id,status,period_start,period_end,paid_history,cancel_at_period_end,updated_at)
    VALUES (?,'cus_fixture',?,?,?,?,?,?)`).run(USER, s.status, s.period_start, s.period_end, s.paid_history, s.cancel_at_period_end, NOW);
  return s;
}
const evidence = { schema_version: 'ravenos.monitor_evidence.v1', instrument_id: 'hyperliquid:perp:BTC', source_timestamp: NOW, classifications: { pressure_regime: 'balanced' } };
function notification() {
  return { notification_id: 'ntf_' + 'n'.repeat(18), rule_id: RULE, user_id: USER, instrument_id: evidence.instrument_id,
    rule_revision: 1, event_type: 'pressure_regime_changed', before_state: { value: 'crowded long' }, after_state: { value: 'balanced' }, source_timestamp: NOW,
    detected_at: NOW, dedupe_key: 'fixture', explanation: 'Pressure changed.', evidence_role: 'raven_measurement', limitations: [], deep_link_context: { instrument_id: evidence.instrument_id }, retention_expires_at: NOW + 86400 };
}

test('an active product trial receives due alert evaluation without a manual grant', async t => {
  const { db, store } = database(t);
  db.raw.prepare(`INSERT INTO ravenos_pro_trials VALUES (?,?,?,?,?,'ACTIVE','fixture',?)`).run(USER, 'a'.repeat(64), 'b'.repeat(64), NOW - 100, NOW + 100, NOW - 100);
  assert.equal((await store.listDueRules(NOW, null)).length, 1);
  assert.equal((await store.listDueRules(NOW + 100, null)).length, 0);
});

test('scheduler paid eligibility matches product access, including funded cancellation and expiry', async t => {
  for (const override of [{}, { status: 'past_due' }, { cancel_at_period_end: 1 }, { status: 'cancelled' }, { status: 'trialing', paid_history: 0 }, { period_end: NOW }, { period_start: NOW + 1 }, { paid_history: 0 }]) {
    const { db, store } = database(t), s = subscription(db, override);
    assert.equal((await store.listDueRules(NOW, null)).length, resolveProductAccess({ subscription: s, now: NOW }).pro ? 1 : 0, JSON.stringify(override));
  }
});

test('manual grants still work, while an account on security hold cannot receive evaluations', async t => {
  const { db, store } = database(t); grant(db);
  assert.equal((await store.listDueRules(NOW, null)).length, 1);
  db.raw.prepare("UPDATE ravenos_users SET state='security_hold' WHERE user_id=?").run(USER);
  assert.equal((await store.listDueRules(NOW, null)).length, 0);
});

test('pause or settings revision during source loading prevents baseline commit', async t => {
  for (const mutation of ["state='paused'", 'revision=revision+1']) {
    const { db, store } = database(t); grant(db);
    db.raw.exec(`UPDATE ravenos_customer_monitor_rules SET ${mutation}`);
    assert.equal(await store.commitEvaluation(RULE, NOW - 600, evidence, NOW, 1), false);
  }
});

test('pause, edit, expiry or revoked access after evaluation prevents notification insertion', async t => {
  for (const mutation of ["UPDATE ravenos_customer_monitor_rules SET state='paused'", 'UPDATE ravenos_customer_monitor_rules SET revision=revision+1', "UPDATE ravenos_customer_entitlement_grants SET state='revoked'", `UPDATE ravenos_customer_entitlement_grants SET expires_at=${NOW}`]) {
    const { db, store } = database(t); grant(db);
    assert.equal(await store.commitEvaluation(RULE, NOW - 600, evidence, NOW, 1), true);
    db.raw.exec(mutation);
    assert.equal(await store.insertNotification(notification()), false, mutation);
  }
});

test('current evaluation records one notification and remains owner/instrument/revision bound', async t => {
  const { db, store } = database(t); subscription(db);
  assert.equal(await store.commitEvaluation(RULE, NOW - 600, evidence, NOW, 1), true);
  assert.equal(await store.insertNotification({ ...notification(), instrument_id: 'hyperliquid:perp:SOL' }), false);
  assert.equal(await store.insertNotification({ ...notification(), user_id: 'usr_' + 'b'.repeat(32) }), false);
  assert.equal(await store.insertNotification(notification()), true);
  assert.equal(await store.insertNotification(notification()), false);
});


test('an insert failure rolls back the baseline and retry delivers exactly once', async t => {
  const { db, store } = database(t); grant(db);
  const rule = (await store.listDueRules(NOW, null))[0];
  db.raw.exec("CREATE TRIGGER fixture_failure BEFORE INSERT ON ravenos_customer_notification_events BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END");
  await assert.rejects(store.commitEvaluationAndNotifications(rule, NOW - 600, evidence, NOW, [notification()]), /fixture write failure/);
  assert.equal(db.raw.prepare('SELECT last_source_timestamp FROM ravenos_customer_monitor_rules').get().last_source_timestamp, NOW - 600);
  db.raw.exec('DROP TRIGGER fixture_failure');
  assert.deepEqual(await store.commitEvaluationAndNotifications(rule, NOW - 600, evidence, NOW, [notification()]), { committed: true, notifications_created: 1 });
  assert.deepEqual(await store.commitEvaluationAndNotifications(rule, NOW - 600, evidence, NOW, [notification()]), { committed: false, notifications_created: 0 });
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM ravenos_customer_notification_events').get().n, 1);
});
