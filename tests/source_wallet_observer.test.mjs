import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import bs58 from "bs58";

import {
  SOLANA_CANONICAL_USDC_MINT,
  normalizeSolanaWalletTransaction,
} from "../lib/customer_trade/solana_wallet_intelligence.mjs";
import {
  SOURCE_WALLET_OBSERVER_DELIVERY_SCHEMA,
  SOURCE_WALLET_OBSERVER_JOB_SCHEMA,
  SourceWalletObserverLimits,
  createSourceWalletObserverDelivery,
  createSourceWalletObserverJob,
  createSourceWalletObserverLatency,
  observerRetryDelaySeconds,
  resolveSourceWalletObserverActivation,
  runSourceWalletObserverBatch,
  summarizeSourceWalletObserverLatency,
} from "../lib/customer_trade/source_wallet_observer.mjs";
import {
  fanOutObservedWalletEvent,
} from "../lib/customer_wallet_copy.mjs";
import {
  createRavenCopyPolicy,
} from "../lib/customer_trade/wallet_copy.mjs";

const NOW = Date.parse("2026-08-30T20:00:02.000Z");
const CHAIN_TIME = Math.floor(Date.parse("2026-08-30T20:00:00.000Z") / 1_000);
const WALLET = bs58.encode(Buffer.alloc(32, 41));
const OTHER_WALLET = bs58.encode(Buffer.alloc(32, 42));
const TOKEN = bs58.encode(Buffer.alloc(32, 43));

