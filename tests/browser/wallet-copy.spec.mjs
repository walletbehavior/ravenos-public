import { expect, test } from "@playwright/test";
import { join } from "node:path";

const WALLET = "7KxQmTi5W4rP8Y2hD9cV6nF3aS1uEoLzJbGkNqMpfHrt";
const TOKEN = "4M7YQqGfRWfBpcA7mN5uY3z8Jj6Hk2VtD9sLxEePoaBn";
const WATCH_ID = "wcw_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SOURCE_ID = `sw_sol_${"a".repeat(40)}`;
const EVM_WALLET = `0x${"12".repeat(20)}`;
const EVM_TOKEN = `0x${"56".repeat(20)}`;
const EVM_TOKEN_TWO = `0x${"ab".repeat(20)}`;
const EVM_SOURCE_ID = `sw_bsc_${"b".repeat(40)}`;

function researchThesis() {
  return {
    schema_version: "ravenos.wallet_research_thesis.v1",
    thesis_version: 1,
    state: "developing",
    headline: "Broad source profits · intraday",
    summary: "5 profitable closes are observed; the largest winner contributes 48.2% of gross positive realized P&L. Median observed hold: 31m.",
    source_edge: { state: "broad_positive_record", label: "Broad positive record" },
    timing_style: { state: "intraday", label: "Intraday", median_hold_seconds: 1_860 },
    evidence_strength: { state: "developing", label: "Developing evidence" },
    strengths: [
      { code: "profit_factor_strength", label: "2.18× profit factor on the available settlement basis." },
      { code: "profit_breadth", label: "5 profitable closes with 48.2% from the largest winner." },
    ],
    watchouts: [
      { code: "cost_basis_gap", label: "Only 71.4% of observed trade cost basis is known." },
      { code: "small_closed_sample", label: "8 known-cost closed observations; source results may be sample-sensitive." },
    ],
    next_evidence: [
      { code: "prospective_copy_evidence", label: "Collect prospective Shadow entry, reverse-exit, latency, and refusal evidence before judging copyability." },
      { code: "entry_context", label: "Retain contemporaneous entry liquidity, market-cap, token-age, and impact evidence." },
    ],
    follower_reality: { state: "not_sampled", source_performance_used_as_follower_performance: false },
    claim_boundary: { wallet_identity_claimed: false, bot_identity_claimed: false, smart_money_claimed: false, copyability_claimed: false, calibrated_alpha_claimed: false, settlement_bases_combined: false },
  };
}

async function captureVisual(page, name) {
  const directory = process.env.RAVENOS_VISUAL_ARTIFACT_DIR;
  if (directory) await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true });
}

function session(authenticated = true) {
  return authenticated
    ? { ok: true, authenticated: true, csrf_token: "csrf_wallet_copy", account: { email: "pro@example.com" } }
    : { ok: true, authenticated: false, account: null, session: null };
}

function event(kind = "SWAP_BUY", sequence = 0) {
  const eventTail = sequence.toString(16).padStart(40, "a").slice(-40);
  return {
    schema_version: "ravenos.wallet_activity_event.v1",
    event_id: `swe_${eventTail}`,
    source_wallet: { chain: "solana", network: "mainnet", address: WALLET },
    chain_evidence: { signature: String(5 + (sequence % 4)).repeat(88), slot: 100 - sequence, block_time: new Date(Date.parse("2026-08-29T11:59:58.000Z") - (sequence * 60_000)).toISOString(), provider: "constant_k_nexus", finality: "confirmed" },
    timing: { observation_mode: sequence ? "historical_backfill" : "prospective", detection_delay_ms: sequence ? null : 870, decode_latency_ms: 41 },
    classification: { kind, confidence: new Set(["AMBIGUOUS", "UNSUPPORTED"]).has(kind) ? "insufficient" : "observed", reasons: kind === "SWAP_BUY" ? ["canonical_spend_and_token_receipt"] : ["asset_increase_without_observed_consideration"] },
    economic: {
      cost_basis_state: kind === "SWAP_BUY" ? "known_canonical_usdc" : "unresolved_non_usdc_basis",
      source_asset: kind === "SWAP_BUY" ? { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amount_base_units: "25000000", decimals: 6 } : null,
      destination_asset: kind === "SWAP_BUY" ? { mint: TOKEN, amount_base_units: "81000000", decimals: 6 } : null,
      transaction_fee_lamports: 5_000,
    },
    route_evidence: { route_shape: kind === "SWAP_BUY" ? "direct" : "not_proven", program_ids: ["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"] },
  };
}

function activityPage(events, { filter = "all", total = events.length, hasMore = false, nextCursor = null } = {}) {
  return {
    schema_version: "ravenos.wallet_activity_page.v1",
    filter,
    events,
    pagination: { limit: 12, returned: events.length, matching_event_count: total, has_more: hasMore, next_cursor: hasMore ? nextCursor : null },
    scope: { evidence_mode: "retained_raven_index", provider_request_performed: false, history_complete_claimed: false, current_balance_claimed: false },
  };
}

function profile() {
  return {
    schema_version: "ravenos.solana_wallet_profile.v1",
    source_wallet: { chain: "solana", network: "mainnet", address: WALLET },
    coverage: { transactions_observed: 12, trade_events: 7, known_cost_basis_pct: 71.4 },
    source_performance: {
      state: "partial",
      realized_pnl_usdc: 428.12,
      roi_pct: 38.42,
      win_rate_pct: 62.5,
      closed_lots: 8,
      profit_factor: 2.18,
      windows: {
        h24: { state: "available", observations: 2, realized_pnl: { usdc: 52.2, sol: null, combined: null, bases_combined: false } },
        d7: { state: "available", observations: 5, realized_pnl: { usdc: 211.4, sol: null, combined: null, bases_combined: false } },
        d30: { state: "available", observations: 8, realized_pnl: { usdc: 428.12, sol: null, combined: null, bases_combined: false } },
        d90: { state: "available", observations: 8, realized_pnl: { usdc: 428.12, sol: null, combined: null, bases_combined: false } },
        all_available: { state: "available", observations: 8, realized_pnl: { usdc: 428.12, sol: null, combined: null, bases_combined: false } },
      },
      limitations: ["Some positions have unresolved cost basis and are excluded from realized performance."],
    },
    behavior: { median_hold_seconds: 1_860, average_hold_seconds: 2_100, trade_count: 7, active_days: 4, tokens_traded: 3, first_trade_at: "2026-08-20T12:00:00.000Z", last_trade_at: "2026-08-29T11:59:58.000Z", repeat_token_rate_pct: 33.3, observed_trade_completion_pct: 66.7, scaled_into_token_pct: 25, scaled_out_token_pct: 20, mechanical_pattern_evidence: { state: "insufficient_evidence", rapid_under_30_seconds_pct: 14.3 } },
    profit_quality: { by_basis: { usdc: { top_1_profit_concentration_pct: 48.2, top_5_profit_concentration_pct: 100, profitable_observations: 5, weekly_consistency: { profitable_period_pct: 75 } }, sol: {} } },
    research_thesis: researchThesis(),
    data_quality: { history_scope: "bounded_partial_history", provider_history_exhausted: false, cost_basis_coverage_pct: 71.4, trade_decode_coverage_pct: 91.7, classification_coverage_pct: 100, reconstruction_confidence_pct: 87.7, analysis_events: 700, analysis_event_limit: 2_000, analysis_truncated: false, analysis_scope: "all_retained_normalized_events", historical_price_evidence_coverage_pct: null, full_data_confidence_pct: null },
    positions: { known_cost_open_position_count: 1, unresolved_cost_basis_event_count: 2, known_cost_open_positions: [{ mint: TOKEN, basis: "usdc", lot_count: 1, remaining_cost: 25 }] },
    capital_observations: { current_balance_claimed: false, sol: { amount: 8.2, observed_at: "2026-08-29T11:59:58.000Z" }, canonical_usdc: { amount: 412.5, observed_at: "2026-08-29T11:59:58.000Z" } },
  };
}

function evmProfile() {
  return {
    schema_version: "ravenos.evm_wallet_basic_profile.v2",
    source_wallet: { chain: "bsc", network: "mainnet", chain_id: 56, vm_family: "evm", address: EVM_WALLET },
    coverage: { first_observed_at: "2026-09-04T12:00:00.000Z", last_observed_at: "2026-09-04T12:00:00.000Z", transactions_observed: 0, transactions_reported_by_provider: 123, normalized_events: 1, token_transfers_observed: 1, token_transfers_reported_by_provider: 456, trade_events: null, known_cost_basis_pct: null, provider_history_exhausted: false },
    source_performance: { state: "insufficient_evidence", realized_pnl_usdc: null, realized_pnl_sol: null, roi_pct: null, win_rate_pct: null, closed_lots: null, closed_observations: null, profit_factor: null, windows: null, limitations: ["Recent transfers are not classified as trades."] },
    behavior: { active_days: 1, trade_count: null, first_trade_at: null, last_trade_at: null, tokens_traded: null, token_assets_observed: 1, buy_count: null, sell_count: null, median_hold_seconds: null, trade_rate_per_active_day: null, classifications: { TRANSFER_IN: 1 } },
    provider_activity: { state: "transfer_activity_observed", observed_transfer_rows: 1, inbound_transfer_rows: 1, outbound_transfer_rows: 0, internal_movement_rows: 0, unique_token_contracts: 1, most_recent_transfer_at: "2026-09-04T12:00:00.000Z", trade_activity_claimed: false, economic_flow_claimed: false, direction_is_transfer_direction_only: true, route_decode_candidate_transactions: 1, route_decode_candidate_definition: "opposing_different_token_transfers_in_one_transaction", route_decode_candidate_is_trade_claimed: false, transaction_context_candidate_limit: 3, transaction_context_candidates_requested: 1, transaction_context_candidates_available: 1, transaction_context_candidates_unavailable: 0, raven_decoded_trade_transactions: 0, copy_eligible_transactions: 0 },
    provider_balance_summary: { visible_balance_rows: 1, visible_priced_rows: 1, visible_unpriced_rows: 0, visible_provider_mark_value_usd: 2.5025, largest_visible_provider_mark_symbol: "USDC", largest_visible_provider_mark_weight_pct: 100, visible_rows_only: true, all_assets_enumerated: null, executable_value_claimed: false, portfolio_value_claimed: false },
    research_thesis: null,
    profit_quality: { state: "insufficient_evidence" },
    positions: { known_cost_open_positions: [], known_cost_open_position_count: 0, unresolved_cost_basis_event_count: 1, provider_reported_token_balances: [{ contract: EVM_TOKEN, symbol: "USDC", balance_display: "2.5", provider_mark_price_usd: 1.001, provider_mark_value_usd: 2.5025, executable_value_usd: null, cost_basis_usd: null, pnl_usd: null }] },
    capital_observations: { scope: "blockscout_indexed_snapshot", current_balance_claimed: false, native: { symbol: "BNB", amount: "1.25", observed_at: "2026-09-04T12:01:00.000Z", state: "provider_indexed" }, canonical_usdc: { amount: null, observed_at: null, state: "not_aggregated" }, provider_reported_token_count: 1 },
    data_quality: { history_scope: "bounded_current_balances_and_recent_transfers", history_complete: false, provider_history_exhausted: false, provider: "blockscout_pro_v2", trade_decode_coverage_pct: null, transaction_context_coverage_pct: 100, classification_coverage_pct: null, cost_basis_coverage_pct: null, reconstruction_confidence_pct: null, full_data_confidence_pct: null, analysis_events: 1, analysis_scope: "recent_erc20_transfers_only" },
  };
}

