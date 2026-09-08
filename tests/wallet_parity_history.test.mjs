import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteStore } from './customer_pro_rewards.test.mjs';
import { createD1CustomerWalletCopyStore, persistSourceWalletProfile } from '../lib/customer_wallet_copy.mjs';
import { createD1SourceWalletBackfillStore, createSourceWalletBackfillJob, runSourceWalletBackfillBatch, publicSourceWalletBackfillJob } from '../lib/customer_trade/source_wallet_backfill.mjs';
import { normalizeSourceWalletChainIdentity } from '../lib/customer_trade/source_wallet_chain_identity.mjs';
import { loadEvmWalletBackfillPage } from '../lib/customer_trade/evm_wallet_backfill.mjs';
import { historicalUsdValue, loadWalletHistoricalPrices, walletUsdTradingRecord } from '../lib/customer_trade/wallet_historical_prices.mjs';
import { enrichHolderWalletContext } from '../lib/customer_trade/holder_wallet_context.mjs';
import { evmSettlementBases, decodeEvmWalletReceipt, WALLET_SWAP_TOPICS } from '../lib/customer_trade/evm_wallet_swaps.mjs';

const NOW=Date.parse('2026-09-08T12:00:00Z'), W='0x'+'11'.repeat(20), T='0x'+'22'.repeat(20), S='0x'+'33'.repeat(20);
const id=normalizeSourceWalletChainIdentity({chain:'base',network:'mainnet',address:W});
const hex=n=>'0x'+BigInt(n).toString(16),hash=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),word=a=>'0x'+a.slice(2).padStart(64,'0');
const env={RAVENOS_EVM_WALLET_BACKFILL_ENABLED:'1',RAVENOS_EVM_WALLET_RECONSTRUCTION_ENABLED:'1',RAVENOS_ALCHEMY_WALLET_HISTORY_ENABLED:'1',RAVENOS_WALLET_HISTORICAL_USD_ENABLED:'1',ALCHEMY_BASE_RPC_URL:'https://base-mainnet.g.alchemy.com/v2/private-fixture'};
const block=n=>({number:hex(n),hash:hash(n+1000),timestamp:hex(Math.floor(NOW/1000)-200+n)});
function provider({mismatch=false,failReceipt=false,more=false}={}) {
  const calls=[];
  return {calls,async fetchImpl(url,options){
    const {method,params}=JSON.parse(options.body);calls.push({method,params});let result;
    if(method==='eth_chainId')result=hex(mismatch?1:8453);
    else if(method==='eth_blockNumber')result=hex(200);
    else if(method==='eth_getBlockByNumber')result=block(Number(BigInt(params[0])));
    else if(method==='alchemy_getAssetTransfers')result={transfers:params[0].toAddress?[{hash:hash(1),blockNum:hex(100),uniqueId:'transfer',category:'erc20',from:S,to:W,rawContract:{address:T},metadata:{blockTimestamp:new Date(Number(BigInt(block(100).timestamp))*1000).toISOString()}}]:[],pageKey:more?'next-private-cursor':null};
    else if(method==='eth_getTransactionReceipt')result=failReceipt?null:{transactionHash:hash(1),blockHash:block(100).hash,blockNumber:hex(100),transactionIndex:'0x0',status:'0x1',logs:[{address:T,logIndex:'0x0',topics:[WALLET_SWAP_TOPICS.transfer,word(S),word(W)],data:hash(5000000)}]};
    else if(method==='eth_getTransactionByHash')result={hash:hash(1),blockHash:block(100).hash,blockNumber:hex(100),from:S,to:W,value:'0x0'};
    else if(method==='alchemy_getTokenMetadata')result={decimals:6,symbol:'TOKEN',name:'Token'};
    else throw Error('unexpected_read_method');
    return Response.json({jsonrpc:'2.0',id:1,result});
  }};
}

