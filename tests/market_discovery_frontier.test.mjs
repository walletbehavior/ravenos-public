import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { openMarketFrontier, rememberFrontierTokens, planFrontierRefresh, recordFrontierAttempt, packMarketFrontier, MARKET_FRONTIER_CHAINS } from '../lib/market_discovery_frontier.mjs';
import { collectParticipationUniverse } from '../lib/participation_universe.mjs';

const NOW = Date.parse('2026-09-10T00:00:00Z');
const address = n => '0x' + n.toString(16).padStart(40, '0');
const mint = n => ('A' + n.toString(9).replaceAll('0','B')).padEnd(40, 'C');
const pair = (chain, token) => ({ chainId: chain, pairAddress: address(Number.parseInt(token.slice(-8), 16) + 100000),
  baseToken: { address: token, symbol: 'TOKEN' }, quoteToken: { address: address(99999), symbol: 'WETH' },
  priceUsd: '1', marketCap: 500000, liquidity: { usd: 10000 }, volume: { h24: 20000 }, priceChange: { h6: 5 }, txns: { h24: { buys: 30, sells: 20 } } });
const readPairs = async (chain, addresses) => ({ observed_at: new Date(NOW).toISOString(), value: addresses.map(a => pair(chain, a)) });

test('50,000 retained identities fit bounded chain records and refresh fairly within 90 batches', () => {
  const f = openMarketFrontier({}, NOW);
  for (const chain of MARKET_FRONTIER_CHAINS) rememberFrontierTokens(f, Array.from({ length: 10000 }, (_, n) => ({ chain, token_address: chain === 'solana' ? mint(n + 1) : address(n + 1) })), NOW);
  const packed = packMarketFrontier(f);
  assert.equal(Object.values(packed).reduce((n, x) => n + x.tokens.length, 0), 50000);
  for (const data of Object.values(packed)) assert(gzipSync(JSON.stringify(data)).length * 4 / 3 < 1000000);
  const jobs = planFrontierRefresh(openMarketFrontier(packed, NOW), NOW);
  assert.equal(jobs.length, 90);
  for (const chain of MARKET_FRONTIER_CHAINS) assert.equal(jobs.filter(j => j.chain === chain).length, 18);
  assert(jobs.every(j => j.addresses.length <= 30));
});

test('provider retry deadlines survive a collector restart without retrying early', async () => {
  const known = [{ chain: 'base', token_address: address(1) }];
  const first = await collectParticipationUniverse({ dexchEnabled: false, readKnownMarkets: async () => known, now: () => NOW,
    readPairs: async () => { throw Object.assign(new Error('market_provider_http_429'), { code: 'market_provider_http_429', retry_after_ms: 120000 }); } });
  assert.equal(planFrontierRefresh(openMarketFrontier(first.frontier, NOW + 61000), NOW + 61000).length, 0);
  const later = planFrontierRefresh(openMarketFrontier(first.frontier, NOW + 120001), NOW + 120001);
  assert.deepEqual(later, [{ chain: 'base', addresses: [address(1)] }]);
});

test('cold tokens rotate into refresh while known hot tokens and small chains retain coverage', () => {
  const f = openMarketFrontier({}, NOW);
  rememberFrontierTokens(f, Array.from({ length: 4000 }, (_, i) => ({ chain: 'base', token_address: address(i + 1), market: { volume_usd_24h: i < 100 ? 100000 : 1 } })), NOW);
  rememberFrontierTokens(f, [{ chain: 'ethereum', token_address: address(1) }], NOW);
  const first = planFrontierRefresh(f, NOW), firstIds = new Set(first.filter(j => j.chain === 'base').flatMap(j => j.addresses));
  for (const j of first) recordFrontierAttempt(f, j.chain, j.addresses, { succeeded: true, observed: j.addresses.map(a => ({ chain: j.chain, token_address: a })), nowMs: NOW });
  const second = planFrontierRefresh(f, NOW + 60000), secondIds = new Set(second.filter(j => j.chain === 'base').flatMap(j => j.addresses));
  assert(firstIds.has(address(1)) && secondIds.has(address(1)));
  assert([...secondIds].filter(id => !firstIds.has(id)).length >= 1500);
  assert(first.some(j => j.chain === 'ethereum') && second.some(j => j.chain === 'ethereum'));
});

