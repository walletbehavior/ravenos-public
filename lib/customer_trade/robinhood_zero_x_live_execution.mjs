import { createHash } from "node:crypto";

import { customerTradeFeeSchedule, feePolicyFor } from "./fee_policy.mjs";

export const ROBINHOOD_ZERO_X_CHAIN_ID = 4663;
export const ROBINHOOD_ZERO_X_CANONICAL_CHAIN_ID = "eip155:4663";
export const ROBINHOOD_ZERO_X_ALLOWANCE_HOLDER = "0x0000000000001ff3684f28c67538d4d072c22734";
export const ROBINHOOD_ZERO_X_CAPABILITY_SCHEMA = "ravenos.robinhood_zero_x_capability.v1";
export const ROBINHOOD_ZERO_X_QUOTE_REQUEST_SCHEMA = "ravenos.robinhood_zero_x_quote_request.v1";
export const ROBINHOOD_ZERO_X_UNSIGNED_QUOTE_SCHEMA = "ravenos.robinhood_zero_x_unsigned_quote.v1";

const ZERO_X_SPOT_FEE_SCHEDULE = customerTradeFeeSchedule()["0x:spot"];
if (!ZERO_X_SPOT_FEE_SCHEDULE) throw new Error("zero_x_fee_schedule_missing");

export const RobinhoodZeroXFeeSchedule = Object.freeze({
  free: ZERO_X_SPOT_FEE_SCHEDULE.free_fee_bps,
  pro: ZERO_X_SPOT_FEE_SCHEDULE.pro_fee_bps,
});

// This module validates provider-created unsigned transaction material for a
// connected customer wallet. It intentionally has no signing, submission,
// broadcasting, custody, approval construction, or arbitrary-call authority.
export const RobinhoodZeroXExecutionAuthorization = Object.freeze({
  quote_review: true,
  provider_unsigned_transaction_validation: true,
  connected_wallet_signature_required: true,
  raven_signing: false,
  private_key_access: false,
  custody: false,
  approval_transaction_construction: false,
  transaction_submission: false,
  broadcasting: false,
  autonomous_execution: false,
});

const DEFAULT_ENDPOINT = "https://api.0x.org/swap/allowance-holder/quote";
const DEFAULT_QUOTE_TTL_MS = 8_000;
const MIN_QUOTE_TTL_MS = 2_000;
const MAX_QUOTE_TTL_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 6_000;
const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const NATIVE_ETH = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ACCESS_TIERS = new Set(Object.keys(RobinhoodZeroXFeeSchedule));
const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FORBIDDEN_ORDER_KEYS = /(?:private|secret|seed|signature|signed|broadcast|submission|authorization|calldata|transaction_data|swap_fee|fee_bps|fee_recipient|fee_token)/i;

function fail(code, details = null) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  throw error;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonicalize(value[key])]));
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function enabled(value) {
  return TRUE_VALUES.has(String(value ?? "").trim().toLowerCase());
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function exactInteger(value, field, { minimum = 0n, positive = false } = {}) {
  const raw = String(value ?? "").trim();
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) fail(`${field}_invalid`);
  const parsed = BigInt(raw);
  if (parsed < minimum || (positive && parsed === 0n)) fail(`${field}_invalid`);
  return parsed;
}

function exactAddress(value, field, { allowNative = false } = {}) {
  const address = String(value ?? "").trim().toLowerCase();
  if (!EVM_ADDRESS_RE.test(address) || address === ZERO_ADDRESS || (!allowNative && address === NATIVE_ETH)) {
    fail(`${field}_invalid`);
  }
  return address;
}

function exactChain(value) {
  const normalized = String(value ?? ROBINHOOD_ZERO_X_CHAIN_ID).trim().toLowerCase();
  if (!new Set([String(ROBINHOOD_ZERO_X_CHAIN_ID), ROBINHOOD_ZERO_X_CANONICAL_CHAIN_ID, "robinhood", "robinhood-chain"]).has(normalized)) {
    fail("robinhood_zero_x_chain_not_supported");
  }
  return ROBINHOOD_ZERO_X_CHAIN_ID;
}

function exactTimestamp(value, field) {
  const parsed = Date.parse(String(value ?? ""));
  if (!Number.isFinite(parsed)) fail(`${field}_invalid`);
  return Object.freeze({ millis: parsed, iso: new Date(parsed).toISOString() });
}

function isoFromMillis(value, field) {
  const millis = Number(value);
  const date = new Date(millis);
  if (!Number.isFinite(millis) || !Number.isFinite(date.getTime())) fail(`${field}_invalid`);
  return Object.freeze({ millis, iso: date.toISOString() });
}

function exactEndpoint(value) {
  let url;
  try {
    url = new URL(String(value || DEFAULT_ENDPOINT));
  } catch {
    fail("zero_x_endpoint_invalid");
  }
  if (
    url.protocol !== "https:"
    || url.origin !== "https://api.0x.org"
    || url.username
    || url.password
    || url.search
    || url.hash
    || url.pathname.replace(/\/$/, "") !== "/swap/allowance-holder/quote"
  ) fail("zero_x_endpoint_invalid");
  url.pathname = "/swap/allowance-holder/quote";
  return url.toString();
}

