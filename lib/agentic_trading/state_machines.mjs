import { normalizeTimestamp } from "../customer_trade/contracts.mjs";
import { agenticContractHash } from "./hashing.mjs";
import {
  AgenticLiveDefaults,
  AgenticTradingSchemas,
  AgentLifecycleStates,
  PlanLifecycleStates,
} from "./constants.mjs";
import {
  agenticRecordReference,
  verifyAgenticRecord,
} from "./records.mjs";

export { AgentLifecycleStates, PlanLifecycleStates } from "./constants.mjs";

const AGENT_TRANSITIONS = Object.freeze({
  draft: ["validated", "killed", "expired", "failed"],
  validated: ["paper", "killed", "expired", "failed"],
  paper: ["paper_paused", "paper_accepted", "paused", "killed", "expired", "failed"],
  paper_paused: ["paper", "killed", "expired", "failed"],
  paper_accepted: ["live_candidate", "paper_paused", "killed", "expired", "failed"],
  live_candidate: ["live", "paused", "killed", "expired", "failed"],
  live: ["paused", "killed", "expired", "failed"],
  paused: ["paper", "live", "killed", "expired", "failed"],
  killed: [],
  expired: [],
  failed: [],
});

const PLAN_TRANSITIONS = Object.freeze({
  proposed: ["validated", "cancelled", "expired", "failed"],
  validated: ["policy_pending", "cancelled", "expired", "failed"],
  policy_pending: ["approval_required", "approved", "cancelled", "expired", "failed"],
  approval_required: ["approved", "cancelled", "expired", "failed"],
  approved: ["previewing", "cancelled", "expired", "failed"],
  previewing: ["ready", "reconciliation_required", "cancelled", "expired", "failed"],
  ready: ["executing", "cancelled", "expired", "failed"],
  executing: ["partially_executed", "reconciliation_required", "completed", "failed"],
  partially_executed: ["reconciliation_required", "compensation_required", "failed"],
  reconciliation_required: ["completed", "partially_executed", "compensation_required", "failed"],
  compensation_required: ["compensating", "cancelled", "failed"],
  compensating: ["compensated", "reconciliation_required", "failed"],
  compensated: [],
  completed: [],
  failed: [],
  cancelled: [],
  expired: [],
});

const RESOLVED_REQUIRED_LEG_STATES = new Set(["filled", "reconciled", "compensated"]);
const SUCCESSFUL_LEG_STATES = new Set(["filled", "reconciled"]);
const FAILED_OR_UNRESOLVED_LEG_STATES = new Set(["pending", "ready", "partially_filled", "failed", "expired", "ambiguous"]);

function text(value) {
  return String(value ?? "").trim();
}

