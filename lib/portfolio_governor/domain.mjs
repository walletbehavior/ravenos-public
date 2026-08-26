import { canonicalContractHash } from "../customer_trade/contracts.mjs";

export const PortfolioGovernorSchemas = Object.freeze({
  observation: "ravenos.portfolio_governor.observation.v1",
  market_posture: "ravenos.portfolio_governor.market_posture.v1",
  portfolio_snapshot: "ravenos.portfolio_governor.portfolio_snapshot.v1",
  portfolio_measurement: "ravenos.portfolio_governor.portfolio_measurement.v1",
  user_policy_version: "ravenos.portfolio_governor.user_policy_version.v1",
  policy_activation_rule: "ravenos.portfolio_governor.policy_activation_rule.v1",
  policy_violation: "ravenos.portfolio_governor.policy_violation.v1",
  policy_evaluation: "ravenos.portfolio_governor.policy_evaluation.v1",
  rebalance_calculation: "ravenos.portfolio_governor.rebalance_calculation.v1",
  execution_quote: "ravenos.portfolio_governor.execution_quote.v1",
  user_authorization: "ravenos.portfolio_governor.user_authorization.v1",
  execution_intent: "ravenos.portfolio_governor.execution_intent.v1",
  execution_fill: "ravenos.portfolio_governor.execution_fill.v1",
  settlement_outcome: "ravenos.portfolio_governor.settlement_outcome.v1",
  funding_event: "ravenos.portfolio_governor.funding_event.v1",
  profit_routing_calculation: "ravenos.portfolio_governor.profit_routing_calculation.v1",
  outcome: "ravenos.portfolio_governor.outcome.v1",
});

export const PortfolioGovernorAuthorityModes = Object.freeze([
  "observe",
  "policy_monitor",
  "user_signed_rebalance",
]);

export const PortfolioGovernorRefusalReasons = Object.freeze([
  "portfolio_within_policy",
  "policy_target_absent",
  "insufficient_valuation_confidence",
  "rebalance_not_economically_justified",
  "insufficient_quote_confidence",
  "position_not_routeable",
  "cold_asset_protected",
  "minimum_trade_not_met",
  "maximum_transaction_exceeded",
  "daily_turnover_limit",
  "stablecoin_concentration_would_increase",
  "protocol_risk_limit",
  "authorization_missing",
  "authorization_expired",
  "quote_expired",
  "policy_changed_since_quote",
  "portfolio_changed_since_quote",
  "asset_not_allowed",
  "venue_not_allowed",
  "correction_outside_user_band",
  "correction_does_not_reduce_violation",
  "execution_mode_not_enabled",
  "market_posture_has_no_policy_authority",
  "profit_routing_not_configured",
  "no_distributable_profit",
]);

const RECORD_ID_FIELDS = Object.freeze({
  Observation: "observation_id",
  MarketPosture: "market_posture_id",
  PortfolioSnapshot: "snapshot_id",
  PortfolioMeasurement: "measurement_id",
  UserPolicyVersion: "policy_version_id",
  UserPolicyActivationRule: "activation_rule_id",
  PolicyViolation: "violation_id",
  PolicyEvaluation: "evaluation_id",
  RebalanceCalculation: "calculation_id",
  ExecutionQuote: "quote_id",
  UserAuthorization: "authorization_id",
  ExecutionIntent: "execution_intent_id",
  ExecutionFill: "execution_fill_id",
  SettlementOutcome: "settlement_outcome_id",
  FundingEvent: "funding_event_id",
  ProfitRoutingCalculation: "routing_calculation_id",
  GovernorOutcome: "outcome_id",
});

const SCOPE_TYPES = new Set(["asset", "bucket", "protocol", "stablecoin_issuer"]);
const BUCKET_KINDS = new Set(["cold", "warm", "reserve", "retained", "custom"]);
const ROUTEABILITY_STATES = new Set(["routeable", "not_routeable", "unknown"]);
const VALUATION_CONFIDENCE = new Set(["high", "medium", "low", "unavailable"]);
const QUOTE_CONFIDENCE_RANK = Object.freeze({ unavailable: 0, low: 1, medium: 2, high: 3 });

function text(value) {
  return String(value ?? "").trim();
}

function requiredText(value, field) {
  const normalized = text(value);
  if (!normalized) throw new Error(`${field}_required`);
  return normalized;
}

function timestamp(value, field) {
  const normalized = text(value);
  const parsed = Date.parse(normalized);
  if (!normalized || !Number.isFinite(parsed)) throw new Error(`${field}_invalid`);
  return new Date(parsed).toISOString();
}

function optionalTimestamp(value, field) {
  return value === null || value === undefined || value === "" ? null : timestamp(value, field);
}

function integerString(value, field, { allowZero = true } = {}) {
  const normalized = text(value);
  if (!/^(?:0|[1-9]\d*)$/.test(normalized)) throw new Error(`${field}_invalid`);
  if (!allowZero && normalized === "0") throw new Error(`${field}_must_be_positive`);
  return normalized;
}

function basisPoints(value, field, { allowNull = false } = {}) {
  if (allowNull && (value === null || value === undefined || value === "")) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 10_000) throw new Error(`${field}_invalid`);
  return parsed;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))].sort();
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

function seal(schemaVersion, recordType, payload) {
  const core = {
    schema_version: schemaVersion,
    record_type: recordType,
    ...clone(payload),
  };
  return deepFreeze({ ...core, record_hash: canonicalContractHash(core) });
}

function assertRecord(record, recordType) {
  if (!record || record.record_type !== recordType) throw new Error(`${recordType}_required`);
  const { record_hash: recordHash, ...core } = record;
  if (!recordHash || canonicalContractHash(core) !== recordHash) throw new Error(`${recordType}_integrity_invalid`);
  return record;
}

function reference(record) {
  const idField = RECORD_ID_FIELDS[record.record_type];
  if (!idField || !record[idField]) throw new Error("record_reference_invalid");
  return {
    record_type: record.record_type,
    record_id: record[idField],
    record_hash: record.record_hash,
    ...(record.policy_id ? { policy_id: record.policy_id } : {}),
    ...(record.version ? { version: record.version } : {}),
  };
}

function sameReference(left, right) {
  return Boolean(
    left
      && right
      && left.record_type === right.record_type
      && left.record_id === right.record_id
      && left.record_hash === right.record_hash,
  );
}

function provenance(origin, role, authorityEffect) {
  return {
    origin,
    role,
    authority_effect: authorityEffect,
    discretionary_investment_authority: false,
  };
}

