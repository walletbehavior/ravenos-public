import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { gzipSync, gunzipSync } from 'node:zlib';
import { matchesMarketScope, isTokenizedEquity, isZcashAsset } from '../ravenos-market-scope.js';
import { bestExactSpotMarketPerToken } from '../ravenos-discover-intelligence.js';
import { normalizeDexScreenerActivity } from './market_provider_fallbacks.mjs';
import { MARKET_FRONTIER_POLICY, marketTokenKey, openMarketFrontier, rememberFrontierTokens,
  planFrontierRefresh, recordFrontierAttempt, packMarketFrontier } from './market_discovery_frontier.mjs';

export const PARTICIPATION_UNIVERSE_POLICY = Object.freeze({
  cron: '*/2 * * * *',
  chains: Object.freeze(['solana', 'robinhood', 'bsc', 'base', 'ethereum']),
  refresh_seconds: 45, lease_seconds: 90, collection_timeout_ms: 25_000,
  known_market_limit: 5000,
  concurrency: 4, maximum_snapshot_bytes: 10_000_000, maximum_storage_bytes: 1_700_000,
});
const policy = PARTICIPATION_UNIVERSE_POLICY;
const key = (chain, address) => `${chain}:${chain === 'solana' ? address : address.toLowerCase()}`;
function validToken(chain, address) {
  return policy.chains.includes(chain) && (chain === 'solana' ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ : /^0x[0-9a-fA-F]{40}$/).test(address || '');
}
async function boundedMap(items, fn, deadline, now) {
  let index = 0;
  const output = [];
  await Promise.all(Array.from({ length: Math.min(policy.concurrency, items.length) }, async () => {
    while (index < items.length && now() < deadline) {
      const position = index++;
      try { output[position] = { status: 'fulfilled', value: await fn(items[position]) }; }
      catch (error) { output[position] = { status: 'rejected', code: /^[a-z_0-9]{1,80}$/.test(error?.code || '') ? error.code : 'provider_unavailable' }; }
    }
  }));
  return output;
}

