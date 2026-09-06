PRAGMA foreign_keys = ON;

CREATE TABLE ravenos_pro_trials (
  user_id TEXT PRIMARY KEY REFERENCES ravenos_users(user_id) ON DELETE RESTRICT,
  identity_digest TEXT NOT NULL UNIQUE,
  email_digest TEXT NOT NULL UNIQUE,
  trial_started_at INTEGER NOT NULL,
  trial_ends_at INTEGER NOT NULL CHECK (trial_ends_at > trial_started_at),
  trial_status TEXT NOT NULL CHECK (trial_status IN ('ACTIVE', 'EXPIRED', 'CONVERTED', 'CANCELLED', 'ABUSE_BLOCKED')),
  eligibility_policy TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK (length(identity_digest) = 64 AND length(email_digest) = 64)
);

CREATE TRIGGER ravenos_pro_trial_identity_immutable BEFORE UPDATE ON ravenos_pro_trials
WHEN NEW.user_id != OLD.user_id OR NEW.identity_digest != OLD.identity_digest OR NEW.email_digest != OLD.email_digest
  OR NEW.trial_started_at != OLD.trial_started_at OR NEW.trial_ends_at != OLD.trial_ends_at
BEGIN SELECT RAISE(ABORT, 'trial_identity_and_window_immutable'); END;
CREATE TRIGGER ravenos_pro_trial_no_delete BEFORE DELETE ON ravenos_pro_trials
BEGIN SELECT RAISE(ABORT, 'trial_history_retained'); END;

