import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDexScreenerActivity } from '../lib/market_provider_fallbacks.mjs';
import { buildOnchainMonitorEvidence, onchainMonitorInstrumentIds } from '../lib/customer_monitor_evidence.mjs';
import { normalizeMonitorEvidence, compareMonitorEvidence } from '../lib/customer_monitor_alerts.mjs';
import { loadMonitorEvidenceBatch } from '../worker.mjs';
import { collectParticipationUniverse } from '../lib/participation_universe.mjs';

const NOW = Math.floor(Date.now() / 1000);
const addr = n => '0x' + n.toString(16).padStart(40, '0');
const sol = ['So11111111111111111111111111111111111111112', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', '11111111111111111111111111111111'];
function row(chain = 'base', buys = 70, sells = 30) {
  return normalizeDexScreenerActivity({
    chainId: chain, pairAddress: chain === 'solana' ? sol[0] : addr(1), dexId: 'fixture',
    baseToken: { address: chain === 'solana' ? sol[1] : addr(2), symbol: 'TOKEN' },
    quoteToken: { address: chain === 'solana' ? sol[2] : addr(3), symbol: 'QUOTE' },
    priceUsd: '0.001', liquidity: { usd: 100000 }, txns: { h1: { buys, sells } },
  }, { chain, observedAt: new Date(NOW * 1000).toISOString(), nowMs: NOW * 1000 });
}
const snapshot = rows => ({ schema_version: 'ravenos.participation_universe.v1', ok: true, safe_public: true, rows });
const build = rows => buildOnchainMonitorEvidence(snapshot(rows), rows.map(r => r.instrument_id), { now: NOW });

test('all five chains use their exact fresh pool, never a paired token or another pool', () => {
  const rows = ['solana', 'base', 'ethereum', 'bsc', 'robinhood'].map(chain => row(chain));
  const result = build(rows);
  assert.equal(Object.keys(result).length, 5);
  for (const r of rows) {
    assert.equal(result[r.instrument_id].classifications.pressure_regime, '1h buy-led');
    assert.equal(normalizeMonitorEvidence(result[r.instrument_id], { expected_instrument_id: r.instrument_id, now: NOW }).qualified, true);
  }
  assert.deepEqual(buildOnchainMonitorEvidence(snapshot(rows), [`base:pool:${addr(99)}`], { now: NOW }), {});
});

test('full EVM pool hashes qualify without allowing hashes to masquerade as token addresses', () => {
  const pool = '0x' + 'ab'.repeat(32), otherPool = pool.slice(0, -2) + 'cd';
  for (const chain of ['base', 'ethereum', 'bsc', 'robinhood']) {
    const r = { ...row(chain), instrument_id: `${chain}:pool:${pool}`, pool_address: pool };
    assert.equal(build([r])[r.instrument_id]?.classifications.pressure_regime, '1h buy-led');
    assert.deepEqual(build([{ ...r, pool_address: otherPool }]), {});
    assert.deepEqual(build([{ ...r, token_address: pool }]), {});
    assert.deepEqual(build([{ ...r, quote_token_address: pool }]), {});
    const other = { ...r, instrument_id: `${chain}:pool:${otherPool}`, pool_address: otherPool };
    assert.equal(Object.keys(build([r, other])).length, 2);
    assert.deepEqual(build([r, { ...r, token_address: addr(9) }]), {});
  }
});

test('the real collector compact snapshot remains usable as onchain alert evidence', async () => {
  const value = await collectParticipationUniverse({ dexchEnabled: false, now: () => NOW * 1000,
    readKnownMarkets: async () => [{ chain: 'base', token_address: addr(2) }],
    readPairs: async () => ({ observed_at: new Date(NOW * 1000).toISOString(), value: [{ chainId: 'base', pairAddress: addr(1),
      baseToken: { address: addr(2), symbol: 'TEST' }, quoteToken: { address: addr(3), symbol: 'ETH' },
      priceUsd: '1', liquidity: { usd: 100000 }, txns: { h1: { buys: 80, sells: 20 } } }] }),
  });
  assert.equal(value.rows.length, 1);
  const result = buildOnchainMonitorEvidence(value, value.rows.map(row => row.instrument_id), { now: NOW });
  assert.equal(result[value.rows[0].instrument_id]?.classifications.pressure_regime, '1h buy-led');
});

test('thin or missing counts omit flow; measured zero is distinct from missing data', () => {
  for (const [buys, sells, expected] of [[1, 0, undefined], [null, 20, undefined], [60, 40, '1h buy-led'], [4, 6, '1h sell-led'], [5, 5, '1h balanced'], [10, 0, '1h buy-led']]) {
    const r = row('base', buys, sells);
    assert.equal(build([r])[r.instrument_id].classifications.pressure_regime, expected);
  }
});

test('retained, future, malformed, untrusted and nonpositive snapshots do not assert availability', () => {
  const r = row();
  for (const invalid of [
    { ...r, observed_at: new Date((NOW - 121) * 1000).toISOString() },
    { ...r, observed_at: new Date((NOW + 1) * 1000).toISOString() },
    { ...r, chain_id: 'ethereum' }, { ...r, pool_address: addr(9) },
    { ...r, token_address: r.quote_token_address }, { ...r, token_address: 'TOKEN' },
    { ...r, identity_scope: 'token' }, { ...r, discovery_source: 'retained_exact_pool_registry' },
    { ...r, market: { ...r.market, liquidity_usd: 0 } }, { ...r, market: { ...r.market, price_usd: NaN } },
    { ...r, provenance: { provider: 'unverified' } },
  ]) assert.deepEqual(build([invalid]), {});
  assert.deepEqual(buildOnchainMonitorEvidence({ ...snapshot([r]), safe_public: false }, [r.instrument_id], { now: NOW }), {});
  assert.deepEqual(buildOnchainMonitorEvidence(snapshot([]), [r.instrument_id], { now: NOW }), {});
});

test('freshest identical-pool evidence wins but ambiguous identity or same-time flow is excluded', () => {
  const r = row(), old = { ...r, observed_at: new Date((NOW - 60) * 1000).toISOString(), market: { ...r.market, buys_1h: 1, sells_1h: 100 } };
  assert.equal(build([r, old])[r.instrument_id].classifications.pressure_regime, '1h buy-led');
  assert.deepEqual(build([r, { ...r, token_address: addr(9) }]), {});
  assert.deepEqual(build([r, { ...old, observed_at: r.observed_at }]), {});
});

test('new flow method rebaselines without a notification and invalid version cannot qualify', () => {
  const r = row(), before = build([r])[r.instrument_id];
  const after = { ...before, classifications: { availability_state: 'available', pressure_regime: '1h sell-led' } };
  assert.equal(compareMonitorEvidence(before, after).length, 1);
  assert.deepEqual(compareMonitorEvidence(before, { ...after, classification_version: 'onchain_pool_flow_v2' }), []);
  assert.deepEqual(compareMonitorEvidence({ ...before, classification_version: null }, after), []);
  assert.deepEqual(compareMonitorEvidence(before, { classification_version: null, classifications: { availability_state: 'unavailable' } }).map(row => row.event_type), ['exact_market_availability_changed']);
  assert.equal(normalizeMonitorEvidence({ ...after, classification_version: '<script>' }, { now: NOW }).qualified, false);
});

test('instrument validation rejects unsupported chains and bounds the batch', () => {
  assert.deepEqual(onchainMonitorInstrumentIds(['symbol:BTC', `arbitrum:pool:${addr(1)}`, `solana:pool:${addr(1)}`, `base:pool:${addr(1)}`, `base:pool:${addr(1)}`]), [`base:pool:${addr(1)}`]);
  assert.equal(onchainMonitorInstrumentIds(Array.from({ length: 500 }, (_, i) => `base:pool:${addr(i + 1)}`)).length, 100);
});

test('Worker loads one shared onchain snapshot for the batch without a provider or refresh call', async () => {
  const rows = [row('base'), row('ethereum')]; let reads = 0;
  const env = { RAVENOS_PARTICIPATION_UNIVERSE_ENABLED: '1', RAVENOS_CUSTOMER_DB: { prepare(sql) {
    assert.match(sql, /^SELECT body_json,updated_at,next_refresh_at FROM ravenos_participation_snapshot/);
    return { bind() { return { async first() { reads++; return { body_json: JSON.stringify(snapshot(rows)), next_refresh_at: 0 }; } }; } };
  } } };
  const result = await loadMonitorEvidenceBatch(env, new Request('https://app.ravenos.xyz/monitor/'), rows.flatMap(r => [r.instrument_id, r.instrument_id]));
  assert.equal(reads, 1); assert.equal(result.source_calls, 1); assert.equal(Object.keys(result.evidence).length, 2);
  assert.equal((await loadMonitorEvidenceBatch({ ...env, RAVENOS_PARTICIPATION_UNIVERSE_ENABLED: '0' }, null, rows.map(r => r.instrument_id))).source_calls, 0);
  assert.equal(reads, 1);
  const failed = await loadMonitorEvidenceBatch({ ...env, RAVENOS_CUSTOMER_DB: { prepare() { throw new Error('database unavailable'); } } }, null, [rows[0].instrument_id]);
  assert.deepEqual(failed.evidence, {});
});
