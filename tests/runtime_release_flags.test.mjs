import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import worker from '../worker.mjs';
import { RELEASE_FLAGS_BINDING, packReleaseFlags, resolveReleaseFlags, assertReleaseBindingPreservation } from '../lib/runtime_release_flags.mjs';

test('each independent alert release flag is packed and can be disabled separately', () => {
  const flags = Object.fromEntries(['RAVENOS_RESEARCH_ALERTS_ENABLE', 'RAVENOS_RESEARCH_ALERT_RULE_ROUTES_ENABLE', 'RAVENOS_RESEARCH_ALERT_EVALUATION_ENABLE', 'RAVENOS_NOTIFICATION_HISTORY_ENABLE'].map(name => [name, '1']));
  const packed = packReleaseFlags(flags);
  assert.deepEqual(packed[RELEASE_FLAGS_BINDING], flags);
  for (const name of Object.keys(flags)) assert.equal(resolveReleaseFlags({ ...packed, [name]: '0' })[name], '0');
});

test('packing preserves all configured values and leaves release enforcement separate', () => {
  const vars = { ...JSON.parse(readFileSync('wrangler.jsonc', 'utf8')).vars, RAVENOS_RELEASE_ENFORCE: '1', LIVE_SHIELDED_EXECUTION_ENABLED: '0' };
  const packed = packReleaseFlags(vars);
  const { [RELEASE_FLAGS_BINDING]: flags, ...restored } = resolveReleaseFlags(packed);
  assert.deepEqual(restored, vars);
  assert.equal(packed.RAVENOS_RELEASE_ENFORCE, '1');
  assert.equal(flags.LIVE_SHIELDED_EXECUTION_ENABLED, '0');
  assert.ok(Object.keys(packed).length < Object.keys(vars).length);
  assert.ok(JSON.stringify(flags).length <= 5000);
});

test('flat kill switches override packed defaults without copying or replacing secrets and resources', () => {
  const database = { prepare() {} }, assets = { fetch() {} };
  const env = { [RELEASE_FLAGS_BINDING]: { RAVENOS_WALLET_INTELLIGENCE_ENABLED: '1' },
    RAVENOS_WALLET_INTELLIGENCE_ENABLED: '0', API_SECRET: 'test-server-only', RAVENOS_DB: database, ASSETS: assets };
  const resolved = resolveReleaseFlags(env);
  assert.equal(resolved.RAVENOS_WALLET_INTELLIGENCE_ENABLED, '0');
  assert.equal(resolved.API_SECRET, 'test-server-only');
  assert.equal(resolved.RAVENOS_DB, database);
  assert.equal(resolved.ASSETS, assets);
  assert.equal(env[RELEASE_FLAGS_BINDING].RAVENOS_WALLET_INTELLIGENCE_ENABLED, '1');
});

test('JSON environment strings work while undeclared keys, malformed flags and prototype keys fail closed', () => {
  assert.equal(resolveReleaseFlags({ [RELEASE_FLAGS_BINDING]: '{"RAVENOS_COINGECKO_ENABLED":"0"}' }).RAVENOS_COINGECKO_ENABLED, '0');
  for (const value of ['{', 'null', '[]', '{"__proto__":{"admin":true}}', { API_SECRET: 'private' },
    { RAVENOS_RELEASE_ENFORCE: '0' }, { RAVENOS_PRIVY_ENABLED: true }, { RAVENOS_PRIVY_ENABLED: 'yes' }]) {
    assert.throws(() => resolveReleaseFlags({ [RELEASE_FLAGS_BINDING]: value }), /^Error: Invalid release flags$/);
  }
});

test('configuration migration refuses to discard an existing operator setting', () => {
  const existing = [{ name: 'RAVENOS_PRIVY_ENABLED', type: 'plain_text' }, { name: 'STRIPE_SECRET', type: 'secret_text' }];
  assert.doesNotThrow(() => assertReleaseBindingPreservation(existing, packReleaseFlags({ RAVENOS_PRIVY_ENABLED: '1' })));
  assert.throws(() => assertReleaseBindingPreservation([...existing, { name: 'CUSTOM_GATE', type: 'plain_text' }], packReleaseFlags({ RAVENOS_PRIVY_ENABLED: '1' })), /CUSTOM_GATE/);
});

test('invalid packed configuration is rejected by HTTP and scheduled entrypoints without echoing values', async () => {
  const env = { [RELEASE_FLAGS_BINDING]: { API_SECRET: 'do-not-echo-this' } };
  const response = await worker.fetch(new Request('https://ravenos.xyz/api/build'), env);
  assert.equal(response.status, 503);
  assert.equal(await response.text(), 'Service configuration unavailable');
  await assert.rejects(worker.scheduled({ cron: '*/2 * * * *' }, env, {}), /^Error: Invalid release flags$/);
});
