import {createEvmZeroXQuoteRequest, normalizeEvmZeroXUnsignedQuote} from '../../lib/customer_trade/evm_zero_x_live_execution.mjs';
import {createEvmLiveTicket} from '../../lib/customer_trade/evm_live_execution.mjs';
import {EVM_ZERO_X_ALLOWANCE_HOLDER as ROUTER} from '../../lib/customer_trade/evm_chain_profiles.mjs';
const WALLET = '0x3333333333333333333333333333333333333333';
const TOKEN = '0x2222222222222222222222222222222222222222';
const POOL = '0x4444444444444444444444444444444444444444';
const COLLECTOR = '0xa31872140ebe5eefb6c4dfad1ff2489d25f1e227';

function normalizedQuote(profile, {
  sellToken,
  buyToken,
  sellAmount,
  buyAmount,
  minBuyAmount,
  feeEnabled,
  allowance = null,
  balance = null,
  zid,
  feeModel = "legacy",
  now,
}) {
  const request = createEvmZeroXQuoteRequest({
    profile_id: profile.profile_id,
    chain_id: profile.chain_id,
    sell_token: sellToken,
    buy_token: buyToken,
    sell_amount: sellAmount,
    taker: WALLET,
    slippage_bps: 75,
  }, {
    profile,
    access_tier: "free",
    fee_enabled: feeEnabled,
    fee_recipient: COLLECTOR,
    fee_token_side: "sell",
    now: now,
    ttl_ms: 8_000,
  });
  const expectedFee = request.fee.enabled ? request.fee.expected_fee_amount_base_units : null;
  const integratorFee = expectedFee ? { amount: expectedFee, token: request.fee.fee_token, type: "volume" } : null;
  return normalizeEvmZeroXUnsignedQuote({
    allowanceTarget: ROUTER,
    blockNumber: "52130000",
    buyAmount,
    buyToken,
    fees: {
      integratorFee,
      integratorFees: integratorFee ? [integratorFee] : [],
      zeroExFee: null,
      gasFee: null,
    },
    issues: {
      allowance,
      balance,
      simulationIncomplete: false,
      invalidSourcesPassed: [],
    },
    liquidityAvailable: true,
    minBuyAmount,
    mode: "exact-in",
    route: {
      fills: [{ from: sellToken, to: buyToken, source: "0x_route", proportionBps: 10_000 }],
      tokens: [{ address: sellToken, symbol: "SELL" }, { address: buyToken, symbol: "BUY" }],
    },
    sellAmount,
    sellToken,
    tokenMetadata: {
      buyToken: { buyTaxBps: null, sellTaxBps: null, transferTaxBps: null },
      sellToken: { buyTaxBps: null, sellTaxBps: null, transferTaxBps: null },
    },
    totalNetworkFee: "1200000000000",
    zid,
    transaction: {
      to: ROUTER,
      data: "0x12345678",
      gas: "210000",
      ...(feeModel === "legacy" ? {gasPrice: "1000000000"} : {maxFeePerGas: "2000000000", maxPriorityFeePerGas: "1000000000"}),
      value: "0",
    },
  }, request, { profile, now: now + 10 });
}

export function preparedSdkBuy(profile, {feeModel = "legacy", now = Date.now()} = {}) {
  const accounting = profile.accounting_asset;
  const unit = 10n ** BigInt(accounting.decimals);
  const entry = normalizedQuote(profile, {
    sellToken: accounting.address,
    buyToken: TOKEN,
    sellAmount: unit.toString(),
    buyAmount: "500000000000000000",
    minBuyAmount: "490000000000000000",
    feeEnabled: true,
    feeModel, now,
    zid: `${profile.chain_namespace}-entry-provider-quote`,
  });
  const exit = normalizedQuote(profile, {
    sellToken: TOKEN,
    buyToken: accounting.address,
    sellAmount: "500000000000000000",
    buyAmount: ((unit * 97n) / 100n).toString(),
    minBuyAmount: ((unit * 96n) / 100n).toString(),
    feeEnabled: false,
    allowance: { spender: ROUTER, actual: "0" },
    balance: { token: TOKEN, actual: "0", expected: "500000000000000000" },
    feeModel, now,
    zid: `${profile.chain_namespace}-exit-provider-quote`,
  });
  const prepared = createEvmLiveTicket({
    exact_market: {
      instrument_id: `${profile.chain_namespace}:pool:${POOL}`,
      pool_address: POOL,
      token_address: TOKEN,
      quote_address: accounting.address,
      symbol: "TOKEN",
      quote_symbol: accounting.symbol,
      side: "buy",
    },
    entry_quote: entry,
    exit_quote: exit,
    wallet_address: WALLET,
    accounting: {
      asset_address: accounting.address,
      symbol: accounting.symbol,
      decimals: accounting.decimals,
      notional_base_units: unit.toString(),
      maximum_notional_base_units: (unit * 500n).toString(),
    },
  }, { profile, now: now + 20, ttl_ms: 7_000 });
  return {...prepared, quote:entry};
}
