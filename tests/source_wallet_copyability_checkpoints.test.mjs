import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import bs58 from "bs58";

import {
  SOLANA_CANONICAL_USDC_MINT,
  normalizeSolanaWalletTransaction,
} from "../lib/customer_trade/solana_wallet_intelligence.mjs";
import {
  RavenCopyStandardOrderSizesUsdc,
} from "../lib/customer_trade/wallet_copy.mjs";
import {
  createSourceWalletCopyabilityObservation,
  createSourceWalletCopyabilityPolicy,
} from "../lib/customer_trade/source_wallet_copyability.mjs";
import {
  SOURCE_WALLET_COPYABILITY_CHECKPOINT_SCHEMA,
  SOURCE_WALLET_COPYABILITY_OUTCOMES_SCHEMA,
  SOURCE_WALLET_OPPORTUNITY_CHECKPOINT_SCHEMA,
  buildSourceWalletCopyabilityOutcomeSummary,
  createD1SourceWalletCopyabilityCheckpointStore,
  createSourceWalletCopyabilityCheckpoint,
  createSourceWalletOpportunityCheckpoint,
  resolveSourceWalletCopyabilityCheckpointActivation,
  runSourceWalletCopyabilityCheckpointBatch,
} from "../lib/customer_trade/source_wallet_copyability_checkpoints.mjs";

const WALLET = bs58.encode(Buffer.alloc(32, 51));
const TOKEN = bs58.encode(Buffer.alloc(32, 53));
const NOW = Date.parse("2026-09-01T15:00:00.000Z");
const SOURCE_ID = `sw_sol_${createHash("sha256").update(["solana", "mainnet", WALLET].join("|")).digest("hex").slice(0, 40)}`;

