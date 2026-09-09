import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { gzipSync, gunzipSync } from 'node:zlib';
import { PARTICIPATION_BANDS } from '../ravenos-participation-map.js';
import { bestExactSpotMarketPerToken } from '../ravenos-discover-intelligence.js';
import { normalizeDexScreenerActivity } from './market_provider_fallbacks.mjs';

export const PARTICIPATION_UNIVERSE_POLICY = Object.freeze({
  cron: '*/2 * * * *',
  chains: Object.freeze(['solana', 'robinhood', 'bsc', 'base', 'ethereum']),
  refresh_seconds: 60, lease_seconds: 90, collection_timeout_ms: 25_000,
  pages_per_band: 2, tokens_per_chain: 450, known_market_limit: 2400,
  tokens_per_request: 30, concurrency: 4, maximum_snapshot_bytes: 6_000_000, maximum_storage_bytes: 1_700_000,
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
      catch { output[position] = { status: 'rejected' }; }
    }
  }));
  return output;
}

// Market cap pages and retained identities are independent of visible Discovery
// rows. None of these calls enumerate wallets or fetch transaction history.
export async function collectParticipationUniverse({
  discoverTokens, readPairs, readKnownMarkets = async () => [], readSeedTokens = async () => [],
  dexchEnabled = true, now = () => Date.now(),
} = {}) {
  const started = now(), deadline = started + policy.collection_timeout_ms;
  const lanes = [], coverage = [], errors = [];
  let requests = 0;
  const jobs = dexchEnabled ? ['robinhood', 'bsc'].flatMap(chain => PARTICIPATION_BANDS.map(band => ({ chain, band }))) : [];
  const [known, seeds] = await Promise.allSettled([readKnownMarkets(), readSeedTokens()]);
  for (const [name, result] of [['retained', known], ['other_provider', seeds]]) {
    if (result.status !== 'fulfilled') { errors.push(name); continue; }
    const rows = Array.isArray(result.value) ? result.value : result.value.rows || [];
    requests += Number.isInteger(result.value.request_count) ? result.value.request_count : 0;
    for (const chain of policy.chains) lanes.push({ chain, id: name, tokens: rows.filter(row => (row.chain_id || row.chain) === chain).map(row => row.token_address || row.address).filter(address => validToken(chain, address)) });
  }
  await boundedMap(jobs, async ({ chain, band }) => {
    const tokens = [], cursors = new Set();
    let cursor = null, exhausted = false, pages = 0, failed = false;
    for (; pages < policy.pages_per_band && now() < deadline; pages += 1) {
      let result;
      try {
        requests += 1;
        result = await discoverTokens({ chains: [chain], sort: 'volume24h', order: 'desc', limit: 100,
          min_market_cap_usd: band.min, ...(band.max === null ? {} : { max_market_cap_usd: band.max }),
          // Established markets supply the full window; recent launches are also
          // admitted through the retained/other-provider lanes above.
          min_age_minutes: 360, cursor });
        if (result.failed_chains?.length) throw new Error('provider_unavailable');
      } catch { failed = true; errors.push(`${chain}:${band.id}`); break; }
      tokens.push(...(result.rows || []).filter(row => row.chain === chain && validToken(chain, row.address)).map(row => row.address));
      cursor = result.next_cursor || null;
      if (!cursor) { exhausted = true; pages += 1; break; }
      if (cursors.has(cursor)) { failed = true; errors.push(`${chain}:${band.id}:cursor_repeated`); break; }
      cursors.add(cursor);
    }
    lanes.push({ chain, id: band.id, tokens });
    coverage.push({ chain, band: band.id, pages, candidates: tokens.length, exhausted, failed });
  }, deadline, now);

  // Interleave size bands and retained markets. A popular chain or its largest
  // cap band cannot consume all slots. Case-sensitive Solana identities survive.
  lanes.sort((a, b) => a.chain.localeCompare(b.chain) || a.id.localeCompare(b.id));
  coverage.sort((a, b) => a.chain.localeCompare(b.chain) || a.band.localeCompare(b.band));
  const selected = new Map(policy.chains.map(chain => [chain, new Map()]));
  const ranks = Math.max(0, ...lanes.map(lane => lane.tokens.length));
  for (let rank = 0; rank < ranks; rank += 1) for (const lane of lanes) {
    const address = lane.tokens[rank], bucket = selected.get(lane.chain);
    if (address && bucket.size < policy.tokens_per_chain) bucket.set(key(lane.chain, address), address);
  }
  const batches = [...selected].flatMap(([chain, tokens]) => {
    const addresses = [...tokens.values()], result = [];
    for (let i = 0; i < addresses.length; i += policy.tokens_per_request) result.push({ chain, batch: i / policy.tokens_per_request, addresses: addresses.slice(i, i + policy.tokens_per_request) });
    return result;
  });
  // Each chain gets its first batch before another chain's second batch.
  batches.sort((a, b) => a.batch - b.batch);
  const result = await boundedMap(batches, async ({ chain, addresses }) => {
    requests += 1;
    const snapshot = await readPairs(chain, addresses), allowed = new Set(addresses.map(address => key(chain, address)));
    return (Array.isArray(snapshot.value) ? snapshot.value : []).filter(pair => pair.chainId === chain && validToken(chain, pair.baseToken?.address) && allowed.has(key(chain, pair.baseToken.address)))
      .map(pair => normalizeDexScreenerActivity(pair, { chain, observedAt: snapshot.observed_at, nowMs: now() })).filter(Boolean);
  }, deadline, now);
  let rows = bestExactSpotMarketPerToken(result.flatMap(item => item?.status === 'fulfilled' ? item.value : []), { nowMs: now() });
  // Remove prose duplicated in every public row before durable serialization.
  rows = rows.map(({ risk, what_changed, inspection, provenance, ...row }) => row);
  const dropped = [], rowBytes = rows.map(row => Buffer.byteLength(JSON.stringify(row)) + 1);
  let size = 2 + rowBytes.reduce((sum, bytes) => sum + bytes, 0);
  while (size > policy.maximum_snapshot_bytes) {
    // Remove one tail per chain, retaining breadth rather than an alphabetical cut.
    for (const chain of [...policy.chains].reverse()) {
      const index = rows.findLastIndex(row => row.chain_id === chain);
      if (index >= 0) { dropped.push(...rows.splice(index, 1)); size -= rowBytes.splice(index, 1)[0]; }
    }
  }
  return {
    schema_version: 'ravenos.participation_universe.v1', ok: rows.length > 0, safe_public: true,
    generated_at: new Date(now()).toISOString(), rows,
    coverage: { tracked: rows.length, candidates: [...selected.values()].reduce((sum, bucket) => sum + bucket.size, 0),
      chains: Object.fromEntries(policy.chains.map(chain => [chain, rows.filter(row => row.chain_id === chain).length])),
      provider_pages: coverage, failed_lanes: errors, failed_pair_batches: result.filter(item => item?.status === 'rejected').length,
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
    async claim(token, now) {
      await db.prepare("INSERT OR IGNORE INTO ravenos_participation_snapshot (scope) VALUES ('onchain')").bind().run();
      const result = await db.prepare("UPDATE ravenos_participation_snapshot SET lease_token=?,lease_expires_at=?,next_refresh_at=? WHERE scope='onchain' AND lease_expires_at<=? AND next_refresh_at<=?")
        .bind(token, now + policy.lease_seconds, now + policy.refresh_seconds, now, now).run();
      return result.meta?.changes === 1;
    },
    async finish(token, payload, now) {
      if (payload?.ok && payload.rows?.length) {
        const serialized = JSON.stringify(payload);
        // Public observations compress well. Keep all measured markets instead
        // of dropping smaller-chain rows to fit D1's per-row storage limit.
        const encoded = serialized.length > 128_000 ? JSON.stringify({ encoding: 'gzip-base64', body: gzipSync(serialized).toString('base64') }) : serialized;
        if (Buffer.byteLength(encoded) > policy.maximum_storage_bytes) throw new Error('participation_snapshot_too_large');
        await db.prepare("UPDATE ravenos_participation_snapshot SET body_json=?,updated_at=?,lease_token=NULL,lease_expires_at=0 WHERE scope='onchain' AND lease_token=?")
          .bind(encoded, now, token).run();
      } else await db.prepare("UPDATE ravenos_participation_snapshot SET lease_token=NULL,lease_expires_at=0 WHERE scope='onchain' AND lease_token=?").bind(token).run();
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
