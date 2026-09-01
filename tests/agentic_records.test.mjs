import assert from "node:assert/strict";
import test from "node:test";

import {
  AgenticLiveDefaults,
  AgenticTradingSchemas,
  agenticContractHash,
  agenticRecordReference,
  createAgentSpec,
  createCapitalTransferIntent,
  createEvidencePacket,
  createExecutionReceipt,
  createOutcomeRecord,
  createPolicyDecision,
  createTradeIntent,
  createTradePlan,
  normalizeAssetIdentity,
  normalizeInstrumentIdentity,
  verifyAgenticRecord,
} from "../lib/agentic_trading/index.mjs";

const T0 = "2026-09-01T12:00:00.000Z";
const T1 = "2026-09-01T12:00:01.000Z";
const T2 = "2026-09-01T12:00:02.000Z";
const T3 = "2026-09-01T12:00:03.000Z";
const T4 = "2026-09-01T12:00:04.000Z";
const EXPIRY = "2026-09-01T12:01:00.000Z";
const PLAN_EXPIRY = "2026-09-01T12:02:00.000Z";
const SOL_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_TOKEN_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6qM5UXB263hLtB1p";
const SHA = Object.freeze({
  manifest: "1".repeat(64),
  integrity: "2".repeat(64),
  row: "3".repeat(64),
  priorRow: "4".repeat(64),
  unit: "5".repeat(64),
  runtime: "6".repeat(64),
  rawResponse: "7".repeat(64),
  rawRow: "8".repeat(64),
  envelope: "9".repeat(64),
  chronologyResponse: "a".repeat(64),
  chronologyRow: "b".repeat(64),
});

function identities() {
  const solUsdc = normalizeAssetIdentity({
    chain_id: "solana",
    kind: "stablecoin",
    standard: "spl",
    reference: SOL_USDC_MINT,
    symbol: "USDC",
    decimals: 6,
    issuer_id: "circle",
    representation: "canonical",
    verification_state: "verified",
  });
  const solToken = normalizeAssetIdentity({
    chain_id: "solana",
    kind: "fungible_token",
    standard: "spl",
    reference: SOL_TOKEN_MINT,
    symbol: "SOL",
    decimals: 9,
    representation: "canonical",
    verification_state: "verified",
  });
  const solGas = normalizeAssetIdentity({ chain_id: "solana", kind: "native", standard: "native", symbol: "SOL", reference: "SOL", decimals: 9 });
  const solSpot = normalizeInstrumentIdentity({ kind: "spot", venue: "jupiter", base_asset: solToken, quote_asset: solUsdc, settlement_asset: solUsdc });
  const hlUsdc = normalizeAssetIdentity({
    chain_id: "hyperliquid",
    kind: "stablecoin",
    standard: "venue-asset",
    reference: "USDC",
    symbol: "USDC",
    decimals: 6,
    issuer_id: "circle",
    representation: "canonical",
    verification_state: "verified",
  });
  const hlSol = normalizeAssetIdentity({
    chain_id: "hyperliquid",
    kind: "fungible_token",
    standard: "venue-asset",
    reference: "SOL",
    symbol: "SOL",
    decimals: 9,
    representation: "native",
    verification_state: "verified",
  });
  const hlPerp = normalizeInstrumentIdentity({
    kind: "perpetual",
    venue: "hyperliquid",
    base_asset: hlSol,
    quote_asset: hlUsdc,
    settlement_asset: hlUsdc,
    market_reference: "SOL",
  });
  return { solUsdc, solToken, solGas, solSpot, hlUsdc, hlSol, hlPerp };
}

