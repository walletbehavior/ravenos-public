import { createHash } from "node:crypto";

export const CustomerTradeSchemaVersions = Object.freeze({
  freshness_state: "customer_trade_freshness_state.v1",
  provider_component_health: "customer_trade_provider_component_health.v1",
  recovery_epoch: "customer_trade_recovery_epoch.v1",
  data_provenance: "customer_trade_data_provenance.v1",
  evidence_envelope: "customer_trade_evidence_envelope.v1",
  wallet_capability_snapshot: "customer_trade_wallet_capability_snapshot.v1",
  quote_request: "customer_trade_quote_request.v1",
  quote_route_leg: "customer_trade_quote_route_leg.v1",
  quote_candidate: "customer_trade_quote_candidate.v1",
  quote_response: "customer_trade_quote_response.v1",
  transaction_inspection: "customer_trade_transaction_inspection.v1",
  execution_cost_preview: "customer_trade_execution_cost_preview.v1",
  terminal_review_packet: "customer_trade_terminal_review_packet.v1",
  public_terminal_error: "customer_trade_public_terminal_error.v1",
  terminal_health_snapshot: "customer_trade_terminal_health_snapshot.v1",
  terminal_market_context: "customer_trade_terminal_market_context.v1",
});

export const FreshnessStates = Object.freeze([
  "fresh",
  "recovering",
  "backfilling",
  "degraded",
  "stale",
  "unavailable",
  "unknown",
]);

export const ProviderComponents = Object.freeze([
  "market_chart_data",
  "quote_provider",
  "transaction_construction",
  "transaction_simulation",
  "ethereum_rpc",
  "base_rpc",
  "solana_rpc",
  "wallet_capability_detection",
  "evidence_persistence",
  "historical_backfill",
  "jupiter_token_discovery",
  "jupiter_direct_quote",
  "helius_current_reads",
  "helius_historical_backfill",
  "atlas_macro_context",
  "perp_market_context",
]);

export const TerminalChains = Object.freeze(["solana", "base", "ethereum"]);
export const WalletCapabilityStates = Object.freeze([
  "not_detected",
  "detected_not_connected",
  "connection_available",
  "connected_read_only",
  "unsupported_chain",
  "unsupported_transaction_version",
  "capability_unknown",
  "temporarily_unavailable",
]);

const DEFAULT_VOLATILE_KEYS = new Set([
  "request_id",
  "rendered_at",
  "ui_label",
  "ui_state",
  "animation_state",
  "localized_label",
  "localized_value",
  "display_label",
]);

const SECRET_KEY_RE = /(secret|api[_-]?key|authorization|cookie|private[_-]?key|stamper|token_header|bearer|credential)/i;

function assertFiniteNumber(value, fieldName) {
  if (typeof value !== "number" || !Number.isFinite(value) || Object.is(value, -0)) {
    throw new Error(`invalid_number:${fieldName}`);
  }
  return value;
}

function normalizeIntegerNumberString(text, fieldName) {
  const value = String(text ?? "").trim();
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`invalid_base_units:${fieldName}`);
  return value;
}

export function normalizeBaseUnits(value, fieldName = "amount") {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`invalid_base_units:${fieldName}`);
    return String(value);
  }
  return normalizeIntegerNumberString(value, fieldName);
}

export function normalizeDisplayAmount(value, fieldName = "display_amount") {
  const text = String(value ?? "").trim();
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(text)) throw new Error(`invalid_display_amount:${fieldName}`);
  return text;
}

export function normalizeTimestamp(value, fieldName = "timestamp", { allowNull = false } = {}) {
  if ((value === null || value === undefined || value === "") && allowNull) return null;
  const text = String(value ?? "").trim();
  const parsed = Date.parse(text);
  if (!text || Number.isNaN(parsed)) throw new Error(`invalid_timestamp:${fieldName}`);
  return new Date(parsed).toISOString();
}

export function normalizeOptionalTimestamp(value, fieldName = "timestamp") {
  return normalizeTimestamp(value, fieldName, { allowNull: true });
}

