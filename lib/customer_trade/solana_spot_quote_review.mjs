export const SOLANA_SPOT_QUOTE_REVIEW_SCHEMA = "ravenos.solana_spot_quote_review.v1";
export const SOLANA_SPOT_INTENT_SCHEMA = "ravenos.solana_spot_intent.v1";
export const SOLANA_SPOT_PLAN_SOURCE_SCHEMA = "ravenos.solana_spot_plan_source.v1";
export const SOLANA_SPOT_FEE_DISCLOSURE_SCHEMA = "ravenos.solana_spot_fee_disclosure.v1";
export const SOLANA_SPOT_QUOTE_TIMING_SCHEMA = "ravenos.solana_spot_quote_timing.v1";
export const SOLANA_WRAPPED_NATIVE_MINT = "So11111111111111111111111111111111111111112";
export const SOLANA_CANONICAL_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export const SolanaSpotQuoteReviewLimits = Object.freeze({
  native_decimals: 9,
  canonical_usdc_decimals: 6,
  minimum_buy_lamports: "1000000",
  maximum_buy_lamports: "50000000000",
  minimum_buy_usdc_base_units: "10000",
  maximum_buy_usdc_base_units: "100000000000",
  minimum_slippage_bps: 5,
  maximum_slippage_bps: 300,
  maximum_priority_fee_lamports: 50_000,
  maximum_configured_fee_bps: 255,
  maximum_quote_ttl_ms: 60_000,
  maximum_provider_latency_ms: 10_000,
  maximum_clock_skew_ms: 5_000,
  maximum_route_legs: 8,
  maximum_plan_modifications: 24,
});

const PLAN_SOURCES = new Set(["raven_exact_market", "user_preset", "custom"]);
const MODIFIABLE_PLAN_FIELDS = new Set([
  "entry",
  "take_profit",
  "stop_loss",
  "take_profit_allocation",
  "runner",
  "slippage",
]);
const TIMEFRAMES = new Set(["1m", "5m", "15m", "1h", "4h", "24h", "7d"]);
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

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

function cleanText(value, field, maximum = 120, { required = true, lower = false } = {}) {
  const result = String(value ?? "").trim();
  if ((required && !result) || result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) {
    fail(`${field}_invalid`);
  }
  return lower ? result.toLowerCase() : result;
}

function unsignedInteger(value, field, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = String(value ?? "").trim();
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) fail(`${field}_invalid`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) fail(`${field}_out_of_bounds`);
  return parsed;
}

function baseUnits(value, field, { positive = false } = {}) {
  const raw = String(value ?? "").trim();
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) fail(`${field}_invalid`);
  const parsed = BigInt(raw);
  if (positive && parsed <= 0n) fail(`${field}_invalid`);
  return parsed;
}

function decodeBase58Length(value) {
  const bytes = [0];
  for (const character of value) {
    const digit = BASE58_ALPHABET.indexOf(character);
    if (digit < 0) return -1;
    let carry = digit;
    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index] * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let index = 0; index < value.length - 1 && value[index] === "1"; index += 1) bytes.push(0);
  return bytes.length;
}

function publicKey(value, field) {
  const address = cleanText(value, field, 44);
  if (address.length < 32 || decodeBase58Length(address) !== 32) fail(`${field}_invalid`);
  return address;
}

function timestamp(value, field) {
  const raw = cleanText(value, field, 40);
  const milliseconds = Date.parse(raw);
  if (!Number.isFinite(milliseconds)) fail(`${field}_invalid`);
  return { iso: new Date(milliseconds).toISOString(), milliseconds };
}

function positiveDecimal(value, field, { maximumWholeDigits = 20, maximumFractionDigits = 30 } = {}) {
  const raw = String(value ?? "").trim();
  const pattern = new RegExp(`^(?:0|[1-9][0-9]{0,${maximumWholeDigits - 1}})(?:\\.[0-9]{1,${maximumFractionDigits}})?$`);
  if (!pattern.test(raw) || /^0(?:\.0+)?$/.test(raw)) fail(`${field}_invalid`);
  return raw;
}