function transactionInput({
  wallet = WALLET,
  signature = "a".repeat(88),
  slot = 991,
  receivedAt = "2026-08-30T20:00:01.100Z",
  provider = "fixture_geyser",
  finality = "processed",
} = {}) {
  const decodedAt = new Date(Date.parse(receivedAt) + 25).toISOString();
  return {
    wallet_address: wallet,
    signature,
    finality,
    provider,
    observation_mode: "prospective",
    provider_observed_at: "2026-08-30T20:00:00.900Z",
    received_at: receivedAt,
    decode_started_at: receivedAt,
    decoded_at: decodedAt,
    observed_at: decodedAt,
    transaction: {
      slot,
      blockTime: CHAIN_TIME,
      transaction: {
        message: {
          accountKeys: [{ pubkey: wallet, signer: true }],
          instructions: [{ programId: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4" }],
        },
      },
      meta: {
        err: null,
        fee: 5_000,
        preBalances: [1_000_000_000],
        postBalances: [999_995_000],
        preTokenBalances: [
          { owner: wallet, mint: SOLANA_CANONICAL_USDC_MINT, uiTokenAmount: { amount: "100000000", decimals: 6 } },
          { owner: wallet, mint: TOKEN, uiTokenAmount: { amount: "0", decimals: 6 } },
        ],
        postTokenBalances: [
          { owner: wallet, mint: SOLANA_CANONICAL_USDC_MINT, uiTokenAmount: { amount: "75000000", decimals: 6 } },
          { owner: wallet, mint: TOKEN, uiTokenAmount: { amount: "10000000", decimals: 6 } },
        ],
        innerInstructions: [],
        logMessages: ["Program log: Instruction: Route"],
      },
    },
  };
}

function normalizedEvent(overrides = {}) {
  return normalizeSolanaWalletTransaction(transactionInput(overrides));
}

function normalizedSellEvent() {
  const input = transactionInput({ signature: "s".repeat(88), slot: 992 });
  input.transaction.meta.preTokenBalances = [
    { owner: WALLET, mint: SOLANA_CANONICAL_USDC_MINT, uiTokenAmount: { amount: "75000000", decimals: 6 } },
    { owner: WALLET, mint: TOKEN, uiTokenAmount: { amount: "10000000", decimals: 6 } },
  ];
  input.transaction.meta.postTokenBalances = [
    { owner: WALLET, mint: SOLANA_CANONICAL_USDC_MINT, uiTokenAmount: { amount: "87000000", decimals: 6 } },
    { owner: WALLET, mint: TOKEN, uiTokenAmount: { amount: "6000000", decimals: 6 } },
  ];
  return normalizeSolanaWalletTransaction(input);
}

function delivery({
  wallet = WALLET,
  signature = "a".repeat(88),
  slot = 991,
  finality = "processed",
  provider = "fixture_geyser",
  transport = "geyser_grpc",
  event = normalizedEvent({ wallet, signature, slot, finality, provider }),
  receivedAt = "2026-08-30T20:00:01.100Z",
} = {}) {
  return createSourceWalletObserverDelivery({
    source_wallet: { chain: "solana", network: "mainnet", address: wallet },
    signature,
    slot,
    finality,
    provider,
    transport,
    chain_event_at: "2026-08-30T20:00:00.000Z",
    provider_observed_at: "2026-08-30T20:00:00.900Z",
    raven_received_at: receivedAt,
    evidence_reference: `solana:signature:${signature}`,
    normalized_event: event,
  }, { received_at: receivedAt });
}

function memoryStore(jobs) {
  const rows = jobs.map((row) => ({ ...row }));
  const completed = [];
  const retried = [];
  const latencies = [];
  const runs = [];
  return {
    completed,
    retried,
    latencies,
    runs,
    async leaseBatch({ worker_id, limit }) {
      return rows.slice(0, limit).map((row) => ({
        ...row,
        state: "leased",
        attempt_count: row.attempt_count + 1,
        lease_token: `${worker_id}:lease`,
      }));
    },
    async completeJob(record) { completed.push(record); },
    async retryJob(record) { retried.push(record); },
    async recordLatency(record) { latencies.push(record); },
    async recordRun(record) { runs.push(record); },
  };
}

test("observer activation is coordinated, default-off, and never grants execution authority", () => {
  assert.deepEqual(resolveSourceWalletObserverActivation({}), {
    ingest: false,
    evaluator: false,
    configured: false,
    live_copy: false,
    signing: false,
    broadcasting: false,
  });
  const partial = resolveSourceWalletObserverActivation({
    RAVENOS_WALLET_OBSERVER_ENABLED: "1",
    RAVENOS_WALLET_OBSERVER_EVALUATOR_ENABLED: "1",
  });
  assert.equal(partial.ingest, false);
  assert.equal(partial.evaluator, false);
  const active = resolveSourceWalletObserverActivation({
    RAVENOS_WALLET_OBSERVER_ENABLED: "1",
    RAVENOS_WALLET_OBSERVER_EVALUATOR_ENABLED: "1",
    RAVENOS_WALLET_INTELLIGENCE_ENABLED: "1",
    RAVENOS_SHADOW_COPY_ENABLED: "1",
  });
  assert.equal(active.ingest, true);
  assert.equal(active.evaluator, true);
  assert.equal(active.live_copy, false);
});

test("delivery contract preserves exact identity and normalized evidence without provider payloads", () => {
  const row = delivery();
  assert.equal(row.schema_version, SOURCE_WALLET_OBSERVER_DELIVERY_SCHEMA);
  assert.equal(row.source_wallet.address, WALLET);
  assert.match(row.source_wallet_id, /^sw_sol_[a-f0-9]{40}$/);
  assert.match(row.delivery_id, /^swd_[a-f0-9]{40}$/);
  assert.equal(row.decode_required, false);
  assert.equal(row.privacy.raw_provider_payload_persisted, false);
  assert.equal(row.normalized_event.privacy.transaction_material_included, false);
  assert.equal(JSON.stringify(row).includes("preTokenBalances"), false);
  assert.throws(() => createSourceWalletObserverDelivery({
    ...row,
    source_wallet: { ...row.source_wallet, address: OTHER_WALLET },
  }), /observer_delivery_invalid|observer_event_identity_mismatch/);
});

test("all provider and finality deliveries converge on one global decode job", () => {
  const processed = createSourceWalletObserverJob(delivery());
  const finalized = createSourceWalletObserverJob(delivery({
    finality: "finalized",
    provider: "fixture_shreds",
    transport: "shredstream",
    event: normalizedEvent({ finality: "finalized", provider: "fixture_shreds" }),
    receivedAt: "2026-08-30T20:00:01.200Z",
  }));
  assert.equal(processed.schema_version, SOURCE_WALLET_OBSERVER_JOB_SCHEMA);
  assert.equal(processed.job_id, finalized.job_id);
  assert.notEqual(processed.delivery_id, finalized.delivery_id);
  assert.ok(finalized.priority > processed.priority);
});

test("one shared event fans out hundreds of subscriber policies without repeated decode", async () => {
  const row = createSourceWalletObserverJob(delivery(), { now: NOW });
  const store = memoryStore([row]);
  let recordCalls = 0;
  let fanoutCalls = 0;
  const run = await runSourceWalletObserverBatch(store, {
    async recordSharedEvent({ event }) {
      recordCalls += 1;
      assert.equal(event.event_id, row.delivery.normalized_event.event_id);
      return { inserted: true };
    },
    async fanOut() {
      fanoutCalls += 1;
      return { subscriber_policy_count: 500, decision_count: 417 };
    },
  }, { now: NOW, worker_id: "observer_test", batch_size: 10, concurrency: 4 });
  assert.equal(run.totals.jobs_processed, 1);
  assert.equal(run.totals.decode_count, 0);
  assert.equal(run.totals.provider_hydrations, 0);
  assert.equal(run.totals.subscriber_policies_evaluated, 500);
  assert.equal(run.totals.decisions_recorded, 417);
  assert.equal(recordCalls, 1);
  assert.equal(fanoutCalls, 1);
  assert.equal(store.completed.length, 1);
  assert.equal(store.latencies.length, 1);
  assert.equal(store.runs.length, 1);
  assert.equal(run.execution_boundary.broadcasting, false);
});

test("reference-only delivery hydrates and decodes once, with no subscriber-proportional provider load", async () => {
  const reference = delivery({ event: null });
  const row = createSourceWalletObserverJob(reference, { now: NOW });
  const store = memoryStore([row]);
  let hydrationCalls = 0;
  const run = await runSourceWalletObserverBatch(store, {
    async hydrateDelivery() {
      hydrationCalls += 1;
      return transactionInput();
    },
    async recordSharedEvent() { return { inserted: true }; },
    async fanOut() { return { subscriber_policy_count: 2_000, decision_count: 1_700 }; },
  }, { now: NOW, worker_id: "observer_hydrate" });
  assert.equal(hydrationCalls, 1);
  assert.equal(run.totals.provider_hydrations, 1);
  assert.equal(run.totals.decode_count, 1);
  assert.equal(run.totals.subscriber_policies_evaluated, 2_000);
});

test("transient provider failures retry with bounds while identity failures dead-letter", async () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(observerRetryDelaySeconds), SourceWalletObserverLimits.retry_delays_seconds);
  const row = createSourceWalletObserverJob(delivery({ event: null }), { now: NOW });
  const transientStore = memoryStore([row]);
  const transient = await runSourceWalletObserverBatch(transientStore, {
    async hydrateDelivery() {
      const error = new Error("provider_timeout");
      error.code = "provider_timeout";
      throw error;
    },
    async recordSharedEvent() { throw new Error("not_called"); },
    async fanOut() { throw new Error("not_called"); },
  }, { now: NOW, worker_id: "observer_retry" });
  assert.equal(transient.totals.jobs_retried, 1);
  assert.equal(transientStore.retried[0].dead_letter, false);

  const permanentStore = memoryStore([row]);
  const permanent = await runSourceWalletObserverBatch(permanentStore, {
    async hydrateDelivery() { return normalizedEvent({ wallet: OTHER_WALLET }); },
    async recordSharedEvent() { throw new Error("not_called"); },
    async fanOut() { throw new Error("not_called"); },
  }, { now: NOW, worker_id: "observer_dead" });
  assert.equal(permanent.totals.jobs_dead_lettered, 1);
  assert.equal(permanentStore.retried[0].dead_letter, true);
  assert.equal(permanentStore.retried[0].error_code, "observer_event_identity_mismatch");
});

