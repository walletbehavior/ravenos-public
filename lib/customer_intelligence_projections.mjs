const PROJECTION_SCHEMA = "ravenos.customer_intelligence_projection.v1";
const MAX_PRO_PERP_ROWS = 40;
const MAX_PRO_PARTICIPANT_ROWS = 160;
const MAX_PUBLIC_COUNT = 1_000_000_000;

function cleanText(value, max = 240) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  if (typeof value === "number" && !Number.isFinite(value)) return "";
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function finiteNumber(value) {
  if (typeof value !== "number" && (typeof value !== "string" || !/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonNegativeNumber(value) {
  const number = finiteNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function unitRate(value) {
  const number = finiteNumber(value);
  return number !== null && number >= 0 && number <= 1 ? number : null;
}

function boundedInteger(value, fallback = null) {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value.trim()))) return fallback;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= MAX_PUBLIC_COUNT ? number : fallback;
}

function timestamp(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function array(value, max) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function publicData(payload) {
  if (!payload || typeof payload !== "object" || payload.safe_public !== true) return null;
  const data = payload.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const dataSafe = data.safe_public === true
    || data.public_safe === true
    || data.metadata?.public_safe === true;
  return dataSafe ? data : null;
}

function freshness(payload, delivery = {}) {
  const state = cleanText(delivery.freshness_state || "unavailable", 24).toLowerCase();
  return Object.freeze({
    state: ["fresh", "delayed", "stale", "unavailable"].includes(state) ? state : "unavailable",
    generated_at: timestamp(payload?.generated_at || payload?.data?.generated_at),
    source_generated_at: timestamp(delivery.source_generated_at),
    age_seconds: finiteNumber(delivery.age_seconds),
  });
}

function provenance(kind, payload, delivery) {
  return Object.freeze({
    source_category: "current_public_safe_projection",
    intelligence_kind: kind,
    venue: kind === "perps" ? "Hyperliquid" : null,
    freshness: freshness(payload, delivery),
    raw_provider_payload_included: false,
    participant_identity_included: false,
    execution_data_included: false,
  });
}

function stringCountEntries(value, max = 24) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value)
    .slice(0, max)
    .map(([label, count]) => Object.freeze({ label: cleanText(label, 80), count: boundedInteger(count) }))
    .filter((row) => row.label && row.count !== null);
}

function perpInstrumentId(symbol) {
  const normalized = cleanText(symbol, 40).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,28}-PERP$/.test(normalized)) return null;
  return `hyperliquid:perp:${normalized.slice(0, -5)}`;
}

function perpsMarketRow(row) {
  if (!row || typeof row !== "object") return null;
  const symbol = cleanText(row.symbol, 40).toUpperCase();
  const instrumentId = perpInstrumentId(symbol);
  if (!instrumentId) return null;
  return Object.freeze({
    instrument_id: instrumentId,
    symbol,
    venue: "Hyperliquid",
    instrument_group: cleanText(row.instrument_group, 60) || "Unclassified",
    funding_rate: finiteNumber(row.funding_rate),
    funding_regime: cleanText(row.funding_regime, 80) || "Unavailable",
    open_interest_usd: nonNegativeNumber(row.open_interest_usd),
    day_volume_usd: nonNegativeNumber(row.day_volume_usd),
    mark_price: nonNegativeNumber(row.mark_price),
    spread_bps: nonNegativeNumber(row.spread_bps),
    depth_20_usd: nonNegativeNumber(row.depth_20_usd),
    liquidity_quality: cleanText(row.liquidity_quality, 40) || "unavailable",
    pressure_state: cleanText(row.pressure_state, 80) || "Unavailable",
    pressure_direction: cleanText(row.pressure_direction, 100) || "Unavailable",
    coverage: cleanText(row.coverage, 30) || "unavailable",
  });
}

function perpsRows(rows, max) {
  return array(rows, max).map(perpsMarketRow).filter(Boolean);
}

function exactSelectedMarket(rows, instrumentId) {
  const exact = cleanText(instrumentId, 100);
  if (!/^hyperliquid:perp:[A-Z0-9][A-Z0-9._-]{0,28}$/.test(exact)) {
    return Object.freeze({ state: "not_selected", instrument_id: null, market: null });
  }
  const market = rows.find((row) => row.instrument_id === exact) || null;
  return Object.freeze({
    state: market ? "available" : "unavailable",
    instrument_id: exact,
    market,
  });
}

