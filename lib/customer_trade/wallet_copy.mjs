import { createHash } from "node:crypto";

import {
  FeeCollectionMethods,
  createFeeCollectionPlan,
  createFeeCollectionResult,
  createShadowFeePolicy,
  createShadowFeeQuote,
} from "./fee_architecture.mjs";
import { SOLANA_WALLET_EVENT_SCHEMA, walletEventDisplayAmount } from "./solana_wallet_intelligence.mjs";

export const RAVEN_COPY_POLICY_SCHEMA = "ravenos.copy_policy.v1";
export const RAVEN_COPY_DECISION_SCHEMA = "ravenos.shadow_copy_decision.v1";
export const RAVEN_COPY_POSITION_SCHEMA = "ravenos.shadow_copy_position.v1";
export const RAVEN_COPYABILITY_SCHEMA = "ravenos.copyability_snapshot.v1";

export const RavenCopyFeeScenariosBps = Object.freeze([0, 5, 10, 20, 25, 50]);
export const RavenCopyStandardOrderSizesUsdc = Object.freeze([25, 100, 500, 1_000, 5_000]);
export const RavenCopyDecisionStates = Object.freeze([
  "SHADOW_EXECUTABLE",
  "POLICY_REJECTED",
  "ENTRY_UNAVAILABLE",
  "EXIT_UNAVAILABLE",
  "ROUTE_STALE",
  "SIMULATION_FAILED",
  "FUNDING_NOT_READY",
  "FRICTION_TOO_HIGH",
  "LIQUIDITY_TOO_LOW",
  "COPY_DELAY_TOO_HIGH",
  "ASSET_RESTRICTED",
  "PROVIDER_UNAVAILABLE",
  "INDETERMINATE",
]);

const DECISION_STATES = new Set(RavenCopyDecisionStates);
const SIZING_KINDS = new Set(["FIXED_USDC", "PERCENT_OF_ALLOCATED_CAPITAL", "PROPORTIONAL_TO_SOURCE_TRADE", "PROPORTIONAL_TO_SOURCE_POSITION_CHANGE"]);
const COPY_MODES = new Set(["MIRROR", "RAVEN_COPY"]);

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

function clean(value, field, maximum = 160, { optional = false } = {}) {
  const output = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if ((!optional && !output) || output.length > maximum) fail(`${field}_invalid`);
  return output;
}

function finite(value, field, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER, optional = false } = {}) {
  if (optional && (value === null || value === undefined || value === "")) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) fail(`${field}_invalid`);
  return parsed;
}

function integer(value, field, limits = {}) {
  const parsed = finite(value, field, limits);
  if (parsed !== null && !Number.isSafeInteger(parsed)) fail(`${field}_invalid`);
  return parsed;
}

function bool(value, fallback) {
  return value === undefined ? fallback : value === true;
}

function timestamp(value, field) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) fail(`${field}_invalid`);
  return new Date(parsed).toISOString();
}

function digest(parts) {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40);
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rounded(value, digits = 6) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function allowlist(values, allowed, field, maximum = 24) {
  const output = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = clean(value, field, 48).toLowerCase();
    if (!allowed.has(normalized)) fail(`${field}_invalid`);
    if (!output.includes(normalized)) output.push(normalized);
  }
  if (!output.length || output.length > maximum) fail(`${field}_invalid`);
  return output;
}

