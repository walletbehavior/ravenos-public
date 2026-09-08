import assert from 'node:assert/strict';
import test from 'node:test';
import bs58 from 'bs58';
import {sqliteStore} from './customer_pro_rewards.test.mjs';
import {createD1CustomerWalletCopyStore} from '../lib/customer_wallet_copy.mjs';
import {observedMarketWallets,retainMarketWallets} from '../lib/customer_trade/market_wallet_index.mjs';
import {normalizeWalletScreenerRequest} from '../lib/customer_trade/wallet_screener.mjs';
import {normalizeSourceWalletChainIdentity} from '../lib/customer_trade/source_wallet_chain_identity.mjs';
import {observedWalletMarketEvidence,retainWalletMarketEvidence,pruneWalletMarketEvidence,normalizeObservationQuery} from '../lib/customer_trade/wallet_market_evidence.mjs';
import {createWalletUniverseStore,runWalletUniverse} from '../lib/customer_trade/wallet_universe.mjs';
const NOW=1788800000,iso=n=>new Date(n*1000).toISOString();
const address=(chain,n)=>chain==='solana'?bs58.encode(Buffer.alloc(32,n)):'0x'+n.toString(16).padStart(40,'0');
function projection(chain='base',pool=1,rows=[{wallet:8,tx:1},{wallet:8,tx:2},{wallet:8,tx:3,side:'sell'}]) {
 return {ok:true,safe_public:true,schema_version:'ravenos.onchain_pool_trades.v1',observed_at:iso(NOW),
  identity:{chain,pool_address:address(chain,pool),token_address:address(chain,2),quote_token_address:address(chain,3)},
  trades:rows.map(row=>({trader_address:address(chain,row.wallet),transaction_hash:chain==='solana'?bs58.encode(Buffer.alloc(64,row.tx)):'0x'+row.tx.toString(16).padStart(64,'0'),
    observed_at:iso(row.at??NOW-10),side:row.side||'buy',volume_usd:row.amount??'123.1234569'}))};
}
const evidence=p=>observedWalletMarketEvidence(p,{now:NOW,admitted_wallets:observedMarketWallets(p,{now:NOW,maximum_rows:120})});
const query=(observed={},extra={})=>normalizeWalletScreenerRequest({view:'observed',observed,...extra},{now:NOW});
const enabled={market_evidence_enabled:true};
async function add(db,p) { const store=createD1CustomerWalletCopyStore(db);for(const wallet of observedMarketWallets(p,{now:NOW}))await store.recordSeenMarketWallet(wallet,NOW);const rows=evidence(p);await store.recordSeenMarketEvidence(rows);return rows; }

test('real public tape produces bounded precise facts on every supported chain without performance claims',()=>{
 for(const chain of ['solana','robinhood','base','ethereum','bsc']) {
  const [row]=evidence(projection(chain));const sample=JSON.parse(row.sample_json);
  assert.equal(row.unique_transactions,3);assert.equal(row.buy_transactions,2);assert.equal(row.sell_transactions,1);
  assert.equal(sample.largest_sampled_swap_usd_micros,'123123456');assert.equal(sample.market.chain,chain);
  assert.equal(sample.scope,'retained_exact_pool_sample');assert.equal(sample.performance_claimed,false);assert.equal(sample.copyability_claimed,false);assert.equal(sample.history_complete,false);
  assert.equal(sample.volume_usd,undefined);assert.equal(sample.realized_pnl,undefined);
 }
});

test('duplicate transaction legs and case variants do not inflate EVM activity; Solana signatures remain case sensitive',()=>{
 const p=projection('base',1,[{wallet:8,tx:10},{wallet:8,tx:10},{wallet:8,tx:10,side:'sell'}]);
 p.trades[1].transaction_hash='0x'+p.trades[0].transaction_hash.slice(2).toUpperCase();
 const [row]=evidence(p);assert.equal(row.unique_transactions,1);assert.equal(row.buy_transactions,1);assert.equal(row.sell_transactions,1);
 const sol=projection('solana',1,[{wallet:8,tx:1},{wallet:8,tx:2}]);assert.equal(evidence(sol)[0].unique_transactions,2);
});

test('projection admission rejects missing identity, stale/future observations, unverified actors and invalid hashes',()=>{
 for (const mutate of [p=>{p.safe_public=false;},p=>{p.ok=false;},p=>{p.identity.token_address='bad';},p=>{p.identity.quote_token_address=p.identity.token_address;},p=>{p.observed_at=iso(NOW-86401);},p=>{p.observed_at=iso(NOW+61);},p=>{p.trades.forEach(t=>t.observed_at=iso(NOW-86401));},p=>{p.trades.forEach(t=>t.transaction_hash='unknown');},p=>{p.trades.forEach(t=>t.trader_address=p.identity.pool_address);},p=>{p.trades.forEach(t=>t.side='transfer');}]) {
  const p=projection();mutate(p);assert.deepEqual(evidence(p),[]);
 }
 assert.deepEqual(observedWalletMarketEvidence(projection(),{now:NOW,admitted_wallets:[]}),[]);
 const p=projection(),wrong=normalizeSourceWalletChainIdentity({chain:'ethereum',network:'mainnet',address:address('base',8)});
 assert.deepEqual(observedWalletMarketEvidence(p,{now:NOW,admitted_wallets:[wrong]}),[]);
});

