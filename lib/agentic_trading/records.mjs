import { normalizeTimestamp } from "../customer_trade/contracts.mjs";
import {
  AgenticEnvironments,
  AgenticLiveDefaults,
  AgenticTradingSchemas,
  AgentLifecycleStates,
  PolicyDecisionResults,
  PlanLifecycleStates,
} from "./constants.mjs";
import {
  normalizeAssetIdentity,
  normalizeChainIdentity,
  normalizeInstrumentIdentity,
  normalizeSettlementAsset,
  normalizeVenueIdentity,
} from "./identity.mjs";
import { verifyGovernorRecord } from "../portfolio_governor/domain.mjs";
import {
  agenticContractHash,
  agenticContractValue,
} from "./hashing.mjs";

export { AgenticLiveDefaults, AgenticTradingSchemas } from "./constants.mjs";

const RECORD_ID_FIELDS = Object.freeze({
  AgentSpec: "agent_spec_id",
  EvidencePacket: "evidence_packet_id",
  TradeIntent: "intent_id",
  CapitalTransferIntent: "transfer_intent_id",
  TradePlan: "plan_id",
  PolicyDecision: "policy_decision_id",
  ExecutionReceipt: "receipt_id",
  OutcomeRecord: "outcome_id",
  AgentLifecycle: "lifecycle_id",
  PlanLifecycle: "lifecycle_id",
});

const SCHEMA_RECORD_TYPES = Object.freeze({
  [AgenticTradingSchemas.agent_spec]: "AgentSpec",
  [AgenticTradingSchemas.evidence_packet]: "EvidencePacket",
  [AgenticTradingSchemas.trade_intent]: "TradeIntent",
  [AgenticTradingSchemas.capital_transfer_intent]: "CapitalTransferIntent",
  [AgenticTradingSchemas.trade_plan]: "TradePlan",
  [AgenticTradingSchemas.policy_decision]: "PolicyDecision",
  [AgenticTradingSchemas.execution_receipt]: "ExecutionReceipt",
  [AgenticTradingSchemas.outcome_record]: "OutcomeRecord",
  [AgenticTradingSchemas.agent_lifecycle]: "AgentLifecycle",
  [AgenticTradingSchemas.plan_lifecycle]: "PlanLifecycle",
});

const FORBIDDEN_SECRET_KEY_RE = /(?:^|_)(?:private_?key|secret_?key|seed_?phrase|mnemonic|signing_?secret|api_?key|credential)(?:$|_)/i;
const FORBIDDEN_EXECUTION_PAYLOAD_KEY_RE = /(?:^|_)(?:signed_?payload|signed_?transaction|raw_?transaction|serialized_?transaction|wallet_?signature|user_?signature|calldata|call_?data|destination_?address|recipient_?address|to_?address|broadcast_?payload|transaction_?payload|signer)(?:$|_)/i;
const STRATEGY_TYPES = new Set(["signal_following", "copy_signal", "portfolio_rebalance", "hedge", "cross_venue", "event_driven", "custom_typed"]);
const AUTONOMY_LEVELS = new Set(["propose_only", "preview", "paper"]);
const INTENT_ACTIONS = new Set(["buy", "sell", "open_long", "open_short", "close", "reduce"]);
const INTENT_AMOUNT_KINDS = new Set(["notional", "quantity"]);
const RULE_RESULTS = new Set(["pass", "fail", "require_approval", "indeterminate"]);
const RECEIPT_STATUSES = new Set(["previewed", "paper_submitted", "partially_filled", "filled", "rejected", "expired", "failed", "ambiguous"]);
const RECONCILIATION_STATUSES = new Set(["not_required", "pending", "reconciled", "disputed", "indeterminate"]);
const OUTCOME_TYPES = new Set(["no_op", "completed", "partial", "blocked", "failed", "cancelled", "expired"]);
const MATERIAL_FRESHNESS = new Set(["fresh", "current"]);
const SHA256_RE = /^[0-9a-f]{64}$/i;
const RECORD_REFERENCE_TYPES = new Set(Object.values(SCHEMA_RECORD_TYPES));
const FINALITY_STATES = new Set([
  "unknown",
  "observed",
  "processed",
  "provider_confirmed",
  "confirmed",
  "safe",
  "finalized",
  "settled",
]);
function text(value) {
  return String(value ?? "").trim();
}

function requiredText(value, field) {
  const normalized = text(value);
  if (!normalized) throw new Error(`${field}_required`);
  return normalized;
}

function enumValue(value, values, field) {
  const normalized = text(value).toLowerCase();
  if (!values.has(normalized)) throw new Error(`${field}_invalid`);
  return normalized;
}

function positiveInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${field}_invalid`);
  return parsed;
}

function nonNegativeInteger(value, field, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) throw new Error(`${field}_invalid`);
  return parsed;
}

function exactDecimal(value, field, { positive = false, signed = false, allowNull = false } = {}) {
  if (allowNull && (value === null || value === undefined || value === "")) return null;
  if (typeof value === "number") throw new Error(`${field}_must_be_decimal_string`);
  const normalized = text(value);
  const pattern = signed ? /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/ : /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
  if (!pattern.test(normalized) || (positive && /^0(?:\.0+)?$/.test(normalized))) throw new Error(`${field}_invalid`);
  return normalized;
}

function optionalTimestamp(value, field) {
  return value === null || value === undefined || value === "" ? null : normalizeTimestamp(value, field);
}

function optionalSha256(value, field) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = text(value).toLowerCase();
  if (!SHA256_RE.test(normalized)) throw new Error(`${field}_invalid`);
  return normalized;
}

function uniqueStrings(values, { lower = false } = {}) {
  const normalized = (Array.isArray(values) ? values : []).map((value) => text(value)).filter(Boolean);
  return [...new Set(lower ? normalized.map((value) => value.toLowerCase()) : normalized)].sort();
}

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function normalizeNamedSha256Fields(value, path = "record") {
  if (Array.isArray(value)) return value.map((entry, index) => normalizeNamedSha256Fields(entry, `${path}[${index}]`));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    if (key.endsWith("_sha256")) return [key, optionalSha256(entry, `${path}.${key}`)];
    return [key, normalizeNamedSha256Fields(entry, `${path}.${key}`)];
  }));
}

function assertDataOnly(value, path = "record") {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") throw new Error(`non_data_value:${path}`);
  if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0))) throw new Error(`invalid_number:${path}`);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertDataOnly(entry, `${path}[${index}]`));
    return true;
  }
  if (!value || typeof value !== "object") return true;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_SECRET_KEY_RE.test(key)) throw new Error(`forbidden_secret_field:${path}.${key}`);
    assertDataOnly(entry, `${path}.${key}`);
  }
  return true;
}

function assertNoExecutionPayloadFields(value, path = "record") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoExecutionPayloadFields(entry, `${path}[${index}]`));
    return true;
  }
  if (!value || typeof value !== "object") return true;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_EXECUTION_PAYLOAD_KEY_RE.test(key) && entry !== false && entry !== null && entry !== undefined) {
      throw new Error(`forbidden_execution_authority_field:${path}.${key}`);
    }
    assertNoExecutionPayloadFields(entry, `${path}.${key}`);
  }
  return true;
}

function normalizedObject(value, field, fallback = {}) {
  if (value === null || value === undefined) return clone(fallback);
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`${field}_invalid`);
  assertDataOnly(value, field);
  return agenticContractValue(normalizeNamedSha256Fields(value, field));
}

function assertRecordReferenceShape(value, expectedType, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field}_invalid`);
  if (!RECORD_REFERENCE_TYPES.has(value.record_type)) throw new Error(`${field}_record_type_invalid`);
  if (expectedType && value.record_type !== expectedType) throw new Error(`${field}_record_type_mismatch`);
  requiredText(value.record_id, `${field}_record_id`);
  const hash = requiredText(value.record_hash, `${field}_record_hash`).toLowerCase();
  if (!SHA256_RE.test(hash)) throw new Error(`${field}_record_hash_invalid`);
  if (value.record_type === "TradeIntent") {
    requiredText(value.plan_id, `${field}_plan_id`);
    requiredText(value.leg_id, `${field}_leg_id`);
  }
  return true;
}

function normalizeRecordReference(value, expectedType, field) {
  assertRecordReferenceShape(value, expectedType, field);
  return deepFreeze(agenticContractValue(value));
}

function assertPaperOrPreviewEnvironment(value, field) {
  if (!AgenticEnvironments.includes(value)) throw new Error(`${field}_live_execution_disabled`);
}

function assertFalse(value, field) {
  if (value !== false) throw new Error(`${field}_must_be_false`);
}

function assertCanonicalIdentity(value, normalize, field) {
  const normalized = normalize(value);
  if (agenticContractHash(normalized) !== agenticContractHash(value)) throw new Error(`${field}_not_canonical`);
  return true;
}

function agentSpecSemanticCore(record) {
  const {
    schema_version: _schemaVersion,
    record_type: _recordType,
    record_hash: _recordHash,
    agent_spec_id: _agentSpecId,
    specification_hash: _specificationHash,
    lifecycle_state: _lifecycleState,
    validated_at: _validatedAt,
    ...semanticCore
  } = record;
  return semanticCore;
}

function assertLifecycleShape(record, subjectType, states) {
  requiredText(record.lifecycle_id, "lifecycle_id");
  assertRecordReferenceShape(record.subject_ref, subjectType, "lifecycle_subject_ref");
  if (!states.includes(record.current_state)) throw new Error("lifecycle_current_state_invalid");
  if (record.record_type === "AgentLifecycle" && record.current_state === "live") throw new Error("agent_live_execution_disabled");
  if (!Array.isArray(record.events) || record.events.length === 0) throw new Error("lifecycle_events_required");
  let previousHash = null;
  let previousState = null;
  for (const [index, event] of record.events.entries()) {
    if (!event || typeof event !== "object") throw new Error(`lifecycle_event_${index}_invalid`);
    requiredText(event.event_id, `lifecycle_event_${index}_id`);
    requiredText(event.subject_id, `lifecycle_event_${index}_subject_id`);
    normalizeTimestamp(event.occurred_at, `lifecycle_event_${index}_occurred_at`);
    if (event.from !== previousState) throw new Error("lifecycle_event_state_chain_invalid");
    if (!states.includes(event.to)) throw new Error("lifecycle_event_target_invalid");
    if (record.record_type === "AgentLifecycle" && event.to === "live") throw new Error("agent_live_execution_disabled");
    if (event.previous_event_hash !== previousHash) throw new Error("lifecycle_event_hash_chain_invalid");
    const { event_hash: eventHash, ...eventCore } = event;
    if (!SHA256_RE.test(text(eventHash)) || agenticContractHash(eventCore) !== eventHash) throw new Error("lifecycle_event_integrity_invalid");
    previousHash = eventHash;
    previousState = event.to;
  }
  if (previousState !== record.current_state) throw new Error("lifecycle_current_state_invalid");
  normalizeTimestamp(record.updated_at, "lifecycle_updated_at");
}

