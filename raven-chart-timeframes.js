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

  function hashSeed(value = "") {
    return Array.from(String(value || "RAVEN")).reduce((sum, char) => ((sum * 31) + char.charCodeAt(0)) % 1000003, 97);
  }

  function sourceStats(source) {
    const closes = source.map((candle) => Number(candle.close)).filter(Number.isFinite);
    const highs = source.map((candle) => Number(candle.high)).filter(Number.isFinite);
    const lows = source.map((candle) => Number(candle.low)).filter(Number.isFinite);
    const volumes = source.map((candle) => Number(candle.volume)).filter(Number.isFinite);
    const mid = closes.reduce((sum, value) => sum + value, 0) / Math.max(1, closes.length);
    const span = Math.max(Math.max(...highs, mid) - Math.min(...lows, mid), mid * 0.025, 1);
    const avgVolume = volumes.reduce((sum, value) => sum + value, 0) / Math.max(1, volumes.length);
    return { mid, span, avgVolume };
  }

  function makeTimeframeCandles(pattern = [], timeframe = "1h", anchorPrice = null, identity = "") {
    const config = timeframeConfig(timeframe);
    const source = Array.isArray(pattern) && pattern.length ? pattern : [{ open: 1, high: 1.02, low: 0.98, close: 1, volume: 1 }];
    const points = config.points;
    const stats = sourceStats(source);
    const seed = hashSeed(`${identity}|${timeframe}`);
    const phaseA = config.phase + (seed % 37) / 11;
    const phaseB = (seed % 71) / 13;
    const phaseC = (seed % 113) / 17;
    const seedDirection = ((seed % 2) ? 1 : -1) * (0.65 + (seed % 11) / 22);
    const intradayBias = ((seed % 13) - 6) / 16;
    const swingDirection = ((seed % 5) - 2) / 2 || 0.75;
    const amplitude = stats.span * (timeframe === "15m" ? 0.075 : timeframe === "1h" ? 0.16 : timeframe === "4h" ? 0.25 : 0.34) * config.volatility;
    const path = Array.from({ length: points }, (_, index) => {
      const p = points <= 1 ? 0 : index / (points - 1);
      if (timeframe === "15m") {
        const meanRevert = Math.sin(p * Math.PI * 7.8 + phaseA) * amplitude * 0.72;
        const microPulse = Math.sin(index * 1.27 + phaseC) * amplitude * 0.38;
        const chop = Math.cos(index * 2.11 + phaseB) * amplitude * 0.18;
        const drift = (p - 0.5) * stats.span * 0.035 * intradayBias;
        return stats.mid + meanRevert + microPulse + chop + drift;
      }
      if (timeframe === "1h") {
        const swing = Math.sin(p * Math.PI * 2.45 + phaseA) * amplitude * 0.92;
        const counterSwing = Math.cos(p * Math.PI * 5.2 + phaseB) * amplitude * 0.34;
        const trend = (p - 0.5) * stats.span * 0.16 * swingDirection * config.volatility;
        const pullback = -Math.exp(-Math.pow((p - 0.58) / 0.16, 2)) * amplitude * 0.62 * Math.sign(swingDirection);
        return stats.mid + trend + swing + counterSwing + pullback;
      }
      if (timeframe === "4h") {
        const broadTrend = (p - 0.5) * stats.span * 0.34 * seedDirection * config.volatility;
        const regimeWave = Math.sin(p * Math.PI * 1.32 + phaseA) * amplitude * 1.05;
        const lateExpansion = Math.pow(p, 1.85) * amplitude * 0.52 * seedDirection;
        return stats.mid + broadTrend + regimeWave + lateExpansion;
      }
      const trend = (p - 0.5) * stats.span * 0.42 * seedDirection * config.volatility;
      const cycle = Math.sin(p * Math.PI * 1.08 + phaseA) * amplitude;
      const weeklyReset = Math.cos(p * Math.PI * 2.6 + phaseB) * amplitude * 0.32;
      return stats.mid + trend + cycle + weeklyReset;
    });
    const raw = path.map((close, index) => {
      const previousClose = index === 0 ? path[0] - (path[1] - path[0]) * 0.45 : path[index - 1];
      const open = previousClose + (close - previousClose) * (timeframe === "15m" ? 0.28 : 0.18);
      const range = Math.max(Math.abs(close - open), stats.span * 0.006 * config.volatility);
      const wickA = range * (0.55 + Math.abs(Math.sin(index * 0.83 + phaseA)) * 0.9);
      const wickB = range * (0.45 + Math.abs(Math.cos(index * 0.71 + phaseB)) * 0.85);
      const volumeWave = 0.8 + Math.abs(Math.sin(index * 0.53 + phaseC)) * 0.34 + Math.abs(Math.cos(index * 0.19 + phaseA)) * 0.16;
      return {
        open,
        high: Math.max(open, close) + wickA,
        low: Math.min(open, close) - wickB,
        close,
        volume: Math.round(stats.avgVolume * config.volumeScale * volumeWave),
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
