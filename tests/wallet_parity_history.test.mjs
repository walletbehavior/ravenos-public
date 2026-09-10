import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sqliteStore } from './customer_pro_rewards.test.mjs';
import { createD1CustomerWalletCopyStore, persistSourceWalletProfile } from '../lib/customer_wallet_copy.mjs';
import { createD1SourceWalletBackfillStore, createSourceWalletBackfillJob, runSourceWalletBackfillBatch, publicSourceWalletBackfillJob, sourceWalletBackfillHistoryEvidence } from '../lib/customer_trade/source_wallet_backfill.mjs';
import { normalizeSourceWalletChainIdentity } from '../lib/customer_trade/source_wallet_chain_identity.mjs';
import { loadEvmWalletBackfillPage } from '../lib/customer_trade/evm_wallet_backfill.mjs';
import { historicalUsdValue, loadWalletHistoricalPrices, walletUsdTradingRecord } from '../lib/customer_trade/wallet_historical_prices.mjs';
import { enrichHolderWalletContext } from '../lib/customer_trade/holder_wallet_context.mjs';
import { evmSettlementBases, decodeEvmWalletReceipt, WALLET_SWAP_TOPICS } from '../lib/customer_trade/evm_wallet_swaps.mjs';
import { loadAlchemyWalletInputs } from '../lib/customer_trade/alchemy_wallet_history.mjs';
import { EvmWalletReceiptPolicy, readEvmWalletRpcResponse } from '../lib/customer_trade/evm_wallet_receipt_policy.mjs';

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

for(const [chain,chainId,key,host] of [['base',8453,'BASE','base-mainnet'],['ethereum',1,'ETH','eth-mainnet'],['bsc',56,'BSC','bnb-mainnet'],['robinhood',4663,'ROBINHOOD','robinhood-mainnet']])test(`${chain} bulk distributions retain the last wallet leg and allow deeper history to advance`,async()=>{
  const p=provider();let corrupt=false;
  const fetchImpl=async(url,options)=>{
    const req=JSON.parse(options.body);
    if(req.method==='eth_chainId')return Response.json({id:1,result:hex(chainId)});
    const res=await p.fetchImpl(url,options);
    if(req.method!=='eth_getTransactionReceipt')return res;
    const body=await res.json(),receipt=body.result;
    receipt.logs=Array.from({length:2000},(_,i)=>({address:T,topics:[WALLET_SWAP_TOPICS.transfer,word(S),word(i===1999?W:'0x'+BigInt(i+10000).toString(16).padStart(40,'0'))],data:hash(5000000),logIndex:hex(i),transactionHash:hash(1),blockHash:corrupt&&i===1999?hash(999):block(100).hash,blockNumber:hex(100),transactionIndex:'0x0',removed:false,blockTimestamp:block(100).timestamp}));
    assert(JSON.stringify(body).length>1024*1024);
    return Response.json(body);
  };
  const configured={...env,[`ALCHEMY_${key}_RPC_URL`]:`https://${host}.g.alchemy.com/v2/private-fixture`};
  const job=createSourceWalletBackfillJob({chain,address:W,requested_at:new Date(NOW).toISOString()});
  const page=await loadEvmWalletBackfillPage(configured,job,{fetchImpl,now:NOW});
  assert.equal(page.cursor.direction,'out');assert.equal(page.events.length,1);
  assert.equal(page.events[0].wallet_accounting.movements[0].delta_raw,'5000000');
  assert.equal(page.events[0].classification.kind,'TRANSFER_IN');assert.equal(page.events[0].wallet_accounting.trade,null);
  const quick=await loadAlchemyWalletInputs(configured,chain,W,{fetchImpl,now:NOW,historyPage:{transfers:[{hash:hash(1),blockNum:hex(100),uniqueId:'transfer',category:'erc20',from:S,to:W,rawContract:{address:T},metadata:{blockTimestamp:new Date(Number(BigInt(block(100).timestamp))*1000).toISOString()}}]}});
  assert.equal(quick.reconstruction.events.length,1);
  corrupt=true;await assert.rejects(loadEvmWalletBackfillPage(configured,job,{fetchImpl,now:NOW}),/receipt_incomplete/);
});