function validateAgenticRecordShape(record) {
  assertDataOnly(record, record.record_type || "agentic_record");
  switch (record.record_type) {
    case "AgentSpec": {
      assertNoExecutionPayloadFields(record, "AgentSpec");
      requiredText(record.agent_spec_id, "agent_spec_id");
      requiredText(record.agent_id, "agent_id");
      positiveInteger(record.version, "agent_spec_version");
      requiredText(record.owner_tenant_id, "owner_tenant_id");
      requiredText(record.name, "agent_name");
      if (record.lifecycle_state !== "draft") throw new Error("agent_spec_initial_state_invalid");
      if (!Array.isArray(record.allowed_chains) || record.allowed_chains.length === 0) throw new Error("allowed_chains_required");
      if (!Array.isArray(record.allowed_venues) || record.allowed_venues.length === 0) throw new Error("allowed_venues_required");
      if (!Array.isArray(record.allowed_instruments) || record.allowed_instruments.length === 0) throw new Error("allowed_instruments_required");
      record.allowed_chains.forEach((value) => assertCanonicalIdentity(value, normalizeChainIdentity, "allowed_chain"));
      record.allowed_venues.forEach((value) => assertCanonicalIdentity(value, normalizeVenueIdentity, "allowed_venue"));
      record.allowed_instruments.forEach((value) => assertCanonicalIdentity(value, normalizeInstrumentIdentity, "allowed_instrument"));
      normalizeEvidenceRequirements(record.evidence_requirements);
      if (record.risk_policy_ref?.authority !== "user_policy") throw new Error("risk_policy_user_authority_required");
      if (record.execution_boundary?.environment !== "paper") throw new Error("agent_spec_environment_invalid");
      assertFalse(record.execution_boundary?.model_may_execute, "agent_spec_model_may_execute");
      assertFalse(record.execution_boundary?.signing_available, "agent_spec_signing_available");
      assertFalse(record.execution_boundary?.broadcasting_available, "agent_spec_broadcasting_available");
      for (const [flag, expected] of Object.entries(AgenticLiveDefaults)) {
        if (record.execution_boundary?.live_feature_flags?.[flag] !== expected) throw new Error(`agent_spec_${flag}_invalid`);
      }
      const semanticHash = agenticContractHash(agentSpecSemanticCore(record));
      if (record.specification_hash !== semanticHash) throw new Error("agent_specification_hash_mismatch");
      break;
    }
    case "EvidencePacket": {
      requiredText(record.evidence_packet_id, "evidence_packet_id");
      assertRecordReferenceShape(record.agent_spec_ref, "AgentSpec", "evidence_agent_spec_ref");
      const decisionAt = normalizeTimestamp(record.decision_at, "evidence_decision_at");
      if (!Array.isArray(record.observations)) throw new Error("evidence_observations_invalid");
      if (!Array.isArray(record.evidence_requirements)) throw new Error("evidence_requirements_invalid");
      for (const [index, observation] of record.observations.entries()) {
        requiredText(observation.observation_id, `observation_${index}_id`);
        requiredText(observation.evidence_type, `observation_${index}_type`);
        requiredText(observation.provider, `observation_${index}_provider`);
        normalizeTimestamp(observation.observed_at, `observation_${index}_observed_at`);
        normalizeTimestamp(observation.retrieved_at, `observation_${index}_retrieved_at`);
        if (!FINALITY_STATES.has(observation.finality_state)) throw new Error(`observation_${index}_finality_invalid`);
        if (observation.evidence_authority !== "none" || observation.execution_authority !== false) throw new Error("evidence_execution_authority_invalid");
        const normalizedIdentities = normalizeSourceIdentities(observation.source_identities);
        if (agenticContractHash(normalizedIdentities) !== agenticContractHash(observation.source_identities)) throw new Error("source_identities_not_canonical");
        const normalizedEnvelope = normalizeSourceEnvelope(observation.source_envelope);
        if (agenticContractHash(normalizedEnvelope) !== agenticContractHash(observation.source_envelope)) throw new Error("source_envelope_not_canonical");
        const normalizedChronology = normalizeSourceChronology(observation.source_chronology);
        if (agenticContractHash(normalizedChronology) !== agenticContractHash(observation.source_chronology)) throw new Error("source_chronology_not_canonical");
        const normalizedFunding = normalizeFundingEvidence(observation.funding_evidence);
        if (agenticContractHash(normalizedFunding) !== agenticContractHash(observation.funding_evidence)) throw new Error("funding_evidence_not_canonical");
        if (observation.funding_complete !== (normalizedFunding?.funding_complete ?? null)) throw new Error("funding_completeness_mismatch");
        for (const [key, value] of Object.entries(observation.safety || {})) optionalBoolean(value, `safety_${key}`);
      }
      const missing = missingMaterialEvidence(record.evidence_requirements, record.observations, decisionAt);
      const materialUnresolved = uniqueStrings([...missing, ...(record.contradictions || []), ...(record.unresolved_conditions || [])]);
      const expectedStatus = materialUnresolved.length === 0 ? "ready" : "indeterminate";
      if (record.status !== expectedStatus || record.execution_eligible !== (expectedStatus === "ready")) throw new Error("evidence_readiness_mismatch");
      if (agenticContractHash(record.missing_evidence || []) !== agenticContractHash(missing)) throw new Error("evidence_missing_set_mismatch");
      break;
    }
    case "TradeIntent": {
      assertNoExecutionPayloadFields(record, "TradeIntent");
      requiredText(record.intent_id, "trade_intent_id");
      requiredText(record.plan_id, "trade_intent_plan_id");
      requiredText(record.leg_id, "trade_intent_leg_id");
      assertRecordReferenceShape(record.agent_spec_ref, "AgentSpec", "trade_intent_agent_spec_ref");
      assertRecordReferenceShape(record.evidence_packet_ref, "EvidencePacket", "trade_intent_evidence_packet_ref");
      assertPaperOrPreviewEnvironment(record.environment, "trade_intent_environment");
      assertCanonicalIdentity(record.instrument, normalizeInstrumentIdentity, "trade_intent_instrument");
      if (record.instrument_id !== record.instrument.instrument_id || record.chain_id !== record.instrument.chain_id || record.venue_id !== record.instrument.venue.venue_id) {
        throw new Error("trade_intent_identity_scope_mismatch");
      }
      assertFalse(record.execution_boundary?.model_may_execute, "trade_intent_model_may_execute");
      assertFalse(record.execution_boundary?.signed_payload_allowed, "trade_intent_signed_payload_allowed");
      assertFalse(record.execution_boundary?.arbitrary_calldata_allowed, "trade_intent_arbitrary_calldata_allowed");
      assertFalse(record.execution_boundary?.arbitrary_destination_allowed, "trade_intent_arbitrary_destination_allowed");
      assertFalse(record.execution_boundary?.signing_available, "trade_intent_signing_available");
      assertFalse(record.execution_boundary?.broadcasting_available, "trade_intent_broadcasting_available");
      assertFalse(record.execution_boundary?.live_placement_enabled, "trade_intent_live_placement_enabled");
      break;
    }
    case "CapitalTransferIntent":
      assertNoExecutionPayloadFields(record, "CapitalTransferIntent");
      requiredText(record.transfer_intent_id, "capital_transfer_intent_id");
      assertRecordReferenceShape(record.agent_spec_ref, "AgentSpec", "capital_transfer_agent_spec_ref");
      assertRecordReferenceShape(record.evidence_packet_ref, "EvidencePacket", "capital_transfer_evidence_packet_ref");
      if (record.source_chain_id === record.destination_chain_id) throw new Error("capital_transfer_cross_chain_required");
      if (record.environment !== "preview" || record.manual_approval_required !== true) throw new Error("capital_transfer_manual_preview_required");
      assertFalse(record.autonomous_bridging_enabled, "capital_transfer_autonomous_bridging_enabled");
      assertFalse(record.execution_authorized, "capital_transfer_execution_authorized");
      break;
    case "TradePlan":
      assertNoExecutionPayloadFields(record, "TradePlan");
      requiredText(record.plan_id, "trade_plan_id");
      assertRecordReferenceShape(record.agent_spec_ref, "AgentSpec", "trade_plan_agent_spec_ref");
      assertRecordReferenceShape(record.evidence_packet_ref, "EvidencePacket", "trade_plan_evidence_packet_ref");
      if (!Array.isArray(record.intents) || record.intents.length === 0) throw new Error("trade_plan_intents_required");
      record.intents.forEach((value) => assertRecordReferenceShape(value, "TradeIntent", "trade_plan_intent_ref"));
      if (!Array.isArray(record.leg_order) || record.leg_order.length !== record.intents.length) throw new Error("trade_plan_leg_order_invalid");
      assertPaperOrPreviewEnvironment(record.environment, "trade_plan_environment");
      if (record.current_state !== "proposed") throw new Error("trade_plan_initial_state_invalid");
      if (record.orchestration?.atomicity_assumed !== false) throw new Error("trade_plan_atomicity_invalid");
      assertFalse(record.orchestration?.partial_completion_policy?.automatic_retry, "trade_plan_automatic_retry");
      assertFalse(record.orchestration?.partial_completion_policy?.automatic_unwind, "trade_plan_automatic_unwind");
      assertFalse(record.orchestration?.compensation_policy?.automatic_compensation_enabled, "trade_plan_automatic_compensation");
      if (!Array.isArray(record.capital_transfer_intents) || record.capital_transfer_intents.length !== 0) throw new Error("trade_plan_capital_transfer_embedded");
      assertFalse(record.live_execution_enabled, "trade_plan_live_execution_enabled");
      break;
    case "PolicyDecision":
      requiredText(record.policy_decision_id, "policy_decision_id");
      assertRecordReferenceShape(record.plan_ref, "TradePlan", "policy_plan_ref");
      if (record.intent_ref) assertRecordReferenceShape(record.intent_ref, "TradeIntent", "policy_intent_ref");
      assertRecordReferenceShape(record.evidence_packet_ref, "EvidencePacket", "policy_evidence_packet_ref");
      if (!PolicyDecisionResults.includes(record.result)) throw new Error("policy_decision_result_invalid");
      assertFalse(record.model_judgment_used, "policy_model_judgment_used");
      break;
    case "ExecutionReceipt":
      requiredText(record.receipt_id, "execution_receipt_id");
      assertRecordReferenceShape(record.plan_ref, "TradePlan", "receipt_plan_ref");
      assertRecordReferenceShape(record.intent_ref, "TradeIntent", "receipt_intent_ref");
      assertRecordReferenceShape(record.policy_decision_ref, "PolicyDecision", "receipt_policy_ref");
      assertPaperOrPreviewEnvironment(record.environment, "execution_receipt_environment");
      if (record.adapter?.environment !== record.environment) throw new Error("execution_receipt_adapter_environment_mismatch");
      if (record.simulated !== true) throw new Error("execution_receipt_simulated_required");
      assertFalse(record.live_execution_performed, "execution_receipt_live_execution_performed");
      assertFalse(record.signing_performed, "execution_receipt_signing_performed");
      assertFalse(record.broadcasting_performed, "execution_receipt_broadcasting_performed");
      break;
    case "OutcomeRecord":
      requiredText(record.outcome_id, "outcome_id");
      assertRecordReferenceShape(record.plan_ref, "TradePlan", "outcome_plan_ref");
      if (!Array.isArray(record.receipt_refs)) throw new Error("outcome_receipt_refs_invalid");
      record.receipt_refs.forEach((value) => assertRecordReferenceShape(value, "ExecutionReceipt", "outcome_receipt_ref"));
      assertPaperOrPreviewEnvironment(record.environment, "outcome_environment");
      if (record.simulated !== true) throw new Error("outcome_simulated_required");
      break;
    case "AgentLifecycle":
      assertLifecycleShape(record, "AgentSpec", AgentLifecycleStates);
      break;
    case "PlanLifecycle":
      assertLifecycleShape(record, "TradePlan", PlanLifecycleStates);
      if (!Array.isArray(record.required_leg_ids) || record.required_leg_ids.length === 0) throw new Error("plan_lifecycle_required_legs_invalid");
      break;
    default:
      throw new Error("agentic_record_type_invalid");
  }
  return true;
}

function sealAgenticRecord(schemaVersion, recordType, payload) {
  assertDataOnly(payload, recordType);
  const core = {
    schema_version: schemaVersion,
    record_type: recordType,
    ...clone(payload),
  };
  const record = deepFreeze({ ...core, record_hash: agenticContractHash(core) });
  validateAgenticRecordShape(record);
  return record;
}

function assertRecord(record, expectedType = null) {
  if (!record || typeof record !== "object") throw new Error("agentic_record_required");
  const inferredType = SCHEMA_RECORD_TYPES[record.schema_version];
  if (!inferredType || inferredType !== record.record_type) throw new Error("agentic_record_schema_invalid");
  if (expectedType && record.record_type !== expectedType) throw new Error(`${expectedType}_required`);
  const { record_hash: recordHash, ...core } = record;
  if (!recordHash || agenticContractHash(core) !== recordHash) throw new Error(`${record.record_type}_integrity_invalid`);
  validateAgenticRecordShape(record);
  return record;
}

