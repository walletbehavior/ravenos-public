import assert from "node:assert/strict";
import test from "node:test";

import {
  createRobinhoodIngestionBudget,
  createMemoryRobinhoodIngestionStore,
  normalizeRobinhoodHeadNotification,
  normalizeRobinhoodLogObservation,
  runRobinhoodChainIngestionCycle,
  runRobinhoodHeadStreamSupervisor,
} from "../lib/agentic_trading/robinhood/ingestion.mjs";
import { normalizeRobinhoodWatchRegistry } from "../lib/agentic_trading/robinhood/registry.mjs";
import { resolveRobinhoodChainRuntime } from "../lib/agentic_trading/robinhood/runtime.mjs";

const CONTRACT = `0x${"11".repeat(20)}`;
const TOPIC = `0x${"aa".repeat(32)}`;
const NOW = "2026-09-01T21:00:00.000Z";

function blockHash(number, fork = 0) {
  return `0x${(BigInt(fork) * 1_000_000n + BigInt(number)).toString(16).padStart(64, "0")}`;
}

function block(number, { fork = 0, parentFork = fork } = {}) {
  return {
    number: `0x${number.toString(16)}`,
    hash: blockHash(number, fork),
    parentHash: blockHash(number - 1, parentFork),
    timestamp: `0x${(1_788_200_000 + number).toString(16)}`,
  };
}

function log(blockNumber, index = 0, overrides = {}) {
  return {
    address: CONTRACT,
    blockNumber: `0x${blockNumber.toString(16)}`,
    blockHash: blockHash(blockNumber),
    transactionHash: `0x${(10_000 + blockNumber).toString(16).padStart(64, "0")}`,
    transactionIndex: "0x0",
    logIndex: `0x${index.toString(16)}`,
    topics: [TOPIC],
    data: "0x1234",
    removed: false,
    ...overrides,
  };
}

function registry(startBlock = 100) {
  return normalizeRobinhoodWatchRegistry([{
    registry_id: "verified_agent_launch",
    chain_id: 4663,
    address: CONTRACT,
    category: "agent_token_launch",
    label: "Verified fixture",
    start_block: startBlock,
    topics: [TOPIC],
    enabled: true,
    provenance: {
      source_type: "operator_verified",
      reference: `urn:sha256:${"b".repeat(64)}`,
      verification_method: "Deployment evidence reviewed",
      verified_at: NOW,
    },
  }]);
}

function runtime(overrides = {}) {
  return resolveRobinhoodChainRuntime({
    RAVENOS_ROBINHOOD_CHAIN_INGESTION_ENABLED: "1",
    RAVENOS_ROBINHOOD_CHAIN_MAX_BLOCKS_PER_CYCLE: "3",
    RAVENOS_ROBINHOOD_CHAIN_HEAD_LAG_BLOCKS: "1",
    ...overrides,
  });
}

function fakeClient({ head = 105, blocks = null, logs = [], onRequest = null, response_bytes: responseBytes = {} } = {}) {
  const blockRows = blocks || new Map(Array.from({ length: 20 }, (_, index) => {
    const number = 90 + index;
    return [number, block(number)];
  }));
  const calls = [];
  return {
    calls,
    async request(method, params) {
      calls.push({ method, params });
      if (onRequest) {
        const override = await onRequest(method, params, calls.length);
        if (override !== undefined) return {
          result: override,
          provider_id: "fixture_rpc",
          attempts: [],
          response_bytes: responseBytes[method],
        };
      }
      if (method === "eth_chainId") return { result: "0x1237", provider_id: "fixture_rpc", attempts: [], response_bytes: responseBytes[method] };
      if (method === "eth_blockNumber") return { result: `0x${head.toString(16)}`, provider_id: "fixture_rpc", attempts: [], response_bytes: responseBytes[method] };
      if (method === "eth_getBlockByNumber") {
        const number = Number(BigInt(params[0]));
        return { result: blockRows.get(number), provider_id: "fixture_rpc", attempts: [], response_bytes: responseBytes[method] };
      }
      if (method === "eth_getLogs") {
        const filter = params[0];
        const from = Number(BigInt(filter.fromBlock));
        const to = Number(BigInt(filter.toBlock));
        return {
          result: logs.filter((row) => {
            const number = Number(BigInt(row.blockNumber));
            return number >= from && number <= to;
          }),
          provider_id: "fixture_rpc",
          attempts: [],
          response_bytes: responseBytes[method],
        };
      }
      throw new Error(`unexpected_${method}`);
    },
    healthSnapshot() {
      return { schema_version: "fixture", state: "current", providers: [{ provider_id: "fixture_rpc", state: "current" }] };
    },
  };
}

