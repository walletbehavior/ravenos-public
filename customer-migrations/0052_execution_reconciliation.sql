PRAGMA foreign_keys = ON;

-- Read-only recovery of previously submitted customer transactions. Jobs carry
-- only an intent reference; all wallet/transaction identity stays in its ledger.
CREATE TABLE ravenos_execution_reconciliation_jobs (
  execution_id TEXT PRIMARY KEY REFERENCES ravenos_customer_live_execution_intents(execution_id) ON DELETE CASCADE,
  lease_token TEXT NOT NULL,
  lease_until INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_state TEXT NOT NULL DEFAULT 'queued',
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX ravenos_execution_reconciliation_due
  ON ravenos_execution_reconciliation_jobs(completed_at, next_attempt_at, lease_until);

-- Public, unauthenticated RPC only. The aggregate cap spans all recovery jobs,
-- chains and Worker isolates. A failed network attempt still consumes a slot.
CREATE TABLE ravenos_execution_reconciliation_rpc_budget (
  hour_start INTEGER PRIMARY KEY,
  requests INTEGER NOT NULL CHECK (requests BETWEEN 0 AND 360)
);
