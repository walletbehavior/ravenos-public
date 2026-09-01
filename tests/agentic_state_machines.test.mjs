import assert from "node:assert/strict";
import test from "node:test";

import {
  agenticRecordReference,
  canTransitionAgentState,
  createAgentLifecycle,
  createAgentSpec,
  createEvidencePacket,
  createPlanLifecycle,
  createPolicyDecision,
  createTradeIntent,
  createTradePlan,
  normalizeAssetIdentity,
  normalizeInstrumentIdentity,
  transitionAgentLifecycle,
  transitionPlanLifecycle,
  verifyLifecycle,
} from "../lib/agentic_trading/index.mjs";

const SOL_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_TOKEN_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6qM5UXB263hLtB1p";
const at = (seconds) => `2026-09-01T12:00:${String(seconds).padStart(2, "0")}.000Z`;
const EXPIRY = "2026-09-01T12:05:00.000Z";

function fixture() {
  const solUsdc = normalizeAssetIdentity({ chain_id: "solana", kind: "stablecoin", standard: "spl", reference: SOL_USDC_MINT, symbol: "USDC", issuer_id: "circle", representation: "canonical" });
  const solToken = normalizeAssetIdentity({ chain_id: "solana", kind: "fungible_token", standard: "spl", reference: SOL_TOKEN_MINT, symbol: "SOL", representation: "canonical" });
  const solGas = normalizeAssetIdentity({ chain_id: "solana", kind: "native", standard: "native", reference: "SOL", symbol: "SOL", representation: "native" });
  const spotInstrument = normalizeInstrumentIdentity({ kind: "spot", venue: "jupiter", base_asset: solToken, quote_asset: solUsdc, settlement_asset: solUsdc });
  const hlUsdc = normalizeAssetIdentity({ chain_id: "hyperliquid", kind: "stablecoin", standard: "venue-asset", reference: "USDC", symbol: "USDC", issuer_id: "circle", representation: "canonical" });
  const hlSol = normalizeAssetIdentity({ chain_id: "hyperliquid", kind: "fungible_token", standard: "venue-asset", reference: "SOL", symbol: "SOL", representation: "native" });
  const perpInstrument = normalizeInstrumentIdentity({ kind: "perpetual", venue: "hyperliquid", base_asset: hlSol, quote_asset: hlUsdc, settlement_asset: hlUsdc, market_reference: "SOL" });
  const spec = createAgentSpec({
    agent_id: "agent_state_test",
    version: 1,
    owner_tenant_id: "tenant_001",
    name: "Lifecycle test",
    strategy_type: "cross_venue",
    allowed_chains: ["solana", "hyperliquid"],
    allowed_venues: ["jupiter", "hyperliquid"],
    allowed_instruments: [spotInstrument, perpInstrument],
    evidence_requirements: [{ requirement_id: "portfolio", evidence_type: "portfolio", maximum_age_ms: 10_000, material: true, allowed_providers: ["raven"] }],
    entry_rules: { type: "typed" },
    exit_rules: { type: "typed" },
    position_sizing: { mode: "fixed_notional", value: "100", asset_id: solUsdc.asset_id, maximum_per_leg: "100", maximum_total: "200" },
    multi_leg_dependency_rules: { atomicity_assumed: false },
    hedge_requirements: { required: true },
    rebalancing_rules: {},
    triggers: { event: "signal" },
    autonomy_level: "paper",
    risk_policy_ref: { policy_id: "policy_001", policy_version_id: "policy_001_v1", version: 1, policy_hash: "policy_hash_001" },
    approval_requirements: { live: true },
    starts_at: at(0),
    expires_at: "2026-09-02T12:00:00.000Z",
    planner_model_version: "model-1",
    compiler_version: "compiler-1",
  });
  const packet = createEvidencePacket({
    evidence_packet_id: "evidence_state_test",
    agent_spec: spec,
    decision_at: at(1),
    unified_portfolio_snapshot_ref: { record_id: "portfolio_001", record_hash: "portfolio_hash" },
    observations: [{
      observation_id: "portfolio_obs",
      requirement_id: "portfolio",
      evidence_type: "portfolio",
      provider: "raven",
      source: "portfolio governor",
      chain_id: "solana",
      observed_at: at(0),
      retrieved_at: at(1),
      expires_at: EXPIRY,
      finality_state: "provider_confirmed",
      freshness_state: "fresh",
      verification_state: "verified",
      facts: { solana_usdc: "500", hyperliquid_usdc: "500" },
      raw_evidence_ref: "portfolio:001",
    }],
  });
  const common = {
    plan_id: "plan_state_test",
    agent_spec_ref: agenticRecordReference(spec),
    evidence_packet_ref: agenticRecordReference(packet),
    order_constraints: { order_type: "market", maximum_slippage_bps: 100, maximum_price_impact_bps: 150, time_in_force: "ioc" },
    quote_requirements: { maximum_age_ms: 2_000 },
    environment: "paper",
    created_at: at(2),
    expires_at: EXPIRY,
  };
  const spot = createTradeIntent({
    ...common,
    intent_id: "intent_spot_state",
    leg_id: "spot",
    instrument: spotInstrument,
    action: "buy",
    amount: { kind: "notional", value: "100", asset_id: solUsdc.asset_id },
    settlement_asset: { asset: solUsdc, role: "settlement" },
    fee_asset: { asset: solUsdc, role: "fee" },
    gas_requirement: { asset_id: solGas.asset_id, minimum_balance: "0.01", state: "available" },
    dependency: { relationship: "independent", required_leg_ids: [], maximum_delay_ms: 2_000 },
    idempotency_key: "plan_state_test:spot",
  });
  const hedge = createTradeIntent({
    ...common,
    intent_id: "intent_hedge_state",
    leg_id: "hedge",
    instrument: perpInstrument,
    action: "open_short",
    amount: { kind: "notional", value: "100", asset_id: hlUsdc.asset_id },
    settlement_asset: { asset: hlUsdc, role: "settlement" },
    fee_asset: { asset: hlUsdc, role: "fee" },
    dependency: { relationship: "hedge", required_leg_ids: ["spot"], maximum_delay_ms: 2_000 },
    idempotency_key: "plan_state_test:hedge",
  });
  const tradePlan = createTradePlan({
    plan_id: "plan_state_test",
    agent_spec: spec,
    evidence_packet: packet,
    intents: [spot, hedge],
    purpose: "Lifecycle test plan",
    dependencies: [{ from_leg_id: "spot", to_leg_id: "hedge", relationship: "hedge", maximum_delay_ms: 2_000 }],
    maximum_time_between_legs_ms: 2_000,
    combined_expected_portfolio_effect: { state: "resolved", net_delta: "0", unresolved_conditions: [] },
    environment: "paper",
    idempotency_key: "plan_state_test",
    created_at: at(2),
    expires_at: EXPIRY,
  });
  const decision = (scope, intent, id) => createPolicyDecision({
    policy_decision_id: id,
    scope,
    plan: tradePlan,
    intent,
    evidence_packet: packet,
    portfolio_snapshot_ref: { record_id: "portfolio_001", record_hash: "portfolio_hash" },
    policy_ref: { policy_id: "policy_001", policy_version_id: "policy_001_v1", version: 1, policy_hash: "policy_hash_001" },
    quote_refs: tradePlan.leg_order.map((legId) => ({
      leg_id: legId,
      quote_id: `quote_${legId}_state`,
      quote_hash: `quote_hash_${legId}_state`,
      provider: legId === "spot" ? "jupiter" : "hyperliquid",
      observed_at: at(2),
      expires_at: EXPIRY,
      executable: true,
    })),
    evaluated_rules: [{ rule_id: `${id}:capital`, result: "pass", observed_value: "500", configured_limit: "100" }],
    partial_execution_analysis: { state: "bounded", maximum_unhedged_ms: 2_000 },
    reasons: ["allowed_by_user_policy"],
    decided_at: at(3),
    expires_at: EXPIRY,
    deterministic_engine_version: "governor-agentic-1",
  });
  const decisions = [decision("plan", null, "decision_plan_state"), decision("leg", spot, "decision_spot_state"), decision("leg", hedge, "decision_hedge_state")];
  return { spec, packet, spot, hedge, tradePlan, decisions };
}

