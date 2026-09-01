PRAGMA foreign_keys = ON;

-- Current, rebuildable wallet-level projection of market context Raven saw
-- shortly after a prospective source trade. These values do not claim the
-- source wallet's exact pool, exact fill context, or the token's true age.
ALTER TABLE ravenos_source_wallet_copyability_current
  ADD COLUMN detection_context_sample_count INTEGER CHECK (
    detection_context_sample_count IS NULL OR detection_context_sample_count >= 0
  );
ALTER TABLE ravenos_source_wallet_copyability_current
  ADD COLUMN detection_context_coverage_pct REAL CHECK (
    detection_context_coverage_pct IS NULL OR detection_context_coverage_pct BETWEEN 0 AND 100
  );
ALTER TABLE ravenos_source_wallet_copyability_current
  ADD COLUMN detected_market_cap_coverage_pct REAL CHECK (
    detected_market_cap_coverage_pct IS NULL OR detected_market_cap_coverage_pct BETWEEN 0 AND 100
  );
ALTER TABLE ravenos_source_wallet_copyability_current
  ADD COLUMN detected_liquidity_coverage_pct REAL CHECK (
    detected_liquidity_coverage_pct IS NULL OR detected_liquidity_coverage_pct BETWEEN 0 AND 100
  );
ALTER TABLE ravenos_source_wallet_copyability_current
  ADD COLUMN detected_pair_age_coverage_pct REAL CHECK (
    detected_pair_age_coverage_pct IS NULL OR detected_pair_age_coverage_pct BETWEEN 0 AND 100
  );
ALTER TABLE ravenos_source_wallet_copyability_current
  ADD COLUMN median_detected_market_cap_usd REAL CHECK (
    median_detected_market_cap_usd IS NULL OR median_detected_market_cap_usd >= 0
  );
ALTER TABLE ravenos_source_wallet_copyability_current
  ADD COLUMN median_detected_liquidity_usd REAL CHECK (
    median_detected_liquidity_usd IS NULL OR median_detected_liquidity_usd >= 0
  );
ALTER TABLE ravenos_source_wallet_copyability_current
  ADD COLUMN median_detected_pair_age_seconds REAL CHECK (
    median_detected_pair_age_seconds IS NULL OR median_detected_pair_age_seconds >= 0
  );
ALTER TABLE ravenos_source_wallet_copyability_current
  ADD COLUMN median_source_trade_liquidity_pct REAL CHECK (
    median_source_trade_liquidity_pct IS NULL OR median_source_trade_liquidity_pct >= 0
  );
ALTER TABLE ravenos_source_wallet_copyability_current
  ADD COLUMN median_market_context_delay_ms REAL CHECK (
    median_market_context_delay_ms IS NULL OR median_market_context_delay_ms >= 0
  );

CREATE INDEX ravenos_source_wallet_copyability_detected_liquidity_idx
  ON ravenos_source_wallet_copyability_current(
    hypothetical_raven_fee_bps, matrix_policy_hash,
    median_detected_liquidity_usd DESC, detection_context_sample_count DESC,
    source_wallet_id
  );

CREATE INDEX ravenos_source_wallet_copyability_detected_market_cap_idx
  ON ravenos_source_wallet_copyability_current(
    hypothetical_raven_fee_bps, matrix_policy_hash,
    median_detected_market_cap_usd ASC, detection_context_sample_count DESC,
    source_wallet_id
  );

CREATE INDEX ravenos_source_wallet_copyability_detected_pair_age_idx
  ON ravenos_source_wallet_copyability_current(
    hypothetical_raven_fee_bps, matrix_policy_hash,
    median_detected_pair_age_seconds ASC, detection_context_sample_count DESC,
    source_wallet_id
  );
