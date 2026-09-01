import { canonicalContractHash } from "../customer_trade/contracts.mjs";
import { authorizeCustomerApiRequest } from "../customer_identity.mjs";
import {
  createD1CustomerEntitlementStore,
  resolveCapabilityAccess,
  resolveEntitlementFeatureFlags,
} from "../customer_entitlements.mjs";
import { canTransitionAgentState } from "./state_machines.mjs";
import {
  AGENTIC_AUDIT_GENESIS_HASH,
  createAgenticAuditEvent,
} from "./audit_chain.mjs";

export const AGENTIC_WORKSPACE_ROUTE = "/api/v1/agents/workspace";
export const AGENTIC_ROUTE_PREFIX = "/api/v1/agents";
export const AGENTIC_WORKSPACE_SCHEMA = "ravenos.agentic.workspace.v1";

const APP_ORIGIN = "https://app.ravenos.xyz";
const MAX_REQUEST_URL_BYTES = 2_048;
const MAX_RESPONSE_BYTES = 512 * 1024;
const AGENT_ID_RE = /^agt_[A-Za-z0-9_-]{16,96}$/;
const textEncoder = new TextEncoder();

function flag(value) {
  return String(value || "") === "1";
}

function clean(value, maximum = 240) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function safeJson(value, fallback = null) {
  if (value && typeof value === "object") return structuredClone(value);
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function headers(source = null) {
  const output = new Headers(source || undefined);
  output.set("cache-control", "private, no-store, max-age=0");
  output.set("pragma", "no-cache");
  output.set("content-type", "application/json; charset=utf-8");
  output.set("x-content-type-options", "nosniff");
  output.set("referrer-policy", "no-referrer");
  output.set("vary", "Cookie, Origin");
  return output;
}

function response(payload, authorization = null, status = 200) {
  const body = JSON.stringify(payload);
  if (textEncoder.encode(body).byteLength > MAX_RESPONSE_BYTES) {
    return new Response(JSON.stringify({ ok: false, error: "agentic_workspace_response_too_large" }), {
      status: 503,
      headers: headers(authorization?.response_headers),
    });
  }
  return new Response(body, { status, headers: headers(authorization?.response_headers) });
}

function routeMatch(pathname) {
  if (pathname === AGENTIC_WORKSPACE_ROUTE) return { kind: "workspace" };
  const match = pathname.match(/^\/api\/v1\/agents\/(agt_[A-Za-z0-9_-]{16,96})\/(pause|kill)$/);
  return match ? { kind: "transition", agent_id: match[1], action: match[2] } : null;
}

export function resolveAgenticTradingFlags(env = {}) {
  const entitlement = flag(env.RAVENOS_ENTITLEMENT_RESOLUTION_ENABLE);
  const paperRequested = flag(env.RAVENOS_AGENTIC_PAPER_ENABLED);
  return Object.freeze({
    workspace: entitlement && paperRequested,
    paper_execution: entitlement && paperRequested,
    robinhood_chain_ingestion: flag(env.RAVENOS_ROBINHOOD_CHAIN_INGESTION_ENABLED),
    agent_radar: flag(env.RAVENOS_AGENT_RADAR_ENABLED),
    global_live_agent_execution: false,
    robinhood_brokerage_execution: false,
    robinhood_chain_live_execution: false,
    solana_agent_execution: false,
    hyperliquid_agent_execution: false,
    autonomous_bridging: false,
    automated_compensation_trades: false,
    ignored_live_enable_requests: [
      "RAVENOS_LIVE_AGENT_EXECUTION_ENABLED",
      "RAVENOS_ROBINHOOD_BROKERAGE_EXECUTION_ENABLED",
      "RAVENOS_ROBINHOOD_CHAIN_LIVE_EXECUTION_ENABLED",
      "RAVENOS_SOLANA_AGENT_EXECUTION_ENABLED",
      "RAVENOS_HYPERLIQUID_AGENT_EXECUTION_ENABLED",
      "RAVENOS_AUTONOMOUS_BRIDGING_ENABLED",
      "RAVENOS_AUTOMATED_COMPENSATION_ENABLED",
    ].filter((key) => flag(env[key])),
  });
}

function formatFact(row) {
  const key = clean(row?.key || "evidence", 80).replaceAll("_", " ");
  const value = typeof row?.value === "string" ? row.value : JSON.stringify(row?.value ?? null);
  return `${key}: ${clean(value, 140)}`;
}

function flattenRadarRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const projection = safeJson(row.projection_json, {});
    const dimensions = projection.dimensions && typeof projection.dimensions === "object" ? Object.values(projection.dimensions) : [];
    const facts = dimensions.flatMap((dimension) => Array.isArray(dimension?.facts) ? dimension.facts : []);
    const claims = dimensions.flatMap((dimension) => Array.isArray(dimension?.claims) ? dimension.claims : []);
    const unknowns = dimensions.flatMap((dimension) => Array.isArray(dimension?.unknowns) ? dimension.unknowns : []);
    const activity = clean(projection.activity_assessment?.state || "INSUFFICIENT_EVIDENCE", 80);
    return {
      entity_id: clean(row.entity_id, 120),
      name: clean(row.entity_id, 120) || "Unlabeled agent token",
      chain: Number(row.chain_id) === 4663 ? "Robinhood Chain" : `Chain ${Number(row.chain_id)}`,
      verification: activity === "VERIFIED_ACTIVITY_OBSERVED" ? "Verified activity" : activity === "TOKEN_EVIDENCE_ONLY" ? "Token evidence only" : "Unresolved",
      endpoint: facts.some((fact) => fact.key === "endpoint_availability") ? "Observed" : "Unverified",
      activity: activity.replaceAll("_", " ").toLowerCase(),
      liquidity: facts.some((fact) => fact.key === "liquidity") ? "Observed" : "Unknown",
      facts: facts.slice(0, 12).map(formatFact),
      claims: claims.slice(0, 12).map(formatFact),
      unknowns: unknowns.slice(0, 12).map((item) => `${clean(item?.key || "evidence", 80).replaceAll("_", " ")}: ${clean(item?.reason || "Unresolved", 140)}`),
      warnings: Array.isArray(projection.warnings) ? projection.warnings.slice(0, 12) : [],
      generated_at: projection.generated_at || null,
      projection_hash: clean(projection.projection_hash, 80) || null,
    };
  });
}

