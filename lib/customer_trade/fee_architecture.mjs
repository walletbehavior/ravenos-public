import { createHash } from "node:crypto";

export const SHADOW_FEE_POLICY_SCHEMA = "ravenos.shadow_fee_policy.v1";
export const SHADOW_FEE_QUOTE_SCHEMA = "ravenos.shadow_fee_quote.v1";
export const SHADOW_FEE_COLLECTION_PLAN_SCHEMA = "ravenos.shadow_fee_collection_plan.v1";
export const SHADOW_FEE_COLLECTION_RESULT_SCHEMA = "ravenos.shadow_fee_collection_result.v1";
export const FEE_AWARE_ROUTE_OUTCOME_SCHEMA = "ravenos.fee_aware_route_outcome.v1";
export const SHADOW_FEE_SCENARIO_MATRIX_SCHEMA = "ravenos.shadow_fee_scenario_matrix.v1";
export const SHADOW_FEE_CALCULATION_VERSION = 1;

export const ShadowFeeScenarioBps = Object.freeze([0, 5, 10, 20]);
export const FeeCollectionMethods = Object.freeze({
  PROVIDER_INTEGRATOR_FEE: "PROVIDER_INTEGRATOR_FEE",
  ROUTER_SPLIT: "ROUTER_SPLIT",
  OUTPUT_DEDUCTION: "OUTPUT_DEDUCTION",
  INPUT_DEDUCTION: "INPUT_DEDUCTION",
  SEPARATE_TRANSFER: "SEPARATE_TRANSFER",
  UNSUPPORTED: "UNSUPPORTED",
});

// This is a source-level safety boundary. Environment configuration cannot
// turn hypothetical fee calculations into collection, signing, or submission.
export const FeeCollectionAuthorization = Object.freeze({
  live_collection: false,
  signing: false,
  submission: false,
  transaction_construction: false,
});

const METHODS = new Set(Object.values(FeeCollectionMethods));
const SIDES = new Set(["buy", "sell"]);
const USDC_MICROS = 1_000_000n;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function text(value, field, maximum = 160, { optional = false } = {}) {
  const clean = String(value ?? "").trim();
  if ((!optional && !clean) || clean.length > maximum || /[\u0000-\u001f\u007f]/.test(clean)) fail(`${field}_invalid`);
  return clean;
}

function integer(value, field, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) fail(`${field}_invalid`);
  return parsed;
}

function optionalInteger(value, field, limits = {}) {
  if (value === null || value === undefined || value === "") return null;
  return integer(value, field, limits);
}

function decimalToMicros(value, field, { optional = false } = {}) {
  if (optional && (value === null || value === undefined || value === "")) return null;
  let raw;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) fail(`${field}_invalid`);
    raw = value.toFixed(6);
  } else {
    raw = String(value ?? "").trim();
  }
  if (!/^\d+(?:\.\d{1,6})?$/.test(raw)) fail(`${field}_invalid`);
  const [whole, fraction = ""] = raw.split(".");
  return (BigInt(whole) * USDC_MICROS) + BigInt(fraction.padEnd(6, "0"));
}

function microsToNumber(value) {
  if (value === null || value === undefined) return null;
  return Number(value) / Number(USDC_MICROS);
}

