import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDeskFrame,
  opportunityLifecycle,
  spotFlowRead,
  spotMarketHealth,
} from "../ravenos-discover-intelligence.js";

function opportunity(overrides = {}) {
  return {
    instrument: "SOL-PERP",
    instrument_id: "hyperliquid:perp:SOL",
    observed_direction: "long",
    context_age_seconds: 420,
    pressure_state: "Bid-side pressure visible",
    market_context: { entry_reference_price: 100, roundtrip_bps: 8 },
    market_snapshot: { last_price: 100.8, open_interest_usd: 120_000_000, funding_rate: 0.00001 },
    matured_comparables: {
      sample_size: 128,
      positive_followthrough_rate: 0.58,
      median_favorable_excursion_pct: 1.4,
      median_adverse_excursion_pct: -0.7,
    },
    ...overrides,
  };
}

function pool(overrides = {}) {
  return {
    symbol: "RAVEN",
    observed_at: "2026-08-26T01:00:00Z",
    market: {
      price_change_5m_pct: 1.2,
      price_change_1h_pct: 3.4,
      price_change_24h_pct: 8,
      volume_usd_5m: 18_000,
      volume_usd_1h: 160_000,
      volume_usd_24h: 1_200_000,
      liquidity_usd: 240_000,
      market_cap_usd: 2_400_000,
      buys_5m: 72,
      sells_5m: 28,
      buyers_5m: 54,
      sellers_5m: 21,
      buys_1h: 410,
      sells_1h: 190,
      buyers_1h: 240,
      sellers_1h: 120,
    },
    ...overrides,
  };
}

test("opportunity lifecycle confirms supported directional follow-through", () => {
  const read = opportunityLifecycle(opportunity());
  assert.equal(read.state, "confirmed");
  assert.equal(read.label, "Confirmed");
  assert.ok(read.score >= 75);
  assert.match(read.invalidation, /Risk below/);
});

test("opportunity lifecycle invalidates and sharply demotes an adverse path", () => {
  const row = opportunity({ market_snapshot: { last_price: 98.8 } });
  const read = opportunityLifecycle(row);
  assert.equal(read.state, "invalidated");
  assert.ok(read.score <= 20);
  assert.match(read.summary, /demoted/i);
});

test("spot flow calls accumulation only when distinct participants align across windows", () => {
  const read = spotFlowRead(pool(), "5m");
  assert.equal(read.state, "accumulation");
  assert.equal(read.label, "Accumulation");
  assert.ok(read.score >= 70);
  assert.match(read.detail, /participants/);
});

test("transaction imbalance remains buy-side pressure when unique participant evidence is absent", () => {
  const row = pool();
  delete row.market.buyers_5m;
  delete row.market.sellers_5m;
  delete row.market.buyers_1h;
  delete row.market.sellers_1h;
  const read = spotFlowRead(row, "5m");
  assert.equal(read.state, "buy_pressure");
  assert.notEqual(read.label, "Accumulation");
});

test("inactive and near-empty pools fail the market-health layer", () => {
  const health = spotMarketHealth(pool({
    market: {
      price_change_5m_pct: 0,
      price_change_1h_pct: 0,
      price_change_24h_pct: -15,
      volume_usd_5m: 0,
      volume_usd_1h: 0,
      volume_usd_24h: 12,
      liquidity_usd: 900,
      market_cap_usd: 3_000,
      buys_5m: 0,
      sells_5m: 0,
      buys_1h: 0,
      sells_1h: 0,
    },
  }));
  assert.equal(health.state, "inactive");
  assert.ok(health.scoreCap <= 10);
});

test("parabolic pools stay visible but receive a chase-risk score cap", () => {
  const row = pool();
  row.market.price_change_1h_pct = 125;
  row.market.price_change_24h_pct = 4_200;
  const health = spotMarketHealth(row);
  const flow = spotFlowRead(row, "5m");
  assert.equal(health.state, "extended");
  assert.match(health.label, /chase risk/i);
  assert.ok(flow.score <= 66);
});

test("desk frame fuses live markets, flows, lifecycle, and Atlas without empty-language cards", () => {
  const frame = buildDeskFrame({
    brief: {
      generated_at: "2026-08-26T01:02:00Z",
      one_sentence_read: "Solana is leading current opportunity, but followthrough remains selective.",
      best_opportunity_surface: "Solana leading",
      participation_change: "Expanding selectively",
      reward_change: "Cleaner cohorts are following through",
    },
    markets: Array.from({ length: 8 }, (_, index) => ({
      last_price: 100 + index,
      day_change_pct: index < 5 ? 1 + index / 10 : -1 - index / 10,
      day_notional_volume_usd: 10_000_000 + index,
      open_interest_usd: 20_000_000 + index,
      funding_rate: 0.00001,
      observed_at: "2026-08-26T01:03:00Z",
    })),
    spotRows: [pool()],
    opportunityRows: [opportunity()],
    atlas: {
      generated_at: "2026-08-26T01:01:00Z",
      market_context: { risk_regime: "mixed", equity_regime: "up", participation_quality: "weak" },
    },
    timeframe: "5m",
  });
  assert.equal(frame.schema_version, "ravenos.discover_desk.v1");
  assert.ok(frame.cards.some((row) => row.key === "perp_breadth"));
  assert.ok(frame.cards.some((row) => row.key === "onchain_flow"));
  assert.ok(frame.cards.some((row) => row.key === "lifecycle"));
  assert.ok(frame.cards.some((row) => row.key === "cross_market"));
  assert.doesNotMatch(JSON.stringify(frame), /unknown|unavailable/i);
});
