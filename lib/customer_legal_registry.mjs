export const CUSTOMER_LEGAL_SCHEMA = "ravenos.customer_legal.v1";
export const CUSTOMER_LEGAL_DOCUMENT_SCHEMA = "ravenos.legal_document.v1";
export const CUSTOMER_LEGAL_ACCEPTANCE_SCHEMA = "ravenos.legal_acceptance.v1";

const HEX_SHA256 = /^[0-9a-f]{64}$/;
const DOCUMENT_STATUSES = new Set(["review_candidate", "effective", "retired"]);
const UPDATE_CLASSIFICATIONS = new Set(["informational_update", "material_update", "requires_reacceptance"]);

// These are counsel-review candidates. RAVENOS_LEGAL_ACCEPTANCE_ENABLED and
// RAVENOS_LEGAL_COUNSEL_APPROVED must both be set before they become operative.
// A later reviewed release must update the version, content hash, and status as
// one immutable change. The hashes are verified against the public HTML files
// by tests/legal_documents.test.mjs.
export const CustomerLegalDocuments = Object.freeze([
  Object.freeze({
    document_type: "terms",
    title: "Terms of Service",
    version: "2026-09-05.counsel-review-1",
    canonical_path: "/legal/review/terms/",
    content_hash: "e61bf357dd7f7b9cb05a598a6552689e44409edf7d3e2f6a3d83e049feaea37a",
    status: "review_candidate",
    effective_at: null,
    published_at: "2026-09-05T00:00:00.000Z",
    update_classification: "material_update",
    requires_reacceptance: true,
    accepted_predecessors: Object.freeze([]),
  }),
  Object.freeze({
    document_type: "privacy",
    title: "Privacy Policy",
    version: "2026-09-05.counsel-review-1",
    canonical_path: "/legal/review/privacy/",
    content_hash: "3a567e113a76c908f64f59af14c00b587eaa6c190895f47b0e65e8cd3fd542f4",
    status: "review_candidate",
    effective_at: null,
    published_at: "2026-09-05T00:00:00.000Z",
    update_classification: "material_update",
    requires_reacceptance: true,
    accepted_predecessors: Object.freeze([]),
  }),
  Object.freeze({
    document_type: "trading_risk",
    title: "Digital Asset & Trading Risk Disclosure",
    version: "2026-09-05.counsel-review-1",
    canonical_path: "/legal/review/trading-risk/",
    content_hash: "3911e00be05a6fe2f1679acb480bea1b11ee54730b491d68e280d3c0ebf449fd",
    status: "review_candidate",
    effective_at: null,
    published_at: "2026-09-05T00:00:00.000Z",
    update_classification: "material_update",
    requires_reacceptance: true,
    accepted_predecessors: Object.freeze([]),
  }),
  Object.freeze({
    document_type: "copy_trading",
    title: "Copy Trading & Automated Execution Disclosure",
    version: "2026-09-05.counsel-review-1",
    canonical_path: "/legal/review/copy-trading/",
    content_hash: "86e8a65c2bccbd51fcb1442ff0c284dbd75e6fc026729e75c33538a654614da1",
    status: "review_candidate",
    effective_at: null,
    published_at: "2026-09-05T00:00:00.000Z",
    update_classification: "material_update",
    requires_reacceptance: true,
    accepted_predecessors: Object.freeze([]),
  }),
  Object.freeze({
    document_type: "affiliate_terms",
    title: "Affiliate & Referral Program Terms",
    version: "2026-09-05.counsel-review-1",
    canonical_path: "/legal/review/affiliate/",
    content_hash: "91d2e216bd635b59fb3a4b8a46380b3daa19a48cd9ba656a64a6940ede4c1eb6",
    status: "review_candidate",
    effective_at: null,
    published_at: "2026-09-05T00:00:00.000Z",
    update_classification: "material_update",
    requires_reacceptance: true,
    accepted_predecessors: Object.freeze([]),
  }),
  Object.freeze({
    document_type: "community_guidelines",
    title: "Community Guidelines",
    version: "2026-09-05.counsel-review-1",
    canonical_path: "/legal/review/community-guidelines/",
    content_hash: "2af49f7dfeb12209a59c7da8afaa03967c843559ef2955b9b02fa8af5a9e325e",
    status: "review_candidate",
    effective_at: null,
    published_at: "2026-09-05T00:00:00.000Z",
    update_classification: "material_update",
    requires_reacceptance: true,
    accepted_predecessors: Object.freeze([]),
  }),
]);

