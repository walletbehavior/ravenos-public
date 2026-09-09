import assert from "node:assert/strict";
import test from "node:test";
import { evmEconomicPreview, evmPreparationErrorStatus } from "../lib/customer_trade/evm_economic_preview.mjs";
import { EVM_CHAIN_PROFILES } from "../lib/customer_trade/evm_chain_profiles.mjs";

const WALLET = "0x3333333333333333333333333333333333333333";
const TOKEN = "0x1111111111111111111111111111111111111111";
const POOL = "0x2222222222222222222222222222222222222222";
function fixture(chain, native = false) {
  const profile = EVM_CHAIN_PROFILES[chain];
  const sellToken = native ? profile.native_token_address : profile.accounting_asset.address;
  const quote = {
    ok: true, chain_id: profile.chain_id,
    exact_binding: { taker: WALLET, recipient: WALLET, sell_token: sellToken, buy_token: TOKEN,
      sell_amount_base_units: native ? "2000000000000000" : (25n * 10n ** BigInt(profile.accounting_asset.decimals)).toString(),
      buy_amount_base_units: "90071992547409931234", minimum_buy_amount_base_units: "89171272621935831921" },
    fee: { enabled: true, fee_bps: 100, amount: "20000000000000", token: sellToken },
    blockers: ["insufficient_balance", "simulation_incomplete"],
    total_network_fee_native_base_units: "10000000000000", observed_at: "2026-09-09T23:00:00.000Z", expires_at: "2026-09-09T23:00:08.000Z",
    route: { fills: [{ source: "Uniswap" }] }, provider_quote_id: "fixture-price",
    unsigned_transaction: { data: "secret-calldata", to: "never-delivered" }, provider_payload: { credential: "must-not-leak" },
  };
  const context = { profile, token: { token_address: TOKEN, decimals: 18 }, side: "buy", instrument_id: `${chain}:pool:${POOL}`, pool_address: POOL, slippage_bps: 300 };
  return { quote, context };
}
for (const chain of Object.keys(EVM_CHAIN_PROFILES)) for (const native of [false, true]) test(`${chain} ${native ? "native" : "accounting"} unfunded estimate retains precise net output without a ticket`, () => {
  const { quote, context } = fixture(chain, native);
  const preview = evmEconomicPreview(quote, context);
  assert.equal(preview.minimum_output_base_units, quote.exact_binding.minimum_buy_amount_base_units);
  assert.equal(preview.input_decimals, native ? 18 : EVM_CHAIN_PROFILES[chain].accounting_asset.decimals);
  assert.equal(preview.execution_ready, false);
  assert.equal(preview.exit_verified, false);
  assert.equal(preview.transaction_material_available, false);
  assert.equal(preview.fee_bps, 100);
  assert.equal(preview.network_fee_native_base_units, "10000000000000");
  assert.equal(/secret-calldata|must-not-leak|unsigned_transaction|ticket_id/.test(JSON.stringify(preview)), false);
});
test("sell estimates use the actual token balance and selected chain accounting asset", () => {
  const { quote, context } = fixture("base");
  context.side = "sell"; context.token.balance_base_units = "1000";
  Object.assign(quote.exact_binding, { sell_token: TOKEN, buy_token: EVM_CHAIN_PROFILES.base.accounting_asset.address });
  const preview = evmEconomicPreview(quote, context);
  assert.equal(preview.input_balance_base_units, "1000"); assert.equal(preview.output_decimals, 6);
});
test("unknown routes, wrong identities and missing trading fee do not produce an estimate", () => {
  const mutations = [
    (q) => q.ok = false, (q) => q.chain_id = 1,
    (q) => q.exact_binding.recipient = TOKEN,
    (q) => q.exact_binding.buy_token = POOL,
    (q) => q.exact_binding.sell_token = TOKEN,
    (q) => q.exact_binding.buy_amount_base_units = "2",
    (q) => q.exact_binding.buy_amount_base_units = (2n ** 256n).toString(),
    (q) => q.blockers.push("invalid_liquidity_sources"),
    (q) => q.blockers.push("unknown"), (q) => q.fee.enabled = false,
    (q) => q.fee.fee_bps = 0, (q) => q.expires_at = "invalid",
  ];
  for (const mutate of mutations) { const { quote, context } = fixture("base"); mutate(quote); assert.equal(evmEconomicPreview(quote, context), null); }
  const { quote, context } = fixture("base");
  assert.equal(evmEconomicPreview(quote, { ...context, instrument_id: `ethereum:pool:${POOL}` }), null);
});
test("funding and gas are readiness conflicts, not server outages", () => {
  for (const code of ["insufficient_balance", "insufficient_native_gas_balance", "allowance_required", "simulation_incomplete", "exact_market_identity_mismatch"]) assert.equal(evmPreparationErrorStatus(code), 409);
  for (const code of ["zero_x_quote_http_error", "zero_x_quote_timeout", "base_rpc_unavailable"]) assert.equal(evmPreparationErrorStatus(code), 503);
});
