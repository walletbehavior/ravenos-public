import assert from "node:assert/strict";
import test from "node:test";

import {
  EXECUTION_DISABLED_GATE,
  comparePreparedPayload,
  createExecutionIntent,
  executionReadinessSummary,
  invalidateExecutionReview,
  recordSubmission,
  reviewExecutionIntent,
  transitionExecutionIntent,
  verifyIntentIntegrity,
} from "../lib/customer_trade/execution_readiness.mjs";

const NOW = Date.parse("2026-07-23T04:00:00Z");
const PAYLOAD_HASH = "a".repeat(64);

function fixture(overrides = {}) {
  return createExecutionIntent({
    intent_id: "int_owner_fixture",
    intent_version: 1,
    actor_id: "owner_fixture",
    account_id: "acct_hyperliquid_fixture",
    wallet_or_venue_account: "venue_account_fixture",
    chain_namespace: "hyperliquid",
    network_reference: "hyperliquid:mainnet",
    venue: "hyperliquid",
    canonical_instrument_id: "hyperliquid:perp:SOL",
    exact_market_id: "SOL",
    side: "long",
    input_asset: "USDC",
    input_amount_base_units: "500000000",
    expected_output_asset: "SOL-PERP",
    expected_output_amount_base_units: "1000000",
    minimum_output_amount_base_units: "990000",
    source_custody_domain: "hyperliquid:account:fixture",
    destination_custody_domain: "hyperliquid:account:fixture",
    leverage: 3,
    slippage_bps: 20,
    route_id: "hl:SOL:market",
    route_hops: [{ venue: "hyperliquid", market_id: "SOL", input_asset: "USDC", output_asset: "SOL-PERP", input_amount_base_units: "500000000", expected_output_base_units: "1000000" }],
    program_or_contract_allowlist: ["hyperliquid:order_api"],
    fee_items: [{ kind: "venue_fee", asset: "USDC", amount_base_units: "250000" }],
    gas_or_network_fee_bound: { asset: "USDC", amount_base_units: "0" },
    quote_id: "quote_fixture",
    quote_observed_at: "2026-07-23T04:00:00Z",
    expires_at: "2026-07-23T04:01:00Z",
    expected_result: { position_delta: "long", notional_usdc: "500" },
    destination: { venue_account: "venue_account_fixture" },
    prepared_payload_hash: PAYLOAD_HASH,
    policy_suggestions: { source: "research_only", preferred_leverage: 2 },
    created_at: "2026-07-23T04:00:00Z",
    ...overrides,
  }, { now: NOW });
}

const stageEGate = {
  owner_only: true,
  public_available: false,
  signing_enabled: true,
  submission_enabled: true,
  kill_switch_clear: true,
  reconciliation_enabled: true,
};

function review(intent = fixture()) {
  const result = reviewExecutionIntent(intent, {
    reviewedAt: "2026-07-23T04:00:10Z",
    recentReauthenticationAt: "2026-07-23T04:00:05Z",
    now: NOW + 10_000,
  });
  assert.equal(result.ok, true);
  return result.intent;
}

function comparison(intent = review()) {
  const result = comparePreparedPayload(intent, {
    payloadHash: PAYLOAD_HASH,
    decodedSemanticsHash: "b".repeat(64),
    simulationState: "passed",
    now: NOW + 15_000,
  });
  assert.equal(result.ok, true);
  return result;
}

test("exact owner intent is immutable and policy suggestions never authorize execution", () => {
  const intent = fixture();
  assert.equal(intent.state, "quoted");
  assert.equal(intent.policy_is_authorization, false);
  assert.equal(verifyIntentIntegrity(intent).ok, true);
  const changedPolicy = { ...intent, policy_suggestions: { source: "research_only", preferred_leverage: 9 } };
  assert.equal(verifyIntentIntegrity(changedPolicy).ok, true);
  const changedMarket = { ...intent, exact_market_id: "BTC" };
  assert.deepEqual(verifyIntentIntegrity(changedMarket).errors, ["review_binding_changed"]);
});

test("expired quote cannot become reviewed", () => {
  const result = reviewExecutionIntent(fixture({ expires_at: "2026-07-23T03:59:59Z" }), { now: NOW });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("quote_expired"));
});

