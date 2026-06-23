import type { Candle } from "../../lib/charts/ravenChartTypes";
import { resolveRavenChartOverlays, type RavenOverlayProvider } from "../../lib/overlays/overlayProvider";

function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message?: string) {
  if (actual !== expected) throw new Error(message || `expected ${String(actual)} to equal ${String(expected)}`);
}

const candles: Candle[] = [
  { time: "2026-06-23", open: 10, high: 12, low: 9, close: 11, volume: 100 },
  { time: "2026-06-24", open: 11, high: 13, low: 10, close: 12, volume: 120 },
  { time: "2026-06-25", open: 12, high: 14, low: 11, close: 13, volume: 140 },
  { time: "2026-06-26", open: 13, high: 15, low: 12, close: 14, volume: 160 },
];

const instrument = { symbol: "SOL", market: "perp", venue: "generic" };

const merged = resolveRavenChartOverlays({
  instrument,
  candles,
  tier: "pro",
  data: {
    perps: [{ pressureScore: 88 }],
    marketBreadth: [{ breadthPercentile: 72 }],
    liquidity: [{ liquidityScore: 42 }],
    compression: [{ compressionScore: 79 }],
    participants: [{ participantScore: 84, shiftType: "smart_money_accumulation" }],
  },
});

assertEqual(merged.length, 5);
assert(merged.some((overlay) => overlay.type === "pressure-zone" && overlay.metadata?.pressureScore === 88));
assert(merged.some((overlay) => overlay.type === "breadth-line" && overlay.metadata?.breadthPercentile === 72));
assert(merged.every((overlay) => overlay.source !== "mock"));

const fallback = resolveRavenChartOverlays({ instrument, candles, tier: "free", data: {} });
assert(fallback.length > 0);
assert(fallback.every((overlay) => overlay.source === "mock"));
assert(fallback.every((overlay) => overlay.metadata?.sample === true));

const founderOnlyData = {
  participants: [{ participantScore: 77, shiftType: "rotation_event" as const, experimental: true }],
};
const proFiltered = resolveRavenChartOverlays({ instrument, candles, tier: "pro", data: founderOnlyData });
assertEqual(proFiltered.some((overlay) => overlay.metadata?.experimental === true), false);

const founderVisible = resolveRavenChartOverlays({ instrument, candles, tier: "founder", data: founderOnlyData });
assertEqual(founderVisible.some((overlay) => overlay.metadata?.experimental === true), true);

const badProvider: RavenOverlayProvider = {
  id: "bad",
  supports: () => true,
  getOverlays: () => {
    throw new Error("provider unavailable");
  },
};

const isolated = resolveRavenChartOverlays({
  instrument,
  candles,
  tier: "pro",
  providers: [badProvider],
});
assert(isolated.length > 0);
assert(isolated.every((overlay) => overlay.source === "mock"));
