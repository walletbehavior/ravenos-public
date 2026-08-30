import assert from "node:assert/strict";
import test from "node:test";

import bs58 from "bs58";

import {
  SOLANA_CANONICAL_USDC_MINT,
  normalizeSolanaWalletTransaction,
} from "../lib/customer_trade/solana_wallet_intelligence.mjs";
import {
  RavenCopyFeeScenariosBps,
  buildCopyabilitySnapshot,
  createRavenCopyDecision,
  createRavenCopyPolicy,
  createShadowCopyPosition,
} from "../lib/customer_trade/wallet_copy.mjs";

const WALLET = bs58.encode(Buffer.alloc(32, 17));
const TOKEN = bs58.encode(Buffer.alloc(32, 19));
const BLOCK_SECONDS = Math.floor(Date.parse("2026-08-29T12:00:00.000Z") / 1_000);
const RECEIVED = "2026-08-29T12:00:01.000Z";

function sourceBuy() {
  return normalizeSolanaWalletTransaction({
    wallet_address: WALLET,
    signature: "s".repeat(88),
    finality: "confirmed",
    provider: "fixture_rpc",
    observation_mode: "prospective",
    received_at: RECEIVED,
    decode_started_at: RECEIVED,
    decoded_at: "2026-08-29T12:00:01.050Z",
    observed_at: "2026-08-29T12:00:01.050Z",
    transaction: {
      slot: 123,
      blockTime: BLOCK_SECONDS,
      transaction: { message: { accountKeys: [{ pubkey: WALLET, signer: true }], instructions: [{ programId: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4" }] } },
      meta: {
        err: null,
        fee: 5_000,
        preBalances: [1_000_000_000],
        postBalances: [999_995_000],
        preTokenBalances: [
          { owner: WALLET, mint: SOLANA_CANONICAL_USDC_MINT, uiTokenAmount: { amount: "100000000", decimals: 6 } },
          { owner: WALLET, mint: TOKEN, uiTokenAmount: { amount: "0", decimals: 6 } },
        ],
        postTokenBalances: [
          { owner: WALLET, mint: SOLANA_CANONICAL_USDC_MINT, uiTokenAmount: { amount: "75000000", decimals: 6 } },
          { owner: WALLET, mint: TOKEN, uiTokenAmount: { amount: "10000000", decimals: 6 } },
        ],
        innerInstructions: [],
        logMessages: ["Program log: Instruction: Route"],
      },
    },
  });
}

function policy(overrides = {}) {
  return createRavenCopyPolicy({
    sizing: { fixed_usdc: 100 },
    execution_quality: {
      maximum_detection_delay_ms: 30_000,
      maximum_quote_age_ms: 15_000,
      maximum_entry_degradation_bps: 2_000,
      maximum_price_impact_bps: 500,
      maximum_round_trip_friction_pct: 10,
      minimum_executable_exit_usdc: 1,
      minimum_liquidity_usd: 25_000,
    },
    hypothetical_raven_fee_bps: 10,
    ...overrides,
  });
}

function evidence(overrides = {}) {
  return {
    watch_id: `wcw_${"a".repeat(40)}`,
    source_event: sourceBuy(),
    policy: policy(),
    source_notional_usdc: 25,
    source_notional_basis: "source_wallet_canonical_usdc_delta",
    liquidity_usd: 250_000,
    asset_evidence: {
      identity_resolved: true,
      token_standard: "spl",
      token_standard_resolved: true,
      sell_simulation_state: "passed",
      reverse_sell_quote_state: "available",
      freeze_authority_present: false,
      mint_authority_present: false,
      transfer_fee_detected: false,
    },
    entry: {
      state: "available",
      quote_id: "entry_1",
      provider: "jupiter",
      requested_at: "2026-08-29T12:00:01.100Z",
      quoted_at: "2026-08-29T12:00:01.200Z",
      received_at: "2026-08-29T12:00:01.250Z",
      expires_at: "2026-08-29T12:00:16.200Z",
      expected_output: 39.5,
      minimum_output: 39.1,
      price_impact_bps: 50,
      latency_ms: 150,
      venues: ["Jupiter"],
      exact_asset_identity: true,
    },
    exit: {
      state: "available",
      quote_id: "exit_1",
      provider: "jupiter",
      requested_at: "2026-08-29T12:00:01.250Z",
      quoted_at: "2026-08-29T12:00:01.350Z",
      received_at: "2026-08-29T12:00:01.400Z",
      expires_at: "2026-08-29T12:00:16.350Z",
      expected_output: 97.5,
      minimum_output: 97,
      price_impact_bps: 55,
      latency_ms: 150,
      venues: ["Jupiter"],
      exact_asset_identity: true,
    },
    ...overrides,
  };
}

test("copy fee scenarios remain configurable, hypothetical, and bounded", () => {
  assert.deepEqual(RavenCopyFeeScenariosBps, [0, 5, 10, 20, 25, 50]);
  for (const bps of RavenCopyFeeScenariosBps) {
    const value = createRavenCopyPolicy({ hypothetical_raven_fee_bps: bps });
    assert.equal(value.hypothetical_raven_fee_bps, bps);
    assert.equal(value.execution_boundary.fee_collection_available, false);
  }
  assert.throws(() => createRavenCopyPolicy({ hypothetical_raven_fee_bps: 11 }), /copy_fee_scenario_not_allowlisted/);
});

test("a fresh exact entry plus reverse exit produces an appendable shadow decision only", () => {
  const decision = createRavenCopyDecision(evidence(), { now: Date.parse("2026-08-29T12:00:01.500Z") });
  assert.equal(decision.decision.state, "SHADOW_EXECUTABLE");
  assert.equal(decision.decision.shadow_position_created, true);
  assert.equal(decision.follower_reality.current_executable_exit_usdc, 97.5);
  assert.equal(decision.follower_reality.round_trip_friction_excluding_raven_pct, 2.5);
  assert.ok(decision.follower_reality.round_trip_friction_including_raven_pct > 2.5);
  assert.equal(decision.hypothetical_raven_fee.hypothetical, true);
  assert.equal(decision.hypothetical_raven_fee.collected, false);
  assert.equal(decision.execution_boundary.transaction_hash, null);
  assert.equal(decision.execution_boundary.signing_available, false);
  assert.equal(decision.execution_boundary.broadcasting_available, false);
  const position = createShadowCopyPosition(decision);
  assert.equal(position.live_assets_held, false);
  assert.equal(position.transaction_hash, null);
  assert.equal(position.source_strategy_attribution_preserved, true);
});

test("entry without a reverse route is an explicit refusal, not a zero-return trade", () => {
  const decision = createRavenCopyDecision(evidence({
    exit: { state: "unavailable", provider: "jupiter", reason: "no_reverse_route", exact_asset_identity: true },
  }), { now: Date.parse("2026-08-29T12:00:01.500Z") });
  assert.equal(decision.decision.state, "EXIT_UNAVAILABLE");
  assert.equal(decision.decision.reason_code, "no_reverse_route");
  assert.equal(decision.decision.refusal_is_zero_return, false);
  assert.equal(decision.follower_reality.current_executable_exit_usdc, null);
  assert.throws(() => createShadowCopyPosition(decision), /executable_shadow_decision_required/);
});

test("copy policy fails closed on delay, stale quotes, liquidity, friction, funding, simulation, and unresolved standards", () => {
  const now = Date.parse("2026-08-29T12:00:01.500Z");
  const delayedEvent = sourceBuy();
  delayedEvent.timing;
  const cases = [
    [evidence({ policy: policy({ execution_quality: { maximum_detection_delay_ms: 500 } }) }), "COPY_DELAY_TOO_HIGH"],
    [evidence({ entry: { ...evidence().entry, quoted_at: "2026-08-29T11:00:00.000Z", expires_at: "2026-08-29T11:00:15.000Z" } }), "ROUTE_STALE"],
    [evidence({ liquidity_usd: 10 }), "LIQUIDITY_TOO_LOW"],
    [evidence({ exit: { ...evidence().exit, expected_output: 70, minimum_output: 69 } }), "FRICTION_TOO_HIGH"],
    [evidence({ policy: policy({ funding_assumption: "CROSS_CHAIN_NOT_READY" }) }), "FUNDING_NOT_READY"],
    [evidence({ asset_evidence: { ...evidence().asset_evidence, sell_simulation_state: "failed" } }), "SIMULATION_FAILED"],
    [evidence({ asset_evidence: { ...evidence().asset_evidence, token_standard_resolved: false } }), "ASSET_RESTRICTED"],
  ];
  for (const [input, expected] of cases) assert.equal(createRavenCopyDecision(input, { now }).decision.state, expected);
});

test("source performance and follower reality remain separate even when follower economics are worse", () => {
  const decision = createRavenCopyDecision(evidence({
    source_notional_usdc: 25,
    exit: { ...evidence().exit, expected_output: 92, minimum_output: 91 },
  }), { now: Date.parse("2026-08-29T12:00:01.500Z") });
  assert.equal(decision.source_transaction.effective_notional_usdc, 25);
  assert.equal(decision.follower_reality.follower_order_usdc, 100);
  assert.equal(decision.follower_reality.source_performance_used_as_follower_performance, false);
  assert.equal(decision.decision.state, "SHADOW_EXECUTABLE");
});

test("copyability does not publish a score before sufficient prospective evidence", () => {
  const one = createRavenCopyDecision(evidence(), { now: Date.parse("2026-08-29T12:00:01.500Z") });
  const early = buildCopyabilitySnapshot([one], { generated_at: "2026-08-29T12:05:00.000Z", order_size_usdc: 100 });
  assert.equal(early.state, "insufficient_evidence");
  assert.equal(early.score, null);
  assert.equal(early.historical_estimates_included, false);
  const mature = buildCopyabilitySnapshot(Array.from({ length: 20 }, (_, index) => ({
    ...one,
    decision_id: `${one.decision_id}_${index}`,
  })), { generated_at: "2026-08-29T12:05:00.000Z", order_size_usdc: 100 });
  assert.equal(mature.state, "available");
  assert.ok(Number.isInteger(mature.score));
  assert.equal(mature.unavailable_decisions_dropped, false);
});
