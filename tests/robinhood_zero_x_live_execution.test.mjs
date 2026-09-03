import assert from "node:assert/strict";
import test from "node:test";

import {
  ROBINHOOD_ZERO_X_CANONICAL_CHAIN_ID,
  ROBINHOOD_ZERO_X_CHAIN_ID,
  ROBINHOOD_ZERO_X_ALLOWANCE_HOLDER,
  RobinhoodZeroXExecutionAuthorization,
  RobinhoodZeroXFeeSchedule,
  assertRobinhoodZeroXQuoteFresh,
  createRobinhoodZeroXQuoteClient,
  createRobinhoodZeroXQuoteRequest,
  normalizeRobinhoodZeroXUnsignedQuote,
  resolveRobinhoodZeroXCapability,
} from "../lib/customer_trade/robinhood_zero_x_live_execution.mjs";

const NOW = Date.parse("2026-09-03T16:00:00.000Z");
const SELL = "0x1111111111111111111111111111111111111111";
const BUY = "0x2222222222222222222222222222222222222222";
const TAKER = "0x3333333333333333333333333333333333333333";
const COLLECTOR = "0x4444444444444444444444444444444444444444";
const ALLOWANCE_HOLDER = ROBINHOOD_ZERO_X_ALLOWANCE_HOLDER;
const SETTLER = "0x6666666666666666666666666666666666666666";
const NATIVE_ETH = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

function configuredEnv(overrides = {}) {
  return {
    RAVENOS_ROBINHOOD_ZEROX_QUOTE_ENABLE: "1",
    RAVENOS_ROBINHOOD_ZEROX_QUOTE_ENDPOINT: "https://api.0x.org/swap/allowance-holder/quote",
    RAVENOS_ZEROX_API_KEY: "test-api-key-not-a-production-secret",
    RAVENOS_ROBINHOOD_ZEROX_FEE_ENABLE: "1",
    RAVENOS_ROBINHOOD_ZEROX_FEE_TOKEN_SIDE: "sell",
    RAVENOS_ROBINHOOD_ZEROX_FEE_RECIPIENT: COLLECTOR,
    ...overrides,
  };
}

function order(overrides = {}) {
  return {
    chain_id: ROBINHOOD_ZERO_X_CHAIN_ID,
    sell_token: SELL,
    buy_token: BUY,
    sell_amount: "1000000",
    taker: TAKER,
    slippage_bps: 75,
    ...overrides,
  };
}

function request(overrides = {}, context = {}) {
  return createRobinhoodZeroXQuoteRequest(order(overrides), {
    access_tier: context.access_tier || "free",
    fee_enabled: context.fee_enabled ?? true,
    fee_recipient: COLLECTOR,
    fee_token_side: context.fee_token_side || "sell",
    now: NOW,
    ttl_ms: 8_000,
  });
}

function quotePayload(expectedRequest = request(), overrides = {}) {
  const fee = expectedRequest.fee.enabled ? {
    amount: expectedRequest.fee.expected_fee_amount_base_units ?? "501",
    token: expectedRequest.fee.fee_token,
    type: "volume",
  } : null;
  return {
    allowanceTarget: ALLOWANCE_HOLDER,
    blockNumber: "9123456",
    buyAmount: "505000",
    buyToken: expectedRequest.buy_token,
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
    minBuyAmount: "501000",
    mode: "exact-in",
    route: {
      fills: [{ from: expectedRequest.sell_token, to: expectedRequest.buy_token, source: "RobinSwap_V3", proportionBps: 10_000 }],
      tokens: [{ address: expectedRequest.sell_token, symbol: "USDG" }, { address: expectedRequest.buy_token, symbol: "TOKEN" }],
    },
    sellAmount: expectedRequest.sell_amount_base_units,
    sellToken: expectedRequest.sell_token,
    tokenMetadata: {
      buyToken: { buyTaxBps: null, sellTaxBps: null, transferTaxBps: null },
      sellToken: { buyTaxBps: null, sellTaxBps: null, transferTaxBps: null },
    },
    totalNetworkFee: "1200000000000",
    zid: "0xabcdefabcdefabcdefabcdef",
    transaction: {
      to: ALLOWANCE_HOLDER,
      data: "0x12345678",
      gas: "210000",
      gasPrice: "1000000000",
      value: "0",
    },
    ...overrides,
  };
}

