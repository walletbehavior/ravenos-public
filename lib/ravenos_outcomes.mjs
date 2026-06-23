import { normalizeConfidence } from "./ravenos_confidence.mjs";
import { normalizeCoverage } from "./ravenos_coverage.mjs";

export const OUTCOME_CLASSIFICATIONS = new Set([
  "expansion",
  "continuation",
  "reversal",
  "failure",
  "unresolved",
]);

export function normalizeOutcomeClassification(value = "unresolved") {
  const text = String(value || "unresolved").toLowerCase();
  return OUTCOME_CLASSIFICATIONS.has(text) ? text : "unresolved";
}

export function normalizeObservation(input = {}) {
  const coverage = normalizeCoverage(input.coverage || input);
  const confidence = input.confidence?.label && Number.isFinite(Number(input.confidence?.score))
    ? { ...input.confidence, coverage }
    : normalizeConfidence({ ...input.confidence, coverage, sampleCount: input.sampleCount, replaySimilarity: input.replaySimilarity });
  return {
    id: String(input.id || observationId()).trim(),
    instrument: String(input.instrument || input.asset || "").trim(),
    market: String(input.market || "").trim(),
    timestamp: Number(input.timestamp || Math.floor(Date.now() / 1000)),
    structureType: String(input.structureType || input.structure_type || "structure").trim(),
    pressureState: String(input.pressureState || input.pressure_state || "unknown").trim(),
    replaySimilarity: nullableNumber(input.replaySimilarity ?? input.replay_similarity),
    participationState: String(input.participationState || input.participation_state || "unknown").trim(),
    liquidityState: String(input.liquidityState || input.liquidity_state || "unknown").trim(),
    attentionState: String(input.attentionState || input.attention_state || "unknown").trim(),
    rotationState: String(input.rotationState || input.rotation_state || "unknown").trim(),
    confidence,
    coverage,
    forwardOutcome: nullableNumber(input.forwardOutcome ?? input.forward_outcome),
    outcomeWindow: String(input.outcomeWindow || input.outcome_window || "unresolved").trim(),
    outcomeClassification: normalizeOutcomeClassification(input.outcomeClassification || input.outcome_classification),
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
  };
}

export function serializeObservation(input = {}) {
  const row = normalizeObservation(input);
  return {
    id: row.id,
    instrument: row.instrument,
    market: row.market,
    timestamp: row.timestamp,
    structure_type: row.structureType,
    pressure_state: row.pressureState,
    replay_similarity: row.replaySimilarity,
    participation_state: row.participationState,
    liquidity_state: row.liquidityState,
    attention_state: row.attentionState,
    rotation_state: row.rotationState,
    confidence_score: row.confidence.score,
    confidence_label: row.confidence.label,
    coverage_label: row.coverage.label,
    coverage_provider: row.coverage.provider,
    coverage_payload: JSON.stringify(row.coverage),
    confidence_payload: JSON.stringify(row.confidence),
    forward_outcome: row.forwardOutcome,
    outcome_window: row.outcomeWindow,
    outcome_classification: row.outcomeClassification,
    metadata: JSON.stringify(row.metadata),
  };
}

export function observationFromExplanation(row = {}, explanation = {}) {
  return normalizeObservation({
    instrument: row.instrument || row.asset,
    market: row.market,
    timestamp: row.timestamp,
    structureType: explanation.type || "explanation",
    pressureState: row.pressureState,
    replaySimilarity: row.replaySimilarity,
    participationState: row.participantActivity || row.participationState,
    liquidityState: row.liquidityPosture || row.liquidityState,
    attentionState: row.attentionVelocity != null ? attentionState(row.attentionVelocity) : row.attentionState,
    rotationState: row.rotationState,
    confidence: { score: explanation.confidence },
    coverage: explanation.coverage || row.coverage,
    outcomeClassification: "unresolved",
    metadata: { explanationHeadline: explanation.headline || "" },
  });
}

export async function persistObservation(env = {}, observation = {}) {
  const db = env.RAVENOS_DB || env.DB || null;
  if (!db) return { ok: false, skipped: true, reason: "outcome_db_unavailable" };
  const row = serializeObservation(observation);
  await db.prepare(`
    INSERT INTO outcome_observations (
      id, instrument, market, timestamp, structure_type, pressure_state, replay_similarity,
      participation_state, liquidity_state, attention_state, rotation_state, confidence_score,
      confidence_label, coverage_label, coverage_provider, coverage_payload, confidence_payload,
      forward_outcome, outcome_window, outcome_classification, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    row.id,
    row.instrument,
    row.market,
    row.timestamp,
    row.structure_type,
    row.pressure_state,
    row.replay_similarity,
    row.participation_state,
    row.liquidity_state,
    row.attention_state,
    row.rotation_state,
    row.confidence_score,
    row.confidence_label,
    row.coverage_label,
    row.coverage_provider,
    row.coverage_payload,
    row.confidence_payload,
    row.forward_outcome,
    row.outcome_window,
    row.outcome_classification,
    row.metadata,
  ).run();
  return { ok: true, id: row.id };
}

function nullableNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function observationId() {
  if (globalThis.crypto?.randomUUID) return `obs_${globalThis.crypto.randomUUID()}`;
  return `obs_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function attentionState(value) {
  const n = Number(value);
  if (n >= 25) return "exploding";
  if (n >= 8) return "rising";
  if (n <= -15) return "collapsing";
  if (n < 0) return "fading";
  return "stable";
}
