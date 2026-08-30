import { normalizeSolanaWalletAddress } from "./solana_wallet_intelligence.mjs";
import { buildWalletResearchThesis } from "./wallet_research_thesis.mjs";

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
  maximum_clauses: 24,
  maximum_set_values: 12,
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
  "profit_factor_desc",
  "average_trade_roi_desc",
  "median_trade_roi_desc",
  "profit_concentration_asc",
  "weekly_consistency_desc",
  "reconstruction_confidence_desc",
  "trade_rate_desc",
  "median_hold_asc",
  "median_hold_desc",
  "average_buy_usdc_desc",
  "maximum_drawdown_usdc_asc",
  "maximum_drawdown_sol_asc",
]);

export const WalletScreenerPerformanceStates = Object.freeze([
  "any",
  "available",
  "partial",
  "insufficient_evidence",
]);

export const WalletScreenerOperators = Object.freeze([
  "gt", "gte", "lt", "lte", "eq", "between", "in", "not_in", "available", "unavailable",
]);

export const WalletScreenerFieldSqlColumns = Object.freeze({
  last_trade_at: "c.last_trade_at",
  trade_count: "c.trade_count",
  active_days: "c.active_days",
  token_count: "c.token_count",
  known_cost_basis_pct: "c.known_cost_basis_pct",
  closed_lots: "c.closed_lots",
  win_rate_pct: "c.win_rate_pct",
  roi_pct: "c.roi_pct",
  realized_pnl_usdc: "c.realized_pnl_usdc",
  realized_pnl_sol: "c.realized_pnl_sol",
  profit_factor: "c.profit_factor",
  average_trade_roi_pct: "c.average_trade_roi_pct",
  median_trade_roi_pct: "c.median_trade_roi_pct",
  top_1_profit_concentration_pct: "c.top_1_profit_concentration_pct",
  top_5_profit_concentration_pct: "c.top_5_profit_concentration_pct",
  profitable_observations: "c.profitable_observations",
  weekly_profitable_pct: "c.weekly_profitable_pct",
  maximum_drawdown_usdc: "c.maximum_drawdown_usdc",
  maximum_drawdown_sol: "c.maximum_drawdown_sol",
  median_hold_seconds: "c.median_hold_seconds",
  trade_rate_per_active_day: "c.trade_rate_per_active_day",
  repeat_token_rate_pct: "c.repeat_token_rate_pct",
  mechanical_pattern_state: "c.mechanical_pattern_state",
  buy_count: "c.buy_count",
  sell_count: "c.sell_count",
  average_buy_usdc: "c.average_buy_usdc",
  median_buy_usdc: "c.median_buy_usdc",
  average_buy_sol: "c.average_buy_sol",
  median_buy_sol: "c.median_buy_sol",
  open_known_cost_positions: "c.open_known_cost_positions",
  reconstruction_confidence_pct: "c.reconstruction_confidence_pct",
  trade_decode_coverage_pct: "c.trade_decode_coverage_pct",
  classification_coverage_pct: "c.classification_coverage_pct",
  provider_history_exhausted: "c.provider_history_exhausted",
  source_history_complete: "c.source_history_complete",
  last_observed_sol_balance: "c.last_observed_sol_balance",
  last_observed_usdc_balance: "c.last_observed_usdc_balance",
  performance_state: "c.performance_state",
});

const NUMERIC_FIELDS = Object.freeze({
  last_trade_at: [0, 8_640_000_000_000],
  trade_count: [0, WalletScreenerLimits.maximum_trade_count],
  active_days: [0, WalletScreenerLimits.maximum_active_days],
  token_count: [0, WalletScreenerLimits.maximum_trade_count],
  known_cost_basis_pct: [0, 100],
  closed_lots: [0, WalletScreenerLimits.maximum_closed_lots],
  win_rate_pct: [0, 100],
  roi_pct: [-100, WalletScreenerLimits.maximum_roi_pct],
  realized_pnl_usdc: [-1e15, 1e15],
  realized_pnl_sol: [-1e15, 1e15],
  profit_factor: [0, 1e9],
  average_trade_roi_pct: [-100, WalletScreenerLimits.maximum_roi_pct],
  median_trade_roi_pct: [-100, WalletScreenerLimits.maximum_roi_pct],
  top_1_profit_concentration_pct: [0, 100],
  top_5_profit_concentration_pct: [0, 100],
  profitable_observations: [0, WalletScreenerLimits.maximum_closed_lots],
  weekly_profitable_pct: [0, 100],
  maximum_drawdown_usdc: [0, 1e15],
  maximum_drawdown_sol: [0, 1e15],
  median_hold_seconds: [0, Number.MAX_SAFE_INTEGER],
  trade_rate_per_active_day: [0, WalletScreenerLimits.maximum_trade_count],
  repeat_token_rate_pct: [0, 100],
  buy_count: [0, WalletScreenerLimits.maximum_trade_count],
  sell_count: [0, WalletScreenerLimits.maximum_trade_count],
  average_buy_usdc: [0, 1e15],
  median_buy_usdc: [0, 1e15],
  average_buy_sol: [0, 1e15],
  median_buy_sol: [0, 1e15],
  open_known_cost_positions: [0, WalletScreenerLimits.maximum_trade_count],
  reconstruction_confidence_pct: [0, 100],
  trade_decode_coverage_pct: [0, 100],
  classification_coverage_pct: [0, 100],
  last_observed_sol_balance: [0, 1e15],
  last_observed_usdc_balance: [0, 1e15],
});