function outcomeId(reasonCode, occurredAt, refs = {}) {
  return `out_${canonicalContractHash({ reason_code: reasonCode, occurred_at: occurredAt, refs }).slice(0, 24)}`;
}

export function createGovernorOutcome(input = {}) {
  const reasonCode = requiredText(input.reason_code, "reason_code");
  if (!PortfolioGovernorRefusalReasons.includes(reasonCode)) throw new Error("reason_code_invalid");
  const occurredAt = timestamp(input.occurred_at, "occurred_at");
  const refs = input.refs && typeof input.refs === "object" ? clone(input.refs) : {};
  return seal(PortfolioGovernorSchemas.outcome, "GovernorOutcome", {
    outcome_id: text(input.outcome_id) || outcomeId(reasonCode, occurredAt, refs),
    outcome_class: reasonCode === "portfolio_within_policy" ? "no_action" : "refusal",
    reason_code: reasonCode,
    occurred_at: occurredAt,
    refs,
    detail: input.detail && typeof input.detail === "object" ? clone(input.detail) : null,
    persistable: true,
    provenance: provenance("raven", "deterministic_outcome", "none"),
  });
}

function refusal(reasonCode, occurredAt, refs, detail = null) {
  return {
    ok: false,
    refusal: createGovernorOutcome({ reason_code: reasonCode, occurred_at: occurredAt, refs, detail }),
  };
}

export function createObservation(input = {}) {
  const observedBy = text(input.observed_by || "external_source").toLowerCase();
  if (!new Set(["external_source", "raven"]).has(observedBy)) throw new Error("observed_by_invalid");
  return seal(PortfolioGovernorSchemas.observation, "Observation", {
    observation_id: requiredText(input.observation_id, "observation_id"),
    observed_at: timestamp(input.observed_at, "observed_at"),
    source_category: requiredText(input.source_category, "source_category"),
    source_reference: text(input.source_reference) || null,
    freshness_state: text(input.freshness_state || "unknown").toLowerCase(),
    facts: input.facts && typeof input.facts === "object" ? clone(input.facts) : {},
    provenance: provenance(observedBy, "observation", "none"),
  });
}

export function createMarketPosture(input = {}) {
  const observationRefs = (Array.isArray(input.observations) ? input.observations : []).map((row) => reference(assertRecord(row, "Observation")));
  return seal(PortfolioGovernorSchemas.market_posture, "MarketPosture", {
    market_posture_id: requiredText(input.market_posture_id, "market_posture_id"),
    observed_at: timestamp(input.observed_at, "observed_at"),
    posture: requiredText(input.posture, "posture"),
    methodology_version: requiredText(input.methodology_version, "methodology_version"),
    observation_refs: observationRefs,
    portfolio_policy_effect: "none_without_user_authored_activation_rule",
    provenance: provenance("raven", "market_interpretation", "none"),
  });
}

function normalizePosition(row = {}, index = 0) {
  const routeability = text(row.routeability || "unknown").toLowerCase();
  if (!ROUTEABILITY_STATES.has(routeability)) throw new Error(`positions[${index}].routeability_invalid`);
  const confidence = text(row.valuation_confidence || "unavailable").toLowerCase();
  if (!VALUATION_CONFIDENCE.has(confidence)) throw new Error(`positions[${index}].valuation_confidence_invalid`);
  return {
    position_id: requiredText(row.position_id, `positions[${index}].position_id`),
    economic_lot_id: requiredText(row.economic_lot_id, `positions[${index}].economic_lot_id`),
    asset_id: requiredText(row.asset_id, `positions[${index}].asset_id`),
    bucket_id: text(row.bucket_id) || null,
    protocol_id: text(row.protocol_id) || null,
    stablecoin_issuer_id: text(row.stablecoin_issuer_id) || null,
    executable_value_minor: row.executable_value_minor === null || row.executable_value_minor === undefined
      ? null
      : integerString(row.executable_value_minor, `positions[${index}].executable_value_minor`),
    liability_value_minor: integerString(row.liability_value_minor ?? "0", `positions[${index}].liability_value_minor`),
    routeability,
    valuation_confidence: confidence,
    valuation_source: text(row.valuation_source) || null,
    observed_at: optionalTimestamp(row.observed_at, `positions[${index}].observed_at`),
  };
}

export function createPortfolioSnapshot(input = {}) {
  const positions = (Array.isArray(input.positions) ? input.positions : []).map(normalizePosition);
  const lots = new Set();
  for (const position of positions) {
    if (lots.has(position.economic_lot_id)) throw new Error("duplicate_economic_lot_id");
    lots.add(position.economic_lot_id);
  }
  return seal(PortfolioGovernorSchemas.portfolio_snapshot, "PortfolioSnapshot", {
    snapshot_id: requiredText(input.snapshot_id, "snapshot_id"),
    portfolio_id: requiredText(input.portfolio_id, "portfolio_id"),
    user_id: requiredText(input.user_id, "user_id"),
    observed_at: timestamp(input.observed_at, "observed_at"),
    economic_numeraire: requiredText(input.economic_numeraire, "economic_numeraire").toUpperCase(),
    positions,
    source_observation_ids: uniqueStrings(input.source_observation_ids),
    append_only: true,
    provenance: provenance("raven", "portfolio_accounting_snapshot", "none"),
  });
}

function roundedBps(value, total) {
  if (total <= 0n) return null;
  return Number(((value * 10_000n) + (total / 2n)) / total);
}

function exposureKey(scopeType, scopeId) {
  return `${scopeType}:${scopeId}`;
}

function measurePositions(positions) {
  let assetValue = 0n;
  let liabilityValue = 0n;
  let unavailableValuations = 0;
  const groups = new Map();
  for (const position of positions) {
    liabilityValue += BigInt(position.liability_value_minor || "0");
    if (position.executable_value_minor === null) {
      unavailableValuations += 1;
      continue;
    }
    const value = BigInt(position.executable_value_minor);
    assetValue += value;
    const scopes = [
      ["asset", position.asset_id],
      ["bucket", position.bucket_id],
      ["protocol", position.protocol_id],
      ["stablecoin_issuer", position.stablecoin_issuer_id],
    ];
    for (const [scopeType, scopeId] of scopes) {
      if (!scopeId) continue;
      const key = exposureKey(scopeType, scopeId);
      const current = groups.get(key) || { scope_type: scopeType, scope_id: scopeId, value: 0n, position_ids: [] };
      current.value += value;
      current.position_ids.push(position.position_id);
      groups.set(key, current);
    }
  }
  const netValue = assetValue - liabilityValue;
  const exposures = [...groups.values()]
    .map((row) => ({
      scope_type: row.scope_type,
      scope_id: row.scope_id,
      value_minor: row.value.toString(),
      allocation_bps: roundedBps(row.value, netValue),
      position_ids: [...new Set(row.position_ids)].sort(),
    }))
    .sort((left, right) => exposureKey(left.scope_type, left.scope_id).localeCompare(exposureKey(right.scope_type, right.scope_id)));
  return {
    total_asset_value_minor: assetValue.toString(),
    total_liability_value_minor: liabilityValue.toString(),
    net_value_minor: netValue > 0n ? netValue.toString() : "0",
    unavailable_valuations: unavailableValuations,
    state: unavailableValuations ? "partial" : netValue > 0n ? "available" : "unavailable",
    exposures,
  };
}

