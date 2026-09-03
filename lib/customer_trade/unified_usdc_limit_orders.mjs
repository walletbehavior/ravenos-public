import { createCapitalReservationBook } from "../agentic_trading/capital_reservations.mjs";
import { atomicToDecimal, decimalToAtomic, normalizeAtomic } from "../agentic_trading/decimal.mjs";
import { agenticContractHash } from "../agentic_trading/hashing.mjs";
import { normalizeAssetIdentity, normalizeChainIdentity } from "../agentic_trading/identity.mjs";
import { CanonicalUsdcRegistry } from "./universal_shadow_execution.mjs";

export const UNIFIED_USDC_LIMIT_ORDER_SCHEMA = "ravenos.unified_usdc_limit_order.v1";
export const UNIFIED_USDC_LIMIT_QUOTE_SCHEMA = "ravenos.unified_usdc_limit_quote.v1";
export const UNIFIED_USDC_LIMIT_EVALUATION_SCHEMA = "ravenos.unified_usdc_limit_evaluation.v1";
export const UNIFIED_USDC_LIMIT_ARRIVAL_DECISION_SCHEMA = "ravenos.unified_usdc_limit_arrival_decision.v1";
export const UNIFIED_USDC_LIMIT_JOURNAL_SCHEMA = "ravenos.unified_usdc_limit_journal.v1";

export const UnifiedUsdcLimitStates = Object.freeze([
  "armed",
  "watching",
  "indeterminate",
  "funding_not_ready",
  "funding_approval_required",
  "funding_pending",
  "destination_funds_ready_limit_not_met",
  "execution_review_required",
  "partially_filled",
  "filled",
  "reconciliation_required",
  "failed",
  "cancelled",
  "expired",
]);

export const UNIFIED_USDC_LIMIT_EXECUTION_BOUNDARY = Object.freeze({
  live_automatic_execution: false,
  autonomous_bridging: false,
  server_signing: false,
  server_broadcasting: false,
  automatic_retry: false,
  automatic_unwind: false,
  wallet_or_session_authorization_required: true,
  capital_transfer_requires_manual_approval: true,
});

export const UnifiedUsdcLimitLimits = Object.freeze({
  maximum_allowed_funding_chains: 16,
  maximum_quote_candidates_per_evaluation: 32,
  maximum_balance_rows_per_evaluation: 128,
  maximum_bridge_trust_dependencies: 16,
  maximum_journal_orders: 500,
  maximum_journal_events_per_order: 10_000,
});

const COST_COMPONENTS = Object.freeze([
  "network",
  "bridge",
  "dex",
  "solver",
  "provider",
  "gas",
  "raven",
  "token_tax",
  "fee_collection",
]);
const BUY_COST_TREATMENTS = new Set(["added_to_input", "embedded_in_output", "not_applicable", "unknown"]);
const SELL_COST_TREATMENTS = new Set(["deducted_from_output", "embedded_in_output", "not_applicable", "unknown"]);
const GAS_STATES = new Set(["available", "sponsored", "not_required", "unavailable", "unknown"]);
const ROUTE_STATES = new Set(["executable", "stale", "unavailable", "restricted", "unsafe", "indeterminate"]);
const PROVIDER_HEALTH_STATES = new Set(["healthy", "degraded", "unavailable", "unknown"]);
const BRIDGE_STATES = new Set(["verified_quote", "not_required", "unavailable", "unknown"]);
const EXIT_PROOF_STATES = new Set(["verified", "stale", "unavailable", "indeterminate", "unknown"]);
const TERMINAL_STATES = new Set(["filled", "failed", "cancelled", "expired"]);
const SECRET_FIELD_RE = /(?:^|_)(?:private_?key|secret|seed|mnemonic|credential|api_?key|signed_?payload)(?:$|_)/i;
const PRICE_SCALE_DECIMALS = 18;
const USDC_DECIMALS = 6;
const USDC_TO_PRICE_SCALE = 10n ** BigInt(PRICE_SCALE_DECIMALS - USDC_DECIMALS);

const CHAIN_TO_USDC_REGISTRY = Object.freeze({
  "solana:mainnet-beta": "solana",
  "eip155:1": "ethereum",
  "eip155:8453": "base",
  "eip155:42161": "arbitrum",
  "eip155:43114": "avalanche",
  "eip155:10": "optimism",
  "eip155:137": "polygon",
});

const STATE_TRANSITIONS = Object.freeze({
  armed: new Set(["watching", "indeterminate", "funding_not_ready", "funding_approval_required", "execution_review_required", "cancelled", "expired"]),
  watching: new Set(["watching", "indeterminate", "funding_not_ready", "funding_approval_required", "execution_review_required", "cancelled", "expired"]),
  indeterminate: new Set(["watching", "indeterminate", "funding_not_ready", "funding_approval_required", "execution_review_required", "cancelled", "expired"]),
  funding_not_ready: new Set(["watching", "indeterminate", "funding_not_ready", "funding_approval_required", "execution_review_required", "cancelled", "expired"]),
  funding_approval_required: new Set(["funding_pending", "indeterminate", "cancelled", "expired"]),
  funding_pending: new Set(["destination_funds_ready_limit_not_met", "execution_review_required", "reconciliation_required", "failed", "expired"]),
  destination_funds_ready_limit_not_met: new Set(["watching", "indeterminate", "execution_review_required", "cancelled", "expired"]),
  execution_review_required: new Set(["partially_filled", "filled", "reconciliation_required", "failed", "cancelled", "expired"]),
  partially_filled: new Set(["filled", "reconciliation_required", "failed", "cancelled"]),
  reconciliation_required: new Set(["failed", "cancelled"]),
  filled: new Set(),
  failed: new Set(),
  cancelled: new Set(),
  expired: new Set(),
});

function fail(code, details = null) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  throw error;
}

function clone(value) {
  return structuredClone(value);
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
}

function assertDataOnly(value, path = "value") {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") fail(`non_data_value:${path}`);
  if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0))) fail(`invalid_number:${path}`);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertDataOnly(entry, `${path}[${index}]`));
    return true;
  }
  if (!value || typeof value !== "object") return true;
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_FIELD_RE.test(key)) fail(`secret_field_forbidden:${path}.${key}`);
    assertDataOnly(entry, `${path}.${key}`);
  }
  return true;
}

function required(value, field, maximum = 240) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) fail(`${field}_invalid`);
  return normalized;
}

function timestamp(value, field) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) fail(`${field}_invalid`);
  return new Date(parsed).toISOString();
}

function optionalTimestamp(value, field) {
  return value === null || value === undefined || value === "" ? null : timestamp(value, field);
}

function positiveInteger(value, field, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) fail(`${field}_invalid`);
  return parsed;
}

function nonNegativeInteger(value, field, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) fail(`${field}_invalid`);
  return parsed;
}

