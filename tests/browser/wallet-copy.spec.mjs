const publicPayload = value => JSON.stringify(publicWalletResponse(value, { copySetup: true }));
import { publicWalletResponse } from '../../lib/customer_trade/wallet_public_delivery.mjs';
import { PUBLIC_WALLET_SNAPSHOT_SCHEMA, publicWalletGroupPage, normalizeWalletGroupQuery } from '../../lib/customer_trade/wallet_public_cards.mjs';
import { mockTradingSettings } from './trading-settings-fixtures.mjs';
import { defaultTradingSettings } from '../../ravenos-trading-strategy.js';
import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { normalizeSourceWalletChainIdentity } from "../../lib/customer_trade/source_wallet_chain_identity.mjs";
import { mockTerminalLiveApis, waitForTerminalLive } from './terminal-live-fixtures.mjs';
import { projectWalletProfileDelivery, walletHoldingsPage } from '../../lib/customer_trade/wallet_profile_delivery.mjs';

test('Wallet profile opens over a mobile Terminal and closes back to the same draft', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockTerminalLiveApis(page, { spotQuotePreview: true });
  const shared = { watch: null, decision: null, position: null, requests: [] };
  await install(page, shared);
  await page.goto('/terminal/?instrument_id=solana%3Apool%3Afixture-pair-address&lane=spot&market=spot&instrument_type=exact_pool&token_address=fixture-token-address&quote_address=fixture-quote-address&panel=chart');
  await waitForTerminalLive(page, { lane: 'spot' });
  await page.locator('#terminalSpotAmount').fill('42');
  const url = page.url();
  await page.locator('#rosCommandTrigger').click();
  await page.locator('#rosCommandInput').fill(WALLET);
  await page.locator('.ros-command-result.wallet').click();
  await expect(page.locator('.ros-intelligence-layer #copyProfile')).toBeVisible();
  await expect(page).toHaveURL(url);
  await expect(page.locator('#copyWalletAddress')).toHaveValue(WALLET);
  await page.screenshot({ path: info.outputPath('wallet-overlay-mobile.png') });
  await page.locator('.ros-layer-close').click();
  await expect(page.locator('.ros-intelligence-layer')).toHaveCount(0);
  await expect(page.locator('#terminalSpotAmount')).toHaveValue('42');
  await expect(page).toHaveURL(url);
  expect(shared.requests.filter(row => /sign|execute|broadcast/.test(row.path))).toHaveLength(0);
  // A cached overlay must recheck auth before showing the prior profile.
  await page.route('**/api/v1/auth/session', route => route.fulfill({ json: session(false) }));
  await page.locator('#rosCommandTrigger').click();
  await page.locator('#rosCommandInput').fill(WALLET);
  await page.locator('.ros-command-result.wallet').click();
  await expect(page.locator('.ros-intelligence-layer #copyProfile')).toBeHidden();
  await expect(page.locator('.ros-intelligence-layer #copyAuthStatus')).toContainText('Sign in again');
  await page.locator('.ros-layer-close').click();
  await expect(page.locator('#terminalSpotAmount')).toHaveValue('42');
});

const WALLET = "7KxQmTi5W4rP8Y2hD9cV6nF3aS1uEoLzJbGkNqMpfHrt";
const TOKEN = "4M7YQqGfRWfBpcA7mN5uY3z8Jj6Hk2VtD9sLxEePoaBn";
const WATCH_ID = "wcw_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SOURCE_ID = `sw_sol_${"a".repeat(40)}`;
const EVM_WALLET = `0x${"12".repeat(20)}`;
const EVM_TOKEN = `0x${"56".repeat(20)}`;
const EVM_TOKEN_TWO = `0x${"ab".repeat(20)}`;
const EVM_SOURCE_ID = `sw_bsc_${"b".repeat(40)}`;

test('Wallet overlay account failure preserves the chart draft and recovers on reopen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockTerminalLiveApis(page, { spotQuotePreview: true });
  const shared = { watch: null, decision: null, position: null, requests: [] };
  await install(page, shared);
  let failed = false;
  await page.route('**/api/v1/auth/session', r => failed
    ? r.fulfill({ status: 503, headers: { 'retry-after': '0' }, json: { ok: false } })
    : r.fulfill({ json: session() }));
  await page.goto('/terminal/?instrument_id=solana%3Apool%3Afixture-pair-address&lane=spot&market=spot&instrument_type=exact_pool&token_address=fixture-token-address&quote_address=fixture-quote-address&panel=chart');
  await waitForTerminalLive(page, { lane: 'spot' }); await page.locator('#terminalSpotAmount').fill('42');
  const url = page.url();
  const open = async () => {
    await page.locator('#rosCommandTrigger').click(); await page.locator('#rosCommandInput').fill(WALLET);
    await page.locator('.ros-command-result.wallet').click();
  };
  await open(); await expect(page.locator('.ros-intelligence-layer #copyProfile')).toBeVisible();
  await page.locator('.ros-layer-close').click(); failed = true;
  const inspections = shared.requests.filter(row => row.path.endsWith('/inspect')).length;
  await open();
  await expect(page.locator('.ros-intelligence-layer #copyUnavailableReason')).toContainText('Your account could not be checked');
  await expect(page.locator('#copySignIn')).toBeHidden(); await expect(page.locator('#copyWorkspace')).toBeHidden();
  expect(shared.requests.filter(row => row.path.endsWith('/inspect')).length).toBe(inspections);
  await page.locator('.ros-layer-close').click(); failed = false;
  await open(); await expect(page.locator('.ros-intelligence-layer #copyProfile')).toBeVisible();
  await page.locator('.ros-layer-close').click();
  await expect(page.locator('#terminalSpotAmount')).toHaveValue('42'); await expect(page).toHaveURL(url);
  expect(shared.requests.filter(row => /sign|execute|broadcast/.test(row.path))).toHaveLength(0);
});

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

