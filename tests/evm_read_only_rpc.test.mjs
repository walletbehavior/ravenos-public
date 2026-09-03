import assert from "node:assert/strict";
import test from "node:test";

import {
  createReadOnlyEvmRpcClient,
  readEvmFinalityEvidence,
  verifyReadOnlyEvmRpcChain,
} from "../lib/customer_trade/evm_read_only_rpc.mjs";

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

test("read-only EVM RPC verifies exact configured chain and never exposes endpoint secrets", async () => {
  const calls = [];
  const client = createReadOnlyEvmRpcClient({
    chain_id: 56,
    chain_namespace: "bsc",
    providers: [{ provider_id: "primary", url: "https://example.com/v2/secret" }],
  }, {
    fetchImpl: async (url, init) => {
      calls.push({ url, payload: JSON.parse(init.body) });
      return response({ jsonrpc: "2.0", id: 1, result: "0x38" });
    },
  });
  const evidence = await verifyReadOnlyEvmRpcChain(client, 56);
  assert.equal(evidence.verified, true);
  assert.equal(evidence.canonical_chain_id, "eip155:56");
  assert.equal(calls[0].url, "https://example.com/v2/secret");
  assert.equal(JSON.stringify(client).includes("secret"), false);
});

test("write and submission methods fail before any provider request", async () => {
  let calls = 0;
  const client = createReadOnlyEvmRpcClient({
    chain_id: 56,
    chain_namespace: "bsc",
    providers: [{ provider_id: "primary", url: "https://example.com" }],
  }, { fetchImpl: async () => { calls += 1; return response({}); } });
  await assert.rejects(() => client.request("eth_sendRawTransaction", ["0x00"]), /evm_rpc_method_forbidden/);
  assert.equal(calls, 0);
});

test("RPC client fails over once and retains bounded health evidence", async () => {
  let calls = 0;
  const client = createReadOnlyEvmRpcClient({
    chain_id: 56,
    chain_namespace: "bsc",
    providers: [
      { provider_id: "primary", url: "https://primary.example.com" },
      { provider_id: "fallback", url: "https://fallback.example.com" },
    ],
  }, {
    fetchImpl: async (_url, init) => {
      calls += 1;
      if (calls === 1) return response({ error: "unavailable" }, 503);
      return response({ jsonrpc: "2.0", id: JSON.parse(init.body).id, result: "0x38" });
    },
  });
  const result = await client.request("eth_chainId", []);
  assert.equal(result.provider_id, "fallback");
  assert.deepEqual(result.attempts.map((row) => row.state), ["failed", "success"]);
  assert.equal(client.healthSnapshot().providers[0].failures, 1);
});

test("finality evidence binds provider latest and finalized block hashes", async () => {
  let requestId = 0;
  const blocks = {
    latest: { number: "0x64", hash: `0x${"a".repeat(64)}` },
    finalized: { number: "0x60", hash: `0x${"b".repeat(64)}` },
  };
  const client = createReadOnlyEvmRpcClient({
    chain_id: 56,
    chain_namespace: "bsc",
    providers: [{ provider_id: "primary", url: "https://example.com" }],
  }, {
    fetchImpl: async (_url, init) => {
      const payload = JSON.parse(init.body);
      requestId = payload.id;
      return response({ jsonrpc: "2.0", id: requestId, result: blocks[payload.params[0]] });
    },
  });
  const evidence = await readEvmFinalityEvidence(client);
  assert.equal(evidence.latest_block, "100");
  assert.equal(evidence.finalized_block, "96");
  assert.equal(evidence.finality_state, "provider_finalized_tag");
});
