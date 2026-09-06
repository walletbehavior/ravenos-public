import { createHash } from "node:crypto";
import { RewardError } from "./customer_rewards.mjs";
import { affiliatePolicy } from "./customer_product.mjs";
import { recordAffiliateManualAction } from "./customer_referral_growth.mjs";
const hash=value=>createHash("sha256").update(value).digest("hex");
export const AFFILIATE_REVIEW_REASONS=Object.freeze(["SELF_REFERRAL","DUPLICATE_ATTRIBUTION","REFUNDED_PAYMENT","FAILED_PAYMENT","FRAUDULENT_ACCOUNT","TERMS_VIOLATION","MANUAL_REVIEW"]);
export function financeOperatorEnabled(env,user) {
 return env.RAVENOS_FINANCE_OPERATIONS_ENABLED==="1"&&String(env.RAVENOS_FINANCE_OPERATOR_USER_IDS||"").split(",").map(s=>s.trim()).filter(id=>/^usr_[a-f0-9]{32}$/.test(id)).includes(user);
}
export function requireFinanceOperator(env,principal,now) {
 if(!financeOperatorEnabled(env,principal.user_id))throw new RewardError("finance_operator_required",403);
 if(!Number.isSafeInteger(principal.authenticated_at)||principal.authenticated_at>now+60||now-principal.authenticated_at>900)throw new RewardError("finance_recent_login_required",401);
}
const moneyColumns=fields=>fields.map(([name,column])=>`CAST(COALESCE(SUM(${column}),0) AS TEXT) ${name}`).join(",");
export async function financeReport(db,{start,end,period="day"}) {
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end-start>366*86400||!["day","week","month"].includes(period))throw new RewardError("finance_report_window_invalid",400);
 const bucket=column=>period==="day"?`strftime('%Y-%m-%d',${column},'unixepoch')`:period==="month"?`strftime('%Y-%m',${column},'unixepoch')`:`date(${column},'unixepoch','-6 days','weekday 1')`;
 const fees=await db.prepare(`SELECT ${bucket("r.confirmed_at")} period,c.chain,c.trade_type,c.entitlement_source,
  COUNT(*) confirmed_fee_events,COUNT(r.amount_usdc_micros) valued_fee_events,
  CAST(COALESCE(SUM(r.amount_usdc_micros),0) AS TEXT) gross_collected_micros,
  CAST(COALESCE(SUM(r.customer_fee_usdc_micros),0) AS TEXT) customer_execution_fees_micros,
  CAST(COALESCE(SUM(r.provider_share_usdc_micros),0) AS TEXT) provider_share_micros
  FROM ravenos_reward_fee_receipts r JOIN ravenos_execution_reward_context c USING(execution_id)
  WHERE r.confirmed_at>=? AND r.confirmed_at<? GROUP BY 1,2,3,4 ORDER BY 1,2,3,4`).bind(start,end).all();
 const accrual=await db.prepare(`SELECT ${bucket("l.created_at")} period,c.chain,c.trade_type,c.entitlement_source,
  ${moneyColumns([["cashback_accrued_micros","l.earned_delta"],["pending_change_micros","l.pending_delta"]])}
  FROM ravenos_reward_ledger l JOIN ravenos_execution_reward_context c ON c.execution_id=l.source_trade_id
  WHERE l.created_at>=? AND l.created_at<? GROUP BY 1,2,3,4 ORDER BY 1,2,3,4`).bind(start,end).all();
 const refunds=await db.prepare(`SELECT ${bucket("a.created_at")} period,r.chain,c.trade_type,c.entitlement_source,CAST(COALESCE(SUM(a.reversed_fee_micros),0) AS TEXT) reversed_fee_micros
  FROM ravenos_reward_fee_adjustments a JOIN ravenos_reward_fee_receipts r USING(fee_event_id) JOIN ravenos_execution_reward_context c USING(execution_id)
  WHERE a.created_at>=? AND a.created_at<? GROUP BY 1,2,3,4`).bind(start,end).all();
 const groups=new Map();
 for(const [rows,type] of [[fees.results,"fees"],[accrual.results,"cashback"],[refunds.results,"refunds"]])for(const row of rows||[]) {
  const key=[row.period,row.chain,row.trade_type,row.entitlement_source].join(":");
  const current=groups.get(key)||{period:row.period,chain:row.chain,trade_type:row.trade_type,entitlement_source:row.entitlement_source,gross_collected_micros:"0",customer_execution_fees_micros:"0",provider_share_micros:"0",cashback_accrued_micros:"0",reversed_fee_micros:"0",pending_change_micros:"0",confirmed_fee_events:0,valued_fee_events:0};
  groups.set(key,{...current,...row});
 }
 const bySource=[...groups.values()].map(row=>({...row,net_execution_revenue_micros:(BigInt(row.gross_collected_micros)-BigInt(row.reversed_fee_micros)-BigInt(row.cashback_accrued_micros)).toString()}));
 const liability=await db.prepare(`SELECT ${moneyColumns([["available_micros","available_delta"],["reserved_micros","reserved_delta"],["pending_micros","pending_delta"],["outstanding_liability_micros","liability_delta"],["cashback_net_earned_micros","earned_delta"],["claimed_micros","claimed_delta"],["applied_to_pro_micros","applied_delta"],["outstanding_adjustment_micros","adjustment_delta"]])} FROM ravenos_reward_ledger WHERE created_at<?`).bind(end).first();
 const movements=await db.prepare(`SELECT ${bucket("l.created_at")} period,o.kind,COALESCE(json_extract(o.destination_json,'$.chain'),'stripe_invoice_credit') destination,
  ${moneyColumns([["claimed_micros","l.claimed_delta"],["applied_micros","l.applied_delta"]])} FROM ravenos_reward_ledger l JOIN ravenos_reward_operations o USING(operation_id) WHERE l.created_at>=? AND l.created_at<? GROUP BY 1,2,3 ORDER BY 1,2,3`).bind(start,end).all();
 const affiliate=await db.prepare(`SELECT ${bucket("created_at")} period,${moneyColumns([["earned_cents","earned_delta"],["pending_change_cents","pending_delta"],["available_change_cents","available_delta"],["paid_cents","paid_delta"],["recoverable_change_cents","recoverable_delta"]])} FROM ravenos_affiliate_commission_ledger WHERE created_at>=? AND created_at<? GROUP BY 1 ORDER BY 1`).bind(start,end).all();
 const events=await db.prepare("SELECT event_type,COUNT(*) count FROM ravenos_product_events WHERE occurred_at>=? AND occurred_at<? GROUP BY event_type").bind(start,end).all();
 const billing=await db.prepare(`SELECT COUNT(*) invoices,COALESCE(SUM(CASE WHEN reward_credit_cents>0 AND external_paid_cents>0 THEN 1 ELSE 0 END),0) partially_reward_funded,COALESCE(SUM(CASE WHEN reward_credit_cents>0 AND external_paid_cents=0 THEN 1 ELSE 0 END),0) fully_reward_funded,CAST(COALESCE(SUM(external_paid_cents),0) AS TEXT) net_external_revenue_cents FROM ravenos_pro_invoices WHERE paid_at>=? AND paid_at<?`).bind(start,end).first();
 return {schema_version:"ravenos.finance_operations.v1",window:{start,end,period},execution_by_source:bySource,reward_balances_as_of_end:liability,reward_movements_by_destination:movements.results||[],affiliate_by_period:affiliate.results||[],subscription_invoices:billing,product_events:events.results||[],boundaries:{micro_usdc_integer:true,affiliate_unit:"usd_cents",pending_is_unearned:true,collector_balances_not_pooled_by_report:true,source_chain_is_revenue_origin_not_claim_network:true,unvalued_receipts_excluded_from_usdc_totals:true,liability_by_source_chain:"not_allocated_until_treasury_funding_policy_is_configured",treasury_solvency_proven:false}};
}
export async function reviewAffiliateAttribution(env,principal,{attribution_id,reason,reference},now) {
 requireFinanceOperator(env,principal,now);
 if(!AFFILIATE_REVIEW_REASONS.includes(reason)||!/^rat_[a-f0-9]{20,64}$/.test(attribution_id)||typeof reference!=="string"||reference.length<8||reference.length>180)throw new RewardError("affiliate_review_invalid",400);
 const db=env.RAVENOS_CUSTOMER_DB;
 const row=await db.prepare("SELECT * FROM ravenos_referral_conversion_windows WHERE attribution_id=?").bind(attribution_id).first();
 if(!row)throw new RewardError("attribution_not_found",404);
 const key=hash(`${attribution_id}:${reference}`);
 const previous=await db.prepare("SELECT reason FROM ravenos_affiliate_review_events WHERE review_id=?").bind(key).first();
 if(previous&&previous.reason!==reason)throw new RewardError("affiliate_review_idempotency_conflict");
 await db.batch([
  db.prepare("INSERT OR IGNORE INTO ravenos_affiliate_review_events(review_id,attribution_id,operator_user_id,reason,reference,created_at) VALUES (?,?,?,?,?,?)").bind(key,attribution_id,principal.user_id,reason,reference,now),
  db.prepare("UPDATE ravenos_referral_conversion_windows SET disqualification_reason=? WHERE attribution_id=?").bind(reason,attribution_id)
 ]);
 return {state:"future_commissions_disqualified",reason,existing_commissions:"retained_pending_payment_reconciliation"};
}
export async function manualAffiliatePayoutRecord(env,principal,input,now) {
 requireFinanceOperator(env,principal,now);
 if(input.action==="paid"&&!affiliatePolicy(env).flags.payouts)throw new RewardError("affiliate_payout_records_disabled",503);
 return recordAffiliateManualAction(env.RAVENOS_CUSTOMER_DB,{...input,operator_user_id:principal.user_id,now});
}
