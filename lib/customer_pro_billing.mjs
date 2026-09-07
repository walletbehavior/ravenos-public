import { reconcileAffiliateInvoice } from "./customer_referral_growth.mjs";
import { createHash, createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { subscriptionConfig } from "./ravenos_subscriptions.mjs";
import { productFlags, RAVEN_PRO_MONTHLY_PRICE_USD, moneyMicros } from "./customer_product.mjs";
import { readProductAccess } from "./customer_pro.mjs";
import { RewardError, rewardBalance, reserveRewards, finishRewardOperation, productEvent } from "./customer_rewards.mjs";
const nowSeconds = () => Math.floor(Date.now() / 1000);
const hash = (text) => createHash("sha256").update(text).digest("hex");
const priceCents = RAVEN_PRO_MONTHLY_PRICE_USD * 100;
const id = (value, prefix) => { if (typeof value !== "string" || !new RegExp(`^${prefix}_[A-Za-z0-9_]{3,150}$`).test(value)) throw new RewardError("stripe_identity_invalid"); return value; };

export function createAccountStripeClient(env, { fetch_impl = globalThis.fetch } = {}) {
  const config = subscriptionConfig(env);
  if (!productFlags(env).billing || !config.secretKey) throw new RewardError("pro_billing_unavailable", 503);
  return async function stripe(path, { method = "GET", data = {}, key = null } = {}) {
    if (!/^\/v1\/[a-z0-9_/?=&%[\].-]+$/i.test(path)) throw new RewardError("stripe_path_invalid");
    const headers = { authorization: `Bearer ${config.secretKey}`, "Stripe-Version": "2024-06-20" };
    if (key) headers["Idempotency-Key"] = `raven-pro-${key}`;
    if (method !== "GET") headers["content-type"] = "application/x-www-form-urlencoded";
    let response;
    try { response = await fetch_impl(`https://api.stripe.com${path}`, { method, headers, ...(method !== "GET" ? { body: new URLSearchParams(Object.entries(data).map(([k,v]) => [k, String(v)])) } : {}), signal: AbortSignal.timeout(10000), redirect: "manual" }); }
    catch { throw new RewardError("stripe_result_indeterminate", 503); }
    if (response.status >= 300 && response.status < 400) throw new RewardError("stripe_result_indeterminate", 503);
    const text = await response.text();
    if (text.length > 262144) throw new RewardError("stripe_result_indeterminate", 503);
    let result; try { result = JSON.parse(text); } catch { throw new RewardError("stripe_result_indeterminate", 503); }
    if (!response.ok) throw new RewardError(response.status >= 500 || response.status === 409 ? "stripe_result_indeterminate" : "stripe_request_rejected", 503);
    return result;
  };
}
async function lock(db, user, key, now) {
  await db.prepare("INSERT OR IGNORE INTO ravenos_pro_billing_locks (user_id,operation_key,created_at) VALUES (?,?,?)").bind(user, key, now).run();
  const current = await db.prepare("SELECT * FROM ravenos_pro_billing_locks WHERE user_id = ?").bind(user).first();
  if (current.operation_key !== key) throw new RewardError("billing_operation_in_progress");
  if (now - current.created_at > 23 * 3600) throw new RewardError("billing_operation_requires_reconciliation", 503);
}
const unlock = (db,user,key) => db.prepare("DELETE FROM ravenos_pro_billing_locks WHERE user_id = ? AND operation_key = ?").bind(user,key).run();
export async function validateProStripePrice(env, stripe) {
  const config = subscriptionConfig(env);
  const priceId = id(config.proPriceId || config.monthlyPriceId, "price");
  const price = await stripe(`/v1/prices/${priceId}`);
  if (!price.active || price.currency !== "usd" || price.unit_amount !== priceCents || price.recurring?.interval !== "month" || price.recurring?.interval_count !== 1 || price.billing_scheme !== "per_unit") throw new RewardError("pro_stripe_price_mismatch", 503);
  return priceId;
}
async function customer(db, user, stripe, now) {
  let record = await db.prepare("SELECT * FROM ravenos_pro_subscriptions WHERE user_id = ?").bind(user).first();
  if (record) return record;
  const account = await db.prepare("SELECT primary_email,state FROM ravenos_users WHERE user_id = ?").bind(user).first();
  if (!account || account.state !== "active") throw new RewardError("pro_account_unavailable");
  const remote = await stripe("/v1/customers", { method: "POST", key: `customer-${user}`, data: { email: account.primary_email, "metadata[raven_user_id]": user, "metadata[raven_product]": "pro" } });
  const customerId = id(remote.id, "cus");
  if (remote.metadata?.raven_user_id !== user || remote.metadata?.raven_product !== "pro") throw new RewardError("stripe_customer_binding_mismatch");
  await db.prepare("INSERT OR IGNORE INTO ravenos_pro_subscriptions (user_id,stripe_customer_id,updated_at) VALUES (?,?,?)").bind(user,customerId,now).run();
  record = await db.prepare("SELECT * FROM ravenos_pro_subscriptions WHERE user_id = ?").bind(user).first();
  if (record.stripe_customer_id !== customerId) throw new RewardError("stripe_customer_binding_mismatch");
  return record;
}
function accountOrigin(env) {
  const origin = new URL(env.RAVENOS_CUSTOMER_ORIGIN || env.RAVENOS_APP_URL || env.APP_URL || "https://app.ravenos.xyz");
  if (origin.protocol !== "https:" || !["app.ravenos.xyz", "ravenos.xyz"].includes(origin.hostname)) throw new RewardError("billing_return_origin_invalid");
  return origin.origin;
}
export async function continueWithPro(env,user,options={}) {
  try { return await continueWithProLocked(env,user,options); }
  catch(error) {
    if (["pro_stripe_price_mismatch","stripe_identity_invalid","pro_account_unavailable","pro_subscription_already_exists","continue_pro_at_trial_end","stripe_request_rejected"].includes(error.code)) await unlock(env.RAVENOS_CUSTOMER_DB,user,`checkout-${user}`);
    throw error;
  }
}
async function continueWithProLocked(env, user, { consent, now = nowSeconds(), stripe = createAccountStripeClient(env) } = {}) {
  if (!productFlags(env).billing) throw new RewardError("pro_billing_unavailable",503);
  if (consent !== true) throw new RewardError("pro_recurring_billing_consent_required",400);
  const db = env.RAVENOS_CUSTOMER_DB;
  const key = `checkout-${user}`;
  await lock(db,user,key,now);
  const price = await validateProStripePrice(env,stripe);
  const record = await customer(db,user,stripe,now);
  if (["active","trialing","past_due","unpaid","incomplete","paused"].includes(record.status)) { await unlock(db,user,key); throw new RewardError("pro_subscription_already_exists"); }
  let attempt = await db.prepare("SELECT * FROM ravenos_pro_checkout_attempts WHERE user_id = ?").bind(user).first();
  if (attempt?.stripe_session_id) {
    const session = await stripe(`/v1/checkout/sessions/${id(attempt.stripe_session_id,"cs")}`);
    if (session.customer !== record.stripe_customer_id) throw new RewardError("stripe_checkout_binding_mismatch");
    if (session.status === "complete") { await unlock(db,user,key); throw new RewardError("pro_subscription_confirmation_pending"); }
    if (session.status === "open" && session.expires_at > now) { await unlock(db,user,key); return { checkout_url: session.url, trial_end: attempt.trial_end, billing_begins: attempt.trial_end || now }; }
    if (session.status !== "expired") throw new RewardError("checkout_reconciliation_required");
    await db.prepare("DELETE FROM ravenos_pro_checkout_attempts WHERE user_id = ? AND attempt_id = ?").bind(user,attempt.attempt_id).run(); attempt=null;
  }
  if (!attempt) {
    const access = await readProductAccess(db,user,{now});
    // Stripe Checkout requires trial_end at least 48 hours away. Within that
    // window leave the local free trial intact and invite conversion at expiry.
    const trialEnd = access.state === "PRO_TRIAL_ACTIVE" ? access.trial.trial_ends_at : null;
    if (trialEnd && trialEnd < now + 48 * 3600 + 60) { await unlock(db,user,key); throw new RewardError("continue_pro_at_trial_end"); }
    const attemptId = `rco_${randomBytes(18).toString("hex")}`;
    await db.prepare("INSERT OR IGNORE INTO ravenos_pro_checkout_attempts (user_id,attempt_id,state,trial_end,created_at,expires_at) VALUES (?,?,'creating',?,?,?)").bind(user,attemptId,trialEnd,now,now+1800).run();
    attempt=await db.prepare("SELECT * FROM ravenos_pro_checkout_attempts WHERE user_id = ?").bind(user).first();
  }
  if (now - attempt.created_at > 23*3600) throw new RewardError("checkout_reconciliation_required");
  const origin = accountOrigin(env);
  const session = await stripe("/v1/checkout/sessions", { method: "POST", key: attempt.attempt_id, data: {
    mode: "subscription", customer: record.stripe_customer_id, client_reference_id: user,
    "line_items[0][price]": price, "line_items[0][quantity]": 1,
    "metadata[raven_user_id]": user, "metadata[raven_product]": "pro",
    "subscription_data[metadata][raven_user_id]": user, "subscription_data[metadata][raven_product]": "pro",
    ...(attempt.trial_end ? { "subscription_data[trial_end]": attempt.trial_end } : {}),
    payment_method_collection: "always", "payment_method_types[0]": "card",
    success_url: `${origin}/account/?pro=confirmation`, cancel_url: `${origin}/account/?pro=cancelled`, expires_at: attempt.expires_at,
    "custom_text[submit][message]": `Raven Pro is $${RAVEN_PRO_MONTHLY_PRICE_USD}/month. ${attempt.trial_end ? "Your remaining free trial is preserved. " : ""}By subscribing you authorize recurring billing; cancel in Account.`,
  } });
  id(session.id,"cs");
  if (session.customer !== record.stripe_customer_id || session.client_reference_id !== user || new URL(session.url).origin !== "https://checkout.stripe.com") throw new RewardError("stripe_checkout_binding_mismatch");
  await db.prepare("UPDATE ravenos_pro_checkout_attempts SET stripe_session_id = ?,checkout_url = ?,state = 'open' WHERE user_id = ? AND attempt_id = ?").bind(session.id,session.url,user,attempt.attempt_id).run();
  await unlock(db,user,key);
  return { checkout_url: session.url, trial_end: attempt.trial_end, billing_begins: attempt.trial_end || now };
}

export async function applyRewardsToPro(env,user,options={}) {
  try { return await applyRewardsToProLocked(env,user,options); }
  catch(error) {
    if (["pro_stripe_price_mismatch","stripe_identity_invalid","pro_account_unavailable","reward_balance_insufficient","reward_idempotency_conflict","reward_operation_terminal","next_pro_bill_already_credited","stripe_request_rejected"].includes(error.code)) await unlock(env.RAVENOS_CUSTOMER_DB,user,`credit-${options.idempotency_key}`);
    throw error;
  }
}
async function applyRewardsToProLocked(env, user, { amount_micros, idempotency_key, now = nowSeconds(), stripe = createAccountStripeClient(env) } = {}) {
  if (!productFlags(env).subscription_credit || !productFlags(env).billing) throw new RewardError("subscription_credit_unavailable",503);
  const db=env.RAVENOS_CUSTOMER_DB;
  const amount=moneyMicros(amount_micros);
  if (amount <= 0n || amount % 10000n !== 0n || amount > BigInt(priceCents)*10000n) throw new RewardError("subscription_credit_amount_invalid");
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(idempotency_key || "")) throw new RewardError("reward_request_invalid",400);
  const key=`credit-${idempotency_key}`;
  await lock(db,user,key,now);
  await validateProStripePrice(env,stripe);
  const record=await customer(db,user,stripe,now);
  const previous=await db.prepare("SELECT * FROM ravenos_reward_operations WHERE user_id = ? AND idempotency_key = ?").bind(user,idempotency_key).first();
  if (previous && (previous.kind !== "subscription_credit" || String(previous.amount_micros) !== amount.toString())) throw new RewardError("reward_idempotency_conflict");
  if (previous?.state === "failed") throw new RewardError("reward_operation_terminal");
  if (previous?.state === "settled") { await unlock(db,user,key); return { state:"settled",operation_id:previous.operation_id,amount_micros:amount.toString() }; }
  const remote=await stripe(`/v1/customers/${id(record.stripe_customer_id,"cus")}`);
  if (remote.metadata?.raven_user_id !== user || remote.metadata?.raven_product !== "pro" || !Number.isSafeInteger(remote.balance || 0) || (remote.currency && remote.currency !== "usd")) throw new RewardError("stripe_customer_binding_mismatch");
  if (!previous && Math.max(0,-(remote.balance || 0)) + Number(amount/10000n) > priceCents) { await unlock(db,user,key); throw new RewardError("next_pro_bill_already_credited"); }
  const operation=previous || await reserveRewards(db,{user_id:user,kind:"subscription_credit",amount_micros:amount.toString(),idempotency_key,destination:{stripe_customer_id:record.stripe_customer_id,currency:"usd",purpose:"next_pro_invoice"},now});
  let credit;
  try { credit=await stripe(`/v1/customers/${record.stripe_customer_id}/balance_transactions`,{method:"POST",key:operation.operation_id,data:{amount:-(amount/10000n),currency:"usd",description:"Raven Rewards applied to Raven Pro", "metadata[raven_reward_operation]":operation.operation_id,"metadata[raven_user_id]":user}}); }
  catch(error) {
    if (error.code === "stripe_request_rejected") { await finishRewardOperation(db,{operation_id:operation.operation_id,user_id:user,outcome:"failed",evidence:{reason:"stripe_credit_rejected"},now}); await unlock(db,user,key); }
    else await finishRewardOperation(db,{operation_id:operation.operation_id,user_id:user,outcome:"indeterminate",evidence:{reason:"stripe_credit_confirmation_pending"},now});
    throw error;
  }
  if (credit.customer !== record.stripe_customer_id || credit.currency !== "usd" || credit.amount !== -Number(amount/10000n) || credit.metadata?.raven_reward_operation !== operation.operation_id) throw new RewardError("stripe_credit_binding_mismatch");
  id(credit.id,"cbtxn");
  const result=await finishRewardOperation(db,{operation_id:operation.operation_id,user_id:user,outcome:"settled",external_reference:credit.id,evidence:{stripe_customer_id:credit.customer,credit_cents:String(-credit.amount),purpose:"invoice_credit_balance_not_cash_payment"},now});
  await unlock(db,user,key);
  return {...result,amount_micros:amount.toString(),stripe_credit_cents:-credit.amount};
}
export async function proBillingPortal(env,user,{stripe=createAccountStripeClient(env)}={}) {
  const record=await env.RAVENOS_CUSTOMER_DB.prepare("SELECT stripe_customer_id FROM ravenos_pro_subscriptions WHERE user_id = ?").bind(user).first();
  if (!record) throw new RewardError("pro_billing_account_not_found",404);
  const portalConfig = subscriptionConfig(env).portalConfigurationId;
  const session=await stripe("/v1/billing_portal/sessions",{method:"POST",data:{customer:id(record.stripe_customer_id,"cus"),return_url:`${accountOrigin(env)}/account/`,...(portalConfig ? { configuration: id(portalConfig,"bpc") } : {})}});
  if (new URL(session.url).origin !== "https://billing.stripe.com") throw new RewardError("stripe_portal_url_invalid");
  return {portal_url:session.url};
}
export function verifyProStripeSignature(raw, header, secret, now=nowSeconds()) {
  if (!secret || typeof raw !== "string" || raw.length > 262144) throw new RewardError("stripe_signature_invalid",400);
  const parts=String(header||"").split(","); const t=parts.find((p)=>p.startsWith("t="))?.slice(2);
  if (!/^\d{10}$/.test(t||"") || Math.abs(now-Number(t))>300) throw new RewardError("stripe_signature_invalid",400);
  const expected=createHmac("sha256",secret).update(`${t}.${raw}`).digest();
  if (!parts.filter((p)=>/^v1=[0-9a-f]{64}$/.test(p)).some((p)=>timingSafeEqual(Buffer.from(p.slice(3),"hex"),expected))) throw new RewardError("stripe_signature_invalid",400);
  return JSON.parse(raw);
}

