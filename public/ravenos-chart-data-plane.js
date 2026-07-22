export const RAVENOS_CHART_INSTRUMENT_SCHEMA = "ravenos.chart_instrument.v1";
export const RAVENOS_CHART_EVENT_SCHEMA = "ravenos.chart_event.v1";
export const RAVENOS_CHART_DIAGNOSTICS_SCHEMA = "ravenos.chart_diagnostics.v1";
export const RAVENOS_CHART_CANDLE_SERIES_SCHEMA = "ravenos.chart_candle_series.v1";
export const RAVENOS_CHART_CAPABILITY_REGISTRY_SCHEMA = "ravenos.chart_capability_registry.v1";

export const CHART_INSTRUMENT_TYPES = Object.freeze({
  SPOT_TOKEN: "spot_token",
  SPOT_POOL: "spot_pool",
  PERPETUAL: "perpetual",
  EQUITY: "equity",
  ETF: "etf",
});

export const CHART_EVENT_TYPES = Object.freeze([
  "bar.upsert",
  "trade.append",
  "price.update",
  "liquidity.update",
  "orderbook.snapshot",
  "orderbook.delta",
  "funding.update",
  "open_interest.update",
  "liquidation.append",
  "raven.mark",
  "gap.detected",
  "source.changed",
  "resync.started",
  "resync.completed",
]);

