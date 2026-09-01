import assert from "node:assert/strict";
import test from "node:test";

import {
  ROBINHOOD_CHAIN_NETWORKS,
  createRobinhoodRpcFailoverClient,
  resolveRobinhoodChainRuntime,
  robinhoodReconnectDelayMs,
  verifyRobinhoodRpcChain,
} from "../lib/agentic_trading/robinhood/runtime.mjs";
import {
  buildRobinhoodLogQueries,
  normalizeRobinhoodWatchRegistry,
  robinhoodWatchRegistryFromEnvironment,
} from "../lib/agentic_trading/robinhood/registry.mjs";

const CONTRACT_A = `0x${"11".repeat(20)}`;
const CONTRACT_B = `0x${"22".repeat(20)}`;
const TOPIC = `0x${"aa".repeat(32)}`;
const VERIFIED_AT = "2026-09-01T20:00:00.000Z";

function entry(registryId, address, overrides = {}) {
  return {
    registry_id: registryId,
    chain_id: 4663,
    address,
    category: "agent_token_launch",
    label: null,
    start_block: 100,
    topics: [TOPIC],
    enabled: true,
    provenance: {
      source_type: "operator_verified",
      reference: `urn:sha256:${"b".repeat(64)}`,
      verification_method: "Address and deployment receipt reviewed out of band",
      verified_at: VERIFIED_AT,
    },
    ...overrides,
  };
}

test("Robinhood runtime preserves authoritative network identity and defaults live authority off", () => {
  assert.equal(ROBINHOOD_CHAIN_NETWORKS.mainnet.chain_id, 4663);
  assert.equal(ROBINHOOD_CHAIN_NETWORKS.testnet.chain_id, 46630);
  assert.equal(ROBINHOOD_CHAIN_NETWORKS.mainnet.native_gas_asset, "ETH");
  const runtime = resolveRobinhoodChainRuntime({});
  assert.equal(runtime.enabled, false);
  assert.equal(runtime.local_full_node_required, false);
  assert.equal(runtime.rpc_providers[0].provider_id, "official_public_rpc");
  assert.equal(runtime.execution_boundary.live_execution, false);
  assert.equal(runtime.finality_model.block_depth_is_full_finality, false);
  assert.equal(runtime.limits.maximum_response_bytes_per_schedule, 8 * 1024 * 1024);
  assert.equal(runtime.limits.maximum_rpc_attempts_per_schedule, 192);
  assert.equal(runtime.limits.maximum_log_queries_per_schedule, 128);
  assert.equal(runtime.limits.maximum_schedule_wall_time_ms, 25_000);
  const fallbackOnly = resolveRobinhoodChainRuntime({ RAVENOS_ROBINHOOD_CHAIN_INGESTION_ENABLED: "1" });
  assert.equal(fallbackOnly.state, "fallback_only_rate_limited");
});

test("Alchemy credentials stay out of serializable provider state and only read methods are callable", async () => {
  const secret = "secret-api-token";
  const urls = [];
  const runtime = resolveRobinhoodChainRuntime({
    RAVENOS_ROBINHOOD_CHAIN_INGESTION_ENABLED: "1",
    RAVENOS_ROBINHOOD_CHAIN_ALCHEMY_API_KEY: secret,
  });
  assert.equal(JSON.stringify(runtime).includes(secret), false);
  const client = createRobinhoodRpcFailoverClient(runtime, {
    now: () => Date.parse(VERIFIED_AT),
    async fetchImpl(url, init) {
      urls.push(url);
      const request = JSON.parse(init.body);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: "0x1237" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const verified = await verifyRobinhoodRpcChain(client, runtime);
  assert.equal(verified.verified, true);
  assert.equal(urls[0].includes(secret), true);
  const calls = urls.length;
  await assert.rejects(client.request("eth_sendRawTransaction", ["0x00"]), /robinhood_rpc_method_forbidden/);
  assert.equal(urls.length, calls);
});

test("transient primary failure falls back to the official RPC and remains visible in health", async () => {
  const runtime = resolveRobinhoodChainRuntime({
    RAVENOS_ROBINHOOD_CHAIN_INGESTION_ENABLED: "1",
    RAVENOS_ROBINHOOD_CHAIN_ALCHEMY_API_KEY: "test-key",
  });
  const calls = [];
  const client = createRobinhoodRpcFailoverClient(runtime, {
    now: () => Date.parse(VERIFIED_AT),
    async fetchImpl(url, init) {
      calls.push(new URL(url).hostname);
      if (calls.length === 1) throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
      const request = JSON.parse(init.body);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: "0x1237" }), { status: 200 });
    },
  });
  const result = await client.request("eth_chainId", []);
  assert.equal(result.provider_id, "official_public_rpc");
  assert.equal(result.response_bytes > 0, true);
  assert.deepEqual(calls, ["robinhood-mainnet.g.alchemy.com", "rpc.mainnet.chain.robinhood.com"]);
  const health = client.healthSnapshot();
  assert.equal(health.providers.find((row) => row.provider_id === "alchemy_rpc").last_error, "provider_timeout");
  assert.equal(health.providers.find((row) => row.provider_id === "official_public_rpc").state, "current");
});