export function createPortfolioMeasurement(input = {}) {
  const snapshot = assertRecord(input.snapshot, "PortfolioSnapshot");
  const measured = measurePositions(snapshot.positions);
  return seal(PortfolioGovernorSchemas.portfolio_measurement, "PortfolioMeasurement", {
    measurement_id: requiredText(input.measurement_id, "measurement_id"),
    portfolio_id: snapshot.portfolio_id,
    user_id: snapshot.user_id,
    calculated_at: timestamp(input.calculated_at, "calculated_at"),
    methodology_version: requiredText(input.methodology_version, "methodology_version"),
    snapshot_ref: reference(snapshot),
    economic_numeraire: snapshot.economic_numeraire,
    ...measured,
    leverage_bps: BigInt(measured.net_value_minor) > 0n
      ? roundedBps(BigInt(measured.total_asset_value_minor), BigInt(measured.net_value_minor))
      : null,
    provenance: provenance("raven", "portfolio_measurement", "none"),
  });
}

function normalizeAllocationBand(row = {}, index = 0) {
  const scopeType = text(row.scope_type).toLowerCase();
  if (!SCOPE_TYPES.has(scopeType)) throw new Error(`allocation_bands[${index}].scope_type_invalid`);
  const minimum = basisPoints(row.minimum_bps, `allocation_bands[${index}].minimum_bps`, { allowNull: true });
  const maximum = basisPoints(row.maximum_bps, `allocation_bands[${index}].maximum_bps`, { allowNull: true });
  if (minimum === null && maximum === null) throw new Error(`allocation_bands[${index}].boundary_required`);
  if (minimum !== null && maximum !== null && minimum > maximum) throw new Error(`allocation_bands[${index}].range_invalid`);
  return {
    rule_id: requiredText(row.rule_id, `allocation_bands[${index}].rule_id`),
    scope_type: scopeType,
    scope_id: requiredText(row.scope_id, `allocation_bands[${index}].scope_id`),
    minimum_bps: minimum,
    maximum_bps: maximum,
  };
}

function normalizeConcentrationLimit(row = {}, index = 0) {
  const scopeType = text(row.scope_type).toLowerCase();
  if (!new Set(["asset", "protocol", "stablecoin_issuer"]).has(scopeType)) {
    throw new Error(`concentration_limits[${index}].scope_type_invalid`);
  }
  return {
    rule_id: requiredText(row.rule_id, `concentration_limits[${index}].rule_id`),
    scope_type: scopeType,
    scope_id: text(row.scope_id) || "*",
    maximum_bps: basisPoints(row.maximum_bps, `concentration_limits[${index}].maximum_bps`),
  };
}

function normalizeBucket(row = {}, index = 0) {
  const kind = text(row.kind || "custom").toLowerCase();
  if (!BUCKET_KINDS.has(kind)) throw new Error(`capital_buckets[${index}].kind_invalid`);
  if (kind === "cold" && row.protected_from_sale === false) throw new Error("cold_bucket_must_be_protected");
  return {
    bucket_id: requiredText(row.bucket_id, `capital_buckets[${index}].bucket_id`),
    label: requiredText(row.label || row.bucket_id, `capital_buckets[${index}].label`),
    kind,
    protected_from_sale: kind === "cold" ? true : row.protected_from_sale === true,
  };
}

function normalizeProfitRoute(row = {}, index = 0) {
  return {
    route_id: requiredText(row.route_id, `profit_routing[${index}].route_id`),
    destination_bucket_id: requiredText(row.destination_bucket_id, `profit_routing[${index}].destination_bucket_id`),
    share_bps: basisPoints(row.share_bps, `profit_routing[${index}].share_bps`),
  };
}

function normalizeExecutionPermissions(input = {}, authorityMode) {
  const requiresUserSignature = input.requires_user_signature !== false;
  if (authorityMode === "user_signed_rebalance" && !requiresUserSignature) {
    throw new Error("user_signature_required_in_v1");
  }
  if (input.raven_custody_allowed === true || input.unrestricted_private_key_allowed === true) {
    throw new Error("custody_not_supported");
  }
  const minimumQuoteConfidence = text(input.minimum_quote_confidence || "unavailable").toLowerCase();
  if (!(minimumQuoteConfidence in QUOTE_CONFIDENCE_RANK)) throw new Error("minimum_quote_confidence_invalid");
  return {
    requires_user_signature: true,
    raven_custody_allowed: false,
    unrestricted_private_key_allowed: false,
    maximum_transaction_minor: input.maximum_transaction_minor == null ? null : integerString(input.maximum_transaction_minor, "maximum_transaction_minor"),
    minimum_trade_minor: input.minimum_trade_minor == null ? null : integerString(input.minimum_trade_minor, "minimum_trade_minor"),
    daily_turnover_limit_minor: input.daily_turnover_limit_minor == null ? null : integerString(input.daily_turnover_limit_minor, "daily_turnover_limit_minor"),
    maximum_friction_bps: input.maximum_friction_bps == null ? null : basisPoints(input.maximum_friction_bps, "maximum_friction_bps"),
    minimum_quote_confidence: minimumQuoteConfidence,
  };
}

