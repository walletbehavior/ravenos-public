import { createHash } from "node:crypto";

import {
  canonicalContractHash,
  createDataProvenance,
  createPublicTerminalError,
  createQuoteRequest,
  createQuoteResponse,
  normalizeBaseUnits,
} from "./contracts.mjs";
import { normalizeJupiterOrderQuote } from "./quote_normalization.mjs";
import {
  recordProviderComponentEvent,
  runProviderOperation,
} from "./terminal_runtime.mjs";

export const SOLANA_CANONICAL_ASSETS = Object.freeze({
  SOL: Object.freeze({
    chain: "solana",
    symbol: "SOL",
    address: "So11111111111111111111111111111111111111112",
    decimals: 9,
  }),
  USDC: Object.freeze({
    chain: "solana",
    symbol: "USDC",
    address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    decimals: 6,
  }),
});

const JUPITER_DIRECT_ORDER_ENDPOINT = "https://api.jup.ag/swap/v2/order";
const QUOTE_TTL_MS = 20_000;
const QUOTE_TIMEOUT_MS = 4_000;
const MAX_PRICE_IMPACT_BPS_WARNING = 1_500;
const DEFAULT_SLIPPAGE_BPS = 50;
const MAX_SLIPPAGE_BPS = 500;
const MIN_SLIPPAGE_BPS = 5;
const QUOTE_CACHE = new Map();

const INPUT_LIMITS = Object.freeze({
  SOL: Object.freeze({ min: "1000000", max: "50000000000" }),
  USDC: Object.freeze({ min: "10000", max: "1000000000" }),
});

const FIXTURE_ORDER_RESPONSE = Object.freeze({
  quoteId: "quote_sol_usdc_fixture",
  requestId: "req_sol_usdc_fixture",
  inAmount: "100000000",
  outAmount: "14850000",
  otherAmountThreshold: "14770000",
  priceImpactPct: "0.15",
  routePlan: [
    {
      percent: 70,
      swapInfo: {
        label: "Meteora",
        inputMint: SOLANA_CANONICAL_ASSETS.SOL.address,
        outputMint: SOLANA_CANONICAL_ASSETS.USDC.address,
      },
    },
    {
      percent: 30,
      swapInfo: {
        label: "Orca",
        inputMint: SOLANA_CANONICAL_ASSETS.SOL.address,
        outputMint: SOLANA_CANONICAL_ASSETS.USDC.address,
      },
    },
  ],
  prioritizationFeeLamports: "4000",
});

function semanticCacheGet(key, nowMs = Date.now()) {
  const hit = QUOTE_CACHE.get(key);
  if (!hit) return null;
  if (hit.expiresAtMs <= nowMs) {
    QUOTE_CACHE.delete(key);
    return null;
  }
  return hit.value;
}

function semanticCacheSet(key, value, expiresAtMs) {
  QUOTE_CACHE.set(key, { value, expiresAtMs });
  if (QUOTE_CACHE.size > 128) QUOTE_CACHE.delete(QUOTE_CACHE.keys().next().value);
}

function asBigInt(value, fieldName) {
  try {
    return BigInt(normalizeBaseUnits(value, fieldName));
  } catch {
    throw new Error(`invalid_base_units:${fieldName}`);
  }
}

function resolveCanonicalAsset(input = {}) {
  const symbol = String(input.symbol || "").toUpperCase();
  const address = String(input.address || input.mint || "");
  const candidates = Object.values(SOLANA_CANONICAL_ASSETS);
  const match = candidates.find((asset) => asset.symbol === symbol || asset.address === address);
  if (!match) throw new Error("unsupported_asset");
  return match;
}

