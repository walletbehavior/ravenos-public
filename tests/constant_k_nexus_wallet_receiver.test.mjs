import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import bs58 from "bs58";

import {
  CONSTANT_K_NEXUS_RECEIVER_CHECKPOINT_SCHEMA,
  CONSTANT_K_NEXUS_RECEIVER_RUN_SCHEMA,
  ConstantKNexusReceiverLimits,
  normalizeConstantKNexusReceiverCheckpoint,
  readConstantKNexusEventFileBatch,
  runConstantKNexusWalletReceiverCycle,
} from "../lib/customer_trade/constant_k_nexus_wallet_receiver.mjs";

const WALLET = bs58.encode(Buffer.alloc(32, 91));
const OTHER_WALLET = bs58.encode(Buffer.alloc(32, 92));
const NOW = "2026-09-01T06:00:00.000Z";

function signature(value) {
  return bs58.encode(Buffer.alloc(64, value));
}

function transaction({
  rowSignature = signature(1),
  slot = 443_340_000,
  wallet = WALLET,
  extra = {},
} = {}) {
  return {
    event: "solana_grpc_transaction",
    provider: "constant_k",
    ts: "2026-09-01T05:59:59.500Z",
    slot: String(slot),
    signature: rowSignature,
    signer_accounts: [wallet],
    matched_identity_signers: [wallet],
    programs: ["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"],
    accounts: [wallet, OTHER_WALLET],
    token_balance_deltas: [{ owner: wallet, mint: OTHER_WALLET, delta_raw: "10" }],
    ...extra,
  };
}

function line(row) {
  return `${JSON.stringify(row)}\n`;
}

function checkpoint(cursor, {
  initialHistoryTruncated = false,
  counters = {},
} = {}) {
  return {
    schema_version: CONSTANT_K_NEXUS_RECEIVER_CHECKPOINT_SCHEMA,
    source_id: "constant_k_compact_transaction_log",
    cursor,
    watch_universe_hash: "fixture_watch_hash",
    last_provider_slot: null,
    last_signature_reference: null,
    initial_history_truncated: initialHistoryTruncated,
    counters: {
      cycles: 0,
      bytes_committed: 0,
      lines_committed: 0,
      references_ingested: 0,
      invalid_lines: 0,
      ...counters,
    },
    created_at: NOW,
    updated_at: NOW,
  };
}

function cursorFor(path, offset = 0) {
  const row = statSync(path);
  return { device: Number(row.dev), inode: Number(row.ino), offset };
}

function tempFile(t, contents = "") {
  const directory = mkdtempSync(join(tmpdir(), "ravenos-nexus-receiver-"));
  const path = join(directory, "events.jsonl");
  writeFileSync(path, contents, { mode: 0o600 });
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return path;
}

function receiverBatch(events, cursor = { device: 1, inode: 2, offset: 3 }) {
  return {
    source_id: "constant_k_compact_transaction_log",
    events,
    cursor,
    continuity: "continuous",
    initial_history_truncated: false,
    event_rows: events.length,
    lines_committed: events.length,
    bytes_read: 1_000,
    bytes_committed: 1_000,
    parse_failures: 0,
    oversized_lines: 0,
    raw_lines_returned: false,
    raw_provider_payload_persisted: false,
  };
}

test("first receiver start tails current Nexus history without replaying it as prospective", (t) => {
  const path = tempFile(t, line(transaction()));
  const batch = readConstantKNexusEventFileBatch({ event_path: path, initial_position: "tail" });
  assert.equal(batch.continuity, "initial_tail");
  assert.equal(batch.initial_history_truncated, true);
  assert.equal(batch.events.length, 0);
  assert.equal(batch.bytes_committed, 0);
  assert.equal(batch.cursor.offset, statSync(path).size);
  assert.equal(JSON.stringify(batch).includes(WALLET), false);
});

test("explicit beginning mode consumes only newline-committed compact rows", (t) => {
  const first = transaction();
  const second = transaction({ rowSignature: signature(2), slot: 443_340_001 });
  const partial = JSON.stringify(second);
  const path = tempFile(t, `${line(first)}${partial}`);
  const batch = readConstantKNexusEventFileBatch({ event_path: path, initial_position: "beginning" });
  assert.equal(batch.events.length, 1);
  assert.equal(batch.lines_committed, 1);
  assert.equal(batch.cursor.offset, Buffer.byteLength(line(first)));
  appendFileSync(path, "\n");
  const resumed = readConstantKNexusEventFileBatch({ event_path: path, checkpoint: checkpoint(batch.cursor) });
  assert.equal(resumed.events.length, 1);
  assert.equal(resumed.events[0].signature, signature(2));
  assert.equal(resumed.cursor.offset, statSync(path).size);
});

