import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { EVM_CHAIN_PROFILES } from '../lib/customer_trade/evm_chain_profiles.mjs';
import { EVM_LIVE_TICKET_SCHEMA, createD1EvmLiveExecutionStore } from '../lib/customer_trade/evm_live_execution.mjs';
import { ROBINHOOD_LIVE_TICKET_SCHEMA, createD1RobinhoodLiveExecutionStore } from '../lib/customer_trade/robinhood_live_execution.mjs';
import { readExecutionStatusContext } from '../lib/customer_trade/live_execution_status.mjs';
import { rewardBalance } from '../lib/customer_rewards.mjs';
import { ExecutionRecoveryLimits as LIMITS, EXECUTION_RECOVERY_PUBLIC_RPC, createExecutionRecoveryRpc,
  reconcileRecordedEvmSubmission, runExecutionRecovery, recoverExecutionRewards } from '../lib/customer_trade/evm_execution_recovery.mjs';

const NOW = Math.floor(Date.parse('2026-09-10T06:00:00Z') / 1000);
const USER = 'usr_' + 'a'.repeat(32), OTHER = 'usr_' + 'd'.repeat(32);
const WALLET = '0x' + '3'.repeat(40), ROUTER = '0x' + '4'.repeat(40), TOKEN = '0x' + '5'.repeat(40), COLLECTOR = '0x' + '6'.repeat(40);
const BLOCK = '0x' + 'b'.repeat(64), LATEST = '0x' + 'c'.repeat(64);
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const hex = n => '0x' + BigInt(n).toString(16);
const hash = n => '0x' + BigInt(n).toString(16).padStart(64, '0');

function database(t) {
  const raw = new DatabaseSync(':memory:'); t.after(() => raw.close());
  for (const name of readdirSync('customer-migrations').filter(n => /^\d+.*\.sql$/.test(n)).sort()) {
    raw.exec(readFileSync(`customer-migrations/${name}`, 'utf8'));
  }
  return { raw, prepare(sql) { return { bind(...args) {
    const statement = raw.prepare(sql);
    return { async first() { return statement.get(...args) || null; }, async all() { return { results: statement.all(...args) }; },
      async run() { return { meta: { changes: Number(statement.run(...args).changes) } }; }, _run() { return statement.run(...args); } };
  } }; }, async batch(statements) {
    raw.exec('BEGIN');
    try { const result = statements.map(s => ({ meta: { changes: Number(s._run().changes) } })); raw.exec('COMMIT'); return result; }
    catch (error) { raw.exec('ROLLBACK'); throw error; }
  } };
}

