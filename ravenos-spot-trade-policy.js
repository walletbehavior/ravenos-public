// Shared by the terminal and its spot quote/prepare adapters. Basis points.
export const DEFAULT_SPOT_SLIPPAGE_BPS = 300;
export const MIN_SPOT_SLIPPAGE_BPS = 5;
export const MAX_SPOT_SLIPPAGE_BPS = 1_000;
export const SPOT_PRICE_WARNING_BPS = 500;

export function spotPriceWarnings({ slippageBps, priceImpactBps } = {}) {
  const warnings = [];
  if (Number.isFinite(slippageBps) && slippageBps > SPOT_PRICE_WARNING_BPS) {
    warnings.push(`High slippage: ${(slippageBps / 100).toFixed(2)}%. Your execution price may move by this much before the trade fails.`);
  }
  if (Number.isFinite(priceImpactBps) && priceImpactBps > SPOT_PRICE_WARNING_BPS) {
    warnings.push(`High price impact: ${(priceImpactBps / 100).toFixed(2)}%. This order is large relative to available liquidity. A smaller amount may improve your price.`);
  }
  return warnings;
}
