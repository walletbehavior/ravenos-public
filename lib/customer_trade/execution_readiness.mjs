import { createHash } from "node:crypto";

export const EXECUTION_INTENT_SCHEMA = "ravenos.execution_intent.v1";

export const EXECUTION_INTENT_STATES = Object.freeze([
  "draft",
  "quoted",
  "reviewed",
  "awaiting_signature",
  "signed",
  "submitted",
  "acknowledged",
  "partially_filled",
  "filled",
  "rejected",
  "cancelled",
  "expired",
  "failed",
  "unknown",
]);

const TERMINAL_STATES = new Set(["filled", "rejected", "cancelled", "expired", "failed"]);
const TRANSITIONS = Object.freeze({
  draft: new Set(["quoted", "cancelled", "failed"]),
  quoted: new Set(["reviewed", "expired", "cancelled", "rejected", "failed"]),
  reviewed: new Set(["awaiting_signature", "expired", "cancelled", "rejected", "failed"]),
  awaiting_signature: new Set(["signed", "expired", "cancelled", "rejected", "failed"]),
  signed: new Set(["submitted", "expired", "rejected", "failed", "unknown"]),
  submitted: new Set(["acknowledged", "rejected", "failed", "unknown"]),
  acknowledged: new Set(["partially_filled", "filled", "cancelled", "rejected", "failed", "unknown"]),
  partially_filled: new Set(["partially_filled", "filled", "cancelled", "failed", "unknown"]),
  unknown: new Set(["acknowledged", "partially_filled", "filled", "rejected", "cancelled", "failed"]),
});

export const EXECUTION_DISABLED_GATE = Object.freeze({
  owner_only: true,
  public_available: false,
  signing_enabled: false,
  submission_enabled: false,
  kill_switch_clear: false,
  reconciliation_enabled: false,
});

function text(value) {
  return String(value ?? "").trim();
}

function integerString(value) {
  const normalized = text(value);
  return /^(?:0|[1-9]\d*)$/.test(normalized) ? normalized : null;
}

