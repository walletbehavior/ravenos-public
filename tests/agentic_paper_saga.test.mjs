import assert from "node:assert/strict";
import test from "node:test";

import { createPaperVenueAdapter } from "../lib/agentic_trading/paper_adapter.mjs";
import { createAgenticUserPolicy } from "../lib/agentic_trading/policy.mjs";
import {
  createAgenticSagaStore,
  createPaperPlanOrchestrator,
} from "../lib/agentic_trading/saga.mjs";

const NOW = Date.parse("2026-09-01T18:00:00.000Z");
const EXPIRES = "2026-09-01T18:00:30.000Z";
const SOLANA = "solana:mainnet-beta";
const JUPITER = "jupiter@solana:mainnet-beta#mainnet";
const SOLANA_USDC = "solana:mainnet-beta/spl:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOLANA_SOL = "solana:mainnet-beta/native:sol";
const SOLANA_INSTRUMENT = "instrument:solana-spot-sol-usdc";
const HYPERLIQUID = "hyperliquid:mainnet";
const HL_VENUE = "hyperliquid@hyperliquid:mainnet#mainnet";
const HL_USDC = "hyperliquid:mainnet/venue-asset:usdc";
const HL_INSTRUMENT = "instrument:hyperliquid-sol-perp";

function spotIntent(planId = "multi-plan") {
  return {
    plan_id: planId,
    leg_id: "spot-leg",
    intent_id: `${planId}-spot-intent`,
    chain_id: SOLANA,
    venue_id: JUPITER,
    instrument_id: SOLANA_INSTRUMENT,
    action: "buy",
    amount: { kind: "notional", value: "100", asset_id: SOLANA_USDC },
    settlement_asset: { asset_id: SOLANA_USDC },
    order_constraints: { maximum_slippage_bps: 50, maximum_price_impact_bps: 100, time_in_force: "ioc" },
    idempotency_key: `${planId}-spot-once`,
    environment: "paper",
    expires_at: EXPIRES,
    execution_boundary: { live_placement_enabled: false },
  };
}

function hedgeIntent(planId = "multi-plan") {
  return {
    plan_id: planId,
    leg_id: "hedge-leg",
    intent_id: `${planId}-hedge-intent`,
    chain_id: HYPERLIQUID,
    venue_id: HL_VENUE,
    instrument_id: HL_INSTRUMENT,
    action: "open_short",
    amount: { kind: "notional", value: "100", asset_id: HL_USDC },
    settlement_asset: { asset_id: HL_USDC },
    order_constraints: { maximum_slippage_bps: 30, maximum_price_impact_bps: 80, time_in_force: "ioc" },
    idempotency_key: `${planId}-hedge-once`,
    environment: "paper",
    expires_at: EXPIRES,
    execution_boundary: { live_placement_enabled: false },
  };
}

function spotQuote(intent) {
  return {
    quote_id: `${intent.plan_id}-spot-quote`,
    leg_id: intent.leg_id,
    chain_id: SOLANA,
    venue_id: JUPITER,
    instrument_id: SOLANA_INSTRUMENT,
    action: "buy",
    state: "executable",
    provider: "jupiter-fixture-depth",
    provider_health: "healthy",
    observed_at: "2026-09-01T17:59:59.000Z",
    expires_at: EXPIRES,
    requested_notional_usdc_micros: "100000000",
    executable_notional_usdc_micros: "100000000",
    executable_quantity_atomic: "500000000",
    average_price: "200",
    worst_price: "200.2",
    price_impact_bps: 10,
    estimated_slippage_bps: 20,
    venue_fee_usdc_micros: "0",
    network_fee_usdc_micros: "5000",
    gas_fee_usdc_micros: "0",
    funding_usdc_micros: "0",
    raven_fee_usdc_micros: "100000",
    gas_asset_id: SOLANA_SOL,
    gas_required_atomic: "5000",
    quote_depth_source: "jupiter_executable_route",
    order_book_levels_consumed: 1,
  };
}

