import assert from "node:assert/strict";
import test from "node:test";

import {
  createHyperliquidOrderPlan,
  HYPERLIQUID_ORDER_PLAN_SCHEMA,
} from "../lib/customer_trade/hyperliquid_order_plan.mjs";

const NOW = Date.parse("2026-08-26T14:00:00Z");

function fixture(overrides = {}) {
  return {
    instrument_id: "hyperliquid:perp:SOL",
    side: "long",
    order_type: "market",
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
      observed_at: new Date(NOW - 500).toISOString(),
      summary: {
        best_bid: 149.9,
        best_ask: 150.1,
        mid_price: 150,
        spread_bps: 13.3333,
      },
      bids: [
        { price: 149.9, size: 20, notional_usd: 2_998 },
        { price: 149.8, size: 30, notional_usd: 4_494 },
      ],
      asks: [
        { price: 150.1, size: 20, notional_usd: 3_002 },
        { price: 150.2, size: 30, notional_usd: 4_506 },
      ],
    },
    ...overrides,
  };
}

test("market plan binds the exact live book without preparing an order", () => {
  const plan = createHyperliquidOrderPlan(fixture(), { now: NOW });
  assert.equal(plan.ok, true);
  assert.equal(plan.schema_version, HYPERLIQUID_ORDER_PLAN_SCHEMA);
  assert.equal(plan.intent.order_type, "market");
  assert.equal(plan.intent.estimated_initial_margin_usdc, 200);
  assert.equal(plan.entry_model.state, "current_book_fill_estimate");
  assert(plan.fill_estimate.base_size > 0);
  assert.equal(plan.review.prepared_payload_included, false);
  assert.equal(plan.execution_boundary.signing_available, false);
  assert.equal(plan.execution_boundary.submission_available, false);
});

test("resting limit plan reports distance and never claims a fill", () => {
  const plan = createHyperliquidOrderPlan(fixture({
    order_type: "limit",
    limit_price: 148,
    time_in_force: "gtc",
    take_profit_price: 155,
    stop_loss_price: 145,
  }), { now: NOW });
  assert.equal(plan.ok, true);
  assert.equal(plan.entry_model.state, "resting_limit");
  assert.equal(plan.entry_model.marketable, false);
  assert.equal("fill_estimate" in plan, false);
  assert.equal(plan.intent.limit_price, 148);
  assert.equal(plan.risk_bracket.reward_to_risk, 2.333);
  assert(plan.risk_bracket.target_pnl_usdc > 0);
  assert(plan.risk_bracket.stop_pnl_usdc < 0);
});

test("marketable limit is depth checked only through the limit price", () => {
  const plan = createHyperliquidOrderPlan(fixture({
    order_type: "limit",
    limit_price: 150.15,
    time_in_force: "ioc",
  }), { now: NOW });
  assert.equal(plan.ok, true);
  assert.equal(plan.entry_model.state, "currently_marketable_limit");
  assert.equal(plan.fill_estimate.visible_levels_consumed, 1);

  const tooLarge = createHyperliquidOrderPlan(fixture({
    order_type: "limit",
    limit_price: 150.15,
    time_in_force: "ioc",
    notional_usdc: 10_000,
  }), { now: NOW });
  assert.equal(tooLarge.ok, false);
  assert.equal(tooLarge.unavailable_reason, "insufficient_depth_inside_limit");
});

test("post-only and IOC semantics fail closed against the current book", () => {
  const crossingPostOnly = createHyperliquidOrderPlan(fixture({
    order_type: "limit",
    limit_price: 151,
    time_in_force: "alo",
  }), { now: NOW });
  assert.equal(crossingPostOnly.ok, false);
  assert.equal(crossingPostOnly.unavailable_reason, "post_only_would_cross");

  const restingIoc = createHyperliquidOrderPlan(fixture({
    order_type: "limit",
    limit_price: 149,
    time_in_force: "ioc",
  }), { now: NOW });
  assert.equal(restingIoc.ok, false);
  assert.equal(restingIoc.unavailable_reason, "ioc_not_marketable");
});

test("trigger entries and brackets enforce directional semantics", () => {
  const valid = createHyperliquidOrderPlan(fixture({
    order_type: "trigger",
    trigger_price: 152,
    take_profit_price: 160,
    stop_loss_price: 148,
  }), { now: NOW });
  assert.equal(valid.ok, true);
  assert.equal(valid.entry_model.state, "conditional_stop_entry");
  assert.equal(valid.entry_model.future_fill_price_estimated, false);
  assert.equal("fill_estimate" in valid, false);

  const wrongTrigger = createHyperliquidOrderPlan(fixture({
    order_type: "trigger",
    trigger_price: 148,
  }), { now: NOW });
  assert.equal(wrongTrigger.ok, false);
  assert.equal(wrongTrigger.unavailable_reason, "trigger_side_mismatch");

  const wrongStop = createHyperliquidOrderPlan(fixture({
    order_type: "limit",
    limit_price: 149,
    stop_loss_price: 151,
  }), { now: NOW });
  assert.equal(wrongStop.ok, false);
  assert.equal(wrongStop.unavailable_reason, "stop_loss_side_mismatch");
});