test("latency evidence reports transport-specific p50/p90/p95/p99 without making early speed claims", () => {
  const rows = Array.from({ length: 20 }, (_, index) => {
    const receivedAt = new Date(Date.parse("2026-08-30T20:00:00.000Z") + (index + 1) * 100).toISOString();
    const row = delivery({
      receivedAt,
      event: normalizedEvent({ receivedAt }),
    });
    return createSourceWalletObserverLatency({
      delivery: row,
      event: row.normalized_event,
      phases: {
        fanout_completed_at: new Date(Date.parse(receivedAt) + 20).toISOString(),
        decision_completed_at: new Date(Date.parse(receivedAt) + 40).toISOString(),
        subscriber_policy_count: 10,
        decision_count: 8,
      },
      recorded_at: new Date(Date.parse(receivedAt) + 50).toISOString(),
    });
  });
  const summary = summarizeSourceWalletObserverLatency(rows, { generated_at: "2026-08-30T20:05:00.000Z" });
  assert.equal(summary.sample_count, 20);
  assert.equal(summary.latency.detection.p50_ms, 1_000);
  assert.equal(summary.latency.detection.p95_ms, 1_900);
  assert.equal(summary.by_transport.geyser_grpc.detection.samples, 20);
  assert.equal(summary.speed_claim_calibrated, false);
});

