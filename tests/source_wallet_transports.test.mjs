import assert from "node:assert/strict";
import test from "node:test";

import bs58 from "bs58";

import { SOLANA_CANONICAL_USDC_MINT } from "../lib/customer_trade/solana_wallet_intelligence.mjs";
import {
  SOURCE_WALLET_TRANSPORT_HEALTH_SCHEMA,
  SOURCE_WALLET_TRANSPORT_RUN_SCHEMA,
  SourceWalletTransportLimits,
  normalizeSourceWalletTransportReference,
  normalizeSourceWalletWatchUniverse,
  observerTransportReconnectDelayMs,
  runRpcPollSourceWalletAdapter,
  runSourceWalletStreamAdapterBatch,
} from "../lib/customer_trade/source_wallet_transports.mjs";
import { runWalletObserverLiveValidation } from "../scripts/validate-wallet-observer-live.mjs";

const WALLET = bs58.encode(Buffer.alloc(32, 71));
const OTHER_WALLET = bs58.encode(Buffer.alloc(32, 72));
const TOKEN = bs58.encode(Buffer.alloc(32, 73));
const NOW = "2026-08-30T22:00:04.000Z";

function signature(value) {
  return bs58.encode(Buffer.alloc(64, value));
}

function reference({
  wallet = WALLET,
  signature: rowSignature = signature(1),
  slot = 100,
  blockTime = 1_788_127_200,
  finality = "confirmed",
  extra = {},
} = {}) {
  return {
    wallet_address: wallet,
    signature: rowSignature,
    slot,
    blockTime,
    confirmationStatus: finality,
    ...extra,
  };
}

test("watch universe observes one public address once and retains only the strongest cursor", () => {
  const rows = normalizeSourceWalletWatchUniverse([
    { address: WALLET, cursor_signature: signature(2), cursor_slot: 102, user_id: "must_not_escape" },
    { wallet_address: WALLET, cursor: { signature: signature(3), slot: 103 }, policy: { private: true } },
    { source_wallet: { address: OTHER_WALLET } },
  ]);
  assert.equal(rows.length, 2);
  const selected = rows.find((row) => row.source_wallet.address === WALLET);
  assert.deepEqual(selected.cursor, { signature: signature(3), slot: 103 });
  assert.equal(JSON.stringify(rows).includes("user_id"), false);
  assert.equal(JSON.stringify(rows).includes("policy"), false);
});

test("provider references are reduced to exact bounded envelopes without raw transaction material", () => {
  const delivery = normalizeSourceWalletTransportReference(reference({
    extra: {
      transaction: { signatures: ["raw"] },
      provider_payload: { secret_shape: true },
      subscriber_id: "private",
    },
  }), {
    provider: "constant_k_nexus_fixture",
    transport: "geyser_grpc",
    received_at: NOW,
  });
  assert.equal(delivery.source_wallet.address, WALLET);
  assert.equal(delivery.signature, signature(1));
  assert.equal(delivery.transport, "geyser_grpc");
  assert.equal(delivery.decode_required, true);
  assert.equal(delivery.privacy.raw_provider_payload_persisted, false);
  const serialized = JSON.stringify(delivery);
  assert.equal(serialized.includes("secret_shape"), false);
  assert.equal(serialized.includes('"subscriber_id"'), false);
  assert.equal(serialized.includes("signatures"), false);
});

test("RPC adapter deduplicates watches, emits oldest first, and advances only an exact cursor", async () => {
  let fetchCalls = 0;
  const ingested = [];
  const run = await runRpcPollSourceWalletAdapter({
    watches: [WALLET, { address: WALLET }],
    page_size: 4,
    now: () => NOW,
    async fetch_signatures({ wallet_address, before, until, limit, commitment }) {
      fetchCalls += 1;
      assert.equal(wallet_address, WALLET);
      assert.equal(before, null);
      assert.equal(until, null);
      assert.equal(limit, 4);
      assert.equal(commitment, "confirmed");
      return [
        reference({ signature: signature(3), slot: 103 }),
        reference({ signature: signature(2), slot: 102 }),
        reference({ signature: signature(1), slot: 101 }),
      ];
    },
    async ingest_delivery(delivery) { ingested.push(delivery); },
  });
  assert.equal(fetchCalls, 1);
  assert.deepEqual(ingested.map((row) => row.slot), [101, 102, 103]);
  assert.equal(run.schema_version, SOURCE_WALLET_TRANSPORT_RUN_SCHEMA);
  assert.equal(run.health.schema_version, SOURCE_WALLET_TRANSPORT_HEALTH_SCHEMA);
  assert.equal(run.health.state, "current");
  assert.equal(run.health.counts.unique_wallets, 1);
  assert.equal(run.health.counts.deliveries_ingested, 3);
  assert.deepEqual(run.cursor_updates[0].cursor, { signature: signature(3), slot: 103 });
  assert.equal(run.execution_boundary.broadcasting, false);
});

