import { createHash } from "node:crypto";

import {
  RAVEN_COPY_DECISION_SCHEMA,
  RavenCopyFeeScenariosBps,
  RavenCopyStandardOrderSizesUsdc,
  buildCopyabilityBySize,
  createRavenCopyDecision,
  createRavenCopyPolicy,
} from "./wallet_copy.mjs";
import { SOLANA_WALLET_EVENT_SCHEMA } from "./solana_wallet_intelligence.mjs";
import { resolveSourceWalletObserverActivation } from "./source_wallet_observer.mjs";
import { buildSourceWalletCopyabilityOutcomeSummary } from "./source_wallet_copyability_checkpoints.mjs";

export const SOURCE_WALLET_COPYABILITY_OBSERVATION_SCHEMA = "ravenos.source_wallet_copyability_observation.v1";
export const SOURCE_WALLET_COPYABILITY_EVALUATION_SCHEMA = "ravenos.source_wallet_copyability_evaluation.v1";
export const SOURCE_WALLET_COPYABILITY_MATRIX_SCHEMA = "ravenos.source_wallet_copyability_matrix.v1";
export const SOURCE_WALLET_DETECTION_MARKET_CONTEXT_SCHEMA = "ravenos.source_wallet_detection_market_context.v1";

export const SourceWalletCopyabilityLimits = Object.freeze({
  standard_order_sizes_usdc: RavenCopyStandardOrderSizesUsdc,
  maximum_order_sizes_per_signal: RavenCopyStandardOrderSizesUsdc.length,
  maximum_quote_concurrency: 2,
  maximum_observations_per_source_profile: 5_000,
  observation_retention_seconds: 365 * 24 * 60 * 60,
  reference_order_size_usdc: 100,
});

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

function flag(value) {
  return String(value || "").trim() === "1";
}

function digest(parts) {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40);
}

function sourceId(value) {
  const normalized = String(value || "").trim();
  if (!/^sw_sol_[a-f0-9]{40}$/.test(normalized)) fail("source_wallet_copyability_source_id_invalid");
  return normalized;
}

function assertSourceEventIdentity(sourceWalletId, event) {
  if (event?.source_wallet?.chain !== "solana" || event?.source_wallet?.network !== "mainnet") {
    fail("source_wallet_copyability_event_identity_invalid");
  }
  const expected = `sw_sol_${digest(["solana", "mainnet", String(event.source_wallet.address || "")])}`;
  if (expected !== sourceWalletId) fail("source_wallet_copyability_event_identity_invalid");
}

function timestamp(value, field) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) fail(`${field}_invalid`);
  return new Date(parsed).toISOString();
}

function integer(value, field, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) fail(`${field}_invalid`);
  return parsed;
}

function optionalFinite(value, field, { minimum = 0, maximum = 1e15 } = {}) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) fail(`${field}_invalid`);
  return parsed;
}

function rounded(value, places = 4) {
  return value === null ? null : Number(Number(value).toFixed(places));
}

function median(values, places = 4) {
  const ordered = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!ordered.length) return null;
  const middle = Math.floor(ordered.length / 2);
  return rounded(ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2, places);
}

function coveragePercent(count, total) {
  return total > 0 ? Number(((count / total) * 100).toFixed(2)) : null;
}

function standardSizes(values = RavenCopyStandardOrderSizesUsdc) {
  const allowed = new Set(RavenCopyStandardOrderSizesUsdc);
  const output = [...new Set((Array.isArray(values) ? values : []).map(Number))].sort((left, right) => left - right);
  if (!output.length || output.length > SourceWalletCopyabilityLimits.maximum_order_sizes_per_signal || output.some((value) => !allowed.has(value))) {
    fail("source_wallet_copyability_order_sizes_invalid");
  }
  return output;
}

function normalizedFeeBps(value) {
  const feeBps = integer(value ?? 10, "source_wallet_copyability_fee_bps", { maximum: 50 });
  if (!RavenCopyFeeScenariosBps.includes(feeBps)) fail("source_wallet_copyability_fee_scenario_invalid");
  return feeBps;
}