test("observer migration creates a shared durable queue with append-only evidence and no subscriber identity", () => {
  const sql = readFileSync("customer-migrations/0010_source_wallet_observer.sql", "utf8");
  assert.match(sql, /CREATE TABLE ravenos_source_wallet_observer_deliveries/i);
  assert.match(sql, /CREATE TABLE ravenos_source_wallet_observer_jobs/i);
  assert.match(sql, /UNIQUE \(source_wallet_id, signature, decode_version\)/i);
  assert.match(sql, /CREATE TABLE ravenos_source_wallet_observer_latency/i);
  assert.match(sql, /CREATE TRIGGER ravenos_source_wallet_observer_deliveries_append_only/i);
  assert.match(sql, /CREATE TRIGGER ravenos_source_wallet_observer_latency_append_only/i);
  assert.match(sql, /transport IN \('rpc_poll', 'geyser_grpc', 'shredstream', 'replay'\)/i);
  assert.doesNotMatch(sql, /\buser_id\b/i);
  assert.doesNotMatch(sql, /private_key|seed_phrase|signing_key|transaction_hash/i);
  assert.doesNotMatch(sql, /raw_provider_payload\s+(?:TEXT|BLOB)/i);
});

test("shared fanout quotes each exact size once and records one decision per private watch", async () => {
  const event = normalizedEvent();
  const sourceId = delivery().source_wallet_id;
  const policies = [100, 100, 500, 500, 500].map((fixedUsdc, index) => ({
    watch_id: `wcw_${String(index + 1).padStart(40, "0")}`,
    user_id: `usr_${String(index + 1).padStart(32, "0")}`,
    source_wallet_id: sourceId,
    address: WALLET,
    observation_state: "current",
    last_observed_at: Math.floor(NOW / 1_000),
    last_signature: "z".repeat(88),
    label: `Watch ${index + 1}`,
    state: "active",
    copy_mode: "RAVEN_COPY",
    policy_json: JSON.stringify(createRavenCopyPolicy({ sizing: { fixed_usdc: fixedUsdc } })),
    backfill_complete: 1,
    cursor_signature: "b".repeat(88),
    cursor_slot: 990,
    revision: 1,
    created_at: Math.floor(NOW / 1_000) - 60,
    updated_at: Math.floor(NOW / 1_000) - 60,
  }));
  const decisions = new Set();
  const positions = new Set();
  const advanced = new Set();
  const store = {
    async listActiveWatchesForSource() { return policies.filter((row) => !decisions.has(row.watch_id)); },
    async countPendingWatchesForSource() { return policies.filter((row) => !decisions.has(row.watch_id)).length; },
    async recordDecision(_userId, decision) { decisions.add(decision.watch_id); return true; },
    async recordPosition(_userId, position) { positions.add(position.watch_id); return true; },
    async advanceObservedWatchCursor(watchId) { advanced.add(watchId); return true; },
  };
  let quoteCalls = 0;
  const provider = {
    quoteCopySignalCacheKey({ event: row, policy }) { return `${row.event_id}:${policy.sizing.fixed_usdc}`; },
    async quoteCopySignal({ policy }) {
      quoteCalls += 1;
      const now = "2026-08-30T20:00:02.000Z";
      const output = policy.sizing.fixed_usdc * 0.4;
      return {
        source_notional_usdc: 25,
        source_notional_basis: "source_wallet_canonical_usdc_delta",
        liquidity_usd: 1_000_000,
        asset_evidence: { identity_resolved: true, token_standard: "spl", token_standard_resolved: true, reverse_sell_quote_state: "available" },
        entry: { state: "available", quote_id: `entry_${policy.sizing.fixed_usdc}`, provider: "fixture", requested_at: now, quoted_at: now, received_at: now, expires_at: "2026-08-30T20:00:22.000Z", expected_output: output, minimum_output: output * 0.99, exact_asset_identity: true },
        exit: { state: "available", quote_id: `exit_${policy.sizing.fixed_usdc}`, provider: "fixture", requested_at: now, quoted_at: now, received_at: now, expires_at: "2026-08-30T20:00:22.000Z", expected_output: policy.sizing.fixed_usdc * 0.99, minimum_output: policy.sizing.fixed_usdc * 0.98, exact_asset_identity: true },
      };
    },
  };
  const result = await fanOutObservedWalletEvent({
    event,
    source_wallet_id: policies[0].source_wallet_id,
    store,
    provider,
    now: Math.floor(NOW / 1_000),
  });
  assert.equal(result.complete, true);
  assert.equal(result.subscriber_policy_count, 5);
  assert.equal(result.decision_count, 5);
  assert.equal(result.quote_variant_count, 2);
  assert.equal(quoteCalls, 2);
  assert.equal(decisions.size, 5);
  assert.equal(advanced.size, 5);
  assert.equal(positions.size, 5);
});