-- Account-owned successor to the quarantined wallet-address billing records.
-- Legacy tables/routes are not reactivated or silently linked to new users.
CREATE TABLE ravenos_pro_subscriptions (
  user_id TEXT PRIMARY KEY REFERENCES ravenos_users(user_id) ON DELETE RESTRICT,
  stripe_customer_id TEXT NOT NULL UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'none',
  period_start INTEGER,
  period_end INTEGER,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK (cancel_at_period_end IN (0, 1)),
  paid_history INTEGER NOT NULL DEFAULT 0 CHECK (paid_history IN (0, 1)),
  last_event_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE ravenos_reward_preferences (
  user_id TEXT PRIMARY KEY REFERENCES ravenos_users(user_id) ON DELETE RESTRICT,
  auto_apply INTEGER NOT NULL DEFAULT 0 CHECK (auto_apply IN (0, 1)),
  updated_at INTEGER NOT NULL
);

-- Execution eligibility is captured from server-owned entitlement at review.
CREATE TABLE ravenos_execution_reward_context (
  execution_id TEXT PRIMARY KEY REFERENCES ravenos_customer_live_execution_intents(execution_id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE RESTRICT,
  chain TEXT NOT NULL,
  venue TEXT NOT NULL,
  trade_type TEXT NOT NULL CHECK (trade_type IN ('manual', 'copy')),
  entitlement_source TEXT NOT NULL CHECK (entitlement_source IN ('standard', 'trial', 'paid')),
  eligible INTEGER NOT NULL CHECK (eligible IN (0, 1)),
  fee_token TEXT NOT NULL,
  fee_recipient TEXT NOT NULL,
  authorized_fee_bps INTEGER NOT NULL,
  expected_fee_micros TEXT,
  created_at INTEGER NOT NULL
);
CREATE TRIGGER ravenos_execution_reward_context_immutable BEFORE UPDATE ON ravenos_execution_reward_context
BEGIN SELECT RAISE(ABORT, 'reward_context_immutable'); END;
CREATE TRIGGER ravenos_execution_reward_context_no_delete BEFORE DELETE ON ravenos_execution_reward_context
BEGIN SELECT RAISE(ABORT, 'reward_context_immutable'); END;

-- Operational retry cursor only; monetary history and eligibility stay immutable.
CREATE TABLE ravenos_reward_reconciliation_attempts (
  execution_id TEXT PRIMARY KEY REFERENCES ravenos_execution_reward_context(execution_id) ON DELETE RESTRICT,
  last_attempt_at INTEGER NOT NULL,
  terminal INTEGER NOT NULL DEFAULT 0 CHECK(terminal IN (0,1)),
  result_state TEXT NOT NULL
);
CREATE INDEX ravenos_reward_reconciliation_retry_idx ON ravenos_reward_reconciliation_attempts(terminal,last_attempt_at);

-- Deltas are integer micro-USDC. No floating-point currency arithmetic.
-- States are appended: history is never overwritten into an opaque balance.
CREATE TABLE ravenos_reward_ledger (
  entry_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL CHECK (source_type IN ('TRADING_CASHBACK','COPY_TRADING_CASHBACK','CLAIM','SUBSCRIPTION_APPLICATION','REVERSAL','MANUAL_ADJUSTMENT')),
  source_trade_id TEXT,
  source_fee_event_id TEXT,
  operation_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING','AVAILABLE','RESERVED','CLAIMED','APPLIED_TO_SUBSCRIPTION','REVERSED','RELEASED')),
  amount_micros INTEGER NOT NULL CHECK (amount_micros >= 0 AND amount_micros <= 9007199254740991),
  available_delta INTEGER NOT NULL DEFAULT 0,
  pending_delta INTEGER NOT NULL DEFAULT 0,
  reserved_delta INTEGER NOT NULL DEFAULT 0,
  liability_delta INTEGER NOT NULL DEFAULT 0,
  earned_delta INTEGER NOT NULL DEFAULT 0,
  claimed_delta INTEGER NOT NULL DEFAULT 0,
  applied_delta INTEGER NOT NULL DEFAULT 0,
  adjustment_delta INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  idempotency_key TEXT NOT NULL UNIQUE
);
CREATE INDEX ravenos_reward_ledger_user_idx ON ravenos_reward_ledger(user_id, created_at DESC, entry_id);
CREATE INDEX ravenos_reward_ledger_fee_idx ON ravenos_reward_ledger(source_fee_event_id, status);
CREATE TRIGGER ravenos_reward_ledger_immutable BEFORE UPDATE ON ravenos_reward_ledger
BEGIN SELECT RAISE(ABORT, 'reward_ledger_append_only'); END;
CREATE TRIGGER ravenos_reward_ledger_no_delete BEFORE DELETE ON ravenos_reward_ledger
BEGIN SELECT RAISE(ABORT, 'reward_ledger_append_only'); END;
CREATE TRIGGER ravenos_reward_ledger_balanced BEFORE INSERT ON ravenos_reward_ledger
WHEN NOT EXISTS (SELECT 1 FROM ravenos_reward_ledger WHERE idempotency_key = NEW.idempotency_key)
AND (NEW.available_delta + COALESCE((SELECT SUM(available_delta) FROM ravenos_reward_ledger WHERE user_id = NEW.user_id), 0) < 0
  OR NEW.pending_delta + COALESCE((SELECT SUM(pending_delta) FROM ravenos_reward_ledger WHERE user_id = NEW.user_id), 0) < 0
  OR NEW.reserved_delta + COALESCE((SELECT SUM(reserved_delta) FROM ravenos_reward_ledger WHERE user_id = NEW.user_id), 0) < 0
  OR NEW.liability_delta + COALESCE((SELECT SUM(liability_delta) FROM ravenos_reward_ledger WHERE user_id = NEW.user_id), 0) < 0
  OR NEW.adjustment_delta + COALESCE((SELECT SUM(adjustment_delta) FROM ravenos_reward_ledger WHERE user_id = NEW.user_id), 0) < 0)
BEGIN SELECT RAISE(ABORT, 'reward_balance_insufficient'); END;

CREATE TABLE ravenos_reward_operations (
  operation_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('claim','subscription_credit')),
  state TEXT NOT NULL CHECK (state IN ('reserved','processing','settled','failed','indeterminate')),
  amount_micros INTEGER NOT NULL CHECK (amount_micros > 0 AND amount_micros <= 9007199254740991),
  request_digest TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  destination_json TEXT NOT NULL CHECK (json_valid(destination_json)),
  external_reference TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, idempotency_key)
);

