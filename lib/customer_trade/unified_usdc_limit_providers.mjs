import bs58 from "bs58";

import { agenticContractHash } from "../agentic_trading/hashing.mjs";
import { normalizeAssetIdentity, normalizeChainIdentity } from "../agentic_trading/identity.mjs";
import {
  canonicalUsdcAssetForChain,
  verifyUnifiedUsdcLimitOrder,
} from "./unified_usdc_limit_orders.mjs";

export const UNIFIED_LIMIT_PROVIDER_QUOTE_REQUEST_SCHEMA = "ravenos.unified_limit_provider_quote_request.v1";
export const UNIFIED_LIMIT_PROVIDER_QUOTE_EVIDENCE_SCHEMA = "ravenos.unified_limit_provider_quote_evidence.v1";
export const UNIFIED_LIMIT_PROVIDER_CHAIN_EVIDENCE_SCHEMA = "ravenos.unified_limit_provider_chain_evidence.v1";

export const UNIFIED_LIMIT_PROVIDER_EXECUTION_BOUNDARY = Object.freeze({
  quote_request_only: true,
  order_construction: false,
  escrow_approval: false,
  resource_lock_registration: false,
  signing: false,
  submission: false,
  broadcast: false,
  autonomous_bridging: false,
  server_wallet: false,
});

export const UnifiedLimitProviderLimits = Object.freeze({
  maximum_supported_chain_rows: 128,
  maximum_quote_rows: 32,
  maximum_response_bytes: 1_048_576,
  maximum_timeout_ms: 20_000,
});

const SOLANA_MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const INTEGER_RE = /^(?:0|[1-9][0-9]{0,79})$/;
const SAFE_ID_RE = /^[A-Za-z0-9._:+\-/]{1,220}$/;

export const LifiIntentChainRegistry = Object.freeze({
  "eip155:1": Object.freeze({ provider_chain_id: "1", chain_type: "EVM", chain_type_code: 0x0000 }),
  "eip155:10": Object.freeze({ provider_chain_id: "10", chain_type: "EVM", chain_type_code: 0x0000 }),
  "eip155:56": Object.freeze({ provider_chain_id: "56", chain_type: "EVM", chain_type_code: 0x0000 }),
  "eip155:137": Object.freeze({ provider_chain_id: "137", chain_type: "EVM", chain_type_code: 0x0000 }),
  "eip155:8453": Object.freeze({ provider_chain_id: "8453", chain_type: "EVM", chain_type_code: 0x0000 }),
  "eip155:42161": Object.freeze({ provider_chain_id: "42161", chain_type: "EVM", chain_type_code: 0x0000 }),
  "eip155:43114": Object.freeze({ provider_chain_id: "43114", chain_type: "EVM", chain_type_code: 0x0000 }),
  "eip155:4663": Object.freeze({ provider_chain_id: "4663", chain_type: "EVM", chain_type_code: 0x0000 }),
  "solana:mainnet-beta": Object.freeze({
    provider_chain_id: "1151111081099710",
    chain_type: "SVM",
    chain_type_code: 0x0002,
    chain_reference: SOLANA_MAINNET_GENESIS_HASH,
  }),
});

function fail(code, details = null) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  throw error;
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
}

function required(value, field, maximum = 220) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) fail(`${field}_invalid`);
  return normalized;
}

function timestamp(value, field) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) fail(`${field}_invalid`);
  return new Date(parsed).toISOString();
}

function positiveInteger(value, field, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) fail(`${field}_invalid`);
  return parsed;
}