export function createUserPolicyVersion(input = {}) {
  const authorityMode = text(input.authority_mode || "policy_monitor").toLowerCase();
  if (!PortfolioGovernorAuthorityModes.includes(authorityMode)) throw new Error("authority_mode_invalid");
  const userId = requiredText(input.user_id, "user_id");
  if (text(input.authored_by?.type).toLowerCase() !== "user" || text(input.authored_by?.user_id) !== userId) {
    throw new Error("user_policy_author_required");
  }
  const version = Number(input.version);
  if (!Number.isSafeInteger(version) || version < 1) throw new Error("policy_version_invalid");
  const buckets = (Array.isArray(input.capital_buckets) ? input.capital_buckets : []).map(normalizeBucket);
  const bucketIds = new Set(buckets.map((row) => row.bucket_id));
  const profitRouting = (Array.isArray(input.profit_routing) ? input.profit_routing : []).map(normalizeProfitRoute);
  for (const route of profitRouting) {
    if (!bucketIds.has(route.destination_bucket_id)) throw new Error("profit_route_bucket_missing");
  }
  if (profitRouting.reduce((sum, row) => sum + row.share_bps, 0) > 10_000) throw new Error("profit_routing_exceeds_100_percent");
  const allocationBands = (Array.isArray(input.allocation_bands) ? input.allocation_bands : []).map(normalizeAllocationBand);
  const concentrationLimits = (Array.isArray(input.concentration_limits) ? input.concentration_limits : []).map(normalizeConcentrationLimit);
  const ruleIds = [...allocationBands, ...concentrationLimits].map((row) => row.rule_id);
  if (new Set(ruleIds).size !== ruleIds.length) throw new Error("duplicate_policy_rule_id");
  const policyVersionId = requiredText(input.policy_version_id, "policy_version_id");
  const supersedes = text(input.supersedes_policy_version_id) || null;
  if (supersedes === policyVersionId) throw new Error("policy_cannot_supersede_itself");
  return seal(PortfolioGovernorSchemas.user_policy_version, "UserPolicyVersion", {
    policy_id: requiredText(input.policy_id, "policy_id"),
    policy_version_id: policyVersionId,
    version,
    portfolio_id: requiredText(input.portfolio_id, "portfolio_id"),
    user_id: userId,
    authored_at: timestamp(input.authored_at, "authored_at"),
    effective_at: timestamp(input.effective_at || input.authored_at, "effective_at"),
    supersedes_policy_version_id: supersedes,
    status: text(input.status || "active").toLowerCase(),
    authority_mode: authorityMode,
    authored_by: { type: "user", user_id: userId },
    allocation_bands: allocationBands,
    capital_buckets: buckets,
    concentration_limits: concentrationLimits,
    protected_asset_ids: uniqueStrings(input.protected_asset_ids),
    allowed_asset_ids: uniqueStrings(input.allowed_asset_ids),
    allowed_venues: uniqueStrings(input.allowed_venues),
    profit_routing: profitRouting,
    execution_permissions: normalizeExecutionPermissions(input.execution_permissions, authorityMode),
    immutable_once_superseded: true,
    raven_may_select_targets: false,
    provenance: provenance("user", "portfolio_policy_decision", "defines_constraints_only"),
  });
}

export function createPolicyActivationRule(input = {}) {
  const userId = requiredText(input.user_id, "user_id");
  if (text(input.authored_by?.type).toLowerCase() !== "user" || text(input.authored_by?.user_id) !== userId) {
    throw new Error("user_activation_rule_author_required");
  }
  return seal(PortfolioGovernorSchemas.policy_activation_rule, "UserPolicyActivationRule", {
    activation_rule_id: requiredText(input.activation_rule_id, "activation_rule_id"),
    user_id: userId,
    portfolio_id: requiredText(input.portfolio_id, "portfolio_id"),
    market_posture: requiredText(input.market_posture, "market_posture"),
    activate_policy_version_id: requiredText(input.activate_policy_version_id, "activate_policy_version_id"),
    authored_at: timestamp(input.authored_at, "authored_at"),
    authored_by: { type: "user", user_id: userId },
    provenance: provenance("user", "policy_activation_decision", "selects_pre_authored_policy_version"),
  });
}

export function resolvePolicyForMarketPosture({ activePolicy, marketPosture, activationRule = null, policyVersions = [], occurredAt } = {}) {
  const current = assertRecord(activePolicy, "UserPolicyVersion");
  const posture = assertRecord(marketPosture, "MarketPosture");
  const at = timestamp(occurredAt, "occurred_at");
  if (!activationRule) {
    return {
      ok: false,
      active_policy: current,
      refusal: createGovernorOutcome({
        reason_code: "market_posture_has_no_policy_authority",
        occurred_at: at,
        refs: { policy: reference(current), market_posture: reference(posture) },
      }),
    };
  }
  const rule = assertRecord(activationRule, "UserPolicyActivationRule");
  if (rule.user_id !== current.user_id || rule.portfolio_id !== current.portfolio_id || rule.market_posture !== posture.posture) {
    throw new Error("policy_activation_rule_mismatch");
  }
  const selected = policyVersions.find((candidate) => candidate?.policy_version_id === rule.activate_policy_version_id);
  assertRecord(selected, "UserPolicyVersion");
  if (selected.user_id !== current.user_id || selected.portfolio_id !== current.portfolio_id) throw new Error("activated_policy_owner_mismatch");
  return { ok: true, active_policy: selected, activation_rule: rule, market_posture: posture };
}

function exposureFor(measurement, scopeType, scopeId) {
  return measurement.exposures.find((row) => row.scope_type === scopeType && row.scope_id === scopeId) || {
    scope_type: scopeType,
    scope_id: scopeId,
    value_minor: "0",
    allocation_bps: 0,
    position_ids: [],
  };
}

function violationRecord({ policy, snapshot, measurement, rule, scopeId, currentBps, boundaryBps, direction, calculatedAt }) {
  const identity = {
    policy_version_id: policy.policy_version_id,
    snapshot_id: snapshot.snapshot_id,
    measurement_id: measurement.measurement_id,
    rule_id: rule.rule_id,
    scope_type: rule.scope_type,
    scope_id: scopeId,
    direction,
  };
  return seal(PortfolioGovernorSchemas.policy_violation, "PolicyViolation", {
    violation_id: `vio_${canonicalContractHash(identity).slice(0, 24)}`,
    calculated_at: calculatedAt,
    policy_ref: reference(policy),
    snapshot_ref: reference(snapshot),
    measurement_ref: reference(measurement),
    rule_id: rule.rule_id,
    rule_kind: rule.rule_kind,
    scope_type: rule.scope_type,
    scope_id: scopeId,
    current_bps: currentBps,
    boundary_bps: boundaryBps,
    delta_bps: Math.abs(currentBps - boundaryBps),
    direction,
    desired_state_source: "user_policy_version",
    provenance: provenance("raven", "deterministic_policy_evaluation", "none"),
  });
}

