import assert from "node:assert/strict";
import test from "node:test";

import { buildLivePerpRead, buildPerpTerminalContext } from "../lib/perp_terminal_context.mjs";
import { createEvidenceBoundPlanPreview } from "../lib/customer_trade/suggested_plan.mjs";

const context = {
  public_context_id: "perpctx_test",
  instrument_id: "hyperliquid:perp:SOL",
  instrument: "SOL-PERP",
  context_available: true,
  context_state: "fresh",
  observed_at: "2026-07-21T10:00:00Z",
  observed_side: "long",
  behavior_family: "Compression release",
  pressure_state: "Bid-side pressure visible",
  why_raven_noticed: "Raven froze a compression release observation.",
  entry_reference: { price: 100, observed_at: "2026-07-21T10:00:00Z", source: "decision-time mark" },
  outcomes: { sample_size: 32, evidence_maturity: "developing", median_favorable_excursion_pct: 1.2, median_adverse_excursion_pct: -0.8 },
  plan_preview: { state: "research_only", production_qualified: false, personalized: false, executable: false },
};

test("selected perp context joins exact Raven evidence to live market state", () => {
  const result = buildPerpTerminalContext({
    symbol: "SOL",
    publicPerpsPayload: {
      data: {
        instrument_context: { rows: [context] },
        tables: { top_volume: [{ symbol: "SOL-PERP", pressure_state: "Bid-side pressure visible" }] },
      },
    },
    marketPayload: {
      ok: true,
      schema_version: "ravenos.hyperliquid.instrument.v1",
      generated_at: "2026-07-21T10:00:03Z",
      book: {
        observed_at: "2026-07-21T10:00:03Z",
        bids: [{ price: 99.9, notional_usd: 5_000 }, { price: 99.8, notional_usd: 3_000 }],
        asks: [{ price: 100.1, notional_usd: 4_000 }, { price: 100.2, notional_usd: 2_000 }],
      },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.instrument.instrument_id, "hyperliquid:perp:SOL");
  assert.equal(result.raven_context.public_context_id, "perpctx_test");
  assert.equal(result.chart_event.event_id, "perpctx_test");
  assert.equal(result.chart_event.inspection.source_evidence.public_reference, "perpctx_test");
  assert.equal(result.chart_event.inspection.evidence_maturity, "developing");
  assert.equal(result.chart_event.inspection.path_transition.behavior, "Compression release");
  assert.equal(result.chart_event.inspection.historical_outcome.sample_size, 32);
  assert.ok(result.chart_event.inspection.support.length > 0);
  assert.ok(result.chart_event.inspection.contradiction.length > 0);
  assert.equal(result.matured_comparables.sample_size, 32);
  assert.equal(result.plan_preview.state, "research_only");
  assert.equal(result.plan_preview.levels.entry_reference.price, 100);
  assert.equal(result.plan_preview.levels.target_reference.price, 101.2);
  assert.equal(result.plan_preview.levels.risk_reference.price, 99.2);
  assert.equal(result.plan_preview.executable, false);
  assert.equal(result.plan_preview.enabled_by_default, false);
  assert.equal(result.chart_overlays.role, "annotation_only");
  assert.equal(result.chart_overlays.candle_replacement_allowed, false);
  assert.deepEqual(result.chart_overlays.overlays.map((row) => row.type), [
    "liquidity-zone",
    "liquidity-zone",
    "plan-entry",
    "plan-target",
    "plan-risk",
  ]);
  assert.equal(result.execution.signing_available, false);
  assert.equal(result.public_market_rows.length, 1);
});

test("a current Hyperliquid read remains available when no retained Raven decision history exists", () => {
  const result = buildPerpTerminalContext({
    symbol: "BTC-PERP",
    publicPerpsPayload: { data: { instrument_context: { rows: [] } } },
    marketPayload: {
      ok: true,
      generated_at: "2026-07-21T10:00:03Z",
      market: {
        mark_price: 66_000,
        oracle_price: 65_980,
        previous_day_price: 64_500,
        funding_rate: -0.00012,
        open_interest_usd: 1_800_000_000,
        day_notional_volume_usd: 4_200_000_000,
      },
      book: {
        observed_at: "2026-07-21T10:00:03Z",
        bids: [{ price: 65_995, size: 10, notional_usd: 659_950 }],
        asks: [{ price: 66_005, size: 4, notional_usd: 264_020 }],
        summary: { best_bid: 65_995, best_ask: 66_005, spread_bps: 1.5152, imbalance_pct: 42.85 },
      },
      tape: {
        trades: [
          { book_side: "bid", price: 66_001, size: 2, notional_usd: 132_002, observed_at: "2026-07-21T10:00:03Z" },
          { book_side: "ask", price: 65_999, size: 0.5, notional_usd: 32_999.5, observed_at: "2026-07-21T10:00:02Z" },
        ],
      },
      components: { market: "fresh", book: "fresh", tape: "fresh" },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.raven_context.context_state, "unavailable");
  assert.equal(result.live_market_read.schema_version, "ravenos.perp_live_read.v1");
  assert.equal(result.live_market_read.state, "current");
  assert.equal(result.live_market_read.signal_state, "upside_squeeze_pressure");
  assert.equal(result.live_market_read.directional_bias, "long");
  assert.equal(result.live_market_read.input_count, 6);
  assert.equal(result.raven_read.role, "live_market_read");
  assert.match(result.raven_read.headline, /Upside squeeze pressure/);
  assert.equal(result.decision_history_read, null);
  assert.equal(result.chart_event, null);
  assert.equal(result.plan_preview.state, "unavailable");
  assert.equal(result.plan_preview.executable, false);
  assert.deepEqual(result.chart_overlays.overlays.map((row) => row.type), ["liquidity-zone", "liquidity-zone"]);
  assert.equal(result.execution.signing_available, false);
  assert.equal(result.execution.submission_available, false);
});

test("live perp read calls price and flow disagreement a divergence instead of a directional setup", () => {
  const read = buildLivePerpRead({
    instrument: "ETH-PERP",
    marketPayload: {
      generated_at: "2026-07-21T10:00:03Z",
      market: { mark_price: 3_200, oracle_price: 3_199, previous_day_price: 3_100, funding_rate: 0.00001, open_interest_usd: 900_000_000, day_notional_volume_usd: 1_800_000_000 },
      book: { bids: [{ price: 3_199, notional_usd: 100_000 }], asks: [{ price: 3_201, notional_usd: 400_000 }], summary: { best_bid: 3_199, best_ask: 3_201 } },
      tape: { trades: [{ book_side: "ask", price: 3_199, notional_usd: 250_000, observed_at: "2026-07-21T10:00:03Z" }] },
    },
  });
  assert.equal(read.signal_state, "flow_divergence");
  assert.equal(read.directional_bias, "neutral");
  assert.match(read.why_raven_noticed, /disagree/);
});

test("short plan references retain directional favorable and adverse semantics", () => {
  const plan = createEvidenceBoundPlanPreview({
    ...context,
    public_context_id: "perpctx_short",
    observed_side: "short",
    entry_reference: { price: 200, observed_at: context.observed_at, source: "decision-time mark" },
  });
  assert.equal(plan.state, "research_only");
  assert.equal(plan.levels.target_reference.price, 197.6);
  assert.equal(plan.levels.risk_reference.price, 201.6);
  assert.equal(plan.executable, false);
});

test("forming samples do not produce target or risk levels", () => {
  const plan = createEvidenceBoundPlanPreview({
    ...context,
    outcomes: {
      ...context.outcomes,
      sample_size: 12,
      evidence_maturity: "forming",
    },
  });
  assert.equal(plan.state, "unavailable");
  assert.equal(plan.levels, null);
  assert.equal(plan.signing_available, false);
  assert.equal(plan.submission_available, false);
});
