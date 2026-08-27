PRAGMA foreign_keys = ON;

-- Customer-authored, exact-market research monitors. These records deliberately
-- exclude symbols as selectors, provider payloads, plan prices, wallets, orders,
-- positions, signing material, and executable expressions.
CREATE TABLE IF NOT EXISTS ravenos_customer_monitor_rules (
  rule_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.monitor_rule.v1',
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  watch_id TEXT NOT NULL REFERENCES ravenos_customer_watch_items(watch_id) ON DELETE CASCADE,
  instrument_id TEXT NOT NULL,
  chain_id TEXT,
  venue_id TEXT NOT NULL,
  exact_market_identity TEXT NOT NULL,
  event_types_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'paused')),
  cadence_class TEXT NOT NULL DEFAULT 'standard' CHECK (cadence_class = 'standard'),
  cooldown_seconds INTEGER NOT NULL DEFAULT 900 CHECK (cooldown_seconds BETWEEN 300 AND 86400),
  last_source_timestamp INTEGER,
  last_evidence_json TEXT,
  next_eligible_evaluation_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (rule_id GLOB 'mon_*' AND length(rule_id) BETWEEN 20 AND 100),
  CHECK (instrument_id = exact_market_identity),
  CHECK (last_source_timestamp IS NULL OR last_source_timestamp >= 0),
  CHECK (next_eligible_evaluation_at >= 0),
  CHECK (created_at >= 0 AND updated_at >= created_at),
  UNIQUE (user_id, watch_id),
  UNIQUE (user_id, instrument_id)
);

CREATE INDEX IF NOT EXISTS ravenos_customer_monitor_rules_due_idx
  ON ravenos_customer_monitor_rules(state, next_eligible_evaluation_at, rule_id);
CREATE INDEX IF NOT EXISTS ravenos_customer_monitor_rules_owner_idx
  ON ravenos_customer_monitor_rules(user_id, updated_at DESC, rule_id);

CREATE TRIGGER IF NOT EXISTS ravenos_customer_monitor_rules_quota
BEFORE INSERT ON ravenos_customer_monitor_rules
WHEN
  (SELECT COUNT(*) FROM ravenos_customer_monitor_rules WHERE user_id = NEW.user_id) >= 100
  AND NOT EXISTS (
    SELECT 1 FROM ravenos_customer_monitor_rules
    WHERE user_id = NEW.user_id AND watch_id = NEW.watch_id
  )
BEGIN
  SELECT RAISE(ABORT, 'monitor_rule_quota_exceeded');
END;

-- Append-only qualified transition evidence. The only mutable field is read_at;
-- the trigger below rejects attempts to rewrite the historical event contract.
CREATE TABLE IF NOT EXISTS ravenos_customer_notification_events (
  notification_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'ravenos.notification_event.v1',
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL REFERENCES ravenos_customer_monitor_rules(rule_id) ON DELETE CASCADE,
  instrument_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  before_state_json TEXT NOT NULL,
  after_state_json TEXT NOT NULL,
  qualified_source_timestamp INTEGER NOT NULL,
  detected_at INTEGER NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  explanation TEXT NOT NULL,
  evidence_role TEXT NOT NULL DEFAULT 'raven_measurement',
  limitations_json TEXT NOT NULL,
  deep_link_context_json TEXT NOT NULL,
  read_at INTEGER,
  retention_expires_at INTEGER NOT NULL,
  CHECK (notification_id GLOB 'ntf_*' AND length(notification_id) BETWEEN 20 AND 100),
  CHECK (qualified_source_timestamp >= 0 AND detected_at >= qualified_source_timestamp),
  CHECK (read_at IS NULL OR read_at >= detected_at),
  CHECK (retention_expires_at > detected_at)
);

CREATE INDEX IF NOT EXISTS ravenos_customer_notifications_owner_idx
  ON ravenos_customer_notification_events(user_id, detected_at DESC, notification_id);
CREATE INDEX IF NOT EXISTS ravenos_customer_notifications_rule_source_idx
  ON ravenos_customer_notification_events(rule_id, qualified_source_timestamp DESC, event_type);

CREATE TRIGGER IF NOT EXISTS ravenos_customer_notification_quota
BEFORE INSERT ON ravenos_customer_notification_events
WHEN (SELECT COUNT(*) FROM ravenos_customer_notification_events WHERE user_id = NEW.user_id) >= 1000
BEGIN
  SELECT RAISE(ABORT, 'notification_quota_exceeded');
END;

CREATE TRIGGER IF NOT EXISTS ravenos_customer_notification_append_only
BEFORE UPDATE ON ravenos_customer_notification_events
WHEN
  OLD.notification_id IS NOT NEW.notification_id OR
  OLD.schema_version IS NOT NEW.schema_version OR
  OLD.user_id IS NOT NEW.user_id OR
  OLD.rule_id IS NOT NEW.rule_id OR
  OLD.instrument_id IS NOT NEW.instrument_id OR
  OLD.event_type IS NOT NEW.event_type OR
  OLD.before_state_json IS NOT NEW.before_state_json OR
  OLD.after_state_json IS NOT NEW.after_state_json OR
  OLD.qualified_source_timestamp IS NOT NEW.qualified_source_timestamp OR
  OLD.detected_at IS NOT NEW.detected_at OR
  OLD.dedupe_key IS NOT NEW.dedupe_key OR
  OLD.explanation IS NOT NEW.explanation OR
  OLD.evidence_role IS NOT NEW.evidence_role OR
  OLD.limitations_json IS NOT NEW.limitations_json OR
  OLD.deep_link_context_json IS NOT NEW.deep_link_context_json OR
  OLD.retention_expires_at IS NOT NEW.retention_expires_at
BEGIN
  SELECT RAISE(ABORT, 'notification_event_append_only');
END;

CREATE TRIGGER IF NOT EXISTS ravenos_customer_notification_read_once
BEFORE UPDATE ON ravenos_customer_notification_events
WHEN
  OLD.read_at IS NOT NEW.read_at
  AND NOT (OLD.read_at IS NULL AND NEW.read_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'notification_read_state_immutable');
END;

-- A single audit-safe cursor/lease prevents overlapping scheduled runs. No
-- customer identity, market state, or provider material is stored here.
CREATE TABLE IF NOT EXISTS ravenos_monitor_evaluator_leases (
  lease_key TEXT PRIMARY KEY CHECK (lease_key = 'raven_monitor_v1'),
  lease_token TEXT,
  lease_expires_at INTEGER,
  cursor_rule_id TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at INTEGER NOT NULL
);
