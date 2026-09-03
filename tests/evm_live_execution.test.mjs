import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  BASE_EVM_CHAIN_PROFILE,
  BSC_EVM_CHAIN_PROFILE,
  EVM_ZERO_X_ALLOWANCE_HOLDER,
  ETHEREUM_EVM_CHAIN_PROFILE,
  ROBINHOOD_EVM_CHAIN_PROFILE,
} from "../lib/customer_trade/evm_chain_profiles.mjs";
import {
  createEvmZeroXQuoteRequest,
  normalizeEvmZeroXUnsignedQuote,
} from "../lib/customer_trade/evm_zero_x_live_execution.mjs";
import {
  EVM_LIVE_CLIENT_REPORT_SCHEMA,
  EVM_LIVE_RECONCILIATION_SCHEMA,
  EVM_LIVE_TICKET_SCHEMA,
  createD1EvmLiveExecutionStore,
  createEvmLiveTicket,
  normalizeEvmClientExecutionReport,
  reconcileEvmExecution,
} from "../lib/customer_trade/evm_live_execution.mjs";

const NOW = Date.parse("2026-09-04T05:00:00.000Z");
const WALLET = "0x3333333333333333333333333333333333333333";
const TOKEN = "0x2222222222222222222222222222222222222222";
const POOL = "0x4444444444444444444444444444444444444444";
const COLLECTOR = "0xa31872140ebe5eefb6c4dfad1ff2489d25f1e227";
const ROUTER = EVM_ZERO_X_ALLOWANCE_HOLDER;
const TX_HASH = `0x${"a".repeat(64)}`;
const BLOCK_HASH = `0x${"b".repeat(64)}`;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function topic(address) {
  return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
}

function amountWord(value) {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}

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
    now: NOW,
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
      gasPrice: "1000000000",
      value: "0",
    },
  }, request, { profile, now: NOW + 10 });
}

function preparedBuy(profile) {
  const accounting = profile.accounting_asset;
  const unit = 10n ** BigInt(accounting.decimals);
  const entry = normalizedQuote(profile, {
    sellToken: accounting.address,
    buyToken: TOKEN,
    sellAmount: unit.toString(),
    buyAmount: "500000000000000000",
    minBuyAmount: "490000000000000000",
    feeEnabled: true,
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
    zid: `${profile.chain_namespace}-exit-provider-quote`,
  });
  return createEvmLiveTicket({
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
  }, { profile, now: NOW + 20, ttl_ms: 7_000 });
}

function sqliteD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync("customer-migrations/0001_customer_identity.sql", "utf8"));
  sqlite.exec(readFileSync("customer-migrations/0024_customer_live_execution.sql", "utf8"));
  sqlite.prepare(`
    INSERT INTO ravenos_users
      (user_id, state, primary_email, created_at, updated_at, last_authenticated_at)
    VALUES (?, 'active', ?, ?, ?, ?)
  `).run("usr_evm_live_fixture", "owner@example.invalid", 1, 1, 1);
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

for (const profile of [
  ROBINHOOD_EVM_CHAIN_PROFILE,
  BSC_EVM_CHAIN_PROFILE,
  BASE_EVM_CHAIN_PROFILE,
  ETHEREUM_EVM_CHAIN_PROFILE,
]) {
  test(`${profile.chain_namespace} live ticket binds its profile, accounting representation, exit proof, and no calldata`, () => {
    const prepared = preparedBuy(profile);
    assert.equal(prepared.ticket.schema_version, EVM_LIVE_TICKET_SCHEMA);
    assert.equal(prepared.ticket.profile_id, profile.profile_id);
    assert.equal(prepared.ticket.chain_namespace, profile.chain_namespace);
    assert.equal(prepared.ticket.chain_id, profile.chain_id);
    assert.equal(prepared.ticket.canonical_chain_id, profile.canonical_chain_id);
    assert.equal(prepared.ticket.wallet_chain_id_hex, profile.wallet_chain_id_hex);
    assert.equal(prepared.ticket.exact_market.instrument_id, `${profile.chain_namespace}:pool:${POOL}`);
    assert.equal(prepared.ticket.accounting.asset_address, profile.accounting_asset.address);
    assert.equal(prepared.ticket.accounting.representation, profile.accounting_asset.representation);
    assert.equal(prepared.ticket.accounting.circle_canonical_usdc, profile.accounting_asset.circle_canonical_usdc);
    assert.equal(prepared.ticket.fee.fee_bps, 100);
    assert.equal(prepared.ticket.exit_proof.verified, true);
    assert.equal(prepared.ticket.execution_boundary.submission_path, "wallet_direct_to_evm_chain");
    assert.equal(prepared.ticket.execution_boundary.server_signing, false);
    assert.equal(Object.hasOwn(prepared.ticket, "unsigned_transaction"), false);
    assert.equal(JSON.stringify(prepared.ticket).includes("0x12345678"), false);
    assert.equal(prepared.unsigned_transaction.data, "0x12345678");
  });
}

