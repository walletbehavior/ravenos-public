import assert from "node:assert/strict";
import test from "node:test";

import { createCapitalReservationBook } from "../lib/agentic_trading/capital_reservations.mjs";
import {
  createPaperVenueAdapter,
  normalizeExecutablePaperQuote,
} from "../lib/agentic_trading/paper_adapter.mjs";
import {
  createAgenticUserPolicy,
  evaluateAgenticPlanPolicy,
} from "../lib/agentic_trading/policy.mjs";

const NOW = Date.parse("2026-09-01T18:00:00.000Z");
const SOLANA = "solana:mainnet-beta";
const JUPITER = "jupiter@solana:mainnet-beta#mainnet";
const SOLANA_USDC = "solana:mainnet-beta/spl:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOLANA_SOL = "solana:mainnet-beta/native:sol";
const INSTRUMENT = "instrument:solana-bonk-usdc";

function intent(overrides = {}) {
  return {
    plan_id: "paper-plan",
    leg_id: "paper-leg",
    intent_id: "paper-intent",
    chain_id: SOLANA,
    venue_id: JUPITER,
    instrument_id: INSTRUMENT,
    action: "buy",
    amount: { kind: "notional", value: "100", asset_id: SOLANA_USDC },
    settlement_asset: { asset_id: SOLANA_USDC },
    order_constraints: { time_in_force: "ioc" },
    idempotency_key: "paper-intent-once",
    environment: "paper",
    ...overrides,
  };
}

function rawQuote(overrides = {}) {
  return {
    quote_id: "paper-quote",
    leg_id: "paper-leg",
    chain_id: SOLANA,
    venue_id: JUPITER,
    instrument_id: INSTRUMENT,
    action: "buy",
    state: "executable",
    provider: "fixture-executable-book",
    provider_health: "healthy",
    observed_at: "2026-09-01T17:59:59.500Z",
    expires_at: "2026-09-01T18:00:10.000Z",
    requested_notional_usdc_micros: "100000000",
    executable_notional_usdc_micros: "100000000",
    executable_quantity_atomic: "500000000",
    average_price: "0.2",
    worst_price: "0.201",
    price_impact_bps: 20,
    estimated_slippage_bps: 25,
    venue_fee_usdc_micros: "10000",
    network_fee_usdc_micros: "5000",
    gas_fee_usdc_micros: "0",
    funding_usdc_micros: "0",
    raven_fee_usdc_micros: "100000",
    gas_asset_id: SOLANA_SOL,
    gas_required_atomic: "5000",
    quote_depth_source: "executable_route",
    order_book_levels_consumed: 2,
    ...overrides,
  };
}

function capability() {
  return {
    adapter_id: "jupiter-paper",
    adapter_version: "1",
    chain_id: SOLANA,
    venue_id: JUPITER,
    instrument_types: ["spot"],
    settlement_asset_ids: [SOLANA_USDC],
    native_gas_asset_id: SOLANA_SOL,
  };
}

function account(overrides = {}) {
  return {
    balances: [
      { chain_id: SOLANA, venue_id: JUPITER, asset_id: SOLANA_USDC, available_atomic: "500000000", state: "available" },
      { chain_id: SOLANA, venue_id: JUPITER, asset_id: SOLANA_SOL, available_atomic: "100000", state: "available" },
    ],
    positions: [],
    ...overrides,
  };
}

function paperPlan(requestIntent = intent()) {
  return {
    plan_id: requestIntent.plan_id,
    environment: "paper",
    expires_at: "2026-09-01T18:00:10.000Z",
    idempotency_key: `${requestIntent.plan_id}-once`,
    legs: [requestIntent],
  };
}

function userPolicy() {
  return createAgenticUserPolicy({
    policy_id: "paper-policy",
    version: 1,
    owner_tenant_id: "tenant-paper",
    authority: "user",
    adoption_state: "active",
    created_at: "2026-09-01T17:00:00.000Z",
    allowed_chain_ids: [SOLANA],
    allowed_venue_ids: [JUPITER],
    minimum_native_gas_by_location: [{ chain_id: SOLANA, venue_id: JUPITER, asset_id: SOLANA_SOL, minimum_atomic: "0" }],
    evidence_requirements: { maximum_age_ms: 10_000, minimum_finality: "confirmed", require_verified_identity: true },
    decision_ttl_ms: 5_000,
  });
}

function policyDecision(requestIntent, quote, executionPlan = paperPlan(requestIntent)) {
  return evaluateAgenticPlanPolicy({
    plan: executionPlan,
    intents: [requestIntent],
    policy: userPolicy(),
    portfolio: { snapshot_id: "paper-portfolio", balances: account().balances, agent_reserved_usdc_micros: "0" },
    evidence: {
      evidence_packet_id: "paper-evidence",
      observed_at: "2026-09-01T17:59:59.000Z",
      expires_at: quote.expires_at,
      finality: "finalized",
      verification_status: "verified",
      missing_evidence: [],
      contradictions: [],
      execution_eligible: true,
    },
    quotes: { [requestIntent.leg_id]: quote },
    now: NOW,
  });
}

