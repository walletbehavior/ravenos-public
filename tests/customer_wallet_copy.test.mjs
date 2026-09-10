import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import bs58 from "bs58";

import {
  SOLANA_CANONICAL_USDC_MINT,
  normalizeSolanaWalletTransaction,
} from "../lib/customer_trade/solana_wallet_intelligence.mjs";
import { createSourceWalletBackfillJob } from "../lib/customer_trade/source_wallet_backfill.mjs";
import { createSourceWalletId } from "../lib/customer_trade/source_wallet_chain_identity.mjs";
import { PUBLIC_WALLET_SNAPSHOT_SCHEMA } from '../lib/customer_trade/wallet_public_cards.mjs';
import { applyShadowCopyExitHistory } from "../lib/customer_trade/wallet_copy.mjs";
import { walletUsdTradingRecord } from '../lib/customer_trade/wallet_historical_prices.mjs';
import {
  CustomerWalletCopyContract,
  createD1CustomerWalletCopyStore,
  persistSourceWalletProfile,
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

function walletSellEvent({ signature = "s".repeat(88), slot = 102, blockTime = NOW - 1, sold = 4_000_000, before = 10_000_000 } = {}) {
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
        preBalances: [999_995_000],
        postBalances: [999_990_000],
        preTokenBalances: [
          { owner: WALLET, mint: SOLANA_CANONICAL_USDC_MINT, uiTokenAmount: { amount: "75000000", decimals: 6 } },
          { owner: WALLET, mint: TOKEN, uiTokenAmount: { amount: String(before), decimals: 6 } },
        ],
        postTokenBalances: [
          { owner: WALLET, mint: SOLANA_CANONICAL_USDC_MINT, uiTokenAmount: { amount: "87000000", decimals: 6 } },
          { owner: WALLET, mint: TOKEN, uiTokenAmount: { amount: String(before - sold), decimals: 6 } },
        ],
        innerInstructions: [],
        logMessages: ["Program log: Instruction: Route"],
      },
    },
    provider: "fixture_nexus_hydration",
    finality: "confirmed",
    observation_mode: "prospective",
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
  const researchSaves = new Map();
  const watches = new Map();
  const decisions = [];
  const exitDecisions = [];
  const positions = [];
  const sourceRow = (id) => sources.get(id);
  const watchRow = (row) => ({ ...row, ...(sourceRow(row.source_wallet_id) || {}) });
  return {
    sources,
    events,
    profiles,
    researchSaves,
    watches,
    decisions,
    exitDecisions,
    positions,
    async upsertSourceWallet({ source_wallet_id, chain = "solana", network = "mainnet", chain_id = "solana", address, now, state }) {
      const existing = sources.get(source_wallet_id) || {};
      const row = { ...existing, source_wallet_id, chain, network, chain_id, vm_family: chain === "robinhood" ? "evm" : "svm", address, observation_state: state, first_requested_at: existing.first_requested_at || now, last_observed_at: existing.last_observed_at || null, last_signature: existing.last_signature || null, updated_at: now };
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
    async listSourceEventPage(id, { kinds = null, limit = 12, cursor = null } = {}) {
      const matching = [...events.values()]
        .filter((entry) => entry.id === id && (!Array.isArray(kinds) || kinds.includes(entry.row.classification.kind)))
        .map((entry) => ({
          row: entry.row,
          order_time: Math.floor(Date.parse(entry.row.chain_evidence.block_time || entry.row.timing.raven_received_at) / 1_000),
        }))
        .sort((left, right) => right.order_time - left.order_time || right.row.event_id.localeCompare(left.row.event_id));
      const after = cursor
        ? matching.filter((entry) => entry.order_time < cursor.order_time || (entry.order_time === cursor.order_time && entry.row.event_id < cursor.event_id))
        : matching;
      const visible = after.slice(0, limit);
      const last = visible.at(-1);
      return {
        events: visible.map((entry) => entry.row),
        matching_event_count: matching.length,
        has_more: after.length > limit,
        next_cursor: after.length > limit && last ? `${last.order_time}~${last.row.event_id}` : null,
      };
    },
    async recordProfile(id, profile) { profiles.set(id, profile); return `swp_${"p".repeat(40)}`; },
    async latestProfile(id) { return profiles.get(id) || null; },
    async getSourceWallet(id) { return sources.get(id) || null; },
    async screenSourceWallets(query) {
      const rows = [...profiles.entries()].map(([id, profile]) => ({
        source_wallet_id: id,
        address: sources.get(id)?.address,
        profile_snapshot_id: `swp_${"b".repeat(40)}`,
        profile_version: profile.profile_version,
        generated_at: NOW,
        first_trade_at: Math.floor(Date.parse(profile.behavior.first_trade_at || profile.coverage.first_observed_at) / 1_000),
        last_trade_at: Math.floor(Date.parse(profile.behavior.last_trade_at || profile.coverage.last_observed_at) / 1_000),
        trade_count: profile.behavior.trade_count,
        active_days: profile.behavior.active_days,
        token_count: profile.behavior.tokens_traded,
        known_cost_basis_pct: profile.coverage.known_cost_basis_pct,
        performance_state: profile.source_performance.state,
        realized_pnl_usdc: profile.source_performance.realized_pnl_usdc,
        realized_pnl_sol: profile.source_performance.realized_pnl_sol,
        roi_pct: profile.source_performance.roi_pct,
        win_rate_pct: profile.source_performance.win_rate_pct,
        closed_lots: profile.source_performance.closed_lots,
        median_hold_seconds: profile.behavior.median_hold_seconds,
        profit_factor: profile.source_performance.profit_factor,
        average_trade_roi_pct: profile.source_performance.by_basis?.usdc?.average_trade_roi_pct ?? profile.source_performance.by_basis?.sol?.average_trade_roi_pct ?? null,
        median_trade_roi_pct: profile.source_performance.by_basis?.usdc?.median_trade_roi_pct ?? profile.source_performance.by_basis?.sol?.median_trade_roi_pct ?? null,
        top_1_profit_concentration_pct: profile.profit_quality?.by_basis?.usdc?.top_1_profit_concentration_pct ?? profile.profit_quality?.by_basis?.sol?.top_1_profit_concentration_pct ?? null,
        top_5_profit_concentration_pct: profile.profit_quality?.by_basis?.usdc?.top_5_profit_concentration_pct ?? profile.profit_quality?.by_basis?.sol?.top_5_profit_concentration_pct ?? null,
        reconstruction_confidence_pct: profile.data_quality?.reconstruction_confidence_pct,
        trade_decode_coverage_pct: profile.data_quality?.trade_decode_coverage_pct,
        classification_coverage_pct: profile.data_quality?.classification_coverage_pct,
        provider_history_exhausted: profile.data_quality?.provider_history_exhausted ? 1 : 0,
        source_history_complete: profile.data_quality?.history_complete ? 1 : 0,
      }));
      return { rows: rows.slice(query.offset, query.offset + query.page_size), total: rows.length };
    },
    async countResearchSaves(userId) { return [...researchSaves.values()].filter((row) => row.user_id === userId).length; },
    async countResearchLists(userId) { return new Set([...researchSaves.values()].filter((row) => row.user_id === userId).map((row) => row.list_name.toLowerCase())).size; },
    async listResearchSaves(userId) { return [...researchSaves.values()].filter((row) => row.user_id === userId).map((row) => { const source = sources.get(row.source_wallet_id) || {}; return { ...row, chain: source.chain, network: source.network, chain_id: source.chain_id, vm_family: source.vm_family, address: source.address }; }); },
    async saveResearchWallet(record) {
      const duplicate = [...researchSaves.values()].find((row) => row.user_id === record.user_id && row.source_wallet_id === record.source_wallet_id && row.list_name.toLowerCase() === record.list_name.toLowerCase());
      if (duplicate) { const source = sources.get(duplicate.source_wallet_id) || {}; return { ...duplicate, chain: source.chain, network: source.network, chain_id: source.chain_id, vm_family: source.vm_family, address: source.address }; }
      const row = { ...record, created_at: record.now, updated_at: record.now, revision: 1 };
      researchSaves.set(record.save_id, row);
      { const source = sources.get(row.source_wallet_id) || {}; return { ...row, chain: source.chain, network: source.network, chain_id: source.chain_id, vm_family: source.vm_family, address: source.address }; }
    },
    async deleteResearchSave(userId, saveId) {
      const row = researchSaves.get(saveId);
      return row?.user_id === userId && researchSaves.delete(saveId) ? 1 : 0;
    },
    async countWatches(userId) { return [...watches.values()].filter((row) => row.user_id === userId).length; },
    async createWatch(record) {
      const row = { ...record, copy_mode: record.policy.mode, policy_version: record.policy.policy_version, policy_hash: record.policy.policy_hash, policy_json: JSON.stringify(record.policy), state: "active", cursor_signature: null, cursor_slot: null, backfill_complete: 0, created_at: record.now, updated_at: record.now, revision: 1 };
      watches.set(record.watch_id, row);
      return watchRow(row);
    },
    async listWatches(userId) { return [...watches.values()].filter((row) => row.user_id === userId).map(watchRow); },
    async getWatchOwned(userId, watchId) { const row = watches.get(watchId); return row?.user_id === userId ? watchRow(row) : null; },
    async updateWatch(userId, id, update) {
      const row=watches.get(id); if (!row || row.user_id!==userId || row.revision!==update.expected_revision) return null;
      Object.assign(row,{state:update.state,label:update.label,policy_json:JSON.stringify(update.policy),revision:row.revision+1,updated_at:update.now});return watchRow(row);
    },
    async advanceWatchCursor(userId, watchId, { signature, slot, backfill_complete, now }) {
      const row = watches.get(watchId);
      if (!row || row.user_id !== userId) return false;
      Object.assign(row, { cursor_signature: signature, cursor_slot: slot, backfill_complete: backfill_complete ? 1 : 0, updated_at: now, revision: row.revision + 1 });
      return true;
    },
    async deleteWatch(userId, watchId) { return watches.get(watchId)?.user_id === userId && watches.delete(watchId) ? 1 : 0; },
    async recordDecision(userId, decision) { if (!decisions.some((row) => row.decision_id === decision.decision_id)) decisions.push({ ...decision, _owner: userId }); return true; },
    async recordPosition(userId, position) { if (!positions.some((row) => row.position_id === position.position_id)) positions.push({ ...position, _owner: userId }); return true; },
    async listMappedPositionsForWatch(userId, watchId, assetMint) {
      const exits = exitDecisions.filter((row) => row._owner === userId).map(({ _owner, ...row }) => row);
      return positions.filter((row) => row._owner === userId && row.watch_id === watchId && row.destination_asset.mint === assetMint)
        .map(({ _owner, ...row }) => applyShadowCopyExitHistory(row, exits))
        .filter((row) => row.state !== "SHADOW_CLOSED");
    },
    async recordExitDecision(userId, decision) {
      if (exitDecisions.some((row) => row.exit_decision_id === decision.exit_decision_id)) return false;
      exitDecisions.push({ ...decision, _owner: userId });
      return true;
    },
    async listDecisions(userId) { return decisions.filter((row) => row._owner === userId).map(({ _owner, ...row }) => row); },
    async listExitDecisions(userId) { return exitDecisions.filter((row) => row._owner === userId).map(({ _owner, ...row }) => row); },
    async listPositions(userId) {
      const exits = exitDecisions.filter((row) => row._owner === userId).map(({ _owner, ...row }) => row);
      return positions.filter((row) => row._owner === userId).map(({ _owner, ...row }) => applyShadowCopyExitHistory(row, exits));
    },
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
  const observer = resolveWalletCopyActivation(env({
    RAVENOS_WALLET_OBSERVER_ENABLED: "1",
    RAVENOS_WALLET_OBSERVER_EVALUATOR_ENABLED: "1",
    RAVENOS_WALLET_RPC_POLL_ENABLED: "1",
  }));
  assert.equal(observer.continuous_observer, true);
  assert.equal(observer.observer_ingest, true);
  assert.equal(observer.scheduler, true);
  assert.equal(observer.monitoring_mode, "bounded_rpc_poll");
  assert.equal(observer.observer_transport, "bounded_rpc_poll");
  assert.equal(observer.observer_interval_seconds, 300);
  assert.equal(observer.live_copy, false);
  assert.equal(observer.fee_collection, false);
});

