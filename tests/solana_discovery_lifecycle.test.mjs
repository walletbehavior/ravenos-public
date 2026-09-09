import test from 'node:test';
import assert from 'node:assert/strict';
import { jupiterDiscoveryLifecycle, jupiterDiscoveryAge } from '../lib/jupiter_discovery_lifecycle.mjs';
import { reportedSpotLifecycle } from '../ravenos-discover-intelligence.js';
import { buildDiscoverRadarProjection } from '../lib/discover_radar.mjs';

const mint = '8xH8ikqGXNTSYmmUVakCE2tVwU7aYJwz2JZkqAjW88sG';
const pool = 'DUv5LL9s1WPQQMeUqwdukuwScmM1i6PMx7t1GgMgyscG';
const quote = 'So11111111111111111111111111111111111111112';
const now = Date.now(), observed = new Date(now).toISOString();
const token = { id: mint, symbol: 'COIN', name: 'Coin', launchpad: 'pump.fun', graduatedAt: new Date(now - 60_000).toISOString(), graduatedPool: pool };
const pair = { chainId: 'solana', tokenAddress: mint, pairAddress: pool, dexId: 'pumpswap' };

test('Jupiter graduation is preserved on the exact token across destination pools', () => {
  const evidence = jupiterDiscoveryLifecycle(token, pair, observed);
  const row = { chain_id: 'solana', token_address: mint, lifecycle_evidence: evidence };
  assert.equal(reportedSpotLifecycle(row, now)?.state, 'GRADUATED');
  assert.equal(evidence.migrated_at, token.graduatedAt);
  assert.equal(evidence.graduated_pool, pool);
  assert.equal(evidence.execution_authority, false);
});

test('missing, mismatched, future and contradictory graduation never become lifecycle proof', () => {
  assert.equal(jupiterDiscoveryLifecycle({ ...token, graduatedAt: undefined, graduatedPool: undefined }, pair, observed), null);
  assert.equal(jupiterDiscoveryLifecycle({ ...token, graduatedAt: new Date(now + 60_000).toISOString() }, pair, observed), null);
  assert.equal(jupiterDiscoveryLifecycle(token, { ...pair, tokenAddress: quote }, observed), null);
  const evidence = jupiterDiscoveryLifecycle(token, { ...pair, dexId: 'pumpfun' }, observed);
  assert.equal(reportedSpotLifecycle({ chain_id: 'solana', token_address: mint, lifecycle_evidence: evidence }, now), null);
});

test('bonding requires an active curve and launchpad evidence, and keeps unknown progress unknown', () => {
  const evidence = jupiterDiscoveryLifecycle({ ...token, graduatedAt: null, graduatedPool: null }, { ...pair, dexId: 'pumpfun' }, observed);
  assert.equal(evidence.state, 'BONDING');
  assert.equal(evidence.progress_bps, null);
  const row = { chain_id: 'solana', token_address: mint, lifecycle_evidence: evidence };
  assert.equal(reportedSpotLifecycle(row, now)?.state, 'BONDING');
  assert.equal(reportedSpotLifecycle(row, now + 121_000), null);
  assert.equal(reportedSpotLifecycle({ ...row, chain_id: 'base' }, now), null);
  assert.equal(reportedSpotLifecycle({ ...row, token_address: mint.toLowerCase() }, now), null);
  assert.equal(jupiterDiscoveryLifecycle({ id: mint }, { ...pair, dexId: 'pumpfun' }, observed), null);
});

test('older first-pool history is retained when provider record creation is later', () => {
  const age = jupiterDiscoveryAge({ createdAt: observed, firstPool: { createdAt: new Date(now - 90 * 86_400_000).toISOString() } }, observed);
  assert.equal(age.token_age_seconds, null);
  assert.equal(age.first_pool_age_seconds, 90 * 86_400);
});

