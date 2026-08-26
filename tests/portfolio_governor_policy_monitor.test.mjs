import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateProfitRouting,
  createFundingEvent,
  createMarketPosture,
  createObservation,
  createPolicyActivationRule,
  createUserPolicyVersion,
  evaluatePortfolioPolicy,
  resolvePolicyForMarketPosture,
} from "../lib/portfolio_governor/domain.mjs";
import {
  SOLANA_USDT_MINT,
  buildSolanaExposurePortfolio,
  createSolanaExecutableExitObservation,
  createSolanaMarkObservation,
  createSolanaProtocolPositionObservation,
} from "../lib/portfolio_governor/solana_exposure.mjs";

const NOW = "2026-08-26T18:00:00.000Z";

function solMark({ price = "100", freshness_state = "fresh" } = {}) {
  return createSolanaMarkObservation({
    asset_id: "solana:SOL",
    price_numerator_minor: price,
    price_denominator_base_units: "1000000000",
    observed_at: NOW,
    freshness_state,
    source_reference: "existing_raven_price_layer",
  });
}

function assetMark(assetId, valueMinor) {
  return createSolanaMarkObservation({
    asset_id: assetId,
    price_numerator_minor: String(valueMinor),
    price_denominator_base_units: "1000000",
    observed_at: NOW,
    source_reference: "existing_raven_price_layer",
  });
}

function protocolPosition({
  id,
  instrument,
  protocol = "direct_wallet",
  kind = "spot_position",
  amount,
  decimals,
  components,
  exposure_side = "asset",
  underlying_state,
} = {}) {
  return createSolanaProtocolPositionObservation({
    position_id: id,
    economic_lot_id: `fixture:${id}`,
    instrument_asset_id: instrument,
    position_kind: kind,
    protocol_id: protocol,
    amount_base_units: amount,
    decimals,
    exposure_side,
    components,
    underlying_state,
    observed_at: NOW,
    source_reference: `fixture:${protocol}:${id}`,
  });
}

function buildPortfolio(observations, suffix = "base") {
  return buildSolanaExposurePortfolio({
    portfolio_id: "portfolio_policy_monitor",
    user_id: "user_policy_monitor",
    snapshot_id: `snapshot_${suffix}`,
    measurement_id: `measurement_${suffix}`,
    observed_at: NOW,
    calculated_at: NOW,
    observations,
    minimum_material_value_minor: "1",
  });
}

function basePortfolio({
  solValue = 7200,
  usdcValue = 2800,
  staleSol = false,
  solRouteability = "unknown",
  suffix = "base",
} = {}) {
  const solAmount = (BigInt(solValue) * 10_000_000n).toString();
  const observations = [
    protocolPosition({
      id: "position_sol",
      instrument: "solana:SOL",
      amount: solAmount,
      decimals: 9,
      components: [{ asset_id: "solana:SOL", amount_base_units: solAmount, decimals: 9 }],
    }),
    protocolPosition({
      id: "position_usdc",
      instrument: "solana:USDC",
      amount: String(usdcValue),
      decimals: 6,
      components: [{ asset_id: "solana:USDC", amount_base_units: String(usdcValue), decimals: 6 }],
    }),
    solMark({ freshness_state: staleSol ? "stale" : "fresh" }),
  ];
  if (solRouteability === "not_routeable") {
    observations.push(createSolanaExecutableExitObservation({
      position_id: "position_sol",
      input_amount_base_units: solAmount,
      routeability: "not_routeable",
      observed_at: NOW,
    }));
  }
  if (solRouteability === "routeable") {
    observations.push(createSolanaExecutableExitObservation({
      position_id: "position_sol",
      input_amount_base_units: solAmount,
      expected_output_minor: String(solValue),
      minimum_output_minor: String(solValue),
      routeability: "routeable",
      observed_at: NOW,
      expires_at: "2026-08-26T18:01:00.000Z",
    }));
  }
  return buildPortfolio(observations, suffix);
}