test("wallet-copy migration shares source evidence, isolates subscribers, and preserves append-only decisions", () => {
  const sql = readFileSync("customer-migrations/0007_customer_wallet_copy.sql", "utf8");
  const screenerSql = readFileSync("customer-migrations/0008_customer_wallet_screener.sql", "utf8");
  const depthSql = readFileSync("customer-migrations/0009_customer_wallet_screener_depth.sql", "utf8");
  const exitsSql = readFileSync("customer-migrations/0012_shadow_copy_source_exits.sql", "utf8");
  const chainNeutralSql = readFileSync("customer-migrations/0023_source_wallet_chain_neutral.sql", "utf8");
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
  assert.match(screenerSql, /CREATE TABLE ravenos_source_wallet_current_profiles/i);
  assert.match(screenerSql, /REFERENCES ravenos_source_wallet_profiles\(profile_snapshot_id\) ON DELETE CASCADE/i);
  assert.match(screenerSql, /performance_state TEXT NOT NULL CHECK/i);
  assert.match(screenerSql, /WHERE NOT EXISTS/i);
  assert.doesNotMatch(screenerSql, /user_id|private_key|seed_phrase|signer_material|raw_provider_payload/i);
  assert.match(depthSql, /profit_factor REAL/i);
  assert.match(depthSql, /reconstruction_confidence_pct REAL/i);
  assert.match(depthSql, /provider_history_exhausted/i);
  assert.match(depthSql, /CREATE TABLE ravenos_customer_wallet_research_saves/i);
  assert.match(depthSql, /user_id TEXT NOT NULL REFERENCES ravenos_users\(user_id\) ON DELETE CASCADE/i);
  assert.match(depthSql, /source_wallet_id TEXT NOT NULL REFERENCES ravenos_source_wallets\(source_wallet_id\) ON DELETE CASCADE/i);
  assert.match(depthSql, /list_name TEXT NOT NULL COLLATE NOCASE/i);
  assert.match(depthSql, /UNIQUE \(user_id, source_wallet_id, list_name\)/i);
  assert.doesNotMatch(depthSql, /private_key|seed_phrase|signer_material|raw_provider_payload/i);
  assert.match(exitsSql, /CREATE TABLE ravenos_customer_shadow_copy_exit_decisions/i);
  assert.match(exitsSql, /IGNORED_PRE_SUBSCRIPTION_INVENTORY/i);
  assert.match(exitsSql, /CREATE TABLE ravenos_customer_shadow_copy_exit_allocations/i);
  assert.match(exitsSql, /CREATE TRIGGER ravenos_shadow_copy_exit_decisions_append_only/i);
  assert.match(exitsSql, /live_execution_authorized INTEGER NOT NULL DEFAULT 0 CHECK \(live_execution_authorized = 0\)/i);
  assert.match(exitsSql, /transaction_hash TEXT CHECK \(transaction_hash IS NULL\)/i);
  assert.doesNotMatch(exitsSql, /private_key|seed_phrase|signer_material|raw_provider_payload/i);
  assert.match(chainNeutralSql, /chain TEXT NOT NULL CHECK \(chain IN \('solana', 'robinhood'\)\)/i);
  assert.match(chainNeutralSql, /transaction_reference TEXT NOT NULL/i);
  assert.match(chainNeutralSql, /last_transaction_reference TEXT/i);
  assert.match(chainNeutralSql, /PRAGMA defer_foreign_keys = ON/i);
  assert.match(chainNeutralSql, /CREATE TABLE ravenos_source_wallets_m0023_new/i);
  assert.match(chainNeutralSql, /CREATE TABLE ravenos_m0023_source_wallet_profiles AS SELECT \* FROM ravenos_source_wallet_profiles/i);
  assert.match(chainNeutralSql, /DROP TABLE ravenos_source_wallets;[\s\S]*ALTER TABLE ravenos_source_wallets_m0023_new RENAME TO ravenos_source_wallets/i);
  assert.doesNotMatch(chainNeutralSql, /ALTER TABLE ravenos_source_wallets RENAME TO/i);
  assert.doesNotMatch(chainNeutralSql, /PRAGMA legacy_alter_table/i);
  assert.match(chainNeutralSql, /schema_version = 'ravenos\.source_wallet_chain_event\.v1'/i);
  assert.doesNotMatch(chainNeutralSql, /private_key|seed_phrase|signer_material|raw_provider_payload/i);
});