test("bounded initial ingestion persists normalized evidence before advancing a durable cursor", async () => {
  const store = createMemoryRobinhoodIngestionStore();
  const client = fakeClient({ logs: [log(101)] });
  const result = await runRobinhoodChainIngestionCycle({ runtime: runtime(), registry: registry(), client, store, now: NOW });
  assert.equal(result.state, "backfill_pending");
  assert.deepEqual(result.range, { from_block: 100, to_block: 102, target_block: 104 });
  assert.equal(result.counts.observations_inserted, 1);
  assert.equal(result.cursor.last_processed_block, 102);
  assert.equal(result.cursor.backfill_required, true);
  const snapshot = store.snapshot();
  assert.equal(snapshot.observations.length, 1);
  assert.equal(snapshot.observations[0].decode_state, "pending");
  assert.equal(snapshot.observations[0].confirmation.ethereum_finalized, null);
  assert.equal(snapshot.canonical_anchors.length, 3);
  assert.equal(snapshot.canonical_anchors.every((row) => row.provider_id === "fixture_rpc"), true);
  assert.equal(JSON.stringify(snapshot).includes("private_key"), false);
});

test("disabled ingestion and an empty verified registry perform no provider work", async () => {
  const disabledClient = fakeClient();
  const disabled = await runRobinhoodChainIngestionCycle({
    runtime: resolveRobinhoodChainRuntime({}), registry: registry(), client: disabledClient,
    store: createMemoryRobinhoodIngestionStore(), now: NOW,
  });
  assert.equal(disabled.state, "disabled");
  assert.equal(disabledClient.calls.length, 0);

  const emptyClient = fakeClient();
  const empty = await runRobinhoodChainIngestionCycle({
    runtime: runtime(), registry: normalizeRobinhoodWatchRegistry([]), client: emptyClient,
    store: createMemoryRobinhoodIngestionStore(), now: NOW,
  });
  assert.equal(empty.state, "awaiting_verified_registry");
  assert.equal(emptyClient.calls.length, 0);
});

test("duplicate provider logs are reduced to one append-only observation", async () => {
  const store = createMemoryRobinhoodIngestionStore();
  const row = log(101);
  const result = await runRobinhoodChainIngestionCycle({
    runtime: runtime(), registry: registry(), client: fakeClient({ logs: [row, structuredClone(row)] }), store, now: NOW,
  });
  assert.equal(result.counts.logs_received, 2);
  assert.equal(result.counts.observations_inserted, 1);
  assert.equal(result.counts.observations_duplicate, 1);
  assert.equal(store.snapshot().observations.length, 1);
});

test("storage failure never advances the cursor and replay remains possible", async () => {
  const memory = createMemoryRobinhoodIngestionStore();
  const store = {
    ...memory,
    async appendObservation() { throw Object.assign(new Error("database unavailable"), { code: "database_unavailable" }); },
  };
  const result = await runRobinhoodChainIngestionCycle({
    runtime: runtime(), registry: registry(), client: fakeClient({ logs: [log(101)] }), store, now: NOW,
  });
  assert.equal(result.state, "storage_degraded");
  assert.equal(result.evidence.cursor_advanced, false);
  assert.equal(memory.snapshot().cursor, null);
});

test("a parent discontinuity records a gap and fails closed without cursor movement", async () => {
  const blocks = new Map([
    [100, block(100)],
    [101, block(101, { parentFork: 9 })],
    [102, block(102)],
  ]);
  const store = createMemoryRobinhoodIngestionStore();
  const result = await runRobinhoodChainIngestionCycle({
    runtime: runtime(), registry: registry(), client: fakeClient({ blocks, logs: [] }), store, now: NOW,
  });
  assert.equal(result.state, "gap_detected");
  assert.equal(result.evidence.gap.kind, "block_parent_discontinuity");
  assert.equal(store.snapshot().cursor, null);
  assert.equal(store.snapshot().gaps.length, 1);
});