export const RAVENOS_CHART_TIMEFRAMES = Object.freeze(["1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M"]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const RAVENOS_CHART_CAPABILITY_REGISTRY = deepFreeze({
  schema_version: RAVENOS_CHART_CAPABILITY_REGISTRY_SCHEMA,
  revision: "2026-07-22",
  network_aliases: {
    eth: "ethereum",
    avax: "avalanche",
    hyperliquid: "hyperliquid",
  },
  providers: {
    dexscreener: {
      responsibilities: ["discovery", "exact_market_identity", "current_pair_state"],
      base_candles: false,
    },
    coingecko_onchain: {
      responsibilities: ["historical_ohlcv", "active_view_ohlcv_updates", "liquidity", "volume"],
      base_candles: true,
      intervals: ["1m", "5m", "15m", "1h", "4h", "1d"],
      maximum_bars_per_request: 1000,
      live_mechanism: "bounded_server_poll",
    },
    hyperliquid_native: {
      responsibilities: ["historical_ohlcv", "live_ohlcv", "book", "tape", "funding", "open_interest"],
      base_candles: true,
      intervals: ["1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M"],
      live_mechanism: "venue_websocket",
    },
    atlas_listed_market: {
      responsibilities: ["exact_listing_identity", "historical_ohlcv", "market_session"],
      base_candles: true,
      intervals: ["5m", "15m", "1h", "4h", "1d", "1w", "1M"],
      live_mechanism: "bounded_server_refresh",
    },
    raven_exact_observations: {
      responsibilities: ["annotations", "events", "overlays", "intelligence"],
      base_candles: false,
    },
  },
  onchain_networks: {
    solana: {
      provider_network: "solana",
      discovery_supported: true,
      historical_candles_supported: true,
      live_candles_supported: true,
      intervals: ["1m", "5m", "15m", "1h", "4h", "1d"],
      maximum_history_bars: 1000,
      history_provider: "coingecko_onchain",
      live_provider: "coingecko_onchain",
      freshness_policy_seconds: 120,
      raven_overlay_support: true,
      route_preview_support: true,
      execution_support: false,
    },
    base: {
      provider_network: "base",
      discovery_supported: true,
      historical_candles_supported: true,
      live_candles_supported: true,
      intervals: ["1m", "5m", "15m", "1h", "4h", "1d"],
      maximum_history_bars: 1000,
      history_provider: "coingecko_onchain",
      live_provider: "coingecko_onchain",
      freshness_policy_seconds: 120,
      raven_overlay_support: true,
      route_preview_support: false,
      execution_support: false,
    },
    ethereum: {
      provider_network: "eth",
      discovery_supported: true,
      historical_candles_supported: true,
      live_candles_supported: true,
      intervals: ["1m", "5m", "15m", "1h", "4h", "1d"],
      maximum_history_bars: 1000,
      history_provider: "coingecko_onchain",
      live_provider: "coingecko_onchain",
      freshness_policy_seconds: 120,
      raven_overlay_support: true,
      route_preview_support: false,
      execution_support: false,
    },
    robinhood: {
      provider_network: null,
      discovery_supported: true,
      historical_candles_supported: false,
      live_candles_supported: false,
      intervals: [],
      maximum_history_bars: 0,
      history_provider: null,
      live_provider: null,
      freshness_policy_seconds: null,
      raven_overlay_support: false,
      route_preview_support: false,
      execution_support: false,
      unavailable_reason: "No exact-pool OHLCV provider has been verified for Robinhood Chain.",
    },
  },
});

export function resolveChartCapability({ market = "", chain = "", instrumentType = "", pairAddress = "", timeframe = "1h" } = {}) {
  const cleanMarket = text(market).toLowerCase();
  const cleanType = text(instrumentType).toLowerCase();
  const cleanTimeframe = text(timeframe, "1h");
  if (cleanMarket === "perpetuals" || cleanType === CHART_INSTRUMENT_TYPES.PERPETUAL || cleanType === "perpetual") {
    const provider = RAVENOS_CHART_CAPABILITY_REGISTRY.providers.hyperliquid_native;
    return {
      schema_version: RAVENOS_CHART_CAPABILITY_REGISTRY_SCHEMA,
      chart_ready: provider.intervals.includes(cleanTimeframe),
      exact_identity_required: true,
      historical_candles_supported: true,
      live_candles_supported: true,
      intervals: provider.intervals,
      history_provider: "hyperliquid_native",
      live_provider: "hyperliquid_native",
      raven_overlay_support: true,
      route_preview_support: true,
      execution_support: false,
    };
  }
  if (["equity", "etf"].includes(cleanType) || ["equities", "atlas"].includes(cleanMarket)) {
    const provider = RAVENOS_CHART_CAPABILITY_REGISTRY.providers.atlas_listed_market;
    return {
      schema_version: RAVENOS_CHART_CAPABILITY_REGISTRY_SCHEMA,
      chart_ready: provider.intervals.includes(cleanTimeframe),
      exact_identity_required: true,
      historical_candles_supported: true,
      live_candles_supported: false,
      intervals: provider.intervals,
      history_provider: "atlas_listed_market",
      live_provider: "atlas_listed_market",
      raven_overlay_support: true,
      route_preview_support: false,
      execution_support: false,
    };
  }
  const cleanNetwork = cleanChain(chain);
  const record = RAVENOS_CHART_CAPABILITY_REGISTRY.onchain_networks[cleanNetwork];
  if (!record) {
    return {
      schema_version: RAVENOS_CHART_CAPABILITY_REGISTRY_SCHEMA,
      chart_ready: false,
      discovery_supported: true,
      historical_candles_supported: false,
      live_candles_supported: false,
      intervals: [],
      history_provider: null,
      live_provider: null,
      raven_overlay_support: false,
      route_preview_support: false,
      execution_support: false,
      unavailable_reason: "No exact-pool chart provider has been verified for this network.",
    };
  }
  const exactIdentity = Boolean(text(pairAddress));
  const intervalSupported = record.intervals.includes(cleanTimeframe);
  return {
    schema_version: RAVENOS_CHART_CAPABILITY_REGISTRY_SCHEMA,
    ...record,
    chain: cleanNetwork,
    exact_market_id: exactIdentity ? `${record.provider_network || cleanNetwork}:${text(pairAddress)}` : null,
    chart_ready: Boolean(exactIdentity && record.historical_candles_supported && intervalSupported),
    exact_identity_required: true,
    exact_identity_available: exactIdentity,
    unavailable_reason: !exactIdentity
      ? "Select an exact pool before requesting candles."
      : !record.historical_candles_supported
        ? record.unavailable_reason || "Historical candles are unavailable for this network."
        : !intervalSupported
        ? `The exact pool provider does not support ${cleanTimeframe}.`
        : record.unavailable_reason || null,
  };
}

const HYPERLIQUID_INTERVALS = Object.freeze({
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
  "1w": "1w",
  "1M": "1M",
});

const TIMEFRAME_SECONDS = Object.freeze({
  "1m": 60,
  "3m": 180,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "2h": 7200,
  "4h": 14400,
  "8h": 28800,
  "12h": 43200,
  "1d": 86400,
  "3d": 259200,
  "1w": 604800,
  "1M": 2592000,
});

function text(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function finite(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function cleanChain(value) {
  const chain = text(value, "unknown").toLowerCase().replace(/[^a-z0-9_:-]+/g, "_");
  return RAVENOS_CHART_CAPABILITY_REGISTRY.network_aliases[chain] || chain;
}

function cleanAddress(value) {
  return text(value) || null;
}

function cleanAsset(value, fallback = "UNKNOWN") {
  return text(value, fallback).toUpperCase();
}

function cleanPrecision(value) {
  const result = Number(value);
  return Number.isInteger(result) && result >= 0 && result <= 30 ? result : null;
}

function cleanInstrumentType(value, input = {}) {
  const type = text(value).toLowerCase();
  if (Object.values(CHART_INSTRUMENT_TYPES).includes(type)) return type;
  if (type === "perp" || text(input.marketType || input.market_type).toLowerCase() === "perp") return CHART_INSTRUMENT_TYPES.PERPETUAL;
  if (input.poolAddress || input.pool_address || input.pairAddress || input.pair_address) return CHART_INSTRUMENT_TYPES.SPOT_POOL;
  return CHART_INSTRUMENT_TYPES.SPOT_TOKEN;
}

export function canonicalInstrumentId(input = {}) {
  const type = cleanInstrumentType(input.instrumentType || input.instrument_type, input);
  const chain = cleanChain(input.chain);
  const venue = text(input.venue, type === CHART_INSTRUMENT_TYPES.PERPETUAL ? chain : "unknown").toLowerCase();
  const base = cleanAsset(input.baseAsset || input.base_asset || input.symbol || input.asset);
  const quote = cleanAsset(input.quoteAsset || input.quote_asset, type === CHART_INSTRUMENT_TYPES.PERPETUAL ? "USD" : "UNKNOWN");
  const address = cleanAddress(input.poolAddress || input.pool_address || input.pairAddress || input.pair_address || input.marketAddress || input.market_address || input.tokenAddress || input.token_address || input.contractAddress || input.contract_address);
  return [type, chain, venue, base, quote, address || "aggregate"].join(":");
}

export function normalizeChartInstrument(input = {}) {
  const instrumentType = cleanInstrumentType(input.instrumentType || input.instrument_type, input);
  const chain = cleanChain(input.chain || (instrumentType === CHART_INSTRUMENT_TYPES.PERPETUAL ? "hyperliquid" : "unknown"));
  const venue = text(input.venue, instrumentType === CHART_INSTRUMENT_TYPES.PERPETUAL ? "hyperliquid" : "unknown").toLowerCase();
  const symbol = cleanAsset(input.symbol || input.asset).replace(/-PERP$/i, "");
  const baseAsset = cleanAsset(input.baseAsset || input.base_asset || symbol);
  const quoteAsset = cleanAsset(input.quoteAsset || input.quote_asset, instrumentType === CHART_INSTRUMENT_TYPES.PERPETUAL ? "USD" : "UNKNOWN");
  const tokenAddress = cleanAddress(input.tokenAddress || input.token_address || input.contractAddress || input.contract_address);
  const poolAddress = cleanAddress(input.poolAddress || input.pool_address || input.pairAddress || input.pair_address);
  const marketAddress = cleanAddress(input.marketAddress || input.market_address);
  const aggregate = instrumentType === CHART_INSTRUMENT_TYPES.SPOT_TOKEN;
  const normalized = {
    schema_version: RAVENOS_CHART_INSTRUMENT_SCHEMA,
    canonical_id: "",
    instrument_type: instrumentType,
    chain,
    venue,
    symbol: instrumentType === CHART_INSTRUMENT_TYPES.PERPETUAL ? `${symbol}-PERP` : symbol,
    base_asset: baseAsset,
    quote_asset: quoteAsset,
    token_address: tokenAddress,
    pool_address: poolAddress,
    market_address: marketAddress,
    price_precision: cleanPrecision(input.pricePrecision || input.price_precision),
    size_precision: cleanPrecision(input.sizePrecision || input.size_precision),
    identity_scope: aggregate ? "token_aggregate" : instrumentType === CHART_INSTRUMENT_TYPES.SPOT_POOL ? "exact_pool" : "venue_market",
    aggregate_token: aggregate,
    market_status: text(input.marketStatus || input.market_status, "unknown").toLowerCase(),
    raven_coverage_state: text(input.ravenCoverageState || input.raven_coverage_state, "unknown").toLowerCase(),
    provider_routing: {
      history: text(input.providerRouting?.history || input.provider_routing?.history, "unavailable"),
      live: text(input.providerRouting?.live || input.provider_routing?.live, "unavailable"),
      provider_asset: text(input.providerRouting?.providerAsset || input.provider_routing?.provider_asset || symbol),
      provider_network: text(input.providerRouting?.providerNetwork || input.provider_routing?.provider_network || chain),
    },
  };
  normalized.canonical_id = text(input.canonicalId || input.canonical_id) || canonicalInstrumentId(normalized);
  return Object.freeze(normalized);
}

export function timeframeSeconds(timeframe = "1h") {
  const requested = text(timeframe, "1h");
  const normalized = HYPERLIQUID_INTERVALS[requested] || HYPERLIQUID_INTERVALS[requested.toLowerCase()] || requested;
  return TIMEFRAME_SECONDS[normalized] || 3600;
}

export function hyperliquidInterval(timeframe = "1h") {
  const requested = text(timeframe, "1h");
  return HYPERLIQUID_INTERVALS[requested] || HYPERLIQUID_INTERVALS[requested.toLowerCase()] || "1h";
}

function epochSeconds(value) {
  const number = finite(value);
  if (number !== null) return Math.trunc(number > 10_000_000_000 ? number / 1000 : number);
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? Math.trunc(parsed / 1000) : null;
}

export function normalizeChartCandle(value = {}) {
  const time = epochSeconds(value.time ?? value.t);
  const open = finite(value.open ?? value.o);
  const high = finite(value.high ?? value.h);
  const low = finite(value.low ?? value.l);
  const close = finite(value.close ?? value.c);
  const volume = finite(value.volume ?? value.v) ?? 0;
  if (time === null || open === null || high === null || low === null || close === null || Math.min(open, high, low, close) <= 0) return null;
  return {
    time,
    open,
    high: Math.max(open, high, low, close),
    low: Math.min(open, high, low, close),
    close,
    volume: Math.max(0, volume),
    quote_volume: finite(value.quoteVolume ?? value.quote_volume),
    trade_count: finite(value.tradeCount ?? value.trade_count ?? value.n),
    source: text(value.source),
  };
}

export function chartEvent(type, input = {}) {
  if (!CHART_EVENT_TYPES.includes(type)) throw new Error(`Unsupported chart event type: ${type}`);
  return {
    schema_version: RAVENOS_CHART_EVENT_SCHEMA,
    type,
    instrument_id: text(input.instrumentId || input.instrument_id),
    source: text(input.source, "unknown"),
    source_event_id: text(input.sourceEventId || input.source_event_id) || null,
    observed_at: text(input.observedAt || input.observed_at, new Date().toISOString()),
    sequence: finite(input.sequence),
    payload: input.payload && typeof input.payload === "object" ? input.payload : {},
  };
}

export class FormingCandleAccumulator {
  constructor({ instrumentId = "", timeframe = "1h", maxSeen = 2048 } = {}) {
    this.instrumentId = text(instrumentId);
    this.timeframe = text(timeframe, "1h");
    this.bucketSeconds = timeframeSeconds(this.timeframe);
    this.maxSeen = Math.max(32, Number(maxSeen) || 2048);
    this.current = null;
    this.seen = new Map();
    this.lastEventTime = null;
    this.duplicates = 0;
    this.outOfOrder = 0;
  }

  remember(id) {
    if (!id) return true;
    if (this.seen.has(id)) {
      this.duplicates += 1;
      return false;
    }
    this.seen.set(id, true);
    if (this.seen.size > this.maxSeen) this.seen.delete(this.seen.keys().next().value);
    return true;
  }

  seed(candle) {
    const normalized = normalizeChartCandle(candle);
    if (normalized) this.current = normalized;
    return this.current;
  }

  ingestTrade(trade = {}) {
    const price = finite(trade.price ?? trade.px);
    const size = finite(trade.size ?? trade.sz) ?? 0;
    const eventTime = epochSeconds(trade.time ?? trade.timestamp);
    const sourceEventId = text(trade.id || trade.tid || trade.hash || `${eventTime}:${price}:${size}`);
    if (price === null || price <= 0 || eventTime === null || !this.remember(sourceEventId)) return null;
    if (this.lastEventTime !== null && eventTime < this.lastEventTime) this.outOfOrder += 1;
    this.lastEventTime = Math.max(this.lastEventTime ?? eventTime, eventTime);
    const bucket = Math.floor(eventTime / this.bucketSeconds) * this.bucketSeconds;
    if (!this.current || bucket > Number(this.current.time)) {
      this.current = {
        time: bucket,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: Math.max(0, size),
        quote_volume: Math.max(0, size * price),
        trade_count: 1,
        source: text(trade.source),
      };
      return { candle: { ...this.current }, rollover: true, source_event_id: sourceEventId };
    }
    if (bucket < Number(this.current.time)) return { candle: null, rollover: false, out_of_order: true, source_event_id: sourceEventId };
    this.current.high = Math.max(this.current.high, price);
    this.current.low = Math.min(this.current.low, price);
    this.current.close = price;
    this.current.volume += Math.max(0, size);
    this.current.quote_volume = (this.current.quote_volume || 0) + Math.max(0, size * price);
    this.current.trade_count = Number(this.current.trade_count || 0) + 1;
    return { candle: { ...this.current }, rollover: false, source_event_id: sourceEventId };
  }

  diagnostics() {
    return {
      instrument_id: this.instrumentId,
      timeframe: this.timeframe,
      current_bucket: this.current?.time ?? null,
      duplicate_trades: this.duplicates,
      out_of_order_trades: this.outOfOrder,
      dedupe_size: this.seen.size,
    };
  }
}

export class BoundedEventBuffer {
  constructor(limit = 80) {
    this.limit = Math.max(1, Number(limit) || 80);
    this.rows = [];
    this.dropped = 0;
  }

  append(value) {
    this.rows.push(value);
    if (this.rows.length > this.limit) {
      this.dropped += this.rows.length - this.limit;
      this.rows.splice(0, this.rows.length - this.limit);
    }
    return value;
  }

  values() {
    return [...this.rows];
  }
}

export class SharedChartSubscriptionHub {
  constructor({ maxSubscriptions = 12, idleGraceMs = 1500 } = {}) {
    this.maxSubscriptions = Math.max(1, Number(maxSubscriptions) || 12);
    this.idleGraceMs = Math.max(0, Number(idleGraceMs) || 0);
    this.entries = new Map();
    this.droppedEvents = 0;
    this.rejectedSubscriptions = 0;
  }

  subscribe(key, createFeed, listener = {}) {
    const cleanKey = text(key);
    if (!cleanKey) throw new Error("Chart subscription key is required");
    let entry = this.entries.get(cleanKey);
    if (!entry) {
      if (this.entries.size >= this.maxSubscriptions) {
        const disposable = [...this.entries.entries()].find(([, row]) => row.listeners.size === 0);
        if (disposable) {
          disposable[1].feed.stop?.();
          this.entries.delete(disposable[0]);
        }
      }
      if (this.entries.size >= this.maxSubscriptions) {
        this.rejectedSubscriptions += 1;
        throw new Error("Chart subscription limit reached");
      }
      const feed = createFeed();
      entry = { feed, listeners: new Set(), stopTimer: null, createdAt: Date.now(), events: 0 };
      this.entries.set(cleanKey, entry);
      feed.start?.(
        (event) => {
          entry.events += 1;
          for (const target of entry.listeners) {
            try { target.onEvent?.(event); } catch { this.droppedEvents += 1; }
          }
        },
        (state) => {
          for (const target of entry.listeners) {
            try { target.onStatus?.(state); } catch { this.droppedEvents += 1; }
          }
        },
      );
    }
    if (entry.stopTimer) {
      clearTimeout(entry.stopTimer);
      entry.stopTimer = null;
    }
    entry.listeners.add(listener);
    listener.onStatus?.(entry.feed.status?.() || { state: "connecting" });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.listeners.delete(listener);
      if (entry.listeners.size) return;
      const stop = () => {
        if (entry.listeners.size) return;
        entry.feed.stop?.();
        this.entries.delete(cleanKey);
      };
      if (this.idleGraceMs) entry.stopTimer = setTimeout(stop, this.idleGraceMs);
      else stop();
    };
  }

  diagnostics() {
    return {
      schema_version: RAVENOS_CHART_DIAGNOSTICS_SCHEMA,
      active_instruments: this.entries.size,
      active_viewers: [...this.entries.values()].reduce((sum, row) => sum + row.listeners.size, 0),
      shared_subscriptions: [...this.entries.values()].filter((row) => row.listeners.size > 1).length,
      dropped_updates: this.droppedEvents,
      rejected_subscriptions: this.rejectedSubscriptions,
      subscriptions: [...this.entries.entries()].map(([key, row]) => ({
        key,
        viewers: row.listeners.size,
        events: row.events,
        age_seconds: Math.round((Date.now() - row.createdAt) / 1000),
        status: row.feed.status?.() || null,
      })),
    };
  }

  destroy() {
    for (const entry of this.entries.values()) {
      if (entry.stopTimer) clearTimeout(entry.stopTimer);
      entry.feed.stop?.();
    }
    this.entries.clear();
  }
}

export class HyperliquidChartFeed {
  constructor({ instrument, timeframe = "1h", url = "wss://api.hyperliquid.xyz/ws", webSocketFactory = null, reconnectBaseMs = 1000, maxReconnectMs = 20_000 } = {}) {
    this.instrument = normalizeChartInstrument(instrument);
    this.timeframe = text(timeframe, "1h");
    this.interval = hyperliquidInterval(this.timeframe);
    this.url = url;
    this.webSocketFactory = webSocketFactory || ((endpoint) => new WebSocket(endpoint));
    this.reconnectBaseMs = Math.max(50, Number(reconnectBaseMs) || 1000);
    this.maxReconnectMs = Math.max(this.reconnectBaseMs, Number(maxReconnectMs) || 20_000);
    this.socket = null;
    this.dispatch = null;
    this.statusListener = null;
    this.state = "idle";
    this.reconnects = 0;
    this.gaps = 0;
    this.lastMessageAt = null;
    this.stopped = true;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.seenTrades = new Map();
  }

  coin() {
    return this.instrument.provider_routing.provider_asset.replace(/-PERP$/i, "") || this.instrument.base_asset;
  }

  status() {
    return {
      state: this.state,
      source: "Hyperliquid WebSocket",
      reconnects: this.reconnects,
      gaps: this.gaps,
      last_message_at: this.lastMessageAt,
    };
  }

  setState(state, extra = {}) {
    this.state = state;
    this.statusListener?.({ ...this.status(), ...extra });
  }

  emit(type, payload, sourceEventId = null) {
    this.dispatch?.(chartEvent(type, {
      instrumentId: this.instrument.canonical_id,
      source: "Hyperliquid WebSocket",
      sourceEventId,
      observedAt: new Date().toISOString(),
      payload,
    }));
  }

  start(dispatch, statusListener) {
    this.dispatch = dispatch;
    this.statusListener = statusListener;
    this.stopped = false;
    this.connect();
  }

  connect() {
    if (this.stopped) return;
    this.setState(this.reconnects ? "reconnecting" : "connecting");
    let socket;
    try {
      socket = this.webSocketFactory(this.url);
    } catch (error) {
      this.scheduleReconnect(error instanceof Error ? error.message : "websocket_factory_failed");
      return;
    }
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (socket !== this.socket || this.stopped) return;
      const subscriptions = [
        { type: "candle", coin: this.coin(), interval: this.interval },
        { type: "trades", coin: this.coin() },
        { type: "l2Book", coin: this.coin() },
        { type: "activeAssetCtx", coin: this.coin() },
      ];
      for (const subscription of subscriptions) socket.send(JSON.stringify({ method: "subscribe", subscription }));
      this.lastMessageAt = new Date().toISOString();
      this.setState("live");
      this.emit("source.changed", { state: "live", source: "Hyperliquid WebSocket" });
      this.heartbeatTimer = setInterval(() => {
        if (socket.readyState === 1) socket.send(JSON.stringify({ method: "ping" }));
      }, 30_000);
    });
    socket.addEventListener("message", (message) => this.handleMessage(message?.data));
    socket.addEventListener("error", () => this.setState("degraded", { reason: "websocket_error" }));
    socket.addEventListener("close", () => {
      if (socket !== this.socket || this.stopped) return;
      this.scheduleReconnect("websocket_closed");
    });
  }

  handleMessage(raw) {
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    this.lastMessageAt = new Date().toISOString();
    const channel = text(message?.channel);
    const data = message?.data;
    if (!channel || channel === "pong" || channel === "subscriptionResponse") return;
    if (channel === "candle") {
      const rows = Array.isArray(data) ? data : [data];
      for (const row of rows) {
        const candle = normalizeChartCandle(row);
        if (candle) this.emit("bar.upsert", { candle, interval: this.interval }, `${this.coin()}:${this.interval}:${candle.time}`);
      }
      return;
    }
    if (channel === "trades") {
      for (const [batchIndex, row] of (Array.isArray(data) ? data : []).entries()) {
        // Provider transaction hashes, participant fields, and provider trade IDs
        // are intentionally not retained or emitted into the public chart plane.
        const eventKey = [row?.time || "", this.coin(), row?.side || "", row?.px || "", row?.sz || "", batchIndex].join(":");
        if (this.seenTrades.has(eventKey)) continue;
        this.seenTrades.set(eventKey, true);
        if (this.seenTrades.size > 2048) this.seenTrades.delete(this.seenTrades.keys().next().value);
        const trade = {
          coin: this.coin(),
          side: row?.side === "B" ? "buy" : row?.side === "A" ? "sell" : "unknown",
          price: finite(row?.px),
          size: finite(row?.sz),
          time: finite(row?.time),
        };
        if (trade.price !== null && trade.size !== null && trade.time !== null) {
          this.emit("trade.append", trade, eventKey);
          this.emit("price.update", { last: trade.price, time: trade.time }, eventKey);
        }
      }
      return;
    }
    if (channel === "l2Book") {
      this.emit("orderbook.snapshot", {
        time: finite(data?.time),
        bids: (Array.isArray(data?.levels?.[0]) ? data.levels[0] : []).slice(0, 20).map((row) => ({ price: finite(row?.px), size: finite(row?.sz), orders: finite(row?.n) })),
        asks: (Array.isArray(data?.levels?.[1]) ? data.levels[1] : []).slice(0, 20).map((row) => ({ price: finite(row?.px), size: finite(row?.sz), orders: finite(row?.n) })),
      });
      return;
    }
    if (channel === "activeAssetCtx") {
      const context = data?.ctx || data || {};
      const market = {
        last: finite(context.midPx ?? context.markPx),
        mark: finite(context.markPx),
        oracle: finite(context.oraclePx),
        mid: finite(context.midPx),
        funding: finite(context.funding),
        open_interest: finite(context.openInterest),
        volume_24h: finite(context.dayNtlVlm),
        previous_day_price: finite(context.prevDayPx),
      };
      this.emit("price.update", market);
      this.emit("funding.update", { funding: market.funding });
      this.emit("open_interest.update", { open_interest: market.open_interest });
    }
  }

  scheduleReconnect(reason) {
    if (this.stopped || this.reconnectTimer) return;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.gaps += 1;
    this.emit("gap.detected", { reason, last_message_at: this.lastMessageAt });
    this.emit("resync.started", { reason });
    this.reconnects += 1;
    this.setState("reconnecting", { reason });
    const delay = Math.min(this.maxReconnectMs, this.reconnectBaseMs * (2 ** Math.min(this.reconnects - 1, 5)));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    const socket = this.socket;
    this.socket = null;
    try { socket?.close?.(); } catch { /* disposable chart connection */ }
    this.setState("closed");
  }
}

