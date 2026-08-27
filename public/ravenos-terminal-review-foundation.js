const SAFETY_FIELDS = Object.freeze({
  quote_only: true,
  review_only: true,
  user_confirmed_future: true,
  signing_enabled: false,
  submission_enabled: false,
  broadcast_enabled: false,
  custody_enabled: false,
  autonomous_enabled: false,
  user_confirmation_required: true,
  no_order_submitted: true,
});

const DISABLED_CAPABILITIES = Object.freeze({
  quote_available: false,
  review_available: true,
  signing_available: false,
  submission_available: false,
  broadcast_available: false,
  custody_available: false,
  live_execution_available: false,
  supports_quote_preview: false,
  supports_review_packet: true,
  supports_live_execution: false,
  supports_signing: false,
  supports_broadcast: false,
  supports_custody: false,
});

function normalizeChain(value, fallback = "unknown") {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "eth") return "ethereum";
  if (raw === "avax" || raw.includes("avalanche")) return "avalanche";
  if (raw.includes("solana")) return "solana";
  if (raw.includes("base")) return "base";
  if (raw.includes("ethereum")) return "ethereum";
  if (raw.includes("hyperliquid")) return "hyperliquid";
  if (raw.includes("imperial")) return "imperial_future";
  if (raw.includes("monad")) return "monad_future";
  if (raw.includes("paper") || raw.includes("raven")) return "raven_paper";
  return raw.replace(/[^a-z0-9_:-]+/g, "_") || fallback;
}

function displayChain(value) {
  const chain = normalizeChain(value);
  return ({
    solana: "Solana",
    base: "Base",
    ethereum: "Ethereum",
    avalanche: "Avalanche",
    hyperliquid: "Hyperliquid",
    imperial_future: "Imperial future",
    monad_future: "Monad future",
    raven_paper: "Raven Paper",
    unsupported: "Unsupported",
    unknown: "Unknown",
  })[chain] || String(value || chain);
}

function routeStatusLabel(value) {
  return ({
    preview_available: "preview available",
    quote_unavailable: "quote unavailable",
    coverage_developing: "coverage developing",
    unsupported: "unsupported",
    future: "future coverage",
  })[value] || "coverage developing";
}

function requiredWalletLabel(value) {
  return ({
    solana_wallet: "Solana wallet",
    evm_wallet: "EVM wallet",
    hyperliquid_account: "Hyperliquid account",
    raven_paper: "No wallet required",
    unsupported: "Unsupported",
  })[value] || "Unknown";
}

function feeModelLabel(value) {
  return ({
    raven_platform_fee_future: "Raven platform fee future",
    hyperliquid_builder_fee_future: "Hyperliquid builder fee future",
    none: "None",
    unknown: "Unknown",
  })[value] || "Unknown";
}

function disabledAdapter({
  key,
  label,
  chain,
  venue,
  marketType,
  routeKind,
  requiredWallet,
  settlementAssets,
  feeModel,
  routeSummary,
  feeKind,
  feeCopy,
  targetFeeBps = null,
  chainId = null,
  gasAsset = null,
}) {
  return Object.freeze({
    key,
    label,
    chain,
    venue,
    market_type: marketType,
    route_kind: routeKind,
    required_wallet: requiredWallet,
    supported_settlement_assets: settlementAssets,
    fee_model: feeModel,
    routeSummary,
    chain_id: chainId,
    gas_asset: gasAsset,
    getCapabilities() {
      return {
        ...DISABLED_CAPABILITIES,
        adapter: key,
        market_type: marketType,
        chain,
        venue,
        supported_settlement_assets: [...settlementAssets],
        chain_id: chainId,
        gas_asset: gasAsset,
        required_wallet: requiredWallet,
        route_kind: routeKind,
        fee_model: feeModel,
        supports_fee_disclosure: feeKind !== "none",
      };
    },
    explainFees() {
      return {
        fee_kind: feeKind,
        target_fee_bps: targetFeeBps,
        display: feeCopy,
        charged_now: false,
        preview_label: "not charged in preview",
      };
    },
    getSafetyState() {
      return { ...SAFETY_FIELDS };
    },
    buildDisabledReview(input = {}) {
      return buildReviewPacket(createReviewState({ ...input, adapterKey: key }));
    },
  });
}

