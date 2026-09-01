import assert from "node:assert/strict";
import test from "node:test";

import { createD1CustomerWalletCopyStore } from "../lib/customer_wallet_copy.mjs";

import {
  WALLET_SCREENER_SCHEMA,
  WalletScreenerLimits,
  WalletScreenerOperators,
  WalletScreenerPerformanceStates,
  WalletScreenerPresets,
  WalletScreenerSorts,
  buildWalletScreenerResponse,
  normalizeWalletScreenerRequest,
  projectWalletScreenerRow,
} from "../lib/customer_trade/wallet_screener.mjs";
import { buildWalletResearchThesis } from "../lib/customer_trade/wallet_research_thesis.mjs";
import { createSourceWalletCopyabilityPolicyReference } from "../lib/customer_trade/source_wallet_copyability.mjs";

const NOW = "2026-08-29T18:00:00.000Z";
const ADDRESS = "11111111111111111111111111111111";
const SOURCE_ID = `sw_sol_${"a".repeat(40)}`;

function row(overrides = {}) {
  return {
    source_wallet_id: SOURCE_ID,
    address: ADDRESS,
    profile_snapshot_id: `swp_${"b".repeat(40)}`,
    profile_version: 4,
    generated_at: Math.floor(Date.parse("2026-08-29T17:59:00.000Z") / 1_000),
    first_trade_at: "2026-08-20T12:00:00.000Z",
    last_trade_at: Math.floor(Date.parse("2026-08-29T17:55:00.000Z") / 1_000),
    trade_count: 128,
    active_days: 7,
    token_count: 34,
    known_cost_basis_pct: 82.5,
    performance_state: "available",
    realized_pnl_usdc: 4812.25,
    realized_pnl_sol: -0.4,
    roi_pct: 38.75,
    win_rate_pct: 61.25,
    closed_lots: 42,
    median_hold_seconds: 1_800,
    profit_factor: 2.4,
    average_trade_roi_pct: 18.5,
    median_trade_roi_pct: 9.2,
    top_1_profit_concentration_pct: 42.5,
    top_5_profit_concentration_pct: 88.4,
    profitable_observations: 28,
    weekly_profitable_pct: 75,
    maximum_drawdown_usdc: 412.5,
    maximum_drawdown_sol: null,
    trade_rate_per_active_day: 18.2857,
    repeat_token_rate_pct: 32.5,
    mechanical_pattern_state: "moderate",
    buy_count: 71,
    sell_count: 57,
    average_buy_usdc: 184.25,
    median_buy_usdc: 92.1,
    average_buy_sol: null,
    median_buy_sol: null,
    open_known_cost_positions: 6,
    reconstruction_confidence_pct: 91.5,
    trade_decode_coverage_pct: 96,
    classification_coverage_pct: 98.5,
    provider_history_exhausted: 1,
    source_history_complete: 0,
    last_observed_sol_balance: 14.25,
    last_observed_sol_at: Math.floor(Date.parse("2026-08-29T17:55:00.000Z") / 1_000),
    last_observed_usdc_balance: 812.5,
    last_observed_usdc_at: Math.floor(Date.parse("2026-08-29T17:55:00.000Z") / 1_000),
    ...overrides,
  };
}

test("wallet screener defaults are bounded, deterministic, and immutable", () => {
  const query = normalizeWalletScreenerRequest({}, { now: NOW });
  assert.equal(query.schema_version, WALLET_SCREENER_SCHEMA);
  assert.equal(query.scope, "raven_indexed_solana_wallets");
  assert.equal(query.chain, "solana");
  assert.equal(query.network, "mainnet");
  assert.equal(query.sort, "last_trade_desc");
  assert.equal(query.page, 1);
  assert.equal(query.page_size, WalletScreenerLimits.default_page_size);
  assert.equal(query.offset, 0);
  assert.equal(query.preset, null);
  assert.deepEqual(query.clauses, []);
  assert.deepEqual(query.filters, {
    active_within_hours: null,
    active_since_at: null,
    min_trade_count: null,
    min_active_days: null,
    min_known_cost_basis_pct: null,
    min_closed_lots: null,
    min_win_rate_pct: null,
    min_roi_pct: null,
    performance_state: "any",
  });
  assert.equal(Object.isFrozen(query), true);
  assert.equal(Object.isFrozen(query.filters), true);
});

