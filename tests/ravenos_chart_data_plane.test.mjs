import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BoundedEventBuffer,
  CHART_INSTRUMENT_TYPES,
  FormingCandleAccumulator,
  HyperliquidChartFeed,
  PollingChartFeed,
  SharedChartSubscriptionHub,
  normalizeChartInstrument,
} from "../ravenos-chart-data-plane.js";
import ravenosWorker from "../worker.mjs";

test("canonical chart identity preserves exact-pool, aggregate-token, and perp scope", () => {
  const aggregate = normalizeChartInstrument({ chain: "solana", venue: "jupiter", symbol: "RAVEN", tokenAddress: "MintA" });
  const pool = normalizeChartInstrument({ chain: "base", venue: "uniswap_v3", symbol: "RAVEN", quoteAsset: "USDC", tokenAddress: "0xToken", pairAddress: "0xPool" });
  const perp = normalizeChartInstrument({ marketType: "perp", chain: "hyperliquid", venue: "hyperliquid", symbol: "SOL-PERP", quoteAsset: "USD" });
  assert.equal(aggregate.instrument_type, CHART_INSTRUMENT_TYPES.SPOT_TOKEN);
  assert.equal(aggregate.identity_scope, "token_aggregate");
  assert.equal(pool.instrument_type, CHART_INSTRUMENT_TYPES.SPOT_POOL);
  assert.equal(pool.identity_scope, "exact_pool");
  assert.equal(pool.pool_address, "0xPool");
  assert.equal(pool.chain, "base");
  assert.equal(perp.instrument_type, CHART_INSTRUMENT_TYPES.PERPETUAL);
  assert.equal(perp.symbol, "SOL-PERP");
  assert.notEqual(aggregate.canonical_id, pool.canonical_id);
});

test("forming candles roll over while suppressing duplicates and refusing older-bucket mutation", () => {
  const accumulator = new FormingCandleAccumulator({ instrumentId: "perpetual:hyperliquid:SOL", timeframe: "5m", maxSeen: 32 });
  const first = accumulator.ingestTrade({ id: "a", time: 1_800_000_000_000, price: 100, size: 2, source: "fixture" });
  assert.equal(first.rollover, true);
  assert.equal(first.candle.open, 100);
  const update = accumulator.ingestTrade({ id: "b", time: 1_800_000_010_000, price: 104, size: 1 });
  assert.equal(update.rollover, false);
  assert.equal(update.candle.high, 104);
  assert.equal(update.candle.volume, 3);
  assert.equal(accumulator.ingestTrade({ id: "b", time: 1_800_000_010_000, price: 104, size: 1 }), null);
  const older = accumulator.ingestTrade({ id: "c", time: 1_799_999_000_000, price: 99, size: 1 });
  assert.equal(older.out_of_order, true);
  assert.equal(accumulator.current.close, 104);
  const rollover = accumulator.ingestTrade({ id: "d", time: 1_800_000_300_000, price: 106, size: 4 });
  assert.equal(rollover.rollover, true);
  assert.equal(rollover.candle.open, 106);
  assert.equal(accumulator.diagnostics().duplicate_trades, 1);
  assert.equal(accumulator.diagnostics().out_of_order_trades, 1);
});

test("shared subscriptions fan out one feed and clean up after the final viewer", () => {
  const hub = new SharedChartSubscriptionHub({ maxSubscriptions: 2, idleGraceMs: 0 });
  let starts = 0;
  let stops = 0;
  let emit;
  const createFeed = () => ({
    start(onEvent) { starts += 1; emit = onEvent; },
    stop() { stops += 1; },
    status() { return { state: "live" }; },
  });
  const eventsA = [];
  const eventsB = [];
  const releaseA = hub.subscribe("SOL:1h", createFeed, { onEvent: (event) => eventsA.push(event) });
  const releaseB = hub.subscribe("SOL:1h", createFeed, { onEvent: (event) => eventsB.push(event) });
  emit({ type: "bar.upsert" });
  assert.equal(starts, 1);
  assert.equal(eventsA.length, 1);
  assert.equal(eventsB.length, 1);
  assert.equal(hub.diagnostics().shared_subscriptions, 1);
  releaseA();
  assert.equal(stops, 0);
  releaseB();
  assert.equal(stops, 1);
  assert.equal(hub.diagnostics().active_instruments, 0);
});

test("bounded event buffers drop oldest chart updates instead of growing without limit", () => {
  const buffer = new BoundedEventBuffer(3);
  for (let index = 0; index < 8; index += 1) buffer.append({ index });
  assert.deepEqual(buffer.values().map((row) => row.index), [5, 6, 7]);
  assert.equal(buffer.dropped, 5);
});