function evmTransfer() {
  return {
    schema_version: "ravenos.wallet_activity_event.v1",
    event_id: `swe_${"c".repeat(40)}`,
    source_wallet: { chain: "bsc", network: "mainnet", chain_id: 56, vm_family: "evm", address: EVM_WALLET },
    chain_evidence: { transaction_reference: `0x${"78".repeat(32)}`, block_number: 1234, block_hash: `0x${"9a".repeat(32)}`, block_time: "2026-09-04T12:00:00.000Z", provider: "Blockscout Pro", finality: "confirmed" },
    timing: { observation_mode: "bounded_indexed_transfer_lookup", raven_received_at: "2026-09-04T12:01:00.000Z", detection_delay_ms: null },
    classification: { kind: "TRANSFER_IN", confidence: "direct_transfer_participant", reasons: ["exact_wallet_transfer_participant", "transfer_is_not_assumed_to_be_a_trade"], ambiguous: false },
    economic: { source_asset: null, destination_asset: { contract: EVM_TOKEN, symbol: "USDC", amount_base_units: "2500000", decimals: 6 }, transaction_fee_lamports: null, cost_basis_state: "unresolved_transfer_context" },
    route_evidence: { program_ids: [], swap_route_observed: false, route_shape: "not_proven_from_transfer_index" },
    copy_signal: { eligible_buy_signal: false, eligible_sell_signal: false, reason: "erc20_transfer_is_not_a_copy_trade_signal" },
  };
}

function evmTransactionContext() {
  return {
    schema_version: "ravenos.evm_transaction_context_candidate.v1",
    transaction_reference: `0x${"78".repeat(32)}`,
    state: "swap_shaped_context_unverified",
    context_available: true,
    provider_transaction: { status: "ok", method: "swapExactTokensForTokens", from: EVM_WALLET, to: `0x${"34".repeat(20)}`, wallet_is_sender: true, block_number: 1234, timestamp: "2026-09-04T12:00:00.000Z", confirmations: 24, transaction_types: ["contract_call", "token_transfer"], action_labels: [], token_transfers_overflow: false },
    wallet_transfer_shape: {
      inbound_assets: [{ asset_id: `eip155:56/erc20:${EVM_TOKEN}`, contract: EVM_TOKEN, symbol: "USDC", decimals: 6, amount_base_units: "2500000", amount_display: "2.5", canonical_usdc: false }],
      outbound_assets: [{ asset_id: `eip155:56/erc20:${EVM_TOKEN_TWO}`, contract: EVM_TOKEN_TWO, symbol: "TOKEN", decimals: 18, amount_base_units: "1000000000000000000", amount_display: "1", canonical_usdc: false }],
      inbound_asset_count: 1,
      outbound_asset_count: 1,
      opposing_different_assets_observed: true,
    },
    interpretation: { raven_trade_classification: "unresolved", provider_method_is_trade_proof: false, recognized_router_proven: false, complete_wallet_economic_delta_proven: false, trade_claimed: false, copy_signal_created: false },
  };
}

function deepHistory(state = "queued") {
  return {
    state,
    pages_indexed: 7,
    signatures_indexed: 700,
    transactions_decoded: 694,
    decode_failures: 0,
    history_exhausted: false,
    history_complete_claimed: false,
    maximum_signatures: 10_000,
    updated_at: "2026-08-29T12:00:00.000Z",
  };
}

function screenedWallet() {
  return {
    source_wallet_id: SOURCE_ID,
    source_wallet: { chain: "solana", network: "mainnet", address: WALLET },
    profile: { snapshot_id: `swp_${"b".repeat(40)}`, version: 3, generated_at: "2026-08-29T12:00:00.000Z" },
    source_performance: { state: "partial", realized_pnl: { usdc: 428.12, sol: null, combined: null, bases_combined: false }, roi_pct: 38.42, win_rate_pct: 62.5, closed_lots: 8, profit_factor: 2.18 },
    behavior: { first_trade_at: "2026-08-20T12:00:00.000Z", last_trade_at: "2026-08-29T11:59:58.000Z", trade_count: 7, active_days: 4, token_count: 3, median_hold_seconds: 1_860 },
    profit_quality: { top_1_profit_concentration_pct: 48.2 },
    research_thesis: researchThesis(),
    coverage: { known_cost_basis_pct: 71.4, reconstruction_confidence_pct: 87.7, source_history_complete: false, chain_wide_coverage_claimed: false },
    why_surfaced: [{ code: "normalized_trade_history", label: "7 normalized trades observed." }, { code: "closed_lot_evidence", label: "8 closed lots support source-performance calculations." }],
    follower_reality: {
      state: "forming",
      prospective_sample_size: 24,
      policy_pass_rate_pct: 66.67,
      outcome_checkpoint_count: 18,
      outcome_reference_horizon_seconds: 3_600,
      route_persistence_pct: 83.33,
      median_follower_return_pct: 4.82,
      follower_win_rate_pct: 61.11,
      follower_capture_sample_count: 11,
      follower_capture_ratio_pct: 58.4,
      follower_minus_source_return_pct: -3.42,
    },
    detected_market_context: {
      state: "available",
      prospective_signal_count: 24,
      context_sample_count: 24,
      context_coverage_pct: 100,
      median_market_cap_usd: 750_000,
      median_liquidity_usd: 125_000,
      median_selected_pair_age_seconds: 3_600,
      median_source_trade_liquidity_pct: 0.4,
      evidence_scope: "raven_detection_time_exact_token_market_context",
      exact_source_pool_claimed: false,
      historical_entry_context_claimed: false,
      pair_age_used_as_token_age: false,
    },
  };
}

function prospectiveCopyability() {
  const sizes = [25, 100, 500, 1_000, 5_000];
  return {
    schema_version: "ravenos.source_wallet_copyability_matrix.v1",
    state: "forming",
    prospective_signal_count: 24,
    probe_observation_count: 120,
    snapshot: {
      state: "forming",
      score: null,
      prospective_sample_count: 24,
      components: {
        policy_pass_pct: 66.67,
        entry_executable_pct: 91.67,
        exit_executable_pct: 87.5,
        median_entry_degradation_bps: 42,
      },
      dominant_refusal: {
        decision_state: "EXIT_UNAVAILABLE",
        reason_code: "reverse_exit_unavailable",
        count: 5,
        pct_of_signals: 20.83,
        pct_of_refusals: 62.5,
        refusal_is_zero_return: false,
      },
    },
    by_size: sizes.map((size) => ({
      order_size_usdc: size,
      state: "forming",
      score: null,
      prospective_sample_count: 24,
      components: { policy_pass_pct: size <= 500 ? 66.67 : 41.67 },
    })),
    copy_diagnosis: {
      state: "available",
      reference_order_size_usdc: 100,
      minimum_prospective_sample_count: 20,
      majority_policy_pass_threshold_pct: 50,
      largest_tested_size_with_majority_policy_pass_usdc: 5_000,
      first_tested_size_below_majority_policy_pass_usdc: null,
      reference_dominant_refusal: {
        decision_state: "EXIT_UNAVAILABLE",
        reason_code: "reverse_exit_unavailable",
        count: 5,
        pct_of_signals: 20.83,
        pct_of_refusals: 62.5,
        refusal_is_zero_return: false,
      },
      liquidity_capacity_claimed: false,
    },
    size_stress: {
      schema_version: "ravenos.source_wallet_copyability_size_stress.v1",
      state: "size_sensitive",
      prospective_signal_count: 24,
      full_ladder_signal_count: 24,
      full_ladder_coverage_pct: 100,
      largest_contiguous_size_with_majority_policy_pass_usdc: 500,
      first_qualified_size_below_majority_policy_pass_usdc: 1_000,
      concurrent_follower_demand_measured: false,
      liquidity_capacity_claimed: false,
    },
    crowding: {
      schema_version: "ravenos.source_wallet_copy_crowding_summary.v1",
      state: "available",
      eligible_signal_sample_count: 24,
      minimum_signal_sample_count: 20,
      aggregate_route_available_pct: 70.83,
      aggregate_route_constrained_pct: 20.83,
      aggregate_route_unavailable_pct: 8.34,
      dominant_constraint: { reason_code: "round_trip_friction_exceeds_policy", signal_count: 5, pct_of_eligible_signals: 20.83 },
      current_follower_count_disclosed: false,
      aggregate_follower_capital_disclosed: false,
      exact_allocation_promised: false,
      simultaneous_fill_promised: false,
      live_copy: false,
    },
    prospective_outcomes: {
      reference_order_size_usdc: 100,
      reference_horizon_seconds: 3_600,
      reference: {
        order_size_usdc: 100,
        horizon_seconds: 3_600,
        checkpoint_count: 18,
        route_persistence_pct: 83.33,
        median_follower_return_pct: 4.82,
        follower_capture_sample_count: 11,
        median_follower_capture_ratio_pct: 58.4,
      },
      by_size: sizes.map((size) => ({ order_size_usdc: size, horizon_seconds: 3_600, checkpoint_count: 18 })),
    },
    copy_playbook: {
      schema_version: "ravenos.source_wallet_copy_playbook.v1",
      playbook_version: 1,
      state: "available",
      headline_code: "ROUTES_WEAKEN_ABOVE_SIZE",
      prospective_signal_count: 24,
      minimum_prospective_sample_count: 20,
      reference_order_size_usdc: 100,
      reference_policy_pass_pct: 66.67,
      size_window: {
        state: "size_sensitive",
        smallest_sampled_size_usdc: 25,
        largest_sampled_size_usdc: 5_000,
        evidence_qualified_size_count: 5,
        largest_contiguous_majority_pass_size_usdc: 500,
        policy_pass_pct_at_largest_majority_size: 66.67,
        first_below_majority_size_usdc: 1_000,
        policy_pass_pct_at_first_below_majority_size: 41.67,
        isolated_exact_route_quotes_only: true,
        position_size_recommendation: false,
      },
      strongest_observed_market_fit: {
        state: "available",
        dimension: "market_cap_usd",
        dimension_label: "Detected market cap",
        bucket_id: "200k_750k",
        bucket_label: "$200K–$750K",
        prospective_sample_count: 24,
        policy_pass_pct: 70.83,
        dominant_refusal: null,
      },
      route_persistence: {
        state: "forming",
        order_size_usdc: 100,
        horizon_seconds: 3_600,
        checkpoint_count: 18,
        route_persistence_pct: 83.33,
        median_follower_return_pct: 4.82,
        follower_capture_sample_count: 11,
        median_follower_capture_ratio_pct: 58.4,
      },
      leading_constraint: {
        state: "observed",
        scope: "reference_order_exact_routes",
        reason_code: "reverse_exit_unavailable",
        observation_count: 5,
        pct_of_signals: 20.83,
      },
      financial_advice: false,
      execution_boundary: { research_summary_only: true, live_copy: false, signing: false, broadcasting: false, custody: false, fee_collection: false, transaction_hash: null },
    },
    detection_market_context: {
      context_observation_count: 24,
      median_detected_market_cap_usd: 750_000,
      median_detected_liquidity_usd: 125_000,
    },
    market_regimes: {
      schema_version: "ravenos.source_wallet_copyability_market_regimes.v1",
      state: "available",
      reference_order_size_usdc: 100,
      reference_signal_count: 24,
      minimum_prospective_sample_count: 20,
      dimensions: [
        {
          dimension: "market_cap_usd",
          label: "Detected market cap",
          representative_bucket: { bucket_id: "200k_750k", bucket_label: "$200K–$750K", prospective_sample_count: 24, policy_pass_pct: 66.67, dominant_refusal: null },
        },
        {
          dimension: "liquidity_usd",
          label: "Detected liquidity",
          representative_bucket: { bucket_id: "100k_500k", bucket_label: "$100K–$500K", prospective_sample_count: 24, policy_pass_pct: 66.67, dominant_refusal: null },
        },
        {
          dimension: "pair_age_seconds",
          label: "Selected pair age",
          representative_bucket: { bucket_id: "1h_24h", bucket_label: "1h–24h", prospective_sample_count: 24, policy_pass_pct: 66.67, dominant_refusal: null },
        },
      ],
      exact_source_pool_claimed: false,
      token_age_claimed: false,
    },
    hypothetical_raven_fee_scenarios_bps: [10],
  };
}