const ENUM_FIELDS = Object.freeze({
  performance_state: ["available", "partial", "insufficient_evidence"],
  mechanical_pattern_state: ["high", "moderate", "low", "insufficient_evidence"],
});

const BOOLEAN_FIELDS = new Set(["provider_history_exhausted", "source_history_complete"]);

export const WalletScreenerPresets = Object.freeze({
  evidence_first: Object.freeze({
    id: "evidence_first",
    label: "Evidence first",
    summary: "High reconstruction and cost-basis coverage with enough closed observations to inspect.",
    clauses: Object.freeze([
      Object.freeze({ field: "reconstruction_confidence_pct", operator: "gte", value: 80 }),
      Object.freeze({ field: "known_cost_basis_pct", operator: "gte", value: 80 }),
      Object.freeze({ field: "closed_lots", operator: "gte", value: 5 }),
    ]),
  }),
  consistent_winners: Object.freeze({
    id: "consistent_winners",
    label: "Consistent winners",
    summary: "Profitable evidence spread beyond one trade, with bounded concentration and drawdown context.",
    clauses: Object.freeze([
      Object.freeze({ field: "closed_lots", operator: "gte", value: 10 }),
      Object.freeze({ field: "profit_factor", operator: "gte", value: 1.25 }),
      Object.freeze({ field: "top_1_profit_concentration_pct", operator: "lte", value: 70 }),
      Object.freeze({ field: "reconstruction_confidence_pct", operator: "gte", value: 75 }),
    ]),
  }),
  broad_edge: Object.freeze({
    id: "broad_edge",
    label: "Broad edge",
    summary: "Multiple profitable observations with less dependence on the largest winner.",
    clauses: Object.freeze([
      Object.freeze({ field: "profitable_observations", operator: "gte", value: 5 }),
      Object.freeze({ field: "top_1_profit_concentration_pct", operator: "lte", value: 50 }),
      Object.freeze({ field: "top_5_profit_concentration_pct", operator: "lte", value: 90 }),
      Object.freeze({ field: "profit_factor", operator: "gte", value: 1.1 }),
    ]),
  }),
  active_swing: Object.freeze({
    id: "active_swing",
    label: "Active swing",
    summary: "Recently active wallets whose median reconstructed hold is between one hour and seven days.",
    active_within_hours: 168,
    clauses: Object.freeze([
      Object.freeze({ field: "median_hold_seconds", operator: "between", value: Object.freeze([3_600, 604_800]) }),
      Object.freeze({ field: "closed_lots", operator: "gte", value: 5 }),
    ]),
  }),
  fast_systematic: Object.freeze({
    id: "fast_systematic",
    label: "Fast patterns",
    summary: "Short holding periods and enough observations to inspect mechanical timing and sizing evidence.",
    clauses: Object.freeze([
      Object.freeze({ field: "median_hold_seconds", operator: "lte", value: 300 }),
      Object.freeze({ field: "trade_count", operator: "gte", value: 20 }),
      Object.freeze({ field: "mechanical_pattern_state", operator: "in", value: Object.freeze(["high", "moderate"]) }),
    ]),
  }),
});