function cleanReason(error, fallback = "copyability_provider_unavailable") {
  const value = String(error?.code || error?.message || fallback)
    .replace(/[^a-zA-Z0-9:_-]+/g, "_")
    .slice(0, 100);
  return value || fallback;
}

function unavailableEvidence(event, error) {
  const reason = cleanReason(error);
  const destination = event?.economic?.destination_asset || {};
  const standard = String(destination.standard || "").toLowerCase();
  const standardResolved = new Set(["spl", "spl_token_2022"]).has(standard);
  const partial = error?.copyability_evidence && typeof error.copyability_evidence === "object"
    ? error.copyability_evidence
    : null;
  return Object.freeze({
    source_notional_usdc: partial?.source_notional_usdc ?? null,
    source_notional_basis: partial?.source_notional_basis || "unavailable",
    liquidity_usd: partial?.liquidity_usd ?? null,
    market_context: partial?.market_context || null,
    asset_evidence: partial?.asset_evidence || {
      identity_resolved: Boolean(destination.mint),
      token_standard: standardResolved ? standard : "unresolved",
      token_standard_resolved: standardResolved,
      sell_simulation_state: "not_requested",
      reverse_sell_quote_state: "provider_unavailable",
    },
    entry: {
      state: "provider_unavailable",
      provider: "configured_copy_quote_provider",
      reason,
      exact_asset_identity: Boolean(destination.mint),
    },
    exit: {
      state: "provider_unavailable",
      provider: "configured_copy_quote_provider",
      reason,
      exact_asset_identity: Boolean(destination.mint),
    },
  });
}

export function createSourceWalletDetectionMarketContext(input = {}, { event } = {}) {
  const context = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const destinationMint = String(event?.economic?.destination_asset?.mint || "");
  const suppliedMint = String(context.token_mint || destinationMint);
  if (!destinationMint || suppliedMint !== destinationMint) fail("source_wallet_detection_market_context_asset_invalid");
  const observedAt = context.observed_at ? timestamp(context.observed_at, "source_wallet_detection_market_context_observed_at") : null;
  const chainEventAt = event?.timing?.chain_event_at
    ? timestamp(event.timing.chain_event_at, "source_wallet_detection_market_context_chain_event_at")
    : null;
  const pairAddress = String(context.pair_address || "").trim();
  if (pairAddress && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(pairAddress)) fail("source_wallet_detection_market_context_pair_invalid");
  const provider = String(context.provider || "").trim().toLowerCase();
  if (provider && !/^[a-z0-9._-]{2,40}$/.test(provider)) fail("source_wallet_detection_market_context_provider_invalid");
  const venue = String(context.venue || "").trim().toLowerCase();
  if (venue && !/^[a-z0-9._-]{1,64}$/.test(venue)) fail("source_wallet_detection_market_context_venue_invalid");
  const liquidityUsd = optionalFinite(context.liquidity_usd, "source_wallet_detection_market_context_liquidity");
  const marketCapUsd = optionalFinite(context.market_cap_usd, "source_wallet_detection_market_context_market_cap");
  const fullyDilutedValueUsd = optionalFinite(context.fully_diluted_value_usd, "source_wallet_detection_market_context_fdv");
  const pairAgeSeconds = optionalFinite(context.pair_age_seconds, "source_wallet_detection_market_context_pair_age", { maximum: 10_000_000_000 });
  const sourceTradeNotionalUsdc = optionalFinite(context.source_trade_notional_usdc, "source_wallet_detection_market_context_source_notional");
  const sourceTradeLiquidityPct = liquidityUsd && sourceTradeNotionalUsdc !== null
    ? rounded((sourceTradeNotionalUsdc / liquidityUsd) * 100, 6)
    : null;
  const evidenceCount = [liquidityUsd, marketCapUsd, fullyDilutedValueUsd, pairAgeSeconds].filter((value) => value !== null).length;
  const coreContextComplete = liquidityUsd !== null && marketCapUsd !== null && pairAgeSeconds !== null;
  const state = coreContextComplete ? "available" : evidenceCount > 0 || pairAddress ? "partial" : "unavailable";
  const observedMs = observedAt ? Date.parse(observedAt) : null;
  const chainMs = chainEventAt ? Date.parse(chainEventAt) : null;
  return freeze({
    schema_version: SOURCE_WALLET_DETECTION_MARKET_CONTEXT_SCHEMA,
    context_version: 1,
    state,
    source_event_id: String(event?.event_id || ""),
    token_mint: suppliedMint,
    observed_at: observedAt,
    source_chain_event_at: chainEventAt,
    observation_delay_ms: Number.isFinite(observedMs) && Number.isFinite(chainMs) ? Math.max(0, observedMs - chainMs) : null,
    provider: provider || null,
    pair_address: pairAddress || null,
    venue: venue || null,
    liquidity_usd: liquidityUsd,
    market_cap_usd: marketCapUsd,
    fully_diluted_value_usd: fullyDilutedValueUsd,
    pair_age_seconds: pairAgeSeconds,
    source_trade_notional_usdc: sourceTradeNotionalUsdc,
    source_trade_liquidity_pct: sourceTradeLiquidityPct,
    selected_pair_basis: pairAddress ? "highest_liquidity_exact_token_pair_at_raven_detection" : "unavailable",
    route_pair_match_proven: false,
    source_execution_market_claimed: false,
    pair_age_is_token_age: false,
    historical_estimate: false,
    current_state_substituted_for_chain_event: false,
  });
}