test('receipt byte and log limits remain bounded and do not silently truncate evidence',async()=>{
  const fail=code=>{throw Error(code);};
  for(const declared of [false,true]){
    const response=new Response('x'.repeat(EvmWalletReceiptPolicy.maximum_receipt_bytes+1),{headers:declared?{'content-length':String(EvmWalletReceiptPolicy.maximum_receipt_bytes+1)}:{}});
    await assert.rejects(readEvmWalletRpcResponse(response,'eth_getTransactionReceipt',fail,'test'),/response_too_large/);
  }
  await assert.rejects(readEvmWalletRpcResponse(new Response('x'.repeat(1024*1024+1)),'eth_call',fail,'test'),/response_too_large/);
  const p=provider(),job=createSourceWalletBackfillJob({chain:'base',address:W,requested_at:new Date(NOW).toISOString()});
  await assert.rejects(loadEvmWalletBackfillPage(env,job,{now:NOW,fetchImpl:async(url,options)=>{
    const r=await p.fetchImpl(url,options);if(JSON.parse(options.body).method!=='eth_getTransactionReceipt')return r;
    const body=await r.json();body.result.logs=Array(EvmWalletReceiptPolicy.maximum_logs+1).fill({});return Response.json(body);
  }}),/receipt_log_budget/);
});