export class PollingChartFeed {
  constructor({ poll, intervalMs = 15_000, source = "Chart gateway polling", seenTradeIds = [] } = {}) {
    this.poll = poll;
    this.intervalMs = Math.max(5000, Number(intervalMs) || 15_000);
    this.source = source;
    this.timer = null;
    this.dispatch = null;
    this.statusListener = null;
    this.state = "idle";
    this.failures = 0;
    this.requests = 0;
    this.stopped = true;
    this.seenTrades = new Map((Array.isArray(seenTradeIds) ? seenTradeIds : []).filter(Boolean).map((id) => [String(id), true]));
  }

  status() {
    return { state: this.state, source: this.source, requests: this.requests, failures: this.failures };
  }

  start(dispatch, statusListener) {
    this.dispatch = dispatch;
    this.statusListener = statusListener;
    this.stopped = false;
    this.state = "polling";
    this.statusListener?.(this.status());
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  async tick() {
    if (this.stopped || typeof this.poll !== "function") return;
    this.requests += 1;
    try {
      const payload = await this.poll();
      if (this.stopped) return;
      const candles = Array.isArray(payload?.candles) ? payload.candles : [];
      const candle = normalizeChartCandle(candles[candles.length - 1]);
      if (candle) this.dispatch?.(chartEvent("bar.upsert", { instrumentId: payload?.instrument?.canonical_id, source: payload?.source_label || this.source, payload: { candle } }));
      for (const trade of Array.isArray(payload?.recent_trades) ? payload.recent_trades : []) {
        const id = text(trade?.id || trade?.source_event_id || trade?.hash || `${trade?.time || ""}:${trade?.price || ""}:${trade?.size || ""}`);
        if (!id || this.seenTrades.has(id)) continue;
        this.seenTrades.set(id, true);
        if (this.seenTrades.size > 2048) this.seenTrades.delete(this.seenTrades.keys().next().value);
        this.dispatch?.(chartEvent("trade.append", {
          instrumentId: payload?.instrument?.canonical_id,
          source: payload?.source_label || this.source,
          sourceEventId: id,
          observedAt: trade?.observed_at || payload?.observed_at,
          payload: trade,
        }));
      }
      if (payload?.market_state) this.dispatch?.(chartEvent("price.update", { instrumentId: payload?.instrument?.canonical_id, source: payload?.source_label || this.source, payload: payload.market_state }));
      this.state = payload?.freshness_state === "delayed" ? "delayed" : "live";
      this.statusListener?.(this.status());
    } catch (error) {
      this.failures += 1;
      this.state = "degraded";
      this.statusListener?.({ ...this.status(), reason: error instanceof Error ? error.message : "poll_failed" });
      if (this.failures === 1) this.dispatch?.(chartEvent("gap.detected", { source: this.source, payload: { reason: "poll_failed" } }));
    }
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.state = "closed";
    this.statusListener?.(this.status());
  }
}

export const sharedChartSubscriptions = new SharedChartSubscriptionHub();

export function getChartDataPlaneDiagnostics() {
  return sharedChartSubscriptions.diagnostics();
}

if (typeof window !== "undefined") {
  window.RavenOSChartDataPlane = Object.freeze({
    instrumentSchema: RAVENOS_CHART_INSTRUMENT_SCHEMA,
    eventSchema: RAVENOS_CHART_EVENT_SCHEMA,
    normalizeInstrument: normalizeChartInstrument,
    diagnostics: getChartDataPlaneDiagnostics,
  });
}