function hedgeQuote(intent) {
  return {
    quote_id: `${intent.plan_id}-hedge-quote`,
    leg_id: intent.leg_id,
    chain_id: HYPERLIQUID,
    venue_id: HL_VENUE,
    instrument_id: HL_INSTRUMENT,
    action: "open_short",
    state: "executable",
    provider: "hyperliquid-l2-fixture",
    provider_health: "healthy",
    observed_at: "2026-09-01T17:59:59.000Z",
    expires_at: EXPIRES,
    requested_notional_usdc_micros: "100000000",
    executable_notional_usdc_micros: "100000000",
    executable_quantity_atomic: "500000000",
    average_price: "200",
    worst_price: "199.9",
    price_impact_bps: 5,
    estimated_slippage_bps: 10,
    venue_fee_usdc_micros: "35000",
    network_fee_usdc_micros: "0",
    gas_fee_usdc_micros: "0",
    funding_usdc_micros: "12000",
    raven_fee_usdc_micros: "100000",
    gas_required_atomic: "0",
    quote_depth_source: "hyperliquid_executable_l2",
    order_book_levels_consumed: 2,
  };
}

function balances() {
  return [
    { chain_id: SOLANA, venue_id: JUPITER, asset_id: SOLANA_USDC, available_atomic: "500000000", state: "available" },
    { chain_id: SOLANA, venue_id: JUPITER, asset_id: SOLANA_SOL, available_atomic: "100000", state: "available" },
    { chain_id: HYPERLIQUID, venue_id: HL_VENUE, asset_id: HL_USDC, available_atomic: "500000000", state: "available" },
  ];
}

function account(chainId, venueId) {
  return { balances: balances().filter((row) => row.chain_id === chainId && row.venue_id === venueId), positions: [] };
}

function makeAdapters({ rejectHedge = false, spotState = null, hedgeState = null } = {}) {
  const spot = createPaperVenueAdapter({
    capability: {
      adapter_id: "jupiter-paper",
      adapter_version: "1",
      chain_id: SOLANA,
      venue_id: JUPITER,
      instrument_types: ["spot"],
      settlement_asset_ids: [SOLANA_USDC],
      native_gas_asset_id: SOLANA_SOL,
    },
    quote_source: async (intent) => spotQuote(intent),
    account_source: async () => account(SOLANA, JUPITER),
    clock: () => NOW,
    paper_state: spotState,
  });
  const hedge = createPaperVenueAdapter({
    capability: {
      adapter_id: "hyperliquid-paper",
      adapter_version: "1",
      chain_id: HYPERLIQUID,
      venue_id: HL_VENUE,
      instrument_types: ["perpetual"],
      settlement_asset_ids: [HL_USDC],
    },
    quote_source: async (intent) => hedgeQuote(intent),
    account_source: async () => account(HYPERLIQUID, HL_VENUE),
    clock: () => NOW,
    rejection_policy: rejectHedge ? async () => "simulated_hedge_venue_rejection" : null,
    paper_state: hedgeState,
  });
  return { spot, hedge };
}

function userPolicy() {
  return createAgenticUserPolicy({
    policy_id: "paper-policy",
    version: 1,
    owner_tenant_id: "tenant-a",
    authority: "user",
    adoption_state: "active",
    created_at: "2026-09-01T17:00:00.000Z",
    allowed_chain_ids: [SOLANA, HYPERLIQUID],
    allowed_venue_ids: [JUPITER, HL_VENUE],
    limits: {
      max_leg_notional_usdc_micros: "150000000",
      max_plan_notional_usdc_micros: "250000000",
      max_agent_capital_usdc_micros: "500000000",
      max_partial_plan_exposure_usdc_micros: "200000000",
      max_unhedged_duration_ms: 5_000,
      max_price_impact_bps: 100,
      max_slippage_bps: 100,
      max_total_cost_usdc_micros: "1000000",
    },
    minimum_native_gas_by_location: [{ chain_id: SOLANA, venue_id: JUPITER, asset_id: SOLANA_SOL, minimum_atomic: "10000" }],
    evidence_requirements: { maximum_age_ms: 10_000, minimum_finality: "confirmed", require_verified_identity: true },
    decision_ttl_ms: 5_000,
  });
}

function evidence() {
  return {
    evidence_packet_id: "paper-evidence",
    observed_at: "2026-09-01T17:59:58.000Z",
    expires_at: EXPIRES,
    finality: "finalized",
    verification_status: "verified",
    missing_evidence: [],
    contradictions: [],
    unresolved_conditions: [],
    execution_eligible: true,
  };
}

