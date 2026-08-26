import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateProfitRouting,
  calculateRebalance,
  createExecutionQuote,
  createFundingEvent,
  createGovernorExecutionIntent,
  createMarketPosture,
  createObservation,
  createPolicyActivationRule,
  createPortfolioMeasurement,
  createPortfolioSnapshot,
  createUserAuthorization,
  createUserPolicyVersion,
  evaluatePortfolioPolicy,
  resolvePolicyForMarketPosture,
  verifyGovernorRecord,
} from "../lib/portfolio_governor/domain.mjs";

const NOW = "2026-08-26T18:00:00.000Z";

function snapshot(overrides = {}) {
  return createPortfolioSnapshot({
    snapshot_id: "snap_001",
    portfolio_id: "portfolio_001",
    user_id: "user_001",
    observed_at: NOW,
    economic_numeraire: "USDC",
    positions: [
      {
        position_id: "position_sol",
        economic_lot_id: "wallet:sol",
        asset_id: "solana:SOL",
        bucket_id: "warm",
        executable_value_minor: "7200",
        liability_value_minor: "0",
        routeability: "routeable",
        valuation_confidence: "high",
        valuation_source: "executable_quote",
        observed_at: NOW,
      },
      {
        position_id: "position_usdc",
        economic_lot_id: "wallet:usdc",
        asset_id: "solana:USDC",
        bucket_id: "reserve",
        stablecoin_issuer_id: "circle",
        executable_value_minor: "2300",
        liability_value_minor: "0",
        routeability: "routeable",
        valuation_confidence: "high",
        valuation_source: "executable_quote",
        observed_at: NOW,
      },
      {
        position_id: "position_cold_btc",
        economic_lot_id: "wallet:cold:btc",
        asset_id: "bitcoin:BTC",
        bucket_id: "cold",
        executable_value_minor: "500",
        liability_value_minor: "0",
        routeability: "routeable",
        valuation_confidence: "high",
        valuation_source: "executable_quote",
        observed_at: NOW,
      },
    ],
    ...overrides,
  });
}

function policy(overrides = {}) {
  return createUserPolicyVersion({
    policy_id: "policy_001",
    policy_version_id: "policy_001_v1",
    version: 1,
    portfolio_id: "portfolio_001",
    user_id: "user_001",
    authored_at: NOW,
    effective_at: NOW,
    authored_by: { type: "user", user_id: "user_001" },
    authority_mode: "user_signed_rebalance",
    allocation_bands: [
      { rule_id: "band_sol", scope_type: "asset", scope_id: "solana:SOL", minimum_bps: 5000, maximum_bps: 7000 },
      { rule_id: "band_reserve", scope_type: "bucket", scope_id: "reserve", minimum_bps: 2500, maximum_bps: 5000 },
    ],
    capital_buckets: [
      { bucket_id: "cold", label: "Cold", kind: "cold", protected_from_sale: true },
      { bucket_id: "warm", label: "Warm", kind: "warm" },
      { bucket_id: "reserve", label: "Reserve", kind: "reserve" },
      { bucket_id: "retained", label: "Retained", kind: "retained" },
    ],
    concentration_limits: [
      { rule_id: "issuer_limit", scope_type: "stablecoin_issuer", scope_id: "*", maximum_bps: 6000 },
    ],
    protected_asset_ids: [],
    allowed_asset_ids: ["bitcoin:BTC", "solana:SOL", "solana:USDC"],
    allowed_venues: ["jupiter"],
    profit_routing: [
      { route_id: "profit_cold", destination_bucket_id: "cold", share_bps: 5000 },
      { route_id: "profit_warm", destination_bucket_id: "warm", share_bps: 3000 },
      { route_id: "profit_retained", destination_bucket_id: "retained", share_bps: 2000 },
    ],
    execution_permissions: {
      requires_user_signature: true,
      maximum_transaction_minor: "5000",
      minimum_trade_minor: "10",
      daily_turnover_limit_minor: "7000",
      maximum_friction_bps: 100,
      minimum_quote_confidence: "medium",
    },
    ...overrides,
  });
}

function measured(portfolioSnapshot = snapshot(), id = "measurement_001") {
  return createPortfolioMeasurement({
    measurement_id: id,
    snapshot: portfolioSnapshot,
    calculated_at: NOW,
    methodology_version: "economic_exposure.v1",
  });
}

function evaluated(userPolicy = policy(), portfolioSnapshot = snapshot(), measurement = measured(portfolioSnapshot)) {
  return evaluatePortfolioPolicy({
    evaluation_id: "evaluation_001",
    policy_version: userPolicy,
    snapshot: portfolioSnapshot,
    measurement,
    calculated_at: NOW,
  });
}

