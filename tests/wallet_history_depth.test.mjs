import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import bs58 from 'bs58';
import { createD1CustomerWalletCopyStore } from '../lib/customer_wallet_copy.mjs';
import { createD1SourceWalletBackfillStore, runSourceWalletBackfillBatch } from '../lib/customer_trade/source_wallet_backfill.mjs';
import { normalizeSourceWalletChainIdentity } from '../lib/customer_trade/source_wallet_chain_identity.mjs';

const NOW = Date.parse('2026-09-10T00:00:00Z');
const migration = readFileSync('customer-migrations/0050_wallet_history_depth.sql', 'utf8');
function database(t, { beforeUpgrade = false } = {}) {
  const raw = new DatabaseSync(':memory:'); t.after(() => raw.close());
  for (const name of readdirSync('customer-migrations').filter(n => /^\d+.*\.sql$/.test(n)).sort()) {
    if (beforeUpgrade && name.startsWith('0050')) continue;
    raw.exec(readFileSync(`customer-migrations/${name}`, 'utf8'));
  }
  return { raw, prepare(sql) { return { bind(...args) { return {
    async first() { return raw.prepare(sql).get(...args); },
    async all() { return { results: raw.prepare(sql).all(...args) }; },
    async run() { return { meta: { changes: Number(raw.prepare(sql).run(...args).changes) } }; },
  }; } }; }, async batch(statements) {
    raw.exec('BEGIN');
    try { const result = []; for (const statement of statements) result.push(await statement.run()); raw.exec('COMMIT'); return result; }
    catch (error) { raw.exec('ROLLBACK'); throw error; }
  } };
}
async function addJob(db, index, chain = 'solana') {
  const address = chain === 'solana' ? bs58.encode(Buffer.alloc(32, index)) : '0x' + index.toString(16).padStart(40, '0');
  const identity = normalizeSourceWalletChainIdentity({ chain, network: 'mainnet', address });
  const wallets = createD1CustomerWalletCopyStore(db);
  await wallets.upsertSourceWallet({ ...identity, now: NOW / 1000, state: 'requested', provider_scope: 'history' });
  const store = createD1SourceWalletBackfillStore(db, { record_events: wallets.recordEvents });
  const job = await store.enqueueJob({ chain, address, provider: chain === 'solana' ? 'helius_address_history' : 'alchemy_evm_history', demand_class: 'saved_research', now: NOW });
  return { job, store, address };
}