function apiKeyValid(value) {
  const key = String(value ?? "").trim();
  return key.length >= 8 && key.length <= 512 && /^[\x21-\x7e]+$/.test(key);
}

function feeRecipientOrNull(value) {
  try {
    return exactAddress(value, "zero_x_fee_recipient");
  } catch {
    return null;
  }
}

function assertNoAuthorityInput(input) {
  for (const key of Object.keys(input || {})) {
    const compactKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (
      FORBIDDEN_ORDER_KEYS.test(key)
      || /(?:private|secret|seed|signature|signed|broadcast|submission|authorization|calldata|transactiondata|swapfee|feebps|feerecipient|feetoken)/.test(compactKey)
    ) fail(`zero_x_order_field_forbidden:${key}`);
  }
}

function normalizeAccessTier(value) {
  const tier = String(value || "free").trim().toLowerCase();
  if (!ACCESS_TIERS.has(tier)) fail("zero_x_access_tier_invalid");
  return tier;
}

function normalizeSlippage(value) {
  const parsed = Number(value ?? 100);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 5_000) fail("zero_x_slippage_bps_invalid");
  return parsed;
}

function normalizeHexData(value, field) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!/^0x[0-9a-f]+$/.test(raw) || raw.length < 10 || raw.length % 2 !== 0 || raw.length > 131_074) fail(`${field}_invalid`);
  return raw;
}

function normalizeEndpointForCapability(value) {
  try {
    return { endpoint: exactEndpoint(value), error: null };
  } catch (error) {
    return { endpoint: null, error: error.code || "zero_x_endpoint_invalid" };
  }
}

