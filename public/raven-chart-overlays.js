(function () {
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function seedFor(symbol, market) {
    return Array.from(String(symbol || "ASSET").toUpperCase()).reduce((sum, char) => sum + char.charCodeAt(0), String(market || "spot").length * 17);
  }

  function times(candles) {
    const usable = (Array.isArray(candles) ? candles : []).filter((candle) => candle && candle.time);
    return {
      first: usable[0]?.time,
      third: usable[Math.min(2, Math.max(0, usable.length - 1))]?.time,
      mid: usable[Math.floor(usable.length / 2)]?.time,
      late: usable[Math.max(0, usable.length - 3)]?.time,
      last: usable[Math.max(0, usable.length - 1)]?.time,
    };
  }

  function priceRange(candles) {
    const lows = (Array.isArray(candles) ? candles : []).map((candle) => Number(candle.low)).filter(Number.isFinite);
    const highs = (Array.isArray(candles) ? candles : []).map((candle) => Number(candle.high)).filter(Number.isFinite);
    const min = lows.length ? Math.min(...lows) : 0;
    const max = highs.length ? Math.max(...highs) : 1;
    return { min, max, span: Math.max(max - min, max * 0.01, 1) };
  }

  function score(pool, seed, fallback) {
    return clamp(pool.length ? pool[seed % pool.length] : fallback, 0, 100);
  }

  function getOverlays({ symbol, market = "spot", candles = [], tier = "free" } = {}) {
    const upper = String(symbol || "ASSET").toUpperCase();
    const marketName = String(market || "spot").toLowerCase();
    const t = times(candles);
    const range = priceRange(candles);
    const seed = seedFor(upper, marketName);
    const pressure = score([62, 74, 56, 81, 68], seed, 64);
    const compression = score([71, 58, 83, 66, 77], seed + 2, 70);
    const breadth = score([54, 63, 47, 72, 59], seed + 4, 58);
    const delayed = tier === "free";

    const overlays = [
      {
        id: `${upper}-perps-pressure`,
        type: "pressure-zone",
        label: delayed ? "Delayed perps pressure" : "Perps pressure zone",
        startTime: t.third || t.first,
        endTime: t.late || t.last,
        priceMin: range.min + range.span * 0.54,
        priceMax: range.min + range.span * 0.82,
        value: pressure,
        severity: pressure >= 75 ? "danger" : pressure >= 65 ? "warning" : "info",
        source: "perps",
        summary: "Funding, open interest, basis, and liquidation-proximity context normalized for this instrument.",
        metadata: { pressureScore: pressure, market: marketName },
      },
      {
        id: `${upper}-compression`,
        type: "compression-band",
        label: delayed ? "Delayed compression" : "Compression band",
        startTime: t.mid || t.first,
        endTime: t.last,
        priceMin: range.min + range.span * 0.28,
        priceMax: range.min + range.span * 0.48,
        value: compression,
        severity: compression >= 75 ? "warning" : "info",
        source: "liquidity",
        summary: "Range, realized volatility, activity, and liquidity posture compressed into one chart band.",
        metadata: { compressionScore: compression },
      },
      {
        id: `${upper}-breadth`,
        type: "breadth-line",
        label: delayed ? "Delayed market breadth" : "Market breadth",
        values: (Array.isArray(candles) ? candles : []).map((candle, index) => ({
          time: candle.time,
          value: clamp(breadth + Math.sin((index + seed) / 2) * 12 + index * 1.2, 5, 95),
        })),
        value: breadth,
        severity: breadth >= 65 ? "success" : breadth <= 40 ? "warning" : "info",
        source: "market-breadth",
        summary: "Participation breadth for the asset's tracked market group.",
        metadata: { breadthPercentile: breadth },
      },
      {
        id: `${upper}-history`,
        type: "history-window",
        label: delayed ? "Delayed similar window" : "Historical similar window",
        startTime: t.first,
        endTime: t.third || t.mid,
        value: score([68, 73, 61, 79, 57], seed + 7, 67),
        severity: "info",
        source: "history",
        summary: "Prior market windows with similar pressure, breadth, and compression structure.",
      },
    ];

    if (tier === "founder") {
      overlays.push({
        id: `${upper}-participant-shift`,
        type: "participant-shift",
        label: "Experimental participant shift",
        time: t.last,
        value: score([52, 69, 76, 58, 71], seed + 9, 63),
        severity: "success",
        source: "history",
        summary: "Experimental participant activity shift derived from behavior and flow changes.",
      });
    }

    return overlays;
  }

  window.RavenChartOverlays = { getOverlays };
})();
