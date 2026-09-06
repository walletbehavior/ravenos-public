import { createHash, randomBytes } from "node:crypto";
import { affiliatePolicy, productFlags, RAVEN_PRO_TRIAL_DAYS } from "./customer_product.mjs";
import { CustomerLegalDocuments } from "./customer_legal_registry.mjs";
import { RewardError, productEvent } from "./customer_rewards.mjs";
import { createD1CustomerReferralStore, createReferralCodeRecord, createReferralCodeValue } from "./customer_referrals.mjs";
const digest=(value)=>createHash("sha256").update(value).digest("hex");
const nowSeconds=()=>Math.floor(Date.now()/1000);
export const AFFILIATE_DISCLOSURE="I earn a commission if you subscribe to Raven Pro through my referral link.";
export const REFERRAL_COOKIE="__Secure-raven_referral";
const idFor=(user,click)=>`rat_${digest(`${user}:${click}`).slice(0,40)}`;
const cookieValue=(request)=>{const value=String(request.headers.get("cookie")||"").split(";").map(s=>s.trim()).find(s=>s.startsWith(`${REFERRAL_COOKIE}=`))?.split("=")[1];return /^rc_[0-9a-f]{64}$/.test(value||"")?value:null;};
export async function activeAffiliateLink(db, handle) {
  if(!/^(?:[a-z][a-z0-9_]{2,23}|RVN[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12})$/i.test(String(handle||"")))return null;
  return db.prepare(`SELECT c.user_id,c.referral_code,u.username FROM ravenos_referral_codes c JOIN ravenos_affiliate_enrollments a ON a.user_id=c.user_id JOIN ravenos_users u ON u.user_id=c.user_id
    WHERE a.state='active' AND c.state='active' AND u.state='active' AND (c.referral_code=? COLLATE NOCASE OR EXISTS(SELECT 1 FROM ravenos_referral_aliases x WHERE x.user_id=c.user_id AND x.alias=? COLLATE NOCASE)) LIMIT 1`).bind(handle,handle).first();
}
export async function enrollAffiliate(env,user,{now=nowSeconds()}={}) {
  const policy=affiliatePolicy(env),db=env.RAVENOS_CUSTOMER_DB;
  if(!policy.flags.referrals||!policy.flags.enrollment)throw new RewardError("affiliate_enrollment_unavailable",503);
  const terms=CustomerLegalDocuments.find(d=>d.document_type==="affiliate_terms");
  const accepted=await db.prepare("SELECT accepted_at FROM ravenos_legal_acceptances WHERE user_id=? AND document_type='affiliate_terms' AND document_version=? AND content_hash=? AND acknowledgement='agreed' AND revoked_at IS NULL").bind(user,terms.version,terms.content_hash).first();
  if(!accepted)throw new RewardError("affiliate_terms_acceptance_required",428);
  const previous=await db.prepare("SELECT state FROM ravenos_affiliate_enrollments WHERE user_id=?").bind(user).first();
  if(previous&&previous.state!=="active")throw new RewardError("affiliate_enrollment_review_required");
  const store=createD1CustomerReferralStore(db);
  const account=await store.getDashboard(user);
  if(!account?.username)throw new RewardError("username_required");
  if(!account.referral_code)await store.createCode(await createReferralCodeRecord({user_id:user,code:createReferralCodeValue(),now}));
  const current=await store.getDashboard(user);
  await db.batch([
    db.prepare(`INSERT INTO ravenos_affiliate_enrollments (user_id,state,terms_version,terms_hash,accepted_at,joined_at) VALUES (?,'active',?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET terms_version=excluded.terms_version,terms_hash=excluded.terms_hash,accepted_at=excluded.accepted_at WHERE ravenos_affiliate_enrollments.state='active'`).bind(user,terms.version,terms.content_hash,accepted.accepted_at,now),
    db.prepare("INSERT OR IGNORE INTO ravenos_referral_aliases (alias,user_id,referral_code,created_at) VALUES (?,?,?,?)").bind(account.username,user,current.referral_code,now),
    productEvent(db,user,"affiliate_terms_accepted",`${user}:${terms.version}`,{terms_version:terms.version,terms_hash:terms.content_hash},now),
  ]);
  return affiliateDashboard(env,user,{now});
}
export async function captureReferralClick(env,request,handle,{now=nowSeconds()}={}) {
  const policy=affiliatePolicy(env),db=env.RAVENOS_CUSTOMER_DB;
  if(!policy.flags.referrals||!db?.prepare)return null;
  const affiliate=await activeAffiliateLink(db,handle);
  if(!affiliate)return null;
  const priorId=cookieValue(request);
  const prior=priorId?await db.prepare("SELECT * FROM ravenos_referral_clicks WHERE click_id=? AND expires_at>?").bind(priorId,now).first():null;
  // First qualifying click wins, including across subsequent links. Once
  // signup starts, an immutable server-side lock freezes that relationship.
  const click=prior||{click_id:`rc_${randomBytes(32).toString("hex")}`,referrer_user_id:affiliate.user_id,referral_code:affiliate.referral_code,first_click_at:now,expires_at:now+policy.attribution_days*86400};
  if(!prior)await db.batch([
    db.prepare("INSERT INTO ravenos_referral_clicks (click_id,referrer_user_id,referral_code,first_click_at,expires_at) VALUES (?,?,?,?,?)").bind(click.click_id,click.referrer_user_id,click.referral_code,now,click.expires_at),
    productEvent(db,affiliate.user_id,"referral_link_viewed",click.click_id,{},now),
  ]);
  return {click_id:click.click_id,set_cookie:`${REFERRAL_COOKIE}=${click.click_id}; Domain=ravenos.xyz; Path=/; Max-Age=${Math.max(0,click.expires_at-now)}; Secure; HttpOnly; SameSite=Lax`,redirect_url:"https://ravenos.xyz/?invited=1"};
}
export async function referralLandingContext(env,request,{now=nowSeconds()}={}) {
  const clickId=cookieValue(request);
  if(!affiliatePolicy(env).flags.referrals||!clickId)return null;
  const row=await env.RAVENOS_CUSTOMER_DB.prepare(`SELECT c.click_id,u.username FROM ravenos_referral_clicks c JOIN ravenos_users u ON u.user_id=c.referrer_user_id JOIN ravenos_affiliate_enrollments a ON a.user_id=u.user_id WHERE c.click_id=? AND c.expires_at>? AND a.state='active' AND u.state='active'`).bind(clickId,now).first();
  if(!row)return null;
  await productEvent(env.RAVENOS_CUSTOMER_DB,null,"referral_landing",row.click_id,{},now).run();
  return {invited_by:row.username,offer:"normal_pro_trial",extra_trial_days:0,disclosure:`@${row.username} may earn a commission if you later subscribe to Raven Pro.`};
}
export async function lockSignupReferral(env,request,stateHash,{now=nowSeconds()}={}) {
  if(!affiliatePolicy(env).flags.referrals)return;
  const clickId=cookieValue(request);
  if(!clickId)return;
  await env.RAVENOS_CUSTOMER_DB.prepare(`INSERT OR IGNORE INTO ravenos_referral_signup_locks (auth_state_hash,click_id,locked_at) SELECT ?,click_id,? FROM ravenos_referral_clicks WHERE click_id=? AND expires_at>?`).bind(stateHash,now,clickId,now).run();
}
export function referralSignupStatements(db,stateHash,user,now) {
  const relationship=`rat_${digest(`${user}:${stateHash}`).slice(0,40)}`;
  // These statements are executed inside the existing account-creation batch.
  // The relationship, conversion window and account either all commit or none.
  const match=`FROM ravenos_referral_signup_locks l JOIN ravenos_referral_clicks c ON c.click_id=l.click_id JOIN ravenos_affiliate_enrollments a ON a.user_id=c.referrer_user_id
    WHERE l.auth_state_hash=? AND c.expires_at>? AND c.first_click_at<=? AND a.state='active' AND c.referrer_user_id!=?
    AND NOT EXISTS(SELECT 1 FROM ravenos_referral_conversion_windows w WHERE w.click_id=c.click_id)`;
  return [
    db.prepare(`INSERT OR IGNORE INTO ravenos_referral_attributions (attribution_id,referred_user_id,referrer_user_id,referral_code_snapshot,attribution_method,attribution_digest,attributed_at)
      SELECT ?,?,c.referrer_user_id,c.referral_code,'authenticated_claim',?,? ${match}`)
      .bind(relationship,user,digest(`${relationship}:${stateHash}`),now,stateHash,now,now,user),
    db.prepare(`INSERT OR IGNORE INTO ravenos_referral_conversion_windows (attribution_id,click_id,first_click_at,signup_at,attribution_expires_at)
      SELECT ?,c.click_id,c.first_click_at,?,c.expires_at ${match} AND EXISTS(SELECT 1 FROM ravenos_referral_attributions r WHERE r.attribution_id=? AND r.referred_user_id=?)`)
      .bind(relationship,now,stateHash,now,now,user,relationship,user),
    db.prepare(`INSERT OR IGNORE INTO ravenos_product_events (event_id,user_id,event_type,source_reference,occurred_at,details_json) SELECT ?,?,'referral_signup',?,?,'{}' WHERE EXISTS(SELECT 1 FROM ravenos_referral_conversion_windows WHERE attribution_id=?)`)
      .bind(`pe_${digest(`referral_signup:${relationship}`)}`,user,relationship,now,relationship),
  ];
}
const SUM_FIELDS=["earned","pending","available","paid","recoverable"];
export async function affiliateBalance(db,user) {
  const row=await db.prepare(`SELECT ${SUM_FIELDS.map(k=>`CAST(COALESCE(SUM(${k}_delta),0) AS TEXT) ${k}`).join(",")} FROM ravenos_affiliate_commission_ledger WHERE affiliate_user_id=?`).bind(user).first();
  return Object.fromEntries(SUM_FIELDS.map(k=>[`${k}_cents`,String(row?.[k]||"0")]));
}
export async function affiliateDashboard(env,user,{now=nowSeconds()}={}) {
  const db=env.RAVENOS_CUSTOMER_DB,policy=affiliatePolicy(env);
  const account=await createD1CustomerReferralStore(db).getDashboard(user);
  const enrollment=await db.prepare("SELECT state,terms_version,terms_hash,accepted_at,public_profile_cta FROM ravenos_affiliate_enrollments WHERE user_id=?").bind(user).first();
  const alias=await db.prepare("SELECT alias FROM ravenos_referral_aliases WHERE user_id=? ORDER BY created_at,alias LIMIT 1").bind(user).first();
  const balance=await affiliateBalance(db,user);
  const metrics=await db.prepare(`SELECT
    (SELECT COUNT(*) FROM ravenos_referral_clicks WHERE referrer_user_id=?) clicks,
    COUNT(*) accounts_created,
    COALESCE(SUM(CASE WHEN t.trial_status='ACTIVE' AND t.trial_ends_at>? THEN 1 ELSE 0 END),0) active_trials,
    COALESCE(SUM(CASE WHEN w.paid_conversion_at IS NOT NULL THEN 1 ELSE 0 END),0) paid_conversions,
    COALESCE(SUM(CASE WHEN s.paid_history=1 AND s.status IN ('active','past_due') AND s.period_end>? THEN 1 ELSE 0 END),0) active_referred_pro
    FROM ravenos_referral_attributions r LEFT JOIN ravenos_referral_conversion_windows w USING(attribution_id) LEFT JOIN ravenos_pro_trials t ON t.user_id=r.referred_user_id LEFT JOIN ravenos_pro_subscriptions s ON s.user_id=r.referred_user_id WHERE r.referrer_user_id=?`).bind(user,now,now,user).first();
  const events=await db.prepare("SELECT status,CAST(qualifying_revenue_cents AS TEXT) qualifying_revenue_cents,commission_percent,CAST(amount_cents AS TEXT) amount_cents,created_at FROM ravenos_affiliate_commission_ledger WHERE affiliate_user_id=? ORDER BY created_at DESC,entry_id DESC LIMIT 40").bind(user).all();
  const active=enrollment?.state==="active"&&account.referral_code;
  return {state:active?"active":"not_enrolled",referral_code:active?account.referral_code:null,referral_url:active?`https://ravenos.xyz/r/${alias?.alias||account.referral_code}`:null,stable_referral_url:active?`https://ravenos.xyz/r/${account.referral_code}`:null,policy,disclosure:AFFILIATE_DISCLOSURE,enrollment,balance,metrics,events:events.results||[],payout_state:policy.flags.payouts?"manual_review":"not_enabled",boundaries:{subscription_revenue_only:true,private_referred_trading_data_visible:false,no_extra_trial_time:true},attribution:account.attribution_id?{state:"recorded",attributed_at:account.attributed_at}:null};
}
export function commissionCents(qualifyingRevenue,rate=affiliatePolicy().commission_percent) {
  if(typeof qualifyingRevenue!=="string"||!/^\d{1,12}$/.test(qualifyingRevenue)||!Number.isInteger(rate)||rate<0||rate>100)throw new RewardError("affiliate_money_invalid");
  return (BigInt(qualifyingRevenue)*BigInt(rate)/100n).toString();
}
export function addUtcMonths(seconds,months) {
  if(!Number.isSafeInteger(seconds)||!Number.isInteger(months)||months<1||months>120)throw new RewardError("commission_window_invalid");
  const date=new Date(seconds*1000),day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+months);
  const end=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();date.setUTCDate(Math.min(day,end));return Math.floor(date.getTime()/1000);
}

