import assert from "node:assert/strict";
import test from "node:test";

import {
  FeeCollectionAuthorization,
  FeeCollectionMethods,
  ShadowFeeScenarioBps,
  buildShadowFeeScenarioMatrix,
  createFeeAwareRouteOutcome,
  createFeeCollectionPlan,
  createFeeCollectionResult,
  createShadowFeePolicy,
  createShadowFeeQuote,
  selectFeeAwareRouteOutcome,
} from "../lib/customer_trade/fee_architecture.mjs";

const proof = Object.freeze({
  state: "exit_verified",
  exit_verified: true,
  trade_available: true,
  spend_usdc: 500,
  all_in_entry_cost_usdc: 500.31,
  current_executable_liquidation_usdc: 491.72,
  minimum_executable_liquidation_usdc: 489.18,
  round_trip_friction_pct: 1.716,
  marked_value_used_as_liquidation_value: false,
});

function quote(feeBps, side, value, id = "shr_fee_test") {
  return createShadowFeeQuote({
    policy: createShadowFeePolicy({ fee_bps: feeBps }),
    route_observation_id: id,
    side,
    ...(side === "buy" ? { requested_trade_notional_usdc: value } : { gross_executable_proceeds_usdc: value }),
  });
}

function supportedPlan(feeQuote, overrides = {}) {
  return createFeeCollectionPlan({
    fee_quote: feeQuote,
    method: FeeCollectionMethods.ROUTER_SPLIT,
    supported: true,
    fee_asset_representation: "canonical_usdc",
    fee_collection_chain: "solana",
    collector_config_id: "collector_config_solana_primary",
    provider_share_bps: 0,
    incremental_collection_cost_usdc: 0,
    ...overrides,
  });
}

test("shadow fee scenarios are fixed, hypothetical, and never authorized", () => {
  assert.deepEqual(ShadowFeeScenarioBps, [0, 5, 10, 20]);
  assert.deepEqual(FeeCollectionAuthorization, {
    live_collection: false,
    signing: false,
    submission: false,
    transaction_construction: false,
  });
  for (const bps of ShadowFeeScenarioBps) {
    const policy = createShadowFeePolicy({ fee_bps: bps });
    assert.equal(policy.mode, "shadow");
    assert.equal(policy.enabled_for_collection, false);
    assert.equal(policy.fee_currency, "canonical_usdc");
  }
  assert.throws(() => createShadowFeePolicy({ fee_bps: 11 }), /fee_scenario_not_allowlisted/);
});

test("buy and sell fees use different executable USDC bases with microunit rounding", () => {
  const buy = quote(10, "buy", "500.000999");
  const sell = quote(10, "sell", "491.729999", "shr_fee_sell");
  assert.equal(buy.fee_basis, "requested_usdc_trade_notional");
  assert.equal(buy.hypothetical_fee_usdc_micros, "500000");
  assert.equal(buy.hypothetical_fee_usdc, 0.5);
  assert.equal(sell.fee_basis, "gross_executable_usdc_proceeds");
  assert.equal(sell.hypothetical_fee_usdc_micros, "491729");
  assert.equal(sell.actual_fee_usdc, null);
  assert.equal(sell.collection_authorized, false);
});

test("minimum, maximum, and waiver policies are deterministic", () => {
  const minimum = createShadowFeePolicy({ fee_bps: 5, minimum_fee_usdc: "0.10" });
  const maximum = createShadowFeePolicy({ fee_bps: 20, maximum_fee_usdc: "1.00" });
  const waiver = createShadowFeePolicy({ fee_bps: 20, waive_below_usdc: "5.00" });
  assert.equal(createShadowFeeQuote({ policy: minimum, route_observation_id: "shr_min", side: "buy", requested_trade_notional_usdc: 1 }).hypothetical_fee_usdc, 0.1);
  assert.equal(createShadowFeeQuote({ policy: maximum, route_observation_id: "shr_max", side: "buy", requested_trade_notional_usdc: 10_000 }).hypothetical_fee_usdc, 1);
  const waived = createShadowFeeQuote({ policy: waiver, route_observation_id: "shr_waive", side: "buy", requested_trade_notional_usdc: 1 });
  assert.equal(waived.hypothetical_fee_usdc, 0);
  assert.equal(waived.waived, true);
});