export function verifyAgenticRecord(record, expectedType = null) {
  try {
    assertRecord(record, expectedType);
    return { ok: true, record };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

export function agenticRecordReference(record) {
  const checked = assertRecord(record);
  const idField = RECORD_ID_FIELDS[checked.record_type];
  const recordId = idField ? checked[idField] : null;
  if (!recordId) throw new Error("agentic_record_reference_invalid");
  return deepFreeze({
    record_type: checked.record_type,
    record_id: recordId,
    record_hash: checked.record_hash,
    ...(checked.version ? { version: checked.version } : {}),
    ...(checked.specification_hash ? { specification_hash: checked.specification_hash } : {}),
    ...(checked.plan_id ? { plan_id: checked.plan_id } : {}),
    ...(checked.leg_id ? { leg_id: checked.leg_id } : {}),
  });
}

function normalizePolicyReference(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  if (source.record_type === "UserPolicyVersion") {
    const verification = verifyGovernorRecord(source);
    if (!verification.ok) throw new Error("risk_policy_record_invalid");
    return deepFreeze({
      policy_id: requiredText(source.policy_id, "risk_policy_id"),
      policy_version_id: requiredText(source.policy_version_id, "risk_policy_version_id"),
      version: positiveInteger(source.version, "risk_policy_version"),
      policy_hash: requiredText(source.record_hash, "risk_policy_hash"),
      authority: "user_policy",
    });
  }
  if (source.schema_version === "ravenos.agentic.user_policy.v1") {
    const { policy_hash: policyHash, ...core } = source;
    if (!policyHash || agenticContractHash(core) !== policyHash) throw new Error("risk_policy_record_invalid");
    if (source.authority !== "user" || source.adoption_state !== "active") throw new Error("risk_policy_user_adoption_required");
    const version = positiveInteger(source.version, "risk_policy_version");
    return deepFreeze({
      policy_id: requiredText(source.policy_id, "risk_policy_id"),
      policy_version_id: text(source.policy_version_id) || `${source.policy_id}:v${version}`,
      version,
      policy_hash: policyHash,
      authority: "user_policy",
    });
  }
  return deepFreeze({
    policy_id: requiredText(source.policy_id, "risk_policy_id"),
    policy_version_id: requiredText(source.policy_version_id, "risk_policy_version_id"),
    version: positiveInteger(source.version, "risk_policy_version"),
    policy_hash: requiredText(source.policy_hash || source.record_hash, "risk_policy_hash"),
    authority: "user_policy",
  });
}

function normalizeEvidenceRequirements(values = []) {
  if (!Array.isArray(values) || values.length === 0) throw new Error("evidence_requirements_required");
  const seen = new Set();
  return values.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`evidence_requirement_invalid:${index}`);
    const requirementId = requiredText(entry.requirement_id, `evidence_requirement_id_${index}`);
    if (seen.has(requirementId)) throw new Error("evidence_requirement_duplicate");
    seen.add(requirementId);
    const minimumFinality = text(entry.minimum_finality || "provider_confirmed").toLowerCase();
    if (!FINALITY_STATES.has(minimumFinality) || minimumFinality === "unknown") throw new Error(`evidence_minimum_finality_${index}_invalid`);
    return deepFreeze({
      requirement_id: requirementId,
      evidence_type: requiredText(entry.evidence_type || entry.type, `evidence_type_${index}`),
      material: entry.material !== false,
      maximum_age_ms: positiveInteger(entry.maximum_age_ms, `evidence_maximum_age_ms_${index}`),
      minimum_finality: minimumFinality,
      allowed_providers: uniqueStrings(entry.allowed_providers, { lower: true }),
      funding_complete_required: entry.funding_complete_required === true,
      required_safety_booleans: normalizedObject(entry.required_safety_booleans, `evidence_required_safety_${index}`),
    });
  });
}

function normalizePositionSizing(input = {}) {
  const mode = enumValue(input.mode || "fixed_notional", new Set(["fixed_notional", "percent_capital", "proportional_signal"]), "position_sizing_mode");
  return deepFreeze({
    mode,
    value: exactDecimal(input.value, "position_sizing_value", { positive: true }),
    asset_id: requiredText(input.asset_id, "position_sizing_asset_id"),
    maximum_per_leg: exactDecimal(input.maximum_per_leg, "position_sizing_maximum_per_leg", { positive: true }),
    maximum_total: exactDecimal(input.maximum_total, "position_sizing_maximum_total", { positive: true }),
  });
}

function assetIdBelongsToChain(assetId, chainId) {
  return text(assetId).startsWith(`${chainId}/`);
}

function normalizeSourceStrategyContract(input) {
  if (input === null || input === undefined) return null;
  const source = normalizedObject(input, "source_strategy_contract");
  return deepFreeze({
    contract: text(source.contract) || null,
    contract_id: requiredText(source.contract_id, "source_strategy_contract_id"),
    schema_version: text(source.schema_version) || null,
    semantic_id: text(source.semantic_id) || null,
    semantic_digest: text(source.semantic_digest) || null,
    package_manifest_sha256: optionalSha256(source.package_manifest_sha256, "source_strategy_package_manifest_sha256"),
    package_integrity_sha256: optionalSha256(source.package_integrity_sha256, "source_strategy_package_integrity_sha256"),
    activation_digest_sha256: optionalSha256(source.activation_digest_sha256 || source.activation_digest, "source_strategy_activation_digest_sha256"),
    anchor_digest_sha256: optionalSha256(source.anchor_digest_sha256 || source.anchor_digest, "source_strategy_anchor_digest_sha256"),
  });
}

export function createAgentSpec(input = {}) {
  assertDataOnly(input, "agent_spec_input");
  assertNoExecutionPayloadFields(input, "agent_spec_input");
  const lifecycleState = enumValue(input.lifecycle_state || "draft", new Set(AgentLifecycleStates), "agent_lifecycle_state");
  if (new Set(["live_candidate", "live"]).has(lifecycleState)) throw new Error("live_agent_state_disabled");
  if (lifecycleState !== "draft") throw new Error("agent_spec_initial_state_invalid");
  const allowedChains = (Array.isArray(input.allowed_chains) ? input.allowed_chains : []).map(normalizeChainIdentity);
  if (allowedChains.length === 0) throw new Error("allowed_chains_required");
  const chainIds = new Set(allowedChains.map((entry) => entry.chain_id));
  if (chainIds.size !== allowedChains.length) throw new Error("allowed_chain_duplicate");
  const allowedVenues = (Array.isArray(input.allowed_venues) ? input.allowed_venues : []).map(normalizeVenueIdentity);
  if (allowedVenues.length === 0) throw new Error("allowed_venues_required");
  if (allowedVenues.some((venue) => !chainIds.has(venue.chain_id))) throw new Error("allowed_venue_chain_not_allowed");
  const venueIds = new Set(allowedVenues.map((entry) => entry.venue_id));
  if (venueIds.size !== allowedVenues.length) throw new Error("allowed_venue_duplicate");
  const allowedInstruments = (Array.isArray(input.allowed_instruments) ? input.allowed_instruments : []).map(normalizeInstrumentIdentity);
  if (allowedInstruments.length === 0) throw new Error("allowed_instruments_required");
  if (allowedInstruments.some((instrument) => !chainIds.has(instrument.chain_id) || !venueIds.has(instrument.venue.venue_id))) {
    throw new Error("allowed_instrument_scope_invalid");
  }
  const version = positiveInteger(input.version || 1, "agent_spec_version");
  const positionSizing = normalizePositionSizing(input.position_sizing);
  if (![...chainIds].some((chainId) => assetIdBelongsToChain(positionSizing.asset_id, chainId))) {
    throw new Error("position_sizing_asset_chain_not_allowed");
  }
  const startsAt = normalizeTimestamp(input.starts_at, "agent_starts_at");
  const expiresAt = optionalTimestamp(input.expires_at, "agent_expires_at");
  if (expiresAt && Date.parse(expiresAt) <= Date.parse(startsAt)) throw new Error("agent_expiry_invalid");
  const semanticCore = {
    agent_id: requiredText(input.agent_id, "agent_id"),
    version,
    owner_tenant_id: requiredText(input.owner_tenant_id || input.tenant_id, "owner_tenant_id"),
    name: requiredText(input.name, "agent_name"),
    description: text(input.description),
    strategy_type: enumValue(input.strategy_type, STRATEGY_TYPES, "strategy_type"),
    allowed_chains: allowedChains,
    allowed_venues: allowedVenues,
    allowed_instruments: allowedInstruments,
    evidence_requirements: normalizeEvidenceRequirements(input.evidence_requirements),
    entry_rules: normalizedObject(input.entry_rules, "entry_rules"),
    exit_rules: normalizedObject(input.exit_rules, "exit_rules"),
    position_sizing: positionSizing,
    multi_leg_dependency_rules: normalizedObject(input.multi_leg_dependency_rules, "multi_leg_dependency_rules", { atomicity_assumed: false }),
    hedge_requirements: normalizedObject(input.hedge_requirements, "hedge_requirements", { required: false }),
    rebalancing_rules: normalizedObject(input.rebalancing_rules, "rebalancing_rules"),
    triggers: normalizedObject(input.triggers, "triggers"),
    autonomy_level: enumValue(input.autonomy_level || "paper", AUTONOMY_LEVELS, "autonomy_level"),
    risk_policy_ref: normalizePolicyReference(input.risk_policy_ref),
    approval_requirements: normalizedObject(input.approval_requirements, "approval_requirements", { paper: false, live: true }),
    starts_at: startsAt,
    expires_at: expiresAt,
    compiler: {
      planner_model_version: requiredText(input.planner_model_version || input.compiler?.planner_model_version, "planner_model_version"),
      compiler_version: requiredText(input.compiler_version || input.compiler?.compiler_version, "compiler_version"),
    },
    source_strategy_contract: normalizeSourceStrategyContract(input.source_strategy_contract),
    execution_boundary: {
      environment: "paper",
      model_may_execute: false,
      signing_available: false,
      broadcasting_available: false,
      live_feature_flags: AgenticLiveDefaults,
    },
  };
  const specificationHash = agenticContractHash(semanticCore);
  if (input.specification_hash && input.specification_hash !== specificationHash) throw new Error("agent_specification_hash_mismatch");
  return sealAgenticRecord(AgenticTradingSchemas.agent_spec, "AgentSpec", {
    agent_spec_id: text(input.agent_spec_id) || `${semanticCore.agent_id}:v${version}`,
    ...semanticCore,
    specification_hash: specificationHash,
    lifecycle_state: lifecycleState,
    validated_at: optionalTimestamp(input.validated_at, "agent_validated_at"),
  });
}

function optionalBoolean(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "boolean") throw new Error(`${field}_invalid`);
  return value;
}

function optionalSourceScalar(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0))) throw new Error("source_scalar_invalid");
  if (!["string", "number", "boolean", "bigint"].includes(typeof value)) throw new Error("source_scalar_invalid");
  return typeof value === "bigint" ? value.toString() : value;
}

function normalizeSourceIdentities(values = []) {
  return (Array.isArray(values) ? values : []).map((entry, index) => {
    const value = optionalSourceScalar(entry?.value);
    if (value === null) throw new Error(`source_identity_${index}_value_required`);
    return deepFreeze({
      name: requiredText(entry?.name, `source_identity_${index}_name`),
      value,
      source_contract: entry?.source_contract && typeof entry.source_contract === "object"
        ? normalizedObject(entry.source_contract, `source_identity_${index}_contract`)
        : requiredText(entry?.source_contract, `source_identity_${index}_contract`),
    });
  });
}