function placement(requestIntent, quote, preview, reservationValue = reservation(requestIntent)) {
  const executionPlan = paperPlan(requestIntent);
  return {
    plan: executionPlan,
    intents: [requestIntent],
    intent: requestIntent,
    quote,
    preview,
    policy_decision: policyDecision(requestIntent, quote, executionPlan),
    reservation: reservationValue,
    now: NOW,
  };
}

function reservation(requestIntent = intent(), amountAtomic = "100115000") {
  const book = createCapitalReservationBook({ initial_balances: account().balances });
  const result = book.reserve({
    reservation_id: `reserve:${requestIntent.plan_id}:${requestIntent.leg_id}`,
    plan_id: requestIntent.plan_id,
    leg_id: requestIntent.leg_id,
    chain_id: requestIntent.chain_id,
    venue_id: requestIntent.venue_id,
    asset_id: requestIntent.amount.asset_id,
    amount_atomic: amountAtomic,
    gas_asset_id: SOLANA_SOL,
    gas_amount_atomic: "5000",
    created_at: "2026-09-01T18:00:00.000Z",
    updated_at: "2026-09-01T18:00:00.000Z",
  });
  assert.equal(result.ok, true);
  return result.reservation;
}

test("paper fills require exact executable evidence and include explicit costs", async () => {
  const requestIntent = intent();
  const adapter = createPaperVenueAdapter({
    capability: capability(),
    quote_source: async () => rawQuote(),
    account_source: async () => account(),
    clock: () => NOW,
    latency_ms: 100,
  });
  const quote = await adapter.quote(requestIntent);
  assert.equal(quote.state, "executable");
  assert.equal(quote.last_trade_price_used, false);
  assert.equal(quote.total_cost_usdc_micros, "115000");
  const preview = await adapter.preview({ intent: requestIntent, quote });
  assert.equal(preview.state, "ready");
  assert.equal(preview.live_execution_available, false);
  const receipt = await adapter.placePaper(placement(requestIntent, quote, preview));
  assert.equal(receipt.status, "filled");
  assert.equal(receipt.environment, "paper");
  assert.equal(receipt.fees.venue_fee_usdc_micros, "10000");
  assert.equal(receipt.fees.network_fee_usdc_micros, "5000");
  assert.equal(receipt.fees.raven_fee_usdc_micros, "100000");
  assert.equal(receipt.signing_performed, false);
  assert.equal(receipt.broadcast_performed, false);
  assert.equal((await adapter.placePaper(placement(requestIntent, quote, preview))).idempotent_replay, true);
  await assert.rejects(adapter.placeLive({}), /live_execution_disabled/);
  assert.equal(adapter.diagnostics().live_place, 1);
});

test("paper placement rejects a forged, stale, or differently bound policy decision at the adapter boundary", async () => {
  const requestIntent = intent({ idempotency_key: "policy-boundary-once" });
  const adapter = createPaperVenueAdapter({ capability: capability(), quote_source: async () => rawQuote(), account_source: async () => account(), clock: () => NOW });
  const quote = await adapter.quote(requestIntent);
  const preview = await adapter.preview({ intent: requestIntent, quote });
  const valid = placement(requestIntent, quote, preview);
  const forged = await adapter.placePaper({
    ...valid,
    policy_decision: { ...valid.policy_decision, decision_hash: "a".repeat(64) },
  });
  assert.equal(forged.status, "rejected");
  assert.ok(forged.rejection_reasons.includes("paper_policy_decision_integrity_invalid"));

  const secondIntent = intent({ intent_id: "paper-intent-stale", idempotency_key: "policy-stale-once" });
  const secondQuote = normalizeExecutablePaperQuote(rawQuote(), secondIntent);
  const secondPreview = await adapter.preview({ intent: secondIntent, quote: secondQuote });
  const second = placement(secondIntent, secondQuote, secondPreview);
  const stale = await adapter.placePaper({
    ...second,
    policy_decision: { ...second.policy_decision, expires_at: "2026-09-01T17:59:59.000Z" },
  });
  assert.equal(stale.status, "rejected");
  assert.ok(stale.rejection_reasons.includes("paper_policy_decision_expired"));

  const thirdIntent = intent({ intent_id: "paper-intent-quote", idempotency_key: "policy-quote-once" });
  const originalQuote = normalizeExecutablePaperQuote(rawQuote(), thirdIntent);
  const changedQuote = normalizeExecutablePaperQuote(rawQuote({ quote_id: "other-quote", average_price: "0.21" }), thirdIntent);
  const changedPreview = await adapter.preview({ intent: thirdIntent, quote: changedQuote });
  const third = placement(thirdIntent, originalQuote, changedPreview);
  const mismatched = await adapter.placePaper({ ...third, quote: changedQuote });
  assert.equal(mismatched.status, "rejected");
  assert.ok(mismatched.rejection_reasons.includes("paper_quote_changed_since_policy"));
});

