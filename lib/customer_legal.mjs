import {
  authorizeCustomerApiRequest,
  randomOpaqueId,
} from "./customer_identity.mjs";
import {
  CUSTOMER_LEGAL_ACCEPTANCE_SCHEMA,
  CUSTOMER_LEGAL_SCHEMA,
  CustomerLegalDocuments,
  legalAcceptanceSatisfies,
  legalDocumentsForCapability,
  publicCustomerLegalManifest,
  publicLegalDocument,
  resolveCustomerLegalRuntime,
  validateLegalAcceptances,
} from "./customer_legal_registry.mjs";
import {
  boundedJsonResponse,
  parseBoundedJsonBody,
} from "./customer_trade/terminal_runtime.mjs";

export const CUSTOMER_LEGAL_DOCUMENTS_ROUTE = "/api/v1/legal/documents";
export const CUSTOMER_LEGAL_STATUS_ROUTE = "/api/v1/legal/status";
export const CUSTOMER_LEGAL_ACCEPTANCES_ROUTE = "/api/v1/legal/acceptances";

const MUTATION_METHODS = Object.freeze({
  pro_subscription: "pro_subscription",
  trading_activation: "trading_activation",
  copy_activation: "copy_activation",
  embedded_wallet_activation: "embedded_wallet_activation",
  community_publication: "community_publication",
  affiliate_enrollment: "affiliate_enrollment",
});

function clean(value, maximum = 160) {
  return String(value ?? "").trim().slice(0, maximum);
}

function response(payload, { status = 200, headers = null, publicCache = false } = {}) {
  const forwarded = {};
  if (headers instanceof Headers) headers.forEach((value, key) => { forwarded[key] = value; });
  return boundedJsonResponse(payload, {
    status,
    headers: {
      ...forwarded,
      "cache-control": publicCache ? "public, max-age=300, s-maxage=300" : "private, no-store, max-age=0",
      ...(!publicCache ? { pragma: "no-cache" } : {}),
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      vary: publicCache ? "Accept-Encoding" : "Cookie, Origin",
    },
  }, { max_bytes: 96 * 1024, terminal_security: true });
}

function publicAcceptance(row) {
  return Object.freeze({
    schema_version: CUSTOMER_LEGAL_ACCEPTANCE_SCHEMA,
    document_type: clean(row.document_type, 48),
    document_version: clean(row.document_version, 96),
    content_hash: clean(row.content_hash, 64).toLowerCase(),
    acknowledgement: clean(row.acknowledgement, 24),
    accepted_at: new Date(Number(row.accepted_at) * 1_000).toISOString(),
    acceptance_method: clean(row.acceptance_method, 48),
  });
}