CREATE TABLE ravenos_product_events (
  event_id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES ravenos_users(user_id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  details_json TEXT NOT NULL CHECK (json_valid(details_json)),
  UNIQUE(event_type, source_reference)
);

-- Actual collector receipts, never quotes. Noncanonical assets require a
-- separate, evidenced USDC valuation before any spendable reward is issued.
CREATE TABLE ravenos_reward_fee_receipts (
  fee_event_id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL UNIQUE REFERENCES ravenos_execution_reward_context(execution_id),
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id),
  chain TEXT NOT NULL,
  transaction_hash TEXT NOT NULL,
  fee_token TEXT NOT NULL,
  fee_recipient TEXT NOT NULL,
  amount_base_units TEXT NOT NULL,
  amount_usdc_micros INTEGER,
  customer_fee_base_units TEXT NOT NULL,
  customer_fee_usdc_micros INTEGER,
  provider_share_usdc_micros INTEGER,
  evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
  confirmed_at INTEGER NOT NULL,
  UNIQUE(chain, transaction_hash, fee_token, fee_recipient),
  CHECK(customer_fee_usdc_micros IS NULL OR (customer_fee_usdc_micros>=amount_usdc_micros AND customer_fee_usdc_micros=amount_usdc_micros+provider_share_usdc_micros))
);
CREATE TRIGGER ravenos_reward_fee_receipts_immutable BEFORE UPDATE ON ravenos_reward_fee_receipts
BEGIN SELECT RAISE(ABORT, 'fee_receipt_append_only'); END;
CREATE TRIGGER ravenos_reward_fee_receipts_no_delete BEFORE DELETE ON ravenos_reward_fee_receipts
BEGIN SELECT RAISE(ABORT, 'fee_receipt_append_only'); END;
CREATE TABLE ravenos_reward_fee_adjustments (
  adjustment_id TEXT PRIMARY KEY,
  fee_event_id TEXT NOT NULL UNIQUE REFERENCES ravenos_reward_fee_receipts(fee_event_id),
  reversed_fee_micros INTEGER NOT NULL CHECK(reversed_fee_micros > 0),
  evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
  created_at INTEGER NOT NULL
);
CREATE TRIGGER ravenos_reward_fee_adjustments_immutable BEFORE UPDATE ON ravenos_reward_fee_adjustments
BEGIN SELECT RAISE(ABORT, 'fee_adjustment_append_only'); END;
CREATE TRIGGER ravenos_reward_fee_adjustments_no_delete BEFORE DELETE ON ravenos_reward_fee_adjustments
BEGIN SELECT RAISE(ABORT, 'fee_adjustment_append_only'); END;
CREATE UNIQUE INDEX ravenos_reward_external_settlement_idx ON ravenos_reward_operations(kind, external_reference) WHERE external_reference IS NOT NULL;

CREATE TABLE ravenos_reward_wallet_challenges (
  challenge_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id),
  session_id TEXT NOT NULL,
  chain TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  verified_at INTEGER,
  consumed_at INTEGER
);
CREATE INDEX ravenos_product_events_time_idx ON ravenos_product_events(event_type, occurred_at DESC);
CREATE TRIGGER ravenos_product_events_immutable BEFORE UPDATE ON ravenos_product_events
BEGIN SELECT RAISE(ABORT, 'product_events_append_only'); END;
CREATE TRIGGER ravenos_product_events_no_delete BEFORE DELETE ON ravenos_product_events
BEGIN SELECT RAISE(ABORT, 'product_events_append_only'); END;