export function normalizeFreshnessState(value, fieldName = "freshness_state") {
  const state = String(value || "unknown").toLowerCase();
  if (!FreshnessStates.includes(state)) throw new Error(`invalid_freshness_state:${fieldName}`);
  return state;
}

export function normalizeChain(value, fieldName = "chain", { allowNull = false } = {}) {
  if ((value === null || value === undefined || value === "") && allowNull) return null;
  const chain = String(value || "").toLowerCase();
  if (!TerminalChains.includes(chain)) throw new Error(`invalid_chain:${fieldName}`);
  return chain;
}

export function normalizeProviderComponent(value, fieldName = "component") {
  const component = String(value || "");
  if (!ProviderComponents.includes(component)) throw new Error(`invalid_provider_component:${fieldName}`);
  return component;
}

export function normalizeStringList(values) {
  return Array.isArray(values) ? values.map((value) => String(value)) : [];
}

export function assertNoSecretBearingFields(value, path = "") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretBearingFields(entry, `${path}[${index}]`));
    return true;
  }
  if (!value || typeof value !== "object") return true;
  for (const [key, entry] of Object.entries(value)) {
    const next = path ? `${path}.${key}` : key;
    if (SECRET_KEY_RE.test(key)) throw new Error(`secret_bearing_field:${next}`);
    assertNoSecretBearingFields(entry, next);
  }
  return true;
}

export function canonicalContractValue(value, { volatileKeys = DEFAULT_VOLATILE_KEYS } = {}) {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map((entry) => canonicalContractValue(entry, { volatileKeys }));
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return assertFiniteNumber(value, "canonical_number");
  if (typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (volatileKeys.has(key)) continue;
    const next = value[key];
    if (next === undefined) continue;
    out[key] = canonicalContractValue(next, { volatileKeys });
  }
  return out;
}

export function canonicalContractJson(value, options = {}) {
  return JSON.stringify(canonicalContractValue(value, options));
}

export function canonicalContractHashInput(value, options = {}) {
  return canonicalContractJson(value, options);
}

export function canonicalContractHash(value, options = {}) {
  return createHash("sha256").update(canonicalContractHashInput(value, options)).digest("hex");
}

export function createRecoveryEpoch(input = {}) {
  return {
    schema_version: CustomerTradeSchemaVersions.recovery_epoch,
    component: normalizeProviderComponent(input.component || "quote_provider"),
    outage_detected_at: normalizeOptionalTimestamp(input.outage_detected_at, "outage_detected_at"),
    first_recovery_success_at: normalizeOptionalTimestamp(input.first_recovery_success_at, "first_recovery_success_at"),
    most_recent_success_at: normalizeOptionalTimestamp(input.most_recent_success_at, "most_recent_success_at"),
    required_success_count: Number.isSafeInteger(input.required_success_count) ? input.required_success_count : 3,
    current_success_count: Number.isSafeInteger(input.current_success_count) ? input.current_success_count : 0,
    grace_period_seconds: Number.isFinite(Number(input.grace_period_seconds)) ? Number(input.grace_period_seconds) : 0,
    recovery_reason: String(input.recovery_reason || ""),
    live_tail_established: Boolean(input.live_tail_established),
    historical_backfill_complete: Boolean(input.historical_backfill_complete),
    negative_evidence_suppressed_until: normalizeOptionalTimestamp(input.negative_evidence_suppressed_until, "negative_evidence_suppressed_until"),
  };
}

