import assert from "node:assert/strict";
import {
  compactOutcomeDistribution,
  normalizeOutcomeDistribution,
  replayBand,
  replayOutcomeSummary,
  sampleSufficiency,
  similarStructures,
} from "../lib/ravenos_replay_outcomes.mjs";

assert.equal(replayBand(84), "80-100");
assert.equal(replayBand(61), "50-65");
assert.equal(sampleSufficiency(12).label, "thin");
assert.equal(sampleSufficiency(55).sufficient, true);

const distribution = normalizeOutcomeDistribution({ expansion: 2, continuation: 2, reversal: 1, failure: 0 });
assert.equal(distribution.expansion, 0.4);
assert.equal(distribution.failure, 0);
assert.match(compactOutcomeDistribution(distribution), /expansion: 40%/);

const row = {
  instrument: "SOL-PERP",
  market: "Perpetual Futures",
  replaySimilarity: 78,
  sampleCount: 64,
  pressureState: "Constructive",
  participantActivity: "High",
  liquidityPosture: "Stable depth",
  risk: "Watch",
  coverage: { coverage: "indexed", provider: "Raven indexed", isLive: true },
};

const matches = similarStructures(row);
assert.equal(matches.length, 3);
assert.ok(matches[0].similarity >= matches[1].similarity);
assert.ok(matches[0].outcomeDistribution.expansion > 0);

const summary = replayOutcomeSummary(row);
assert.match(summary.headline, /Top replay/);
assert.equal(summary.sampleSufficiency.label, "sufficient");
assert.equal(summary.coverage.label, "indexed");
assert.ok(summary.bestConditions.length >= 2);
assert.ok(summary.failureModes.length >= 2);