const SORTS = new Set(WalletScreenerSorts);
const PERFORMANCE_STATES = new Set(WalletScreenerPerformanceStates);
const PROJECTED_PERFORMANCE_STATES = new Set(WalletScreenerPerformanceStates.slice(1));
const OPERATORS = new Set(WalletScreenerOperators);
const REQUEST_KEYS = new Set(["filters", "clauses", "preset", "sort", "page", "page_size"]);
const CLAUSE_KEYS = new Set(["field", "operator", "value"]);
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

function normalizeClause(input, index) {
  const clause = exactObject(input, CLAUSE_KEYS, `wallet_screener_clause_${index}`);
  const field = String(clause.field || "").trim().toLowerCase();
  const operator = String(clause.operator || "").trim().toLowerCase();
  if (!Object.hasOwn(WalletScreenerFieldSqlColumns, field)) fail("wallet_screener_clause_field_invalid", { index, field });
  if (!OPERATORS.has(operator)) fail("wallet_screener_clause_operator_invalid", { index, operator });
  if (new Set(["available", "unavailable"]).has(operator)) {
    if (clause.value !== undefined && clause.value !== null) fail("wallet_screener_clause_value_invalid", { index });
    return freeze({ field, operator, value: null });
  }
  const numericLimits = NUMERIC_FIELDS[field];
  const enumValues = ENUM_FIELDS[field];
  const normalizeScalar = (value) => {
    if (numericLimits) return finite(value, `wallet_screener_clause_${field}`, { minimum: numericLimits[0], maximum: numericLimits[1] });
    if (enumValues) {
      const normalized = String(value || "").trim().toLowerCase();
      if (!enumValues.includes(normalized)) fail(`wallet_screener_clause_${field}_invalid`);
      return normalized;
    }
    if (BOOLEAN_FIELDS.has(field)) {
      if (value === true || value === 1 || value === "1") return 1;
      if (value === false || value === 0 || value === "0") return 0;
      fail(`wallet_screener_clause_${field}_invalid`);
    }
    fail("wallet_screener_clause_field_invalid", { index, field });
  };
  if (operator === "between") {
    if (!numericLimits || !Array.isArray(clause.value) || clause.value.length !== 2) fail("wallet_screener_clause_value_invalid", { index });
    const values = clause.value.map(normalizeScalar);
    if (values[0] > values[1]) fail("wallet_screener_clause_range_invalid", { index });
    return freeze({ field, operator, value: values });
  }
  if (new Set(["in", "not_in"]).has(operator)) {
    if (!Array.isArray(clause.value) || !clause.value.length || clause.value.length > WalletScreenerLimits.maximum_set_values) {
      fail("wallet_screener_clause_value_invalid", { index });
    }
    const values = [...new Set(clause.value.map(normalizeScalar))];
    return freeze({ field, operator, value: values });
  }
  if (!new Set(["gt", "gte", "lt", "lte", "eq"]).has(operator)) fail("wallet_screener_clause_operator_invalid", { index, operator });
  return freeze({ field, operator, value: normalizeScalar(clause.value) });
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
    clauses: query.requested_clauses || query.clauses || [],
    preset: query.preset?.id || query.preset || null,
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
  const presetId = request.preset === null || request.preset === undefined || request.preset === ""
    ? null
    : String(request.preset).trim().toLowerCase();
  if (presetId !== null && !Object.hasOwn(WalletScreenerPresets, presetId)) fail("wallet_screener_preset_invalid");
  const preset = presetId === null ? null : WalletScreenerPresets[presetId];
  const requestedClausesInput = request.clauses === undefined ? [] : request.clauses;
  if (!Array.isArray(requestedClausesInput) || requestedClausesInput.length > WalletScreenerLimits.maximum_clauses) fail("wallet_screener_clauses_invalid");
  const requestedClauses = requestedClausesInput.map(normalizeClause);
  const clauses = [...(preset?.clauses || []), ...requestedClauses];
  if (clauses.length > WalletScreenerLimits.maximum_clauses) fail("wallet_screener_clauses_invalid");
  const activeWithinInput = filtersInput.active_within_hours ?? preset?.active_within_hours ?? null;
  const activeWithinHours = integer(activeWithinInput, "active_within_hours", {
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
    preset: preset ? { id: preset.id, label: preset.label, summary: preset.summary } : null,
    requested_clauses: requestedClauses,
    clauses,
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

function whySurfaced({ lastTradeAt, tradeCount, activeDays, knownCostBasisPct, closedLots, reconstructionConfidencePct, topOneConcentrationPct }) {
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
  if (reconstructionConfidencePct !== null) reasons.push({
    code: "reconstruction_confidence",
    label: `${reconstructionConfidencePct}% reconstruction confidence from the available evidence components.`,
    value: reconstructionConfidencePct,
    unit: "percent",
  });
  if (topOneConcentrationPct !== null) reasons.push({
    code: "largest_winner_concentration",
    label: `The largest winner produced ${topOneConcentrationPct}% of gross positive realized P&L.`,
    value: topOneConcentrationPct,
    unit: "percent",
  });
  if (closedLots !== null && closedLots > 0) reasons.push({
    code: "closed_lot_evidence",
    label: `${closedLots} closed ${closedLots === 1 ? "observation" : "observations"} support source-performance calculations.`,
    value: closedLots,
    unit: "observations",
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
  const profitFactor = optionalProjectedNumber(row.profit_factor, { minimum: 0, maximum: 1e9 });
  const averageTradeRoiPct = optionalProjectedNumber(row.average_trade_roi_pct, { minimum: -100, maximum: WalletScreenerLimits.maximum_roi_pct });
  const medianTradeRoiPct = optionalProjectedNumber(row.median_trade_roi_pct, { minimum: -100, maximum: WalletScreenerLimits.maximum_roi_pct });
  const topOneConcentrationPct = optionalProjectedNumber(row.top_1_profit_concentration_pct, { minimum: 0, maximum: 100 });
  const topFiveConcentrationPct = optionalProjectedNumber(row.top_5_profit_concentration_pct, { minimum: 0, maximum: 100 });
  const profitableObservations = optionalProjectedInteger(row.profitable_observations, { minimum: 0, maximum: WalletScreenerLimits.maximum_closed_lots });
  const weeklyProfitablePct = optionalProjectedNumber(row.weekly_profitable_pct, { minimum: 0, maximum: 100 });
  const maximumDrawdownUsdc = optionalProjectedNumber(row.maximum_drawdown_usdc, { minimum: 0 });
  const maximumDrawdownSol = optionalProjectedNumber(row.maximum_drawdown_sol, { minimum: 0 });
  const tradeRate = optionalProjectedNumber(row.trade_rate_per_active_day, { minimum: 0, maximum: WalletScreenerLimits.maximum_trade_count });
  const repeatTokenRatePct = optionalProjectedNumber(row.repeat_token_rate_pct, { minimum: 0, maximum: 100 });
  const mechanicalPatternState = ENUM_FIELDS.mechanical_pattern_state.includes(String(row.mechanical_pattern_state || "").toLowerCase())
    ? String(row.mechanical_pattern_state).toLowerCase()
    : "insufficient_evidence";
  const buyCount = optionalProjectedInteger(row.buy_count, { minimum: 0, maximum: WalletScreenerLimits.maximum_trade_count });
  const sellCount = optionalProjectedInteger(row.sell_count, { minimum: 0, maximum: WalletScreenerLimits.maximum_trade_count });
  const averageBuyUsdc = optionalProjectedNumber(row.average_buy_usdc, { minimum: 0 });
  const medianBuyUsdc = optionalProjectedNumber(row.median_buy_usdc, { minimum: 0 });
  const averageBuySol = optionalProjectedNumber(row.average_buy_sol, { minimum: 0 });
  const medianBuySol = optionalProjectedNumber(row.median_buy_sol, { minimum: 0 });
  const openKnownCostPositions = optionalProjectedInteger(row.open_known_cost_positions, { minimum: 0, maximum: WalletScreenerLimits.maximum_trade_count });
  const reconstructionConfidencePct = optionalProjectedNumber(row.reconstruction_confidence_pct, { minimum: 0, maximum: 100 });
  const tradeDecodeCoveragePct = optionalProjectedNumber(row.trade_decode_coverage_pct, { minimum: 0, maximum: 100 });
  const classificationCoveragePct = optionalProjectedNumber(row.classification_coverage_pct, { minimum: 0, maximum: 100 });
  const providerHistoryExhausted = Number(row.provider_history_exhausted) === 1;
  const sourceHistoryComplete = Number(row.source_history_complete) === 1;
  const lastObservedSolBalance = optionalProjectedNumber(row.last_observed_sol_balance, { minimum: 0 });
  const lastObservedUsdcBalance = optionalProjectedNumber(row.last_observed_usdc_balance, { minimum: 0 });
  const lastObservedSolAt = projectedTimestamp(row.last_observed_sol_at);
  const lastObservedUsdcAt = projectedTimestamp(row.last_observed_usdc_at);
  const firstTradeAt = projectedTimestamp(row.first_trade_at);
  const lastTradeAt = projectedTimestamp(row.last_trade_at);
  const generatedAt = projectedTimestamp(row.generated_at);
  if (performanceState === "available" && (closedLots === null || closedLots < 1 || (realizedPnlUsdc === null && realizedPnlSol === null))) {
    performanceState = "insufficient_evidence";
  }
  const profileSnapshotId = projectedIdentifier(row.profile_snapshot_id, /^swp_[a-f0-9]{40}$/);
  const profileVersion = optionalProjectedInteger(row.profile_version, { minimum: 1, maximum: 1_000_000 });
  const researchThesis = buildWalletResearchThesis({
    performance: {
      realized_pnl_usdc: realizedPnlUsdc,
      realized_pnl_sol: realizedPnlSol,
      closed_observations: closedLots,
      profit_factor: profitFactor,
    },
    behavior: {
      trade_count: tradeCount,
      active_days: activeDays,
      median_hold_seconds: medianHoldSeconds,
    },
    profit_quality: {
      top_1_profit_concentration_pct: topOneConcentrationPct,
      profitable_observations: profitableObservations,
      weekly_profitable_pct: weeklyProfitablePct,
    },
    quality: {
      known_cost_basis_pct: knownCostBasisPct,
      reconstruction_confidence_pct: reconstructionConfidencePct,
      source_history_complete: sourceHistoryComplete,
    },
    follower_reality: { state: "not_sampled" },
    entry_quality_state: "unavailable",
  });
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
      closed_observations: closedLots,
      profit_factor: profitFactor,
      average_trade_roi_pct: averageTradeRoiPct,
      median_trade_roi_pct: medianTradeRoiPct,
      maximum_realized_drawdown: { usdc: maximumDrawdownUsdc, sol: maximumDrawdownSol, combined: null },
    },
    behavior: {
      first_trade_at: firstTradeAt,
      last_trade_at: lastTradeAt,
      trade_count: tradeCount,
      active_days: activeDays,
      token_count: tokenCount,
      median_hold_seconds: medianHoldSeconds,
      trade_rate_per_active_day: tradeRate,
      repeat_token_rate_pct: repeatTokenRatePct,
      mechanical_pattern_evidence: { state: mechanicalPatternState, identity_claimed: false },
      buy_count: buyCount,
      sell_count: sellCount,
      average_buy: { usdc: averageBuyUsdc, sol: averageBuySol, combined: null },
      median_buy: { usdc: medianBuyUsdc, sol: medianBuySol, combined: null },
    },
    profit_quality: {
      state: closedLots > 0 ? "available" : "insufficient_evidence",
      concentration_basis: "share_of_gross_positive_realized_pnl",
      top_1_profit_concentration_pct: topOneConcentrationPct,
      top_5_profit_concentration_pct: topFiveConcentrationPct,
      profitable_observations: profitableObservations,
      weekly_profitable_pct: weeklyProfitablePct,
      settlement_bases_combined: false,
    },
    research_thesis: researchThesis,
    coverage: {
      known_cost_basis_pct: knownCostBasisPct,
      source_history_complete: sourceHistoryComplete,
      provider_history_exhausted: providerHistoryExhausted,
      reconstruction_confidence_pct: reconstructionConfidencePct,
      trade_decode_coverage_pct: tradeDecodeCoveragePct,
      classification_coverage_pct: classificationCoveragePct,
      full_data_confidence_pct: null,
      chain_wide_coverage_claimed: false,
    },
    capital_observations: {
      current_balance_claimed: false,
      sol: { amount: lastObservedSolBalance, observed_at: lastObservedSolAt, state: lastObservedSolBalance === null ? "unavailable" : "last_observed_in_transaction" },
      canonical_usdc: { amount: lastObservedUsdcBalance, observed_at: lastObservedUsdcAt, state: lastObservedUsdcBalance === null ? "unavailable" : "last_observed_in_transaction" },
      open_known_cost_positions: openKnownCostPositions,
    },
    why_surfaced: whySurfaced({ lastTradeAt, tradeCount, activeDays, knownCostBasisPct, closedLots, reconstructionConfidencePct, topOneConcentrationPct }),
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
    presets: Object.values(WalletScreenerPresets).map((preset) => ({
      id: preset.id,
      label: preset.label,
      summary: preset.summary,
      active_within_hours: preset.active_within_hours || null,
      clauses: preset.clauses,
    })),
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