function evaluateMeasuredState(policy, snapshot, measurement, calculatedAt) {
  const violations = [];
  for (const band of policy.allocation_bands) {
    const exposure = exposureFor(measurement, band.scope_type, band.scope_id);
    const current = exposure.allocation_bps ?? 0;
    const rule = { ...band, rule_kind: "allocation_band" };
    if (band.minimum_bps !== null && current < band.minimum_bps) {
      violations.push(violationRecord({ policy, snapshot, measurement, rule, scopeId: band.scope_id, currentBps: current, boundaryBps: band.minimum_bps, direction: "below_minimum", calculatedAt }));
    } else if (band.maximum_bps !== null && current > band.maximum_bps) {
      violations.push(violationRecord({ policy, snapshot, measurement, rule, scopeId: band.scope_id, currentBps: current, boundaryBps: band.maximum_bps, direction: "above_maximum", calculatedAt }));
    }
  }
  for (const limit of policy.concentration_limits) {
    const candidates = measurement.exposures.filter((row) => row.scope_type === limit.scope_type && (limit.scope_id === "*" || row.scope_id === limit.scope_id));
    for (const exposure of candidates) {
      if (exposure.allocation_bps !== null && exposure.allocation_bps > limit.maximum_bps) {
        violations.push(violationRecord({
          policy,
          snapshot,
          measurement,
          rule: { ...limit, rule_kind: "concentration_limit" },
          scopeId: exposure.scope_id,
          currentBps: exposure.allocation_bps,
          boundaryBps: limit.maximum_bps,
          direction: "above_maximum",
          calculatedAt,
        }));
      }
    }
  }
  return violations;
}

export function evaluatePortfolioPolicy(input = {}) {
  const policy = assertRecord(input.policy_version, "UserPolicyVersion");
  const snapshot = assertRecord(input.snapshot, "PortfolioSnapshot");
  const measurement = assertRecord(input.measurement, "PortfolioMeasurement");
  const calculatedAt = timestamp(input.calculated_at, "calculated_at");
  if (policy.user_id !== snapshot.user_id || policy.portfolio_id !== snapshot.portfolio_id) throw new Error("policy_portfolio_mismatch");
  if (!sameReference(measurement.snapshot_ref, reference(snapshot))) throw new Error("measurement_snapshot_mismatch");
  if (measurement.state !== "available" || measurement.exposures.some((row) => row.allocation_bps === null)) {
    const blocked = createGovernorOutcome({
      reason_code: "insufficient_valuation_confidence",
      occurred_at: calculatedAt,
      refs: { policy: reference(policy), snapshot: reference(snapshot), measurement: reference(measurement) },
    });
    const evaluation = seal(PortfolioGovernorSchemas.policy_evaluation, "PolicyEvaluation", {
      evaluation_id: requiredText(input.evaluation_id, "evaluation_id"),
      calculated_at: calculatedAt,
      state: "not_evaluable",
      policy_ref: reference(policy),
      snapshot_ref: reference(snapshot),
      measurement_ref: reference(measurement),
      violation_refs: [],
      outcome_ref: reference(blocked),
      provenance: provenance("raven", "deterministic_policy_evaluation", "none"),
    });
    return { ok: false, evaluation, violations: [], outcome: blocked };
  }
  const violations = evaluateMeasuredState(policy, snapshot, measurement, calculatedAt);
  const outcome = violations.length ? null : createGovernorOutcome({
    reason_code: "portfolio_within_policy",
    occurred_at: calculatedAt,
    refs: { policy: reference(policy), snapshot: reference(snapshot), measurement: reference(measurement) },
  });
  const evaluation = seal(PortfolioGovernorSchemas.policy_evaluation, "PolicyEvaluation", {
    evaluation_id: requiredText(input.evaluation_id, "evaluation_id"),
    calculated_at: calculatedAt,
    state: violations.length ? "outside_policy" : "inside_policy",
    policy_ref: reference(policy),
    snapshot_ref: reference(snapshot),
    measurement_ref: reference(measurement),
    violation_refs: violations.map(reference),
    outcome_ref: outcome ? reference(outcome) : null,
    provenance: provenance("raven", "deterministic_policy_evaluation", "none"),
  });
  return { ok: true, evaluation, violations, outcome };
}

function policyBandForViolation(policy, violation) {
  if (violation.rule_kind === "allocation_band") return policy.allocation_bands.find((row) => row.rule_id === violation.rule_id) || null;
  if (violation.rule_kind === "concentration_limit") return policy.concentration_limits.find((row) => row.rule_id === violation.rule_id) || null;
  return null;
}

function policyProtectsPosition(policy, position) {
  if (policy.protected_asset_ids.includes(position.asset_id)) return true;
  const bucket = policy.capital_buckets.find((row) => row.bucket_id === position.bucket_id);
  return Boolean(bucket?.protected_from_sale || bucket?.kind === "cold");
}

function actionPosition(input = {}, index = 0) {
  return normalizePosition({
    position_id: input.position_id || `expected_destination_${index}`,
    economic_lot_id: input.economic_lot_id || `expected_destination_lot_${index}`,
    asset_id: input.asset_id,
    bucket_id: input.bucket_id,
    protocol_id: input.protocol_id,
    stablecoin_issuer_id: input.stablecoin_issuer_id,
    executable_value_minor: input.executable_value_minor,
    liability_value_minor: "0",
    routeability: "routeable",
    valuation_confidence: "high",
    valuation_source: "rebalance_calculation",
    observed_at: input.observed_at,
  }, index);
}

function applyAction(snapshot, action, calculatedAt) {
  const amount = BigInt(action.amount_minor);
  const positions = snapshot.positions.map(clone);
  if (action.action_type === "route_inflow") {
    positions.push(actionPosition({ ...action.destination, executable_value_minor: amount.toString(), observed_at: calculatedAt }, positions.length));
    return positions;
  }
  const sourceIndex = positions.findIndex((row) => row.position_id === action.source_position_id);
  if (sourceIndex < 0) throw new Error("source_position_not_found");
  const source = positions[sourceIndex];
  const sourceValue = BigInt(source.executable_value_minor || "0");
  if (amount > sourceValue) throw new Error("source_position_value_exceeded");
  positions[sourceIndex] = { ...source, executable_value_minor: (sourceValue - amount).toString() };
  positions.push(actionPosition({ ...action.destination, executable_value_minor: amount.toString(), observed_at: calculatedAt }, positions.length));
  return positions;
}