function outcomeRow(row) {
  if (!row || typeof row !== "object") return null;
  const group = cleanText(row.group, 100);
  const label = cleanText(row.label, 100);
  if (!group || !label) return null;
  return Object.freeze({
    group,
    label,
    confidence: cleanText(row.confidence, 40) || "unavailable",
    read: cleanText(row.read, 180) || "Unavailable",
    sample_size: boundedInteger(row.sample_size),
    rewarding: boundedInteger(row.rewarding),
    mixed: boundedInteger(row.mixed),
    punishing: boundedInteger(row.punishing),
    median_observed_change_pct: finiteNumber(row.median_observed_change_pct),
    median_max_favorable_movement_pct: finiteNumber(row.median_max_favorable_movement_pct),
    median_max_adverse_movement_pct: finiteNumber(row.median_max_adverse_movement_pct),
    sample_caveat: cleanText(row.sample_caveat, 160) || "Sample maturity unavailable",
  });
}

function outcomeGroupRows(value) {
  return array(value, 30).map(outcomeRow).filter(Boolean);
}

function perpsOutcomeDetail(data) {
  const forward = data.forward_observation && typeof data.forward_observation === "object" ? data.forward_observation : {};
  const attribution = data.outcome_attribution && typeof data.outcome_attribution === "object" ? data.outcome_attribution : {};
  const grouped = attribution.grouped && typeof attribution.grouped === "object" ? attribution.grouped : {};
  return Object.freeze({
    forward_observation: Object.freeze({
      observations: boundedInteger(forward.observations),
      matured_windows: Object.freeze({
        "15m": boundedInteger(forward.matured_windows?.["15m"]),
        "1h": boundedInteger(forward.matured_windows?.["1h"]),
        "4h": boundedInteger(forward.matured_windows?.["4h"]),
        "12h": boundedInteger(forward.matured_windows?.["12h"]),
      }),
      sample_caveat: cleanText(forward.sample_caveat, 300) || "Forward observation maturity is unavailable.",
    }),
    attribution: Object.freeze({
      sample_size: boundedInteger(attribution.sample_size),
      classification: cleanText(attribution.classification, 240) || "Unavailable",
      public_caveat: cleanText(attribution.public_caveat, 320) || "Aggregate validation context only.",
      window_policy: cleanText(attribution.window_policy, 180) || "Unavailable",
      groups: Object.freeze({
        funding_regime: Object.freeze(outcomeGroupRows(grouped.funding_regime)),
        instrument_group: Object.freeze(outcomeGroupRows(grouped.instrument_group)),
        liquidity_attraction: Object.freeze(outcomeGroupRows(grouped.liquidity_attraction)),
        pressure_bucket: Object.freeze(outcomeGroupRows(grouped.pressure_bucket)),
        structure: Object.freeze(outcomeGroupRows(grouped.structure)),
      }),
    }),
  });
}

function uniqueValues(rows, key, max = 40) {
  return [...new Set(rows.map((row) => cleanText(row?.[key], 80)).filter(Boolean))].sort().slice(0, max);
}

