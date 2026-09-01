import { HYPERLIQUID_MARKET_PREVIEW_SCHEMA } from "../customer_trade/hyperliquid_quote_preview.mjs";
import { SOLANA_SPOT_QUOTE_REVIEW_SCHEMA } from "../customer_trade/solana_spot_quote_review.mjs";
import { AgenticVenueAdapter, createVenueCapability } from "./adapter.mjs";
import { createPaperVenueAdapter } from "./paper_adapter.mjs";

const SOLANA_CHAIN = "solana:mainnet-beta";
const JUPITER_VENUE = "jupiter@solana:mainnet-beta#mainnet";
const SOLANA_USDC = "solana:mainnet-beta/spl:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOLANA_SOL = "solana:mainnet-beta/native:sol";
const HYPERLIQUID_CHAIN = "hyperliquid:mainnet";
const HYPERLIQUID_VENUE = "hyperliquid@hyperliquid:mainnet#mainnet";
const HYPERLIQUID_USDC = "hyperliquid:mainnet/venue-asset:usdc";

function callable(value, code) {
  if (typeof value !== "function") throw new Error(code);
  return value;
}

function unavailable(intent, reason, provider) {
  return {
    quote_id: `unavailable:${intent.leg_id || intent.intent_id}`,
    state: "unavailable",
    unavailable_reason: reason,
    provider,
    provider_health: "unknown",
  };
}

function paperQuoteFromEvidence({ intent, evidence, provider, observedAt, expiresAt, quantityAtomic, averagePrice, worstPrice, impactBps, levels, depthSource }) {
  return {
    quote_id: evidence.quote_id,
    leg_id: intent.leg_id,
    chain_id: intent.chain_id,
    venue_id: intent.venue_id,
    instrument_id: intent.instrument_id,
    action: intent.action,
    state: "executable",
    provider,
    provider_health: evidence.provider_health,
    observed_at: observedAt,
    expires_at: expiresAt,
    requested_notional_usdc_micros: evidence.requested_notional_usdc_micros,
    executable_notional_usdc_micros: evidence.executable_notional_usdc_micros,
    executable_quantity_atomic: quantityAtomic,
    average_price: averagePrice,
    worst_price: worstPrice,
    price_impact_bps: impactBps,
    estimated_slippage_bps: evidence.estimated_slippage_bps,
    venue_fee_usdc_micros: evidence.venue_fee_usdc_micros,
    network_fee_usdc_micros: evidence.network_fee_usdc_micros,
    gas_fee_usdc_micros: evidence.gas_fee_usdc_micros,
    funding_usdc_micros: evidence.funding_usdc_micros,
    raven_fee_usdc_micros: evidence.raven_fee_usdc_micros,
    capital_asset_id: evidence.capital_asset_id,
    capital_reservation_amount_atomic: evidence.capital_reservation_amount_atomic,
    gas_asset_id: evidence.gas_asset_id,
    gas_required_atomic: evidence.gas_required_atomic,
    quote_depth_source: depthSource,
    order_book_levels_consumed: levels,
    venue_precision: evidence.venue_precision || null,
  };
}

/**
 * Binds RavenOS's existing exact-pool Solana review to the common paper
 * adapter. Economic decomposition is a separate required source because the
 * legacy review intentionally does not invent USDC value for native-SOL input.
 */