test("BSC ticket refuses RH market identity and substituted stablecoin accounting", () => {
  const prepared = preparedBuy(BSC_EVM_CHAIN_PROFILE);
  assert.equal(prepared.ticket.accounting.circle_canonical_usdc, false);
  const accounting = BSC_EVM_CHAIN_PROFILE.accounting_asset;
  const unit = 10n ** BigInt(accounting.decimals);
  const entry = normalizedQuote(BSC_EVM_CHAIN_PROFILE, {
    sellToken: accounting.address,
    buyToken: TOKEN,
    sellAmount: unit.toString(),
    buyAmount: "500000000000000000",
    minBuyAmount: "490000000000000000",
    feeEnabled: true,
    zid: "bsc-mismatch-entry-quote",
  });
  assert.throws(() => createEvmLiveTicket({
    exact_market: {
      instrument_id: `robinhood:pool:${POOL}`,
      pool_address: POOL,
      token_address: TOKEN,
      quote_address: accounting.address,
      side: "buy",
    },
    entry_quote: entry,
    wallet_address: WALLET,
    accounting: {
      asset_address: accounting.address,
      symbol: accounting.symbol,
      decimals: accounting.decimals,
      notional_base_units: unit.toString(),
      maximum_notional_base_units: unit.toString(),
      circle_canonical_usdc: true,
    },
  }, { profile: BSC_EVM_CHAIN_PROFILE, now: NOW + 20 }), /evm_exact_market_identity_mismatch/);

  assert.throws(() => createEvmLiveTicket({
    exact_market: {
      instrument_id: `bsc:pool:${POOL}`,
      pool_address: POOL,
      token_address: TOKEN,
      quote_address: accounting.address,
      side: "buy",
    },
    entry_quote: entry,
    wallet_address: WALLET,
    accounting: {
      asset_address: "0x1111111111111111111111111111111111111111",
      symbol: "USDC",
      decimals: 18,
      notional_base_units: unit.toString(),
      maximum_notional_base_units: unit.toString(),
    },
  }, { profile: BSC_EVM_CHAIN_PROFILE, now: NOW + 20 }), /evm_accounting_asset_not_supported/);
});

