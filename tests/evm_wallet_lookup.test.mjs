import { sqliteStore } from "./customer_pro_rewards.test.mjs";
import { createD1CustomerWalletCopyStore } from "../lib/customer_wallet_copy.mjs";
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
  const retained = await inspectEvmWallet({ ...options, now: "2026-09-04T12:11:00.000Z" });
  assert.equal(retained.source.delivery, "edge_cache_retained");
  assert.equal(retained.profile.generated_at, direct.profile.generated_at);
  assert.equal(retained.freshness.current_balance_claimed, false);
  assert.equal(source.urls.length, 4);
  const refreshed = await inspectEvmWallet({ ...options, refresh: true, now: "2026-09-04T12:11:00.000Z" });
  assert.equal(refreshed.source.delivery, "provider_live");
  assert.equal(source.urls.length, 8);
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
  assert.equal(result.profile.coverage.transactions_observed, 1);
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
    transaction_context_candidate_limit: 3,
    transaction_context_candidates_requested: 0,
    transaction_context_candidates_available: 0,
    transaction_context_candidates_unavailable: 0,
    raven_decoded_trade_transactions: 0,
    copy_eligible_transactions: 0,
  });
  assert.equal(result.profile.source_performance.realized_pnl_usdc, null);
  assert.equal(result.profile.source_performance.roi_pct, null);
  assert.equal(result.profile.capital_observations.native.amount, "1.25");
  assert.deepEqual(result.profile.provider_balance_summary, {
    visible_balance_rows: 1,
    visible_priced_rows: 1,
    visible_unpriced_rows: 0,
    visible_provider_mark_value_usd: "2.5025",
    largest_visible_provider_mark_symbol: "USDC",
    largest_visible_provider_mark_weight_pct: 100,
    visible_rows_only: true,
    all_assets_enumerated: null,
    executable_value_claimed: false,
    portfolio_value_claimed: false,
  });
  assert.equal(result.profile.positions.provider_reported_token_balances[0].balance_display, "2.5");
  assert.equal(result.profile.positions.provider_reported_token_balances[0].provider_mark_value_usd, "2.5025");
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
    if (url.includes(`/transactions/${TX}`)) return json({
      hash: TX,
      status: "ok",
      from: { hash: ADDRESS },
      to: { hash: OTHER },
      block_number: 1234,
      timestamp: "2026-09-04T12:00:00.000Z",
      confirmations: 24,
      method: "swapExactTokensForTokens",
      transaction_types: ["contract_call", "token_transfer"],
      actions: [{ type: "swap", protocol: "provider-label-only" }],
      token_transfers_overflow: false,
    });
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
  assert.equal(result.profile.provider_activity.transaction_context_candidates_available, 1);
  assert.equal(result.profile.provider_activity.raven_decoded_trade_transactions, 0);
  assert.equal(result.profile.data_quality.trade_decode_coverage_pct, null);
  assert.equal(result.profile.data_quality.transaction_context_coverage_pct, 100);
  assert.equal(result.profile.behavior.trade_count, null);
  assert.equal(result.transaction_decode_candidates.length, 1);
  assert.equal(result.transaction_decode_candidates[0].state, "swap_shaped_context_unverified");
  assert.equal(result.transaction_decode_candidates[0].provider_transaction.method, "swapExactTokensForTokens");
  assert.equal(result.transaction_decode_candidates[0].provider_transaction.wallet_is_sender, true);
  assert.equal(result.transaction_decode_candidates[0].wallet_transfer_shape.inbound_assets[0].contract, TOKEN);
  assert.equal(result.transaction_decode_candidates[0].wallet_transfer_shape.outbound_assets[0].contract, TOKEN_TWO);
  assert.equal(result.transaction_decode_candidates[0].interpretation.trade_claimed, false);
  assert.equal(result.transaction_decode_candidates[0].interpretation.copy_signal_created, false);
  assert.equal(result.source.request_count, 5);
  assert(result.activity.events.every((event) => event.copy_signal.eligible_buy_signal === false));
});