function advanceToExecuting(tradePlan, decisions) {
  let lifecycle = createPlanLifecycle({ plan: tradePlan, occurred_at: at(3) });
  lifecycle = transitionPlanLifecycle(lifecycle, "validated", { occurred_at: at(4), reason_code: "schema_valid", validation_passed: true });
  lifecycle = transitionPlanLifecycle(lifecycle, "policy_pending", { occurred_at: at(5), reason_code: "policy_requested" });
  lifecycle = transitionPlanLifecycle(lifecycle, "approved", { occurred_at: at(6), reason_code: "policy_allowed", policy_decisions: decisions });
  lifecycle = transitionPlanLifecycle(lifecycle, "previewing", { occurred_at: at(7), reason_code: "quotes_requested" });
  lifecycle = transitionPlanLifecycle(lifecycle, "ready", { occurred_at: at(8), reason_code: "quotes_ready" });
  lifecycle = transitionPlanLifecycle(lifecycle, "executing", {
    occurred_at: at(9),
    reason_code: "paper_execution_started",
    policy_decisions: decisions,
    portfolio_rechecked: true,
    capital_reserved: true,
    quotes: [
      { leg_id: "spot", quote_id: "quote_spot_state", quote_hash: "quote_hash_spot_state", executable: true, expires_at: EXPIRY, materially_changed: false },
      { leg_id: "hedge", quote_id: "quote_hedge_state", quote_hash: "quote_hash_hedge_state", executable: true, expires_at: EXPIRY, materially_changed: false },
    ],
  });
  return lifecycle;
}

