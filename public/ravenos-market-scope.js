// Market sections are presentation boundaries, never execution permissions.
// Exact instrument identity takes precedence over symbols (a meme can also have a perp).
export const MARKET_SCOPES = Object.freeze({ memecoins: "Onchain", perps: "Perps", equities: "Atlas" });
export function normalizeMarketScope(value, fallback = "memecoins") {
  return Object.hasOwn(MARKET_SCOPES, value || "") ? value : fallback;
}
// Classify the selected asset only. A stock-token quote never changes the
// category of the coin being discovered. This is presentation, not issuer
// verification or authority to trade a security. Bare tickers are ambiguous.
export function isTokenizedEquity(row = {}) {
  const primary = row.subject || row.instrument_contract || (typeof row.instrument === 'object' ? row.instrument : row);
  const type = String(primary.asset_class || primary.assetClass || primary.instrument_type || primary.market_type || '').toLowerCase();
  if (['tokenized_equity', 'tokenized_stock', 'stock_token'].includes(type)) return true;
  const name = String(primary.name || primary.token_name || '').trim();
  return /\S\s+xstocks?$/i.test(name) || /\s[-–—]\s*Backpack Securities$/i.test(name) || /\S\s*[•·]\s*Robinhood Token$/i.test(name);
}
// Zcash belongs to Portfolio capital tools or its exact perp market. Only the
// primary asset is considered: a coin paired with ZEC remains discoverable.
// These are presentation labels, never proof of a shielded balance or issuer.
export function isZcashAsset(row = {}) {
  const primary = row.subject || row.instrument_contract || (typeof row.instrument === 'object' ? row.instrument : row);
  const symbol = String(primary.symbol || primary.base_symbol || primary.baseAsset || primary.label || '').split('/')[0].trim().toUpperCase();
  const name = String(primary.name || primary.token_name || '').trim();
  const chain = String(primary.chain_id || primary.chain || row.chain_id || row.chain || '').toLowerCase();
  const address = primary.token_address || primary.tokenAddress || primary.address;
  return ['ZEC', 'WZEC', 'ZCASH'].includes(symbol)
    || /^(?:(?:wrapped|bridged)\s+)?zcash(?:\s*\(ZEC\))?$/i.test(name)
    || (chain === 'solana' && address === 'A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS');
}
export function instrumentMarketScope(row = {}) {
  const subject = row.subject || row.instrument_contract || (typeof row.instrument === "object" ? row.instrument : row);
  const id = String(subject.instrument_id || subject.instrumentId || subject.id || row.instrument_id || row.key || "").toLowerCase();
  const type = String(subject.instrumentType || subject.instrument_type || subject.marketType || subject.market_type || row.market_type || row.lane || "").toLowerCase();
  const chain = String(subject.chain || row.chain_id || row.chain || "").toLowerCase();
  if (id.startsWith("hyperliquid:perp:") || ["perp", "perps", "perpetual", "perpetuals"].includes(type)) return "perps";
  if (/^(equity|etf):/.test(id) || ["equity", "etf", "equities", "tokenized_equity"].includes(type) || ["equity", "etf", "tokenized_equity"].includes(subject.asset_class || subject.assetClass) || isTokenizedEquity(row)) return "equities";
  if (isZcashAsset(row)) return null;
  if (id.includes(":pool:") || ["spot", "spot_pool", "exact_pool", "token", "pool", "crypto_spot"].includes(type)) return "memecoins";
  if (chain && chain !== "hyperliquid" && (row.pool_address || row.pairAddress || subject.poolAddress)) return "memecoins";
  return null;
}
export function matchesMarketScope(row, scope) {
  return instrumentMarketScope(row) === normalizeMarketScope(scope);
}
export function marketScopeFromSearch(search = "", pathname = "", fallback = "memecoins") {
  const params = new URLSearchParams(search);
  if (pathname === "/perps/") return "perps";
  if (pathname === "/atlas/") return "equities";
  const explicit = normalizeMarketScope(params.get("market_scope"), null);
  if (explicit) return explicit;
  if (/^[A-Z0-9._-]+-PERP$/i.test(params.get("asset") || "")) return "perps";
  return instrumentMarketScope({
    instrument_id: params.get("instrument_id") || params.get("subject_id"),
    instrument_type: params.get("instrument_type") || params.get("market") || params.get("lane"),
    asset_class: params.get("asset_class"),
  }) || normalizeMarketScope(fallback);
}
export function participationMarketScope(row = {}) {
  // Older public projections encode chain and cap band in a deterministic ID.
  const parts = String(row.insight_id || "").split(":");
  const chain = String(row.chain || parts[1] || "").toLowerCase();
  const band = String(row.cap_band || row.capitalization_band || parts[2] || "").toLowerCase();
  if (chain === "hyperliquid" || band.startsWith("perps_")) return "perps";
  if (chain === "all" && ["all", "micro", "small", "mid", "large", "mega", "fresh_pairs", "live_activity", "high-velocity tokens"].includes(band)) return "memecoins";
  if (["solana", "robinhood", "base", "bsc", "ethereum", "arbitrum", "avalanche", "polygon", "pulsechain", "eth", "bnb", "rh", "avax"].includes(chain)) return "memecoins";
  return null;
}