function positiveAtomic(value, field) {
  return normalizeAtomic(value, field, { allowZero: false });
}

function optionalAtomic(value, field) {
  return value === null || value === undefined || value === "" ? null : normalizeAtomic(value, field);
}

function sameCanonicalRecord(left, right) {
  return agenticContractHash(left) === agenticContractHash(right);
}

function seal(core, hashField) {
  const value = { ...core, [hashField]: agenticContractHash(core) };
  return freeze(value);
}

function verifySeal(value, schema, hashField) {
  if (!value || value.schema_version !== schema || typeof value[hashField] !== "string") return false;
  const { [hashField]: supplied, ...core } = value;
  return supplied === agenticContractHash(core);
}

function normalizeExactAsset(input, field) {
  try {
    return normalizeAssetIdentity(input);
  } catch (error) {
    fail(`${field}_invalid`, String(error?.message || error));
  }
}

function chainId(value, field) {
  try {
    return normalizeChainIdentity(value).chain_id;
  } catch (error) {
    fail(`${field}_invalid`, String(error?.message || error));
  }
}

function canonicalUsdcIdentityForChain(value) {
  const canonicalChainId = chainId(value, "canonical_usdc_chain_id");
  const registryKey = CHAIN_TO_USDC_REGISTRY[canonicalChainId];
  const registry = registryKey ? CanonicalUsdcRegistry[registryKey] : null;
  if (!registry) return null;
  return normalizeAssetIdentity({
    chain_id: canonicalChainId,
    kind: "stablecoin",
    standard: registry.standard,
    reference: registry.address,
    symbol: "USDC",
    decimals: registry.decimals,
    issuer_id: "circle",
    representation: "canonical",
    verification_state: "verified",
  });
}

export function canonicalUsdcAssetForChain(value) {
  const asset = canonicalUsdcIdentityForChain(value);
  return asset ? freeze(clone(asset)) : null;
}

function normalizeAllowedFundingChains(values, destinationChainId) {
  const rows = Array.isArray(values) && values.length ? values : [destinationChainId];
  if (rows.length > UnifiedUsdcLimitLimits.maximum_allowed_funding_chains) fail("allowed_funding_chains_out_of_bounds");
  return [...new Set(rows.map((value, index) => chainId(value, `allowed_funding_chain_${index}`)))].sort();
}

export function createUnifiedUsdcLimitOrder(input = {}) {
  assertDataOnly(input, "limit_order_input");
  const side = required(input.side, "limit_order_side", 8).toLowerCase();
  if (!new Set(["buy", "sell"]).has(side)) fail("limit_order_side_invalid");
  const destinationAsset = normalizeExactAsset(input.destination_asset, "destination_asset");
  if (destinationAsset.decimals === null) fail("destination_asset_decimals_required");
  if (!new Set(["fungible_token", "stablecoin", "wrapped_native"]).has(destinationAsset.kind)) fail("destination_asset_kind_unsupported");
  const destinationChainId = chainId(input.destination_chain_id || destinationAsset.chain_id, "destination_chain_id");
  if (destinationChainId !== destinationAsset.chain_id) fail("destination_asset_chain_mismatch");
  const destinationVenueId = required(input.destination_venue_id, "destination_venue_id");
  const createdAt = timestamp(input.created_at, "limit_order_created_at");
  const expiresAt = timestamp(input.expires_at, "limit_order_expires_at");
  if (Date.parse(expiresAt) <= Date.parse(createdAt)) fail("limit_order_expiry_invalid");
  const limitPriceE18 = decimalToAtomic(input.limit_price_usdc, PRICE_SCALE_DECIMALS, "limit_price_usdc", { allowZero: false });
  const buyNotional = side === "buy"
    ? (input.trade_notional_usdc_micros === undefined
      ? decimalToAtomic(input.trade_notional_usdc, USDC_DECIMALS, "trade_notional_usdc", { allowZero: false })
      : positiveAtomic(input.trade_notional_usdc_micros, "trade_notional_usdc_micros"))
    : null;
  const sellQuantity = side === "sell" ? positiveAtomic(input.quantity_atomic, "sell_quantity_atomic") : null;
  const maximumQuoteAgeMs = positiveInteger(input.maximum_quote_age_ms ?? 15_000, "maximum_quote_age_ms", 300_000);
  const environment = required(input.environment || "paper", "limit_order_environment", 16).toLowerCase();
  if (!new Set(["preview", "paper"]).has(environment)) fail("limit_order_live_environment_disabled");
  const core = {
    schema_version: UNIFIED_USDC_LIMIT_ORDER_SCHEMA,
    order_id: required(input.order_id, "limit_order_id", 160),
    owner_scope: required(input.owner_scope || "authenticated_user", "limit_order_owner_scope", 120),
    side,
    destination_chain_id: destinationChainId,
    destination_venue_id: destinationVenueId,
    destination_asset: destinationAsset,
    destination_asset_id: destinationAsset.asset_id,
    token_decimals: destinationAsset.decimals,
    limit_price_usdc: atomicToDecimal(limitPriceE18, PRICE_SCALE_DECIMALS, "limit_price_usdc_e18"),
    limit_price_usdc_e18: limitPriceE18,
    trigger_basis: side === "buy" ? "maximum_all_in_usdc_per_token" : "minimum_net_usdc_per_token",
    trade_notional_usdc_micros: buyNotional,
    quantity_atomic: sellQuantity,
    allowed_funding_chain_ids: normalizeAllowedFundingChains(input.allowed_funding_chain_ids, destinationChainId),
    require_verified_exit: true,
    maximum_quote_age_ms: maximumQuoteAgeMs,
    created_at: createdAt,
    expires_at: expiresAt,
    environment,
    initial_state: "armed",
    execution_boundary: UNIFIED_USDC_LIMIT_EXECUTION_BOUNDARY,
  };
  return seal(core, "order_hash");
}

export function verifyUnifiedUsdcLimitOrder(order) {
  return verifySeal(order, UNIFIED_USDC_LIMIT_ORDER_SCHEMA, "order_hash");
}

function normalizeCostEntry(input, component, side) {
  const raw = input && typeof input === "object" ? input : {};
  const treatment = String(raw.treatment || "unknown").trim().toLowerCase();
  const allowed = side === "buy" ? BUY_COST_TREATMENTS : SELL_COST_TREATMENTS;
  if (!allowed.has(treatment)) fail(`cost_${component}_treatment_invalid`);
  const amount = treatment === "not_applicable"
    ? "0"
    : optionalAtomic(raw.amount_usdc_micros, `cost_${component}_usdc_micros`);
  if (treatment !== "unknown" && amount === null) fail(`cost_${component}_amount_required`);
  return {
    component,
    amount_usdc_micros: amount,
    treatment,
    source: raw.source ? required(raw.source, `cost_${component}_source`, 120) : null,
  };
}

