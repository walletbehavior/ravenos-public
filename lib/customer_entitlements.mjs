import {
  authorizeCustomerApiRequest,
  consumeCustomerRateLimit,
} from "./customer_identity.mjs";
import {
  buildParticipantProProjection,
  buildPerpsProProjection,
} from "./customer_intelligence_projections.mjs";

const ENTITLEMENT_SCHEMA = "ravenos.customer_entitlements.v1";
const APP_ORIGIN = "https://app.ravenos.xyz";
const MAX_REQUEST_URL_BYTES = 2_048;
const MAX_RESPONSE_BYTES = 384 * 1_024;
const textEncoder = new TextEncoder();

export const CUSTOMER_ENTITLEMENT_ROUTE = "/api/v1/entitlements";
export const CUSTOMER_PRO_PERPS_ROUTE = "/api/v1/intelligence/perps";
export const CUSTOMER_PRO_PARTICIPANTS_ROUTE = "/api/v1/intelligence/participants";
export const CUSTOMER_MONITOR_ALERTS_ROUTE = "/api/v1/monitor-alerts";
export const CUSTOMER_WALLET_COPY_SURFACE = "/account/copy/";
export const CUSTOMER_AGENTS_SURFACE = "/agents/";

const IMPLEMENTED_CAPABILITIES = Object.freeze({
  "intelligence.perps_advanced": Object.freeze({
    namespace: "intelligence",
    implementation_state: "implemented_dormant",
    activation_flag: "RAVENOS_PRO_PERPS_ADVANCED_ENABLE",
    route: CUSTOMER_PRO_PERPS_ROUTE,
  }),
  "intelligence.participant_advanced": Object.freeze({
    namespace: "intelligence",
    implementation_state: "implemented_dormant",
    activation_flag: "RAVENOS_PRO_PARTICIPANT_ADVANCED_ENABLE",
    route: CUSTOMER_PRO_PARTICIPANTS_ROUTE,
  }),
  "research.alerts": Object.freeze({
    namespace: "research",
    implementation_state: "implemented_dormant",
    activation_flag: "RAVENOS_RESEARCH_ALERTS_ENABLE",
    route: CUSTOMER_MONITOR_ALERTS_ROUTE,
  }),
  "wallet.copy": Object.freeze({
    namespace: "wallet",
    implementation_state: "implemented_dormant",
    activation_flag: "RAVENOS_WALLET_INTELLIGENCE_ENABLED",
    route: CUSTOMER_WALLET_COPY_SURFACE,
  }),
  "agents.paper": Object.freeze({
    namespace: "agents",
    implementation_state: "implemented_dormant",
    activation_flag: "RAVENOS_AGENTIC_PAPER_ENABLED",
    route: CUSTOMER_AGENTS_SURFACE,
  }),
});

const RESERVED_CAPABILITY_KEYS = Object.freeze([
  "intelligence.replay_advanced",
  "intelligence.export",
  "research.saved_state_extended",
  "research.saved_scans",
  "atlas.native_breadth",
  "atlas.filing_comparisons",
  "atlas.native_filing_marks",
  "atlas.portfolio_context",
  "atlas.options_intelligence",
  "atlas.authenticated_broker_overlay",
]);

const CAPABILITY_DEFINITIONS = Object.freeze({
  ...IMPLEMENTED_CAPABILITIES,
  ...Object.fromEntries(RESERVED_CAPABILITY_KEYS.map((key) => [key, Object.freeze({
    namespace: key.split(".")[0],
    implementation_state: "reserved_unavailable",
    activation_flag: null,
    route: null,
  })])),
});

const ROUTE_CAPABILITIES = Object.freeze({
  [CUSTOMER_PRO_PERPS_ROUTE]: "intelligence.perps_advanced",
  [CUSTOMER_PRO_PARTICIPANTS_ROUTE]: "intelligence.participant_advanced",
});

const ENTITLEMENT_ROUTES = new Set([
  CUSTOMER_ENTITLEMENT_ROUTE,
  CUSTOMER_PRO_PERPS_ROUTE,
  CUSTOMER_PRO_PARTICIPANTS_ROUTE,
]);

function clean(value, max = 240) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function flag(value) {
  return String(value || "") === "1";
}

function mergeVary(headers, values) {
  const current = String(headers.get("vary") || "").split(",").map((value) => value.trim()).filter(Boolean);
  headers.set("vary", [...new Set([...current, ...values])].join(", "));
}

