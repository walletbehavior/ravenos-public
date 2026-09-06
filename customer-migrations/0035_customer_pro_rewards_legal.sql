PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;
DROP TRIGGER ravenos_legal_acceptances_append_only_update;
DROP TRIGGER ravenos_legal_acceptances_append_only_delete;
DROP INDEX ravenos_legal_acceptances_user_idx;
ALTER TABLE ravenos_legal_acceptances RENAME TO ravenos_legal_acceptances_v1;
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
    'affiliate_enrollment', 'pro_subscription'
  )),
  revoked_at INTEGER,
  FOREIGN KEY (document_type, document_version, content_hash)
    REFERENCES ravenos_legal_documents(document_type, document_version, content_hash) ON DELETE RESTRICT,
  UNIQUE (user_id, document_type, document_version, content_hash),
  CHECK (revoked_at IS NULL OR revoked_at >= accepted_at)
);

INSERT INTO ravenos_legal_acceptances SELECT * FROM ravenos_legal_acceptances_v1;
DROP TABLE ravenos_legal_acceptances_v1;
CREATE INDEX ravenos_legal_acceptances_user_idx ON ravenos_legal_acceptances(user_id,document_type,accepted_at DESC);
CREATE TRIGGER ravenos_legal_acceptances_append_only_update BEFORE UPDATE ON ravenos_legal_acceptances BEGIN SELECT RAISE(ABORT,'legal_acceptance_append_only'); END;
CREATE TRIGGER ravenos_legal_acceptances_append_only_delete BEFORE DELETE ON ravenos_legal_acceptances BEGIN SELECT RAISE(ABORT,'legal_acceptance_append_only'); END;

INSERT INTO ravenos_legal_documents (document_type,document_version,title,canonical_path,content_hash,status,update_classification,requires_reacceptance,accepted_predecessor_json,effective_at,published_at,created_at) VALUES
('terms','2026-09-06.counsel-review-2','Terms of Service','/legal/review/terms/','3734389d532a81c52dd3588d2c14499dd8fd21b2fa7a8e81167038643427ca73','review_candidate','material_update',1,'[]',NULL,1788652800,1788652800),
('privacy','2026-09-06.counsel-review-2','Privacy Policy','/legal/review/privacy/','51aa18e78328d78d0d3b5c3afd8a9162d2a619a87236933ad26d2f4aa7488d0c','review_candidate','material_update',1,'[]',NULL,1788652800,1788652800),
('trading_risk','2026-09-06.counsel-review-2','Digital Asset & Trading Risk Disclosure','/legal/review/trading-risk/','c0cd4f989b5b957f9529b72cb8167851a8537104fde696489d3dd37007431c2a','review_candidate','material_update',1,'[]',NULL,1788652800,1788652800),
('copy_trading','2026-09-06.counsel-review-2','Copy Trading & Automated Execution Disclosure','/legal/review/copy-trading/','57ba77dd8f251ab990238d63e21e981b38b857684bf807bfd904d4d1bdf56814','review_candidate','material_update',1,'[]',NULL,1788652800,1788652800),
('affiliate_terms','2026-09-06.counsel-review-2','Affiliate & Referral Program Terms','/legal/review/affiliate/','74160c6c11087d14e7215108302ef25d01b167ca9219841a118ba1546952936f','review_candidate','material_update',1,'[]',NULL,1788652800,1788652800);
