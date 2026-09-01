PRAGMA foreign_keys = ON;

-- Mutable operational state for the bounded, noncustodial execution adapter.
-- No private keys, signatures, wallet secrets, or arbitrary transaction
-- material are stored. The prepared JSON is the exact Raven-reviewed ticket.
CREATE TABLE ravenos_customer_live_execution_intents (
  execution_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  venue TEXT NOT NULL CHECK (venue IN ('hyperliquid', 'jupiter')),
  chain_namespace TEXT NOT NULL CHECK (chain_namespace IN ('hyperliquid', 'solana')),
  wallet_address TEXT NOT NULL CHECK (length(wallet_address) BETWEEN 32 AND 64),
  exact_market_id TEXT NOT NULL CHECK (length(exact_market_id) BETWEEN 1 AND 180),
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell', 'long', 'short')),
  order_type TEXT NOT NULL CHECK (order_type IN ('market', 'limit')),
  notional_usdc REAL,
  raven_fee_bps INTEGER NOT NULL DEFAULT 0 CHECK (raven_fee_bps BETWEEN 0 AND 10),
  expected_raven_fee_usdc REAL NOT NULL DEFAULT 0 CHECK (expected_raven_fee_usdc >= 0),
  observed_raven_fee_usdc REAL CHECK (observed_raven_fee_usdc IS NULL OR observed_raven_fee_usdc >= 0),
  fee_token TEXT CHECK (fee_token IS NULL OR fee_token = 'USDC'),
  fee_recipient TEXT CHECK (fee_recipient IS NULL OR (fee_recipient GLOB '0x*' AND length(fee_recipient) = 42)),
  fee_collection_method TEXT NOT NULL DEFAULT 'none' CHECK (fee_collection_method IN ('none', 'hyperliquid_builder_code')),
  fee_collection_status TEXT NOT NULL DEFAULT 'disabled' CHECK (fee_collection_status IN ('disabled', 'expected', 'observed', 'failed', 'indeterminate')),
  state TEXT NOT NULL CHECK (state IN (
    'awaiting_wallet_signature',
    'submission_pending',
    'client_reported',
    'reconciliation_pending',
    'provider_confirmed',
    'provider_rejected',
    'expired',
    'failed',
    'indeterminate',
    'rejected'
  )),
  prepared_payload_hash TEXT NOT NULL CHECK (length(prepared_payload_hash) = 64),
  provider_request_id TEXT,
  prepared_json TEXT NOT NULL CHECK (json_valid(prepared_json) AND length(prepared_json) <= 65536),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (execution_id GLOB 'lex_*' AND length(execution_id) BETWEEN 20 AND 100),
  CHECK (notional_usdc IS NULL OR (notional_usdc >= 0 AND notional_usdc <= 1000000)),
  CHECK (expires_at > created_at),
  CHECK (updated_at >= created_at)
);

CREATE INDEX ravenos_customer_live_execution_user_idx
  ON ravenos_customer_live_execution_intents(user_id, created_at DESC, execution_id);
CREATE INDEX ravenos_customer_live_execution_reconcile_idx
  ON ravenos_customer_live_execution_intents(state, updated_at, execution_id);
CREATE UNIQUE INDEX ravenos_customer_live_execution_provider_request_idx
  ON ravenos_customer_live_execution_intents(venue, provider_request_id)
  WHERE provider_request_id IS NOT NULL;

-- Economic and reconciliation evidence is append-only. Client-reported and
-- provider-observed states remain visibly distinct.
CREATE TABLE ravenos_customer_live_execution_events (
  event_id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES ravenos_customer_live_execution_intents(execution_id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (length(state) BETWEEN 1 AND 40),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json) AND length(evidence_json) <= 32768),
  observed_at INTEGER NOT NULL,
  CHECK (event_id GLOB 'lee_*' AND length(event_id) BETWEEN 20 AND 100)
);

CREATE INDEX ravenos_customer_live_execution_events_intent_idx
  ON ravenos_customer_live_execution_events(execution_id, observed_at, event_id);

CREATE TRIGGER ravenos_customer_live_execution_events_append_only
BEFORE UPDATE ON ravenos_customer_live_execution_events
BEGIN
  SELECT RAISE(ABORT, 'customer_live_execution_event_append_only');
END;
