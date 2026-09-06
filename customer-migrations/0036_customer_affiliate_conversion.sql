PRAGMA foreign_keys = ON;
ALTER TABLE ravenos_pro_invoices ADD COLUMN paid_at INTEGER;
ALTER TABLE ravenos_pro_invoices ADD COLUMN payment_evidence_json TEXT CHECK(payment_evidence_json IS NULL OR json_valid(payment_evidence_json));

CREATE TABLE ravenos_affiliate_enrollments (
  user_id TEXT PRIMARY KEY REFERENCES ravenos_users(user_id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK(state IN ('active','paused','disqualified')),
  terms_version TEXT NOT NULL,
  terms_hash TEXT NOT NULL,
  accepted_at INTEGER NOT NULL,
  joined_at INTEGER NOT NULL,
  public_profile_cta INTEGER NOT NULL DEFAULT 0 CHECK(public_profile_cta IN (0,1)),
  disqualification_reason TEXT CHECK(disqualification_reason IN ('SELF_REFERRAL','DUPLICATE_ATTRIBUTION','REFUNDED_PAYMENT','FAILED_PAYMENT','FRAUDULENT_ACCOUNT','TERMS_VIOLATION','MANUAL_REVIEW'))
);
CREATE TABLE ravenos_referral_aliases (
  alias TEXT PRIMARY KEY COLLATE NOCASE,
  user_id TEXT NOT NULL REFERENCES ravenos_affiliate_enrollments(user_id),
  referral_code TEXT NOT NULL REFERENCES ravenos_referral_codes(referral_code),
  created_at INTEGER NOT NULL
);
CREATE TRIGGER ravenos_referral_aliases_immutable BEFORE UPDATE ON ravenos_referral_aliases BEGIN SELECT RAISE(ABORT,'referral_alias_immutable'); END;
CREATE TRIGGER ravenos_referral_aliases_no_delete BEFORE DELETE ON ravenos_referral_aliases BEGIN SELECT RAISE(ABORT,'referral_alias_immutable'); END;
CREATE TABLE ravenos_referral_clicks (
  click_id TEXT PRIMARY KEY,
  referrer_user_id TEXT NOT NULL REFERENCES ravenos_affiliate_enrollments(user_id),
  referral_code TEXT NOT NULL,
  first_click_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  CHECK(expires_at>first_click_at)
);
CREATE TRIGGER ravenos_referral_clicks_immutable BEFORE UPDATE ON ravenos_referral_clicks BEGIN SELECT RAISE(ABORT,'referral_click_immutable'); END;
CREATE TRIGGER ravenos_referral_clicks_no_delete BEFORE DELETE ON ravenos_referral_clicks BEGIN SELECT RAISE(ABORT,'referral_click_immutable'); END;
CREATE TABLE ravenos_referral_signup_locks (
  auth_state_hash TEXT PRIMARY KEY,
  click_id TEXT NOT NULL REFERENCES ravenos_referral_clicks(click_id),
  locked_at INTEGER NOT NULL
);
CREATE TRIGGER ravenos_referral_signup_locks_immutable BEFORE UPDATE ON ravenos_referral_signup_locks BEGIN SELECT RAISE(ABORT,'signup_referral_immutable'); END;
CREATE TRIGGER ravenos_referral_signup_locks_no_delete BEFORE DELETE ON ravenos_referral_signup_locks BEGIN SELECT RAISE(ABORT,'signup_referral_immutable'); END;

-- Extend the existing immutable referral relationship, rather than creating
-- another relationship keyed to a mutable username or a browser cookie.
CREATE TABLE ravenos_referral_conversion_windows (
  attribution_id TEXT PRIMARY KEY REFERENCES ravenos_referral_attributions(attribution_id),
  click_id TEXT NOT NULL UNIQUE REFERENCES ravenos_referral_clicks(click_id),
  first_click_at INTEGER NOT NULL,
  signup_at INTEGER NOT NULL,
  attribution_expires_at INTEGER NOT NULL,
  paid_conversion_at INTEGER,
  commission_ends_at INTEGER,
  first_paid_invoice_id TEXT REFERENCES ravenos_pro_invoices(invoice_id),
  disqualification_reason TEXT CHECK(disqualification_reason IN ('SELF_REFERRAL','DUPLICATE_ATTRIBUTION','REFUNDED_PAYMENT','FAILED_PAYMENT','FRAUDULENT_ACCOUNT','TERMS_VIOLATION','MANUAL_REVIEW')),
  CHECK(signup_at>=first_click_at AND attribution_expires_at>first_click_at),
  CHECK((paid_conversion_at IS NULL AND commission_ends_at IS NULL AND first_paid_invoice_id IS NULL) OR (paid_conversion_at IS NOT NULL AND commission_ends_at>paid_conversion_at AND first_paid_invoice_id IS NOT NULL))
);
CREATE TRIGGER ravenos_referral_window_immutable BEFORE UPDATE ON ravenos_referral_conversion_windows
WHEN NEW.attribution_id!=OLD.attribution_id OR NEW.click_id!=OLD.click_id OR NEW.first_click_at!=OLD.first_click_at OR NEW.signup_at!=OLD.signup_at OR NEW.attribution_expires_at!=OLD.attribution_expires_at
 OR (OLD.paid_conversion_at IS NOT NULL AND (NEW.paid_conversion_at IS NOT OLD.paid_conversion_at OR NEW.commission_ends_at IS NOT OLD.commission_ends_at OR NEW.first_paid_invoice_id IS NOT OLD.first_paid_invoice_id))
BEGIN SELECT RAISE(ABORT,'referral_window_immutable'); END;
CREATE TRIGGER ravenos_referral_window_no_delete BEFORE DELETE ON ravenos_referral_conversion_windows BEGIN SELECT RAISE(ABORT,'referral_window_immutable'); END;

-- Affiliate USD cents never enter the USDC cashback ledger.
CREATE TABLE ravenos_affiliate_commission_ledger (
  entry_id TEXT PRIMARY KEY,
  affiliate_user_id TEXT NOT NULL REFERENCES ravenos_affiliate_enrollments(user_id),
  referred_user_id TEXT NOT NULL REFERENCES ravenos_users(user_id),
  attribution_id TEXT NOT NULL REFERENCES ravenos_referral_attributions(attribution_id),
  subscription_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL REFERENCES ravenos_pro_invoices(invoice_id),
  qualifying_revenue_cents INTEGER NOT NULL CHECK(qualifying_revenue_cents>=0),
  commission_percent INTEGER NOT NULL CHECK(commission_percent BETWEEN 0 AND 100),
  amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
  currency TEXT NOT NULL DEFAULT 'usd' CHECK(currency='usd'),
  status TEXT NOT NULL CHECK(status IN ('PENDING','EARNED','APPROVED','PAID','REVERSED','DISPUTED','DISQUALIFIED')),
  earned_delta INTEGER NOT NULL DEFAULT 0,
  pending_delta INTEGER NOT NULL DEFAULT 0,
  available_delta INTEGER NOT NULL DEFAULT 0,
  paid_delta INTEGER NOT NULL DEFAULT 0,
  recoverable_delta INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
  idempotency_key TEXT NOT NULL UNIQUE
);
CREATE INDEX ravenos_affiliate_ledger_owner_idx ON ravenos_affiliate_commission_ledger(affiliate_user_id,created_at DESC);
CREATE INDEX ravenos_affiliate_ledger_invoice_idx ON ravenos_affiliate_commission_ledger(invoice_id,created_at);
CREATE TRIGGER ravenos_affiliate_ledger_immutable BEFORE UPDATE ON ravenos_affiliate_commission_ledger BEGIN SELECT RAISE(ABORT,'affiliate_ledger_append_only'); END;
CREATE TRIGGER ravenos_affiliate_ledger_no_delete BEFORE DELETE ON ravenos_affiliate_commission_ledger BEGIN SELECT RAISE(ABORT,'affiliate_ledger_append_only'); END;
CREATE TRIGGER ravenos_affiliate_ledger_money BEFORE INSERT ON ravenos_affiliate_commission_ledger
WHEN NOT EXISTS(SELECT 1 FROM ravenos_affiliate_commission_ledger WHERE idempotency_key=NEW.idempotency_key)
AND (typeof(NEW.amount_cents)!='integer' OR typeof(NEW.earned_delta)!='integer' OR typeof(NEW.pending_delta)!='integer' OR typeof(NEW.available_delta)!='integer' OR typeof(NEW.paid_delta)!='integer' OR typeof(NEW.recoverable_delta)!='integer'
 OR NEW.pending_delta+COALESCE((SELECT SUM(pending_delta) FROM ravenos_affiliate_commission_ledger WHERE affiliate_user_id=NEW.affiliate_user_id),0)<0
 OR NEW.available_delta+COALESCE((SELECT SUM(available_delta) FROM ravenos_affiliate_commission_ledger WHERE affiliate_user_id=NEW.affiliate_user_id),0)<0
 OR NEW.recoverable_delta+COALESCE((SELECT SUM(recoverable_delta) FROM ravenos_affiliate_commission_ledger WHERE affiliate_user_id=NEW.affiliate_user_id),0)<0)
BEGIN SELECT RAISE(ABORT,'affiliate_money_invalid'); END;
CREATE TRIGGER ravenos_affiliate_accounting_identity BEFORE INSERT ON ravenos_affiliate_commission_ledger
WHEN NEW.earned_delta != NEW.pending_delta + NEW.available_delta + NEW.paid_delta - NEW.recoverable_delta
BEGIN SELECT RAISE(ABORT,'affiliate_accounting_unbalanced'); END;

CREATE TRIGGER ravenos_affiliate_invoice_balance BEFORE INSERT ON ravenos_affiliate_commission_ledger
WHEN NOT EXISTS(SELECT 1 FROM ravenos_affiliate_commission_ledger WHERE idempotency_key=NEW.idempotency_key)
AND (NEW.pending_delta+COALESCE((SELECT SUM(pending_delta) FROM ravenos_affiliate_commission_ledger WHERE invoice_id=NEW.invoice_id),0)<0
 OR NEW.available_delta+COALESCE((SELECT SUM(available_delta) FROM ravenos_affiliate_commission_ledger WHERE invoice_id=NEW.invoice_id),0)<0)
BEGIN SELECT RAISE(ABORT,'affiliate_invoice_balance_insufficient'); END;

CREATE TABLE ravenos_affiliate_review_events (
 review_id TEXT PRIMARY KEY,
 attribution_id TEXT NOT NULL REFERENCES ravenos_referral_attributions(attribution_id),
 operator_user_id TEXT NOT NULL REFERENCES ravenos_users(user_id),
 reason TEXT NOT NULL CHECK(reason IN ('SELF_REFERRAL','DUPLICATE_ATTRIBUTION','REFUNDED_PAYMENT','FAILED_PAYMENT','FRAUDULENT_ACCOUNT','TERMS_VIOLATION','MANUAL_REVIEW')),
 reference TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE TRIGGER ravenos_affiliate_review_immutable BEFORE UPDATE ON ravenos_affiliate_review_events BEGIN SELECT RAISE(ABORT,'affiliate_review_append_only'); END;
CREATE TRIGGER ravenos_affiliate_review_no_delete BEFORE DELETE ON ravenos_affiliate_review_events BEGIN SELECT RAISE(ABORT,'affiliate_review_append_only'); END;

-- Serialize live invoice reads as well as ledger writes, so a slow earlier
-- webhook cannot overwrite fresher refund/chargeback evidence.
CREATE TABLE ravenos_pro_invoice_locks (
 invoice_id TEXT PRIMARY KEY,
 owner_token TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