async function install(page, shared, { authenticated = true, entitled = true, marketEvidence = false, walletGroups = false } = {}) {
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(session(authenticated)),
  }));
  await page.route("**/api/v1/wallet-copy**", async (route) => {
    const fulfill = args => route.fulfill({ ...args, body: JSON.stringify(publicWalletResponse(JSON.parse(args.body), { copySetup: true })) });
    const request = route.request();
    const url = new URL(request.url());
    const record = { method: request.method(), path: url.pathname, search: url.search, body: request.postData(), headers: request.headers() };
    shared.requests.push(record);
    if (url.pathname === "/api/v1/wallet-copy" && request.method() === "GET") {
      return fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          state: "available",
          copy_product: { standard_execution_fee_bps: 100, pro_execution_fee_bps: 100, pro_cashback_percent: 30, copy_additional_fee_bps: 0 },
          access: { tier: entitled ? "pro" : "free", advanced_wallet_intelligence: entitled, basic_wallet_lookup: true, basic_wallet_screener: true, raven_copy_subscription_required: false },
          activation: { wallet_intelligence: true, wallet_screener: true, wallet_groups: walletGroups, wallet_market_evidence: marketEvidence, shadow_copy: true, live_copy: false },
          execution_boundary: { signing: false, broadcasting: false, custody: false, live_copy: false, fee_collection: false },
        }),
      });
    }
    if (url.pathname.endsWith("/screener") && request.method() === "POST") {
      const screenerBody = JSON.parse(request.postData() || "{}");
      const robinhood = screenerBody.chain === "robinhood";
      return fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        ok: true,
        schema_version: "ravenos.wallet_screener.v1",
        state: robinhood ? "empty" : "available",
        scope: { chain: screenerBody.chain || "solana", chains: screenerBody.chain === "all" ? ["solana", "robinhood"] : [screenerBody.chain || "solana"], claim: "bounded_raven_index_only", comprehensive_chain_index: false },
        rows: robinhood ? [] : [screenedWallet()],
        pagination: { page: 1, page_size: 12, total_matching_rows: robinhood ? 0 : 1, total_pages: robinhood ? 0 : 1, has_previous: false, has_next: false },
      }) });
    }
    if (url.pathname === `/api/v1/wallet-copy/wallets/${SOURCE_ID}` && request.method() === "GET") {
      const activity = activityPage([event("SWAP_BUY"), event("TRANSFER_IN", 1)], { total: 26, hasMore: true, nextCursor: `123~swe_${"a".repeat(40)}` });
      return fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: "available", source_wallet_id: SOURCE_ID, profile: profile(), prospective_copyability: prospectiveCopyability(), recent_events: activity.events, activity, deep_history: deepHistory(), provider_request_performed: false }) });
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
      return fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: rows.length ? "available" : "empty", source_wallet_id: SOURCE_ID, ...activity }) });
    }
    if (url.pathname.endsWith("/saved-wallets") && request.method() === "GET") {
      return fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: shared.saved?.length ? "available" : "empty", saves: shared.saved || [], lists: [] }) });
    }
    if (url.pathname.endsWith("/saved-wallets") && request.method() === "POST") {
      const body = JSON.parse(request.postData() || "{}");
      const existing = (shared.saved || []).find((row) => row.source_wallet_id === body.source_wallet_id && row.list_name === body.list_name);
      const save = existing || { save_id: `wrs_${"s".repeat(40)}`, source_wallet_id: body.source_wallet_id, list_name: body.list_name, label: body.label, source_wallet: { chain: "solana", network: "mainnet", address: WALLET }, created_at: "2026-08-29T12:00:00.000Z", updated_at: "2026-08-29T12:00:00.000Z", revision: 1, shadow_monitoring_started: false, execution_authorized: false };
      shared.saved = existing ? shared.saved : [...(shared.saved || []), save];
      return fulfill({ status: existing ? 200 : 201, contentType: "application/json", body: JSON.stringify({ ok: true, created: !existing, save }) });
    }
    if (url.pathname.includes("/saved-wallets/") && request.method() === "DELETE") {
      const saveId = url.pathname.split("/").pop();
      const before = (shared.saved || []).length;
      shared.saved = (shared.saved || []).filter((row) => row.save_id !== saveId);
      return fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, deleted: shared.saved.length < before }) });
    }
    if (url.pathname.endsWith("/inspect") && request.method() === "POST") {
      const inspectBody = JSON.parse(request.postData() || "{}");
      if (inspectBody.chain && inspectBody.chain !== "solana") {
        const transfer = evmTransfer();
        const activity = { ...activityPage([transfer]), scope: { on_demand_only: true, evidence_mode: "bounded_blockscout_index", provider_request_performed: true, history_complete_claimed: false, current_balance_claimed: false } };
        return fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: "available", source_wallet_id: EVM_SOURCE_ID, profile: evmProfile(), recent_events: [transfer], activity, transaction_decode_candidates: [evmTransactionContext()], prospective_copyability: null, deep_history: { state: "not_enabled", history_complete_claimed: false }, persistence: { state: "on_demand_only", saved_to_raven_index: false, copy_eligible: false } }) });
      }
      const activity = activityPage([event("SWAP_BUY"), event("TRANSFER_IN", 1)], { total: 26, hasMore: true, nextCursor: `123~swe_${"a".repeat(40)}` });
      return fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: "available", source_wallet_id: SOURCE_ID, profile: profile(), prospective_copyability: prospectiveCopyability(), recent_events: activity.events, activity, deep_history: deepHistory() }) });
    }
    if (url.pathname.endsWith("/watches") && request.method() === "GET") {
      return fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: shared.watch ? "available" : "empty", watches: shared.watch ? [shared.watch] : [] }) });
    }
    if (url.pathname.endsWith("/watches") && request.method() === "POST") {
      shared.watch = watch(false);
      return fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, created: true, watch: shared.watch }) });
    }
    if (url.pathname === `/api/v1/wallet-copy/watches/${WATCH_ID}/refresh` && request.method() === "POST") {
      shared.watch = watch(true);
      return fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: "baseline_established", decisions: [], profile: profile() }) });
    }
    if (url.pathname === `/api/v1/wallet-copy/watches/${WATCH_ID}` && request.method() === "DELETE") {
      shared.watch = null;
      return fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, deleted: true }) });
    }
    if (url.pathname.endsWith("/decisions") && request.method() === "GET") {
      const sampleCount = shared.decision ? 1 : 0;
      const exitCount = shared.exitDecision ? 1 : 0;
      return fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: sampleCount || exitCount ? "available" : "empty", decisions: shared.decision ? [shared.decision] : [], exit_decisions: shared.exitDecision ? [shared.exitDecision] : [], copyability: shared.watch ? [{ watch_id: WATCH_ID, snapshot: { state: "insufficient_evidence", score: null, prospective_sample_count: sampleCount, components: { policy_pass_pct: 0, entry_executable_pct: 100, exit_executable_pct: 0, median_entry_degradation_bps: 42 } }, by_size: [25, 100, 500, 1000, 5000].map((size) => ({ order_size_usdc: size, state: "insufficient_evidence", score: null, prospective_sample_count: size === 100 ? sampleCount : 0, components: {} })) }] : [] }) });
    }
    if (url.pathname.endsWith("/positions") && request.method() === "GET") {
      return fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: shared.position ? "available" : "empty", positions: shared.position ? [shared.position] : [] }) });
    }
    return fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false, error: "not_found" }) });
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
    body: { intent: "sign_in", provider: "managed", return_to: `/account/copy/?wallet=${EVM_WALLET}&chain=bsc&inspect_chain=bsc` },
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
  await expect(page.locator("#copyProfile").getByText("Follower reality", { exact: true })).toHaveCount(0);
  await expect(page.locator("#copySourcePnl")).toHaveText("+$428 realized");
  await expect(page.getByText("Loading wallet history", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("694 transactions loaded", { exact: true })).toBeVisible();
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
  await expect(page.locator("#copySourceMetrics")).toContainText("Inbound transfers");
  await expect(page.locator("#copyEvmTransactionContext")).toBeHidden();
  await expect(page.getByText("Raven trade verdict", { exact: true })).toHaveCount(0);
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
  await expect(page.getByRole("button", { name: "Copy unavailable on this chain" })).toBeDisabled();
  const inspectRequest = shared.requests.find((row) => row.path.endsWith("/inspect"));
  expect(JSON.parse(inspectRequest.body)).toEqual({ address: EVM_WALLET, chain: "bsc" });
  const overflow = await page.evaluate(() => [...document.querySelectorAll("body *")]
    .filter((node) => node.getBoundingClientRect().right > innerWidth + 1)
    .map((node) => `${node.tagName.toLowerCase()}.${node.className || ""}`));
  expect(overflow).toEqual([]);
});

test("Raven-indexed screener keeps proprietary research private and opens a retained profile without another live lookup", async ({ page }) => {
  const shared = { watch: null, decision: null, position: null, requests: [] };
  await install(page, shared);
  await page.goto("/account/copy/");
  await expect(page.getByRole("heading", { name: "Find your next wallet to follow." })).toBeVisible();
  await expect(page.locator('.copy-screener-card')).toContainText(WALLET);
  await expect(page.locator('.copy-screener-card')).toContainText('62.50%');
  await expect(page.locator('.copy-screener-card')).not.toContainText(/reconstruction|alpha retained|policy pass|Watch:/i);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("#copySavedWallets").getByText(WALLET, { exact: true })).toBeVisible();
  const saveRequest = shared.requests.find((row) => row.method === "POST" && row.path.endsWith("/saved-wallets"));
  expect(saveRequest.headers["x-ravenos-csrf"]).toBe("csrf_wallet_copy");
  expect(JSON.parse(saveRequest.body)).toEqual({ source_wallet_id: SOURCE_ID, list_name: "Research", label: WALLET });
  expect(shared.watch).toBeNull();
  await captureVisual(page, "wallet-copy-screener-desktop-1440");
  await page.getByRole("button", { name: "View wallet" }).click();
  await expect(page.locator('#copyProfileAddress')).toHaveText(WALLET);
  await expect(page.locator('#copySourcePnl')).toHaveText('+$428 realized');
  await expect(page.getByText('25 USDC', { exact: true })).toBeVisible();
  await expect(page.locator('#copyProfile')).not.toContainText(/What supports it|What Raven needs next|Follower reality|How much Raven knows|Routes weaken above/);
  await expect(page.getByRole("button", { name: "Save wallet" })).toBeVisible();
  await expect(page.locator("#copyEventCount")).toHaveText("2 of 26 retained");
  await page.getByRole("button", { name: "Load older" }).click();
  await expect(page.locator("#copyEventCount")).toHaveText("4 of 26 retained");
  await expect(page.locator('#copyRecentEvents').getByText("Sell", { exact: true })).toBeVisible();
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
  expect(screenerRequest.body).not.toMatch(/reconstruction|copyability|follower_|known_cost_basis/);
  await page.getByRole("button", { name: /Recorded profits/ }).click();
  const presetRequest = [...shared.requests].reverse().find((row) => row.path.endsWith("/screener"));
  expect(JSON.parse(presetRequest.body).preset).toBe("recorded_profits");
  expect(new URL(page.url()).searchParams.get("screen")).toBe("recorded_profits");
});