function normalizeSourceServiceEpoch(input) {
  if (input === null || input === undefined) return null;
  const source = normalizedObject(input, "source_service_epoch");
  return deepFreeze({
    unit_path: text(source.unit_path) || null,
    unit_sha256: optionalSha256(source.unit_sha256 || source.unit_hash, "source_service_unit_sha256"),
    pid: optionalSourceScalar(source.pid),
    proc_start_ticks: optionalSourceScalar(source.proc_start_ticks),
    boot_id: text(source.boot_id) || null,
    exact_cmdline: text(source.exact_cmdline || source.cmdline) || null,
    runtime_executable: text(source.runtime_executable) || null,
    runtime_executable_sha256: optionalSha256(source.runtime_executable_sha256 || source.runtime_executable_hash, "source_service_runtime_executable_sha256"),
  });
}

function normalizeSourceEnvelope(input) {
  if (input === null || input === undefined) return null;
  const source = normalizedObject(input, "source_envelope");
  return deepFreeze({
    schema_version: text(source.schema_version) || null,
    contract: text(source.contract) || null,
    contract_id: text(source.contract_id) || null,
    semantic_id: text(source.semantic_id) || null,
    semantic_digest: text(source.semantic_digest) || null,
    row_digest_sha256: optionalSha256(source.row_digest_sha256, "source_envelope_row_digest_sha256"),
    prior_row_digest_sha256: optionalSha256(source.prior_row_digest_sha256, "source_envelope_prior_row_digest_sha256"),
    package_manifest_sha256: optionalSha256(source.package_manifest_sha256, "source_envelope_package_manifest_sha256"),
    package_integrity_sha256: optionalSha256(source.package_integrity_sha256, "source_envelope_package_integrity_sha256"),
    receipt_schema_version: optionalSourceScalar(source.receipt_schema_version),
    receipt_contract: text(source.receipt_contract) || null,
    receipt_contract_name: text(source.receipt_contract_name || source.receipt_name) || null,
    receipt_digest_sha256: optionalSha256(source.receipt_digest_sha256, "source_envelope_receipt_digest_sha256"),
    activation_digest_sha256: optionalSha256(source.activation_digest_sha256 || source.activation_digest, "source_envelope_activation_digest_sha256"),
    anchor_digest_sha256: optionalSha256(source.anchor_digest_sha256 || source.anchor_digest, "source_envelope_anchor_digest_sha256"),
    source_envelope_sha256: optionalSha256(source.source_envelope_sha256, "source_envelope_sha256"),
    source_service_epoch: normalizeSourceServiceEpoch(source.source_service_epoch),
  });
}

function normalizeSourceChronology(input = {}) {
  const primaryLogQuery = input.primary_log_query_evidence === null || input.primary_log_query_evidence === undefined
    ? null
    : normalizedObject(input.primary_log_query_evidence, "primary_log_query_evidence");
  return deepFreeze({
    observed_at_ts: optionalSourceScalar(input.observed_at_ts),
    captured_at_ts: optionalSourceScalar(input.captured_at_ts),
    available_at_ts: optionalSourceScalar(input.available_at_ts),
    cycle_started_at_ts: optionalSourceScalar(input.cycle_started_at_ts),
    provider_block_number: optionalSourceScalar(input.provider_block_number),
    provider_block_hash: text(input.provider_block_hash) || null,
    provider_block_timestamp: optionalSourceScalar(input.provider_block_timestamp),
    latest_block_at_cycle_start: optionalSourceScalar(input.latest_block_at_cycle_start),
    latest_block_at_capture: optionalSourceScalar(input.latest_block_at_capture),
    capture_lag_blocks: optionalSourceScalar(input.capture_lag_blocks),
    safe_block: optionalSourceScalar(input.safe_block),
    finalized_block: optionalSourceScalar(input.finalized_block),
    live_eligible: optionalBoolean(input.live_eligible, "source_live_eligible"),
    event_time_imputed: optionalBoolean(input.event_time_imputed, "event_time_imputed"),
    raw_result_was_list: optionalBoolean(input.raw_result_was_list, "raw_result_was_list"),
    exact_counter_deltas: input.exact_counter_deltas === null || input.exact_counter_deltas === undefined
      ? null
      : normalizedObject(input.exact_counter_deltas, "exact_counter_deltas"),
    complete_range_proven_before_cursor_advance: optionalBoolean(input.complete_range_proven_before_cursor_advance, "complete_range_proven_before_cursor_advance"),
    source_log_set_sha256: optionalSha256(input.source_log_set_sha256, "source_log_set_sha256"),
    payload_sha256: optionalSha256(input.payload_sha256, "source_payload_sha256"),
    primary_log_query_evidence: primaryLogQuery,
    raw_provider_book_ts: optionalSourceScalar(input.raw_provider_book_ts),
    raw_response_sha256: optionalSha256(input.raw_response_sha256, "source_raw_response_sha256"),
    raw_row_digest: text(input.raw_row_digest) || null,
    raw_row_sha256: optionalSha256(input.raw_row_sha256, "source_raw_row_sha256"),
    receive_monotonic_ts: optionalSourceScalar(input.receive_monotonic_ts),
    parse_complete_monotonic_ts: optionalSourceScalar(input.parse_complete_monotonic_ts),
    sample_monotonic_ts: optionalSourceScalar(input.sample_monotonic_ts),
    age_bound_ms: optionalSourceScalar(input.age_bound_ms),
    gap_bound_ms: optionalSourceScalar(input.gap_bound_ms),
    slot: optionalSourceScalar(input.slot),
    commitment: text(input.commitment) || null,
    provider_observation_time: optionalSourceScalar(input.provider_observation_time),
    process_observation_time: optionalSourceScalar(input.process_observation_time),
    source_row_digest: text(input.source_row_digest) || null,
    strict_forward_eligible_from_block: optionalSourceScalar(input.strict_forward_eligible_from_block),
    excluded_predecessor_prefix: input.excluded_predecessor_prefix === null || input.excluded_predecessor_prefix === undefined
      ? null
      : normalizedObject(input.excluded_predecessor_prefix, "excluded_predecessor_prefix"),
    migration_resume_receipt_digest: text(input.migration_resume_receipt_digest) || null,
    captured_at_semantics: text(input.captured_at_semantics) || null,
    final_head_eligibility: input.final_head_eligibility === null || input.final_head_eligibility === undefined
      ? null
      : normalizedObject(input.final_head_eligibility, "final_head_eligibility"),
  });
}

function normalizeObservationVenue(input = {}) {
  const explicitCanonicalVenue = input.canonical_venue || input.venue_identity;
  if (explicitCanonicalVenue) return normalizeVenueIdentity(explicitCanonicalVenue);
  if (input.venue && typeof input.venue === "object") return normalizeVenueIdentity(input.venue);
  if (typeof input.venue !== "string" || !text(input.venue)) return null;
  try {
    return normalizeVenueIdentity(input.venue);
  } catch (error) {
    if (String(error?.message || error) === "venue_identity_object_required") return null;
    throw error;
  }
}

function sourceVenueValue(input = {}) {
  if (input.source_venue !== null && input.source_venue !== undefined) return text(input.source_venue) || null;
  if (input.protocol_venue !== null && input.protocol_venue !== undefined) return text(input.protocol_venue) || null;
  if (typeof input.venue === "string") return text(input.venue) || null;
  return text(input.venue?.slug || input.venue?.venue || input.venue?.name) || null;
}

function integerScalar(value) {
  const normalized = text(value);
  return /^-?[0-9]+$/.test(normalized) ? BigInt(normalized) : null;
}