function agentSpec(overrides = {}) {
  const i = identities();
  return createAgentSpec({
    agent_id: "agent_sol_hedge",
    version: 1,
    owner_tenant_id: "tenant_001",
    name: "SOL paper hedge",
    description: "Typed two-venue paper strategy",
    strategy_type: "cross_venue",
    allowed_chains: ["solana", "hyperliquid"],
    allowed_venues: ["jupiter", "hyperliquid"],
    allowed_instruments: [i.solSpot, i.hlPerp],
    evidence_requirements: [
      { requirement_id: "market", evidence_type: "executable_market", material: true, maximum_age_ms: 5_000, allowed_providers: ["jupiter", "hyperliquid"] },
      { requirement_id: "portfolio", evidence_type: "unified_portfolio", material: true, maximum_age_ms: 5_000, allowed_providers: ["raven"] },
    ],
    entry_rules: { signal: "typed_breakout", minimum_confidence_bps: 8000 },
    exit_rules: { maximum_hold_seconds: 3600 },
    position_sizing: { mode: "fixed_notional", value: "100", asset_id: i.solUsdc.asset_id, maximum_per_leg: "100", maximum_total: "200" },
    multi_leg_dependency_rules: { atomicity_assumed: false, maximum_unhedged_ms: 2_000 },
    hedge_requirements: { required: true, target_delta: "0" },
    rebalancing_rules: {},
    triggers: { schedule: "event" },
    autonomy_level: "paper",
    risk_policy_ref: { policy_id: "policy_001", policy_version_id: "policy_001_v1", version: 1, policy_hash: "policy_hash_001" },
    approval_requirements: { paper: false, live: true },
    starts_at: T0,
    expires_at: "2026-09-02T12:00:00.000Z",
    planner_model_version: "raven-planner-1",
    compiler_version: "agent-spec-compiler-1",
    ...overrides,
  });
}

function evidence(spec = agentSpec(), { stale = false, marketFinality = "provider_confirmed" } = {}) {
  const expiresAt = stale ? "2026-09-01T11:59:59.000Z" : EXPIRY;
  return createEvidencePacket({
    evidence_packet_id: stale ? "evidence_stale" : "evidence_001",
    agent_spec: spec,
    decision_at: T1,
    unified_portfolio_snapshot_ref: { record_id: "portfolio_001", record_hash: "portfolio_hash_001" },
    venue_account_snapshot_refs: [
      { venue_id: "jupiter@solana:mainnet-beta#mainnet", snapshot_id: "sol_account_001" },
      { venue_id: "hyperliquid@hyperliquid:mainnet#mainnet", snapshot_id: "hl_account_001" },
    ],
    observations: [
      {
        observation_id: "obs_market_001",
        requirement_id: "market",
        evidence_type: "executable_market",
        provider: "jupiter",
        source: "jupiter quote",
        chain_id: "solana",
        venue: "jupiter",
        source_venue: "jupiter-metis",
        observed_at: T0,
        retrieved_at: T1,
        expires_at: expiresAt,
        slot: "300000001",
        finality_state: marketFinality,
        freshness_state: "fresh",
        verification_state: "verified",
        facts: { executable: true },
        raw_evidence_ref: "jupiter:quote:001",
      },
      {
        observation_id: "obs_portfolio_001",
        requirement_id: "portfolio",
        evidence_type: "unified_portfolio",
        provider: "raven",
        source: "portfolio governor",
        chain_id: "solana",
        observed_at: T0,
        retrieved_at: T1,
        expires_at: expiresAt,
        finality_state: "provider_confirmed",
        freshness_state: "fresh",
        verification_state: "verified",
        facts: { solana_usdc: "500", hyperliquid_usdc: "500" },
        raw_evidence_ref: "portfolio:001",
      },
    ],
    derived_calculations: { gross_delta: "0" },
  });
}