function normalizeCosts(input, side) {
  const source = input && typeof input === "object" ? input : {};
  const rows = COST_COMPONENTS.map((component) => normalizeCostEntry(source[component], component, side));
  return {
    rows,
    complete: rows.every((row) => row.treatment !== "unknown" && row.amount_usdc_micros !== null),
    unknown_components: rows.filter((row) => row.treatment === "unknown" || row.amount_usdc_micros === null).map((row) => row.component),
  };
}

function sumCosts(rows, treatment) {
  return rows.filter((row) => row.treatment === treatment).reduce((sum, row) => sum + BigInt(row.amount_usdc_micros || "0"), 0n);
}

function normalizeGasRequirement(input, field, defaultChainId, defaultVenueId) {
  const source = input && typeof input === "object" ? input : {};
  const state = String(source.state || "unknown").trim().toLowerCase();
  if (!GAS_STATES.has(state)) fail(`${field}_state_invalid`);
  if (new Set(["sponsored", "not_required"]).has(state)) {
    return { state, chain_id: defaultChainId, venue_id: defaultVenueId, asset_id: null, amount_atomic: "0", provider: source.provider ? required(source.provider, `${field}_provider`) : null };
  }
  if (new Set(["unknown", "unavailable"]).has(state)) {
    return { state, chain_id: defaultChainId, venue_id: defaultVenueId, asset_id: null, amount_atomic: null, provider: source.provider ? required(source.provider, `${field}_provider`) : null };
  }
  const normalizedChainId = chainId(source.chain_id || defaultChainId, `${field}_chain_id`);
  return {
    state,
    chain_id: normalizedChainId,
    venue_id: required(source.venue_id || defaultVenueId, `${field}_venue_id`),
    asset_id: required(source.asset_id, `${field}_asset_id`),
    amount_atomic: positiveAtomic(source.amount_atomic, `${field}_amount_atomic`),
    provider: source.provider ? required(source.provider, `${field}_provider`) : null,
  };
}

function normalizeBridgeEvidence(input, sourceChainId, destinationChainId, quoteExpiresAt) {
  const crossChain = sourceChainId !== destinationChainId;
  const source = input && typeof input === "object" ? input : {};
  const state = String(source.state || (crossChain ? "unknown" : "not_required")).trim().toLowerCase();
  if (!BRIDGE_STATES.has(state)) fail("bridge_state_invalid");
  if (!crossChain) {
    if (state !== "not_required") fail("same_chain_bridge_evidence_invalid");
    return {
      state,
      provider: null,
      mechanism_id: null,
      quote_bound: false,
      source_chain_id: sourceChainId,
      destination_chain_id: destinationChainId,
      expected_arrival_ms: 0,
      expires_at: quoteExpiresAt,
      trust_dependencies: [],
    };
  }
  const expiresAt = optionalTimestamp(source.expires_at, "bridge_expires_at");
  const trustDependencies = Array.isArray(source.trust_dependencies) ? source.trust_dependencies : [];
  if (trustDependencies.length > UnifiedUsdcLimitLimits.maximum_bridge_trust_dependencies) fail("bridge_trust_dependencies_out_of_bounds");
  return {
    state,
    provider: source.provider ? required(source.provider, "bridge_provider", 120) : null,
    mechanism_id: source.mechanism_id ? required(source.mechanism_id, "bridge_mechanism_id", 160) : null,
    quote_bound: source.quote_bound === true,
    source_chain_id: sourceChainId,
    destination_chain_id: destinationChainId,
    expected_arrival_ms: source.expected_arrival_ms === null || source.expected_arrival_ms === undefined
      ? null
      : nonNegativeInteger(source.expected_arrival_ms, "bridge_expected_arrival_ms", 86_400_000),
    expires_at: expiresAt,
    trust_dependencies: [...new Set(trustDependencies.map((row, index) => required(row, `bridge_trust_dependency_${index}`, 120)))].sort(),
  };
}

function normalizeExitProof(input, side) {
  const source = input && typeof input === "object" ? input : {};
  if (side === "sell") {
    return {
      state: "sell_route_is_exit",
      verified: true,
      quote_id: source.quote_id ? required(source.quote_id, "exit_quote_id") : null,
      observed_at: optionalTimestamp(source.observed_at, "exit_observed_at"),
      expires_at: optionalTimestamp(source.expires_at, "exit_expires_at"),
      minimum_liquidation_usdc_micros: null,
      settlement_asset_id: source.settlement_asset_id ? required(source.settlement_asset_id, "exit_settlement_asset_id") : null,
    };
  }
  const state = required(source.state || "unknown", "exit_proof_state", 40).toLowerCase();
  if (!EXIT_PROOF_STATES.has(state)) fail("exit_proof_state_invalid");
  const verified = state === "verified" && source.verified === true;
  return {
    state,
    verified,
    quote_id: source.quote_id ? required(source.quote_id, "exit_quote_id") : null,
    observed_at: optionalTimestamp(source.observed_at, "exit_observed_at"),
    expires_at: optionalTimestamp(source.expires_at, "exit_expires_at"),
    minimum_liquidation_usdc_micros: optionalAtomic(source.minimum_liquidation_usdc_micros, "exit_minimum_liquidation_usdc_micros"),
    settlement_asset_id: source.settlement_asset_id ? required(source.settlement_asset_id, "exit_settlement_asset_id") : null,
  };
}

function normalizeCapitalLocation(input, fallback, field) {
  const source = input && typeof input === "object" ? input : {};
  const normalizedChainId = chainId(source.chain_id || fallback.chain_id, `${field}_chain_id`);
  const asset = normalizeExactAsset(source.asset || fallback.asset, `${field}_asset`);
  if (asset.chain_id !== normalizedChainId) fail(`${field}_asset_chain_mismatch`);
  return {
    chain_id: normalizedChainId,
    venue_id: required(source.venue_id || fallback.venue_id, `${field}_venue_id`),
    asset,
    asset_id: asset.asset_id,
  };
}

function ceilDivide(numerator, denominator) {
  if (denominator <= 0n) fail("division_by_zero");
  return (numerator + denominator - 1n) / denominator;
}

function buyEffectivePriceE18(totalDebitMicros, minimumOutputAtomic, tokenDecimals) {
  return ceilDivide(BigInt(totalDebitMicros) * (10n ** BigInt(tokenDecimals)) * USDC_TO_PRICE_SCALE, BigInt(minimumOutputAtomic));
}

function sellEffectivePriceE18(netMinimumMicros, inputQuantityAtomic, tokenDecimals) {
  return (BigInt(netMinimumMicros) * (10n ** BigInt(tokenDecimals)) * USDC_TO_PRICE_SCALE) / BigInt(inputQuantityAtomic);
}