function commissionEntry(db,{affiliate,referred,attribution,subscription,invoice,revenue,rate,amount,status,delta={},evidence={},key,now,expected_earned=null}) {
  const values=[`acl_${digest(key)}`,affiliate,referred,attribution,subscription,invoice,revenue,rate,amount,status,...SUM_FIELDS.map(k=>String(delta[k]||0)),now,JSON.stringify(evidence),key];
  return db.prepare(`INSERT OR IGNORE INTO ravenos_affiliate_commission_ledger (entry_id,affiliate_user_id,referred_user_id,attribution_id,subscription_id,invoice_id,qualifying_revenue_cents,commission_percent,amount_cents,status,${SUM_FIELDS.map(k=>`${k}_delta`).join(",")},created_at,evidence_json,idempotency_key) SELECT ${values.map(()=>"?").join(",")} WHERE (? IS NULL OR CAST(COALESCE((SELECT SUM(earned_delta) FROM ravenos_affiliate_commission_ledger WHERE invoice_id=?),0) AS TEXT)=?)`).bind(...values,expected_earned,invoice,expected_earned);
}
export async function reconcileAffiliateInvoice(env,invoiceId,{source_reference,now=nowSeconds()}={}) {
  const db=env.RAVENOS_CUSTOMER_DB,policy=affiliatePolicy(env);
  const invoice=await db.prepare("SELECT * FROM ravenos_pro_invoices WHERE invoice_id=?").bind(invoiceId).first();
  if(!invoice||invoice.currency!=="usd"||invoice.status!=="paid"||!invoice.payment_evidence_json)return {state:"no_verified_paid_subscription"};
  const proof=JSON.parse(invoice.payment_evidence_json);
  if(proof.verified!==true||proof.invoice_id!==invoiceId||proof.external_paid_cents!==invoice.external_paid_cents||!Number.isSafeInteger(invoice.paid_at))throw new RewardError("affiliate_subscription_evidence_invalid");
  const relationship=await db.prepare(`SELECT r.*,w.paid_conversion_at,w.commission_ends_at,w.attribution_expires_at,w.disqualification_reason,w.first_paid_invoice_id,a.state affiliate_state
    FROM ravenos_referral_attributions r JOIN ravenos_referral_conversion_windows w USING(attribution_id) JOIN ravenos_affiliate_enrollments a ON a.user_id=r.referrer_user_id WHERE r.referred_user_id=?`).bind(invoice.user_id).first();
  if(!relationship)return {state:"no_attribution"};
  const original=await db.prepare("SELECT * FROM ravenos_affiliate_commission_ledger WHERE invoice_id=? AND status='EARNED' ORDER BY created_at,entry_id LIMIT 1").bind(invoiceId).first();
  const totals=await db.prepare(`SELECT ${SUM_FIELDS.map(k=>`CAST(COALESCE(SUM(${k}_delta),0) AS TEXT) ${k}`).join(",")} FROM ravenos_affiliate_commission_ledger WHERE invoice_id=?`).bind(invoiceId).first();
  const rate=original?.commission_percent??policy.commission_percent;
  const desired=BigInt(commissionCents(String(invoice.external_paid_cents),rate));
  const prior=BigInt(totals.earned);
  // Reversals remain active even when new commission issuance is paused.
  if(!original&&(!policy.flags.commissions||relationship.affiliate_state!=="active"||relationship.disqualification_reason))return {state:"commission_not_eligible"};
  let conversion=relationship.paid_conversion_at,ends=relationship.commission_ends_at;
  if(!conversion) {
    if(invoice.external_paid_cents===0)return {state:"zero_qualifying_revenue"};
    if(invoice.paid_at>=relationship.attribution_expires_at)return {state:"attribution_expired"};
    conversion=invoice.paid_at;ends=addUtcMonths(conversion,policy.commission_months);
    await db.prepare(`UPDATE ravenos_referral_conversion_windows SET paid_conversion_at=?,commission_ends_at=?,first_paid_invoice_id=? WHERE attribution_id=? AND paid_conversion_at IS NULL AND disqualification_reason IS NULL`).bind(conversion,ends,invoiceId,relationship.attribution_id).run();
    const actual=await db.prepare("SELECT paid_conversion_at,commission_ends_at FROM ravenos_referral_conversion_windows WHERE attribution_id=?").bind(relationship.attribution_id).first();
    conversion=actual.paid_conversion_at;ends=actual.commission_ends_at;
  }
  if(conversion)await productEvent(db,relationship.referred_user_id,"referral_paid_conversion",relationship.attribution_id,{commission_window_start:conversion,commission_window_end:ends},conversion).run();
  // Any positive qualifying payment starts the original window, even when
  // its commission rounds down to zero cents. Rewards-only invoices do not.
  if(desired===prior)return {state:desired===0n?(invoice.external_paid_cents===0?"zero_qualifying_revenue":"commission_below_cent"):"already_reconciled"};
  // Past earned invoices can always reconcile refunds. New invoices must
  // fall in the original window; cancellation never resets it.
  if(!original&&(invoice.paid_at<conversion||invoice.paid_at>=ends||invoice.period_start>=ends))return {state:"commission_window_ended"};
  const amount=desired>prior?desired-prior:prior-desired;
  const key=`commission:${invoiceId}:${source_reference||proof.source_reference||digest(invoice.payment_evidence_json)}:${desired}`;
  const base={affiliate:relationship.referrer_user_id,referred:relationship.referred_user_id,attribution:relationship.attribution_id,subscription:invoice.stripe_subscription_id,invoice:invoiceId,revenue:String(invoice.external_paid_cents),rate,amount:amount.toString(),key,now,expected_earned:prior.toString()};
  const statements=[];
  const eventPredicate="EXISTS (SELECT 1 FROM ravenos_affiliate_commission_ledger WHERE idempotency_key=?)";
  if(desired>prior) {
    if(!policy.flags.commissions||relationship.affiliate_state!=="active"||relationship.disqualification_reason)return {state:"new_commissions_paused"};
    const balance=await affiliateBalance(db,relationship.referrer_user_id);
    const recoverable=BigInt(balance.recoverable_cents),offset=recoverable<amount?recoverable:amount;
    statements.push(commissionEntry(db,{...base,status:"EARNED",delta:{earned:amount,pending:amount-offset,recoverable:-offset},evidence:{basis:policy.revenue_basis,invoice_id:invoiceId,reward_credit_cents:invoice.reward_credit_cents,commission_window_start:conversion,commission_window_end:ends,recoverable_offset_cents:offset.toString(),source_reference}}));
    statements.push(productEvent(db,relationship.referrer_user_id,"affiliate_commission_earned",key,{amount_cents:amount.toString()},now,eventPredicate,[key]));
    statements.push(productEvent(db,relationship.referred_user_id,"referral_paid_conversion",relationship.attribution_id,{commission_window_start:conversion,commission_window_end:ends},conversion,eventPredicate,[key]));
  } else {
    const pending=BigInt(totals.pending),available=BigInt(totals.available);
    const pendingDebit=pending<amount?pending:amount;
    const remaining=amount-pendingDebit,availableDebit=available<remaining?available:remaining;
    const deficit=remaining-availableDebit;
    statements.push(commissionEntry(db,{...base,status:proof.disputed?"DISPUTED":"REVERSED",delta:{earned:-amount,pending:-pendingDebit,available:-availableDebit,recoverable:deficit},evidence:{reason:proof.disputed?"MANUAL_REVIEW":"REFUNDED_PAYMENT",source_reference,outstanding_recoverable_cents:deficit.toString()}}));
    statements.push(productEvent(db,relationship.referrer_user_id,"affiliate_commission_reversed",key,{amount_cents:amount.toString(),recoverable_cents:deficit.toString()},now,eventPredicate,[key]));
  }
  await db.batch(statements);
  const reconciled=await db.prepare("SELECT CAST(COALESCE(SUM(earned_delta),0) AS TEXT) n FROM ravenos_affiliate_commission_ledger WHERE invoice_id=?").bind(invoiceId).first();
  if(BigInt(reconciled.n)!==desired)throw new RewardError("affiliate_reconciliation_retry",503);
  return {state:desired>prior?"commission_earned":"commission_reversed",commission_cents:desired.toString(),qualifying_revenue_cents:String(invoice.external_paid_cents)};
}