export function createProviderComponentHealth(input = {}) {
  const state = normalizeFreshnessState(input.state || "unknown");
  return {
    schema_version: CustomerTradeSchemaVersions.provider_component_health,
    component: normalizeProviderComponent(input.component || "quote_provider"),
    state,
    last_attempt_at: normalizeOptionalTimestamp(input.last_attempt_at, "last_attempt_at"),
    last_success_at: normalizeOptionalTimestamp(input.last_success_at, "last_success_at"),
    last_failure_at: normalizeOptionalTimestamp(input.last_failure_at, "last_failure_at"),
    consecutive_successes: Number.isSafeInteger(input.consecutive_successes) ? input.consecutive_successes : 0,
    consecutive_failures: Number.isSafeInteger(input.consecutive_failures) ? input.consecutive_failures : 0,
    current_latency_ms: Number.isFinite(Number(input.current_latency_ms)) ? Number(input.current_latency_ms) : null,
    recent_latency_p95_ms: Number.isFinite(Number(input.recent_latency_p95_ms)) ? Number(input.recent_latency_p95_ms) : null,
    observation_age_seconds: Number.isFinite(Number(input.observation_age_seconds)) ? Number(input.observation_age_seconds) : null,
    source: String(input.source || ""),
    error_category: input.error_category ? String(input.error_category) : null,
    recovery_epoch: input.recovery_epoch ? createRecoveryEpoch(input.recovery_epoch) : null,
    backlog_amount: Number.isFinite(Number(input.backlog_amount)) ? Number(input.backlog_amount) : null,
    backlog_oldest_age_seconds: Number.isFinite(Number(input.backlog_oldest_age_seconds)) ? Number(input.backlog_oldest_age_seconds) : null,
    current_tail_lag_seconds: Number.isFinite(Number(input.current_tail_lag_seconds)) ? Number(input.current_tail_lag_seconds) : null,
    cached_data_usable: Boolean(input.cached_data_usable),
    cached_data_directional_only: Boolean(input.cached_data_directional_only),
    quote_review_blocking: Boolean(input.quote_review_blocking),
    informational_only: Boolean(input.informational_only),
    degraded_reason: input.degraded_reason ? String(input.degraded_reason) : null,
    warnings: normalizeStringList(input.warnings),
  };
}

export function assertProviderHealthTransition(previous = {}, next = {}, context = {}) {
  const previousState = normalizeFreshnessState(previous.state || "unknown");
  const nextState = normalizeFreshnessState(next.state || "unknown");
  const newSuccessObserved = Boolean(context.new_success_observed);
  const cachedOnly = Boolean(context.cached_only);
  if (nextState === "fresh" && (previousState === "stale" || previousState === "unavailable") && (!newSuccessObserved || cachedOnly)) {
    throw new Error("invalid_freshness_transition:new_success_required");
  }
  if (previousState === "recovering" && nextState === "fresh") {
    const required = Number.isSafeInteger(next.recovery_epoch?.required_success_count) ? next.recovery_epoch.required_success_count : 0;
    const current = Number.isSafeInteger(next.recovery_epoch?.current_success_count) ? next.recovery_epoch.current_success_count : 0;
    if (required > 0 && current < required) throw new Error("invalid_freshness_transition:recovery_not_complete");
  }
  return true;
}

export function createDataProvenance(input = {}) {
  const payload = {
    schema_version: CustomerTradeSchemaVersions.data_provenance,
    request_id: String(input.request_id || ""),
    build_id: String(input.build_id || ""),
    source: String(input.source || ""),
    source_component: String(input.source_component || ""),
    chain: normalizeChain(input.chain || "solana"),
    observed_at: normalizeOptionalTimestamp(input.observed_at, "observed_at"),
    received_at: normalizeOptionalTimestamp(input.received_at, "received_at"),
    expires_at: normalizeOptionalTimestamp(input.expires_at, "expires_at"),
    freshness_state: normalizeFreshnessState(input.freshness_state || "unknown"),
    age_seconds: Number.isFinite(Number(input.age_seconds)) ? Number(input.age_seconds) : null,
    recovery_epoch: input.recovery_epoch ? createRecoveryEpoch(input.recovery_epoch) : null,
    degraded_reason: input.degraded_reason ? String(input.degraded_reason) : null,
    warnings: normalizeStringList(input.warnings),
  };
  assertNoSecretBearingFields(payload);
  return payload;
}

