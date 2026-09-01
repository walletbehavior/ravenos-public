import assert from "node:assert/strict";
import test from "node:test";

import bs58 from "bs58";

import { createD1CustomerWalletCopyStore } from "../lib/customer_wallet_copy.mjs";
import { runConstantKNexusWalletPipelineCycle } from "../lib/customer_trade/constant_k_nexus_wallet_pipeline.mjs";
import {
  SOURCE_WALLET_WATCH_MANIFEST_ACK_SCHEMA,
  SourceWalletWatchManifestLimits,
  buildSourceWalletWatchManifest,
  normalizeSourceWalletWatchManifestAck,
  summarizeSourceWalletWatchManifest,
} from "../lib/customer_trade/source_wallet_watch_manifest.mjs";

const NOW = "2026-09-01T07:00:00.000Z";

function wallet(index) {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32BE(index, 28);
  return bs58.encode(bytes);
}

function signature(index) {
  const bytes = Buffer.alloc(64);
  bytes.writeUInt32BE(index, 60);
  return bs58.encode(bytes);
}

function ack(manifest, overrides = {}) {
  return {
    schema_version: SOURCE_WALLET_WATCH_MANIFEST_ACK_SCHEMA,
    active_manifest_hash: manifest.manifest_hash,
    coverage_state: "current",
    wallet_count: manifest.wallet_count,
    shard_count: manifest.shard_count,
    activated_at: NOW,
    ...overrides,
  };
}

test("private watch manifest is deterministic, bounded, and strips subscriber state", () => {
  const first = wallet(1);
  const second = wallet(2);
  const manifest = buildSourceWalletWatchManifest([
    { address: second, user_id: "must_not_escape", policy: { private: true } },
    { address: first, follower_count: 99 },
    { address: second, cursor_slot: 4, cursor_signature: signature(4) },
  ], { generated_at: NOW });
  const replay = buildSourceWalletWatchManifest([first, second], { generated_at: NOW });
  assert.equal(manifest.wallet_count, 2);
  assert.equal(manifest.manifest_hash, replay.manifest_hash);
  assert.ok(manifest.shards.every((row) => row.wallet_count <= SourceWalletWatchManifestLimits.maximum_accounts_per_filter));
  assert.deepEqual(manifest.shards.flatMap((row) => row.addresses).sort(), [first, second].sort());
  assert.equal(JSON.stringify(manifest).includes("must_not_escape"), false);
  assert.equal(JSON.stringify(manifest).includes('"follower_count":'), false);
  assert.equal(JSON.stringify(manifest).includes('"policy":'), false);
  const summary = summarizeSourceWalletWatchManifest(manifest);
  assert.equal(summary.wallet_count, 2);
  assert.equal(JSON.stringify(summary).includes(first), false);
});

test("manifest refuses oversized universes and requires an exact active-provider acknowledgement", () => {
  const tooMany = Array.from({ length: SourceWalletWatchManifestLimits.maximum_wallets + 1 }, (_, index) => wallet(index + 1));
  assert.throws(() => buildSourceWalletWatchManifest(tooMany, { generated_at: NOW }), /observer_watch_universe_too_large/);
  const manifest = buildSourceWalletWatchManifest([wallet(1)], { generated_at: NOW });
  assert.throws(() => normalizeSourceWalletWatchManifestAck(ack(manifest, { active_manifest_hash: "wrong" }), manifest), /source_wallet_manifest_not_active/);
  assert.throws(() => normalizeSourceWalletWatchManifestAck(ack(manifest, { wallet_count: 2 }), manifest), /source_wallet_manifest_ack_mismatch/);
});

test("pipeline activates the exact Nexus manifest before queueing reduced observer deliveries", async () => {
  const watched = wallet(91);
  const rowSignature = signature(91);
  const calls = [];
  let saved = null;
  const result = await runConstantKNexusWalletPipelineCycle({
    now: () => NOW,
    async load_watch_universe() { calls.push("load"); return [watched]; },
    async sync_watch_manifest(manifest) { calls.push("sync"); return ack(manifest); },
    async load_checkpoint() { calls.push("checkpoint"); return null; },
    async read_batch() {
      calls.push("read");
      return {
        source_id: "constant_k_compact_transaction_log",
        events: [{
          event: "solana_grpc_transaction",
          provider: "constant_k",
          ts: "2026-09-01T06:59:59.500Z",
          slot: "443340091",
          signature: rowSignature,
          signer_accounts: [watched],
        }],
        cursor: { device: 1, inode: 2, offset: 100 },
        continuity: "continuous",
        initial_history_truncated: false,
        event_rows: 1,
        lines_committed: 1,
        bytes_read: 100,
        bytes_committed: 100,
        parse_failures: 0,
        oversized_lines: 0,
        raw_lines_returned: false,
        raw_provider_payload_persisted: false,
      };
    },
    async ingest_delivery() { calls.push("ingest"); },
    async save_checkpoint(value) { calls.push("save"); saved = value; },
  });
  assert.deepEqual(calls, ["load", "sync", "checkpoint", "read", "ingest", "save"]);
  assert.equal(result.coverage.exact_manifest_confirmed, true);
  assert.equal(result.receiver.transport.counts.deliveries_ingested, 1);
  assert.equal(saved.watch_universe_hash, result.manifest.manifest_hash.slice(0, 24));
  assert.equal(result.execution_boundary.live_copy, false);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(watched), false);
  assert.equal(serialized.includes(rowSignature), false);
});

test("pipeline refuses stale coverage before it reads or advances the receiver", async () => {
  let reads = 0;
  await assert.rejects(() => runConstantKNexusWalletPipelineCycle({
    now: () => NOW,
    async load_watch_universe() { return [wallet(1)]; },
    async sync_watch_manifest(manifest) { return ack(manifest, { coverage_state: "pending" }); },
    async load_checkpoint() { return null; },
    async read_batch() { reads += 1; },
    async ingest_delivery() {},
    async save_checkpoint() {},
  }), /source_wallet_manifest_not_active/);
  assert.equal(reads, 0);
});

test("D1 watch-universe query returns exact addresses without subscriber rows or policies", async () => {
  const captured = [];
  const db = {
    prepare(sql) {
      captured.push(sql);
      return {
        bind(limit) {
          assert.equal(limit, 11);
          return { async all() { return { results: [{ address: wallet(1) }, { address: wallet(2) }] }; } };
        },
      };
    },
  };
  const rows = await createD1CustomerWalletCopyStore(db).listObserverWatchUniverse(10);
  assert.deepEqual(rows, [wallet(1), wallet(2)]);
  assert.match(captured[0], /SELECT s\.address/i);
  assert.match(captured[0], /w\.state = 'active'/i);
  assert.doesNotMatch(captured[0], /SELECT\s+.*user_id/i);
  assert.doesNotMatch(captured[0], /policy_json|follower_count/i);
});
