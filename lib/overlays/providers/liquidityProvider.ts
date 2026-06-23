import {
  chartPriceRange,
  chartTimes,
  clampScore,
  decorateForTier,
  normalizeInstrument,
  type RavenOverlayProvider,
} from "../overlayProvider";

export const liquidityOverlayProvider: RavenOverlayProvider = {
  id: "liquidity",
  supports: (context) => Boolean(context.data?.liquidity?.length),
  getOverlays: (context) => {
    const { symbol } = normalizeInstrument(context);
    const times = chartTimes(context.candles);
    const range = chartPriceRange(context.candles);

    return (context.data?.liquidity || []).map((item, index) => {
      const liquidityScore = clampScore(item.liquidityScore);
      return decorateForTier(
        {
          id: `${symbol}-liquidity-${index}`,
          type: "liquidity-zone",
          label: item.label || "liquidity zone",
          startTime: item.startTime || times.first,
          endTime: item.endTime || times.last,
          priceMin: item.priceMin ?? range.min + range.span * 0.08,
          priceMax: item.priceMax ?? range.min + range.span * 0.18,
          value: liquidityScore,
          severity: liquidityScore <= 35 ? "warning" : "info",
          source: "liquidity",
          summary: item.summary || "Normalized liquidity-region context for this instrument.",
          metadata: { liquidityScore },
        },
        context.tier,
      );
    });
  },
};
