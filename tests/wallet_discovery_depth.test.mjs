import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import bs58 from 'bs58';
import {sqliteStore} from './customer_pro_rewards.test.mjs';
import {createD1CustomerWalletCopyStore} from '../lib/customer_wallet_copy.mjs';
import {createD1SourceWalletBackfillStore,runSourceWalletBackfillBatch,publicSourceWalletBackfillJob} from '../lib/customer_trade/source_wallet_backfill.mjs';
import {loadHeliusWalletPage} from '../lib/customer_trade/helius_wallet_history.mjs';
import {normalizeSolanaWalletTransaction} from '../lib/customer_trade/solana_wallet_intelligence.mjs';
import {normalizeSourceWalletChainIdentity} from '../lib/customer_trade/source_wallet_chain_identity.mjs';
import {WalletHistoryPolicy,heliusBackfillPolicy,reserveHeliusBackfillCredits} from '../lib/customer_trade/wallet_history_policy.mjs';
import {normalizeWalletDiscoverySource,retainWalletDiscoverySource,queuePriorityWalletWarmups} from '../lib/customer_trade/wallet_discovery_sources.mjs';
import {parseKolscanPublicLeaderboard,refreshPublicWalletList,KolscanPublicList} from '../lib/customer_trade/public_wallet_lists.mjs';
import {prepareWalletUniverseImport} from '../scripts/import-wallet-universe.mjs';
import {normalizeWalletScreenerRequest} from '../lib/customer_trade/wallet_screener.mjs';
const NOW=1788878400,ISO=new Date(NOW*1000).toISOString();
const address=n=>bs58.encode(Buffer.alloc(32,n));
const WALLET=address(7);
const signature=n=>{const b=Buffer.alloc(64,7);b.writeUInt32BE(n,60);return bs58.encode(b);};
const transaction=n=>({slot:100000-n,blockTime:NOW-n,
  transaction:{signatures:[signature(n)],message:{accountKeys:[{pubkey:WALLET,signer:true}],instructions:[]}},
  meta:{err:null,fee:5000,preBalances:[1000000000],postBalances:[999995000],preTokenBalances:[],postTokenBalances:[],innerInstructions:[],logMessages:[]}});

test('page receipt migration preserves old evidence exactly and keeps append-only protection',()=>{
 const raw=new DatabaseSync(':memory:');
 const original=readFileSync('customer-migrations/0011_source_wallet_backfill.sql','utf8');
 raw.exec('CREATE TABLE ravenos_source_wallet_backfill_jobs(job_id TEXT PRIMARY KEY);CREATE TABLE ravenos_source_wallets(source_wallet_id TEXT PRIMARY KEY);CREATE TABLE ravenos_public_wallet_list_refresh(state TEXT,next_refresh_at INTEGER);');
 raw.exec(original.slice(original.indexOf('CREATE TABLE ravenos_source_wallet_backfill_pages ('),original.indexOf('CREATE TABLE ravenos_source_wallet_backfill_runs (')));
 const id='swbp_'+ 'a'.repeat(40),proof=JSON.stringify({raw_provider_payload_persisted:false,transaction_material_persisted:false,subscriber_identity_included:false});
 raw.prepare("INSERT INTO ravenos_source_wallet_backfill_jobs VALUES ('job')").run();raw.prepare("INSERT INTO ravenos_source_wallets VALUES ('wallet')").run();
 raw.prepare("INSERT INTO ravenos_source_wallet_backfill_pages VALUES (?,'ravenos.source_wallet_backfill_page.v1','job','wallet','head',NULL,'complete',100,100,0,0,?,'helius_address_history',?,?)").run(id,'b'.repeat(40),proof,NOW);
 const before=raw.prepare('SELECT * FROM ravenos_source_wallet_backfill_pages').all();
 raw.exec(readFileSync('customer-migrations/0045_wallet_page_receipts.sql','utf8'));
 assert.deepEqual(raw.prepare('SELECT * FROM ravenos_source_wallet_backfill_pages').all(),before);
 assert.throws(()=>raw.prepare('UPDATE ravenos_source_wallet_backfill_pages SET decoded_count=0').run(),/append_only/);
 raw.close();
});
const packet=(kind,addresses,at=NOW)=>({schema_version:'ravenos.wallet_source_list.v1',source_kind:kind,provider:'gmgn_public_list',
  source_reference:'https://gmgn.ai/discover',chain:'solana',observed_at:at,wallets:addresses.map((address,i)=>({address,rank:i+1}))});
