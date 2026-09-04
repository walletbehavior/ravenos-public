import assert from "node:assert/strict";
import test from "node:test";

import {
  EVM_WALLET_BASIC_PROFILE_SCHEMA,
  EVM_WALLET_LOOKUP_SCHEMA,
  inspectEvmWallet,
  resolveEvmWalletLookupRuntime,
} from "../lib/customer_trade/evm_wallet_lookup.mjs";
import { routeCustomerWalletCopy } from "../lib/customer_wallet_copy.mjs";

const ADDRESS = `0x${"12".repeat(20)}`;
const OTHER = `0x${"34".repeat(20)}`;
const TOKEN = `0x${"56".repeat(20)}`;
const TOKEN_TWO = `0x${"ab".repeat(20)}`;
const TX = `0x${"78".repeat(32)}`;
const BLOCK = `0x${"9a".repeat(32)}`;
const KEY = "proapi_server_only";

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function provider() {
  const urls = [];
  return {
    urls,
    async fetch(url) {
      urls.push(new URL(url));
      if (url.includes("/counters")) return json({ transactions_count: "123", token_transfers_count: "456", gas_usage_count: "0", validations_count: "0" });
      if (url.includes("/tokens?")) return json({ items: [{
        value: "2500000",
        token: { address_hash: TOKEN, type: "ERC-20", decimals: "6", symbol: "USDC", name: "USD Coin", exchange_rate: "1.001" },
      }], next_page_params: null });
      if (url.includes("/token-transfers?")) return json({ items: [{
        block_hash: BLOCK,
        block_number: 1234,
        from: { hash: OTHER },
        to: { hash: ADDRESS.toUpperCase().replace("0X", "0x") },
        log_index: 7,
        method: "transfer",
        timestamp: "2026-09-04T12:00:00.000Z",
        token: { address_hash: TOKEN, type: "ERC-20", decimals: "6", symbol: "USDC" },
        total: { decimals: "6", value: "2500000" },
        transaction_hash: TX,
      }], next_page_params: null });
      return json({ hash: ADDRESS.toUpperCase().replace("0X", "0x"), coin_balance: "1250000000000000000", block_number_balance_updated_at: 1234, is_contract: false });
    },
  };
}

test("EVM wallet lookup activation fails closed without both flag and server key", () => {
  assert.equal(resolveEvmWalletLookupRuntime({}, "base").state, "disabled");
  assert.equal(resolveEvmWalletLookupRuntime({ RAVENOS_EVM_WALLET_LOOKUP_ENABLED: "1" }, "base").state, "misconfigured");
  const configured = resolveEvmWalletLookupRuntime({ RAVENOS_EVM_WALLET_LOOKUP_ENABLED: "1", BLOCKSCOUT_API_KEY: KEY }, "base");
  assert.equal(configured.state, "configured");
  assert.equal(configured.api_key_configured, true);
  assert(!JSON.stringify(configured).includes(KEY));
  assert.equal(resolveEvmWalletLookupRuntime({ RAVENOS_EVM_WALLET_LOOKUP_ENABLED: "1", BLOCKSCOUT_API_KEY: KEY }, "avalanche").state, "unsupported");
});

test("same-wallet requests reuse only validated Cache API payloads", async () => {
  const source = provider();
  const entries = new Map();
  const cache = {
    async match(request) { return entries.get(request.url)?.clone() || null; },
    async put(request, response) { entries.set(request.url, response.clone()); },
  };
  const options = {
    chain: "robinhood",
    address: ADDRESS,
    env: { RAVENOS_EVM_WALLET_LOOKUP_ENABLED: "1", BLOCKSCOUT_API_KEY: KEY },
    fetchImpl: source.fetch,
    cache,
  };
  const direct = await inspectEvmWallet({ ...options, now: "2026-09-04T12:01:00.000Z" });
  const cached = await inspectEvmWallet({ ...options, now: "2026-09-04T12:01:30.000Z" });
  assert.equal(direct.source.delivery, "provider_live");
  assert.equal(cached.source.delivery, "edge_cache_fresh");
  assert.equal(source.urls.length, 4);
  assert.equal(entries.size, 1);
  assert(!JSON.stringify(cached).includes(KEY));
});

