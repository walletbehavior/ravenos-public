import assert from "node:assert/strict";
import {
  chainComparisonExplanation,
  explanationFor,
  explanationForMetric,
  heatmapExplanation,
  normalizeExplanation,
  researchExplanation,
  scoreBreakdown,
  structureTapeItems,
} from "../lib/ravenos_explanations.mjs";

const sol = {
  asset: "SOL",
  chainVenue: "Solana",
  flowScore: 88,
  attentionVelocity: 22,
  participantActivity: "High",
  liquidityPosture: "Stable depth",
  participationOutcome: "Paying",
  risk: "Watch",
  lastUpdated: "2m ago",
};

const base = {
  asset: "DEGEN",
  chainVenue: "Base",
  flowScore: 67,
  attentionVelocity: 19,
  participantActivity: "High",
  liquidityPosture: "Thin",
  participationOutcome: "Mixed",
  risk: "Elevated",
  lastUpdated: "9m ago",
};

const breakdown = scoreBreakdown(sol);
assert.ok(breakdown.some((item) => item.label === "participation breadth" && item.value > 0));
assert.ok(breakdown.some((item) => item.label === "confirmation quality" && item.value < 0));

const explanation = explanationFor(sol);
assert.equal(explanation.headline, "Constructive structure");
assert.ok(explanation.summary.includes("Constructive structure"));
assert.ok(explanation.confidence >= 60);
assert.ok(explanation.positives.length >= 3);
assert.ok(explanation.evidence.some((item) => item.includes("Flow score")));

const comparison = chainComparisonExplanation([sol, base], "Solana", "Base");
assert.equal(comparison.headline, "Solana stronger than Base");
assert.ok(comparison.evidence.length >= 2);

const tape = structureTapeItems([sol, base], "crypto heatmaps");
assert.equal(tape.length, 3);
assert.ok(tape[0].title.includes("leads"));

const pressure = explanationForMetric("pressure_score", {
  pressureScore: 82,
  pressureState: "Crowded",
  participantActivity: "High",
  risk: "Elevated",
  coverage: "Live",
});
assert.match(pressure.headline, /Pressure Score/);
assert.ok(pressure.risks.length >= 1);
assert.ok(pressure.breakdown.length >= 4);
assert.equal(pressure.coverage, "Live");

const replay = explanationForMetric("replay_similarity", {
  replaySimilarity: 76,
  sampleCount: 12,
  profitFactor: 1.18,
  coverage: "Research",
});
assert.ok(replay.evidence.some((item) => item.includes("Replay sample count")));
assert.ok(replay.risks.some((item) => item.includes("sample")));

const heatmap = heatmapExplanation({
  flowScore: 78,
  freshSurvival: 70,
  attentionVelocity: 18,
  chainVenue: "Solana",
  marketCapBand: "micro",
  coverage: "Public fallback",
});
assert.match(heatmap.headline, /heatmap cell/i);
assert.ok(heatmap.positives.length >= 2);

const research = researchExplanation({
  status: "candidate",
  sampleCount: 55,
  profitFactor: 1.24,
  avgNet: 0.12,
  replayBand: "50-65",
});
assert.ok(research.positives.length >= 3);
assert.ok(research.evidence.some((item) => item.includes("Sample count")));

assert.equal(normalizeExplanation({ confidence: 999 }).confidence, 100);
