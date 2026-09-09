// Bounded public GET evaluation. No credentials, RPC, transaction or billing calls.
import { writeFile } from 'node:fs/promises';
import worker from '../worker.mjs';
const env = {
  RAVENOS_MARKET_PROVIDER_FALLBACKS_ENABLED: '1', RAVENOS_DEXCH_CHARTS_ENABLED: '1',
  RAVENOS_DEXCH_DISCOVERY_ENABLED: '1', RAVENOS_DEXCH_COMMERCIAL_USE_ACKNOWLEDGED: '1',
  ONCHAIN_CHART_PROVIDER: 'coingecko',
};
const chains = ['solana','base','bsc','ethereum','robinhood'];
async function read(path) {
  const start = performance.now();
  const response = await worker.fetch(new Request('https://ravenos.xyz'+path),env);
  const body = await response.json();
  return { status: response.status, elapsed_ms: Math.round(performance.now()-start), value: body.data || body };
}
const pulse = await read('/api/onchain/trending?chains='+chains.join(',')+'&duration=5m');
const anchors = [
  {chain:'bsc',asset:'BREW/WBNB',pair_address:'0x3ea3f9a7b7edbfe0ba3568bfc0f30ba870b7553d',token_address:'0xfa6d9b504848606eb9aec04ccc161d169b3f2159',quote_address:'0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'},
  {chain:'robinhood',asset:'CHART/ETH',pair_address:'0x1a3b0b30dd0ddba010d2b4e269fbd68d76d78dcbbcdc78a084a8ab4613b8db96',token_address:'0x2112a316a2e56d7300092e5a41d2a84dd11d3bd6',quote_address:'0x0000000000000000000000000000000000000000'},
];
const charts = [];
for (const anchor of anchors) {
  const result = await read('/api/terminal/chart?'+new URLSearchParams({...anchor,market:'crypto_spot',timeframe:'1m',limit:'240',instrument_scope:'exact_pool'}));
  charts.push({...anchor,status:result.status,elapsed_ms:result.elapsed_ms,ok:result.value.ok,
    provider:result.value.candle_series?.provider||null,returned_bars:result.value.candles?.length||0,
    latest_candle:result.value.last_candle_at||null,continuity:result.value.continuity?.identity?.state||null,
    attempts:result.value.provider_selection?.attempted||result.value.provider_attempts||[],
  });
}
const report = {schema_version:'ravenos.market_provider_replacement_evaluation.v1',observed_at:new Date().toISOString(),
  mode:'local_worker_live_public_gets',credentials_used:false,production_deployed:false,money_movement:false,
  discovery:{status:pulse.status,elapsed_ms:pulse.elapsed_ms,ok:pulse.value.ok,state:pulse.value.state,
    providers:pulse.value.provenance?.provider,chains:Object.fromEntries(chains.map(chain=>[chain,(pulse.value.rows||[]).filter(row=>row.chain_id===chain).length])),unavailable:pulse.value.unavailable||[]},
  charts,limitations:['Snapshot coverage is not an SLA or a complete token census.','Dexch token-scoped candles require matching pool identity and a known history boundary.','CoinGecko was not given a key; this verifies independence for successful routes, not its current account quota.']};
const target=process.argv[2];
if(target)await writeFile(target,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report,null,2));