function policy() {
  return {
    schema_version: "ravenos.copy_policy.v1",
    policy_version: 1,
    policy_hash: "f".repeat(40),
    mode: "RAVEN_COPY",
    sizing: { kind: "FIXED_USDC", fixed_usdc: 100, implemented: true },
    execution_quality: { maximum_round_trip_friction_pct: 5 },
  };
}

function watch(backfillComplete = false) {
  return {
    watch_id: WATCH_ID,
    source_wallet: { chain: "solana", network: "mainnet", address: WALLET },
    label: "Momentum source",
    state: "active",
    copy_mode: "RAVEN_COPY",
    policy: policy(),
    backfill_complete: backfillComplete,
    cursor: { signature: backfillComplete ? "5".repeat(88) : null, slot: backfillComplete ? 123 : null },
    source_state: { state: backfillComplete ? "current" : "requested", last_observed_at: backfillComplete ? "2026-08-29T12:00:00.000Z" : null },
    revision: backfillComplete ? 2 : 1,
    created_at: "2026-08-29T11:50:00.000Z",
    updated_at: "2026-08-29T12:00:00.000Z",
  };
}

function decision(state = "EXIT_UNAVAILABLE") {
  return {
    schema_version: "ravenos.shadow_copy_decision.v1",
    decision_id: "scd_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    watch_id: WATCH_ID,
    source_wallet: { chain: "solana", network: "mainnet", address: WALLET },
    destination_asset: { mint: TOKEN },
    terminal_handoff: state === "SHADOW_EXECUTABLE" ? {
      state: "user_review_available",
      chain: "solana",
      instrument_id: `solana:pool:${WALLET}`,
      identity_scope: "exact_pool",
      pair_address: WALLET,
      token_address: TOKEN,
      quote_address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      side: "buy",
      amount_usdc: 100,
      wallet_signature_required: true,
      automatic_submission: false,
    } : { state: "exact_market_unavailable", wallet_signature_required: true, automatic_submission: false },
    timing: { source_chain_event_at: "2026-08-29T12:00:01.000Z", detection_delay_ms: 1_270 },
    follower_reality: {
      follower_order_usdc: 100,
      entry_degradation_bps: 42,
      current_executable_exit_usdc: null,
      round_trip_friction_including_raven_pct: null,
    },
    hypothetical_raven_fee: { scenario_bps: 10 },
    decision: { state, reason_code: "reverse_exit_unavailable", refusal_is_zero_return: false },
    execution_boundary: { mode: "shadow", transaction_hash: null, signing_available: false, broadcasting_available: false },
  };
}

function exitDecision(state = "SHADOW_EXIT_EXECUTABLE") {
  return {
    schema_version: "ravenos.shadow_copy_exit_decision.v1",
    exit_decision_id: "sce_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    watch_id: WATCH_ID,
    source_wallet: { chain: "solana", network: "mainnet", address: WALLET },
    source_event_id: "swe_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    asset: { mint: TOKEN, decimals: 6, amount_base_units: "4000000" },
    source_sell: {
      quantity_base_units: "4000000",
      balance_before_base_units: "10000000",
      balance_after_base_units: "6000000",
      fraction_bps: 4000,
      fraction_evidence_available: true,
      fraction_basis: "transaction_touched_source_accounts",
      wallet_total_balance_claimed: false,
    },
    mapped_follower_exit: {
      position_count: 1,
      quantity_base_units: "32500000000",
      gross_expected_usdc: 41.3,
      minimum_expected_usdc: 40.9,
    },
    position_allocations: [{
      position_id: "scp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      quantity_base_units: "32500000000",
      position_quantity_before_base_units: "81250000000",
      position_quantity_after_base_units: "48750000000",
      source_sell_fraction_bps: 4000,
      gross_expected_exit_usdc: 41.3,
      minimum_expected_exit_usdc: 40.9,
      applied: state === "SHADOW_EXIT_EXECUTABLE",
    }],
    hypothetical_raven_fee: { scenario_bps: 10, fee_usdc: 0.04, collected: false },
    decision: {
      state,
      reason_code: state === "SHADOW_EXIT_EXECUTABLE" ? "mapped_source_exit_quote_available" : "follower_exit_quote_unavailable",
      follower_position_changed: state === "SHADOW_EXIT_EXECUTABLE",
      pre_subscription_inventory_treated_as_zero_cost: false,
      refusal_is_zero_return: false,
    },
    timing: {
      source_chain_event_at: "2026-08-29T12:05:00.000Z",
      raven_received_at: "2026-08-29T12:05:00.870Z",
      policy_decided_at: "2026-08-29T12:05:01.200Z",
      detection_delay_ms: 870,
    },
    execution_boundary: { mode: "shadow", transaction_hash: null, signing_available: false, broadcasting_available: false, fee_collection_available: false },
  };
}

function position() {
  return {
    schema_version: "ravenos.shadow_copy_position.v1",
    position_id: "scp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    watch_id: WATCH_ID,
    source_wallet: { chain: "solana", network: "mainnet", address: WALLET },
    destination_asset: { mint: TOKEN, decimals: 6 },
    expected_quantity: 81_250,
    expected_quantity_base_units: "81250000000",
    minimum_quantity_base_units: "81000000000",
    remaining_quantity_base_units: "48750000000",
    exited_quantity_base_units: "32500000000",
    entry_cost_usdc: 100,
    state: "SHADOW_PARTIAL_EXIT",
    exit_count: 1,
    gross_realized_exit_usdc: 41.3,
    opened_at: "2026-08-29T12:00:03.000Z",
    live_assets_held: false,
    transaction_hash: null,
  };
}

async function install(page, shared, { authenticated = true, entitled = true, marketEvidence = false } = {}) {
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(session(authenticated)),
  }));
  await page.route("**/api/v1/wallet-copy**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const record = { method: request.method(), path: url.pathname, search: url.search, body: request.postData(), headers: request.headers() };
    shared.requests.push(record);
    if (url.pathname === "/api/v1/wallet-copy" && request.method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          state: "available",
          copy_product: { standard_execution_fee_bps: 100, pro_execution_fee_bps: 100, pro_cashback_percent: 30, copy_additional_fee_bps: 0 },
          access: { tier: entitled ? "pro" : "free", advanced_wallet_intelligence: entitled, basic_wallet_lookup: true, basic_wallet_screener: true, raven_copy_subscription_required: false },
          activation: { wallet_intelligence: true, wallet_screener: true, wallet_market_evidence: marketEvidence, shadow_copy: true, live_copy: false },
          execution_boundary: { signing: false, broadcasting: false, custody: false, live_copy: false, fee_collection: false },
        }),
      });
    }
    if (url.pathname.endsWith("/screener") && request.method() === "POST") {
      const screenerBody = JSON.parse(request.postData() || "{}");
      const robinhood = screenerBody.chain === "robinhood";
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        ok: true,
        state: robinhood ? "empty" : "available",
        scope: { chain: screenerBody.chain || "solana", chains: screenerBody.chain === "all" ? ["solana", "robinhood"] : [screenerBody.chain || "solana"], claim: "bounded_raven_index_only", comprehensive_chain_index: false },
        rows: robinhood ? [] : [screenedWallet()],
        pagination: { page: 1, page_size: 12, total_matching_rows: robinhood ? 0 : 1, total_pages: robinhood ? 0 : 1, has_previous: false, has_next: false },
      }) });
    }
    if (url.pathname === `/api/v1/wallet-copy/wallets/${SOURCE_ID}` && request.method() === "GET") {
      const activity = activityPage([event("SWAP_BUY"), event("TRANSFER_IN", 1)], { total: 26, hasMore: true, nextCursor: `123~swe_${"a".repeat(40)}` });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: "available", source_wallet_id: SOURCE_ID, profile: profile(), prospective_copyability: prospectiveCopyability(), recent_events: activity.events, activity, deep_history: deepHistory(), provider_request_performed: false }) });
    }
    if (url.pathname === `/api/v1/wallet-copy/wallets/${SOURCE_ID}/events` && request.method() === "GET") {
      const filter = url.searchParams.get("filter") || "all";
      const cursor = url.searchParams.get("cursor");
      const rows = filter === "unresolved"
        ? [event("AMBIGUOUS", 4)]
        : cursor
          ? [event("SWAP_SELL", 2), event("TRANSFER_OUT", 3)]
          : [event("SWAP_BUY"), event("TRANSFER_IN", 1)];
      const activity = activityPage(rows, {
        filter,
        total: filter === "unresolved" ? 1 : 26,
        hasMore: filter === "all" && !cursor,
        nextCursor: `123~swe_${"a".repeat(40)}`,
      });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: rows.length ? "available" : "empty", source_wallet_id: SOURCE_ID, ...activity }) });
    }
    if (url.pathname.endsWith("/saved-wallets") && request.method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: shared.saved?.length ? "available" : "empty", saves: shared.saved || [], lists: [] }) });
    }
    if (url.pathname.endsWith("/saved-wallets") && request.method() === "POST") {
      const body = JSON.parse(request.postData() || "{}");
      const existing = (shared.saved || []).find((row) => row.source_wallet_id === body.source_wallet_id && row.list_name === body.list_name);
      const save = existing || { save_id: `wrs_${"s".repeat(40)}`, source_wallet_id: body.source_wallet_id, list_name: body.list_name, label: body.label, source_wallet: { chain: "solana", network: "mainnet", address: WALLET }, created_at: "2026-08-29T12:00:00.000Z", updated_at: "2026-08-29T12:00:00.000Z", revision: 1, shadow_monitoring_started: false, execution_authorized: false };
      shared.saved = existing ? shared.saved : [...(shared.saved || []), save];
      return route.fulfill({ status: existing ? 200 : 201, contentType: "application/json", body: JSON.stringify({ ok: true, created: !existing, save }) });
    }
    if (url.pathname.includes("/saved-wallets/") && request.method() === "DELETE") {
      const saveId = url.pathname.split("/").pop();
      const before = (shared.saved || []).length;
      shared.saved = (shared.saved || []).filter((row) => row.save_id !== saveId);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, deleted: shared.saved.length < before }) });
    }
    if (url.pathname.endsWith("/inspect") && request.method() === "POST") {
      const inspectBody = JSON.parse(request.postData() || "{}");
      if (inspectBody.chain && inspectBody.chain !== "solana") {
        const transfer = evmTransfer();
        const activity = { ...activityPage([transfer]), scope: { on_demand_only: true, evidence_mode: "bounded_blockscout_index", provider_request_performed: true, history_complete_claimed: false, current_balance_claimed: false } };
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: "available", source_wallet_id: EVM_SOURCE_ID, profile: evmProfile(), recent_events: [transfer], activity, transaction_decode_candidates: [evmTransactionContext()], prospective_copyability: null, deep_history: { state: "not_enabled", history_complete_claimed: false }, persistence: { state: "on_demand_only", saved_to_raven_index: false, copy_eligible: false } }) });
      }
      const activity = activityPage([event("SWAP_BUY"), event("TRANSFER_IN", 1)], { total: 26, hasMore: true, nextCursor: `123~swe_${"a".repeat(40)}` });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: "available", source_wallet_id: SOURCE_ID, profile: profile(), prospective_copyability: prospectiveCopyability(), recent_events: activity.events, activity, deep_history: deepHistory() }) });
    }
    if (url.pathname.endsWith("/watches") && request.method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: shared.watch ? "available" : "empty", watches: shared.watch ? [shared.watch] : [] }) });
    }
    if (url.pathname.endsWith("/watches") && request.method() === "POST") {
      shared.watch = watch(false);
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, created: true, watch: shared.watch }) });
    }
    if (url.pathname === `/api/v1/wallet-copy/watches/${WATCH_ID}/refresh` && request.method() === "POST") {
      shared.watch = watch(true);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: "baseline_established", decisions: [], profile: profile() }) });
    }
    if (url.pathname === `/api/v1/wallet-copy/watches/${WATCH_ID}` && request.method() === "DELETE") {
      shared.watch = null;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, deleted: true }) });
    }
    if (url.pathname.endsWith("/decisions") && request.method() === "GET") {
      const sampleCount = shared.decision ? 1 : 0;
      const exitCount = shared.exitDecision ? 1 : 0;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: sampleCount || exitCount ? "available" : "empty", decisions: shared.decision ? [shared.decision] : [], exit_decisions: shared.exitDecision ? [shared.exitDecision] : [], copyability: shared.watch ? [{ watch_id: WATCH_ID, snapshot: { state: "insufficient_evidence", score: null, prospective_sample_count: sampleCount, components: { policy_pass_pct: 0, entry_executable_pct: 100, exit_executable_pct: 0, median_entry_degradation_bps: 42 } }, by_size: [25, 100, 500, 1000, 5000].map((size) => ({ order_size_usdc: size, state: "insufficient_evidence", score: null, prospective_sample_count: size === 100 ? sampleCount : 0, components: {} })) }] : [] }) });
    }
    if (url.pathname.endsWith("/positions") && request.method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: shared.position ? "available" : "empty", positions: shared.position ? [shared.position] : [] }) });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false, error: "not_found" }) });
  });
}

