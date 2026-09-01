import assert from "node:assert/strict";
import test from "node:test";

import { createVenueCapability } from "../lib/agentic_trading/adapter.mjs";
import { createAppendOnlyAuditChain, verifyAuditEvents } from "../lib/agentic_trading/audit_chain.mjs";
import { createCapitalReservationBook } from "../lib/agentic_trading/capital_reservations.mjs";
import {
  createAgenticUserPolicy,
  evaluateAgenticPlanPolicy,
  verifyAgenticPolicyDecision,
} from "../lib/agentic_trading/policy.mjs";

const NOW = Date.parse("2026-09-01T18:00:00.000Z");
const EXPIRES = "2026-09-01T18:00:30.000Z";
const SOLANA = "solana:mainnet-beta";
const JUPITER = "jupiter@solana:mainnet-beta#mainnet";
const SOLANA_USDC = "solana:mainnet-beta/spl:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOLANA_SOL = "solana:mainnet-beta/native:sol";
const INSTRUMENT = "instrument:solana-bonk-usdc";

function intent(overrides = {}) {
  return {
    plan_id: "plan-policy",
    leg_id: "leg-solana",
    intent_id: "intent-solana",
    chain_id: SOLANA,
    venue_id: JUPITER,
    instrument_id: INSTRUMENT,
    action: "buy",
    amount: { kind: "notional", value: "100", asset_id: SOLANA_USDC },
    settlement_asset: { asset_id: SOLANA_USDC },
    order_constraints: { maximum_slippage_bps: 50, maximum_price_impact_bps: 100, time_in_force: "ioc" },
    idempotency_key: "intent-solana-once",
    environment: "paper",
    expires_at: EXPIRES,
    ...overrides,
  };
}

function quote(overrides = {}) {
  return {
    quote_id: "quote-solana",
    leg_id: "leg-solana",
    chain_id: SOLANA,
    venue_id: JUPITER,
    instrument_id: INSTRUMENT,
    state: "executable",
    provider_health: "healthy",
    observed_at: "2026-09-01T17:59:59.000Z",
    expires_at: EXPIRES,
    requested_notional_usdc_micros: "100000000",
    price_impact_bps: 20,
    slippage_bps: 50,
    gas_asset_id: SOLANA_SOL,
    gas_required_atomic: "5000",
    costs_usdc_micros: {
      venue_fee_usdc_micros: "10000",
      network_fee_usdc_micros: "5000",
      gas_fee_usdc_micros: "0",
      funding_usdc_micros: "0",
      raven_fee_usdc_micros: "100000",
    },
    ...overrides,
  };
}

function policy(overrides = {}) {
  return createAgenticUserPolicy({
    policy_id: "user-policy",
    version: 1,
    owner_tenant_id: "tenant-a",
    authority: "user",
    adoption_state: "active",
    created_at: "2026-09-01T17:00:00.000Z",
    allowed_chain_ids: [SOLANA],
    allowed_venue_ids: [JUPITER],
    limits: {
      max_leg_notional_usdc_micros: "200000000",
      max_plan_notional_usdc_micros: "200000000",
      max_agent_capital_usdc_micros: "500000000",
      max_partial_plan_exposure_usdc_micros: "200000000",
      max_price_impact_bps: 100,
      max_slippage_bps: 100,
      max_total_cost_usdc_micros: "1000000",
      ...(overrides.limits || {}),
    },
    minimum_native_gas_by_location: [{ chain_id: SOLANA, venue_id: JUPITER, asset_id: SOLANA_SOL, minimum_atomic: "10000" }],
    evidence_requirements: { maximum_age_ms: 10_000, minimum_finality: "confirmed", require_verified_identity: true },
    decision_ttl_ms: 5_000,
    ...overrides,
  });
}

function evidence(overrides = {}) {
  return {
    evidence_packet_id: "evidence-1",
    observed_at: "2026-09-01T17:59:58.000Z",
    expires_at: EXPIRES,
    finality: "finalized",
    verification_status: "verified",
    missing_evidence: [],
    contradictions: [],
    unresolved_conditions: [],
    execution_eligible: true,
    ...overrides,
  };
}

