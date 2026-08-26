import assert from "node:assert/strict";
import test from "node:test";

import { canonicalHyperliquidInstrument, normalizeHyperliquidPerps } from "../lib/ravenos_perps_intelligence.mjs";

const fixture = [
  { universe: [{ name: "BTC", maxLeverage: 40 }] },
  [{
    funding: "0.00001",
    openInterest: "100",
    dayNtlVlm: "2500000",
    dayBaseVlm: "40",
    markPx: "66000",
    midPx: "66001",
    oraclePx: "65990",
    prevDayPx: "65000",
    premium: "0.00015",
  }],
];

test("Hyperliquid identity is exact and deterministic", () => {
  assert.deepEqual(canonicalHyperliquidInstrument("btc-perp"), {
    coin: "BTC",
    symbol: "BTC",
    asset: "BTC-PERP",
    instrument_id: "hyperliquid:perp:BTC",
    instrument_scope: "exact_instrument",
    market_type: "perpetual",
    venue: "hyperliquid",
  });
});

test("live perps expose observed facts without fabricated actors or replay", () => {
  const [row] = normalizeHyperliquidPerps(fixture, { now: new Date("2026-07-21T10:00:00Z") });
  assert.equal(row.instrument_id, "hyperliquid:perp:BTC");
  assert.equal(row.mark_price, 66000);
  assert.equal(row.open_interest_usd, 6_600_000);
  assert.equal(row.day_change_pct, 1.5385);
  assert.equal(row.funding_posture, "positive");
  assert.equal(row.is_synthetic, false);
  assert.equal(row.evidence_join, "separate_public_raven_projection");
  for (const forbidden of ["pressureComposition", "replayMatches", "liquidityAttraction", "structureNarrative", "participationOutcome"]) {
    assert.equal(forbidden in row, false);
  }
  assert.equal(JSON.stringify(row).includes("Smart Money"), false);
  assert.equal(JSON.stringify(row).includes("May 2025"), false);
});

test("Hyperliquid markets marked delisted never enter the customer instrument desk", () => {
  const rows = normalizeHyperliquidPerps([
    {
      universe: [
        { name: "BTC", maxLeverage: 40 },
        { name: "MATIC", maxLeverage: 20, isDelisted: true },
      ],
    },
    [
      fixture[1][0],
      {
        funding: "0",
        openInterest: "0",
        dayNtlVlm: "0",
        markPx: "0.37621",
        oraclePx: "0.37621",
        prevDayPx: "0.37621",
      },
    ],
  ]);
  assert.deepEqual(rows.map((row) => row.symbol), ["BTC"]);
  assert.equal(JSON.stringify(rows).includes("MATIC"), false);
});
