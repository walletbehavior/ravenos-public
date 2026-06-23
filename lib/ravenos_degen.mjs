import { normalizeConfidence } from "./ravenos_confidence.mjs";
import { normalizeCoverage } from "./ravenos_coverage.mjs";

export const RAVEN_CAP_BUCKETS = [
  { key: "nano", label: "Nano", min: 0, max: 100_000, question: "Is it real?", focus: ["ownership concentration", "liquidity survival", "attention quality", "participation quality"] },
  { key: "micro", label: "Micro", min: 100_000, max: 1_000_000, question: "Is it surviving?", focus: ["fresh survival", "participation expansion", "attention velocity", "replay"] },
  { key: "small", label: "Small", min: 1_000_000, max: 10_000_000, question: "Is this becoming a real market?", focus: ["replay quality", "participation breadth", "structure quality", "outcome quality"] },
  { key: "mid", label: "Mid", min: 10_000_000, max: 100_000_000, question: "Is capital rotating here?", focus: ["rotation", "participation", "liquidity", "pressure"] },
  { key: "large", label: "Large", min: 100_000_000, max: 1_000_000_000, question: "Is this leading?", focus: ["sector leadership", "capital absorption", "breadth", "relative strength"] },
  { key: "mega", label: "Mega", min: 1_000_000_000, max: Infinity, question: "What is driving the market?", focus: ["market leadership", "dominance", "regime influence", "cross-market effects"] },
];

export const DEGEN_CHAINS = ["Solana", "Base", "Ethereum", "BNB"];
export const DEGEN_SECTORS = ["Memes", "AI", "DeFi", "Infrastructure", "Gaming", "Consumer", "Other"];

