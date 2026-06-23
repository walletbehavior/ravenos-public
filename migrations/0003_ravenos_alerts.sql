CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  instrument TEXT NOT NULL,
  market TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  condition TEXT NOT NULL,
  threshold REAL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alerts_user
  ON alerts (user_id);

CREATE INDEX IF NOT EXISTS idx_alerts_enabled
  ON alerts (enabled);

CREATE INDEX IF NOT EXISTS idx_alerts_type
  ON alerts (alert_type);

CREATE TABLE IF NOT EXISTS alert_events (
  id TEXT PRIMARY KEY,
  alert_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  instrument TEXT NOT NULL,
  market TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  event_summary TEXT NOT NULL,
  observed_value REAL,
  threshold REAL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alert_events_user
  ON alert_events (user_id);

CREATE INDEX IF NOT EXISTS idx_alert_events_alert
  ON alert_events (alert_id);