test("strict hashes reject mutations to previously volatile policy and receipt fields", async () => {
  const requestIntent = intent({ idempotency_key: "strict-hash-once" });
  const adapter = createPaperVenueAdapter({ capability: capability(), quote_source: async () => rawQuote(), account_source: async () => account(), clock: () => NOW });
  const quote = await adapter.quote(requestIntent);
  const preview = await adapter.preview({ intent: requestIntent, quote });
  const valid = placement(requestIntent, quote, preview);
  const changedDecision = await adapter.placePaper({
    ...valid,
    policy_decision: { ...valid.policy_decision, ui_state: "forged-allow" },
  });
  assert.equal(changedDecision.status, "rejected");
  assert.ok(changedDecision.rejection_reasons.includes("paper_policy_decision_integrity_invalid"));

  const filledIntent = intent({ intent_id: "paper-intent-receipt", idempotency_key: "strict-receipt-once" });
  const filledQuote = normalizeExecutablePaperQuote(rawQuote(), filledIntent);
  const filledPreview = await adapter.preview({ intent: filledIntent, quote: filledQuote });
  const receipt = await adapter.placePaper(placement(filledIntent, filledQuote, filledPreview));
  assert.equal(receipt.status, "filled");
  const reconciliation = await adapter.reconcile({ ...receipt, request_id: "forged-request" });
  assert.deepEqual({ ok: reconciliation.ok, reason: reconciliation.reason }, { ok: false, reason: "paper_receipt_integrity_mismatch" });
});

test("paper preview aggregates capital and gas when both debit the same asset", async () => {
  const requestIntent = intent({
    intent_id: "same-asset-intent",
    idempotency_key: "same-asset-preview-once",
    amount: { kind: "notional", value: "100", asset_id: SOLANA_SOL },
    settlement_asset: { asset_id: SOLANA_SOL },
  });
  const adapter = createPaperVenueAdapter({
    capability: capability(),
    quote_source: async () => rawQuote({
      capital_asset_id: SOLANA_SOL,
      capital_reservation_amount_atomic: "95000000",
      gas_asset_id: SOLANA_SOL,
      gas_required_atomic: "10000000",
    }),
    account_source: async () => ({ balances: [{ chain_id: SOLANA, venue_id: JUPITER, asset_id: SOLANA_SOL, available_atomic: "100000000", state: "available" }], positions: [] }),
    clock: () => NOW,
  });
  const quote = await adapter.quote(requestIntent);
  const preview = await adapter.preview({ intent: requestIntent, quote });
  assert.equal(preview.state, "blocked");
  assert.ok(preview.errors.includes("paper_combined_capital_and_gas_insufficient"));
});

test("unavailable depth never falls back to a last-traded price", async () => {
  const requestIntent = intent();
  const unavailable = normalizeExecutablePaperQuote({
    quote_id: "missing-depth",
    state: "unavailable",
    provider: "fixture",
    provider_health: "healthy",
    unavailable_reason: "executable_depth_unavailable",
  }, requestIntent);
  assert.equal(unavailable.state, "unavailable");
  assert.equal(unavailable.last_trade_price_used, false);
  const adapter = createPaperVenueAdapter({ capability: capability(), quote_source: async () => ({ ...rawQuote(), state: "unavailable", unavailable_reason: "executable_depth_unavailable" }), account_source: async () => account(), clock: () => NOW });
  const quote = await adapter.quote(requestIntent);
  const preview = await adapter.preview({ intent: requestIntent, quote });
  assert.equal(preview.state, "blocked");
  assert.ok(preview.errors.includes("executable_quote_required"));
  assert.throws(() => normalizeExecutablePaperQuote({ ...rawQuote(), last_trade_price_used: true }, requestIntent), /paper_quote_last_trade_price_forbidden/);
});

test("paper quotes refuse unresolved fee and friction components", () => {
  const requestIntent = intent();
  assert.throws(
    () => normalizeExecutablePaperQuote({ ...rawQuote(), raven_fee_usdc_micros: undefined }, requestIntent),
    /paper_quote_raven_fee_usdc_micros_unresolved/,
  );
});

