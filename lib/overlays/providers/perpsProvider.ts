import {
  chartPriceRange,
  chartTimes,
  clampScore,
  decorateForTier,
  normalizeInstrument,
  severityForScore,
  type RavenOverlayProvider,
} from "../overlayProvider";

export const perpsOverlayProvider: RavenOverlayProvider = {
  id: "perps",
  supports: (context) => Boolean(context.data?.perps?.length),
  getOverlays: (context) => {
    const { symbol } = normalizeInstrument(context);
    const times = chartTimes(context.candles);
    const range = chartPriceRange(context.candles);

    return (context.data?.perps || []).map((item, index) => {
      const pressureScore = clampScore(item.pressureScore);
      return decorateForTier(
        {
          id: `${symbol}-pressure-${index}`,
          type: "pressure-zone",
          label: item.label || "pressure zone",
          startTime: item.startTime || times.third || times.first,
          endTime: item.endTime || times.late || times.last,
          priceMin: item.priceMin ?? range.min + range.span * 0.52,
          priceMax: item.priceMax ?? range.min + range.span * 0.84,
          value: pressureScore,
          severity: severityForScore(pressureScore),
          source: "perps",
          summary: item.summary || "Normalized perpetual futures pressure context for this instrument.",
          metadata: { pressureScore },
        },
        context.tier,
      );
    });
  },
};
