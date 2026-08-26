import { canonicalContractHash } from "../customer_trade/contracts.mjs";

export const PortfolioGovernorSchemas = Object.freeze({
  observation: "ravenos.portfolio_governor.observation.v1",
  market_posture: "ravenos.portfolio_governor.market_posture.v1",
  economic_exposure: "ravenos.portfolio_governor.economic_exposure.v1",
  portfolio_snapshot: "ravenos.portfolio_governor.portfolio_snapshot.v1",
  portfolio_measurement: "ravenos.portfolio_governor.portfolio_measurement.v1",
  user_policy_version: "ravenos.portfolio_governor.user_policy_version.v1",
  policy_activation_rule: "ravenos.portfolio_governor.policy_activation_rule.v1",
  policy_violation: "ravenos.portfolio_governor.policy_violation.v1",
  policy_indeterminacy: "ravenos.portfolio_governor.policy_indeterminacy.v1",
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
  "policy_evaluation_indeterminate",
  "profit_routing_not_configured",
  "no_distributable_profit",
]);

const RECORD_ID_FIELDS = Object.freeze({
  Observation: "observation_id",
  MarketPosture: "market_posture_id",
  EconomicExposure: "economic_exposure_id",
  PortfolioSnapshot: "snapshot_id",
  PortfolioMeasurement: "measurement_id",
  UserPolicyVersion: "policy_version_id",
  UserPolicyActivationRule: "activation_rule_id",
  PolicyViolation: "violation_id",
  PolicyIndeterminacy: "indeterminacy_id",
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

const SCOPE_TYPES = new Set(["asset", "bucket", "protocol", "stablecoin_issuer", "stablecoin_dependency", "chain", "instrument"]);
const BUCKET_KINDS = new Set(["cold", "warm", "reserve", "retained", "excluded", "unclassified", "custom"]);
const BUCKET_ASSIGNMENT_SUBJECTS = new Set(["position", "account", "asset", "protocol"]);
const PORTFOLIO_MEASUREMENT_METRICS = new Set([
  "unresolved_exposure_bps",
  "unrouteable_exposure_bps",
  "gross_leverage_bps",
  "liability_exposure_bps",
  "executable_coverage_bps",
]);
const ROUTEABILITY_STATES = new Set(["routeable", "not_routeable", "unknown"]);
const VALUATION_CONFIDENCE = new Set(["high", "medium", "low", "unavailable"]);
const EXPOSURE_DIMENSIONS = new Set([
  "asset",
  "instrument",
  "protocol",
  "stablecoin_issuer",
  "stablecoin_dependency",
  "chain",
  "liability",
  "unresolved",
]);
const EXPOSURE_SIDES = new Set(["asset", "liability", "overlay"]);
const EXPOSURE_RESOLUTION_STATES = new Set([
  "exact",
  "observed",
  "derived",
  "estimated",
  "stale",
  "unresolved",
  "unrouteable",
]);
const POSITION_STATES = new Set(["open", "closed", "frozen", "unknown"]);
const POSITION_SIDES = new Set(["asset", "liability", "margin"]);
const VALUE_STATES = new Set(["fresh", "current", "delayed", "stale", "unavailable", "unrouteable", "not_material", "not_applicable"]);
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
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error(`${field}_invalid`);
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

function measurementBasisPoints(value, field, metric, { allowNull = false } = {}) {
  if (allowNull && (value === null || value === undefined || value === "")) return null;
  const parsed = Number(value);
  const maximum = new Set(["gross_leverage_bps", "liability_exposure_bps"]).has(metric)
    ? 1_000_000
    : 10_000;
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) throw new Error(`${field}_invalid`);
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

function optionalIntegerString(value, field) {
  return value === null || value === undefined || value === "" ? null : integerString(value, field);
}

export function createEconomicExposure(input = {}) {
  const dimensionType = text(input.dimension_type).toLowerCase();
  if (!EXPOSURE_DIMENSIONS.has(dimensionType)) throw new Error("economic_exposure_dimension_invalid");
  const exposureSide = text(input.exposure_side || (dimensionType === "liability" ? "liability" : "asset")).toLowerCase();
  if (!EXPOSURE_SIDES.has(exposureSide)) throw new Error("economic_exposure_side_invalid");
  const resolutionState = text(input.resolution_state || "unresolved").toLowerCase();
  if (!EXPOSURE_RESOLUTION_STATES.has(resolutionState)) throw new Error("economic_exposure_resolution_invalid");
  const routeability = text(input.routeability || "unknown").toLowerCase();
  if (!ROUTEABILITY_STATES.has(routeability)) throw new Error("economic_exposure_routeability_invalid");
  const observations = (Array.isArray(input.observations) ? input.observations : [])
    .map((row) => reference(assertRecord(row, "Observation")));
  const capitalTreatment = exposureSide === "liability" || dimensionType === "liability"
    ? "primary_liability_component"
    : ["asset", "unresolved"].includes(dimensionType)
      ? "primary_asset_component"
      : "analytical_overlay";
  if (resolutionState === "unresolved" && dimensionType !== "unresolved") {
    throw new Error("unresolved_exposure_dimension_required");
  }
  return seal(PortfolioGovernorSchemas.economic_exposure, "EconomicExposure", {
    economic_exposure_id: requiredText(input.economic_exposure_id, "economic_exposure_id"),
    portfolio_id: requiredText(input.portfolio_id, "portfolio_id"),
    user_id: requiredText(input.user_id, "user_id"),
    calculated_at: timestamp(input.calculated_at, "calculated_at"),
    economic_lot_id: requiredText(input.economic_lot_id, "economic_lot_id"),
    position_id: requiredText(input.position_id, "position_id"),
    source_instrument_asset_id: requiredText(input.source_instrument_asset_id, "source_instrument_asset_id"),
    dimension_type: dimensionType,
    scope_id: requiredText(input.scope_id, "scope_id"),
    exposure_side: exposureSide,
    capital_treatment: capitalTreatment,
    quantity_base_units: optionalIntegerString(input.quantity_base_units, "quantity_base_units"),
    asset_decimals: (() => {
      if (input.asset_decimals === null || input.asset_decimals === undefined) return null;
      const value = Number(input.asset_decimals);
      if (!Number.isSafeInteger(value) || value < 0 || value > 30) throw new Error("economic_exposure_asset_decimals_invalid");
      return value;
    })(),
    marked_value_minor: optionalIntegerString(input.marked_value_minor, "marked_value_minor"),
    executable_value_minor: optionalIntegerString(input.executable_value_minor, "executable_value_minor"),
    resolution_state: resolutionState,
    resolution_source: requiredText(input.resolution_source, "resolution_source"),
    resolution_basis: text(input.resolution_basis) || null,
    freshness_state: text(input.freshness_state || "unknown").toLowerCase(),
    routeability,
    observation_refs: observations,
    provenance: provenance("raven", "economic_exposure_calculation", "none"),
  });
}

function normalizePosition(row = {}, index = 0) {
  const routeability = text(row.routeability || "unknown").toLowerCase();
  if (!ROUTEABILITY_STATES.has(routeability)) throw new Error(`positions[${index}].routeability_invalid`);
  const confidence = text(row.valuation_confidence || "unavailable").toLowerCase();
  if (!VALUATION_CONFIDENCE.has(confidence)) throw new Error(`positions[${index}].valuation_confidence_invalid`);
  const positionState = text(row.position_state || "open").toLowerCase();
  if (!POSITION_STATES.has(positionState)) throw new Error(`positions[${index}].position_state_invalid`);
  const positionSide = text(row.position_side || "asset").toLowerCase();
  if (!POSITION_SIDES.has(positionSide)) throw new Error(`positions[${index}].position_side_invalid`);
  const executableValue = row.executable_value_minor === null || row.executable_value_minor === undefined
    ? null
    : integerString(row.executable_value_minor, `positions[${index}].executable_value_minor`);
  const markedValue = row.marked_value_minor === null || row.marked_value_minor === undefined
    ? executableValue
    : integerString(row.marked_value_minor, `positions[${index}].marked_value_minor`);
  const markedValueState = text(row.marked_value_state || (markedValue === null ? "unavailable" : "fresh")).toLowerCase();
  if (!VALUE_STATES.has(markedValueState)) throw new Error(`positions[${index}].marked_value_state_invalid`);
  const executableValueState = text(row.executable_value_state || (executableValue === null ? "unavailable" : "fresh")).toLowerCase();
  if (!VALUE_STATES.has(executableValueState)) throw new Error(`positions[${index}].executable_value_state_invalid`);
  const liabilityValue = row.liability_value_minor === null || row.liability_value_minor === undefined
    ? positionSide === "liability" ? null : "0"
    : integerString(row.liability_value_minor, `positions[${index}].liability_value_minor`);
  const liabilityValueState = text(row.liability_value_state || (
    positionSide !== "liability" ? "not_applicable" : liabilityValue === null ? "unavailable" : markedValueState
  )).toLowerCase();
  if (!VALUE_STATES.has(liabilityValueState)) throw new Error(`positions[${index}].liability_value_state_invalid`);
  const assetDecimals = row.asset_decimals === null || row.asset_decimals === undefined ? null : Number(row.asset_decimals);
  if (assetDecimals !== null && (!Number.isSafeInteger(assetDecimals) || assetDecimals < 0 || assetDecimals > 30)) {
    throw new Error(`positions[${index}].asset_decimals_invalid`);
  }
  return {
    position_id: requiredText(row.position_id, `positions[${index}].position_id`),
    economic_lot_id: requiredText(row.economic_lot_id, `positions[${index}].economic_lot_id`),
    asset_id: requiredText(row.asset_id, `positions[${index}].asset_id`),
    instrument_asset_id: text(row.instrument_asset_id || row.asset_id),
    chain_id: text(row.chain_id) || null,
    account_ref: text(row.account_ref) || null,
    position_kind: text(row.position_kind || "spot").toLowerCase(),
    position_side: positionSide,
    position_state: positionState,
    quantity_base_units: optionalIntegerString(row.quantity_base_units, `positions[${index}].quantity_base_units`),
    asset_decimals: assetDecimals,
    bucket_id: text(row.bucket_id) || null,
    protocol_id: text(row.protocol_id) || null,
    stablecoin_issuer_id: text(row.stablecoin_issuer_id) || null,
    marked_value_minor: markedValue,
    marked_value_state: markedValueState,
    marked_value_source: text(row.marked_value_source || row.valuation_source) || null,
    marked_at: optionalTimestamp(row.marked_at, `positions[${index}].marked_at`),
    expected_executable_value_minor: optionalIntegerString(row.expected_executable_value_minor, `positions[${index}].expected_executable_value_minor`),
    executable_value_minor: executableValue,
    executable_value_state: executableValueState,
    executable_quote_observation_id: text(row.executable_quote_observation_id) || null,
    liability_value_minor: liabilityValue,
    liability_value_state: liabilityValueState,
    routeability,
    valuation_confidence: confidence,
    valuation_source: text(row.valuation_source) || null,
    observed_at: optionalTimestamp(row.observed_at, `positions[${index}].observed_at`),
    metadata_state: text(row.metadata_state || "available").toLowerCase(),
    economic_resolution_state: text(row.economic_resolution_state || "unresolved").toLowerCase(),
    counted_in_nav: row.counted_in_nav !== false,
    representation_only: row.representation_only === true,
    source_observation_ids: uniqueStrings(row.source_observation_ids),
    risk_flags: uniqueStrings(row.risk_flags),
  };
}

export function createPortfolioSnapshot(input = {}) {
  const positions = (Array.isArray(input.positions) ? input.positions : []).map(normalizePosition);
  const economicExposures = (Array.isArray(input.economic_exposures) ? input.economic_exposures : [])
    .map((row) => assertRecord(row, "EconomicExposure"));
  const lots = new Set();
  const positionIdsSeen = new Set();
  for (const position of positions) {
    if (lots.has(position.economic_lot_id)) throw new Error("duplicate_economic_lot_id");
    if (positionIdsSeen.has(position.position_id)) throw new Error("duplicate_position_id");
    lots.add(position.economic_lot_id);
    positionIdsSeen.add(position.position_id);
  }
  const positionIds = new Set(positions.map((row) => row.position_id));
  for (const exposure of economicExposures) {
    if (!positionIds.has(exposure.position_id)) throw new Error("economic_exposure_position_missing");
    if (exposure.portfolio_id !== input.portfolio_id || exposure.user_id !== input.user_id) {
      throw new Error("economic_exposure_owner_mismatch");
    }
  }
  return seal(PortfolioGovernorSchemas.portfolio_snapshot, "PortfolioSnapshot", {
    snapshot_id: requiredText(input.snapshot_id, "snapshot_id"),
    portfolio_id: requiredText(input.portfolio_id, "portfolio_id"),
    user_id: requiredText(input.user_id, "user_id"),
    observed_at: timestamp(input.observed_at, "observed_at"),
    economic_numeraire: requiredText(input.economic_numeraire, "economic_numeraire").toUpperCase(),
    positions,
    economic_exposure_refs: economicExposures.map(reference),
    accounting_model_version: text(input.accounting_model_version || (economicExposures.length ? "economic_exposure.v1" : "legacy_executable_value.v1")),
    normalization_diagnostics: input.normalization_diagnostics && typeof input.normalization_diagnostics === "object"
      ? clone(input.normalization_diagnostics)
      : null,
    source_observation_ids: uniqueStrings(input.source_observation_ids),
    portfolio_targets_inferred: false,
    execution_objects_created: false,
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
    const liabilityUnavailable = position.liability_value_minor === null;
    if (!liabilityUnavailable) liabilityValue += BigInt(position.liability_value_minor || "0");
    if (position.executable_value_minor === null) {
      unavailableValuations += 1;
      continue;
    }
    if (liabilityUnavailable) unavailableValuations += 1;
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

function sumBigInt(rows, selector) {
  return rows.reduce((sum, row) => sum + BigInt(selector(row) || "0"), 0n);
}

function measureEconomicState(snapshot, economicExposures) {
  const activePositions = snapshot.positions.filter((row) => (
    row.position_state !== "closed"
    && row.counted_in_nav
    && !row.representation_only
  ));
  const assetPositions = activePositions.filter((row) => row.position_side !== "liability");
  const liabilityPositions = activePositions.filter((row) => row.position_side === "liability");
  const activePositionIds = new Set(activePositions.map((row) => row.position_id));
  const activeEconomicExposures = economicExposures.filter((row) => activePositionIds.has(row.position_id));
  const markedPositions = assetPositions.filter((row) => row.marked_value_minor !== null);
  const executablePositions = assetPositions.filter((row) => (
    row.executable_value_minor !== null
    && ["fresh", "current"].includes(row.executable_value_state)
    && row.routeability === "routeable"
  ));
  const totalMarkedAsset = sumBigInt(markedPositions, (row) => row.marked_value_minor);
  const totalExecutableAsset = sumBigInt(executablePositions, (row) => row.executable_value_minor);
  const valuedLiabilityPositions = liabilityPositions.filter((row) => row.liability_value_minor !== null);
  const unavailableLiabilityPositions = liabilityPositions.filter((row) => row.liability_value_minor === null);
  const totalLiability = sumBigInt(valuedLiabilityPositions, (row) => row.liability_value_minor);
  const netEquity = totalMarkedAsset - totalLiability;
  const unavailableMarkPositions = assetPositions.filter((row) => row.marked_value_minor === null);
  const staleMarkedPositions = markedPositions.filter((row) => ["delayed", "stale"].includes(row.marked_value_state));
  const unrouteablePositions = markedPositions.filter((row) => row.routeability === "not_routeable" || row.executable_value_state === "unrouteable");
  const unknownExecutablePositions = markedPositions.filter((row) => ![
    "fresh",
    "current",
    "not_material",
    "not_applicable",
    "unrouteable",
  ].includes(row.executable_value_state));
  const potentialExecutablePositions = markedPositions.filter((row) => (
    row.executable_value_minor === null
    && row.routeability !== "not_routeable"
    && row.executable_value_state !== "not_applicable"
  ));
  const unknownRouteabilityPositions = markedPositions.filter((row) => row.routeability === "unknown");
  const unresolvedPrimary = activeEconomicExposures.filter((row) => (
    row.dimension_type === "unresolved"
    && row.capital_treatment === "primary_asset_component"
  ));
  const unresolvedMarkedValue = sumBigInt(unresolvedPrimary.filter((row) => row.marked_value_minor !== null), (row) => row.marked_value_minor);
  const unresolvedUnknownCount = unresolvedPrimary.filter((row) => row.marked_value_minor === null).length;
  const unresolvedCandidateValues = Object.fromEntries([
    "asset",
    "protocol",
    "stablecoin_issuer",
    "stablecoin_dependency",
  ].map((scopeType) => {
    const positionsWithKnownScope = new Set(activeEconomicExposures
      .filter((row) => row.dimension_type === scopeType && row.scope_id !== "unresolved")
      .map((row) => row.position_id));
    const candidates = scopeType === "asset"
      ? unresolvedPrimary
      : unresolvedPrimary.filter((row) => !positionsWithKnownScope.has(row.position_id));
    return [scopeType, sumBigInt(candidates.filter((row) => row.marked_value_minor !== null), (row) => row.marked_value_minor)];
  }));
  const staleMarkedValue = sumBigInt(staleMarkedPositions, (row) => row.marked_value_minor);
  const unrouteableMarkedValue = sumBigInt(unrouteablePositions, (row) => row.marked_value_minor);
  const potentiallyExecutableMarkedValue = sumBigInt(potentialExecutablePositions, (row) => row.marked_value_minor);
  const unknownRouteabilityValue = sumBigInt(unknownRouteabilityPositions, (row) => row.marked_value_minor);
  const groups = new Map();

  for (const exposure of activeEconomicExposures) {
    const key = `${exposure.dimension_type}:${exposure.scope_id}:${exposure.exposure_side}`;
    const current = groups.get(key) || {
      scope_type: exposure.dimension_type,
      scope_id: exposure.scope_id,
      exposure_side: exposure.exposure_side,
      marked_value: 0n,
      executable_value: 0n,
      has_marked_value: false,
      has_executable_value: false,
      stale_value: 0n,
      unrouteable_value: 0n,
      position_ids: [],
      economic_exposure_ids: [],
      resolution_states: [],
    };
    if (exposure.marked_value_minor !== null) {
      const value = BigInt(exposure.marked_value_minor);
      current.marked_value += value;
      current.has_marked_value = true;
      if (["delayed", "stale"].includes(exposure.freshness_state) || exposure.resolution_state === "stale") {
        current.stale_value += value;
      }
      if (exposure.routeability === "not_routeable" || exposure.resolution_state === "unrouteable") {
        current.unrouteable_value += value;
      }
    }
    if (exposure.executable_value_minor !== null) {
      current.executable_value += BigInt(exposure.executable_value_minor);
      current.has_executable_value = true;
    }
    current.position_ids.push(exposure.position_id);
    current.economic_exposure_ids.push(exposure.economic_exposure_id);
    current.resolution_states.push(exposure.resolution_state);
    groups.set(key, current);
  }

  const accountingComplete = unavailableMarkPositions.length === 0 && unavailableLiabilityPositions.length === 0;
  const denominatorKnown = accountingComplete && netEquity > 0n;
  const exposures = [...groups.values()]
    .map((row) => {
      const value = row.marked_value;
      const canAbsorbUnresolved = ["asset", "protocol", "stablecoin_issuer", "stablecoin_dependency"].includes(row.scope_type)
        && row.scope_id !== "unresolved";
      const unresolvedRelevant = canAbsorbUnresolved ? unresolvedCandidateValues[row.scope_type] : 0n;
      return {
        scope_type: row.scope_type,
        scope_id: row.scope_id,
        exposure_side: row.exposure_side,
        value_minor: row.has_marked_value ? value.toString() : null,
        executable_value_minor: row.has_executable_value ? row.executable_value.toString() : null,
        allocation_bps: denominatorKnown ? roundedBps(value, netEquity) : null,
        lower_bound_bps: denominatorKnown ? roundedBps(value, netEquity) : null,
        upper_bound_bps: denominatorKnown && unresolvedUnknownCount === 0
          ? roundedBps(value + unresolvedRelevant, netEquity)
          : null,
        unresolved_relevant_value_minor: unresolvedRelevant.toString(),
        stale_value_minor: row.stale_value.toString(),
        unrouteable_value_minor: row.unrouteable_value.toString(),
        position_ids: [...new Set(row.position_ids)].sort(),
        economic_exposure_ids: [...new Set(row.economic_exposure_ids)].sort(),
        resolution_states: [...new Set(row.resolution_states)].sort(),
      };
    })
    .sort((left, right) => `${left.scope_type}:${left.scope_id}:${left.exposure_side}`.localeCompare(`${right.scope_type}:${right.scope_id}:${right.exposure_side}`));

  const stateReasons = [];
  if (unavailableMarkPositions.length) stateReasons.push("marked_value_unavailable");
  if (unavailableLiabilityPositions.length) stateReasons.push("liability_value_unavailable");
  if (staleMarkedPositions.length) stateReasons.push("stale_valuation");
  if (unresolvedPrimary.length) stateReasons.push("underlying_exposure_unresolved");
  if (unrouteablePositions.length) stateReasons.push("position_unrouteable");
  if (unknownExecutablePositions.length) stateReasons.push("executable_value_unavailable");
  const state = activePositions.length === 0
    ? "empty"
    : markedPositions.length === 0
      ? "unavailable"
      : stateReasons.length
        ? "partial"
        : "available";

  return {
    accounting_model: "economic_exposure",
    total_asset_value_minor: totalMarkedAsset.toString(),
    total_marked_asset_value_minor: totalMarkedAsset.toString(),
    total_executable_asset_value_minor: totalExecutableAsset.toString(),
    total_liability_value_minor: totalLiability.toString(),
    total_liability_value_state: unavailableLiabilityPositions.length ? "partial" : "current",
    unavailable_liability_valuations: unavailableLiabilityPositions.length,
    net_equity_minor: accountingComplete ? netEquity.toString() : null,
    net_value_minor: accountingComplete && netEquity > 0n ? netEquity.toString() : "0",
    gross_asset_exposure_minor: totalMarkedAsset.toString(),
    gross_economic_exposure_minor: (totalMarkedAsset + totalLiability).toString(),
    unresolved_value_minor: unresolvedMarkedValue.toString(),
    unresolved_unknown_value_count: unresolvedUnknownCount,
    unresolved_candidate_value_minor_by_scope_type: Object.fromEntries(
      Object.entries(unresolvedCandidateValues).map(([scopeType, value]) => [scopeType, value.toString()]),
    ),
    unresolved_candidate_allocation_bps_by_scope_type: Object.fromEntries(
      Object.entries(unresolvedCandidateValues).map(([scopeType, value]) => [scopeType, denominatorKnown ? roundedBps(value, netEquity) : null]),
    ),
    unrouteable_value_minor: unrouteableMarkedValue.toString(),
    unknown_routeability_value_minor: unknownRouteabilityValue.toString(),
    potentially_executable_value_minor: potentiallyExecutableMarkedValue.toString(),
    stale_value_minor: staleMarkedValue.toString(),
    unavailable_valuations: unavailableMarkPositions.length + unavailableLiabilityPositions.length,
    unavailable_asset_valuations: unavailableMarkPositions.length,
    unavailable_executable_valuations: unknownExecutablePositions.length,
    executable_coverage_bps: totalMarkedAsset > 0n ? roundedBps(totalExecutableAsset, totalMarkedAsset) : null,
    unresolved_allocation_bps: denominatorKnown ? roundedBps(unresolvedMarkedValue, netEquity) : null,
    unrouteable_allocation_bps: denominatorKnown ? roundedBps(unrouteableMarkedValue, netEquity) : null,
    liability_exposure_bps: denominatorKnown ? roundedBps(totalLiability, netEquity) : null,
    state,
    state_reasons: [...new Set(stateReasons)].sort(),
    exposures,
    economic_exposure_refs: economicExposures.map(reference),
    portfolio_targets_inferred: false,
    market_posture_effect: "none",
    execution_objects_created: false,
  };
}

export function createPortfolioMeasurement(input = {}) {
  const snapshot = assertRecord(input.snapshot, "PortfolioSnapshot");
  const economicExposures = (Array.isArray(input.economic_exposures) ? input.economic_exposures : [])
    .map((row) => assertRecord(row, "EconomicExposure"));
  if (snapshot.accounting_model_version === "economic_exposure.v1") {
    const expectedRefs = new Map(snapshot.economic_exposure_refs.map((row) => [row.record_id, row.record_hash]));
    if (expectedRefs.size !== economicExposures.length || economicExposures.some((row) => expectedRefs.get(row.economic_exposure_id) !== row.record_hash)) {
      throw new Error("measurement_economic_exposure_mismatch");
    }
  } else if (economicExposures.length) {
    throw new Error("measurement_snapshot_exposure_model_mismatch");
  }
  const measured = snapshot.accounting_model_version === "economic_exposure.v1"
    ? measureEconomicState(snapshot, economicExposures)
    : measurePositions(snapshot.positions);
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
    gross_leverage_bps: measured.gross_economic_exposure_minor && BigInt(measured.net_value_minor) > 0n
      ? roundedBps(BigInt(measured.gross_economic_exposure_minor), BigInt(measured.net_value_minor))
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
  if (!new Set(["asset", "protocol", "stablecoin_issuer", "stablecoin_dependency"]).has(scopeType)) {
    throw new Error(`concentration_limits[${index}].scope_type_invalid`);
  }
  return {
    rule_id: requiredText(row.rule_id, `concentration_limits[${index}].rule_id`),
    scope_type: scopeType,
    scope_id: text(row.scope_id) || "*",
    maximum_bps: basisPoints(row.maximum_bps, `concentration_limits[${index}].maximum_bps`),
  };
}

function normalizeMeasurementLimit(row = {}, index = 0) {
  const metric = text(row.metric).toLowerCase();
  if (!PORTFOLIO_MEASUREMENT_METRICS.has(metric)) throw new Error(`measurement_limits[${index}].metric_invalid`);
  const minimum = measurementBasisPoints(row.minimum_bps, `measurement_limits[${index}].minimum_bps`, metric, { allowNull: true });
  const maximum = measurementBasisPoints(row.maximum_bps, `measurement_limits[${index}].maximum_bps`, metric, { allowNull: true });
  if (minimum === null && maximum === null) throw new Error(`measurement_limits[${index}].boundary_required`);
  if (minimum !== null && maximum !== null && minimum > maximum) throw new Error(`measurement_limits[${index}].range_invalid`);
  return {
    rule_id: requiredText(row.rule_id, `measurement_limits[${index}].rule_id`),
    metric,
    minimum_bps: minimum,
    maximum_bps: maximum,
  };
}

function normalizeBucketAssignment(row = {}, index = 0) {
  const subjectType = text(row.subject_type).toLowerCase();
  if (!BUCKET_ASSIGNMENT_SUBJECTS.has(subjectType)) throw new Error(`capital_bucket_assignments[${index}].subject_type_invalid`);
  return {
    assignment_id: requiredText(row.assignment_id, `capital_bucket_assignments[${index}].assignment_id`),
    subject_type: subjectType,
    subject_id: requiredText(row.subject_id, `capital_bucket_assignments[${index}].subject_id`),
    bucket_id: requiredText(row.bucket_id, `capital_bucket_assignments[${index}].bucket_id`),
  };
}

function assertCompatiblePolicyRules(allocationBands, concentrationLimits, measurementLimits) {
  const byScope = new Map();
  for (const band of allocationBands) {
    const key = `${band.scope_type}:${band.scope_id}`;
    const current = byScope.get(key) || { minimum: null, maximum: null };
    if (band.minimum_bps !== null) current.minimum = current.minimum === null ? band.minimum_bps : Math.max(current.minimum, band.minimum_bps);
    if (band.maximum_bps !== null) current.maximum = current.maximum === null ? band.maximum_bps : Math.min(current.maximum, band.maximum_bps);
    if (current.minimum !== null && current.maximum !== null && current.minimum > current.maximum) {
      throw new Error(`conflicting_policy_rules:${key}`);
    }
    byScope.set(key, current);
  }
  const byMetric = new Map();
  for (const limit of measurementLimits) {
    const current = byMetric.get(limit.metric) || { minimum: null, maximum: null };
    if (limit.minimum_bps !== null) current.minimum = current.minimum === null ? limit.minimum_bps : Math.max(current.minimum, limit.minimum_bps);
    if (limit.maximum_bps !== null) current.maximum = current.maximum === null ? limit.maximum_bps : Math.min(current.maximum, limit.maximum_bps);
    if (current.minimum !== null && current.maximum !== null && current.minimum > current.maximum) {
      throw new Error(`conflicting_policy_rules:portfolio_measurement:${limit.metric}`);
    }
    byMetric.set(limit.metric, current);
  }
  for (const band of allocationBands.filter((row) => row.minimum_bps !== null)) {
    const conflictingLimit = concentrationLimits.find((limit) => (
      limit.scope_type === band.scope_type
      && (limit.scope_id === "*" || limit.scope_id === band.scope_id)
      && band.minimum_bps > limit.maximum_bps
    ));
    if (conflictingLimit) throw new Error(`conflicting_policy_rules:${band.scope_type}:${band.scope_id}`);
  }
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
  const measurementLimits = (Array.isArray(input.measurement_limits) ? input.measurement_limits : []).map(normalizeMeasurementLimit);
  const bucketAssignments = (Array.isArray(input.capital_bucket_assignments) ? input.capital_bucket_assignments : []).map(normalizeBucketAssignment);
  assertCompatiblePolicyRules(allocationBands, concentrationLimits, measurementLimits);
  for (const band of allocationBands.filter((row) => row.scope_type === "bucket")) {
    if (band.scope_id !== "unclassified" && !bucketIds.has(band.scope_id)) throw new Error("allocation_band_bucket_missing");
  }
  for (const assignment of bucketAssignments) {
    if (!bucketIds.has(assignment.bucket_id)) throw new Error("capital_bucket_assignment_bucket_missing");
  }
  const assignmentSubjects = bucketAssignments.map((row) => `${row.subject_type}:${row.subject_id}`);
  if (new Set(assignmentSubjects).size !== assignmentSubjects.length) throw new Error("duplicate_capital_bucket_assignment_subject");
  if (new Set(bucketAssignments.map((row) => row.assignment_id)).size !== bucketAssignments.length) throw new Error("duplicate_capital_bucket_assignment_id");
  const ruleIds = [...allocationBands, ...concentrationLimits, ...measurementLimits].map((row) => row.rule_id);
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
    capital_bucket_assignments: bucketAssignments,
    concentration_limits: concentrationLimits,
    measurement_limits: measurementLimits,
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

function violationRecord({ policy, snapshot, measurement, rule, scopeId, currentBps, boundaryBps, direction, calculatedAt, evidence = null, explanation = null }) {
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
    outcome_state: "confirmed_violation",
    evidence: evidence && typeof evidence === "object" ? clone(evidence) : null,
    explanation: text(explanation) || null,
    desired_state_source: "user_policy_version",
    provenance: provenance("raven", "deterministic_policy_evaluation", "none"),
  });
}

function indeterminacyRecord({ policy, snapshot, measurement, rule, scopeId, lowerBps, upperBps, calculatedAt, reasonCodes, evidence = null }) {
  const identity = {
    policy_version_id: policy.policy_version_id,
    snapshot_id: snapshot.snapshot_id,
    measurement_id: measurement.measurement_id,
    rule_id: rule.rule_id,
    scope_type: rule.scope_type,
    scope_id: scopeId,
    reason_codes: reasonCodes,
  };
  return seal(PortfolioGovernorSchemas.policy_indeterminacy, "PolicyIndeterminacy", {
    indeterminacy_id: `ind_${canonicalContractHash(identity).slice(0, 24)}`,
    calculated_at: calculatedAt,
    policy_ref: reference(policy),
    snapshot_ref: reference(snapshot),
    measurement_ref: reference(measurement),
    rule_id: rule.rule_id,
    rule_kind: rule.rule_kind,
    scope_type: rule.scope_type,
    scope_id: scopeId,
    possible_minimum_bps: lowerBps,
    possible_maximum_bps: upperBps,
    configured_minimum_bps: rule.minimum_bps ?? null,
    configured_maximum_bps: rule.maximum_bps ?? null,
    reason_codes: uniqueStrings(reasonCodes),
    evidence: evidence && typeof evidence === "object" ? clone(evidence) : null,
    outcome_state: "indeterminate",
    desired_state_source: "user_policy_version",
    provenance: provenance("raven", "deterministic_policy_indeterminacy", "none"),
  });
}

function bucketAssignmentForPosition(policy, position, { allowSnapshotFallback = false } = {}) {
  const priorities = [
    ["position", position.position_id],
    ["account", position.account_ref],
    ["asset", position.asset_id],
    ["protocol", position.protocol_id],
  ];
  for (const [subjectType, subjectId] of priorities) {
    if (!subjectId) continue;
    const assignment = policy.capital_bucket_assignments.find((row) => row.subject_type === subjectType && row.subject_id === subjectId);
    if (assignment) return assignment;
  }
  return allowSnapshotFallback && position.bucket_id ? {
    assignment_id: null,
    subject_type: "snapshot_position",
    subject_id: position.position_id,
    bucket_id: position.bucket_id,
  } : null;
}

function deriveBucketExposure(policy, snapshot, measurement) {
  const netEquity = BigInt(measurement.net_equity_minor || measurement.net_value_minor || "0");
  const denominatorKnown = Number(measurement.unavailable_valuations || 0) === 0 && netEquity > 0n;
  const groups = new Map();
  const classifications = [];
  const protectedPositionIds = [];
  for (const position of snapshot.positions.filter((row) => row.position_state !== "closed" && row.counted_in_nav && !row.representation_only)) {
    const assignment = bucketAssignmentForPosition(policy, position);
    const bucketId = assignment?.bucket_id || "unclassified";
    const bucket = policy.capital_buckets.find((row) => row.bucket_id === bucketId) || null;
    const value = position.position_side === "liability"
      ? (position.liability_value_minor === null ? null : -BigInt(position.liability_value_minor || "0"))
      : position.marked_value_minor === null ? null : BigInt(position.marked_value_minor);
    const current = groups.get(bucketId) || {
      scope_type: "bucket",
      scope_id: bucketId,
      exposure_side: "asset",
      value: 0n,
      asset_value: 0n,
      liability_value: 0n,
      executable: 0n,
      unavailable: 0,
      stale: 0n,
      unrouteable: 0n,
      position_ids: [],
      assignment_ids: [],
    };
    if (value === null) current.unavailable += 1;
    else {
      current.value += value;
      if (position.position_side === "liability") current.liability_value += -value;
      else current.asset_value += value;
      if (["delayed", "stale"].includes(position.marked_value_state)) current.stale += value > 0n ? value : 0n;
      if (position.routeability === "not_routeable" && value > 0n) current.unrouteable += value;
    }
    if (position.executable_value_minor !== null) current.executable += BigInt(position.executable_value_minor);
    current.position_ids.push(position.position_id);
    if (assignment?.assignment_id) current.assignment_ids.push(assignment.assignment_id);
    groups.set(bucketId, current);
    classifications.push({
      position_id: position.position_id,
      bucket_id: bucketId,
      assignment_id: assignment?.assignment_id || null,
      classification_source: assignment ? "user_policy_version" : "unclassified",
      allocation_target_created: false,
    });
    if (policy.protected_asset_ids.includes(position.asset_id) || bucket?.protected_from_sale || bucket?.kind === "cold") {
      protectedPositionIds.push(position.position_id);
    }
  }
  return {
    exposures: [...groups.values()].map((row) => ({
      scope_type: row.scope_type,
      scope_id: row.scope_id,
      exposure_side: row.exposure_side,
      value_minor: row.unavailable ? null : row.value.toString(),
      asset_value_minor: row.unavailable ? null : row.asset_value.toString(),
      liability_value_minor: row.unavailable ? null : row.liability_value.toString(),
      net_value_minor: row.unavailable ? null : row.value.toString(),
      executable_value_minor: row.executable.toString(),
      allocation_bps: denominatorKnown && !row.unavailable ? roundedBps(row.value, netEquity) : null,
      lower_bound_bps: denominatorKnown && !row.unavailable ? roundedBps(row.value, netEquity) : null,
      upper_bound_bps: denominatorKnown && !row.unavailable ? roundedBps(row.value, netEquity) : null,
      unresolved_relevant_value_minor: "0",
      stale_value_minor: row.stale.toString(),
      unrouteable_value_minor: row.unrouteable.toString(),
      position_ids: [...new Set(row.position_ids)].sort(),
      economic_exposure_ids: [],
      assignment_ids: [...new Set(row.assignment_ids)].sort(),
      resolution_states: row.unavailable ? ["unresolved"] : ["derived"],
    })),
    classifications: classifications.sort((left, right) => left.position_id.localeCompare(right.position_id)),
    protected_position_ids: [...new Set(protectedPositionIds)].sort(),
    allocation_targets_created: false,
  };
}

function economicExposureFor(exposures, scopeType, scopeId) {
  return exposures.find((row) => row.scope_type === scopeType && row.scope_id === scopeId) || null;
}

function intervalEvidence(measurement, exposure, extra = {}) {
  return {
    current_value_minor: exposure?.value_minor ?? null,
    unresolved_relevant_value_minor: exposure?.unresolved_relevant_value_minor ?? measurement.unresolved_value_minor ?? "0",
    stale_value_minor: exposure?.stale_value_minor ?? "0",
    unrouteable_value_minor: exposure?.unrouteable_value_minor ?? "0",
    position_ids: exposure?.position_ids || [],
    economic_exposure_ids: exposure?.economic_exposure_ids || [],
    resolution_states: exposure?.resolution_states || [],
    ...extra,
  };
}

function exposureInterval(measurement, exposures, scopeType, scopeId) {
  const exposure = economicExposureFor(exposures, scopeType, scopeId);
  const reasonCodes = [];
  const netEquity = BigInt(measurement.net_equity_minor || measurement.net_value_minor || "0");
  if (netEquity <= 0n) reasonCodes.push("non_positive_net_equity");
  if (Number(measurement.unavailable_valuations || 0) > 0) reasonCodes.push("valuation_unavailable");
  if (BigInt(measurement.stale_value_minor || "0") > 0n) reasonCodes.push("stale_valuation");
  if (reasonCodes.length) return { lower: null, upper: null, reasonCodes, evidence: intervalEvidence(measurement, exposure) };
  if (exposure) {
    const lower = exposure.lower_bound_bps ?? exposure.allocation_bps;
    const upper = exposure.upper_bound_bps ?? exposure.allocation_bps;
    if (upper === null) reasonCodes.push("unresolved_exposure");
    else if (upper > lower) reasonCodes.push("unresolved_exposure");
    return { lower, upper, reasonCodes, evidence: intervalEvidence(measurement, exposure) };
  }
  const canAbsorbUnresolved = ["asset", "protocol", "stablecoin_issuer", "stablecoin_dependency"].includes(scopeType);
  const unresolvedBps = measurement.unresolved_candidate_allocation_bps_by_scope_type?.[scopeType]
    ?? (scopeType === "asset" ? measurement.unresolved_allocation_bps : 0)
    ?? 0;
  if (canAbsorbUnresolved && unresolvedBps > 0) reasonCodes.push("unresolved_exposure");
  return {
    lower: 0,
    upper: canAbsorbUnresolved ? unresolvedBps : 0,
    reasonCodes,
    evidence: intervalEvidence(measurement, null, {
      unresolved_relevant_value_minor: measurement.unresolved_candidate_value_minor_by_scope_type?.[scopeType]
        ?? (scopeType === "asset" ? measurement.unresolved_value_minor : "0")
        ?? "0",
    }),
  };
}

function metricInterval(measurement, metric) {
  const reasonCodes = [];
  const netEquity = BigInt(measurement.net_equity_minor || measurement.net_value_minor || "0");
  if (netEquity <= 0n) reasonCodes.push("non_positive_net_equity");
  const unavailable = Number(measurement.unavailable_valuations || 0) > 0;
  const stale = BigInt(measurement.stale_value_minor || "0") > 0n;
  if (unavailable) reasonCodes.push("valuation_unavailable");
  if (stale) reasonCodes.push("stale_valuation");
  if (reasonCodes.length) return { lower: null, upper: null, reasonCodes, evidence: { metric } };
  if (metric === "unresolved_exposure_bps") {
    const value = measurement.unresolved_allocation_bps;
    return { lower: value, upper: value, reasonCodes, evidence: { metric, unresolved_value_minor: measurement.unresolved_value_minor } };
  }
  if (metric === "unrouteable_exposure_bps") {
    const lower = measurement.unrouteable_allocation_bps;
    const net = BigInt(measurement.net_equity_minor || "0");
    const unknown = BigInt(measurement.unknown_routeability_value_minor || "0");
    const upper = net > 0n ? roundedBps(BigInt(measurement.unrouteable_value_minor || "0") + unknown, net) : null;
    if (unknown > 0n) reasonCodes.push("routeability_unknown");
    return { lower, upper, reasonCodes, evidence: { metric, unrouteable_value_minor: measurement.unrouteable_value_minor, unknown_routeability_value_minor: unknown.toString() } };
  }
  if (metric === "gross_leverage_bps") {
    return { lower: measurement.gross_leverage_bps, upper: measurement.gross_leverage_bps, reasonCodes, evidence: { metric, gross_economic_exposure_minor: measurement.gross_economic_exposure_minor } };
  }
  if (metric === "liability_exposure_bps") {
    return { lower: measurement.liability_exposure_bps, upper: measurement.liability_exposure_bps, reasonCodes, evidence: { metric, total_liability_value_minor: measurement.total_liability_value_minor } };
  }
  if (metric === "executable_coverage_bps") {
    const marked = BigInt(measurement.total_marked_asset_value_minor || "0");
    const executable = BigInt(measurement.total_executable_asset_value_minor || "0");
    const potential = BigInt(measurement.potentially_executable_value_minor || "0");
    if (potential > 0n) reasonCodes.push("routeability_unknown");
    return {
      lower: measurement.executable_coverage_bps,
      upper: marked > 0n ? Math.min(10_000, roundedBps(executable + potential, marked)) : null,
      reasonCodes,
      evidence: { metric, executable_value_minor: executable.toString(), potentially_executable_value_minor: potential.toString() },
    };
  }
  throw new Error("measurement_metric_invalid");
}

function evaluateInterval({ policy, snapshot, measurement, rule, scopeId, interval, calculatedAt }) {
  const minimum = rule.minimum_bps ?? null;
  const maximum = rule.maximum_bps ?? null;
  if (interval.lower === null || interval.upper === null) {
    const indeterminacy = indeterminacyRecord({
      policy,
      snapshot,
      measurement,
      rule,
      scopeId,
      lowerBps: interval.lower,
      upperBps: interval.upper,
      calculatedAt,
      reasonCodes: interval.reasonCodes.length ? interval.reasonCodes : ["measurement_interval_unavailable"],
      evidence: interval.evidence,
    });
    return { state: "indeterminate", indeterminacy };
  }
  if (minimum !== null && interval.upper < minimum) {
    const current = interval.upper;
    return { state: "confirmed_violation", violation: violationRecord({
      policy,
      snapshot,
      measurement,
      rule,
      scopeId,
      currentBps: current,
      boundaryBps: minimum,
      direction: "below_minimum",
      calculatedAt,
      evidence: interval.evidence,
      explanation: "Even the maximum supported exposure is below the user's configured minimum.",
    }) };
  }
  if (maximum !== null && interval.lower > maximum) {
    const current = interval.lower;
    return { state: "confirmed_violation", violation: violationRecord({
      policy,
      snapshot,
      measurement,
      rule,
      scopeId,
      currentBps: current,
      boundaryBps: maximum,
      direction: "above_maximum",
      calculatedAt,
      evidence: interval.evidence,
      explanation: "Resolved measured exposure alone exceeds the user's configured maximum.",
    }) };
  }
  const couldFallBelow = minimum !== null && interval.lower < minimum;
  const couldRiseAbove = maximum !== null && interval.upper > maximum;
  if (couldFallBelow || couldRiseAbove) {
    const indeterminacy = indeterminacyRecord({
      policy,
      snapshot,
      measurement,
      rule,
      scopeId,
      lowerBps: interval.lower,
      upperBps: interval.upper,
      calculatedAt,
      reasonCodes: interval.reasonCodes.length ? interval.reasonCodes : ["measurement_range_crosses_policy_boundary"],
      evidence: interval.evidence,
    });
    return { state: "indeterminate", indeterminacy };
  }
  return { state: "confirmed_compliant" };
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

function policyRuleResult(rule, scopeId, interval, result) {
  return {
    rule_id: rule.rule_id,
    rule_kind: rule.rule_kind,
    scope_type: rule.scope_type,
    scope_id: scopeId,
    configured_minimum_bps: rule.minimum_bps ?? null,
    configured_maximum_bps: rule.maximum_bps ?? null,
    possible_minimum_bps: interval.lower,
    possible_maximum_bps: interval.upper,
    state: result.state,
    reason_codes: uniqueStrings(interval.reasonCodes),
    violation_ref: result.violation ? reference(result.violation) : null,
    indeterminacy_ref: result.indeterminacy ? reference(result.indeterminacy) : null,
    evidence: interval.evidence && typeof interval.evidence === "object" ? clone(interval.evidence) : null,
    desired_state_source: "user_policy_version",
  };
}

function evaluateEconomicPolicy(policy, snapshot, measurement, calculatedAt, evaluationId) {
  const bucketState = deriveBucketExposure(policy, snapshot, measurement);
  const exposures = [...measurement.exposures, ...bucketState.exposures];
  const violations = [];
  const indeterminacies = [];
  const ruleResults = [];
  const evaluate = (rule, scopeId, interval) => {
    const result = evaluateInterval({ policy, snapshot, measurement, rule, scopeId, interval, calculatedAt });
    if (result.violation) violations.push(result.violation);
    if (result.indeterminacy) indeterminacies.push(result.indeterminacy);
    ruleResults.push(policyRuleResult(rule, scopeId, interval, result));
  };

  for (const band of policy.allocation_bands) {
    const rule = { ...band, rule_kind: "allocation_band" };
    evaluate(rule, band.scope_id, exposureInterval(measurement, exposures, band.scope_type, band.scope_id));
  }

  for (const limit of policy.concentration_limits) {
    const rule = {
      ...limit,
      minimum_bps: null,
      rule_kind: "concentration_limit",
    };
    const scopeIds = limit.scope_id === "*"
      ? [...new Set(exposures
          .filter((row) => row.scope_type === limit.scope_type && row.exposure_side !== "liability")
          .map((row) => row.scope_id))].sort()
      : [limit.scope_id];
    const unresolvedBps = measurement.unresolved_candidate_allocation_bps_by_scope_type?.[limit.scope_type]
      ?? (limit.scope_type === "asset" ? measurement.unresolved_allocation_bps : 0)
      ?? 0;
    if (limit.scope_id === "*" && unresolvedBps > 0) scopeIds.push("unresolved_candidate");
    if (!scopeIds.length) scopeIds.push("*");
    for (const scopeId of [...new Set(scopeIds)]) {
      const interval = scopeId === "unresolved_candidate"
        ? {
            lower: 0,
            upper: unresolvedBps,
            reasonCodes: ["unresolved_exposure"],
            evidence: {
              unresolved_value_minor: measurement.unresolved_value_minor,
              unresolved_candidate_scope: limit.scope_type,
              interpretation: "Unresolved value could belong to a currently unidentified concentration scope.",
            },
          }
        : exposureInterval(measurement, exposures, limit.scope_type, scopeId);
      evaluate(rule, scopeId, interval);
    }
  }

  for (const limit of policy.measurement_limits) {
    const rule = {
      ...limit,
      scope_type: "portfolio_measurement",
      scope_id: limit.metric,
      rule_kind: "measurement_limit",
    };
    evaluate(rule, limit.metric, metricInterval(measurement, limit.metric));
  }

  const state = violations.length
    ? "confirmed_violation"
    : indeterminacies.length
      ? "indeterminate"
      : "confirmed_compliant";
  const refs = { policy: reference(policy), snapshot: reference(snapshot), measurement: reference(measurement) };
  const outcome = state === "confirmed_compliant"
    ? createGovernorOutcome({ reason_code: "portfolio_within_policy", occurred_at: calculatedAt, refs })
    : state === "indeterminate"
      ? createGovernorOutcome({
          reason_code: "policy_evaluation_indeterminate",
          occurred_at: calculatedAt,
          refs: { ...refs, indeterminacies: indeterminacies.map(reference) },
          detail: { reason_codes: uniqueStrings(ruleResults.flatMap((row) => row.reason_codes)) },
        })
      : null;
  const evaluation = seal(PortfolioGovernorSchemas.policy_evaluation, "PolicyEvaluation", {
    evaluation_id: evaluationId,
    calculated_at: calculatedAt,
    state,
    evaluation_mode: "read_only_policy_monitor",
    policy_ref: refs.policy,
    snapshot_ref: refs.snapshot,
    measurement_ref: refs.measurement,
    configured_rule_count: policy.allocation_bands.length + policy.concentration_limits.length + policy.measurement_limits.length,
    evaluated_rule_result_count: ruleResults.length,
    confirmed_violation_count: violations.length,
    indeterminate_rule_count: indeterminacies.length,
    rule_results: ruleResults,
    violation_refs: violations.map(reference),
    indeterminacy_refs: indeterminacies.map(reference),
    outcome_ref: outcome ? reference(outcome) : null,
    capital_bucket_classifications: bucketState.classifications,
    protected_position_ids: bucketState.protected_position_ids,
    allocation_targets_created_from_classification: false,
    portfolio_targets_inferred: false,
    correction_calculated: false,
    rebalance_calculation_created: false,
    execution_quote_created: false,
    execution_intent_created: false,
    market_posture_effect: "none",
    provenance: provenance("raven", "deterministic_read_only_policy_evaluation", "none"),
  });
  return { ok: true, evaluation, violations, indeterminacies, outcome };
}

export function evaluatePortfolioPolicy(input = {}) {
  const policy = assertRecord(input.policy_version, "UserPolicyVersion");
  const snapshot = assertRecord(input.snapshot, "PortfolioSnapshot");
  const measurement = assertRecord(input.measurement, "PortfolioMeasurement");
  const calculatedAt = timestamp(input.calculated_at, "calculated_at");
  const evaluationId = requiredText(input.evaluation_id, "evaluation_id");
  if (policy.user_id !== snapshot.user_id || policy.portfolio_id !== snapshot.portfolio_id) throw new Error("policy_portfolio_mismatch");
  if (!sameReference(measurement.snapshot_ref, reference(snapshot))) throw new Error("measurement_snapshot_mismatch");
  if (measurement.accounting_model === "economic_exposure") {
    return evaluateEconomicPolicy(policy, snapshot, measurement, calculatedAt, evaluationId);
  }
  if (measurement.state !== "available" || measurement.exposures.some((row) => row.allocation_bps === null)) {
    const blocked = createGovernorOutcome({
      reason_code: "insufficient_valuation_confidence",
      occurred_at: calculatedAt,
      refs: { policy: reference(policy), snapshot: reference(snapshot), measurement: reference(measurement) },
    });
    const evaluation = seal(PortfolioGovernorSchemas.policy_evaluation, "PolicyEvaluation", {
      evaluation_id: evaluationId,
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
    evaluation_id: evaluationId,
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
  const assignment = bucketAssignmentForPosition(policy, position);
  const assignedBucket = assignment
    ? policy.capital_buckets.find((row) => row.bucket_id === assignment.bucket_id)
    : null;
  if (assignedBucket?.protected_from_sale || assignedBucket?.kind === "cold") return true;
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
  if (!new Set(["deposit", "realized_profit", "realized_loss", "realized_flat", "reward"]).has(eventType)) throw new Error("funding_event_type_invalid");
  const amountMinor = integerString(input.amount_minor ?? input.gross_amount_minor, "amount_minor");
  const grossAmountMinor = integerString(input.gross_amount_minor ?? amountMinor, "gross_amount_minor");
  if (input.amount_minor !== null && input.amount_minor !== undefined && input.gross_amount_minor !== null && input.gross_amount_minor !== undefined && amountMinor !== grossAmountMinor) {
    throw new Error("funding_event_amount_mismatch");
  }
  const feeAmountMinor = integerString(input.fee_amount_minor ?? "0", "fee_amount_minor");
  const frictionAmountMinor = integerString(input.friction_amount_minor ?? "0", "friction_amount_minor");
  const gross = BigInt(grossAmountMinor);
  const costs = BigInt(feeAmountMinor) + BigInt(frictionAmountMinor);
  const distributable = eventType === "realized_profit" && gross > costs ? gross - costs : 0n;
  let capitalClass = "neutral";
  if (eventType === "deposit") capitalClass = "principal";
  else if (eventType === "realized_profit") capitalClass = "realized_profit";
  else if (eventType === "reward") capitalClass = "reward";
  else if (eventType === "realized_loss") capitalClass = "loss";
  return seal(PortfolioGovernorSchemas.funding_event, "FundingEvent", {
    funding_event_id: requiredText(input.funding_event_id, "funding_event_id"),
    portfolio_id: requiredText(input.portfolio_id, "portfolio_id"),
    user_id: requiredText(input.user_id, "user_id"),
    occurred_at: timestamp(input.occurred_at, "occurred_at"),
    event_type: eventType,
    amount_minor: amountMinor,
    gross_amount_minor: grossAmountMinor,
    fee_amount_minor: feeAmountMinor,
    friction_amount_minor: frictionAmountMinor,
    net_distributable_amount_minor: distributable.toString(),
    capital_class: capitalClass,
    principal_included_in_distributable_profit: false,
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
  const distributable = BigInt(funding.net_distributable_amount_minor || "0");
  if (funding.event_type !== "realized_profit" || distributable <= 0n) return refusal("no_distributable_profit", calculatedAt, refs);
  if (!policy.profit_routing.length) return refusal("profit_routing_not_configured", calculatedAt, refs);
  const amount = distributable;
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
    gross_profit_minor: funding.gross_amount_minor,
    fee_amount_minor: funding.fee_amount_minor,
    friction_amount_minor: funding.friction_amount_minor,
    distributable_profit_minor: amount.toString(),
    principal_routed: false,
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