test("RPC adapter pages to the existing cursor and preserves catch-up order", async () => {
  const calls = [];
  const ingested = [];
  const run = await runRpcPollSourceWalletAdapter({
    watches: [{ address: WALLET, cursor_signature: signature(1), cursor_slot: 100 }],
    page_size: 2,
    maximum_pages: 3,
    now: () => NOW,
    async fetch_signatures(input) {
      calls.push(input);
      if (!input.before) return [
        reference({ signature: signature(5), slot: 105 }),
        reference({ signature: signature(4), slot: 104 }),
      ];
      return [reference({ signature: signature(3), slot: 103 })];
    },
    async ingest_delivery(delivery) { ingested.push(delivery); },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].before, signature(4));
  assert.equal(calls[1].until, signature(1));
  assert.deepEqual(ingested.map((row) => row.slot), [103, 104, 105]);
  assert.deepEqual(run.cursor_updates[0].cursor, { signature: signature(5), slot: 105 });
  assert.equal(run.health.counts.gap_wallets, 0);
});

test("RPC adapter fails closed on a bounded catch-up gap instead of skipping older events", async () => {
  const ingested = [];
  let page = 0;
  const run = await runRpcPollSourceWalletAdapter({
    watches: [{ address: WALLET, cursor_signature: signature(1), cursor_slot: 100 }],
    page_size: 2,
    maximum_pages: 2,
    now: () => NOW,
    async fetch_signatures() {
      page += 1;
      return page === 1
        ? [reference({ signature: signature(6), slot: 106 }), reference({ signature: signature(5), slot: 105 })]
        : [reference({ signature: signature(4), slot: 104 }), reference({ signature: signature(3), slot: 103 })];
    },
    async ingest_delivery(delivery) { ingested.push(delivery); },
  });
  assert.equal(ingested.length, 0);
  assert.equal(run.cursor_updates.length, 0);
  assert.equal(run.wallet_results[0].state, "gap_detected");
  assert.equal(run.wallet_results[0].catch_up_required, true);
  assert.equal(run.health.state, "degraded");
  assert.equal(run.health.errors.provider_catch_up_bound_exceeded, 1);
});

test("RPC adapter does not advance the cursor after a queue ingest failure", async () => {
  let calls = 0;
  const run = await runRpcPollSourceWalletAdapter({
    watches: [WALLET],
    page_size: 4,
    now: () => NOW,
    async fetch_signatures() {
      return [reference({ signature: signature(3), slot: 103 }), reference({ signature: signature(2), slot: 102 })];
    },
    async ingest_delivery() {
      calls += 1;
      if (calls === 2) throw Object.assign(new Error("queue unavailable"), { code: "observer_ingest_unavailable" });
    },
  });
  assert.equal(calls, 2);
  assert.equal(run.cursor_updates.length, 0);
  assert.equal(run.wallet_results[0].state, "ingest_degraded");
  assert.equal(run.health.counts.ingest_failures, 1);
  assert.equal(run.health.state, "degraded");
});

test("provider timeout, rate limit, authorization, and malformed results remain distinct health evidence", async () => {
  const scenarios = [
    [Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }), "provider_timeout"],
    [Object.assign(new Error("429 rate limited"), { code: "HTTP_429" }), "provider_rate_limited"],
    [Object.assign(new Error("401 unauthorized"), { code: "HTTP_401" }), "provider_authorization_failed"],
  ];
  for (const [error, code] of scenarios) {
    const run = await runRpcPollSourceWalletAdapter({
      watches: [WALLET],
      now: () => NOW,
      async fetch_signatures() { throw error; },
      async ingest_delivery() { throw new Error("not_called"); },
    });
    assert.equal(run.health.state, "unavailable");
    assert.equal(run.health.errors[code], 1);
  }
  const malformed = await runRpcPollSourceWalletAdapter({
    watches: [WALLET],
    now: () => NOW,
    async fetch_signatures() { return { not: "an array" }; },
    async ingest_delivery() { throw new Error("not_called"); },
  });
  assert.equal(malformed.health.errors.provider_response_malformed, 1);
});