function greatestCommonDivisor(left, right) {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function fundingCompleteness(record) {
  const requiredFields = [
    "root_id",
    "provider_coin",
    "boundary_ts",
    "boundary_ms",
    "request_start_ms",
    "request_end_ms",
    "raw_response_sha256",
    "raw_row",
    "raw_row_sha256",
    "official_funding_rate",
    "funding_rate_rational_numerator",
    "funding_rate_rational_denominator",
    "oracle_price",
    "oracle_price_atoms",
    "quantity_atoms",
    "position_size_atoms",
    "signed_funding_pnl_usd",
    "signed_funding_pnl_atoms",
    "pre_source_us",
    "post_source_us",
    "activation_identity_digest",
    "source_envelope_sha256",
  ];
  const missingFields = requiredFields.filter((field) => record[field] === null || record[field] === undefined || record[field] === "");
  const boundarySeconds = integerScalar(record.boundary_ts);
  const boundaryMilliseconds = integerScalar(record.boundary_ms);
  const requestStart = integerScalar(record.request_start_ms);
  const requestEnd = integerScalar(record.request_end_ms);
  const preSourceUs = integerScalar(record.pre_source_us);
  const postSourceUs = integerScalar(record.post_source_us);
  const rationalNumerator = integerScalar(record.funding_rate_rational_numerator);
  const rationalDenominator = integerScalar(record.funding_rate_rational_denominator);
  const rawTime = integerScalar(record.raw_row?.time ?? record.raw_row?.timestamp);
  const boundaryAligned = boundarySeconds !== null
    && boundaryMilliseconds !== null
    && boundarySeconds * 1_000n === boundaryMilliseconds;
  const requestBracketed = requestStart !== null
    && requestEnd !== null
    && boundaryMilliseconds !== null
    && requestStart <= boundaryMilliseconds
    && requestEnd >= boundaryMilliseconds;
  const sourceBracketed = preSourceUs !== null
    && postSourceUs !== null
    && boundaryMilliseconds !== null
    && preSourceUs < boundaryMilliseconds * 1_000n
    && postSourceUs >= boundaryMilliseconds * 1_000n;
  const rawBoundaryAligned = record.raw_time_equals_boundary_ms === true
    && rawTime !== null
    && boundaryMilliseconds !== null
    && rawTime === boundaryMilliseconds;
  const reducedRational = rationalNumerator !== null
    && rationalDenominator !== null
    && rationalDenominator > 0n
    && greatestCommonDivisor(rationalNumerator, rationalDenominator) === 1n;
  const semanticChecks = {
    boundary_aligned: boundaryAligned,
    request_bracketed: requestBracketed,
    source_bracketed: sourceBracketed,
    raw_boundary_aligned: rawBoundaryAligned,
    reduced_rational: reducedRational,
  };
  const failedChecks = Object.entries(semanticChecks).filter(([, passed]) => !passed).map(([name]) => name);
  return {
    complete: missingFields.length === 0 && failedChecks.length === 0,
    missing_fields: missingFields,
    failed_checks: failedChecks,
  };
}

function normalizeFundingEvidence(input) {
  if (input === null || input === undefined) return null;
  const source = normalizedObject(input, "funding_evidence");
  const normalized = {
    source_funding_complete: optionalBoolean(source.source_funding_complete ?? source.funding_complete, "funding_complete"),
    root_id: text(source.root_id) || null,
    provider_coin: text(source.provider_coin) || null,
    boundary_ts: optionalSourceScalar(source.boundary_ts),
    boundary_ms: optionalSourceScalar(source.boundary_ms),
    request_start_ms: optionalSourceScalar(source.request_start_ms),
    request_end_ms: optionalSourceScalar(source.request_end_ms),
    raw_response_sha256: optionalSha256(source.raw_response_sha256, "funding_raw_response_sha256"),
    raw_row: source.raw_row === null || source.raw_row === undefined ? null : normalizedObject(source.raw_row, "funding_raw_row"),
    raw_row_sha256: optionalSha256(source.raw_row_sha256, "funding_raw_row_sha256"),
    raw_time_equals_boundary_ms: optionalBoolean(source.raw_time_equals_boundary_ms, "funding_raw_time_equals_boundary_ms"),
    official_funding_rate: source.official_funding_rate === null || source.official_funding_rate === undefined ? null : text(source.official_funding_rate),
    funding_rate_rational_numerator: source.funding_rate_rational_numerator === null || source.funding_rate_rational_numerator === undefined ? null : text(source.funding_rate_rational_numerator),
    funding_rate_rational_denominator: source.funding_rate_rational_denominator === null || source.funding_rate_rational_denominator === undefined ? null : text(source.funding_rate_rational_denominator),
    oracle_price: source.oracle_price === null || source.oracle_price === undefined ? null : text(source.oracle_price),
    oracle_price_atoms: source.oracle_price_atoms === null || source.oracle_price_atoms === undefined ? null : text(source.oracle_price_atoms),
    quantity_atoms: source.quantity_atoms === null || source.quantity_atoms === undefined ? null : text(source.quantity_atoms),
    position_size_atoms: source.position_size_atoms === null || source.position_size_atoms === undefined ? null : text(source.position_size_atoms),
    signed_funding_pnl_usd: source.signed_funding_pnl_usd === null || source.signed_funding_pnl_usd === undefined ? null : text(source.signed_funding_pnl_usd),
    signed_funding_pnl_atoms: source.signed_funding_pnl_atoms === null || source.signed_funding_pnl_atoms === undefined ? null : text(source.signed_funding_pnl_atoms),
    pre_source_us: optionalSourceScalar(source.pre_source_us),
    post_source_us: optionalSourceScalar(source.post_source_us),
    activation_identity_digest: text(source.activation_identity_digest) || null,
    source_envelope_sha256: optionalSha256(source.source_envelope_sha256, "funding_source_envelope_sha256"),
  };
  const derived = fundingCompleteness(normalized);
  return deepFreeze({
    funding_complete: derived.complete,
    completeness_gate: derived.complete ? "complete" : "incomplete",
    completeness_missing_fields: derived.missing_fields,
    completeness_failed_checks: derived.failed_checks,
    ...normalized,
  });
}

function normalizeSafetyBooleans(input = {}) {
  const keys = [
    "research_only",
    "zero_capital",
    "read_only_market_access",
    "affects_execution",
    "affects_live",
    "affects_policy",
    "automatic_candidate_activation",
    "capital_authorized",
    "transaction_construction",
    "signing",
    "order_submission",
    "broadcast",
  ];
  return deepFreeze(Object.fromEntries(keys.map((key) => [key, optionalBoolean(input[key], `safety_${key}`)])));
}

function normalizeObservation(input, decisionAt, index) {
  const observedAt = normalizeTimestamp(input.observed_at, `observation_${index}_observed_at`);
  const retrievedAt = normalizeTimestamp(input.retrieved_at, `observation_${index}_retrieved_at`);
  const expiresAt = optionalTimestamp(input.expires_at, `observation_${index}_expires_at`);
  const statedFreshness = text(input.freshness_state || "unknown").toLowerCase();
  const expired = !expiresAt || Date.parse(expiresAt) <= Date.parse(decisionAt);
  const freshnessState = expired ? "stale" : statedFreshness;
  const verificationState = text(input.verification_state || "unverified").toLowerCase();
  const chain = input.chain_id || input.chain ? normalizeChainIdentity(input.chain_id || input.chain) : null;
  const venue = normalizeObservationVenue(input);
  if (venue && chain && venue.chain_id !== chain.chain_id) throw new Error("observation_venue_chain_mismatch");
  const sourceEnvelope = normalizeSourceEnvelope(input.source_envelope || input.provenance_envelope);
  const fundingEvidence = normalizeFundingEvidence(input.funding_evidence);
  const safety = normalizeSafetyBooleans(input.safety || input);
  return deepFreeze({
    observation_id: requiredText(input.observation_id, `observation_${index}_id`),
    requirement_id: text(input.requirement_id) || null,
    evidence_type: requiredText(input.evidence_type || input.type, `observation_${index}_type`),
    provider: requiredText(input.provider || input.source, `observation_${index}_provider`),
    source: requiredText(input.source || input.provider, `observation_${index}_source`),
    chain_id: chain?.chain_id || venue?.chain_id || null,
    venue_id: venue?.venue_id || null,
    observed_at: observedAt,
    retrieved_at: retrievedAt,
    expires_at: expiresAt,
    block_or_slot: text(input.block_or_slot || input.block_number || input.slot) || null,
    transaction_id: text(input.transaction_id || input.transaction_hash || input.signature) || null,
    finality_state: text(input.finality_state || "unknown").toLowerCase(),
    freshness_state: freshnessState,
    verification_state: verificationState,
    entity_id: text(input.entity_id) || null,
    instrument_id: text(input.instrument_id) || null,
    facts: normalizedObject(input.facts, `observation_${index}_facts`),
    contradictions: uniqueStrings(input.contradictions),
    unresolved_conditions: uniqueStrings(input.unresolved_conditions),
    raw_evidence_ref: text(input.raw_evidence_ref) || null,
    source_identities: normalizeSourceIdentities(input.source_identities),
    source_envelope: sourceEnvelope,
    source_service_epoch: normalizeSourceServiceEpoch(input.source_service_epoch || sourceEnvelope?.source_service_epoch),
    source_identity_fields: {
      cycle_id: text(input.cycle_id) || null,
      bar_id: text(input.bar_id) || null,
      frame_id: text(input.frame_id) || null,
      source_entry_observation_id: text(input.source_entry_observation_id) || null,
      entry_observation_id: text(input.entry_observation_id) || null,
      trigger_observation_id: text(input.trigger_observation_id) || null,
      checkpoint_observation_id: text(input.checkpoint_observation_id) || null,
      position_id: text(input.position_id || input.outcome_position_id) || null,
      outcome_position_id: text(input.outcome_position_id) || null,
      root_id: text(input.root_id) || null,
      route_evidence_digest: text(input.route_evidence_digest || input.route_evidence_reference_digest) || null,
    },
    market_identity: {
      chain_domain: text(input.chain_domain) || null,
      protocol: text(input.protocol) || null,
      venue: sourceVenueValue(input),
      factory: text(input.factory) || null,
      router: text(input.router) || null,
      quoter: text(input.quoter) || null,
      pool_manager: text(input.pool_manager) || null,
      pool_id: text(input.pool_id) || null,
      token0_address: text(input.token0_address) || null,
      token1_address: text(input.token1_address) || null,
      risk_token_address: text(input.risk_token_address) || null,
      quote_token_address: text(input.quote_token_address) || null,
      provider_coin: text(input.provider_coin) || null,
      raven_instrument_id: text(input.raven_instrument_id || input.instrument_id) || null,
      side: text(input.side) || null,
      direction: text(input.direction) || null,
      hooks: input.hooks === undefined ? null : agenticContractValue(input.hooks),
      decimals: input.decimals === undefined ? null : agenticContractValue(input.decimals),
    },
    source_chronology: normalizeSourceChronology(input.source_chronology || input),
    funding_evidence: fundingEvidence,
    source_funding_complete: fundingEvidence?.source_funding_complete ?? optionalBoolean(input.funding_complete, "funding_complete"),
    funding_complete: fundingEvidence?.funding_complete ?? null,
    safety,
    evidence_authority: "none",
    execution_authority: false,
  });
}

function finalityRank(chainId, state) {
  const normalized = text(state).toLowerCase();
  let chain;
  try {
    chain = normalizeChainIdentity(chainId);
  } catch {
    return null;
  }
  if (chain.kind === "solana") {
    return ({ unknown: 0, observed: 1, processed: 1, provider_confirmed: 2, confirmed: 2, finalized: 4 })[normalized] ?? null;
  }
  if (chain.kind === "evm") {
    return ({ unknown: 0, observed: 1, processed: 1, provider_confirmed: 2, confirmed: 2, safe: 3, finalized: 4 })[normalized] ?? null;
  }
  if (chain.kind === "venue_ledger" || chain.kind === "offchain") {
    return ({ unknown: 0, observed: 1, processed: 1, provider_confirmed: 2, confirmed: 2, finalized: 4, settled: 4 })[normalized] ?? null;
  }
  return null;
}

function meetsMinimumFinality(entry, minimumFinality) {
  const observedRank = finalityRank(entry.chain_id, entry.finality_state);
  const requiredRank = finalityRank(entry.chain_id, minimumFinality);
  return observedRank !== null && requiredRank !== null && observedRank >= requiredRank;
}

function missingMaterialEvidence(requirements, observations, at) {
  const missing = [];
  for (const requirement of requirements) {
    if (!requirement.material) continue;
    const matches = observations.filter((entry) => entry.requirement_id === requirement.requirement_id && entry.evidence_type === requirement.evidence_type);
    const usable = matches.some((entry) => {
      const age = Date.parse(at) - Date.parse(entry.observed_at);
      const expiresAt = entry.expires_at ? Date.parse(entry.expires_at) : Number.NaN;
      const providerAllowed = requirement.allowed_providers.length === 0 || requirement.allowed_providers.includes(entry.provider.toLowerCase());
      const fundingComplete = !requirement.funding_complete_required || entry.funding_complete === true;
      const safetyResolved = Object.entries(requirement.required_safety_booleans).every(([key, expected]) => entry.safety?.[key] === expected);
      return providerAllowed
        && fundingComplete
        && safetyResolved
        && meetsMinimumFinality(entry, requirement.minimum_finality)
        && age >= 0
        && age <= requirement.maximum_age_ms
        && Number.isFinite(expiresAt)
        && expiresAt > Date.parse(at)
        && MATERIAL_FRESHNESS.has(entry.freshness_state)
        && entry.verification_state === "verified"
        && entry.contradictions.length === 0
        && entry.unresolved_conditions.length === 0;
    });
    if (!usable) missing.push(requirement.requirement_id);
  }
  return missing.sort();
}

export function createEvidencePacket(input = {}) {
  assertDataOnly(input, "evidence_packet_input");
  const agentSpec = assertRecord(input.agent_spec, "AgentSpec");
  const decisionAt = normalizeTimestamp(input.decision_at, "evidence_decision_at");
  const observations = (Array.isArray(input.observations) ? input.observations : []).map((entry, index) => normalizeObservation(entry, decisionAt, index));
  const requirements = agentSpec.evidence_requirements;
  const missingEvidence = missingMaterialEvidence(requirements, observations, decisionAt);
  const contradictions = uniqueStrings([
    ...(Array.isArray(input.contradictions) ? input.contradictions : []),
    ...observations.flatMap((entry) => entry.contradictions),
  ]);
  const unresolvedConditions = uniqueStrings([
    ...(Array.isArray(input.unresolved_conditions) ? input.unresolved_conditions : []),
    ...observations.flatMap((entry) => entry.unresolved_conditions),
  ]);
  const materialUnresolved = uniqueStrings([...missingEvidence, ...contradictions, ...unresolvedConditions]);
  const status = materialUnresolved.length === 0 ? "ready" : "indeterminate";
  return sealAgenticRecord(AgenticTradingSchemas.evidence_packet, "EvidencePacket", {
    evidence_packet_id: requiredText(input.evidence_packet_id, "evidence_packet_id"),
    agent_spec_ref: agenticRecordReference(agentSpec),
    owner_tenant_id: agentSpec.owner_tenant_id,
    decision_at: decisionAt,
    unified_portfolio_snapshot_ref: normalizedObject(input.unified_portfolio_snapshot_ref, "unified_portfolio_snapshot_ref"),
    venue_account_snapshot_refs: (Array.isArray(input.venue_account_snapshot_refs) ? input.venue_account_snapshot_refs : []).map((entry, index) => normalizedObject(entry, `venue_account_snapshot_ref_${index}`)),
    observations,
    evidence_requirements: requirements,
    derived_calculations: normalizedObject(input.derived_calculations, "derived_calculations"),
    contradictions,
    missing_evidence: missingEvidence.sort(),
    unresolved_conditions: unresolvedConditions,
    status,
    execution_eligible: status === "ready",
    provenance_complete: observations.every((entry) => Boolean(entry.provider && entry.observed_at && entry.retrieved_at)),
  });
}

function normalizeEnvironment(value, field = "environment") {
  const environment = text(value || "paper").toLowerCase();
  if (!AgenticEnvironments.includes(environment)) throw new Error(`${field}_live_execution_disabled`);
  return environment;
}

function normalizeIntentAmount(input = {}) {
  const kind = enumValue(input.kind || input.type, INTENT_AMOUNT_KINDS, "intent_amount_kind");
  return deepFreeze({
    kind,
    value: exactDecimal(input.value, "intent_amount_value", { positive: true }),
    asset_id: requiredText(input.asset_id, "intent_amount_asset_id"),
  });
}

function normalizeOrderConstraints(input = {}) {
  const maximumSlippageBps = nonNegativeInteger(input.maximum_slippage_bps, "maximum_slippage_bps", 10_000);
  const maximumPriceImpactBps = nonNegativeInteger(input.maximum_price_impact_bps, "maximum_price_impact_bps", 10_000);
  const timeInForce = text(input.time_in_force || "ioc").toLowerCase();
  if (!new Set(["ioc", "fok", "gtc", "alo", "market"]).has(timeInForce)) throw new Error("time_in_force_invalid");
  return deepFreeze({
    order_type: enumValue(input.order_type || "market", new Set(["market", "limit"]), "order_type"),
    limit_price: exactDecimal(input.limit_price, "limit_price", { positive: true, allowNull: true }),
    maximum_slippage_bps: maximumSlippageBps,
    maximum_price_impact_bps: maximumPriceImpactBps,
    time_in_force: timeInForce,
    reduce_only: Boolean(input.reduce_only),
  });
}

function normalizeQuoteRequirements(input = {}) {
  return deepFreeze({
    executable_quote_required: input.executable_quote_required !== false,
    quote_expiry_required: input.quote_expiry_required !== false,
    maximum_age_ms: positiveInteger(input.maximum_age_ms, "quote_maximum_age_ms"),
    minimum_provider_confidence: text(input.minimum_provider_confidence || "high").toLowerCase(),
    reverse_exit_required: Boolean(input.reverse_exit_required),
  });
}

function normalizeGasRequirement(input, chainId) {
  const chain = normalizeChainIdentity(chainId);
  if (chain.kind === "offchain" || chain.kind === "venue_ledger") {
    return deepFreeze({ required: false, asset_id: null, minimum_balance: null, state: "not_applicable" });
  }
  if (!input || typeof input !== "object") {
    return deepFreeze({ required: true, asset_id: null, minimum_balance: null, state: "unknown" });
  }
  const state = enumValue(input.state || "unknown", new Set(["available", "insufficient", "unknown"]), "gas_requirement_state");
  const assetId = text(input.asset_id) || null;
  const minimumBalance = exactDecimal(input.minimum_balance, "gas_minimum_balance", { positive: true, allowNull: true });
  if (assetId && !assetIdBelongsToChain(assetId, chain.chain_id)) throw new Error("gas_asset_chain_mismatch");
  if (state === "available" && (!assetId || minimumBalance === null)) throw new Error("available_gas_evidence_incomplete");
  return deepFreeze({
    required: true,
    asset_id: assetId,
    minimum_balance: minimumBalance,
    state,
  });
}

function normalizeDependency(input = {}) {
  return deepFreeze({
    required_leg_ids: uniqueStrings(input.required_leg_ids),
    relationship: enumValue(input.relationship || "independent", new Set(["independent", "sequential", "hedge", "conditional"]), "intent_dependency_relationship"),
    maximum_delay_ms: input.maximum_delay_ms === null || input.maximum_delay_ms === undefined
      ? null
      : positiveInteger(input.maximum_delay_ms, "intent_dependency_maximum_delay_ms"),
  });
}

function actionCompatible(action, instrumentKind) {
  if (instrumentKind === "perpetual") return new Set(["open_long", "open_short", "close", "reduce"]).has(action);
  return new Set(["buy", "sell", "close", "reduce"]).has(action);
}

export function createTradeIntent(input = {}) {
  assertDataOnly(input, "trade_intent_input");
  assertNoExecutionPayloadFields(input, "trade_intent_input");
  const instrument = normalizeInstrumentIdentity(input.instrument);
  const chain = normalizeChainIdentity(input.chain_id || input.chain || instrument.chain_id);
  const venue = normalizeVenueIdentity(input.venue || instrument.venue);
  if (chain.chain_id !== instrument.chain_id || venue.venue_id !== instrument.venue.venue_id || venue.chain_id !== chain.chain_id) {
    throw new Error("trade_intent_identity_scope_mismatch");
  }
  const action = enumValue(input.action || input.side, INTENT_ACTIONS, "trade_intent_action");
  if (!actionCompatible(action, instrument.kind)) throw new Error("trade_intent_action_incompatible");
  const amount = normalizeIntentAmount(input.amount);
  if (!assetIdBelongsToChain(amount.asset_id, chain.chain_id)) throw new Error("trade_intent_amount_chain_mismatch");
  const settlementAsset = normalizeSettlementAsset(input.settlement_asset || { asset: instrument.settlement_asset });
  const feeAsset = normalizeSettlementAsset(input.fee_asset || { asset: instrument.settlement_asset, role: "fee" });
  if (settlementAsset.chain_id !== chain.chain_id || feeAsset.chain_id !== chain.chain_id) throw new Error("trade_intent_settlement_chain_mismatch");
  const environment = normalizeEnvironment(input.environment);
  const createdAt = normalizeTimestamp(input.created_at, "trade_intent_created_at");
  const expiresAt = normalizeTimestamp(input.expires_at, "trade_intent_expires_at");
  if (Date.parse(expiresAt) <= Date.parse(createdAt)) throw new Error("trade_intent_expiry_invalid");
  const gasRequirement = normalizeGasRequirement(input.gas_requirement, chain.chain_id);
  const quoteRequirements = normalizeQuoteRequirements(input.quote_requirements);
  const readinessReasons = [];
  if (gasRequirement.required && gasRequirement.state !== "available") readinessReasons.push(`gas_${gasRequirement.state}`);
  if (!quoteRequirements.executable_quote_required || !quoteRequirements.quote_expiry_required) readinessReasons.push("executable_expiring_quote_required");
  return sealAgenticRecord(AgenticTradingSchemas.trade_intent, "TradeIntent", {
    intent_id: requiredText(input.intent_id, "trade_intent_id"),
    plan_id: requiredText(input.plan_id, "trade_intent_plan_id"),
    leg_id: requiredText(input.leg_id, "trade_intent_leg_id"),
    agent_spec_ref: normalizeRecordReference(input.agent_spec_ref, "AgentSpec", "trade_intent_agent_spec_ref"),
    evidence_packet_ref: normalizeRecordReference(input.evidence_packet_ref, "EvidencePacket", "trade_intent_evidence_packet_ref"),
    instrument,
    instrument_id: instrument.instrument_id,
    chain_id: chain.chain_id,
    venue_id: venue.venue_id,
    action,
    amount,
    order_constraints: normalizeOrderConstraints(input.order_constraints),
    quote_requirements: quoteRequirements,
    settlement_asset: settlementAsset,
    fee_asset: feeAsset,
    gas_requirement: gasRequirement,
    rationale: {
      entry: text(input.rationale?.entry),
      exit: text(input.rationale?.exit),
    },
    dependency: normalizeDependency(input.dependency),
    idempotency_key: requiredText(input.idempotency_key, "trade_intent_idempotency_key"),
    environment,
    created_at: createdAt,
    expires_at: expiresAt,
    readiness: {
      state: readinessReasons.length === 0 ? "ready_for_policy" : "indeterminate",
      execution_eligible: readinessReasons.length === 0,
      reasons: readinessReasons,
    },
    execution_boundary: {
      model_may_execute: false,
      signed_payload_allowed: false,
      arbitrary_calldata_allowed: false,
      arbitrary_destination_allowed: false,
      signing_available: false,
      broadcasting_available: false,
      live_placement_enabled: false,
    },
  });
}

export function createCapitalTransferIntent(input = {}) {
  assertDataOnly(input, "capital_transfer_intent_input");
  assertNoExecutionPayloadFields(input, "capital_transfer_intent_input");
  const sourceChain = normalizeChainIdentity(input.source_chain_id || input.source_chain);
  const destinationChain = normalizeChainIdentity(input.destination_chain_id || input.destination_chain);
  const sourceAsset = normalizeAssetIdentity(input.source_asset);
  const destinationAsset = normalizeAssetIdentity(input.destination_asset);
  if (sourceAsset.chain_id !== sourceChain.chain_id || destinationAsset.chain_id !== destinationChain.chain_id) {
    throw new Error("capital_transfer_asset_chain_mismatch");
  }
  if (sourceChain.chain_id === destinationChain.chain_id) throw new Error("capital_transfer_cross_chain_required");
  const createdAt = normalizeTimestamp(input.created_at, "capital_transfer_created_at");
  const expiresAt = normalizeTimestamp(input.expires_at, "capital_transfer_expires_at");
  if (Date.parse(expiresAt) <= Date.parse(createdAt)) throw new Error("capital_transfer_expiry_invalid");
  const mechanism = normalizedObject(input.mechanism, "capital_transfer_mechanism");
  if (!mechanism.provider || !mechanism.route_id) throw new Error("capital_transfer_mechanism_incomplete");
  return sealAgenticRecord(AgenticTradingSchemas.capital_transfer_intent, "CapitalTransferIntent", {
    transfer_intent_id: requiredText(input.transfer_intent_id, "capital_transfer_intent_id"),
    agent_spec_ref: normalizeRecordReference(input.agent_spec_ref, "AgentSpec", "capital_transfer_agent_spec_ref"),
    evidence_packet_ref: normalizeRecordReference(input.evidence_packet_ref, "EvidencePacket", "capital_transfer_evidence_packet_ref"),
    source_chain_id: sourceChain.chain_id,
    destination_chain_id: destinationChain.chain_id,
    source_asset: sourceAsset,
    destination_asset: destinationAsset,
    amount: exactDecimal(input.amount, "capital_transfer_amount", { positive: true }),
    mechanism,
    fees: normalizedObject(input.fees, "capital_transfer_fees"),
    trust_dependencies: uniqueStrings(input.trust_dependencies),
    expected_timing: normalizedObject(input.expected_timing, "capital_transfer_expected_timing"),
    source_gas_requirement: normalizeGasRequirement(input.source_gas_requirement, sourceChain.chain_id),
    destination_gas_requirement: normalizeGasRequirement(input.destination_gas_requirement, destinationChain.chain_id),
    finality_assumptions: uniqueStrings(input.finality_assumptions),
    reconciliation_requirements: uniqueStrings(input.reconciliation_requirements),
    manual_approval_required: true,
    autonomous_bridging_enabled: false,
    execution_authorized: false,
    environment: "preview",
    created_at: createdAt,
    expires_at: expiresAt,
    idempotency_key: requiredText(input.idempotency_key, "capital_transfer_idempotency_key"),
  });
}

function normalizeDependencyEdges(values, legIds) {
  const edges = (Array.isArray(values) ? values : []).map((entry, index) => {
    const fromLegId = requiredText(entry.from_leg_id, `dependency_${index}_from_leg_id`);
    const toLegId = requiredText(entry.to_leg_id, `dependency_${index}_to_leg_id`);
    if (fromLegId === toLegId) throw new Error("trade_plan_dependency_self_reference");
    if (!legIds.has(fromLegId) || !legIds.has(toLegId)) throw new Error("trade_plan_dependency_unknown_leg");
    return deepFreeze({
      from_leg_id: fromLegId,
      to_leg_id: toLegId,
      relationship: enumValue(entry.relationship || "sequential", new Set(["sequential", "hedge", "conditional"]), "trade_plan_dependency_relationship"),
      required: entry.required !== false,
      maximum_delay_ms: positiveInteger(entry.maximum_delay_ms, `dependency_${index}_maximum_delay_ms`),
    });
  });
  const seenEdges = new Set();
  for (const edge of edges) {
    const key = `${edge.from_leg_id}->${edge.to_leg_id}`;
    if (seenEdges.has(key)) throw new Error("trade_plan_dependency_duplicate");
    seenEdges.add(key);
  }
  const adjacency = new Map([...legIds].map((legId) => [legId, []]));
  edges.forEach((edge) => adjacency.get(edge.from_leg_id).push(edge.to_leg_id));
  const visiting = new Set();
  const visited = new Set();
  function visit(legId) {
    if (visiting.has(legId)) throw new Error("trade_plan_dependency_cycle");
    if (visited.has(legId)) return;
    visiting.add(legId);
    adjacency.get(legId).forEach(visit);
    visiting.delete(legId);
    visited.add(legId);
  }
  [...legIds].forEach(visit);
  return edges;
}

function normalizePartialCompletionPolicy(input = {}) {
  return deepFreeze({
    state_on_required_leg_failure: enumValue(
      input.state_on_required_leg_failure || "partially_executed",
      new Set(["partially_executed", "reconciliation_required"]),
      "partial_completion_failure_state",
    ),
    expose_resulting_unhedged_position: input.expose_resulting_unhedged_position !== false,
    automatic_retry: false,
    automatic_unwind: false,
    retry_requires_new_policy_decision: true,
    unwind_requires_new_policy_decision: true,
  });
}

export function createTradePlan(input = {}) {
  assertDataOnly(input, "trade_plan_input");
  assertNoExecutionPayloadFields(input, "trade_plan_input");
  const agentSpec = assertRecord(input.agent_spec, "AgentSpec");
  const evidencePacket = assertRecord(input.evidence_packet, "EvidencePacket");
  if (evidencePacket.agent_spec_ref.record_hash !== agentSpec.record_hash) throw new Error("trade_plan_evidence_agent_mismatch");
  const intents = (Array.isArray(input.intents) ? input.intents : []).map((entry) => assertRecord(entry, "TradeIntent"));
  if (intents.length === 0) throw new Error("trade_plan_intents_required");
  const planId = requiredText(input.plan_id, "trade_plan_id");
  if (intents.some((intent) => intent.plan_id !== planId)) throw new Error("trade_plan_intent_plan_mismatch");
  const legIds = new Set(intents.map((intent) => intent.leg_id));
  if (legIds.size !== intents.length) throw new Error("trade_plan_leg_duplicate");
  const idempotencyKeys = new Set(intents.map((intent) => intent.idempotency_key));
  if (idempotencyKeys.size !== intents.length) throw new Error("trade_plan_idempotency_duplicate");
  const specRef = agenticRecordReference(agentSpec);
  const evidenceRef = agenticRecordReference(evidencePacket);
  if (intents.some((intent) => intent.agent_spec_ref.record_hash !== specRef.record_hash || intent.evidence_packet_ref.record_hash !== evidenceRef.record_hash)) {
    throw new Error("trade_plan_intent_evidence_mismatch");
  }
  const environment = normalizeEnvironment(input.environment);
  if (intents.some((intent) => intent.environment !== environment)) throw new Error("trade_plan_environment_mismatch");
  const createdAt = normalizeTimestamp(input.created_at, "trade_plan_created_at");
  const expiresAt = normalizeTimestamp(input.expires_at, "trade_plan_expires_at");
  if (Date.parse(expiresAt) <= Date.parse(createdAt)) throw new Error("trade_plan_expiry_invalid");
  if (intents.some((intent) => Date.parse(intent.expires_at) > Date.parse(expiresAt))) throw new Error("trade_plan_leg_expiry_exceeds_plan");
  const dependencies = normalizeDependencyEdges(input.dependencies, legIds);
  const venues = new Set(intents.map((intent) => intent.venue_id));
  const chains = new Set(intents.map((intent) => intent.chain_id));
  const combinedPortfolioEffect = normalizedObject(input.combined_expected_portfolio_effect, "combined_expected_portfolio_effect");
  const combinedEffectState = text(combinedPortfolioEffect.state || "unknown").toLowerCase();
  const combinedEffectResolved = new Set(["resolved", "exact", "estimated_with_bounds"]).has(combinedEffectState)
    && (!Array.isArray(combinedPortfolioEffect.unresolved_conditions) || combinedPortfolioEffect.unresolved_conditions.length === 0);
  const currentState = enumValue(input.current_state || "proposed", new Set(PlanLifecycleStates), "trade_plan_state");
  if (currentState !== "proposed") throw new Error("trade_plan_initial_state_invalid");
  return sealAgenticRecord(AgenticTradingSchemas.trade_plan, "TradePlan", {
    plan_id: planId,
    agent_spec_ref: specRef,
    evidence_packet_ref: evidenceRef,
    owner_tenant_id: agentSpec.owner_tenant_id,
    purpose: requiredText(input.purpose, "trade_plan_purpose"),
    intents: intents.map(agenticRecordReference),
    leg_order: intents.map((intent) => intent.leg_id),
    dependencies,
    orchestration: {
      venue_count: venues.size,
      chain_count: chains.size,
      cross_venue: venues.size > 1,
      cross_chain: chains.size > 1,
      atomicity_assumed: false,
      maximum_time_between_legs_ms: positiveInteger(input.maximum_time_between_legs_ms, "trade_plan_maximum_time_between_legs_ms"),
      partial_completion_policy: normalizePartialCompletionPolicy(input.partial_completion_policy),
      retry_policy: {
        maximum_attempts_per_leg: nonNegativeInteger(input.retry_policy?.maximum_attempts_per_leg ?? 0, "retry_maximum_attempts", 10),
        requote_required: true,
        policy_reevaluation_required: true,
        retry_after_expiry_allowed: false,
      },
      compensation_policy: {
        mode: enumValue(input.compensation_policy?.mode || "new_policy_decision_required", new Set(["new_policy_decision_required", "preauthorized_policy_decision_required"]), "compensation_policy_mode"),
        automatic_compensation_enabled: false,
      },
    },
    combined_expected_portfolio_effect: combinedPortfolioEffect,
    combined_effect_resolved: combinedEffectResolved,
    environment,
    idempotency_key: requiredText(input.idempotency_key, "trade_plan_idempotency_key"),
    created_at: createdAt,
    expires_at: expiresAt,
    current_state: currentState,
    capital_transfer_intents: [],
    live_execution_enabled: false,
  });
}

function normalizeEvaluatedRules(values = []) {
  if (!Array.isArray(values) || values.length === 0) return [];
  const seen = new Set();
  return values.map((entry, index) => {
    const ruleId = requiredText(entry.rule_id, `policy_rule_${index}_id`);
    if (seen.has(ruleId)) throw new Error("policy_rule_duplicate");
    seen.add(ruleId);
    const result = enumValue(entry.result, RULE_RESULTS, `policy_rule_${index}_result`);
    return deepFreeze({
      rule_id: ruleId,
      result,
      observed_value: entry.observed_value === undefined ? null : agenticContractValue(entry.observed_value),
      configured_limit: entry.configured_limit === undefined ? null : agenticContractValue(entry.configured_limit),
      reason: text(entry.reason),
      missing_inputs: uniqueStrings(entry.missing_inputs),
    });
  });
}

function normalizePolicyQuoteRefs(values = []) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).map((entry, index) => {
    const legId = requiredText(entry.leg_id, `policy_quote_${index}_leg_id`);
    if (seen.has(legId)) throw new Error("policy_quote_leg_duplicate");
    seen.add(legId);
    return deepFreeze({
      leg_id: legId,
      quote_id: requiredText(entry.quote_id, `policy_quote_${index}_id`),
      quote_hash: requiredText(entry.quote_hash || entry.record_hash, `policy_quote_${index}_hash`),
      provider: requiredText(entry.provider, `policy_quote_${index}_provider`),
      observed_at: normalizeTimestamp(entry.observed_at, `policy_quote_${index}_observed_at`),
      expires_at: normalizeTimestamp(entry.expires_at, `policy_quote_${index}_expires_at`),
      executable: entry.executable === true,
    });
  });
}

