import test from "node:test";
import assert from "node:assert/strict";

import {
  bestExactSpotMarketPerToken,
  buildDeskFrame,
  opportunityLifecycle,
  spotFlowRead,
  spotMarketHealth,
  spotVelocityRead,
  validateAttentionBenchmark,
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

function exactPool(overrides = {}) {
  const chain = overrides.chain_id || "base";
  const poolAddress = overrides.pool_address || "0x0000000000000000000000000000000000000011";
  return {
    chain_id: chain,
    token_address: overrides.token_address || "0x0000000000000000000000000000000000000001",
    pool_address: poolAddress,
    instrument_id: `${chain}:pool:${poolAddress}`,
    symbol: overrides.symbol || "SAME",
    context_state: overrides.context_state || "current",
    observed_at: overrides.observed_at || "2026-08-26T01:00:00Z",
    market: {
      liquidity_usd: overrides.liquidity_usd ?? 100_000,
      volume_usd_5m: overrides.volume_usd_5m ?? 10_000,
    },
    discovery: {
      facts: { freshness: { state: overrides.freshness || "current" } },
      routeability: overrides.routeability || { availability: "unavailable", freshness: "unavailable", routeable_size_usd: null },
    },
  };
}

test("Discover keeps one best exact pool per canonical chain/token", () => {
  const shallower = exactPool({
    pool_address: "0x0000000000000000000000000000000000000012",
    token_address: "0xAbCd000000000000000000000000000000000001",
    liquidity_usd: 80_000,
  });
  const deeper = exactPool({
    pool_address: "0x0000000000000000000000000000000000000013",
    token_address: "0xabcd000000000000000000000000000000000001",
    liquidity_usd: 240_000,
  });
  const selected = bestExactSpotMarketPerToken([shallower, deeper]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].instrument_id, deeper.instrument_id);
  assert.equal(selected[0].market.liquidity_usd, 240_000);
});

test("Discover prefers a current executable route without merging exact-pool evidence", () => {
  const deepButUnrouteable = exactPool({
    pool_address: "0x0000000000000000000000000000000000000014",
    liquidity_usd: 500_000,
  });
  const routeable = exactPool({
    pool_address: "0x0000000000000000000000000000000000000015",
    liquidity_usd: 120_000,
    routeability: { availability: "available", freshness: "current", routeable_size_usd: 5_000 },
  });
  const selected = bestExactSpotMarketPerToken([deepButUnrouteable, routeable]);
  assert.deepEqual(selected, [routeable]);
  assert.equal(selected[0].market.liquidity_usd, 120_000);
});

test("Discover never collapses same-symbol contracts or cross-chain assets", () => {
  const rows = [
    exactPool({ token_address: "0x0000000000000000000000000000000000000001", symbol: "PONS" }),
    exactPool({ token_address: "0x0000000000000000000000000000000000000002", pool_address: "0x0000000000000000000000000000000000000022", symbol: "PONS" }),
    exactPool({ chain_id: "ethereum", token_address: "0x0000000000000000000000000000000000000001", pool_address: "0x0000000000000000000000000000000000000033", symbol: "PONS" }),
  ];
  assert.equal(bestExactSpotMarketPerToken(rows).length, 3);
});

function benchmark(overrides = {}) {
  const generatedAt = "2026-08-26T21:25:20Z";
  return {
    attention_benchmark: {
      schema_version: "ravenos_market_attention_benchmark_public_v1",
      generated_at: generatedAt,
      freshness: { state: "current", age_seconds: 743, target_seconds: 3_600 },
      public_safety: {
        market_addresses_exposed: false,
        participant_identities_exposed: false,
        private_lineage_exposed: false,
        raw_reference_payloads_exposed: false,
        reference_source_identity_exposed: false,
      },
      interpretation: {
        headline: "Raven frequently observed the market before broader attention arrived.",
        scope: "Descriptive timing overlap in the retained benchmark only.",
        profitability_claimed: false,
        selected_instrument_claimed: false,
        tradeable_rule_claimed: false,
      },
      reference_scope: {
        episode_count: 3_799,
        distinct_markets: 3_460,
        label: "Third-party market-attention episodes",
        deduplication: "Exact chain and market identity within a thirty-minute attention session",
      },
      raven_lead: {
        observation: { episodes: 745, label: "Raven observation", median_lead_seconds: 2_206.45, share_of_reference_episodes: 745 / 3_799 },
        behavior: { episodes: 555, label: "Behavioral change", median_lead_seconds: 8_259.73, share_of_reference_episodes: 555 / 3_799 },
        exact_decision_context: { episodes: 109, label: "Exact market and friction context", median_lead_seconds: 3_872, share_of_reference_episodes: 109 / 3_799 },
      },
      ...overrides,
    },
  };
}

test("attention benchmark passes only as a current, complete, public-safe descriptive contract", () => {
  const result = validateAttentionBenchmark(benchmark(), { nowMs: Date.parse("2026-08-26T21:37:43Z") });
  assert.equal(result.referenceEpisodes, 3_799);
  assert.equal(result.distinctMarkets, 3_460);
  assert.equal(result.observation.episodes, 745);
  assert.equal(Math.round(result.observation.medianLeadSeconds / 60), 37);
  assert.equal(result.behavior.episodes, 555);
  assert.equal(result.exactDecisionContext.episodes, 109);
});