function economicsFor(side, order, costs, values) {
  if (!costs.complete || values.output_is_net_of_embedded_costs !== true) {
    return {
      complete: false,
      reasons: [
        ...costs.unknown_components.map((row) => `cost_${row}_unknown`),
        ...(values.output_is_net_of_embedded_costs === true ? [] : ["embedded_cost_netting_unproven"]),
      ],
      source_debit_usdc_micros: null,
      net_minimum_output_usdc_micros: null,
      effective_price_usdc_e18: null,
      effective_price_usdc: null,
    };
  }
  if (side === "buy") {
    const sourceDebit = BigInt(values.trade_notional_usdc_micros) + sumCosts(costs.rows, "added_to_input");
    const price = buyEffectivePriceE18(sourceDebit, values.minimum_destination_quantity_atomic, order.token_decimals);
    return {
      complete: true,
      reasons: [],
      source_debit_usdc_micros: sourceDebit.toString(),
      net_minimum_output_usdc_micros: null,
      effective_price_usdc_e18: price.toString(),
      effective_price_usdc: atomicToDecimal(price.toString(), PRICE_SCALE_DECIMALS, "effective_buy_price"),
    };
  }
  const deducted = sumCosts(costs.rows, "deducted_from_output");
  const grossMinimum = BigInt(values.minimum_gross_usdc_output_micros);
  if (deducted >= grossMinimum) {
    return {
      complete: false,
      reasons: ["costs_exceed_or_equal_minimum_output"],
      source_debit_usdc_micros: null,
      net_minimum_output_usdc_micros: "0",
      effective_price_usdc_e18: null,
      effective_price_usdc: null,
    };
  }
  const netMinimum = grossMinimum - deducted;
  const price = sellEffectivePriceE18(netMinimum, values.input_quantity_atomic, order.token_decimals);
  return {
    complete: true,
    reasons: [],
    source_debit_usdc_micros: null,
    net_minimum_output_usdc_micros: netMinimum.toString(),
    effective_price_usdc_e18: price.toString(),
    effective_price_usdc: atomicToDecimal(price.toString(), PRICE_SCALE_DECIMALS, "effective_sell_price"),
  };
}

function gasEvidenceReady(gas) {
  return new Set(["available", "sponsored", "not_required"]).has(gas.state);
}

export function createUnifiedUsdcLimitQuote(input = {}) {
  assertDataOnly(input, "limit_quote_input");
  const order = input.order;
  if (!verifyUnifiedUsdcLimitOrder(order)) fail("limit_order_integrity_invalid");
  const side = required(input.side || order.side, "limit_quote_side", 8).toLowerCase();
  if (side !== order.side) fail("limit_quote_side_mismatch");
  const sourceAsset = normalizeExactAsset(input.source_asset, "limit_quote_source_asset");
  const destinationAsset = normalizeExactAsset(input.destination_asset, "limit_quote_destination_asset");
  const sourceChainId = sourceAsset.chain_id;
  const destinationChainId = destinationAsset.chain_id;
  const sourceCapitalLocation = normalizeCapitalLocation(input.source_capital_location, {
    chain_id: sourceChainId,
    venue_id: input.source_venue_id,
    asset: sourceAsset,
  }, "source_capital_location");
  const destinationVenueId = required(input.destination_venue_id || order.destination_venue_id, "limit_quote_destination_venue_id");
  if (side === "buy") {
    const canonical = canonicalUsdcIdentityForChain(sourceChainId);
    if (!canonical || !sameCanonicalRecord(canonical, sourceAsset)) fail("buy_source_is_not_verified_canonical_usdc");
    if (!sameCanonicalRecord(destinationAsset, order.destination_asset)) fail("buy_destination_asset_mismatch");
    if (!order.allowed_funding_chain_ids.includes(sourceChainId)) fail("buy_source_chain_not_allowed");
  } else {
    if (!sameCanonicalRecord(sourceAsset, order.destination_asset)) fail("sell_source_asset_mismatch");
    const canonical = canonicalUsdcIdentityForChain(destinationChainId);
    if (!canonical || !sameCanonicalRecord(canonical, destinationAsset)) fail("sell_destination_is_not_verified_canonical_usdc");
    if (sourceChainId !== destinationChainId) fail("sell_cross_chain_settlement_must_be_separate_transfer");
  }
  const observedAt = timestamp(input.observed_at, "limit_quote_observed_at");
  const expiresAt = timestamp(input.expires_at, "limit_quote_expires_at");
  if (Date.parse(expiresAt) <= Date.parse(observedAt)) fail("limit_quote_expiry_invalid");
  const routeState = String(input.route_state || "indeterminate").trim().toLowerCase();
  if (!ROUTE_STATES.has(routeState)) fail("limit_quote_route_state_invalid");
  const providerHealth = String(input.provider_health || "unknown").trim().toLowerCase();
  if (!PROVIDER_HEALTH_STATES.has(providerHealth)) fail("limit_quote_provider_health_invalid");
  const costs = normalizeCosts(input.costs, side);
  const values = side === "buy" ? {
    trade_notional_usdc_micros: positiveAtomic(input.trade_notional_usdc_micros ?? order.trade_notional_usdc_micros, "limit_quote_trade_notional_usdc_micros"),
    expected_destination_quantity_atomic: positiveAtomic(input.expected_destination_quantity_atomic, "limit_quote_expected_destination_quantity_atomic"),
    minimum_destination_quantity_atomic: positiveAtomic(input.minimum_destination_quantity_atomic, "limit_quote_minimum_destination_quantity_atomic"),
    input_quantity_atomic: null,
    expected_gross_usdc_output_micros: null,
    minimum_gross_usdc_output_micros: null,
    output_is_net_of_embedded_costs: input.output_is_net_of_embedded_costs === true,
  } : {
    trade_notional_usdc_micros: null,
    expected_destination_quantity_atomic: null,
    minimum_destination_quantity_atomic: null,
    input_quantity_atomic: positiveAtomic(input.input_quantity_atomic ?? order.quantity_atomic, "limit_quote_input_quantity_atomic"),
    expected_gross_usdc_output_micros: positiveAtomic(input.expected_gross_usdc_output_micros, "limit_quote_expected_gross_usdc_output_micros"),
    minimum_gross_usdc_output_micros: positiveAtomic(input.minimum_gross_usdc_output_micros, "limit_quote_minimum_gross_usdc_output_micros"),
    output_is_net_of_embedded_costs: input.output_is_net_of_embedded_costs === true,
  };
  if (side === "buy") {
    if (values.trade_notional_usdc_micros !== order.trade_notional_usdc_micros) fail("limit_quote_notional_mismatch");
    if (BigInt(values.minimum_destination_quantity_atomic) > BigInt(values.expected_destination_quantity_atomic)) fail("limit_quote_minimum_output_invalid");
  } else {
    if (values.input_quantity_atomic !== order.quantity_atomic) fail("limit_quote_quantity_mismatch");
    if (BigInt(values.minimum_gross_usdc_output_micros) > BigInt(values.expected_gross_usdc_output_micros)) fail("limit_quote_minimum_output_invalid");
  }
  const sourceGas = normalizeGasRequirement(input.source_gas, "source_gas", sourceChainId, sourceCapitalLocation.venue_id);
  const destinationGas = normalizeGasRequirement(input.destination_gas, "destination_gas", destinationChainId, destinationVenueId);
  const bridge = normalizeBridgeEvidence(input.bridge, sourceChainId, destinationChainId, expiresAt);
  const exitProof = normalizeExitProof(input.exit_proof, side);
  const economics = economicsFor(side, order, costs, values);
  const ravenCost = costs.rows.find((row) => row.component === "raven");
  const ravenFeeBps = input.raven_fee_bps === null || input.raven_fee_bps === undefined
    ? null
    : nonNegativeInteger(input.raven_fee_bps, "raven_fee_bps", 10_000);
  const reasons = [...economics.reasons];
  if (ravenCost.treatment !== "not_applicable" && ravenCost.treatment !== "unknown" && ravenFeeBps === null) reasons.push("raven_fee_rate_unknown");
  if (!gasEvidenceReady(sourceGas)) reasons.push(`source_gas_${sourceGas.state}`);
  if (!gasEvidenceReady(destinationGas)) reasons.push(`destination_gas_${destinationGas.state}`);
  if (sourceChainId !== destinationChainId) {
    if (bridge.state !== "verified_quote") reasons.push(`bridge_${bridge.state}`);
    if (!bridge.quote_bound || !bridge.provider || !bridge.mechanism_id || bridge.expected_arrival_ms === null || !bridge.expires_at) reasons.push("bridge_quote_incomplete");
  }
  if (side === "buy" && !exitProof.verified) reasons.push("exit_unverified");
  if (side === "buy" && (!exitProof.quote_id || !exitProof.observed_at || !exitProof.expires_at || !exitProof.minimum_liquidation_usdc_micros || !exitProof.settlement_asset_id)) {
    reasons.push("exit_proof_incomplete");
  }
  const economicComplete = economics.complete && reasons.length === 0;
  const core = {
    schema_version: UNIFIED_USDC_LIMIT_QUOTE_SCHEMA,
    quote_id: required(input.quote_id, "limit_quote_id", 180),
    order_id: order.order_id,
    order_hash: order.order_hash,
    side,
    provider: required(input.provider, "limit_quote_provider", 120),
    provider_health: providerHealth,
    route_state: routeState,
    source_chain_id: sourceChainId,
    destination_chain_id: destinationChainId,
    source_venue_id: required(input.source_venue_id, "limit_quote_source_venue_id"),
    destination_venue_id: destinationVenueId,
    source_asset: sourceAsset,
    source_asset_id: sourceAsset.asset_id,
    destination_asset: destinationAsset,
    destination_asset_id: destinationAsset.asset_id,
    source_capital_location: sourceCapitalLocation,
    route_kind: sourceChainId === destinationChainId ? "same_chain" : "cross_chain",
    values,
    costs: costs.rows,
    raven_fee_bps: ravenFeeBps,
    raven_fee_policy_version: input.raven_fee_policy_version ? required(input.raven_fee_policy_version, "raven_fee_policy_version", 120) : null,
    economics: {
      ...economics,
      complete: economicComplete,
      reasons: [...new Set(reasons)].sort(),
    },
    source_gas: sourceGas,
    destination_gas: destinationGas,
    bridge,
    exit_proof: exitProof,
    estimated_settlement_ms: input.estimated_settlement_ms === null || input.estimated_settlement_ms === undefined
      ? null
      : nonNegativeInteger(input.estimated_settlement_ms, "estimated_settlement_ms", 86_400_000),
    transaction_count: positiveInteger(input.transaction_count ?? 1, "limit_quote_transaction_count", 32),
    observed_at: observedAt,
    expires_at: expiresAt,
    marked_price_used_for_trigger: false,
    provider_ordering_authoritative: false,
    transaction_material_included: false,
    execution_boundary: UNIFIED_USDC_LIMIT_EXECUTION_BOUNDARY,
  };
  return seal(core, "quote_hash");
}

