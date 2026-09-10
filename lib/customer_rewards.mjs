import { createHash } from "node:crypto";
import { cashbackMicros, moneyMicros, productFlags, RAVEN_PRO_MONTHLY_PRICE_USD, RAVEN_STANDARD_EXECUTION_FEE_BPS, RAVEN_PRO_CASHBACK_PERCENT, RAVEN_CASHBACK_BASIS } from "./customer_product.mjs";
import { readProductAccess } from "./customer_pro.mjs";
import { BASE_EVM_CHAIN_PROFILE, ETHEREUM_EVM_CHAIN_PROFILE } from "./customer_trade/evm_chain_profiles.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const nowSeconds = () => Math.floor(Date.now() / 1000);
export class RewardError extends Error { constructor(code, status = 409) { super(code); this.code = code; this.status = status; } }
export const CANONICAL_REWARD_ASSETS = Object.freeze({
  solana: Object.freeze({ token: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, ecosystem: "solana" }),
  base: Object.freeze({ token: BASE_EVM_CHAIN_PROFILE.accounting_asset.address, decimals: 6, ecosystem: "evm" }),
  ethereum: Object.freeze({ token: ETHEREUM_EVM_CHAIN_PROFILE.accounting_asset.address, decimals: 6, ecosystem: "evm" }),
});
export function canonicalRewardAsset(chain, token) {
  const asset = CANONICAL_REWARD_ASSETS[chain];
  return asset && (chain === "solana" ? token === asset.token : String(token).toLowerCase() === asset.token) ? asset : null;
}
const DELTAS = ["available", "pending", "reserved", "liability", "earned", "claimed", "applied", "adjustment"];
export async function rewardBalance(db, userId) {
  const row = await db.prepare(`SELECT ${DELTAS.map((key) => `CAST(COALESCE(SUM(${key}_delta),0) AS TEXT) AS ${key}`).join(",")} FROM ravenos_reward_ledger WHERE user_id = ?`).bind(userId).first();
  return Object.fromEntries(DELTAS.map((key) => [`${key}_micros`, String(row?.[key] || "0")]));
}
export function productEvent(db, userId, type, source, details = {}, now = nowSeconds(), predicate = "1", bindings = []) {
  return db.prepare(`INSERT OR IGNORE INTO ravenos_product_events (event_id,user_id,event_type,source_reference,occurred_at,details_json) SELECT ?,?,?,?,?,? WHERE ${predicate}`)
    .bind(`pe_${hash(`${type}:${source}`)}`, userId, type, source, now, JSON.stringify(details), ...bindings);
}
// Only this module constructs monetary deltas. All public amounts are strings.
function entry(db, { user, type, trade = null, fee = null, operation = null, state, amount, delta = {}, evidence = {}, key, now = nowSeconds() }, predicate = "1", bindings = []) {
  const values = [ `rle_${hash(key)}`, user, type, trade, fee, operation, state, moneyMicros(amount).toString() ];
  const expressions = DELTAS.map(k => {
    const value = delta[k];
    if (value && typeof value === "object" && value.sql) { values.push(...value.bindings); return value.sql; }
    values.push(String(value || 0)); return "?";
  });
  values.push(now, JSON.stringify(evidence), key);
  return db.prepare(`INSERT OR IGNORE INTO ravenos_reward_ledger
    (entry_id,user_id,source_type,source_trade_id,source_fee_event_id,operation_id,status,amount_micros,${DELTAS.map((k) => `${k}_delta`).join(",")},created_at,evidence_json,idempotency_key)
    SELECT ?,?,?,?,?,?,?,?,${expressions.join(",")},?,?,? WHERE ${predicate}`).bind(...values, ...bindings);
}
const sourceType = (context) => context.trade_type === "copy" ? "COPY_TRADING_CASHBACK" : "TRADING_CASHBACK";