test('EVM history uses pinned heads, both directions and receipt-backed transfer events',async()=>{
  const p=provider(),job=createSourceWalletBackfillJob({chain:'base',address:W,requested_at:new Date(NOW).toISOString(),provider:'alchemy_wallet_history'});
  const first=await loadEvmWalletBackfillPage(env,job,{fetchImpl:p.fetchImpl,now:NOW});
  assert.equal(first.events.length,1);assert.equal(first.events[0].classification.kind,'TRANSFER_IN');assert.equal(first.events[0].source_wallet_id,id.source_wallet_id);
  assert.equal(first.cursor.direction,'out');assert.equal(first.exhausted,false);assert.equal(first.cursor.head,hex(136));
  const second=await loadEvmWalletBackfillPage(env,{...job,provider_cursor:first.cursor},{fetchImpl:p.fetchImpl,now:NOW+1000});
  assert.equal(second.exhausted,true);assert.equal(second.cursor.direction,'done');
  const queries=p.calls.filter(c=>c.method==='alchemy_getAssetTransfers');assert.equal(queries[0].params[0].toBlock,queries[1].params[0].toBlock);
  assert(p.calls.every(c=>!c.method.match(/send|sign|approve/i)));assert(first.request_count<=100);
});

test('wrong network, changed pinned head, missing receipt and disabled feature fail closed',async()=>{
  const job=createSourceWalletBackfillJob({chain:'base',address:W,requested_at:new Date(NOW).toISOString()});
  await assert.rejects(loadEvmWalletBackfillPage({...env,RAVENOS_EVM_WALLET_BACKFILL_ENABLED:'0'},job),/disabled/);
  await assert.rejects(loadEvmWalletBackfillPage(env,job,{fetchImpl:provider({mismatch:true}).fetchImpl,now:NOW}),/chain_mismatch/);
  await assert.rejects(loadEvmWalletBackfillPage(env,job,{fetchImpl:provider({failReceipt:true}).fetchImpl,now:NOW}),/receipt_incomplete/);
  const first=await loadEvmWalletBackfillPage(env,job,{fetchImpl:provider().fetchImpl,now:NOW});first.cursor.head_hash=hash(9999);
  await assert.rejects(loadEvmWalletBackfillPage(env,{...job,provider_cursor:first.cursor},{fetchImpl:provider().fetchImpl,now:NOW}),/reorg_requires_review/);
});

test('expired provider tokens restart inclusively at the last block and reuse saved receipt evidence',async()=>{
  const job=createSourceWalletBackfillJob({chain:'base',address:W,requested_at:new Date(NOW).toISOString()}),p=provider({more:true});
  const first=await loadEvmWalletBackfillPage(env,job,{fetchImpl:p.fetchImpl,now:NOW});
  p.calls.length=0;
  const second=await loadEvmWalletBackfillPage(env,{...job,provider_cursor:first.cursor},{fetchImpl:p.fetchImpl,now:NOW+11*60000,existingTransaction:async()=>first.events[0]});
  const q=p.calls.find(c=>c.method==='alchemy_getAssetTransfers').params[0];
  assert.equal(q.pageKey,undefined);assert.equal(q.toBlock,hex(100));assert.equal(second.events.length,0);
  assert(!p.calls.some(c=>c.method==='eth_getTransactionReceipt'));
});

test('completed histories catch up from the last verified head instead of scanning the month again',async()=>{
  const p=provider(),job=createSourceWalletBackfillJob({chain:'base',address:W,requested_at:new Date(NOW).toISOString()});
  let result=await loadEvmWalletBackfillPage(env,job,{fetchImpl:p.fetchImpl,now:NOW});
  result=await loadEvmWalletBackfillPage(env,{...job,provider_cursor:result.cursor},{fetchImpl:p.fetchImpl,now:NOW});
  assert.equal(result.cursor.verified_through_block,hex(136));
  const calls=[];
  const fetchImpl=async(url,options)=>{
    const request=JSON.parse(options.body);calls.push(request);
    if(request.method==='eth_blockNumber')return Response.json({id:1,result:hex(210)});
    if(request.method==='alchemy_getAssetTransfers')return Response.json({id:1,result:{transfers:[]}});
    return p.fetchImpl(url,options);
  };
  const next=await loadEvmWalletBackfillPage(env,{...job,provider_cursor:{...result.cursor,advance_from_head:true}},{fetchImpl,now:NOW+600000});
  assert.equal(calls.find(c=>c.method==='alchemy_getAssetTransfers').params[0].fromBlock,hex(137));
  assert.equal(next.cursor.head,hex(146));assert.equal(next.cursor.verified_through_block,hex(136));
});