function timestamp(value) {
  const normalized = text(value);
  return normalized && Number.isFinite(Date.parse(normalized)) ? new Date(normalized).toISOString() : null;
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function clone(value) {
  return structuredClone(value);
}

function normalizeRouteHop(value = {}, index = 0) {
  return {
    hop_index: Number.isSafeInteger(Number(value.hop_index)) ? Number(value.hop_index) : index,
    venue: text(value.venue),
    market_id: text(value.market_id),
    input_asset: text(value.input_asset),
    output_asset: text(value.output_asset),
    input_amount_base_units: integerString(value.input_amount_base_units),
    expected_output_base_units: integerString(value.expected_output_base_units),
    recipient: text(value.recipient) || null,
  };
}

function normalizeFee(value = {}, index = 0) {
  return {
    fee_index: Number.isSafeInteger(Number(value.fee_index)) ? Number(value.fee_index) : index,
    kind: text(value.kind),
    asset: text(value.asset),
    amount_base_units: integerString(value.amount_base_units),
    recipient: text(value.recipient) || null,
  };
}

function reviewBinding(input = {}) {
  return {
    intent_id: text(input.intent_id),
    intent_version: Number.isSafeInteger(Number(input.intent_version)) ? Number(input.intent_version) : 1,
    actor_id: text(input.actor_id),
    account_id: text(input.account_id),
    wallet_or_venue_account: text(input.wallet_or_venue_account),
    chain_namespace: text(input.chain_namespace),
    network_reference: text(input.network_reference),
    venue: text(input.venue),
    canonical_instrument_id: text(input.canonical_instrument_id),
    exact_market_id: text(input.exact_market_id),
    side: text(input.side).toLowerCase(),
    input_asset: text(input.input_asset),
    input_amount_base_units: integerString(input.input_amount_base_units),
    expected_output_asset: text(input.expected_output_asset),
    expected_output_amount_base_units: integerString(input.expected_output_amount_base_units),
    minimum_output_amount_base_units: integerString(input.minimum_output_amount_base_units),
    source_custody_domain: text(input.source_custody_domain),
    destination_custody_domain: text(input.destination_custody_domain),
    leverage: finite(input.leverage),
    slippage_bps: finite(input.slippage_bps),
    route_id: text(input.route_id),
    route_hops: Array.isArray(input.route_hops) ? input.route_hops.map(normalizeRouteHop) : [],
    program_or_contract_allowlist: Array.isArray(input.program_or_contract_allowlist)
      ? input.program_or_contract_allowlist.map(text).filter(Boolean).sort()
      : [],
    spender_and_approval: input.spender_and_approval && typeof input.spender_and_approval === "object"
      ? canonicalize(input.spender_and_approval)
      : null,
    fee_items: Array.isArray(input.fee_items) ? input.fee_items.map(normalizeFee) : [],
    gas_or_network_fee_bound: input.gas_or_network_fee_bound && typeof input.gas_or_network_fee_bound === "object"
      ? canonicalize(input.gas_or_network_fee_bound)
      : null,
    quote_id: text(input.quote_id),
    quote_observed_at: timestamp(input.quote_observed_at),
    expires_at: timestamp(input.expires_at),
    expected_result: input.expected_result && typeof input.expected_result === "object"
      ? canonicalize(input.expected_result)
      : null,
    destination: input.destination && typeof input.destination === "object"
      ? canonicalize(input.destination)
      : null,
    prepared_payload_hash: text(input.prepared_payload_hash) || null,
  };
}

function validationErrors(binding) {
  const required = [
    "intent_id",
    "actor_id",
    "account_id",
    "wallet_or_venue_account",
    "chain_namespace",
    "network_reference",
    "venue",
    "canonical_instrument_id",
    "exact_market_id",
    "input_asset",
    "expected_output_asset",
    "source_custody_domain",
    "destination_custody_domain",
    "route_id",
    "quote_id",
    "quote_observed_at",
    "expires_at",
  ];
  const errors = required.filter((key) => !binding[key]).map((key) => `${key}_required`);
  if (!new Set(["buy", "sell", "long", "short"]).has(binding.side)) errors.push("side_invalid");
  if (!binding.input_amount_base_units || binding.input_amount_base_units === "0") errors.push("input_amount_invalid");
  if (!binding.expected_output_amount_base_units) errors.push("expected_output_invalid");
  if (!binding.minimum_output_amount_base_units) errors.push("minimum_output_invalid");
  if (binding.slippage_bps === null || binding.slippage_bps < 0) errors.push("slippage_invalid");
  if (!binding.route_hops.length) errors.push("route_required");
  if (!binding.expected_result) errors.push("expected_result_required");
  if (!binding.destination) errors.push("destination_required");
  if (!binding.prepared_payload_hash) errors.push("prepared_payload_hash_required");
  return [...new Set(errors)];
}

function auditEvent(state, at, outcome, detail = null) {
  return {
    event_index: 0,
    state,
    at,
    outcome,
    detail: detail ? text(detail).slice(0, 160) : null,
  };
}

function appendEvent(intent, event) {
  const next = clone(intent);
  next.audit_events.push({ ...event, event_index: next.audit_events.length });
  next.updated_at = event.at;
  return next;
}

export function createExecutionIntent(input = {}, { now = Date.now() } = {}) {
  const binding = reviewBinding(input);
  const createdAt = timestamp(input.created_at) || new Date(now).toISOString();
  const errors = validationErrors(binding);
  const intent = {
    schema_version: EXECUTION_INTENT_SCHEMA,
    ...binding,
    canonical_intent_hash: hash(binding),
    policy_suggestions: input.policy_suggestions && typeof input.policy_suggestions === "object"
      ? canonicalize(input.policy_suggestions)
      : null,
    policy_is_authorization: false,
    state: errors.length ? "draft" : "quoted",
    created_at: createdAt,
    updated_at: createdAt,
    reviewed_at: null,
    recent_reauthentication_at: null,
    decoded_semantics_hash: null,
    simulation_state: "not_run",
    submission_idempotency_hash: null,
    provider_submission_id: null,
    fill_state: null,
    errors,
    execution_boundary: { ...EXECUTION_DISABLED_GATE },
    audit_events: [auditEvent(errors.length ? "draft" : "quoted", createdAt, errors.length ? "invalid" : "created", errors[0] || null)],
  };
  return intent;
}

export function verifyIntentIntegrity(intent = {}) {
  const binding = reviewBinding(intent);
  const errors = validationErrors(binding);
  if (intent.schema_version !== EXECUTION_INTENT_SCHEMA) errors.push("schema_version_invalid");
  if (hash(binding) !== intent.canonical_intent_hash) errors.push("review_binding_changed");
  return { ok: errors.length === 0, errors: [...new Set(errors)], canonical_intent_hash: hash(binding) };
}

export function reviewExecutionIntent(intent, {
  reviewedAt = new Date().toISOString(),
  recentReauthenticationAt = reviewedAt,
  now = Date.now(),
} = {}) {
  const integrity = verifyIntentIntegrity(intent);
  const at = timestamp(reviewedAt);
  const reauthenticatedAt = timestamp(recentReauthenticationAt);
  const errors = [...integrity.errors];
  if (intent.state !== "quoted") errors.push("intent_not_quoted");
  if (!at) errors.push("reviewed_at_invalid");
  if (!reauthenticatedAt) errors.push("recent_reauthentication_required");
  if (intent.expires_at && Date.parse(intent.expires_at) <= now) errors.push("quote_expired");
  if (errors.length) return { ok: false, error: errors[0], errors, intent };
  let next = appendEvent(intent, auditEvent("reviewed", at, "accepted"));
  next.state = "reviewed";
  next.reviewed_at = at;
  next.recent_reauthentication_at = reauthenticatedAt;
  return { ok: true, intent: next };
}

export function comparePreparedPayload(intent, {
  payloadHash,
  decodedSemanticsHash,
  simulationState,
  now = Date.now(),
} = {}) {
  const integrity = verifyIntentIntegrity(intent);
  const errors = [...integrity.errors];
  if (intent.state !== "reviewed") errors.push("intent_not_reviewed");
  if (intent.expires_at && Date.parse(intent.expires_at) <= now) errors.push("quote_expired");
  if (!text(payloadHash) || text(payloadHash) !== intent.prepared_payload_hash) errors.push("prepared_payload_mismatch");
  if (!text(decodedSemanticsHash)) errors.push("decoded_semantics_required");
  if (!new Set(["passed", "not_supported"]).has(text(simulationState))) errors.push("simulation_not_accepted");
  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)],
    payload_hash: text(payloadHash) || null,
    decoded_semantics_hash: text(decodedSemanticsHash) || null,
    simulation_state: text(simulationState) || "unknown",
  };
}

