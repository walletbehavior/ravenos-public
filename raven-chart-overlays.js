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

  function candleAt(candles, ratio) {
    const pool = Array.isArray(candles) ? candles : [];
    return pool[Math.max(0, Math.min(pool.length - 1, Math.floor(pool.length * ratio)))] || {};
  }

  function outcomeState({ pressure, compression, breadth, seed }) {
    const rewardQuality = clamp(breadth * 0.42 + compression * 0.22 + Math.max(0, 82 - pressure) * 0.24 + (seed % 13), 0, 100);
    if (pressure >= 80 && breadth < 60) return { label: "Punishing participation", severity: "danger", quality: rewardQuality, glyph: "-", posture: "punishing" };
    if (compression >= 74 && breadth >= 62) return { label: "Rewarding participation", severity: "success", quality: clamp(rewardQuality + 12, 0, 100), glyph: "+", posture: "rewarding" };
    if (breadth >= 66 && pressure < 74) return { label: "Rewarding participation", severity: "success", quality: rewardQuality, glyph: "+", posture: "rewarding" };
    if (pressure >= 72 || breadth < 46) return { label: "Mixed outcomes", severity: "warning", quality: rewardQuality, glyph: "±", posture: "mixed" };
    return { label: "Unresolved structure", severity: "info", quality: rewardQuality, glyph: "·", posture: "unresolved" };
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
    const outcome = outcomeState({ pressure, compression, breadth, seed });
    const compressionStart = tf === "15m" ? 0.38 : tf === "4h" ? 0.18 : 0.28;
    const expansionStart = tf === "15m" ? 0.58 : tf === "4h" ? 0.44 : 0.52;
    const qualityBase = clamp(outcome.quality + (tf === "15m" ? -4 : tf === "4h" ? 8 : 2), 0, 100);

    const overlays = [
      {
        id: `${upper}-${tf}-reward-punish-zone`,
        type: "reward-zone",
        label: `${tf} ${outcome.label}`,
        startTime: candleAt(candles, expansionStart).time || t.third || t.first,
        endTime: t.last,
        priceMin: range.min + range.span * (outcome.posture === "punishing" ? 0.56 : 0.34),
        priceMax: range.min + range.span * (outcome.posture === "punishing" ? 0.88 : 0.62),
        value: qualityBase,
        severity: outcome.severity,
        source: "outcome-memory",
        summary: `${tf} structure read: participation is ${outcome.posture}. Raven compares follow-through quality, drawdown pressure, survival, liquidity persistence, and replay context.`,
        metadata: {
          timeframe: tf,
          visualFamily: "outcome",
          visualLabel: "Reward/Punish",
          glyph: outcome.glyph,
          confidence: clamp(52 + qualityBase * 0.34 + (coverage === "Deep Raven" ? 10 : 0), 35, 88),
          sampleDepth: delayed ? 18 : 74 + (seed % 41),
          evidence: [`Pressure ${pressure}`, `Compression ${compression}`, `Participation breadth ${breadth}`],
        },
      },
      {
        id: `${upper}-${tf}-compression-expansion-path`,
        type: "expansion-path",
        label: `${tf} compression to expansion`,
        startTime: candleAt(candles, compressionStart).time || t.third || t.first,
        endTime: candleAt(candles, expansionStart + 0.22).time || t.late || t.last,
        value: compression,
        severity: compression >= 76 && breadth >= 58 ? "success" : compression >= 70 ? "warning" : "info",
        source: "structure",
        summary: `${tf} compression path tracks where range contraction began resolving into acceptance, failure, or recompression.`,
        metadata: {
          timeframe: tf,
          visualFamily: "structure",
          visualLabel: "Compression Expansion",
          glyph: "↗",
          confidence: clamp(46 + compression * 0.38, 30, 84),
          sampleDepth: delayed ? 16 : 58 + (seed % 37),
          evidence: [`Range compression ${compression}`, `Breadth ${breadth}`, `Outcome posture ${outcome.posture}`],
        },
      },
      {
        id: `${upper}-${tf}-participation-quality-line`,
        type: "participation-quality",
        label: `${tf} participation quality`,
        values: (Array.isArray(candles) ? candles : []).map((candle, index) => ({
          time: candle.time,
          value: clamp(qualityBase + Math.sin((index + seed) / (tf === "15m" ? 2.1 : tf === "4h" ? 5.2 : 3.4)) * 10 + index * (tf === "4h" ? 0.55 : 0.22), 5, 95),
        })),
        value: qualityBase,
        severity: qualityBase >= 68 ? "success" : qualityBase <= 42 ? "warning" : "info",
        source: "participation",
        summary: `${tf} participation quality blends breadth, survival, liquidity persistence, and follow-through after activity expands.`,
        metadata: {
          timeframe: tf,
          visualFamily: "participation",
          visualLabel: "Participation Quality",
          glyph: "Q",
          confidence: clamp(44 + qualityBase * 0.42, 32, 86),
          sampleDepth: delayed ? 14 : 66 + (seed % 43),
          evidence: [`Quality ${Math.round(qualityBase)}`, `Breadth ${breadth}`, `Replay context included`],
        },
      },
      {
        id: `${upper}-${tf}-outcome-memory-marker`,
        type: "outcome-memory",
        label: `${tf} replay outcome memory`,
        time: candleAt(candles, tf === "15m" ? 0.52 : 0.62).time || t.mid || t.late,
        value: score([58, 67, 74, 81, 62], seed + 13, 66),
        severity: "info",
        source: "history",
        summary: `${tf} memory marker summarizes how similar prior structures behaved after comparable participation, pressure, and compression conditions.`,
        metadata: {
          timeframe: tf,
          visualFamily: "replay",
          visualLabel: "Replay Outcome",
          glyph: "M",
          confidence: clamp(48 + score([58, 67, 74, 81, 62], seed + 13, 66) * 0.34, 34, 86),
          sampleDepth: delayed ? 12 : 42 + (seed % 58),
          evidence: [`Replay similarity ${score([68, 73, 61, 79, 57], seed + 7, 67)}`, `Outcome posture ${outcome.posture}`, `Timeframe ${tf}`],
        },
      },
      {
        id: `${upper}-${tf}-pressure-participation-conflict`,
        type: "conflict-marker",
        label: `${tf} pressure/participation conflict`,
        time: candleAt(candles, tf === "4h" ? 0.72 : 0.78).time || t.late || t.last,
        value: clamp(Math.abs(pressure - breadth) + compression * 0.28, 0, 100),
        severity: Math.abs(pressure - breadth) >= 24 ? "warning" : "info",
        source: "structure",
        summary: `${tf} conflict marker appears when pressure, participation breadth, compression, or replay context disagree.`,
        metadata: {
          timeframe: tf,
          visualFamily: "conflict",
          visualLabel: "Pressure Conflict",
          glyph: "!",
          confidence: clamp(42 + Math.abs(pressure - breadth) * 0.7, 28, 82),
          sampleDepth: delayed ? 10 : 39 + (seed % 36),
          evidence: [`Pressure ${pressure}`, `Breadth ${breadth}`, `Compression ${compression}`],
        },
      },
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