function configState(env = {}) {
  const quoteRequested = enabled(env.RAVENOS_ROBINHOOD_ZEROX_QUOTE_ENABLE);
  const feeRequested = enabled(env.RAVENOS_ROBINHOOD_ZEROX_FEE_ENABLE);
  const endpoint = normalizeEndpointForCapability(env.RAVENOS_ROBINHOOD_ZEROX_QUOTE_ENDPOINT || DEFAULT_ENDPOINT);
  const apiKeyConfigured = apiKeyValid(env.RAVENOS_ZEROX_API_KEY);
  const feeRecipient = feeRecipientOrNull(env.RAVENOS_ROBINHOOD_ZEROX_FEE_RECIPIENT);
  const feeTokenSide = String(env.RAVENOS_ROBINHOOD_ZEROX_FEE_TOKEN_SIDE || "sell").trim().toLowerCase();
  const feeTokenSideValid = new Set(["buy", "sell"]).has(feeTokenSide);
  const quoteReasons = [];
  if (!quoteRequested) quoteReasons.push("quote_review_disabled");
  if (endpoint.error) quoteReasons.push(endpoint.error);
  if (!apiKeyConfigured) quoteReasons.push("zero_x_api_key_missing_or_invalid");
  const feeReasons = [];
  if (feeRequested && !feeRecipient) feeReasons.push("zero_x_fee_recipient_missing_or_invalid");
  if (feeRequested && !feeTokenSideValid) feeReasons.push("zero_x_fee_token_side_invalid");
  const quoteConfigured = !endpoint.error && apiKeyConfigured;
  const feeConfigured = !feeRequested || (Boolean(feeRecipient) && feeTokenSideValid);
  return {
    quoteRequested,
    quoteConfigured,
    quoteAvailable: quoteRequested && quoteConfigured,
    quoteReasons,
    feeRequested,
    feeConfigured,
    feeReasons,
    endpoint: endpoint.endpoint,
    apiKeyConfigured,
    feeRecipient,
    feeTokenSide,
    quoteTtlMs: boundedInteger(env.RAVENOS_ROBINHOOD_ZEROX_QUOTE_TTL_MS, DEFAULT_QUOTE_TTL_MS, MIN_QUOTE_TTL_MS, MAX_QUOTE_TTL_MS),
    timeoutMs: boundedInteger(env.RAVENOS_ROBINHOOD_ZEROX_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
  };
}

export function resolveRobinhoodZeroXCapability(env = {}) {
  const config = configState(env);
  return deepFreeze({
    schema_version: ROBINHOOD_ZERO_X_CAPABILITY_SCHEMA,
    provider: "0x_swap_api_v2",
    chain_id: ROBINHOOD_ZERO_X_CHAIN_ID,
    canonical_chain_id: ROBINHOOD_ZERO_X_CANONICAL_CHAIN_ID,
    venue: "robinhood-chain",
    endpoint: config.endpoint,
    state: !config.quoteRequested ? "disabled" : config.quoteAvailable ? "quote_review_available" : "misconfigured",
    unavailable_reasons: config.quoteReasons,
    api_key_configured: config.apiKeyConfigured,
    fee_recipient_configured: Boolean(config.feeRecipient),
    quote_review_enabled: config.quoteAvailable,
    unsigned_transaction_validation_available: config.quoteAvailable,
    wallet_handoff_state: "not_integrated",
    live_execution_enabled: false,
    fee_collection_enabled: config.quoteAvailable && config.feeRequested && config.feeConfigured,
    fee_state: !config.feeRequested ? "disabled" : config.feeConfigured ? "enabled" : "misconfigured",
    fee_configuration_ready: config.feeRequested && config.feeConfigured,
    fee_unavailable_reasons: config.feeReasons,
    fee_schedule: Object.freeze({
      free_fee_bps: RobinhoodZeroXFeeSchedule.free,
      pro_fee_bps: RobinhoodZeroXFeeSchedule.pro,
      fee_method: "zero_x_swap_integrator_fee",
      fee_token_policy: "server_selected_exact_buy_or_sell_token",
      provider_parameters: Object.freeze(["swapFeeRecipient", "swapFeeBps", "swapFeeToken"]),
    }),
    execution_boundary: RobinhoodZeroXExecutionAuthorization,
  });
}

export function createRobinhoodZeroXQuoteRequest(input = {}, {
  access_tier: accessTier = "free",
  fee_enabled: feeEnabled = false,
  fee_recipient: feeRecipient,
  fee_token_side: feeTokenSide = "sell",
  now = Date.now(),
  ttl_ms: ttlMs = DEFAULT_QUOTE_TTL_MS,
} = {}) {
  assertNoAuthorityInput(input);
  const chainId = exactChain(input.chain_id ?? input.chainId);
  const sellToken = exactAddress(input.sell_token ?? input.sellToken, "zero_x_sell_token", { allowNative: true });
  const buyToken = exactAddress(input.buy_token ?? input.buyToken, "zero_x_buy_token", { allowNative: true });
  if (sellToken === buyToken) fail("zero_x_token_pair_invalid");
  const taker = exactAddress(input.taker ?? input.wallet_address, "zero_x_taker");
  if (input.recipient !== undefined && exactAddress(input.recipient, "zero_x_recipient") !== taker) fail("zero_x_recipient_must_equal_taker");
  const sellAmount = exactInteger(input.sell_amount ?? input.sellAmount, "zero_x_sell_amount", { positive: true });
  const tier = normalizeAccessTier(accessTier);
  const configuredFeeBps = RobinhoodZeroXFeeSchedule[tier];
  const collectionEnabled = feeEnabled === true;
  let fee;
  if (collectionEnabled) {
    const side = String(feeTokenSide || "").trim().toLowerCase();
    if (!new Set(["buy", "sell"]).has(side)) fail("zero_x_fee_token_side_invalid");
    const recipient = exactAddress(feeRecipient, "zero_x_fee_recipient");
    const feeToken = side === "buy" ? buyToken : sellToken;
    if (feeToken !== sellToken && feeToken !== buyToken) fail("zero_x_integrator_fee_token_not_in_pair");
    // The live provider proof covers native ETH as the exact sell-token fee.
    // A native buy-token/output fee remains unproven and therefore blocked.
    if (side === "buy" && feeToken === NATIVE_ETH) fail("zero_x_native_buy_token_integrator_fee_not_supported");
    const feePolicy = feePolicyFor({
      provider: "0x",
      trade_type: "spot",
      access_tier: tier,
      enabled: true,
      fee_recipient: recipient,
      fee_token: feeToken,
    });
    if (feePolicy.enabled !== true || feePolicy.fee_bps !== configuredFeeBps) fail("zero_x_fee_policy_unavailable");
    const expectedFee = side === "sell"
      ? (sellAmount * BigInt(feePolicy.fee_bps)) / 10_000n
      : null;
    if (expectedFee === 0n) fail("zero_x_integrator_fee_rounds_to_zero");
    fee = {
      enabled: true,
      state: "enabled",
      method: "zero_x_swap_integrator_fee",
      configured_fee_bps: configuredFeeBps,
      fee_bps: feePolicy.fee_bps,
      fee_token_side: side,
      fee_token: feeToken,
      fee_recipient: recipient,
      expected_fee_amount_base_units: expectedFee === null ? null : expectedFee.toString(),
      amount_verification: side === "sell"
        ? "independently_computed_from_sell_amount"
        : "provider_quoted_buy_token_amount",
    };
  } else {
    fee = {
      enabled: false,
      state: "disabled",
      method: "zero_x_swap_integrator_fee",
      configured_fee_bps: configuredFeeBps,
      fee_bps: 0,
      fee_token_side: null,
      fee_token: null,
      fee_recipient: null,
      expected_fee_amount_base_units: "0",
      amount_verification: "not_applicable",
    };
  }
  const requestTime = isoFromMillis(now, "zero_x_request_time");
  const nowMs = requestTime.millis;
  const createdAt = requestTime.iso;
  const boundedTtl = boundedInteger(ttlMs, DEFAULT_QUOTE_TTL_MS, MIN_QUOTE_TTL_MS, MAX_QUOTE_TTL_MS);
  const binding = {
    schema_version: ROBINHOOD_ZERO_X_QUOTE_REQUEST_SCHEMA,
    provider: "0x_swap_api_v2",
    endpoint_kind: "allowance_holder_firm_quote",
    chain_id: chainId,
    canonical_chain_id: ROBINHOOD_ZERO_X_CANONICAL_CHAIN_ID,
    sell_token: sellToken,
    buy_token: buyToken,
    sell_amount_base_units: sellAmount.toString(),
    taker,
    recipient: taker,
    slippage_bps: normalizeSlippage(input.slippage_bps ?? input.slippageBps),
    access_tier: tier,
    fee,
    created_at: createdAt,
    expires_at: new Date(nowMs + boundedTtl).toISOString(),
  };
  const requestHash = digest(binding);
  const providerParameters = {
    chainId: String(chainId),
    sellToken,
    buyToken,
    sellAmount: sellAmount.toString(),
    taker,
    recipient: taker,
    slippageBps: String(binding.slippage_bps),
  };
  if (collectionEnabled) {
    providerParameters.swapFeeRecipient = fee.fee_recipient;
    providerParameters.swapFeeBps = String(fee.fee_bps);
    providerParameters.swapFeeToken = fee.fee_token;
  }
  return deepFreeze({
    ...binding,
    request_id: `zxr_${requestHash.slice(0, 32)}`,
    request_hash: requestHash,
    provider_parameters: providerParameters,
  });
}

function verifyRequestFee(request) {
  const fee = request?.fee;
  if (!fee || typeof fee !== "object" || typeof fee.enabled !== "boolean") fail("zero_x_fee_binding_invalid");
  const configuredFeeBps = RobinhoodZeroXFeeSchedule[normalizeAccessTier(request.access_tier)];
  if (fee.configured_fee_bps !== configuredFeeBps || fee.method !== "zero_x_swap_integrator_fee") {
    fail("zero_x_fee_binding_invalid");
  }
  if (fee.enabled === false) {
    if (
      fee.state !== "disabled"
      || fee.fee_bps !== 0
      || fee.fee_token_side !== null
      || fee.fee_token !== null
      || fee.fee_recipient !== null
      || fee.expected_fee_amount_base_units !== "0"
      || fee.amount_verification !== "not_applicable"
    ) fail("zero_x_fee_binding_invalid");
    return;
  }
  const side = String(fee.fee_token_side || "").trim().toLowerCase();
  if (!new Set(["buy", "sell"]).has(side) || fee.state !== "enabled" || fee.fee_bps !== configuredFeeBps) {
    fail("zero_x_fee_binding_invalid");
  }
  const expectedToken = side === "buy" ? request.buy_token : request.sell_token;
  if (fee.fee_token !== expectedToken || (fee.fee_token !== request.buy_token && fee.fee_token !== request.sell_token)) {
    fail("zero_x_fee_binding_invalid");
  }
  exactAddress(fee.fee_recipient, "zero_x_fee_recipient");
  if (side === "buy" && fee.fee_token === NATIVE_ETH) fail("zero_x_native_buy_token_integrator_fee_not_supported");
  if (side === "sell") {
    const expected = (BigInt(request.sell_amount_base_units) * BigInt(fee.fee_bps)) / 10_000n;
    if (
      expected === 0n
      || fee.expected_fee_amount_base_units !== expected.toString()
      || fee.amount_verification !== "independently_computed_from_sell_amount"
    ) fail("zero_x_fee_binding_invalid");
  } else if (
    fee.expected_fee_amount_base_units !== null
    || fee.amount_verification !== "provider_quoted_buy_token_amount"
  ) fail("zero_x_fee_binding_invalid");
}

function verifyRequest(request, now) {
  if (request?.schema_version !== ROBINHOOD_ZERO_X_QUOTE_REQUEST_SCHEMA) fail("zero_x_quote_request_required");
  if (request.chain_id !== ROBINHOOD_ZERO_X_CHAIN_ID || request.canonical_chain_id !== ROBINHOOD_ZERO_X_CANONICAL_CHAIN_ID) {
    fail("zero_x_quote_request_chain_mismatch");
  }
  const { request_id: ignoredId, request_hash: ignoredHash, provider_parameters: ignoredParameters, ...binding } = request;
  void ignoredId;
  void ignoredHash;
  void ignoredParameters;
  if (digest(binding) !== request.request_hash || request.request_id !== `zxr_${request.request_hash.slice(0, 32)}`) {
    fail("zero_x_quote_request_hash_mismatch");
  }
  verifyRequestFee(request);
  const expectedParameters = {
    chainId: String(request.chain_id),
    sellToken: request.sell_token,
    buyToken: request.buy_token,
    sellAmount: request.sell_amount_base_units,
    taker: request.taker,
    recipient: request.recipient,
    slippageBps: String(request.slippage_bps),
  };
  if (request.fee.enabled) {
    expectedParameters.swapFeeRecipient = request.fee.fee_recipient;
    expectedParameters.swapFeeBps = String(request.fee.fee_bps);
    expectedParameters.swapFeeToken = request.fee.fee_token;
  }
  if (digest(request.provider_parameters) !== digest(expectedParameters)) fail("zero_x_provider_parameters_mismatch");
  if (exactTimestamp(request.expires_at, "zero_x_quote_request_expiry").millis <= now) fail("zero_x_quote_request_expired");
}

function normalizeIntegratorFee(fees, request) {
  const legacy = fees?.integratorFee ?? null;
  if (fees?.integratorFees !== null && fees?.integratorFees !== undefined && !Array.isArray(fees.integratorFees)) {
    fail("zero_x_integrator_fee_records_invalid");
  }
  const current = Array.isArray(fees?.integratorFees) ? fees.integratorFees : [];
  if (current.length > 1) fail("zero_x_integrator_fee_count_mismatch");
  if (request.fee.enabled !== true) {
    if (legacy || current.length) fail("zero_x_integrator_fee_unexpected");
    return Object.freeze({
      enabled: false,
      state: "disabled",
      amount: "0",
      token: null,
      type: null,
      recipient: null,
      configured_fee_bps: request.fee.configured_fee_bps,
      fee_bps: 0,
      collection_state: "disabled",
      amount_verification: "not_applicable",
      amount_independently_verified: true,
    });
  }
  const candidate = legacy || current[0] || null;
  if (!candidate) fail("zero_x_integrator_fee_missing");
  const normalized = {
    amount: exactInteger(candidate.amount, "zero_x_integrator_fee_amount", { positive: true }).toString(),
    token: exactAddress(candidate.token, "zero_x_integrator_fee_token", { allowNative: true }),
    type: String(candidate.type || "").trim().toLowerCase(),
  };
  if (legacy && current[0]) {
    const second = {
      amount: exactInteger(current[0].amount, "zero_x_integrator_fee_amount").toString(),
      token: exactAddress(current[0].token, "zero_x_integrator_fee_token", { allowNative: true }),
      type: String(current[0].type || "").trim().toLowerCase(),
    };
    if (digest(normalized) !== digest(second)) fail("zero_x_integrator_fee_records_disagree");
  }
  if (
    normalized.token !== request.fee.fee_token
    || (normalized.token !== request.sell_token && normalized.token !== request.buy_token)
    || normalized.type !== "volume"
  ) fail("zero_x_integrator_fee_mismatch");
  const expectedAmount = request.fee.expected_fee_amount_base_units;
  if (expectedAmount !== null && normalized.amount !== expectedAmount) fail("zero_x_integrator_fee_mismatch");
  return Object.freeze({
    enabled: true,
    state: "enabled",
    ...normalized,
    recipient: request.fee.fee_recipient,
    configured_fee_bps: request.fee.configured_fee_bps,
    fee_bps: request.fee.fee_bps,
    collection_state: "provider_quote_bound",
    amount_verification: expectedAmount === null
      ? "provider_quoted_buy_token_amount"
      : "independently_computed_from_sell_amount",
    amount_independently_verified: expectedAmount !== null,
  });
}

function feeHashBinding(fee = {}) {
  return {
    enabled: fee.enabled,
    state: fee.state,
    amount: fee.amount,
    token: fee.token,
    type: fee.type,
    recipient: fee.recipient,
    configured_fee_bps: fee.configured_fee_bps,
    fee_bps: fee.fee_bps,
    collection_state: fee.collection_state,
    amount_verification: fee.amount_verification,
    amount_independently_verified: fee.amount_independently_verified,
  };
}

function normalizeOptionalProviderFee(value, field) {
  if (value === null || value === undefined) return null;
  return Object.freeze({
    amount: exactInteger(value.amount, `${field}_amount`).toString(),
    token: exactAddress(value.token, `${field}_token`, { allowNative: true }),
    type: String(value.type || field).trim().slice(0, 40),
  });
}

function normalizeIssues(payload, request, allowanceTarget, transactionTo) {
  const issues = payload?.issues;
  if (!issues || typeof issues !== "object" || !Array.isArray(issues.invalidSourcesPassed)) fail("zero_x_quote_issues_invalid");
  const invalidSources = issues.invalidSourcesPassed.map((value) => String(value).trim()).filter(Boolean);
  const sellNative = request.sell_token === NATIVE_ETH;
  let allowance;
  if (issues.allowance === null || issues.allowance === undefined) {
    allowance = Object.freeze({
      state: sellNative ? "not_applicable_native_asset" : "sufficient",
      spender: sellNative ? null : allowanceTarget,
      actual_amount_base_units: null,
      required_amount_base_units: sellNative ? null : request.sell_amount_base_units,
      approval_transaction_included: false,
    });
  } else {
    if (sellNative) fail("zero_x_native_allowance_unexpected");
    const spender = exactAddress(issues.allowance.spender, "zero_x_allowance_spender");
    const actual = exactInteger(issues.allowance.actual, "zero_x_allowance_actual");
    if (
      spender !== ROBINHOOD_ZERO_X_ALLOWANCE_HOLDER
      || allowanceTarget !== ROBINHOOD_ZERO_X_ALLOWANCE_HOLDER
      || transactionTo !== ROBINHOOD_ZERO_X_ALLOWANCE_HOLDER
    ) fail("zero_x_allowance_target_mismatch");
    if (actual >= BigInt(request.sell_amount_base_units)) fail("zero_x_allowance_issue_inconsistent");
    allowance = Object.freeze({
      state: "approval_required",
      spender,
      actual_amount_base_units: actual.toString(),
      required_amount_base_units: request.sell_amount_base_units,
      approval_transaction_included: false,
    });
  }
  let balance = null;
  if (issues.balance !== null && issues.balance !== undefined) {
    const token = exactAddress(issues.balance.token, "zero_x_balance_issue_token", { allowNative: true });
    const actual = exactInteger(issues.balance.actual, "zero_x_balance_actual");
    const expected = exactInteger(issues.balance.expected, "zero_x_balance_expected", { positive: true });
    if (token !== request.sell_token || actual >= expected) fail("zero_x_balance_issue_inconsistent");
    balance = Object.freeze({ token, actual_amount_base_units: actual.toString(), required_amount_base_units: expected.toString() });
  }
  if (typeof issues.simulationIncomplete !== "boolean") fail("zero_x_simulation_state_invalid");
  return Object.freeze({
    allowance,
    balance,
    simulation_incomplete: issues.simulationIncomplete,
    invalid_sources: Object.freeze(invalidSources),
  });
}

function normalizeTransaction(payload, request) {
  const source = payload?.transaction;
  if (!source || typeof source !== "object") fail("zero_x_unsigned_transaction_missing");
  const to = exactAddress(source.to, "zero_x_transaction_to");
  const data = normalizeHexData(source.data, "zero_x_transaction_data");
  const gas = exactInteger(source.gas, "zero_x_transaction_gas", { positive: true });
  const hasLegacyFee = source.gasPrice !== undefined && source.gasPrice !== null;
  const hasMaximumFee = source.maxFeePerGas !== undefined && source.maxFeePerGas !== null;
  const hasPriorityFee = source.maxPriorityFeePerGas !== undefined && source.maxPriorityFeePerGas !== null;
  if (hasLegacyFee === (hasMaximumFee || hasPriorityFee) || hasMaximumFee !== hasPriorityFee) {
    fail("zero_x_transaction_fee_fields_invalid");
  }
  const value = exactInteger(source.value, "zero_x_transaction_value");
  if (request.sell_token === NATIVE_ETH ? value !== BigInt(request.sell_amount_base_units) : value !== 0n) {
    fail("zero_x_transaction_value_mismatch");
  }
  const transaction = {
    chain_id: ROBINHOOD_ZERO_X_CHAIN_ID,
    from: request.taker,
    to,
    data,
    value: value.toString(),
    gas: gas.toString(),
    unsigned: true,
  };
  if (hasLegacyFee) {
    transaction.gas_price = exactInteger(source.gasPrice, "zero_x_transaction_gas_price").toString();
  } else {
    const maximumFee = exactInteger(source.maxFeePerGas, "zero_x_transaction_max_fee_per_gas");
    const priorityFee = exactInteger(source.maxPriorityFeePerGas, "zero_x_transaction_max_priority_fee_per_gas");
    if (priorityFee > maximumFee) fail("zero_x_transaction_fee_fields_invalid");
    transaction.max_fee_per_gas = maximumFee.toString();
    transaction.max_priority_fee_per_gas = priorityFee.toString();
  }
  return Object.freeze(transaction);
}

function normalizeRoute(value, request) {
  const fills = Array.isArray(value?.fills) ? value.fills : [];
  const tokens = Array.isArray(value?.tokens) ? value.tokens : [];
  if (!fills.length || fills.length > 100 || !tokens.length || tokens.length > 100) fail("zero_x_route_invalid");
  const normalizedTokens = tokens.map((token) => Object.freeze({
    address: exactAddress(token.address, "zero_x_route_token", { allowNative: true }),
    symbol: String(token.symbol || "").trim().slice(0, 32),
  }));
  const addresses = new Set(normalizedTokens.map((token) => token.address));
  if (!addresses.has(request.sell_token) || !addresses.has(request.buy_token)) fail("zero_x_route_identity_mismatch");
  const normalizedFills = fills.map((fill) => {
    const proportion = fill.proportionBps === null || fill.proportionBps === undefined
      ? null
      : Number(fill.proportionBps);
    if (proportion !== null && (!Number.isSafeInteger(proportion) || proportion < 0 || proportion > 10_000)) fail("zero_x_route_proportion_invalid");
    const source = String(fill.source || "").trim().slice(0, 80);
    if (!source) fail("zero_x_route_source_invalid");
    return Object.freeze({
      from: exactAddress(fill.from, "zero_x_route_from", { allowNative: true }),
      to: exactAddress(fill.to, "zero_x_route_to", { allowNative: true }),
      source,
      proportion_bps: proportion,
    });
  });
  return Object.freeze({ fills: Object.freeze(normalizedFills), tokens: Object.freeze(normalizedTokens) });
}

function normalizeTaxMetadata(value) {
  const normalize = (token) => Object.freeze(Object.fromEntries(["buyTaxBps", "sellTaxBps", "transferTaxBps"].map((field) => {
    const raw = token?.[field];
    if (raw === null || raw === undefined) return [field, null];
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 10_000) fail("zero_x_token_tax_invalid");
    return [field, parsed];
  })));
  return Object.freeze({ buy_token: normalize(value?.buyToken), sell_token: normalize(value?.sellToken) });
}

