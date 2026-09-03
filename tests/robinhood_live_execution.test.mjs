import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  ROBINHOOD_ZERO_X_ALLOWANCE_HOLDER,
  createRobinhoodZeroXQuoteRequest,
  normalizeRobinhoodZeroXUnsignedQuote,
} from "../lib/customer_trade/robinhood_zero_x_live_execution.mjs";
import {
  createD1RobinhoodLiveExecutionStore,
  createRobinhoodLiveTicket,
  normalizeRobinhoodClientExecutionReport,
  reconcileRobinhoodExecution,
} from "../lib/customer_trade/robinhood_live_execution.mjs";

const NOW = Date.parse("2026-09-03T18:00:00.000Z");
const WALLET = "0x3333333333333333333333333333333333333333";
const TOKEN = "0x2222222222222222222222222222222222222222";
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const POOL = "0x4444444444444444444444444444444444444444";
const COLLECTOR = "0xa31872140ebe5eefb6c4dfad1ff2489d25f1e227";
const TX_HASH = `0x${"a".repeat(64)}`;
const BLOCK_HASH = `0x${"b".repeat(64)}`;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function topic(address) {
  return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
}

function amountHex(value) {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}

function normalizedQuote({
  sellToken,
  buyToken,
  sellAmount,
  buyAmount,
  minBuyAmount,
  feeEnabled,
  feeSide = "sell",
  allowance = null,
  balance = null,
  now = NOW,
  zid = "rh-live-provider-quote",
}) {
  const request = createRobinhoodZeroXQuoteRequest({
    chain_id: 4663,
    sell_token: sellToken,
    buy_token: buyToken,
    sell_amount: sellAmount,
    taker: WALLET,
    slippage_bps: 75,
  }, {
    access_tier: "free",
    fee_enabled: feeEnabled,
    fee_recipient: COLLECTOR,
    fee_token_side: feeSide,
    now,
    ttl_ms: 8_000,
  });
  const expectedFee = request.fee.enabled
    ? request.fee.expected_fee_amount_base_units ?? "9900"
    : null;
  return normalizeRobinhoodZeroXUnsignedQuote({
    allowanceTarget: ROBINHOOD_ZERO_X_ALLOWANCE_HOLDER,
    blockNumber: "52130000",
    buyAmount,
    buyToken,
    fees: {
      integratorFee: expectedFee ? { amount: expectedFee, token: request.fee.fee_token, type: "volume" } : null,
      integratorFees: expectedFee ? [{ amount: expectedFee, token: request.fee.fee_token, type: "volume" }] : [],
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
      fills: [{ from: sellToken, to: buyToken, source: "RobinSwap_V3", proportionBps: 10_000 }],
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
      to: ROBINHOOD_ZERO_X_ALLOWANCE_HOLDER,
      data: "0x12345678",
      gas: "210000",
      gasPrice: "1000000000",
      value: "0",
    },
  }, request, { now: now + 10 });
}

function preparedBuy() {
  const entry = normalizedQuote({
    sellToken: USDG,
    buyToken: TOKEN,
    sellAmount: "1000000",
    buyAmount: "500000000000000000",
    minBuyAmount: "490000000000000000",
    feeEnabled: true,
    zid: "rh-entry-provider-quote",
  });
  const exit = normalizedQuote({
    sellToken: TOKEN,
    buyToken: USDG,
    sellAmount: "500000000000000000",
    buyAmount: "970000",
    minBuyAmount: "960000",
    feeEnabled: false,
    allowance: { spender: ROBINHOOD_ZERO_X_ALLOWANCE_HOLDER, actual: "0" },
    balance: { token: TOKEN, actual: "0", expected: "500000000000000000" },
    zid: "rh-exit-provider-quote",
  });
  return createRobinhoodLiveTicket({
    exact_market: {
      instrument_id: `robinhood:pool:${POOL}`,
      pool_address: POOL,
      token_address: TOKEN,
      quote_address: USDG,
      symbol: "TOKEN",
      quote_symbol: "USDG",
      side: "buy",
    },
    entry_quote: entry,
    exit_quote: exit,
    wallet_address: WALLET,
    accounting: {
      asset_address: USDG,
      symbol: "USDG",
      decimals: 6,
      notional_base_units: "1000000",
      maximum_notional_base_units: "500000000",
    },
  }, { now: NOW + 20, ttl_ms: 7_000 });
}