export function createRavenCopyPolicy(input = {}) {
  const mode = clean(input.mode || "RAVEN_COPY", "copy_mode", 20).toUpperCase();
  if (!COPY_MODES.has(mode)) fail("copy_mode_invalid");
  const sizingKind = clean(input.sizing?.kind || "FIXED_USDC", "sizing_kind", 48).toUpperCase();
  if (!SIZING_KINDS.has(sizingKind)) fail("sizing_kind_invalid");
  const fixedUsdc = finite(input.sizing?.fixed_usdc ?? 100, "fixed_usdc", { minimum: 1, maximum: 100_000 });
  const feeBps = integer(input.hypothetical_raven_fee_bps ?? 10, "hypothetical_raven_fee_bps", { minimum: 0, maximum: 50 });
  if (!RavenCopyFeeScenariosBps.includes(feeBps)) fail("copy_fee_scenario_not_allowlisted");
  const policy = {
    schema_version: RAVEN_COPY_POLICY_SCHEMA,
    policy_version: integer(input.policy_version ?? 1, "policy_version", { minimum: 1, maximum: 1_000_000 }),
    mode,
    sizing: {
      kind: sizingKind,
      fixed_usdc: fixedUsdc,
      percent_of_allocated_capital: sizingKind === "PERCENT_OF_ALLOCATED_CAPITAL"
        ? finite(input.sizing?.percent_of_allocated_capital, "percent_of_allocated_capital", { minimum: 0.1, maximum: 100 })
        : null,
      source_trade_ratio_pct: new Set(["PROPORTIONAL_TO_SOURCE_TRADE", "PROPORTIONAL_TO_SOURCE_POSITION_CHANGE"]).has(sizingKind)
        ? finite(input.sizing?.source_trade_ratio_pct, "source_trade_ratio_pct", { minimum: 0.01, maximum: 100 })
        : null,
      implemented: sizingKind === "FIXED_USDC",
    },
    allocation: {
      total_strategy_usdc: finite(input.allocation?.total_strategy_usdc ?? Math.max(1_000, fixedUsdc), "total_strategy_usdc", { minimum: fixedUsdc, maximum: 10_000_000 }),
      maximum_per_trade_usdc: finite(input.allocation?.maximum_per_trade_usdc ?? fixedUsdc, "maximum_per_trade_usdc", { minimum: 1, maximum: 100_000 }),
      minimum_per_trade_usdc: finite(input.allocation?.minimum_per_trade_usdc ?? Math.min(25, fixedUsdc), "minimum_per_trade_usdc", { minimum: 1, maximum: fixedUsdc }),
      maximum_concurrent_positions: integer(input.allocation?.maximum_concurrent_positions ?? 10, "maximum_concurrent_positions", { minimum: 1, maximum: 100 }),
      maximum_token_exposure_usdc: finite(input.allocation?.maximum_token_exposure_usdc ?? Math.max(500, fixedUsdc), "maximum_token_exposure_usdc", { minimum: fixedUsdc, maximum: 1_000_000 }),
      maximum_daily_notional_usdc: finite(input.allocation?.maximum_daily_notional_usdc ?? Math.max(1_000, fixedUsdc * 10), "maximum_daily_notional_usdc", { minimum: fixedUsdc, maximum: 10_000_000 }),
      maximum_daily_loss_usdc: finite(input.allocation?.maximum_daily_loss_usdc ?? Math.max(100, fixedUsdc), "maximum_daily_loss_usdc", { minimum: 1, maximum: 1_000_000 }),
      available_cash_reserve_usdc: finite(input.allocation?.available_cash_reserve_usdc ?? 0, "available_cash_reserve_usdc", { minimum: 0, maximum: 10_000_000 }),
    },
    execution_quality: {
      maximum_detection_delay_ms: integer(input.execution_quality?.maximum_detection_delay_ms ?? 30_000, "maximum_detection_delay_ms", { minimum: 250, maximum: 600_000 }),
      maximum_quote_age_ms: integer(input.execution_quality?.maximum_quote_age_ms ?? 15_000, "maximum_quote_age_ms", { minimum: 1_000, maximum: 60_000 }),
      maximum_entry_degradation_bps: integer(input.execution_quality?.maximum_entry_degradation_bps ?? 1_000, "maximum_entry_degradation_bps", { minimum: 0, maximum: 10_000 }),
      maximum_price_impact_bps: integer(input.execution_quality?.maximum_price_impact_bps ?? 500, "maximum_price_impact_bps", { minimum: 0, maximum: 10_000 }),
      maximum_round_trip_friction_pct: finite(input.execution_quality?.maximum_round_trip_friction_pct ?? 5, "maximum_round_trip_friction_pct", { minimum: 0, maximum: 100 }),
      minimum_executable_exit_usdc: finite(input.execution_quality?.minimum_executable_exit_usdc ?? 1, "minimum_executable_exit_usdc", { minimum: 0, maximum: 100_000 }),
      minimum_liquidity_usd: finite(input.execution_quality?.minimum_liquidity_usd ?? 25_000, "minimum_liquidity_usd", { minimum: 0, maximum: 10_000_000_000 }),
      require_source_price_comparison: bool(input.execution_quality?.require_source_price_comparison, false),
      require_executable_exit: bool(input.execution_quality?.require_executable_exit, true),
      allowed_chains: allowlist(input.execution_quality?.allowed_chains || ["solana"], new Set(["solana"]), "allowed_chain"),
      canonical_usdc_settlement_required: bool(input.execution_quality?.canonical_usdc_settlement_required, true),
    },
    safeguards: {
      skip_unresolved_asset: bool(input.safeguards?.skip_unresolved_asset, true),
      skip_failed_sell_simulation: bool(input.safeguards?.skip_failed_sell_simulation, true),
      skip_freeze_authority_when_evidenced: bool(input.safeguards?.skip_freeze_authority_when_evidenced, true),
      skip_mint_authority_when_evidenced: bool(input.safeguards?.skip_mint_authority_when_evidenced, false),
      skip_extreme_transfer_fee: bool(input.safeguards?.skip_extreme_transfer_fee, true),
      skip_malformed_metadata: bool(input.safeguards?.skip_malformed_metadata, true),
      minimum_token_age_seconds: integer(input.safeguards?.minimum_token_age_seconds ?? 0, "minimum_token_age_seconds", { minimum: 0, maximum: 31_536_000 }),
    },
    funding_assumption: clean(input.funding_assumption || "PREPOSITIONED_SOLANA_USDC_SHADOW", "funding_assumption", 64).toUpperCase(),
    exits: {
      mirror_source_sells: bool(input.exits?.mirror_source_sells, true),
      proportional_partial_exits: bool(input.exits?.proportional_partial_exits, true),
      ignore_pre_subscription_inventory: bool(input.exits?.ignore_pre_subscription_inventory, true),
    },
    hypothetical_raven_fee_bps: feeBps,
    execution_boundary: {
      shadow_only: true,
      signing_available: false,
      submission_available: false,
      live_copy_available: false,
      fee_collection_available: false,
    },
  };
  policy.policy_hash = digest([JSON.stringify(policy)]);
  return freeze(policy);
}