function buildDetectionMarketContext(rows, prospectiveSignalCount) {
  const byEvent = new Map();
  for (const row of rows) {
    if (!row?.source_event_id || byEvent.has(row.source_event_id)) continue;
    const context = row.market_context;
    if (context?.schema_version === SOURCE_WALLET_DETECTION_MARKET_CONTEXT_SCHEMA) byEvent.set(row.source_event_id, context);
  }
  const contexts = [...byEvent.values()];
  const observed = contexts.filter((row) => row.state === "available" || row.state === "partial");
  const marketCaps = contexts.map((row) => row.market_cap_usd).filter(Number.isFinite);
  const liquidities = contexts.map((row) => row.liquidity_usd).filter(Number.isFinite);
  const pairAges = contexts.map((row) => row.pair_age_seconds).filter(Number.isFinite);
  const sourceLiquidityRatios = contexts.map((row) => row.source_trade_liquidity_pct).filter(Number.isFinite);
  const delays = contexts.map((row) => row.observation_delay_ms).filter(Number.isFinite);
  return freeze({
    schema_version: "ravenos.source_wallet_detection_market_context_summary.v1",
    state: !observed.length ? "insufficient_evidence" : observed.length === prospectiveSignalCount ? "available" : "partial",
    prospective_signal_count: prospectiveSignalCount,
    context_observation_count: observed.length,
    context_coverage_pct: coveragePercent(observed.length, prospectiveSignalCount),
    market_cap_observation_count: marketCaps.length,
    market_cap_coverage_pct: coveragePercent(marketCaps.length, prospectiveSignalCount),
    liquidity_observation_count: liquidities.length,
    liquidity_coverage_pct: coveragePercent(liquidities.length, prospectiveSignalCount),
    pair_age_observation_count: pairAges.length,
    pair_age_coverage_pct: coveragePercent(pairAges.length, prospectiveSignalCount),
    median_detected_market_cap_usd: median(marketCaps, 2),
    median_detected_liquidity_usd: median(liquidities, 2),
    median_detected_pair_age_seconds: median(pairAges, 0),
    median_source_trade_liquidity_pct: median(sourceLiquidityRatios, 6),
    median_observation_delay_ms: median(delays, 0),
    evidence_scope: "raven_detection_time_exact_token_market_context",
    exact_source_pool_claimed: false,
    historical_entry_context_claimed: false,
    pair_age_used_as_token_age: false,
    current_market_context_substituted_for_source_fill: false,
  });
}

