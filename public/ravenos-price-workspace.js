import {
  BoundedEventBuffer,
  CHART_INSTRUMENT_TYPES,
  HyperliquidChartFeed,
  PollingChartFeed,
  RAVENOS_CHART_TIMEFRAMES,
  normalizeChartCandle,
  normalizeChartInstrument,
  sharedChartSubscriptions,
  timeframeSeconds,
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
const SUPPORTED_INDICATORS = Object.freeze(["ema20", "ema50", "vwap", "bb20", "rsi14", "macd"]);
const PERP_HISTORY_LIMITS = Object.freeze({
  "1m": 720,
  "5m": 720,
  "15m": 720,
  "1h": 720,
  "4h": 720,
  "1d": 720,
  "1w": 520,
  "1M": 120,
});
const INITIAL_VISIBLE_BARS = Object.freeze({
  "1m": 180,
  "5m": 144,
  "15m": 192,
  "1h": 168,
  "4h": 180,
  "1d": 180,
  "1w": 156,
  "1M": 120,
});
function historyLimit(request = {}, timeframe = "1h") {
  const requested = Math.trunc(Number(request.limit));
  if (Number.isFinite(requested) && requested >= 2) return Math.min(1000, requested);
  return request.market === "perpetuals" ? PERP_HISTORY_LIMITS[timeframe] || 720 : 240;
}

function chartRequestIdentity(request = {}) {
  const explicit = String(request.marketIdentity || request.instrumentId || "").trim().toLowerCase();
  if (explicit) return explicit;
  return [
    request.market,
    request.chain,
    request.pairAddress,
    request.tokenAddress,
    request.quoteAddress,
    request.asset,
  ].map((value) => String(value || "").trim().toLowerCase()).join(":");
}

function sameChartRequestIdentity(left = {}, right = {}) {
  const leftIdentity = chartRequestIdentity(left);
  const rightIdentity = chartRequestIdentity(right);
  return Boolean(leftIdentity && rightIdentity && leftIdentity === rightIdentity);
}

function timeSeconds(value) {
  if (typeof value === "number") return value > 10_000_000_000 ? value / 1000 : value;
  if (value && typeof value === "object" && Number.isInteger(value.year)) {
    return Date.UTC(value.year, Number(value.month || 1) - 1, Number(value.day || 1)) / 1000;
  }
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed / 1000 : null;
}

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

function primaryChartSourceLabel(value) {
  const clean = String(value || "").trim();
  if (/exact[- ](?:public[- ]?)?pool(?:\s+ohlcv)?/i.test(clean)) return "Exact pool prices";
  if (/^live perps market price$/i.test(clean)) return "Live perp prices";
  return clean || "Market prices";
}

function primaryMarketScopeLabel(instrument = {}, fallback = "") {
  const type = String(instrument?.instrument_type || "").toLowerCase();
  if (type === CHART_INSTRUMENT_TYPES.SPOT_POOL) return "This exact pool";
  if (type === CHART_INSTRUMENT_TYPES.PERPETUAL || type === "perpetual") return "This perp market";
  if ([CHART_INSTRUMENT_TYPES.EQUITY, CHART_INSTRUMENT_TYPES.ETF, "equity", "etf"].includes(type)) return "This listing";
  return String(fallback || "").trim() || "Selected market";
}

function primaryConnectionLabel(value) {
  const labels = {
    polling: "Updating",
    refreshing: "Loading timeframe",
    connecting: "Connecting",
    connected: "Live updates",
    live: "Live updates",
    snapshot_only: "Latest snapshot",
    degraded: "Updates delayed",
    disconnected: "Not connected",
  };
  const clean = String(value || "").trim().toLowerCase();
  return labels[clean] || clean.replaceAll("_", " ") || "Latest prices";
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

function latestEma(rows, period, endIndex = rows.length) {
  const closes = rows.slice(0, endIndex).map((row) => finite(row?.close)).filter((value) => value !== null);
  if (!Number.isInteger(period) || period < 2 || closes.length < period) return null;
  let value = closes.slice(0, period).reduce((sum, close) => sum + close, 0) / period;
  const multiplier = 2 / (period + 1);
  for (const close of closes.slice(period)) value = (close * multiplier) + (value * (1 - multiplier));
  return value;
}

function latestRsi(rows, period = 14) {
  if (rows.length <= period) return null;
  let averageGain = 0;
  let averageLoss = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = Number(rows[index].close) - Number(rows[index - 1].close);
    averageGain += Math.max(0, change);
    averageLoss += Math.max(0, -change);
  }
  averageGain /= period;
  averageLoss /= period;
  for (let index = period + 1; index < rows.length; index += 1) {
    const change = Number(rows[index].close) - Number(rows[index - 1].close);
    averageGain = ((averageGain * (period - 1)) + Math.max(0, change)) / period;
    averageLoss = ((averageLoss * (period - 1)) + Math.max(0, -change)) / period;
  }
  if (averageLoss === 0) return 100;
  return 100 - (100 / (1 + (averageGain / averageLoss)));
}

function latestAtr(rows, period = 14) {
  if (rows.length <= period) return null;
  const ranges = [];
  for (let index = 1; index < rows.length; index += 1) {
    const high = Number(rows[index].high);
    const low = Number(rows[index].low);
    const previousClose = Number(rows[index - 1].close);
    if (![high, low, previousClose].every(Number.isFinite)) continue;
    ranges.push(Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose)));
  }
  if (ranges.length < period) return null;
  let value = ranges.slice(0, period).reduce((sum, range) => sum + range, 0) / period;
  for (const range of ranges.slice(period)) value = ((value * (period - 1)) + range) / period;
  return value;
}