const adapters = Object.freeze({
  solana_jupiter_future: disabledAdapter({
    key: "solana_jupiter_future",
    label: "Future Solana routed swap",
    chain: "solana",
    venue: "jupiter_future",
    marketType: "spot",
    routeKind: "same_chain_swap_future",
    requiredWallet: "solana_wallet",
    settlementAssets: ["USDC"],
    feeModel: "raven_platform_fee_future",
    routeSummary: "Future routed swaps may include a transparent Raven platform fee.",
    feeKind: "raven_platform_fee",
    feeCopy: "Raven fee when trading opens: Free 2.55% · Pro 1.78%; not charged in preview",
    targetFeeBps: { free: 255, pro: 178, maximum: 255 },
  }),
  base_evm_future: disabledAdapter({
    key: "base_evm_future",
    label: "Future Base routed swap",
    chain: "base",
    venue: "evm_aggregator_future",
    marketType: "spot",
    routeKind: "same_chain_swap_future",
    requiredWallet: "evm_wallet",
    settlementAssets: ["USDC"],
    feeModel: "raven_platform_fee_future",
    routeSummary: "Future routed swaps may include a transparent Raven platform fee.",
    feeKind: "raven_platform_fee",
    feeCopy: "Raven fee: not charged in preview",
  }),
  ethereum_evm_future: disabledAdapter({
    key: "ethereum_evm_future",
    label: "Future Ethereum routed swap",
    chain: "ethereum",
    venue: "evm_aggregator_future",
    marketType: "spot",
    routeKind: "same_chain_swap_future",
    requiredWallet: "evm_wallet",
    settlementAssets: ["USDC"],
    feeModel: "raven_platform_fee_future",
    routeSummary: "Future routed swaps may include a transparent Raven platform fee.",
    feeKind: "raven_platform_fee",
    feeCopy: "Raven fee: not charged in preview",
  }),
  avalanche_evm_future: disabledAdapter({
    key: "avalanche_evm_future",
    label: "Future Avalanche routed swap",
    chain: "avalanche",
    chainId: 43114,
    gasAsset: "AVAX",
    venue: "evm_aggregator_future",
    marketType: "spot",
    routeKind: "same_chain_swap_future",
    requiredWallet: "evm_wallet",
    settlementAssets: ["USDC"],
    feeModel: "raven_platform_fee_future",
    routeSummary: "Future Avalanche routed swaps may include a transparent Raven platform fee.",
    feeKind: "raven_platform_fee",
    feeCopy: "Raven fee: not charged in preview",
  }),
  hyperliquid_future: disabledAdapter({
    key: "hyperliquid_future",
    label: "Future Hyperliquid order",
    chain: "hyperliquid",
    venue: "hyperliquid",
    marketType: "perp",
    routeKind: "perp_order_future",
    requiredWallet: "hyperliquid_account",
    settlementAssets: ["USDC", "USD"],
    feeModel: "hyperliquid_builder_fee_future",
    routeSummary: "Future Hyperliquid orders may include a transparent builder fee.",
    feeKind: "hyperliquid_builder_fee",
    feeCopy: "Builder fee when trading opens: Free 0.10% · Pro 0.07%; not charged in preview",
    targetFeeBps: { free: 10, pro: 7, maximum: 10 },
  }),
  imperial_future: disabledAdapter({
    key: "imperial_future",
    label: "Imperial future perps route",
    chain: "imperial_future",
    venue: "imperial_future",
    marketType: "perp",
    routeKind: "perp_order_future",
    requiredWallet: "solana_wallet",
    settlementAssets: ["USDC"],
    feeModel: "hyperliquid_builder_fee_future",
    routeSummary: "Imperial perps routing is future coverage only.",
    feeKind: "future_builder_fee",
    feeCopy: "Builder fee: not charged in preview",
  }),
  paper_review: disabledAdapter({
    key: "paper_review",
    label: "Raven Paper review",
    chain: "raven_paper",
    venue: "raven_paper",
    marketType: "paper",
    routeKind: "paper_review",
    requiredWallet: "raven_paper",
    settlementAssets: ["USD"],
    feeModel: "none",
    routeSummary: "Paper review only. No wallet, signing, submission, broadcast, or custody.",
    feeKind: "none",
    feeCopy: "No fee: paper review only",
  }),
});