function buildCopyabilityDiagnosis(bySize, referenceOrderSizeUsdc) {
  const rows = (Array.isArray(bySize) ? bySize : []).map((row) => ({
    order_size_usdc: row.order_size_usdc,
    prospective_sample_count: row.prospective_sample_count,
    policy_pass_pct: row.components?.policy_pass_pct ?? null,
    dominant_refusal: row.dominant_refusal || null,
  }));
  const qualified = rows.filter((row) => row.prospective_sample_count >= 20 && Number.isFinite(row.policy_pass_pct));
  const majorityPass = qualified.filter((row) => row.policy_pass_pct >= 50);
  const belowMajority = qualified.filter((row) => row.policy_pass_pct < 50);
  const reference = rows.find((row) => row.order_size_usdc === referenceOrderSizeUsdc) || null;
  return freeze({
    schema_version: "ravenos.source_wallet_copyability_diagnosis.v1",
    diagnosis_version: 1,
    state: !rows.some((row) => row.prospective_sample_count > 0)
      ? "insufficient_evidence"
      : qualified.length
        ? "available"
        : "forming",
    reference_order_size_usdc: referenceOrderSizeUsdc,
    minimum_prospective_sample_count: 20,
    majority_policy_pass_threshold_pct: 50,
    reference_dominant_refusal: reference?.dominant_refusal || null,
    largest_tested_size_with_majority_policy_pass_usdc: majorityPass.length
      ? Math.max(...majorityPass.map((row) => row.order_size_usdc))
      : null,
    first_tested_size_below_majority_policy_pass_usdc: belowMajority.length
      ? Math.min(...belowMajority.map((row) => row.order_size_usdc))
      : null,
    by_size: rows,
    liquidity_capacity_claimed: false,
    source_performance_used_as_copyability: false,
    unavailable_decisions_dropped: false,
  });
}

function decisionEvaluation(decision, evaluationId) {
  const {
    schema_version: _schemaVersion,
    decision_version: _decisionVersion,
    decision_id: _decisionId,
    watch_id: _watchId,
    ...evidence
  } = decision;
  return freeze({
    schema_version: SOURCE_WALLET_COPYABILITY_EVALUATION_SCHEMA,
    evaluation_version: 1,
    evaluation_id: evaluationId,
    ...evidence,
    decision: {
      ...evidence.decision,
      shadow_position_created: false,
      would_create_shadow_position_under_policy: evidence.decision.state === "SHADOW_EXECUTABLE",
      subscriber_policy_applied: false,
      shared_research_policy_applied: true,
    },
    evidence: {
      ...evidence.evidence,
      source_performance_substituted: false,
      shared_source_research: true,
    },
    execution_boundary: {
      ...evidence.execution_boundary,
      mode: "shared_shadow_research",
      position_creation_available: false,
    },
  });
}

function decisionView(observation) {
  const evaluation = observation?.evaluation;
  if (observation?.schema_version !== SOURCE_WALLET_COPYABILITY_OBSERVATION_SCHEMA
    || evaluation?.schema_version !== SOURCE_WALLET_COPYABILITY_EVALUATION_SCHEMA) return null;
  const {
    schema_version: _schemaVersion,
    evaluation_version: _evaluationVersion,
    evaluation_id: evaluationId,
    ...decision
  } = evaluation;
  return {
    schema_version: RAVEN_COPY_DECISION_SCHEMA,
    decision_version: 2,
    decision_id: evaluationId,
    watch_id: null,
    ...decision,
  };
}

export function resolveSourceWalletCopyabilityActivation(env = {}) {
  const observer = resolveSourceWalletObserverActivation(env);
  const requested = flag(env.RAVENOS_WALLET_COPYABILITY_PROBES_ENABLED);
  return Object.freeze({
    requested,
    evaluator: requested && observer.evaluator,
    observer_evaluator: observer.evaluator,
    shadow_only: true,
    live_copy: false,
    signing: false,
    broadcasting: false,
    fee_collection: false,
  });
}