test("wallet screener switches to a bounded Robinhood index without turning unavailable evidence into zero", async ({ page }) => {
  const shared = { watch: null, decision: null, position: null, requests: [] };
  await install(page, shared);
  await page.goto("/account/copy/");
  await page.getByRole("button", { name: "Robinhood", exact: true }).click();
  await expect(page.locator("#copyScreenerCount")).toHaveText("0 matches");
  await expect(page.locator("#copyScreenerStatus")).toContainText("No matching wallet in Robinhood Chain.");
  await expect(page.getByText("Adjust the filters or inspect a wallet address.")).toBeVisible();
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
  await expect(page.locator(".copy-screener-card")).toContainText(WALLET);
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
  await expect(page.locator("#copySeenWallets")).toContainText("Browse wallets by chain");
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
  await expect(page.locator("#copyScreenerResults")).toContainText("No matching wallets");
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
  await expect(page.getByRole("heading", { name: "Find your next wallet to follow." })).toBeVisible();
  await page.getByLabel("Sort").selectOption("trade_count_desc");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("button", { name: "View wallet" })).toBeVisible();
  const overflow = await page.evaluate(() => [...document.querySelectorAll("body *")]
    .filter((node) => node.getBoundingClientRect().right > innerWidth + 1)
    .map((node) => `${node.tagName.toLowerCase()}.${node.className || ""}`));
  expect(overflow).toEqual([]);
  const latest = [...shared.requests].reverse().find((row) => row.path.endsWith("/screener"));
  expect(JSON.parse(latest.body).sort).toBe("trade_count_desc");
  await captureVisual(page, "wallet-copy-screener-mobile-390");
  await page.getByRole("button", { name: "View wallet" }).click();
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
  await expect(page.getByText(`32500 ${TOKEN}`, { exact: true })).toBeVisible();
  await expect(page.getByText("1 Raven lot mapped · no funds moved", { exact: true })).toBeVisible();
  await captureVisual(page, "wallet-copy-mobile-shadow-390");
  await page.getByRole("tab", { name: /Positions/ }).click();
  await expect(page.getByText("Shadow Partial Exit")).toBeVisible();
  await expect(page.getByText(`48750 ${TOKEN}`, { exact: true })).toBeVisible();
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
  await page.route(`**/api/v1/wallet-copy/wallets/${SOURCE_ID}`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: publicPayload({ source_wallet_id: SOURCE_ID, profile: { ...profile(), source_wallet: { chain: "solana", network: "mainnet", address: secondAddress } } }) }));
  await page.goto("/account/copy/");
  await page.getByLabel("Paste an address").fill(WALLET);
  await page.getByRole("button", { name: "Analyze wallet", exact: true }).click();
  await expect.poll(() => typeof release).toBe("function");
  await page.getByRole("button", { name: "View wallet", exact: true }).first().click();
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
  await page.route('**/api/v1/wallet-copy/inspect',route=>route.fulfill({status:200,contentType:'application/json',body:publicPayload({ok:true,source_wallet_id:SOURCE_ID,profile:enriched,recent_events:[event()]})}));
  await page.goto(`/account/copy/?wallet=${WALLET}&chain=solana`);
  await expect(page.locator('#copyHoldingsTable')).toContainText('EXAMPLE');
  await expect(page.locator('#copyHoldingsTable')).toContainText('$0.0000025');
  await expect(page.locator('#copyHoldingsTable')).toContainText('Not reconstructed');
  await expect(page.locator('#copyRecentEvents')).toContainText('81 EXAMPLE');
  await expect(page.locator('#copyHoldingsScope')).toContainText('Cached indicative marks, not exit quotes');
});

test("observed-wallet filters preserve browsing while private pool samples stay hidden", async ({page}) => {
  const shared={watch:null,decision:null,position:null,requests:[]},queries=[];
  await install(page,shared,{marketEvidence:true});await observedEvidenceFixture(page,queries);
  await page.goto("/account/copy/?wallets=observed");
  await expect(page.locator("#copyObservedSignal")).toBeVisible();
  await expect(page.locator("#copySeenResults")).toContainText(EVM_WALLET);
  await expect(page.locator("#copySeenResults")).not.toContainText("Busiest pool · transactions");
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
  await expect(page.getByText("Inspect pool samples",{exact:true})).toHaveCount(0);
  await expect(page.locator(".copy-observed-evidence")).toHaveCount(0);
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
  await expect(page.locator('#copySeenResults')).not.toContainText(/kolscan/i);
  await expect(page.locator('#copySeenResults')).not.toContainText('KOL list');
  await expect(page.locator('#copySeenResults')).not.toContainText('#3');
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
  await page.route('**/api/v1/wallet-copy/screener',route=>route.fulfill({status:200,contentType:'application/json',body:publicPayload({ok:true,rows:[],scope:{chain:'all'},pagination:{page:1,page_size:12},seen_wallets:{total:1,rows:[{source_wallet_id:SOURCE_ID,source_wallet:{chain:'solana',address:WALLET},history_available:true,last_observed_at:'2026-09-07T12:00:00Z'}]}})}));
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
  await page.getByRole('button',{name:'View wallet',exact:true}).click();
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
  await page.getByRole('button',{name:'View wallet',exact:true}).click();
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
  await page.route(`**/api/v1/wallet-copy/wallets/${SOURCE_ID}`,route=>route.fulfill({status:200,contentType:'application/json',body:publicPayload({ok:true,source_wallet_id:SOURCE_ID,profile:record,recent_events:[event()],provider_request_performed:false})}));
  await page.setViewportSize({width:390,height:844});
  await page.goto('/account/copy/');
  await page.getByRole('button',{name:'View wallet',exact:true}).click();
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
  await page.route('**/api/v1/wallet-copy/inspect',route=>route.fulfill({status:200,contentType:'application/json',body:publicPayload({ok:true,source_wallet_id:EVM_SOURCE_ID,profile:snapshot,recent_events:[],persistence:{state:'on_demand_only'}})}));
  await page.goto(`/account/copy/?wallet=${EVM_WALLET}&chain=bsc`);
  await expect(page.locator('#copyProfileAddress')).toHaveText(EVM_WALLET);
  await expect(page.locator('#copyProfileCoverage')).toContainText('1 transfers observed');
  await expect(page.locator('#copyProfileCoverage')).not.toContainText('0 tx');
  await expect(page.locator('#copyRavenEvidence')).not.toHaveAttribute('open');
  await page.getByRole('link', { name: 'Wallet profile · Pro', exact: true }).click();
  await expect(page.locator('#copyRavenEvidence')).toHaveAttribute('open', '');
  await expect(page.locator('#copyOverviewScope')).toContainText('swaps and cost basis are not reconstructed');
  await expect(page.locator('#copyHoldingsTable')).toContainText(EVM_TOKEN);
  await expect(page.locator('#copyHoldingsTable')).toContainText('$0.0000025');
});

test('background EVM history without a balance snapshot never displays a fresh balance date',async({page})=>{
 const shared={requests:[]};await install(page,shared);
 const snapshot=evmProfile();snapshot.balances_observed_at=null;
 snapshot.capital_observations.native={symbol:'BNB',amount:null,amount_raw:null,observed_at:null,state:'unavailable'};
 snapshot.positions.provider_reported_token_balances=[];
 snapshot.provider_balance_summary={visible_balance_rows:0,visible_priced_rows:0,visible_unpriced_rows:0,visible_provider_mark_value_usd:null};
 await page.route('**/api/v1/wallet-copy/inspect',route=>route.fulfill({status:200,contentType:'application/json',body:publicPayload({ok:true,source_wallet_id:EVM_SOURCE_ID,profile:snapshot,recent_events:[],persistence:{state:'shared_raven_profile'}})}));
 await page.goto(`/account/copy/?wallet=${EVM_WALLET}&chain=bsc`);
 await expect(page.locator('#copyProfileAddress')).toHaveText(EVM_WALLET);
 await expect(page.locator('#copyOverviewScope')).toContainText('Balances have not been indexed.');
 await expect(page.locator('#copyOverviewScope')).not.toContainText('Balances observed');
 await expect(page.locator('#copyOverviewMetrics')).not.toContainText('0 BNB');
 await page.setViewportSize({width:390,height:844});
 await expect(page.locator('#copyOverviewScope')).toContainText('Balances have not been indexed.');
});

test('EVM receipt gaps stay explicit on desktop and mobile without a false full-window claim',async({page})=>{
 const shared={requests:[]};await install(page,shared);
 const snapshot=evmProfile();snapshot.durable_history={state:'bounded_partial',unresolved_references:2};
 const deep_history={state:'bounded_partial',chain:'bsc',unresolved_references:2,signatures_indexed:48,transactions_decoded:46,maximum_signatures:10000,pages_indexed:8};
 await page.route('**/api/v1/wallet-copy/inspect',route=>route.fulfill({status:200,contentType:'application/json',body:publicPayload({ok:true,source_wallet_id:EVM_SOURCE_ID,profile:snapshot,recent_events:[],deep_history})}));
 await page.goto(`/account/copy/?wallet=${EVM_WALLET}&chain=bsc`);
 await expect(page.locator('#copyOverviewScope')).toContainText('2 transaction receipts remain unresolved');
 await expect(page.locator('#copyDeepHistoryHeadline')).toHaveText('History retained with gaps');
 await expect(page.locator('#copyDeepHistoryDetail')).toContainText('complete cost basis is not established');
 await expect(page.locator('#copyDeepHistoryHeadline')).not.toContainText('10,000');
 await page.setViewportSize({width:390,height:844});
 await expect(page.locator('#copyOverviewScope')).toContainText('history and cost basis are incomplete');
});

