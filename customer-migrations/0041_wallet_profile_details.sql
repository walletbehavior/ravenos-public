-- Large, bounded wallet analyses outgrow the original 64 KiB inline snapshot.
-- Preserve existing snapshots and all dependent Copy/research foreign keys.
-- The parent retains the fields used by screener SQL; the full immutable
-- analysis is stored here only when it exceeds the inline limit.
CREATE TABLE ravenos_source_wallet_profile_details (
  profile_snapshot_id TEXT PRIMARY KEY
    REFERENCES ravenos_source_wallet_profiles(profile_snapshot_id) ON DELETE CASCADE,
  profile_json TEXT NOT NULL CHECK (
    json_valid(profile_json) AND length(CAST(profile_json AS BLOB)) <= 1048576
  )
);
CREATE TRIGGER ravenos_wallet_profile_details_append_only
BEFORE UPDATE ON ravenos_source_wallet_profile_details
BEGIN SELECT RAISE(ABORT, 'wallet_profile_details_append_only'); END;