function violationAllocation(measured, violation) {
  return exposureFor(measured, violation.scope_type, violation.scope_id).allocation_bps ?? 0;
}

function newBandViolation(before, after, band) {
  const beforeBps = exposureFor(before, band.scope_type, band.scope_id).allocation_bps ?? 0;
  const afterBps = exposureFor(after, band.scope_type, band.scope_id).allocation_bps ?? 0;
  const beforeInside = (band.minimum_bps === null || beforeBps >= band.minimum_bps) && (band.maximum_bps === null || beforeBps <= band.maximum_bps);
  const afterInside = (band.minimum_bps === null || afterBps >= band.minimum_bps) && (band.maximum_bps === null || afterBps <= band.maximum_bps);
  return beforeInside && !afterInside;
}

export function calculateRebalance(input = {}) {
  const policy = assertRecord(input.policy_version, "UserPolicyVersion");
  const snapshot = assertRecord(input.snapshot, "PortfolioSnapshot");
  const measurement = assertRecord(input.measurement, "PortfolioMeasurement");
  const calculatedAt = timestamp(input.calculated_at, "calculated_at");
  if (!input.violation && !policy.allocation_bands.length && !policy.concentration_limits.length) {
    return refusal("policy_target_absent", calculatedAt, {
      policy: reference(policy),
      snapshot: reference(snapshot),
      measurement: reference(measurement),
    });
  }
  const violation = assertRecord(input.violation, "PolicyViolation");
  const refs = { policy: reference(policy), snapshot: reference(snapshot), measurement: reference(measurement), violation: reference(violation) };
  if (!sameReference(violation.policy_ref, refs.policy) || !sameReference(violation.snapshot_ref, refs.snapshot) || !sameReference(violation.measurement_ref, refs.measurement)) {
    throw new Error("rebalance_provenance_mismatch");
  }
  const rule = policyBandForViolation(policy, violation);
  if (!rule) return refusal("policy_target_absent", calculatedAt, refs);
  const actionType = text(input.action?.action_type).toLowerCase();
  if (!new Set(["route_inflow", "internal_reallocation"]).has(actionType)) throw new Error("rebalance_action_type_invalid");
  const amountMinor = integerString(input.action?.amount_minor, "action.amount_minor", { allowZero: false });
  const action = {
    action_type: actionType,
    amount_minor: amountMinor,
    source_position_id: actionType === "internal_reallocation" ? requiredText(input.action?.source_position_id, "action.source_position_id") : null,
    destination: clone(input.action?.destination || {}),
    venue: text(input.action?.venue) || null,
  };
  const permissions = policy.execution_permissions;
  const amount = BigInt(amountMinor);
  if (permissions.minimum_trade_minor !== null && amount < BigInt(permissions.minimum_trade_minor)) return refusal("minimum_trade_not_met", calculatedAt, refs, { amount_minor: amountMinor });
  if (permissions.maximum_transaction_minor !== null && amount > BigInt(permissions.maximum_transaction_minor)) return refusal("maximum_transaction_exceeded", calculatedAt, refs, { amount_minor: amountMinor });
  if (actionType === "internal_reallocation" && permissions.daily_turnover_limit_minor !== null) {
    const used = BigInt(integerString(input.daily_turnover_used_minor ?? "0", "daily_turnover_used_minor"));
    if (used + amount > BigInt(permissions.daily_turnover_limit_minor)) return refusal("daily_turnover_limit", calculatedAt, refs);
  }
  const destinationAsset = requiredText(action.destination.asset_id, "action.destination.asset_id");
  if (!policy.allowed_asset_ids.includes(destinationAsset)) return refusal("asset_not_allowed", calculatedAt, refs, { asset_id: destinationAsset });
  if (action.venue && !policy.allowed_venues.includes(action.venue)) return refusal("venue_not_allowed", calculatedAt, refs, { venue: action.venue });
  if (actionType === "internal_reallocation") {
    const source = snapshot.positions.find((row) => row.position_id === action.source_position_id);
    if (!source) throw new Error("source_position_not_found");
    if (source.routeability !== "routeable") return refusal("position_not_routeable", calculatedAt, refs, { position_id: source.position_id });
    if (policyProtectsPosition(policy, source)) return refusal("cold_asset_protected", calculatedAt, refs, { position_id: source.position_id, asset_id: source.asset_id, bucket_id: source.bucket_id });
    if (!policy.allowed_asset_ids.includes(source.asset_id)) return refusal("asset_not_allowed", calculatedAt, refs, { asset_id: source.asset_id });
  }
  const expectedPositions = applyAction(snapshot, action, calculatedAt);
  const expected = measurePositions(expectedPositions);
  const beforeBps = violationAllocation(measurement, violation);
  const afterBps = violationAllocation(expected, violation);
  const improves = violation.direction === "above_maximum" ? afterBps < beforeBps : afterBps > beforeBps;
  if (!improves) return refusal("correction_does_not_reduce_violation", calculatedAt, refs, { before_bps: beforeBps, after_bps: afterBps });
  if (violation.direction === "above_maximum" && rule.minimum_bps !== null && afterBps < rule.minimum_bps) {
    return refusal("correction_outside_user_band", calculatedAt, refs, { before_bps: beforeBps, after_bps: afterBps });
  }
  if (violation.direction === "below_minimum" && rule.maximum_bps !== null && afterBps > rule.maximum_bps) {
    return refusal("correction_outside_user_band", calculatedAt, refs, { before_bps: beforeBps, after_bps: afterBps });
  }
  if (policy.allocation_bands.some((band) => newBandViolation(measurement, expected, band))) {
    return refusal("correction_outside_user_band", calculatedAt, refs);
  }
  for (const limit of policy.concentration_limits) {
    const currentRows = measurement.exposures.filter((row) => row.scope_type === limit.scope_type && (limit.scope_id === "*" || row.scope_id === limit.scope_id));
    const expectedRows = expected.exposures.filter((row) => row.scope_type === limit.scope_type && (limit.scope_id === "*" || row.scope_id === limit.scope_id));
    const worsened = expectedRows.some((row) => {
      const before = currentRows.find((candidate) => candidate.scope_id === row.scope_id)?.allocation_bps || 0;
      return row.allocation_bps > limit.maximum_bps && row.allocation_bps > before;
    });
    if (worsened) {
      const reason = limit.scope_type === "stablecoin_issuer" ? "stablecoin_concentration_would_increase" : limit.scope_type === "protocol" ? "protocol_risk_limit" : "correction_outside_user_band";
      return refusal(reason, calculatedAt, refs);
    }
  }
  const record = seal(PortfolioGovernorSchemas.rebalance_calculation, "RebalanceCalculation", {
    calculation_id: requiredText(input.calculation_id, "calculation_id"),
    calculated_at: calculatedAt,
    policy_ref: refs.policy,
    snapshot_ref: refs.snapshot,
    measurement_ref: refs.measurement,
    violation_ref: refs.violation,
    action,
    expected_post_state: {
      state_type: "calculated_not_observed",
      economic_numeraire: snapshot.economic_numeraire,
      total_asset_value_minor: expected.total_asset_value_minor,
      total_liability_value_minor: expected.total_liability_value_minor,
      net_value_minor: expected.net_value_minor,
      exposures: expected.exposures,
    },
    targeted_allocation: { before_bps: beforeBps, expected_after_bps: afterBps, user_boundary_bps: violation.boundary_bps },
    target_source: "user_policy_version",
    raven_selected_target: false,
    execution_authorized: false,
    provenance: provenance("raven", "deterministic_rebalance_calculation", "none"),
  });
  return { ok: true, calculation: record };
}

