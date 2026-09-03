import assert from "node:assert/strict";
import test from "node:test";

import {
  BASE_EVM_CHAIN_PROFILE,
  BSC_EVM_CHAIN_PROFILE,
  EVM_NATIVE_TOKEN_ADDRESS,
  EVM_ZERO_X_ALLOWANCE_HOLDER,
  ETHEREUM_EVM_CHAIN_PROFILE,
  ROBINHOOD_EVM_CHAIN_PROFILE,
  evmChainProfileForOrder,
  resolveEvmChainProfile,
} from "../lib/customer_trade/evm_chain_profiles.mjs";
import {
  EVM_ZERO_X_CAPABILITY_SCHEMA,
  EVM_ZERO_X_QUOTE_REQUEST_SCHEMA,
  EVM_ZERO_X_UNSIGNED_QUOTE_SCHEMA,
  assertEvmZeroXQuoteFresh,
  createEvmZeroXQuoteClient,
  createEvmZeroXQuoteRequest,
  normalizeEvmZeroXUnsignedQuote,
  resolveEvmZeroXCapability,
} from "../lib/customer_trade/evm_zero_x_live_execution.mjs";

const NOW = Date.parse("2026-09-04T04:00:00.000Z");
const SELL = "0x1111111111111111111111111111111111111111";
const BUY = "0x2222222222222222222222222222222222222222";
const TAKER = "0x3333333333333333333333333333333333333333";
const COLLECTOR = "0xa31872140ebe5eefb6c4dfad1ff2489d25f1e227";

function envFor(profile, overrides = {}) {
  return {
    [`${profile.environment_prefix}_QUOTE_ENABLE`]: "1",
    [`${profile.environment_prefix}_FEE_ENABLE`]: "1",
    [`${profile.environment_prefix}_FEE_TOKEN_SIDE`]: "sell",
    RAVENOS_EVM_FEE_COLLECTOR_ADDRESS: COLLECTOR,
    RAVENOS_ZEROX_API_KEY: "unit-test-key-not-secret",
    ...overrides,
  };
}

function requestFor(profile, overrides = {}, context = {}) {
  return createEvmZeroXQuoteRequest({
    profile_id: profile.profile_id,
    chain_namespace: profile.chain_namespace,
    chain_id: profile.chain_id,
    canonical_chain_id: profile.canonical_chain_id,
    sell_token: SELL,
    buy_token: BUY,
    sell_amount: "1000000000000000000",
    taker: TAKER,
    slippage_bps: 75,
    ...overrides,
  }, {
    profile,
    access_tier: context.access_tier || "free",
    fee_enabled: context.fee_enabled ?? true,
    fee_recipient: COLLECTOR,
    fee_token_side: context.fee_token_side || "sell",
    now: NOW,
    ttl_ms: 8_000,
  });
}

function payloadFor(request, overrides = {}) {
  const fee = request.fee.enabled ? {
    amount: request.fee.expected_fee_amount_base_units ?? "10000000000000000",
    token: request.fee.fee_token,
    type: "volume",
  } : null;
  return {
    allowanceTarget: EVM_ZERO_X_ALLOWANCE_HOLDER,
    blockNumber: "52000000",
    buyAmount: "500000000000000000",
    buyToken: request.buy_token,
    fees: {
      integratorFee: fee,
      integratorFees: fee ? [fee] : [],
      zeroExFee: null,
      gasFee: null,
    },
    issues: {
      allowance: null,
      balance: null,
      simulationIncomplete: false,
      invalidSourcesPassed: [],
    },
    liquidityAvailable: true,
    minBuyAmount: "490000000000000000",
    mode: "exact-in",
    route: {
      fills: [{ from: request.sell_token, to: request.buy_token, source: "PancakeSwap_V3", proportionBps: 10_000 }],
      tokens: [{ address: request.sell_token, symbol: "SELL" }, { address: request.buy_token, symbol: "BUY" }],
    },
    sellAmount: request.sell_amount_base_units,
    sellToken: request.sell_token,
    tokenMetadata: {
      buyToken: { buyTaxBps: null, sellTaxBps: null, transferTaxBps: null },
      sellToken: { buyTaxBps: null, sellTaxBps: null, transferTaxBps: null },
    },
    totalNetworkFee: "1200000000000",
    zid: `${request.chain_namespace}-provider-quote-001`,
    transaction: {
      to: EVM_ZERO_X_ALLOWANCE_HOLDER,
      data: "0x12345678",
      gas: "210000",
      gasPrice: "1000000000",
      value: request.sell_token === EVM_NATIVE_TOKEN_ADDRESS ? request.sell_amount_base_units : "0",
    },
    ...overrides,
  };
}