async function source(db,wallet=WALLET,chain='solana') {
 const store=createD1CustomerWalletCopyStore(db),id=normalizeSourceWalletChainIdentity({chain,network:'mainnet',address:wallet});
 await store.upsertSourceWallet({...id,now:NOW});
 return {store,id,backfill:createD1SourceWalletBackfillStore(db,{record_events:(...args)=>store.recordEvents(...args)})};
}
function importLists(db,packets) {const plan=prepareWalletUniverseImport(packets,{now:NOW});for(const sql of plan.statements)db.raw.exec(sql);return plan;}

test('free public Kolscan intake reads visible links once per interval without importing identities, returns or trades',async()=>{
 const db=sqliteStore(),walletStore=createD1CustomerWalletCopyStore(db);
 const html=`<h1>KOL Leaderboard</h1><a href="/account/${WALLET}?timeframe=1">Unverified name and PNL</a><a href="/account/${WALLET}">duplicate</a><a href="https://evil.example/account/${address(8)}">external</a><a href="/account/invalid">invalid</a>`;
 const parsed=parseKolscanPublicLeaderboard(html,{now:NOW});assert.equal(parsed.wallets.length,1);
 assert(!JSON.stringify(parsed).includes('Unverified'));assert.equal(parsed.provider,'kolscan_public_daily');
 assert.throws(()=>parseKolscanPublicLeaderboard('<h1>KOL Leaderboard</h1>'),/empty/);
 assert.throws(()=>parseKolscanPublicLeaderboard('x'.repeat(KolscanPublicList.maximum_bytes+1)),/unavailable/);
 const env={RAVENOS_CUSTOMER_DB:db,RAVENOS_WALLET_PUBLIC_LISTS_ENABLED:'1',RAVENOS_WALLET_INTELLIGENCE_ENABLED:'1',RAVENOS_WALLET_SCREENER_ENABLED:'1'};
 let calls=0;const fetchImpl=async(url,init)=>{calls++;assert.equal(url,'https://kolscan.io/leaderboard');assert.equal(init.redirect,'error');assert.equal(init.headers.authorization,undefined);return new Response(html,{headers:{'content-type':'text/html'}});};
 const results=await Promise.all([refreshPublicWalletList(env,{walletStore,fetchImpl,now:NOW}),refreshPublicWalletList(env,{walletStore,fetchImpl,now:NOW})]);
 assert.equal(calls,1);assert(results.some(r=>r.state==='current'));assert(results.some(r=>r.state==='cached'));
 assert.equal(db.raw.prepare('SELECT count(*) n FROM ravenos_source_wallets').get().n,1);
 assert.equal(db.raw.prepare('SELECT count(*) n FROM ravenos_source_wallet_events').get().n,0);
 assert.equal(db.raw.prepare('SELECT count(*) n FROM ravenos_source_wallet_backfill_jobs').get().n,0);
 assert.equal((await refreshPublicWalletList({...env,RAVENOS_WALLET_PUBLIC_LISTS_ENABLED:'0'},{walletStore,fetchImpl,now:NOW+21600})).state,'disabled');
 assert.equal(calls,1);
 const failure=await refreshPublicWalletList(env,{walletStore,now:NOW+21600,fetchImpl:async()=>new Response('provider unavailable',{status:503})});
 assert.equal(failure.state,'unavailable');assert.equal(db.raw.prepare('SELECT count(*) n FROM ravenos_wallet_discovery_sources').get().n,1);
 assert.equal(db.raw.prepare('SELECT last_error_code FROM ravenos_public_wallet_list_refresh').get().last_error_code,'public_wallet_list_http_503');
});

