import { normalizeConfidence } from "./ravenos_confidence.mjs";
import { normalizeCoverage } from "./ravenos_coverage.mjs";

function clamp(value, min = 0, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export const EXPLANATION_TYPES = {
  flow_score: "Flow Score",
  pressure_score: "Pressure Score",
  replay_similarity: "Replay Similarity",
  liquidity_attraction: "Liquidity Attraction",
  heatmap_cell: "Heatmap Cell",
  structure_lab_row: "Structure Lab Row",
  candidate_lane: "Candidate Lane",
  failure_analysis: "Failure Analysis",
  watchlist_row: "Watchlist Row",
  alert_event: "Alert Event",
  participant_activity: "Participant Activity",
};

export function normalizeExplanation(input = {}) {
  const coverage = normalizeCoverage(input.coverage && typeof input.coverage === "object" ? input.coverage : { coverage: input.coverage, lastUpdated: input.lastUpdated || input.last_updated });
  const confidenceModel = normalizeConfidence({
    score: input.confidence,
    sampleCount: input.sampleCount,
    replaySimilarity: input.replaySimilarity,
    coverage,
  });
  const confidence = input.confidence == null ? confidenceModel.score : clamp(input.confidence);
  return {
    headline: String(input.headline || "Market structure context").trim(),
    summary: String(input.summary || "RavenOS is collecting evidence for this read.").trim(),
    confidence,
    confidenceModel: { ...confidenceModel, score: confidence, label: confidenceLabelFromScore(confidence) },
    positives: arrayOfText(input.positives),
    negatives: arrayOfText(input.negatives),
    risks: arrayOfText(input.risks),
    evidence: arrayOfText(input.evidence),
    coverage: coverage.label,
    coverageModel: coverage,
    lastUpdated: input.lastUpdated || input.last_updated || coverage.lastUpdated || "sample",
    breakdown: Array.isArray(input.breakdown) ? input.breakdown : [],
    modelNotes: arrayOfText(input.modelNotes),
  };
}

function arrayOfText(value) {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function confidenceLabelFromScore(score) {
  const n = clamp(score);
  if (n >= 80) return "high";
  if (n >= 60) return "moderate";
  if (n >= 35) return "developing";
  return "low";
}

function qualityWord(score) {
  const n = clamp(score);
  if (n >= 80) return "strong";
  if (n >= 65) return "constructive";
  if (n >= 45) return "mixed";
  if (n >= 30) return "weakening";
  return "thin";
}

function coverageConfidenceAdjustment(coverage = "") {
  const text = String(coverage).toLowerCase();
  if (text.includes("live")) return 8;
  if (text.includes("cached")) return -6;
  if (text.includes("public")) return -8;
  if (text.includes("sample") || text.includes("preview")) return -16;
  return 0;
}

function attentionContribution(value) {
  const n = Number(value || 0);
  if (n >= 25) return 10;
  if (n >= 15) return 8;
  if (n >= 5) return 5;
  if (n < 0) return -4;
  return 2;
}

function participantContribution(activity) {
  if (activity === "High" || String(activity).includes("OI expansion")) return 18;
  if (activity === "Medium" || String(activity).includes("OI rising")) return 10;
  if (activity === "Low") return 2;
  return 6;
}

function outcomeContribution(outcome) {
  if (outcome === "Paying") return 15;
  if (outcome === "Punishing") return -10;
  return 4;
}

function liquidityContribution(posture) {
  const p = String(posture || "").toLowerCase();
  if (p.includes("deep") || p.includes("stable") || p.includes("improving")) return 8;
  if (p.includes("thin") || p.includes("fragmented")) return -7;
  if (p.includes("choppy")) return -4;
  return 3;
}

function pressureContribution(row) {
  const pressure = String(row.pressureContext || "").toLowerCase();
  if (pressure.includes("crowded") || pressure.includes("elevated")) return -6;
  if (pressure.includes("watch")) return -3;
  return 2;
}

export function scoreBreakdown(row = {}) {
  const attention = attentionContribution(row.attentionVelocity);
  const participant = participantContribution(row.participantActivity);
  const outcome = outcomeContribution(row.participationOutcome);
  const liquidity = liquidityContribution(row.liquidityPosture);
  const pressure = pressureContribution(row);
  const confirmation = row.risk === "Stable" ? 6 : row.risk === "Watch" ? -3 : -8;
  const breadth = clamp(row.flowScore) >= 80 ? 24 : clamp(row.flowScore) >= 70 ? 16 : 8;
  return [
    { label: "participation breadth", value: breadth },
    { label: "clean participant activity", value: participant },
    { label: "survival quality", value: outcome },
    { label: "historical follow-through", value: clamp(row.flowScore) >= 75 ? 12 : 5 },
    { label: "liquidity posture", value: liquidity },
    { label: "crowding pressure", value: pressure },
    { label: "confirmation quality", value: confirmation },
    { label: "attention velocity", value: attention },
  ];
}

export function ScoreBreakdown(row = {}, type = "flow_score") {
  if (type === "pressure_score") {
    const pressure = clamp(row.pressureScore ?? row.flowScore);
    return [
      { label: "funding / basis context", value: pressure >= 75 ? 18 : pressure >= 55 ? 10 : 4 },
      { label: "open interest velocity", value: row.oiVelocity != null ? clamp(row.oiVelocity, -20, 20) : pressure >= 70 ? 12 : 5 },
      { label: "participation breadth", value: participantContribution(row.participantActivity) },
      { label: "liquidity attraction", value: clamp(row.liquidityAttraction?.score ?? row.liquidityAttractionScore ?? pressure * 0.7) >= 70 ? 14 : 6 },
      { label: "confirmation quality", value: row.risk === "Stable" ? 6 : row.risk === "Elevated" ? -9 : -3 },
    ];
  }
  if (type === "replay_similarity") {
    const replay = clamp(row.replaySimilarity ?? row.replay_score ?? row.flowScore);
    return [
      { label: "similarity strength", value: replay >= 75 ? 22 : replay >= 55 ? 12 : 4 },
      { label: "sample sufficiency", value: row.sampleCount >= 50 ? 12 : row.sampleCount >= 20 ? 6 : -8 },
      { label: "outcome consistency", value: row.profitFactor >= 1.2 ? 12 : row.profitFactor >= 1 ? 3 : -8 },
      { label: "failure mode overlap", value: row.failureMode ? -6 : 3 },
    ];
  }
  if (type === "liquidity_attraction") {
    const score = clamp(row.liquidityAttraction?.score ?? row.liquidityAttractionScore ?? row.flowScore);
    return [
      { label: "nearest cluster strength", value: score >= 75 ? 18 : score >= 50 ? 9 : 2 },
      { label: "distance context", value: row.clusterDistancePct != null && Number(row.clusterDistancePct) <= 3 ? 10 : 3 },
      { label: "liquidity persistence", value: liquidityContribution(row.liquidityPosture) },
      { label: "risk adjustment", value: row.risk === "Elevated" ? -8 : 2 },
    ];
  }
  return scoreBreakdown(row);
}

export function confidenceFor(row = {}, sampleDepth = "moderate") {
  let confidence = 54;
  if (row.lastUpdated && row.lastUpdated !== "sample" && row.lastUpdated !== "delayed") confidence += 10;
  if (row.participationOutcome === "Paying" || row.participationOutcome === "Punishing") confidence += 8;
  if (row.risk === "Stable") confidence += 6;
  if (row.risk === "Elevated") confidence -= 8;
  if (String(sampleDepth).toLowerCase() === "thin") confidence -= 14;
  if (String(sampleDepth).toLowerCase() === "strong") confidence += 10;
  return clamp(confidence);
}

export function explanationFor(row = {}, context = {}) {
  const breakdown = ScoreBreakdown(row, context.type || "flow_score");
  const positives = [];
  const negatives = [];
  const risks = [];
  const evidence = [];

  if (Number(row.flowScore || 0) >= 80) positives.push("Participation breadth is broad relative to the current set.");
  else if (Number(row.flowScore || 0) >= 70) positives.push("Flow is constructive but not uniformly broad.");
  else negatives.push("Flow breadth is still developing.");

  if (row.participantActivity === "High" || String(row.participantActivity || "").includes("OI expansion")) positives.push("Participant activity is elevated and visible.");
  if (row.participationOutcome === "Paying") positives.push("Recent participation outcome quality is improving.");
  if (row.participationOutcome === "Punishing") negatives.push("Recent participation outcome quality is weak.");
  if (String(row.liquidityPosture || "").toLowerCase().includes("thin")) risks.push("Liquidity context is thin and can make reads less stable.");
  if (row.risk === "Elevated") risks.push("Risk posture is elevated in the current window.");
  if (String(row.pressureContext || "").toLowerCase().includes("crowd")) risks.push("Crowding pressure is visible.");

  evidence.push(`Flow score ${row.flowScore ?? "n/a"}`);
  if (row.attentionVelocity != null) evidence.push(`Attention velocity ${Number(row.attentionVelocity) > 0 ? "+" : ""}${row.attentionVelocity}`);
  if (row.liquidityPosture) evidence.push(`Liquidity posture: ${row.liquidityPosture}`);
  if (row.participationOutcome) evidence.push(`Participation outcome: ${row.participationOutcome}`);
  if (row.chainVenue) evidence.push(`Venue/chain: ${row.chainVenue}`);

  const confidence = confidenceFor(row, context.sampleDepth || "moderate");
  const headline = Number(row.flowScore || 0) >= 80
    ? "Constructive structure"
    : row.risk === "Elevated"
      ? "Fragile structure"
      : "Mixed structure";
  const summary = positives.length >= 3
    ? "Constructive structure with broad participation and improving outcomes."
    : risks.length
      ? "Mixed structure with useful activity, but risk and liquidity context need attention."
      : "Balanced structure with moderate participation and manageable pressure.";

  return normalizeExplanation({
    headline,
    summary,
    confidence,
    positives,
    negatives,
    risks,
    evidence,
    coverage: context.coverage || row.coverage || "Preview",
    lastUpdated: row.lastUpdated || row.updated_at || "sample",
    breakdown,
  });
}

export function explanationForMetric(type = "flow_score", row = {}, context = {}) {
  const label = EXPLANATION_TYPES[type] || "Structure Metric";
  const score = clamp(
    row.score
      ?? row[type]
      ?? row.flowScore
      ?? row.pressureScore
      ?? row.replaySimilarity
      ?? row.liquidityAttraction?.score
      ?? row.liquidityAttractionScore,
  );
  const breakdown = ScoreBreakdown(row, type);
  const confidence = clamp(48 + score * 0.28 + coverageConfidenceAdjustment(context.coverage || row.coverage) + (row.sampleCount >= 50 ? 8 : 0));
  const positives = [];
  const negatives = [];
  const risks = [];
  const evidence = [`${label} ${score}`];

  if (score >= 70) positives.push(`${label} is ${qualityWord(score)} in the current context.`);
  else negatives.push(`${label} remains ${qualityWord(score)} and needs more confirmation.`);

  if (type === "pressure_score") {
    if (row.pressureState) evidence.push(`Pressure state: ${row.pressureState}`);
    if (score >= 80) risks.push("Pressure is crowded enough to reduce read stability.");
    if (row.participantActivity) evidence.push(`Participant activity: ${row.participantActivity}`);
  } else if (type === "replay_similarity") {
    if (row.sampleCount != null) evidence.push(`Replay sample count ${row.sampleCount}`);
    if (row.profitFactor != null) evidence.push(`Outcome quality ratio ${row.profitFactor}`);
    if (row.sampleCount != null && row.sampleCount < 20) risks.push("Replay sample depth is thin.");
  } else if (type === "liquidity_attraction") {
    if (row.liquidityAttraction?.state) evidence.push(`Liquidity attraction: ${row.liquidityAttraction.state}`);
    if (row.clusterDistancePct != null) evidence.push(`Nearest cluster distance ${row.clusterDistancePct}%`);
    if (row.risk === "Elevated") risks.push("Liquidity context is paired with elevated risk.");
  } else if (type === "participant_activity") {
    if (row.participantActivity) evidence.push(`Participant activity: ${row.participantActivity}`);
    if (row.concentrationChange) evidence.push(`Concentration change: ${row.concentrationChange}`);
    if (String(row.distributionRisk || "").toLowerCase().includes("high")) risks.push("Distribution risk is elevated.");
  }

  return normalizeExplanation({
    headline: `${label}: ${qualityWord(score)} read`,
    summary: `${label} is being interpreted as market structure context with ${qualityWord(score)} evidence quality.`,
    confidence,
    positives,
    negatives,
    risks,
    evidence,
    coverage: context.coverage || row.coverage || "Preview",
    lastUpdated: row.lastUpdated || row.updated_at || "sample",
    breakdown,
  });
}

export function heatmapExplanation(cell = {}, context = {}) {
  const score = clamp(cell.flowScore ?? cell.score ?? cell.value);
  const positives = [];
  const negatives = [];
  const risks = [];
  if (score >= 75) positives.push("Participation expanding in the visible sample.");
  if (Number(cell.freshSurvival || 0) >= 65) positives.push("Survival is improving or stable.");
  if (Number(cell.attentionVelocity || 0) > 0) positives.push("Attention velocity is positive.");
  if (Number(cell.attentionVelocity || 0) > 30 && score < 60) risks.push("Attention is moving faster than confirmation.");
  if (cell.risk === "Elevated") risks.push("Risk posture is elevated.");
  if (score < 50) negatives.push("Confirmation remains thin.");
  return normalizeExplanation({
    headline: score >= 70 ? "Stronger heatmap cell" : "Developing heatmap cell",
    summary: score >= 70
      ? "Participation and structure are stronger than nearby comparison cells."
      : "Structure is still developing and requires more evidence.",
    confidence: clamp(45 + score * 0.35 + coverageConfidenceAdjustment(context.coverage || cell.coverage)),
    positives,
    negatives,
    risks,
    evidence: [
      `Flow score ${score}`,
      cell.chainVenue ? `Venue/chain: ${cell.chainVenue}` : "",
      cell.marketCapBand ? `Market cap band: ${cell.marketCapBand}` : "",
      cell.coverage ? `Coverage: ${cell.coverage}` : "",
    ].filter(Boolean),
    coverage: context.coverage || cell.coverage || "Preview",
    lastUpdated: cell.lastUpdated || "sample",
    breakdown: ScoreBreakdown(cell, "flow_score"),
  });
}

export function researchExplanation(row = {}, context = {}) {
  const pf = Number(row.profitFactor ?? row.profit_factor ?? 0);
  const avg = Number(row.avgNet ?? row.avg_net ?? 0);
  const sample = Number(row.sampleCount ?? row.count ?? row.trades ?? 0);
  const positives = [];
  const negatives = [];
  const risks = [];
  if (pf >= 1.2) positives.push("Outcome quality is above the preferred research threshold.");
  if (avg > 0) positives.push("Average net outcome is positive after assumed costs.");
  if (sample >= 50) positives.push("Sample count is sufficient for provisional review.");
  else risks.push("Sample count is not yet sufficient for promotion review.");
  if (row.outlierDependency) risks.push("Outlier dependency requires additional review.");
  if (pf < 1) negatives.push("Outcome quality is below baseline.");
  return normalizeExplanation({
    headline: row.status ? `${titleCase(row.status)} research row` : "Research row context",
    summary: "This explanation describes setup research quality, sample sufficiency, and failure risk. It is not a trade recommendation.",
    confidence: clamp(42 + Math.min(24, sample / 3) + (pf >= 1.2 ? 14 : pf >= 1 ? 5 : -8)),
    positives,
    negatives,
    risks,
    evidence: [
      `Sample count ${sample || "n/a"}`,
      `Profit factor ${pf || "n/a"}`,
      `Average net ${Number.isFinite(avg) ? avg : "n/a"}`,
      row.replayBand ? `Replay band ${row.replayBand}` : "",
    ].filter(Boolean),
    coverage: context.coverage || row.coverage || "Research",
    lastUpdated: row.lastUpdated || "sample",
    breakdown: ScoreBreakdown({ ...row, sampleCount: sample, profitFactor: pf }, "replay_similarity"),
  });
}

function titleCase(value = "") {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function chainComparisonExplanation(rows = [], left = "Solana", right = "Base") {
  const group = (name) => rows.filter((row) => row.chainVenue === name);
  const avg = (items) => Math.round(items.reduce((sum, row) => sum + Number(row.flowScore || 0), 0) / Math.max(1, items.length));
  const leftRows = group(left);
  const rightRows = group(right);
  const leftAvg = avg(leftRows);
  const rightAvg = avg(rightRows);
  const stronger = leftAvg >= rightAvg ? left : right;
  const weaker = stronger === left ? right : left;
  return {
    headline: `${stronger} stronger than ${weaker}`,
    summary: `${stronger} screens stronger because participation breadth, outcome quality, or confirmation is cleaner in the current sample.`,
    confidence: clamp(55 + Math.abs(leftAvg - rightAvg)),
    positives: [
      `${stronger} has broader participation in the visible sample.`,
      `${stronger} shows cleaner confirmation across tracked rows.`,
    ],
    negatives: [
      `${weaker} has thinner sample depth or fewer clean outcomes.`,
    ],
    risks: ["Chain comparison is sample-dependent and should update as fresh rows arrive."],
    evidence: [`${left} average flow ${leftAvg}`, `${right} average flow ${rightAvg}`],
  };
}

export function structureTapeItems(rows = [], mode = "flow") {
  const now = new Date().toISOString().slice(11, 16);
  const paying = rows.filter((row) => row.participationOutcome === "Paying").length;
  const punishing = rows.filter((row) => row.participationOutcome === "Punishing").length;
  const elevated = rows.filter((row) => row.risk === "Elevated").length;
  const top = [...rows].sort((a, b) => Number(b.flowScore || 0) - Number(a.flowScore || 0))[0];
  return [
    {
      time: now,
      title: `${top?.asset || "Market"} leads current ${mode} structure`,
      detail: `Flow score ${top?.flowScore ?? "n/a"} with ${top?.participantActivity || "visible"} participant activity.`,
      metric: "flowScore",
      target: top?.asset || "",
    },
    {
      time: now,
      title: `Participation outcomes: ${paying} paying, ${punishing} punishing`,
      detail: "Outcome mix is used as context for heatmap and participant reads.",
      metric: "participationOutcome",
      target: "heatmap",
    },
    {
      time: now,
      title: `${elevated} elevated risk flags in current view`,
      detail: "Risk flags reflect liquidity, pressure, or confirmation weakness.",
      metric: "risk",
      target: "risk",
    },
  ];
}