export function createExecutionQuote(input = {}) {
  const policy = assertRecord(input.policy_version, "UserPolicyVersion");
  const snapshot = assertRecord(input.snapshot, "PortfolioSnapshot");
  const calculation = assertRecord(input.calculation, "RebalanceCalculation");
  const observedAt = timestamp(input.observed_at, "observed_at");
  const expiresAt = timestamp(input.expires_at, "expires_at");
  const now = timestamp(input.now || observedAt, "now");
  const refs = { policy: reference(policy), snapshot: reference(snapshot), calculation: reference(calculation) };
  if (!sameReference(calculation.policy_ref, refs.policy)) return refusal("policy_changed_since_quote", now, refs);
  if (!sameReference(calculation.snapshot_ref, refs.snapshot)) return refusal("portfolio_changed_since_quote", now, refs);
  if (Date.parse(expiresAt) <= Date.parse(now)) return refusal("quote_expired", now, refs);
  if (input.routeable !== true) return refusal("position_not_routeable", now, refs);
  const confidence = text(input.confidence || "unavailable").toLowerCase();
  if (!(confidence in QUOTE_CONFIDENCE_RANK)) throw new Error("quote_confidence_invalid");
  if (QUOTE_CONFIDENCE_RANK[confidence] < QUOTE_CONFIDENCE_RANK[policy.execution_permissions.minimum_quote_confidence]) {
    return refusal("insufficient_quote_confidence", now, refs, { confidence, required: policy.execution_permissions.minimum_quote_confidence });
  }
  const frictionBps = basisPoints(input.total_friction_bps, "total_friction_bps");
  if (policy.execution_permissions.maximum_friction_bps !== null && frictionBps > policy.execution_permissions.maximum_friction_bps) {
    return refusal("rebalance_not_economically_justified", now, refs, { total_friction_bps: frictionBps, maximum_friction_bps: policy.execution_permissions.maximum_friction_bps });
  }
  const quote = seal(PortfolioGovernorSchemas.execution_quote, "ExecutionQuote", {
    quote_id: requiredText(input.quote_id, "quote_id"),
    observed_at: observedAt,
    expires_at: expiresAt,
    policy_ref: refs.policy,
    snapshot_ref: refs.snapshot,
    calculation_ref: refs.calculation,
    venue: requiredText(input.venue, "venue"),
    route_id: requiredText(input.route_id, "route_id"),
    input_asset_id: requiredText(input.input_asset_id, "input_asset_id"),
    input_amount_base_units: integerString(input.input_amount_base_units, "input_amount_base_units", { allowZero: false }),
    expected_output_asset_id: requiredText(input.expected_output_asset_id, "expected_output_asset_id"),
    expected_output_amount_base_units: integerString(input.expected_output_amount_base_units, "expected_output_amount_base_units"),
    minimum_output_amount_base_units: integerString(input.minimum_output_amount_base_units, "minimum_output_amount_base_units"),
    total_friction_bps: frictionBps,
    confidence,
    routeable: true,
    provider_evidence_ref: requiredText(input.provider_evidence_ref, "provider_evidence_ref"),
    execution_authorized: false,
    provenance: provenance("external_source", "contemporaneous_execution_evidence", "none"),
  });
  return { ok: true, quote };
}

export function createUserAuthorization(input = {}) {
  const policy = assertRecord(input.current_policy_version, "UserPolicyVersion");
  const snapshot = assertRecord(input.current_snapshot, "PortfolioSnapshot");
  const quote = assertRecord(input.quote, "ExecutionQuote");
  const authorizedAt = timestamp(input.authorized_at, "authorized_at");
  const expiresAt = timestamp(input.expires_at || quote.expires_at, "expires_at");
  const refs = { policy: reference(policy), snapshot: reference(snapshot), quote: reference(quote) };
  if (!sameReference(quote.policy_ref, refs.policy)) return refusal("policy_changed_since_quote", authorizedAt, refs);
  if (!sameReference(quote.snapshot_ref, refs.snapshot)) return refusal("portfolio_changed_since_quote", authorizedAt, refs);
  if (Date.parse(quote.expires_at) <= Date.parse(authorizedAt) || Date.parse(expiresAt) <= Date.parse(authorizedAt)) return refusal("quote_expired", authorizedAt, refs);
  if (policy.authority_mode !== "user_signed_rebalance") return refusal("execution_mode_not_enabled", authorizedAt, refs);
  if (input.user_confirmation !== true || requiredText(input.user_id, "user_id") !== policy.user_id) return refusal("authorization_missing", authorizedAt, refs);
  const authorization = seal(PortfolioGovernorSchemas.user_authorization, "UserAuthorization", {
    authorization_id: requiredText(input.authorization_id, "authorization_id"),
    user_id: policy.user_id,
    portfolio_id: policy.portfolio_id,
    authorized_at: authorizedAt,
    expires_at: expiresAt,
    policy_ref: refs.policy,
    snapshot_ref: refs.snapshot,
    calculation_ref: quote.calculation_ref,
    quote_ref: refs.quote,
    wallet_link_id: requiredText(input.wallet_link_id, "wallet_link_id"),
    scope: "single_exact_quote",
    user_confirmation: true,
    wallet_signature_required: true,
    wallet_signature_observed: false,
    raven_custody_granted: false,
    provenance: provenance("user", "transaction_authorization", "authorizes_one_exact_wallet_handoff"),
  });
  return { ok: true, authorization };
}