function tradeIntents(spec = agentSpec(), packet = evidence(spec)) {
  const i = identities();
  const specRef = agenticRecordReference(spec);
  const evidenceRef = agenticRecordReference(packet);
  const common = {
    plan_id: "plan_001",
    agent_spec_ref: specRef,
    evidence_packet_ref: evidenceRef,
    amount: { kind: "notional", value: "100", asset_id: i.solUsdc.asset_id },
    order_constraints: { order_type: "market", maximum_slippage_bps: 100, maximum_price_impact_bps: 150, time_in_force: "ioc" },
    quote_requirements: { maximum_age_ms: 2_000, executable_quote_required: true, quote_expiry_required: true, reverse_exit_required: true },
    environment: "paper",
    created_at: T2,
    expires_at: EXPIRY,
  };
  const spot = createTradeIntent({
    ...common,
    intent_id: "intent_spot_001",
    leg_id: "spot",
    instrument: i.solSpot,
    chain_id: "solana",
    venue: "jupiter",
    action: "buy",
    settlement_asset: { asset: i.solUsdc, role: "settlement" },
    fee_asset: { asset: i.solUsdc, role: "fee" },
    gas_requirement: { asset_id: i.solGas.asset_id, minimum_balance: "0.01", state: "available" },
    rationale: { entry: "Observed signal", exit: "Policy exit" },
    dependency: { relationship: "independent", required_leg_ids: [], maximum_delay_ms: 2_000 },
    idempotency_key: "plan_001:spot",
  });
  const hedge = createTradeIntent({
    ...common,
    intent_id: "intent_hedge_001",
    leg_id: "hedge",
    instrument: i.hlPerp,
    chain_id: "hyperliquid",
    venue: "hyperliquid",
    action: "open_short",
    amount: { kind: "notional", value: "100", asset_id: i.hlUsdc.asset_id },
    settlement_asset: { asset: i.hlUsdc, role: "settlement" },
    fee_asset: { asset: i.hlUsdc, role: "fee" },
    rationale: { entry: "Delta hedge", exit: "Close with spot" },
    dependency: { relationship: "hedge", required_leg_ids: ["spot"], maximum_delay_ms: 2_000 },
    idempotency_key: "plan_001:hedge",
  });
  return { spot, hedge };
}

function plan(spec = agentSpec(), packet = evidence(spec), intents = tradeIntents(spec, packet)) {
  return createTradePlan({
    plan_id: "plan_001",
    agent_spec: spec,
    evidence_packet: packet,
    intents: [intents.spot, intents.hedge],
    purpose: "Paper spot plus hedge",
    dependencies: [{ from_leg_id: "spot", to_leg_id: "hedge", relationship: "hedge", required: true, maximum_delay_ms: 2_000 }],
    maximum_time_between_legs_ms: 2_000,
    partial_completion_policy: {},
    retry_policy: { maximum_attempts_per_leg: 0 },
    compensation_policy: { mode: "new_policy_decision_required" },
    combined_expected_portfolio_effect: { state: "resolved", gross_exposure_delta: "100", net_delta: "0", unresolved_conditions: [] },
    environment: "paper",
    idempotency_key: "plan_001",
    created_at: T2,
    expires_at: PLAN_EXPIRY,
  });
}

function policyDecision({ scope = "plan", tradePlan, intent = null, packet, id = "decision_plan_001", rules = null } = {}) {
  return createPolicyDecision({
    policy_decision_id: id,
    scope,
    plan: tradePlan,
    intent,
    evidence_packet: packet,
    portfolio_snapshot_ref: { record_id: "portfolio_001", record_hash: "portfolio_hash_001" },
    policy_ref: { policy_id: "policy_001", policy_version_id: "policy_001_v1", version: 1, policy_hash: "policy_hash_001" },
    quote_refs: tradePlan.leg_order.map((legId) => ({
      leg_id: legId,
      quote_id: `quote_${legId}_001`,
      quote_hash: `quote_hash_${legId}_001`,
      provider: legId === "spot" ? "jupiter" : "hyperliquid",
      observed_at: T2,
      expires_at: EXPIRY,
      executable: true,
    })),
    evaluated_rules: rules || [
      { rule_id: "capital_local", result: "pass", observed_value: "500", configured_limit: "100" },
      { rule_id: "fresh_evidence", result: "pass", observed_value: "1000ms", configured_limit: "5000ms" },
    ],
    partial_execution_analysis: { maximum_unhedged_ms: 2_000, state: "bounded" },
    reasons: ["within_user_policy"],
    decided_at: T3,
    expires_at: EXPIRY,
    deterministic_engine_version: "governor-agentic-1",
  });
}

