PRAGMA foreign_keys = ON;

-- A pending account-creation acceptance is bound to the one-time OAuth state.
-- It contains document type/version/hash and acknowledgement only: no IP,
-- email, provider token, wallet, transaction, or signing material.
ALTER TABLE ravenos_auth_states
  ADD COLUMN legal_acceptance_json TEXT
  CHECK (
    legal_acceptance_json IS NULL
    OR (json_valid(legal_acceptance_json) AND length(legal_acceptance_json) <= 4096)
  );

CREATE TABLE ravenos_legal_documents (
  document_type TEXT NOT NULL CHECK (document_type GLOB '[a-z]*' AND length(document_type) BETWEEN 3 AND 48),
  document_version TEXT NOT NULL CHECK (length(document_version) BETWEEN 12 AND 96),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 3 AND 120),
  canonical_path TEXT NOT NULL CHECK (canonical_path GLOB '/*' AND length(canonical_path) BETWEEN 3 AND 180),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  status TEXT NOT NULL CHECK (status IN ('review_candidate', 'effective', 'retired')),
  update_classification TEXT NOT NULL CHECK (update_classification IN ('informational_update', 'material_update', 'requires_reacceptance')),
  requires_reacceptance INTEGER NOT NULL CHECK (requires_reacceptance IN (0, 1)),
  accepted_predecessor_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(accepted_predecessor_json) AND json_type(accepted_predecessor_json) = 'array' AND length(accepted_predecessor_json) <= 2048),
  effective_at INTEGER,
  published_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (document_type, document_version),
  UNIQUE (document_type, content_hash),
  UNIQUE (document_type, document_version, content_hash),
  CHECK (effective_at IS NULL OR effective_at >= published_at)
);

CREATE INDEX ravenos_legal_documents_status_idx
  ON ravenos_legal_documents(status, document_type, published_at DESC);

-- Candidate records are intentionally not effective. A counsel-reviewed
-- successor migration must activate the exact reviewed hashes before the two
-- production legal flags may be enabled.
INSERT INTO ravenos_legal_documents (
  document_type, document_version, title, canonical_path, content_hash, status,
  update_classification, requires_reacceptance, accepted_predecessor_json, effective_at, published_at, created_at
) VALUES
  ('terms', '2026-09-05.counsel-review-1', 'Terms of Service', '/legal/review/terms/', 'e61bf357dd7f7b9cb05a598a6552689e44409edf7d3e2f6a3d83e049feaea37a', 'review_candidate', 'material_update', 1, '[]', NULL, 1788566400, 1788566400),
  ('privacy', '2026-09-05.counsel-review-1', 'Privacy Policy', '/legal/review/privacy/', '3a567e113a76c908f64f59af14c00b587eaa6c190895f47b0e65e8cd3fd542f4', 'review_candidate', 'material_update', 1, '[]', NULL, 1788566400, 1788566400),
  ('trading_risk', '2026-09-05.counsel-review-1', 'Digital Asset & Trading Risk Disclosure', '/legal/review/trading-risk/', '3911e00be05a6fe2f1679acb480bea1b11ee54730b491d68e280d3c0ebf449fd', 'review_candidate', 'material_update', 1, '[]', NULL, 1788566400, 1788566400),
  ('copy_trading', '2026-09-05.counsel-review-1', 'Copy Trading & Automated Execution Disclosure', '/legal/review/copy-trading/', '86e8a65c2bccbd51fcb1442ff0c284dbd75e6fc026729e75c33538a654614da1', 'review_candidate', 'material_update', 1, '[]', NULL, 1788566400, 1788566400),
  ('affiliate_terms', '2026-09-05.counsel-review-1', 'Affiliate & Referral Program Terms', '/legal/review/affiliate/', '91d2e216bd635b59fb3a4b8a46380b3daa19a48cd9ba656a64a6940ede4c1eb6', 'review_candidate', 'material_update', 1, '[]', NULL, 1788566400, 1788566400),
  ('community_guidelines', '2026-09-05.counsel-review-1', 'Community Guidelines', '/legal/review/community-guidelines/', '2af49f7dfeb12209a59c7da8afaa03967c843559ef2955b9b02fa8af5a9e325e', 'review_candidate', 'material_update', 1, '[]', NULL, 1788566400, 1788566400);

CREATE TABLE ravenos_legal_acceptances (
  acceptance_id TEXT PRIMARY KEY CHECK (acceptance_id GLOB 'lac_*' AND length(acceptance_id) BETWEEN 20 AND 100),
  schema_version TEXT NOT NULL DEFAULT 'ravenos.legal_acceptance.v1',
  user_id TEXT NOT NULL REFERENCES ravenos_users(user_id) ON DELETE RESTRICT,
  document_type TEXT NOT NULL,
  document_version TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  acknowledgement TEXT NOT NULL CHECK (acknowledgement IN ('agreed', 'acknowledged')),
  accepted_at INTEGER NOT NULL CHECK (accepted_at >= 0),
  acceptance_method TEXT NOT NULL CHECK (acceptance_method IN (
    'account_creation', 'trading_activation', 'copy_activation',
    'embedded_wallet_activation', 'community_publication',
    'affiliate_enrollment'
  )),
  revoked_at INTEGER,
  FOREIGN KEY (document_type, document_version, content_hash)
    REFERENCES ravenos_legal_documents(document_type, document_version, content_hash) ON DELETE RESTRICT,
  UNIQUE (user_id, document_type, document_version, content_hash),
  CHECK (revoked_at IS NULL OR revoked_at >= accepted_at)
);

CREATE INDEX ravenos_legal_acceptances_user_idx
  ON ravenos_legal_acceptances(user_id, document_type, accepted_at DESC);

CREATE TRIGGER ravenos_legal_documents_immutable_update
BEFORE UPDATE ON ravenos_legal_documents
BEGIN
  SELECT RAISE(ABORT, 'legal_document_immutable');
END;

CREATE TRIGGER ravenos_legal_documents_immutable_delete
BEFORE DELETE ON ravenos_legal_documents
BEGIN
  SELECT RAISE(ABORT, 'legal_document_immutable');
END;

CREATE TRIGGER ravenos_legal_acceptances_append_only_update
BEFORE UPDATE ON ravenos_legal_acceptances
BEGIN
  SELECT RAISE(ABORT, 'legal_acceptance_append_only');
END;

CREATE TRIGGER ravenos_legal_acceptances_append_only_delete
BEFORE DELETE ON ravenos_legal_acceptances
BEGIN
  SELECT RAISE(ABORT, 'legal_acceptance_append_only');
END;