export function verifyUnifiedUsdcLimitQuote(quote) {
  return verifySeal(quote, UNIFIED_USDC_LIMIT_QUOTE_SCHEMA, "quote_hash");
}

function normalizeBalanceRows(rows, observedAt) {
  const values = Array.isArray(rows) ? rows : [];
  if (values.length > UnifiedUsdcLimitLimits.maximum_balance_rows_per_evaluation) fail("limit_balance_rows_out_of_bounds");
  return values.map((row, index) => {
    const normalizedChainId = chainId(row.chain_id, `balance_${index}_chain_id`);
    const state = String(row.state || "unknown").trim().toLowerCase();
    if (!new Set(["available", "stale", "unavailable", "unknown"]).has(state)) fail(`balance_${index}_state_invalid`);
    const rowObservedAt = timestamp(row.observed_at, `balance_${index}_observed_at`);
    const expiresAt = optionalTimestamp(row.expires_at, `balance_${index}_expires_at`);
    const fresh = state === "available"
      && Date.parse(rowObservedAt) <= Date.parse(observedAt)
      && (!expiresAt || Date.parse(expiresAt) > Date.parse(observedAt));
    return {
      chain_id: normalizedChainId,
      venue_id: required(row.venue_id, `balance_${index}_venue_id`),
      asset_id: required(row.asset_id, `balance_${index}_asset_id`),
      available_atomic: fresh ? normalizeAtomic(row.available_atomic, `balance_${index}_available_atomic`) : null,
      state: fresh ? "available" : state === "available" ? "stale" : state,
      observed_at: rowObservedAt,
      expires_at: expiresAt,
    };
  });
}

function locationKey(row) {
  return `${row.chain_id}|${row.venue_id}|${row.asset_id}`;
}

function capitalRequirements(order, quote) {
  const primaryAmount = order.side === "buy" ? quote.economics.source_debit_usdc_micros : order.quantity_atomic;
  const rows = [{
    role: order.side === "buy" ? "source_usdc" : "source_token",
    chain_id: quote.source_capital_location.chain_id,
    venue_id: quote.source_capital_location.venue_id,
    asset_id: quote.source_capital_location.asset_id,
    amount_atomic: primaryAmount,
  }];
  for (const [role, gas] of [["source_gas", quote.source_gas], ["destination_gas", quote.destination_gas]]) {
    if (gas.state !== "available" || BigInt(gas.amount_atomic || "0") === 0n) continue;
    rows.push({ role, chain_id: gas.chain_id, venue_id: gas.venue_id, asset_id: gas.asset_id, amount_atomic: gas.amount_atomic });
  }
  const combined = new Map();
  for (const row of rows) {
    const key = locationKey(row);
    const current = combined.get(key);
    if (current) {
      current.amount_atomic = (BigInt(current.amount_atomic) + BigInt(row.amount_atomic)).toString();
      current.roles.push(row.role);
    } else {
      combined.set(key, { ...row, roles: [row.role] });
    }
  }
  return [...combined.values()].sort((left, right) => locationKey(left).localeCompare(locationKey(right)));
}

