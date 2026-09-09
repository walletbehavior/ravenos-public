import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { collectParticipationUniverse, createParticipationSnapshotStore, refreshParticipationSnapshot } from '../lib/participation_universe.mjs';
import { buildParticipationMap } from '../ravenos-participation-map.js';
import worker from '../worker.mjs';

const NOW = Date.parse('2026-09-09T18:00:00Z');
const addr = n => '0x' + n.toString(16).padStart(40, '0');
function pair(chain, address) {
  return { chainId: chain, pairAddress: addr(Number.parseInt(address.slice(-8), 16) + 10000), baseToken: { address, symbol: 'TEST', name: 'Test token' },
    quoteToken: { address: addr(99999), symbol: 'ETH' }, priceUsd: '1', marketCap: 800000, liquidity: { usd: 100000 },
    pairCreatedAt: NOW - 10 * 86400000, priceChange: { h6: 4, m5: 1 }, volume: { h6: 20000, m5: 1000 }, txns: { m5: { buys: 10, sells: 5 } } };
}
const readPairs = async (chain, addresses) => ({ observed_at: new Date(NOW).toISOString(), value: addresses.map(address => pair(chain, address)) });
function database() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync('customer-migrations/0048_participation_snapshot.sql', 'utf8'));
  raw.exec('CREATE TABLE ravenos_wallet_universe_markets (market_id TEXT, identity_json TEXT, last_seen_at INTEGER)');
  return { raw, prepare(sql) { return { bind(...args) { return {
    async first() { return raw.prepare(sql).get(...args); }, async all() { return { results: raw.prepare(sql).all(...args) }; },
    async run() { return { meta: { changes: Number(raw.prepare(sql).run(...args).changes) } }; },
  }; } }; } };
}

test('participation pages each chain and cap band independently of Discovery', async () => {
  const calls = [];
  const result = await collectParticipationUniverse({ now: () => NOW, readPairs,
    discoverTokens: async query => {
      calls.push(query);
      return { rows: [{ chain: query.chains[0], address: addr(query.min_market_cap_usd + (query.cursor ? 2 : 1)) }], next_cursor: query.cursor ? null : 'next' };
    },
  });
  assert.equal(calls.length, 20);
  assert.equal(calls.filter(q => q.cursor === 'next').length, 10);
  assert(calls.every(q => q.min_age_minutes === 360 && q.limit === 100 && q.chains.length === 1));
  assert.equal(result.rows.length, 20);
  assert.equal(buildParticipationMap(result.rows, { now: NOW }).cells.every(cell => cell.state === 'rewarding'), true);
});

test('retained markets populate Base and Ethereum without a fresh market-discovery or wallet RPC', async () => {
  const known = ['base', 'ethereum'].flatMap(chain => Array.from({ length: 350 }, (_, i) => ({ chain, token_address: addr(i + 1) })));
  const result = await collectParticipationUniverse({ dexchEnabled: false, now: () => NOW, readKnownMarkets: async () => known,
    readPairs: async (chain, addresses) => { assert(addresses.length <= 30); return readPairs(chain, addresses); },
    discoverTokens: () => { throw new Error('not called'); },
  });
  assert.deepEqual(result.coverage.chains, { solana: 0, robinhood: 0, bsc: 0, base: 350, ethereum: 350 });
  assert.equal(result.coverage.provider_requests, 24);
});

test('mismatched chain/token replies and nonfinite market facts cannot manufacture group coverage', async () => {
  const result = await collectParticipationUniverse({ dexchEnabled: false, now: () => NOW,
    readKnownMarkets: async () => [{ chain: 'base', token_address: addr(1) }],
    readPairs: async () => ({ observed_at: new Date(NOW).toISOString(), value: [pair('ethereum', addr(1)), pair('base', addr(2)), { ...pair('base', addr(1)), priceUsd: 'NaN' }] }),
  });
  assert.equal(result.rows.length, 0);
  assert.equal(result.ok, false);
});

test('cursor replay and provider failures remain bounded and other groups survive', async () => {
  let calls = 0;
  const result = await collectParticipationUniverse({ now: () => NOW, readPairs,
    discoverTokens: async query => { calls += 1; if (query.chains[0] === 'bsc') throw new Error('offline'); return { rows: [{ chain: 'robinhood', address: addr(query.min_market_cap_usd + 1) }], next_cursor: 'repeat' }; },
  });
  assert.equal(calls, 15);
  assert(result.rows.length > 0);
  assert.equal(result.coverage.failed_lanes.length, 10);
});

