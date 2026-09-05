(function () {
  function finite(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function observedAt(source) {
    return source?.source_event_time
      || source?.event_time
      || source?.observed_at
      || source?.observedAt
      || source?.lastUpdated
      || null;
  }

  function timestampMs(value) {
    if (typeof value === "number") return value > 10_000_000_000 ? value : value * 1000;
    const parsed = Date.parse(value || "");
    return Number.isFinite(parsed) ? parsed : null;
  }

  function chartTimeFor(value, candles) {
    const target = timestampMs(value);
    if (target === null) return null;
    const chartTimes = (Array.isArray(candles) ? candles : [])
      .map((candle) => timestampMs(candle?.time))
      .filter((time) => time !== null)
      .sort((left, right) => left - right);
    if (!chartTimes.length) return null;
    const intervals = chartTimes.slice(1).map((time, index) => time - chartTimes[index]).filter((value) => value > 0).sort((left, right) => left - right);
    const interval = intervals.length ? intervals[Math.floor(intervals.length / 2)] : 300_000;
    const tolerance = Math.max(60_000, interval * 1.25);
    if (target < chartTimes[0] - tolerance || target > chartTimes[chartTimes.length - 1] + tolerance) return null;
    let nearest = null;
    let nearestDistance = Infinity;
    for (const candle of Array.isArray(candles) ? candles : []) {
      const current = timestampMs(candle?.time);
      if (current === null) continue;
      const distance = Math.abs(current - target);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = candle.time;
      }
    }
    return nearestDistance <= tolerance ? nearest : null;
  }

  function freshness(source) {
    const declared = String(source?.freshness_state || "").toLowerCase();
    if (declared) return declared;
    const value = timestampMs(observedAt(source));
    if (value === null) return "unknown";
    const age = (Date.now() - value) / 1000;
    if (age > 900) return "stale";
    if (age > 180) return "delayed";
    return "live";
  }

  const TECHNICAL_OVERLAY_SCHEMA = "ravenos.technical_overlay.v1";
  const TECHNICAL_OVERLAY_KEYS = Object.freeze([
    "technical-macd",
    "technical-accumulation",
    "technical-fibonacci",
  ]);
  const FIBONACCI_RATIOS = Object.freeze([0.382, 0.5, 0.618]);
  const TIMEFRAME_SECONDS = Object.freeze({
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "1h": 3_600,
    "4h": 14_400,
    "1d": 86_400,
    "1w": 604_800,
    "1M": 2_592_000,
  });

  function technicalFinite(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalizedTechnicalCandles(candles) {
    return (Array.isArray(candles) ? candles : [])
      .map((candle) => ({
        time: candle?.time,
        time_seconds: timestampMs(candle?.time) === null ? null : timestampMs(candle.time) / 1_000,
        open: technicalFinite(candle?.open),
        high: technicalFinite(candle?.high),
        low: technicalFinite(candle?.low),
        close: technicalFinite(candle?.close),
        volume: technicalFinite(candle?.quote_volume ?? candle?.quoteVolume ?? candle?.volume),
      }))
      .filter((candle) => (
        candle.time !== null
        && candle.time !== undefined
        && candle.time_seconds !== null
        && candle.open > 0
        && candle.high > 0
        && candle.low > 0
        && candle.close > 0
        && candle.high >= candle.low
      ))
      .sort((left, right) => left.time_seconds - right.time_seconds)
      .filter((candle, index, rows) => index === rows.length - 1 || candle.time_seconds !== rows[index + 1].time_seconds);
  }

  function closedTechnicalCandles(candles, timeframe, asOf) {
    const rows = normalizedTechnicalCandles(candles);
    if (!rows.length) return rows;
    const interval = TIMEFRAME_SECONDS[timeframe] || 0;
    const asOfMs = timestampMs(asOf);
    if (!interval || asOfMs === null) return rows.slice(0, -1);
    const asOfSeconds = asOfMs / 1_000;
    return rows.filter((row, index) => {
      const next = rows[index + 1];
      if (next?.time_seconds <= asOfSeconds + 1) return true;
      if (timeframe !== "1M") return row.time_seconds + interval <= asOfSeconds + 1;
      const start = new Date(row.time_seconds * 1_000);
      const nextMonth = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1) / 1_000;
      return nextMonth <= asOfSeconds;
    });
  }

  function isoFromChartTime(value) {
    const parsed = timestampMs(value);
    return parsed === null ? null : new Date(parsed).toISOString();
  }

  function technicalFreshness(value) {
    const state = String(value || "").trim().toLowerCase();
    if (["provider_backed", "terminal_chart_api", "live", "current", "fresh"].includes(state)) return "fresh";
    if (["delayed", "cached", "recovering", "backfilling", "degraded"].includes(state)) return state === "delayed" || state === "cached" ? "degraded" : state;
    if (state === "stale") return "stale";
    if (state === "unavailable") return "unavailable";
    return "unknown";
  }

  function emaValues(values, period) {
    const output = Array(values.length).fill(null);
    if (!Number.isInteger(period) || period < 2 || values.length < period) return output;
    let previous = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
    output[period - 1] = previous;
    const multiplier = 2 / (period + 1);
    for (let index = period; index < values.length; index += 1) {
      previous = values[index] * multiplier + previous * (1 - multiplier);
      output[index] = previous;
    }
    return output;
  }

  function macdTechnicalState(rows) {
    if (rows.length < 35) return { state: "insufficient_history", rows: [], crossovers: [], current: null };
    const closes = rows.map((row) => row.close);
    const fast = emaValues(closes, 12);
    const slow = emaValues(closes, 26);
    const macd = closes.map((_, index) => (
      fast[index] === null || slow[index] === null ? null : fast[index] - slow[index]
    ));
    const macdStart = macd.findIndex((value) => value !== null);
    const signalTail = emaValues(macd.slice(macdStart), 9);
    const signal = Array(macdStart).fill(null).concat(signalTail);
    const values = rows.map((row, index) => {
      if (macd[index] === null || signal[index] === null) return null;
      return {
        time: row.time,
        close: row.close,
        macd: macd[index],
        signal: signal[index],
        histogram: macd[index] - signal[index],
        row_index: index,
      };
    }).filter(Boolean);
    const crossovers = [];
    for (let index = 1; index < values.length; index += 1) {
      const prior = values[index - 1];
      const current = values[index];
      const positive = prior.histogram <= 0 && current.histogram > 0;
      const negative = prior.histogram >= 0 && current.histogram < 0;
      if (!positive && !negative) continue;
      crossovers.push({
        ...current,
        direction: positive ? "positive" : "negative",
        prior_histogram: prior.histogram,
        bars_ago: rows.length - 1 - current.row_index,
      });
    }
    const current = values.at(-1) || null;
    return {
      state: current ? "available" : "insufficient_history",
      rows: values,
      crossovers: crossovers.slice(-3),
      current: current ? {
        macd: current.macd,
        signal: current.signal,
        histogram: current.histogram,
        direction: current.histogram >= 0 ? "positive" : "negative",
      } : null,
    };
  }

  function pivotPoints(rows, radius = 2) {
    const pivots = [];
    for (let index = radius; index < rows.length - radius; index += 1) {
      const window = rows.slice(index - radius, index + radius + 1);
      const row = rows[index];
      if (window.every((candidate) => row.high >= candidate.high)) pivots.push({ kind: "high", index, time: row.time, price: row.high });
      if (window.every((candidate) => row.low <= candidate.low)) pivots.push({ kind: "low", index, time: row.time, price: row.low });
    }
    return pivots.sort((left, right) => left.index - right.index || left.kind.localeCompare(right.kind));
  }

  function latestSwing(rows) {
    const windowRows = rows.slice(-120);
    if (windowRows.length < 24) return null;
    const pivots = pivotPoints(windowRows, 2);
    let selected = null;
    for (let endIndex = pivots.length - 1; endIndex >= 0; endIndex -= 1) {
      const end = pivots[endIndex];
      if (end.index < windowRows.length - 36) break;
      for (let startIndex = endIndex - 1; startIndex >= 0; startIndex -= 1) {
        const start = pivots[startIndex];
        if (start.kind === end.kind || end.index - start.index < 5) continue;
        const range = Math.abs(end.price - start.price);
        const movePct = range / Math.max(1e-18, Math.min(end.price, start.price)) * 100;
        if (movePct < 3) continue;
        const candidate = {
          start,
          end,
          direction: start.kind === "low" ? "up" : "down",
          range,
          move_pct: movePct,
          sample_count: windowRows.length,
        };
        if (!selected || candidate.range > selected.range) selected = candidate;
      }
      if (selected) break;
    }
    if (selected) return selected;

    const lows = windowRows.map((row, index) => ({ kind: "low", index, time: row.time, price: row.low }));
    const highs = windowRows.map((row, index) => ({ kind: "high", index, time: row.time, price: row.high }));
    const low = lows.reduce((best, row) => row.price < best.price ? row : best, lows[0]);
    const high = highs.reduce((best, row) => row.price > best.price ? row : best, highs[0]);
    const start = low.index < high.index ? low : high;
    const end = low.index < high.index ? high : low;
    const range = Math.abs(high.price - low.price);
    const movePct = range / Math.max(1e-18, Math.min(high.price, low.price)) * 100;
    if (end.index - start.index < 8 || end.index < windowRows.length - 24 || movePct < 3) return null;
    return {
      start,
      end,
      direction: start.kind === "low" ? "up" : "down",
      range,
      move_pct: movePct,
      sample_count: windowRows.length,
    };
  }

  function accumulationState(rows) {
    const sample = rows.slice(-24);
    if (sample.length < 24) return null;
    const volumes = sample.filter((row) => row.volume !== null && row.volume >= 0);
    if (volumes.length < 20 || volumes.reduce((sum, row) => sum + row.volume, 0) <= 0) return null;
    const high = Math.max(...sample.map((row) => row.high));
    const low = Math.min(...sample.map((row) => row.low));
    const midpoint = (high + low) / 2;
    const meanClose = sample.reduce((sum, row) => sum + row.close, 0) / sample.length;
    const rangePct = meanClose > 0 ? (high - low) / meanClose * 100 : null;
    if (rangePct === null || rangePct > 20) return null;
    const prior = rows.slice(-48, -24);
    const priorHigh = prior.length === 24 ? Math.max(...prior.map((row) => row.high)) : null;
    const priorLow = prior.length === 24 ? Math.min(...prior.map((row) => row.low)) : null;
    const priorMean = prior.length === 24 ? prior.reduce((sum, row) => sum + row.close, 0) / prior.length : null;
    const priorRangePct = priorMean > 0 ? (priorHigh - priorLow) / priorMean * 100 : null;
    const contraction = priorRangePct === null ? rangePct <= 9 : rangePct <= Math.max(4, priorRangePct * 0.86);
    const trendPct = (sample.at(-1).close / sample[0].close - 1) * 100;
    const stable = trendPct >= -5 && trendPct <= 10;
    const closeLocations = sample.map((row) => row.high === row.low ? 0.5 : (row.close - row.low) / (row.high - row.low));
    const averageCloseLocation = closeLocations.reduce((sum, value) => sum + value, 0) / closeLocations.length;
    const closesAboveMid = sample.filter((row) => row.close >= midpoint).length / sample.length;
    const upVolume = sample.filter((row) => row.close >= row.open && row.volume !== null).reduce((sum, row) => sum + row.volume, 0);
    const downVolume = sample.filter((row) => row.close < row.open && row.volume !== null).reduce((sum, row) => sum + row.volume, 0);
    const upDownVolumeRatio = downVolume > 0 ? upVolume / downVolume : upVolume > 0 ? null : 0;
    const volumeConstructive = upDownVolumeRatio === null ? upVolume > 0 : upDownVolumeRatio >= 1.05;
    const evidenceChecks = [averageCloseLocation >= 0.52, closesAboveMid >= 0.54, volumeConstructive];
    const evidenceCount = evidenceChecks.filter(Boolean).length;
    if (!contraction || !stable || evidenceCount < 2) return null;
    return {
      start_time: sample[0].time,
      end_time: sample.at(-1).time,
      price_low: low,
      price_high: high,
      range_pct: rangePct,
      trend_pct: trendPct,
      prior_range_pct: priorRangePct,
      average_close_location: averageCloseLocation,
      closes_above_mid_share: closesAboveMid,
      up_down_volume_ratio: upDownVolumeRatio,
      candle_count: sample.length,
      evidence_count: evidenceCount,
    };
  }

  function technicalOverlayBase({ id, type, key, label, summary, source, observedAt, generatedAt, freshnessState, instrumentId, timeframe, metadata = {}, ...rest }) {
    return {
      id,
      type,
      label,
      summary,
      source,
      observed_at: observedAt,
      generated_at: generatedAt,
      freshness_state: freshnessState,
      instrument_id: instrumentId || null,
      identity_scope: "exact_instrument",
      timeframe,
      research_only: true,
      actionable: false,
      execution_authority: false,
      metadata: {
        schema_version: TECHNICAL_OVERLAY_SCHEMA,
        overlay_key: key,
        evidence_scope: "closed_exact_market_candles",
        ...metadata,
      },
      ...rest,
    };
  }

  function deriveTechnicalAnalysis({
    candles = [],
    timeframe = "1h",
    instrumentId = null,
    source = "Exact-market candles",
    sourceState = "provider_backed",
    observedAt = null,
  } = {}) {
    const freshnessState = technicalFreshness(sourceState);
    if (freshnessState === "unknown" || freshnessState === "unavailable") {
      return Object.freeze({
        schema_version: TECHNICAL_OVERLAY_SCHEMA,
        state: "unavailable",
        reason: "provider_candle_evidence_unavailable",
        closed_candle_count: 0,
        overlays: [],
        summary: [],
      });
    }
    const rows = closedTechnicalCandles(candles, timeframe, observedAt);
    if (rows.length < 24) {
      return Object.freeze({
        schema_version: TECHNICAL_OVERLAY_SCHEMA,
        state: "insufficient_history",
        reason: "at_least_24_closed_candles_required",
        closed_candle_count: rows.length,
        overlays: [],
        summary: [],
      });
    }
    const generatedAt = isoFromChartTime(rows.at(-1).time);
    const identity = String(instrumentId || "exact-market").replace(/[^a-z0-9:._-]+/gi, "-");
    const overlays = [];
    const macd = macdTechnicalState(rows);
    for (const crossover of macd.crossovers) {
      const positive = crossover.direction === "positive";
      overlays.push(technicalOverlayBase({
        id: `${identity}:${timeframe}:macd:${crossover.direction}:${crossover.time}`,
        type: "technical-macd-crossover",
        key: "technical-macd",
        label: positive ? "MACD + cross" : "MACD − cross",
        summary: `MACD crossed ${positive ? "above" : "below"} its signal line on a closed ${timeframe} candle.`,
        source,
        observedAt: isoFromChartTime(crossover.time),
        generatedAt,
        freshnessState,
        instrumentId,
        timeframe,
        time: crossover.time,
        price: crossover.close,
        value: positive ? 62 : 61,
        severity: positive ? "success" : "warning",
        metadata: {
          metric: "macd_signal_line_crossover",
          unit: "derived_state",
          direction: crossover.direction,
          macd: crossover.macd,
          signal: crossover.signal,
          histogram: crossover.histogram,
          prior_histogram: crossover.prior_histogram,
          bars_ago: crossover.bars_ago,
          candle_count: rows.length,
          sample_count: rows.length,
          window: timeframe,
          parameters: { fast: 12, slow: 26, signal: 9 },
        },
      }));
    }

    const accumulation = accumulationState(rows);
    if (accumulation) {
      overlays.push(technicalOverlayBase({
        id: `${identity}:${timeframe}:accumulation:${accumulation.start_time}:${accumulation.end_time}`,
        type: "technical-accumulation-zone",
        key: "technical-accumulation",
        label: "Accumulation-shaped range",
        summary: "Price compressed while closed-candle volume and range position stayed constructive. This is not proof of wallet accumulation.",
        source,
        observedAt: generatedAt,
        generatedAt,
        freshnessState,
        instrumentId,
        timeframe,
        startTime: accumulation.start_time,
        endTime: accumulation.end_time,
        priceMin: accumulation.price_low,
        priceMax: accumulation.price_high,
        value: 64,
        severity: "info",
        metadata: {
          metric: "accumulation_shaped_consolidation",
          unit: "derived_state",
          ...accumulation,
          sample_count: accumulation.candle_count,
          window: `${accumulation.candle_count} × ${timeframe}`,
          wallet_accumulation_claimed: false,
        },
      }));
    }

    const swing = latestSwing(rows);
    const fibonacci = swing ? {
      direction: swing.direction,
      start_time: swing.start.time,
      start_price: swing.start.price,
      end_time: swing.end.time,
      end_price: swing.end.price,
      move_pct: swing.move_pct,
      levels: [],
    } : null;
    if (swing && fibonacci) {
      for (const ratio of FIBONACCI_RATIOS) {
        const price = swing.direction === "up"
          ? swing.end.price - swing.range * ratio
          : swing.end.price + swing.range * ratio;
        const ratioLabel = ratio === 0.5 ? "50%" : `${(ratio * 100).toFixed(1)}%`;
        fibonacci.levels.push({ ratio, price });
        overlays.push(technicalOverlayBase({
          id: `${identity}:${timeframe}:fib:${swing.start.time}:${swing.end.time}:${ratio}`,
          type: "technical-fibonacci-level",
          key: "technical-fibonacci",
          label: `Fib ${ratioLabel}`,
          summary: `${ratioLabel} retracement reference from the latest confirmed ${swing.direction === "up" ? "upswing" : "downswing"}.`,
          source,
          observedAt: generatedAt,
          generatedAt,
          freshnessState,
          instrumentId,
          timeframe,
          startTime: swing.start.time,
          endTime: rows.at(-1).time,
          priceMin: price,
          priceMax: price,
          value: 44,
          severity: "info",
          metadata: {
            metric: "fibonacci_retracement_reference",
            unit: "price",
            ratio,
            swing_direction: swing.direction,
            anchor_start_time: swing.start.time,
            anchor_start_price: swing.start.price,
            anchor_end_time: swing.end.time,
            anchor_end_price: swing.end.price,
            swing_move_pct: swing.move_pct,
            candle_count: rows.length,
            sample_count: swing.sample_count,
            window: timeframe,
            predictive_claimed: false,
          },
        }));
      }
    }

    const latestClose = rows.at(-1).close;
    const latestCross = macd.crossovers.at(-1) || null;
    const nearestFib = fibonacci?.levels?.length
      ? [...fibonacci.levels].sort((left, right) => Math.abs(left.price - latestClose) - Math.abs(right.price - latestClose))[0]
      : null;
    const nearestFibDistancePct = nearestFib && latestClose > 0 ? (latestClose / nearestFib.price - 1) * 100 : null;
    const summary = [];
    if (latestCross && latestCross.bars_ago <= 8) {
      const timing = latestCross.bars_ago === 0
        ? "at last close"
        : `${latestCross.bars_ago} ${latestCross.bars_ago === 1 ? "bar" : "bars"} ago`;
      summary.push(`MACD ${latestCross.direction === "positive" ? "+" : "−"} cross ${timing}`);
    }
    if (accumulation) summary.push("Accumulation-shaped range");
    if (nearestFib && nearestFibDistancePct !== null) {
      const ratioLabel = nearestFib.ratio === 0.5 ? "50%" : `${(nearestFib.ratio * 100).toFixed(1)}%`;
      summary.push(`Fib ${ratioLabel} ${Math.abs(nearestFibDistancePct).toFixed(Math.abs(nearestFibDistancePct) < 1 ? 1 : 0)}% ${nearestFibDistancePct >= 0 ? "below" : "above"}`);
    }
    return Object.freeze({
      schema_version: TECHNICAL_OVERLAY_SCHEMA,
      state: "available",
      evidence_scope: "closed_exact_market_candles",
      instrument_id: instrumentId,
      timeframe,
      observed_at: generatedAt,
      freshness_state: freshnessState,
      closed_candle_count: rows.length,
      overlays,
      summary,
      macd: {
        state: macd.state,
        current: macd.current,
        latest_crossover: latestCross,
      },
      accumulation,
      fibonacci: fibonacci ? { ...fibonacci, nearest_level: nearestFib, nearest_distance_pct: nearestFibDistancePct } : null,
      public_safety: {
        candle_derived_only: true,
        wallet_accumulation_claimed: false,
        predictive_claimed: false,
        execution_authority: false,
      },
    });
  }

  function identityMatches(annotation, { symbol, market, chartContext }) {
    const annotationSymbol = String(annotation?.symbol || annotation?.asset || annotation?.instrument || "").toUpperCase();
    const selectedSymbol = String(symbol || "").toUpperCase();
    if (!annotationSymbol || annotationSymbol !== selectedSymbol) return false;
    if (annotation.market && String(annotation.market).toLowerCase() !== String(market || "").toLowerCase()) return false;
    if (annotation.market_identity && chartContext?.marketIdentity && annotation.market_identity !== chartContext.marketIdentity) return false;
    return true;
  }

  function lineagePresent(annotation) {
    return Boolean(
      annotation?.evidence_id
      || annotation?.source_evidence_id
      || annotation?.execution_observation_id
      || annotation?.lineage_id
      || annotation?.source_lineage,
    );
  }

  function annotationRows(evidenceContext) {
    const candidates = [
      evidenceContext?.chartAnnotations,
      evidenceContext?.chart_annotations,
      evidenceContext?.annotations,
      evidenceContext?.data?.chart_annotations,
    ];
    return candidates.find(Array.isArray) || [];
  }

  function annotationOverlay(annotation, context) {
    if (!identityMatches(annotation, context) || !lineagePresent(annotation)) return null;
    const exactObservedAt = observedAt(annotation);
    const time = chartTimeFor(exactObservedAt, context.candles);
    if (!time) return null;
    const type = String(annotation.type || annotation.event_type || "regime-marker").replace(/_/g, "-");
    const mode = ["pressure", "structure", "participation", "replay", "risk"].includes(annotation.mode) ? annotation.mode : "structure";
    return {
      id: annotation.id || annotation.annotation_id || annotation.evidence_id,
      type,
      time,
      label: annotation.label || annotation.event_label || "Raven detection",
      value: finite(annotation.value ?? annotation.score),
      severity: annotation.severity || "info",
      source: annotation.source || annotation.producer || "Raven evidence",
      observed_at: exactObservedAt,
      freshness_state: freshness(annotation),
      summary: annotation.summary || "Timestamped Raven evidence attached to this market candle.",
      metadata: {
        evidence_id: annotation.evidence_id || annotation.source_evidence_id,
        execution_observation_id: annotation.execution_observation_id,
        lineage_id: annotation.lineage_id,
        source_lineage: annotation.source_lineage,
        exact_event_time: exactObservedAt,
        chart_candle_time: time,
      },
      raven_read: {
        schema_version: "ravenos.chart_annotation.v1",
        mode,
        title: annotation.label || annotation.event_label || "Raven detection",
        summary: annotation.summary || "Timestamped Raven evidence attached to this market candle.",
        evidence: [{ source: annotation.source || annotation.producer || "Raven evidence", observed_at: exactObservedAt }],
        confidence: annotation.confidence || "unrated",
      },
    };
  }

  function currentPressureOverlay(symbol, market, candles, pressureContext) {
    if (!pressureContext || !Array.isArray(candles) || !candles.length) return null;
    const exactObservedAt = observedAt(pressureContext);
    if (!exactObservedAt) return null;
    const score = finite(pressureContext.pressureScore);
    const availableFields = ["funding", "openInterest", "markPx", "oraclePx", "dayNtlVlm"]
      .filter((key) => finite(pressureContext[key]) !== null);
    if (score === null || availableFields.length < 2) return null;
    const time = candles[candles.length - 1]?.time;
    const label = pressureContext.pressureState && pressureContext.pressureState !== "Unknown"
      ? `${pressureContext.pressureState} pressure snapshot`
      : "Current pressure snapshot";
    return {
      id: `${String(symbol || "asset").toUpperCase()}-current-pressure-${exactObservedAt}`,
      type: "regime-marker",
      time,
      label,
      value: score,
      severity: score >= 75 ? "warning" : "info",
      source: pressureContext.provider || "Hyperliquid",
      observed_at: exactObservedAt,
      freshness_state: freshness(pressureContext),
      summary: `Current decision-time snapshot from ${availableFields.join(", ")}. This is not a reconstructed historical signal.`,
      metadata: {
        pressureScore: score,
        pressure_state: pressureContext.pressureState,
        pressure_context: pressureContext.pressureContext,
        funding: finite(pressureContext.funding),
        open_interest: finite(pressureContext.openInterest),
        mark_px: finite(pressureContext.markPx),
        oracle_px: finite(pressureContext.oraclePx),
        day_ntl_vlm: finite(pressureContext.dayNtlVlm),
        exact_observed_at: exactObservedAt,
        chart_candle_time: time,
        market,
      },
      raven_read: {
        schema_version: "ravenos.current_pressure_snapshot.v1",
        mode: "pressure",
        title: label,
        summary: `Current decision-time snapshot from ${availableFields.join(", ")}.`,
        evidence: [{ source: pressureContext.provider || "Hyperliquid", observed_at: exactObservedAt }],
        confidence: availableFields.length >= 4 ? "measured" : "partial",
      },
    };
  }

  function getOverlays({ symbol, market = "spot", candles = [], pressureContext = null, evidenceContext = {}, chartContext = null, technical = null } = {}) {
    const context = { symbol, market, candles, chartContext };
    const overlays = annotationRows(evidenceContext)
      .map((annotation) => annotationOverlay(annotation, context))
      .filter(Boolean);
    const pressure = currentPressureOverlay(symbol, market, candles, pressureContext);
    if (pressure) overlays.push(pressure);
    if (technical !== false) {
      const analysis = deriveTechnicalAnalysis({
        candles,
        timeframe: chartContext?.timeframe || "1h",
        instrumentId: chartContext?.instrumentId || chartContext?.marketIdentity || null,
        source: chartContext?.source || "Exact-market candles",
        sourceState: chartContext?.sourceState || "provider_backed",
        observedAt: chartContext?.observedAt || null,
      });
      overlays.push(...analysis.overlays);
    }
    return overlays;
  }

  window.RavenChartOverlays = Object.freeze({
    TECHNICAL_OVERLAY_SCHEMA,
    TECHNICAL_OVERLAY_KEYS,
    deriveTechnicalAnalysis,
    getOverlays,
  });
})();