test("a bounded reorg rewinds to a known ancestor, records evidence, and resumes from durable state", async () => {
  const store = createMemoryRobinhoodIngestionStore();
  const first = await runRobinhoodChainIngestionCycle({
    runtime: runtime(), registry: registry(), client: fakeClient({ head: 104, logs: [log(101)] }), store, now: NOW,
  });
  assert.equal(first.cursor.last_processed_block, 102);
  const changedBlocks = new Map([
    [100, block(100)],
    [101, block(101)],
    [102, block(102, { fork: 1, parentFork: 0 })],
    [103, block(103, { fork: 1, parentFork: 1 })],
  ]);
  const changedLog = log(102, 0, { blockHash: blockHash(102, 1), transactionHash: `0x${"cc".repeat(32)}` });
  const second = await runRobinhoodChainIngestionCycle({
    runtime: runtime(), registry: registry(), client: fakeClient({ head: 104, blocks: changedBlocks, logs: [changedLog] }), store,
    now: "2026-09-01T21:01:00.000Z",
  });
  assert.equal(second.state, "current");
  assert.equal(second.cursor.last_processed_block, 103);
  assert.equal(second.evidence.reorgs.length, 1);
  assert.equal(second.evidence.reorgs[0].common_ancestor_block, 101);
  const snapshot = store.snapshot();
  assert.equal(snapshot.reorgs.length, 1);
  assert.equal(snapshot.reorgs[0].observed_tip_provider_id, "fixture_rpc");
  assert.equal(snapshot.reorgs[0].common_ancestor_provider_id, "fixture_rpc");
  assert.equal(snapshot.anchor_history.some((row) => row.block_hash === blockHash(102, 1)), true);
  assert.equal(snapshot.observations.length, 2);
  assert.equal(snapshot.canonical_observation_ids.length, 2);
  assert.equal(snapshot.canonical_observation_ids.includes(snapshot.observations.find((row) => row.block_hash === blockHash(102, 1)).observation_id), true);
});

test("removed logs and log/block contradictions remain explicit unavailable evidence", async () => {
  const removedStore = createMemoryRobinhoodIngestionStore();
  const removed = await runRobinhoodChainIngestionCycle({
    runtime: runtime(), registry: registry(), client: fakeClient({ logs: [log(101, 0, { removed: true })] }), store: removedStore, now: NOW,
  });
  assert.equal(removed.state, "evidence_rejected");
  assert.equal(removed.evidence.gap.kind, "robinhood_removed_log_requires_reconciliation");
  assert.equal(removedStore.snapshot().cursor, null);

  const mismatchStore = createMemoryRobinhoodIngestionStore();
  const mismatch = await runRobinhoodChainIngestionCycle({
    runtime: runtime(), registry: registry(), client: fakeClient({ logs: [log(101, 0, { blockHash: blockHash(101, 8) })] }),
    store: mismatchStore, now: NOW,
  });
  assert.equal(mismatch.state, "provider_contradiction");
  assert.equal(mismatch.evidence.gap.kind, "log_block_hash_mismatch");
});

test("normalized logs retain only bounded evidence and never infer decoding or execution", () => {
  const observation = normalizeRobinhoodLogObservation({
    ...log(101),
    raw_provider_payload: { ignored: true },
    user_id: "must-not-survive",
  }, {
    runtime: runtime(), registry: registry(), retrieved_at: NOW, provider_id: "fixture_rpc",
  });
  assert.equal(observation.contract, CONTRACT);
  assert.equal(observation.decode_state, "pending");
  assert.equal(observation.execution_boundary.live_execution, false);
  assert.equal(JSON.stringify(observation).includes("must-not-survive"), false);
  assert.equal(JSON.stringify(observation).includes("raw_provider_payload"), false);
  assert.throws(() => normalizeRobinhoodLogObservation({
    ...log(101),
    data: `0x${"00".repeat(60 * 1024 + 1)}`,
  }, {
    runtime: runtime(), registry: registry(), retrieved_at: NOW, provider_id: "fixture_rpc",
  }), /robinhood_log_data_invalid/);
});

test("aggregate response and wall-clock budgets stop a cycle without cursor movement", async () => {
  const byteStore = createMemoryRobinhoodIngestionStore();
  const byteLimited = await runRobinhoodChainIngestionCycle({
    runtime: runtime({ RAVENOS_ROBINHOOD_CHAIN_MAX_RESPONSE_BYTES_PER_SCHEDULE: "65536" }),
    registry: registry(),
    client: fakeClient({ response_bytes: { eth_blockNumber: 70_000 } }),
    store: byteStore,
    now: NOW,
  });
  assert.equal(byteLimited.state, "resource_budget_exceeded");
  assert.equal(byteLimited.evidence.gap.kind, "robinhood_response_byte_budget_exceeded");
  assert.equal(byteStore.snapshot().cursor, null);

  let tick = 0;
  const timeStore = createMemoryRobinhoodIngestionStore();
  const timeLimited = await runRobinhoodChainIngestionCycle({
    runtime: runtime({ RAVENOS_ROBINHOOD_CHAIN_MAX_SCHEDULE_WALL_TIME_MS: "1000" }),
    registry: registry(),
    client: fakeClient(),
    store: timeStore,
    now: NOW,
    budget_now: () => { tick += 600; return tick; },
  });
  assert.equal(timeLimited.state, "resource_budget_exceeded");
  assert.equal(timeLimited.evidence.gap.kind, "robinhood_schedule_wall_time_exceeded");
  assert.equal(timeStore.snapshot().cursor, null);
});

