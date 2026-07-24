import {
  BoundedEventBuffer,
  CHART_INSTRUMENT_TYPES,
  HyperliquidChartFeed,
  PollingChartFeed,
  RAVENOS_CHART_TIMEFRAMES,
  normalizeChartCandle,
  normalizeChartInstrument,
  sharedChartSubscriptions,
} from "./ravenos-chart-data-plane.js";

export const RAVENOS_PRICE_WORKSPACE_SCHEMA = "ravenos.price_workspace.v1";

export const PRICE_WORKSPACE_STATES = Object.freeze({
  LIVE: "live",
  DELAYED: "delayed",
  DEMO: "demo",
  HISTORICAL: "historical",
  SIMULATED: "simulated",
  PAPER: "paper",
  LOADING: "loading",
  EMPTY: "empty",
  ERROR: "error",
  DATA_UNAVAILABLE: "data_unavailable",
});

const STATE_LABELS = Object.freeze({
  live: "Live",
  delayed: "Delayed",
  demo: "Demo",
  historical: "Historical",
  simulated: "Simulated",
  paper: "Paper",
  loading: "Loading",
  empty: "No data",
  error: "Provider error",
  data_unavailable: "Data unavailable",
});

const TIMEFRAMES = RAVENOS_CHART_TIMEFRAMES;

function cleanState(value, fallback = PRICE_WORKSPACE_STATES.DATA_UNAVAILABLE) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["fresh", "current"].includes(normalized)) return PRICE_WORKSPACE_STATES.LIVE;
  if (["stale", "cached", "degraded"].includes(normalized)) return PRICE_WORKSPACE_STATES.DELAYED;
  if (["unavailable", "coverage_developing", "unknown"].includes(normalized)) return PRICE_WORKSPACE_STATES.DATA_UNAVAILABLE;
  return Object.values(PRICE_WORKSPACE_STATES).includes(normalized) ? normalized : fallback;
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCandles(value) {
  return (Array.isArray(value) ? value : [])
    .map((row) => ({
      time: row?.time,
      open: finite(row?.open),
      high: finite(row?.high),
      low: finite(row?.low),
      close: finite(row?.close),
      volume: finite(row?.volume),
      quote_volume: finite(row?.quote_volume ?? row?.quoteVolume),
    }))
    .filter((row) => row.time !== null && row.time !== undefined && row.open > 0 && row.high > 0 && row.low > 0 && row.close > 0);
}

function timestampLabel(value) {
  const parsed = Date.parse(value || "");
  if (!Number.isFinite(parsed)) return "Timestamp unavailable";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(parsed) + " UTC";
}

function priceLabel(value) {
  const parsed = finite(value);
  if (parsed === null) return "--";
  if (parsed >= 1000) return parsed.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (parsed >= 1) return parsed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  return parsed.toLocaleString(undefined, { minimumSignificantDigits: 3, maximumSignificantDigits: 8 });
}

function volumeLabel(value) {
  const parsed = finite(value);
  if (parsed === null) return "--";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(parsed);
}

function signedPriceChange(open, close) {
  const start = finite(open);
  const end = finite(close);
  if (start === null || end === null) return { absolute: null, percent: null };
  return {
    absolute: end - start,
    percent: start === 0 ? null : ((end / start) - 1) * 100,
  };
}

