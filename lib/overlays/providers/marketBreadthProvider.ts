import { clampScore, decorateForTier, normalizeInstrument, severityForScore, type RavenOverlayProvider } from "../overlayProvider";

export const marketBreadthOverlayProvider: RavenOverlayProvider = {
  id: "market-breadth",
  supports: (context) => Boolean(context.data?.marketBreadth?.length),
  getOverlays: (context) => {
    const { symbol } = normalizeInstrument(context);
    const candles = context.candles || [];

    return (context.data?.marketBreadth || []).map((item, index) => {
      const breadthPercentile = clampScore(item.breadthPercentile);
      return decorateForTier(
        {
          id: `${symbol}-breadth-${index}`,
          type: "breadth-line",
          label: item.label || "market breadth",
          values:
            item.values ||
            candles.map((candle) => ({
              time: candle.time,
              value: breadthPercentile,
            })),
          value: breadthPercentile,
          severity: severityForScore(breadthPercentile, "strength"),
          source: "market-breadth",
          summary: item.summary || "Normalized participation breadth for this instrument's market group.",
          metadata: { breadthPercentile },
        },
        context.tier,
      );
    });
  },
};
