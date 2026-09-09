import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sqliteStore } from './customer_pro_rewards.test.mjs';
import { createD1CustomerWalletCopyStore } from '../lib/customer_wallet_copy.mjs';
import { createD1SourceWalletBackfillStore, runSourceWalletBackfillBatch } from '../lib/customer_trade/source_wallet_backfill.mjs';
import { normalizeSourceWalletChainIdentity } from '../lib/customer_trade/source_wallet_chain_identity.mjs';
import { createWalletReferenceRetryStore } from '../lib/customer_trade/wallet_reference_retries.mjs';
import { walletIngestionPolicy, reserveEvmHistoryRequests, settleEvmHistoryRequests } from '../lib/customer_trade/wallet_ingestion_policy.mjs';

const NOW=Date.parse('2026-09-08T12:00:00Z');
async function setup(t) {
  const db=sqliteStore();t.after(()=>db.raw.close());
  const wallets=createD1CustomerWalletCopyStore(db);
  const backfill=createD1SourceWalletBackfillStore(db,{record_events:wallets.recordEvents});
  async function add(n,{chain='base',profile=false,demand='indexed_research'}={}) {
    const address='0x'+n.toString(16).padStart(40,'0');
    const id=normalizeSourceWalletChainIdentity({chain,network:'mainnet',address});
    await wallets.upsertSourceWallet({...id,now:NOW/1000,state:'requested',provider_scope:'history'});
    const job=await backfill.enqueueJob({chain,address,demand_class:demand,now:NOW});
    if(profile) {
      const snapshot='swp_'+n.toString().padStart(40,'0'),at=NOW/1000;
      db.raw.prepare(`INSERT INTO ravenos_source_wallet_profiles
        (profile_snapshot_id,source_wallet_id,profile_version,normalized_event_count,profile_json,generated_at,retention_expires_at)
        VALUES (?,?,1,8,'{}',?,?)`).run(snapshot,id.source_wallet_id,at,at+86400);
      db.raw.prepare(`INSERT INTO ravenos_source_wallet_current_profiles
        (source_wallet_id,profile_snapshot_id,profile_version,generated_at,trade_count,active_days,token_count,performance_state,closed_lots,profile_hash,updated_at)
        VALUES (?,?,1,?,0,0,0,'insufficient_evidence',0,?,?)`).run(id.source_wallet_id,snapshot,at,'a'.repeat(40),at);
      db.raw.prepare('UPDATE ravenos_source_wallet_backfill_jobs SET signatures_seen=8,page_count=1 WHERE job_id=?').run(job.job_id);
    }
    return job;
  }
  return {db,backfill,add};
}

test('new profiles, background depth and customer demand all receive capacity',async t=>{
  const {db,backfill,add}=await setup(t);
  const fresh=[await add(1,{chain:'base'}),await add(2,{chain:'ethereum'}),await add(3,{chain:'bsc'})];
  const deep=await add(4,{chain:'robinhood',profile:true});
  const urgent=await add(5,{profile:true,demand:'customer_watch'});
  const batch=await backfill.leaseJobs({worker_id:'fair_ingestion',now:NOW+1000,limit:4,lease_seconds:180,breadth_slots:2,depth_slots:1});
  assert.equal(batch.length,4);
  assert.equal(batch.filter(job=>fresh.some(row=>row.job_id===job.job_id)).length,2);
  assert(batch.some(job=>job.job_id===deep.job_id));assert(batch.some(job=>job.job_id===urgent.job_id));
  const again=await backfill.leaseJobs({worker_id:'concurrent_ingestion',now:NOW+1000,limit:4,lease_seconds:180,breadth_slots:2,depth_slots:1});
  assert(!again.some(job=>batch.some(previous=>previous.job_id===job.job_id)));
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM ravenos_source_wallet_backfill_jobs WHERE state='leased'").get().n,5);
});

test('first profile publication cannot starve behind repeated saved-wallet refreshes',async t=>{
  const {db,backfill,add}=await setup(t);
  const first=[await add(1),await add(2,{chain:'ethereum'})];
  for(let i=3;i<=8;i++)await add(i,{profile:true,demand:'saved_research'});
  db.raw.exec('UPDATE ravenos_source_wallet_backfill_jobs SET signatures_seen=8');
  const candidates=await backfill.listProfileRefreshCandidates(4,{now:NOW+1000,first_profile_slots:2});
  assert.equal(candidates.filter(job=>first.some(row=>row.job_id===job.job_id)).length,2);
  assert.equal(candidates.filter(job=>job.demand_class==='saved_research').length,2);
});

