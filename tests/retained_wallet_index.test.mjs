import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import bs58 from "bs58";
import { createD1CustomerWalletCopyStore } from "../lib/customer_wallet_copy.mjs";
import { normalizeWalletScreenerRequest } from "../lib/customer_trade/wallet_screener.mjs";
import { createD1SourceWalletDiscoveryStore } from "../lib/customer_trade/source_wallet_discovery_admission.mjs";
import { prepareRetainedWalletImport } from "../scripts/import-retained-wallet-observations.mjs";

function d1(db) {
  return { prepare(sql) {
    const statement = (params = []) => ({ bind: (...args) => statement(args),
      first: async () => db.prepare(sql).get(...params) || null,
      all: async () => ({ results: db.prepare(sql).all(...params) }),
      run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...params).changes) } }) });
    return statement();
  } };
}

test("retained wallet browse combines chains, deduplicates identities and separates unanalysed observations", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE ravenos_source_wallets (source_wallet_id TEXT, chain TEXT, network TEXT, address TEXT, last_observed_at INTEGER);
    CREATE TABLE ravenos_source_wallet_discovery_candidates (source_wallet_id TEXT, chain TEXT, network TEXT, address TEXT, last_observed_at INTEGER);
    CREATE TABLE ravenos_source_wallet_profiles (profile_snapshot_id TEXT, schema_version TEXT);
    CREATE TABLE ravenos_wallet_discovery_sources (source_wallet_id TEXT,source_kind TEXT,priority INTEGER,expires_at INTEGER);
    CREATE TABLE ravenos_source_wallet_current_profiles (source_wallet_id TEXT, generated_at INTEGER, profile_snapshot_id TEXT);
    INSERT INTO ravenos_source_wallets VALUES ('base1','base','mainnet','0x1111111111111111111111111111111111111111',100), ('eth1','ethereum','mainnet','0x1111111111111111111111111111111111111111',101), ('sol1','solana','mainnet','sol-address',102);
    INSERT INTO ravenos_source_wallet_discovery_candidates VALUES ('sol1','solana','mainnet','sol-address',103);
    INSERT INTO ravenos_source_wallet_profiles VALUES ('profile1','ravenos.source_wallet_chain_profile.v1');
    INSERT INTO ravenos_source_wallet_current_profiles VALUES ('base1',104,'profile1');
    ALTER TABLE ravenos_source_wallet_profiles ADD COLUMN source_wallet_id TEXT;
    ALTER TABLE ravenos_source_wallet_profiles ADD COLUMN history_start_at INTEGER;
    ALTER TABLE ravenos_source_wallet_current_profiles ADD COLUMN realized_pnl_usdc REAL;
    ALTER TABLE ravenos_source_wallet_current_profiles ADD COLUMN realized_pnl_sol REAL;
    ALTER TABLE ravenos_source_wallet_current_profiles ADD COLUMN closed_lots INTEGER;
    ALTER TABLE ravenos_source_wallet_current_profiles ADD COLUMN source_history_complete INTEGER;
    CREATE TABLE ravenos_source_wallet_events (source_wallet_id TEXT, transaction_reference TEXT, block_time INTEGER, chain_event_time INTEGER, retention_expires_at INTEGER);`);
  const store = createD1CustomerWalletCopyStore(d1(db));
  const all = await store.listSeenWallets(normalizeWalletScreenerRequest({ chain: "all" }));
  assert.equal(all.total, 2);
  assert.deepEqual(all.rows.map(row => row.source_wallet_id), ["sol1", "eth1"]);
  assert.equal(all.provider_request_performed, false);
  assert.equal(all.performance_filters_applied, false);
  assert.ok(all.rows.every(row => row.performance_claimed === false && row.copyability_claimed === false));
  const eth = await store.listSeenWallets(normalizeWalletScreenerRequest({ chain: "ethereum" }));
  assert.equal(eth.total, 1);
  assert.equal(eth.rows[0].source_wallet.chain, "ethereum");
  const coverage = await store.walletIndexCoverage();
  assert.equal(coverage.chains.reduce((sum, row) => sum + row.seen_wallets, 0), 3);
  assert.equal(coverage.chains.find(row => row.chain === "base").indexed_wallets, 1);
  db.close();
});

test("archive import uses the existing append-only discovery ledger and replay creates no duplicates or history jobs", async () => {
  const db = new DatabaseSync(":memory:");
  for (const name of readdirSync("customer-migrations").filter(name => /^\d+.*\.sql$/.test(name)).sort()) db.exec(readFileSync(`customer-migrations/${name}`, "utf8"));
  const wallet = bs58.encode(Buffer.alloc(32, 91));
  const event = { event: "solana_grpc_transaction", provider: "constant_k", ts: "2026-09-06T10:00:00Z", slot: "100", signature: bs58.encode(Buffer.alloc(64, 31)),
    failed: false, is_vote: false, signer_accounts: [wallet], programs: ["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"],
    joint_entity_required_signer_accounts_complete: true, joint_entity_token_balance_deltas_complete: true, joint_entity_token_balance_delta_economics_complete: true,
    joint_entity_token_balance_deltas: [
      { owner: wallet, mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", delta_raw: "-1000000", token_balance_economics_complete: true },
      { owner: wallet, mint: bs58.encode(Buffer.alloc(32, 92)), delta_raw: "1000", token_balance_economics_complete: true },
    ] };
  const prepared = prepareRetainedWalletImport([event, event]);
  assert.equal(prepared.counts.unique_candidates, 1);
  assert.equal(prepared.boundary.provider_requests, 0);
  assert.equal(prepared.boundary.history_hydration, false);
  assert.deepEqual(prepared.batches, prepareRetainedWalletImport([event, event]).batches);
  const store = createD1SourceWalletDiscoveryStore(d1(db));
  const batch = prepared.batches[0];
  const options = { body_sha256: createHash("sha256").update(JSON.stringify(batch)).digest("hex"), key_id: "archive_test" };
  const first = await store.ingestBatch(batch, options);
  const replay = await store.ingestBatch(batch, options);
  assert.equal(first.inserted_count, 1);
  assert.equal(replay.replayed, true);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ravenos_source_wallet_discovery_observations").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ravenos_source_wallet_profiles").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ravenos_source_wallet_backfill_jobs").get().n, 0);
  db.close();
});