async function invoiceCredits(db, stripe, customerId, invoiceId) {
  let cursor=""; const history=[];
  for(let page=0;page<10;page++) {
    const result=await stripe(`/v1/customers/${id(customerId,"cus")}/balance_transactions?limit=100${cursor ? `&starting_after=${cursor}` : ""}`);
    if (!Array.isArray(result.data)) throw new RewardError("stripe_invoice_credit_evidence_unavailable",503);
    history.push(...result.data);
    if(!result.has_more) break;
    if(page===9) throw new RewardError("stripe_invoice_credit_history_requires_reconciliation",503);
    cursor=id(result.data.at(-1)?.id,"cbtxn");
  }
  // Stripe exposes a pooled invoice credit balance. Attribute consumed credits
  // using a documented FIFO accounting convention over its ordered ledger.
  // Only exact server-owned reward operations are labelled Raven Rewards.
  const lots=[]; const applications=new Map(); let total=0,rewards=0;
  for(const row of history.reverse()) {
    if(row.currency!=="usd"||!Number.isSafeInteger(row.amount)||row.customer!==customerId) throw new RewardError("stripe_invoice_credit_evidence_invalid");
    if(row.type==="unapplied_from_invoice") {
      const prior=applications.get(row.invoice);
      if(!prior||prior.reduce((n,lot)=>n+lot.amount,0)!==-row.amount) throw new RewardError("stripe_credit_reversal_requires_reconciliation");
      lots.unshift(...prior.map(lot=>({...lot}))); applications.delete(row.invoice);
      if(row.invoice===invoiceId) {total=0;rewards=0;}
      continue;
    }
    if(row.amount<0) {
      let reward=false;
      if(row.metadata?.raven_reward_operation) {
        const operation=await db.prepare("SELECT * FROM ravenos_reward_operations WHERE operation_id=? AND kind='subscription_credit'").bind(row.metadata.raven_reward_operation).first();
        if(!operation||!["settled","indeterminate","reserved"].includes(operation.state)||JSON.parse(operation.destination_json).stripe_customer_id!==customerId||BigInt(operation.amount_micros)!==BigInt(-row.amount)*10000n||(operation.external_reference&&operation.external_reference!==row.id)) throw new RewardError("stripe_reward_credit_origin_invalid");
        reward=true;
      }
      lots.push({amount:-row.amount,reward});
    } else if(row.amount>0) {
      let remaining=row.amount; const consumed=[];
      while(remaining>0&&lots.length) {
        const lot=lots[0],amount=Math.min(lot.amount,remaining);
        consumed.push({amount,reward:lot.reward});remaining-=amount;lot.amount-=amount;
        if(lot.amount===0)lots.shift();
      }
      if(row.type==="applied_to_invoice") {
        if(remaining!==0)throw new RewardError("stripe_invoice_credit_origin_incomplete");
        applications.set(row.invoice,consumed);
        if(row.invoice===invoiceId){total+=row.amount;rewards+=consumed.filter(lot=>lot.reward).reduce((sum,lot)=>sum+lot.amount,0);}
      } else if(remaining>0) throw new RewardError("stripe_credit_debit_requires_reconciliation");
    }
  }
  return {total,rewards,other:total-rewards};
}
async function reconcileEarlierInvoices(env,record,invoice,stripe,now) {
  const window=await env.RAVENOS_CUSTOMER_DB.prepare("SELECT w.paid_conversion_at FROM ravenos_referral_attributions r JOIN ravenos_referral_conversion_windows w USING(attribution_id) WHERE r.referred_user_id=?").bind(record.user_id).first();
  if(!window||window.paid_conversion_at!==null)return;
  const earlier=[];let cursor="";
  for(let page=0;page<10;page++) {
    const result=await stripe(`/v1/invoices?customer=${id(record.stripe_customer_id,"cus")}&status=paid&limit=100${cursor?`&starting_after=${cursor}`:""}`);
    if(!Array.isArray(result.data))throw new RewardError("stripe_first_payment_history_unverified",503);
    for(const candidate of result.data)if(candidate.id!==invoice.id&&Number.isSafeInteger(candidate.status_transitions?.paid_at)&&(candidate.status_transitions.paid_at<invoice.status_transitions.paid_at||(candidate.status_transitions.paid_at===invoice.status_transitions.paid_at&&candidate.id.localeCompare(invoice.id)<0))) earlier.push(candidate);
    if(!result.has_more)break;
    if(page===9)throw new RewardError("stripe_first_payment_history_requires_reconciliation",503);
    cursor=id(result.data.at(-1)?.id,"in");
  }
  earlier.sort((a,b)=>a.status_transitions.paid_at-b.status_transitions.paid_at||a.id.localeCompare(b.id));
  for(const candidate of earlier)await reconcileProInvoice(env,candidate.id,{stripe,now,source_reference:`history_${candidate.id}`,resolve_history:false});
}
export async function reconcileProInvoice(env,invoiceId,options={}) {
 const db=env.RAVENOS_CUSTOMER_DB,now=options.now??nowSeconds(),owner=randomBytes(24).toString("hex");
 id(invoiceId,"in");
 await db.prepare("INSERT INTO ravenos_pro_invoice_locks(invoice_id,owner_token,expires_at) VALUES (?,?,?) ON CONFLICT(invoice_id) DO UPDATE SET owner_token=excluded.owner_token,expires_at=excluded.expires_at WHERE ravenos_pro_invoice_locks.expires_at<?").bind(invoiceId,owner,now+900,now).run();
 const lease=await db.prepare("SELECT owner_token FROM ravenos_pro_invoice_locks WHERE invoice_id=?").bind(invoiceId).first();
 if(lease.owner_token!==owner)throw new RewardError("invoice_reconciliation_in_progress",503);
 try {return await reconcileProInvoiceLocked(env,invoiceId,{...options,now,lock_owner:owner});}
 finally {await db.prepare("DELETE FROM ravenos_pro_invoice_locks WHERE invoice_id=? AND owner_token=?").bind(invoiceId,owner).run();}
}
async function reconcileProInvoiceLocked(env, invoiceId, {stripe=createAccountStripeClient(env),now=nowSeconds(),source_reference=null,resolve_history=true,lock_owner=null}={}) {
  const db=env.RAVENOS_CUSTOMER_DB;
  const invoice=await stripe(`/v1/invoices/${id(invoiceId,"in")}`);
  const record=await db.prepare("SELECT * FROM ravenos_pro_subscriptions WHERE stripe_customer_id = ?").bind(String(invoice.customer||"")).first();
  if(!record) return {state:"unowned_invoice_ignored"};
  const price=await validateProStripePrice(env,stripe);
  const lines=invoice.lines?.data;
  if(invoice.currency!=="usd" || !Array.isArray(lines) || invoice.lines.has_more || lines.length!==1 || lines[0].price?.id!==price || lines[0].quantity!==1 || lines[0].proration===true) throw new RewardError("pro_invoice_contract_mismatch");
  // Stripe issues a zero-value invoice when an explicitly chosen paid
  // subscription starts with a remaining local trial. It is not paid Pro.
  if(invoice.total===0 && lines[0].amount===0) return {state:"stripe_trial_invoice_no_payment"};
  if(lines[0].amount!==priceCents || !Number.isSafeInteger(invoice.total) || invoice.total<0 || invoice.total>priceCents || (invoice.tax||0)!==0 || invoice.status!=="paid" || invoice.paid!==true) return {state:"invoice_not_funded"};
  const subscription=await stripe(`/v1/subscriptions/${id(invoice.subscription,"sub")}`);
  if(subscription.id!==invoice.subscription || subscription.customer!==record.stripe_customer_id || subscription.metadata?.raven_user_id!==record.user_id || subscription.metadata?.raven_product!=="pro") throw new RewardError("stripe_subscription_binding_mismatch");
  const creditEvidence=await invoiceCredits(db,stripe,record.stripe_customer_id,invoice.id);
  const credits=creditEvidence.total;
  const amountPaid=invoice.amount_paid;
  if(!Number.isSafeInteger(amountPaid)||amountPaid<0||credits<0||credits>priceCents||amountPaid+credits!==invoice.total||invoice.paid_out_of_band===true) throw new RewardError("pro_invoice_funding_evidence_incomplete");
  let netCash=amountPaid,disputed=false;
  if(amountPaid>0) {
    const payment=await stripe(`/v1/payment_intents/${id(invoice.payment_intent,"pi")}`);
    if(payment.id!==invoice.payment_intent || !payment.latest_charge || payment.status!=="succeeded" || payment.customer!==record.stripe_customer_id || payment.currency!=="usd" || payment.amount_received!==amountPaid) throw new RewardError("pro_external_payment_unverified");
    if(payment.latest_charge) {
      const charge=await stripe(`/v1/charges/${id(payment.latest_charge,"ch")}`);
      if(charge.id!==payment.latest_charge || charge.invoice!==invoice.id || charge.payment_intent!==payment.id || charge.customer!==record.stripe_customer_id || !Number.isSafeInteger(charge.amount_refunded) || charge.amount_refunded<0 || charge.amount_refunded>amountPaid) throw new RewardError("pro_external_payment_unverified");
      disputed=charge.disputed===true;
      if(disputed) {
        const disputes=await stripe(`/v1/disputes?charge=${id(charge.id,"ch")}&limit=100`);
        if(!Array.isArray(disputes.data)||disputes.has_more)throw new RewardError("pro_dispute_evidence_incomplete");
        disputed=disputes.data.some(d=>!["won","warning_closed"].includes(d.status));
      }
      netCash=disputed ? 0 : amountPaid-charge.amount_refunded;
    }
  }
  const period=lines[0].period;
  if(!Number.isSafeInteger(period?.start)||!Number.isSafeInteger(period?.end)||period.end<=period.start) throw new RewardError("pro_invoice_period_invalid");
  const existing=await db.prepare("SELECT invoice_id FROM ravenos_pro_invoices WHERE invoice_id = ?").bind(invoice.id).first();
  const paidAt=invoice.status_transitions?.paid_at;
  if(!Number.isSafeInteger(paidAt)||paidAt>now+300||paidAt<0)throw new RewardError("pro_paid_timestamp_unverified");
  const paymentEvidence={verified:true,invoice_id:invoice.id,external_paid_cents:netCash,reward_credit_cents:creditEvidence.rewards,other_credit_cents:creditEvidence.other,discount_cents:priceCents-invoice.total,disputed,source_reference:source_reference||invoice.id,paid_at:paidAt};
  const leasePredicate="EXISTS (SELECT 1 FROM ravenos_pro_invoice_locks WHERE invoice_id=? AND owner_token=?)";
  const leaseBindings=[invoice.id,lock_owner];
  const statements=[
    db.prepare(`INSERT INTO ravenos_pro_invoices (invoice_id,user_id,stripe_subscription_id,gross_cents,reward_credit_cents,external_paid_cents,currency,status,period_start,period_end,updated_at,paid_at,payment_evidence_json)
      SELECT ?,?,?,?,?,?,'usd',?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ravenos_pro_invoice_locks WHERE invoice_id=? AND owner_token=?) ON CONFLICT(invoice_id) DO UPDATE SET reward_credit_cents=excluded.reward_credit_cents,external_paid_cents=excluded.external_paid_cents,status=excluded.status,updated_at=excluded.updated_at,paid_at=excluded.paid_at,payment_evidence_json=excluded.payment_evidence_json`)
      .bind(invoice.id,record.user_id,subscription.id,priceCents,creditEvidence.rewards,netCash,invoice.status,period.start,period.end,now,paidAt,JSON.stringify(paymentEvidence),invoice.id,lock_owner),
    db.prepare(`UPDATE ravenos_pro_subscriptions SET stripe_subscription_id=?,status=?,paid_history=1,
      period_start=CASE WHEN COALESCE(period_end,0)<=? THEN ? ELSE period_start END,
      period_end=MAX(COALESCE(period_end,0),?),cancel_at_period_end=?,updated_at=? WHERE user_id=? AND (stripe_subscription_id IS NULL OR stripe_subscription_id=? OR (status IN ('canceled','incomplete_expired','none') AND COALESCE(period_end,0)<?)) AND ${leasePredicate}`)
      .bind(subscription.id,subscription.status,period.end,period.start,period.end,subscription.cancel_at_period_end?1:0,now,record.user_id,subscription.id,period.end,...leaseBindings),
    db.prepare(`UPDATE ravenos_pro_trials SET trial_status='CONVERTED' WHERE user_id=? AND trial_status IN ('ACTIVE','EXPIRED') AND ${leasePredicate}`).bind(record.user_id,...leaseBindings),
    productEvent(db,record.user_id,"pro_subscribed",invoice.id,{external_paid_cents:netCash,reward_credit_cents:creditEvidence.rewards},now,leasePredicate,leaseBindings),
    db.prepare(`INSERT OR IGNORE INTO ravenos_product_events (event_id,user_id,event_type,source_reference,occurred_at,details_json)
      SELECT ?,?,'trial_converted',?,?,? WHERE EXISTS (SELECT 1 FROM ravenos_pro_trials WHERE user_id=? AND trial_status='CONVERTED') AND ${leasePredicate}`)
      .bind(`pe_${hash(`trial_converted:${record.user_id}`)}`,record.user_id,`trial:${record.user_id}`,now,JSON.stringify({invoice_id:invoice.id,reward_credit_cents:creditEvidence.rewards}),record.user_id,...leaseBindings),
  ];
  await db.batch(statements);
  const currentLease=await db.prepare("SELECT owner_token FROM ravenos_pro_invoice_locks WHERE invoice_id=?").bind(invoice.id).first();
  if(currentLease?.owner_token!==lock_owner)throw new RewardError("invoice_reconciliation_lease_lost",503);
  if(resolve_history)await reconcileEarlierInvoices(env,record,invoice,stripe,now);
  await reconcileAffiliateInvoice(env,invoice.id,{source_reference,now});
  return {state:"reconciled",invoice_id:invoice.id,gross_cents:priceCents,reward_credit_cents:creditEvidence.rewards,other_credit_cents:creditEvidence.other,external_paid_cents:netCash,idempotent:Boolean(existing)};
}

