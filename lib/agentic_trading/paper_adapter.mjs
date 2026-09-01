import { AgenticVenueAdapter, createVenueCapability } from "./adapter.mjs";
import {
  compareAtomic,
  decimalToAtomic,
  multiplyRatioAtomic,
  normalizeAtomic,
  ratioBasisPoints,
  sumAtomic,
} from "./decimal.mjs";
import { agenticContractHash } from "./hashing.mjs";
import { verifyAgenticPolicyDecisionForPlacement } from "./policy.mjs";

export const AGENTIC_PAPER_QUOTE_SCHEMA = "ravenos.agentic.paper_quote.v1";
export const AGENTIC_PAPER_PREVIEW_SCHEMA = "ravenos.agentic.paper_preview.v1";
export const AGENTIC_PAPER_RECEIPT_SCHEMA = "ravenos.agentic.paper_receipt.v1";
export const AGENTIC_PAPER_ADAPTER_STATE_SCHEMA = "ravenos.agentic.paper_adapter_state.v1";

function clone(value) {
  return structuredClone(value);
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
}

function verifyReceiptIntegrity(receipt) {
  const { receipt_hash: suppliedHash, ...core } = receipt || {};
  return Boolean(suppliedHash) && suppliedHash === agenticContractHash(core);
}

function normalizePaperState(paperState) {
  if (!paperState) return { receipts: [], idempotency: [] };
  if (paperState.schema_version !== AGENTIC_PAPER_ADAPTER_STATE_SCHEMA) throw new Error("paper_adapter_state_schema_invalid");
  const { snapshot_hash: suppliedHash, ...core } = paperState;
  if (!suppliedHash || suppliedHash !== agenticContractHash(core)) throw new Error("paper_adapter_state_integrity_invalid");
  const receipts = Array.isArray(paperState.receipts) ? paperState.receipts : [];
  if (receipts.some((receipt) => !verifyReceiptIntegrity(receipt))) throw new Error("paper_receipt_integrity_invalid");
  const receiptIds = new Set(receipts.map((receipt) => receipt.receipt_id));
  const idempotency = Array.isArray(paperState.idempotency) ? paperState.idempotency : [];
  if (idempotency.some((row) => !Array.isArray(row) || row.length !== 2 || !receiptIds.has(row[1]))) {
    throw new Error("paper_adapter_idempotency_state_invalid");
  }
  return { receipts, idempotency };
}