test('older list observations cannot overwrite fresher rank or priority evidence',async()=>{
 const db=sqliteStore(),{id}=await source(db);
 const row={...id,source_kind:'kol',provider:'kolscan_public_daily',source_reference:'https://kolscan.io/leaderboard',observed_at:NOW,source_rank:3};
 await retainWalletDiscoverySource(db,row,NOW);
 await retainWalletDiscoverySource(db,{...row,observed_at:NOW-100,source_rank:1},NOW);
 assert.equal(db.raw.prepare('SELECT source_rank FROM ravenos_wallet_discovery_sources').get().source_rank,3);
});

test('known source lists populate one registry in priority order without fabricated profiles or Copy enrollment',async()=>{
 const db=sqliteStore(),store=createD1CustomerWalletCopyStore(db);
 importLists(db,[packet('active_trader',[address(1)]),packet('top_trader',[address(2)]),packet('top_holder',[address(3)]),packet('smart_money',[address(4)]),packet('kol',[address(5)])]);
 importLists(db,[packet('kol',[address(5)])]);
 const query=normalizeWalletScreenerRequest({view:'observed',chain:'solana',page_size:12},{now:NOW});
 const result=await store.listSeenWallets(query);
 assert.deepEqual(result.rows.map(w=>w.source_wallet.address),[5,4,3,2,1].map(address));
 assert.equal(result.rows[0].discovery_sources[0].provider,'gmgn_public_list');
 assert.equal(result.rows[0].discovery_sources[0].identity_verified,false);
 assert(result.rows.every(row=>row.performance_claimed===false&&row.copyability_claimed===false));
 assert.equal(result.provider_request_performed,false);
 for(const table of ['ravenos_source_wallet_profiles','ravenos_source_wallet_backfill_jobs','ravenos_customer_wallet_copy_watches'])assert.equal(db.raw.prepare('SELECT count(*) n FROM '+table).get().n,0);
 const kol=await store.listSeenWallets(normalizeWalletScreenerRequest({view:'observed',chain:'solana',observed:{source:'kol'}},{now:NOW}));
 assert.equal(kol.total,1);assert.equal(kol.rows[0].source_wallet.address,address(5));
 const expired=await store.listSeenWallets(normalizeWalletScreenerRequest({view:'observed',observed:{source:'kol'}},{now:NOW+31*86400}));
 assert.equal(expired.total,0);
});

test('warmups retain only 1,000 events; user requests promote the same cursor to 50,000',async()=>{
 const db=sqliteStore(),{backfill}=await source(db);
 importLists(db,[packet('kol',[WALLET])]);
 const warm=await queuePriorityWalletWarmups(db,backfill,{now:NOW*1000,helius:true});
 assert.equal(warm.queued,1);assert.equal(warm.provider_requests,0);
 const id=normalizeSourceWalletChainIdentity({chain:'solana',network:'mainnet',address:WALLET}).source_wallet_id;
 const old=await backfill.jobForSource(id);assert.equal(old.history_target,1000);
 const cursor=JSON.stringify({pagination_token:'99123:4'});
 db.raw.prepare("UPDATE ravenos_source_wallet_backfill_jobs SET state='bounded_partial',signatures_seen=1000,transactions_decoded=1000,provider_cursor_json=?,cursor_before=?,page_count=2 WHERE job_id=?").run(cursor,signature(1000),old.job_id);
 const promoted=await backfill.enqueueJob({address:WALLET,demand_class:'interactive_lookup',now:(NOW+1)*1000});
 assert.equal(promoted.job_id,old.job_id);assert.equal(promoted.history_target,50000);assert.equal(promoted.state,'queued');
 assert.deepEqual(promoted.provider_cursor,{pagination_token:'99123:4'});assert.equal(promoted.signatures_seen,1000);assert.equal(promoted.cursor_before,signature(1000));
 assert.equal(publicSourceWalletBackfillJob(promoted).maximum_signatures,50000);
 assert.equal((await queuePriorityWalletWarmups(db,backfill,{now:NOW*1000,helius:true})).queued,0);
});

