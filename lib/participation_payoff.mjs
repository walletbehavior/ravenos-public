const MIN_USABLE_SAMPLE = 20;
const REWARDING = "participation rewarding";
const PUNISHING = "participation punishing";

const CHAIN_LABELS = Object.freeze({
  arbitrum: "Arbitrum",
  base: "Base",
  bnb: "BNB Chain",
  eth: "Ethereum",
  ethereum: "Ethereum",
  hyperliquid: "Hyperliquid",
  polygon: "Polygon",
  pulsechain: "PulseChain",
  robinhood: "Robinhood Chain",
  solana: "Solana",
});

const BAND_LABELS = Object.freeze({
  all: "broad market",
  fresh_pairs: "fresh pairs",
  large: "large caps",
  mega: "mega caps",
  micro: "micro caps",
  mid: "mid caps",
  participant_cohorts: "cohorts",
  perps_all: "perps",
  perps_alts: "perp altcoins",
  perps_large_alts: "large-cap perps",
  perps_majors: "major perps",
  small: "small caps",
});

function text(value) {
  return String(value ?? "").trim();
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function usableSample(row = {}) {
  return finite(row.usable_sample ?? row.clean_sample ?? row.sample_summary?.usable) ?? 0;
}

function observedSample(row = {}) {
  return finite(row.observed_sample ?? row.sample_size ?? row.sample_summary?.observed) ?? usableSample(row);
}

function chainLabel(value) {
  const clean = text(value).toLowerCase();
  return CHAIN_LABELS[clean] || clean.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function bandLabel(value) {
  const clean = text(value).toLowerCase();
  return BAND_LABELS[clean] || clean.replaceAll("_", " ");
}

function subjectLabel(row = {}) {
  const chain = chainLabel(row.chain);
  const band = text(row.cap_band).toLowerCase();
  if (band === "perps_all") return `${chain} perps`;
  if (band === "perps_alts") return `${chain} perp altcoins`;
  if (band === "perps_large_alts") return `${chain} large-cap perps`;
  if (band === "perps_majors") return `${chain} major perps`;
  if (band === "all") return chain;
  return `${chain} ${bandLabel(band)}`;
}

function rowKey(row = {}) {
  return `${text(row.chain).toLowerCase()}|${text(row.cap_band).toLowerCase()}|${text(row.window || row.timeframe).toLowerCase()}`;
}

function publicWindow(value) {
  const clean = text(value).toLowerCase();
  return clean === "live" ? "current" : clean;
}

function outcomeIndex(outcomes = []) {
  const index = new Map();
  for (const row of outcomes) {
    if (!row || row.public_safe !== true) continue;
    index.set(rowKey(row), row);
  }
  return index;
}

function matchingOutcome(row, index) {
  const exact = index.get(rowKey(row));
  if (exact) return exact;
  const prefix = `${text(row.chain).toLowerCase()}|${text(row.cap_band).toLowerCase()}|`;
  return [...index.entries()].find(([key]) => key.startsWith(prefix))?.[1] || null;
}

function hasOutcomeAuthority(row, outcomes) {
  const outcome = matchingOutcome(row, outcomes);
  if (!outcome) return false;
  const source = text(outcome.source).toLowerCase();
  if (["dexscreener_public_market_context", "jupiter_helius_public_cohort_validation"].includes(source)) return true;
  return [
    outcome.median_h6_move_pct,
    outcome.median_move_pct,
    outcome.median_mfe_pct,
    outcome.positive_mfe_pct,
  ].some((value) => finite(value) !== null);
}

function isEligible(row = {}, outcomes = new Map()) {
  const confidence = text(row.confidence).toLowerCase();
  const band = text(row.cap_band).toLowerCase();
  return row.public_safe === true
    && usableSample(row) >= MIN_USABLE_SAMPLE
    && ["medium", "high"].includes(confidence)
    && !["live_activity", "jupiter_velocity"].includes(band)
    && hasOutcomeAuthority(row, outcomes);
}

function specificity(row = {}) {
  const band = text(row.cap_band).toLowerCase();
  if (band === "participant_cohorts") return 6;
  if (band === "perps_all") return 5;
  if (["fresh_pairs", "micro", "small", "mid", "large", "mega"].includes(band)) return 4;
  if (["perps_majors", "perps_large_alts", "perps_alts"].includes(band)) return 3;
  return band === "all" ? 1 : 2;
}

function candidateScore(row = {}) {
  return specificity(row) * 1_000_000 + Math.min(usableSample(row), 999_999);
}

function selectDistinct(rows, limit, score = candidateScore) {
  const selected = [];
  const represented = new Set();
  for (const row of [...rows].sort((left, right) => score(right) - score(left))) {
    const chain = text(row.chain).toLowerCase();
    const band = text(row.cap_band).toLowerCase();
    if (band === "perps_alts" && represented.has(`${chain}|perps_all`)) continue;
    const family = band.startsWith("perps_") ? `${chain}|perps` : `${chain}|${band}`;
    if (represented.has(family)) continue;
    represented.add(family);
    represented.add(`${chain}|${band}`);
    selected.push(row);
    if (selected.length >= limit) break;
  }
  return selected;
}

function punishingScore(row, outcomes) {
  const outcome = matchingOutcome(row, outcomes);
  const followthrough = finite(outcome?.median_h6_move_pct);
  const severity = followthrough !== null && followthrough < 0 ? Math.abs(followthrough) : 0;
  const freshPairPriority = text(row.cap_band).toLowerCase() === "fresh_pairs" ? 1 : 0;
  return candidateScore(row) + freshPairPriority * 1_000_000 + Math.min(severity, 20) * 100_000;
}

function signedPercent(value) {
  const parsed = finite(value);
  if (parsed === null) return null;
  return `${parsed >= 0 ? "+" : ""}${parsed.toFixed(Math.abs(parsed) < 1 ? 2 : 1)}%`;
}

function insight(row, requestedState, outcomes) {
  const outcome = matchingOutcome(row, outcomes);
  const sixHour = finite(outcome?.median_h6_move_pct);
  const twentyFourHour = finite(outcome?.median_move_pct);
  const rewardingShare = finite(outcome?.rewarding_pct);
  const punishingShare = finite(outcome?.punishing_pct);
  const outcomeSource = text(outcome?.source).toLowerCase();
  const visibleMedianHeldUp = [sixHour, twentyFourHour]
    .some((value) => value !== null && value >= 0);
  const contradictoryStrength = requestedState === "punishing"
    && visibleMedianHeldUp
    && punishingShare !== null
    && punishingShare >= 40;
  const state = contradictoryStrength ? "fragile" : requestedState;
  const observationWindow = publicWindow(outcome?.evidence_contract?.observation_window?.label || outcome?.window || row.window || row.timeframe);
  const settledExpansion = outcomeSource === "jupiter_helius_public_cohort_validation" || finite(outcome?.median_mfe_pct) !== null;
  const settlementWindow = settledExpansion ? text(outcome?.evidence_contract?.settlement_window?.label) : "";
  const subject = subjectLabel(row);
  const operatorDetail = state === "fragile"
    ? [
        sixHour === null ? null : `6h median ${signedPercent(sixHour)}`,
        punishingShare === null ? null : `${Math.round(punishingShare)}% fell 10%+ over 24h`,
      ].filter(Boolean).join(" · ")
    : outcomeSource === "dexscreener_public_market_context"
      ? [
          sixHour === null ? null : `6h ${signedPercent(sixHour)}`,
          twentyFourHour === null ? null : `24h ${signedPercent(twentyFourHour)}`,
        ].filter(Boolean).join(" · ")
      : `${Math.round(usableSample(row)).toLocaleString("en-US")} settled observations`;
  return {
    insight_id: `participation:${text(row.chain).toLowerCase()}:${text(row.cap_band).toLowerCase()}:${state}`,
    state,
    label: state === "rewarding" ? "Working" : state === "fragile" ? "Fragile" : "Punishing",
    subject,
    plain_read: state === "rewarding"
      ? `${subject} are showing the cleanest follow-through.`
      : state === "fragile"
        ? `${subject} are split: the median held up, but the downside tail remains broad.`
        : `${subject} are punishing recent participation.`,
    operator_detail: operatorDetail,
    usable_sample: usableSample(row),
    observed_sample: observedSample(row),
    observation_window: observationWindow || null,
    settlement_window: settlementWindow || null,
    six_hour_median_pct: sixHour,
    twenty_four_hour_median_pct: twentyFourHour,
    rewarding_share_pct: rewardingShare,
    punishing_share_pct: punishingShare,
    outcome_basis: settledExpansion ? "settled_post_observation_expansion" : "trailing_market_distribution",
    confidence: text(row.confidence).toLowerCase(),
    claim_id: text(outcome?.claim_id) || null,
  };
}

function joinSubjects(rows) {
  const labels = rows.map((row) => subjectLabel(row));
  if (labels.length < 2) return labels[0] || "";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

function cohortComparison(rows, outcomes) {
  const cohorts = rows.filter((row) => text(row.cap_band).toLowerCase() === "participant_cohorts" && row.public_safe === true && usableSample(row) >= MIN_USABLE_SAMPLE);
  const authoritative = cohorts.filter((row) => hasOutcomeAuthority(row, outcomes));
  const rewarding = cohorts.filter((row) => text(row.derived_state).toLowerCase() === REWARDING);
  const mixed = cohorts
    .filter((row) => text(row.derived_state).toLowerCase() === "outcomes unclear")
    .sort((left, right) => {
      const order = { eth: 0, ethereum: 0, base: 1 };
      return (order[text(left.chain).toLowerCase()] ?? 9) - (order[text(right.chain).toLowerCase()] ?? 9);
    });
  const supportedRewarding = rewarding.filter((row) => authoritative.includes(row));
  if (!supportedRewarding.length || !mixed.length) return null;
  return `${joinSubjects(supportedRewarding.slice(0, 1))} have settled follow-through; ${joinSubjects(mixed.slice(0, 2))} remain mixed.`;
}

export function buildParticipationPayoffProjection(outcomesData = {}, behaviorData = {}) {
  const rows = Array.isArray(behaviorData?.rows) ? behaviorData.rows : [];
  const outcomes = outcomeIndex(Array.isArray(outcomesData?.outcomes) ? outcomesData.outcomes : []);
  const rewarding = selectDistinct(
    rows.filter((row) => isEligible(row, outcomes) && text(row.derived_state).toLowerCase() === REWARDING),
    2,
  );
  const punishing = selectDistinct(
    rows.filter((row) => isEligible(row, outcomes) && text(row.derived_state).toLowerCase() === PUNISHING),
    2,
    (row) => punishingScore(row, outcomes),
  );
  if (!rewarding.length && !punishing.length) return null;

  const insights = [
    ...rewarding.map((row) => insight(row, "rewarding", outcomes)),
    ...punishing.map((row) => insight(row, "punishing", outcomes)),
  ];
  const generatedAt = [outcomesData?.generated_at, behaviorData?.generated_at]
    .map((value) => text(value))
    .filter(Boolean)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || null;

  return {
    schema_version: "ravenos.participation_payoff.v1",
    generated_at: generatedAt,
    state: "current",
    public_safe: true,
    headline: "Participation payoff",
    summary: insights.map((row) => row.plain_read).join(" "),
    comparison: cohortComparison(rows, outcomes),
    measurement: {
      display_window: "Current outcome windows",
      minimum_usable_sample: MIN_USABLE_SAMPLE,
      population: "Sampled public markets; not a comprehensive market census.",
      causal_claim: false,
    },
    insights,
  };
}