test("all supported filters, sort, and pagination normalize for deterministic D1 binding", () => {
  const query = normalizeWalletScreenerRequest({
    filters: {
      active_within_hours: 6,
      min_trade_count: 25,
      min_active_days: 3,
      min_known_cost_basis_pct: 75.5,
      min_closed_lots: 10,
      min_win_rate_pct: 55.25,
      min_roi_pct: -12.5,
      performance_state: "PARTIAL",
    },
    sort: "ROI_DESC",
    page: 4,
    page_size: 30,
  }, { now: NOW });
  assert.equal(query.filters.active_since_at, Math.floor(Date.parse(NOW) / 1_000) - (6 * 60 * 60));
  assert.equal(query.filters.performance_state, "partial");
  assert.equal(query.sort, "roi_desc");
  assert.equal(query.offset, 90);
  assert.equal(query.page_size, 30);
});

test("composable clauses and transparent presets normalize without accepting SQL-shaped input", () => {
  assert.ok(WalletScreenerOperators.includes("unavailable"));
  assert.equal(WalletScreenerPresets.consistent_winners.clauses[1].field, "profit_factor");
  const query = normalizeWalletScreenerRequest({
    preset: "consistent_winners",
    clauses: [
      { field: "median_hold_seconds", operator: "between", value: [300, 86_400] },
      { field: "mechanical_pattern_state", operator: "in", value: ["low", "moderate"] },
      { field: "last_observed_usdc_balance", operator: "available" },
    ],
    sort: "profit_concentration_asc",
  }, { now: NOW });
  assert.equal(query.preset.id, "consistent_winners");
  assert.equal(query.requested_clauses.length, 3);
  assert.equal(query.clauses.length, 7);
  assert.deepEqual(query.clauses.at(-1), { field: "last_observed_usdc_balance", operator: "available", value: null });
  assert.throws(() => normalizeWalletScreenerRequest({ clauses: [{ field: "1; DROP TABLE wallets", operator: "gte", value: 1 }] }, { now: NOW }), /wallet_screener_clause_field_invalid/);
  assert.throws(() => normalizeWalletScreenerRequest({ clauses: [{ field: "profit_factor", operator: "between", value: [2, 1] }] }, { now: NOW }), /wallet_screener_clause_range_invalid/);
  assert.throws(() => normalizeWalletScreenerRequest({ preset: "magic_alpha" }, { now: NOW }), /wallet_screener_preset_invalid/);
});

test("request validation rejects unknown controls, unallowlisted sorts, and unbounded values", () => {
  assert.deepEqual(WalletScreenerPerformanceStates, ["any", "available", "partial", "insufficient_evidence"]);
  assert.ok(WalletScreenerSorts.includes("realized_pnl_usdc_desc"));
  assert.ok(WalletScreenerSorts.includes("copyability_score_desc"));
  assert.ok(WalletScreenerSorts.includes("follower_capture_desc"));
  assert.ok(WalletScreenerSorts.includes("detected_liquidity_desc"));
  assert.throws(() => normalizeWalletScreenerRequest({ claim_all_wallets: true }, { now: NOW }), /wallet_screener_request_invalid/);
  assert.throws(() => normalizeWalletScreenerRequest({ filters: { mystery: 1 } }, { now: NOW }), /wallet_screener_filters_invalid/);
  assert.throws(() => normalizeWalletScreenerRequest({ sort: "address_desc" }, { now: NOW }), /wallet_screener_sort_invalid/);
  assert.throws(() => normalizeWalletScreenerRequest({ filters: { performance_state: "profitable" } }, { now: NOW }), /performance_state_invalid/);
  assert.throws(() => normalizeWalletScreenerRequest({ filters: { active_within_hours: 0 } }, { now: NOW }), /active_within_hours_invalid/);
  assert.throws(() => normalizeWalletScreenerRequest({ filters: { min_known_cost_basis_pct: 100.01 } }, { now: NOW }), /min_known_cost_basis_pct_invalid/);
  assert.throws(() => normalizeWalletScreenerRequest({ filters: { min_win_rate_pct: false } }, { now: NOW }), /min_win_rate_pct_invalid/);
  assert.throws(() => normalizeWalletScreenerRequest({ filters: { min_roi_pct: -100.01 } }, { now: NOW }), /min_roi_pct_invalid/);
  assert.throws(() => normalizeWalletScreenerRequest({ page: 26 }, { now: NOW }), /wallet_screener_page_invalid/);
  assert.throws(() => normalizeWalletScreenerRequest({ page_size: 31 }, { now: NOW }), /wallet_screener_page_size_invalid/);
  assert.throws(() => normalizeWalletScreenerRequest({}, { now: "not-a-time" }), /wallet_screener_now_invalid/);
});