function portfolio(overrides = {}) {
  return {
    snapshot_id: "portfolio-1",
    balances: [
      { chain_id: SOLANA, venue_id: JUPITER, asset_id: SOLANA_USDC, available_atomic: "500000000", state: "available" },
      { chain_id: SOLANA, venue_id: JUPITER, asset_id: SOLANA_SOL, available_atomic: "100000000", state: "available" },
    ],
    agent_reserved_usdc_micros: "0",
    ...overrides,
  };
}

function plan(legs = [intent()], overrides = {}) {
  return {
    plan_id: "plan-policy",
    environment: "paper",
    expires_at: EXPIRES,
    maximum_time_between_legs_ms: 2_000,
    maximum_partial_exposure_usdc_micros: "100000000",
    idempotency_key: "plan-policy-once",
    legs,
    ...overrides,
  };
}

test("venue capabilities preserve case-sensitive Solana asset identity", () => {
  const capability = createVenueCapability({
    adapter_id: "Jupiter-Paper",
    chain_id: SOLANA,
    venue_id: JUPITER,
    environment: "paper",
    instrument_types: ["spot"],
    settlement_asset_ids: [SOLANA_USDC],
    native_gas_asset_id: SOLANA_SOL,
    operations: { quote: true, preview: true, paper_place: true, reconcile: true, health: true },
  });
  assert.equal(capability.settlement_asset_ids[0], SOLANA_USDC);
  assert.match(capability.settlement_asset_ids[0], /EPjFWdd5/);
  assert.equal(capability.live_execution_enabled, false);
  assert.throws(() => createVenueCapability({ ...capability, operations: { ...capability.operations, live_place: true } }), /live_place_capability_forbidden/);
});

test("read-only venue capabilities can declare observation without execution", () => {
  const capability = createVenueCapability({
    adapter_id: "robinhood-chain-observer",
    chain_id: "eip155:4663",
    venue_id: "robinhood-chain@eip155:4663#mainnet",
    environment: "mainnet_read_only",
    instrument_types: ["spot"],
    settlement_asset_ids: [],
    operations: { observe_account: true, health: true },
  });
  assert.equal(capability.operations.observe_account, true);
  assert.equal(capability.operations.quote, false);
  assert.equal(capability.operations.paper_place, false);
  assert.equal(capability.operations.live_place, false);
});

test("only an explicitly adopted user policy can authorize a paper plan", () => {
  assert.throws(() => policy({ authority: "raven" }), /user_policy_authority_required/);
  assert.throws(() => policy({ adoption_state: "suggested" }), /user_policy_explicit_adoption_required/);
  const leg = intent();
  const decision = evaluateAgenticPlanPolicy({
    plan: plan([leg]),
    policy: policy(),
    portfolio: portfolio(),
    evidence: evidence(),
    quotes: { [leg.leg_id]: quote() },
    now: NOW,
  });
  assert.equal(decision.result, "allow");
  assert.equal(decision.live_execution_allowed, false);
  assert.ok(decision.leg_results.every((row) => row.result === "allow"));
});

test("missing, stale, contradictory, and unhealthy evidence remain indeterminate", () => {
  const leg = intent();
  const cases = [
    evidence({ missing_evidence: ["executable_depth"], execution_eligible: false }),
    evidence({ observed_at: "2026-09-01T17:00:00.000Z" }),
    evidence({ contradictions: ["provider_disagreement"] }),
  ];
  for (const packet of cases) {
    const decision = evaluateAgenticPlanPolicy({ plan: plan([leg]), policy: policy(), portfolio: portfolio(), evidence: packet, quotes: { [leg.leg_id]: quote() }, now: NOW });
    assert.equal(decision.result, "indeterminate");
  }
  const providerFailure = evaluateAgenticPlanPolicy({
    plan: plan([leg]), policy: policy(), portfolio: portfolio(), evidence: evidence(), quotes: { [leg.leg_id]: quote({ provider_health: "degraded" }) }, now: NOW,
  });
  assert.equal(providerFailure.result, "indeterminate");
});