function privateHeaders(source = null, extra = {}) {
  const headers = new Headers(source || undefined);
  headers.set("cache-control", "private, no-store, max-age=0");
  headers.set("pragma", "no-cache");
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  mergeVary(headers, ["Cookie", "Origin"]);
  for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return headers;
}

function privateJson(payload, { status = 200, headers = null, extra_headers: extraHeaders = {} } = {}) {
  const body = JSON.stringify(payload);
  if (textEncoder.encode(body).byteLength > MAX_RESPONSE_BYTES) {
    return new Response(JSON.stringify({
      ok: false,
      schema_version: ENTITLEMENT_SCHEMA,
      error: "authenticated_projection_too_large",
      state: "unavailable",
    }), { status: 503, headers: privateHeaders(headers) });
  }
  return new Response(body, { status, headers: privateHeaders(headers, extraHeaders) });
}

function exactBrowserOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function readBoundary(request) {
  const url = new URL(request.url);
  if (url.origin !== APP_ORIGIN) {
    return privateJson({ ok: false, error: "not_found" }, { status: 404 });
  }
  if (request.method !== "GET") {
    return privateJson({ ok: false, error: "method_not_allowed" }, { status: 405, extra_headers: { allow: "GET" } });
  }
  if (textEncoder.encode(request.url).byteLength > MAX_REQUEST_URL_BYTES) {
    return privateJson({ ok: false, error: "request_too_large" }, { status: 414 });
  }
  if (url.search || url.hash) {
    return privateJson({ ok: false, error: "request_parameters_not_allowed" }, { status: 400 });
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > 0) {
    return privateJson({ ok: false, error: contentLength > MAX_REQUEST_URL_BYTES ? "request_too_large" : "request_body_not_allowed" }, { status: contentLength > MAX_REQUEST_URL_BYTES ? 413 : 400 });
  }
  const fetchSite = clean(request.headers.get("sec-fetch-site"), 32).toLowerCase();
  if (fetchSite !== "same-origin") {
    return privateJson({ ok: false, error: "request_not_allowed" }, { status: 403 });
  }
  const suppliedOrigin = clean(request.headers.get("origin"), 300);
  if (suppliedOrigin) {
    if (suppliedOrigin !== APP_ORIGIN) return privateJson({ ok: false, error: "request_not_allowed" }, { status: 403 });
  } else if (exactBrowserOrigin(request.headers.get("referer")) !== APP_ORIGIN) {
    return privateJson({ ok: false, error: "request_not_allowed" }, { status: 403 });
  }
  return null;
}

export function resolveEntitlementFeatureFlags(env = {}) {
  return Object.freeze({
    entitlement_resolution: flag(env.RAVENOS_ENTITLEMENT_RESOLUTION_ENABLE),
    authenticated_pro_routes: flag(env.RAVENOS_PRO_INTELLIGENCE_ROUTES_ENABLE),
    public_pro_projection_split: flag(env.RAVENOS_PUBLIC_PROJECTION_SPLIT_ENABLE),
    capability_enablement: Object.freeze({
      "intelligence.perps_advanced": flag(env.RAVENOS_PRO_PERPS_ADVANCED_ENABLE),
      "intelligence.participant_advanced": flag(env.RAVENOS_PRO_PARTICIPANT_ADVANCED_ENABLE),
      "research.alerts": flag(env.RAVENOS_RESEARCH_ALERTS_ENABLE),
      "wallet.copy": flag(env.RAVENOS_ENTITLEMENT_RESOLUTION_ENABLE)
        && flag(env.RAVENOS_WALLET_INTELLIGENCE_ENABLED)
        && flag(env.RAVENOS_WALLET_COPY_ROUTES_ENABLED),
      "agents.paper": flag(env.RAVENOS_ENTITLEMENT_RESOLUTION_ENABLE)
        && flag(env.RAVENOS_AGENTIC_PAPER_ENABLED),
    }),
  });
}

export function resolveCoordinatedIntelligenceSplits(env = {}) {
  const flags = resolveEntitlementFeatureFlags(env);
  const foundationActive = flags.entitlement_resolution
    && flags.authenticated_pro_routes
    && flags.public_pro_projection_split;
  return Object.freeze({
    perps: foundationActive && flags.capability_enablement["intelligence.perps_advanced"] === true,
    participants: foundationActive && flags.capability_enablement["intelligence.participant_advanced"] === true,
  });
}