test("bounded polling emits newly observed spot trades once", async () => {
  const events = [];
  let polls = 0;
  const feed = new PollingChartFeed({
    intervalMs: 5_000,
    seenTradeIds: ["prior"],
    poll: async () => {
      polls += 1;
      return {
        source_label: "Raven observed swaps",
        freshness_state: "live",
        instrument: { canonical_id: "spot_token:solana:MintA" },
        candles: [{ time: 1_800_000_000, open: 1, high: 2, low: 1, close: 2, volume: 3 }],
        recent_trades: [
          { id: "prior", time: 1_800_000_001, price: 1, size: 1 },
          { id: "new", time: 1_800_000_002, price: 2, size: 2, side: "buy" },
        ],
      };
    },
  });
  feed.start((event) => events.push(event), () => {});
  await feed.tick();
  await feed.tick();
  feed.stop();
  assert.equal(polls, 2);
  assert.equal(events.filter((event) => event.type === "trade.append").length, 1);
  assert.equal(events.find((event) => event.type === "trade.append").source_event_id, "new");
});

class FakeSocket {
  constructor() {
    this.listeners = new Map();
    this.sent = [];
    this.readyState = 0;
    this.closed = false;
  }
  addEventListener(type, listener) {
    const rows = this.listeners.get(type) || [];
    rows.push(listener);
    this.listeners.set(type, rows);
  }
  emit(type, value = {}) {
    if (type === "open") this.readyState = 1;
    for (const listener of this.listeners.get(type) || []) listener(value);
  }
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.closed = true; this.readyState = 3; }
}

test("Hyperliquid adapter separates candle, trade, book, mark, oracle, funding, and OI events", () => {
  const socket = new FakeSocket();
  const events = [];
  const statuses = [];
  const feed = new HyperliquidChartFeed({
    instrument: { marketType: "perp", chain: "hyperliquid", venue: "hyperliquid", symbol: "SOL-PERP", providerRouting: { providerAsset: "SOL" } },
    timeframe: "1h",
    webSocketFactory: () => socket,
  });
  feed.start((event) => events.push(event), (status) => statuses.push(status));
  socket.emit("open");
  assert.deepEqual(socket.sent.map((row) => row.subscription.type), ["candle", "trades", "l2Book", "activeAssetCtx"]);
  socket.emit("message", { data: JSON.stringify({ channel: "candle", data: { t: 1_800_000_000_000, o: "100", h: "105", l: "99", c: "103", v: "50", n: 20 } }) });
  socket.emit("message", { data: JSON.stringify({ channel: "trades", data: [{ time: 1_800_000_000_100, tid: 7, side: "B", px: "103", sz: "2", hash: "0xabc" }] }) });
  socket.emit("message", { data: JSON.stringify({ channel: "l2Book", data: { time: 1_800_000_000_200, levels: [[{ px: "102.9", sz: "3", n: 2 }], [{ px: "103.1", sz: "4", n: 3 }]] } }) });
  socket.emit("message", { data: JSON.stringify({ channel: "activeAssetCtx", data: { coin: "SOL", ctx: { markPx: "103.05", oraclePx: "103", midPx: "103.04", funding: "0.00001", openInterest: "10000", dayNtlVlm: "5000000" } } }) });
  const types = events.map((event) => event.type);
  for (const type of ["bar.upsert", "trade.append", "orderbook.snapshot", "funding.update", "open_interest.update"]) assert.ok(types.includes(type), type);
  const priceUpdate = events.filter((event) => event.type === "price.update").at(-1);
  const tradeUpdate = events.find((event) => event.type === "trade.append");
  assert.equal(priceUpdate.payload.mark, 103.05);
  assert.equal(priceUpdate.payload.oracle, 103);
  assert.equal("hash" in tradeUpdate.payload, false);
  assert.equal("id" in tradeUpdate.payload, false);
  assert.doesNotMatch(tradeUpdate.source_event_id, /0xabc|:7(?:$|:)/);
  assert.equal(events.find((event) => event.type === "orderbook.snapshot").payload.bids[0].orders, 2);
  assert.ok(statuses.some((status) => status.state === "live"));
  feed.stop();
  assert.equal(socket.closed, true);
});

