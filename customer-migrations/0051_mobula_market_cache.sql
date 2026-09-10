-- Public, replaceable market activity only. No customer sessions or keys.
CREATE TABLE IF NOT EXISTS ravenos_mobula_market_requests (
  request_id TEXT PRIMARY KEY,
  market_key TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved','ok','failed')),
  error_code TEXT
);
CREATE INDEX IF NOT EXISTS ravenos_mobula_requests_time ON ravenos_mobula_market_requests(requested_at);
CREATE INDEX IF NOT EXISTS ravenos_mobula_requests_market ON ravenos_mobula_market_requests(market_key, requested_at);
CREATE TABLE IF NOT EXISTS ravenos_mobula_market_cache (
  market_key TEXT PRIMARY KEY,
  body_json TEXT NOT NULL,
  observed_at INTEGER NOT NULL
);
