import { normalizeConfidence } from "./ravenos_confidence.mjs";
import { normalizeCoverage } from "./ravenos_coverage.mjs";

export const PARTICIPANT_CATEGORIES = ["smart_money", "retail", "market_makers", "unknown"];

function clamp(value, min = 0, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function seedFor(value = "") {
  return Array.from(String(value || "RAVEN")).reduce((sum, char) => sum + char.charCodeAt(0), 41);
}

function direction(value) {
  const n = Number(value);
  if (n > 8) return "expanding";
  if (n < -8) return "contracting";
  return "steady";
}

export function participantBreakdown(row = {}) {
  if (Array.isArray(row.participants) && row.participants.length) return row.participants.map(normalizeParticipant);
  const seed = seedFor(row.instrument || row.asset || row.market);
  const flow = clamp(row.flowScore ?? row.pressureScore ?? 55);
  const attention = Number(row.attentionVelocity || 0);
  const smartRaw = clamp(flow * 0.42 + (row.risk === "Stable" ? 12 : 0) + (seed % 14));
  const retailRaw = clamp(flow * 0.25 + Math.max(0, attention) * 1.2 + ((seed + 7) % 18));
  const makerRaw = clamp(45 + (String(row.liquidityPosture || "").match(/deep|stable/i) ? 20 : 0) + ((seed + 11) % 12));
  const unknownRaw = clamp(35 + (row.risk === "Elevated" ? 18 : 0) + ((seed + 19) % 10));
  const total = smartRaw + retailRaw + makerRaw + unknownRaw || 1;
  return [
    ["smart_money", smartRaw, smartRaw - retailRaw],
    ["retail", retailRaw, attention],
    ["market_makers", makerRaw, makerRaw - flow],
    ["unknown", unknownRaw, unknownRaw - makerRaw],
  ].map(([category, raw, bias]) => normalizeParticipant({
    category,
    contribution: Math.round(raw / total * 100),
    direction: direction(bias),
    velocity: Math.round(clamp(Math.abs(bias) + raw / 10)),
  }));
}

export function normalizeParticipant(input = {}) {
  const category = PARTICIPANT_CATEGORIES.includes(input.category) ? input.category : "unknown";
  return {
    category,
    label: labelForCategory(category),
    contribution: clamp(input.contribution ?? 0),
    direction: String(input.direction || "steady"),
    velocity: clamp(input.velocity ?? 0),
  };
}

export function participantIntelligence(row = {}, context = {}) {
  const participants = participantBreakdown(row);
  const lead = [...participants].sort((a, b) => b.contribution - a.contribution)[0] || normalizeParticipant();
  const smart = participants.find((item) => item.category === "smart_money") || {};
  const retail = participants.find((item) => item.category === "retail") || {};
  const concentrationChange = concentrationState(row, participants);
  const distributionRisk = distributionRiskState(row, participants);
  const accumulationState = accumulationStateFor(smart, distributionRisk);
  const conflictState = smart.direction !== retail.direction && smart.contribution >= 20 && retail.contribution >= 20 ? "conflicted" : "aligned";
  const coverage = normalizeCoverage(context.coverage || row.coverage || "Preview");
  const confidence = normalizeConfidence({
    sampleCount: row.sampleCount || 40,
    replaySimilarity: row.replaySimilarity || row.flowScore,
    coverage,
  });
  return {
    headline: `${lead.label} contribution leads participant read`,
    summary: "Participant Intelligence describes which behavior groups are contributing to pressure and structure. It does not expose wallet addresses or copy-trading instructions.",
    participants,
    leadParticipant: lead,
    pressureContribution: participants,
    conflictState,
    concentrationChange,
    distributionRisk,
    accumulationState,
    confidence,
    coverage,
    evidence: [
      `Lead participant: ${lead.label}`,
      `Conflict state: ${conflictState}`,
      `Concentration: ${concentrationChange}`,
      `Distribution risk: ${distributionRisk}`,
      `Accumulation: ${accumulationState}`,
    ],
  };
}

export function participantOverlayMarkers(row = {}, candles = []) {
  const usable = Array.isArray(candles) ? candles.filter((candle) => candle?.time) : [];
  const mid = usable[Math.floor(usable.length / 2)]?.time;
  const late = usable[Math.max(0, usable.length - 3)]?.time;
  const last = usable[Math.max(0, usable.length - 1)]?.time;
  const intel = participantIntelligence(row);
  return [
    {
      id: `${row.asset || row.instrument || "asset"}-participant-lead`,
      type: "participant-shift",
      time: mid,
      label: `${intel.leadParticipant.label} shift`,
      value: intel.leadParticipant.contribution,
      severity: intel.leadParticipant.category === "smart_money" ? "success" : "info",
      source: "participant",
      summary: `Behavior signal: ${intel.leadParticipant.label} is the largest participant contribution.`,
      metadata: { participantCategory: intel.leadParticipant.category },
    },
    {
      id: `${row.asset || row.instrument || "asset"}-concentration`,
      type: "participant-shift",
      time: late,
      label: `Concentration ${intel.concentrationChange}`,
      value: intel.leadParticipant.velocity,
      severity: intel.concentrationChange === "increasing" ? "warning" : "info",
      source: "participant",
      summary: `Concentration state is ${intel.concentrationChange}.`,
      metadata: { concentrationChange: intel.concentrationChange },
    },
    {
      id: `${row.asset || row.instrument || "asset"}-distribution`,
      type: "participant-shift",
      time: last,
      label: `Distribution risk ${intel.distributionRisk}`,
      value: intel.leadParticipant.velocity,
      severity: intel.distributionRisk === "elevated" ? "danger" : "info",
      source: "participant",
      summary: `Distribution risk is ${intel.distributionRisk}.`,
      metadata: { distributionRisk: intel.distributionRisk },
    },
  ].filter((item) => item.time);
}

function labelForCategory(category) {
  return {
    smart_money: "Smart Money",
    retail: "Retail",
    market_makers: "Market Makers",
    unknown: "Unknown",
  }[category] || "Unknown";
}

function concentrationState(row, participants) {
  if (row.concentrationChange) return String(row.concentrationChange);
  const lead = Math.max(...participants.map((item) => item.contribution));
  if (lead >= 45 || row.risk === "Elevated") return "increasing";
  if (lead <= 28) return "decreasing";
  return "stable";
}

function distributionRiskState(row, participants) {
  if (row.distributionRisk) return String(row.distributionRisk);
  const retail = participants.find((item) => item.category === "retail") || {};
  const smart = participants.find((item) => item.category === "smart_money") || {};
  if (row.risk === "Elevated" || (retail.direction === "expanding" && smart.direction === "contracting")) return "elevated";
  if (smart.direction === "expanding") return "contained";
  return "moderate";
}

function accumulationStateFor(smart = {}, distributionRisk = "moderate") {
  if (smart.direction === "expanding" && distributionRisk !== "elevated") return "accumulating";
  if (smart.direction === "contracting") return "reducing";
  return "neutral";
}