function routeEvidence(input, field) {
  if (!input || typeof input !== "object") return freeze({ state: "unavailable", reason: `${field}_unavailable` });
  const state = clean(input.state || "unavailable", `${field}_state`, 32).toLowerCase();
  return freeze({
    state,
    quote_id: clean(input.quote_id, `${field}_quote_id`, 160, { optional: true }) || null,
    provider: clean(input.provider || "unknown", `${field}_provider`, 64),
    requested_at: input.requested_at ? timestamp(input.requested_at, `${field}_requested_at`) : null,
    quoted_at: input.quoted_at ? timestamp(input.quoted_at, `${field}_quoted_at`) : null,
    received_at: input.received_at ? timestamp(input.received_at, `${field}_received_at`) : null,
    expires_at: input.expires_at ? timestamp(input.expires_at, `${field}_expires_at`) : null,
    expected_output: finite(input.expected_output, `${field}_expected_output`, { optional: true, maximum: 1e30 }),
    minimum_output: finite(input.minimum_output, `${field}_minimum_output`, { optional: true, maximum: 1e30 }),
    price_impact_bps: integer(input.price_impact_bps, `${field}_price_impact_bps`, { optional: true, maximum: 10_000 }),
    latency_ms: integer(input.latency_ms, `${field}_latency_ms`, { optional: true, maximum: 120_000 }),
    venues: Array.isArray(input.venues) ? input.venues.slice(0, 8).map((value) => clean(value, `${field}_venue`, 64)) : [],
    reason: clean(input.reason, `${field}_reason`, 100, { optional: true }) || null,
    exact_asset_identity: input.exact_asset_identity === true,
    transaction_material_available: false,
  });
}