export function normalizeRobinhoodZeroXUnsignedQuote(payload = {}, request = {}, { now = Date.now() } = {}) {
  const quoteTime = isoFromMillis(now, "zero_x_quote_time");
  const receivedAt = quoteTime.millis;
  verifyRequest(request, receivedAt);
  if (payload?.liquidityAvailable !== true) fail("zero_x_liquidity_unavailable");
  if (String(payload.mode || "").toLowerCase() !== "exact-in") fail("zero_x_quote_mode_mismatch");
  const sellToken = exactAddress(payload.sellToken, "zero_x_response_sell_token", { allowNative: true });
  const buyToken = exactAddress(payload.buyToken, "zero_x_response_buy_token", { allowNative: true });
  const sellAmount = exactInteger(payload.sellAmount, "zero_x_response_sell_amount", { positive: true });
  const buyAmount = exactInteger(payload.buyAmount, "zero_x_response_buy_amount", { positive: true });
  const minBuyAmount = exactInteger(payload.minBuyAmount, "zero_x_response_min_buy_amount", { positive: true });
  if (sellToken !== request.sell_token || buyToken !== request.buy_token || sellAmount.toString() !== request.sell_amount_base_units) {
    fail("zero_x_quote_identity_mismatch");
  }
  if (minBuyAmount > buyAmount) fail("zero_x_minimum_output_invalid");
  const blockNumber = exactInteger(payload.blockNumber, "zero_x_block_number", { positive: true });
  const totalNetworkFee = exactInteger(payload.totalNetworkFee, "zero_x_total_network_fee");
  const allowanceTarget = exactAddress(payload.allowanceTarget, "zero_x_allowance_target");
  const transaction = normalizeTransaction(payload, request);
  if (request.sell_token !== NATIVE_ETH && allowanceTarget !== ROBINHOOD_ZERO_X_ALLOWANCE_HOLDER) {
    fail("zero_x_allowance_target_untrusted");
  }
  if (
    request.sell_token !== NATIVE_ETH
    && (transaction.to !== ROBINHOOD_ZERO_X_ALLOWANCE_HOLDER || transaction.to !== allowanceTarget)
  ) fail("zero_x_transaction_target_mismatch");
  const issues = normalizeIssues(payload, request, allowanceTarget, transaction.to);
  const integratorFee = normalizeIntegratorFee(payload.fees, request);
  const blockers = [];
  if (issues.allowance.state === "approval_required") blockers.push("allowance_required");
  if (issues.balance) blockers.push("insufficient_balance");
  if (issues.simulation_incomplete) blockers.push("simulation_incomplete");
  if (issues.invalid_sources.length) blockers.push("invalid_liquidity_sources");
  const state = blockers.length
    ? blockers[0] === "allowance_required" && blockers.length === 1 ? "allowance_required" : "blocked"
    : "awaiting_wallet_signature";
  const providerQuoteId = String(payload.zid || "").trim();
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(providerQuoteId)) fail("zero_x_provider_quote_id_invalid");
  const route = normalizeRoute(payload.route, request);
  const receivedAtIso = quoteTime.iso;
  const expiresAt = exactTimestamp(request.expires_at, "zero_x_quote_expiry").iso;
  const quoteBinding = {
    request_hash: request.request_hash,
    provider_quote_id: providerQuoteId,
    chain_id: ROBINHOOD_ZERO_X_CHAIN_ID,
    taker: request.taker,
    sell_token: sellToken,
    buy_token: buyToken,
    sell_amount_base_units: sellAmount.toString(),
    buy_amount_base_units: buyAmount.toString(),
    minimum_buy_amount_base_units: minBuyAmount.toString(),
    transaction_hash: digest(transaction),
    fee: feeHashBinding(integratorFee),
    block_number: blockNumber.toString(),
    expires_at: expiresAt,
  };
  const walletHandoffEligible = blockers.length === 0;
  return deepFreeze({
    ok: true,
    schema_version: ROBINHOOD_ZERO_X_UNSIGNED_QUOTE_SCHEMA,
    state,
    provider: "0x_swap_api_v2",
    provider_quote_id: providerQuoteId,
    request_id: request.request_id,
    request_hash: request.request_hash,
    quote_hash: digest(quoteBinding),
    chain_id: ROBINHOOD_ZERO_X_CHAIN_ID,
    canonical_chain_id: ROBINHOOD_ZERO_X_CANONICAL_CHAIN_ID,
    observed_at: receivedAtIso,
    expires_at: expiresAt,
    block_number: blockNumber.toString(),
    exact_binding: Object.freeze({
      taker: request.taker,
      recipient: request.taker,
      sell_token: sellToken,
      buy_token: buyToken,
      sell_amount_base_units: sellAmount.toString(),
      buy_amount_base_units: buyAmount.toString(),
      minimum_buy_amount_base_units: minBuyAmount.toString(),
    }),
    fee: Object.freeze({
      ...integratorFee,
      access_tier: request.access_tier,
      hypothetical: false,
      expected_not_collected: request.fee.enabled === true,
      observed_collection: null,
    }),
    allowance: issues.allowance,
    provider_issues: Object.freeze({
      balance: issues.balance,
      simulation_incomplete: issues.simulation_incomplete,
      invalid_sources: issues.invalid_sources,
    }),
    blockers: Object.freeze(blockers),
    total_network_fee_native_base_units: totalNetworkFee.toString(),
    provider_fees: Object.freeze({
      zero_x_fee: normalizeOptionalProviderFee(payload.fees?.zeroExFee, "zero_x_fee"),
      gas_fee: normalizeOptionalProviderFee(payload.fees?.gasFee, "zero_x_gas_fee"),
    }),
    token_taxes: normalizeTaxMetadata(payload.tokenMetadata),
    route,
    reviewed_transaction_hash: quoteBinding.transaction_hash,
    unsigned_transaction: walletHandoffEligible ? transaction : null,
    wallet_handoff_eligible: walletHandoffEligible,
    execution_boundary: Object.freeze({
      self_custodial: true,
      signing_location: "connected_customer_wallet",
      provider_constructed_calldata: true,
      exact_taker_bound: true,
      exact_recipient_bound: true,
      exact_tokens_bound: true,
      integrator_fee_bound: request.fee.enabled === true,
      fee_policy_bound: true,
      customer_wallet_signature_required: true,
      raven_signing: false,
      private_key_received: false,
      custody: false,
      approval_transaction_included: false,
      transaction_submission: false,
      broadcasting: false,
      autonomous_execution: false,
      live_execution_enabled: false,
    }),
  });
}

