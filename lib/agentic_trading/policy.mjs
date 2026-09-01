import {
  compareAtomic,
  decimalToAtomic,
  normalizeAtomic,
  sumAtomic,
} from "./decimal.mjs";
import { capitalLocationKey } from "./capital_reservations.mjs";
import { agenticContractHash } from "./hashing.mjs";

export const AGENTIC_USER_POLICY_SCHEMA = "ravenos.agentic.user_policy.v1";
export const AGENTIC_POLICY_EVALUATION_SCHEMA = "ravenos.agentic.policy_evaluation.v1";

const DECISION_RESULTS = new Set(["allow", "block", "require_approval", "indeterminate"]);
const FINALITY_RANK = Object.freeze({ unknown: 0, processed: 1, confirmed: 2, safe: 3, finalized: 4 });

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
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

function optionalAtomic(value, field) {
  return value === null || value === undefined || value === "" ? null : normalizeAtomic(value, field);
}

function optionalBps(value, field, maximum = 10_000) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) throw new Error(`${field}_invalid`);
  return parsed;
}

function identifiers(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))].sort();
}

function hashWithout(record, omitted = []) {
  if (!record || typeof record !== "object") return null;
  const ignored = new Set(["record_hash", "policy_hash", "plan_hash", "quote_hash", "portfolio_hash", "evidence_hash", ...omitted]);
  return agenticContractHash(Object.fromEntries(Object.entries(record).filter(([key]) => !ignored.has(key))));
}

function materialHash(record, explicitKeys = []) {
  for (const key of explicitKeys) {
    if (record?.[key]) return String(record[key]);
  }
  return hashWithout(record);
}

function addLocalDemand(demands, location, amountAtomic) {
  const amount = normalizeAtomic(amountAtomic, "local_asset_demand_atomic");
  const key = capitalLocationKey(location);
  demands.set(key, {
    ...location,
    amount_atomic: (BigInt(demands.get(key)?.amount_atomic || "0") + BigInt(amount)).toString(),
  });
}

function normalizeLimits(input = {}) {
  return {
    max_leg_notional_usdc_micros: optionalAtomic(input.max_leg_notional_usdc_micros, "max_leg_notional_usdc_micros"),
    max_plan_notional_usdc_micros: optionalAtomic(input.max_plan_notional_usdc_micros, "max_plan_notional_usdc_micros"),
    max_agent_capital_usdc_micros: optionalAtomic(input.max_agent_capital_usdc_micros, "max_agent_capital_usdc_micros"),
    max_partial_plan_exposure_usdc_micros: optionalAtomic(input.max_partial_plan_exposure_usdc_micros, "max_partial_plan_exposure_usdc_micros"),
    max_unhedged_duration_ms: input.max_unhedged_duration_ms === null || input.max_unhedged_duration_ms === undefined
      ? null
      : Number(input.max_unhedged_duration_ms),
    max_price_impact_bps: optionalBps(input.max_price_impact_bps, "max_price_impact_bps"),
    max_slippage_bps: optionalBps(input.max_slippage_bps, "max_slippage_bps"),
    max_total_cost_usdc_micros: optionalAtomic(input.max_total_cost_usdc_micros, "max_total_cost_usdc_micros"),
    manual_approval_above_usdc_micros: optionalAtomic(input.manual_approval_above_usdc_micros, "manual_approval_above_usdc_micros"),
  };
}