function radarFreshness(rows, nowSeconds) {
  if (!Array.isArray(rows) || !rows.length) return "No indexed evidence";
  const latest = Math.max(...rows.map((row) => Number(row.generated_at)).filter(Number.isSafeInteger));
  if (!Number.isSafeInteger(latest) || !Number.isSafeInteger(nowSeconds) || latest > nowSeconds + 30) return "Freshness unavailable";
  const age = nowSeconds - latest;
  if (age <= 300) return "Current evidence";
  if (age <= 1_800) return "Delayed evidence";
  return "Stale evidence";
}

function projectAgent(row) {
  const spec = safeJson(row.spec_json, {});
  const saga = safeJson(row.saga_json, {});
  const decision = safeJson(row.decision_json, {});
  const events = (Array.isArray(row.events) ? row.events : []).map((eventRow) => {
    const event = safeJson(eventRow.event_json, {});
    return {
      at: event.observed_at || event.occurred_at || (Number(eventRow.observed_at) ? new Date(Number(eventRow.observed_at) * 1000).toISOString() : "Unavailable"),
      type: clean(event.event_type || eventRow.event_type || "Evidence", 60),
      detail: clean(event.detail || event.reason || event.reason_code || "Recorded", 240),
    };
  });
  const latestPlan = saga.plan && typeof saga.plan === "object" ? saga.plan : null;
  return {
    agent_id: row.agent_id,
    name: clean(spec.name || row.display_name, 120),
    strategy_type: clean(spec.strategy_type || "typed_strategy", 80),
    state: clean(row.lifecycle_state || "draft", 40),
    autonomy: clean(spec.autonomy_level || "propose_only", 40),
    daily_pnl: "Unavailable",
    drawdown: "Unavailable",
    next_run: clean(spec.triggers?.schedule || "Not scheduled", 80),
    data_health: clean(saga.data_health || "No current run", 80),
    warnings: Number(saga.warning_count) || 0,
    venues: Array.isArray(spec.allowed_venues) ? spec.allowed_venues.slice(0, 12).map((venue) => clean(venue?.slug || venue?.venue_id || venue, 80)) : [],
    capital: Array.isArray(saga.capital) ? saga.capital.slice(0, 20) : [],
    plan: latestPlan,
    policy: decision?.result ? {
      result: decision.result,
      rules: (Array.isArray(decision.evaluated_rules) ? decision.evaluated_rules : []).slice(0, 50).map((rule) => ({
        name: clean(rule.rule_id, 100),
        result: clean(rule.result, 40),
        detail: clean(rule.reason || `${rule.observed_value ?? "Unknown"} / ${rule.configured_limit ?? "Unknown"}`, 240),
      })),
    } : { result: "indeterminate", rules: [] },
    events,
  };
}