function unresolvedPortfolio(suffix = "unresolved") {
  const solAmount = "58000000000";
  return buildPortfolio([
    protocolPosition({
      id: "position_sol",
      instrument: "solana:SOL",
      amount: solAmount,
      decimals: 9,
      components: [{ asset_id: "solana:SOL", amount_base_units: solAmount, decimals: 9 }],
    }),
    protocolPosition({
      id: "position_usdc",
      instrument: "solana:USDC",
      amount: "3000",
      decimals: 6,
      components: [{ asset_id: "solana:USDC", amount_base_units: "3000", decimals: 6 }],
    }),
    protocolPosition({
      id: "position_unknown",
      instrument: "solana:unknown_receipt",
      protocol: "unrecognized_protocol",
      amount: "1000000",
      decimals: 6,
      components: [],
      underlying_state: "unavailable",
    }),
    solMark(),
    assetMark("solana:unknown_receipt", "1200"),
  ], suffix);
}

function policy(overrides = {}) {
  return createUserPolicyVersion({
    policy_id: "policy_monitor",
    policy_version_id: "policy_monitor_v1",
    version: 1,
    portfolio_id: "portfolio_policy_monitor",
    user_id: "user_policy_monitor",
    authored_at: NOW,
    effective_at: NOW,
    authored_by: { type: "user", user_id: "user_policy_monitor" },
    authority_mode: "policy_monitor",
    allocation_bands: [],
    capital_buckets: [],
    capital_bucket_assignments: [],
    concentration_limits: [],
    measurement_limits: [],
    protected_asset_ids: [],
    profit_routing: [],
    ...overrides,
  });
}

function evaluate(portfolio, userPolicy, suffix = "base", extras = {}) {
  return evaluatePortfolioPolicy({
    evaluation_id: `evaluation_${suffix}`,
    policy_version: userPolicy,
    snapshot: portfolio.snapshot,
    measurement: portfolio.measurement,
    calculated_at: NOW,
    ...extras,
  });
}

test("no policy cannot evaluate, while an empty user policy invents no target", () => {
  const portfolio = basePortfolio();
  assert.throws(() => evaluatePortfolioPolicy({
    evaluation_id: "evaluation_without_policy",
    snapshot: portfolio.snapshot,
    measurement: portfolio.measurement,
    calculated_at: NOW,
  }), /UserPolicyVersion_required/);

  const result = evaluate(portfolio, policy(), "empty_policy");
  assert.equal(result.evaluation.state, "confirmed_compliant");
  assert.equal(result.evaluation.configured_rule_count, 0);
  assert.equal(result.evaluation.portfolio_targets_inferred, false);
  assert.equal(result.evaluation.correction_calculated, false);
  assert.equal(result.evaluation.rebalance_calculation_created, false);
  assert.equal(result.evaluation.execution_quote_created, false);
  assert.equal(result.evaluation.execution_intent_created, false);
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.indeterminacies, []);
  assert.equal(result.outcome.reason_code, "portfolio_within_policy");
  assert.equal(JSON.stringify(result).includes("RebalanceCalculation"), false);
  assert.equal(JSON.stringify(result).includes("ExecutionQuote"), false);
  assert.equal(JSON.stringify(result).includes("ExecutionIntent"), false);
});

