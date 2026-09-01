import { createHash, randomUUID } from "node:crypto";

import {
  createShadowFeePolicy,
  createShadowFeeQuote,
} from "./fee_architecture.mjs";
import { resolveSourceWalletObserverActivation } from "./source_wallet_observer.mjs";

export const SOURCE_WALLET_OPPORTUNITY_CHECKPOINT_SCHEMA = "ravenos.source_wallet_opportunity_checkpoint.v1";
export const SOURCE_WALLET_COPYABILITY_CHECKPOINT_SCHEMA = "ravenos.source_wallet_copyability_checkpoint.v1";
export const SOURCE_WALLET_COPYABILITY_OUTCOMES_SCHEMA = "ravenos.source_wallet_copyability_outcomes.v1";

export const SourceWalletCopyabilityCheckpointLimits = Object.freeze({
  checkpoint_horizons_seconds: Object.freeze([30, 60, 90, 300, 900, 3_600, 14_400, 86_400]),
  reference_horizon_seconds: 3_600,
  reference_order_size_usdc: 100,
  evaluator_source_event_batch_size: 2,
  evaluator_due_observation_limit: 100,
  evaluator_quote_concurrency: 2,
  evaluator_lease_seconds: 240,
  maximum_profile_checkpoints: 25_000,
});

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

function flag(value) {
  return String(value || "").trim() === "1";
}

function digest(parts) {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40);
}

function clean(value, field, maximum = 100, { optional = false, lower = false } = {}) {
  const normalized = String(value ?? "").trim();
  if ((!optional && !normalized) || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) fail(`${field}_invalid`);
  return lower ? normalized.toLowerCase() : normalized;
}

function finite(value, field, { optional = false, minimum = -1e18, maximum = 1e18 } = {}) {
  if (optional && (value === null || value === undefined || value === "")) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) fail(`${field}_invalid`);
  return parsed;
}

function integer(value, field, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) fail(`${field}_invalid`);
  return parsed;
}

function baseUnits(value, field) {
  const normalized = String(value ?? "").trim();
  if (!/^[1-9]\d{0,79}$/.test(normalized)) fail(`${field}_invalid`);
  return normalized;
}

function timestamp(value, field) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) fail(`${field}_invalid`);
  return new Date(parsed).toISOString();
}

function rounded(value, places = 6) {
  return value === null ? null : Number(Number(value).toFixed(places));
}

function percent(count, total) {
  return total > 0 ? rounded((count / total) * 100, 2) : null;
}

function median(values, places = 4) {
  const retained = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!retained.length) return null;
  const middle = Math.floor(retained.length / 2);
  return rounded(retained.length % 2 ? retained[middle] : (retained[middle - 1] + retained[middle]) / 2, places);
}

function sourceWalletId(value) {
  const normalized = String(value || "").trim();
  if (!/^sw_sol_[a-f0-9]{40}$/.test(normalized)) fail("source_wallet_checkpoint_source_id_invalid");
  return normalized;
}

function openingObservation(value) {
  if (value?.schema_version !== "ravenos.source_wallet_copyability_observation.v1") fail("source_wallet_checkpoint_observation_invalid");
  sourceWalletId(value.source_wallet_id);
  if (!/^swe_[a-f0-9]{40}$/.test(String(value.source_event_id || ""))) fail("source_wallet_checkpoint_event_id_invalid");
  return value;
}

function horizonSeconds(value) {
  const horizon = integer(value, "source_wallet_checkpoint_horizon", { minimum: 1 });
  if (!SourceWalletCopyabilityCheckpointLimits.checkpoint_horizons_seconds.includes(horizon)) fail("source_wallet_checkpoint_horizon_invalid");
  return horizon;
}

function routeResult(input = {}) {
  const routeAvailable = input?.route_available === true;
  const grossExit = finite(input?.current_exit_usdc, "source_wallet_checkpoint_exit_usdc", { optional: true, minimum: 0 });
  const minimumExit = finite(input?.minimum_exit_usdc, "source_wallet_checkpoint_minimum_exit_usdc", { optional: true, minimum: 0 });
  if (routeAvailable && (grossExit === null || minimumExit === null || minimumExit > grossExit)) {
    fail("source_wallet_checkpoint_route_evidence_invalid");
  }
  return freeze({
    route_available: routeAvailable,
    state: clean(input?.state || (routeAvailable ? "route_available" : "route_unavailable"), "source_wallet_checkpoint_state", 64, { lower: true }),
    current_exit_usdc: grossExit,
    minimum_exit_usdc: minimumExit,
    provider_id: clean(input?.provider_id || input?.provider || "unknown", "source_wallet_checkpoint_provider", 64, { lower: true }),
    provider_latency_ms: input?.provider_latency_ms == null
      ? null
      : integer(input.provider_latency_ms, "source_wallet_checkpoint_provider_latency", { maximum: 120_000 }),
    reason_code: clean(input?.reason_code, "source_wallet_checkpoint_reason", 100, { optional: true, lower: true }) || null,
  });
}