export function createEvidenceEnvelope(input = {}) {
  assertNoSecretBearingFields(input.payload ?? null);
  const envelope = {
    schema_version: CustomerTradeSchemaVersions.evidence_envelope,
    request_id: String(input.request_id || ""),
    build_id: String(input.build_id || ""),
    source: String(input.source || ""),
    source_component: String(input.source_component || ""),
    chain: normalizeChain(input.chain || "solana"),
    observed_at: normalizeOptionalTimestamp(input.observed_at, "observed_at"),
    received_at: normalizeOptionalTimestamp(input.received_at, "received_at"),
    expires_at: normalizeOptionalTimestamp(input.expires_at, "expires_at"),
    freshness_state: normalizeFreshnessState(input.freshness_state || "unknown"),
    age_seconds: Number.isFinite(Number(input.age_seconds)) ? Number(input.age_seconds) : null,
    recovery_epoch: input.recovery_epoch ? createRecoveryEpoch(input.recovery_epoch) : null,
    degraded_reason: input.degraded_reason ? String(input.degraded_reason) : null,
    warnings: normalizeStringList(input.warnings),
    payload: input.payload ?? null,
  };
  return envelope;
}

export function createWalletCapabilitySnapshot(input = {}) {
  const state = String(input.state || "capability_unknown");
  if (!WalletCapabilityStates.includes(state)) throw new Error("invalid_wallet_capability_state");
  const publicAddress = input.public_address ? String(input.public_address) : null;
  return {
    schema_version: CustomerTradeSchemaVersions.wallet_capability_snapshot,
    state,
    wallet_family: input.wallet_family ? String(input.wallet_family) : null,
    wallet_adapter_version: input.wallet_adapter_version ? String(input.wallet_adapter_version) : null,
    supported_chain: normalizeChain(input.supported_chain || "solana"),
    supported_transaction_versions: Array.isArray(input.supported_transaction_versions) ? input.supported_transaction_versions.map((value) => String(value)) : [],
    address_lookup_table_support: Boolean(input.address_lookup_table_support),
    message_signing_available: Boolean(input.message_signing_available),
    transaction_signing_available: Boolean(input.transaction_signing_available),
    connection_state: String(input.connection_state || "disconnected"),
    public_address: publicAddress,
    observation_timestamp: normalizeOptionalTimestamp(input.observation_timestamp, "observation_timestamp"),
    freshness_state: normalizeFreshnessState(input.freshness_state || "unknown"),
    warnings: normalizeStringList(input.warnings),
  };
}

function normalizeAssetDescriptor(input = {}, fieldName = "asset") {
  return {
    chain: normalizeChain(input.chain || "solana", `${fieldName}.chain`),
    symbol: String(input.symbol || "").toUpperCase(),
    address: String(input.address || input.mint || ""),
    decimals: Number.isSafeInteger(input.decimals) ? input.decimals : Number.parseInt(String(input.decimals ?? "0"), 10),
  };
}

export function createQuoteRequest(input = {}) {
  return {
    schema_version: CustomerTradeSchemaVersions.quote_request,
    client_request_id: String(input.client_request_id || ""),
    chain: normalizeChain(input.chain || "solana"),
    input_asset: normalizeAssetDescriptor(input.input_asset || {}, "input_asset"),
    output_asset: normalizeAssetDescriptor(input.output_asset || {}, "output_asset"),
    exact_input_amount_base_units: normalizeBaseUnits(input.exact_input_amount_base_units ?? input.input_amount_base_units ?? input.amount_base_units ?? "0", "exact_input_amount_base_units"),
    display_amount: normalizeDisplayAmount(input.display_amount ?? "0", "display_amount"),
    asset_decimals: Number.isSafeInteger(input.asset_decimals) ? input.asset_decimals : Number.parseInt(String(input.asset_decimals ?? 0), 10),
    slippage_bps: Number.isSafeInteger(input.slippage_bps) ? input.slippage_bps : Number.parseInt(String(input.slippage_bps ?? 50), 10),
    wallet_capability_context: input.wallet_capability_context ? createWalletCapabilitySnapshot(input.wallet_capability_context) : null,
    route_constraints: input.route_constraints && typeof input.route_constraints === "object" ? input.route_constraints : null,
  };
}