test("allocation boundaries are inclusive and tiny departures produce exact user-rule violations", () => {
  const portfolio = basePortfolio();
  const onBoundary = policy({
    allocation_bands: [
      { rule_id: "sol_min", scope_type: "asset", scope_id: "solana:SOL", minimum_bps: 7200 },
      { rule_id: "sol_max", scope_type: "asset", scope_id: "solana:SOL", maximum_bps: 7200 },
    ],
  });
  const exact = evaluate(portfolio, onBoundary, "exact_boundary");
  assert.equal(exact.evaluation.state, "confirmed_compliant");
  assert.deepEqual(exact.evaluation.rule_results.map((row) => row.state), ["confirmed_compliant", "confirmed_compliant"]);

  const aboveMaximum = policy({
    policy_version_id: "policy_monitor_above_max_v1",
    allocation_bands: [{ rule_id: "sol_max", scope_type: "asset", scope_id: "solana:SOL", maximum_bps: 7199 }],
  });
  const aboveResult = evaluate(portfolio, aboveMaximum, "above_maximum");
  assert.equal(aboveResult.evaluation.state, "confirmed_violation");
  assert.equal(aboveResult.violations[0].direction, "above_maximum");
  assert.equal(aboveResult.violations[0].delta_bps, 1);

  const belowMinimum = policy({
    policy_version_id: "policy_monitor_below_min_v1",
    allocation_bands: [{ rule_id: "sol_min", scope_type: "asset", scope_id: "solana:SOL", minimum_bps: 7201 }],
  });
  const belowResult = evaluate(portfolio, belowMinimum, "below_minimum");
  assert.equal(belowResult.evaluation.state, "confirmed_violation");
  assert.equal(belowResult.violations[0].direction, "below_minimum");
  assert.equal(belowResult.violations[0].delta_bps, 1);
});

test("compatible overlapping bands remain independent, while an impossible user policy is rejected", () => {
  const portfolio = basePortfolio();
  const compatible = policy({
    policy_version_id: "policy_overlapping_v1",
    allocation_bands: [
      { rule_id: "broad_sol", scope_type: "asset", scope_id: "solana:SOL", minimum_bps: 5000, maximum_bps: 8000 },
      { rule_id: "narrow_sol", scope_type: "asset", scope_id: "solana:SOL", minimum_bps: 7000, maximum_bps: 7500 },
    ],
  });
  const result = evaluate(portfolio, compatible, "overlapping");
  assert.equal(result.evaluation.state, "confirmed_compliant");
  assert.equal(result.evaluation.evaluated_rule_result_count, 2);

  assert.throws(() => policy({
    policy_version_id: "policy_conflicting_v1",
    allocation_bands: [
      { rule_id: "sol_floor", scope_type: "asset", scope_id: "solana:SOL", minimum_bps: 7500 },
      { rule_id: "sol_ceiling", scope_type: "asset", scope_id: "solana:SOL", maximum_bps: 7000 },
    ],
  }), /conflicting_policy_rules:asset:solana:SOL/);
  assert.throws(() => policy({
    policy_version_id: "policy_cross_rule_conflict_v1",
    allocation_bands: [
      { rule_id: "sol_floor", scope_type: "asset", scope_id: "solana:SOL", minimum_bps: 7500 },
    ],
    concentration_limits: [
      { rule_id: "single_asset_ceiling", scope_type: "asset", scope_id: "*", maximum_bps: 7000 },
    ],
  }), /conflicting_policy_rules:asset:solana:SOL/);
  assert.throws(() => policy({
    policy_version_id: "policy_measurement_conflict_v1",
    measurement_limits: [
      { rule_id: "coverage_floor", metric: "executable_coverage_bps", minimum_bps: 8000 },
      { rule_id: "coverage_ceiling", metric: "executable_coverage_bps", maximum_bps: 7000 },
    ],
  }), /conflicting_policy_rules:portfolio_measurement:executable_coverage_bps/);
});