test("chain-neutral migration preserves Solana evidence and accepts exact Robinhood identity inside one transaction", () => {
  const db = new DatabaseSync(":memory:");
  for (const name of readdirSync("customer-migrations").filter((name) => /^00(?:0[1-9]|1\d|2[0-2])_.*\.sql$/.test(name)).sort()) {
    db.exec(readFileSync(`customer-migrations/${name}`, "utf8"));
  }
  db.exec(`
    INSERT INTO ravenos_source_wallets (
      source_wallet_id, chain, network, address, observation_state, provider_scope,
      first_requested_at, last_observed_at, last_signature, updated_at
    ) VALUES (
      'sw_sol_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'solana', 'mainnet',
      '11111111111111111111111111111111', 'current', 'migration_fixture',
      100, 110, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 110
    );
    INSERT INTO ravenos_source_wallet_events (
      event_id, schema_version, source_wallet_id, signature, slot, block_time,
      finality, classification, decode_version, evidence_hash, event_json,
      observed_at, retention_expires_at
    ) VALUES (
      'swe_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'ravenos.solana_wallet_event.v1',
      'sw_sol_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      77, 105, 'confirmed', 'SWAP_BUY', 1,
      'cccccccccccccccccccccccccccccccccccccccc', '{}', 106, 1000
    );
    INSERT INTO ravenos_source_wallet_event_finality_observations (
      finality_observation_id, event_id, finality, provider, observed_at
    ) VALUES (
      'swf_dddddddddddddddddddddddddddddddddddddddd',
      'swe_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'confirmed', 'fixture', 106
    );
    INSERT INTO ravenos_source_wallet_profiles (
      profile_snapshot_id, source_wallet_id, profile_version, normalized_event_count,
      profile_json, generated_at, retention_expires_at
    ) VALUES (
      'swp_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      'sw_sol_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 1, 1, '{}', 107, 1000
    );
    INSERT INTO ravenos_source_wallet_current_profiles (
      source_wallet_id, profile_snapshot_id, profile_version, generated_at,
      trade_count, active_days, token_count, performance_state, closed_lots,
      profile_hash, updated_at
    ) VALUES (
      'sw_sol_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'swp_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 1, 107,
      1, 1, 1, 'insufficient_evidence', 0,
      'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 107
    );
    INSERT INTO ravenos_source_wallet_observer_deliveries (
      delivery_id, source_wallet_id, signature, slot, finality, provider,
      transport, received_at, evidence_reference, delivery_json,
      retention_expires_at
    ) VALUES (
      'swd_ffffffffffffffffffffffffffffffffffffffff',
      'sw_sol_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      77, 'confirmed', 'fixture', 'rpc_poll', 106,
      'fixture:delivery', '{}', 1000
    );
  `);
  const migration = readFileSync("customer-migrations/0023_source_wallet_chain_neutral.sql", "utf8");
  db.exec(`BEGIN IMMEDIATE;\n${migration}\nCOMMIT;`);
  assert.deepEqual({ ...db.prepare(`
    SELECT
      (SELECT count(*) FROM ravenos_source_wallets WHERE chain = 'solana') AS sources,
      (SELECT count(*) FROM ravenos_source_wallet_events WHERE chain = 'solana') AS events,
      (SELECT count(*) FROM ravenos_source_wallet_event_finality_observations) AS finality,
      (SELECT count(*) FROM ravenos_source_wallet_profiles) AS profiles,
      (SELECT count(*) FROM ravenos_source_wallet_current_profiles) AS current_profiles,
      (SELECT count(*) FROM ravenos_source_wallet_observer_deliveries) AS deliveries
  `).get() }, { sources: 1, events: 1, finality: 1, profiles: 1, current_profiles: 1, deliveries: 1 });
  assert.equal(db.prepare(`
    SELECT count(*) AS count
    FROM sqlite_master AS m
    JOIN pragma_foreign_key_list(m.name) AS f
    WHERE m.type = 'table' AND f.[table] LIKE '%legacy%'
  `).get().count, 0);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.exec(`
    INSERT INTO ravenos_source_wallets (
      source_wallet_id, schema_version, chain, network, chain_id, vm_family,
      address, observation_state, provider_scope, first_requested_at,
      last_observed_at, last_transaction_reference, last_block_number,
      last_signature, updated_at
    ) VALUES (
      'sw_rh_ffffffffffffffffffffffffffffffffffffffff', 'ravenos.source_wallet.v2',
      'robinhood', 'mainnet', '4663', 'evm',
      '0x1111111111111111111111111111111111111111', 'current', 'migration_fixture',
      200, 210,
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      12345, NULL, 210
    );
    INSERT INTO ravenos_source_wallet_events (
      event_id, schema_version, source_wallet_id, chain, network,
      transaction_reference, signature, slot, block_time, block_number,
      block_hash, chain_event_time, finality, classification, decode_version,
      evidence_hash, event_json, observed_at, retention_expires_at
    ) VALUES (
      'swe_1111111111111111111111111111111111111111',
      'ravenos.source_wallet_chain_event.v1',
      'sw_rh_ffffffffffffffffffffffffffffffffffffffff', 'robinhood', 'mainnet',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      NULL, NULL, NULL, 12345,
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      205, 'safe', 'SWAP_BUY', 1,
      'cccccccccccccccccccccccccccccccccccccccc', '{}', 206, 2000
    );
  `);
  assert.equal(db.prepare("SELECT count(*) AS count FROM ravenos_source_wallet_events WHERE chain = 'robinhood' AND signature IS NULL AND slot IS NULL AND block_number = 12345").get().count, 1);
  assert.throws(() => db.exec(`
    INSERT INTO ravenos_source_wallets (
      source_wallet_id, chain, network, chain_id, vm_family, address,
      observation_state, provider_scope, first_requested_at, updated_at
    ) VALUES (
      'sw_rh_9999999999999999999999999999999999999999', 'robinhood', 'mainnet',
      '4663', 'evm', '0x111111111111111111111111111111111111111z',
      'current', 'fixture', 300, 300
    )
  `), /constraint/i);
  db.close();
});

test("wallet workspace rejects cross-origin but gives signed-in accounts free basic access", async () => {
  const store = memoryStore();
  const provider = { async loadHistory() { return { events: [walletEvent()] }; } };
  const cross = await routeCustomerWalletCopy(request("/api/v1/wallet-copy", { suppliedOrigin: "https://evil.example" }), env(), deps(store, provider));
  assert.equal(cross.status, 403);
  const basic = await routeCustomerWalletCopy(request("/api/v1/wallet-copy"), env(), deps(store, provider, []));
  assert.equal(basic.status, 200);
  const payload = await json(basic);
  assert.equal(payload.access.tier, "free");
  assert.equal(payload.access.basic_wallet_lookup, true);
  assert.equal(payload.access.raven_copy_subscription_required, false);
  assert.equal(payload.access.advanced_wallet_intelligence, false);
});

test("free wallet lookup exposes headline facts but withholds deep intelligence and backfill", async () => {
  const store = memoryStore();
  const provider = { async loadHistory() { return { events: [walletEvent()] }; } };
  let backfillCalls = 0;
  const response = await routeCustomerWalletCopy(
    request("/api/v1/wallet-copy/inspect", { method: "POST", body: { address: WALLET } }),
    env({ RAVENOS_WALLET_BACKFILL_ENABLED: "1" }),
    { ...deps(store, provider, []), sourceWalletBackfillStore: { async enqueueJob() { backfillCalls += 1; } } },
  );
  assert.equal(response.status, 200);
  const payload = await json(response);
  assert.equal(payload.access.tier, "free");
  assert.equal(payload.profile.coverage.transactions_observed, 1);
  assert.equal(payload.profile.behavior.trade_count, 1);
  assert.equal(payload.profile.source_performance.profit_factor, null);
  assert.equal(payload.profile.profit_quality, undefined);
  assert.equal(payload.profile.research_thesis, undefined);
  assert.equal(payload.prospective_copyability, undefined);
  assert.equal(payload.deep_history.state, "pro_required");
  assert.equal(backfillCalls, 0);
});

test("free screener accepts bounded activity filters and rejects advanced behavior filters", async () => {
  const store = memoryStore();
  const provider = { async loadHistory() { return { events: [walletEvent()] }; } };
  await routeCustomerWalletCopy(request("/api/v1/wallet-copy/inspect", { method: "POST", body: { address: WALLET } }), env(), deps(store, provider));
  const activeEnv = env({ RAVENOS_WALLET_SCREENER_ENABLED: "1" });
  const basic = await routeCustomerWalletCopy(request("/api/v1/wallet-copy/screener", {
    method: "POST",
    body: { chain: "solana", filters: { active_within_hours: 720, min_trade_count: 1, min_active_days: 1, performance_state: "any" }, clauses: [], preset: null, sort: "last_trade_desc", page: 1, page_size: 12 },
  }), activeEnv, deps(store, provider, []));
  assert.equal(basic.status, 200);
  const basicPayload = await json(basic);
  assert.equal(basicPayload.access.tier, "free");
  assert.equal(basicPayload.rows[0].profit_quality, undefined);
  assert.equal(basicPayload.rows[0].behavior.median_hold_seconds, undefined);
  const advanced = await routeCustomerWalletCopy(request("/api/v1/wallet-copy/screener", {
    method: "POST",
    body: { chain: "solana", filters: { performance_state: "any" }, clauses: [{ field: "median_hold_seconds", operator: "gte", value: 3600 }], sort: "last_trade_desc", page: 1, page_size: 12 },
  }), activeEnv, deps(store, provider, []));
  assert.equal(advanced.status, 403);
  assert.equal((await json(advanced)).error, "advanced_wallet_intelligence_required");
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
  assert.equal(payload.prospective_copyability, undefined);
  assert.equal(payload.profile.public_summary.schema_version, 1);
  assert.ok(store.profiles.get(payload.source_wallet_id).research_thesis);
  assert.equal(store.watches.size, 0);
});

test("inspect queues one shared deep-history job and source detail reports its honest progress", async () => {
  const store = memoryStore();
  const provider = { async loadHistory() { return { events: [walletEvent()] }; } };
  let job = null;
  let enqueueCount = 0;
  let enqueueInput = null;
  const backfillStore = {
    async enqueueJob(input) {
      enqueueCount += 1;
      enqueueInput = input;
      const { address } = input;
      job ||= createSourceWalletBackfillJob({ ...input, address, requested_at: new Date(NOW * 1_000).toISOString() });
      return job;
    },
    async jobForSource(sourceId) {
      return job?.source_wallet_id === sourceId ? job : null;
    },
  };
  const activeEnv = env({ RAVENOS_WALLET_SCREENER_ENABLED: "1", RAVENOS_WALLET_BACKFILL_ENABLED: "1" });
  const d = { ...deps(store, provider), sourceWalletBackfillStore: backfillStore };
  const inspected = await routeCustomerWalletCopy(request("/api/v1/wallet-copy/inspect", { method: "POST", body: { address: WALLET } }), activeEnv, d);
  const inspectedPayload = await json(inspected);
  assert.equal(inspected.status, 200);
  assert.equal(inspectedPayload.deep_history.state, "queued");
  assert.equal(inspectedPayload.deep_history.signatures_indexed, 0);
  assert.equal(inspectedPayload.deep_history.maximum_signatures, 50_000);
  assert.equal(inspectedPayload.deep_history.history_complete_claimed, false);
  const detail = await routeCustomerWalletCopy(request(`/api/v1/wallet-copy/wallets/${inspectedPayload.source_wallet_id}`), activeEnv, d);
  const detailPayload = await json(detail);
  assert.equal(detailPayload.deep_history.state, "queued");
  assert.equal(detailPayload.prospective_copyability, undefined);
  assert.equal(detailPayload.provider_request_performed, false);
  assert.equal(enqueueCount, 1);
  assert.equal(enqueueInput.demand_class, "interactive_lookup");
  assert.equal("user_id" in enqueueInput, false);
  assert.equal(resolveWalletCopyActivation(activeEnv).deep_history, true);
  assert.equal(resolveWalletCopyActivation(activeEnv).live_copy, false);
});