export async function recordAffiliateManualAction(db,{invoice_id,action,amount_cents,reference,operator_user_id,now=nowSeconds()}) {
  // Operational record only: this function neither sends money nor selects a
  // payout provider. A PAID record requires the operator's payment evidence.
  if(!["approve","paid"].includes(action)||!/^\d{1,12}$/.test(String(amount_cents))||BigInt(amount_cents)<=0n||typeof reference!=="string"||reference.length<8||reference.length>180||!operator_user_id)throw new RewardError("affiliate_manual_action_invalid");
  const original=await db.prepare("SELECT * FROM ravenos_affiliate_commission_ledger WHERE invoice_id=? AND status='EARNED' ORDER BY created_at,entry_id LIMIT 1").bind(invoice_id).first();
  if(!original)throw new RewardError("affiliate_commission_not_found",404);
  const available=await db.prepare(`SELECT CAST(COALESCE(SUM(${action==="approve"?"pending":"available"}_delta),0) AS TEXT) n FROM ravenos_affiliate_commission_ledger WHERE invoice_id=?`).bind(invoice_id).first();
  const key=`affiliate_${action}:${invoice_id}:${reference}`;
  const previous=await db.prepare("SELECT amount_cents FROM ravenos_affiliate_commission_ledger WHERE idempotency_key=?").bind(key).first();
  if(previous){if(String(previous.amount_cents)!==String(amount_cents))throw new RewardError("affiliate_idempotency_conflict");return {state:"already_recorded"};}
  const amount=BigInt(amount_cents);
  if(amount>BigInt(available.n))throw new RewardError("affiliate_balance_insufficient");
  await commissionEntry(db,{affiliate:original.affiliate_user_id,referred:original.referred_user_id,attribution:original.attribution_id,subscription:original.subscription_id,invoice:invoice_id,revenue:String(original.qualifying_revenue_cents),rate:original.commission_percent,amount:amount.toString(),status:action==="approve"?"APPROVED":"PAID",delta:action==="approve"?{pending:-amount,available:amount}:{available:-amount,paid:amount},evidence:{reference,operator_user_id,manual_record_only:true},key,now}).run();
  return {state:action==="approve"?"approved":"paid_recorded"};
}
export async function recordReferralTrialEvents(db,user,trialState,now=nowSeconds()) {
  const attribution=await db.prepare("SELECT attribution_id FROM ravenos_referral_attributions WHERE referred_user_id=?").bind(user).first();
  if(attribution)await productEvent(db,user,trialState==="ACTIVE"?"referral_trial_started":"referral_trial_expired",attribution.attribution_id,{},now).run();
}