test("scenario fee math stays exact across small and large orders", () => {
  for (const amount of [1, 5, 10, 25, 50, 100, 500, 1_000, 10_000]) {
    const five = quote(5, "buy", amount, `shr_${amount}_five`);
    const ten = quote(10, "buy", amount, `shr_${amount}_ten`);
    const twenty = quote(20, "buy", amount, `shr_${amount}_twenty`);
    assert.equal(ten.hypothetical_fee_usdc, amount * 0.001);
    assert.equal(twenty.hypothetical_fee_usdc, amount * 0.002);
    assert.equal(five.hypothetical_fee_usdc, amount * 0.0005);
  }
});

test("collection plans preserve unknowns and reject uneconomic separate transfers", () => {
  const fee = quote(10, "buy", 10);
  const unknownCost = createFeeCollectionPlan({
    fee_quote: fee,
    method: FeeCollectionMethods.SEPARATE_TRANSFER,
    supported: true,
    fee_asset_representation: "canonical_usdc",
  });
  assert.equal(unknownCost.state, "unavailable");
  assert.equal(unknownCost.incremental_collection_cost_usdc, null);
  const uneconomic = createFeeCollectionPlan({
    fee_quote: fee,
    method: FeeCollectionMethods.SEPARATE_TRANSFER,
    supported: true,
    fee_asset_representation: "canonical_usdc",
    incremental_collection_cost_usdc: 0.42,
  });
  assert.equal(uneconomic.state, "rejected");
  assert.equal(uneconomic.reason, "fee_collection_economically_unviable");
});

test("provider caps reject a scenario rather than silently clamping it", () => {
  const fee = quote(20, "buy", 500);
  const plan = createFeeCollectionPlan({
    fee_quote: fee,
    method: FeeCollectionMethods.PROVIDER_INTEGRATOR_FEE,
    supported: true,
    fee_asset_representation: "canonical_usdc",
    provider_maximum_fee_bps: 10,
    fee_bound_provider_quote: true,
  });
  assert.equal(plan.state, "rejected");
  assert.equal(plan.reason, "provider_fee_cap_exceeded");
  assert.equal(fee.fee_bps, 20);
});

test("non-canonical fee assets and unbound input deductions remain incomplete", () => {
  const fee = quote(10, "buy", 500);
  const synthetic = createFeeCollectionPlan({
    fee_quote: fee,
    method: FeeCollectionMethods.ROUTER_SPLIT,
    supported: true,
    fee_asset_representation: "bridged_usdc",
  });
  assert.equal(synthetic.state, "unavailable");
  assert.equal(synthetic.reason, "canonical_usdc_collection_unavailable");
  const unbound = createFeeCollectionPlan({
    fee_quote: fee,
    method: FeeCollectionMethods.INPUT_DEDUCTION,
    supported: true,
    fee_asset_representation: "canonical_usdc",
  });
  assert.equal(unbound.state, "model_only");
  assert.equal(unbound.fee_bound_provider_quote, false);
});

test("fee-aware outcome applies entry and exit fees only after exact reverse USDC proof", () => {
  const entry = quote(10, "buy", proof.spend_usdc, "shr_outcome");
  const exit = quote(10, "sell", proof.current_executable_liquidation_usdc, "shr_outcome");
  const outcome = createFeeAwareRouteOutcome({
    candidate_id: "route_a",
    round_trip_proof: proof,
    entry_fee_quote: entry,
    exit_fee_quote: exit,
    entry_collection_plan: supportedPlan(entry),
    exit_collection_plan: supportedPlan(exit),
  });
  assert.equal(outcome.entry_raven_fee_usdc_micros, "500000");
  assert.equal(outcome.exit_raven_fee_usdc_micros, "491720");
  assert.equal(outcome.net_terminal_usdc, 491.22828);
  assert.equal(outcome.fee_collection_complete, true);
  assert.ok(outcome.round_trip_friction_including_raven_pct > outcome.round_trip_friction_excluding_raven_pct);
  assert.equal(outcome.marked_value_used_as_liquidation_value, false);
});