test('wallet activity shows exact payments and receipts without treating a sale amount as profit',async({page})=>{
 const shared={requests:[]};await install(page,shared);
 const snapshot=evmProfile();snapshot.coverage.trade_events=2;
 const buy={...evmTransfer(),event_id:`swe_${'d'.repeat(40)}`,classification:{kind:'SWAP_BUY'},economic:{cost_basis_state:'known_canonical_usdc',source_asset:{contract:EVM_TOKEN,symbol:'USDC',amount_base_units:'100000000',decimals:6},destination_asset:{contract:EVM_TOKEN_TWO,symbol:'COIN',amount_base_units:'10000000',decimals:6}}};
 const sell={...buy,event_id:`swe_${'e'.repeat(40)}`,classification:{kind:'SWAP_SELL'},economic:{cost_basis_state:'unresolved_non_settlement_basis',source_asset:{contract:EVM_TOKEN_TWO,symbol:'COIN',amount_base_units:'5000000',decimals:6},destination_asset:{contract:EVM_TOKEN,symbol:'USDC',amount_base_units:'75000000',decimals:6}}};
 const tiny={...evmTransfer(),event_id:`swe_${'f'.repeat(40)}`,economic:{destination_asset:{contract:EVM_TOKEN_TWO,symbol:'COIN',amount_base_units:'1',decimals:18}}};
 const unknown={...tiny,event_id:`swe_${'1'.repeat(40)}`,economic:{destination_asset:{contract:EVM_TOKEN_TWO,symbol:'UNKNOWN',amount_base_units:'25',decimals:null}}};
 await page.route('**/api/v1/wallet-copy/inspect',route=>route.fulfill({status:200,contentType:'application/json',body:publicPayload({ok:true,source_wallet_id:EVM_SOURCE_ID,profile:snapshot,activity:activityPage([sell,buy,tiny,unknown])})}));
 await page.goto(`/account/copy/?wallet=${EVM_WALLET}&chain=bsc`);
 const cards=page.locator('#copyRecentEvents');
 await expect(cards.locator('[data-activity-kind="SWAP_SELL"]')).toContainText('75 USDC');
 await expect(cards.locator('[data-activity-kind="SWAP_BUY"]')).toContainText('100 USDC');
 await expect(cards).not.toContainText('Cost basis');
 await expect(cards).not.toContainText('Unresolved');
 await expect(cards).toContainText('0.000000000000000001 COIN');
 await expect(cards).not.toContainText('25 UNKNOWN');
 await expect(page.locator('#copyActivityScope')).toContainText('Profit appears in the wallet overview');
 await expect(page.locator('#copyOverviewMetrics')).toContainText('Not reconstructed');
 await page.setViewportSize({width:390,height:844});
 await expect(cards).not.toContainText('Cost basis');
 if(process.env.RAVENOS_VISUAL_ARTIFACT_DIR)await page.locator('#copyWalletActivity').screenshot({path:join(process.env.RAVENOS_VISUAL_ARTIFACT_DIR,'wallet-activity-amounts-mobile.png')});
 expect(shared.requests.filter(row=>row.method==='POST'&&/watches|trade|execute/.test(row.path))).toEqual([]);
});

test('history loading has no invented completion percentage and explains pending data in the overview',async({page})=>{
 const shared={requests:[]};await install(page,shared);
 let inspectRequests=0;
 const snapshot=evmProfile();snapshot.coverage.trade_events=2;
 const pending={...deepHistory('queued'),chain:'bsc',signatures_indexed:9999,maximum_signatures:10000};
 await page.route('**/api/v1/wallet-copy/inspect',route=>{inspectRequests+=1;return route.fulfill({status:200,contentType:'application/json',body:publicPayload({ok:true,source_wallet_id:EVM_SOURCE_ID,profile:snapshot,recent_events:[],deep_history:pending})});});
 await page.goto(`/account/copy/?wallet=${EVM_WALLET}&chain=bsc`);
 await expect(page.locator('#copyOverviewScope')).toContainText('More history is being collected');
 await expect(page.locator('#copyDeepHistoryProgress')).not.toHaveAttribute('value',/.+/);
 await expect(page.locator('#copyDeepHistoryCount')).toHaveText('694 transactions loaded');
 await page.getByRole('link',{name:'Wallet profile · Pro',exact:true}).click();
 await expect(page.locator('#copyDeepHistoryProgress')).toBeVisible();
 for(const state of ['retry_wait','bounded_partial','complete']){
  await page.route(`**/api/v1/wallet-copy/wallets/${EVM_SOURCE_ID}`,route=>route.fulfill({status:200,contentType:'application/json',body:publicPayload({ok:true,source_wallet_id:EVM_SOURCE_ID,profile:snapshot,recent_events:[],deep_history:{...pending,state}})}));
  await page.getByRole('button',{name:'Refresh history status',exact:true}).click();
  if(state==='retry_wait'){
   await expect(page.locator('#copyDeepHistoryHeadline')).toHaveText('History update delayed');
   await expect(page.locator('#copyDeepHistoryProgress')).not.toHaveAttribute('value',/.+/);
  }else{
   await expect(page.locator('#copyDeepHistoryProgress')).toBeHidden();
   await expect(page.locator('#copyDeepHistoryDetail')).toContainText(state==='complete'?'30-day window':'Older activity');
  }
 }
 await page.setViewportSize({width:390,height:844});
 await expect(page.locator('#copyDeepHistoryHeadline')).toHaveText('Recent history loaded');
 await expect(page.locator('#copyOverviewMetrics')).toContainText('Not reconstructed');
 if(process.env.RAVENOS_VISUAL_ARTIFACT_DIR)await page.locator('#copyDeepHistory').screenshot({path:join(process.env.RAVENOS_VISUAL_ARTIFACT_DIR,'wallet-history-state-mobile.png')});
 expect(inspectRequests).toBe(1);
});

for(const [key,label,chain] of [['usdt','USDT','ethereum'],['binance_peg_usdt','USDT (Binance-Peg)','bsc'],['binance_peg_usdc','USDC (Binance-Peg)','bsc']]){
 test(`wallet overview preserves ${key} amounts and missing cost on desktop and mobile`,async({page})=>{
  const shared={requests:[]};await install(page,shared);
  const snapshot=evmProfile();snapshot.source_wallet.chain=chain;snapshot.source_wallet.chain_id=chain==='ethereum'?1:56;snapshot.coverage.trade_events=2;
  const id=normalizeSourceWalletChainIdentity({chain,network:'mainnet',address:EVM_WALLET}).source_wallet_id;
  const period={realized_pnl:{[key]:null},buy_count:1,sell_count:1,observations:0,buy_notional_by_basis:{[key]:{total:'100',average:'100'}},sell_notional_by_basis:{[key]:{total:'75'}}};
  snapshot.trading_record={basis_labels:{[key]:label},periods:{d30:period,all_available:period},tokens:[{mint:EVM_TOKEN_TWO,buy_count:1,sell_count:1,by_basis:{[key]:{remaining_cost:null,matched_proceeds:null,realized_pnl:null}}}]};
  await page.route('**/api/v1/wallet-copy/inspect',route=>route.fulfill({status:200,contentType:'application/json',body:publicPayload({ok:true,source_wallet_id:id,profile:snapshot,recent_events:[]})}));
  await page.goto(`/account/copy/?wallet=${EVM_WALLET}&chain=${chain}`);
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:900});
   await expect(page.locator('#copyOverviewMetrics')).toContainText(`100 ${label}`);
   await expect(page.locator('#copyOverviewMetrics')).toContainText(`75 ${label}`);
   await expect(page.locator('#copyOverviewMetrics')).toContainText('Not reconstructed');
   await expect(page.locator('#copyOverviewMetrics')).not.toContainText('+75');
  }
 });
}

test('verified EVM results show separate currencies and the coverage of unrealized marks on desktop and mobile',async({page})=>{
 const shared={requests:[]};await install(page,shared);
 const snapshot=evmProfile();snapshot.generated_at='2026-09-08T12:00:00Z';snapshot.coverage.trade_events=4;
 const period={realized_pnl:{usdg:'25',eth:'0.004'},roi_pct:null,win_rate_pct:50,buy_count:2,sell_count:2,observations:2,average_hold_seconds:1800,buy_notional_by_basis:{usdg:{average:'50',total:'100'}},sell_notional_by_basis:{usdg:{total:'125'}}};
 snapshot.trading_record={token_count:1,basis_labels:{usdg:'USDG',eth:'ETH'},periods:{d30:period,d7:period},unrealized_summary:{value_usd:'50',covered_tokens:1,visible_holdings:2},tokens:[{mint:EVM_TOKEN,buy_count:2,sell_count:2,unrealized_pnl_usd:'50',by_basis:{usdg:{matched_cost:'100',matched_proceeds:'125',realized_pnl:'25',remaining_cost:'50'}}}]};
 snapshot.trading_record.usd={priced_trades:2,eligible_trades:4,periods:{d30:{realized_pnl:{usd:'12.345'},observed_network_fee_usd:'0.013'}}};
 snapshot.balances_observed_at='2026-09-07T12:00:00Z';
 await page.route('**/api/v1/wallet-copy/inspect',route=>route.fulfill({status:200,contentType:'application/json',body:publicPayload({ok:true,source_wallet_id:EVM_SOURCE_ID,profile:snapshot,recent_events:[],persistence:{state:'shared_raven_profile'}})}));
 await page.goto(`/account/copy/?wallet=${EVM_WALLET}&chain=bsc`);
 await expect(page.locator('#copyOverviewMetrics')).toContainText('+25 USDG');
 await expect(page.locator('#copyOverviewMetrics')).toContainText('+0.004 ETH');
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
  await page.route('**/api/v1/wallet-copy/inspect',route=>route.fulfill({status:200,contentType:'application/json',body:publicPayload({ok:true,source_wallet_id:EVM_SOURCE_ID,profile:snapshot,recent_events:[]})}));
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

function cardSummary(overrides={}) {
  return {schema_version:'ravenos.wallet_card_summary.v1',as_of:'2026-09-08T12:00:00Z',
    age:{seconds_lower_bound:95*86400,first_observed_at:'2026-06-05T12:00:00Z',creation_date_known:false},
    transactions:{d1:21,d7:145,d30:1082,last_observed_at:'2026-09-08T11:59:00Z',window_complete:false},
    pnl:{usdc:'-123.45',sol:null,as_of:'2026-09-08T12:00:00Z',history_complete:false},...overrides};
}
async function installCardPage(page, summary=cardSummary(), cached=false) {
  await page.route('**/api/v1/wallet-copy/screener',route=>route.fulfill({status:200,contentType:'application/json',body:publicPayload({ok:true,rows:[],scope:{chain:'all'},pagination:{page:1,page_size:12},seen_wallets:{total:1,rows:[{
    source_wallet_id:SOURCE_ID,source_wallet:{chain:'solana',address:WALLET},history_available:cached,last_observed_at:'2026-09-08T12:00:00Z',cached_summary:summary,
    discovery_sources:[{kind:'kol',label:'KOL list',provider:'kolscan_public_daily',rank:1},{kind:'kol',label:'KOL list',provider:'kolscan_public_weekly',rank:2}],
  }]}})}));
}

test('wallet cards surface cached age, P&L and 1/7/30d unique transaction counts on mobile and desktop',async({page})=>{
  const shared={requests:[]};await install(page,shared,{marketEvidence:true});await installCardPage(page);
  await page.goto('/account/copy/?wallets=observed&obs_source=kol');
  const card=page.locator('.copy-seen-wallet');
  await expect(card).toContainText('95d+');await expect(card).toContainText('-$123.45');
  for(const [label,value] of [['1d','21 seen'],['7d','145 seen'],['30d','1,082 seen']]) {
    await expect(card.locator('.copy-card-metrics > div').filter({hasText:`Transactions · ${label}`})).toContainText(value);
  }
  await expect(card.locator('.copy-observed-source')).toHaveCount(0);await expect(card).not.toContainText(/kolscan/i);
  await expect(card).toContainText('age is a lower bound');
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:1000});await card.scrollIntoViewIfNeeded();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
    await captureVisual(page,`wallet-card-metrics-${width}`);
  }
  expect(shared.requests.some(row=>row.path.endsWith('/inspect'))).toBe(false);
});

