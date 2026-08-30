import { normalizeSolanaWalletAddress } from "./solana_wallet_intelligence.mjs";

export const WALLET_SCREENER_SCHEMA = "ravenos.wallet_screener.v1";

export const WalletScreenerLimits = Object.freeze({
  default_page_size: 20,
  maximum_page_size: 30,
  maximum_page: 25,
  maximum_active_within_hours: 24 * 365,
  maximum_trade_count: 1_000_000,
  maximum_active_days: 36_500,
  maximum_closed_lots: 1_000_000,
  maximum_roi_pct: 1_000_000_000,
  maximum_total_rows: 10_000_000,
});

export const WalletScreenerSorts = Object.freeze([
  "last_trade_desc",
  "trade_count_desc",
  "active_days_desc",
  "known_cost_basis_desc",
  "closed_lots_desc",
  "win_rate_desc",
  "roi_desc",
  "realized_pnl_usdc_desc",
  "realized_pnl_sol_desc",
]);

export const WalletScreenerPerformanceStates = Object.freeze([
  "any",
  "available",
  "partial",
  "insufficient_evidence",
]);

const SORTS = new Set(WalletScreenerSorts);
const PERFORMANCE_STATES = new Set(WalletScreenerPerformanceStates);
const PROJECTED_PERFORMANCE_STATES = new Set(WalletScreenerPerformanceStates.slice(1));
const REQUEST_KEYS = new Set(["filters", "sort", "page", "page_size"]);
const FILTER_KEYS = new Set([
  "active_within_hours",
  "min_trade_count",
  "min_active_days",
  "min_known_cost_basis_pct",
  "min_closed_lots",
  "min_win_rate_pct",
  "min_roi_pct",
  "performance_state",
]);