test("agent transitions are explicit, append-only, and cannot reach live by default", () => {
  const { spec } = fixture();
  let lifecycle = createAgentLifecycle({ agent_spec: spec, occurred_at: at(1) });
  lifecycle = transitionAgentLifecycle(lifecycle, "validated", { occurred_at: at(2), reason_code: "spec_validated" });
  lifecycle = transitionAgentLifecycle(lifecycle, "paper", { occurred_at: at(3), reason_code: "paper_started" });
  lifecycle = transitionAgentLifecycle(lifecycle, "paper_accepted", { occurred_at: at(4), reason_code: "paper_reviewed" });
  lifecycle = transitionAgentLifecycle(lifecycle, "live_candidate", {
    occurred_at: at(5),
    reason_code: "candidate_review",
    explicit_owner_approval: true,
    legal_release_recorded: true,
  });
  assert.throws(() => transitionAgentLifecycle(lifecycle, "live", {
    occurred_at: at(6),
    reason_code: "attempt_live",
    explicit_owner_approval: true,
    legal_release_recorded: true,
    venue_live_execution_enabled: true,
    feature_flags: {
      global_live_agent_execution: true,
      solana_agent_execution: true,
      hyperliquid_agent_execution: true,
    },
  }), /invalid_agent_transition|live_execution_disabled/);
  assert.equal(canTransitionAgentState("live_candidate", "live", { global_live_agent_execution: true }), false);
  assert.equal(lifecycle.current_state, "live_candidate");
  assert.equal(lifecycle.events.length, 5);
  assert.equal(verifyLifecycle(lifecycle, "AgentLifecycle").ok, true);
});

test("lifecycle hash chain rejects tampering", () => {
  const { spec } = fixture();
  const lifecycle = createAgentLifecycle({ agent_spec: spec, occurred_at: at(1) });
  const tampered = structuredClone(lifecycle);
  tampered.events[0].reason_code = "rewritten_history";
  assert.equal(verifyLifecycle(tampered, "AgentLifecycle").ok, false);
});

test("execution requires current policy, local capital reservation, portfolio recheck, and live quotes", () => {
  const { tradePlan, decisions } = fixture();
  let lifecycle = createPlanLifecycle({ plan: tradePlan, occurred_at: at(3) });
  lifecycle = transitionPlanLifecycle(lifecycle, "validated", { occurred_at: at(4), reason_code: "schema_valid", validation_passed: true });
  lifecycle = transitionPlanLifecycle(lifecycle, "policy_pending", { occurred_at: at(5), reason_code: "policy_requested" });
  lifecycle = transitionPlanLifecycle(lifecycle, "approved", { occurred_at: at(6), reason_code: "policy_allowed", policy_decisions: decisions });
  lifecycle = transitionPlanLifecycle(lifecycle, "previewing", { occurred_at: at(7), reason_code: "quotes_requested" });
  lifecycle = transitionPlanLifecycle(lifecycle, "ready", { occurred_at: at(8), reason_code: "quotes_ready" });
  assert.throws(() => transitionPlanLifecycle(lifecycle, "executing", {
    occurred_at: at(9),
    reason_code: "missing_reservation",
    policy_decisions: decisions,
    portfolio_rechecked: true,
    capital_reserved: false,
    quotes: [],
  }), /capital_reservation_required/);
  assert.throws(() => transitionPlanLifecycle(lifecycle, "executing", {
    occurred_at: at(9),
    reason_code: "changed_quote",
    policy_decisions: decisions,
    portfolio_rechecked: true,
    capital_reserved: true,
    quotes: [
      { leg_id: "spot", quote_id: "quote_spot_state", quote_hash: "changed", executable: true, expires_at: EXPIRY },
      { leg_id: "hedge", quote_id: "quote_hedge_state", quote_hash: "quote_hash_hedge_state", executable: true, expires_at: EXPIRY },
    ],
  }), /quote_changed_requires_policy/);
  assert.equal(lifecycle.current_state, "ready");
});

