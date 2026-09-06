import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { earn,rewardFixture,NOW,USER } from "./customer_rewards_ledger.test.mjs";
import { rewardBalance,setAutoApply } from "../lib/customer_rewards.mjs";
import { continueWithPro,applyRewardsToPro,reconcileProInvoice,processAccountStripeEvent,verifyProStripeSignature } from "../lib/customer_pro_billing.mjs";
import { readProductAccess } from "../lib/customer_pro.mjs";
import { referredFixture } from "./customer_referral_conversion.test.mjs";

async function billingFixture({rewardFee="1000000000",trial=true,referred=false}={}) {
 const f=referred?await referredFixture():await earn(rewardFixture({source:trial?"trial":"standard",amount:rewardFee}));
 const accountUser=referred?f.account.user_id:USER;
 f.env={...f.env,RAVENOS_PRO_ACCOUNT_BILLING_ENABLED:"1",STRIPE_PRO_PRICE_ID:"price_pro149"};
 f.db.raw.prepare("INSERT INTO ravenos_pro_subscriptions(user_id,stripe_customer_id,status,updated_at) VALUES (?,'cus_account123','none',?)").run(accountUser,NOW);
 const metadata={raven_user_id:accountUser,raven_product:"pro"};
 const customer={id:"cus_account123",metadata,currency:"usd",balance:0};
 const subscription={id:"sub_pro123",customer:customer.id,metadata,status:"active",cancel_at_period_end:false,items:{data:[{price:{id:"price_pro149"},quantity:1}]}};
 const invoice={id:"in_month123",customer:customer.id,subscription:subscription.id,currency:"usd",total:14900,status:"paid",paid:true,amount_paid:14900,payment_intent:"pi_paid123",status_transitions:{paid_at:NOW},lines:{has_more:false,data:[{price:{id:"price_pro149"},quantity:1,amount:14900,period:{start:NOW,end:NOW+30*86400}}]}};
 const payment={id:"pi_paid123",customer:customer.id,status:"succeeded",currency:"usd",amount_received:14900,latest_charge:"ch_paid123"};
 const charge={id:"ch_paid123",customer:customer.id,payment_intent:payment.id,amount_refunded:0,disputed:false,invoice:invoice.id};
 const calls=[],history=[];let failCreditOnce=false;
 const stripe=async(path,options={})=>{
   calls.push({path,...options});
   if(path==="/v1/prices/price_pro149") return {active:true,currency:"usd",unit_amount:14900,recurring:{interval:"month",interval_count:1},billing_scheme:"per_unit"};
   if(path==="/v1/customers/cus_account123")return {...customer};
   if(path.startsWith("/v1/customers/cus_account123/balance_transactions?"))return {data:[...history].reverse(),has_more:false};
   if(path==="/v1/customers/cus_account123/balance_transactions") {
     let credit=history.find(row=>row.metadata?.raven_reward_operation===options.data["metadata[raven_reward_operation]"]);
     if(!credit){credit={id:`cbtxn_reward${history.length}abc`,customer:customer.id,amount:Number(options.data.amount),currency:"usd",type:"adjustment",metadata:{raven_reward_operation:options.data["metadata[raven_reward_operation]"]}};history.push(credit);customer.balance+=credit.amount;}
     if(failCreditOnce){failCreditOnce=false;const e=new Error("stripe_result_indeterminate");e.code=e.message;throw e;}
     return credit;
   }
   if(path===`/v1/invoices/${invoice.id}`)return structuredClone(invoice);
   if(path===`/v1/subscriptions/${subscription.id}`)return structuredClone(subscription);
   if(path===`/v1/payment_intents/${payment.id}`)return structuredClone(payment);
   if(path===`/v1/charges/${charge.id}`)return structuredClone(charge);
   if(path.startsWith("/v1/disputes?"))return {data:[{status:"needs_response"}],has_more:false};
   if(path==="/v1/checkout/sessions")return {id:"cs_test_checkout123",customer:customer.id,client_reference_id:USER,url:"https://checkout.stripe.com/c/pay/session123"};
   if(path==="/v1/checkout/sessions/cs_test_checkout123")return {id:"cs_test_checkout123",customer:customer.id,status:"open",expires_at:NOW+1800,url:"https://checkout.stripe.com/c/pay/session123"};
   throw new Error(`Unexpected Stripe request ${path}`);
 };
 function useCredit(cents) {history.push({id:"cbtxn_applied123",customer:customer.id,currency:"usd",amount:cents,type:"applied_to_invoice",invoice:invoice.id});customer.balance+=cents;invoice.amount_paid=14900-cents;payment.amount_received=invoice.amount_paid;}
 return {...f,customer,subscription,invoice,payment,charge,stripe,calls,history,useCredit,uncertainCredit:()=>{failCreditOnce=true;}};
}

