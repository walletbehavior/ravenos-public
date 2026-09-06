import test from "node:test";
import assert from "node:assert/strict";
import { sqliteStore } from "./customer_pro_rewards.test.mjs";
import { captureExecutionRewards, reconcileExecutionRewards, rewardBalance, reserveRewards, finishRewardOperation, reverseCollectedFee, setAutoApply, canonicalRewardAsset, CANONICAL_REWARD_ASSETS } from "../lib/customer_rewards.mjs";
import { rewardClaimPolicy, validateClaimEconomics, resolveClaimDestination, createRewardWalletChallenge, verifyRewardWalletChallenge, requestCashbackClaim } from "../lib/customer_reward_claims.mjs";
import { readProductAccess, expireProTrials } from "../lib/customer_pro.mjs";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { privateKeyToAccount } from "viem/accounts";
export const NOW=1788739200, USER="usr_"+"a".repeat(32), OTHER="usr_"+"b".repeat(32);
export function rewardFixture({ source="trial",chain="solana", amount="10000000",grossAmount=amount,state="provider_confirmed",feeStatus="observed",observed=amount, copy=false, finalized=true }={}) {
  const db=sqliteStore();
  for(const user of [USER,OTHER]) db.raw.prepare("INSERT INTO ravenos_users (user_id,state,primary_email,created_at,updated_at,last_authenticated_at) VALUES (?,'active',?,?,?,?)").run(user,`${user}@example.test`,NOW,NOW,NOW);
  if(source==="trial") db.raw.prepare("INSERT INTO ravenos_pro_trials VALUES (?,?,?,?,?,'ACTIVE','new_verified_account',?)").run(USER,"a".repeat(64),"b".repeat(64),NOW,NOW+30*86400,NOW);
  if(source==="paid") db.raw.prepare("INSERT INTO ravenos_pro_subscriptions (user_id,stripe_customer_id,status,period_start,period_end,paid_history,updated_at) VALUES (?,?,'active',?,?,1,?)").run(USER,"cus_test123",NOW,NOW+30*86400,NOW);
  const execution="lex_"+"a".repeat(32),tx=chain==="solana"?"5".repeat(88):"0x"+"a".repeat(64);
  const token=CANONICAL_REWARD_ASSETS[chain]?.token||"0x"+"12".repeat(20),recipient=chain==="solana"?"AZvRGXzbBAJK5BoWMGp18wJUtJLFgc9LadY274gs6U17":"0x"+"22".repeat(20),venue=chain==="solana"?"jupiter":"zero_x";
  db.raw.prepare(`INSERT INTO ravenos_customer_live_execution_intents
    (execution_id,schema_version,user_id,venue,chain_namespace,wallet_address,exact_market_id,side,order_type,raven_fee_bps,fee_token,fee_recipient,fee_collection_method,fee_collection_status,state,prepared_payload_hash,prepared_json,expires_at,created_at,updated_at,expected_raven_fee_amount_base_units,observed_raven_fee_amount_base_units,transaction_hash)
    VALUES (?,'fixture',?,?,?,?,?,'buy','market',100,?,?,?,?,?,?,'{}',?,?,?,?,?,?)`).run(execution,USER,venue,chain,recipient,`${chain}:token:fixture`,token,recipient,chain==="solana"?"jupiter_referral_program":"zero_x_integrator_fee",feeStatus,state,"a".repeat(64),NOW+600,NOW,NOW,amount,observed,chain==="solana"?null:tx);
  db.raw.prepare("UPDATE ravenos_customer_live_execution_intents SET prepared_json=? WHERE execution_id=?").run(JSON.stringify({fee:{gross_fee_amount_base_units:grossAmount},transaction:{message_hash:"a".repeat(64)}}),execution);
  const observation={state,signature:chain==="solana"?tx:undefined,transaction_hash:chain==="solana"?undefined:tx,evidence:{economic_result_verified:true,gross_raven_fee_verified:true,settled_message_hash:"a".repeat(64),confirmation_status:"finalized",finalized,raven_fee:{verified:true,fee_bps:100,fee_mint:token,referral_account:recipient,gross_fee_amount_base_units:grossAmount,observed_collector_credit_base_units:observed},fee_collection:{state:feeStatus,token,observed_amount_base_units:observed}}};
  db.raw.prepare("INSERT INTO ravenos_customer_live_execution_events VALUES (?,?,?,?,?)").run("lee_"+"a".repeat(32),execution,state,JSON.stringify(observation),NOW);

  if(copy) db.raw.prepare(`INSERT INTO ravenos_execution_reward_context (execution_id,user_id,chain,venue,trade_type,entitlement_source,eligible,fee_token,fee_recipient,authorized_fee_bps,expected_fee_micros,created_at) VALUES (?,?,?,?,'copy',?,1,?,?,100,?,?)`).run(execution,USER,chain,venue,source,token,recipient,amount,NOW);
  const env={RAVENOS_CUSTOMER_DB:db,RAVENOS_PRO_CASHBACK_ENABLED:"1",RAVENOS_PRO_CASHBACK_AUTO_APPLY_ENABLED:"1",RAVENOS_PRO_CASHBACK_SUBSCRIPTION_CREDIT_ENABLED:"1"};
  return {db,env,execution,tx,token,recipient,observation};
}
export async function earn(fixture=rewardFixture()) { await captureExecutionRewards(fixture.env,fixture.execution,USER,{now:NOW}); await reconcileExecutionRewards(fixture.db,fixture.execution,{now:NOW}); return fixture; }

