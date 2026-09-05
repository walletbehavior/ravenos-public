(function () {
  const SEVERITY_COLOR = {
    info: "#8da6b8",
    warning: "#c4a05c",
    danger: "#d96070",
    success: "#3fa675",
  };

  const OVERLAY_META = {
    structure: { label: "Structure", color: "#8da6b8" },
    pressure: { label: "Pressure", color: "#c47a72" },
    participation: { label: "Participation", color: "#68a585" },
    replay: { label: "History", color: "#998bad" },
    risk: { label: "Risk", color: "#c4a05c" },
    "pressure-zone": { label: "Pressure", color: "#c47a72" },
    "history-window": { label: "History", color: "#998bad" },
    "breadth-line": { label: "Participation", color: "#68a585" },
    "compression-band": { label: "Structure", color: "#8da6b8" },
    "regime-marker": { label: "Risk", color: "#c4a05c" },
    "liquidity-zone": { label: "Risk", color: "#c4a05c" },
    "participant-shift": { label: "Participation", color: "#68a585" },
    "technical-macd": { label: "MACD crosses", color: "#77a7c4" },
    "technical-accumulation": { label: "Accumulation", color: "#5cad88" },
    "technical-fibonacci": { label: "Fibonacci", color: "#b5965c" },
    "technical-macd-crossover": { label: "MACD crosses", color: "#77a7c4" },
    "technical-accumulation-zone": { label: "Accumulation", color: "#5cad88" },
    "technical-fibonacci-level": { label: "Fibonacci", color: "#b5965c" },
    "plan-entry": { label: "Entry reference", color: "#8da6b8" },
    "plan-target": { label: "Favorable reference", color: "#3fa675" },
    "plan-risk": { label: "Adverse reference", color: "#d96070" },
  };

  const OVERLAY_RENDERER_REGISTRY = {
    "pressure-zone": { renderAs: "price-region" },
    "history-window": { renderAs: "time-region" },
    "breadth-line": { renderAs: "line" },
    "compression-band": { renderAs: "price-region" },
    "regime-marker": { renderAs: "marker" },
    "liquidity-zone": { renderAs: "price-region" },
    "participant-shift": { renderAs: "marker" },
    "technical-macd-crossover": { renderAs: "marker" },
    "technical-accumulation-zone": { renderAs: "price-region" },
    "technical-fibonacci-level": { renderAs: "line" },
    "plan-entry": { renderAs: "price-region" },
    "plan-target": { renderAs: "price-region" },
    "plan-risk": { renderAs: "price-region" },
  };

  const RAVEN_OVERLAY_GROUPS = ["Raven", "TA", "Actors", "Liquidity", "Structure", "Risk", "Trade path"];
  const RAVEN_OVERLAY_LIBRARY = [
    { id: "pressure", label: "Pressure", group: "Raven", keys: ["pressure", "pressure-zone"] },
    { id: "technical-macd", label: "MACD crosses", group: "TA", keys: ["technical-macd"] },
    { id: "technical-accumulation", label: "Accumulation", group: "TA", keys: ["technical-accumulation"] },
    { id: "technical-fibonacci", label: "Fibonacci", group: "TA", keys: ["technical-fibonacci"] },
    { id: "liquidity", label: "Book liquidity", group: "Liquidity", keys: ["liquidity-zone"] },
    { id: "structure", label: "Structure", group: "Structure", keys: ["structure"] },
    { id: "compression", label: "Compression", group: "Structure", keys: ["compression-band"] },
    { id: "participants", label: "Participants", group: "Actors", keys: ["participation", "participant-shift", "breadth-line"] },
    { id: "similar-history", label: "Similar history", group: "Raven", keys: ["replay", "history-window"] },
    { id: "risk", label: "Risk", group: "Risk", keys: ["risk", "regime-marker"] },
    { id: "plan-entry", label: "Entry reference", group: "Trade path", keys: ["plan-entry"] },
    { id: "plan-target", label: "Favorable reference", group: "Trade path", keys: ["plan-target"] },
    { id: "plan-risk", label: "Adverse reference", group: "Trade path", keys: ["plan-risk"] },
  ];

  function overlayType(type) {
    return String(type || "regime-marker").replace(/_/g, "-");
  }

  function overlayKey(overlay) {
    return overlay?.metadata?.overlay_key || overlay?.raven_read?.overlay_key || overlay?.raven_read?.mode || overlayType(overlay?.type);
  }

  function colorFor(item) {
    const key = overlayKey(item);
    return OVERLAY_META[key]?.color || (item?.raven_read?.mode ? OVERLAY_META[item.raven_read.mode]?.color : null) || SEVERITY_COLOR[item?.severity] || OVERLAY_META[overlayType(item?.type)]?.color || SEVERITY_COLOR.info;
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
        color: Number(candle.close) >= Number(candle.open) ? "rgba(63, 166, 117, 0.3)" : "rgba(207, 89, 104, 0.26)",
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

  function bollingerSeries(candles, period = 20, deviations = 2) {
    if (!Number.isFinite(period) || period < 2 || candles.length < period) {
      return { upper: [], middle: [], lower: [] };
    }
    const upper = [];
    const middle = [];
    const lower = [];
    const window = [];
    let sum = 0;
    let sumSquares = 0;
    candles.forEach((candle) => {
      const close = Number(candle.close);
      if (!Number.isFinite(close)) return;
      window.push(close);
      sum += close;
      sumSquares += close * close;
      if (window.length > period) {
        const removed = window.shift();
        sum -= removed;
        sumSquares -= removed * removed;
      }
      if (window.length !== period) return;
      const mean = sum / period;
      const variance = Math.max(0, (sumSquares / period) - (mean * mean));
      const width = Math.sqrt(variance) * deviations;
      middle.push({ time: candle.time, value: mean });
      upper.push({ time: candle.time, value: mean + width });
      lower.push({ time: candle.time, value: mean - width });
    });
    return { upper, middle, lower };
  }

  function rsiSeries(candles, period = 14) {
    if (!Number.isFinite(period) || period < 2 || candles.length <= period) return [];
    const output = [];
    let averageGain = 0;
    let averageLoss = 0;
    for (let index = 1; index < candles.length; index += 1) {
      const prior = Number(candles[index - 1]?.close);
      const close = Number(candles[index]?.close);
      if (!Number.isFinite(prior) || !Number.isFinite(close)) continue;
      const change = close - prior;
      const gain = Math.max(0, change);
      const loss = Math.max(0, -change);
      if (index <= period) {
        averageGain += gain;
        averageLoss += loss;
        if (index < period) continue;
        averageGain /= period;
        averageLoss /= period;
      } else {
        averageGain = ((averageGain * (period - 1)) + gain) / period;
        averageLoss = ((averageLoss * (period - 1)) + loss) / period;
      }
      const value = averageLoss === 0 ? 100 : 100 - (100 / (1 + (averageGain / averageLoss)));
      output.push({ time: candles[index].time, value });
    }
    return output;
  }

  function macdSeries(candles, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    const fast = new Map(emaSeries(candles, fastPeriod).map((row) => [String(row.time), row.value]));
    const slow = new Map(emaSeries(candles, slowPeriod).map((row) => [String(row.time), row.value]));
    const macd = [];
    candles.forEach((candle) => {
      const fastValue = fast.get(String(candle.time));
      const slowValue = slow.get(String(candle.time));
      if (!Number.isFinite(fastValue) || !Number.isFinite(slowValue)) return;
      macd.push({ time: candle.time, value: fastValue - slowValue });
    });
    const signal = emaSeries(macd.map((row) => ({ ...row, close: row.value })), signalPeriod);
    const signalByTime = new Map(signal.map((row) => [String(row.time), row.value]));
    const histogram = macd
      .filter((row) => Number.isFinite(signalByTime.get(String(row.time))))
      .map((row) => {
        const value = row.value - signalByTime.get(String(row.time));
        return {
          time: row.time,
          value,
          color: value >= 0 ? "rgba(63, 166, 117, .48)" : "rgba(207, 89, 104, .44)",
        };
      });
    return { macd, signal, histogram };
  }

  function markerFor(event, index = 0) {
    const migration = event.type === "token-migration";
    const above = migration || event.type === "liquidity-warning" || event.type === "toxicity-risk";
    const markerText = String(event.marker_text || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 2);
    return {
      id: `raven-event:${String(event.event_id || event.id || `${event.type || "event"}-${event.time}-${index}`).slice(0, 180)}`,
      time: event.time,
      position: above ? "aboveBar" : "belowBar",
      color: colorFor(event),
      shape: migration ? "square" : event.type === "opportunity-marker" ? "circle" : above ? "arrowDown" : "arrowUp",
      text: markerText,
    };
  }

  function overlayMarker(overlay, index = 0) {
    const type = overlayType(overlay.type);
    const above = type === "pressure-zone" || type === "regime-marker" || type === "distribution-risk";
    return {
      id: `raven-overlay:${String(overlay.id || `${type}-${overlay.time || overlay.startTime}-${index}`).slice(0, 180)}`,
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

  function cleanAssetSymbol(value) {
    if (value && typeof value === "object") return String(value.symbol || value.code || "").trim().toUpperCase();
    return String(value || "").trim().toUpperCase();
  }

  function decimalPlaces(value) {
    const raw = String(value);
    if (/e-/i.test(raw)) {
      const exponent = Number(raw.split(/e-/i)[1]);
      return Number.isFinite(exponent) ? exponent : 0;
    }
    return (raw.split(".")[1] || "").replace(/0+$/, "").length;
  }

  function priceScaleContract(options = {}, values = [], { series = false } = {}) {
    const instrument = options.instrument && typeof options.instrument === "object" ? options.instrument : {};
    const instrumentType = String(
      options.instrumentType
      || instrument.instrument_type
      || instrument.asset_class
      || "",
    ).trim().toLowerCase();
    const quoteAsset = cleanAssetSymbol(
      options.quoteAsset
      || instrument.quote_asset
      || instrument.settlement_asset
      || instrument.currency
      || (series ? "" : "USD"),
    ) || (series ? "" : "USD");
    const explicitPrecisionValue = options.pricePrecision
      ?? instrument.price_precision
      ?? instrument.pricePrecision;
    const explicitPrecision = explicitPrecisionValue === null
      || explicitPrecisionValue === undefined
      || String(explicitPrecisionValue).trim() === ""
      ? Number.NaN
      : Number(explicitPrecisionValue);
    const finiteValues = values.map(Number).filter(Number.isFinite);
    const nonZero = finiteValues.map(Math.abs).filter((value) => value > 0);
    const smallest = nonZero.length ? Math.min(...nonZero) : 1;
    let precision;
    if (Number.isInteger(explicitPrecision) && explicitPrecision >= 0) {
      precision = explicitPrecision;
    } else if (["equity", "etf", "index", "option", "future", "future_contract"].includes(instrumentType)) {
      precision = 2;
    } else if (instrumentType === "forex_pair" || instrumentType === "forex" || instrumentType === "fx") {
      precision = /JPY$/.test(String(instrument.symbol || instrument.canonical_symbol || "")) ? 3 : 5;
    } else if (series) {
      precision = Math.max(0, ...finiteValues.slice(-160).map(decimalPlaces));
      precision = Math.min(6, precision);
    } else if (smallest >= 100) {
      precision = 2;
    } else if (smallest >= 1) {
      precision = 4;
    } else {
      precision = Math.min(14, Math.max(4, Math.ceil(-Math.log10(smallest)) + 2));
    }
    precision = Math.min(14, Math.max(0, precision));
    const minMove = 10 ** -precision;
    const usesDollar = ["USD", "USDC", "USDT", "BUSD", "FDUSD"].includes(quoteAsset);
    const formatter = (value) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return "—";
      const formatted = numeric.toLocaleString("en-US", {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
      });
      return usesDollar ? `$${formatted}` : formatted;
    };
    return Object.freeze({
      side: "right",
      visible: true,
      auto_scale: "visible_range",
      precision,
      min_move: minMove,
      quote_asset: quoteAsset,
      instrument_type: instrumentType || (series ? "reference_series" : "market"),
      formatter,
    });
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
    tooltip.replaceChildren();
    const read = overlay.raven_read;
    if (read) {
      const modeLabel = OVERLAY_META[read.mode]?.label || read.mode || "Raven";
      const shortLabel = String(read.short_label || read.title || "context").replace(/\s+/g, " ");
      const status = [read.status, read.confidence].filter(Boolean).join(" · ") || "forming";
      const mode = document.createElement("span");
      mode.textContent = modeLabel;
      Object.assign(mode.style, { display: "block", color: "#8f9db2", fontSize: "10px", fontWeight: "850", textTransform: "uppercase", marginBottom: "3px" });
      const title = document.createElement("strong");
      title.textContent = shortLabel;
      Object.assign(title.style, { display: "block", color: colorFor(overlay), marginBottom: "4px" });
      const state = document.createElement("span");
      state.textContent = status;
      Object.assign(state.style, { display: "block", color: "#b6c2d2" });
      tooltip.append(mode, title, state);
    } else {
      const title = overlay.label || OVERLAY_META[overlayType(overlay.type)]?.label || "Overlay";
      const titleNode = document.createElement("strong");
      titleNode.textContent = title;
      Object.assign(titleNode.style, { display: "block", color: colorFor(overlay), marginBottom: "4px" });
      const summary = document.createElement("span");
      summary.textContent = overlay.summary || "";
      tooltip.append(titleNode, summary);
      if (Number.isFinite(Number(overlay.value))) {
        const score = document.createElement("div");
        score.textContent = `Score ${Math.round(Number(overlay.value))}`;
        Object.assign(score.style, { color: "#8f9db2", marginTop: "4px" });
        tooltip.append(score);
      }
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
      const meta = OVERLAY_META[matchedKey] || { color: "#8da6b8" };
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
      const meta = OVERLAY_META[type] || { color: "#8da6b8" };
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
    let quoteVolumeByTime = new Map(rawCandles
      .filter((row) => row?.time && Number.isFinite(Number(row.quote_volume ?? row.quoteVolume)))
      .map((row) => [String(row.time), Number(row.quote_volume ?? row.quoteVolume)]));
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
      if (String(overlay.type || "").startsWith("plan-")) return overlay;
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
    const availableOverlayKeys = new Set(enrichedOverlays.map(overlayKey));
    const activeTypes = new Set((Array.isArray(options?.visibleOverlayTypes) ? options.visibleOverlayTypes : [])
      .filter((type) => availableOverlayKeys.has(type)));
    const scaleContract = priceScaleContract(options, candles.flatMap((row) => [row.open, row.high, row.low, row.close]));
    const priceFormatter = typeof options?.priceFormatter === "function" ? options.priceFormatter : scaleContract.formatter;

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
        background: { color: "#080a0d" },
        textColor: "#929daa",
        attributionLogo: false,
        panes: {
          separatorColor: "rgba(148, 163, 184, .18)",
          separatorHoverColor: "rgba(148, 163, 184, .3)",
          enableResize: true,
        },
      },
      grid: {
        vertLines: { color: "rgba(183, 194, 208, 0.05)" },
        horzLines: { color: "rgba(183, 194, 208, 0.05)" },
      },
      defaultVisiblePriceScaleId: "right",
      leftPriceScale: { visible: false },
      rightPriceScale: {
        visible: true,
        autoScale: true,
        alignLabels: true,
        ticksVisible: true,
        borderVisible: true,
        borderColor: "rgba(148, 163, 184, 0.18)",
        scaleMargins: {
          top: 0.08,
          bottom: options?.showVolume === false ? 0.08 : options?.compact ? 0.18 : 0.2,
        },
      },
      timeScale: {
        borderColor: "rgba(148, 163, 184, 0.18)",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: { mode: 0 },
      trackingMode: {
        // Mobile inspection is deliberate: hold to inspect, drag across exact
        // candles, and clear the temporary candle card when the finger lifts.
        exitMode: api.TrackingModeExitMode?.OnTouchEnd ?? 0,
      },
      localization: {
        priceFormatter,
      },
    });

    const candleSeries = chart.addSeries(api.CandlestickSeries, {
      upColor: "#3fa675",
      downColor: "#cf5968",
      borderUpColor: "#3fa675",
      borderDownColor: "#cf5968",
      wickUpColor: "#75b996",
      wickDownColor: "#d8848e",
      priceScaleId: "right",
      lastValueVisible: true,
      priceLineVisible: true,
      priceFormat: {
        type: "custom",
        formatter: priceFormatter,
        minMove: scaleContract.min_move,
      },
    });
    candleSeries.setData(candles);
    chart.priceScale("right").applyOptions({ visible: true, autoScale: true });
    if (typeof window !== "undefined") window.__RAVENOS_LAST_PRICE_SCALE__ = scaleContract;

    let volumeSeries = null;
    if (options?.showVolume !== false) {
      volumeSeries = chart.addSeries(api.HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
        lastValueVisible: false,
        priceLineVisible: false,
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
      bb20: { status: "off", points: 0 },
      rsi14: { status: "off", points: 0 },
      macd: { status: "off", points: 0 },
    };
    const activeIndicators = new Set(Array.isArray(options?.indicators) ? options.indicators : []);
    const indicatorRefreshers = [];
    let nextIndicatorPane = 1;
    let macdPaneIndex = null;
    let macdReadout = null;
    let macdValuesByTime = new Map();
    let inspectedIndicatorTime = null;

    function priceLine(color, { paneIndex = 0, lineWidth = 2, priceScaleId = "right", formatter = priceFormatter } = {}) {
      return chart.addSeries(api.LineSeries, {
        color,
        lineWidth,
        priceScaleId,
        priceLineVisible: false,
        // Indicator names and values belong in the controls and upper-left
        // candle inspector, not beside the live candle on the price edge.
        lastValueVisible: false,
        title: "",
        priceFormat: {
          type: "custom",
          formatter,
          minMove: priceScaleId === "right" ? scaleContract.min_move : 0.01,
        },
      }, paneIndex);
    }

    function unavailableIndicator(key) {
      indicatorState[key] = {
        status: indicatorState.sourceState === "structure_proxy" ? "unavailable on this limited chart" : "coverage developing",
        points: 0,
      };
    }

    function registerLineIndicator({ key, color, values }) {
      if (!activeIndicators.has(key)) return;
      if (indicatorState.sourceState !== "provider_backed") {
        unavailableIndicator(key);
        return;
      }
      const series = priceLine(color);
      indicatorRefreshers.push({
        key,
        refresh() {
          const rows = values();
          series.setData(rows);
          return rows.length;
        },
      });
    }

    registerLineIndicator({ key: "ema20", color: "#8da6b8", values: () => emaSeries(candles, 20) });
    registerLineIndicator({ key: "ema50", color: "#998bad", values: () => emaSeries(candles, 50) });
    registerLineIndicator({ key: "vwap", color: "#b5965c", values: () => vwapSeries(rawCandles) });

    if (activeIndicators.has("bb20")) {
      if (indicatorState.sourceState !== "provider_backed") unavailableIndicator("bb20");
      else {
        const upper = priceLine("rgba(116, 145, 168, .72)", { lineWidth: 1 });
        const middle = priceLine("rgba(141, 166, 184, .88)", { lineWidth: 1 });
        const lower = priceLine("rgba(116, 145, 168, .72)", { lineWidth: 1 });
        indicatorRefreshers.push({
          key: "bb20",
          refresh() {
            const rows = bollingerSeries(candles, 20, 2);
            upper.setData(rows.upper);
            middle.setData(rows.middle);
            lower.setData(rows.lower);
            return rows.middle.length;
          },
        });
      }
    }

    if (activeIndicators.has("rsi14")) {
      if (indicatorState.sourceState !== "provider_backed") unavailableIndicator("rsi14");
      else {
        const paneIndex = nextIndicatorPane++;
        const rsi = priceLine("#7e9fb7", {
          paneIndex,
          priceScaleId: "rsi",
          formatter: (value) => Number(value).toFixed(1),
        });
        const overbought = priceLine("rgba(207, 89, 104, .38)", {
          paneIndex,
          priceScaleId: "rsi",
          lineWidth: 1,
          formatter: (value) => Number(value).toFixed(1),
        });
        const oversold = priceLine("rgba(63, 166, 117, .34)", {
          paneIndex,
          priceScaleId: "rsi",
          lineWidth: 1,
          formatter: (value) => Number(value).toFixed(1),
        });
        chart.priceScale("rsi", paneIndex).applyOptions({ visible: true, autoScale: true, borderVisible: true });
        indicatorRefreshers.push({
          key: "rsi14",
          refresh() {
            const rows = rsiSeries(candles, 14);
            rsi.setData(rows);
            const bounds = rows.length ? [rows[0], rows.at(-1)] : [];
            overbought.setData(bounds.map((row) => ({ time: row.time, value: 70 })));
            oversold.setData(bounds.map((row) => ({ time: row.time, value: 30 })));
            return rows.length;
          },
        });
      }
    }

    if (activeIndicators.has("macd")) {
      if (indicatorState.sourceState !== "provider_backed") unavailableIndicator("macd");
      else {
        const paneIndex = nextIndicatorPane++;
        macdPaneIndex = paneIndex;
        const macd = priceLine("#8da6b8", { paneIndex, priceScaleId: "macd", formatter: priceFormatter });
        const signal = priceLine("#b5965c", { paneIndex, priceScaleId: "macd", lineWidth: 1, formatter: priceFormatter });
        const histogram = chart.addSeries(api.HistogramSeries, {
          priceScaleId: "macd",
          priceFormat: { type: "custom", formatter: priceFormatter, minMove: scaleContract.min_move },
          priceLineVisible: false,
          lastValueVisible: false,
        }, paneIndex);
        chart.priceScale("macd", paneIndex).applyOptions({ visible: true, autoScale: true, borderVisible: true });
        indicatorRefreshers.push({
          key: "macd",
          refresh() {
            const rows = macdSeries(candles);
            const signalByTime = new Map(rows.signal.map((row) => [String(row.time), row.value]));
            const histogramByTime = new Map(rows.histogram.map((row) => [String(row.time), row.value]));
            macdValuesByTime = new Map(rows.macd.map((row) => [String(row.time), {
              macd: row.value,
              signal: signalByTime.get(String(row.time)) ?? null,
              histogram: histogramByTime.get(String(row.time)) ?? null,
            }]));
            macd.setData(rows.macd);
            signal.setData(rows.signal);
            histogram.setData(rows.histogram);
            return rows.signal.length;
          },
        });
      }
    }

    function refreshIndicators() {
      indicatorRefreshers.forEach(({ key, refresh }) => {
        const points = refresh();
        indicatorState[key] = {
          status: points ? indicatorState.sourceState : "coverage developing",
          points,
        };
      });
      paintMacdReadout(inspectedIndicatorTime);
      if (typeof window !== "undefined") window.__RAVENOS_LAST_INDICATOR_STATE__ = indicatorState;
    }

    function signedIndicatorValue(value) {
      if (value === null || value === undefined || value === "") return "—";
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return "—";
      const formatted = priceFormatter(Math.abs(parsed));
      return `${parsed > 0 ? "+" : parsed < 0 ? "−" : ""}${formatted}`;
    }

    function positionMacdReadout() {
      if (!macdReadout || macdPaneIndex === null) return;
      const paneList = typeof chart.panes === "function" ? chart.panes() : [];
      const measuredTop = paneList.slice(0, macdPaneIndex)
        .reduce((sum, pane) => sum + Math.max(0, Number(pane?.getHeight?.()) || 0), 0);
      const paneCount = Math.max(1, nextIndicatorPane - 1);
      const fallbackTop = (chartHost.clientHeight || chartHeight) * ((3 + Math.max(0, macdPaneIndex - 1)) / (3 + paneCount));
      macdReadout.style.top = `${Math.round((measuredTop || fallbackTop) + 5)}px`;
    }

    function paintMacdReadout(time = null) {
      if (!macdReadout) return;
      const selectedKey = time === null || time === undefined
        ? Array.from(macdValuesByTime.keys()).at(-1)
        : String(time);
      const values = selectedKey ? macdValuesByTime.get(selectedKey) : null;
      const macdValue = macdReadout.querySelector('[data-indicator-value="macd"]');
      const signalValue = macdReadout.querySelector('[data-indicator-value="signal"]');
      const histogramValue = macdReadout.querySelector('[data-indicator-value="histogram"]');
      if (macdValue) macdValue.textContent = `${macdValue.dataset.prefix} ${signedIndicatorValue(values?.macd)}`;
      if (signalValue) signalValue.textContent = `${signalValue.dataset.prefix} ${signedIndicatorValue(values?.signal)}`;
      if (histogramValue) {
        histogramValue.textContent = `${histogramValue.dataset.prefix} ${signedIndicatorValue(values?.histogram)}`;
        const histogram = Number(values?.histogram);
        histogramValue.dataset.tone = values?.histogram !== null && values?.histogram !== undefined && Number.isFinite(histogram)
          ? histogram >= 0 ? "positive" : "negative"
          : "neutral";
      }
      macdReadout.setAttribute(
        "aria-label",
        `MACD ${signedIndicatorValue(values?.macd)}, signal ${signedIndicatorValue(values?.signal)}, histogram ${signedIndicatorValue(values?.histogram)}`,
      );
      positionMacdReadout();
    }

    function createMacdReadout() {
      if (macdPaneIndex === null) return null;
      const host = document.createElement("div");
      host.className = "raven-chart-indicator-readout";
      host.dataset.chartIndicatorReadout = "macd";
      host.setAttribute("role", "group");
      const label = document.createElement("strong");
      label.textContent = "MACD";
      const values = [
        ["macd", "M"],
        ["signal", "S"],
        ["histogram", "H"],
      ].map(([key, prefix]) => {
        const value = document.createElement("span");
        value.dataset.indicatorValue = key;
        value.dataset.prefix = prefix;
        value.textContent = `${prefix} —`;
        return value;
      });
      host.append(label, ...values);
      chartHost.appendChild(host);
      return host;
    }

    refreshIndicators();
    const panes = typeof chart.panes === "function" ? chart.panes() : [];
    if (panes.length > 1) {
      panes[0]?.setStretchFactor?.(3);
      panes.slice(1).forEach((pane) => pane?.setStretchFactor?.(1));
    }
    macdReadout = createMacdReadout();
    paintMacdReadout();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(positionMacdReadout);

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

    const eventMarkers = events.filter((event) => event && event.time).map(markerFor);
    const overlayMarkerRows = visibleOverlays()
      .filter((overlay) => OVERLAY_RENDERER_REGISTRY[overlay.type]?.renderAs === "marker")
      .filter((overlay) => overlay.time || overlay.startTime);
    const overlayMarkers = overlayMarkerRows.map(overlayMarker);
    const markers = eventMarkers.concat(
      overlayMarkers,
    );
    const markerLookup = new Map();
    eventMarkers.forEach((marker, index) => markerLookup.set(marker.id, events.filter((event) => event && event.time)[index]));
    overlayMarkers.forEach((marker, index) => markerLookup.set(marker.id, overlayMarkerRows[index]));
    if (typeof api.createSeriesMarkers === "function") api.createSeriesMarkers(candleSeries, markers, { autoScale: false });
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
        const isPlan = String(overlay.type || "").startsWith("plan-");
        const isTechnicalLevel = overlay.type === "technical-fibonacci-level";
        if (Number.isFinite(Number(overlay.priceMin))) {
          candleSeries.createPriceLine({
            price: Number(overlay.priceMin),
            color: colorFor(overlay),
            lineWidth: isPlan ? 2 : 1,
            lineStyle: api.LineStyle?.Dotted || 1,
            axisLabelVisible: isPlan || isTechnicalLevel,
            title: isPlan || isTechnicalLevel ? overlay.label || "" : "",
          });
        }
        if (Number.isFinite(Number(overlay.priceMax)) && Number(overlay.priceMax) !== Number(overlay.priceMin)) {
          candleSeries.createPriceLine({
            price: Number(overlay.priceMax),
            color: colorFor(overlay),
            lineWidth: isPlan ? 2 : 1,
            lineStyle: api.LineStyle?.Dotted || 1,
            axisLabelVisible: isPlan,
            title: isPlan ? overlay.label || "" : "",
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
        options?.onOverlayTypesChange?.(Array.from(activeTypes));
        const initialVisibleTimeRange = chart.timeScale().getVisibleRange?.() || null;
        apiRef.destroy();
        const next = RavenPriceChart(container, {
          ...options,
          visibleOverlayTypes: Array.from(activeTypes),
          initialVisibleTimeRange,
        });
        if (next) Object.assign(apiRef, next);
      }, () => {
        activeTypes.clear();
        options?.onOverlaySelect?.(null);
        options?.onOverlayTypesChange?.([]);
        const initialVisibleTimeRange = chart.timeScale().getVisibleRange?.() || null;
        apiRef.destroy();
        const next = RavenPriceChart(container, {
          ...options,
          visibleOverlayTypes: [],
          initialVisibleTimeRange,
        });
        if (next) Object.assign(apiRef, next);
      });
    }

    const requestedInitialRange = options?.initialVisibleTimeRange;
    const requestedInitialBars = Math.max(0, Math.trunc(Number(options?.initialVisibleBars) || 0));
    if (
      requestedInitialRange
      && requestedInitialRange.from !== null
      && requestedInitialRange.from !== undefined
      && requestedInitialRange.to !== null
      && requestedInitialRange.to !== undefined
    ) {
      chart.timeScale().setVisibleRange(requestedInitialRange);
    } else if (requestedInitialBars > 0 && candles.length > requestedInitialBars) {
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, candles.length - requestedInitialBars),
        to: candles.length + 4,
      });
    } else {
      chart.timeScale().fitContent();
    }
    renderRegions();
    if (options?.showOverlayLegend !== false) redrawLegend();
    chart.timeScale().subscribeVisibleTimeRangeChange(renderRegions);
    const logicalRangeHandler = (range) => {
      chart.priceScale("right").applyOptions({ autoScale: true });
      renderRegions();
      options?.onVisibleLogicalRangeChange?.(range);
    };
    if (typeof chart.timeScale().subscribeVisibleLogicalRangeChange === "function") {
      chart.timeScale().subscribeVisibleLogicalRangeChange(logicalRangeHandler);
    }
    const inspectedCandle = (param) => {
      const row = param?.seriesData?.get?.(candleSeries);
      if (!param?.time || !row) return null;
      const macdValues = macdValuesByTime.get(String(param.time)) || null;
      return {
        time: param.time,
        open: Number.isFinite(Number(row.open)) ? Number(row.open) : null,
        high: Number.isFinite(Number(row.high)) ? Number(row.high) : null,
        low: Number.isFinite(Number(row.low)) ? Number(row.low) : null,
        close: Number.isFinite(Number(row.close ?? row.value)) ? Number(row.close ?? row.value) : null,
        volume: Number.isFinite(Number(volumeByTime.get(String(param.time)))) ? Number(volumeByTime.get(String(param.time))) : null,
        quote_volume: Number.isFinite(Number(quoteVolumeByTime.get(String(param.time)))) ? Number(quoteVolumeByTime.get(String(param.time))) : null,
        indicators: macdValues ? { macd: { ...macdValues } } : {},
        point: param.point || null,
      };
    };
    const crosshairHandler = (param) => {
      const selected = inspectedCandle(param);
      inspectedIndicatorTime = selected?.time ?? null;
      paintMacdReadout(inspectedIndicatorTime);
      options?.onCrosshairMove?.(selected);
    };
    if (typeof chart.subscribeCrosshairMove === "function") chart.subscribeCrosshairMove(crosshairHandler);
    const clickHandler = (param) => {
      const markerId = param?.hoveredInfo?.objectId ?? param?.hoveredObjectId;
      if (markerId && markerLookup.has(String(markerId))) options?.onMarkerSelect?.(markerLookup.get(String(markerId)));
      // A mouse click should inspect the same exact candle as hover. Touch
      // keeps Lightweight Charts' native hold-and-drag lifecycle so lifting a
      // finger clears the temporary candle card.
      if (window.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches) {
        const selected = inspectedCandle(param);
        if (selected) {
          inspectedIndicatorTime = selected.time;
          paintMacdReadout(inspectedIndicatorTime);
          options?.onCrosshairMove?.(selected);
        }
      }
    };
    if (typeof chart.subscribeClick === "function") chart.subscribeClick(clickHandler);
    const resizeObserver = new ResizeObserver(() => {
      const width = chartHost.clientWidth || container.clientWidth;
      const height = container.clientHeight || chartHost.clientHeight || options?.height || 520;
      if (chartHost.clientHeight !== height) chartHost.style.height = `${height}px`;
      chart.applyOptions({ width, height });
      renderRegions();
      positionMacdReadout();
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
        const quoteVolume = Number(value?.quote_volume ?? value?.quoteVolume);
        if (Number.isFinite(quoteVolume)) quoteVolumeByTime.set(String(normalized.time), quoteVolume);
        if (volumeSeries && volume) volumeSeries.update(volume);
        refreshIndicators();
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
        quoteVolumeByTime = new Map(rawCandles
          .filter((row) => row?.time && Number.isFinite(Number(row.quote_volume ?? row.quoteVolume)))
          .map((row) => [String(row.time), Number(row.quote_volume ?? row.quoteVolume)]));
        candleSeries.setData(candles);
        if (volumeSeries) volumeSeries.setData(normalizeVolume(rawCandles));
        refreshIndicators();
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
      setVisibleTimeRange(range) {
        if (!range || range.from === null || range.from === undefined || range.to === null || range.to === undefined) return false;
        chart.timeScale().setVisibleRange?.(range);
        return true;
      },
      setVisibleBars(count) {
        const bars = Math.max(2, Math.min(candles.length, Math.trunc(Number(count) || 0)));
        if (!bars) return false;
        chart.timeScale().setVisibleLogicalRange?.({ from: Math.max(0, candles.length - bars), to: candles.length + 4 });
        return true;
      },
      fitContent() {
        chart.timeScale().fitContent?.();
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
          available_overlay_count: enrichedOverlays.length,
          active_overlay_count: visibleOverlays().length,
          active_overlay_types: Array.from(activeTypes),
          active_indicators: Array.from(activeIndicators),
          indicator_pane_count: Math.max(0, nextIndicatorPane - 1),
          price_axis: {
            side: scaleContract.side,
            visible: scaleContract.visible,
            auto_scale: scaleContract.auto_scale,
            precision: scaleContract.precision,
            min_move: scaleContract.min_move,
            quote_asset: scaleContract.quote_asset,
            instrument_type: scaleContract.instrument_type,
          },
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
        positionMacdReadout();
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

  function RavenSeriesChart(container, options = {}) {
    if (!container) return null;
    const api = window.LightweightCharts;
    const rows = (Array.isArray(options.rows) ? options.rows : [])
      .map((row) => ({
        time: row?.time,
        value: Number(row?.value),
        period: row?.period || null,
      }))
      .filter((row) => row.time !== null && row.time !== undefined && Number.isFinite(row.value))
      .sort((left, right) => Number(left.time) - Number(right.time));
    if (!api?.createChart || rows.length < 2) return null;

    container.replaceChildren();
    const shell = document.createElement("div");
    shell.className = "raven-series-chart-shell";
    const inspector = document.createElement("div");
    inspector.className = "raven-series-chart-inspector";
    inspector.setAttribute("aria-live", "polite");
    const stage = document.createElement("div");
    stage.className = "raven-series-chart-stage";
    const chartHost = document.createElement("div");
    chartHost.className = "raven-series-chart-host";
    stage.append(chartHost);
    shell.append(inspector, stage);
    container.append(shell);

    const scaleContract = priceScaleContract(options, rows.map((row) => row.value), { series: true });
    const valueFormatter = typeof options.valueFormatter === "function"
      ? options.valueFormatter
      : scaleContract.formatter;
    const units = String(options.units || "Published value");
    const byTime = new Map(rows.map((row, index) => [String(row.time), { row, index }]));
    const renderInspector = (selected = null) => {
      const active = selected || rows.at(-1);
      const index = byTime.get(String(active.time))?.index ?? rows.length - 1;
      const previous = index > 0 ? rows[index - 1] : null;
      const absolute = previous ? active.value - previous.value : null;
      const percent = previous && previous.value !== 0 ? (absolute / previous.value) * 100 : null;
      const fields = [
        [selected ? "Inspect" : "Latest", active.period || crosshairTimeLabel(active.time)],
        ["Value", valueFormatter(active.value)],
        ["Δ", absolute === null ? "—" : `${absolute >= 0 ? "+" : ""}${valueFormatter(absolute)}`],
        ["Change", percent === null ? "—" : `${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%`],
        ["Units", units],
      ];
      inspector.dataset.mode = selected ? "inspect" : "latest";
      inspector.replaceChildren(...fields.map(([label, value], indexValue) => {
        const cell = document.createElement("span");
        if (indexValue === 0) cell.className = "raven-series-chart-time";
        const key = document.createElement("small");
        key.textContent = label;
        const result = document.createElement("strong");
        result.textContent = value;
        cell.append(key, result);
        return cell;
      }));
    };

    const height = Math.max(280, Number(options.height) || 420);
    shell.style.setProperty("--raven-series-height", `${height}px`);
    const chart = api.createChart(chartHost, {
      width: chartHost.clientWidth || container.clientWidth || 720,
      height: Math.max(230, height - 46),
      layout: {
        background: { color: "#080a0d" },
        textColor: "#929daa",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(183, 194, 208, 0.05)" },
        horzLines: { color: "rgba(183, 194, 208, 0.05)" },
      },
      defaultVisiblePriceScaleId: "right",
      leftPriceScale: { visible: false },
      rightPriceScale: {
        visible: true,
        autoScale: true,
        alignLabels: true,
        ticksVisible: true,
        borderVisible: true,
        borderColor: "rgba(148, 163, 184, 0.18)",
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: "rgba(148, 163, 184, 0.18)",
        timeVisible: options.timeVisible === true,
        secondsVisible: false,
      },
      crosshair: { mode: 0 },
      trackingMode: {
        exitMode: api.TrackingModeExitMode?.OnTouchEnd ?? 0,
      },
      localization: { priceFormatter: valueFormatter },
    });
    const series = chart.addSeries(api.LineSeries, {
      color: "#8da6b8",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      priceScaleId: "right",
      priceFormat: { type: "custom", formatter: valueFormatter, minMove: scaleContract.min_move },
    });
    series.setData(rows.map(({ time, value }) => ({ time, value })));
    chart.priceScale("right").applyOptions({ visible: true, autoScale: true });
    if (typeof window !== "undefined") window.__RAVENOS_LAST_PRICE_SCALE__ = scaleContract;
    chart.timeScale().fitContent();
    renderInspector();
    const logicalRangeHandler = () => chart.priceScale("right").applyOptions({ autoScale: true });
    chart.timeScale().subscribeVisibleLogicalRangeChange?.(logicalRangeHandler);

    const crosshairHandler = (param) => {
      const value = param?.seriesData?.get?.(series);
      if (!param?.time || !value || !Number.isFinite(Number(value.value))) {
        renderInspector();
        return;
      }
      const record = byTime.get(String(param.time))?.row || {
        time: param.time,
        value: Number(value.value),
        period: null,
      };
      renderInspector(record);
    };
    chart.subscribeCrosshairMove?.(crosshairHandler);
    const resizeObserver = new ResizeObserver(([entry]) => {
      const width = Math.max(1, Math.floor(entry.contentRect.width));
      const stageHeight = Math.max(230, Math.floor(stage.getBoundingClientRect().height));
      chart.applyOptions({ width, height: stageHeight });
    });
    resizeObserver.observe(stage);

    return {
      chart,
      series,
      measure() {
        return {
          loaded_points: rows.length,
          price_axis: {
            side: scaleContract.side,
            visible: scaleContract.visible,
            auto_scale: scaleContract.auto_scale,
            precision: scaleContract.precision,
            min_move: scaleContract.min_move,
            quote_asset: scaleContract.quote_asset,
            instrument_type: scaleContract.instrument_type,
          },
        };
      },
      destroy() {
        resizeObserver.disconnect();
        chart.unsubscribeCrosshairMove?.(crosshairHandler);
        chart.timeScale().unsubscribeVisibleLogicalRangeChange?.(logicalRangeHandler);
        chart.remove();
        shell.remove();
      },
      remove() {
        this.destroy();
      },
    };
  }

  window.RavenChartOverlayRenderers = OVERLAY_RENDERER_REGISTRY;
  window.RavenPriceChart = RavenPriceChart;
  window.RavenSeriesChart = RavenSeriesChart;
})();
