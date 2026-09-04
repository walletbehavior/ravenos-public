PRAGMA foreign_keys = ON;

-- Referral codes are opaque and stable. They do not expose usernames, email,
-- billing identity, wallet identity, or account size.
CREATE TABLE IF NOT EXISTS ravenos_referral_codes (
  user_id TEXT PRIMARY KEY REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.referral_code.v1',
  referral_code TEXT NOT NULL COLLATE NOCASE UNIQUE,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'paused')),
  code_digest TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (referral_code GLOB 'RVN[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]*'),
  CHECK (substr(referral_code, 4) NOT GLOB '*[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ]*'),
  CHECK (length(referral_code) = 15),
  CHECK (created_at >= 0 AND updated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS ravenos_referral_codes_state_idx
  ON ravenos_referral_codes(state, created_at DESC, user_id);

-- One account may be attributed once. Attribution is append-only so a user,
-- referrer, or future billing process cannot silently replace the referrer.
CREATE TABLE IF NOT EXISTS ravenos_referral_attributions (
  attribution_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.referral_attribution.v1',
  referred_user_id TEXT NOT NULL UNIQUE REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  referrer_user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  referral_code_snapshot TEXT NOT NULL,
  attribution_method TEXT NOT NULL CHECK (attribution_method IN ('authenticated_claim')),
  attribution_digest TEXT NOT NULL UNIQUE,
  attributed_at INTEGER NOT NULL,
  CHECK (referred_user_id <> referrer_user_id),
  CHECK (referral_code_snapshot GLOB 'RVN[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]*'),
  CHECK (substr(referral_code_snapshot, 4) NOT GLOB '*[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ]*'),
  CHECK (length(referral_code_snapshot) = 15),
  CHECK (attributed_at >= 0)
);

CREATE INDEX IF NOT EXISTS ravenos_referral_attributions_referrer_idx
  ON ravenos_referral_attributions(referrer_user_id, attributed_at DESC, attribution_id);

CREATE TRIGGER IF NOT EXISTS ravenos_referral_attributions_append_only_update
BEFORE UPDATE ON ravenos_referral_attributions
BEGIN
  SELECT RAISE(ABORT, 'referral_attribution_append_only');
END;

CREATE TRIGGER IF NOT EXISTS ravenos_referral_attributions_append_only_delete
BEFORE DELETE ON ravenos_referral_attributions
BEGIN
  SELECT RAISE(ABORT, 'referral_attribution_append_only');
END;

-- Only a separately reviewed billing reconciliation path may write these
-- facts. Customer referral routes can neither qualify a subscription nor
-- manufacture credit, earnings, or a payout.
CREATE TABLE IF NOT EXISTS ravenos_referral_subscription_evidence (
  event_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.referral_subscription_evidence.v1',
  attribution_id TEXT NOT NULL REFERENCES ravenos_referral_attributions(attribution_id),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'pro_subscription_activated',
    'pro_subscription_renewed',
    'pro_subscription_cancelled',
    'pro_subscription_refunded',
    'pro_subscription_chargeback'
  )),
  source_contract_id TEXT NOT NULL,
  source_reference_digest TEXT NOT NULL,
  effective_at INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  record_digest TEXT NOT NULL UNIQUE,
  CHECK (effective_at >= 0 AND observed_at >= 0)
);

CREATE INDEX IF NOT EXISTS ravenos_referral_subscription_attribution_idx
  ON ravenos_referral_subscription_evidence(attribution_id, effective_at DESC, event_id DESC);

CREATE TRIGGER IF NOT EXISTS ravenos_referral_subscription_append_only_update
BEFORE UPDATE ON ravenos_referral_subscription_evidence
BEGIN
  SELECT RAISE(ABORT, 'referral_subscription_evidence_append_only');
END;

CREATE TRIGGER IF NOT EXISTS ravenos_referral_subscription_append_only_delete
BEFORE DELETE ON ravenos_referral_subscription_evidence
BEGIN
  SELECT RAISE(ABORT, 'referral_subscription_evidence_append_only');
END;

CREATE TABLE IF NOT EXISTS ravenos_referral_audit_events (
  event_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.referral_audit_event.v1',
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('referral_code_created', 'referral_attributed')),
  attribution_id TEXT,
  event_digest TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
);

CREATE INDEX IF NOT EXISTS ravenos_referral_audit_user_idx
  ON ravenos_referral_audit_events(user_id, created_at DESC, event_id);

CREATE TRIGGER IF NOT EXISTS ravenos_referral_audit_append_only_update
BEFORE UPDATE ON ravenos_referral_audit_events
BEGIN
  SELECT RAISE(ABORT, 'referral_audit_event_append_only');
END;

CREATE TRIGGER IF NOT EXISTS ravenos_referral_audit_append_only_delete
BEFORE DELETE ON ravenos_referral_audit_events
BEGIN
  SELECT RAISE(ABORT, 'referral_audit_event_append_only');
END;