test('history migration preserves populated evidence, retries, leases and constraints; resumes only diagnosed ceiling failures', async t => {
  const db = database(t, { beforeUpgrade: true }), raw = db.raw, jobs = [];
  for (let i = 1; i <= 7; i++) jobs.push((await addJob(db, i, i === 5 ? 'base' : 'solana')).job);
  for (const job of jobs) raw.prepare(`UPDATE ravenos_source_wallet_backfill_jobs SET
    state='dead_letter',signatures_seen=10000,transactions_decoded=10000,page_count=20,
    history_target=50000,attempt_count=8,completed_at=?,last_error_code='source_wallet_backfill_provider_failed',
    cursor_before=?,provider_cursor_json=? WHERE job_id=?`).run(NOW / 1000, '1'.repeat(64), '{"pagination_token":"123456:9"}', job.job_id);
  raw.prepare('UPDATE ravenos_source_wallet_backfill_jobs SET signatures_seen=9999,transactions_decoded=9999 WHERE job_id=?').run(jobs[1].job_id);
  raw.prepare('UPDATE ravenos_source_wallet_backfill_jobs SET history_target=10000 WHERE job_id=?').run(jobs[2].job_id);
  raw.prepare("UPDATE ravenos_source_wallet_backfill_jobs SET state='leased',completed_at=NULL,lease_token=?,lease_expires_at=? WHERE job_id=?").run('lease_kept_' + 'a'.repeat(30), NOW / 1000 + 180, jobs[3].job_id);
  raw.prepare("UPDATE ravenos_source_wallet_backfill_jobs SET state='complete',history_exhausted=1 WHERE job_id=?").run(jobs[5].job_id);
  raw.prepare("UPDATE ravenos_source_wallet_backfill_jobs SET last_error_code='helius_history_http_503' WHERE job_id=?").run(jobs[6].job_id);
  for (const [i, job] of jobs.entries()) raw.prepare(`INSERT INTO ravenos_source_wallet_backfill_pages
    (page_id,job_id,source_wallet_id,cursor_before_reference,state,signature_count,decoded_count,failure_count,history_exhausted,page_hash,provider,evidence_json,observed_at)
    VALUES (?,?,?,'head','complete',500,500,0,0,?,'history',?,?)`).run('swbp_' + String(i + 1).padStart(40, '0'), job.job_id, job.source_wallet_id, String(i).repeat(40),
      '{"raw_provider_payload_persisted":false,"transaction_material_persisted":false,"subscriber_identity_included":false}', NOW / 1000);
  raw.prepare('INSERT INTO ravenos_wallet_reference_retries VALUES (?,?,?,\'pending\',2,\'evm_receipt_missing\',\'attempt_original\',?,?,?)')
    .run(jobs[4].job_id, '0x' + 'a'.repeat(64), '{"category":"erc20"}', NOW / 1000 + 600, NOW / 1000, NOW / 1000);
  const read = table => raw.prepare(`SELECT * FROM ${table} ORDER BY 1`).all().map(r => ({ ...r }));
  const beforeJobs = read('ravenos_source_wallet_backfill_jobs');
  const preserved = Object.fromEntries(['ravenos_source_wallet_backfill_pages', 'ravenos_wallet_reference_retries', 'ravenos_source_wallets'].map(table => [table, read(table)]));
  const indexes = raw.prepare("SELECT name,sql FROM sqlite_master WHERE tbl_name='ravenos_source_wallet_backfill_jobs' AND type IN ('index','trigger') ORDER BY name").all();
  assert.throws(() => raw.prepare('UPDATE ravenos_source_wallet_backfill_jobs SET signatures_seen=10001 WHERE job_id=?').run(jobs[0].job_id), /CHECK/);
  raw.exec('BEGIN'); raw.exec(migration); raw.exec('COMMIT');
  assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(), []);
  for (const [table, rows] of Object.entries(preserved)) assert.deepEqual(read(table), rows, table);
  assert.deepEqual(raw.prepare("SELECT name,sql FROM sqlite_master WHERE tbl_name='ravenos_source_wallet_backfill_jobs' AND type IN ('index','trigger') ORDER BY name").all(), indexes);
  const afterJobs = read('ravenos_source_wallet_backfill_jobs');
  for (const before of beforeJobs) {
    const after = afterJobs.find(j => j.job_id === before.job_id);
    if (before.job_id !== jobs[0].job_id) assert.deepEqual(after, before);
    else {
      assert.equal(after.state, 'queued'); assert.equal(after.attempt_count, 0); assert.equal(after.completed_at, null);
      for (const key of ['signatures_seen','transactions_decoded','cursor_before','provider_cursor_json','page_count','history_target']) assert.equal(after[key], before[key]);
    }
  }
  raw.prepare('UPDATE ravenos_source_wallet_backfill_jobs SET signatures_seen=50000,transactions_decoded=50000 WHERE job_id=?').run(jobs[0].job_id);
  assert.throws(() => raw.prepare('UPDATE ravenos_source_wallet_backfill_jobs SET signatures_seen=50001 WHERE job_id=?').run(jobs[0].job_id), /CHECK/);
  assert.throws(() => raw.prepare('UPDATE ravenos_source_wallet_backfill_jobs SET transactions_decoded=50001 WHERE job_id=?').run(jobs[0].job_id), /CHECK/);
  assert.throws(() => raw.prepare('UPDATE ravenos_source_wallet_backfill_jobs SET demand_priority=100 WHERE job_id=?').run(jobs[0].job_id), /priority_mismatch/);
  assert.throws(() => raw.exec('UPDATE ravenos_source_wallet_backfill_pages SET page_hash=page_hash'), /append_only/);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE '%m0050%'").get().n, 0);
});