function clamp(value, min = 0, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export function capBucketFor(marketCap = 0) {
  const cap = Number(marketCap || 0);
  return RAVEN_CAP_BUCKETS.find((bucket) => cap >= bucket.min && cap < bucket.max) || RAVEN_CAP_BUCKETS[0];
}

export function attentionState(velocity = 0) {
  const n = Number(velocity || 0);
  if (n >= 35) return "Exploding";
  if (n >= 10) return "Rising";
  if (n > -8) return "Stable";
  if (n > -25) return "Fading";
  return "Collapsing";
}

export function survivalState(score = 0) {
  const n = clamp(score);
  if (n >= 82) return "Strong";
  if (n >= 66) return "Improving";
  if (n >= 48) return "Stable";
  if (n >= 30) return "Weakening";
  return "Failing";
}

export function rotationDirection(score = 0) {
  const n = Number(score || 0);
  if (n >= 66) return "Rising";
  if (n <= 38) return "Falling";
  return "Stable";
}

export function freshSurvivalScore(row = {}) {
  const duration = clamp(row.survivalDurationScore ?? row.ageScore ?? row.flowScore ?? 50);
  const retention = clamp(row.participationRetention ?? row.participation ?? row.flowScore ?? 50);
  const replay = clamp(row.replayScore ?? row.replay ?? row.flowScore ?? 50);
  const liquidity = clamp(row.liquidityPersistence ?? row.liquidityScore ?? row.flowScore ?? 50);
  return Math.round(duration * 0.26 + retention * 0.28 + replay * 0.20 + liquidity * 0.26);
}

export function normalizeDegenRow(input = {}) {
  const marketCap = Number(input.marketCap ?? input.market_cap ?? input.fdv ?? 0);
  const bucket = capBucketFor(marketCap);
  const coverage = normalizeCoverage(input.coverage || { coverage: input.coverageLabel || "public", provider: input.provider || "Dexscreener" });
  const flowScore = clamp(input.flowScore ?? input.flow_score ?? 50);
  const attentionVelocity = Number(input.attentionVelocity ?? input.attention_velocity ?? 0);
  const freshSurvival = freshSurvivalScore({ ...input, flowScore });
  const replay = clamp(input.replay ?? input.replayScore ?? flowScore * 0.82);
  const participation = clamp(input.participation ?? input.participationScore ?? flowScore);
  const confidence = normalizeConfidence({
    sampleCount: input.sampleCount ?? 24,
    replaySimilarity: replay,
    coverage,
  });
  return {
    symbol: String(input.symbol || "UNKNOWN").toUpperCase(),
    name: String(input.name || input.symbol || "Unknown"),
    marketCap,
    bucket: bucket.key,
    bucketLabel: bucket.label,
    bucketQuestion: bucket.question,
    chain: String(input.chain || input.chainVenue || "Solana"),
    sector: String(input.sector || "Other"),
    flowScore,
    attentionVelocity,
    attentionState: attentionState(attentionVelocity),
    participation,
    participationState: rotationDirection(participation),
    freshSurvival,
    freshSurvivalState: survivalState(freshSurvival),
    replay,
    replayStrength: replay >= 80 ? "Exceptional" : replay >= 65 ? "Strong" : replay >= 50 ? "Moderate" : "Developing",
    liquidityPosture: String(input.liquidityPosture || input.liquidity || "Developing"),
    risk: String(input.risk || (freshSurvival < 35 ? "Elevated" : "Watch")),
    coverage,
    confidence,
    lastUpdated: input.lastUpdated || "public",
  };
}

export function degenExplanation(row = {}) {
  const item = normalizeDegenRow(row);
  const positives = [];
  const negatives = [];
  const risks = [];
  if (item.participationState === "Rising") positives.push("Participation is expanding.");
  if (["Strong", "Improving"].includes(item.freshSurvivalState)) positives.push("Fresh survival is improving.");
  if (["Exploding", "Rising"].includes(item.attentionState)) positives.push("Attention velocity is positive.");
  if (item.freshSurvivalState === "Weakening" || item.freshSurvivalState === "Failing") negatives.push("Survival quality is deteriorating.");
  if (item.risk === "Elevated") risks.push("Risk posture is elevated.");
  if (item.coverage.isSample || item.coverage.label === "public") risks.push("Coverage is limited and should be treated as public context.");
  return {
    headline: `${item.bucketLabel} ecosystem read: ${item.bucketQuestion}`,
    summary: `${item.symbol} is evaluated through survival, participation, attention, liquidity, and replay context.`,
    confidence: item.confidence.score,
    positives,
    negatives,
    risks,
    evidence: [
      `Bucket: ${item.bucketLabel}`,
      `Fresh survival: ${item.freshSurvivalState}`,
      `Attention: ${item.attentionState}`,
      `Replay strength: ${item.replayStrength}`,
      `Coverage: ${item.coverage.label}`,
    ],
    coverage: item.coverage.label,
    lastUpdated: item.lastUpdated,
  };
}

export function rotationMatrix(rows = []) {
  const normalized = rows.map(normalizeDegenRow);
  return RAVEN_CAP_BUCKETS.map((bucket) => {
    const scoped = normalized.filter((row) => row.bucket === bucket.key);
    const avg = (key) => scoped.reduce((sum, row) => sum + Number(row[key] || 0), 0) / Math.max(1, scoped.length);
    return {
      bucket: bucket.key,
      label: bucket.label,
      question: bucket.question,
      participation: rotationDirection(avg("participation")),
      attention: rotationDirection(50 + avg("attentionVelocity")),
      flow: rotationDirection(avg("flowScore")),
      count: scoped.length,
    };
  });
}

export function structureTape(rows = []) {
  const normalized = rows.map(normalizeDegenRow);
  const now = new Date().toISOString().slice(11, 16);
  const topBucket = rotationMatrix(normalized).sort((a, b) => b.count - a.count)[0];
  const topChain = chainRotation(normalized)[0];
  const topSector = sectorRotation(normalized)[0];
  return [
    { time: now, text: `Participation ${String(topBucket?.participation || "stable").toLowerCase()} across ${topBucket?.label || "micro"} ecosystem rows.`, evidence: `${topBucket?.count || 0} rows` },
    { time: now, text: `${topChain?.chain || "Solana"} structure is ${String(topChain?.structure || "developing").toLowerCase()} with ${String(topChain?.participation || "stable").toLowerCase()} participation.`, evidence: "chain rotation" },
    { time: now, text: `${topSector?.sector || "Memes"} sector shows ${String(topSector?.participation || "stable").toLowerCase()} participation.`, evidence: "sector rotation" },
  ];
}

export function chainRotation(rows = []) {
  return groupRotation(rows, "chain", DEGEN_CHAINS);
}

export function sectorRotation(rows = []) {
  return groupRotation(rows, "sector", DEGEN_SECTORS);
}

function groupRotation(rows, key, defaults) {
  const normalized = rows.map(normalizeDegenRow);
  return defaults.map((value) => {
    const scoped = normalized.filter((row) => row[key] === value);
    const avg = (field) => scoped.reduce((sum, row) => sum + Number(row[field] || 0), 0) / Math.max(1, scoped.length);
    return {
      [key]: value,
      participation: rotationDirection(avg("participation")),
      survival: survivalState(avg("freshSurvival")),
      attention: rotationDirection(50 + avg("attentionVelocity")),
      replay: avg("replay") >= 65 ? "Strong" : avg("replay") >= 50 ? "Moderate" : "Developing",
      structure: avg("flowScore") >= 66 ? "Constructive" : avg("flowScore") >= 45 ? "Developing" : "Weakening",
      count: scoped.length,
    };
  }).sort((a, b) => b.count - a.count);
}
