import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import bs58 from "bs58";

import { createD1CustomerWalletCopyStore } from "../lib/customer_wallet_copy.mjs";

import {
  SOLANA_CANONICAL_USDC_MINT,
  normalizeSolanaWalletTransaction,
} from "../lib/customer_trade/solana_wallet_intelligence.mjs";
import {
  RavenCopyStandardOrderSizesUsdc,
} from "../lib/customer_trade/wallet_copy.mjs";
import {
  SOURCE_WALLET_DETECTION_MARKET_CONTEXT_SCHEMA,
  SOURCE_WALLET_COPYABILITY_OBSERVATION_SCHEMA,
  buildSourceWalletCopyabilityMatrix,
  createSourceWalletCopyabilityObservation,
  createSourceWalletCopyabilityPolicy,
  createSourceWalletCopyabilityPolicyReference,
  evaluateSourceWalletCopyabilityMatrix,
  resolveSourceWalletCopyabilityActivation,
} from "../lib/customer_trade/source_wallet_copyability.mjs";

const WALLET = bs58.encode(Buffer.alloc(32, 41));
const TOKEN = bs58.encode(Buffer.alloc(32, 43));
const PAIR_A = bs58.encode(Buffer.alloc(32, 45));
const PAIR_B = bs58.encode(Buffer.alloc(32, 47));
const NOW = Date.parse("2026-09-01T12:00:03.000Z");
const SOURCE_ID = `sw_sol_${createHash("sha256").update(["solana", "mainnet", WALLET].join("|")).digest("hex").slice(0, 40)}`;

