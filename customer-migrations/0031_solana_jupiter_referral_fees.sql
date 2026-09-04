PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

-- Admit Jupiter's referral-program fee evidence without weakening the
-- append-only execution ledger or changing any signing/custody boundary.
DROP TRIGGER IF EXISTS ravenos_customer_live_execution_events_append_only;
DROP TRIGGER IF EXISTS ravenos_customer_live_execution_events_no_delete;
DROP INDEX IF EXISTS ravenos_customer_live_execution_events_intent_idx;
DROP INDEX IF EXISTS ravenos_customer_live_execution_provider_request_idx;
DROP INDEX IF EXISTS ravenos_customer_live_execution_reconcile_idx;
DROP INDEX IF EXISTS ravenos_customer_live_execution_user_idx;
DROP INDEX IF EXISTS ravenos_customer_live_execution_transaction_idx;

ALTER TABLE ravenos_customer_live_execution_events
  RENAME TO ravenos_customer_live_execution_events_v2;
ALTER TABLE ravenos_customer_live_execution_intents
  RENAME TO ravenos_customer_live_execution_intents_v2;

CREATE TABLE ravenos_customer_live_execution_intents (
  execution_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  venue TEXT NOT NULL CHECK (venue IN ('hyperliquid', 'jupiter', 'zero_x')),
  chain_namespace TEXT NOT NULL CHECK (chain_namespace IN (
    'hyperliquid', 'solana', 'robinhood', 'base', 'bsc', 'ethereum',
    'arbitrum', 'avalanche', 'optimism', 'polygon'
  )),
  wallet_address TEXT NOT NULL CHECK (length(wallet_address) BETWEEN 32 AND 64),
  exact_market_id TEXT NOT NULL CHECK (length(exact_market_id) BETWEEN 1 AND 180),
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell', 'long', 'short')),
  order_type TEXT NOT NULL CHECK (order_type IN ('market', 'limit')),
  notional_usdc REAL,
  raven_fee_bps INTEGER NOT NULL DEFAULT 0 CHECK (raven_fee_bps BETWEEN 0 AND 1000),
  expected_raven_fee_usdc REAL CHECK (expected_raven_fee_usdc IS NULL OR expected_raven_fee_usdc >= 0),
  observed_raven_fee_usdc REAL CHECK (observed_raven_fee_usdc IS NULL OR observed_raven_fee_usdc >= 0),
  fee_token TEXT CHECK (
    fee_token IS NULL OR fee_token IN ('USDC', 'ETH')
    OR (length(fee_token) = 42 AND substr(fee_token, 1, 2) = '0x'
        AND substr(fee_token, 3) NOT GLOB '*[^0-9a-f]*')
    OR (length(fee_token) BETWEEN 32 AND 44
        AND fee_token NOT GLOB '*[^1-9A-HJ-NP-Za-km-z]*')
  ),
  fee_recipient TEXT CHECK (fee_recipient IS NULL OR length(fee_recipient) BETWEEN 32 AND 64),
  fee_collection_method TEXT NOT NULL DEFAULT 'none' CHECK (
    fee_collection_method IN (
      'none', 'hyperliquid_builder_code', 'zero_x_integrator_fee',
      'jupiter_referral_program'
    )
  ),
  fee_collection_status TEXT NOT NULL DEFAULT 'disabled' CHECK (
    fee_collection_status IN ('disabled', 'expected', 'observed', 'failed', 'indeterminate')
  ),
  state TEXT NOT NULL CHECK (state IN (
    'awaiting_wallet_signature', 'submission_pending', 'client_reported',
    'reconciliation_pending', 'provider_confirmed', 'provider_rejected',
    'expired', 'failed', 'indeterminate', 'rejected'
  )),
  prepared_payload_hash TEXT NOT NULL CHECK (
    length(prepared_payload_hash) = 64
    AND prepared_payload_hash NOT GLOB '*[^0-9a-f]*'
  ),
  provider_request_id TEXT,
  prepared_json TEXT NOT NULL CHECK (json_valid(prepared_json) AND length(prepared_json) <= 65536),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  accounting_asset_address TEXT CHECK (
    accounting_asset_address IS NULL
    OR (length(accounting_asset_address) = 42 AND substr(accounting_asset_address, 1, 2) = '0x'
        AND substr(accounting_asset_address, 3) NOT GLOB '*[^0-9a-f]*')
  ),
  notional_accounting_base_units TEXT CHECK (
    notional_accounting_base_units IS NULL
    OR (length(notional_accounting_base_units) BETWEEN 1 AND 78
        AND notional_accounting_base_units NOT GLOB '*[^0-9]*')
  ),
  expected_raven_fee_amount_base_units TEXT CHECK (
    expected_raven_fee_amount_base_units IS NULL
    OR (length(expected_raven_fee_amount_base_units) BETWEEN 1 AND 78
        AND expected_raven_fee_amount_base_units NOT GLOB '*[^0-9]*')
  ),
  observed_raven_fee_amount_base_units TEXT CHECK (
    observed_raven_fee_amount_base_units IS NULL
    OR (length(observed_raven_fee_amount_base_units) BETWEEN 1 AND 78
        AND observed_raven_fee_amount_base_units NOT GLOB '*[^0-9]*')
  ),
  transaction_hash TEXT CHECK (
    transaction_hash IS NULL
    OR (length(transaction_hash) = 66 AND substr(transaction_hash, 1, 2) = '0x'
        AND substr(transaction_hash, 3) NOT GLOB '*[^0-9a-f]*')
  ),
  entry_quote_hash TEXT CHECK (
    entry_quote_hash IS NULL
    OR (length(entry_quote_hash) = 64 AND entry_quote_hash NOT GLOB '*[^0-9a-f]*')
  ),
  exit_quote_hash TEXT CHECK (
    exit_quote_hash IS NULL
    OR (length(exit_quote_hash) = 64 AND exit_quote_hash NOT GLOB '*[^0-9a-f]*')
  ),
  CHECK (execution_id GLOB 'lex_*' AND length(execution_id) BETWEEN 20 AND 100),
  CHECK (notional_usdc IS NULL OR (notional_usdc >= 0 AND notional_usdc <= 1000000)),
  CHECK (expires_at > created_at),
  CHECK (updated_at >= created_at),
  CHECK (
    (venue = 'zero_x' AND chain_namespace NOT IN ('hyperliquid', 'solana'))
    OR (venue = 'hyperliquid' AND chain_namespace = 'hyperliquid')
    OR (venue = 'jupiter' AND chain_namespace = 'solana')
  )
);