test("an unavailable session check does not present a signed-in user as signed out", async ({ page }) => {
  const shared = { watch: null, decision: null, position: null, requests: [] };
  await install(page, shared);
  await page.route("**/api/v1/auth/session", route => route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({ok:false,error:"account_service_unavailable"})}));
  await page.goto("/account/copy/");
  await expect(page.locator("#copyUnavailable")).toBeVisible();
  await expect(page.locator("#copySignIn")).toBeHidden();
  await expect(page.locator("#copyUnavailableReason")).toContainText("Your session could not be checked");
  expect(shared.requests.some(row=>row.path.endsWith("/inspect"))).toBe(false);
});

test("signed-out visitors see auth while free accounts receive the basic wallet workspace", async ({ page }) => {
  const signedOut = { watch: null, decision: null, position: null, requests: [] };
  await install(page, signedOut, { authenticated: false });
  const authRequests = [];
  let downloaded = false;
  page.on("download", () => { downloaded = true; });
  await page.route("**/api/v1/auth/start", async (route) => {
    authRequests.push({ method: route.request().method(), body: route.request().postDataJSON() });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, authorization_url: "https://api.workos.com/user_management/authorize?client_id=client_test" }),
    });
  });
  await page.route("https://api.workos.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Secure sign-in</title>" }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/account/copy/?wallet=${EVM_WALLET}&chain=bsc`);
  await expect(page.locator(".copy-page")).toHaveAttribute("data-copy-state", "signed-out");
  await expect(page.getByRole("heading", { name: "Sign in to inspect wallets." })).toBeVisible();
  expect(signedOut.requests).toHaveLength(0);
  await page.getByRole("button", { name: /Email, password, or code/ }).click();
  await page.waitForURL(/^https:\/\/api\.workos\.com\/user_management\/authorize/);
  expect(downloaded).toBe(false);
  expect(authRequests).toEqual([{
    method: "POST",
    body: { intent: "sign_in", provider: "managed", return_to: `/account/copy/?wallet=${EVM_WALLET}&chain=bsc` },
  }]);

  const privatePage = await page.context().newPage();
  const denied = { watch: null, decision: null, position: null, requests: [] };
  await install(privatePage, denied, { authenticated: true, entitled: false });
  await privatePage.goto("/account/copy/");
  await expect(privatePage.locator(".copy-page")).toHaveAttribute("data-copy-state", "active");
  await expect(privatePage.locator(".copy-page")).toHaveAttribute("data-access-tier", "free");
  await expect(privatePage.getByText("Wallet lookup + Raven Copy", { exact: true })).toBeVisible();
  await expect(privatePage.getByText("Headline wallet screening and Raven Copy are free.")).toBeVisible();
  await expect(privatePage.locator("#copyPresetRail")).not.toBeVisible();
});

test("Pro user inspects source evidence, saves a private policy, and establishes a non-executable baseline", async ({ page }) => {
  const shared = { watch: null, decision: null, position: null, requests: [] };
  await install(page, shared);
  await page.goto("/account/copy/");
  await expect(page.locator(".copy-page")).toHaveAttribute("data-copy-state", "active");
  await expect(page.getByText("Pro intelligence ready")).toBeVisible();
  await page.getByLabel("Paste an address").fill(WALLET);
  await page.getByRole("button", { name: "Analyze wallet" }).click();
  await expect(page.getByText("Source performance", { exact: true })).toBeVisible();
  await expect(page.locator("#copyProfile").getByText("Follower reality", { exact: true })).toBeVisible();
  await expect(page.locator("#copySourcePnl")).toHaveText("+$428 realized");
  await expect(page.getByText("Indexing older activity", { exact: true })).toBeVisible();
  await expect(page.getByText("700 transaction references · 694 decoded · 7 pages", { exact: true })).toBeVisible();
  await expect(page.getByText("Transfer In")).toBeVisible();
  await page.getByRole("button", { name: "Copy this wallet" }).click();
  await expect(page.locator("#copyPolicyFee")).toHaveText("1.00% · simulated in Shadow");
  await expect(page.locator("#copyPolicyCashback")).toContainText("Shadow results exclude cashback and earn no rewards");
  await page.getByRole("button", { name: "Start Raven Copy" }).click();
  await expect(page.getByRole("heading", { name: "Copied wallets" })).toBeVisible();
  await expect(page.getByText("First check needed")).toBeVisible();
  await expect(page.locator(".copy-card img, .copy-card script")).toHaveCount(0);
  expect(await page.evaluate(() => window.__copyExecuted === true)).toBe(false);

  const create = shared.requests.find((row) => row.method === "POST" && row.path.endsWith("/watches"));
  expect(create.headers["x-ravenos-csrf"]).toBe("csrf_wallet_copy");
  const createdBody = JSON.parse(create.body);
  expect(createdBody.address).toBe(WALLET);
  expect(createdBody.policy.hypothetical_raven_fee_bps).toBe(100);
  expect(create.body).not.toMatch(/private.?key|seed.?phrase|sign(?:ed|ature)|transaction.?material/i);

  await page.getByRole("button", { name: "Build baseline" }).click();
  await expect(page.getByText("Ready for new trades")).toBeVisible();
  const refresh = shared.requests.find((row) => row.path.endsWith("/refresh"));
  expect(refresh.headers["x-ravenos-csrf"]).toBe("csrf_wallet_copy");
  expect(refresh.body).toBe("{}");
  expect(await page.evaluate(() => window.RavenOSWalletCopy)).toEqual({
    schemaVersion: "ravenos.wallet_copy_surface.v1",
    accessModel: { authenticatedBasics: true, copySubscriptionRequired: false, advancedIntelligence: "raven_pro" },
    liveCopy: false,
    manualCopy: true,
    signing: false,
    broadcasting: false,
    feeCollection: false,
  });
  await captureVisual(page, "wallet-copy-desktop-1440");
});

test("BNB lookup renders provider balances and transfer evidence without pretending it is copy-ready", async ({ page }) => {
  const shared = { watch: null, decision: null, position: null, requests: [] };
  await install(page, shared);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/account/copy/");
  await page.locator("#copyWalletChain").selectOption("bsc");
  await expect(page.getByLabel("Paste an address")).toHaveAttribute("maxlength", "42");
  await page.getByLabel("Paste an address").fill(EVM_WALLET);
  await page.getByRole("button", { name: "Analyze wallet" }).click();
  await page.locator("#copyRavenEvidence > summary").click();
  await expect(page.locator("#copySourcePnl")).toHaveText("Insufficient evidence");
  await expect(page.locator("#copyProfileCoverage")).toContainText("123 tx reported · trades not decoded");
  await expect(page.locator("#copySourceMetrics")).toContainText("Recent transfers");
  await expect(page.locator("#copySourceMetrics")).toContainText("Provider tx count");
  await expect(page.locator("#copyBehaviorMetrics")).toContainText("Inbound transfers");
  await expect(page.locator("#copyBehaviorMetrics")).toContainText("Trade interpretation");
  await expect(page.locator("#copyBehaviorMetrics")).toContainText("Not decoded");
  await expect(page.locator("#copyBehaviorMetrics")).toContainText("Route-decode candidates");
  await expect(page.locator("#copyEvmTransactionContext")).toBeVisible();
  await expect(page.locator("#copyEvmContextCount")).toHaveText("1 of 1 inspected");
  await expect(page.locator("#copyEvmContextRows")).toContainText("Provider method: swapExactTokensForTokens");
  await expect(page.locator("#copyEvmContextRows")).toContainText("Raven trade verdict");
  await expect(page.locator("#copyEvmContextRows")).toContainText("Unresolved");
  await expect(page.getByRole("button", { name: "No copy signal" })).toBeDisabled();
  await expect(page.locator("#copyCapitalMetrics")).toContainText("Visible provider mark");
  await expect(page.locator("#copyCapitalMetrics")).toContainText("$2.50");
  await expect(page.locator("#copyCapitalMetrics")).toContainText("100.00% · USDC");
  await expect(page.locator("#copySaveProfile")).toHaveText("Refresh scan");
  await expect(page.locator("#copySaveProfile")).toBeEnabled();
  await page.locator("#copySaveProfile").click();
  await expect(page.locator("#copySaveProfile")).toHaveText("Refresh scan");
  await expect(page.locator("#copySearchStatus")).toContainText("On-demand evidence ready");
  await expect(page.locator("#copyOpenPositions")).toContainText("2.5 held · $1.00 provider mark · basis unavailable");
  await expect(page.getByText("Transfer In", { exact: true })).toBeVisible();
  await expect(page.locator("#copyRecentEvents").getByText("2.5 USDC", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Route proof pending" })).toBeDisabled();
  const inspectRequest = shared.requests.find((row) => row.path.endsWith("/inspect"));
  expect(JSON.parse(inspectRequest.body)).toEqual({ address: EVM_WALLET, chain: "bsc" });
  const overflow = await page.evaluate(() => [...document.querySelectorAll("body *")]
    .filter((node) => node.getBoundingClientRect().right > innerWidth + 1)
    .map((node) => `${node.tagName.toLowerCase()}.${node.className || ""}`));
  expect(overflow).toEqual([]);
});

test("Raven-indexed screener exposes honest evidence and opens a retained profile without another live lookup", async ({ page }) => {
  const shared = { watch: null, decision: null, position: null, requests: [] };
  await install(page, shared);
  await page.goto("/account/copy/");
  await expect(page.getByRole("heading", { name: "Find reconstructable edge." })).toBeVisible();
  await expect(page.getByText("Broad source profits · intraday", { exact: true })).toBeVisible();
  await expect(page.getByText(/Watch: Only 71.4% of observed trade cost basis is known/)).toBeVisible();
  await expect(page.getByText("Follower $100", { exact: true })).toBeVisible();
  await expect(page.getByText("+4.82% at +1h · 83.33% routed", { exact: true })).toBeVisible();
  await expect(page.getByText("Alpha retained · +1h", { exact: true })).toBeVisible();
  await expect(page.getByText("58.40% · 11 positive-source samples", { exact: true })).toBeVisible();
  await expect(page.getByText("At Raven detection", { exact: true })).toBeVisible();
  await expect(page.getByText("$750K cap · $125K liq · 1h pair", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("#copySavedWallets").getByText(WALLET, { exact: true })).toBeVisible();
  const saveRequest = shared.requests.find((row) => row.method === "POST" && row.path.endsWith("/saved-wallets"));
  expect(saveRequest.headers["x-ravenos-csrf"]).toBe("csrf_wallet_copy");
  expect(JSON.parse(saveRequest.body)).toEqual({ source_wallet_id: SOURCE_ID, list_name: "Research", label: WALLET });
  expect(shared.watch).toBeNull();
  await captureVisual(page, "wallet-copy-screener-desktop-1440");
  await page.getByRole("button", { name: "Open analysis" }).click();
  await expect(page.getByText("Raven research thesis", { exact: true })).toBeVisible();
  const thesis = page.getByLabel("Raven wallet research thesis");
  await expect(thesis.getByText("What supports it", { exact: true })).toBeVisible();
  await expect(thesis.getByText("What could mislead", { exact: true })).toBeVisible();
  await expect(thesis.getByText("What Raven needs next", { exact: true })).toBeVisible();
  await expect(page.getByText("25 USDC", { exact: true })).toBeVisible();
  await expect(page.getByText("How returns were made", { exact: true })).toBeVisible();
  await expect(page.getByText("How much Raven knows", { exact: true })).toBeVisible();
  await expect(page.getByText("Last observed, never implied current", { exact: true })).toBeVisible();
  await expect(page.locator("#copyFollowerHeadline")).toHaveText("24 wallet trades · 120 exact follower routes · 18 +1h outcomes");
  await expect(page.locator("#copyPlaybookState")).toHaveText("Size-sensitive");
  await expect(page.locator("#copyPlaybookHeadline")).toHaveText("Routes weaken above $500");
  await expect(page.locator("#copyPlaybookSummary")).toContainText("66.67% pass · 24 buys · $100");
  await expect(page.locator("#copyPlaybookSize")).toHaveText("$25–$500 majority-pass");
  await expect(page.locator("#copyPlaybookMarket")).toHaveText("$200K–$750K cap");
  await expect(page.locator("#copyPlaybookPersistence")).toHaveText("83.33% still routable");
  await expect(page.locator("#copyPlaybookConstraint")).toHaveText("Reverse Exit Unavailable");
  await expect(page.locator("#copyPlaybook")).toContainText("Not financial advice");
  await expect(page.locator("#copyFollowerMetrics").getByText("Route still available · +1h", { exact: true })).toBeVisible();
  await expect(page.locator("#copyFollowerMetrics").getByText("+4.82%", { exact: true })).toBeVisible();
  await expect(page.locator("#copyFollowerMetrics").getByText("58.40%", { exact: true })).toBeVisible();
  await expect(page.locator("#copyCapacityRail").getByText("24 routes · 18 +1h", { exact: true }).first()).toBeVisible();
  await expect(page.locator("#copyRefusalLabel")).toHaveText("Leading blocker · $100");
  await expect(page.locator("#copyRefusalHeadline")).toHaveText("Reverse Exit Unavailable");
  await expect(page.locator("#copyRefusalDetail")).toContainText("5/24 routes");
  await expect(page.locator("#copySizeStressHeadline")).toHaveText("Majority drops at $1,000");
  await expect(page.locator("#copySizeStressDetail")).toContainText("24/24 signals · five sizes · isolated quotes");
  await expect(page.locator("#copyCrowdingStressHeadline")).toHaveText("71% held under load");
  await expect(page.locator("#copyCrowdingStressDetail")).toContainText("24 signals");
  await expect(page.locator("#copyCrowdingStressDetail")).toContainText("demand private");
  await expect(page.locator("#copyMarketFit").getByText("Where the route survives", { exact: true })).toBeVisible();
  await expect(page.locator("#copyMarketFit").getByText("$200K–$750K", { exact: true })).toBeVisible();
  await expect(page.locator("#copyMarketFit").getByText("$100K–$500K", { exact: true })).toBeVisible();
  await expect(page.locator("#copyMarketFit").getByText("1h–24h", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save wallet" })).toBeVisible();
  await expect(page.locator("#copyEventCount")).toHaveText("2 of 26 retained");
  await page.getByRole("button", { name: "Load older" }).click();
  await expect(page.locator("#copyEventCount")).toHaveText("4 of 26 retained");
  await expect(page.getByText("Swap Sell", { exact: true })).toBeVisible();
  const pagedActivity = [...shared.requests].reverse().find((row) => row.path.endsWith("/events"));
  expect(new URLSearchParams(pagedActivity.search).has("cursor")).toBe(true);
  await page.getByLabel("Wallet activity filter").selectOption("unresolved");
  await expect(page.locator("#copyEventCount")).toHaveText("1 of 1 retained");
  await expect(page.getByText("Ambiguous", { exact: true })).toBeVisible();
  await expect(page.getByText("End of retained index.")).toBeVisible();
  await expect(page.getByRole("link", { name: /View transaction/ })).toHaveAttribute("href", /solscan\.io\/tx\//);
  await captureVisual(page, "wallet-intelligence-profile-desktop-1440");
  const detailRequest = shared.requests.find((row) => row.path === `/api/v1/wallet-copy/wallets/${SOURCE_ID}`);
  expect(detailRequest.method).toBe("GET");
  expect(shared.requests.filter((row) => row.path.endsWith("/inspect"))).toHaveLength(0);
  const screenerRequest = shared.requests.find((row) => row.path.endsWith("/screener"));
  expect(screenerRequest.headers["x-ravenos-csrf"]).toBe("csrf_wallet_copy");
  expect(JSON.parse(screenerRequest.body).filters.min_known_cost_basis_pct).toBeNull();
  await page.getByRole("button", { name: /Consistent winners/ }).click();
  const presetRequest = [...shared.requests].reverse().find((row) => row.path.endsWith("/screener"));
  expect(JSON.parse(presetRequest.body).preset).toBe("consistent_winners");
  expect(new URL(page.url()).searchParams.get("screen")).toBe("consistent_winners");
});

test("wallet screener switches to a bounded Robinhood index without turning unavailable evidence into zero", async ({ page }) => {
  const shared = { watch: null, decision: null, position: null, requests: [] };
  await install(page, shared);
  await page.goto("/account/copy/");
  await page.getByRole("button", { name: "Robinhood", exact: true }).click();
  await expect(page.locator("#copyScreenerCount")).toHaveText("0 matches");
  await expect(page.locator("#copyScreenerStatus")).toContainText("No matching wallet in Robinhood Chain.");
  await expect(page.getByText("Adjust filters or inspect an address. Only retained evidence is included.")).toBeVisible();
  const request = [...shared.requests].reverse().find((row) => row.path.endsWith("/screener"));
  expect(JSON.parse(request.body)).toMatchObject({ chain: "robinhood", network: "mainnet" });
  expect(new URL(page.url()).searchParams.get("chain")).toBe("robinhood");
});

test("wallet screener can query all supported indexes without merging wallet identity", async ({ page }) => {
  const shared = { watch: null, decision: null, position: null, requests: [] };
  await install(page, shared);
  await page.goto("/account/copy/");
  await expect(page.getByRole("button", { name: "All chains", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#copyScreenerStatus")).toContainText("All indexed chains");
  await expect(page.getByText("Broad source profits · intraday", { exact: true })).toBeVisible();
  const request = [...shared.requests].reverse().find((row) => row.path.endsWith("/screener"));
  expect(JSON.parse(request.body)).toMatchObject({ chain: "all", network: "mainnet" });
  expect(new URL(page.url()).searchParams.get("chain")).toBeNull();
});

test("seen wallets populate across chains without starting provider lookups and can be narrowed", async ({ page }) => {
  const shared = { watch: null, decision: null, position: null, requests: [] };
  await install(page, shared);
  const queries = [];
  await page.route("**/api/v1/wallet-copy/screener", async route => {
    const query = route.request().postDataJSON();
    queries.push(query);
    const seen = [
      { source_wallet_id: SOURCE_ID, source_wallet: { chain: "solana", address: WALLET }, last_observed_at: "2026-09-06T12:00:00Z" },
      { source_wallet_id: EVM_SOURCE_ID, source_wallet: { chain: "base", address: EVM_WALLET }, last_observed_at: "2026-09-06T11:00:00Z" },
    ].filter(row => query.chain === "all" || row.source_wallet.chain === query.chain);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, rows: [], scope: { chain: query.chain },
      pagination: { page: 1, page_size: 12, total_matching_rows: 0, total_pages: 0 },
      index_coverage: { chains: [{ chain: "solana", seen_wallets: 1, indexed_wallets: 0 }, { chain: "base", seen_wallets: 1, indexed_wallets: 0 }] },
      seen_wallets: { rows: seen, total: seen.length, performance_filters_applied: false, provider_request_performed: false } }) });
  });
  await page.goto("/account/copy/");
  await expect(page.locator("#copySeenResults .copy-seen-wallet")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Observed wallets", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#copyScreenerCount")).toHaveText("2 observed");
  await expect(page.locator("#copyScreenerFilters")).toBeHidden();
  await expect(page.locator("#copyPresetRail")).toBeHidden();
  expect(queries[0].chain).toBe("all");
  expect(shared.requests.some(row => row.path.endsWith("/inspect"))).toBe(false);
  await expect(page.locator("#copySeenWallets")).toContainText("do not prove profitability or copyability");
  await page.getByRole("button", { name: "Base", exact: true }).click();
  await expect(page.locator("#copySeenResults .copy-seen-wallet")).toHaveCount(1);
  await expect(page.locator("#copySeenResults")).toContainText("Base");
  expect(shared.requests.some(row => row.path.endsWith("/inspect"))).toBe(false);
  await page.getByRole("button", { name: "Solana", exact: true }).click();
  await page.locator("#copySeenResults").getByRole("button", { name: "Inspect wallet" }).click();
  await expect(page.locator("#copyProfile")).toBeVisible();
  expect(JSON.parse(shared.requests.find(row => row.path.endsWith("/inspect")).body)).toMatchObject({ address: WALLET, chain: "solana" });
});

test("Raven Copy has a direct navigation target", async ({ page }) => {
  const shared = { watch: null, decision: null, position: null, requests: [] };
  await install(page, shared);
  await page.goto("/account/copy/?view=watching");
  await expect(page.locator('[data-copy-panel="watching"]')).toBeVisible();
  await expect(page.getByRole("tab", { name: /Raven Copy/ })).toHaveAttribute("aria-selected", "true");
});

test("the shared wallet universe exposes hundreds of pages without triggering analysis", async ({ page }) => {
  const shared = { watch: null, decision: null, position: null, requests: [] };
  await install(page, shared);
  await page.route("**/api/v1/wallet-copy/screener", async route => {
    const query=route.request().postDataJSON();
    await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({ok:true,rows:[],scope:{chain:"all"},
      pagination:{page:query.page,page_size:12,total_matching_rows:0,total_pages:0,maximum_page:1000},
      seen_wallets:{rows:[{source_wallet_id:SOURCE_ID,source_wallet:{chain:"solana",address:WALLET},last_observed_at:"2026-09-07T12:00:00Z"}],total:6000,provider_request_performed:false}})});
  });
  await page.goto("/account/copy/");
  await expect(page.locator("#copyScreenPage")).toHaveText("Page 1 of 500");
  await page.locator("#copyScreenNext").click();
  await expect(page.locator("#copyScreenPage")).toHaveText("Page 2 of 500");
  await page.getByRole("button", { name: "Analyzed profiles", exact: true }).click();
  await expect(page.locator("#copySeenWallets")).toBeHidden();
  await expect(page.locator("#copyScreenerFilters")).toBeVisible();
  await expect(page.locator("#copyScreenerCount")).toHaveText("0 matches");
  await expect(page.locator("#copyScreenerPages")).toBeHidden();
  await expect(page.locator("#copyScreenerResults")).toContainText("No matching wallet evidence");
  await page.getByRole("button", { name: "Observed wallets", exact: true }).click();
  await expect(page.locator("#copyScreenPage")).toHaveText("Page 1 of 500");
  await expect(page.locator("#copyScreenerCount")).toHaveText("6,000 observed");
  await page.reload();
  await expect(page.getByRole("button", { name: "Observed wallets", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#copyScreener").scrollIntoViewIfNeeded();
  const layout = await page.evaluate(() => ({
    seenBeforeSaved: document.getElementById("copySeenWallets").getBoundingClientRect().top < document.querySelector(".copy-saved-research").getBoundingClientRect().top,
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
  }));
  expect(layout).toEqual({seenBeforeSaved:true,overflow:false});
  await captureVisual(page, "wallet-universe-observed-mobile-390");
  expect(shared.requests.some(row=>row.path.endsWith("/inspect"))).toBe(false);
});

test("mobile wallet screener keeps filters, source evidence, and analysis controls contained", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const shared = { watch: null, decision: null, position: null, requests: [] };
  await install(page, shared);
  await page.goto("/account/copy/");
  await expect(page.getByRole("heading", { name: "Find reconstructable edge." })).toBeVisible();
  await page.getByLabel("Sort").selectOption("trade_count_desc");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("button", { name: "Open analysis" })).toBeVisible();
  const overflow = await page.evaluate(() => [...document.querySelectorAll("body *")]
    .filter((node) => node.getBoundingClientRect().right > innerWidth + 1)
    .map((node) => `${node.tagName.toLowerCase()}.${node.className || ""}`));
  expect(overflow).toEqual([]);
  const latest = [...shared.requests].reverse().find((row) => row.path.endsWith("/screener"));
  expect(JSON.parse(latest.body).sort).toBe("trade_count_desc");
  await captureVisual(page, "wallet-copy-screener-mobile-390");
  await page.getByRole("button", { name: "Open analysis" }).click();
  await expect(page.getByText("How the wallet trades", { exact: true })).toBeVisible();
  const profileOverflow = await page.evaluate(() => [...document.querySelectorAll("#copyProfile *")]
    .filter((node) => node.getBoundingClientRect().right > innerWidth + 1)
    .map((node) => `${node.tagName.toLowerCase()}.${node.className || ""}`));
  expect(profileOverflow).toEqual([]);
  await captureVisual(page, "wallet-intelligence-profile-mobile-390");
});

test("wallet handoff pre-fills and inspects the exact public address after Pro authentication", async ({ page }) => {
  const shared = { watch: null, decision: null, position: null, requests: [] };
  await install(page, shared);
  await page.goto(`/account/copy/?wallet=${WALLET}`);
  await expect(page.getByLabel("Paste an address")).toHaveValue(WALLET);
  await expect(page.getByText("Analysis ready.")).toBeVisible();
  const inspectRequest = shared.requests.find((row) => row.path.endsWith("/inspect"));
  expect(JSON.parse(inspectRequest.body).address).toBe(WALLET);
});

test("mobile shadow feed keeps refusals visible, separates positions, and never overflows", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const hostileWatch = watch(true);
  hostileWatch.label = '<img src=x onerror="window.__copyExecuted=true">Momentum source';
  const shared = { watch: hostileWatch, decision: decision(), exitDecision: exitDecision(), position: position(), requests: [] };
  await install(page, shared);
  await page.goto("/account/copy/");
  await page.getByRole("tab", { name: /Shadow feed/ }).click();
  await expect(page.getByText("Exit Unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText("Reverse Exit Unavailable")).toBeVisible();
  await expect(page.getByText("Current exit")).toBeVisible();
  await expect(page.getByText("Unavailable", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("$0.00", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Source sell · Shadow Exit Executable", { exact: true })).toBeVisible();
  await expect(page.getByText("40.00%", { exact: true })).toBeVisible();
  await expect(page.getByText("32500 4M7YQq…ePoaBn", { exact: true })).toBeVisible();
  await expect(page.getByText("1 Raven lot mapped · no funds moved", { exact: true })).toBeVisible();
  await captureVisual(page, "wallet-copy-mobile-shadow-390");
  await page.getByRole("tab", { name: /Positions/ }).click();
  await expect(page.getByText("Shadow Partial Exit")).toBeVisible();
  await expect(page.getByText("48750 4M7YQq…ePoaBn", { exact: true })).toBeVisible();
  await expect(page.locator("#copyPositions").getByText("$41", { exact: true })).toBeVisible();
  await expect(page.getByText("No funds moved", { exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => [...document.querySelectorAll("body *")]
    .filter((node) => node.getBoundingClientRect().right > innerWidth + 1)
    .map((node) => `${node.tagName.toLowerCase()}.${node.className || ""}`));
  expect(overflow).toEqual([]);
  expect(await page.evaluate(() => window.__copyExecuted === true)).toBe(false);
  await expect(page.locator(".copy-boundary").getByText("User confirms", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /start live|copy now|execute/i })).toHaveCount(0);
});

test("an approved Raven Copy decision opens an exact prefilled terminal review", async ({ page }) => {
  const shared = { watch: watch(true), decision: decision("SHADOW_EXECUTABLE"), position: position(), requests: [] };
  await install(page, shared);
  await page.goto("/account/copy/");
  await page.getByRole("tab", { name: /Shadow feed/ }).click();
  const review = page.getByRole("link", { name: "Review copy in Terminal" });
  await expect(review).toBeVisible();
  const href = await review.getAttribute("href");
  const url = new URL(href, "https://app.ravenos.xyz");
  expect(url.pathname).toBe("/terminal/");
  expect(url.searchParams.get("instrument_id")).toBe(`solana:pool:${WALLET}`);
  expect(url.searchParams.get("token_address")).toBe(TOKEN);
  expect(url.searchParams.get("copy_amount_usdc")).toBe("100");
  expect(url.searchParams.get("copy_decision_id")).toBe("scd_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  expect(url.searchParams.get("panel")).toBe("trade");
});

test("free wallets show observed holdings and keep advanced discovery hidden", async ({ page }) => {
  const shared = { requests: [] };
  await install(page, shared, { entitled: false });
  await page.goto(`/account/copy/?wallet=${EVM_WALLET}&chain=bsc`);
  await expect(page.locator("#copyHoldingsTable")).toContainText("USDC");
  await expect(page.locator("#copyHoldingsTable")).toContainText("2.5");
  await expect(page.locator('[data-discovery-field="mooner_tokens"]')).toBeHidden();
  await expect(page.locator("#copyStartSetup")).toBeDisabled();
});

test("Pro discovery filter values survive reload and use the selected chain", async ({ page }) => {
  const shared = { requests: [] };
  await install(page, shared);
  await page.goto("/account/copy/");
  await expect(page.locator("#copyScreener")).toBeVisible();
  await page.locator('details').filter({ has: page.locator('[data-discovery-field="trades_1d"]') }).locator('summary').click();
  await page.locator('[data-discovery-field="trades_1d"]').fill("8");
  await page.locator('[data-discovery-field="loss_75_pct"]').fill("12");
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  await expect(page).toHaveURL(/df_trades_1d_gte=8/);
  await page.locator('[data-screen-chain="base"]').click();
  await expect.poll(() => JSON.parse(shared.requests.filter((row) => row.path.endsWith('/screener')).at(-1).body).chain).toBe("base");
  const query = JSON.parse(shared.requests.filter((row) => row.path.endsWith('/screener')).at(-1).body);
  expect(query.clauses).toEqual(expect.arrayContaining([{ field: "trades_1d", operator: "gte", value: 8 }, { field: "loss_75_pct", operator: "lte", value: 12 }]));
  await page.reload();
  await expect(page.locator('[data-discovery-field="trades_1d"]')).toHaveValue("8");
});

test("wallet chain preference survives a fresh visit and an explicit shared URL overrides it", async ({ page }) => {
  const shared = { requests: [] };
  await install(page, shared);
  await page.goto('/account/copy/');
  await page.locator('[data-screen-chain="base"]').click();
  await page.goto('/account/copy/');
  await expect(page.locator('[data-screen-chain="base"]')).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/account/copy/?chain=solana');
  await expect(page.locator('[data-screen-chain="solana"]')).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/account/copy/');
  await expect(page.locator('[data-screen-chain="base"]')).toHaveAttribute('aria-pressed', 'true');
});

test("wallet discovery and copy setup remain readable on mobile", async ({ page }) => {
  const shared = { requests: [] };
  await install(page, shared);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/account/copy/?wallet=${WALLET}`);
  await expect(page.locator("#copyProfile")).toBeVisible();
  await page.locator("#copyStartSetup").click();
  await expect(page.locator("#copyPolicySource")).toContainText(WALLET);
  await expect(page.locator("#copyPolicy")).toContainText("Shadow mode. Review and sign trades.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect.poll(() => page.locator("#copyPolicy").evaluate((node) => Math.round(node.getBoundingClientRect().top))).toBeLessThan(150);
  if (process.env.RAVENOS_VISUAL_ARTIFACT_DIR) await page.screenshot({ path: `${process.env.RAVENOS_VISUAL_ARTIFACT_DIR}/RavenOS-wallet-copy-mobile.png` });
});

