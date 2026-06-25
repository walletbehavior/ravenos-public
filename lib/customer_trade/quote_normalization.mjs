import { createTradeQuote } from "./domain.mjs";
import { createDataProvenance, createQuoteResponse } from "./contracts.mjs";

export const JupiterPathModes = Object.freeze({
  META_AGGREGATOR_ORDER: "jupiter_meta_aggregator_order",
  ROUTER_BUILD: "jupiter_router_build",
});

export function normalizeJupiterOrderQuote(payload = {}, options = {}) {
  const route = Array.isArray(payload.routePlan)
    ? payload.routePlan.map((step) => ({
        label: String(step?.swapInfo?.label || step?.label || "Jupiter route"),
        percent: Number(step?.percent || 0),
        input_mint: String(step?.swapInfo?.inputMint || ""),
        output_mint: String(step?.swapInfo?.outputMint || ""),
      }))
    : [];
  const sourceTimestamp = options.source_timestamp || new Date().toISOString();
  const legacy = createTradeQuote({
    provider: "JupiterSwapProvider",
    quote_id: String(payload.quoteId || payload.requestId || `jupiter_order_${payload.contextSlot || "unknown"}`),
    input_amount: String(payload.inAmount || "0"),
    expected_output: String(payload.outAmount || "0"),
    minimum_received: String(payload.otherAmountThreshold || "0"),
    price_impact_pct: Number(payload.priceImpactPct || 0),
    provider_fee: payload.platformFee || { amount: "0", token: "", bps: 0 },
    raven_fee: { amount: "0", token: "", bps: 0, enabled: false },
    network_fee_estimate: { amount: String(payload.prioritizationFeeLamports || "0"), token: "SOL" },
    route,
    quote_expiry: options.quote_expiry || null,
    warnings: options.warnings || [],
    liquidity_available: Number(payload.outAmount || 0) > 0,
    source_timestamp: sourceTimestamp,
    status: "ready",
  });
  const canonical = createQuoteResponse({
    ...legacy,
    chain: "solana",
    quote_timestamp: sourceTimestamp,
    quote_expiry: options.quote_expiry || null,
    provider_request_identifier: String(payload.requestId || payload.quoteId || ""),
    provider_provenance: createDataProvenance({
      request_id: String(payload.requestId || payload.quoteId || ""),
      build_id: String(options.build_id || ""),
      source: "Jupiter",
      source_component: "jupiter_direct_quote",
      chain: "solana",
      observed_at: sourceTimestamp,
      received_at: options.received_at || sourceTimestamp,
      expires_at: options.quote_expiry || null,
      freshness_state: options.freshness_state || "fresh",
      age_seconds: Number.isFinite(Number(options.age_seconds)) ? Number(options.age_seconds) : 0,
      warnings: options.warnings || [],
    }),
    freshness_metadata: createDataProvenance({
      request_id: String(payload.requestId || payload.quoteId || ""),
      build_id: String(options.build_id || ""),
      source: "Jupiter",
      source_component: "jupiter_direct_quote",
      chain: "solana",
      observed_at: sourceTimestamp,
      received_at: options.received_at || sourceTimestamp,
      expires_at: options.quote_expiry || null,
      freshness_state: options.freshness_state || "fresh",
      age_seconds: Number.isFinite(Number(options.age_seconds)) ? Number(options.age_seconds) : 0,
      warnings: options.warnings || [],
    }),
    transaction_material_available: Boolean(options.transaction_material_available),
    inspection_state: String(options.inspection_state || "not_requested"),
    review_blocked_state: Boolean(options.review_blocked_state),
    blocked_reasons: options.blocked_reasons || [],
  });
  return {
    ...canonical,
    route,
  };
}

export function normalizeJupiterBuildQuote(payload = {}, options = {}) {
  const route = Array.isArray(payload.routePlan)
    ? payload.routePlan.map((step) => ({
        label: String(step?.swapInfo?.label || step?.label || "Jupiter route"),
        percent: Number(step?.percent || 0),
        input_mint: String(step?.swapInfo?.inputMint || ""),
        output_mint: String(step?.swapInfo?.outputMint || ""),
      }))
    : [];
  const legacy = createTradeQuote({
    provider: "JupiterRouterProvider",
    quote_id: String(payload.quoteId || payload.requestId || `jupiter_build_${payload.contextSlot || "unknown"}`),
    input_amount: String(payload.inAmount || "0"),
    expected_output: String(payload.outAmount || "0"),
    minimum_received: String(payload.otherAmountThreshold || "0"),
    price_impact_pct: Number(payload.priceImpactPct || 0),
    provider_fee: payload.platformFee || { amount: "0", token: "", bps: 0 },
    raven_fee: { amount: "0", token: "", bps: 0, enabled: false },
    network_fee_estimate: { amount: "0", token: "SOL" },
    route,
    quote_expiry: options.quote_expiry || null,
    warnings: options.warnings || [],
    liquidity_available: Number(payload.outAmount || 0) > 0,
    source_timestamp: options.source_timestamp || new Date().toISOString(),
    status: "ready",
  });
  const sourceTimestamp = options.source_timestamp || new Date().toISOString();
  const canonical = createQuoteResponse({
    ...legacy,
    chain: "solana",
    quote_timestamp: sourceTimestamp,
    quote_expiry: options.quote_expiry || null,
    provider_request_identifier: String(payload.requestId || payload.quoteId || ""),
    provider_provenance: createDataProvenance({
      request_id: String(payload.requestId || payload.quoteId || ""),
      build_id: String(options.build_id || ""),
      source: "Jupiter",
      source_component: "transaction_construction",
      chain: "solana",
      observed_at: sourceTimestamp,
      received_at: options.received_at || sourceTimestamp,
      expires_at: options.quote_expiry || null,
      freshness_state: options.freshness_state || "fresh",
      age_seconds: Number.isFinite(Number(options.age_seconds)) ? Number(options.age_seconds) : 0,
      warnings: options.warnings || [],
    }),
    freshness_metadata: createDataProvenance({
      request_id: String(payload.requestId || payload.quoteId || ""),
      build_id: String(options.build_id || ""),
      source: "Jupiter",
      source_component: "transaction_construction",
      chain: "solana",
      observed_at: sourceTimestamp,
      received_at: options.received_at || sourceTimestamp,
      expires_at: options.quote_expiry || null,
      freshness_state: options.freshness_state || "fresh",
      age_seconds: Number.isFinite(Number(options.age_seconds)) ? Number(options.age_seconds) : 0,
      warnings: options.warnings || [],
    }),
    transaction_material_available: true,
    inspection_state: String(options.inspection_state || "not_requested"),
    review_blocked_state: Boolean(options.review_blocked_state),
    blocked_reasons: options.blocked_reasons || [],
  });
  return {
    ...canonical,
    route,
  };
}
