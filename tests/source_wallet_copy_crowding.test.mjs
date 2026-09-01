import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import bs58 from "bs58";

import {
  SOLANA_CANONICAL_USDC_MINT,
  normalizeSolanaWalletTransaction,
} from "../lib/customer_trade/solana_wallet_intelligence.mjs";
import { createRavenCopyPolicy } from "../lib/customer_trade/wallet_copy.mjs";
import {
  SOURCE_WALLET_COPY_CROWDING_OBSERVATION_SCHEMA,
  SourceWalletCopyCrowdingLimits,
  buildSourceWalletCopyCrowdingPublicSummary,
  createD1SourceWalletCopyCrowdingStore,
  createSourceWalletCopyDemand,
  evaluateSourceWalletCopyCrowding,
  resolveSourceWalletCopyCrowdingActivation,
} from "../lib/customer_trade/source_wallet_copy_crowding.mjs";

const WALLET = bs58.encode(Buffer.alloc(32, 51));
const TOKEN = bs58.encode(Buffer.alloc(32, 53));
const NOW = Date.parse("2026-09-01T14:00:03.000Z");
const SOURCE_ID = `sw_sol_${createHash("sha256").update(["solana", "mainnet", WALLET].join("|")).digest("hex").slice(0, 40)}`;

function sourceBuy(index = 0) {
  const blockTime = Math.floor(NOW / 1_000) - 2 + index;
  const received = new Date((blockTime * 1_000) + 1_000).toISOString();
  const character = String.fromCharCode(65 + (index % 26));
  return normalizeSolanaWalletTransaction({
    wallet_address: WALLET,
    signature: character.repeat(88),
    finality: "confirmed",
    provider: "fixture_nexus_hydration",
    observation_mode: "prospective",
    received_at: received,
    decode_started_at: received,
    decoded_at: received,
    observed_at: received,
    transaction: {
      slot: 20_000 + index,
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

function fixedPolicy(amount = 100) {
  return createRavenCopyPolicy({ sizing: { kind: "FIXED_USDC", fixed_usdc: amount } });
}

function unsupportedPolicy() {
  return createRavenCopyPolicy({
    sizing: { kind: "PERCENT_OF_ALLOCATED_CAPITAL", fixed_usdc: 100, percent_of_allocated_capital: 10 },
  });
}

function quoteEvidence(size) {
  const quotedAt = new Date(NOW - 1_000).toISOString();
  const expiresAt = new Date(NOW + 15_000).toISOString();
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
      quote_id: `aggregate_entry_${size}`,
      provider: "jupiter",
      requested_at: quotedAt,
      quoted_at: quotedAt,
      received_at: quotedAt,
      expires_at: expiresAt,
      expected_output: size * 0.4,
      minimum_output: size * 0.396,
      expected_output_base_units: String(Math.trunc(size * 400_000)),
      minimum_output_base_units: String(Math.trunc(size * 396_000)),
      price_impact_bps: 25,
      latency_ms: 25,
      exact_asset_identity: true,
    },
    exit: {
      state: "available",
      quote_id: `aggregate_exit_${size}`,
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

function memoryStore(policies) {
  const demands = new Map();
  const observations = new Map();
  return {
    demands,
    observations,
    async loadPoliciesForSourceEvent() { return policies; },
    async recordDemand(demand) {
      if (demands.has(demand.demand_id)) return false;
      demands.set(demand.demand_id, demand);
      return true;
    },
    async recordObservation(observation) {
      if (observations.has(observation.observation_id)) return false;
      observations.set(observation.observation_id, observation);
      return true;
    },
    async observationForEvent(sourceId, eventId) {
      return [...observations.values()].find((row) => row.source_wallet_id === sourceId && row.source_event_id === eventId) || null;
    },
  };
}

test("aggregate copy demand remains independently default-off and shadow-only", () => {
  assert.equal(resolveSourceWalletCopyCrowdingActivation({ RAVENOS_WALLET_COPY_CROWDING_ENABLED: "1" }).evaluator, false);
  const active = resolveSourceWalletCopyCrowdingActivation({
    RAVENOS_WALLET_COPY_CROWDING_ENABLED: "1",
    RAVENOS_WALLET_OBSERVER_ENABLED: "1",
    RAVENOS_WALLET_OBSERVER_EVALUATOR_ENABLED: "1",
    RAVENOS_WALLET_INTELLIGENCE_ENABLED: "1",
    RAVENOS_SHADOW_COPY_ENABLED: "1",
    RAVENOS_WALLET_COPYABILITY_PROBES_ENABLED: "1",
  });
  assert.equal(active.evaluator, true);
  assert.equal(active.live_copy, false);
  assert.equal(active.signing, false);
  assert.equal(active.broadcasting, false);
  assert.equal(active.custody, false);
  assert.equal(active.fee_collection, false);
});

test("detection-time demand aggregates fixed policies without subscriber associations", () => {
  const event = sourceBuy();
  const demand = createSourceWalletCopyDemand({
    source_wallet_id: SOURCE_ID,
    source_event: event,
    policies: [25, 50, 100, 500, 1_000].map(fixedPolicy),
    captured_at: new Date(NOW).toISOString(),
  });
  assert.equal(demand.state, "fully_resolved");
  assert.equal(demand.active_policy_count_internal, 5);
  assert.equal(demand.aggregate_requested_usdc_internal, 1_675);
  assert.equal(demand.privacy.public_summary_eligible, true);
  assert.equal(demand.privacy.public_follower_count_disclosed, false);
  assert.equal(demand.privacy.public_aggregate_capital_disclosed, false);
  const serialized = JSON.stringify(demand);
  assert.doesNotMatch(serialized, /"user_id"\s*:/);
  assert.doesNotMatch(serialized, /"watch_id"\s*:/);
  assert.doesNotMatch(serialized, /"policy_json"\s*:/);
  assert.doesNotMatch(serialized, /"transaction_hash"\s*:\s*"/);
});

test("one source signal receives one exact aggregate entry-and-exit stress quote", async () => {
  const policies = [100, 100, 100, 100, 100].map(fixedPolicy);
  const store = memoryStore(policies);
  let quoteCalls = 0;
  const provider = {
    async quoteCopySignal({ policy, purpose }) {
      quoteCalls += 1;
      assert.equal(purpose, "aggregate_follower_demand_shadow");
      assert.equal(policy.sizing.fixed_usdc, 500);
      return quoteEvidence(policy.sizing.fixed_usdc);
    },
  };
  const first = await evaluateSourceWalletCopyCrowding({
    event: sourceBuy(),
    source_wallet_id: SOURCE_ID,
    store,
    provider,
    now: Math.floor(NOW / 1_000),
  });
  assert.equal(first.state, "AGGREGATE_ROUTE_AVAILABLE");
  assert.equal(first.observation_count, 1);
  assert.equal(first.quote_variant_count, 1);
  assert.equal(quoteCalls, 1);
  const record = [...store.observations.values()][0];
  assert.equal(record.schema_version, SOURCE_WALLET_COPY_CROWDING_OBSERVATION_SCHEMA);
  assert.equal(record.demand_evidence.privacy_threshold_met, true);
  assert.equal(record.route_evaluation.decision.aggregate_route_stress_only, true);
  assert.equal(record.route_evaluation.decision.shadow_position_created, false);
  assert.equal(record.execution_boundary.transaction_hash, null);
  const serialized = JSON.stringify(record);
  assert.doesNotMatch(serialized, /"watch_id"\s*:/);
  assert.doesNotMatch(serialized, /"user_id"\s*:/);
  const duplicate = await evaluateSourceWalletCopyCrowding({
    event: sourceBuy(),
    source_wallet_id: SOURCE_ID,
    store,
    provider,
    now: Math.floor(NOW / 1_000),
  });
  assert.equal(duplicate.duplicate_count, 1);
  assert.equal(duplicate.quote_variant_count, 0);
  assert.equal(quoteCalls, 1);
});

test("unsupported sizing and excessive aggregate demand fail closed without quotes", async () => {
  for (const [policies, expectedState] of [
    [[fixedPolicy(100), unsupportedPolicy()], "POLICY_MIX_UNRESOLVED"],
    [[fixedPolicy(100_000), fixedPolicy(1)], "ABOVE_QUOTE_LIMIT"],
  ]) {
    let quoteCalls = 0;
    const store = memoryStore(policies);
    const result = await evaluateSourceWalletCopyCrowding({
      event: sourceBuy(expectedState === "POLICY_MIX_UNRESOLVED" ? 1 : 2),
      source_wallet_id: SOURCE_ID,
      store,
      provider: { async quoteCopySignal() { quoteCalls += 1; return quoteEvidence(100); } },
      now: Math.floor(NOW / 1_000),
    });
    assert.equal(result.state, expectedState);
    assert.equal(result.quote_variant_count, 0);
    assert.equal(quoteCalls, 0);
  }
});

test("provider failure remains an unavailable observation rather than zero", async () => {
  const store = memoryStore([25, 25, 25, 25, 25].map(fixedPolicy));
  const result = await evaluateSourceWalletCopyCrowding({
    event: sourceBuy(3),
    source_wallet_id: SOURCE_ID,
    store,
    provider: { async quoteCopySignal() { throw Object.assign(new Error("jupiter_timeout"), { code: "jupiter_timeout" }); } },
    now: Math.floor(NOW / 1_000),
  });
  assert.equal(result.state, "AGGREGATE_ROUTE_UNAVAILABLE");
  const record = [...store.observations.values()][0];
  assert.equal(record.reason_code, "jupiter_timeout");
  assert.equal(record.route_evaluation.decision.refusal_is_zero_return, false);
});

test("malformed provider evidence remains an explicit indeterminate observation", async () => {
  const store = memoryStore([25, 25, 25, 25, 25].map(fixedPolicy));
  const result = await evaluateSourceWalletCopyCrowding({
    event: sourceBuy(4),
    source_wallet_id: SOURCE_ID,
    store,
    provider: { async quoteCopySignal() { return { entry: { state: "available", expected_output: -1 } }; } },
    now: Math.floor(NOW / 1_000),
  });
  assert.equal(result.state, "INDETERMINATE");
  assert.equal(result.observation_count, 1);
  const record = [...store.observations.values()][0];
  assert.equal(record.route_evaluation, null);
  assert.notEqual(record.reason_code, "aggregate_entry_and_exit_policy_passed");
});

test("public crowding summary withholds small cohorts and never exposes demand", () => {
  const below = {
    schema_version: SOURCE_WALLET_COPY_CROWDING_OBSERVATION_SCHEMA,
    state: "AGGREGATE_ROUTE_AVAILABLE",
    reason_code: "aggregate_entry_and_exit_policy_passed",
    observed_at: new Date(NOW).toISOString(),
    demand_evidence: { privacy_threshold_met: false },
  };
  const withheld = buildSourceWalletCopyCrowdingPublicSummary([below]);
  assert.equal(withheld.state, "withheld_for_privacy");
  assert.equal(withheld.eligible_signal_sample_count, 0);
  const qualified = Array.from({ length: 20 }, (_, index) => ({
    ...below,
    state: index < 14 ? "AGGREGATE_ROUTE_AVAILABLE" : index < 18 ? "AGGREGATE_ROUTE_CONSTRAINED" : "AGGREGATE_ROUTE_UNAVAILABLE",
    reason_code: index < 14 ? "aggregate_entry_and_exit_policy_passed" : "round_trip_friction_exceeds_policy",
    observed_at: new Date(NOW + (index * 1_000)).toISOString(),
    demand_evidence: { privacy_threshold_met: true },
  }));
  const summary = buildSourceWalletCopyCrowdingPublicSummary(qualified);
  assert.equal(summary.state, "available");
  assert.equal(summary.eligible_signal_sample_count, 20);
  assert.equal(summary.aggregate_route_available_pct, 70);
  assert.equal(summary.aggregate_route_constrained_pct, 20);
  assert.equal(summary.aggregate_route_unavailable_pct, 10);
  assert.equal(summary.current_follower_count_disclosed, false);
  assert.equal(summary.aggregate_follower_capital_disclosed, false);
  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /active_policy_count|aggregate_requested_usdc|supported_policy_count/);
});

test("D1 crowding policy load selects only policy evidence", async () => {
  const statements = [];
  const db = {
    prepare(sql) {
      const statement = {
        sql,
        bind(...bindings) { statement.bindings = bindings; return statement; },
        async all() { statements.push(statement); return { results: [{ policy_json: JSON.stringify(fixedPolicy(100)) }] }; },
      };
      return statement;
    },
  };
  const result = await createD1SourceWalletCopyCrowdingStore(db).loadPoliciesForSourceEvent(SOURCE_ID, sourceBuy(), 10);
  assert.equal(result.length, 1);
  assert.match(statements[0].sql, /SELECT w\.policy_json/i);
  assert.doesNotMatch(statements[0].sql, /SELECT[^]*w\.account_id/i);
  assert.doesNotMatch(statements[0].sql, /SELECT[^]*w\.watch_id\s*(?:,|FROM)/i);
});

test("crowding migration is append-only, bounded, and has no execution authority", () => {
  const sql = readFileSync(new URL("../customer-migrations/0022_source_wallet_copy_crowding.sql", import.meta.url), "utf8");
  assert.match(sql, /ravenos_source_wallet_copy_demand_snapshots/);
  assert.match(sql, /ravenos_source_wallet_copy_crowding_observations/);
  assert.match(sql, /source_wallet_copy_demand_append_only/);
  assert.match(sql, /source_wallet_copy_crowding_observation_append_only/);
  assert.match(sql, /'\$\.execution_boundary\.signing'\) = 0/);
  assert.match(sql, /'\$\.execution_boundary\.broadcasting'\) = 0/);
  assert.match(sql, /'\$\.execution_boundary\.transaction_hash'\) IS NULL/);
  assert.doesNotMatch(sql, /private_key|seed_phrase|signer_key/i);
  assert.equal(SourceWalletCopyCrowdingLimits.maximum_aggregate_quote_usdc, 100_000);
});