function fail(code, details = null) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  throw error;
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function exactObject(value, allowed, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${field}_invalid`);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) fail(`${field}_invalid`, { unknown_fields: unknown.sort() });
  return value;
}

function finite(value, field, { minimum, maximum, optional = false } = {}) {
  if (optional && (value === null || value === undefined)) return null;
  if (typeof value !== "number" && (typeof value !== "string" || !/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))) {
    fail(`${field}_invalid`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) fail(`${field}_invalid`);
  return parsed;
}

function integer(value, field, limits = {}) {
  const parsed = finite(value, field, limits);
  if (parsed !== null && !Number.isSafeInteger(parsed)) fail(`${field}_invalid`);
  return parsed;
}

function optionalProjectedNumber(value, { minimum = -Number.MAX_VALUE, maximum = Number.MAX_VALUE } = {}) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" && (typeof value !== "string" || !/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function optionalProjectedInteger(value, limits = {}) {
  const parsed = optionalProjectedNumber(value, limits);
  return parsed !== null && Number.isSafeInteger(parsed) ? parsed : null;
}

function normalizeNow(value) {
  const supplied = value === undefined ? Date.now() : value;
  let milliseconds;
  if (supplied instanceof Date) milliseconds = supplied.getTime();
  else if (typeof supplied === "number" && Number.isFinite(supplied)) milliseconds = supplied < 100_000_000_000 ? supplied * 1_000 : supplied;
  else if (typeof supplied === "string" && /^\d+(?:\.\d+)?$/.test(supplied.trim())) {
    const numeric = Number(supplied);
    milliseconds = numeric < 100_000_000_000 ? numeric * 1_000 : numeric;
  } else milliseconds = Date.parse(String(supplied || ""));
  if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 8_640_000_000_000_000) fail("wallet_screener_now_invalid");
  return {
    epoch_seconds: Math.floor(milliseconds / 1_000),
    iso: new Date(milliseconds).toISOString(),
  };
}

function projectedTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  let milliseconds;
  if (typeof value === "number" && Number.isFinite(value)) milliseconds = value < 100_000_000_000 ? value * 1_000 : value;
  else if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const numeric = Number(value);
    milliseconds = numeric < 100_000_000_000 ? numeric * 1_000 : numeric;
  } else milliseconds = Date.parse(String(value));
  if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 8_640_000_000_000_000) return null;
  return new Date(milliseconds).toISOString();
}

function projectedIdentifier(value, pattern) {
  const text = typeof value === "string" ? value.trim() : "";
  return pattern.test(text) ? text : null;
}

function normalizedRequestFromProjection(query, now) {
  if (!query || query.schema_version !== WALLET_SCREENER_SCHEMA || !query.filters) return normalizeWalletScreenerRequest(query, { now });
  return normalizeWalletScreenerRequest({
    filters: Object.fromEntries([...FILTER_KEYS].map((key) => [key, query.filters[key]])),
    sort: query.sort,
    page: query.page,
    page_size: query.page_size,
  }, { now: query.evaluated_at || now });
}

export function normalizeWalletScreenerRequest(input = {}, { now } = {}) {
  const request = exactObject(input, REQUEST_KEYS, "wallet_screener_request");
  const filtersInput = request.filters === undefined
    ? {}
    : exactObject(request.filters, FILTER_KEYS, "wallet_screener_filters");
  const evaluated = normalizeNow(now);
  const activeWithinHours = integer(filtersInput.active_within_hours, "active_within_hours", {
    minimum: 1,
    maximum: WalletScreenerLimits.maximum_active_within_hours,
    optional: true,
  });
  const performanceState = String(filtersInput.performance_state ?? "any").trim().toLowerCase();
  if (!PERFORMANCE_STATES.has(performanceState)) fail("performance_state_invalid");
  const sort = String(request.sort ?? "last_trade_desc").trim().toLowerCase();
  if (!SORTS.has(sort)) fail("wallet_screener_sort_invalid");
  const page = integer(request.page ?? 1, "wallet_screener_page", { minimum: 1, maximum: WalletScreenerLimits.maximum_page });
  const pageSize = integer(request.page_size ?? WalletScreenerLimits.default_page_size, "wallet_screener_page_size", {
    minimum: 1,
    maximum: WalletScreenerLimits.maximum_page_size,
  });
  return freeze({
    schema_version: WALLET_SCREENER_SCHEMA,
    scope: "raven_indexed_solana_wallets",
    chain: "solana",
    network: "mainnet",
    evaluated_at: evaluated.iso,
    filters: {
      active_within_hours: activeWithinHours,
      active_since_at: activeWithinHours === null ? null : evaluated.epoch_seconds - (activeWithinHours * 60 * 60),
      min_trade_count: integer(filtersInput.min_trade_count, "min_trade_count", {
        minimum: 0,
        maximum: WalletScreenerLimits.maximum_trade_count,
        optional: true,
      }),
      min_active_days: integer(filtersInput.min_active_days, "min_active_days", {
        minimum: 0,
        maximum: WalletScreenerLimits.maximum_active_days,
        optional: true,
      }),
      min_known_cost_basis_pct: finite(filtersInput.min_known_cost_basis_pct, "min_known_cost_basis_pct", { minimum: 0, maximum: 100, optional: true }),
      min_closed_lots: integer(filtersInput.min_closed_lots, "min_closed_lots", {
        minimum: 0,
        maximum: WalletScreenerLimits.maximum_closed_lots,
        optional: true,
      }),
      min_win_rate_pct: finite(filtersInput.min_win_rate_pct, "min_win_rate_pct", { minimum: 0, maximum: 100, optional: true }),
      min_roi_pct: finite(filtersInput.min_roi_pct, "min_roi_pct", {
        minimum: -100,
        maximum: WalletScreenerLimits.maximum_roi_pct,
        optional: true,
      }),
      performance_state: performanceState,
    },
    sort,
    page,
    page_size: pageSize,
    offset: (page - 1) * pageSize,
  });
}

function whySurfaced({ lastTradeAt, tradeCount, activeDays, knownCostBasisPct, closedLots }) {
  const reasons = [];
  if (lastTradeAt) reasons.push({
    code: "last_trade_observed",
    label: `Last normalized trade observed ${lastTradeAt}.`,
    value: lastTradeAt,
    unit: "timestamp",
  });
  if (tradeCount !== null && tradeCount > 0) reasons.push({
    code: "normalized_trade_history",
    label: `${tradeCount} normalized ${tradeCount === 1 ? "trade" : "trades"} observed.`,
    value: tradeCount,
    unit: "trades",
  });
  if (knownCostBasisPct !== null) reasons.push({
    code: "known_cost_basis_coverage",
    label: `${knownCostBasisPct}% of observed trade cost basis is known.`,
    value: knownCostBasisPct,
    unit: "percent",
  });
  if (closedLots !== null && closedLots > 0) reasons.push({
    code: "closed_lot_evidence",
    label: `${closedLots} closed ${closedLots === 1 ? "lot" : "lots"} support source-performance calculations.`,
    value: closedLots,
    unit: "lots",
  });
  if (activeDays !== null && activeDays > 0) reasons.push({
    code: "observed_active_days",
    label: `Trading activity was observed on ${activeDays} ${activeDays === 1 ? "day" : "days"}.`,
    value: activeDays,
    unit: "days",
  });
  if (!reasons.length) reasons.push({
    code: "raven_indexed_exact_wallet",
    label: "An exact Solana wallet record exists in Raven's bounded index.",
    value: null,
    unit: null,
  });
  return Object.freeze(reasons.slice(0, 4).map((reason) => freeze(reason)));
}

export function projectWalletScreenerRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const sourceWalletId = projectedIdentifier(row.source_wallet_id, /^sw_sol_[a-f0-9]{40}$/);
  if (!sourceWalletId) return null;
  let address;
  try {
    address = normalizeSolanaWalletAddress(row.address);
  } catch {
    return null;
  }
  const performanceStateInput = String(row.performance_state || "insufficient_evidence").trim().toLowerCase();
  let performanceState = PROJECTED_PERFORMANCE_STATES.has(performanceStateInput)
    ? performanceStateInput
    : "insufficient_evidence";
  const tradeCount = optionalProjectedInteger(row.trade_count, { minimum: 0, maximum: WalletScreenerLimits.maximum_trade_count });
  const activeDays = optionalProjectedInteger(row.active_days, { minimum: 0, maximum: WalletScreenerLimits.maximum_active_days });
  const tokenCount = optionalProjectedInteger(row.token_count, { minimum: 0, maximum: WalletScreenerLimits.maximum_trade_count });
  const knownCostBasisPct = optionalProjectedNumber(row.known_cost_basis_pct, { minimum: 0, maximum: 100 });
  const closedLots = optionalProjectedInteger(row.closed_lots, { minimum: 0, maximum: WalletScreenerLimits.maximum_closed_lots });
  const winRatePct = optionalProjectedNumber(row.win_rate_pct, { minimum: 0, maximum: 100 });
  const roiPct = optionalProjectedNumber(row.roi_pct, { minimum: -100, maximum: WalletScreenerLimits.maximum_roi_pct });
  const realizedPnlUsdc = optionalProjectedNumber(row.realized_pnl_usdc);
  const realizedPnlSol = optionalProjectedNumber(row.realized_pnl_sol);
  const medianHoldSeconds = optionalProjectedNumber(row.median_hold_seconds, { minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
  const firstTradeAt = projectedTimestamp(row.first_trade_at);
  const lastTradeAt = projectedTimestamp(row.last_trade_at);
  const generatedAt = projectedTimestamp(row.generated_at);
  if (performanceState === "available" && (closedLots === null || closedLots < 1 || (realizedPnlUsdc === null && realizedPnlSol === null))) {
    performanceState = "insufficient_evidence";
  }
  const profileSnapshotId = projectedIdentifier(row.profile_snapshot_id, /^swp_[a-f0-9]{40}$/);
  const profileVersion = optionalProjectedInteger(row.profile_version, { minimum: 1, maximum: 1_000_000 });
  return freeze({
    schema_version: WALLET_SCREENER_SCHEMA,
    source_wallet_id: sourceWalletId,
    source_wallet: {
      chain: "solana",
      network: "mainnet",
      address,
    },
    profile: {
      snapshot_id: profileSnapshotId,
      version: profileVersion,
      generated_at: generatedAt,
    },
    source_performance: {
      state: performanceState,
      realized_pnl: {
        usdc: realizedPnlUsdc,
        sol: realizedPnlSol,
        combined: null,
        bases_combined: false,
      },
      roi_pct: roiPct,
      win_rate_pct: winRatePct,
      closed_lots: closedLots,
    },
    behavior: {
      first_trade_at: firstTradeAt,
      last_trade_at: lastTradeAt,
      trade_count: tradeCount,
      active_days: activeDays,
      token_count: tokenCount,
      median_hold_seconds: medianHoldSeconds,
    },
    coverage: {
      known_cost_basis_pct: knownCostBasisPct,
      source_history_complete: false,
      chain_wide_coverage_claimed: false,
    },
    why_surfaced: whySurfaced({ lastTradeAt, tradeCount, activeDays, knownCostBasisPct, closedLots }),
    follower_reality: {
      state: "not_sampled",
      prospective_sample_size: null,
      executable_copy_rate_pct: null,
      policy_pass_rate_pct: null,
      median_entry_degradation_pct: null,
      median_exit_degradation_pct: null,
      follower_capture_ratio_pct: null,
      order_size_observations: [],
      source_performance_used_as_follower_performance: false,
    },
    scope: {
      universe: "raven_indexed_solana_wallets",
      comprehensive_chain_index: false,
      exact_wallet_identity: true,
    },
  });
}

export function buildWalletScreenerResponse({ query, rows, total, now } = {}) {
  const normalized = normalizedRequestFromProjection(query || {}, now);
  if (!Array.isArray(rows)) fail("wallet_screener_rows_invalid");
  const totalRows = integer(total, "wallet_screener_total", { minimum: 0, maximum: WalletScreenerLimits.maximum_total_rows });
  const boundedRows = rows.slice(0, normalized.page_size);
  const projectedRows = boundedRows.map(projectWalletScreenerRow).filter(Boolean);
  const excludedRows = boundedRows.length - projectedRows.length;
  const uncappedPages = totalRows === 0 ? 0 : Math.ceil(totalRows / normalized.page_size);
  const accessiblePages = Math.min(uncappedPages, WalletScreenerLimits.maximum_page);
  const state = boundedRows.length > 0 && projectedRows.length === 0
    ? "unavailable"
    : projectedRows.length > 0
      ? "available"
      : "empty";
  return freeze({
    ok: state !== "unavailable",
    schema_version: WALLET_SCREENER_SCHEMA,
    state,
    generated_at: normalizeNow(now ?? normalized.evaluated_at).iso,
    scope: {
      universe: "raven_indexed_solana_wallets",
      chain: "solana",
      network: "mainnet",
      comprehensive_chain_index: false,
      claim: "bounded_raven_index_only",
    },
    query: normalized,
    pagination: {
      page: normalized.page,
      page_size: normalized.page_size,
      total_matching_rows: totalRows,
      total_pages: accessiblePages,
      result_window_limited: uncappedPages > WalletScreenerLimits.maximum_page,
      has_previous: normalized.page > 1,
      has_next: normalized.page < accessiblePages,
    },
    rows: projectedRows,
    projection_exclusions: excludedRows,
    limitations: [
      "This is Raven's bounded indexed Solana wallet universe, not every wallet on Solana.",
      "Source-wallet results are not follower results.",
      "Follower reality remains not sampled until prospective copy evidence exists.",
    ],
  });
}