for(const source of ["standard","trial","paid"]) test(`${source} cashback derives from actual reconciled fee and entitlement captured at execution`,async()=>{
  const f=await earn(rewardFixture({source}));
  assert.equal((await rewardBalance(f.db,USER)).available_micros,source==="standard"?"0":"3000000");
  assert.equal(f.db.raw.prepare("SELECT amount_usdc_micros FROM ravenos_reward_fee_receipts").get().amount_usdc_micros,10000000);
});
for(const state of ["provider_rejected","failed","reconciliation_pending","indeterminate"]) test(`${state} execution never produces available rewards`,async()=>{
  const f=await earn(rewardFixture({state,feeStatus:state==="provider_rejected"?"failed":"expected"}));
  assert.equal((await rewardBalance(f.db,USER)).available_micros,"0");
});
test("mismatched collector receipt cannot create cashback",async()=>{
  const f=await earn(rewardFixture({observed:"9999999",feeStatus:"indeterminate"})); assert.equal((await rewardBalance(f.db,USER)).available_micros,"0");
});
test("Jupiter Pro fee split retains 1 percent charged, full 30 percent cashback, and 50 percent for Raven",async()=>{
 const f=await earn(rewardFixture({amount:"8000000",grossAmount:"10000000"}));
 const receipt=f.db.raw.prepare("SELECT * FROM ravenos_reward_fee_receipts").get();
 assert.equal(receipt.customer_fee_usdc_micros,10000000);
 assert.equal(receipt.provider_share_usdc_micros,2000000);
 assert.equal(receipt.amount_usdc_micros,8000000);
 const balance=await rewardBalance(f.db,USER);
 assert.equal(balance.available_micros,"3000000");
 assert.equal(BigInt(receipt.amount_usdc_micros)-BigInt(balance.earned_micros),5000000n);
});
test("quoted Jupiter gross fee without settled-message proof remains pending",async()=>{
 const f=rewardFixture({amount:"8000000",grossAmount:"10000000"});
 f.observation.evidence.gross_raven_fee_verified=false;
 f.db.raw.prepare("INSERT INTO ravenos_customer_live_execution_events VALUES (?,?,?,?,?)").run("lee_"+"c".repeat(32),f.execution,"provider_confirmed",JSON.stringify(f.observation),NOW+1);
 await earn(f);
 assert.equal((await rewardBalance(f.db,USER)).available_micros,"0");
 assert.equal((await rewardBalance(f.db,USER)).pending_micros,"3000000");
});
test("pending reconciliation appends available credit and clears estimated pending on confirmation",async()=>{
  const f=await earn(rewardFixture({state:"reconciliation_pending",feeStatus:"expected"}));
  assert.equal((await rewardBalance(f.db,USER)).pending_micros,"3000000");
  f.db.raw.exec("UPDATE ravenos_customer_live_execution_intents SET state='provider_confirmed',fee_collection_status='observed'");
  f.observation.state="provider_confirmed";
  f.db.raw.prepare("INSERT INTO ravenos_customer_live_execution_events VALUES (?,?,?,?,?)").run("lee_"+"b".repeat(32),f.execution,"provider_confirmed",JSON.stringify(f.observation),NOW+1);
  await reconcileExecutionRewards(f.db,f.execution,{now:NOW+1});
  const b=await rewardBalance(f.db,USER); assert.equal(b.pending_micros,"0");assert.equal(b.available_micros,"3000000");
  assert.equal(f.db.raw.prepare("SELECT COUNT(*) n FROM ravenos_reward_ledger").get().n,2);
});
test("duplicate fee reconciliation is idempotent",async()=>{const f=await earn();await reconcileExecutionRewards(f.db,f.execution,{now:NOW+10});assert.equal((await rewardBalance(f.db,USER)).available_micros,"3000000");});
test("confirmed EVM fee waits for finalized block evidence",async()=>{const f=await earn(rewardFixture({chain:"base",finalized:false}));assert.equal((await rewardBalance(f.db,USER)).available_micros,"0");});
for(const chain of ["base","ethereum"]) test(`${chain} canonical USDC receipts earn cashback`,async()=>{const f=await earn(rewardFixture({chain}));assert.equal((await rewardBalance(f.db,USER)).available_micros,"3000000");});
test("bridged and non-USDC fee assets require evidenced valuation",async()=>{const f=await earn(rewardFixture({chain:"bsc"}));assert.equal((await rewardBalance(f.db,USER)).available_micros,"0");assert.equal(f.db.raw.prepare("SELECT amount_usdc_micros FROM ravenos_reward_fee_receipts").get().amount_usdc_micros,null);assert.equal(canonicalRewardAsset("bsc",f.token),null);});
test("copy trades use the same ledger and 30 percent of collected fees",async()=>{const f=await earn(rewardFixture({copy:true}));assert.equal(f.db.raw.prepare("SELECT source_type FROM ravenos_reward_ledger").get().source_type,"COPY_TRADING_CASHBACK");assert.equal((await rewardBalance(f.db,USER)).available_micros,"3000000");});
test("rounding floors fractional micro-USDC without floats",async()=>{const f=await earn(rewardFixture({amount:"11"}));assert.equal((await rewardBalance(f.db,USER)).available_micros,"3");});
test("earned ledger and fee evidence reject changes and deletion",async()=>{const f=await earn();for(const table of ["ravenos_reward_ledger","ravenos_reward_fee_receipts"])assert.throws(()=>f.db.raw.exec(`DELETE FROM ${table}`),/append_only/);assert.throws(()=>f.db.raw.exec("UPDATE ravenos_reward_ledger SET available_delta=1"),/append_only/);});
const reserve=(db,amount="1000000",key="test_claim_key_001",user=USER)=>reserveRewards(db,{user_id:user,kind:"claim",amount_micros:amount,idempotency_key:key,destination:{chain:"solana",wallet_address:"verified_fixture"},now:NOW});
test("pending rewards cannot be reserved or claimed",async()=>{const f=await earn(rewardFixture({state:"reconciliation_pending"}));await assert.rejects(reserve(f.db),/insufficient/);});
test("a claim cannot exceed available balance",async()=>{const f=await earn();await assert.rejects(reserve(f.db,"3000001"),/insufficient/);});
test("User A cannot claim user B's rewards",async()=>{const f=await earn();await assert.rejects(reserve(f.db,"1000000","test_claim_key_001",OTHER),/insufficient/);});
test("reservation reduces available but retains outstanding liability until settlement",async()=>{const f=await earn();const op=await reserve(f.db);const b=await rewardBalance(f.db,USER);assert.equal(b.available_micros,"2000000");assert.equal(b.reserved_micros,"1000000");assert.equal(b.liability_micros,"3000000");await finishRewardOperation(f.db,{operation_id:op.operation_id,user_id:USER,outcome:"settled",external_reference:"solana:fixture_001"});const end=await rewardBalance(f.db,USER);assert.equal(end.claimed_micros,"1000000");assert.equal(end.liability_micros,"2000000");});
test("two simultaneous reservations cannot overspend",async()=>{const f=await earn();const result=await Promise.allSettled([reserve(f.db,"2000000","test_claim_key_001"),reserve(f.db,"2000000","test_claim_key_002")]);assert.equal(result.filter(r=>r.status==="fulfilled").length,1);assert.equal((await rewardBalance(f.db,USER)).available_micros,"1000000");});
test("claim retry reserves once and changed parameters are rejected",async()=>{const f=await earn();await reserve(f.db);await reserve(f.db);assert.equal((await rewardBalance(f.db,USER)).reserved_micros,"1000000");await assert.rejects(reserve(f.db,"2000000"),/idempotency/);});
test("unknown payout result stays reserved; explicit failure restores availability",async()=>{const f=await earn();const op=await reserve(f.db);await finishRewardOperation(f.db,{operation_id:op.operation_id,user_id:USER,outcome:"indeterminate"});assert.equal((await rewardBalance(f.db,USER)).reserved_micros,"1000000");await finishRewardOperation(f.db,{operation_id:op.operation_id,user_id:USER,outcome:"failed"});assert.equal((await rewardBalance(f.db,USER)).available_micros,"3000000");});
test("settlement is owner-bound and cannot pay twice",async()=>{const f=await earn();const op=await reserve(f.db);await assert.rejects(finishRewardOperation(f.db,{operation_id:op.operation_id,user_id:OTHER,outcome:"failed"}),/not_found/);for(let i=0;i<2;i++)await finishRewardOperation(f.db,{operation_id:op.operation_id,user_id:USER,outcome:"settled",external_reference:"chain:proof_123"});assert.equal((await rewardBalance(f.db,USER)).claimed_micros,"1000000");});
test("trial expiry preserves earned rewards",async()=>{const f=await earn();await expireProTrials(f.db,NOW+31*86400);assert.equal((await readProductAccess(f.db,USER,{now:NOW+31*86400})).tier,"standard");assert.equal((await rewardBalance(f.db,USER)).available_micros,"3000000");await reserve(f.db);});
test("Pro cancellation preserves earned rewards",async()=>{const f=await earn(rewardFixture({source:"paid"}));f.db.raw.exec("UPDATE ravenos_pro_subscriptions SET status='canceled'");assert.equal((await readProductAccess(f.db,USER,{now:NOW})).tier,"standard");assert.equal((await rewardBalance(f.db,USER)).available_micros,"3000000");});
test("fee reversal appends a reversal and never deletes earned history",async()=>{const f=await earn();const fee=f.db.raw.prepare("SELECT fee_event_id FROM ravenos_reward_fee_receipts").get().fee_event_id;await reverseCollectedFee(f.db,{fee_event_id:fee,evidence:{verified_fee_refund:true,reference:"refund_proof"}});assert.equal((await rewardBalance(f.db,USER)).available_micros,"0");assert.equal(f.db.raw.prepare("SELECT COUNT(*) n FROM ravenos_reward_ledger").get().n,2);});
test("spent reward reversal records explicit adjustment without a negative available balance",async()=>{const f=await earn();const op=await reserve(f.db,"3000000");await finishRewardOperation(f.db,{operation_id:op.operation_id,user_id:USER,outcome:"settled",external_reference:"chain:proof_123"});const fee=f.db.raw.prepare("SELECT fee_event_id FROM ravenos_reward_fee_receipts").get().fee_event_id;const b=await reverseCollectedFee(f.db,{fee_event_id:fee,evidence:{verified_fee_refund:true,reference:"refund_proof"}});assert.equal(b.available_micros,"0");assert.equal(b.adjustment_micros,"3000000");});
test("ordinary market losses cannot reverse rewards",async()=>{const f=await earn();await assert.rejects(reverseCollectedFee(f.db,{fee_event_id:"fee",evidence:{market_loss:true}}),/fee_refund_evidence_required/);});
test("auto apply defaults off, supports opt-in and opt-out",async()=>{const f=await earn();assert.equal(f.db.raw.prepare("SELECT * FROM ravenos_reward_preferences").get(),undefined);await setAutoApply(f.env,USER,true);assert.equal(f.db.raw.prepare("SELECT auto_apply FROM ravenos_reward_preferences").get().auto_apply,1);await setAutoApply(f.env,USER,false);assert.equal(f.db.raw.prepare("SELECT auto_apply FROM ravenos_reward_preferences").get().auto_apply,0);});