test("AgentSpec is immutable, deterministically hashed, and live-disabled", () => {
  const first = agentSpec();
  const second = agentSpec();
  assert.equal(first.specification_hash, second.specification_hash);
  assert.equal(first.record_hash, second.record_hash);
  assert.equal(first.execution_boundary.signing_available, false);
  assert.deepEqual(first.execution_boundary.live_feature_flags, AgenticLiveDefaults);
  assert.equal(Object.isFrozen(first.allowed_instruments), true);
  assert.equal(verifyAgenticRecord(first, "AgentSpec").ok, true);
  assert.throws(() => createAgentSpec({ ...first, lifecycle_state: "live" }), /live_agent_state_disabled/);
  assert.throws(() => createAgentSpec({ ...first, lifecycle_state: "paper" }), /agent_spec_initial_state_invalid/);
  const { compiler: _compiler, planner_model_version: _plannerModelVersion, ...withoutCompiler } = {
    ...first,
    model_version: "mutable-generic-model-alias",
  };
  assert.throws(() => createAgentSpec(withoutCompiler), /planner_model_version_required/);
});

test("agentic record hashes bind UI-labelled fields instead of silently excluding them", () => {
  const spec = agentSpec();
  const withUiState = { ...spec, ui_state: "expanded" };
  assert.notEqual(agenticContractHash(Object.fromEntries(Object.entries(withUiState).filter(([key]) => key !== "record_hash"))), spec.record_hash);
  assert.equal(verifyAgenticRecord(withUiState, "AgentSpec").ok, false);
});

test("minimum finality is chain-aware and insufficient Solana finality fails closed", () => {
  const spec = agentSpec();
  const packet = evidence(spec, { marketFinality: "processed" });
  assert.equal(packet.execution_eligible, false);
  assert.deepEqual(packet.missing_evidence, ["market"]);
  assert.throws(() => agentSpec({
    evidence_requirements: [{
      requirement_id: "bad-finality",
      evidence_type: "market",
      maximum_age_ms: 5_000,
      minimum_finality: "hopeful",
    }],
  }), /evidence_minimum_finality_0_invalid/);
});

test("stale material evidence stays indeterminate and cannot be promoted to allow", () => {
  const spec = agentSpec();
  const stalePacket = evidence(spec, { stale: true });
  assert.equal(stalePacket.status, "indeterminate");
  assert.equal(stalePacket.execution_eligible, false);
  assert.deepEqual(stalePacket.missing_evidence, ["market", "portfolio"]);
  const intents = tradeIntents(spec, stalePacket);
  const tradePlan = plan(spec, stalePacket, intents);
  const decision = policyDecision({ tradePlan, packet: stalePacket });
  assert.equal(decision.result, "indeterminate");
  assert.ok(decision.missing_inputs.includes("market"));
});

test("chain-local capital remains separate across a two-venue plan", () => {
  const spec = agentSpec();
  const packet = evidence(spec);
  const intents = tradeIntents(spec, packet);
  const tradePlan = plan(spec, packet, intents);
  assert.equal(tradePlan.orchestration.cross_chain, true);
  assert.equal(tradePlan.orchestration.atomicity_assumed, false);
  assert.notEqual(intents.spot.amount.asset_id, intents.hedge.amount.asset_id);
  assert.equal(intents.spot.chain_id, "solana:mainnet-beta");
  assert.equal(intents.hedge.chain_id, "hyperliquid:mainnet");
  assert.equal(packet.observations[0].venue_id, "jupiter@solana:mainnet-beta#mainnet");
  assert.equal(packet.observations[0].market_identity.venue, "jupiter-metis");
});

test("intent contracts reject live mode, arbitrary calldata, numeric amounts, and missing gas", () => {
  const spec = agentSpec();
  const packet = evidence(spec);
  const { spot } = tradeIntents(spec, packet);
  const { record_hash: _recordHash, ...spotCore } = spot;
  const base = {
    ...spotCore,
    instrument: spot.instrument,
    venue: spot.instrument.venue,
    settlement_asset: spot.settlement_asset,
    fee_asset: spot.fee_asset,
  };
  assert.throws(() => createTradeIntent({ ...base, environment: "live" }), /live_execution_disabled/);
  assert.throws(() => createTradeIntent({ ...base, calldata: "0xdeadbeef" }), /forbidden_execution_authority_field/);
  assert.throws(() => createTradeIntent({ ...base, amount: { ...spot.amount, value: 100 } }), /must_be_decimal_string/);
  const unknownGas = createTradeIntent({ ...base, intent_id: "intent_unknown_gas", gas_requirement: null });
  assert.equal(unknownGas.readiness.execution_eligible, false);
  assert.deepEqual(unknownGas.readiness.reasons, ["gas_unknown"]);
});