test("prospective follower evidence is an internal-policy-bound, composable screener dimension", () => {
  const reference = createSourceWalletCopyabilityPolicyReference({ fee_bps: 10 });
  const query = normalizeWalletScreenerRequest({
    clauses: [
      { field: "copyability_sample_count", operator: "gte", value: 20 },
      { field: "exit_executable_pct", operator: "gte", value: 80 },
      { field: "policy_pass_pct", operator: "gte", value: 60 },
      { field: "median_round_trip_friction_pct", operator: "lte", value: 5 },
      { field: "detection_context_sample_count", operator: "gte", value: 20 },
      { field: "median_detected_liquidity_usd", operator: "gte", value: 100_000 },
      { field: "median_detected_market_cap_usd", operator: "between", value: [200_000, 2_000_000] },
      { field: "median_source_trade_liquidity_pct", operator: "lte", value: 1 },
      { field: "outcome_checkpoint_count", operator: "gte", value: 20 },
      { field: "follower_route_persistence_pct", operator: "gte", value: 75 },
      { field: "follower_capture_ratio_pct", operator: "available" },
    ],
    sort: "follower_capture_desc",
  }, { now: NOW, copyability_reference: reference });
  assert.equal(query.follower_reality_reference.matrix_policy_hash, reference.matrix_policy_hash);
  assert.equal(query.follower_reality_reference.reference_order_size_usdc, 100);
  assert.equal(query.clauses.length, 11);
  assert.equal(query.sort, "follower_capture_desc");
});

test("D1 screening joins one exact fee and policy projection with deterministic binding order", async () => {
  const reference = createSourceWalletCopyabilityPolicyReference({ fee_bps: 10 });
  const query = normalizeWalletScreenerRequest({
    clauses: [
      { field: "copyability_sample_count", operator: "gte", value: 20 },
      { field: "median_detected_liquidity_usd", operator: "gte", value: 100_000 },
    ],
    sort: "detected_liquidity_desc",
    page_size: 12,
  }, { now: NOW, copyability_reference: reference });
  const calls = [];
  const db = {
    prepare(sql) {
      return {
        bind(...bindings) {
          calls.push({ sql, bindings });
          return {
            async first() { return { count: 0 }; },
            async all() { return { results: [] }; },
          };
        },
      };
    },
  };
  const result = await createD1CustomerWalletCopyStore(db).screenSourceWallets(query);
  assert.deepEqual(result, { rows: [], total: 0 });
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /LEFT JOIN ravenos_source_wallet_copyability_current cp/i);
  assert.match(calls[1].sql, /cp\.median_detected_liquidity_usd IS NULL ASC/i);
  assert.deepEqual(calls[0].bindings, [10, reference.matrix_policy_hash, 20, 100_000]);
  assert.deepEqual(calls[1].bindings, [10, reference.matrix_policy_hash, 20, 100_000, 12, 0]);
});