function exactInteger(value, field, { allowZero = false } = {}) {
  const normalized = String(value ?? "").trim();
  if (!INTEGER_RE.test(normalized) || (!allowZero && BigInt(normalized) === 0n)) fail(`${field}_invalid`);
  return BigInt(normalized).toString();
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

function chainId(value, field) {
  try {
    return normalizeChainIdentity(value).chain_id;
  } catch (error) {
    fail(`${field}_invalid`, String(error?.message || error));
  }
}

function exactAsset(value, field) {
  try {
    return normalizeAssetIdentity(value);
  } catch (error) {
    fail(`${field}_invalid`, String(error?.message || error));
  }
}

function bytesToHex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function unsignedBigEndianBytes(value) {
  let hex = BigInt(value).toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  return Uint8Array.from(hex.match(/../g).map((byte) => Number.parseInt(byte, 16)));
}

function fixedHex(value, bytes) {
  return Number(value).toString(16).padStart(bytes * 2, "0");
}

function addressBytes(canonicalChainId, address) {
  const chain = LifiIntentChainRegistry[canonicalChainId];
  if (!chain) fail("lifi_chain_unsupported");
  if (chain.chain_type === "EVM") {
    if (!EVM_ADDRESS_RE.test(address)) fail("lifi_evm_address_invalid");
    return Uint8Array.from(address.slice(2).match(/../g).map((byte) => Number.parseInt(byte, 16)));
  }
  if (chain.chain_type === "SVM") {
    if (!SOLANA_ADDRESS_RE.test(address)) fail("lifi_solana_address_invalid");
    const decoded = bs58.decode(address);
    if (decoded.length !== 32) fail("lifi_solana_address_invalid");
    return decoded;
  }
  fail("lifi_chain_type_unsupported");
}

function chainReferenceBytes(canonicalChainId) {
  const chain = LifiIntentChainRegistry[canonicalChainId];
  if (!chain) fail("lifi_chain_unsupported");
  if (chain.chain_type === "EVM") return unsignedBigEndianBytes(chain.provider_chain_id);
  const decoded = bs58.decode(chain.chain_reference);
  if (decoded.length !== 32) fail("lifi_chain_reference_invalid");
  return decoded;
}

export function encodeLifiInteroperableAddress({ chain_id, address } = {}) {
  const canonicalChainId = chainId(chain_id, "lifi_interoperable_chain_id");
  const chain = LifiIntentChainRegistry[canonicalChainId];
  if (!chain) fail("lifi_chain_unsupported");
  const reference = chainReferenceBytes(canonicalChainId);
  const target = addressBytes(canonicalChainId, required(address, "lifi_interoperable_address", 180));
  if (reference.length > 255 || target.length > 255) fail("lifi_interoperable_address_out_of_bounds");
  return `0x${fixedHex(1, 2)}${fixedHex(chain.chain_type_code, 2)}${fixedHex(reference.length, 1)}${bytesToHex(reference)}${fixedHex(target.length, 1)}${bytesToHex(target)}`.toLowerCase();
}

function sameAsset(left, right) {
  return left?.asset_id === right?.asset_id && agenticContractHash(left) === agenticContractHash(right);
}

function buildLifiQuoteRequest({
  order,
  source_chain_id,
  source_asset,
  provider_destination_asset,
  route_purpose,
  source_wallet_address,
  destination_wallet_address,
  requested_at,
} = {}) {
  if (!verifyUnifiedUsdcLimitOrder(order)) fail("limit_order_integrity_invalid");
  if (order.side !== "buy") fail("lifi_cross_chain_sell_not_supported");
  const sourceChainId = chainId(source_chain_id || source_asset?.chain_id, "lifi_source_chain_id");
  if (!order.allowed_funding_chain_ids.includes(sourceChainId)) fail("lifi_source_chain_not_allowed");
  const sourceAsset = exactAsset(source_asset, "lifi_source_asset");
  const canonical = canonicalUsdcAssetForChain(sourceChainId);
  if (!canonical || !sameAsset(canonical, sourceAsset)) fail("lifi_source_is_not_verified_canonical_usdc");
  const orderDestinationAsset = exactAsset(order.destination_asset, "lifi_order_destination_asset");
  const destinationAsset = exactAsset(provider_destination_asset || order.destination_asset, "lifi_provider_destination_asset");
  if (destinationAsset.chain_id !== orderDestinationAsset.chain_id) fail("lifi_provider_destination_chain_mismatch");
  const sourceProviderChain = LifiIntentChainRegistry[sourceChainId];
  const destinationProviderChain = LifiIntentChainRegistry[destinationAsset.chain_id];
  if (!sourceProviderChain || !destinationProviderChain) fail("lifi_chain_unsupported");
  const sourceUser = encodeLifiInteroperableAddress({ chain_id: sourceChainId, address: source_wallet_address });
  const destinationUser = encodeLifiInteroperableAddress({ chain_id: destinationAsset.chain_id, address: destination_wallet_address });
  const sourceAssetAddress = encodeLifiInteroperableAddress({ chain_id: sourceChainId, address: sourceAsset.reference });
  const destinationAssetAddress = encodeLifiInteroperableAddress({ chain_id: destinationAsset.chain_id, address: destinationAsset.reference });
  const requestedAt = timestamp(requested_at, "lifi_quote_requested_at");
  const core = {
    schema_version: UNIFIED_LIMIT_PROVIDER_QUOTE_REQUEST_SCHEMA,
    provider_id: "lifi_intents_v1",
    endpoint: "https://order.li.fi/quote/request",
    method: "POST",
    requested_at: requestedAt,
    order_id: order.order_id,
    order_hash: order.order_hash,
    route_purpose: required(route_purpose, "lifi_route_purpose", 80),
    source_chain_id: sourceChainId,
    destination_chain_id: destinationAsset.chain_id,
    source_asset_id: sourceAsset.asset_id,
    order_destination_asset_id: orderDestinationAsset.asset_id,
    destination_asset_id: destinationAsset.asset_id,
    source_wallet_interoperable_address: sourceUser,
    destination_wallet_interoperable_address: destinationUser,
    body: {
      user: sourceUser,
      intent: {
        intentType: "oif-swap",
        inputs: [{
          user: sourceUser,
          asset: sourceAssetAddress,
          amount: exactInteger(order.trade_notional_usdc_micros, "lifi_input_amount"),
        }],
        outputs: [{
          receiver: destinationUser,
          asset: destinationAssetAddress,
          amount: null,
        }],
        swapType: "exact-input",
      },
      supportedTypes: ["oif-escrow-v0"],
    },
    semantics: {
      provider_quote_is_immediate_route_evidence: true,
      provider_quote_is_not_a_raven_limit_trigger: true,
      output_is_expected_after_provider_route_costs: true,
      destination_swap_required: destinationAsset.asset_id !== orderDestinationAsset.asset_id,
      funding_transaction_gas_priced: false,
      raven_fee_priced: false,
      reverse_exit_priced: false,
      all_in_economics_complete: false,
    },
    execution_boundary: UNIFIED_LIMIT_PROVIDER_EXECUTION_BOUNDARY,
  };
  return seal(core, "quote_request_hash");
}

export function buildLifiIntentQuoteRequest(input = {}) {
  return buildLifiQuoteRequest({
    ...input,
    provider_destination_asset: input.order?.destination_asset,
    route_purpose: "direct_token_delivery",
  });
}

export function buildLifiFundingQuoteRequest({ destination_funding_asset, ...input } = {}) {
  const asset = exactAsset(destination_funding_asset, "lifi_destination_funding_asset");
  if (asset.kind !== "stablecoin" || asset.verification_state !== "verified") {
    fail("lifi_destination_funding_asset_unverified");
  }
  return buildLifiQuoteRequest({
    ...input,
    provider_destination_asset: asset,
    route_purpose: "cross_chain_funding",
  });
}

export function verifyLifiIntentQuoteRequest(request) {
  return verifySeal(request, UNIFIED_LIMIT_PROVIDER_QUOTE_REQUEST_SCHEMA, "quote_request_hash");
}

function normalizeLifiQuoteRow(row, request, observedAt, index) {
  const source = row && typeof row === "object" ? row : {};
  const preview = source.preview && typeof source.preview === "object" ? source.preview : {};
  const inputs = Array.isArray(preview.inputs) ? preview.inputs : [];
  const outputs = Array.isArray(preview.outputs) ? preview.outputs : [];
  const reasons = [];
  if (inputs.length !== 1 || outputs.length !== 1) reasons.push("quote_shape_invalid");
  const input = inputs[0] || {};
  const output = outputs[0] || {};
  if (String(input.user || "").toLowerCase() !== request.body.user) reasons.push("quote_user_mismatch");
  if (String(input.asset || "").toLowerCase() !== request.body.intent.inputs[0].asset) reasons.push("quote_input_asset_mismatch");
  if (String(input.amount || "") !== request.body.intent.inputs[0].amount) reasons.push("quote_input_amount_mismatch");
  if (String(output.receiver || "").toLowerCase() !== request.body.intent.outputs[0].receiver) reasons.push("quote_receiver_mismatch");
  if (String(output.asset || "").toLowerCase() !== request.body.intent.outputs[0].asset) reasons.push("quote_output_asset_mismatch");
  let outputAmount = null;
  try {
    outputAmount = exactInteger(output.amount, `lifi_quote_${index}_output_amount`);
  } catch {
    reasons.push("quote_output_amount_invalid");
  }
  const validUntilSeconds = Number(source.validUntil);
  const validUntil = Number.isSafeInteger(validUntilSeconds) && validUntilSeconds > 0
    ? new Date(validUntilSeconds * 1_000).toISOString()
    : null;
  if (!validUntil || Date.parse(validUntil) <= Date.parse(observedAt)) reasons.push("quote_expired");
  const quoteId = String(source.quoteId || "").trim();
  if (!SAFE_ID_RE.test(quoteId)) reasons.push("quote_id_invalid");
  const failureHandling = String(source.failureHandling || "").trim();
  if (failureHandling && !SAFE_ID_RE.test(failureHandling)) reasons.push("failure_handling_invalid");
  const exclusiveSolver = String(source.metadata?.exclusiveFor || "").trim();
  if (exclusiveSolver && !SAFE_ID_RE.test(exclusiveSolver)) reasons.push("exclusive_solver_invalid");
  return {
    quote_id: SAFE_ID_RE.test(quoteId) ? quoteId : null,
    expected_output_atomic: outputAmount,
    valid_until: validUntil,
    partial_fill: source.partialFill === true,
    failure_handling: failureHandling && SAFE_ID_RE.test(failureHandling) ? failureHandling : null,
    exclusive_solver: exclusiveSolver && SAFE_ID_RE.test(exclusiveSolver) ? exclusiveSolver : null,
    eligible: reasons.length === 0,
    refusal_reasons: [...new Set(reasons)].sort(),
  };
}

export function normalizeLifiIntentQuoteEvidence({ request, response, observed_at, retrieved_at } = {}) {
  if (!verifyLifiIntentQuoteRequest(request)) fail("lifi_quote_request_integrity_invalid");
  const observedAt = timestamp(observed_at, "lifi_quote_observed_at");
  const retrievedAt = timestamp(retrieved_at || observed_at, "lifi_quote_retrieved_at");
  if (Date.parse(retrievedAt) < Date.parse(observedAt)) fail("lifi_quote_retrieval_before_observation");
  const rows = Array.isArray(response?.quotes) ? response.quotes : [];
  if (rows.length > UnifiedLimitProviderLimits.maximum_quote_rows) fail("lifi_quote_rows_out_of_bounds");
  const candidates = rows.map((row, index) => normalizeLifiQuoteRow(row, request, observedAt, index));
  const eligible = candidates
    .filter((row) => row.eligible)
    .sort((left, right) => {
      const amount = BigInt(right.expected_output_atomic) - BigInt(left.expected_output_atomic);
      if (amount !== 0n) return amount > 0n ? 1 : -1;
      if (left.valid_until !== right.valid_until) return Date.parse(right.valid_until) - Date.parse(left.valid_until);
      return left.quote_id.localeCompare(right.quote_id);
    });
  const selected = eligible[0] || null;
  const core = {
    schema_version: UNIFIED_LIMIT_PROVIDER_QUOTE_EVIDENCE_SCHEMA,
    provider_id: "lifi_intents_v1",
    order_id: request.order_id,
    order_hash: request.order_hash,
    quote_request_hash: request.quote_request_hash,
    route_purpose: request.route_purpose,
    order_destination_asset_id: request.order_destination_asset_id,
    provider_destination_asset_id: request.destination_asset_id,
    observed_at: observedAt,
    retrieved_at: retrievedAt,
    route_state: selected ? "provider_quote_available" : "unavailable",
    selected_quote_id: selected?.quote_id || null,
    selected_expected_output_atomic: selected?.expected_output_atomic || null,
    expires_at: selected?.valid_until || null,
    candidates,
    semantics: {
      provider_ordering_used: false,
      deterministic_selection: "maximum_expected_output_then_longest_validity_then_quote_id",
      provider_output_net_of_route_costs: Boolean(selected),
      funding_transaction_gas_usdc: null,
      raven_fee_usdc: null,
      reverse_exit_evidence: null,
      all_in_economics_complete: false,
      usable_for_limit_trigger: false,
      incomplete_reasons: selected
        ? [
          "funding_transaction_gas_unknown",
          "raven_fee_not_applied",
          ...(request.semantics.destination_swap_required ? ["destination_swap_quote_required"] : []),
          "reverse_exit_unavailable",
        ]
        : ["provider_quote_unavailable"],
    },
    execution_boundary: UNIFIED_LIMIT_PROVIDER_EXECUTION_BOUNDARY,
  };
  return seal(core, "quote_evidence_hash");
}

export function verifyLifiIntentQuoteEvidence(evidence) {
  return verifySeal(evidence, UNIFIED_LIMIT_PROVIDER_QUOTE_EVIDENCE_SCHEMA, "quote_evidence_hash");
}

export function normalizeLifiSupportedChainsEvidence({ response, observed_at } = {}) {
  const observedAt = timestamp(observed_at, "lifi_chains_observed_at");
  const rows = Array.isArray(response) ? response : [];
  if (rows.length > UnifiedLimitProviderLimits.maximum_supported_chain_rows) fail("lifi_supported_chain_rows_out_of_bounds");
  const byProviderId = new Map(Object.entries(LifiIntentChainRegistry).map(([id, row]) => [row.provider_chain_id, id]));
  const supported = [];
  for (const [index, row] of rows.entries()) {
    const providerChainId = exactInteger(row?.chainId, `lifi_chain_${index}_id`);
    const canonicalChainId = byProviderId.get(providerChainId) || null;
    if (!canonicalChainId) continue;
    const expected = LifiIntentChainRegistry[canonicalChainId];
    const chainType = required(row?.chainType, `lifi_chain_${index}_type`, 16).toUpperCase();
    if (chainType !== expected.chain_type) fail("lifi_supported_chain_type_mismatch");
    supported.push({
      chain_id: canonicalChainId,
      provider_chain_id: providerChainId,
      provider_name: required(row?.name, `lifi_chain_${index}_name`, 80),
      chain_type: chainType,
    });
  }
  supported.sort((left, right) => left.chain_id.localeCompare(right.chain_id));
  return seal({
    schema_version: UNIFIED_LIMIT_PROVIDER_CHAIN_EVIDENCE_SCHEMA,
    provider_id: "lifi_intents_v1",
    observed_at: observedAt,
    supported_chains: supported,
    desired_lane_support: Object.fromEntries(
      ["eip155:1", "eip155:56", "eip155:8453", "eip155:4663", "solana:mainnet-beta"]
        .map((id) => [id, supported.some((row) => row.chain_id === id)]),
    ),
    live_order_submission_enabled: false,
    execution_boundary: UNIFIED_LIMIT_PROVIDER_EXECUTION_BOUNDARY,
  }, "chain_evidence_hash");
}

export function verifyLifiSupportedChainsEvidence(evidence) {
  return verifySeal(evidence, UNIFIED_LIMIT_PROVIDER_CHAIN_EVIDENCE_SCHEMA, "chain_evidence_hash");
}

async function boundedJsonResponse(response, maximumBytes) {
  const contentLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) fail("lifi_response_too_large");
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) fail("lifi_response_too_large");
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    fail("lifi_response_json_invalid");
  }
  if (!response.ok) {
    const providerCode = String(payload?.code || payload?.error || "").trim();
    fail("lifi_provider_error", {
      status: response.status,
      provider_code: SAFE_ID_RE.test(providerCode) ? providerCode : null,
    });
  }
  return payload;
}

