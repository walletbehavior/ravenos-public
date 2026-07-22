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
  const etf = normalizeChartInstrument({
    canonicalId: "etf:nyse-arca:spy",
    instrumentType: "etf",
    chain: "none",
    venue: "nyse-arca",
    symbol: "SPY",
    quoteAsset: "USD",
  });
  assert.equal(aggregate.instrument_type, CHART_INSTRUMENT_TYPES.SPOT_TOKEN);
  assert.equal(aggregate.identity_scope, "token_aggregate");
  assert.equal(pool.instrument_type, CHART_INSTRUMENT_TYPES.SPOT_POOL);
  assert.equal(pool.identity_scope, "exact_pool");
  assert.equal(pool.pool_address, "0xPool");
  assert.equal(pool.chain, "base");
  assert.equal(perp.instrument_type, CHART_INSTRUMENT_TYPES.PERPETUAL);
  assert.equal(perp.symbol, "SOL-PERP");
  assert.equal(etf.instrument_type, CHART_INSTRUMENT_TYPES.ETF);
  assert.equal(etf.canonical_id, "etf:nyse-arca:spy");
  assert.notEqual(aggregate.canonical_id, pool.canonical_id);
});

test("exact EVM contract search discovers provider-listed chains without substituting another token", async () => {
  const originalFetch = globalThis.fetch;
  const tokenAddress = "0x230442c8133a9efb4c278b3723043444749ca08b";
  const pair = {
    chainId: "robinhood",
    dexId: "uniswap",
    pairAddress: "0x602633428507BBAA848E6D0c3127cda15eEAE6a9",
    baseToken: { address: tokenAddress, name: "The Runner", symbol: "RUNNER" },
    quoteToken: { address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", name: "WETH", symbol: "WETH" },
    priceUsd: "0.0003219",
    liquidity: { usd: 68_960.64 },
    volume: { h24: 14_200 },
    txns: { h24: { buys: 120, sells: 121 } },
  };
  const decoy = {
    ...pair,
    pairAddress: "0x1111111111111111111111111111111111111111",
    baseToken: { address: "0x9999999999999999999999999999999999999999", name: "Wrong token", symbol: "WRONG" },
  };
  try {
    globalThis.fetch = async (input) => {
      const url = String(input?.url || input);
      if (url.includes("/latest/dex/search")) return new Response(JSON.stringify({ pairs: [pair, decoy] }), { status: 200, headers: { "content-type": "application/json" } });
      if (url.includes("/tokens/v1/")) return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
      throw new Error(`Unexpected test request: ${url}`);
    };
    const response = await ravenosWorker.fetch(new Request(`https://ravenos.xyz/api/dexscreener/search?q=${tokenAddress}`), {});
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].chainId, "robinhood");
    assert.equal(body.results[0].tokenAddress.toLowerCase(), tokenAddress);
    assert.equal(body.results[0].pairAddress, pair.pairAddress);
    assert.equal(body.results[0].symbol, "RUNNER");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exact ETF chart identity survives the provider adapter and mismatches fail closed", async () => {
  const originalFetch = globalThis.fetch;
  const providerRequests = [];
  const origin = "https://origin.example/public/ravenos";
  const token = "server-only-chart-test-token";
  const env = { RAVENOS_PUBLIC_ORIGIN_URL: origin, RAVENOS_PUBLIC_ORIGIN_TOKEN: token };
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input?.url || input);
      providerRequests.push(url);
      assert.equal(url, `${origin}/instrument_chart.json?q=SPY&instrument_id=etf%3Anyse-arca%3Aspy&timeframe=1h&limit=360`);
      assert.equal(init.headers?.["x-ravenos-public-token"], token);
      const lastTime = Math.floor(Date.now() / 1_000) - 60;
      return new Response(JSON.stringify({
        ok: true,
        safe_public: true,
        redaction_policy: "aggregate_public_market_context_only",
        schema_version: "ravenos.instrument_chart.v1",
        generated_at: new Date().toISOString(),
        freshness_target_seconds: 300,
        query: "SPY",
        instrument_id: "etf:nyse-arca:spy",
        timeframe: "1h",
        provider: "Yahoo Finance",
        identity_provider: "Tradier",
        instrument: {
          schema_version: "ravenos.instrument.v1",
          instrument_id: "etf:nyse-arca:spy",
          symbol: "SPY",
          display_name: "SPDR S&P 500 ETF Trust",
          asset_class: "etf",
          instrument_type: "etf",
          identity_scope: "exact_instrument",
          venue: "nyse-arca",
          chain: "none",
          market_identity: { market_id: "SPY", listing: "NYSE Arca" },
          base_asset: { symbol: "SPY", asset_id: "SPY" },
          quote_asset: { symbol: "USD", asset_id: "USD" },
          settlement_asset: { symbol: "USD", asset_id: "USD" },
          preferred_cash_asset: { symbol: "USD", asset_id: "USD" },
          economic_numeraire: "USDC",
          chart_source: "ravenos_terminal_chart",
          market_session: { state: "unknown", timezone: "America/New_York", observed_at: null },
          capabilities: { chart: true, live_price: true, atlas_intelligence: true, raven_intelligence: false, options_summary: true, quote_preview: false, execution: false },
          route_compatibility: ["inspect"],
          account_compatibility: [],
        },
        candles: [
          { time: lastTime - 3600, open: 700, high: 702, low: 699, close: 701, volume: 100 },
          { time: lastTime, open: 701, high: 703, low: 700, close: 702, volume: 120 },
        ],
        market_data_observed_at: new Date(lastTime * 1_000).toISOString(),
        execution_boundary: { broker_connection_available: false, quote_preview_available: false, signing_available: false, submission_available: false, position_monitoring_available: false },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const response = await ravenosWorker.fetch(new Request("https://ravenos.xyz/api/terminal/chart?market=equities&asset=SPY&timeframe=1h&instrument_id=etf%3Anyse-arca%3Aspy"), env);
    assert.equal(response.status, 200);
    const body = await response.json();
    const payload = body.data || body;
    assert.equal(payload.ok, true);
    assert.equal(payload.market_identity, "etf:nyse-arca:spy");
    assert.equal(payload.instrument.canonical_id, "etf:nyse-arca:spy");
    assert.equal(payload.instrument.instrument_type, CHART_INSTRUMENT_TYPES.ETF);
    assert.equal(payload.instrument.venue, "nyse-arca");
    assert.equal(payload.candles.length, 2);
    assert.equal(providerRequests.length, 1);

    providerRequests.length = 0;
    const mismatch = await ravenosWorker.fetch(new Request("https://ravenos.xyz/api/terminal/chart?market=equities&asset=SPY&timeframe=1h&instrument_id=etf%3Anasdaq%3Aqqq"), env);
    assert.equal(mismatch.status, 200);
    const mismatchBody = await mismatch.json();
    const mismatchPayload = mismatchBody.data || mismatchBody;
    assert.equal(mismatchPayload.ok, false);
    assert.equal(mismatchPayload.source_type, "identity_mismatch");
    assert.equal(mismatchPayload.candles.length, 0);
    assert.equal(providerRequests.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
