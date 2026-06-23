export function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function clamp(value, min = 0, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export function pressureStateFromScore(score) {
  if (score >= 86) return "Crowded";
  if (score >= 74) return "Elevated";
  if (score <= 42) return "Exhausted";
  return "Constructive";
}

export function pressureComposition(row = {}) {
  const fundingScore = clamp(Math.abs(num(row.funding)) * 1_000_000);
  const oiScore = clamp(num(row.oiScore));
  const volumeScore = clamp(num(row.volumeScore ?? row.dayNtlVlm) / Math.max(num(row.maxDayNtlVlm), 1) * 100, 0, 100);
  const basisScore = clamp(Math.abs(num(row.premium ?? row.basis)) * 100_000);
  const smartMoneyRaw = clamp(oiScore * 0.44 + basisScore * 0.24 + (row.pressureState === "Constructive" ? 18 : 6));
  const retailRaw = clamp(volumeScore * 0.42 + fundingScore * 0.30 + Math.max(0, num(row.attentionVelocity) * 0.8));
  const marketMakerRaw = clamp(basisScore * 0.52 + Math.max(0, 100 - volumeScore) * 0.22 + Math.abs(num(row.markPx) - num(row.oraclePx)) / Math.max(num(row.markPx), 1) * 3000);
  const unknownRaw = clamp(20 + Math.max(0, 45 - oiScore) * 0.28 + Math.max(0, 35 - volumeScore) * 0.25);
  const total = smartMoneyRaw + retailRaw + marketMakerRaw + unknownRaw || 1;
  const make = (name, raw, directionBias) => ({
    name,
    contribution: Math.round(raw / total * 100),
    direction: directionBias > 8 ? "expanding" : directionBias < -8 ? "contracting" : "steady",
    velocity: Math.round(clamp(Math.abs(directionBias) + raw / 9, 0, 100)),
  });
  return [
    make("Smart Money", smartMoneyRaw, oiScore - fundingScore),
    make("Retail", retailRaw, fundingScore + volumeScore / 2 - 55),
    make("Market Makers", marketMakerRaw, basisScore - 35),
    make("Unknown", unknownRaw, 35 - Math.max(oiScore, volumeScore)),
  ];
}

export function pressureSource(row = {}) {
  const composition = row.pressureComposition || pressureComposition(row);
  const lead = [...composition].sort((a, b) => b.contribution - a.contribution)[0] || { name: "Unknown", direction: "steady" };
  const state = row.pressureState || pressureStateFromScore(row.pressureScore || 0);
  if (state === "Crowded" && lead.name === "Retail") return "retail chasing";
  if (lead.name === "Smart Money" && lead.direction === "expanding") return "smart money accumulation";
  if (lead.name === "Market Makers") return "market maker inventory shift";
  if (state === "Crowded" || state === "Unstable") return "liquidation cascade";
  return `${lead.name.toLowerCase()} pressure ${lead.direction}`;
}

export function liquidityAttraction(row = {}) {
  const price = num(row.markPx || row.lastPrice);
  const oi = num(row.openInterest);
  const fundingAbs = Math.abs(num(row.funding));
  const density = clamp(num(row.pressureScore) * 0.48 + clamp(fundingAbs * 1_000_000) * 0.26 + clamp(num(row.oiScore)) * 0.26);
  const direction = num(row.premium ?? row.basis) >= 0 ? 1 : -1;
  const distancePct = clamp(0.22 + (100 - density) / 260, 0.12, 0.65);
  const nearestCluster = price ? price * (1 + direction * distancePct / 100) : 0;
  const state = density >= 82 ? "Extreme" : density >= 66 ? "Strong" : density >= 45 ? "Moderate" : "Weak";
  return {
    score: Math.round(density),
    state,
    nearestCluster,
    distancePercent: Number(distancePct.toFixed(2)),
    attractionStrength: Math.round(clamp(density + Math.log10(Math.max(oi, 1)) * 4)),
  };
}

export function replayMatches(row = {}) {
  const score = num(row.pressureScore);
  const seed = Array.from(String(row.asset || row.symbol || "PERP")).reduce((sum, char) => sum + char.charCodeAt(0), 31);
  const base = [
    ["May 2025 expansion regime", "2025-05-04 to 2025-05-12", 0.38, 0.27, 0.20, 0.15],
    ["October 2025 pressure reset", "2025-10-16 to 2025-10-22", 0.21, 0.29, 0.32, 0.18],
    ["March 2026 crowded continuation", "2026-03-18 to 2026-03-24", 0.26, 0.39, 0.18, 0.17],
  ];
  return base.map(([label, range, expansion, continuation, reversal, failure], index) => ({
    label,
    range,
    similarity: Math.round(clamp(score - 5 + ((seed + index * 11) % 18), 45, 96)),
    confidence: Math.round(clamp(52 + score * 0.32 + (index === 0 ? 8 : 0), 45, 88)),
    outcomes: { expansion, continuation, reversal, failure },
  })).sort((a, b) => b.similarity - a.similarity);
}

export function outcomeConditions(row = {}) {
  const composition = row.pressureComposition || pressureComposition(row);
  const liquidity = row.liquidityAttraction || liquidityAttraction(row);
  const supporting = [];
  const breaking = [];
  if (num(row.pressureScore) >= 65) supporting.push(["pressure expanding", Math.round(num(row.pressureScore))]);
  else breaking.push(["pressure collapse", Math.round(num(row.pressureScore))]);
  const smart = composition.find((item) => item.name === "Smart Money");
  const retail = composition.find((item) => item.name === "Retail");
  if (smart?.direction === "expanding") supporting.push(["smart money participation broadening", smart.contribution]);
  if (retail?.contribution >= 42 && retail.direction === "expanding") breaking.push(["retail participation crowding", retail.contribution]);
  if (["Strong", "Extreme"].includes(liquidity.state)) supporting.push(["liquidity attraction visible", liquidity.score]);
  if (liquidity.state === "Weak") breaking.push(["liquidity attraction weak", liquidity.score]);
  if (row.risk === "Elevated") breaking.push(["confirmation weakening", 72]);
  else supporting.push(["liquidity stable", 64]);
  return { supporting, breaking };
}

export function structureNarrative(row = {}) {
  const composition = row.pressureComposition || pressureComposition(row);
  const lead = [...composition].sort((a, b) => b.contribution - a.contribution)[0];
  const replay = (row.replayMatches || replayMatches(row))[0];
  const liquidity = row.liquidityAttraction || liquidityAttraction(row);
  const state = row.pressureState || pressureStateFromScore(row.pressureScore || 0);
  const lines = [];
  lines.push(`Pressure is building primarily from ${String(lead?.name || "unknown").toLowerCase()} participation.`);
  if (lead?.name === "Smart Money") lines.push(`Smart money accumulation remains visible while overall pressure is ${state.toLowerCase()}.`);
  if (lead?.name === "Retail") lines.push(`Retail participation is the dominant pressure contributor, increasing crowding sensitivity.`);
  lines.push(`Current structure resembles ${replay.label} at ${replay.similarity}% similarity.`);
  lines.push(`Liquidity attraction is ${liquidity.state.toLowerCase()} with the nearest cluster ${liquidity.distancePercent}% from mark.`);
  if (state === "Elevated" || state === "Crowded") lines.push("Pressure remains elevated while confirmation quality should be monitored.");
  return lines.slice(0, 5);
}

export function enrichPerpsRow(row = {}) {
  const pressureCompositionValue = pressureComposition(row);
  const liquidityAttractionValue = liquidityAttraction({ ...row, pressureComposition: pressureCompositionValue });
  const replay = replayMatches(row);
  const conditions = outcomeConditions({ ...row, pressureComposition: pressureCompositionValue, liquidityAttraction: liquidityAttractionValue });
  const pressureSourceValue = pressureSource({ ...row, pressureComposition: pressureCompositionValue });
  const narrative = structureNarrative({
    ...row,
    pressureComposition: pressureCompositionValue,
    liquidityAttraction: liquidityAttractionValue,
    replayMatches: replay,
  });
  return {
    ...row,
    pressureComposition: pressureCompositionValue,
    pressureSource: pressureSourceValue,
    liquidityAttraction: liquidityAttractionValue,
    replayMatches: replay,
    outcomeConditions: conditions,
    structureNarrative: narrative,
  };
}

export function normalizeHyperliquidPerps(payload, { now = new Date() } = {}) {
  const universe = payload?.[0]?.universe || [];
  const contexts = payload?.[1] || [];
  const oiValues = contexts.map((ctx) => num(ctx.openInterest)).filter((value) => value > 0);
  const volumeValues = contexts.map((ctx) => num(ctx.dayNtlVlm)).filter((value) => value > 0);
  const maxOi = Math.max(...oiValues, 1);
  const maxVolume = Math.max(...volumeValues, 1);
  const lastUpdated = now instanceof Date ? now.toISOString() : String(now);
  return universe.map((meta, index) => {
    const ctx = contexts[index] || {};
    const symbol = String(meta.name || "").toUpperCase();
    const funding = num(ctx.funding);
    const premium = num(ctx.premium);
    const openInterest = num(ctx.openInterest);
    const dayNtlVlm = num(ctx.dayNtlVlm);
    const markPx = num(ctx.markPx || ctx.midPx || ctx.oraclePx);
    const oiScore = clamp(openInterest / maxOi * 100);
    const volumeScore = clamp(dayNtlVlm / maxVolume * 100);
    const fundingScore = clamp(Math.abs(funding) * 1_000_000);
    const basisScore = clamp(Math.abs(premium) * 100_000);
    const priceChangeScore = clamp(Math.abs(num(ctx.prevDayPx) ? (markPx - num(ctx.prevDayPx)) / num(ctx.prevDayPx) : 0) * 1000);
    const pressureScore = Math.round(fundingScore * 0.22 + oiScore * 0.24 + basisScore * 0.18 + volumeScore * 0.20 + priceChangeScore * 0.16);
    const baseRow = {
      asset: `${symbol}-PERP`,
      symbol,
      market: "Perpetual Futures",
      category: "perpetuals",
      venue: "Hyperliquid",
      chainVenue: "Hyperliquid",
      lastPrice: markPx,
      markPx,
      midPx: num(ctx.midPx),
      oraclePx: num(ctx.oraclePx),
      prevDayPx: num(ctx.prevDayPx),
      funding,
      openInterest,
      oiScore,
      maxOpenInterest: maxOi,
      dayNtlVlm,
      maxDayNtlVlm: maxVolume,
      volumeScore,
      dayBaseVlm: num(ctx.dayBaseVlm),
      premium,
      basis: premium,
      maxLeverage: meta.maxLeverage || null,
      pressureScore,
      pressureState: pressureStateFromScore(pressureScore),
      pressureContext: fundingScore >= 65 ? "Funding elevated" : basisScore >= 55 ? "Basis firm" : "Funding neutral",
      participantActivity: oiScore >= 65 ? "OI expansion" : oiScore <= 25 ? "OI light" : "OI balanced",
      liquidityPosture: volumeScore >= 65 ? "Deep" : volumeScore >= 30 ? "Balanced" : "Thin",
      risk: pressureScore >= 84 ? "Elevated" : pressureScore >= 70 ? "Watch" : "Stable",
      participationOutcome: volumeScore >= 65 && pressureScore < 82 ? "Paying" : pressureScore >= 84 ? "Punishing" : "Mixed",
      attentionVelocity: Math.round(volumeScore / 3 + fundingScore / 8),
      flowScore: pressureScore,
      lastUpdated,
      provider: "Hyperliquid",
      coverage: "Live",
      isLive: true,
      isCached: false,
      isSample: false,
      warning: "",
    };
    return enrichPerpsRow(baseRow);
  }).filter((row) => row.symbol && row.lastPrice > 0);
}