test("duplicate idempotency keys cannot enter one plan", () => {
  const spec = agentSpec();
  const packet = evidence(spec);
  const intents = tradeIntents(spec, packet);
  const { record_hash: _recordHash, ...hedgeCore } = intents.hedge;
  const duplicate = createTradeIntent({
    ...hedgeCore,
    intent_id: "intent_duplicate",
    leg_id: "hedge_duplicate",
    venue: intents.hedge.instrument.venue,
    idempotency_key: intents.spot.idempotency_key,
  });
  assert.throws(() => plan(spec, packet, { spot: intents.spot, hedge: duplicate }), /trade_plan_idempotency_duplicate/);
});

test("capital transfer intent is separate, manual, and non-executable", () => {
  const i = identities();
  const spec = agentSpec();
  const packet = evidence(spec);
  const baseUsdc = normalizeAssetIdentity({
    chain_id: "base",
    kind: "stablecoin",
    standard: "erc20",
    reference: "0x1111111111111111111111111111111111111111",
    symbol: "USDC",
    issuer_id: "circle",
    representation: "canonical",
  });
  const transfer = createCapitalTransferIntent({
    transfer_intent_id: "transfer_001",
    agent_spec_ref: agenticRecordReference(spec),
    evidence_packet_ref: agenticRecordReference(packet),
    source_chain_id: "eip155:8453",
    destination_chain_id: "solana",
    source_asset: baseUsdc,
    destination_asset: i.solUsdc,
    amount: "100",
    mechanism: { provider: "configured_bridge", route_id: "route_preview_001" },
    fees: { state: "estimated", amount: "0.50" },
    trust_dependencies: ["bridge_contract"],
    expected_timing: { minimum_seconds: 30, maximum_seconds: 300 },
    source_gas_requirement: { asset_id: "eip155:8453/slip44:60", minimum_balance: "0.001", state: "available" },
    destination_gas_requirement: { asset_id: i.solGas.asset_id, minimum_balance: "0.01", state: "available" },
    finality_assumptions: ["source_finalized", "destination_observed"],
    reconciliation_requirements: ["source_departure", "destination_arrival"],
    created_at: T2,
    expires_at: PLAN_EXPIRY,
    idempotency_key: "transfer_001",
  });
  assert.equal(transfer.manual_approval_required, true);
  assert.equal(transfer.autonomous_bridging_enabled, false);
  assert.equal(transfer.execution_authorized, false);
});