// Provider pages advance durably, independently of visible Discovery rows.
// None of these calls enumerate wallets or fetch transaction history.
export async function collectParticipationUniverse({
  discoverTokens, readPairs, readKnownMarkets = async () => [], readSeedTokens = async () => [],
  dexchEnabled = true, previousRows = [], savedFrontier = {}, now = () => Date.now(),
} = {}) {
  const started = now(), deadline = started + policy.collection_timeout_ms;
  const coverage = [], errors = [], frontier = openMarketFrontier(savedFrontier, started);
  rememberFrontierTokens(frontier, previousRows, started);
  let requests = 0;
  const scans = dexchEnabled ? ['robinhood', 'bsc'].map(async chain => {
    const cursors = new Set();
    let cursor = frontier.cursors[chain] || null, exhausted = false, pages = 0, failed = false, count = 0;
    for (; pages < MARKET_FRONTIER_POLICY.discovery_pages_per_chain && now() < deadline; pages += 1) {
      let result;
      try {
        requests += 1;
        result = await discoverTokens({ chains: [chain], sort: 'volume24h', order: 'desc', limit: 100,
          min_liquidity_usd: 5_000, min_holders: 10, cursor });
        if (result.failed_chains?.length) throw new Error('provider_unavailable');
      } catch {
        failed = true; errors.push(`${chain}:discovery`);
        // Cursors may expire upstream. Retry from the head on the next cycle;
        // all previously observed identities remain in the frontier.
        frontier.cursors[chain] = null;
        break;
      }
      const rows = (result.rows || []).filter(row => row.chain === chain && !isTokenizedEquity(row) && !isZcashAsset(row));
      rememberFrontierTokens(frontier, rows, now());
      count += rows.length;
      cursor = result.next_cursor || null;
      if (!cursor) { exhausted = true; frontier.cursors[chain] = null; pages += 1; break; }
      if (cursors.has(cursor)) { failed = true; errors.push(`${chain}:cursor_repeated`); frontier.cursors[chain] = null; break; }
      cursors.add(cursor); frontier.cursors[chain] = cursor;
    }
    coverage.push({ chain, pages, candidates: count, exhausted, failed, continues_next_cycle: Boolean(frontier.cursors[chain]) });
  }) : [];
  const [known, seeds] = await Promise.allSettled([readKnownMarkets(), readSeedTokens(), ...scans]);
  for (const [name, result] of [['retained', known], ['other_provider', seeds]]) {
    if (result.status !== 'fulfilled') { errors.push(name); continue; }
    const rows = Array.isArray(result.value) ? result.value : result.value.rows || [];
    requests += Number.isInteger(result.value.request_count) ? result.value.request_count : 0;
    rememberFrontierTokens(frontier, rows.filter(row => !isTokenizedEquity(row) && !isZcashAsset(row)), now());
  }
  coverage.sort((a, b) => a.chain.localeCompare(b.chain));
  const batches = planFrontierRefresh(frontier, now()), replaced = new Set();
  const result = await boundedMap(batches, async ({ chain, addresses }) => {
    requests += 1;
    try {
      const snapshot = await readPairs(chain, addresses), allowed = new Set(addresses.map(address => key(chain, address)));
      if (!Array.isArray(snapshot.value) || !Number.isFinite(Date.parse(snapshot.observed_at))) throw new Error('invalid_pair_batch');
      const rows = snapshot.value.filter(pair => pair.chainId === chain && validToken(chain, pair.baseToken?.address) && allowed.has(key(chain, pair.baseToken.address)))
        .map(pair => normalizeDexScreenerActivity(pair, { chain, observedAt: snapshot.observed_at, nowMs: now() })).filter(row => row && matchesMarketScope(row, 'memecoins'));
      // A successful current response can remove a dead pool. A failed batch
      // cannot erase unrelated tokens or relabel old prices as fresh.
      for (const address of addresses) replaced.add(key(chain, address));
      for (const row of rows) {
        const token = frontier.tokens.get(marketTokenKey(chain, row.token_address));
        if (token?.holders !== null && token?.holders_at && now() - token.holders_at <= 300_000) row.market.holder_count = token.holders;
      }
      rememberFrontierTokens(frontier, rows, now());
      recordFrontierAttempt(frontier, chain, addresses, { succeeded: true, observed: rows, nowMs: now() });
      return rows;
    } catch (error) { recordFrontierAttempt(frontier, chain, addresses, { succeeded: false, nowMs: now() }); throw error; }
  }, deadline, now);
  const retained = previousRows.filter(row => !replaced.has(key(row.chain_id || row.chain, row.token_address))
    && now() - Date.parse(row.observed_at) <= 6 * 60 * 60_000 && Date.parse(row.observed_at) <= now());
  let rows = bestExactSpotMarketPerToken([...result.flatMap(item => item?.status === 'fulfilled' ? item.value : []), ...retained], { nowMs: now() });
  // Remove prose duplicated in every public row before durable serialization.
  rows = rows.map(({ risk, what_changed, inspection, provenance, ...row }) => row)
    .sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at));
  const dropped = [], rowBytes = rows.map(row => Buffer.byteLength(JSON.stringify(row)) + 1);
  let size = 2 + rowBytes.reduce((sum, bytes) => sum + bytes, 0);
  while (size > policy.maximum_snapshot_bytes) {
    // Remove one tail per chain, retaining breadth rather than an alphabetical cut.
    for (const chain of [...policy.chains].reverse()) {
      const index = rows.findLastIndex(row => row.chain_id === chain);
      if (index >= 0) { dropped.push(...rows.splice(index, 1)); size -= rowBytes.splice(index, 1)[0]; }
    }
  }
  const packed = packMarketFrontier(frontier);
  return {
    schema_version: 'ravenos.participation_universe.v1', ok: rows.length > 0, safe_public: true,
    generated_at: new Date(now()).toISOString(), rows,
    frontier: packed,
    coverage: { tracked: rows.length, candidates: batches.reduce((sum, batch) => sum + batch.addresses.length, 0),
      indexed_tokens: Object.values(packed).reduce((sum, data) => sum + data.tokens.length, 0),
      indexed_by_chain: Object.fromEntries(Object.entries(packed).map(([chain, data]) => [chain, data.tokens.length])),
      current_tokens: rows.filter(row => now() - Date.parse(row.observed_at) <= 120_000).length,
      retained_after_incomplete_refresh: retained.length,
      chains: Object.fromEntries(policy.chains.map(chain => [chain, rows.filter(row => row.chain_id === chain).length])),
      provider_pages: coverage, failed_lanes: errors, failed_pair_batches: result.filter(item => item?.status === 'rejected').length,
      pair_failure_codes: Object.fromEntries([...new Set(result.map(item => item?.code).filter(Boolean))].map(code => [code, result.filter(item => item?.code === code).length])),
      incomplete_batches: batches.length - result.filter(Boolean).length, size_limited_rows: dropped.length,
      provider_requests: requests, collection_ms: now() - started, complete_chain_census: false },
    measurement: 'Independent current market sample; exact-pool six-hour price change, not wallet P&L.',
    execution_available: false,
  };
}

