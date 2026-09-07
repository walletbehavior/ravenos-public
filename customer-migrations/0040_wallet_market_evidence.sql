-- Bounded market-tape samples, separate from reconstructed wallet history.
-- One current sample per wallet/pool. Replayed samples are not accumulated.
CREATE TABLE ravenos_source_wallet_market_evidence (
  source_wallet_id TEXT NOT NULL REFERENCES ravenos_source_wallets(source_wallet_id) ON DELETE CASCADE,
  market_id TEXT NOT NULL,
  chain TEXT NOT NULL CHECK (chain IN ('solana','robinhood','base','ethereum','bsc')),
  sampled_at INTEGER NOT NULL,
  first_event_at INTEGER NOT NULL,
  last_event_at INTEGER NOT NULL,
  unique_transactions INTEGER NOT NULL CHECK (unique_transactions BETWEEN 1 AND 120),
  buy_transactions INTEGER NOT NULL CHECK (buy_transactions BETWEEN 0 AND 120),
  sell_transactions INTEGER NOT NULL CHECK (sell_transactions BETWEEN 0 AND 120),
  sample_json TEXT NOT NULL CHECK (json_valid(sample_json) AND length(sample_json) < 5000),
  PRIMARY KEY(source_wallet_id,market_id),
  CHECK(first_event_at <= last_event_at AND last_event_at <= sampled_at + 60),
  CHECK(buy_transactions <= unique_transactions AND sell_transactions <= unique_transactions)
);
CREATE INDEX ravenos_wallet_market_evidence_recent ON ravenos_source_wallet_market_evidence(last_event_at,source_wallet_id);