export function createQuoteRouteLeg(input = {}) {
  return {
    schema_version: CustomerTradeSchemaVersions.quote_route_leg,
    leg_index: Number.isSafeInteger(input.leg_index) ? input.leg_index : 0,
    input_asset: normalizeAssetDescriptor(input.input_asset || {}, "route_leg.input_asset"),
    output_asset: normalizeAssetDescriptor(input.output_asset || {}, "route_leg.output_asset"),
    venue: String(input.venue || input.program || "unknown"),
    proportion_bps: Number.isSafeInteger(input.proportion_bps) ? input.proportion_bps : null,
    input_amount_base_units: input.input_amount_base_units == null ? null : normalizeBaseUnits(input.input_amount_base_units, "route_leg.input_amount_base_units"),
    expected_output_base_units: input.expected_output_base_units == null ? null : normalizeBaseUnits(input.expected_output_base_units, "route_leg.expected_output_base_units"),
    fee_amount_base_units: input.fee_amount_base_units == null ? null : normalizeBaseUnits(input.fee_amount_base_units, "route_leg.fee_amount_base_units"),
    fee_asset: input.fee_asset ? String(input.fee_asset) : null,
    venue_known: input.venue_known !== false,
  };
}

export function createQuoteCandidate(input = {}) {
  return {
    schema_version: CustomerTradeSchemaVersions.quote_candidate,
    candidate_id: String(input.candidate_id || ""),
    provider: String(input.provider || ""),
    route_legs: Array.isArray(input.route_legs) ? input.route_legs.map((leg) => createQuoteRouteLeg(leg)) : [],
    route_complexity: Number.isSafeInteger(input.route_complexity) ? input.route_complexity : 0,
    expected_output_base_units: normalizeBaseUnits(input.expected_output_base_units ?? "0", "expected_output_base_units"),
    minimum_output_base_units: normalizeBaseUnits(input.minimum_output_base_units ?? "0", "minimum_output_base_units"),
    price_impact_bps: Number.isFinite(Number(input.price_impact_bps)) ? Number(input.price_impact_bps) : 0,
    warnings: normalizeStringList(input.warnings),
  };
}

export function createExecutionCostPreview(input = {}) {
  return {
    schema_version: CustomerTradeSchemaVersions.execution_cost_preview,
    provider_fee: input.provider_fee ?? null,
    protocol_fee: input.protocol_fee ?? null,
    estimated_network_fee: input.estimated_network_fee ?? null,
    estimated_priority_fee: input.estimated_priority_fee ?? null,
    estimated_slippage: input.estimated_slippage ?? null,
    price_impact_bps: Number.isFinite(Number(input.price_impact_bps)) ? Number(input.price_impact_bps) : 0,
    unknown_cost_fields: normalizeStringList(input.unknown_cost_fields),
    gross_expected_output_base_units: normalizeBaseUnits(input.gross_expected_output_base_units ?? "0", "gross_expected_output_base_units"),
    minimum_expected_output_base_units: normalizeBaseUnits(input.minimum_expected_output_base_units ?? "0", "minimum_expected_output_base_units"),
    estimated_net_output_base_units: normalizeBaseUnits(input.estimated_net_output_base_units ?? "0", "estimated_net_output_base_units"),
  };
}