export function createAgenticUserPolicy(input = {}) {
  if (String(input.authority || "").toLowerCase() !== "user") throw new Error("user_policy_authority_required");
  if (String(input.adoption_state || "").toLowerCase() !== "active") throw new Error("user_policy_explicit_adoption_required");
  const createdAt = timestamp(input.created_at, "policy_created_at");
  const minimumFinality = String(input.evidence_requirements?.minimum_finality || "confirmed").toLowerCase();
  if (!(minimumFinality in FINALITY_RANK)) throw new Error("minimum_finality_invalid");
  const maximumEvidenceAgeMs = Number(input.evidence_requirements?.maximum_age_ms ?? 15_000);
  if (!Number.isSafeInteger(maximumEvidenceAgeMs) || maximumEvidenceAgeMs < 0) throw new Error("maximum_evidence_age_invalid");
  const decisionTtlMs = Number(input.decision_ttl_ms ?? 5_000);
  if (!Number.isSafeInteger(decisionTtlMs) || decisionTtlMs < 1 || decisionTtlMs > 60_000) throw new Error("decision_ttl_invalid");
  const limits = normalizeLimits(input.limits || {});
  if (limits.max_unhedged_duration_ms !== null && (!Number.isSafeInteger(limits.max_unhedged_duration_ms) || limits.max_unhedged_duration_ms < 0)) {
    throw new Error("max_unhedged_duration_ms_invalid");
  }
  const core = {
    schema_version: AGENTIC_USER_POLICY_SCHEMA,
    policy_id: required(input.policy_id, "policy_id"),
    version: Number(input.version),
    owner_tenant_id: required(input.owner_tenant_id, "owner_tenant_id"),
    authority: "user",
    adoption_state: "active",
    created_at: createdAt,
    allowed_chain_ids: identifiers(input.allowed_chain_ids),
    allowed_venue_ids: identifiers(input.allowed_venue_ids),
    allowed_instrument_ids: identifiers(input.allowed_instrument_ids),
    allowed_actions: identifiers(input.allowed_actions || ["buy", "sell", "open_long", "open_short", "reduce", "close"]),
    limits,
    minimum_native_gas_by_location: (Array.isArray(input.minimum_native_gas_by_location) ? input.minimum_native_gas_by_location : []).map((row) => ({
      chain_id: required(row.chain_id, "gas_rule_chain_id"),
      venue_id: required(row.venue_id, "gas_rule_venue_id"),
      asset_id: required(row.asset_id, "gas_rule_asset_id"),
      minimum_atomic: normalizeAtomic(row.minimum_atomic, "gas_rule_minimum_atomic"),
    })),
    evidence_requirements: {
      maximum_age_ms: maximumEvidenceAgeMs,
      minimum_finality: minimumFinality,
      require_verified_identity: input.evidence_requirements?.require_verified_identity !== false,
      require_provider_healthy: input.evidence_requirements?.require_provider_healthy !== false,
      contradictions_block: input.evidence_requirements?.contradictions_block !== false,
    },
    capital_transfer_allowed: false,
    autonomous_bridging_allowed: false,
    live_execution_allowed: false,
    automated_compensation_allowed: false,
    decision_ttl_ms: decisionTtlMs,
  };
  if (!Number.isSafeInteger(core.version) || core.version < 1) throw new Error("policy_version_invalid");
  if (!core.allowed_chain_ids.length || !core.allowed_venue_ids.length) throw new Error("policy_scope_required");
  return deepFreeze({ ...core, policy_hash: agenticContractHash(core) });
}

function planLegs(plan, suppliedIntents = null) {
  const legs = Array.isArray(suppliedIntents)
    ? suppliedIntents
    : Array.isArray(plan?.legs)
      ? plan.legs
      : Array.isArray(plan?.trade_intents)
        ? plan.trade_intents
        : [];
  if (!legs.length) throw new Error("trade_plan_legs_required");
  return legs;
}

function legId(leg, index) {
  return required(leg?.leg_id || leg?.intent_id || `leg-${index + 1}`, "leg_id");
}

function instrumentId(leg) {
  return required(leg?.instrument_id || leg?.instrument?.instrument_id || leg?.canonical_instrument?.instrument_id, "instrument_id");
}

function chainId(leg) {
  return required(leg?.chain_id || leg?.instrument?.chain_id || leg?.canonical_instrument?.chain_id, "leg_chain_id");
}

function venueId(leg) {
  return required(leg?.venue_id || leg?.instrument?.venue_id || leg?.instrument?.venue?.venue_id || leg?.canonical_instrument?.venue_id, "leg_venue_id");
}

function action(leg) {
  return required(leg?.action || leg?.side, "leg_action").toLowerCase();
}

function settlementAssetId(leg) {
  return required(
    leg?.settlement_asset_id
      || leg?.settlement_asset?.asset_id
      || leg?.instrument?.settlement_asset_id
      || leg?.canonical_instrument?.settlement_asset_id
      || leg?.amount?.asset_id,
    "settlement_asset_id",
  );
}

function capitalAssetId(leg) {
  return required(leg?.capital_asset_id || leg?.amount?.asset_id || settlementAssetId(leg), "capital_asset_id");
}

export function legNotionalMicros(leg, quote = null) {
  const direct = leg?.notional_usdc_micros ?? leg?.requested_notional_usdc_micros ?? quote?.requested_notional_usdc_micros;
  if (direct !== null && direct !== undefined && direct !== "") return normalizeAtomic(direct, "leg_notional_usdc_micros", { allowZero: false });
  if (leg?.amount?.kind === "notional") return decimalToAtomic(leg.amount.value, 6, "leg_notional_usdc", { allowZero: false });
  if (quote?.requested_notional?.value) return decimalToAtomic(quote.requested_notional.value, 6, "quote_notional_usdc", { allowZero: false });
  throw new Error("leg_notional_unavailable");
}

function quoteForLeg(quotes, id) {
  if (quotes instanceof Map) return quotes.get(id) || null;
  if (Array.isArray(quotes)) return quotes.find((quote) => String(quote?.leg_id || quote?.intent_id || "") === id) || null;
  return quotes && typeof quotes === "object" ? quotes[id] || null : null;
}