test('one durable lease serves concurrent visitors and failed refresh preserves original evidence time', async () => {
  const db = database(), store = createParticipationSnapshotStore(db);
  let calls = 0, now = Math.floor(NOW / 1000);
  const payload = { ok: true, rows: [{ observed_at: new Date(NOW).toISOString() }] };
  await Promise.all(Array.from({ length: 10 }, () => refreshParticipationSnapshot(store, async () => { calls += 1; return payload; }, () => now)));
  assert.equal(calls, 1); assert.deepEqual((await store.read()).payload, payload);
  now += 61;
  await assert.rejects(refreshParticipationSnapshot(store, async () => { throw new Error('offline'); }, () => now));
  assert.deepEqual((await store.read()).payload, payload);
  assert.equal(await refreshParticipationSnapshot(store, async () => { calls += 1; }, () => now), false);
  assert.equal(calls, 1);
  db.raw.close();
});

test('expired lease cannot overwrite a newer snapshot', async () => {
  const db = database(), store = createParticipationSnapshotStore(db);
  assert.equal(await store.claim('old', 100), true); assert.equal(await store.claim('new', 191), true);
  await store.finish('new', { ok: true, rows: [{ version: 2 }] }, 192);
  await store.finish('old', { ok: true, rows: [{ version: 1 }] }, 193);
  assert.equal((await store.read()).payload.rows[0].version, 2);
  db.raw.close();
});

test('large public snapshots retain all markets with bounded compressed storage', async () => {
  const db = database(), store = createParticipationSnapshotStore(db);
  const rows = Array.from({ length: 2000 }, (_, i) => ({ chain_id: 'base', token_address: addr(i), observed_at: new Date(NOW).toISOString(), market: { price_change_6h_pct: i / 100, volume_usd_6h: i * 1000 }, symbol: 'PUBLIC_MARKET' }));
  await store.claim('large', 100); await store.finish('large', { ok: true, rows }, 101);
  const stored = db.raw.prepare('SELECT body_json FROM ravenos_participation_snapshot').get().body_json;
  assert.equal(JSON.parse(stored).encoding, 'gzip-base64');
  assert(Buffer.byteLength(stored) < 1_700_000);
  assert.deepEqual((await store.read()).payload.rows, rows);
  db.raw.close();
});

test('collection and compressed storage work without a Node Buffer global in Workers', async () => {
  const originalBuffer = globalThis.Buffer, db = database(), store = createParticipationSnapshotStore(db);
  try {
    delete globalThis.Buffer;
    const result = await collectParticipationUniverse({ dexchEnabled: false, now: () => NOW, readPairs,
      readKnownMarkets: async () => [{ chain: 'base', token_address: addr(1) }],
    });
    assert.equal(result.rows.length, 1);
    const rows = Array.from({ length: 1000 }, () => result.rows[0]);
    await store.claim('worker', 100);
    await store.finish('worker', { ok: true, rows }, 101);
    assert.deepEqual((await store.read()).payload.rows, rows);
  } finally {
    globalThis.Buffer = originalBuffer;
    db.raw.close();
  }
});

test('public board and group endpoints read the shared snapshot without refreshing providers', async () => {
  const db = database(), store = createParticipationSnapshotStore(db), now = Math.floor(Date.now() / 1000);
  const data = await collectParticipationUniverse({ dexchEnabled: false, readPairs: async (chain, addresses) => ({ value: addresses.map(address => pair(chain, address)), observed_at: new Date().toISOString() }),
    readKnownMarkets: async () => Array.from({ length: 12 }, (_, i) => ({ chain: 'base', token_address: addr(i + 1) })),
  });
  await store.claim('seed', now); await store.finish('seed', data, now);
  const env = { RAVENOS_PARTICIPATION_UNIVERSE_ENABLED: '1', RAVENOS_CUSTOMER_DB: db };
  const response = await worker.fetch(new Request('https://ravenos.xyz/api/onchain/participation'), env);
  assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.boards.capitalization.tracked, 12); assert.equal(body.rows, undefined);
  const appResponse = await worker.fetch(new Request('https://app.ravenos.xyz/api/onchain/participation'), env);
  assert.equal(appResponse.status, 200);
  const group = await worker.fetch(new Request('https://ravenos.xyz/api/onchain/participation?chain=base&band=500k_2m'), env);
  const matches = await group.json(); assert.equal(matches.rows.length, 12); assert.equal(matches.rows[0].discovery.exact_identity.instrument_id, matches.rows[0].instrument_id);
  const disabled = await worker.fetch(new Request('https://ravenos.xyz/api/onchain/participation'), {}); assert.equal(disabled.status, 503);
  const invalid = await worker.fetch(new Request('https://ravenos.xyz/api/onchain/participation?chain=bad&band=any'), env); assert.equal(invalid.status, 400);
  db.raw.close();
});

test('participation cadence does not enter wallet ingestion, billing or execution', async () => {
  const env = new Proxy({ RAVENOS_PARTICIPATION_UNIVERSE_ENABLED: '0' }, { get(target, field) {
    if (field !== 'RAVENOS_PARTICIPATION_UNIVERSE_ENABLED') throw new Error('unrelated_service_access');
    return target[field];
  } });
  await worker.scheduled({ cron: '*/2 * * * *' }, env, {});
});
