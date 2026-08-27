import {
  authorizeCustomerApiRequest,
  consumeCustomerRateLimit,
  randomOpaqueId,
  sha256,
} from "./customer_identity.mjs";
import {
  buildSavedMarketTerminalUrl,
  canonicalizeSavedMarket,
} from "./customer_research_state.mjs";
import {
  createD1CustomerEntitlementStore,
  resolveCapabilityAccess,
  resolveEntitlementFeatureFlags,
} from "./customer_entitlements.mjs";
import {
  boundedJsonResponse,
  parseBoundedJsonBody,
} from "./customer_trade/terminal_runtime.mjs";

export const CUSTOMER_MONITOR_ALERTS_ROUTE = "/api/v1/monitor-alerts";
export const CUSTOMER_MONITOR_RULE_SCHEMA = "ravenos.monitor_rule.v1";
export const CUSTOMER_NOTIFICATION_EVENT_SCHEMA = "ravenos.notification_event.v1";
export const CUSTOMER_MONITOR_ALERTS_SCHEMA = "ravenos.monitor_alerts.v1";
export const CUSTOMER_MONITOR_EVIDENCE_SCHEMA = "ravenos.monitor_evidence.v1";

export const CustomerMonitorAlertLimits = Object.freeze({
  maximum_request_bytes: 8 * 1024,
  maximum_response_bytes: 256 * 1024,
  maximum_monitor_rules: 100,
  maximum_event_types_per_rule: 10,
  maximum_notification_history: 1_000,
  maximum_notification_page: 200,
  notification_retention_days: 90,
  cooldown_seconds: 15 * 60,
  cadence_seconds: 5 * 60,
  evaluator_batch_size: 100,
  evaluator_max_notifications: 250,
  evaluator_lease_seconds: 4 * 60,
  rule_reads_per_15_minutes: 120,
  rule_mutations_per_15_minutes: 60,
  notification_reads_per_15_minutes: 120,
  notification_mutations_per_15_minutes: 120,
});

export const CustomerMonitorEventTypes = Object.freeze([
  "setup_state_changed",
  "evidence_strengthened",
  "evidence_weakened",
  "evidence_invalid_or_unavailable",
  "pressure_regime_changed",
  "funding_regime_changed",
  "liquidity_quality_changed",
  "attention_state_changed",
  "launch_lifecycle_changed",
  "exact_market_availability_changed",
]);

const EVENT_TYPES = new Set(CustomerMonitorEventTypes);
const APP_ORIGIN = "https://app.ravenos.xyz";
const RULE_STATES = new Set(["active", "paused"]);
const CLASSIFICATION_FIELDS = Object.freeze([
  "setup_state",
  "evidence_strength",
  "pressure_regime",
  "funding_regime",
  "liquidity_quality",
  "attention_state",
  "launch_lifecycle",
  "availability_state",
]);
const EVIDENCE_STRENGTH = Object.freeze(["unavailable", "invalid", "weak", "forming", "developing", "qualified", "strong"]);
const LIQUIDITY_STRENGTH = Object.freeze(["unavailable", "unrouteable", "thin", "limited", "usable", "healthy", "deep"]);
const textEncoder = new TextEncoder();

function text(value, maximum = 240) {
  return String(value ?? "").trim().slice(0, maximum);
}

function plainText(value, maximum = 160) {
  return text(value, maximum)
    .replace(/[<>]/g, "")
    .replace(/\bon[a-z]+\s*=/gi, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function exactObject(value, allowed, code = "monitor_request_invalid") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CustomerMonitorError(code);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new CustomerMonitorError(code);
  return value;
}

function iso(seconds) {
  const number = Number(seconds);
  return Number.isSafeInteger(number) && number >= 0 ? new Date(number * 1000).toISOString() : null;
}

function parseJsonObject(value, code = "stored_monitor_state_invalid") {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(code);
    return parsed;
  } catch {
    throw new CustomerMonitorError(code);
  }
}

function parseJsonArray(value, code = "stored_monitor_state_invalid") {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    if (!Array.isArray(parsed)) throw new Error(code);
    return parsed;
  } catch {
    throw new CustomerMonitorError(code);
  }
}

function flag(value) {
  return String(value || "") === "1";
}

export function resolveMonitorAlertFlags(env = {}) {
  return Object.freeze({
    entitlement_resolution: flag(env.RAVENOS_ENTITLEMENT_RESOLUTION_ENABLE),
    capability: flag(env.RAVENOS_RESEARCH_ALERTS_ENABLE),
    customer_rule_routes: flag(env.RAVENOS_RESEARCH_ALERT_RULE_ROUTES_ENABLE),
    evaluation: flag(env.RAVENOS_RESEARCH_ALERT_EVALUATION_ENABLE),
    notification_history: flag(env.RAVENOS_NOTIFICATION_HISTORY_ENABLE),
  });
}

export function resolveMonitorAlertActivation(env = {}) {
  const flags = resolveMonitorAlertFlags(env);
  return Object.freeze({
    rules: flags.entitlement_resolution && flags.capability && flags.customer_rule_routes,
    notifications: flags.entitlement_resolution && flags.capability && flags.customer_rule_routes && flags.notification_history,
    evaluator: flags.entitlement_resolution && flags.capability && flags.customer_rule_routes && flags.evaluation && flags.notification_history,
  });
}

export class CustomerMonitorError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "CustomerMonitorError";
    this.code = code;
  }
}

function normalizeEventTypes(input, supported = CustomerMonitorEventTypes) {
  if (!Array.isArray(input) || input.length < 1 || input.length > CustomerMonitorAlertLimits.maximum_event_types_per_rule) {
    throw new CustomerMonitorError("monitor_event_types_invalid");
  }
  const allowed = new Set(supported);
  const output = [];
  for (const item of input) {
    const eventType = text(item, 80);
    if (!EVENT_TYPES.has(eventType) || !allowed.has(eventType)) throw new CustomerMonitorError("monitor_event_type_unsupported");
    if (!output.includes(eventType)) output.push(eventType);
  }
  if (!output.length) throw new CustomerMonitorError("monitor_event_types_invalid");
  return Object.freeze(output.sort());
}

