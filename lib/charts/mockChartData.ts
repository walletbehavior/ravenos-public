import type { Candle, RavenChartEvent } from "./ravenChartTypes";
import { getRavenChartOverlays } from "./ravenChartOverlays";

const mockCandlePattern = [
  { open: 0.0042, high: 0.0048, low: 0.004, close: 0.0046, volume: 1420000 },
  { open: 0.0046, high: 0.0049, low: 0.0043, close: 0.0044, volume: 1180000 },
  { open: 0.0044, high: 0.0052, low: 0.0042, close: 0.0051, volume: 1910000 },
  { open: 0.0051, high: 0.0056, low: 0.0049, close: 0.0053, volume: 2260000 },
  { open: 0.0053, high: 0.0054, low: 0.0047, close: 0.0049, volume: 1680000 },
  { open: 0.0049, high: 0.0057, low: 0.0048, close: 0.0056, volume: 2440000 },
  { open: 0.0056, high: 0.0063, low: 0.0055, close: 0.0061, volume: 2840000 },
  { open: 0.0061, high: 0.0064, low: 0.0058, close: 0.006, volume: 2380000 },
  { open: 0.006, high: 0.0068, low: 0.0059, close: 0.0067, volume: 3160000 },
  { open: 0.0067, high: 0.0071, low: 0.0062, close: 0.0065, volume: 2910000 },
  { open: 0.0065, high: 0.0074, low: 0.0064, close: 0.0072, volume: 3370000 },
  { open: 0.0072, high: 0.0077, low: 0.0069, close: 0.0075, volume: 3520000 },
];

function recentIsoDay(index: number, total: number): string {
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() - (total - 1 - index));
  return day.toISOString().slice(0, 10);
}

export function makeMockCandles(pattern = mockCandlePattern): Candle[] {
  return pattern.map((candle, index) => ({
    ...candle,
    time: recentIsoDay(index, pattern.length),
  }));
}

export function makeMockRavenChartEvents(candles: Candle[]): RavenChartEvent[] {
  const at = (index: number) => candles[Math.min(index, candles.length - 1)]?.time;
  const priceAt = (index: number, fallback: number) => candles[Math.min(index, candles.length - 1)]?.close || fallback;
  return [
    { time: at(2), type: "entry-zone", label: "Entry zone observed", price: priceAt(2, 0.00455), severity: "info" },
    { time: at(4), type: "liquidity-warning", label: "Liquidity depth thinned", price: priceAt(4, 0.00475), severity: "warning" },
    { time: at(6), type: "smart-wallet-accumulation", label: "Smart-wallet accumulation cluster", severity: "success" },
    { time: at(8), type: "opportunity-marker", label: "Emerging opportunity marker", price: priceAt(8, 0.00665), severity: "success" },
    { time: at(9), type: "toxicity-risk", label: "Toxicity risk elevated", price: priceAt(9, 0.00695), severity: "danger" },
    { time: at(10), type: "smart-wallet-distribution", label: "Smart-wallet distribution cluster", severity: "warning" },
    { time: at(11), type: "exit-zone", label: "Exit zone observed", price: priceAt(11, 0.00745), severity: "info" },
  ].filter((event): event is RavenChartEvent => Boolean(event.time));
}

export const mockSolanaPoolCandles: Candle[] = makeMockCandles();
export const mockRavenChartEvents: RavenChartEvent[] = makeMockRavenChartEvents(mockSolanaPoolCandles);

export const mockRavenChartOverlays = getRavenChartOverlays({
  symbol: "SOL",
  market: "perp",
  candles: mockSolanaPoolCandles,
  tier: "founder",
});