function fixture(db, { chain = 'base', state = 'reconciliation_pending', prior = true, finalized = false, n = 1, tx = hash(n) } = {}) {
  const profile = EVM_CHAIN_PROFILES[chain], id = 'lex_' + String(n).padStart(32, '0');
  const feeToken = profile.accounting_asset.address;
  db.raw.prepare("INSERT OR IGNORE INTO ravenos_users(user_id,state,primary_email,created_at,updated_at,last_authenticated_at) VALUES (?,'active','fixture@example.test',?,?,?)").run(USER, NOW - 10, NOW - 10, NOW - 10);
  const ticket = { schema_version: chain === 'robinhood' ? ROBINHOOD_LIVE_TICKET_SCHEMA : EVM_LIVE_TICKET_SCHEMA,
    ticket_id: id, profile_id: profile.profile_id, chain_namespace: chain, chain_id: profile.chain_id, canonical_chain_id: profile.canonical_chain_id,
    wallet_address: WALLET, transaction: { to: ROUTER, value: '0', maximum_gas: '210000',
      reviewed_transaction_hash: 'a'.repeat(64), input_data_sha256: createHash('sha256').update('0x12345678').digest('hex') },
    reviewed_order: { sell_token: feeToken, buy_token: TOKEN, sell_amount_base_units: '1000000', minimum_buy_amount_base_units: '1900000' },
    fee: { enabled: true, token: feeToken, recipient: COLLECTOR, expected_amount_base_units: '10000' } };
  db.raw.prepare(`INSERT INTO ravenos_customer_live_execution_intents
    (execution_id,schema_version,user_id,venue,chain_namespace,wallet_address,exact_market_id,side,order_type,raven_fee_bps,
     fee_token,fee_recipient,fee_collection_method,fee_collection_status,state,prepared_payload_hash,prepared_json,
     expires_at,created_at,updated_at,expected_raven_fee_amount_base_units,observed_raven_fee_amount_base_units,transaction_hash)
    VALUES (?,'fixture',?,'zero_x',?,?,?,'buy','market',100,?,?,'zero_x_integrator_fee','observed',?,?,?, ?,?,?,'10000','10000',?)`)
    .run(id, USER, chain, WALLET, `${chain}:token:fixture`, feeToken, COLLECTOR, state, 'a'.repeat(64), JSON.stringify(ticket), NOW - 1, NOW - 10, NOW - 1, tx);
  const observation = { state: 'provider_confirmed', transaction_hash: tx,
    evidence: { economic_result_verified: true, chain_id: profile.chain_id, block_number: '100', block_hash: BLOCK,
      finalized, ...(chain === 'robinhood' ? { l1_finality_observed: false } : {}),
      fee_collection: { state: 'observed', token: feeToken, expected_amount_base_units: '10000', observed_amount_base_units: '10000' } } };
  if (prior) db.raw.prepare('INSERT INTO ravenos_customer_live_execution_events VALUES (?,?,?,?,?)')
    .run('lee_' + String(n).padStart(32, '0'), id, state, JSON.stringify(observation), NOW - 1);
  db.raw.prepare(`INSERT INTO ravenos_execution_reward_context
    (execution_id,user_id,chain,venue,trade_type,entitlement_source,eligible,fee_token,fee_recipient,authorized_fee_bps,expected_fee_micros,created_at)
    VALUES (?,?,?,'zero_x','manual','trial',1,?,?,100,'10000',?)`).run(id, USER, chain, feeToken, COLLECTOR, NOW - 1);
  return { db, id, chain, profile, feeToken, ticket, tx, reference: { execution_id: id, user_id: USER }, observation };
}

function provider(f, { final = 100, canonical = BLOCK, missing = false, chainId = f.profile.chain_id } = {}) {
  const calls = [], topic = a => '0x' + '0'.repeat(24) + a.slice(2);
  const transfer = (token, from, to, n) => ({ address: token, topics: [TRANSFER, topic(from), topic(to)], data: hash(n) });
  return { calls, async request(method, params) {
    calls.push({ method, params });
    let result;
    if (method === 'eth_chainId') result = hex(chainId);
    else if (method === 'eth_blockNumber') result = '0x65';
    else if (method === 'eth_getBlockByNumber') result = params[0] === 'latest' ? { number: '0x65', hash: LATEST }
      : params[0] === 'finalized' ? { number: hex(final), hash: final === 100 ? canonical : hash(final) }
        : { number: params[0], hash: canonical };
    else if (method === 'eth_getTransactionByHash') result = missing ? null : {
      hash: f.tx, from: WALLET, to: ROUTER, input: '0x12345678', value: '0x0', gas: hex(210000), gasPrice: '0x1' };
    else if (method === 'eth_getTransactionReceipt') result = missing ? null : {
      transactionHash: f.tx, from: WALLET, to: ROUTER, status: '0x1', blockNumber: '0x64', blockHash: canonical,
      gasUsed: hex(100000), effectiveGasPrice: '0x1', logs: [
        transfer(f.feeToken, WALLET, ROUTER, 990000), transfer(f.feeToken, WALLET, COLLECTOR, 10000), transfer(TOKEN, ROUTER, WALLET, 2000000)] };
    else throw new Error('Unexpected RPC ' + method);
    return { result, provider_id: 'fixture_public' };
  } };
}
const envFor = db => ({ RAVENOS_CUSTOMER_DB: db, RAVENOS_EXECUTION_RECOVERY_ENABLED: '1' });
const job = f => f.db.raw.prepare('SELECT * FROM ravenos_execution_reconciliation_jobs WHERE execution_id=?').get(f.id);
const latestEvidence = f => JSON.parse(f.db.raw.prepare('SELECT evidence_json FROM ravenos_customer_live_execution_events WHERE execution_id=? ORDER BY observed_at DESC,rowid DESC LIMIT 1').get(f.id).evidence_json);

