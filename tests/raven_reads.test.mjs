import assert from "node:assert/strict";
import {
  canonicalSerializeRavenRead,
  ravenReadHash,
  translateOverlayToRavenRead,
  validateRavenRead,
} from "../lib/raven_reads.mjs";

const context = {
  asset: "SOL-PERP",
  market: "perps",
  venue: "Hyperliquid",
  timeframe: "1h",
};

function overlay(overrides = {}) {
  return {
    id: "sol-pressure",
    type: "pressure-zone",
    label: "Perps pressure zone",
    startTime: "2026-06-25",
    endTime: "2026-06-26",
    priceMin: "140.25",
    priceMax: "148.75",
    value: 78,
    severity: "warning",
    source: "perps",
    summary: "Pressure context normalized for this instrument.",
    metadata: { sample_count: 42, window: "1h" },
    ...overrides,
  };
}

function providerPressureOverlay(overrides = {}) {
  return overlay({
    source: "hyperliquid_perps",
    observed_at: "2026-06-25T12:00:00Z",
    freshness_state: "fresh",
    value: 82,
    metadata: {
      pressureScore: 82,
      pressure_score_source: "hyperliquid_perps",
      provider: "Hyperliquid",
      source: "hyperliquid_perps",
      funding: -0.000012,
      open_interest: 1280000,
      oi_score: 72,
      mark_px: 150.22,
      oracle_px: 150.18,
      premium: 0.0002,
      basis: 0.0002,
      sample_count: 42,
      window: "1h",
      public_artifact_ref: "/ravenos/perps.json",
    },
    ...overrides,
  });
}

function assertPublicRead(read) {
  validateRavenRead(read);
  const text = JSON.stringify(read);
  assert(!/\balpha\b/i.test(text));
  assert(!/\bbuy\b/i.test(text));
  assert(!/\bsell\b/i.test(text));
  assert.equal(read.public_safe, true);
}

{
  const read = translateOverlayToRavenRead(providerPressureOverlay(), context);
  assert.equal(read.mode, "pressure");
  assert.equal(read.title, "Squeeze watch");
  assert.equal(read.confidence, "high");
  assert.equal(read.observed_at, "2026-06-25T12:00:00Z");
  assert.equal(read.freshness_state, "fresh");
  assert.equal(read.evidence[0].source, "hyperliquid_perps");
  assert.equal(read.evidence[0].public_artifact_ref, "/ravenos/perps.json");
  assert.equal(read.zone.price_low, "140.25");
  assert.equal(read.zone.price_high, "148.75");
  assertPublicRead(read);
}

{
  const read = translateOverlayToRavenRead(providerPressureOverlay({
    value: 74,
    metadata: {
      pressureScore: 74,
      pressure_score_source: "hyperliquid_perps",
      provider: "Hyperliquid",
      source: "hyperliquid_perps",
      open_interest: 1280000,
      oi_score: 72,
      mark_px: 150.22,
      oracle_px: 150.18,
      public_artifact_ref: "/ravenos/perps.json",
    },
  }), context);
  const text = JSON.stringify(read);
  assert.equal(read.mode, "pressure");
  assert(!/funding/i.test(text), "missing funding field must not produce funding language");
  assertPublicRead(read);
}

{
  const read = translateOverlayToRavenRead(providerPressureOverlay({
    value: 74,
    metadata: {
      pressureScore: 74,
      pressure_score_source: "hyperliquid_perps",
      provider: "Hyperliquid",
      source: "hyperliquid_perps",
      funding: -0.000012,
      mark_px: 150.22,
      oracle_px: 150.18,
      public_artifact_ref: "/ravenos/perps.json",
    },
  }), context);
  const text = JSON.stringify(read);
  assert.equal(read.mode, "pressure");
  assert(!/\bOI\b|open-interest|open interest/i.test(text), "missing OI field must not produce OI language");
  assertPublicRead(read);
}

{
  const read = translateOverlayToRavenRead(providerPressureOverlay({
    freshness_state: "stale",
    observed_at: "2026-06-24T12:00:00Z",
  }), context);
  assert.equal(read.status, "stale");
  assert.equal(read.freshness_state, "stale");
  assert.equal(read.confidence, "low");
  assert(read.warnings.some((item) => /not fresh/i.test(item)));
  assertPublicRead(read);
}