test("resolved exposure can prove a violation while unresolved exposure makes a boundary-crossing result indeterminate", () => {
  const portfolio = unresolvedPortfolio();
  assert.equal(portfolio.measurement.unresolved_allocation_bps, 1200);
  const uncertain = policy({
    policy_version_id: "policy_uncertain_sol_v1",
    allocation_bands: [{ rule_id: "sol_max", scope_type: "asset", scope_id: "solana:SOL", maximum_bps: 6500 }],
  });
  const uncertainResult = evaluate(portfolio, uncertain, "uncertain_sol");
  assert.equal(uncertainResult.evaluation.state, "indeterminate");
  assert.equal(uncertainResult.indeterminacies[0].possible_minimum_bps, 5800);
  assert.equal(uncertainResult.indeterminacies[0].possible_maximum_bps, 7000);
  assert.equal(uncertainResult.indeterminacies[0].reason_codes.includes("unresolved_exposure"), true);
  assert.equal(uncertainResult.outcome.reason_code, "policy_evaluation_indeterminate");

  const proven = policy({
    policy_version_id: "policy_proven_sol_v1",
    allocation_bands: [{ rule_id: "sol_max", scope_type: "asset", scope_id: "solana:SOL", maximum_bps: 5500 }],
  });
  const provenResult = evaluate(portfolio, proven, "proven_sol");
  assert.equal(provenResult.evaluation.state, "confirmed_violation");
  assert.equal(provenResult.violations[0].current_bps, 5800);
  assert.equal(provenResult.violations[0].evidence.unresolved_relevant_value_minor, "1200");

  const unresolvedLimit = policy({
    policy_version_id: "policy_unresolved_limit_v1",
    measurement_limits: [{ rule_id: "unresolved_max", metric: "unresolved_exposure_bps", maximum_bps: 1000 }],
  });
  const unresolvedResult = evaluate(portfolio, unresolvedLimit, "unresolved_limit");
  assert.equal(unresolvedResult.evaluation.state, "confirmed_violation");
  assert.equal(unresolvedResult.violations[0].current_bps, 1200);
});

test("dimension-specific uncertainty does not double count a known protocol overlay", () => {
  const portfolio = unresolvedPortfolio("protocol_uncertainty");
  assert.equal(portfolio.measurement.unresolved_candidate_value_minor_by_scope_type.asset, "1200");
  assert.equal(portfolio.measurement.unresolved_candidate_value_minor_by_scope_type.protocol, "0");
  const userPolicy = policy({
    policy_version_id: "policy_unknown_protocol_v1",
    concentration_limits: [{ rule_id: "unknown_protocol_max", scope_type: "protocol", scope_id: "unrecognized_protocol", maximum_bps: 1100 }],
  });
  const result = evaluate(portfolio, userPolicy, "unknown_protocol");
  assert.equal(result.evaluation.state, "confirmed_violation");
  assert.equal(result.violations[0].current_bps, 1200);
  assert.equal(result.violations[0].evidence.unresolved_relevant_value_minor, "0");
});

test("stale valuation stays indeterminate instead of being silently treated as safe", () => {
  const portfolio = basePortfolio({ staleSol: true, suffix: "stale" });
  const userPolicy = policy({
    policy_version_id: "policy_stale_v1",
    allocation_bands: [{ rule_id: "sol_max", scope_type: "asset", scope_id: "solana:SOL", maximum_bps: 7500 }],
  });
  const result = evaluate(portfolio, userPolicy, "stale");
  assert.equal(result.evaluation.state, "indeterminate");
  assert.equal(result.indeterminacies[0].reason_codes.includes("stale_valuation"), true);
  assert.equal(result.violations.length, 0);
});

test("unknown routeability is indeterminate and a proven unrouteable allocation can violate the user's exact limit", () => {
  const limit = policy({
    policy_version_id: "policy_routeability_v1",
    measurement_limits: [{ rule_id: "illiquid_max", metric: "unrouteable_exposure_bps", maximum_bps: 1000 }],
  });
  const unknown = evaluate(basePortfolio({ solValue: 4000, usdcValue: 6000, suffix: "route_unknown" }), limit, "route_unknown");
  assert.equal(unknown.evaluation.state, "indeterminate");
  assert.equal(unknown.indeterminacies[0].possible_minimum_bps, 0);
  assert.equal(unknown.indeterminacies[0].possible_maximum_bps, 4000);
  assert.equal(unknown.indeterminacies[0].reason_codes.includes("routeability_unknown"), true);

  const unrouteable = evaluate(basePortfolio({ solValue: 4000, usdcValue: 6000, solRouteability: "not_routeable", suffix: "unrouteable" }), limit, "unrouteable");
  assert.equal(unrouteable.evaluation.state, "confirmed_violation");
  assert.equal(unrouteable.violations[0].scope_id, "unrouteable_exposure_bps");
  assert.equal(unrouteable.violations[0].current_bps, 4000);
});