function eventTypesForEvidence(evidence) {
  const fields = evidence?.classifications || {};
  const output = [];
  if (fields.setup_state) output.push("setup_state_changed");
  if (fields.evidence_strength) output.push("evidence_strengthened", "evidence_weakened", "evidence_invalid_or_unavailable");
  if (fields.pressure_regime) output.push("pressure_regime_changed");
  if (fields.funding_regime) output.push("funding_regime_changed");
  if (fields.liquidity_quality) output.push("liquidity_quality_changed");
  if (fields.attention_state) output.push("attention_state_changed");
  if (fields.launch_lifecycle) output.push("launch_lifecycle_changed");
  if (fields.availability_state) output.push("exact_market_availability_changed");
  return Object.freeze(output);
}

function normalizeClassification(value) {
  return plainText(value, 80).toLowerCase() || null;
}

export function normalizeMonitorEvidence(input, { expected_instrument_id: expectedInstrumentId, now } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return Object.freeze({ qualified: false, reason: "evidence_malformed" });
  const instrumentId = text(input.instrument_id, 220);
  const expected = text(expectedInstrumentId, 220);
  if (!instrumentId || (expected && instrumentId !== expected)) return Object.freeze({ qualified: false, reason: "evidence_lineage_mismatch" });
  const sourceTimestamp = Number(input.source_timestamp);
  const current = Number(now);
  if (!Number.isSafeInteger(sourceTimestamp) || sourceTimestamp < 0 || !Number.isSafeInteger(current) || current < sourceTimestamp) {
    return Object.freeze({ qualified: false, reason: "evidence_timestamp_invalid" });
  }
  const sourceState = text(input.source_state, 30).toLowerCase();
  if (sourceState !== "qualified") return Object.freeze({ qualified: false, reason: sourceState === "stale" ? "evidence_stale" : "evidence_unqualified" });
  const maximumAge = Number(input.maximum_age_seconds || 3600);
  if (!Number.isSafeInteger(maximumAge) || maximumAge < 60 || current - sourceTimestamp > maximumAge) {
    return Object.freeze({ qualified: false, reason: "evidence_stale" });
  }
  const evidenceRole = text(input.evidence_role, 40).toLowerCase();
  if (!new Set(["market_fact", "raven_measurement", "raven_interpretation"]).has(evidenceRole)) {
    return Object.freeze({ qualified: false, reason: "evidence_role_invalid" });
  }
  const raw = input.classifications;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return Object.freeze({ qualified: false, reason: "evidence_malformed" });
  const classifications = {};
  for (const field of CLASSIFICATION_FIELDS) {
    const value = normalizeClassification(raw[field]);
    if (value) classifications[field] = value;
  }
  if (!Object.keys(classifications).length) return Object.freeze({ qualified: false, reason: "evidence_empty" });
  const limitations = Array.isArray(input.limitations)
    ? input.limitations.slice(0, 6).map((item) => plainText(item, 160)).filter(Boolean)
    : [];
  return Object.freeze({
    qualified: true,
    schema_version: CUSTOMER_MONITOR_EVIDENCE_SCHEMA,
    instrument_id: instrumentId,
    source_timestamp: sourceTimestamp,
    source_kind: plainText(input.source_kind, 60) || "raven_public_safe_projection",
    evidence_role: evidenceRole,
    classifications: Object.freeze(classifications),
    limitations: Object.freeze(limitations),
  });
}

function rank(values, value) {
  const normalized = normalizeClassification(value);
  return values.indexOf(normalized);
}

function transition(field, eventType, before, after) {
  return Object.freeze({ field, event_type: eventType, before, after });
}

export function compareMonitorEvidence(beforeInput, afterInput, selectedEventTypes = CustomerMonitorEventTypes) {
  const selected = new Set(selectedEventTypes);
  const before = beforeInput?.classifications || {};
  const after = afterInput?.classifications || {};
  const changes = [];
  const changed = (field) => before[field] && after[field] && before[field] !== after[field];
  if (changed("setup_state") && selected.has("setup_state_changed")) changes.push(transition("setup_state", "setup_state_changed", before.setup_state, after.setup_state));
  if (changed("pressure_regime") && selected.has("pressure_regime_changed")) changes.push(transition("pressure_regime", "pressure_regime_changed", before.pressure_regime, after.pressure_regime));
  if (changed("funding_regime") && selected.has("funding_regime_changed")) changes.push(transition("funding_regime", "funding_regime_changed", before.funding_regime, after.funding_regime));
  if (changed("liquidity_quality") && selected.has("liquidity_quality_changed")) changes.push(transition("liquidity_quality", "liquidity_quality_changed", before.liquidity_quality, after.liquidity_quality));
  if (changed("attention_state") && selected.has("attention_state_changed")) changes.push(transition("attention_state", "attention_state_changed", before.attention_state, after.attention_state));
  if (changed("launch_lifecycle") && selected.has("launch_lifecycle_changed")) changes.push(transition("launch_lifecycle", "launch_lifecycle_changed", before.launch_lifecycle, after.launch_lifecycle));
  if (changed("availability_state") && selected.has("exact_market_availability_changed")) changes.push(transition("availability_state", "exact_market_availability_changed", before.availability_state, after.availability_state));
  if (changed("evidence_strength")) {
    const oldRank = rank(EVIDENCE_STRENGTH, before.evidence_strength);
    const nextRank = rank(EVIDENCE_STRENGTH, after.evidence_strength);
    if (["invalid", "unavailable"].includes(after.evidence_strength) && selected.has("evidence_invalid_or_unavailable")) {
      changes.push(transition("evidence_strength", "evidence_invalid_or_unavailable", before.evidence_strength, after.evidence_strength));
    } else if (oldRank >= 0 && nextRank > oldRank && selected.has("evidence_strengthened")) {
      changes.push(transition("evidence_strength", "evidence_strengthened", before.evidence_strength, after.evidence_strength));
    } else if (oldRank >= 0 && nextRank >= 0 && nextRank < oldRank && selected.has("evidence_weakened")) {
      changes.push(transition("evidence_strength", "evidence_weakened", before.evidence_strength, after.evidence_strength));
    }
  }
  return Object.freeze(changes);
}

function humanLabel(value) {
  return plainText(value, 80).replace(/_/g, " ");
}