test("capability separates quote availability from explicit fee enablement", () => {
  const disabled = resolveRobinhoodZeroXCapability({});
  assert.equal(disabled.chain_id, 4663);
  assert.equal(disabled.canonical_chain_id, "eip155:4663");
  assert.equal(disabled.state, "disabled");
  assert.equal(disabled.quote_review_enabled, false);
  assert.equal(disabled.live_execution_enabled, false);
  assert.equal(disabled.execution_boundary.raven_signing, false);
  assert.equal(disabled.execution_boundary.transaction_submission, false);
  assert.equal(disabled.execution_boundary.broadcasting, false);
  assert.equal(disabled.execution_boundary.custody, false);

  const missingCollector = resolveRobinhoodZeroXCapability(configuredEnv({ RAVENOS_ROBINHOOD_ZEROX_FEE_RECIPIENT: "" }));
  assert.equal(missingCollector.state, "quote_review_available");
  assert.equal(missingCollector.quote_review_enabled, true);
  assert.equal(missingCollector.fee_state, "misconfigured");
  assert(missingCollector.fee_unavailable_reasons.includes("zero_x_fee_recipient_missing_or_invalid"));

  const feeDisabled = resolveRobinhoodZeroXCapability(configuredEnv({
    RAVENOS_ROBINHOOD_ZEROX_FEE_ENABLE: "0",
    RAVENOS_ROBINHOOD_ZEROX_FEE_RECIPIENT: "",
  }));
  assert.equal(feeDisabled.state, "quote_review_available");
  assert.equal(feeDisabled.fee_state, "disabled");
  assert.equal(feeDisabled.fee_collection_enabled, false);
  assert.deepEqual(feeDisabled.fee_unavailable_reasons, []);
});

test("only the official 0x origin and exact AllowanceHolder quote path are accepted", () => {
  const alternateHost = resolveRobinhoodZeroXCapability(configuredEnv({
    RAVENOS_ROBINHOOD_ZEROX_QUOTE_ENDPOINT: "https://example.com/swap/allowance-holder/quote",
  }));
  assert.equal(alternateHost.state, "misconfigured");
  assert(alternateHost.unavailable_reasons.includes("zero_x_endpoint_invalid"));

  const alternatePath = resolveRobinhoodZeroXCapability(configuredEnv({
    RAVENOS_ROBINHOOD_ZEROX_QUOTE_ENDPOINT: "https://api.0x.org/swap/permit2/quote",
  }));
  assert.equal(alternatePath.state, "misconfigured");
  assert(alternatePath.unavailable_reasons.includes("zero_x_endpoint_invalid"));
  assert.equal(ROBINHOOD_ZERO_X_ALLOWANCE_HOLDER, "0x0000000000001ff3684f28c67538d4d072c22734");
});

test("quote request binds chain, taker, recipient, exact tokens, fee tier, and 0x v2 parameters", () => {
  const free = request();
  assert.equal(free.chain_id, 4663);
  assert.equal(free.canonical_chain_id, ROBINHOOD_ZERO_X_CANONICAL_CHAIN_ID);
  assert.equal(free.taker, TAKER);
  assert.equal(free.recipient, TAKER);
  assert.equal(free.fee.fee_bps, 100);
  assert.equal(free.fee.fee_token, SELL);
  assert.equal(free.fee.fee_recipient, COLLECTOR);
  assert.equal(free.fee.expected_fee_amount_base_units, "10000");
  assert.deepEqual(free.provider_parameters, {
    chainId: "4663",
    sellToken: SELL,
    buyToken: BUY,
    sellAmount: "1000000",
    taker: TAKER,
    recipient: TAKER,
    slippageBps: "75",
    swapFeeRecipient: COLLECTOR,
    swapFeeBps: "100",
    swapFeeToken: SELL,
  });

  const pro = request({}, { access_tier: "pro" });
  assert.equal(pro.fee.fee_bps, 70);
  assert.equal(pro.fee.expected_fee_amount_base_units, "7000");
  assert.deepEqual(RobinhoodZeroXFeeSchedule, { free: 100, pro: 70 });
});