export function createQuoteResponse(input = {}) {
  const routeLegs = Array.isArray(input.route_legs || input.route)
    ? (input.route_legs || input.route).map((leg, index) => createQuoteRouteLeg({
        leg_index: leg.leg_index ?? index,
        input_asset: leg.input_asset || { chain: input.chain || "solana", symbol: leg.input_symbol || leg.input_mint || "UNKNOWN", address: leg.input_mint || leg.input_address || "", decimals: leg.input_decimals ?? 0 },
        output_asset: leg.output_asset || { chain: input.chain || "solana", symbol: leg.output_symbol || leg.output_mint || "UNKNOWN", address: leg.output_mint || leg.output_address || "", decimals: leg.output_decimals ?? 0 },
        venue: leg.venue || leg.label || leg.program || "unknown",
        proportion_bps: leg.proportion_bps ?? (Number.isFinite(Number(leg.percent)) ? Math.round(Number(leg.percent) * 100) : null),
        input_amount_base_units: leg.input_amount_base_units ?? null,
        expected_output_base_units: leg.expected_output_base_units ?? null,
        fee_amount_base_units: leg.fee_amount_base_units ?? null,
        fee_asset: leg.fee_asset ?? null,
        venue_known: leg.venue_known ?? true,
      }))
    : [];
  const costs = createExecutionCostPreview(input.execution_cost_preview || {
    provider_fee: input.provider_fee ?? null,
    protocol_fee: input.protocol_fee ?? null,
    estimated_network_fee: input.estimated_network_fee ?? input.network_fee_estimate ?? null,
    estimated_priority_fee: input.estimated_priority_fee ?? null,
    estimated_slippage: input.estimated_slippage ?? null,
    price_impact_bps: input.price_impact_bps ?? input.price_impact_pct ?? 0,
    unknown_cost_fields: input.unknown_cost_fields ?? [],
    gross_expected_output_base_units: input.expected_output_amount_base_units ?? input.expected_output ?? "0",
    minimum_expected_output_base_units: input.minimum_output_amount_base_units ?? input.minimum_received ?? "0",
    estimated_net_output_base_units: input.estimated_net_output_base_units ?? input.minimum_received ?? "0",
  });
  return {
    schema_version: CustomerTradeSchemaVersions.quote_response,
    quote_id: String(input.quote_id || ""),
    canonical_quote_id: String(input.canonical_quote_id || input.quote_id || ""),
    quote_timestamp: normalizeTimestamp(input.quote_timestamp || input.quoted_at || new Date().toISOString(), "quote_timestamp"),
    quote_expiry: normalizeOptionalTimestamp(input.quote_expiry || input.quote_expires_at, "quote_expiry"),
    chain: normalizeChain(input.chain || "solana"),
    input_amount_base_units: normalizeBaseUnits(input.input_amount_base_units ?? input.input_amount ?? "0", "input_amount_base_units"),
    expected_output_amount_base_units: normalizeBaseUnits(input.expected_output_amount_base_units ?? input.expected_output ?? "0", "expected_output_amount_base_units"),
    minimum_output_amount_base_units: normalizeBaseUnits(input.minimum_output_amount_base_units ?? input.minimum_received ?? "0", "minimum_output_amount_base_units"),
    effective_price: input.effective_price == null ? null : String(input.effective_price),
    price_impact_bps: Number.isFinite(Number(input.price_impact_bps)) ? Number(input.price_impact_bps) : Number(input.price_impact_pct || 0),
    provider_fees: input.provider_fees ?? input.provider_fee ?? null,
    estimated_network_cost: input.estimated_network_cost ?? input.network_fee_estimate ?? null,
    estimated_priority_fee: input.estimated_priority_fee ?? null,
    route_legs: routeLegs,
    route_complexity: Number.isSafeInteger(input.route_complexity) ? input.route_complexity : routeLegs.length,
    provider_request_identifier: input.provider_request_identifier ? String(input.provider_request_identifier) : null,
    provider_provenance: input.provider_provenance ? createDataProvenance(input.provider_provenance) : null,
    freshness_metadata: input.freshness_metadata ? createDataProvenance(input.freshness_metadata) : null,
    warnings: normalizeStringList(input.warnings),
    transaction_material_available: Boolean(input.transaction_material_available),
    inspection_state: String(input.inspection_state || "not_requested"),
    review_blocked_state: Boolean(input.review_blocked_state),
    blocked_reasons: normalizeStringList(input.blocked_reasons),
    execution_cost_preview: costs,

    provider: String(input.provider || input.provider_name || ""),
    input_amount: normalizeBaseUnits(input.input_amount_base_units ?? input.input_amount ?? "0", "input_amount"),
    expected_output: normalizeBaseUnits(input.expected_output_amount_base_units ?? input.expected_output ?? "0", "expected_output"),
    minimum_received: normalizeBaseUnits(input.minimum_output_amount_base_units ?? input.minimum_received ?? "0", "minimum_received"),
    price_impact_pct: Number.isFinite(Number(input.price_impact_pct)) ? Number(input.price_impact_pct) : Number(input.price_impact_bps || 0),
    provider_fee: input.provider_fee ?? null,
    raven_fee: input.raven_fee ?? null,
    network_fee_estimate: input.network_fee_estimate ?? input.estimated_network_cost ?? null,
    route: routeLegs,
    liquidity_available: input.liquidity_available !== false,
    source_timestamp: normalizeTimestamp(input.source_timestamp || input.quote_timestamp || new Date().toISOString(), "source_timestamp"),
    status: String(input.status || "ready"),
  };
}

