import { WalletIngestionPolicy as policy } from './wallet_ingestion_policy.mjs';

// Only public transaction references and bounded index evidence are retained.
// The existing append-only page ledger preserves each attempt's result.
export function createWalletReferenceRetryStore(db) {
  return {
    async referenceFailure(jobId,reference) {
      return db.prepare(`SELECT state,last_error_code FROM ravenos_wallet_reference_retries
        WHERE job_id=? AND transaction_reference=? AND state!='resolved'`).bind(jobId,reference).first();
    },
    async dueReferences(jobId, now=Date.now()) {
      const result=await db.prepare(`SELECT reference_json FROM ravenos_wallet_reference_retries
        WHERE job_id=? AND state='pending' AND next_attempt_at<=?
        ORDER BY next_attempt_at,transaction_reference LIMIT ?`)
        .bind(jobId,Math.floor(now/1000),policy.reference_retry_limit).all();
      return (result.results||[]).map(row=>JSON.parse(row.reference_json));
    },
    async recordReferenceOutcomes(job, outcomes, attemptId, now=Date.now()) {
      const seconds=Math.floor(now/1000);
      for (const outcome of outcomes) {
        const row=outcome.reference;
        if (!/^0x[0-9a-f]{64}$/.test(row?.hash||'') || JSON.stringify(row).length>2048
          || (outcome.error_code && !/^[a-z][a-z0-9_]{2,99}$/.test(outcome.error_code))) throw Error('wallet_reference_outcome_invalid');
        if(outcome.deferred)continue;
        if (!outcome.error_code) {
          await db.prepare(`UPDATE ravenos_wallet_reference_retries SET state='resolved',
            last_error_code=NULL,last_attempt_id=?,updated_at=? WHERE job_id=? AND transaction_reference=?`)
            .bind(attemptId,seconds,job.job_id,row.hash).run();
          continue;
        }
        const existing=await db.prepare(`SELECT attempts,last_attempt_id,state FROM ravenos_wallet_reference_retries
          WHERE job_id=? AND transaction_reference=?`).bind(job.job_id,row.hash).first();
        if(existing?.last_attempt_id===attemptId || existing?.state==='resolved')continue;
        const attempts=Math.min(100,(existing?.attempts||0)+1);
        const state=attempts>=policy.reference_max_attempts?'unresolved':'pending';
        const next=seconds+policy.reference_retry_seconds[Math.min(attempts-1,policy.reference_retry_seconds.length-1)];
        await db.prepare(`INSERT INTO ravenos_wallet_reference_retries
          (job_id,transaction_reference,reference_json,state,attempts,last_error_code,last_attempt_id,next_attempt_at,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(job_id,transaction_reference) DO UPDATE SET
            state=excluded.state,attempts=excluded.attempts,last_error_code=excluded.last_error_code,
            last_attempt_id=excluded.last_attempt_id,next_attempt_at=excluded.next_attempt_at,updated_at=excluded.updated_at
          WHERE ravenos_wallet_reference_retries.state!='resolved'`)
          .bind(job.job_id,row.hash,JSON.stringify(row),state,attempts,outcome.error_code,attemptId,next,seconds,seconds).run();
      }
      return this.referenceRetrySummary(job.job_id);
    },
    async referenceRetrySummary(jobId) {
      const row=await db.prepare(`SELECT
        SUM(CASE WHEN state!='resolved' THEN 1 ELSE 0 END) AS unresolved,
        SUM(CASE WHEN state='pending' THEN 1 ELSE 0 END) AS pending,
        MIN(CASE WHEN state='pending' THEN next_attempt_at END) AS next_attempt_at
        FROM ravenos_wallet_reference_retries WHERE job_id=?`).bind(jobId).first();
      return {unresolved:Number(row?.unresolved||0),pending:Number(row?.pending||0),next_attempt_at:row?.next_attempt_at||null};
    },
  };
}