function transitionExplanation(change) {
  const before = humanLabel(change.before);
  const after = humanLabel(change.after);
  if (change.event_type === "evidence_strengthened") return "Raven evidence strengthened.";
  if (change.event_type === "evidence_weakened") return "Raven evidence weakened.";
  if (change.event_type === "evidence_invalid_or_unavailable") return "Raven evidence became invalid or unavailable.";
  if (change.event_type === "pressure_regime_changed") return `Pressure changed from ${before} to ${after}.`;
  if (change.event_type === "funding_regime_changed") return `Funding changed from ${before} to ${after}.`;
  if (change.event_type === "liquidity_quality_changed") {
    const beforeRank = rank(LIQUIDITY_STRENGTH, before);
    const afterRank = rank(LIQUIDITY_STRENGTH, after);
    const direction = beforeRank >= 0 && afterRank >= 0 && afterRank < beforeRank ? "deteriorated" : beforeRank >= 0 && afterRank > beforeRank ? "recovered" : "changed";
    return `Liquidity quality ${direction} from ${before} to ${after}.`;
  }
  if (change.event_type === "attention_state_changed") return `Attention changed from ${before} to ${after}.`;
  if (change.event_type === "launch_lifecycle_changed") return `Launch lifecycle changed from ${before} to ${after}.`;
  if (change.event_type === "exact_market_availability_changed" && ["unavailable", "superseded"].includes(change.after)) return "This exact market is no longer available.";
  return `Raven setup changed from ${before} to ${after}.`;
}

function monitorFlagsUnavailable(route, activation) {
  if (route.kind.startsWith("notification") && !activation.notifications) return "notification_history_unavailable";
  if (!activation.rules) return "raven_monitor_beta_unavailable";
  return null;
}

function routeMatch(pathname) {
  if (pathname === CUSTOMER_MONITOR_ALERTS_ROUTE) return { kind: "summary" };
  if (pathname === `${CUSTOMER_MONITOR_ALERTS_ROUTE}/rules`) return { kind: "rules" };
  const rule = pathname.match(/^\/api\/v1\/monitor-alerts\/rules\/([^/]+)$/);
  if (rule) return { kind: "rule", rule_id: rule[1] };
  if (pathname === `${CUSTOMER_MONITOR_ALERTS_ROUTE}/notifications`) return { kind: "notifications" };
  const notification = pathname.match(/^\/api\/v1\/monitor-alerts\/notifications\/([^/]+)\/read$/);
  if (notification) return { kind: "notification_read", notification_id: notification[1] };
  return null;
}

function methodAllowed(route, method) {
  return (route.kind === "summary" && (method === "GET" || method === "DELETE"))
    || (route.kind === "rules" && (method === "GET" || method === "POST"))
    || (route.kind === "rule" && (method === "PATCH" || method === "DELETE"))
    || (route.kind === "notifications" && (method === "GET" || method === "DELETE"))
    || (route.kind === "notification_read" && method === "POST");
}

function sameOriginBoundary(request) {
  const url = new URL(request.url);
  if (url.origin !== APP_ORIGIN || url.search || url.hash) return false;
  const suppliedOrigin = text(request.headers.get("origin"), 300);
  const referer = text(request.headers.get("referer"), 500);
  const fetchSite = text(request.headers.get("sec-fetch-site"), 32).toLowerCase();
  if (fetchSite !== "same-origin") return false;
  if (suppliedOrigin) return suppliedOrigin === APP_ORIGIN;
  try { return new URL(referer).origin === APP_ORIGIN; } catch { return false; }
}

function privateJson(payload, init = {}, authorization = null) {
  const headers = new Headers(init.headers || undefined);
  headers.set("cache-control", "private, no-store, max-age=0");
  headers.set("pragma", "no-cache");
  headers.set("vary", "Cookie, Origin");
  headers.set("x-content-type-options", "nosniff");
  const setCookie = authorization?.response_headers?.get("set-cookie");
  if (setCookie) headers.append("set-cookie", setCookie);
  return boundedJsonResponse(payload, { ...init, headers }, {
    max_bytes: CustomerMonitorAlertLimits.maximum_response_bytes,
    fallback_payload: { ok: false, schema_version: CUSTOMER_MONITOR_ALERTS_SCHEMA, error: "monitor_response_too_large" },
  });
}

async function parseBody(request) {
  try {
    return await parseBoundedJsonBody(request, { max_bytes: CustomerMonitorAlertLimits.maximum_request_bytes });
  } catch (error) {
    if (error?.code === "request_too_large") throw new CustomerMonitorError("monitor_request_too_large");
    throw new CustomerMonitorError("monitor_request_invalid");
  }
}

function opaqueId(value, prefix, code) {
  const output = text(value, 100);
  if (!new RegExp(`^${prefix}[A-Za-z0-9_-]{12,80}$`).test(output)) throw new CustomerMonitorError(code);
  return output;
}

function workspaceFromRow(row) {
  return {
    schema_version: "ravenos.saved_workspace.v1",
    timeframe: text(row.timeframe, 8) || "1h",
    indicators: parseJsonArray(row.indicators_json).slice(0, 6),
    raven_overlays: parseJsonArray(row.raven_overlays_json).slice(0, 12),
    density: text(row.density, 20) || "comfortable",
    selected_panel: text(row.selected_panel, 20) || "chart",
  };
}

function marketFromRow(row) {
  return {
    instrument_id: text(row.instrument_id, 220),
    instrument_type: text(row.instrument_type, 40),
    identity_scope: text(row.identity_scope, 40),
    asset_class: text(row.asset_class, 20),
    chain: text(row.chain_id, 40) || null,
    venue: text(row.venue_id, 40),
    market: text(row.market_type, 30),
    base_symbol: plainText(row.base_symbol, 32) || null,
    quote_symbol: plainText(row.quote_symbol, 32) || null,
    display_label: plainText(row.display_label, 120) || "Exact market",
  };
}

function publicRule(row) {
  const market = marketFromRow(row);
  const workspace = workspaceFromRow(row);
  const evidence = row.last_evidence_json ? parseJsonObject(row.last_evidence_json) : null;
  const eventTypes = parseJsonArray(row.event_types_json).filter((item) => EVENT_TYPES.has(item));
  return Object.freeze({
    rule_id: text(row.rule_id, 100),
    schema_version: CUSTOMER_MONITOR_RULE_SCHEMA,
    watch_id: text(row.watch_id, 100),
    market,
    event_types: eventTypes,
    state: RULE_STATES.has(row.state) ? row.state : "paused",
    cadence: "standard",
    cooldown_seconds: Number(row.cooldown_seconds),
    last_qualified_evaluation_at: iso(row.last_source_timestamp),
    last_observed_evidence: evidence ? {
      classifications: Object.fromEntries(CLASSIFICATION_FIELDS.filter((field) => evidence.classifications?.[field]).map((field) => [field, plainText(evidence.classifications[field], 80)])),
      evidence_role: plainText(evidence.evidence_role, 40) || "raven_measurement",
      limitations: Array.isArray(evidence.limitations) ? evidence.limitations.slice(0, 6).map((item) => plainText(item, 160)).filter(Boolean) : [],
    } : null,
    next_eligible_evaluation_at: iso(row.next_eligible_evaluation_at),
    revision: Number(row.revision),
    terminal_url: buildSavedMarketTerminalUrl({ market, workspace }),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  });
}