test("repeat address lookup shares retained evidence across accounts without history or holdings RPC", async () => {
  const store = memoryStore();
  let calls = 0;
  const provider = {
    async loadHistory() { calls += 1; return { events: [walletEvent()] }; },
    async loadHoldings() { calls += 1; return { chain: "solana", address: WALLET, observed_at: new Date(NOW * 1000).toISOString(), state: "available", assets: [] }; },
    async loadTokenMetadata({mints}) { calls += 1; assert(mints.includes(TOKEN)); return {schema_version:"ravenos.solana_token_metadata.v1",rows:[{mint:TOKEN,symbol:"EX",decimals:6,provider_mark_price_usd:null}]}; },
  };
  const lookup = () => request("/api/v1/wallet-copy/inspect", { method: "POST", body: { address: WALLET } });
  const first = await json(await routeCustomerWalletCopy(lookup(), env(), deps(store, provider)));
  assert.equal(first.provider_request_performed, true);
  const otherUser = { ...deps(store, null), authorizeRequest: async () => ({ ...(await authorized()()), principal: { user_id: `usr_${"v".repeat(32)}` } }) };
  const cachedResponse = await routeCustomerWalletCopy(lookup(), env(), otherUser);
  assert.equal(cachedResponse.status, 200);
  const cached = await json(cachedResponse);
  assert.equal(calls, 3);
  assert.equal(cached.provider_request_performed, false);
  assert.equal(cached.evidence_mode, undefined);
  assert.deepEqual(cached.profile.holdings_snapshot, first.profile.holdings_snapshot);
  assert.deepEqual(cached.profile.token_metadata, first.profile.token_metadata);
  const rebuilt = await persistSourceWalletProfile(store, first.source_wallet_id, NOW + 60);
  assert.deepEqual(rebuilt.holdings_snapshot, first.profile.holdings_snapshot);
  assert.deepEqual(rebuilt.token_metadata, first.profile.token_metadata);
  assert.equal(cached.freshness.current_balance_claimed, false);
  assert.equal(cached.freshness.observed_at, first.profile.generated_at);
});

test("a Solana wallet with verified empty history still displays its confirmed holdings", async () => {
  const store=memoryStore();let calls=0;
  const provider={async loadHistory(){calls++;return {events:[],history_exhausted:true,signatures_requested:0,transactions_decoded:0};},
    async loadHoldings(){return {chain:'solana',address:WALLET,state:'available',observed_at:new Date(NOW*1000).toISOString(),native:{amount:0,amount_base_units:'0'},tokens:[]};}};
  const lookup=()=>request('/api/v1/wallet-copy/inspect',{method:'POST',body:{address:WALLET}});
  const response=await routeCustomerWalletCopy(lookup(),env(),deps(store,provider)),first=await json(response);
  assert.equal(response.status,200,JSON.stringify(first));assert.equal(first.profile.source_wallet.address,WALLET);
  assert.equal(first.profile.holdings_snapshot.native.amount_base_units,'0');assert.equal(first.profile.coverage.transactions_observed,0);
  assert.equal(first.profile.source_performance.realized_pnl_usdc,null);
  const cached=await json(await routeCustomerWalletCopy(lookup(),env(),deps(store,provider)));
  assert.equal(cached.provider_request_performed,false);assert.equal(calls,1);
});

test("an empty response without provider exhaustion cannot fabricate an empty Solana history",async()=>{
  const response=await routeCustomerWalletCopy(request('/api/v1/wallet-copy/inspect',{method:'POST',body:{address:WALLET}}),env(),deps(memoryStore(),{async loadHistory(){return {events:[]};}}));
  assert.notEqual(response.status,200);
});

test('Solana held-token marks produce USD unrealized results only when retained cost and exact quantity reconcile',()=>{
  const profile={source_wallet:{chain:'solana',address:WALLET},generated_at:new Date(NOW*1000).toISOString(),holdings_snapshot:{tokens:[{contract:TOKEN,mint:TOKEN,decimals:6,balance_base_units:'10000000',provider_mark_value_usd:'40'}]}};
  const usd=walletUsdTradingRecord(profile,[walletEvent()],[]);
  assert.equal(usd.unrealized_summary.value_usd,'15');assert.equal(usd.priced_trades,1);
  profile.holdings_snapshot.tokens[0].balance_base_units='9000000';
  assert.equal(walletUsdTradingRecord(profile,[walletEvent()],[]).unrealized_summary.value_usd,null);
});

test("retained events rebuild a missing profile without RPC and reject the wrong cached wallet", async () => {
  const store = memoryStore();
  const event = walletEvent();
  const sourceId = createSourceWalletId({ chain: "solana", network: "mainnet", address: WALLET });
  await store.upsertSourceWallet({ source_wallet_id: sourceId, address: WALLET, now: NOW, state: "current" });
  await store.recordEvents(sourceId, [event]);
  const lookup = () => request("/api/v1/wallet-copy/inspect", { method: "POST", body: { address: WALLET } });
  const result = await json(await routeCustomerWalletCopy(lookup(), env(), deps(store, null)));
  assert.equal(result.provider_request_performed, false);
  assert.equal(result.profile.coverage.transactions_observed, 1);
  store.profiles.set(sourceId, { ...result.profile, source_wallet: { ...result.profile.source_wallet, address: TOKEN } });
  const invalid = await routeCustomerWalletCopy(lookup(), env(), deps(store, null));
  assert.equal(invalid.status, 400);
  assert.equal((await json(invalid)).error, "wallet_history_identity_mismatch");
});

test("old retained wallet evidence keeps its timestamp and never claims current balances", async () => {
  const store = memoryStore();
  const lookup = () => request("/api/v1/wallet-copy/inspect", { method: "POST", body: { address: WALLET } });
  const first = await json(await routeCustomerWalletCopy(lookup(), env(), deps(store, { async loadHistory() { return { events: [walletEvent()] }; } })));
  const later = { ...deps(store, null), authorizeRequest: async () => ({ ...(await authorized()()), now: NOW + 86400 }) };
  const cached = await json(await routeCustomerWalletCopy(lookup(), env(), later));
  assert.equal(cached.freshness.state, "retained");
  assert.equal(cached.freshness.observed_at, first.profile.generated_at);
  assert.equal(cached.provider_request_performed, false);
  assert.equal(cached.freshness.current_balance_claimed, false);
});

test("explicit refresh is shared for five minutes and a provider outage preserves earlier evidence", async () => {
  const store = memoryStore();
  let calls = 0;
  const provider = { async loadHistory() { calls += 1; return { events: [walletEvent()] }; } };
  const lookup = refresh => request("/api/v1/wallet-copy/inspect", { method: "POST", body: { address: WALLET, refresh } });
  const first = await json(await routeCustomerWalletCopy(lookup(false), env(), deps(store, provider)));
  await routeCustomerWalletCopy(lookup(true), env(), deps(store, provider));
  assert.equal(calls, 1);
  const later = { ...deps(store, { async loadHistory() { calls += 1; throw new Error("provider_down"); } }),
    authorizeRequest: async () => ({ ...(await authorized()()), now: NOW + 301 }) };
  const fallback = await json(await routeCustomerWalletCopy(lookup(true), env(), later));
  assert.equal(calls, 2);
  assert.equal(fallback.refresh_state, "provider_unavailable");
  assert.deepEqual(fallback.profile, first.profile);
  assert.equal(fallback.freshness.state, "retained");
});

test("saving research does not enqueue history; inspection and copy watches retain explicit demand classes", async () => {
  const store = memoryStore();
  const provider = { async loadHistory() { return { events: [walletEvent()] }; } };
  const enqueueInputs = [];
  const backfillStore = {
    async enqueueJob(input) {
      enqueueInputs.push(input);
      return createSourceWalletBackfillJob({
        address: input.address,
        demand_class: input.demand_class,
        requested_at: new Date(input.now).toISOString(),
      });
    },
  };
  const activeEnv = env({ RAVENOS_WALLET_SCREENER_ENABLED: "1", RAVENOS_WALLET_BACKFILL_ENABLED: "1" });
  const d = { ...deps(store, provider), sourceWalletBackfillStore: backfillStore };
  const inspected = await json(await routeCustomerWalletCopy(
    request("/api/v1/wallet-copy/inspect", { method: "POST", body: { address: WALLET } }),
    activeEnv,
    d,
  ));
  await routeCustomerWalletCopy(request("/api/v1/wallet-copy/saved-wallets", {
    method: "POST",
    body: { source_wallet_id: inspected.source_wallet_id, list_name: "Priority", label: "Research first" },
  }), activeEnv, d);
  await routeCustomerWalletCopy(request("/api/v1/wallet-copy/watches", {
    method: "POST",
    body: { address: WALLET, label: "Shadow priority", policy: { sizing: { fixed_usdc: 100 } } },
  }), activeEnv, d);
  assert.deepEqual(enqueueInputs.map((input) => input.demand_class), [
    "interactive_lookup",
    "customer_watch",
  ]);
  assert.equal(enqueueInputs.every((input) => !("user_id" in input) && !("watch_id" in input)), true);
});

