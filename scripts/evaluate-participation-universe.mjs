import { readFile, writeFile } from 'node:fs/promises';
import { collectRavenParticipation } from '../worker.mjs';
import { buildParticipationMap } from '../ravenos-participation-map.js';
const target = process.argv[2];
if (!target) throw new Error('Provide a new output filename; optionally provide a public market-identity export.');
const source = process.argv[3] ? JSON.parse(await readFile(process.argv[3], 'utf8')) : [];
const known = Array.isArray(source?.[0]?.results) ? source[0].results.map(row => JSON.parse(row.identity_json)) : source;
const env = { RAVENOS_DEXCH_DISCOVERY_ENABLED: '1', RAVENOS_DEXCH_COMMERCIAL_USE_ACKNOWLEDGED: '1',
  ...(process.env.JUPITER_API_KEY ? { JUPITER_API_KEY: process.env.JUPITER_API_KEY } : {}) };
const result = await collectRavenParticipation(env, { rows: known });
const board = buildParticipationMap(result.rows);
const report = { observed_at: result.generated_at, production_deployed: false, public_market_seeds: known.length,
  jupiter_key_configured: Boolean(env.JUPITER_API_KEY), fresh_rpc_calls: 0, coverage: result.coverage,
  boards: { capitalization: board, new_pairs: buildParticipationMap(result.rows, { family: 'new_pairs' }) },
  observations: result.rows.map(row => ({ chain: row.chain_id, token: row.token_address, pool: row.pool_address,
    observed_at: row.observed_at, market_cap_usd: row.market.market_cap_usd, pool_created_at: row.market.pool_created_at,
    change_6h_pct: row.market.price_change_6h_pct, volume_6h_usd: row.market.volume_usd_6h })),
};
await writeFile(target, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ file: target, tracked: result.rows.length, measured: board.measured,
  chains: result.coverage.chains, requests: result.coverage.provider_requests, elapsed_ms: result.coverage.collection_ms,
  size_limited_rows: result.coverage.size_limited_rows, qualified_groups: board.cells.filter(cell => !['developing', 'stale'].includes(cell.state)).length }, null, 2));