test("an intent that is not execution-ready remains indeterminate", () => {
  const leg = intent({ readiness: { state: "indeterminate", execution_eligible: false, reasons: ["gas_unknown"] } });
  const decision = evaluateAgenticPlanPolicy({ plan: plan([leg]), policy: policy(), portfolio: portfolio(), evidence: evidence(), quotes: { [leg.leg_id]: quote() }, now: NOW });
  assert.equal(decision.result, "indeterminate");
  assert.ok(decision.leg_results[0].rules.some((row) => row.rule_id === "intent_readiness" && row.result === "indeterminate"));
});

test("local capital covers explicit friction instead of only headline notional", () => {
  const leg = intent();
  const exactNotionalOnly = portfolio({
    balances: [
      { chain_id: SOLANA, venue_id: JUPITER, asset_id: SOLANA_USDC, available_atomic: "100000000", state: "available" },
      { chain_id: SOLANA, venue_id: JUPITER, asset_id: SOLANA_SOL, available_atomic: "100000000", state: "available" },
    ],
  });
  const decision = evaluateAgenticPlanPolicy({ plan: plan([leg]), policy: policy(), portfolio: exactNotionalOnly, evidence: evidence(), quotes: { [leg.leg_id]: quote() }, now: NOW });
  assert.equal(decision.result, "block");
  assert.ok(decision.leg_results[0].rules.some((row) => row.rule_id === "local_venue_capital" && row.configured_limit === "100115000" && row.result === "block"));
});

test("policy aggregates capital, gas consumption, and the minimum reserve when they share one asset", () => {
  const leg = intent({
    amount: { kind: "notional", value: "100", asset_id: SOLANA_SOL },
    settlement_asset: { asset_id: SOLANA_SOL },
  });
  const sameAssetQuote = quote({
    capital_asset_id: SOLANA_SOL,
    capital_reservation_amount_atomic: "95000000",
    gas_asset_id: SOLANA_SOL,
    gas_required_atomic: "10000000",
  });
  const sameAssetPortfolio = portfolio({
    balances: [{ chain_id: SOLANA, venue_id: JUPITER, asset_id: SOLANA_SOL, available_atomic: "100000000", state: "available" }],
  });
  const decision = evaluateAgenticPlanPolicy({
    plan: plan([leg]),
    policy: policy(),
    portfolio: sameAssetPortfolio,
    evidence: evidence(),
    quotes: { [leg.leg_id]: sameAssetQuote },
    now: NOW,
  });
  assert.equal(decision.result, "block");
  assert.ok(decision.leg_results[0].rules.some((row) => row.rule_id === "combined_capital_and_gas" && row.configured_limit === "105010000" && row.result === "block"));
  assert.ok(decision.plan_rules.some((row) => row.rule_id === "combined_local_capital" && row.configured_limit === "105010000" && row.result === "block"));
});

test("capital on another chain cannot satisfy a local venue requirement", () => {
  const leg = intent();
  const wrongChain = portfolio({
    balances: [
      { chain_id: "eip155:8453", venue_id: "uniswap@eip155:8453#mainnet", asset_id: "eip155:8453/erc20:0x0000000000000000000000000000000000000001", available_atomic: "999999999999", state: "available" },
      { chain_id: SOLANA, venue_id: JUPITER, asset_id: SOLANA_SOL, available_atomic: "100000000", state: "available" },
    ],
  });
  const decision = evaluateAgenticPlanPolicy({ plan: plan([leg]), policy: policy(), portfolio: wrongChain, evidence: evidence(), quotes: { [leg.leg_id]: quote() }, now: NOW });
  assert.equal(decision.result, "indeterminate");
  assert.ok(decision.leg_results[0].rules.some((row) => row.rule_id === "local_venue_capital" && row.reason === "local_balance_unresolved"));
});