test('unknown or unrepresentable USD marks stay unknown and do not become zero',()=>{
 for (const amount of [null,'-10','NaN','1e+30',{},0]) {
  const p=projection();p.trades.forEach(t=>t.volume_usd=amount);
  assert.equal(JSON.parse(evidence(p)[0].sample_json).largest_sampled_swap_usd_micros,null);
 }
});

test('repeated polls write once, newer snapshots replace counts, and older samples cannot overwrite newer evidence',async()=>{
 const db=sqliteStore(),rows=await add(db,projection());assert.equal(await retainWalletMarketEvidence(db,rows),0);
 const newer=projection('base',1,[{wallet:8,tx:4}]);newer.observed_at=iso(NOW+20);newer.trades[0].observed_at=iso(NOW+10);
 const next=evidence(newer);assert.equal(await retainWalletMarketEvidence(db,next),1);assert.equal(await retainWalletMarketEvidence(db,rows),0);
 const row=db.raw.prepare('SELECT * FROM ravenos_source_wallet_market_evidence').get();assert.equal(row.unique_transactions,1);
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM ravenos_source_wallet_events').get().n,0);
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM ravenos_customer_wallet_copy_watches').get().n,0);
 assert.equal(db.raw.prepare('PRAGMA foreign_key_check').all().length,0);
});

test('cached observations retain market evidence with zero provider requests and throttle replayed foreground samples',async()=>{
 const db=sqliteStore(),store=createD1CustomerWalletCopyStore(db),p=projection();let calls=0;
 const proxy={...store,async recordSeenMarketEvidence(rows){calls++;return store.recordSeenMarketEvidence(rows);}};
 const env={RAVENOS_CUSTOMER_DB:db,RAVENOS_WALLET_INTELLIGENCE_ENABLED:'1',RAVENOS_WALLET_SCREENER_ENABLED:'1',RAVENOS_WALLET_MARKET_EVIDENCE_ENABLED:'1'};
 const first=await retainMarketWallets(env,p,proxy,{now:NOW}),again=await retainMarketWallets(env,p,proxy,{now:NOW+1});
 assert.equal(first.market_evidence,'retained');assert.equal(again.market_evidence,'cached');assert.equal(calls,1);assert.equal(first.provider_requests,0);assert.equal(first.history_queued,false);
 const disabled=await retainMarketWallets({...env,RAVENOS_WALLET_MARKET_EVIDENCE_ENABLED:'0'},p,proxy,{now:NOW+2});assert.equal(disabled.market_evidence,'disabled');assert.equal(calls,1);
});

test('evidence storage failure does not break public market responses or prevent later retry',async()=>{
 const db=sqliteStore(),store=createD1CustomerWalletCopyStore(db);let calls=0;
 const env={RAVENOS_CUSTOMER_DB:db,RAVENOS_WALLET_INTELLIGENCE_ENABLED:'1',RAVENOS_WALLET_SCREENER_ENABLED:'1',RAVENOS_WALLET_MARKET_EVIDENCE_ENABLED:'1'};
 const proxy={...store,async recordSeenMarketEvidence(rows){if(++calls===1)throw Error('offline');return store.recordSeenMarketEvidence(rows);}};
 assert.equal((await retainMarketWallets(env,projection(),proxy,{now:NOW})).market_evidence,'unavailable');
 assert.equal((await retainMarketWallets(env,projection(),proxy,{now:NOW+1})).market_evidence,'retained');
});

