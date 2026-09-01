import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import bs58 from "bs58";

import {
  SOURCE_WALLET_BACKFILL_JOB_SCHEMA,
  SOURCE_WALLET_BACKFILL_RUN_SCHEMA,
  SourceWalletBackfillLimits,
  createD1SourceWalletBackfillStore,
  createSourceWalletBackfillJob,
  runSourceWalletBackfillBatch,
} from "../lib/customer_trade/source_wallet_backfill.mjs";

const NOW = "2026-09-01T08:00:00.000Z";
const WALLET = bs58.encode(Buffer.alloc(32, 101));

function signature(index) {
  const bytes = Buffer.alloc(64);
  bytes.writeUInt32BE(index, 60);
  return bs58.encode(bytes);
}

function signatureRow(index, slot = 10_000 - index) {
  return {
    signature: signature(index),
    slot,
    blockTime: Math.floor(Date.parse(NOW) / 1_000) - index,
    confirmationStatus: "confirmed",
    err: null,
  };
}

function transaction(row) {
  return {
    slot: row.slot,
    blockTime: row.blockTime,
    transaction: {
      message: {
        accountKeys: [{ pubkey: WALLET, signer: true }],
        instructions: [],
      },
    },
    meta: {
      err: null,
      fee: 5_000,
      preBalances: [1_000_000_000],
      postBalances: [999_995_000],
      preTokenBalances: [],
      postTokenBalances: [],
      innerInstructions: [],
      logMessages: [],
    },
  };
}

function memoryStore(jobInput = createSourceWalletBackfillJob({ address: WALLET, requested_at: NOW })) {
  let job = { ...jobInput };
  const pages = [];
  const events = new Map();
  const retries = [];
  return {
    pages,
    events,
    retries,
    current() { return job; },
    async leaseJobs() {
      if (!new Set(["queued", "retry_wait"]).has(job.state)) return [];
      job = { ...job, state: "leased", attempt_count: job.attempt_count + 1, lease_token: "lease_fixture_1234567890", updated_at: NOW };
      return [job];
    },
    async recordPage(page) { pages.push(page); },
    async recordEvents(sourceId, rows) {
      for (const row of rows) events.set(`${sourceId}:${row.event_id}`, row);
      return rows.map((row) => row.event_id);
    },
    async advanceJob(input) {
      job = {
        ...job,
        ...Object.fromEntries(Object.entries(input).filter(([key]) => !new Set(["job", "now"]).has(key))),
        state: input.state,
        lease_token: input.state === "leased" ? job.lease_token : null,
        updated_at: new Date(input.now).toISOString(),
      };
      return job;
    },
    async retryJob(input) {
      retries.push(input);
      job = {
        ...job,
        state: input.dead_letter ? "dead_letter" : "retry_wait",
        lease_token: null,
        updated_at: new Date(input.now).toISOString(),
      };
    },
  };
}

function deps(fetchSignatures, hydrateTransaction = async ({ signature_record: row }) => transaction(row)) {
  return {
    now: () => NOW,
    fetchSignatures,
    hydrateTransaction,
  };
}

test("backfill job identity is exact, shared, and contains no execution authority", () => {
  const job = createSourceWalletBackfillJob({ address: WALLET, requested_at: NOW });
  assert.equal(job.schema_version, SOURCE_WALLET_BACKFILL_JOB_SCHEMA);
  assert.match(job.job_id, /^swb_[a-f0-9]{40}$/);
  assert.equal(job.source_wallet.address, WALLET);
  assert.equal(job.state, "queued");
  assert.equal(job.execution_boundary.broadcasting, false);
});

test("resumable backfill advances complete pages and marks true provider exhaustion", async () => {
  const firstPage = Array.from({ length: SourceWalletBackfillLimits.page_size }, (_, index) => signatureRow(index + 1));
  const lastPage = [signatureRow(101, 9_899), signatureRow(102, 9_898)];
  const store = memoryStore();
  const calls = [];
  const run = await runSourceWalletBackfillBatch(store, deps(async ({ before, limit }) => {
    calls.push({ before, limit });
    return before ? lastPage : firstPage;
  }), { now: Date.parse(NOW), maximum_pages_per_job: 2 });
  assert.equal(run.schema_version, SOURCE_WALLET_BACKFILL_RUN_SCHEMA);
  assert.equal(run.totals.jobs_completed, 1);
  assert.equal(run.totals.pages_completed, 2);
  assert.equal(run.totals.signatures_seen, 102);
  assert.equal(store.events.size, 102);
  assert.equal(store.current().state, "complete");
  assert.equal(store.current().history_exhausted, true);
  assert.equal(store.current().cursor_before, signature(102));
  assert.equal(calls[1].before, signature(100));
  assert.equal(run.execution_boundary.live_copy, false);
});

