-- Receipt retries extend the existing source-wallet job and event ledger.
-- A failed reference must not prevent unrelated history from being retained.
CREATE TABLE ravenos_wallet_reference_retries (
  job_id TEXT NOT NULL REFERENCES ravenos_source_wallet_backfill_jobs(job_id),
  transaction_reference TEXT NOT NULL CHECK (length(transaction_reference)=66),
  reference_json TEXT NOT NULL CHECK (json_valid(reference_json) AND length(reference_json)<=2048),
  state TEXT NOT NULL CHECK (state IN ('pending','resolved','unresolved')),
  attempts INTEGER NOT NULL CHECK (attempts BETWEEN 1 AND 100),
  last_error_code TEXT CHECK (length(last_error_code)<=100),
  last_attempt_id TEXT NOT NULL,
  next_attempt_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (job_id,transaction_reference)
);
CREATE INDEX ravenos_wallet_reference_retry_due
  ON ravenos_wallet_reference_retries(job_id,state,next_attempt_at);

-- Reserve before provider I/O. Settlement can reduce a reservation once only;
-- a crash leaves the conservative upper bound charged to the hourly budget.
CREATE TABLE ravenos_wallet_ingestion_reservations (
  reservation_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider='alchemy_evm_history'),
  hour_start INTEGER NOT NULL,
  units INTEGER NOT NULL CHECK (units BETWEEN 0 AND 1000),
  settled INTEGER NOT NULL DEFAULT 0 CHECK (settled IN (0,1))
);
CREATE INDEX ravenos_wallet_ingestion_reservations_hour
  ON ravenos_wallet_ingestion_reservations(provider,hour_start);