function displayToBaseUnits(displayAmount, decimals) {
  const text = String(displayAmount || "").trim();
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(text)) throw new Error("invalid_display_amount");
  const [whole, fractional = ""] = text.split(".");
  if (fractional.length > decimals) throw new Error("display_amount_precision_exceeds_decimals");
  const padded = `${whole}${fractional.padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, "") || "0";
  return padded;
}

function validateDisplayConsistency(displayAmount, baseUnits, decimals) {
  if (displayAmount == null || displayAmount === "") return;
  if (displayToBaseUnits(displayAmount, decimals) !== normalizeBaseUnits(baseUnits, "exact_input_amount_base_units")) {
    throw new Error("display_amount_mismatch");
  }
}

function normalizeSlippageBps(value) {
  const parsed = Number.parseInt(String(value ?? DEFAULT_SLIPPAGE_BPS), 10);
  if (!Number.isSafeInteger(parsed) || parsed < MIN_SLIPPAGE_BPS || parsed > MAX_SLIPPAGE_BPS) {
    throw new Error("unsupported_slippage_bps");
  }
  return parsed;
}

function quoteSemanticId(request) {
  return canonicalContractHash({
    schema_version: request.schema_version,
    chain: request.chain,
    input_asset: request.input_asset.address,
    output_asset: request.output_asset.address,
    exact_input_amount_base_units: request.exact_input_amount_base_units,
    slippage_bps: request.slippage_bps,
  });
}

function priceString(inputAmount, outputAmount, inputDecimals, outputDecimals) {
  const input = asBigInt(inputAmount, "input_amount_base_units");
  const output = asBigInt(outputAmount, "expected_output_amount_base_units");
  if (input <= 0n) return null;
  const scale = 10n ** 12n;
  const num = output * (10n ** BigInt(inputDecimals)) * scale;
  const den = input * (10n ** BigInt(outputDecimals));
  const raw = num / den;
  const whole = raw / scale;
  const frac = (raw % scale).toString().padStart(12, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

function classifyProviderError(error) {
  const text = String(error?.message || error || "");
  if (text.includes("timeout")) return "quote_provider_timeout";
  if (text.includes("429")) return "quote_provider_rate_limited";
  if (text.includes("invalid_json") || text.includes("malformed")) return "quote_provider_malformed";
  return "quote_provider_unavailable";
}

function createQuoteFailure({ code, message, retryable = false, component = "quote_provider", quoteBlocking = true, details = null }) {
  const publicError = createPublicTerminalError({
    code,
    message,
    component,
    retryable,
    quote_blocking: quoteBlocking,
    details,
  });
  return {
    ok: false,
    error: publicError.code,
    public_error: publicError,
    quote_only: true,
    signing_disabled: true,
    submission_disabled: true,
    message,
  };
}

export function parseCanonicalQuoteRequest(input = {}) {
  const requested = createQuoteRequest(input);
  if (requested.chain !== "solana") throw new Error("unsupported_chain");
  const inputAsset = resolveCanonicalAsset(requested.input_asset);
  const outputAsset = resolveCanonicalAsset(requested.output_asset);
  if (inputAsset.address === outputAsset.address) throw new Error("unsupported_pair");
  const supported = (
    (inputAsset.symbol === "SOL" && outputAsset.symbol === "USDC") ||
    (inputAsset.symbol === "USDC" && outputAsset.symbol === "SOL")
  );
  if (!supported) throw new Error("unsupported_pair");
  const amount = normalizeBaseUnits(requested.exact_input_amount_base_units, "exact_input_amount_base_units");
  const limits = INPUT_LIMITS[inputAsset.symbol];
  const amountBig = asBigInt(amount, "exact_input_amount_base_units");
  if (amountBig < asBigInt(limits.min, "minimum")) throw new Error("amount_below_minimum");
  if (amountBig > asBigInt(limits.max, "maximum")) throw new Error("amount_above_maximum");
  const inputDecimals = Number.isSafeInteger(requested.input_asset.decimals) && requested.input_asset.decimals >= 0
    ? requested.input_asset.decimals
    : inputAsset.decimals;
  if (inputDecimals !== inputAsset.decimals) throw new Error("input_asset_decimal_mismatch");
  validateDisplayConsistency(requested.display_amount, amount, inputAsset.decimals);
  return createQuoteRequest({
    ...requested,
    input_asset: inputAsset,
    output_asset: outputAsset,
    asset_decimals: inputAsset.decimals,
    slippage_bps: normalizeSlippageBps(requested.slippage_bps),
    exact_input_amount_base_units: amount,
    display_amount: requested.display_amount,
  });
}

async function fetchJsonWithTimeout(url, { fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        ...(process.env.JUPITER_API_KEY ? { "x-api-key": String(process.env.JUPITER_API_KEY) } : {}),
      },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => {
      throw new Error("provider_invalid_json");
    });
    return { response, payload };
  } finally {
    clearTimeout(timer);
  }
}

function buildJupiterQuoteUrl(request) {
  const url = new URL(JUPITER_DIRECT_ORDER_ENDPOINT);
  url.searchParams.set("inputMint", request.input_asset.address);
  url.searchParams.set("outputMint", request.output_asset.address);
  url.searchParams.set("amount", request.exact_input_amount_base_units);
  url.searchParams.set("slippageBps", String(request.slippage_bps));
  url.searchParams.set("swapMode", "ExactIn");
  return url;
}

function normalizeProviderQuote(request, payload, { buildId, nowMs }) {
  const observedAt = payload.quoteTimestamp || payload.observedAt || new Date(nowMs).toISOString();
  const quoteExpiry = payload.expireAt || payload.expiresAt || new Date(nowMs + QUOTE_TTL_MS).toISOString();
  if (Date.parse(quoteExpiry) <= nowMs) throw new Error("provider_quote_expired");
  if (!payload.outAmount || asBigInt(payload.outAmount, "outAmount") <= 0n) throw new Error("provider_zero_output");

  const warnings = [];
  const priceImpactPct = Number(payload.priceImpactPct || 0);
  const priceImpactBps = Number.isFinite(priceImpactPct) ? Math.round(priceImpactPct * 100) : 0;
  if (priceImpactBps >= MAX_PRICE_IMPACT_BPS_WARNING) warnings.push("extreme_price_impact");

  const canonicalQuoteId = `quote_${createHash("sha256").update(JSON.stringify({
    in: request.input_asset.address,
    out: request.output_asset.address,
    amount: request.exact_input_amount_base_units,
    outAmount: String(payload.outAmount || "0"),
    threshold: String(payload.otherAmountThreshold || "0"),
    expiry: quoteExpiry,
  })).digest("hex").slice(0, 24)}`;

  const normalized = normalizeJupiterOrderQuote(payload, {
    build_id: buildId,
    source_timestamp: observedAt,
    received_at: new Date(nowMs).toISOString(),
    quote_expiry: quoteExpiry,
    freshness_state: "fresh",
    age_seconds: 0,
    warnings,
    transaction_material_available: false,
    inspection_state: "not_requested",
    review_blocked_state: false,
    blocked_reasons: [],
  });

  const routeLegs = normalized.route_legs.map((leg) => ({
    ...leg,
    input_asset: {
      chain: request.chain,
      symbol: request.input_asset.symbol,
      address: leg.input_asset.address || request.input_asset.address,
      decimals: leg.input_asset.decimals || request.input_asset.decimals,
    },
    output_asset: {
      chain: request.chain,
      symbol: request.output_asset.symbol,
      address: leg.output_asset.address || request.output_asset.address,
      decimals: leg.output_asset.decimals || request.output_asset.decimals,
    },
  }));

  const providerFeeAmount = String(payload.platformFee?.amount || "0");
  const prioritizationFeeLamports = payload.prioritizationFeeLamports == null ? null : String(payload.prioritizationFeeLamports);

  return createQuoteResponse({
    ...normalized,
    canonical_quote_id: canonicalQuoteId,
    effective_price: priceString(
      request.exact_input_amount_base_units,
      payload.outAmount,
      request.input_asset.decimals,
      request.output_asset.decimals,
    ),
    input_amount_base_units: request.exact_input_amount_base_units,
    expected_output_amount_base_units: String(payload.outAmount || "0"),
    minimum_output_amount_base_units: String(payload.otherAmountThreshold || "0"),
    price_impact_bps: priceImpactBps,
    provider_fees: providerFeeAmount === "0" ? null : {
      amount_base_units: providerFeeAmount,
      asset: payload.platformFee?.mint || request.output_asset.address,
    },
    estimated_network_cost: null,
    estimated_priority_fee: prioritizationFeeLamports ? {
      amount_base_units: prioritizationFeeLamports,
      asset: SOLANA_CANONICAL_ASSETS.SOL.address,
    } : null,
    route_legs: routeLegs,
    route_complexity: routeLegs.length,
    provider_request_identifier: String(payload.requestId || payload.quoteId || ""),
    provider_provenance: createDataProvenance({
      request_id: String(payload.requestId || payload.quoteId || request.client_request_id || ""),
      build_id: buildId,
      source: "Jupiter",
      source_component: "jupiter_direct_quote",
      chain: "solana",
      observed_at: observedAt,
      received_at: new Date(nowMs).toISOString(),
      expires_at: quoteExpiry,
      freshness_state: "fresh",
      age_seconds: 0,
      warnings,
    }),
    freshness_metadata: createDataProvenance({
      request_id: String(payload.requestId || payload.quoteId || request.client_request_id || ""),
      build_id: buildId,
      source: "Jupiter",
      source_component: "jupiter_direct_quote",
      chain: "solana",
      observed_at: observedAt,
      received_at: new Date(nowMs).toISOString(),
      expires_at: quoteExpiry,
      freshness_state: "fresh",
      age_seconds: 0,
      warnings,
    }),
    warnings,
    transaction_material_available: false,
    inspection_state: "not_requested",
    review_blocked_state: false,
    blocked_reasons: [],
    execution_cost_preview: {
      provider_fee: providerFeeAmount === "0" ? null : {
        amount_base_units: providerFeeAmount,
        asset: payload.platformFee?.mint || request.output_asset.address,
      },
      protocol_fee: null,
      estimated_network_fee: null,
      estimated_priority_fee: prioritizationFeeLamports ? {
        amount_base_units: prioritizationFeeLamports,
        asset: SOLANA_CANONICAL_ASSETS.SOL.address,
      } : null,
      estimated_slippage: {
        slippage_bps: request.slippage_bps,
      },
      price_impact_bps: priceImpactBps,
      unknown_cost_fields: prioritizationFeeLamports ? ["estimated_network_fee"] : ["estimated_network_fee", "estimated_priority_fee"],
      gross_expected_output_base_units: String(payload.outAmount || "0"),
      minimum_expected_output_base_units: String(payload.otherAmountThreshold || "0"),
      estimated_net_output_base_units: String(payload.otherAmountThreshold || payload.outAmount || "0"),
    },
    quote_timestamp: observedAt,
    quote_expiry: quoteExpiry,
    source_timestamp: observedAt,
  });
}

export async function getDirectSolanaQuote(rawInput, {
  buildId = "",
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  timeoutMs = QUOTE_TIMEOUT_MS,
  fixtureMode = false,
} = {}) {
  let request;
  try {
    request = parseCanonicalQuoteRequest(rawInput);
  } catch (error) {
    const code = String(error?.message || error);
    return createQuoteFailure({
      code,
      message: "Invalid quote request.",
      retryable: false,
      component: "quote_provider",
      details: { reason: code },
    });
  }

  const nowMs = now();
  const cacheKey = quoteSemanticId(request);
  const cached = semanticCacheGet(cacheKey, nowMs);
  if (cached) {
    recordProviderComponentEvent({
      component: "jupiter_direct_quote",
      category: "success",
      cache_hit: true,
      reason_code: "semantic_cache_hit",
    });
    return {
      ok: true,
      quote_only: true,
      signing_disabled: true,
      submission_disabled: true,
      quote: cached,
      from_cache: true,
    };
  }

  try {
    const { response, payload } = await runProviderOperation({
      component: "jupiter_direct_quote",
      operation_key: cacheKey,
      fn: async () => (
        fixtureMode
          ? {
              response: new Response(JSON.stringify(FIXTURE_ORDER_RESPONSE), { status: 200, headers: { "content-type": "application/json" } }),
              payload: {
                ...FIXTURE_ORDER_RESPONSE,
                inAmount: request.exact_input_amount_base_units,
                outAmount: request.input_asset.symbol === "SOL" ? "14850000" : "9900000",
                otherAmountThreshold: request.input_asset.symbol === "SOL" ? "14770000" : "9800000",
                routePlan: [
                  {
                    percent: 100,
                    swapInfo: {
                      label: request.input_asset.symbol === "SOL" ? "Meteora" : "Jupiter",
                      inputMint: request.input_asset.address,
                      outputMint: request.output_asset.address,
                    },
                  },
                ],
              },
            }
          : fetchJsonWithTimeout(buildJupiterQuoteUrl(request), {
              fetchImpl,
              timeoutMs,
            })
      ),
    });
    if (response.status === 429) {
      return createQuoteFailure({
        code: "quote_provider_rate_limited",
        message: "Quote provider rate limited the request.",
        retryable: true,
        details: { provider: "Jupiter", status: 429 },
      });
    }
    if (!response.ok) {
      return createQuoteFailure({
        code: `quote_provider_http_${response.status}`,
        message: "Quote provider unavailable.",
        retryable: response.status >= 500,
        details: { provider: "Jupiter", status: response.status },
      });
    }
    const quote = normalizeProviderQuote(request, payload, { buildId, nowMs });
    if (quote.quote_expiry && Date.parse(quote.quote_expiry) <= nowMs) {
      return createQuoteFailure({
        code: "quote_expired",
        message: "Quote expired before review.",
        retryable: true,
        details: { provider: "Jupiter" },
      });
    }
    const expiresAtMs = Date.parse(quote.quote_expiry || new Date(nowMs + QUOTE_TTL_MS).toISOString());
    semanticCacheSet(cacheKey, quote, expiresAtMs);
    return {
      ok: true,
      quote_only: true,
      signing_disabled: true,
      submission_disabled: true,
      quote,
      from_cache: false,
    };
  } catch (error) {
    const code = String(error?.code || "") === "provider_backpressure"
      ? "quote_provider_rate_limited"
      : classifyProviderError(error);
    return createQuoteFailure({
      code,
      message: "Quote provider unavailable.",
      retryable: code !== "quote_provider_malformed",
      details: { provider: "Jupiter", reason: String(error?.message || error) },
    });
  }
}
