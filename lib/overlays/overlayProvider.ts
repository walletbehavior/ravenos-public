import type { Candle, RavenChartOverlay, RavenChartSeverity } from "../charts/ravenChartTypes";
import { mockOverlayProvider } from "./providers/mockProvider";
import { perpsOverlayProvider } from "./providers/perpsProvider";
import { marketBreadthOverlayProvider } from "./providers/marketBreadthProvider";
import { liquidityOverlayProvider } from "./providers/liquidityProvider";
import { participantOverlayProvider } from "./providers/participantProvider";
import { compressionOverlayProvider } from "./providers/compressionProvider";

export type RavenOverlayTier = "free" | "pro" | "founder";

export type RavenOverlayInstrument = {
  symbol?: string;
  asset?: string;
  instrumentId?: string;
  market?: string;
  venue?: string;
  marketType?: string;
  baseAsset?: string;
  quoteAsset?: string;
};

export type NormalizedPerpsPressure = {
  pressureScore: number;
  startTime?: Candle["time"];
  endTime?: Candle["time"];
  priceMin?: number;
  priceMax?: number;
  label?: string;
  summary?: string;
};

export type NormalizedMarketBreadth = {
  breadthPercentile: number;
  values?: Array<{ time: Candle["time"]; value: number }>;
  label?: string;
  summary?: string;
};

export type NormalizedLiquidityRegion = {
  liquidityScore: number;
  startTime?: Candle["time"];
  endTime?: Candle["time"];
  priceMin?: number;
  priceMax?: number;
  label?: string;
  summary?: string;
};

export type NormalizedCompressionRegion = {
  compressionScore: number;
  startTime?: Candle["time"];
  endTime?: Candle["time"];
  priceMin?: number;
  priceMax?: number;
  label?: string;
  summary?: string;
  experimental?: boolean;
};

export type NormalizedParticipantShift = {
  participantScore: number;
  time?: Candle["time"];
  shiftType: "smart_money_accumulation" | "retail_expansion" | "concentration_increase" | "distribution_risk" | "rotation_event";
  label?: string;
  summary?: string;
  experimental?: boolean;
};

export type RavenOverlayDataContracts = {
  perps?: NormalizedPerpsPressure[];
  marketBreadth?: NormalizedMarketBreadth[];
  liquidity?: NormalizedLiquidityRegion[];
  compression?: NormalizedCompressionRegion[];
  participants?: NormalizedParticipantShift[];
};

export type RavenOverlayProviderContext = {
  instrument: RavenOverlayInstrument;
  candles?: Candle[];
  tier?: RavenOverlayTier;
  asOf?: Date | string;
  delayMinutes?: number;
  data?: RavenOverlayDataContracts;
};

export type RavenOverlayProvider = {
  id: string;
  supports: (context: RavenOverlayProviderContext) => boolean;
  getOverlays: (context: RavenOverlayProviderContext) => RavenChartOverlay[];
};

export type RavenOverlayResolverOptions = RavenOverlayProviderContext & {
  providers?: RavenOverlayProvider[];
  fallbackProvider?: RavenOverlayProvider;
};

export const defaultOverlayProviders: RavenOverlayProvider[] = [
  perpsOverlayProvider,
  marketBreadthOverlayProvider,
  liquidityOverlayProvider,
  compressionOverlayProvider,
  participantOverlayProvider,
];

export function clampScore(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, numeric));
}

export function severityForScore(score: number, mode: "risk" | "strength" = "risk"): RavenChartSeverity {
  const normalized = clampScore(score);
  if (mode === "strength") {
    if (normalized >= 70) return "success";
    if (normalized <= 35) return "warning";
    return "info";
  }
  if (normalized >= 80) return "danger";
  if (normalized >= 65) return "warning";
  return "info";
}

export function normalizeInstrument(context: RavenOverlayProviderContext): Required<Pick<RavenOverlayInstrument, "symbol" | "market">> {
  const instrument = context.instrument || {};
  const symbol = String(instrument.symbol || instrument.asset || instrument.instrumentId || "ASSET").toUpperCase();
  const market = String(instrument.market || instrument.marketType || "market").toLowerCase();
  return { symbol, market };
}

export function chartTimes(candles: Candle[] = []) {
  const usable = candles.filter((candle) => candle?.time);
  return {
    first: usable[0]?.time,
    third: usable[Math.min(2, Math.max(0, usable.length - 1))]?.time,
    mid: usable[Math.floor(usable.length / 2)]?.time,
    late: usable[Math.max(0, usable.length - 3)]?.time,
    last: usable[Math.max(0, usable.length - 1)]?.time,
  };
}

export function chartPriceRange(candles: Candle[] = []) {
  const lows = candles.map((candle) => Number(candle.low)).filter(Number.isFinite);
  const highs = candles.map((candle) => Number(candle.high)).filter(Number.isFinite);
  const min = lows.length ? Math.min(...lows) : 0;
  const max = highs.length ? Math.max(...highs) : 1;
  return { min, max, span: Math.max(max - min, max * 0.01, 1) };
}

export function decorateForTier<T extends RavenChartOverlay>(overlay: T, tier: RavenOverlayTier = "free"): T {
  if (tier !== "free") return overlay;
  return {
    ...overlay,
    label: overlay.label.startsWith("Delayed") ? overlay.label : `Delayed ${overlay.label}`,
    metadata: { ...(overlay.metadata || {}), delayed: true, sample: true },
  };
}

export function resolveRavenChartOverlays(options: RavenOverlayResolverOptions): RavenChartOverlay[] {
  const tier = options.tier || "free";
  const context: RavenOverlayProviderContext = { ...options, tier };
  const providers = options.providers || defaultOverlayProviders;
  const overlays: RavenChartOverlay[] = [];

  for (const provider of providers) {
    try {
      if (!provider.supports(context)) continue;
      overlays.push(...provider.getOverlays(context));
    } catch {
      continue;
    }
  }

  const filtered = overlays.filter((overlay) => {
    if (!overlay || !overlay.id || !overlay.type || !overlay.severity || !overlay.source) return false;
    return tier === "founder" || overlay.metadata?.experimental !== true;
  });

  if (filtered.length) return filtered;

  const fallbackProvider = options.fallbackProvider || mockOverlayProvider;
  try {
    return fallbackProvider.supports(context) ? fallbackProvider.getOverlays(context) : [];
  } catch {
    return [];
  }
}
