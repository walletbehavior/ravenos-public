import assert from "node:assert/strict";
import test from "node:test";
import { findPerpWithoutDecisionHistory } from "../scripts/lib/perp-live-verification.mjs";
const market = (symbol) => ({ symbol, mark_price: 1, funding_rate: 0, open_interest_usd: 100, day_notional_volume_usd: 100 });
test("free projections require exact-market evidence before assuming decision history is absent", async () => {
  const calls = [];
  const result = await findPerpWithoutDecisionHistory({ universe: { results: [market("BTC"), market("ETH")] }, projection: { access_scope: "free" }, probe: async (row) => {
    calls.push(row.symbol); return { payload: { raven_context: { context_available: row.symbol === "BTC" } } };
  } });
  assert.equal(result.candidate.symbol, "ETH"); assert.deepEqual(calls, ["BTC", "ETH"]);
});
test("legacy projection history is respected and failed exact-market responses are not hidden", async () => {
  const broken = { ok: false, error: "upstream_unavailable" };
  const result = await findPerpWithoutDecisionHistory({ universe: { results: [market("BTC"), market("ETH")] }, projection: { data: { instrument_context: { rows: [{ instrument: "BTC-PERP", context_available: true }] } } }, probe: async (row) => {
    assert.equal(row.symbol, "ETH"); return { payload: broken };
  } });
  assert.equal(result.payload, broken);
});
test("verification bounds its probes and fails if every inspected market has decision history", async () => {
  let count = 0;
  await assert.rejects(findPerpWithoutDecisionHistory({ universe: { results: Array.from({ length: 20 }, (_, i) => market(`M${i}`)) }, probe: async () => {
    count++; return { payload: { raven_context: { context_available: true } } };
  } }), /bounded probe/);
  assert.equal(count, 12);
});