test("the exact allowlisted EVM profiles prevent chain and stablecoin collisions", () => {
  assert.equal(resolveEvmChainProfile("robinhood"), ROBINHOOD_EVM_CHAIN_PROFILE);
  assert.equal(resolveEvmChainProfile("eip155:56"), BSC_EVM_CHAIN_PROFILE);
  assert.equal(resolveEvmChainProfile("base"), BASE_EVM_CHAIN_PROFILE);
  assert.equal(resolveEvmChainProfile("eip155:1"), ETHEREUM_EVM_CHAIN_PROFILE);
  assert.equal(BSC_EVM_CHAIN_PROFILE.chain_id, 56);
  assert.equal(BSC_EVM_CHAIN_PROFILE.wallet_chain_id_hex, "0x38");
  assert.equal(BSC_EVM_CHAIN_PROFILE.native_symbol, "BNB");
  assert.equal(BSC_EVM_CHAIN_PROFILE.wrapped_native_token_address, "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c");
  assert.equal(ROBINHOOD_EVM_CHAIN_PROFILE.wrapped_native_token_address, "0x0bd7d308f8e1639fab988df18a8011f41eacad73");
  assert.equal(BSC_EVM_CHAIN_PROFILE.accounting_asset.address, "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d");
  assert.equal(BSC_EVM_CHAIN_PROFILE.accounting_asset.decimals, 18);
  assert.equal(BSC_EVM_CHAIN_PROFILE.accounting_asset.representation, "binance_peg_usdc");
  assert.equal(BSC_EVM_CHAIN_PROFILE.accounting_asset.circle_canonical_usdc, false);
  assert.equal(BASE_EVM_CHAIN_PROFILE.accounting_asset.address, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  assert.equal(BASE_EVM_CHAIN_PROFILE.accounting_asset.decimals, 6);
  assert.equal(BASE_EVM_CHAIN_PROFILE.accounting_asset.circle_canonical_usdc, true);
  assert.equal(ETHEREUM_EVM_CHAIN_PROFILE.accounting_asset.address, "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48");
  assert.equal(ETHEREUM_EVM_CHAIN_PROFILE.accounting_asset.decimals, 6);
  assert.equal(ETHEREUM_EVM_CHAIN_PROFILE.accounting_asset.circle_canonical_usdc, true);
  assert.throws(
    () => evmChainProfileForOrder({ chain_id: 56, canonical_chain_id: "eip155:4663" }),
    /evm_chain_profile_mismatch/,
  );
  assert.throws(() => resolveEvmChainProfile({ profile_id: "attacker-profile" }), /evm_chain_profile_not_supported/);
});

for (const profile of [
  ROBINHOOD_EVM_CHAIN_PROFILE,
  BSC_EVM_CHAIN_PROFILE,
  BASE_EVM_CHAIN_PROFILE,
  ETHEREUM_EVM_CHAIN_PROFILE,
]) {
  test(`${profile.chain_namespace} capability and request are profile-bound with no execution authority`, () => {
    const capability = resolveEvmZeroXCapability(envFor(profile), { profile });
    assert.equal(capability.schema_version, EVM_ZERO_X_CAPABILITY_SCHEMA);
    assert.equal(capability.profile_id, profile.profile_id);
    assert.equal(capability.chain_namespace, profile.chain_namespace);
    assert.equal(capability.chain_id, profile.chain_id);
    assert.equal(capability.canonical_chain_id, profile.canonical_chain_id);
    assert.equal(capability.wallet_chain_id_hex, profile.wallet_chain_id_hex);
    assert.equal(capability.accounting_asset.circle_canonical_usdc, profile.accounting_asset.circle_canonical_usdc);
    assert.equal(capability.quote_review_enabled, true);
    assert.equal(capability.fee_collection_enabled, true);
    assert.equal(capability.execution_boundary.raven_signing, false);
    assert.equal(capability.execution_boundary.transaction_submission, false);
    assert.equal(capability.execution_boundary.broadcasting, false);

    const request = requestFor(profile);
    assert.equal(request.schema_version, EVM_ZERO_X_QUOTE_REQUEST_SCHEMA);
    assert.equal(request.profile_id, profile.profile_id);
    assert.equal(request.chain_namespace, profile.chain_namespace);
    assert.equal(request.provider_parameters.chainId, String(profile.chain_id));
    assert.equal(request.provider_parameters.swapFeeRecipient, COLLECTOR);
    assert.equal(request.provider_parameters.swapFeeBps, "100");
    assert.equal(request.provider_parameters.swapFeeToken, SELL);
  });

  test(`${profile.chain_namespace} firm quote binds exact chain, wallet, route, fee and unsigned transaction`, () => {
    const request = requestFor(profile);
    const quote = normalizeEvmZeroXUnsignedQuote(payloadFor(request), request, { profile, now: NOW + 10 });
    assert.equal(quote.schema_version, EVM_ZERO_X_UNSIGNED_QUOTE_SCHEMA);
    assert.equal(quote.profile_id, profile.profile_id);
    assert.equal(quote.chain_namespace, profile.chain_namespace);
    assert.equal(quote.chain_id, profile.chain_id);
    assert.equal(quote.exact_binding.profile_id, profile.profile_id);
    assert.equal(quote.exact_binding.chain_id, profile.chain_id);
    assert.equal(quote.fee.amount, "10000000000000000");
    assert.equal(quote.fee.recipient, COLLECTOR);
    assert.equal(quote.unsigned_transaction.chain_id, profile.chain_id);
    assert.equal(quote.unsigned_transaction.profile_id, profile.profile_id);
    assert.equal(quote.wallet_handoff_eligible, true);
    assert.equal(assertEvmZeroXQuoteFresh(quote, { profile, now: NOW + 20 }), true);
    assert.throws(
      () => assertEvmZeroXQuoteFresh(quote, {
        profile: profile === BSC_EVM_CHAIN_PROFILE ? ROBINHOOD_EVM_CHAIN_PROFILE : BSC_EVM_CHAIN_PROFILE,
        now: NOW + 20,
      }),
      /evm_chain_profile_mismatch|zero_x_quote_chain_mismatch/,
    );
  });
}

test("native route topology accepts only the profile's verified wrapped-native identity", () => {
  const profile = BSC_EVM_CHAIN_PROFILE;
  const request = requestFor(profile, { sell_token: EVM_NATIVE_TOKEN_ADDRESS });
  const providerRoute = {
    fills: [{
      from: profile.wrapped_native_token_address,
      to: request.buy_token,
      source: "PancakeSwap_V3",
      proportionBps: 10_000,
    }],
    tokens: [
      { address: profile.wrapped_native_token_address, symbol: "WBNB" },
      { address: request.buy_token, symbol: "BUY" },
    ],
  };
  const quote = normalizeEvmZeroXUnsignedQuote(payloadFor(request, { route: providerRoute }), request, {
    profile,
    now: NOW + 10,
  });
  assert.equal(quote.exact_binding.sell_token, EVM_NATIVE_TOKEN_ADDRESS);
  assert.equal(quote.route.tokens[0].address, profile.wrapped_native_token_address);

  assert.throws(
    () => normalizeEvmZeroXUnsignedQuote(payloadFor(request, {
      route: {
        ...providerRoute,
        fills: [{ ...providerRoute.fills[0], from: "0x4444444444444444444444444444444444444444" }],
        tokens: [{ address: "0x4444444444444444444444444444444444444444", symbol: "FAKE" }, providerRoute.tokens[1]],
      },
    }), request, { profile, now: NOW + 10 }),
    /zero_x_route_identity_mismatch/,
  );
});

test("BSC configured client uses only exact 0x AllowanceHolder and keeps the API key out of capability output", async () => {
  const env = envFor(BSC_EVM_CHAIN_PROFILE);
  let observed = null;
  const client = createEvmZeroXQuoteClient(env, {
    profile: BSC_EVM_CHAIN_PROFILE,
    now: () => NOW,
    fetch_impl: async (url, options) => {
      observed = { url: new URL(url), options };
      const request = requestFor(BSC_EVM_CHAIN_PROFILE);
      return new Response(JSON.stringify(payloadFor(request)), { status: 200 });
    },
  });
  const quote = await client.quote({
    chain_id: 56,
    sell_token: SELL,
    buy_token: BUY,
    sell_amount: "1000000000000000000",
    taker: TAKER,
    slippage_bps: 75,
  });
  assert.equal(observed.url.searchParams.get("chainId"), "56");
  assert.equal(observed.url.pathname, "/swap/allowance-holder/quote");
  assert.equal(observed.options.headers["0x-version"], "v2");
  assert.equal(JSON.stringify(client).includes(env.RAVENOS_ZEROX_API_KEY), false);
  assert.equal(quote.chain_namespace, "bsc");
});

test("BSC profile rejects RH environment flags and cross-chain request identity", () => {
  const capability = resolveEvmZeroXCapability(envFor(ROBINHOOD_EVM_CHAIN_PROFILE), { profile: BSC_EVM_CHAIN_PROFILE });
  assert.equal(capability.state, "disabled");
  assert.throws(
    () => createEvmZeroXQuoteRequest({
      chain_id: 4663,
      sell_token: SELL,
      buy_token: BUY,
      sell_amount: "1",
      taker: TAKER,
    }, { profile: BSC_EVM_CHAIN_PROFILE, now: NOW }),
    /evm_chain_profile_mismatch/,
  );
});