function checkpointTiming(observation, horizon, evaluatedAt) {
  const observedAt = timestamp(observation.observed_at, "source_wallet_checkpoint_observed_at");
  const evaluated = timestamp(evaluatedAt, "source_wallet_checkpoint_evaluated_at");
  if (Date.parse(evaluated) < Date.parse(observedAt) + (horizon * 1_000)) fail("source_wallet_checkpoint_too_early");
  return { observed_at: observedAt, evaluated_at: evaluated };
}

function followerReturn(returnUsdc, costUsdc) {
  return returnUsdc === null || !(costUsdc > 0) ? null : rounded(((returnUsdc - costUsdc) / costUsdc) * 100);
}

export function resolveSourceWalletCopyabilityCheckpointActivation(env = {}) {
  const observer = resolveSourceWalletObserverActivation(env);
  const requested = flag(env.RAVENOS_WALLET_COPYABILITY_CHECKPOINTS_ENABLED);
  const probesRequested = flag(env.RAVENOS_WALLET_COPYABILITY_PROBES_ENABLED);
  return freeze({
    requested,
    evaluator: requested && probesRequested && observer.evaluator,
    shared_copyability_probes_requested: probesRequested,
    observer_evaluator: observer.evaluator,
    shadow_only: true,
    live_copy: false,
    signing: false,
    broadcasting: false,
    custody: false,
    fee_collection: false,
  });
}