export async function captureExecutionRewards(env, executionId, userId, { now = nowSeconds(), access = null } = {}) {
  if (!productFlags(env).cashback) return { eligible: false, reason: "cashback_disabled" };
  const db = env.RAVENOS_CUSTOMER_DB;
  const intent = await db.prepare("SELECT * FROM ravenos_customer_live_execution_intents WHERE execution_id = ? AND user_id = ?").bind(executionId, userId).first();
  if (!intent || !["jupiter", "zero_x"].includes(intent.venue)) return { eligible: false, reason: "venue_excluded" };
  if (intent.raven_fee_bps !== RAVEN_STANDARD_EXECUTION_FEE_BPS || !intent.fee_token || !intent.fee_recipient) throw new RewardError("reward_fee_policy_mismatch");
  const entitlement = access || await readProductAccess(db, userId, { now });
  const canonical = canonicalRewardAsset(intent.chain_namespace, intent.fee_token);
  const prepared=JSON.parse(intent.prepared_json||"{}");
  const grossExpected=intent.venue==="jupiter"?prepared.fee?.gross_fee_amount_base_units:intent.expected_raven_fee_amount_base_units;
  const expected = canonical ? moneyMicros(grossExpected).toString() : null;
  // Copy routes remain manual-review execution today. Only a server-written
  // copy decision linkage may classify future automated execution as copy.
  const copyLink = await db.prepare("SELECT execution_id FROM ravenos_copy_execution_links WHERE execution_id = ? AND user_id = ?").bind(executionId, userId).first();
  await db.prepare(`INSERT OR IGNORE INTO ravenos_execution_reward_context
    (execution_id,user_id,chain,venue,trade_type,entitlement_source,eligible,fee_token,fee_recipient,authorized_fee_bps,expected_fee_micros,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(executionId, userId, intent.chain_namespace, intent.venue, copyLink ? "copy" : "manual", entitlement.source, entitlement.pro ? 1 : 0, intent.fee_token, intent.fee_recipient, intent.raven_fee_bps, expected, now).run();
  const context = await db.prepare("SELECT * FROM ravenos_execution_reward_context WHERE execution_id = ? AND user_id = ?").bind(executionId, userId).first();
  return { eligible: context.eligible === 1, percent: context.eligible ? RAVEN_PRO_CASHBACK_PERCENT : 0, estimated_micros: context.eligible && expected ? cashbackMicros(expected) : null, available_before_confirmation: false, valuation_required: !canonical };
}

export async function reconcileExecutionRewards(db, executionId, { now = nowSeconds() } = {}) {
  const context = await db.prepare("SELECT * FROM ravenos_execution_reward_context WHERE execution_id = ?").bind(executionId).first();
  if (!context) return { state: "not_enrolled" };
  const intent = await db.prepare("SELECT * FROM ravenos_customer_live_execution_intents WHERE execution_id = ? AND user_id = ?").bind(executionId, context.user_id).first();
  const events = await db.prepare("SELECT * FROM ravenos_customer_live_execution_events WHERE execution_id = ? ORDER BY observed_at DESC, rowid DESC LIMIT 12").bind(executionId).all();
  const accepted = (events.results || []).find((e) => e.state === "provider_confirmed");
  const observation = accepted ? JSON.parse(accepted.evidence_json) : null;
  const evidence = observation?.evidence;
  const feeEvidence = context.venue === "jupiter" ? evidence?.raven_fee : evidence?.fee_collection;
  const observed = context.venue === "jupiter" ? feeEvidence?.observed_collector_credit_base_units : feeEvidence?.observed_amount_base_units;
  const tx = context.venue === "jupiter" ? observation?.signature : observation?.transaction_hash;
  const finalized = context.venue === "jupiter" ? ["confirmed", "finalized"].includes(evidence?.confirmation_status) : evidence?.finalized === true;
  const feeVerified = context.venue === "jupiter" ? feeEvidence?.verified === true && feeEvidence?.fee_mint===context.fee_token && feeEvidence?.fee_bps===context.authorized_fee_bps && feeEvidence?.referral_account === context.fee_recipient : feeEvidence?.state === "observed" && feeEvidence?.token?.toLowerCase() === context.fee_token.toLowerCase();
  const prepared=JSON.parse(intent?.prepared_json||"{}");
  const customerFee=context.venue==="jupiter"?feeEvidence?.gross_fee_amount_base_units:observed;
  const grossVerified=context.venue!=="jupiter"||(evidence?.gross_raven_fee_verified===true&&/^[a-f0-9]{64}$/.test(prepared.transaction?.message_hash||"")&&evidence?.settled_message_hash===prepared.transaction?.message_hash&&customerFee===prepared.fee?.gross_fee_amount_base_units&&/^\d+$/.test(customerFee||"")&&/^\d+$/.test(observed||"")&&BigInt(customerFee)>=BigInt(observed));
  const matched = intent?.user_id === context.user_id && intent?.raven_fee_bps === context.authorized_fee_bps && intent?.fee_token === context.fee_token && intent?.fee_recipient === context.fee_recipient;
  const confirmed = matched && grossVerified && intent.state === "provider_confirmed" && intent.fee_collection_status === "observed" && observation?.state === "provider_confirmed" && evidence?.economic_result_verified === true && finalized && feeVerified && observed === intent.observed_raven_fee_amount_base_units && observed === intent.expected_raven_fee_amount_base_units && typeof tx === "string" && tx.length > 20 && (context.venue !== "zero_x" || tx === intent.transaction_hash);
  const pendingRow = await db.prepare("SELECT CAST(COALESCE(SUM(pending_delta),0) AS TEXT) AS n FROM ravenos_reward_ledger WHERE source_trade_id = ? AND user_id = ?").bind(executionId, context.user_id).first();
  const pending = BigInt(pendingRow.n);
  const pendingDebit = { sql: "-COALESCE((SELECT SUM(pending_delta) FROM ravenos_reward_ledger WHERE source_trade_id=? AND user_id=?),0)", bindings: [executionId,context.user_id] };
  const type = sourceType(context);
  if (!confirmed) {
    const failed = intent?.state === "provider_rejected" || intent?.fee_collection_status === "failed" || (intent?.state === "provider_confirmed" && (!matched || intent.fee_collection_status !== "observed"));
    if (failed && pending > 0n) await entry(db, { user: context.user_id, type, trade: executionId, state: "REVERSED", amount: pending, delta: { pending: pendingDebit }, key: `pending-cancel:${executionId}`, evidence: { reason: "fee_not_reconciled" }, now }).run();
    else if (!failed && context.eligible && context.expected_fee_micros && ["submission_pending", "client_reported", "reconciliation_pending", "indeterminate", "provider_confirmed"].includes(intent?.state)) {
      const amount = cashbackMicros(context.expected_fee_micros);
      await entry(db, { user: context.user_id, type, trade: executionId, state: "PENDING", amount, delta: { pending: amount }, key: `pending:${executionId}`, evidence: { basis: "estimate_not_earned" }, now }, "NOT EXISTS (SELECT 1 FROM ravenos_reward_ledger WHERE source_trade_id = ? AND status IN ('AVAILABLE','REVERSED'))", [executionId]).run();
    }
    return { state: failed ? "rejected" : "pending" };
  }
  const asset = canonicalRewardAsset(context.chain, context.fee_token);
  const feeAmount = asset ? moneyMicros(observed) : null;
  const customerFeeAmount=asset?moneyMicros(customerFee):null;
  const providerShare=asset?customerFeeAmount-feeAmount:null;
  const feeId = `rfe_${hash(`${context.chain}:${tx}:${context.fee_token}:${context.fee_recipient}`)}`;
  const statements = [db.prepare(`INSERT OR IGNORE INTO ravenos_reward_fee_receipts
    (fee_event_id,execution_id,user_id,chain,transaction_hash,fee_token,fee_recipient,amount_base_units,amount_usdc_micros,customer_fee_base_units,customer_fee_usdc_micros,provider_share_usdc_micros,evidence_json,confirmed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(feeId, executionId, context.user_id, context.chain, tx, context.fee_token, context.fee_recipient, observed, feeAmount?.toString() ?? null,customerFee,customerFeeAmount?.toString()??null,providerShare?.toString()??null, JSON.stringify({ execution_event_id: accepted.event_id, ...observation }), now)];
  if (!asset) { await db.batch(statements); return { state: "valuation_required" }; }
  if (context.eligible && feeAmount > 0n) {
    const amount = BigInt(cashbackMicros(customerFeeAmount));
    const offsetSql = "MIN(CAST(? AS INTEGER),COALESCE((SELECT SUM(adjustment_delta) FROM ravenos_reward_ledger WHERE user_id=?),0))";
    const availableDelta = {sql: `CAST(? AS INTEGER)-${offsetSql}`, bindings:[amount.toString(),amount.toString(),context.user_id]};
    const adjustmentDelta = {sql: `-${offsetSql}`, bindings:[amount.toString(),context.user_id]};
    const predicate = "EXISTS (SELECT 1 FROM ravenos_reward_fee_receipts WHERE fee_event_id = ? AND execution_id = ? AND user_id = ?)";
    const args = [feeId, executionId, context.user_id];
    statements.push(entry(db, { user: context.user_id, type, trade: executionId, fee: feeId, state: "AVAILABLE", amount, delta: { available: availableDelta, pending: pendingDebit, liability: availableDelta, earned: amount, adjustment: adjustmentDelta }, key: `earned:${feeId}`, evidence: { cashback_basis:RAVEN_CASHBACK_BASIS,gross_customer_fee_micros:customerFeeAmount.toString(),collector_receipt_micros:feeAmount.toString(),provider_share_micros:providerShare.toString(), rebate_percent: RAVEN_PRO_CASHBACK_PERCENT, adjustment_offset_basis: "outstanding_adjustment_at_atomic_credit", execution_event_id: accepted.event_id }, now }, predicate, args));
    for (const event of ["cashback_earned", "cashback_available"]) statements.push(db.prepare(`INSERT OR IGNORE INTO ravenos_product_events (event_id,user_id,event_type,source_reference,occurred_at,details_json) SELECT ?,?,?,?,?,? WHERE ${predicate}`).bind(`pe_${hash(`${event}:${feeId}`)}`, context.user_id, event, feeId, now, JSON.stringify({ amount_micros: amount.toString() }), ...args));
  }
  await db.batch(statements);
  const receipt = await db.prepare("SELECT execution_id FROM ravenos_reward_fee_receipts WHERE fee_event_id = ?").bind(feeId).first();
  if (receipt?.execution_id !== executionId) await entry(db, {user:context.user_id,type,trade:executionId,state:"REVERSED",amount:pending,delta:{pending:pendingDebit},key:`pending-cancel:${executionId}`,evidence:{reason:"duplicate_fee_receipt"},now}).run();
  return { state: receipt?.execution_id === executionId ? context.eligible ? "available" : "standard_no_cashback" : "duplicate_fee_receipt", earned_micros: receipt?.execution_id === executionId && context.eligible ? cashbackMicros(customerFeeAmount) : "0" };
}

export async function reserveRewards(db, { user_id: user, kind, amount_micros, idempotency_key: key, destination, extra_statements = [], now = nowSeconds() }) {
  if (!["claim", "subscription_credit"].includes(kind) || !/^[A-Za-z0-9_-]{16,100}$/.test(key || "")) throw new RewardError("reward_request_invalid", 400);
  const amount = moneyMicros(amount_micros);
  if (amount <= 0n) throw new RewardError("reward_amount_invalid", 400);
  if (kind === "subscription_credit" && (amount % 10000n !== 0n || amount > BigInt(RAVEN_PRO_MONTHLY_PRICE_USD) * 1000000n)) throw new RewardError("subscription_credit_amount_invalid");
  const requestDigest = hash(JSON.stringify({ kind, amount: amount.toString(), destination }));
  const existing = await db.prepare("SELECT * FROM ravenos_reward_operations WHERE user_id = ? AND idempotency_key = ?").bind(user, key).first();
  if (existing) { if (existing.request_digest !== requestDigest) throw new RewardError("reward_idempotency_conflict"); return { ...existing, amount_micros: String(existing.amount_micros) }; }
  const operation = `rop_${hash(`${user}:${key}`)}`;
  const balance = await rewardBalance(db, user);
  if (BigInt(balance.available_micros) < amount) throw new RewardError("reward_balance_insufficient");
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO ravenos_reward_operations (operation_id,user_id,kind,state,amount_micros,request_digest,idempotency_key,destination_json,created_at,updated_at) VALUES (?,?,?,'reserved',?,?,?,?,?,?)`)
      .bind(operation, user, kind, amount.toString(), requestDigest, key, JSON.stringify(destination), now, now),
    entry(db, { user, type: kind === "claim" ? "CLAIM" : "SUBSCRIPTION_APPLICATION", operation, state: "RESERVED", amount, delta: { available: -amount, reserved: amount }, key: `reserve:${operation}`, evidence: { destination }, now }),
    ...extra_statements,
  ]);
  return { operation_id: operation, user_id: user, kind, state: "reserved", amount_micros: amount.toString(), destination_json: JSON.stringify(destination) };
}

export async function finishRewardOperation(db, { operation_id: operation, user_id: user, outcome, external_reference: reference = null, evidence = {}, now = nowSeconds() }) {
  const record = await db.prepare("SELECT * FROM ravenos_reward_operations WHERE operation_id = ? AND user_id = ?").bind(operation, user).first();
  if (!record) throw new RewardError("reward_operation_not_found", 404);
  if (!["settled", "failed", "indeterminate"].includes(outcome)) throw new RewardError("reward_operation_outcome_invalid");
  if (["settled", "failed"].includes(record.state)) {
    if (record.state !== outcome || (outcome === "settled" && record.external_reference !== reference)) throw new RewardError("reward_operation_terminal");
    return { state: record.state, operation_id: operation };
  }
  if (outcome === "settled" && (typeof reference !== "string" || reference.length < 6 || reference.length > 200)) throw new RewardError("settlement_reference_required");
  const amount = BigInt(record.amount_micros);
  const claim = record.kind === "claim";
  const statements = [db.prepare("UPDATE ravenos_reward_operations SET state = ?, external_reference = ?, updated_at = ? WHERE operation_id = ? AND user_id = ? AND state IN ('reserved','processing','indeterminate')").bind(outcome, reference, now, operation, user)];
  if (outcome !== "indeterminate") statements.push(entry(db, { user, type: claim ? "CLAIM" : "SUBSCRIPTION_APPLICATION", operation, state: outcome === "failed" ? "RELEASED" : claim ? "CLAIMED" : "APPLIED_TO_SUBSCRIPTION", amount, delta: outcome === "failed" ? { available: amount, reserved: -amount } : { reserved: -amount, liability: -amount, [claim ? "claimed" : "applied"]: amount }, key: `finish:${operation}`, evidence: { ...evidence, external_reference: reference }, now }, "EXISTS (SELECT 1 FROM ravenos_reward_operations WHERE operation_id = ? AND state = ?)", [operation, outcome]));
  if (outcome === "settled") statements.push(productEvent(db, user, claim ? "cashback_claimed" : "cashback_applied_to_pro", operation, { amount_micros: amount.toString() }, now, "EXISTS (SELECT 1 FROM ravenos_reward_operations WHERE operation_id=? AND state='settled' AND external_reference=?)", [operation,reference]));
  await db.batch(statements);
  const final = await db.prepare("SELECT state,external_reference FROM ravenos_reward_operations WHERE operation_id=? AND user_id=?").bind(operation,user).first();
  if (final.state !== outcome || (outcome === "settled" && final.external_reference !== reference)) throw new RewardError("reward_operation_terminal");
  return { state: final.state, operation_id: operation };
}

export async function reverseCollectedFee(db, { fee_event_id: feeId, evidence, now = nowSeconds() }) {
  // Internal reconciliation only. A verified fee refund/reversal is required;
  // market losses and subscription cancellations never call this function.
  if (evidence?.verified_fee_refund !== true || !evidence?.reference) throw new RewardError("fee_refund_evidence_required");
  const receipt = await db.prepare("SELECT * FROM ravenos_reward_fee_receipts WHERE fee_event_id = ?").bind(feeId).first();
  if (!receipt?.amount_usdc_micros) throw new RewardError("valued_fee_receipt_required");
  const earned = await db.prepare("SELECT * FROM ravenos_reward_ledger WHERE source_fee_event_id = ? AND status = 'AVAILABLE'").bind(feeId).first();
  const amount = BigInt(earned?.amount_micros || 0);
  const recoveredSql = "MIN(CAST(? AS INTEGER),COALESCE((SELECT SUM(available_delta) FROM ravenos_reward_ledger WHERE user_id=?),0))";
  const recoveryBindings = [amount.toString(),receipt.user_id];
  const recoveredDebit = {sql:`-${recoveredSql}`,bindings:recoveryBindings};
  const outstandingDelta = {sql:`CAST(? AS INTEGER)-${recoveredSql}`,bindings:[amount.toString(),...recoveryBindings]};
  const statements = [db.prepare("INSERT OR IGNORE INTO ravenos_reward_fee_adjustments (adjustment_id,fee_event_id,reversed_fee_micros,evidence_json,created_at) VALUES (?,?,?,?,?)").bind(`rfa_${hash(feeId)}`, feeId, String(receipt.amount_usdc_micros), JSON.stringify(evidence), now)];
  if (earned) statements.push(entry(db, { user: receipt.user_id, type: "REVERSAL", trade: receipt.execution_id, fee: feeId, state: "REVERSED", amount, delta: { available: recoveredDebit, liability: recoveredDebit, earned: -amount, adjustment: outstandingDelta }, key: `reversed:${feeId}`, evidence: { ...evidence, recovery_basis: "available_balance_at_atomic_reversal", outstanding_adjustment_recorded_in_ledger: true }, now }));
  await db.batch(statements);
  return rewardBalance(db, receipt.user_id);
}

export async function setAutoApply(env, userId, enabled, now = nowSeconds()) {
  if (typeof enabled !== "boolean") throw new RewardError("auto_apply_boolean_required", 400);
  if (enabled && (!productFlags(env).auto_apply || !productFlags(env).subscription_credit)) throw new RewardError("auto_apply_unavailable", 503);
  const db = env.RAVENOS_CUSTOMER_DB;
  await db.batch([
    db.prepare("INSERT INTO ravenos_reward_preferences (user_id,auto_apply,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET auto_apply=excluded.auto_apply,updated_at=excluded.updated_at").bind(userId, enabled ? 1 : 0, now),
    productEvent(db, userId, enabled ? "auto_apply_enabled" : "auto_apply_disabled", `${userId}:${now}:${enabled}`, {}, now),
  ]);
  return { auto_apply: enabled };
}

export async function sweepExecutionRewards(env, { limit = 100, now = nowSeconds() } = {}) {
  const db = env.RAVENOS_CUSTOMER_DB;
  if (!db?.prepare) return { state: "unavailable" };
  // Persisted enrolment survives a rollout flag being switched off. Complete
  // liabilities already promised, but never retroactively enrol old trades.
  const rows = await db.prepare(`SELECT c.execution_id FROM ravenos_execution_reward_context c JOIN ravenos_customer_live_execution_intents i USING(execution_id)
    LEFT JOIN ravenos_reward_reconciliation_attempts a ON a.execution_id=c.execution_id
    WHERE i.state != 'awaiting_wallet_signature' AND COALESCE(a.terminal,0)=0 AND NOT EXISTS (SELECT 1 FROM ravenos_reward_fee_receipts r WHERE r.execution_id = c.execution_id)
    ORDER BY COALESCE(a.last_attempt_at,0),c.created_at,c.execution_id LIMIT ?`).bind(Math.max(1, Math.min(500, limit))).all();
  const result = { inspected: 0, errors: 0 };
  for (const row of rows.results || []) {
    let state="retry_required",terminal=0;
    try {
      const outcome=await reconcileExecutionRewards(db,row.execution_id,{now});
      state=outcome.state;
      terminal=["available","standard_no_cashback","valuation_required","duplicate_fee_receipt","rejected"].includes(state)?1:0;
      result.inspected++;
    } catch {result.errors++;}
    await db.prepare("INSERT INTO ravenos_reward_reconciliation_attempts(execution_id,last_attempt_at,terminal,result_state) VALUES (?,?,?,?) ON CONFLICT(execution_id) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,terminal=excluded.terminal,result_state=excluded.result_state").bind(row.execution_id,now,terminal,state).run();
  }
  return result;
}