export function createSourceWalletCopyabilityPolicy(orderSizeUsdc, { fee_bps: feeBps = 10 } = {}) {
  const size = Number(orderSizeUsdc);
  if (!RavenCopyStandardOrderSizesUsdc.includes(size)) fail("source_wallet_copyability_order_size_invalid");
  return createRavenCopyPolicy({
    policy_version: 1,
    mode: "RAVEN_COPY",
    sizing: { kind: "FIXED_USDC", fixed_usdc: size },
    allocation: {
      total_strategy_usdc: Math.max(10_000, size * 10),
      maximum_per_trade_usdc: size,
      minimum_per_trade_usdc: Math.min(25, size),
      maximum_token_exposure_usdc: Math.max(5_000, size),
      maximum_daily_notional_usdc: Math.max(25_000, size * 10),
    },
    execution_quality: {
      maximum_detection_delay_ms: 30_000,
      maximum_quote_age_ms: 15_000,
      maximum_entry_degradation_bps: 1_000,
      maximum_price_impact_bps: 500,
      maximum_round_trip_friction_pct: 5,
      minimum_executable_exit_usdc: Math.min(1, size),
      minimum_liquidity_usd: 25_000,
      require_source_price_comparison: false,
      require_executable_exit: true,
      allowed_chains: ["solana"],
      canonical_usdc_settlement_required: true,
    },
    safeguards: {
      skip_unresolved_asset: true,
      skip_failed_sell_simulation: true,
      skip_freeze_authority_when_evidenced: true,
      skip_mint_authority_when_evidenced: false,
      skip_extreme_transfer_fee: true,
      skip_malformed_metadata: true,
      minimum_token_age_seconds: 0,
    },
    funding_assumption: "PREPOSITIONED_SOLANA_USDC_SHADOW",
    hypothetical_raven_fee_bps: normalizedFeeBps(feeBps),
  });
}

export function createSourceWalletCopyabilityPolicyReference({
  fee_bps: feeBps = 10,
  sizes_usdc: sizesUsdc = RavenCopyStandardOrderSizesUsdc,
} = {}) {
  const fee = normalizedFeeBps(feeBps);
  const policies = standardSizes(sizesUsdc).map((size) => createSourceWalletCopyabilityPolicy(size, { fee_bps: fee }));
  const policyHashes = policies.map((policy) => policy.policy_hash).sort();
  return freeze({
    schema_version: "ravenos.source_wallet_copyability_policy_reference.v1",
    policy_version: Math.max(...policies.map((policy) => policy.policy_version)),
    hypothetical_raven_fee_bps: fee,
    standard_order_sizes_usdc: policies.map((policy) => policy.sizing.fixed_usdc).sort((left, right) => left - right),
    policy_hashes: policyHashes,
    matrix_policy_hash: digest(["source_wallet_copyability_matrix", String(fee), ...policyHashes]),
  });
}