function normalizedAssetEvidence(input = {}) {
  return freeze({
    identity_resolved: input.identity_resolved === true,
    token_standard: clean(input.token_standard || "unavailable", "token_standard", 48).toLowerCase(),
    token_standard_resolved: input.token_standard_resolved === true,
    sell_simulation_state: clean(input.sell_simulation_state || "not_requested", "sell_simulation_state", 32).toLowerCase(),
    reverse_sell_quote_state: clean(input.reverse_sell_quote_state || "unavailable", "reverse_sell_quote_state", 32).toLowerCase(),
    freeze_authority_present: typeof input.freeze_authority_present === "boolean" ? input.freeze_authority_present : null,
    mint_authority_present: typeof input.mint_authority_present === "boolean" ? input.mint_authority_present : null,
    transfer_fee_detected: typeof input.transfer_fee_detected === "boolean" ? input.transfer_fee_detected : null,
  });
}

function makeFeeEvidence(decisionId, policy, spendUsdc, grossExitUsdc) {
  const feePolicy = createShadowFeePolicy({ fee_bps: policy.hypothetical_raven_fee_bps, allow_custom_scenario: true });
  const entry = createShadowFeeQuote({
    policy: feePolicy,
    route_observation_id: decisionId,
    side: "buy",
    requested_trade_notional_usdc: spendUsdc,
  });
  const exit = grossExitUsdc === null ? null : createShadowFeeQuote({
    policy: feePolicy,
    route_observation_id: decisionId,
    side: "sell",
    gross_executable_proceeds_usdc: grossExitUsdc,
  });
  const entryPlan = createFeeCollectionPlan({ fee_quote: entry, method: FeeCollectionMethods.UNSUPPORTED });
  const exitPlan = exit ? createFeeCollectionPlan({ fee_quote: exit, method: FeeCollectionMethods.UNSUPPORTED }) : null;
  return freeze({
    scenario_bps: policy.hypothetical_raven_fee_bps,
    hypothetical: true,
    entry: createFeeCollectionResult({ fee_quote: entry, collection_plan: entryPlan }),
    exit: exit && exitPlan ? createFeeCollectionResult({ fee_quote: exit, collection_plan: exitPlan }) : null,
    entry_fee_usdc: entry.hypothetical_fee_usdc,
    exit_fee_usdc: exit?.hypothetical_fee_usdc ?? null,
    round_trip_fee_usdc: exit ? rounded(entry.hypothetical_fee_usdc + exit.hypothetical_fee_usdc) : null,
    collection_authorized: false,
    collected: false,
  });
}

