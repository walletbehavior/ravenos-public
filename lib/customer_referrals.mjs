import {
  authorizeCustomerApiRequest,
  consumeCustomerRateLimit,
  randomOpaqueId,
  sha256,
} from "./customer_identity.mjs";
import {
  boundedJsonResponse,
  parseBoundedJsonBody,
} from "./customer_trade/terminal_runtime.mjs";

export const CUSTOMER_REFERRAL_ROUTE = "/api/v1/referrals";
export const CUSTOMER_REFERRAL_SCHEMA = "ravenos.customer_referrals.v1";
export const REFERRAL_CODE_SCHEMA = "ravenos.referral_code.v1";
export const REFERRAL_ATTRIBUTION_SCHEMA = "ravenos.referral_attribution.v1";
export const REFERRAL_SUBSCRIPTION_EVIDENCE_SCHEMA = "ravenos.referral_subscription_evidence.v1";

const APP_ORIGIN = "https://app.ravenos.xyz";
const REFERRAL_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const SUBSCRIPTION_EVENT_TYPES = new Set([
  "pro_subscription_activated",
  "pro_subscription_renewed",
  "pro_subscription_cancelled",
  "pro_subscription_refunded",
  "pro_subscription_chargeback",
]);

export const ReferralLimits = Object.freeze({
  maximum_request_bytes: 2 * 1024,
  maximum_response_bytes: 48 * 1024,
  mutations_per_15_minutes: 20,
  code_entropy_bits: 60,
});

export class ReferralError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = "ReferralError";
    this.code = code;
    this.status = status;
  }
}

function text(value, maximum = 160) {
  return String(value ?? "").trim().slice(0, maximum);
}

function exactObject(value, allowed, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ReferralError(code);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new ReferralError(code);
  return value;
}

function integer(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 8_640_000_000_000) throw new ReferralError(`${field}_invalid`);
  return number;
}

function digest(value, field) {
  const normalized = text(value, 160);
  if (!/^[A-Za-z0-9_-]{32,160}$/.test(normalized)) throw new ReferralError(`${field}_invalid`);
  return normalized;
}

function contractId(value) {
  const normalized = text(value, 160).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._:-]{2,159}$/.test(normalized)) throw new ReferralError("source_contract_id_invalid");
  return normalized;
}

function iso(seconds) {
  const value = Number(seconds);
  return Number.isSafeInteger(value) && value >= 0 ? new Date(value * 1_000).toISOString() : null;
}

function json(payload, { status = 200, headers = null } = {}) {
  const outputHeaders = {};
  if (headers instanceof Headers) headers.forEach((value, key) => { outputHeaders[key] = value; });
  return boundedJsonResponse(payload, {
    status,
    headers: {
      ...outputHeaders,
      "cache-control": "private, no-store, max-age=0",
      pragma: "no-cache",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      vary: "Cookie, Origin",
    },
  }, {
    max_bytes: ReferralLimits.maximum_response_bytes,
    terminal_security: true,
  });
}

