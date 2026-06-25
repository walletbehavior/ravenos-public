CREATE TABLE IF NOT EXISTS terminal_review_packets (
  evidence_id TEXT PRIMARY KEY,
  evidence_hash TEXT NOT NULL,
  build_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  state TEXT NOT NULL,
  quote_expiry TEXT,
  supersedes_evidence_id TEXT,
  created_at_unix INTEGER NOT NULL,
  redacted_payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_terminal_review_packets_state
  ON terminal_review_packets (state);

CREATE INDEX IF NOT EXISTS idx_terminal_review_packets_created_at
  ON terminal_review_packets (created_at_unix DESC);
