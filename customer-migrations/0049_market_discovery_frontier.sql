-- A compact, replaceable public cache. Each chain retains independent token
-- identities and provider cursors even when its next quote refresh fails.
-- Collection shares the existing participation lease; no execution authority.
CREATE TABLE IF NOT EXISTS ravenos_market_discovery_frontier (
  chain TEXT PRIMARY KEY CHECK (chain IN ('solana','robinhood','bsc','base','ethereum')),
  body_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
