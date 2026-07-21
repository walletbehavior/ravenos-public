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

  function getOverlays({ symbol, market = "spot", candles = [], pressureContext = null, evidenceContext = {}, chartContext = null } = {}) {
    const context = { symbol, market, candles, chartContext };
    const overlays = annotationRows(evidenceContext)
      .map((annotation) => annotationOverlay(annotation, context))
      .filter(Boolean);
    const pressure = currentPressureOverlay(symbol, market, candles, pressureContext);
    if (pressure) overlays.push(pressure);
    return overlays;
  }

  window.RavenChartOverlays = Object.freeze({ getOverlays });
})();