test('interactive requests outrank sourced lists; sourced lists outrank incidental research',async()=>{
 const db=sqliteStore(),{backfill}=await source(db,address(9));
 await backfill.enqueueJob({address:address(9),demand_class:'interactive_lookup',now:NOW*1000});
 importLists(db,[packet('kol',[address(1)]),packet('smart_money',[address(2)]),packet('top_holder',[address(3)])]);
 await queuePriorityWalletWarmups(db,backfill,{now:NOW*1000,helius:true});
 await source(db,address(8));await backfill.enqueueJob({address:address(8),demand_class:'nexus_research',evidence_priority:999,now:NOW*1000});
 const jobs=await backfill.leaseJobs({worker_id:'priority_test',now:NOW*1000,limit:5,lease_seconds:180});
 assert.deepEqual(jobs.map(j=>j.source_wallet.address),[9,1,2,3,8].map(address));
});

test('background warmups serve all chains despite a continuous high-priority Solana list',async()=>{
 const db=sqliteStore(),{backfill}=await source(db,address(90));
 const chains=['solana','base','bsc','ethereum','robinhood'];
 for(const chain of chains)importLists(db,[{...packet(chain==='solana'?'kol':'top_trader',Array.from({length:12},(_,i)=>chain==='solana'?address(i+1):'0x'+(i+1).toString(16).padStart(40,'0'))),chain}]);
 for(let cycle=0;cycle<2;cycle++) {
  const result=await queuePriorityWalletWarmups(db,backfill,{now:(NOW+cycle*300)*1000,helius:true,evm:true});
  assert.equal(result.queued,4);assert.equal(result.provider_requests,0);
 }
 const queued=db.raw.prepare('SELECT DISTINCT s.chain FROM ravenos_source_wallet_backfill_jobs j JOIN ravenos_source_wallets s ON s.source_wallet_id=j.source_wallet_id').all().map(r=>r.chain).sort();
 assert.deepEqual(queued,chains.sort());
});

test('background history leases rotate chains while explicit user lookups retain priority',async()=>{
 const db=sqliteStore(),{backfill}=await source(db,address(90));
 const chains=['solana','base','bsc','ethereum','robinhood'];
 for(const chain of chains)for(let i=1;i<=6;i++) {
  const wallet=chain==='solana'?address(i):'0x'+i.toString(16).padStart(40,'0');
  await source(db,wallet,chain);
  importLists(db,[{...packet(chain==='solana'?'kol':'top_trader',[wallet]),chain}]);
  await backfill.enqueueJob({address:wallet,chain,demand_class:'indexed_research',evidence_priority:chain==='solana'?900:650,history_target:1000,now:NOW*1000});
 }
 const visited=new Set();
 for(let cycle=0;cycle<2;cycle++) {
  const jobs=await backfill.leaseJobs({worker_id:'fair_'+cycle,now:(NOW+cycle*300)*1000,limit:4,lease_seconds:180});
  assert.equal(jobs.length,4);assert.equal(new Set(jobs.map(j=>j.source_wallet.chain)).size,4);
  for(const job of jobs){visited.add(job.source_wallet.chain);await backfill.deferJob({job,next_attempt_at:(NOW+3600)*1000,now:(NOW+cycle*300)*1000});}
 }
 assert.deepEqual([...visited].sort(),chains.sort());
 await backfill.enqueueJob({address:address(90),chain:'solana',demand_class:'interactive_lookup',now:(NOW+601)*1000});
 const [first]=await backfill.leaseJobs({worker_id:'interactive',now:(NOW+602)*1000,limit:4,lease_seconds:180});
 assert.equal(first.source_wallet.address,address(90));
});