function signature(index) { const bytes = Buffer.alloc(64); bytes.writeUInt32BE(index, 60); return bs58.encode(bytes); }
function page(address, count, token = '999999:2') {
  return { pagination_token: token, history_exhausted: false, rows: Array.from({ length: count }, (_, i) => {
    const slot = 999999 - i, blockTime = NOW / 1000 - i;
    return { signature: signature(i + 1), slot, blockTime, confirmationStatus: 'confirmed', err: null,
      transaction: { slot, blockTime, transaction: { message: { accountKeys: [{ pubkey: address, signer: true }], instructions: [] } },
        meta: { err: null, fee: 5000, preBalances: [1000000000], postBalances: [999995000], preTokenBalances: [], postTokenBalances: [], innerInstructions: [], logMessages: [] } } };
  }) };
}

test('Solana resumes beyond 10,000 with retained full-page data and stops exactly at its configured 50,000 bound', async t => {
  for (const [seen, pageSize] of [[10000, 500], [49999, 1]]) {
    const db = database(t), { job, store, address } = await addJob(db, 22);
    db.raw.prepare('UPDATE ravenos_source_wallet_backfill_jobs SET signatures_seen=?,transactions_decoded=?,provider_cursor_json=? WHERE job_id=?')
      .run(seen, seen, '{"pagination_token":"1000000:1"}', job.job_id);
    let requests = 0;
    const result = await runSourceWalletBackfillBatch(store, {
      now: () => NOW, fetchSignatures: async input => { requests++; assert.equal(input.pagination_token, '1000000:1'); assert.equal(input.limit, pageSize); return page(address, pageSize); },
      hydrateTransaction: async () => { throw Error('full page must not fan out into individual RPCs'); },
    }, { now: NOW, maximum_jobs: 1, maximum_pages_per_job: 1, solana_page_size: 500 });
    assert.equal(requests, 1); assert.equal(result.totals.transactions_decoded, pageSize);
    const retained = db.raw.prepare('SELECT * FROM ravenos_source_wallet_backfill_jobs WHERE job_id=?').get(job.job_id);
    assert.equal(retained.signatures_seen, seen + pageSize); assert.equal(retained.transactions_decoded, seen + pageSize);
    assert.equal(retained.state, seen === 10000 ? 'queued' : 'bounded_partial');
    assert.equal(retained.history_exhausted, 0); assert.equal(retained.last_error_code, null);
    assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM ravenos_source_wallet_events').get().n, pageSize);
  }
});

test('a checkpoint write failure retains its cursor, reports storage failure safely, and replays without duplicate events', async t => {
  const db = database(t), { job, store, address } = await addJob(db, 24);
  db.raw.prepare('UPDATE ravenos_source_wallet_backfill_jobs SET signatures_seen=10000,transactions_decoded=10000 WHERE job_id=?').run(job.job_id);
  let failOnce = true;
  const failingStore = { ...store, advanceJob: async input => {
    if (failOnce) { failOnce = false; throw Error('D1_ERROR sensitive test payload'); }
    return store.advanceJob(input);
  } };
  const dependencies = { now: () => NOW, fetchSignatures: async () => page(address, 20), hydrateTransaction: async () => { throw Error('not needed'); } };
  const options = { now: NOW, maximum_jobs: 1, maximum_pages_per_job: 1, solana_page_size: 20 };
  const failed = await runSourceWalletBackfillBatch(failingStore, dependencies, options);
  assert.equal(failed.totals.jobs_retried, 1);
  const pending = db.raw.prepare('SELECT * FROM ravenos_source_wallet_backfill_jobs WHERE job_id=?').get(job.job_id);
  assert.equal(pending.last_error_code, 'source_wallet_backfill_persistence_failed');
  assert.equal(pending.cursor_before, null); assert.equal(pending.signatures_seen, 10000);
  assert.equal(JSON.stringify(failed).includes('sensitive test payload'), false);
  await runSourceWalletBackfillBatch(failingStore, dependencies, { ...options, now: NOW + 10000 });
  const completed = db.raw.prepare('SELECT * FROM ravenos_source_wallet_backfill_jobs WHERE job_id=?').get(job.job_id);
  assert.equal(completed.signatures_seen, 10020); assert.equal(completed.transactions_decoded, 10020);
  assert.equal(completed.last_error_code, null);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM ravenos_source_wallet_events').get().n, 20);
});
