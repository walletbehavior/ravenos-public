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
      shape: event.type === "promotion-candidate" ? "circle" : above ? "arrowDown" : "arrowUp",
      text: event.label,
    };
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
    const chart = api.createChart(container, {
      height: options?.height || 520,
      width: container.clientWidth,
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

    const markers = events.filter((event) => event && event.time).map(markerFor);
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

    chart.timeScale().fitContent();
    const resizeObserver = new ResizeObserver(() => chart.applyOptions({ width: container.clientWidth }));
    resizeObserver.observe(container);

    return {
      chart,
      destroy() {
        resizeObserver.disconnect();
        chart.remove();
      },
    };
  }

  window.RavenPriceChart = RavenPriceChart;
})();