export function createSourceWalletOpportunityCheckpoint({
  observation: inputObservation,
  horizon_seconds: inputHorizon,
  result: inputResult,
  evaluated_at: inputEvaluatedAt,
} = {}) {
  const observation = openingObservation(inputObservation);
  const horizon = horizonSeconds(inputHorizon);
  const timing = checkpointTiming(observation, horizon, inputEvaluatedAt);
  const route = routeResult(inputResult);
  const evaluation = observation.evaluation || {};
  const destinationAsset = evaluation.destination_asset || {};
  const tokenMint = clean(destinationAsset.mint, "source_wallet_checkpoint_token_mint", 64);
  const quantityBaseUnits = baseUnits(destinationAsset.amount_base_units, "source_wallet_checkpoint_source_quantity");
  const sourceNotional = finite(evaluation.source_transaction?.effective_notional_usdc, "source_wallet_checkpoint_source_notional", { optional: true, minimum: 0.000001 });
  const grossPnl = route.route_available && sourceNotional !== null ? rounded(route.current_exit_usdc - sourceNotional) : null;
  const minimumPnl = route.route_available && sourceNotional !== null ? rounded(route.minimum_exit_usdc - sourceNotional) : null;
  const grossReturn = sourceNotional === null || grossPnl === null ? null : rounded((grossPnl / sourceNotional) * 100);
  const minimumReturn = sourceNotional === null || minimumPnl === null ? null : rounded((minimumPnl / sourceNotional) * 100);
  const checkpointId = `swoc_${digest([observation.source_event_id, String(horizon)])}`;
  return freeze({
    schema_version: SOURCE_WALLET_OPPORTUNITY_CHECKPOINT_SCHEMA,
    checkpoint_version: 1,
    checkpoint_id: checkpointId,
    source_wallet_id: observation.source_wallet_id,
    source_event_id: observation.source_event_id,
    horizon_seconds: horizon,
    state: route.state,
    route_available: route.route_available,
    token_mint: tokenMint,
    source_quantity_base_units: quantityBaseUnits,
    source_notional_usdc: sourceNotional,
    source_notional_basis: sourceNotional === null
      ? "unavailable"
      : clean(evaluation.source_transaction?.notional_basis || "raven_detection_observation", "source_wallet_checkpoint_source_basis", 80, { lower: true }),
    counterfactual_liquidation: {
      gross_exit_usdc: route.route_available ? route.current_exit_usdc : null,
      minimum_exit_usdc: route.route_available ? route.minimum_exit_usdc : null,
      gross_pnl_usdc: grossPnl,
      minimum_pnl_usdc: minimumPnl,
      gross_return_pct: grossReturn,
      minimum_return_pct: minimumReturn,
      actual_source_exit_claimed: false,
      realized_source_pnl_claimed: false,
      current_mark_substituted: false,
    },
    route_evidence: {
      provider: route.provider_id,
      provider_latency_ms: route.provider_latency_ms,
      reason_code: route.reason_code,
      expected_quote_not_fill: true,
      exact_asset_and_quantity: true,
      raw_provider_payload_included: false,
    },
    timing,
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

export function createSourceWalletCopyabilityCheckpoint({
  observation: inputObservation,
  source_checkpoint: inputSourceCheckpoint,
  horizon_seconds: inputHorizon,
  result: inputResult,
  evaluated_at: inputEvaluatedAt,
} = {}) {
  const observation = openingObservation(inputObservation);
  if (observation.evaluation?.decision?.state !== "SHADOW_EXECUTABLE") fail("source_wallet_checkpoint_executable_opening_required");
  const sourceCheckpoint = inputSourceCheckpoint;
  if (sourceCheckpoint?.schema_version !== SOURCE_WALLET_OPPORTUNITY_CHECKPOINT_SCHEMA
    || sourceCheckpoint.source_wallet_id !== observation.source_wallet_id
    || sourceCheckpoint.source_event_id !== observation.source_event_id) {
    fail("source_wallet_checkpoint_source_checkpoint_invalid");
  }
  const horizon = horizonSeconds(inputHorizon);
  if (sourceCheckpoint.horizon_seconds !== horizon) fail("source_wallet_checkpoint_horizon_mismatch");
  const timing = checkpointTiming(observation, horizon, inputEvaluatedAt);
  const route = routeResult(inputResult);
  const evaluation = observation.evaluation;
  const quantityBaseUnits = baseUnits(evaluation.entry?.expected_output_base_units, "source_wallet_checkpoint_follower_quantity");
  const tradeNotional = finite(evaluation.intended_order?.amount_usdc, "source_wallet_checkpoint_trade_notional", { minimum: 0.000001 });
  const entryFee = finite(evaluation.hypothetical_raven_fee?.entry_fee_usdc, "source_wallet_checkpoint_entry_fee", { minimum: 0 });
  const feeBps = integer(observation.hypothetical_raven_fee_bps, "source_wallet_checkpoint_fee_bps", { maximum: 50 });
  const checkpointId = `swfc_${digest([observation.observation_id, String(horizon)])}`;
  let exitFee = null;
  if (route.route_available) {
    const feePolicy = createShadowFeePolicy({ fee_bps: feeBps, allow_custom_scenario: true });
    exitFee = createShadowFeeQuote({
      policy: feePolicy,
      route_observation_id: checkpointId,
      side: "sell",
      gross_executable_proceeds_usdc: route.current_exit_usdc,
    }).hypothetical_fee_usdc;
  }
  const initialEconomicCost = rounded(tradeNotional + entryFee);
  const grossExit = route.route_available ? route.current_exit_usdc : null;
  const minimumExit = route.route_available ? route.minimum_exit_usdc : null;
  const netExit = grossExit === null || exitFee === null ? null : rounded(Math.max(0, grossExit - exitFee));
  const minimumExitFee = minimumExit === null
    ? null
    : createShadowFeeQuote({
        policy: createShadowFeePolicy({ fee_bps: feeBps, allow_custom_scenario: true }),
        route_observation_id: `${checkpointId}_minimum`,
        side: "sell",
        gross_executable_proceeds_usdc: minimumExit,
      }).hypothetical_fee_usdc;
  const minimumNetExit = minimumExit === null || minimumExitFee === null ? null : rounded(Math.max(0, minimumExit - minimumExitFee));
  const returnExcludingRaven = followerReturn(grossExit, tradeNotional);
  const returnIncludingRaven = followerReturn(netExit, initialEconomicCost);
  const minimumReturnIncludingRaven = followerReturn(minimumNetExit, initialEconomicCost);
  const sourceReturn = finite(sourceCheckpoint.counterfactual_liquidation?.gross_return_pct, "source_wallet_checkpoint_source_return", { optional: true });
  const captureEligible = sourceReturn !== null && sourceReturn > 0 && returnIncludingRaven !== null;
  const captureRatio = captureEligible ? rounded((returnIncludingRaven / sourceReturn) * 100) : null;
  const returnGap = sourceReturn === null || returnIncludingRaven === null ? null : rounded(returnIncludingRaven - sourceReturn);
  return freeze({
    schema_version: SOURCE_WALLET_COPYABILITY_CHECKPOINT_SCHEMA,
    checkpoint_version: 1,
    checkpoint_id: checkpointId,
    observation_id: observation.observation_id,
    source_checkpoint_id: sourceCheckpoint.checkpoint_id,
    source_wallet_id: observation.source_wallet_id,
    source_event_id: observation.source_event_id,
    standard_order_size_usdc: observation.standard_order_size_usdc,
    hypothetical_raven_fee_bps: feeBps,
    policy_hash: observation.policy_hash,
    horizon_seconds: horizon,
    state: route.state,
    route_available: route.route_available,
    token_mint: clean(evaluation.destination_asset?.mint, "source_wallet_checkpoint_token_mint", 64),
    follower_quantity_base_units: quantityBaseUnits,
    follower_outcome: {
      trade_notional_usdc: tradeNotional,
      entry_hypothetical_raven_fee_usdc: entryFee,
      initial_economic_cost_usdc: initialEconomicCost,
      gross_exit_usdc: grossExit,
      minimum_exit_usdc: minimumExit,
      exit_hypothetical_raven_fee_usdc: exitFee,
      minimum_exit_hypothetical_raven_fee_usdc: minimumExitFee,
      net_exit_usdc: netExit,
      minimum_net_exit_usdc: minimumNetExit,
      net_pnl_usdc: netExit === null ? null : rounded(netExit - initialEconomicCost),
      minimum_net_pnl_usdc: minimumNetExit === null ? null : rounded(minimumNetExit - initialEconomicCost),
      return_excluding_raven_pct: returnExcludingRaven,
      return_including_raven_pct: returnIncludingRaven,
      minimum_return_including_raven_pct: minimumReturnIncludingRaven,
      expected_quote_not_fill: true,
      actual_position_created: false,
      actual_assets_held: false,
    },
    source_comparison: {
      source_counterfactual_return_pct: sourceReturn,
      follower_capture_ratio_pct: captureRatio,
      follower_minus_source_return_pct: returnGap,
      capture_eligible: captureEligible,
      capture_unavailable_reason: captureEligible
        ? null
        : sourceReturn === null
          ? "source_counterfactual_return_unavailable"
          : sourceReturn <= 0
            ? "source_counterfactual_return_not_positive"
            : "follower_return_unavailable",
      actual_source_performance_substituted: false,
      source_counterfactual_is_realized_pnl: false,
      capture_ratio_capped: false,
    },
    hypothetical_raven_fee: {
      scenario_bps: feeBps,
      entry_fee_usdc: entryFee,
      exit_fee_usdc: exitFee,
      minimum_exit_fee_usdc: minimumExitFee,
      collection_authorized: false,
      collected: false,
    },
    route_evidence: {
      provider: route.provider_id,
      provider_latency_ms: route.provider_latency_ms,
      reason_code: route.reason_code,
      exact_asset_and_quantity: true,
      raw_provider_payload_included: false,
    },
    timing,
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

function outcomeSlice(rows, { orderSize, horizon }) {
  const selected = rows.filter((row) => row.standard_order_size_usdc === orderSize && row.horizon_seconds === horizon);
  const routeRows = selected.filter((row) => row.route_available === true);
  const followerReturns = routeRows.map((row) => row.follower_outcome?.return_including_raven_pct).filter(Number.isFinite);
  const sourceByCheckpoint = new Map();
  for (const row of selected) {
    if (!sourceByCheckpoint.has(row.source_checkpoint_id)) sourceByCheckpoint.set(row.source_checkpoint_id, row.source_comparison?.source_counterfactual_return_pct);
  }
  const sourceReturns = [...sourceByCheckpoint.values()].filter(Number.isFinite);
  const captures = selected.map((row) => row.source_comparison?.follower_capture_ratio_pct).filter(Number.isFinite);
  const gaps = selected.map((row) => row.source_comparison?.follower_minus_source_return_pct).filter(Number.isFinite);
  return freeze({
    order_size_usdc: orderSize,
    horizon_seconds: horizon,
    state: selected.length ? "forming" : "insufficient_evidence",
    checkpoint_count: selected.length,
    source_signal_count: new Set(selected.map((row) => row.source_event_id)).size,
    route_persistence_pct: percent(routeRows.length, selected.length),
    follower_return_sample_count: followerReturns.length,
    median_follower_return_pct: median(followerReturns),
    follower_win_rate_pct: percent(followerReturns.filter((value) => value > 0).length, followerReturns.length),
    source_counterfactual_sample_count: sourceReturns.length,
    median_source_counterfactual_return_pct: median(sourceReturns),
    follower_capture_sample_count: captures.length,
    median_follower_capture_ratio_pct: median(captures),
    median_follower_minus_source_return_pct: median(gaps),
    unavailable_checkpoints_retained: selected.length - routeRows.length,
  });
}

export function buildSourceWalletCopyabilityOutcomeSummary(checkpoints = []) {
  const rows = (Array.isArray(checkpoints) ? checkpoints : [])
    .filter((row) => row?.schema_version === SOURCE_WALLET_COPYABILITY_CHECKPOINT_SCHEMA)
    .slice(0, SourceWalletCopyabilityCheckpointLimits.maximum_profile_checkpoints);
  const sizes = [25, 100, 500, 1_000, 5_000];
  const referenceHorizon = SourceWalletCopyabilityCheckpointLimits.reference_horizon_seconds;
  const referenceSize = SourceWalletCopyabilityCheckpointLimits.reference_order_size_usdc;
  const byHorizon = SourceWalletCopyabilityCheckpointLimits.checkpoint_horizons_seconds
    .map((horizon) => outcomeSlice(rows, { orderSize: referenceSize, horizon }));
  const bySize = sizes.map((orderSize) => outcomeSlice(rows, { orderSize, horizon: referenceHorizon }));
  const reference = bySize.find((row) => row.order_size_usdc === referenceSize)
    || outcomeSlice([], { orderSize: referenceSize, horizon: referenceHorizon });
  return freeze({
    schema_version: SOURCE_WALLET_COPYABILITY_OUTCOMES_SCHEMA,
    outcome_version: 1,
    state: rows.length ? "forming" : "insufficient_evidence",
    evidence_scope: "prospective_shared_follower_liquidation_quotes",
    checkpoint_count: rows.length,
    source_signal_count: new Set(rows.map((row) => row.source_event_id)).size,
    reference_order_size_usdc: referenceSize,
    reference_horizon_seconds: referenceHorizon,
    reference,
    by_horizon: byHorizon,
    by_size: bySize,
    source_performance_used_as_follower_performance: false,
    unavailable_checkpoints_dropped: false,
    expected_quotes_used_as_fills: false,
    historical_reconstruction_included: false,
    actual_positions_created: false,
  });
}

function parsedObservation(row) {
  let observation = null;
  try {
    observation = JSON.parse(String(row?.observation_json || "null"));
  } catch {
    fail("source_wallet_checkpoint_observation_json_invalid");
  }
  openingObservation(observation);
  return {
    ...observation,
    observed_at: new Date(Number(row.observed_at) * 1_000).toISOString(),
    completed_horizons: String(row.completed_horizons || "").split(",").map(Number).filter(Number.isFinite),
  };
}

function parsedJson(value, schema) {
  try {
    const parsed = JSON.parse(String(value || "null"));
    return parsed?.schema_version === schema ? parsed : null;
  } catch {
    return null;
  }
}

export function createD1SourceWalletCopyabilityCheckpointStore(db) {
  if (!db?.prepare) fail("source_wallet_checkpoint_store_unavailable");
  const checkpointDb = typeof db.withSession === "function" ? db.withSession("first-primary") : db;
  if (!checkpointDb?.prepare) fail("source_wallet_checkpoint_store_unavailable");
  return freeze({
    async dueObservations(now, limit = SourceWalletCopyabilityCheckpointLimits.evaluator_due_observation_limit) {
      const result = await checkpointDb.prepare(`
        WITH checkpoint_horizons(horizon_seconds) AS (
          VALUES (30), (60), (90), (300), (900), (3600), (14400), (86400)
        )
        SELECT o.observation_json, o.observed_at, GROUP_CONCAT(c.horizon_seconds) AS completed_horizons
        FROM ravenos_source_wallet_copyability_observations o
        LEFT JOIN ravenos_source_wallet_copyability_checkpoints c ON c.observation_id = o.observation_id
        WHERE o.decision_state = 'SHADOW_EXECUTABLE' AND o.retention_expires_at > ?
          AND EXISTS (
            SELECT 1
            FROM checkpoint_horizons h
            WHERE o.observed_at + h.horizon_seconds <= ?
              AND NOT EXISTS (
                SELECT 1
                FROM ravenos_source_wallet_copyability_checkpoints completed
                WHERE completed.observation_id = o.observation_id
                  AND completed.horizon_seconds = h.horizon_seconds
              )
          )
        GROUP BY o.observation_id
        ORDER BY o.observed_at ASC, o.source_event_id ASC, o.standard_order_size_usdc ASC
        LIMIT ?
      `).bind(now, now, Math.min(500, Math.max(1, Number(limit) || 1))).all();
      if (!Array.isArray(result?.results)) fail("source_wallet_checkpoint_due_query_failed");
      return result.results.map(parsedObservation);
    },
    async sourceCheckpoint(sourceEventId, horizon) {
      const row = await checkpointDb.prepare(`
        SELECT checkpoint_json FROM ravenos_source_wallet_opportunity_checkpoints
        WHERE source_event_id = ? AND horizon_seconds = ?
      `).bind(sourceEventId, horizon).first();
      return parsedJson(row?.checkpoint_json, SOURCE_WALLET_OPPORTUNITY_CHECKPOINT_SCHEMA);
    },
    async insertSourceCheckpoint(record) {
      const result = await checkpointDb.prepare(`
        INSERT OR IGNORE INTO ravenos_source_wallet_opportunity_checkpoints (
          checkpoint_id, source_wallet_id, source_event_id, horizon_seconds,
          state, route_available, token_mint, source_quantity_base_units,
          source_notional_usdc, gross_exit_usdc, minimum_exit_usdc,
          gross_return_pct, minimum_return_pct, provider_id, provider_latency_ms,
          reason_code, checkpoint_json, evaluated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        record.checkpoint_id, record.source_wallet_id, record.source_event_id, record.horizon_seconds,
        record.state, record.route_available ? 1 : 0, record.token_mint, record.source_quantity_base_units,
        record.source_notional_usdc, record.counterfactual_liquidation.gross_exit_usdc,
        record.counterfactual_liquidation.minimum_exit_usdc, record.counterfactual_liquidation.gross_return_pct,
        record.counterfactual_liquidation.minimum_return_pct, record.route_evidence.provider,
        record.route_evidence.provider_latency_ms, record.route_evidence.reason_code,
        JSON.stringify(record), Math.floor(Date.parse(record.timing.evaluated_at) / 1_000),
      ).run();
      return Number(result?.meta?.changes || 0) > 0;
    },
    async insertFollowerCheckpoint(record) {
      const result = await checkpointDb.prepare(`
        INSERT OR IGNORE INTO ravenos_source_wallet_copyability_checkpoints (
          checkpoint_id, observation_id, source_checkpoint_id, source_wallet_id,
          source_event_id, standard_order_size_usdc, hypothetical_raven_fee_bps,
          policy_hash, horizon_seconds, state, route_available, token_mint,
          follower_quantity_base_units, gross_exit_usdc, minimum_exit_usdc,
          initial_economic_cost_usdc, net_exit_usdc, minimum_net_exit_usdc,
          follower_return_pct, minimum_follower_return_pct,
          source_counterfactual_return_pct, follower_capture_ratio_pct,
          follower_minus_source_return_pct, provider_id, provider_latency_ms,
          reason_code, checkpoint_json, evaluated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        record.checkpoint_id, record.observation_id, record.source_checkpoint_id,
        record.source_wallet_id, record.source_event_id, record.standard_order_size_usdc,
        record.hypothetical_raven_fee_bps, record.policy_hash, record.horizon_seconds,
        record.state, record.route_available ? 1 : 0, record.token_mint,
        record.follower_quantity_base_units, record.follower_outcome.gross_exit_usdc,
        record.follower_outcome.minimum_exit_usdc, record.follower_outcome.initial_economic_cost_usdc,
        record.follower_outcome.net_exit_usdc, record.follower_outcome.minimum_net_exit_usdc,
        record.follower_outcome.return_including_raven_pct,
        record.follower_outcome.minimum_return_including_raven_pct,
        record.source_comparison.source_counterfactual_return_pct,
        record.source_comparison.follower_capture_ratio_pct,
        record.source_comparison.follower_minus_source_return_pct,
        record.route_evidence.provider, record.route_evidence.provider_latency_ms,
        record.route_evidence.reason_code, JSON.stringify(record),
        Math.floor(Date.parse(record.timing.evaluated_at) / 1_000),
      ).run();
      return Number(result?.meta?.changes || 0) > 0;
    },
    async listSourceCheckpoints(sourceId, limit = SourceWalletCopyabilityCheckpointLimits.maximum_profile_checkpoints) {
      const result = await checkpointDb.prepare(`
        SELECT checkpoint_json FROM ravenos_source_wallet_copyability_checkpoints
        WHERE source_wallet_id = ?
        ORDER BY evaluated_at DESC, horizon_seconds ASC, standard_order_size_usdc ASC, checkpoint_id ASC
        LIMIT ?
      `).bind(sourceId, Math.min(SourceWalletCopyabilityCheckpointLimits.maximum_profile_checkpoints, Math.max(1, Number(limit) || 1))).all();
      if (!Array.isArray(result?.results)) fail("source_wallet_checkpoint_list_query_failed");
      return result.results.map((row) => parsedJson(row.checkpoint_json, SOURCE_WALLET_COPYABILITY_CHECKPOINT_SCHEMA)).filter(Boolean);
    },
    async acquireLease(token, now) {
      await checkpointDb.prepare(`
        INSERT OR IGNORE INTO ravenos_source_wallet_copyability_checkpoint_lease (
          lease_key, lease_token, lease_expires_at, revision, updated_at
        ) VALUES ('shared_copyability_checkpoints_v1', NULL, NULL, 1, ?)
      `).bind(now).run();
      await checkpointDb.prepare(`
        UPDATE ravenos_source_wallet_copyability_checkpoint_lease
        SET lease_token = ?, lease_expires_at = ?, revision = revision + 1, updated_at = ?
        WHERE lease_key = 'shared_copyability_checkpoints_v1'
          AND (lease_token = ? OR lease_expires_at IS NULL OR lease_expires_at <= ?)
      `).bind(token, now + SourceWalletCopyabilityCheckpointLimits.evaluator_lease_seconds, now, token, now).run();
      const row = await checkpointDb.prepare(`
        SELECT lease_token FROM ravenos_source_wallet_copyability_checkpoint_lease
        WHERE lease_key = 'shared_copyability_checkpoints_v1'
      `).first();
      return row?.lease_token === token;
    },
    async releaseLease(token, now) {
      await checkpointDb.prepare(`
        UPDATE ravenos_source_wallet_copyability_checkpoint_lease
        SET lease_token = NULL, lease_expires_at = NULL, revision = revision + 1, updated_at = ?
        WHERE lease_key = 'shared_copyability_checkpoints_v1' AND lease_token = ?
      `).bind(now, token).run();
    },
  });
}

function nextDueTask(observation, now) {
  const observedAt = Math.floor(Date.parse(observation.observed_at) / 1_000);
  const completed = new Set(observation.completed_horizons || []);
  return SourceWalletCopyabilityCheckpointLimits.checkpoint_horizons_seconds
    .filter((horizon) => !completed.has(horizon) && now >= observedAt + horizon)
    .map((horizon) => ({ observation, horizon_seconds: horizon }))[0] || null;
}

function unavailableResult(error) {
  return {
    route_available: false,
    state: "provider_unavailable",
    provider_id: "configured_copy_quote_provider",
    reason_code: clean(error?.code || error?.message || "provider_unavailable", "source_wallet_checkpoint_failure", 100, { lower: true })
      .replace(/[^a-z0-9:_-]+/g, "_"),
  };
}

async function boundedMap(rows, concurrency, callback) {
  let cursor = 0;
  const output = new Array(rows.length);
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
    while (cursor < rows.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await callback(rows[index], index);
    }
  }));
  return output;
}

export async function runSourceWalletCopyabilityCheckpointBatch(store, provider, {
  now = Math.floor(Date.now() / 1_000),
  on_source_updated: onSourceUpdated = null,
} = {}) {
  if (!store?.dueObservations || !store?.sourceCheckpoint || !store?.insertSourceCheckpoint
    || !store?.insertFollowerCheckpoint || !store?.acquireLease || !store?.releaseLease) {
    fail("source_wallet_checkpoint_store_unavailable");
  }
  if (typeof provider?.quoteExit !== "function") fail("source_wallet_checkpoint_provider_unavailable");
  const token = `copyability_checkpoint_${randomUUID()}`;
  if (!(await store.acquireLease(token, now))) return freeze({ state: "lease_busy", source_event_horizons: 0, checkpoints: 0, failures: 0 });
  let sourceEventHorizons = 0;
  let sourceCheckpoints = 0;
  let followerCheckpoints = 0;
  let failures = 0;
  const updatedSources = new Set();
  try {
    const due = await store.dueObservations(now, SourceWalletCopyabilityCheckpointLimits.evaluator_due_observation_limit);
    const grouped = new Map();
    for (const observation of due) {
      const task = nextDueTask(observation, now);
      if (!task) continue;
      const key = `${observation.source_event_id}:${task.horizon_seconds}`;
      const group = grouped.get(key) || { horizon_seconds: task.horizon_seconds, observations: [] };
      group.observations.push(observation);
      grouped.set(key, group);
    }
    const tasks = [...grouped.values()].slice(0, SourceWalletCopyabilityCheckpointLimits.evaluator_source_event_batch_size);
    for (const task of tasks) {
      sourceEventHorizons += 1;
      const representative = task.observations[0];
      let sourceCheckpoint = await store.sourceCheckpoint(representative.source_event_id, task.horizon_seconds);
      if (!sourceCheckpoint) {
        let sourceResult;
        try {
          sourceResult = await provider.quoteExit({
            token_mint: representative.evaluation.destination_asset.mint,
            quantity_base_units: representative.evaluation.destination_asset.amount_base_units,
            purpose: "source_counterfactual",
            source_event_id: representative.source_event_id,
            horizon_seconds: task.horizon_seconds,
          });
        } catch (error) {
          failures += 1;
          sourceResult = unavailableResult(error);
        }
        const created = createSourceWalletOpportunityCheckpoint({
          observation: representative,
          horizon_seconds: task.horizon_seconds,
          result: sourceResult,
          evaluated_at: new Date(now * 1_000).toISOString(),
        });
        if (await store.insertSourceCheckpoint(created)) sourceCheckpoints += 1;
        sourceCheckpoint = await store.sourceCheckpoint(representative.source_event_id, task.horizon_seconds) || created;
      }
      const results = await boundedMap(
        task.observations,
        SourceWalletCopyabilityCheckpointLimits.evaluator_quote_concurrency,
        async (observation) => {
          let result;
          try {
            result = await provider.quoteExit({
              token_mint: observation.evaluation.destination_asset.mint,
              quantity_base_units: observation.evaluation.entry.expected_output_base_units,
              purpose: "follower_checkpoint",
              observation_id: observation.observation_id,
              source_event_id: observation.source_event_id,
              horizon_seconds: task.horizon_seconds,
            });
          } catch (error) {
            failures += 1;
            result = unavailableResult(error);
          }
          const checkpoint = createSourceWalletCopyabilityCheckpoint({
            observation,
            source_checkpoint: sourceCheckpoint,
            horizon_seconds: task.horizon_seconds,
            result,
            evaluated_at: new Date(now * 1_000).toISOString(),
          });
          const inserted = await store.insertFollowerCheckpoint(checkpoint);
          if (inserted) updatedSources.add(observation.source_wallet_id);
          return inserted;
        },
      );
      followerCheckpoints += results.filter(Boolean).length;
    }
    if (typeof onSourceUpdated === "function") {
      for (const sourceId of updatedSources) await onSourceUpdated(sourceId, now);
    }
    return freeze({
      state: "complete",
      source_event_horizons: sourceEventHorizons,
      source_checkpoints: sourceCheckpoints,
      follower_checkpoints: followerCheckpoints,
      failures,
      sources_updated: updatedSources.size,
    });
  } finally {
    await store.releaseLease(token, now).catch(() => undefined);
  }
}

export const SourceWalletCopyabilityCheckpointContract = Object.freeze({
  activation_flag: "RAVENOS_WALLET_COPYABILITY_CHECKPOINTS_ENABLED",
  horizons_seconds: SourceWalletCopyabilityCheckpointLimits.checkpoint_horizons_seconds,
  reference_horizon_seconds: SourceWalletCopyabilityCheckpointLimits.reference_horizon_seconds,
  one_source_quote_per_event_horizon: true,
  failures_recorded_as_zero_returns: false,
  source_counterfactual_presented_as_realized_pnl: false,
  expected_quotes_presented_as_fills: false,
  follower_capture_capped: false,
  subscriber_identity_included: false,
  shadow_only: true,
  live_copy: false,
  signing: false,
  broadcasting: false,
  custody: false,
  fee_collection: false,
});