test('unindexed wallets omit empty metric blocks while retained zero counts and zero P&L stay visible',async({page})=>{
  const shared={requests:[]};await install(page,shared);await installCardPage(page,null);
  await page.goto('/account/copy/?wallets=observed');
  await expect(page.locator('.copy-card-metrics')).toHaveCount(0);
  await expect(page.locator('.copy-seen-wallet')).toBeVisible();
  await installCardPage(page,cardSummary({transactions:{d1:0,d7:0,d30:1},pnl:{usdc:'0',sol:null}}));
  await page.reload();await expect(page.locator('.copy-card-metrics')).toContainText('0 seen');
  await expect(page.locator('.copy-card-metrics')).toContainText('+$0.00');
});

for (const cached of [false,true]) test(`expired ${cached?'cached':'new'} inspection restores sign-in with selected wallet and all-chain filters`,async({page})=>{
  const shared={requests:[]};await install(page,shared,{marketEvidence:true});await installCardPage(page,cardSummary(),cached);
  await page.route(cached?`**/api/v1/wallet-copy/wallets/${SOURCE_ID}`:'**/api/v1/wallet-copy/inspect',route=>route.fulfill({status:401,contentType:'application/json',body:'{"ok":false,"error":"authentication_required"}'}));
  await page.goto('/account/copy/?wallets=observed&obs_source=kol');
  await expect(page.locator('#copyAccessLabel')).toContainText('Pro active');
  await page.locator('.copy-seen-wallet').getByRole('button',{name:cached?'Open cached':'Inspect wallet',exact:true}).click();
  await expect(page.locator('#copySignIn')).toBeVisible();await expect(page.locator('#copyAuthStatus')).toContainText('session expired');
  await expect(page.locator('#copyAuthWallet')).toContainText(WALLET);await expect(page.locator('#copyWorkspace')).toBeHidden();
  await expect(page.locator('#copyAccessLabel')).not.toContainText('Pro active');
  const returnTo=await page.locator('#copySignIn input[name="return_to"]').first().inputValue();
  const url=new URL(returnTo,'https://app.ravenos.xyz');
  expect(url.pathname).toBe('/account/copy/');expect(url.searchParams.get('wallet')).toBe(WALLET);
  expect(url.searchParams.get('inspect_chain')).toBe('solana');expect(url.searchParams.get('obs_source')).toBe('kol');
  expect(url.searchParams.get('wallets')).toBe('observed');expect(url.searchParams.has('chain')).toBe(false);
  // A fresh authenticated page uses the saved selection without changing the all-chain screener.
  await page.unroute(cached?`**/api/v1/wallet-copy/wallets/${SOURCE_ID}`:'**/api/v1/wallet-copy/inspect');
  await page.goto(returnTo);await expect(page.locator('#copyProfile')).toBeVisible();
  await expect(page.locator('#copyWalletAddress')).toHaveValue(WALLET);
});

test('inspection network failure has a visible inline retry explanation and successful inspection updates cached card metrics',async({page})=>{
  const shared={requests:[]};await install(page,shared);await installCardPage(page,null);
  await page.route('**/api/v1/wallet-copy/inspect',route=>route.abort('failed'));
  await page.goto('/account/copy/?wallets=observed');
  const card=page.locator('.copy-seen-wallet');await card.getByRole('button',{name:'Inspect wallet',exact:true}).click();
  await expect(card.locator('.copy-card-status')).toContainText('could not finish');
  await expect(card.getByRole('button',{name:'Inspect wallet',exact:true})).toBeEnabled();await expect(page.locator('#copySignIn')).toBeHidden();
  await page.route('**/api/v1/wallet-copy/inspect',route=>route.fulfill({status:200,contentType:'application/json',body:publicPayload({ok:true,source_wallet_id:SOURCE_ID,profile:profile(),cached_summary:cardSummary(),recent_events:[]})}));
  await card.getByRole('button',{name:'Inspect wallet',exact:true}).click();await expect(page.locator('#copyProfile')).toBeVisible();
  await expect(card).toContainText('1,082 seen');await expect(card.getByRole('button',{name:'Open cached',exact:true})).toBeVisible();
});

test('stored analysis retries one temporary read failure and opens without fresh history calls',async({page})=>{
 const shared={requests:[]};await install(page,shared);let reads=0;
 await page.route(`**/api/v1/wallet-copy/wallets/${SOURCE_ID}`,async route=>{
  reads++;
  if(reads===1)return route.fulfill({status:503,contentType:'application/json',body:'{"error":"temporarily_unavailable"}'});
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,source_wallet_id:SOURCE_ID,profile:profile(),recent_events:[]})});
 });
 await page.setViewportSize({width:390,height:844});await page.goto('/account/copy/');
 await page.getByRole('button',{name:'View wallet',exact:true}).click();
 await expect(page.locator('#copyProfile')).toBeVisible();await expect(page.locator('#copyProfileAddress')).toHaveText(WALLET);
 await expect(page.locator('#copyWalletAddress')).toHaveValue(WALLET);
 await expect(page.locator('.copy-card-status')).toHaveCount(0);
 expect(reads).toBe(2);expect(shared.requests.some(row=>row.path.endsWith('/inspect'))).toBe(false);
});

for(const chain of ['base','ethereum','bsc','robinhood'])for(const observed of [false,true])test(`${chain} ${observed?'observed':'analyzed'} wallet opens its own cached profile after a temporary failure`,async({page})=>{
 const shared={requests:[]};await install(page,shared);
 const identity=normalizeSourceWalletChainIdentity({chain,network:'mainnet',address:EVM_WALLET});
 const sourceWallet={chain,network:'mainnet',chain_id:identity.chain_id,vm_family:'evm',address:EVM_WALLET};
 const cachedProfile=evmProfile();cachedProfile.source_wallet=sourceWallet;
 cachedProfile.capital_observations.native.symbol=chain==='bsc'?'BNB':'ETH';
 const row={...screenedWallet(),source_wallet_id:identity.source_wallet_id,source_wallet:sourceWallet};
 await page.route('**/api/v1/wallet-copy/screener',route=>route.fulfill({status:200,contentType:'application/json',body:publicPayload({
  ok:true,rows:observed?[]:[row],scope:{chain},pagination:{page:1,page_size:12},seen_wallets:{total:observed?1:0,rows:observed?[{
   source_wallet_id:identity.source_wallet_id,source_wallet:sourceWallet,history_available:true,last_observed_at:'2026-09-08T12:00:00Z',cached_summary:cardSummary(),
  }]:[]},
 })}));
 let reads=0;
 await page.route(`**/api/v1/wallet-copy/wallets/${identity.source_wallet_id}`,route=>{
  reads++;
  return route.fulfill({status:reads===1?503:200,contentType:'application/json',body:JSON.stringify(reads===1?{ok:false}:{
   ok:true,source_wallet_id:identity.source_wallet_id,profile:cachedProfile,recent_events:[],provider_request_performed:false,
  })});
 });
 await page.setViewportSize({width:390,height:844});
 await page.goto(`/account/copy/?chain=${chain}&wallets=${observed?'observed':'analyzed'}`);
 await page.getByRole('button',{name:observed?'Open cached':'View wallet',exact:true}).click();
 await expect(page.locator('#copyProfile')).toBeVisible();await expect(page.locator('#copyProfileAddress')).toHaveText(EVM_WALLET);
 await expect(page.locator('#copyWalletChain')).toHaveValue(chain);await expect(page.locator('#copyWalletAddress')).toHaveValue(EVM_WALLET);
 await expect(page.locator('.copy-card-status')).toHaveCount(0);expect(reads).toBe(2);
 expect(shared.requests.filter(row=>row.method==='POST'&&!row.path.endsWith('/screener'))).toEqual([]);
});