test("file rotation remains continuous across the retained .1 segment", (t) => {
  const path = tempFile(t, line(transaction({ rowSignature: signature(3), slot: 443_340_003 })));
  const rotated = `${path}.1`;
  writeFileSync(rotated, line(transaction({ rowSignature: signature(2), slot: 443_340_002 })), { mode: 0o600 });
  const batch = readConstantKNexusEventFileBatch({
    event_path: path,
    checkpoint: checkpoint(cursorFor(rotated, 0)),
  });
  assert.equal(batch.continuity, "rotation_continuous");
  assert.deepEqual(batch.events.map((row) => row.signature), [signature(2), signature(3)]);
  assert.deepEqual(batch.cursor, cursorFor(path, statSync(path).size));
});

test("missing rotation continuity and in-place truncation fail without advancing", (t) => {
  const path = tempFile(t, line(transaction()));
  assert.throws(() => readConstantKNexusEventFileBatch({
    event_path: path,
    checkpoint: checkpoint({ device: 999, inode: 888, offset: 0 }),
  }), /constant_k_receiver_rotation_gap/);
  assert.throws(() => readConstantKNexusEventFileBatch({
    event_path: path,
    checkpoint: checkpoint(cursorFor(path, statSync(path).size + 1)),
  }), /constant_k_receiver_source_truncated/);
});

test("malformed and oversized lines are committed as degraded evidence, not retried forever", (t) => {
  const oversized = `{"payload":"${"x".repeat(ConstantKNexusReceiverLimits.maximum_line_bytes)}"}\n`;
  const path = tempFile(t, `${line(transaction())}{not-json}\n${oversized}`);
  const batch = readConstantKNexusEventFileBatch({
    event_path: path,
    initial_position: "beginning",
    maximum_bytes: ConstantKNexusReceiverLimits.maximum_bytes_per_cycle,
  });
  assert.equal(batch.events.length, 1);
  assert.equal(batch.parse_failures, 1);
  assert.equal(batch.oversized_lines, 1);
  assert.equal(batch.lines_committed, 3);
  assert.equal(batch.cursor.offset, statSync(path).size);
});

test("successful receiver cycle saves only a reduced checkpoint after every delivery is accepted", async () => {
  const saved = [];
  const deliveries = [];
  const row = transaction({ extra: { raw_provider_payload: { forbidden: true } } });
  const run = await runConstantKNexusWalletReceiverCycle({
    watches: [WALLET],
    now: () => NOW,
    async read_batch() { return receiverBatch([row]); },
    async ingest_delivery(delivery) { deliveries.push(delivery); },
    async save_checkpoint(value) { saved.push(value); },
  });
  assert.equal(run.schema_version, CONSTANT_K_NEXUS_RECEIVER_RUN_SCHEMA);
  assert.equal(run.state, "current");
  assert.equal(deliveries.length, 1);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].counters.references_ingested, 1);
  assert.equal(saved[0].last_provider_slot, 443_340_000);
  assert.match(saved[0].last_signature_reference, /^solana_signature_[a-f0-9]{24}$/);
  assert.equal(run.checkpoint.persisted, true);
  assert.equal(run.execution_boundary.live_copy, false);
  const serialized = JSON.stringify({ run, checkpoint: saved[0] });
  assert.equal(serialized.includes(WALLET), false);
  assert.equal(serialized.includes(signature(1)), false);
  assert.equal(serialized.includes("forbidden"), false);
});

test("any sink failure prevents checkpoint advancement and makes replay safe", async () => {
  let saves = 0;
  const rows = [
    transaction({ rowSignature: signature(4), slot: 443_340_004 }),
    transaction({ rowSignature: signature(5), slot: 443_340_005 }),
  ];
  let calls = 0;
  await assert.rejects(() => runConstantKNexusWalletReceiverCycle({
    watches: [WALLET],
    now: () => NOW,
    async read_batch() { return receiverBatch(rows); },
    async ingest_delivery() {
      calls += 1;
      if (calls === 1) throw new Error("fixture_sink_unavailable");
    },
    async save_checkpoint() { saves += 1; },
  }), /constant_k_receiver_ingest_incomplete/);
  assert.equal(calls, 2);
  assert.equal(saves, 0);
});