test("fee-aware selection compares minimum terminal USDC and breaks ties deterministically", () => {
  const make = (candidateId, exitUsdc) => {
    const routeProof = { ...proof, current_executable_liquidation_usdc: exitUsdc, minimum_executable_liquidation_usdc: exitUsdc - 1 };
    const entry = quote(10, "buy", 500, `shr_${candidateId}`);
    const exit = quote(10, "sell", exitUsdc, `shr_${candidateId}`);
    return createFeeAwareRouteOutcome({
      candidate_id: candidateId,
      round_trip_proof: routeProof,
      entry_fee_quote: entry,
      exit_fee_quote: exit,
      entry_collection_plan: supportedPlan(entry),
      exit_collection_plan: supportedPlan(exit),
    });
  };
  assert.equal(selectFeeAwareRouteOutcome([make("route_b", 492), make("route_a", 493)]).selected_candidate_id, "route_a");
  assert.equal(selectFeeAwareRouteOutcome([make("route_b", 493), make("route_a", 493)]).selected_candidate_id, "route_a");
  const incomplete = make("route_incomplete", 499);
  const unavailable = selectFeeAwareRouteOutcome([{ ...incomplete, eligible_for_fee_aware_selection: false }]);
  assert.equal(unavailable.state, "unavailable");
});

test("unknown non-Raven costs never become a complete total-friction claim", () => {
  const incompleteProof = { ...proof, state: "friction_incomplete", round_trip_friction_pct: null };
  const entry = quote(10, "buy", 500, "shr_incomplete");
  const exit = quote(10, "sell", 491.72, "shr_incomplete");
  const outcome = createFeeAwareRouteOutcome({
    candidate_id: "route_incomplete",
    round_trip_proof: incompleteProof,
    entry_fee_quote: entry,
    exit_fee_quote: exit,
    entry_collection_plan: supportedPlan(entry),
    exit_collection_plan: supportedPlan(exit),
  });
  assert.equal(outcome.economic_model_complete, false);
  assert.equal(outcome.round_trip_friction_excluding_raven_pct, null);
  assert.equal(outcome.round_trip_friction_including_raven_pct, null);
  assert.equal(outcome.eligible_for_fee_aware_selection, false);
  assert.ok(Number.isFinite(outcome.quote_only_round_trip_loss_including_raven_pct));
});

test("scenario matrix returns four non-collecting empirical rows without transaction material", () => {
  const matrix = buildShadowFeeScenarioMatrix({
    route_observation_id: "shr_matrix",
    candidate_id: "entry_jupiter",
    round_trip_proof: proof,
  });
  assert.deepEqual(matrix.scenarios_bps, [0, 5, 10, 20]);
  assert.equal(matrix.rows.length, 4);
  assert.equal(matrix.rows[2].entry_fee.hypothetical_fee_usdc, 0.5);
  assert.equal(matrix.rows[2].exit_fee.hypothetical_fee_usdc, 0.49172);
  for (const row of matrix.rows) {
    assert.equal(row.entry_collection.status, "SHADOW");
    assert.equal(row.entry_collection.actual_collected_usdc, null);
    assert.equal(row.outcome.actual_collection_authorized, false);
  }
  const serialized = JSON.stringify(matrix).toLowerCase();
  for (const forbidden of ["transaction_hash", "calldata", "private_key", "collector_address", "fee_recipient"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("shadow collection result never fabricates collection or reconciliation", () => {
  const fee = quote(5, "sell", 100);
  const plan = supportedPlan(fee);
  const result = createFeeCollectionResult({ fee_quote: fee, collection_plan: plan });
  assert.equal(result.status, "SHADOW");
  assert.equal(result.actual_collected_usdc, null);
  assert.equal(result.collection_authorized, false);
  assert.equal(result.reconciled, false);
});
