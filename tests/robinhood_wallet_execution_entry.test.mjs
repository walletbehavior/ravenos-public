import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  ROBINHOOD_ZERO_X_ALLOWANCE_HOLDER,
  createRobinhoodZeroXQuoteRequest,
  normalizeRobinhoodZeroXUnsignedQuote,
} from "../lib/customer_trade/robinhood_zero_x_live_execution.mjs";
import { createRobinhoodLiveTicket } from "../lib/customer_trade/robinhood_live_execution.mjs";

await import("../client/ravenos-wallet-execution-entry.js");

const { executeEvmZeroXTicket, executeRobinhoodZeroXTicket } = globalThis.RavenOSWalletExecution;
const WALLET = "0x3333333333333333333333333333333333333333";
const OTHER_WALLET = "0x4444444444444444444444444444444444444444";
const SELL_TOKEN = "0x1111111111111111111111111111111111111111";
const BUY_TOKEN = "0x2222222222222222222222222222222222222222";
const TRANSACTION_HASH = `0x${"a".repeat(64)}`;
const NATIVE_ASSET = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const BSC_ACCOUNTING_ASSET = "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d";
const BSC_PROFILE = Object.freeze({
  profile_id: "bsc-mainnet-v1",
  chain_namespace: "bsc",
  chain_id: 56,
  canonical_chain_id: "eip155:56",
});

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonicalize(value[key])]));
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function feeBinding(fee) {
  return {
    enabled: fee.enabled,
    state: fee.state,
    amount: fee.amount,
    token: fee.token,
    type: fee.type,
    recipient: fee.recipient,
    configured_fee_bps: fee.configured_fee_bps,
    fee_bps: fee.fee_bps,
    collection_state: fee.collection_state,
    amount_verification: fee.amount_verification,
    amount_independently_verified: fee.amount_independently_verified,
  };
}

function rebindQuote(quote) {
  quote.reviewed_transaction_hash = digest(quote.unsigned_transaction);
  quote.quote_hash = digest({
    request_hash: quote.request_hash,
    provider_quote_id: quote.provider_quote_id,
    chain_id: quote.chain_id,
    taker: quote.exact_binding.taker,
    sell_token: quote.exact_binding.sell_token,
    buy_token: quote.exact_binding.buy_token,
    sell_amount_base_units: quote.exact_binding.sell_amount_base_units,
    buy_amount_base_units: quote.exact_binding.buy_amount_base_units,
    minimum_buy_amount_base_units: quote.exact_binding.minimum_buy_amount_base_units,
    transaction_hash: quote.reviewed_transaction_hash,
    fee: feeBinding(quote.fee),
    block_number: quote.block_number,
    expires_at: quote.expires_at,
  });
  return quote;
}

function reviewedQuote() {
  const now = Date.now();
  const request = createRobinhoodZeroXQuoteRequest({
    chain_id: 4663,
    sell_token: SELL_TOKEN,
    buy_token: BUY_TOKEN,
    sell_amount: "1000000",
    taker: WALLET,
    slippage_bps: 75,
  }, {
    access_tier: "free",
    fee_enabled: false,
    now,
    ttl_ms: 8_000,
  });
  const quote = normalizeRobinhoodZeroXUnsignedQuote({
    allowanceTarget: ROBINHOOD_ZERO_X_ALLOWANCE_HOLDER,
    blockNumber: "9123456",
    buyAmount: "505000",
    buyToken: BUY_TOKEN,
    fees: { integratorFee: null, integratorFees: [], zeroExFee: null, gasFee: null },
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
      fills: [{ from: SELL_TOKEN, to: BUY_TOKEN, source: "RobinSwap_V3", proportionBps: 10_000 }],
      tokens: [{ address: SELL_TOKEN, symbol: "USDC" }, { address: BUY_TOKEN, symbol: "TOKEN" }],
    },
    sellAmount: "1000000",
    sellToken: SELL_TOKEN,
    tokenMetadata: {
      buyToken: { buyTaxBps: null, sellTaxBps: null, transferTaxBps: null },
      sellToken: { buyTaxBps: null, sellTaxBps: null, transferTaxBps: null },
    },
    totalNetworkFee: "1200000000000",
    zid: "0xabcdefabcdefabcdefabcdef",
    transaction: {
      to: ROBINHOOD_ZERO_X_ALLOWANCE_HOLDER,
      data: "0x12345678",
      gas: "210000",
      gasPrice: "1000000000",
      value: "0",
    },
  }, request, { now: now + 10 });
  return structuredClone(quote);
}

