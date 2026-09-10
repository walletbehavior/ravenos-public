import { randomUUID } from 'node:crypto';

export const WalletIngestionPolicy = Object.freeze({
  cron: '* * * * *', jobs_per_run: 4, breadth_slots: 1, depth_slots: 2, trading_depth_slots: 1,
  profiles_per_run: 4, evm_requests_per_hour: 6000,
  reference_retry_limit: 2, reference_max_attempts: 5,
  reference_retry_seconds: Object.freeze([60, 300, 900, 3600, 21600]),
});

export function walletIngestionPolicy(env = {}) {
  const n=Number(env.RAVENOS_EVM_HISTORY_REQUESTS_PER_HOUR);
  return {...WalletIngestionPolicy,
    evm_requests_per_hour:Number.isSafeInteger(n)&&n>=100?Math.min(n,24000):WalletIngestionPolicy.evm_requests_per_hour};
}

export async function reserveEvmHistoryRequests(db, {limit, budget, now=Date.now()}) {
  if (!db?.prepare || !Number.isInteger(limit) || limit<1 || limit>1000
    || !Number.isInteger(budget) || budget<limit || budget>24000) throw Error('evm_history_budget_invalid');
  const hour=Math.floor(now/3600000)*3600, id=randomUUID();
  const result=await db.prepare(`INSERT INTO ravenos_wallet_ingestion_reservations
    (reservation_id,provider,hour_start,units,settled)
    SELECT ?,'alchemy_evm_history',?,?,0 WHERE
      COALESCE((SELECT SUM(units) FROM ravenos_wallet_ingestion_reservations
        WHERE provider='alchemy_evm_history' AND hour_start=?),0)+?<=?`)
    .bind(id,hour,limit,hour,limit,budget).run();
  if (!result.meta?.changes) {
    const error=Error('evm_history_budget_exhausted');error.code=error.message;error.retry_at=(hour+3600)*1000;throw error;
  }
  await db.prepare('DELETE FROM ravenos_wallet_ingestion_reservations WHERE hour_start<?').bind(hour-7*86400).run();
  return {reservation_id:id,limit};
}

export async function settleEvmHistoryRequests(db, reservation, used) {
  if (!Number.isInteger(used)||used<0||used>reservation.limit) throw Error('evm_history_budget_settlement_invalid');
  await db.prepare(`UPDATE ravenos_wallet_ingestion_reservations SET units=?,settled=1
    WHERE reservation_id=? AND settled=0 AND units>=?`).bind(used,reservation.reservation_id,used).run();
}