function adapterKeyFor({ lane, venue, instrument = {} } = {}) {
  const symbol = String(instrument.symbol || instrument.asset || "");
  const explicitMarketType = String(instrument.market_type || instrument.marketType || "").toLowerCase();
  const normalizedVenue = String(venue || instrument.venue || instrument.chain || "").toLowerCase();
  if (explicitMarketType === "paper" || lane === "paper" || normalizedVenue.includes("paper") || normalizedVenue.includes("raven_paper")) return "paper_review";
  if (explicitMarketType === "perp" || lane === "perps" || symbol.endsWith("-PERP")) return "hyperliquid_future";
  if (normalizedVenue.includes("base")) return "base_evm_future";
  if (normalizedVenue.includes("avalanche") || normalizedVenue.includes("avax")) return "avalanche_evm_future";
  if (normalizedVenue.includes("ethereum") || normalizedVenue === "eth") return "ethereum_evm_future";
  if (normalizedVenue.includes("imperial")) return "imperial_future";
  if (normalizedVenue.includes("hyperliquid") && explicitMarketType !== "spot") return "hyperliquid_future";
  return "solana_jupiter_future";
}

function marketTypeFor({ lane, instrument = {} } = {}) {
  const symbol = String(instrument.symbol || instrument.asset || "");
  const explicitMarketType = String(instrument.market_type || instrument.marketType || "").toLowerCase();
  if (["spot", "perp", "paper"].includes(explicitMarketType)) return explicitMarketType;
  if (lane === "paper") return "paper";
  return lane === "perps" || symbol.endsWith("-PERP") ? "perp" : "spot";
}

function cleanSymbol(value) {
  const cleaned = String(value || "")
    .trim()
    .replace(/^(solana|base|ethereum|eth|avalanche|avax|hyperliquid|monad):/i, "")
    .replace(/\s+spot$/i, "")
    .toUpperCase();
  return cleaned.includes("/") ? cleaned.split("/")[0] : cleaned;
}

function candidateFromAdapter({ symbol, adapterKey, routeStatus = "preview_available", quoteAsset = "USDC", displayName = null, evidenceContext = {} }) {
  const adapter = adapters[adapterKey];
  const capabilities = adapter.getCapabilities();
  const settlement = capabilities.supported_settlement_assets[0] || "unknown";
  const chain = capabilities.chain;
  return {
    id: `${chain}:${symbol}:${capabilities.market_type}`,
    symbol,
    display_name: displayName || symbol,
    market_type: capabilities.market_type,
    chain,
    venue: capabilities.venue,
    settlement_asset: settlement,
    quote_asset: quoteAsset,
    source_chain: chain,
    target_chain: chain,
    required_wallet: capabilities.required_wallet,
    adapter_id: adapterKey,
    route_kind: capabilities.route_kind,
    route_status: routeStatus,
    fee_model: capabilities.fee_model,
    evidence_context: {
      actor_evidence_available: Boolean(evidenceContext.actor_evidence_available),
      replay_available: Boolean(evidenceContext.replay_available ?? true),
      paper_state_available: Boolean(evidenceContext.paper_state_available),
    },
  };
}