test("a late inspection cannot replace the wallet opened from discovery or its copy source", async ({ page }) => {
  const shared = { requests: [] };
  await install(page, shared);
  let release;
  await page.route("**/api/v1/wallet-copy/inspect", async (route) => {
    await new Promise((resolve) => { release = resolve; });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profile: profile(), source_wallet_id: SOURCE_ID }) });
  });
  const secondAddress = "So11111111111111111111111111111111111111112";
  await page.route(`**/api/v1/wallet-copy/wallets/${SOURCE_ID}`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ source_wallet_id: SOURCE_ID, profile: { ...profile(), source_wallet: { chain: "solana", network: "mainnet", address: secondAddress } } }) }));
  await page.goto("/account/copy/");
  await page.getByLabel("Paste an address").fill(WALLET);
  await page.getByRole("button", { name: "Analyze wallet", exact: true }).click();
  await expect.poll(() => typeof release).toBe("function");
  await page.getByRole("button", { name: "Open analysis", exact: true }).first().click();
  await expect(page.getByLabel("Paste an address")).toHaveValue(secondAddress);
  release();
  await expect(page.getByRole("button", { name: "Analyze wallet", exact: true })).toBeEnabled();
  await page.locator("#copyStartSetup").click();
  await expect(page.locator("#copyPolicySource")).toContainText(secondAddress);
  await expect(page.locator("#copyPolicySource")).not.toContainText(WALLET);
});