export const CustomerLegalCapabilityRequirements = Object.freeze({
  account_creation: Object.freeze(["terms", "privacy"]),
  account_access: Object.freeze([]),
  trading_activation: Object.freeze(["terms", "privacy", "trading_risk"]),
  copy_activation: Object.freeze(["terms", "privacy", "trading_risk", "copy_trading"]),
  embedded_wallet_activation: Object.freeze(["terms", "privacy", "trading_risk"]),
  community_publication: Object.freeze(["terms", "privacy", "community_guidelines"]),
  affiliate_enrollment: Object.freeze(["terms", "privacy", "affiliate_terms"]),
  withdrawal: Object.freeze([]),
  wallet_export: Object.freeze([]),
  wallet_recovery: Object.freeze([]),
});

function flag(value) {
  return String(value || "") === "1";
}

function documentsByType(documents = CustomerLegalDocuments) {
  return new Map(documents.map((document) => [document.document_type, document]));
}

function validPredecessors(document) {
  if (!Array.isArray(document.accepted_predecessors) || document.accepted_predecessors.length > 8) return false;
  if (document.requires_reacceptance === true && document.accepted_predecessors.length) return false;
  const identities = new Set();
  for (const predecessor of document.accepted_predecessors) {
    if (!predecessor || typeof predecessor !== "object" || Array.isArray(predecessor)) return false;
    if (Object.keys(predecessor).some((key) => !new Set(["version", "content_hash"]).has(key))) return false;
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[a-z0-9-]{3,64}$/.test(String(predecessor.version || ""))) return false;
    if (!HEX_SHA256.test(String(predecessor.content_hash || ""))) return false;
    if (predecessor.version === document.version || predecessor.content_hash === document.content_hash) return false;
    const identity = `${predecessor.version}:${predecessor.content_hash}`;
    if (identities.has(identity)) return false;
    identities.add(identity);
  }
  return true;
}

function validDocument(document) {
  return Boolean(document
    && typeof document === "object"
    && /^[a-z][a-z0-9_]{2,47}$/.test(String(document.document_type || ""))
    && typeof document.title === "string"
    && document.title.trim().length >= 3
    && document.title.trim().length <= 120
    && /^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[a-z0-9-]{3,64}$/.test(String(document.version || ""))
    && /^\/(?!\/)(?!.*\/\/)[a-z0-9][a-z0-9/_-]*\/$/.test(String(document.canonical_path || ""))
    && HEX_SHA256.test(String(document.content_hash || ""))
    && DOCUMENT_STATUSES.has(document.status)
    && UPDATE_CLASSIFICATIONS.has(document.update_classification)
    && typeof document.requires_reacceptance === "boolean"
    && Number.isFinite(Date.parse(document.published_at || ""))
    && (document.effective_at == null || Number.isFinite(Date.parse(document.effective_at)))
    && (document.effective_at == null || Date.parse(document.effective_at) >= Date.parse(document.published_at))
    && validPredecessors(document));
}

