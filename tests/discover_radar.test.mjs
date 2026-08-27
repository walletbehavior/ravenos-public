import test from "node:test";
import assert from "node:assert/strict";

import {
  DISCOVER_CLASSIFIER_VERSION,
  buildDiscoverRadarProjection,
  mergeExactRadarRows,
  validateDiscoverRadarProjection,
} from "../lib/discover_radar.mjs";

const OBSERVED_AT = "2026-08-27T02:00:00.000Z";
const NOW_MS = Date.parse(OBSERVED_AT);

function pool(overrides = {}) {
  const {
    market: _marketOverrides,
    registry: _registryOverrides,
    ...rowOverrides
  } = overrides;
  const poolAddress = overrides.pool_address || "0x0000000000000000000000000000000000000011";
  const chain = overrides.chain_id || "base";
  const marketOverrides = overrides.market || {};
  const registryOverrides = overrides.registry || {};
  const row = {
    public_attention_id: `fixture:${chain}:${poolAddress}`,
    instrument_id: `${chain}:pool:${poolAddress}`,
    source_type: "market_activity",
    discovery_source: "qualified_provider_projection",
    market_type: "spot",
    chain: chain === "robinhood" ? "Robinhood Chain" : chain[0].toUpperCase() + chain.slice(1),
    chain_id: chain,
    venue: "Fixture DEX",
    identity_scope: "exact_pool",
    symbol: overrides.symbol || "RADAR",
    name: overrides.name || "Radar Market",
    token_address: overrides.token_address || "0x0000000000000000000000000000000000000001",
    quote_token_address: overrides.quote_token_address || "0x0000000000000000000000000000000000000002",
    quote_symbol: "WETH",
    pool_address: poolAddress,
    observed_at: OBSERVED_AT,
    context_state: "current",
    market: {
      price_usd: 0.01,
      liquidity_usd: 120_000,
      market_cap_usd: 450_000,
      market_age_seconds: 30 * 86_400,
      price_change_5m_pct: 7,
      price_change_1h_pct: 12,
      volume_usd_5m: 40_000,
      volume_usd_1h: 180_000,
      buys_5m: 72,
      sells_5m: 28,
      buyers_5m: 54,
      sellers_5m: 21,
      buys_1h: 260,
      sells_1h: 140,
      buyers_1h: 180,
      sellers_1h: 110,
      liquidity_change_5m_pct: 2,
      ...marketOverrides,
    },
    registry: {
      state: "tracking",
      first_seen_at: "2026-08-27T00:00:00.000Z",
      last_seen_at: OBSERVED_AT,
      observation_count: 4,
      first_seen_market_cap_usd: 200_000,
      primary_behavior_state: "forming",
      admission_lanes: ["short_window_anomaly"],
      admission_reason: "Material short-window move",
      event_evidence_append_only: true,
      ...registryOverrides,
    },
    research_only: true,
    actionable: false,
    execution_available: false,
    ...rowOverrides,
  };
  row.market = { ...row.market, ...marketOverrides };
  row.registry = { ...row.registry, ...registryOverrides };
  row.instrument_id = `${row.chain_id}:pool:${row.pool_address}`;
  return row;
}

function build(rows, options = {}) {
  return buildDiscoverRadarProjection(rows, {
    timeframe: "5m",
    generatedAt: OBSERVED_AT,
    nowMs: NOW_MS,
    sourceState: "shadow",
    ...options,
  });
}

test("a mature 200K to 450K exact market is admitted as a breakout rather than excluded by age", () => {
  const result = build([pool()]);
  assert.equal(result.rows.length, 1);
  const discovery = result.rows[0].discovery;
  assert.equal(discovery.migration_cohort.value, "mature");
  assert.equal(discovery.primary_behavior_state.value, "breakout");
  assert.equal(Math.round(discovery.path.change_since_first_observation_pct), 125);
});