test("partial transaction hydration records evidence but never advances the history cursor", async () => {
  const rows = [signatureRow(1), signatureRow(2)];
  const store = memoryStore();
  const run = await runSourceWalletBackfillBatch(store, deps(
    async () => rows,
    async ({ signature_record: row }) => {
      if (row.signature === signature(2)) throw new Error("https://rpc.example/?api-key=secret returned 503");
      return transaction(row);
    },
  ), { now: Date.parse(NOW), maximum_pages_per_job: 1 });
  assert.equal(run.totals.pages_partial, 1);
  assert.equal(run.totals.jobs_retried, 1);
  assert.equal(store.events.size, 1);
  assert.equal(store.current().state, "retry_wait");
  assert.equal(store.current().cursor_before, null);
  assert.equal(store.retries[0].error_code, "source_wallet_backfill_page_incomplete");
  assert.doesNotMatch(JSON.stringify(store.retries[0]), /api-key|secret|rpc\.example/i);
  assert.equal(store.pages[0].state, "partial");
  assert.equal(store.pages[0].failure_count, 1);
  assert.equal(store.pages[0].raw_provider_payload_persisted, false);
  assert.equal(JSON.stringify(store.pages[0]).includes(WALLET), false);
  assert.equal(JSON.stringify(store.pages[0]).includes(signature(1)), false);
});

test("provider exception text is reduced to a safe retry code", async () => {
  const store = memoryStore();
  const run = await runSourceWalletBackfillBatch(store, deps(async () => {
    throw new Error("https://rpc.example/?api-key=secret returned 503");
  }), { now: Date.parse(NOW) });
  assert.equal(run.totals.jobs_retried, 1);
  assert.equal(store.retries[0].error_code, "source_wallet_backfill_provider_failed");
  assert.doesNotMatch(JSON.stringify(store.retries[0]), /api-key|secret|rpc\.example/i);
});

test("malformed or out-of-order signature pages dead-letter instead of creating a history gap", async () => {
  const store = memoryStore();
  const run = await runSourceWalletBackfillBatch(store, deps(async () => [
    signatureRow(1, 100),
    signatureRow(2, 101),
  ]), { now: Date.parse(NOW) });
  assert.equal(run.totals.jobs_dead_lettered, 1);
  assert.equal(store.current().state, "dead_letter");
  assert.equal(store.pages.length, 0);
  assert.equal(store.events.size, 0);
});

test("bounded history is explicit and never relabeled complete", async () => {
  const base = createSourceWalletBackfillJob({ address: WALLET, requested_at: NOW });
  const store = memoryStore({
    ...base,
    signatures_seen: SourceWalletBackfillLimits.maximum_signatures_per_wallet - 1,
    transactions_decoded: SourceWalletBackfillLimits.maximum_signatures_per_wallet - 1,
  });
  const run = await runSourceWalletBackfillBatch(store, deps(async ({ limit }) => {
    assert.equal(limit, 1);
    return [signatureRow(9_999)];
  }), { now: Date.parse(NOW) });
  assert.equal(run.totals.jobs_bounded, 1);
  assert.equal(store.current().state, "bounded_partial");
  assert.equal(store.current().history_exhausted, false);
  assert.equal(store.current().signatures_seen, SourceWalletBackfillLimits.maximum_signatures_per_wallet);
});