test("shared D1 event ingestion batches deep-history writes without changing event idempotency", async () => {
  const batches = [];
  const db = {
    prepare(sql) {
      return {
        bind(...bindings) {
          return { sql, bindings };
        },
      };
    },
    async batch(statements) {
      batches.push(statements);
      return statements.map((_statement, index) => ({ meta: { changes: index % 2 === 0 ? 1 : 0 } }));
    },
  };
  const first = walletEvent({ signature: "d".repeat(88), slot: 101 });
  const second = walletEvent({ signature: "e".repeat(88), slot: 102 });
  const sourceId = createSourceWalletId(first.source_wallet);
  const inserted = await createD1CustomerWalletCopyStore(db).recordEvents(sourceId, [first, second], NOW);
  assert.deepEqual(inserted, [first.event_id, second.event_id]);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 4);
  assert.match(batches[0][0].sql, /INSERT OR IGNORE INTO ravenos_source_wallet_events/i);
  assert.match(batches[0][1].sql, /INSERT OR IGNORE INTO ravenos_source_wallet_event_finality_observations/i);
  assert.equal(batches[0][0].bindings.includes(JSON.stringify(first)), true);
  assert.equal(batches[0][0].bindings[2], sourceId);
});

test("Raven-indexed screener is separately gated, bounded, and opens retained evidence without another provider request", async () => {
  let providerLoads = 0;
  const store = memoryStore();
  const provider = { async loadHistory() { providerLoads += 1; return { events: [walletEvent()] }; } };
  const d = deps(store, provider);
  const inspected = await routeCustomerWalletCopy(request("/api/v1/wallet-copy/inspect", { method: "POST", body: { address: WALLET } }), env(), d);
  assert.equal(inspected.status, 200);
  assert.equal(providerLoads, 1);

  const disabled = await routeCustomerWalletCopy(request("/api/v1/wallet-copy/screener", { method: "POST", body: { filters: {}, page: 1, page_size: 12 } }), env(), d);
  assert.equal(disabled.status, 503);
  assert.equal((await json(disabled)).error, "wallet_screener_disabled");

  const activeEnv = env({ RAVENOS_WALLET_SCREENER_ENABLED: "1" });
  const screened = await routeCustomerWalletCopy(request("/api/v1/wallet-copy/screener", {
    method: "POST",
    body: { filters: { min_trade_count: 1, performance_state: "any" }, sort: "last_trade_desc", page: 1, page_size: 12 },
  }), activeEnv, d);
  const screenedPayload = await json(screened);
  assert.equal(screened.status, 200);
  assert.equal(screenedPayload.scope.claim, "bounded_raven_index_only");
  assert.equal(screenedPayload.scope.comprehensive_chain_index, false);
  assert.equal(screenedPayload.rows.length, 1);
  assert.equal(screenedPayload.rows[0].source_wallet.address, WALLET);
  assert.equal(screenedPayload.rows[0].follower_reality, undefined);
  assert.equal(screenedPayload.query, undefined);
  assert.equal(screenedPayload.rows[0].source_performance.realized_pnl.combined, null);

  const sourceId = screenedPayload.rows[0].source_wallet_id;
  const detail = await routeCustomerWalletCopy(request(`/api/v1/wallet-copy/wallets/${sourceId}`), activeEnv, d);
  const detailPayload = await json(detail);
  assert.equal(detail.status, 200);
  assert.equal(detailPayload.provider_request_performed, false);
  assert.equal(detailPayload.profile.source_wallet.address, WALLET);
  assert.equal(detailPayload.recent_events.length, 1);
  assert.equal(providerLoads, 1);
});

test("wallet activity explorer pages retained evidence deterministically without another provider request", async () => {
  let providerLoads = 0;
  const store = memoryStore();
  const provider = { async loadHistory() { providerLoads += 1; return { events: [walletEvent()] }; } };
  const activeEnv = env({ RAVENOS_WALLET_SCREENER_ENABLED: "1" });
  const d = deps(store, provider);
  const inspected = await routeCustomerWalletCopy(request("/api/v1/wallet-copy/inspect", { method: "POST", body: { address: WALLET } }), activeEnv, d);
  const inspectedPayload = await json(inspected);
  const sourceId = inspectedPayload.source_wallet_id;
  const older = Array.from({ length: 8 }, (_, index) => walletEvent({
    signature: `${"b".repeat(86)}${String(index).padStart(2, "0")}`,
    slot: 90 - index,
    blockTime: NOW - 10 - index,
  }));
  await store.recordEvents(sourceId, older);

  const first = await routeCustomerWalletCopy(request(`/api/v1/wallet-copy/wallets/${sourceId}/events?filter=trades&limit=5`), activeEnv, d);
  const firstPayload = await json(first);
  assert.equal(first.status, 200);
  assert.equal(firstPayload.schema_version, "ravenos.wallet_activity_page.v1");
  assert.equal(firstPayload.events.length, 5);
  assert.equal(firstPayload.pagination.matching_event_count, 9);
  assert.equal(firstPayload.pagination.has_more, true);
  assert.match(firstPayload.pagination.next_cursor, /^\d+~swe_[a-f0-9]{40}$/);
  assert.equal(firstPayload.scope.provider_request_performed, false);
  assert.equal(firstPayload.scope.history_complete_claimed, false);
  assert.equal(firstPayload.events[0].schema_version, "ravenos.wallet_activity_event.v1");
  assert.equal(firstPayload.events[0].evidence_boundary, undefined);
  assert.equal(firstPayload.events[0].timing, undefined);
  assert.equal("deltas" in firstPayload.events[0].economic, false);
  assert.equal(firstPayload.events[0].chain_evidence.evidence_reference, `solana:signature:${firstPayload.events[0].chain_evidence.signature}`);

  const second = await routeCustomerWalletCopy(request(`/api/v1/wallet-copy/wallets/${sourceId}/events?filter=trades&limit=5&cursor=${encodeURIComponent(firstPayload.pagination.next_cursor)}`), activeEnv, d);
  const secondPayload = await json(second);
  assert.equal(second.status, 200);
  assert.equal(secondPayload.events.length, 4);
  assert.equal(secondPayload.pagination.has_more, false);
  assert.equal(new Set([...firstPayload.events, ...secondPayload.events].map((event) => event.event_id)).size, 9);
  assert.equal(providerLoads, 1);
});

test("wallet activity explorer allowlists filters, cursors, and page size", async () => {
  const store = memoryStore();
  const provider = { async loadHistory() { return { events: [walletEvent()] }; } };
  const activeEnv = env({ RAVENOS_WALLET_SCREENER_ENABLED: "1" });
  const d = deps(store, provider);
  const inspected = await json(await routeCustomerWalletCopy(request("/api/v1/wallet-copy/inspect", { method: "POST", body: { address: WALLET } }), activeEnv, d));
  const base = `/api/v1/wallet-copy/wallets/${inspected.source_wallet_id}/events`;
  const invalidFilter = await routeCustomerWalletCopy(request(`${base}?filter=profit_magic`), activeEnv, d);
  assert.equal(invalidFilter.status, 400);
  assert.equal((await json(invalidFilter)).error, "wallet_activity_filter_invalid");
  const invalidCursor = await routeCustomerWalletCopy(request(`${base}?cursor=oldest`), activeEnv, d);
  assert.equal(invalidCursor.status, 400);
  assert.equal((await json(invalidCursor)).error, "wallet_activity_cursor_invalid");
  const invalidLimit = await routeCustomerWalletCopy(request(`${base}?limit=21`), activeEnv, d);
  assert.equal(invalidLimit.status, 400);
  assert.equal((await json(invalidLimit)).error, "wallet_activity_limit_invalid");
  const unexpected = await routeCustomerWalletCopy(request(`${base}?wallet=${WALLET}`), activeEnv, d);
  assert.equal(unexpected.status, 400);
  assert.equal((await json(unexpected)).error, "wallet_activity_query_invalid");
});

test("wallet activity explorer fails closed on a retained source-identity mismatch", async () => {
  const store = memoryStore();
  const provider = { async loadHistory() { return { events: [walletEvent()] }; } };
  const activeEnv = env({ RAVENOS_WALLET_SCREENER_ENABLED: "1" });
  const d = deps(store, provider);
  const inspected = await json(await routeCustomerWalletCopy(request("/api/v1/wallet-copy/inspect", { method: "POST", body: { address: WALLET } }), activeEnv, d));
  const corrupt = structuredClone(walletEvent({ signature: "c".repeat(88), slot: 99, blockTime: NOW - 3 }));
  corrupt.source_wallet.address = bs58.encode(Buffer.alloc(32, 31));
  store.events.set(corrupt.event_id, { id: inspected.source_wallet_id, row: corrupt });
  const response = await routeCustomerWalletCopy(request(`/api/v1/wallet-copy/wallets/${inspected.source_wallet_id}/events`), activeEnv, d);
  assert.equal(response.status, 503);
  assert.equal((await json(response)).error, "stored_wallet_activity_event_invalid");
});

test("wallet screener rejects unallowlisted controls and exact source details fail closed", async () => {
  const store = memoryStore();
  const provider = { async loadHistory() { return { events: [walletEvent()] }; } };
  const activeEnv = env({ RAVENOS_WALLET_SCREENER_ENABLED: "1" });
  const invalid = await routeCustomerWalletCopy(request("/api/v1/wallet-copy/screener", {
    method: "POST",
    body: { filters: {}, sort: "profit_magic_desc" },
  }), activeEnv, deps(store, provider));
  assert.equal(invalid.status, 400);
  assert.equal((await json(invalid)).error, "wallet_screener_sort_invalid");
  const missing = await routeCustomerWalletCopy(request(`/api/v1/wallet-copy/wallets/sw_sol_${"f".repeat(40)}`), activeEnv, deps(store, provider));
  assert.equal(missing.status, 404);
  assert.equal((await json(missing)).error, "wallet_source_not_found");
});

