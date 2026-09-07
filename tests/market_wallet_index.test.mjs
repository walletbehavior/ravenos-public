import assert from "node:assert/strict";
import test from "node:test";
import bs58 from "bs58";
import { sqliteStore } from "./customer_pro_rewards.test.mjs";
import { createD1CustomerWalletCopyStore } from "../lib/customer_wallet_copy.mjs";
import { observedMarketWallets, retainMarketWallets } from "../lib/customer_trade/market_wallet_index.mjs";

const NOW = 1788793200;
const address = n => bs58.encode(Buffer.alloc(32, n));
const wallet = address(7);
const projection = (chain = "solana") => ({
  ok: true, safe_public: true, schema_version: "ravenos.onchain_holder_list.v2",
  identity: { chain, pool_address: chain === "solana" ? address(3) : "0x" + "33".repeat(32), token_address: chain === "solana" ? address(4) : "0x" + "44".repeat(20) },
  observed_at: new Date(NOW * 1000).toISOString(),
  holders: [{ holder_address: chain === "solana" ? wallet : "0x" + "77".repeat(20), classification: "owner" }],
});
const active = db => ({ RAVENOS_CUSTOMER_DB: db, RAVENOS_WALLET_INTELLIGENCE_ENABLED: "1", RAVENOS_WALLET_SCREENER_ENABLED: "1" });

test("retained market observations populate the existing Solana and Robinhood index without creating history or watches", async () => {
  const db = sqliteStore(); const store = createD1CustomerWalletCopyStore(db);
  for (const chain of ["solana", "robinhood"]) {
    const result = await retainMarketWallets(active(db), projection(chain), store, { now: NOW });
    assert.equal(result.retained, 1); assert.equal(result.provider_requests, 0); assert.equal(result.history_queued, false);
    const seen = await store.listSeenWallets({ chain, page_size: 12, offset: 0 });
    assert.equal(seen.total, 1); assert.equal(seen.rows[0].source_wallet.chain, chain);
  }
  for (const table of ["ravenos_source_wallet_profiles", "ravenos_source_wallet_backfill_jobs", "ravenos_customer_wallet_copy_watches"]) assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
});

test("public pool accounts, token accounts, contracts, mints and invalid owners do not become seen wallets", () => {
  const p = projection();
  p.holders.push(...["contract", "token_account", "exact_pool_account"].map(classification => ({ holder_address: address(8), classification })));
  p.holders.push({ holder_address: p.identity.token_address, classification: "owner" }, { holder_address: "invalid", classification: "owner" }, { holder_address: address(9), classification: "owner", excluded_from_wallet_concentration: true });
  assert.deepEqual(observedMarketWallets(p, { now: NOW }).map(row => row.address), [wallet]);
});

test("seen-wallet admission is bounded, deduplicated, chain-correct and rejects stale or unknown projections", () => {
  const p = projection(); p.holders = Array.from({ length: 50 }, (_, i) => ({ holder_address: address(i + 5), classification: "owner" }));
  assert.equal(observedMarketWallets(p, { now: NOW }).length, 20);
  for (const changed of [{ ok: false }, { safe_public: false }, { schema_version: "unknown" }, { observed_at: new Date((NOW - 86401) * 1000).toISOString() }, { observed_at: new Date((NOW + 120) * 1000).toISOString() }, { identity: { ...p.identity, chain: "base" } }]) assert.deepEqual(observedMarketWallets({ ...p, ...changed }, { now: NOW }), []);
});

test("trade-sender observations retain address provenance without claiming trade reconstruction", () => {
  const p = { ...projection(), schema_version: "ravenos.onchain_pool_trades.v1", trades: [{ trader_address: wallet, observed_at: new Date(NOW * 1000).toISOString() }, { trader_address: wallet, observed_at: new Date((NOW - 60) * 1000).toISOString() }] };
  const rows = observedMarketWallets(p, { now: NOW });
  assert.equal(rows.length, 1); assert.equal(rows[0].observed_at, NOW); assert.equal(rows[0].provider_scope, "retained_public_trade_senders");
});

test("repeated cached page reads throttle writes and database failure permits retry", async () => {
  const db = {}; let calls = 0; let broken = true;
  const store = { async recordSeenMarketWallet() { calls++; if (broken) throw Error("unavailable"); } };
  assert.equal((await retainMarketWallets(active(db), projection(), store, { now: NOW })).retained, 0);
  broken = false;
  await retainMarketWallets(active(db), projection(), store, { now: NOW });
  await retainMarketWallets(active(db), projection(), store, { now: NOW + 10 });
  assert.equal(calls, 2);
  assert.equal((await retainMarketWallets({ ...active(db), RAVENOS_WALLET_SCREENER_ENABLED: "0" }, projection(), store, { now: NOW + 310 })).state, "disabled");
});

test("market observations preserve decoded observer cursors and cannot create duplicate identities", async () => {
  const db = sqliteStore(); const store = createD1CustomerWalletCopyStore(db);
  const row = observedMarketWallets(projection(), { now: NOW })[0];
  await store.recordSeenMarketWallet(row, NOW);
  await store.recordSeenMarketWallet(row, NOW);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM ravenos_source_wallets").get().n, 1);
  await store.updateSourceCursor(row.source_wallet_id, { state: "current", last_observed_at: NOW, last_signature: "5".repeat(88), now: NOW });
  await store.recordSeenMarketWallet({ ...row, observed_at: NOW + 600 }, NOW + 600);
  const saved = await store.getSourceWallet(row.source_wallet_id);
  assert.equal(saved.observation_state, "current"); assert.equal(saved.last_observed_at, NOW); assert.equal(saved.last_signature, "5".repeat(88));
});
