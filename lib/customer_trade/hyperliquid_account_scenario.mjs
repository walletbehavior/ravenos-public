import { createHash } from "node:crypto";

import { normalizeHyperliquidAddress } from "./hyperliquid_account_snapshot.mjs";

export const HYPERLIQUID_ACCOUNT_SCENARIO_SCHEMA = "ravenos.hyperliquid_account_scenario.v1";

const MARGIN_MODES = new Set(["cross", "isolated"]);
const DEFAULT_MAX_ACCOUNT_AGE_MS = 12_000;

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rounded(value, digits = 8) {
  const number = finite(value);
  return number === null ? null : Number(number.toFixed(digits));
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function unavailable(reason, details = {}) {
  return {
    ok: false,
    schema_version: HYPERLIQUID_ACCOUNT_SCENARIO_SCHEMA,
    state: "unavailable",
    unavailable_reason: reason,
    instrument: {
      instrument_id: details.instrumentId || null,
      exact_market_id: details.market || null,
      venue: "hyperliquid",
      identity_scope: "exact_instrument",
    },
    account: {
      address: details.address || null,
      ownership_asserted: false,
    },
    execution_boundary: {
      account_scenario_only: true,
      prepared_order_available: false,
      wallet_confirmation_available: false,
      signing_available: false,
      submission_available: false,
    },
  };
}

function classifyPositionEffect(beforeSignedSize, deltaSignedSize) {
  const epsilon = Math.max(1e-10, Math.abs(beforeSignedSize) * 1e-10, Math.abs(deltaSignedSize) * 1e-10);
  const projectedRaw = beforeSignedSize + deltaSignedSize;
  const projectedSignedSize = Math.abs(projectedRaw) <= epsilon ? 0 : projectedRaw;
  let effect;
  if (Math.abs(beforeSignedSize) <= epsilon) effect = "open";
  else if (Math.sign(beforeSignedSize) === Math.sign(deltaSignedSize)) effect = "increase";
  else if (projectedSignedSize === 0) effect = "close";
  else if (Math.sign(projectedSignedSize) === Math.sign(beforeSignedSize)) effect = "reduce";
  else effect = "flip";
  return { effect, projectedSignedSize };
}

function positionSide(signedSize) {
  if (signedSize > 0) return "long";
  if (signedSize < 0) return "short";
  return "flat";
}

export function createHyperliquidAccountScenario(input = {}, {
  now = Date.now(),
  maxAccountAgeMs = DEFAULT_MAX_ACCOUNT_AGE_MS,
} = {}) {
  const plan = input.plan && typeof input.plan === "object" ? input.plan : {};
  const snapshot = input.snapshot && typeof input.snapshot === "object" ? input.snapshot : {};
  const address = normalizeHyperliquidAddress(input.address || snapshot.account?.address);
  const instrumentId = String(plan.instrument?.instrument_id || "").trim();
  const market = String(plan.instrument?.exact_market_id || "").trim().toUpperCase();
  const fail = (reason) => unavailable(reason, { address, instrumentId, market });

  if (!plan.ok || plan.state !== "order_plan_available") return fail(plan.unavailable_reason || "order_plan_unavailable");
  if (!address || normalizeHyperliquidAddress(snapshot.account?.address) !== address) return fail("account_identity_mismatch");
  if (!snapshot.ok || snapshot.venue !== "hyperliquid") return fail("account_snapshot_unavailable");
  const observedAt = timestamp(snapshot.observed_at);
  const observedMs = observedAt ? Date.parse(observedAt) : null;
  if (observedMs === null || now - observedMs > maxAccountAgeMs || now - observedMs < -5_000) return fail("account_snapshot_stale");
  const planExpiresAt = timestamp(plan.expires_at);
  if (!planExpiresAt || Date.parse(planExpiresAt) <= now) return fail("order_plan_expired");
  if (!instrumentId || instrumentId !== `hyperliquid:perp:${market}`) return fail("exact_instrument_identity_mismatch");

  const marginMode = String(input.margin_mode || input.marginMode || "cross").trim().toLowerCase();
  if (!MARGIN_MODES.has(marginMode)) return fail("margin_mode_invalid");
  const reduceOnly = input.reduce_only === true || input.reduceOnly === true;
  const plannedBaseSize = finite(plan.intent?.planned_base_size);
  const requestedNotional = finite(plan.intent?.requested_notional_usdc);
  const leverage = finite(plan.intent?.leverage);
  const entryReference = finite(plan.entry_model?.reference_price);
  const side = String(plan.intent?.side || "").toLowerCase();
  if (!(plannedBaseSize > 0) || !(requestedNotional > 0) || !(leverage >= 1) || !(entryReference > 0) || !new Set(["long", "short"]).has(side)) {
    return fail("order_plan_semantics_invalid");
  }

  const currentPosition = (Array.isArray(snapshot.positions) ? snapshot.positions : [])
    .find((position) => String(position.market || "").toUpperCase() === market) || null;
  const beforeSignedSize = finite(currentPosition?.signed_size) ?? 0;
  const deltaSignedSize = side === "long" ? plannedBaseSize : -plannedBaseSize;
  const { effect, projectedSignedSize } = classifyPositionEffect(beforeSignedSize, deltaSignedSize);
  if (reduceOnly && !new Set(["reduce", "close"]).has(effect)) return fail("reduce_only_would_not_reduce_position");

  const takerRate = finite(input.fees?.userCrossRate ?? input.fees?.user_cross_rate);
  const makerRate = finite(input.fees?.userAddRate ?? input.fees?.user_add_rate);
  if (takerRate === null || makerRate === null || takerRate < 0 || makerRate < -0.01 || takerRate > 0.05 || makerRate > 0.05) {
    return fail("account_fee_rate_unavailable");
  }
  const orderType = String(plan.intent?.order_type || "").toLowerCase();
  const takerAssumption = orderType === "market" || orderType === "trigger" || plan.entry_model?.marketable === true;
  const appliedFeeRate = takerAssumption ? takerRate : makerRate;
  const entryFee = requestedNotional * appliedFeeRate;

  const openingBaseSize = effect === "open" || effect === "increase"
    ? Math.abs(deltaSignedSize)
    : effect === "flip"
      ? Math.abs(projectedSignedSize)
      : 0;
  const incrementalNotional = openingBaseSize * entryReference;
  const incrementalMargin = incrementalNotional / leverage;
  const requiredWithdrawable = incrementalMargin + Math.max(0, entryFee);
  const withdrawable = finite(snapshot.summary?.withdrawable_usdc);
  if (withdrawable === null) return fail("account_withdrawable_unavailable");
  const marginPasses = withdrawable + 1e-8 >= requiredWithdrawable;

  const currentLeverage = finite(currentPosition?.leverage);
  const currentMarginMode = String(currentPosition?.leverage_mode || "").toLowerCase() || null;
  const settingsChangeRequired = !new Set(["reduce", "close"]).has(effect) && Boolean(currentPosition) && (
    (currentMarginMode && currentMarginMode !== marginMode)
    || (currentLeverage !== null && currentLeverage !== leverage)
  );
  const blockers = [];
  if (!marginPasses) blockers.push("insufficient_current_withdrawable");
  if (settingsChangeRequired) blockers.push("venue_margin_settings_change_required");

  const binding = {
    account_address: address,
    account_observed_at: observedAt,
    plan_id: plan.plan_id,
    instrument_id: instrumentId,
    market,
    side,
    order_type: orderType,
    time_in_force: plan.intent?.time_in_force ?? null,
    requested_notional_usdc: rounded(requestedNotional, 2),
    planned_base_size: rounded(plannedBaseSize, 10),
    leverage,
    margin_mode: marginMode,
    reduce_only: reduceOnly,
    entry_fee_rate: rounded(appliedFeeRate, 10),
    expires_at: planExpiresAt,
  };
  const bindingHash = hash(binding);

  return {
    ok: true,
    schema_version: HYPERLIQUID_ACCOUNT_SCENARIO_SCHEMA,
    state: blockers.length ? "account_scenario_blocked" : "account_scenario_available",
    scenario_id: `hlas_${bindingHash.slice(0, 24)}`,
    generated_at: new Date(now).toISOString(),
    expires_at: planExpiresAt,
    instrument: plan.instrument,
    intent: {
      ...plan.intent,
      margin_mode: marginMode,
      reduce_only: reduceOnly,
    },
    entry_model: plan.entry_model,
    ...(plan.fill_estimate ? { fill_estimate: plan.fill_estimate } : {}),
    ...(plan.risk_bracket ? { risk_bracket: plan.risk_bracket } : {}),
    market_reference: plan.market_reference,
    account_context: {
      address,
      ownership_asserted: false,
      observed_at: observedAt,
      account_value_usdc: rounded(snapshot.summary?.account_value_usdc),
      withdrawable_usdc: rounded(withdrawable),
      margin_used_usdc: rounded(snapshot.summary?.margin_used_usdc),
      maintenance_margin_usdc: rounded(snapshot.summary?.maintenance_margin_usdc),
      current_position: currentPosition ? {
        side: currentPosition.side,
        signed_size: rounded(beforeSignedSize, 10),
        size: rounded(Math.abs(beforeSignedSize), 10),
        mark_notional_usdc: rounded(currentPosition.mark_notional_usdc),
        liquidation_price: rounded(currentPosition.liquidation_price),
        leverage: currentLeverage,
        margin_mode: currentMarginMode,
      } : null,
    },
    position_effect: {
      effect,
      before_signed_size: rounded(beforeSignedSize, 10),
      order_delta_signed_size: rounded(deltaSignedSize, 10),
      projected_signed_size: rounded(projectedSignedSize, 10),
      projected_side: positionSide(projectedSignedSize),
      projected_size: rounded(Math.abs(projectedSignedSize), 10),
      projected_notional_usdc: rounded(Math.abs(projectedSignedSize) * entryReference, 2),
      liquidation_projection_included: false,
    },
    fee_estimate: {
      liquidity_assumption: takerAssumption ? "taker" : "maker",
      account_fee_rate: rounded(appliedFeeRate, 10),
      estimated_entry_fee_usdc: rounded(entryFee, 4),
      bracket_exit_fees_included: false,
    },
    margin_check: {
      state: marginPasses ? "passes_current_snapshot" : "insufficient_current_withdrawable",
      withdrawable_before_usdc: rounded(withdrawable, 4),
      estimated_incremental_notional_usdc: rounded(incrementalNotional, 2),
      estimated_incremental_margin_usdc: rounded(incrementalMargin, 2),
      estimated_entry_fee_usdc: rounded(entryFee, 4),
      estimated_required_withdrawable_usdc: rounded(requiredWithdrawable, 4),
      estimated_withdrawable_after_usdc: rounded(withdrawable - requiredWithdrawable, 4),
      existing_exposure_netting_modeled: true,
    },
    venue_settings: {
      requested_margin_mode: marginMode,
      requested_leverage: leverage,
      current_margin_mode: currentMarginMode,
      current_leverage: currentLeverage,
      settings_change_required: settingsChangeRequired,
      settings_action_prepared: false,
    },
    provenance: {
      provider: "Hyperliquid",
      market_source: plan.provenance?.source || "live_l2_book",
      market_observed_at: plan.provenance?.observed_at || null,
      account_observed_at: observedAt,
      exact_identity: true,
    },
    review: {
      state: blockers.length ? "blocked" : "account_scenario_ready",
      blockers,
      immutable_binding_hash: bindingHash,
      immutable_binding_included: true,
      prepared_payload_included: false,
      user_confirmation_recorded: false,
    },
    execution_boundary: {
      account_scenario_only: true,
      public_account_observation: true,
      ownership_asserted: false,
      prepared_order_available: false,
      wallet_confirmation_available: false,
      signing_available: false,
      submission_available: false,
      position_monitoring_available: false,
    },
  };
}