test("private wallet research saves are owner-bound, idempotent, and never start shadow monitoring", async () => {
  const store = memoryStore();
  const provider = { async loadHistory() { return { events: [walletEvent()] }; } };
  const activeEnv = env({ RAVENOS_WALLET_SCREENER_ENABLED: "1" });
  const d = deps(store, provider);
  const inspected = await routeCustomerWalletCopy(request("/api/v1/wallet-copy/inspect", { method: "POST", body: { address: WALLET } }), activeEnv, d);
  const inspectedPayload = await json(inspected);
  const sourceId = inspectedPayload.source_wallet_id;

  const body = { source_wallet_id: sourceId, list_name: "Research", label: "Measured source" };
  const created = await routeCustomerWalletCopy(request("/api/v1/wallet-copy/saved-wallets", { method: "POST", body }), activeEnv, d);
  const createdPayload = await json(created);
  assert.equal(created.status, 201);
  assert.equal(createdPayload.created, true);
  assert.equal(createdPayload.save.source_wallet.address, WALLET);
  assert.equal(createdPayload.save.shadow_monitoring_started, false);
  assert.equal(createdPayload.save.execution_authorized, false);
  assert.equal(store.watches.size, 0);

  const duplicate = await routeCustomerWalletCopy(request("/api/v1/wallet-copy/saved-wallets", { method: "POST", body }), activeEnv, d);
  assert.equal(duplicate.status, 200);
  assert.equal((await json(duplicate)).created, false);
  assert.equal(store.researchSaves.size, 1);

  const caseDuplicate = await routeCustomerWalletCopy(request("/api/v1/wallet-copy/saved-wallets", { method: "POST", body: { ...body, list_name: "research" } }), activeEnv, d);
  assert.equal(caseDuplicate.status, 200);
  assert.equal((await json(caseDuplicate)).created, false);
  assert.equal(store.researchSaves.size, 1);

  const listed = await routeCustomerWalletCopy(request("/api/v1/wallet-copy/saved-wallets"), activeEnv, d);
  const listedPayload = await json(listed);
  assert.equal(listedPayload.saves.length, 1);
  assert.deepEqual(listedPayload.lists, [{ name: "Research", count: 1 }]);

  store.researchSaves.set(`wrs_${"z".repeat(40)}`, { ...store.researchSaves.values().next().value, save_id: `wrs_${"z".repeat(40)}`, user_id: `usr_${"x".repeat(32)}` });
  const foreign = await routeCustomerWalletCopy(request(`/api/v1/wallet-copy/saved-wallets/wrs_${"z".repeat(40)}`, { method: "DELETE", body: { confirm: "delete_saved_wallet" } }), activeEnv, d);
  assert.equal((await json(foreign)).deleted, false);

  const removed = await routeCustomerWalletCopy(request(`/api/v1/wallet-copy/saved-wallets/${createdPayload.save.save_id}`, { method: "DELETE", body: { confirm: "delete_saved_wallet" } }), activeEnv, d);
  assert.equal((await json(removed)).deleted, true);
  assert.equal(store.researchSaves.size, 1);
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
  const createdResponse = await routeCustomerWalletCopy(request("/api/v1/wallet-copy/watches", { method: "POST", body: { address: WALLET, label: "Test source", policy: { sizing: { fixed_usdc: 100 }, hypothetical_raven_fee_bps: 100 } } }), env(), d);
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
  const decisionResponse = await routeCustomerWalletCopy(request("/api/v1/wallet-copy/decisions"), env(), d);
  const decisionPayload = await json(decisionResponse);
  assert.equal(decisionPayload.copyability, undefined);
  assert.equal(store.decisions.length, 1);
  assert.equal(refresh, 1);
});

test("manual fallback maps a later source sell to the Raven-created position", async () => {
  const baseline = walletEvent({ signature: "b".repeat(88), slot: 100, blockTime: NOW - 10, mode: "historical_backfill" });
  const prospective = walletEvent({ signature: "c".repeat(88), slot: 101, blockTime: NOW - 2, mode: "prospective" });
  const sell = walletSellEvent();
  let refresh = 0;
  const provider = {
    async loadHistory({ observation_mode }) {
      if (observation_mode === "historical_backfill") return { events: [baseline] };
      refresh += 1;
      return refresh === 1 ? { events: [prospective, baseline] } : { events: [sell, prospective, baseline] };
    },
    async quoteCopySignal() {
      return {
        source_notional_usdc: 25,
        source_notional_basis: "source_wallet_canonical_usdc_delta",
        liquidity_usd: 250_000,
        asset_evidence: { identity_resolved: true, token_standard: "spl", token_standard_resolved: true, sell_simulation_state: "passed", reverse_sell_quote_state: "available", freeze_authority_present: false, mint_authority_present: false, transfer_fee_detected: false },
        entry: { state: "available", quote_id: "entry", provider: "jupiter", requested_at: "2026-08-29T12:00:01.000Z", quoted_at: "2026-08-29T12:00:01.100Z", received_at: "2026-08-29T12:00:01.200Z", expires_at: "2026-08-29T12:00:16.100Z", expected_output: 39.5, minimum_output: 39.1, expected_output_base_units: "39500000", minimum_output_base_units: "39100000", price_impact_bps: 50, latency_ms: 200, exact_asset_identity: true },
        exit: { state: "available", quote_id: "exit", provider: "jupiter", requested_at: "2026-08-29T12:00:01.200Z", quoted_at: "2026-08-29T12:00:01.300Z", received_at: "2026-08-29T12:00:01.400Z", expires_at: "2026-08-29T12:00:16.300Z", expected_output: 97.5, minimum_output: 97, expected_output_base_units: "97500000", minimum_output_base_units: "97000000", price_impact_bps: 55, latency_ms: 200, exact_asset_identity: true },
      };
    },
    async quoteCopyExit({ quantity_base_units }) {
      assert.equal(quantity_base_units, "15800000");
      return {
        asset_evidence: { identity_resolved: true, token_standard: "spl", token_standard_resolved: true, sell_simulation_state: "passed", reverse_sell_quote_state: "available", freeze_authority_present: false, mint_authority_present: false, transfer_fee_detected: false },
        exit: { state: "available", quote_id: "mapped_exit", provider: "jupiter", requested_at: "2026-08-29T12:00:02.100Z", quoted_at: "2026-08-29T12:00:02.200Z", received_at: "2026-08-29T12:00:02.300Z", expires_at: "2026-08-29T12:00:17.200Z", expected_output: 41.3, minimum_output: 40.9, expected_output_base_units: "41300000", minimum_output_base_units: "40900000", price_impact_bps: 45, latency_ms: 200, exact_asset_identity: true },
      };
    },
  };
  const store = memoryStore();
  const d = deps(store, provider);
  const created = await json(await routeCustomerWalletCopy(request("/api/v1/wallet-copy/watches", {
    method: "POST",
    body: { address: WALLET, label: "Mapped exits", policy: { sizing: { fixed_usdc: 100 }, hypothetical_raven_fee_bps: 100 } },
  }), env(), d));
  const path = `/api/v1/wallet-copy/watches/${created.watch.watch_id}/refresh`;
  await routeCustomerWalletCopy(request(path, { method: "POST", body: {} }), env(), d);
  await routeCustomerWalletCopy(request(path, { method: "POST", body: {} }), env(), d);
  const third = await routeCustomerWalletCopy(request(path, { method: "POST", body: {} }), env(), d);
  const thirdPayload = await json(third);
  assert.equal(third.status, 200);
  assert.equal(thirdPayload.decisions.length, 0);
  assert.equal(thirdPayload.exit_decisions.length, 1);
  assert.equal(thirdPayload.exit_decisions[0].decision.state, "SHADOW_EXIT_EXECUTABLE");
  assert.equal(thirdPayload.exit_decisions[0].source_sell.fraction_bps, 4_000);
  assert.equal(store.exitDecisions.length, 1);

  const positionPayload = await json(await routeCustomerWalletCopy(request("/api/v1/wallet-copy/positions"), env(), d));
  assert.equal(positionPayload.positions[0].state, "SHADOW_PARTIAL_EXIT");
  assert.equal(positionPayload.positions[0].remaining_quantity_base_units, "23700000");
  assert.equal(positionPayload.live_assets_held, false);

  const decisionPayload = await json(await routeCustomerWalletCopy(request("/api/v1/wallet-copy/decisions"), env(), d));
  assert.equal(decisionPayload.exit_decisions[0].decision.reason_code, "mapped_source_exit_quote_available");
});