test("paper placement requires the complete quoted capital debit, including costs", async () => {
  const requestIntent = intent();
  const adapter = createPaperVenueAdapter({ capability: capability(), quote_source: async () => rawQuote(), account_source: async () => account(), clock: () => NOW });
  const quote = await adapter.quote(requestIntent);
  const preview = await adapter.preview({ intent: requestIntent, quote });
  const receipt = await adapter.placePaper(placement(requestIntent, quote, preview, reservation(requestIntent, "100000000")));
  assert.equal(receipt.status, "rejected");
  assert.ok(receipt.rejection_reasons.includes("paper_reservation_amount_insufficient"));
});

test("IOC partial fills prorate variable fees while keeping network and gas costs explicit", async () => {
  const requestIntent = intent();
  const adapter = createPaperVenueAdapter({
    capability: capability(),
    quote_source: async () => rawQuote({ executable_notional_usdc_micros: "40000000", executable_quantity_atomic: "200000000" }),
    account_source: async () => account(),
    clock: () => NOW,
  });
  const quote = await adapter.quote(requestIntent);
  const preview = await adapter.preview({ intent: requestIntent, quote });
  const receipt = await adapter.placePaper(placement(requestIntent, quote, preview));
  assert.equal(receipt.status, "partially_filled");
  assert.equal(receipt.fill_ratio_bps, 4000);
  assert.equal(receipt.fees.venue_fee_usdc_micros, "4000");
  assert.equal(receipt.fees.raven_fee_usdc_micros, "40000");
  assert.equal(receipt.fees.network_fee_usdc_micros, "5000");
  assert.equal(receipt.gas_consumed_atomic, "5000");
});

test("FOK rejects partial depth and the rejection is not a zero-return fill", async () => {
  const requestIntent = intent({ order_constraints: { time_in_force: "fok" } });
  const adapter = createPaperVenueAdapter({
    capability: capability(),
    quote_source: async () => rawQuote({ executable_notional_usdc_micros: "40000000", executable_quantity_atomic: "200000000" }),
    account_source: async () => account(),
    clock: () => NOW,
  });
  const quote = await adapter.quote(requestIntent);
  const preview = await adapter.preview({ intent: requestIntent, quote });
  const receipt = await adapter.placePaper(placement(requestIntent, quote, preview));
  assert.equal(receipt.status, "rejected");
  assert.ok(receipt.rejection_reasons.includes("paper_partial_fill_not_allowed"));
  assert.equal(receipt.filled_at, null);
  assert.equal(receipt.filled_notional_usdc_micros, "0");
});

test("latency that crosses quote expiry rejects instead of filling stale", async () => {
  const requestIntent = intent();
  const adapter = createPaperVenueAdapter({
    capability: capability(),
    quote_source: async () => rawQuote({ expires_at: "2026-09-01T18:00:01.000Z" }),
    account_source: async () => account(),
    clock: () => NOW,
    latency_ms: 2_000,
  });
  const quote = await adapter.quote(requestIntent);
  const preview = await adapter.preview({ intent: requestIntent, quote });
  assert.equal(preview.state, "ready");
  const receipt = await adapter.placePaper(placement(requestIntent, quote, preview));
  assert.equal(receipt.status, "rejected");
  assert.ok(receipt.rejection_reasons.includes("paper_quote_expired_before_fill"));
});

test("insufficient or unresolved native gas blocks preview", async () => {
  const requestIntent = intent();
  const adapter = createPaperVenueAdapter({
    capability: capability(),
    quote_source: async () => rawQuote(),
    account_source: async () => account({ balances: [{ chain_id: SOLANA, venue_id: JUPITER, asset_id: SOLANA_USDC, available_atomic: "500000000", state: "available" }] }),
    clock: () => NOW,
  });
  const quote = await adapter.quote(requestIntent);
  const preview = await adapter.preview({ intent: requestIntent, quote });
  assert.equal(preview.state, "blocked");
  assert.ok(preview.errors.includes("paper_native_gas_balance_unresolved"));
});

test("one idempotency key cannot be reused with changed quote economics", async () => {
  const requestIntent = intent();
  const adapter = createPaperVenueAdapter({ capability: capability(), quote_source: async () => rawQuote(), account_source: async () => account(), clock: () => NOW });
  const quote = await adapter.quote(requestIntent);
  const preview = await adapter.preview({ intent: requestIntent, quote });
  await adapter.placePaper(placement(requestIntent, quote, preview));
  const changedQuote = normalizeExecutablePaperQuote(rawQuote({ quote_id: "changed-quote", average_price: "0.21" }), requestIntent);
  const changedPreview = await adapter.preview({ intent: requestIntent, quote: changedQuote });
  await assert.rejects(
    adapter.placePaper(placement(requestIntent, changedQuote, changedPreview)),
    /paper_idempotency_conflict/,
  );
});