test("capital-bucket classification is user-authored, protects cold positions, and creates no allocation target", () => {
  const portfolio = basePortfolio();
  const userPolicy = policy({
    policy_version_id: "policy_buckets_v1",
    capital_buckets: [
      { bucket_id: "cold", label: "Cold", kind: "cold" },
      { bucket_id: "reserve", label: "Reserve", kind: "reserve" },
    ],
    capital_bucket_assignments: [
      { assignment_id: "assign_sol_cold", subject_type: "asset", subject_id: "solana:SOL", bucket_id: "cold" },
    ],
  });
  const result = evaluate(portfolio, userPolicy, "bucket_classification");
  const sol = result.evaluation.capital_bucket_classifications.find((row) => row.position_id === "position_sol");
  const usdc = result.evaluation.capital_bucket_classifications.find((row) => row.position_id === "position_usdc");
  assert.equal(sol.bucket_id, "cold");
  assert.equal(sol.classification_source, "user_policy_version");
  assert.equal(usdc.bucket_id, "unclassified");
  assert.equal(result.evaluation.protected_position_ids.includes("position_sol"), true);
  assert.equal(result.evaluation.configured_rule_count, 0);
  assert.equal(result.evaluation.allocation_targets_created_from_classification, false);
  assert.deepEqual(result.violations, []);
});

test("a reserve minimum exists only when the user adds that exact bucket rule", () => {
  const portfolio = basePortfolio();
  const classificationOnly = policy({
    policy_version_id: "policy_reserve_classification_v1",
    capital_buckets: [{ bucket_id: "reserve", label: "Reserve", kind: "reserve" }],
    capital_bucket_assignments: [
      { assignment_id: "assign_usdc_reserve", subject_type: "asset", subject_id: "solana:USDC", bucket_id: "reserve" },
    ],
  });
  const withoutTarget = evaluate(portfolio, classificationOnly, "reserve_without_target");
  assert.equal(withoutTarget.evaluation.state, "confirmed_compliant");
  assert.equal(withoutTarget.evaluation.configured_rule_count, 0);

  const withMinimum = policy({
    policy_version_id: "policy_reserve_minimum_v1",
    capital_buckets: [{ bucket_id: "reserve", label: "Reserve", kind: "reserve" }],
    capital_bucket_assignments: [
      { assignment_id: "assign_usdc_reserve", subject_type: "asset", subject_id: "solana:USDC", bucket_id: "reserve" },
    ],
    allocation_bands: [{ rule_id: "reserve_minimum", scope_type: "bucket", scope_id: "reserve", minimum_bps: 3000 }],
  });
  const governed = evaluate(portfolio, withMinimum, "reserve_with_target");
  assert.equal(governed.evaluation.state, "confirmed_violation");
  assert.equal(governed.violations[0].current_bps, 2800);
  assert.equal(governed.violations[0].desired_state_source, "user_policy_version");
});