function solViolation(evaluationResult) {
  return evaluationResult.violations.find((row) => row.rule_id === "band_sol");
}

function validCalculation(userPolicy = policy(), portfolioSnapshot = snapshot(), measurement = measured(portfolioSnapshot)) {
  const evaluation = evaluated(userPolicy, portfolioSnapshot, measurement);
  const result = calculateRebalance({
    calculation_id: "calculation_001",
    policy_version: userPolicy,
    snapshot: portfolioSnapshot,
    measurement,
    violation: solViolation(evaluation),
    calculated_at: NOW,
    action: {
      action_type: "route_inflow",
      amount_minor: "1000",
      destination: { asset_id: "solana:USDC", bucket_id: "reserve", stablecoin_issuer_id: "circle" },
    },
  });
  assert.equal(result.ok, true);
  return result.calculation;
}

test("only the user can author a policy and Raven cannot invent an allocation target", () => {
  assert.throws(() => policy({ authored_by: { type: "raven", user_id: "user_001" } }), /user_policy_author_required/);
  const noTargets = policy({
    policy_version_id: "policy_no_targets_v1",
    allocation_bands: [],
    concentration_limits: [],
  });
  const portfolioSnapshot = snapshot();
  const measurement = measured(portfolioSnapshot);
  const result = evaluated(noTargets, portfolioSnapshot, measurement);
  assert.equal(noTargets.raven_may_select_targets, false);
  assert.deepEqual(noTargets.allocation_bands, []);
  assert.deepEqual(result.violations, []);
  assert.equal(result.outcome.reason_code, "portfolio_within_policy");
  assert.equal(result.outcome.outcome_class, "no_action");
  const calculation = calculateRebalance({
    calculation_id: "calculation_without_target",
    policy_version: noTargets,
    snapshot: portfolioSnapshot,
    measurement,
    calculated_at: NOW,
  });
  assert.equal(calculation.ok, false);
  assert.equal(calculation.refusal.reason_code, "policy_target_absent");
});

test("policy evaluation reports the user's exact bands without selecting a tactical point inside them", () => {
  const userPolicy = policy();
  const portfolioSnapshot = snapshot();
  const measurement = measured(portfolioSnapshot);
  const result = evaluated(userPolicy, portfolioSnapshot, measurement);
  const sol = solViolation(result);
  const reserve = result.violations.find((row) => row.rule_id === "band_reserve");
  assert.equal(result.evaluation.state, "outside_policy");
  assert.equal(sol.current_bps, 7200);
  assert.equal(sol.boundary_bps, 7000);
  assert.equal(sol.desired_state_source, "user_policy_version");
  assert.equal(reserve.current_bps, 2300);
  assert.equal(reserve.boundary_bps, 2500);
  assert.equal("recommended_target_bps" in sol, false);
});