export function createD1AgenticTradingStore(db) {
  if (!db?.prepare) throw new Error("agentic_store_unavailable");
  return Object.freeze({
    async workspace(userId, { now_seconds: nowSeconds = Math.floor(Date.now() / 1_000), include_radar: includeRadar = false } = {}) {
      const agentResult = await db.prepare(`
        SELECT a.agent_id, a.display_name, a.lifecycle_state, a.current_spec_id,
               s.spec_json,
               g.saga_json,
               d.decision_json
        FROM ravenos_agents a
        LEFT JOIN ravenos_agent_specs s ON s.spec_id = a.current_spec_id AND s.user_id = a.user_id
        LEFT JOIN ravenos_agent_plan_sagas g ON g.plan_id = (
          SELECT p.plan_id FROM ravenos_agent_trade_plans p
          WHERE p.agent_id = a.agent_id AND p.user_id = a.user_id
          ORDER BY p.created_at DESC, p.plan_id DESC LIMIT 1
        )
        LEFT JOIN ravenos_agent_policy_decisions d ON d.decision_id = (
          SELECT pd.decision_id FROM ravenos_agent_policy_decisions pd
          JOIN ravenos_agent_trade_plans pp ON pp.plan_id = pd.plan_id
          WHERE pp.agent_id = a.agent_id AND pd.user_id = a.user_id
          ORDER BY pd.created_at DESC, pd.decision_id DESC LIMIT 1
        )
        WHERE a.user_id = ?
        ORDER BY a.updated_at DESC, a.agent_id ASC
        LIMIT 50
      `).bind(userId).all();
      if (!Array.isArray(agentResult?.results)) throw new Error("agentic_workspace_query_failed");
      const agents = await Promise.all(agentResult.results.map(async (row) => {
        const eventResult = await db.prepare(`
          SELECT event_type, event_json, observed_at
          FROM ravenos_agent_audit_events
          WHERE user_id = ? AND agent_id = ?
          ORDER BY sequence DESC, event_id DESC
          LIMIT 50
        `).bind(userId, row.agent_id).all();
        return projectAgent({ ...row, events: Array.isArray(eventResult?.results) ? eventResult.results.reverse() : [] });
      }));
      if (!includeRadar) {
        return { agents, radar: { freshness_state: "Radar disabled", entries: [], partial_failure: false } };
      }
      let radarResult;
      try {
        radarResult = await db.prepare(`
          SELECT p.entity_id, p.chain_id, p.projection_json, p.generated_at
          FROM ravenos_agent_radar_projections p
          WHERE p.generated_at = (
            SELECT MAX(latest.generated_at)
            FROM ravenos_agent_radar_projections latest
            WHERE latest.entity_id = p.entity_id AND latest.chain_id = p.chain_id
          )
          ORDER BY p.generated_at DESC, p.entity_id ASC
          LIMIT 100
        `).all();
      } catch {
        return { agents, radar: { freshness_state: "Radar unavailable", entries: [], partial_failure: true } };
      }
      const radarRows = Array.isArray(radarResult?.results) ? radarResult.results : [];
      return {
        agents,
        radar: {
          freshness_state: radarFreshness(radarRows, Number(nowSeconds)),
          entries: flattenRadarRows(radarRows),
          partial_failure: false,
        },
      };
    },

    async transitionAgent({ user_id: userId, agent_id: agentId, action, now_seconds: nowSeconds }) {
      if (typeof db.batch !== "function") throw new Error("agentic_store_atomic_batch_required");
      if (!AGENT_ID_RE.test(agentId)) throw new Error("agent_id_invalid");
      const row = await db.prepare(`
        SELECT agent_id, lifecycle_state, updated_at
        FROM ravenos_agents
        WHERE agent_id = ? AND user_id = ?
        LIMIT 1
      `).bind(agentId, userId).first();
      if (!row) return { ok: false, error: "agent_not_found", status: 404 };
      const current = clean(row.lifecycle_state, 40).toLowerCase();
      const target = action === "kill" ? "killed" : current === "paper_accepted" ? "paper_paused" : current === "paper" ? "paper_paused" : "paused";
      if (!canTransitionAgentState(current, target)) return { ok: false, error: `invalid_agent_transition:${current}->${target}`, status: 409 };
      const previous = await db.prepare(`
        SELECT event_hash, sequence
        FROM ravenos_agent_audit_events
        WHERE user_id = ? AND agent_id = ?
        ORDER BY sequence DESC, event_id DESC
        LIMIT 1
      `).bind(userId, agentId).first();
      const sequence = previous ? Number(previous.sequence) + 1 : 0;
      const previousHash = previous?.event_hash || AGENTIC_AUDIT_GENESIS_HASH;
      const eventId = `aae_${canonicalContractHash({ agent_id: agentId, action, sequence, previous_hash: previousHash, observed_at: nowSeconds }).slice(0, 28)}`;
      const event = createAgenticAuditEvent({
        event_id: eventId,
        aggregate_type: "agent",
        aggregate_id: agentId,
        event_type: action === "kill" ? "agent_killed" : "agent_paused",
        occurred_at: new Date(nowSeconds * 1000).toISOString(),
        actor: "owner",
        environment: "paper",
        payload: {
          from: current,
          to: target,
          reason: "explicit_owner_request",
          execution_triggered: false,
        },
      }, { sequence, previous_hash: previousHash });
      const insert = db.prepare(`
        INSERT INTO ravenos_agent_audit_events (
          event_id, user_id, agent_id, plan_id, sequence, event_type,
          previous_event_hash, event_hash, event_json, observed_at
        )
        SELECT ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM ravenos_agents
          WHERE agent_id = ? AND user_id = ? AND lifecycle_state = ? AND updated_at = ?
        )
      `).bind(
        eventId, userId, agentId, sequence, event.event_type,
        event.previous_hash, event.event_hash, JSON.stringify(event), nowSeconds,
        agentId, userId, current, Number(row.updated_at),
      );
      const update = db.prepare(`
        UPDATE ravenos_agents
        SET lifecycle_state = ?, updated_at = ?
        WHERE agent_id = ? AND user_id = ? AND lifecycle_state = ? AND updated_at = ?
      `).bind(target, nowSeconds, agentId, userId, current, Number(row.updated_at));
      const results = await db.batch([insert, update]);
      const inserted = Number(results?.[0]?.meta?.changes ?? results?.[0]?.changes ?? 0);
      const changed = Number(results?.[1]?.meta?.changes ?? results?.[1]?.changes ?? 0);
      if (inserted !== 1 || changed !== 1) return { ok: false, error: "agent_transition_conflict", status: 409 };
      return { ok: true, agent_id: agentId, previous_state: current, state: target, event_id: eventId, live_execution_triggered: false };
    },
  });
}