function resolveInstrumentCandidates(input = "", context = {}) {
  const explicitMarketType = String(context.instrument?.market_type || context.instrument?.marketType || "").toLowerCase();
  const lane = explicitMarketType === "spot" ? "spot" : explicitMarketType === "perp" ? "perps" : explicitMarketType === "paper" ? "paper" : context.lane || "spot";
  const requestedChain = normalizeChain(context.chain || context.venue || "");
  const symbol = cleanSymbol(input || context.symbol || context.instrument?.symbol || context.instrument?.asset || "");
  if (!symbol) {
    return [candidateFromAdapter({ symbol: "UNKNOWN", adapterKey: "paper_review", routeStatus: "coverage_developing", displayName: "Coverage developing" })];
  }
  if (lane === "paper" || requestedChain === "raven_paper") {
    return [candidateFromAdapter({ symbol, adapterKey: "paper_review", routeStatus: "preview_available", displayName: `${symbol} paper review`, evidenceContext: { paper_state_available: true, replay_available: true } })];
  }
  if (symbol.endsWith("-PERP") || lane === "perps" || requestedChain === "hyperliquid") {
    return [candidateFromAdapter({ symbol: symbol.endsWith("-PERP") ? symbol : `${symbol}-PERP`, adapterKey: "hyperliquid_future", routeStatus: "preview_available", evidenceContext: { actor_evidence_available: true, replay_available: true, paper_state_available: true } })];
  }
  if (requestedChain === "base") {
    return [candidateFromAdapter({ symbol, adapterKey: "base_evm_future", routeStatus: "coverage_developing", displayName: `${symbol} · Base spot`, evidenceContext: { actor_evidence_available: true, replay_available: true } })];
  }
  if (requestedChain === "ethereum") {
    return [candidateFromAdapter({ symbol, adapterKey: "ethereum_evm_future", routeStatus: "coverage_developing", displayName: `${symbol} · Ethereum spot`, evidenceContext: { actor_evidence_available: true, replay_available: true } })];
  }
  if (requestedChain === "avalanche") {
    return [candidateFromAdapter({ symbol, adapterKey: "avalanche_evm_future", routeStatus: "coverage_developing", displayName: `${symbol} · Avalanche spot`, evidenceContext: { actor_evidence_available: true, replay_available: true } })];
  }
  if (requestedChain === "monad_future") {
    return [{
      id: `monad_future:${symbol}:spot`,
      symbol,
      display_name: `${symbol} · Monad future`,
      market_type: "spot",
      chain: "monad_future",
      venue: "future",
      settlement_asset: "unknown",
      quote_asset: "unknown",
      source_chain: "monad_future",
      target_chain: "monad_future",
      required_wallet: "unsupported",
      adapter_id: null,
      route_kind: "unsupported",
      route_status: "future",
      fee_model: "unknown",
      evidence_context: { actor_evidence_available: false, replay_available: false, paper_state_available: false },
    }];
  }
  if (/^[A-Z0-9_.$-]{2,20}$/.test(symbol)) {
    return [candidateFromAdapter({ symbol, adapterKey: "solana_jupiter_future", routeStatus: symbol === "JUP" || symbol === "SOL" ? "coverage_developing" : "coverage_developing", displayName: `${symbol} · Solana spot`, evidenceContext: { actor_evidence_available: true, replay_available: true } })];
  }
  return [{
    id: `unsupported:${symbol}`,
    symbol,
    display_name: `${symbol} coverage developing`,
    market_type: "spot",
    chain: "unsupported",
    venue: "unsupported",
    settlement_asset: "unknown",
    quote_asset: "unknown",
    source_chain: "unsupported",
    target_chain: "unsupported",
    required_wallet: "unsupported",
    adapter_id: null,
    route_kind: "unsupported",
    route_status: "unsupported",
    fee_model: "unknown",
    evidence_context: { actor_evidence_available: false, replay_available: false, paper_state_available: false },
  }];
}

function buildManagementTemplate({ instrument = {}, marketType = "spot" } = {}) {
  return {
    template_id: `preview_${marketType}_replay_management`,
    label: "Similar-history sample forming",
    style: "wide_confirmation",
    source: "insufficient_sample",
    similar_context_count: null,
    median_mfe_pct: null,
    median_mae_pct: null,
    false_positive_window: "forming",
    survival_band: "forming",
    common_failure_zone: "forming",
    tp1_context: "forming",
    tp2_context: "forming",
    stop_context: "forming",
    trail_context: "forming",
    confidence: "evidence forming",
    caveat: "TP/SL templates are historical context only and are not applied automatically.",
    instrument: instrument.symbol || instrument.asset || null,
  };
}