test("configured client requests an exact fee-bound firm quote without exposing its API key", async () => {
  let providerRequest = null;
  const client = createRobinhoodZeroXQuoteClient(configuredEnv(), {
    now: () => NOW,
    fetch_impl: async (url, options) => {
      providerRequest = { url: new URL(url), options };
      const expected = request();
      return new Response(JSON.stringify(quotePayload(expected)), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const quote = await client.quote(order(), { entitlement_tier: "free" });

  assert.equal(client.capability.state, "quote_review_available");
  assert.equal(JSON.stringify(client).includes("test-api-key"), false);
  assert.equal(providerRequest.url.origin, "https://api.0x.org");
  assert.equal(providerRequest.url.pathname, "/swap/allowance-holder/quote");
  assert.equal(providerRequest.url.searchParams.get("chainId"), "4663");
  assert.equal(providerRequest.url.searchParams.get("taker"), TAKER);
  assert.equal(providerRequest.url.searchParams.get("recipient"), TAKER);
  assert.equal(providerRequest.url.searchParams.get("swapFeeRecipient"), COLLECTOR);
  assert.equal(providerRequest.url.searchParams.get("swapFeeBps"), "100");
  assert.equal(providerRequest.url.searchParams.get("swapFeeToken"), SELL);
  assert.equal(providerRequest.options.headers["0x-version"], "v2");
  assert.equal(providerRequest.options.headers["0x-api-key"], configuredEnv().RAVENOS_ZEROX_API_KEY);

  assert.equal(quote.state, "awaiting_wallet_signature");
  assert.equal(quote.wallet_handoff_eligible, true);
  assert.equal(quote.exact_binding.taker, TAKER);
  assert.equal(quote.exact_binding.recipient, TAKER);
  assert.equal(quote.fee.amount, "10000");
  assert.equal(quote.fee.recipient, COLLECTOR);
  assert.equal(quote.reviewed_transaction_hash.length, 64);
  assert.equal(quote.unsigned_transaction.from, TAKER);
  assert.equal(quote.unsigned_transaction.to, ALLOWANCE_HOLDER);
  assert.equal(quote.unsigned_transaction.unsigned, true);
  assert.equal(quote.execution_boundary.transaction_submission, false);
  assert.equal(quote.execution_boundary.broadcasting, false);
  assert.equal(quote.execution_boundary.raven_signing, false);
});

test("quote review works at explicit 0 bps with no fee parameters or unavailable-fee fiction", async () => {
  let providerRequest = null;
  const env = configuredEnv({
    RAVENOS_ROBINHOOD_ZEROX_FEE_ENABLE: "0",
    RAVENOS_ROBINHOOD_ZEROX_FEE_RECIPIENT: "",
  });
  const client = createRobinhoodZeroXQuoteClient(env, {
    now: () => NOW,
    fetch_impl: async (url) => {
      providerRequest = new URL(url);
      const expected = request({}, { fee_enabled: false });
      return new Response(JSON.stringify(quotePayload(expected)));
    },
  });
  const quote = await client.quote(order(), { entitlement_tier: "free" });

  assert.equal(client.capability.state, "quote_review_available");
  assert.equal(client.capability.fee_state, "disabled");
  assert.equal(providerRequest.searchParams.has("swapFeeRecipient"), false);
  assert.equal(providerRequest.searchParams.has("swapFeeBps"), false);
  assert.equal(providerRequest.searchParams.has("swapFeeToken"), false);
  assert.equal(quote.fee.enabled, false);
  assert.equal(quote.fee.state, "disabled");
  assert.equal(quote.fee.amount, "0");
  assert.equal(quote.fee.fee_bps, 0);
  assert.equal(quote.fee.collection_state, "disabled");
  assert.equal(quote.fee.expected_not_collected, false);
  assert.equal(quote.execution_boundary.integrator_fee_bound, false);
  assert.equal(assertRobinhoodZeroXQuoteFresh(quote, { now: NOW }), true);
});

test("requested but invalid fee configuration fails before provider access without disabling quote capability", async () => {
  let calls = 0;
  const client = createRobinhoodZeroXQuoteClient(configuredEnv({ RAVENOS_ROBINHOOD_ZEROX_FEE_RECIPIENT: "" }), {
    now: () => NOW,
    fetch_impl: async () => { calls += 1; },
  });
  assert.equal(client.capability.quote_review_enabled, true);
  assert.equal(client.capability.fee_state, "misconfigured");
  await assert.rejects(client.quote(order()), /zero_x_fee_recipient_missing_or_invalid/);
  assert.equal(calls, 0);
});

test("Pro entitlement selects exactly 70 bps and rejects caller fee overrides", async () => {
  let feeBps = null;
  const client = createRobinhoodZeroXQuoteClient(configuredEnv(), {
    now: () => NOW,
    fetch_impl: async (url) => {
      feeBps = new URL(url).searchParams.get("swapFeeBps");
      const expected = request({}, { access_tier: "pro" });
      return new Response(JSON.stringify(quotePayload(expected)));
    },
  });
  const quote = await client.quote(order(), { entitlement_tier: "pro" });
  assert.equal(feeBps, "70");
  assert.equal(quote.fee.fee_bps, 70);
  assert.equal(quote.fee.amount, "7000");

  await assert.rejects(client.quote(order({ swapFeeBps: 1 }), { entitlement_tier: "pro" }), /zero_x_order_field_forbidden:swapFeeBps/);
  await assert.rejects(client.quote(order({ fee_token_side: "buy" }), { entitlement_tier: "pro" }), /zero_x_order_field_forbidden:fee_token_side/);
  await assert.rejects(client.quote(order(), { entitlement_tier: "enterprise" }), /zero_x_access_tier_invalid/);
});

test("server-selected buy-token fee is bound but provider-quoted rather than derived from sell amount", () => {
  const expected = request({}, { fee_token_side: "buy" });
  assert.equal(expected.fee.fee_token_side, "buy");
  assert.equal(expected.fee.fee_token, BUY);
  assert.equal(expected.fee.expected_fee_amount_base_units, null);
  assert.equal(expected.fee.amount_verification, "provider_quoted_buy_token_amount");
  assert.equal(expected.provider_parameters.swapFeeToken, BUY);

  const quote = normalizeRobinhoodZeroXUnsignedQuote(quotePayload(expected), expected, { now: NOW });
  assert.equal(quote.fee.amount, "501");
  assert.equal(quote.fee.token, BUY);
  assert.equal(quote.fee.fee_bps, 100);
  assert.equal(quote.fee.amount_verification, "provider_quoted_buy_token_amount");
  assert.equal(quote.fee.amount_independently_verified, false);
  assert.equal(assertRobinhoodZeroXQuoteFresh(quote, { now: NOW }), true);
});

test("integrator fee must be present, unique, and exact in amount and token", () => {
  const expected = request();
  assert.throws(() => normalizeRobinhoodZeroXUnsignedQuote(quotePayload(expected, {
    fees: { integratorFee: null, integratorFees: [], zeroExFee: null, gasFee: null },
  }), expected, { now: NOW }), /zero_x_integrator_fee_missing/);

  assert.throws(() => normalizeRobinhoodZeroXUnsignedQuote(quotePayload(expected, {
    fees: { integratorFee: { amount: "9999", token: SELL, type: "volume" }, integratorFees: [], zeroExFee: null, gasFee: null },
  }), expected, { now: NOW }), /zero_x_integrator_fee_mismatch/);

  assert.throws(() => normalizeRobinhoodZeroXUnsignedQuote(quotePayload(expected, {
    fees: { integratorFee: { amount: "10000", token: BUY, type: "volume" }, integratorFees: [], zeroExFee: null, gasFee: null },
  }), expected, { now: NOW }), /zero_x_integrator_fee_mismatch/);

  assert.throws(() => normalizeRobinhoodZeroXUnsignedQuote(quotePayload(expected, {
    fees: { integratorFee: null, integratorFees: [
      { amount: "10000", token: SELL, type: "volume" },
      { amount: "10000", token: SELL, type: "volume" },
    ], zeroExFee: null, gasFee: null },
  }), expected, { now: NOW }), /zero_x_integrator_fee_count_mismatch/);

  const disabled = request({}, { fee_enabled: false });
  const unexpectedFee = { amount: "10000", token: SELL, type: "volume" };
  assert.throws(() => normalizeRobinhoodZeroXUnsignedQuote(quotePayload(disabled, {
    fees: { integratorFee: unexpectedFee, integratorFees: [unexpectedFee], zeroExFee: null, gasFee: null },
  }), disabled, { now: NOW }), /zero_x_integrator_fee_unexpected/);
});

test("response identity, amount, target, transaction value, and minimum output fail closed", () => {
  const expected = request();
  assert.throws(() => normalizeRobinhoodZeroXUnsignedQuote(quotePayload(expected, { buyToken: SELL }), expected, { now: NOW }), /zero_x_quote_identity_mismatch/);
  assert.throws(() => normalizeRobinhoodZeroXUnsignedQuote(quotePayload(expected, { sellAmount: "1000001" }), expected, { now: NOW }), /zero_x_quote_identity_mismatch/);
  assert.throws(() => normalizeRobinhoodZeroXUnsignedQuote(quotePayload(expected, { minBuyAmount: "505001" }), expected, { now: NOW }), /zero_x_minimum_output_invalid/);
  assert.throws(() => normalizeRobinhoodZeroXUnsignedQuote(quotePayload(expected, {
    transaction: { ...quotePayload(expected).transaction, to: SETTLER },
  }), expected, { now: NOW }), /zero_x_transaction_target_mismatch/);
  assert.throws(() => normalizeRobinhoodZeroXUnsignedQuote(quotePayload(expected, {
    allowanceTarget: SETTLER,
    transaction: { ...quotePayload(expected).transaction, to: SETTLER },
  }), expected, { now: NOW }), /zero_x_allowance_target_untrusted/);
  assert.throws(() => normalizeRobinhoodZeroXUnsignedQuote(quotePayload(expected, {
    transaction: { ...quotePayload(expected).transaction, value: "1" },
  }), expected, { now: NOW }), /zero_x_transaction_value_mismatch/);
});

test("allowance metadata is exact and blocks wallet handoff until a fresh post-approval quote", () => {
  const expected = request();
  const payload = quotePayload(expected, {
    issues: {
      allowance: { actual: "100", spender: ALLOWANCE_HOLDER },
      balance: null,
      simulationIncomplete: false,
      invalidSourcesPassed: [],
    },
  });
  const quote = normalizeRobinhoodZeroXUnsignedQuote(payload, expected, { now: NOW });
  assert.equal(quote.state, "allowance_required");
  assert.equal(quote.allowance.state, "approval_required");
  assert.equal(quote.allowance.spender, ALLOWANCE_HOLDER);
  assert.equal(quote.allowance.actual_amount_base_units, "100");
  assert.equal(quote.allowance.required_amount_base_units, "1000000");
  assert.equal(quote.allowance.approval_transaction_included, false);
  assert.equal(quote.wallet_handoff_eligible, false);
  assert.equal(quote.unsigned_transaction, null);

  assert.throws(() => normalizeRobinhoodZeroXUnsignedQuote({
    ...payload,
    issues: { ...payload.issues, allowance: { actual: "100", spender: SETTLER } },
  }, expected, { now: NOW }), /zero_x_allowance_target_mismatch/);
});

test("balance and simulation issues remain explicit blockers instead of permission", () => {
  const expected = request();
  const quote = normalizeRobinhoodZeroXUnsignedQuote(quotePayload(expected, {
    issues: {
      allowance: null,
      balance: { token: SELL, actual: "5", expected: "1000000" },
      simulationIncomplete: true,
      invalidSourcesPassed: [],
    },
  }), expected, { now: NOW });
  assert.equal(quote.state, "blocked");
  assert.deepEqual(quote.blockers, ["insufficient_balance", "simulation_incomplete"]);
  assert.equal(quote.provider_issues.balance.actual_amount_base_units, "5");
  assert.equal(quote.provider_issues.simulation_incomplete, true);
  assert.equal(quote.wallet_handoff_eligible, false);
  assert.equal(quote.unsigned_transaction, null);
});

test("verified native ETH sell-token fee uses no allowance and binds exact value", () => {
  const expected = request({ sell_token: NATIVE_ETH, sell_amount: "1000000" });
  const payload = quotePayload(expected, {
    allowanceTarget: ALLOWANCE_HOLDER,
    transaction: { ...quotePayload(expected).transaction, to: ALLOWANCE_HOLDER, value: "1000000" },
  });
  const quote = normalizeRobinhoodZeroXUnsignedQuote(payload, expected, { now: NOW });
  assert.equal(quote.allowance.state, "not_applicable_native_asset");
  assert.equal(quote.allowance.spender, null);
  assert.equal(quote.fee.token, NATIVE_ETH);
  assert.equal(quote.fee.amount, "10000");
  assert.equal(quote.fee.amount_independently_verified, true);
  assert.equal(quote.unsigned_transaction.to, ALLOWANCE_HOLDER);
  assert.equal(quote.unsigned_transaction.value, "1000000");

  assert.throws(() => request({ buy_token: NATIVE_ETH }, { fee_token_side: "buy" }), /zero_x_native_buy_token_integrator_fee_not_supported/);
});

test("quote lifetime, chain identity, address identity, and authority-bearing input are strict", () => {
  const quote = normalizeRobinhoodZeroXUnsignedQuote(quotePayload(), request(), { now: NOW });
  assert.equal(assertRobinhoodZeroXQuoteFresh(quote, { now: NOW + 7_999 }), true);
  assert.throws(() => assertRobinhoodZeroXQuoteFresh(quote, { now: NOW + 8_000 }), /zero_x_quote_expired/);
  const tamperedQuote = structuredClone(quote);
  tamperedQuote.exact_binding.buy_amount_base_units = "505001";
  assert.throws(() => assertRobinhoodZeroXQuoteFresh(tamperedQuote, { now: NOW }), /zero_x_quote_hash_mismatch/);
  const tamperedTransaction = structuredClone(quote);
  tamperedTransaction.unsigned_transaction.gas = "210001";
  assert.throws(() => assertRobinhoodZeroXQuoteFresh(tamperedTransaction, { now: NOW }), /zero_x_reviewed_transaction_hash_mismatch/);
  const tamperedRequest = structuredClone(request());
  tamperedRequest.provider_parameters.swapFeeBps = "1";
  assert.throws(() => normalizeRobinhoodZeroXUnsignedQuote(quotePayload(), tamperedRequest, { now: NOW }), /zero_x_provider_parameters_mismatch/);
  assert.throws(() => createRobinhoodZeroXQuoteRequest(order({ chain_id: 8453 }), { fee_recipient: COLLECTOR, now: NOW }), /robinhood_zero_x_chain_not_supported/);
  assert.throws(() => createRobinhoodZeroXQuoteRequest(order({ buy_token: `0x${"2".repeat(64)}` }), { fee_recipient: COLLECTOR, now: NOW }), /zero_x_buy_token_invalid/);
  assert.throws(() => createRobinhoodZeroXQuoteRequest(order({ recipient: COLLECTOR }), { fee_recipient: COLLECTOR, now: NOW }), /zero_x_recipient_must_equal_taker/);
  assert.throws(() => createRobinhoodZeroXQuoteRequest(order({ signed_transaction: "0x01" }), { fee_recipient: COLLECTOR, now: NOW }), /zero_x_order_field_forbidden:signed_transaction/);
  assert.throws(() => createRobinhoodZeroXQuoteRequest(order({ sell_amount: "1" }), {
    fee_enabled: true,
    fee_recipient: COLLECTOR,
    now: NOW,
  }), /zero_x_integrator_fee_rounds_to_zero/);
  assert.deepEqual(RobinhoodZeroXExecutionAuthorization, {
    quote_review: true,
    provider_unsigned_transaction_validation: true,
    connected_wallet_signature_required: true,
    raven_signing: false,
    private_key_access: false,
    custody: false,
    approval_transaction_construction: false,
    transaction_submission: false,
    broadcasting: false,
    autonomous_execution: false,
  });
});

test("client has no signing, approval, submission, or broadcast method and refuses disabled use before network access", async () => {
  let calls = 0;
  const client = createRobinhoodZeroXQuoteClient({}, { fetch_impl: async () => { calls += 1; } });
  assert.deepEqual(Object.keys(client), ["capability", "quote"]);
  await assert.rejects(client.quote(order()), /quote_review_disabled/);
  assert.equal(calls, 0);
  assert.equal(Object.keys(client).some((name) => /sign|approve|submit|broadcast|send/i.test(name)), false);
});
