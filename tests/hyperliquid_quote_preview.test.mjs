import assert from "node:assert/strict";
import test from "node:test";

import { createHyperliquidMarketPreview } from "../lib/customer_trade/hyperliquid_quote_preview.mjs";

const NOW = Date.parse("2026-07-24T14:00:05Z");

function fixture(overrides = {}) {
  return {
    instrument_id: "hyperliquid:perp:SOL",
    side: "long",
    notional_usdc: 1_000,
    leverage: 5,
    max_impact_bps: 100,
    market: {
      instrument_id: "hyperliquid:perp:SOL",
      symbol: "SOL",
      max_leverage: 20,
    },
    book: {
      coin: "SOL",
      observed_at: "2026-07-24T14:00:03Z",
      bids: [
        { price: 99.9, size: 8, notional_usd: 799.2 },
        { price: 99.8, size: 8, notional_usd: 798.4 },
      ],
      asks: [
        { price: 100.1, size: 5, notional_usd: 500.5 },
        { price: 100.2, size: 10, notional_usd: 1_002 },
      ],
      summary: {
        best_bid: 99.9,
        best_ask: 100.1,
        mid_price: 100,
        spread_bps: 20,
      },
    },
    ...overrides,
  };
}

test("long preview consumes exact asks and remains non-executable", () => {
  const preview = createHyperliquidMarketPreview(fixture(), { now: NOW });
  assert.equal(preview.ok, true);
  assert.equal(preview.state, "market_preview_available");
  assert.equal(preview.instrument.instrument_id, "hyperliquid:perp:SOL");
  assert.equal(preview.route.consumed_book_side, "asks");
  assert.equal(preview.fill_estimate.visible_levels_consumed, 2);
  assert.ok(preview.fill_estimate.vwap_price > 100.1);
  assert.equal(preview.intent.estimated_initial_margin_usdc, 200);
  assert.equal(preview.execution_boundary.prepared_order_available, false);
  assert.equal(preview.execution_boundary.signing_available, false);
  assert.equal(preview.execution_boundary.submission_available, false);
  assert.equal(preview.review.review_ready, false);
  assert.ok(preview.review.blockers.includes("account_fee_tier_required"));
});

test("short preview consumes bids and calculates adverse impact from mid", () => {
  const preview = createHyperliquidMarketPreview(fixture({
    side: "short",
    notional_usdc: 1_000,
  }), { now: NOW });
  assert.equal(preview.ok, true);
  assert.equal(preview.route.consumed_book_side, "bids");
  assert.equal(preview.fill_estimate.visible_levels_consumed, 2);
  assert.ok(preview.fill_estimate.vwap_price < 99.9);
  assert.ok(preview.fill_estimate.price_impact_bps > 10);
});

test("exact identity mismatch is refused without substituting another market", () => {
  const preview = createHyperliquidMarketPreview(fixture({
    instrument_id: "hyperliquid:perp:BTC",
  }), { now: NOW });
  assert.equal(preview.ok, false);
  assert.equal(preview.unavailable_reason, "exact_instrument_identity_mismatch");
  assert.equal(preview.instrument.instrument_id, "hyperliquid:perp:BTC");
  assert.equal(preview.execution_boundary.submission_available, false);
});

test("stale books, invalid ordering, and insufficient visible depth fail closed", () => {
  const stale = createHyperliquidMarketPreview(fixture({
    book: {
      ...fixture().book,
      observed_at: "2026-07-24T13:59:40Z",
    },
  }), { now: NOW });
  assert.equal(stale.unavailable_reason, "book_stale");

  const inverted = createHyperliquidMarketPreview(fixture({
    book: {
      ...fixture().book,
      asks: [...fixture().book.asks].reverse(),
    },
  }), { now: NOW });
  assert.equal(inverted.unavailable_reason, "book_order_invalid");

  const shallow = createHyperliquidMarketPreview(fixture({
    notional_usdc: 50_000,
  }), { now: NOW });
  assert.equal(shallow.unavailable_reason, "insufficient_visible_depth");
});

test("leverage and impact bounds are enforced before review", () => {
  const leverage = createHyperliquidMarketPreview(fixture({ leverage: 25 }), { now: NOW });
  assert.equal(leverage.unavailable_reason, "leverage_exceeds_market_maximum");

  const impact = createHyperliquidMarketPreview(fixture({
    max_impact_bps: 5,
  }), { now: NOW });
  assert.equal(impact.unavailable_reason, "price_impact_limit_exceeded");
});

test("preview identity is deterministic for one exact book observation and intent", () => {
  const first = createHyperliquidMarketPreview(fixture(), { now: NOW });
  const second = createHyperliquidMarketPreview(fixture(), { now: NOW + 500 });
  assert.equal(first.preview_id, second.preview_id);
  assert.equal(first.expires_at, second.expires_at);
});