export function createD1CustomerLegalStore(db) {
  if (!db?.prepare || !db?.batch) throw new Error("customer_legal_store_unavailable");
  return Object.freeze({
    async listAcceptances(userId) {
      const result = await db.prepare(`
        SELECT document_type, document_version, content_hash, acknowledgement,
               accepted_at, acceptance_method, revoked_at
        FROM ravenos_legal_acceptances
        WHERE user_id = ? AND revoked_at IS NULL
        ORDER BY accepted_at DESC, acceptance_id DESC
      `).bind(userId).all();
      return Array.isArray(result?.results) ? result.results : [];
    },

    async recordAcceptances({ user_id: userId, acceptances, acceptance_method: method, accepted_at: acceptedAt }) {
      const statements = acceptances.map((acceptance) => db.prepare(`
        INSERT OR IGNORE INTO ravenos_legal_acceptances (
          acceptance_id, user_id, document_type, document_version, content_hash,
          acknowledgement, accepted_at, acceptance_method, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).bind(
        randomOpaqueId("lac_", 18), userId, acceptance.document_type, acceptance.version,
        acceptance.content_hash, acceptance.acknowledgement, acceptedAt, method,
      ));
      if (statements.length) await db.batch(statements);
      return this.listAcceptances(userId);
    },
  });
}

function storeFor(env, deps) {
  return deps.legalStore || createD1CustomerLegalStore(env.RAVENOS_CUSTOMER_DB);
}

function capabilityStatus(capability, rows, { documents = CustomerLegalDocuments } = {}) {
  const required = legalDocumentsForCapability(capability, { documents });
  const matches = required.map((document) => ({
    document: publicLegalDocument(document),
    accepted: rows.some((row) => legalAcceptanceSatisfies(document, row)),
  }));
  return Object.freeze({
    capability,
    satisfied: matches.every((row) => row.accepted),
    required_documents: matches,
    protected_action_only: true,
    account_access_blocked: false,
    withdrawal_blocked: false,
    wallet_export_blocked: false,
    wallet_recovery_blocked: false,
  });
}

async function legalStatus(request, env, deps, capability = "") {
  const documents = deps.documents || CustomerLegalDocuments;
  const authorization = await (deps.authorizeRequest || authorizeCustomerApiRequest)(request, env, deps);
  if (authorization.response) return authorization.response;
  const rows = await storeFor(env, deps).listAcceptances(authorization.principal.user_id);
  const runtime = resolveCustomerLegalRuntime(env, { documents });
  const capabilities = capability
    ? [capability]
    : ["account_creation", "trading_activation", "copy_activation", "embedded_wallet_activation", "community_publication", "affiliate_enrollment"];
  let status;
  try {
    status = capabilities.map((value) => capabilityStatus(value, rows, { documents }));
  } catch {
    return response({ ok: false, schema_version: CUSTOMER_LEGAL_SCHEMA, error: "legal_capability_invalid" }, {
      status: 400,
      headers: authorization.response_headers,
    });
  }
  return response({
    ok: true,
    schema_version: CUSTOMER_LEGAL_SCHEMA,
    state: runtime.state,
    acceptance_enforced: runtime.ready,
    acceptances: rows.map(publicAcceptance),
    capabilities: status,
  }, { headers: authorization.response_headers });
}

async function recordAcceptance(request, env, deps) {
  const documents = deps.documents || CustomerLegalDocuments;
  const runtime = resolveCustomerLegalRuntime(env, { documents });
  if (!runtime.ready) return response({
    ok: false,
    schema_version: CUSTOMER_LEGAL_SCHEMA,
    state: runtime.state,
    error: "legal_documents_not_effective",
  }, { status: 503 });
  const authorization = await (deps.authorizeRequest || authorizeCustomerApiRequest)(request, env, deps, { require_csrf: true });
  if (authorization.response) return authorization.response;
  let payload;
  try {
    payload = await parseBoundedJsonBody(request, { max_bytes: 12 * 1024 });
  } catch {
    return response({ ok: false, schema_version: CUSTOMER_LEGAL_SCHEMA, error: "legal_acceptance_invalid" }, {
      status: 400,
      headers: authorization.response_headers,
    });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || Object.keys(payload).some((key) => !new Set(["capability", "acceptances"]).has(key))) {
    return response({ ok: false, schema_version: CUSTOMER_LEGAL_SCHEMA, error: "legal_acceptance_invalid" }, {
      status: 400,
      headers: authorization.response_headers,
    });
  }
  const capability = clean(payload?.capability, 48).toLowerCase();
  const method = MUTATION_METHODS[capability];
  if (!method) return response({ ok: false, schema_version: CUSTOMER_LEGAL_SCHEMA, error: "legal_capability_invalid" }, {
    status: 400,
    headers: authorization.response_headers,
  });
  let acceptances;
  try {
    acceptances = validateLegalAcceptances(capability, payload.acceptances, { documents });
  } catch (error) {
    const code = new Set(["legal_document_changed", "legal_acceptance_incomplete", "legal_acceptance_duplicate"]).has(error?.message)
      ? error.message
      : "legal_acceptance_invalid";
    return response({ ok: false, schema_version: CUSTOMER_LEGAL_SCHEMA, error: code }, {
      status: code === "legal_document_changed" ? 409 : 400,
      headers: authorization.response_headers,
    });
  }
  const rows = await storeFor(env, deps).recordAcceptances({
    user_id: authorization.principal.user_id,
    acceptances,
    acceptance_method: method,
    accepted_at: authorization.now,
  });
  const recordedStatus = capabilityStatus(capability, rows, { documents });
  if (!recordedStatus.satisfied) return response({
    ok: false,
    schema_version: CUSTOMER_LEGAL_SCHEMA,
    state: "not_recorded",
    error: "legal_acceptance_not_recorded",
    capability: recordedStatus,
  }, { status: 409, headers: authorization.response_headers });
  return response({
    ok: true,
    schema_version: CUSTOMER_LEGAL_SCHEMA,
    state: "recorded",
    capability: recordedStatus,
  }, { headers: authorization.response_headers });
}

export async function requireCustomerLegalCapability(request, env = {}, capability, deps = {}, { require_csrf: requireCsrf = false } = {}) {
  const documents = deps.documents || CustomerLegalDocuments;
  const runtime = resolveCustomerLegalRuntime(env, { documents });
  if (!runtime.requested) return Object.freeze({ allowed: true, state: "not_enforced" });
  if (!runtime.ready) return Object.freeze({
    allowed: false,
    state: runtime.state,
    response: response({ ok: false, schema_version: CUSTOMER_LEGAL_SCHEMA, state: runtime.state, error: "legal_activation_unavailable" }, { status: 503 }),
  });
  const authorization = await (deps.authorizeRequest || authorizeCustomerApiRequest)(request, env, deps, { require_csrf: requireCsrf });
  if (authorization.response) return Object.freeze({ allowed: false, state: "authorization_failed", response: authorization.response });
  const rows = await storeFor(env, deps).listAcceptances(authorization.principal.user_id);
  const status = capabilityStatus(capability, rows, { documents });
  if (status.satisfied) return Object.freeze({ allowed: true, state: "satisfied", authorization, status });
  return Object.freeze({
    allowed: false,
    state: "acceptance_required",
    authorization,
    status,
    response: response({
      ok: false,
      schema_version: CUSTOMER_LEGAL_SCHEMA,
      state: "acceptance_required",
      error: "legal_acceptance_required",
      capability: status,
    }, { status: 428, headers: authorization.response_headers }),
  });
}

export async function routeCustomerLegal(request, env = {}, deps = {}) {
  const url = new URL(request.url);
  if (url.pathname === CUSTOMER_LEGAL_DOCUMENTS_ROUTE) {
    if (request.method !== "GET") return response({ ok: false, schema_version: CUSTOMER_LEGAL_SCHEMA, error: "method_not_allowed" }, { status: 405 });
    return response(publicCustomerLegalManifest(env, { documents: deps.documents || CustomerLegalDocuments }), { publicCache: true });
  }
  if (url.pathname === CUSTOMER_LEGAL_STATUS_ROUTE) {
    if (request.method !== "GET") return response({ ok: false, schema_version: CUSTOMER_LEGAL_SCHEMA, error: "method_not_allowed" }, { status: 405 });
    return legalStatus(request, env, deps, clean(url.searchParams.get("capability"), 48).toLowerCase());
  }
  if (url.pathname === CUSTOMER_LEGAL_ACCEPTANCES_ROUTE) {
    if (request.method !== "POST") return response({ ok: false, schema_version: CUSTOMER_LEGAL_SCHEMA, error: "method_not_allowed" }, { status: 405 });
    return recordAcceptance(request, env, deps);
  }
  return null;
}

export const CustomerLegalContract = Object.freeze({
  schema_version: CUSTOMER_LEGAL_SCHEMA,
  routes: Object.freeze([CUSTOMER_LEGAL_DOCUMENTS_ROUTE, CUSTOMER_LEGAL_STATUS_ROUTE, CUSTOMER_LEGAL_ACCEPTANCES_ROUTE]),
  append_only_acceptance: true,
  exact_document_hash_required: true,
  account_creation_server_validation: true,
  withdrawal_exempt: true,
  wallet_export_exempt: true,
  wallet_recovery_exempt: true,
  production_activation_requires_counsel_flag: true,
});