function sqliteD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync("customer-migrations/0001_customer_identity.sql", "utf8"));
  sqlite.exec(readFileSync("customer-migrations/0024_customer_live_execution.sql", "utf8"));
  sqlite.prepare(`
    INSERT INTO ravenos_users
      (user_id, state, primary_email, created_at, updated_at, last_authenticated_at)
    VALUES (?, 'active', ?, ?, ?, ?)
  `).run("usr_robinhood_live_fixture", "owner@example.invalid", 1, 1, 1);
  sqlite.prepare(`
    INSERT INTO ravenos_customer_live_execution_intents
      (execution_id, schema_version, user_id, venue, chain_namespace, wallet_address,
       exact_market_id, side, order_type, notional_usdc, state, prepared_payload_hash,
       prepared_json, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, 'jupiter', 'solana', ?, ?, 'buy', 'market', 1,
            'awaiting_wallet_signature', ?, ?, 20, 10, 10)
  `).run(
    `lex_${"x".repeat(24)}`,
    "ravenos.solana_live_ticket.v1",
    "usr_robinhood_live_fixture",
    "11111111111111111111111111111111",
    "solana:pool:fixture",
    "0".repeat(64),
    JSON.stringify({ fixture: true }),
  );
  sqlite.exec(readFileSync("customer-migrations/0027_customer_evm_live_execution.sql", "utf8"));
  return {
    sqlite,
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        bind(...values) {
          return {
            async run() {
              const result = statement.run(...values);
              return { meta: { changes: Number(result.changes) } };
            },
            async first() {
              return statement.get(...values) || null;
            },
          };
        },
      };
    },
  };
}

test("live buy ticket binds the fee, entry, reverse exit, wallet, and exact market without persisting calldata", () => {
  const prepared = preparedBuy();
  assert.equal(prepared.ticket.schema_version, "ravenos.robinhood_live_ticket.v1");
  assert.equal(prepared.ticket.wallet_address, WALLET);
  assert.equal(prepared.ticket.exact_market.instrument_id, `robinhood:pool:${POOL}`);
  assert.equal(prepared.ticket.fee.fee_bps, 100);
  assert.equal(prepared.ticket.fee.token, USDG);
  assert.equal(prepared.ticket.fee.recipient, COLLECTOR);
  assert.equal(prepared.ticket.fee.expected_amount_base_units, "10000");
  assert.equal(prepared.ticket.exit_proof.verified, true);
  assert.equal(prepared.ticket.exit_proof.minimum_accounting_amount_base_units, "960000");
  assert.equal(prepared.ticket.execution_boundary.server_signing, false);
  assert.equal(prepared.ticket.execution_boundary.custody, false);
  assert.equal(Object.hasOwn(prepared.ticket, "unsigned_transaction"), false);
  assert.equal(JSON.stringify(prepared.ticket).includes("0x12345678"), false);
  assert.equal(prepared.unsigned_transaction.data, "0x12345678");
});

test("a buy without a current reverse-exit proof fails closed", () => {
  const entry = normalizedQuote({
    sellToken: USDG,
    buyToken: TOKEN,
    sellAmount: "1000000",
    buyAmount: "500000000000000000",
    minBuyAmount: "490000000000000000",
    feeEnabled: true,
  });
  assert.throws(() => createRobinhoodLiveTicket({
    exact_market: {
      instrument_id: `robinhood:pool:${POOL}`,
      pool_address: POOL,
      token_address: TOKEN,
      quote_address: USDG,
      side: "buy",
    },
    entry_quote: entry,
    exit_quote: null,
    wallet_address: WALLET,
    accounting: {
      asset_address: USDG,
      symbol: "USDG",
      decimals: 6,
      notional_base_units: "1000000",
      maximum_notional_base_units: "500000000",
    },
  }, { now: NOW + 20 }), /robinhood_exit_quote_invalid/);
});

test("client report binds the one-shot live ticket, wallet, reviewed payload, and transaction hash", () => {
  const prepared = preparedBuy();
  const report = normalizeRobinhoodClientExecutionReport({
    ticket_id: prepared.ticket.ticket_id,
    wallet_address: WALLET,
    reviewed_transaction_hash: prepared.ticket.transaction.reviewed_transaction_hash,
    transaction_hash: TX_HASH,
  }, prepared.ticket);
  assert.equal(report.ticket_id, prepared.ticket.ticket_id);
  assert.equal(report.transaction_hash, TX_HASH);
  assert.equal(report.evidence_state, "client_reported_pending_chain_reconciliation");
  assert.throws(() => normalizeRobinhoodClientExecutionReport({
    ...report,
    reviewed_transaction_hash: "0".repeat(64),
  }, prepared.ticket), /robinhood_execution_reviewed_transaction_mismatch/);
});