test("row projection exposes exact identity and source evidence without inventing follower results", () => {
  const projected = projectWalletScreenerRow(row());
  assert.equal(projected.source_wallet_id, SOURCE_ID);
  assert.deepEqual(projected.source_wallet, { chain: "solana", network: "mainnet", address: ADDRESS });
  assert.equal(projected.profile.generated_at, "2026-08-29T17:59:00.000Z");
  assert.equal(projected.behavior.last_trade_at, "2026-08-29T17:55:00.000Z");
  assert.equal(projected.source_performance.state, "available");
  assert.equal(projected.source_performance.profit_factor, 2.4);
  assert.equal(projected.profit_quality.top_1_profit_concentration_pct, 42.5);
  assert.equal(projected.coverage.reconstruction_confidence_pct, 91.5);
  assert.equal(projected.coverage.provider_history_exhausted, true);
  assert.equal(projected.coverage.source_history_complete, false);
  assert.equal(projected.capital_observations.current_balance_claimed, false);
  assert.equal(projected.capital_observations.sol.amount, 14.25);
  assert.deepEqual(projected.source_performance.realized_pnl, {
    usdc: 4812.25,
    sol: -0.4,
    combined: null,
    bases_combined: false,
  });
  assert.equal(projected.coverage.known_cost_basis_pct, 82.5);
  assert.equal(projected.coverage.chain_wide_coverage_claimed, false);
  assert.equal(projected.follower_reality.state, "not_sampled");
  assert.equal(projected.follower_reality.prospective_sample_size, null);
  assert.equal(projected.follower_reality.source_performance_used_as_follower_performance, false);
  assert.equal(projected.research_thesis.schema_version, "ravenos.wallet_research_thesis.v1");
  assert.equal(projected.research_thesis.state, "reviewable");
  assert.equal(projected.research_thesis.source_edge.state, "mixed_settlement_bases");
  assert.equal(projected.research_thesis.timing_style.state, "intraday");
  assert.match(projected.research_thesis.headline, /USDC and SOL results disagree/i);
  assert.equal(projected.research_thesis.claim_boundary.smart_money_claimed, false);
  assert.equal(projected.research_thesis.claim_boundary.copyability_claimed, false);
  assert.equal("score" in projected, false);
  assert.equal("copyability_score" in projected.follower_reality, false);
  assert.deepEqual(projected.why_surfaced.map((reason) => reason.code), [
    "last_trade_observed",
    "normalized_trade_history",
    "known_cost_basis_coverage",
    "reconstruction_confidence",
  ]);
  assert.equal(Object.isFrozen(projected), true);
  assert.equal(Object.isFrozen(projected.why_surfaced[0]), true);
  assert.equal(Object.isFrozen(projected.research_thesis.strengths[0]), true);
});

test("research thesis distinguishes one-hit risk, mixed settlement bases, thin evidence, and prospective copy evidence", () => {
  const broad = buildWalletResearchThesis({
    performance: { realized_pnl_usdc: 12_000, realized_pnl_sol: null, closed_observations: 24, profit_factor: 2.1 },
    behavior: { trade_count: 72, active_days: 18, median_hold_seconds: 4_500 },
    profit_quality: { top_1_profit_concentration_pct: 38, profitable_observations: 16, weekly_profitable_pct: 80 },
    quality: { known_cost_basis_pct: 92, reconstruction_confidence_pct: 93, source_history_complete: false },
    follower_reality: { state: "not_sampled" },
  });
  assert.equal(broad.state, "reviewable");
  assert.equal(broad.source_edge.state, "broad_positive_record");
  assert.match(broad.headline, /Broad source profits/i);

  const concentrated = buildWalletResearchThesis({
    performance: { realized_pnl_usdc: 50_000, realized_pnl_sol: null, closed_observations: 20, profit_factor: 2.8 },
    behavior: { trade_count: 45, active_days: 12, median_hold_seconds: 20 },
    profit_quality: { top_1_profit_concentration_pct: 92, profitable_observations: 14, weekly_profitable_pct: 75 },
    quality: { known_cost_basis_pct: 96, reconstruction_confidence_pct: 94, source_history_complete: false },
    follower_reality: { state: "not_sampled" },
  });
  assert.equal(concentrated.source_edge.state, "concentrated_positive_record");
  assert.equal(concentrated.timing_style.state, "very_fast");
  assert.ok(concentrated.watchouts.some((finding) => finding.code === "largest_winner_dependence"));
  assert.ok(concentrated.watchouts.some((finding) => finding.code === "latency_sensitivity_unmeasured"));
  assert.ok(concentrated.next_evidence.some((finding) => finding.code === "prospective_copy_evidence"));

  const mixed = buildWalletResearchThesis({
    performance: { realized_pnl_usdc: 1_000, realized_pnl_sol: -4, closed_observations: 12 },
    behavior: { trade_count: 30, active_days: 6, median_hold_seconds: 7_200 },
    profit_quality: { top_1_profit_concentration_pct: 55, profitable_observations: 7 },
    quality: { known_cost_basis_pct: 90, reconstruction_confidence_pct: 90, source_history_complete: true },
  });
  assert.equal(mixed.source_edge.state, "mixed_settlement_bases");
  assert.match(mixed.summary, /kept separate/i);
  assert.equal(mixed.claim_boundary.settlement_bases_combined, false);

  const thin = buildWalletResearchThesis({
    performance: { realized_pnl_usdc: null, realized_pnl_sol: null, closed_observations: 0 },
    behavior: { trade_count: 2, active_days: 1 },
    quality: { known_cost_basis_pct: null, reconstruction_confidence_pct: 42, source_history_complete: false },
  });
  assert.equal(thin.state, "insufficient_evidence");
  assert.equal(thin.source_edge.state, "insufficient_evidence");
  assert.equal(thin.claim_boundary.calibrated_alpha_claimed, false);
});