test("history status refresh reads the shared index without requesting fresh provider history", async ({ page }) => {
  const shared = { watch: null, decision: null, position: null, requests: [] };
  await install(page, shared);
  await page.goto(`/account/copy/?wallet=${WALLET}&chain=solana`);
  await expect(page.locator("#copyProfile")).toBeVisible();
  const calls = shared.requests.filter(row => row.path.endsWith("/inspect")).length;
  await page.getByRole("button", { name: "Copy this wallet", exact: true }).click();
  await page.getByRole("button", { name: "Refresh history status", exact: true }).click();
  await expect.poll(() => shared.requests.filter(row => row.path === `/api/v1/wallet-copy/wallets/${SOURCE_ID}`).length).toBeGreaterThan(0);
  expect(shared.requests.filter(row => row.path.endsWith("/inspect")).length).toBe(calls);
  await expect(page.locator("#copyWalletAddress")).toHaveValue(WALLET);
  await page.getByRole("button", { name: "Start Raven Copy", exact: true }).click();
  await expect.poll(() => shared.requests.some(row => row.path.endsWith("/watches") && row.method === "POST")).toBe(true);
});

async function observedEvidenceFixture(page, queries) {
  await page.route("**/api/v1/wallet-copy/screener", async route => {
    const query=route.request().postDataJSON();queries.push(query);
    const market={chain:"base",pool_address:`0x${"ab".repeat(20)}`,token_address:EVM_TOKEN,quote_token_address:`0x${"cd".repeat(20)}`,instrument_id:`base:pool:0x${"ab".repeat(20)}`};
    await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({ok:true,rows:[],scope:{chain:query.chain},
      pagination:{page:query.page,page_size:12,total_matching_rows:0,total_pages:0,maximum_page:1000},
      index_coverage:{chains:[{chain:"base",seen_wallets:1540,indexed_wallets:12},{chain:"solana",seen_wallets:1270,indexed_wallets:2}]},
      seen_wallets:{total:24,market_evidence_enabled:true,provider_request_performed:false,rows:[
        {source_wallet_id:EVM_SOURCE_ID,source_wallet:{chain:"base",address:EVM_WALLET},history_available:true,last_observed_at:"2026-09-07T18:00:00Z",
          market_evidence:{state:"available",observed_market_count:2,busiest_pool_transactions:8,two_sided_pool_observed:true,
            samples:[{market,unique_transactions:8,buy_transactions:5,sell_transactions:3,largest_sampled_swap_usd_micros:"149123456",window:{last_observed_at:"2026-09-07T18:00:00Z"}}]}},
        {source_wallet_id:SOURCE_ID,source_wallet:{chain:"solana",address:WALLET},history_available:false,last_observed_at:"2026-09-07T17:00:00Z",market_evidence:{state:"not_observed",samples:[]}}
      ]}})});
  });
}