test("backfill migration is shared, append-only, bounded, and contains no customer or execution authority", () => {
  const sql = readFileSync("customer-migrations/0011_source_wallet_backfill.sql", "utf8");
  assert.match(sql, /CREATE TABLE ravenos_source_wallet_backfill_jobs/i);
  assert.match(sql, /source_wallet_id TEXT NOT NULL UNIQUE REFERENCES ravenos_source_wallets/i);
  assert.match(sql, /'bounded_partial'/i);
  assert.match(sql, /signatures_seen BETWEEN 0 AND 10000/i);
  assert.match(sql, /history_exhausted = 0 OR state = 'complete'/i);
  assert.match(sql, /CREATE TABLE ravenos_source_wallet_backfill_pages/i);
  assert.match(sql, /CREATE TRIGGER ravenos_source_wallet_backfill_pages_append_only/i);
  assert.match(sql, /CREATE TRIGGER ravenos_source_wallet_backfill_runs_append_only/i);
  assert.match(sql, /raw_provider_payload_persisted'\) = 0/i);
  assert.match(sql, /transaction_material_persisted'\) = 0/i);
  const statements = sql.replace(/--.*$/gm, "");
  assert.doesNotMatch(statements, /\buser_id\b|private_key|seed_phrase|signer_material|serialized_transaction|transaction_hash/i);
  assert.doesNotMatch(statements, /raw_provider_payload\s+(?:TEXT|BLOB)/i);
});

test("D1 store shares one resumable job per source wallet and preserves its lease", async () => {
  let row = null;
  const sqlSeen = [];
  const addressBySource = new Map();
  const db = {
    prepare(sql) {
      sqlSeen.push(sql);
      return {
        bind(...bindings) {
          return {
            async first() {
              if (/SELECT j\.\*, s\.address/i.test(sql) && row?.job_id === bindings[0]) {
                return { ...row, address: addressBySource.get(row.source_wallet_id) };
              }
              return null;
            },
            async all() {
              if (/SELECT job_id FROM ravenos_source_wallet_backfill_jobs/i.test(sql) && row?.state === "queued") {
                return { results: [{ job_id: row.job_id }] };
              }
              return { results: [] };
            },
            async run() {
              if (/INSERT OR IGNORE INTO ravenos_source_wallet_backfill_jobs/i.test(sql)) {
                if (!row) {
                  const [jobId, sourceId, provider, nextAttemptAt, createdAt, updatedAt] = bindings;
                  row = {
                    job_id: jobId,
                    source_wallet_id: sourceId,
                    state: "queued",
                    provider,
                    cursor_before: null,
                    page_count: 0,
                    signatures_seen: 0,
                    transactions_decoded: 0,
                    decode_failures: 0,
                    history_exhausted: 0,
                    attempt_count: 0,
                    next_attempt_at: nextAttemptAt,
                    lease_token: null,
                    lease_expires_at: null,
                    created_at: createdAt,
                    updated_at: updatedAt,
                  };
                  addressBySource.set(sourceId, WALLET);
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              if (/state = 'leased', lease_token = \?/i.test(sql)) {
                const [leaseToken, leaseExpiresAt, updatedAt, jobId] = bindings;
                if (row?.job_id !== jobId || row.state !== "queued") return { meta: { changes: 0 } };
                row = {
                  ...row,
                  state: "leased",
                  lease_token: leaseToken,
                  lease_expires_at: leaseExpiresAt,
                  attempt_count: row.attempt_count + 1,
                  updated_at: updatedAt,
                };
                return { meta: { changes: 1 } };
              }
              if (/UPDATE ravenos_source_wallet_backfill_jobs SET\s+state = \?, cursor_before/i.test(sql)) {
                const [state, cursorBefore, pageCount, signaturesSeen, transactionsDecoded, decodeFailures, historyExhausted, attemptCount, nextAttemptAt, keepLease] = bindings;
                row = {
                  ...row,
                  state,
                  cursor_before: cursorBefore,
                  page_count: pageCount,
                  signatures_seen: signaturesSeen,
                  transactions_decoded: transactionsDecoded,
                  decode_failures: decodeFailures,
                  history_exhausted: historyExhausted,
                  attempt_count: attemptCount,
                  next_attempt_at: nextAttemptAt,
                  lease_token: keepLease ? row.lease_token : null,
                  lease_expires_at: keepLease ? row.lease_expires_at : null,
                };
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
  };
  const recorded = [];
  const store = createD1SourceWalletBackfillStore(db, {
    async record_events(sourceId, events) {
      recorded.push({ sourceId, events });
      return [];
    },
  });
  const now = Date.parse(NOW);
  const first = await store.enqueueJob({ address: WALLET, now });
  const duplicate = await store.enqueueJob({ address: WALLET, now: now + 1_000 });
  assert.equal(first.job_id, duplicate.job_id);
  const [leased] = await store.leaseJobs({ worker_id: "backfill_fixture", now, limit: 1, lease_seconds: 180 });
  assert.equal(leased.state, "leased");
  assert.match(leased.lease_token, /^backfill_fixture:/);
  const advanced = await store.advanceJob({
    job: leased,
    state: "queued",
    cursor_before: signature(1),
    page_count: 1,
    signatures_seen: 1,
    transactions_decoded: 1,
    decode_failures: 0,
    history_exhausted: false,
    now,
  });
  assert.equal(advanced.state, "queued");
  assert.equal(advanced.cursor_before, signature(1));
  assert.equal(advanced.lease_token, null);
  assert.equal(advanced.attempt_count, 0);
  assert.equal(recorded.length, 0);
  assert.doesNotMatch(sqlSeen.join("\n"), /SELECT\s+.*\buser_id\b|policy_json|private_key|transaction_hash/i);
});