export function createTransactionInspection(input = {}) {
  const payload = {
    schema_version: CustomerTradeSchemaVersions.transaction_inspection,
    chain: normalizeChain(input.chain || "solana"),
    transaction_format: String(input.transaction_format || "unknown"),
    transaction_hash_or_preview_hash: input.transaction_hash_or_preview_hash ? String(input.transaction_hash_or_preview_hash) : null,
    decoded_programs: normalizeStringList(input.decoded_programs || input.program_addresses),
    decoded_instructions: Array.isArray(input.decoded_instructions || input.instructions) ? (input.decoded_instructions || input.instructions) : [],
    input_asset_delta: input.input_asset_delta ?? null,
    output_asset_delta: input.output_asset_delta ?? null,
    fee_payer_effects: input.fee_payer_effects ?? null,
    token_approvals: Array.isArray(input.token_approvals) ? input.token_approvals : [],
    writable_accounts: Array.isArray(input.writable_accounts) ? input.writable_accounts : [],
    signer_requirements: Array.isArray(input.signer_requirements) ? input.signer_requirements : [],
    compute_budget_or_gas_estimate: input.compute_budget_or_gas_estimate ?? null,
    priority_fee_or_max_fee: input.priority_fee_or_max_fee ?? null,
    slippage_constraints: input.slippage_constraints ?? null,
    address_lookup_tables: Array.isArray(input.address_lookup_tables) ? input.address_lookup_tables : [],
    unknown_instructions: Array.isArray(input.unknown_instructions) ? input.unknown_instructions : [],
    warnings: normalizeStringList(input.warnings),
    simulation_state: String(input.simulation_state || "not_requested"),
    simulation_source: input.simulation_source ? String(input.simulation_source) : null,
    quote_to_transaction_consistency_result: String(input.quote_to_transaction_consistency_result || "unknown"),
  };
  assertNoSecretBearingFields(payload);
  return payload;
}

export function createTerminalReviewPacket(input = {}) {
  const packet = {
    schema_version: CustomerTradeSchemaVersions.terminal_review_packet,
    build_id: String(input.build_id || ""),
    created_at: normalizeTimestamp(input.created_at || new Date().toISOString(), "created_at"),
    market_context_reference: input.market_context_reference ?? null,
    quote: input.quote ? createQuoteResponse(input.quote) : null,
    quote_expiry: normalizeOptionalTimestamp(input.quote_expiry || input.quote?.quote_expiry, "quote_expiry"),
    route: Array.isArray(input.route) ? input.route.map((leg) => createQuoteRouteLeg(leg)) : [],
    execution_cost_preview: input.execution_cost_preview ? createExecutionCostPreview(input.execution_cost_preview) : null,
    provider_provenance: input.provider_provenance ? createDataProvenance(input.provider_provenance) : null,
    provider_freshness: input.provider_freshness ? createDataProvenance(input.provider_freshness) : null,
    wallet_capability_snapshot: input.wallet_capability_snapshot ? createWalletCapabilitySnapshot(input.wallet_capability_snapshot) : null,
    transaction_inspection: input.transaction_inspection ? createTransactionInspection(input.transaction_inspection) : null,
    simulation_state: input.simulation_state ? String(input.simulation_state) : null,
    warnings: normalizeStringList(input.warnings),
    blocking_reasons: normalizeStringList(input.blocking_reasons),
    quote_only: input.quote_only !== false,
    signing_disabled: input.signing_disabled !== false,
    submission_disabled: input.submission_disabled !== false,
  };
  packet.evidence_hash = canonicalContractHash({
    ...packet,
    evidence_hash: undefined,
  });
  return packet;
}

