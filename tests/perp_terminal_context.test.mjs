import assert from "node:assert/strict";
import test from "node:test";

import { buildPerpTerminalContext } from "../lib/perp_terminal_context.mjs";

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
  outcomes: { sample_size: 12, evidence_maturity: "forming", median_favorable_excursion_pct: 1.2, median_adverse_excursion_pct: -0.8 },
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
    marketPayload: { ok: true, schema_version: "ravenos.hyperliquid.instrument.v1" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.instrument.instrument_id, "hyperliquid:perp:SOL");
  assert.equal(result.raven_context.public_context_id, "perpctx_test");
  assert.equal(result.chart_event.event_id, "perpctx_test");
  assert.equal(result.matured_comparables.sample_size, 12);
  assert.equal(result.plan_preview.state, "research_only");
  assert.equal(result.plan_preview.executable, false);
  assert.equal(result.execution.signing_available, false);
  assert.equal(result.public_market_rows.length, 1);
});

test("missing Raven context remains explicitly unavailable without mock plan rows", () => {
  const result = buildPerpTerminalContext({
    symbol: "BTC-PERP",
    publicPerpsPayload: { data: { instrument_context: { rows: [] } } },
    marketPayload: { ok: true },
  });
  assert.equal(result.ok, true);
  assert.equal(result.raven_context.context_state, "unavailable");
  assert.equal(result.chart_event, null);
  assert.equal(result.plan_preview.state, "unavailable");
  assert.equal(result.plan_preview.executable, false);
});
