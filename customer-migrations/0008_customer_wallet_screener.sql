PRAGMA foreign_keys = ON;

-- The append-only wallet profile ledger remains the historical source of
-- truth. This bounded current projection exists only to make authenticated
-- Raven Pro screening deterministic and economical; it can always be rebuilt
-- from the latest retained profile snapshot.
CREATE TABLE ravenos_source_wallet_current_profiles (
  source_wallet_id TEXT PRIMARY KEY
    REFERENCES ravenos_source_wallets(source_wallet_id) ON DELETE CASCADE,
  profile_snapshot_id TEXT NOT NULL UNIQUE
    REFERENCES ravenos_source_wallet_profiles(profile_snapshot_id) ON DELETE CASCADE,
  profile_version INTEGER NOT NULL CHECK (profile_version >= 1),
  generated_at INTEGER NOT NULL CHECK (generated_at >= 0),
  first_trade_at INTEGER,
  last_trade_at INTEGER,
  trade_count INTEGER NOT NULL CHECK (trade_count >= 0),
  active_days INTEGER NOT NULL CHECK (active_days >= 0),
  token_count INTEGER NOT NULL CHECK (token_count >= 0),
  known_cost_basis_pct REAL,
  performance_state TEXT NOT NULL CHECK (performance_state IN (
    'available', 'partial', 'insufficient_evidence'
  )),
  realized_pnl_usdc REAL,
  realized_pnl_sol REAL,
  roi_pct REAL,
  win_rate_pct REAL,
  closed_lots INTEGER NOT NULL CHECK (closed_lots >= 0),
  median_hold_seconds INTEGER,
  profile_hash TEXT NOT NULL CHECK (length(profile_hash) = 40),
  updated_at INTEGER NOT NULL CHECK (updated_at >= generated_at),
  CHECK (first_trade_at IS NULL OR first_trade_at >= 0),
  CHECK (last_trade_at IS NULL OR last_trade_at >= 0),
  CHECK (last_trade_at IS NULL OR first_trade_at IS NULL OR last_trade_at >= first_trade_at),
  CHECK (known_cost_basis_pct IS NULL OR known_cost_basis_pct BETWEEN 0 AND 100),
  CHECK (win_rate_pct IS NULL OR win_rate_pct BETWEEN 0 AND 100),
  CHECK (median_hold_seconds IS NULL OR median_hold_seconds >= 0)
);

CREATE INDEX ravenos_source_wallet_current_recency_idx
  ON ravenos_source_wallet_current_profiles(last_trade_at DESC, source_wallet_id);
CREATE INDEX ravenos_source_wallet_current_activity_idx
  ON ravenos_source_wallet_current_profiles(trade_count DESC, active_days DESC, source_wallet_id);
CREATE INDEX ravenos_source_wallet_current_evidence_idx
  ON ravenos_source_wallet_current_profiles(performance_state, known_cost_basis_pct DESC, closed_lots DESC, source_wallet_id);
CREATE INDEX ravenos_source_wallet_current_performance_idx
  ON ravenos_source_wallet_current_profiles(win_rate_pct DESC, roi_pct DESC, source_wallet_id);

-- Seed the mutable projection from the latest append-only snapshot per source.
-- Profiles created before v3 legitimately have no token_count field.
INSERT INTO ravenos_source_wallet_current_profiles (
  source_wallet_id, profile_snapshot_id, profile_version, generated_at,
  first_trade_at, last_trade_at, trade_count, active_days, token_count,
  known_cost_basis_pct, performance_state, realized_pnl_usdc,
  realized_pnl_sol, roi_pct, win_rate_pct, closed_lots,
  median_hold_seconds, profile_hash, updated_at
)
SELECT
  p.source_wallet_id,
  p.profile_snapshot_id,
  p.profile_version,
  p.generated_at,
  COALESCE(
    CAST(strftime('%s', json_extract(p.profile_json, '$.behavior.first_trade_at')) AS INTEGER),
    p.history_start_at
  ),
  COALESCE(
    CAST(strftime('%s', json_extract(p.profile_json, '$.behavior.last_trade_at')) AS INTEGER),
    p.history_end_at
  ),
  COALESCE(CAST(json_extract(p.profile_json, '$.behavior.trade_count') AS INTEGER), 0),
  COALESCE(CAST(json_extract(p.profile_json, '$.behavior.active_days') AS INTEGER), 0),
  COALESCE(CAST(json_extract(p.profile_json, '$.behavior.tokens_traded') AS INTEGER), 0),
  CAST(json_extract(p.profile_json, '$.coverage.known_cost_basis_pct') AS REAL),
  CASE json_extract(p.profile_json, '$.source_performance.state')
    WHEN 'available' THEN 'available'
    WHEN 'partial' THEN 'partial'
    ELSE 'insufficient_evidence'
  END,
  CAST(json_extract(p.profile_json, '$.source_performance.realized_pnl_usdc') AS REAL),
  CAST(json_extract(p.profile_json, '$.source_performance.realized_pnl_sol') AS REAL),
  CAST(json_extract(p.profile_json, '$.source_performance.roi_pct') AS REAL),
  CAST(json_extract(p.profile_json, '$.source_performance.win_rate_pct') AS REAL),
  COALESCE(CAST(json_extract(p.profile_json, '$.source_performance.closed_lots') AS INTEGER), 0),
  CAST(json_extract(p.profile_json, '$.behavior.median_hold_seconds') AS INTEGER),
  substr(p.profile_snapshot_id, 5, 40),
  p.generated_at
FROM ravenos_source_wallet_profiles p
WHERE NOT EXISTS (
  SELECT 1 FROM ravenos_source_wallet_profiles newer
  WHERE newer.source_wallet_id = p.source_wallet_id
    AND (
      newer.generated_at > p.generated_at
      OR (newer.generated_at = p.generated_at AND newer.profile_snapshot_id > p.profile_snapshot_id)
    )
);