function preparedTicket(quote = reviewedQuote()) {
  const prepared = createRobinhoodLiveTicket({
    exact_market: {
      instrument_id: `robinhood:pool:${"0x4444444444444444444444444444444444444444"}`,
      pool_address: "0x4444444444444444444444444444444444444444",
      token_address: SELL_TOKEN,
      quote_address: BUY_TOKEN,
      symbol: "TOKEN",
      quote_symbol: "USDG",
      side: "sell",
    },
    entry_quote: quote,
    wallet_address: WALLET,
    accounting: {
      asset_address: BUY_TOKEN,
      symbol: "USDG",
      decimals: 6,
      notional_base_units: quote.exact_binding.buy_amount_base_units,
      maximum_notional_base_units: "500000000",
    },
  }, { now: Date.now() + 20, ttl_ms: 7_000 });
  return { ...prepared, quote };
}

function providerMock({
  chainId = "0x1",
  accounts = [WALLET],
  accountSequence = null,
  transactionHash = TRANSACTION_HASH,
  expectedSwitchChainId = "0x1237",
} = {}) {
  let currentChainId = chainId;
  let accountCall = 0;
  const calls = [];
  return {
    calls,
    async request(payload) {
      calls.push(structuredClone(payload));
      if (payload.method === "eth_chainId") return currentChainId;
      if (payload.method === "wallet_switchEthereumChain") {
        assert.deepEqual(payload.params, [{ chainId: expectedSwitchChainId }]);
        currentChainId = expectedSwitchChainId;
        return null;
      }
      if (payload.method === "eth_accounts") {
        const result = accountSequence?.[Math.min(accountCall, accountSequence.length - 1)] ?? accounts;
        accountCall += 1;
        return result;
      }
      if (payload.method === "eth_sendTransaction") return transactionHash;
      throw new Error(`unexpected_method:${payload.method}`);
    },
  };
}

function genericBscPrepared({ nativeSell = false } = {}) {
  const quote = reviewedQuote();
  const oldTicket = preparedTicket(quote).ticket;
  const sellToken = nativeSell ? NATIVE_ASSET : SELL_TOKEN;
  const sellAmount = nativeSell ? "1000000000000000" : "1000000";
  const marketSide = nativeSell ? "buy" : "sell";
  quote.schema_version = "ravenos.evm_zero_x_unsigned_quote.v1";
  Object.assign(quote, BSC_PROFILE);
  quote.exact_binding = {
    ...quote.exact_binding,
    ...BSC_PROFILE,
    sell_token: sellToken,
    buy_token: BUY_TOKEN,
    sell_amount_base_units: sellAmount,
  };
  quote.allowance = nativeSell
    ? {
      state: "not_applicable_native_asset",
      spender: null,
      actual_amount_base_units: null,
      required_amount_base_units: null,
      approval_transaction_included: false,
    }
    : { ...quote.allowance, approval_transaction_included: false };
  quote.unsigned_transaction = {
    ...quote.unsigned_transaction,
    ...BSC_PROFILE,
    chain_id: 56,
    value: nativeSell ? sellAmount : "0",
  };
  quote.reviewed_transaction_hash = digest(quote.unsigned_transaction);
  quote.quote_hash = "b".repeat(64);

  const exactMarket = {
    ...oldTicket.exact_market,
    ...BSC_PROFILE,
    instrument_id: `bsc:pool:${oldTicket.exact_market.pool_address}`,
    token_address: nativeSell ? BUY_TOKEN : SELL_TOKEN,
    quote_address: BUY_TOKEN,
    side: marketSide,
  };
  const accounting = {
    ...oldTicket.accounting,
    asset_address: BSC_ACCOUNTING_ASSET,
    symbol: "USDC",
    decimals: 18,
    representation: "binance_peg_usdc",
    issuer: "Binance-Peg",
    circle_canonical_usdc: false,
  };
  const reviewedOrder = {
    ...oldTicket.reviewed_order,
    side: marketSide,
    sell_token: sellToken,
    buy_token: BUY_TOKEN,
    sell_amount_base_units: sellAmount,
    expected_buy_amount_base_units: quote.exact_binding.buy_amount_base_units,
    minimum_buy_amount_base_units: quote.exact_binding.minimum_buy_amount_base_units,
    accounting_asset_address: accounting.asset_address,
    accounting_asset_symbol: accounting.symbol,
    notional_accounting_base_units: accounting.notional_base_units,
  };
  const ticket = {
    ...oldTicket,
    schema_version: "ravenos.evm_live_ticket.v1",
    ...BSC_PROFILE,
    wallet_chain_id_hex: "0x38",
    native_symbol: "BNB",
    exact_market: exactMarket,
    reviewed_order: reviewedOrder,
    provider: {
      ...oldTicket.provider,
      quote_hash: quote.quote_hash,
      quote_id: quote.provider_quote_id,
      block_number: quote.block_number,
    },
    transaction: {
      ...oldTicket.transaction,
      reviewed_transaction_hash: quote.reviewed_transaction_hash,
      to: quote.unsigned_transaction.to,
      maximum_gas: quote.unsigned_transaction.gas,
      quoted_gas_price: quote.unsigned_transaction.gas_price,
      quoted_maximum_fee_per_gas: null,
      quoted_maximum_priority_fee_per_gas: null,
      value: quote.unsigned_transaction.value,
      input_data_sha256: createHash("sha256").update(quote.unsigned_transaction.data).digest("hex"),
    },
    accounting,
    fee: { ...oldTicket.fee },
    binding_hash: "c".repeat(64),
    execution_boundary: {
      ...oldTicket.execution_boundary,
      submission_path: "wallet_direct_to_evm_chain",
    },
  };
  return { quote, ticket };
}