test("issuer and shared-dependency concentration are evaluated as separate user-authored dimensions", () => {
  const usdtAmount = "3000";
  const portfolio = buildPortfolio([
    protocolPosition({
      id: "position_usdc",
      instrument: "solana:USDC",
      amount: "7000",
      decimals: 6,
      components: [{ asset_id: "solana:USDC", amount_base_units: "7000", decimals: 6 }],
    }),
    protocolPosition({
      id: "position_usdt",
      instrument: "solana:USDT",
      amount: usdtAmount,
      decimals: 6,
      components: [{ asset_id: "solana:USDT", mint: SOLANA_USDT_MINT, amount_base_units: usdtAmount, decimals: 6 }],
    }),
    createSolanaMarkObservation({
      asset_id: "solana:USDT",
      mint: SOLANA_USDT_MINT,
      price_numerator_minor: "1000000",
      price_denominator_base_units: "1000000",
      observed_at: NOW,
    }),
  ], "stablecoin_dependencies");
  const userPolicy = policy({
    policy_version_id: "policy_stable_dependencies_v1",
    concentration_limits: [
      { rule_id: "issuer_max", scope_type: "stablecoin_issuer", scope_id: "*", maximum_bps: 6000 },
      { rule_id: "dependency_max", scope_type: "stablecoin_dependency", scope_id: "*", maximum_bps: 6000 },
    ],
  });
  const result = evaluate(portfolio, userPolicy, "stablecoin_dependencies");
  assert.equal(result.evaluation.state, "confirmed_violation");
  assert.equal(result.violations.some((row) => row.scope_type === "stablecoin_issuer" && row.scope_id === "circle" && row.current_bps === 7000), true);
  assert.equal(result.violations.some((row) => row.scope_type === "stablecoin_dependency" && row.scope_id === "circle:usd_reserve" && row.current_bps === 7000), true);
});

test("gross leverage and liabilities remain visible and can only violate a configured measurement rule", () => {
  const solAmount = "100000000000";
  const portfolio = buildPortfolio([
    protocolPosition({
      id: "lending_supply_sol",
      instrument: "solana:lending_receipt:sol",
      protocol: "fixture_lending",
      kind: "lending_supply",
      amount: solAmount,
      decimals: 9,
      components: [{ asset_id: "solana:SOL", amount_base_units: solAmount, decimals: 9 }],
    }),
    protocolPosition({
      id: "lending_borrow_usdc",
      instrument: "solana:lending_debt:usdc",
      protocol: "fixture_lending",
      kind: "lending_borrow",
      amount: "4000",
      decimals: 6,
      exposure_side: "liability",
      components: [{ asset_id: "solana:USDC", amount_base_units: "4000", decimals: 6, exposure_side: "liability" }],
    }),
    solMark(),
  ], "leverage");
  assert.equal(portfolio.measurement.total_marked_asset_value_minor, "10000");
  assert.equal(portfolio.measurement.total_liability_value_minor, "4000");
  assert.equal(portfolio.measurement.net_equity_minor, "6000");
  assert.equal(portfolio.measurement.gross_leverage_bps, 23333);

  const emptyPolicyResult = evaluate(portfolio, policy(), "leverage_without_rule");
  assert.equal(emptyPolicyResult.evaluation.state, "confirmed_compliant");
  const governed = policy({
    policy_version_id: "policy_leverage_v1",
    measurement_limits: [{ rule_id: "gross_leverage_max", metric: "gross_leverage_bps", maximum_bps: 20000 }],
  });
  const result = evaluate(portfolio, governed, "leverage_with_rule");
  assert.equal(result.evaluation.state, "confirmed_violation");
  assert.equal(result.violations[0].current_bps, 23333);
});

test("an unvalued liability makes liability policy compliance indeterminate rather than safe", () => {
  const portfolio = buildPortfolio([
    protocolPosition({
      id: "reserve_usdc",
      instrument: "solana:USDC",
      amount: "10000",
      decimals: 6,
      components: [{ asset_id: "solana:USDC", amount_base_units: "10000", decimals: 6 }],
    }),
    protocolPosition({
      id: "unknown_borrow",
      instrument: "solana:lending_debt:unknown",
      protocol: "fixture_lending",
      kind: "lending_borrow",
      amount: "5000000",
      decimals: 6,
      exposure_side: "liability",
      components: [{ asset_id: "solana:UNKNOWN_DEBT", amount_base_units: "5000000", decimals: 6, exposure_side: "liability" }],
    }),
  ], "unknown_liability");
  const userPolicy = policy({
    policy_version_id: "policy_unknown_liability_v1",
    measurement_limits: [{ rule_id: "liability_max", metric: "liability_exposure_bps", maximum_bps: 1000 }],
  });
  const result = evaluate(portfolio, userPolicy, "unknown_liability");
  assert.equal(portfolio.measurement.net_equity_minor, null);
  assert.equal(result.evaluation.state, "indeterminate");
  assert.equal(result.indeterminacies[0].reason_codes.includes("valuation_unavailable"), true);
  assert.equal(result.violations.length, 0);
});

