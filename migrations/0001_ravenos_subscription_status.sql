CREATE TABLE IF NOT EXISTS ravenos_subscription_status (
  id TEXT PRIMARY KEY,
  wallet_public_key TEXT,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT,
  stripe_product_id TEXT,
  stripe_price_id TEXT,
  status TEXT NOT NULL DEFAULT 'unknown',
  current_period_end INTEGER,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ravenos_subscription_customer
  ON ravenos_subscription_status (stripe_customer_id);

CREATE INDEX IF NOT EXISTS idx_ravenos_subscription_wallet
  ON ravenos_subscription_status (wallet_public_key);

CREATE INDEX IF NOT EXISTS idx_ravenos_subscription_status
  ON ravenos_subscription_status (status);
