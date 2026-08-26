import { createHash } from "node:crypto";

import { normalizeHyperliquidCoin } from "../hyperliquid_market.mjs";
import { createHyperliquidMarketPreview } from "./hyperliquid_quote_preview.mjs";

export const HYPERLIQUID_ORDER_PLAN_SCHEMA = "ravenos.hyperliquid_order_plan.v1";

const SIDES = new Set(["long", "short"]);
const ORDER_TYPES = new Set(["market", "limit", "trigger"]);
const TIME_IN_FORCE = new Set(["gtc", "alo", "ioc"]);
const MIN_NOTIONAL_USDC = 10;
const MAX_NOTIONAL_USDC = 250_000;
const DEFAULT_MAX_BOOK_AGE_MS = 8_000;
const DEFAULT_PLAN_TTL_MS = 12_000;

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rounded(value, digits = 8) {
  return Number(Number(value).toFixed(digits));
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function levelsAreOrdered(levels, direction) {
  for (let index = 1; index < levels.length; index += 1) {
    const previous = finite(levels[index - 1]?.price);
    const current = finite(levels[index]?.price);
    if (previous === null || current === null) return false;
    if (direction === "ascending" && current < previous) return false;
    if (direction === "descending" && current > previous) return false;
  }
  return true;
}

function walkBookByBase(levels, requestedBase, acceptsPrice) {
  let remainingBase = requestedBase;
  let filledBase = 0;
  let filledNotional = 0;
  let worstPrice = null;
  let levelsConsumed = 0;

  for (const level of levels) {
    if (remainingBase <= Math.max(1e-12, requestedBase * 1e-10)) break;
    const price = finite(level?.price);
    const size = finite(level?.size);
    if (!(price > 0) || !(size > 0) || !acceptsPrice(price)) continue;
    const consumedBase = Math.min(remainingBase, size);
    filledBase += consumedBase;
    filledNotional += consumedBase * price;
    remainingBase -= consumedBase;
    worstPrice = price;
    levelsConsumed += 1;
  }

  return {
    complete: remainingBase <= Math.max(1e-10, requestedBase * 1e-8),
    filled_base_size: filledBase,
    filled_notional_usdc: filledNotional,
    remaining_base_size: Math.max(0, remainingBase),
    worst_price: worstPrice,
    levels_consumed: levelsConsumed,
  };
}

function unavailable(reason, details = {}) {
  return {
    ok: false,
    schema_version: HYPERLIQUID_ORDER_PLAN_SCHEMA,
    state: "unavailable",
    unavailable_reason: reason,
    instrument: {
      instrument_id: details.instrumentId || null,
      exact_market_id: details.coin || null,
      venue: "hyperliquid",
      identity_scope: "exact_instrument",
    },
    requested_plan: {
      side: details.side || null,
      order_type: details.orderType || null,
      notional_usdc: details.notionalUsdc,
      leverage: details.leverage,
    },
    execution_boundary: {
      order_plan_only: true,
      prepared_order_available: false,
      signing_available: false,
      submission_available: false,
    },
  };
}

function bracketFor({ side, entryReference, notionalUsdc, takeProfitPrice, stopLossPrice }) {
  const hasTakeProfit = takeProfitPrice !== null;
  const hasStopLoss = stopLossPrice !== null;
  if (!hasTakeProfit && !hasStopLoss) return { ok: true, bracket: null };
  if (hasTakeProfit && !(takeProfitPrice > 0)) return { ok: false, reason: "take_profit_price_invalid" };
  if (hasStopLoss && !(stopLossPrice > 0)) return { ok: false, reason: "stop_loss_price_invalid" };

  const takeProfitValid = !hasTakeProfit || (side === "long" ? takeProfitPrice > entryReference : takeProfitPrice < entryReference);
  const stopLossValid = !hasStopLoss || (side === "long" ? stopLossPrice < entryReference : stopLossPrice > entryReference);
  if (!takeProfitValid) return { ok: false, reason: "take_profit_side_mismatch" };
  if (!stopLossValid) return { ok: false, reason: "stop_loss_side_mismatch" };

  const rewardFraction = hasTakeProfit ? Math.abs(takeProfitPrice - entryReference) / entryReference : null;
  const riskFraction = hasStopLoss ? Math.abs(stopLossPrice - entryReference) / entryReference : null;
  const rewardToRisk = rewardFraction !== null && riskFraction > 0 ? rewardFraction / riskFraction : null;
  return {
    ok: true,
    bracket: {
      configured: true,
      take_profit_price: hasTakeProfit ? rounded(takeProfitPrice, 10) : null,
      stop_loss_price: hasStopLoss ? rounded(stopLossPrice, 10) : null,
      reward_pct: rewardFraction === null ? null : rounded(rewardFraction * 100, 4),
      risk_pct: riskFraction === null ? null : rounded(riskFraction * 100, 4),
      reward_to_risk: rewardToRisk === null ? null : rounded(rewardToRisk, 3),
      target_pnl_usdc: rewardFraction === null ? null : rounded(notionalUsdc * rewardFraction, 2),
      stop_pnl_usdc: riskFraction === null ? null : rounded(-notionalUsdc * riskFraction, 2),
      fees_and_slippage_included: false,
      orders_prepared: false,
    },
  };
}

export function createHyperliquidOrderPlan(input = {}, {
  now = Date.now(),
  maxBookAgeMs = DEFAULT_MAX_BOOK_AGE_MS,
  planTtlMs = DEFAULT_PLAN_TTL_MS,
} = {}) {
  const instrumentId = String(input.instrument_id || input.instrumentId || "").trim();
  const side = String(input.side || "").trim().toLowerCase();
  const orderType = String(input.order_type || input.orderType || "market").trim().toLowerCase();
  const notionalUsdc = finite(input.notional_usdc ?? input.notionalUsdc ?? input.notional);
  const leverage = finite(input.leverage);
  const limitPrice = finite(input.limit_price ?? input.limitPrice);
  const triggerPrice = finite(input.trigger_price ?? input.triggerPrice);
  const takeProfitPrice = finite(input.take_profit_price ?? input.takeProfitPrice);
  const stopLossPrice = finite(input.stop_loss_price ?? input.stopLossPrice);
  const requestedTif = String(input.time_in_force || input.timeInForce || "gtc").trim().toLowerCase();
  const book = input.book && typeof input.book === "object" ? input.book : {};
  const market = input.market && typeof input.market === "object" ? input.market : {};
  const coin = normalizeHyperliquidCoin(book.coin || market.symbol || market.coin);
  const expectedInstrumentId = coin ? `hyperliquid:perp:${coin}` : null;
  const observedAt = timestamp(book.observed_at);
  const observedMs = observedAt ? Date.parse(observedAt) : null;
  const fail = (reason) => unavailable(reason, {
    instrumentId: instrumentId || null,
    coin,
    side: side || null,
    orderType: orderType || null,
    notionalUsdc,
    leverage,
  });

  if (!coin || !expectedInstrumentId || instrumentId !== expectedInstrumentId) return fail("exact_instrument_identity_mismatch");
  if (market.instrument_id && market.instrument_id !== instrumentId) return fail("market_identity_mismatch");
  if (!SIDES.has(side)) return fail("side_invalid");
  if (!ORDER_TYPES.has(orderType)) return fail("order_type_invalid");
  if (!(notionalUsdc >= MIN_NOTIONAL_USDC) || notionalUsdc > MAX_NOTIONAL_USDC) return fail("notional_out_of_bounds");
  const maximumLeverage = finite(market.max_leverage ?? market.maxLeverage);
  if (!(leverage >= 1) || !Number.isInteger(leverage)) return fail("leverage_invalid");
  if (!(maximumLeverage >= 1) || leverage > maximumLeverage) return fail("leverage_exceeds_market_maximum");
  if (!observedAt || observedMs === null) return fail("book_timestamp_unavailable");
  const bookAgeMs = now - observedMs;
  if (bookAgeMs < -5_000 || bookAgeMs > maxBookAgeMs) return fail("book_stale");

  const bids = Array.isArray(book.bids) ? book.bids : [];
  const asks = Array.isArray(book.asks) ? book.asks : [];
  if (!bids.length || !asks.length) return fail("book_depth_unavailable");
  if (!levelsAreOrdered(bids, "descending") || !levelsAreOrdered(asks, "ascending")) return fail("book_order_invalid");
  const bestBid = finite(book.summary?.best_bid ?? bids[0]?.price);
  const bestAsk = finite(book.summary?.best_ask ?? asks[0]?.price);
  const midPrice = finite(book.summary?.mid_price) ?? (bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null);
  if (!(bestBid > 0) || !(bestAsk > 0) || !(midPrice > 0) || bestAsk < bestBid) return fail("book_summary_invalid");

  let timeInForce = null;
  let entryReference = null;
  let plannedBaseSize = null;
  let fillEstimate = null;
  let entryModel = null;

  if (orderType === "market") {
    const marketPreview = createHyperliquidMarketPreview({
      ...input,
      instrument_id: instrumentId,
      side,
      notional_usdc: notionalUsdc,
      leverage,
      book,
      market,
    }, { now, maxBookAgeMs, previewTtlMs: planTtlMs });
    if (!marketPreview.ok) return fail(marketPreview.unavailable_reason || "market_preview_unavailable");
    entryReference = marketPreview.fill_estimate.vwap_price;
    plannedBaseSize = marketPreview.fill_estimate.base_size;
    fillEstimate = marketPreview.fill_estimate;
    entryModel = {
      state: "current_book_fill_estimate",
      marketable: true,
      fill_guaranteed: false,
      reference_price: entryReference,
      reference_source: "current_live_book_vwap",
    };
  } else if (orderType === "limit") {
    if (!(limitPrice > 0)) return fail("limit_price_invalid");
    if (!TIME_IN_FORCE.has(requestedTif)) return fail("time_in_force_invalid");
    timeInForce = requestedTif;
    const marketable = side === "long" ? limitPrice >= bestAsk : limitPrice <= bestBid;
    if (timeInForce === "alo" && marketable) return fail("post_only_would_cross");
    if (timeInForce === "ioc" && !marketable) return fail("ioc_not_marketable");
    plannedBaseSize = notionalUsdc / limitPrice;
    entryReference = limitPrice;
    if (marketable) {
      const levels = side === "long" ? asks : bids;
      const walked = walkBookByBase(
        levels,
        plannedBaseSize,
        side === "long" ? (price) => price <= limitPrice : (price) => price >= limitPrice,
      );
      if (!walked.complete || !(walked.filled_base_size > 0) || !(walked.worst_price > 0)) return fail("insufficient_depth_inside_limit");
      const vwapPrice = walked.filled_notional_usdc / walked.filled_base_size;
      fillEstimate = {
        base_size: rounded(walked.filled_base_size, 10),
        vwap_price: rounded(vwapPrice, 10),
        worst_price: rounded(walked.worst_price, 10),
        mid_price: rounded(midPrice, 10),
        best_bid: rounded(bestBid, 10),
        best_ask: rounded(bestAsk, 10),
        spread_bps: finite(book.summary?.spread_bps),
        price_impact_bps: rounded(Math.max(0, side === "long"
          ? ((vwapPrice - midPrice) / midPrice) * 10_000
          : ((midPrice - vwapPrice) / midPrice) * 10_000), 4),
        visible_levels_consumed: walked.levels_consumed,
      };
      entryReference = fillEstimate.vwap_price;
    }
    entryModel = {
      state: marketable ? "currently_marketable_limit" : "resting_limit",
      marketable,
      fill_guaranteed: false,
      reference_price: rounded(entryReference, 10),
      reference_source: marketable ? "current_live_book_vwap" : "user_limit_price",
      distance_from_mid_bps: rounded(((limitPrice - midPrice) / midPrice) * 10_000, 2),
    };
  } else {
    if (!(triggerPrice > 0)) return fail("trigger_price_invalid");
    const correctSide = side === "long" ? triggerPrice > midPrice : triggerPrice < midPrice;
    if (!correctSide) return fail("trigger_side_mismatch");
    entryReference = triggerPrice;
    plannedBaseSize = notionalUsdc / triggerPrice;
    entryModel = {
      state: "conditional_stop_entry",
      marketable: false,
      fill_guaranteed: false,
      reference_price: rounded(triggerPrice, 10),
      reference_source: "user_trigger_price",
      distance_from_mid_bps: rounded(((triggerPrice - midPrice) / midPrice) * 10_000, 2),
      future_fill_price_estimated: false,
    };
  }

  const bracketResult = bracketFor({
    side,
    entryReference,
    notionalUsdc,
    takeProfitPrice,
    stopLossPrice,
  });
  if (!bracketResult.ok) return fail(bracketResult.reason);

  const expiresAtMs = Math.min(observedMs + planTtlMs, now + planTtlMs);
  if (expiresAtMs <= now) return fail("book_stale");
  const planBinding = {
    instrument_id: instrumentId,
    exact_market_id: coin,
    side,
    order_type: orderType,
    time_in_force: timeInForce,
    notional_usdc: rounded(notionalUsdc, 2),
    leverage,
    limit_price: orderType === "limit" ? rounded(limitPrice, 10) : null,
    trigger_price: orderType === "trigger" ? rounded(triggerPrice, 10) : null,
    take_profit_price: bracketResult.bracket?.take_profit_price ?? null,
    stop_loss_price: bracketResult.bracket?.stop_loss_price ?? null,
    observed_at: observedAt,
    expires_at: new Date(expiresAtMs).toISOString(),
  };

  return {
    ok: true,
    schema_version: HYPERLIQUID_ORDER_PLAN_SCHEMA,
    state: "order_plan_available",
    plan_id: `hlop_${hash(planBinding).slice(0, 24)}`,
    generated_at: new Date(now).toISOString(),
    expires_at: planBinding.expires_at,
    instrument: {
      instrument_id: instrumentId,
      exact_market_id: coin,
      symbol: `${coin}-PERP`,
      venue: "hyperliquid",
      instrument_type: "perpetual",
      identity_scope: "exact_instrument",
      collateral_asset: "USDC",
    },
    intent: {
      side,
      order_type: orderType,
      time_in_force: timeInForce,
      requested_notional_usdc: planBinding.notional_usdc,
      leverage,
      limit_price: planBinding.limit_price,
      trigger_price: planBinding.trigger_price,
      estimated_initial_margin_usdc: rounded(notionalUsdc / leverage, 2),
      planned_base_size: rounded(plannedBaseSize, 10),
      margin_estimate_excludes_existing_exposure: true,
    },
    entry_model: entryModel,
    ...(fillEstimate ? { fill_estimate: fillEstimate } : {}),
    ...(bracketResult.bracket ? { risk_bracket: bracketResult.bracket } : {}),
    market_reference: {
      mid_price: rounded(midPrice, 10),
      best_bid: rounded(bestBid, 10),
      best_ask: rounded(bestAsk, 10),
      spread_bps: finite(book.summary?.spread_bps),
    },
    provenance: {
      provider: "Hyperliquid",
      source: "live_l2_book",
      observed_at: observedAt,
      age_ms: Math.max(0, bookAgeMs),
      freshness: "current",
      exact_identity: true,
    },
    review: {
      state: "order_plan_only",
      prepared_payload_included: false,
      account_state_included: false,
      user_confirmation_recorded: false,
    },
    execution_boundary: {
      order_plan_only: true,
      account_connected: false,
      prepared_order_available: false,
      signing_available: false,
      submission_available: false,
      position_monitoring_available: false,
    },
  };
}