test("large watch universes are chunked so a worst-case signer burst cannot overflow the transport", async () => {
  const wallets = Array.from({ length: 250 }, (_, index) => bs58.encode(Buffer.alloc(32, index + 1)));
  const rows = Array.from({ length: 5 }, (_, index) => transaction({
    rowSignature: signature(index + 20),
    slot: 443_340_020 + index,
    wallet: wallets[0],
    extra: { signer_accounts: wallets, matched_identity_signers: wallets },
  }));
  let deliveries = 0;
  let saved = null;
  const run = await runConstantKNexusWalletReceiverCycle({
    watches: wallets,
    now: () => NOW,
    async read_batch() { return receiverBatch(rows); },
    async ingest_delivery() { deliveries += 1; },
    async save_checkpoint(value) { saved = value; },
  });
  assert.equal(run.transport.maximum_chunk_size, 4);
  assert.equal(run.transport.chunks, 2);
  assert.equal(deliveries, 1_250);
  assert.equal(saved.counters.references_ingested, 1_250);
  assert.equal(run.transport.counts.ingest_failures, 0);
});

test("receiver matches a thousand-plus wallet universe without subscriber-proportional delivery work", async () => {
  const wallets = Array.from({ length: 1_001 }, (_, index) => {
    const bytes = Buffer.alloc(32);
    bytes.writeUInt32BE(index + 1, 28);
    return bs58.encode(bytes);
  });
  const selected = wallets.at(-1);
  const rows = Array.from({ length: 5 }, (_, index) => transaction({
    rowSignature: signature(index + 40),
    slot: 443_340_040 + index,
    wallet: selected,
  }));
  let deliveries = 0;
  const run = await runConstantKNexusWalletReceiverCycle({
    watches: wallets,
    now: () => NOW,
    async read_batch() { return receiverBatch(rows); },
    async ingest_delivery() { deliveries += 1; },
    async save_checkpoint() {},
  });
  assert.equal(run.watch_universe_size, 1_001);
  assert.equal(run.transport.chunks, 1);
  assert.equal(run.transport.maximum_chunk_size, 5);
  assert.equal(run.transport.counts.references_received, 5);
  assert.equal(deliveries, 5);
});

test("restart from a saved file cursor ingests each new reference once", async (t) => {
  const path = tempFile(t, line(transaction({ rowSignature: signature(6), slot: 443_340_006 })));
  let currentCheckpoint = null;
  const deliveries = [];
  const run = () => runConstantKNexusWalletReceiverCycle({
    watches: [WALLET],
    checkpoint: currentCheckpoint,
    now: () => NOW,
    read_batch: ({ checkpoint: value }) => readConstantKNexusEventFileBatch({ event_path: path, checkpoint: value, initial_position: "tail" }),
    async ingest_delivery(delivery) { deliveries.push(delivery); },
    async save_checkpoint(value) { currentCheckpoint = value; },
  });
  const initial = await run();
  assert.equal(initial.state, "idle");
  assert.equal(initial.source.initial_history_truncated, true);
  appendFileSync(path, line(transaction({ rowSignature: signature(7), slot: 443_340_007 })));
  const observed = await run();
  assert.equal(observed.state, "current");
  assert.equal(deliveries.length, 1);
  assert.equal(currentCheckpoint.counters.references_ingested, 1);
  const idle = await run();
  assert.equal(idle.state, "idle");
  assert.equal(deliveries.length, 1);
  assert.equal(currentCheckpoint.counters.cycles, 3);
});

test("checkpoint schema and receiver bounds fail closed", async () => {
  assert.throws(() => normalizeConstantKNexusReceiverCheckpoint({}), /constant_k_receiver_checkpoint_invalid/);
  await assert.rejects(() => runConstantKNexusWalletReceiverCycle({
    watches: [WALLET],
    async read_batch() { return receiverBatch([]); },
    async ingest_delivery() {},
  }), /constant_k_receiver_checkpoint_store_unavailable/);
  await assert.rejects(() => runConstantKNexusWalletReceiverCycle({
    watches: [WALLET],
    async read_batch() { return receiverBatch(Array.from({ length: ConstantKNexusReceiverLimits.maximum_lines_per_cycle + 1 }, () => ({}))); },
    async ingest_delivery() {},
    async save_checkpoint() {},
  }), /constant_k_receiver_batch_too_large/);
  await assert.rejects(() => runConstantKNexusWalletReceiverCycle({
    watches: [WALLET],
    async read_batch() { return { ...receiverBatch([]), raw_provider_payload_persisted: true }; },
    async ingest_delivery() {},
    async save_checkpoint() {},
  }), /constant_k_receiver_batch_invalid/);
});