test("immutable policy and snapshot changes produce new provenance while identical inputs stay deterministic", () => {
  const firstPortfolio = basePortfolio({ suffix: "provenance_v1" });
  const v1 = policy({
    policy_version_id: "policy_provenance_v1",
    allocation_bands: [{ rule_id: "sol_max", scope_type: "asset", scope_id: "solana:SOL", maximum_bps: 7000 }],
  });
  const first = evaluate(firstPortfolio, v1, "provenance_v1");
  const replay = evaluate(firstPortfolio, v1, "provenance_v1");
  assert.equal(first.evaluation.record_hash, replay.evaluation.record_hash);
  assert.equal(first.violations[0].record_hash, replay.violations[0].record_hash);

  const changedPortfolio = basePortfolio({ solValue: 7100, usdcValue: 2900, suffix: "provenance_snapshot_v2" });
  const changedSnapshot = evaluate(changedPortfolio, v1, "provenance_snapshot_v2");
  assert.notEqual(first.evaluation.snapshot_ref.record_hash, changedSnapshot.evaluation.snapshot_ref.record_hash);
  assert.notEqual(first.violations[0].violation_id, changedSnapshot.violations[0].violation_id);

  const v2 = policy({
    policy_version_id: "policy_provenance_v2",
    version: 2,
    supersedes_policy_version_id: "policy_provenance_v1",
    allocation_bands: [{ rule_id: "sol_max", scope_type: "asset", scope_id: "solana:SOL", maximum_bps: 7100 }],
  });
  const changedPolicy = evaluate(firstPortfolio, v2, "provenance_policy_v2");
  assert.notEqual(first.evaluation.policy_ref.record_hash, changedPolicy.evaluation.policy_ref.record_hash);
  assert.notEqual(first.violations[0].violation_id, changedPolicy.violations[0].violation_id);
});

test("market posture has no policy authority unless the user explicitly activates a pre-authored version", () => {
  const portfolio = basePortfolio();
  const active = policy({ policy_version_id: "policy_posture_normal_v1" });
  const defensive = policy({
    policy_id: "policy_posture_defensive",
    policy_version_id: "policy_posture_defensive_v1",
    allocation_bands: [{ rule_id: "sol_max", scope_type: "asset", scope_id: "solana:SOL", maximum_bps: 7000 }],
  });
  const observation = createObservation({
    observation_id: "posture_observation",
    observed_at: NOW,
    observed_by: "raven",
    source_category: "market_measurement",
    facts: { volatility: "elevated" },
  });
  const posture = createMarketPosture({
    market_posture_id: "market_posture_defensive",
    observed_at: NOW,
    posture: "defensive",
    methodology_version: "market_posture.v1",
    observations: [observation],
  });
  const withoutRule = resolvePolicyForMarketPosture({ activePolicy: active, marketPosture: posture, occurredAt: NOW });
  assert.equal(withoutRule.ok, false);
  assert.strictEqual(withoutRule.active_policy, active);
  const before = evaluate(portfolio, active, "posture_no_authority", { market_posture: posture });
  assert.equal(before.evaluation.configured_rule_count, 0);
  assert.equal(before.evaluation.market_posture_effect, "none");

  const activation = createPolicyActivationRule({
    activation_rule_id: "activate_defensive",
    user_id: "user_policy_monitor",
    portfolio_id: "portfolio_policy_monitor",
    market_posture: "defensive",
    activate_policy_version_id: "policy_posture_defensive_v1",
    authored_at: NOW,
    authored_by: { type: "user", user_id: "user_policy_monitor" },
  });
  const selected = resolvePolicyForMarketPosture({
    activePolicy: active,
    marketPosture: posture,
    activationRule: activation,
    policyVersions: [active, defensive],
    occurredAt: NOW,
  });
  assert.equal(selected.ok, true);
  assert.strictEqual(selected.active_policy, defensive);
  const after = evaluate(portfolio, selected.active_policy, "posture_user_activated");
  assert.equal(after.evaluation.state, "confirmed_violation");
  assert.equal(after.evaluation.policy_ref.record_id, "policy_posture_defensive_v1");
});