test("splitting a plan cannot bypass the combined notional limit", () => {
  const first = intent({ leg_id: "leg-one", intent_id: "intent-one", idempotency_key: "one", amount: { kind: "notional", value: "75", asset_id: SOLANA_USDC } });
  const second = intent({ leg_id: "leg-two", intent_id: "intent-two", idempotency_key: "two", amount: { kind: "notional", value: "75", asset_id: SOLANA_USDC } });
  const quotes = {
    "leg-one": quote({ quote_id: "q-one", leg_id: "leg-one", requested_notional_usdc_micros: "75000000" }),
    "leg-two": quote({ quote_id: "q-two", leg_id: "leg-two", requested_notional_usdc_micros: "75000000" }),
  };
  const restricted = policy({ limits: { max_leg_notional_usdc_micros: "100000000", max_plan_notional_usdc_micros: "100000000" } });
  const decision = evaluateAgenticPlanPolicy({
    plan: plan([first, second], { maximum_partial_exposure_usdc_micros: "75000000" }),
    policy: restricted,
    portfolio: portfolio(),
    evidence: evidence(),
    quotes,
    now: NOW,
  });
  assert.equal(decision.leg_results[0].result, "allow");
  assert.equal(decision.leg_results[1].result, "allow");
  assert.equal(decision.result, "block");
  assert.ok(decision.plan_rules.some((row) => row.rule_id === "max_plan_notional" && row.result === "block"));
});

test("changed intent, quote, portfolio, or policy invalidates a prior allow", () => {
  const leg = intent();
  const activePolicy = policy();
  const currentPortfolio = portfolio();
  const packet = evidence();
  const quotes = { [leg.leg_id]: quote() };
  const tradePlan = plan([leg]);
  const decision = evaluateAgenticPlanPolicy({ plan: tradePlan, policy: activePolicy, portfolio: currentPortfolio, evidence: packet, quotes, now: NOW });
  assert.equal(verifyAgenticPolicyDecision(decision, { plan: tradePlan, intents: [leg], policy: activePolicy, portfolio: currentPortfolio, evidence: packet, quotes, now: NOW }).ok, true);
  assert.match(verifyAgenticPolicyDecision(decision, { plan: tradePlan, intents: [{ ...leg, action: "sell" }], policy: activePolicy, portfolio: currentPortfolio, evidence: packet, quotes, now: NOW }).errors.join(","), /intent_changed_since_policy/);
  assert.match(verifyAgenticPolicyDecision(decision, { plan: tradePlan, intents: [leg], policy: activePolicy, portfolio: currentPortfolio, evidence: packet, quotes: { [leg.leg_id]: quote({ quote_id: "changed" }) }, now: NOW }).errors.join(","), /quote_changed_since_policy/);
  assert.match(verifyAgenticPolicyDecision(decision, { plan: tradePlan, intents: [leg], policy: activePolicy, portfolio: portfolio({ snapshot_id: "changed" }), evidence: packet, quotes, now: NOW }).errors.join(","), /portfolio_changed_since_policy/);
  const changedPolicy = policy({ version: 2 });
  assert.match(verifyAgenticPolicyDecision(decision, { plan: tradePlan, intents: [leg], policy: changedPolicy, portfolio: currentPortfolio, evidence: packet, quotes, now: NOW }).errors.join(","), /policy_changed_since_decision/);
  assert.match(verifyAgenticPolicyDecision({ ...decision, ui_state: "forged-allow" }, { plan: tradePlan, intents: [leg], policy: activePolicy, portfolio: currentPortfolio, evidence: packet, quotes, now: NOW }).errors.join(","), /policy_decision_integrity_invalid/);
});

test("capital reservations are exact-location, idempotent, and case preserving", () => {
  const book = createCapitalReservationBook({ initial_balances: [
    { chain_id: SOLANA, venue_id: JUPITER, asset_id: SOLANA_USDC, available_atomic: "100000000" },
    { chain_id: SOLANA, venue_id: JUPITER, asset_id: SOLANA_SOL, available_atomic: "20000" },
  ] });
  const request = {
    reservation_id: "reserve-case",
    plan_id: "plan-policy",
    leg_id: "leg-solana",
    chain_id: SOLANA,
    venue_id: JUPITER,
    asset_id: SOLANA_USDC,
    amount_atomic: "90000000",
    gas_asset_id: SOLANA_SOL,
    gas_amount_atomic: "5000",
    created_at: "2026-09-01T18:00:00.000Z",
    updated_at: "2026-09-01T18:00:00.000Z",
  };
  const first = book.reserve(request);
  assert.equal(first.ok, true);
  assert.equal(first.reservation.asset_id, SOLANA_USDC);
  assert.equal(book.reserve(request).idempotent, true);
  assert.throws(() => book.reserve({ ...request, amount_atomic: "80000000" }), /reservation_idempotency_conflict/);
  const unavailable = book.reserve({ ...request, reservation_id: "reserve-other", leg_id: "other", chain_id: "eip155:8453", venue_id: "uniswap@eip155:8453#mainnet" });
  assert.deepEqual({ ok: unavailable.ok, reason: unavailable.reason }, { ok: false, reason: "local_capital_unavailable" });
});

