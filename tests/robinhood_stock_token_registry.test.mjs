import assert from "node:assert/strict";
import test from "node:test";

import { inspectRobinhoodStockToken } from "../lib/customer_trade/robinhood_stock_token_registry.mjs";

const STOCK = "0x1111111111111111111111111111111111111111";
const MEME = "0x2222222222222222222222222222222222222222";

function response(payload, init = {}) {
  return new Response(JSON.stringify(payload), { status: 200, ...init });
}

test("exact Robinhood Chain stock-token deployment is restricted", async () => {
  const result = await inspectRobinhoodStockToken(STOCK, {
    now: () => Date.parse("2026-09-03T20:00:00.000Z"),
    fetch_impl: async () => response({
      assets: [{
        id: `0x${"a".repeat(64)}`,
        tokenSymbol: "TEST",
        status: "ASSET_STATUS_ACTIVE",
        deployments: [{ chainId: 4663, contractAddress: STOCK }],
      }],
    }),
  });
  assert.equal(result.restricted_stock_token, true);
  assert.equal(result.registry_asset.symbol, "TEST");
  assert.equal(result.token_address, STOCK);
});

test("non-registry token is admitted only after a complete current registry response", async () => {
  const result = await inspectRobinhoodStockToken(MEME, {
    fetch_impl: async () => response({
      assets: [{ deployments: [{ chainId: 4663, contractAddress: STOCK }] }],
    }),
  });
  assert.equal(result.restricted_stock_token, false);
  assert.equal(result.exact_registry_match, false);
  assert.equal(result.evidence_state, "current_exact_contract_registry_check");
});

test("registry failures and malformed deployments fail closed", async () => {
  await assert.rejects(() => inspectRobinhoodStockToken(MEME, {
    fetch_impl: async () => response({ error: "missing assets" }),
  }), /robinhood_stock_registry_malformed/);
  await assert.rejects(() => inspectRobinhoodStockToken(MEME, {
    fetch_impl: async () => new Response("unavailable", { status: 503 }),
  }), /robinhood_stock_registry_http_error/);
  await assert.rejects(() => inspectRobinhoodStockToken(MEME, {
    fetch_impl: async () => response({ assets: [{ deployments: [{ chainId: 4663, contractAddress: "bad" }] }] }),
  }), /robinhood_stock_registry_malformed/);
});