test('one chain-scoped D1 job persists cursor through leasing and replay without duplicate events',async()=>{
  const db=sqliteStore(),store=createD1CustomerWalletCopyStore(db),backfill=createD1SourceWalletBackfillStore(db,{record_events:store.recordEvents});
  await store.upsertSourceWallet({...id,now:NOW/1000,state:'requested',provider_scope:'history'});
  const job=await backfill.enqueueJob({chain:'base',address:W,now:NOW});
  assert.equal((await backfill.enqueueJob({chain:'base',address:W.toUpperCase().replace('0X','0x'),now:NOW})).job_id,job.job_id);
  const p=provider(),deps={fetchSignatures:async()=>[],hydrateTransaction:async()=>null,fetchEvmPage:j=>loadEvmWalletBackfillPage(env,j,{fetchImpl:p.fetchImpl,now:NOW})};
  await runSourceWalletBackfillBatch(backfill,deps,{now:NOW,maximum_jobs:1});
  const current=await backfill.jobForSource(id.source_wallet_id);
  assert.equal(current.provider_cursor.direction,'out');assert.equal(current.state,'queued');
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM ravenos_source_wallet_events').get().n,1);
  const events=await store.listSourceEvents(id.source_wallet_id);await store.recordEvents(id.source_wallet_id,events,NOW/1000);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM ravenos_source_wallet_events').get().n,1);
  assert.equal(db.raw.prepare('SELECT chain_event_time FROM ravenos_source_wallet_events').get().chain_event_time,NOW/1000-100);
  assert(!JSON.stringify(publicSourceWalletBackfillJob(current)).includes('head_hash'));
  await runSourceWalletBackfillBatch(backfill,deps,{now:NOW+1000,maximum_jobs:1});
  assert.equal((await backfill.jobForSource(id.source_wallet_id)).state,'complete');
  assert.equal(db.raw.prepare('PRAGMA foreign_key_check').all().length,0);db.raw.close();
});

test('decoder improvements append evidence but activity and rolling counts retain one transaction revision',async()=>{
  const db=sqliteStore(),store=createD1CustomerWalletCopyStore(db),p=provider();
  await store.upsertSourceWallet({...id,now:NOW/1000,state:'requested',provider_scope:'history'});
  const page=await loadEvmWalletBackfillPage(env,createSourceWalletBackfillJob({chain:'base',address:W,requested_at:new Date(NOW).toISOString()}),{now:NOW,fetchImpl:p.fetchImpl});
  const newer=page.events[0],older={...newer,event_id:'swe_'+'a'.repeat(40),decode_version:101};
  await store.recordEvents(id.source_wallet_id,[older,newer],NOW/1000);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM ravenos_source_wallet_events').get().n,2);
  assert.equal((await store.listSourceEvents(id.source_wallet_id)).length,1);
  assert.equal((await store.listSourceEventPage(id.source_wallet_id)).matching_event_count,1);db.raw.close();
});

test('historical USD uses integer rounding, preceding five-minute evidence and no present-day substitution',()=>{
  const at=Math.floor(NOW/1000),prices=[{symbol:'ETH',bucket_at:at,price_usd:'2497.1234567',provider:'alchemy_historical_5m'}];
  assert.equal(historicalUsdValue('1000000000000000000',18,'ETH',at+20,prices).micro_usd,'2497123456');
  assert.equal(historicalUsdValue('1',18,'ETH',at,prices).micro_usd,'0');
  assert.equal(historicalUsdValue('100',18,'ETH',at-1,prices),null);
  assert.equal(historicalUsdValue('100',18,'ETH',at+301,prices),null);
  assert.equal(historicalUsdValue('100',18,'USDG',at,prices),null);
});