function perpsBase(payload, {
  delivery = {},
  selected_instrument_id: selectedInstrumentId = null,
  selected_market: selectedMarketInput = null,
} = {}) {
  const data = publicData(payload);
  if (!data || !data.tables || typeof data.tables !== "object" || Array.isArray(data.tables) || !Array.isArray(data.tables.top_volume)) {
    throw new Error("perps_public_projection_invalid");
  }
  const topVolume = perpsRows(data.tables.top_volume, MAX_PRO_PERP_ROWS);
  const selectedCandidate = perpsMarketRow(selectedMarketInput);
  const selectedRows = selectedCandidate ? [selectedCandidate, ...topVolume] : topVolume;
  const summary = data.summary && typeof data.summary === "object" ? data.summary : {};
  return {
    data,
    topVolume,
    base: {
      ok: true,
      schema_version: PROJECTION_SCHEMA,
      intelligence_kind: "perps",
      generated_at: timestamp(payload.generated_at || data.generated_at),
      provenance: provenance("perps", payload, delivery),
      overview: Object.freeze({
        state: cleanText(data.coverage, 30) || "unavailable",
        markets_observed: boundedInteger(summary.markets_observed),
        books_observed: boundedInteger(summary.books_observed),
        public_read: cleanText(data.public_read, 360) || "Current perps context is unavailable.",
        pressure_buckets: Object.freeze(stringCountEntries(summary.pressure_buckets)),
        liquidity_buckets: Object.freeze(stringCountEntries(summary.liquidity_buckets)),
      }),
      selected_market: exactSelectedMarket(selectedRows, selectedInstrumentId),
      market_overview: Object.freeze(topVolume.slice(0, 6)),
      limitations: Object.freeze({
        liquidation_data: "unavailable_no_qualified_stream",
        actor_leaderboards: "withheld_pending_separate_qualification",
        wallet_identity: "not_included",
        execution: "not_included",
      }),
    },
  };
}

export function buildPerpsFreeProjection(payload, options = {}) {
  const { base } = perpsBase(payload, options);
  return Object.freeze({ ...base, access_scope: "free", advanced: null });
}

export function buildPerpsProProjection(payload, options = {}) {
  const { data, topVolume, base } = perpsBase(payload, options);
  const positioning = topVolume;
  const pressure = perpsRows(data.tables.top_pressure, MAX_PRO_PERP_ROWS);
  const tightest = perpsRows(data.tables.tightest_books, MAX_PRO_PERP_ROWS);
  const wideOrThin = perpsRows(data.tables.wide_or_thin_books, MAX_PRO_PERP_ROWS);
  const filterRows = [...positioning, ...pressure, ...tightest, ...wideOrThin];
  return Object.freeze({
    ...base,
    access_scope: "pro",
    advanced: Object.freeze({
      positioning: Object.freeze(positioning),
      pressure_and_crowding: Object.freeze(pressure),
      liquidity: Object.freeze({
        tightest_books: Object.freeze(tightest),
        wide_or_thin_books: Object.freeze(wideOrThin),
      }),
      outcomes: perpsOutcomeDetail(data),
      filters: Object.freeze({
        instrument_groups: Object.freeze(uniqueValues(filterRows, "instrument_group")),
        funding_regimes: Object.freeze(uniqueValues(filterRows, "funding_regime")),
        pressure_states: Object.freeze(uniqueValues(filterRows, "pressure_state")),
        liquidity_qualities: Object.freeze(uniqueValues(filterRows, "liquidity_quality")),
      }),
    }),
  });
}

function participantBasicRow(row) {
  if (!row || typeof row !== "object") return null;
  const chain = cleanText(row.chain, 40);
  const capBand = cleanText(row.cap_band, 80);
  const window = cleanText(row.window || row.timeframe, 40);
  if (!chain || !capBand || !window) return null;
  const observed = boundedInteger(row.observed_sample ?? row.sample_summary?.observed);
  const usable = boundedInteger(row.usable_sample ?? row.sample_summary?.usable);
  if (observed !== null && usable !== null && usable > observed) return null;
  return Object.freeze({
    chain,
    capitalization_band: capBand,
    window,
    participation_trend: cleanText(row.trend, 60) || "unavailable",
    observed_sample: observed,
    usable_sample: usable,
    interpretation: cleanText(row.plain_language_summary, 320) || "Interpretation unavailable.",
  });
}

function participantAdvancedRow(row) {
  const basic = participantBasicRow(row);
  if (!basic) return null;
  const observed = boundedInteger(row.observed_sample ?? row.sample_summary?.observed);
  const usable = boundedInteger(row.usable_sample ?? row.sample_summary?.usable);
  const expectedExcluded = observed !== null && usable !== null ? observed - usable : null;
  const suppliedExcluded = boundedInteger(row.sample_gap ?? row.sample_summary?.excluded_or_unusable);
  if (suppliedExcluded !== null && expectedExcluded !== null && suppliedExcluded !== expectedExcluded) return null;
  const excluded = suppliedExcluded ?? expectedExcluded;
  return Object.freeze({
    ...basic,
    participant_success_rate: unitRate(row.participant_success_rate),
    win_rate_band: cleanText(row.win_rate_band, 40) || "unavailable",
    confidence: cleanText(row.confidence, 40) || "unavailable",
    score_strength: cleanText(row.score_strength, 40) || "unavailable",
    outcome_strength: cleanText(row.outcome_strength, 60) || "unavailable",
    average_outcome_classification: cleanText(row.avg_outcome, 60) || "unavailable",
    outcome_context: cleanText(row.participant_outcome_context, 280) || "Outcome context unavailable.",
    sample_integrity: Object.freeze({ observed, usable, excluded_or_unusable: excluded }),
  });
}