async function autoApplyInvoice(env, invoice, stripe, now) {
  if(!productFlags(env).auto_apply||!productFlags(env).subscription_credit||invoice.billing_reason!=="subscription_cycle"||invoice.status!=="draft") return {state:"auto_apply_not_applicable"};
  const db=env.RAVENOS_CUSTOMER_DB;
  const record=await db.prepare(`SELECT s.* FROM ravenos_pro_subscriptions s JOIN ravenos_reward_preferences p ON p.user_id=s.user_id WHERE s.stripe_customer_id=? AND p.auto_apply=1`).bind(String(invoice.customer||"")).first();
  if(!record||record.stripe_subscription_id!==invoice.subscription||record.cancel_at_period_end) return {state:"auto_apply_not_opted_in"};
  const price=await validateProStripePrice(env,stripe);
  if(invoice.currency!=="usd"||invoice.total!==priceCents||invoice.lines?.has_more||invoice.lines?.data?.length!==1||invoice.lines.data[0].price?.id!==price) throw new RewardError("auto_apply_invoice_mismatch");
  const previous=await db.prepare("SELECT * FROM ravenos_reward_operations WHERE user_id=? AND idempotency_key=?").bind(record.user_id,`invoice_${invoice.id}`).first();
  if(previous)return applyRewardsToPro(env,record.user_id,{amount_micros:String(previous.amount_micros),idempotency_key:`invoice_${invoice.id}`,stripe,now});
  const balance=await rewardBalance(db,record.user_id);
  const customerState=await stripe(`/v1/customers/${record.stripe_customer_id}`);
  const room=BigInt(Math.max(0,priceCents-Math.max(0,-(customerState.balance||0))))*10000n;
  const available=moneyMicros(balance.available_micros)/10000n*10000n;
  const amount=available<room?available:room;
  if(amount===0n) return {state:"auto_apply_no_available_balance"};
  return applyRewardsToPro(env,record.user_id,{amount_micros:amount.toString(),idempotency_key:`invoice_${invoice.id}`,stripe,now});
}