test('real provider lifecycle reaches the radar without a Dexch-only migration field', () => {
  const row = { chain_id: 'solana', chain: 'Solana', market_type: 'spot', source_type: 'jupiter_velocity',
    instrument_id: `solana:pool:${pool}`, pool_address: pool, token_address: mint, quote_token_address: quote,
    symbol: 'COIN', venue: 'pumpswap', identity_scope: 'exact_pool', observed_at: observed, context_state: 'current',
    lifecycle_evidence: jupiterDiscoveryLifecycle(token, pair, observed),
    market: { price_usd: 1, liquidity_usd: 10_000, market_cap_usd: 50_000, market_age_seconds: 60, buys_1h: 5, sells_1h: 2, buys_24h: 5, sells_24h: 2 },
    research_only: true, actionable: false, execution_available: false };
  const result = buildDiscoverRadarProjection([row], { generatedAt: observed, timeframe: '1h', nowMs: now });
  assert.equal(result.rows[0].discovery.migration_cohort.value, 'post_migration');
  const older = { ...row, lifecycle_evidence: undefined, market: { ...row.market, ...jupiterDiscoveryAge({ firstPool: { createdAt: new Date(now - 90 * 86_400_000).toISOString() } }, observed) } };
  const revival = buildDiscoverRadarProjection([older], { generatedAt: observed, timeframe: '1h', nowMs: now }).rows[0].discovery.revival_scan;
  assert.equal(revival.qualified, true);
  assert.equal(revival.age_basis, 'first_pool_creation');
});

test('worker blends trending, recent and active bonding feeds, preserves unknown liquidity and reuses cache', async () => {
  const { default: worker } = await import('../worker.mjs?solana-lifecycle-integration');
  const fetchOriginal = globalThis.fetch, calls = [];
  const bond = { ...token, id: '9xQeWvG816bUx9EPfPqpQfdgj7QdQL6MH5z3ExvMNYBp', symbol: 'BOND', graduatedAt: null, graduatedPool: null };
  const rawPair = (t, venue, address) => ({ chainId: 'solana', dexId: venue, pairAddress: address,
    baseToken: { address: t.id, symbol: t.symbol }, quoteToken: { address: quote, symbol: 'SOL' },
    priceUsd: '0.00002', marketCap: 20_000, ...(venue === 'pumpfun' ? {} : { liquidity: { usd: 5000 } }),
    volume: { m5: 500, h1: 1200, h24: 2500 }, txns: { m5: { buys: 3, sells: 1 } } });
  const stats = { priceChange: 10, buyVolume: 600, sellVolume: 400, numBuys: 3, numSells: 1 };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input?.url || input)); calls.push(url);
    const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
    if (url.hostname === 'api.jup.ag') {
      assert.equal(init.headers['x-api-key'], 'fixture-server-only');
      return json((url.pathname.includes('toptrending') ? [token] : [bond]).map(t => ({ ...t, usdPrice: 0.00002, mcap: 20_000, stats5m: stats, stats1h: stats, stats24h: stats })));
    }
    if (url.hostname === 'api.dexscreener.com') {
      const pairs = [rawPair(token, 'pumpswap', pool), rawPair(bond, 'pumpfun', '4'.repeat(32))];
      return json(url.pathname.includes('/search') ? { pairs: [pairs[1]] } : pairs);
    }
    throw new Error('unexpected_provider');
  };
  try {
    const env = { JUPITER_API_KEY: 'fixture-server-only', RAVENOS_COINGECKO_ENABLED: '0' };
    const url = 'https://ravenos.xyz/api/onchain/trending?chains=solana&duration=1h';
    const first = await (await worker.fetch(new Request(url), env)).text();
    assert.doesNotMatch(first, /fixture-server-only/);
    const body = JSON.parse(first);
    assert.equal(body.ok, true);
    assert.equal(body.rows.find(row => row.symbol === 'COIN').discovery.migration_cohort.value, 'post_migration');
    const bonding = body.rows.find(row => row.symbol === 'BOND');
    assert.equal(bonding.discovery.migration_cohort.value, 'pre_migration');
    assert.equal(bonding.market.liquidity_usd, null);
    assert.equal(bonding.execution_available, false);
    const count = calls.length;
    await worker.fetch(new Request(url), env);
    assert.equal(calls.length, count);
    assert(calls.some(url => url.pathname === '/tokens/v2/recent'));
    assert(calls.some(url => url.searchParams.get('q') === 'pumpfun'));
  } finally { globalThis.fetch = fetchOriginal; }
});