function inspectCapital(requirements, balances) {
  const totals = new Map();
  for (const row of balances.filter((entry) => entry.state === "available" && entry.available_atomic !== null)) {
    const key = locationKey(row);
    totals.set(key, (BigInt(totals.get(key) || "0") + BigInt(row.available_atomic)).toString());
  }
  const checks = requirements.map((row) => {
    const available = totals.get(locationKey(row)) ?? null;
    const sufficient = available !== null && BigInt(available) >= BigInt(row.amount_atomic);
    return { ...row, available_atomic: available, sufficient, reason: available === null ? "local_capital_unavailable" : sufficient ? null : "insufficient_local_capital" };
  });
  return {
    ready: checks.every((row) => row.sufficient),
    checks,
    reasons: [...new Set(checks.filter((row) => !row.sufficient).map((row) => row.reason))],
  };
}

function quoteEligibility(order, quote, observedAt) {
  const reasons = [];
  if (!verifyUnifiedUsdcLimitQuote(quote)) return { quote, eligible: false, reasons: ["quote_integrity_invalid"], trigger_met: false };
  if (quote.order_id !== order.order_id || quote.order_hash !== order.order_hash) reasons.push("quote_order_mismatch");
  if (quote.side !== order.side) reasons.push("quote_side_mismatch");
  if (quote.route_state !== "executable") reasons.push(`route_${quote.route_state}`);
  if (quote.provider_health !== "healthy") reasons.push(`provider_${quote.provider_health}`);
  const observedMs = Date.parse(observedAt);
  const quoteObservedMs = Date.parse(quote.observed_at);
  if (quoteObservedMs > observedMs) reasons.push("quote_from_future");
  if (observedMs - quoteObservedMs > order.maximum_quote_age_ms) reasons.push("quote_too_old");
  if (Date.parse(quote.expires_at) <= observedMs) reasons.push("quote_expired");
  if (!quote.economics.complete || quote.economics.effective_price_usdc_e18 === null) reasons.push("route_economics_incomplete");
  if (order.side === "buy") {
    if (!quote.exit_proof.verified) reasons.push("exit_unverified");
    if (!quote.exit_proof.expires_at || Date.parse(quote.exit_proof.expires_at) <= observedMs) reasons.push("exit_proof_expired");
    if (quote.exit_proof.observed_at && observedMs - Date.parse(quote.exit_proof.observed_at) > order.maximum_quote_age_ms) reasons.push("exit_proof_too_old");
  }
  if (quote.route_kind === "cross_chain") {
    if (quote.bridge.state !== "verified_quote" || quote.bridge.quote_bound !== true) reasons.push("bridge_quote_unverified");
    if (!quote.bridge.expires_at || Date.parse(quote.bridge.expires_at) <= observedMs) reasons.push("bridge_quote_expired");
    if (quote.bridge.expected_arrival_ms !== null && observedMs + quote.bridge.expected_arrival_ms >= Date.parse(order.expires_at)) reasons.push("bridge_arrival_after_order_expiry");
  }
  const effective = quote.economics.effective_price_usdc_e18 === null ? null : BigInt(quote.economics.effective_price_usdc_e18);
  const limit = BigInt(order.limit_price_usdc_e18);
  return {
    quote,
    eligible: reasons.length === 0,
    reasons: [...new Set(reasons)].sort(),
    trigger_met: reasons.length === 0 && (order.side === "buy" ? effective <= limit : effective >= limit),
  };
}

function compareEligible(order, left, right) {
  const leftPrice = BigInt(left.quote.economics.effective_price_usdc_e18);
  const rightPrice = BigInt(right.quote.economics.effective_price_usdc_e18);
  if (leftPrice !== rightPrice) {
    if (order.side === "buy") return leftPrice < rightPrice ? -1 : 1;
    return leftPrice > rightPrice ? -1 : 1;
  }
  const leftTime = left.quote.estimated_settlement_ms ?? Number.MAX_SAFE_INTEGER;
  const rightTime = right.quote.estimated_settlement_ms ?? Number.MAX_SAFE_INTEGER;
  if (leftTime !== rightTime) return leftTime - rightTime;
  if (left.quote.transaction_count !== right.quote.transaction_count) return left.quote.transaction_count - right.quote.transaction_count;
  return left.quote.quote_id.localeCompare(right.quote.quote_id);
}