function policyResultFor({ rules, evidencePacket, plan, inputMissing, decidedAt, quoteRefs, requiredQuoteLegIds }) {
  const currentEvidenceMissing = missingMaterialEvidence(evidencePacket.evidence_requirements, evidencePacket.observations, decidedAt);
  const quoteMissing = requiredQuoteLegIds.filter((legId) => {
    const quote = quoteRefs.find((entry) => entry.leg_id === legId);
    return !quote || !quote.executable || Date.parse(quote.observed_at) > Date.parse(decidedAt) || Date.parse(quote.expires_at) <= Date.parse(decidedAt);
  }).map((legId) => `quote:${legId}`);
  const missingInputs = uniqueStrings([
    ...inputMissing,
    ...rules.flatMap((rule) => rule.missing_inputs),
    ...(evidencePacket.execution_eligible ? [] : evidencePacket.missing_evidence),
    ...currentEvidenceMissing,
    ...quoteMissing,
    ...(plan.combined_effect_resolved ? [] : ["combined_portfolio_effect"]),
  ]);
  if (rules.some((rule) => rule.result === "fail")) return { result: "block", missingInputs };
  if (!evidencePacket.execution_eligible || missingInputs.length > 0 || rules.length === 0 || rules.some((rule) => rule.result === "indeterminate")) {
    return { result: "indeterminate", missingInputs };
  }
  if (rules.some((rule) => rule.result === "require_approval")) return { result: "require_approval", missingInputs };
  return { result: "allow", missingInputs };
}