function publicNotification(row) {
  const before = parseJsonObject(row.before_state_json);
  const after = parseJsonObject(row.after_state_json);
  const limitations = parseJsonArray(row.limitations_json).slice(0, 6).map((item) => plainText(item, 160)).filter(Boolean);
  const context = parseJsonObject(row.deep_link_context_json);
  const market = marketFromRow(row);
  const workspace = workspaceFromRow(row);
  return Object.freeze({
    notification_id: text(row.notification_id, 100),
    schema_version: CUSTOMER_NOTIFICATION_EVENT_SCHEMA,
    rule_id: text(row.rule_id, 100),
    market,
    event_type: EVENT_TYPES.has(row.event_type) ? row.event_type : "evidence_invalid_or_unavailable",
    before: { field: plainText(before.field, 60), value: plainText(before.value, 80) },
    after: { field: plainText(after.field, 60), value: plainText(after.value, 80) },
    explanation: plainText(row.explanation, 240),
    evidence_role: plainText(row.evidence_role, 40),
    limitations,
    source_as_of: iso(row.qualified_source_timestamp),
    detected_at: iso(row.detected_at),
    read_at: iso(row.read_at),
    retention_expires_at: iso(row.retention_expires_at),
    terminal_url: context.instrument_id === market.instrument_id ? buildSavedMarketTerminalUrl({ market, workspace }) : null,
  });
}