test("reconciliation proves exact token debit, output credit, fee transfer, gas, and canonical block", async () => {
  const prepared = preparedBuy();
  const report = normalizeRobinhoodClientExecutionReport({
    ticket_id: prepared.ticket.ticket_id,
    wallet_address: WALLET,
    reviewed_transaction_hash: prepared.ticket.transaction.reviewed_transaction_hash,
    transaction_hash: TX_HASH,
  }, prepared.ticket);
  const rpc = {
    async request(method) {
      if (method === "eth_getTransactionByHash") return { provider_id: "fixture", result: {
        hash: TX_HASH,
        from: WALLET,
        to: ROBINHOOD_ZERO_X_ALLOWANCE_HOLDER,
        input: "0x12345678",
        value: "0x0",
        gas: "0x33450",
        gasPrice: "0x3b9aca00",
      } };
      if (method === "eth_getTransactionReceipt") return { provider_id: "fixture", result: {
        transactionHash: TX_HASH,
        from: WALLET,
        to: ROBINHOOD_ZERO_X_ALLOWANCE_HOLDER,
        status: "0x1",
        blockNumber: "0x31b6f68",
        blockHash: BLOCK_HASH,
        gasUsed: "0x30d40",
        effectiveGasPrice: "0x3b9aca00",
        logs: [
          { address: USDG, topics: [TRANSFER_TOPIC, topic(WALLET), topic(ROBINHOOD_ZERO_X_ALLOWANCE_HOLDER)], data: amountHex("1000000") },
          { address: TOKEN, topics: [TRANSFER_TOPIC, topic(ROBINHOOD_ZERO_X_ALLOWANCE_HOLDER), topic(WALLET)], data: amountHex("500000000000000000") },
          { address: USDG, topics: [TRANSFER_TOPIC, topic(ROBINHOOD_ZERO_X_ALLOWANCE_HOLDER), topic(COLLECTOR)], data: amountHex("10000") },
        ],
      } };
      if (method === "eth_blockNumber") return { provider_id: "fixture", result: "0x31b6f6a" };
      if (method === "eth_getBlockByNumber") return { provider_id: "fixture", result: { hash: BLOCK_HASH } };
      throw new Error(`unexpected_method:${method}`);
    },
  };
  const result = await reconcileRobinhoodExecution({ ticket: prepared.ticket, client_report: report }, {
    rpc_client: rpc,
    now: NOW + 1_000,
    minimum_confirmations: 2,
  });
  assert.equal(result.state, "provider_confirmed");
  assert.equal(result.evidence.economic_result_verified, true);
  assert.equal(result.evidence.sell_debit_base_units, "1000000");
  assert.equal(result.evidence.buy_credit_base_units, "500000000000000000");
  assert.equal(result.evidence.fee_collection.state, "observed");
  assert.equal(result.evidence.fee_collection.observed_amount_base_units, "10000");
  assert.equal(result.evidence.l1_finality_observed, false);
});

test("migration preserves populated legacy rows and adds exact, unique, append-only EVM evidence", async () => {
  const db = sqliteD1();
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM ravenos_customer_live_execution_intents").get().n, 1);
  const prepared = preparedBuy();
  const store = createD1RobinhoodLiveExecutionStore(db);
  const nowSeconds = Math.floor((NOW + 20) / 1000);
  await store.createTicket({ prepared, user_id: "usr_robinhood_live_fixture", now_seconds: nowSeconds });
  const row = db.sqlite.prepare(`
    SELECT venue, chain_namespace, raven_fee_bps, expected_raven_fee_usdc,
           accounting_asset_address, notional_accounting_base_units,
           expected_raven_fee_amount_base_units, entry_quote_hash, exit_quote_hash,
           transaction_hash
    FROM ravenos_customer_live_execution_intents WHERE execution_id = ?
  `).get(prepared.ticket.ticket_id);
  assert.deepEqual({ ...row }, {
    venue: "zero_x",
    chain_namespace: "robinhood",
    raven_fee_bps: 100,
    expected_raven_fee_usdc: 0.01,
    accounting_asset_address: USDG,
    notional_accounting_base_units: "1000000",
    expected_raven_fee_amount_base_units: "10000",
    entry_quote_hash: prepared.ticket.provider.quote_hash,
    exit_quote_hash: prepared.ticket.exit_proof.quote_hash,
    transaction_hash: null,
  });
  const report = normalizeRobinhoodClientExecutionReport({
    ticket_id: prepared.ticket.ticket_id,
    wallet_address: WALLET,
    reviewed_transaction_hash: prepared.ticket.transaction.reviewed_transaction_hash,
    transaction_hash: TX_HASH,
  }, prepared.ticket);
  await store.recordClientReport({ record: report, user_id: "usr_robinhood_live_fixture", now_seconds: nowSeconds });
  await assert.rejects(() => store.recordClientReport({
    record: report,
    user_id: "usr_robinhood_live_fixture",
    now_seconds: nowSeconds,
  }), /robinhood_execution_ticket_not_reportable/);
  const event = db.sqlite.prepare("SELECT event_id FROM ravenos_customer_live_execution_events WHERE execution_id = ? LIMIT 1").get(prepared.ticket.ticket_id);
  assert.throws(() => db.sqlite.prepare("UPDATE ravenos_customer_live_execution_events SET state = 'changed' WHERE event_id = ?").run(event.event_id), /append_only/);
  assert.throws(() => db.sqlite.prepare("DELETE FROM ravenos_customer_live_execution_events WHERE event_id = ?").run(event.event_id), /append_only/);
  db.sqlite.close();
});
