import { financeOperatorEnabled, requireFinanceOperator, financeReport, reviewAffiliateAttribution, manualAffiliatePayoutRecord } from "./customer_finance_operations.mjs";
import { authorizeCustomerApiRequest, consumeCustomerRateLimit } from "./customer_identity.mjs";
import { CustomerLegalDocuments } from "./customer_legal_registry.mjs";
import { requireCustomerLegalCapability } from "./customer_legal.mjs";
import { parseBoundedJsonBody, boundedJsonResponse } from "./customer_trade/terminal_runtime.mjs";
import { publicProductPolicy, productFlags } from "./customer_product.mjs";
import { readProductAccess, ensureProTrial, expireProTrials } from "./customer_pro.mjs";
import { rewardBalance, RewardError, setAutoApply, CANONICAL_REWARD_ASSETS } from "./customer_rewards.mjs";
import { createRewardWalletChallenge, verifyRewardWalletChallenge, rewardClaimPolicy, requestCashbackClaim, prepareCashbackClaim } from "./customer_reward_claims.mjs";
import { continueWithPro, applyRewardsToPro, proBillingPortal, verifyProStripeSignature, processAccountStripeEvent } from "./customer_pro_billing.mjs";
import { subscriptionConfig } from "./ravenos_subscriptions.mjs";
const prefix="/api/v1/pro";
const json=(body,status=200,headers=null)=>boundedJsonResponse(body,{status,headers:{...Object.fromEntries(headers instanceof Headers?headers:[]),"cache-control":"private, no-store","x-content-type-options":"nosniff",vary:"Cookie, Origin"}},{max_bytes:96*1024,terminal_security:true});
const exact=(body,keys)=>{if(!body||Array.isArray(body)||typeof body!=="object"||Object.keys(body).some(k=>!keys.includes(k)))throw new RewardError("product_request_invalid",400);return body;};
async function stripeWebhookBody(request) {
  const limit=262144;
  if(Number(request.headers.get("content-length")||0)>limit)throw new RewardError("stripe_event_too_large",413);
  if(!request.body)return "";
  const reader=request.body.getReader(),chunks=[];
  let length=0;
  try {
    while(true) {
      const {done,value}=await reader.read();
      if(done)break;
      length+=value.byteLength;
      if(length>limit){await reader.cancel();throw new RewardError("stripe_event_too_large",413);}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  const bytes=new Uint8Array(length);
  let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return new TextDecoder("utf-8",{fatal:true}).decode(bytes);
}
export async function productAccountSummary(env,user,{now=Math.floor(Date.now()/1000)}={}) {
  const db=env.RAVENOS_CUSTOMER_DB;
  const [access,balance,prefs,history,wallets,invoices]=await Promise.all([
    readProductAccess(db,user,{now}),rewardBalance(db,user),
    db.prepare("SELECT auto_apply FROM ravenos_reward_preferences WHERE user_id=?").bind(user).first(),
    db.prepare("SELECT entry_id,source_type,status,CAST(amount_micros AS TEXT) amount_micros,created_at,source_trade_id FROM ravenos_reward_ledger WHERE user_id=? ORDER BY created_at DESC,entry_id DESC LIMIT 30").bind(user).all(),
    db.prepare("SELECT w.wallet_record_id,w.ecosystem,w.public_address FROM ravenos_privy_wallets w JOIN ravenos_user_privy_identities p ON p.raven_user_id=w.raven_user_id AND p.privy_user_id=w.privy_user_id WHERE w.raven_user_id=? AND w.state='active' AND p.state='active' AND w.last_verified_at>=?").bind(user,now-86400).all(),
    db.prepare("SELECT invoice_id,gross_cents,reward_credit_cents,external_paid_cents,status,period_start,period_end FROM ravenos_pro_invoices WHERE user_id=? ORDER BY period_end DESC LIMIT 12").bind(user).all(),
  ]);
  const flags=productFlags(env);
  const networks=Object.keys(CANONICAL_REWARD_ASSETS).flatMap(chain=>{try{return [rewardClaimPolicy(env,chain)];}catch{return [];}}).map(({treasury_wallet,...p})=>p);
  const unvalued=await db.prepare("SELECT COUNT(*) n FROM ravenos_reward_fee_receipts WHERE user_id=? AND amount_usdc_micros IS NULL").bind(user).first();
  const recent=await db.prepare("SELECT CAST(COALESCE(SUM(earned_delta),0) AS TEXT) amount FROM ravenos_reward_ledger WHERE user_id=? AND created_at>=?").bind(user,now-30*86400).first();
  return {policy:publicProductPolicy(),flags,access,finance_operator:financeOperatorEnabled(env,user),trial_can_request:flags.trials&&env.RAVENOS_PRO_TRIAL_EXISTING_USERS==="opt_in"&&!access.trial&&!access.pro&&!access.subscription,rewards:{...balance,auto_apply:prefs?.auto_apply===1,history:history.results||[],networks,wallets:wallets.results||[],unvalued_fee_count:unvalued.n,recent_earned_micros:recent.amount,terms_url:CustomerLegalDocuments.find(document=>document.document_type==="terms").canonical_path+"#raven-rewards",claims_ready:flags.claims&&networks.length>0&&Boolean(env.RAVENOS_REWARDS_TREASURY?.fetch)},invoices:invoices.results||[]};
}
export async function routeCustomerProduct(request,env={},deps={}) {
  const path=new URL(request.url).pathname;
  if(path!==prefix&&!path.startsWith(`${prefix}/`))return null;
  if(path===`${prefix}/product`&&request.method==="GET")return json({ok:true,policy:publicProductPolicy(),flags:productFlags(env)});
  if(path===`${prefix}/stripe/webhook`) {
    if(request.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
    if(!productFlags(env).billing)return json({ok:false,error:"pro_billing_unavailable"},503);
    try {
      const event=verifyProStripeSignature(await stripeWebhookBody(request),request.headers.get("stripe-signature"),subscriptionConfig(env).webhookSecret,Math.floor((deps.nowMs??Date.now())/1000));
      return json({ok:true,...await processAccountStripeEvent(env,event,deps.billing||{})});
    } catch(error){return json({ok:false,error:error instanceof RewardError?error.code:"stripe_webhook_unavailable"},error instanceof RewardError?error.status:503);}
  }
  const routes={ [`${prefix}/operations/report`]:"GET",[`${prefix}/operations/affiliate/review`]:"POST",[`${prefix}/operations/affiliate/payment-record`]:"POST",[prefix]:"GET",[`${prefix}/trial/start`]:"POST",[`${prefix}/checkout`]:"POST",[`${prefix}/portal`]:"POST",[`${prefix}/rewards/preference`]:"POST",[`${prefix}/rewards/apply`]:"POST",[`${prefix}/rewards/claim`]:"POST",[`${prefix}/rewards/claim/quote`]:"POST",[`${prefix}/rewards/wallet/challenge`]:"POST",[`${prefix}/rewards/wallet/verify`]:"POST" };
  if(!routes[path])return json({ok:false,error:"not_found"},404);
  if(request.method!==routes[path])return json({ok:false,error:"method_not_allowed"},405);
  let authorization;
  try {
    authorization=await (deps.authorizeRequest||authorizeCustomerApiRequest)(request,env,deps,{require_csrf:request.method!=="GET"});
    if(authorization.response)return authorization.response;
    const principal=authorization.principal,now=authorization.now,db=env.RAVENOS_CUSTOMER_DB;
    if(!db?.prepare)throw new RewardError("product_account_unavailable",503);
    if(path.startsWith(`${prefix}/operations/`)) requireFinanceOperator(env,principal,now);
    if(path===`${prefix}/operations/report`) {
      const query=new URL(request.url).searchParams;
      return json({ok:true,report:await financeReport(db,{start:Number(query.get("start")||now-30*86400),end:Number(query.get("end")||now+1),period:query.get("period")||"day"})},200,authorization.response_headers);
    }
    if(path===prefix) return json({ok:true,...await productAccountSummary(env,principal.user_id,{now})},200,authorization.response_headers);
    const limited=await (deps.rateLimit||consumeCustomerRateLimit)({store:authorization.store,env,request,action:"product_rewards_mutation",scope:"user",subject:principal.user_id,now,window_seconds:900,limit:30});
    if(!limited.allowed)throw new RewardError("product_rate_limited",429);
    const body=await parseBoundedJsonBody(request,{max_bytes:8192});
    if(path===`${prefix}/checkout`||path===`${prefix}/rewards/apply`||(path===`${prefix}/rewards/preference`&&body.auto_apply===true)) {
      const legal=await (deps.requireLegal||requireCustomerLegalCapability)(request,env,"pro_subscription",deps,{require_csrf:true});
      if(!legal.allowed)return legal.response;
    }
    let result;
    if(path===`${prefix}/operations/affiliate/review`) {exact(body,["attribution_id","reason","reference"]);result=await reviewAffiliateAttribution(env,principal,body,now);}
    else if(path===`${prefix}/operations/affiliate/payment-record`) {exact(body,["invoice_id","action","amount_cents","reference"]);result=await manualAffiliatePayoutRecord(env,principal,body,now);}
    else if(path===`${prefix}/trial/start`) {
      exact(body,[]);
      const account=await db.prepare(`SELECT u.*,u.created_at AS user_created_at,c.issuer,c.provider_subject,c.email_verified FROM ravenos_users u JOIN ravenos_credentials c ON c.user_id=u.user_id JOIN ravenos_sessions s ON s.credential_id=c.credential_id WHERE u.user_id=? AND s.session_public_id=?`).bind(principal.user_id,principal.session_public_id).first();
      if(!account)throw new RewardError("trial_identity_unavailable");
      result=await ensureProTrial(env,{...account,created:false},{issuer:account.issuer,provider_subject:account.provider_subject,email:account.primary_email,verified:account.email_verified===1},{db,now,explicit_request:true});
    } else if(path===`${prefix}/checkout`) {exact(body,["consent"]);result=await continueWithPro(env,principal.user_id,{consent:body.consent,now,...deps.billing});}
    else if(path===`${prefix}/portal`) {exact(body,[]);result=await proBillingPortal(env,principal.user_id,deps.billing);}
    else if(path===`${prefix}/rewards/preference`) {exact(body,["auto_apply"]);result=await setAutoApply(env,principal.user_id,body.auto_apply,now);}
    else if(path===`${prefix}/rewards/apply`) {exact(body,["amount_micros","idempotency_key"]);result=await applyRewardsToPro(env,principal.user_id,{...body,now,...deps.billing});}
    else if(path===`${prefix}/rewards/claim/quote`) {exact(body,["amount_micros","destination"]);const q=await prepareCashbackClaim(env,principal,body,{now,...deps.claims});result={destination:q.destination,...q.economics,expires_at:q.quote.expires_at};}
    else if(path===`${prefix}/rewards/claim`) {exact(body,["amount_micros","idempotency_key","destination"]);result=await requestCashbackClaim(env,principal,body,{now,...deps.claims});}
    else if(path===`${prefix}/rewards/wallet/challenge`) {exact(body,["chain","address"]);result=await createRewardWalletChallenge(db,principal,{...body,now});}
    else if(path===`${prefix}/rewards/wallet/verify`) {exact(body,["challenge_id","signature"]);result=await verifyRewardWalletChallenge(db,principal,{...body,now});}
    return json({ok:true,...result},path===`${prefix}/rewards/claim`?202:200,authorization.response_headers);
  }catch(error){return json({ok:false,error:error instanceof RewardError?error.code:"product_service_unavailable"},error instanceof RewardError?error.status:503,authorization?.response_headers);}
}