function evidenceState(evidence, policy, now) {
  const missing = identifiers(evidence?.missing_evidence || evidence?.missing || evidence?.unresolved_conditions);
  const contradictions = Array.isArray(evidence?.contradictions) ? evidence.contradictions : [];
  const observations = Array.isArray(evidence?.observations) ? evidence.observations : [];
  const observedTimes = observations.map((row) => Date.parse(String(row.observed_at || ""))).filter(Number.isFinite);
  const expiryTimes = observations.map((row) => Date.parse(String(row.expires_at || ""))).filter(Number.isFinite);
  const observedAt = observedTimes.length
    ? Math.min(...observedTimes)
    : Date.parse(String(evidence?.observed_at || evidence?.decision_at || evidence?.decision_timestamp || ""));
  const expiresAt = expiryTimes.length ? Math.min(...expiryTimes) : Date.parse(String(evidence?.expires_at || ""));
  const age = Number.isFinite(observedAt) ? now - observedAt : null;
  const finalities = observations.map((row) => String(row.finality_state || "unknown").toLowerCase());
  const verifications = observations.map((row) => String(row.verification_state || "unknown").toLowerCase());
  const finality = String(evidence?.finality || evidence?.confirmation_state || (finalities.length ? finalities.reduce((worst, current) => (FINALITY_RANK[current] ?? 0) < (FINALITY_RANK[worst] ?? 0) ? current : worst, finalities[0]) : "unknown")).toLowerCase();
  const verification = String(evidence?.verification_status || evidence?.verification_state || (verifications.length && verifications.every((value) => value === "verified") ? "verified" : "unknown")).toLowerCase();
  const reasons = [];
  if (evidence?.execution_eligible === false || missing.length) reasons.push("evidence_missing");
  if (contradictions.length && policy.evidence_requirements.contradictions_block) reasons.push("evidence_contradictory");
  if (age === null || age < -5_000 || age > policy.evidence_requirements.maximum_age_ms) reasons.push("evidence_stale");
  if (Number.isFinite(expiresAt) && expiresAt <= now) reasons.push("evidence_expired");
  if ((FINALITY_RANK[finality] ?? 0) < FINALITY_RANK[policy.evidence_requirements.minimum_finality]) reasons.push("finality_insufficient");
  if (policy.evidence_requirements.require_verified_identity && !new Set(["verified", "exact"]).has(verification)) reasons.push("identity_unverified");
  return { ok: reasons.length === 0, reasons, age_ms: age, finality, verification, missing, contradictions };
}

function balanceRows(portfolio) {
  return Array.isArray(portfolio?.balances) ? portfolio.balances : [];
}

function findBalance(portfolio, location) {
  const key = capitalLocationKey(location);
  return balanceRows(portfolio).find((row) => {
    try { return capitalLocationKey(row) === key; } catch { return false; }
  }) || null;
}

function usableBalanceAtomic(balance) {
  if (!balance) return null;
  const state = String(balance.state || balance.availability || "available").toLowerCase();
  if (new Set(["stale", "unknown", "unavailable", "unrouteable"]).has(state)) return null;
  const available = balance.available_atomic ?? balance.available_balance_atomic ?? balance.balance_atomic;
  if (available === null || available === undefined) return null;
  const reserved = normalizeAtomic(balance.reserved_atomic ?? "0", "balance_reserved_atomic");
  const value = BigInt(normalizeAtomic(available, "balance_available_atomic")) - BigInt(reserved);
  return value < 0n ? "0" : value.toString();
}

function rule(rule_id, scope, result, observed_value, configured_limit, reason = null) {
  if (!DECISION_RESULTS.has(result)) throw new Error("policy_rule_result_invalid");
  return { rule_id, scope, result, observed_value, configured_limit, reason };
}

function aggregateResult(rules) {
  if (rules.some((row) => row.result === "block")) return "block";
  if (rules.some((row) => row.result === "indeterminate")) return "indeterminate";
  if (rules.some((row) => row.result === "require_approval")) return "require_approval";
  return "allow";
}