export function createD1CustomerMonitorAlertStore(db) {
  if (!db?.prepare) throw new Error("customer_monitor_database_required");
  return Object.freeze({
    async getWatchOwned(userId, watchId) {
      return db.prepare("SELECT * FROM ravenos_customer_watch_items WHERE user_id = ? AND watch_id = ? LIMIT 1").bind(userId, watchId).first();
    },
    async listRules(userId) {
      const result = await db.prepare(`
        SELECT r.*, w.instrument_type, w.identity_scope, w.asset_class, w.market_type, w.base_symbol, w.quote_symbol, w.display_label,
          w.timeframe, w.indicators_json, w.raven_overlays_json, w.density, w.selected_panel, w.availability_state, w.availability_checked_at
        FROM ravenos_customer_monitor_rules r
        JOIN ravenos_customer_watch_items w ON w.watch_id = r.watch_id AND w.user_id = r.user_id
        WHERE r.user_id = ? ORDER BY r.updated_at DESC, r.rule_id ASC LIMIT 100
      `).bind(userId).all();
      if (!Array.isArray(result?.results)) throw new Error("monitor_rule_query_failed");
      return result.results;
    },
    async getRuleOwned(userId, ruleId) {
      return db.prepare(`
        SELECT r.*, w.instrument_type, w.identity_scope, w.asset_class, w.market_type, w.base_symbol, w.quote_symbol, w.display_label,
          w.timeframe, w.indicators_json, w.raven_overlays_json, w.density, w.selected_panel, w.availability_state, w.availability_checked_at
        FROM ravenos_customer_monitor_rules r
        JOIN ravenos_customer_watch_items w ON w.watch_id = r.watch_id AND w.user_id = r.user_id
        WHERE r.user_id = ? AND r.rule_id = ? LIMIT 1
      `).bind(userId, ruleId).first();
    },
    async getRuleByWatch(userId, watchId) {
      return db.prepare("SELECT * FROM ravenos_customer_monitor_rules WHERE user_id = ? AND watch_id = ? LIMIT 1").bind(userId, watchId).first();
    },
    async createRule({ rule_id: ruleId, user_id: userId, watch, event_types: eventTypes, evidence, now }) {
      const existing = await this.getRuleByWatch(userId, watch.watch_id);
      if (existing) return { row: await this.getRuleOwned(userId, existing.rule_id), created: false };
      try {
        await db.prepare(`
          INSERT INTO ravenos_customer_monitor_rules (
            rule_id, schema_version, user_id, watch_id, instrument_id, chain_id, venue_id, exact_market_identity,
            event_types_json, state, cadence_class, cooldown_seconds, last_source_timestamp, last_evidence_json,
            next_eligible_evaluation_at, revision, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'standard', ?, ?, ?, ?, 1, ?, ?)
        `).bind(
          ruleId, CUSTOMER_MONITOR_RULE_SCHEMA, userId, watch.watch_id, watch.instrument_id, watch.chain_id, watch.venue_id,
          watch.instrument_id, JSON.stringify(eventTypes), CustomerMonitorAlertLimits.cooldown_seconds, evidence.source_timestamp,
          JSON.stringify(evidence), now + CustomerMonitorAlertLimits.cadence_seconds, now, now,
        ).run();
      } catch (error) {
        if (String(error?.message || error).includes("monitor_rule_quota_exceeded")) throw new CustomerMonitorError("monitor_rule_quota_exceeded");
        const raced = await this.getRuleByWatch(userId, watch.watch_id);
        if (!raced) throw error;
        return { row: await this.getRuleOwned(userId, raced.rule_id), created: false };
      }
      return { row: await this.getRuleOwned(userId, ruleId), created: true };
    },
    async updateRule(userId, ruleId, { state, event_types: eventTypes, expected_revision: expectedRevision, now }) {
      const result = await db.prepare(`
        UPDATE ravenos_customer_monitor_rules SET state = ?, event_types_json = ?, revision = revision + 1, updated_at = ?
        WHERE user_id = ? AND rule_id = ? AND revision = ? RETURNING rule_id
      `).bind(state, JSON.stringify(eventTypes), now, userId, ruleId, expectedRevision).first();
      return result ? this.getRuleOwned(userId, ruleId) : null;
    },
    async deleteRule(userId, ruleId) {
      const result = await db.prepare("DELETE FROM ravenos_customer_monitor_rules WHERE user_id = ? AND rule_id = ?").bind(userId, ruleId).run();
      return Number(result?.meta?.changes || 0);
    },
    async listNotifications(userId, now) {
      const result = await db.prepare(`
        SELECT n.*, w.instrument_type, w.identity_scope, w.asset_class, w.chain_id, w.venue_id, w.market_type, w.base_symbol, w.quote_symbol,
          w.display_label, w.timeframe, w.indicators_json, w.raven_overlays_json, w.density, w.selected_panel
        FROM ravenos_customer_notification_events n
        JOIN ravenos_customer_monitor_rules r ON r.rule_id = n.rule_id AND r.user_id = n.user_id
        JOIN ravenos_customer_watch_items w ON w.watch_id = r.watch_id AND w.user_id = n.user_id
        WHERE n.user_id = ? AND n.retention_expires_at > ?
        ORDER BY n.detected_at DESC, n.notification_id ASC LIMIT ?
      `).bind(userId, now, CustomerMonitorAlertLimits.maximum_notification_page).all();
      if (!Array.isArray(result?.results)) throw new Error("notification_query_failed");
      return result.results;
    },
    async markNotificationRead(userId, notificationId, now) {
      return db.prepare(`
        UPDATE ravenos_customer_notification_events SET read_at = COALESCE(read_at, ?)
        WHERE user_id = ? AND notification_id = ? AND retention_expires_at > ? RETURNING notification_id
      `).bind(now, userId, notificationId, now).first();
    },
    async deleteNotificationHistory(userId) {
      const result = await db.prepare("DELETE FROM ravenos_customer_notification_events WHERE user_id = ?").bind(userId).run();
      return Number(result?.meta?.changes || 0);
    },
    async deleteAllOwned(userId) {
      const notifications = await this.deleteNotificationHistory(userId);
      const rulesResult = await db.prepare("DELETE FROM ravenos_customer_monitor_rules WHERE user_id = ?").bind(userId).run();
      return { notifications, rules: Number(rulesResult?.meta?.changes || 0) };
    },
    async acquireLease(token, now) {
      await db.prepare(`INSERT OR IGNORE INTO ravenos_monitor_evaluator_leases (lease_key, lease_token, lease_expires_at, cursor_rule_id, revision, updated_at) VALUES ('raven_monitor_v1', NULL, NULL, NULL, 1, ?)`)
        .bind(now).run();
      await db.prepare(`
        UPDATE ravenos_monitor_evaluator_leases SET lease_token = ?, lease_expires_at = ?, revision = revision + 1, updated_at = ?
        WHERE lease_key = 'raven_monitor_v1' AND (lease_token = ? OR lease_expires_at IS NULL OR lease_expires_at <= ?)
      `).bind(token, now + CustomerMonitorAlertLimits.evaluator_lease_seconds, now, token, now).run();
      const row = await db.prepare("SELECT lease_token, cursor_rule_id FROM ravenos_monitor_evaluator_leases WHERE lease_key = 'raven_monitor_v1'").first();
      return row?.lease_token === token ? { acquired: true, cursor: text(row.cursor_rule_id, 100) || null } : { acquired: false, cursor: null };
    },
    async listDueRules(now, cursor) {
      const result = await db.prepare(`
        SELECT r.*, w.instrument_type, w.identity_scope, w.asset_class, w.market_type, w.base_symbol, w.quote_symbol, w.display_label,
          w.timeframe, w.indicators_json, w.raven_overlays_json, w.density, w.selected_panel, w.availability_state, w.availability_reason, w.availability_checked_at
        FROM ravenos_customer_monitor_rules r
        JOIN ravenos_customer_watch_items w ON w.watch_id = r.watch_id AND w.user_id = r.user_id
        WHERE r.state = 'active' AND r.next_eligible_evaluation_at <= ? AND r.rule_id > ?
          AND EXISTS (
            SELECT 1 FROM ravenos_customer_entitlement_grants g
            WHERE g.user_id = r.user_id AND g.capability_key = 'research.alerts' AND g.state = 'active'
              AND (g.activation_at IS NULL OR g.activation_at <= ?) AND (g.expires_at IS NULL OR g.expires_at > ?)
          )
        ORDER BY r.rule_id ASC LIMIT ?
      `).bind(now, cursor || "", now, now, CustomerMonitorAlertLimits.evaluator_batch_size).all();
      if (!Array.isArray(result?.results)) throw new Error("monitor_evaluator_query_failed");
      return result.results;
    },
    async latestNotificationAt(ruleId, eventType) {
      const row = await db.prepare("SELECT detected_at FROM ravenos_customer_notification_events WHERE rule_id = ? AND event_type = ? ORDER BY detected_at DESC LIMIT 1")
        .bind(ruleId, eventType).first();
      return Number(row?.detected_at || 0);
    },
    async deleteExpiredNotifications(now) {
      const result = await db.prepare("DELETE FROM ravenos_customer_notification_events WHERE retention_expires_at <= ?").bind(now).run();
      return Number(result?.meta?.changes || 0);
    },
    async notificationCount(userId, now) {
      const row = await db.prepare("SELECT COUNT(*) AS count FROM ravenos_customer_notification_events WHERE user_id = ? AND retention_expires_at > ?").bind(userId, now).first();
      return Number(row?.count || 0);
    },
    async insertNotification(record) {
      const result = await db.prepare(`
        INSERT OR IGNORE INTO ravenos_customer_notification_events (
          notification_id, schema_version, user_id, rule_id, instrument_id, event_type, before_state_json, after_state_json,
          qualified_source_timestamp, detected_at, dedupe_key, explanation, evidence_role, limitations_json,
          deep_link_context_json, read_at, retention_expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
      `).bind(
        record.notification_id, CUSTOMER_NOTIFICATION_EVENT_SCHEMA, record.user_id, record.rule_id, record.instrument_id, record.event_type,
        JSON.stringify(record.before_state), JSON.stringify(record.after_state), record.source_timestamp, record.detected_at, record.dedupe_key,
        record.explanation, record.evidence_role, JSON.stringify(record.limitations), JSON.stringify(record.deep_link_context), record.retention_expires_at,
      ).run();
      return Number(result?.meta?.changes || 0) > 0;
    },
    async commitEvaluation(ruleId, previousSourceTimestamp, evidence, now) {
      const result = await db.prepare(`
        UPDATE ravenos_customer_monitor_rules SET last_source_timestamp = ?, last_evidence_json = ?, next_eligible_evaluation_at = ?, updated_at = ?
        WHERE rule_id = ? AND (last_source_timestamp IS NULL OR last_source_timestamp = ?)
      `).bind(evidence.source_timestamp, JSON.stringify(evidence), now + CustomerMonitorAlertLimits.cadence_seconds, now, ruleId, previousSourceTimestamp).run();
      return Number(result?.meta?.changes || 0) > 0;
    },
    async releaseLease(token, cursor, now) {
      await db.prepare(`
        UPDATE ravenos_monitor_evaluator_leases SET lease_token = NULL, lease_expires_at = NULL, cursor_rule_id = ?, revision = revision + 1, updated_at = ?
        WHERE lease_key = 'raven_monitor_v1' AND lease_token = ?
      `).bind(cursor || null, now, token).run();
    },
  });
}

