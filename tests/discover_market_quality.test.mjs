import test from 'node:test';
import assert from 'node:assert/strict';
import { spotDiscoveryQuality } from '../ravenos-discover-intelligence.js';
import { qualifyDiscoverCandidates } from '../lib/discover_candidate_lanes.mjs';
import { collectDexScreenerDiscoverySeeds } from '../lib/dexscreener_discovery_seeds.mjs';
import { buildDiscoverRadarProjection, validateDiscoverRadarProjection } from '../lib/discover_radar.mjs';

const now = Date.now(), observed = new Date(now).toISOString();
const good = (chain = 'base', i = 1) => ({ chain_id: chain, chain, identity_scope: 'exact_pool', instrument_id: `${chain}:pool:pool${i}`,
  pool_address: `pool${i}`, token_address: `token${i}`, quote_token_address: 'quote', symbol: `MEME${i}`, name: `Meme ${i}`,
  market_type: 'spot', source_type: 'market_activity', observed_at: observed, context_state: 'current',
  market: { price_usd: .1, market_cap_usd: 300000, liquidity_usd: 100000, holder_count: 100,
    volume_usd_5m: 10000, buys_5m: 30, sells_5m: 10, price_change_5m_pct: 4 } });

for (const chain of ['solana', 'base', 'ethereum', 'bsc', 'robinhood']) test(`${chain}: discovery removes dust, one-holder markets and inactive pairs before ranking`, () => {
  const row = good(chain);
  assert.equal(spotDiscoveryQuality(row).eligible, true);
  for (const market of [{ liquidity_usd: 0 }, { liquidity_usd: 4999 }, { holder_count: 1 }, { holder_count: 9 },
    { liquidity_usd: null }, { price_usd: 0 }, { volume_usd_5m: 0, buys_5m: 0, sells_5m: 0 }, { liquidity_change_1h_pct: -90 }]) {
    assert.equal(spotDiscoveryQuality({ ...row, market: { ...row.market, ...market } }).eligible, false, JSON.stringify(market));
  }
  assert.equal(spotDiscoveryQuality({ ...row, market: { ...row.market, holder_count: null } }).eligible, true, 'missing census is not zero');
});
test('fresh token-wide holder evidence cannot be escaped by choosing another pool', () => {
  const known = good(), unknown = { ...good('base', 2), token_address: known.token_address, market: { ...good().market, holder_count: null } };
  known.market.holder_count = 1;
  assert.equal(qualifyDiscoverCandidates([known, unknown], { nowMs: now }).length, 0);
  assert.equal(qualifyDiscoverCandidates([known, { ...unknown, chain_id: 'ethereum', chain: 'ethereum' }], { nowMs: now }).length, 1);
});
test('unreported curve depth needs genuine current lifecycle and broad observed participation', () => {
  const row = good('solana'); row.market.liquidity_usd = null;
  row.lifecycle_evidence = { provider: 'jupiter', schema_version: 'ravenos.token_lifecycle.v1', evidence_class: 'JUPITER_REPORTED',
    token_address: row.token_address, chain_id: 'solana:mainnet-beta', state: 'BONDING', observed_at: observed,
    raven_verified: false, execution_authority: false, quality: { contradictions: [] } };
  assert.equal(spotDiscoveryQuality(row, { nowMs: now }).eligible, true);
  row.market.holder_count = 1;
  assert.equal(spotDiscoveryQuality(row, { nowMs: now }).eligible, false);
  row.market.holder_count = 100;
  assert.equal(spotDiscoveryQuality(row, { nowMs: now + 121000 }).eligible, false);
  row.market.liquidity_usd = 0;
  assert.equal(spotDiscoveryQuality(row, { nowMs: now }).eligible, false, 'known zero is not an unreported curve');
});
test('expanded radar preserves more than 240 token identities and ranks over the full admitted cohort', () => {
  const rows = Array.from({ length: 900 }, (_, i) => good('base', i));
  const radar = buildDiscoverRadarProjection(rows, { nowMs: now, generatedAt: observed, maxRows: 4000 });
  assert.equal(radar.rows.length, 900); assert.equal(validateDiscoverRadarProjection(radar, { nowMs: now }).rows.length, 900);
  assert.equal(radar.rows[0].discovery.velocity_state.score.cohort_size, 900);
  assert.equal(buildDiscoverRadarProjection(rows, { nowMs: now, maxRows: 5000 }).rows.length, 900);
});
test('official public discovery categories seed exact addresses without treating promotion as evidence', async () => {
  const address = '0x' + '1'.repeat(40), calls = [];
  const result = await collectDexScreenerDiscoverySeeds(async (url, options) => {
    calls.push(url); assert.equal(options.ttlMs, 300000);
    if (url.endsWith('/metas/trending/v1')) return [{ slug: 'cat' }, { slug: '../secret' }, { slug: 'dog' }];
    if (url.endsWith('/metas/meta/v1/cat')) return { pairs: [{ chainId: 'base', baseToken: { address } }, { chainId: 'unsupported', baseToken: { address } }] };
    if (url.endsWith('/metas/meta/v1/dog')) throw new Error('unavailable');
    return [{ chainId: 'base', tokenAddress: address }];
  }, { nowMs: 0 });
  assert.equal(calls.length, 6); assert.equal(result.rows.length, 1); assert.equal(result.rows[0].raven_signal, undefined);
  assert.deepEqual(result.failed_lanes, ['meta:dog']); assert.equal(result.complete_chain_census, false);
  assert(calls.every(url => new URL(url).hostname === 'api.dexscreener.com'));
});