test("attention benchmark fails closed when stale, incomplete, unsafe, or framed as a trading claim", () => {
  const nowMs = Date.parse("2026-08-26T21:37:43Z");
  assert.equal(validateAttentionBenchmark(benchmark({
    freshness: { state: "stale", age_seconds: 7_200, target_seconds: 3_600 },
  }), { nowMs }), null);
  assert.equal(validateAttentionBenchmark(benchmark({ raven_lead: { observation: null } }), { nowMs }), null);
  assert.equal(validateAttentionBenchmark(benchmark({
    public_safety: {
      market_addresses_exposed: false,
      participant_identities_exposed: true,
      private_lineage_exposed: false,
      raw_reference_payloads_exposed: false,
      reference_source_identity_exposed: false,
    },
  }), { nowMs }), null);
  assert.equal(validateAttentionBenchmark(benchmark({
    interpretation: {
      profitability_claimed: true,
      selected_instrument_claimed: false,
      tradeable_rule_claimed: false,
    },
  }), { nowMs }), null);
});

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

test("directionless evidence remains watch-only and cannot enter the setup queue", () => {
  const read = opportunityLifecycle(opportunity({
    observed_direction: "unavailable",
    raven_atoms: [],
    matured_comparables: {
      sample_size: 0,
      evidence_maturity: "unavailable",
      positive_followthrough_rate: null,
      median_favorable_excursion_pct: null,
      median_adverse_excursion_pct: null,
    },
  }));
  assert.equal(read.state, "watch");
  assert.equal(read.label, "Watch");
  assert.equal(read.quality, "Watch only");
  assert.equal(read.promoted, false);
  assert.ok(read.score <= 34);
  assert.doesNotMatch(JSON.stringify(read), /unknown|unavailable/i);
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

test("velocity alpha rewards confirmed multi-window flow instead of price movement alone", () => {
  const alignedPool = pool();
  alignedPool.market.price_change_5m_pct = 6.2;
  const aligned = spotVelocityRead(alignedPool, "5m");
  const hollow = pool();
  hollow.market.price_change_5m_pct = 18;
  hollow.market.price_change_1h_pct = -4;
  hollow.market.price_change_24h_pct = 6;
  hollow.market.buys_5m = 18;
  hollow.market.sells_5m = 74;
  hollow.market.buyers_5m = 12;
  hollow.market.sellers_5m = 58;
  const divergent = spotVelocityRead(hollow, "5m");
  assert.equal(aligned.state, "upside_confirmed");
  assert.equal(aligned.flow_aligned, true);
  assert.equal(aligned.confirmed_windows, 3);
  assert.equal(aligned.qualified, true);
  assert.ok(aligned.score > divergent.score);
  assert.equal(divergent.state, "flow_divergence");
  assert.match(divergent.label, /divergence/i);
});

test("Robinhood velocity admits an early flow breakout only when participation and depth confirm it", () => {
  const robinhood = pool({
    chain_id: "robinhood",
    source_type: "market_activity",
    provider_rank: 1,
  });
  robinhood.market.price_change_5m_pct = 1.8;
  const read = spotVelocityRead(robinhood, "5m");
  assert.equal(read.qualified, true);
  assert.equal(read.admission_reason, "robinhood_flow_breakout");
  assert.equal(read.flow_aligned, true);
  assert.ok(read.flow.transaction_count >= 80);

  const unconfirmed = structuredClone(robinhood);
  unconfirmed.market.buys_5m = 12;
  unconfirmed.market.sells_5m = 9;
  unconfirmed.market.buyers_5m = 10;
  unconfirmed.market.sellers_5m = 8;
  const rejected = spotVelocityRead(unconfirmed, "5m");
  assert.equal(rejected.qualified, false);
  assert.equal(rejected.admission_reason, "below_interest_gate");
});

test("velocity alpha labels chase risk and omits fragile pools from qualification", () => {
  const extended = pool();
  extended.market.price_change_5m_pct = 42;
  extended.market.price_change_1h_pct = 110;
  extended.market.price_change_24h_pct = 540;
  const chase = spotVelocityRead(extended, "5m");
  assert.equal(chase.chase_risk, true);
  assert.equal(chase.state, "chase_risk");
  assert.match(chase.detail, /chase risk/i);

  const thin = pool();
  thin.market.liquidity_usd = 900;
  thin.market.volume_usd_24h = 120;
  const fragile = spotVelocityRead(thin, "5m");
  assert.equal(fragile.qualified, false);
  assert.doesNotMatch(JSON.stringify(fragile), /unknown|unavailable|missing/i);
});

test("desk frame fuses live markets, flows, lifecycle, and Atlas without empty-language cards", () => {
  const classifiedSpot = pool();
  classifiedSpot.discovery = {
    schema_version: "ravenos.discover_market.v1",
    measurements: { timeframe: "5m" },
    activity_state: { value: "accumulation" },
  };
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
    spotRows: [classifiedSpot],
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

test("desk frame never presents unclassified pool flow as zero buy-side and zero sell-side", () => {
  const unclassifiedSpot = pool();
  unclassifiedSpot.discovery = {
    schema_version: "ravenos.discover_market.v1",
    measurements: { timeframe: "5m" },
    activity_state: { value: "insufficient_history" },
  };
  const frame = buildDeskFrame({ spotRows: [unclassifiedSpot], timeframe: "5m" });
  const flow = frame.cards.find((row) => row.key === "onchain_flow");
  assert.equal(flow.value, "Direction not established");
  assert.match(flow.detail, /No directional pool reads/);
  assert.match(flow.detail, /\$18K 5m volume/);
  assert.doesNotMatch(flow.detail, /0 buy-side|0 sell-side|Flow is balanced/);
});