test('profile refreshes serve every chain while direct user demand remains first',async()=>{
 const db=sqliteStore(),{backfill}=await source(db,address(90));
 const chains=['solana','base','bsc','ethereum','robinhood'];
 for(const chain of chains)for(let i=1;i<=6;i++) {
  const wallet=chain==='solana'?address(i):'0x'+i.toString(16).padStart(40,'0');
  await source(db,wallet,chain);
  await backfill.enqueueJob({address:wallet,chain,evidence_priority:chain==='solana'?900:650,now:NOW*1000});
 }
 db.raw.exec('UPDATE ravenos_source_wallet_backfill_jobs SET signatures_seen=1');
 // A failed refresh writes no new snapshot. It must still yield the next turn.
 const failedCycle=await backfill.listProfileRefreshCandidates(4,{now:NOW*1000});
 const followingCycle=await backfill.listProfileRefreshCandidates(4,{now:(NOW+300)*1000});
 assert.deepEqual([...new Set([...failedCycle,...followingCycle].map(j=>j.source_wallet.chain))].sort(),chains.slice().sort());
 const visited=new Set();let sequence=0;
 for(let cycle=0;cycle<2;cycle++) {
  const jobs=await backfill.listProfileRefreshCandidates(4,{now:(NOW+cycle*300)*1000});
  assert.equal(jobs.length,4);assert.equal(new Set(jobs.map(j=>j.source_wallet.chain)).size,4);
  for(const job of jobs) {
   visited.add(job.source_wallet.chain);
   const snapshot='swp_'+String(++sequence).padStart(40,'0'),generated=NOW+1+cycle*300;
   db.raw.prepare(`INSERT INTO ravenos_source_wallet_profiles
    (profile_snapshot_id,source_wallet_id,profile_version,normalized_event_count,profile_json,generated_at,retention_expires_at)
    VALUES (?,?,1,1,'{}',?,?)`).run(snapshot,job.source_wallet_id,generated,generated+86400);
   db.raw.prepare(`INSERT INTO ravenos_source_wallet_current_profiles
    (source_wallet_id,profile_snapshot_id,profile_version,generated_at,trade_count,active_days,token_count,performance_state,closed_lots,profile_hash,updated_at)
    VALUES (?,?,1,?,0,0,0,'insufficient_evidence',0,?,?)`).run(job.source_wallet_id,snapshot,generated,'a'.repeat(40),generated);
  }
 }
 assert.deepEqual([...visited].sort(),chains.sort());
 const interactive=await backfill.enqueueJob({address:address(90),chain:'solana',demand_class:'interactive_lookup',now:(NOW+601)*1000});
 db.raw.prepare('UPDATE ravenos_source_wallet_backfill_jobs SET signatures_seen=1 WHERE job_id=?').run(interactive.job_id);
 const [first]=await backfill.listProfileRefreshCandidates(4,{now:(NOW+602)*1000});
 assert.equal(first.job_id,interactive.job_id);
});

test('disabled history providers do not consume another chain’s warmup slots',async()=>{
 const db=sqliteStore(),{backfill}=await source(db,address(90));
 importLists(db,[packet('kol',Array.from({length:8},(_,i)=>address(i+1)))]);
 for(const chain of ['base','bsc','ethereum','robinhood'])importLists(db,[{...packet('top_trader',['0x'+'1'.repeat(40)]),chain}]);
 assert.equal((await queuePriorityWalletWarmups(db,backfill,{now:NOW*1000,helius:false,evm:false})).queued,0);
 assert.equal((await queuePriorityWalletWarmups(db,backfill,{now:NOW*1000,helius:false,evm:true})).queued,4);
 const jobs=db.raw.prepare('SELECT s.chain FROM ravenos_source_wallet_backfill_jobs j JOIN ravenos_source_wallets s ON s.source_wallet_id=j.source_wallet_id').all();
 assert.deepEqual(jobs.map(j=>j.chain).sort(),['base','bsc','ethereum','robinhood']);
 assert.equal((await queuePriorityWalletWarmups(db,backfill,{now:(NOW+300)*1000,helius:true,evm:false})).queued,4);
});