test('USD accounting preserves ETH price movement and separates unpriced settlement assets',()=>{
  const basis=evmSettlementBases('base').native,times=[NOW-600000,NOW-300000];
  const events=times.map((t,i)=>({event_id:'e'+i,source_wallet:{chain:'base'},chain_evidence:{block_number:i,transaction_index:0,block_time:new Date(t).toISOString()},wallet_accounting:{version:1,movements:[{contract:T,decimals:6,delta_raw:i?'-1000000':'1000000'}],trade:{token:T,kind:i?'SWAP_SELL':'SWAP_BUY',quantity:'1000000',decimals:6,basis,consideration:'1000000000000000000'}}}));
  const prices=times.map((t,i)=>({symbol:'ETH',bucket_at:t/1000,price_usd:i?'2100':'2000',provider:'alchemy_historical_5m'}));
  const profile={source_wallet:{chain:'base'},generated_at:new Date(NOW).toISOString(),wallet_reconstruction:{opening_balances:{[T]:'0'}}};
  const usd=walletUsdTradingRecord(profile,events,prices);
  assert.equal(usd.periods.d30.realized_pnl.usd,'100');assert.equal(usd.priced_trades,2);assert.equal(usd.network_fees_included,false);
  assert.equal(walletUsdTradingRecord(profile,events,prices.slice(0,1)).periods.d30.realized_pnl.usd,null);
});

test('historical price reads share day cache and never send wallet addresses',async()=>{
  const db=sqliteStore(),day=Math.floor(NOW/1000/86400)*86400-86400;let calls=0;
  const events=[{source_wallet:{chain:'base',address:W},chain_evidence:{block_time:new Date((day+100)*1000).toISOString()}}];
  const fetchImpl=async(url,options)=>{calls++;assert(!options.body.includes(W));return Response.json({symbol:'ETH',currency:'usd',data:Array.from({length:288},(_,i)=>({timestamp:new Date((day+i*300)*1000).toISOString(),value:'2000'}))});};
  assert.equal((await loadWalletHistoricalPrices(env,db,events,{now:NOW,fetchImpl})).length,288);
  await loadWalletHistoricalPrices(env,db,events,{now:NOW+1000,fetchImpl});assert.equal(calls,1);db.raw.close();
});

test('cached historical FX remains readable without provider credentials and cannot trigger a fresh call',async()=>{
  const db=sqliteStore(),at=NOW/1000;
  db.raw.prepare('INSERT INTO ravenos_wallet_historical_prices VALUES (?,?,?,?,?)').run('ETH',at,'2000',at,'alchemy_historical_5m');
  const prices=await loadWalletHistoricalPrices({RAVENOS_WALLET_HISTORICAL_USD_ENABLED:'1'},db,[{source_wallet:{chain:'base'},chain_evidence:{block_time:new Date(NOW).toISOString()}}],{now:NOW,maximumDays:0,fetchImpl:()=>{throw Error('must_not_fetch');}});
  assert.equal(prices.length,1);assert.equal(prices[0].price_usd,'2000');db.raw.close();
});

test('holder context is cache-only, chain exact and excludes private account fields',async()=>{
  const db=sqliteStore(),store=createD1CustomerWalletCopyStore(db);
  await store.upsertSourceWallet({...id,now:NOW/1000,state:'requested',provider_scope:'history'});
  const profile={schema_version:'ravenos.evm_wallet_basic_profile.v1',profile_version:2,source_wallet:{chain:'base',network:'mainnet',chain_id:8453,address:W},generated_at:new Date(NOW).toISOString(),behavior:{trade_count:2},coverage:{normalized_events:2},source_performance:{state:'partial'},trading_record:{tokens:[{mint:T,buy_count:1,sell_count:1,by_basis:{usdc:{matched_cost:'100',realized_pnl:'25'}}}]},retained_lookup:{email:'private@example.test',rewards:'99999'}};
  await store.recordProfile(id.source_wallet_id,profile,NOW/1000);
  const result=await enrichHolderWalletContext({identity:{chain:'base',token_address:T},holders:[{holder_address:W,classification:'owner'}]},db);
  assert.equal(result.holders[0].wallet_context.token.by_basis.usdc.realized_pnl,'25');
  assert.equal(result.wallet_context_coverage.provider_request_performed,false);assert(!JSON.stringify(result).includes('private@'));assert(!JSON.stringify(result).includes('99999'));
  const other=await enrichHolderWalletContext({identity:{chain:'ethereum',token_address:T},holders:[{holder_address:W,classification:'owner'}]},db);assert.equal(other.holders[0].wallet_context,null);db.raw.close();
});
