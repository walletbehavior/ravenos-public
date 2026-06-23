(function () {
  const TIMEFRAME_CONFIG = {
    "15m": { stepMinutes: 15, points: 64, volatility: 0.48, volumeScale: 0.34, phase: 0.7, windowLabel: "intraday" },
    "1h": { stepMinutes: 60, points: 42, volatility: 0.86, volumeScale: 0.82, phase: 1.9, windowLabel: "short swing" },
    "4h": { stepMinutes: 240, points: 32, volatility: 1.34, volumeScale: 1.55, phase: 3.4, windowLabel: "broad swing" },
    "1d": { stepMinutes: 1440, points: 26, volatility: 1.9, volumeScale: 2.7, phase: 5.1, windowLabel: "daily" },
  };

  function timeframeConfig(timeframe = "1h") {
    return TIMEFRAME_CONFIG[timeframe] || TIMEFRAME_CONFIG["1h"];
  }

  function recentTime(index, total, stepMinutes) {
    const date = new Date();
    date.setUTCSeconds(0, 0);
    const roundedMinute = Math.floor(date.getUTCMinutes() / 15) * 15;
    date.setUTCMinutes(roundedMinute);
    date.setTime(date.getTime() - (total - 1 - index) * stepMinutes * 60 * 1000);
    if (stepMinutes >= 1440) return date.toISOString().slice(0, 10);
    return Math.floor(date.getTime() / 1000);
  }

  function makeTimeframeCandles(pattern = [], timeframe = "1h", anchorPrice = null) {
    const config = timeframeConfig(timeframe);
    const source = Array.isArray(pattern) && pattern.length ? pattern : [{ open: 1, high: 1.02, low: 0.98, close: 1, volume: 1 }];
    const points = config.points;
    const raw = Array.from({ length: points }, (_, index) => {
      const base = source[(index * (timeframe === "15m" ? 1 : timeframe === "1h" ? 2 : 3)) % source.length];
      const previous = source[(index + source.length - 1) % source.length];
      const fastWave = Math.sin(index / (timeframe === "15m" ? 1.8 : timeframe === "1h" ? 2.6 : 4.2) + config.phase) * config.volatility;
      const slowWave = Math.cos(index / (timeframe === "4h" ? 5.4 : 3.7) + config.phase * 0.6) * config.volatility * (timeframe === "15m" ? 0.28 : 0.72);
      const drift = (index - points / 2) * config.volatility * (timeframe === "15m" ? 0.025 : timeframe === "1h" ? 0.052 : 0.083);
      const open = base.open + fastWave + drift;
      const close = base.close + slowWave + drift + (timeframe === "15m" ? Math.sin(index * 1.7) * 0.18 : 0);
      const high = Math.max(open, close, base.high + fastWave * 0.45) + Math.abs(base.high - previous.close) * 0.07 * config.volatility;
      const low = Math.min(open, close, base.low + slowWave * 0.38) - Math.abs(previous.close - base.low) * 0.06 * config.volatility;
      return {
        open,
        high,
        low,
        close,
        volume: Math.round(Number(base.volume || 1) * config.volumeScale * (0.72 + (index % 9) * 0.045)),
        time: recentTime(index, points, config.stepMinutes),
      };
    });
    const anchor = Number(anchorPrice);
    if (!Number.isFinite(anchor) || anchor <= 0) return raw;
    const baseClose = raw[raw.length - 1]?.close || 1;
    return raw.map((candle) => ({
      ...candle,
      open: Number((candle.open / baseClose * anchor).toFixed(6)),
      high: Number((candle.high / baseClose * anchor).toFixed(6)),
      low: Number((candle.low / baseClose * anchor).toFixed(6)),
      close: Number((candle.close / baseClose * anchor).toFixed(6)),
    }));
  }

  function chartKey({ instrument = "", market = "", mode = "", timeframe = "", coverage = "" } = {}) {
    return [instrument, market, mode, timeframe, coverage].map((part) => String(part || "na").replace(/\s+/g, "_")).join("|");
  }

  function candleWindow(candles = []) {
    const first = candles[0]?.time || "";
    const last = candles[candles.length - 1]?.time || "";
    return { count: candles.length, first, last };
  }

  const api = { TIMEFRAME_CONFIG, timeframeConfig, makeTimeframeCandles, chartKey, candleWindow };
  window.RavenChartTimeframes = api;
})();