function participantBase(payload, { delivery = {} } = {}) {
  const data = publicData(payload);
  if (!data || !Array.isArray(data.rows)) throw new Error("participant_public_projection_invalid");
  const rows = array(data.rows, MAX_PRO_PARTICIPANT_ROWS).map(participantBasicRow).filter(Boolean);
  return {
    data,
    rows,
    base: {
      ok: true,
      schema_version: PROJECTION_SCHEMA,
      intelligence_kind: "participants",
      generated_at: timestamp(payload.generated_at || data.generated_at),
      provenance: provenance("participants", payload, delivery),
      headline: Object.freeze({
        state: cleanText(data.participation_quality, 40) || "unavailable",
        aggregate_read: cleanText(data.public_read_label, 240) || "Aggregate participant context is unavailable.",
        aggregate_evidence_state: cleanText(data.actor_evidence_state, 80) || "unavailable",
        aggregate_evidence_freshness: cleanText(data.actor_evidence_freshness, 40) || "unavailable",
        conditions_observed: boundedInteger(data.count, rows.length),
      }),
      participation_overview: Object.freeze(rows.slice(0, 6)),
      limitations: Object.freeze({
        aggregation: "aggregate_conditions_only",
        wallet_identity: "not_included",
        wallet_labels: "not_included",
        relationship_graphs: "not_included",
        smart_money_ranking: "not_included",
        profitability: "not_established_by_participation_statistics",
      }),
    },
  };
}

export function buildParticipantFreeProjection(payload, options = {}) {
  const { base } = participantBase(payload, options);
  return Object.freeze({ ...base, access_scope: "free", advanced: null });
}

export function buildParticipantProProjection(payload, options = {}) {
  const { data, base } = participantBase(payload, options);
  const matrix = array(data.rows, MAX_PRO_PARTICIPANT_ROWS).map(participantAdvancedRow).filter(Boolean);
  const completeSampleIntegrity = matrix.every((row) => row.sample_integrity.observed !== null
    && row.sample_integrity.usable !== null
    && row.sample_integrity.excluded_or_unusable !== null);
  return Object.freeze({
    ...base,
    access_scope: "pro",
    advanced: Object.freeze({
      condition_matrix: Object.freeze(matrix),
      filters: Object.freeze({
        chains: Object.freeze(uniqueValues(matrix, "chain")),
        capitalization_bands: Object.freeze(uniqueValues(matrix, "capitalization_band")),
        windows: Object.freeze(uniqueValues(matrix, "window")),
      }),
      sample_integrity: Object.freeze({
        state: completeSampleIntegrity ? "complete" : "partial",
        observed: completeSampleIntegrity ? matrix.reduce((sum, row) => sum + row.sample_integrity.observed, 0) : null,
        usable: completeSampleIntegrity ? matrix.reduce((sum, row) => sum + row.sample_integrity.usable, 0) : null,
        excluded_or_unusable: completeSampleIntegrity ? matrix.reduce((sum, row) => sum + row.sample_integrity.excluded_or_unusable, 0) : null,
      }),
    }),
  });
}

export const CustomerIntelligenceProjectionContract = Object.freeze({
  schema_version: PROJECTION_SCHEMA,
  free_limits: Object.freeze({ perps_markets: 6, participant_conditions: 6 }),
  pro_limits: Object.freeze({ perps_table_rows: MAX_PRO_PERP_ROWS, participant_conditions: MAX_PRO_PARTICIPANT_ROWS }),
  actor_leaderboards_included: false,
  liquidation_data_included: false,
  wallet_identity_included: false,
  execution_data_included: false,
  atlas_projection_splitting_included: false,
});
