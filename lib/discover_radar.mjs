const CHAINS = Object.freeze(new Set(["solana", "robinhood", "base", "bsc", "ethereum"]));
const WINDOWS = Object.freeze(["1m", "5m", "15m", "1h", "4h", "24h", "7d"]);
const WINDOW_MINUTES = Object.freeze({ "1m": 1, "5m": 5, "15m": 15, "1h": 60, "4h": 240, "24h": 1_440, "7d": 10_080 });
const BASELINE_WINDOW = Object.freeze({ "1m": "5m", "5m": "1h", "15m": "1h", "1h": "24h", "4h": "24h", "24h": "7d" });

export const DISCOVER_RADAR_SCHEMA = "ravenos.discover_radar.v1";
export const DISCOVER_MARKET_SCHEMA = "ravenos.discover_market.v1";
export const DISCOVER_NOTABILITY_SCHEMA = "ravenos.discover_notability.v1";
export const DISCOVER_CLASSIFIER_NAME = "raven_behavioral_radar";
export const DISCOVER_CLASSIFIER_VERSION = "2026-08-28.2";
export const DISCOVER_MARKET_FACT_TARGET_SECONDS = 120;

export const DISCOVER_NOTABILITY_THRESHOLDS = Object.freeze({
  "5m": 5,
  "1h": 10,
  "24h": 25,
});

const NOTABILITY_ACTIVITY_FLOORS = Object.freeze({
  "5m": Object.freeze({ volume_usd: 1_000, transactions: 6, participants: 4 }),
  "1h": Object.freeze({ volume_usd: 5_000, transactions: 12, participants: 6 }),
  "24h": Object.freeze({ volume_usd: 15_000, transactions: 25, participants: 10 }),
});

const ASSET_TAXONOMIES = Object.freeze(new Set([
  "speculative_or_unclassified",
  "major",
  "wrapped_major",
  "stable",
  "staking",
  "tokenized_asset",
]));

const OPPORTUNITY_LANES = Object.freeze(new Set([
  "emerging_acceleration",
  "breakout_continuation",
  "absorption_accumulation",
  "resurrection_reclaim",
  "distribution_chase_risk",
  "majors_wrapped",
  "reference_assets",
]));

const STABLE_SYMBOLS = new Set(["USDC", "USDT", "USDE", "USDS", "DAI", "FDUSD", "TUSD", "USD1", "USDBC", "USDG"]);
const MAJOR_SYMBOLS = new Set(["BTC", "ETH", "SOL", "BNB"]);
const WRAPPED_MAJOR_SYMBOLS = new Set(["WBTC", "WETH", "WSOL", "WBNB", "CBBTC", "TBTC", "BTCB"]);

export const MIGRATION_COHORTS = Object.freeze(new Set([
  "initial_discovery",
  "pre_migration",
  "post_migration",
  "mature",
  "forming",
]));

export const PRIMARY_BEHAVIOR_STATES = Object.freeze(new Set([
  "forming",
  "initial_discovery",
  "post_migration_expansion",
  "breakout",
  "continuation",
  "pullback_holding",
  "sell_pressure_absorption",
  "reacceleration",
  "extended",
  "distribution",
  "failed_breakout",
  "capitulation",
  "base_building",
  "post_dump_resurrection",
  "reclaiming_range",
  "approaching_ath",
  "ath_breakout",
  "invalidated_dead",
]));

export const RISK_FLAGS = Object.freeze(new Set([
  "late_chase",
  "flow_divergence",
  "liquidity_thinning",
  "high_market_cap_to_liquidity",
  "holder_concentration",
  "bundle_concentration",
  "bundle_distribution",
  "developer_exposure",
  "sniper_concentration",
  "liquidity_control",
  "manipulation_risk",
  "high_turnover",
  "very_new_pool",
  "unrouteable",
]));

export const VELOCITY_STATES = Object.freeze(new Set([
  "insufficient_history",
  "upside_velocity",
  "downside_velocity",
  "reacceleration",
  "exhaustion",
  "divergence",
  "forming",
]));

export const ACTIVITY_STATES = Object.freeze(new Set([
  "insufficient_history",
  "participation_accelerating",
  "participation_decelerating",
  "accumulation",
  "absorption",
  "distribution",
  "balanced",
  "forming",
]));

const ADMISSION_LANES = Object.freeze(new Set([
  "raven_observation",
  "saved_or_monitored_market",
  "short_window_anomaly",
  "migration",
  "breakout_continuation",
  "pullback_absorption",
  "capitulation_resurrection",
  "renewed_mature_activity",
  "recently_removed_from_trending",
  "provider_current_input",
]));

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function marketCapValue(market) {
  const marketCap = finite(market?.market_cap_usd);
  if (marketCap !== null && marketCap > 0) return marketCap;
  const fdv = finite(market?.fdv_usd);
  if (fdv !== null && fdv > 0) return fdv;
  return marketCap ?? fdv;
}

function assetTaxonomy(row, observedAt) {
  const symbol = cleanText(row?.symbol, 32).toUpperCase();
  const name = cleanText(row?.name, 100).toLowerCase();
  let value = "speculative_or_unclassified";
  let reason = "No qualified reference-asset taxonomy matched; the market remains unclassified rather than being asserted to be a meme token.";
  if (STABLE_SYMBOLS.has(symbol) || /\b(?:stablecoin|tether usd|usd coin)\b/.test(name)) {
    value = "stable";
    reason = "Known stable-asset symbol or name.";
  } else if (WRAPPED_MAJOR_SYMBOLS.has(symbol) || /\bwrapped (?:bitcoin|ether|ethereum|sol|bnb)\b/.test(name)) {
    value = "wrapped_major";
    reason = "Known wrapped major-asset symbol or name.";
  } else if (MAJOR_SYMBOLS.has(symbol)) {
    value = "major";
    reason = "Known native major-asset symbol.";
  } else if (/\b(?:liquid staking|staked ether|staked sol|restaked)\b/.test(name) || /^(?:STETH|WSTETH|RETH|CBETH|JITOSOL|MSOL|BNSOL)$/.test(symbol)) {
    value = "staking";
    reason = "Known staking or restaking naming pattern.";
  } else if (/\b(?:tokenized|xstock|stock token|treasury token)\b/.test(name)) {
    value = "tokenized_asset";
    reason = "The provider-facing name explicitly identifies a tokenized real-world or listed asset.";
  }
  return Object.freeze({
    value,
    label: value === "speculative_or_unclassified" ? "Opportunity set" : value.replaceAll("_", " "),
    availability: "available",
    source_scope: "bounded_symbol_and_name_taxonomy",
    observed_at: iso(observedAt),
    freshness: "current",
    default_opportunity_eligible: !["stable", "major", "wrapped_major", "staking", "tokenized_asset"].includes(value),
    classifier: Object.freeze({ name: DISCOVER_CLASSIFIER_NAME, version: DISCOVER_CLASSIFIER_VERSION }),
    reason,
  });
}

function sampleEvidence(measurements, observationCount, observedAt) {
  const transactions = finite(measurements?.transactions?.value);
  const participants = finite(measurements?.participants?.value);
  const coverageFields = [
    "price_change",
    "price_acceleration",
    "volume_acceleration",
    "transaction_rate_acceleration",
    "participant_acceleration",
    "buy_share",
    "liquidity_change",
  ];
  const availableFields = coverageFields.filter((key) => measurements?.[key]?.availability === "available" && finite(measurements[key].value) !== null).length;
  const evidenceCoverage = Math.round((availableFields / coverageFields.length) * 100);
  let state = "fragile";
  if (transactions === null && participants === null) state = "insufficient";
  else if ((transactions ?? 0) >= 100 && (participants ?? 0) >= 30 && observationCount >= 4) state = "robust";
  else if ((transactions ?? 0) >= 20 && (participants ?? transactions ?? 0) >= 8 && observationCount >= 2) state = "developing";
  return Object.freeze({
    state,
    label: state === "robust" ? "Robust sample" : state === "developing" ? "Developing sample" : state === "fragile" ? "Fragile sample" : "Sample unavailable",
    transactions,
    participants,
    stored_observations: observationCount,
    evidence_coverage_pct: evidenceCoverage,
    source_scope: "exact_pool_current_window_and_registry",
    observed_at: iso(observedAt),
    availability: state === "insufficient" ? "insufficient_history" : "available",
    limitation: state === "fragile" ? "Directional percentages from this sample can move sharply with a few transactions." : null,
  });
}

function opportunityLane(states, taxonomy, riskFlags, observedAt, freshnessState = "current") {
  let value = "emerging_acceleration";
  if (["major", "wrapped_major"].includes(taxonomy.value)) value = "majors_wrapped";
  else if (["stable", "staking", "tokenized_asset"].includes(taxonomy.value)) value = "reference_assets";
  else if (["distribution", "extended", "failed_breakout"].includes(states.primary) || riskFlags.includes("late_chase")) value = "distribution_chase_risk";
  else if (["post_dump_resurrection", "reclaiming_range", "approaching_ath", "ath_breakout"].includes(states.primary)) value = "resurrection_reclaim";
  else if (["breakout", "continuation", "reacceleration", "post_migration_expansion"].includes(states.primary)) value = "breakout_continuation";
  else if (["sell_pressure_absorption", "pullback_holding"].includes(states.primary) || ["absorption", "accumulation"].includes(states.activity)) value = "absorption_accumulation";
  return Object.freeze({
    value: OPPORTUNITY_LANES.has(value) ? value : "emerging_acceleration",
    availability: freshnessState === "stale" ? "stale" : "available",
    source_scope: "exact_pool_behavior_and_asset_taxonomy",
    observed_at: iso(observedAt),
    freshness: freshnessState,
    classifier: Object.freeze({ name: DISCOVER_CLASSIFIER_NAME, version: DISCOVER_CLASSIFIER_VERSION }),
  });
}

