import { createHash } from "node:crypto";

import { normalizeSourceWalletChainIdentity } from "./source_wallet_chain_identity.mjs";

export const ROBINHOOD_WALLET_PROFILE_SCHEMA = "ravenos.robinhood_wallet_profile.v1";
export const ROBINHOOD_CHAIN_EVENT_SCHEMA = "ravenos.source_wallet_chain_event.v1";

const TRADE_KINDS = new Set(["SWAP_BUY", "SWAP_SELL", "MULTIHOP_SWAP"]);
const MAX_EVENTS = 10_000;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function timestamp(value, field) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) fail(`${field}_invalid`);
  return new Date(parsed).toISOString();
}

function ratio(numerator, denominator) {
  return denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(2)) : null;
}

function median(values) {
  const rows = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!rows.length) return null;
  const middle = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[middle] : Number(((rows[middle - 1] + rows[middle]) / 2).toFixed(4));
}

function eventTime(event) {
  const value = Date.parse(event?.timing?.detected_at || event?.timing?.decoded_at || "");
  return Number.isFinite(value) ? value : null;
}

function historyContract(history, eventCount) {
  const providerHistoryExhausted = history?.provider_history_exhausted === true || history?.history_exhausted === true;
  const sourceHistoryComplete = history?.source_history_verified_complete === true && providerHistoryExhausted;
  return Object.freeze({
    history_scope: providerHistoryExhausted ? "provider_window_exhausted" : "bounded_partial_history",
    source_history_complete: sourceHistoryComplete,
    provider_history_exhausted: providerHistoryExhausted,
    provider: typeof history?.provider === "string" ? history.provider.slice(0, 80) : null,
    requested_transactions: Number.isSafeInteger(Number(history?.requested_transactions)) ? Number(history.requested_transactions) : null,
    normalized_events: eventCount,
  });
}