test("default opportunities require material server-qualified notability instead of relative rank alone", () => {
  const quiet = pool({
    pool_address: "0x0000000000000000000000000000000000000081",
    market: {
      price_change_5m_pct: 0.4,
      price_change_1h_pct: 1.8,
      price_change_24h_pct: 4.5,
    },
    registry: { first_seen_market_cap_usd: 450_000, primary_behavior_state: "forming" },
  });
  const material = pool({
    pool_address: "0x0000000000000000000000000000000000000082",
    market: {
      price_change_5m_pct: 1.2,
      price_change_1h_pct: 8,
      price_change_24h_pct: 74,
      volume_usd_24h: 900_000,
      buys_24h: 850,
      sells_24h: 640,
      buyers_24h: 410,
      sellers_24h: 330,
    },
    registry: { first_seen_market_cap_usd: 450_000, primary_behavior_state: "forming" },
  });
  const result = build([quiet, material]);
  const quietNotability = result.rows.find((row) => row.instrument_id === quiet.instrument_id).discovery.notability;
  const materialNotability = result.rows.find((row) => row.instrument_id === material.instrument_id).discovery.notability;
  assert.equal(quietNotability.qualified, false);
  assert.equal(quietNotability.default_opportunity_eligible, false);
  assert.equal(quietNotability.reason_code, "watch_only");
  assert.equal(materialNotability.qualified, true);
  assert.equal(materialNotability.default_opportunity_eligible, true);
  assert.equal(materialNotability.primary_trigger.window, "24h");
  assert.equal(materialNotability.primary_trigger.value_pct, 74);
  assert.equal(materialNotability.browser_derived, false);
  assert.equal(materialNotability.provider_rank_used, false);
});

test("an extreme provider move is surfaced for exact-chart verification rather than buried or asserted as confirmed", () => {
  const discovery = build([pool({
    pool_address: "0x0000000000000000000000000000000000000083",
    market: {
      price_change_5m_pct: 650,
      price_change_1h_pct: 700,
      price_change_24h_pct: 900,
      volume_usd_5m: 18_000,
      buys_5m: 18,
      sells_5m: 12,
      buyers_5m: 9,
      sellers_5m: 7,
    },
    registry: { observation_count: 1, first_seen_at: OBSERVED_AT, first_seen_market_cap_usd: 450_000 },
  })]).rows[0].discovery;
  assert.equal(discovery.notability.qualified, true);
  assert.equal(discovery.notability.primary_trigger.window, "5m");
  assert.equal(discovery.notability.verification_state, "exact_chart_required");
  assert.equal(discovery.primary_behavior_state.value, "forming");
  assert.equal(Object.hasOwn(discovery.notability, "thresholds"), false);
  assert.equal(Object.hasOwn(discovery.notability.primary_trigger, "threshold_pct"), false);
  assert.equal(Object.hasOwn(discovery.notability.primary_trigger, "threshold_multiple"), false);
  assert.match(discovery.decision_support.why_now, /first market update recorded/i);
  assert.doesNotMatch(discovery.decision_support.why_now, /registry|provider|classifier/i);
});

test("the selected-window move outranks a larger historical-window print while preserving exact-chart verification", () => {
  const selectedPool = pool({
    pool_address: "0x0000000000000000000000000000000000000084",
    market: {
      price_change_5m_pct: 7,
      price_change_1h_pct: 30,
      price_change_24h_pct: 900,
      volume_usd_5m: 18_000,
      buys_5m: 18,
      sells_5m: 12,
      buyers_5m: 9,
      sellers_5m: 7,
      volume_usd_24h: 900_000,
      buys_24h: 850,
      sells_24h: 640,
      buyers_24h: 410,
      sellers_24h: 330,
    },
  });
  const historicalPool = pool({
    pool_address: "0x0000000000000000000000000000000000000085",
    market: {
      price_change_5m_pct: 1,
      price_change_1h_pct: 30,
      price_change_24h_pct: 900,
      volume_usd_24h: 900_000,
      buys_24h: 850,
      sells_24h: 640,
      buyers_24h: 410,
      sellers_24h: 330,
    },
  });
  const result = build([selectedPool, historicalPool]);
  const selected = result.rows.find((row) => row.instrument_id === selectedPool.instrument_id).discovery.notability;
  const historical = result.rows.find((row) => row.instrument_id === historicalPool.instrument_id).discovery.notability;
  assert.equal(selected.primary_trigger.window, "5m");
  assert.equal(selected.primary_trigger.value_pct, 7);
  assert.equal(selected.verification_state, "exact_chart_required");
  assert.equal(selected.material_move_triggers.some((trigger) => trigger.window === "24h"), true);
  assert.equal(historical.primary_trigger.window, "24h");
  assert.ok(selected.priority > historical.priority);
});