test("deployed chart contract supports bounded history, backfill, provenance, and incremental rendering", () => {
  const worker = readFileSync(new URL("../worker.mjs", import.meta.url), "utf8");
  const workspace = readFileSync(new URL("../ravenos-price-workspace.js", import.meta.url), "utf8");
  const renderer = readFileSync(new URL("../raven-price-chart.js", import.meta.url), "utf8");
  const perps = readFileSync(new URL("../perps/index.html", import.meta.url), "utf8");
  assert.match(worker, /before_timestamp/);
  assert.match(worker, /history_window/);
  assert.match(worker, /canonicalChartInstrument/);
  assert.match(worker, /instrument_scope: "exact_instrument"/);
  assert.match(workspace, /backfill\(\)/);
  assert.match(workspace, /sharedChartSubscriptions\.subscribe/);
  assert.match(renderer, /updateCandle\(value\)/);
  assert.match(renderer, /prependCandles\(values\)/);
  assert.match(perps, /id="perpsChart"/);
  assert.match(perps, /Order book/);
  assert.doesNotMatch(perps, /report_view_pending_workspace_migration/);
});

test("exact-pool provider throttling uses only an explicitly degraded verified rescue payload", async () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  const observedAt = new Date(Date.now() - 3_600_000).toISOString();
  const rescue = {
    ok: true,
    asset: "RAVEN/SOL",
    source: "GeckoTerminal",
    source_label: "Exact-pool OHLCV",
    freshness_state: "live",
    observed_at: observedAt,
    instrument: normalizeChartInstrument({
      instrumentType: "spot_pool",
      chain: "solana",
      venue: "geckoterminal",
      symbol: "RAVEN",
      pairAddress: "ExactPool",
      tokenAddress: "ExactMint",
    }),
    capabilities: { historical_bars: true, older_bar_backfill: true, live_bars: true },
    candles: [{ time: 1_800_000_000, open: 1, high: 1.1, low: 0.9, close: 1.05, volume: 10 }],
  };
  try {
    globalThis.caches = {
      default: {
        async match(request) {
          return request.url.includes("/rescue/")
            ? new Response(JSON.stringify(rescue), { headers: { "content-type": "application/json" } })
            : undefined;
        },
        async put() {},
      },
    };
    globalThis.fetch = async (input) => {
      const url = String(input?.url || input);
      if (url.includes("geckoterminal.com")) return new Response("{}", { status: 429 });
      if (url.includes("dexscreener.com")) return new Response(JSON.stringify({ pairs: [] }), { status: 200 });
      throw new Error(`Unexpected test request: ${url}`);
    };
    const response = await ravenosWorker.fetch(new Request("https://ravenos.xyz/api/terminal/chart?market=crypto_spot&asset=RAVEN%2FSOL&timeframe=1h&limit=240&chain=solana&pair_address=ExactPool&token_address=ExactMint"), {});
    assert.equal(response.status, 200);
    const body = await response.json();
    const payload = body.data || body;
    assert.equal(payload.ok, true);
    assert.equal(payload.freshness_state, "degraded");
    assert.equal(payload.cache_state, "stale_rescue");
    assert.equal(payload.stale, true);
    assert.ok(payload.age_seconds >= 3_500);
    assert.equal(payload.observed_at, observedAt);
    assert.equal(payload.instrument.identity_scope, "exact_pool");
    assert.match(payload.message, /last verified exact-pool history/i);
    assert.equal(payload.candles.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
  }
});

test("exact-pool freshness separates provider observation time from candle bucket time", async () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  const bucketSeconds = Math.floor(Date.now() / 3_600_000) * 3_600;
  const cacheWrites = [];
  try {
    globalThis.caches = {
      default: {
        async match() { return undefined; },
        async put(request) { cacheWrites.push(request.url); },
      },
    };
    globalThis.fetch = async (input) => {
      const url = String(input?.url || input);
      if (url.includes("geckoterminal.com")) {
        return new Response(JSON.stringify({ data: { attributes: { ohlcv_list: [[bucketSeconds, 1, 1.1, 0.9, 1.05, 10]] } } }), { status: 200 });
      }
      if (url.includes("dexscreener.com")) return new Response(JSON.stringify({ pairs: [] }), { status: 200 });
      throw new Error(`Unexpected test request: ${url}`);
    };
    const response = await ravenosWorker.fetch(new Request("https://ravenos.xyz/api/terminal/chart?market=crypto_spot&asset=FRESH%2FSOL&timeframe=1h&limit=240&chain=solana&pair_address=FreshPool&token_address=FreshMint"), {});
    assert.equal(response.status, 200);
    const body = await response.json();
    const payload = body.data || body;
    assert.equal(payload.freshness_state, "live");
    assert.equal(payload.age_seconds, 0);
    assert.equal(payload.last_candle_at, new Date(bucketSeconds * 1000).toISOString());
    assert.ok(Date.now() - Date.parse(payload.observed_at) < 2_000);
    assert.equal(payload.lineage.last_candle_at, payload.last_candle_at);
    assert.equal(cacheWrites.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
  }
});