test("a one-sided paper fill becomes partially executed and cannot falsely complete", () => {
  const { tradePlan, decisions } = fixture();
  let lifecycle = advanceToExecuting(tradePlan, decisions);
  lifecycle = transitionPlanLifecycle(lifecycle, "partially_executed", {
    occurred_at: at(10),
    reason_code: "hedge_expired",
    leg_states: [{ leg_id: "spot", status: "filled" }, { leg_id: "hedge", status: "expired" }],
    resulting_exposure: { asset_id: "solana:SOL", unhedged_notional: "100" },
  });
  assert.equal(lifecycle.current_state, "partially_executed");
  lifecycle = transitionPlanLifecycle(lifecycle, "reconciliation_required", { occurred_at: at(11), reason_code: "venue_truth_required" });
  assert.throws(() => transitionPlanLifecycle(lifecycle, "completed", {
    occurred_at: at(12),
    reason_code: "false_completion",
    leg_states: [{ leg_id: "spot", status: "reconciled" }, { leg_id: "hedge", status: "expired" }],
    reconciliation_complete: true,
  }), /required_legs_unresolved/);
  assert.equal(lifecycle.current_state, "reconciliation_required");
});

test("compensation cannot start automatically and requires a new or preauthorized policy decision", () => {
  const { tradePlan, decisions } = fixture();
  let lifecycle = advanceToExecuting(tradePlan, decisions);
  lifecycle = transitionPlanLifecycle(lifecycle, "partially_executed", {
    occurred_at: at(10),
    reason_code: "hedge_failed",
    leg_states: [{ leg_id: "spot", status: "filled" }, { leg_id: "hedge", status: "failed" }],
    resulting_exposure: { unhedged_notional: "100" },
  });
  lifecycle = transitionPlanLifecycle(lifecycle, "compensation_required", {
    occurred_at: at(11),
    reason_code: "unhedged_exposure",
    resulting_exposure: { unhedged_notional: "100" },
  });
  assert.throws(() => transitionPlanLifecycle(lifecycle, "compensating", {
    occurred_at: at(12),
    reason_code: "automatic_unwind",
    automatic_compensation: true,
    policy_decisions: decisions,
  }), /automatic_compensation_disabled/);
  assert.throws(() => transitionPlanLifecycle(lifecycle, "compensating", {
    occurred_at: at(12),
    reason_code: "unapproved_unwind",
    policy_decisions: decisions,
  }), /compensation_authorization_required/);
  lifecycle = transitionPlanLifecycle(lifecycle, "compensating", {
    occurred_at: at(12),
    reason_code: "new_policy_approved_unwind",
    compensation_authorization: "new_policy_decision",
    policy_decisions: decisions,
  });
  assert.equal(lifecycle.current_state, "compensating");
});

test("a fully reconciled multi-leg paper plan may complete", () => {
  const { tradePlan, decisions } = fixture();
  let lifecycle = advanceToExecuting(tradePlan, decisions);
  lifecycle = transitionPlanLifecycle(lifecycle, "completed", {
    occurred_at: at(10),
    reason_code: "all_legs_reconciled",
    leg_states: [{ leg_id: "spot", status: "reconciled" }, { leg_id: "hedge", status: "reconciled" }],
    reconciliation_complete: true,
  });
  assert.equal(lifecycle.current_state, "completed");
  assert.equal(verifyLifecycle(lifecycle, "PlanLifecycle").ok, true);
});