test("valid policy decision supports a paper receipt and reconciled outcome", () => {
  const spec = agentSpec();
  const packet = evidence(spec);
  const intents = tradeIntents(spec, packet);
  const tradePlan = plan(spec, packet, intents);
  const decision = policyDecision({ scope: "leg", tradePlan, intent: intents.spot, packet, id: "decision_spot_001" });
  assert.equal(decision.result, "allow");
  const receiptInput = {
    receipt_id: "receipt_spot_001",
    plan: tradePlan,
    intent: intents.spot,
    policy_decision: decision,
    adapter: { adapter_id: "paper-solana", adapter_version: "1" },
    environment: "paper",
    preview_quote: {
      quote_id: "quote_spot_001",
      quote_hash: "quote_hash_spot_001",
      provider: "jupiter",
      observed_at: T3,
      expires_at: EXPIRY,
      executable: true,
      requested_amount: "100",
      expected_output: "0.70",
      minimum_output: "0.69",
      price_impact_bps: 20,
      fees: { venue: { amount: "0.10", asset_id: identities().solUsdc.asset_id, state: "estimated" } },
      provider_evidence_ref: "jupiter:quote:001",
    },
    fill_details: [{ fill_id: "fill_spot_001", quantity: "0.70", price: "142.85", filled_at: T4, fee: { amount: "0.10", asset_id: identities().solUsdc.asset_id, state: "estimated" } }],
    fee_totals: { total: "0.10", asset_id: identities().solUsdc.asset_id },
    gas: { amount: "0.00001", asset_id: identities().solGas.asset_id, state: "estimated" },
    realized_slippage_bps: 12,
    provider_timestamps: { quote_at: T3, fill_at: T4 },
    confirmation: { state: "paper_final" },
    adapter_reference: "paper-order-001",
    status: "filled",
    reconciliation_status: "reconciled",
    created_at: T4,
  };
  assert.throws(() => createExecutionReceipt({
    ...receiptInput,
    receipt_id: "receipt_changed_quote",
    preview_quote: { ...receiptInput.preview_quote, quote_hash: "changed_quote_hash" },
  }), /quote_changed_since_policy/);
  const receipt = createExecutionReceipt(receiptInput);
  assert.equal(receipt.live_execution_performed, false);
  assert.equal(receipt.paper_label_required, true);
  const { record_hash: _receiptHash, ...forgedLiveCore } = structuredClone(receipt);
  forgedLiveCore.schema_version = AgenticTradingSchemas.execution_receipt;
  forgedLiveCore.environment = "live";
  forgedLiveCore.adapter.environment = "live";
  forgedLiveCore.simulated = false;
  forgedLiveCore.live_execution_performed = true;
  const forgedLive = { ...forgedLiveCore, record_hash: agenticContractHash(forgedLiveCore) };
  assert.equal(verifyAgenticRecord(forgedLive, "ExecutionReceipt").ok, false);
  const outcome = createOutcomeRecord({
    outcome_id: "outcome_001",
    plan: tradePlan,
    receipts: [receipt],
    outcome_type: "completed",
    entry: { value: "100" },
    exit: { value: "101" },
    capital_employed: "100",
    realized_pnl: "1",
    unrealized_pnl: "0",
    fees: { total: "0.10" },
    funding: { total: "0" },
    gas: { total: "0.01" },
    slippage: { bps: 12 },
    maximum_adverse_excursion: "-0.50",
    maximum_favorable_excursion: "2.00",
    drawdown_contribution: "-0.10",
    benchmark: { id: "hold", return: "0.70" },
    exit_reason: "paper_test_complete",
    attribution: { agent_specification_hash: spec.specification_hash },
    environment: "paper",
    recorded_at: "2026-09-01T12:00:05.000Z",
  });
  assert.equal(outcome.simulated, true);
  assert.equal(verifyAgenticRecord(outcome, "OutcomeRecord").ok, true);
});

test("tampering invalidates an agentic record", () => {
  const spec = agentSpec();
  const tampered = { ...spec, autonomy_level: "live" };
  assert.equal(verifyAgenticRecord(tampered, "AgentSpec").ok, false);
});