export function createD1CustomerEntitlementStore(db) {
  if (!db?.prepare) throw new Error("customer_entitlement_store_unavailable");
  return Object.freeze({
    async listOwnedGrants(userId) {
      const result = await db.prepare(`
        SELECT grant_id, user_id, capability_key, state, activation_at, expires_at, created_at, updated_at, revision
        FROM ravenos_customer_entitlement_grants
        WHERE user_id = ?
        ORDER BY updated_at DESC, grant_id ASC
        LIMIT 64
      `).bind(userId).all();
      if (!result || !Array.isArray(result.results)) throw new Error("customer_entitlement_query_failed");
      return result.results;
    },
  });
}

function normalizedGrant(row, expectedUserId) {
  if (!row || typeof row !== "object") return null;
  const userId = clean(row.user_id, 100);
  const grantId = clean(row.grant_id, 100);
  const capability = clean(row.capability_key, 100);
  const state = clean(row.state, 20).toLowerCase();
  if (userId !== expectedUserId || !/^ent_[A-Za-z0-9_-]{16,96}$/.test(grantId)) return null;
  if (!Object.hasOwn(CAPABILITY_DEFINITIONS, capability)) return null;
  if (!["active", "expired", "revoked", "suspended"].includes(state)) return null;
  const activationAt = row.activation_at === null || row.activation_at === undefined ? null : Number(row.activation_at);
  const expiresAt = row.expires_at === null || row.expires_at === undefined ? null : Number(row.expires_at);
  const revision = Number(row.revision);
  if ((activationAt !== null && !Number.isSafeInteger(activationAt)) || (expiresAt !== null && !Number.isSafeInteger(expiresAt))) return null;
  if (!Number.isSafeInteger(revision) || revision < 1) return null;
  return Object.freeze({ grant_id: grantId, user_id: userId, capability_key: capability, state, activation_at: activationAt, expires_at: expiresAt, revision });
}

function grantState(grants, capability, now) {
  const rows = grants.filter((row) => row.capability_key === capability);
  const active = rows.find((row) => row.state === "active"
    && (row.activation_at === null || row.activation_at <= now)
    && (row.expires_at === null || row.expires_at > now));
  if (active) return { state: "active", grant: active };
  if (rows.some((row) => row.state === "suspended")) return { state: "suspended", grant: null };
  if (rows.some((row) => row.state === "revoked")) return { state: "revoked", grant: null };
  if (rows.some((row) => row.state === "expired" || (row.state === "active" && row.expires_at !== null && row.expires_at <= now))) return { state: "expired", grant: null };
  if (rows.some((row) => row.state === "active" && row.activation_at !== null && row.activation_at > now)) return { state: "not_yet_active", grant: null };
  return { state: "not_granted", grant: null };
}

export function resolveCapabilityAccess({
  capability,
  user_id: userId,
  grants = [],
  now,
  flags = resolveEntitlementFeatureFlags(),
  atlas_display_decision: atlasDisplayDecision = null,
} = {}) {
  const key = clean(capability, 100);
  const definition = CAPABILITY_DEFINITIONS[key];
  if (!definition) return Object.freeze({ capability: key || null, available: false, state: "unknown_capability", revision: null });
  if (definition.implementation_state !== "implemented_dormant") {
    return Object.freeze({ capability: key, available: false, state: "reserved_unavailable", revision: null });
  }
  if (definition.namespace === "atlas" && atlasDisplayDecision?.allowed !== true) {
    return Object.freeze({ capability: key, available: false, state: "data_rights_unavailable", revision: null });
  }
  if (flags.capability_enablement?.[key] !== true) {
    return Object.freeze({ capability: key, available: false, state: "server_disabled", revision: null });
  }
  const owner = clean(userId, 100);
  if (!owner) return Object.freeze({ capability: key, available: false, state: "owner_unavailable", revision: null });
  const evaluatedAt = Number(now);
  if (!Number.isSafeInteger(evaluatedAt) || evaluatedAt < 0) {
    return Object.freeze({ capability: key, available: false, state: "time_unavailable", revision: null });
  }
  const normalized = arrayOf(grants).map((row) => normalizedGrant(row, owner)).filter(Boolean);
  const resolved = grantState(normalized, key, evaluatedAt);
  return Object.freeze({
    capability: key,
    available: resolved.state === "active",
    state: resolved.state,
    revision: resolved.grant?.revision || null,
  });
}