function decide({ policy, sourceEvent, entry, exit, sourceNotionalUsdc, liquidityUsd, assetEvidence, nowMs }) {
  const detectionDelay = sourceEvent.timing.detection_delay_ms;
  const quoteAge = entry.quoted_at ? Math.max(0, nowMs - Date.parse(entry.quoted_at)) : null;
  const sourceTokenAmount = walletEventDisplayAmount(sourceEvent.economic.destination_asset);
  const followerTokensPerUsdc = entry.expected_output === null ? null : entry.expected_output / policy.sizing.fixed_usdc;
  const sourceTokensPerUsdc = sourceNotionalUsdc && sourceTokenAmount ? sourceTokenAmount / sourceNotionalUsdc : null;
  const entryDegradationBps = sourceTokensPerUsdc && followerTokensPerUsdc
    ? Math.round(Math.max(-1, (sourceTokensPerUsdc - followerTokensPerUsdc) / sourceTokensPerUsdc) * 10_000)
    : null;
  const grossExit = exit.expected_output;
  const roundTripExcluding = grossExit === null ? null : rounded(((policy.sizing.fixed_usdc - grossExit) / policy.sizing.fixed_usdc) * 100);
  if (!policy.sizing.implemented) return { state: "POLICY_REJECTED", reason: "sizing_mode_not_implemented", entry_degradation_bps: entryDegradationBps, round_trip_excluding_raven_pct: roundTripExcluding };
  if (!policy.execution_quality.allowed_chains.includes(sourceEvent.source_wallet.chain)) return { state: "ASSET_RESTRICTED", reason: "chain_not_allowed", entry_degradation_bps: entryDegradationBps, round_trip_excluding_raven_pct: roundTripExcluding };
  if (!sourceEvent.copy_signal.eligible_buy_signal || !sourceEvent.economic.destination_asset?.mint) return { state: "INDETERMINATE", reason: "source_event_not_copy_buy", entry_degradation_bps: entryDegradationBps, round_trip_excluding_raven_pct: roundTripExcluding };
  if (assetEvidence?.identity_resolved !== true && policy.safeguards.skip_unresolved_asset) return { state: "ASSET_RESTRICTED", reason: "exact_asset_identity_unresolved", entry_degradation_bps: entryDegradationBps, round_trip_excluding_raven_pct: roundTripExcluding };
  if (assetEvidence?.token_standard_resolved !== true && policy.safeguards.skip_unresolved_asset) return { state: "ASSET_RESTRICTED", reason: "token_standard_unresolved", entry_degradation_bps: entryDegradationBps, round_trip_excluding_raven_pct: roundTripExcluding };
  if (assetEvidence?.sell_simulation_state === "failed" && policy.safeguards.skip_failed_sell_simulation) return { state: "SIMULATION_FAILED", reason: "sell_simulation_failed", entry_degradation_bps: entryDegradationBps, round_trip_excluding_raven_pct: roundTripExcluding };
  if (assetEvidence?.freeze_authority_present === true && policy.safeguards.skip_freeze_authority_when_evidenced) return { state: "ASSET_RESTRICTED", reason: "freeze_authority_present", entry_degradation_bps: entryDegradationBps, round_trip_excluding_raven_pct: roundTripExcluding };
  if (detectionDelay !== null && detectionDelay > policy.execution_quality.maximum_detection_delay_ms) return { state: "COPY_DELAY_TOO_HIGH", reason: "detection_delay_exceeds_policy", entry_degradation_bps: entryDegradationBps, round_trip_excluding_raven_pct: roundTripExcluding };
  if (policy.funding_assumption !== "PREPOSITIONED_SOLANA_USDC_SHADOW") return { state: "FUNDING_NOT_READY", reason: "chain_local_usdc_not_ready", entry_degradation_bps: entryDegradationBps, round_trip_excluding_raven_pct: roundTripExcluding };
  if (entry.state === "provider_unavailable") return { state: "PROVIDER_UNAVAILABLE", reason: entry.reason || "entry_provider_unavailable", entry_degradation_bps: entryDegradationBps, round_trip_excluding_raven_pct: roundTripExcluding };
  if (entry.state !== "available" || entry.expected_output === null || entry.minimum_output === null) return { state: "ENTRY_UNAVAILABLE", reason: entry.reason || "entry_quote_unavailable", entry_degradation_bps: entryDegradationBps, round_trip_excluding_raven_pct: roundTripExcluding };
  if (quoteAge === null || quoteAge > policy.execution_quality.maximum_quote_age_ms || (entry.expires_at && Date.parse(entry.expires_at) <= nowMs)) return { state: "ROUTE_STALE", reason: "entry_quote_stale", entry_degradation_bps: entryDegradationBps, round_trip_excluding_raven_pct: roundTripExcluding };
  if (entry.price_impact_bps !== null && entry.price_impact_bps > policy.execution_quality.maximum_price_impact_bps) return { state: "POLICY_REJECTED", reason: "price_impact_exceeds_policy", entry_degradation_bps: entryDegradationBps, round_trip_excluding_raven_pct: roundTripExcluding };
  if (policy.execution_quality.require_executable_exit && (exit.state !== "available" || grossExit === null || exit.minimum_output === null)) return { state: "EXIT_UNAVAILABLE", reason: exit.reason || "reverse_exit_unavailable", entry_degradation_bps: entryDegradationBps, round_trip_excluding_raven_pct: roundTripExcluding };
  if (grossExit !== null && grossExit < policy.execution_quality.minimum_executable_exit_usdc) return { state: "EXIT_UNAVAILABLE", reason: "executable_exit_below_policy", entry_degradation_bps: entryDegradationBps, round_trip_excluding_raven_pct: roundTripExcluding };
  if (liquidityUsd !== null && liquidityUsd < policy.execution_quality.minimum_liquidity_usd) return { state: "LIQUIDITY_TOO_LOW", reason: "liquidity_below_policy", entry_degradation_bps: entryDegradationBps, round_trip_excluding_raven_pct: roundTripExcluding };
  if (liquidityUsd === null && policy.execution_quality.minimum_liquidity_usd > 0) return { state: "LIQUIDITY_TOO_LOW", reason: "liquidity_evidence_unavailable", entry_degradation_bps: entryDegradationBps, round_trip_excluding_raven_pct: roundTripExcluding };
  if (policy.execution_quality.require_source_price_comparison && entryDegradationBps === null) return { state: "INDETERMINATE", reason: "source_price_comparison_unavailable", entry_degradation_bps: null, round_trip_excluding_raven_pct: roundTripExcluding };
  if (entryDegradationBps !== null && entryDegradationBps > policy.execution_quality.maximum_entry_degradation_bps) return { state: "POLICY_REJECTED", reason: "entry_degradation_exceeds_policy", entry_degradation_bps: entryDegradationBps, round_trip_excluding_raven_pct: roundTripExcluding };
  if (roundTripExcluding !== null && roundTripExcluding > policy.execution_quality.maximum_round_trip_friction_pct) return { state: "FRICTION_TOO_HIGH", reason: "round_trip_friction_exceeds_policy", entry_degradation_bps: entryDegradationBps, round_trip_excluding_raven_pct: roundTripExcluding };
  return { state: "SHADOW_EXECUTABLE", reason: "all_shadow_policy_checks_passed", entry_degradation_bps: entryDegradationBps, round_trip_excluding_raven_pct: roundTripExcluding };
}

