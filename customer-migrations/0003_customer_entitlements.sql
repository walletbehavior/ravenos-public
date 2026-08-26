PRAGMA foreign_keys = ON;

-- Server-controlled capability grants only. Customer-facing routes may read
-- bounded availability but cannot insert, extend, reactivate, suspend, revoke,
-- or otherwise mutate these records.
CREATE TABLE IF NOT EXISTS ravenos_customer_entitlement_grants (
  grant_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.customer_entitlement_grant.v1',
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  capability_key TEXT NOT NULL CHECK (capability_key IN (
    'intelligence.perps_advanced',
    'intelligence.participant_advanced',
    'intelligence.replay_advanced',
    'intelligence.export',
    'research.saved_state_extended',
    'research.saved_scans',
    'research.alerts',
    'atlas.native_breadth',
    'atlas.filing_comparisons',
    'atlas.native_filing_marks',
    'atlas.portfolio_context',
    'atlas.options_intelligence',
    'atlas.authenticated_broker_overlay'
  )),
  state TEXT NOT NULL CHECK (state IN ('active', 'expired', 'revoked', 'suspended')),
  grant_source TEXT NOT NULL CHECK (grant_source IN ('operator', 'test_fixture', 'migration')),
  activation_at INTEGER,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  source_reference TEXT NOT NULL CHECK (length(source_reference) BETWEEN 1 AND 160),
  CHECK (grant_id GLOB 'ent_*' AND length(grant_id) BETWEEN 20 AND 100),
  CHECK (activation_at IS NULL OR activation_at >= 0),
  CHECK (expires_at IS NULL OR expires_at >= 0),
  CHECK (expires_at IS NULL OR activation_at IS NULL OR expires_at > activation_at),
  CHECK (created_at >= 0 AND updated_at >= created_at),
  UNIQUE (user_id, capability_key, grant_id)
);

CREATE INDEX IF NOT EXISTS ravenos_customer_entitlement_owner_capability_idx
  ON ravenos_customer_entitlement_grants(user_id, capability_key, state, expires_at, updated_at DESC);
