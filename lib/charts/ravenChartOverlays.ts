import type { Candle, RavenChartOverlay } from "./ravenChartTypes";
import { resolveRavenChartOverlays, type RavenOverlayTier } from "../overlays/overlayProvider";

export type RavenOverlayRequest = {
  symbol: string;
  market?: string;
  candles?: Candle[];
  tier?: RavenOverlayTier;
};

export function getRavenChartOverlays({
  symbol,
  market = "spot",
  candles = [],
  tier = "free",
}: RavenOverlayRequest): RavenChartOverlay[] {
  return resolveRavenChartOverlays({
    instrument: { symbol, market },
    candles,
    tier,
  });
}
