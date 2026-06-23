export type RavenTime = string | number;

export type Candle = {
  time: RavenTime;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type RavenChartEventType =
  | "event"
  | "entry-zone"
  | "exit-zone"
  | "liquidity-warning"
  | "smart-wallet-accumulation"
  | "smart-wallet-distribution"
  | "opportunity-marker"
  | "toxicity-risk";

export type RavenChartSeverity = "info" | "warning" | "danger" | "success";

export type RavenChartEvent = {
  time: RavenTime;
  type: RavenChartEventType;
  label: string;
  price?: number;
  severity: RavenChartSeverity;
  metadata?: Record<string, unknown>;
};

export type RavenChartOverlayType =
  | "pressure-zone"
  | "history-window"
  | "breadth-line"
  | "compression-band"
  | "regime-marker"
  | "liquidity-zone"
  | "participant-shift";

export type RavenChartOverlaySource =
  | "perps"
  | "spot"
  | "market-breadth"
  | "liquidity"
  | "compression"
  | "participant"
  | "history"
  | "mock";

export type RavenChartOverlay = {
  id: string;
  type: RavenChartOverlayType;
  label: string;
  startTime?: RavenTime;
  endTime?: RavenTime;
  time?: RavenTime;
  priceMin?: number;
  priceMax?: number;
  value?: number;
  values?: Array<{ time: RavenTime; value: number }>;
  severity: RavenChartSeverity;
  source: RavenChartOverlaySource;
  summary: string;
  metadata?: Record<string, unknown>;
};

export type RavenPriceChartProps = {
  candles?: Candle[];
  events?: RavenChartEvent[];
  overlays?: RavenChartOverlay[];
  showVolume?: boolean;
  loading?: boolean;
  error?: string | null;
  emptyLabel?: string;
  className?: string;
  compact?: boolean;
  height?: number;
};