test("screener rows expose prospective $100 follower reality without converting it into source performance", () => {
  const projected = projectWalletScreenerRow(row({
    copyability_state: "available",
    copyability_score: 81,
    copyability_sample_count: 24,
    prospective_signal_count: 24,
    entry_executable_pct: 91.67,
    exit_executable_pct: 87.5,
    policy_pass_pct: 66.67,
    median_entry_degradation_bps: 42,
    median_round_trip_friction_pct: 2.41,
    outcome_checkpoint_count: 18,
    outcome_reference_horizon_seconds: 3_600,
    follower_route_persistence_pct: 83.33,
    median_follower_return_pct: 4.82,
    follower_win_rate_pct: 61.11,
    follower_capture_sample_count: 11,
    follower_capture_ratio_pct: 58.4,
    follower_minus_source_return_pct: -3.42,
    copyability_fee_bps: 10,
    copyability_last_observed_at: Math.floor(Date.parse("2026-08-29T17:58:00.000Z") / 1_000),
    detection_context_sample_count: 24,
    detection_context_coverage_pct: 100,
    detected_market_cap_coverage_pct: 95.83,
    detected_liquidity_coverage_pct: 100,
    detected_pair_age_coverage_pct: 91.67,
    median_detected_market_cap_usd: 750_000,
    median_detected_liquidity_usd: 125_000,
    median_detected_pair_age_seconds: 3_600,
    median_source_trade_liquidity_pct: 0.4,
    median_market_context_delay_ms: 1_200,
  }));
  assert.equal(projected.follower_reality.state, "available");
  assert.equal(projected.follower_reality.copyability_score, 81);
  assert.equal(projected.follower_reality.prospective_sample_size, 24);
  assert.equal(projected.follower_reality.exit_verified_rate_pct, 87.5);
  assert.equal(projected.follower_reality.policy_pass_rate_pct, 66.67);
  assert.equal(projected.follower_reality.median_entry_degradation_pct, 0.42);
  assert.equal(projected.follower_reality.median_round_trip_friction_pct, 2.41);
  assert.equal(projected.follower_reality.outcome_checkpoint_count, 18);
  assert.equal(projected.follower_reality.outcome_reference_horizon_seconds, 3_600);
  assert.equal(projected.follower_reality.route_persistence_pct, 83.33);
  assert.equal(projected.follower_reality.median_follower_return_pct, 4.82);
  assert.equal(projected.follower_reality.follower_win_rate_pct, 61.11);
  assert.equal(projected.follower_reality.follower_capture_sample_count, 11);
  assert.equal(projected.follower_reality.follower_capture_ratio_pct, 58.4);
  assert.equal(projected.follower_reality.follower_minus_source_return_pct, -3.42);
  assert.equal(projected.follower_reality.hypothetical_raven_fee_bps, 10);
  assert.equal(projected.detected_market_context.state, "available");
  assert.equal(projected.detected_market_context.context_sample_count, 24);
  assert.equal(projected.detected_market_context.median_market_cap_usd, 750_000);
  assert.equal(projected.detected_market_context.median_liquidity_usd, 125_000);
  assert.equal(projected.detected_market_context.median_selected_pair_age_seconds, 3_600);
  assert.equal(projected.detected_market_context.median_source_trade_liquidity_pct, 0.4);
  assert.equal(projected.detected_market_context.exact_source_pool_claimed, false);
  assert.equal(projected.detected_market_context.pair_age_used_as_token_age, false);
  assert.equal(projected.source_performance.realized_pnl.usdc, 4812.25);
  assert.equal(projected.follower_reality.source_performance_used_as_follower_performance, false);
  assert.equal(projected.follower_reality.unavailable_decisions_dropped, false);
  assert.equal(projected.why_surfaced[1].code, "prospective_follower_evidence");
});