function portfolio() {
  return { snapshot_id: "paper-portfolio", balances: balances(), agent_reserved_usdc_micros: "0" };
}

function plan(planId = "multi-plan") {
  return {
    plan_id: planId,
    idempotency_key: `${planId}-once`,
    environment: "paper",
    expires_at: EXPIRES,
    maximum_time_between_legs_ms: 2_000,
    maximum_partial_exposure_usdc_micros: "100000000",
    leg_order: ["spot-leg", "hedge-leg"],
    dependencies: [{ from_leg_id: "spot-leg", to_leg_id: "hedge-leg", relationship: "hedge", required: true, maximum_delay_ms: 2_000 }],
    live_execution_enabled: false,
  };
}

test("two-venue paper plan reserves local capital, fills both legs, reconciles, and completes", async () => {
  const { spot, hedge } = makeAdapters();
  const store = createAgenticSagaStore({ initial_balances: balances() });
  const orchestrator = createPaperPlanOrchestrator({ adapters: [spot, hedge], store, clock: () => NOW });
  const value = await orchestrator.runPaperPlan({
    plan: plan(),
    intents: [spotIntent(), hedgeIntent()],
    policy: userPolicy(),
    portfolio: portfolio(),
    evidence: evidence(),
  });
  assert.equal(value.state, "completed");
  assert.equal(value.receipts.length, 2);
  assert.deepEqual(value.receipts.map((row) => row.status), ["filled", "filled"]);
  assert.equal(value.reconciliations.every((row) => row.ok), true);
  assert.equal(value.automatic_retry_performed, false);
  assert.equal(value.automatic_unwind_performed, false);
  assert.equal(value.receipts.every((row) => row.live_execution === false && row.broadcast_performed === false), true);
  assert.deepEqual(store.reservations.forPlan("multi-plan").map((row) => row.state), ["consumed", "consumed"]);
  assert.ok(orchestrator.audit("multi-plan").some((row) => row.event_type === "policy_rechecked_before_leg" && row.payload.leg_id === "hedge-leg"));
  const repeated = await orchestrator.runPaperPlan({ plan: plan(), intents: [spotIntent(), hedgeIntent()], policy: userPolicy(), portfolio: portfolio(), evidence: evidence() });
  assert.equal(repeated.idempotent_replay, true);
  assert.equal(spot.diagnostics().paper_place, 1);
  assert.equal(hedge.diagnostics().paper_place, 1);
});

test("first-leg fill plus hedge rejection becomes explicit partial execution with no automatic retry or unwind", async () => {
  const runAdapters = makeAdapters({ rejectHedge: true });
  const store = createAgenticSagaStore({ initial_balances: balances() });
  const orchestrator = createPaperPlanOrchestrator({ adapters: [runAdapters.spot, runAdapters.hedge], store, clock: () => NOW });
  const partial = await orchestrator.runPaperPlan({
    plan: plan("partial-plan"),
    intents: [spotIntent("partial-plan"), hedgeIntent("partial-plan")],
    policy: userPolicy(),
    portfolio: portfolio(),
    evidence: evidence(),
  });
  assert.equal(partial.state, "partially_executed");
  assert.equal(partial.receipts[0].status, "filled");
  assert.equal(partial.receipts[1].status, "rejected");
  assert.ok(partial.receipts[1].rejection_reasons.includes("simulated_hedge_venue_rejection"));
  assert.equal(partial.resulting_unhedged_exposure.length, 1);
  assert.equal(partial.resulting_unhedged_exposure[0].leg_id, "spot-leg");
  assert.equal(partial.reconciliation_required, true);
  assert.equal(partial.requires_new_policy_decision, true);
  assert.equal(partial.automatic_retry_performed, false);
  assert.equal(partial.automatic_unwind_performed, false);
  assert.equal(runAdapters.hedge.diagnostics().paper_place, 1);
  assert.deepEqual(store.reservations.forPlan("partial-plan").map((row) => row.state), ["consumed", "released"]);
  assert.deepEqual(orchestrator.requestCompensation("partial-plan"), {
    ok: false,
    reason: "new_policy_decision_required",
    execution_started: false,
    automatic_unwind_performed: false,
  });
});

