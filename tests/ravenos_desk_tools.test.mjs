import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toolPreferences,
  marketRequest,
  quoteFromCandles,
} from "../ravenos-desk-tools.js";
test("tools persistence strips private and unexpected fields and bounds user collections", () => {
  const input = {
    lists: Array.from({ length: 20 }, (_, i) => ({
      name: `List ${i}`,
      keys: ["a", "a"],
      wallet: "private",
    })),
    workspaces: [
      { name: "Desk", frame: "evil", layout: "bad", account: "private" },
    ],
    wallet: "secret",
  };
  const p = toolPreferences(input);
  assert.equal(p.lists.length, 8);
  assert.deepEqual(p.lists[0].keys, ["a"]);
  assert.equal(p.workspaces[0].frame, "4h");
  assert.ok(!JSON.stringify(p).includes("private"));
});
test("comparison requests retain exact spot identity and never inherit an account", () => {
  const r = marketRequest(
    {
      lane: "spot",
      chain: "base",
      pool: "pool",
      token: "token",
      quote: "quote",
      label: "A/B",
      account: "private",
    },
    "4h",
  );
  assert.equal(r.pairAddress, "pool");
  assert.equal(r.tokenAddress, "token");
  assert.equal(r.quoteAddress, "quote");
  assert.equal(r.expectedIdentity.poolAddress, "pool");
  assert.equal(r.account, undefined);
});
test("quote windows use ordered bounded observations and do not invent missing change", () => {
  assert.equal(quoteFromCandles([], null, ""), null);
  assert.equal(
    quoteFromCandles([{ time: 1, close: 10 }], null, "x").change,
    null,
  );
  const q = quoteFromCandles(
    [
      { time: 2, close: 12, volume: 5 },
      { time: 1, close: 10, volume: 2 },
    ],
    null,
    "x",
  );
  assert.ok(Math.abs(q.change - 20) < 1e-8);
  assert.equal(q.volume, 7);
  assert.deepEqual(q.points, [10, 12]);
});