test("projection fails closed on identity and never turns malformed or missing metrics into zero", () => {
  assert.equal(projectWalletScreenerRow(row({ source_wallet_id: "sw_sol_not_exact" })), null);
  assert.equal(projectWalletScreenerRow(row({ address: "not-a-solana-address" })), null);
  const projected = projectWalletScreenerRow(row({
    performance_state: "available",
    realized_pnl_usdc: "not-a-number",
    realized_pnl_sol: null,
    roi_pct: "<script>alert(1)</script>",
    win_rate_pct: 101,
    known_cost_basis_pct: -1,
    closed_lots: 0,
    median_hold_seconds: -5,
    detection_context_sample_count: "not-a-number",
    median_detected_market_cap_usd: "<script>alert(2)</script>",
    median_detected_liquidity_usd: -5,
  }));
  assert.equal(projected.source_performance.state, "insufficient_evidence");
  assert.equal(projected.source_performance.realized_pnl.usdc, null);
  assert.equal(projected.source_performance.realized_pnl.sol, null);
  assert.equal(projected.source_performance.roi_pct, null);
  assert.equal(projected.source_performance.win_rate_pct, null);
  assert.equal(projected.coverage.known_cost_basis_pct, null);
  assert.equal(projected.behavior.median_hold_seconds, null);
  assert.equal(projected.detected_market_context.state, "not_sampled");
  assert.equal(projected.detected_market_context.median_market_cap_usd, null);
  assert.equal(projected.detected_market_context.median_liquidity_usd, null);
});

test("response is bounded, paginated, honest about universe coverage, and excludes malformed rows", () => {
  const query = normalizeWalletScreenerRequest({ page: 2, page_size: 2 }, { now: NOW });
  const response = buildWalletScreenerResponse({
    query,
    rows: [row(), row({ source_wallet_id: "invalid" }), row({ source_wallet_id: `sw_sol_${"c".repeat(40)}` })],
    total: 101,
    now: NOW,
  });
  assert.equal(response.state, "available");
  assert.equal(response.ok, true);
  assert.equal(response.rows.length, 1);
  assert.equal(response.projection_exclusions, 1);
  assert.equal(response.pagination.total_matching_rows, 101);
  assert.equal(response.pagination.total_pages, 25);
  assert.equal(response.pagination.result_window_limited, true);
  assert.equal(response.pagination.has_previous, true);
  assert.equal(response.pagination.has_next, true);
  assert.equal(response.scope.claim, "bounded_raven_index_only");
  assert.equal(response.scope.comprehensive_chain_index, false);
  assert.deepEqual(response.presets.map((preset) => preset.id), ["evidence_first", "consistent_winners", "broad_edge", "active_swing", "fast_systematic", "follower_tested"]);
  assert.match(response.limitations[0], /not every wallet on Solana/i);
  assert.equal(Object.isFrozen(response.rows), true);
});

test("a page containing only invalid identities fails closed instead of posing as an empty universe", () => {
  const response = buildWalletScreenerResponse({
    query: {},
    rows: [{ source_wallet_id: "bad", address: ADDRESS }],
    total: 1,
    now: NOW,
  });
  assert.equal(response.ok, false);
  assert.equal(response.state, "unavailable");
  assert.equal(response.rows.length, 0);
  assert.equal(response.projection_exclusions, 1);
});
