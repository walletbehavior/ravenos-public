import assert from "node:assert/strict";
import test from "node:test";

import {
  customerTradeFeeSchedule,
  defaultFeePolicy,
  feePolicyFor,
} from "../lib/customer_trade/fee_policy.mjs";

test("Free uses each venue maximum and Pro is at least 30 percent lower", () => {
  const schedule = customerTradeFeeSchedule();
  assert.deepEqual(schedule["hyperliquid:perpetual"], {
    provider: "hyperliquid",
    chain: "hyperliquid",
    trade_type: "perpetual",
    fee_kind: "builder_fee",
    free_fee_bps: 10,
    pro_fee_bps: 7,
  });
  assert.equal(schedule["hyperliquid:spot"].free_fee_bps, 100);
  assert.equal(schedule["hyperliquid:spot"].pro_fee_bps, 70);
  assert.equal(schedule["jupiter:spot"].free_fee_bps, 255);
  assert.equal(schedule["jupiter:spot"].pro_fee_bps, 178);
  for (const row of Object.values(schedule)) assert.ok(row.pro_fee_bps <= row.free_fee_bps * 0.7);
});

test("the current preview never charges a fee", () => {
  const policy = feePolicyFor({ provider: "hyperliquid", trade_type: "perpetual", access_tier: "free" });
  assert.equal(policy.configured_fee_bps, 10);
  assert.equal(policy.fee_bps, 0);
  assert.equal(policy.enabled, false);
  assert.match(policy.disclosure_string, /not charged in preview/i);
  assert.equal(defaultFeePolicy().fee_bps, 0);
});

test("only server-selected tier and schedule control the fee", () => {
  const policy = feePolicyFor({
    provider: "jupiter",
    trade_type: "spot",
    access_tier: "pro",
    enabled: true,
    fee_recipient: "11111111111111111111111111111111",
    fee_bps: 1,
    referralFee: 1,
  });
  assert.equal(policy.enabled, true);
  assert.equal(policy.fee_bps, 178);
  assert.equal(policy.fee_parameter_value, 178);
  assert.equal(policy.discount_from_free_pct, 30.2);
  assert.equal(policy.customer_controls.body_or_query_fee_override_allowed, false);
});

test("invalid recipients and undefined commercial tiers fail closed", () => {
  const invalidRecipient = feePolicyFor({
    provider: "hyperliquid",
    trade_type: "perpetual",
    access_tier: "free",
    enabled: true,
    fee_recipient: "not-an-address",
  });
  assert.equal(invalidRecipient.enabled, false);
  assert.equal(invalidRecipient.fee_bps, 0);
  assert.equal(invalidRecipient.unavailable_reason, "fee_recipient_invalid_or_missing");
  const desk = feePolicyFor({ provider: "hyperliquid", trade_type: "perpetual", access_tier: "desk", enabled: true });
  assert.equal(desk.enabled, false);
  assert.equal(desk.unavailable_reason, "unsupported_access_tier");
});