function notabilityContract(row, {
  taxonomy,
  states,
  raven,
  measurements,
  sample,
  observedAt,
  observationCount,
} = {}) {
  const factsCurrent = measurements?.price_change?.freshness === "current";
  const windowUrgency = Object.freeze({ "5m": 20, "1h": 10, "24h": 0 });
  const moveTriggers = (factsCurrent ? Object.entries(DISCOVER_NOTABILITY_THRESHOLDS) : []).flatMap(([window, threshold]) => {
    const value = metric(row, "price_change", window);
    if (value === null || Math.abs(value) < threshold) return [];
    const volumeUsd = metric(row, "volume_usd", window);
    const windowFlow = flow(row, window);
    const floor = NOTABILITY_ACTIVITY_FLOORS[window];
    const activityQualified = (volumeUsd !== null && volumeUsd >= floor.volume_usd)
      || (windowFlow.transactions !== null && windowFlow.transactions >= floor.transactions)
      || (windowFlow.participants !== null && windowFlow.participants >= floor.participants);
    if (!activityQualified) return [];
    const thresholdMultiple = Math.abs(value) / threshold;
    return [Object.freeze({
      kind: "material_price_move",
      window,
      direction: value >= 0 ? "up" : "down",
      value_pct: value,
      activity_floor: Object.freeze({
        qualified: true,
        volume_usd: volumeUsd,
        transactions: windowFlow.transactions,
        participants: windowFlow.participants,
        minimum_volume_usd: floor.volume_usd,
        minimum_transactions: floor.transactions,
        minimum_participants: floor.participants,
        any_floor_may_qualify: true,
      }),
      source_scope: `exact_pool_provider_window:${window}`,
      observed_at: iso(observedAt),
      freshness: "current",
      priority: Math.round(thresholdMultiple * 100) + windowUrgency[window],
    })];
  }).sort((left, right) => right.priority - left.priority);
  const selectedWindow = measurements?.timeframe || null;
  const selectedWindowMove = moveTriggers.find((trigger) => trigger.window === selectedWindow) || null;
  const primaryMove = selectedWindowMove || moveTriggers[0] || null;
  const selectedMove = finite(measurements?.price_change?.value);
  const transactionAcceleration = finite(measurements?.transaction_rate_acceleration?.value);
  const participantAcceleration = finite(measurements?.participant_acceleration?.value);
  const volumeAcceleration = finite(measurements?.volume_acceleration?.value);
  const matureSample = ["developing", "robust"].includes(sample?.state);
  const accelerationQualified = factsCurrent
    && measurements?.historical_window_coverage?.state === "available"
    && matureSample
    && Math.abs(selectedMove || 0) >= 2
    && [transactionAcceleration, participantAcceleration, volumeAcceleration]
      .some((value) => value !== null && value >= 0.35)
    && (
      ["accumulation", "absorption", "participation_accelerating"].includes(states?.activity)
      || ["reacceleration", "sell_pressure_absorption"].includes(states?.primary)
    );
  const lifecycleQualified = factsCurrent
    && observationCount >= 2
    && matureSample
    && [
      "post_dump_resurrection",
      "reclaiming_range",
      "approaching_ath",
      "ath_breakout",
      "distribution",
      "failed_breakout",
      "capitulation",
    ].includes(states?.primary);
  const ravenQualified = factsCurrent && raven?.qualified === true && raven?.raven_signal === true;
  const qualified = Boolean(primaryMove || accelerationQualified || lifecycleQualified || ravenQualified);
  const reasonCode = ravenQualified
    ? "exact_raven_observation"
    : primaryMove
      ? "material_price_move"
      : accelerationQualified
        ? "qualified_participation_transition"
        : lifecycleQualified
          ? "recorded_lifecycle_event"
          : "watch_only";
  const trigger = primaryMove || (qualified ? Object.freeze({
    kind: accelerationQualified ? "participation_transition" : ravenQualified ? "exact_raven_observation" : "lifecycle_transition",
    window: measurements?.timeframe || null,
    direction: selectedMove === null ? "mixed" : selectedMove >= 0 ? "up" : "down",
    value_pct: selectedMove,
    activity_floor: null,
    source_scope: ravenQualified ? "exact_market_raven_observation" : "exact_pool_observation_history",
    observed_at: iso(observedAt),
    freshness: factsCurrent ? "current" : "stale",
    priority: 0,
  }) : null);
  const primaryMoveMultiple = primaryMove
    ? Math.abs(primaryMove.value_pct) / DISCOVER_NOTABILITY_THRESHOLDS[primaryMove.window]
    : 0;
  const rawMovePriority = primaryMove
    ? Math.min(120, Math.round(
      50
      + Math.log2(Math.max(1, primaryMoveMultiple)) * 18
      + windowUrgency[primaryMove.window]
    ))
    : 0;
  const movePriority = primaryMove && primaryMove.window !== selectedWindow
    ? Math.min(65, rawMovePriority)
    : rawMovePriority;
  const sampleAdjustment = sample?.state === "robust" ? 10 : sample?.state === "developing" ? 5 : sample?.state === "fragile" ? -3 : -8;
  const priority = qualified ? clamp(
    (movePriority || 55)
    + sampleAdjustment
    + (accelerationQualified ? 12 : 0)
    + (lifecycleQualified ? 16 : 0)
    + (ravenQualified ? 30 : 0),
    0,
    199,
  ) : 0;
  const extremeMove = moveTriggers.some((move) => Math.abs(move.value_pct) >= 500);
  return Object.freeze({
    schema_version: DISCOVER_NOTABILITY_SCHEMA,
    state: qualified ? "notable" : "watch_only",
    qualified,
    default_opportunity_eligible: taxonomy?.default_opportunity_eligible === true && qualified,
    reason_code: reasonCode,
    priority: Math.round(priority),
    primary_trigger: trigger,
    material_move_triggers: Object.freeze(moveTriggers.slice(0, 3)),
    qualified_participation_transition: accelerationQualified,
    qualified_lifecycle_transition: lifecycleQualified,
    exact_raven_observation: ravenQualified,
    verification_state: qualified
      ? (extremeMove || sample?.state === "fragile" ? "exact_chart_required" : "qualified")
      : "not_required",
    source_scope: "server_derived_exact_pool_notability",
    observed_at: iso(observedAt),
    freshness: factsCurrent ? "current" : "stale",
    browser_derived: false,
    provider_rank_used: false,
  });
}