export async function processAccountStripeEvent(env,event,{stripe=createAccountStripeClient(env),now=nowSeconds()}={}) {
  id(event.id,"evt");
  if(!Number.isSafeInteger(event.created)||typeof event.type!=="string"||!event.data?.object) throw new RewardError("stripe_event_invalid",400);
  const db=env.RAVENOS_CUSTOMER_DB;
  const digest=hash(JSON.stringify(event));
  await db.prepare("INSERT OR IGNORE INTO ravenos_pro_billing_events (stripe_event_id,event_type,received_at,payload_digest) VALUES (?,?,?,?)").bind(event.id,event.type,now,digest).run();
  const stored=await db.prepare("SELECT * FROM ravenos_pro_billing_events WHERE stripe_event_id=?").bind(event.id).first();
  if(stored.payload_digest!==digest) throw new RewardError("stripe_event_replay_mismatch");
  if(stored.processed_at!==null) return {state:"already_processed"};
  let result={state:"event_ignored"};
  const object=event.data.object;
  if(event.type==="invoice.paid"||event.type==="invoice.payment_succeeded") result=await reconcileProInvoice(env,object.id,{stripe,now,source_reference:event.id});
  else if(event.type==="invoice.created") {
    const current=await stripe(`/v1/invoices/${id(object.id,"in")}`);
    result=await autoApplyInvoice(env,current,stripe,now);
  } else if(["customer.subscription.created","customer.subscription.updated","customer.subscription.deleted"].includes(event.type)) {
    const current=await stripe(`/v1/subscriptions/${id(object.id,"sub")}`);
    const record=await db.prepare("SELECT * FROM ravenos_pro_subscriptions WHERE stripe_customer_id=?").bind(String(current.customer||"")).first();
    if(record) {
      if(current.metadata?.raven_user_id!==record.user_id||current.metadata?.raven_product!=="pro") throw new RewardError("stripe_subscription_binding_mismatch");
      if(record.stripe_subscription_id&&record.stripe_subscription_id!==current.id) {
        const historical=await db.prepare("SELECT invoice_id FROM ravenos_pro_invoices WHERE stripe_subscription_id=? LIMIT 1").bind(current.id).first();
        if(historical||!["canceled","incomplete_expired","none"].includes(record.status)) {
          await db.prepare("UPDATE ravenos_pro_billing_events SET processed_at=? WHERE stripe_event_id=?").bind(now,event.id).run();
          return {state:"historical_subscription_event_ignored"};
        }
      }
      const price=await validateProStripePrice(env,stripe);
      if(current.items?.data?.length!==1||current.items.data[0].price?.id!==price||current.items.data[0].quantity!==1) throw new RewardError("pro_subscription_contract_mismatch");
      const statements=[db.prepare("UPDATE ravenos_pro_subscriptions SET stripe_subscription_id=?,status=?,cancel_at_period_end=?,last_event_at=?,updated_at=? WHERE user_id=?").bind(current.id,current.status,current.cancel_at_period_end?1:0,now,now,record.user_id)];
      if(current.status==="canceled") {
        statements.push(productEvent(db,record.user_id,"pro_cancelled",current.id,{},now));
        statements.push(productEvent(db,record.user_id,"referral_subscription_cancelled",current.id,{},now,"EXISTS (SELECT 1 FROM ravenos_referral_attributions WHERE referred_user_id=?)",[record.user_id]));
        statements.push(db.prepare("UPDATE ravenos_reward_preferences SET auto_apply=0,updated_at=? WHERE user_id=?").bind(now,record.user_id));
      }
      await db.batch(statements);
      result={state:"subscription_updated"};
    }
  } else if(event.type==="charge.refunded"||event.type.startsWith("charge.dispute.")) {
    const charge=event.type==="charge.refunded"?object:await stripe(`/v1/charges/${id(object.charge,"ch")}`);
    if(charge.invoice) result=await reconcileProInvoice(env,charge.invoice,{stripe,now,source_reference:event.id});
  }
  // Processing success is written last. A network or database failure leaves
  // this event retryable; Stripe retries never silently skip unfinished work.
  await db.prepare("UPDATE ravenos_pro_billing_events SET processed_at=? WHERE stripe_event_id=? AND processed_at IS NULL").bind(now,event.id).run();
  return result;
}
