PRAGMA foreign_keys = ON;

-- Explicit user-adopted policy versions. These are immutable inputs to the
-- deterministic governor and never grant execution authority.
CREATE TABLE ravenos_agent_user_policies (
  policy_version_id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  agent_id TEXT NOT NULL REFERENCES ravenos_agents(agent_id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version >= 1),
  schema_version TEXT NOT NULL,
  policy_hash TEXT NOT NULL CHECK (length(policy_hash) = 64),
  policy_json TEXT NOT NULL CHECK (json_valid(policy_json) AND length(policy_json) <= 131072),
  created_at INTEGER NOT NULL,
  UNIQUE (agent_id, version),
  UNIQUE (agent_id, policy_hash)
);

CREATE INDEX ravenos_agent_user_policies_owner_idx
  ON ravenos_agent_user_policies(user_id, agent_id, version DESC);

-- Paper capital is explicitly chain and venue local. A new allocation creates
-- a new immutable version rather than rewriting prior policy evidence.
CREATE TABLE ravenos_agent_capital_versions (
  capital_version_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES ravenos_agents(agent_id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version >= 1),
  schema_version TEXT NOT NULL,
  record_hash TEXT NOT NULL CHECK (length(record_hash) = 64),
  capital_json TEXT NOT NULL CHECK (json_valid(capital_json) AND length(capital_json) <= 131072),
  created_at INTEGER NOT NULL,
  UNIQUE (agent_id, version),
  UNIQUE (agent_id, record_hash)
);

CREATE INDEX ravenos_agent_capital_versions_owner_idx
  ON ravenos_agent_capital_versions(user_id, agent_id, version DESC);

-- Scheduling is operational state. The schedule can activate only in paper
-- mode and does not contain transaction material.
CREATE TABLE ravenos_agent_paper_schedules (
  schedule_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES ravenos_agents(agent_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  current_spec_id TEXT NOT NULL REFERENCES ravenos_agent_specs(spec_id) ON DELETE RESTRICT,
  schema_version TEXT NOT NULL,
  schedule_hash TEXT NOT NULL CHECK (length(schedule_hash) = 64),
  trigger_kind TEXT NOT NULL CHECK (trigger_kind = 'interval'),
  interval_seconds INTEGER NOT NULL CHECK (interval_seconds IN (60, 300, 900, 3600)),
  state TEXT NOT NULL CHECK (state IN ('draft', 'active', 'paused', 'killed')),
  next_run_at INTEGER,
  last_run_at INTEGER,
  run_count INTEGER NOT NULL DEFAULT 0 CHECK (run_count >= 0),
  schedule_json TEXT NOT NULL CHECK (json_valid(schedule_json) AND length(schedule_json) <= 65536),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (updated_at >= created_at),
  CHECK (state <> 'active' OR next_run_at IS NOT NULL),
  UNIQUE (agent_id)
);

CREATE INDEX ravenos_agent_paper_schedules_due_idx
  ON ravenos_agent_paper_schedules(state, next_run_at, schedule_id);

-- Creation idempotency is owner scoped and append-only. Reusing a key with a
-- different request fingerprint is a conflict, never a second agent.
CREATE TABLE ravenos_agent_creation_requests (
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL CHECK (length(request_fingerprint) = 64),
  agent_id TEXT NOT NULL REFERENCES ravenos_agents(agent_id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, idempotency_key),
  UNIQUE (agent_id)
);

CREATE TRIGGER ravenos_agent_user_policies_append_only_update BEFORE UPDATE ON ravenos_agent_user_policies BEGIN SELECT RAISE(ABORT, 'agent_user_policy_append_only'); END;
CREATE TRIGGER ravenos_agent_user_policies_append_only_delete BEFORE DELETE ON ravenos_agent_user_policies BEGIN SELECT RAISE(ABORT, 'agent_user_policy_append_only'); END;
CREATE TRIGGER ravenos_agent_capital_versions_append_only_update BEFORE UPDATE ON ravenos_agent_capital_versions BEGIN SELECT RAISE(ABORT, 'agent_capital_version_append_only'); END;
CREATE TRIGGER ravenos_agent_capital_versions_append_only_delete BEFORE DELETE ON ravenos_agent_capital_versions BEGIN SELECT RAISE(ABORT, 'agent_capital_version_append_only'); END;
CREATE TRIGGER ravenos_agent_creation_requests_append_only_update BEFORE UPDATE ON ravenos_agent_creation_requests BEGIN SELECT RAISE(ABORT, 'agent_creation_request_append_only'); END;
CREATE TRIGGER ravenos_agent_creation_requests_append_only_delete BEFORE DELETE ON ravenos_agent_creation_requests BEGIN SELECT RAISE(ABORT, 'agent_creation_request_append_only'); END;