function digest(parts) {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

function percentLoss(costMicros, returnMicros) {
  if (costMicros === null || returnMicros === null || costMicros <= 0n) return null;
  return Number(((Number(costMicros - returnMicros) / Number(costMicros)) * 100).toFixed(6));
}

function quoteFeeMicros(notionalMicros, policy) {
  if (policy.waive_below_usdc_micros !== null && notionalMicros < BigInt(policy.waive_below_usdc_micros)) {
    return { fee: 0n, waived: true, reason: "notional_below_waiver_threshold" };
  }
  let fee = (notionalMicros * BigInt(policy.fee_bps)) / 10_000n;
  if (policy.minimum_fee_usdc_micros !== null && fee < BigInt(policy.minimum_fee_usdc_micros)) {
    fee = BigInt(policy.minimum_fee_usdc_micros);
  }
  if (policy.maximum_fee_usdc_micros !== null && fee > BigInt(policy.maximum_fee_usdc_micros)) {
    fee = BigInt(policy.maximum_fee_usdc_micros);
  }
  return { fee, waived: false, reason: null };
}

export function createShadowFeePolicy(input = {}) {
  const feeBps = integer(input.fee_bps ?? 0, "fee_bps", { minimum: 0, maximum: 10_000 });
  const scenario = input.allow_custom_scenario === true || ShadowFeeScenarioBps.includes(feeBps);
  if (!scenario) fail("fee_scenario_not_allowlisted");
  const minimumFee = decimalToMicros(input.minimum_fee_usdc, "minimum_fee_usdc", { optional: true });
  const maximumFee = decimalToMicros(input.maximum_fee_usdc, "maximum_fee_usdc", { optional: true });
  const waiveBelow = decimalToMicros(input.waive_below_usdc, "waive_below_usdc", { optional: true });
  if (minimumFee !== null && maximumFee !== null && minimumFee > maximumFee) fail("fee_bounds_invalid");
  return freeze({
    schema_version: SHADOW_FEE_POLICY_SCHEMA,
    calculation_version: SHADOW_FEE_CALCULATION_VERSION,
    mode: "shadow",
    enabled_for_calculation: true,
    enabled_for_collection: false,
    fee_bps: feeBps,
    fee_rate_pct: Number((feeBps / 100).toFixed(4)),
    fee_currency: "canonical_usdc",
    buy_fee_basis: "requested_usdc_trade_notional",
    sell_fee_basis: "gross_executable_usdc_proceeds",
    rounding: "floor_to_usdc_microunit",
    minimum_fee_usdc_micros: minimumFee === null ? null : minimumFee.toString(),
    maximum_fee_usdc_micros: maximumFee === null ? null : maximumFee.toString(),
    waive_below_usdc_micros: waiveBelow === null ? null : waiveBelow.toString(),
    collection_preference: Array.isArray(input.collection_preference)
      ? input.collection_preference.slice(0, 6).map((row) => text(row, "collection_preference", 48))
      : [FeeCollectionMethods.PROVIDER_INTEGRATOR_FEE, FeeCollectionMethods.ROUTER_SPLIT, FeeCollectionMethods.OUTPUT_DEDUCTION],
    authorization: FeeCollectionAuthorization,
    disclosure: "Hypothetical Raven fee study. No fee is charged or collected.",
  });
}

export function createShadowFeeQuote(input = {}) {
  const policy = input.policy;
  if (policy?.schema_version !== SHADOW_FEE_POLICY_SCHEMA) fail("fee_policy_required");
  const side = text(input.side, "side", 8).toLowerCase();
  if (!SIDES.has(side)) fail("side_invalid");
  const basisValue = side === "buy" ? input.requested_trade_notional_usdc : input.gross_executable_proceeds_usdc;
  const basisMicros = decimalToMicros(basisValue, "fee_basis_usdc");
  const calculated = quoteFeeMicros(basisMicros, policy);
  const routeObservationId = text(input.route_observation_id, "route_observation_id", 100);
  const feeId = `shf_${digest([routeObservationId, side, String(policy.fee_bps), String(policy.calculation_version)])}`;
  return freeze({
    schema_version: SHADOW_FEE_QUOTE_SCHEMA,
    fee_id: feeId,
    route_observation_id: routeObservationId,
    side,
    fee_bps: policy.fee_bps,
    fee_rate_pct: policy.fee_rate_pct,
    fee_basis: side === "buy" ? policy.buy_fee_basis : policy.sell_fee_basis,
    fee_basis_usdc_micros: basisMicros.toString(),
    fee_basis_usdc: microsToNumber(basisMicros),
    hypothetical_fee_usdc_micros: calculated.fee.toString(),
    hypothetical_fee_usdc: microsToNumber(calculated.fee),
    actual_fee_usdc_micros: null,
    actual_fee_usdc: null,
    fee_currency: "canonical_usdc",
    waived: calculated.waived,
    waiver_reason: calculated.reason,
    hypothetical: true,
    collection_authorized: false,
    collected: false,
  });
}

export function createFeeCollectionPlan(input = {}) {
  const quote = input.fee_quote;
  if (quote?.schema_version !== SHADOW_FEE_QUOTE_SCHEMA) fail("fee_quote_required");
  const method = text(input.method || FeeCollectionMethods.UNSUPPORTED, "fee_collection_method", 48);
  if (!METHODS.has(method)) fail("fee_collection_method_invalid");
  const collectorConfigId = text(input.collector_config_id, "collector_config_id", 100, { optional: true }) || null;
  if (collectorConfigId && !/^collector_config_[a-z0-9_-]{1,80}$/i.test(collectorConfigId)) fail("collector_config_id_invalid");
  const providerMaximum = optionalInteger(input.provider_maximum_fee_bps, "provider_maximum_fee_bps", { minimum: 0, maximum: 10_000 });
  const providerShareBps = optionalInteger(input.provider_share_bps, "provider_share_bps", { minimum: 0, maximum: 10_000 });
  const incrementalCostMicros = decimalToMicros(input.incremental_collection_cost_usdc, "incremental_collection_cost_usdc", { optional: true });
  const feeMicros = BigInt(quote.hypothetical_fee_usdc_micros);
  const feeAsset = text(input.fee_asset_representation || "canonical_usdc", "fee_asset_representation", 64);
  let state = "model_only";
  let supported = input.supported === true;
  let reason = null;
  if (method === FeeCollectionMethods.UNSUPPORTED || !supported) {
    state = "unsupported";
    supported = false;
    reason = "collection_mechanism_not_proven";
  } else if (feeAsset !== "canonical_usdc") {
    state = "unavailable";
    supported = false;
    reason = "canonical_usdc_collection_unavailable";
  } else if (providerMaximum !== null && quote.fee_bps > providerMaximum) {
    state = "rejected";
    supported = false;
    reason = "provider_fee_cap_exceeded";
  } else if (method === FeeCollectionMethods.SEPARATE_TRANSFER && incrementalCostMicros === null) {
    state = "unavailable";
    supported = false;
    reason = "incremental_collection_cost_unavailable";
  } else if (method === FeeCollectionMethods.SEPARATE_TRANSFER && incrementalCostMicros >= feeMicros && feeMicros > 0n) {
    state = "rejected";
    supported = false;
    reason = "fee_collection_economically_unviable";
  } else if (new Set([FeeCollectionMethods.INPUT_DEDUCTION, FeeCollectionMethods.PROVIDER_INTEGRATOR_FEE]).has(method) && input.fee_bound_provider_quote !== true) {
    state = "model_only";
    reason = "fee_bound_provider_quote_required";
  } else {
    state = "shadow_supported";
  }
  const providerShareMicros = providerShareBps === null ? null : (feeMicros * BigInt(providerShareBps)) / 10_000n;
  const netRavenMicros = providerShareMicros === null ? null : feeMicros - providerShareMicros;
  return freeze({
    schema_version: SHADOW_FEE_COLLECTION_PLAN_SCHEMA,
    fee_id: quote.fee_id,
    method,
    state,
    supported,
    reason,
    fee_asset_representation: feeAsset,
    fee_collection_chain: text(input.fee_collection_chain, "fee_collection_chain", 32, { optional: true }) || null,
    collector_config_id: collectorConfigId,
    provider_maximum_fee_bps: providerMaximum,
    provider_share_bps: providerShareBps,
    provider_share_usdc_micros: providerShareMicros === null ? null : providerShareMicros.toString(),
    net_raven_receivable_usdc_micros: netRavenMicros === null ? null : netRavenMicros.toString(),
    incremental_collection_cost_usdc_micros: incrementalCostMicros === null ? null : incrementalCostMicros.toString(),
    incremental_collection_cost_usdc: microsToNumber(incrementalCostMicros),
    fee_bound_provider_quote: input.fee_bound_provider_quote === true,
    authorization: FeeCollectionAuthorization,
  });
}

export function createFeeCollectionResult({ fee_quote, collection_plan } = {}) {
  if (fee_quote?.schema_version !== SHADOW_FEE_QUOTE_SCHEMA) fail("fee_quote_required");
  if (collection_plan?.schema_version !== SHADOW_FEE_COLLECTION_PLAN_SCHEMA) fail("fee_collection_plan_required");
  if (collection_plan.fee_id !== fee_quote.fee_id) fail("fee_collection_plan_mismatch");
  return freeze({
    schema_version: SHADOW_FEE_COLLECTION_RESULT_SCHEMA,
    fee_id: fee_quote.fee_id,
    mode: "shadow",
    status: "SHADOW",
    expected_fee_usdc_micros: fee_quote.hypothetical_fee_usdc_micros,
    actual_collected_usdc_micros: null,
    actual_collected_usdc: null,
    collection_method: collection_plan.method,
    collection_state: collection_plan.state,
    collection_authorized: false,
    signing_available: false,
    submission_available: false,
    reconciled: false,
  });
}

export function createFeeAwareRouteOutcome(input = {}) {
  const proof = input.round_trip_proof;
  const entryFee = input.entry_fee_quote;
  const exitFee = input.exit_fee_quote;
  const entryPlan = input.entry_collection_plan;
  const exitPlan = input.exit_collection_plan;
  if (!proof || proof.exit_verified !== true) fail("exit_verified_round_trip_required");
  if (entryFee?.side !== "buy" || exitFee?.side !== "sell") fail("round_trip_fee_quotes_required");
  if (entryFee.fee_bps !== exitFee.fee_bps) fail("round_trip_fee_scenario_mismatch");
  const candidateId = text(input.candidate_id, "candidate_id", 160);
  const grossEntryMicros = decimalToMicros(proof.all_in_entry_cost_usdc ?? proof.spend_usdc, "all_in_entry_cost_usdc");
  const grossExitMicros = decimalToMicros(proof.current_executable_liquidation_usdc, "current_executable_liquidation_usdc");
  const minimumExitMicros = decimalToMicros(proof.minimum_executable_liquidation_usdc, "minimum_executable_liquidation_usdc");
  const entryFeeMicros = BigInt(entryFee.hypothetical_fee_usdc_micros);
  const exitFeeMicros = BigInt(exitFee.hypothetical_fee_usdc_micros);
  const entryCollectionCost = entryPlan?.incremental_collection_cost_usdc_micros === null || entryPlan?.incremental_collection_cost_usdc_micros === undefined
    ? 0n : BigInt(entryPlan.incremental_collection_cost_usdc_micros);
  const exitCollectionCost = exitPlan?.incremental_collection_cost_usdc_micros === null || exitPlan?.incremental_collection_cost_usdc_micros === undefined
    ? 0n : BigInt(exitPlan.incremental_collection_cost_usdc_micros);
  const allInEntry = grossEntryMicros + entryFeeMicros + entryCollectionCost;
  const netExit = grossExitMicros > exitFeeMicros + exitCollectionCost ? grossExitMicros - exitFeeMicros - exitCollectionCost : 0n;
  const minimumNetExit = minimumExitMicros > exitFeeMicros + exitCollectionCost ? minimumExitMicros - exitFeeMicros - exitCollectionCost : 0n;
  const collectionComplete = entryPlan?.state === "shadow_supported" && exitPlan?.state === "shadow_supported";
  const frictionComplete = proof.state === "exit_verified" && Number.isFinite(Number(proof.round_trip_friction_pct));
  const quoteOnlyIncludingRaven = percentLoss(allInEntry, netExit);
  const minimumQuoteOnlyIncludingRaven = percentLoss(allInEntry, minimumNetExit);
  return freeze({
    schema_version: FEE_AWARE_ROUTE_OUTCOME_SCHEMA,
    candidate_id: candidateId,
    fee_bps: entryFee.fee_bps,
    gross_entry_cost_usdc_micros: grossEntryMicros.toString(),
    entry_raven_fee_usdc_micros: entryFeeMicros.toString(),
    exit_raven_fee_usdc_micros: exitFeeMicros.toString(),
    round_trip_raven_fee_usdc_micros: (entryFeeMicros + exitFeeMicros).toString(),
    gross_terminal_usdc_micros: grossExitMicros.toString(),
    minimum_gross_terminal_usdc_micros: minimumExitMicros.toString(),
    minimum_net_terminal_usdc_micros: minimumNetExit.toString(),
    net_terminal_usdc_micros: netExit.toString(),
    net_terminal_usdc: microsToNumber(netExit),
    minimum_net_terminal_usdc: microsToNumber(minimumNetExit),
    quote_only_round_trip_loss_excluding_raven_pct: percentLoss(grossEntryMicros, grossExitMicros),
    quote_only_round_trip_loss_including_raven_pct: quoteOnlyIncludingRaven,
    minimum_quote_only_round_trip_loss_including_raven_pct: minimumQuoteOnlyIncludingRaven,
    round_trip_friction_excluding_raven_pct: frictionComplete ? Number(proof.round_trip_friction_pct) : null,
    round_trip_friction_including_raven_pct: frictionComplete ? quoteOnlyIncludingRaven : null,
    minimum_round_trip_friction_including_raven_pct: frictionComplete ? minimumQuoteOnlyIncludingRaven : null,
    economic_model_complete: frictionComplete,
    fee_collection_complete: collectionComplete,
    eligible_for_fee_aware_selection: frictionComplete && collectionComplete,
    actual_collection_authorized: false,
    marked_value_used_as_liquidation_value: false,
  });
}

export function selectFeeAwareRouteOutcome(outcomes = []) {
  const eligible = outcomes.filter((row) => row?.schema_version === FEE_AWARE_ROUTE_OUTCOME_SCHEMA && row.eligible_for_fee_aware_selection === true);
  if (!eligible.length) return freeze({
    state: "unavailable",
    selected_candidate_id: null,
    reason: "fee_collection_evidence_incomplete",
    evaluated_candidate_count: outcomes.length,
  });
  const ordered = [...eligible].sort((left, right) => {
    const leftMinimum = BigInt(left.minimum_net_terminal_usdc_micros);
    const rightMinimum = BigInt(right.minimum_net_terminal_usdc_micros);
    if (leftMinimum !== rightMinimum) return leftMinimum > rightMinimum ? -1 : 1;
    return left.candidate_id.localeCompare(right.candidate_id);
  });
  return freeze({
    state: "selected",
    selected_candidate_id: ordered[0].candidate_id,
    policy: "maximum_minimum_net_terminal_usdc",
    evaluated_candidate_count: outcomes.length,
    eligible_candidate_count: eligible.length,
    deterministic_tie_breaker: "candidate_id_ascending",
  });
}

export function buildShadowFeeScenarioMatrix(input = {}) {
  const proof = input.round_trip_proof;
  if (!proof || proof.exit_verified !== true) fail("exit_verified_round_trip_required");
  const observationId = text(input.route_observation_id, "route_observation_id", 100);
  const candidateId = text(input.candidate_id, "candidate_id", 160);
  const rows = ShadowFeeScenarioBps.map((feeBps) => {
    const policy = createShadowFeePolicy({ fee_bps: feeBps });
    const entryQuote = createShadowFeeQuote({
      policy,
      route_observation_id: observationId,
      side: "buy",
      requested_trade_notional_usdc: proof.spend_usdc,
    });
    const exitQuote = createShadowFeeQuote({
      policy,
      route_observation_id: observationId,
      side: "sell",
      gross_executable_proceeds_usdc: proof.current_executable_liquidation_usdc,
    });
    const entryPlan = createFeeCollectionPlan({ fee_quote: entryQuote, method: FeeCollectionMethods.UNSUPPORTED });
    const exitPlan = createFeeCollectionPlan({ fee_quote: exitQuote, method: FeeCollectionMethods.UNSUPPORTED });
    const outcome = createFeeAwareRouteOutcome({
      candidate_id: candidateId,
      round_trip_proof: proof,
      entry_fee_quote: entryQuote,
      exit_fee_quote: exitQuote,
      entry_collection_plan: entryPlan,
      exit_collection_plan: exitPlan,
    });
    return freeze({
      scenario_bps: feeBps,
      policy,
      entry_fee: entryQuote,
      exit_fee: exitQuote,
      entry_collection: createFeeCollectionResult({ fee_quote: entryQuote, collection_plan: entryPlan }),
      exit_collection: createFeeCollectionResult({ fee_quote: exitQuote, collection_plan: exitPlan }),
      outcome,
      collection_evidence_state: "not_proven",
    });
  });
  return freeze({
    schema_version: SHADOW_FEE_SCENARIO_MATRIX_SCHEMA,
    calculation_version: SHADOW_FEE_CALCULATION_VERSION,
    mode: "shadow",
    route_observation_id: observationId,
    candidate_id: candidateId,
    scenarios_bps: ShadowFeeScenarioBps,
    rows,
    disclosure: "Hypothetical fee sensitivity only. No Raven fee is charged or collected.",
    authorization: FeeCollectionAuthorization,
  });
}