test('repeated cached-read network failure keeps cached retry instead of changing to a provider scan',async({page})=>{
 const shared={requests:[]};await install(page,shared);await installCardPage(page,cardSummary(),true);let reads=0;
 await page.route(`**/api/v1/wallet-copy/wallets/${SOURCE_ID}`,route=>{reads++;return route.abort('failed');});
 await page.goto('/account/copy/?wallets=observed');
 const card=page.locator('.copy-seen-wallet');await card.getByRole('button',{name:'Open cached',exact:true}).click();
 await expect(card.locator('.copy-card-status')).toContainText('Tap Open cached to retry');
 await expect(card.getByRole('button',{name:'Open cached',exact:true})).toBeEnabled();
 expect(reads).toBe(2);await expect(card).not.toContainText('Stored analysis is unavailable');
 expect(shared.requests.some(row=>row.path.endsWith('/inspect'))).toBe(false);
 await page.route(`**/api/v1/wallet-copy/wallets/${SOURCE_ID}`,route=>route.fulfill({status:200,contentType:'application/json',body:publicPayload({ok:true,source_wallet_id:SOURCE_ID,profile:profile(),recent_events:[]})}));
 await card.getByRole('button',{name:'Open cached',exact:true}).click();await expect(page.locator('#copyProfile')).toBeVisible();
 await expect(card.locator('.copy-card-status')).toHaveCount(0);
});

for(const [status,message] of [[403,'current access'],[404,'no longer available'],[429,'Too many requests']])test(`stored-analysis ${status} does not retry or launch a provider scan`,async({page})=>{
 const shared={requests:[]};await install(page,shared);let reads=0;
 await page.route(`**/api/v1/wallet-copy/wallets/${SOURCE_ID}`,route=>{reads++;return route.fulfill({status,contentType:'application/json',body:'{"ok":false}'});});
 await page.goto('/account/copy/');await page.getByRole('button',{name:'View wallet',exact:true}).click();
 await expect(page.locator('.copy-card-status')).toContainText(message);expect(reads).toBe(1);
 await expect(page.locator('#copyWalletAddress')).toHaveValue(WALLET);await expect(page.locator('#copyProfile')).toBeHidden();
 expect(shared.requests.some(row=>row.path.endsWith('/inspect'))).toBe(false);
});

test('coverage distinguishes Raven discovery from analyzed profiles and chain-wide wallet totals',async({page})=>{
 const shared={requests:[]};await install(page,shared);
 await page.route('**/api/v1/wallet-copy/screener',route=>route.fulfill({status:200,contentType:'application/json',body:publicPayload({ok:true,rows:[],scope:{chain:'solana'},index_coverage:{chains:[{chain:'solana',seen_wallets:1800,indexed_wallets:30}]},pagination:{page:1,page_size:12},seen_wallets:{total:0,rows:[]}})}));
 await page.goto('/account/copy/?chain=solana');
 await expect(page.locator('#copyScreenerCoverage')).toContainText('1,800 wallets discovered by Raven in Solana · 30 analyzed profiles');
 await expect(page.locator('#copyScreenerCoverage')).not.toContainText('1,800 analyzed profiles');
 expect(shared.requests.some(row=>row.path.endsWith('/inspect'))).toBe(false);
});

test('failed chain switch clears prior coverage and retries the selected cached index', async ({ page }) => {
 const shared = { requests: [] }; await install(page, shared); let failSolana = true;
 await page.route('**/api/v1/wallet-copy/screener', route => {
  const { chain } = route.request().postDataJSON();
  if (chain === 'solana' && failSolana) return route.fulfill({ status: 503, json: { ok: false } });
  return route.fulfill({ json: { ok: true, rows: [], scope: { chain },
   index_coverage: { chains: [{ chain, seen_wallets: 3500, indexed_wallets: 30 }] },
   pagination: { page: 1, page_size: 12 }, seen_wallets: { total: 0, rows: [] } } });
 });
 await page.goto('/account/copy/?chain=base&wallets=analyzed');
 await expect(page.locator('#copyScreenerCoverage')).toContainText('Base · 30 analyzed profiles');
 await page.getByRole('group', { name: 'Wallet chain', exact: true }).getByRole('button', { name: 'Solana', exact: true }).click();
 await expect(page.locator('#copyScreenerCoverage')).toContainText('Solana wallet index could not be loaded');
 await expect(page.locator('#copyScreenerCoverage')).not.toContainText('Base');
 await expect(page.locator('#copyScreenerPages')).toBeHidden();
 await expect(page.locator('#copyScreenerFilters')).toBeVisible();
 failSolana = false;
 await page.getByRole('button', { name: 'Retry wallet screener', exact: true }).click();
 await expect(page.locator('#copyScreenerCoverage')).toContainText('Solana · 30 analyzed profiles');
 expect(shared.requests.some(row => row.path.endsWith('/inspect'))).toBe(false);
});

for(const chain of ['base','ethereum','bsc','robinhood'])test(`${chain} empty analysis offers cached discovery without losing performance filters`,async({page})=>{
 const shared={requests:[]};await install(page,shared);const calls=[];
 await page.route('**/api/v1/wallet-copy/screener',route=>{
  const body=route.request().postDataJSON();calls.push(body);const observed=body.view==='observed';
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,rows:[],scope:{chain},index_coverage:{chains:[{chain,seen_wallets:3500,indexed_wallets:0}]},pagination:{page:1,page_size:12},seen_wallets:observed?{total:3500,rows:[{source_wallet_id:EVM_SOURCE_ID,source_wallet:{chain,network:'mainnet',address:EVM_WALLET},history_available:false,last_observed_at:'2026-09-08T12:00:00Z'}]}:null})});
 });
 await page.goto(`/account/copy/?chain=${chain}&wallets=analyzed`);
 await page.locator('#copyScreenTrades').fill('20');
 await page.getByRole('button',{name:'Browse 3,500 discovered wallets',exact:true}).click();
 await expect(page.locator('#copySeenWallets')).toBeVisible();await expect(page.locator('#copySeenResults')).toContainText(EVM_WALLET);
 await page.locator('[data-wallet-view="analyzed"]').click();
 await expect(page.locator('#copyScreenTrades')).toHaveValue('20');
 expect(calls.map(c=>c.view)).toEqual(['analyzed','observed','analyzed']);
 expect(shared.requests.some(row=>row.path.endsWith('/inspect'))).toBe(false);
});

test('wallet refresh keeps the current analysis visible while loading and after a failure', async ({ page }) => {
  await install(page, { requests: [] });
  await page.goto('/account/copy/');
  await page.locator('#copyWalletAddress').fill(WALLET);
  await page.getByRole('button', { name: 'Analyze wallet', exact: true }).click();
  await expect(page.locator('#copyProfile')).toBeVisible();
  const original = await page.locator('#copyProfile').innerText();
  let finishRefresh;
  const pending = new Promise(resolve => { finishRefresh = resolve; });
  await page.route('**/api/v1/wallet-copy/inspect', async route => {
    await pending;
    return route.fulfill({ status: 503, json: { ok: false, error: 'wallet_copy_response_too_large' } });
  });
  await page.locator('#copyRefreshProfile').click();
  await expect(page.locator('#copyProfile')).toBeVisible();
  await expect(page.locator('#copyProfile')).toContainText(WALLET);
  finishRefresh();
  await expect(page.locator('#copySearchStatus')).toContainText('previous analysis remains available');
  await expect(page.locator('#copyProfile')).toBeVisible();
  expect(await page.locator('#copyProfile').innerText()).toContain('Realized');
  expect(original).toContain(WALLET);
  await page.locator('#copyWalletAddress').fill('11111111111111111111111111111111');
  await page.getByRole('button', { name: 'Analyze wallet', exact: true }).click();
  await expect(page.locator('#copyProfile')).toBeHidden();
});

for (const chain of ['solana', 'base']) test(`${chain} loads all retained holdings in pages and keeps them on a stale-page response`, async ({ page }) => {
  await install(page, { requests: [] });
  await page.setViewportSize({ width: 390, height: 844 });
  const id = chain === 'solana' ? SOURCE_ID : EVM_SOURCE_ID;
  const model = chain === 'solana' ? profile() : { ...evmProfile(), source_wallet: { ...evmProfile().source_wallet, chain } };
  const tokens = Array.from({ length: 120 }, (_, index) => ({ mint: `holding-${index}`, contract: `holding-${index}`, symbol: `Holding ${index}`, balance_display: '12', provider_mark_value_usd: index }));
  if (chain === 'solana') model.holdings_snapshot = { chain, address: WALLET, state: 'available', observed_at: model.generated_at, native: { amount: 1 }, tokens };
  else model.positions.provider_reported_token_balances = tokens;
  let stale = false;
  const requests = [];
  await page.route('**/api/v1/wallet-copy/inspect', route => route.fulfill({ json: { ok: true, source_wallet_id: id,
    profile: projectWalletProfileDelivery(model), recent_events: [], deep_history: { state: 'not_enabled' } } }));
  await page.route(`**/api/v1/wallet-copy/wallets/${id}/holdings?**`, route => {
    requests.push(route.request().url());
    if (stale) return route.fulfill({ status: 409, json: { ok: false, error: 'wallet_holdings_snapshot_changed' } });
    return route.fulfill({ json: { ok: true, source_wallet_id: id, ...walletHoldingsPage(model, { cursor: new URL(route.request().url()).searchParams.get('cursor') }) } });
  });
  await page.goto('/account/copy/');
  await page.locator('#copyWalletChain').selectOption(chain);
  await page.locator('#copyWalletAddress').fill(chain === 'solana' ? WALLET : EVM_WALLET);
  await page.getByRole('button', { name: 'Analyze wallet', exact: true }).click();
  await expect(page.locator('#copyProfile')).toBeVisible();
  await page.getByRole('link', { name: 'Holdings', exact: true }).click();
  await expect(page.locator('#copyHoldingsTable')).toContainText('50 of 120');
  await page.getByRole('button', { name: 'Load more holdings', exact: true }).click();
  await expect(page.locator('#copyHoldingsTable')).toContainText('100 of 120');
  stale = true;
  await page.getByRole('button', { name: 'Load more holdings', exact: true }).click();
  await expect(page.locator('#copyHoldingsTable')).toContainText('A newer balance scan is available');
  await expect(page.locator('#copyHoldingsTable tbody tr')).toHaveCount(100);
  stale = false;
  await page.getByRole('button', { name: 'Load more holdings', exact: true }).click();
  await expect(page.locator('#copyHoldingsTable tbody tr')).toHaveCount(120);
  await expect(page.getByRole('button', { name: 'Load more holdings', exact: true })).toHaveCount(0);
  expect(requests).toHaveLength(3);
});

