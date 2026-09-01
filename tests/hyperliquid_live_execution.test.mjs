import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  createD1CustomerLiveExecutionStore,
  createHyperliquidBuilderApproval,
  createHyperliquidLiveTicket,
  normalizeHyperliquidClientExecutionReport,
} from "../lib/customer_trade/hyperliquid_live_execution.mjs";
import { feePolicyFor } from "../lib/customer_trade/fee_policy.mjs";

const NOW = Date.parse("2026-09-01T18:00:00.000Z");
const ADDRESS = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const BUILDER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function scenario(overrides = {}) {
  const base = {
    ok: true,
    state: "account_scenario_blocked",
    scenario_id: "hlas_live_fixture",
    expires_at: "2026-09-01T18:00:10.000Z",
    account_context: {
      address: ADDRESS,
      observed_at: "2026-09-01T17:59:59.500Z",
      current_position: null,
    },
    instrument: {
      instrument_id: "hyperliquid:perp:SOL",
      exact_market_id: "SOL",
    },
    intent: {
      side: "long",
      order_type: "market",
      time_in_force: null,
      requested_notional_usdc: 100,
      planned_base_size: 0.666666,
      limit_price: null,
      leverage: 5,
      margin_mode: "cross",
      reduce_only: false,
    },
    market_reference: { best_bid: 149.9, best_ask: 150.1 },
    risk_bracket: { configured: false },
    venue_settings: { settings_change_required: true },
    review: { blockers: ["venue_margin_settings_change_required"] },
  };
  return { ...base, ...overrides };
}

function market() {
  return {
    instrument_id: "hyperliquid:perp:SOL",
    asset_index: 5,
    sz_decimals: 2,
    max_leverage: 20,
  };
}

function ticket(input = {}, options = {}) {
  return createHyperliquidLiveTicket({
    scenario: scenario(),
    market: market(),
    wallet_address: ADDRESS,
    maximum_notional_usdc: 500,
    max_impact_bps: 100,
    ...input,
  }, { now: NOW, ...options });
}

function builderPolicy(tier = "free") {
  return feePolicyFor({
    provider: "hyperliquid",
    trade_type: "perpetual",
    access_tier: tier,
    fee_token: "USDC",
    fee_recipient: BUILDER,
    enabled: true,
  });
}

function sqliteD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync("customer-migrations/0001_customer_identity.sql", "utf8"));
  sqlite.exec(readFileSync("customer-migrations/0024_customer_live_execution.sql", "utf8"));
  sqlite.prepare(`
    INSERT INTO ravenos_users
      (user_id, state, primary_email, created_at, updated_at, last_authenticated_at)
    VALUES (?, 'active', ?, ?, ?, ?)
  `).run("usr_live_canary_fixture", "owner@example.invalid", 1, 1, 1);
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

test("live ticket binds a short-lived wallet-owned Hyperliquid market order", () => {
  const value = ticket();
  assert.equal(value.schema_version, "ravenos.hyperliquid_live_ticket.v1");
  assert.equal(value.wallet_address, ADDRESS);
  assert.equal(value.instrument.asset_index, 5);
  assert.equal(value.reviewed_order.base_size, "0.66");
  assert.equal(value.reviewed_order.limit_or_guard_price, "151.6");
  assert.equal(value.action.orders[0].a, 5);
  assert.equal(value.action.orders[0].b, true);
  assert.equal(value.action.orders[0].t.limit.tif, "FrontendMarket");
  assert.equal(value.pre_actions.update_leverage.required, true);
  assert.equal(value.action_hash.length, 64);
  assert.equal(value.binding_hash.length, 64);
  assert.equal(value.fee.raven_fee_enabled, false);
  assert.equal(value.execution_boundary.wallet_confirmation_required, true);
  assert.equal(value.execution_boundary.server_signing, false);
  assert.equal(value.execution_boundary.private_key_received, false);
  assert.equal(value.execution_boundary.custody, false);
  assert.ok(Date.parse(value.expires_at) <= NOW + 10_000);
});

test("limit order uses the reviewed limit and time-in-force", () => {
  const value = ticket({
    scenario: scenario({
      state: "account_scenario_available",
      intent: {
        ...scenario().intent,
        side: "short",
        order_type: "limit",
        time_in_force: "alo",
        limit_price: 151.23456,
      },
      venue_settings: { settings_change_required: false },
      review: { blockers: [] },
    }),
  });
  assert.equal(value.reviewed_order.limit_or_guard_price, "151.23");
  assert.equal(value.action.orders[0].b, false);
  assert.equal(value.action.orders[0].t.limit.tif, "Alo");
  assert.equal(value.pre_actions.update_leverage.required, true);
});