function storeFrom(env, deps) {
  return deps.monitorStore || createD1CustomerMonitorAlertStore(env.RAVENOS_CUSTOMER_DB);
}

async function authorizeCapability(request, env, deps, mutation) {
  const authorize = deps.authorizeRequest || authorizeCustomerApiRequest;
  const authorization = await authorize(request, env, deps.identity || {}, { require_csrf: mutation });
  if (authorization.response) return { authorization, response: authorization.response };
  const flags = resolveEntitlementFeatureFlags(env);
  let grants;
  try {
    const entitlementStore = deps.entitlementStore || createD1CustomerEntitlementStore(env.RAVENOS_CUSTOMER_DB);
    grants = await entitlementStore.listOwnedGrants(authorization.principal.user_id);
  } catch {
    return { authorization, response: privateJson({ ok: false, schema_version: CUSTOMER_MONITOR_ALERTS_SCHEMA, state: "unavailable", error: "entitlement_store_unavailable" }, { status: 503 }, authorization) };
  }
  const access = resolveCapabilityAccess({
    capability: "research.alerts",
    user_id: authorization.principal.user_id,
    grants,
    now: authorization.now,
    flags,
  });
  if (!access.available) {
    const status = ["not_granted", "expired", "revoked", "suspended", "not_yet_active"].includes(access.state) ? 403 : 503;
    return { authorization, access, response: privateJson({ ok: false, schema_version: CUSTOMER_MONITOR_ALERTS_SCHEMA, state: access.state, error: status === 403 ? "capability_not_authorized" : "capability_unavailable" }, { status }, authorization) };
  }
  return { authorization, access, response: null };
}

async function rateLimit(authorization, request, env, deps, scope, limit, mutation) {
  const consume = deps.consumeRateLimit || consumeCustomerRateLimit;
  return consume({
    store: authorization.store,
    env,
    request,
    action: "customer_monitor_alerts",
    scope,
    subject: authorization.principal.user_id,
    now: authorization.now,
    window_seconds: 15 * 60,
    limit,
    include_network: mutation,
  });
}

function responseError(error, authorization = null) {
  const code = error instanceof CustomerMonitorError ? error.code : "monitor_state_unavailable";
  const status = code === "monitor_request_too_large" ? 413
    : code === "monitor_rule_not_found" || code === "notification_not_found" || code === "saved_market_not_found" ? 404
      : code === "monitor_rule_revision_conflict" || code === "monitor_rule_quota_exceeded" || code === "notification_quota_exceeded" ? 409
        : code === "monitor_evidence_unavailable" || code === "monitor_state_unavailable" || code === "stored_monitor_state_invalid" ? 503
          : 400;
  return privateJson({ ok: false, schema_version: CUSTOMER_MONITOR_ALERTS_SCHEMA, error: code, state: "unavailable" }, { status }, authorization);
}

async function currentEvidence(deps, market, now) {
  if (typeof deps.resolveCurrentEvidence !== "function") throw new CustomerMonitorError("monitor_evidence_unavailable");
  let input;
  try { input = await deps.resolveCurrentEvidence(market); } catch { throw new CustomerMonitorError("monitor_evidence_unavailable"); }
  const evidence = normalizeMonitorEvidence(input, { expected_instrument_id: market.instrument_id, now });
  if (!evidence.qualified) throw new CustomerMonitorError("monitor_evidence_unavailable");
  return evidence;
}

