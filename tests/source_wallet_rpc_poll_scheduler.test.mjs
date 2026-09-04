import assert from "node:assert/strict";
import test from "node:test";

import bs58 from "bs58";

import {
  SOURCE_WALLET_RPC_POLL_RUN_SCHEMA,
  resolveSourceWalletRpcPollActivation,
  runScheduledSourceWalletRpcPoll,
} from "../lib/customer_trade/source_wallet_rpc_poll_scheduler.mjs";

const WALLET = bs58.encode(Buffer.alloc(32, 81));
const NOW = "2026-09-04T18:00:00.000Z";
const signature = (value) => bs58.encode(Buffer.alloc(64, value));

function activeEnv(overrides = {}) {
  return {
    RAVENOS_WALLET_INTELLIGENCE_ENABLED: "1",
    RAVENOS_SHADOW_COPY_ENABLED: "1",
    RAVENOS_WALLET_OBSERVER_ENABLED: "1",
    RAVENOS_WALLET_OBSERVER_EVALUATOR_ENABLED: "1",
    RAVENOS_WALLET_RPC_POLL_ENABLED: "1",
    ...overrides,
  };
}

test("scheduled RPC polling requires every coordinated read-only gate", () => {
  assert.equal(resolveSourceWalletRpcPollActivation({}).active, false);
  const active = resolveSourceWalletRpcPollActivation(activeEnv());
  assert.equal(active.active, true);
  assert.equal(active.transport, "rpc_poll");
  assert.deepEqual(
    { live_copy: active.live_copy, signing: active.signing, broadcasting: active.broadcasting, custody: active.custody },
    { live_copy: false, signing: false, broadcasting: false, custody: false },
  );
});

test("scheduled RPC polling is idle without watched wallets and does not call a provider", async () => {
  let providerCalls = 0;
  const result = await runScheduledSourceWalletRpcPoll({
    env: activeEnv(),
    store: { async listObserverPollingUniverse(limit) { assert.equal(limit, 50); return []; } },
    async fetch_signatures() { providerCalls += 1; return []; },
    async ingest_delivery() { throw new Error("not_called"); },
  });
  assert.equal(result.schema_version, SOURCE_WALLET_RPC_POLL_RUN_SCHEMA);
  assert.equal(result.state, "idle");
  assert.equal(providerCalls, 0);
});

test("scheduled RPC polling refuses to invent a baseline", async () => {
  let providerCalls = 0;
  const result = await runScheduledSourceWalletRpcPoll({
    env: activeEnv(),
    store: { async listObserverPollingUniverse() { return [{ address: WALLET, cursor: null }]; } },
    async fetch_signatures() { providerCalls += 1; return []; },
    async ingest_delivery() { throw new Error("not_called"); },
  });
  assert.equal(result.state, "baseline_required");
  assert.equal(result.counts.skipped_unbaselined, 1);
  assert.equal(providerCalls, 0);
});

test("scheduled RPC polling preserves the cursor and feeds only newer observations into the shared queue", async () => {
  const cursor = { signature: signature(1), slot: 100 };
  const deliveries = [];
  const calls = [];
  const result = await runScheduledSourceWalletRpcPoll({
    env: activeEnv({ RAVENOS_WALLET_RPC_POLL_MAXIMUM_WALLETS: "12" }),
    now: () => NOW,
    store: {
      async listObserverPollingUniverse(limit) {
        assert.equal(limit, 12);
        return [{ address: WALLET, cursor }];
      },
    },
    async fetch_signatures(input) {
      calls.push(input);
      return [
        { signature: signature(3), slot: 103, blockTime: 1_788_127_203, confirmationStatus: "confirmed", err: null },
        { signature: signature(2), slot: 102, blockTime: 1_788_127_202, confirmationStatus: "confirmed", err: null },
      ];
    },
    async ingest_delivery(delivery) { deliveries.push(delivery); },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].until, cursor.signature);
  assert.deepEqual(deliveries.map((row) => row.slot), [102, 103]);
  assert.equal(result.state, "current");
  assert.equal(result.counts.deliveries_ingested, 2);
  assert.equal(result.execution_boundary.live_copy, false);
  assert.equal(JSON.stringify(result).includes("private"), false);
});

test("scheduled RPC polling rejects a budget above the transport bound", async () => {
  await assert.rejects(
    runScheduledSourceWalletRpcPoll({
      env: activeEnv({ RAVENOS_WALLET_RPC_POLL_MAXIMUM_WALLETS: "251" }),
      store: { async listObserverPollingUniverse() { return []; } },
      async fetch_signatures() { return []; },
      async ingest_delivery() {},
    }),
    /source_wallet_rpc_poll_maximum_wallets_invalid/,
  );
});