function decimalToBaseUnits(value, decimals, field) {
  // The authoritative base-unit bounds below remain the real economic cap.
  // Six whole digits are required to represent the reviewed USDC ceiling and
  // the required $10,000 shadow-test scenario without weakening that cap.
  const raw = positiveDecimal(value, field, { maximumWholeDigits: 6, maximumFractionDigits: decimals });
  const [whole, fraction = ""] = raw.split(".");
  const units = BigInt(`${whole}${fraction.padEnd(decimals, "0")}`);
  if (units <= 0n) fail(`${field}_invalid`);
  return units;
}

function baseUnitsToDecimal(value, decimals) {
  const raw = String(value).padStart(decimals + 1, "0");
  if (decimals === 0) return raw;
  const whole = raw.slice(0, -decimals);
  const fraction = raw.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function exactMarketAuthority(authority = {}) {
  const chain = cleanText(authority.chain, "market_authority_chain", 20, { lower: true });
  const scope = cleanText(authority.identity_scope, "market_authority_identity_scope", 24, { lower: true });
  if (chain !== "solana") fail("market_authority_chain_invalid");
  if (scope !== "exact_pool") fail("market_authority_scope_invalid");
  const poolAddress = publicKey(authority.pool_address, "market_authority_pool_address");
  const tokenAddress = publicKey(authority.token_address, "market_authority_token_address");
  const quoteAddress = publicKey(authority.quote_address, "market_authority_quote_address");
  if (tokenAddress === quoteAddress) fail("market_authority_token_quote_collision");
  const instrumentId = cleanText(authority.instrument_id, "market_authority_instrument_id", 120);
  if (instrumentId !== `solana:pool:${poolAddress}`) fail("market_authority_instrument_pool_mismatch");
  const tokenDecimals = unsignedInteger(authority.token_decimals, "market_authority_token_decimals", { maximum: 18 });
  const nativeDecimals = unsignedInteger(authority.native_decimals, "market_authority_native_decimals", { maximum: 18 });
  if (nativeDecimals !== SolanaSpotQuoteReviewLimits.native_decimals) fail("market_authority_native_decimals_invalid");
  return deepFreeze({
    instrument_id: instrumentId,
    identity_scope: "exact_pool",
    chain: "solana",
    market: "spot",
    pool_address: poolAddress,
    token_address: tokenAddress,
    quote_address: quoteAddress,
    venue: cleanText(authority.venue, "market_authority_venue", 64),
    token_decimals: tokenDecimals,
    native_decimals: nativeDecimals,
    display: deepFreeze({
      symbol: cleanText(authority.symbol, "market_authority_symbol", 40, { required: false }) || null,
      quote_symbol: cleanText(authority.quote_symbol, "market_authority_quote_symbol", 40, { required: false }) || null,
    }),
  });
}

function clientExactMarket(input = {}) {
  const exact = input.exact_market && typeof input.exact_market === "object" ? input.exact_market : {};
  return {
    instrument_id: cleanText(exact.instrument_id, "request_instrument_id", 120),
    pool_address: publicKey(exact.pool_address, "request_pool_address"),
    token_address: publicKey(exact.token_address, "request_token_address"),
    quote_address: publicKey(exact.quote_address, "request_quote_address"),
  };
}

function assertExactMarketMatch(request, authority) {
  for (const field of ["instrument_id", "pool_address", "token_address", "quote_address"]) {
    if (request[field] !== authority[field]) fail("request_exact_market_mismatch", { field });
  }
}

function assertNoClientAuthority(input = {}) {
  const forbiddenTopLevel = [
    "token_decimals",
    "native_decimals",
    "input_mint",
    "output_mint",
    "exact_input_amount_base_units",
    "spendable_token_balance_base_units",
    "fee_bps",
    "actual_fee_bps",
  ];
  if (forbiddenTopLevel.some((field) => Object.hasOwn(input, field))) fail("client_authority_field_forbidden");
  const amount = input.amount && typeof input.amount === "object" ? input.amount : {};
  if (["base_units", "amount_base_units", "token_decimals", "native_decimals"].some((field) => Object.hasOwn(amount, field))) {
    fail("client_authority_field_forbidden");
  }
  const settlement = input.settlement && typeof input.settlement === "object" ? input.settlement : {};
  if (["mint", "address", "decimals", "output_mint"].some((field) => Object.hasOwn(settlement, field))) {
    fail("client_authority_field_forbidden");
  }
}

export function createExactSolanaSpotIntent(input = {}, serverAuthority = {}) {
  assertNoClientAuthority(input);
  const market = exactMarketAuthority(serverAuthority);
  assertExactMarketMatch(clientExactMarket(input), market);
  const side = cleanText(input.side, "side", 12, { lower: true });
  const amount = input.amount && typeof input.amount === "object" ? input.amount : {};
  const settlementInput = input.settlement && typeof input.settlement === "object" ? input.settlement : {};
  const settlementKind = side === "sell"
    ? cleanText(settlementInput.kind || "canonical_usdc", "sell_settlement_kind", 32, { lower: true })
    : "selected_token";
  if (side === "sell" && !new Set(["canonical_usdc", "native_sol"]).has(settlementKind)) fail("sell_settlement_kind_invalid");
  let amountKind;
  let percentageBps = null;
  let exactInput;
  let displayAmount;
  let balanceSnapshot = null;
  if (side === "buy") {
    amountKind = cleanText(amount.kind, "buy_amount_kind", 32, { lower: true });
    if (!new Set(["native_sol", "canonical_usdc"]).has(amountKind)) fail("buy_amount_kind_invalid");
    const inputDecimals = amountKind === "canonical_usdc" ? SolanaSpotQuoteReviewLimits.canonical_usdc_decimals : market.native_decimals;
    exactInput = decimalToBaseUnits(amount.display_amount, inputDecimals, "buy_display_amount");
    const minimum = BigInt(amountKind === "canonical_usdc" ? SolanaSpotQuoteReviewLimits.minimum_buy_usdc_base_units : SolanaSpotQuoteReviewLimits.minimum_buy_lamports);
    const maximum = BigInt(amountKind === "canonical_usdc" ? SolanaSpotQuoteReviewLimits.maximum_buy_usdc_base_units : SolanaSpotQuoteReviewLimits.maximum_buy_lamports);
    if (exactInput < minimum || exactInput > maximum) fail("buy_amount_out_of_bounds");
    // The display amount must use the decimals of the authoritative input
    // asset. Canonical USDC has six decimals; formatting it as native SOL
    // (nine decimals) understates the economic request by 1,000x even though
    // the provider-facing base units remain correct.
    displayAmount = baseUnitsToDecimal(exactInput, inputDecimals);
  } else if (side === "sell") {
    amountKind = cleanText(amount.kind, "sell_amount_kind", 32, { lower: true });
    if (amountKind !== "sell_percentage") fail("sell_amount_kind_invalid");
    percentageBps = unsignedInteger(amount.percentage_bps, "sell_percentage_bps", { minimum: 1, maximum: 10_000 });
    const spendableBalance = baseUnits(serverAuthority.spendable_token_balance_base_units, "spendable_token_balance_base_units", { positive: true });
    exactInput = (spendableBalance * BigInt(percentageBps)) / 10_000n;
    if (exactInput <= 0n) fail("sell_percentage_resolves_to_zero");
    displayAmount = baseUnitsToDecimal(exactInput, market.token_decimals);
    balanceSnapshot = deepFreeze({
      source: "server_wallet_balance",
      spendable_base_units: spendableBalance.toString(),
      token_mint: market.token_address,
    });
  } else {
    fail("side_invalid");
  }
  const inputMint = side === "buy"
    ? amountKind === "canonical_usdc" ? SOLANA_CANONICAL_USDC_MINT : SOLANA_WRAPPED_NATIVE_MINT
    : market.token_address;
  const outputMint = side === "buy"
    ? market.token_address
    : settlementKind === "native_sol" ? SOLANA_WRAPPED_NATIVE_MINT : SOLANA_CANONICAL_USDC_MINT;
  const inputDecimals = side === "buy"
    ? amountKind === "canonical_usdc" ? SolanaSpotQuoteReviewLimits.canonical_usdc_decimals : market.native_decimals
    : market.token_decimals;
  return deepFreeze({
    schema_version: SOLANA_SPOT_INTENT_SCHEMA,
    state: "quote_request_only",
    exact_market: market,
    selection_basis: "exact_identity_only",
    symbol_selection_allowed: false,
    side,
    economic_flow: side === "buy"
      ? amountKind === "canonical_usdc" ? "canonical_usdc_to_selected_token" : "native_sol_to_selected_token"
      : settlementKind === "native_sol" ? "selected_token_to_native_sol" : "selected_token_to_canonical_usdc",
    amount: {
      kind: amountKind,
      display_amount: displayAmount,
      exact_input_amount_base_units: exactInput.toString(),
      input_decimals: inputDecimals,
      sell_percentage_bps: percentageBps,
      balance_snapshot: balanceSnapshot,
      conversion_authority: "server",
    },
    input_mint: inputMint,
    output_mint: outputMint,
    settlement: {
      kind: settlementKind,
      output_decimals: side === "buy"
        ? market.token_decimals
        : settlementKind === "native_sol"
          ? market.native_decimals
          : SolanaSpotQuoteReviewLimits.canonical_usdc_decimals,
    },
    route_identity_policy: "exact_selected_token",
  });
}

function normalizePlanLevels(input = {}) {
  const entries = Array.isArray(input.entries)
    ? input.entries.slice(0, 8).map((value, index) => positiveDecimal(value, `plan_entry_${index}`))
    : [];
  const takeProfits = Array.isArray(input.take_profits)
    ? input.take_profits.slice(0, 12).map((row, index) => ({
        price: positiveDecimal(row?.price, `plan_take_profit_${index}_price`),
        allocation_bps: unsignedInteger(row?.allocation_bps, `plan_take_profit_${index}_allocation_bps`, { minimum: 1, maximum: 10_000 }),
      }))
    : [];
  if (takeProfits.reduce((sum, row) => sum + row.allocation_bps, 0) > 10_000) fail("plan_take_profit_allocation_out_of_bounds");
  return deepFreeze({
    entries,
    take_profits: takeProfits,
    stop_loss: input.stop_loss == null || input.stop_loss === "" ? null : positiveDecimal(input.stop_loss, "plan_stop_loss"),
    invalidation: cleanText(input.invalidation, "plan_invalidation", 240, { required: false }) || null,
  });
}

function normalizePlanModifications(input) {
  const rows = Array.isArray(input) ? input : [];
  if (rows.length > SolanaSpotQuoteReviewLimits.maximum_plan_modifications) fail("plan_modifications_out_of_bounds");
  return rows.map((row, index) => {
    const field = cleanText(row?.field, `plan_modification_${index}_field`, 40, { lower: true });
    if (!MODIFIABLE_PLAN_FIELDS.has(field)) fail("plan_modification_field_invalid", { index });
    return {
      field,
      from: cleanText(row?.from, `plan_modification_${index}_from`, 80, { required: false }) || null,
      to: cleanText(row?.to, `plan_modification_${index}_to`, 80),
      modified_at: timestamp(row?.modified_at, `plan_modification_${index}_modified_at`).iso,
    };
  });
}

export function createSolanaSpotPlanSource(input = {}, authority = {}) {
  const source = cleanText(input.source || "custom", "plan_source", 32, { lower: true });
  if (!PLAN_SOURCES.has(source)) fail("plan_source_invalid");
  const instrumentId = cleanText(authority.instrument_id, "plan_instrument_id", 120);
  const modifications = normalizePlanModifications(input.user_modifications);
  let provenance;
  let levels;
  if (source === "raven_exact_market") {
    const raven = authority.raven_plan && typeof authority.raven_plan === "object" ? authority.raven_plan : null;
    if (!raven) fail("raven_plan_authority_required");
    if (cleanText(raven.instrument_id, "raven_plan_instrument_id", 120) !== instrumentId) fail("raven_plan_exact_market_mismatch");
    const timeframe = cleanText(raven.timeframe, "raven_plan_timeframe", 8, { lower: true });
    if (!TIMEFRAMES.has(timeframe)) fail("raven_plan_timeframe_invalid");
    provenance = {
      raven_context_id: cleanText(raven.raven_context_id, "raven_context_id", 120),
      observed_at: timestamp(raven.observed_at, "raven_plan_observed_at").iso,
      timeframe,
      authority: "server_qualified_raven_exact_market",
    };
    levels = normalizePlanLevels(raven.levels);
  } else if (source === "user_preset") {
    provenance = {
      preset_id: cleanText(input.preset_id, "preset_id", 120),
      preset_version: unsignedInteger(input.preset_version, "preset_version", { minimum: 1, maximum: 1_000_000 }),
      authority: "user_preset",
    };
    levels = normalizePlanLevels(input.levels);
  } else {
    provenance = { authority: "user_custom" };
    levels = normalizePlanLevels(input.levels);
  }
  return deepFreeze({
    schema_version: SOLANA_SPOT_PLAN_SOURCE_SCHEMA,
    instrument_id: instrumentId,
    source,
    provenance,
    original_levels: levels,
    user_modifications: modifications,
    user_modified: modifications.length > 0,
    plan_is_execution_authority: false,
  });
}

export function createSolanaSpotAdvancedControls(input = {}) {
  const slippageBps = unsignedInteger(input.slippage_bps ?? 50, "slippage_bps", {
    minimum: SolanaSpotQuoteReviewLimits.minimum_slippage_bps,
    maximum: SolanaSpotQuoteReviewLimits.maximum_slippage_bps,
  });
  const priority = input.priority && typeof input.priority === "object" ? input.priority : {};
  const priorityMode = cleanText(priority.mode || "standard", "priority_mode", 20, { lower: true });
  if (!new Set(["standard", "capped"]).has(priorityMode)) fail("priority_mode_invalid");
  let requestedMaximum = null;
  if (priorityMode === "capped") {
    requestedMaximum = unsignedInteger(priority.max_lamports, "priority_max_lamports", {
      minimum: 0,
      maximum: SolanaSpotQuoteReviewLimits.maximum_priority_fee_lamports,
    });
  } else if (priority.max_lamports != null) {
    fail("priority_standard_cap_forbidden");
  }
  const jitoRequested = input.jito === true || input.jito_requested === true || input.jito?.enabled === true;
  if (jitoRequested) fail("jito_unavailable");
  return deepFreeze({
    slippage_bps: slippageBps,
    priority: {
      mode: priorityMode,
      requested_max_lamports: requestedMaximum,
      enforced_max_lamports: SolanaSpotQuoteReviewLimits.maximum_priority_fee_lamports,
    },
    jito: {
      state: "unavailable",
      enabled: false,
      selectable: false,
      unavailable_reason: "not_reviewed",
    },
  });
}

export function createSolanaSpotFeeDisclosure(input = {}) {
  const configuredBps = unsignedInteger(input.configured_fee_bps ?? 0, "configured_fee_bps", {
    maximum: SolanaSpotQuoteReviewLimits.maximum_configured_fee_bps,
  });
  const actualBps = unsignedInteger(input.actual_fee_bps ?? 0, "actual_fee_bps", {
    maximum: SolanaSpotQuoteReviewLimits.maximum_configured_fee_bps,
  });
  if (actualBps > configuredBps) fail("actual_fee_exceeds_configured_fee");
  const configuredEnabled = input.configured_enabled === true;
  const configurationReady = input.configuration_ready === true;
  if (!configuredEnabled && actualBps !== 0) fail("fee_charged_while_disabled");
  if (configuredEnabled && !configurationReady && actualBps !== 0) fail("fee_charged_without_ready_configuration");
  const actualAmount = baseUnits(input.actual_fee_amount_base_units ?? "0", "actual_fee_amount_base_units");
  if (actualBps === 0 && actualAmount !== 0n) fail("actual_fee_amount_without_fee");
  const charged = actualBps > 0 || actualAmount > 0n;
  const recipient = input.recipient == null || input.recipient === "" ? null : publicKey(input.recipient, "fee_recipient");
  if (charged && !recipient) fail("charged_fee_recipient_required");
  const assetMint = input.asset_mint == null || input.asset_mint === "" ? null : publicKey(input.asset_mint, "fee_asset_mint");
  if (charged && !assetMint) fail("charged_fee_asset_required");
  return deepFreeze({
    schema_version: SOLANA_SPOT_FEE_DISCLOSURE_SCHEMA,
    fee_kind: configuredBps > 0 ? "integrator_fee" : "none",
    server_authoritative: true,
    client_override_allowed: false,
    configured: {
      enabled: configuredEnabled,
      configuration_ready: configurationReady,
      fee_bps: configuredBps,
      recipient,
    },
    actual: {
      charged,
      fee_bps: actualBps,
      amount_base_units: actualAmount.toString(),
      asset_mint: assetMint,
    },
  });
}

export function createSolanaSpotQuoteTiming(input = {}, { now = Date.now() } = {}) {
  if (!Number.isFinite(now)) fail("quote_timing_now_invalid");
  const requested = timestamp(input.requested_at, "quote_requested_at");
  const quoted = timestamp(input.quoted_at, "quote_quoted_at");
  const received = timestamp(input.received_at, "quote_received_at");
  const expires = timestamp(input.expires_at, "quote_expires_at");
  if (quoted.milliseconds < requested.milliseconds || received.milliseconds < quoted.milliseconds) fail("quote_timing_order_invalid");
  const providerLatency = received.milliseconds - requested.milliseconds;
  if (providerLatency > SolanaSpotQuoteReviewLimits.maximum_provider_latency_ms) fail("quote_provider_latency_out_of_bounds");
  const ttl = expires.milliseconds - quoted.milliseconds;
  if (ttl <= 0 || ttl > SolanaSpotQuoteReviewLimits.maximum_quote_ttl_ms) fail("quote_ttl_out_of_bounds");
  if (received.milliseconds - now > SolanaSpotQuoteReviewLimits.maximum_clock_skew_ms) fail("quote_timing_future_out_of_bounds");
  const age = Math.max(0, now - quoted.milliseconds);
  const expiresIn = expires.milliseconds - now;
  const state = expiresIn > 0 && age <= SolanaSpotQuoteReviewLimits.maximum_quote_ttl_ms ? "current" : "expired";
  return deepFreeze({
    schema_version: SOLANA_SPOT_QUOTE_TIMING_SCHEMA,
    requested_at: requested.iso,
    quoted_at: quoted.iso,
    received_at: received.iso,
    expires_at: expires.iso,
    provider_latency_ms: providerLatency,
    quote_age_ms: age,
    expires_in_ms: Math.max(0, expiresIn),
    freshness: state,
    fresh: state === "current",
  });
}

function normalizeQuote(input = {}, intent) {
  const instrumentId = cleanText(input.instrument_id, "quote_instrument_id", 120);
  const poolAddress = publicKey(input.pool_address, "quote_pool_address");
  const tokenAddress = publicKey(input.token_address, "quote_token_address");
  const quoteAddress = publicKey(input.quote_address, "quote_quote_address");
  for (const [field, value] of Object.entries({
    instrument_id: instrumentId,
    pool_address: poolAddress,
    token_address: tokenAddress,
    quote_address: quoteAddress,
  })) {
    if (value !== intent.exact_market[field]) fail("quote_exact_market_mismatch", { field });
  }
  const inputMint = publicKey(input.input_mint, "quote_input_mint");
  const outputMint = publicKey(input.output_mint, "quote_output_mint");
  if (inputMint !== intent.input_mint || outputMint !== intent.output_mint) fail("quote_direction_mismatch");
  const exactInput = baseUnits(input.exact_input_amount_base_units, "quote_exact_input_amount_base_units", { positive: true });
  if (exactInput.toString() !== intent.amount.exact_input_amount_base_units) fail("quote_input_amount_mismatch");
  const expectedOutput = baseUnits(input.expected_output_amount_base_units, "quote_expected_output_amount_base_units", { positive: true });
  const minimumOutput = baseUnits(input.minimum_output_amount_base_units, "quote_minimum_output_amount_base_units", { positive: true });
  if (minimumOutput > expectedOutput) fail("quote_minimum_output_invalid");
  const priceImpactBps = unsignedInteger(input.price_impact_bps ?? 0, "quote_price_impact_bps", { maximum: 10_000 });
  const routeLegCount = unsignedInteger(input.route_leg_count ?? 0, "quote_route_leg_count", {
    maximum: SolanaSpotQuoteReviewLimits.maximum_route_legs,
  });
  const venues = Array.isArray(input.venues)
    ? input.venues.slice(0, SolanaSpotQuoteReviewLimits.maximum_route_legs).map((value, index) => cleanText(value, `quote_venue_${index}`, 64))
    : [];
  if (venues.length > routeLegCount) fail("quote_route_summary_invalid");
  const outputDecimals = intent.settlement.output_decimals;
  return deepFreeze({
    quote_id: cleanText(input.quote_id, "quote_id", 160),
    provider: cleanText(input.provider, "quote_provider", 64),
    exact_market: {
      instrument_id: instrumentId,
      pool_address: poolAddress,
      token_address: tokenAddress,
      quote_address: quoteAddress,
    },
    input_mint: inputMint,
    output_mint: outputMint,
    exact_input_amount_base_units: exactInput.toString(),
    expected_output_amount_base_units: expectedOutput.toString(),
    minimum_output_amount_base_units: minimumOutput.toString(),
    expected_output_display: baseUnitsToDecimal(expectedOutput, outputDecimals),
    minimum_output_display: baseUnitsToDecimal(minimumOutput, outputDecimals),
    price_impact_bps: priceImpactBps,
    route: {
      policy: "exact_selected_token",
      leg_count: routeLegCount,
      venues,
    },
  });
}

export function createExactSolanaSpotQuoteReview(input = {}, server = {}, { now = Date.now() } = {}) {
  const authority = server.market_authority && typeof server.market_authority === "object" ? server.market_authority : {};
  const intent = createExactSolanaSpotIntent(input, authority);
  const controls = createSolanaSpotAdvancedControls(input.advanced_controls);
  const planSource = createSolanaSpotPlanSource(input.plan, {
    instrument_id: intent.exact_market.instrument_id,
    raven_plan: server.raven_plan,
  });
  const quote = normalizeQuote(server.quote, intent);
  const timing = createSolanaSpotQuoteTiming(server.quote_timing, { now });
  const fee = createSolanaSpotFeeDisclosure(server.fee_disclosure);
  if (fee.actual.charged && !new Set([intent.input_mint, intent.output_mint]).has(fee.actual.asset_mint)) {
    fail("fee_asset_not_in_quote");
  }
  const reviewAvailable = timing.fresh;
  return deepFreeze({
    schema_version: SOLANA_SPOT_QUOTE_REVIEW_SCHEMA,
    state: reviewAvailable ? "quote_review_available" : "quote_expired",
    review_available: reviewAvailable,
    blocked_reasons: reviewAvailable ? [] : ["quote_expired"],
    intent,
    plan_source: planSource,
    quote,
    fee_disclosure: fee,
    timing,
    advanced_controls: controls,
    authority: {
      exact_identity: "server",
      mint_and_decimals: "server",
      base_unit_conversion: "server",
      fee_disclosure: "server",
      quote_timing: "server",
    },
    execution_boundary: {
      quote_only: true,
      review_only: true,
      wallet_connection_required_for_quote: false,
      wallet_connection_available: false,
      signing_available: false,
      submission_available: false,
      transaction_material_available: false,
    },
  });
}