export function createRavenCopyDecision(input = {}, { now = Date.now() } = {}) {
  const sourceEvent = input.source_event;
  if (sourceEvent?.schema_version !== SOLANA_WALLET_EVENT_SCHEMA) fail("source_wallet_event_required");
  const policy = input.policy?.schema_version === RAVEN_COPY_POLICY_SCHEMA ? input.policy : createRavenCopyPolicy(input.policy);
  const watchId = clean(input.watch_id, "watch_id", 100);
  const entry = routeEvidence(input.entry, "entry");
  const exit = routeEvidence(input.exit, "exit");
  const assetEvidence = normalizedAssetEvidence(input.asset_evidence);
  const sourceNotionalUsdc = finite(input.source_notional_usdc, "source_notional_usdc", { optional: true, maximum: 1e12 });
  const liquidityUsd = finite(input.liquidity_usd, "liquidity_usd", { optional: true, maximum: 1e15 });
  const nowMs = Number(now);
  if (!Number.isFinite(nowMs)) fail("decision_time_invalid");
  const decisionId = `scd_${digest([watchId, sourceEvent.event_id, policy.policy_hash, entry.quote_id || entry.state, exit.quote_id || exit.state])}`;
  const resolution = decide({
    policy,
    sourceEvent,
    entry,
    exit,
    sourceNotionalUsdc,
    liquidityUsd,
    assetEvidence,
    nowMs,
  });
  if (!DECISION_STATES.has(resolution.state)) fail("copy_decision_state_invalid");
  const fees = makeFeeEvidence(decisionId, policy, policy.sizing.fixed_usdc, exit.expected_output);
  const includingRaven = resolution.round_trip_excluding_raven_pct === null || fees.round_trip_fee_usdc === null
    ? null
    : rounded(resolution.round_trip_excluding_raven_pct + ((fees.round_trip_fee_usdc / policy.sizing.fixed_usdc) * 100));
  return freeze({
    schema_version: RAVEN_COPY_DECISION_SCHEMA,
    decision_version: 1,
    decision_id: decisionId,
    watch_id: watchId,
    source_wallet: sourceEvent.source_wallet,
    source_event_id: sourceEvent.event_id,
    source_transaction: {
      signature: sourceEvent.chain_evidence.signature,
      slot: sourceEvent.chain_evidence.slot,
      block_time: sourceEvent.chain_evidence.block_time,
      classification: sourceEvent.classification.kind,
      effective_notional_usdc: sourceNotionalUsdc,
      notional_basis: sourceNotionalUsdc === null ? "unavailable" : clean(input.source_notional_basis || "observed_at_detection", "source_notional_basis", 64),
    },
    destination_asset: sourceEvent.economic.destination_asset,
    policy,
    intended_order: {
      economic_asset: "canonical_usdc",
      amount_usdc: policy.sizing.fixed_usdc,
      funding_state: policy.funding_assumption === "PREPOSITIONED_SOLANA_USDC_SHADOW" ? "shadow_prepositioned_assumption" : "not_ready",
      actual_balance_observed: false,
    },
    timing: {
      source_chain_event_at: sourceEvent.timing.chain_event_at,
      raven_received_at: sourceEvent.timing.raven_received_at,
      decode_completed_at: sourceEvent.timing.decode_completed_at,
      quote_started_at: entry.requested_at,
      quote_completed_at: entry.received_at,
      policy_decided_at: new Date(nowMs).toISOString(),
      detection_delay_ms: sourceEvent.timing.detection_delay_ms,
      decode_latency_ms: sourceEvent.timing.decode_latency_ms,
      entry_quote_latency_ms: entry.latency_ms,
      exit_quote_latency_ms: exit.latency_ms,
      total_decision_ms: sourceEvent.timing.raven_received_at ? Math.max(0, nowMs - Date.parse(sourceEvent.timing.raven_received_at)) : null,
    },
    entry,
    reverse_exit: exit,
    asset_evidence: assetEvidence,
    follower_reality: {
      source_notional_usdc: sourceNotionalUsdc,
      follower_order_usdc: policy.sizing.fixed_usdc,
      expected_token_output: entry.expected_output,
      minimum_token_output: entry.minimum_output,
      current_executable_exit_usdc: exit.expected_output,
      minimum_executable_exit_usdc: exit.minimum_output,
      entry_degradation_bps: resolution.entry_degradation_bps,
      round_trip_friction_excluding_raven_pct: resolution.round_trip_excluding_raven_pct,
      round_trip_friction_including_raven_pct: includingRaven,
      liquidity_usd: liquidityUsd,
      source_performance_used_as_follower_performance: false,
    },
    hypothetical_raven_fee: fees,
    decision: {
      state: resolution.state,
      reason_code: resolution.reason,
      shadow_position_created: resolution.state === "SHADOW_EXECUTABLE",
      refusal_is_zero_return: false,
    },
    evidence: {
      source_event: sourceEvent.chain_evidence.raw_evidence_reference,
      exact_asset_identity: assetEvidence.identity_resolved,
      quote_provider_claims_separate: true,
      historical_reconstruction_separate: true,
      prospective_observation: true,
    },
    execution_boundary: {
      mode: "shadow",
      signing_available: false,
      submission_available: false,
      broadcasting_available: false,
      transaction_material_available: false,
      fee_collection_available: false,
      transaction_hash: null,
    },
  });
}