function quoteStateRules(leg, quote, id, policy, now) {
  if (!quote) return [rule("quote_available", id, "indeterminate", null, "executable_quote", "quote_missing")];
  const rules = [];
  const quoteState = String(quote.state || quote.quote_state || "unknown").toLowerCase();
  rules.push(rule("quote_available", id, quoteState === "executable" ? "allow" : quoteState === "rejected" ? "block" : "indeterminate", quoteState, "executable", quote.unavailable_reason || quote.rejection_reason || null));
  const bindings = [
    ["quote_chain_identity", quote.chain_id, chainId(leg)],
    ["quote_venue_identity", quote.venue_id, venueId(leg)],
    ["quote_instrument_identity", quote.instrument_id, instrumentId(leg)],
  ];
  for (const [ruleId, observed, expected] of bindings) {
    rules.push(rule(ruleId, id, observed ? (String(observed) === expected ? "allow" : "block") : "indeterminate", observed || null, expected, observed ? null : "quote_identity_missing"));
  }
  const observedAt = Date.parse(String(quote.observed_at || ""));
  const expiresAt = Date.parse(String(quote.expires_at || ""));
  const maximumQuoteAgeMs = Number(leg?.quote_requirements?.maximum_age_ms ?? policy.evidence_requirements.maximum_age_ms);
  const quoteAge = Number.isFinite(observedAt) ? now - observedAt : null;
  const quoteCurrent = Number.isFinite(observedAt)
    && Number.isFinite(expiresAt)
    && observedAt <= now + 5_000
    && expiresAt > now
    && Number.isSafeInteger(maximumQuoteAgeMs)
    && quoteAge >= 0
    && quoteAge <= maximumQuoteAgeMs;
  rules.push(rule("quote_freshness", id, quoteCurrent ? "allow" : "indeterminate", quote.expires_at || null, `>${new Date(now).toISOString()}`, quoteCurrent ? null : "quote_stale_or_expiry_unknown"));
  const health = String(quote.provider_health || quote.provenance?.provider_health || "unknown").toLowerCase();
  if (policy.evidence_requirements.require_provider_healthy) {
    rules.push(rule("provider_health", id, health === "healthy" ? "allow" : "indeterminate", health, "healthy", health === "healthy" ? null : "provider_health_unresolved"));
  }
  return rules;
}

function costAtomic(quote) {
  const components = quote?.costs_usdc_micros || quote?.costs || {};
  const values = [
    quote?.fee_usdc_micros ?? components.venue_fee_usdc_micros ?? components.venue,
    quote?.network_fee_usdc_micros ?? components.network_fee_usdc_micros ?? components.network,
    quote?.gas_fee_usdc_micros ?? components.gas_fee_usdc_micros ?? components.gas,
    quote?.funding_usdc_micros ?? components.funding_usdc_micros ?? components.funding,
    quote?.raven_fee_usdc_micros ?? components.raven_fee_usdc_micros ?? components.raven,
  ];
  if (values.some((value) => value === null || value === undefined || value === "")) return null;
  return sumAtomic(values.map((value) => normalizeAtomic(value, "quote_cost_usdc_micros")), "quote_cost_usdc_micros");
}

function gasRuleFor(policy, leg, quote) {
  const gasAssetId = quote?.gas_asset_id || leg?.gas_asset_id || leg?.gas_requirement?.asset_id || null;
  if (!gasAssetId) return null;
  return policy.minimum_native_gas_by_location.find((row) => row.chain_id === chainId(leg) && row.venue_id === venueId(leg) && row.asset_id === gasAssetId) || {
    chain_id: chainId(leg),
    venue_id: venueId(leg),
    asset_id: gasAssetId,
    minimum_atomic: "0",
  };
}

