PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ravenos_users (
  user_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.user.v1',
  state TEXT NOT NULL CHECK (state IN ('pending_activation', 'active', 'recovery_restricted', 'security_hold', 'disabled', 'deletion_pending', 'deleted')),
  primary_email TEXT NOT NULL,
  display_name TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_authenticated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ravenos_credentials (
  credential_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.credential.v1',
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  issuer TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  authentication_method TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  revoked_at INTEGER,
  UNIQUE (issuer, provider_subject)
);

CREATE INDEX IF NOT EXISTS ravenos_credentials_user_idx
  ON ravenos_credentials(user_id, revoked_at);

CREATE TABLE IF NOT EXISTS ravenos_auth_states (
  state_hash TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.auth_state.v1',
  code_verifier TEXT NOT NULL,
  provider TEXT NOT NULL,
  intent TEXT NOT NULL CHECK (intent IN ('sign_in', 'sign_up', 'reauth')),
  return_to TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE INDEX IF NOT EXISTS ravenos_auth_states_expiry_idx
  ON ravenos_auth_states(expires_at, consumed_at);

CREATE TABLE IF NOT EXISTS ravenos_sessions (
  session_public_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.session.v1',
  session_verifier TEXT NOT NULL UNIQUE,
  csrf_verifier TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL REFERENCES ravenos_credentials(credential_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  authenticated_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  idle_expires_at INTEGER NOT NULL,
  absolute_expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  revocation_reason TEXT,
  authentication_methods TEXT NOT NULL,
  authentication_strength TEXT NOT NULL,
  device_label TEXT NOT NULL,
  risk_state TEXT NOT NULL DEFAULT 'normal',
  rotation_parent_id TEXT
);

CREATE INDEX IF NOT EXISTS ravenos_sessions_user_idx
  ON ravenos_sessions(user_id, revoked_at, absolute_expires_at);

CREATE TABLE IF NOT EXISTS ravenos_security_events (
  audit_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.security_event.v1',
  event_type TEXT NOT NULL,
  user_id TEXT,
  session_public_id TEXT,
  outcome TEXT NOT NULL,
  reason_code TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ravenos_security_events_user_idx
  ON ravenos_security_events(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ravenos_auth_rate_limits (
  rate_key TEXT NOT NULL,
  action TEXT NOT NULL,
  window_started_at INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (rate_key, action)
);

CREATE INDEX IF NOT EXISTS ravenos_auth_rate_limits_expiry_idx
  ON ravenos_auth_rate_limits(expires_at);
