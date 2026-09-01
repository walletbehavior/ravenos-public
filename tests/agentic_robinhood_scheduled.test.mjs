import assert from "node:assert/strict";
import test from "node:test";

import { runScheduledRobinhoodChainIngestion } from "../lib/agentic_trading/robinhood/scheduled.mjs";

function runtime(enabled = true) {
  return {
    enabled,
    chain_id: 4663,
    network: "mainnet",
    execution_boundary: { live_execution: false },
  };
}

function registry(count = 1) {
  return {
    enabled_entry_count: count,
    registry_hash: "a".repeat(64),
  };
}

test("scheduled Robinhood ingestion is dormant without its explicit flag", async () => {
  let touched = false;
  const result = await runScheduledRobinhoodChainIngestion({}, {
    resolve_runtime: () => runtime(false),
    run_cycle: async () => { touched = true; },
  });
  assert.equal(result.state, "disabled");
  assert.equal(result.live_execution, false);
  assert.equal(touched, false);
});

test("verified-registry absence performs no provider or store work", async () => {
  let touched = false;
  const result = await runScheduledRobinhoodChainIngestion({}, {
    resolve_runtime: () => runtime(true),
    load_registry: () => registry(0),
    store: {},
    run_cycle: async () => { touched = true; },
  });
  assert.equal(result.state, "awaiting_verified_registry");
  assert.equal(result.cycles, 0);
  assert.equal(touched, false);
});

test("bounded scheduler advances backfill without exceeding its configured cycle budget", async () => {
  let calls = 0;
  const budgets = [];
  const result = await runScheduledRobinhoodChainIngestion({ RAVENOS_ROBINHOOD_CHAIN_MAX_CYCLES_PER_SCHEDULE: "3" }, {
    resolve_runtime: () => runtime(true),
    load_registry: () => registry(1),
    store: {},
    client: {},
    run_cycle: async ({ resource_budget: resourceBudget }) => {
      calls += 1;
      budgets.push(resourceBudget);
      return {
        state: calls < 3 ? "backfill_pending" : "current",
        observed_head_block: 200,
        cursor: { revision: calls },
        provider_health: { state: "current" },
        counts: { queries: 1, logs_received: 2, observations_inserted: 2, observations_duplicate: 0, block_anchors: 10 },
      };
    },
  });
  assert.equal(result.state, "current");
  assert.equal(result.cycles, 3);
  assert.equal(result.counts.queries, 3);
  assert.equal(result.counts.observations_inserted, 6);
  assert.equal(new Set(budgets).size, 1);
  assert.equal(result.counts.rpc_attempts, 0);
  assert.equal(result.transaction_construction, false);
  assert.equal(result.signing, false);
  assert.equal(result.broadcasting, false);
});

test("scheduler stops after one fail-closed provider result", async () => {
  let calls = 0;
  const result = await runScheduledRobinhoodChainIngestion({ RAVENOS_ROBINHOOD_CHAIN_MAX_CYCLES_PER_SCHEDULE: "20" }, {
    resolve_runtime: () => runtime(true),
    load_registry: () => registry(1),
    store: {},
    client: {},
    run_cycle: async () => {
      calls += 1;
      return { state: "provider_unavailable", counts: {} };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.state, "provider_unavailable");
});
