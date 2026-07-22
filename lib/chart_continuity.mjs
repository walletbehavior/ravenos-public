export const RAVENOS_CHART_CONTINUITY_SCHEMA = "ravenos.chart_continuity.v1";

export const CHART_INTERVAL_SECONDS = Object.freeze({
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3_600,
  "4h": 14_400,
  "1d": 86_400,
});

// These are the only derivations that passed the exact-pool bake-off. In
// particular, 1m -> 5m is intentionally absent: representative pools showed
// incomplete source buckets and materially different reported volume.
export const PRIMARY_PROVIDER_DERIVATIONS = Object.freeze({
  "15m": Object.freeze({ source_interval: "5m", expected_source_bars: 3 }),
  "1h": Object.freeze({ source_interval: "15m", expected_source_bars: 4 }),
  "4h": Object.freeze({ source_interval: "1h", expected_source_bars: 4 }),
  "1d": Object.freeze({ source_interval: "1h", expected_source_bars: 24 }),
});

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function epochSeconds(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value > 10_000_000_000 ? value / 1_000 : value);
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && String(value || "").trim() !== "") {
    return Math.trunc(numeric > 10_000_000_000 ? numeric / 1_000 : numeric);
  }
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? Math.trunc(parsed / 1_000) : null;
}

function sameAddress(chain, left, right) {
  const a = String(left || "").trim();
  const b = String(right || "").trim();
  if (!a || !b) return false;
  return String(chain || "").toLowerCase() === "solana" ? a === b : a.toLowerCase() === b.toLowerCase();
}

function sameNumber(left, right, tolerance = 1e-12) {
  const a = finite(left);
  const b = finite(right);
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= Math.max(tolerance, Math.abs(a) * tolerance, Math.abs(b) * tolerance);
}

function sameCandle(left, right) {
  return ["open", "high", "low", "close", "volume"].every((field) => sameNumber(left?.[field], right?.[field]));
}

export function normalizeContinuityCandle(row = {}, { sourceInterval = "" } = {}) {
  const sourceSeconds = CHART_INTERVAL_SECONDS[sourceInterval] || null;
  const time = epochSeconds(row.time ?? row.time_open ?? row.t);
  const explicitClose = epochSeconds(row.time_close ?? row.close_time ?? row.timeClose);
  const open = finite(row.open ?? row.o);
  const high = finite(row.high ?? row.h);
  const low = finite(row.low ?? row.l);
  const close = finite(row.close ?? row.c);
  const volume = finite(row.volume ?? row.v);
  if (
    time === null
    || open === null
    || high === null
    || low === null
    || close === null
    || volume === null
    || open <= 0
    || high <= 0
    || low <= 0
    || close <= 0
    || volume < 0
  ) return null;
  if (high < Math.max(open, close, low) || low > Math.min(open, close, high)) return null;
  return {
    time,
    time_close: explicitClose ?? (sourceSeconds ? time + sourceSeconds : null),
    open,
    high,
    low,
    close,
    volume,
  };
}

export function validateExactCandleIdentity({ expected = {}, actual = {} } = {}) {
  const chain = String(expected.chain || actual.chain || "").toLowerCase();
  const checks = {
    chain: Boolean(chain && chain === String(actual.chain || "").toLowerCase()),
    exact_pool: sameAddress(chain, expected.pool_address, actual.pool_address),
    selected_token: sameAddress(chain, expected.selected_token_address, actual.selected_token_address),
    quote_token: sameAddress(chain, expected.quote_token_address, actual.quote_token_address),
    orientation: Boolean(expected.orientation && expected.orientation === actual.orientation),
    selected_decimals: Number.isInteger(expected.selected_token_decimals)
      && Number.isInteger(actual.selected_token_decimals)
      && expected.selected_token_decimals === actual.selected_token_decimals,
    quote_decimals: Number.isInteger(expected.quote_token_decimals)
      && Number.isInteger(actual.quote_token_decimals)
      && expected.quote_token_decimals === actual.quote_token_decimals,
  };
  const required = ["chain", "exact_pool", "selected_token", "quote_token", "orientation"];
  const decimalsVerified = checks.selected_decimals && checks.quote_decimals;
  return {
    schema_version: RAVENOS_CHART_CONTINUITY_SCHEMA,
    state: required.every((key) => checks[key]) && decimalsVerified ? "verified" : required.every((key) => checks[key]) ? "identity_verified_decimals_unavailable" : "rejected",
    exact_market_preserved: required.every((key) => checks[key]),
    decimals_verified: decimalsVerified,
    checks,
  };
}