test("manual fallback retains a signal backlog instead of advancing past unprocessed trades", async () => {
  const baseline = walletEvent({ signature: "b".repeat(88), slot: 100, blockTime: NOW - 10, mode: "historical_backfill" });
  const prospective = [
    walletEvent({ signature: "c".repeat(88), slot: 101, mode: "prospective" }),
    walletEvent({ signature: "d".repeat(88), slot: 102, mode: "prospective" }),
    walletEvent({ signature: "e".repeat(88), slot: 103, mode: "prospective" }),
    walletEvent({ signature: "f".repeat(88), slot: 104, mode: "prospective" }),
    walletEvent({ signature: "g".repeat(88), slot: 105, mode: "prospective" }),
  ];
  const provider = {
    async loadHistory({ observation_mode }) {
      return observation_mode === "historical_backfill"
        ? { events: [baseline] }
        : { events: [...prospective].reverse().concat(baseline) };
    },
    async quoteCopySignal() {
      const quoted = "2026-08-29T12:00:03.000Z";
      return {
        source_notional_usdc: 25,
        source_notional_basis: "source_wallet_canonical_usdc_delta",
        liquidity_usd: 250_000,
        asset_evidence: { identity_resolved: true, token_standard: "spl", token_standard_resolved: true, sell_simulation_state: "passed", reverse_sell_quote_state: "available" },
        entry: { state: "available", provider: "fixture", requested_at: quoted, quoted_at: quoted, received_at: quoted, expires_at: "2026-08-29T12:00:18.000Z", expected_output: 39.5, minimum_output: 39.1, expected_output_base_units: "39500000", minimum_output_base_units: "39100000", exact_asset_identity: true },
        exit: { state: "available", provider: "fixture", requested_at: quoted, quoted_at: quoted, received_at: quoted, expires_at: "2026-08-29T12:00:18.000Z", expected_output: 97.5, minimum_output: 97, expected_output_base_units: "97500000", minimum_output_base_units: "97000000", exact_asset_identity: true },
      };
    },
  };
  const store = memoryStore();
  const d = deps(store, provider);
  const created = await json(await routeCustomerWalletCopy(request("/api/v1/wallet-copy/watches", {
    method: "POST",
    body: { address: WALLET, label: "Backlog proof", policy: { sizing: { fixed_usdc: 100 }, hypothetical_raven_fee_bps: 100 } },
  }), env(), d));
  const path = `/api/v1/wallet-copy/watches/${created.watch.watch_id}/refresh`;
  await routeCustomerWalletCopy(request(path, { method: "POST", body: {} }), env(), d);

  const first = await json(await routeCustomerWalletCopy(request(path, { method: "POST", body: {} }), env(), d));
  assert.equal(first.decisions.length, 3);
  assert.equal(first.prospective_signals_deferred, 2);
  assert.equal(store.watches.get(created.watch.watch_id).cursor_slot, 103);

  const second = await json(await routeCustomerWalletCopy(request(path, { method: "POST", body: {} }), env(), d));
  assert.equal(second.decisions.length, 2);
  assert.equal(second.prospective_signals_deferred, 0);
  assert.equal(store.watches.get(created.watch.watch_id).cursor_slot, 105);
  assert.equal(store.decisions.length, 5);
  assert.equal(store.positions.length, 5);
});

test("cohort clusters and discovery risk filters require Pro at the API boundary", async () => {
  const store = memoryStore();
  const provider = { async loadHistory() { return { events: [walletEvent()] }; } };
  const activeEnv = env({ RAVENOS_WALLET_SCREENER_ENABLED: "1" });
  const cluster = await routeCustomerWalletCopy(request("/api/v1/wallet-copy/robinhood/clusters?hours=24&limit=100&min_wallets=2"), activeEnv, deps(store, provider, []));
  assert.equal(cluster.status, 403);
  const filter = await routeCustomerWalletCopy(request("/api/v1/wallet-copy/screener", { method: "POST", body: { chain: "all", clauses: [{ field: "loss_75_pct", operator: "lte", value: 10 }] } }), activeEnv, deps(store, provider, []));
  assert.equal(filter.status, 403);
});


test("customer Copy API rejects underpriced policy before registering a watch", async () => {
  const store = memoryStore();
  const d = deps(store, {});
  for (const fee of [0, 10, 50, 70]) {
    const response = await routeCustomerWalletCopy(request("/api/v1/wallet-copy/watches", { method: "POST", body: { address: WALLET, policy: { hypothetical_raven_fee_bps: fee } } }), env(), d);
    assert.equal(response.status, 400);
    assert.equal((await json(response)).error, "customer_copy_fee_policy_mismatch");
  }
  const response = await routeCustomerWalletCopy(request("/api/v1/wallet-copy/watches", { method: "POST", body: { address: WALLET } }), env(), d);
  assert.equal(response.status, 201);
  assert.equal((await json(response)).watch.policy.hypothetical_raven_fee_bps, 100);
});

test("observed view skips performance screening; analyzed view skips observations; neither loads providers", async () => {
  const store=memoryStore();let screens=0,seen=0;
  store.screenSourceWallets=async()=>{screens++;return {rows:[],total:0};};
  store.listSeenWallets=async(query,options)=>{seen++;assert.equal(query.view,"observed");assert.equal(options.market_evidence_enabled,true);return {rows:[],total:0};};
  const provider={async loadHistory(){throw Error("must not load history when browsing");}};
  const activeEnv=env({RAVENOS_WALLET_SCREENER_ENABLED:"1",RAVENOS_WALLET_MARKET_EVIDENCE_ENABLED:"1"});
  const observed=await routeCustomerWalletCopy(request("/api/v1/wallet-copy/screener",{method:"POST",body:{view:"observed",observed:{signal:"repeat_activity"}}}),activeEnv,deps(store,provider));
  assert.equal(observed.status,200);assert.equal((await json(observed)).profile_screen_performed,false);assert.equal(screens,0);assert.equal(seen,1);
  const analyzed=await routeCustomerWalletCopy(request("/api/v1/wallet-copy/screener",{method:"POST",body:{view:"analyzed"}}),activeEnv,deps(store,provider));
  assert.equal(analyzed.status,200);assert.equal((await json(analyzed)).seen_wallets,null);assert.equal(screens,1);assert.equal(seen,1);
});

test("advanced observed activity is server-gated to Pro and disabled infrastructure does not silently ignore filters", async () => {
  const store=memoryStore();let reads=0;store.listSeenWallets=async()=>{reads++;return {rows:[],total:0};};
  const activeEnv=env({RAVENOS_WALLET_SCREENER_ENABLED:"1",RAVENOS_WALLET_MARKET_EVIDENCE_ENABLED:"1"});
  for(const observed of [{signal:"two_sided"},{sort:"activity"},{signal:"multiple_markets"}]) {
    const result=await routeCustomerWalletCopy(request("/api/v1/wallet-copy/screener",{method:"POST",body:{view:"observed",page_size:12,observed}}),activeEnv,deps(store,{},[]));
    assert.equal(result.status,403);
  }
  assert.equal(reads,0);
  const basic=await routeCustomerWalletCopy(request("/api/v1/wallet-copy/screener",{method:"POST",body:{view:"observed",page_size:12,observed:{history:"cached",active_within_hours:6}}}),activeEnv,deps(store,{},[]));
  assert.equal(basic.status,200);assert.equal(reads,1);
  const unavailable=await routeCustomerWalletCopy(request("/api/v1/wallet-copy/screener",{method:"POST",body:{view:"observed",observed:{signal:"two_sided"}}}),{...activeEnv,RAVENOS_WALLET_MARKET_EVIDENCE_ENABLED:"0"},deps(store,{}));
  assert.equal(unavailable.status,503);assert.equal((await json(unavailable)).error,"wallet_market_evidence_disabled");assert.equal(reads,1);
  const malformed=await routeCustomerWalletCopy(request("/api/v1/wallet-copy/screener",{method:"POST",body:{observed:{signal:"profit"}}}),activeEnv,deps(store,{}));
  assert.equal(malformed.status,400);assert.equal((await json(malformed)).error,"wallet_screener_observation_invalid");
});

test("old Solana profile gains token records from retained events without refreshing balances or requesting RPC",async()=>{
  const store=memoryStore();const sourceId=createSourceWalletId({chain:'solana',network:'mainnet',address:WALLET});
  await store.upsertSourceWallet({source_wallet_id:sourceId,address:WALLET,now:NOW,state:'current'});
  await store.recordEvents(sourceId,[walletEvent()]);
  const result=await json(await routeCustomerWalletCopy(request('/api/v1/wallet-copy/inspect',{method:'POST',body:{address:WALLET}}),env(),deps(store,null)));
  const {trading_record,...old}=result.profile;
  store.profiles.set(sourceId,{...old,profile_version:5});
  const response=await routeCustomerWalletCopy(request(`/api/v1/wallet-copy/wallets/${sourceId}`),{...env(),RAVENOS_WALLET_SCREENER_ENABLED:"1"},deps(store,null));
  assert.equal(response.status,200,await response.clone().text());const payload=await json(response);
  assert.equal(payload.provider_request_performed,false);
  assert.equal(payload.profile.generated_at,old.generated_at);
  assert.equal(payload.profile.trading_record.schema_version,'ravenos.wallet_trading_record.v1');
  assert.deepEqual(payload.profile.trading_record,trading_record);
  const lookup=await json(await routeCustomerWalletCopy(request('/api/v1/wallet-copy/inspect',{method:'POST',body:{address:WALLET}}),env(),deps(store,null)));
  assert.deepEqual(lookup.profile.trading_record,trading_record);
  assert.equal(lookup.provider_request_performed,false);
});

