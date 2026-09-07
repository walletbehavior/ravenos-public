import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync,readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import bs58 from 'bs58';
import {sqliteStore} from './customer_pro_rewards.test.mjs';
import {createD1CustomerWalletCopyStore} from '../lib/customer_wallet_copy.mjs';
import {marketUniverseIdentity,createWalletUniverseStore,runWalletUniverse} from '../lib/customer_trade/wallet_universe.mjs';
import {normalizeSourceWalletChainIdentity} from '../lib/customer_trade/source_wallet_chain_identity.mjs';
const NOW=1788800000;
const address=n=>bs58.encode(Buffer.alloc(32,n));
const market=(chain,n=1)=>({chain,pool_address:chain==='solana'?address(n):'0x'+n.toString(16).padStart(64,'0'),token_address:chain==='solana'?address(n+1):'0x'+(n+1).toString(16).padStart(40,'0'),quote_token_address:chain==='solana'?address(n+2):'0x'+(n+2).toString(16).padStart(40,'0')});
const env=db=>({RAVENOS_CUSTOMER_DB:db,RAVENOS_WALLET_UNIVERSE_ENABLED:'1',RAVENOS_WALLET_INTELLIGENCE_ENABLED:'1',RAVENOS_WALLET_SCREENER_ENABLED:'1'});

test('multichain migration preserves existing identities, profiles and foreign keys verbatim',()=>{
 const raw=new DatabaseSync(':memory:');
 for(const name of readdirSync('customer-migrations').filter(n=>/^\d+.*sql$/.test(n)&&n<'0038').sort())raw.exec(readFileSync('customer-migrations/'+name,'utf8'));
 for(const chain of ['solana','robinhood']) {
  const id=normalizeSourceWalletChainIdentity({chain,network:'mainnet',address:chain==='solana'?address(8):'0x'+'88'.repeat(20)});
  raw.prepare(`INSERT INTO ravenos_source_wallets (source_wallet_id,chain,network,chain_id,vm_family,address,observation_state,provider_scope,first_requested_at,last_observed_at,last_transaction_reference,last_signature,updated_at) VALUES (?,?,'mainnet',?,?,?,'current','fixture',100,110,?,?,110)`).run(id.source_wallet_id,chain,String(id.chain_id),id.vm_family,id.address,chain==='solana'?'5'.repeat(88):'0x'+'77'.repeat(32),chain==='solana'?'5'.repeat(88):null);
  const profileId='swp_'+(chain==='solana'?'a':'b').repeat(40);
  raw.prepare(`INSERT INTO ravenos_source_wallet_profiles (profile_snapshot_id,source_wallet_id,profile_version,normalized_event_count,profile_json,generated_at,retention_expires_at) VALUES (?,?,1,0,'{}',110,1000)`).run(profileId,id.source_wallet_id);
  raw.prepare(`INSERT INTO ravenos_source_wallet_current_profiles (source_wallet_id,profile_snapshot_id,profile_version,generated_at,trade_count,active_days,token_count,performance_state,closed_lots,profile_hash,updated_at) VALUES (?,?,1,110,0,0,0,'insufficient_evidence',0,?,110)`).run(id.source_wallet_id,profileId,'a'.repeat(40));
 }
 const before={};for(const table of ['ravenos_source_wallets','ravenos_source_wallet_profiles','ravenos_source_wallet_current_profiles'])before[table]=raw.prepare('SELECT * FROM '+table).all();
 raw.exec('BEGIN');raw.exec(readFileSync('customer-migrations/0038_source_wallet_multichain.sql','utf8'));raw.exec('COMMIT');
 for(const [table,rows]of Object.entries(before))assert.deepEqual(raw.prepare('SELECT * FROM '+table).all(),rows);
 assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(),[]);
 for(const chain of ['base','ethereum','bsc']){const id=normalizeSourceWalletChainIdentity({chain,network:'mainnet',address:'0x'+'99'.repeat(20)});raw.prepare(`INSERT INTO ravenos_source_wallets (source_wallet_id,chain,network,chain_id,vm_family,address,observation_state,provider_scope,first_requested_at,updated_at) VALUES (?,?,'mainnet',?,'evm',?,'requested','fixture',100,100)`).run(id.source_wallet_id,chain,String(id.chain_id),id.address);}
 assert.throws(()=>raw.exec("UPDATE ravenos_source_wallets SET chain_id='1' WHERE chain='base'"),/CHECK/);
 raw.close();
});