{
  const read = translateOverlayToRavenRead(overlay({
    value: 95,
    metadata: { pressureScore: 95, pressure_score_source: "chart_heuristic" },
  }), context);
  assert.equal(read.mode, "pressure");
  assert.equal(read.title, "Pressure context forming");
  assert.equal(read.confidence, "low");
  assert.notEqual(read.confidence_score, 95);
  assertPublicRead(read);
}

{
  const read = translateOverlayToRavenRead(overlay({
    id: "sol-breadth",
    type: "breadth-line",
    value: 40,
    source: "ravenos_behavior_public",
    observed_at: "2026-06-25T12:00:00Z",
    metadata: {
      participation_score_source: "ravenos_behavior_public",
      sample_count: 153,
      usable_sample: 51,
      observed_sample: 153,
      window: "24h",
      derived_state: "outcomes unclear",
      avg_outcome: "mixed",
      public_artifact_ref: "/ravenos/behavior.json",
    },
  }), context);
  assert.equal(read.mode, "participation");
  assert.equal(read.title, "Participation fragile");
  assert.equal(read.confidence, "high");
  assert.equal(read.evidence[0].public_artifact_ref, "/ravenos/behavior.json");
  assertPublicRead(read);
}

{
  const read = translateOverlayToRavenRead(overlay({
    id: "sol-breadth-missing-actors",
    type: "breadth-line",
    value: 40,
    source: "ravenos_behavior_public",
    metadata: {
      participation_score_source: "ravenos_behavior_public",
      sample_count: 20,
      usable_sample: 12,
      public_artifact_ref: "/ravenos/behavior.json",
    },
  }), context);
  const text = JSON.stringify(read);
  assert(!/actor breadth/i.test(text.replace(/Actor count unavailable; this read does not claim actor breadth\./g, "")));
  assert(!/Repeat actors present/i.test(text));
  assertPublicRead(read);
}

{
  const read = translateOverlayToRavenRead(overlay({
    id: "sol-concentrated",
    type: "breadth-line",
    value: 72,
    source: "ravenos_behavior_public",
    metadata: {
      participation_score_source: "ravenos_behavior_public",
      sample_count: 80,
      usable_sample: 64,
      concentration_score: 82,
      public_artifact_ref: "/ravenos/behavior.json",
    },
  }), context);
  assert.equal(read.title, "Outlier-dependent participation");
  assertPublicRead(read);
}

{
  const read = translateOverlayToRavenRead(overlay({
    id: "sol-history",
    type: "history-window",
    value: 97,
    source: "ravenos_replay_public",
    observed_at: "2026-06-25T12:00:00Z",
    metadata: {
      replay_score_source: "ravenos_replay_public",
      similarity_score: 0.97,
      after_window_summary: "mixed",
      sample_count: 16,
      public_artifact_ref: "/ravenos/replay.json",
    },
  }), context);
  assert.equal(read.mode, "replay");
  assert.equal(read.title, "Replay mixed");
  assert(read.warnings.some((item) => /not a forecast/i.test(item)));
  assert.equal(read.evidence[0].public_artifact_ref, "/ravenos/replay.json");
  assertPublicRead(read);
}

{
  const read = translateOverlayToRavenRead(overlay({
    id: "sol-history-rewarded",
    type: "history-window",
    value: 92,
    source: "ravenos_replay_public",
    metadata: {
      replay_score_source: "ravenos_replay_public",
      similarity_score: 0.92,
      after_window_summary: "favorable",
      sample_count: 16,
      public_artifact_ref: "/ravenos/replay.json",
    },
  }), context);
  assert.equal(read.title, "Similar contexts rewarded continuation");
  assertPublicRead(read);
}

{
  const read = translateOverlayToRavenRead(overlay({
    id: "sol-history-no-outcome",
    type: "history-window",
    value: 80,
    source: "ravenos_replay_public",
    metadata: {
      replay_score_source: "ravenos_replay_public",
      similarity_score: 0.8,
      public_artifact_ref: "/ravenos/replay.json",
    },
  }), context);
  assert.notEqual(read.title, "Similar contexts rewarded continuation");
  assert.equal(read.confidence, "low");
  assertPublicRead(read);
}

{
  const read = translateOverlayToRavenRead(overlay({
    id: "sol-liquidity",
    type: "liquidity-zone",
    value: 44,
    source: "ravenos_terminal_health",
    freshness_state: "recovering",
    metadata: {
      risk_score_source: "ravenos_terminal_health",
      component: "base_rpc",
      component_state: "recovering",
      public_artifact_ref: "/ravenos/terminal_health.json",
    },
  }), context);
  assert.equal(read.mode, "risk");
  assert.equal(read.title, "Provider degraded");
  assert.equal(read.confidence, "medium");
  assert(!/thin liquidity/i.test(JSON.stringify(read)));
  assertPublicRead(read);
}