test("large Solana holder inspection opens under the response limit and pages every retained balance without RPC", async () => {
  const store = memoryStore();
  let providerCalls = 0;
  const tokens = Array.from({ length: 850 }, (_, index) => ({ mint: `retained-${index}`, contract: `retained-${index}`,
    balance_base_units: "1000000000", balance_display: "1000", decimals: 6, provider_mark_price_usd: null,
    symbol: `Token ${index}`, observed_at: new Date(NOW * 1000).toISOString(), token_program: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }));
  const provider = {
    async loadHistory() { providerCalls++; return { events: [walletEvent()] }; },
    async loadHoldings() { providerCalls++; return { chain: "solana", address: WALLET, state: "available", observed_at: new Date(NOW * 1000).toISOString(), tokens }; },
  };
  const response = await routeCustomerWalletCopy(request('/api/v1/wallet-copy/inspect', {method:'POST',body:{address:WALLET}}), env(), deps(store, provider));
  assert.equal(response.status, 200, await response.clone().text());
  assert(Buffer.byteLength(await response.clone().text()) < 256 * 1024);
  const result = await json(response);
  assert.equal(result.profile.holdings_page.total, 850);
  assert.equal(store.profiles.get(result.source_wallet_id).holdings_snapshot.tokens.length, 850);
  const all = [...result.profile.holdings_snapshot.tokens];
  let cursor = result.profile.holdings_page.next_cursor;
  while (cursor) {
    const pageResponse = await routeCustomerWalletCopy(request(`/api/v1/wallet-copy/wallets/${result.source_wallet_id}/holdings?cursor=${cursor}`), env(), deps(store, provider));
    assert.equal(pageResponse.status, 200);
    const page = await json(pageResponse);
    assert.equal(page.provider_request_performed, false);
    all.push(...page.tokens); cursor = page.pagination.next_cursor;
  }
  assert.equal(all.length, 850);
  assert.equal(new Set(all.map(row => row.mint)).size, 850);
  assert.equal(providerCalls, 2);
  const denied = await routeCustomerWalletCopy(request(`/api/v1/wallet-copy/wallets/${result.source_wallet_id}/holdings`), env({RAVENOS_WALLET_INTELLIGENCE_ENABLED:'0'}), deps(store, provider));
  assert.equal(denied.status, 503);
});

test("basic EVM profiles use the same balance continuation as Pro without returning Pro analysis", async () => {
  const store = memoryStore();
  const source = { chain: "base", network: "mainnet", chain_id: 8453, address: `0x${"12".repeat(20)}` };
  const sourceId = createSourceWalletId(source);
  await store.upsertSourceWallet({ ...source, source_wallet_id: sourceId, now: NOW, state: "current" });
  const tokens = Array.from({ length: 110 }, (_, index) => ({ contract: `0x${index.toString(16).padStart(40, "0")}`, balance_display: "3", provider_mark_value_usd: index }));
  store.profiles.set(sourceId, { schema_version: "fixture-evm-profile", source_wallet: source, generated_at: new Date(NOW * 1000).toISOString(),
    balances_observed_at: new Date((NOW - 30) * 1000).toISOString(), positions: { provider_reported_token_balances: tokens },
    mark_coverage: { unavailable: [] }, trading_record: { pro_only: true } });
  const activeEnv = env({ RAVENOS_WALLET_SCREENER_ENABLED: "1" });
  const result = await json(await routeCustomerWalletCopy(request(`/api/v1/wallet-copy/wallets/${sourceId}`), activeEnv, deps(store, null, [])));
  assert.equal(result.profile.trading_record, undefined);
  assert.equal(result.profile.holdings_page.total, 110);
  const continuation = await routeCustomerWalletCopy(request(`/api/v1/wallet-copy/wallets/${sourceId}/holdings?cursor=${result.profile.holdings_page.next_cursor}`), activeEnv, deps(store, null, []));
  assert.equal(continuation.status, 200, await continuation.clone().text());
  assert.equal((await json(continuation)).tokens.length, 50);
  const invalid = await routeCustomerWalletCopy(request(`/api/v1/wallet-copy/wallets/${sourceId}/holdings?cursor=bad`), activeEnv, deps(store, null, []));
  assert.equal(invalid.status, 400);
});

test('Copy applies an owned saved strategy version and library edits cannot silently change a watch', async () => {
  const store = memoryStore();
  const strategy = {schema_version:'ravenos.exit_strategy.v1',id:'mine',name:'My exits',version:1,rules:[{id:'tp',kind:'take_profit',trigger_pct:80,sell_pct:50},{id:'sl',kind:'stop_loss',trigger_pct:20,sell_pct:100}]};
  let library = {settings_json:JSON.stringify({strategies:[strategy]})};
  const d = {...deps(store,null),settingsStore:{get:async user=>user===USER?library:null}};
  const created=await routeCustomerWalletCopy(request('/api/v1/wallet-copy/watches',{method:'POST',body:{address:WALLET,policy:{exit_strategy:strategy}}}),env(),d);
  assert.equal(created.status,201);const watch=(await json(created)).watch;
  assert.equal(watch.policy.exit_strategy.version,1);
  library={settings_json:JSON.stringify({strategies:[{...strategy,name:'Changed in library',version:2}]})};
  const listed=await json(await routeCustomerWalletCopy(request('/api/v1/wallet-copy/watches'),env(),d));
  assert.equal(listed.watches[0].policy.exit_strategy.name,'My exits');
  const forged={...strategy,name:'Not saved'};
  const bad=await routeCustomerWalletCopy(request(`/api/v1/wallet-copy/watches/${watch.watch_id}`,{method:'PATCH',body:{expected_revision:watch.revision,policy:{...watch.policy,exit_strategy:forged}}}),env(),d);
  assert.equal(bad.status,409);
  const update=await routeCustomerWalletCopy(request(`/api/v1/wallet-copy/watches/${watch.watch_id}`,{method:'PATCH',body:{expected_revision:watch.revision,policy:{...watch.policy,exit_strategy:{...strategy,name:'Changed in library',version:2}}}}),env(),d);
  assert.equal(update.status,200);assert.equal((await json(update)).watch.policy.exit_strategy.version,2);
  library=null;
  const unchanged=await json(await routeCustomerWalletCopy(request('/api/v1/wallet-copy/watches'),env(),d));
  assert.equal(unchanged.watches[0].policy.exit_strategy.version,2);
  assert.equal(unchanged.watches[0].policy.execution_boundary.live_copy_available,false);
});

test('wallet groups join only exact cached identities and never initiate observation or copying',async()=>{
  const source={chain:'solana',network:'mainnet',address:WALLET},id=createSourceWalletId(source),store=memoryStore();
  const card={schema_version:2,expires_at:new Date(NOW*1000+3600000).toISOString(),profile_id:'wallet_patient',chain:'solana',address:WALLET,display_name:'Wallet',categories:['Patient top holders'],summary:'PRIVATE_SUMMARY',data_status:'historical',actions:['view_profile','open_copy_setup']};
  const cards=[card,...Array.from({length:9},(_,i)=>({...card,profile_id:`wallet_patient_${i}`,address:bs58.encode(Buffer.alloc(32,i+80))}))];
  const snapshot={schema_version:PUBLIC_WALLET_SNAPSHOT_SCHEMA,generated_at:new Date(NOW*1000).toISOString(),cards,groups:[{group_id:'group_patient',title:'Patient top holders',chain:'all',profile_ids:cards.map(c=>c.profile_id)}]};
  store.sources.set(id,{source_wallet_id:id,address:WALLET,chain:'solana',network:'mainnet',profile_json:JSON.stringify({source_wallet:source,behavior:{trade_count:7,last_trade_at:new Date(NOW*1000).toISOString(),lineage:'PRIVATE_INPUT'},source_performance:{win_rate_pct:60},research_thesis:{private:'PRIVATE_INPUT'}})});
  let reads=0;
  const dependencies={...deps(store,{getWalletHistory(){throw Error('must not look up history');}}),walletCardsFetch:async()=>{reads++;return new Response(JSON.stringify(snapshot),{headers:{'content-type':'application/json'}});}};
  const environment=env({RAVENOS_WALLET_SCREENER_ENABLED:'1',RAVENOS_WALLET_GROUPS_ENABLED:'1',RAVENOS_PUBLIC_ORIGIN_TOKEN:'unit-token',RAVENOS_PUBLIC_ORIGIN_URL:'https://origin.example/public/ravenos'});
  const response=await routeCustomerWalletCopy(request('/api/v1/wallet-copy/groups?history=all'),environment,dependencies);
  assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private.*no-store/);
  const body=await json(response);assert.equal(body.rows[0].source_wallet_id,id);assert.equal(body.rows[0].behavior.trade_count,7);
  assert.equal(body.rows[0].public_summary.data_status,'historical');assert.deepEqual(body.rows[0].public_summary.categories,['Patient top holders']);
  assert.equal(body.groups[0].count,10);assert.ok(!JSON.stringify(body).includes('PRIVATE_'));
  assert.equal(body.rows[0].public_summary.expires_at,card.expires_at);assert.equal(body.as_of,new Date(NOW*1000).toISOString());
  assert.equal(store.watches.size,0);assert.equal(store.events.size,0);assert.equal(store.profiles.size,0);assert.equal(reads,1);
  const fresh=await json(await routeCustomerWalletCopy(request('/api/v1/wallet-copy/groups'),environment,dependencies));
  assert.equal(fresh.state,'building');assert.deepEqual(fresh.groups,[]);assert.equal(reads,1);
  store.sources.get(id).profile_json=JSON.stringify({source_wallet:{chain:'base',network:'mainnet',address:`0x${'1'.repeat(40)}`},behavior:{trade_count:999}});
  const noWrongJoin=await json(await routeCustomerWalletCopy(request('/api/v1/wallet-copy/groups?history=all'),environment,dependencies));
  assert.equal(noWrongJoin.rows[0].behavior,undefined);
  assert.equal((await routeCustomerWalletCopy(request('/api/v1/wallet-copy/groups?lineage=private'),environment,dependencies)).status,400);
  assert.equal((await routeCustomerWalletCopy(request('/api/v1/wallet-copy/groups',{origin:'https://ravenos.xyz'}),environment,dependencies)).status,403);
  assert.equal((await routeCustomerWalletCopy(request('/api/v1/wallet-copy/groups'),{...environment,RAVENOS_WALLET_GROUPS_ENABLED:'0'},dependencies)).status,503);
  assert.equal(reads,1);
});