export function createSourceWalletCopyabilityObservation(input = {}, { now = Date.now() } = {}) {
  const sourceWalletId = sourceId(input.source_wallet_id);
  const event = input.source_event;
  if (event?.schema_version !== SOLANA_WALLET_EVENT_SCHEMA || event.copy_signal?.eligible_buy_signal !== true) {
    fail("source_wallet_copyability_buy_event_required");
  }
  assertSourceEventIdentity(sourceWalletId, event);
  const policy = input.policy?.schema_version ? input.policy : createSourceWalletCopyabilityPolicy(input.order_size_usdc, { fee_bps: input.fee_bps });
  if (!RavenCopyStandardOrderSizesUsdc.includes(policy.sizing?.fixed_usdc)) fail("source_wallet_copyability_order_size_invalid");
  const nowMs = Number(now);
  if (!Number.isFinite(nowMs)) fail("source_wallet_copyability_observed_at_invalid");
  const observationId = `swcp_${digest([sourceWalletId, event.event_id, policy.policy_hash])}`;
  const evaluationId = `swce_${digest([observationId, "evaluation"] )}`;
  const policyReference = createSourceWalletCopyabilityPolicyReference({ fee_bps: policy.hypothetical_raven_fee_bps });
  const decision = createRavenCopyDecision({
    watch_id: `shared_source_research_${digest([sourceWalletId, String(policy.sizing.fixed_usdc)])}`,
    source_event: event,
    policy,
    source_notional_usdc: input.source_notional_usdc,
    source_notional_basis: input.source_notional_basis,
    liquidity_usd: input.liquidity_usd,
    asset_evidence: input.asset_evidence,
    entry: input.entry,
    exit: input.exit,
  }, { now: nowMs });
  const evaluation = decisionEvaluation(decision, evaluationId);
  const marketContext = createSourceWalletDetectionMarketContext(input.market_context || {}, { event });
  return freeze({
    schema_version: SOURCE_WALLET_COPYABILITY_OBSERVATION_SCHEMA,
    observation_version: 1,
    observation_id: observationId,
    source_wallet_id: sourceWalletId,
    source_event_id: event.event_id,
    standard_order_size_usdc: policy.sizing.fixed_usdc,
    hypothetical_raven_fee_bps: policy.hypothetical_raven_fee_bps,
    policy_version: policy.policy_version,
    policy_hash: policy.policy_hash,
    matrix_policy_hash: policyReference.matrix_policy_hash,
    market_context: marketContext,
    evaluation,
    observed_at: new Date(nowMs).toISOString(),
    provenance: {
      mode: "prospective_shared_source_research",
      source_chain_event_at: event.timing.chain_event_at,
      raven_received_at: event.timing.raven_received_at,
      quote_provider: evaluation.entry.provider,
      reverse_exit_provider: evaluation.reverse_exit.provider,
      source_performance_substituted: false,
      historical_estimate: false,
    },
    privacy: {
      public_source_wallet_only: true,
      subscriber_identity_included: false,
      watch_identity_included: false,
      raw_provider_payload_included: false,
      signer_material_included: false,
      transaction_material_included: false,
    },
    execution_boundary: {
      shadow_research_only: true,
      live_copy: false,
      signing: false,
      broadcasting: false,
      custody: false,
      fee_collection: false,
      transaction_hash: null,
    },
  });
}

