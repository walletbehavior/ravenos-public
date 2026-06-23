export type DexscreenerToken = {
  address?: string;
  name?: string;
  symbol?: string;
};

export type DexscreenerPair = {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  baseToken?: DexscreenerToken;
  quoteToken?: DexscreenerToken;
  priceNative?: string;
  priceUsd?: string;
  txns?: Record<string, { buys?: number; sells?: number }>;
  volume?: Record<string, number>;
  priceChange?: Record<string, number>;
  liquidity?: { usd?: number; base?: number; quote?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
};

export type RavenDexscreenerResult = {
  id: string;
  chainId: string;
  dexId: string;
  pairAddress: string;
  tokenAddress: string;
  symbol: string;
  name: string;
  quoteSymbol: string;
  priceUsd: number;
  liquidityUsd: number;
  volume24h: number;
  txns24h: number;
  marketCap: number;
  fdv: number;
  priceChange24h: number;
  pairAgeMs?: number;
  coverage: "Public data" | "Raven indexed" | "Deep Raven";
  raw?: DexscreenerPair;
};