test("a rebalance calculation cannot overshoot the user's configured allocation band", () => {
  const userPolicy = policy({ execution_permissions: {
    requires_user_signature: true,
    maximum_transaction_minor: "10000",
    minimum_trade_minor: "10",
    daily_turnover_limit_minor: "10000",
    maximum_friction_bps: 100,
    minimum_quote_confidence: "medium",
  } });
  const portfolioSnapshot = snapshot();
  const measurement = measured(portfolioSnapshot);
  const evaluation = evaluated(userPolicy, portfolioSnapshot, measurement);
  const result = calculateRebalance({
    calculation_id: "calculation_overshoot",
    policy_version: userPolicy,
    snapshot: portfolioSnapshot,
    measurement,
    violation: solViolation(evaluation),
    calculated_at: NOW,
    action: {
      action_type: "internal_reallocation",
      source_position_id: "position_sol",
      amount_minor: "5000",
      destination: { asset_id: "solana:USDC", bucket_id: "reserve", stablecoin_issuer_id: "circle" },
      venue: "jupiter",
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.refusal.reason_code, "correction_outside_user_band");
});

test("cold and otherwise protected assets cannot be sold by a rebalance calculation", () => {
  const userPolicy = policy();
  const portfolioSnapshot = snapshot();
  const measurement = measured(portfolioSnapshot);
  const evaluation = evaluated(userPolicy, portfolioSnapshot, measurement);
  const result = calculateRebalance({
    calculation_id: "calculation_cold_sale",
    policy_version: userPolicy,
    snapshot: portfolioSnapshot,
    measurement,
    violation: solViolation(evaluation),
    calculated_at: NOW,
    action: {
      action_type: "internal_reallocation",
      source_position_id: "position_cold_btc",
      amount_minor: "100",
      destination: { asset_id: "solana:USDC", bucket_id: "reserve", stablecoin_issuer_id: "circle" },
      venue: "jupiter",
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.refusal.reason_code, "cold_asset_protected");
  assert.equal(result.refusal.persistable, true);
});

test("execution intent creation fails closed without exact user authorization", () => {
  const result = createGovernorExecutionIntent({ created_at: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.refusal.reason_code, "authorization_missing");
  assert.equal(result.refusal.provenance.role, "deterministic_outcome");
  assert.equal(verifyGovernorRecord(result.refusal).ok, true);
});

test("a policy change invalidates a calculation before quote and a quote before authorization", () => {
  const v1 = policy();
  const portfolioSnapshot = snapshot();
  const measurement = measured(portfolioSnapshot);
  const calculation = validCalculation(v1, portfolioSnapshot, measurement);
  const v2 = policy({
    policy_version_id: "policy_001_v2",
    version: 2,
    supersedes_policy_version_id: "policy_001_v1",
    authored_at: "2026-08-26T18:00:10.000Z",
    effective_at: "2026-08-26T18:00:10.000Z",
  });
  const staleCalculationQuote = createExecutionQuote({
    policy_version: v2,
    snapshot: portfolioSnapshot,
    calculation,
    quote_id: "quote_stale_calculation",
    observed_at: "2026-08-26T18:00:20.000Z",
    expires_at: "2026-08-26T18:01:20.000Z",
    now: "2026-08-26T18:00:20.000Z",
  });
  assert.equal(staleCalculationQuote.ok, false);
  assert.equal(staleCalculationQuote.refusal.reason_code, "policy_changed_since_quote");

  const quoteResult = createExecutionQuote({
    policy_version: v1,
    snapshot: portfolioSnapshot,
    calculation,
    quote_id: "quote_v1",
    observed_at: "2026-08-26T18:00:20.000Z",
    expires_at: "2026-08-26T18:01:20.000Z",
    now: "2026-08-26T18:00:20.000Z",
    venue: "jupiter",
    route_id: "route_v1",
    input_asset_id: "external:USDC",
    input_amount_base_units: "1000",
    expected_output_asset_id: "solana:USDC",
    expected_output_amount_base_units: "1000",
    minimum_output_amount_base_units: "995",
    total_friction_bps: 50,
    confidence: "high",
    routeable: true,
    provider_evidence_ref: "jupiter:quote:v1",
  });
  assert.equal(quoteResult.ok, true);
  const staleQuoteAuthorization = createUserAuthorization({
    authorization_id: "authorization_stale_policy",
    current_policy_version: v2,
    current_snapshot: portfolioSnapshot,
    quote: quoteResult.quote,
    user_id: "user_001",
    wallet_link_id: "wallet_001",
    user_confirmation: true,
    authorized_at: "2026-08-26T18:00:30.000Z",
  });
  assert.equal(staleQuoteAuthorization.ok, false);
  assert.equal(staleQuoteAuthorization.refusal.reason_code, "policy_changed_since_quote");
});

test("market posture alone cannot mutate or select a portfolio policy", () => {
  const observation = createObservation({
    observation_id: "observation_001",
    observed_at: NOW,
    observed_by: "raven",
    source_category: "market_measurements",
    freshness_state: "fresh",
    facts: { volatility: "elevated" },
  });
  const posture = createMarketPosture({
    market_posture_id: "posture_001",
    observed_at: NOW,
    posture: "defensive",
    methodology_version: "market_posture.v1",
    observations: [observation],
  });
  const active = policy();
  const result = resolvePolicyForMarketPosture({
    activePolicy: active,
    marketPosture: posture,
    occurredAt: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.refusal.reason_code, "market_posture_has_no_policy_authority");
  assert.strictEqual(result.active_policy, active);
  assert.equal(posture.portfolio_policy_effect, "none_without_user_authored_activation_rule");
});

test("market posture can select only a policy consequence explicitly authored by the user", () => {
  const observation = createObservation({
    observation_id: "observation_defensive",
    observed_at: NOW,
    observed_by: "raven",
    source_category: "market_measurements",
    freshness_state: "fresh",
    facts: { liquidity: "deteriorating" },
  });
  const posture = createMarketPosture({
    market_posture_id: "posture_defensive",
    observed_at: NOW,
    posture: "defensive",
    methodology_version: "market_posture.v1",
    observations: [observation],
  });
  const active = policy();
  const defensive = policy({
    policy_id: "policy_defensive",
    policy_version_id: "policy_defensive_v1",
  });
  const activationRule = createPolicyActivationRule({
    activation_rule_id: "activation_defensive",
    user_id: "user_001",
    portfolio_id: "portfolio_001",
    market_posture: "defensive",
    activate_policy_version_id: "policy_defensive_v1",
    authored_at: NOW,
    authored_by: { type: "user", user_id: "user_001" },
  });
  const result = resolvePolicyForMarketPosture({
    activePolicy: active,
    marketPosture: posture,
    activationRule,
    policyVersions: [active, defensive],
    occurredAt: NOW,
  });
  assert.equal(result.ok, true);
  assert.strictEqual(result.active_policy, defensive);
  assert.equal(result.activation_rule.provenance.origin, "user");
});

test("loss exits never create distributable profit", () => {
  const userPolicy = policy();
  const loss = createFundingEvent({
    funding_event_id: "funding_loss_001",
    portfolio_id: "portfolio_001",
    user_id: "user_001",
    occurred_at: NOW,
    event_type: "realized_loss",
    amount_minor: "125",
    source_outcome_ref: "settlement_loss_001",
  });
  const result = calculateProfitRouting({
    routing_calculation_id: "routing_loss_001",
    policy_version: userPolicy,
    funding_event: loss,
    calculated_at: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.refusal.reason_code, "no_distributable_profit");
  assert.equal(result.refusal.persistable, true);
});

test("a positive funding event follows only the user's explicit profit-routing percentages", () => {
  const userPolicy = policy();
  const profit = createFundingEvent({
    funding_event_id: "funding_profit_001",
    portfolio_id: "portfolio_001",
    user_id: "user_001",
    occurred_at: NOW,
    event_type: "realized_profit",
    amount_minor: "1000",
    source_outcome_ref: "settlement_profit_001",
  });
  const result = calculateProfitRouting({
    routing_calculation_id: "routing_profit_001",
    policy_version: userPolicy,
    funding_event: profit,
    calculated_at: NOW,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.calculation.allocations.map((row) => row.amount_minor), ["500", "300", "200"]);
  assert.equal(result.calculation.routing_source, "user_policy_version");
  assert.equal(result.calculation.balance_mutation_performed, false);
});

test("the valid v1 path remains non-custodial and stops at the user's wallet signature", () => {
  const userPolicy = policy();
  const portfolioSnapshot = snapshot();
  const measurement = measured(portfolioSnapshot);
  const calculation = validCalculation(userPolicy, portfolioSnapshot, measurement);
  const quoteResult = createExecutionQuote({
    policy_version: userPolicy,
    snapshot: portfolioSnapshot,
    calculation,
    quote_id: "quote_001",
    observed_at: "2026-08-26T18:00:10.000Z",
    expires_at: "2026-08-26T18:01:10.000Z",
    now: "2026-08-26T18:00:10.000Z",
    venue: "jupiter",
    route_id: "route_001",
    input_asset_id: "external:USDC",
    input_amount_base_units: "1000",
    expected_output_asset_id: "solana:USDC",
    expected_output_amount_base_units: "1000",
    minimum_output_amount_base_units: "995",
    total_friction_bps: 50,
    confidence: "high",
    routeable: true,
    provider_evidence_ref: "jupiter:quote:001",
  });
  assert.equal(quoteResult.ok, true);
  const authorizationResult = createUserAuthorization({
    authorization_id: "authorization_001",
    current_policy_version: userPolicy,
    current_snapshot: portfolioSnapshot,
    quote: quoteResult.quote,
    user_id: "user_001",
    wallet_link_id: "wallet_001",
    user_confirmation: true,
    authorized_at: "2026-08-26T18:00:20.000Z",
  });
  assert.equal(authorizationResult.ok, true);
  const intentResult = createGovernorExecutionIntent({
    execution_intent_id: "execution_intent_001",
    current_policy_version: userPolicy,
    quote: quoteResult.quote,
    authorization: authorizationResult.authorization,
    created_at: "2026-08-26T18:00:30.000Z",
  });
  assert.equal(intentResult.ok, true);
  assert.equal(intentResult.execution_intent.state, "awaiting_user_signature");
  assert.equal(intentResult.execution_intent.custody_model, "non_custodial");
  assert.equal(intentResult.execution_intent.raven_private_key_access, false);
  assert.equal(intentResult.execution_intent.raven_omnibus_account, false);
  assert.equal(intentResult.execution_intent.submission_authorized, false);
  assert.equal(intentResult.execution_intent.policy_ref.record_id, userPolicy.policy_version_id);
  assert.equal(verifyGovernorRecord(intentResult.execution_intent).ok, true);
});

test("policy versions and auditable records are immutable after construction", () => {
  const userPolicy = policy();
  assert.equal(Object.isFrozen(userPolicy), true);
  assert.equal(Object.isFrozen(userPolicy.allocation_bands), true);
  assert.throws(() => {
    userPolicy.allocation_bands[0].maximum_bps = 9000;
  }, TypeError);
  assert.equal(verifyGovernorRecord(userPolicy).ok, true);
  const tampered = { ...userPolicy, authority_mode: "observe" };
  assert.equal(verifyGovernorRecord(tampered).ok, false);
});