test("BSC client report and chain reconciliation prove ERC-20 output and fee without signing authority", async () => {
  const prepared = preparedBuy(BSC_EVM_CHAIN_PROFILE);
  const report = normalizeEvmClientExecutionReport({
    ticket_id: prepared.ticket.ticket_id,
    wallet_address: WALLET,
    reviewed_transaction_hash: prepared.ticket.transaction.reviewed_transaction_hash,
    transaction_hash: TX_HASH,
  }, prepared.ticket);
  assert.equal(report.schema_version, EVM_LIVE_CLIENT_REPORT_SCHEMA);
  assert.equal(report.profile_id, "bsc-mainnet-v1");
  assert.equal(report.chain_id, 56);

  const accounting = BSC_EVM_CHAIN_PROFILE.accounting_asset;
  const unit = 10n ** 18n;
  const expectedFee = unit / 100n;
  const rpc = {
    async request(method) {
      if (method === "eth_getTransactionByHash") return {
        provider_id: "bsc-test-rpc",
        result: {
          hash: TX_HASH,
          from: WALLET,
          to: ROUTER,
          input: "0x12345678",
          value: "0x0",
          gas: "0x33450",
          gasPrice: "0x3b9aca00",
        },
      };
      if (method === "eth_getTransactionReceipt") return {
        result: {
          transactionHash: TX_HASH,
          from: WALLET,
          to: ROUTER,
          status: "0x1",
          blockNumber: "0x64",
          blockHash: BLOCK_HASH,
          gasUsed: "0x30d40",
          effectiveGasPrice: "0x3b9aca00",
          logs: [
            {
              address: accounting.address,
              topics: [TRANSFER_TOPIC, topic(WALLET), topic(ROUTER)],
              data: amountWord(unit - expectedFee),
            },
            {
              address: accounting.address,
              topics: [TRANSFER_TOPIC, topic(WALLET), topic(COLLECTOR)],
              data: amountWord(expectedFee),
            },
            {
              address: TOKEN,
              topics: [TRANSFER_TOPIC, topic(ROUTER), topic(WALLET)],
              data: amountWord("500000000000000000"),
            },
          ],
        },
      };
      if (method === "eth_blockNumber") return { result: "0x66" };
      if (method === "eth_getBlockByNumber") return { result: { hash: BLOCK_HASH } };
      throw new Error(`unexpected_method:${method}`);
    },
  };
  const reconciliation = await reconcileEvmExecution({
    ticket: prepared.ticket,
    client_report: report,
  }, { rpc_client: rpc, now: NOW + 1_000, minimum_confirmations: 2 });
  assert.equal(reconciliation.schema_version, EVM_LIVE_RECONCILIATION_SCHEMA);
  assert.equal(reconciliation.state, "provider_confirmed");
  assert.equal(reconciliation.evidence.chain_namespace, "bsc");
  assert.equal(reconciliation.evidence.confirmations, "3");
  assert.equal(reconciliation.evidence.finalized, false);
  assert.equal(reconciliation.evidence.finality_claim, "confirmation_depth_only");
  assert.equal(reconciliation.evidence.sell_debit_base_units, unit.toString());
  assert.equal(reconciliation.evidence.buy_credit_base_units, "500000000000000000");
  assert.equal(reconciliation.evidence.fee_collection.state, "observed");
  assert.equal(reconciliation.evidence.fee_collection.observed_amount_base_units, expectedFee.toString());
});

test("generic D1 store scopes BSC tickets and reports to the exact chain namespace", async () => {
  const db = sqliteD1();
  const prepared = preparedBuy(BSC_EVM_CHAIN_PROFILE);
  const store = createD1EvmLiveExecutionStore(db, { profile: BSC_EVM_CHAIN_PROFILE });
  await store.createTicket({ prepared, user_id: "usr_evm_live_fixture", now_seconds: Math.floor((NOW + 20) / 1_000) });
  const saved = await store.findTicket(prepared.ticket.ticket_id, "usr_evm_live_fixture");
  assert.equal(saved.chain_namespace, "bsc");
  assert.equal(saved.prepared.profile_id, "bsc-mainnet-v1");
  assert.equal(JSON.stringify(saved.prepared).includes("0x12345678"), false);

  const report = normalizeEvmClientExecutionReport({
    ticket_id: prepared.ticket.ticket_id,
    wallet_address: WALLET,
    reviewed_transaction_hash: prepared.ticket.transaction.reviewed_transaction_hash,
    transaction_hash: TX_HASH,
  }, prepared.ticket);
  await store.recordClientReport({ record: report, user_id: "usr_evm_live_fixture", now_seconds: Math.floor((NOW + 1_000) / 1_000) });
  const row = db.sqlite.prepare(`
    SELECT chain_namespace, state, transaction_hash
    FROM ravenos_customer_live_execution_intents
    WHERE execution_id = ?
  `).get(prepared.ticket.ticket_id);
  assert.deepEqual({ ...row }, { chain_namespace: "bsc", state: "client_reported", transaction_hash: TX_HASH });
});
