export const CapabilityNames = Object.freeze([
  "market_swap",
  "exact_in",
  "exact_out",
  "limit_order",
  "stop_loss",
  "take_profit",
  "OCO",
  "OTOCO",
  "partial_fill",
  "cancel_order",
  "amend_order",
  "native_token",
  "fee_support",
  "transaction_simulation",
]);

export const ProviderCapabilities = Object.freeze({
  jupiter_swap_quote_only: Object.freeze({
    provider: "JupiterSwapProvider",
    chain: "solana",
    status: "scaffolded",
    capabilities: Object.freeze({
      market_swap: true,
      exact_in: true,
      exact_out: false,
      limit_order: false,
      stop_loss: false,
      take_profit: false,
      OCO: false,
      OTOCO: false,
      partial_fill: false,
      cancel_order: false,
      amend_order: false,
      native_token: true,
      fee_support: false,
      transaction_simulation: false,
    }),
  }),
  jupiter_trigger_scaffold: Object.freeze({
    provider: "JupiterTriggerProvider",
    chain: "solana",
    status: "interface_only",
    capabilities: Object.freeze({
      market_swap: false,
      exact_in: false,
      exact_out: false,
      limit_order: true,
      stop_loss: true,
      take_profit: true,
      OCO: true,
      OTOCO: false,
      partial_fill: false,
      cancel_order: true,
      amend_order: false,
      native_token: true,
      fee_support: false,
      transaction_simulation: false,
    }),
  }),
  zerox_swap_scaffold: Object.freeze({
    provider: "ZeroXSwapProvider",
    chain: "base",
    status: "interface_only",
    capabilities: Object.freeze({
      market_swap: true,
      exact_in: true,
      exact_out: false,
      limit_order: false,
      stop_loss: false,
      take_profit: false,
      OCO: false,
      OTOCO: false,
      partial_fill: false,
      cancel_order: false,
      amend_order: false,
      native_token: true,
      fee_support: false,
      transaction_simulation: false,
    }),
  }),
  base_conditional_order_scaffold: Object.freeze({
    provider: "BaseConditionalOrderProvider",
    chain: "base",
    status: "interface_only",
    capabilities: Object.freeze({
      market_swap: false,
      exact_in: false,
      exact_out: false,
      limit_order: false,
      stop_loss: false,
      take_profit: false,
      OCO: false,
      OTOCO: false,
      partial_fill: false,
      cancel_order: false,
      amend_order: false,
      native_token: false,
      fee_support: false,
      transaction_simulation: false,
    }),
  }),
});

export function capabilityFor(providerKey, capability) {
  const provider = ProviderCapabilities[providerKey];
  if (!provider) return false;
  if (!CapabilityNames.includes(capability)) return false;
  return Boolean(provider.capabilities[capability]);
}

export function activeOrderTypes(providerKey) {
  const provider = ProviderCapabilities[providerKey];
  if (!provider) return [];
  const caps = provider.capabilities;
  const out = [];
  if (caps.market_swap) out.push("market");
  if (caps.limit_order) out.push("limit");
  if (caps.stop_loss) out.push("stop_loss");
  if (caps.take_profit) out.push("take_profit");
  if (caps.OCO) out.push("oco");
  if (caps.OTOCO) out.push("otoco");
  return out;
}