test("a successful response from the wrong chain fails closed instead of falling through", async () => {
  const runtime = resolveRobinhoodChainRuntime({
    RAVENOS_ROBINHOOD_CHAIN_INGESTION_ENABLED: "1",
    RAVENOS_ROBINHOOD_CHAIN_ALCHEMY_API_KEY: "test-key",
  });
  let calls = 0;
  const client = createRobinhoodRpcFailoverClient(runtime, {
    now: () => Date.parse(VERIFIED_AT),
    async fetchImpl(_url, init) {
      calls += 1;
      const request = JSON.parse(init.body);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: "0x1" }), { status: 200 });
    },
  });
  await assert.rejects(verifyRobinhoodRpcChain(client, runtime), /robinhood_provider_chain_id_mismatch/);
  assert.equal(calls, 1);
});

test("watch registry is empty by default and requires exact verified identities and start blocks", () => {
  const empty = robinhoodWatchRegistryFromEnvironment({});
  assert.equal(empty.enabled_entry_count, 0);
  assert.equal(empty.earliest_start_block, null);
  const omittedEnable = entry("launch_omitted", CONTRACT_A);
  delete omittedEnable.enabled;
  assert.equal(normalizeRobinhoodWatchRegistry([omittedEnable]).enabled_entry_count, 0);
  const registry = normalizeRobinhoodWatchRegistry([
    entry("launch_a", CONTRACT_A),
    entry("launch_b", CONTRACT_B, { start_block: 105 }),
  ]);
  assert.equal(registry.enabled_entry_count, 2);
  assert.equal(registry.earliest_start_block, 100);
  assert.match(registry.registry_hash, /^[a-f0-9]{64}$/);
  assert.throws(() => normalizeRobinhoodWatchRegistry([
    entry("launch_a", CONTRACT_A, { provenance: { source_type: "social_post" } }),
  ]), /robinhood_registry_provenance_invalid/);
  assert.throws(() => normalizeRobinhoodWatchRegistry([
    entry("launch_a", CONTRACT_A, { start_block: -1 }),
  ]), /robinhood_registry_start_block_invalid/);
  assert.throws(() => normalizeRobinhoodWatchRegistry([
    entry("launch_a", CONTRACT_A), entry("launch_b", CONTRACT_A),
  ]), /robinhood_registry_address_duplicate/);
});

test("log queries are registry-driven, bounded, and never scan before a verified start", () => {
  const entries = Array.from({ length: 23 }, (_, index) => entry(
    `launch_${String(index).padStart(2, "0")}`,
    `0x${(index + 1).toString(16).padStart(40, "0")}`,
    { start_block: 100 + index },
  ));
  const registry = normalizeRobinhoodWatchRegistry(entries);
  const queries = buildRobinhoodLogQueries(registry, { from_block: 90, to_block: 130 });
  assert.equal(queries.length, 2);
  assert.equal(queries[0].addresses.length, 20);
  assert.equal(queries[1].addresses.length, 3);
  assert.equal(queries[0].from_block >= 100, true);
  assert.deepEqual(queries[0].topics, [TOPIC]);
});

test("reconnect backoff is bounded and deterministic with injected jitter", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 99].map((attempt) => robinhoodReconnectDelayMs(attempt)), [
    1_000, 2_000, 5_000, 10_000, 20_000, 30_000, 60_000, 60_000,
  ]);
  assert.equal(robinhoodReconnectDelayMs(3, { jitter_ratio: 0.2, random: () => 0 }), 4_000);
  assert.equal(robinhoodReconnectDelayMs(3, { jitter_ratio: 0.2, random: () => 1 }), 6_000);
});
