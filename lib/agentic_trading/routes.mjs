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
import {
  compilePaperAgentDraft,
  verifyPaperCapitalAllocation,
} from "./agent_drafts.mjs";
import { agenticContractHash } from "./hashing.mjs";
import { verifyAgenticRecord } from "./records.mjs";
import { parseBoundedJsonBody } from "../customer_trade/terminal_runtime.mjs";

export const AGENTIC_WORKSPACE_ROUTE = "/api/v1/agents/workspace";
export const AGENTIC_ROUTE_PREFIX = "/api/v1/agents";
export const AGENTIC_WORKSPACE_SCHEMA = "ravenos.agentic.workspace.v1";

const APP_ORIGIN = "https://app.ravenos.xyz";
const MAX_REQUEST_URL_BYTES = 2_048;
const MAX_DRAFT_REQUEST_BYTES = 16 * 1024;
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
  if (pathname === `${AGENTIC_ROUTE_PREFIX}/drafts`) return { kind: "create_draft" };
  const match = pathname.match(/^\/api\/v1\/agents\/(agt_[A-Za-z0-9_-]{16,96})\/(validate|start-paper|resume-paper|pause|kill)$/);
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

function displayAtomic(amountAtomic, decimals, symbol) {
  const raw = String(amountAtomic ?? "");
  const places = Number(decimals);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(places) || places < 0 || places > 18) return "Unavailable";
  const padded = raw.padStart(places + 1, "0");
  const whole = places ? padded.slice(0, -places) : padded;
  const fraction = places ? padded.slice(-places).replace(/0+$/, "").slice(0, 4) : "";
  return `${whole}${fraction ? `.${fraction}` : ""} ${clean(symbol, 12)}`;
}

function capitalCards(capital) {
  const allocations = Array.isArray(capital?.allocations) ? capital.allocations : [];
  const byVenue = new Map();
  for (const allocation of allocations) {
    const venueId = clean(allocation?.venue_id, 120);
    if (!venueId) continue;
    const venue = venueId.startsWith("jupiter@") ? "Solana · Jupiter" : venueId.startsWith("hyperliquid@") ? "Hyperliquid · Perps" : venueId;
    const card = byVenue.get(venueId) || { venue, available: "Unavailable", reserved: "0", gas: "Unavailable", state: "paper" };
    const symbol = String(allocation?.asset_id || "").split(":").at(-1)?.toUpperCase() === "SOL" ? "SOL" : allocation?.role === "paper_gas_reserve" ? "SOL" : "USDC";
    const display = clean(allocation?.display_amount, 80) || displayAtomic(allocation?.amount_atomic, allocation?.decimals, symbol);
    if (allocation?.role === "paper_gas_reserve") card.gas = display;
    else if (allocation?.role === "trading_capital") card.available = display;
    byVenue.set(venueId, card);
  }
  return [...byVenue.values()];
}

function configuredPolicyRules(policy) {
  if (!policy?.policy_hash) return [];
  const limits = policy.limits || {};
  const micros = (value) => /^\d+$/.test(String(value ?? "")) ? `$${displayAtomic(value, 6, "").trim()}` : "Unavailable";
  return [
    { name: "Per leg", result: "Adopted", detail: micros(limits.max_leg_notional_usdc_micros) },
    { name: "Slippage", result: "Adopted", detail: limits.max_slippage_bps == null ? "Unavailable" : `${limits.max_slippage_bps / 100}% max` },
    { name: "Price impact", result: "Adopted", detail: limits.max_price_impact_bps == null ? "Unavailable" : `${limits.max_price_impact_bps / 100}% max` },
    { name: "Hedge gap", result: "Adopted", detail: limits.max_unhedged_duration_ms == null ? "Unavailable" : `${limits.max_unhedged_duration_ms / 1_000}s max` },
  ];
}

