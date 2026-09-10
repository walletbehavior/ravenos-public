-- Named exit-rule templates and ticket shortcuts; these rows cannot authorize orders.
CREATE TABLE ravenos_customer_trading_settings (
  user_id TEXT PRIMARY KEY REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  settings_json TEXT NOT NULL CHECK (json_valid(settings_json) AND length(settings_json) <= 32768),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
);