function gateErrors(nextState, gate = {}) {
  const errors = [];
  if (gate.owner_only !== true || gate.public_available === true) errors.push("owner_only_gate_required");
  if (gate.kill_switch_clear !== true) errors.push("execution_kill_switch_blocked");
  const signingStates = new Set(["awaiting_signature", "signed", "submitted", "acknowledged", "partially_filled", "filled", "unknown"]);
  const submissionStates = new Set(["submitted", "acknowledged", "partially_filled", "filled", "unknown"]);
  if (signingStates.has(nextState) && gate.signing_enabled !== true) errors.push("signing_disabled");
  if (submissionStates.has(nextState) && gate.submission_enabled !== true) errors.push("submission_disabled");
  if (submissionStates.has(nextState) && gate.reconciliation_enabled !== true) errors.push("reconciliation_required");
  return errors;
}

export function transitionExecutionIntent(intent, nextState, {
  at = new Date().toISOString(),
  gate = EXECUTION_DISABLED_GATE,
  preparedComparison = null,
  detail = null,
  now = Date.now(),
} = {}) {
  const target = text(nextState).toLowerCase();
  const errors = [];
  if (!EXECUTION_INTENT_STATES.includes(target)) errors.push("state_invalid");
  if (TERMINAL_STATES.has(intent.state)) errors.push("intent_terminal");
  if (!TRANSITIONS[intent.state]?.has(target)) errors.push("state_transition_invalid");
  if (intent.expires_at && Date.parse(intent.expires_at) <= now && target !== "expired") errors.push("quote_expired");
  if (new Set(["awaiting_signature", "signed", "submitted", "acknowledged", "partially_filled", "filled", "unknown"]).has(target)) {
    errors.push(...gateErrors(target, gate));
    if (!preparedComparison?.ok) errors.push("prepared_payload_not_verified");
  }
  const integrity = verifyIntentIntegrity(intent);
  errors.push(...integrity.errors);
  if (errors.length) return { ok: false, error: [...new Set(errors)][0], errors: [...new Set(errors)], intent };
  const eventAt = timestamp(at) || new Date(now).toISOString();
  let next = appendEvent(intent, auditEvent(target, eventAt, "accepted", detail));
  next.state = target;
  next.execution_boundary = {
    owner_only: true,
    public_available: false,
    signing_enabled: gate.signing_enabled === true,
    submission_enabled: gate.submission_enabled === true,
    kill_switch_clear: gate.kill_switch_clear === true,
    reconciliation_enabled: gate.reconciliation_enabled === true,
  };
  if (preparedComparison) {
    next.decoded_semantics_hash = preparedComparison.decoded_semantics_hash;
    next.simulation_state = preparedComparison.simulation_state;
  }
  return { ok: true, intent: next };
}

