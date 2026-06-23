(function () {
  const SEVERITY_COLOR = {
    info: "#7dd3fc",
    warning: "#facc15",
    danger: "#fb7185",
    success: "#34d399",
  };

  const OVERLAY_META = {
    "pressure-zone": { label: "Pressure", color: "#fb7185", glyph: "P", family: "pressure" },
    "history-window": { label: "Replay", color: "#7dd3fc", glyph: "R", family: "replay" },
    "breadth-line": { label: "Breadth", color: "#34d399", glyph: "B", family: "breadth" },
    "compression-band": { label: "Volatility", color: "#facc15", glyph: "V", family: "volatility" },
    "regime-marker": { label: "Regime", color: "#7dd3fc", glyph: "G", family: "regime" },
    "liquidity-zone": { label: "Liquidity", color: "#a78bfa", glyph: "L", family: "liquidity" },
    "participant-shift": { label: "Participation", color: "#34d399", glyph: "•", family: "participation" },
    "reward-zone": { label: "Reward/Punish", color: "#2dd4bf", glyph: "±", family: "outcome" },
    "expansion-path": { label: "Expansion Path", color: "#facc15", glyph: "↗", family: "structure" },
    "participation-quality": { label: "Participation Quality", color: "#34d399", glyph: "Q", family: "participation" },
    "outcome-memory": { label: "Outcome Memory", color: "#7dd3fc", glyph: "M", family: "replay" },
    "conflict-marker": { label: "Pressure Conflict", color: "#fb923c", glyph: "!", family: "conflict" },
  };

  const CONTEXT_DEFAULT_TYPES = {
    perps: ["reward-zone", "pressure-zone", "conflict-marker"],
    crypto_perp: ["reward-zone", "pressure-zone", "conflict-marker"],
    degen: ["reward-zone", "expansion-path", "participation-quality"],
    crypto_spot: ["reward-zone", "participation-quality", "outcome-memory"],
    atlas: ["regime-marker", "breadth-line", "liquidity-zone"],
    macro: ["regime-marker", "breadth-line", "compression-band"],
    default: ["reward-zone", "participation-quality", "outcome-memory"],
  };

  const EVENT_GLYPHS = {
    "entry-zone": "E",
    "exit-zone": "X",
    "liquidity-warning": "L",
    "smart-wallet-accumulation": "A",
    "smart-wallet-distribution": "D",
    "opportunity-marker": "O",
    "toxicity-risk": "!",
  };

  const OVERLAY_RENDERER_REGISTRY = {
    "pressure-zone": { renderAs: "price-region" },
    "history-window": { renderAs: "time-region" },
    "breadth-line": { renderAs: "line" },
    "compression-band": { renderAs: "price-region" },
    "regime-marker": { renderAs: "marker" },
    "liquidity-zone": { renderAs: "price-region" },
    "participant-shift": { renderAs: "marker" },
    "reward-zone": { renderAs: "price-region" },
    "expansion-path": { renderAs: "time-region" },
    "participation-quality": { renderAs: "line" },
    "outcome-memory": { renderAs: "marker" },
    "conflict-marker": { renderAs: "marker" },
  };

  function overlayType(type) {
    return String(type || "regime-marker").replace(/_/g, "-");
  }

  function colorFor(item) {
    return SEVERITY_COLOR[item?.severity] || OVERLAY_META[overlayType(item?.type)]?.color || SEVERITY_COLOR.info;
  }

  function visualMeta(item) {
    const type = overlayType(item?.type);
    const base = OVERLAY_META[type] || { label: "Overlay", color: SEVERITY_COLOR.info, glyph: "•", family: "flow" };
    const family = item?.metadata?.visualFamily || item?.metadata?.family || base.family;
    const label = item?.metadata?.visualLabel || base.label;
    const glyph = item?.metadata?.glyph || base.glyph;
    return { ...base, family, label, glyph };
  }

  function contextKey(value) {
    const text = String(value || "default").toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
    if (text.includes("perp")) return "perps";
    if (text.includes("degen") || text.includes("discovery")) return "degen";
    if (text.includes("atlas") || text.includes("macro")) return "atlas";
    if (text.includes("spot")) return "crypto_spot";
    return CONTEXT_DEFAULT_TYPES[text] ? text : "default";
  }

  function defaultActiveTypes(overlays, context) {
    const available = Array.from(new Set(overlays.map((overlay) => overlay.type)));
    const preferred = CONTEXT_DEFAULT_TYPES[contextKey(context)] || CONTEXT_DEFAULT_TYPES.default;
    const active = preferred.filter((type) => available.includes(type));
    for (const type of available) {
      if (active.length >= 3) break;
      if (!active.includes(type)) active.push(type);
    }
    return active.slice(0, 3);
  }

  function normalizeCandles(candles) {
    return (Array.isArray(candles) ? candles : [])
      .filter((candle) => candle && candle.time && Number.isFinite(Number(candle.close)))
      .map((candle) => ({
        time: candle.time,
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
      }));
  }

  function normalizeVolume(candles) {
    return (Array.isArray(candles) ? candles : [])
      .filter((candle) => candle && candle.time && Number.isFinite(Number(candle.volume)))
      .map((candle) => ({
        time: candle.time,
        value: Number(candle.volume),
        color: Number(candle.close) >= Number(candle.open) ? "rgba(52, 211, 153, 0.32)" : "rgba(251, 113, 133, 0.28)",
      }));
  }

  function markerFor(event, compact = false) {
    const above = event.type === "liquidity-warning" || event.type === "toxicity-risk" || event.type === "smart-wallet-distribution";
    return {
      time: event.time,
      position: above ? "aboveBar" : "belowBar",
      color: colorFor(event),
      shape: event.type === "opportunity-marker" ? "circle" : above ? "arrowDown" : "arrowUp",
      text: compact ? "" : (EVENT_GLYPHS[event.type] || "•"),
    };
  }

  function overlayMarker(overlay, compact = false) {
    const type = overlayType(overlay.type);
    const above = type === "pressure-zone" || type === "regime-marker" || type === "distribution-risk" || type === "conflict-marker";
    return {
      time: overlay.time || overlay.startTime,
      position: above ? "aboveBar" : "belowBar",
      color: colorFor(overlay),
      shape: type === "participant-shift" || type === "outcome-memory" || type === "conflict-marker" ? "circle" : above ? "arrowDown" : "arrowUp",
      text: compact ? "" : visualMeta(overlay).glyph,
    };
  }

  function normalizeOverlayValues(overlay) {
    return (Array.isArray(overlay?.values) ? overlay.values : [])
      .filter((point) => point && point.time && Number.isFinite(Number(point.value)))
      .map((point) => ({ time: point.time, value: Number(point.value) }));
  }

  function priceLineTitle(event) {
    return EVENT_GLYPHS[event.type] || "";
  }

  function setState(container, message, className) {
    container.innerHTML = `<div class="chart-state ${className || ""}">${message}</div>`;
  }

  function createTooltip(chartHost) {
    const tooltip = document.createElement("div");
    tooltip.className = "raven-overlay-tooltip";
    tooltip.style.position = "absolute";
    tooltip.style.zIndex = "9";
    tooltip.style.display = "none";
    tooltip.style.maxWidth = "280px";
    tooltip.style.padding = "9px 10px";
    tooltip.style.border = "1px solid rgba(125, 211, 252, 0.28)";
    tooltip.style.background = "rgba(5, 9, 7, 0.96)";
    tooltip.style.boxShadow = "0 14px 36px rgba(0, 0, 0, 0.38)";
    tooltip.style.color = "#e5f0eb";
    tooltip.style.font = "12px/1.45 Inter, ui-sans-serif, system-ui, sans-serif";
    tooltip.style.pointerEvents = "none";
    chartHost.appendChild(tooltip);
    return tooltip;
  }

  function showTooltip(tooltip, chartHost, event, overlay) {
    const rect = chartHost.getBoundingClientRect();
    const meta = visualMeta(overlay);
    const title = overlay.label || meta.label || "Overlay";
    const score = Number.isFinite(Number(overlay.value)) ? `<div style="color:#8da39a;margin-top:4px">Score ${Math.round(Number(overlay.value))}</div>` : "";
    const confidence = Number(overlay.metadata?.confidence ?? overlay.confidence);
    const sampleDepth = Number(overlay.metadata?.sampleDepth ?? overlay.sampleDepth);
    const evidence = Array.isArray(overlay.metadata?.evidence) ? overlay.metadata.evidence.slice(0, 3) : [];
    const confidenceLine = Number.isFinite(confidence) ? `<div style="color:#8da39a;margin-top:4px">Confidence ${Math.round(confidence)}${Number.isFinite(sampleDepth) ? ` · ${sampleDepth} samples` : ""}</div>` : "";
    const evidenceLine = evidence.length ? `<ul style="margin:6px 0 0;padding-left:15px;color:#9fb5aa">${evidence.map((item) => `<li>${item}</li>`).join("")}</ul>` : "";
    tooltip.innerHTML = `<strong style="display:block;color:${colorFor(overlay)};margin-bottom:4px">${title}</strong><span>${overlay.summary || ""}</span>${score}${confidenceLine}${evidenceLine}`;
    tooltip.style.left = `${Math.min(rect.width - 292, Math.max(8, event.clientX - rect.left + 12))}px`;
    tooltip.style.top = `${Math.min(rect.height - 110, Math.max(8, event.clientY - rect.top + 12))}px`;
    tooltip.style.display = "block";
  }

  function hideTooltip(tooltip) {
    tooltip.style.display = "none";
  }

  function createRegion(layer, tooltip, chartHost, overlay, rect) {
    const color = colorFor(overlay);
    const confidence = Number(overlay.metadata?.confidence ?? overlay.confidence ?? overlay.value ?? 62);
    const opacity = Math.max(0.08, Math.min(0.24, confidence / 420));
    const borderOpacity = Math.max(0.25, Math.min(0.7, confidence / 150));
    const region = document.createElement("button");
    region.type = "button";
    region.className = `raven-overlay-region raven-overlay-${overlayType(overlay.type)}`;
    region.setAttribute("aria-label", `${overlay.label}: ${overlay.summary || ""}`);
    region.style.position = "absolute";
    region.style.left = `${Math.max(0, rect.left)}px`;
    region.style.top = `${Math.max(0, rect.top)}px`;
    region.style.width = `${Math.max(4, rect.width)}px`;
    region.style.height = `${Math.max(4, rect.height)}px`;
    region.style.border = `1px ${overlay.metadata?.sampleDepth < 20 ? "dashed" : "solid"} ${color}${Math.round(borderOpacity * 255).toString(16).padStart(2, "0")}`;
    region.style.background = `${color}${Math.round(opacity * 255).toString(16).padStart(2, "0")}`;
    region.style.boxShadow = `inset 0 0 0 1px ${color}14`;
    region.style.cursor = "help";
    region.style.pointerEvents = "auto";
    region.style.padding = "0";
    region.style.outline = "0";
    region.addEventListener("mousemove", (event) => showTooltip(tooltip, chartHost, event, overlay));
    region.addEventListener("mouseleave", () => hideTooltip(tooltip));
    layer.appendChild(region);
  }

  function createLegend(container, overlays, activeTypes, onToggle) {
    const existing = container.querySelector(".raven-overlay-legend");
    if (existing) existing.remove();
    const types = Array.from(new Set(overlays.map((overlay) => overlayType(overlay.type)))).filter((type) => OVERLAY_META[type]);
    if (!types.length) return null;

    const legend = document.createElement("div");
    legend.className = "raven-overlay-legend";
    legend.style.display = "flex";
    legend.style.flexWrap = "wrap";
    legend.style.gap = "6px";
    legend.style.alignItems = "center";
    legend.style.padding = "8px 0 0";
    legend.style.font = "11px Inter, ui-sans-serif, system-ui, sans-serif";

    types.forEach((type) => {
      const meta = OVERLAY_META[type];
      const button = document.createElement("button");
      button.type = "button";
      button.innerHTML = `<span aria-hidden="true" style="display:inline-flex;width:14px;color:${meta.color};font-weight:900">${meta.glyph}</span>${meta.label}`;
      button.dataset.overlayType = type;
      button.dataset.active = activeTypes.has(type) ? "true" : "false";
      button.style.border = `1px solid ${meta.color}55`;
      button.style.background = activeTypes.has(type) ? `${meta.color}22` : "rgba(8, 17, 14, 0.72)";
      button.style.color = activeTypes.has(type) ? "#e5f0eb" : "#60746b";
      button.style.padding = "5px 7px";
      button.style.cursor = "pointer";
      button.style.fontWeight = "800";
      button.style.textTransform = "uppercase";
      button.addEventListener("click", () => onToggle(type));
      legend.appendChild(button);
    });

    container.appendChild(legend);
    return legend;
  }

  function RavenPriceChart(container, options) {
    if (!container) return null;
    const api = window.LightweightCharts;
    const candles = normalizeCandles(options?.candles);
    const events = Array.isArray(options?.events) ? options.events : [];
    const overlays = (Array.isArray(options?.overlays) ? options.overlays : []).map((overlay) => ({ ...overlay, type: overlayType(overlay.type) }));
    const activeTypes = new Set(options?.visibleOverlayTypes || defaultActiveTypes(overlays, options?.overlayContext || options?.marketContext));
    const compact = Boolean(options?.compact || window.matchMedia?.("(max-width: 780px)")?.matches);

    if (options?.loading) {
      setState(container, "Loading chart...", "loading");
      return null;
    }
    if (options?.error) {
      setState(container, options.error, "error");
      return null;
    }
    if (!api || typeof api.createChart !== "function") {
      setState(container, "Chart runtime unavailable.", "error");
      return null;
    }
    if (!candles.length) {
      setState(container, options?.emptyLabel || "No chart data available.", "empty");
      return null;
    }

    container.innerHTML = "";
    const chartHost = document.createElement("div");
    chartHost.className = "raven-chart-host-inner";
    chartHost.style.position = "relative";
    chartHost.style.minHeight = `${options?.height || 520}px`;
    chartHost.style.overflow = "hidden";
    container.appendChild(chartHost);

    const chart = api.createChart(chartHost, {
      height: options?.height || 520,
      width: chartHost.clientWidth || container.clientWidth,
      layout: {
        background: { color: "#050907" },
        textColor: "#9fb5aa",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(125, 211, 252, 0.06)" },
        horzLines: { color: "rgba(125, 211, 252, 0.06)" },
      },
      rightPriceScale: { borderColor: "rgba(148, 163, 184, 0.18)" },
      timeScale: {
        borderColor: "rgba(148, 163, 184, 0.18)",
        timeVisible: !compact,
        secondsVisible: false,
      },
      crosshair: { mode: 0 },
    });

    const candleSeries = chart.addSeries(api.CandlestickSeries, {
      upColor: "#34d399",
      downColor: "#fb7185",
      borderUpColor: "#34d399",
      borderDownColor: "#fb7185",
      wickUpColor: "#86efac",
      wickDownColor: "#fca5a5",
      priceFormat: {
        type: "price",
        precision: 6,
        minMove: 0.000001,
      },
    });
    candleSeries.setData(candles);

    if (options?.showVolume !== false) {
      const volumeSeries = chart.addSeries(api.HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
      });
      volumeSeries.setData(normalizeVolume(options?.candles));
      chart.priceScale("volume").applyOptions({
        scaleMargins: {
          top: options?.compact ? 0.78 : 0.72,
          bottom: 0,
        },
      });
    }

    function visibleOverlays(type) {
      return overlays.filter((overlay) => activeTypes.has(overlay.type) && (!type || overlay.type === type));
    }

    visibleOverlays("breadth-line").forEach((overlay) => {
      const values = normalizeOverlayValues(overlay);
      if (!values.length) return;
      const lineSeries = chart.addSeries(api.LineSeries, {
        color: colorFor(overlay),
        lineWidth: 2,
        priceScaleId: `overlay-${overlay.id || overlay.label}`,
        priceLineVisible: false,
        lastValueVisible: true,
        title: overlay.label,
      });
      lineSeries.setData(values);
      chart.priceScale(`overlay-${overlay.id || overlay.label}`).applyOptions({
        scaleMargins: { top: 0.08, bottom: options?.showVolume === false ? 0.12 : 0.74 },
        borderVisible: false,
      });
    });

    const markers = events.filter((event) => event && event.time).map((event) => markerFor(event, compact)).concat(
      visibleOverlays()
        .filter((overlay) => OVERLAY_RENDERER_REGISTRY[overlay.type]?.renderAs === "marker")
        .filter((overlay) => overlay.time || overlay.startTime)
        .map((overlay) => overlayMarker(overlay, compact)),
    );
    if (typeof api.createSeriesMarkers === "function") api.createSeriesMarkers(candleSeries, markers);
    else if (typeof candleSeries.setMarkers === "function") candleSeries.setMarkers(markers);

    events
      .filter((event) => Number.isFinite(Number(event?.price)))
      .forEach((event) => {
        candleSeries.createPriceLine({
          price: Number(event.price),
          color: colorFor(event),
          lineWidth: 1,
          lineStyle: api.LineStyle?.Dashed || 2,
          axisLabelVisible: Boolean(options?.showPriceLineLabels),
          title: options?.showPriceLineLabels ? priceLineTitle(event) : "",
        });
      });

    visibleOverlays()
      .filter((overlay) => Number.isFinite(Number(overlay.priceMin)) || Number.isFinite(Number(overlay.priceMax)))
      .forEach((overlay) => {
        if (Number.isFinite(Number(overlay.priceMin))) {
          candleSeries.createPriceLine({
            price: Number(overlay.priceMin),
            color: colorFor(overlay),
            lineWidth: 1,
            lineStyle: api.LineStyle?.Dotted || 1,
            axisLabelVisible: false,
            title: "",
          });
        }
        if (Number.isFinite(Number(overlay.priceMax))) {
          candleSeries.createPriceLine({
            price: Number(overlay.priceMax),
            color: colorFor(overlay),
            lineWidth: 1,
            lineStyle: api.LineStyle?.Dotted || 1,
            axisLabelVisible: false,
            title: "",
          });
        }
      });

    const regionLayer = document.createElement("div");
    regionLayer.className = "raven-overlay-regions";
    regionLayer.style.position = "absolute";
    regionLayer.style.left = "0";
    regionLayer.style.top = "0";
    regionLayer.style.pointerEvents = "none";
    regionLayer.style.zIndex = "3";
    chartHost.appendChild(regionLayer);
    const tooltip = createTooltip(chartHost);

    function renderRegions() {
      regionLayer.innerHTML = "";
      const width = chartHost.clientWidth || container.clientWidth;
      const chartRoot = chartHost.querySelector(".tv-lightweight-charts");
      const plotCell = chartRoot?.querySelector("td[style*='position: relative']");
      const plotRect = plotCell?.getBoundingClientRect?.();
      const hostRect = chartHost.getBoundingClientRect();
      const plotHeight = plotRect ? Math.max(0, plotRect.height) : Math.max(0, (options?.height || 520) - 34);
      const plotTop = plotRect ? Math.max(0, plotRect.top - hostRect.top) : 0;
      const plotWidth = plotRect ? Math.max(0, plotRect.width) : width;
      regionLayer.style.top = `${plotTop}px`;
      regionLayer.style.width = `${plotWidth}px`;
      regionLayer.style.height = `${plotHeight}px`;
      regionLayer.style.overflow = "hidden";
      visibleOverlays().forEach((overlay) => {
        const type = overlay.type;
        const renderAs = OVERLAY_RENDERER_REGISTRY[type]?.renderAs;
        if (renderAs === "line" || renderAs === "marker") return;

        const start = overlay.startTime ? chart.timeScale().timeToCoordinate(overlay.startTime) : 0;
        const end = overlay.endTime ? chart.timeScale().timeToCoordinate(overlay.endTime) : width;
        const left = start === null || start === undefined ? 0 : Math.min(start, end === null || end === undefined ? width : end);
        const right = end === null || end === undefined ? width : Math.max(start || 0, end);

        if (renderAs === "price-region" && Number.isFinite(Number(overlay.priceMin)) && Number.isFinite(Number(overlay.priceMax))) {
          const yMin = candleSeries.priceToCoordinate(Number(overlay.priceMin));
          const yMax = candleSeries.priceToCoordinate(Number(overlay.priceMax));
          if (yMin === null || yMax === null || yMin === undefined || yMax === undefined) return;
          createRegion(regionLayer, tooltip, chartHost, overlay, {
            left,
            top: Math.min(yMin, yMax),
            width: right - left,
            height: Math.abs(yMax - yMin),
          });
          return;
        }

        if (renderAs === "time-region") {
          createRegion(regionLayer, tooltip, chartHost, overlay, {
            left,
            top: plotHeight * 0.08,
            width: right - left,
            height: plotHeight * 0.78,
          });
        }
      });
    }

    function redrawLegend() {
      createLegend(container, overlays, activeTypes, (type) => {
        if (activeTypes.has(type)) activeTypes.delete(type);
        else activeTypes.add(type);
        apiRef.destroy();
        const next = RavenPriceChart(container, {
          ...options,
          visibleOverlayTypes: Array.from(activeTypes),
        });
        apiRef.chart = next?.chart;
        apiRef.destroy = next?.destroy || apiRef.destroy;
      });
    }

    chart.timeScale().fitContent();
    renderRegions();
    if (options?.showOverlayLegend !== false) redrawLegend();
    chart.timeScale().subscribeVisibleTimeRangeChange(renderRegions);
    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ width: chartHost.clientWidth || container.clientWidth });
      renderRegions();
    });
    resizeObserver.observe(chartHost);

    const apiRef = {
      chart,
      destroy() {
        chart.timeScale().unsubscribeVisibleTimeRangeChange(renderRegions);
        resizeObserver.disconnect();
        chart.remove();
        container.innerHTML = "";
      },
    };
    return apiRef;
  }

  window.RavenChartOverlayRenderers = OVERLAY_RENDERER_REGISTRY;
  window.RavenChartOverlayVisuals = { meta: OVERLAY_META, defaults: CONTEXT_DEFAULT_TYPES, defaultActiveTypes };
  window.RavenPriceChart = RavenPriceChart;
})();