export function assertRobinhoodZeroXQuoteFresh(quote, { now = Date.now() } = {}) {
  if (quote?.schema_version !== ROBINHOOD_ZERO_X_UNSIGNED_QUOTE_SCHEMA) fail("zero_x_unsigned_quote_required");
  const checkedAt = isoFromMillis(now, "zero_x_quote_check_time");
  if (exactTimestamp(quote.expires_at, "zero_x_quote_expiry").millis <= checkedAt.millis) fail("zero_x_quote_expired");
  if (quote.chain_id !== ROBINHOOD_ZERO_X_CHAIN_ID || quote.canonical_chain_id !== ROBINHOOD_ZERO_X_CANONICAL_CHAIN_ID) {
    fail("zero_x_quote_chain_mismatch");
  }
  if (
    quote.state !== "awaiting_wallet_signature"
    || quote.wallet_handoff_eligible !== true
    || !quote.unsigned_transaction
    || quote.execution_boundary?.self_custodial !== true
    || quote.execution_boundary?.raven_signing !== false
    || quote.execution_boundary?.transaction_submission !== false
    || quote.execution_boundary?.broadcasting !== false
    || quote.execution_boundary?.custody !== false
  ) fail("zero_x_quote_not_wallet_handoff_eligible");
  const transactionHash = digest(quote.unsigned_transaction);
  if (transactionHash !== quote.reviewed_transaction_hash) fail("zero_x_reviewed_transaction_hash_mismatch");
  const fee = quote.fee || {};
  const binding = quote.exact_binding || {};
  const expectedQuoteHash = digest({
    request_hash: quote.request_hash,
    provider_quote_id: quote.provider_quote_id,
    chain_id: quote.chain_id,
    taker: binding.taker,
    sell_token: binding.sell_token,
    buy_token: binding.buy_token,
    sell_amount_base_units: binding.sell_amount_base_units,
    buy_amount_base_units: binding.buy_amount_base_units,
    minimum_buy_amount_base_units: binding.minimum_buy_amount_base_units,
    transaction_hash: transactionHash,
    fee: feeHashBinding(fee),
    block_number: quote.block_number,
    expires_at: quote.expires_at,
  });
  if (quote.quote_hash !== expectedQuoteHash) fail("zero_x_quote_hash_mismatch");
  return true;
}