test("Raven source identity, chronology, safety, and funding completeness remain explicit", () => {
  const spec = agentSpec({
    source_strategy_contract: {
      schema_version: "raven.strategy.contract.v1",
      contract: "perp_funding_boundary",
      contract_id: "perp_funding_boundary:v3",
      semantic_id: "funding-boundary",
      semantic_digest: "semantic_digest_001",
      package_manifest_sha256: SHA.manifest,
      package_integrity_sha256: SHA.integrity,
    },
    evidence_requirements: [{
      requirement_id: "funding",
      evidence_type: "hyperliquid_funding",
      material: true,
      maximum_age_ms: 5_000,
      allowed_providers: ["hyperliquid"],
      funding_complete_required: true,
      required_safety_booleans: { research_only: true, affects_execution: false },
    }],
  });
  assert.equal(spec.compiler.planner_model_version, "raven-planner-1");
  assert.equal(spec.source_strategy_contract.contract_id, "perp_funding_boundary:v3");
  const packet = createEvidencePacket({
    evidence_packet_id: "evidence_funding_incomplete",
    agent_spec: spec,
    decision_at: T1,
    unified_portfolio_snapshot_ref: { record_id: "portfolio_001", record_hash: "portfolio_hash_001" },
    observations: [{
      observation_id: "ravenos_observation_001",
      requirement_id: "funding",
      evidence_type: "hyperliquid_funding",
      provider: "hyperliquid",
      source: "raven funding boundary observer",
      chain_id: "hyperliquid",
      venue: "hyperliquid",
      observed_at: T0,
      retrieved_at: T1,
      expires_at: EXPIRY,
      finality_state: "provider_confirmed",
      freshness_state: "fresh",
      verification_state: "verified",
      facts: { boundary_observed: true },
      source_identities: [
        { name: "cycle_id", value: "cycle_001", source_contract: "perp_funding_boundary:v3" },
        { name: "provider_block_number", value: 12345678, source_contract: "perp_funding_boundary:v3" },
        { name: "root_id", value: "root_001", source_contract: { contract_id: "raven.root.v1", semantic_digest: "root_digest" } },
      ],
      source_entry_observation_id: "source_entry_001",
      trigger_observation_id: "trigger_001",
      root_id: "root_001",
      route_evidence_digest: "route_digest_001",
      source_envelope: {
        schema_version: "raven.source_envelope.v1",
        contract_id: "perp_funding_boundary:v3",
        semantic_id: "funding-boundary",
        semantic_digest: "semantic_digest_001",
        row_digest_sha256: SHA.row,
        prior_row_digest_sha256: SHA.priorRow,
        package_manifest_sha256: SHA.manifest,
        receipt_schema_version: 3,
        receipt_contract: "nexus_strict_log_coverage_resume_registration",
        receipt_contract_name: "nexus_strict_log_coverage_resume_registration",
        receipt_digest_sha256: null,
        source_service_epoch: {
          unit_path: "/etc/systemd/system/raven.service",
          unit_sha256: SHA.unit,
          pid: 4242,
          proc_start_ticks: "123456",
          boot_id: "boot_001",
          exact_cmdline: "/usr/bin/node raven.mjs",
          runtime_executable: "/usr/bin/node",
          runtime_executable_sha256: SHA.runtime,
        },
      },
      source_chronology: {
        observed_at_ts: 1788264000,
        captured_at_ts: 1788264001,
        available_at_ts: 1788264001,
        raw_provider_book_ts: 1788264000000,
        receive_monotonic_ts: 1000,
        parse_complete_monotonic_ts: 1002,
        sample_monotonic_ts: 1003,
        age_bound_ms: 5,
        gap_bound_ms: 25,
        raw_response_sha256: SHA.chronologyResponse,
        raw_row_digest: "provider-row:SOL:1788264000000",
        raw_row_sha256: SHA.chronologyRow,
      },
      funding_evidence: {
        funding_complete: true,
        root_id: "root_001",
        provider_coin: "SOL",
        boundary_ts: 1788264000,
        boundary_ms: 1788264000000,
        request_start_ms: 1788263999900,
        request_end_ms: 1788264000100,
        raw_response_sha256: SHA.rawResponse,
        raw_row: { coin: "SOL", time: 1788264000000 },
        raw_row_sha256: SHA.rawRow,
        raw_time_equals_boundary_ms: true,
        official_funding_rate: null,
        oracle_price: null,
        quantity_atoms: null,
        signed_funding_pnl_usd: null,
        pre_source_us: 1788263999999999,
        post_source_us: 1788264000000001,
        activation_identity_digest: "activation_digest_001",
        source_envelope_sha256: SHA.envelope,
      },
      safety: {
        research_only: true,
        zero_capital: true,
        read_only_market_access: true,
        affects_execution: false,
        affects_live: false,
        affects_policy: false,
        automatic_candidate_activation: false,
        capital_authorized: false,
        transaction_construction: false,
        signing: false,
        order_submission: false,
        broadcast: false,
      },
      raw_evidence_ref: "funding:row:001",
    }],
  });
  const observation = packet.observations[0];
  assert.equal(observation.observation_id, "ravenos_observation_001");
  assert.equal(observation.source_identity_fields.source_entry_observation_id, "source_entry_001");
  assert.equal(observation.source_identities[0].name, "cycle_id");
  assert.equal(observation.source_identities[1].value, 12345678);
  assert.equal(observation.source_envelope.source_service_epoch.proc_start_ticks, "123456");
  assert.equal(observation.source_envelope.receipt_schema_version, 3);
  assert.equal(observation.source_envelope.receipt_contract, "nexus_strict_log_coverage_resume_registration");
  assert.equal(observation.source_envelope.receipt_digest_sha256, null);
  assert.equal(observation.source_chronology.raw_provider_book_ts, 1788264000000);
  assert.equal(observation.source_chronology.raw_response_sha256, SHA.chronologyResponse);
  assert.equal(observation.source_chronology.raw_row_digest, "provider-row:SOL:1788264000000");
  assert.equal(observation.source_funding_complete, true);
  assert.equal(observation.funding_complete, false);
  assert.equal(observation.funding_evidence.official_funding_rate, null);
  assert.equal(observation.safety.affects_execution, false);
  assert.equal(observation.execution_authority, false);
  assert.equal(packet.execution_eligible, false);
  assert.deepEqual(packet.missing_evidence, ["funding"]);
});

