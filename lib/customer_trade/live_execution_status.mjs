// Reconstruct only the evidence needed to check an existing submission.
// Client input cannot supply an owner, wallet, transaction, or new order.
export async function readExecutionStatusContext(db, ticketId, userId) {
  if (!/^lex_[A-Za-z0-9_-]{8,90}$/.test(String(ticketId || "")) || !userId) return null;
  const row = await db.prepare(`SELECT execution_id,chain_namespace,state,prepared_json,transaction_hash
    FROM ravenos_customer_live_execution_intents WHERE execution_id=? AND user_id=?`).bind(ticketId,userId).first();
  if (!row) return null;
  const base = { ticket_id: row.execution_id };
  if (["provider_confirmed", "provider_rejected"].includes(row.state)) {
    const event = await db.prepare(`SELECT evidence_json FROM ravenos_customer_live_execution_events
      WHERE execution_id=? AND state=? ORDER BY observed_at DESC,rowid DESC LIMIT 1`).bind(ticketId,row.state).first();
    return { kind: "terminal", body: { ok: row.state !== "provider_rejected", ...base,
      transaction_hash: row.transaction_hash,
      reconciliation: { ...(event ? JSON.parse(event.evidence_json) : {}), state: row.state } } };
  }
  const pending = { kind: "pending", body: { ok: true, ...base, reconciliation: { state: "indeterminate" } } };
  // A quote or unsigned ticket is never evidence of a submitted trade.
  if (!["submission_pending", "client_reported", "reconciliation_pending", "indeterminate"].includes(row.state)) return pending;
  const prepared = JSON.parse(row.prepared_json);
  if (row.chain_namespace === "solana") {
    const event = await db.prepare(`SELECT evidence_json FROM ravenos_customer_live_execution_events
      WHERE execution_id=? AND state='submission_pending' ORDER BY observed_at DESC,rowid DESC LIMIT 1`).bind(ticketId).first();
    const signature = event ? JSON.parse(event.evidence_json).wallet_signature : null;
    if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(String(signature || ""))) return pending;
    return { kind: "solana", ...base, prepared, signature };
  }
  if (!["robinhood", "base", "ethereum", "bsc"].includes(row.chain_namespace) || !/^0x[0-9a-fA-F]{64}$/.test(String(row.transaction_hash || ""))) return pending;
  return { kind: "evm", chain: row.chain_namespace, ...base, report: {
    ...base, wallet_address: prepared.wallet_address,
    reviewed_transaction_hash: prepared.transaction.reviewed_transaction_hash,
    transaction_hash: row.transaction_hash,
  } };
}
