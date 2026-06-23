import type { RavenChartOverlay } from "../../charts/ravenChartTypes";
import {
  chartPriceRange,
  chartTimes,
  clampScore,
  decorateForTier,
  normalizeInstrument,
  severityForScore,
  type RavenOverlayProvider,
} from "../overlayProvider";

function pct(values: number[], index: number, fallback: number): number {
  if (!values.length) return fallback;
  return clampScore(values[index % values.length], fallback);
}

export const mockOverlayProvider: RavenOverlayProvider = {
  id: "mock",
  supports: () => true,
  getOverlays: (context) => {
    const { symbol, market } = normalizeInstrument(context);
    const candles = context.candles || [];
    const times = chartTimes(candles);
    const range = chartPriceRange(candles);
    const seed = Array.from(symbol).reduce((sum, char) => sum + char.charCodeAt(0), market.length * 17);
    const pressureScore = pct([62, 74, 56, 81, 68], seed, 64);
    const compressionScore = pct([71, 58, 83, 66, 77], seed + 2, 70);
    const breadthPercentile = pct([54, 63, 47, 72, 59], seed + 4, 58);
    const participantScore = pct([64, 72, 59, 78, 68], seed + 9, 66);

    const overlays: RavenChartOverlay[] = [
      {
        id: `${symbol}-mock-pressure`,
        type: "pressure-zone",
        label: "sample pressure zone",
        startTime: times.third || times.first,
        endTime: times.late || times.last,
        priceMin: range.min + range.span * 0.54,
        priceMax: range.min + range.span * 0.82,
        value: pressureScore,
        severity: severityForScore(pressureScore),
        source: "mock",
        summary: "Sample pressure context until live normalized provider data is available.",
        metadata: { pressureScore },
      },
      {
        id: `${symbol}-mock-compression`,
        type: "compression-band",
        label: "sample compression band",
        startTime: times.mid || times.first,
        endTime: times.last,
        priceMin: range.min + range.span * 0.28,
        priceMax: range.min + range.span * 0.48,
        value: compressionScore,
        severity: severityForScore(compressionScore),
        source: "mock",
        summary: "Sample range-compression context until live normalized provider data is available.",
        metadata: { compressionScore },
      },
      {
        id: `${symbol}-mock-breadth`,
        type: "breadth-line",
        label: "sample breadth",
        values: candles.map((candle, index) => ({
          time: candle.time,
          value: clampScore(breadthPercentile + Math.sin((index + seed) / 2) * 12 + index * 1.2, breadthPercentile),
        })),
        value: breadthPercentile,
        severity: severityForScore(breadthPercentile, "strength"),
        source: "mock",
        summary: "Sample breadth context until live normalized provider data is available.",
        metadata: { breadthPercentile },
      },
      {
        id: `${symbol}-mock-liquidity`,
        type: "liquidity-zone",
        label: "sample liquidity zone",
        startTime: times.first,
        endTime: times.last,
        priceMin: range.min + range.span * 0.08,
        priceMax: range.min + range.span * 0.18,
        value: pct([49, 58, 64, 53, 61], seed + 8, 55),
        severity: "info",
        source: "mock",
        summary: "Sample liquidity-region context until live normalized provider data is available.",
      },
      {
        id: `${symbol}-mock-participant`,
        type: "participant-shift",
        label: "sample participant shift",
        time: times.mid,
        value: participantScore,
        severity: severityForScore(participantScore, "strength"),
        source: "mock",
        summary: "Sample participant behavior context until live normalized provider data is available.",
        metadata: { participantScore, participantShiftType: "smart_money_accumulation" },
      },
    ];

    if (context.tier === "founder") {
      overlays.push({
        id: `${symbol}-mock-rotation`,
        type: "participant-shift",
        label: "sample rotation event",
        time: times.last,
        value: pct([52, 69, 76, 58, 71], seed + 10, 63),
        severity: "success",
        source: "mock",
        summary: "Sample experimental participant rotation context.",
        metadata: { participantShiftType: "rotation_event", experimental: true },
      });
    }

    return overlays.map((overlay) => decorateForTier(overlay, context.tier));
  },
};
