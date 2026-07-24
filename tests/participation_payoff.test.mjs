import assert from "node:assert/strict";
import test from "node:test";

import { buildParticipationPayoffProjection } from "../lib/participation_payoff.mjs";

const GENERATED_AT = "2026-07-24T22:39:50Z";

function behaviorRow(chain, capBand, derivedState, usableSample, confidence = "high", window = "24h") {
  return {
    chain,
    cap_band: capBand,
    derived_state: derivedState,
    usable_sample: usableSample,
    observed_sample: usableSample + 7,
    confidence,
    public_safe: true,
    window,
    private_wallets: ["must-not-project"],
    internal_threshold: 0.42,
  };
}

function outcomeRow(chain, capBand, medianH6, usableSample, window = "24h") {
  return {
    chain,
    cap_band: capBand,
    window,
    median_h6_move_pct: medianH6,
    usable_sample: usableSample,
    public_safe: true,
    claim_id: `claim_${chain}_${capBand}`,
    evidence_contract: {
      observation_window: { label: window },
      settlement_window: { label: "6h post-observation measurement" },
    },
    raw_provider_payload: { secret: true },
  };
}

test("participation payoff selects mature rewarded and punished surfaces without exposing source rows", () => {
  const behavior = {
    generated_at: GENERATED_AT,
    rows: [
      behaviorRow("solana", "participant_cohorts", "participation rewarding", 788, "medium", "live"),
      behaviorRow("hyperliquid", "perps_all", "participation rewarding", 177, "high", "live"),
      behaviorRow("hyperliquid", "perps_alts", "participation rewarding", 163, "high", "live"),
      behaviorRow("solana", "fresh_pairs", "participation punishing", 21, "medium"),
      behaviorRow("eth", "large", "participation punishing", 33, "medium"),
      behaviorRow("base", "large", "participation punishing", 51),
      behaviorRow("eth", "participant_cohorts", "outcomes unclear", 36, "medium", "live"),
      behaviorRow("base", "participant_cohorts", "outcomes unclear", 59, "medium", "live"),
      behaviorRow("solana", "live_activity", "participation rewarding", 320_241),
      behaviorRow("robinhood", "mid", "participation rewarding", 5, "low"),
    ],
  };
  const outcomes = {
    generated_at: GENERATED_AT,
    outcomes: [
      {
        ...outcomeRow("solana", "participant_cohorts", null, 788, "live"),
        source: "jupiter_helius_public_cohort_validation",
        median_mfe_pct: 84.25,
      },
      {
        ...outcomeRow("hyperliquid", "perps_all", null, 177, "live"),
        source: "hyperliquid_public_perps_context",
      },
      { ...outcomeRow("solana", "fresh_pairs", 6.63, 21), punishing_pct: 42.86 },
      outcomeRow("eth", "large", -1.34, 33),
      outcomeRow("base", "large", -0.63, 51),
    ],
  };

  const projection = buildParticipationPayoffProjection(outcomes, behavior);
  assert.equal(projection.schema_version, "ravenos.participation_payoff.v1");
  assert.equal(projection.state, "current");
  assert.equal(projection.public_safe, true);
  assert.equal(projection.measurement.causal_claim, false);
  assert.deepEqual(
    projection.insights.map((row) => [row.state, row.subject]),
    [
      ["rewarding", "Solana cohorts"],
      ["fragile", "Solana fresh pairs"],
      ["punishing", "Ethereum large caps"],
    ],
  );
  assert.equal(projection.headline, "Participation payoff");
  assert.equal(projection.summary, "Solana cohorts lead. Solana fresh pairs are split. Ethereum large caps are punishing.");
  assert.equal(projection.measurement.display_window, "Latest samples");
  assert.equal(projection.comparison, "Solana cohorts have settled follow-through; Ethereum cohorts and Base cohorts remain mixed.");
  assert.equal(projection.insights[0].observation_window, "current");
  assert.equal(projection.insights[1].six_hour_median_pct, 6.63);
  assert.equal(projection.insights[1].operator_detail, "6h median +6.6% · 43% fell 10%+ over 24h");
  assert.equal(projection.insights[2].six_hour_median_pct, -1.34);
  assert.equal(JSON.stringify(projection).includes("must-not-project"), false);
  assert.equal(JSON.stringify(projection).includes("raw_provider_payload"), false);
  assert.equal(JSON.stringify(projection).includes("internal_threshold"), false);
  assert.equal(JSON.stringify(projection).includes("live_activity"), false);
});

test("participation payoff hides itself when no segment clears maturity and confidence gates", () => {
  const projection = buildParticipationPayoffProjection(
    { generated_at: GENERATED_AT, outcomes: [] },
    {
      generated_at: GENERATED_AT,
      rows: [
        behaviorRow("solana", "fresh_pairs", "participation rewarding", 19, "high"),
        behaviorRow("eth", "large", "participation punishing", 100, "low"),
        { ...behaviorRow("base", "large", "participation punishing", 100), public_safe: false },
      ],
    },
  );
  assert.equal(projection, null);
});