function arrayOf(value) {
  return Array.isArray(value) ? value.slice(0, 64) : [];
}

function publicCapabilitySummary(definition, access) {
  return Object.freeze({
    capability: access.capability,
    namespace: definition.namespace,
    implementation_state: definition.implementation_state,
    available: access.available,
    state: access.state,
    revision: access.revision,
    route: definition.route,
  });
}

async function authorize(request, env, deps) {
  const authorizeRequest = deps.authorizeRequest || authorizeCustomerApiRequest;
  return authorizeRequest(request, env, deps.identity || {});
}

async function rateLimit(request, env, deps, authorization, route) {
  const consume = deps.consumeRateLimit || consumeCustomerRateLimit;
  return consume({
    store: authorization.store,
    env,
    request,
    action: "entitlement_read",
    scope: route === CUSTOMER_ENTITLEMENT_ROUTE ? "summary" : route.endsWith("/perps") ? "perps" : "participants",
    subject: authorization.principal.user_id,
    now: authorization.now,
    window_seconds: route === CUSTOMER_ENTITLEMENT_ROUTE ? 900 : 300,
    limit: route === CUSTOMER_ENTITLEMENT_ROUTE ? 60 : 30,
    include_network: true,
  });
}

function entitlementStore(env, deps) {
  return deps.entitlementStore || createD1CustomerEntitlementStore(env.RAVENOS_CUSTOMER_DB);
}

function unavailable(error, authorization, details = {}) {
  return privateJson({
    ok: false,
    schema_version: ENTITLEMENT_SCHEMA,
    error,
    state: "unavailable",
    purchasable: false,
    checkout_available: false,
    ...details,
  }, { status: 503, headers: authorization?.response_headers });
}

async function loadCurrentProjection(deps, key) {
  if (typeof deps.loadProjection !== "function") throw new Error("projection_loader_unavailable");
  const result = await deps.loadProjection(key);
  const freshnessState = clean(result?.delivery?.freshness_state, 24).toLowerCase();
  if (result?.available !== true || !["fresh", "delayed"].includes(freshnessState)) {
    const error = new Error("projection_unavailable");
    error.freshnessState = freshnessState || "unavailable";
    throw error;
  }
  return result;
}

export async function routeCustomerEntitlements(request, env = {}, deps = {}) {
  const url = new URL(request.url);
  if (!ENTITLEMENT_ROUTES.has(url.pathname)) return null;
  const boundary = readBoundary(request);
  if (boundary) return boundary;

  const authorization = await authorize(request, env, deps);
  if (authorization.response) {
    return new Response(authorization.response.body, {
      status: authorization.response.status,
      statusText: authorization.response.statusText,
      headers: privateHeaders(authorization.response.headers),
    });
  }

  const flags = resolveEntitlementFeatureFlags(env);
  if (!flags.entitlement_resolution) return unavailable("entitlement_resolution_unavailable", authorization);
  if (url.pathname !== CUSTOMER_ENTITLEMENT_ROUTE && (!flags.authenticated_pro_routes || !flags.public_pro_projection_split)) {
    return unavailable("pro_intelligence_beta_unavailable", authorization);
  }

  let limited;
  try {
    limited = await rateLimit(request, env, deps, authorization, url.pathname);
  } catch {
    return unavailable("entitlement_rate_limit_unavailable", authorization);
  }
  if (!limited.allowed) {
    return privateJson({ ok: false, schema_version: ENTITLEMENT_SCHEMA, error: "entitlement_rate_limited", state: "unavailable" }, {
      status: 429,
      headers: authorization.response_headers,
      extra_headers: { "retry-after": String(limited.retry_after_seconds) },
    });
  }

  let grants;
  try {
    grants = await entitlementStore(env, deps).listOwnedGrants(authorization.principal.user_id);
  } catch {
    return unavailable("entitlement_store_unavailable", authorization);
  }

  if (url.pathname === CUSTOMER_ENTITLEMENT_ROUTE) {
    const capabilities = Object.entries(CAPABILITY_DEFINITIONS).map(([capability, definition]) => {
      const access = resolveCapabilityAccess({ capability, user_id: authorization.principal.user_id, grants, now: authorization.now, flags });
      return publicCapabilitySummary(definition, access);
    });
    return privateJson({
      ok: true,
      schema_version: ENTITLEMENT_SCHEMA,
      state: capabilities.some((row) => row.available) ? "available" : "no_active_capabilities",
      capabilities,
      purchasable: false,
      checkout_available: false,
      customer_mutation_available: false,
      atlas_display_rights_override_available: false,
    }, { headers: authorization.response_headers });
  }

  const capability = ROUTE_CAPABILITIES[url.pathname];
  const access = resolveCapabilityAccess({ capability, user_id: authorization.principal.user_id, grants, now: authorization.now, flags });
  if (!access.available) {
    const status = ["expired", "revoked", "suspended", "not_granted", "not_yet_active"].includes(access.state) ? 403 : 503;
    return privateJson({
      ok: false,
      schema_version: ENTITLEMENT_SCHEMA,
      error: status === 403 ? "capability_not_authorized" : "capability_unavailable",
      capability,
      state: access.state,
      purchasable: false,
      checkout_available: false,
    }, { status, headers: authorization.response_headers });
  }

  try {
    const key = capability === "intelligence.perps_advanced" ? "perps" : "behavior";
    const result = await loadCurrentProjection(deps, key);
    const projection = capability === "intelligence.perps_advanced"
      ? buildPerpsProProjection(result.payload, { delivery: result.delivery })
      : buildParticipantProProjection(result.payload, { delivery: result.delivery });
    return privateJson({
      ok: true,
      schema_version: ENTITLEMENT_SCHEMA,
      capability,
      entitlement_revision: access.revision,
      projection,
    }, { headers: authorization.response_headers });
  } catch (error) {
    return unavailable("intelligence_projection_unavailable", authorization, {
      capability,
      freshness_state: clean(error?.freshnessState, 24) || "unavailable",
    });
  }
}

