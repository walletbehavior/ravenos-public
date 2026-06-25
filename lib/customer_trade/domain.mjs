export const Chains = Object.freeze(["solana", "base"]);
export const OrderTypes = Object.freeze(["market", "limit", "stop_loss", "take_profit", "oco", "otoco"]);
export const Sides = Object.freeze(["buy", "sell"]);
export const ExactModes = Object.freeze(["exact_in", "exact_out"]);

export function stableClientId(prefix = "intent") {
  const rand = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${rand}`;
}

export function redactAddress(value) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 12) return text;
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

export function normalizeConnectedWallet(input = {}) {
  const chain = String(input.chain || "solana").toLowerCase();
  if (!Chains.includes(chain)) throw new Error("unsupported_wallet_chain");
  const address = String(input.address || input.publicKey || "").trim();
  return {
    wallet_id: input.wallet_id || (address ? `local:${chain}:${redactAddress(address)}` : ""),
    public_address: address,
    display_address: redactAddress(address),
    wallet_type: String(input.wallet_type || input.provider || "unknown"),
    chain,
    connection_state: address ? "connected" : "disconnected",
    network: String(input.network || (chain === "solana" ? "mainnet-beta" : "base")),
    session_started_at: input.session_started_at || new Date().toISOString(),
  };
}

export function normalizeTradeAsset(input = {}) {
  const chain = String(input.chain || "").toLowerCase();
  if (!Chains.includes(chain)) throw new Error("unsupported_asset_chain");
  const address = String(input.address || input.mint || "").trim();
  return {
    chain,
    address,
    symbol: String(input.symbol || "UNKNOWN").toUpperCase(),
    decimals: Number.isFinite(Number(input.decimals)) ? Number(input.decimals) : null,
    verification_state: String(input.verification_state || "unknown"),
    source: String(input.source || "user"),
    risk_flags: Array.isArray(input.risk_flags) ? input.risk_flags.map(String) : [],
  };
}

export function createTradeQuoteRequest(input = {}) {
  const chain = String(input.chain || "").toLowerCase();
  if (!Chains.includes(chain)) throw new Error("unsupported_quote_chain");
  const exactMode = String(input.exact_mode || "exact_in");
  if (!ExactModes.includes(exactMode)) throw new Error("unsupported_exact_mode");
  const orderType = String(input.order_type || "market");
  if (!OrderTypes.includes(orderType)) throw new Error("unsupported_order_type");
  return {
    chain,
    wallet: input.wallet || null,
    input_asset: normalizeTradeAsset(input.input_asset || { chain }),
    output_asset: normalizeTradeAsset(input.output_asset || { chain }),
    amount: String(input.amount || "0"),
    exact_mode: exactMode,
    slippage_bps: Math.max(0, Math.min(5000, Number(input.slippage_bps || 50))),
    order_type: orderType,
  };
}

export function createTradeQuote(input = {}) {
  return {
    provider: String(input.provider || "unknown"),
    quote_id: String(input.quote_id || stableClientId("quote")),
    input_amount: String(input.input_amount || "0"),
    expected_output: String(input.expected_output || "0"),
    minimum_received: String(input.minimum_received || "0"),
    price_impact_pct: Number(input.price_impact_pct || 0),
    provider_fee: input.provider_fee || { amount: "0", token: "", bps: 0 },
    raven_fee: input.raven_fee || { amount: "0", token: "", bps: 0, enabled: false },
    network_fee_estimate: input.network_fee_estimate || { amount: "0", token: "" },
    route: Array.isArray(input.route) ? input.route : [],
    quote_expiry: input.quote_expiry || null,
    warnings: Array.isArray(input.warnings) ? input.warnings.map(String) : [],
    liquidity_available: Boolean(input.liquidity_available),
    source_timestamp: input.source_timestamp || new Date().toISOString(),
    status: String(input.status || "ready"),
  };
}

export function createTradeIntent(input = {}) {
  return {
    client_intent_id: String(input.client_intent_id || stableClientId("intent")),
    wallet: input.wallet || null,
    chain: String(input.chain || "solana").toLowerCase(),
    asset_pair: input.asset_pair || null,
    order_type: String(input.order_type || "market"),
    requested_amount: String(input.requested_amount || "0"),
    quote_id: input.quote_id || null,
    created_at: input.created_at || new Date().toISOString(),
    expires_at: input.expires_at || null,
    status: String(input.status || "draft"),
    audit: Array.isArray(input.audit) ? input.audit : [],
  };
}

export function createTradePlan(input = {}) {
  return {
    plan_id: String(input.plan_id || stableClientId("plan")),
    owner_scope: String(input.owner_scope || "local_device"),
    entry: input.entry || { type: "market", price: null },
    take_profits: Array.isArray(input.take_profits) ? input.take_profits : [],
    stop: input.stop || { type: "percentage", value_pct: null },
    runner_pct: input.runner_pct ?? null,
    expiry: input.expiry || null,
    raven_suggestion_metadata: input.raven_suggestion_metadata || null,
    user_modifications: Array.isArray(input.user_modifications) ? input.user_modifications : [],
    status: String(input.status || "draft"),
    notes: String(input.notes || ""),
  };
}

export const SavedSchemeTemplates = Object.freeze([
  {
    id: "quick_risk",
    name: "Quick Risk",
    stop_pct: 8,
    take_profits: [{ value_pct: 18, sell_pct: 60 }],
    runner_pct: 40,
  },
  {
    id: "ladder",
    name: "Ladder",
    stop_pct: 10,
    take_profits: [
      { value_pct: 20, sell_pct: 35 },
      { value_pct: 45, sell_pct: 35 },
      { value_pct: 90, sell_pct: 20 },
    ],
    runner_pct: 10,
  },
  {
    id: "parabolic",
    name: "Parabolic",
    stop_pct: 14,
    take_profits: [
      { value_pct: 35, sell_pct: 30 },
      { value_pct: 100, sell_pct: 30 },
      { value_pct: 250, sell_pct: 25 },
    ],
    runner_pct: 15,
  },
]);