export function auditCandleContinuity(rows = [], {
  interval = "1h",
  nowSeconds = Math.trunc(Date.now() / 1_000),
  freshnessLimitSeconds = null,
  volumeSemantics = "provider_reported_additive",
} = {}) {
  const intervalSeconds = CHART_INTERVAL_SECONDS[interval] || null;
  if (!intervalSeconds) throw new Error(`unsupported_continuity_interval:${interval}`);
  const normalized = [];
  let invalidRows = 0;
  let duplicateRows = 0;
  let conflictingDuplicates = 0;
  const byTime = new Map();
  for (const raw of Array.isArray(rows) ? rows : []) {
    const row = normalizeContinuityCandle(raw, { sourceInterval: interval });
    if (!row) {
      invalidRows += 1;
      continue;
    }
    const prior = byTime.get(row.time);
    if (prior) {
      duplicateRows += 1;
      if (!sameCandle(prior, row)) conflictingDuplicates += 1;
      continue;
    }
    byTime.set(row.time, row);
    normalized.push(row);
  }
  normalized.sort((left, right) => left.time - right.time);
  let missingSourceBuckets = 0;
  let timestampMisalignment = 0;
  let closeTimeMismatch = 0;
  let openCloseGapCount = 0;
  let outOfOrderRows = 0;
  let previousRawTime = null;
  for (const raw of Array.isArray(rows) ? rows : []) {
    const time = epochSeconds(raw?.time ?? raw?.time_open ?? raw?.t);
    if (time !== null && previousRawTime !== null && time < previousRawTime) outOfOrderRows += 1;
    if (time !== null) previousRawTime = time;
  }
  normalized.forEach((row, index) => {
    if (row.time % intervalSeconds !== 0) timestampMisalignment += 1;
    if (row.time_close !== null && row.time_close !== row.time + intervalSeconds) closeTimeMismatch += 1;
    if (!index) return;
    const previous = normalized[index - 1];
    const delta = row.time - previous.time;
    if (delta > intervalSeconds) missingSourceBuckets += Math.max(0, Math.round(delta / intervalSeconds) - 1);
    if (!sameNumber(previous.close, row.open, 1e-10)) openCloseGapCount += 1;
  });
  const newest = normalized.at(-1)?.time ?? null;
  const ageSeconds = newest === null ? null : Math.max(0, nowSeconds - newest);
  const freshnessPolicy = Number.isFinite(Number(freshnessLimitSeconds))
    ? Number(freshnessLimitSeconds)
    : Math.max(intervalSeconds * 2, 600);
  const rejected = invalidRows > 0 || conflictingDuplicates > 0 || timestampMisalignment > 0 || closeTimeMismatch > 0;
  return {
    schema_version: RAVENOS_CHART_CONTINUITY_SCHEMA,
    state: rejected ? "rejected" : normalized.length ? "verified" : "unavailable",
    interval,
    interval_seconds: intervalSeconds,
    source_rows: Array.isArray(rows) ? rows.length : 0,
    normalized_rows: normalized.length,
    invalid_rows: invalidRows,
    duplicate_rows: duplicateRows,
    conflicting_duplicates: conflictingDuplicates,
    out_of_order_rows: outOfOrderRows,
    timestamp_misalignment: timestampMisalignment,
    close_time_mismatch: closeTimeMismatch,
    missing_source_buckets: missingSourceBuckets,
    open_close_price_gaps: openCloseGapCount,
    volume_semantics: volumeSemantics,
    newest_candle_time: newest,
    age_seconds: ageSeconds,
    freshness_limit_seconds: freshnessPolicy,
    freshness_state: ageSeconds === null ? "unavailable" : ageSeconds <= freshnessPolicy ? "fresh" : "delayed",
    candles: normalized,
  };
}