function createReviewState(input = {}) {
  const instrument = input.instrument || {};
  const lane = input.lane || (String(instrument.symbol || instrument.asset || "").endsWith("-PERP") ? "perps" : "spot");
  const requestedVenue = input.venue || instrument.venue || instrument.chain || "";
  const candidates = resolveInstrumentCandidates(instrument.symbol || instrument.asset || input.symbol, {
    lane,
    venue: requestedVenue,
    chain: input.chain || instrument.chain,
    instrument,
  });
  const resolvedInstrument = input.resolvedInstrument || candidates[0];
  const marketType = marketTypeFor({ lane, instrument });
  const adapterKey = input.adapterKey || resolvedInstrument?.adapter_id || adapterKeyFor({ lane, venue: input.venue, instrument });
  const adapter = adapters[adapterKey] || adapters.solana_jupiter_future;
  const fee = adapter.explainFees();
  const capabilities = adapter.getCapabilities();
  const isPerp = marketType === "perp";
  const sourceChain = resolvedInstrument?.source_chain || capabilities.chain || normalizeChain(instrument.chain || input.chain || adapter.chain);
  const targetChain = resolvedInstrument?.target_chain || sourceChain;
  const requiredWallet = resolvedInstrument?.required_wallet || capabilities.required_wallet;
  const routeKind = resolvedInstrument?.route_kind || capabilities.route_kind;
  const routeStatus = resolvedInstrument?.route_status || "preview_available";
  const settlementAsset = resolvedInstrument?.settlement_asset || capabilities.supported_settlement_assets?.[0] || (isPerp ? "USDC" : "USDC");
  const gasAsset = capabilities.gas_asset || (marketType === "spot" && sourceChain === "avalanche" ? "AVAX" : marketType === "spot" && sourceChain === "ethereum" ? "ETH" : marketType === "spot" && sourceChain === "base" ? "ETH" : marketType === "spot" && sourceChain === "solana" ? "SOL" : null);
  const feeStatus = fee.fee_kind === "none" ? "unavailable" : "not_charged_in_preview";
  return {
    schema_version: "ravenos_quote_review_foundation.v2",
    review_mode: "quote_only",
    execution_status: "signing_disabled",
    market_type: marketType,
    venue: adapter.venue,
    adapter: adapter.key,
    adapter_label: adapter.label,
    side: input.side || (isPerp ? "long" : "buy"),
    order_type: input.orderType || "market",
    instrument: {
      id: resolvedInstrument?.id || `${sourceChain}:${instrument.symbol || instrument.asset || "UNKNOWN"}`,
      symbol: instrument.symbol || instrument.asset || resolvedInstrument?.symbol || "UNKNOWN",
      display_name: resolvedInstrument?.display_name || instrument.display_name || instrument.symbol || instrument.asset || "UNKNOWN",
      chain: sourceChain,
      venue: adapter.venue,
      market_type: marketType,
      settlement_asset: settlementAsset,
      quote_asset: resolvedInstrument?.quote_asset || (isPerp ? "USD" : "USDC"),
      source_chain: sourceChain,
      target_chain: targetChain,
      required_wallet: requiredWallet,
      adapter_id: adapter.key,
      route_kind: routeKind,
      route_status: routeStatus,
      contract_address: instrument.contract_address || null,
      pair_address: instrument.pair_address || null,
    },
    resolved_markets: candidates,
    chain_context: {
      source_chain: sourceChain,
      target_chain: targetChain,
      venue: adapter.venue,
      market_type: marketType,
      required_wallet: requiredWallet,
      route_kind: routeKind,
      route_status: routeStatus,
      settlement_asset: settlementAsset,
      display_currency: isPerp ? "USD" : "USDC",
      chain_id: capabilities.chain_id || null,
      gas_asset: gasAsset,
    },
    funding_context: {
      source_balance_type: adapter.key === "paper_review" ? "paper" : "external_wallet",
      gas_required: marketType === "spot" ? true : marketType === "perp" ? false : "unknown",
      gas_sponsored: false,
      bridge_required: false,
      gas_asset: gasAsset,
    },
    quote_fields: {
      input_asset: isPerp ? null : "USDC",
      output_asset: isPerp ? null : instrument.symbol || instrument.asset || resolvedInstrument?.symbol || "selected token",
      input_amount: "preview only",
      estimated_output: "unavailable",
      price_impact: "unavailable",
      slippage_bps: isPerp ? null : "preview only",
      network_fee_estimate: "unavailable",
      venue_fee_estimate: "unavailable",
      raven_fee_bps: fee.fee_kind === "raven_platform_fee" ? "future configurable" : null,
      raven_fee_estimate: fee.fee_kind === "raven_platform_fee" ? "not charged in preview" : null,
      builder_fee_bps: fee.target_fee_bps,
      builder_fee_estimate: fee.fee_kind.includes("builder") ? "not charged in preview" : null,
      route_summary: adapter.routeSummary || fee.display,
      quote_timestamp: null,
      quote_expiry: null,
      quote_source: "disabled preview adapter",
      quote_status: "unavailable",
      settlement_asset: settlementAsset,
      display_currency: isPerp ? "USD" : "USDC",
    },
    perps_fields: {
      mark_price: input.mark_price ?? null,
      oracle_price: null,
      leverage: isPerp ? "preview only" : null,
      margin_mode: isPerp ? "preview only" : null,
      margin_required: isPerp ? "unavailable" : null,
      liquidation_estimate: isPerp ? "unavailable" : null,
      funding: input.funding || (isPerp ? "forming" : null),
      open_interest: input.open_interest || (isPerp ? "forming" : null),
      reduce_only: isPerp ? "preview only" : null,
      tp_sl_template: isPerp ? "History-based management preview" : null,
    },
    fee_disclosure: {
      fee_kind: fee.fee_kind,
      display: fee.display,
      target_fee_bps: fee.target_fee_bps,
      charged_now: false,
      preview_label: fee.preview_label,
      raven_platform_fee_bps: fee.fee_kind === "raven_platform_fee" ? "future configurable" : null,
      raven_platform_fee_estimate: fee.fee_kind === "raven_platform_fee" ? "not charged in preview" : null,
      hyperliquid_builder_fee_bps: fee.fee_kind === "hyperliquid_builder_fee" ? fee.target_fee_bps : null,
      hyperliquid_builder_fee_estimate: fee.fee_kind === "hyperliquid_builder_fee" ? "not charged in preview" : null,
      venue_fee_estimate: "unavailable",
      network_fee_estimate: "unavailable",
      fee_status: feeStatus,
    },
    execution_boundary: { ...SAFETY_FIELDS },
    raven_read_summary: input.raven_read_summary || "Current read is evidence context only.",
    actor_evidence_summary: input.actor_evidence_summary || "Actor evidence is forming.",
    replay_management_template: buildManagementTemplate({ instrument, marketType }),
    safety_fields: { ...SAFETY_FIELDS },
    status: "preview_only",
  };
}