function sourceBuy(index = 0) {
  const received = new Date(NOW).toISOString();
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
      slot: 20_000 + index,
      blockTime: Math.floor(NOW / 1_000) - 1,
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

function quoteEvidence(size) {
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
      quote_id: `entry_${size}`,
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
      quote_id: `exit_${size}`,
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

function observation(size = 100, index = 0) {
  return createSourceWalletCopyabilityObservation({
    source_wallet_id: SOURCE_ID,
    source_event: sourceBuy(index),
    policy: createSourceWalletCopyabilityPolicy(size, { fee_bps: 10 }),
    ...quoteEvidence(size),
  }, { now: NOW });
}

function route(current, minimum = current * 0.99) {
  return {
    route_available: true,
    state: "route_available",
    current_exit_usdc: current,
    minimum_exit_usdc: minimum,
    provider_id: "jupiter",
    provider_latency_ms: 31,
  };
}

test("follower outcome checkpoints require every existing shadow gate plus their own flag", () => {
  assert.equal(resolveSourceWalletCopyabilityCheckpointActivation({}).evaluator, false);
  assert.equal(resolveSourceWalletCopyabilityCheckpointActivation({
    RAVENOS_WALLET_COPYABILITY_CHECKPOINTS_ENABLED: "1",
  }).evaluator, false);
  const active = resolveSourceWalletCopyabilityCheckpointActivation({
    RAVENOS_WALLET_COPYABILITY_CHECKPOINTS_ENABLED: "1",
    RAVENOS_WALLET_COPYABILITY_PROBES_ENABLED: "1",
    RAVENOS_WALLET_OBSERVER_ENABLED: "1",
    RAVENOS_WALLET_OBSERVER_EVALUATOR_ENABLED: "1",
    RAVENOS_WALLET_INTELLIGENCE_ENABLED: "1",
    RAVENOS_SHADOW_COPY_ENABLED: "1",
  });
  assert.equal(active.evaluator, true);
  assert.equal(active.live_copy, false);
  assert.equal(active.fee_collection, false);
});

test("positive source opportunity and negative follower outcome produce an uncapped negative capture ratio", () => {
  const opening = observation(100);
  const sourceCheckpoint = createSourceWalletOpportunityCheckpoint({
    observation: opening,
    horizon_seconds: 3_600,
    result: route(50, 49),
    evaluated_at: new Date(NOW + 3_600_000).toISOString(),
  });
  const follower = createSourceWalletCopyabilityCheckpoint({
    observation: opening,
    source_checkpoint: sourceCheckpoint,
    horizon_seconds: 3_600,
    result: route(90, 89),
    evaluated_at: new Date(NOW + 3_600_000).toISOString(),
  });
  assert.equal(sourceCheckpoint.schema_version, SOURCE_WALLET_OPPORTUNITY_CHECKPOINT_SCHEMA);
  assert.equal(sourceCheckpoint.counterfactual_liquidation.gross_return_pct, 100);
  assert.equal(follower.schema_version, SOURCE_WALLET_COPYABILITY_CHECKPOINT_SCHEMA);
  assert.equal(follower.follower_outcome.entry_hypothetical_raven_fee_usdc, 0.1);
  assert.equal(follower.follower_outcome.exit_hypothetical_raven_fee_usdc, 0.09);
  assert.ok(follower.follower_outcome.return_including_raven_pct < -10);
  assert.ok(follower.source_comparison.follower_capture_ratio_pct < -10);
  assert.equal(follower.source_comparison.capture_ratio_capped, false);
  assert.equal(follower.source_comparison.actual_source_performance_substituted, false);
  assert.equal(follower.execution_boundary.transaction_hash, null);
});

test("non-positive source returns do not manufacture a follower capture ratio", () => {
  const opening = observation(100);
  const sourceCheckpoint = createSourceWalletOpportunityCheckpoint({
    observation: opening,
    horizon_seconds: 300,
    result: route(20, 19),
    evaluated_at: new Date(NOW + 300_000).toISOString(),
  });
  const follower = createSourceWalletCopyabilityCheckpoint({
    observation: opening,
    source_checkpoint: sourceCheckpoint,
    horizon_seconds: 300,
    result: route(110, 108),
    evaluated_at: new Date(NOW + 300_000).toISOString(),
  });
  assert.equal(sourceCheckpoint.counterfactual_liquidation.gross_return_pct, -20);
  assert.equal(follower.source_comparison.follower_capture_ratio_pct, null);
  assert.equal(follower.source_comparison.capture_unavailable_reason, "source_counterfactual_return_not_positive");
  assert.ok(follower.source_comparison.follower_minus_source_return_pct > 20);
});

test("unavailable exits remain unavailable rather than zero-return observations", () => {
  const opening = observation(100);
  const sourceCheckpoint = createSourceWalletOpportunityCheckpoint({
    observation: opening,
    horizon_seconds: 60,
    result: { route_available: false, state: "provider_unavailable", provider_id: "jupiter", reason_code: "timeout" },
    evaluated_at: new Date(NOW + 60_000).toISOString(),
  });
  const follower = createSourceWalletCopyabilityCheckpoint({
    observation: opening,
    source_checkpoint: sourceCheckpoint,
    horizon_seconds: 60,
    result: { route_available: false, state: "provider_unavailable", provider_id: "jupiter", reason_code: "timeout" },
    evaluated_at: new Date(NOW + 60_000).toISOString(),
  });
  assert.equal(sourceCheckpoint.counterfactual_liquidation.gross_exit_usdc, null);
  assert.equal(sourceCheckpoint.counterfactual_liquidation.gross_return_pct, null);
  assert.equal(follower.follower_outcome.net_exit_usdc, null);
  assert.equal(follower.follower_outcome.return_including_raven_pct, null);
  assert.equal(follower.source_comparison.follower_capture_ratio_pct, null);
});

test("outcome summary keeps route persistence, follower return, and source capture separate", () => {
  const opening = observation(100);
  const sourceCheckpoint = createSourceWalletOpportunityCheckpoint({
    observation: opening,
    horizon_seconds: 3_600,
    result: route(30, 29),
    evaluated_at: new Date(NOW + 3_600_000).toISOString(),
  });
  const available = createSourceWalletCopyabilityCheckpoint({
    observation: opening,
    source_checkpoint: sourceCheckpoint,
    horizon_seconds: 3_600,
    result: route(105, 103),
    evaluated_at: new Date(NOW + 3_600_000).toISOString(),
  });
  const unavailableOpening = observation(100, 1);
  const unavailableSource = createSourceWalletOpportunityCheckpoint({
    observation: unavailableOpening,
    horizon_seconds: 3_600,
    result: route(30, 29),
    evaluated_at: new Date(NOW + 3_600_000).toISOString(),
  });
  const unavailable = createSourceWalletCopyabilityCheckpoint({
    observation: unavailableOpening,
    source_checkpoint: unavailableSource,
    horizon_seconds: 3_600,
    result: { route_available: false, state: "provider_unavailable", provider_id: "jupiter", reason_code: "timeout" },
    evaluated_at: new Date(NOW + 3_600_000).toISOString(),
  });
  const summary = buildSourceWalletCopyabilityOutcomeSummary([available, unavailable]);
  assert.equal(summary.schema_version, SOURCE_WALLET_COPYABILITY_OUTCOMES_SCHEMA);
  assert.equal(summary.reference.checkpoint_count, 2);
  assert.equal(summary.reference.route_persistence_pct, 50);
  assert.equal(summary.reference.follower_return_sample_count, 1);
  assert.equal(summary.reference.unavailable_checkpoints_retained, 1);
  assert.equal(summary.unavailable_checkpoints_dropped, false);
});

test("the D1 queue admits only due unfinished horizons before applying its batch limit", async () => {
  let preparedSql = "";
  let bindings = [];
  const db = {
    withSession() {
      return this;
    },
    prepare(sql) {
      preparedSql = sql;
      return {
        bind(...values) {
          bindings = values;
          return {
            async all() {
              return { results: [] };
            },
          };
        },
      };
    },
  };
  const store = createD1SourceWalletCopyabilityCheckpointStore(db);
  await store.dueObservations(Math.floor(NOW / 1_000), 75);
  assert.match(preparedSql, /WITH checkpoint_horizons/);
  assert.match(preparedSql, /o\.observed_at \+ h\.horizon_seconds <= \?/);
  assert.match(preparedSql, /NOT EXISTS[\s\S]+completed\.observation_id = o\.observation_id/);
  assert.ok(preparedSql.indexOf("AND EXISTS") < preparedSql.indexOf("LIMIT ?"));
  assert.deepEqual(bindings, [Math.floor(NOW / 1_000), Math.floor(NOW / 1_000), 75]);
});

function memoryStore(openings) {
  const source = new Map();
  const follower = new Map();
  let leased = false;
  return {
    source,
    follower,
    async dueObservations() {
      return openings.map((row) => ({
        ...row,
        completed_horizons: [...follower.values()]
          .filter((checkpoint) => checkpoint.observation_id === row.observation_id)
          .map((checkpoint) => checkpoint.horizon_seconds),
      }));
    },
    async sourceCheckpoint(eventId, horizon) {
      return source.get(`${eventId}:${horizon}`) || null;
    },
    async insertSourceCheckpoint(checkpoint) {
      const key = `${checkpoint.source_event_id}:${checkpoint.horizon_seconds}`;
      if (source.has(key)) return false;
      source.set(key, checkpoint);
      return true;
    },
    async insertFollowerCheckpoint(checkpoint) {
      if (follower.has(checkpoint.checkpoint_id)) return false;
      follower.set(checkpoint.checkpoint_id, checkpoint);
      return true;
    },
    async acquireLease() {
      if (leased) return false;
      leased = true;
      return true;
    },
    async releaseLease() {
      leased = false;
    },
  };
}

test("one event-horizon source quote is shared across all five follower sizes and retries are idempotent", async () => {
  const openings = RavenCopyStandardOrderSizesUsdc.map((size) => observation(size));
  const store = memoryStore(openings);
  let sourceQuotes = 0;
  let followerQuotes = 0;
  const provider = {
    async quoteExit(input) {
      if (input.purpose === "source_counterfactual") sourceQuotes += 1;
      else followerQuotes += 1;
      return route(input.purpose === "source_counterfactual" ? 30 : Number(input.quantity_base_units) / 400_000);
    },
  };
  const first = await runSourceWalletCopyabilityCheckpointBatch(store, provider, {
    now: Math.floor(NOW / 1_000) + 30,
  });
  assert.equal(first.source_event_horizons, 1);
  assert.equal(first.source_checkpoints, 1);
  assert.equal(first.follower_checkpoints, 5);
  assert.equal(sourceQuotes, 1);
  assert.equal(followerQuotes, 5);
  const second = await runSourceWalletCopyabilityCheckpointBatch(store, provider, {
    now: Math.floor(NOW / 1_000) + 30,
  });
  assert.equal(second.source_event_horizons, 0);
  assert.equal(second.follower_checkpoints, 0);
  assert.equal(sourceQuotes, 1);
  assert.equal(followerQuotes, 5);
});

test("checkpoint migration is append-only, privacy-safe, and adds only a rebuildable current projection", () => {
  const sql = readFileSync(new URL("../customer-migrations/0019_source_wallet_copyability_checkpoints.sql", import.meta.url), "utf8");
  assert.match(sql, /ravenos_source_wallet_opportunity_checkpoints/);
  assert.match(sql, /ravenos_source_wallet_copyability_checkpoints/);
  assert.match(sql, /source_wallet_opportunity_checkpoint_append_only/);
  assert.match(sql, /source_wallet_copyability_checkpoint_append_only/);
  assert.match(sql, /actual_source_exit_claimed'\) = 0/);
  assert.match(sql, /actual_position_created'\) = 0/);
  assert.match(sql, /subscriber_identity_included'\) = 0/);
  assert.match(sql, /execution_boundary\.signing'\) = 0/);
  assert.doesNotMatch(sql, /private[_ ]?key|seed phrase|signed transaction/i);
});