export function deriveCompleteCandleInterval(rows = [], {
  sourceInterval,
  targetInterval,
  maxItems = 240,
  windowEndSeconds = Math.trunc(Date.now() / 1_000),
  allowFormingCurrentBucket = true,
  volumeSemantics = "provider_reported_additive",
} = {}) {
  const sourceSeconds = CHART_INTERVAL_SECONDS[sourceInterval] || null;
  const targetSeconds = CHART_INTERVAL_SECONDS[targetInterval] || null;
  const declared = PRIMARY_PROVIDER_DERIVATIONS[targetInterval];
  if (!sourceSeconds || !targetSeconds || !declared || declared.source_interval !== sourceInterval) {
    throw new Error(`unsupported_candle_derivation:${sourceInterval}:${targetInterval}`);
  }
  const ratio = targetSeconds / sourceSeconds;
  if (!Number.isInteger(ratio) || ratio !== declared.expected_source_bars) {
    throw new Error(`invalid_candle_derivation_ratio:${sourceInterval}:${targetInterval}`);
  }
  const sourceAudit = auditCandleContinuity(rows, {
    interval: sourceInterval,
    nowSeconds: windowEndSeconds,
    volumeSemantics,
  });
  if (sourceAudit.state === "rejected") {
    return {
      schema_version: RAVENOS_CHART_CONTINUITY_SCHEMA,
      state: "rejected",
      source_interval: sourceInterval,
      target_interval: targetInterval,
      expected_source_bars: ratio,
      source_audit: { ...sourceAudit, candles: undefined },
      candles: [],
      derived_buckets: 0,
      complete_buckets: 0,
      forming_buckets: 0,
      dropped_incomplete_buckets: 0,
    };
  }
  const groups = new Map();
  for (const candle of sourceAudit.candles) {
    const bucketTime = Math.floor(candle.time / targetSeconds) * targetSeconds;
    if (!groups.has(bucketTime)) groups.set(bucketTime, []);
    groups.get(bucketTime).push(candle);
  }
  const currentBucket = Math.floor(windowEndSeconds / targetSeconds) * targetSeconds;
  const derived = [];
  let completeBuckets = 0;
  let formingBuckets = 0;
  let droppedIncompleteBuckets = 0;
  for (const [bucketTime, group] of [...groups.entries()].sort((left, right) => left[0] - right[0])) {
    group.sort((left, right) => left.time - right.time);
    const expectedTimes = Array.from({ length: ratio }, (_, index) => bucketTime + (index * sourceSeconds));
    const complete = expectedTimes.every((time) => group.some((row) => row.time === time));
    const isCurrent = bucketTime === currentBucket;
    const contiguousCurrent = isCurrent
      && group[0]?.time === bucketTime
      && group.every((row, index) => !index || row.time - group[index - 1].time === sourceSeconds)
      && group.length <= ratio;
    const forming = !complete && allowFormingCurrentBucket && contiguousCurrent;
    if (!complete && !forming) {
      droppedIncompleteBuckets += 1;
      continue;
    }
    const first = group[0];
    const last = group.at(-1);
    derived.push({
      time: bucketTime,
      open: first.open,
      high: Math.max(...group.map((row) => row.high)),
      low: Math.min(...group.map((row) => row.low)),
      close: last.close,
      volume: group.reduce((sum, row) => sum + row.volume, 0),
      forming,
      source_bar_count: group.length,
    });
    if (forming) formingBuckets += 1;
    else completeBuckets += 1;
  }
  const candles = derived.slice(-Math.max(1, Math.trunc(maxItems)));
  return {
    schema_version: RAVENOS_CHART_CONTINUITY_SCHEMA,
    state: candles.length ? "verified" : "unavailable",
    source_interval: sourceInterval,
    target_interval: targetInterval,
    expected_source_bars: ratio,
    volume_semantics: volumeSemantics,
    source_audit: { ...sourceAudit, candles: undefined },
    candles,
    derived_buckets: candles.length,
    complete_buckets: completeBuckets,
    forming_buckets: formingBuckets,
    dropped_incomplete_buckets: droppedIncompleteBuckets,
    missing_buckets_filled: 0,
    interpolation_used: false,
  };
}

export function compareDirectAndDerivedCandles(directRows = [], derivedRows = [], {
  interval,
  priceTolerance = 1e-8,
  volumeRelativeTolerance = 0.001,
} = {}) {
  const direct = new Map(auditCandleContinuity(directRows, { interval }).candles.map((row) => [row.time, row]));
  const derived = new Map(auditCandleContinuity(derivedRows, { interval }).candles.map((row) => [row.time, row]));
  let overlaps = 0;
  let priceMismatches = 0;
  let volumeMismatches = 0;
  for (const [time, directRow] of direct) {
    const derivedRow = derived.get(time);
    if (!derivedRow) continue;
    overlaps += 1;
    if (!["open", "high", "low", "close"].every((field) => sameNumber(directRow[field], derivedRow[field], priceTolerance))) {
      priceMismatches += 1;
    }
    const denominator = Math.max(1e-12, Math.abs(directRow.volume), Math.abs(derivedRow.volume));
    if (Math.abs(directRow.volume - derivedRow.volume) / denominator > volumeRelativeTolerance) volumeMismatches += 1;
  }
  return {
    schema_version: RAVENOS_CHART_CONTINUITY_SCHEMA,
    state: overlaps && priceMismatches === 0 && volumeMismatches === 0 ? "verified" : overlaps ? "rejected" : "unavailable",
    interval,
    overlapping_buckets: overlaps,
    price_mismatches: priceMismatches,
    volume_mismatches: volumeMismatches,
    price_tolerance: priceTolerance,
    volume_relative_tolerance: volumeRelativeTolerance,
  };
}