test("zero market-cap falls back to available FDV without fabricating a collapse", () => {
  const result = build([pool({
    market: { market_cap_usd: 0, fdv_usd: 450_000 },
    registry: { first_seen_market_cap_usd: 200_000 },
  })]);
  const discovery = result.rows[0].discovery;
  assert.equal(Math.round(discovery.path.change_since_first_observation_pct), 125);
  assert.notEqual(discovery.primary_behavior_state.value, "capitulation");
});

test("an observed registry high is not presented as the market all-time high", () => {
  const withoutQualifiedAth = build([pool({
    registry: { recorded_high_distance_pct: -3, ath_distance_pct: null },
  })]).rows[0].discovery;
  assert.equal(withoutQualifiedAth.path.ath_distance_pct, null);
  assert.equal(withoutQualifiedAth.path.recorded_high_distance_pct, -3);
  assert.notEqual(withoutQualifiedAth.primary_behavior_state.value, "approaching_ath");

  const withQualifiedAth = build([pool({
    registry: { recorded_high_distance_pct: -3, ath_distance_pct: -3 },
  })]).rows[0].discovery;
  assert.equal(withQualifiedAth.primary_behavior_state.value, "approaching_ath");
});

test("a mature 1.2M to 1.55M continuation outranks a noisy divergent microcap", () => {
  const continuation = pool({
    pool_address: "0x0000000000000000000000000000000000000012",
    market: { market_cap_usd: 1_550_000, liquidity_usd: 260_000, price_change_5m_pct: 9 },
    registry: { first_seen_market_cap_usd: 1_200_000, primary_behavior_state: "continuation" },
  });
  const noisy = pool({
    pool_address: "0x0000000000000000000000000000000000000013",
    market: {
      market_cap_usd: 70_000,
      liquidity_usd: 3_000,
      price_change_5m_pct: 24,
      buys_5m: 15,
      sells_5m: 85,
      buyers_5m: 9,
      sellers_5m: 60,
      liquidity_change_5m_pct: -14,
    },
    registry: { first_seen_market_cap_usd: 65_000 },
  });
  const result = build([continuation, noisy]);
  const left = result.rows.find((row) => row.instrument_id === continuation.instrument_id);
  const right = result.rows.find((row) => row.instrument_id === noisy.instrument_id);
  assert.ok(left.discovery.velocity_state.score.score > right.discovery.velocity_state.score.score);
  assert.equal(left.discovery.primary_behavior_state.value, "continuation");
  assert.ok(right.discovery.risk_flags.some((flag) => flag.value === "liquidity_thinning"));
});

test("a post-migration collapse with old-bundle selling and new low accumulation becomes resurrection", () => {
  const row = pool({
    pool_address: "0x0000000000000000000000000000000000000014",
    migration_cohort: { value: "post_migration", source_scope: "launch_migration_event", observed_at: OBSERVED_AT, freshness: "current" },
    market: {
      price_change_5m_pct: 5,
      buyers_5m: 70,
      sellers_5m: 20,
      buyers_1h: 120,
      sellers_1h: 80,
    },
    registry: { max_drawdown_since_first_pct: -82 },
    control_intelligence: {
      availability: "available",
      observed_at: OBSERVED_AT,
      freshness: "current",
      original_bundle_selling: true,
      new_bundle_accumulation: true,
      bundled_pct: 31,
      bundle_change_pct: -4,
      display_policy: {
        reviewed: true,
        customer_display_allowed: true,
        provider: "qualified_fixture",
        product: "bundle classification",
        reviewed_at: OBSERVED_AT,
      },
    },
  });
  const discovery = build([row]).rows[0].discovery;
  assert.equal(discovery.primary_behavior_state.value, "post_dump_resurrection");
  assert.equal(discovery.control_intelligence.original_bundle_selling.value, true);
  assert.equal(discovery.control_intelligence.new_bundle_accumulation.value, true);
});