export function evaluateAgenticPlanPolicy({ plan, intents = null, policy, portfolio, evidence, quotes, now = Date.now() } = {}) {
  if (!policy || policy.schema_version !== AGENTIC_USER_POLICY_SCHEMA) throw new Error("active_user_policy_required");
  if (agenticContractHash(Object.fromEntries(Object.entries(policy).filter(([key]) => key !== "policy_hash"))) !== policy.policy_hash) {
    throw new Error("policy_integrity_invalid");
  }
  const planId = required(plan?.plan_id, "plan_id");
  const environment = String(plan?.environment || "paper").toLowerCase();
  const planHash = materialHash(plan, ["record_hash", "plan_hash"]);
  const policyHash = policy.policy_hash;
  const portfolioHash = materialHash(portfolio, ["record_hash", "portfolio_hash", "snapshot_hash"]);
  const evidenceHash = materialHash(evidence, ["record_hash", "evidence_hash", "packet_hash"]);
  const evidenceReview = evidenceState(evidence, policy, now);
  const legs = planLegs(plan, intents);
  const intentHashes = legs.map((leg, index) => ({
    leg_id: legId(leg, index),
    intent_hash: materialHash(leg, ["record_hash", "intent_hash"]),
  }));
  const legResults = [];
  const localCapitalDemands = new Map();
  const minimumGasReserves = new Map();
  const quoteHashes = [];
  const planLevelRules = [];

  if (!new Set(["preview", "paper"]).has(environment)) {
    planLevelRules.push(rule("execution_environment", planId, "block", environment, "preview_or_paper", "live_agent_execution_disabled"));
  } else {
    planLevelRules.push(rule("execution_environment", planId, "allow", environment, "preview_or_paper"));
  }
  if (plan.capital_transfer_intents?.length || legs.some((leg) => String(leg.intent_type || "trade") === "capital_transfer")) {
    planLevelRules.push(rule("capital_transfer_prohibition", planId, "block", "present", "prohibited", "autonomous_bridging_disabled"));
  }

  for (let index = 0; index < legs.length; index += 1) {
    const leg = legs[index];
    const id = legId(leg, index);
    const quote = quoteForLeg(quotes, id);
    const rules = [];
    let notional = null;
    try { notional = legNotionalMicros(leg, quote); } catch { rules.push(rule("leg_notional", id, "indeterminate", null, "known_positive_notional", "leg_notional_unavailable")); }
    const chain = chainId(leg);
    const venue = venueId(leg);
    const instrument = instrumentId(leg);
    const legAction = action(leg);
    const capitalAsset = capitalAssetId(leg);
    let capitalLocation = null;
    let capitalDemand = null;
    const readiness = leg?.readiness;
    if (readiness && readiness.execution_eligible !== true) {
      rules.push(rule(
        "intent_readiness",
        id,
        "indeterminate",
        readiness.state || "indeterminate",
        "execution_eligible",
        (readiness.reasons || []).join(",") || "intent_not_execution_eligible",
      ));
    }
    rules.push(rule("allowed_chain", id, policy.allowed_chain_ids.includes(chain) ? "allow" : "block", chain, policy.allowed_chain_ids, "chain_not_allowed"));
    rules.push(rule("allowed_venue", id, policy.allowed_venue_ids.includes(venue) ? "allow" : "block", venue, policy.allowed_venue_ids, "venue_not_allowed"));
    rules.push(rule("allowed_instrument", id, !policy.allowed_instrument_ids.length || policy.allowed_instrument_ids.includes(instrument) ? "allow" : "block", instrument, policy.allowed_instrument_ids, "instrument_not_allowed"));
    rules.push(rule("allowed_action", id, policy.allowed_actions.includes(legAction) ? "allow" : "block", legAction, policy.allowed_actions, "action_not_allowed"));
    for (const reason of evidenceReview.reasons) rules.push(rule(`evidence_${reason}`, id, "indeterminate", reason, "resolved_current_evidence", reason));
    rules.push(...quoteStateRules(leg, quote, id, policy, now));
    if (notional !== null && policy.limits.max_leg_notional_usdc_micros !== null) {
      rules.push(rule("max_leg_notional", id, compareAtomic(notional, policy.limits.max_leg_notional_usdc_micros) <= 0 ? "allow" : "block", notional, policy.limits.max_leg_notional_usdc_micros, "leg_notional_limit_exceeded"));
    }
    if (notional !== null && policy.limits.manual_approval_above_usdc_micros !== null) {
      rules.push(rule("manual_approval_threshold", id, compareAtomic(notional, policy.limits.manual_approval_above_usdc_micros) > 0 ? "require_approval" : "allow", notional, policy.limits.manual_approval_above_usdc_micros, "manual_approval_threshold_exceeded"));
    }
    const slippage = Number(
      leg.maximum_slippage_bps
        ?? leg.max_slippage_bps
        ?? leg.order_constraints?.maximum_slippage_bps
        ?? quote?.slippage_bps
        ?? quote?.estimated_slippage_bps,
    );
    if (policy.limits.max_slippage_bps !== null) {
      rules.push(rule("maximum_slippage", id, Number.isSafeInteger(slippage) ? (slippage <= policy.limits.max_slippage_bps ? "allow" : "block") : "indeterminate", Number.isSafeInteger(slippage) ? slippage : null, policy.limits.max_slippage_bps, "slippage_unresolved_or_exceeded"));
    }
    const impact = Number(quote?.price_impact_bps);
    if (policy.limits.max_price_impact_bps !== null) {
      rules.push(rule("maximum_price_impact", id, Number.isFinite(impact) && impact >= 0 ? (impact <= policy.limits.max_price_impact_bps ? "allow" : "block") : "indeterminate", Number.isFinite(impact) ? impact : null, policy.limits.max_price_impact_bps, "price_impact_unresolved_or_exceeded"));
    }
    const cost = quote ? costAtomic(quote) : null;
    rules.push(rule("friction_costs_complete", id, cost === null ? "indeterminate" : "allow", cost, "all_cost_components_known", "fee_or_cost_component_unresolved"));
    if (policy.limits.max_total_cost_usdc_micros !== null) {
      rules.push(rule("maximum_total_cost", id, cost === null ? "indeterminate" : compareAtomic(cost, policy.limits.max_total_cost_usdc_micros) <= 0 ? "allow" : "block", cost, policy.limits.max_total_cost_usdc_micros, "total_cost_unresolved_or_exceeded"));
    }
    if (notional !== null) {
      capitalLocation = { chain_id: chain, venue_id: venue, asset_id: quote?.capital_asset_id || capitalAsset };
      capitalDemand = quote?.capital_reservation_amount_atomic
        ? normalizeAtomic(quote.capital_reservation_amount_atomic, "quote_capital_reservation_amount_atomic", { allowZero: false })
        : cost !== null && capitalLocation.asset_id === settlementAssetId(leg)
          ? (BigInt(notional) + BigInt(cost)).toString()
          : null;
      rules.push(rule("capital_reservation_complete", id, capitalDemand === null ? "indeterminate" : "allow", capitalDemand, "exact_local_capital_debit", capitalDemand === null ? "capital_reservation_unresolved" : null));
      if (capitalDemand !== null) {
        addLocalDemand(localCapitalDemands, capitalLocation, capitalDemand);
        const balance = findBalance(portfolio, capitalLocation);
        const available = usableBalanceAtomic(balance);
        rules.push(rule("local_venue_capital", id, available === null ? "indeterminate" : compareAtomic(available, capitalDemand) >= 0 ? "allow" : "block", available, capitalDemand, available === null ? "local_balance_unresolved" : "insufficient_local_venue_capital"));
      }
    }
    const gasRule = gasRuleFor(policy, leg, quote);
    if (gasRule) {
      const gasBalance = usableBalanceAtomic(findBalance(portfolio, gasRule));
      const gasDebit = normalizeAtomic(quote?.gas_required_atomic ?? "0", "quote_gas_required_atomic");
      const requiredGas = (BigInt(gasRule.minimum_atomic) + BigInt(gasDebit)).toString();
      rules.push(rule("native_gas_reserve", id, gasBalance === null ? "indeterminate" : compareAtomic(gasBalance, requiredGas) >= 0 ? "allow" : "block", gasBalance, requiredGas, gasBalance === null ? "gas_balance_unresolved" : "insufficient_native_gas"));
      addLocalDemand(localCapitalDemands, gasRule, gasDebit);
      const gasKey = capitalLocationKey(gasRule);
      const priorMinimum = BigInt(minimumGasReserves.get(gasKey) || "0");
      if (BigInt(gasRule.minimum_atomic) > priorMinimum) minimumGasReserves.set(gasKey, gasRule.minimum_atomic);
      if (capitalLocation && capitalDemand !== null && capitalLocationKey(capitalLocation) === gasKey) {
        const combinedRequired = (BigInt(capitalDemand) + BigInt(requiredGas)).toString();
        rules.push(rule(
          "combined_capital_and_gas",
          id,
          gasBalance === null ? "indeterminate" : compareAtomic(gasBalance, combinedRequired) >= 0 ? "allow" : "block",
          gasBalance,
          combinedRequired,
          gasBalance === null ? "local_balance_unresolved" : "insufficient_combined_capital_and_gas",
        ));
      }
    }
    const quoteHash = materialHash(quote, ["record_hash", "quote_hash"]);
    quoteHashes.push({ leg_id: id, quote_hash: quoteHash });
    legResults.push({
      leg_id: id,
      result: aggregateResult(rules),
      notional_usdc_micros: notional,
      rules,
    });
  }

  const totalNotional = sumAtomic(legResults.map((row) => row.notional_usdc_micros).filter((value) => value !== null), "plan_notional_usdc_micros");
  if (legResults.some((row) => row.notional_usdc_micros === null)) {
    planLevelRules.push(rule("combined_notional", planId, "indeterminate", null, "known", "combined_notional_unresolved"));
  }
  if (policy.limits.max_plan_notional_usdc_micros !== null) {
    planLevelRules.push(rule("max_plan_notional", planId, compareAtomic(totalNotional, policy.limits.max_plan_notional_usdc_micros) <= 0 ? "allow" : "block", totalNotional, policy.limits.max_plan_notional_usdc_micros, "plan_notional_limit_exceeded"));
  }
  if (policy.limits.max_agent_capital_usdc_micros !== null) {
    const reserved = normalizeAtomic(portfolio?.agent_reserved_usdc_micros ?? "0", "agent_reserved_usdc_micros");
    const combined = (BigInt(reserved) + BigInt(totalNotional)).toString();
    planLevelRules.push(rule("max_agent_capital", planId, compareAtomic(combined, policy.limits.max_agent_capital_usdc_micros) <= 0 ? "allow" : "block", combined, policy.limits.max_agent_capital_usdc_micros, "agent_capital_limit_exceeded"));
  }
  const combinedLocalDemands = [...localCapitalDemands.entries()].map(([key, demand]) => ({
    ...demand,
    amount_atomic: (BigInt(demand.amount_atomic) + BigInt(minimumGasReserves.get(key) || "0")).toString(),
  }));
  for (const demand of combinedLocalDemands) {
    const available = usableBalanceAtomic(findBalance(portfolio, demand));
    planLevelRules.push(rule("combined_local_capital", capitalLocationKey(demand), available === null ? "indeterminate" : compareAtomic(available, demand.amount_atomic) >= 0 ? "allow" : "block", available, demand.amount_atomic, available === null ? "local_balance_unresolved" : "combined_local_capital_exceeded"));
  }
  const partialExposure = normalizeAtomic(
    plan?.maximum_partial_exposure_usdc_micros
      ?? plan?.combined_expected_portfolio_effect?.maximum_partial_exposure_usdc_micros
      ?? totalNotional,
    "maximum_partial_exposure_usdc_micros",
  );
  if (policy.limits.max_partial_plan_exposure_usdc_micros !== null) {
    planLevelRules.push(rule("max_partial_plan_exposure", planId, compareAtomic(partialExposure, policy.limits.max_partial_plan_exposure_usdc_micros) <= 0 ? "allow" : "block", partialExposure, policy.limits.max_partial_plan_exposure_usdc_micros, "partial_plan_exposure_limit_exceeded"));
  }
  if (legs.length > 1 && policy.limits.max_unhedged_duration_ms !== null) {
    const observed = Number(plan.maximum_time_between_legs_ms ?? plan.orchestration?.maximum_time_between_legs_ms);
    planLevelRules.push(rule("maximum_unhedged_duration", planId, Number.isSafeInteger(observed) && observed >= 0 ? (observed <= policy.limits.max_unhedged_duration_ms ? "allow" : "block") : "indeterminate", Number.isSafeInteger(observed) ? observed : null, policy.limits.max_unhedged_duration_ms, "unhedged_duration_unresolved_or_exceeded"));
  }

  const result = aggregateResult([...planLevelRules, ...legResults.flatMap((row) => row.rules)]);
  const expiries = [
    now + policy.decision_ttl_ms,
    Date.parse(String(plan?.expires_at || "")),
    Date.parse(String(evidence?.expires_at || "")),
    ...(Array.isArray(evidence?.observations) ? evidence.observations : []).map((row) => Date.parse(String(row.expires_at || ""))),
    ...legResults.map((row) => Date.parse(String(quoteForLeg(quotes, row.leg_id)?.expires_at || ""))),
  ].filter(Number.isFinite);
  const expiresAtMs = Math.min(...expiries);
  const binding = {
    schema_version: AGENTIC_POLICY_EVALUATION_SCHEMA,
    plan_id: planId,
    plan_hash: planHash,
    intent_hashes: intentHashes,
    policy_id: policy.policy_id,
    policy_version: policy.version,
    policy_hash: policyHash,
    portfolio_hash: portfolioHash,
    evidence_hash: evidenceHash,
    quote_hashes: quoteHashes,
    result,
    leg_results: legResults,
    plan_rules: planLevelRules,
    combined_effect: {
      total_notional_usdc_micros: totalNotional,
      local_capital_demands: combinedLocalDemands,
      maximum_partial_exposure_usdc_micros: partialExposure,
      cross_chain_atomicity_assumed: false,
    },
    evaluated_at: new Date(now).toISOString(),
    expires_at: new Date(expiresAtMs).toISOString(),
    deterministic_engine_version: "agentic-policy-v1",
    live_execution_allowed: false,
  };
  const decisionId = `apd_${agenticContractHash(binding).slice(0, 24)}`;
  return deepFreeze({ ...binding, decision_id: decisionId, decision_hash: agenticContractHash({ ...binding, decision_id: decisionId }) });
}

