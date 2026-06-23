import {
  chartPriceRange,
  chartTimes,
  clampScore,
  decorateForTier,
  normalizeInstrument,
  severityForScore,
  type RavenOverlayProvider,
} from "../overlayProvider";

export const compressionOverlayProvider: RavenOverlayProvider = {
  id: "compression",
  supports: (context) => Boolean(context.data?.compression?.length),
  getOverlays: (context) => {
    const { symbol } = normalizeInstrument(context);
    const times = chartTimes(context.candles);
    const range = chartPriceRange(context.candles);

    return (context.data?.compression || []).map((item, index) => {
      const compressionScore = clampScore(item.compressionScore);
      return decorateForTier(
        {
          id: `${symbol}-compression-${index}`,
          type: "compression-band",
          label: item.label || "compression band",
          startTime: item.startTime || times.mid || times.first,
          endTime: item.endTime || times.last,
          priceMin: item.priceMin ?? range.min + range.span * 0.28,
          priceMax: item.priceMax ?? range.min + range.span * 0.48,
          value: compressionScore,
          severity: severityForScore(compressionScore),
          source: "compression",
          summary: item.summary || "Normalized range-compression context for this instrument.",
          metadata: { compressionScore, experimental: item.experimental === true },
        },
        context.tier,
      );
    });
  },
};