function required(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${field}_required`);
  return normalized;
}

function timestamp(value, field) {
  const normalized = String(value ?? "").trim();
  const parsed = Date.parse(normalized);
  if (!normalized || !Number.isFinite(parsed)) throw new Error(`${field}_invalid`);
  return new Date(parsed).toISOString();
}

function exactDecimal(value, field) {
  const normalized = String(value ?? "").trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) throw new Error(`${field}_invalid`);
  return normalized;
}

function intentIdentity(intent = {}) {
  return {
    plan_id: required(intent.plan_id, "paper_intent_plan_id"),
    leg_id: required(intent.leg_id || intent.intent_id, "paper_intent_leg_id"),
    intent_id: required(intent.intent_id || intent.leg_id, "paper_intent_id"),
    chain_id: required(intent.chain_id || intent.instrument?.chain_id, "paper_intent_chain_id"),
    venue_id: required(intent.venue_id || intent.instrument?.venue_id || intent.instrument?.venue?.venue_id, "paper_intent_venue_id"),
    instrument_id: required(intent.instrument_id || intent.instrument?.instrument_id, "paper_intent_instrument_id"),
    action: required(intent.action || intent.side, "paper_intent_action").toLowerCase(),
    settlement_asset_id: required(intent.settlement_asset_id || intent.settlement_asset?.asset_id || intent.instrument?.settlement_asset_id || intent.amount?.asset_id, "paper_intent_settlement_asset_id"),
    capital_asset_id: required(intent.capital_asset_id || intent.amount?.asset_id || intent.settlement_asset_id || intent.settlement_asset?.asset_id || intent.instrument?.settlement_asset_id, "paper_intent_capital_asset_id"),
    idempotency_key: required(intent.idempotency_key, "paper_intent_idempotency_key"),
  };
}

function intentNotional(intent = {}) {
  const value = intent.requested_notional_usdc_micros ?? intent.notional_usdc_micros;
  if (value !== null && value !== undefined && value !== "") {
    return normalizeAtomic(value, "paper_intent_notional_micros", { allowZero: false });
  }
  if (intent.amount?.kind === "notional") return decimalToAtomic(intent.amount.value, 6, "paper_intent_notional", { allowZero: false });
  throw new Error("paper_intent_notional_micros_required");
}

function zeroOrAtomic(value, field) {
  return normalizeAtomic(value ?? "0", field);
}

function unavailableQuote(input, identity, reason) {
  const core = {
    schema_version: AGENTIC_PAPER_QUOTE_SCHEMA,
    quote_id: required(input.quote_id || `unavailable:${identity.leg_id}`, "paper_quote_id"),
    leg_id: identity.leg_id,
    chain_id: identity.chain_id,
    venue_id: identity.venue_id,
    instrument_id: identity.instrument_id,
    action: identity.action,
    state: "unavailable",
    unavailable_reason: required(reason, "paper_quote_unavailable_reason"),
    provider: String(input.provider || "unknown"),
    provider_health: String(input.provider_health || "unknown").toLowerCase(),
    observed_at: input.observed_at ? timestamp(input.observed_at, "paper_quote_observed_at") : null,
    expires_at: input.expires_at ? timestamp(input.expires_at, "paper_quote_expires_at") : null,
    executable_evidence: false,
    last_trade_price_used: false,
    live_order_material: false,
  };
  return freeze({ ...core, quote_hash: agenticContractHash(core) });
}

export function normalizeExecutablePaperQuote(input = {}, intent = {}) {
  const identity = intentIdentity(intent);
  const state = String(input.state || input.quote_state || "unknown").toLowerCase();
  if (state !== "executable") return unavailableQuote(input, identity, input.unavailable_reason || input.rejection_reason || "executable_quote_unavailable");
  const bindings = {
    leg_id: required(input.leg_id || identity.leg_id, "paper_quote_leg_id"),
    chain_id: required(input.chain_id, "paper_quote_chain_id"),
    venue_id: required(input.venue_id, "paper_quote_venue_id"),
    instrument_id: required(input.instrument_id, "paper_quote_instrument_id"),
    action: required(input.action || input.side, "paper_quote_action").toLowerCase(),
  };
  for (const [key, expected] of Object.entries({ ...identity, idempotency_key: undefined, plan_id: undefined, intent_id: undefined, settlement_asset_id: undefined, capital_asset_id: undefined })) {
    if (expected !== undefined && bindings[key] !== expected) throw new Error(`paper_quote_${key}_mismatch`);
  }
  const requestedNotional = normalizeAtomic(input.requested_notional_usdc_micros ?? intentNotional(intent), "paper_quote_requested_notional_usdc_micros", { allowZero: false });
  if (requestedNotional !== intentNotional(intent)) throw new Error("paper_quote_notional_mismatch");
  const executableNotional = normalizeAtomic(input.executable_notional_usdc_micros, "paper_quote_executable_notional_usdc_micros", { allowZero: false });
  if (compareAtomic(executableNotional, requestedNotional) > 0) throw new Error("paper_quote_executable_notional_exceeds_request");
  const observedAt = timestamp(input.observed_at, "paper_quote_observed_at");
  const expiresAt = timestamp(input.expires_at, "paper_quote_expires_at");
  if (Date.parse(expiresAt) <= Date.parse(observedAt)) throw new Error("paper_quote_expiry_invalid");
  const impact = Number(input.price_impact_bps);
  const slippage = Number(input.estimated_slippage_bps ?? input.slippage_bps);
  if (!Number.isFinite(impact) || impact < 0 || impact > 1_000_000) throw new Error("paper_quote_price_impact_invalid");
  if (!Number.isFinite(slippage) || slippage < 0 || slippage > 1_000_000) throw new Error("paper_quote_slippage_invalid");
  const providerHealth = String(input.provider_health || "unknown").toLowerCase();
  if (input.last_trade_price_used === true || input.price_source === "last_trade") throw new Error("paper_quote_last_trade_price_forbidden");
  const requiredCost = (value, field) => {
    if (value === null || value === undefined || value === "") throw new Error(`${field}_unresolved`);
    return normalizeAtomic(value, field);
  };
  const costs = {
    venue_fee_usdc_micros: requiredCost(input.venue_fee_usdc_micros, "paper_quote_venue_fee_usdc_micros"),
    network_fee_usdc_micros: requiredCost(input.network_fee_usdc_micros, "paper_quote_network_fee_usdc_micros"),
    gas_fee_usdc_micros: requiredCost(input.gas_fee_usdc_micros, "paper_quote_gas_fee_usdc_micros"),
    funding_usdc_micros: requiredCost(input.funding_usdc_micros, "paper_quote_funding_usdc_micros"),
    raven_fee_usdc_micros: requiredCost(input.raven_fee_usdc_micros, "paper_quote_raven_fee_usdc_micros"),
  };
  const capitalAssetId = input.capital_asset_id ? required(input.capital_asset_id, "paper_quote_capital_asset_id") : identity.capital_asset_id;
  const totalCost = sumAtomic(Object.values(costs), "paper_quote_total_cost_usdc_micros");
  const capitalReservationAmount = input.capital_reservation_amount_atomic === null || input.capital_reservation_amount_atomic === undefined
    ? capitalAssetId === identity.settlement_asset_id
      ? (BigInt(requestedNotional) + BigInt(totalCost)).toString()
      : null
    : normalizeAtomic(input.capital_reservation_amount_atomic, "paper_quote_capital_reservation_amount_atomic", { allowZero: false });
  if (capitalReservationAmount === null) throw new Error("paper_quote_capital_reservation_unresolved");
  const core = {
    schema_version: AGENTIC_PAPER_QUOTE_SCHEMA,
    quote_id: required(input.quote_id, "paper_quote_id"),
    ...bindings,
    state: "executable",
    provider: required(input.provider, "paper_quote_provider"),
    provider_health: providerHealth,
    observed_at: observedAt,
    expires_at: expiresAt,
    requested_notional_usdc_micros: requestedNotional,
    executable_notional_usdc_micros: executableNotional,
    executable_quantity_atomic: input.executable_quantity_atomic === null || input.executable_quantity_atomic === undefined
      ? null
      : normalizeAtomic(input.executable_quantity_atomic, "paper_quote_executable_quantity_atomic", { allowZero: false }),
    average_price: exactDecimal(input.average_price, "paper_quote_average_price"),
    worst_price: exactDecimal(input.worst_price ?? input.average_price, "paper_quote_worst_price"),
    price_impact_bps: impact,
    estimated_slippage_bps: slippage,
    costs,
    total_cost_usdc_micros: totalCost,
    capital_asset_id: capitalAssetId,
    capital_reservation_amount_atomic: capitalReservationAmount,
    gas_asset_id: input.gas_asset_id || intent.gas_requirement?.asset_id
      ? required(input.gas_asset_id || intent.gas_requirement.asset_id, "paper_quote_gas_asset_id")
      : null,
    gas_required_atomic: zeroOrAtomic(input.gas_required_atomic, "paper_quote_gas_required_atomic"),
    quote_depth_source: required(input.quote_depth_source, "paper_quote_depth_source"),
    order_book_levels_consumed: input.order_book_levels_consumed === null || input.order_book_levels_consumed === undefined
      ? null
      : Number(input.order_book_levels_consumed),
    venue_precision: input.venue_precision && typeof input.venue_precision === "object" ? clone(input.venue_precision) : null,
    executable_evidence: true,
    last_trade_price_used: false,
    live_order_material: false,
  };
  if (core.order_book_levels_consumed !== null && (!Number.isSafeInteger(core.order_book_levels_consumed) || core.order_book_levels_consumed < 1)) {
    throw new Error("paper_quote_order_book_levels_invalid");
  }
  return freeze({ ...core, quote_hash: agenticContractHash(core) });
}

function findBalance(account, { chain_id, venue_id, asset_id }) {
  return (Array.isArray(account?.balances) ? account.balances : []).find((row) => row.chain_id === chain_id && row.venue_id === venue_id && row.asset_id === asset_id) || null;
}

function availableBalance(balance) {
  if (!balance) return null;
  if (new Set(["stale", "unknown", "unavailable", "unrouteable"]).has(String(balance.state || "available").toLowerCase())) return null;
  const available = balance.available_atomic ?? balance.balance_atomic;
  return available === null || available === undefined ? null : normalizeAtomic(available, "paper_balance_available_atomic");
}

function validateReservation(reservation, identity, quote) {
  const errors = [];
  const requiredAmount = quote?.capital_reservation_amount_atomic || null;
  const capitalAssetId = quote?.capital_asset_id || identity.capital_asset_id;
  if (!reservation || reservation.state !== "reserved") errors.push("paper_capital_reservation_required");
  if (reservation?.plan_id !== identity.plan_id || reservation?.leg_id !== identity.leg_id) errors.push("paper_reservation_binding_mismatch");
  if (reservation?.chain_id !== identity.chain_id || reservation?.venue_id !== identity.venue_id) errors.push("paper_reservation_location_mismatch");
  if (reservation?.asset_id !== capitalAssetId) errors.push("paper_reservation_asset_mismatch");
  if (!requiredAmount || !reservation?.amount_atomic || compareAtomic(reservation.amount_atomic, requiredAmount) < 0) errors.push("paper_reservation_amount_insufficient");
  if (reservation?.gas_asset_id !== (quote?.gas_asset_id || null)) errors.push("paper_reservation_gas_asset_mismatch");
  if (compareAtomic(reservation?.gas_amount_atomic || "0", quote?.gas_required_atomic || "0") < 0) errors.push("paper_reservation_gas_amount_insufficient");
  const { reservation_hash: suppliedHash, ...core } = reservation || {};
  if (!suppliedHash || suppliedHash !== agenticContractHash(core)) errors.push("paper_reservation_integrity_invalid");
  return errors;
}

function previewCore({ intent, quote, account, now }) {
  const identity = intentIdentity(intent);
  const errors = [];
  if (!quote || quote.state !== "executable") errors.push("executable_quote_required");
  if (quote?.quote_hash !== agenticContractHash(Object.fromEntries(Object.entries(quote).filter(([key]) => key !== "quote_hash")))) errors.push("paper_quote_integrity_invalid");
  if (quote?.chain_id !== identity.chain_id || quote?.venue_id !== identity.venue_id || quote?.instrument_id !== identity.instrument_id || quote?.leg_id !== identity.leg_id) errors.push("paper_quote_binding_mismatch");
  if (quote?.provider_health !== "healthy") errors.push("paper_quote_provider_unhealthy");
  if (!Number.isFinite(Date.parse(String(quote?.expires_at || ""))) || Date.parse(quote.expires_at) <= now) errors.push("paper_quote_expired");
  const requestedNotional = intentNotional(intent);
  const capitalDebit = quote?.capital_reservation_amount_atomic || null;
  const capitalBalance = availableBalance(findBalance(account, { chain_id: identity.chain_id, venue_id: identity.venue_id, asset_id: identity.capital_asset_id }));
  if (capitalBalance === null) errors.push("paper_local_capital_balance_unresolved");
  else if (capitalDebit === null || compareAtomic(capitalBalance, capitalDebit) < 0) errors.push("paper_local_capital_balance_insufficient");
  let gasBalance = null;
  if (quote?.gas_asset_id && BigInt(quote.gas_required_atomic || "0") > 0n) {
    gasBalance = availableBalance(findBalance(account, { chain_id: identity.chain_id, venue_id: identity.venue_id, asset_id: quote.gas_asset_id }));
    if (gasBalance === null) errors.push("paper_native_gas_balance_unresolved");
    else if (compareAtomic(gasBalance, quote.gas_required_atomic) < 0) errors.push("paper_native_gas_insufficient");
    if (quote.gas_asset_id === identity.capital_asset_id && capitalDebit !== null && gasBalance !== null) {
      const combinedDebit = (BigInt(capitalDebit) + BigInt(quote.gas_required_atomic)).toString();
      if (compareAtomic(gasBalance, combinedDebit) < 0) errors.push("paper_combined_capital_and_gas_insufficient");
    }
  }
  return {
    identity,
    errors: [...new Set(errors)],
    requested_notional_usdc_micros: requestedNotional,
    capital_debit_atomic: capitalDebit,
    capital_available_atomic: capitalBalance,
    gas_available_atomic: gasBalance,
  };
}

export class PaperVenueAdapter extends AgenticVenueAdapter {
  #quoteSource;
  #accountSource;
  #clock;
  #latencyMs;
  #reject;
  #receipts;
  #idempotency;
  #calls;

  constructor({ capability, quote_source, account_source, clock = () => Date.now(), latency_ms = 0, rejection_policy = null, paper_state = null } = {}) {
    super(createVenueCapability({
      ...capability,
      environment: "paper",
      operations: {
        ...(capability?.operations || {}),
        observe_account: true,
        positions: true,
        quote: true,
        preview: true,
        paper_place: true,
        live_place: false,
        cancel: true,
        status: true,
        reconcile: true,
        estimate_fees: true,
        estimate_gas: true,
        health: true,
      },
    }));
    if (typeof quote_source !== "function") throw new Error("paper_quote_source_required");
    if (typeof account_source !== "function") throw new Error("paper_account_source_required");
    if (typeof clock !== "function") throw new Error("paper_clock_invalid");
    if (!Number.isSafeInteger(latency_ms) || latency_ms < 0 || latency_ms > 120_000) throw new Error("paper_latency_invalid");
    if (rejection_policy !== null && typeof rejection_policy !== "function") throw new Error("paper_rejection_policy_invalid");
    const restoredState = normalizePaperState(paper_state);
    this.#quoteSource = quote_source;
    this.#accountSource = account_source;
    this.#clock = clock;
    this.#latencyMs = latency_ms;
    this.#reject = rejection_policy;
    this.#receipts = new Map(restoredState.receipts.map((row) => [row.receipt_id, freeze(clone(row))]));
    this.#idempotency = new Map(restoredState.idempotency);
    this.#calls = { quote: 0, preview: 0, paper_place: 0, live_place: 0, reconcile: 0 };
  }

  async observeAccount(context = {}) {
    return clone(await this.#accountSource(context));
  }

  async positions(context = {}) {
    const account = await this.observeAccount(context);
    return clone(Array.isArray(account?.positions) ? account.positions : []);
  }

  async quote(intent, { now = this.#clock() } = {}) {
    this.#calls.quote += 1;
    const raw = await this.#quoteSource(clone(intent), { now, capability: this.capability });
    return normalizeExecutablePaperQuote(raw, intent);
  }

  async preview({ intent, quote, account = null, now = this.#clock() } = {}) {
    this.#calls.preview += 1;
    const observedAccount = account || await this.observeAccount({ intent, now });
    const review = previewCore({ intent, quote, account: observedAccount, now });
    const core = {
      schema_version: AGENTIC_PAPER_PREVIEW_SCHEMA,
      preview_id: `app_${agenticContractHash({ intent_id: review.identity.intent_id, quote_hash: quote?.quote_hash, now }).slice(0, 24)}`,
      plan_id: review.identity.plan_id,
      leg_id: review.identity.leg_id,
      intent_id: review.identity.intent_id,
      quote_id: quote?.quote_id || null,
      quote_hash: quote?.quote_hash || null,
      chain_id: review.identity.chain_id,
      venue_id: review.identity.venue_id,
      instrument_id: review.identity.instrument_id,
      state: review.errors.length ? "blocked" : "ready",
      errors: review.errors,
      requested_notional_usdc_micros: review.requested_notional_usdc_micros,
      executable_notional_usdc_micros: quote?.executable_notional_usdc_micros || null,
      capital_asset_id: quote?.capital_asset_id || null,
      capital_debit_atomic: review.capital_debit_atomic,
      capital_available_atomic: review.capital_available_atomic,
      gas_available_atomic: review.gas_available_atomic,
      observed_at: new Date(now).toISOString(),
      expires_at: quote?.expires_at || null,
      environment: "paper",
      live_execution_available: false,
      signing_available: false,
      broadcasting_available: false,
    };
    return freeze({ ...core, preview_hash: agenticContractHash(core) });
  }

  async placePaper({ plan, intents = null, intent, quote, preview, policy_decision, reservation, now = this.#clock() } = {}) {
    this.#calls.paper_place += 1;
    const identity = intentIdentity(intent);
    const requestedNotional = intentNotional(intent);
    const semanticBinding = {
      intent_id: identity.intent_id,
      idempotency_key: identity.idempotency_key,
      quote_hash: quote?.quote_hash || null,
      preview_hash: preview?.preview_hash || null,
      policy_decision_hash: policy_decision?.decision_hash || null,
      reservation_hash: reservation?.reservation_hash || null,
      plan_hash: policy_decision?.plan_hash || null,
    };
    const idempotencyHash = agenticContractHash(semanticBinding);
    const existingId = this.#idempotency.get(identity.idempotency_key);
    if (existingId) {
      const existing = this.#receipts.get(existingId);
      if (existing?.idempotency_hash !== idempotencyHash) throw new Error(`paper_idempotency_conflict:${identity.idempotency_key}`);
      return freeze({ ...clone(existing), idempotent_replay: true });
    }
    const policyVerification = verifyAgenticPolicyDecisionForPlacement(policy_decision, {
      plan,
      intents: intents || (intent ? [intent] : null),
      intent,
      quote,
      now,
    });
    const errors = [
      ...policyVerification.errors.map((reason) => `paper_${reason}`),
      ...validateReservation(reservation, identity, quote),
    ];
    if (!preview || preview.state !== "ready") errors.push(...(preview?.errors || ["paper_preview_ready_required"]));
    if (preview?.preview_hash !== agenticContractHash(Object.fromEntries(Object.entries(preview || {}).filter(([key]) => key !== "preview_hash")))) errors.push("paper_preview_integrity_invalid");
    if (preview?.quote_hash !== quote?.quote_hash) errors.push("paper_preview_quote_changed");
    const fillAt = now + this.#latencyMs;
    if (!Number.isFinite(Date.parse(String(quote?.expires_at || ""))) || Date.parse(quote.expires_at) <= fillAt) errors.push("paper_quote_expired_before_fill");
    const policyRejection = this.#reject ? await this.#reject({ intent: clone(intent), quote: clone(quote), preview: clone(preview), fill_at: fillAt }) : null;
    if (policyRejection) errors.push(String(policyRejection));
    const executableNotional = quote?.executable_notional_usdc_micros || "0";
    const isPartial = compareAtomic(executableNotional, requestedNotional) < 0;
    const timeInForce = String(intent.order_constraints?.time_in_force || "").toLowerCase();
    const partialAllowed = intent.allow_partial === true || new Set(["ioc", "market"]).has(timeInForce);
    if (isPartial && !partialAllowed) errors.push("paper_partial_fill_not_allowed");
    const minimumFillBps = Number(intent.minimum_fill_bps ?? (partialAllowed ? 1 : 10_000));
    if (!Number.isSafeInteger(minimumFillBps) || minimumFillBps < 1 || minimumFillBps > 10_000) errors.push("paper_minimum_fill_bps_invalid");
    const fillRatioBps = BigInt(executableNotional) > 0n ? ratioBasisPoints(executableNotional, requestedNotional, "paper_fill_ratio") : 0;
    if (fillRatioBps < minimumFillBps) errors.push("paper_minimum_fill_not_met");
    const status = errors.length ? "rejected" : isPartial ? "partially_filled" : "filled";
    const filledNotional = errors.length ? "0" : executableNotional;
    const scale = (value, fixed = false) => errors.length
      ? "0"
      : fixed
        ? normalizeAtomic(value || "0", "paper_fixed_cost")
        : multiplyRatioAtomic(value || "0", filledNotional, requestedNotional, "paper_cost", { rounding: "ceil" });
    const receiptCore = {
      schema_version: AGENTIC_PAPER_RECEIPT_SCHEMA,
      receipt_id: `apr_${agenticContractHash({ ...semanticBinding, fill_at: new Date(fillAt).toISOString() }).slice(0, 24)}`,
      paper_order_reference: `paper:${identity.venue_id}:${identity.idempotency_key}`,
      plan_id: identity.plan_id,
      leg_id: identity.leg_id,
      intent_id: identity.intent_id,
      chain_id: identity.chain_id,
      venue_id: identity.venue_id,
      instrument_id: identity.instrument_id,
      environment: "paper",
      status,
      requested_notional_usdc_micros: requestedNotional,
      filled_notional_usdc_micros: filledNotional,
      filled_quantity_atomic: errors.length ? "0" : quote.executable_quantity_atomic,
      fill_ratio_bps: errors.length ? 0 : fillRatioBps,
      average_price: errors.length ? null : quote.average_price,
      worst_price: errors.length ? null : quote.worst_price,
      realized_slippage_bps: errors.length ? null : quote.estimated_slippage_bps,
      price_impact_bps: errors.length ? null : quote.price_impact_bps,
      fees: {
        venue_fee_usdc_micros: scale(quote?.costs?.venue_fee_usdc_micros),
        network_fee_usdc_micros: scale(quote?.costs?.network_fee_usdc_micros, true),
        gas_fee_usdc_micros: scale(quote?.costs?.gas_fee_usdc_micros, true),
        funding_usdc_micros: scale(quote?.costs?.funding_usdc_micros),
        raven_fee_usdc_micros: scale(quote?.costs?.raven_fee_usdc_micros),
      },
      gas_asset_id: quote?.gas_asset_id || null,
      gas_consumed_atomic: errors.length ? "0" : quote?.gas_required_atomic || "0",
      rejection_reasons: [...new Set(errors)],
      quote_id: quote?.quote_id || null,
      quote_hash: quote?.quote_hash || null,
      preview_hash: preview?.preview_hash || null,
      policy_decision_id: policy_decision?.decision_id || null,
      policy_decision_hash: policy_decision?.decision_hash || null,
      reservation_id: reservation?.reservation_id || null,
      idempotency_hash: idempotencyHash,
      requested_at: new Date(now).toISOString(),
      provider_acknowledged_at: new Date(fillAt).toISOString(),
      filled_at: errors.length ? null : new Date(fillAt).toISOString(),
      confirmation_state: "paper_simulated",
      finality_state: "paper_simulated",
      reconciliation_status: "pending",
      live_execution: false,
      signing_performed: false,
      broadcast_performed: false,
      idempotent_replay: false,
    };
    const receipt = freeze({ ...receiptCore, receipt_hash: agenticContractHash(receiptCore) });
    this.#receipts.set(receipt.receipt_id, receipt);
    this.#idempotency.set(identity.idempotency_key, receipt.receipt_id);
    return receipt;
  }

  async placeLive() {
    this.#calls.live_place += 1;
    throw new Error("live_execution_disabled");
  }

  async cancel(receiptId) {
    const receipt = this.#receipts.get(String(receiptId || ""));
    if (!receipt) return { ok: false, state: "unknown", reason: "paper_receipt_not_found" };
    return { ok: false, state: receipt.status, reason: "paper_fill_already_terminal", live_cancel_submitted: false };
  }

  async status(receiptId) {
    const receipt = this.#receipts.get(String(receiptId || ""));
    return receipt ? { ok: true, status: receipt.status, receipt: clone(receipt) } : { ok: false, status: "unknown" };
  }

  async reconcile(receipt) {
    this.#calls.reconcile += 1;
    const stored = this.#receipts.get(String(receipt?.receipt_id || ""));
    if (!stored) {
      return {
        ok: false,
        state: "indeterminate",
        reason: "paper_venue_record_unavailable",
        receipt_id: receipt?.receipt_id || null,
        live_venue_queried: false,
      };
    }
    if (!verifyReceiptIntegrity(receipt) || stored.receipt_hash !== receipt.receipt_hash) {
      return { ok: false, state: "indeterminate", reason: "paper_receipt_integrity_mismatch", receipt_id: receipt.receipt_id, live_venue_queried: false };
    }
    return {
      ok: true,
      state: stored.status,
      receipt_id: stored.receipt_id,
      receipt_hash: stored.receipt_hash,
      reconciled_at: new Date(this.#clock()).toISOString(),
      live_venue_queried: false,
      paper_venue_truth: true,
    };
  }

  async estimateFees(quote) {
    return quote?.state === "executable" ? clone(quote.costs) : null;
  }

  async estimateGas(quote) {
    return quote?.state === "executable" ? { gas_asset_id: quote.gas_asset_id, gas_required_atomic: quote.gas_required_atomic, gas_fee_usdc_micros: quote.costs.gas_fee_usdc_micros } : null;
  }

  async health() {
    return {
      state: "healthy",
      environment: "paper",
      live_execution_enabled: false,
      quote_source_configured: true,
      account_source_configured: true,
    };
  }

  diagnostics() {
    return clone(this.#calls);
  }

  snapshotPaperState() {
    const core = {
      schema_version: AGENTIC_PAPER_ADAPTER_STATE_SCHEMA,
      receipts: [...this.#receipts.values()].map(clone),
      idempotency: [...this.#idempotency.entries()],
    };
    return { ...core, snapshot_hash: agenticContractHash(core) };
  }
}

export function createPaperVenueAdapter(options = {}) {
  return new PaperVenueAdapter(options);
}
