import { randomUUID } from 'node:crypto';
import { EVM_CHAIN_PROFILES } from './evm_chain_profiles.mjs';
import { createReadOnlyEvmRpcClient, verifyReadOnlyEvmRpcChain } from './evm_read_only_rpc.mjs';
import { withEvmExecutionFinality } from './evm_execution_finality.mjs';
import { createD1EvmLiveExecutionStore, normalizeEvmClientExecutionReport, reconcileEvmExecution } from './evm_live_execution.mjs';
import { createD1RobinhoodLiveExecutionStore, normalizeRobinhoodClientExecutionReport, reconcileRobinhoodExecution } from './robinhood_live_execution.mjs';
import { reconcileExecutionRewards, sweepExecutionRewards } from '../customer_rewards.mjs';

export const ExecutionRecoveryLimits = Object.freeze({
  jobs_per_run: 4, rpc_per_run: 36, rpc_per_hour: 360,
  runtime_ms: 25000, rpc_timeout_ms: 2500, lease_seconds: 120,
  retry_seconds: 300,
});
export const EXECUTION_RECOVERY_PUBLIC_RPC = Object.freeze({
  robinhood: 'https://rpc.mainnet.chain.robinhood.com',
  bsc: 'https://bsc-dataseed.bnbchain.org',
  base: 'https://mainnet.base.org',
  ethereum: 'https://ethereum-rpc.publicnode.com',
});
const HASH = /^0x[0-9a-f]{64}$/i;
const ID = /^lex_[A-Za-z0-9_-]{8,90}$/;
const RECOVERY_METHODS = new Set(['eth_chainId', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_blockNumber', 'eth_getBlockByNumber']);
const safeCode = value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,89}$/.test(value) ? value : 'reconciliation_unavailable';
const seconds = () => Math.floor(Date.now() / 1000);

function recoveryError(code) { return Object.assign(new Error(code), { code }); }

export function createExecutionRecoveryRpc(chain, { fetchImpl = globalThis.fetch } = {}) {
  const profile = EVM_CHAIN_PROFILES[chain];
  if (!profile || !EXECUTION_RECOVERY_PUBLIC_RPC[chain]) throw recoveryError('unsupported_reconciliation_chain');
  return createReadOnlyEvmRpcClient({
    chain_id: profile.chain_id, chain_namespace: chain,
    providers: [{ provider_id: `${chain}_recovery_public`, url: EXECUTION_RECOVERY_PUBLIC_RPC[chain] }],
    timeout_ms: ExecutionRecoveryLimits.rpc_timeout_ms,
  }, { fetchImpl });
}

// This function cannot create a ticket or select a transaction from client input.
// It resolves an existing account-owned submission and uses read-only RPC calls.
export async function reconcileRecordedEvmSubmission(db, reference, rpc, { now = seconds() } = {}) {
  if (!ID.test(String(reference?.execution_id)) || !reference?.user_id) return { state: 'not_found', terminal: true };
  const row = await db.prepare(`SELECT execution_id,user_id,chain_namespace,state,transaction_hash
    FROM ravenos_customer_live_execution_intents WHERE execution_id=? AND user_id=?`)
    .bind(reference.execution_id, reference.user_id).first();
  const profile = EVM_CHAIN_PROFILES[row?.chain_namespace];
  if (!row || !profile || !EXECUTION_RECOVERY_PUBLIC_RPC[row.chain_namespace] || !HASH.test(String(row.transaction_hash))) {
    return { state: 'not_found', terminal: true };
  }
  if (!['client_reported', 'reconciliation_pending', 'provider_confirmed'].includes(row.state)) {
    return { state: row.state, terminal: true };
  }
  const event = await db.prepare(`SELECT event_id,evidence_json FROM ravenos_customer_live_execution_events
    WHERE execution_id=? ORDER BY observed_at DESC,rowid DESC LIMIT 1`).bind(row.execution_id).first();
  let previous;
  try { previous = event ? JSON.parse(event.evidence_json) : null; } catch { previous = null; }
  const sameTransaction = HASH.test(String(previous?.transaction_hash))
    && previous.transaction_hash.toLowerCase() === row.transaction_hash.toLowerCase();
  if (row.state === 'provider_confirmed' && sameTransaction && previous?.evidence?.finalized === true) {
    return { state: 'provider_confirmed', terminal: true };
  }
  await verifyReadOnlyEvmRpcChain(rpc, profile.chain_id);
  const robinhood = row.chain_namespace === 'robinhood';
  const store = robinhood ? createD1RobinhoodLiveExecutionStore(db) : createD1EvmLiveExecutionStore(db, { profile });
  let reconciliation;
  if (sameTransaction && previous?.evidence?.economic_result_verified === true) {
    // A canonical finalized block commits its receipts. Reuse already verified
    // economics and recheck that block instead of fetching the full swap again.
    reconciliation = await withEvmExecutionFinality({ ...previous, state: 'provider_confirmed' }, rpc);
  }
  if (!reconciliation || reconciliation.evidence?.reason === 'canonical_block_unresolved') {
    const stored = await store.findTicket(row.execution_id, row.user_id);
    if (!stored?.prepared) return { state: 'not_found', terminal: true };
    const ticket = stored.prepared;
    const reportInput = { ticket_id: row.execution_id, wallet_address: ticket.wallet_address,
      reviewed_transaction_hash: ticket.transaction?.reviewed_transaction_hash, transaction_hash: row.transaction_hash };
    const report = robinhood ? normalizeRobinhoodClientExecutionReport(reportInput, ticket) : normalizeEvmClientExecutionReport(reportInput, ticket);
    reconciliation = await (robinhood ? reconcileRobinhoodExecution : reconcileEvmExecution)({ ticket, client_report: report }, { rpc_client: rpc, now: now * 1000 });
    reconciliation = await withEvmExecutionFinality(reconciliation, rpc);
  }
  const persisted = await store.reconcile({ execution_id: row.execution_id, user_id: row.user_id, reconciliation,
    now_seconds: now, allow_confirmation_upgrade: row.state === 'provider_confirmed', previous_event_id: event?.event_id ?? null });
  const rewards = await reconcileExecutionRewards(db, row.execution_id, { now }).catch(() => ({ state: 'reconciliation_pending' }));
  return { state: persisted.state, reason: reconciliation.evidence?.reason || null,
    terminal: !persisted.retryable,
    rewards_state: rewards.state };
}

export async function runExecutionRecovery(env = {}, {
  now = seconds(), makeRpc = createExecutionRecoveryRpc, reconcile = reconcileRecordedEvmSubmission,
  clock = () => Date.now(),
} = {}) {
  const db = env.RAVENOS_CUSTOMER_DB;
  if (env.RAVENOS_EXECUTION_RECOVERY_ENABLED !== '1' || !db?.prepare) return { state: 'disabled', inspected: 0, rpc_requests: 0 };
  const started = clock(), owner = randomUUID(), hour = Math.floor(now / 3600) * 3600;
  const result = { state: 'complete', inspected: 0, completed: 0, retrying: 0, errors: 0, rpc_requests: 0 };
  let localReservations = 0, exhausted = false;
  const rows = await db.prepare(`SELECT i.execution_id,i.user_id,i.chain_namespace FROM ravenos_customer_live_execution_intents i
    LEFT JOIN ravenos_execution_reconciliation_jobs j ON j.execution_id=i.execution_id
    WHERE i.venue='zero_x' AND i.chain_namespace IN ('robinhood','base','bsc','ethereum')
      AND i.state IN ('client_reported','reconciliation_pending','provider_confirmed') AND i.transaction_hash IS NOT NULL
      AND j.completed_at IS NULL AND COALESCE(j.next_attempt_at,0)<=? AND COALESCE(j.lease_until,0)<=?
      AND (i.state!='provider_confirmed' OR COALESCE((SELECT json_extract(e.evidence_json,'$.evidence.finalized')
        FROM ravenos_customer_live_execution_events e WHERE e.execution_id=i.execution_id
        ORDER BY e.observed_at DESC,e.rowid DESC LIMIT 1),0)!=1)
    ORDER BY COALESCE(j.next_attempt_at,0),i.created_at,i.execution_id LIMIT ?`)
    .bind(now, now, ExecutionRecoveryLimits.jobs_per_run).all();
  for (const row of rows.results || []) {
    if (exhausted || clock() - started >= ExecutionRecoveryLimits.runtime_ms || localReservations >= ExecutionRecoveryLimits.rpc_per_run) break;
    const lease = await db.prepare(`INSERT INTO ravenos_execution_reconciliation_jobs
      (execution_id,lease_token,lease_until,next_attempt_at,attempts,last_state,updated_at)
      VALUES (?,?,?,0,1,'working',?) ON CONFLICT(execution_id) DO UPDATE SET
        lease_token=excluded.lease_token,lease_until=excluded.lease_until,attempts=attempts+1,last_state='working',updated_at=excluded.updated_at
      WHERE completed_at IS NULL AND lease_until<=? AND next_attempt_at<=?`)
      .bind(row.execution_id, owner, now + ExecutionRecoveryLimits.lease_seconds, now, now, now).run();
    if (Number(lease.meta?.changes || 0) !== 1) continue;
    result.inspected++;
    let state = 'reconciliation_unavailable', terminal = false;
    try {
      const client = makeRpc(row.chain_namespace);
      const rpc = { async request(method, params) {
        if (!RECOVERY_METHODS.has(method)) throw recoveryError('reconciliation_rpc_method_forbidden');
        if (clock() - started >= ExecutionRecoveryLimits.runtime_ms || localReservations >= ExecutionRecoveryLimits.rpc_per_run) throw recoveryError('reconciliation_run_budget');
        localReservations++;
        const reserved = await db.prepare(`INSERT INTO ravenos_execution_reconciliation_rpc_budget(hour_start,requests) VALUES (?,1)
          ON CONFLICT(hour_start) DO UPDATE SET requests=requests+1 WHERE requests<?`)
          .bind(hour, ExecutionRecoveryLimits.rpc_per_hour).run();
        if (Number(reserved.meta?.changes || 0) !== 1) { exhausted = true; throw recoveryError('reconciliation_hour_budget'); }
        if (clock() - started >= ExecutionRecoveryLimits.runtime_ms) throw recoveryError('reconciliation_run_budget');
        result.rpc_requests++;
        return client.request(method, params);
      } };
      const outcome = await reconcile(db, row, rpc, { now });
      state = safeCode(outcome.reason || outcome.state);
      terminal = outcome.terminal === true;
    } catch (error) { state = safeCode(error?.code); result.errors++; }
    const next = exhausted ? hour + 3600 : now + ExecutionRecoveryLimits.retry_seconds;
    await db.prepare(`UPDATE ravenos_execution_reconciliation_jobs SET lease_until=0,next_attempt_at=?,last_state=?,updated_at=?,completed_at=?
      WHERE execution_id=? AND lease_token=?`).bind(next, state, now, terminal ? now : null, row.execution_id, owner).run();
    if (terminal) result.completed++; else result.retrying++;
  }
  if (exhausted) result.state = 'budget_wait';
  await db.prepare('DELETE FROM ravenos_execution_reconciliation_rpc_budget WHERE hour_start<?').bind(hour - 86400 * 7).run();
  return result;
}

// A recovery outage must not interrupt the existing rewards sweeper. Neither
// path signs, submits, pays out, or creates a new customer execution.
export async function recoverExecutionRewards(env, {
  recover = runExecutionRecovery, sweep = sweepExecutionRewards,
} = {}) {
  const recovery = await recover(env).catch(() => ({ state: 'unavailable' }));
  const rewards = await sweep(env);
  return { recovery, rewards };
}