function policyDecisionIntegrityErrors(decision, now) {
  const errors = [];
  if (decision?.schema_version !== AGENTIC_POLICY_EVALUATION_SCHEMA) errors.push("policy_decision_schema_invalid");
  if (!DECISION_RESULTS.has(String(decision?.result || ""))) errors.push("policy_decision_result_invalid");
  if (decision?.live_execution_allowed !== false) errors.push("policy_decision_live_execution_forbidden");
  const evaluatedAt = Date.parse(String(decision?.evaluated_at || ""));
  const expiresAt = Date.parse(String(decision?.expires_at || ""));
  if (!Number.isFinite(evaluatedAt) || evaluatedAt > now + 5_000) errors.push("policy_decision_evaluated_at_invalid");
  if (!Number.isFinite(expiresAt) || expiresAt <= now || (Number.isFinite(evaluatedAt) && expiresAt <= evaluatedAt)) {
    errors.push("policy_decision_expired");
  }
  if (!decision?.policy_id || !Number.isSafeInteger(decision?.policy_version) || decision.policy_version < 1 || !/^[a-f0-9]{64}$/.test(String(decision?.policy_hash || ""))) {
    errors.push("policy_decision_scope_invalid");
  }
  const { decision_hash: suppliedHash, ...core } = decision || {};
  if (!suppliedHash || suppliedHash !== agenticContractHash(core)) errors.push("policy_decision_integrity_invalid");
  const { decision_id: suppliedId, ...binding } = core;
  const expectedId = `apd_${agenticContractHash(binding).slice(0, 24)}`;
  if (!suppliedId || suppliedId !== expectedId) errors.push("policy_decision_id_integrity_invalid");
  return errors;
}