function crosshairTimeLabel(value) {
  let parsed;
  if (typeof value === "number") parsed = new Date(value * 1_000);
  else if (value && typeof value === "object" && Number.isInteger(value.year)) parsed = new Date(Date.UTC(value.year, Number(value.month || 1) - 1, Number(value.day || 1)));
  else parsed = new Date(value || "");
  if (Number.isNaN(parsed.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(parsed) + " UTC";
}

function payloadData(payload) {
  return payload?.data && typeof payload.data === "object" ? payload.data : payload;
}

function exactRavenAnnotations(value, instrument) {
  if (!value || value.role !== "annotation_only" || value.identity_scope !== "exact_pool") return null;
  if (value.candle_replacement_allowed !== false || !value.lineage || typeof value.lineage !== "object") return null;
  if (!instrument?.canonical_id || value.instrument_id !== instrument.canonical_id) return null;
  return value;
}

function sameExpectedIdentity(chain, left, right) {
  const first = String(left || "").trim();
  const second = String(right || "").trim();
  if (!first || !second) return false;
  const network = String(chain || "").trim().toLowerCase();
  return ["base", "ethereum", "arbitrum", "optimism", "polygon", "robinhood"].includes(network)
    ? first.toLowerCase() === second.toLowerCase()
    : first === second;
}

function validateExpectedInstrument(instrument, expected = {}) {
  if (!expected || typeof expected !== "object") return true;
  const checks = [
    ["canonicalId", "canonical_id"],
    ["instrumentType", "instrument_type"],
    ["identityScope", "identity_scope"],
    ["chain", "chain"],
    ["venue", "venue"],
    ["baseAsset", "base_asset"],
    ["quoteAsset", "quote_asset"],
  ];
  for (const [expectedKey, instrumentKey] of checks) {
    if (expected[expectedKey] === null || expected[expectedKey] === undefined || expected[expectedKey] === "") continue;
    if (String(expected[expectedKey]).toLowerCase() !== String(instrument?.[instrumentKey] || "").toLowerCase()) return false;
  }
  for (const [expectedKey, instrumentKey] of [["poolAddress", "pool_address"], ["tokenAddress", "token_address"]]) {
    if (expected[expectedKey] === null || expected[expectedKey] === undefined || expected[expectedKey] === "") continue;
    if (!sameExpectedIdentity(expected.chain || instrument?.chain, expected[expectedKey], instrument?.[instrumentKey])) return false;
  }
  return true;
}

function createMarkup() {
  return `
    <section class="rpw" data-price-workspace-state="data_unavailable">
      <header class="rpw-provenance" aria-live="polite">
        <strong data-rpw-state>Data unavailable</strong>
        <span data-rpw-source>No provider selected</span>
        <span data-rpw-market>Market identity unavailable</span>
        <span data-rpw-coverage hidden></span>
        <span data-rpw-connection>Disconnected</span>
        <time data-rpw-time>Timestamp unavailable</time>
        <button type="button" data-rpw-follow aria-pressed="true">Follow live</button>
        <button type="button" data-rpw-focus aria-pressed="false" aria-label="Open chart focus mode">Focus</button>
        <button type="button" data-rpw-overlays aria-expanded="false" aria-label="Open Raven overlay controls">Raven</button>
      </header>
      <div class="rpw-chart-tools">
        <div class="rpw-mobile-timeframes" data-rpw-timeframes aria-label="Chart timeframe"></div>
        <div class="rpw-scope-control" data-rpw-scopes hidden aria-label="Spot chart identity scope">
          <button type="button" data-rpw-scope="exact_pool" aria-pressed="true">Exact pool</button>
          <button type="button" data-rpw-scope="token_aggregate" aria-pressed="false">Token aggregate</button>
        </div>
        <div class="rpw-indicators" data-rpw-indicators aria-label="Chart indicators">
          <span>Indicators</span>
          <button type="button" data-rpw-indicator="ema20" aria-pressed="true">EMA 20</button>
          <button type="button" data-rpw-indicator="ema50" aria-pressed="false">EMA 50</button>
          <button type="button" data-rpw-indicator="vwap" aria-pressed="false">VWAP</button>
        </div>
      </div>
      <div class="rpw-stage">
        <div class="rpw-chart" data-rpw-chart></div>
        <div class="rpw-marker-index" data-rpw-marker-index hidden aria-label="Inspectable Raven chart markers"></div>
        <div class="rpw-watermark" data-rpw-watermark>Data unavailable</div>
        <div class="rpw-crosshair" data-rpw-crosshair hidden aria-live="polite"></div>
        <div class="rpw-coverage-note" data-rpw-coverage-note hidden aria-live="polite"></div>
        <div class="rpw-state-panel" data-rpw-state-panel>
          <strong>Market data unavailable</strong>
          <span>Select a provider-backed market or retry the current feed.</span>
        </div>
      </div>
      <div class="rpw-activity" data-rpw-activity aria-live="polite">
        <strong>Market activity</strong>
        <div data-rpw-trades>Trade-level feed unavailable for this source.</div>
      </div>
      <div class="rpw-resize-handle" data-rpw-resize role="separator" aria-label="Resize chart" aria-orientation="horizontal" tabindex="0"></div>
    </section>`;
}

export class PriceWorkspace {
  constructor(container, options = {}) {
    if (!container) throw new Error("PriceWorkspace requires a container");
    this.container = container;
    this.options = options;
    this.activeIndicators = new Set(Array.isArray(options.indicators) ? options.indicators : ["ema20"]);
    this.chartHandle = null;
    this.liveRelease = null;
    this.lastLiveRequest = null;
    this.lastLivePayload = null;
    this.requestSequence = 0;
    this.liveGeneration = 0;
    this.paintFrame = null;
    this.lastRequest = null;
    this.backfillPending = false;
    this.backfillArmed = false;
    this.backfillArmTimer = null;
    this.followLive = true;
    this.inspectingCandle = false;
    this.tradeBuffer = new BoundedEventBuffer(options.tradeLimit || 60);
    this.renderInput = {};
    this.state = {
      schemaVersion: RAVENOS_PRICE_WORKSPACE_SCHEMA,
      state: PRICE_WORKSPACE_STATES.DATA_UNAVAILABLE,
      source: "",
      observedAt: null,
      marketIdentity: "",
      timeframe: options.timeframe || "1h",
      candles: [],
      message: "Select a provider-backed market.",
      lineage: null,
      instrument: null,
      capabilities: {},
      connectionState: "disconnected",
      marketState: {},
      orderBook: null,
      backfillCount: 0,
      instrumentScope: "exact_pool",
      availableScopes: {},
      ravenAnnotations: null,
      candleSeries: null,
      continuity: null,
      derivation: null,
      providerSelection: null,
      providerUsage: null,
      marketAnatomy: null,
      providerTransitionCount: 0,
    };
    container.innerHTML = createMarkup();
    this.root = container.querySelector(".rpw");
    this.root.classList.toggle("rpw-fluid", options.fluidHeight === true);
    this.chartHost = container.querySelector("[data-rpw-chart]");
    this.bindTimeframes();
    this.bindIndicators();
    this.bindScopes();
    this.bindResize();
    this.bindFollowLive();
    this.bindFocusMode();
    this.bindOverlayMenu();
    this.bindVisibility();
    this.paintState();
  }

  bindVisibility() {
    this._visibilityHandler = () => {
      if (document.hidden) {
        if (this.liveRelease || this.state.capabilities?.live_bars === true) {
          this.stopLive("paused_hidden");
          this.publishConnectionState();
        }
        return;
      }
      if (
        !this.liveRelease
        && this.lastLiveRequest
        && this.lastLivePayload
        && this.state.instrument
        && this.state.capabilities?.live_bars === true
      ) {
        this.state.connectionState = "reconnecting";
        this.publishConnectionState();
        this.startLive(this.lastLiveRequest, this.lastLivePayload);
      }
    };
    document.addEventListener("visibilitychange", this._visibilityHandler);
  }

  publishConnectionState() {
    this.paintState();
    this.options.onStateChange?.({ ...this.state });
    document.dispatchEvent(new CustomEvent("ravenos:priceworkspace", { detail: { ...this.state } }));
  }

  bindTimeframes() {
    const host = this.container.querySelector("[data-rpw-timeframes]");
    for (const timeframe of TIMEFRAMES) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = timeframe;
      button.dataset.timeframe = timeframe;
      button.setAttribute("aria-pressed", timeframe === this.state.timeframe ? "true" : "false");
      button.addEventListener("click", () => this.options.onTimeframeChange?.(timeframe));
      host.append(button);
    }
  }

  bindIndicators() {
    const host = this.container.querySelector("[data-rpw-indicators]");
    if (!host) return;
    const paint = () => host.querySelectorAll("[data-rpw-indicator]").forEach((button) => {
      button.setAttribute("aria-pressed", this.activeIndicators.has(button.dataset.rpwIndicator) ? "true" : "false");
    });
    paint();
    host.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-rpw-indicator]");
      const indicator = button?.dataset?.rpwIndicator;
      if (!indicator || !["ema20", "ema50", "vwap"].includes(indicator)) return;
      if (this.activeIndicators.has(indicator)) this.activeIndicators.delete(indicator);
      else this.activeIndicators.add(indicator);
      paint();
      this.render({ indicators: Array.from(this.activeIndicators) });
    });
  }

  bindScopes() {
    this.container.querySelector("[data-rpw-scopes]")?.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-rpw-scope]");
      const scope = button?.dataset?.rpwScope;
      if (!scope || scope === this.state.instrumentScope || this.state.availableScopes?.[scope] !== true || !this.lastRequest) return;
      this.load({ ...this.lastRequest, instrumentScope: scope });
    });
  }

  bindResize() {
    const handle = this.container.querySelector("[data-rpw-resize]");
    if (this.options.fluidHeight === true) {
      handle.hidden = true;
      return;
    }
    let startY = 0;
    let startHeight = 0;
    const move = (event) => {
      const next = Math.max(320, Math.min(900, startHeight + event.clientY - startY));
      this.root.style.setProperty("--rpw-height", `${next}px`);
    };
    const stop = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", stop);
    };
    handle.addEventListener("pointerdown", (event) => {
      if (window.matchMedia?.("(max-width: 820px)")?.matches) return;
      startY = event.clientY;
      startHeight = this.root.getBoundingClientRect().height;
      handle.setPointerCapture?.(event.pointerId);
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", stop, { once: true });
    });
  }

  bindFollowLive() {
    const button = this.container.querySelector("[data-rpw-follow]");
    button.addEventListener("click", () => {
      this.followLive = !this.followLive;
      button.setAttribute("aria-pressed", this.followLive ? "true" : "false");
      button.textContent = this.followLive ? "Following live" : "Follow live";
      if (this.followLive) this.chartHandle?.scrollToRealTime?.();
    });
  }

  bindFocusMode() {
    const button = this.container.querySelector("[data-rpw-focus]");
    if (!button) return;
    const setFocus = (active) => {
      this.root.classList.toggle("rpw-focus-mode", active);
      document.body.classList.toggle("raven-chart-focus", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.textContent = active ? "Exit focus" : "Focus";
      this.chartHandle?.resize?.();
      requestAnimationFrame(() => this.publishGeometry?.());
      this.options.onFocusChange?.(active);
    };
    button.addEventListener("click", () => setFocus(!this.root.classList.contains("rpw-focus-mode")));
    this._clearFocus = () => setFocus(false);
    this._focusKeyHandler = (event) => {
      if (event.key === "Escape" && this.root.classList.contains("rpw-focus-mode")) {
        event.preventDefault();
        setFocus(false);
      }
    };
    document.addEventListener("keydown", this._focusKeyHandler);
  }

  bindOverlayMenu() {
    const button = this.container.querySelector("[data-rpw-overlays]");
    if (!button) return;
    const close = () => {
      this.root.classList.remove("rpw-overlays-open");
      button.setAttribute("aria-expanded", "false");
    };
    button.addEventListener("click", () => {
      const open = !this.root.classList.contains("rpw-overlays-open");
      this.root.classList.toggle("rpw-overlays-open", open);
      button.setAttribute("aria-expanded", open ? "true" : "false");
    });
    this.root.addEventListener("click", (event) => {
      const selected = event.target.closest(".raven-overlay-options button:not(:disabled), .raven-overlay-active button:not(:disabled)");
      if (selected) close();
    });
    this._overlayPointerHandler = (event) => {
      if (!this.root.classList.contains("rpw-overlays-open")) return;
      if (!this.root.contains(event.target)) close();
    };
    this._overlayKeyHandler = (event) => {
      if (event.key !== "Escape" || !this.root.classList.contains("rpw-overlays-open")) return;
      event.preventDefault();
      close();
      button.focus();
    };
    document.addEventListener("pointerdown", this._overlayPointerHandler);
    document.addEventListener("keydown", this._overlayKeyHandler);
  }

  setTimeframe(timeframe) {
    this.state.timeframe = TIMEFRAMES.includes(timeframe) ? timeframe : "1h";
    this.container.querySelectorAll("[data-timeframe]").forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.timeframe === this.state.timeframe ? "true" : "false");
    });
  }

  setState(next = {}) {
    this.state = {
      ...this.state,
      ...next,
      schemaVersion: RAVENOS_PRICE_WORKSPACE_SCHEMA,
      state: cleanState(next.state ?? this.state.state),
      candles: normalizeCandles(next.candles ?? this.state.candles),
    };
    this.setTimeframe(this.state.timeframe);
    this.paintState();
    this.options.onStateChange?.({ ...this.state });
    document.dispatchEvent(new CustomEvent("ravenos:priceworkspace", { detail: { ...this.state } }));
    return this.state;
  }

  paintState() {
    const label = STATE_LABELS[this.state.state] || "Data unavailable";
    this.root.dataset.priceWorkspaceState = this.state.state;
    this.container.querySelector("[data-rpw-state]").textContent = label;
    this.container.querySelector("[data-rpw-source]").textContent = this.state.source || "No provider selected";
    this.container.querySelector("[data-rpw-market]").textContent = this.state.marketIdentity || "Market identity unavailable";
    const coverage = this.container.querySelector("[data-rpw-coverage]");
    const returnedBars = Number(this.state.returnedBars ?? this.state.candles.length);
    const sparse = returnedBars > 0 && returnedBars < 40;
    coverage.hidden = !sparse;
    coverage.textContent = sparse ? `Limited history · ${returnedBars} bars` : "";
    const coverageNote = this.container.querySelector("[data-rpw-coverage-note]");
    coverageNote.hidden = !sparse;
    coverageNote.textContent = sparse
      ? `${this.state.timeframe} coverage is limited to ${returnedBars} provider-backed bars. Missing history was not filled.`
      : "";
    this.container.querySelector("[data-rpw-connection]").textContent = String(this.state.connectionState || "disconnected").replaceAll("_", " ");
    this.container.querySelector("[data-rpw-time]").textContent = timestampLabel(this.state.observedAt);
    this.container.querySelector("[data-rpw-watermark]").textContent = label;
    const scopeHost = this.container.querySelector("[data-rpw-scopes]");
    const hasBothScopes = this.state.availableScopes?.exact_pool === true && this.state.availableScopes?.token_aggregate === true;
    if (scopeHost) scopeHost.hidden = !hasBothScopes;
    scopeHost?.querySelectorAll("[data-rpw-scope]").forEach((button) => {
      const active = button.dataset.rpwScope === this.state.instrumentScope;
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.disabled = this.state.availableScopes?.[button.dataset.rpwScope] !== true;
    });
    const panel = this.container.querySelector("[data-rpw-state-panel]");
    const showPanel = ["loading", "empty", "error", "data_unavailable"].includes(this.state.state);
    panel.hidden = !showPanel;
    panel.querySelector("strong").textContent = label === "Loading" ? "Loading market data" : label;
    panel.querySelector("span").textContent = this.state.message || "No provider-backed candles are available for this market.";
    if (showPanel) this.container.querySelector("[data-rpw-crosshair]").hidden = true;
    this.paintTrades();
  }

  paintTrades() {
    const host = this.container.querySelector("[data-rpw-trades]");
    const activity = this.container.querySelector("[data-rpw-activity]");
    const trades = this.tradeBuffer.values().slice(-12).reverse();
    const tradeFeedAvailable = this.state.capabilities?.live_trades === true || trades.length > 0;
    this.root.classList.toggle("rpw-no-activity", !tradeFeedAvailable);
    if (activity) activity.hidden = !tradeFeedAvailable;
    if (!trades.length) {
      host.textContent = tradeFeedAvailable ? "Waiting for the first venue trade." : "";
      return;
    }
    host.replaceChildren(...trades.map((trade) => {
      const row = document.createElement("span");
      row.className = `rpw-trade rpw-trade-${trade.side || "unknown"}`;
      const time = Number(trade.time);
      const timeLabel = Number.isFinite(time) ? new Date(time > 10_000_000_000 ? time : time * 1000).toISOString().slice(11, 19) : "--:--:--";
      const fields = [timeLabel, String(trade.side || "trade").toUpperCase(), priceLabel(trade.price), finite(trade.size) ?? "--"];
      row.replaceChildren(...fields.map((value) => {
        const field = document.createElement("span");
        field.textContent = String(value);
        return field;
      }));
      return row;
    }));
  }

  paintMarkerIndex() {
    const host = this.container.querySelector("[data-rpw-marker-index]");
    if (!host) return;
    const events = (Array.isArray(this.renderInput?.events) ? this.renderInput.events : []).filter((row) => row?.time);
    const overlays = (Array.isArray(this.renderInput?.overlays) ? this.renderInput.overlays : []).filter((row) => row?.time || row?.startTime);
    const rows = [...events, ...overlays].slice(0, 6);
    host.replaceChildren();
    host.hidden = rows.length === 0;
    if (!rows.length) return;
    rows.forEach((row, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = row.label || row.raven_read?.title || `Raven marker ${index + 1}`;
      button.title = `Inspect ${button.textContent}`;
      button.addEventListener("click", () => this.options.onMarkerSelect?.(row));
      host.append(button);
    });
    const remaining = events.length + overlays.length - rows.length;
    if (remaining > 0) {
      const count = document.createElement("span");
      count.textContent = `+${remaining}`;
      host.append(count);
    }
  }

  schedulePaint() {
    if (this.paintFrame !== null) return;
    const schedule = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (callback) => setTimeout(callback, 16);
    this.paintFrame = schedule(() => {
      this.paintFrame = null;
      this.paintState();
    });
  }

  requestParams(request = {}, extra = {}) {
    const params = new URLSearchParams({
      market: request.market || "",
      asset: request.asset || "",
      timeframe: extra.timeframe || request.timeframe || this.state.timeframe || "1h",
      limit: String(extra.limit || request.limit || 240),
    });
    if (request.chain) params.set("chain", request.chain);
    if (request.pairAddress) params.set("pair_address", request.pairAddress);
    if (request.tokenAddress) params.set("token_address", request.tokenAddress);
    if (request.quoteAddress) params.set("quote_address", request.quoteAddress);
    if (request.instrumentScope) params.set("instrument_scope", request.instrumentScope);
    if (request.instrumentId) params.set("instrument_id", request.instrumentId);
    if (extra.before) params.set("before", String(extra.before));
    return params;
  }

  async fetchPayload(request = {}, extra = {}) {
    const response = await fetch(`${request.endpoint || "/api/terminal/chart"}?${this.requestParams(request, extra).toString()}`, { headers: { accept: "application/json" } });
    const body = await response.json().catch(() => ({}));
    return { response, payload: payloadData(body) || {} };
  }

  async load(request = {}) {
    const sequence = ++this.requestSequence;
    this.stopLive();
    this.lastLiveRequest = null;
    this.lastLivePayload = null;
    this.tradeBuffer = new BoundedEventBuffer(this.options.tradeLimit || 60);
    this.lastRequest = { ...request };
    this.backfillArmed = false;
    if (this.backfillArmTimer) clearTimeout(this.backfillArmTimer);
    this.backfillArmTimer = null;
    this.renderInput = { ...this.renderInput, events: [], overlays: [], visibleOverlayTypes: [] };
    const timeframe = request.timeframe || this.state.timeframe || "1h";
    this.setState({
      state: PRICE_WORKSPACE_STATES.LOADING,
      timeframe,
      source: request.source || "Market provider",
      marketIdentity: request.marketIdentity || request.asset || "",
      observedAt: null,
      candles: [],
      returnedBars: 0,
      message: "Requesting provider-backed candles.",
      instrument: null,
      capabilities: {},
      marketState: {},
      orderBook: null,
      connectionState: "disconnected",
      instrumentScope: request.instrumentScope || "exact_pool",
      availableScopes: {},
      ravenAnnotations: null,
      candleSeries: null,
      continuity: null,
      derivation: null,
      providerSelection: null,
      providerUsage: null,
      marketAnatomy: null,
    });
    if (request.demo === true) {
      const candles = normalizeCandles(request.demoCandles);
        const state = this.setState({
        state: candles.length ? PRICE_WORKSPACE_STATES.DEMO : PRICE_WORKSPACE_STATES.EMPTY,
        source: "Explicit demo dataset",
        marketIdentity: request.marketIdentity || request.asset || "Demo market",
        observedAt: request.observedAt || null,
          candles,
          returnedBars: candles.length,
        message: candles.length ? "Explicit demo data. Not a live market feed." : "No demo candles were supplied.",
        lineage: { mode: "explicit_demo" },
      });
      this.render(this.renderInput);
      return state;
    }
    try {
      const { response, payload } = await this.fetchPayload({ ...request, timeframe }, { limit: request.limit || 240 });
      if (sequence !== this.requestSequence) return this.state;
      const candles = normalizeCandles(payload.candles);
      if (!response.ok || !payload.ok || !candles.length) {
        this.destroyChart();
        return this.setState({
          state: response.ok ? PRICE_WORKSPACE_STATES.DATA_UNAVAILABLE : PRICE_WORKSPACE_STATES.ERROR,
          source: payload.source_label || payload.source || "Market provider",
          observedAt: payload.observed_at || null,
          marketIdentity: payload.market_identity || request.marketIdentity || request.asset || "",
          candles: [],
          message: payload.message || payload.error || `Market provider returned ${response.status}.`,
          lineage: payload.lineage || null,
          connectionState: "disconnected",
        });
      }
      const instrument = normalizeChartInstrument(payload.instrument || {
        marketType: request.market === "perpetuals" || String(request.asset || "").endsWith("-PERP") ? "perp" : "spot",
        instrumentType: request.instrumentType || (request.pairAddress ? CHART_INSTRUMENT_TYPES.SPOT_POOL : undefined),
        canonicalId: request.instrumentId,
        chain: request.chain,
        venue: payload.source,
        symbol: request.asset,
        tokenAddress: request.tokenAddress,
        pairAddress: request.pairAddress,
      });
      if (request.expectedCanonicalId && instrument.canonical_id !== request.expectedCanonicalId) {
        throw new Error("The chart provider returned a different exact market than the one selected.");
      }
      if (!validateExpectedInstrument(instrument, request.expectedIdentity)) {
        throw new Error("The chart provider returned a different exact market than the one selected.");
      }
      const ravenAnnotations = exactRavenAnnotations(payload.raven_annotations, instrument);
      const state = this.setState({
        state: cleanState(payload.freshness_state, payload.stale ? PRICE_WORKSPACE_STATES.DELAYED : PRICE_WORKSPACE_STATES.LIVE),
        source: payload.source_label || payload.source || "Market provider",
        observedAt: payload.observed_at || payload.updated_at || null,
        marketIdentity: payload.market_identity || request.marketIdentity || payload.asset || request.asset || "",
        candles,
        returnedBars: Number.isFinite(Number(payload.returned_bars)) ? Number(payload.returned_bars) : candles.length,
        message: "",
        lineage: payload.lineage || null,
        providerAsset: payload.provider_asset || payload.asset || null,
        ageSeconds: finite(payload.age_seconds),
        instrument,
        capabilities: payload.capabilities || {},
        marketState: payload.market_state || {},
        connectionState: payload.capabilities?.live_bars ? "connecting" : "snapshot_only",
        instrumentScope: payload.instrument_scope || payload.instrument?.identity_scope || request.instrumentScope || "exact_pool",
        availableScopes: payload.available_scopes || {},
        ravenAnnotations,
        candleSeries: payload.candle_series || null,
        continuity: payload.continuity || null,
        derivation: payload.derivation || payload.candle_series?.derivation || null,
        providerSelection: payload.provider_selection || null,
        providerUsage: payload.provider_usage || null,
        marketAnatomy: payload.market_anatomy || null,
      });
      this.renderInput = {
        ...this.renderInput,
        events: Array.isArray(ravenAnnotations?.events) ? ravenAnnotations.events : [],
        overlays: Array.isArray(ravenAnnotations?.overlays) ? ravenAnnotations.overlays : [],
      };
      for (const trade of Array.isArray(payload.recent_trades) ? payload.recent_trades : []) this.tradeBuffer.append(trade);
      this.paintState();
      this.render(this.renderInput);
      this.startLive({ ...request, timeframe }, payload);
      return state;
    } catch (error) {
      if (sequence !== this.requestSequence) return this.state;
      this.destroyChart();
      return this.setState({
        state: PRICE_WORKSPACE_STATES.ERROR,
        source: request.source || "Market provider",
        observedAt: null,
        candles: [],
        message: error instanceof Error ? error.message : "Market provider request failed.",
      });
    }
  }

  showUnavailable({
    message = "The exact requested market is unavailable. No substitute data was loaded.",
    marketIdentity = "",
    instrumentScope = "unselected",
    source = "No provider selected",
    timeframe = this.state.timeframe,
  } = {}) {
    ++this.requestSequence;
    this.stopLive();
    this.lastLiveRequest = null;
    this.lastLivePayload = null;
    this.tradeBuffer = new BoundedEventBuffer(this.options.tradeLimit || 60);
    this.lastRequest = null;
    this.destroyChart();
    return this.setState({
      state: PRICE_WORKSPACE_STATES.DATA_UNAVAILABLE,
      timeframe,
      source,
      marketIdentity,
      observedAt: null,
      candles: [],
      returnedBars: 0,
      message,
      instrument: null,
      capabilities: {},
      marketState: {},
      orderBook: null,
      connectionState: "disconnected",
      instrumentScope,
      availableScopes: {},
      ravenAnnotations: null,
      candleSeries: null,
      continuity: null,
      derivation: null,
      providerSelection: null,
      providerUsage: null,
      marketAnatomy: null,
      lineage: null,
    });
  }

  render(input = {}) {
    this.renderInput = { ...this.renderInput, ...input };
    this.destroyChart();
    if (!this.state.candles.length || ["loading", "empty", "error", "data_unavailable"].includes(this.state.state)) {
      this.paintMarkerIndex();
      this.paintState();
      return null;
    }
    if (typeof window.RavenPriceChart !== "function") {
      this.setState({ state: PRICE_WORKSPACE_STATES.ERROR, message: "Chart runtime unavailable." });
      return null;
    }
    const mobile = window.matchMedia?.("(max-width: 820px)")?.matches;
    const height = Math.max(mobile ? 300 : 420, this.chartHost.clientHeight || this.root.getBoundingClientRect().height - (mobile ? 116 : 42));
    this.chartHandle = window.RavenPriceChart(this.chartHost, {
      ...this.renderInput,
      candles: this.state.candles,
      instrument: this.state.instrument,
      timeframe: this.state.timeframe,
      height,
      compact: mobile,
      chartDataSource: this.state.state === "demo" ? "explicit_demo" : "terminal_chart_api",
      indicatorSourceState: this.state.state === "demo" ? "demo" : "provider_backed",
      indicators: Array.from(this.activeIndicators),
      onCrosshairMove: (crosshair) => this.renderCrosshair(crosshair),
      onMarkerSelect: (marker) => this.options.onMarkerSelect?.(marker),
      onVisibleLogicalRangeChange: (range) => this.handleVisibleRange(range),
    });
    this.renderCrosshair(null);
    this.paintMarkerIndex();
    const publishGeometry = () => {
      const geometry = this.chartHandle?.measure?.() || null;
      if (!geometry) return;
      this.state.chartGeometry = geometry;
      window.__RAVENOS_CHART_GEOMETRY__ = {
        instrument_id: this.state.instrument?.canonical_id || null,
        timeframe: this.state.timeframe,
        ...geometry,
      };
    };
    this.publishGeometry = publishGeometry;
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(publishGeometry);
    else setTimeout(publishGeometry, 0);
    if (this.backfillArmTimer) clearTimeout(this.backfillArmTimer);
    this.backfillArmTimer = setTimeout(() => {
      this.backfillArmTimer = null;
      this.backfillArmed = true;
    }, 750);
    return this.chartHandle;
  }

  renderCrosshair(crosshair) {
    const host = this.container.querySelector("[data-rpw-crosshair]");
    const latest = this.state.candles.at(-1) || null;
    const selected = crosshair?.time && crosshair.close !== null && crosshair.close !== undefined ? crosshair : latest;
    this.inspectingCandle = selected === crosshair && Boolean(crosshair);
    if (!selected?.time || selected.close === null || selected.close === undefined) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    host.dataset.mode = this.inspectingCandle ? "inspect" : "latest";
    const change = signedPriceChange(selected.open, selected.close);
    const signed = (value, suffix = "") => value === null ? "—" : `${value >= 0 ? "+" : ""}${priceLabel(value)}${suffix}`;
    const fields = [
      [this.inspectingCandle ? "Inspect" : "Latest", crosshairTimeLabel(selected.time)],
      ["O", priceLabel(selected.open)],
      ["H", priceLabel(selected.high)],
      ["L", priceLabel(selected.low)],
      ["C", priceLabel(selected.close)],
      ["Δ", signed(change.absolute)],
      ["Change", change.percent === null ? "—" : `${change.percent >= 0 ? "+" : ""}${change.percent.toFixed(2)}%`],
      ["Base vol", volumeLabel(selected.volume)],
      ["Quote vol", volumeLabel(selected.quote_volume ?? selected.quoteVolume)],
    ];
    host.replaceChildren(...fields.map(([label, value], index) => {
      const cell = document.createElement("span");
      if (index === 0) cell.className = "rpw-crosshair-time";
      const key = document.createElement("small");
      key.textContent = label;
      const result = document.createElement("strong");
      result.textContent = value;
      cell.append(key, result);
      return cell;
    }));
  }

  attachIntelligence({ evidence = null, narrator = null } = {}) {
    this.state.evidence = evidence;
    this.state.narrator = narrator;
    return this;
  }

  handleVisibleRange(range) {
    if (!range || !Number.isFinite(Number(range.from))) return;
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => requestAnimationFrame(() => this.publishGeometry?.()));
    }
    else setTimeout(() => this.publishGeometry?.(), 0);
    const nearLeftEdge = Number(range.from) <= 12;
    if (nearLeftEdge && this.backfillArmed) this.backfill();
    if (Number(range.to) < this.state.candles.length - 2) {
      this.followLive = false;
      const button = this.container.querySelector("[data-rpw-follow]");
      button?.setAttribute("aria-pressed", "false");
      if (button) button.textContent = "Follow live";
    }
  }

  async backfill() {
    if (this.backfillPending || !this.lastRequest || this.state.capabilities?.older_bar_backfill !== true || !this.state.candles.length) return;
    const before = this.state.candles[0]?.time;
    if (!before) return;
    this.backfillPending = true;
    try {
      const { response, payload } = await this.fetchPayload(this.lastRequest, { before, limit: 240 });
      if (!response.ok || !payload?.ok) return;
      const candles = normalizeCandles(payload.candles).filter((row) => Number(row.time) < Number(before));
      if (!candles.length) return;
      const merged = new Map([...candles, ...this.state.candles].map((row) => [String(row.time), row]));
      this.state.candles = [...merged.values()].sort((left, right) => Number(left.time) - Number(right.time));
      this.state.backfillCount = Number(this.state.backfillCount || 0) + 1;
      this.chartHandle?.prependCandles?.(candles);
      document.dispatchEvent(new CustomEvent("ravenos:chartbackfill", { detail: { instrumentId: this.state.instrument?.canonical_id, added: candles.length } }));
    } finally {
      this.backfillPending = false;
    }
  }

  startLive(request, payload) {
    if (!this.state.instrument || payload?.capabilities?.live_bars !== true) return;
    this.lastLiveRequest = { ...request };
    this.lastLivePayload = payload;
    if (document.hidden) {
      this.state.connectionState = "paused_hidden";
      this.publishConnectionState();
      return;
    }
    const generation = ++this.liveGeneration;
    const key = `${this.state.instrument.canonical_id}:${this.state.timeframe}`;
    const createFeed = () => {
      if (this.state.instrument.instrument_type === CHART_INSTRUMENT_TYPES.PERPETUAL && this.state.instrument.venue === "hyperliquid") {
        return new HyperliquidChartFeed({ instrument: this.state.instrument, timeframe: this.state.timeframe });
      }
      return new PollingChartFeed({
        source: `${this.state.source} active-view polling`,
        intervalMs: payload?.capabilities?.live_poll_interval_ms || this.options.spotPollMs || 15_000,
        seenTradeIds: (Array.isArray(payload?.recent_trades) ? payload.recent_trades : []).map((trade) => trade?.id).filter(Boolean),
        poll: async () => {
          const result = await this.fetchPayload(request, { limit: 3 });
          if (!result.response.ok || !result.payload?.ok) throw new Error(result.payload?.error || `chart_poll_${result.response.status}`);
          this.acceptProviderTransition(result.payload);
          return result.payload;
        },
      });
    };
    try {
      this.liveRelease = sharedChartSubscriptions.subscribe(key, createFeed, {
        onEvent: (event) => {
          if (generation === this.liveGeneration) this.handleLiveEvent(event);
        },
        onStatus: (status) => {
          if (generation !== this.liveGeneration) return;
          const prior = this.state.connectionState;
          this.state.connectionState = status?.state || "unknown";
          if (status?.source && ["live", "polling"].includes(status.state)) this.state.source = status.source;
          this.publishConnectionState();
          if (status?.state === "live" && ["reconnecting", "degraded", "paused_hidden"].includes(prior)) this.reconcileAfterReconnect(request);
        },
      });
    } catch (error) {
      this.state.connectionState = "degraded";
      this.state.message = error instanceof Error ? error.message : "Live chart subscription unavailable.";
      this.paintState();
    }
  }

  async reconcileAfterReconnect(request) {
    try {
      const { response, payload } = await this.fetchPayload(request, { limit: 3 });
      if (!response.ok || !payload?.ok) return;
      this.acceptProviderTransition(payload);
      for (const candle of normalizeCandles(payload.candles)) this.applyCandle(candle);
      this.state.marketState = { ...this.state.marketState, ...(payload.market_state || {}) };
      document.dispatchEvent(new CustomEvent("ravenos:chartresync", { detail: { instrumentId: this.state.instrument?.canonical_id, state: "completed" } }));
    } catch {
      this.state.connectionState = "degraded";
      this.paintState();
    }
  }

  acceptProviderTransition(payload = {}) {
    const currentInstrument = this.state.instrument?.canonical_id || null;
    const nextInstrument = payload.instrument?.canonical_id || null;
    if (currentInstrument && nextInstrument && currentInstrument !== nextInstrument) throw new Error("chart_provider_transition_identity_mismatch");
    const currentContinuity = this.state.continuity || {};
    const nextContinuity = payload.continuity || {};
    const currentFingerprint = currentContinuity.exact_pool_fingerprint || null;
    const nextFingerprint = nextContinuity.exact_pool_fingerprint || null;
    if (currentFingerprint && nextFingerprint && currentFingerprint !== nextFingerprint) throw new Error("chart_provider_transition_pool_mismatch");
    const currentOrientation = currentContinuity.token_orientation || this.state.candleSeries?.token_orientation || null;
    const nextOrientation = nextContinuity.token_orientation || payload.candle_series?.token_orientation || null;
    if (currentOrientation && nextOrientation && currentOrientation !== nextOrientation) throw new Error("chart_provider_transition_orientation_mismatch");
    for (const field of ["selected_token_decimals", "quote_token_decimals"]) {
      const current = finite(currentContinuity[field]);
      const next = finite(nextContinuity[field]);
      if (current !== null && next !== null && current !== next) throw new Error(`chart_provider_transition_${field}_mismatch`);
    }
    if (payload.provider_selection?.transition_continuity?.state === "rejected") throw new Error("chart_provider_transition_rejected");
    const providerChanged = Boolean(
      this.state.candleSeries?.provider
      && payload.candle_series?.provider
      && this.state.candleSeries.provider !== payload.candle_series.provider
    );
    this.state.candleSeries = payload.candle_series || this.state.candleSeries;
    this.state.continuity = payload.continuity || this.state.continuity;
    this.state.derivation = payload.derivation || payload.candle_series?.derivation || this.state.derivation;
    this.state.providerSelection = payload.provider_selection || this.state.providerSelection;
    this.state.providerUsage = payload.provider_usage || this.state.providerUsage;
    this.state.marketAnatomy = payload.market_anatomy || this.state.marketAnatomy;
    if (providerChanged) this.state.providerTransitionCount = Number(this.state.providerTransitionCount || 0) + 1;
    return true;
  }

  applyCandle(value) {
    const candle = normalizeChartCandle(value);
    if (!candle) return;
    const index = this.state.candles.findIndex((row) => Number(row.time) === Number(candle.time));
    if (index >= 0) this.state.candles[index] = candle;
    else this.state.candles.push(candle);
    this.state.candles.sort((left, right) => Number(left.time) - Number(right.time));
    if (this.state.candles.length > 1200) this.state.candles.splice(0, this.state.candles.length - 1200);
    this.chartHandle?.updateCandle?.(candle);
    if (!this.inspectingCandle) this.renderCrosshair(null);
    if (this.followLive) this.chartHandle?.scrollToRealTime?.();
  }

  handleLiveEvent(event) {
    if (!event || event.instrument_id && event.instrument_id !== this.state.instrument?.canonical_id) return;
    const payload = event.payload || {};
    if (event.type === "bar.upsert") this.applyCandle(payload.candle);
    if (event.type === "trade.append") {
      this.tradeBuffer.append(payload);
    }
    if (event.type === "price.update") this.state.marketState = { ...this.state.marketState, ...payload };
    if (event.type === "funding.update") this.state.marketState = { ...this.state.marketState, funding: payload.funding };
    if (event.type === "open_interest.update") this.state.marketState = { ...this.state.marketState, open_interest: payload.open_interest };
    if (event.type === "orderbook.snapshot") this.state.orderBook = payload;
    if (event.type === "gap.detected") this.state.connectionState = "reconnecting";
    this.state.observedAt = event.observed_at || new Date().toISOString();
    this.schedulePaint();
    document.dispatchEvent(new CustomEvent("ravenos:chartevent", { detail: event }));
    if (["price.update", "orderbook.snapshot"].includes(event.type)) {
      document.dispatchEvent(new CustomEvent("ravenos:chartmarket", {
        detail: {
          instrument: this.state.instrument,
          marketState: { ...this.state.marketState },
          orderBook: this.state.orderBook,
          source: event.source,
          observedAt: this.state.observedAt,
        },
      }));
    }
  }

  stopLive(connectionState = "disconnected") {
    this.liveGeneration += 1;
    this.liveRelease?.();
    this.liveRelease = null;
    this.state.connectionState = connectionState;
  }

  destroyChart() {
    this.chartHandle?.destroy?.();
    this.chartHandle = null;
    this.chartHost.replaceChildren();
  }

  diagnostics() {
    return {
      instrument_id: this.state.instrument?.canonical_id || null,
      instrument_scope: this.state.instrumentScope,
      timeframe: this.state.timeframe,
      source: this.state.source,
      connection_state: this.state.connectionState,
      returned_bars: this.state.candles.length,
      backfill_count: this.state.backfillCount,
      dropped_chart_updates: this.tradeBuffer.dropped,
      chart: this.chartHandle?.measure?.() || null,
    };
  }

  destroy() {
    this.requestSequence += 1;
    this.stopLive();
    this.lastLiveRequest = null;
    this.lastLivePayload = null;
    if (this.paintFrame !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.paintFrame);
    this.paintFrame = null;
    if (this.backfillArmTimer) clearTimeout(this.backfillArmTimer);
    this.backfillArmTimer = null;
    this._clearFocus?.();
    if (this._focusKeyHandler) document.removeEventListener("keydown", this._focusKeyHandler);
    if (this._overlayPointerHandler) document.removeEventListener("pointerdown", this._overlayPointerHandler);
    if (this._overlayKeyHandler) document.removeEventListener("keydown", this._overlayKeyHandler);
    if (this._visibilityHandler) document.removeEventListener("visibilitychange", this._visibilityHandler);
    this.destroyChart();
    this.container.replaceChildren();
  }
}

export function createPriceWorkspace(container, options = {}) {
  return new PriceWorkspace(container, options);
}

window.RavenOSPriceWorkspace = Object.freeze({
  schemaVersion: RAVENOS_PRICE_WORKSPACE_SCHEMA,
  states: PRICE_WORKSPACE_STATES,
  create: createPriceWorkspace,
});
