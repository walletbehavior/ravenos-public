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
        metadata: { pressureScore: pressure, market: marketName, visualFamily: "pressure", visualLabel: "Pressure", glyph: "P" },
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
        metadata: { compressionScore: compression, visualFamily: "volatility", visualLabel: "Volatility", glyph: "V" },
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
        metadata: { breadthPercentile: breadth, visualFamily: "breadth", visualLabel: "Breadth", glyph: "B" },
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
        metadata: { replaySimilarity: score([68, 73, 61, 79, 57], seed + 7, 67), visualFamily: "replay", visualLabel: "Replay", glyph: "R" },
      },
      {
        id: `${upper}-liquidity-zone`,
        type: "liquidity-zone",
        label: delayed ? "Delayed liquidity zone" : "Liquidity zone",
        startTime: t.first,
        endTime: t.last,
        priceMin: range.min + range.span * 0.08,
        priceMax: range.min + range.span * 0.18,
        value: score([49, 58, 64, 53, 61], seed + 8, 55),
        severity: "info",
        source: "liquidity",
        summary: "Price-region context where liquidity depth, resting flow, or repeated acceptance is visible.",
        metadata: { visualFamily: "liquidity", visualLabel: "Liquidity Attraction", glyph: "L" },
      },
      {
        id: `${upper}-participant-accumulation`,
        type: "participant-shift",
        label: delayed ? "Delayed participant accumulation" : "Smart money accumulation",
        time: t.mid,
        value: score([64, 72, 59, 78, 68], seed + 9, 66),
        severity: "success",
        source: "history",
        summary: "Behavior signal: higher-quality participants became more active while concentration stayed controlled.",
        metadata: { participantShiftType: "smart_money_accumulation", visualFamily: "participation", visualLabel: "Participation Expansion", glyph: "A" },
      },
      {
        id: `${upper}-retail-expansion`,
        type: "participant-shift",
        label: delayed ? "Delayed retail expansion" : "Retail expansion",
        time: t.late || t.last,
        value: score([52, 61, 69, 57, 73], seed + 10, 58),
        severity: "info",
        source: "history",
        summary: "Behavior signal: participation broadened into smaller, faster accounts.",
        metadata: { participantShiftType: "retail_expansion", visualFamily: "attention", visualLabel: "Attention Velocity", glyph: "T" },
      },
      {
        id: `${upper}-concentration-increase`,
        type: "participant-shift",
        label: "Concentration increase",
        time: t.third || t.mid,
        value: score([48, 66, 74, 55, 71], seed + 11, 62),
        severity: score([48, 66, 74, 55, 71], seed + 11, 62) >= 70 ? "warning" : "info",
        source: "history",
        summary: "Behavior signal: activity became more concentrated among fewer participants.",
        metadata: { participantShiftType: "concentration_increase", visualFamily: "survival", visualLabel: "Fresh Survival", glyph: "S" },
      },
      {
        id: `${upper}-distribution-risk`,
        type: "participant-shift",
        label: "Distribution risk",
        time: t.last,
        value: score([44, 63, 76, 58, 69], seed + 12, 60),
        severity: score([44, 63, 76, 58, 69], seed + 12, 60) >= 70 ? "danger" : "warning",
        source: "history",
        summary: "Behavior signal: prior active participants reduced exposure while activity stayed elevated.",
        metadata: { participantShiftType: "distribution_risk", visualFamily: "risk", visualLabel: "Crowding", glyph: "!" },
      },
    ];

    if (tier === "founder") {
      overlays.push({
        id: `${upper}-rotation-event`,
        type: "participant-shift",
        label: "Rotation event",
        time: t.last,
        value: score([52, 69, 76, 58, 71], seed + 9, 63),
        severity: "success",
        source: "history",
        summary: "Experimental behavior signal: activity rotated from one participant group or market sleeve to another.",
        metadata: { participantShiftType: "rotation_event", experimental: true },
      });
    }

    return overlays;
  }

  window.RavenChartOverlays = { getOverlays };
})();