test('a full 1,000-transaction Helius page performs one RPC and zero transaction re-fetches',async()=>{
 const db=sqliteStore(),{store,id,backfill}=await source(db);
 await backfill.enqueueJob({address:WALLET,demand_class:'interactive_lookup',now:NOW*1000});
 let calls=0,hydrates=0;
 const report=await runSourceWalletBackfillBatch(backfill,{
   fetchSignatures:async input=>loadHeliusWalletPage({RAVENOS_HELIUS_WALLET_HISTORY_ENABLED:'1',HELIUS_API_KEY:'fixture-secret'},
     {address:WALLET,limit:input.limit,cache_transactions:false,now:NOW*1000},
     {rpc:async(url,method,params,bounds)=>{calls++;assert.equal(params[1].limit,1000);assert.equal(params[1].filters.tokenAccounts,'balanceChanged');assert(bounds.maxBytes<=16*1024*1024);return {data:Array.from({length:1000},(_,i)=>transaction(i+1)),paginationToken:'99000:1'};}}),
   hydrateTransaction:async()=>{hydrates++;throw Error('must_not_fetch_again');},
 },{now:NOW*1000,maximum_jobs:1,maximum_pages_per_job:1,solana_page_size:1000});
 assert.equal(calls,1);assert.equal(hydrates,0);assert.equal(report.totals.transactions_decoded,1000);
 const job=await backfill.jobForSource(id.source_wallet_id);assert.equal(job.provider_cursor.pagination_token,'99000:1');assert.equal(job.state,'queued');
 assert.equal((await store.listSourceEventPage(id.source_wallet_id,{limit:12})).matching_event_count,1000);
 const receipt=db.raw.prepare('SELECT * FROM ravenos_source_wallet_backfill_pages').get();
 assert.equal(receipt.signature_count,1000);assert.equal(receipt.decoded_count,1000);
 assert.equal(JSON.parse(receipt.evidence_json).raw_provider_payload_persisted,false);
 assert.throws(()=>db.raw.prepare('UPDATE ravenos_source_wallet_backfill_pages SET decoded_count=0').run(),/append_only/);
 await assert.rejects(backfill.recordPage({...JSON.parse(receipt.evidence_json),page_id:'swbp_'+ 'e'.repeat(40),signature_count:1001,decoded_count:1001}),/CHECK/);
 assert(!JSON.stringify(report).includes('fixture-secret'));
});

test('history credit reservations are shared, bounded, and defer without exhausting retry attempts',async()=>{
 const db=sqliteStore(),{backfill}=await source(db);
 assert.equal(heliusBackfillPolicy({}).page_size,500);
 const calls=await Promise.allSettled(Array.from({length:4},()=>reserveHeliusBackfillCredits(db,{limit:500,budget:100,now:NOW*1000})));
 assert.equal(calls.filter(c=>c.status==='fulfilled').length,2);
 assert.equal(db.raw.prepare('SELECT reserved_credits FROM ravenos_wallet_history_budget').get().reserved_credits,100);
 await backfill.enqueueJob({address:WALLET,now:NOW*1000});
 const report=await runSourceWalletBackfillBatch(backfill,{fetchSignatures:()=>reserveHeliusBackfillCredits(db,{limit:500,budget:100,now:NOW*1000}),hydrateTransaction:async()=>{throw Error();}},{now:NOW*1000});
 assert.equal(report.totals.jobs_budget_deferred,1);assert.equal(report.totals.jobs_dead_lettered,0);
 const row=db.raw.prepare('SELECT attempt_count,state,next_attempt_at FROM ravenos_source_wallet_backfill_jobs').get();
 assert.equal(row.attempt_count,0);assert.equal(row.state,'retry_wait');assert(row.next_attempt_at>NOW);
 assert.equal(await reserveHeliusBackfillCredits(db,{limit:500,budget:100,now:(NOW+3600)*1000}),50);
});