export function createPolicyDecision(input = {}) {
  assertDataOnly(input, "policy_decision_input");
  const plan = assertRecord(input.plan, "TradePlan");
  const evidencePacket = assertRecord(input.evidence_packet, "EvidencePacket");
  if (plan.evidence_packet_ref.record_hash !== evidencePacket.record_hash) throw new Error("policy_decision_evidence_mismatch");
  const intent = input.intent ? assertRecord(input.intent, "TradeIntent") : null;
  if (intent && !plan.intents.some((ref) => ref.record_hash === intent.record_hash)) throw new Error("policy_decision_intent_not_in_plan");
  const scope = enumValue(input.scope || (intent ? "leg" : "plan"), new Set(["plan", "leg"]), "policy_decision_scope");
  if ((scope === "leg") !== Boolean(intent)) throw new Error("policy_decision_scope_mismatch");
  const rules = normalizeEvaluatedRules(input.evaluated_rules);
  const decidedAt = normalizeTimestamp(input.decided_at, "policy_decision_decided_at");
  if (Date.parse(plan.expires_at) <= Date.parse(decidedAt)) throw new Error("policy_decision_plan_expired");
  if (intent && Date.parse(intent.expires_at) <= Date.parse(decidedAt)) throw new Error("policy_decision_intent_expired");
  const quoteRefs = normalizePolicyQuoteRefs(input.quote_refs);
  const requiredQuoteLegIds = scope === "leg" ? [intent.leg_id] : [...plan.leg_order];
  const derived = policyResultFor({
    rules,
    evidencePacket,
    plan,
    inputMissing: uniqueStrings(input.missing_inputs),
    decidedAt,
    quoteRefs,
    requiredQuoteLegIds,
  });
  const requestedResult = text(input.result).toLowerCase();
  if (requestedResult && !PolicyDecisionResults.includes(requestedResult)) throw new Error("policy_decision_result_invalid");
  if (requestedResult && PolicyDecisionResults.includes(requestedResult) && requestedResult !== derived.result) {
    if (requestedResult === "allow") {
      // The record preserves the deterministic fail-closed result instead of trusting a requested allow.
    } else {
      throw new Error("policy_decision_result_mismatch");
    }
  }
  const expiresAt = normalizeTimestamp(input.expires_at, "policy_decision_expires_at");
  if (Date.parse(expiresAt) <= Date.parse(decidedAt)) throw new Error("policy_decision_expiry_invalid");
  if (Date.parse(expiresAt) > Date.parse(plan.expires_at) || (intent && Date.parse(expiresAt) > Date.parse(intent.expires_at))) {
    throw new Error("policy_decision_outlives_subject");
  }
  return sealAgenticRecord(AgenticTradingSchemas.policy_decision, "PolicyDecision", {
    policy_decision_id: requiredText(input.policy_decision_id, "policy_decision_id"),
    scope,
    plan_ref: agenticRecordReference(plan),
    intent_ref: intent ? agenticRecordReference(intent) : null,
    evidence_packet_ref: agenticRecordReference(evidencePacket),
    portfolio_snapshot_ref: normalizedObject(input.portfolio_snapshot_ref, "policy_portfolio_snapshot_ref"),
    policy_ref: normalizePolicyReference(input.policy_ref),
    result: derived.result,
    evaluated_rules: rules,
    quote_refs: quoteRefs,
    missing_inputs: derived.missingInputs,
    combined_portfolio_effect: plan.combined_expected_portfolio_effect,
    partial_execution_analysis: normalizedObject(input.partial_execution_analysis, "partial_execution_analysis"),
    reasons: uniqueStrings(input.reasons),
    decided_at: decidedAt,
    expires_at: expiresAt,
    deterministic_engine_version: requiredText(input.deterministic_engine_version, "deterministic_engine_version"),
    model_judgment_used: false,
  });
}