test("private stream batch accepts only watched wallets and deduplicates redelivery", async () => {
  const ingested = [];
  const raw = reference({ extra: { raw_provider_payload: { must: "not persist" } } });
  const run = await runSourceWalletStreamAdapterBatch({
    watches: [WALLET],
    references: [raw, raw, reference({ wallet: OTHER_WALLET, signature: signature(2), slot: 101 })],
    provider: "constant_k_nexus_fixture",
    transport: "shredstream",
    now: () => NOW,
    async ingest_delivery(delivery) { ingested.push(delivery); },
  });
  assert.equal(ingested.length, 1);
  assert.equal(JSON.stringify(ingested[0]).includes("must"), false);
  assert.equal(run.health.counts.duplicate_references, 1);
  assert.equal(run.health.counts.references_rejected, 1);
  assert.equal(run.health.errors.observer_reference_outside_watch_universe, 1);
  assert.equal(run.health.state, "degraded");
  assert.equal(run.execution_boundary.live_copy, false);
});

test("reconnect backoff is bounded and deterministic under injected jitter", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 8, 20].map((attempt) => observerTransportReconnectDelayMs(attempt)),
    [1_000, 2_000, 5_000, 10_000, 20_000, 30_000, 60_000, 60_000, 60_000],
  );
  assert.equal(observerTransportReconnectDelayMs(3, { jitter_ratio: 0.2, random: () => 0 }), 4_000);
  assert.equal(observerTransportReconnectDelayMs(3, { jitter_ratio: 0.2, random: () => 1 }), 6_000);
});

test("adapter bounds reject oversized universes and stream bursts", async () => {
  const wallets = Array.from({ length: SourceWalletTransportLimits.maximum_watches_per_run + 1 }, (_, index) => bs58.encode(Buffer.alloc(32, (index % 254) + 1)));
  assert.throws(() => normalizeSourceWalletWatchUniverse(wallets), /observer_watch_universe_too_large/);
  await assert.rejects(() => runSourceWalletStreamAdapterBatch({
    watches: [WALLET],
    references: Array.from({ length: SourceWalletTransportLimits.maximum_stream_references_per_run + 1 }, () => reference()),
    provider: "fixture",
    transport: "replay",
    async ingest_delivery() {},
  }), /observer_transport_batch_too_large/);
});

test("live validator exercises read-only RPC hydration and returns only hashed public references", async () => {
  const sourceSignature = signature(9);
  const transaction = {
    slot: 109,
    blockTime: 1_788_127_200,
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
  };
  const methods = [];
  const report = await runWalletObserverLiveValidation({ wallets: [WALLET], limit: 2, hydrate: 1 }, {
    env: { RAVENOS_SOLANA_RPC_URL: "https://rpc.example.test" },
    async fetch_impl(_url, init) {
      const request = JSON.parse(init.body);
      methods.push(request.method);
      const result = request.method === "getSignaturesForAddress"
        ? [{ signature: sourceSignature, slot: 109, blockTime: 1_788_127_200, confirmationStatus: "confirmed", err: null }]
        : transaction;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.deepEqual(methods, ["getSignaturesForAddress", "getTransaction"]);
  assert.equal(report.mode, "authorized_read_only_manual_probe");
  assert.equal(report.observation.transactions_hydrated, 1);
  assert.equal(report.observation.classifications.SWAP_BUY, 1);
  assert.equal(report.observation.eligible_buy_signals, 1);
  assert.equal(report.interpretation.prospective_detection_latency_measured, false);
  assert.equal(report.execution_boundary.transaction_material_returned, false);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(WALLET), false);
  assert.equal(serialized.includes(sourceSignature), false);
  assert.equal(serialized.includes(TOKEN), false);
  assert.equal(serialized.includes("preTokenBalances"), false);
});