test("Robinhood handoff switches to exactly 4663 and sends only the reviewed legacy-fee transaction", async () => {
  const prepared = preparedTicket();
  const provider = providerMock();
  const result = await executeRobinhoodZeroXTicket({ ticket: prepared.ticket, quote: prepared.quote, provider, address: WALLET });

  assert.deepEqual(result, {
    ticket_id: prepared.ticket.ticket_id,
    wallet_address: WALLET,
    reviewed_transaction_hash: prepared.ticket.transaction.reviewed_transaction_hash,
    transaction_hash: TRANSACTION_HASH,
  });
  assert.deepEqual(provider.calls.map((call) => call.method), [
    "eth_chainId",
    "wallet_switchEthereumChain",
    "eth_chainId",
    "eth_accounts",
    "eth_accounts",
    "eth_chainId",
    "eth_sendTransaction",
  ]);
  assert.deepEqual(provider.calls.at(-1), {
    method: "eth_sendTransaction",
    params: [{
      from: WALLET,
      to: ROBINHOOD_ZERO_X_ALLOWANCE_HOLDER,
      data: "0x12345678",
      value: "0x0",
      gas: "0x33450",
      gasPrice: "0x3b9aca00",
    }],
  });
});

test("Robinhood handoff preserves only hash-bound EIP-1559 fee fields", async () => {
  const quote = reviewedQuote();
  quote.unsigned_transaction = {
    chain_id: 4663,
    from: WALLET,
    to: ROBINHOOD_ZERO_X_ALLOWANCE_HOLDER,
    data: "0x12345678",
    value: "0",
    gas: "210000",
    max_fee_per_gas: "2000000000",
    max_priority_fee_per_gas: "1000000000",
    unsigned: true,
  };
  rebindQuote(quote);
  const prepared = preparedTicket(quote);
  const provider = providerMock({ chainId: "0x1237" });

  await executeRobinhoodZeroXTicket({ ticket: prepared.ticket, quote, provider, address: WALLET });

  assert.deepEqual(provider.calls.at(-1).params[0], {
    from: WALLET,
    to: ROBINHOOD_ZERO_X_ALLOWANCE_HOLDER,
    data: "0x12345678",
    value: "0x0",
    gas: "0x33450",
    maxFeePerGas: "0x77359400",
    maxPriorityFeePerGas: "0x3b9aca00",
  });
  assert.equal("gasPrice" in provider.calls.at(-1).params[0], false);
});

