CREATE TABLE IF NOT EXISTS outcome_observations (
  id TEXT PRIMARY KEY,
  instrument TEXT NOT NULL,
  market TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  structure_type TEXT NOT NULL,
  pressure_state TEXT,
  replay_similarity REAL,
  participation_state TEXT,
  liquidity_state TEXT,
  attention_state TEXT,
  rotation_state TEXT,
  confidence_score REAL NOT NULL,
  confidence_label TEXT NOT NULL,
  coverage_label TEXT NOT NULL,
  coverage_provider TEXT,
  coverage_payload TEXT,
  confidence_payload TEXT,
  forward_outcome REAL,
  outcome_window TEXT NOT NULL,
  outcome_classification TEXT NOT NULL DEFAULT 'unresolved',
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_outcome_observations_instrument
  ON outcome_observations (instrument);

CREATE INDEX IF NOT EXISTS idx_outcome_observations_market
  ON outcome_observations (market);

CREATE INDEX IF NOT EXISTS idx_outcome_observations_structure
  ON outcome_observations (structure_type);

CREATE INDEX IF NOT EXISTS idx_outcome_observations_outcome
  ON outcome_observations (outcome_classification);