test('deeper EVM pages share pinned reads, preserve pending references and reuse retained receipts', async () => {
  const p = provider(), calls = [];
  const transfers = Array.from({ length: 16 }, (_, i) => ({ hash: hash(i + 1), blockNum: hex(100), uniqueId: `transfer-${i}`,
    category: 'erc20', from: S, to: W, rawContract: { address: T }, metadata: { blockTimestamp: new Date(Number(BigInt(block(100).timestamp)) * 1000).toISOString() } }));
  const fetchImpl = async (url, options) => {
    const request = JSON.parse(options.body); calls.push(request);
    if (request.method === 'alchemy_getAssetTransfers') return Response.json({ id: 1, result: { transfers: request.params[0].toAddress ? transfers : [] } });
    const response = await p.fetchImpl(url, options);
    if (!['eth_getTransactionReceipt', 'eth_getTransactionByHash'].includes(request.method)) return response;
    const body = await response.json();
    if (request.method === 'eth_getTransactionReceipt') body.result.transactionHash = request.params[0];
    else body.result.hash = request.params[0];
    return Response.json(body);
  };
  const job = createSourceWalletBackfillJob({ chain: 'base', address: W, requested_at: new Date(NOW).toISOString() });
  const first = await loadEvmWalletBackfillPage(env, job, { fetchImpl, now: NOW, maximumNewReferences: 6 });
  assert.equal(first.events.length, 6); assert.equal(first.cursor.pending.length, 10);
  assert.equal(first.cursor.direction, 'in');
  assert.equal(calls.filter(r => r.method === 'eth_chainId').length, 1, 'nested decoders share the verified chain read');
  assert.equal(calls.filter(r => r.method === 'eth_getBlockByNumber' && r.params[0] === hex(100)).length, 1, 'same-block references share the header');
  assert.equal(first.request_count, calls.length);
  calls.length = 0;
  const second = await loadEvmWalletBackfillPage(env, { ...job, provider_cursor: first.cursor }, { fetchImpl, now: NOW + 1000 });
  assert.equal(second.events.length, 10); assert.equal(second.cursor.pending.length, 0); assert.equal(second.cursor.direction, 'out');
  assert.equal(new Set([...first.events, ...second.events].map(e => e.event_id)).size, 16);
  assert.equal(calls.filter(r => r.method === 'alchemy_getAssetTransfers').length, 0, 'pending references do not repeat the index request');
  assert.equal(second.request_count, calls.length); assert(second.request_count < 100);
  calls.length = 0;
  const retained = new Map([...first.events, ...second.events].map(e => [e.chain_evidence.transaction_reference, e]));
  const replay = await loadEvmWalletBackfillPage(env, job, { fetchImpl, now: NOW, existingTransaction: async (_, reference) => retained.get(reference) });
  assert.equal(replay.reference_count, 16); assert.equal(replay.events.length, 0); assert.equal(replay.cursor.pending.length, 0);
  assert.equal(calls.filter(r => r.method === 'eth_getTransactionReceipt').length, 0);
  assert(calls.every(r => !/send|sign|approve/i.test(r.method)));
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
  const outbound=await loadEvmWalletBackfillPage(env,{...job,provider_cursor:first.cursor},{fetchImpl:p.fetchImpl,now:NOW+1000});
  assert.equal(outbound.cursor.direction,'in');
  p.calls.length=0;
  const second=await loadEvmWalletBackfillPage(env,{...job,provider_cursor:outbound.cursor},{fetchImpl:p.fetchImpl,now:NOW+11*60000,existingTransaction:async()=>first.events[0]});
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

for (const [chain, chainId, key, host] of [['base',8453,'BASE','base-mainnet'],['ethereum',1,'ETH','eth-mainnet'],['bsc',56,'BSC','bnb-mainnet'],['robinhood',4663,'ROBINHOOD','robinhood-mainnet']]) {
 test(`${chain} background history creates and refreshes a profile before anyone inspects it`, async t => {
  const db=sqliteStore();t.after(()=>db.raw.close());
  const store=createD1CustomerWalletCopyStore(db), identity=normalizeSourceWalletChainIdentity({chain,network:'mainnet',address:W});
  const backfill=createD1SourceWalletBackfillStore(db,{record_events:store.recordEvents}), p=provider();
  await store.upsertSourceWallet({...identity,now:NOW/1000,state:'requested',provider_scope:'history'});
  await backfill.enqueueJob({chain,address:W,now:NOW});
  const configured={...env,[`ALCHEMY_${key}_RPC_URL`]:`https://${host}.g.alchemy.com/v2/private-fixture`};
  const fetchImpl=async(url,options)=>JSON.parse(options.body).method==='eth_chainId'
   ? Response.json({id:1,result:hex(chainId)}) : p.fetchImpl(url,options);
  await runSourceWalletBackfillBatch(backfill,{fetchSignatures:async()=>[],hydrateTransaction:async()=>null,fetchEvmPage:j=>loadEvmWalletBackfillPage(configured,j,{now:NOW,fetchImpl})},{now:NOW,maximum_jobs:1});
  assert.equal(await store.latestProfile(identity.source_wallet_id),null);
  const calls=p.calls.length;
  const history={backfill_state:'queued',window_start_block:0,window_end_block:136};
  const profile=await persistSourceWalletProfile(store,identity.source_wallet_id,NOW/1000,history);
  assert.equal(p.calls.length,calls,'profile materialization only uses cached evidence');
  assert.equal(profile.schema_version,'ravenos.evm_wallet_basic_profile.v2');
  assert.equal(profile.source_wallet.chain,chain);assert.equal(profile.source_wallet.chain_id,chainId);
  assert.equal(profile.coverage.transactions_observed,1);
  assert.equal(profile.source_performance.realized_pnl_usdc,null);
  assert.equal(profile.wallet_reconstruction.decoded_trades,0);
  assert.equal(profile.capital_observations.native.amount,null);
  assert.equal(profile.capital_observations.native.observed_at,null);
  assert.equal(profile.balances_observed_at,null);
  assert.equal(profile.evidence_boundary.provider_reported_balances,false);
  assert.equal(profile.coverage.source_history_complete,false);
  assert.equal(profile.retained_lookup.activity.pagination.provider_has_more,true);
  const [event]=await store.listSourceEvents(identity.source_wallet_id);
  await store.recordEvents(identity.source_wallet_id,[{...event,event_id:'swe_'+'b'.repeat(40),chain_evidence:{...event.chain_evidence,transaction_reference:hash(2),block_number:101}}],NOW/1000+1);
  const refreshed=await persistSourceWalletProfile(store,identity.source_wallet_id,NOW/1000+1,history);
  assert.equal(refreshed.coverage.transactions_observed,2);
  assert.equal(refreshed.provider_activity.observed_transfer_rows,2);
  assert.equal(refreshed.balances_observed_at,null,'a history refresh cannot invent a balance timestamp');
  assert.equal((await store.latestProfile(identity.source_wallet_id)).coverage.transactions_observed,2);
 });
}

test('decoder improvements append evidence but activity and rolling counts retain one transaction revision',async()=>{
  const db=sqliteStore(),store=createD1CustomerWalletCopyStore(db),p=provider();
  await store.upsertSourceWallet({...id,now:NOW/1000,state:'requested',provider_scope:'history'});
  const page=await loadEvmWalletBackfillPage(env,createSourceWalletBackfillJob({chain:'base',address:W,requested_at:new Date(NOW).toISOString()}),{now:NOW,fetchImpl:p.fetchImpl});
  const newer=page.events[0];
  // Reproduce the deployed version-102 identity; the next revision must append
  // under a different ID, while activity still selects exactly one transaction.
  const priorId='swe_'+createHash('sha256').update(JSON.stringify(['base',W,newer.chain_evidence.transaction_reference,'wallet_receipt_v2'])).digest('hex').slice(0,40);
  const older={...newer,event_id:priorId,decode_version:102};
  assert.notEqual(newer.event_id,priorId); assert.equal(newer.decode_version,103);
  await store.recordEvents(id.source_wallet_id,[older,newer],NOW/1000);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM ravenos_source_wallet_events').get().n,2);
  const current=await store.listSourceEvents(id.source_wallet_id);
  assert.equal(current.length,1); assert.equal(current[0].decode_version,103);
  assert.equal((await store.listSourceEventPage(id.source_wallet_id)).matching_event_count,1);db.raw.close();
});

for(const [chain,chainId,key,host] of [['base',8453,'BASE','base-mainnet'],['ethereum',1,'ETH','eth-mainnet'],['bsc',56,'BSC','bnb-mainnet'],['robinhood',4663,'ROBINHOOD','robinhood-mainnet']]) {
 for(const cachedCount of [1,2]) test(`${chain} cached receipt references advance a real database page (${cachedCount}/2 reused)`,async t=>{
  const db=sqliteStore();t.after(()=>db.raw.close());
  const walletStore=createD1CustomerWalletCopyStore(db),backfill=createD1SourceWalletBackfillStore(db,{record_events:walletStore.recordEvents});
  const identity=normalizeSourceWalletChainIdentity({chain,network:'mainnet',address:W});
  await walletStore.upsertSourceWallet({...identity,now:NOW/1000,state:'requested',provider_scope:'history'});
  const job=await backfill.enqueueJob({chain,address:W,now:NOW});
  const configured={...env,[`ALCHEMY_${key}_RPC_URL`]:`https://${host}.g.alchemy.com/v2/private-fixture`},p=provider(),receiptReads=[];
  const fetchImpl=async(url,options)=>{
   const {method,params}=JSON.parse(options.body),response=await p.fetchImpl(url,options),body=await response.json();
   if(method==='eth_chainId')body.result=hex(chainId);
   if(method==='alchemy_getAssetTransfers'&&body.result.transfers.length)body.result.transfers.push({...body.result.transfers[0],hash:hash(2),uniqueId:'transfer-2'});
   if(method==='eth_getTransactionReceipt'){receiptReads.push(params[0]);body.result.transactionHash=params[0];}
   if(method==='eth_getTransactionByHash')body.result.hash=params[0];
   return Response.json(body);
  };
  const initial=await loadEvmWalletBackfillPage(configured,job,{fetchImpl,now:NOW});
  assert.equal(initial.events.length,2);
  // An interactive inspection has already persisted some or all of this page.
  await walletStore.recordEvents(identity.source_wallet_id,initial.events.slice(0,cachedCount),NOW/1000);
  receiptReads.length=0;
  const run=await runSourceWalletBackfillBatch(backfill,{fetchSignatures:async()=>{throw Error('unexpected_solana_read');},hydrateTransaction:async()=>{throw Error('unexpected_solana_read');},fetchEvmPage:current=>loadEvmWalletBackfillPage(configured,current,{fetchImpl,now:NOW,existingTransaction:async(sourceId,reference,blockHash)=>{
   const row=db.raw.prepare('SELECT event_json,block_hash FROM ravenos_wallet_latest_events WHERE source_wallet_id=? AND transaction_reference=?').get(sourceId,reference);
   if(row)assert.equal(row.block_hash,blockHash);
   return row?JSON.parse(row.event_json):null;
  }})},{now:NOW,maximum_jobs:1});
  assert.equal(run.totals.pages_completed,1);
  assert.equal(run.totals.transactions_decoded,2);
  const current=await backfill.jobForSource(identity.source_wallet_id);
  assert.equal(current.state,'queued');assert.equal(current.provider_cursor.direction,'out');
  assert.equal(current.transactions_decoded,2);assert.equal(current.signatures_seen,2);
  assert.equal(receiptReads.length,2-cachedCount);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM ravenos_source_wallet_events').get().n,2);
  const page=db.raw.prepare('SELECT signature_count,decoded_count,failure_count,evidence_json FROM ravenos_source_wallet_backfill_pages').get();
  assert.equal(page.signature_count,2);assert.equal(page.decoded_count,2);assert.equal(page.failure_count,0);
  assert.equal(JSON.parse(page.evidence_json).reused_reference_count,cachedCount);
  assert.equal(db.raw.prepare('PRAGMA foreign_key_check').all().length,0);
 });
}

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


for(const [chain,chainId,key,host] of [['base',8453,'BASE','base-mainnet'],['ethereum',1,'ETH','eth-mainnet'],['bsc',56,'BSC','bnb-mainnet'],['robinhood',4663,'ROBINHOOD','robinhood-mainnet']]) {
 test(`${chain} one missing receipt is quarantined while good history and profiles advance`,async t=>{
  const db=sqliteStore();t.after(()=>db.raw.close());
  const walletStore=createD1CustomerWalletCopyStore(db),backfill=createD1SourceWalletBackfillStore(db,{record_events:walletStore.recordEvents});
  const identity=normalizeSourceWalletChainIdentity({chain,network:'mainnet',address:W});
  await walletStore.upsertSourceWallet({...identity,now:NOW/1000,state:'requested',provider_scope:'history'});
  await backfill.enqueueJob({chain,address:W,now:NOW});
  const configured={...env,[`ALCHEMY_${key}_RPC_URL`]:`https://${host}.g.alchemy.com/v2/private-fixture`},p=provider();
  let recovered=false,clock=NOW;
  const reads=[];
  const fetchImpl=async(url,options)=>{
   const {method,params}=JSON.parse(options.body);reads.push({method,params});
   const body=await (await p.fetchImpl(url,options)).json();
   if(method==='eth_chainId')body.result=hex(chainId);
   if(method==='alchemy_getAssetTransfers'&&body.result.transfers.length)body.result.transfers.push({...body.result.transfers[0],hash:hash(2),uniqueId:'transfer-2'});
   if(method==='eth_getTransactionReceipt')body.result=params[0]===hash(2)&&!recovered?null:{...body.result,transactionHash:params[0]};
   if(method==='eth_getTransactionByHash')body.result.hash=params[0];
   return Response.json(body);
  };
  const run=()=>runSourceWalletBackfillBatch(backfill,{fetchSignatures:async()=>{throw Error('unexpected_solana');},hydrateTransaction:async()=>{throw Error('unexpected_solana');},fetchEvmPage:async job=>loadEvmWalletBackfillPage(configured,job,{fetchImpl,now:clock,deferReferenceFailures:true,retryReferences:await backfill.dueReferences(job.job_id,clock)})},{now:clock,maximum_jobs:1});
  const first=await run();assert.equal(first.totals.pages_partial,1);assert.equal(first.totals.transactions_decoded,1);
  let job=await backfill.jobForSource(identity.source_wallet_id);
  assert.equal(job.state,'queued');assert.equal(job.provider_cursor.direction,'out');assert.equal(job.provider_cursor.unresolved_references,1);
  const profile=await persistSourceWalletProfile(walletStore,identity.source_wallet_id,clock/1000,sourceWalletBackfillHistoryEvidence(job));
  assert(profile);assert.equal(profile.durable_history.unresolved_references,1);assert.equal(profile.durable_history.complete_wallet_history,false);
  assert.equal((await walletStore.listSourceEvents(identity.source_wallet_id)).length,1);
  clock+=1000;await run();job=await backfill.jobForSource(identity.source_wallet_id);
  assert.equal(job.state,'retry_wait');assert.equal(job.provider_cursor.direction,'done');assert.equal(job.history_exhausted,false);
  assert.equal(job.provider_cursor.verified_through_block,undefined);
  // No retry happens before its cooldown; the other direction was still read.
  assert.equal(reads.filter(r=>r.method==='eth_getTransactionReceipt'&&r.params[0]===hash(2)).length,1);
  clock=NOW+61000;recovered=true;await run();job=await backfill.jobForSource(identity.source_wallet_id);
  assert.equal(job.state,'complete');assert.equal(job.provider_cursor.unresolved_references,0);
  assert.equal(job.provider_cursor.verified_through_block,hex(136));
  assert.equal(job.transactions_decoded,2);assert.equal(job.signatures_seen,2);
  assert.equal((await walletStore.listSourceEvents(identity.source_wallet_id)).length,2);
  const retry=db.raw.prepare('SELECT * FROM ravenos_wallet_reference_retries').get();assert.equal(retry.state,'resolved');
  const pages=db.raw.prepare('SELECT * FROM ravenos_source_wallet_backfill_pages ORDER BY observed_at').all();
  assert.equal(pages.length,3);assert.equal(pages[0].state,'partial');assert.equal(pages[0].failure_count,1);
  assert.throws(()=>db.raw.prepare("UPDATE ravenos_source_wallet_backfill_pages SET state='complete'").run(),/append_only/);
  assert(!JSON.stringify(pages).includes('private-fixture'));
  assert(reads.every(r=>!r.method.match(/send|sign|approve/i)));
 });
}


test('receipt progress survives a crash before cursor commit and reuses retained evidence',async t=>{
 const db=sqliteStore();t.after(()=>db.raw.close());
 const walletStore=createD1CustomerWalletCopyStore(db),backfill=createD1SourceWalletBackfillStore(db,{record_events:walletStore.recordEvents});
 await walletStore.upsertSourceWallet({...id,now:NOW/1000,state:'requested',provider_scope:'history'});
 await backfill.enqueueJob({chain:'base',address:W,now:NOW});
 const p=provider();let clock=NOW,crash=true;
 const deps={fetchSignatures:async()=>[],hydrateTransaction:async()=>null,fetchEvmPage:async job=>loadEvmWalletBackfillPage(env,job,{fetchImpl:p.fetchImpl,now:clock,deferReferenceFailures:true,existingTransaction:async(sourceId,reference)=>{
  const row=db.raw.prepare('SELECT event_json FROM ravenos_wallet_latest_events WHERE source_wallet_id=? AND transaction_reference=?').get(sourceId,reference);
  return row?JSON.parse(row.event_json):null;
 }})};
 const interrupted={...backfill,advanceJob:async input=>{if(crash){crash=false;throw Error('simulated_cursor_write_failure');}return backfill.advanceJob(input);}};
 await runSourceWalletBackfillBatch(interrupted,deps,{now:clock,maximum_jobs:1});
 assert.equal((await walletStore.listSourceEvents(id.source_wallet_id)).length,1);
 assert.equal((await backfill.jobForSource(id.source_wallet_id)).provider_cursor,null);
 const receiptReads=p.calls.filter(row=>row.method==='eth_getTransactionReceipt').length;
 clock+=60000;await runSourceWalletBackfillBatch(backfill,deps,{now:clock,maximum_jobs:1});
 const job=await backfill.jobForSource(id.source_wallet_id);
 assert.equal(job.state,'queued');assert.equal(job.signatures_seen,1);assert.equal(job.transactions_decoded,1);
 assert.equal(p.calls.filter(row=>row.method==='eth_getTransactionReceipt').length,receiptReads);
 assert.equal((await walletStore.listSourceEvents(id.source_wallet_id)).length,1);
});

test('overlapping incoming/outgoing indexes cannot bypass an individual receipt retry limit',async()=>{
 const job=createSourceWalletBackfillJob({chain:'base',address:W,requested_at:new Date(NOW).toISOString()});
 const p=provider({failReceipt:true});
 const page=await loadEvmWalletBackfillPage(env,job,{fetchImpl:p.fetchImpl,now:NOW,deferReferenceFailures:true,
   referenceFailure:async()=>({state:'unresolved',last_error_code:'evm_wallet_backfill_receipt_incomplete'})});
 assert.equal(page.events.length,0);assert.equal(page.cursor.direction,'out');
 assert.equal(page.reference_outcomes[0].deferred,true);
 assert(!p.calls.some(call=>call.method==='eth_getTransactionReceipt'));
});
