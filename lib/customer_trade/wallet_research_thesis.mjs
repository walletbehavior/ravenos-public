export const WALLET_RESEARCH_THESIS_SCHEMA = "ravenos.wallet_research_thesis.v1";

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function finite(value, { minimum = -Number.MAX_VALUE, maximum = Number.MAX_VALUE } = {}) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function integer(value, limits = {}) {
  const parsed = finite(value, limits);
  return parsed !== null && Number.isSafeInteger(parsed) ? parsed : null;
}

function percent(value) {
  const parsed = finite(value, { minimum: 0, maximum: 100 });
  return parsed === null ? null : Number(parsed.toFixed(2));
}

function compactPercent(value) {
  const parsed = finite(value);
  if (parsed === null) return "unavailable";
  return `${Number(parsed.toFixed(parsed % 1 ? 1 : 0))}%`;
}

function compactDuration(seconds) {
  const parsed = finite(seconds, { minimum: 0 });
  if (parsed === null) return null;
  if (parsed < 60) return `${Math.round(parsed)}s`;
  if (parsed < 3_600) return `${Math.round(parsed / 60)}m`;
  if (parsed < 86_400) return `${Number((parsed / 3_600).toFixed(parsed < 7_200 ? 1 : 0))}h`;
  return `${Number((parsed / 86_400).toFixed(parsed < 172_800 ? 1 : 0))}d`;
}

function finding(code, label, value = null, unit = null) {
  return { code, label, value, unit };
}

function settlementDirection(usdc, sol) {
  const observations = [finite(usdc), finite(sol)].filter((value) => value !== null);
  if (!observations.length) return "unavailable";
  const directions = new Set(observations.map((value) => value > 0 ? "positive" : value < 0 ? "negative" : "flat"));
  return directions.size === 1 ? [...directions][0] : "mixed_bases";
}

function timingStyle(medianHoldSeconds) {
  const seconds = finite(medianHoldSeconds, { minimum: 0 });
  if (seconds === null) return { state: "unavailable", label: "Timing unresolved", median_hold_seconds: null };
  if (seconds < 30) return { state: "very_fast", label: "Very fast cycle", median_hold_seconds: seconds };
  if (seconds <= 300) return { state: "fast", label: "Fast cycle", median_hold_seconds: seconds };
  if (seconds <= 3_600) return { state: "intraday", label: "Intraday", median_hold_seconds: seconds };
  if (seconds <= 604_800) return { state: "swing", label: "Swing", median_hold_seconds: seconds };
  return { state: "position", label: "Position", median_hold_seconds: seconds };
}

function evidenceStrength({ closedObservations, knownCostBasisPct, reconstructionConfidencePct }) {
  if (closedObservations !== null && closedObservations >= 10
    && knownCostBasisPct !== null && knownCostBasisPct >= 80
    && reconstructionConfidencePct !== null && reconstructionConfidencePct >= 80) {
    return { state: "reviewable", label: "Reviewable evidence" };
  }
  if (closedObservations !== null && closedObservations >= 3
    && knownCostBasisPct !== null && knownCostBasisPct >= 50
    && reconstructionConfidencePct !== null && reconstructionConfidencePct >= 60) {
    return { state: "developing", label: "Developing evidence" };
  }
  return { state: "insufficient_evidence", label: "Thin evidence" };
}

function edgeShape({ direction, closedObservations, profitableObservations, topOneConcentrationPct, profitFactor }) {
  if (direction === "mixed_bases") return { state: "mixed_settlement_bases", label: "Mixed source results" };
  if (direction === "negative") return { state: "negative_observed_record", label: "Negative source record" };
  if (direction === "flat") return { state: "flat_observed_record", label: "Flat source record" };
  if (direction !== "positive") return { state: "insufficient_evidence", label: "Source record forming" };
  if (topOneConcentrationPct !== null && topOneConcentrationPct >= 70) {
    return { state: "concentrated_positive_record", label: "Concentrated positive record" };
  }
  if (closedObservations !== null && closedObservations >= 8
    && profitableObservations !== null && profitableObservations >= 5
    && topOneConcentrationPct !== null && topOneConcentrationPct <= 50
    && (profitFactor === null || profitFactor > 1)) {
    return { state: "broad_positive_record", label: "Broad positive record" };
  }
  return { state: "developing_positive_record", label: "Developing positive record" };
}