test('a submitted Base trade finishes after the browser leaves, with one exact cashback credit', async t => {
  const db = database(t), f = fixture(db), early = provider(f, { final: 99 });
  const first = await runExecutionRecovery(envFor(db), { now: NOW, makeRpc: () => early });
  assert.equal(first.retrying, 1); assert.equal(first.rpc_requests, 3); assert.equal(job(f).last_state, 'finality_pending');
  assert.equal((await rewardBalance(db, USER)).available_micros, '0');
  const waiting = await runExecutionRecovery(envFor(db), { now: NOW + 299, makeRpc: () => { throw new Error('Too soon'); } });
  assert.equal(waiting.inspected, 0);
  const final = provider(f), done = await runExecutionRecovery(envFor(db), { now: NOW + 300, makeRpc: () => final });
  assert.equal(done.completed, 1); assert.equal(done.rpc_requests, 4);
  assert.equal((await rewardBalance(db, USER)).available_micros, '3000');
  assert.equal(latestEvidence(f).evidence.finalized, true);
  assert.deepEqual(final.calls.map(c => c.method), ['eth_chainId', 'eth_getBlockByNumber', 'eth_getBlockByNumber', 'eth_getBlockByNumber']);
  const again = await runExecutionRecovery(envFor(db), { now: NOW + 600, makeRpc: () => { throw new Error('Already complete'); } });
  assert.equal(again.inspected, 0); assert.equal((await rewardBalance(db, USER)).available_micros, '3000');
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM ravenos_reward_fee_receipts').get().n, 1);
});

test('legacy Robinhood inclusion gains finalized evidence, while non-USDC valuation stays explicit', async t => {
  const f = fixture(database(t), { chain: 'robinhood', state: 'provider_confirmed' });
  const store = createD1RobinhoodLiveExecutionStore(f.db);
  await assert.rejects(store.reconcile({ execution_id: f.id, user_id: USER, reconciliation: f.observation, now_seconds: NOW }), /not_reconcilable/);
  const result = await reconcileRecordedEvmSubmission(f.db, f.reference, provider(f), { now: NOW });
  assert.equal(result.state, 'provider_confirmed'); assert.equal(result.terminal, true);
  assert.equal(result.rewards_state, 'valuation_required');
  assert.equal(latestEvidence(f).evidence.finalized, true); assert.equal(latestEvidence(f).evidence.l1_finality_observed, false);
  assert.equal((await rewardBalance(f.db, USER)).available_micros, '0');
});

for (const chain of ['base', 'robinhood']) test(`${chain}: receipt not yet visible remains retryable after ticket expiration`, async t => {
  const f = fixture(database(t), { chain, state: 'client_reported', prior: false });
  const pending = await reconcileRecordedEvmSubmission(f.db, f.reference, provider(f, { missing: true }), { now: NOW });
  assert.equal(pending.state, 'reconciliation_pending'); assert.equal(pending.terminal, false);
  assert.equal(pending.reason, 'transaction_not_observed_yet');
  const result = await reconcileRecordedEvmSubmission(f.db, f.reference, provider(f), { now: NOW + 300 });
  assert.equal(result.state, 'provider_confirmed'); assert.equal(result.terminal, true);
  assert.equal(latestEvidence(f).evidence.sell_debit_base_units, '1000000');
});

test('a changed canonical block forces fresh transaction and receipt verification', async t => {
  const f = fixture(database(t)), rpc = provider(f, { canonical: hash(900) });
  const result = await reconcileRecordedEvmSubmission(f.db, f.reference, rpc, { now: NOW });
  assert.equal(result.state, 'provider_confirmed');
  assert.ok(rpc.calls.some(c => c.method === 'eth_getTransactionReceipt'));
  assert.equal(latestEvidence(f).evidence.block_hash, hash(900));
});

test('mismatched stored receipt identity cannot reuse economic evidence', async t => {
  const f = fixture(database(t));
  f.db.raw.prepare('UPDATE ravenos_customer_live_execution_intents SET transaction_hash=? WHERE execution_id=?').run(hash(999), f.id);
  const rpc = provider(f);
  await assert.rejects(reconcileRecordedEvmSubmission(f.db, f.reference, rpc, { now: NOW }), /transaction_binding_mismatch/);
  assert.ok(rpc.calls.some(c => c.method === 'eth_getTransactionReceipt'));
  assert.equal((await rewardBalance(f.db, USER)).available_micros, '0');
});