{
  const read = translateOverlayToRavenRead(overlay({
    id: "sol-weak-sample",
    type: "liquidity-zone",
    value: 44,
    source: "ravenos_terminal_health",
    metadata: {
      usable_sample: 3,
      public_artifact_ref: "/ravenos/terminal_health.json",
    },
  }), context);
  assert.equal(read.title, "Weak sample");
  assertPublicRead(read);
}

{
  const read = translateOverlayToRavenRead(overlay({
    id: "sol-structure",
    type: "compression-band",
    value: 72,
    source: "chart_structure",
    freshness_state: "fresh",
    metadata: {
      compression_score_source: "chart_candles",
      candle_count: 120,
    },
  }), context);
  assert.equal(read.mode, "structure");
  assert.equal(read.title, "Compression forming");
  assert.equal(read.confidence, "low");
  assert(!/liquidity/i.test(read.plain_english_read));
  assertPublicRead(read);
}

{
  const read = translateOverlayToRavenRead(overlay({
    id: "sol-structure-survival",
    type: "compression-band",
    value: 72,
    source: "chart_structure",
    freshness_state: "fresh",
    metadata: {
      compression_score_source: "chart_candles",
      candle_count: 120,
      survival_score: 0.6,
    },
  }), context);
  assert.equal(read.title, "Breakout survival unproven");
  assert.equal(read.confidence, "medium");
  assertPublicRead(read);
}

{
  const read = translateOverlayToRavenRead(overlay({
    id: "sol-stale",
    label: "Delayed perps pressure",
    freshness_state: "stale",
  }), context);
  assert.equal(read.status, "stale");
  assert.equal(read.freshness_state, "stale");
  assertPublicRead(read);
}

{
  const read = translateOverlayToRavenRead(providerPressureOverlay(), context);
  const reordered = JSON.parse(JSON.stringify(read));
  const hashA = ravenReadHash(read);
  const hashB = ravenReadHash({
    public_safe: reordered.public_safe,
    evidence: reordered.evidence,
    mode: reordered.mode,
    schema_version: reordered.schema_version,
    raven_read_id: reordered.raven_read_id,
    title: reordered.title,
    short_label: reordered.short_label,
    plain_english_read: reordered.plain_english_read,
    setup: reordered.setup,
    edge: reordered.edge,
    confirmation: reordered.confirmation,
    failure: reordered.failure,
    status: reordered.status,
    confidence: reordered.confidence,
    confidence_score: reordered.confidence_score,
    freshness_state: reordered.freshness_state,
    observed_at: reordered.observed_at,
    generated_at: reordered.generated_at,
    expires_at: reordered.expires_at,
    age_seconds: reordered.age_seconds,
    asset: reordered.asset,
    market: reordered.market,
    venue: reordered.venue,
    chain: reordered.chain,
    timeframe: reordered.timeframe,
    zone: reordered.zone,
    supporting_dimensions: reordered.supporting_dimensions,
    conflicting_dimensions: reordered.conflicting_dimensions,
    warnings: reordered.warnings,
    proof_refs: reordered.proof_refs,
    source_overlay_id: reordered.source_overlay_id,
  });
  assert.equal(hashA, hashB);
  assert.equal(canonicalSerializeRavenRead(read), canonicalSerializeRavenRead(read));
}

{
  const read = translateOverlayToRavenRead(overlay(), context);
  assert.throws(() => validateRavenRead({ ...read, title: "" }), /missing title/i);
  assert.throws(() => validateRavenRead({ ...read, mode: "signal" }), /Invalid Raven Read mode/i);
  assert.throws(() => validateRavenRead({ ...read, status: "ready" }), /Invalid Raven Read status/i);
  assert.throws(() => validateRavenRead({ ...read, freshness_state: "current" }), /Invalid Raven Read freshness/i);
  assert.throws(() => validateRavenRead({ ...read, plain_english_read: "Buy this now" }), /Banned public Raven Read language/i);
  assert.throws(() => validateRavenRead({ ...read, evidence: [{ ...read.evidence[0], public_safe: false }] }), /not public_safe/i);
}

console.log("Raven Read contract and translator tests passed.");
