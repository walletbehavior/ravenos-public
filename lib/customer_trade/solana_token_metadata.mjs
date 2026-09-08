import { normalizeSolanaWalletAddress } from "./solana_wallet_intelligence.mjs";

export const SOLANA_TOKEN_METADATA_LIMIT = 64;
const label = (value, limit) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "").trim().slice(0, limit) || null : null;
const fixed = (units, decimals) => {
  const value = units.toString().padStart(decimals + 1, "0");
  return decimals ? `${value.slice(0, -decimals)}.${value.slice(-decimals)}` : value;
};

// Decimal provider marks are indicative, never execution or historical prices.
// Expand scientific notation before integer arithmetic; value rounds down to micro-USD.
export function priceFraction(value) {
  if (!["string", "number"].includes(typeof value) || !Number.isFinite(Number(value)) || Number(value) <= 0 || Number(value) > 1e12) return null;
  const match = /^(\d{1,32})(?:\.(\d{1,30}))?(?:[eE]([+-]?\d{1,2}))?$/.exec(String(value));
  if (!match) return null;
  const scale = (match[2]?.length || 0) - Number(match[3] || 0);
  if (Math.abs(scale) > 30) return null;
  const units = BigInt(match[1] + (match[2] || ""));
  return scale < 0 ? { units: units * 10n ** BigInt(-scale), scale: 0 } : { units, scale };
}

export function markedSolanaToken(token, metadata) {
  if (!metadata || metadata.mint !== token.mint || metadata.decimals !== token.decimals) return token;
  const price = priceFraction(metadata.provider_mark_price_usd);
  let value = null;
  if (price && /^\d{1,30}$/.test(token.balance_base_units || "")) {
    const micros = BigInt(token.balance_base_units) * price.units * 1000000n / (10n ** BigInt(token.decimals + price.scale));
    value = fixed(micros, 6);
  }
  return { ...token, symbol: metadata.symbol, name: metadata.name,
    provider_mark_price_usd: price ? fixed(price.units, price.scale) : null,
    provider_mark_value_usd: value, metadata_observed_at: metadata.observed_at,
    mark_source: "helius_das", mark_cache_seconds: 600, executable_valuation_available: false };
}

export function solanaHoldingsMarkSummary(tokens = []) {
  const marked = tokens.filter(token => /^\d+\.\d{6}$/.test(token.provider_mark_value_usd || ""));
  const micros = marked.reduce((sum, token) => sum + BigInt(token.provider_mark_value_usd.replace(".", "")), 0n);
  return { visible_provider_mark_value_usd: marked.length ? fixed(micros, 6) : null,
    visible_priced_rows: marked.length, visible_unpriced_rows: tokens.length - marked.length,
    scope: "priced_tokens_only_excludes_native_balance", executable_valuation_available: false };
}

export function createSolanaTokenMetadataLoader({ rpc, cache = new Map() }) {
  // Public mint data only. Never cache wallet identifiers, keys or provider error bodies.
  return async ({ mints = [], now = Math.floor(Date.now() / 1000) }) => {
    const valid = [...new Set(mints.flatMap(mint => {
      try { return [normalizeSolanaWalletAddress(mint)]; } catch { return []; }
    }))];
    const ids = valid.slice(0, SOLANA_TOKEN_METADATA_LIMIT);
    for (const [mint, row] of cache) if (row.expires_at <= now) cache.delete(mint);
    const missing = ids.filter(mint => !cache.has(mint));
    let failed = false;
    if (missing.length) {
      try {
        const result = await rpc("getAssetBatch", { ids: missing, options: { showFungible: true } });
        if (!Array.isArray(result) || result.length > missing.length) throw new Error("invalid_metadata");
        const rows = new Map();
        for (const asset of result) {
          if (asset === null) continue;
          if (!missing.includes(asset?.id) || rows.has(asset.id)) throw new Error("invalid_metadata_identity");
          rows.set(asset.id, null);
          const token = asset.token_info;
          if (!["FungibleToken", "FungibleAsset"].includes(asset.interface) || !Number.isInteger(token?.decimals) || token.decimals < 0 || token.decimals > 18) continue;
          const price = token.price_info?.currency === "USD" ? priceFraction(token.price_info.price_per_token) : null;
          rows.set(asset.id, { mint: asset.id, symbol: label(token.symbol || asset.content?.metadata?.symbol, 32),
            name: label(asset.content?.metadata?.name, 80), decimals: token.decimals,
            provider_mark_price_usd: price ? fixed(price.units, price.scale) : null,
            observed_at: new Date(now * 1000).toISOString(), provider: "helius_das" });
        }
        for (const mint of missing) {
          while (cache.size >= 512) cache.delete(cache.keys().next().value);
          cache.set(mint, { value: rows.get(mint) || null, expires_at: now + (rows.get(mint) ? 600 : 60) });
        }
      } catch { failed = true; }
    }
    const rows = ids.flatMap(mint => cache.get(mint)?.value ? [cache.get(mint).value] : []);
    return { schema_version: "ravenos.solana_token_metadata.v1", rows, requested: ids.length,
      truncated: valid.length > ids.length, state: failed ? "unavailable" : rows.length === ids.length ? "available" : "partial",
      provider_request_performed: missing.length > 0, provider: "helius_das", price_cache_seconds: 600,
      executable_valuation_available: false };
  };
}