test("restart resumes reconciliation only; it cannot replay the filled spot leg or rejected hedge", async () => {
  const firstAdapters = makeAdapters({ rejectHedge: true });
  const firstStore = createAgenticSagaStore({ initial_balances: balances() });
  const first = createPaperPlanOrchestrator({ adapters: [firstAdapters.spot, firstAdapters.hedge], store: firstStore, clock: () => NOW });
  await first.runPaperPlan({ plan: plan("restart-plan"), intents: [spotIntent("restart-plan"), hedgeIntent("restart-plan")], policy: userPolicy(), portfolio: portfolio(), evidence: evidence() });
  const storeSnapshot = first.snapshot();
  const adapterSnapshots = {
    spot: firstAdapters.spot.snapshotPaperState(),
    hedge: firstAdapters.hedge.snapshotPaperState(),
  };
  const restoredStore = createAgenticSagaStore({ snapshot: storeSnapshot });
  const restoredAdapters = makeAdapters({ rejectHedge: true, spotState: adapterSnapshots.spot, hedgeState: adapterSnapshots.hedge });
  const restored = createPaperPlanOrchestrator({ adapters: [restoredAdapters.spot, restoredAdapters.hedge], store: restoredStore, clock: () => NOW });
  const resumed = await restored.resumePlan("restart-plan");
  assert.equal(resumed.state, "compensation_required");
  assert.equal(resumed.resume_action, "reconciliation_only");
  assert.equal(resumed.paper_execution_restarted, false);
  assert.equal(resumed.receipts.length, 2);
  assert.equal(restoredAdapters.spot.diagnostics().paper_place, 0);
  assert.equal(restoredAdapters.hedge.diagnostics().paper_place, 0);
  assert.ok(restored.audit("restart-plan").some((row) => row.event_type === "required_leg_not_filled" && row.payload.state === "partially_executed"));
  assert.ok(restored.audit("restart-plan").some((row) => row.event_type === "reconciliation_finished"));
});

test("a changed portfolio before the hedge leg causes a fresh policy block, never a stale-decision execution", async () => {
  const { spot, hedge } = makeAdapters();
  const store = createAgenticSagaStore({ initial_balances: balances() });
  let portfolioReads = 0;
  const orchestrator = createPaperPlanOrchestrator({
    adapters: [spot, hedge],
    store,
    clock: () => NOW,
    portfolio_provider: async ({ base_portfolio, stage }) => {
      portfolioReads += 1;
      if (stage === "before_leg:hedge-leg") {
        return { ...base_portfolio, snapshot_id: "changed-before-hedge", balances: base_portfolio.balances.filter((row) => row.venue_id !== HL_VENUE) };
      }
      return base_portfolio;
    },
  });
  const value = await orchestrator.runPaperPlan({ plan: plan("recheck-plan"), intents: [spotIntent("recheck-plan"), hedgeIntent("recheck-plan")], policy: userPolicy(), portfolio: portfolio(), evidence: evidence() });
  assert.equal(value.state, "partially_executed");
  assert.equal(value.receipts.length, 1);
  assert.equal(value.receipts[0].leg_id, "spot-leg");
  assert.equal(hedge.diagnostics().paper_place, 0);
  assert.ok(portfolioReads >= 3);
  assert.ok(orchestrator.audit("recheck-plan").some((row) => row.event_type === "policy_recheck_blocked"));
});

test("tampering with portable saga state is detected before restart", async () => {
  const { spot, hedge } = makeAdapters();
  const store = createAgenticSagaStore({ initial_balances: balances() });
  const orchestrator = createPaperPlanOrchestrator({ adapters: [spot, hedge], store, clock: () => NOW });
  await orchestrator.runPaperPlan({ plan: plan("tamper-plan"), intents: [spotIntent("tamper-plan"), hedgeIntent("tamper-plan")], policy: userPolicy(), portfolio: portfolio(), evidence: evidence() });
  const snapshot = orchestrator.snapshot();
  const tampered = structuredClone(snapshot);
  tampered.plans[0].state = "completed-even-though-tampered";
  assert.throws(() => createAgenticSagaStore({ snapshot: tampered }), /paper_saga_snapshot_integrity_invalid/);
  assert.throws(() => createAgenticSagaStore({ snapshot: { ...snapshot, request_id: "forged-request" } }), /paper_saga_snapshot_integrity_invalid/);
});
