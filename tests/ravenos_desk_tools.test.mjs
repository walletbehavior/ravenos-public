import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toolPreferences,
  marketRequest,
  quoteFromCandles,
  quoteMatchesMarket,
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

test("live canonical provider identities qualify only the selected market", () => {
  const market = { lane: "perps", asset: "SOL-PERP", label: "SOL" };
  const payload = {
    ok: true,
    instrument: {
      canonical_id: "perpetual:hyperliquid:hyperliquid:SOL:USD:aggregate",
      instrument_type: "perpetual",
      chain: "hyperliquid",
      venue: "hyperliquid",
      symbol: "SOL-PERP",
      quote_asset: "USD",
    },
  };
  assert.equal(quoteMatchesMarket(market, payload), true);
  assert.equal(
    quoteMatchesMarket({ ...market, asset: "BTC-PERP" }, payload),
    false,
  );
  assert.equal(
    quoteMatchesMarket(market, {
      ...payload,
      instrument: {
        ...payload.instrument,
        canonical_id: "perpetual:hyperliquid:hyperliquid:BTC:USD:aggregate",
      },
    }),
    false,
  );
});

test("selected chart prices are reused only with the same verified market identity", async () => {
  const { quoteFromCurrentChart } = await import("../ravenos-desk-tools.js");
  const market = { lane: "spot", chain: "base", pool: "0xpool", token: "0xtoken", quote: "0xquote", label: "TOKEN/USDC" };
  const state = { state: "live", instrument: { instrument_type: "spot_pool", identity_scope: "exact_pool", chain: "base", pool_address: "0xpool", token_address: "0xtoken" }, marketIdentity: "base:pool:0xpool", candles: [{time:1,close:0.00000591,volume:4}], observedAt: "2026-09-07T03:00:00Z", source: "Exact pool chart" };
  assert.equal(quoteFromCurrentChart(market, state)?.price, 0.00000591);
  assert.equal(quoteFromCurrentChart({...market, token:"0xother"},state), null);
  assert.equal(quoteFromCurrentChart(market,{...state,state:"loading"}),null);
  assert.equal(quoteFromCurrentChart(market,{...state,state:"error"}),null);
});


test("production exact-pool chart identity aliases retain prices without accepting another pool or token", async () => {
  const { quoteFromCurrentChart } = await import("../ravenos-desk-tools.js");
  const market = { lane: "spot", chain: "solana", pool: "DA4pM4xSDY4M9V4CgAKKBVH1pw1yscTQQa5nEkGHuKpt", token: "MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump", label: "OTC/SOL" };
  const instrument = { instrument_type: "spot_pool", identity_scope: "exact_pool", chain: "solana", pool_address: market.pool, token_address: market.token, symbol: market.label, venue: "onchain_pool", quote_asset: "USD" };
  const state = { state: "live", instrument, marketIdentity: `solana:${market.pool}`, candles: [{ time: 1788791400, close: 0.0179, volume: 52 }], observedAt: "2026-09-07T14:30:00Z" };
  assert.equal(quoteFromCurrentChart(market, state)?.price, 0.0179);
  assert.equal(quoteFromCurrentChart(market, { ...state, marketIdentity: "solana:OtherPool" }), null);
  assert.equal(quoteFromCurrentChart(market, { ...state, instrument: { ...instrument, pool_address: "OtherPool" } }), null);
  assert.equal(quoteFromCurrentChart(market, { ...state, instrument: { ...instrument, token_address: "OtherToken" } }), null);
  assert.equal(quoteFromCurrentChart({ ...market, pool: market.pool.toLowerCase() }, state), null);
});