test("malformed provenance SHA-256 values fail instead of becoming trusted evidence", () => {
  assert.throws(() => agentSpec({
    source_strategy_contract: {
      contract_id: "perp_funding_boundary:v3",
      package_manifest_sha256: "not-a-sha256",
    },
  }), /package_manifest_sha256_invalid/);
});

test("funding completeness is derived from required evidence fields, not the caller claim", () => {
  const spec = agentSpec({
    evidence_requirements: [{
      requirement_id: "funding",
      evidence_type: "hyperliquid_funding",
      material: true,
      maximum_age_ms: 5_000,
      allowed_providers: ["hyperliquid"],
      funding_complete_required: true,
    }],
  });
  const packet = createEvidencePacket({
    evidence_packet_id: "evidence_funding_complete",
    agent_spec: spec,
    decision_at: T1,
    unified_portfolio_snapshot_ref: { record_id: "portfolio_001", record_hash: "portfolio_hash_001" },
    observations: [{
      observation_id: "funding_complete_001",
      requirement_id: "funding",
      evidence_type: "hyperliquid_funding",
      provider: "hyperliquid",
      source: "official funding history",
      chain_id: "hyperliquid",
      venue: "hyperliquid",
      observed_at: T0,
      retrieved_at: T1,
      expires_at: EXPIRY,
      finality_state: "provider_confirmed",
      freshness_state: "fresh",
      verification_state: "verified",
      facts: { boundary_observed: true },
      funding_evidence: {
        funding_complete: false,
        root_id: "root_001",
        provider_coin: "SOL",
        boundary_ts: 1788264000,
        boundary_ms: 1788264000000,
        request_start_ms: 1788263999900,
        request_end_ms: 1788264000100,
        raw_response_sha256: SHA.rawResponse,
        raw_row: { coin: "SOL", time: 1788264000000 },
        raw_row_sha256: SHA.rawRow,
        raw_time_equals_boundary_ms: true,
        official_funding_rate: "0.0001",
        funding_rate_rational_numerator: "1",
        funding_rate_rational_denominator: "10000",
        oracle_price: "200",
        oracle_price_atoms: "200000000",
        quantity_atoms: "1000000",
        position_size_atoms: "1000000",
        signed_funding_pnl_usd: "0.02",
        signed_funding_pnl_atoms: "20000",
        pre_source_us: 1788263999999999,
        post_source_us: 1788264000000001,
        activation_identity_digest: "activation_001",
        source_envelope_sha256: SHA.envelope,
      },
      raw_evidence_ref: "funding:row:complete:001",
    }],
  });
  assert.equal(packet.observations[0].source_funding_complete, false);
  assert.equal(packet.observations[0].funding_complete, true);
  assert.equal(packet.observations[0].funding_evidence.completeness_gate, "complete");
  assert.equal(packet.execution_eligible, true);
});