test('Copy uses the shared named strategy and pins each wallet until explicitly reapplied',async({page})=>{
 const shared={watch:null,decision:null,position:null,requests:[]};await install(page,shared);
 const initial=defaultTradingSettings();initial.strategies=[{id:'shared_exits',name:'Scale out',version:1,rules:[
  {id:'first',kind:'take_profit',trigger_pct:80,sell_pct:50},{id:'second',kind:'take_profit',trigger_pct:150,sell_pct:50},
  {id:'stop',kind:'stop_loss',trigger_pct:25,sell_pct:100}]}];initial.selected_strategy_id='shared_exits';
 const library=await mockTradingSettings(page,{initial,revision:1});
 await page.route('**/api/v1/wallet-copy/watches',async route=>{
  if(route.request().method()==='POST'){
   const body=route.request().postDataJSON();shared.watch=watch();shared.watch.policy.exit_strategy=body.policy.exit_strategy;
   return route.fulfill({status:201,json:{ok:true,watch:shared.watch}});
  }
  return route.fallback();
 });
 const applied=[];await page.route(`**/api/v1/wallet-copy/watches/${WATCH_ID}`,route=>{
  if(route.request().method()!=='PATCH')return route.fallback();
  const body=route.request().postDataJSON();applied.push(body);
  if(body.expected_revision!==shared.watch.revision)return route.fulfill({status:409,json:{ok:false}});
  shared.watch.policy=body.policy;shared.watch.revision++;return route.fulfill({json:{ok:true,watch:shared.watch}});
 });
 await page.goto('/account/copy/');await page.locator('.copy-screener-card').getByRole('button',{name:'Copy',exact:true}).click();
 await expect(page.locator('#copyPolicyExitStrategy')).toHaveValue('shared_exits');
 await page.getByRole('button',{name:'Start Raven Copy',exact:true}).click();await expect(page.locator('#copyWatches')).toContainText('Scale out · v1');
 expect(shared.watch.policy.exit_strategy.rules).toHaveLength(3);
 library.settings.strategies[0].version=2;library.settings.strategies[0].name='Revised exits';library.revision=2;
 await page.reload();await page.locator('[data-copy-view="watching"]').click();
 await expect(page.locator('#copyWatches')).toContainText('Scale out · v1');expect(applied).toEqual([]);
 await page.getByRole('button',{name:'Apply strategy',exact:true}).click();
 await expect(page.locator('#copyWatches')).toContainText('Revised exits · v2');expect(applied).toHaveLength(1);
 expect(applied[0].policy.exit_strategy.version).toBe(2);expect(shared.requests.some(r=>/execute|sign|submit/.test(r.path))).toBe(false);
});