test('unused reserved lanes lend their capacity and retry cooldowns remain intact',async t=>{
  const {backfill,add}=await setup(t);
  for(let i=1;i<=5;i++)await add(i,{profile:true,demand:'customer_watch'});
  const options={worker_id:'lending_ingestion',now:NOW+1000,limit:4,lease_seconds:180,breadth_slots:2,depth_slots:1};
  const leased=await backfill.leaseJobs(options);assert.equal(leased.length,4);
  for(const job of leased)await backfill.deferJob({job,error_code:'evm_history_budget_exhausted',next_attempt_at:NOW+3600000,now:NOW+1000});
  const next=await backfill.leaseJobs({...options,now:NOW+2000});assert.equal(next.length,1);
});

test('EVM provider budget is shared, crash conservative, and settlement is idempotent',async t=>{
  const {db}=await setup(t);
  const results=await Promise.allSettled(Array.from({length:4},()=>reserveEvmHistoryRequests(db,{limit:100,budget:200,now:NOW})));
  assert.equal(results.filter(row=>row.status==='fulfilled').length,2);
  const reservation=results.find(row=>row.status==='fulfilled').value;
  await settleEvmHistoryRequests(db,reservation,20);
  await settleEvmHistoryRequests(db,reservation,0);
  assert.equal(db.raw.prepare('SELECT SUM(units) n FROM ravenos_wallet_ingestion_reservations').get().n,120);
  await assert.rejects(reserveEvmHistoryRequests(db,{limit:100,budget:200,now:NOW}),/budget_exhausted/);
  assert(await reserveEvmHistoryRequests(db,{limit:100,budget:200,now:NOW+3600000}));
  assert.equal(walletIngestionPolicy({}).evm_requests_per_hour,6000);
  assert.equal(walletIngestionPolicy({RAVENOS_EVM_HISTORY_REQUESTS_PER_HOUR:'999999'}).evm_requests_per_hour,24000);
});

test('provider budget exhaustion defers EVM jobs without burning their failure attempts',async t=>{
  const {db,backfill,add}=await setup(t);await add(1);
  await reserveEvmHistoryRequests(db,{limit:100,budget:100,now:NOW});
  const result=await runSourceWalletBackfillBatch(backfill,{
    fetchSignatures:async()=>[],hydrateTransaction:async()=>null,
    fetchEvmPage:()=>reserveEvmHistoryRequests(db,{limit:100,budget:100,now:NOW}),
  },{now:NOW,maximum_jobs:1});
  assert.equal(result.totals.jobs_budget_deferred,1);
  const row=db.raw.prepare('SELECT state,attempt_count,last_error_code FROM ravenos_source_wallet_backfill_jobs').get();
  assert.deepEqual({...row},{state:'retry_wait',attempt_count:0,last_error_code:'evm_history_budget_exhausted'});
});

test('individual receipt retries are bounded, replay safe and stay visibly unresolved',async t=>{
  const {db,add}=await setup(t),job=await add(1),store=createWalletReferenceRetryStore(db);
  const reference={hash:'0x'+'1'.repeat(64),blockNum:'0x1',category:'erc20'};
  const outcome={reference,error_code:'evm_wallet_backfill_receipt_incomplete'};
  const first=await store.recordReferenceOutcomes(job,[outcome],'attempt1',NOW);
  assert.equal(first.unresolved,1);assert.equal(first.pending,1);
  await store.recordReferenceOutcomes(job,[outcome],'attempt1',NOW);
  assert.equal(db.raw.prepare('SELECT attempts FROM ravenos_wallet_reference_retries').get().attempts,1);
  assert.equal((await store.dueReferences(job.job_id,NOW)).length,0);
  for(let i=2;i<=5;i++)await store.recordReferenceOutcomes(job,[outcome],'attempt'+i,NOW+i*3600000);
  assert.deepEqual(await store.referenceRetrySummary(job.job_id),{unresolved:1,pending:0,next_attempt_at:null});
  assert.equal((await store.dueReferences(job.job_id,NOW+86400000)).length,0);
  await store.recordReferenceOutcomes(job,[{reference,error_code:null}],'verified_later',NOW+86400000);
  assert.equal((await store.referenceRetrySummary(job.job_id)).unresolved,0);
});

test('dedicated ingestion cadence does not run billing, execution or discovery cron work',async()=>{
  const {default:worker}=await import('../worker.mjs');
  const env=new Proxy({RAVENOS_WALLET_INGESTION_ENABLED:'0'},{get(target,key){if(key!=='RAVENOS_WALLET_INGESTION_ENABLED')throw Error('unrelated_service_access');return target[key];}});
  await worker.scheduled({cron:'* * * * *'},env,{});
  const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
  assert.deepEqual(config.triggers.crons,['*/5 * * * *','* * * * *','*/2 * * * *']);
  const packaging=readFileSync('scripts/package-release.mjs','utf8');
  assert(packaging.includes('RAVENOS_WALLET_INGESTION_ENABLED:'));assert(packaging.includes('RAVENOS_EVM_HISTORY_REQUESTS_PER_HOUR:'));
});
