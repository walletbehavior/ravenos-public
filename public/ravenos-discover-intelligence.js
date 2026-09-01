const clamp = (value, minimum = 0, maximum = 100) => Math.min(maximum, Math.max(minimum, value));

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

const ATTENTION_BENCHMARK_SCHEMA = "ravenos_market_attention_benchmark_public_v1";
const ATTENTION_SAFETY_FLAGS = Object.freeze([
  "market_addresses_exposed",
  "participant_identities_exposed",
  "private_lineage_exposed",
  "raw_reference_payloads_exposed",
  "reference_source_identity_exposed",
]);

function validBenchmarkOverlap(row, referenceEpisodes) {
  const episodes = finite(row?.episodes);
  const medianLeadSeconds = finite(row?.median_lead_seconds);
  const share = finite(row?.share_of_reference_episodes);
  if (
    episodes === null
    || medianLeadSeconds === null
    || share === null
    || episodes < 0
    || episodes > referenceEpisodes
    || medianLeadSeconds < 0
    || share < 0
    || share > 1
  ) return null;
  const calculatedShare = referenceEpisodes > 0 ? episodes / referenceEpisodes : 0;
  if (Math.abs(calculatedShare - share) > 0.002) return null;
  return Object.freeze({
    episodes,
    label: cleanText(row?.label),
    medianLeadSeconds,
    share,
  });
}

export function validateAttentionBenchmark(census = {}, { nowMs = Date.now(), clockSkewMs = 5 * 60 * 1_000 } = {}) {
  const benchmark = census?.attention_benchmark;
  if (!benchmark || benchmark.schema_version !== ATTENTION_BENCHMARK_SCHEMA) return null;

  const generatedMs = Date.parse(benchmark.generated_at || "");
  const ageSeconds = finite(benchmark.freshness?.age_seconds);
  const targetSeconds = finite(benchmark.freshness?.target_seconds);
  if (
    !Number.isFinite(generatedMs)
    || !["current", "delayed"].includes(benchmark.freshness?.state)
    || ageSeconds === null
    || targetSeconds === null
    || ageSeconds < 0
    || targetSeconds <= 0
    || ageSeconds > targetSeconds
    || generatedMs > nowMs + clockSkewMs
    || nowMs - generatedMs > targetSeconds * 1_000 + clockSkewMs
  ) return null;

  const publicSafety = benchmark.public_safety || {};
  if (ATTENTION_SAFETY_FLAGS.some((flag) => publicSafety[flag] !== false)) return null;
  const interpretation = benchmark.interpretation || {};
  if (
    interpretation.profitability_claimed !== false
    || interpretation.selected_instrument_claimed !== false
    || interpretation.tradeable_rule_claimed !== false
  ) return null;

  const referenceEpisodes = finite(benchmark.reference_scope?.episode_count);
  const distinctMarkets = finite(benchmark.reference_scope?.distinct_markets);
  if (
    referenceEpisodes === null
    || distinctMarkets === null
    || referenceEpisodes <= 0
    || distinctMarkets <= 0
    || distinctMarkets > referenceEpisodes
    || !cleanText(benchmark.reference_scope?.label)
    || !cleanText(benchmark.reference_scope?.deduplication)
  ) return null;

  const observation = validBenchmarkOverlap(benchmark.raven_lead?.observation, referenceEpisodes);
  const behavior = validBenchmarkOverlap(benchmark.raven_lead?.behavior, referenceEpisodes);
  const exactDecisionContext = validBenchmarkOverlap(benchmark.raven_lead?.exact_decision_context, referenceEpisodes);
  if (!observation || !behavior || !exactDecisionContext) return null;

  return Object.freeze({
    schemaVersion: ATTENTION_BENCHMARK_SCHEMA,
    generatedAt: benchmark.generated_at,
    freshness: benchmark.freshness.state,
    referenceLabel: cleanText(benchmark.reference_scope.label),
    deduplication: cleanText(benchmark.reference_scope.deduplication),
    referenceEpisodes,
    distinctMarkets,
    observation,
    behavior,
    exactDecisionContext,
    headline: cleanText(interpretation.headline),
    scope: cleanText(interpretation.scope),
  });
}

