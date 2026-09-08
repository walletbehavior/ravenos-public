import assert from 'node:assert/strict';
import test from 'node:test';
import { sqliteStore } from './customer_pro_rewards.test.mjs';
import { walletCardSummariesForPage } from '../lib/customer_trade/wallet_card_summary.mjs';
import { normalizeSourceWalletChainIdentity } from '../lib/customer_trade/source_wallet_chain_identity.mjs';
import { createD1CustomerWalletCopyStore } from '../lib/customer_wallet_copy.mjs';
import { normalizeWalletScreenerRequest } from '../lib/customer_trade/wallet_screener.mjs';
const NOW=1788800000, DAY=86400;
function wallet(db, chain='base') {
  const address=chain==='solana'?'11111111111111111111111111111111':`0x${'a'.repeat(40)}`;
  const identity=normalizeSourceWalletChainIdentity({chain,network:'mainnet',address});
  db.raw.prepare(`INSERT INTO ravenos_source_wallets (source_wallet_id,chain,network,chain_id,vm_family,address,observation_state,provider_scope,first_requested_at,last_observed_at,updated_at) VALUES (?,?,'mainnet',?,?,?,'requested','retained_public_trade_senders',?,?,?)`).run(identity.source_wallet_id,chain,String(identity.chain_id),identity.vm_family,address,NOW,NOW,NOW);
  return identity.source_wallet_id;
}
function event(db,id,n,at,{version=1,chain='base',classification='TRANSFER_IN',expires=NOW+DAY}={}) {
  const sol=chain==='solana',tx=sol?String(n).padStart(64,'1'):`0x${n.toString(16).padStart(64,'0')}`;
  db.raw.prepare(`INSERT INTO ravenos_source_wallet_events (event_id,schema_version,source_wallet_id,chain,network,transaction_reference,signature,slot,block_time,block_number,block_hash,chain_event_time,finality,classification,decode_version,evidence_hash,event_json,observed_at,retention_expires_at)
    VALUES (?,?,?,?,'mainnet',?,?,?,?,?,?,?,'confirmed',?,?,?,'{}',?,?)`).run(
    `swe_${n.toString().padStart(32,'0')}_${chain}_${version}`,sol?'ravenos.solana_wallet_event.v1':'ravenos.source_wallet_chain_event.v1',id,chain,tx,sol?tx:null,sol?n:null,sol?at:null,sol?null:n,sol?null:`0x${'b'.repeat(64)}`,sol?null:at,classification,version,'a'.repeat(40),NOW-DAY,expires);
}
function profile(db,id,{usdc=null,sol=null,closed=0,first=NOW-40*DAY}={}) {
  const pid=`swp_${id.slice(-40)}`;
  db.raw.prepare(`INSERT INTO ravenos_source_wallet_profiles (profile_snapshot_id,source_wallet_id,profile_version,normalized_event_count,profile_json,schema_version,generated_at,retention_expires_at,history_start_at) VALUES (?,?,1,0,'{}','ravenos.evm_wallet_basic_profile.v2',?,?,?)`).run(pid,id,NOW,NOW+DAY,first);
  db.raw.prepare(`INSERT INTO ravenos_source_wallet_current_profiles (source_wallet_id,profile_snapshot_id,profile_version,generated_at,trade_count,active_days,token_count,performance_state,closed_lots,profile_hash,updated_at,realized_pnl_usdc,realized_pnl_sol) VALUES (?,?,1,?,0,0,0,'insufficient_evidence',?,?,?, ?,?)`).run(id,pid,NOW,closed,'a'.repeat(40),NOW,usdc,sol);
}

test('card counts use unique retained transactions for rolling 1/7/30d across chains, including failures',async()=>{
  const db=sqliteStore();
  for (const chain of ['solana','robinhood','base','ethereum','bsc']) {
    const id=wallet(db,chain);
    event(db,id,1,NOW-10,{chain});event(db,id,1,NOW-10,{chain,version:2});
    event(db,id,2,NOW-60,{chain,classification:'FAILED_TRANSACTION'});
    event(db,id,3,NOW-2*DAY,{chain});event(db,id,4,NOW-20*DAY,{chain});event(db,id,5,NOW-40*DAY,{chain});
    // Future, expired and missing chain timestamps must not count as recent activity.
    event(db,id,6,NOW+60,{chain});event(db,id,7,NOW-30,{chain,expires:NOW-1});event(db,id,8,null,{chain});
    const summary=(await walletCardSummariesForPage(db,[id],NOW)).get(id);
    assert.deepEqual([summary.transactions.d1,summary.transactions.d7,summary.transactions.d30],[2,3,4]);
    assert.equal(summary.age.seconds_lower_bound,40*DAY);assert.equal(summary.age.creation_date_known,false);
    assert.equal(summary.transactions.window_complete,false);assert.equal(summary.pnl.usdc,null);
    assert.equal(summary.provider_request_performed,false);
  }
});

test('window boundaries exclude the old edge; no retained history stays unknown, not zero or registry age',async()=>{
  const db=sqliteStore(),id=wallet(db),blank=(await walletCardSummariesForPage(db,[id],NOW)).get(id);
  assert.equal(blank.transactions.d1,null);assert.equal(blank.age.seconds_lower_bound,null);
  event(db,id,1,NOW-DAY);event(db,id,2,NOW-7*DAY);event(db,id,3,NOW-30*DAY);
  const observed=(await walletCardSummariesForPage(db,[id],NOW)).get(id);
  assert.deepEqual([observed.transactions.d1,observed.transactions.d7,observed.transactions.d30],[0,1,2]);
});

test('cached P&L keeps zero, losses and settlement assets separate only with closed cost-basis evidence',async()=>{
  const db=sqliteStore(),one=wallet(db),two=wallet(db,'solana'),three=wallet(db,'robinhood');
  profile(db,one,{usdc:0,sol:-1.2345,closed:2});profile(db,two,{usdc:0,sol:0});profile(db,three,{usdc:-149.12,closed:1});
  const summaries=await walletCardSummariesForPage(db,[one,two,three],NOW);
  assert.equal(summaries.get(one).pnl.usdc,'0');assert.equal(summaries.get(one).pnl.sol,'-1.2345');
  assert.equal(summaries.get(two).pnl.usdc,null);assert.equal(summaries.get(three).pnl.usdc,'-149.12');
  assert.equal(summaries.get(one).pnl.bases_combined,false);assert.equal(summaries.get(one).age.seconds_lower_bound,40*DAY);
});

test('all cards load in two bounded indexed reads, and observed and analyzed pages share the same summary',async()=>{
  const db=sqliteStore(),id=wallet(db);event(db,id,1,NOW-10);profile(db,id,{usdc:32,closed:1});
  let reads=0;const proxy={prepare(sql){reads++;return db.prepare(sql);}};
  await walletCardSummariesForPage(proxy,[id,id],NOW);assert.equal(reads,2);
  await walletCardSummariesForPage(proxy,[],NOW);assert.equal(reads,2);
  await assert.rejects(walletCardSummariesForPage(proxy,Array.from({length:31},(_,i)=>`source_${i}`),NOW),/wallet_card_query_invalid/);
  const store=createD1CustomerWalletCopyStore(db),query=normalizeWalletScreenerRequest({view:'observed'},{now:NOW});
  const observed=await store.listSeenWallets(query),analyzed=await store.screenSourceWallets({...query,view:'analyzed'});
  assert.deepEqual(observed.rows[0].cached_summary,analyzed.rows[0].cached_summary);
  assert.equal(observed.rows[0].cached_summary.transactions.d1,1);
});