export function buildSourceWalletCopyabilityMatrix(
  observations = [],
  {
    generated_at: generatedAt = new Date().toISOString(),
    reference_fee_bps: requestedFeeBps = null,
    outcome_checkpoints: outcomeCheckpoints = [],
  } = {},
) {
  const generated = timestamp(generatedAt, "source_wallet_copyability_generated_at");
  const retained = (Array.isArray(observations) ? observations : [])
    .filter((row) => row?.schema_version === SOURCE_WALLET_COPYABILITY_OBSERVATION_SCHEMA)
    .slice(0, SourceWalletCopyabilityLimits.maximum_observations_per_source_profile);
  const feeScenarios = [...new Set(retained.map((row) => row.hypothetical_raven_fee_bps))].sort((left, right) => left - right);
  const requestedFee = requestedFeeBps === null ? null : normalizedFeeBps(requestedFeeBps);
  const selectedFee = requestedFee !== null
    ? requestedFee
    : feeScenarios.includes(10)
      ? 10
      : retained[0]?.hypothetical_raven_fee_bps ?? null;
  const scenarioMatrices = feeScenarios.map((feeBps) => {
    const policyReference = createSourceWalletCopyabilityPolicyReference({ fee_bps: feeBps });
    const currentPolicyHashes = new Set(policyReference.policy_hashes);
    const feeRows = retained.filter((row) => row.hypothetical_raven_fee_bps === feeBps);
    const rows = feeRows.filter((row) => currentPolicyHashes.has(row.policy_hash));
    const decisions = rows.map(decisionView).filter(Boolean);
    const bySize = buildCopyabilityBySize(decisions, {
      generated_at: generated,
      sizes_usdc: RavenCopyStandardOrderSizesUsdc,
    });
    const snapshot = bySize.find((row) => row.order_size_usdc === SourceWalletCopyabilityLimits.reference_order_size_usdc) || null;
    return freeze({
      hypothetical_raven_fee_bps: feeBps,
      matrix_policy_hash: policyReference.matrix_policy_hash,
      policy_version: policyReference.policy_version,
      policy_hashes: policyReference.policy_hashes,
      state: rows.length ? (snapshot?.state === "available" ? "available" : "forming") : "insufficient_evidence",
      prospective_signal_count: new Set(rows.map((row) => row.source_event_id)).size,
      probe_observation_count: rows.length,
      superseded_policy_observation_count: feeRows.length - rows.length,
      snapshot,
      by_size: bySize,
    });
  });
  const selected = scenarioMatrices.find((row) => row.hypothetical_raven_fee_bps === selectedFee) || null;
  const selectedRows = selectedFee === null || !selected
    ? []
    : retained.filter((row) => row.hypothetical_raven_fee_bps === selectedFee && selected.policy_hashes.includes(row.policy_hash));
  const latest = selectedRows.map((row) => Date.parse(row.observed_at)).filter(Number.isFinite).sort((left, right) => right - left)[0];
  const detectionMarketContext = buildDetectionMarketContext(selectedRows, selected?.prospective_signal_count || 0);
  const selectedObservationIds = new Set(selectedRows.map((row) => row.observation_id));
  const outcomes = buildSourceWalletCopyabilityOutcomeSummary(
    (Array.isArray(outcomeCheckpoints) ? outcomeCheckpoints : []).filter((row) => selectedObservationIds.has(row?.observation_id)),
  );
  const bySize = selected?.by_size || buildCopyabilityBySize([], {
    generated_at: generated,
    sizes_usdc: RavenCopyStandardOrderSizesUsdc,
  });
  return freeze({
    schema_version: SOURCE_WALLET_COPYABILITY_MATRIX_SCHEMA,
    matrix_version: 1,
    generated_at: generated,
    state: selected?.state || "insufficient_evidence",
    evidence_scope: "prospective_shared_source_research",
    reference_order_size_usdc: SourceWalletCopyabilityLimits.reference_order_size_usdc,
    reference_hypothetical_raven_fee_bps: selectedFee,
    reference_matrix_policy_hash: selected?.matrix_policy_hash || null,
    reference_policy_version: selected?.policy_version || null,
    prospective_signal_count: selected?.prospective_signal_count || 0,
    probe_observation_count: selected?.probe_observation_count || 0,
    all_fee_scenario_probe_observation_count: retained.length,
    last_observed_at: Number.isFinite(latest) ? new Date(latest).toISOString() : null,
    hypothetical_raven_fee_scenarios_bps: feeScenarios,
    fee_scenarios: scenarioMatrices,
    snapshot: selected?.snapshot || null,
    by_size: bySize,
    copy_diagnosis: buildCopyabilityDiagnosis(bySize, SourceWalletCopyabilityLimits.reference_order_size_usdc),
    detection_market_context: detectionMarketContext,
    prospective_outcomes: outcomes,
    historical_estimates_included: false,
    source_performance_used_as_follower_performance: false,
    unavailable_decisions_dropped: false,
    subscriber_identity_included: false,
    execution_boundary: {
      shadow_research_only: true,
      live_copy: false,
      signing: false,
      broadcasting: false,
      custody: false,
      fee_collection: false,
      transaction_hash: null,
    },
    limitations: [
      "Shared research assumes pre-positioned Solana USDC; it is not a user balance or fill.",
      "Scores remain unavailable until each order size has enough prospective entry and reverse-exit evidence.",
      "Detected market context is an exact-token Raven observation near detection, not the source wallet's proven pool, fill, or token age.",
      "Later outcomes are exact-quantity liquidation quotes, not fills, positions, or the source wallet's realized P&L.",
      "No shadow position, transaction, fee collection, or live copy is created by these probes.",
    ],
  });
}