export function createSolanaAgenticPaperAdapter({
  quote_review_source: quoteReviewSource,
  quote_economics_source: quoteEconomicsSource,
  account_source: accountSource,
  clock = () => Date.now(),
  latency_ms: latencyMs = 0,
  rejection_policy: rejectionPolicy = null,
  paper_state: paperState = null,
} = {}) {
  callable(quoteReviewSource, "solana_quote_review_source_required");
  callable(quoteEconomicsSource, "solana_quote_economics_source_required");
  callable(accountSource, "solana_account_source_required");
  return createPaperVenueAdapter({
    capability: {
      adapter_id: "ravenos-solana-jupiter-paper",
      adapter_version: "1",
      chain_id: SOLANA_CHAIN,
      venue_id: JUPITER_VENUE,
      instrument_types: ["spot"],
      settlement_asset_ids: [SOLANA_USDC, SOLANA_SOL],
      native_gas_asset_id: SOLANA_SOL,
    },
    clock,
    latency_ms: latencyMs,
    rejection_policy: rejectionPolicy,
    paper_state: paperState,
    account_source: accountSource,
    quote_source: async (intent, context) => {
      const review = await quoteReviewSource(intent, context);
      if (review?.schema_version !== SOLANA_SPOT_QUOTE_REVIEW_SCHEMA) return unavailable(intent, "solana_quote_review_invalid", "jupiter");
      if (review.state !== "quote_review_available" || review.review_available !== true) {
        return unavailable(intent, review.blocked_reasons?.[0] || "solana_quote_unavailable", review.quote?.provider || "jupiter");
      }
      if (review.intent?.exact_market?.instrument_id !== (intent.venue_instrument_id || intent.instrument_id)) {
        return unavailable(intent, "solana_exact_market_identity_mismatch", review.quote?.provider || "jupiter");
      }
      const evidence = await quoteEconomicsSource({ intent, review, ...context });
      if (!evidence || evidence.state !== "complete" || evidence.provider_health !== "healthy") {
        return unavailable(intent, evidence?.unavailable_reason || "solana_quote_economics_unresolved", review.quote?.provider || "jupiter");
      }
      return paperQuoteFromEvidence({
        intent,
        evidence: { quote_id: review.quote.quote_id, ...evidence },
        provider: review.quote.provider,
        observedAt: review.timing.received_at,
        expiresAt: review.timing.expires_at,
        quantityAtomic: evidence.executable_quantity_atomic || review.quote.expected_output_amount_base_units,
        averagePrice: evidence.average_price,
        worstPrice: evidence.worst_price,
        impactBps: review.quote.price_impact_bps,
        levels: review.quote.route.leg_count,
        depthSource: "jupiter_exact_route_quote",
      });
    },
  });
}

/**
 * Binds the existing Hyperliquid L2-book preview to paper execution. Account
 * tier, fee, and funding inputs remain mandatory evidence rather than zeros.
 */
export function createHyperliquidAgenticPaperAdapter({
  market_preview_source: marketPreviewSource,
  quote_economics_source: quoteEconomicsSource,
  account_source: accountSource,
  clock = () => Date.now(),
  latency_ms: latencyMs = 0,
  rejection_policy: rejectionPolicy = null,
  paper_state: paperState = null,
} = {}) {
  callable(marketPreviewSource, "hyperliquid_market_preview_source_required");
  callable(quoteEconomicsSource, "hyperliquid_quote_economics_source_required");
  callable(accountSource, "hyperliquid_account_source_required");
  return createPaperVenueAdapter({
    capability: {
      adapter_id: "ravenos-hyperliquid-paper",
      adapter_version: "1",
      chain_id: HYPERLIQUID_CHAIN,
      venue_id: HYPERLIQUID_VENUE,
      instrument_types: ["spot", "perpetual"],
      settlement_asset_ids: [HYPERLIQUID_USDC],
    },
    clock,
    latency_ms: latencyMs,
    rejection_policy: rejectionPolicy,
    paper_state: paperState,
    account_source: accountSource,
    quote_source: async (intent, context) => {
      const preview = await marketPreviewSource(intent, context);
      if (preview?.schema_version !== HYPERLIQUID_MARKET_PREVIEW_SCHEMA) return unavailable(intent, "hyperliquid_market_preview_invalid", "Hyperliquid");
      if (preview.ok !== true || preview.state !== "market_preview_available") {
        return unavailable(intent, preview.unavailable_reason || "hyperliquid_book_unavailable", "Hyperliquid");
      }
      if (preview.instrument?.instrument_id !== (intent.venue_instrument_id || intent.instrument_id)) {
        return unavailable(intent, "hyperliquid_exact_market_identity_mismatch", "Hyperliquid");
      }
      const evidence = await quoteEconomicsSource({ intent, preview, ...context });
      if (!evidence || evidence.state !== "complete" || evidence.provider_health !== "healthy") {
        return unavailable(intent, evidence?.unavailable_reason || "hyperliquid_fee_or_funding_evidence_unresolved", "Hyperliquid");
      }
      return paperQuoteFromEvidence({
        intent,
        evidence: { quote_id: preview.preview_id, ...evidence },
        provider: "Hyperliquid",
        observedAt: preview.provenance.observed_at,
        expiresAt: preview.expires_at,
        quantityAtomic: evidence.executable_quantity_atomic,
        averagePrice: String(preview.fill_estimate.vwap_price),
        worstPrice: String(preview.fill_estimate.worst_price),
        impactBps: preview.fill_estimate.price_impact_bps,
        levels: preview.fill_estimate.visible_levels_consumed,
        depthSource: "hyperliquid_live_l2_book",
      });
    },
  });
}

