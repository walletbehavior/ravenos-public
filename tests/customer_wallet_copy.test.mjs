import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import bs58 from "bs58";

import {
  SOLANA_CANONICAL_USDC_MINT,
  normalizeSolanaWalletTransaction,
} from "../lib/customer_trade/solana_wallet_intelligence.mjs";
import {
  CustomerWalletCopyContract,
  resolveWalletCopyActivation,
  routeCustomerWalletCopy,
} from "../lib/customer_wallet_copy.mjs";

const APP = "https://app.ravenos.xyz";
const NOW = Math.floor(Date.parse("2026-08-29T12:00:03.000Z") / 1_000);
const USER = `usr_${"u".repeat(32)}`;
const WALLET = bs58.encode(Buffer.alloc(32, 23));
const TOKEN = bs58.encode(Buffer.alloc(32, 29));

function walletEvent({ signature = "a".repeat(88), slot = 100, blockTime = NOW - 2, mode = "historical_backfill" } = {}) {
  const received = new Date((blockTime * 1_000) + 1_000).toISOString();
  return normalizeSolanaWalletTransaction({
    wallet_address: WALLET,
    signature,
    transaction: {
      slot,
      blockTime,
      transaction: { message: { accountKeys: [{ pubkey: WALLET, signer: true }], instructions: [{ programId: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4" }] } },
      meta: {
        err: null,
        fee: 5_000,
        preBalances: [1_000_000_000],
        postBalances: [999_995_000],
        preTokenBalances: [
          { owner: WALLET, mint: SOLANA_CANONICAL_USDC_MINT, uiTokenAmount: { amount: "100000000", decimals: 6 } },
          { owner: WALLET, mint: TOKEN, uiTokenAmount: { amount: "0", decimals: 6 } },
        ],
        postTokenBalances: [
          { owner: WALLET, mint: SOLANA_CANONICAL_USDC_MINT, uiTokenAmount: { amount: "75000000", decimals: 6 } },
          { owner: WALLET, mint: TOKEN, uiTokenAmount: { amount: "10000000", decimals: 6 } },
        ],
        innerInstructions: [],
        logMessages: ["Program log: Instruction: Route"],
      },
    },
    provider: "fixture_rpc",
    finality: "confirmed",
    observation_mode: mode,
    received_at: received,
    decode_started_at: received,
    decoded_at: received,
    observed_at: received,
  });
}

function env(overrides = {}) {
  return {
    RAVENOS_ENTITLEMENT_RESOLUTION_ENABLE: "1",
    RAVENOS_WALLET_INTELLIGENCE_ENABLED: "1",
    RAVENOS_WALLET_COPY_ROUTES_ENABLED: "1",
    RAVENOS_SHADOW_COPY_ENABLED: "1",
    RAVENOS_WALLET_SCREENER_ENABLED: "0",
    RAVENOS_LIVE_COPY_ENABLED: "1",
    RAVENOS_COPY_FEE_COLLECTION_ENABLED: "1",
    ...overrides,
  };
}

function authorized() {
  return async () => ({
    principal: { user_id: USER, session_public_id: "ses_test", authenticated_at: NOW - 60 },
    store: {},
    now: NOW,
    response_headers: new Headers({ "x-ravenos-session": "authenticated" }),
  });
}

function request(path, { method = "GET", body = null, origin = APP, suppliedOrigin = APP } = {}) {
  const headers = new Headers({ accept: "application/json", "sec-fetch-site": "same-origin", origin: suppliedOrigin, referer: `${APP}/account/copy/` });
  if (body !== null) headers.set("content-type", "application/json");
  return new Request(`${origin}${path}`, { method, headers, body: body === null ? undefined : JSON.stringify(body) });
}

function memoryStore() {
  const sources = new Map();
  const events = new Map();
  const profiles = new Map();
  const watches = new Map();
  const decisions = [];
  const positions = [];
  const sourceRow = (id) => sources.get(id);
  const watchRow = (row) => ({ ...row, ...(sourceRow(row.source_wallet_id) || {}) });
  return {
    sources,
    events,
    profiles,
    watches,
    decisions,
    positions,
    async upsertSourceWallet({ source_wallet_id, address, now, state }) {
      const existing = sources.get(source_wallet_id) || {};
      const row = { ...existing, source_wallet_id, address, observation_state: state, first_requested_at: existing.first_requested_at || now, last_observed_at: existing.last_observed_at || null, last_signature: existing.last_signature || null, updated_at: now };
      sources.set(source_wallet_id, row);
      return row;
    },
    async updateSourceCursor(id, { state, last_observed_at, last_signature, now }) {
      const row = sources.get(id);
      Object.assign(row, { observation_state: state, last_observed_at, last_signature, updated_at: now });
    },
    async recordEvents(id, rows) {
      const inserted = [];
      for (const row of rows) if (!events.has(row.event_id)) { events.set(row.event_id, { id, row }); inserted.push(row.event_id); }
      return inserted;
    },
    async listSourceEvents(id) { return [...events.values()].filter((row) => row.id === id).map((row) => row.row); },
    async recordProfile(id, profile) { profiles.set(id, profile); return `profile_${id}`; },
    async latestProfile(id) { return profiles.get(id) || null; },
    async countWatches(userId) { return [...watches.values()].filter((row) => row.user_id === userId).length; },
    async createWatch(record) {
      const row = { ...record, copy_mode: record.policy.mode, policy_version: record.policy.policy_version, policy_hash: record.policy.policy_hash, policy_json: JSON.stringify(record.policy), state: "active", cursor_signature: null, cursor_slot: null, backfill_complete: 0, created_at: record.now, updated_at: record.now, revision: 1 };
      watches.set(record.watch_id, row);
      return watchRow(row);
    },
    async listWatches(userId) { return [...watches.values()].filter((row) => row.user_id === userId).map(watchRow); },
    async getWatchOwned(userId, watchId) { const row = watches.get(watchId); return row?.user_id === userId ? watchRow(row) : null; },
    async updateWatch() { throw new Error("not_needed"); },
    async advanceWatchCursor(userId, watchId, { signature, slot, backfill_complete, now }) {
      const row = watches.get(watchId);
      if (!row || row.user_id !== userId) return false;
      Object.assign(row, { cursor_signature: signature, cursor_slot: slot, backfill_complete: backfill_complete ? 1 : 0, updated_at: now, revision: row.revision + 1 });
      return true;
    },
    async deleteWatch(userId, watchId) { return watches.get(watchId)?.user_id === userId && watches.delete(watchId) ? 1 : 0; },
    async recordDecision(userId, decision) { if (!decisions.some((row) => row.decision_id === decision.decision_id)) decisions.push({ ...decision, _owner: userId }); return true; },
    async recordPosition(userId, position) { if (!positions.some((row) => row.position_id === position.position_id)) positions.push({ ...position, _owner: userId }); return true; },
    async listDecisions(userId) { return decisions.filter((row) => row._owner === userId).map(({ _owner, ...row }) => row); },
    async listPositions(userId) { return positions.filter((row) => row._owner === userId).map(({ _owner, ...row }) => row); },
  };
}

function deps(store, provider, grantRows = [{
  grant_id: `ent_${"g".repeat(32)}`,
  user_id: USER,
  capability_key: "wallet.copy",
  state: "active",
  activation_at: NOW - 60,
  expires_at: NOW + 3600,
  revision: 1,
}]) {
  return {
    authorizeRequest: authorized(),
    entitlementStore: { async listOwnedGrants() { return grantRows; } },
    consumeRateLimit: async () => ({ allowed: true, retry_after_seconds: 0 }),
    walletCopyStore: store,
    walletProvider: provider,
  };
}

async function json(response) { return JSON.parse(await response.text()); }

test("wallet-copy activation is entitlement-coordinated and source-level live authority stays off", () => {
  assert.equal(resolveWalletCopyActivation({}).wallet_intelligence, false);
  const active = resolveWalletCopyActivation(env());
  assert.equal(active.wallet_intelligence, true);
  assert.equal(active.shadow_copy, true);
  assert.equal(active.wallet_screener, false);
  assert.equal(active.live_copy_requested, true);
  assert.equal(active.fee_collection_requested, true);
  assert.equal(active.live_copy, false);
  assert.equal(active.fee_collection, false);
  assert.equal(active.continuous_observer, false);
  assert.equal(CustomerWalletCopyContract.source_level_disabled.broadcasting, true);
});

test("wallet-copy migration shares source evidence, isolates subscribers, and preserves append-only decisions", () => {
  const sql = readFileSync("customer-migrations/0007_customer_wallet_copy.sql", "utf8");
  assert.match(sql, /'wallet\.copy'/);
  assert.match(sql, /CREATE TABLE ravenos_source_wallets/i);
  assert.match(sql, /UNIQUE \(chain, network, address\)/i);
  assert.match(sql, /CREATE TABLE ravenos_source_wallet_event_finality_observations/i);
  assert.match(sql, /CREATE TRIGGER ravenos_source_wallet_events_append_only/i);
  assert.match(sql, /CREATE TABLE ravenos_customer_wallet_copy_watches/i);
  assert.match(sql, /REFERENCES ravenos_users\(user_id\) ON DELETE CASCADE/i);
  assert.match(sql, /CREATE TRIGGER ravenos_customer_shadow_copy_decisions_append_only/i);
  assert.match(sql, /live_execution_authorized INTEGER NOT NULL DEFAULT 0 CHECK \(live_execution_authorized = 0\)/i);
  assert.match(sql, /transaction_hash TEXT CHECK \(transaction_hash IS NULL\)/i);
  assert.doesNotMatch(sql, /private_key|seed_phrase|signer_material|raw_provider_payload/i);
});

test("authenticated Pro route rejects cross-origin and unentitled access", async () => {
  const store = memoryStore();
  const provider = { async loadHistory() { return { events: [walletEvent()] }; } };
  const cross = await routeCustomerWalletCopy(request("/api/v1/wallet-copy", { suppliedOrigin: "https://evil.example" }), env(), deps(store, provider));
  assert.equal(cross.status, 403);
  const denied = await routeCustomerWalletCopy(request("/api/v1/wallet-copy"), env(), deps(store, provider, []));
  assert.equal(denied.status, 403);
  assert.equal((await json(denied)).error, "capability_not_authorized");
});

test("inspect builds evidence-bound source performance without creating a watch", async () => {
  const store = memoryStore();
  const provider = { async loadHistory() { return { events: [walletEvent()] }; } };
  const response = await routeCustomerWalletCopy(request("/api/v1/wallet-copy/inspect", { method: "POST", body: { address: WALLET } }), env(), deps(store, provider));
  const payload = await json(response);
  assert.equal(response.status, 200);
  assert.equal(payload.profile.source_wallet.address, WALLET);
  assert.equal(payload.profile.coverage.transactions_observed, 1);
  assert.equal(payload.profile.source_performance.realized_pnl_usdc, null);
  assert.equal(store.watches.size, 0);
});

test("first refresh establishes a baseline and only a later source trade can produce a shadow decision", async () => {
  const baseline = walletEvent({ signature: "b".repeat(88), slot: 100, blockTime: NOW - 10, mode: "historical_backfill" });
  const prospective = walletEvent({ signature: "c".repeat(88), slot: 101, blockTime: NOW - 2, mode: "prospective" });
  let refresh = 0;
  const provider = {
    async loadHistory({ observation_mode }) {
      if (observation_mode === "historical_backfill") return { events: [baseline] };
      refresh += 1;
      return { events: [prospective, baseline] };
    },
    async quoteCopySignal() {
      return {
        source_notional_usdc: 25,
        source_notional_basis: "source_wallet_canonical_usdc_delta",
        liquidity_usd: 250_000,
        asset_evidence: { identity_resolved: true, token_standard: "spl", token_standard_resolved: true, sell_simulation_state: "passed", reverse_sell_quote_state: "available", freeze_authority_present: false, mint_authority_present: false, transfer_fee_detected: false },
        entry: { state: "available", quote_id: "entry", provider: "jupiter", requested_at: "2026-08-29T12:00:01.000Z", quoted_at: "2026-08-29T12:00:01.100Z", received_at: "2026-08-29T12:00:01.200Z", expires_at: "2026-08-29T12:00:16.100Z", expected_output: 39.5, minimum_output: 39.1, price_impact_bps: 50, latency_ms: 200, exact_asset_identity: true },
        exit: { state: "available", quote_id: "exit", provider: "jupiter", requested_at: "2026-08-29T12:00:01.200Z", quoted_at: "2026-08-29T12:00:01.300Z", received_at: "2026-08-29T12:00:01.400Z", expires_at: "2026-08-29T12:00:16.300Z", expected_output: 97.5, minimum_output: 97, price_impact_bps: 55, latency_ms: 200, exact_asset_identity: true },
      };
    },
  };
  const store = memoryStore();
  const d = deps(store, provider);
  const createdResponse = await routeCustomerWalletCopy(request("/api/v1/wallet-copy/watches", { method: "POST", body: { address: WALLET, label: "Test source", policy: { sizing: { fixed_usdc: 100 }, hypothetical_raven_fee_bps: 10 } } }), env(), d);
  const created = await json(createdResponse);
  assert.equal(createdResponse.status, 201);
  const path = `/api/v1/wallet-copy/watches/${created.watch.watch_id}/refresh`;
  const first = await routeCustomerWalletCopy(request(path, { method: "POST", body: {} }), env(), d);
  const firstPayload = await json(first);
  assert.equal(firstPayload.state, "baseline_established");
  assert.equal(firstPayload.decisions.length, 0);
  assert.equal(store.decisions.length, 0);
  const second = await routeCustomerWalletCopy(request(path, { method: "POST", body: {} }), env(), d);
  const secondPayload = await json(second);
  assert.equal(secondPayload.state, "refreshed");
  assert.equal(secondPayload.prospective_events_observed, 1);
  assert.equal(secondPayload.decisions[0].decision.state, "SHADOW_EXECUTABLE");
  assert.equal(secondPayload.decisions[0].execution_boundary.transaction_hash, null);
  assert.equal(store.decisions.length, 1);
  assert.equal(store.positions.length, 1);
  assert.equal(store.positions[0].live_assets_held, false);
  assert.equal(refresh, 1);
});