export async function evaluateSourceWalletCopyabilityMatrix({
  event,
  source_wallet_id: sourceWalletIdentifier,
  store,
  provider,
  now = Math.floor(Date.now() / 1_000),
  sizes_usdc: sizesUsdc = RavenCopyStandardOrderSizesUsdc,
  fee_bps: feeBps = 10,
} = {}) {
  const sourceWalletId = sourceId(sourceWalletIdentifier);
  if (event?.schema_version !== SOLANA_WALLET_EVENT_SCHEMA) fail("source_wallet_copyability_event_invalid");
  assertSourceEventIdentity(sourceWalletId, event);
  if (!store?.recordSourceCopyabilityObservation || !store?.listSourceCopyabilityObservationsForEvent) fail("source_wallet_copyability_store_unavailable");
  if (!provider?.quoteCopySignal) fail("source_wallet_copyability_provider_unavailable");
  if (event.copy_signal?.eligible_buy_signal !== true) {
    return freeze({
      complete: true,
      source_event_id: event.event_id,
      signal_eligible: false,
      probe_count: 0,
      observation_count: 0,
      duplicate_count: 0,
      quote_variant_count: 0,
      decision_completed_at: new Date(Number(now) * 1_000).toISOString(),
    });
  }
  const fee = normalizedFeeBps(feeBps);
  const policyReference = createSourceWalletCopyabilityPolicyReference({ fee_bps: fee, sizes_usdc: sizesUsdc });
  const policies = policyReference.standard_order_sizes_usdc.map((size) => createSourceWalletCopyabilityPolicy(size, { fee_bps: fee }));
  const existing = await store.listSourceCopyabilityObservationsForEvent(sourceWalletId, event.event_id);
  const existingKeys = new Set((Array.isArray(existing) ? existing : []).map((row) => row.policy_hash));
  let observations = 0;
  let duplicates = policies.filter((policy) => existingKeys.has(policy.policy_hash)).length;
  let quotes = 0;
  const pending = policies.filter((policy) => !existingKeys.has(policy.policy_hash));
  let cursor = 0;
  const workers = Array.from({ length: Math.min(SourceWalletCopyabilityLimits.maximum_quote_concurrency, pending.length) }, async () => {
    while (cursor < pending.length) {
      const index = cursor;
      cursor += 1;
      const policy = pending[index];
      let evidence;
      try {
        quotes += 1;
        evidence = await provider.quoteCopySignal({ event, policy });
      } catch (error) {
        evidence = unavailableEvidence(event, error);
      }
      const observation = createSourceWalletCopyabilityObservation({
        source_wallet_id: sourceWalletId,
        source_event: event,
        policy,
        ...evidence,
      }, { now: Number(now) * 1_000 });
      const inserted = await store.recordSourceCopyabilityObservation(observation, now);
      if (inserted) observations += 1;
      else duplicates += 1;
    }
  });
  await Promise.all(workers);
  let projectionRefreshed = false;
  if (typeof store.refreshSourceCopyabilityProjection === "function") {
    await store.refreshSourceCopyabilityProjection(sourceWalletId, {
      fee_bps: fee,
      policy_reference: policyReference,
      now,
    });
    projectionRefreshed = true;
  }
  return freeze({
    complete: true,
    source_event_id: event.event_id,
    signal_eligible: true,
    probe_count: policies.length,
    observation_count: observations,
    duplicate_count: duplicates,
    quote_variant_count: quotes,
    projection_refreshed: projectionRefreshed,
    decision_completed_at: new Date(Number(now) * 1_000).toISOString(),
  });
}

export const SourceWalletCopyabilityContract = Object.freeze({
  schema_version: SOURCE_WALLET_COPYABILITY_MATRIX_SCHEMA,
  activation_flag: "RAVENOS_WALLET_COPYABILITY_PROBES_ENABLED",
  standard_order_sizes_usdc: RavenCopyStandardOrderSizesUsdc,
  reference_order_size_usdc: SourceWalletCopyabilityLimits.reference_order_size_usdc,
  detection_market_context_schema: SOURCE_WALLET_DETECTION_MARKET_CONTEXT_SCHEMA,
  detection_market_context_counted_once_per_source_signal: true,
  prospective_outcomes_append_only: true,
  source_counterfactual_presented_as_realized_pnl: false,
  expected_outcomes_presented_as_fills: false,
  exact_source_pool_claimed: false,
  source_fill_context_claimed: false,
  pair_age_used_as_token_age: false,
  shared_quote_work: true,
  subscriber_proportional_quote_work: false,
  prospective_only: true,
  source_performance_substitution: false,
  live_copy: false,
  signing: false,
  broadcasting: false,
  custody: false,
  fee_collection: false,
});
