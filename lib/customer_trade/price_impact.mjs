// 0x v2 does not return price impact. Compare the net execution value with the
// existing exact-token USD snapshot instead. This is an estimate including fees,
// spread, snapshot drift and the accounting asset's USD-peg assumption; it is not
// a proof of pool-only price impact. No additional provider request is made.
export function estimateEvmPriceImpact({ market, quote, side, tokenDecimals, accountingDecimals = 6, notionalBaseUnits, now = Date.now() } = {}) {
  const observedAt = Date.parse(market?.lastUpdated || "");
  const price = Number(market?.priceUsd);
  const binding = quote?.exact_binding;
  if (!Number.isFinite(observedAt) || now - observedAt > 60_000 || observedAt > now + 5_000
    || !Number.isFinite(price) || price <= 0 || !["buy", "sell"].includes(side)
    || !Number.isSafeInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 18
    || !Number.isSafeInteger(accountingDecimals) || accountingDecimals < 0 || accountingDecimals > 18) return null;
  const amount = (raw, decimals) => /^[0-9]{1,80}$/.test(String(raw ?? "")) ? Number(raw) / 10 ** decimals : NaN;
  const inputValue = side === "buy" ? amount(notionalBaseUnits, accountingDecimals)
    : amount(binding?.sell_amount_base_units, tokenDecimals) * price;
  const outputValue = side === "buy" ? amount(binding?.buy_amount_base_units, tokenDecimals) * price
    : amount(binding?.buy_amount_base_units, accountingDecimals);
  if (!Number.isFinite(inputValue) || inputValue <= 0 || !Number.isFinite(outputValue) || outputValue <= 0) return null;
  return Object.freeze({
    bps: Math.max(0, Math.round((1 - outputValue / inputValue) * 10_000)),
    method: "net_execution_value_vs_exact_token_usd_snapshot",
    estimated: true,
    includes_fees_and_spread: true,
    assumes_accounting_asset_usd_peg: true,
    reference_observed_at: new Date(observedAt).toISOString(),
    reference_source: String(market.provider || "Market snapshot"),
  });
}
