import assert from "node:assert/strict";
import test from "node:test";

import {
  customerTradeFeeSchedule,
  defaultFeePolicy,
  feePolicyFor,
} from "../lib/customer_trade/fee_policy.mjs";

test("Free uses the reviewed venue schedule and Pro is at least 30 percent lower", () => {
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
  assert.equal(schedule["jupiter:spot"].free_fee_bps, 100);
  assert.equal(schedule["jupiter:spot"].pro_fee_bps, 70);
  assert.deepEqual(schedule["0x:spot"], {
    provider: "0x",
    chain: "evm",
    trade_type: "spot",
    fee_kind: "integrator_fee",
    free_fee_bps: 100,
    pro_fee_bps: 70,
  });
  for (const row of Object.values(schedule)) assert.ok(row.pro_fee_bps <= row.free_fee_bps * 0.7);
});

test("0x EVM spot fees are server-selected and require a nonzero collector", () => {
  const recipient = "0xa31872140ebE5eEfB6c4dfAd1fF2489d25F1E227";
  const free = feePolicyFor({
    provider: "0x",
    trade_type: "spot",
    access_tier: "free",
    enabled: true,
    fee_recipient: recipient,
  });
  assert.equal(free.enabled, true);
  assert.equal(free.fee_bps, 100);
  assert.equal(free.fee_parameter_value, 100);
  assert.equal(free.fee_recipient, recipient);
  const pro = feePolicyFor({
    provider: "0x",
    trade_type: "spot",
    access_tier: "pro",
    enabled: true,
    fee_recipient: recipient,
  });
  assert.equal(pro.enabled, true);
  assert.equal(pro.fee_bps, 70);
  const zero = feePolicyFor({
    provider: "0x",
    trade_type: "spot",
    access_tier: "free",
    enabled: true,
    fee_recipient: "0x0000000000000000000000000000000000000000",
  });
  assert.equal(zero.enabled, false);
  assert.equal(zero.unavailable_reason, "fee_recipient_invalid_or_missing");
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
  assert.equal(policy.fee_bps, 70);
  assert.equal(policy.fee_parameter_value, 70);
  assert.equal(policy.discount_from_free_pct, 30);
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