CREATE TABLE ravenos_pro_billing_events (
  stripe_event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  processed_at INTEGER,
  payload_digest TEXT NOT NULL
);
CREATE TABLE ravenos_pro_invoices (
  invoice_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE RESTRICT,
  stripe_subscription_id TEXT NOT NULL,
  gross_cents INTEGER NOT NULL,
  reward_credit_cents INTEGER NOT NULL DEFAULT 0,
  external_paid_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL CHECK (currency = 'usd'),
  status TEXT NOT NULL,
  period_start INTEGER,
  period_end INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TRIGGER ravenos_reward_ledger_integer_money BEFORE INSERT ON ravenos_reward_ledger
WHEN typeof(NEW.amount_micros) != 'integer' OR typeof(NEW.available_delta) != 'integer'
  OR typeof(NEW.pending_delta) != 'integer' OR typeof(NEW.reserved_delta) != 'integer'
  OR typeof(NEW.liability_delta) != 'integer' OR typeof(NEW.earned_delta) != 'integer'
  OR typeof(NEW.claimed_delta) != 'integer' OR typeof(NEW.applied_delta) != 'integer'
  OR typeof(NEW.adjustment_delta) != 'integer'
  OR NEW.liability_delta != NEW.available_delta + NEW.reserved_delta
BEGIN SELECT RAISE(ABORT, 'reward_money_must_balance_in_integer_micros'); END;

CREATE TABLE ravenos_pro_checkout_attempts (
  user_id TEXT PRIMARY KEY REFERENCES ravenos_users(user_id),
  attempt_id TEXT NOT NULL UNIQUE,
  stripe_session_id TEXT UNIQUE,
  checkout_url TEXT,
  state TEXT NOT NULL CHECK(state IN ('creating','open','completed','expired','indeterminate')),
  trial_end INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Serialize remote billing mutations; uncertain operations retain their lease
-- for recovery with the exact same idempotency key, never a blind retry.
CREATE TABLE ravenos_pro_billing_locks (
  user_id TEXT PRIMARY KEY REFERENCES ravenos_users(user_id),
  operation_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Authenticated copy execution provenance. Only the server may bind a live
-- ticket to an existing user-owned copy intent; shadow fills never qualify.
CREATE TABLE ravenos_copy_execution_links (
 execution_id TEXT PRIMARY KEY REFERENCES ravenos_customer_live_execution_intents(execution_id),
 user_id TEXT NOT NULL REFERENCES ravenos_users(user_id),
 copy_watch_id TEXT NOT NULL REFERENCES ravenos_customer_wallet_copy_watches(watch_id),
 source_decision_id TEXT NOT NULL REFERENCES ravenos_customer_shadow_copy_decisions(decision_id),
 created_at INTEGER NOT NULL
);
CREATE TRIGGER ravenos_copy_execution_links_immutable BEFORE UPDATE ON ravenos_copy_execution_links BEGIN SELECT RAISE(ABORT,'copy_execution_link_immutable'); END;
CREATE TRIGGER ravenos_copy_execution_links_no_delete BEFORE DELETE ON ravenos_copy_execution_links BEGIN SELECT RAISE(ABORT,'copy_execution_link_immutable'); END;

CREATE TRIGGER ravenos_copy_execution_link_owner BEFORE INSERT ON ravenos_copy_execution_links
WHEN NOT EXISTS (SELECT 1 FROM ravenos_customer_live_execution_intents i JOIN ravenos_customer_shadow_copy_decisions d ON d.user_id=i.user_id JOIN ravenos_customer_wallet_copy_watches w ON w.watch_id=d.watch_id AND w.user_id=i.user_id WHERE i.execution_id=NEW.execution_id AND i.user_id=NEW.user_id AND w.watch_id=NEW.copy_watch_id AND d.decision_id=NEW.source_decision_id)
BEGIN SELECT RAISE(ABORT,'copy_execution_owner_mismatch'); END;
ALTER TABLE ravenos_reward_operations ADD COLUMN submission_reference TEXT;
CREATE UNIQUE INDEX ravenos_reward_claim_submission_unique ON ravenos_reward_operations(json_extract(destination_json,'$.chain'),submission_reference) WHERE kind='claim' AND submission_reference IS NOT NULL;
CREATE TRIGGER ravenos_reward_claim_proof BEFORE INSERT ON ravenos_reward_operations
WHEN NEW.kind='claim' AND json_extract(NEW.destination_json,'$.kind')='external_connected'
AND NOT EXISTS(SELECT 1 FROM ravenos_reward_wallet_challenges p WHERE p.challenge_id=json_extract(NEW.destination_json,'$.verification_id') AND p.user_id=NEW.user_id AND p.chain=json_extract(NEW.destination_json,'$.chain') AND p.wallet_address=json_extract(NEW.destination_json,'$.wallet_address') AND p.verified_at IS NOT NULL AND p.consumed_at IS NULL AND p.expires_at>NEW.created_at)
BEGIN SELECT RAISE(ABORT,'claim_wallet_proof_unavailable'); END;