test('legacy automatic saved labels render full wallets while custom labels stay intact', async ({page}) => {
  const shared={requests:[],saved:[
    {save_id:'sws_legacy',source_wallet_id:SOURCE_ID,list_name:'Research',label:`${WALLET.slice(0,6)}…${WALLET.slice(-6)}`,source_wallet:{chain:'solana',address:WALLET}},
    {save_id:'sws_custom',source_wallet_id:EVM_SOURCE_ID,list_name:'Research',label:'My long-term research',source_wallet:{chain:'base',address:EVM_WALLET}}
  ]};
  await install(page,shared);await page.goto('/account/copy/');
  await expect(page.locator('#copySavedWallets')).toContainText(WALLET);
  await expect(page.locator('#copySavedWallets')).not.toContainText('…');
  await expect(page.locator('#copySavedWallets')).toContainText('My long-term research');
  await expect(page.locator('#copySavedWallets')).toContainText(EVM_WALLET);
});

test('Solana token metadata labels activity and marks without manufacturing unrealized profit', async ({page}) => {
  const shared={requests:[]};await install(page,shared);
  const enriched=profile();
  enriched.token_metadata={rows:[{mint:TOKEN,symbol:'EXAMPLE',decimals:6}],price_cache_seconds:600};
  enriched.holdings_snapshot={address:WALLET,chain:'solana',state:'available',observed_at:'2026-08-29T12:00:00Z',native:{amount:1},
    provider_balance_summary:{visible_provider_mark_value_usd:'0.000202'},tokens:[{mint:TOKEN,symbol:'EXAMPLE',balance_display:'81',provider_mark_price_usd:'0.0000025',provider_mark_value_usd:'0.000202'}]};
  await page.route('**/api/v1/wallet-copy/inspect',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,source_wallet_id:SOURCE_ID,profile:enriched,recent_events:[event()]})}));
  await page.goto(`/account/copy/?wallet=${WALLET}&chain=solana`);
  await expect(page.locator('#copyHoldingsTable')).toContainText('EXAMPLE');
  await expect(page.locator('#copyHoldingsTable')).toContainText('$0.0000025');
  await expect(page.locator('#copyHoldingsTable')).toContainText('Not reconstructed');
  await expect(page.locator('#copyRecentEvents')).toContainText('81 EXAMPLE');
  await expect(page.locator('#copyHoldingsScope')).toContainText('Cached indicative marks, not exit quotes');
});

test("observed-wallet context filters cached samples, links exact markets and stays contained on mobile", async ({page}) => {
  const shared={watch:null,decision:null,position:null,requests:[]},queries=[];
  await install(page,shared,{marketEvidence:true});await observedEvidenceFixture(page,queries);
  await page.goto("/account/copy/?wallets=observed");
  await expect(page.locator("#copyObservedSignal")).toBeVisible();
  await expect(page.locator("#copySeenResults")).toContainText("Busiest pool · transactions");
  await expect(page.locator("#copySeenResults")).toContainText("This does not mean the wallet was inactive.");
  await page.locator("#copyScreenNext").click();await expect(page.locator("#copyScreenPage")).toHaveText("Page 2 of 2");
  await page.getByLabel("Pool activity · Pro").selectOption("two_sided");
  await page.getByLabel("Seen within").selectOption("24");
  await page.getByRole("combobox",{name:"History",exact:true}).selectOption("cached");
  await page.getByRole("button",{name:"Filter wallets",exact:true}).click();
  await expect(page.locator("#copyScreenPage")).toHaveText("Page 1 of 2");
  expect(queries.at(-1)).toMatchObject({view:"observed",page:1,observed:{signal:"two_sided",active_within_hours:24,history:"cached"}});
  expect(queries.at(-1).filters).toBeUndefined();
  expect(shared.requests.some(row=>row.path.endsWith("/inspect"))).toBe(false);
  await page.reload();await expect(page.getByLabel("Pool activity · Pro")).toHaveValue("two_sided");
  await page.getByText("Inspect pool samples",{exact:true}).click();
  await expect(page.locator(".copy-observed-evidence")).toContainText("$149.12");
  const href=await page.locator(".copy-observed-evidence a").getAttribute("href"),url=new URL(href,"https://ravenos.xyz");
  expect(url.pathname).toBe("/terminal/");expect(url.searchParams.get("token_address")).toBe(EVM_TOKEN);
  expect(url.searchParams.get("pair_address")).toBe(`0x${"ab".repeat(20)}`);expect(url.searchParams.get("chain")).toBe("base");
  expect(url.searchParams.has("copy_review")).toBe(false);
  await page.setViewportSize({width:1440,height:1000});await page.locator("#copySeenWallets").scrollIntoViewIfNeeded();
  await captureVisual(page,"wallet-market-context-desktop");
  await page.setViewportSize({width:390,height:844});await page.locator("#copySeenWallets").scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
  await captureVisual(page,"wallet-market-context-mobile");
  await page.getByRole("button",{name:"Reset",exact:true}).last().click();
  await expect(page.getByLabel("Pool activity · Pro")).toHaveValue("any");
  expect(new URL(page.url()).searchParams.has("obs_signal")).toBe(false);
});

test("Standard can browse stored history states while advanced pool filters remain Pro-only", async ({page}) => {
  const shared={watch:null,decision:null,position:null,requests:[]},queries=[];
  await install(page,shared,{entitled:false,marketEvidence:true});await observedEvidenceFixture(page,queries);
  await page.goto("/account/copy/?wallets=observed&obs_signal=two_sided&obs_sort=activity");
  await expect(page.locator("#copySeenResults .copy-seen-wallet")).toHaveCount(2);
  await expect(page.locator("#copyObservedSignal")).toBeHidden();await expect(page.locator("#copyObservedSort")).toBeHidden();
  await expect(page.getByRole("combobox",{name:"History",exact:true})).toBeVisible();
  expect(queries[0].observed).toMatchObject({signal:"any",sort:"priority"});
  expect(shared.requests.some(row=>row.path.endsWith("/inspect"))).toBe(false);
});

test('source lists filter cached wallets, preserve full addresses and restore across refresh',async({page})=>{
  const shared={requests:[]},queries=[];await install(page,shared,{marketEvidence:true});
  await page.route('**/api/v1/wallet-copy/screener',route=>{
    queries.push(route.request().postDataJSON());
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,rows:[],scope:{chain:'all'},pagination:{page:1,page_size:12},seen_wallets:{total:1,rows:[{
      source_wallet_id:SOURCE_ID,source_wallet:{chain:'solana',address:WALLET},history_available:true,last_observed_at:'2026-09-08T12:00:00Z',
      discovery_sources:[{kind:'kol',label:'KOL list',provider:'kolscan_public_daily',rank:3,observed_at:'2026-09-08T12:00:00Z'}],
    }]}})});
  });
  await page.goto('/account/copy/?wallets=observed');
  await expect(page.locator('#copySeenResults')).toContainText(WALLET);
  await expect(page.locator('#copySeenResults')).toContainText('Kolscan Public Daily');
  await expect(page.locator('#copySeenResults')).toContainText('#3');
  await page.getByLabel('Source list').selectOption('kol');
  await page.getByRole('button',{name:'Filter wallets',exact:true}).click();
  expect(queries.at(-1).observed).toMatchObject({source:'kol',sort:'priority'});
  expect(queries.at(-1).chain).toBe('all');
  await page.reload();await expect(page.getByLabel('Source list')).toHaveValue('kol');
  expect(shared.requests.some(row=>row.path.endsWith('/inspect'))).toBe(false);
  await page.setViewportSize({width:390,height:844});
  await page.locator('#copySeenWallets').scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
  await captureVisual(page,'wallet-source-lists-mobile');
});

test('observed wallets save privately and cached research survives refresh and removal failures', async ({page}) => {
  const shared = {requests:[]};
  await install(page, shared);
  await page.route('**/api/v1/wallet-copy/screener',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,rows:[],scope:{chain:'all'},pagination:{page:1,page_size:12},seen_wallets:{total:1,rows:[{source_wallet_id:SOURCE_ID,source_wallet:{chain:'solana',address:WALLET},history_available:true,last_observed_at:'2026-09-07T12:00:00Z'}]}})}));
  await page.goto('/account/copy/');
  await page.locator('#copySaveListName').fill('Shortlist');
  await page.locator('.copy-seen-wallet').getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.locator('#copySavedCount')).toHaveText('1 saved');
  await page.locator('.copy-seen-wallet').getByRole('button',{name:'Open cached'}).click();
  await expect(page.locator('#copyProfile')).toBeVisible();
  expect(shared.requests.filter(row=>row.path.endsWith('/inspect'))).toHaveLength(0);
  await page.locator('#copySavedShortcut').click();
  await expect(page.locator('#copySavedWallets')).toContainText('Shortlist');
  await page.locator('#copySavedChain').selectOption('base');
  await expect(page.locator('#copySavedWallets')).toContainText('No saved wallets match');
  await page.locator('#copySavedChain').selectOption('all');
  await page.route('**/api/v1/wallet-copy/saved-wallets',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"unavailable"}'}));
  await page.locator('#copySavedRetry').click();
  await expect(page.locator('#copySavedStatus')).toContainText('last loaded list');
  await expect(page.locator('#copySavedWallets')).toContainText('Shortlist');
  await page.route('**/api/v1/wallet-copy/saved-wallets/*',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"unavailable"}'}));
  await page.locator('#copySavedWallets').getByRole('button',{name:'Remove'}).click();
  await expect(page.locator('#copySavedStatus')).toContainText('Could not remove');
  await expect(page.locator('#copySavedCount')).toHaveText('1 saved');
});