function cleanText(value) {
  const result = String(value ?? "").trim();
  if (!result || /\b(?:unknown|unavailable|not available|stale)\b/i.test(result)) return "";
  return result;
}

function median(values = []) {
  const sorted = values.map(finite).filter((value) => value !== null).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function compact(value, { currency = false } = {}) {
  const result = finite(value);
  if (result === null) return "";
  const output = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(result);
  return currency ? `$${output}` : output;
}

function percent(value, digits = 2) {
  const result = finite(value);
  if (result === null) return "";
  return `${result >= 0 ? "+" : ""}${result.toFixed(Math.abs(result) < 0.1 ? 3 : digits)}%`;
}

function price(value) {
  const result = finite(value);
  if (result === null || result <= 0) return "";
  if (result >= 1_000) return `$${result.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (result >= 1) return `$${result.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
  return `$${result.toLocaleString("en-US", { minimumSignificantDigits: 2, maximumSignificantDigits: 5 })}`;
}

function windowMetric(row, metric, timeframe) {
  const suffix = ["price_change", "volume_change", "liquidity_change", "holder_change"].includes(metric) ? "_pct" : "";
  return finite(row?.market?.[`${metric}_${timeframe}${suffix}`]);
}

function flowWindow(row, timeframe) {
  const buys = windowMetric(row, "buys", timeframe);
  const sells = windowMetric(row, "sells", timeframe);
  const buyers = windowMetric(row, "buyers", timeframe);
  const sellers = windowMetric(row, "sellers", timeframe);
  const transactions = buys !== null && sells !== null ? buys + sells : null;
  const participants = buyers !== null && sellers !== null ? buyers + sellers : null;
  return {
    buys,
    sells,
    buyers,
    sellers,
    transactions,
    participants,
    buyShare: transactions && transactions > 0 ? buys / transactions : null,
    participantBuyShare: participants && participants > 0 ? buyers / participants : null,
  };
}

export function spotMarketHealth(row = {}) {
  const market = row.market || {};
  const liquidity = finite(market.liquidity_usd);
  const marketCap = finite(market.market_cap_usd ?? market.fdv_usd);
  const volume5m = finite(market.volume_usd_5m);
  const volume1h = finite(market.volume_usd_1h);
  const volume24h = finite(market.volume_usd_24h);
  const five = flowWindow(row, "5m");
  const hour = flowWindow(row, "1h");
  const change1h = finite(market.price_change_1h_pct);
  const change24h = finite(market.price_change_24h_pct);

  if (
    (volume5m !== null && volume5m <= 0)
    && (volume1h !== null && volume1h <= 0)
    && (five.transactions === null || five.transactions <= 0)
    && (hour.transactions === null || hour.transactions <= 0)
  ) {
    return { state: "inactive", label: "Inactive", tone: "negative", scoreCap: 10 };
  }
  if (
    (liquidity !== null && liquidity < 2_500)
    || (marketCap !== null && marketCap > 0 && marketCap < 5_000)
    || (volume24h !== null && volume24h < 250)
  ) {
    return { state: "fragile", label: "Fragile depth", tone: "negative", scoreCap: 28 };
  }
  if ((change1h !== null && change1h <= -35) || (change24h !== null && change24h <= -70)) {
    return { state: "unstable", label: "Unstable", tone: "negative", scoreCap: 34 };
  }
  if ((change1h !== null && change1h >= 75) || (change24h !== null && change24h >= 300)) {
    return { state: "extended", label: "Extended / chase risk", tone: "warning", scoreCap: 66 };
  }
  if (
    (volume5m !== null && volume5m < 100)
    && (five.transactions === null || five.transactions < 3)
    && (volume1h === null || volume1h < 1_000)
  ) {
    return { state: "thinning", label: "Flow thinning", tone: "warning", scoreCap: 42 };
  }
  if (
    (volume5m !== null && volume5m >= 500)
    || (five.transactions !== null && five.transactions >= 5)
  ) {
    return { state: "active", label: "Active market", tone: "positive", scoreCap: 100 };
  }
  return { state: "current", label: "Current market", tone: "neutral", scoreCap: 72 };
}

export function spotFlowRead(row = {}, timeframe = "5m") {
  const current = flowWindow(row, timeframe);
  const five = flowWindow(row, "5m");
  const hour = flowWindow(row, "1h");
  const market = row.market || {};
  const movement = windowMetric(row, "price_change", timeframe);
  const volume = windowMetric(row, "volume_usd", timeframe);
  const liquidity = finite(market.liquidity_usd);
  const turnover = volume !== null && liquidity !== null && liquidity > 0 ? volume / liquidity : null;
  const health = spotMarketHealth(row);
  const participantAlignedBuy = five.participants !== null && five.participants >= 6
    && hour.participants !== null && hour.participants >= 10
    && five.participantBuyShare >= 0.58 && hour.participantBuyShare >= 0.55;
  const participantAlignedSell = five.participants !== null && five.participants >= 6
    && hour.participants !== null && hour.participants >= 10
    && five.participantBuyShare <= 0.42 && hour.participantBuyShare <= 0.45;
  const enoughTransactions = current.transactions !== null && current.transactions >= 5;

  let state = "balanced";
  let label = "Balanced flow";
  let tone = "neutral";
  if (participantAlignedBuy) {
    state = "accumulation";
    label = "Accumulation";
    tone = "positive";
  } else if (participantAlignedSell) {
    state = "distribution";
    label = "Distribution";
    tone = "negative";
  } else if (enoughTransactions && current.buyShare >= 0.62) {
    state = "buy_pressure";
    label = "Buy-side pressure";
    tone = "positive";
  } else if (enoughTransactions && current.buyShare <= 0.38) {
    state = "sell_pressure";
    label = "Sell-side pressure";
    tone = "negative";
  } else if (movement !== null && Math.abs(movement) >= 3 && volume !== null && volume > 0) {
    state = "expansion";
    label = "Momentum expansion";
    tone = movement >= 0 ? "positive" : "negative";
  }

  let score = 28;
  if (volume !== null && volume > 0) score += clamp(Math.log10(volume + 1) * 5, 0, 24);
  if (liquidity !== null && liquidity > 0) score += clamp(Math.log10(liquidity + 1) * 3 - 6, 0, 15);
  if (current.transactions !== null) score += clamp(Math.log10(current.transactions + 1) * 8, 0, 14);
  if (["accumulation", "distribution"].includes(state)) score += 14;
  else if (["buy_pressure", "sell_pressure"].includes(state)) score += 9;
  else if (state === "expansion") score += 6;
  if (turnover !== null && turnover >= 0.02 && turnover <= 0.5) score += 7;
  if (movement !== null && Math.abs(movement) > 35) score -= 12;
  score = Math.round(Math.min(health.scoreCap, clamp(score, 0, 99)));

  const activeShare = current.participantBuyShare ?? current.buyShare;
  const shareLabel = activeShare === null ? "" : `${Math.round(activeShare * 100)}% buy-side`;
  const priceLabel = movement === null ? "" : `price ${percent(movement)}`;
  const summary = [label, shareLabel, priceLabel].filter(Boolean).join(" · ");
  const detail = [
    turnover === null ? "" : `${(turnover * 100).toFixed(turnover < 0.01 ? 2 : 1)}% liquidity turnover`,
    current.participants !== null ? `${compact(current.participants)} participants` : current.transactions !== null ? `${compact(current.transactions)} transactions` : "",
    health.label,
  ].filter(Boolean).join(" · ");

  return {
    schema_version: "ravenos.spot_flow_read.v1",
    state,
    label,
    tone,
    score,
    summary,
    detail,
    buy_share: activeShare,
    transaction_count: current.transactions,
    participant_count: current.participants,
    turnover_ratio: turnover,
    market_health: health,
  };
}

export function spotVelocityRead(row = {}, timeframe = "5m") {
  const movement = windowMetric(row, "price_change", timeframe);
  const volume = windowMetric(row, "volume_usd", timeframe);
  const traders = windowMetric(row, "traders", timeframe);
  const market = row.market || {};
  const liquidity = finite(market.liquidity_usd);
  const flow = spotFlowRead(row, timeframe);
  const health = flow.market_health;
  const magnitude = movement === null ? null : Math.abs(movement);
  const turnover = volume !== null && liquidity !== null && liquidity > 0 ? volume / liquidity : null;
  const buyShare = finite(flow.buy_share);
  const direction = movement === null || movement === 0 ? "flat" : movement > 0 ? "up" : "down";
  const flowAligned = direction === "up"
    ? buyShare !== null && buyShare >= 0.56
    : direction === "down" ? buyShare !== null && buyShare <= 0.44 : false;
  const flowOpposed = direction === "up"
    ? buyShare !== null && buyShare <= 0.44
    : direction === "down" ? buyShare !== null && buyShare >= 0.56 : false;
  const confirmationWindows = ["5m", "1h", "24h"]
    .map((window) => windowMetric(row, "price_change", window))
    .filter((value) => value !== null && value !== 0);
  const confirmedWindows = direction === "flat"
    ? 0
    : confirmationWindows.filter((value) => direction === "up" ? value > 0 : value < 0).length;
  const chaseThreshold = timeframe === "5m" ? 20 : timeframe === "1h" ? 75 : 250;
  const chaseRisk = health.state === "extended"
    || (magnitude !== null && magnitude >= chaseThreshold)
    || (turnover !== null && turnover >= (timeframe === "24h" ? 25 : timeframe === "1h" ? 8 : 2.5));

  let score = 10;
  if (magnitude !== null && magnitude > 0) score += clamp(Math.log10(magnitude + 1) * 18, 0, 30);
  score += flow.score * 0.34;
  if (volume !== null && volume > 0) score += clamp(Math.log10(volume + 1) * 2.2, 0, 14);
  if (traders !== null && traders > 0) score += clamp(Math.log10(traders + 1) * 3.2, 0, 9);
  if (turnover !== null && turnover >= 0.01) score += turnover <= 5 ? 7 : turnover <= 20 ? 4 : 0;
  if (flowAligned) score += 10;
  if (flowOpposed) score -= 14;
  if (confirmedWindows >= 3) score += 7;
  else if (confirmedWindows >= 2) score += 4;
  if (row.broader_attention?.raven_observed_first === true) score += 5;
  const jupiterOrganicScore = finite(row.jupiter?.organic_score);
  if (row.source_type === "jupiter_velocity") score += jupiterOrganicScore === null ? 4 : clamp(jupiterOrganicScore / 12, 2, 8);
  if (row.source_type === "raven_spot_attention") score += 6;
  const chain = String(row.chain_id || row.chain || "").toLowerCase();
  if (/meteora/i.test(String(row.venue || "")) && chain === "solana") score += 3;
  const providerRank = finite(row.provider_rank);
  if (chain === "robinhood" && row.source_type === "market_activity" && providerRank !== null && providerRank <= 5) score += 4;
  if (chaseRisk) score -= 10;
  score = Math.round(Math.min(health.scoreCap, clamp(score, 0, 99)));

  let state = "price_velocity";
  let label = direction === "down" ? "Downside velocity" : "Upside velocity";
  let tone = direction === "down" ? "negative" : direction === "up" ? "positive" : "neutral";
  if (flowOpposed) {
    state = "flow_divergence";
    label = "Flow divergence";
    tone = "warning";
  } else if (flowAligned) {
    state = direction === "down" ? "downside_confirmed" : "upside_confirmed";
    label = direction === "down" ? "Downside confirmed" : "Velocity confirmed";
  } else if (direction === "flat") {
    state = "flat";
    label = "No velocity edge";
    tone = "neutral";
  }
  if (chaseRisk && !flowOpposed) {
    state = "chase_risk";
    label = "Extended / chase risk";
    tone = "warning";
  }

  const grade = score >= 82 ? "A" : score >= 68 ? "B" : score >= 52 ? "C" : "D";
  const interestThreshold = timeframe === "5m" ? 5 : timeframe === "1h" ? 10 : 25;
  const trackedLane = row.source_type === "raven_spot_attention"
    || row.source_type === "jupiter_velocity"
    || chain === "robinhood"
    || /meteora|jupiter/i.test(String(row.venue || ""));
  const compellingMove = magnitude !== null && magnitude >= interestThreshold;
  const trackedException = trackedLane
    && magnitude !== null
    && magnitude >= interestThreshold * 0.5
    && flowAligned
    && score >= 52;
  const participationException = magnitude !== null
    && magnitude >= interestThreshold * 0.7
    && flowAligned
    && flow.score >= 68
    && confirmedWindows >= 2;
  const robinhoodParticipationException = chain === "robinhood"
    && magnitude !== null
    && magnitude >= interestThreshold * 0.3
    && flowAligned
    && flow.score >= 68
    && finite(flow.transaction_count) >= 80
    && turnover !== null
    && turnover >= 0.025
    && confirmedWindows >= 2;
  const sideLabel = buyShare === null ? "" : `${Math.round(buyShare * 100)}% buy-side`;
  const headline = [
    movement === null ? "" : `${percent(movement)} ${timeframe}`,
    sideLabel,
    confirmedWindows >= 2 ? `${confirmedWindows}/3 windows aligned` : "",
  ].filter(Boolean).join(" · ");
  const detail = [
    volume !== null && volume > 0 ? `${compact(volume, { currency: true })} volume` : "",
    traders !== null && traders > 0 ? `${compact(traders)} traders` : flow.transaction_count ? `${compact(flow.transaction_count)} transactions` : "",
    turnover === null ? "" : `${(turnover * 100).toFixed(turnover < 0.01 ? 2 : 1)}% liquidity turnover`,
    chaseRisk ? "chase risk elevated" : health.label,
  ].filter(Boolean).join(" · ");

  return {
    schema_version: "ravenos.spot_velocity_read.v1",
    state,
    label,
    tone,
    score,
    grade,
    qualified: movement !== null
      && magnitude > 0
      && volume !== null
      && volume > 0
      && liquidity !== null
      && liquidity > 0
      && !["inactive", "fragile"].includes(health.state)
      && score >= 42
      && (compellingMove || trackedException || participationException || robinhoodParticipationException),
    direction,
    movement_pct: movement,
    flow_aligned: flowAligned,
    flow_opposed: flowOpposed,
    confirmed_windows: confirmedWindows,
    chase_risk: chaseRisk,
    tracked_lane: trackedLane,
    admission_reason: compellingMove
      ? "compelling_move"
      : robinhoodParticipationException
        ? "robinhood_flow_breakout"
        : trackedException
          ? "tracked_flow_exception"
          : participationException ? "exceptional_participation" : "below_interest_gate",
    interest_threshold_pct: interestThreshold,
    buy_share: buyShare,
    turnover_ratio: turnover,
    headline,
    detail,
    flow,
  };
}

export function opportunityLifecycle(row = {}, market = row.market_snapshot || {}) {
  const direction = String(row.observed_direction || "").toLowerCase();
  const hasDirection = ["long", "short"].includes(direction);
  const currentPrice = finite(market.last_price ?? market.mark_price);
  const entryPrice = finite(row.market_context?.entry_reference_price);
  const rawMove = currentPrice !== null && currentPrice > 0 && entryPrice !== null && entryPrice > 0
    ? ((currentPrice / entryPrice) - 1) * 100
    : null;
  const signedMove = rawMove === null || !hasDirection
    ? null
    : direction === "short" ? -rawMove : rawMove;
  const comparable = row.matured_comparables || {};
  const sampleSize = finite(comparable.sample_size);
  const positiveRate = finite(comparable.positive_followthrough_rate);
  const directionalRate = positiveRate === null || !hasDirection
    ? null
    : direction === "short" ? 1 - positiveRate : positiveRate;
  const favorable = Math.abs(finite(comparable.median_favorable_excursion_pct) || 0);
  const adverse = Math.abs(finite(comparable.median_adverse_excursion_pct) || 0);
  const ageSeconds = finite(row.context_age_seconds);
  const friction = finite(row.market_context?.roundtrip_bps);
  const pressure = String(row.pressure_state || "").toLowerCase();
  const aligned = (direction === "long" && pressure.includes("bid-side"))
    || (direction === "short" && pressure.includes("ask-side"));
  const opposed = (direction === "long" && pressure.includes("ask-side"))
    || (direction === "short" && pressure.includes("bid-side"));
  const invalidationDistance = Math.max(0.5, adverse * 0.8);
  const confirmationDistance = Math.max(0.15, favorable * 0.2);

  let state = hasDirection ? "forming" : "watch";
  let label = hasDirection ? "Forming" : "Watch";
  let tone = "neutral";
  let summary = hasDirection
    ? "The setup is current, but price and pressure have not fully aligned."
    : "Current behavior is being monitored, but Raven has not promoted it to a directional setup.";
  if (hasDirection && signedMove !== null && signedMove <= -invalidationDistance) {
    state = "invalidated";
    label = "Invalidated";
    tone = "negative";
    summary = "The observed path moved beyond its typical adverse range; Raven has demoted it.";
  } else if (
    (signedMove !== null && signedMove <= -Math.max(0.15, adverse * 0.25))
    || (ageSeconds !== null && ageSeconds > 2_700 && signedMove !== null && signedMove <= 0)
  ) {
    state = "fading";
    label = "Fading";
    tone = "warning";
    summary = "Follow-through is weakening, so the setup is decaying in the queue.";
  } else if (
    signedMove !== null && signedMove >= confirmationDistance
    && (aligned || (directionalRate !== null && directionalRate >= 0.52))
  ) {
    state = "confirmed";
    label = "Confirmed";
    tone = "positive";
    summary = "Price is following through in Raven's observed direction.";
  }

  let score = hasDirection ? 38 : 20;
  if (sampleSize !== null) score += sampleSize >= 100 ? 14 : sampleSize >= 30 ? 10 : sampleSize >= 10 ? 6 : 0;
  if (directionalRate !== null) {
    if (directionalRate >= 0.60) score += 16;
    else if (directionalRate >= 0.55) score += 11;
    else if (directionalRate >= 0.50) score += 5;
    else if (directionalRate < 0.45) score -= 9;
  }
  if (aligned) score += 11;
  if (opposed) score -= 12;
  if (ageSeconds !== null) score += ageSeconds <= 900 ? 10 : ageSeconds <= 1_800 ? 7 : ageSeconds <= 3_600 ? 3 : -10;
  if (friction !== null) score -= friction > 25 ? 9 : friction > 15 ? 4 : 0;
  if (state === "confirmed") score += 12;
  if (state === "fading") score -= 18;
  if (state === "invalidated") score = Math.min(score - 28, 20);
  if (state === "watch") score = Math.min(score, 34);
  score = Math.round(clamp(score, 0, 99));

  const quality = state === "watch"
    ? "Watch only"
    : score >= 75 ? "High signal" : score >= 55 ? "Supported" : score >= 35 ? "Developing" : "Low signal";
  const invalidationPrice = entryPrice === null || adverse <= 0 || !hasDirection
    ? null
    : direction === "short" ? entryPrice * (1 + adverse / 100) : entryPrice * (1 - adverse / 100);
  const invalidation = invalidationPrice === null
    ? ""
    : `${direction === "short" ? "Risk above" : "Risk below"} ${price(invalidationPrice)} (${adverse.toFixed(2)}% median adverse range)`;

  return {
    schema_version: "ravenos.opportunity_lifecycle.v1",
    state,
    label,
    tone,
    score,
    quality,
    promoted: state !== "watch" && state !== "invalidated" && score >= 50,
    summary,
    direction: hasDirection ? direction : "",
    raw_move_pct: rawMove,
    directional_move_pct: signedMove,
    directional_followthrough_rate: directionalRate,
    invalidation_price: invalidationPrice,
    invalidation,
  };
}

function latestTimestamp(values = []) {
  return values.filter(Boolean).sort((left, right) => Date.parse(right) - Date.parse(left))[0] || null;
}

export function buildDeskFrame({ brief = null, markets = [], spotRows = [], opportunityRows = [], atlas = null, timeframe = "5m" } = {}) {
  const activePerps = markets.filter((row) => (
    finite(row.last_price ?? row.mark_price) > 0
    && finite(row.day_notional_volume_usd) > 0
    && finite(row.day_change_pct) !== null
  ));
  const changes = activePerps.map((row) => finite(row.day_change_pct)).filter((value) => value !== null);
  const advancers = changes.filter((value) => value > 0).length;
  const decliners = changes.filter((value) => value < 0).length;
  const breadthShare = changes.length ? advancers / changes.length : null;
  const medianChange = median(changes);
  const totalOpenInterest = activePerps.reduce((sum, row) => sum + (finite(row.open_interest_usd) || 0), 0);
  const weightedFunding = totalOpenInterest > 0
    ? activePerps.reduce((sum, row) => sum + (finite(row.funding_rate) || 0) * (finite(row.open_interest_usd) || 0), 0) / totalOpenInterest
    : null;

  const eligibleSpot = spotRows.filter((row) => (
    row?.discovery?.schema_version === "ravenos.discover_market.v1"
    && row?.discovery?.measurements?.timeframe === timeframe
  ));
  const accumulating = eligibleSpot.filter((row) => ["accumulation", "absorption", "participation_accelerating"].includes(row?.discovery?.activity_state?.value)).length;
  const distributing = eligibleSpot.filter((row) => ["distribution", "participation_decelerating"].includes(row?.discovery?.activity_state?.value)).length;
  const balanced = eligibleSpot.filter((row) => row?.discovery?.activity_state?.value === "balanced").length;
  const directional = accumulating + distributing;
  const spotVolume = eligibleSpot.reduce((sum, row) => sum + (windowMetric(row, "volume_usd", timeframe) || 0), 0);
  const opportunityReads = opportunityRows.map((row) => opportunityLifecycle(row, row.market_snapshot || {}));
  const lifecycleCounts = Object.fromEntries(["confirmed", "forming", "watch", "fading", "invalidated"].map((key) => [
    key,
    opportunityReads.filter((row) => row.state === key).length,
  ]));

  const cards = [];
  if (changes.length >= 5) {
    const breadthTone = breadthShare >= 0.58 ? "positive" : breadthShare <= 0.42 ? "negative" : "neutral";
    cards.push({
      key: "perp_breadth",
      label: "Perp breadth",
      value: `${Math.round(breadthShare * 100)}% advancing`,
      detail: `${advancers} up · ${decliners} down · median ${percent(medianChange)}`,
      tone: breadthTone,
    });
  }
  if (weightedFunding !== null && totalOpenInterest > 0) {
    const fundingPct = weightedFunding * 100;
    const fundingLabel = fundingPct > 0.0025 ? "Longs paying" : fundingPct < -0.0025 ? "Shorts paying" : "Funding balanced";
    cards.push({
      key: "positioning",
      label: "Positioning",
      value: fundingLabel,
      detail: `OI-weighted ${percent(fundingPct, 4)} · ${compact(totalOpenInterest, { currency: true })} open interest`,
      tone: fundingPct > 0.0025 ? "warning" : fundingPct < -0.0025 ? "positive" : "neutral",
    });
  }
  if (eligibleSpot.length) {
    const flowValue = directional === 0
      ? balanced > 0 ? "Flow is balanced" : "Direction not established"
      : accumulating > distributing
        ? "Buy pressure leads"
        : distributing > accumulating ? "Sell pressure leads" : "Flow is mixed";
    const flowCounts = directional > 0
      ? [
        accumulating ? `${accumulating} buy-led ${accumulating === 1 ? "pool" : "pools"}` : "",
        distributing ? `${distributing} sell-led ${distributing === 1 ? "pool" : "pools"}` : "",
        balanced ? `${balanced} balanced ${balanced === 1 ? "pool" : "pools"}` : "",
      ].filter(Boolean).join(" · ")
      : balanced > 0
        ? `${balanced} balanced ${balanced === 1 ? "pool" : "pools"}`
        : "No directional pool reads";
    cards.push({
      key: "onchain_flow",
      label: "On-chain flow",
      value: flowValue,
      detail: `${flowCounts} · ${compact(spotVolume, { currency: true })} ${timeframe} volume`,
      tone: accumulating > distributing ? "positive" : distributing > accumulating ? "negative" : "neutral",
    });
  }
  if (opportunityReads.length) {
    const value = [
      lifecycleCounts.confirmed ? `${lifecycleCounts.confirmed} confirmed` : "",
      lifecycleCounts.forming ? `${lifecycleCounts.forming} forming` : "",
      !lifecycleCounts.confirmed && !lifecycleCounts.forming && lifecycleCounts.watch ? `${lifecycleCounts.watch} watch-only` : "",
    ].filter(Boolean).join(" · ") || "Queue is decaying";
    const heldBack = [
      lifecycleCounts.watch ? `${lifecycleCounts.watch} watch-only held below setups` : "",
      lifecycleCounts.fading + lifecycleCounts.invalidated
        ? `${lifecycleCounts.fading + lifecycleCounts.invalidated} fading or invalidated demoted`
        : "",
    ].filter(Boolean).join(" · ") || "No lower-quality reads are being promoted";
    cards.push({
      key: "lifecycle",
      label: "Setup lifecycle",
      value,
      detail: heldBack,
      tone: lifecycleCounts.confirmed ? "positive" : lifecycleCounts.fading + lifecycleCounts.invalidated ? "warning" : "neutral",
    });
  }
  const atlasContext = atlas?.market_context || atlas || {};
  const atlasRisk = cleanText(atlasContext.risk_regime);
  const atlasEquity = cleanText(atlasContext.equity_regime);
  const atlasParticipation = cleanText(atlasContext.participation_quality || atlasContext.sector_breadth);
  if (atlasRisk || atlasEquity || atlasParticipation) {
    cards.push({
      key: "cross_market",
      label: "Cross-market",
      value: [atlasRisk ? `${atlasRisk} risk` : "", atlasEquity ? `${atlasEquity} equities` : ""].filter(Boolean).join(" · "),
      detail: atlasParticipation ? `${atlasParticipation} participation` : "",
      tone: /risk.?off|weak|down|fragile/i.test(`${atlasRisk} ${atlasEquity} ${atlasParticipation}`) ? "warning" : "neutral",
    });
  }

  const summary = cleanText(brief?.one_sentence_read)
    || (breadthShare !== null
      ? `Perpetual breadth is ${breadthShare >= 0.58 ? "expanding" : breadthShare <= 0.42 ? "contracting" : "mixed"}; on-chain participation remains selective.`
      : eligibleSpot.length ? "On-chain participation is active, with flow quality varying by exact pool." : "");
  const signals = [
    cleanText(brief?.best_opportunity_surface || brief?.best_surface),
    cleanText(brief?.participation_change),
    cleanText(brief?.reward_change),
  ].filter((value, index, values) => value && values.indexOf(value) === index).slice(0, 3);
  const observedAt = latestTimestamp([
    brief?.generated_at,
    atlas?.generated_at,
    ...activePerps.map((row) => row.observed_at),
    ...spotRows.map((row) => row.observed_at),
  ]);

  return {
    schema_version: "ravenos.discover_desk.v1",
    summary,
    signals,
    cards: cards.filter((card) => card.value || card.detail).slice(0, 5),
    observed_at: observedAt,
    lifecycle_counts: lifecycleCounts,
  };
}

export const __testing = Object.freeze({ finite, median, cleanText, flowWindow, windowMetric });
