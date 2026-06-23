(function () {
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function seedFor(symbol, market, timeframe) {
    return Array.from(`${String(symbol || "ASSET").toUpperCase()}|${String(market || "spot")}|${String(timeframe || "1h")}`).reduce((sum, char) => sum + char.charCodeAt(0), String(market || "spot").length * 17);
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

  function timeframeProfile(timeframe = "1h") {
    if (timeframe === "15m") return { pressureShift: -6, compressionShift: 9, breadthShift: 4, includeCompression: true, includeBreadth: false, includeExtraParticipant: true, includeRegime: false };
    if (timeframe === "1h") return { pressureShift: 0, compressionShift: 2, breadthShift: 7, includeCompression: true, includeBreadth: true, includeExtraParticipant: false, includeRegime: false };
    if (timeframe === "4h") return { pressureShift: 8, compressionShift: -5, breadthShift: 12, includeCompression: false, includeBreadth: true, includeExtraParticipant: true, includeRegime: true };
    return { pressureShift: 4, compressionShift: -8, breadthShift: 15, includeCompression: false, includeBreadth: true, includeExtraParticipant: false, includeRegime: true };
  }

  function getOverlays({ symbol, market = "spot", mode = "flow", timeframe = "1h", coverage = "Sample", candles = [], tier = "free" } = {}) {
    const upper = String(symbol || "ASSET").toUpperCase();
    const marketName = String(market || "spot").toLowerCase();
    const tf = String(timeframe || "1h");
    const profile = timeframeProfile(tf);
    const t = times(candles);
    const range = priceRange(candles);
    const seed = seedFor(upper, marketName, tf);
    const pressure = clamp(score([62, 74, 56, 81, 68], seed, 64) + profile.pressureShift, 0, 100);
    const compression = clamp(score([71, 58, 83, 66, 77], seed + 2, 70) + profile.compressionShift, 0, 100);
    const breadth = clamp(score([54, 63, 47, 72, 59], seed + 4, 58) + profile.breadthShift, 0, 100);
    const delayed = tier === "free";

    const overlays = [
      {
        id: `${upper}-${tf}-perps-pressure`,
        type: "pressure-zone",
        label: delayed ? `Delayed ${tf} pressure` : `${tf} pressure zone`,
        startTime: t.third || t.first,
        endTime: t.late || t.last,
        priceMin: range.min + range.span * (tf === "15m" ? 0.61 : tf === "4h" ? 0.48 : 0.54),
        priceMax: range.min + range.span * (tf === "15m" ? 0.9 : tf === "4h" ? 0.76 : 0.82),
        value: pressure,
        severity: pressure >= 75 ? "danger" : pressure >= 65 ? "warning" : "info",
        source: "perps",
        summary: `${tf} pressure context normalized for this instrument and chart window.`,
        metadata: { pressureScore: pressure, market: marketName, mode, timeframe: tf, coverage, visualFamily: "pressure", visualLabel: "Pressure", glyph: "P" },
      },
    ];

    if (profile.includeCompression) overlays.push(
      {
        id: `${upper}-${tf}-compression`,
        type: "compression-band",
        label: delayed ? `Delayed ${tf} compression` : `${tf} compression band`,
        startTime: t.mid || t.first,
        endTime: t.last,
        priceMin: range.min + range.span * (tf === "15m" ? 0.22 : 0.28),
        priceMax: range.min + range.span * (tf === "15m" ? 0.42 : 0.48),
        value: compression,
        severity: compression >= 75 ? "warning" : "info",
        source: "liquidity",
        summary: `${tf} range, realized volatility, activity, and liquidity posture compressed into one chart band.`,
        metadata: { compressionScore: compression, timeframe: tf, visualFamily: "volatility", visualLabel: "Volatility", glyph: "V" },
      }
    );

    if (profile.includeBreadth) overlays.push(
      {
        id: `${upper}-${tf}-breadth`,
        type: "breadth-line",
        label: delayed ? `Delayed ${tf} breadth` : `${tf} market breadth`,
        values: (Array.isArray(candles) ? candles : []).map((candle, index) => ({
          time: candle.time,
          value: clamp(breadth + Math.sin((index + seed) / (tf === "4h" ? 4 : 2)) * 12 + index * (tf === "15m" ? 0.55 : 1.2), 5, 95),
        })),
        value: breadth,
        severity: breadth >= 65 ? "success" : breadth <= 40 ? "warning" : "info",
        source: "market-breadth",
        summary: `${tf} participation breadth for the asset's tracked market group.`,
        metadata: { breadthPercentile: breadth, timeframe: tf, visualFamily: "breadth", visualLabel: "Breadth", glyph: "B" },
      }
    );

    overlays.push(
      {
        id: `${upper}-${tf}-history`,
        type: "history-window",
        label: delayed ? `Delayed ${tf} replay window` : `${tf} historical similar window`,
        startTime: t.first,
        endTime: tf === "15m" ? (t.mid || t.third) : (t.third || t.mid),
        value: score([68, 73, 61, 79, 57], seed + 7, 67),
        severity: "info",
        source: "history",
        summary: `Prior ${tf} market windows with similar pressure, breadth, and compression structure.`,
        metadata: { replaySimilarity: score([68, 73, 61, 79, 57], seed + 7, 67), timeframe: tf, visualFamily: "replay", visualLabel: "Replay", glyph: "R" },
      },
      {
        id: `${upper}-${tf}-liquidity-zone`,
        type: "liquidity-zone",
        label: delayed ? `Delayed ${tf} liquidity zone` : `${tf} liquidity zone`,
        startTime: t.first,
        endTime: t.last,
        priceMin: range.min + range.span * (tf === "4h" ? 0.12 : 0.08),
        priceMax: range.min + range.span * (tf === "4h" ? 0.24 : 0.18),
        value: score([49, 58, 64, 53, 61], seed + 8, 55),
        severity: "info",
        source: "liquidity",
        summary: `${tf} price-region context where liquidity depth, resting flow, or repeated acceptance is visible.`,
        metadata: { timeframe: tf, visualFamily: "liquidity", visualLabel: "Liquidity Attraction", glyph: "L" },
      },
      {
        id: `${upper}-${tf}-participant-accumulation`,
        type: "participant-shift",
        label: delayed ? `Delayed ${tf} participant accumulation` : `${tf} participant accumulation`,
        time: t.mid,
        value: score([64, 72, 59, 78, 68], seed + 9, 66),
        severity: "success",
        source: "history",
        summary: `${tf} behavior signal: higher-quality participants became more active while concentration stayed controlled.`,
        metadata: { participantShiftType: "smart_money_accumulation", timeframe: tf, visualFamily: "participation", visualLabel: "Participation Expansion", glyph: "A" },
      }
    );

    if (profile.includeExtraParticipant) overlays.push(
      {
        id: `${upper}-${tf}-retail-expansion`,
        type: "participant-shift",
        label: delayed ? `Delayed ${tf} attention expansion` : `${tf} attention expansion`,
        time: t.late || t.last,
        value: score([52, 61, 69, 57, 73], seed + 10, 58),
        severity: "info",
        source: "history",
        summary: `${tf} behavior signal: participation broadened into smaller, faster accounts.`,
        metadata: { participantShiftType: "retail_expansion", timeframe: tf, visualFamily: "attention", visualLabel: "Attention Velocity", glyph: "T" },
      }
    );

    if (tf !== "15m") overlays.push(
      {
        id: `${upper}-${tf}-concentration-increase`,
        type: "participant-shift",
        label: `${tf} concentration increase`,
        time: t.third || t.mid,
        value: score([48, 66, 74, 55, 71], seed + 11, 62),
        severity: score([48, 66, 74, 55, 71], seed + 11, 62) >= 70 ? "warning" : "info",
        source: "history",
        summary: `${tf} behavior signal: activity became more concentrated among fewer participants.`,
        metadata: { participantShiftType: "concentration_increase", timeframe: tf, visualFamily: "survival", visualLabel: "Fresh Survival", glyph: "S" },
      },
      {
        id: `${upper}-${tf}-distribution-risk`,
        type: "participant-shift",
        label: `${tf} distribution risk`,
        time: t.last,
        value: score([44, 63, 76, 58, 69], seed + 12, 60),
        severity: score([44, 63, 76, 58, 69], seed + 12, 60) >= 70 ? "danger" : "warning",
        source: "history",
        summary: `${tf} behavior signal: prior active participants reduced exposure while activity stayed elevated.`,
        metadata: { participantShiftType: "distribution_risk", timeframe: tf, visualFamily: "risk", visualLabel: "Crowding", glyph: "!" },
      }
    );

    if (profile.includeRegime) overlays.push({
      id: `${upper}-${tf}-regime-marker`,
      type: "regime-marker",
      label: `${tf} structure regime`,
      time: t.mid || t.last,
      value: clamp((pressure + breadth) / 2, 0, 100),
      severity: pressure >= 75 ? "warning" : "info",
      source: "history",
      summary: `${tf} broader-window regime marker derived from pressure, breadth, replay, and liquidity context.`,
      metadata: { timeframe: tf, visualFamily: "regime", visualLabel: "Regime", glyph: "G" },
    });

    if (tier === "founder") {
      overlays.push({
        id: `${upper}-${tf}-rotation-event`,
        type: "participant-shift",
        label: "Rotation event",
        time: t.last,
        value: score([52, 69, 76, 58, 71], seed + 9, 63),
        severity: "success",
        source: "history",
        summary: "Experimental behavior signal: activity rotated from one participant group or market sleeve to another.",
        metadata: { participantShiftType: "rotation_event", timeframe: tf, experimental: true },
      });
    }

    return overlays;
  }

  window.RavenChartOverlays = { getOverlays };
})();