test("free account trial never invokes Stripe; chosen subscription preserves remaining trial",async()=>{
 const f=await billingFixture();assert.equal(f.calls.length,0);
 await assert.rejects(continueWithPro(f.env,USER,{consent:false,stripe:f.stripe,now:NOW}),/consent/);
 const result=await continueWithPro(f.env,USER,{consent:true,stripe:f.stripe,now:NOW});
 const checkout=f.calls.find(c=>c.path==="/v1/checkout/sessions");
 assert.equal(checkout.data["subscription_data[trial_end]"],NOW+30*86400);assert.equal(result.billing_begins,NOW+30*86400);
 assert.equal(checkout.data.payment_method_collection,"always");
 assert.equal((await readProductAccess(f.db,USER,{now:NOW})).state,"PRO_TRIAL_ACTIVE");
});
test("last 48 trial hours are preserved without an early charge",async()=>{const f=await billingFixture();await assert.rejects(continueWithPro(f.env,USER,{consent:true,stripe:f.stripe,now:NOW+29*86400}),/continue_pro_at_trial_end/);assert.equal(f.calls.some(c=>c.path==="/v1/checkout/sessions"),false);});
test("checkout retry reuses one Stripe session",async()=>{const f=await billingFixture();for(let n=0;n<2;n++)await continueWithPro(f.env,USER,{consent:true,stripe:f.stripe,now:NOW});assert.equal(f.calls.filter(c=>c.path==="/v1/checkout/sessions").length,1);});
for(const amount of ["83000000","149000000"])test(`reward credit ${amount} micro-USDC is a real invoice credit, not external revenue`,async()=>{
 const f=await billingFixture();const result=await applyRewardsToPro(f.env,USER,{amount_micros:amount,idempotency_key:"credit_request_123",stripe:f.stripe,now:NOW});assert.equal(result.state,"settled");
 f.useCredit(Number(BigInt(amount)/10000n));const invoice=await reconcileProInvoice(f.env,f.invoice.id,{stripe:f.stripe,now:NOW});
 assert.equal(invoice.reward_credit_cents,Number(BigInt(amount)/10000n));assert.equal(invoice.external_paid_cents,14900-Number(BigInt(amount)/10000n));
 assert.equal((await rewardBalance(f.db,USER)).applied_micros,amount);assert.equal((await readProductAccess(f.db,USER,{now:NOW})).state,"PAID_PRO");
});
test("uncertain Stripe credit retries the same operation without double spending",async()=>{const f=await billingFixture();f.uncertainCredit();const input={amount_micros:"83000000",idempotency_key:"credit_retry_12345",stripe:f.stripe,now:NOW};await assert.rejects(applyRewardsToPro(f.env,USER,input),/indeterminate/);assert.equal((await rewardBalance(f.db,USER)).reserved_micros,"83000000");await applyRewardsToPro(f.env,USER,input);assert.equal(f.history.length,1);assert.equal((await rewardBalance(f.db,USER)).applied_micros,"83000000");});
test("insufficient rewards do not strand the billing lock",async()=>{const f=await billingFixture({rewardFee:"100"});await assert.rejects(applyRewardsToPro(f.env,USER,{amount_micros:"1000000",idempotency_key:"credit_empty_12345",stripe:f.stripe,now:NOW}),/insufficient/);assert.equal(f.db.raw.prepare("SELECT COUNT(*) n FROM ravenos_pro_billing_locks").get().n,0);});
test("other Stripe credits are not mislabeled as Raven Rewards",async()=>{const f=await billingFixture();f.history.push({id:"cbtxn_support123",customer:f.customer.id,currency:"usd",amount:-4900,type:"adjustment",metadata:{}});f.useCredit(4900);const r=await reconcileProInvoice(f.env,f.invoice.id,{stripe:f.stripe,now:NOW});assert.equal(r.reward_credit_cents,0);assert.equal(r.other_credit_cents,4900);assert.equal(r.external_paid_cents,10000);});
test("forged reward credit metadata fails closed",async()=>{const f=await billingFixture();f.history.push({id:"cbtxn_forged123",customer:f.customer.id,currency:"usd",amount:-4900,type:"adjustment",metadata:{raven_reward_operation:"rop_missing"}});f.useCredit(4900);await assert.rejects(reconcileProInvoice(f.env,f.invoice.id,{stripe:f.stripe,now:NOW}),/origin_invalid/);});
test("trial invoices and click-only subscribe actions generate no paid entitlement",async()=>{const f=await billingFixture();f.invoice.total=0;f.invoice.amount_paid=0;f.invoice.lines.data[0].amount=0;assert.equal((await reconcileProInvoice(f.env,f.invoice.id,{stripe:f.stripe,now:NOW})).state,"stripe_trial_invoice_no_payment");assert.equal((await readProductAccess(f.db,USER,{now:NOW})).state,"PRO_TRIAL_ACTIVE");});
test("failed payment evidence creates no paid subscription invoice",async()=>{const f=await billingFixture();f.payment.status="requires_payment_method";await assert.rejects(reconcileProInvoice(f.env,f.invoice.id,{stripe:f.stripe,now:NOW}),/unverified/);assert.equal(f.db.raw.prepare("SELECT COUNT(*) n FROM ravenos_pro_invoices").get().n,0);});
test("refund of an old subscription reconciles without replacing the current subscription",async()=>{const f=await billingFixture();await reconcileProInvoice(f.env,f.invoice.id,{stripe:f.stripe,now:NOW});f.db.raw.prepare("UPDATE ravenos_pro_subscriptions SET stripe_subscription_id='sub_new123',period_start=?,period_end=? WHERE user_id=?").run(NOW+30*86400,NOW+60*86400,USER);f.charge.amount_refunded=14900;const r=await reconcileProInvoice(f.env,f.invoice.id,{stripe:f.stripe,now:NOW+31*86400});assert.equal(r.external_paid_cents,0);assert.equal(f.db.raw.prepare("SELECT stripe_subscription_id FROM ravenos_pro_subscriptions").get().stripe_subscription_id,"sub_new123");});
test("auto apply is opt-in and recovers a prior uncertain credit",async()=>{
 const f=await billingFixture();f.db.raw.prepare("UPDATE ravenos_pro_subscriptions SET stripe_subscription_id=?,status='active',paid_history=1 WHERE user_id=?").run(f.subscription.id,USER);
 f.invoice.status="draft";f.invoice.billing_reason="subscription_cycle";
 let event={id:"evt_noopt123",created:NOW,type:"invoice.created",data:{object:{id:f.invoice.id}}};
 assert.equal((await processAccountStripeEvent(f.env,event,{stripe:f.stripe,now:NOW})).state,"auto_apply_not_opted_in");
 await setAutoApply(f.env,USER,true,NOW);f.uncertainCredit();event={...event,id:"evt_auto123"};
 await assert.rejects(processAccountStripeEvent(f.env,event,{stripe:f.stripe,now:NOW}),/indeterminate/);
 assert.equal(f.db.raw.prepare("SELECT processed_at FROM ravenos_pro_billing_events WHERE stripe_event_id=?").get(event.id).processed_at,null);
 await processAccountStripeEvent(f.env,event,{stripe:f.stripe,now:NOW});assert.equal((await rewardBalance(f.db,USER)).applied_micros,"149000000");assert.equal(f.history.length,1);
 assert.equal((await processAccountStripeEvent(f.env,event,{stripe:f.stripe,now:NOW})).state,"already_processed");
});
test("paid invoice webhook retries never duplicate product events",async()=>{const f=await billingFixture();const event={id:"evt_paid123",created:NOW,type:"invoice.paid",data:{object:{id:f.invoice.id}}};for(let i=0;i<2;i++)await processAccountStripeEvent(f.env,event,{stripe:f.stripe,now:NOW});assert.equal(f.db.raw.prepare("SELECT COUNT(*) n FROM ravenos_pro_invoices").get().n,1);assert.equal(f.db.raw.prepare("SELECT COUNT(*) n FROM ravenos_product_events WHERE event_type='pro_subscribed'").get().n,1);});
test("Stripe webhook requires a valid fresh signature",()=>{const raw=JSON.stringify({id:"evt_signature123"});const secret="whsec_fixture";const sig=createHmac("sha256",secret).update(`${NOW}.${raw}`).digest("hex");assert.equal(verifyProStripeSignature(raw,`t=${NOW},v1=${sig}`,secret,NOW).id,"evt_signature123");assert.throws(()=>verifyProStripeSignature(raw,`t=${NOW},v1=${sig}`,secret,NOW+301),/signature/);assert.throws(()=>verifyProStripeSignature(raw+" ",`t=${NOW},v1=${sig}`,secret,NOW),/signature/);});