test("Robinhood handoff rejects changed or extra calldata-bearing transaction material before wallet send", async () => {
  const changedQuote = reviewedQuote();
  const changed = preparedTicket(changedQuote);
  changedQuote.unsigned_transaction.data = "0xdeadbeef";
  const changedProvider = providerMock({ chainId: "0x1237" });
  await assert.rejects(
    executeRobinhoodZeroXTicket({ ticket: changed.ticket, quote: changedQuote, provider: changedProvider, address: WALLET }),
    /robinhood_reviewed_transaction_hash_mismatch/,
  );
  assert.equal(changedProvider.calls.some((call) => call.method === "eth_sendTransaction"), false);

  const extraQuote = reviewedQuote();
  extraQuote.unsigned_transaction.nonce = "1";
  rebindQuote(extraQuote);
  const extra = preparedTicket(extraQuote);
  const extraProvider = providerMock({ chainId: "0x1237" });
  await assert.rejects(
    executeRobinhoodZeroXTicket({ ticket: extra.ticket, quote: extraQuote, provider: extraProvider, address: WALLET }),
    /robinhood_transaction_field_forbidden:nonce/,
  );
  assert.equal(extraProvider.calls.some((call) => call.method === "eth_sendTransaction"), false);
});

test("Robinhood handoff fails closed when account, chain, lifetime, or wallet response changes", async (t) => {
  await t.test("wrong connected account", async () => {
    const prepared = preparedTicket();
    const provider = providerMock({ chainId: "0x1237", accounts: [OTHER_WALLET] });
    await assert.rejects(
      executeRobinhoodZeroXTicket({ ticket: prepared.ticket, quote: prepared.quote, provider, address: WALLET }),
      /wallet_account_identity_mismatch/,
    );
    assert.equal(provider.calls.some((call) => call.method === "eth_sendTransaction"), false);
  });

  await t.test("account changes immediately before send", async () => {
    const prepared = preparedTicket();
    const provider = providerMock({
      chainId: "0x1237",
      accountSequence: [[WALLET], [OTHER_WALLET]],
    });
    await assert.rejects(
      executeRobinhoodZeroXTicket({ ticket: prepared.ticket, quote: prepared.quote, provider, address: WALLET }),
      /wallet_account_identity_mismatch/,
    );
    assert.equal(provider.calls.some((call) => call.method === "eth_sendTransaction"), false);
  });

  await t.test("future-dated ticket cannot extend the wallet handoff window", async () => {
    const quote = reviewedQuote();
    const observed = Date.now() + 60_000;
    quote.observed_at = new Date(observed).toISOString();
    quote.expires_at = new Date(observed + 8_000).toISOString();
    rebindQuote(quote);
    const ticket = preparedTicket();
    const provider = providerMock({ chainId: "0x1237" });
    await assert.rejects(
      executeRobinhoodZeroXTicket({ ticket: ticket.ticket, quote, provider, address: WALLET }),
      /robinhood_ticket_expired/,
    );
    assert.equal(provider.calls.length, 0);
  });

  await t.test("malformed transaction hash", async () => {
    const prepared = preparedTicket();
    const provider = providerMock({ chainId: "0x1237", transactionHash: "0x1234" });
    await assert.rejects(
      executeRobinhoodZeroXTicket({ ticket: prepared.ticket, quote: prepared.quote, provider, address: WALLET }),
      /robinhood_transaction_hash_invalid/,
    );
  });
});

test("generic EVM handoff switches to exactly BSC and submits an exact ERC-20 0x transaction", async () => {
  const prepared = genericBscPrepared();
  const provider = providerMock({ expectedSwitchChainId: "0x38" });
  const result = await executeEvmZeroXTicket({
    profile: "bsc-mainnet-v1",
    ticket: prepared.ticket,
    quote: prepared.quote,
    provider,
    address: WALLET,
  });

  assert.deepEqual(result, {
    ticket_id: prepared.ticket.ticket_id,
    profile_id: "bsc-mainnet-v1",
    chain_namespace: "bsc",
    chain_id: 56,
    wallet_address: WALLET,
    reviewed_transaction_hash: prepared.ticket.transaction.reviewed_transaction_hash,
    transaction_hash: TRANSACTION_HASH,
  });
  assert.deepEqual(provider.calls.map((call) => call.method), [
    "eth_chainId",
    "wallet_switchEthereumChain",
    "eth_chainId",
    "eth_accounts",
    "eth_accounts",
    "eth_chainId",
    "eth_sendTransaction",
  ]);
  assert.deepEqual(provider.calls.at(-1), {
    method: "eth_sendTransaction",
    params: [{
      from: WALLET,
      to: ROBINHOOD_ZERO_X_ALLOWANCE_HOLDER,
      data: "0x12345678",
      value: "0x0",
      gas: "0x33450",
      gasPrice: "0x3b9aca00",
    }],
  });
});