export function recordSubmission(intent, {
  idempotencyKey,
  providerSubmissionId = null,
  at = new Date().toISOString(),
  gate = EXECUTION_DISABLED_GATE,
  preparedComparison = null,
  now = Date.now(),
} = {}) {
  const verifier = text(idempotencyKey) ? hash({ intent_id: intent.intent_id, intent_version: intent.intent_version, idempotency_key: text(idempotencyKey) }) : null;
  if (!verifier) return { ok: false, error: "submission_idempotency_key_required", intent };
  if (intent.submission_idempotency_hash) {
    if (intent.submission_idempotency_hash !== verifier) return { ok: false, error: "duplicate_submission_mismatch", intent };
    return { ok: true, idempotent: true, intent };
  }
  const transitioned = transitionExecutionIntent(intent, "submitted", { at, gate, preparedComparison, now });
  if (!transitioned.ok) return transitioned;
  const next = clone(transitioned.intent);
  next.submission_idempotency_hash = verifier;
  next.provider_submission_id = text(providerSubmissionId) || null;
  return { ok: true, idempotent: false, intent: next };
}

export function invalidateExecutionReview(intent, changedInput = {}, {
  at = new Date().toISOString(),
} = {}) {
  const changedBinding = reviewBinding({ ...intent, ...changedInput, intent_version: Number(intent.intent_version || 1) + 1 });
  const next = createExecutionIntent({
    ...changedBinding,
    policy_suggestions: changedInput.policy_suggestions ?? intent.policy_suggestions,
    created_at: at,
  }, { now: Date.parse(at) });
  next.audit_events[0].detail = "material_change_requires_new_review";
  return {
    ok: true,
    invalidated_hash: intent.canonical_intent_hash,
    material_change: hash(changedBinding) !== intent.canonical_intent_hash,
    intent: next,
  };
}

export function executionReadinessSummary(intent = {}) {
  return {
    schema_version: EXECUTION_INTENT_SCHEMA,
    intent_id: text(intent.intent_id) || null,
    state: text(intent.state) || "unknown",
    exact_identity_bound: Boolean(intent.canonical_instrument_id && intent.exact_market_id),
    review_integrity: verifyIntentIntegrity(intent).ok,
    quote_expires_at: intent.expires_at || null,
    public_execution_available: false,
    signing_available: false,
    submission_available: false,
    owner_authorization_required: true,
  };
}