export function evaluateUnifiedUsdcLimitOrder({ order, quotes = [], balances = [], observed_at } = {}) {
  if (!verifyUnifiedUsdcLimitOrder(order)) fail("limit_order_integrity_invalid");
  const observedAt = timestamp(observed_at, "limit_evaluation_observed_at");
  if (Date.parse(observedAt) < Date.parse(order.created_at)) fail("limit_evaluation_before_order");
  if (Date.parse(observedAt) >= Date.parse(order.expires_at)) {
    return seal({
      schema_version: UNIFIED_USDC_LIMIT_EVALUATION_SCHEMA,
      evaluation_id: `${order.order_id}:${observedAt}`,
      order_id: order.order_id,
      order_hash: order.order_hash,
      observed_at: observedAt,
      state: "expired",
      selected_quote_id: null,
      selected_quote_hash: null,
      trigger_met: false,
      capital_ready: false,
      funding_route: null,
      effective_price_usdc: null,
      limit_price_usdc: order.limit_price_usdc,
      capital_requirements: [],
      capital_checks: [],
      refusal_reasons: ["order_expired"],
      marked_price_used_for_trigger: false,
      execution_boundary: UNIFIED_USDC_LIMIT_EXECUTION_BOUNDARY,
    }, "evaluation_hash");
  }
  const quoteRows = Array.isArray(quotes) ? quotes : [];
  if (quoteRows.length > UnifiedUsdcLimitLimits.maximum_quote_candidates_per_evaluation) fail("limit_quote_candidates_out_of_bounds");
  const assessments = quoteRows.map((quote) => quoteEligibility(order, quote, observedAt));
  const eligible = assessments.filter((row) => row.eligible).sort((left, right) => compareEligible(order, left, right));
  if (!eligible.length) {
    const reasons = assessments.length
      ? [...new Set(assessments.flatMap((row) => row.reasons))].sort()
      : ["current_executable_route_unavailable"];
    return seal({
      schema_version: UNIFIED_USDC_LIMIT_EVALUATION_SCHEMA,
      evaluation_id: `${order.order_id}:${observedAt}`,
      order_id: order.order_id,
      order_hash: order.order_hash,
      observed_at: observedAt,
      state: "indeterminate",
      selected_quote_id: null,
      selected_quote_hash: null,
      trigger_met: false,
      capital_ready: false,
      funding_route: null,
      effective_price_usdc: null,
      limit_price_usdc: order.limit_price_usdc,
      capital_requirements: [],
      capital_checks: [],
      refusal_reasons: reasons,
      candidate_results: assessments.map((row) => ({ quote_id: row.quote?.quote_id || null, eligible: false, reasons: row.reasons })),
      marked_price_used_for_trigger: false,
      execution_boundary: UNIFIED_USDC_LIMIT_EXECUTION_BOUNDARY,
    }, "evaluation_hash");
  }
  const selected = eligible[0];
  const quote = selected.quote;
  const requirements = capitalRequirements(order, quote);
  const normalizedBalances = normalizeBalanceRows(balances, observedAt);
  const capital = inspectCapital(requirements, normalizedBalances);
  let state = "watching";
  const refusalReasons = [];
  if (selected.trigger_met && !capital.ready) {
    state = "funding_not_ready";
    refusalReasons.push(...capital.reasons);
  } else if (selected.trigger_met && quote.route_kind === "cross_chain") {
    state = "funding_approval_required";
    refusalReasons.push("cross_chain_capital_transfer_requires_manual_approval");
  } else if (selected.trigger_met) {
    state = "execution_review_required";
    refusalReasons.push("wallet_or_session_authorization_required");
  } else {
    refusalReasons.push("all_in_executable_limit_not_met");
  }
  return seal({
    schema_version: UNIFIED_USDC_LIMIT_EVALUATION_SCHEMA,
    evaluation_id: `${order.order_id}:${observedAt}`,
    order_id: order.order_id,
    order_hash: order.order_hash,
    observed_at: observedAt,
    state,
    selected_quote_id: quote.quote_id,
    selected_quote_hash: quote.quote_hash,
    trigger_met: selected.trigger_met,
    capital_ready: capital.ready,
    funding_route: quote.route_kind,
    source_chain_id: quote.source_chain_id,
    destination_chain_id: quote.destination_chain_id,
    effective_price_usdc: quote.economics.effective_price_usdc,
    effective_price_usdc_e18: quote.economics.effective_price_usdc_e18,
    limit_price_usdc: order.limit_price_usdc,
    limit_price_usdc_e18: order.limit_price_usdc_e18,
    capital_requirements: requirements,
    capital_checks: capital.checks,
    refusal_reasons: [...new Set(refusalReasons)].sort(),
    candidate_results: assessments.map((row) => ({ quote_id: row.quote?.quote_id || null, eligible: row.eligible, trigger_met: row.trigger_met, reasons: row.reasons })),
    deterministic_selection: "best_conservative_net_price_then_settlement_then_transaction_count_then_quote_id",
    marked_price_used_for_trigger: false,
    execution_boundary: UNIFIED_USDC_LIMIT_EXECUTION_BOUNDARY,
  }, "evaluation_hash");
}

export function verifyUnifiedUsdcLimitEvaluation(evaluation) {
  return verifySeal(evaluation, UNIFIED_USDC_LIMIT_EVALUATION_SCHEMA, "evaluation_hash");
}

export function reserveUnifiedUsdcLimitCapital({ evaluation, balances = [], reservation_book = null, created_at } = {}) {
  if (!verifyUnifiedUsdcLimitEvaluation(evaluation)) fail("limit_evaluation_integrity_invalid");
  if (!new Set(["execution_review_required", "funding_approval_required"]).has(evaluation.state)) fail("limit_evaluation_not_reservable");
  const at = timestamp(created_at, "limit_reservation_created_at");
  const normalizedBalances = normalizeBalanceRows(balances, at).filter((row) => row.state === "available");
  const book = reservation_book || createCapitalReservationBook({
    initial_balances: normalizedBalances.map((row) => ({ ...row, available_atomic: row.available_atomic })),
  });
  const reserved = [];
  for (const [index, requirement] of evaluation.capital_requirements.entries()) {
    const result = book.reserve({
      reservation_id: `${evaluation.order_id}:${requirement.role}:${index}`,
      plan_id: evaluation.order_id,
      leg_id: requirement.roles.join("+"),
      chain_id: requirement.chain_id,
      venue_id: requirement.venue_id,
      asset_id: requirement.asset_id,
      amount_atomic: requirement.amount_atomic,
      created_at: at,
      updated_at: at,
    });
    if (!result.ok) {
      for (const row of reserved) book.transition(row.reservation_id, "released", at);
      return freeze({ ok: false, state: "funding_not_ready", reason: result.reason, reservations: reserved, automatic_transfer_started: false, automatic_execution_started: false });
    }
    reserved.push(result.reservation);
  }
  return freeze({
    ok: true,
    state: evaluation.state,
    reservations: reserved,
    reservation_snapshot: book.snapshot(),
    automatic_transfer_started: false,
    automatic_execution_started: false,
    manual_approval_required: evaluation.state === "funding_approval_required",
    wallet_or_session_authorization_required: true,
  });
}

export function decideAfterDestinationFundsArrive({ order, prior_evaluation, fresh_quotes = [], balances = [], observed_at } = {}) {
  if (!verifyUnifiedUsdcLimitOrder(order)) fail("limit_order_integrity_invalid");
  if (!verifyUnifiedUsdcLimitEvaluation(prior_evaluation)) fail("prior_limit_evaluation_integrity_invalid");
  if (prior_evaluation.order_hash !== order.order_hash || prior_evaluation.state !== "funding_approval_required") fail("prior_cross_chain_funding_decision_required");
  const evaluation = evaluateUnifiedUsdcLimitOrder({ order, quotes: fresh_quotes, balances, observed_at });
  let state;
  const reasons = [...evaluation.refusal_reasons];
  if (evaluation.state === "watching") {
    state = "destination_funds_ready_limit_not_met";
    reasons.push("destination_funds_retained_as_chain_local_buying_power");
  } else if (evaluation.state === "execution_review_required") {
    state = "execution_review_required";
  } else {
    state = "reconciliation_required";
    reasons.push("fresh_destination_execution_not_proven");
  }
  return seal({
    schema_version: UNIFIED_USDC_LIMIT_ARRIVAL_DECISION_SCHEMA,
    decision_id: `${order.order_id}:arrival:${evaluation.observed_at}`,
    order_id: order.order_id,
    order_hash: order.order_hash,
    prior_evaluation_hash: prior_evaluation.evaluation_hash,
    fresh_evaluation_hash: evaluation.evaluation_hash,
    observed_at: evaluation.observed_at,
    state,
    fresh_evaluation: evaluation,
    refusal_reasons: [...new Set(reasons)].sort(),
    destination_swap_started: false,
    automatic_retry_performed: false,
    automatic_unwind_performed: false,
    destination_funds_returned_automatically: false,
    execution_boundary: UNIFIED_USDC_LIMIT_EXECUTION_BOUNDARY,
  }, "decision_hash");
}