export function createShadowCopyPosition(decision) {
  if (decision?.schema_version !== RAVEN_COPY_DECISION_SCHEMA || decision.decision?.state !== "SHADOW_EXECUTABLE") fail("executable_shadow_decision_required");
  return freeze({
    schema_version: RAVEN_COPY_POSITION_SCHEMA,
    position_id: `scp_${digest([decision.decision_id, decision.destination_asset.mint])}`,
    watch_id: decision.watch_id,
    source_wallet: decision.source_wallet,
    source_event_id: decision.source_event_id,
    opening_decision_id: decision.decision_id,
    destination_asset: decision.destination_asset,
    expected_quantity: decision.entry.expected_output,
    minimum_quantity: decision.entry.minimum_output,
    entry_cost_usdc: decision.intended_order.amount_usdc,
    state: "SHADOW_OPEN",
    opened_at: decision.timing.policy_decided_at,
    source_strategy_attribution_preserved: true,
    live_assets_held: false,
    transaction_hash: null,
    execution_boundary: decision.execution_boundary,
  });
}

export function buildCopyabilitySnapshot(decisions = [], { generated_at: generatedAt = new Date().toISOString(), order_size_usdc: orderSizeUsdc = null } = {}) {
  const rows = (Array.isArray(decisions) ? decisions : []).filter((row) => row?.schema_version === RAVEN_COPY_DECISION_SCHEMA);
  const prospective = rows.length;
  const executable = rows.filter((row) => row.decision.state === "SHADOW_EXECUTABLE");
  const entryAvailable = rows.filter((row) => row.entry.state === "available");
  const exitAvailable = rows.filter((row) => row.reverse_exit.state === "available");
  const values = (field) => rows.map((row) => numberOrNull(row.follower_reality?.[field])).filter((value) => value !== null).sort((a, b) => a - b);
  const med = (field) => {
    const list = values(field);
    if (!list.length) return null;
    const i = Math.floor(list.length / 2);
    return rounded(list.length % 2 ? list[i] : (list[i - 1] + list[i]) / 2);
  };
  const enough = prospective >= 20 && entryAvailable.length >= 15 && exitAvailable.length >= 15;
  const component = {
    detection_success_pct: null,
    detection_coverage_state: "unavailable_without_continuous_observer_denominator",
    entry_executable_pct: prospective ? rounded((entryAvailable.length / prospective) * 100, 2) : null,
    exit_executable_pct: prospective ? rounded((exitAvailable.length / prospective) * 100, 2) : null,
    policy_pass_pct: prospective ? rounded((executable.length / prospective) * 100, 2) : null,
    median_entry_degradation_bps: med("entry_degradation_bps"),
    median_round_trip_friction_pct: med("round_trip_friction_including_raven_pct"),
  };
  const score = enough
    ? Math.max(0, Math.min(100, Math.round(
        (component.entry_executable_pct * 0.25)
        + (component.exit_executable_pct * 0.3)
        + (component.policy_pass_pct * 0.3)
        + (Math.max(0, 100 - (component.median_round_trip_friction_pct || 0) * 10) * 0.15)
      )))
    : null;
  return freeze({
    schema_version: RAVEN_COPYABILITY_SCHEMA,
    score_version: 1,
    generated_at: timestamp(generatedAt, "copyability_generated_at"),
    order_size_usdc: orderSizeUsdc === null ? null : finite(orderSizeUsdc, "copyability_order_size", { minimum: 1, maximum: 100_000 }),
    state: enough ? "available" : "insufficient_evidence",
    score,
    confidence: prospective >= 100 ? "mature" : prospective >= 50 ? "developing" : prospective >= 20 ? "early" : "insufficient",
    prospective_sample_count: prospective,
    components: component,
    refusals: Object.fromEntries(RavenCopyDecisionStates.filter((state) => state !== "SHADOW_EXECUTABLE").map((state) => [state, rows.filter((row) => row.decision.state === state).length]).filter(([, count]) => count)),
    historical_estimates_included: false,
    unavailable_decisions_dropped: false,
  });
}

export function buildCopyabilityBySize(
  decisions = [],
  { generated_at: generatedAt = new Date().toISOString(), sizes_usdc: sizesUsdc = RavenCopyStandardOrderSizesUsdc } = {},
) {
  const sizes = [...new Set((Array.isArray(sizesUsdc) ? sizesUsdc : []).map((value) => finite(value, "copyability_order_size", { minimum: 1, maximum: 100_000 })))]
    .sort((left, right) => left - right);
  if (!sizes.length || sizes.length > 12) fail("copyability_order_sizes_invalid");
  const rows = (Array.isArray(decisions) ? decisions : []).filter((row) => row?.schema_version === RAVEN_COPY_DECISION_SCHEMA);
  return freeze(sizes.map((orderSizeUsdc) => buildCopyabilitySnapshot(
    rows.filter((row) => {
      const intended = numberOrNull(row?.intended_order?.amount_usdc ?? row?.follower_reality?.follower_order_usdc);
      return intended !== null && Math.abs(intended - orderSizeUsdc) < 0.000001;
    }),
    { generated_at: generatedAt, order_size_usdc: orderSizeUsdc },
  )));
}