export async function routeCustomerMonitorAlerts(request, env = {}, deps = {}) {
  const url = new URL(request.url);
  const route = routeMatch(url.pathname);
  if (!route) return null;
  if (!sameOriginBoundary(request)) return privateJson({ ok: false, schema_version: CUSTOMER_MONITOR_ALERTS_SCHEMA, error: "request_not_allowed" }, { status: 403 });
  if (!methodAllowed(route, request.method)) return privateJson({ ok: false, schema_version: CUSTOMER_MONITOR_ALERTS_SCHEMA, error: "method_not_allowed" }, { status: 405 });
  const mutation = request.method !== "GET";
  const authorized = await authorizeCapability(request, env, deps, mutation);
  if (authorized.response) return authorized.response;
  const activation = resolveMonitorAlertActivation(env);
  const disabled = monitorFlagsUnavailable(route, activation);
  if (disabled) return privateJson({ ok: false, schema_version: CUSTOMER_MONITOR_ALERTS_SCHEMA, error: disabled, state: "server_disabled" }, { status: 503 }, authorized.authorization);
  const userId = authorized.authorization.principal.user_id;
  const now = authorized.authorization.now;
  const store = storeFrom(env, deps);
  const ruleRoute = !route.kind.startsWith("notification");
  const limit = mutation
    ? (ruleRoute ? CustomerMonitorAlertLimits.rule_mutations_per_15_minutes : CustomerMonitorAlertLimits.notification_mutations_per_15_minutes)
    : (ruleRoute ? CustomerMonitorAlertLimits.rule_reads_per_15_minutes : CustomerMonitorAlertLimits.notification_reads_per_15_minutes);
  try {
    const limited = await rateLimit(authorized.authorization, request, env, deps, route.kind, limit, mutation);
    if (!limited.allowed) return privateJson({ ok: false, schema_version: CUSTOMER_MONITOR_ALERTS_SCHEMA, error: "monitor_rate_limited" }, { status: 429, headers: { "retry-after": String(limited.retry_after_seconds) } }, authorized.authorization);

    if (route.kind === "summary" && request.method === "GET") {
      return privateJson({
        ok: true,
        schema_version: CUSTOMER_MONITOR_ALERTS_SCHEMA,
        state: "available",
        capability: "research.alerts",
        limits: CustomerMonitorAlertLimits,
        supported_event_types: CustomerMonitorEventTypes,
        boundaries: { exact_identity_only: true, research_monitoring_only: true, in_app_only: true, plan_prices_stored: false, wallets: false, execution: false, provider_payloads_stored: false },
      }, {}, authorized.authorization);
    }

    if (route.kind === "rules" && request.method === "GET") {
      const rows = await store.listRules(userId);
      return privateJson({ ok: true, schema_version: CUSTOMER_MONITOR_ALERTS_SCHEMA, state: rows.length ? "available" : "empty", rules: rows.map(publicRule), limits: { maximum_monitor_rules: CustomerMonitorAlertLimits.maximum_monitor_rules, remaining: Math.max(0, CustomerMonitorAlertLimits.maximum_monitor_rules - rows.length) } }, {}, authorized.authorization);
    }

    if (route.kind === "rules" && request.method === "POST") {
      const body = exactObject(await parseBody(request), new Set(["watch_id", "event_types"]));
      const watchId = opaqueId(body.watch_id, "wat_", "saved_market_not_found");
      const watch = await store.getWatchOwned(userId, watchId);
      if (!watch) throw new CustomerMonitorError("saved_market_not_found");
      const market = canonicalizeSavedMarket({ instrument_id: watch.instrument_id });
      const evidence = await currentEvidence(deps, market, now);
      const supported = eventTypesForEvidence(evidence);
      const eventTypes = normalizeEventTypes(body.event_types, supported);
      const result = await store.createRule({ rule_id: randomOpaqueId("mon_", 18), user_id: userId, watch, event_types: eventTypes, evidence, now });
      return privateJson({ ok: true, schema_version: CUSTOMER_MONITOR_ALERTS_SCHEMA, created: result.created, rule: publicRule(result.row) }, { status: result.created ? 201 : 200 }, authorized.authorization);
    }

    if (route.kind === "rule" && request.method === "PATCH") {
      const ruleId = opaqueId(route.rule_id, "mon_", "monitor_rule_not_found");
      const current = await store.getRuleOwned(userId, ruleId);
      if (!current) throw new CustomerMonitorError("monitor_rule_not_found");
      const body = exactObject(await parseBody(request), new Set(["state", "event_types", "expected_revision"]));
      const expectedRevision = Number(body.expected_revision);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new CustomerMonitorError("monitor_rule_revision_invalid");
      const nextState = text(body.state || current.state, 20).toLowerCase();
      if (!RULE_STATES.has(nextState)) throw new CustomerMonitorError("monitor_rule_state_invalid");
      const existingEvidence = current.last_evidence_json ? parseJsonObject(current.last_evidence_json) : null;
      const supported = eventTypesForEvidence(existingEvidence);
      const eventTypes = body.event_types === undefined ? parseJsonArray(current.event_types_json) : normalizeEventTypes(body.event_types, supported);
      const updated = await store.updateRule(userId, ruleId, { state: nextState, event_types: eventTypes, expected_revision: expectedRevision, now });
      if (!updated) throw new CustomerMonitorError("monitor_rule_revision_conflict");
      return privateJson({ ok: true, schema_version: CUSTOMER_MONITOR_ALERTS_SCHEMA, rule: publicRule(updated) }, {}, authorized.authorization);
    }

    if (route.kind === "rule" && request.method === "DELETE") {
      const body = await parseBody(request);
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length) throw new CustomerMonitorError("monitor_request_invalid");
      const deleted = await store.deleteRule(userId, opaqueId(route.rule_id, "mon_", "monitor_rule_not_found"));
      return privateJson({ ok: true, schema_version: CUSTOMER_MONITOR_ALERTS_SCHEMA, deleted: deleted > 0 }, {}, authorized.authorization);
    }

    if (route.kind === "notifications" && request.method === "GET") {
      const rows = await store.listNotifications(userId, now);
      return privateJson({ ok: true, schema_version: CUSTOMER_MONITOR_ALERTS_SCHEMA, state: rows.length ? "available" : "empty", notifications: rows.map(publicNotification), limits: { maximum_history: CustomerMonitorAlertLimits.maximum_notification_history, returned: rows.length } }, {}, authorized.authorization);
    }

    if (route.kind === "notification_read") {
      const body = exactObject(await parseBody(request), new Set(["read"]));
      if (body.read !== true) throw new CustomerMonitorError("monitor_request_invalid");
      const notificationId = opaqueId(route.notification_id, "ntf_", "notification_not_found");
      const marked = await store.markNotificationRead(userId, notificationId, now);
      if (!marked) throw new CustomerMonitorError("notification_not_found");
      return privateJson({ ok: true, schema_version: CUSTOMER_MONITOR_ALERTS_SCHEMA, notification_id: notificationId, read_at: iso(now) }, {}, authorized.authorization);
    }

    if (route.kind === "notifications" && request.method === "DELETE") {
      const body = exactObject(await parseBody(request), new Set(["confirm"]));
      if (body.confirm !== "delete_notification_history") throw new CustomerMonitorError("monitor_delete_confirmation_required");
      const deleted = await store.deleteNotificationHistory(userId);
      return privateJson({ ok: true, schema_version: CUSTOMER_MONITOR_ALERTS_SCHEMA, deleted_count: deleted, state: "empty" }, {}, authorized.authorization);
    }

    const body = exactObject(await parseBody(request), new Set(["confirm"]));
    if (body.confirm !== "delete_all_alert_research_state") throw new CustomerMonitorError("monitor_delete_confirmation_required");
    const deleted = await store.deleteAllOwned(userId);
    return privateJson({ ok: true, schema_version: CUSTOMER_MONITOR_ALERTS_SCHEMA, deleted, state: "empty" }, {}, authorized.authorization);
  } catch (error) {
    return responseError(error, authorized.authorization);
  }
}

async function dedupeKey(rule, change, evidence) {
  return sha256(JSON.stringify({
    rule_id: rule.rule_id,
    instrument_id: rule.instrument_id,
    event_type: change.event_type,
    before: change.before,
    after: change.after,
    source_timestamp: evidence.source_timestamp,
  }));
}