test("one asset cannot be independently overcommitted as both capital and gas", () => {
  const book = createCapitalReservationBook({ initial_balances: [
    { chain_id: SOLANA, venue_id: JUPITER, asset_id: SOLANA_SOL, available_atomic: "100" },
  ] });
  const result = book.reserve({
    reservation_id: "reserve-same-asset",
    plan_id: "plan-same-asset",
    leg_id: "leg-same-asset",
    chain_id: SOLANA,
    venue_id: JUPITER,
    asset_id: SOLANA_SOL,
    amount_atomic: "95",
    gas_asset_id: SOLANA_SOL,
    gas_amount_atomic: "10",
    created_at: "2026-09-01T18:00:00.000Z",
    updated_at: "2026-09-01T18:00:00.000Z",
  });
  assert.deepEqual({ ok: result.ok, reason: result.reason }, { ok: false, reason: "insufficient_local_capital" });
  assert.equal(book.balance({ chain_id: SOLANA, venue_id: JUPITER, asset_id: SOLANA_SOL }).unreserved_atomic, "100");
});

test("consumed reservations remain unavailable until venue reconciliation updates balances", () => {
  const book = createCapitalReservationBook({ initial_balances: [
    { chain_id: SOLANA, venue_id: JUPITER, asset_id: SOLANA_USDC, available_atomic: "100000000" },
  ] });
  const first = book.reserve({
    reservation_id: "reserve-consumed",
    plan_id: "plan-consumed",
    leg_id: "leg-consumed",
    chain_id: SOLANA,
    venue_id: JUPITER,
    asset_id: SOLANA_USDC,
    amount_atomic: "75000000",
    created_at: "2026-09-01T18:00:00.000Z",
    updated_at: "2026-09-01T18:00:00.000Z",
  });
  assert.equal(first.ok, true);
  book.transition("reserve-consumed", "consumed", "2026-09-01T18:00:01.000Z");
  assert.equal(book.balance({ chain_id: SOLANA, venue_id: JUPITER, asset_id: SOLANA_USDC }).unreserved_atomic, "25000000");
  const second = book.reserve({
    reservation_id: "reserve-reuse",
    plan_id: "plan-reuse",
    leg_id: "leg-reuse",
    chain_id: SOLANA,
    venue_id: JUPITER,
    asset_id: SOLANA_USDC,
    amount_atomic: "50000000",
    created_at: "2026-09-01T18:00:02.000Z",
    updated_at: "2026-09-01T18:00:02.000Z",
  });
  assert.deepEqual({ ok: second.ok, reason: second.reason }, { ok: false, reason: "insufficient_local_capital" });
});

test("audit history is append-only, idempotent, tamper-evident, and rejects secrets", () => {
  const chain = createAppendOnlyAuditChain();
  const input = { event_id: "event-1", aggregate_type: "trade_plan", aggregate_id: "plan-policy", event_type: "policy_allowed", occurred_at: "2026-09-01T18:00:00.000Z", payload: { result: "allow" } };
  assert.equal(chain.append(input).idempotent, false);
  assert.equal(chain.append(input).idempotent, true);
  assert.throws(() => chain.append({ ...input, event_type: "changed" }), /audit_idempotency_conflict/);
  assert.throws(() => chain.append({ ...input, event_id: "event-secret", payload: { api_key: "forbidden" } }), /secret_bearing_field/);
  const rows = chain.all();
  assert.equal(verifyAuditEvents(rows).head_hash, rows[0].event_hash);
  assert.throws(() => verifyAuditEvents([{ ...rows[0], payload: { result: "block" } }]), /audit_event_hash_invalid/);
  assert.throws(() => verifyAuditEvents([{ ...rows[0], request_id: "forged-request" }]), /audit_event_hash_invalid/);
});
