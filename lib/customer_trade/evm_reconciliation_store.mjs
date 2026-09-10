import { randomBytes } from 'node:crypto';

// The observation and intent transition commit together. A background upgrade
// of legacy confirmation must still be based on the latest stored observation.
export async function persistEvmReconciliation(db, {
  executionId, userId, chain, nextState, feeStatus, reconciliation, nowSeconds,
  allowConfirmationUpgrade = false, previousEventId,
}) {
  const eventId = `lee_${randomBytes(18).toString('base64url')}`;
  const result = await db.batch([
    db.prepare(`INSERT INTO ravenos_customer_live_execution_events(event_id,execution_id,state,evidence_json,observed_at)
      SELECT ?,?,?,?,? WHERE EXISTS (
        SELECT 1 FROM ravenos_customer_live_execution_intents i
        WHERE i.execution_id=? AND i.user_id=? AND i.venue='zero_x' AND i.chain_namespace=?
          AND (i.state IN ('client_reported','reconciliation_pending') OR
            (?=1 AND i.state='provider_confirmed' AND COALESCE((SELECT e.event_id
              FROM ravenos_customer_live_execution_events e WHERE e.execution_id=i.execution_id
              ORDER BY e.observed_at DESC,e.rowid DESC LIMIT 1),'')=?
              AND COALESCE((SELECT json_extract(e.evidence_json,'$.evidence.finalized')
                FROM ravenos_customer_live_execution_events e WHERE e.execution_id=i.execution_id
                ORDER BY e.observed_at DESC,e.rowid DESC LIMIT 1),0)!=1)))`)
      .bind(eventId, executionId, nextState, JSON.stringify(reconciliation), nowSeconds,
        executionId, userId, chain, allowConfirmationUpgrade && previousEventId !== undefined ? 1 : 0, previousEventId ?? ''),
    db.prepare(`UPDATE ravenos_customer_live_execution_intents
      SET state=?,fee_collection_status=?,observed_raven_fee_amount_base_units=?,updated_at=?
      WHERE execution_id=? AND user_id=? AND venue='zero_x' AND chain_namespace=?
        AND EXISTS (SELECT 1 FROM ravenos_customer_live_execution_events WHERE event_id=? AND execution_id=?)`)
      .bind(nextState, feeStatus, reconciliation.evidence?.fee_collection?.observed_amount_base_units ?? null,
        nowSeconds, executionId, userId, chain, eventId, executionId),
  ]);
  return Number(result[1]?.meta?.changes ?? result[1]?.changes ?? 0) === 1;
}