function projectAgent(row) {
  const spec = safeJson(row.spec_json, {});
  const configuredPolicy = safeJson(row.policy_json, {});
  const capital = safeJson(row.capital_json, {});
  const schedule = safeJson(row.schedule_json, {});
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
    next_run: row.schedule_state === "active" && Number.isSafeInteger(Number(row.next_run_at))
      ? new Date(Number(row.next_run_at) * 1_000).toISOString()
      : clean(spec.triggers?.schedule || "Not scheduled", 80),
    data_health: clean(saga.data_health || "No current run", 80),
    warnings: Number(saga.warning_count) || 0,
    venues: Array.isArray(spec.allowed_venues) ? spec.allowed_venues.slice(0, 12).map((venue) => clean(venue?.slug || venue?.venue_id || venue, 80)) : [],
    capital: Array.isArray(saga.capital) && saga.capital.length ? saga.capital.slice(0, 20) : capitalCards(capital),
    configuration: {
      spec_version: Number(spec.version) || 1,
      specification_hash: clean(spec.specification_hash, 80) || null,
      policy_hash: clean(configuredPolicy.policy_hash, 80) || null,
      capital_hash: clean(capital.record_hash, 80) || null,
      instruments: (Array.isArray(spec.allowed_instruments) ? spec.allowed_instruments : []).slice(0, 8).map((instrument) => ({
        instrument_id: clean(instrument?.instrument_id, 180),
        display_symbol: clean(instrument?.display_symbol, 40),
        venue: clean(instrument?.venue?.slug, 60),
        chain_id: clean(instrument?.chain_id, 80),
      })),
      entry_basis_bps: Number(spec.entry_rules?.enter_at_absolute_basis_bps),
      exit_basis_bps: Number(spec.exit_rules?.exit_at_absolute_basis_bps),
      notional_usdc: clean(spec.position_sizing?.value, 40),
      cadence: clean(spec.triggers?.schedule, 80),
      schedule_state: clean(row.schedule_state || schedule.state || "draft", 40),
      user_policy_adopted: configuredPolicy.authority === "user" && configuredPolicy.adoption_state === "active",
    },
    plan: latestPlan,
    policy: decision?.result ? {
      result: decision.result,
      rules: (Array.isArray(decision.evaluated_rules) ? decision.evaluated_rules : []).slice(0, 50).map((rule) => ({
        name: clean(rule.rule_id, 100),
        result: clean(rule.result, 40),
        detail: clean(rule.reason || `${rule.observed_value ?? "Unknown"} / ${rule.configured_limit ?? "Unknown"}`, 240),
      })),
    } : { result: configuredPolicy.policy_hash ? "adopted" : "indeterminate", rules: configuredPolicyRules(configuredPolicy) },
    events,
  };
}

function verifyStoredPolicy(policy) {
  if (!policy || policy.schema_version !== "ravenos.agentic.user_policy.v1") return false;
  if (policy.authority !== "user" || policy.adoption_state !== "active" || policy.live_execution_allowed !== false) return false;
  const { policy_hash: supplied, ...core } = policy;
  return Boolean(supplied && agenticContractHash(core) === supplied);
}

function verifySchedule(schedule, { agentId, specId }) {
  if (!schedule || schedule.schema_version !== "ravenos.agentic.paper_schedule.v1") return false;
  if (schedule.agent_id !== agentId || schedule.live_execution_enabled !== false) return false;
  if (![60, 300, 900, 3600].includes(Number(schedule.interval_seconds))) return false;
  if (schedule.current_spec_id && schedule.current_spec_id !== specId) return false;
  const { schedule_hash: supplied, ...core } = schedule;
  return Boolean(supplied && agenticContractHash(core) === supplied);
}

function updateScheduleRecord(schedule, { state, nextRunAt, nowSeconds, currentSpecId }) {
  const core = {
    ...schedule,
    current_spec_id: currentSpecId,
    state,
    next_run_at: nextRunAt,
    updated_at: new Date(nowSeconds * 1_000).toISOString(),
    live_execution_enabled: false,
  };
  delete core.schedule_hash;
  return { ...core, schedule_hash: agenticContractHash(core) };
}