test("a 25 percent move with distribution and thinning liquidity is capped and labeled as distribution", () => {
  const row = pool({
    pool_address: "0x0000000000000000000000000000000000000015",
    market: {
      price_change_5m_pct: 25,
      buys_5m: 30,
      sells_5m: 70,
      buyers_5m: 20,
      sellers_5m: 55,
      liquidity_change_5m_pct: -12,
    },
  });
  const discovery = build([row]).rows[0].discovery;
  assert.equal(discovery.primary_behavior_state.value, "distribution");
  assert.ok(discovery.risk_flags.some((flag) => flag.value === "late_chase"));
  assert.ok(discovery.risk_flags.some((flag) => flag.value === "liquidity_thinning"));
  assert.equal(discovery.velocity_state.score.score_cap, 66);
  assert.match(discovery.velocity_state.score.score_cap_reason, /extended/);
  assert.ok(discovery.velocity_state.score.penalties.some((penalty) => penalty.explanation === "Chase-risk penalty applied"));
});

test("falling price with strengthening unique-buy participation is absorption", () => {
  const row = pool({
    pool_address: "0x0000000000000000000000000000000000000016",
    market: {
      price_change_5m_pct: -5,
      price_change_1h_pct: -8,
      buyers_5m: 70,
      sellers_5m: 20,
      buyers_1h: 120,
      sellers_1h: 100,
      buys_5m: 68,
      sells_5m: 32,
      buys_1h: 230,
      sells_1h: 170,
    },
  });
  const discovery = build([row]).rows[0].discovery;
  assert.equal(discovery.primary_behavior_state.value, "sell_pressure_absorption");
  assert.equal(discovery.activity_state.value, "absorption");
});

test("failed breakouts and recorded-range reclaims remain distinct lifecycle states", () => {
  const failed = pool({
    pool_address: "0x0000000000000000000000000000000000000061",
    market: {
      price_change_5m_pct: -11,
      buys_5m: 28,
      sells_5m: 72,
      buyers_5m: 18,
      sellers_5m: 54,
    },
    registry: { primary_behavior_state: "breakout", first_seen_market_cap_usd: 450_000 },
  });
  const reclaim = pool({
    pool_address: "0x0000000000000000000000000000000000000062",
    market: { price_change_5m_pct: 7 },
    registry: { max_drawdown_since_first_pct: -32, first_seen_market_cap_usd: 450_000 },
  });
  const result = build([failed, reclaim]);
  assert.equal(result.rows.find((row) => row.instrument_id === failed.instrument_id).discovery.primary_behavior_state.value, "failed_breakout");
  assert.equal(result.rows.find((row) => row.instrument_id === reclaim.instrument_id).discovery.primary_behavior_state.value, "reclaiming_range");
});

test("cold start with one actual observation withholds acceleration and lifecycle scoring", () => {
  const row = pool({
    pool_address: "0x0000000000000000000000000000000000000063",
    registry: { observation_count: 1, first_seen_at: OBSERVED_AT, first_seen_market_cap_usd: 450_000 },
  });
  const discovery = build([row]).rows[0].discovery;
  assert.equal(discovery.primary_behavior_state.value, "forming");
  assert.equal(discovery.measurements.historical_window_coverage.state, "insufficient_history");
  assert.equal(discovery.measurements.price_acceleration.value, null);
  assert.equal(discovery.velocity_state.score.availability, "insufficient_history");
});

test("a retained stale market re-baselines after a classifier change instead of preserving an obsolete state", () => {
  const row = pool({
    observed_at: "2026-08-26T23:00:00.000Z",
    context_state: "stale",
    registry: {
      retained_after_trending: true,
      primary_behavior_state: "ath_breakout",
      classifier_version: "2026-08-27.1",
      ath_distance_pct: null,
    },
  });
  const discovery = build([row]).rows[0].discovery;
  assert.equal(discovery.primary_behavior_state.value, "forming");
  assert.match(discovery.primary_behavior_state.explanation, /market model changed/i);
  assert.doesNotMatch(discovery.primary_behavior_state.explanation, /classifier|registry|provider/i);
});