test("Nexus sell fanout shares exact exit quotes and maps only follower-owned lots", async () => {
  const event = normalizedSellEvent();
  const sourceId = delivery().source_wallet_id;
  const rows = [39_500_000, 39_500_000, 100_000_000].map((quantity, index) => ({
    watch_id: `wcw_${String(index + 50).padStart(40, "0")}`,
    user_id: `usr_${String(index + 50).padStart(32, "0")}`,
    source_wallet_id: sourceId,
    address: WALLET,
    observation_state: "current",
    last_observed_at: Math.floor(NOW / 1_000),
    last_signature: "z".repeat(88),
    label: `Exit ${index + 1}`,
    state: "active",
    copy_mode: "RAVEN_COPY",
    policy_json: JSON.stringify(createRavenCopyPolicy({ sizing: { fixed_usdc: index === 2 ? 250 : 100 } })),
    backfill_complete: 1,
    cursor_signature: "b".repeat(88),
    cursor_slot: 991,
    revision: 1,
    created_at: Math.floor(NOW / 1_000) - 60,
    updated_at: Math.floor(NOW / 1_000) - 60,
    mapped_quantity: quantity,
  }));
  const recorded = new Map();
  const advanced = new Set();
  const store = {
    async listActiveWatchesForSource() { throw new Error("buy_lane_not_expected"); },
    async listActiveWatchesForExitSource() { return rows.filter((row) => !recorded.has(row.watch_id)); },
    async countPendingExitWatchesForSource() { return rows.filter((row) => !recorded.has(row.watch_id)).length; },
    async listMappedPositionsForWatch(_userId, watchId) {
      const row = rows.find((candidate) => candidate.watch_id === watchId);
      return [{
        schema_version: "ravenos.shadow_copy_position.v1",
        position_id: `scp_${watchId.slice(4)}`,
        watch_id: watchId,
        source_wallet: { chain: "solana", network: "mainnet", address: WALLET },
        source_event_id: `swe_${"b".repeat(40)}`,
        opening_decision_id: `scd_${"c".repeat(40)}`,
        destination_asset: { mint: TOKEN, decimals: 6, standard: "spl" },
        expected_quantity: row.mapped_quantity / 1_000_000,
        expected_quantity_base_units: String(row.mapped_quantity),
        minimum_quantity_base_units: String(row.mapped_quantity),
        remaining_quantity_base_units: String(row.mapped_quantity),
        exited_quantity_base_units: "0",
        entry_cost_usdc: row.mapped_quantity === 100_000_000 ? 250 : 100,
        state: "SHADOW_OPEN",
        opened_at: "2026-08-30T19:59:00.000Z",
        source_strategy_attribution_preserved: true,
        live_assets_held: false,
        transaction_hash: null,
      }];
    },
    async recordExitDecision(_userId, decision) { recorded.set(decision.watch_id, decision); return true; },
    async advanceObservedWatchCursor(watchId) { advanced.add(watchId); return true; },
  };
  let quoteCalls = 0;
  const provider = {
    async quoteCopyExit({ quantity_base_units: quantityBaseUnits }) {
      quoteCalls += 1;
      const now = "2026-08-30T20:00:02.000Z";
      const gross = Number(quantityBaseUnits) / 1_000_000;
      return {
        asset_evidence: { identity_resolved: true, token_standard: "spl", token_standard_resolved: true, sell_simulation_state: "passed" },
        exit: { state: "available", quote_id: `exit_${quantityBaseUnits}`, provider: "fixture", requested_at: now, quoted_at: now, received_at: now, expires_at: "2026-08-30T20:00:22.000Z", expected_output: gross, minimum_output: gross * 0.99, expected_output_base_units: String(Math.trunc(gross * 1_000_000)), minimum_output_base_units: String(Math.trunc(gross * 990_000)), exact_asset_identity: true },
      };
    },
  };
  const result = await fanOutObservedWalletEvent({ event, source_wallet_id: sourceId, store, provider, now: Math.floor(NOW / 1_000) });
  assert.equal(result.complete, true);
  assert.equal(result.subscriber_policy_count, 3);
  assert.equal(result.decision_count, 3);
  assert.equal(result.position_exit_count, 3);
  assert.equal(result.quote_variant_count, 2);
  assert.equal(quoteCalls, 2);
  assert.equal(recorded.size, 3);
  assert.equal(advanced.size, 3);
  assert.deepEqual([...recorded.values()].map((row) => row.mapped_follower_exit.quantity_base_units), ["15800000", "15800000", "40000000"]);
  assert.ok([...recorded.values()].every((row) => row.decision.state === "SHADOW_EXIT_EXECUTABLE"));
  assert.ok([...recorded.values()].every((row) => row.execution_boundary.transaction_hash === null));
});