test("profit accounting separates principal, losses, zero PnL, and friction-complete distributable profit", () => {
  const routingPolicy = policy({
    policy_version_id: "policy_profit_routing_v1",
    capital_buckets: [
      { bucket_id: "reserve", label: "Reserve", kind: "reserve" },
      { bucket_id: "retained", label: "Retained", kind: "retained" },
    ],
    profit_routing: [
      { route_id: "profit_reserve", destination_bucket_id: "reserve", share_bps: 5000 },
      { route_id: "profit_retained", destination_bucket_id: "retained", share_bps: 5000 },
    ],
  });
  const positive = createFundingEvent({
    funding_event_id: "funding_positive",
    portfolio_id: "portfolio_policy_monitor",
    user_id: "user_policy_monitor",
    occurred_at: NOW,
    event_type: "realized_profit",
    gross_amount_minor: "1000",
    fee_amount_minor: "100",
    friction_amount_minor: "50",
    source_outcome_ref: "settlement_positive",
  });
  assert.equal(positive.net_distributable_amount_minor, "850");
  const routed = calculateProfitRouting({
    routing_calculation_id: "routing_positive",
    policy_version: routingPolicy,
    funding_event: positive,
    calculated_at: NOW,
  });
  assert.equal(routed.ok, true);
  assert.deepEqual(routed.calculation.allocations.map((row) => row.amount_minor), ["425", "425"]);
  assert.equal(routed.calculation.principal_routed, false);

  const cases = [
    { id: "deposit", type: "deposit", gross: "1000", fees: "0", friction: "0" },
    { id: "flat", type: "realized_flat", gross: "0", fees: "0", friction: "0" },
    { id: "loss", type: "realized_loss", gross: "500", fees: "10", friction: "5" },
    { id: "fee_heavy", type: "realized_profit", gross: "100", fees: "80", friction: "20" },
  ];
  for (const row of cases) {
    const event = createFundingEvent({
      funding_event_id: `funding_${row.id}`,
      portfolio_id: "portfolio_policy_monitor",
      user_id: "user_policy_monitor",
      occurred_at: NOW,
      event_type: row.type,
      gross_amount_minor: row.gross,
      fee_amount_minor: row.fees,
      friction_amount_minor: row.friction,
      source_outcome_ref: `settlement_${row.id}`,
    });
    assert.equal(event.net_distributable_amount_minor, "0");
    const result = calculateProfitRouting({
      routing_calculation_id: `routing_${row.id}`,
      policy_version: routingPolicy,
      funding_event: event,
      calculated_at: NOW,
    });
    assert.equal(result.ok, false);
    assert.equal(result.refusal.reason_code, "no_distributable_profit");
    assert.equal(result.refusal.persistable, true);
  }

  const noUserRoutes = calculateProfitRouting({
    routing_calculation_id: "routing_without_user_rule",
    policy_version: policy({ policy_version_id: "policy_no_profit_routes_v1" }),
    funding_event: positive,
    calculated_at: NOW,
  });
  assert.equal(noUserRoutes.ok, false);
  assert.equal(noUserRoutes.refusal.reason_code, "profit_routing_not_configured");
});
