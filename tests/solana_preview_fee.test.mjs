import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { solanaPreviewFeeEvidence } from "../lib/customer_trade/solana_preview_fee.mjs";
import { createSolanaSpotFeeDisclosure } from "../lib/customer_trade/solana_spot_quote_review.mjs";
import { RAVEN_JUPITER_REFERRAL as registry } from "../lib/customer_trade/jupiter_referral.mjs";
import { feePolicyFor } from "../lib/customer_trade/fee_policy.mjs";

const token = "EN2nnxrg8uUi6x2sJkzNPd2eT6rB9rdSoQNNaENA4RZA";
const policy = feePolicyFor({ provider: "jupiter", trade_type: "spot", fee_recipient: registry.account, enabled: true });
const request = { policy, inputMint: registry.sol_mint, outputMint: token, amountBaseUnits: "5000000" };
const order = { referralAccount: registry.account, router: "metis", feeBps: 100, feeMint: registry.sol_mint,
  platformFee: { feeBps: 100 }, outAmount: "990000", otherAmountThreshold: "985050" };

test("fee-inclusive estimates remain free and preserve the prepared minimum protection", () => {
  const estimated = solanaPreviewFeeEvidence(order, request);
  assert.equal(estimated.amount_base_units, "50000");
  const disclosure = createSolanaSpotFeeDisclosure({ configured_enabled: true, configuration_ready: true,
    configured_fee_bps: 100, recipient: registry.account, estimated });
  assert.equal(disclosure.actual.charged, false);
  assert.equal(disclosure.actual.amount_base_units, "0");
  assert.equal(disclosure.estimated.included_in_output, true);
  const source = fs.readFileSync(new URL("../public/ravenos-terminal-live.js", import.meta.url), "utf8");
  const fn = source.match(/function assertPreparedSpotMinimum\(displayed, ticket\) \{[\s\S]*?\n\}/)[0];
  const check = vm.runInNewContext(`(${fn})`);
  const ticket = { reviewed_order: { minimum_output_amount_base_units: order.otherAmountThreshold } };
  assert.throws(() => check({ quote: { minimum_output_amount_base_units: "995000" } }, ticket), /spot_price_moved/);
  check({ quote: { minimum_output_amount_base_units: order.otherAmountThreshold } }, ticket);
  assert.throws(() => check({ quote: { minimum_output_amount_base_units: "985051" } }, ticket), /spot_price_moved/);
});

test("missing or contradictory referral evidence cannot become a fee-inclusive estimate", () => {
  for (const changed of [ {referralAccount: token}, {feeBps: 0}, {platformFee: {feeBps: 0}},
    {feeMint: registry.usdc_mint}, {router: "jupiterz"}, {platformFee: {feeBps: 100, amount: "1"}} ]) {
    assert.throws(() => solanaPreviewFeeEvidence({...order, ...changed}, request));
  }
  assert.throws(() => solanaPreviewFeeEvidence(order, {...request, policy: {...policy, configuration_ready: false}}));
  assert.equal(solanaPreviewFeeEvidence(order, {...request, policy: null}), null);
});

test("output-denominated fee amount stays unknown until provider or simulation supplies it", () => {
  const exit = solanaPreviewFeeEvidence(order, {...request, inputMint: token, outputMint: registry.sol_mint});
  assert.equal(exit.amount_base_units, null);
  assert.equal(exit.asset_mint, registry.sol_mint);
  assert.throws(() => createSolanaSpotFeeDisclosure({ configured_enabled: false, configuration_ready: true,
    configured_fee_bps: 100, recipient: registry.account, estimated: exit }), /estimated_fee_configuration_invalid/);
});