export async function requestLifiIntentQuoteEvidence({
  request,
  fetch_impl = globalThis.fetch,
  clock = () => Date.now(),
  timeout_ms = 8_000,
  maximum_response_bytes = UnifiedLimitProviderLimits.maximum_response_bytes,
} = {}) {
  if (!verifyLifiIntentQuoteRequest(request)) fail("lifi_quote_request_integrity_invalid");
  if (typeof fetch_impl !== "function" || typeof clock !== "function") fail("lifi_provider_dependency_invalid");
  const timeoutMs = positiveInteger(timeout_ms, "lifi_timeout_ms", UnifiedLimitProviderLimits.maximum_timeout_ms);
  const maximumBytes = positiveInteger(maximum_response_bytes, "lifi_maximum_response_bytes", UnifiedLimitProviderLimits.maximum_response_bytes);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const observedAt = new Date(clock()).toISOString();
  try {
    const response = await fetch_impl(request.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    const payload = await boundedJsonResponse(response, maximumBytes);
    return normalizeLifiIntentQuoteEvidence({
      request,
      response: payload,
      observed_at: observedAt,
      retrieved_at: new Date(clock()).toISOString(),
    });
  } catch (error) {
    if (error?.name === "AbortError") fail("lifi_provider_timeout");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function unifiedUsdcLimitProviderCapabilities() {
  return freeze({
    schema_version: "ravenos.unified_usdc_limit_provider_capabilities.v1",
    checked_against_public_docs_at: "2026-09-03T00:00:00.000Z",
    providers: {
      raven_route_watch: {
        status: "paper_and_review_ready",
        same_chain_limit_evaluation: true,
        cross_chain_limit_evaluation: true,
        unattended_execution: false,
        reason: "wallet_or_bounded_session_authorization_required_at_trigger",
      },
      lifi_intents_v1: {
        status: "quote_evidence_ready_submission_disabled",
        supported_chain_ids_require_current_provider_evidence: true,
        known_chain_ids: Object.keys(LifiIntentChainRegistry).sort(),
        same_chain_intents: true,
        cross_chain_intents: true,
        source_capital_model: "single_origin_chain_per_order",
        non_atomic_destination_swap_supported_as_separate_leg: true,
        settlement_models: ["per_intent_escrow", "compact_resource_lock"],
        raven_custody: false,
        user_funds_locked_by_external_contract: true,
        user_wallet_signature_required: true,
        order_submission: false,
        live_enabled: false,
      },
      jupiter_trigger_v2: {
        status: "not_selected",
        limit_orders: true,
        live_enabled: false,
        refusal_reason: "provider_managed_custodial_vault_conflicts_with_raven_noncustodial_boundary",
      },
      zerox_v2: {
        status: "market_and_cross_chain_quote_provider_only",
        limit_order_api_integrated: false,
        live_limit_enabled: false,
      },
    },
    execution_boundary: UNIFIED_LIMIT_PROVIDER_EXECUTION_BOUNDARY,
  });
}