test('observed filtering happens before pagination across chains, without counting repeated tape as wallet volume',async()=>{
 const db=sqliteStore(),store=createD1CustomerWalletCopyStore(db);
 await add(db,projection());await add(db,projection('base',4,[{wallet:8,tx:1}]));
 await add(db,projection('base',5,[{wallet:9,tx:7}]));await add(db,projection('solana'));
 const repeats=await store.listSeenWallets(query({signal:'repeat_activity'},{page_size:1}),enabled);
 assert.equal(repeats.total,2);assert.equal(repeats.rows.length,1);
 const second=await store.listSeenWallets(query({signal:'repeat_activity'},{page_size:1,page:2}),enabled);assert.notEqual(second.rows[0].source_wallet_id,repeats.rows[0].source_wallet_id);
 const pools=await store.listSeenWallets(query({signal:'multiple_markets'}),enabled);assert.equal(pools.total,1);
 const facts=pools.rows[0].market_evidence;assert.equal(facts.observed_market_count,2);assert.equal(facts.busiest_pool_transactions,3);assert.equal(facts.samples.length,2);assert.equal(facts.total_volume_usd,undefined);
 assert.equal((await store.listSeenWallets(query({signal:'two_sided'},{chain:'solana'}),enabled)).total,1);
 assert.equal((await store.listSeenWallets(query({sort:'markets'}),enabled)).rows[0].source_wallet.address,address('base',8));
 assert.equal((await store.listSeenWallets(query({sort:'activity'}),enabled)).rows.at(-1).source_wallet.address,address('base',9));
 assert.equal(repeats.provider_request_performed,false);
});

test('current samples are bounded to three per card and expire without removing the observed wallet',async()=>{
 const db=sqliteStore(),store=createD1CustomerWalletCopyStore(db);
 for(let pool=10;pool<15;pool++)await add(db,projection('base',pool));
 const result=await store.listSeenWallets(query(),enabled);assert.equal(result.rows[0].market_evidence.observed_market_count,5);assert.equal(result.rows[0].market_evidence.samples.length,3);
 const expired=await store.listSeenWallets(normalizeWalletScreenerRequest({view:'observed'},{now:NOW+86401}),enabled);
 assert.equal(expired.total,1);assert.equal(expired.rows[0].market_evidence.state,'not_observed');
 assert.equal((await store.listSeenWallets(normalizeWalletScreenerRequest({observed:{active_within_hours:24}},{now:NOW+86401}),enabled)).total,0);
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM ravenos_source_wallet_market_evidence').get().n,5);
 await pruneWalletMarketEvidence(db,NOW+8*86400);assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM ravenos_source_wallet_market_evidence').get().n,0);
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM ravenos_source_wallets').get().n,1);
});

test('flag-off database remains compatible without the new table; advanced filters fail closed',async()=>{
 const db=sqliteStore();await add(db,projection());db.raw.exec('DROP TABLE ravenos_source_wallet_market_evidence');
 const store=createD1CustomerWalletCopyStore(db),result=await store.listSeenWallets(query());assert.equal(result.total,1);assert.equal(result.rows[0].market_evidence,null);
 assert.equal((await store.listSeenWallets(query({history:'not_analyzed'}))).total,1);assert.equal((await store.listSeenWallets(query({history:'cached'}))).total,0);
 await assert.rejects(store.listSeenWallets(query({signal:'two_sided'})),/wallet_market_evidence_disabled/);
});

test('observation query accepts only bounded known controls and survives response renormalization',()=>{
 for(const input of [{signal:'profitable'},{history:'all'},{sort:'pnl'},{active_within_hours:48},{active_within_hours:'24'},{private_key:'secret'}])assert.throws(()=>normalizeObservationQuery(input));
 const q=query({signal:'two_sided',sort:'activity',history:'cached',active_within_hours:24});assert.equal(q.view,'observed');assert.equal(q.observed.signal,'two_sided');
 assert.throws(()=>normalizeWalletScreenerRequest({view:'unknown'},{now:NOW}));
});

test('budgeted universe scan reuses its single projection for context and never loads wallet history',async()=>{
 const db=sqliteStore(),marketStore=createWalletUniverseStore(db),walletStore=createD1CustomerWalletCopyStore(db),p=projection();
 await marketStore.rememberMarkets([p.identity],NOW);let calls=0;
 const result=await runWalletUniverse({RAVENOS_CUSTOMER_DB:db,RAVENOS_WALLET_UNIVERSE_ENABLED:'1',RAVENOS_WALLET_INTELLIGENCE_ENABLED:'1',RAVENOS_WALLET_SCREENER_ENABLED:'1',RAVENOS_WALLET_MARKET_EVIDENCE_ENABLED:'1'},
  {marketStore,walletStore,now:NOW,clock:()=>NOW,loadTrades:async()=>{calls++;return p;}});
 assert.equal(calls,1);assert.equal(result.succeeded,1);assert.equal(result.wallet_history_requests,0);
 assert.equal(db.raw.prepare('SELECT unique_transactions n FROM ravenos_source_wallet_market_evidence').get().n,3);
});

test('a partially aged-out sample cannot count old transactions as current 24-hour activity',async()=>{
 const db=sqliteStore(),store=createD1CustomerWalletCopyStore(db),p=projection('base',1,[{wallet:8,tx:1,at:NOW-86300},{wallet:8,tx:2,at:NOW-10}]);
 await add(db,p);
 const result=await store.listSeenWallets(normalizeWalletScreenerRequest({view:'observed'},{now:NOW+101}),enabled);
 assert.equal(result.total,1);assert.equal(result.rows[0].market_evidence.state,'not_observed');
});

