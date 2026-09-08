#!/usr/bin/env node
import { readFileSync,writeFileSync,statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { normalizeSourceWalletChainIdentity } from '../lib/customer_trade/source_wallet_chain_identity.mjs';
import { marketUniverseIdentity } from '../lib/customer_trade/wallet_universe.mjs';
import { normalizeWalletDiscoverySource } from '../lib/customer_trade/wallet_discovery_sources.mjs';
import { cloudflareReleaseEnv } from './lib/cloudflare-release-env.mjs';
import { remoteDiscoveryDb } from './import-retained-wallet-observations.mjs';
const sqlValue = value => typeof value==='number' ? String(value) : "'"+String(value).replaceAll("'","''")+"'";
export function prepareWalletUniverseImport(records,{now=Math.floor(Date.now()/1000)}={}) {
 if(records.length>2400)throw Error('universe_import_too_many_markets');
 const wallets=new Map(),markets=new Map(),sources=new Map();
 for(const packet of records) {
  if(packet.schema_version==='ravenos.wallet_source_list.v1') {
   if(!Array.isArray(packet.wallets)||packet.wallets.length>1000||sources.size+packet.wallets.length>10000)throw Error('universe_import_list_invalid');
   for(const item of packet.wallets) {
    const row=normalizeWalletDiscoverySource({chain:packet.chain,address:item.address,source_kind:packet.source_kind,
      provider:packet.provider,source_reference:packet.source_reference,source_rank:item.rank??null,observed_at:packet.observed_at},now);
    if(row.expires_at<=now)continue;
    const sourceKey=[row.source_wallet_id,row.source_kind,row.provider,row.source_reference].join('|');
    if(!sources.has(sourceKey)||row.observed_at>=sources.get(sourceKey).observed_at)sources.set(sourceKey,row);
    const existing=wallets.get(row.source_wallet_id);
    if(!existing||row.observed_at>existing.observed_at)wallets.set(row.source_wallet_id,{...row,provider_scope:'retained_public_wallet_list'});
   }
   continue;
  }
  const market=marketUniverseIdentity(packet.identity);
  if(!market||market.market_id!==packet.market_id||!Array.isArray(packet.wallets)||packet.wallets.length>100)throw Error('universe_import_packet_invalid');
  markets.set(market.market_id,market);
  for(const row of packet.wallets) {
   const id=normalizeSourceWalletChainIdentity({chain:row.chain,network:'mainnet',address:row.address});
   if(id.source_wallet_id!==row.source_wallet_id||id.chain!==market.chain||row.provider_scope!=='retained_public_trade_senders'||!Number.isSafeInteger(row.observed_at)||row.observed_at>now+60)throw Error('universe_import_observation_invalid');
   if(row.observed_at<now-86400)continue;
   if([market.pool_address,market.token_address,market.quote_token_address].includes(id.address))throw Error('universe_import_pool_or_asset_not_wallet');
   if(!wallets.has(id.source_wallet_id)||wallets.get(id.source_wallet_id).observed_at<row.observed_at)wallets.set(id.source_wallet_id,{...id,observed_at:row.observed_at,provider_scope:row.provider_scope});
  }
 }
 const statements=[];const ordered=[...wallets.values()].sort((a,b)=>a.source_wallet_id.localeCompare(b.source_wallet_id));
 for(let i=0;i<ordered.length;i+=100){
  const rows=ordered.slice(i,i+100).map(w=>[w.source_wallet_id,w.chain,'mainnet',String(w.chain_id),w.vm_family,w.address,'requested',w.provider_scope,now,w.observed_at,now].map(sqlValue).join(','));
  statements.push(`INSERT INTO ravenos_source_wallets (source_wallet_id,chain,network,chain_id,vm_family,address,observation_state,provider_scope,first_requested_at,last_observed_at,updated_at) VALUES ${rows.map(r=>'('+r+')').join(',')} ON CONFLICT(chain,network,address) DO UPDATE SET last_observed_at=excluded.last_observed_at,updated_at=MAX(updated_at,excluded.updated_at) WHERE observation_state='requested' AND last_transaction_reference IS NULL AND (last_observed_at IS NULL OR excluded.last_observed_at>last_observed_at+300)`);
 }
 const sourceRows=[...sources.values()];
 for(let i=0;i<sourceRows.length;i+=100) {
  const chunk=sourceRows.slice(i,i+100),values=chunk.map(s=>[s.source_wallet_id,s.source_kind,s.provider,s.source_reference,s.source_rank,s.priority,s.observed_at,s.expires_at].map(v=>v===null?'NULL':sqlValue(v)).join(','));
  statements.push(`INSERT INTO ravenos_wallet_discovery_sources (source_wallet_id,source_kind,provider,source_reference,source_rank,priority,observed_at,expires_at) VALUES ${values.map(v=>'('+v+')').join(',')}
    ON CONFLICT(source_wallet_id,source_kind,provider,source_reference) DO UPDATE SET source_rank=excluded.source_rank,priority=excluded.priority,observed_at=excluded.observed_at,expires_at=excluded.expires_at WHERE excluded.observed_at>=observed_at`);
  const ids=[...new Set(chunk.map(s=>s.source_wallet_id))].map(sqlValue).join(',');
  statements.push(`UPDATE ravenos_source_wallets SET discovery_priority=COALESCE((SELECT MAX(priority) FROM ravenos_wallet_discovery_sources d WHERE d.source_wallet_id=ravenos_source_wallets.source_wallet_id AND d.expires_at>${now}),0),
    discovery_priority_expires_at=COALESCE((SELECT MAX(expires_at) FROM ravenos_wallet_discovery_sources d WHERE d.source_wallet_id=ravenos_source_wallets.source_wallet_id AND d.expires_at>${now} AND d.priority=(SELECT MAX(priority) FROM ravenos_wallet_discovery_sources x WHERE x.source_wallet_id=d.source_wallet_id AND x.expires_at>${now})),0)
    WHERE source_wallet_id IN (${ids})`);
 }
 return {wallets:ordered,markets:[...markets.values()],sources:sourceRows,statements};
}
async function main(){
 const [input,...flags]=process.argv.slice(2);if(!input||flags.some(f=>f!=='--apply'))throw Error('usage_import_wallet_universe_jsonl_optional_apply');
 if(statSync(input).size>16*1024*1024)throw Error('universe_import_file_too_large');
 const text=readFileSync(input,'utf8'),packets=text.split('\n').filter(Boolean).map(JSON.parse);const now=Math.floor(Date.now()/1000);
 const plan=prepareWalletUniverseImport(packets,{now});
 const report={checked_at:new Date().toISOString(),source_sha256:createHash('sha256').update(text).digest('hex'),wallets:plan.wallets.length,markets:plan.markets.length,sourced_wallets:plan.sources.length,chains:{},applied:false,provider_requests:0,wallet_history_requests:0,copy_enrollments:0,statements:plan.statements.length};
 for(const wallet of plan.wallets)report.chains[wallet.chain]=(report.chains[wallet.chain]||0)+1;
 if(flags.includes('--apply')){
  const env=cloudflareReleaseEnv(process.cwd()),cfg=JSON.parse(readFileSync('wrangler.jsonc','utf8')),database=cfg.d1_databases.find(d=>d.binding==='RAVENOS_CUSTOMER_DB');
  const api=async(path,init={})=>{const response=await fetch('https://api.cloudflare.com/client/v4'+path,{...init,headers:{authorization:'Bearer '+env.CLOUDFLARE_API_TOKEN,'content-type':'application/json'},signal:AbortSignal.timeout(30000),redirect:'manual'});const body=await response.json();if(!response.ok||body.success!==true)throw Error('universe_import_database_unavailable');return body.result;};
  const db=remoteDiscoveryDb({api,accountId:env.CLOUDFLARE_ACCOUNT_ID,databaseId:database.database_id});
  for(const sql of plan.statements)await db.prepare(sql).run();
  // Seed the same persistent frontier; no second wallet database is created.
  for(const id of plan.markets)await db.prepare(`INSERT INTO ravenos_wallet_universe_markets (market_id,chain,identity_json,first_seen_at,last_seen_at,next_scan_at) VALUES (?,?,?,?,?,?) ON CONFLICT(market_id) DO UPDATE SET last_seen_at=MAX(last_seen_at,excluded.last_seen_at)`).bind(id.market_id,id.chain,JSON.stringify(id),now,now,now+21600).run();
  report.applied=true;
 }
 writeFileSync(input+'.import-report.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(String(error.message).replace(/[^a-zA-Z0-9_]/g,'_').slice(0,100));process.exitCode=1;});
