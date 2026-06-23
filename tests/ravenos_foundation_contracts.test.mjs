import assert from "node:assert/strict";
import { confidenceLabel, normalizeConfidence } from "../lib/ravenos_confidence.mjs";
import { coverageFromProvider, normalizeCoverage } from "../lib/ravenos_coverage.mjs";
import { normalizeObservation, serializeObservation } from "../lib/ravenos_outcomes.mjs";

assert.equal(confidenceLabel(20), "low");
assert.equal(confidenceLabel(40), "developing");
assert.equal(confidenceLabel(65), "moderate");
assert.equal(confidenceLabel(90), "high");

const liveConfidence = normalizeConfidence({
  sampleCount: 120,
  dataFreshness: "live",
  replaySimilarity: 82,
  coverage: { coverage: "deep_raven", provider: "Deep Raven", isLive: true },
});
assert.equal(liveConfidence.label, "high");
assert.equal(liveConfidence.coverage.label, "deep_raven");

const sampleCoverage = normalizeCoverage({ coverage: "sample", provider: "Mock", isLive: true });
assert.equal(sampleCoverage.label, "sample");
assert.equal(sampleCoverage.isLive, false);
assert.equal(sampleCoverage.isSample, true);
assert.match(sampleCoverage.warning, /Sample|preview/i);

const dexCoverage = coverageFromProvider("Dexscreener", { lastUpdated: "2026-06-23T18:00:00Z" });
assert.equal(dexCoverage.label, "public");
assert.equal(dexCoverage.provider, "Dexscreener");
assert.equal(dexCoverage.isLive, false);

const observation = normalizeObservation({
  id: "obs_test",
  instrument: "SOL-PERP",
  market: "Perpetual Futures",
  timestamp: 1_800_000_000,
  structureType: "pressure_replay",
  pressureState: "Crowded",
  replaySimilarity: 76,
  participationState: "broadening",
  liquidityState: "stable",
  attentionState: "rising",
  rotationState: "mid_to_large",
  sampleCount: 80,
  coverage: { coverage: "indexed", provider: "Raven indexed", isLive: true },
  forwardOutcome: 0.42,
  outcomeWindow: "4h",
  outcomeClassification: "continuation",
});
assert.equal(observation.outcomeClassification, "continuation");
assert.equal(observation.confidence.label, "moderate");
assert.equal(observation.coverage.label, "indexed");

const serialized = serializeObservation(observation);
assert.equal(serialized.structure_type, "pressure_replay");
assert.equal(serialized.outcome_classification, "continuation");
assert.equal(JSON.parse(serialized.coverage_payload).label, "indexed");
assert.equal(JSON.parse(serialized.confidence_payload).label, observation.confidence.label);
