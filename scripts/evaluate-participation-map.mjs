// Bounded public market reads; no account, RPC, signing, or billing access.
// Every run writes a new file. It cannot overwrite a previous observation.
import { writeFile } from 'node:fs/promises';
import worker from '../worker.mjs';
import { buildParticipationMap } from '../ravenos-participation-map.js';

const env = {
  RAVENOS_MARKET_PROVIDER_FALLBACKS_ENABLED: '1',
  RAVENOS_DEXCH_DISCOVERY_ENABLED: '1',
  RAVENOS_DEXCH_COMMERCIAL_USE_ACKNOWLEDGED: '1',
};
const started = performance.now();
const response = await worker.fetch(new Request('https://ravenos.xyz/api/onchain/trending?chains=solana,base,bsc,ethereum,robinhood&duration=5m'), env);
const payload = await response.json(), rows = (payload.data || payload).rows || [];
const now = Date.now(), board = buildParticipationMap(rows, { now });
const report = {
  schema_version: 'ravenos.participation_probe.v1', observed_at: new Date(now).toISOString(),
  mode: 'local_worker_live_public_reads', production_deployed: false, credentials_used: false,
  persistent_cache_bound: false, elapsed_ms: Math.round(performance.now() - started), status: response.status,
  rows: rows.length,
  chains: Object.fromEntries([...new Set(rows.map(row => row.chain_id))].map(chain => {
    const selected = rows.filter(row => row.chain_id === chain);
    return [chain, { rows: selected.length,
      with_6h_return: selected.filter(row => Number.isFinite(row.market?.price_change_6h_pct)).length,
      with_6h_volume: selected.filter(row => Number.isFinite(row.market?.volume_usd_6h)).length }];
  })),
  board,
  limitations: ['Public discovery sample, not chain-wide coverage or wallet P&L.', 'Local probe has no production retained-market cache; production coverage must be checked separately.', 'No 6h return is inferred for pairs younger than six hours.'],
};
const target = process.argv[2];
if (!target) throw new Error('Provide a new output JSON filename.');
await writeFile(target, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ file: target, elapsed_ms: report.elapsed_ms, rows: report.rows, chains: report.chains,
  cells: board.cells.length, measured: board.measured, states: Object.fromEntries([...new Set(board.cells.map(cell => cell.state))].map(state => [state, board.cells.filter(cell => cell.state === state).length])) }, null, 2));
