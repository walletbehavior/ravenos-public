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

const { executeRobinhoodZeroXTicket } = globalThis.RavenOSWalletExecution;
const WALLET = "0x3333333333333333333333333333333333333333";
const OTHER_WALLET = "0x4444444444444444444444444444444444444444";
const SELL_TOKEN = "0x1111111111111111111111111111111111111111";
const BUY_TOKEN = "0x2222222222222222222222222222222222222222";
const TRANSACTION_HASH = `0x${"a".repeat(64)}`;

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
        assert.deepEqual(payload.params, [{ chainId: "0x1237" }]);
        currentChainId = "0x1237";
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