function journalEvent({ orderId, sequence, from, to, at, reason, referenceHash, previousHash }) {
  const core = {
    event_id: `${orderId}:${sequence}`,
    order_id: orderId,
    sequence,
    from,
    to,
    at,
    reason,
    reference_hash: referenceHash,
    previous_event_hash: previousHash,
  };
  return { ...core, event_hash: agenticContractHash(core) };
}

function verifyJournalSnapshot(snapshot) {
  if (!snapshot || snapshot.schema_version !== UNIFIED_USDC_LIMIT_JOURNAL_SCHEMA) return false;
  const { snapshot_hash: supplied, ...core } = snapshot;
  if (supplied !== agenticContractHash(core)) return false;
  if (!Array.isArray(snapshot.orders) || snapshot.orders.length > UnifiedUsdcLimitLimits.maximum_journal_orders) return false;
  for (const row of snapshot.orders) {
    if (!verifyUnifiedUsdcLimitOrder(row.order)) return false;
    let previous = null;
    let state = row.order.initial_state;
    let previousAt = Date.parse(row.order.created_at);
    if (!Array.isArray(row.events) || row.events.length > UnifiedUsdcLimitLimits.maximum_journal_events_per_order) return false;
    for (const [index, event] of row.events.entries()) {
      const { event_hash: eventHash, ...eventCore } = event;
      const eventAt = Date.parse(event.at);
      if (
        event.sequence !== index + 1
        || event.event_id !== `${row.order.order_id}:${event.sequence}`
        || event.previous_event_hash !== previous
        || event.from !== state
        || !Number.isFinite(eventAt)
        || eventAt < previousAt
        || eventHash !== agenticContractHash(eventCore)
      ) return false;
      state = event.to;
      previous = eventHash;
      previousAt = eventAt;
    }
    if (state !== row.current_state || previous !== row.terminal_event_hash) return false;
  }
  return true;
}

export function createUnifiedUsdcLimitJournal({ snapshot = null } = {}) {
  if (snapshot && !verifyJournalSnapshot(snapshot)) fail("limit_journal_snapshot_integrity_invalid");
  const orders = new Map((snapshot?.orders || []).map((row) => [row.order.order_id, clone(row)]));

  function transition(orderId, to, { at, reason, reference_hash: referenceHash = null } = {}) {
    const id = required(orderId, "journal_order_id", 160);
    const row = orders.get(id);
    if (!row) fail("journal_order_not_found");
    const next = required(to, "journal_next_state", 80).toLowerCase();
    if (!UnifiedUsdcLimitStates.includes(next)) fail("journal_next_state_invalid");
    const occurredAt = timestamp(at, "journal_event_at");
    if (Date.parse(occurredAt) < Date.parse(row.order.created_at)) fail("journal_event_before_order");
    const previousAt = row.events.at(-1)?.at || row.order.created_at;
    if (Date.parse(occurredAt) < Date.parse(previousAt)) fail("journal_event_time_regression");
    if (row.events.length >= UnifiedUsdcLimitLimits.maximum_journal_events_per_order) fail("journal_event_limit_reached");
    if (!STATE_TRANSITIONS[row.current_state]?.has(next)) fail(`invalid_limit_order_transition:${row.current_state}->${next}`);
    const previous = row.events.at(-1)?.event_hash || null;
    const event = journalEvent({
      orderId: id,
      sequence: row.events.length + 1,
      from: row.current_state,
      to: next,
      at: occurredAt,
      reason: required(reason || next, "journal_event_reason", 160),
      referenceHash: referenceHash,
      previousHash: previous,
    });
    row.events.push(event);
    row.current_state = next;
    row.terminal_event_hash = event.event_hash;
    return freeze(clone(row));
  }

  return Object.freeze({
    register(order) {
      if (!verifyUnifiedUsdcLimitOrder(order)) fail("limit_order_integrity_invalid");
      const existing = orders.get(order.order_id);
      if (existing) {
        if (existing.order.order_hash !== order.order_hash) fail("limit_order_idempotency_conflict");
        return freeze({ idempotent: true, record: clone(existing) });
      }
      if (orders.size >= UnifiedUsdcLimitLimits.maximum_journal_orders) fail("limit_journal_order_limit_reached");
      const row = { order: clone(order), current_state: order.initial_state, events: [], terminal_event_hash: null };
      orders.set(order.order_id, row);
      return freeze({ idempotent: false, record: clone(row) });
    },
    recordEvaluation(evaluation) {
      if (!verifyUnifiedUsdcLimitEvaluation(evaluation)) fail("limit_evaluation_integrity_invalid");
      const row = orders.get(evaluation.order_id);
      if (!row || row.order.order_hash !== evaluation.order_hash) fail("limit_evaluation_order_mismatch");
      return transition(evaluation.order_id, evaluation.state, {
        at: evaluation.observed_at,
        reason: evaluation.refusal_reasons[0] || "current_route_evaluated",
        reference_hash: evaluation.evaluation_hash,
      });
    },
    transition,
    get(orderId) {
      const row = orders.get(String(orderId || ""));
      return row ? freeze(clone(row)) : null;
    },
    snapshot() {
      const core = {
        schema_version: UNIFIED_USDC_LIMIT_JOURNAL_SCHEMA,
        orders: [...orders.values()].map(clone).sort((left, right) => left.order.order_id.localeCompare(right.order.order_id)),
      };
      return freeze({ ...core, snapshot_hash: agenticContractHash(core) });
    },
  });
}

export function verifyUnifiedUsdcLimitJournalSnapshot(snapshot) {
  return verifyJournalSnapshot(snapshot);
}

export function unifiedUsdcLimitCapability() {
  return freeze({
    schema_version: "ravenos.unified_usdc_limit_capability.v1",
    status: "paper_and_review",
    same_chain_limit_evaluation: true,
    cross_chain_limit_evaluation: true,
    exact_chain_local_capital_reservation: true,
    destination_arrival_recheck: true,
    all_in_executable_price_trigger: true,
    marked_price_trigger: false,
    verified_exit_required_for_buys: true,
    supported_canonical_usdc_chain_ids: Object.keys(CHAIN_TO_USDC_REGISTRY).sort(),
    unsupported_as_canonical_usdc: ["eip155:56", "eip155:4663"],
    execution_boundary: UNIFIED_USDC_LIMIT_EXECUTION_BOUNDARY,
  });
}
