import { normalizeCoverage } from "./ravenos_coverage.mjs";

export const CONFIDENCE_LABELS = new Set(["low", "developing", "moderate", "high"]);

export function confidenceLabel(score) {
  const n = clamp(score);
  if (n >= 80) return "high";
  if (n >= 60) return "moderate";
  if (n >= 35) return "developing";
  return "low";
}

export function normalizeConfidence(input = {}) {
  const coverage = normalizeCoverage(input.coverage || input);
  const sampleDepth = normalizeSampleDepth(input.sampleDepth ?? input.sample_depth ?? input.sampleCount);
  const dataFreshness = normalizeFreshness(input.dataFreshness ?? input.data_freshness ?? coverage.lastUpdated);
  const providerQuality = Number.isFinite(Number(input.providerQuality)) ? clamp(input.providerQuality) : coverage.qualityScore;
  const replayQuality = Number.isFinite(Number(input.replayQuality)) ? clamp(input.replayQuality) : replayQualityFromInput(input);
  const coverageQuality = coverage.qualityScore;
  const score = clamp(
    (sampleDepth.score * 0.22)
    + (dataFreshness.score * 0.18)
    + (providerQuality * 0.22)
    + (replayQuality * 0.18)
    + (coverageQuality * 0.20),
  );
  return {
    score,
    label: confidenceLabel(score),
    sampleDepth,
    dataFreshness,
    providerQuality,
    replayQuality,
    coverageQuality,
    coverage,
  };
}

export function clamp(value, min = 0, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function normalizeSampleDepth(value) {
  if (typeof value === "string") {
    const text = value.toLowerCase();
    if (text.includes("deep") || text.includes("strong")) return { label: "strong", count: null, score: 84 };
    if (text.includes("moderate")) return { label: "moderate", count: null, score: 64 };
    if (text.includes("thin")) return { label: "thin", count: null, score: 30 };
  }
  const count = Number(value || 0);
  if (count >= 100) return { label: "strong", count, score: 88 };
  if (count >= 50) return { label: "moderate", count, score: 70 };
  if (count >= 20) return { label: "developing", count, score: 50 };
  if (count > 0) return { label: "thin", count, score: 28 };
  return { label: "unknown", count: 0, score: 18 };
}

function normalizeFreshness(value) {
  if (typeof value === "number") {
    if (value <= 5 * 60) return { label: "fresh", ageSeconds: value, score: 92 };
    if (value <= 60 * 60) return { label: "recent", ageSeconds: value, score: 72 };
    if (value <= 24 * 60 * 60) return { label: "stale", ageSeconds: value, score: 42 };
    return { label: "old", ageSeconds: value, score: 18 };
  }
  const text = String(value || "").toLowerCase();
  if (!text || text === "sample" || text === "preview") return { label: "sample", ageSeconds: null, score: 20 };
  if (text.includes("live") || text.includes("now")) return { label: "fresh", ageSeconds: null, score: 88 };
  const ts = Date.parse(value);
  if (Number.isFinite(ts)) return normalizeFreshness(Math.max(0, Math.floor((Date.now() - ts) / 1000)));
  return { label: "unknown", ageSeconds: null, score: 34 };
}

function replayQualityFromInput(input) {
  const replay = Number(input.replaySimilarity ?? input.replay_similarity ?? 0);
  if (Number.isFinite(replay) && replay > 0) return clamp(replay);
  if (input.replayAvailable === false) return 15;
  return 40;
}