test('wrong chain cannot upgrade a stored receipt', async t => {
  const f = fixture(database(t)), rpc = provider(f, { chainId: 1 });
  await assert.rejects(reconcileRecordedEvmSubmission(f.db, f.reference, rpc, { now: NOW }), /chain_id_mismatch/);
  assert.equal(rpc.calls.length, 1); assert.equal(latestEvidence(f).evidence.finalized, false);
});

for (const sample of ['other_account', 'unsigned', 'finalized', 'invalid_reference', 'no_submission']) {
  test(`${sample} does not initiate RPC or create an execution`, async t => {
    const f = fixture(database(t), { state: sample === 'unsigned' ? 'awaiting_wallet_signature' : sample === 'finalized' ? 'provider_confirmed' : 'reconciliation_pending', finalized: sample === 'finalized', tx: sample === 'no_submission' ? null : hash(1) });
    const reference = sample === 'other_account' ? { ...f.reference, user_id: OTHER } : sample === 'invalid_reference' ? { ...f.reference, execution_id: 'user_supplied_hash' } : f.reference;
    await reconcileRecordedEvmSubmission(f.db, reference, { request() { throw new Error('Must not call RPC'); } }, { now: NOW });
    assert.equal(f.db.raw.prepare('SELECT COUNT(*) AS n FROM ravenos_customer_live_execution_intents').get().n, 1);
  });
}

test('ordinary EVM reconciliation cannot rewrite a confirmed record', async t => {
  const f = fixture(database(t), { state: 'provider_confirmed' });
  await assert.rejects(createD1EvmLiveExecutionStore(f.db, { profile: f.profile }).reconcile({ execution_id: f.id,
    user_id: USER, reconciliation: f.observation, now_seconds: NOW }), /not_reconcilable/);
});

for (const chain of ['base','robinhood']) test(`${chain}: status and evidence roll back together if the intent update fails`,async t=>{
  const f=fixture(database(t),{chain});
  const store=chain==='robinhood'?createD1RobinhoodLiveExecutionStore(f.db):createD1EvmLiveExecutionStore(f.db,{profile:f.profile});
  const before=f.db.raw.prepare('SELECT COUNT(*) AS n FROM ravenos_customer_live_execution_events').get().n;
  await assert.rejects(store.reconcile({execution_id:f.id,user_id:USER,reconciliation:f.observation,now_seconds:NOW-100}),/CHECK/);
  assert.equal(f.db.raw.prepare('SELECT COUNT(*) AS n FROM ravenos_customer_live_execution_events').get().n,before);
  assert.equal(f.db.raw.prepare('SELECT state FROM ravenos_customer_live_execution_intents').get().state,'reconciliation_pending');
});

test('a stale legacy receipt cannot overwrite a more recent observation or a finalized result',async t=>{
  const f=fixture(database(t),{state:'provider_confirmed'}),store=createD1EvmLiveExecutionStore(f.db,{profile:f.profile});
  const previousId=f.db.raw.prepare('SELECT event_id FROM ravenos_customer_live_execution_events').get().event_id;
  f.db.raw.prepare('INSERT INTO ravenos_customer_live_execution_events VALUES (?,?,?,?,?)').run('lee_new_observation_recovery',f.id,'provider_confirmed',JSON.stringify(f.observation),NOW);
  await assert.rejects(store.reconcile({execution_id:f.id,user_id:USER,reconciliation:f.observation,now_seconds:NOW,
    allow_confirmation_upgrade:true,previous_event_id:previousId}),/not_reconcilable/);
  await reconcileRecordedEvmSubmission(f.db,f.reference,provider(f),{now:NOW});
  const latestId=f.db.raw.prepare('SELECT event_id FROM ravenos_customer_live_execution_events ORDER BY observed_at DESC,rowid DESC LIMIT 1').get().event_id;
  await assert.rejects(store.reconcile({execution_id:f.id,user_id:USER,reconciliation:f.observation,now_seconds:NOW,
    allow_confirmation_upgrade:true,previous_event_id:latestId}),/not_reconcilable/);
  assert.equal(latestEvidence(f).evidence.finalized,true);
});