export function createGovernorExecutionIntent(input = {}) {
  const occurredAt = timestamp(input.created_at, "created_at");
  if (!input.authorization) return refusal("authorization_missing", occurredAt, {});
  const policy = assertRecord(input.current_policy_version, "UserPolicyVersion");
  const quote = assertRecord(input.quote, "ExecutionQuote");
  const authorization = assertRecord(input.authorization, "UserAuthorization");
  const refs = { policy: reference(policy), quote: reference(quote), authorization: reference(authorization) };
  if (!sameReference(authorization.policy_ref, refs.policy) || !sameReference(quote.policy_ref, refs.policy)) return refusal("policy_changed_since_quote", occurredAt, refs);
  if (!sameReference(authorization.quote_ref, refs.quote)) return refusal("authorization_missing", occurredAt, refs);
  if (Date.parse(quote.expires_at) <= Date.parse(occurredAt)) return refusal("quote_expired", occurredAt, refs);
  if (Date.parse(authorization.expires_at) <= Date.parse(occurredAt)) return refusal("authorization_expired", occurredAt, refs);
  const intent = seal(PortfolioGovernorSchemas.execution_intent, "ExecutionIntent", {
    execution_intent_id: requiredText(input.execution_intent_id, "execution_intent_id"),
    created_at: occurredAt,
    policy_ref: refs.policy,
    snapshot_ref: quote.snapshot_ref,
    calculation_ref: quote.calculation_ref,
    quote_ref: refs.quote,
    authorization_ref: refs.authorization,
    wallet_link_id: authorization.wallet_link_id,
    state: "awaiting_user_signature",
    custody_model: "non_custodial",
    user_wallet_signature_required: true,
    raven_private_key_access: false,
    raven_omnibus_account: false,
    submission_authorized: false,
    provenance: provenance("raven", "authorized_intent_preparation", "bounded_by_exact_user_authorization"),
  });
  return { ok: true, execution_intent: intent };
}

export function createFundingEvent(input = {}) {
  const eventType = text(input.event_type).toLowerCase();
  if (!new Set(["deposit", "realized_profit", "realized_loss", "reward"]).has(eventType)) throw new Error("funding_event_type_invalid");
  return seal(PortfolioGovernorSchemas.funding_event, "FundingEvent", {
    funding_event_id: requiredText(input.funding_event_id, "funding_event_id"),
    portfolio_id: requiredText(input.portfolio_id, "portfolio_id"),
    user_id: requiredText(input.user_id, "user_id"),
    occurred_at: timestamp(input.occurred_at, "occurred_at"),
    event_type: eventType,
    amount_minor: integerString(input.amount_minor, "amount_minor"),
    source_outcome_ref: requiredText(input.source_outcome_ref, "source_outcome_ref"),
    provenance: provenance(eventType === "deposit" ? "user" : "raven", "funding_accounting_event", "none"),
  });
}

export function calculateProfitRouting(input = {}) {
  const policy = assertRecord(input.policy_version, "UserPolicyVersion");
  const funding = assertRecord(input.funding_event, "FundingEvent");
  const calculatedAt = timestamp(input.calculated_at, "calculated_at");
  const refs = { policy: reference(policy), funding_event: reference(funding) };
  if (policy.user_id !== funding.user_id || policy.portfolio_id !== funding.portfolio_id) throw new Error("funding_policy_owner_mismatch");
  if (funding.event_type !== "realized_profit" || BigInt(funding.amount_minor) <= 0n) return refusal("no_distributable_profit", calculatedAt, refs);
  if (!policy.profit_routing.length) return refusal("profit_routing_not_configured", calculatedAt, refs);
  const amount = BigInt(funding.amount_minor);
  const allocations = policy.profit_routing.map((route) => ({
    route_id: route.route_id,
    destination_bucket_id: route.destination_bucket_id,
    share_bps: route.share_bps,
    amount_minor: ((amount * BigInt(route.share_bps)) / 10_000n).toString(),
  }));
  const allocated = allocations.reduce((sum, row) => sum + BigInt(row.amount_minor), 0n);
  const calculation = seal(PortfolioGovernorSchemas.profit_routing_calculation, "ProfitRoutingCalculation", {
    routing_calculation_id: requiredText(input.routing_calculation_id, "routing_calculation_id"),
    calculated_at: calculatedAt,
    policy_ref: refs.policy,
    funding_event_ref: refs.funding_event,
    allocations,
    unallocated_minor: (amount - allocated).toString(),
    balance_mutation_performed: false,
    routing_source: "user_policy_version",
    provenance: provenance("raven", "deterministic_profit_routing_calculation", "none"),
  });
  return { ok: true, calculation };
}

export function createExecutionFill(input = {}) {
  const intent = assertRecord(input.execution_intent, "ExecutionIntent");
  return seal(PortfolioGovernorSchemas.execution_fill, "ExecutionFill", {
    execution_fill_id: requiredText(input.execution_fill_id, "execution_fill_id"),
    observed_at: timestamp(input.observed_at, "observed_at"),
    execution_intent_ref: reference(intent),
    provider_execution_ref: requiredText(input.provider_execution_ref, "provider_execution_ref"),
    actual_input_amount_base_units: integerString(input.actual_input_amount_base_units, "actual_input_amount_base_units"),
    actual_output_amount_base_units: integerString(input.actual_output_amount_base_units, "actual_output_amount_base_units"),
    settlement_state: text(input.settlement_state || "observed").toLowerCase(),
    provenance: provenance("external_source", "execution_fill_observation", "none"),
  });
}

export function createSettlementOutcome(input = {}) {
  const fill = assertRecord(input.execution_fill, "ExecutionFill");
  const snapshot = assertRecord(input.resulting_snapshot, "PortfolioSnapshot");
  return seal(PortfolioGovernorSchemas.settlement_outcome, "SettlementOutcome", {
    settlement_outcome_id: requiredText(input.settlement_outcome_id, "settlement_outcome_id"),
    reconciled_at: timestamp(input.reconciled_at, "reconciled_at"),
    execution_fill_ref: reference(fill),
    resulting_snapshot_ref: reference(snapshot),
    reconciliation_state: text(input.reconciliation_state || "reconciled").toLowerCase(),
    provenance: provenance("raven", "settlement_reconciliation", "none"),
  });
}

export function verifyGovernorRecord(record) {
  try {
    assertRecord(record, record?.record_type);
    return { ok: true, record_hash: record.record_hash };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}
