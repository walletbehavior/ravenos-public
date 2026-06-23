import assert from "node:assert/strict";
import {
  chainComparisonExplanation,
  explanationFor,
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