function requiredText(value, field) {
  const normalized = text(value);
  if (!normalized) throw new Error(`${field}_required`);
  return normalized;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function sealLifecycleRecord(schemaVersion, recordType, payload) {
  if (!new Set(["AgentLifecycle", "PlanLifecycle"]).has(recordType)) throw new Error("lifecycle_record_type_invalid");
  const core = { schema_version: schemaVersion, record_type: recordType, ...structuredClone(payload) };
  const record = deepFreeze({ ...core, record_hash: agenticContractHash(core) });
  const verification = verifyAgenticRecord(record, recordType);
  if (!verification.ok) throw new Error(verification.error);
  return record;
}

function transitionEvent({ subjectId, from, to, occurredAt, reasonCode, previousEventHash, evidenceRefs = [] }) {
  const core = {
    event_id: `${subjectId}:${occurredAt}:${to}`,
    subject_id: subjectId,
    from,
    to,
    occurred_at: occurredAt,
    reason_code: reasonCode,
    evidence_refs: structuredClone(evidenceRefs),
    previous_event_hash: previousEventHash,
  };
  return deepFreeze({ ...core, event_hash: agenticContractHash(core) });
}

function verifyEventChain(events, recordType) {
  let previousEventHash = null;
  for (const [index, event] of events.entries()) {
    const { event_hash: eventHash, ...core } = event;
    if (!eventHash || agenticContractHash(core) !== eventHash || event.previous_event_hash !== previousEventHash) {
      throw new Error("lifecycle_event_chain_invalid");
    }
    if (index > 0) {
      const allowed = recordType === "AgentLifecycle"
        ? canTransitionAgentState(event.from, event.to)
        : canTransitionPlanState(event.from, event.to);
      if (!allowed) throw new Error("lifecycle_transition_path_invalid");
    }
    previousEventHash = eventHash;
  }
  return true;
}

function checkedLifecycle(lifecycle, recordType) {
  const result = verifyAgenticRecord(lifecycle, recordType);
  if (!result.ok) throw new Error(result.error);
  verifyEventChain(lifecycle.events, recordType);
  if (lifecycle.events.at(-1)?.to !== lifecycle.current_state) throw new Error("lifecycle_current_state_invalid");
  return lifecycle;
}

export function verifyLifecycle(lifecycle, expectedType = null) {
  try {
    checkedLifecycle(lifecycle, expectedType || lifecycle?.record_type);
    return { ok: true, lifecycle };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

export function canTransitionAgentState(from, to, _featureFlags = AgenticLiveDefaults) {
  if (!AGENT_TRANSITIONS[from]?.includes(to)) return false;
  if (to === "live") return false;
  return true;
}

export function canTransitionPlanState(from, to) {
  return Boolean(PLAN_TRANSITIONS[from]?.includes(to));
}

export function createAgentLifecycle(input = {}) {
  const specResult = verifyAgenticRecord(input.agent_spec, "AgentSpec");
  if (!specResult.ok) throw new Error(specResult.error);
  const agentSpec = specResult.record;
  const occurredAt = normalizeTimestamp(input.occurred_at, "agent_lifecycle_occurred_at");
  const initialState = agentSpec.lifecycle_state;
  if (!AgentLifecycleStates.includes(initialState)) throw new Error("agent_lifecycle_state_invalid");
  const event = transitionEvent({
    subjectId: agentSpec.agent_id,
    from: null,
    to: initialState,
    occurredAt,
    reasonCode: requiredText(input.reason_code || "agent_spec_created", "agent_lifecycle_reason_code"),
    previousEventHash: null,
    evidenceRefs: [agenticRecordReference(agentSpec)],
  });
  return sealLifecycleRecord(AgenticTradingSchemas.agent_lifecycle, "AgentLifecycle", {
    lifecycle_id: text(input.lifecycle_id) || `agent-lifecycle:${agentSpec.agent_id}`,
    subject_ref: agenticRecordReference(agentSpec),
    current_state: initialState,
    events: [event],
    previous_lifecycle_hash: null,
    updated_at: occurredAt,
  });
}

export function transitionAgentLifecycle(lifecycleInput, to, context = {}) {
  const lifecycle = checkedLifecycle(lifecycleInput, "AgentLifecycle");
  const target = text(to).toLowerCase();
  if (!AgentLifecycleStates.includes(target)) throw new Error("agent_lifecycle_target_invalid");
  if (target === "live") throw new Error("agent_live_execution_disabled");
  if (!canTransitionAgentState(lifecycle.current_state, target)) {
    throw new Error(`invalid_agent_transition:${lifecycle.current_state}->${target}`);
  }
  if (new Set(["live_candidate", "live"]).has(target)) {
    if (context.explicit_owner_approval !== true) throw new Error("agent_live_owner_approval_required");
    if (context.legal_release_recorded !== true) throw new Error("agent_live_legal_release_required");
  }
  const occurredAt = normalizeTimestamp(context.occurred_at, "agent_transition_occurred_at");
  if (Date.parse(occurredAt) <= Date.parse(lifecycle.updated_at)) throw new Error("agent_transition_time_invalid");
  const event = transitionEvent({
    subjectId: lifecycle.subject_ref.record_id,
    from: lifecycle.current_state,
    to: target,
    occurredAt,
    reasonCode: requiredText(context.reason_code, "agent_transition_reason_code"),
    previousEventHash: lifecycle.events.at(-1).event_hash,
    evidenceRefs: Array.isArray(context.evidence_refs) ? context.evidence_refs : [],
  });
  return sealLifecycleRecord(AgenticTradingSchemas.agent_lifecycle, "AgentLifecycle", {
    lifecycle_id: lifecycle.lifecycle_id,
    subject_ref: lifecycle.subject_ref,
    current_state: target,
    events: [...lifecycle.events, event],
    previous_lifecycle_hash: lifecycle.record_hash,
    updated_at: occurredAt,
  });
}

export function createPlanLifecycle(input = {}) {
  const planResult = verifyAgenticRecord(input.plan, "TradePlan");
  if (!planResult.ok) throw new Error(planResult.error);
  const plan = planResult.record;
  const occurredAt = normalizeTimestamp(input.occurred_at, "plan_lifecycle_occurred_at");
  const event = transitionEvent({
    subjectId: plan.plan_id,
    from: null,
    to: "proposed",
    occurredAt,
    reasonCode: requiredText(input.reason_code || "trade_plan_proposed", "plan_lifecycle_reason_code"),
    previousEventHash: null,
    evidenceRefs: [agenticRecordReference(plan)],
  });
  return sealLifecycleRecord(AgenticTradingSchemas.plan_lifecycle, "PlanLifecycle", {
    lifecycle_id: text(input.lifecycle_id) || `plan-lifecycle:${plan.plan_id}`,
    subject_ref: agenticRecordReference(plan),
    required_leg_ids: [...plan.leg_order],
    current_state: "proposed",
    events: [event],
    previous_lifecycle_hash: null,
    updated_at: occurredAt,
  });
}

function normalizeLegStates(values, requiredLegIds) {
  const rows = (Array.isArray(values) ? values : []).map((entry) => ({
    leg_id: requiredText(entry.leg_id, "plan_leg_state_leg_id"),
    required: entry.required !== false,
    status: requiredText(entry.status, "plan_leg_state_status").toLowerCase(),
  }));
  const byId = new Map(rows.map((row) => [row.leg_id, row]));
  if (byId.size !== rows.length) throw new Error("plan_leg_state_duplicate");
  for (const legId of requiredLegIds) {
    if (!byId.has(legId)) rows.push({ leg_id: legId, required: true, status: "pending" });
  }
  return rows;
}

function checkedPolicyDecisions(values, planHash, occurredAt) {
  return (Array.isArray(values) ? values : []).map((decision) => {
    const result = verifyAgenticRecord(decision, "PolicyDecision");
    if (!result.ok) throw new Error(result.error);
    if (decision.plan_ref.record_hash !== planHash) throw new Error("plan_transition_policy_plan_mismatch");
    if (Date.parse(decision.expires_at) <= Date.parse(occurredAt)) throw new Error("plan_transition_policy_expired");
    if (!new Set(["allow", "require_approval"]).has(decision.result)) throw new Error("plan_transition_policy_not_allowed");
    return decision;
  });
}

function assertApprovalReady(lifecycle, context, occurredAt) {
  const decisions = checkedPolicyDecisions(context.policy_decisions, lifecycle.subject_ref.record_hash, occurredAt);
  const planDecision = decisions.find((decision) => decision.scope === "plan");
  if (!planDecision) throw new Error("plan_level_policy_decision_required");
  for (const legId of lifecycle.required_leg_ids) {
    if (!decisions.some((decision) => decision.scope === "leg" && decision.intent_ref?.leg_id === legId)) {
      throw new Error(`leg_policy_decision_required:${legId}`);
    }
  }
  if (decisions.some((decision) => decision.result === "require_approval") && context.explicit_approval !== true) {
    throw new Error("plan_explicit_approval_required");
  }
  return decisions;
}

function assertExecutionReady(lifecycle, context, occurredAt) {
  if (context.portfolio_rechecked !== true) throw new Error("plan_portfolio_recheck_required");
  if (context.capital_reserved !== true) throw new Error("plan_capital_reservation_required");
  const decisions = checkedPolicyDecisions(context.policy_decisions, lifecycle.subject_ref.record_hash, occurredAt);
  if (decisions.length === 0) throw new Error("plan_current_policy_decision_required");
  const authorizedQuoteByLeg = new Map(decisions.flatMap((decision) => decision.quote_refs || []).map((quote) => [quote.leg_id, quote]));
  const quotes = Array.isArray(context.quotes) ? context.quotes : [];
  for (const legId of lifecycle.required_leg_ids) {
    const quote = quotes.find((entry) => entry.leg_id === legId);
    if (!quote || quote.executable !== true) throw new Error(`plan_executable_quote_required:${legId}`);
    const authorizedQuote = authorizedQuoteByLeg.get(legId);
    if (!authorizedQuote || quote.quote_id !== authorizedQuote.quote_id || quote.quote_hash !== authorizedQuote.quote_hash) {
      throw new Error(`plan_quote_changed_requires_policy:${legId}`);
    }
    const expiresAt = normalizeTimestamp(quote.expires_at, `plan_quote_${legId}_expires_at`);
    if (Date.parse(expiresAt) <= Date.parse(occurredAt)) throw new Error(`plan_quote_expired:${legId}`);
    if (quote.materially_changed === true) throw new Error(`plan_quote_material_change_requires_policy:${legId}`);
  }
}

function assertPartialState(lifecycle, context) {
  const legs = normalizeLegStates(context.leg_states, lifecycle.required_leg_ids);
  if (!legs.some((entry) => SUCCESSFUL_LEG_STATES.has(entry.status))) throw new Error("partial_plan_successful_leg_required");
  if (!legs.some((entry) => entry.required && FAILED_OR_UNRESOLVED_LEG_STATES.has(entry.status))) throw new Error("partial_plan_unresolved_leg_required");
  if (!context.resulting_exposure || typeof context.resulting_exposure !== "object") throw new Error("partial_plan_resulting_exposure_required");
}

function assertCompleted(lifecycle, context) {
  const legs = normalizeLegStates(context.leg_states, lifecycle.required_leg_ids);
  const unresolved = legs.filter((entry) => entry.required && !RESOLVED_REQUIRED_LEG_STATES.has(entry.status));
  if (unresolved.length > 0) throw new Error(`plan_required_legs_unresolved:${unresolved.map((entry) => entry.leg_id).join(",")}`);
  if (context.reconciliation_complete !== true) throw new Error("plan_reconciliation_required_before_completion");
}

export function transitionPlanLifecycle(lifecycleInput, to, context = {}) {
  const lifecycle = checkedLifecycle(lifecycleInput, "PlanLifecycle");
  const target = text(to).toLowerCase();
  if (!PlanLifecycleStates.includes(target)) throw new Error("plan_lifecycle_target_invalid");
  if (!canTransitionPlanState(lifecycle.current_state, target)) throw new Error(`invalid_plan_transition:${lifecycle.current_state}->${target}`);
  const occurredAt = normalizeTimestamp(context.occurred_at, "plan_transition_occurred_at");
  if (Date.parse(occurredAt) <= Date.parse(lifecycle.updated_at)) throw new Error("plan_transition_time_invalid");
  if (target === "validated" && context.validation_passed !== true) throw new Error("plan_validation_required");
  if (target === "approved") assertApprovalReady(lifecycle, context, occurredAt);
  if (target === "executing") assertExecutionReady(lifecycle, context, occurredAt);
  if (target === "partially_executed") assertPartialState(lifecycle, context);
  if (target === "completed") assertCompleted(lifecycle, context);
  if (target === "compensation_required") {
    if (!context.resulting_exposure || typeof context.resulting_exposure !== "object") throw new Error("compensation_resulting_exposure_required");
    if (context.automatic_compensation === true) throw new Error("automatic_compensation_disabled");
  }
  if (target === "compensating") {
    if (context.automatic_compensation === true) throw new Error("automatic_compensation_disabled");
    if (!new Set(["new_policy_decision", "preauthorized_policy_decision"]).has(context.compensation_authorization)) {
      throw new Error("compensation_authorization_required");
    }
    const decisions = checkedPolicyDecisions(context.policy_decisions, lifecycle.subject_ref.record_hash, occurredAt);
    if (decisions.length === 0) throw new Error("compensation_policy_decision_required");
  }
  const event = transitionEvent({
    subjectId: lifecycle.subject_ref.record_id,
    from: lifecycle.current_state,
    to: target,
    occurredAt,
    reasonCode: requiredText(context.reason_code, "plan_transition_reason_code"),
    previousEventHash: lifecycle.events.at(-1).event_hash,
    evidenceRefs: Array.isArray(context.evidence_refs) ? context.evidence_refs : [],
  });
  return sealLifecycleRecord(AgenticTradingSchemas.plan_lifecycle, "PlanLifecycle", {
    lifecycle_id: lifecycle.lifecycle_id,
    subject_ref: lifecycle.subject_ref,
    required_leg_ids: lifecycle.required_leg_ids,
    current_state: target,
    events: [...lifecycle.events, event],
    previous_lifecycle_hash: lifecycle.record_hash,
    updated_at: occurredAt,
  });
}