function sourceBuy(index = 0) {
  const blockTime = Math.floor(NOW / 1_000) - 2;
  const received = new Date((blockTime * 1_000) + 1_000).toISOString();
  const signatureCharacter = String.fromCharCode(65 + (index % 26));
  return normalizeSolanaWalletTransaction({
    wallet_address: WALLET,
    signature: signatureCharacter.repeat(88),
    finality: "confirmed",
    provider: "fixture_nexus_hydration",
    observation_mode: "prospective",
    received_at: received,
    decode_started_at: received,
    decoded_at: received,
    observed_at: received,
    transaction: {
      slot: 10_000 + index,
      blockTime,
      transaction: {
        message: {
          accountKeys: [{ pubkey: WALLET, signer: true }],
          instructions: [{ programId: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4" }],
        },
      },
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

function quoteEvidence(size, suffix = "fixture") {
  const quotedAt = new Date(NOW - 1_000).toISOString();
  const expiresAt = new Date(NOW + 15_000).toISOString();
  const tokenAmount = size * 0.4;
  return {
    source_notional_usdc: 25,
    source_notional_basis: "source_wallet_canonical_usdc_delta",
    liquidity_usd: 1_000_000,
    asset_evidence: {
      identity_resolved: true,
      token_standard: "spl",
      token_standard_resolved: true,
      sell_simulation_state: "not_requested",
      reverse_sell_quote_state: "available",
      freeze_authority_present: false,
      mint_authority_present: false,
      transfer_fee_detected: false,
    },
    entry: {
      state: "available",
      quote_id: `entry_${suffix}_${size}`,
      provider: "jupiter",
      requested_at: quotedAt,
      quoted_at: quotedAt,
      received_at: quotedAt,
      expires_at: expiresAt,
      expected_output: tokenAmount,
      minimum_output: tokenAmount * 0.99,
      expected_output_base_units: String(Math.trunc(tokenAmount * 1_000_000)),
      minimum_output_base_units: String(Math.trunc(tokenAmount * 990_000)),
      price_impact_bps: 25,
      latency_ms: 25,
      exact_asset_identity: true,
    },
    exit: {
      state: "available",
      quote_id: `exit_${suffix}_${size}`,
      provider: "jupiter",
      requested_at: quotedAt,
      quoted_at: quotedAt,
      received_at: quotedAt,
      expires_at: expiresAt,
      expected_output: size * 0.99,
      minimum_output: size * 0.98,
      expected_output_base_units: String(Math.trunc(size * 990_000)),
      minimum_output_base_units: String(Math.trunc(size * 980_000)),
      price_impact_bps: 25,
      latency_ms: 25,
      exact_asset_identity: true,
    },
  };
}

function memoryStore() {
  const observations = new Map();
  return {
    observations,
    async listSourceCopyabilityObservationsForEvent(sourceId, eventId) {
      return [...observations.values()].filter((row) => row.source_wallet_id === sourceId && row.source_event_id === eventId);
    },
    async recordSourceCopyabilityObservation(observation) {
      if (observations.has(observation.observation_id)) return false;
      observations.set(observation.observation_id, observation);
      return true;
    },
  };
}

test("shared copyability probes are separately gated behind the shadow observer", () => {
  assert.equal(resolveSourceWalletCopyabilityActivation({}).evaluator, false);
  assert.equal(resolveSourceWalletCopyabilityActivation({ RAVENOS_WALLET_COPYABILITY_PROBES_ENABLED: "1" }).evaluator, false);
  const active = resolveSourceWalletCopyabilityActivation({
    RAVENOS_WALLET_COPYABILITY_PROBES_ENABLED: "1",
    RAVENOS_WALLET_OBSERVER_ENABLED: "1",
    RAVENOS_WALLET_OBSERVER_EVALUATOR_ENABLED: "1",
    RAVENOS_WALLET_INTELLIGENCE_ENABLED: "1",
    RAVENOS_SHADOW_COPY_ENABLED: "1",
  });
  assert.equal(active.evaluator, true);
  assert.equal(active.live_copy, false);
  assert.equal(active.broadcasting, false);
});

test("one source trade produces one shared evidence row per standard follower size", async () => {
  const event = sourceBuy();
  const store = memoryStore();
  let quoteCalls = 0;
  const provider = {
    async quoteCopySignal({ policy }) {
      quoteCalls += 1;
      return quoteEvidence(policy.sizing.fixed_usdc);
    },
  };
  const first = await evaluateSourceWalletCopyabilityMatrix({
    event,
    source_wallet_id: SOURCE_ID,
    store,
    provider,
    now: Math.floor(NOW / 1_000),
  });
  assert.equal(first.complete, true);
  assert.equal(first.probe_count, 5);
  assert.equal(first.observation_count, 5);
  assert.equal(first.quote_variant_count, 5);
  assert.equal(first.projection_refreshed, false);
  assert.equal(quoteCalls, 5);
  assert.deepEqual([...store.observations.values()].map((row) => row.standard_order_size_usdc).sort((left, right) => left - right), RavenCopyStandardOrderSizesUsdc);
  for (const observation of store.observations.values()) {
    assert.equal(observation.schema_version, SOURCE_WALLET_COPYABILITY_OBSERVATION_SCHEMA);
    assert.equal(observation.evaluation.decision.state, "SHADOW_EXECUTABLE");
    assert.equal(observation.evaluation.decision.shadow_position_created, false);
    assert.equal(observation.evaluation.decision.would_create_shadow_position_under_policy, true);
    assert.equal(observation.execution_boundary.transaction_hash, null);
    const encoded = JSON.stringify(observation);
    assert.doesNotMatch(encoded, /"watch_id"\s*:/);
    assert.doesNotMatch(encoded, /"user_id"\s*:/);
  }
  const second = await evaluateSourceWalletCopyabilityMatrix({
    event,
    source_wallet_id: SOURCE_ID,
    store,
    provider,
    now: Math.floor(NOW / 1_000),
  });
  assert.equal(second.observation_count, 0);
  assert.equal(second.duplicate_count, 5);
  assert.equal(second.quote_variant_count, 0);
  assert.equal(quoteCalls, 5);
});

test("provider failures remain explicit prospective refusals across every size", async () => {
  const store = memoryStore();
  const result = await evaluateSourceWalletCopyabilityMatrix({
    event: sourceBuy(1),
    source_wallet_id: SOURCE_ID,
    store,
    provider: {
      async quoteCopySignal() {
        const error = new Error("jupiter_timeout");
        error.code = "jupiter_timeout";
        const partial = quoteEvidence(25);
        error.copyability_evidence = {
          source_notional_usdc: partial.source_notional_usdc,
          source_notional_basis: partial.source_notional_basis,
          liquidity_usd: partial.liquidity_usd,
          asset_evidence: partial.asset_evidence,
        };
        throw error;
      },
    },
    now: Math.floor((NOW + 1_000) / 1_000),
  });
  assert.equal(result.observation_count, 5);
  assert.deepEqual(new Set([...store.observations.values()].map((row) => row.evaluation.decision.state)), new Set(["PROVIDER_UNAVAILABLE"]));
  assert.ok([...store.observations.values()].every((row) => row.evaluation.decision.reason_code === "jupiter_timeout"));
  assert.ok([...store.observations.values()].every((row) => row.evaluation.decision.refusal_is_zero_return === false));
});

test("copyability scores form independently at each follower order size", () => {
  const observations = [];
  for (let signal = 0; signal < 20; signal += 1) {
    const event = sourceBuy(signal);
    for (const size of RavenCopyStandardOrderSizesUsdc) {
      const policy = createSourceWalletCopyabilityPolicy(size, { fee_bps: 10 });
      observations.push(createSourceWalletCopyabilityObservation({
        source_wallet_id: SOURCE_ID,
        source_event: event,
        policy,
        ...quoteEvidence(size, String(signal)),
      }, { now: NOW }));
    }
  }
  const matrix = buildSourceWalletCopyabilityMatrix(observations, { generated_at: "2026-09-01T13:00:00.000Z" });
  assert.equal(matrix.state, "available");
  assert.equal(matrix.prospective_signal_count, 20);
  assert.equal(matrix.probe_observation_count, 100);
  assert.equal(matrix.snapshot.order_size_usdc, 100);
  assert.equal(matrix.snapshot.state, "available");
  assert.equal(matrix.by_size.length, 5);
  assert.ok(matrix.by_size.every((row) => row.prospective_sample_count === 20));
  assert.ok(matrix.by_size.every((row) => Number.isInteger(row.score)));
  assert.equal(matrix.copy_diagnosis.state, "available");
  assert.equal(matrix.copy_diagnosis.largest_tested_size_with_majority_policy_pass_usdc, 5_000);
  assert.equal(matrix.copy_diagnosis.reference_dominant_refusal, null);
  assert.equal(matrix.copy_diagnosis.liquidity_capacity_claimed, false);
  assert.equal(matrix.size_stress.state, "resilient_through_largest_tested");
  assert.equal(matrix.size_stress.full_ladder_signal_count, 20);
  assert.equal(matrix.size_stress.full_ladder_coverage_pct, 100);
  assert.equal(matrix.size_stress.largest_contiguous_size_with_majority_policy_pass_usdc, 5_000);
  assert.equal(matrix.size_stress.concurrent_follower_demand_measured, false);
  assert.equal(matrix.size_stress.liquidity_capacity_claimed, false);
  assert.ok(matrix.size_stress.by_size.every((row) => row.median_entry_price_impact_bps === 25));
  assert.equal(matrix.historical_estimates_included, false);
  assert.equal(matrix.source_performance_used_as_follower_performance, false);
  assert.equal(matrix.unavailable_decisions_dropped, false);
});

test("route-size stress identifies where exact follower quotes stop passing policy", () => {
  const observations = [];
  for (let signal = 0; signal < 20; signal += 1) {
    const event = sourceBuy(signal);
    for (const size of RavenCopyStandardOrderSizesUsdc) {
      const evidence = quoteEvidence(size, `stress_${signal}`);
      if (size >= 1_000) evidence.entry = { ...evidence.entry, price_impact_bps: 600 };
      observations.push(createSourceWalletCopyabilityObservation({
        source_wallet_id: SOURCE_ID,
        source_event: event,
        policy: createSourceWalletCopyabilityPolicy(size, { fee_bps: 10 }),
        ...evidence,
      }, { now: NOW }));
    }
  }
  const matrix = buildSourceWalletCopyabilityMatrix(observations, { generated_at: "2026-09-01T13:00:00.000Z" });
  assert.equal(matrix.size_stress.state, "size_sensitive");
  assert.equal(matrix.size_stress.largest_contiguous_size_with_majority_policy_pass_usdc, 500);
  assert.equal(matrix.size_stress.first_qualified_size_below_majority_policy_pass_usdc, 1_000);
  assert.equal(matrix.size_stress.by_size.find((row) => row.order_size_usdc === 1_000).median_entry_price_impact_bps, 600);
  assert.equal(matrix.size_stress.batched_execution_assumed, false);
  assert.equal(matrix.size_stress.isolated_quotes_presented_as_concurrent_fills, false);
});

test("detection-time market context is counted once per source signal, not once per follower size", () => {
  const observations = [];
  const contexts = [
    {
      pair_address: PAIR_A,
      liquidity_usd: 2_500,
      market_cap_usd: 100_000,
      fully_diluted_value_usd: 120_000,
      pair_age_seconds: 60,
    },
    {
      pair_address: PAIR_B,
      liquidity_usd: 7_500,
      market_cap_usd: 300_000,
      fully_diluted_value_usd: 350_000,
      pair_age_seconds: 180,
    },
  ];
  for (let signal = 0; signal < contexts.length; signal += 1) {
    const sourceEvent = sourceBuy(signal);
    for (const size of RavenCopyStandardOrderSizesUsdc) {
      observations.push(createSourceWalletCopyabilityObservation({
        source_wallet_id: SOURCE_ID,
        source_event: sourceEvent,
        policy: createSourceWalletCopyabilityPolicy(size, { fee_bps: 10 }),
        ...quoteEvidence(size, `market_${signal}`),
        market_context: {
          token_mint: TOKEN,
          observed_at: new Date(NOW).toISOString(),
          provider: "dexscreener",
          venue: "raydium",
          source_trade_notional_usdc: 25,
          ...contexts[signal],
        },
      }, { now: NOW }));
    }
  }
  const matrix = buildSourceWalletCopyabilityMatrix(observations, { generated_at: "2026-09-01T13:00:00.000Z" });
  const context = matrix.detection_market_context;
  assert.equal(matrix.prospective_signal_count, 2);
  assert.equal(matrix.probe_observation_count, 10);
  assert.equal(context.context_observation_count, 2);
  assert.equal(context.context_coverage_pct, 100);
  assert.equal(context.market_cap_coverage_pct, 100);
  assert.equal(context.liquidity_coverage_pct, 100);
  assert.equal(context.pair_age_coverage_pct, 100);
  assert.equal(context.median_detected_market_cap_usd, 200_000);
  assert.equal(context.median_detected_liquidity_usd, 5_000);
  assert.equal(context.median_detected_pair_age_seconds, 120);
  assert.equal(context.median_source_trade_liquidity_pct, 0.666667);
  assert.equal(context.exact_source_pool_claimed, false);
  assert.equal(context.historical_entry_context_claimed, false);
  assert.equal(context.pair_age_used_as_token_age, false);
  assert.equal(context.current_market_context_substituted_for_source_fill, false);
  assert.ok(observations.every((row) => row.market_context.schema_version === SOURCE_WALLET_DETECTION_MARKET_CONTEXT_SCHEMA));
  const regimes = matrix.market_regimes;
  assert.equal(regimes.state, "forming");
  assert.equal(regimes.reference_signal_count, 2);
  assert.equal(regimes.exact_source_pool_claimed, false);
  assert.equal(regimes.token_age_claimed, false);
  const cap = regimes.dimensions.find((row) => row.dimension === "market_cap_usd");
  assert.equal(cap.context_coverage_pct, 100);
  assert.equal(cap.buckets.find((row) => row.bucket_id === "under_200k").prospective_sample_count, 1);
  assert.equal(cap.buckets.find((row) => row.bucket_id === "200k_750k").prospective_sample_count, 1);
  const liquidity = regimes.dimensions.find((row) => row.dimension === "liquidity_usd");
  assert.equal(liquidity.representative_bucket.bucket_id, "under_25k");
  const pairAge = regimes.dimensions.find((row) => row.dimension === "pair_age_seconds");
  assert.equal(pairAge.buckets.find((row) => row.bucket_id === "under_5m").prospective_sample_count, 2);
});

test("fee scenarios remain separate and never double-count one source signal", () => {
  const event = sourceBuy();
  const observations = [];
  for (const feeBps of [10, 20]) {
    for (const size of RavenCopyStandardOrderSizesUsdc) {
      observations.push(createSourceWalletCopyabilityObservation({
        source_wallet_id: SOURCE_ID,
        source_event: event,
        policy: createSourceWalletCopyabilityPolicy(size, { fee_bps: feeBps }),
        ...quoteEvidence(size, String(feeBps)),
      }, { now: NOW }));
    }
  }
  const matrix = buildSourceWalletCopyabilityMatrix(observations, { generated_at: "2026-09-01T13:00:00.000Z" });
  assert.equal(matrix.reference_hypothetical_raven_fee_bps, 10);
  assert.equal(matrix.prospective_signal_count, 1);
  assert.equal(matrix.probe_observation_count, 5);
  assert.equal(matrix.all_fee_scenario_probe_observation_count, 10);
  assert.deepEqual(matrix.hypothetical_raven_fee_scenarios_bps, [10, 20]);
  assert.equal(matrix.fee_scenarios.length, 2);
  assert.ok(matrix.fee_scenarios.every((scenario) => scenario.prospective_signal_count === 1));
  assert.ok(matrix.fee_scenarios.every((scenario) => scenario.probe_observation_count === 5));
});

test("current matrices never mix superseded research-policy observations into a score", () => {
  const event = sourceBuy();
  const current = createSourceWalletCopyabilityObservation({
    source_wallet_id: SOURCE_ID,
    source_event: event,
    policy: createSourceWalletCopyabilityPolicy(100, { fee_bps: 10 }),
    ...quoteEvidence(100, "current"),
  }, { now: NOW });
  const superseded = JSON.parse(JSON.stringify(current));
  superseded.observation_id = `swcp_${"f".repeat(40)}`;
  superseded.policy_hash = "e".repeat(40);
  superseded.matrix_policy_hash = "d".repeat(40);
  const matrix = buildSourceWalletCopyabilityMatrix([superseded, current], { generated_at: "2026-09-01T13:00:00.000Z" });
  assert.equal(matrix.prospective_signal_count, 1);
  assert.equal(matrix.probe_observation_count, 1);
  assert.equal(matrix.fee_scenarios[0].superseded_policy_observation_count, 1);
  assert.equal(matrix.snapshot.prospective_sample_count, 1);
});

test("the rebuildable screener projection stores only the current shared policy cohort", async () => {
  const event = sourceBuy();
  const observations = RavenCopyStandardOrderSizesUsdc.map((size) => createSourceWalletCopyabilityObservation({
    source_wallet_id: SOURCE_ID,
    source_event: event,
    policy: createSourceWalletCopyabilityPolicy(size, { fee_bps: 10 }),
    ...quoteEvidence(size, "projection"),
    market_context: {
      token_mint: TOKEN,
      observed_at: new Date(NOW).toISOString(),
      provider: "dexscreener",
      pair_address: PAIR_A,
      venue: "raydium",
      liquidity_usd: 125_000,
      market_cap_usd: 750_000,
      pair_age_seconds: 3_600,
      source_trade_notional_usdc: 25,
    },
  }, { now: NOW }));
  const writes = [];
  const db = {
    prepare(sql) {
      return {
        bind(...bindings) {
          return {
            async all() {
              if (/FROM ravenos_source_wallet_copyability_checkpoints/i.test(sql)) return { results: [] };
              if (/FROM ravenos_source_wallet_copy_crowding_observations/i.test(sql)) return { results: [] };
              assert.match(sql, /FROM ravenos_source_wallet_copyability_observations/i);
              return { results: observations.map((observation) => ({ observation_json: JSON.stringify(observation) })) };
            },
            async run() {
              assert.equal((sql.match(/\?/g) || []).length, bindings.length);
              writes.push({ sql, bindings });
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
  const reference = createSourceWalletCopyabilityPolicyReference({ fee_bps: 10 });
  const matrix = await createD1CustomerWalletCopyStore(db).refreshSourceCopyabilityProjection(SOURCE_ID, {
    fee_bps: 10,
    policy_reference: reference,
    now: Math.floor(NOW / 1_000),
  });
  assert.equal(matrix.reference_matrix_policy_hash, reference.matrix_policy_hash);
  assert.equal(matrix.prospective_signal_count, 1);
  assert.equal(writes.length, 1);
  assert.match(writes[0].sql, /INSERT INTO ravenos_source_wallet_copyability_current/i);
  assert.match(writes[0].sql, /median_detected_liquidity_usd/i);
  const serialized = writes[0].bindings.find((value) => typeof value === "string" && value.includes('"schema_version":"ravenos.source_wallet_copyability_matrix.v1"'));
  assert.ok(serialized);
  assert.equal(JSON.parse(serialized).detection_market_context.context_observation_count, 1);
  assert.equal(JSON.parse(serialized).prospective_outcomes.checkpoint_count, 0);
  assert.ok(Buffer.byteLength(serialized, "utf8") <= 65_536);
  assert.equal(serialized.includes("user_id"), false);
  assert.equal(serialized.includes("watch_id"), false);
});

test("copyability migration is append-only, subscriber-free, and has no live authority", () => {
  const sql = readFileSync(new URL("../customer-migrations/0015_source_wallet_copyability.sql", import.meta.url), "utf8");
  const projectionSql = readFileSync(new URL("../customer-migrations/0017_source_wallet_copyability_projection.sql", import.meta.url), "utf8");
  const marketContextSql = readFileSync(new URL("../customer-migrations/0018_source_wallet_detection_market_context.sql", import.meta.url), "utf8");
  assert.match(sql, /ravenos_source_wallet_copyability_observations/);
  assert.match(sql, /source_wallet_copyability_observation_append_only/);
  assert.match(sql, /subscriber_identity_included/);
  assert.match(sql, /watch_identity_included/);
  assert.match(sql, /shadow_position_created/);
  assert.match(sql, /transaction_hash[^\n]+IS NULL/);
  assert.doesNotMatch(sql, /private_key|seed_phrase|signer_key/i);
  assert.match(projectionSql, /CREATE TABLE ravenos_source_wallet_copyability_current/i);
  assert.match(projectionSql, /source_performance_used_as_follower_performance/i);
  assert.match(projectionSql, /unavailable_decisions_dropped/i);
  assert.match(projectionSql, /reference_score/i);
  assert.doesNotMatch(projectionSql, /private_key|seed_phrase|signer_key|user_id/i);
  assert.match(marketContextSql, /median_detected_market_cap_usd/i);
  assert.match(marketContextSql, /median_detected_liquidity_usd/i);
  assert.match(marketContextSql, /source wallet's exact pool/i);
  assert.match(marketContextSql, /token's true age/i);
  assert.doesNotMatch(marketContextSql, /private_key|seed_phrase|signer_key|transaction_hash|user_id/i);
});