export function createPublicTerminalError(input = {}) {
  const payload = {
    schema_version: CustomerTradeSchemaVersions.public_terminal_error,
    code: String(input.code || "terminal_error"),
    message: String(input.message || "Request unavailable."),
    component: input.component ? String(input.component) : null,
    retryable: Boolean(input.retryable),
    quote_blocking: Boolean(input.quote_blocking),
    details: input.details && typeof input.details === "object" ? input.details : null,
  };
  assertNoSecretBearingFields(payload);
  return payload;
}

export function createTerminalMarketContext(input = {}) {
  const payload = {
    schema_version: CustomerTradeSchemaVersions.terminal_market_context,
    chain: normalizeChain(input.chain || "solana"),
    market: String(input.market || ""),
    asset: input.asset ? String(input.asset) : null,
    source: String(input.source || ""),
    observed_at: normalizeOptionalTimestamp(input.observed_at, "observed_at"),
    freshness_state: normalizeFreshnessState(input.freshness_state || "unknown"),
    age_seconds: Number.isFinite(Number(input.age_seconds)) ? Number(input.age_seconds) : null,
    warnings: normalizeStringList(input.warnings),
  };
  assertNoSecretBearingFields(payload);
  return payload;
}

function createPublicTerminalHealthComponent(input = {}) {
  const state = normalizeFreshnessState(input.state || "unknown");
  return {
    component: normalizeProviderComponent(input.component || "quote_provider"),
    state,
    last_success_at: normalizeOptionalTimestamp(input.last_success_at, "last_success_at"),
    observation_age_seconds: Number.isFinite(Number(input.observation_age_seconds)) ? Number(input.observation_age_seconds) : null,
    quote_review_blocking: Boolean(input.quote_review_blocking),
    informational_only: Boolean(input.informational_only),
    degraded_reason: input.degraded_reason ? String(input.degraded_reason) : null,
    warnings: normalizeStringList(input.warnings),
  };
}

export function createTerminalHealthSnapshot(input = {}) {
  const components = Array.isArray(input.components) ? input.components.map((component) => createPublicTerminalHealthComponent(component)) : [];
  const payload = {
    schema_version: CustomerTradeSchemaVersions.terminal_health_snapshot,
    generated_at: normalizeTimestamp(input.generated_at || new Date().toISOString(), "generated_at"),
    build_id: String(input.build_id || ""),
    terminal_availability: normalizeFreshnessState(input.terminal_availability || "unknown", "terminal_availability"),
    market_data_availability: normalizeFreshnessState(input.market_data_availability || "unknown", "market_data_availability"),
    quote_availability: normalizeFreshnessState(input.quote_availability || "unknown", "quote_availability"),
    review_availability: normalizeFreshnessState(input.review_availability || "unknown", "review_availability"),
    current_chain: normalizeChain(input.current_chain || "solana"),
    public_warnings: normalizeStringList(input.public_warnings),
    degraded_reasons: normalizeStringList(input.degraded_reasons),
    recovery_state: normalizeStringList(input.recovery_state),
    components,
  };
  assertNoSecretBearingFields(payload);
  return payload;
}
