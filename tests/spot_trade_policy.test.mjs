import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SPOT_SLIPPAGE_BPS, spotPriceWarnings, normalizeSpotAmountText } from "../ravenos-spot-trade-policy.js";
import fs from "node:fs";
import vm from "node:vm";
import { estimateEvmPriceImpact } from "../lib/customer_trade/price_impact.mjs";

test("mobile decimal notation preserves exact Solana and EVM amounts and precision checks", () => {
  const source = fs.readFileSync(new URL("../worker.mjs", import.meta.url), "utf8");
  const decimal = vm.runInNewContext(`(${source.match(/function decimalText\(value, maximumFractionDigits = 18\) \{[\s\S]*?\n\}/)[0]})`, { normalizeSpotAmountText });
  const units = vm.runInNewContext(`(${source.match(/function exactDisplayToBaseUnits\(value, decimals, field\) \{[\s\S]*?\n\}/)[0]})`, { normalizeSpotAmountText });
  for (const [input, normalized, expected] of [[".015", "0.015", "15000000"], [".02", "0.02", "20000000"], [" .005 ", "0.005", "5000000"]]) {
    assert.equal(normalizeSpotAmountText(input), normalized);
    assert.equal(decimal(input, 9), normalized);
    assert.equal(units(input, 9, "display_amount"), expected);
  }
  assert.equal(units(".000000000000000001", 18, "amount"), "1");
  assert.equal(units("9007199254740993.000000000000000001", 18, "amount"), "9007199254740993000000000000000001");
  for (const invalid of [".", "..015", ".01.5", "1e-3", "-0.01", "0", ".000", "NaN"]) {
    assert.equal(decimal(invalid, 9), null);
    assert.throws(() => units(invalid, 9, "amount"), /amount_invalid/);
  }
  assert.equal(decimal(".0000000001", 9), null);
  assert.throws(() => units(".0000000001", 9, "amount"), /precision_invalid/);
});

test("spot defaults to 3%; warnings start strictly above 5% and unknown impact is not zero evidence", () => {
  assert.equal(DEFAULT_SPOT_SLIPPAGE_BPS, 300);
  for (const value of [null, undefined, NaN, 0, 300, 500]) assert.deepEqual(spotPriceWarnings({ slippageBps: value, priceImpactBps: value }), []);
  assert.match(spotPriceWarnings({ slippageBps: 501 })[0], /High slippage: 5.01%/);
  assert.match(spotPriceWarnings({ priceImpactBps: 501 })[0], /High price impact: 5.01%/);
  assert.equal(spotPriceWarnings({ slippageBps: 750, priceImpactBps: 600 }).length, 2);
});

test("EVM quote impact uses net execution value, timestamps and token decimals, never market cap", () => {
  const now = Date.now();
  const market = { priceUsd: 2, lastUpdated: new Date(now).toISOString(), marketCap: 1 };
  const buy = { market, quote: { exact_binding: { buy_amount_base_units: "45000000000000000000" } }, side: "buy", tokenDecimals: 18, notionalBaseUnits: "100000000", now };
  assert.equal(estimateEvmPriceImpact(buy).bps, 1000);
  assert.equal(estimateEvmPriceImpact({ ...buy, market: { ...market, marketCap: 1000000000 } }).bps, 1000);
  assert.equal(estimateEvmPriceImpact(buy).includes_fees_and_spread, true);
  const sell = { market, quote: { exact_binding: { sell_amount_base_units: "50000000000000000000", buy_amount_base_units: "94000000" } }, side: "sell", tokenDecimals: 18, now };
  assert.equal(estimateEvmPriceImpact(sell).bps, 600);
  for (const bad of [{ priceUsd: null }, { priceUsd: 0 }, { lastUpdated: new Date(now - 61_000).toISOString() }, { lastUpdated: new Date(now + 6_000).toISOString() }]) {
    assert.equal(estimateEvmPriceImpact({ ...buy, market: { ...market, ...bad } }), null);
  }
  assert.equal(estimateEvmPriceImpact({ ...buy, notionalBaseUnits: null }), null);
});
