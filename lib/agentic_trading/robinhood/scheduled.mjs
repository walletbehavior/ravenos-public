import { createD1RobinhoodIngestionStore } from "./d1_store.mjs";
import { createRobinhoodIngestionBudget, runRobinhoodChainIngestionCycle } from "./ingestion.mjs";
import { robinhoodWatchRegistryFromEnvironment } from "./registry.mjs";
import { createRobinhoodRpcFailoverClient, resolveRobinhoodChainRuntime } from "./runtime.mjs";

function integer(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 20 ? parsed : fallback;
}

export async function runScheduledRobinhoodChainIngestion(env = {}, dependencies = {}) {
  const resolveRuntime = dependencies.resolve_runtime || resolveRobinhoodChainRuntime;
  const runtime = resolveRuntime(env);
  if (!runtime.enabled) return Object.freeze({ state: "disabled", cycles: 0, live_execution: false });
  if (!env.RAVENOS_CUSTOMER_DB?.prepare && !dependencies.store) {
    throw new Error("robinhood_ingestion_store_unavailable");
  }
  const loadRegistry = dependencies.load_registry || robinhoodWatchRegistryFromEnvironment;
  const registry = loadRegistry(env, { chain_id: runtime.chain_id });
  if (!registry.enabled_entry_count) {
    return Object.freeze({
      state: "awaiting_verified_registry",
      cycles: 0,
      chain_id: runtime.chain_id,
      registry_hash: registry.registry_hash,
      live_execution: false,
    });
  }
  const now = dependencies.now || (() => Date.now());
  const client = dependencies.client || createRobinhoodRpcFailoverClient(runtime, {
    fetchImpl: dependencies.fetch || globalThis.fetch,
    now,
  });
  const store = dependencies.store || createD1RobinhoodIngestionStore(env.RAVENOS_CUSTOMER_DB, { runtime, now });
  const runCycle = dependencies.run_cycle || runRobinhoodChainIngestionCycle;
  const resourceBudget = dependencies.resource_budget
    || createRobinhoodIngestionBudget(runtime, dependencies.budget_now || (() => performance.now()));
  const maximumCycles = integer(env.RAVENOS_ROBINHOOD_CHAIN_MAX_CYCLES_PER_SCHEDULE, 4);
  const runs = [];
  for (let cycle = 0; cycle < maximumCycles; cycle += 1) {
    const run = await runCycle({ runtime, registry, client, store, now, resource_budget: resourceBudget });
    runs.push(run);
    if (!new Set(["backfill_pending", "reorg_detected"]).has(run.state)) break;
  }
  const latest = runs.at(-1);
  return Object.freeze({
    state: latest?.state || "unavailable",
    cycles: runs.length,
    chain_id: runtime.chain_id,
    registry_hash: registry.registry_hash,
    cursor: latest?.cursor || null,
    observed_head_block: latest?.observed_head_block ?? null,
    provider_health: latest?.provider_health || null,
    counts: runs.reduce((total, run) => ({
      queries: total.queries + Number(run.counts?.queries || 0),
      logs_received: total.logs_received + Number(run.counts?.logs_received || 0),
      observations_inserted: total.observations_inserted + Number(run.counts?.observations_inserted || 0),
      observations_duplicate: total.observations_duplicate + Number(run.counts?.observations_duplicate || 0),
      block_anchors: total.block_anchors + Number(run.counts?.block_anchors || 0),
      rpc_attempts: Math.max(total.rpc_attempts, Number(run.counts?.rpc_attempts || 0)),
      log_queries_budgeted: Math.max(total.log_queries_budgeted, Number(run.counts?.log_queries || 0)),
      response_bytes: Math.max(total.response_bytes, Number(run.counts?.response_bytes || 0)),
      elapsed_ms: Math.max(total.elapsed_ms, Number(run.counts?.elapsed_ms || 0)),
    }), {
      queries: 0,
      logs_received: 0,
      observations_inserted: 0,
      observations_duplicate: 0,
      block_anchors: 0,
      rpc_attempts: 0,
      log_queries_budgeted: 0,
      response_bytes: 0,
      elapsed_ms: 0,
    }),
    live_execution: false,
    transaction_construction: false,
    signing: false,
    broadcasting: false,
  });
}