export function normalizeReferralCode(value) {
  const normalized = text(value, 40).toUpperCase();
  if (!/^RVN[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/.test(normalized)) throw new ReferralError("referral_code_invalid");
  return normalized;
}

export function createReferralCodeValue(bytes = null) {
  const entropy = bytes === null ? crypto.getRandomValues(new Uint8Array(12)) : bytes;
  if (!(entropy instanceof Uint8Array) || entropy.byteLength !== 12) throw new ReferralError("referral_entropy_invalid", 500);
  let suffix = "";
  for (const byte of entropy) suffix += REFERRAL_ALPHABET[byte & 31];
  return `RVN${suffix}`;
}

export function resolveReferralRuntime(env = {}, deps = {}) {
  const databaseAvailable = Boolean(deps.store || env.RAVENOS_CUSTOMER_DB?.prepare);
  const enabled = String(env.RAVENOS_REFERRALS_ENABLED || "") === "1";
  const billingReconciliation = enabled
    && String(env.RAVENOS_REFERRAL_BILLING_RECONCILIATION_ENABLED || "") === "1";
  return Object.freeze({
    enabled: enabled && databaseAvailable,
    state: !enabled ? "disabled" : databaseAvailable ? "available" : "database_unavailable",
    reason: !enabled ? "referrals_disabled" : databaseAvailable ? null : "referral_database_unavailable",
    billing_reconciliation_enabled: billingReconciliation,
    reward_policy_configured: false,
    payouts_available: false,
  });
}

export async function createReferralCodeRecord({ user_id: userId, code, now } = {}) {
  const normalizedUser = text(userId, 100);
  const normalizedCode = normalizeReferralCode(code);
  const createdAt = integer(now, "created_at");
  if (!normalizedUser) throw new ReferralError("user_id_invalid");
  const codeDigest = await sha256(JSON.stringify({
    schema_version: REFERRAL_CODE_SCHEMA,
    user_id: normalizedUser,
    referral_code: normalizedCode,
    created_at: createdAt,
  }));
  return Object.freeze({
    schema_version: REFERRAL_CODE_SCHEMA,
    user_id: normalizedUser,
    referral_code: normalizedCode,
    state: "active",
    code_digest: codeDigest,
    created_at: createdAt,
    updated_at: createdAt,
  });
}

export async function createReferralAttributionRecord({
  referred_user_id: referredUserId,
  referrer_user_id: referrerUserId,
  referral_code: referralCode,
  now,
} = {}) {
  const referred = text(referredUserId, 100);
  const referrer = text(referrerUserId, 100);
  const code = normalizeReferralCode(referralCode);
  const attributedAt = integer(now, "attributed_at");
  if (!referred || !referrer) throw new ReferralError("referral_identity_invalid");
  if (referred === referrer) throw new ReferralError("self_referral_not_allowed", 409);
  const record = {
    schema_version: REFERRAL_ATTRIBUTION_SCHEMA,
    attribution_id: randomOpaqueId("rat_", 18),
    referred_user_id: referred,
    referrer_user_id: referrer,
    referral_code_snapshot: code,
    attribution_method: "authenticated_claim",
    attributed_at: attributedAt,
  };
  return Object.freeze({ ...record, attribution_digest: await sha256(JSON.stringify(record)) });
}

export async function createReferralSubscriptionEvidence(input = {}, { now = Math.floor(Date.now() / 1_000) } = {}) {
  const source = exactObject(input, new Set([
    "event_id", "attribution_id", "event_type", "source_contract_id", "source_reference_digest", "effective_at",
  ]), "referral_subscription_evidence_invalid");
  const eventType = text(source.event_type, 48).toLowerCase();
  if (!SUBSCRIPTION_EVENT_TYPES.has(eventType)) throw new ReferralError("referral_subscription_event_type_invalid");
  const record = {
    schema_version: REFERRAL_SUBSCRIPTION_EVIDENCE_SCHEMA,
    event_id: text(source.event_id, 100) || randomOpaqueId("rse_", 18),
    attribution_id: text(source.attribution_id, 100),
    event_type: eventType,
    source_contract_id: contractId(source.source_contract_id),
    source_reference_digest: digest(source.source_reference_digest, "source_reference_digest"),
    effective_at: integer(source.effective_at, "effective_at"),
    observed_at: integer(now, "observed_at"),
  };
  if (!/^rat_[A-Za-z0-9_-]{12,96}$/.test(record.attribution_id)) throw new ReferralError("attribution_id_invalid");
  if (!/^rse_[A-Za-z0-9_-]{12,96}$/.test(record.event_id)) throw new ReferralError("event_id_invalid");
  return Object.freeze({ ...record, record_digest: await sha256(JSON.stringify(record)) });
}

function dashboard(row, runtime) {
  if (!row) throw new ReferralError("referral_account_unavailable", 404);
  const code = row.referral_code ? normalizeReferralCode(row.referral_code) : null;
  return Object.freeze({
    schema_version: CUSTOMER_REFERRAL_SCHEMA,
    state: code ? "active" : "not_created",
    referral_code: code,
    referral_url: code ? `${APP_ORIGIN}/account/?ref=${encodeURIComponent(code)}` : null,
    code_created_at: code ? iso(row.code_created_at) : null,
    attribution: row.attribution_id ? Object.freeze({
      state: "recorded",
      attributed_at: iso(row.attributed_at),
    }) : null,
    referred_accounts: Number(row.referred_accounts || 0),
    qualified_pro_subscriptions: Number(row.qualified_pro_subscriptions || 0),
    economics: Object.freeze({
      reward_policy_state: runtime.reward_policy_configured ? "configured" : "not_configured",
      earnings: null,
      payout_state: "unavailable",
    }),
    boundaries: Object.freeze({
      pro_subscription_evidence_required: true,
      customer_claim_can_create_entitlement: false,
      customer_claim_can_create_credit: false,
      trade_volume_affects_reward: false,
      trading_performance_affects_reward: false,
      referral_is_investment_endorsement: false,
      attribution_replaceable: false,
      billing_reconciliation_enabled: runtime.billing_reconciliation_enabled,
      payouts_available: runtime.payouts_available,
    }),
  });
}

export function createD1CustomerReferralStore(db) {
  if (!db?.prepare) throw new Error("customer_referral_store_unavailable");
  return Object.freeze({
    async getDashboard(userId) {
      return db.prepare(`
        SELECT u.user_id, u.username,
          c.referral_code, c.state AS referral_code_state, c.created_at AS code_created_at,
          own_attribution.attribution_id, own_attribution.attributed_at,
          (SELECT COUNT(*) FROM ravenos_referral_attributions invited
            WHERE invited.referrer_user_id = u.user_id) AS referred_accounts,
          (SELECT COUNT(*) FROM ravenos_referral_attributions invited
            WHERE invited.referrer_user_id = u.user_id
              AND COALESCE((
                SELECT evidence.event_type FROM ravenos_referral_subscription_evidence evidence
                WHERE evidence.attribution_id = invited.attribution_id
                ORDER BY evidence.effective_at DESC, evidence.event_id DESC LIMIT 1
              ), '') IN ('pro_subscription_activated', 'pro_subscription_renewed')
          ) AS qualified_pro_subscriptions
        FROM ravenos_users u
        LEFT JOIN ravenos_referral_codes c ON c.user_id = u.user_id AND c.state = 'active'
        LEFT JOIN ravenos_referral_attributions own_attribution ON own_attribution.referred_user_id = u.user_id
        WHERE u.user_id = ? AND u.state = 'active' LIMIT 1
      `).bind(userId).first();
    },

    async createCode(record) {
      return db.prepare(`
        INSERT INTO ravenos_referral_codes (
          user_id, referral_code, state, code_digest, created_at, updated_at
        ) SELECT ?, ?, 'active', ?, ?, ?
        FROM ravenos_users
        WHERE user_id = ? AND state = 'active' AND username IS NOT NULL
        ON CONFLICT(user_id) DO NOTHING
        RETURNING *
      `).bind(
        record.user_id, record.referral_code, record.code_digest, record.created_at, record.updated_at, record.user_id,
      ).first();
    },

    async resolveActiveCode(code) {
      return db.prepare(`
        SELECT c.user_id, c.referral_code
        FROM ravenos_referral_codes c
        JOIN ravenos_users u ON u.user_id = c.user_id
        WHERE c.referral_code = ? COLLATE NOCASE AND c.state = 'active' AND u.state = 'active'
        LIMIT 1
      `).bind(code).first();
    },

    async getAttributionForUser(userId) {
      return db.prepare(`
        SELECT attribution_id, referred_user_id, referrer_user_id, referral_code_snapshot, attributed_at
        FROM ravenos_referral_attributions
        WHERE referred_user_id = ? LIMIT 1
      `).bind(userId).first();
    },

    async insertAttribution(record) {
      const result = await db.prepare(`
        INSERT OR IGNORE INTO ravenos_referral_attributions (
          attribution_id, referred_user_id, referrer_user_id, referral_code_snapshot,
          attribution_method, attribution_digest, attributed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        record.attribution_id, record.referred_user_id, record.referrer_user_id, record.referral_code_snapshot,
        record.attribution_method, record.attribution_digest, record.attributed_at,
      ).run();
      return Number(result?.meta?.changes || 0) === 1;
    },

    async insertSubscriptionEvidence(record) {
      const result = await db.prepare(`
        INSERT OR IGNORE INTO ravenos_referral_subscription_evidence (
          event_id, attribution_id, event_type, source_contract_id, source_reference_digest,
          effective_at, observed_at, record_digest
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        record.event_id, record.attribution_id, record.event_type, record.source_contract_id,
        record.source_reference_digest, record.effective_at, record.observed_at, record.record_digest,
      ).run();
      return Number(result?.meta?.changes || 0) === 1;
    },

    async recordAudit({ user_id: userId, event_type: eventType, attribution_id: attributionId = null, now }) {
      const eventId = randomOpaqueId("rae_", 18);
      const eventDigest = await sha256(JSON.stringify({ event_id: eventId, user_id: userId, event_type: eventType, attribution_id: attributionId, created_at: now }));
      await db.prepare(`
        INSERT INTO ravenos_referral_audit_events (
          event_id, user_id, event_type, attribution_id, event_digest, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).bind(eventId, userId, eventType, attributionId, eventDigest, now).run();
    },
  });
}

function routeMatch(pathname) {
  if (pathname === `${CUSTOMER_REFERRAL_ROUTE}/me`) return { kind: "me" };
  if (pathname === `${CUSTOMER_REFERRAL_ROUTE}/code`) return { kind: "code" };
  if (pathname === `${CUSTOMER_REFERRAL_ROUTE}/claim`) return { kind: "claim" };
  return null;
}

function methodAllowed(route, method) {
  if (route.kind === "me") return method === "GET";
  return method === "PUT";
}

async function body(request) {
  try {
    return await parseBoundedJsonBody(request, { max_bytes: ReferralLimits.maximum_request_bytes });
  } catch (error) {
    if (error?.code === "request_too_large") throw new ReferralError("referral_request_too_large", 413);
    throw new ReferralError("referral_request_invalid");
  }
}

async function rateLimit(authorization, env, request, action) {
  return consumeCustomerRateLimit({
    store: authorization.store,
    env,
    request,
    action: `referral_${action}`,
    scope: "user",
    subject: authorization.principal.user_id,
    now: authorization.now,
    window_seconds: 15 * 60,
    limit: ReferralLimits.mutations_per_15_minutes,
  });
}

function errorResponse(error, authorization = null) {
  const code = error instanceof ReferralError ? error.code : "referral_unavailable";
  const status = error instanceof ReferralError ? error.status : 503;
  return json({ ok: false, schema_version: CUSTOMER_REFERRAL_SCHEMA, error: code }, {
    status,
    headers: authorization?.response_headers || null,
  });
}

export async function routeCustomerReferrals(request, env = {}, deps = {}) {
  const route = routeMatch(new URL(request.url).pathname);
  if (!route) return null;
  if (!methodAllowed(route, request.method)) return json({ ok: false, schema_version: CUSTOMER_REFERRAL_SCHEMA, error: "method_not_allowed" }, { status: 405 });
  const runtime = resolveReferralRuntime(env, deps);
  if (!runtime.enabled) return json({ ok: false, schema_version: CUSTOMER_REFERRAL_SCHEMA, error: runtime.reason, state: runtime.state }, { status: 503 });
  const store = deps.store || createD1CustomerReferralStore(env.RAVENOS_CUSTOMER_DB);
  let authorization = null;
  try {
    const authorize = deps.authorizeRequest || authorizeCustomerApiRequest;
    authorization = await authorize(request, env, deps, { require_csrf: request.method !== "GET" });
    if (authorization.response) return authorization.response;
    const userId = authorization.principal.user_id;

    if (route.kind === "me") {
      return json({ ok: true, referral: dashboard(await store.getDashboard(userId), runtime) }, { headers: authorization.response_headers });
    }

    const limited = await rateLimit(authorization, env, request, route.kind);
    if (!limited.allowed) throw new ReferralError("referral_rate_limited", 429);

    if (route.kind === "code") {
      exactObject(await body(request), new Set(), "referral_code_request_invalid");
      let current = await store.getDashboard(userId);
      if (!current) throw new ReferralError("referral_account_unavailable", 404);
      if (!current.username) throw new ReferralError("username_required", 409);
      if (!current.referral_code) {
        for (let attempt = 0; attempt < 3 && !current.referral_code; attempt += 1) {
          const record = await createReferralCodeRecord({ user_id: userId, code: createReferralCodeValue(), now: authorization.now });
          try {
            await store.createCode(record);
          } catch (error) {
            if (!/unique|constraint/i.test(String(error?.message || error))) throw error;
          }
          current = await store.getDashboard(userId);
        }
        if (!current?.referral_code) throw new ReferralError("referral_code_generation_failed", 503);
        await store.recordAudit({ user_id: userId, event_type: "referral_code_created", now: authorization.now });
      }
      return json({ ok: true, referral: dashboard(current, runtime) }, { headers: authorization.response_headers });
    }

    const payload = exactObject(await body(request), new Set(["referral_code"]), "referral_claim_request_invalid");
    const code = normalizeReferralCode(payload.referral_code);
    const referrer = await store.resolveActiveCode(code);
    if (!referrer) throw new ReferralError("referral_code_not_found", 404);
    if (referrer.user_id === userId) throw new ReferralError("self_referral_not_allowed", 409);
    const existing = await store.getAttributionForUser(userId);
    if (existing) {
      if (existing.referrer_user_id !== referrer.user_id) throw new ReferralError("referral_already_attributed", 409);
      return json({ ok: true, idempotent: true, referral: dashboard(await store.getDashboard(userId), runtime) }, { headers: authorization.response_headers });
    }
    const attribution = await createReferralAttributionRecord({
      referred_user_id: userId,
      referrer_user_id: referrer.user_id,
      referral_code: code,
      now: authorization.now,
    });
    const inserted = await store.insertAttribution(attribution);
    const resolved = inserted ? attribution : await store.getAttributionForUser(userId);
    if (!resolved || resolved.referrer_user_id !== referrer.user_id) throw new ReferralError("referral_already_attributed", 409);
    await store.recordAudit({ user_id: userId, event_type: "referral_attributed", attribution_id: resolved.attribution_id, now: authorization.now });
    return json({ ok: true, idempotent: !inserted, referral: dashboard(await store.getDashboard(userId), runtime) }, { headers: authorization.response_headers });
  } catch (error) {
    return errorResponse(error, authorization);
  }
}

export const CustomerReferralContract = Object.freeze({
  schema_version: CUSTOMER_REFERRAL_SCHEMA,
  attribution: "immutable_once_recorded",
  referral_code_contains_public_identity: false,
  browser_storage_state_permitted: false,
  authoritative_pro_subscription_evidence_required: true,
  customer_claim_can_create_entitlement: false,
  customer_claim_can_create_credit: false,
  reward_policy_configured: false,
  payouts_available: false,
  trading_performance_affects_reward: false,
  trade_volume_affects_reward: false,
  investment_endorsement: false,
  execution_authority: false,
});