test("bounded Base lookup exposes balances and transfers without inventing trades or P&L", async () => {
  const source = provider();
  const result = await inspectEvmWallet({
    chain: "base",
    address: ADDRESS.toUpperCase().replace("0X", "0x"),
    env: { RAVENOS_EVM_WALLET_LOOKUP_ENABLED: "1", BLOCKSCOUT_API_KEY: KEY },
    fetchImpl: source.fetch,
    now: "2026-09-04T12:01:00.000Z",
  });
  assert.equal(result.schema_version, EVM_WALLET_LOOKUP_SCHEMA);
  assert.equal(result.profile.schema_version, EVM_WALLET_BASIC_PROFILE_SCHEMA);
  assert.equal(result.profile.source_wallet.chain, "base");
  assert.equal(result.profile.source_wallet.chain_id, 8453);
  assert.equal(result.profile.coverage.transactions_reported_by_provider, 123);
  assert.equal(result.profile.coverage.token_transfers_reported_by_provider, 456);
  assert.equal(result.profile.behavior.trade_count, null);
  assert.deepEqual(result.profile.provider_activity, {
    state: "transfer_activity_observed",
    observed_transfer_rows: 1,
    inbound_transfer_rows: 1,
    outbound_transfer_rows: 0,
    internal_movement_rows: 0,
    unique_token_contracts: 1,
    most_recent_transfer_at: "2026-09-04T12:00:00.000Z",
    trade_activity_claimed: false,
    economic_flow_claimed: false,
    direction_is_transfer_direction_only: true,
    route_decode_candidate_transactions: 0,
    route_decode_candidate_definition: "opposing_different_token_transfers_in_one_transaction",
    route_decode_candidate_is_trade_claimed: false,
  });
  assert.equal(result.profile.source_performance.realized_pnl_usdc, null);
  assert.equal(result.profile.source_performance.roi_pct, null);
  assert.equal(result.profile.capital_observations.native.amount, "1.25");
  assert.deepEqual(result.profile.provider_balance_summary, {
    visible_balance_rows: 1,
    visible_priced_rows: 1,
    visible_unpriced_rows: 0,
    visible_provider_mark_value_usd: 2.5025,
    largest_visible_provider_mark_symbol: "USDC",
    largest_visible_provider_mark_weight_pct: 100,
    visible_rows_only: true,
    all_assets_enumerated: null,
    executable_value_claimed: false,
    portfolio_value_claimed: false,
  });
  assert.equal(result.profile.positions.provider_reported_token_balances[0].balance_display, "2.5");
  assert.equal(result.profile.positions.provider_reported_token_balances[0].provider_mark_value_usd, 2.5025);
  assert.equal(result.profile.positions.provider_reported_token_balances[0].executable_value_usd, null);
  assert.equal(result.activity.events[0].classification.kind, "TRANSFER_IN");
  assert.equal(result.activity.events[0].copy_signal.eligible_buy_signal, false);
  assert.equal(result.persistence.state, "on_demand_only");
  assert.equal(result.source.api_key_exposed, false);
  assert.equal(source.urls.length, 4);
  assert(source.urls.every((url) => url.origin === "https://api.blockscout.com" && url.pathname.startsWith("/8453/api/v2/")));
  assert(source.urls.every((url) => url.searchParams.get("apikey") === KEY));
  assert(!JSON.stringify(result).includes(KEY));
  assert(Object.isFrozen(result));
});