test("out-of-order paid webhooks use the first qualifying Stripe payment for the original referral window",async()=>{
 const f=await billingFixture({referred:true});
 const first=structuredClone(f.invoice);
 first.id="in_earlier123";
 first.payment_intent="pi_earlier123";
 first.status_transitions.paid_at=NOW+40*86400;
 first.lines.data[0].period={start:NOW+40*86400,end:NOW+70*86400};
 f.invoice.status_transitions.paid_at=NOW+70*86400;
 f.invoice.lines.data[0].period={start:NOW+70*86400,end:NOW+100*86400};
 const stripe=async(path,options)=>{
   if(path.startsWith("/v1/invoices?"))return {data:[f.invoice,first],has_more:false};
   if(path===`/v1/invoices/${first.id}`)return first;
   if(path==="/v1/payment_intents/pi_earlier123")return {...f.payment,id:"pi_earlier123",latest_charge:"ch_earlier123"};
   if(path==="/v1/charges/ch_earlier123")return {...f.charge,id:"ch_earlier123",payment_intent:"pi_earlier123",invoice:first.id};
   return f.stripe(path,options);
 };
 await reconcileProInvoice(f.env,f.invoice.id,{stripe,now:NOW+70*86400});
 const window=f.db.raw.prepare("SELECT * FROM ravenos_referral_conversion_windows").get();
 assert.equal(window.paid_conversion_at,first.status_transitions.paid_at);
 assert.equal(window.first_paid_invoice_id,first.id);
 assert.equal(f.db.raw.prepare("SELECT SUM(earned_delta) earned FROM ravenos_affiliate_commission_ledger").get().earned,7450);
 assert.equal(f.db.raw.prepare("SELECT period_end FROM ravenos_pro_subscriptions").get().period_end,NOW+100*86400);
});
test("concurrent invoice reconciliation is serialized before fetching financial evidence",async()=>{
 const f=await billingFixture();
 let entered,release;
 const started=new Promise(resolve=>{entered=resolve;});
 const gate=new Promise(resolve=>{release=resolve;});
 const stripe=async(path,options)=>{if(path===`/v1/invoices/${f.invoice.id}`){entered();await gate;}return f.stripe(path,options);};
 const first=reconcileProInvoice(f.env,f.invoice.id,{stripe,now:NOW});
 await started;
 await assert.rejects(reconcileProInvoice(f.env,f.invoice.id,{stripe,now:NOW}),/reconciliation_in_progress/);
 release();await first;
 assert.equal(f.calls.filter(c=>c.path===`/v1/invoices/${f.invoice.id}`).length,1);
 assert.equal(f.db.raw.prepare("SELECT COUNT(*) n FROM ravenos_pro_invoice_locks").get().n,0);
});
test("an expired invoice worker cannot overwrite a replacement worker's invoice or entitlement",async()=>{
 const f=await billingFixture();
 const stripe=async(path,options)=>{
   const result=await f.stripe(path,options);
   if(path===`/v1/charges/${f.charge.id}`)f.db.raw.prepare("UPDATE ravenos_pro_invoice_locks SET owner_token='replacement'").run();
   return result;
 };
 await assert.rejects(reconcileProInvoice(f.env,f.invoice.id,{stripe,now:NOW}),/lease_lost/);
 assert.equal(f.db.raw.prepare("SELECT COUNT(*) n FROM ravenos_pro_invoices").get().n,0);
 assert.equal(f.db.raw.prepare("SELECT paid_history FROM ravenos_pro_subscriptions").get().paid_history,0);
 assert.equal((await readProductAccess(f.db,USER,{now:NOW})).state,"PRO_TRIAL_ACTIVE");
});
test("another invoice's payment cannot fund this subscription invoice",async()=>{
 const f=await billingFixture();f.charge.invoice="in_different123";
 await assert.rejects(reconcileProInvoice(f.env,f.invoice.id,{stripe:f.stripe,now:NOW}),/payment_unverified/);
 assert.equal(f.db.raw.prepare("SELECT COUNT(*) n FROM ravenos_pro_invoices").get().n,0);
});