function groupSnapshot(now=Date.now()) {
  const cards=Array.from({length:14},(_,i)=>({schema_version:2,expires_at:new Date(now+3600000).toISOString(),profile_id:`wallet_patient_${i}`,chain:'solana',
    address:i===0?WALLET:'2'.repeat(31)+'123456789ABCDEFG'[i],display_name:`Wallet ${i}`,categories:['Patient top holders'],summary:'PRIVATE_SUMMARY_NOT_FOR_BROWSER',
    data_status:i===13?'historical':'recent',actions:['view_profile','open_copy_setup']}));
  cards.push(...Array.from({length:10},(_,i)=>({schema_version:2,expires_at:new Date(now+3600000).toISOString(),profile_id:`wallet_base_${i}`,chain:'base',address:i===0?EVM_WALLET:`0x${String(i).padStart(40,'0')}`,display_name:'Base wallet',categories:['Regular trading'],summary:'PRIVATE_SUMMARY_NOT_FOR_BROWSER',data_status:'current',actions:['view_profile']})));
  return {schema_version:PUBLIC_WALLET_SNAPSHOT_SCHEMA,generated_at:new Date(now).toISOString(),cards,
    groups:[{group_id:'group_patient_sol',title:'Patient top holders',chain:'solana',profile_ids:cards.filter(c=>c.chain==='solana').map(c=>c.profile_id)},
      {group_id:'group_regular_base',title:'Regular trading',chain:'base',profile_ids:cards.filter(c=>c.chain==='base').map(c=>c.profile_id)},
      {group_id:'group_patient_all',title:'Patient top holders',chain:'all',profile_ids:cards.filter(c=>c.chain==='solana').map(c=>c.profile_id)},
      {group_id:'group_regular_all',title:'Regular trading',chain:'all',profile_ids:cards.filter(c=>c.chain==='base').map(c=>c.profile_id)}]};
}
async function installGroups(page,shared,{empty=false,fail=false,snapshot:makeSnapshot=groupSnapshot,now:readNow=()=>Date.now()}={}) {
  await install(page,shared,{walletGroups:true});
  await page.route('**/api/v1/wallet-copy/groups?*',async route=>{
    const url=new URL(route.request().url());shared.requests.push({method:'GET',path:url.pathname,search:url.search});
    if(typeof fail==='function'?fail():fail)return route.fulfill({status:503,json:{ok:false,error:'wallet_groups_unavailable'}});
    const now=readNow(),snapshot=makeSnapshot(now);if(empty){snapshot.cards=[];snapshot.groups=[];}
    const {cards,...paged}=publicWalletGroupPage(snapshot,normalizeWalletGroupQuery(url.searchParams),{copySetup:true,now});
    const rows=cards.map(card=>({source_wallet_id:card.address===WALLET?SOURCE_ID:normalizeSourceWalletChainIdentity({chain:card.chain,network:'mainnet',address:card.address}).source_wallet_id,
      source_wallet:{chain:card.chain,network:'mainnet',address:card.address},public_summary:card}));
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(publicWalletResponse({...paged,rows},{copySetup:true,now}))});
  });
}
for(const width of [390,1440])test(`Wallet groups show qualified styles and chain-specific cards at ${width}px`,async({page},info)=>{
  await page.setViewportSize({width,height:844});const shared={watch:null,decision:null,position:null,requests:[]};await installGroups(page,shared);
  await page.goto('/account/copy/?chain=all');
  await expect(page.locator('#copyGroupPanel')).toBeVisible();await expect(page.locator('#copyScreenerCount')).toHaveText('13 wallets');
  await expect(page.locator('#copyScreenerResults .copy-screener-card')).toHaveCount(12);
  await expect(page.locator('#copyGroupChoices')).toContainText('Patient top holders · All chains (13)');
  await expect(page.locator('#copyScreenerResults')).not.toContainText('PRIVATE_SUMMARY');
  expect(shared.requests.filter(r=>r.method==='POST')).toEqual([]);
  await page.locator('#copyScreenNext').click();await expect(page.locator('#copyScreenerResults .copy-screener-card')).toHaveCount(1);
  await page.locator('#copyGroupHistory').selectOption('all');await expect(page.locator('#copyScreenerCount')).toHaveText('14 wallets');
  await page.screenshot({path:info.outputPath(`wallet-groups-${width}.png`)});
  await page.locator('#copyScreenerResults .copy-screener-card').first().getByRole('button',{name:'View wallet',exact:true}).click();
  await expect(page.locator('#copyProfile')).toBeVisible();await expect(page.locator('#copyProfile')).toContainText('Patient top holders');
  await page.locator('[data-screen-chain="base"]').click();await expect(page.locator('#copyScreenerCount')).toHaveText('10 wallets');
  await expect(page.locator('#copyScreenerResults')).toContainText('Regular trading');await expect(page.locator('#copyScreenerResults').getByRole('button',{name:'Copy',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  expect(shared.requests.some(r=>/watches|sign|execute|broadcast/.test(r.path)&&r.method==='POST')).toBe(false);
});
test('Wallet groups with no admitted members fall back to populated wallet history without an empty tab',async({page})=>{
  const shared={watch:null,decision:null,position:null,requests:[]};await installGroups(page,shared,{empty:true});
  await page.goto('/account/copy/?wallets=groups');
  await expect(page.locator('#copyWalletGroupsTab')).toBeHidden();await expect(page.locator('#copyGroupPanel')).toBeHidden();
  await expect(page.locator('#copyScreenerResults .copy-screener-card')).toHaveCount(1);
});
test('Wallet groups provider failure offers a retry and does not display stale members',async({page})=>{
  const shared={watch:null,decision:null,position:null,requests:[]};await installGroups(page,shared,{fail:true});
  await page.goto('/account/copy/?wallets=groups');await expect(page.getByRole('button',{name:'Retry wallet groups'})).toBeVisible();
  await expect(page.locator('#copyScreenerResults .copy-screener-card')).toHaveCount(0);expect(shared.requests.filter(r=>r.method==='POST')).toEqual([]);
});

test('Wallet groups rotate on the next refresh while preserving category, page and unsaved research text',async({page})=>{
  await page.clock.install();
  let now=Date.now();const snapshot=groupSnapshot(now),shared={watch:null,decision:null,position:null,requests:[]};
  await installGroups(page,shared,{snapshot:()=>snapshot,now:()=>now});await page.goto('/account/copy/?chain=all&wallets=groups');
  await expect(page.locator('#copyScreenerCount')).toHaveText('13 wallets');
  await page.locator('#copyScreenNext').click();await expect(page.locator('#copyScreenPage')).toHaveText('Page 2 of 2');
  await page.locator('#copySaveListName').fill('My unsaved research label');
  const next=snapshot.cards[13];next.data_status='recent';
  snapshot.groups.find(g=>g.group_id==='group_patient_all').profile_ids=snapshot.groups.find(g=>g.group_id==='group_patient_all').profile_ids.filter(id=>id!=='wallet_patient_0');
  now+=60_001;snapshot.generated_at=new Date(now).toISOString();await page.clock.fastForward(60_001);
  await expect(page.locator('#copyScreenerResults')).toContainText(next.address);
  await expect(page.locator('#copyScreenerCount')).toHaveText('13 wallets');await expect(page.locator('#copyScreenPage')).toHaveText('Page 2 of 2');
  await expect(page.locator('#copyGroupChoices button[aria-pressed="true"]')).toContainText('Patient top holders');
  await expect(page.locator('#copySaveListName')).toHaveValue('My unsaved research label');
  expect(shared.requests.some(r=>r.method==='POST'&&/watches|sign|execute|broadcast/.test(r.path))).toBe(false);
});

test('Wallet groups expire without a successful refresh and rebuild the same selection when new members qualify',async({page})=>{
  await page.clock.install();
  let now=Date.now(),fail=false;const snapshot=groupSnapshot(now),shared={watch:null,decision:null,position:null,requests:[]};
  const group=snapshot.groups.find(g=>g.group_id==='group_patient_all');group.profile_ids=group.profile_ids.slice(0,10);
  snapshot.cards[0].expires_at=new Date(now+2000).toISOString();
  await installGroups(page,shared,{snapshot:()=>snapshot,now:()=>now,fail:()=>fail});await page.goto('/account/copy/?chain=all&wallets=groups');
  await expect(page.locator('#copyScreenerCount')).toHaveText('10 wallets');
  now+=2100;fail=true;await page.clock.fastForward(2100);
  await expect(page.getByRole('button',{name:'Retry wallet groups'})).toBeVisible();
  await expect(page.locator('#copyScreenerResults .copy-screener-card')).toHaveCount(0);
  fail=false;await page.getByRole('button',{name:'Retry wallet groups'}).click();
  await expect(page.locator('#copyScreenerCount')).toHaveText('Building coverage');
  await expect(page.locator('#copyScreenerStatus')).toContainText('Patient top holders is building coverage');
  await expect(page.locator('#copyGroupChoices button[aria-pressed="true"]')).toHaveCount(0);
  const next=snapshot.cards[13];next.data_status='recent';group.profile_ids=group.profile_ids.filter(id=>id!=='wallet_patient_0');group.profile_ids.push(next.profile_id);
  now+=60_001;snapshot.generated_at=new Date(now).toISOString();await page.clock.fastForward(60_001);
  await expect(page.locator('#copyScreenerCount')).toHaveText('10 wallets');
  await expect(page.locator('#copyScreenerResults')).toContainText(next.address);
  await expect(page.locator('#copyScreenerResults')).not.toContainText(snapshot.cards[0].address);
  await expect(page.locator('#copyGroupChoices button[aria-pressed="true"]')).toContainText('Patient top holders');
  expect(shared.requests.some(r=>r.method==='POST'&&/watches|sign|execute|broadcast/.test(r.path))).toBe(false);
});

test('Wallet groups stop showing current members when publication is older than five minutes',async({page})=>{
  await page.clock.install();let now=Date.now();const snapshot=groupSnapshot(now),shared={watch:null,decision:null,position:null,requests:[]};
  await installGroups(page,shared,{snapshot:()=>snapshot,now:()=>now});await page.goto('/account/copy/?chain=all&wallets=groups');
  await expect(page.locator('#copyScreenerCount')).toHaveText('13 wallets');now+=300_001;await page.clock.fastForward(300_001);
  await expect(page.locator('#copyScreenerStatus')).toContainText('waiting for a fresh update');
  await expect(page.locator('#copyScreenerResults .copy-screener-card')).toHaveCount(0);
  expect(shared.requests.filter(r=>r.path==='/api/v1/wallet-copy/groups').length).toBeLessThanOrEqual(4);
});

test('Wallet groups recover from a hanging refresh without leaving a perpetual loading state',async({page})=>{
  await page.clock.install();const shared={watch:null,decision:null,position:null,requests:[]};await installGroups(page,shared);
  await page.goto('/account/copy/?chain=all&wallets=groups');await expect(page.locator('#copyScreenerCount')).toHaveText('13 wallets');
  let release,started=false;const paused=new Promise(resolve=>{release=resolve;});
  await page.route('**/api/v1/wallet-copy/groups?*',async route=>{started=true;await paused;await route.abort().catch(()=>{});});
  try {
    await page.clock.fastForward(60_001);await expect.poll(()=>started).toBe(true);
    await page.clock.fastForward(15_001);
    await expect(page.getByRole('button',{name:'Retry wallet groups'})).toBeVisible();
    await expect(page.locator('#copyScreenerResults .copy-screener-card')).toHaveCount(0);
  } finally {release();}
});

test('wallet overlay loads versioned production styles, fits a phone and preserves the chart draft',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});await mockTerminalLiveApis(page,{spotQuotePreview:true});
  const shared={watch:null,decision:null,position:null,requests:[]};await install(page,shared);
  const css=readFileSync(join(process.cwd(),'ravenos-wallet-copy.css'),'utf8');
  const hashed=`/assets/ravenos-wallet-copy.${createHash('sha256').update(css).digest('hex').slice(0,16)}.css`;
  const bare=[];
  await page.route('**/ravenos-wallet-copy.css',route=>{bare.push(route.request().url());return route.fulfill({status:404,body:'not found'});});
  await page.route(`**${hashed}`,route=>route.fulfill({contentType:'text/css',body:css}));
  await page.route('**/account/copy/',async route=>{const response=await route.fetch();const html=(await response.text()).replace('href="/ravenos-wallet-copy.css"',`href="${hashed}"`);await route.fulfill({response,body:html});});
  await page.goto('/terminal/?instrument_id=solana%3Apool%3Afixture-pair-address&lane=spot&market=spot&instrument_type=exact_pool&token_address=fixture-token-address&quote_address=fixture-quote-address&panel=chart');
  await waitForTerminalLive(page,{lane:'spot'});await page.locator('#terminalSpotAmount').fill('42');
  const original=page.url();await page.locator('#rosCommandTrigger').click();await page.locator('#rosCommandInput').fill(WALLET);await page.locator('.ros-command-result.wallet').click();
  await expect(page.locator('.ros-intelligence-layer #copyProfile')).toBeVisible();await page.getByRole('button',{name:'Wallets & Copy',exact:true}).click();
  const cards=page.locator('.ros-intelligence-layer .copy-screener-card');await expect(cards).toHaveCount(1);
  const measurements=await page.evaluate(()=>{
    const layer=document.querySelector('.ros-layer-body'),card=layer.querySelector('.copy-screener-card');
    return {bodyWidth:layer.clientWidth,scrollWidth:layer.scrollWidth,cardDisplay:getComputedStyle(card).display,fontSize:parseFloat(getComputedStyle(card.querySelector('.copy-screener-thesis p')).fontSize)};
  });
  expect(measurements.cardDisplay).toBe('grid');expect(measurements.fontSize).toBeGreaterThanOrEqual(13);expect(measurements.scrollWidth).toBeLessThanOrEqual(measurements.bodyWidth+1);expect(bare).toEqual([]);
  await cards.first().scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('wallet-overlay-versioned-css-390.png')});
  await page.locator('.ros-layer-close').click();await expect(page).toHaveURL(original);await expect(page.locator('#terminalSpotAmount')).toHaveValue('42');
  expect(shared.requests.some(r=>r.method==='POST'&&/watches|sign|execute|broadcast/.test(r.path))).toBe(false);
});

test('wallet browsing starts with analyzed profiles when raw observations also exist',async({page})=>{
  const shared={requests:[]};await install(page,shared);
  await page.route('**/api/v1/wallet-copy/screener',route=>route.fulfill({status:200,contentType:'application/json',body:publicPayload({ok:true,schema_version:'ravenos.wallet_screener.v1',rows:[screenedWallet()],scope:{chain:'all'},
    pagination:{page:1,page_size:12,total:1,total_pages:1},seen_wallets:{total:38278,rows:[{source_wallet_id:SOURCE_ID,source_wallet:{chain:'solana',address:WALLET},history_available:false}]}})}));
  await page.goto('/account/copy/');await expect(page.locator('[data-wallet-view="analyzed"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#copyScreenerResults .copy-screener-card')).toHaveCount(1);await expect(page.locator('#copySeenWallets')).toBeHidden();
});