function headlineFor({ edge, timing }) {
  const timingSuffix = timing.state === "unavailable" ? "" : ` · ${timing.label.toLowerCase()}`;
  if (edge.state === "broad_positive_record") return `Broad source profits${timingSuffix}`;
  if (edge.state === "concentrated_positive_record") return `Positive source record, concentrated in a top winner${timingSuffix}`;
  if (edge.state === "developing_positive_record") return `Positive source record still developing${timingSuffix}`;
  if (edge.state === "negative_observed_record") return `Negative source record${timingSuffix}`;
  if (edge.state === "flat_observed_record") return `Flat source record${timingSuffix}`;
  if (edge.state === "mixed_settlement_bases") return `USDC and SOL results disagree${timingSuffix}`;
  return `Not enough known-cost closes to characterize this wallet${timingSuffix}`;
}

function summaryFor({ edge, topOneConcentrationPct, profitableObservations, closedObservations, timing }) {
  const cadence = timing.median_hold_seconds === null ? "" : ` Median observed hold: ${compactDuration(timing.median_hold_seconds)}.`;
  if (edge.state === "broad_positive_record") {
    return `${profitableObservations} profitable closes are observed; the largest winner contributes ${compactPercent(topOneConcentrationPct)} of gross positive realized P&L.${cadence}`;
  }
  if (edge.state === "concentrated_positive_record") {
    return `The largest winner contributes ${compactPercent(topOneConcentrationPct)} of gross positive realized P&L, so the headline result may not represent a repeatable pattern.${cadence}`;
  }
  if (edge.state === "developing_positive_record") {
    return `${closedObservations ?? "A limited number of"} known-cost closes currently support a positive source result, but breadth is not yet established.${cadence}`;
  }
  if (edge.state === "negative_observed_record") return `Known-cost closes are net negative on the observed settlement basis.${cadence}`;
  if (edge.state === "flat_observed_record") return `Known-cost closes are approximately flat on the observed settlement basis.${cadence}`;
  if (edge.state === "mixed_settlement_bases") return `USDC- and SOL-settled results are kept separate and point in different directions; Raven does not combine them into a fictional total.${cadence}`;
  return `The retained history does not yet support a source-performance thesis.${cadence}`;
}

