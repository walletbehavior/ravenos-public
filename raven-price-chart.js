(function () {
  const SEVERITY_COLOR = {
    info: "#7dd3fc",
    warning: "#facc15",
    danger: "#fb7185",
    success: "#34d399",
  };

  const OVERLAY_META = {
    structure: { label: "Structure", color: "#7dd3fc" },
    pressure: { label: "Pressure", color: "#fb7185" },
    participation: { label: "Participation", color: "#34d399" },
    replay: { label: "History", color: "#a78bfa" },
    risk: { label: "Risk", color: "#facc15" },
    "pressure-zone": { label: "Pressure", color: "#fb7185" },
    "history-window": { label: "History", color: "#a78bfa" },
    "breadth-line": { label: "Participation", color: "#34d399" },
    "compression-band": { label: "Structure", color: "#7dd3fc" },
    "regime-marker": { label: "Risk", color: "#facc15" },
    "liquidity-zone": { label: "Risk", color: "#facc15" },
    "participant-shift": { label: "Participation", color: "#34d399" },
  };

  const OVERLAY_RENDERER_REGISTRY = {
    "pressure-zone": { renderAs: "price-region" },
    "history-window": { renderAs: "time-region" },
    "breadth-line": { renderAs: "line" },
    "compression-band": { renderAs: "price-region" },
    "regime-marker": { renderAs: "marker" },
    "liquidity-zone": { renderAs: "price-region" },
    "participant-shift": { renderAs: "marker" },
  };

  const RAVEN_OVERLAY_GROUPS = ["Flow", "Structure", "Participants", "History", "Risk"];
  const RAVEN_OVERLAY_LIBRARY = [
    { id: "pressure", label: "Pressure", group: "Flow", keys: ["pressure", "pressure-zone"] },
    { id: "liquidity", label: "Liquidity", group: "Flow", keys: ["liquidity-zone"] },
    { id: "structure", label: "Structure", group: "Structure", keys: ["structure"] },
    { id: "compression", label: "Compression", group: "Structure", keys: ["compression-band"] },
    { id: "participants", label: "Participants", group: "Participants", keys: ["participation", "participant-shift", "breadth-line"] },
    { id: "similar-history", label: "Similar history", group: "History", keys: ["replay", "history-window"] },
    { id: "risk", label: "Risk", group: "Risk", keys: ["risk", "regime-marker"] },
  ];

  function overlayType(type) {
    return String(type || "regime-marker").replace(/_/g, "-");
  }

  function overlayKey(overlay) {
    return overlay?.raven_read?.mode || overlayType(overlay?.type);
  }

  function colorFor(item) {
    return item?.raven_read?.mode ? OVERLAY_META[item.raven_read.mode]?.color || SEVERITY_COLOR.info : SEVERITY_COLOR[item?.severity] || OVERLAY_META[overlayType(item?.type)]?.color || SEVERITY_COLOR.info;
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

  function indicatorSourceState(options) {
    const value = String(options?.indicatorSourceState || options?.chartDataSource || "").toLowerCase();
    if (value === "provider_backed" || value === "terminal_chart_api" || value === "live") return "provider_backed";
    if (value === "structure_proxy" || value === "local_fallback" || value === "public_fallback") return "structure_proxy";
    return "coverage_developing";
  }

  function emaSeries(candles, period) {
    if (!Number.isFinite(period) || candles.length < period) return [];
    const multiplier = 2 / (period + 1);
    let previous = 0;
    const output = [];
    candles.forEach((candle, index) => {
      const close = Number(candle.close);
      if (!Number.isFinite(close)) return;
      if (index < period - 1) {
        previous += close;
        return;
      }
      if (index === period - 1) {
        previous = (previous + close) / period;
      } else {
        previous = close * multiplier + previous * (1 - multiplier);
      }
      output.push({ time: candle.time, value: previous });
    });
    return output;
  }

  function vwapSeries(candles) {
    let cumulativeVolume = 0;
    let cumulativeValue = 0;
    const output = [];
    candles.forEach((candle) => {
      const volume = Number(candle.volume);
      const close = Number(candle.close);
      if (!Number.isFinite(volume) || volume <= 0 || !Number.isFinite(close)) return;
      const high = Number(candle.high);
      const low = Number(candle.low);
      const typical = Number.isFinite(high) && Number.isFinite(low) ? (high + low + close) / 3 : close;
      cumulativeVolume += volume;
      cumulativeValue += typical * volume;
      if (cumulativeVolume > 0) output.push({ time: candle.time, value: cumulativeValue / cumulativeVolume });
    });
    return output;
  }

  function markerFor(event) {
    const above = event.type === "liquidity-warning" || event.type === "toxicity-risk";
    return {
      time: event.time,
      position: above ? "aboveBar" : "belowBar",
      color: colorFor(event),
      shape: event.type === "opportunity-marker" ? "circle" : above ? "arrowDown" : "arrowUp",
      text: "",
    };
  }

  function overlayMarker(overlay) {
    const type = overlayType(overlay.type);
    const above = type === "pressure-zone" || type === "regime-marker" || type === "distribution-risk";
    return {
      time: overlay.time || overlay.startTime,
      position: above ? "aboveBar" : "belowBar",
      color: colorFor(overlay),
      shape: type === "participant-shift" ? "circle" : above ? "arrowDown" : "arrowUp",
      text: "",
    };
  }

  function normalizeOverlayValues(overlay) {
    return (Array.isArray(overlay?.values) ? overlay.values : [])
      .filter((point) => point && point.time && Number.isFinite(Number(point.value)))
      .map((point) => ({ time: point.time, value: Number(point.value) }));
  }

  function setState(container, message, className) {
    container.innerHTML = `<div class="chart-state ${className || ""}">${message}</div>`;
  }

  function adaptivePriceFormatter(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return "$0";
    const abs = Math.abs(n);
    if (abs >= 1000) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
    if (abs >= 1) return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: abs >= 100 ? 2 : 4 })}`;
    const decimals = abs >= 0.01 ? 4 : abs >= 0.000001 ? 6 : 8;
    return `$${n.toLocaleString("en-US", {
      minimumFractionDigits: Math.min(2, decimals),
      maximumFractionDigits: decimals,
    })}`;
  }

  function createTooltip(chartHost) {
    const tooltip = document.createElement("div");
    tooltip.className = "raven-overlay-tooltip";
    tooltip.style.position = "absolute";
    tooltip.style.zIndex = "9";
    tooltip.style.display = "none";
    tooltip.style.left = "8px";
    tooltip.style.top = "8px";
    tooltip.style.right = "auto";
    tooltip.style.maxWidth = "260px";
    tooltip.style.padding = "7px 9px";
    tooltip.style.border = "1px solid rgba(125, 211, 252, 0.28)";
    tooltip.style.background = "rgba(5, 9, 7, 0.96)";
    tooltip.style.boxShadow = "0 14px 36px rgba(0, 0, 0, 0.38)";
    tooltip.style.color = "#edf3fb";
    tooltip.style.font = "12px/1.45 Inter, ui-sans-serif, system-ui, sans-serif";
    tooltip.style.pointerEvents = "none";
    chartHost.appendChild(tooltip);
    return tooltip;
  }

  function showTooltip(tooltip, chartHost, overlay) {
    const read = overlay.raven_read;
    if (read) {
      const modeLabel = OVERLAY_META[read.mode]?.label || read.mode || "Raven";
      const shortLabel = String(read.short_label || read.title || "context").replace(/\s+/g, " ");
      const status = [read.status, read.confidence].filter(Boolean).join(" · ") || "forming";
      tooltip.innerHTML = `
        <span style="display:block;color:#8f9db2;font-size:10px;font-weight:850;text-transform:uppercase;margin-bottom:3px">${modeLabel}</span>
        <strong style="display:block;color:${colorFor(overlay)};margin-bottom:4px">${shortLabel}</strong>
        <span style="display:block;color:#b6c2d2">${status}</span>`;
    } else {
      const title = overlay.label || OVERLAY_META[overlayType(overlay.type)]?.label || "Overlay";
      const score = Number.isFinite(Number(overlay.value)) ? `<div style="color:#8f9db2;margin-top:4px">Score ${Math.round(Number(overlay.value))}</div>` : "";
      tooltip.innerHTML = `<strong style="display:block;color:${colorFor(overlay)};margin-bottom:4px">${title}</strong><span>${overlay.summary || ""}</span>${score}`;
    }
    tooltip.style.left = "8px";
    tooltip.style.top = "8px";
    tooltip.style.right = "auto";
    tooltip.style.transform = "none";
    tooltip.style.display = "block";
  }

  function hideTooltip(tooltip) {
    tooltip.style.display = "none";
  }

  function createRegion(layer, tooltip, chartHost, overlay, rect, onSelect) {
    const color = colorFor(overlay);
    const region = document.createElement("button");
    region.type = "button";
    region.className = `raven-overlay-region raven-overlay-${overlayType(overlay.type)}`;
    region.setAttribute("aria-label", overlay.raven_read ? `${overlay.raven_read.title}: ${overlay.raven_read.plain_english_read}` : `${overlay.label}: ${overlay.summary || ""}`);
    region.style.position = "absolute";
    region.style.left = `${Math.max(0, rect.left)}px`;
    region.style.top = `${Math.max(0, rect.top)}px`;
    region.style.width = `${Math.max(4, rect.width)}px`;
    region.style.height = `${Math.max(4, rect.height)}px`;
    region.style.border = `1px solid ${color}77`;
    region.style.background = `${color}0e`;
    region.style.boxShadow = `inset 0 0 0 1px ${color}10`;
    region.style.cursor = "help";
    region.style.pointerEvents = "auto";
    region.style.padding = "0";
    region.style.outline = "0";
    region.addEventListener("mouseenter", () => showTooltip(tooltip, chartHost, overlay));
    region.addEventListener("focus", () => showTooltip(tooltip, chartHost, overlay));
    region.addEventListener("mouseenter", () => onSelect?.(overlay));
    region.addEventListener("focus", () => onSelect?.(overlay));
    region.addEventListener("click", () => onSelect?.(overlay));
    region.addEventListener("mouseleave", () => hideTooltip(tooltip));
    region.addEventListener("blur", () => hideTooltip(tooltip));
    layer.appendChild(region);
  }

  function createLegend(container, overlays, activeTypes, onToggle, onClear) {
    const existing = container.querySelector(".raven-overlay-library");
    if (existing) existing.remove();
    const availableKeys = new Set(overlays.map(overlayKey));
    const availableEntries = RAVEN_OVERLAY_LIBRARY.filter((entry) => entry.keys.some((key) => availableKeys.has(key)));
    if (!availableEntries.length) return null;
    const availableGroups = RAVEN_OVERLAY_GROUPS.filter((group) => availableEntries.some((entry) => entry.group === group));
    const requestedGroup = container.dataset.ravenOverlayGroup;
    const selectedGroup = availableGroups.includes(requestedGroup) ? requestedGroup : availableGroups[0];

    const legend = document.createElement("div");
    legend.className = "raven-overlay-library";
    legend.innerHTML = `
      <div class="raven-overlay-categories" role="tablist" aria-label="Raven overlay categories"></div>
      <div class="raven-overlay-options" aria-label="Raven overlay options"></div>
      <div class="raven-overlay-active" aria-label="Active Raven overlays"></div>
    `;
    Object.assign(legend.style, { display: "grid", gap: "6px", padding: "7px 0 0", font: "11px Inter, ui-sans-serif, system-ui, sans-serif" });

    const categories = legend.querySelector(".raven-overlay-categories");
    Object.assign(categories.style, { display: "flex", flexWrap: "wrap", gap: "5px" });
    availableGroups.forEach((group) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.textContent = group;
      tab.dataset.overlayGroup = group;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", selectedGroup === group ? "true" : "false");
      Object.assign(tab.style, {
        border: `1px solid ${selectedGroup === group ? "rgba(125, 211, 252, 0.42)" : "rgba(148, 163, 184, 0.18)"}`,
        background: selectedGroup === group ? "rgba(125, 211, 252, 0.08)" : "rgba(8, 17, 14, 0.72)",
        color: selectedGroup === group ? "#edf3fb" : "#64738a",
        padding: "5px 7px",
        cursor: "pointer",
        fontWeight: "850",
        textTransform: "uppercase",
      });
      tab.addEventListener("click", () => {
        container.dataset.ravenOverlayGroup = group;
        createLegend(container, overlays, activeTypes, onToggle, onClear);
      });
      categories.appendChild(tab);
    });

    const optionsRow = legend.querySelector(".raven-overlay-options");
    Object.assign(optionsRow.style, { display: "flex", flexWrap: "wrap", gap: "5px" });
    availableEntries.filter((entry) => entry.group === selectedGroup).forEach((entry) => {
      const matchedKey = entry.keys.find((key) => availableKeys.has(key));
      const active = Boolean(matchedKey && activeTypes.has(matchedKey));
      const option = document.createElement("button");
      option.type = "button";
      option.textContent = entry.label;
      option.dataset.overlayId = entry.id;
      option.setAttribute("aria-pressed", active ? "true" : "false");
      const meta = OVERLAY_META[matchedKey] || { color: "#7dd3fc" };
      Object.assign(option.style, {
        border: `1px solid ${meta.color}55`,
        background: active ? `${meta.color}22` : "rgba(8, 17, 14, 0.72)",
        color: active ? "#edf3fb" : "#96a4b8",
        padding: "5px 7px",
        cursor: "pointer",
        fontWeight: "800",
        textTransform: "uppercase",
      });
      option.addEventListener("click", () => {
        const selected = overlays.find((overlay) => overlayKey(overlay) === matchedKey);
        onToggle(matchedKey, selected || null);
      });
      optionsRow.appendChild(option);
    });

    const activeRow = legend.querySelector(".raven-overlay-active");
    Object.assign(activeRow.style, { display: "flex", flexWrap: "wrap", gap: "5px", alignItems: "center", minHeight: "24px" });
    const activeEntries = Array.from(activeTypes);
    activeEntries.forEach((type) => {
      const entry = RAVEN_OVERLAY_LIBRARY.find((candidate) => candidate.keys.includes(type));
      const meta = OVERLAY_META[type] || { color: "#7dd3fc" };
      const chip = document.createElement("button");
      chip.type = "button";
      chip.textContent = `${entry?.label || OVERLAY_META[type]?.label || type} ×`;
      chip.dataset.activeOverlay = type;
      Object.assign(chip.style, {
        border: `1px solid ${meta.color}66`,
        background: `${meta.color}18`,
        color: "#edf3fb",
        padding: "4px 7px",
        cursor: "pointer",
        fontWeight: "850",
        textTransform: "uppercase",
      });
      chip.addEventListener("click", () => onToggle(type, null));
      activeRow.appendChild(chip);
    });
    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = activeEntries.length ? "Clear overlays" : "No active overlays";
    clear.disabled = !activeEntries.length;
    clear.dataset.clearOverlays = "true";
    Object.assign(clear.style, {
      border: "1px solid rgba(148, 163, 184, 0.18)",
      background: "rgba(255, 255, 255, 0.02)",
      color: activeEntries.length ? "#8f9db2" : "#64738a",
      padding: "4px 7px",
      cursor: activeEntries.length ? "pointer" : "not-allowed",
      fontWeight: "850",
      textTransform: "uppercase",
    });
    clear.addEventListener("click", () => {
      if (activeEntries.length) onClear?.();
    });
    activeRow.appendChild(clear);

    container.appendChild(legend);
    return legend;
  }

  function RavenPriceChart(container, options) {
    if (!container) return null;
    const api = window.LightweightCharts;
    let rawCandles = Array.isArray(options?.candles) ? [...options.candles] : [];
    let candles = normalizeCandles(rawCandles);
    let volumeByTime = new Map(normalizeVolume(rawCandles).map((row) => [String(row.time), row.value]));
    const events = Array.isArray(options?.events) ? options.events : [];
    const overlays = (Array.isArray(options?.overlays) ? options.overlays : []).map((overlay) => ({ ...overlay, type: overlayType(overlay.type) }));
    const context = {
      asset: options?.asset,
      symbol: options?.symbol,
      market: options?.market,
      venue: options?.venue,
      chain: options?.chain,
      timeframe: options?.timeframe,
    };
    const readTranslator = window.RavenReads?.translateOverlayToRavenRead;
    const enrichedOverlays = overlays.map((overlay) => {
      if (overlay.raven_read) return overlay;
      if (typeof readTranslator !== "function") return overlay;
      try {
        return { ...overlay, raven_read: readTranslator(overlay, context) };
      } catch {
        return overlay;
      }
    });
    if (typeof window !== "undefined") {
      window.__RAVENOS_LAST_RAVEN_READS__ = enrichedOverlays
        .map((overlay) => overlay.raven_read)
        .filter(Boolean);
    }
    const activeTypes = new Set(Array.isArray(options?.visibleOverlayTypes) ? options.visibleOverlayTypes : []);
    const priceFormatter = typeof options?.priceFormatter === "function" ? options.priceFormatter : adaptivePriceFormatter;

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
    const chartHeight = Number(options?.height) || 520;
    const chartHost = document.createElement("div");
    chartHost.className = "raven-chart-host-inner";
    chartHost.style.position = "relative";
    chartHost.style.minHeight = `${chartHeight}px`;
    chartHost.style.height = `${chartHeight}px`;
    container.appendChild(chartHost);

    const chart = api.createChart(chartHost, {
      height: chartHeight,
      width: chartHost.clientWidth || container.clientWidth,
      layout: {
        background: { color: "#060a11" },
        textColor: "#96a4b8",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(118, 152, 255, 0.055)" },
        horzLines: { color: "rgba(118, 152, 255, 0.055)" },
      },
      rightPriceScale: { borderColor: "rgba(148, 163, 184, 0.18)" },
      timeScale: {
        borderColor: "rgba(148, 163, 184, 0.18)",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: { mode: 0 },
      localization: {
        priceFormatter,
      },
    });

    const candleSeries = chart.addSeries(api.CandlestickSeries, {
      upColor: "#34d399",
      downColor: "#fb7185",
      borderUpColor: "#34d399",
      borderDownColor: "#fb7185",
      wickUpColor: "#86efac",
      wickDownColor: "#fca5a5",
      priceFormat: {
        type: "custom",
        formatter: priceFormatter,
      },
    });
    candleSeries.setData(candles);

    let volumeSeries = null;
    if (options?.showVolume !== false) {
      volumeSeries = chart.addSeries(api.HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
      });
      volumeSeries.setData(normalizeVolume(rawCandles));
      chart.priceScale("volume").applyOptions({
        visible: false,
        borderVisible: false,
        scaleMargins: {
          top: options?.compact ? 0.78 : 0.72,
          bottom: 0,
        },
      });
    }

    const indicatorState = {
      sourceState: indicatorSourceState(options),
      ema20: { status: "off", points: 0 },
      ema50: { status: "off", points: 0 },
      vwap: { status: "off", points: 0 },
      rsi: { status: "needs panel", points: 0 },
      macd: { status: "needs panel", points: 0 },
    };
    const activeIndicators = new Set(Array.isArray(options?.indicators) ? options.indicators : []);
    const indicatorDefinitions = [
      { key: "ema20", label: "EMA 20", color: "#7dd3fc", values: () => emaSeries(candles, 20) },
      { key: "ema50", label: "EMA 50", color: "#a78bfa", values: () => emaSeries(candles, 50) },
      { key: "vwap", label: "VWAP", color: "#facc15", values: () => vwapSeries(options?.candles || candles) },
    ];
    indicatorDefinitions.forEach((indicator) => {
      if (!activeIndicators.has(indicator.key)) return;
      if (indicatorState.sourceState !== "provider_backed") {
        indicatorState[indicator.key] = {
          status: indicatorState.sourceState === "structure_proxy" ? "unavailable on fallback chart" : "coverage developing",
          points: 0,
        };
        return;
      }
      const values = indicator.values();
      indicatorState[indicator.key] = {
        status: values.length ? indicatorState.sourceState : "coverage developing",
        points: values.length,
      };
      if (!values.length) return;
      const lineSeries = chart.addSeries(api.LineSeries, {
        color: indicator.color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        title: indicator.label,
        priceFormat: {
          type: "custom",
          formatter: priceFormatter,
        },
      });
      lineSeries.setData(values);
    });
    if (typeof window !== "undefined") window.__RAVENOS_LAST_INDICATOR_STATE__ = indicatorState;

    function visibleOverlays(type) {
      return enrichedOverlays.filter((overlay) => {
        const key = overlayKey(overlay);
        return activeTypes.has(key) && (!type || overlay.type === type);
      });
    }

    visibleOverlays("breadth-line").forEach((overlay) => {
      const values = normalizeOverlayValues(overlay);
      if (!values.length) return;
      const lineSeries = chart.addSeries(api.LineSeries, {
        color: colorFor(overlay),
        lineWidth: 2,
        priceScaleId: `overlay-${overlay.id || overlay.label}`,
        priceLineVisible: false,
        lastValueVisible: false,
        title: "",
      });
      lineSeries.setData(values);
      chart.priceScale(`overlay-${overlay.id || overlay.label}`).applyOptions({
        scaleMargins: { top: 0.08, bottom: options?.showVolume === false ? 0.12 : 0.74 },
        borderVisible: false,
      });
    });

    const markers = events.filter((event) => event && event.time).map(markerFor).concat(
      visibleOverlays()
        .filter((overlay) => OVERLAY_RENDERER_REGISTRY[overlay.type]?.renderAs === "marker")
        .filter((overlay) => overlay.time || overlay.startTime)
        .map(overlayMarker),
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
          axisLabelVisible: false,
          title: "",
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
    regionLayer.style.inset = "0";
    regionLayer.style.pointerEvents = "none";
    regionLayer.style.zIndex = "3";
    chartHost.appendChild(regionLayer);
    const tooltip = createTooltip(chartHost);

    function renderRegions() {
      regionLayer.innerHTML = "";
      const width = chartHost.clientWidth || container.clientWidth;
      const height = options?.height || 520;
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
          }, options?.onOverlaySelect);
          return;
        }

        if (renderAs === "time-region") {
          createRegion(regionLayer, tooltip, chartHost, overlay, {
            left,
            top: height * 0.08,
            width: right - left,
            height: height * 0.78,
          }, options?.onOverlaySelect);
        }
      });
    }

    function redrawLegend() {
      createLegend(container, enrichedOverlays, activeTypes, (type, selectedOverlay) => {
        if (activeTypes.has(type)) activeTypes.delete(type);
        else activeTypes.add(type);
        options?.onOverlaySelect?.(activeTypes.has(type) ? selectedOverlay : null);
        apiRef.destroy();
        const next = RavenPriceChart(container, {
          ...options,
          visibleOverlayTypes: Array.from(activeTypes),
        });
        if (next) Object.assign(apiRef, next);
      }, () => {
        activeTypes.clear();
        options?.onOverlaySelect?.(null);
        apiRef.destroy();
        const next = RavenPriceChart(container, {
          ...options,
          visibleOverlayTypes: [],
        });
        if (next) Object.assign(apiRef, next);
      });
    }

    chart.timeScale().fitContent();
    renderRegions();
    if (options?.showOverlayLegend !== false) redrawLegend();
    chart.timeScale().subscribeVisibleTimeRangeChange(renderRegions);
    const logicalRangeHandler = (range) => {
      options?.onVisibleLogicalRangeChange?.(range);
    };
    if (typeof chart.timeScale().subscribeVisibleLogicalRangeChange === "function") {
      chart.timeScale().subscribeVisibleLogicalRangeChange(logicalRangeHandler);
    }
    const crosshairHandler = (param) => {
      if (typeof options?.onCrosshairMove !== "function") return;
      const row = param?.seriesData?.get?.(candleSeries);
      if (!param?.time || !row) {
        options.onCrosshairMove(null);
        return;
      }
      options.onCrosshairMove({
        time: param.time,
        open: Number.isFinite(Number(row.open)) ? Number(row.open) : null,
        high: Number.isFinite(Number(row.high)) ? Number(row.high) : null,
        low: Number.isFinite(Number(row.low)) ? Number(row.low) : null,
        close: Number.isFinite(Number(row.close ?? row.value)) ? Number(row.close ?? row.value) : null,
        volume: Number.isFinite(Number(volumeByTime.get(String(param.time)))) ? Number(volumeByTime.get(String(param.time))) : null,
        point: param.point || null,
      });
    };
    if (typeof chart.subscribeCrosshairMove === "function") chart.subscribeCrosshairMove(crosshairHandler);
    const resizeObserver = new ResizeObserver(() => {
      const width = chartHost.clientWidth || container.clientWidth;
      const height = container.clientHeight || chartHost.clientHeight || options?.height || 520;
      if (chartHost.clientHeight !== height) chartHost.style.height = `${height}px`;
      chart.applyOptions({ width, height });
      renderRegions();
    });
    resizeObserver.observe(chartHost);
    resizeObserver.observe(container);

    const apiRef = {
      chart,
      updateCandle(value) {
        const normalized = normalizeCandles([value])[0];
        if (!normalized) return false;
        const existingIndex = candles.findIndex((row) => Number(row.time) === Number(normalized.time));
        if (existingIndex >= 0) {
          candles[existingIndex] = normalized;
          rawCandles[existingIndex] = { ...value };
        } else {
          candles.push(normalized);
          rawCandles.push({ ...value });
        }
        candleSeries.update(normalized);
        const volume = normalizeVolume([value])[0];
        if (volume) volumeByTime.set(String(volume.time), volume.value);
        if (volumeSeries && volume) volumeSeries.update(volume);
        renderRegions();
        return true;
      },
      prependCandles(values) {
        const incomingRaw = Array.isArray(values) ? values : [];
        const incoming = normalizeCandles(incomingRaw);
        if (!incoming.length) return 0;
        const visible = chart.timeScale().getVisibleRange?.() || null;
        const byTime = new Map();
        [...incomingRaw, ...rawCandles].forEach((row) => {
          const normalized = normalizeCandles([row])[0];
          if (normalized) byTime.set(String(normalized.time), { raw: row, normalized });
        });
        const merged = [...byTime.values()].sort((left, right) => Number(left.normalized.time) - Number(right.normalized.time));
        rawCandles = merged.map((row) => row.raw);
        candles = merged.map((row) => row.normalized);
        volumeByTime = new Map(normalizeVolume(rawCandles).map((row) => [String(row.time), row.value]));
        candleSeries.setData(candles);
        if (volumeSeries) volumeSeries.setData(normalizeVolume(rawCandles));
        if (visible && typeof chart.timeScale().setVisibleRange === "function") chart.timeScale().setVisibleRange(visible);
        renderRegions();
        return incoming.length;
      },
      scrollToRealTime() {
        chart.timeScale().scrollToRealTime?.();
      },
      visibleLogicalRange() {
        return chart.timeScale().getVisibleLogicalRange?.() || null;
      },
      visibleTimeRange() {
        return chart.timeScale().getVisibleRange?.() || null;
      },
      measure() {
        const logicalRange = chart.timeScale().getVisibleLogicalRange?.() || null;
        const timeRange = chart.timeScale().getVisibleRange?.() || null;
        const visibleBars = timeRange
          ? candles.filter((row) => Number(row.time) >= Number(timeRange.from) && Number(row.time) <= Number(timeRange.to)).length
          : 0;
        const plotHeight = Math.max(1, chartHost.clientHeight - 28);
        const topPrice = candleSeries.coordinateToPrice?.(0);
        const bottomPrice = candleSeries.coordinateToPrice?.(plotHeight);
        const rect = chartHost.getBoundingClientRect();
        return {
          loaded_bars: candles.length,
          visible_bars: visibleBars,
          logical_range: logicalRange,
          time_range: timeRange,
          price_range: Number.isFinite(Number(topPrice)) && Number.isFinite(Number(bottomPrice))
            ? { min: Math.min(Number(topPrice), Number(bottomPrice)), max: Math.max(Number(topPrice), Number(bottomPrice)) }
            : null,
          width: rect.width,
          height: rect.height,
          canvas_count: chartHost.querySelectorAll("canvas").length,
          marker_count: markers.length,
        };
      },
      resize() {
        const height = container.clientHeight || chartHost.clientHeight || options?.height || 520;
        chartHost.style.height = `${height}px`;
        chart.applyOptions({
          width: chartHost.clientWidth || container.clientWidth,
          height,
        });
        renderRegions();
      },
      destroy() {
        chart.timeScale().unsubscribeVisibleTimeRangeChange(renderRegions);
        if (typeof chart.timeScale().unsubscribeVisibleLogicalRangeChange === "function") {
          chart.timeScale().unsubscribeVisibleLogicalRangeChange(logicalRangeHandler);
        }
        if (typeof chart.unsubscribeCrosshairMove === "function") chart.unsubscribeCrosshairMove(crosshairHandler);
        resizeObserver.disconnect();
        chart.remove();
      },
    };
    return apiRef;
  }

  window.RavenChartOverlayRenderers = OVERLAY_RENDERER_REGISTRY;
  window.RavenPriceChart = RavenPriceChart;
})();
