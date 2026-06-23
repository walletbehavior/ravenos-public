CREATE TABLE IF NOT EXISTS watchlists (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_watchlists_user
  ON watchlists (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlists_user_name
  ON watchlists (user_id, name);

CREATE TABLE IF NOT EXISTS watchlist_items (
  id TEXT PRIMARY KEY,
  watchlist_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  instrument TEXT NOT NULL,
  market TEXT NOT NULL,
  price REAL,
  flow_score REAL,
  pressure_score REAL,
  replay_similarity REAL,
  risk TEXT,
  coverage TEXT,
  provider TEXT,
  source_payload TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_watchlist_items_user
  ON watchlist_items (user_id);

CREATE INDEX IF NOT EXISTS idx_watchlist_items_watchlist
  ON watchlist_items (watchlist_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlist_items_unique
  ON watchlist_items (watchlist_id, instrument, market);