test("generic EVM handoff preserves the exact native BNB value", async () => {
  const prepared = genericBscPrepared({ nativeSell: true });
  const provider = providerMock({ chainId: "0x38", expectedSwitchChainId: "0x38" });
  await executeEvmZeroXTicket({
    profile: "bsc",
    ticket: prepared.ticket,
    quote: prepared.quote,
    provider,
    address: WALLET,
  });

  assert.equal(provider.calls.some((call) => call.method === "wallet_switchEthereumChain"), false);
  assert.equal(provider.calls.at(-1).method, "eth_sendTransaction");
  assert.equal(provider.calls.at(-1).params[0].value, "0x38d7ea4c68000");
});

test("generic EVM handoff rejects cross-profile material, approvals, fee drift, and arbitrary transaction fields", async (t) => {
  await t.test("profile mismatch", async () => {
    const prepared = genericBscPrepared();
    const provider = providerMock({ chainId: "0x38", expectedSwitchChainId: "0x38" });
    await assert.rejects(
      executeEvmZeroXTicket({ profile: "robinhood", ticket: prepared.ticket, quote: prepared.quote, provider, address: WALLET }),
      /evm_quote_profile_mismatch/,
    );
    assert.equal(provider.calls.length, 0);
  });

  await t.test("approval required", async () => {
    const prepared = genericBscPrepared();
    prepared.quote.allowance.state = "approval_required";
    const provider = providerMock({ chainId: "0x38", expectedSwitchChainId: "0x38" });
    await assert.rejects(
      executeEvmZeroXTicket({ profile: "bsc", ticket: prepared.ticket, quote: prepared.quote, provider, address: WALLET }),
      /evm_ticket_provider_issue/,
    );
    assert.equal(provider.calls.length, 0);
  });

  await t.test("ticket fee differs from quote", async () => {
    const prepared = genericBscPrepared();
    prepared.ticket.fee.fee_bps = 1;
    const provider = providerMock({ chainId: "0x38", expectedSwitchChainId: "0x38" });
    await assert.rejects(
      executeEvmZeroXTicket({ profile: "bsc", ticket: prepared.ticket, quote: prepared.quote, provider, address: WALLET }),
      /evm_live_ticket_fee_mismatch/,
    );
    assert.equal(provider.calls.length, 0);
  });

  await t.test("extra transaction field", async () => {
    const prepared = genericBscPrepared();
    prepared.quote.unsigned_transaction.nonce = "1";
    const provider = providerMock({ chainId: "0x38", expectedSwitchChainId: "0x38" });
    await assert.rejects(
      executeEvmZeroXTicket({ profile: "bsc", ticket: prepared.ticket, quote: prepared.quote, provider, address: WALLET }),
      /evm_transaction_field_forbidden:nonce/,
    );
    assert.equal(provider.calls.length, 0);
  });
});

test("generic BSC handoff rechecks account and chain immediately before submission", async (t) => {
  await t.test("account changed", async () => {
    const prepared = genericBscPrepared();
    const provider = providerMock({
      chainId: "0x38",
      expectedSwitchChainId: "0x38",
      accountSequence: [[WALLET], [OTHER_WALLET]],
    });
    await assert.rejects(
      executeEvmZeroXTicket({ profile: "bsc", ticket: prepared.ticket, quote: prepared.quote, provider, address: WALLET }),
      /wallet_account_identity_mismatch/,
    );
    assert.equal(provider.calls.some((call) => call.method === "eth_sendTransaction"), false);
  });

  await t.test("unsupported profile", async () => {
    const prepared = genericBscPrepared();
    const provider = providerMock({ chainId: "0x38", expectedSwitchChainId: "0x38" });
    await assert.rejects(
      executeEvmZeroXTicket({ profile: "ethereum", ticket: prepared.ticket, quote: prepared.quote, provider, address: WALLET }),
      /evm_zero_x_profile_not_supported/,
    );
    assert.equal(provider.calls.length, 0);
  });
});