test("wrong payload, missing decode, and failed simulation refuse wallet handoff", () => {
  const intent = review();
  assert.ok(comparePreparedPayload(intent, { payloadHash: "c".repeat(64), decodedSemanticsHash: "d".repeat(64), simulationState: "passed", now: NOW + 15_000 }).errors.includes("prepared_payload_mismatch"));
  assert.ok(comparePreparedPayload(intent, { payloadHash: PAYLOAD_HASH, simulationState: "passed", now: NOW + 15_000 }).errors.includes("decoded_semantics_required"));
  assert.ok(comparePreparedPayload(intent, { payloadHash: PAYLOAD_HASH, decodedSemanticsHash: "d".repeat(64), simulationState: "failed", now: NOW + 15_000 }).errors.includes("simulation_not_accepted"));
});

test("current production boundary blocks signature and submission transitions", () => {
  const intent = review();
  const result = transitionExecutionIntent(intent, "awaiting_signature", { gate: EXECUTION_DISABLED_GATE, preparedComparison: comparison(intent), now: NOW + 20_000 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("execution_kill_switch_blocked"));
  assert.ok(result.errors.includes("signing_disabled"));
});

test("owner-only dry-run state machine is sequential and submission is not a fill", () => {
  let intent = review();
  const prepared = comparison(intent);
  let result = transitionExecutionIntent(intent, "awaiting_signature", { gate: stageEGate, preparedComparison: prepared, now: NOW + 20_000 });
  assert.equal(result.ok, true);
  intent = result.intent;
  result = transitionExecutionIntent(intent, "signed", { gate: stageEGate, preparedComparison: prepared, now: NOW + 25_000 });
  assert.equal(result.ok, true);
  intent = result.intent;
  result = recordSubmission(intent, { idempotencyKey: "owner-submit-1", providerSubmissionId: "venue-request-1", gate: stageEGate, preparedComparison: prepared, now: NOW + 30_000 });
  assert.equal(result.ok, true);
  assert.equal(result.intent.state, "submitted");
  assert.notEqual(result.intent.state, "filled");
});

test("one exact intent can produce at most one distinct submission", () => {
  let intent = review();
  const prepared = comparison(intent);
  intent = transitionExecutionIntent(intent, "awaiting_signature", { gate: stageEGate, preparedComparison: prepared, now: NOW + 20_000 }).intent;
  intent = transitionExecutionIntent(intent, "signed", { gate: stageEGate, preparedComparison: prepared, now: NOW + 25_000 }).intent;
  const first = recordSubmission(intent, { idempotencyKey: "owner-submit-1", gate: stageEGate, preparedComparison: prepared, now: NOW + 30_000 });
  assert.equal(first.idempotent, false);
  const same = recordSubmission(first.intent, { idempotencyKey: "owner-submit-1", gate: stageEGate, preparedComparison: prepared, now: NOW + 31_000 });
  assert.equal(same.idempotent, true);
  const altered = recordSubmission(first.intent, { idempotencyKey: "owner-submit-2", gate: stageEGate, preparedComparison: prepared, now: NOW + 31_000 });
  assert.equal(altered.ok, false);
  assert.equal(altered.error, "duplicate_submission_mismatch");
});

test("material chain, wallet, amount, route, or instrument change creates a new review version", () => {
  const intent = review();
  for (const change of [
    { chain_namespace: "solana" },
    { wallet_or_venue_account: "different_account" },
    { input_amount_base_units: "600000000" },
    { route_id: "different_route" },
    { canonical_instrument_id: "hyperliquid:perp:BTC" },
  ]) {
    const result = invalidateExecutionReview(intent, change, { at: "2026-07-23T04:00:20Z" });
    assert.equal(result.material_change, true);
    assert.equal(result.intent.intent_version, 2);
    assert.notEqual(result.intent.canonical_intent_hash, intent.canonical_intent_hash);
    assert.equal(result.intent.reviewed_at, null);
  }
});

test("public readiness summary never advertises signing or submission", () => {
  const summary = executionReadinessSummary(review());
  assert.equal(summary.exact_identity_bound, true);
  assert.equal(summary.review_integrity, true);
  assert.equal(summary.public_execution_available, false);
  assert.equal(summary.signing_available, false);
  assert.equal(summary.submission_available, false);
});

