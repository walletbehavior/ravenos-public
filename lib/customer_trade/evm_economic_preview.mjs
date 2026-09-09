import { resolveEvmChainProfile } from "./evm_chain_profiles.mjs";
import { MIN_SPOT_SLIPPAGE_BPS, MAX_SPOT_SLIPPAGE_BPS } from "../../ravenos-spot-trade-policy.js";

const address = value => /^0x[0-9a-f]{40}$/.test(String(value || ""));
const positiveUnits = value => /^[1-9][0-9]{0,77}$/.test(String(value || "")) && BigInt(value) < 2n ** 256n;
const readinessBlockers = new Set(["allowance_required", "insufficient_balance", "simulation_incomplete"]);

// The provider quote has already passed exact-token, recipient, fee and route
// validation. Expose only its economics when wallet readiness prevents a ticket.
// This object contains no signing material and never grants spending authority.
export function evmEconomicPreview(quote, { profile: selector, token, side, instrument_id, pool_address, slippage_bps, price_impact = null } = {}) {
  const profile = resolveEvmChainProfile(selector);
  const binding = quote?.exact_binding;
  if (quote?.ok !== true || quote.chain_id !== profile.chain_id || !binding
    || !new Set(["buy", "sell"]).has(side) || !address(pool_address)
    || instrument_id !== `${profile.exact_market_prefix}${pool_address}`
    || !address(binding.taker) || binding.taker !== binding.recipient
    || !address(token?.token_address) || !Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 18
    || !Number.isInteger(slippage_bps) || slippage_bps < MIN_SPOT_SLIPPAGE_BPS || slippage_bps > MAX_SPOT_SLIPPAGE_BPS
    || ![binding.sell_amount_base_units, binding.buy_amount_base_units, binding.minimum_buy_amount_base_units].every(positiveUnits)
    || BigInt(binding.minimum_buy_amount_base_units) > BigInt(binding.buy_amount_base_units)
    || quote.fee?.enabled !== true || quote.fee.fee_bps !== 100
    || !Array.isArray(quote.blockers) || quote.blockers.some(code => !readinessBlockers.has(code))
    || !Number.isFinite(Date.parse(quote.expires_at)) || !Number.isFinite(Date.parse(quote.observed_at))) return null;
  if (side === "buy" ? binding.buy_token !== token.token_address || ![profile.native_token_address, profile.accounting_asset.address].includes(binding.sell_token)
    : binding.sell_token !== token.token_address || binding.buy_token !== profile.accounting_asset.address) return null;
  return Object.freeze({
    schema_version: "ravenos.evm_economic_preview.v1",
    profile_id: profile.profile_id, chain_id: profile.chain_id, chain: profile.chain_namespace,
    wallet_address: binding.taker, instrument_id, pool_address, token_address: token.token_address, side,
    input_token: binding.sell_token, input_amount_base_units: binding.sell_amount_base_units,
    input_decimals: side === "sell" ? token.decimals : binding.sell_token === profile.native_token_address ? 18 : profile.accounting_asset.decimals,
    input_balance_base_units: side === "sell" ? token.balance_base_units : null,
    output_token: binding.buy_token, output_decimals: side === "buy" ? token.decimals : profile.accounting_asset.decimals,
    expected_output_base_units: binding.buy_amount_base_units, minimum_output_base_units: binding.minimum_buy_amount_base_units,
    slippage_bps, price_impact,
    fee_bps: quote.fee.fee_bps, fee_amount_base_units: quote.fee.amount, fee_token: quote.fee.token,
    network_fee_native_base_units: quote.total_network_fee_native_base_units,
    route_venues: [...new Set((quote.route?.fills || []).map(row => row.source))],
    quote_id: quote.provider_quote_id, observed_at: quote.observed_at, expires_at: quote.expires_at,
    funding_blockers: [...quote.blockers], exit_verified: false,
    execution_ready: false, transaction_material_available: false,
  });
}

export function evmPreparationErrorStatus(code) {
  return /(?:invalid|mismatch|restricted|blocked|required|out_of_bounds|not_supported)$/.test(code)
    || /^insufficient_/.test(code)
    || ["simulation_incomplete", "invalid_liquidity_sources"].includes(code) ? 409 : 503;
}