export async function publicAffiliateProfileCta(env,user) {
 const policy=affiliatePolicy(env);
 if(!policy.flags.referrals||!policy.flags.public_profile_cta||!productFlags(env).trials)return null;
 const row=await env.RAVENOS_CUSTOMER_DB.prepare("SELECT c.referral_code,u.username FROM ravenos_affiliate_enrollments a JOIN ravenos_referral_codes c ON c.user_id=a.user_id JOIN ravenos_users u ON u.user_id=a.user_id WHERE a.user_id=? AND a.state='active' AND a.public_profile_cta=1 AND c.state='active' AND u.state='active'").bind(user).first();
 return row ? {url:`https://ravenos.xyz/r/${row.referral_code}`,trial_days:RAVEN_PRO_TRIAL_DAYS,disclosure:`Referral link — @${row.username} may earn a commission if you later subscribe.`} : null;
}
export async function setAffiliateProfileCta(env,user,enabled) {
 if(typeof enabled!=="boolean")throw new RewardError("affiliate_profile_preference_invalid",400);
 if(enabled&&!affiliatePolicy(env).flags.public_profile_cta)throw new RewardError("affiliate_profile_cta_unavailable",503);
 const result=await env.RAVENOS_CUSTOMER_DB.prepare("UPDATE ravenos_affiliate_enrollments SET public_profile_cta=? WHERE user_id=? AND state='active'").bind(enabled?1:0,user).run();
 if(!result.meta?.changes)throw new RewardError("affiliate_enrollment_required",403);
 return {public_profile_cta:enabled};
}