test("the schedule-wide log-query budget is cumulative and fails before an excess query", () => {
  const budget = createRobinhoodIngestionBudget(runtime({
    RAVENOS_ROBINHOOD_CHAIN_MAX_LOG_QUERIES_PER_SCHEDULE: "1",
  }), () => 0);
  budget.reserveLogQueries(1);
  assert.equal(budget.snapshot().log_queries, 1);
  assert.throws(() => budget.reserveLogQueries(1), /robinhood_log_query_budget_exceeded/);
});

test("a persisted cross-run log-position conflict remains explicit and blocks cursor movement", async () => {
  const memory = createMemoryRobinhoodIngestionStore();
  const store = {
    ...memory,
    async appendObservation(observation) {
      await memory.appendObservation(observation);
      return { state: "conflict", conflicts_with: "rhol_prior_provider_evidence" };
    },
  };
  const result = await runRobinhoodChainIngestionCycle({
    runtime: runtime(), registry: registry(), client: fakeClient({ logs: [log(101)] }), store, now: NOW,
  });
  assert.equal(result.state, "provider_contradiction");
  assert.equal(result.evidence.gap.kind, "provider_log_position_conflict_persisted");
  assert.equal(result.evidence.cursor_advanced, false);
  assert.equal(memory.snapshot().cursor, null);
});

test("a provider head behind the durable cursor is a gap, not current state", async () => {
  const store = createMemoryRobinhoodIngestionStore();
  const first = await runRobinhoodChainIngestionCycle({
    runtime: runtime(), registry: registry(), client: fakeClient({ head: 104 }), store, now: NOW,
  });
  assert.equal(first.cursor.last_processed_block, 102);
  const regressed = await runRobinhoodChainIngestionCycle({
    runtime: runtime(), registry: registry(), client: fakeClient({ head: 101 }), store,
    now: "2026-09-01T21:01:00.000Z",
  });
  assert.equal(regressed.state, "provider_contradiction");
  assert.equal(regressed.evidence.gap.kind, "provider_head_behind_cursor");
  assert.equal(regressed.cursor.revision, first.cursor.revision);
});

test("websocket head notifications are only bounded catch-up signals, never full-finality claims", () => {
  const signal = normalizeRobinhoodHeadNotification(block(120), runtime());
  assert.equal(signal.block_number, 120);
  assert.equal(signal.finality, "soft_confirmation");
  assert.equal(signal.triggers_bounded_rpc_catchup, true);
  assert.equal(signal.raw_payload_retained, false);
});

test("websocket supervision reconnects with bounded backoff and emits bounded catch-up signals", async () => {
  const activeRuntime = runtime({ RAVENOS_ROBINHOOD_CHAIN_ALCHEMY_API_KEY: "fixture-key" });
  const delays = [];
  const signals = [];
  let attempts = 0;
  const result = await runRobinhoodHeadStreamSupervisor({
    runtime: activeRuntime,
    maximum_attempts: 3,
    maximum_messages: 2,
    reconnect_delay: (attempt) => attempt * 1_000,
    async sleep(delay) { delays.push(delay); },
    async open({ subscription, provider, endpoint }) {
      attempts += 1;
      assert.equal(subscription.method, "eth_subscribe");
      assert.deepEqual(subscription.params, ["newHeads"]);
      assert.equal(provider.provider_id, "alchemy_websocket");
      assert.equal(endpoint.includes("fixture-key"), true);
      if (attempts === 1) throw Object.assign(new Error("socket closed"), { code: "websocket_closed" });
      return (async function* heads() {
        yield { params: { result: block(120) } };
        yield { params: { result: block(121) } };
        yield { params: { result: block(122) } };
      }());
    },
    async on_head(signal) { signals.push(signal); },
  });
  assert.equal(result.state, "degraded");
  assert.equal(result.attempts, 2);
  assert.equal(result.signals, 2);
  assert.deepEqual(delays, [1_000]);
  assert.deepEqual(signals.map((row) => row.block_number), [120, 121]);
  assert.equal(result.raw_messages_retained, false);
  assert.equal(result.execution_authority, false);
});
