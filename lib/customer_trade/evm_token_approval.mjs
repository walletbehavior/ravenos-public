import { EVM_ZERO_X_ALLOWANCE_HOLDER, resolveEvmChainProfile } from "./evm_chain_profiles.mjs";

// A quote can provide an estimate before allowance exists. This descriptor
// permits only an exact-amount AllowanceHolder approval after an explicit Buy.
// It is not a trade ticket and cannot be passed to the execution endpoint.
export function evmTokenApprovalContext(quote, { profile: selector, token, side, instrument_id, pool_address } = {}) {
  const profile = resolveEvmChainProfile(selector);
  const binding = quote?.exact_binding;
  const allowance = quote?.allowance;
  const blockers = quote?.blockers || [];
  if (quote?.ok !== true || !binding || allowance?.state !== "approval_required"
    || allowance.spender !== EVM_ZERO_X_ALLOWANCE_HOLDER
    || !blockers.includes("allowance_required")
    || blockers.some(code => !["allowance_required", "simulation_incomplete"].includes(code))) return null;
  if (binding.sell_token === profile.native_token_address || allowance.required_amount_base_units !== binding.sell_amount_base_units) return null;
  if (quote.chain_id !== profile.chain_id || binding.taker !== binding.recipient) return null;
  return Object.freeze({
    schema_version: "ravenos.exact_token_approval.v1",
    profile_id: profile.profile_id, chain_id: profile.chain_id,
    wallet_address: binding.taker, spender: allowance.spender,
    token_address: binding.sell_token, amount_base_units: binding.sell_amount_base_units,
    output_token: binding.buy_token, expected_output_base_units: binding.buy_amount_base_units,
    minimum_output_base_units: binding.minimum_buy_amount_base_units,
    output_decimals: side === "buy" ? token.decimals : profile.accounting_asset.decimals,
    input_decimals: side === "buy" ? profile.accounting_asset.decimals : token.decimals,
    input_balance_base_units: side === "sell" ? token.balance_base_units : null,
    instrument_id, pool_address, side, expires_at: quote.expires_at,
    fee_bps: quote.fee.fee_bps, quote_id: quote.provider_quote_id,
    route_venues: [...new Set((quote.route?.fills || []).map(row => row.source))],
    unlimited: false, trade_submitted: false,
  });
}