function normalizeCostComponent(input, field) {
  if (!input || typeof input !== "object") return null;
  return deepFreeze({
    amount: exactDecimal(input.amount, `${field}_amount`, { allowNull: true }),
    asset_id: text(input.asset_id) || null,
    state: enumValue(input.state || (input.amount === null || input.amount === undefined ? "unknown" : "observed"), new Set(["observed", "estimated", "unknown", "not_applicable"]), `${field}_state`),
  });
}

function normalizePreviewQuote(input = {}) {
  const observedAt = normalizeTimestamp(input.observed_at, "receipt_quote_observed_at");
  const expiresAt = normalizeTimestamp(input.expires_at, "receipt_quote_expires_at");
  if (Date.parse(expiresAt) <= Date.parse(observedAt)) throw new Error("receipt_quote_expiry_invalid");
  return deepFreeze({
    quote_id: requiredText(input.quote_id, "receipt_quote_id"),
    quote_hash: requiredText(input.quote_hash || input.record_hash, "receipt_quote_hash"),
    provider: requiredText(input.provider, "receipt_quote_provider"),
    observed_at: observedAt,
    expires_at: expiresAt,
    executable: Boolean(input.executable),
    requested_amount: exactDecimal(input.requested_amount, "receipt_quote_requested_amount", { positive: true }),
    expected_output: exactDecimal(input.expected_output, "receipt_quote_expected_output", { positive: true, allowNull: true }),
    minimum_output: exactDecimal(input.minimum_output, "receipt_quote_minimum_output", { positive: true, allowNull: true }),
    price_impact_bps: input.price_impact_bps === null || input.price_impact_bps === undefined
      ? null
      : nonNegativeInteger(input.price_impact_bps, "receipt_quote_price_impact_bps", 1_000_000),
    fees: {
      venue: normalizeCostComponent(input.fees?.venue, "receipt_quote_venue_fee"),
      network: normalizeCostComponent(input.fees?.network, "receipt_quote_network_fee"),
      funding: normalizeCostComponent(input.fees?.funding, "receipt_quote_funding"),
      raven: normalizeCostComponent(input.fees?.raven, "receipt_quote_raven_fee"),
    },
    provider_evidence_ref: requiredText(input.provider_evidence_ref, "receipt_quote_provider_evidence_ref"),
  });
}

function normalizeFillDetails(values = []) {
  return (Array.isArray(values) ? values : []).map((entry, index) => deepFreeze({
    fill_id: requiredText(entry.fill_id, `fill_${index}_id`),
    quantity: exactDecimal(entry.quantity, `fill_${index}_quantity`, { positive: true }),
    price: exactDecimal(entry.price, `fill_${index}_price`, { positive: true }),
    fee: normalizeCostComponent(entry.fee, `fill_${index}_fee`),
    filled_at: normalizeTimestamp(entry.filled_at, `fill_${index}_filled_at`),
    simulated: true,
  }));
}

export function createExecutionReceipt(input = {}) {
  assertDataOnly(input, "execution_receipt_input");
  const plan = assertRecord(input.plan, "TradePlan");
  const intent = assertRecord(input.intent, "TradeIntent");
  const policyDecision = assertRecord(input.policy_decision, "PolicyDecision");
  if (!plan.intents.some((ref) => ref.record_hash === intent.record_hash)) throw new Error("execution_receipt_intent_not_in_plan");
  if (policyDecision.plan_ref.record_hash !== plan.record_hash || policyDecision.intent_ref?.record_hash !== intent.record_hash) {
    throw new Error("execution_receipt_policy_scope_mismatch");
  }
  const createdAt = normalizeTimestamp(input.created_at, "execution_receipt_created_at");
  if (Date.parse(policyDecision.expires_at) <= Date.parse(createdAt)) throw new Error("execution_receipt_policy_expired");
  if (Date.parse(plan.expires_at) <= Date.parse(createdAt) || Date.parse(intent.expires_at) <= Date.parse(createdAt)) {
    throw new Error("execution_receipt_subject_expired");
  }
  let approvalRef = null;
  if (policyDecision.result === "require_approval") {
    approvalRef = normalizedObject(input.approval_ref, "execution_receipt_approval_ref");
    if (!approvalRef.approval_id || approvalRef.approved !== true || approvalRef.policy_decision_hash !== policyDecision.record_hash) {
      throw new Error("execution_receipt_approval_invalid");
    }
  } else if (policyDecision.result !== "allow") {
    throw new Error("execution_receipt_policy_not_allowed");
  }
  const environment = normalizeEnvironment(input.environment);
  if (environment !== plan.environment || environment !== intent.environment) throw new Error("execution_receipt_environment_mismatch");
  const previewQuote = normalizePreviewQuote(input.preview_quote);
  const authorizedQuote = policyDecision.quote_refs.find((entry) => entry.leg_id === intent.leg_id);
  if (!authorizedQuote || authorizedQuote.quote_id !== previewQuote.quote_id || authorizedQuote.quote_hash !== previewQuote.quote_hash) {
    throw new Error("execution_receipt_quote_changed_since_policy");
  }
  const status = enumValue(input.status, RECEIPT_STATUSES, "execution_receipt_status");
  if (new Set(["previewed", "paper_submitted", "partially_filled", "filled"]).has(status) && !previewQuote.executable) {
    throw new Error("execution_receipt_executable_quote_required");
  }
  if (new Set(["paper_submitted", "partially_filled", "filled"]).has(status) && Date.parse(previewQuote.expires_at) <= Date.parse(createdAt)) {
    throw new Error("execution_receipt_quote_expired");
  }
  const fillDetails = normalizeFillDetails(input.fill_details);
  if (status === "filled" && fillDetails.length === 0) throw new Error("execution_receipt_fill_required");
  return sealAgenticRecord(AgenticTradingSchemas.execution_receipt, "ExecutionReceipt", {
    receipt_id: requiredText(input.receipt_id, "execution_receipt_id"),
    plan_ref: agenticRecordReference(plan),
    intent_ref: agenticRecordReference(intent),
    policy_decision_ref: agenticRecordReference(policyDecision),
    approval_ref: approvalRef,
    adapter: {
      adapter_id: requiredText(input.adapter?.adapter_id, "execution_adapter_id"),
      adapter_version: requiredText(input.adapter?.adapter_version, "execution_adapter_version"),
      chain_id: intent.chain_id,
      venue_id: intent.venue_id,
      environment,
    },
    idempotency_key: intent.idempotency_key,
    requested_amount: intent.amount,
    preview_quote: previewQuote,
    fill_details: fillDetails,
    fee_totals: normalizedObject(input.fee_totals, "execution_receipt_fee_totals"),
    gas: normalizeCostComponent(input.gas, "execution_receipt_gas"),
    realized_slippage_bps: input.realized_slippage_bps === null || input.realized_slippage_bps === undefined
      ? null
      : nonNegativeInteger(input.realized_slippage_bps, "execution_receipt_realized_slippage_bps", 1_000_000),
    provider_timestamps: normalizedObject(input.provider_timestamps, "execution_receipt_provider_timestamps"),
    confirmation: normalizedObject(input.confirmation, "execution_receipt_confirmation"),
    adapter_reference: text(input.adapter_reference) || null,
    status,
    reconciliation_status: enumValue(input.reconciliation_status || "pending", RECONCILIATION_STATUSES, "execution_receipt_reconciliation_status"),
    failure_reason: text(input.failure_reason) || null,
    environment,
    created_at: createdAt,
    simulated: environment !== "live",
    paper_label_required: environment === "paper",
    live_execution_performed: false,
    signing_performed: false,
    broadcasting_performed: false,
  });
}

export function createOutcomeRecord(input = {}) {
  assertDataOnly(input, "outcome_record_input");
  const plan = assertRecord(input.plan, "TradePlan");
  const receipts = (Array.isArray(input.receipts) ? input.receipts : []).map((entry) => assertRecord(entry, "ExecutionReceipt"));
  if (receipts.some((receipt) => receipt.plan_ref.record_hash !== plan.record_hash)) throw new Error("outcome_receipt_plan_mismatch");
  const outcomeType = enumValue(input.outcome_type, OUTCOME_TYPES, "outcome_type");
  if (new Set(["completed", "partial"]).has(outcomeType) && receipts.length === 0) throw new Error("outcome_receipts_required");
  if (outcomeType === "completed" && receipts.some((receipt) => receipt.status !== "filled" || receipt.reconciliation_status !== "reconciled")) {
    throw new Error("outcome_completed_receipts_unresolved");
  }
  if (outcomeType === "partial" && !input.partial_completion_effect) throw new Error("outcome_partial_completion_effect_required");
  const environment = normalizeEnvironment(input.environment || plan.environment);
  if (receipts.some((receipt) => receipt.environment !== environment)) throw new Error("outcome_environment_mismatch");
  return sealAgenticRecord(AgenticTradingSchemas.outcome_record, "OutcomeRecord", {
    outcome_id: requiredText(input.outcome_id, "outcome_id"),
    plan_ref: agenticRecordReference(plan),
    receipt_refs: receipts.map(agenticRecordReference),
    outcome_type: outcomeType,
    entry: normalizedObject(input.entry, "outcome_entry"),
    exit: normalizedObject(input.exit, "outcome_exit"),
    capital_employed: exactDecimal(input.capital_employed, "outcome_capital_employed", { allowNull: true }),
    realized_pnl: exactDecimal(input.realized_pnl, "outcome_realized_pnl", { signed: true, allowNull: true }),
    unrealized_pnl: exactDecimal(input.unrealized_pnl, "outcome_unrealized_pnl", { signed: true, allowNull: true }),
    fees: normalizedObject(input.fees, "outcome_fees"),
    funding: normalizedObject(input.funding, "outcome_funding"),
    gas: normalizedObject(input.gas, "outcome_gas"),
    slippage: normalizedObject(input.slippage, "outcome_slippage"),
    maximum_adverse_excursion: exactDecimal(input.maximum_adverse_excursion, "outcome_mae", { signed: true, allowNull: true }),
    maximum_favorable_excursion: exactDecimal(input.maximum_favorable_excursion, "outcome_mfe", { signed: true, allowNull: true }),
    drawdown_contribution: exactDecimal(input.drawdown_contribution, "outcome_drawdown_contribution", { signed: true, allowNull: true }),
    benchmark: normalizedObject(input.benchmark, "outcome_benchmark"),
    exit_reason: text(input.exit_reason) || null,
    attribution: normalizedObject(input.attribution, "outcome_attribution"),
    partial_completion_effect: input.partial_completion_effect ? normalizedObject(input.partial_completion_effect, "outcome_partial_completion_effect") : null,
    environment,
    simulated: true,
    recorded_at: normalizeTimestamp(input.recorded_at, "outcome_recorded_at"),
  });
}