function exactLegBinding(rows, id, hashField, expectedHash, missingReason, mismatchReason) {
  const matches = (Array.isArray(rows) ? rows : []).filter((row) => row?.leg_id === id);
  if (matches.length !== 1) return [missingReason];
  return matches[0]?.[hashField] === expectedHash ? [] : [mismatchReason];
}

export function verifyAgenticPolicyDecisionForPlacement(decision, {
  plan,
  intents = null,
  intent,
  quote,
  now = Date.now(),
} = {}) {
  const errors = policyDecisionIntegrityErrors(decision, now);
  let legs = [];
  try {
    legs = planLegs(plan, intents || (intent ? [intent] : null));
  } catch {
    errors.push("policy_decision_intent_scope_missing");
  }
  const planId = String(plan?.plan_id || "");
  if (!planId || decision?.plan_id !== planId || intent?.plan_id !== planId) errors.push("policy_decision_plan_mismatch");
  if (!plan || decision?.plan_hash !== materialHash(plan, ["record_hash", "plan_hash"])) errors.push("plan_changed_since_policy");
  const id = String(intent?.leg_id || intent?.intent_id || "");
  const scopedIntent = legs.find((row, index) => legId(row, index) === id);
  if (!id || !scopedIntent || materialHash(scopedIntent, ["record_hash", "intent_hash"]) !== materialHash(intent, ["record_hash", "intent_hash"])) {
    errors.push("policy_decision_intent_scope_mismatch");
  }
  errors.push(...exactLegBinding(
    decision?.intent_hashes,
    id,
    "intent_hash",
    materialHash(intent, ["record_hash", "intent_hash"]),
    "policy_decision_intent_binding_missing",
    "intent_changed_since_policy",
  ));
  errors.push(...exactLegBinding(
    decision?.quote_hashes,
    id,
    "quote_hash",
    materialHash(quote, ["record_hash", "quote_hash"]),
    "policy_decision_quote_binding_missing",
    "quote_changed_since_policy",
  ));
  const legResults = (Array.isArray(decision?.leg_results) ? decision.leg_results : []).filter((row) => row?.leg_id === id);
  if (legResults.length !== 1 || legResults[0].result !== "allow") errors.push("policy_decision_leg_allow_required");
  if (decision?.result !== "allow") errors.push("policy_decision_allow_required");
  return {
    ok: errors.length === 0,
    result: errors.length ? "indeterminate" : "allow",
    errors: [...new Set(errors)],
  };
}

