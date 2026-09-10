import { RAVEN_STANDARD_EXECUTION_FEE_BPS } from "../customer_product.mjs";
import { RAVEN_JUPITER_REFERRAL, ravenJupiterRouteFeeAsset } from "./jupiter_referral.mjs";
import { jupiterQuotedFeeAmount } from "./jupiter_fee_evidence.mjs";

function fail(code) { throw Object.assign(new Error(code), { code }); }

// This is economic quote evidence only. Collection still requires the signed
// instruction, simulation and settled fee-account credit checked by live trading.
export function solanaPreviewFeeEvidence(order, { policy, inputMint, outputMint, amountBaseUnits }) {
  if (!policy?.enabled) return null;
  if (!policy.configuration_ready || policy.fee_recipient !== RAVEN_JUPITER_REFERRAL.account
      || policy.fee_bps !== RAVEN_STANDARD_EXECUTION_FEE_BPS) fail("quote_fee_configuration_invalid");
  if (order.referralAccount !== policy.fee_recipient) fail("quote_fee_recipient_mismatch");
  if (order.router !== "metis") fail("quote_fee_router_unreviewed");
  if (Number(order.feeBps) !== policy.fee_bps || Number(order.platformFee?.feeBps) !== policy.fee_bps) fail("quote_fee_rate_mismatch");
  const asset = ravenJupiterRouteFeeAsset(inputMint, outputMint);
  if (order.feeMint !== asset.mint || (order.platformFee?.feeMint && order.platformFee.feeMint !== asset.mint)) fail("quote_fee_asset_mismatch");
  const amount = jupiterQuotedFeeAmount(order, { referral_account: policy.fee_recipient,
    referral_fee_bps: policy.fee_bps, input_mint: inputMint, amount_base_units: amountBaseUnits });
  if (amount !== null && BigInt(amount) <= 0n) fail("quote_fee_amount_missing");
  return Object.freeze({ included_in_output: true, fee_bps: policy.fee_bps,
    amount_base_units: amount, asset_mint: asset.mint, recipient: policy.fee_recipient });
}
