PRAGMA foreign_keys = ON;

-- Privy augments Raven identity; it never replaces ravenos_users or Raven sessions.
CREATE TABLE ravenos_user_privy_identities (
  raven_user_id TEXT PRIMARY KEY REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  privy_user_id TEXT NOT NULL UNIQUE CHECK (privy_user_id GLOB 'did:privy:*' AND length(privy_user_id) BETWEEN 12 AND 180),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'disabled', 'unlinked', 'security_hold')),
  linked_at INTEGER NOT NULL,
  last_verified_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  CHECK (last_verified_at >= linked_at),
  CHECK (updated_at >= linked_at)
);

CREATE TABLE ravenos_privy_wallets (
  wallet_record_id TEXT PRIMARY KEY CHECK (wallet_record_id GLOB 'rpw_*' AND length(wallet_record_id) BETWEEN 20 AND 100),
  raven_user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  privy_user_id TEXT NOT NULL REFERENCES ravenos_user_privy_identities(privy_user_id) ON DELETE CASCADE,
  provider_wallet_id TEXT CHECK (provider_wallet_id IS NULL OR length(provider_wallet_id) BETWEEN 1 AND 180),
  ecosystem TEXT NOT NULL CHECK (ecosystem IN ('evm', 'solana')),
  public_address TEXT NOT NULL CHECK (length(public_address) BETWEEN 32 AND 64),
  wallet_type TEXT NOT NULL DEFAULT 'privy_embedded' CHECK (wallet_type = 'privy_embedded'),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'disabled', 'recovery_required')),
  created_at INTEGER NOT NULL,
  last_verified_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (raven_user_id, ecosystem),
  UNIQUE (ecosystem, public_address),
  UNIQUE (provider_wallet_id),
  CHECK (last_verified_at >= created_at),
  CHECK (updated_at >= created_at),
  CHECK (
    (ecosystem = 'evm' AND length(public_address) = 42 AND substr(public_address, 1, 2) = '0x'
      AND lower(public_address) = public_address AND substr(public_address, 3) NOT GLOB '*[^0-9a-f]*')
    OR
    (ecosystem = 'solana' AND length(public_address) BETWEEN 32 AND 44
      AND public_address NOT GLOB '*[^1-9A-HJ-NP-Za-km-z]*')
  )
);

CREATE INDEX ravenos_privy_wallets_user_idx
  ON ravenos_privy_wallets(raven_user_id, ecosystem, state);

CREATE TABLE ravenos_privy_usage_events (
  event_id TEXT PRIMARY KEY CHECK (event_id GLOB 'pue_*' AND length(event_id) BETWEEN 20 AND 100),
  raven_user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'identity_linked', 'wallet_created', 'wallet_verified', 'manual_signature',
    'delegated_signature', 'signing_failed', 'session_synced', 'wallet_withdrawal'
  )),
  ecosystem TEXT CHECK (ecosystem IS NULL OR ecosystem IN ('evm', 'solana')),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'rejected', 'failed', 'indeterminate')),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 1000),
  amount_usd_micros TEXT CHECK (amount_usd_micros IS NULL OR (length(amount_usd_micros) BETWEEN 1 AND 30 AND amount_usd_micros NOT GLOB '*[^0-9]*')),
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms BETWEEN 0 AND 600000),
  reason_code TEXT CHECK (reason_code IS NULL OR length(reason_code) BETWEEN 1 AND 80),
  observed_at INTEGER NOT NULL
);

CREATE INDEX ravenos_privy_usage_events_user_idx
  ON ravenos_privy_usage_events(raven_user_id, observed_at DESC, event_id);

CREATE TRIGGER ravenos_privy_usage_events_append_only
BEFORE UPDATE ON ravenos_privy_usage_events
BEGIN
  SELECT RAISE(ABORT, 'privy_usage_event_append_only');
END;

CREATE TRIGGER ravenos_privy_usage_events_no_delete
BEFORE DELETE ON ravenos_privy_usage_events
BEGIN
  SELECT RAISE(ABORT, 'privy_usage_event_append_only');
END;
