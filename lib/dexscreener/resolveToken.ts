import { pairByAddress, searchPairs, tokenPairs, tokenPairsByAddress } from "./client";
import type { DexscreenerPair, RavenDexscreenerResult } from "./types";

const SOLANA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
const EVM_CHAINS = ["base", "ethereum", "arbitrum", "optimism", "bsc", "polygon"];
const QUOTE_RANK: Record<string, number> = {
  USDC: 90,
  USDT: 85,
  SOL: 80,
  WETH: 80,
  ETH: 75,
  WSOL: 75,
};

function n(value: unknown): number {
  const out = Number(value);
  return Number.isFinite(out) ? out : 0;
}

export function normalizePair(pair: DexscreenerPair): RavenDexscreenerResult {
  const base = pair.baseToken || {};
  const quote = pair.quoteToken || {};
  return {
    id: `${pair.chainId || "unknown"}:${pair.pairAddress || base.address || ""}`,
    chainId: pair.chainId || "unknown",
    dexId: pair.dexId || "unknown",
    pairAddress: pair.pairAddress || "",
    tokenAddress: base.address || "",
    symbol: base.symbol || "UNKNOWN",
    name: base.name || base.symbol || "Unknown token",
    quoteSymbol: quote.symbol || "",
    priceUsd: n(pair.priceUsd),
    liquidityUsd: n(pair.liquidity?.usd),
    volume24h: n(pair.volume?.h24),
    txns24h: n(pair.txns?.h24?.buys) + n(pair.txns?.h24?.sells),
    marketCap: n(pair.marketCap),
    fdv: n(pair.fdv),
    priceChange24h: n(pair.priceChange?.h24),
    pairAgeMs: pair.pairCreatedAt ? Date.now() - Number(pair.pairCreatedAt) : undefined,
    coverage: "Public data",
    raw: pair,
  };
}

export function rankPair(pair: DexscreenerPair): number {
  const quote = String(pair.quoteToken?.symbol || "").toUpperCase();
  const age = pair.pairCreatedAt ? Math.min(20, Math.max(0, (Date.now() - Number(pair.pairCreatedAt)) / 86_400_000)) : 0;
  return n(pair.liquidity?.usd) / 10_000
    + n(pair.volume?.h24) / 25_000
    + (n(pair.txns?.h24?.buys) + n(pair.txns?.h24?.sells)) / 20
    + (QUOTE_RANK[quote] || 0)
    + age;
}

export function sortPairs(pairs: DexscreenerPair[]): RavenDexscreenerResult[] {
  return [...pairs].sort((a, b) => rankPair(b) - rankPair(a)).map(normalizePair);
}

export async function resolveDexscreenerInput(input: string, fetchImpl: typeof fetch = fetch): Promise<RavenDexscreenerResult[]> {
  const query = String(input || "").trim();
  if (!query) return [];
  if (SOLANA_RE.test(query)) return sortPairs(await tokenPairs("solana", query, fetchImpl));
  if (EVM_RE.test(query)) {
    const settled = await Promise.allSettled(EVM_CHAINS.map((chain) => tokenPairsByAddress(chain, query, fetchImpl)));
    return sortPairs(settled.flatMap((item) => item.status === "fulfilled" ? item.value : []));
  }
  const pairMatch = query.match(/^([a-z0-9_-]+):([A-Za-z0-9x]+)$/i);
  if (pairMatch) return sortPairs(await pairByAddress(pairMatch[1], pairMatch[2], fetchImpl));
  return sortPairs(await searchPairs(query, fetchImpl));
}