test("opposing token transfers only create a route-decode candidate, never a trade signal", async () => {
  const source = provider();
  const original = source.fetch;
  source.fetch = async (url) => {
    if (!url.includes("/token-transfers?")) return original(url);
    return json({ items: [{
      block_hash: BLOCK,
      block_number: 1234,
      from: { hash: OTHER },
      to: { hash: ADDRESS },
      log_index: 7,
      timestamp: "2026-09-04T12:00:00.000Z",
      token: { address_hash: TOKEN, type: "ERC-20", decimals: "6", symbol: "USDC" },
      total: { decimals: "6", value: "2500000" },
      transaction_hash: TX,
    }, {
      block_hash: BLOCK,
      block_number: 1234,
      from: { hash: ADDRESS },
      to: { hash: OTHER },
      log_index: 8,
      timestamp: "2026-09-04T12:00:00.000Z",
      token: { address_hash: TOKEN_TWO, type: "ERC-20", decimals: "18", symbol: "TOKEN" },
      total: { decimals: "18", value: "1000000000000000000" },
      transaction_hash: TX,
    }], next_page_params: null });
  };
  const result = await inspectEvmWallet({
    chain: "robinhood",
    address: ADDRESS,
    env: { RAVENOS_EVM_WALLET_LOOKUP_ENABLED: "1", BLOCKSCOUT_API_KEY: KEY },
    fetchImpl: source.fetch,
    now: "2026-09-04T12:01:00.000Z",
  });
  assert.equal(result.profile.provider_activity.route_decode_candidate_transactions, 1);
  assert.equal(result.profile.provider_activity.route_decode_candidate_is_trade_claimed, false);
  assert.equal(result.profile.behavior.trade_count, null);
  assert(result.activity.events.every((event) => event.copy_signal.eligible_buy_signal === false));
});

test("lookup refuses a provider response for another wallet", async () => {
  const source = provider();
  const original = source.fetch;
  source.fetch = async (url) => url.includes("/counters") || url.includes("/tokens?") || url.includes("/token-transfers?")
    ? original(url)
    : json({ hash: OTHER, coin_balance: "0" });
  await assert.rejects(
    inspectEvmWallet({
      chain: "ethereum",
      address: ADDRESS,
      env: { RAVENOS_EVM_WALLET_LOOKUP_ENABLED: "1", BLOCKSCOUT_API_KEY: KEY },
      fetchImpl: source.fetch,
      now: "2026-09-04T12:01:00.000Z",
    }),
    /evm_wallet_provider_identity_mismatch/,
  );
});

test("authenticated wallet-copy route accepts an explicit EVM chain without persisting a copy source", async () => {
  const source = provider();
  const now = Math.floor(Date.parse("2026-09-04T12:01:00.000Z") / 1_000);
  const userId = `usr_${"e".repeat(32)}`;
  const response = await routeCustomerWalletCopy(new Request("https://app.ravenos.xyz/api/v1/wallet-copy/inspect", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      origin: "https://app.ravenos.xyz",
      referer: "https://app.ravenos.xyz/account/copy/",
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify({ address: ADDRESS, chain: "bsc" }),
  }), {
    RAVENOS_ENTITLEMENT_RESOLUTION_ENABLE: "1",
    RAVENOS_WALLET_INTELLIGENCE_ENABLED: "1",
    RAVENOS_WALLET_COPY_ROUTES_ENABLED: "1",
    RAVENOS_EVM_WALLET_LOOKUP_ENABLED: "1",
    BLOCKSCOUT_API_KEY: KEY,
  }, {
    authorizeRequest: async () => ({
      principal: { user_id: userId, session_public_id: "ses_evm_lookup", authenticated_at: now - 60 },
      store: {},
      now,
      response_headers: new Headers({ "x-ravenos-session": "authenticated" }),
    }),
    entitlementStore: { async listOwnedGrants() { return [{
      grant_id: `ent_${"g".repeat(32)}`,
      user_id: userId,
      capability_key: "wallet.copy",
      state: "active",
      activation_at: now - 60,
      expires_at: now + 3600,
      revision: 1,
    }]; } },
    consumeRateLimit: async () => ({ allowed: true, retry_after_seconds: 0 }),
    walletCopyStore: {},
    fetchImpl: source.fetch,
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.profile.source_wallet.chain, "bsc");
  assert.equal(payload.profile.source_wallet.chain_id, 56);
  assert.equal(payload.persistence.state, "on_demand_only");
  assert.equal(payload.profile.behavior.trade_count, null);
  assert.equal(payload.profile.source_performance.realized_pnl_usdc, null);
  assert(!JSON.stringify(payload).includes(KEY));
});