export function createParticipationSnapshotStore(db) {
  return {
    async read() {
      const row = await db.prepare("SELECT body_json,updated_at,next_refresh_at FROM ravenos_participation_snapshot WHERE scope='onchain'").bind().first();
      let payload = null;
      try {
        payload = JSON.parse(row?.body_json || 'null');
        if (payload?.encoding === 'gzip-base64') payload = JSON.parse(gunzipSync(Buffer.from(payload.body, 'base64'), { maxOutputLength: policy.maximum_snapshot_bytes + 100_000 }).toString('utf8'));
      } catch { payload = null; /* Never turn broken storage into observations. */ }
      return { payload, nextRefreshAt: row?.next_refresh_at || 0 };
    },
    async frontier() {
      const result = await db.prepare('SELECT chain,body_json FROM ravenos_market_discovery_frontier').bind().all();
      return Object.fromEntries((result.results || []).flatMap(row => {
        try {
          const envelope = JSON.parse(row.body_json);
          const data = envelope.encoding === 'gzip-base64' ? JSON.parse(gunzipSync(Buffer.from(envelope.body, 'base64'), { maxOutputLength: 3_000_000 }).toString('utf8')) : envelope;
          return [[row.chain, data]];
        } catch { return []; }
      }));
    },
    async claim(token, now) {
      await db.prepare("INSERT OR IGNORE INTO ravenos_participation_snapshot (scope) VALUES ('onchain')").bind().run();
      const result = await db.prepare("UPDATE ravenos_participation_snapshot SET lease_token=?,lease_expires_at=?,next_refresh_at=? WHERE scope='onchain' AND lease_expires_at<=? AND next_refresh_at<=?")
        .bind(token, now + policy.lease_seconds, now + policy.refresh_seconds, now, now).run();
      return result.meta?.changes === 1;
    },
    async finish(token, payload, now) {
      const statements = [];
      if (payload?.frontier) for (const chain of policy.chains) {
        const encoded = JSON.stringify({ encoding: 'gzip-base64', body: gzipSync(JSON.stringify(payload.frontier[chain] || { tokens: [] })).toString('base64') });
        if (Buffer.byteLength(encoded) > 1_000_000) throw new Error('market_frontier_too_large');
        statements.push(db.prepare(`INSERT INTO ravenos_market_discovery_frontier (chain,body_json,updated_at)
          SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM ravenos_participation_snapshot WHERE scope='onchain' AND lease_token=?)
          ON CONFLICT(chain) DO UPDATE SET body_json=excluded.body_json,updated_at=excluded.updated_at`)
          .bind(chain, encoded, now, token));
      }
      if (payload && Array.isArray(payload.rows)) {
        const { frontier: _frontier, ...publicSnapshot } = payload;
        const serialized = JSON.stringify(publicSnapshot);
        // Public observations compress well. Keep all measured markets instead
        // of dropping smaller-chain rows to fit D1's per-row storage limit.
        const encoded = serialized.length > 128_000 ? JSON.stringify({ encoding: 'gzip-base64', body: gzipSync(serialized).toString('base64') }) : serialized;
        if (Buffer.byteLength(encoded) > policy.maximum_storage_bytes) throw new Error('participation_snapshot_too_large');
        statements.push(db.prepare("UPDATE ravenos_participation_snapshot SET body_json=?,updated_at=?,lease_token=NULL,lease_expires_at=0 WHERE scope='onchain' AND lease_token=?")
          .bind(encoded, now, token));
      } else statements.push(db.prepare("UPDATE ravenos_participation_snapshot SET lease_token=NULL,lease_expires_at=0 WHERE scope='onchain' AND lease_token=?").bind(token));
      // Atomic with the snapshot lease: a late collector cannot advance a newer
      // collector's cursor or erase its frontier, including an all-empty result.
      if (statements.length > 1) await db.batch(statements);
      else await statements[0].run();
    },
    async knownMarkets() {
      const result = await db.prepare('SELECT identity_json FROM ravenos_wallet_universe_markets ORDER BY last_seen_at DESC,market_id LIMIT ?').bind(policy.known_market_limit).all();
      return (result.results || []).flatMap(row => { try { return [JSON.parse(row.identity_json)]; } catch { return []; } });
    },
  };
}

export async function refreshParticipationSnapshot(store, collect, now = () => Math.floor(Date.now() / 1000)) {
  const token = randomUUID();
  if (!await store.claim(token, now())) return false;
  let payload = null;
  try { payload = await collect(); } finally { await store.finish(token, payload, now()); }
  return Boolean(payload?.ok);
}
