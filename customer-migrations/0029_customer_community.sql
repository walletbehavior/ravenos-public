PRAGMA foreign_keys = ON;

-- Raven Community is opt-in. Creating an account or choosing a username does
-- not publish a profile or any trading information.
CREATE TABLE IF NOT EXISTS ravenos_community_profiles (
  user_id TEXT PRIMARY KEY REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.community_profile.v1',
  public_profile_enabled INTEGER NOT NULL DEFAULT 0 CHECK (public_profile_enabled IN (0, 1)),
  performance_visible INTEGER NOT NULL DEFAULT 0 CHECK (performance_visible IN (0, 1)),
  positions_visible INTEGER NOT NULL DEFAULT 0 CHECK (positions_visible IN (0, 1)),
  trade_history_visible INTEGER NOT NULL DEFAULT 0 CHECK (trade_history_visible IN (0, 1)),
  strategy_breakdown_visible INTEGER NOT NULL DEFAULT 0 CHECK (strategy_breakdown_visible IN (0, 1)),
  wallet_addresses_visible INTEGER NOT NULL DEFAULT 0 CHECK (wallet_addresses_visible IN (0, 1)),
  followers_visibility TEXT NOT NULL DEFAULT 'private' CHECK (followers_visibility IN ('private', 'public')),
  allow_following INTEGER NOT NULL DEFAULT 0 CHECK (allow_following IN (0, 1)),
  allow_shadowing INTEGER NOT NULL DEFAULT 0 CHECK (allow_shadowing IN (0, 1)),
  allow_raven_copy INTEGER NOT NULL DEFAULT 0 CHECK (allow_raven_copy IN (0, 1)),
  referral_link_public INTEGER NOT NULL DEFAULT 0 CHECK (referral_link_public IN (0, 1)),
  profile_revision INTEGER NOT NULL DEFAULT 1 CHECK (profile_revision >= 1),
  settings_digest TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ravenos_community_profiles_public_idx
  ON ravenos_community_profiles(public_profile_enabled, updated_at DESC, user_id);

CREATE TABLE IF NOT EXISTS ravenos_community_follows (
  follower_user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  followed_user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  notification_level TEXT NOT NULL DEFAULT 'meaningful' CHECK (notification_level IN ('off', 'meaningful')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (follower_user_id, followed_user_id),
  CHECK (follower_user_id <> followed_user_id)
);

CREATE INDEX IF NOT EXISTS ravenos_community_follows_target_idx
  ON ravenos_community_follows(followed_user_id, created_at DESC, follower_user_id);

CREATE TABLE IF NOT EXISTS ravenos_community_recognitions (
  actor_user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  recognized_user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  recognition_kind TEXT NOT NULL CHECK (recognition_kind = 'useful'),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (actor_user_id, recognized_user_id, recognition_kind),
  CHECK (actor_user_id <> recognized_user_id)
);

CREATE INDEX IF NOT EXISTS ravenos_community_recognitions_target_idx
  ON ravenos_community_recognitions(recognized_user_id, recognition_kind, created_at DESC);

-- This is an append-only public-safe projection seam. No public route writes
-- these rows. A reviewed Raven/RavenOS evidence producer must provide the
-- source contract and digest before performance can appear on a profile.
CREATE TABLE IF NOT EXISTS ravenos_community_performance_evidence (
  evidence_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.community_performance_evidence.v1',
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  period TEXT NOT NULL CHECK (period IN ('30d', '90d', '1y', 'all_available')),
  observation_type TEXT NOT NULL CHECK (observation_type IN (
    'raven_observed',
    'connected_account_observed',
    'user_reported',
    'historically_reconstructed',
    'prospective',
    'simulated'
  )),
  evidence_state TEXT NOT NULL CHECK (evidence_state IN ('available', 'partial', 'insufficient_evidence')),
  source_contract_id TEXT NOT NULL,
  source_reference_digest TEXT NOT NULL,
  observed_from INTEGER NOT NULL,
  observed_through INTEGER NOT NULL,
  sample_count INTEGER NOT NULL CHECK (sample_count >= 0),
  evidence_confidence_pct REAL NOT NULL CHECK (evidence_confidence_pct >= 0 AND evidence_confidence_pct <= 100),
  return_pct REAL,
  maximum_drawdown_pct REAL,
  profit_factor REAL,
  profitable_periods INTEGER CHECK (profitable_periods IS NULL OR profitable_periods >= 0),
  active_periods INTEGER CHECK (active_periods IS NULL OR active_periods >= 0),
  top_1_profit_concentration_pct REAL CHECK (top_1_profit_concentration_pct IS NULL OR (top_1_profit_concentration_pct >= 0 AND top_1_profit_concentration_pct <= 100)),
  copyability_score REAL CHECK (copyability_score IS NULL OR (copyability_score >= 0 AND copyability_score <= 100)),
  follower_capture_pct REAL,
  supersedes_evidence_id TEXT REFERENCES ravenos_community_performance_evidence(evidence_id),
  record_digest TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  CHECK (observed_through >= observed_from),
  CHECK (active_periods IS NULL OR profitable_periods IS NULL OR profitable_periods <= active_periods)
);

CREATE INDEX IF NOT EXISTS ravenos_community_performance_subject_idx
  ON ravenos_community_performance_evidence(user_id, period, created_at DESC, evidence_id);

CREATE INDEX IF NOT EXISTS ravenos_community_performance_board_idx
  ON ravenos_community_performance_evidence(period, evidence_state, evidence_confidence_pct DESC, sample_count DESC);

CREATE TRIGGER IF NOT EXISTS ravenos_community_performance_append_only_update
BEFORE UPDATE ON ravenos_community_performance_evidence
BEGIN
  SELECT RAISE(ABORT, 'community_performance_evidence_append_only');
END;

CREATE TRIGGER IF NOT EXISTS ravenos_community_performance_append_only_delete
BEFORE DELETE ON ravenos_community_performance_evidence
BEGIN
  SELECT RAISE(ABORT, 'community_performance_evidence_append_only');
END;

CREATE TABLE IF NOT EXISTS ravenos_community_audit_events (
  event_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.community_audit_event.v1',
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  subject_user_id TEXT REFERENCES ravenos_users(user_id) ON DELETE SET NULL,
  prior_settings_digest TEXT,
  current_settings_digest TEXT,
  reason_code TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ravenos_community_audit_user_idx
  ON ravenos_community_audit_events(user_id, created_at DESC, event_id);

CREATE TRIGGER IF NOT EXISTS ravenos_community_audit_append_only_update
BEFORE UPDATE ON ravenos_community_audit_events
BEGIN
  SELECT RAISE(ABORT, 'community_audit_event_append_only');
END;

CREATE TRIGGER IF NOT EXISTS ravenos_community_audit_append_only_delete
BEFORE DELETE ON ravenos_community_audit_events
BEGIN
  SELECT RAISE(ABORT, 'community_audit_event_append_only');
END;