test('opening Solana analysis after EVM lookup restores server-backed activity filters', async ({page})=>{
  const shared = {requests:[]}; await install(page,shared);
  await page.goto(`/account/copy/?wallet=${EVM_WALLET}&chain=bsc`);
  await expect(page.locator('#copyProfile')).toBeVisible();
  await page.getByRole('button',{name:'Open analysis',exact:true}).click();
  await expect(page.locator('#copyWalletAddress')).toHaveValue(WALLET);
  await page.locator('#copyActivityFilter').selectOption('unresolved');
  await expect.poll(()=>shared.requests.some(row=>row.path.endsWith('/events')&&row.search.includes('unresolved'))).toBe(true);
  await expect(page.locator('#copyEventCount')).toContainText('1 of 1');
});


test('a late activity page cannot overwrite a newly opened profile', async ({page}) => {
  const shared = {requests:[]}; await install(page,shared);
  let release;
  await page.route(`**/api/v1/wallet-copy/wallets/${SOURCE_ID}/events?*`,async route=>{
    await new Promise(resolve=>{release=resolve;});
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(activityPage([event('AMBIGUOUS',4)],{filter:'unresolved',total:1}))});
  });
  await page.goto(`/account/copy/?wallet=${WALLET}`);
  await expect(page.locator('#copyProfile')).toBeVisible();
  await page.locator('#copyActivityFilter').selectOption('unresolved');
  await expect.poll(()=>typeof release).toBe('function');
  await page.getByRole('button',{name:'Open analysis',exact:true}).click();
  await expect(page.locator('#copyEventCount')).toHaveText('2 of 26 retained');
  release();
  await page.waitForResponse(response=>response.url().includes('/events?'));
  await expect(page.locator('#copyEventCount')).toHaveText('2 of 26 retained');
  await expect(page.locator('#copyActivityFilter')).toHaveValue('all');
});

test('wallet overview uses cached period records, full identities and token costs on mobile', async ({page}) => {
  const shared={requests:[]}; await install(page,shared);
  const record=profile(); record.generated_at='2026-08-29T12:00:00.000Z';
  record.trading_record={token_count:1,tokens_truncated:false,periods:{
    d30:{...record.source_performance.windows.d30,buy_count:14,sell_count:8,win_rate_pct:62.5,average_hold_seconds:2100,distribution:[{label:'0% to 100%',count:8}]},
    d7:{...record.source_performance.windows.d7,buy_count:6,sell_count:5,win_rate_pct:60,average_hold_seconds:1200,distribution:[{label:'0% to 100%',count:5}]},
  },tokens:[{mint:TOKEN,buy_count:4,sell_count:2,last_trade_at:'2026-08-29T11:59:58.000Z',by_basis:{usdc:{matched_cost:'25.000000',matched_proceeds:'30.000000',realized_pnl:'5.000000',remaining_cost:12},sol:{}}}]};
  await page.route(`**/api/v1/wallet-copy/wallets/${SOURCE_ID}`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,source_wallet_id:SOURCE_ID,profile:record,recent_events:[event()],provider_request_performed:false})}));
  await page.setViewportSize({width:390,height:844});
  await page.goto('/account/copy/');
  await page.getByRole('button',{name:'Open analysis',exact:true}).click();
  await expect(page.locator('#copyProfileAddress')).toHaveText(WALLET);
  await expect(page.locator('#copyProfileExplorer')).toHaveAttribute('href',`https://solscan.io/account/${WALLET}`);
  await expect(page.locator('#copyOverviewMetrics')).toContainText('14 / 8');
  await expect(page.locator('#copyOverviewMetrics')).toContainText('+428.12 USDC');
  const before=shared.requests.filter(row=>row.path.endsWith('/inspect')).length;
  await page.getByLabel('Wallet performance period').selectOption('d7');
  await expect(page.locator('#copyOverviewMetrics')).toContainText('6 / 5');
  await expect(page.locator('#copyOverviewMetrics')).toContainText('+211.40 USDC');
  await expect(page.locator('#copyTokenTable')).toContainText('5.000000 USDC');
  await expect(page.locator('#copyTokenTable')).toContainText(TOKEN);
  await page.getByLabel('Filter token results').fill('missing-token');
  await expect(page.locator('#copyTokenTable')).toContainText('No tokens match this filter');
  expect(shared.requests.filter(row=>row.path.endsWith('/inspect')).length).toBe(before);
  await page.getByLabel('Filter token results').fill('');
  const overflow=await page.evaluate(()=>[...document.querySelectorAll('#copyProfile *')].filter(node=>node.getBoundingClientRect().right>innerWidth+1).map(node=>node.id||node.className));
  expect(overflow).toEqual([]);
  if(process.env.RAVENOS_VISUAL_ARTIFACT_DIR){
    await page.locator('#copyWalletOverview').screenshot({path:join(process.env.RAVENOS_VISUAL_ARTIFACT_DIR,'wallet-overview-mobile.png')});
    await page.setViewportSize({width:1440,height:1100});
    await page.locator('#copyWalletOverview').screenshot({path:join(process.env.RAVENOS_VISUAL_ARTIFACT_DIR,'wallet-overview-desktop.png')});
  }
});

test('missing provider transaction count is never shown as zero and advanced EVM panels start collapsed',async({page})=>{
  const shared={requests:[]};await install(page,shared);
  const snapshot=evmProfile();snapshot.positions.provider_reported_token_balances[0].provider_mark_price_usd=0.0000025;snapshot.coverage.transactions_reported_by_provider=null;snapshot.coverage.transactions_observed=0;
  await page.route('**/api/v1/wallet-copy/inspect',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,source_wallet_id:EVM_SOURCE_ID,profile:snapshot,recent_events:[],persistence:{state:'on_demand_only'}})}));
  await page.goto(`/account/copy/?wallet=${EVM_WALLET}&chain=bsc`);
  await expect(page.locator('#copyProfileAddress')).toHaveText(EVM_WALLET);
  await expect(page.locator('#copyProfileCoverage')).toContainText('1 transfers observed');
  await expect(page.locator('#copyProfileCoverage')).not.toContainText('0 tx');
  await expect(page.locator('#copyRavenEvidence')).not.toHaveAttribute('open');
  await expect(page.locator('#copyOverviewScope')).toContainText('swaps and cost basis are not reconstructed');
  await expect(page.locator('#copyHoldingsTable')).toContainText(EVM_TOKEN);
  await expect(page.locator('#copyHoldingsTable')).toContainText('$0.0000025');
});

test('verified EVM results show separate currencies and the coverage of unrealized marks on desktop and mobile',async({page})=>{
 const shared={requests:[]};await install(page,shared);
 const snapshot=evmProfile();snapshot.generated_at='2026-09-08T12:00:00Z';snapshot.coverage.trade_events=4;
 const period={realized_pnl:{usdg:'25',eth:'0.004'},roi_pct:null,win_rate_pct:50,buy_count:2,sell_count:2,observations:2,average_hold_seconds:1800,buy_notional_by_basis:{usdg:{average:'50',total:'100'}},sell_notional_by_basis:{usdg:{total:'125'}}};
 snapshot.trading_record={token_count:1,basis_labels:{usdg:'USDG',eth:'ETH'},periods:{d30:period,d7:period},unrealized_summary:{value_usd:'50',covered_tokens:1,visible_holdings:2},tokens:[{mint:EVM_TOKEN,buy_count:2,sell_count:2,unrealized_pnl_usd:'50',by_basis:{usdg:{matched_cost:'100',matched_proceeds:'125',realized_pnl:'25',remaining_cost:'50'}}}]};
 snapshot.trading_record.usd={priced_trades:2,eligible_trades:4,periods:{d30:{realized_pnl:{usd:'12.345'},observed_network_fee_usd:'0.013'}}};
 snapshot.balances_observed_at='2026-09-07T12:00:00Z';
 await page.route('**/api/v1/wallet-copy/inspect',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,source_wallet_id:EVM_SOURCE_ID,profile:snapshot,recent_events:[],persistence:{state:'shared_raven_profile'}})}));
 await page.goto(`/account/copy/?wallet=${EVM_WALLET}&chain=bsc`);
 await expect(page.locator('#copyOverviewMetrics')).toContainText('+25 USDG · +0.004 ETH');
 await expect(page.locator('#copyOverviewMetrics')).toContainText('2 / 4 retained trades');
 await expect(page.locator('#copyOverviewScope')).toContainText('historical five-minute');
 await expect(page.locator('#copyOverviewMetrics')).toContainText('$50.00 · 1/2 tokens');
 await expect(page.locator('#copyHoldingsTable')).toContainText('$50.00');
 await expect(page.locator('#copyTokenTable')).toContainText('125 USDG');
 await expect(page.locator('#copyOverviewScope')).toContainText('Settlement currencies stay separate');
 await captureVisual(page,'wallet-evm-reconstruction-desktop');
 const calls=shared.requests.length;
 await page.getByLabel('Wallet performance period').selectOption('d7');expect(shared.requests.length).toBe(calls);
 await page.setViewportSize({width:390,height:844});
 await expect(page.locator('#copyProfileAddress')).toHaveText(EVM_WALLET);
 const overflow=await page.evaluate(()=>[...document.querySelectorAll('#copyProfile *')].filter(n=>n.getBoundingClientRect().right>innerWidth+1).map(n=>n.id||n.className));
 expect(overflow).toEqual([]);
 await captureVisual(page,'wallet-evm-reconstruction-mobile');
});

test('wallet valuation shows screened missing marks and uses reconciled historical USD cost',async({page})=>{
  const shared={requests:[]};await install(page,shared);
  const snapshot=evmProfile();snapshot.generated_at='2026-09-08T12:00:00Z';
  snapshot.provider_balance_summary={visible_priced_rows:1,visible_unpriced_rows:1,visible_provider_mark_value_usd:'100'};
  snapshot.positions.provider_reported_token_balances=[
    {contract:EVM_TOKEN,symbol:'MARKED',balance_display:'5',provider_mark_price_usd:'20',provider_mark_value_usd:'100',price_authority:'dexscreener_pool_reference',mark_observed_at:snapshot.generated_at,mark_evidence:{liquidity_usd:100000,pool_address:EVM_TOKEN_TWO}},
    {contract:EVM_TOKEN_TWO,symbol:'THIN',balance_display:'9999999',provider_mark_price_usd:null,provider_mark_value_usd:null},
  ];
  snapshot.mark_coverage={unavailable:[{contract:EVM_TOKEN_TWO,reason:'thin_liquidity'}]};
  snapshot.trading_record={periods:{},tokens:[],usd:{priced_trades:1,eligible_trades:1,periods:{d30:{}},unrealized_summary:{value_usd:'37',covered_tokens:1,visible_holdings:2},tokens:[{mint:EVM_TOKEN,unrealized_pnl_usd:'37'}]}};
  await page.route('**/api/v1/wallet-copy/inspect',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,source_wallet_id:EVM_SOURCE_ID,profile:snapshot,recent_events:[]})}));
  await page.goto(`/account/copy/?wallet=${EVM_WALLET}&chain=bsc`);
  await expect(page.locator('#copyOverviewMetrics')).toContainText('1 priced · 1 unpriced');
  await expect(page.locator('#copyOverviewMetrics')).toContainText('$37.00 · 1/2 tokens');
  await expect(page.locator('#copyHoldingsTable')).toContainText('Low liquidity');
  await expect(page.locator('#copyHoldingsTable')).toContainText('$37.00');
  await expect(page.locator('#copyHoldingsTable [title*="Pool liquidity"]')).toHaveText('$20');
  await captureVisual(page,'wallet-mark-coverage-desktop');
  await page.setViewportSize({width:390,height:844});
  const overflow=await page.evaluate(()=>[...document.querySelectorAll('#copyProfile *')].filter(n=>n.getBoundingClientRect().right>innerWidth+1).map(n=>n.id||n.className));
  expect(overflow).toEqual([]);await captureVisual(page,'wallet-mark-coverage-mobile');
});
