import type { DexscreenerPair } from "./types";

export const DEXSCREENER_BASE_URL = "https://api.dexscreener.com";

export async function dexscreenerGet<T>(path: string, fetchImpl: typeof fetch = fetch): Promise<T> {
  const response = await fetchImpl(`${DEXSCREENER_BASE_URL}${path}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`dexscreener_http_${response.status}`);
  return response.json() as Promise<T>;
}

export async function searchPairs(query: string, fetchImpl: typeof fetch = fetch): Promise<DexscreenerPair[]> {
  const payload = await dexscreenerGet<{ pairs?: DexscreenerPair[] }>(`/latest/dex/search?q=${encodeURIComponent(query)}`, fetchImpl);
  return Array.isArray(payload.pairs) ? payload.pairs : [];
}

export async function tokenPairs(chainId: string, tokenAddress: string, fetchImpl: typeof fetch = fetch): Promise<DexscreenerPair[]> {
  const payload = await dexscreenerGet<DexscreenerPair[]>(`/token-pairs/v1/${encodeURIComponent(chainId)}/${encodeURIComponent(tokenAddress)}`, fetchImpl);
  return Array.isArray(payload) ? payload : [];
}

export async function pairByAddress(chainId: string, pairAddress: string, fetchImpl: typeof fetch = fetch): Promise<DexscreenerPair[]> {
  const payload = await dexscreenerGet<{ pairs?: DexscreenerPair[] }>(`/latest/dex/pairs/${encodeURIComponent(chainId)}/${encodeURIComponent(pairAddress)}`, fetchImpl);
  return Array.isArray(payload.pairs) ? payload.pairs : [];
}

export async function tokenPairsByAddress(chainId: string, tokenAddresses: string, fetchImpl: typeof fetch = fetch): Promise<DexscreenerPair[]> {
  const payload = await dexscreenerGet<DexscreenerPair[]>(`/tokens/v1/${encodeURIComponent(chainId)}/${encodeURIComponent(tokenAddresses)}`, fetchImpl);
  return Array.isArray(payload) ? payload : [];
}