test("shared fanout bounds quote variants and reports remaining policies for retry", async () => {
  const event = normalizedEvent();
  const sourceId = delivery().source_wallet_id;
  const rows = [25, 100, 500].map((fixedUsdc, index) => ({
    watch_id: `wcw_${String(index + 20).padStart(40, "0")}`,
    user_id: `usr_${String(index + 20).padStart(32, "0")}`,
    source_wallet_id: sourceId,
    address: WALLET,
    observation_state: "current",
    last_observed_at: Math.floor(NOW / 1_000),
    last_signature: "z".repeat(88),
    label: `Bound ${index}`,
    state: "active",
    copy_mode: "RAVEN_COPY",
    policy_json: JSON.stringify(createRavenCopyPolicy({ sizing: { fixed_usdc: fixedUsdc } })),
    backfill_complete: 1,
    cursor_signature: "b".repeat(88),
    cursor_slot: 990,
    revision: 1,
    created_at: Math.floor(NOW / 1_000) - 60,
    updated_at: Math.floor(NOW / 1_000) - 60,
  }));
  const done = new Set();
  const store = {
    async listActiveWatchesForSource() { return rows.filter((row) => !done.has(row.watch_id)); },
    async countPendingWatchesForSource() { return rows.filter((row) => !done.has(row.watch_id)).length; },
    async recordDecision(_userId, decision) { done.add(decision.watch_id); return true; },
    async recordPosition() { return true; },
    async advanceObservedWatchCursor() { return true; },
  };
  const provider = {
    quoteCopySignalCacheKey({ policy }) { return String(policy.sizing.fixed_usdc); },
    async quoteCopySignal({ policy }) {
      const now = "2026-08-30T20:00:02.000Z";
      return {
        source_notional_usdc: 25,
        liquidity_usd: 1_000_000,
        asset_evidence: { identity_resolved: true, token_standard: "spl", token_standard_resolved: true },
        entry: { state: "available", quote_id: `e_${policy.sizing.fixed_usdc}`, provider: "fixture", requested_at: now, quoted_at: now, received_at: now, expires_at: "2026-08-30T20:00:22.000Z", expected_output: 10, minimum_output: 9, exact_asset_identity: true },
        exit: { state: "available", quote_id: `x_${policy.sizing.fixed_usdc}`, provider: "fixture", requested_at: now, quoted_at: now, received_at: now, expires_at: "2026-08-30T20:00:22.000Z", expected_output: policy.sizing.fixed_usdc * 0.9, minimum_output: policy.sizing.fixed_usdc * 0.85, exact_asset_identity: true },
      };
    },
  };
  const first = await fanOutObservedWalletEvent({ event, source_wallet_id: rows[0].source_wallet_id, store, provider, now: Math.floor(NOW / 1_000), maximum_quote_variants: 2 });
  assert.equal(first.complete, false);
  assert.equal(first.subscriber_policy_count, 2);
  assert.equal(first.deferred_policy_count, 1);
  const second = await fanOutObservedWalletEvent({ event, source_wallet_id: rows[0].source_wallet_id, store, provider, now: Math.floor(NOW / 1_000), maximum_quote_variants: 2 });
  assert.equal(second.complete, true);
  assert.equal(done.size, 3);
});