test("server-owned builder fee is bound into the exact order and accounting", () => {
  const value = ticket({
    fee_policy: builderPolicy("free"),
    approved_fee_parameter_value: 100,
  });
  assert.deepEqual(value.action.builder, { b: BUILDER, f: 100 });
  assert.equal(value.fee.raven_fee_enabled, true);
  assert.equal(value.fee.raven_fee_bps, 10);
  assert.equal(value.fee.estimated_raven_fee_usdc, 0.1);
  assert.equal(value.fee.fee_token, "USDC");
  assert.equal(value.fee.collection_method, "hyperliquid_builder_code");
  assert.equal(value.action_hash.length, 64);

  const pro = ticket({
    fee_policy: builderPolicy("pro"),
    approved_fee_parameter_value: 70,
  });
  assert.deepEqual(pro.action.builder, { b: BUILDER, f: 70 });
  assert.equal(pro.fee.raven_fee_bps, 7);
  assert.equal(pro.fee.estimated_raven_fee_usdc, 0.07);
});

test("builder fee authorization is an explicit main-wallet action separate from an order", () => {
  const approval = createHyperliquidBuilderApproval({
    wallet_address: ADDRESS,
    fee_policy: builderPolicy("free"),
    approved_fee_parameter_value: 0,
  }, { now: NOW });
  assert.equal(approval.schema_version, "ravenos.hyperliquid_builder_approval.v1");
  assert.deepEqual(approval.action, { builder: BUILDER, maxFeeRate: "0.10%" });
  assert.equal(approval.fee.required_fee_parameter_value, 100);
  assert.equal(approval.execution_boundary.order_submission_included, false);
  assert.equal(approval.execution_boundary.server_signing, false);
  assert.equal(approval.execution_boundary.custody, false);
  assert.equal(Object.hasOwn(approval.action, "orders"), false);
});

test("builder fee collection fails closed until the exact venue cap is approved", () => {
  assert.throws(() => ticket({
    fee_policy: builderPolicy("free"),
    approved_fee_parameter_value: 99,
  }), /builder_fee_approval_required/);
  assert.throws(() => ticket({
    fee_policy: { ...builderPolicy("free"), fee_parameter_value: 90 },
    approved_fee_parameter_value: 100,
  }), /builder_fee_parameter_mismatch/);
});

test("live execution ledger preserves expected and observed builder-fee evidence", async () => {
  const db = sqliteD1();
  const store = createD1CustomerLiveExecutionStore(db);
  const value = ticket({
    fee_policy: builderPolicy("free"),
    approved_fee_parameter_value: 100,
  });
  await store.createTicket({ ticket: value, user_id: "usr_live_canary_fixture", now_seconds: Math.floor(NOW / 1000) });
  const inserted = db.sqlite.prepare(`
    SELECT raven_fee_bps, expected_raven_fee_usdc, observed_raven_fee_usdc, fee_token,
           fee_recipient, fee_collection_method, fee_collection_status
    FROM ravenos_customer_live_execution_intents WHERE execution_id = ?
  `).get(value.ticket_id);
  assert.deepEqual({ ...inserted }, {
    raven_fee_bps: 10,
    expected_raven_fee_usdc: 0.1,
    observed_raven_fee_usdc: null,
    fee_token: "USDC",
    fee_recipient: BUILDER,
    fee_collection_method: "hyperliquid_builder_code",
    fee_collection_status: "expected",
  });
  db.sqlite.close();
});

test("live ticket refuses stale, oversized, blocked, bracketed, and mismatched requests", () => {
  assert.throws(() => ticket({ scenario: scenario({ account_context: { ...scenario().account_context, observed_at: "2026-09-01T17:59:40.000Z" } }) }), /account_snapshot_stale/);
  assert.throws(() => ticket({ scenario: scenario({ intent: { ...scenario().intent, requested_notional_usdc: 501 } }) }), /live_notional_out_of_bounds/);
  assert.throws(() => ticket({ scenario: scenario({ review: { blockers: ["insufficient_current_withdrawable"] } }) }), /account_scenario_blocked/);
  assert.throws(() => ticket({ scenario: scenario({ risk_bracket: { configured: true } }) }), /live_bracket_not_supported/);
  assert.throws(() => ticket({ wallet_address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }), /wallet_account_identity_mismatch/);
});

test("client report preserves client evidence separately pending provider reconciliation", () => {
  const prepared = ticket();
  const filled = normalizeHyperliquidClientExecutionReport({
    ticket_id: prepared.ticket_id,
    wallet_address: ADDRESS,
    action_hash: prepared.action_hash,
    provider_response: {
      response: { data: { statuses: [{ filled: { oid: 123, totalSz: "0.66", avgPx: "150.2", unexpected: "discard" } }] } },
    },
  }, prepared);
  assert.equal(filled.state, "filled");
  assert.equal(filled.provider_order_id, 123);
  assert.deepEqual(filled.fill, { oid: 123, total_size: "0.66", average_price: "150.2" });
  assert.equal(filled.evidence_state, "client_reported_pending_provider_reconciliation");
  assert.equal(filled.transaction_hash, null);
  assert.equal(JSON.stringify(filled).includes("unexpected"), false);

  assert.throws(() => normalizeHyperliquidClientExecutionReport({
    ticket_id: prepared.ticket_id,
    wallet_address: ADDRESS,
    action_hash: "0".repeat(64),
    provider_response: { response: { data: { statuses: [{ resting: { oid: 124 } }] } } },
  }, prepared), /execution_action_hash_mismatch/);
});
