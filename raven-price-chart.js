(function () {
  const SEVERITY_COLOR = {
    info: "#7dd3fc",
    warning: "#facc15",
    danger: "#fb7185",
    success: "#34d399",
  };

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

  function markerFor(event) {
    const above = event.type === "liquidity-warning" || event.type === "toxicity-risk" || event.type === "smart-wallet-distribution";
    return {
      time: event.time,
      position: above ? "aboveBar" : "belowBar",
      color: SEVERITY_COLOR[event.severity] || SEVERITY_COLOR.info,
      shape: event.type === "opportunity-marker" ? "circle" : above ? "arrowDown" : "arrowUp",
      text: event.label,
    };
  }

  function overlayMarker(overlay) {
    const above = overlay.type === "pressure-zone" || overlay.type === "regime-marker";
    return {
      time: overlay.time || overlay.startTime,
      position: above ? "aboveBar" : "belowBar",
      color: SEVERITY_COLOR[overlay.severity] || SEVERITY_COLOR.info,
      shape: overlay.type === "participant-shift" ? "circle" : above ? "arrowDown" : "arrowUp",
      text: overlay.label,
    };
  }

  function normalizeOverlayValues(overlay) {
    return (Array.isArray(overlay?.values) ? overlay.values : [])
      .filter((point) => point && point.time && Number.isFinite(Number(point.value)))
      .map((point) => ({ time: point.time, value: Number(point.value) }));
  }

  function overlayTitle(overlay, side) {
    return `${overlay.label} ${side === "min" ? "low" : "high"}`;
  }

  function priceLineTitle(event) {
    if (event.type === "entry-zone") return `Entry zone: ${event.label}`;
    if (event.type === "exit-zone") return `Exit zone: ${event.label}`;
    if (event.type === "toxicity-risk") return `Risk marker: ${event.label}`;
    if (event.type === "liquidity-warning") return `Liquidity marker: ${event.label}`;
    return event.label;
  }

  function setState(container, message, className) {
    container.innerHTML = `<div class="chart-state ${className || ""}">${message}</div>`;
  }

  function RavenPriceChart(container, options) {
    if (!container) return null;
    const api = window.LightweightCharts;
    const candles = normalizeCandles(options?.candles);
    const events = Array.isArray(options?.events) ? options.events : [];
    const overlays = Array.isArray(options?.overlays) ? options.overlays : [];

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
        timeVisible: true,
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

    overlays
      .filter((overlay) => overlay && overlay.type === "breadth-line")
      .forEach((overlay) => {
        const values = normalizeOverlayValues(overlay);
        if (!values.length) return;
        const lineSeries = chart.addSeries(api.LineSeries, {
          color: SEVERITY_COLOR[overlay.severity] || SEVERITY_COLOR.info,
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

    const markers = events.filter((event) => event && event.time).map(markerFor).concat(
      overlays
        .filter((overlay) => overlay && (overlay.type === "regime-marker" || overlay.type === "participant-shift"))
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
          color: SEVERITY_COLOR[event.severity] || SEVERITY_COLOR.info,
          lineWidth: 1,
          lineStyle: api.LineStyle?.Dashed || 2,
          axisLabelVisible: true,
          title: priceLineTitle(event),
        });
      });

    overlays
      .filter((overlay) => overlay && (Number.isFinite(Number(overlay.priceMin)) || Number.isFinite(Number(overlay.priceMax))))
      .forEach((overlay) => {
        if (Number.isFinite(Number(overlay.priceMin))) {
          candleSeries.createPriceLine({
            price: Number(overlay.priceMin),
            color: SEVERITY_COLOR[overlay.severity] || SEVERITY_COLOR.info,
            lineWidth: 1,
            lineStyle: api.LineStyle?.Dotted || 1,
            axisLabelVisible: false,
            title: overlayTitle(overlay, "min"),
          });
        }
        if (Number.isFinite(Number(overlay.priceMax))) {
          candleSeries.createPriceLine({
            price: Number(overlay.priceMax),
            color: SEVERITY_COLOR[overlay.severity] || SEVERITY_COLOR.info,
            lineWidth: 1,
            lineStyle: api.LineStyle?.Dotted || 1,
            axisLabelVisible: true,
            title: overlayTitle(overlay, "max"),
          });
        }
      });

    const bandLayer = document.createElement("div");
    bandLayer.className = "raven-overlay-bands";
    bandLayer.style.position = "absolute";
    bandLayer.style.inset = "0";
    bandLayer.style.pointerEvents = "none";
    chartHost.appendChild(bandLayer);

    function renderBands() {
      bandLayer.innerHTML = "";
      overlays
        .filter((overlay) => overlay && overlay.startTime && overlay.endTime)
        .filter((overlay) => overlay.type === "history-window" || overlay.type === "compression-band" || overlay.type === "pressure-zone")
        .forEach((overlay) => {
          const start = chart.timeScale().timeToCoordinate(overlay.startTime);
          const end = chart.timeScale().timeToCoordinate(overlay.endTime);
          if (start === null || end === null || start === undefined || end === undefined) return;
          const color = SEVERITY_COLOR[overlay.severity] || SEVERITY_COLOR.info;
          const band = document.createElement("div");
          band.title = `${overlay.label}: ${overlay.summary || ""}`;
          band.style.position = "absolute";
          band.style.left = `${Math.max(0, Math.min(start, end))}px`;
          band.style.width = `${Math.max(4, Math.abs(end - start))}px`;
          band.style.top = overlay.type === "history-window" ? "8%" : overlay.type === "compression-band" ? "48%" : "18%";
          band.style.height = overlay.type === "history-window" ? "80%" : "24%";
          band.style.border = `1px solid ${color}55`;
          band.style.background = `${color}18`;
          band.style.boxShadow = `inset 0 0 0 1px ${color}12`;
          bandLayer.appendChild(band);
        });
    }

    chart.timeScale().fitContent();
    renderBands();
    chart.timeScale().subscribeVisibleTimeRangeChange(renderBands);
    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ width: chartHost.clientWidth || container.clientWidth });
      renderBands();
    });
    resizeObserver.observe(chartHost);

    return {
      chart,
      destroy() {
        chart.timeScale().unsubscribeVisibleTimeRangeChange(renderBands);
        resizeObserver.disconnect();
        chart.remove();
      },
    };
  }

  window.RavenPriceChart = RavenPriceChart;
})();