export async function runCustomerMonitorEvaluator(env = {}, deps = {}) {
  const activation = resolveMonitorAlertActivation(env);
  if (!activation.evaluator) return Object.freeze({ state: "disabled", rules_seen: 0, sources_loaded: 0, transitions: 0, notifications_created: 0, provider_payloads_stored: false });
  const now = Math.floor((deps.nowMs ?? Date.now()) / 1000);
  const store = storeFrom(env, deps);
  const leaseToken = randomOpaqueId("lease_", 18);
  const lease = await store.acquireLease(leaseToken, now);
  if (!lease.acquired) return Object.freeze({ state: "lease_unavailable", rules_seen: 0, sources_loaded: 0, transitions: 0, notifications_created: 0, provider_payloads_stored: false });
  const totals = { state: "complete", rules_seen: 0, sources_loaded: 0, transitions: 0, notifications_created: 0, expired_notifications_deleted: 0, stale_or_invalid_skipped: 0, out_of_order_skipped: 0, cooldown_skipped: 0, quota_skipped: 0, concurrent_skipped: 0, provider_payloads_stored: false };
  let cursor = lease.cursor;
  try {
    totals.expired_notifications_deleted = await store.deleteExpiredNotifications(now);
    let rules = await store.listDueRules(now, cursor);
    if (!rules.length && cursor) {
      cursor = null;
      rules = await store.listDueRules(now, null);
    }
    totals.rules_seen = rules.length;
    const instrumentIds = [...new Set(rules.map((rule) => text(rule.instrument_id, 220)).filter(Boolean))];
    if (!instrumentIds.length) return Object.freeze(totals);
    if (typeof deps.loadEvidenceBatch !== "function") throw new Error("monitor_evidence_loader_unavailable");
    const evidenceByInstrument = await deps.loadEvidenceBatch(instrumentIds, { now });
    totals.sources_loaded = Number(evidenceByInstrument?.source_calls || 0);
    for (const rule of rules) {
      cursor = rule.rule_id;
      let rawEvidence = evidenceByInstrument instanceof Map ? evidenceByInstrument.get(rule.instrument_id) : evidenceByInstrument?.evidence?.[rule.instrument_id];
      const availabilityCheckedAt = Number(rule.availability_checked_at || 0);
      if (["unavailable", "superseded"].includes(String(rule.availability_state || "").toLowerCase())
        && Number.isSafeInteger(availabilityCheckedAt)
        && availabilityCheckedAt > 0
        && now - availabilityCheckedAt <= 3600
        && (!rawEvidence || availabilityCheckedAt >= Number(rawEvidence.source_timestamp || 0))) {
        rawEvidence = {
          schema_version: CUSTOMER_MONITOR_EVIDENCE_SCHEMA,
          instrument_id: rule.instrument_id,
          source_timestamp: availabilityCheckedAt,
          source_state: "qualified",
          source_kind: "saved_exact_market_availability",
          evidence_role: "market_fact",
          maximum_age_seconds: 3600,
          classifications: { availability_state: String(rule.availability_state).toLowerCase() },
          limitations: ["Only the exact market availability transition is qualified for this observation."],
        };
      }
      const evidence = normalizeMonitorEvidence(rawEvidence, { expected_instrument_id: rule.instrument_id, now });
      if (!evidence.qualified) { totals.stale_or_invalid_skipped += 1; continue; }
      const previousTimestamp = rule.last_source_timestamp === null || rule.last_source_timestamp === undefined ? null : Number(rule.last_source_timestamp);
      if (previousTimestamp !== null && evidence.source_timestamp <= previousTimestamp) { totals.out_of_order_skipped += 1; continue; }
      let previous = null;
      try { previous = rule.last_evidence_json ? parseJsonObject(rule.last_evidence_json) : null; } catch { totals.stale_or_invalid_skipped += 1; continue; }
      const selected = parseJsonArray(rule.event_types_json).filter((item) => EVENT_TYPES.has(item));
      const changes = previous ? compareMonitorEvidence(previous, evidence, selected) : [];
      const committed = await store.commitEvaluation(rule.rule_id, previousTimestamp, evidence, now);
      if (!committed) { totals.concurrent_skipped += 1; continue; }
      totals.transitions += changes.length;
      for (const change of changes) {
        if (totals.notifications_created >= CustomerMonitorAlertLimits.evaluator_max_notifications) break;
        const lastNotificationAt = await store.latestNotificationAt(rule.rule_id, change.event_type);
        if (lastNotificationAt && now - lastNotificationAt < Number(rule.cooldown_seconds || CustomerMonitorAlertLimits.cooldown_seconds)) { totals.cooldown_skipped += 1; continue; }
        if (await store.notificationCount(rule.user_id, now) >= CustomerMonitorAlertLimits.maximum_notification_history) { totals.quota_skipped += 1; continue; }
        const inserted = await store.insertNotification({
          notification_id: randomOpaqueId("ntf_", 18),
          user_id: rule.user_id,
          rule_id: rule.rule_id,
          instrument_id: rule.instrument_id,
          event_type: change.event_type,
          before_state: { field: change.field, value: change.before },
          after_state: { field: change.field, value: change.after },
          source_timestamp: evidence.source_timestamp,
          detected_at: now,
          dedupe_key: await dedupeKey(rule, change, evidence),
          explanation: transitionExplanation(change),
          evidence_role: evidence.evidence_role,
          limitations: evidence.limitations,
          deep_link_context: { instrument_id: rule.instrument_id, watch_id: rule.watch_id },
          retention_expires_at: now + CustomerMonitorAlertLimits.notification_retention_days * 86400,
        });
        if (inserted) totals.notifications_created += 1;
      }
    }
    return Object.freeze(totals);
  } finally {
    await store.releaseLease(leaseToken, cursor, now);
  }
}

export const CustomerMonitorDeliveryAdapterContract = Object.freeze({
  active_channels: Object.freeze(["in_app"]),
  future_channels: Object.freeze(["email", "web_push"]),
  out_of_app_delivery_active: false,
  credentials_configured: false,
  customer_consent_required: true,
});

export const CustomerMonitorAlertContract = Object.freeze({
  schema_version: CUSTOMER_MONITOR_ALERTS_SCHEMA,
  authenticated_origin: APP_ORIGIN,
  base_route: CUSTOMER_MONITOR_ALERTS_ROUTE,
  capability: "research.alerts",
  implementation_state: "implemented_dormant",
  activation_flags: Object.freeze({
    entitlement_resolution: "RAVENOS_ENTITLEMENT_RESOLUTION_ENABLE",
    capability: "RAVENOS_RESEARCH_ALERTS_ENABLE",
    customer_rule_routes: "RAVENOS_RESEARCH_ALERT_RULE_ROUTES_ENABLE",
    evaluation: "RAVENOS_RESEARCH_ALERT_EVALUATION_ENABLE",
    notification_history: "RAVENOS_NOTIFICATION_HISTORY_ENABLE",
  }),
  defaults: Object.freeze({ entitlement_resolution: false, capability: false, customer_rule_routes: false, evaluation: false, notification_history: false }),
  exact_identity_only: true,
  supported_event_types: CustomerMonitorEventTypes,
  quotas: CustomerMonitorAlertLimits,
  provider_payloads_stored: false,
  plan_prices_stored: false,
  wallet_data_stored: false,
  execution_data_stored: false,
  out_of_app_delivery_active: false,
});