export function buildRobinhoodWalletProfile(events = [], {
  generated_at: generatedAt = new Date().toISOString(),
  history = null,
} = {}) {
  const input = Array.isArray(events) ? events : [];
  if (input.length > MAX_EVENTS) fail("robinhood_wallet_profile_event_limit");
  const rows = input.filter((event) => event?.schema_version === ROBINHOOD_CHAIN_EVENT_SCHEMA);
  if (!rows.length || rows.length !== input.length) fail("robinhood_wallet_profile_events_invalid");
  const generatedAtIso = timestamp(generatedAt, "robinhood_wallet_profile_generated_at");
  const source = rows[0]?.source_wallet;
  const identity = normalizeSourceWalletChainIdentity({
    chain: source?.chain,
    network: source?.network,
    chain_id: source?.chain_id,
    address: source?.address,
  });
  if (identity.chain !== "robinhood") fail("robinhood_wallet_profile_chain_invalid");
  if (rows.some((event) => (
    event.source_wallet_id !== identity.source_wallet_id
    || event.source_wallet?.address !== identity.address
    || event.source_wallet?.chain !== identity.chain
    || event.source_wallet?.network !== identity.network
    || String(event.source_wallet?.chain_id) !== String(identity.chain_id)
    || event.source_wallet?.vm_family !== identity.vm_family
  ))) fail("robinhood_wallet_profile_owner_mismatch");
  if (new Set(rows.map((event) => event.event_id)).size !== rows.length) fail("robinhood_wallet_profile_duplicate_event");

  const ordered = [...rows].sort((left, right) => (eventTime(left) || 0) - (eventTime(right) || 0) || left.event_id.localeCompare(right.event_id));
  const trades = ordered.filter((event) => TRADE_KINDS.has(event.classification?.kind));
  const tradeTimes = trades.map(eventTime).filter(Number.isFinite);
  const observedTimes = ordered.map(eventTime).filter(Number.isFinite);
  const activeDays = new Set(tradeTimes.map((value) => new Date(value).toISOString().slice(0, 10))).size;
  const classifications = Object.fromEntries([...new Set(ordered.map((event) => event.classification.kind))].sort().map((kind) => [
    kind,
    ordered.filter((event) => event.classification.kind === kind).length,
  ]));
  const assetIds = new Set();
  for (const event of trades) {
    for (const asset of event.economic?.asset_deltas || []) {
      if (asset?.asset_id && asset.settlement_asset !== true) assetIds.add(asset.asset_id);
    }
  }
  const confirmed = ordered.filter((event) => event.chain_evidence?.independent_provider_confirmation_complete === true).length;
  const routeCandidates = ordered.filter((event) => event.copy_signal?.source_signal_ready === true).length;
  const decodeLatencies = ordered.map((event) => Number(event.timing?.decode_latency_ms)).filter((value) => Number.isFinite(value) && value >= 0);
  const historyState = historyContract(history, ordered.length);
  const providerConfirmationCoverage = ratio(confirmed, ordered.length);
  const quality = Object.freeze({
    history_scope: historyState.history_scope,
    history_complete: historyState.source_history_complete,
    provider_history_exhausted: historyState.provider_history_exhausted,
    provider: historyState.provider,
    trade_decode_coverage_pct: 100,
    classification_coverage_pct: 100,
    independent_provider_confirmation_coverage_pct: providerConfirmationCoverage,
    cost_basis_coverage_pct: 0,
    historical_price_evidence_coverage_pct: null,
    entry_liquidity_evidence_coverage_pct: null,
    reconstruction_confidence_pct: providerConfirmationCoverage,
    full_data_confidence_pct: null,
    full_data_confidence_state: "insufficient_cost_basis_price_and_liquidity_evidence",
  });

  return freeze({
    schema_version: ROBINHOOD_WALLET_PROFILE_SCHEMA,
    profile_version: 1,
    source_wallet: {
      chain: identity.chain,
      network: identity.network,
      chain_id: identity.chain_id,
      vm_family: identity.vm_family,
      address: identity.address,
    },
    generated_at: generatedAtIso,
    coverage: {
      first_observed_at: observedTimes.length ? new Date(Math.min(...observedTimes)).toISOString() : null,
      last_observed_at: observedTimes.length ? new Date(Math.max(...observedTimes)).toISOString() : null,
      transactions_observed: new Set(ordered.map((event) => event.chain_evidence.transaction_reference)).size,
      normalized_events: ordered.length,
      trade_events: trades.length,
      known_cost_basis_pct: 0,
      known_cost_basis_observations: 0,
      unresolved_cost_basis_observations: trades.length,
      historical_reconstruction: false,
      prospective_observations: ordered.length,
      history_scope: historyState.history_scope,
      source_history_complete: historyState.source_history_complete,
      provider_history_exhausted: historyState.provider_history_exhausted,
    },
    source_performance: {
      state: "insufficient_evidence",
      realized_pnl_usdc: null,
      realized_pnl_sol: null,
      roi_pct: null,
      win_rate_pct: null,
      closed_lots: 0,
      closed_observations: 0,
      profit_factor: null,
      by_basis: {},
      marked_value_usdc: null,
      executable_liquidation_value_usdc: null,
      limitations: [
        "Observed swaps establish wallet activity but do not yet establish historical token decimals, cost basis, or executable proceeds.",
        "USDG, WETH, and native ETH remain distinct; none is silently relabeled as canonical USDC.",
        "Performance remains unavailable until bounded archive backfill and evidence-bound asset valuation are complete.",
      ],
    },
    behavior: {
      active_days: activeDays,
      trade_count: trades.length,
      first_trade_at: tradeTimes.length ? new Date(Math.min(...tradeTimes)).toISOString() : null,
      last_trade_at: tradeTimes.length ? new Date(Math.max(...tradeTimes)).toISOString() : null,
      tokens_traded: assetIds.size,
      trade_rate_per_active_day: activeDays ? Number((trades.length / activeDays).toFixed(4)) : null,
      buy_count: classifications.SWAP_BUY || 0,
      sell_count: classifications.SWAP_SELL || 0,
      multihop_count: classifications.MULTIHOP_SWAP || 0,
      median_hold_seconds: null,
      repeat_token_rate_pct: null,
      mechanical_pattern_evidence: { state: "insufficient_evidence", identity_claimed: false },
      classifications,
    },
    profit_quality: {
      state: "insufficient_evidence",
      concentration_basis: null,
      top_1_profit_concentration_pct: null,
      top_5_profit_concentration_pct: null,
      profitable_observations: null,
      weekly_profitable_pct: null,
    },
    positions: {
      known_cost_open_positions: [],
      known_cost_open_position_count: 0,
      unresolved_cost_basis_event_count: trades.length,
      marked_values_available: false,
      executable_values_available: false,
    },
    capital_observations: {
      scope: "not_sampled",
      current_balance_claimed: false,
      native_eth: { amount: null, observed_at: null, state: "unavailable" },
      canonical_usdc: { amount: null, observed_at: null, state: "unavailable" },
      usdg: { amount: null, observed_at: null, state: "unavailable", canonical_usdc: false },
      stablecoin_balance_combined: null,
      portfolio_value_usdc: null,
      executable_portfolio_value_usdc: null,
    },
    entry_quality: {
      state: "unavailable",
      historical_market_cap_at_entry: null,
      historical_liquidity_at_entry: null,
      asset_age_at_entry: null,
      reason: "contemporaneous_historical_market_evidence_not_retained",
    },
    exit_behavior: {
      state: "insufficient_evidence",
      median_hold_seconds: null,
      limitation: "Prospective buys and sells are not paired into historical lots without complete bounded history and asset metadata.",
    },
    data_quality: quality,
    copy_readiness: {
      state: "route_proof_required",
      prospective_signals_observed: routeCandidates,
      independently_confirmed_signal_pct: providerConfirmationCoverage,
      median_decode_latency_ms: median(decodeLatencies),
      executable_copy_pct: null,
      policy_pass_pct: null,
      follower_capture_ratio_pct: null,
      copyability_by_order_size: [],
      source_performance_substituted: false,
    },
    evidence: {
      profile_hash: createHash("sha256").update(ordered.map((event) => event.evidence_hash).join("|")).digest("hex").slice(0, 40),
      accounting_method: "activity_only_until_bounded_evm_lot_reconstruction",
      value_method: "exact_net_base_unit_deltas_without_unproved_decimal_or_price_conversion",
      unknown_cost_basis_is_zero: false,
      transfers_treated_as_trades: false,
      canonical_usdc_inferred_from_symbol: false,
      current_marks_used_as_historical_fills: false,
      source_performance_used_as_copyability: false,
      live_execution_authorized: false,
    },
  });
}