function buildReviewPacket(state = createReviewState()) {
  const symbol = String(state.instrument?.symbol || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
  const venue = String(state.venue || "venue").toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return {
    packet_id: `preview_${venue}_${symbol}`,
    created_at: new Date().toISOString(),
    instrument: state.instrument,
    venue: state.venue,
    adapter: state.adapter,
    side: state.side,
    order_type: state.order_type,
    quote_fields: state.quote_fields,
    perps_fields: state.perps_fields,
    chain_context: state.chain_context,
    funding_context: state.funding_context,
    fee_disclosure: state.fee_disclosure,
    execution_boundary: state.execution_boundary || state.safety_fields,
    resolved_markets: state.resolved_markets || [],
    raven_read_summary: state.raven_read_summary,
    actor_evidence_summary: state.actor_evidence_summary,
    replay_management_template: state.replay_management_template,
    safety_fields: state.safety_fields,
    status: "preview_only",
    no_order_submitted: true,
  };
}

export {
  adapters,
  adapterKeyFor,
  buildManagementTemplate,
  buildReviewPacket,
  createReviewState,
  displayChain,
  feeModelLabel,
  requiredWalletLabel,
  resolveInstrumentCandidates,
  routeStatusLabel,
  SAFETY_FIELDS,
};

if (typeof window !== "undefined") {
  window.RavenTerminalReviewFoundation = Object.freeze({
    adapters,
    adapterKeyFor,
    buildManagementTemplate,
    buildReviewPacket,
    createReviewState,
    displayChain,
    feeModelLabel,
    requiredWalletLabel,
    resolveInstrumentCandidates,
    routeStatusLabel,
    SAFETY_FIELDS,
  });
}