async function capabilityAccess(env, authorization, dependencies = {}) {
  if (typeof dependencies.resolve_access === "function") {
    return dependencies.resolve_access({ env, authorization });
  }
  if (!env.RAVENOS_CUSTOMER_DB?.prepare) return { available: false, state: "store_unavailable" };
  const grants = await createD1CustomerEntitlementStore(env.RAVENOS_CUSTOMER_DB).listOwnedGrants(authorization.principal.user_id);
  return resolveCapabilityAccess({
    capability: "agents.paper",
    user_id: authorization.principal.user_id,
    grants,
    now: authorization.now,
    flags: resolveEntitlementFeatureFlags(env),
  });
}

export async function routeAgenticTrading(request, env = {}, dependencies = {}) {
  const url = new URL(request.url);
  const match = routeMatch(url.pathname);
  if (!match) return null;
  if (url.origin !== APP_ORIGIN) return response({ ok: false, error: "not_found" }, null, 404);
  if (textEncoder.encode(request.url).byteLength > MAX_REQUEST_URL_BYTES) return response({ ok: false, error: "request_too_large" }, null, 414);
  const expectedMethod = match.kind === "workspace" ? "GET" : "POST";
  if (request.method !== expectedMethod) return response({ ok: false, error: "method_not_allowed" }, null, 405);
  if (url.search || url.hash) return response({ ok: false, error: "request_parameters_not_allowed" }, null, 400);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > 0 || request.body !== null) {
    return response({ ok: false, error: contentLength > MAX_REQUEST_URL_BYTES ? "request_too_large" : "request_body_not_allowed" }, null, contentLength > MAX_REQUEST_URL_BYTES ? 413 : 400);
  }
  const authorize = dependencies.authorize || authorizeCustomerApiRequest;
  const authorization = await authorize(request, env, {}, { require_csrf: match.kind === "transition" });
  if (authorization.response) return authorization.response;
  const flags = resolveAgenticTradingFlags(env);
  const access = await capabilityAccess(env, authorization, dependencies);
  if (!access?.available) {
    return response({
      ok: false,
      schema_version: AGENTIC_WORKSPACE_SCHEMA,
      error: access?.state === "not_granted" ? "raven_pro_required" : "agentic_workspace_unavailable",
      state: access?.state || "unavailable",
      feature_flags: flags,
    }, authorization, access?.state === "not_granted" ? 403 : 503);
  }
  if (!flags.workspace) {
    return response({ ok: false, schema_version: AGENTIC_WORKSPACE_SCHEMA, error: "agentic_workspace_unavailable", state: "server_disabled", feature_flags: flags }, authorization, 503);
  }
  const store = dependencies.store || createD1AgenticTradingStore(env.RAVENOS_CUSTOMER_DB);
  try {
    if (match.kind === "workspace") {
      const workspace = await store.workspace(authorization.principal.user_id, {
        now_seconds: authorization.now,
        include_radar: flags.agent_radar,
      });
      return response({
        ok: true,
        schema_version: AGENTIC_WORKSPACE_SCHEMA,
        demonstration_data: false,
        environment: "paper",
        live_execution_enabled: false,
        feature_flags: flags,
        agents: workspace.agents,
        radar: workspace.radar,
      }, authorization);
    }
    const transition = await store.transitionAgent({
      user_id: authorization.principal.user_id,
      agent_id: match.agent_id,
      action: match.action,
      now_seconds: authorization.now,
    });
    return response({ ...transition, schema_version: "ravenos.agentic.agent_transition.v1", live_execution_enabled: false }, authorization, transition.status || (transition.ok ? 200 : 409));
  } catch (error) {
    return response({ ok: false, error: clean(error?.code || error?.message || "agentic_workspace_unavailable", 120), live_execution_enabled: false }, authorization, 503);
  }
}