class ReadOnlyVenueAdapter extends AgenticVenueAdapter {
  #account;
  #positionsSource;
  #previewSource;
  #healthSource;

  constructor({ capability, account_source: accountSource = null, positions_source: positionsSource = null, preview_source: previewSource = null, health_source: healthSource = null }) {
    super(createVenueCapability(capability));
    this.#account = accountSource;
    this.#positionsSource = positionsSource;
    this.#previewSource = previewSource;
    this.#healthSource = healthSource;
  }

  async observeAccount(context = {}) {
    if (!this.#account) throw new Error("observe_account_unavailable");
    return structuredClone(await this.#account(context));
  }

  async positions(context = {}) {
    if (this.#positionsSource) return structuredClone(await this.#positionsSource(context));
    const account = await this.observeAccount(context);
    return structuredClone(Array.isArray(account?.positions) ? account.positions : []);
  }

  async preview(context = {}) {
    if (!this.#previewSource) throw new Error("preview_unavailable");
    const value = await this.#previewSource(context);
    return Object.freeze({ ...structuredClone(value), live_execution_enabled: false, signing_available: false, broadcast_available: false });
  }

  async health() {
    if (!this.#healthSource) return { state: "unconfigured", live_execution_enabled: false };
    return Object.freeze({ ...structuredClone(await this.#healthSource()), live_execution_enabled: false });
  }

  async placeLive() { throw new Error("live_execution_disabled"); }
}

export function createReadOnlyEvmAgenticAdapter({ chain_id: chainId, venue_id: venueId, adapter_id: adapterId, native_gas_asset_id: nativeGasAssetId, instrument_types: instrumentTypes = ["spot"], account_source: accountSource = null, positions_source: positionsSource = null, preview_source: previewSource = null, health_source: healthSource = null } = {}) {
  return new ReadOnlyVenueAdapter({
    capability: {
      adapter_id: adapterId,
      adapter_version: "1",
      chain_id: chainId,
      venue_id: venueId,
      environment: "mainnet_read_only",
      instrument_types: instrumentTypes,
      settlement_asset_ids: [],
      native_gas_asset_id: nativeGasAssetId,
      operations: {
        observe_account: Boolean(accountSource),
        positions: Boolean(positionsSource || accountSource),
        preview: Boolean(previewSource),
        health: true,
      },
    },
    account_source: accountSource,
    positions_source: positionsSource,
    preview_source: previewSource,
    health_source: healthSource,
  });
}

export function createRobinhoodChainAgenticReadOnlyAdapter(options = {}) {
  return createReadOnlyEvmAgenticAdapter({
    chain_id: "eip155:4663",
    venue_id: "robinhood-chain@eip155:4663#mainnet",
    adapter_id: "ravenos-robinhood-chain-read-only",
    native_gas_asset_id: "eip155:4663/slip44:60",
    instrument_types: ["spot", "tokenized_equity"],
    ...options,
  });
}

export function createRobinhoodBrokerageAgenticReadOnlyAdapter({ account_source: accountSource = null, positions_source: positionsSource = null, preview_source: previewSource = null, health_source: healthSource = null } = {}) {
  return new ReadOnlyVenueAdapter({
    capability: {
      adapter_id: "ravenos-robinhood-brokerage-read-only",
      adapter_version: "1",
      chain_id: "offchain:robinhood-brokerage",
      venue_id: "robinhood-brokerage@offchain:robinhood-brokerage#production",
      environment: "mainnet_read_only",
      instrument_types: ["equity", "etf", "option"],
      settlement_asset_ids: [],
      operations: {
        observe_account: Boolean(accountSource),
        positions: Boolean(positionsSource || accountSource),
        preview: Boolean(previewSource),
        health: true,
      },
    },
    account_source: accountSource,
    positions_source: positionsSource,
    preview_source: previewSource,
    health_source: healthSource,
  });
}
