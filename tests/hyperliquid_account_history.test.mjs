import assert from "node:assert/strict";
import test from "node:test";

import { createHyperliquidAccountHistory } from "../lib/customer_trade/hyperliquid_account_history.mjs";

const ADDRESS = "0xcccccccccccccccccccccccccccccccccccccccc";

test("Hyperliquid account history exposes bounded order outcomes without provider identifiers", () => {
  const history = createHyperliquidAccountHistory({
    address: ADDRESS,
    historicalOrders: [{
      order: {
        coin: "SOL",
        side: "A",
        origSz: "12",
        sz: "2",
        limitPx: "155",
        triggerPx: "0",
        orderType: "Limit",
        tif: "Gtc",
        reduceOnly: true,
        oid: 12345,
        cloid: "0xprivate",
      },
      status: "filled",
      statusTimestamp: 1_788_000_000_000,
    }],
  }, { observedAt: "2026-08-26T12:00:00.000Z" });

  assert.equal(history.ok, true);
  assert.equal(history.orders.length, 1);
  assert.equal(history.orders[0].side, "sell");
  assert.equal(history.orders[0].filled_size, 10);
  assert.equal(history.orders[0].status, "filled");
  assert.equal(history.orders[0].reduce_only, true);
  assert.equal(history.execution_boundary.cancellation_available, false);
  assert.doesNotMatch(JSON.stringify(history), /12345|0xprivate|"oid"|"cloid"/);
});

test("Hyperliquid account history preserves a truthful empty state", () => {
  const history = createHyperliquidAccountHistory({ address: ADDRESS, historicalOrders: [] });
  assert.equal(history.state, "empty");
  assert.deepEqual(history.orders, []);
});