test('universe scheduler shares a durable budget, rotates chains and never starts history or copy',async()=>{
 const db=sqliteStore(),store=createWalletUniverseStore(db),walletStore=createD1CustomerWalletCopyStore(db);
 await store.rememberMarkets(['solana','robinhood','base','ethereum','bsc'].flatMap(chain=>[market(chain),market(chain,5)]),NOW);
 let calls=0;
 const loadTrades=async identity=>{calls++;return {ok:true,safe_public:true,schema_version:'ravenos.onchain_pool_trades.v1',identity,observed_at:new Date(NOW*1000).toISOString(),trades:[{trader_address:identity.chain==='solana'?address(50):'0x'+'aa'.repeat(20),observed_at:new Date(NOW*1000).toISOString()}]};};
 const options={marketStore:store,walletStore,loadTrades,now:NOW,clock:()=>NOW};
 const config={...env(db),RAVENOS_WALLET_UNIVERSE_MARKETS_PER_CYCLE:'5',RAVENOS_WALLET_UNIVERSE_REQUESTS_PER_HOUR:'10'};
 const a=await runWalletUniverse(config,options);assert.equal(a.succeeded,5);assert.equal(a.wallets_observed,5);
 assert.equal(db.raw.prepare('SELECT count(distinct chain) n FROM ravenos_source_wallets').get().n,5);
 const b=await runWalletUniverse(config,options);assert.equal(b.attempted,0);assert.equal(calls,5);
 for(const table of ['ravenos_source_wallet_backfill_jobs','ravenos_customer_wallet_copy_watches'])assert.equal(db.raw.prepare('SELECT count(*) n FROM '+table).get().n,0);
 assert.equal(db.raw.prepare('SELECT used_requests FROM ravenos_wallet_universe_budget').get().used_requests,10);
});

test('universe leases do not duplicate work and provider failure backs off',async()=>{
 const db=sqliteStore(),store=createWalletUniverseStore(db);
 await store.rememberMarkets([market('solana')],NOW);
 const a=await store.claim(NOW,1,10,'first');const b=await store.claim(NOW,1,10,'second');assert.equal(a.length,1);assert.equal(b.length,0);
 await store.finish(a[0],'wrong',0,true,NOW,1000);assert.equal(db.raw.prepare('SELECT lease_token FROM ravenos_wallet_universe_markets').get().lease_token,'first');
 await store.finish(a[0],'first',0,true,NOW,1000);assert.equal((await store.claim(NOW+1,1,10,'retry')).length,0);
 const row=db.raw.prepare('SELECT * FROM ravenos_wallet_universe_markets').get();assert.equal(row.failure_count,1);assert.equal(row.last_error,'market_projection_unavailable');assert(row.next_scan_at>NOW);
});

test('disabled universe does no work and invalid/mismatched market identities are refused',async()=>{
 assert.equal(marketUniverseIdentity({...market('base'),token_address:'http://host'}),null);
 const db=sqliteStore(),store=createWalletUniverseStore(db);await store.rememberMarkets([market('solana')],NOW);
 let calls=0;const opts={marketStore:store,walletStore:createD1CustomerWalletCopyStore(db),now:NOW,clock:()=>NOW,loadTrades:async()=>{calls++;return {ok:true,identity:market('base')};}};
 assert.equal((await runWalletUniverse({...env(db),RAVENOS_WALLET_UNIVERSE_ENABLED:'0'},opts)).state,'disabled');assert.equal(calls,0);
 const report=await runWalletUniverse(env(db),opts);assert.equal(report.failure_count,1);assert.equal(report.wallets_observed,0);
});

test('bulk import is deterministic, idempotent and validates public wallet provenance',async()=>{
 const {prepareWalletUniverseImport}=await import('../scripts/import-wallet-universe.mjs');
 const db=sqliteStore(),identity=marketUniverseIdentity(market('base'));
 const wallet={...normalizeSourceWalletChainIdentity({chain:'base',network:'mainnet',address:'0x'+'aa'.repeat(20)}),observed_at:NOW,provider_scope:'retained_public_trade_senders'};
 const packet={market_id:identity.market_id,identity,wallets:[wallet,wallet]};
 const plan=prepareWalletUniverseImport([packet],{now:NOW});assert.equal(plan.wallets.length,1);
 for(let repeat=0;repeat<2;repeat++)for(const sql of plan.statements)db.raw.exec(sql);
 assert.equal(db.raw.prepare('SELECT count(*) n FROM ravenos_source_wallets').get().n,1);
 for(const table of ['ravenos_source_wallet_profiles','ravenos_source_wallet_backfill_jobs','ravenos_customer_wallet_copy_watches'])assert.equal(db.raw.prepare('SELECT count(*) n FROM '+table).get().n,0);
 assert.throws(()=>prepareWalletUniverseImport([{...packet,wallets:[{...wallet,source_wallet_id:'forged'}]}],{now:NOW}),/invalid/);
 assert.throws(()=>prepareWalletUniverseImport([{...packet,wallets:[{...wallet,observed_at:NOW+120}]}],{now:NOW}),/invalid/);
 assert.equal(prepareWalletUniverseImport([{...packet,wallets:[{...wallet,observed_at:NOW-86401}]}],{now:NOW}).wallets.length,0);
});
