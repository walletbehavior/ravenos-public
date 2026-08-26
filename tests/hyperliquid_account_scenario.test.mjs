import assert from "node:assert/strict";
import test from "node:test";

import { createHyperliquidAccountScenario } from "../lib/customer_trade/hyperliquid_account_scenario.mjs";

const NOW = Date.parse("2026-08-26T12:00:00.000Z");
const ADDRESS = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function plan(overrides = {}) {
  return {
    ok: true,
    state: "order_plan_available",
    plan_id: "hlop_fixture",
    expires_at: "2026-08-26T12:00:10.000Z",
    instrument: {
      instrument_id: "hyperliquid:perp:SOL",
      exact_market_id: "SOL",
      symbol: "SOL-PERP",
      venue: "hyperliquid",
      identity_scope: "exact_instrument",
    },
    intent: {
      side: "long",
      order_type: "market",
      time_in_force: null,
      requested_notional_usdc: 1000,
      leverage: 5,
      planned_base_size: 10,
    },
    entry_model: { state: "current_book_fill_estimate", marketable: true, reference_price: 100 },
    market_reference: { mid_price: 100, best_bid: 99.9, best_ask: 100.1 },
    provenance: { source: "live_l2_book", observed_at: "2026-08-26T11:59:59.500Z" },
    ...overrides,
  };
}

function snapshot({ withdrawable = 1000, position = null } = {}) {
  return {
    ok: true,
    venue: "hyperliquid",
    observed_at: "2026-08-26T11:59:59.600Z",
    account: { address: ADDRESS, ownership_asserted: false },
    summary: {
      account_value_usdc: 5000,
      withdrawable_usdc: withdrawable,
      margin_used_usdc: 400,
      maintenance_margin_usdc: 125,
    },
    positions: position ? [position] : [],
  };
}

const fees = { userCrossRate: "0.00045", userAddRate: "0.00015" };

test("Hyperliquid account scenario models current fees, margin, and projected position without preparing an order", () => {
  const scenario = createHyperliquidAccountScenario({
    address: ADDRESS,
    margin_mode: "cross",
    reduce_only: false,
    plan: plan(),
    snapshot: snapshot(),
    fees,
  }, { now: NOW });

  assert.equal(scenario.ok, true);
  assert.equal(scenario.state, "account_scenario_available");
  assert.equal(scenario.position_effect.effect, "open");
  assert.equal(scenario.position_effect.projected_signed_size, 10);
  assert.equal(scenario.fee_estimate.liquidity_assumption, "taker");
  assert.equal(scenario.fee_estimate.estimated_entry_fee_usdc, 0.45);
  assert.equal(scenario.margin_check.estimated_incremental_margin_usdc, 200);
  assert.equal(scenario.margin_check.state, "passes_current_snapshot");
  assert.equal(scenario.review.immutable_binding_hash.length, 64);
  assert.equal(scenario.execution_boundary.prepared_order_available, false);
  assert.equal(scenario.execution_boundary.signing_available, false);
  assert.equal(scenario.execution_boundary.submission_available, false);
});

test("reduce-only account scenario accepts a close and requires no incremental opening margin", () => {
  const current = {
    market: "SOL",
    side: "long",
    signed_size: 10,
    size: 10,
    mark_notional_usdc: 1000,
    leverage: 5,
    leverage_mode: "cross",
    liquidation_price: 72,
  };
  const closePlan = plan({ intent: { ...plan().intent, side: "short" } });
  const scenario = createHyperliquidAccountScenario({
    address: ADDRESS,
    margin_mode: "cross",
    reduce_only: true,
    plan: closePlan,
    snapshot: snapshot({ position: current }),
    fees,
  }, { now: NOW });

  assert.equal(scenario.ok, true);
  assert.equal(scenario.position_effect.effect, "close");
  assert.equal(scenario.position_effect.projected_side, "flat");
  assert.equal(scenario.margin_check.estimated_incremental_margin_usdc, 0);
  assert.equal(scenario.venue_settings.settings_change_required, false);
});

test("reduce-only account scenario fails closed when the order would increase or flip exposure", () => {
  const current = {
    market: "SOL",
    side: "long",
    signed_size: 5,
    size: 5,
    mark_notional_usdc: 500,
    leverage: 5,
    leverage_mode: "cross",
  };
  const wrongSide = createHyperliquidAccountScenario({
    address: ADDRESS,
    margin_mode: "cross",
    reduce_only: true,
    plan: plan(),
    snapshot: snapshot({ position: current }),
    fees,
  }, { now: NOW });
  assert.equal(wrongSide.ok, false);
  assert.equal(wrongSide.unavailable_reason, "reduce_only_would_not_reduce_position");
});

test("account scenario exposes insufficient current withdrawable collateral as a blocker", () => {
  const scenario = createHyperliquidAccountScenario({
    address: ADDRESS,
    margin_mode: "isolated",
    reduce_only: false,
    plan: plan(),
    snapshot: snapshot({ withdrawable: 50 }),
    fees,
  }, { now: NOW });
  assert.equal(scenario.ok, true);
  assert.equal(scenario.state, "account_scenario_blocked");
  assert.equal(scenario.margin_check.state, "insufficient_current_withdrawable");
  assert.deepEqual(scenario.review.blockers, ["insufficient_current_withdrawable"]);
});

test("account scenario identifies a required Hyperliquid leverage or margin-mode change", () => {
  const current = {
    market: "SOL",
    side: "long",
    signed_size: 2,
    size: 2,
    mark_notional_usdc: 200,
    leverage: 3,
    leverage_mode: "cross",
  };
  const changedPlan = plan({ intent: { ...plan().intent, leverage: 10 } });
  const scenario = createHyperliquidAccountScenario({
    address: ADDRESS,
    margin_mode: "isolated",
    reduce_only: false,
    plan: changedPlan,
    snapshot: snapshot({ position: current }),
    fees,
  }, { now: NOW });
  assert.equal(scenario.ok, true);
  assert.equal(scenario.venue_settings.settings_change_required, true);
  assert.ok(scenario.review.blockers.includes("venue_margin_settings_change_required"));
});