export const CustomerEntitlementContract = Object.freeze({
  schema_version: ENTITLEMENT_SCHEMA,
  authenticated_origin: APP_ORIGIN,
  routes: Object.freeze([CUSTOMER_ENTITLEMENT_ROUTE, CUSTOMER_PRO_PERPS_ROUTE, CUSTOMER_PRO_PARTICIPANTS_ROUTE]),
  capabilities: CAPABILITY_DEFINITIONS,
  activation_flags: Object.freeze({
    resolution: "RAVENOS_ENTITLEMENT_RESOLUTION_ENABLE",
    authenticated_routes: "RAVENOS_PRO_INTELLIGENCE_ROUTES_ENABLE",
    projection_split: "RAVENOS_PUBLIC_PROJECTION_SPLIT_ENABLE",
    perps: "RAVENOS_PRO_PERPS_ADVANCED_ENABLE",
    participants: "RAVENOS_PRO_PARTICIPANT_ADVANCED_ENABLE",
    alerts: "RAVENOS_RESEARCH_ALERTS_ENABLE",
    wallet_copy: "RAVENOS_WALLET_INTELLIGENCE_ENABLED",
    wallet_copy_routes: "RAVENOS_WALLET_COPY_ROUTES_ENABLED",
    agentic_paper: "RAVENOS_AGENTIC_PAPER_ENABLED",
  }),
  defaults: Object.freeze({ resolution: false, authenticated_routes: false, projection_split: false, perps: false, participants: false, alerts: false, wallet_copy: false, wallet_copy_routes: false, agentic_paper: false }),
  coordinated_public_splits: Object.freeze({
    perps: Object.freeze([
      "RAVENOS_ENTITLEMENT_RESOLUTION_ENABLE",
      "RAVENOS_PRO_INTELLIGENCE_ROUTES_ENABLE",
      "RAVENOS_PUBLIC_PROJECTION_SPLIT_ENABLE",
      "RAVENOS_PRO_PERPS_ADVANCED_ENABLE",
    ]),
    participants: Object.freeze([
      "RAVENOS_ENTITLEMENT_RESOLUTION_ENABLE",
      "RAVENOS_PRO_INTELLIGENCE_ROUTES_ENABLE",
      "RAVENOS_PUBLIC_PROJECTION_SPLIT_ENABLE",
      "RAVENOS_PRO_PARTICIPANT_ADVANCED_ENABLE",
    ]),
  }),
  customer_mutation_available: false,
  browser_bearer_tokens: false,
  shared_cdn_cache: false,
  atlas_display_rights_required: true,
  entitlement_can_expand_atlas_display_rights: false,
  billing_available: false,
  checkout_available: false,
  wallet_data_stored: false,
  customer_owned_wallet_data_stored: false,
  public_source_wallet_data_stored: true,
  wallet_copy_storage_separate: true,
  execution_data_stored: false,
});