test("activity ranking responds to acceleration rather than equal absolute volume", () => {
  const accelerating = pool({
    pool_address: "0x0000000000000000000000000000000000000017",
    market: { volume_usd_5m: 50_000, volume_usd_1h: 90_000, buys_5m: 80, sells_5m: 20, buys_1h: 150, sells_1h: 100 },
  });
  const decelerating = pool({
    pool_address: "0x0000000000000000000000000000000000000018",
    market: { volume_usd_5m: 50_000, volume_usd_1h: 600_000, buys_5m: 50, sells_5m: 50, buys_1h: 600, sells_1h: 600 },
  });
  const result = build([accelerating, decelerating]);
  const up = result.rows.find((row) => row.instrument_id === accelerating.instrument_id);
  const down = result.rows.find((row) => row.instrument_id === decelerating.instrument_id);
  assert.ok(up.discovery.activity_state.score.score > down.discovery.activity_state.score.score);
});

test("provider-only rows can never become Raven signals", () => {
  const row = build([pool()]).rows[0];
  assert.equal(row.raven_signal, false);
  assert.equal(row.discovery.raven_evidence_state.qualified, false);
  assert.equal(row.discovery.raven_evidence_state.provider_rank_used, false);
  assert.equal(row.discovery.raven_evidence_state.velocity_score_used, false);
});

test("missing bundle and holder evidence remains unavailable rather than zero", () => {
  const control = build([pool()]).rows[0].discovery.control_intelligence;
  assert.equal(control.availability, "unavailable");
  assert.equal(control.bundled_pct.availability, "unavailable");
  assert.equal(control.bundled_pct.value, null);
  assert.equal(control.top_holder_concentration_pct.value, null);
});

test("retained candidates and same-symbol pools preserve exact identities", () => {
  const left = pool({ pool_address: "0x0000000000000000000000000000000000000019", symbol: "SAME" });
  const right = pool({ pool_address: "0x0000000000000000000000000000000000000020", symbol: "SAME" });
  const result = build([left, right]);
  assert.equal(result.rows.length, 2);
  assert.equal(new Set(result.rows.map((row) => row.instrument_id)).size, 2);
  assert.equal(mergeExactRadarRows(result.rows).length, 2);
});

test("Solana, Robinhood Chain, Base, BNB and Ethereum use the same classifier semantics", () => {
  const rows = ["solana", "robinhood", "base", "bsc", "ethereum"].map((chain, index) => pool({
    chain_id: chain,
    pool_address: `${chain === "solana" ? "pool" : "0x"}${String(index + 30).padStart(chain === "solana" ? 20 : 40, "0")}`,
    token_address: `${chain === "solana" ? "token" : "0x"}${String(index + 1).padStart(chain === "solana" ? 20 : 40, "0")}`,
    quote_token_address: `${chain === "solana" ? "quote" : "0x"}${String(index + 10).padStart(chain === "solana" ? 20 : 40, "0")}`,
  }));
  const result = build(rows);
  assert.equal(result.rows.length, 5);
  assert.deepEqual(new Set(result.rows.map((row) => row.discovery.primary_behavior_state.classifier.version)), new Set([DISCOVER_CLASSIFIER_VERSION]));
});

test("score contract is explicit, bounded and never a confidence or probability code", () => {
  const score = build([pool()]).rows[0].discovery.velocity_state.score;
  assert.equal(score.score_kind, "velocity_ranking");
  assert.equal(score.scale_max, 99);
  assert.ok(score.score >= 0 && score.score <= 99);
  assert.match(score.grade, /^[ABCD]$/);
  assert.equal(score.classifier_version, DISCOVER_CLASSIFIER_VERSION);
  assert.equal(score.raven_confidence, false);
  assert.equal(score.win_probability, false);
  assert.equal(score.calibrated_alpha, false);
  assert.ok(score.components.some((component) => component.label === "Participant acceleration"));
});

test("the complete radar projection validates and remains monitor-ineligible", () => {
  const result = build([pool()]);
  const validated = validateDiscoverRadarProjection(result, { nowMs: NOW_MS });
  assert.ok(validated);
  assert.equal(validated.classifier.monitor_eligible, false);
  assert.equal(validated.monitor_safety.classifier_version_change_action, "rebaseline_without_notification");
  assert.equal(validated.monitor_safety.external_notifications_enabled, false);
  assert.equal(validated.state, "forming");
  assert.equal(validated.classifier.evaluation_state, "forming");
  assert.equal("shadow_evaluation" in validated.classifier, false);
});
