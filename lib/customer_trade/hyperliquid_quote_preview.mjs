import { createHash } from "node:crypto";

import { normalizeHyperliquidCoin } from "../hyperliquid_market.mjs";
import { CustomerTradeSchemaVersions } from "./contracts.mjs";

export const HYPERLIQUID_MARKET_PREVIEW_SCHEMA = CustomerTradeSchemaVersions.hyperliquid_market_preview;

const SIDES = new Set(["long", "short"]);
const DEFAULT_MAX_BOOK_AGE_MS = 8_000;
const DEFAULT_PREVIEW_TTL_MS = 8_000;
const MIN_NOTIONAL_USDC = 10;
const MAX_NOTIONAL_USDC = 250_000;
const MAX_IMPACT_BPS = 500;

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

function resultUnavailable(reason, {
  instrumentId = null,
  coin = null,
  side = null,
  notionalUsdc = null,
  leverage = null,
  observedAt = null,
} = {}) {
  return {
    ok: false,
    schema_version: HYPERLIQUID_MARKET_PREVIEW_SCHEMA,
    state: "unavailable",
    unavailable_reason: reason,
    instrument: {
      instrument_id: instrumentId,
      exact_market_id: coin,
      venue: "hyperliquid",
      identity_scope: "exact_instrument",
    },
    requested_intent: {
      side,
      notional_usdc: notionalUsdc,
      leverage,
    },
    provenance: {
      provider: "Hyperliquid",
      source: "live_l2_book",
      observed_at: observedAt,
      exact_identity: false,
    },
    execution_boundary: {
      market_preview_only: true,
      account_connected: false,
      prepared_order_available: false,
      signing_available: false,
      submission_available: false,
      position_monitoring_available: false,
    },
  };
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

function walkBook(levels, requestedNotional) {
  let remaining = requestedNotional;
  let filledNotional = 0;
  let filledBase = 0;
  let worstPrice = null;
  let levelsConsumed = 0;

  for (const level of levels) {
    if (remaining <= 1e-8) break;
    const price = finite(level?.price);
    const size = finite(level?.size);
    if (!(price > 0) || !(size > 0)) continue;
    const availableNotional = price * size;
    const consumedNotional = Math.min(remaining, availableNotional);
    const consumedBase = consumedNotional / price;
    filledNotional += consumedNotional;
    filledBase += consumedBase;
    remaining -= consumedNotional;
    worstPrice = price;
    levelsConsumed += 1;
  }

  return {
    complete: remaining <= Math.max(1e-6, requestedNotional * 1e-10),
    filled_notional_usdc: filledNotional,
    filled_base_size: filledBase,
    remaining_notional_usdc: Math.max(0, remaining),
    worst_price: worstPrice,
    levels_consumed: levelsConsumed,
  };
}

export function createHyperliquidMarketPreview(input = {}, {
  now = Date.now(),
  maxBookAgeMs = DEFAULT_MAX_BOOK_AGE_MS,
  previewTtlMs = DEFAULT_PREVIEW_TTL_MS,
} = {}) {
  const instrumentId = String(input.instrument_id || input.instrumentId || "").trim();
  const side = String(input.side || "").trim().toLowerCase();
  const notionalUsdc = finite(input.notional_usdc ?? input.notionalUsdc ?? input.notional);
  const leverage = finite(input.leverage);
  const maxImpactBps = finite(input.max_impact_bps ?? input.maxImpactBps) ?? MAX_IMPACT_BPS;
  const book = input.book && typeof input.book === "object" ? input.book : {};
  const market = input.market && typeof input.market === "object" ? input.market : {};
  const coin = normalizeHyperliquidCoin(book.coin || market.symbol || market.coin);
  const expectedInstrumentId = coin ? `hyperliquid:perp:${coin}` : null;
  const observedAt = timestamp(book.observed_at);
  const observedMs = observedAt ? Date.parse(observedAt) : null;

  const unavailable = (reason) => resultUnavailable(reason, {
    instrumentId: instrumentId || null,
    coin,
    side: side || null,
    notionalUsdc,
    leverage,
    observedAt,
  });

  if (!coin || !expectedInstrumentId || instrumentId !== expectedInstrumentId) return unavailable("exact_instrument_identity_mismatch");
  if (market.instrument_id && market.instrument_id !== instrumentId) return unavailable("market_identity_mismatch");
  if (!SIDES.has(side)) return unavailable("side_invalid");
  if (!(notionalUsdc >= MIN_NOTIONAL_USDC) || notionalUsdc > MAX_NOTIONAL_USDC) return unavailable("notional_out_of_bounds");
  const maximumLeverage = finite(market.max_leverage ?? market.maxLeverage);
  if (!(leverage >= 1) || !Number.isInteger(leverage)) return unavailable("leverage_invalid");
  if (!(maximumLeverage >= 1) || leverage > maximumLeverage) return unavailable("leverage_exceeds_market_maximum");
  if (!(maxImpactBps >= 0) || maxImpactBps > MAX_IMPACT_BPS) return unavailable("impact_limit_invalid");
  if (!observedAt || observedMs === null) return unavailable("book_timestamp_unavailable");
  const bookAgeMs = now - observedMs;
  if (bookAgeMs < -5_000 || bookAgeMs > maxBookAgeMs) return unavailable("book_stale");

  const bids = Array.isArray(book.bids) ? book.bids : [];
  const asks = Array.isArray(book.asks) ? book.asks : [];
  if (!bids.length || !asks.length) return unavailable("book_depth_unavailable");
  if (!levelsAreOrdered(bids, "descending") || !levelsAreOrdered(asks, "ascending")) return unavailable("book_order_invalid");

  const midPrice = finite(book.summary?.mid_price);
  const bestBid = finite(book.summary?.best_bid ?? bids[0]?.price);
  const bestAsk = finite(book.summary?.best_ask ?? asks[0]?.price);
  if (!(midPrice > 0) || !(bestBid > 0) || !(bestAsk > 0) || bestAsk < bestBid) return unavailable("book_summary_invalid");

  const consumedSide = side === "long" ? "asks" : "bids";
  const levels = side === "long" ? asks : bids;
  const walked = walkBook(levels, notionalUsdc);
  if (!walked.complete || !(walked.filled_base_size > 0) || !(walked.worst_price > 0)) return unavailable("insufficient_visible_depth");

  const vwapPrice = walked.filled_notional_usdc / walked.filled_base_size;
  const priceImpactBps = side === "long"
    ? ((vwapPrice - midPrice) / midPrice) * 10_000
    : ((midPrice - vwapPrice) / midPrice) * 10_000;
  if (!Number.isFinite(priceImpactBps) || priceImpactBps < -0.01) return unavailable("price_impact_invalid");
  if (priceImpactBps > maxImpactBps) return unavailable("price_impact_limit_exceeded");

  const expiresAtMs = Math.min(observedMs + previewTtlMs, now + previewTtlMs);
  if (expiresAtMs <= now) return unavailable("book_stale");
  const route = {
    venue: "hyperliquid",
    exact_market_id: coin,
    consumed_book_side: consumedSide,
    order_assumption: "immediate_or_cancel_market_equivalent",
    market_order_submitted: false,
  };
  const previewBinding = {
    instrument_id: instrumentId,
    exact_market_id: coin,
    side,
    notional_usdc: rounded(notionalUsdc, 2),
    leverage,
    observed_at: observedAt,
    expires_at: new Date(expiresAtMs).toISOString(),
    filled_base_size: rounded(walked.filled_base_size, 10),
    vwap_price: rounded(vwapPrice, 10),
    worst_price: rounded(walked.worst_price, 10),
    route,
  };

  return {
    ok: true,
    schema_version: HYPERLIQUID_MARKET_PREVIEW_SCHEMA,
    state: "market_preview_available",
    preview_id: `hlmp_${hash(previewBinding).slice(0, 24)}`,
    generated_at: new Date(now).toISOString(),
    expires_at: previewBinding.expires_at,
    instrument: {
      instrument_id: instrumentId,
      exact_market_id: coin,
      symbol: `${coin}-PERP`,
      venue: "hyperliquid",
      instrument_type: "perpetual",
      identity_scope: "exact_instrument",
      collateral_asset: "USDC",
      price_denominator: "USD reference",
    },
    intent: {
      side,
      requested_notional_usdc: previewBinding.notional_usdc,
      leverage,
      estimated_initial_margin_usdc: rounded(notionalUsdc / leverage, 2),
      margin_estimate_excludes_existing_exposure: true,
    },
    fill_estimate: {
      base_size: previewBinding.filled_base_size,
      vwap_price: previewBinding.vwap_price,
      worst_price: previewBinding.worst_price,
      mid_price: rounded(midPrice, 10),
      best_bid: rounded(bestBid, 10),
      best_ask: rounded(bestAsk, 10),
      spread_bps: finite(book.summary?.spread_bps) === null ? null : rounded(book.summary.spread_bps, 4),
      price_impact_bps: rounded(Math.max(0, priceImpactBps), 4),
      visible_levels_consumed: walked.levels_consumed,
      visible_side_notional_usdc: rounded(levels.reduce((sum, level) => sum + (finite(level?.notional_usd) || 0), 0), 2),
    },
    route,
    account_dependent_values: {
      venue_fee: "requires_connected_account_fee_tier",
      available_margin: "requires_connected_account",
      liquidation_price: "requires_position_and_margin_mode",
      reduce_only_state: "requires_position",
    },
    provenance: {
      provider: "Hyperliquid",
      source: "live_l2_book",
      observed_at: observedAt,
      age_ms: Math.max(0, bookAgeMs),
      freshness: "current",
      exact_identity: true,
      levels_available: levels.length,
    },
    review: {
      state: "market_preview_only",
      review_ready: false,
      blockers: [
        "venue_account_required",
        "account_fee_tier_required",
        "margin_mode_required",
        "position_reconciliation_required",
      ],
    },
    execution_boundary: {
      market_preview_only: true,
      account_connected: false,
      prepared_order_available: false,
      signing_available: false,
      submission_available: false,
      position_monitoring_available: false,
    },
  };
}
