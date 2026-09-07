#!/usr/bin/env node
// Bounded operator bootstrap from already retained Raven market identities.
// Public projections only; no per-wallet RPC, history hydration or execution.
import { readFileSync, appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { marketUniverseIdentity } from '../lib/customer_trade/wallet_universe.mjs';
import { observedMarketWallets } from '../lib/customer_trade/market_wallet_index.mjs';

export async function harvestWalletUniverse({rows,output,maximum=60,fetchImpl=fetch,clock=()=>Date.now(),onProgress=()=>{}}) {
  if(!Number.isInteger(maximum)||maximum<1||maximum>120)throw Error('universe_request_budget_invalid');
  const groups=new Map();
  for(const row of rows.slice(0,240)) {const id=marketUniverseIdentity(row);if(id){if(!groups.has(id.chain))groups.set(id.chain,new Map());groups.get(id.chain).set(id.market_id,id);}}
  const candidates=[]; for(let rank=0;rank<240;rank++)for(const group of groups.values()){const id=[...group.values()][rank];if(id)candidates.push(id);}
  const prior=existsSync(output)?readFileSync(output,'utf8').split('\n').filter(Boolean).map(JSON.parse):[];
  const done=new Set(prior.map(row=>row.market_id));
  const report={started_at:new Date(clock()).toISOString(),requested:0,successful:0,wallet_history_calls:0,maximum_market_requests:maximum,provider_requests_per_market_at_most:2,chains:{},failures:[]};
  for(const identity of candidates.filter(id=>!done.has(id.market_id)).slice(0,maximum)) {
    report.requested++;
    const query=new URLSearchParams({chain:identity.chain,pair_address:identity.pool_address,token_address:identity.token_address,quote_address:identity.quote_token_address});
    try {
      const response=await fetchImpl('https://app.ravenos.xyz/api/onchain/trades?'+query,{signal:AbortSignal.timeout(20000),redirect:'manual'});
      if(!response.ok)throw Error('http_'+response.status);
      const text=await response.text(); if(text.length>1024*1024)throw Error('projection_too_large');
      const projection=JSON.parse(text);
      const actual=marketUniverseIdentity(projection.identity);
      if(!actual || actual.market_id!==identity.market_id || projection.schema_version!=='ravenos.onchain_pool_trades.v1')throw Error('projection_mismatch');
      const wallets=observedMarketWallets(projection,{now:Math.floor(clock()/1000),maximum_rows:100});
      appendFileSync(output,JSON.stringify({market_id:identity.market_id,identity,observed_at:projection.observed_at,wallets})+'\n',{mode:0o600});
      report.successful++; report.chains[identity.chain]=(report.chains[identity.chain]||0)+wallets.length;
    } catch(error) {report.failures.push({market_id:identity.market_id,chain:identity.chain,error:/^http_\d+$/.test(error.message)?error.message:'market_projection_unavailable'});}
    if(report.requested%10===0)onProgress({...report});
  }
  const retained=existsSync(output)?readFileSync(output,'utf8').split('\n').filter(Boolean).map(JSON.parse):[];
  const unique=new Map();for(const row of retained)for(const wallet of row.wallets)unique.set(wallet.source_wallet_id,wallet);
  report.total_unique_wallets=unique.size;report.retained_chains={};for(const wallet of unique.values())report.retained_chains[wallet.chain]=(report.retained_chains[wallet.chain]||0)+1;
  report.finished_at=new Date(clock()).toISOString();writeFileSync(output+'.report.json',JSON.stringify(report,null,2)+'\n');return report;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [input,output,max='60']=process.argv.slice(2); if(!input||!output)throw Error('usage_harvest_retained_markets_json_output_jsonl_max_requests');
  const data=JSON.parse(readFileSync(input,'utf8'));if(data.ok!==true||data.safe_public!==true||!Array.isArray(data.rows))throw Error('public_market_projection_required');
  console.log(JSON.stringify(await harvestWalletUniverse({rows:data.rows,output,maximum:Number(max),onProgress:r=>console.log(JSON.stringify({attempted:r.requested,succeeded:r.successful,failures:r.failures.length}))}))); 
}