export function buildWalletResearchThesis(input = {}) {
  const performance = input.performance || {};
  const behavior = input.behavior || {};
  const quality = input.quality || {};
  const profitQuality = input.profit_quality || {};
  const follower = input.follower_reality || {};
  const closedObservations = integer(performance.closed_observations ?? performance.closed_lots, { minimum: 0 });
  const profitableObservations = integer(profitQuality.profitable_observations, { minimum: 0 });
  const profitFactor = finite(performance.profit_factor, { minimum: 0 });
  const topOneConcentrationPct = percent(profitQuality.top_1_profit_concentration_pct);
  const weeklyProfitablePct = percent(profitQuality.weekly_profitable_pct);
  const knownCostBasisPct = percent(quality.known_cost_basis_pct ?? quality.cost_basis_coverage_pct);
  const reconstructionConfidencePct = percent(quality.reconstruction_confidence_pct);
  const tradeCount = integer(behavior.trade_count, { minimum: 0 });
  const activeDays = integer(behavior.active_days, { minimum: 0 });
  const direction = settlementDirection(performance.realized_pnl_usdc, performance.realized_pnl_sol);
  const timing = timingStyle(behavior.median_hold_seconds);
  const evidence = evidenceStrength({ closedObservations, knownCostBasisPct, reconstructionConfidencePct });
  const edge = edgeShape({ direction, closedObservations, profitableObservations, topOneConcentrationPct, profitFactor });
  const strengths = [];
  const watchouts = [];
  const nextEvidence = [];

  if (profitFactor !== null && profitFactor >= 1.5) strengths.push(finding("profit_factor_strength", `${Number(profitFactor.toFixed(2))}× profit factor on the available settlement basis.`, profitFactor, "ratio"));
  if (topOneConcentrationPct !== null && topOneConcentrationPct <= 50 && profitableObservations !== null && profitableObservations >= 5) strengths.push(finding("profit_breadth", `${profitableObservations} profitable closes with ${compactPercent(topOneConcentrationPct)} from the largest winner.`, profitableObservations, "observations"));
  if (weeklyProfitablePct !== null && weeklyProfitablePct >= 60) strengths.push(finding("profitable_periods", `${compactPercent(weeklyProfitablePct)} of observed active weeks were profitable.`, weeklyProfitablePct, "percent"));
  if (knownCostBasisPct !== null && reconstructionConfidencePct !== null && knownCostBasisPct >= 80 && reconstructionConfidencePct >= 80) strengths.push(finding("reconstruction_quality", `${compactPercent(knownCostBasisPct)} known cost basis and ${compactPercent(reconstructionConfidencePct)} reconstruction confidence.`, reconstructionConfidencePct, "percent"));
  if (!strengths.length && tradeCount !== null && activeDays !== null && tradeCount > 0) strengths.push(finding("observed_activity", `${tradeCount} normalized trades across ${activeDays} active ${activeDays === 1 ? "day" : "days"}.`, tradeCount, "trades"));

  if (direction === "mixed_bases") watchouts.push(finding("settlement_bases_disagree", "USDC and SOL results disagree and cannot be honestly combined.", null, null));
  if (direction === "negative") watchouts.push(finding("negative_source_record", "Known-cost source results are net negative on the available settlement basis.", null, null));
  if (topOneConcentrationPct !== null && topOneConcentrationPct >= 70) watchouts.push(finding("largest_winner_dependence", `${compactPercent(topOneConcentrationPct)} of gross positive realized P&L came from the largest winner.`, topOneConcentrationPct, "percent"));
  if (knownCostBasisPct === null || knownCostBasisPct < 80) watchouts.push(finding("cost_basis_gap", knownCostBasisPct === null ? "Cost-basis coverage is unavailable." : `Only ${compactPercent(knownCostBasisPct)} of observed trade cost basis is known.`, knownCostBasisPct, "percent"));
  if (reconstructionConfidencePct === null || reconstructionConfidencePct < 75) watchouts.push(finding("reconstruction_gap", reconstructionConfidencePct === null ? "Reconstruction confidence is unavailable." : `Reconstruction confidence is ${compactPercent(reconstructionConfidencePct)}.`, reconstructionConfidencePct, "percent"));
  if (closedObservations === null || closedObservations < 10) watchouts.push(finding("small_closed_sample", `${closedObservations ?? 0} known-cost closed ${closedObservations === 1 ? "observation" : "observations"}; source results may be sample-sensitive.`, closedObservations, "observations"));
  if (timing.median_hold_seconds !== null && timing.median_hold_seconds <= 300 && String(follower.state || "not_sampled") === "not_sampled") watchouts.push(finding("latency_sensitivity_unmeasured", "Fast holds may not survive detection and quote latency; prospective follower evidence is not sampled.", timing.median_hold_seconds, "seconds"));

  if (String(follower.state || "not_sampled") === "not_sampled") nextEvidence.push(finding("prospective_copy_evidence", "Collect prospective Shadow entry, reverse-exit, latency, and refusal evidence before judging copyability.", null, null));
  if (quality.source_history_complete !== true) nextEvidence.push(finding("history_depth", "Extend the retained source history without rewriting prior observations.", null, null));
  if (String(input.entry_quality_state || "unavailable") !== "available") nextEvidence.push(finding("entry_context", "Retain contemporaneous entry liquidity, market-cap, token-age, and impact evidence.", null, null));
  if (knownCostBasisPct === null || knownCostBasisPct < 90) nextEvidence.push(finding("basis_resolution", "Resolve more transferred or pre-existing inventory before increasing performance confidence.", null, null));

  return freeze({
    schema_version: WALLET_RESEARCH_THESIS_SCHEMA,
    thesis_version: 1,
    state: evidence.state,
    headline: headlineFor({ edge, timing }),
    summary: summaryFor({ edge, topOneConcentrationPct, profitableObservations, closedObservations, timing }),
    source_edge: edge,
    timing_style: timing,
    evidence_strength: evidence,
    strengths: strengths.slice(0, 3),
    watchouts: watchouts.slice(0, 3),
    next_evidence: nextEvidence.slice(0, 3),
    follower_reality: {
      state: String(follower.state || "not_sampled"),
      source_performance_used_as_follower_performance: false,
    },
    claim_boundary: {
      wallet_identity_claimed: false,
      bot_identity_claimed: false,
      smart_money_claimed: false,
      copyability_claimed: false,
      calibrated_alpha_claimed: false,
      settlement_bases_combined: false,
    },
  });
}
