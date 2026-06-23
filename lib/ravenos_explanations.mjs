function clamp(value, min = 0, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
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
  const breakdown = scoreBreakdown(row);
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

  return {
    headline,
    summary,
    confidence,
    positives,
    negatives,
    risks,
    evidence,
    breakdown,
  };
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