test('provider cursors persist beyond the first four pages and survive an exhausted scan', async () => {
  const calls = [];
  const discoverTokens = async q => {
    const page = Number(q.cursor || 0); calls.push({ chain: q.chains[0], page });
    return { rows: Array.from({ length: 100 }, (_, n) => ({ chain: q.chains[0], address: address(page * 100 + n + 1) })), next_cursor: page < 6 ? String(page + 1) : null };
  };
  const a = await collectParticipationUniverse({ discoverTokens, readPairs, now: () => NOW });
  assert.equal(a.coverage.indexed_tokens, 800);
  assert.equal(a.frontier.robinhood.cursor, '4');
  const b = await collectParticipationUniverse({ discoverTokens, readPairs, previousRows: a.rows, savedFrontier: a.frontier, now: () => NOW + 60000 });
  assert.equal(b.coverage.indexed_tokens, 1400);
  assert(calls.some(c => c.page === 6));
  assert.equal(b.frontier.robinhood.cursor, null);
  assert.equal(b.frontier.bsc.tokens.length, 700);
});

test('failed quote batches retain original observations; successful empty/dead batches remove them', async () => {
  const known = Array.from({ length: 60 }, (_, n) => ({ chain: 'base', token_address: address(n + 1) }));
  const a = await collectParticipationUniverse({ dexchEnabled: false, readKnownMarkets: async () => known, readPairs, now: () => NOW });
  const next = NOW + 130000;
  const b = await collectParticipationUniverse({ dexchEnabled: false, previousRows: a.rows, savedFrontier: a.frontier, now: () => next,
    readPairs: async (chain, addresses) => {
      if (addresses.includes(address(1))) throw Object.assign(new Error('private upstream response must not leak'), { code: 'market_provider_http_503' });
      return { observed_at: new Date(next).toISOString(), value: addresses.map(t => ({ ...pair(chain,t), liquidity: { usd: 0 } })) };
    },
  });
  assert.equal(b.rows.length, 30);
  assert(b.rows.every(row => row.observed_at === new Date(NOW).toISOString()));
  assert.equal(b.coverage.current_tokens, 0);
  assert.equal(b.coverage.retained_after_incomplete_refresh, 30);
  assert.deepEqual(b.coverage.pair_failure_codes, { market_provider_http_503: 1 });
  assert.equal(JSON.stringify(b).includes('private upstream'), false);
  const c = await collectParticipationUniverse({ dexchEnabled: false, previousRows: b.rows, savedFrontier: b.frontier, now: () => next + 60001,
    readPairs: async () => ({ observed_at: new Date(next + 60001).toISOString(), value: [] }) });
  assert.equal(c.rows.length, 0);
  assert.equal(c.coverage.indexed_tokens, 60, 'identities remain available for a later bounded recheck');
});

test('Solana case sensitivity and current reported holder exclusions survive restart', () => {
  const a = 'A'.repeat(40), b = 'a' + 'A'.repeat(39), f = openMarketFrontier({}, NOW);
  rememberFrontierTokens(f, [{ chain: 'solana', token_address: a, market: { holder_count: 1 } }, { chain: 'solana', token_address: b }], NOW);
  const restored = openMarketFrontier(packMarketFrontier(f), NOW + 1000);
  assert.equal(restored.tokens.size, 2);
  assert.deepEqual(planFrontierRefresh(restored, NOW + 1000).flatMap(x => x.addresses), [b]);
  assert.equal(openMarketFrontier(packMarketFrontier(f), NOW + 8 * 86400000).tokens.size, 0);
});