INSERT INTO ravenos_customer_live_execution_intents
SELECT * FROM ravenos_customer_live_execution_intents_v2;

CREATE TABLE ravenos_customer_live_execution_events (
  event_id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES ravenos_customer_live_execution_intents(execution_id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (length(state) BETWEEN 1 AND 40),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json) AND length(evidence_json) <= 32768),
  observed_at INTEGER NOT NULL,
  CHECK (event_id GLOB 'lee_*' AND length(event_id) BETWEEN 20 AND 100)
);

INSERT INTO ravenos_customer_live_execution_events
SELECT * FROM ravenos_customer_live_execution_events_v2;

DROP TABLE ravenos_customer_live_execution_events_v2;
DROP TABLE ravenos_customer_live_execution_intents_v2;

CREATE INDEX ravenos_customer_live_execution_user_idx
  ON ravenos_customer_live_execution_intents(user_id, created_at DESC, execution_id);
CREATE INDEX ravenos_customer_live_execution_reconcile_idx
  ON ravenos_customer_live_execution_intents(state, updated_at, execution_id);
CREATE UNIQUE INDEX ravenos_customer_live_execution_provider_request_idx
  ON ravenos_customer_live_execution_intents(venue, provider_request_id)
  WHERE provider_request_id IS NOT NULL;
CREATE UNIQUE INDEX ravenos_customer_live_execution_transaction_idx
  ON ravenos_customer_live_execution_intents(chain_namespace, transaction_hash)
  WHERE transaction_hash IS NOT NULL;
CREATE INDEX ravenos_customer_live_execution_events_intent_idx
  ON ravenos_customer_live_execution_events(execution_id, observed_at, event_id);

CREATE TRIGGER ravenos_customer_live_execution_events_append_only
BEFORE UPDATE ON ravenos_customer_live_execution_events
BEGIN
  SELECT RAISE(ABORT, 'customer_live_execution_event_append_only');
END;

CREATE TRIGGER ravenos_customer_live_execution_events_no_delete
BEFORE DELETE ON ravenos_customer_live_execution_events
BEGIN
  SELECT RAISE(ABORT, 'customer_live_execution_event_append_only');
END;
