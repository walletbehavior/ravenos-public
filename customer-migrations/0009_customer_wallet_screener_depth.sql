PRAGMA foreign_keys = ON;

-- Deep wallet research remains a rebuildable projection over the append-only
-- normalized event and profile ledgers. Values that cannot be compared across
-- USDC and SOL settlement bases stay separate or NULL.
ALTER TABLE ravenos_source_wallet_current_profiles ADD COLUMN profit_factor REAL;
ALTER TABLE ravenos_source_wallet_current_profiles ADD COLUMN average_trade_roi_pct REAL;
ALTER TABLE ravenos_source_wallet_current_profiles ADD COLUMN median_trade_roi_pct REAL;
ALTER TABLE ravenos_source_wallet_current_profiles ADD COLUMN top_1_profit_concentration_pct REAL;
ALTER TABLE ravenos_source_wallet_current_profiles ADD COLUMN top_5_profit_concentration_pct REAL;
ALTER TABLE ravenos_source_wallet_current_profiles ADD COLUMN profitable_observations INTEGER;
ALTER TABLE ravenos_source_wallet_current_profiles ADD COLUMN weekly_profitable_pct REAL;
ALTER TABLE ravenos_source_wallet_current_profiles ADD COLUMN maximum_drawdown_usdc REAL;
ALTER TABLE ravenos_source_wallet_current_profiles ADD COLUMN maximum_drawdown_sol REAL;
ALTER TABLE ravenos_source_wallet_current_profiles ADD COLUMN trade_rate_per_active_day REAL;
ALTER TABLE ravenos_source_wallet_current_profiles ADD COLUMN repeat_token_rate_pct REAL;
ALTER TABLE ravenos_source_wallet_current_profiles ADD COLUMN mechanical_pattern_state TEXT;
ALTER TABLE ravenos_source_wallet_current_profiles ADD COLUMN buy_count INTEGER;
ALTER TABLE ravenos_source_wallet_current_profiles ADD COLUMN sell_count INTEGER;
ALTER TABLE ravenos_source_wallet_current_profiles ADD COLUMN average_buy_usdc REAL;
ALTER TABLE ravenos_source_wallet_current_profiles ADD COLUMN median_buy_usdc REAL;
ALTER TABLE ravenos_source_wallet_current_profiles ADD COLUMN average_buy_sol REAL;
ALTER TABLE ravenos_source_wallet_current_profiles ADD COLUMN median_buy_sol REAL;
ALTER TABLE ravenos_source_wallet_current_profiles ADD COLUMN open_known_cost_positions INTEGER;
ALTER TABLE ravenos_source_wallet_current_profiles ADD COLUMN reconstruction_confidence_pct REAL;
ALTER TABLE ravenos_source_wallet_current_profiles ADD COLUMN trade_decode_coverage_pct REAL;
ALTER TABLE ravenos_source_wallet_current_profiles ADD COLUMN classification_coverage_pct REAL;
ALTER TABLE ravenos_source_wallet_current_profiles ADD COLUMN provider_history_exhausted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ravenos_source_wallet_current_profiles ADD COLUMN source_history_complete INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ravenos_source_wallet_current_profiles ADD COLUMN last_observed_sol_balance REAL;
ALTER TABLE ravenos_source_wallet_current_profiles ADD COLUMN last_observed_sol_at INTEGER;
ALTER TABLE ravenos_source_wallet_current_profiles ADD COLUMN last_observed_usdc_balance REAL;
ALTER TABLE ravenos_source_wallet_current_profiles ADD COLUMN last_observed_usdc_at INTEGER;

-- Research saves are private continuity state. They do not start source
-- monitoring, create a copy policy, or authorize execution.
CREATE TABLE ravenos_customer_wallet_research_saves (
  save_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  source_wallet_id TEXT NOT NULL REFERENCES ravenos_source_wallets(source_wallet_id) ON DELETE CASCADE,
  list_name TEXT NOT NULL COLLATE NOCASE CHECK (length(list_name) BETWEEN 1 AND 48),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  UNIQUE (user_id, source_wallet_id, list_name),
  CHECK (save_id GLOB 'wrs_*' AND length(save_id) BETWEEN 20 AND 100)
);

CREATE INDEX ravenos_customer_wallet_research_saves_owner_idx
  ON ravenos_customer_wallet_research_saves(user_id, list_name, updated_at DESC, save_id);

CREATE INDEX ravenos_source_wallet_current_quality_v2_idx
  ON ravenos_source_wallet_current_profiles(
    reconstruction_confidence_pct DESC,
    known_cost_basis_pct DESC,
    closed_lots DESC,
    source_wallet_id
  );
CREATE INDEX ravenos_source_wallet_current_profit_quality_v2_idx
  ON ravenos_source_wallet_current_profiles(
    profit_factor DESC,
    top_1_profit_concentration_pct ASC,
    closed_lots DESC,
    source_wallet_id
  );
CREATE INDEX ravenos_source_wallet_current_behavior_v2_idx
  ON ravenos_source_wallet_current_profiles(
    trade_rate_per_active_day DESC,
    median_hold_seconds ASC,
    source_wallet_id
  );

-- Existing v3 snapshots legitimately leave the new fields NULL. Rebuild only
-- what their retained JSON already proves; no historical facts are inferred.
UPDATE ravenos_source_wallet_current_profiles AS c
SET
  profit_factor = CAST(json_extract(p.profile_json, '$.source_performance.profit_factor') AS REAL),
  trade_rate_per_active_day = CAST(json_extract(p.profile_json, '$.behavior.trade_rate_per_active_day') AS REAL),
  buy_count = CAST(json_extract(p.profile_json, '$.behavior.buy_count') AS INTEGER),
  sell_count = CAST(json_extract(p.profile_json, '$.behavior.sell_count') AS INTEGER),
  average_buy_usdc = CAST(json_extract(p.profile_json, '$.behavior.buy_notional_by_basis.usdc.average') AS REAL),
  median_buy_usdc = CAST(json_extract(p.profile_json, '$.behavior.buy_notional_by_basis.usdc.median') AS REAL),
  average_buy_sol = CAST(json_extract(p.profile_json, '$.behavior.buy_notional_by_basis.sol.average') AS REAL),
  median_buy_sol = CAST(json_extract(p.profile_json, '$.behavior.buy_notional_by_basis.sol.median') AS REAL)
FROM ravenos_source_wallet_profiles AS p
WHERE p.profile_snapshot_id = c.profile_snapshot_id;