export function createD1AgenticTradingStore(db) {
  if (!db?.prepare) throw new Error("agentic_store_unavailable");
  return Object.freeze({
    async workspace(userId, { now_seconds: nowSeconds = Math.floor(Date.now() / 1_000), include_radar: includeRadar = false } = {}) {
      const agentResult = await db.prepare(`
        SELECT a.agent_id, a.display_name, a.lifecycle_state, a.current_spec_id,
               s.spec_json,
               pol.policy_json,
               cap.capital_json,
               sch.schedule_json, sch.state AS schedule_state, sch.next_run_at,
               g.saga_json,
               d.decision_json
        FROM ravenos_agents a
        LEFT JOIN ravenos_agent_specs s ON s.spec_id = a.current_spec_id AND s.user_id = a.user_id
        LEFT JOIN ravenos_agent_user_policies pol ON pol.policy_version_id = (
          SELECT latest_policy.policy_version_id FROM ravenos_agent_user_policies latest_policy
          WHERE latest_policy.agent_id = a.agent_id AND latest_policy.user_id = a.user_id
          ORDER BY latest_policy.version DESC, latest_policy.policy_version_id DESC LIMIT 1
        )
        LEFT JOIN ravenos_agent_capital_versions cap ON cap.capital_version_id = (
          SELECT latest_capital.capital_version_id FROM ravenos_agent_capital_versions latest_capital
          WHERE latest_capital.agent_id = a.agent_id AND latest_capital.user_id = a.user_id
          ORDER BY latest_capital.version DESC, latest_capital.capital_version_id DESC LIMIT 1
        )
        LEFT JOIN ravenos_agent_paper_schedules sch ON sch.agent_id = a.agent_id AND sch.user_id = a.user_id
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

    async createDraft({ user_id: userId, draft, now_seconds: nowSeconds }) {
      if (typeof db.batch !== "function") throw new Error("agentic_store_atomic_batch_required");
      const compiled = compilePaperAgentDraft(draft, { owner_tenant_id: userId, now: nowSeconds * 1_000 });
      const existing = await db.prepare(`
        SELECT agent_id, request_fingerprint
        FROM ravenos_agent_creation_requests
        WHERE user_id = ? AND idempotency_key = ?
        LIMIT 1
      `).bind(userId, compiled.idempotency_key).first();
      if (existing) {
        if (existing.request_fingerprint !== compiled.request_fingerprint) {
          return { ok: false, error: "agent_creation_idempotency_conflict", status: 409 };
        }
        return { ok: true, agent_id: existing.agent_id, state: "draft", idempotent_replay: true, live_execution_enabled: false };
      }
      const policyVersionId = `${compiled.policy.policy_id}:v${compiled.policy.version}`;
      const eventId = `aae_${canonicalContractHash({ agent_id: compiled.agent.agent_id, action: "create_draft", request_fingerprint: compiled.request_fingerprint }).slice(0, 28)}`;
      const event = createAgenticAuditEvent({
        event_id: eventId,
        aggregate_type: "agent",
        aggregate_id: compiled.agent.agent_id,
        event_type: "agent_draft_created",
        occurred_at: new Date(nowSeconds * 1_000).toISOString(),
        actor: "owner",
        environment: "paper",
        payload: {
          specification_hash: compiled.spec.specification_hash,
          policy_hash: compiled.policy.policy_hash,
          capital_hash: compiled.capital.record_hash,
          schedule_hash: compiled.schedule.schedule_hash,
          user_policy_adopted: true,
          live_execution_enabled: false,
        },
      });
      const statements = [
        db.prepare(`
          INSERT INTO ravenos_agents (
            agent_id, user_id, display_name, current_spec_id, lifecycle_state,
            environment, live_execution_enabled, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'draft', 'paper', 0, ?, ?)
        `).bind(compiled.agent.agent_id, userId, compiled.agent.display_name, compiled.spec.agent_spec_id, nowSeconds, nowSeconds),
        db.prepare(`
          INSERT INTO ravenos_agent_specs (
            spec_id, agent_id, user_id, version, schema_version, specification_hash,
            record_hash, spec_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          compiled.spec.agent_spec_id, compiled.agent.agent_id, userId, compiled.spec.version,
          compiled.spec.schema_version, compiled.spec.specification_hash, compiled.spec.record_hash,
          JSON.stringify(compiled.spec), nowSeconds,
        ),
        db.prepare(`
          INSERT INTO ravenos_agent_user_policies (
            policy_version_id, policy_id, agent_id, user_id, version,
            schema_version, policy_hash, policy_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          policyVersionId, compiled.policy.policy_id, compiled.agent.agent_id, userId,
          compiled.policy.version, compiled.policy.schema_version, compiled.policy.policy_hash,
          JSON.stringify(compiled.policy), nowSeconds,
        ),
        db.prepare(`
          INSERT INTO ravenos_agent_capital_versions (
            capital_version_id, agent_id, user_id, version, schema_version,
            record_hash, capital_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          compiled.capital.capital_version_id, compiled.agent.agent_id, userId, compiled.capital.version,
          compiled.capital.schema_version, compiled.capital.record_hash, JSON.stringify(compiled.capital), nowSeconds,
        ),
        db.prepare(`
          INSERT INTO ravenos_agent_paper_schedules (
            schedule_id, agent_id, user_id, current_spec_id, schema_version,
            schedule_hash, trigger_kind, interval_seconds, state, next_run_at,
            last_run_at, run_count, schedule_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'interval', ?, 'draft', NULL, NULL, 0, ?, ?, ?)
        `).bind(
          compiled.schedule.schedule_id, compiled.agent.agent_id, userId, compiled.spec.agent_spec_id,
          compiled.schedule.schema_version, compiled.schedule.schedule_hash, compiled.schedule.interval_seconds,
          JSON.stringify(compiled.schedule), nowSeconds, nowSeconds,
        ),
        db.prepare(`
          INSERT INTO ravenos_agent_audit_events (
            event_id, user_id, agent_id, plan_id, sequence, event_type,
            previous_event_hash, event_hash, event_json, observed_at
          ) VALUES (?, ?, ?, NULL, 0, ?, ?, ?, ?, ?)
        `).bind(
          event.event_id, userId, compiled.agent.agent_id, event.event_type,
          event.previous_hash, event.event_hash, JSON.stringify(event), nowSeconds,
        ),
        db.prepare(`
          INSERT INTO ravenos_agent_creation_requests (
            user_id, idempotency_key, request_fingerprint, agent_id, created_at
          ) VALUES (?, ?, ?, ?, ?)
        `).bind(userId, compiled.idempotency_key, compiled.request_fingerprint, compiled.agent.agent_id, nowSeconds),
      ];
      const results = await db.batch(statements);
      if (results.length !== statements.length || results.some((result) => Number(result?.meta?.changes ?? result?.changes ?? 0) !== 1)) {
        throw new Error("agent_draft_atomic_insert_failed");
      }
      return {
        ok: true,
        agent_id: compiled.agent.agent_id,
        state: "draft",
        spec_id: compiled.spec.agent_spec_id,
        specification_hash: compiled.spec.specification_hash,
        policy_hash: compiled.policy.policy_hash,
        capital_hash: compiled.capital.record_hash,
        idempotent_replay: false,
        live_execution_enabled: false,
      };
    },

    async transitionAgent({ user_id: userId, agent_id: agentId, action, now_seconds: nowSeconds }) {
      if (typeof db.batch !== "function") throw new Error("agentic_store_atomic_batch_required");
      if (!AGENT_ID_RE.test(agentId)) throw new Error("agent_id_invalid");
      const row = await db.prepare(`
        SELECT a.agent_id, a.lifecycle_state, a.updated_at, a.current_spec_id,
               s.spec_json, p.policy_json, c.capital_json,
               sch.schedule_id, sch.schedule_json, sch.state AS schedule_state
        FROM ravenos_agents a
        LEFT JOIN ravenos_agent_specs s ON s.spec_id = a.current_spec_id AND s.user_id = a.user_id
        LEFT JOIN ravenos_agent_user_policies p ON p.policy_version_id = (
          SELECT latest.policy_version_id FROM ravenos_agent_user_policies latest
          WHERE latest.agent_id = a.agent_id AND latest.user_id = a.user_id
          ORDER BY latest.version DESC, latest.policy_version_id DESC LIMIT 1
        )
        LEFT JOIN ravenos_agent_capital_versions c ON c.capital_version_id = (
          SELECT latest.capital_version_id FROM ravenos_agent_capital_versions latest
          WHERE latest.agent_id = a.agent_id AND latest.user_id = a.user_id
          ORDER BY latest.version DESC, latest.capital_version_id DESC LIMIT 1
        )
        LEFT JOIN ravenos_agent_paper_schedules sch ON sch.agent_id = a.agent_id AND sch.user_id = a.user_id
        WHERE a.agent_id = ? AND a.user_id = ?
        LIMIT 1
      `).bind(agentId, userId).first();
      if (!row) return { ok: false, error: "agent_not_found", status: 404 };
      const current = clean(row.lifecycle_state, 40).toLowerCase();
      const targets = {
        validate: "validated",
        "start-paper": "paper",
        "resume-paper": "paper",
        pause: current === "paper" || current === "paper_accepted" ? "paper_paused" : "paused",
        kill: "killed",
      };
      const target = targets[action];
      if (!target) return { ok: false, error: "agent_action_invalid", status: 400 };
      if (!canTransitionAgentState(current, target)) return { ok: false, error: `invalid_agent_transition:${current}->${target}`, status: 409 };
      const spec = safeJson(row.spec_json, null);
      const policy = safeJson(row.policy_json, null);
      const capital = safeJson(row.capital_json, null);
      const schedule = safeJson(row.schedule_json, null);
      const specVerification = verifyAgenticRecord(spec, "AgentSpec");
      if (!specVerification.ok || spec.agent_spec_id !== row.current_spec_id || spec.agent_id !== agentId || spec.owner_tenant_id !== userId) {
        return { ok: false, error: "agent_spec_validation_failed", status: 409 };
      }
      if (!verifyStoredPolicy(policy) || spec.risk_policy_ref?.policy_hash !== policy.policy_hash || policy.owner_tenant_id !== userId) {
        return { ok: false, error: "agent_policy_validation_failed", status: 409 };
      }
      if (!verifyPaperCapitalAllocation(capital) || capital.agent_id !== agentId || capital.owner_tenant_id !== userId) {
        return { ok: false, error: "agent_capital_validation_failed", status: 409 };
      }
      if (!verifySchedule(schedule, { agentId, specId: row.current_spec_id })) {
        return { ok: false, error: "agent_schedule_validation_failed", status: 409 };
      }
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
      const eventType = action === "kill"
        ? "agent_killed"
        : action === "pause"
          ? "agent_paused"
          : action === "validate"
            ? "agent_validated"
            : action === "resume-paper"
              ? "agent_paper_resumed"
              : "agent_paper_started";
      const event = createAgenticAuditEvent({
        event_id: eventId,
        aggregate_type: "agent",
        aggregate_id: agentId,
        event_type: eventType,
        occurred_at: new Date(nowSeconds * 1000).toISOString(),
        actor: "owner",
        environment: "paper",
        payload: {
          from: current,
          to: target,
          reason: "explicit_owner_request",
          execution_triggered: false,
          specification_hash: spec.specification_hash,
          policy_hash: policy.policy_hash,
          capital_hash: capital.record_hash,
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
      const scheduleState = action === "kill" ? "killed" : action === "pause" ? "paused" : new Set(["start-paper", "resume-paper"]).has(action) ? "active" : "draft";
      const nextRunAt = scheduleState === "active" ? nowSeconds : null;
      const nextSchedule = updateScheduleRecord(schedule, { state: scheduleState, nextRunAt, nowSeconds, currentSpecId: row.current_spec_id });
      const statements = [insert, update];
      if (action !== "validate") {
        statements.push(db.prepare(`
          UPDATE ravenos_agent_paper_schedules
          SET schedule_hash = ?, state = ?, next_run_at = ?, schedule_json = ?, updated_at = ?
          WHERE schedule_id = ? AND agent_id = ? AND user_id = ? AND state = ?
        `).bind(
          nextSchedule.schedule_hash, scheduleState, nextRunAt, JSON.stringify(nextSchedule), nowSeconds,
          row.schedule_id, agentId, userId, row.schedule_state,
        ));
      }
      const results = await db.batch(statements);
      const inserted = Number(results?.[0]?.meta?.changes ?? results?.[0]?.changes ?? 0);
      const changed = Number(results?.[1]?.meta?.changes ?? results?.[1]?.changes ?? 0);
      const scheduleChanged = action === "validate" ? 1 : Number(results?.[2]?.meta?.changes ?? results?.[2]?.changes ?? 0);
      if (inserted !== 1 || changed !== 1 || scheduleChanged !== 1) return { ok: false, error: "agent_transition_conflict", status: 409 };
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
  if (!Number.isFinite(contentLength) || contentLength < 0) return response({ ok: false, error: "request_size_invalid" }, null, 400);
  if (match.kind === "create_draft") {
    if (contentLength > MAX_DRAFT_REQUEST_BYTES) return response({ ok: false, error: "request_too_large" }, null, 413);
  } else if (contentLength > 0 || request.body !== null) {
    return response({ ok: false, error: "request_body_not_allowed" }, null, 400);
  }
  const authorize = dependencies.authorize || authorizeCustomerApiRequest;
  const authorization = await authorize(request, env, {}, { require_csrf: match.kind !== "workspace" });
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
    if (match.kind === "create_draft") {
      const draft = await parseBoundedJsonBody(request, { max_bytes: MAX_DRAFT_REQUEST_BYTES });
      const created = await store.createDraft({
        user_id: authorization.principal.user_id,
        draft,
        now_seconds: authorization.now,
      });
      return response({ ...created, schema_version: "ravenos.agentic.paper_agent_draft_result.v1", live_execution_enabled: false }, authorization, created.status || (created.ok ? 201 : 409));
    }
    const transition = await store.transitionAgent({
      user_id: authorization.principal.user_id,
      agent_id: match.agent_id,
      action: match.action,
      now_seconds: authorization.now,
    });
    return response({ ...transition, schema_version: "ravenos.agentic.agent_transition.v1", live_execution_enabled: false }, authorization, transition.status || (transition.ok ? 200 : 409));
  } catch (error) {
    const errorCode = clean(error?.code || error?.message || "agentic_workspace_unavailable", 120);
    const clientError = /(?:_invalid|_required|_unsupported|_out_of_bounds|_forbidden|explicit_adoption|required|below_leg_notional|must_be_below)/.test(errorCode);
    return response({ ok: false, error: errorCode, live_execution_enabled: false }, authorization, clientError ? 400 : 503);
  }
}