test("transaction context failure leaves the wallet scan available and the trade unresolved", async () => {
  const source = provider();
  const original = source.fetch;
  source.fetch = async (url) => {
    if (url.includes(`/transactions/${TX}`)) return json({ error: "temporarily unavailable" }, 503);
    if (!url.includes("/token-transfers?")) return original(url);
    return json({ items: [{
      block_hash: BLOCK,
      block_number: 1234,
      from: { hash: ADDRESS },
      to: { hash: OTHER },
      log_index: 7,
      timestamp: "2026-09-04T12:00:00.000Z",
      token: { address_hash: TOKEN, type: "ERC-20", decimals: "6", symbol: "USDC" },
      total: { decimals: "6", value: "2500000" },
      transaction_hash: TX,
    }, {
      block_hash: BLOCK,
      block_number: 1234,
      from: { hash: OTHER },
      to: { hash: ADDRESS },
      log_index: 8,
      timestamp: "2026-09-04T12:00:00.000Z",
      token: { address_hash: TOKEN_TWO, type: "ERC-20", decimals: "18", symbol: "TOKEN" },
      total: { decimals: "18", value: "1000000000000000000" },
      transaction_hash: TX,
    }], next_page_params: null });
  };
  const result = await inspectEvmWallet({
    chain: "ethereum",
    address: ADDRESS,
    env: { RAVENOS_EVM_WALLET_LOOKUP_ENABLED: "1", BLOCKSCOUT_API_KEY: KEY },
    fetchImpl: source.fetch,
    now: "2026-09-04T12:01:00.000Z",
  });
  assert.equal(result.ok, true);
  assert.equal(result.transaction_decode_candidates[0].state, "provider_context_unavailable");
  assert.equal(result.transaction_decode_candidates[0].context_available, false);
  assert.equal(result.transaction_decode_candidates[0].interpretation.raven_trade_classification, "unresolved");
  assert.equal(result.profile.provider_activity.transaction_context_candidates_unavailable, 1);
  assert.equal(result.profile.provider_activity.raven_decoded_trade_transactions, 0);
  assert.equal(result.profile.behavior.trade_count, null);
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

test("authenticated EVM inspection retains a shared profile without enrolling Copy", async () => {
  const source = provider();
  const db = sqliteStore();
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
    RAVENOS_CUSTOMER_DB: db,
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
    walletCopyStore: createD1CustomerWalletCopyStore(db),
    fetchImpl: source.fetch,
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.profile.source_wallet.chain, "bsc");
  assert.equal(payload.profile.source_wallet.chain_id, 56);
  assert.equal(payload.persistence.state, "shared_raven_profile");
  assert.equal(payload.profile.behavior.trade_count, null);
  assert.equal(payload.profile.source_performance.realized_pnl_usdc, null);
  assert(!JSON.stringify(payload).includes(KEY));
});

test('durable EVM profiles are reused across sessions and preserve unknown P&L',async()=>{
 const {inspectRetainedEvmWallet}=await import('../lib/customer_trade/retained_evm_wallet.mjs');
 const db=sqliteStore(),store=createD1CustomerWalletCopyStore(db),source=provider();
 const now=Math.floor(Date.parse('2026-09-04T12:01:00Z')/1000);
 const input={chain:'base',address:ADDRESS,env:{RAVENOS_EVM_WALLET_LOOKUP_ENABLED:'1',BLOCKSCOUT_API_KEY:KEY},fetchImpl:source.fetch,now:new Date(now*1000).toISOString()};
 const first=await inspectRetainedEvmWallet(input,{store,db,now});
 const next=await inspectRetainedEvmWallet(input,{store:createD1CustomerWalletCopyStore(db),db,now:now+60});
 assert.equal(source.urls.length,4);assert.equal(next.provider_request_performed,false);assert.equal(next.source.delivery,'shared_profile_cache');assert.equal(next.profile.generated_at,first.profile.generated_at);assert.equal(next.profile.source_performance.realized_pnl_usdc,null);
 assert.equal(db.raw.prepare('SELECT count(*) n FROM ravenos_source_wallet_profiles').get().n,1);
 assert.equal(db.raw.prepare('SELECT count(*) n FROM ravenos_customer_wallet_copy_watches').get().n,0);
 const seen=await store.listSeenWallets({chain:'base',page_size:12,offset:0});
 // Direct lookup sources acquire a timestamp through public market ingestion;
 // cache reuse does not invent a market observation.
 assert.equal(seen.total,0);
 const fallback=await inspectRetainedEvmWallet({...input,refresh:true},{store,db,now:now+601,lookup:async()=>{throw Error('provider_down')}});
 assert.equal(fallback.freshness.state,'retained_provider_unavailable');assert.equal(fallback.freshness.current_balance_claimed,false);assert.equal(fallback.profile.generated_at,first.profile.generated_at);
 assert(!JSON.stringify(fallback).includes(KEY));
 assert.throws(()=>db.raw.exec("UPDATE ravenos_source_wallet_profiles SET profile_json='{}'"),/append_only/);
});

test('a distributed cold EVM lookup lease prevents simultaneous provider requests',async()=>{
 const {inspectRetainedEvmWallet}=await import('../lib/customer_trade/retained_evm_wallet.mjs');
 const {normalizeSourceWalletChainIdentity}=await import('../lib/customer_trade/source_wallet_chain_identity.mjs');
 const db=sqliteStore(),store=createD1CustomerWalletCopyStore(db);const now=1788523260;
 const id=normalizeSourceWalletChainIdentity({chain:'base',network:'mainnet',address:ADDRESS});
 db.raw.prepare('INSERT INTO ravenos_wallet_lookup_leases VALUES (?,?,?)').run(id.source_wallet_id,'active-test',now+60);
 let calls=0;await assert.rejects(inspectRetainedEvmWallet({chain:'base',address:ADDRESS},{store,db,now,lookup:async()=>{calls++;}}),/wallet_analysis_in_progress/);assert.equal(calls,0);
});

test('saved research reopens exact-chain EVM snapshots without new provider calls and filters retained activity', async () => {
  const { inspectRetainedEvmWallet } = await import('../lib/customer_trade/retained_evm_wallet.mjs');
  const db = sqliteStore(), store = createD1CustomerWalletCopyStore(db), source = provider();
  const now = 1788523260, userId = `usr_${'e'.repeat(32)}`;
  db.raw.prepare("INSERT INTO ravenos_users (user_id,state,primary_email,created_at,updated_at,last_authenticated_at) VALUES (?,'active','cached@example.test',?,?,?)").run(userId,now,now,now);
  const env = { RAVENOS_CUSTOMER_DB: db, RAVENOS_ENTITLEMENT_RESOLUTION_ENABLE:'1', RAVENOS_WALLET_INTELLIGENCE_ENABLED:'1', RAVENOS_WALLET_COPY_ROUTES_ENABLED:'1', RAVENOS_WALLET_SCREENER_ENABLED:'1', RAVENOS_EVM_WALLET_LOOKUP_ENABLED:'1', BLOCKSCOUT_API_KEY:KEY };
  const deps = { walletCopyStore:store, entitlementStore:{async listOwnedGrants(){return [];}},
    authorizeRequest:async()=>({principal:{user_id:userId},now,response_headers:new Headers()}), consumeRateLimit:async()=>({allowed:true}),
    fetchImpl:async()=>{throw Error('cached_navigation_must_not_call_provider');} };
  const call = async(path,method='GET',body,overrides={}) => {
    const r = await routeCustomerWalletCopy(new Request('https://app.ravenos.xyz/api/v1/wallet-copy'+path,{method,headers:{origin:'https://app.ravenos.xyz','sec-fetch-site':'same-origin','content-type':'application/json'},body:body?JSON.stringify(body):undefined}),env,{...deps,...overrides});
    return { status:r?.status,payload:await r?.json() };
  };
  for(const chain of ['robinhood','base','ethereum','bsc']) {
    const lookup = await inspectRetainedEvmWallet({chain,address:ADDRESS,env,fetchImpl:source.fetch,now:new Date(now*1000).toISOString()},{store,db,now});
    const id = lookup.source_wallet_id, calls = source.urls.length;
    const saved = await call('/saved-wallets','POST',{source_wallet_id:id,list_name:'Research',label:chain});
    assert.equal(saved.status,201,JSON.stringify(saved.payload));
    assert.equal(saved.payload.save.analysis.state,'available');
    assert.equal(saved.payload.save.source_wallet.chain,chain);
    const opened = await call('/wallets/'+id);
    assert.equal(opened.status,200,JSON.stringify(opened.payload));
    assert.equal(opened.payload.profile.source_wallet.chain,chain);
    assert.equal(opened.payload.provider_request_performed,false);
    assert.equal(opened.payload.activity.scope.provider_request_performed,false);
    assert.equal(opened.payload.profile.retained_lookup,undefined);
    assert.deepEqual(opened.payload.transaction_decode_candidates,lookup.transaction_decode_candidates);
    assert.equal(source.urls.length,calls);
    assert.equal((await call('/wallets/'+id+'/events?filter=trades')).payload.events.length,0);
    const events = await call('/wallets/'+id+'/events?filter=transfers&limit=1');
    assert.equal(events.status,200);assert.equal(events.payload.events.length,1);
    assert.equal(events.payload.events[0].source_wallet.chain,chain);
    const wrong = await call('/wallets/'+id,'GET',undefined,{walletCopyStore:{...store,latestProfile:async()=>({...lookup.profile,source_wallet:{...lookup.profile.source_wallet,chain:chain==='base'?'ethereum':'base'}})}});
    assert.equal(wrong.payload.error,'wallet_profile_identity_mismatch');
    const foreign = await call('/saved-wallets','GET',undefined,{authorizeRequest:async()=>({principal:{user_id:`usr_${'f'.repeat(32)}`},now,response_headers:new Headers()})});
    assert.equal(foreign.payload.saves.length,0);
  }
  assert.equal((await call('/saved-wallets')).payload.saves.length,4);
  assert.equal(db.raw.prepare('SELECT count(*) n FROM ravenos_customer_wallet_copy_watches').get().n,0);
});