async function boundedJson(response) {
  const declared = Number(response.headers?.get?.("content-length") || 0);
  if (declared > MAX_RESPONSE_BYTES) fail("zero_x_quote_response_too_large");
  const raw = await response.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_RESPONSE_BYTES) fail("zero_x_quote_response_too_large");
  try {
    return JSON.parse(raw);
  } catch {
    fail("zero_x_quote_response_invalid_json");
  }
}

export function createRobinhoodZeroXQuoteClient(env = {}, {
  fetch_impl: fetchImpl = globalThis.fetch,
  now = () => Date.now(),
} = {}) {
  const capability = resolveRobinhoodZeroXCapability(env);
  const config = configState(env);
  const apiKey = String(env.RAVENOS_ZEROX_API_KEY || "").trim();
  if (typeof fetchImpl !== "function") fail("zero_x_fetch_unavailable");
  return Object.freeze({
    capability,
    async quote(order = {}, context = {}) {
      if (!config.quoteAvailable) fail(capability.unavailable_reasons[0] || "zero_x_quote_review_unavailable");
      if (config.feeRequested && !config.feeConfigured) {
        fail(config.feeReasons[0] || "zero_x_fee_configuration_invalid");
      }
      const startedAt = Number(now());
      const feeEnabled = config.feeRequested && context.fee_enabled !== false;
      const feeTokenSide = context.fee_token_side === undefined
        ? config.feeTokenSide
        : String(context.fee_token_side || "").trim().toLowerCase();
      if (feeEnabled && !new Set(["buy", "sell"]).has(feeTokenSide)) fail("zero_x_fee_token_side_invalid");
      const request = createRobinhoodZeroXQuoteRequest(order, {
        access_tier: context.entitlement_tier || "free",
        fee_enabled: feeEnabled,
        fee_recipient: config.feeRecipient,
        fee_token_side: feeTokenSide,
        now: startedAt,
        ttl_ms: config.quoteTtlMs,
      });
      const url = new URL(config.endpoint);
      for (const [key, value] of Object.entries(request.provider_parameters)) url.searchParams.set(key, value);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      let response;
      try {
        response = await fetchImpl(url, {
          method: "GET",
          headers: Object.freeze({ accept: "application/json", "0x-api-key": apiKey, "0x-version": "v2" }),
          signal: controller.signal,
        });
      } catch (error) {
        fail(error?.name === "AbortError" ? "zero_x_quote_timeout" : "zero_x_quote_provider_unavailable");
      } finally {
        clearTimeout(timer);
      }
      if (!response?.ok) fail("zero_x_quote_http_error", { status: Number(response?.status || 0) });
      const payload = await boundedJson(response);
      return normalizeRobinhoodZeroXUnsignedQuote(payload, request, { now: Number(now()) });
    },
  });
}