test("Raven-native token aggregate remains distinct from exact-pool identity", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input?.url || input);
      if (!url.includes("ravenos-public-origin.ravenos.xyz/public/ravenos/chart.json")) throw new Error(`Unexpected test request: ${url}`);
      assert.equal(init.headers["x-ravenos-public-token"], "secret");
      assert.match(url, /instrument_scope=token_aggregate/);
      return new Response(JSON.stringify({
        schema_version: "ravenos.spot_chart_projection.v1",
        ok: true,
        chain: "solana",
        instrument_scope: "token_aggregate",
        token_address: "MintA",
        quote_address: "QuoteA",
        pair_address: null,
        market_identity: "solana:token:MintA:QuoteA",
        price_unit: "QuoteA_per_MintA",
        source: "Raven Yellowstone exact swap",
        freshness_state: "live",
        coverage: "Live",
        observed_at: new Date().toISOString(),
        available_scopes: { exact_pool: true, token_aggregate: true },
        capabilities: { historical_bars: true, older_bar_backfill: true, live_bars: true, live_trades: true, live_poll_interval_ms: 5_000 },
        market_state: { last: 2 },
        candles: [{ time: 1_800_000_000, open: 1, high: 2, low: 1, close: 2, volume: 3 }],
        recent_trades: [{ id: "sol-1", time: 1_800_000_001, price: 2, size: 3, side: "buy" }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const response = await ravenosWorker.fetch(new Request("https://ravenos.xyz/api/terminal/chart?market=crypto_spot&asset=RAVEN%2FSOL&timeframe=5m&limit=240&chain=solana&pair_address=ExactPool&token_address=MintA&quote_address=QuoteA&instrument_scope=token_aggregate"), {
      RAVENOS_SPOT_CHART_ORIGIN_TOKEN: "secret",
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    const payload = body.data || body;
    assert.equal(payload.ok, true);
    assert.equal(payload.instrument.identity_scope, "token_aggregate");
    assert.equal(payload.instrument.pool_address, null);
    assert.equal(payload.recent_trades.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("valid Raven exact-pool observations survive provider-history failure", async () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  try {
    globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };
    globalThis.fetch = async (input) => {
      const url = String(input?.url || input);
      if (url.includes("ravenos-public-origin.ravenos.xyz/public/ravenos/chart.json")) {
        return new Response(JSON.stringify({
          schema_version: "ravenos.spot_chart_projection.v1",
          ok: true,
          chain: "base",
          instrument_scope: "exact_pool",
          pair_address: "0x1111111111111111111111111111111111111111",
          token_address: "0x2222222222222222222222222222222222222222",
          quote_address: "0x3333333333333333333333333333333333333333",
          market_identity: "base:pool:0x1111111111111111111111111111111111111111",
          price_unit: "quote_per_token",
          source: "Raven EVM exact swap",
          freshness_state: "delayed",
          coverage: "Delayed",
          observed_at: new Date().toISOString(),
          available_scopes: { exact_pool: true, token_aggregate: false },
          capabilities: { historical_bars: true, older_bar_backfill: true, live_bars: true, live_trades: true, live_poll_interval_ms: 5_000 },
          candles: [{ time: 1_800_000_000, open: 1, high: 1, low: 1, close: 1, volume: 2 }],
          recent_trades: [{ id: "evm-1", time: 1_800_000_001, price: 1, size: 2, side: "buy" }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("geckoterminal.com")) return new Response("{}", { status: 429 });
      if (url.includes("dexscreener.com")) return new Response(JSON.stringify({ pairs: [] }), { status: 200 });
      throw new Error(`Unexpected test request: ${url}`);
    };
    const response = await ravenosWorker.fetch(new Request("https://ravenos.xyz/api/terminal/chart?market=crypto_spot&asset=BASE%2FWETH&timeframe=5m&limit=240&chain=base&pair_address=0x1111111111111111111111111111111111111111&token_address=0x2222222222222222222222222222222222222222&quote_address=0x3333333333333333333333333333333333333333"), {
      RAVENOS_SPOT_CHART_ORIGIN_TOKEN: "secret",
    });
    const body = await response.json();
    const payload = body.data || body;
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.source_type, "raven_native_projection");
    assert.equal(payload.provider_history_state, "unavailable");
    assert.equal(payload.instrument.identity_scope, "exact_pool");
    assert.equal(payload.recent_trades.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
  }
});