test('25,010 retained Solana events remain pageable past 10,000 without loading or refetching the archive',async()=>{
 const db=sqliteStore(),{store,id}=await source(db);
 for(let offset=0;offset<25010;offset+=500) {
   const events=Array.from({length:Math.min(500,25010-offset)},(_,i)=>{
     const tx=transaction(offset+i+1);
     return normalizeSolanaWalletTransaction({wallet_address:WALLET,signature_record:{signature:tx.transaction.signatures[0],slot:tx.slot,blockTime:tx.blockTime,err:null,confirmationStatus:'confirmed'},transaction:tx,
       provider:'helius_address_history',finality:'confirmed',observation_mode:'historical_backfill',observed_at:ISO,received_at:ISO,decode_started_at:ISO,decoded_at:ISO});
   });
   await store.recordEvents(id.source_wallet_id,events,NOW);
 }
 const plan=db.raw.prepare('EXPLAIN QUERY PLAN SELECT event_id FROM ravenos_wallet_latest_events WHERE source_wallet_id=? ORDER BY COALESCE(block_time,chain_event_time,observed_at) DESC,event_id DESC LIMIT 13').all(id.source_wallet_id);
 assert(plan.some(row=>row.detail.includes('ravenos_wallet_event_activity_order')));
 assert(!plan.some(row=>row.detail.includes('TEMP B-TREE')));
 const page=await store.listSourceEventPage(id.source_wallet_id,{limit:12,cursor:{order_time:NOW-24000,event_id:'swe_0000000000000000000000000000000000000000'}});
 assert.equal(page.matching_event_count,25010);assert.equal(page.events.length,12);assert.equal(page.has_more,true);
 assert(page.events.every(e=>e.chain_evidence.slot<76000));
 assert.equal((await store.listSourceEvents(id.source_wallet_id,WalletHistoryPolicy.solana_analysis_events)).length,10000);
 assert.equal(db.raw.prepare('SELECT count(*) n FROM ravenos_customer_wallet_copy_watches').get().n,0);
});

test('source imports reject unknown labels, unsafe references, future observations and unsupported chains',()=>{
 const input={chain:'solana',address:WALLET,source_kind:'kol',provider:'gmgn_public_list',source_reference:'https://gmgn.ai/discover',observed_at:NOW};
 for(const override of [{source_kind:'guaranteed_profit'},{source_reference:'https://gmgn.ai/?api-key=secret'},{observed_at:NOW+61},{chain:'unknown'},{address:'private key'}])assert.throws(()=>normalizeWalletDiscoverySource({...input,...override},NOW));
 assert.throws(()=>prepareWalletUniverseImport([packet('kol',Array.from({length:1001},()=>WALLET))],{now:NOW}),/list_invalid/);
});

test('release packaging carries the valuation and history controls into the actual Worker',()=>{
 const source=readFileSync('scripts/package-release.mjs','utf8');
 for(const key of ['RAVENOS_WALLET_PUBLIC_LISTS_ENABLED','RAVENOS_WALLET_DEX_MARKS_ENABLED','RAVENOS_WALLET_PRIORITY_WARMUP_ENABLED','RAVENOS_HELIUS_BACKFILL_PAGE_SIZE','RAVENOS_HELIUS_BACKFILL_CREDITS_PER_HOUR'])assert(source.includes(key+':'));
});
