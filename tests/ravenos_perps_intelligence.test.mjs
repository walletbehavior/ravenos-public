import assert from "node:assert/strict";
import {
  normalizeHyperliquidPerps,
  outcomeConditions,
  pressureComposition,
  pressureSource,
  replayMatches,
} from "../lib/ravenos_perps_intelligence.mjs";

const payload = [
  {
    universe: [
      { name: "BTC", maxLeverage: 40 },
      { name: "ETH", maxLeverage: 25 },
    ],
  },
  [
    {
      funding: "0.00008",
      openInterest: "100000",
      prevDayPx: "62000",
      dayNtlVlm: "2000000000",
      premium: "0.00042",
      oraclePx: "62500",
      markPx: "62600",
      midPx: "62602",
      dayBaseVlm: "32000",
    },
    {
      funding: "0.00001",
      openInterest: "25000",
      prevDayPx: "3400",
      dayNtlVlm: "500000000",
      premium: "-0.00012",
      oraclePx: "3410",
      markPx: "3408",
      midPx: "3409",
      dayBaseVlm: "145000",
    },
  ],
];

const rows = normalizeHyperliquidPerps(payload, { now: new Date("2026-06-23T16:00:00Z") });
assert.equal(rows.length, 2);
assert.equal(rows[0].asset, "BTC-PERP");
assert.equal(rows[0].provider, "Hyperliquid");
assert.equal(rows[0].coverage, "Live");
assert.equal(rows[0].lastUpdated, "2026-06-23T16:00:00.000Z");
assert.ok(rows[0].pressureScore >= rows[1].pressureScore);

assert.equal(rows[0].pressureComposition.length, 4);
assert.equal(rows[0].pressureComposition.reduce((sum, item) => sum + item.contribution, 0), 100);
assert.ok(["smart money accumulation", "retail chasing", "market maker inventory shift", "liquidation cascade"].includes(rows[0].pressureSource));
assert.ok(rows[0].liquidityAttraction.score >= 0);
assert.ok(rows[0].replayMatches[0].similarity >= rows[0].replayMatches[1].similarity);
assert.ok(rows[0].outcomeConditions.supporting.length + rows[0].outcomeConditions.breaking.length > 0);
assert.ok(rows[0].structureNarrative.every((line) => !/buy|sell|long|short/i.test(line)));

const composition = pressureComposition(rows[0]);
assert.equal(composition.length, 4);
assert.ok(pressureSource({ ...rows[0], pressureComposition: composition }));
assert.ok(replayMatches(rows[0])[0].confidence >= 45);
assert.ok(outcomeConditions(rows[0]).supporting.length > 0);