function deriveChartRead(candles = [], { instrumentId = null, timeframe = "1h" } = {}) {
  const rows = normalizeCandles(candles).slice(-160);
  if (rows.length < 55) return null;
  const latest = rows.at(-1);
  const close = finite(latest?.close);
  const ema20 = latestEma(rows, 20);
  const ema50 = latestEma(rows, 50);
  const priorEma20 = latestEma(rows, 20, rows.length - 1);
  const rsi = latestRsi(rows, 14);
  const atr = latestAtr(rows, 14);
  if (![close, ema20, ema50, priorEma20, rsi, atr].every((value) => value !== null) || !(close > 0) || !(atr > 0)) return null;

  const priorStructure = rows.slice(-21, -1);
  const priorHigh = Math.max(...priorStructure.map((row) => Number(row.high)).filter(Number.isFinite));
  const priorLow = Math.min(...priorStructure.map((row) => Number(row.low)).filter(Number.isFinite));
  const volumes = rows.slice(-21, -1).map((row) => finite(row.quote_volume ?? row.volume)).filter((value) => value !== null && value > 0);
  const latestVolume = finite(latest.quote_volume ?? latest.volume);
  const averageVolume = volumes.length ? volumes.reduce((sum, value) => sum + value, 0) / volumes.length : null;
  const volumeRatio = latestVolume !== null && averageVolume ? latestVolume / averageVolume : null;
  const body = Math.abs(Number(latest.close) - Number(latest.open));
  const longChecks = [close > ema20, ema20 > ema50, ema20 > priorEma20, rsi >= 52, close > (priorHigh + priorLow) / 2];
  const shortChecks = [close < ema20, ema20 < ema50, ema20 < priorEma20, rsi <= 48, close < (priorHigh + priorLow) / 2];
  const longScore = longChecks.filter(Boolean).length;
  const shortScore = shortChecks.filter(Boolean).length;
  const breakoutLong = close > priorHigh && (volumeRatio === null ? body >= atr * 0.75 : volumeRatio >= 1.25);
  const breakoutShort = close < priorLow && (volumeRatio === null ? body >= atr * 0.75 : volumeRatio >= 1.25);
  let direction = null;
  let setup = null;
  let score = 0;
  if (breakoutLong) {
    direction = "long";
    setup = "breakout_confirmed";
    score = Math.max(4, longScore);
  } else if (breakoutShort) {
    direction = "short";
    setup = "breakout_confirmed";
    score = Math.max(4, shortScore);
  } else if (longScore >= 4) {
    direction = "long";
    setup = "trend_aligned";
    score = longScore;
  } else if (shortScore >= 4) {
    direction = "short";
    setup = "trend_aligned";
    score = shortScore;
  }
  if (!direction || !setup) return null;

  const recent = rows.slice(-11, -1);
  const invalidation = direction === "long"
    ? Math.min(...recent.map((row) => Number(row.low)).filter(Number.isFinite))
    : Math.max(...recent.map((row) => Number(row.high)).filter(Number.isFinite));
  const riskDistance = direction === "long" ? close - invalidation : invalidation - close;
  const riskPct = riskDistance > 0 ? (riskDistance / close) * 100 : null;
  const structureMap = riskPct !== null && riskPct >= 0.15 && riskPct <= 20
    ? {
        entry_reference: close,
        invalidation_reference: invalidation,
        favorable_reference: direction === "long" ? close + (riskDistance * 2) : close - (riskDistance * 2),
        reward_risk: 2,
        risk_pct: riskPct,
      }
    : null;
  const observedSeconds = timeSeconds(latest.time);
  return {
    schema_version: "ravenos.chart_read.v1",
    state: "available",
    evidence_scope: "provider_candles_only",
    instrument_id: instrumentId,
    timeframe,
    observed_at: Number.isFinite(observedSeconds) ? new Date(observedSeconds * 1_000).toISOString() : null,
    direction,
    setup,
    score,
    score_max: 5,
    facts: {
      close,
      ema20,
      ema50,
      rsi,
      atr,
      volume_ratio: volumeRatio,
      prior_high: priorHigh,
      prior_low: priorLow,
    },
    structure_map: structureMap,
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
  return ["base", "bsc", "ethereum", "arbitrum", "optimism", "polygon", "avalanche", "robinhood"].includes(network)
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
        <span data-rpw-source>No market source selected</span>
        <span data-rpw-market>Market identity unavailable</span>
        <span data-rpw-coverage hidden></span>
        <span data-rpw-connection>Disconnected</span>
        <time data-rpw-time>Timestamp unavailable</time>
        <button type="button" data-rpw-follow aria-pressed="true">Follow live</button>
        <button type="button" data-rpw-focus aria-pressed="false" aria-label="Open chart focus mode">Focus</button>
        <button type="button" data-rpw-overlays aria-expanded="false" aria-label="Open Raven overlay controls">Raven</button>
      </header>
      <div class="rpw-quick-read" data-rpw-read-cell hidden aria-live="polite">
        <span>Raven Read</span>
        <strong data-rpw-read></strong>
        <small data-rpw-read-detail></small>
      </div>
      <div class="rpw-chart-tools">
        <label class="rpw-timeframe-picker">
          <span>Timeframe</span>
          <select data-rpw-timeframe-select aria-label="Chart timeframe"></select>
        </label>
        <button type="button" class="rpw-indicator-trigger" data-rpw-indicator-trigger aria-expanded="false">Indicators <strong data-rpw-indicator-count>1</strong></button>
        <div class="rpw-window-analytics" data-rpw-window aria-label="Selected timeframe analytics">
          <span><small data-rpw-change-label>Change</small><strong data-rpw-window-change>—</strong></span>
          <span><small data-rpw-volume-label>Volume</small><strong data-rpw-window-volume>—</strong></span>
          <span><small data-rpw-range-label>Range</small><strong data-rpw-window-range>—</strong></span>
          <button type="button" data-rpw-history aria-label="Load older price history"><small>History</small><strong data-rpw-history-label>0 bars</strong></button>
        </div>
        <div class="rpw-scope-control" data-rpw-scopes hidden aria-label="Spot chart identity scope">
          <button type="button" data-rpw-scope="exact_pool" aria-pressed="true">Exact pool</button>
          <button type="button" data-rpw-scope="token_aggregate" aria-pressed="false">Token aggregate</button>
        </div>
      </div>
      <div class="rpw-indicator-popover" data-rpw-indicators aria-label="Chart indicators" hidden>
        <header><strong>Indicators</strong><span>Calculated from exact-market candles</span></header>
        <button type="button" data-rpw-indicator="ema20" aria-pressed="true"><strong>EMA 20</strong><span>Fast trend</span></button>
        <button type="button" data-rpw-indicator="ema50" aria-pressed="false"><strong>EMA 50</strong><span>Medium trend</span></button>
        <button type="button" data-rpw-indicator="vwap" aria-pressed="false"><strong>VWAP</strong><span>Volume-weighted price</span></button>
        <button type="button" data-rpw-indicator="bb20" aria-pressed="false"><strong>Bollinger 20</strong><span>Volatility envelope</span></button>
        <button type="button" data-rpw-indicator="rsi14" aria-pressed="false"><strong>RSI 14</strong><span>Momentum pane</span></button>
        <button type="button" data-rpw-indicator="macd" aria-pressed="false"><strong>MACD</strong><span>Trend momentum pane</span></button>
      </div>
      <div class="rpw-stage">
        <div class="rpw-chart" data-rpw-chart></div>
        <div class="rpw-marker-index" data-rpw-marker-index hidden aria-label="Inspectable Raven chart markers"></div>
        <div class="rpw-watermark" data-rpw-watermark>Data unavailable</div>
        <div class="rpw-crosshair" data-rpw-crosshair hidden aria-live="polite"></div>
        <div class="rpw-coverage-note" data-rpw-coverage-note hidden aria-live="polite"></div>
        <div class="rpw-state-panel" data-rpw-state-panel>
          <strong>Market data unavailable</strong>
          <span>Select another supported market or retry the current feed.</span>
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
    this.activeIndicators = new Set((Array.isArray(options.indicators) ? options.indicators : ["ema20"])
      .filter((indicator) => SUPPORTED_INDICATORS.includes(indicator)));
    this.visibleRange = null;
    this.historyBatchLimit = 240;
    this.historyExhausted = false;
    this.chartHandle = null;
    this.chartInstrumentId = null;
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
    this.selectedMarkerKey = null;
    this.tradeBuffer = new BoundedEventBuffer(options.tradeLimit || 60);
    this.exactPoolTape = null;
    this.resetExactPoolTape();
    this.renderInput = {};
    this.state = {
      schemaVersion: RAVENOS_PRICE_WORKSPACE_SCHEMA,
      state: PRICE_WORKSPACE_STATES.DATA_UNAVAILABLE,
      source: "",
      observedAt: null,
      marketIdentity: "",
      timeframe: options.timeframe || "1h",
      candles: [],
      message: "Select a supported market.",
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
      alphaLayers: null,
      chartRead: null,
      providerTransitionCount: 0,
    };
    container.innerHTML = createMarkup();
    this.root = container.querySelector(".rpw");
    this.root.classList.toggle("rpw-fluid", options.fluidHeight === true);
    this.chartHost = container.querySelector("[data-rpw-chart]");
    this.bindTimeframes();
    this.bindIndicators();
    this.bindHistory();
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
    const select = this.container.querySelector("[data-rpw-timeframe-select]");
    if (!select) return;
    for (const timeframe of TIMEFRAMES) {
      const option = document.createElement("option");
      option.value = timeframe;
      option.textContent = timeframe;
      select.append(option);
    }
    select.value = this.state.timeframe;
    select.addEventListener("change", () => this.options.onTimeframeChange?.(select.value));
  }

  bindIndicators() {
    const host = this.container.querySelector("[data-rpw-indicators]");
    const trigger = this.container.querySelector("[data-rpw-indicator-trigger]");
    if (!host || !trigger) return;
    const paint = () => host.querySelectorAll("[data-rpw-indicator]").forEach((button) => {
      button.setAttribute("aria-pressed", this.activeIndicators.has(button.dataset.rpwIndicator) ? "true" : "false");
    });
    const paintCount = () => {
      const count = this.container.querySelector("[data-rpw-indicator-count]");
      if (count) count.textContent = String(this.activeIndicators.size);
    };
    const setOpen = (open) => {
      host.hidden = !open;
      trigger.setAttribute("aria-expanded", open ? "true" : "false");
      this.root.classList.toggle("rpw-indicators-open", open);
    };
    paint();
    paintCount();
    trigger.addEventListener("click", () => setOpen(host.hidden));
    host.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-rpw-indicator]");
      const indicator = button?.dataset?.rpwIndicator;
      if (!indicator || !SUPPORTED_INDICATORS.includes(indicator)) return;
      if (this.activeIndicators.has(indicator)) this.activeIndicators.delete(indicator);
      else this.activeIndicators.add(indicator);
      paint();
      paintCount();
      this.render({ indicators: Array.from(this.activeIndicators) });
      this.options.onIndicatorChange?.(Array.from(this.activeIndicators));
    });
    this._indicatorPointerHandler = (event) => {
      if (host.hidden || host.contains(event.target) || trigger.contains(event.target)) return;
      setOpen(false);
    };
    this._indicatorKeyHandler = (event) => {
      if (event.key !== "Escape" || host.hidden) return;
      event.preventDefault();
      setOpen(false);
      trigger.focus();
    };
    document.addEventListener("pointerdown", this._indicatorPointerHandler);
    document.addEventListener("keydown", this._indicatorKeyHandler);
  }

  bindHistory() {
    this.container.querySelector("[data-rpw-history]")?.addEventListener("click", async () => {
      await this.backfill({ manual: true });
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
    const select = this.container.querySelector("[data-rpw-timeframe-select]");
    if (select) select.value = this.state.timeframe;
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
    const label = this.state.operatorStateLabel || STATE_LABELS[this.state.state] || "Data unavailable";
    this.root.dataset.priceWorkspaceState = this.state.state;
    this.container.querySelector("[data-rpw-state]").textContent = label;
    this.container.querySelector("[data-rpw-source]").textContent = primaryChartSourceLabel(this.state.source);
    this.container.querySelector("[data-rpw-market]").textContent = primaryMarketScopeLabel(this.state.instrument, this.state.marketIdentity);
    const coverage = this.container.querySelector("[data-rpw-coverage]");
    const returnedBars = Number(this.state.returnedBars ?? this.state.candles.length);
    const sparse = returnedBars > 0 && returnedBars < 40;
    coverage.hidden = !sparse;
    coverage.textContent = sparse ? `Short history · ${returnedBars} candles` : "";
    const coverageNote = this.container.querySelector("[data-rpw-coverage-note]");
    coverageNote.hidden = !sparse;
    coverageNote.textContent = sparse
      ? `Only ${returnedBars} ${this.state.timeframe} candles are available right now. More will appear here as price history becomes available.`
      : "";
    this.container.querySelector("[data-rpw-connection]").textContent = primaryConnectionLabel(this.state.connectionState);
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
    const showPanel = ["empty", "error", "data_unavailable"].includes(this.state.state)
      || (this.state.state === "loading" && this.state.candles.length === 0);
    panel.hidden = !showPanel;
    panel.querySelector("strong").textContent = label === "Loading" ? "Loading market data" : label;
    panel.querySelector("span").textContent = this.state.message || "Current candles are not available for this market.";
    if (showPanel) this.container.querySelector("[data-rpw-crosshair]").hidden = true;
    const hasCandles = this.state.candles.length > 0 && !showPanel;
    const timeframeSelect = this.container.querySelector("[data-rpw-timeframe-select]");
    if (timeframeSelect) timeframeSelect.disabled = !hasCandles;
    const indicatorTrigger = this.container.querySelector("[data-rpw-indicator-trigger]");
    if (indicatorTrigger) indicatorTrigger.disabled = !hasCandles;
    if (!hasCandles) {
      const indicators = this.container.querySelector("[data-rpw-indicators]");
      if (indicators) indicators.hidden = true;
      indicatorTrigger?.setAttribute("aria-expanded", "false");
    }
    this.paintWindowAnalytics(this.visibleRange);
    this.paintChartRead();
    this.paintTrades();
  }

  paintChartRead() {
    const cell = this.container.querySelector("[data-rpw-read-cell]");
    const value = this.container.querySelector("[data-rpw-read]");
    const detail = this.container.querySelector("[data-rpw-read-detail]");
    if (!cell || !value || !detail) return null;
    const read = deriveChartRead(this.state.candles, {
      instrumentId: this.state.instrument?.canonical_id || null,
      timeframe: this.state.timeframe,
    });
    const showRead = this.renderInput?.showChartRead !== false;
    this.state.chartRead = read;
    cell.hidden = !read || !showRead;
    this.root.classList.toggle("rpw-has-read", Boolean(read && showRead));
    this.root.classList.toggle("rpw-read-suppressed", !showRead);
    if (read) {
      const direction = read.direction === "long" ? "↑" : "↓";
      value.textContent = `${read.setup === "breakout_confirmed" ? "Breakout" : "Trend"} ${direction} · ${read.score}/${read.score_max}`;
      value.dataset.direction = read.direction === "long" ? "up" : "down";
      const details = [
        `RSI ${read.facts.rsi.toFixed(0)}`,
        read.facts.volume_ratio === null ? "" : `volume ${read.facts.volume_ratio.toFixed(1)}× recent`,
        read.structure_map ? `structure risk ${read.structure_map.risk_pct.toFixed(1)}%` : "",
        "current price action",
      ].filter(Boolean);
      detail.textContent = details.join(" · ");
    } else {
      value.textContent = "";
      detail.textContent = "";
      value.removeAttribute("data-direction");
    }
    const fingerprint = read
      ? [read.instrument_id, read.timeframe, read.observed_at, read.direction, read.setup, read.score].join(":")
      : `none:${this.state.instrument?.canonical_id || "unselected"}:${this.state.timeframe}`;
    if (fingerprint !== this.lastChartReadFingerprint) {
      this.lastChartReadFingerprint = fingerprint;
      this.options.onChartReadChange?.(read);
      document.dispatchEvent(new CustomEvent("ravenos:chartread", { detail: read }));
    }
    return read;
  }

  paintWindowAnalytics() {
    const rows = this.state.candles;
    const host = this.container.querySelector("[data-rpw-window]");
    const change = this.container.querySelector("[data-rpw-window-change]");
    const spread = this.container.querySelector("[data-rpw-window-range]");
    const volume = this.container.querySelector("[data-rpw-window-volume]");
    const changeLabel = this.container.querySelector("[data-rpw-change-label]");
    const volumeMetricLabel = this.container.querySelector("[data-rpw-volume-label]");
    const rangeLabel = this.container.querySelector("[data-rpw-range-label]");
    const history = this.container.querySelector("[data-rpw-history]");
    const historyLabel = this.container.querySelector("[data-rpw-history-label]");
    if (!host || !change || !spread || !volume || !changeLabel || !volumeMetricLabel || !rangeLabel || !history || !historyLabel) return;
    host.hidden = rows.length === 0;
    if (!rows.length) return;

    const last = rows.at(-1);
    const changePct = last?.open > 0 && last?.close > 0 ? ((last.close / last.open) - 1) * 100 : null;
    const high = finite(last?.high);
    const low = finite(last?.low);
    const rangePct = Number.isFinite(high) && Number.isFinite(low) && low > 0 ? ((high / low) - 1) * 100 : null;
    const timeframeLabel = this.state.timeframe;
    const currentVolume = finite(last?.quote_volume ?? last?.volume);
    changeLabel.textContent = `${timeframeLabel} Change`;
    volumeMetricLabel.textContent = `${timeframeLabel} Volume`;
    rangeLabel.textContent = `${timeframeLabel} Range`;

    change.closest("span").hidden = changePct === null;
    change.textContent = changePct === null ? "" : `${changePct >= 0 ? "+" : ""}${changePct.toFixed(Math.abs(changePct) < 1 ? 2 : 1)}%`;
    change.dataset.direction = changePct === null ? "flat" : changePct > 0 ? "up" : changePct < 0 ? "down" : "flat";
    spread.closest("span").hidden = rangePct === null;
    spread.textContent = rangePct === null ? "" : `${rangePct.toFixed(rangePct < 1 ? 2 : 1)}%`;
    volume.closest("span").hidden = currentVolume === null;
    volume.textContent = currentVolume === null ? "" : volumeLabel(currentVolume);

    historyLabel.textContent = `${this.state.candles.length.toLocaleString()} candles`;
    const canBackfill = Boolean(
      this.lastRequest
      && this.state.capabilities?.older_bar_backfill === true
      && this.state.candles.length
      && !this.historyExhausted
    );
    history.disabled = this.backfillPending || !canBackfill;
    const action = history.querySelector("small");
    if (action) {
      action.textContent = this.backfillPending
        ? "Loading…"
        : this.historyExhausted
          ? "Oldest available"
          : canBackfill
            ? "Load older"
            : "All available";
    }
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
    if (!rows.length) {
      this.selectedMarkerKey = null;
      return;
    }
    const rowKey = (row, index = 0) => [
      row?.event_id || row?.id || `marker-${index}`,
      row?.instrument_id || this.state.instrument?.canonical_id || "",
      row?.type || "marker",
      row?.time || row?.startTime || "",
    ].join(":");
    const availableKeys = new Set(rows.map((row, index) => rowKey(row, index)));
    if (this.selectedMarkerKey && !availableKeys.has(this.selectedMarkerKey)) this.selectedMarkerKey = null;
    rows.forEach((row, index) => {
      const button = document.createElement("button");
      button.type = "button";
      const label = String(row.label || row.raven_read?.title || `Raven marker ${index + 1}`).slice(0, 72);
      const key = rowKey(row, index);
      const selected = key === this.selectedMarkerKey;
      button.textContent = label;
      button.title = `Inspect ${label}`;
      button.setAttribute("aria-label", `Inspect ${label}`);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
      button.dataset.markerSelected = selected ? "true" : "false";
      button.addEventListener("click", () => this.selectMarker(row, { key }));
      host.append(button);
    });
    const remaining = events.length + overlays.length - rows.length;
    if (remaining > 0) {
      const count = document.createElement("span");
      count.textContent = `+${remaining}`;
      host.append(count);
    }
  }

  selectMarker(marker, { key = null, notify = true } = {}) {
    if (!marker || typeof marker !== "object") return false;
    this.selectedMarkerKey = key || [
      marker.event_id || marker.id || "marker",
      marker.instrument_id || this.state.instrument?.canonical_id || "",
      marker.type || "marker",
      marker.time || marker.startTime || "",
    ].join(":");
    this.paintMarkerIndex();
    if (notify) this.options.onMarkerSelect?.(marker);
    return true;
  }

  clearMarkerSelection() {
    if (!this.selectedMarkerKey) return false;
    this.selectedMarkerKey = null;
    this.paintMarkerIndex();
    return true;
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
    if (extra.includeEnrichment === true) params.set("include_enrichment", "1");
    return params;
  }

  async fetchPayload(request = {}, extra = {}) {
    const response = await fetch(`${request.endpoint || "/api/terminal/chart"}?${this.requestParams(request, extra).toString()}`, { headers: { accept: "application/json" } });
    const body = await response.json().catch(() => ({}));
    return { response, payload: payloadData(body) || {} };
  }

  async load(request = {}) {
    const sequence = ++this.requestSequence;
    const timeframe = request.timeframe || this.state.timeframe || "1h";
    const priorState = { ...this.state, candles: [...this.state.candles] };
    const priorRequest = this.lastRequest ? { ...this.lastRequest } : null;
    const priorLiveRequest = this.lastLiveRequest ? { ...this.lastLiveRequest } : null;
    const priorLivePayload = this.lastLivePayload;
    const priorTradeBuffer = this.tradeBuffer;
    const priorRenderInput = { ...this.renderInput };
    const preserveChart = request.preserveChart === true
      && Boolean(this.chartHandle)
      && priorState.candles.length > 0
      && sameChartRequestIdentity(request, priorRequest || {});
    this.stopLive(preserveChart ? "refreshing" : "disconnected");
    if (!preserveChart) {
      this.lastLiveRequest = null;
      this.lastLivePayload = null;
      this.tradeBuffer = new BoundedEventBuffer(this.options.tradeLimit || 60);
    }
    this.lastRequest = { ...request, preserveChart: undefined };
    this.backfillArmed = false;
    if (this.backfillArmTimer) clearTimeout(this.backfillArmTimer);
    this.backfillArmTimer = null;
    if (!preserveChart) this.renderInput = { ...this.renderInput, events: [], overlays: [], visibleOverlayTypes: [], showChartRead: true, showRavenAnnotations: true };
    this.historyBatchLimit = historyLimit(request, timeframe);
    this.historyExhausted = false;
    if (!preserveChart) this.visibleRange = null;
    if (preserveChart) {
      this.setState({
        ...priorState,
        state: PRICE_WORKSPACE_STATES.LOADING,
        message: `Loading ${timeframe} candles. The last verified ${priorState.timeframe} chart remains visible.`,
        connectionState: "refreshing",
        pendingTimeframe: timeframe,
      });
    } else {
      this.setState({
        state: PRICE_WORKSPACE_STATES.LOADING,
        timeframe,
        source: request.source || "Market provider",
        marketIdentity: request.marketIdentity || request.asset || "",
        observedAt: null,
        candles: [],
        returnedBars: 0,
        message: "Loading current candles.",
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
        alphaLayers: null,
        marketHealth: null,
        operatorStateLabel: null,
        providerFreshnessState: null,
        candleFreshnessState: null,
        marketActivityState: null,
        lastCandleAt: null,
        lastCandleAgeSeconds: null,
        pendingTimeframe: null,
        enrichmentState: null,
        refreshError: null,
      });
    }
    const restorePreservedChart = (message) => {
      if (!preserveChart) return null;
      this.lastRequest = priorRequest;
      this.lastLiveRequest = priorLiveRequest;
      this.lastLivePayload = priorLivePayload;
      this.tradeBuffer = priorTradeBuffer;
      this.renderInput = priorRenderInput;
      const restored = this.setState({
        ...priorState,
        message: `Could not load ${timeframe}. Showing the last verified ${priorState.timeframe} chart. ${message || ""}`.trim(),
        pendingTimeframe: null,
        refreshError: `Could not load ${timeframe}. Showing the last verified ${priorState.timeframe} chart.`,
      });
      if (priorLiveRequest && priorLivePayload) this.startLive(priorLiveRequest, priorLivePayload);
      return restored;
    };
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
      const { response, payload } = await this.fetchPayload({ ...request, timeframe }, { limit: this.historyBatchLimit });
      if (sequence !== this.requestSequence) return this.state;
      const candles = normalizeCandles(payload.candles);
      if (!response.ok || !payload.ok || !candles.length) {
        const restored = restorePreservedChart(payload.message || payload.error || `Market provider returned ${response.status}.`);
        if (restored) return restored;
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
      const effectiveRavenAnnotations = ravenAnnotations;
      this.resetExactPoolTape(instrument.canonical_id, timeframe);
      const state = this.setState({
        state: cleanState(payload.freshness_state, payload.stale ? PRICE_WORKSPACE_STATES.DELAYED : PRICE_WORKSPACE_STATES.LIVE),
        timeframe,
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
        ravenAnnotations: effectiveRavenAnnotations,
        candleSeries: payload.candle_series || null,
        continuity: payload.continuity || null,
        derivation: payload.derivation || payload.candle_series?.derivation || null,
        providerSelection: payload.provider_selection || null,
        providerUsage: payload.provider_usage || null,
        marketAnatomy: payload.market_anatomy || (preserveChart ? priorState.marketAnatomy : null),
        alphaLayers: payload.alpha_layers || null,
        marketHealth: payload.market_health || (preserveChart ? priorState.marketHealth : null),
        operatorStateLabel: payload.market_health?.operator_label || (preserveChart ? priorState.operatorStateLabel : null),
        providerFreshnessState: payload.provider_freshness_state || payload.market_health?.provider_delivery_state || (preserveChart ? priorState.providerFreshnessState : null),
        candleFreshnessState: payload.candle_freshness_state || payload.market_health?.candle_recency_state || (preserveChart ? priorState.candleFreshnessState : null),
        marketActivityState: payload.market_activity_state || payload.market_health?.market_activity_state || (preserveChart ? priorState.marketActivityState : null),
        lastCandleAt: payload.last_candle_at || null,
        lastCandleAgeSeconds: finite(payload.last_candle_age_seconds),
        pendingTimeframe: null,
        enrichmentState: payload.enrichment_state || (request.market === "crypto_spot" && request.pairAddress ? "loading" : null),
        refreshError: null,
      });
      this.renderInput = {
        ...this.renderInput,
        events: this.renderInput.showRavenAnnotations === false ? [] : Array.isArray(effectiveRavenAnnotations?.events) ? effectiveRavenAnnotations.events : [],
        overlays: this.renderInput.showRavenAnnotations === false ? [] : Array.isArray(effectiveRavenAnnotations?.overlays) ? effectiveRavenAnnotations.overlays : [],
      };
      for (const trade of Array.isArray(payload.recent_trades) ? payload.recent_trades : []) this.tradeBuffer.append(trade);
      this.paintState();
      this.render(this.renderInput);
      this.startLive({ ...request, timeframe }, payload);
      if (request.market === "crypto_spot" && request.pairAddress && request.instrumentScope !== "token_aggregate") {
        void this.loadEnrichment({ ...request, timeframe }, sequence);
      }
      return state;
    } catch (error) {
      if (sequence !== this.requestSequence) return this.state;
      const restored = restorePreservedChart(error instanceof Error ? error.message : "Market provider request failed.");
      if (restored) return restored;
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

  async loadEnrichment(request = {}, sequence = this.requestSequence) {
    try {
      const { response, payload } = await this.fetchPayload(request, {
        limit: this.historyBatchLimit,
        includeEnrichment: true,
      });
      if (sequence !== this.requestSequence || !response.ok || !payload?.ok) return false;
      const instrument = normalizeChartInstrument(payload.instrument || {});
      if (payload.timeframe && String(payload.timeframe) !== String(request.timeframe || this.state.timeframe)) return false;
      if (request.expectedCanonicalId && instrument.canonical_id !== request.expectedCanonicalId) return false;
      if (!validateExpectedInstrument(instrument, request.expectedIdentity)) return false;
      this.acceptProviderTransition(payload);
      const ravenAnnotations = exactRavenAnnotations(payload.raven_annotations, instrument);
      const hasAnnotations = Boolean(ravenAnnotations);
      this.setState({
        marketState: { ...this.state.marketState, ...(payload.market_state || {}) },
        availableScopes: payload.available_scopes || this.state.availableScopes,
        ravenAnnotations: ravenAnnotations || this.state.ravenAnnotations,
        marketAnatomy: payload.market_anatomy || this.state.marketAnatomy,
        alphaLayers: payload.alpha_layers || this.state.alphaLayers,
        marketHealth: payload.market_health || this.state.marketHealth,
        operatorStateLabel: payload.market_health?.operator_label || this.state.operatorStateLabel,
        providerFreshnessState: payload.provider_freshness_state || payload.market_health?.provider_delivery_state || this.state.providerFreshnessState,
        candleFreshnessState: payload.candle_freshness_state || payload.market_health?.candle_recency_state || this.state.candleFreshnessState,
        marketActivityState: payload.market_activity_state || payload.market_health?.market_activity_state || this.state.marketActivityState,
        enrichmentState: payload.enrichment_state || "complete",
      });
      if (hasAnnotations) {
        this.renderInput = {
          ...this.renderInput,
          events: this.renderInput.showRavenAnnotations === false ? [] : Array.isArray(ravenAnnotations.events) ? ravenAnnotations.events : [],
          overlays: this.renderInput.showRavenAnnotations === false ? [] : Array.isArray(ravenAnnotations.overlays) ? ravenAnnotations.overlays : [],
        };
        this.render(this.renderInput);
      }
      document.dispatchEvent(new CustomEvent("ravenos:chartenrichment", { detail: { ...this.state } }));
      return true;
    } catch {
      if (sequence === this.requestSequence) this.setState({ enrichmentState: "unavailable" });
      return false;
    }
  }

  showUnavailable({
    message = "The exact requested market is unavailable. No substitute data was loaded.",
    marketIdentity = "",
    instrumentScope = "unselected",
    source = "No market source selected",
    timeframe = this.state.timeframe,
  } = {}) {
    ++this.requestSequence;
    this.stopLive();
    this.lastLiveRequest = null;
    this.lastLivePayload = null;
    this.tradeBuffer = new BoundedEventBuffer(this.options.tradeLimit || 60);
    this.resetExactPoolTape();
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
      alphaLayers: null,
      lineage: null,
    });
  }

  render(input = {}) {
    this.renderInput = { ...this.renderInput, ...input };
    if (this.renderInput.showRavenAnnotations === false) {
      this.renderInput = { ...this.renderInput, events: [], overlays: [], visibleOverlayTypes: [] };
    }
    this.paintChartRead();
    if (this.state.state === PRICE_WORKSPACE_STATES.LOADING && this.state.candles.length && this.chartHandle) {
      this.paintMarkerIndex();
      this.paintState();
      return this.chartHandle;
    }
    const currentInstrumentId = this.state.instrument?.canonical_id || null;
    const initialVisibleTimeRange = this.chartHandle && this.chartInstrumentId === currentInstrumentId
      ? this.chartHandle.visibleTimeRange?.() || null
      : null;
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
      initialVisibleBars: INITIAL_VISIBLE_BARS[this.state.timeframe] || 180,
      initialVisibleTimeRange,
      onCrosshairMove: (crosshair) => this.renderCrosshair(crosshair),
      onMarkerSelect: (marker) => this.selectMarker(marker),
      onVisibleLogicalRangeChange: (range) => this.handleVisibleRange(range),
    });
    this.chartInstrumentId = currentInstrumentId;
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
    this.handleVisibleRange(this.chartHandle?.visibleLogicalRange?.());
    if (this.backfillArmTimer) clearTimeout(this.backfillArmTimer);
    this.backfillArmTimer = setTimeout(() => {
      this.backfillArmTimer = null;
      this.backfillArmed = true;
    }, 750);
    return this.chartHandle;
  }

  renderCrosshair(crosshair) {
    const host = this.container.querySelector("[data-rpw-crosshair]");
    const selected = crosshair?.time && crosshair.close !== null && crosshair.close !== undefined ? crosshair : null;
    this.inspectingCandle = Boolean(selected);
    if (!selected?.time || selected.close === null || selected.close === undefined) {
      host.hidden = true;
      host.removeAttribute("data-mode");
      host.removeAttribute("aria-label");
      host.replaceChildren();
      return;
    }
    host.hidden = false;
    host.dataset.mode = "inspect";
    const change = signedPriceChange(selected.open, selected.close);
    const percent = change.percent === null ? "—" : `${change.percent >= 0 ? "+" : ""}${change.percent.toFixed(2)}%`;
    const inspectedVolume = finite(selected.volume) ?? finite(selected.quote_volume ?? selected.quoteVolume);
    const fields = [
      { label: "Time", value: crosshairTimeLabel(selected.time), field: "time" },
      { label: "Open", value: priceLabel(selected.open), field: "open" },
      { label: "Close", value: priceLabel(selected.close), field: "close" },
      { label: "High", value: priceLabel(selected.high), field: "high" },
      { label: "Low", value: priceLabel(selected.low), field: "low" },
      {
        label: "Change",
        value: percent,
        field: "change",
        tone: change.percent === null ? "neutral" : change.percent >= 0 ? "positive" : "negative",
      },
      { label: "Volume", value: volumeLabel(inspectedVolume), field: "volume" },
    ];
    host.setAttribute("aria-label", `Inspected candle, ${fields.map(({ label, value }) => `${label}: ${value}`).join(", ")}`);
    host.replaceChildren(...fields.map(({ label, value, field, tone }) => {
      const cell = document.createElement("span");
      cell.dataset.field = field;
      if (field === "time") cell.className = "rpw-crosshair-time";
      if (tone) cell.dataset.tone = tone;
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
    this.visibleRange = { from: Number(range.from), to: Number(range.to) };
    this.paintWindowAnalytics(this.visibleRange);
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

  async backfill({ manual = false } = {}) {
    if (this.backfillPending || !this.lastRequest || this.state.capabilities?.older_bar_backfill !== true || !this.state.candles.length || this.historyExhausted) return 0;
    const before = this.state.candles[0]?.time;
    if (!before) return 0;
    this.backfillPending = true;
    this.paintWindowAnalytics(this.visibleRange);
    try {
      const { response, payload } = await this.fetchPayload(this.lastRequest, { before, limit: this.historyBatchLimit });
      if (!response.ok || !payload?.ok) return 0;
      const candles = normalizeCandles(payload.candles).filter((row) => Number(row.time) < Number(before));
      if (!candles.length) {
        this.historyExhausted = true;
        return 0;
      }
      const merged = new Map([...candles, ...this.state.candles].map((row) => [String(row.time), row]));
      this.state.candles = [...merged.values()].sort((left, right) => Number(left.time) - Number(right.time));
      this.state.returnedBars = this.state.candles.length;
      this.state.backfillCount = Number(this.state.backfillCount || 0) + 1;
      this.chartHandle?.prependCandles?.(candles);
      this.paintWindowAnalytics(this.chartHandle?.visibleLogicalRange?.() || this.visibleRange);
      this.publishGeometry?.();
      document.dispatchEvent(new CustomEvent("ravenos:chartbackfill", { detail: { instrumentId: this.state.instrument?.canonical_id, added: candles.length } }));
      return candles.length;
    } finally {
      this.backfillPending = false;
      this.paintWindowAnalytics(this.visibleRange);
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

  resetExactPoolTape(instrumentId = "", timeframe = this.state?.timeframe || "1h") {
    this.exactPoolTape = {
      instrumentId: String(instrumentId || ""),
      timeframe: String(timeframe || "1h"),
      seen: new Map(),
      buckets: new Map(),
      currentPrice: null,
      currentObservedMs: null,
      lastTradeAt: null,
      applied: 0,
      rejected: 0,
    };
    return this.exactPoolTape;
  }

  exactPoolTapeIdentityMatches(projection = {}) {
    const instrument = this.state.instrument || {};
    const identity = projection.identity || {};
    const chain = String(instrument.chain || "").toLowerCase();
    if (
      instrument.instrument_type !== CHART_INSTRUMENT_TYPES.SPOT_POOL
      || instrument.identity_scope !== "exact_pool"
      || this.state.instrumentScope !== "exact_pool"
      || this.state.continuity?.state !== "verified"
      || projection.safe_public !== true
      || projection.schema_version !== "ravenos.onchain_pool_trades.v1"
      || projection.state !== "available"
      || projection.freshness?.state !== "live"
      || String(identity.chain || "").toLowerCase() !== chain
      || !sameExpectedIdentity(chain, identity.pool_address, instrument.pool_address)
      || !sameExpectedIdentity(chain, identity.token_address, instrument.token_address)
      || !identity.quote_token_address
    ) return false;
    const fingerprint = `${chain}:${identity.pool_address}:${identity.token_address}:${identity.quote_token_address}`;
    return sameExpectedIdentity(chain, this.state.continuity.exact_pool_fingerprint, fingerprint);
  }

  reconcileExactPoolTapeCandle(value) {
    const candle = normalizeChartCandle(value);
    if (!candle) return null;
    const overlay = this.exactPoolTape?.buckets?.get(Number(candle.time));
    if (!overlay) return candle;
    if (Date.now() - overlay.lastTime > 120_000) {
      this.exactPoolTape.buckets.delete(Number(candle.time));
      return candle;
    }
    return {
      ...candle,
      high: Math.max(candle.high, overlay.high),
      low: Math.min(candle.low, overlay.low),
      close: overlay.lastPrice,
      source: [candle.source, "exact_pool_trade_tape"].filter(Boolean).join("+") || "exact_pool_trade_tape",
    };
  }

  ingestExactPoolTrades(projection = {}) {
    if (!this.exactPoolTapeIdentityMatches(projection)) {
      if (this.exactPoolTape) this.exactPoolTape.rejected += 1;
      return { accepted: false, applied: 0, reason: "exact_pool_tape_identity_or_freshness_mismatch" };
    }
    const instrumentId = this.state.instrument?.canonical_id || "";
    const timeframe = this.state.timeframe || "1h";
    if (this.exactPoolTape.instrumentId !== instrumentId || this.exactPoolTape.timeframe !== timeframe) {
      this.resetExactPoolTape(instrumentId, timeframe);
    }
    const nowMs = Date.now();
    const bucketSeconds = timeframeSeconds(timeframe);
    const latestCandleTime = Number(this.state.candles.at(-1)?.time);
    const candidates = (Array.isArray(projection.trades) ? projection.trades : [])
      .map((trade) => ({
        id: String(trade?.event_id || ""),
        observedAt: String(trade?.observed_at || ""),
        observedMs: Date.parse(String(trade?.observed_at || "")),
        price: finite(trade?.price_usd),
      }))
      .filter((trade) => {
        const ageSeconds = (nowMs - trade.observedMs) / 1_000;
        return trade.id
          && Number.isFinite(trade.observedMs)
          && trade.price !== null
          && trade.price > 0
          && trade.price <= 1_000_000_000_000
          && ageSeconds >= -30
          && ageSeconds <= 120;
      })
      .sort((left, right) => left.observedMs - right.observedMs);
    const affectedBuckets = new Set();
    let applied = 0;
    for (const trade of candidates) {
      if (this.exactPoolTape.seen.has(trade.id)) continue;
      const eventSeconds = Math.trunc(trade.observedMs / 1_000);
      const bucket = Math.floor(eventSeconds / bucketSeconds) * bucketSeconds;
      if (
        !Number.isFinite(latestCandleTime)
        || bucket < latestCandleTime
      ) continue;
      // A current exact-pool trade may form the live bucket even when the slower
      // candle provider is several buckets behind. Identity and age gates above
      // remain mandatory, and the candle stays attributed to the trade tape.
      this.exactPoolTape.seen.set(trade.id, true);
      if (this.exactPoolTape.seen.size > 2_048) this.exactPoolTape.seen.delete(this.exactPoolTape.seen.keys().next().value);
      const current = this.exactPoolTape.buckets.get(bucket) || {
        time: bucket,
        firstTime: trade.observedMs,
        firstPrice: trade.price,
        lastTime: trade.observedMs,
        lastPrice: trade.price,
        high: trade.price,
        low: trade.price,
      };
      if (trade.observedMs < current.firstTime) {
        current.firstTime = trade.observedMs;
        current.firstPrice = trade.price;
      }
      if (trade.observedMs >= current.lastTime) {
        current.lastTime = trade.observedMs;
        current.lastPrice = trade.price;
      }
      current.high = Math.max(current.high, trade.price);
      current.low = Math.min(current.low, trade.price);
      this.exactPoolTape.buckets.set(bucket, current);
      affectedBuckets.add(bucket);
      applied += 1;
    }
    while (this.exactPoolTape.buckets.size > 4) this.exactPoolTape.buckets.delete(this.exactPoolTape.buckets.keys().next().value);
    for (const bucket of [...affectedBuckets].sort((left, right) => left - right)) {
      const overlay = this.exactPoolTape.buckets.get(bucket);
      const existing = this.state.candles.find((row) => Number(row.time) === bucket);
      this.applyCandle(existing || {
        time: bucket,
        open: overlay.firstPrice,
        high: overlay.high,
        low: overlay.low,
        close: overlay.lastPrice,
        volume: null,
        quote_volume: null,
        source: "exact_pool_trade_tape",
      });
    }
    const latestKnown = [...this.exactPoolTape.buckets.values()]
      .sort((left, right) => right.lastTime - left.lastTime)[0] || null;
    if (!applied || !latestKnown) {
      return {
        accepted: true,
        applied: 0,
        duplicate_only: true,
        lastPrice: latestKnown?.lastPrice ?? null,
        observedAt: latestKnown ? new Date(latestKnown.lastTime).toISOString() : null,
        instrumentId,
      };
    }
    this.exactPoolTape.applied += applied;
    const currentAdvanced = !Number.isFinite(this.exactPoolTape.currentObservedMs)
      || latestKnown.lastTime > this.exactPoolTape.currentObservedMs;
    if (currentAdvanced) {
      this.exactPoolTape.currentPrice = latestKnown.lastPrice;
      this.exactPoolTape.currentObservedMs = latestKnown.lastTime;
    }
    const currentPrice = this.exactPoolTape.currentPrice;
    const currentObservedMs = this.exactPoolTape.currentObservedMs;
    const currentObservedAt = Number.isFinite(currentObservedMs) ? new Date(currentObservedMs).toISOString() : null;
    this.exactPoolTape.lastTradeAt = currentObservedAt;
    this.state.marketState = {
      ...this.state.marketState,
      last: currentPrice,
      observed_at: currentObservedAt,
      live_price_source: "exact_pool_trade_tape",
    };
    this.state.observedAt = currentObservedAt;
    this.state.lastCandleAt = currentObservedAt;
    this.state.lastCandleAgeSeconds = Math.max(0, Math.round((nowMs - currentObservedMs) / 1_000));
    this.state.marketActivityState = "active";
    this.schedulePaint();
    if (currentAdvanced) {
      document.dispatchEvent(new CustomEvent("ravenos:charttape", {
        detail: {
          instrument_id: instrumentId,
          market_identity: this.state.marketIdentity,
          chain: this.state.instrument?.chain || null,
          pool_address: this.state.instrument?.pool_address || null,
          token_address: this.state.instrument?.token_address || null,
          quote_token_address: projection.identity.quote_token_address,
          timeframe,
          applied,
          last_price: currentPrice,
          observed_at: currentObservedAt,
          source: "exact_pool_trade_tape",
        },
      }));
    }
    return {
      accepted: true,
      applied,
      currentAdvanced,
      instrumentId,
      lastPrice: currentPrice,
      observedAt: currentObservedAt,
    };
  }

  applyCandle(value) {
    const candle = this.reconcileExactPoolTapeCandle(value);
    if (!candle) return;
    const index = this.state.candles.findIndex((row) => Number(row.time) === Number(candle.time));
    if (index >= 0) this.state.candles[index] = candle;
    else this.state.candles.push(candle);
    this.state.candles.sort((left, right) => Number(left.time) - Number(right.time));
    if (this.state.candles.length > 5000) this.state.candles.splice(0, this.state.candles.length - 5000);
    this.state.returnedBars = this.state.candles.length;
    this.chartHandle?.updateCandle?.(candle);
    if (!this.inspectingCandle) this.renderCrosshair(null);
    if (this.followLive) this.chartHandle?.scrollToRealTime?.();
    this.paintWindowAnalytics(this.visibleRange);
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
      exact_pool_tape: {
        instrument_id: this.exactPoolTape?.instrumentId || null,
        timeframe: this.exactPoolTape?.timeframe || null,
        applied_trades: this.exactPoolTape?.applied || 0,
        rejected_projections: this.exactPoolTape?.rejected || 0,
        tracked_buckets: this.exactPoolTape?.buckets?.size || 0,
        last_trade_at: this.exactPoolTape?.lastTradeAt || null,
        current_price: this.exactPoolTape?.currentPrice ?? null,
      },
      chart: this.chartHandle?.measure?.() || null,
    };
  }

  destroy() {
    this.requestSequence += 1;
    this.stopLive();
    this.lastLiveRequest = null;
    this.lastLivePayload = null;
    this.resetExactPoolTape();
    if (this.paintFrame !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.paintFrame);
    this.paintFrame = null;
    if (this.backfillArmTimer) clearTimeout(this.backfillArmTimer);
    this.backfillArmTimer = null;
    this._clearFocus?.();
    if (this._focusKeyHandler) document.removeEventListener("keydown", this._focusKeyHandler);
    if (this._indicatorPointerHandler) document.removeEventListener("pointerdown", this._indicatorPointerHandler);
    if (this._indicatorKeyHandler) document.removeEventListener("keydown", this._indicatorKeyHandler);
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