test('a same-second confirmed receipt wins over an older random event ID in status and rewards',async t=>{
  const f=fixture(database(t));
  f.db.raw.prepare('INSERT INTO ravenos_customer_live_execution_events VALUES (?,?,?,?,?)')
    .run('lee_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',f.id,'provider_confirmed',JSON.stringify(f.observation),NOW);
  await reconcileRecordedEvmSubmission(f.db,f.reference,provider(f),{now:NOW});
  assert.equal((await rewardBalance(f.db,USER)).available_micros,'3000');
  assert.equal(latestEvidence(f).evidence.finalized,true);
  assert.equal((await readExecutionStatusContext(f.db,f.id,USER)).body.reconciliation.evidence.finalized,true);
});

test('leases prevent two Workers from reconciling the same submission concurrently', async t => {
  const f = fixture(database(t)); let release, entered;
  const started = new Promise(r => { entered = r; }), held = new Promise(r => { release = r; });
  const first = runExecutionRecovery(envFor(f.db), { now: NOW, makeRpc: () => provider(f), reconcile: async () => {
    entered(); await held; return { state: 'provider_confirmed', terminal: true };
  } });
  await started;
  const second = await runExecutionRecovery(envFor(f.db), { now: NOW, reconcile: () => { throw new Error('Duplicate lease'); } });
  assert.equal(second.inspected, 0); release(); assert.equal((await first).completed, 1); assert.equal(job(f).attempts, 1);
});

test('an expired Worker lease is recovered, with bounded retries and no raw error persisted', async t => {
  const f = fixture(database(t));
  f.db.raw.prepare(`INSERT INTO ravenos_execution_reconciliation_jobs(execution_id,lease_token,lease_until,updated_at) VALUES (?,'dead-worker',?,?)`).run(f.id, NOW - 1, NOW - 10);
  const result = await runExecutionRecovery(envFor(f.db), { now: NOW, reconcile: async () => { throw new Error('private-wallet-secret'); } });
  assert.equal(result.retrying, 1); assert.equal(result.errors, 1);
  assert.equal(job(f).lease_until, 0); assert.equal(job(f).next_attempt_at, NOW + 300);
  assert.equal(job(f).last_state, 'reconciliation_unavailable');
});

test('the shared hourly cap counts failed network attempts and cannot exceed 360', async t => {
  const db = database(t), f = fixture(db);
  const hour = Math.floor(NOW / 3600) * 3600;
  db.raw.prepare('INSERT INTO ravenos_execution_reconciliation_rpc_budget VALUES (?,359)').run(hour);
  let calls = 0;
  const result = await runExecutionRecovery(envFor(db), { now: NOW, makeRpc: () => ({ async request() { calls++; throw new Error('offline'); } }),
    reconcile: async (_db, _ref, rpc) => { await rpc.request('eth_chainId', []).catch(() => {}); await rpc.request('eth_chainId', []); } });
  assert.equal(calls, 1); assert.equal(result.rpc_requests, 1); assert.equal(result.state, 'budget_wait');
  assert.equal(db.raw.prepare('SELECT requests FROM ravenos_execution_reconciliation_rpc_budget').get().requests, 360);
  assert.equal(job(f).next_attempt_at, hour + 3600);
  assert.throws(() => db.raw.exec('UPDATE ravenos_execution_reconciliation_rpc_budget SET requests=361'), /CHECK/);
});

test('racing budget reservations cannot spend the last hourly slot twice', async t => {
  const db = database(t), f = fixture(db), hour = Math.floor(NOW / 3600) * 3600;
  db.raw.prepare('INSERT INTO ravenos_execution_reconciliation_rpc_budget VALUES (?,359)').run(hour);
  let calls = 0;
  const result = await runExecutionRecovery(envFor(db), { now: NOW, makeRpc: () => ({ async request() { calls++; return { result: '0x1' }; } }),
    reconcile: async (_db, _ref, rpc) => { await Promise.allSettled([rpc.request('eth_chainId', []), rpc.request('eth_chainId', [])]); return { state: 'pending' }; } });
  assert.equal(calls, 1); assert.equal(result.rpc_requests, 1); assert.equal(result.state, 'budget_wait');
});