test('existing cached EVM history is filterable without promoting it to reconstructed performance',async()=>{
 const db=sqliteStore(),store=createD1CustomerWalletCopyStore(db),[row]=await add(db,projection()),profileId='swp_'+'a'.repeat(40);
 db.raw.prepare(`INSERT INTO ravenos_source_wallet_profiles (profile_snapshot_id,source_wallet_id,profile_version,normalized_event_count,profile_json,schema_version,generated_at,retention_expires_at) VALUES (?,?,1,0,'{}','ravenos.evm_wallet_basic_profile.v2',?,?)`).run(profileId,row.source_wallet_id,NOW,NOW+86400);
 db.raw.prepare(`INSERT INTO ravenos_source_wallet_current_profiles (source_wallet_id,profile_snapshot_id,profile_version,generated_at,trade_count,active_days,token_count,performance_state,closed_lots,profile_hash,updated_at) VALUES (?,?,1,?,0,0,0,'insufficient_evidence',0,?,?)`).run(row.source_wallet_id,profileId,NOW,'a'.repeat(40),NOW);
 const cached=await store.listSeenWallets(query({history:'cached'}),enabled);assert.equal(cached.total,1);assert.equal(cached.rows[0].history_available,true);assert.equal(cached.rows[0].performance_claimed,false);
 assert.equal((await store.listSeenWallets(query({history:'not_analyzed'}),enabled)).total,0);
});

test('ordinary observed pages share their filtered count scan; an out-of-range page keeps the real total',async()=>{
 const db=sqliteStore();await add(db,projection());let reads=0;const statements=[];
 const proxy={prepare(sql){reads++;statements.push(sql);return db.prepare(sql);}};const store=createD1CustomerWalletCopyStore(proxy);
 assert.equal((await store.listSeenWallets(query(),enabled)).total,1);assert.equal(reads,5);
 assert.equal(statements.filter(sql=>sql.includes('WITH identities')).length,1);
 assert.equal(statements.filter(sql=>sql.includes('ROW_NUMBER()')&&sql.includes('ravenos_wallet_discovery_sources')).length,1);
 reads=0;const past=await store.listSeenWallets(query({},{page:2}),enabled);assert.equal(past.rows.length,0);assert.equal(past.total,1);assert.equal(reads,2);
});

test('activity filters reach the end of a 6,000-wallet universe with exact counts and no history reads',async()=>{
 const db=sqliteStore();
 const insert=db.raw.prepare(`INSERT INTO ravenos_source_wallets (source_wallet_id,chain,network,chain_id,vm_family,address,observation_state,provider_scope,first_requested_at,last_observed_at,updated_at) VALUES (?,'base','mainnet','8453','evm',?,'requested','retained_public_trade_senders',?,?,?)`);
 const put=db.raw.prepare(`INSERT INTO ravenos_source_wallet_market_evidence VALUES (?,?,'base',?,?,?,?,?,?,?)`);
 const sample=JSON.parse(evidence(projection())[0].sample_json);
 for(let i=1;i<=6000;i++) {
  const id=normalizeSourceWalletChainIdentity({chain:'base',network:'mainnet',address:address('base',i)});
  insert.run(id.source_wallet_id,id.address,NOW,NOW-10,NOW);
  const count=i%10===0?3:1, data={...sample,unique_transactions:count,buy_transactions:count,sell_transactions:0};
  put.run(id.source_wallet_id,'wme_fixture_pool',NOW,NOW-10,NOW-10,count,count,0,JSON.stringify(data));
 }
 const result=await createD1CustomerWalletCopyStore(db).listSeenWallets(query({signal:'repeat_activity'},{page:50,page_size:12}),enabled);
 assert.equal(result.total,600);assert.equal(result.rows.length,12);
 for(const row of result.rows)assert.equal(row.market_evidence.busiest_pool_transactions,3);
 assert.equal(result.provider_request_performed,false);
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM ravenos_source_wallet_backfill_jobs').get().n,0);
});

test('opposite token orientation of the same exact pool cannot manufacture multi-pool activity',async()=>{
 const db=sqliteStore(),store=createD1CustomerWalletCopyStore(db),p=projection();await add(db,p);
 const reverse=structuredClone(p);[reverse.identity.token_address,reverse.identity.quote_token_address]=[p.identity.quote_token_address,p.identity.token_address];
 await add(db,reverse);
 const result=await store.listSeenWallets(query(),enabled);assert.equal(result.rows[0].market_evidence.observed_market_count,1);
 assert.equal((await store.listSeenWallets(query({signal:'multiple_markets'}),enabled)).total,0);
});