export function resolveCustomerLegalRuntime(env = {}, { documents = CustomerLegalDocuments } = {}) {
  const registryDocuments = Array.isArray(documents) ? documents : [];
  const requested = flag(env.RAVENOS_LEGAL_ACCEPTANCE_ENABLED);
  const counselApproved = flag(env.RAVENOS_LEGAL_COUNSEL_APPROVED);
  const databaseAvailable = Boolean(env.RAVENOS_CUSTOMER_DB?.prepare && env.RAVENOS_CUSTOMER_DB?.batch);
  const documentsValid = registryDocuments.length > 0 && registryDocuments.every(validDocument);
  const documentTypes = new Set(registryDocuments.map((document) => document.document_type));
  const documentsUnique = documentTypes.size === registryDocuments.length;
  const requiredDocumentTypes = new Set(Object.values(CustomerLegalCapabilityRequirements).flat());
  const documentsComplete = documentsUnique && [...requiredDocumentTypes].every((documentType) => documentTypes.has(documentType));
  const documentsEffective = documentsValid && documentsComplete && registryDocuments.every((document) => (
    document.status === "effective"
    && Number.isFinite(Date.parse(document.effective_at || ""))
    && Date.parse(document.effective_at) <= Date.now()
  ));
  const ready = requested && counselApproved && databaseAvailable && documentsValid && documentsUnique && documentsComplete && documentsEffective;
  const state = !requested
    ? "disabled"
    : !counselApproved
      ? "counsel_review_required"
      : !databaseAvailable
        ? "database_unavailable"
        : !documentsValid
          ? "document_registry_invalid"
          : !documentsUnique
            ? "document_registry_duplicate"
            : !documentsComplete
              ? "document_registry_incomplete"
              : !documentsEffective
                ? "documents_not_effective"
                : "enforced";
  return Object.freeze({
    requested,
    counsel_approved: counselApproved,
    database_available: databaseAvailable,
    documents_valid: documentsValid,
    documents_unique: documentsUnique,
    documents_complete: documentsComplete,
    documents_effective: documentsEffective,
    ready,
    state,
    withdrawals_blocked_by_legal_acceptance: false,
    wallet_export_blocked_by_legal_acceptance: false,
    wallet_recovery_blocked_by_legal_acceptance: false,
  });
}

export function legalDocumentsForCapability(capability, { documents = CustomerLegalDocuments } = {}) {
  const requirement = CustomerLegalCapabilityRequirements[String(capability || "")];
  if (!requirement) throw new Error("legal_capability_invalid");
  const registry = documentsByType(documents);
  return requirement.map((type) => {
    const document = registry.get(type);
    if (!document) throw new Error("legal_document_registry_incomplete");
    return document;
  });
}

export function publicLegalDocument(document) {
  return Object.freeze({
    schema_version: CUSTOMER_LEGAL_DOCUMENT_SCHEMA,
    document_type: document.document_type,
    title: document.title,
    version: document.version,
    canonical_path: document.canonical_path,
    content_hash: document.content_hash,
    status: document.status,
    effective_at: document.effective_at,
    published_at: document.published_at,
    update_classification: document.update_classification,
    requires_reacceptance: document.requires_reacceptance === true,
    prior_acceptance_remains_valid: document.requires_reacceptance === false
      && Array.isArray(document.accepted_predecessors)
      && document.accepted_predecessors.length > 0,
  });
}

export function publicCustomerLegalManifest(env = {}, options = {}) {
  const documents = options.documents || CustomerLegalDocuments;
  const runtime = resolveCustomerLegalRuntime(env, { documents });
  return Object.freeze({
    ok: true,
    schema_version: CUSTOMER_LEGAL_SCHEMA,
    state: runtime.state,
    acceptance_enforced: runtime.ready,
    documents: documents.map((document) => publicLegalDocument(document)),
    requirements: Object.freeze(Object.fromEntries(Object.entries(CustomerLegalCapabilityRequirements))),
    safeguards: Object.freeze({
      unchecked_assent_required: true,
      server_validation_required: true,
      exact_version_and_hash_bound: true,
      reacceptance_supported: true,
      account_access_survives_decline: true,
      withdrawal_survives_decline: true,
      wallet_export_survives_decline: true,
      wallet_recovery_survives_decline: true,
    }),
  });
}