export function verifyAgenticPolicyDecision(decision, { plan, intents = null, policy, portfolio, evidence, quotes, now = Date.now() } = {}) {
  const errors = policyDecisionIntegrityErrors(decision, now);
  if (decision?.plan_id !== plan?.plan_id) errors.push("policy_decision_plan_mismatch");
  if (decision?.plan_hash !== materialHash(plan, ["record_hash", "plan_hash"])) errors.push("plan_changed_since_policy");
  const legs = planLegs(plan, intents);
  if (!Array.isArray(decision?.intent_hashes) || decision.intent_hashes.length !== legs.length) errors.push("policy_decision_intent_coverage_invalid");
  if (!Array.isArray(decision?.quote_hashes) || decision.quote_hashes.length !== legs.length) errors.push("policy_decision_quote_coverage_invalid");
  for (const [index, intent] of legs.entries()) {
    const id = legId(intent, index);
    const intentMatches = (decision?.intent_hashes || []).filter((row) => row?.leg_id === id);
    if (intentMatches.length !== 1 || intentMatches[0].intent_hash !== materialHash(intent, ["record_hash", "intent_hash"])) errors.push(`intent_changed_since_policy:${id}`);
    const quoteMatches = (decision?.quote_hashes || []).filter((row) => row?.leg_id === id);
    if (quoteMatches.length !== 1 || quoteMatches[0].quote_hash !== materialHash(quoteForLeg(quotes, id), ["record_hash", "quote_hash"])) errors.push(`quote_changed_since_policy:${id}`);
  }
  if (decision?.policy_hash !== policy?.policy_hash) errors.push("policy_changed_since_decision");
  if (decision?.portfolio_hash !== materialHash(portfolio, ["record_hash", "portfolio_hash", "snapshot_hash"])) errors.push("portfolio_changed_since_policy");
  if (decision?.evidence_hash !== materialHash(evidence, ["record_hash", "evidence_hash", "packet_hash"])) errors.push("evidence_changed_since_policy");
  return {
    ok: errors.length === 0 && decision?.result === "allow",
    result: errors.length ? "indeterminate" : decision?.result,
    errors: [...new Set(errors)],
  };
}