function crossCohortRanking(kind, rawScore, sample, row, states, riskFlags, observedAt) {
  const strength = finite(rawScore);
  if (strength === null) return Object.freeze({
    schema_version: "ravenos.discover_cross_cohort_rank.v1",
    kind,
    availability: "unavailable",
    sort_index: null,
    absolute_volume_tiebreaker_used: false,
    source_scope: "server_derived_exact_pool_ranking",
    observed_at: iso(observedAt),
  });
  const observationCount = Math.max(1, Math.floor(finite(row?.registry?.observation_count) || 1));
  const routeableSize = row?.routeability?.availability === "available"
    ? Math.max(0, finite(row?.routeability?.routeable_size_usd) || 0)
    : 0;
  const maturityAdjustment = sample.state === "robust" ? 8 : sample.state === "developing" ? 2 : sample.state === "fragile" ? -16 : -22;
  const noveltyAdjustment = row?.registry?.changed_since_last_published_observation === true ? 7 : observationCount <= 2 ? 4 : 0;
  const persistenceAdjustment = Math.min(9, Math.max(0, observationCount - 1) * 2);
  const coverageAdjustment = ((sample.evidence_coverage_pct || 0) - 50) / 8;
  const routeAdjustment = clamp(Math.log10(routeableSize + 1) * 2 - 5, 0, 8);
  const behaviorAdjustment = ["reacceleration", "sell_pressure_absorption", "post_dump_resurrection", "reclaiming_range", "breakout", "continuation"].includes(states.primary) ? 6 : 0;
  const riskAdjustment = riskFlags.length * -2;
  const sortIndex = clamp(Math.round(
    strength
    + maturityAdjustment
    + noveltyAdjustment
    + persistenceAdjustment
    + coverageAdjustment
    + routeAdjustment
    + behaviorAdjustment
    + riskAdjustment
  ), 0, 99);
  return Object.freeze({
    schema_version: "ravenos.discover_cross_cohort_rank.v1",
    kind,
    availability: "available",
    sort_index: sortIndex,
    strength_score: strength,
    sample_maturity: sample.state,
    evidence_coverage_pct: sample.evidence_coverage_pct,
    novelty: noveltyAdjustment,
    persistence: persistenceAdjustment,
    route_usability: Math.round(routeAdjustment),
    risk_adjustment: riskAdjustment,
    absolute_volume_tiebreaker_used: false,
    source_scope: "server_derived_exact_pool_ranking",
    observed_at: iso(observedAt),
  });
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function cleanText(value, limit = 180) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function iso(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function freshness(observedAt, nowMs = Date.now(), targetSeconds = DISCOVER_MARKET_FACT_TARGET_SECONDS) {
  const observedMs = Date.parse(String(observedAt || ""));
  if (!Number.isFinite(observedMs)) return Object.freeze({ state: "unavailable", age_seconds: null, target_seconds: targetSeconds });
  const ageSeconds = Math.max(0, Math.floor((nowMs - observedMs) / 1_000));
  return Object.freeze({
    state: ageSeconds <= targetSeconds ? "current" : "stale",
    age_seconds: ageSeconds,
    target_seconds: targetSeconds,
  });
}

function evidenceValue(value, {
  availability = value === null || value === undefined ? "unavailable" : "available",
  sourceScope = "exact_pool",
  observedAt = null,
  freshnessState = "current",
  derivation = "observed",
  unit = null,
  limitation = null,
} = {}) {
  return Object.freeze({
    value: availability === "available" ? value : null,
    availability,
    source_scope: sourceScope,
    observed_at: iso(observedAt),
    freshness: freshnessState,
    derivation,
    ...(unit ? { unit } : {}),
    ...(limitation ? { limitation: cleanText(limitation, 220) } : {}),
  });
}

function metric(row, name, window) {
  return finite(row?.market?.[`${name}_${window}${["price_change", "volume_change", "liquidity_change", "holder_change"].includes(name) ? "_pct" : ""}`]);
}

function countMetric(row, name, window) {
  const direct = metric(row, name, window);
  return direct === null ? null : Math.max(0, direct);
}

function flow(row, window) {
  const buys = countMetric(row, "buys", window);
  const sells = countMetric(row, "sells", window);
  const buyers = countMetric(row, "buyers", window);
  const sellers = countMetric(row, "sellers", window);
  const traders = countMetric(row, "traders", window);
  const transactions = buys === null || sells === null ? null : buys + sells;
  const participants = buyers !== null && sellers !== null ? buyers + sellers : traders;
  const buyShare = transactions && transactions > 0 ? buys / transactions : null;
  const participantBuyShare = buyers !== null && sellers !== null && buyers + sellers > 0 ? buyers / (buyers + sellers) : null;
  return Object.freeze({ buys, sells, buyers, sellers, traders, transactions, participants, buy_share: buyShare, participant_buy_share: participantBuyShare });
}

function rateAcceleration(currentValue, currentMinutes, baselineValue, baselineMinutes) {
  if (currentValue === null || baselineValue === null || !(currentMinutes > 0) || !(baselineMinutes > currentMinutes)) return null;
  const olderValue = Math.max(0, baselineValue - currentValue);
  const olderMinutes = baselineMinutes - currentMinutes;
  const currentRate = currentValue / currentMinutes;
  const priorRate = olderValue / olderMinutes;
  if (currentRate === 0 && priorRate === 0) return 0;
  if (priorRate <= 0) return currentRate > 0 ? 4 : 0;
  return clamp((currentRate / priorRate) - 1, -1, 4);
}

function returnRateAcceleration(currentReturn, currentMinutes, baselineReturn, baselineMinutes) {
  if (currentReturn === null || baselineReturn === null || !(currentMinutes > 0) || !(baselineMinutes > currentMinutes)) return null;
  const priorReturn = baselineReturn - currentReturn;
  const priorMinutes = baselineMinutes - currentMinutes;
  return (currentReturn / currentMinutes) - (priorReturn / priorMinutes);
}

function timeframeMeasurements(row, timeframe, observedAt, freshnessState = "current") {
  const baseline = BASELINE_WINDOW[timeframe] || null;
  const currentMinutes = WINDOW_MINUTES[timeframe] || null;
  const baselineMinutes = WINDOW_MINUTES[baseline] || null;
  const currentFlow = flow(row, timeframe);
  const baselineFlow = baseline ? flow(row, baseline) : null;
  const currentVolume = metric(row, "volume_usd", timeframe);
  const baselineVolume = baseline ? metric(row, "volume_usd", baseline) : null;
  const currentReturn = metric(row, "price_change", timeframe);
  const baselineReturn = baseline ? metric(row, "price_change", baseline) : null;
  const sourceScope = baseline ? `exact_pool_provider_windows:${timeframe}_vs_${baseline}` : `exact_pool_provider_window:${timeframe}`;
  const windowAvailability = baseline && [
    currentFlow.transactions,
    currentFlow.participants,
    currentVolume,
    currentReturn,
  ].some((value, index) => value !== null && [
    baselineFlow?.transactions,
    baselineFlow?.participants,
    baselineVolume,
    baselineReturn,
  ][index] !== null) ? "available" : "insufficient_history";
  const storedObservationCount = Math.max(0, Math.floor(finite(row?.registry?.observation_count) || 0));
  const historicalAvailability = storedObservationCount >= 2 ? windowAvailability : "insufficient_history";
  const wrap = (value, unit, derivation = "derived") => evidenceValue(value, {
    availability: freshnessState === "stale"
      ? "stale"
      : value === null
        ? derivation === "derived" && historicalAvailability === "insufficient_history" ? "insufficient_history" : "unavailable"
        : "available",
    sourceScope,
    observedAt,
    freshnessState,
    derivation,
    unit,
    limitation: "Rolling provider windows are compared without fabricating a stored historical series.",
  });
  const transactionAcceleration = baseline ? rateAcceleration(currentFlow.transactions, currentMinutes, baselineFlow.transactions, baselineMinutes) : null;
  const participantAcceleration = baseline ? rateAcceleration(currentFlow.participants, currentMinutes, baselineFlow.participants, baselineMinutes) : null;
  const volumeAcceleration = baseline ? rateAcceleration(currentVolume, currentMinutes, baselineVolume, baselineMinutes) : null;
  const priceAcceleration = baseline ? returnRateAcceleration(currentReturn, currentMinutes, baselineReturn, baselineMinutes) : null;
  const buyShare = currentFlow.participant_buy_share ?? currentFlow.buy_share;
  const baselineBuyShare = baselineFlow ? (baselineFlow.participant_buy_share ?? baselineFlow.buy_share) : null;
  const buyShareChange = buyShare === null || baselineBuyShare === null ? null : buyShare - baselineBuyShare;
  const netBuyFlow = currentFlow.buys === null || currentFlow.sells === null ? null : currentFlow.buys - currentFlow.sells;
  const measured = (value) => historicalAvailability === "available" ? value : null;
  return Object.freeze({
    timeframe,
    baseline_window: baseline,
    historical_window_coverage: Object.freeze({
      state: freshnessState === "stale" ? "stale" : historicalAvailability,
      current_window: timeframe,
      baseline_window: baseline,
      stored_observation_count: storedObservationCount,
    }),
    price_change: wrap(currentReturn, "percent", "observed"),
    price_acceleration: wrap(measured(priceAcceleration), "percent_per_minute_delta"),
    volume: wrap(currentVolume, "usd", "observed"),
    volume_acceleration: wrap(measured(volumeAcceleration), "rate_ratio_delta"),
    transaction_rate_acceleration: wrap(measured(transactionAcceleration), "rate_ratio_delta"),
    participant_acceleration: wrap(measured(participantAcceleration), "rate_ratio_delta"),
    buy_share: wrap(buyShare, "ratio", "derived"),
    buy_share_change: wrap(measured(buyShareChange), "ratio_delta", "derived"),
    net_buy_flow: wrap(netBuyFlow, "transactions", "derived"),
    liquidity_change: wrap(metric(row, "liquidity_change", timeframe), "percent", "observed"),
    holder_change: wrap(metric(row, "holder_change", timeframe), "percent", "observed"),
    transactions: wrap(currentFlow.transactions, "count", "observed"),
    participants: wrap(currentFlow.participants, "count", "observed"),
  });
}

function marketCapBand(value) {
  const amount = finite(value);
  if (amount === null) return "unavailable";
  if (amount < 100_000) return "under_100k";
  if (amount < 500_000) return "100k_500k";
  if (amount < 2_000_000) return "500k_2m";
  if (amount < 10_000_000) return "2m_10m";
  return "10m_plus";
}

function liquidityBand(value) {
  const amount = finite(value);
  if (amount === null) return "unavailable";
  if (amount < 10_000) return "under_10k";
  if (amount < 50_000) return "10k_50k";
  if (amount < 250_000) return "50k_250k";
  return "250k_plus";
}

function migrationCohort(row, observedAt) {
  const explicit = cleanText(row?.migration_cohort?.value || row?.migration_cohort, 40).toLowerCase();
  if (MIGRATION_COHORTS.has(explicit)) {
    return evidenceValue(explicit, {
      sourceScope: cleanText(row?.migration_cohort?.source_scope, 80) || "exact_pool_registry",
      observedAt: row?.migration_cohort?.observed_at || observedAt,
      freshnessState: cleanText(row?.migration_cohort?.freshness, 20) || "current",
      derivation: cleanText(row?.migration_cohort?.derivation, 30) || "derived",
    });
  }
  const age = finite(row?.market?.market_age_seconds);
  if (age !== null && age <= 24 * 3_600) {
    return evidenceValue("initial_discovery", { sourceScope: "exact_pool_creation_time", observedAt, derivation: "derived" });
  }
  if (age !== null && age >= 14 * 86_400) {
    return evidenceValue("mature", { sourceScope: "exact_pool_creation_time", observedAt, derivation: "derived" });
  }
  return evidenceValue(null, {
    availability: "insufficient_history",
    sourceScope: "exact_pool_registry",
    observedAt,
    derivation: "derived",
    limitation: "Migration is not inferred from a token name or provider rank.",
  });
}

function controlEvidence(row, observedAt) {
  const source = row?.control_intelligence;
  const display = source?.display_policy || {};
  const qualified = source?.availability === "available"
    && display.reviewed === true
    && display.customer_display_allowed === true
    && cleanText(display.provider, 60)
    && cleanText(display.product, 80);
  const unavailable = (limitation) => evidenceValue(null, {
    availability: "unavailable",
    sourceScope: "exact_pool_control_intelligence",
    observedAt,
    freshnessState: "unavailable",
    derivation: "observed",
    limitation,
  });
  if (!qualified) {
    return Object.freeze({
      availability: "unavailable",
      bundled_pct: unavailable("No reviewed customer-display contract is available for bundle data."),
      bundle_change_pct: unavailable("No reviewed customer-display contract is available for bundle history."),
      original_bundle_selling: unavailable("Original-bundle behavior is not qualified for display."),
      new_bundle_accumulation: unavailable("New-bundle behavior is not qualified for display."),
      bundle_turnover: unavailable("Bundle turnover is not qualified for display."),
      developer_exposure_pct: unavailable("Developer exposure is not qualified for display."),
      sniper_concentration_pct: unavailable("Sniper concentration is not qualified for display."),
      top_holder_concentration_pct: unavailable("Holder concentration is not qualified for this projection."),
      liquidity_control_risk: unavailable("Liquidity-control evidence is not qualified for display."),
      display_policy: Object.freeze({ state: "withheld", payment_override_allowed: false }),
    });
  }
  const field = (key, unit = null) => evidenceValue(source[key] ?? null, {
    sourceScope: "exact_pool_control_intelligence",
    observedAt: source.observed_at || observedAt,
    freshnessState: cleanText(source.freshness, 20) || "current",
    derivation: "observed",
    unit,
  });
  return Object.freeze({
    availability: "available",
    bundled_pct: field("bundled_pct", "percent"),
    bundle_change_pct: field("bundle_change_pct", "percentage_points"),
    original_bundle_selling: field("original_bundle_selling"),
    new_bundle_accumulation: field("new_bundle_accumulation"),
    bundle_turnover: field("bundle_turnover", "percent"),
    developer_exposure_pct: field("developer_exposure_pct", "percent"),
    sniper_concentration_pct: field("sniper_concentration_pct", "percent"),
    top_holder_concentration_pct: field("top_holder_concentration_pct", "percent"),
    liquidity_control_risk: field("liquidity_control_risk"),
    display_policy: Object.freeze({
      state: "qualified",
      provider: cleanText(display.provider, 60),
      product: cleanText(display.product, 80),
      reviewed_at: iso(display.reviewed_at),
      payment_override_allowed: false,
    }),
  });
}

function ravenEvidence(row, observedAt) {
  const source = row?.raven_evidence;
  const exactIdentity = cleanText(source?.instrument_id, 180) === cleanText(row?.instrument_id, 180);
  const sourceTimestamp = iso(source?.observed_at);
  const classifierName = cleanText(source?.classifier?.name, 80);
  const classifierVersion = cleanText(source?.classifier?.version, 60);
  const lineage = cleanText(source?.lineage?.public_artifact_id || source?.lineage?.claim_id, 120);
  const evidenceState = cleanText(source?.state, 40).toLowerCase();
  const qualified = row?.source_type === "raven_spot_attention"
    && source?.genuine_internal_observation === true
    && exactIdentity
    && sourceTimestamp
    && classifierName
    && classifierVersion
    && lineage
    && ["forming", "qualified", "strengthened", "weakened", "invalidated"].includes(evidenceState);
  if (!qualified) {
    return Object.freeze({
      availability: "unavailable",
      qualified: false,
      state: "unavailable",
      raven_signal: false,
      observed_at: null,
      source_scope: "exact_market_raven_observation",
      freshness: "unavailable",
      classifier: null,
      lineage: null,
      why_not_available: "Raven does not have a current read for this exact market yet.",
      provider_rank_used: false,
      velocity_score_used: false,
    });
  }
  return Object.freeze({
    availability: "available",
    qualified: true,
    state: evidenceState,
    raven_signal: true,
    observed_at: sourceTimestamp,
    source_scope: "exact_market_raven_observation",
    freshness: cleanText(source.freshness, 20) || "current",
    classifier: Object.freeze({ name: classifierName, version: classifierVersion }),
    lineage: Object.freeze({ public_artifact_id: lineage }),
    why_raven_noticed: cleanText(source.why_raven_noticed, 220),
    what_changed: cleanText(source.what_changed, 220),
    behavioral_evidence: (Array.isArray(source.behavioral_evidence) ? source.behavioral_evidence : []).map((value) => cleanText(value, 140)).filter(Boolean).slice(0, 4),
    timing_lead_seconds: finite(source.timing_lead_seconds),
    confidence_maturity: cleanText(source.confidence_maturity, 40) || "forming",
    contradictions: (Array.isArray(source.contradictions) ? source.contradictions : []).map((value) => cleanText(value, 140)).filter(Boolean).slice(0, 4),
    forward_evidence_status: cleanText(source.forward_evidence_status, 50) || "forming",
    provider_rank_used: false,
    velocity_score_used: false,
  });
}

function deriveRiskFlags(row, measurements, control) {
  const flags = [];
  const price = finite(measurements.price_change.value);
  const buyShare = finite(measurements.buy_share.value);
  const liquidityChange = finite(measurements.liquidity_change.value);
  const marketCap = marketCapValue(row?.market);
  const liquidity = finite(row?.market?.liquidity_usd);
  const ratio = marketCap !== null && liquidity !== null && liquidity > 0 ? marketCap / liquidity : null;
  const volume24h = finite(row?.market?.volume_usd_24h);
  const turnover = marketCap !== null && marketCap > 0 && volume24h !== null ? volume24h / marketCap : null;
  const marketAgeSeconds = finite(row?.market?.market_age_seconds);
  if (price !== null && price >= 20) flags.push("late_chase");
  if (price !== null && price >= 5 && buyShare !== null && buyShare <= 0.46) flags.push("flow_divergence");
  if (liquidityChange !== null && liquidityChange <= -8) flags.push("liquidity_thinning");
  if (ratio !== null && ratio >= 35) flags.push("high_market_cap_to_liquidity");
  if (turnover !== null && turnover >= 8) flags.push("high_turnover");
  if (marketAgeSeconds !== null && marketAgeSeconds < 2 * 60 * 60) flags.push("very_new_pool");
  const bundled = finite(control.bundled_pct?.value);
  if (bundled !== null && bundled >= 20) flags.push("bundle_concentration");
  if (control.original_bundle_selling?.value === true) flags.push("bundle_distribution");
  if (finite(control.developer_exposure_pct?.value) >= 10) flags.push("developer_exposure");
  if (finite(control.sniper_concentration_pct?.value) >= 15) flags.push("sniper_concentration");
  if (finite(control.top_holder_concentration_pct?.value) >= 50) flags.push("holder_concentration");
  if (control.liquidity_control_risk?.value === "elevated") flags.push("liquidity_control");
  if (row?.routeability?.availability === "available" && row.routeability?.routeable === false) flags.push("unrouteable");
  return [...new Set(flags)].filter((value) => RISK_FLAGS.has(value));
}

function classifyStates(row, measurements, control, cohort) {
  const price = finite(measurements.price_change.value);
  const priceAcceleration = finite(measurements.price_acceleration.value);
  const transactionAcceleration = finite(measurements.transaction_rate_acceleration.value);
  const participantAcceleration = finite(measurements.participant_acceleration.value);
  const volumeAcceleration = finite(measurements.volume_acceleration.value);
  const buyShare = finite(measurements.buy_share.value);
  const buyShareChange = finite(measurements.buy_share_change.value);
  const liquidityChange = finite(measurements.liquidity_change.value);
  const observationCount = Math.max(0, Math.floor(finite(row?.registry?.observation_count) || 0));
  const firstMarketCap = finite(row?.registry?.first_seen_market_cap_usd);
  const marketCap = marketCapValue(row?.market);
  const changeSinceFirst = firstMarketCap !== null && firstMarketCap > 0 && marketCap !== null
    ? ((marketCap / firstMarketCap) - 1) * 100
    : finite(row?.registry?.change_since_first_observation_pct);
  const drawdown = finite(row?.registry?.max_drawdown_since_first_pct);
  const athDistance = finite(row?.registry?.ath_distance_pct);
  const priorState = cleanText(row?.registry?.primary_behavior_state, 50).toLowerCase();
  const priorClassifierVersion = cleanText(row?.registry?.classifier_version, 60);
  const classifierChanged = Boolean(priorClassifierVersion && priorClassifierVersion !== DISCOVER_CLASSIFIER_VERSION);
  const explicitUnavailable = row?.registry?.availability === "unavailable" || row?.context_state === "unavailable";
  const retainedStale = row?.registry?.retained_after_trending === true && row?.context_state === "stale";
  let primary = "forming";
  let why = "Raven is collecting real observations before assigning a stable behavioral state.";
  if (explicitUnavailable) {
    primary = "invalidated_dead";
    why = "The exact market is unavailable or no longer has usable market state.";
  } else if (retainedStale) {
    primary = classifierChanged ? "forming" : PRIMARY_BEHAVIOR_STATES.has(priorState) ? priorState : "forming";
    why = classifierChanged
      ? "The market model changed between updates; a current update is needed before naming the next pattern."
      : "Still tracked after leaving trending; the latest market update is older, so RavenOS is not treating it as current.";
  } else if (observationCount < 2) {
    primary = "forming";
    why = "First market update recorded; waiting for another before naming the pattern.";
  } else if (price !== null && price >= 20 && ((buyShare !== null && buyShare <= 0.48) || (liquidityChange !== null && liquidityChange <= -5) || control.original_bundle_selling?.value === true)) {
    primary = "distribution";
    why = "Price strength is diverging from participation, bundle behavior, or available liquidity.";
  } else if (drawdown !== null && drawdown <= -50 && price !== null && price > 3 && participantAcceleration !== null && participantAcceleration > 0.2 && (buyShareChange === null || buyShareChange > 0)) {
    primary = "post_dump_resurrection";
    why = "A deeply drawn-down exact market is rebuilding participation and price velocity from its lows.";
  } else if (price !== null && price < -1 && participantAcceleration !== null && participantAcceleration > 0.25 && buyShareChange !== null && buyShareChange > 0.03) {
    primary = "sell_pressure_absorption";
    why = "Price remains under pressure while unique buy participation strengthens.";
  } else if (price !== null && price <= -20 && buyShare !== null && buyShare <= 0.4) {
    primary = "capitulation";
    why = "Price and participation are falling together with dominant sell flow.";
  } else if (["breakout", "continuation", "ath_breakout"].includes(priorState) && price !== null && price <= -8 && (buyShare === null || buyShare < 0.48)) {
    primary = "failed_breakout";
    why = "A previously expanding market lost its breakout range while buy participation weakened.";
  } else if (cohort.value === "post_migration" && changeSinceFirst !== null && changeSinceFirst >= 25 && price !== null && price > 0) {
    primary = "post_migration_expansion";
    why = "The exact post-migration market is expanding from Raven's actual first recorded state.";
  } else if (athDistance !== null && athDistance >= 0) {
    primary = "ath_breakout";
    why = "The exact market is trading beyond its recorded prior high.";
  } else if (athDistance !== null && athDistance >= -8 && price !== null && price > 0) {
    primary = "approaching_ath";
    why = "The exact market is approaching its recorded high with positive current velocity.";
  } else if (
    (cleanText(row?.registry?.reclaim_state, 40).toLowerCase() === "reclaiming_range"
      || (drawdown !== null && drawdown <= -15 && price !== null && price >= 5 && participantAcceleration !== null && participantAcceleration > 0.1))
    && (buyShare === null || buyShare >= 0.5)
  ) {
    primary = "reclaiming_range";
    why = "Price and participation are reclaiming a previously lost recorded range.";
  } else if (changeSinceFirst !== null && changeSinceFirst >= 25 && price !== null && price > 0 && (volumeAcceleration === null || volumeAcceleration >= 0)) {
    primary = priorState === "breakout" || priorState === "continuation" ? "continuation" : "breakout";
    why = "Market value expanded materially from Raven's actual first observation with aligned current flow.";
  } else if (priceAcceleration !== null && priceAcceleration > 0 && participantAcceleration !== null && participantAcceleration > 0.1) {
    primary = priorState === "pullback_holding" || priorState === "base_building" ? "reacceleration" : "continuation";
    why = "Price velocity and participation are accelerating together.";
  } else if (price !== null && price < 0 && buyShare !== null && buyShare >= 0.52 && (liquidityChange === null || liquidityChange >= -3)) {
    primary = "pullback_holding";
    why = "The pullback retains buy participation and usable liquidity.";
  } else if (Math.abs(price || 0) <= 2 && transactionAcceleration !== null && Math.abs(transactionAcceleration) <= 0.2) {
    primary = "base_building";
    why = "Price and activity are stabilizing inside a bounded range.";
  } else if (cohort.value === "initial_discovery") {
    primary = "initial_discovery";
    why = "The exact pool remains in its initial observed phase without a stronger qualified behavior state yet.";
  }

  const flowOpposesPrice = price !== null && buyShare !== null && ((price > 0 && buyShare < 0.48) || (price < 0 && buyShare > 0.52));
  let velocity = "forming";
  if (measurements.historical_window_coverage.state !== "available") velocity = "insufficient_history";
  else if (flowOpposesPrice) velocity = "divergence";
  else if (price !== null && Math.abs(price) >= 20 && (participantAcceleration ?? 0) <= 0) velocity = "exhaustion";
  else if (priceAcceleration !== null && priceAcceleration > 0 && (participantAcceleration ?? 0) > 0.1) velocity = "reacceleration";
  else if (price !== null && price > 0) velocity = "upside_velocity";
  else if (price !== null && price < 0) velocity = "downside_velocity";

  let activity = "forming";
  if (measurements.historical_window_coverage.state !== "available") activity = "insufficient_history";
  else if (primary === "sell_pressure_absorption") activity = "absorption";
  else if (primary === "distribution") activity = "distribution";
  else if ((participantAcceleration ?? transactionAcceleration ?? 0) > 0.2 && (buyShare ?? 0.5) >= 0.53) activity = "accumulation";
  else if ((participantAcceleration ?? transactionAcceleration ?? 0) > 0.15) activity = "participation_accelerating";
  else if ((participantAcceleration ?? transactionAcceleration ?? 0) < -0.15) activity = "participation_decelerating";
  else activity = "balanced";

  return Object.freeze({ primary, why, velocity, activity, changeSinceFirst, athDistance, drawdown });
}

function decisionSupportContract(row, {
  states,
  measurements,
  risks,
  observationCount,
  timeframe,
} = {}) {
  const stateSupport = {
    forming: "A second real market update adds enough history to judge whether the behavior persists.",
    initial_discovery: "Participation expands while buy-side flow and usable liquidity remain intact.",
    post_migration_expansion: "Market value, participation, and liquidity continue expanding together.",
    breakout: "Price holds the expanded range while participation and buy-side flow remain aligned.",
    continuation: "Price velocity and participation remain aligned without a sharp loss of liquidity.",
    pullback_holding: "Buy participation stays firm while price stabilizes and liquidity remains usable.",
    sell_pressure_absorption: "Buyer participation keeps expanding while price stabilizes or turns higher.",
    reacceleration: "Price, transaction rate, and participant growth continue accelerating together.",
    extended: "Participation catches up to the move without further liquidity deterioration.",
    distribution: "Sell-side flow keeps leading while price stays extended or liquidity continues to fall.",
    failed_breakout: "Price remains below the lost range while buy participation continues to weaken.",
    capitulation: "Sell flow remains dominant while price, activity, and liquidity continue contracting.",
    base_building: "Price remains stable while participation gradually improves inside the range.",
    post_dump_resurrection: "Participation and price velocity keep rebuilding while the market holds above its recorded low.",
    reclaiming_range: "Price holds the reclaimed range with buy-side participation and usable liquidity.",
    approaching_ath: "Positive velocity and participation persist into the Raven-recorded high.",
    ath_breakout: "Price holds above the Raven-recorded high with sustained participation and liquidity.",
    invalidated_dead: "The same exact market becomes available again with current, usable market data.",
  };
  const stateBreak = {
    forming: "The next update reverses the move or market data becomes unavailable.",
    initial_discovery: "Participation fades, sell flow takes control, or liquidity thins.",
    post_migration_expansion: "Price loses the expansion range while participation or liquidity contracts.",
    breakout: "Price loses the breakout range, buy participation fades, or liquidity thins.",
    continuation: "Price velocity rolls over while participation decelerates or sell flow takes control.",
    pullback_holding: "Buy participation fades, sell flow expands, or the pullback loses usable liquidity.",
    sell_pressure_absorption: "Buyer participation fades before price stabilizes, or sell flow accelerates again.",
    reacceleration: "Price and participation stop accelerating together or liquidity deteriorates.",
    extended: "Participation decelerates further while price remains extended or liquidity thins.",
    distribution: "Buy-side flow reclaims control and liquidity recovers while price holds its range.",
    failed_breakout: "Price reclaims the lost range with renewed buy participation and liquidity.",
    capitulation: "Sell flow weakens while participation and price begin rebuilding from the low.",
    base_building: "Price loses the base with expanding sell flow or deteriorating liquidity.",
    post_dump_resurrection: "The rebound loses its recorded low, participation fades, or liquidity contracts.",
    reclaiming_range: "Price loses the reclaimed range or buy participation and liquidity weaken.",
    approaching_ath: "Velocity fades before the recorded high or sell-side flow begins to lead.",
    ath_breakout: "Price falls back below the recorded high with weakening participation or liquidity.",
    invalidated_dead: "No current exact-market data is available.",
  };
  const checkpointFocus = {
    forming: "whether the move persists",
    initial_discovery: "participation and liquidity",
    post_migration_expansion: "range hold and participation",
    breakout: "breakout hold and buy-side flow",
    continuation: "continued alignment of price and participation",
    pullback_holding: "price stabilization and sustained buy participation",
    sell_pressure_absorption: "price stabilization and sustained buyer growth",
    reacceleration: "continued price and participation acceleration",
    extended: "participation catch-up versus further extension",
    distribution: "sell-flow leadership and liquidity",
    failed_breakout: "range recovery or further rejection",
    capitulation: "sell-flow exhaustion or continued contraction",
    base_building: "range hold and improving participation",
    post_dump_resurrection: "the recorded low and continued participation recovery",
    reclaiming_range: "the reclaimed range and buy-side flow",
    approaching_ath: "behavior at the Raven-recorded high",
    ath_breakout: "acceptance above the Raven-recorded high",
    invalidated_dead: "exact-market availability",
  };
  const primary = PRIMARY_BEHAVIOR_STATES.has(states?.primary) ? states.primary : "forming";
  const price = finite(measurements?.price_change?.value);
  const buyShare = finite(measurements?.buy_share?.value);
  let whyNow = cleanText(states?.why, 220);
  if (primary === "forming" && states?.activity === "accumulation") {
    whyNow = "Buy-side flow is leading while participant activity accelerates.";
  } else if (primary === "forming" && states?.activity === "absorption") {
    whyNow = "Price remains under pressure while buyer participation strengthens.";
  } else if (primary === "forming" && states?.velocity === "reacceleration") {
    whyNow = "Price velocity and participation are reaccelerating together.";
  } else if (primary === "forming" && states?.velocity === "divergence" && price !== null && buyShare !== null) {
    whyNow = price < 0 && buyShare > 0.52
      ? "Price is falling while buy-side participation strengthens."
      : price > 0 && buyShare < 0.48
        ? "Price is rising while sell-side flow leads, creating a distribution warning."
        : "Price and participation are moving in opposite directions.";
  }
  const riskSuffix = risks?.includes("liquidity_thinning")
    ? " Current liquidity is also thinning."
    : risks?.includes("flow_divergence")
      ? " Current price and flow are also diverging."
      : risks?.includes("high_turnover")
        ? " Turnover is unusually high relative to the current valuation reference."
        : risks?.includes("very_new_pool")
          ? " This pool is still very new, so the pattern has little time to mature."
      : "";
  return Object.freeze({
    what_changed: cleanText(row?.what_changed, 220),
    why_now: `${whyNow}${riskSuffix}`.slice(0, 220),
    what_strengthens: stateSupport[primary],
    what_weakens: stateBreak[primary],
    next_checkpoint: observationCount < 2
      ? "Wait for one more real market update before treating this pattern as established."
      : `Check the next ${timeframe} update for ${checkpointFocus[primary]}.`,
  });
}

function rawRankIndex(states, measurements, riskFlags, row) {
  const movement = Math.abs(finite(measurements.price_change.value) || 0);
  const priceAcceleration = Math.abs(finite(measurements.price_acceleration.value) || 0);
  const volumeAcceleration = finite(measurements.volume_acceleration.value);
  const txAcceleration = finite(measurements.transaction_rate_acceleration.value);
  const participantAcceleration = finite(measurements.participant_acceleration.value);
  const liquidityChange = finite(measurements.liquidity_change.value);
  const buyShare = finite(measurements.buy_share.value);
  const flowAlignment = states.velocity === "divergence" ? -12 : states.activity === "accumulation" || states.activity === "absorption" ? 12 : 2;
  const persistence = ["continuation", "reacceleration", "breakout", "post_dump_resurrection"].includes(states.primary) ? 10 : 0;
  const routeDepth = row?.routeability?.availability === "available"
    ? finite(row?.routeability?.routeable_size_usd) || 0
    : 0;
  const evidenceAvailable = [
    measurements.price_change.value,
    measurements.price_acceleration.value,
    measurements.volume_acceleration.value,
    measurements.transaction_rate_acceleration.value,
    measurements.participant_acceleration.value,
  ].some((value) => finite(value) !== null);
  let velocity = 20
    + clamp(Math.log10(movement + 1) * 15, 0, 28)
    + clamp(priceAcceleration * 250, 0, 14)
    + clamp((volumeAcceleration || 0) * 7, -7, 18)
    + clamp((txAcceleration || 0) * 5, -6, 14)
    + clamp((participantAcceleration || 0) * 8, -8, 18)
    + clamp((liquidityChange || 0) / 3, -10, 10)
    + flowAlignment + persistence
    + clamp(Math.log10(routeDepth + 1) * 3 - 8, 0, 10)
    - riskFlags.length * 4;
  if (states.velocity === "insufficient_history") velocity = Math.min(velocity, 44);
  let activity = 24
    + clamp((txAcceleration || 0) * 14, -12, 28)
    + clamp((participantAcceleration || 0) * 18, -14, 34)
    + clamp((volumeAcceleration || 0) * 10, -10, 24)
    + clamp(((buyShare || 0.5) - 0.5) * 30, -10, 10)
    + (states.activity === "absorption" ? 16 : states.activity === "accumulation" ? 12 : states.activity === "distribution" ? -6 : 0);
  if (states.activity === "insufficient_history") activity = Math.min(activity, 40);
  const velocityCap = riskFlags.includes("late_chase") ? 66 : null;
  if (velocityCap !== null) velocity = Math.min(velocity, velocityCap);
  return Object.freeze({
    velocity: evidenceAvailable ? clamp(Math.round(velocity), 0, 99) : null,
    activity: evidenceAvailable ? clamp(Math.round(activity), 0, 99) : null,
    velocity_cap: velocityCap,
    velocity_cap_reason: velocityCap === null ? null : "Velocity capped at 66 because the market is extended",
  });
}

function scoreGrade(value) {
  const score = finite(value);
  if (score === null) return null;
  if (score >= 82) return "A";
  if (score >= 68) return "B";
  if (score >= 52) return "C";
  return "D";
}

function scoreComponents(measurements) {
  const component = (key, label) => {
    const value = measurements[key];
    return Object.freeze({
      key,
      label,
      availability: value?.availability || "unavailable",
      value: finite(value?.value),
      unit: cleanText(value?.unit, 40) || null,
    });
  };
  return Object.freeze([
    component("price_acceleration", "Price acceleration"),
    component("volume_acceleration", "Volume acceleration"),
    component("transaction_rate_acceleration", "Transaction-rate acceleration"),
    component("participant_acceleration", "Participant acceleration"),
    component("liquidity_change", "Liquidity change"),
    component("buy_share_change", "Net-flow alignment"),
  ]);
}

function scorePenalties(riskFlags, raw) {
  const explanations = {
    late_chase: "Chase-risk penalty applied",
    flow_divergence: "Price and flow divergence penalty applied",
    liquidity_thinning: "Thinning-liquidity penalty applied",
    high_market_cap_to_liquidity: "Market-cap-to-liquidity penalty applied",
    bundle_concentration: "Bundle-concentration penalty applied",
    bundle_distribution: "Bundle-distribution penalty applied",
    holder_concentration: "Holder-concentration penalty applied",
    developer_exposure: "Developer-exposure penalty applied",
    sniper_concentration: "Sniper-concentration penalty applied",
    liquidity_control: "Liquidity-control penalty applied",
    manipulation_risk: "Manipulation-risk penalty applied",
    high_turnover: "High-turnover penalty applied",
    very_new_pool: "Very-new-pool penalty applied",
    unrouteable: "Unrouteable-market penalty applied",
  };
  const values = riskFlags.map((key) => Object.freeze({ key, explanation: explanations[key] || `${key.replaceAll("_", " ")} penalty applied` }));
  if (raw.velocity_cap !== null) values.push(Object.freeze({ key: "score_cap", explanation: raw.velocity_cap_reason }));
  return Object.freeze(values);
}

function scoreContract(kind, score, measurements, riskFlags, raw, observedAt, freshnessState = "current") {
  const availability = score === null
    ? "unavailable"
    : measurements.historical_window_coverage.state === "available" ? "available" : "insufficient_history";
  return Object.freeze({
    score_kind: kind,
    score,
    scale_max: 99,
    grade: scoreGrade(score),
    classifier_version: DISCOVER_CLASSIFIER_VERSION,
    observed_at: iso(observedAt),
    freshness: freshnessState,
    availability,
    components: scoreComponents(measurements),
    penalties: scorePenalties(riskFlags, raw),
    score_cap: kind === "velocity_ranking" ? raw.velocity_cap : null,
    score_cap_reason: kind === "velocity_ranking" ? raw.velocity_cap_reason : null,
    legacy_browser_heuristic: false,
    raven_confidence: false,
    win_probability: false,
    calibrated_alpha: false,
    expected_return: false,
  });
}

function cohortKey(row, cohort) {
  return [
    cleanText(row?.chain_id || row?.chain, 20).toLowerCase(),
    marketCapBand(marketCapValue(row?.market)),
    liquidityBand(row?.market?.liquidity_usd),
    cohort.value || "forming",
  ].join(":");
}

function percentile(values, target) {
  const usable = values.map(finite).filter((value) => value !== null).sort((a, b) => a - b);
  if (!usable.length || finite(target) === null) return null;
  if (usable.length === 1) return 50;
  const below = usable.filter((value) => value < target).length;
  const equal = usable.filter((value) => value === target).length;
  return Math.round(((below + Math.max(0, equal - 1) / 2) / (usable.length - 1)) * 100);
}

function stableRiskFlags(flags, observedAt, freshnessState = "current") {
  return Object.freeze(flags.map((value) => Object.freeze({
    value,
    availability: freshnessState === "stale" ? "stale" : "available",
    source_scope: "exact_pool_classification",
    observed_at: iso(observedAt),
    freshness: freshnessState,
    classifier: Object.freeze({ name: DISCOVER_CLASSIFIER_NAME, version: DISCOVER_CLASSIFIER_VERSION }),
  })));
}

function classifyOne(row, { timeframe = "5m", nowMs = Date.now() } = {}) {
  const chain = cleanText(row?.chain_id || row?.chain, 24).toLowerCase();
  const poolAddress = cleanText(row?.pool_address, 160);
  const instrumentId = cleanText(row?.instrument_id, 200);
  if (!CHAINS.has(chain) || row?.identity_scope !== "exact_pool" || !poolAddress || instrumentId !== `${chain}:pool:${poolAddress}`) return null;
  const observedAt = iso(row?.observed_at);
  if (!observedAt) return null;
  const rowFreshness = freshness(observedAt, nowMs);
  const retainedStale = rowFreshness.state === "stale" && row?.registry?.retained_after_trending === true;
  if (rowFreshness.state !== "current" && !retainedStale) return null;
  const measurements = timeframeMeasurements(row, timeframe, observedAt, rowFreshness.state);
  const cohort = migrationCohort(row, observedAt);
  const control = controlEvidence(row, observedAt);
  const raven = ravenEvidence(row, observedAt);
  const states = classifyStates(row, measurements, control, cohort);
  const risks = deriveRiskFlags(row, measurements, control);
  const raw = retainedStale
    ? Object.freeze({ velocity: null, activity: null, velocity_cap: null, velocity_cap_reason: null })
    : rawRankIndex(states, measurements, risks, row);
  const firstSeenAt = iso(row?.registry?.first_seen_at) || observedAt;
  const lastSeenAt = iso(row?.registry?.last_seen_at) || observedAt;
  const observationCount = Math.max(1, Math.floor(finite(row?.registry?.observation_count) || 1));
  const taxonomy = assetTaxonomy(row, observedAt);
  const sample = sampleEvidence(measurements, observationCount, observedAt);
  const lane = opportunityLane(states, taxonomy, risks, observedAt, rowFreshness.state);
  const notability = notabilityContract(row, {
    taxonomy,
    states,
    raven,
    measurements,
    sample,
    observedAt,
    observationCount,
  });
  const ranking = Object.freeze({
    velocity: crossCohortRanking("velocity", raw.velocity, sample, row, states, risks, observedAt),
    activity: crossCohortRanking("activity", raw.activity, sample, row, states, risks, observedAt),
  });
  const decisionSupport = decisionSupportContract(row, {
    states,
    measurements,
    risks,
    observationCount,
    timeframe,
  });
  const admissionLanes = [...new Set((Array.isArray(row?.registry?.admission_lanes) ? row.registry.admission_lanes : [
    raven.qualified ? "raven_observation" : "provider_current_input",
  ]).map((value) => cleanText(value, 60)).filter((value) => ADMISSION_LANES.has(value)))];
  const primaryBehavior = Object.freeze({
    value: PRIMARY_BEHAVIOR_STATES.has(states.primary) ? states.primary : "forming",
    availability: rowFreshness.state === "stale"
      ? "stale"
      : states.primary === "forming" ? "insufficient_history" : "available",
    source_scope: "exact_pool_observation_history",
    observed_at: observedAt,
    freshness: rowFreshness.state,
    classifier: Object.freeze({ name: DISCOVER_CLASSIFIER_NAME, version: DISCOVER_CLASSIFIER_VERSION }),
    historical_window_coverage: measurements.historical_window_coverage,
    explanation: states.why,
    hysteresis: Object.freeze({
      state: cleanText(row?.registry?.hysteresis_state, 30) || (observationCount < 2 ? "forming" : "stable"),
      confirmation_observations: Math.max(0, Math.floor(finite(row?.registry?.state_confirmation_observations) || 0)),
      contradictory_directional_state_published: false,
    }),
  });
  const base = {
    ...row,
    raven_signal: raven.raven_signal,
    discovery: Object.freeze({
      schema_version: DISCOVER_MARKET_SCHEMA,
      exact_identity: Object.freeze({
        instrument_id: instrumentId,
        identity_scope: "exact_pool",
        chain,
        venue: cleanText(row?.venue, 80),
        pool_address: poolAddress,
        token_address: cleanText(row?.token_address, 160),
        quote_token_address: cleanText(row?.quote_token_address, 160),
        quote_asset: cleanText(row?.quote_symbol, 24),
        fingerprint: poolAddress.length > 12 ? `${poolAddress.slice(0, 6)}…${poolAddress.slice(-5)}` : poolAddress,
      }),
      facts: Object.freeze({
        source_scope: cleanText(row?.evidence_scope, 100) || "exact_pool_market_facts",
        observed_at: observedAt,
        freshness: rowFreshness,
        provider_rank_is_input_only: true,
      }),
      migration_cohort: cohort,
      asset_taxonomy: taxonomy,
      opportunity_lane: lane,
      notability,
      sample_evidence: sample,
      ranking,
      primary_behavior_state: primaryBehavior,
      risk_flags: stableRiskFlags(risks, observedAt, rowFreshness.state),
      raven_evidence_state: raven,
      velocity_state: Object.freeze({
        value: VELOCITY_STATES.has(states.velocity) ? states.velocity : "forming",
        availability: rowFreshness.state === "stale"
          ? "stale"
          : states.velocity === "insufficient_history" ? "insufficient_history" : "available",
        source_scope: "exact_pool_derived_measurements",
        observed_at: observedAt,
        freshness: rowFreshness.state,
        classifier: Object.freeze({ name: DISCOVER_CLASSIFIER_NAME, version: DISCOVER_CLASSIFIER_VERSION }),
        historical_window_coverage: measurements.historical_window_coverage,
        raw_rank_index: raw.velocity,
        normalized_rank_index: null,
        score: scoreContract("velocity_ranking", raw.velocity, measurements, risks, raw, observedAt, rowFreshness.state),
        probability_claimed: false,
        alpha_claimed: false,
      }),
      activity_state: Object.freeze({
        value: ACTIVITY_STATES.has(states.activity) ? states.activity : "forming",
        availability: rowFreshness.state === "stale"
          ? "stale"
          : states.activity === "insufficient_history" ? "insufficient_history" : "available",
        source_scope: "exact_pool_derived_measurements",
        observed_at: observedAt,
        freshness: rowFreshness.state,
        classifier: Object.freeze({ name: DISCOVER_CLASSIFIER_NAME, version: DISCOVER_CLASSIFIER_VERSION }),
        historical_window_coverage: measurements.historical_window_coverage,
        raw_rank_index: raw.activity,
        normalized_rank_index: null,
        score: scoreContract("activity_ranking", raw.activity, measurements, risks, raw, observedAt, rowFreshness.state),
      }),
      measurements,
      control_intelligence: control,
      routeability: row?.routeability?.availability === "available" ? Object.freeze({
        availability: "available",
        source_scope: "exact_route_quote",
        observed_at: iso(row.routeability.observed_at),
        freshness: cleanText(row.routeability.freshness, 20) || "current",
        routeable_size_usd: finite(row.routeability.routeable_size_usd),
        estimated_slippage_bps: finite(row.routeability.estimated_slippage_bps),
      }) : Object.freeze({
        availability: "unavailable",
        source_scope: "exact_route_quote",
        observed_at: null,
        freshness: "unavailable",
        routeable_size_usd: null,
        estimated_slippage_bps: null,
      }),
      registry: Object.freeze({
        state: cleanText(row?.registry?.state, 30) || (observationCount > 1 ? "tracking" : "forming"),
        first_seen_at: firstSeenAt,
        last_seen_at: lastSeenAt,
        observation_count: observationCount,
        admission_lanes: admissionLanes,
        admission_reason: cleanText(row?.registry?.admission_reason, 180) || (raven.qualified ? "Exact Raven observation" : "Current market added to tracking"),
        retained_after_trending: row?.registry?.retained_after_trending === true,
        changed_since_last_published_observation: row?.registry?.changed_since_last_published_observation === true,
        customer_read_cursor_used: false,
        event_evidence_append_only: row?.registry?.event_evidence_append_only === true,
      }),
      path: Object.freeze({
        change_since_first_observation_pct: states.changeSinceFirst,
        ath_distance_pct: states.athDistance,
        recorded_high_distance_pct: finite(row?.registry?.recorded_high_distance_pct),
        max_drawdown_since_first_pct: states.drawdown,
        reclaim_state: cleanText(row?.registry?.reclaim_state, 40) || null,
      }),
      decision_support: Object.freeze({
        ...decisionSupport,
      }),
      outcome_evidence: Object.freeze({
        state: cleanText(row?.outcome_evidence?.state, 40) || "forming",
        future_sealed: row?.outcome_evidence?.future_sealed === true,
        checkpoints: Object.freeze(Object.fromEntries(WINDOWS.map((window) => [window, cleanText(row?.outcome_evidence?.checkpoints?.[window], 30) || "forming"]))),
        friction_complete: row?.outcome_evidence?.friction_complete === true,
        probability_claimed: false,
        profitability_claimed: false,
      }),
      cohort_key: cohortKey(row, cohort),
    }),
  };
  return base;
}

export function buildDiscoverRadarProjection(rows = [], {
  timeframe = "5m",
  generatedAt = new Date().toISOString(),
  nowMs = Date.now(),
  sourceState = "current",
} = {}) {
  const seen = new Set();
  const classified = [];
  for (const row of Array.isArray(rows) ? rows.slice(0, 240) : []) {
    const item = classifyOne(row, { timeframe, nowMs });
    if (!item || seen.has(item.instrument_id)) continue;
    seen.add(item.instrument_id);
    classified.push(item);
  }
  const cohorts = new Map();
  for (const row of classified) {
    const key = row.discovery.cohort_key;
    if (!cohorts.has(key)) cohorts.set(key, []);
    cohorts.get(key).push(row);
  }
  const normalized = classified.map((row) => {
    const peers = cohorts.get(row.discovery.cohort_key) || [];
    const velocityValues = peers.map((peer) => peer.discovery.velocity_state.raw_rank_index);
    const activityValues = peers.map((peer) => peer.discovery.activity_state.raw_rank_index);
    const velocityIndex = percentile(velocityValues, row.discovery.velocity_state.raw_rank_index);
    const activityIndex = percentile(activityValues, row.discovery.activity_state.raw_rank_index);
    const velocityScore = row.discovery.velocity_state.score.score;
    const activityScore = row.discovery.activity_state.score.score;
    const velocityRank = finite(row.discovery.velocity_state.raw_rank_index) === null
      ? null
      : 1 + velocityValues.map(finite).filter((value) => value !== null && value > row.discovery.velocity_state.raw_rank_index).length;
    const activityRank = finite(row.discovery.activity_state.raw_rank_index) === null
      ? null
      : 1 + activityValues.map(finite).filter((value) => value !== null && value > row.discovery.activity_state.raw_rank_index).length;
    return {
      ...row,
      discovery: Object.freeze({
        ...row.discovery,
        velocity_state: Object.freeze({
          ...row.discovery.velocity_state,
          normalized_rank_index: velocityIndex,
          score: Object.freeze({
            ...row.discovery.velocity_state.score,
            score: velocityScore,
            grade: scoreGrade(velocityScore),
            cohort_percentile: velocityIndex,
            cohort_rank: velocityRank,
            cohort_size: peers.length,
            sample_maturity: row.discovery.sample_evidence.state,
          }),
        }),
        activity_state: Object.freeze({
          ...row.discovery.activity_state,
          normalized_rank_index: activityIndex,
          score: Object.freeze({
            ...row.discovery.activity_state.score,
            score: activityScore,
            grade: scoreGrade(activityScore),
            cohort_percentile: activityIndex,
            cohort_rank: activityRank,
            cohort_size: peers.length,
            sample_maturity: row.discovery.sample_evidence.state,
          }),
        }),
        normalization: Object.freeze({
          schema_version: "ravenos.discover_cohort_normalization.v1",
          dimensions: Object.freeze(["chain", "market_cap_band", "liquidity_band", "migration_cohort"]),
          cohort_size: peers.length,
          state: peers.length >= 3 ? "available" : "forming",
          provider_rank_used: false,
          score_replaced_by_percentile: false,
          strength_and_sample_maturity_separate: true,
        }),
      }),
    };
  });
  return Object.freeze({
    ok: true,
    safe_public: true,
    schema_version: DISCOVER_RADAR_SCHEMA,
    generated_at: iso(generatedAt) || new Date(nowMs).toISOString(),
    timeframe: WINDOWS.includes(timeframe) ? timeframe : "5m",
    state: sourceState === "shadow"
      ? "forming"
      : ["current", "degraded", "forming"].includes(sourceState) ? sourceState : "forming",
    classifier: Object.freeze({
      name: DISCOVER_CLASSIFIER_NAME,
      version: DISCOVER_CLASSIFIER_VERSION,
      source_scope: "exact_pool_observation_history",
      monitor_eligible: false,
      evaluation_state: "forming",
    }),
    semantics: Object.freeze({
      migration_cohort_separate: true,
      primary_behavior_mutually_exclusive: true,
      risk_flags_may_coexist: true,
      raven_signal_requires_internal_observation: true,
      provider_rank_creates_raven_signal: false,
      cold_start_synthesizes_history: false,
      browser_creates_intelligence: false,
      cross_cohort_sort_is_server_derived: true,
      absolute_volume_tiebreaker_used: false,
      strength_is_not_sample_maturity: true,
      default_opportunities_require_server_notability: true,
      provider_trending_is_not_notability: true,
    }),
    monitor_safety: Object.freeze({
      enabled: false,
      classifier_version_change_action: "rebaseline_without_notification",
      version_changes_are_market_transitions: false,
      external_notifications_enabled: false,
    }),
    changed_since_last_read: Object.freeze({
      anonymous_scope: "last_published_observation_or_current_browser_session",
      authenticated_scope: "account_cursor_on_authenticated_origin_only",
      cross_device_anonymous_claimed: false,
    }),
    rows: normalized,
    row_count: normalized.length,
    public_safety: Object.freeze({
      raw_provider_payloads_exposed: false,
      private_participant_identities_exposed: false,
      execution_data_exposed: false,
      plan_prices_persisted: false,
      customer_state_in_registry: false,
      payment_overrides_display_rights: false,
    }),
  });
}

export function validateDiscoverRadarProjection(value, { nowMs = Date.now(), maxAgeSeconds = 3_600 } = {}) {
  if (
    value?.ok !== true
    || value?.safe_public !== true
    || value?.schema_version !== DISCOVER_RADAR_SCHEMA
    || !WINDOWS.includes(value?.timeframe)
    || !["current", "degraded", "forming", "shadow"].includes(value?.state)
    || value?.classifier?.name !== DISCOVER_CLASSIFIER_NAME
    || value?.classifier?.version !== DISCOVER_CLASSIFIER_VERSION
    || value?.classifier?.monitor_eligible !== false
    || value?.monitor_safety?.enabled !== false
    || value?.public_safety?.raw_provider_payloads_exposed !== false
    || value?.public_safety?.private_participant_identities_exposed !== false
    || value?.public_safety?.execution_data_exposed !== false
    || !Array.isArray(value?.rows)
    || value.rows.length > 240
  ) return null;
  const generatedMs = Date.parse(String(value.generated_at || ""));
  if (!Number.isFinite(generatedMs) || generatedMs > nowMs + 300_000 || nowMs - generatedMs > maxAgeSeconds * 1_000) return null;
  const rows = [];
  const ids = new Set();
  for (const row of value.rows) {
    const discovery = row?.discovery;
    const identity = discovery?.exact_identity;
    const factObservedMs = Date.parse(String(discovery?.facts?.observed_at || ""));
    const factAgeSeconds = Number.isFinite(factObservedMs)
      ? Math.max(0, Math.floor((nowMs - factObservedMs) / 1_000))
      : null;
    const expectedFactFreshness = factAgeSeconds !== null && factAgeSeconds <= DISCOVER_MARKET_FACT_TARGET_SECONDS
      ? "current"
      : "stale";
    if (
      discovery?.schema_version !== DISCOVER_MARKET_SCHEMA
      || !identity?.instrument_id
      || identity.instrument_id !== row.instrument_id
      || identity.identity_scope !== "exact_pool"
      || !CHAINS.has(identity.chain)
      || identity.instrument_id !== `${identity.chain}:pool:${identity.pool_address}`
      || ids.has(identity.instrument_id)
      || Date.parse(String(row.observed_at || "")) !== factObservedMs
      || discovery.facts?.freshness?.target_seconds !== DISCOVER_MARKET_FACT_TARGET_SECONDS
      || discovery.facts?.freshness?.state !== expectedFactFreshness
      || (expectedFactFreshness === "stale" && discovery.registry?.retained_after_trending !== true)
      || discovery.notability?.freshness !== expectedFactFreshness
      || discovery.velocity_state?.freshness !== expectedFactFreshness
      || discovery.activity_state?.freshness !== expectedFactFreshness
      || (expectedFactFreshness === "stale" && discovery.notability?.default_opportunity_eligible !== false)
      || !PRIMARY_BEHAVIOR_STATES.has(discovery.primary_behavior_state?.value)
      || !VELOCITY_STATES.has(discovery.velocity_state?.value)
      || !ACTIVITY_STATES.has(discovery.activity_state?.value)
      || !ASSET_TAXONOMIES.has(discovery.asset_taxonomy?.value)
      || !OPPORTUNITY_LANES.has(discovery.opportunity_lane?.value)
      || discovery.notability?.schema_version !== DISCOVER_NOTABILITY_SCHEMA
      || !["notable", "watch_only"].includes(discovery.notability?.state)
      || typeof discovery.notability?.qualified !== "boolean"
      || discovery.notability?.default_opportunity_eligible !== (
        discovery.asset_taxonomy?.default_opportunity_eligible === true
        && discovery.notability?.qualified === true
      )
      || finite(discovery.notability?.priority) === null
      || discovery.notability.priority < 0
      || discovery.notability.priority > 199
      || discovery.notability?.browser_derived !== false
      || discovery.notability?.provider_rank_used !== false
      || (discovery.notability?.qualified === true && !discovery.notability?.primary_trigger)
      || !["robust", "developing", "fragile", "insufficient"].includes(discovery.sample_evidence?.state)
      || discovery.ranking?.velocity?.absolute_volume_tiebreaker_used !== false
      || discovery.ranking?.activity?.absolute_volume_tiebreaker_used !== false
      || discovery.primary_behavior_state?.classifier?.version !== value.classifier.version
      || discovery.risk_flags?.some((flag) => !RISK_FLAGS.has(flag?.value))
      || (discovery.raven_evidence_state?.raven_signal === true && discovery.raven_evidence_state?.qualified !== true)
    ) return null;
    ids.add(identity.instrument_id);
    rows.push(row);
  }
  return Object.freeze({ ...value, rows: Object.freeze(rows) });
}

export function mergeExactRadarRows(...groups) {
  const merged = new Map();
  for (const row of groups.flat().filter(Boolean)) {
    const id = cleanText(row?.instrument_id, 200);
    if (!id) continue;
    const current = merged.get(id);
    if (!current) {
      merged.set(id, row);
      continue;
    }
    const currentObserved = Date.parse(String(current.observed_at || ""));
    const nextObserved = Date.parse(String(row.observed_at || ""));
    const currentRaven = current.discovery?.raven_evidence_state?.qualified === true;
    const nextRaven = row.discovery?.raven_evidence_state?.qualified === true;
    const preferred = nextObserved >= currentObserved ? row : current;
    const registry = nextRaven ? row.discovery : currentRaven ? current.discovery : preferred.discovery;
    merged.set(id, {
      ...preferred,
      raven_signal: registry?.raven_evidence_state?.raven_signal === true,
      discovery: registry || preferred.discovery,
    });
  }
  return [...merged.values()];
}

export const __testing = Object.freeze({
  finite,
  flow,
  rateAcceleration,
  returnRateAcceleration,
  timeframeMeasurements,
  classifyStates,
  deriveRiskFlags,
  migrationCohort,
  controlEvidence,
  ravenEvidence,
  marketCapBand,
  liquidityBand,
});