function normalizeSubmission(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("legal_acceptance_invalid");
  const allowed = new Set(["document_type", "version", "content_hash", "acknowledgement"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new Error("legal_acceptance_invalid");
  const documentType = String(input.document_type || "").trim().toLowerCase();
  const version = String(input.version || "").trim();
  const contentHash = String(input.content_hash || "").trim().toLowerCase();
  const acknowledgement = String(input.acknowledgement || "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{2,47}$/.test(documentType)) throw new Error("legal_acceptance_invalid");
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[a-z0-9-]{3,64}$/.test(version)) throw new Error("legal_acceptance_invalid");
  if (!HEX_SHA256.test(contentHash)) throw new Error("legal_acceptance_invalid");
  if (!new Set(["agreed", "acknowledged"]).has(acknowledgement)) throw new Error("legal_acceptance_invalid");
  return Object.freeze({ document_type: documentType, version, content_hash: contentHash, acknowledgement });
}

export function validateLegalAcceptances(capability, submissions, { documents = CustomerLegalDocuments } = {}) {
  if (!Array.isArray(submissions) || submissions.length > 8) throw new Error("legal_acceptance_invalid");
  const required = legalDocumentsForCapability(capability, { documents });
  const submitted = new Map();
  for (const raw of submissions) {
    const normalized = normalizeSubmission(raw);
    if (submitted.has(normalized.document_type)) throw new Error("legal_acceptance_duplicate");
    submitted.set(normalized.document_type, normalized);
  }
  if (submitted.size !== required.length) throw new Error("legal_acceptance_incomplete");
  return Object.freeze(required.map((document) => {
    const acceptance = submitted.get(document.document_type);
    if (!acceptance
      || acceptance.version !== document.version
      || acceptance.content_hash !== document.content_hash
    ) throw new Error("legal_document_changed");
    const expectedAcknowledgement = document.document_type === "privacy" ? "acknowledged" : "agreed";
    if (acceptance.acknowledgement !== expectedAcknowledgement) throw new Error("legal_acceptance_invalid");
    return acceptance;
  }));
}

export function currentLegalAcceptanceSubmission(capability, { documents = CustomerLegalDocuments } = {}) {
  return legalDocumentsForCapability(capability, { documents }).map((document) => Object.freeze({
    document_type: document.document_type,
    version: document.version,
    content_hash: document.content_hash,
    acknowledgement: document.document_type === "privacy" ? "acknowledged" : "agreed",
  }));
}

export function legalAcceptanceSatisfies(document, acceptance) {
  const expectedAcknowledgement = document.document_type === "privacy" ? "acknowledged" : "agreed";
  const currentIdentity = acceptance?.document_version === document.version
    && acceptance?.content_hash === document.content_hash;
  const acceptedPredecessor = document.requires_reacceptance === false
    && Array.isArray(document.accepted_predecessors)
    && document.accepted_predecessors.some((predecessor) => (
      acceptance?.document_version === predecessor.version
      && acceptance?.content_hash === predecessor.content_hash
    ));
  return Boolean(acceptance
    && acceptance.document_type === document.document_type
    && (currentIdentity || acceptedPredecessor)
    && acceptance.acknowledgement === expectedAcknowledgement
    && acceptance.revoked_at == null);
}

export const CustomerLegalRegistryContract = Object.freeze({
  schema_version: CUSTOMER_LEGAL_SCHEMA,
  documents: CustomerLegalDocuments,
  requirements: CustomerLegalCapabilityRequirements,
  acceptance_is_append_only: true,
  ip_address_collected: false,
  client_supplied_user_id_accepted: false,
  declined_update_blocks_withdrawal: false,
  counsel_review_required_before_activation: true,
  informational_predecessor_equivalence_explicit: true,
});