test('one run respects both its 36-request cap and 4-job cap', async t => {
  const db = database(t); for (let n = 1; n <= 6; n++) fixture(db, { n });
  let calls = 0;
  const limited = await runExecutionRecovery(envFor(db), { now: NOW, makeRpc: () => ({ async request() { calls++; return { result: '0x1' }; } }),
    reconcile: async (_db, _ref, rpc) => { for (let n = 0; n < 50; n++) await rpc.request('eth_chainId', []); return { state: 'pending' }; } });
  assert.equal(calls, LIMITS.rpc_per_run); assert.equal(limited.inspected, 1);
  const batch = await runExecutionRecovery(envFor(db), { now: NOW + 300, reconcile: async () => ({ state: 'provider_confirmed', terminal: true }) });
  assert.equal(batch.inspected, LIMITS.jobs_per_run);
});

test('deadline stops new provider requests and leaves the submission retryable', async t => {
  const f = fixture(database(t)); let milliseconds = 0, calls = 0;
  const result = await runExecutionRecovery(envFor(f.db), { now: NOW, clock: () => milliseconds,
    makeRpc: () => ({ async request() { calls++; milliseconds += LIMITS.runtime_ms; return { result: '0x1' }; } }),
    reconcile: async (_db, _ref, rpc) => { await rpc.request('eth_chainId', []); await rpc.request('eth_chainId', []); } });
  assert.equal(calls, 1); assert.equal(result.retrying, 1); assert.equal(job(f).last_state, 'reconciliation_run_budget');
});

test('empty or disabled recovery performs zero provider calls', async t => {
  const db = database(t), never = () => { throw new Error('No provider needed'); };
  assert.equal((await runExecutionRecovery(envFor(db), { now: NOW, makeRpc: never })).rpc_requests, 0);
  assert.equal((await runExecutionRecovery({ ...envFor(db), RAVENOS_EXECUTION_RECOVERY_ENABLED: '0' }, { makeRpc: never })).state, 'disabled');
});

test('the background wrapper rejects signing and submission methods before reserving RPC', async t => {
  const f = fixture(database(t));
  const result = await runExecutionRecovery(envFor(f.db), { now: NOW, makeRpc: () => ({ request() { throw new Error('Forbidden transport'); } }),
    reconcile: async (_db, _ref, rpc) => { await rpc.request('eth_sendRawTransaction', ['0x1234']); } });
  assert.equal(result.rpc_requests, 0); assert.equal(job(f).last_state, 'reconciliation_rpc_method_forbidden');
});

for (const chain of Object.keys(EXECUTION_RECOVERY_PUBLIC_RPC)) test(`${chain} recovery uses one unauthenticated public provider with no redirects`, async () => {
  const requests = [], rpc = createExecutionRecoveryRpc(chain, { fetchImpl: async (url, init) => {
    requests.push({ url, init }); const body = JSON.parse(init.body);
    return Response.json({ jsonrpc: '2.0', id: body.id, result: hex(EVM_CHAIN_PROFILES[chain].chain_id) });
  } });
  await rpc.request('eth_chainId', []);
  assert.equal(requests.length, 1); assert.equal(new URL(requests[0].url).href, new URL(EXECUTION_RECOVERY_PUBLIC_RPC[chain]).href);
  assert.equal(requests[0].init.redirect, 'manual'); assert.deepEqual(Object.keys(requests[0].init.headers).sort(), ['accept', 'content-type']);
  assert.equal(rpc.providers.length, 1);
  await assert.rejects(rpc.request('eth_sendRawTransaction', ['0x1234']), /method_forbidden/); assert.equal(requests.length, 1);
});

test('recovery failure cannot prevent the existing rewards maintenance', async () => {
  const steps = [];
  const result = await recoverExecutionRewards({}, { recover: async () => { steps.push('recovery'); throw new Error('database unavailable'); },
    sweep: async () => { steps.push('rewards'); return { state: 'complete' }; } });
  assert.deepEqual(steps, ['recovery', 'rewards']); assert.equal(result.recovery.state, 'unavailable'); assert.equal(result.rewards.state, 'complete');
});
