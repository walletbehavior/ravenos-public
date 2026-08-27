import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BoundedEventBuffer,
  CHART_INSTRUMENT_TYPES,
  FormingCandleAccumulator,
  HyperliquidChartFeed,
  PollingChartFeed,
  RAVENOS_CHART_CAPABILITY_REGISTRY,
  RAVENOS_CHART_CANDLE_SERIES_SCHEMA,
  RAVENOS_TERMINAL_CHAIN_ROLLOUT,
  SharedChartSubscriptionHub,
  hyperliquidInterval,
  normalizeChartInstrument,
  resolveChartCapability,
  timeframeSeconds,
} from "../ravenos-chart-data-plane.js";
import ravenosWorker from "../worker.mjs";
import {
  RAVENOS_ONCHAIN_CHART_PROVIDER_REGISTRY,
  onchainChartProviderOrder,
  onchainProviderRuntime,
} from "../lib/onchain_chart_providers.mjs";
import {
  PRIMARY_PROVIDER_DERIVATIONS,
  auditCandleContinuity,
  compareDirectAndDerivedCandles,
  deriveCompleteCandleInterval,
  validateExactCandleIdentity,
} from "../lib/chart_continuity.mjs";

function geckoPoolIdentity({ network, pairAddress, baseAddress, quoteAddress }) {
  return {
    data: {
      id: `${network}_${pairAddress}`,
      type: "pool",
      attributes: { address: pairAddress },
      relationships: {
        base_token: { data: { id: `${network}_${baseAddress}` } },
        quote_token: { data: { id: `${network}_${quoteAddress}` } },
      },
    },
  };
}

function geckoPoolInfo({
  network,
  tokenAddress,
  quoteAddress,
  observedAt = new Date().toISOString(),
} = {}) {
  return {
    data: [{
      id: `${network}_${tokenAddress}`,
      type: "token",
      attributes: {
        address: tokenAddress,
        name: "Attention",
        symbol: "ATTN",
        decimals: 9,
        image_url: "https://assets.geckoterminal.com/token-fixture.png",
        holders: {
          count: 4_852,
          distribution_percentage: {
            top_10: "29.95",
            "11_20": "12.4593",
            "21_40": "15.1691",
            rest: "42.4216",
          },
          last_updated: observedAt,
        },
        developer_address: "private-provider-wallet-must-not-propagate",
        developer_holding_percentage: "1.74",
        mint_authority: "no",
        freeze_authority: "no",
        is_honeypot: false,
        websites: [
          "https://attention.example/",
          "https://attention.example/about",
          "https://x.com/duplicate-profile",
          "javascript:alert(1)",
          "https://127.0.0.1/private",
        ],
        twitter_handle: "attention_token",
        telegram_handle: null,
        discord_url: "https://malicious.example/not-discord",
        description: "raw provider prose must not propagate",
        gt_score: 99,
        launchpad_details: {
          completed: true,
          completed_at: observedAt,
          migrated_destination_pool_address: "private-provider-migration-must-not-propagate",
        },
      },
    }, {
      id: `${network}_${quoteAddress}`,
      type: "token",
      attributes: {
        address: quoteAddress,
        name: "USD Coin",
        symbol: "USDC",
        decimals: 6,
      },
    }],
  };
}

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
  assert.equal(pool.price_precision, null);
  assert.equal(pool.size_precision, null);
  assert.equal(perp.instrument_type, CHART_INSTRUMENT_TYPES.PERPETUAL);
  assert.equal(perp.symbol, "SOL-PERP");
  assert.equal(perp.price_precision, null);
  const precisePool = normalizeChartInstrument({
    chain: "solana",
    venue: "raydium",
    symbol: "MICRO",
    quoteAsset: "USDC",
    pairAddress: "ExactPool",
    pricePrecision: 8,
    sizePrecision: 0,
  });
  assert.equal(precisePool.price_precision, 8);
  assert.equal(precisePool.size_precision, 0);
  assert.equal(etf.instrument_type, CHART_INSTRUMENT_TYPES.ETF);
  assert.equal(etf.canonical_id, "etf:nyse-arca:spy");
  assert.notEqual(aggregate.canonical_id, pool.canonical_id);
});

test("versioned chart capabilities distinguish discovery from exact chart coverage", () => {
  assert.equal(RAVENOS_CHART_CAPABILITY_REGISTRY.schema_version, "ravenos.chart_capability_registry.v1");
  assert.equal(RAVENOS_CHART_CAPABILITY_REGISTRY.network_aliases.eth, "ethereum");
  assert.deepEqual(RAVENOS_CHART_CAPABILITY_REGISTRY.providers.raven_exact_observations.responsibilities, ["annotations", "events", "overlays", "intelligence"]);
  assert.equal(RAVENOS_CHART_CAPABILITY_REGISTRY.providers.raven_exact_observations.base_candles, false);
  const retire = resolveChartCapability({ market: "crypto_spot", chain: "solana", instrumentType: "spot_pool", pairAddress: "ExactPool", timeframe: "15m" });
  assert.equal(retire.chart_ready, true);
  assert.equal(retire.exact_market_id, "solana:ExactPool");
  assert.equal(retire.history_provider, "dexpaprika");
  assert.equal(retire.raven_overlay_support, true);
  const unresolved = resolveChartCapability({ market: "crypto_spot", chain: "solana", instrumentType: "spot_pool", timeframe: "15m" });
  assert.equal(unresolved.chart_ready, false);
  assert.match(unresolved.unavailable_reason, /exact pool/i);
  const robinhood = resolveChartCapability({ market: "crypto_spot", chain: "robinhood", instrumentType: "spot_pool", pairAddress: "0xPool", timeframe: "15m" });
  assert.equal(robinhood.discovery_supported, true);
  assert.equal(robinhood.chart_ready, true);
  assert.equal(robinhood.chart_request_supported, true);
  assert.equal(robinhood.advertised_chart_ready, false);
  assert.equal(robinhood.exact_market_verification, "probe_required");
  assert.equal(robinhood.history_provider, "coingecko_onchain");
  assert.equal(robinhood.provider_network, "robinhood");
  const robinhoodViaCoinGecko = resolveChartCapability({
    market: "crypto_spot",
    chain: "robinhood",
    instrumentType: "spot_pool",
    pairAddress: "0xPool",
    timeframe: "15m",
    providerId: "coingecko_onchain",
  });
  assert.equal(robinhoodViaCoinGecko.chart_ready, true);
  assert.equal(robinhoodViaCoinGecko.chart_request_supported, true);
  assert.equal(robinhoodViaCoinGecko.history_provider, "coingecko_onchain");
  assert.equal(robinhoodViaCoinGecko.provider_network, "robinhood");
  const listed = resolveChartCapability({ market: "equities", instrumentType: "etf", timeframe: "1h" });
  assert.equal(listed.chart_ready, false);
  assert.equal(listed.chart_request_supported, false);
  assert.equal(listed.historical_candles_supported, false);
  assert.equal(listed.history_provider, null);
  assert.match(listed.refusal_reason, /commercial_public_display_rights/);
  assert.deepEqual(RAVENOS_TERMINAL_CHAIN_ROLLOUT.current.map((row) => row.chain), ["hyperliquid", "solana", "bsc", "base", "ethereum", "robinhood"]);
  assert.equal(RAVENOS_TERMINAL_CHAIN_ROLLOUT.current.every((row) => row.signing === false && row.submission === false), true);
  assert.deepEqual(RAVENOS_TERMINAL_CHAIN_ROLLOUT.next_adapter_cohorts[0].chains, ["arbitrum", "polygon", "avalanche", "optimism"]);
  assert.equal(RAVENOS_TERMINAL_CHAIN_ROLLOUT.long_tail_lookup.signing_never_inferred_from_lookup, true);
  const longTail = resolveChartCapability({ market: "crypto_spot", chain: "arbitrum", instrumentType: "spot_pool", pairAddress: "0xPool", timeframe: "15m" });
  assert.equal(longTail.discovery_supported, true);
  assert.equal(longTail.chart_request_supported, false);
  assert.equal(longTail.trading_state, "lookup_only");
});

test("on-chain provider selection is explicit and not inferred from a CoinGecko key", () => {
  assert.equal(RAVENOS_ONCHAIN_CHART_PROVIDER_REGISTRY.schema_version, "ravenos.onchain_chart_provider_registry.v1");
  assert.deepEqual(RAVENOS_ONCHAIN_CHART_PROVIDER_REGISTRY.required_release_intervals, ["1m", "5m", "15m", "1h", "4h", "1d"]);
  assert.equal(RAVENOS_ONCHAIN_CHART_PROVIDER_REGISTRY.one_minute_policy.required_for_every_advertised_chart_ready_market, true);
  assert.equal(RAVENOS_ONCHAIN_CHART_PROVIDER_REGISTRY.one_minute_policy.subminute_derivation, false);
  assert.deepEqual(onchainChartProviderOrder({ COINGECKO_PRO_API_KEY: "present-but-not-authoritative" }), ["dexpaprika", "coingecko_onchain"]);
  assert.deepEqual(onchainChartProviderOrder({ ONCHAIN_CHART_PROVIDER: "coingecko" }), ["coingecko_onchain"]);
  assert.deepEqual(onchainChartProviderOrder({ RAVENOS_ONCHAIN_CHART_PROVIDER_ORDER: "coingecko_onchain,dexpaprika" }), ["coingecko_onchain", "dexpaprika"]);
  assert.equal(RAVENOS_ONCHAIN_CHART_PROVIDER_REGISTRY.production_promotion_eligible, false);
});

test("only bake-off-qualified same-provider interval derivations are enabled", () => {
  assert.deepEqual(PRIMARY_PROVIDER_DERIVATIONS, {
    "15m": { source_interval: "5m", expected_source_bars: 3 },
    "1h": { source_interval: "15m", expected_source_bars: 4 },
    "4h": { source_interval: "1h", expected_source_bars: 4 },
    "1d": { source_interval: "1h", expected_source_bars: 24 },
  });
  assert.equal(PRIMARY_PROVIDER_DERIVATIONS["5m"], undefined);
  assert.throws(() => deriveCompleteCandleInterval([], { sourceInterval: "1m", targetInterval: "5m" }), /unsupported_candle_derivation/);
});

test("deterministic aggregation uses complete buckets, sums volume, and never fills history gaps", () => {
  const start = 1_800_000_000;
  const rows = Array.from({ length: 6 }, (_, index) => ({
    time: start + index * 300,
    open: 10 + index,
    high: 11 + index,
    low: 9 + index,
    close: 11 + index,
    volume: 100 + index,
  }));
  const derived = deriveCompleteCandleInterval(rows, {
    sourceInterval: "5m",
    targetInterval: "15m",
    maxItems: 20,
    windowEndSeconds: start + 3_600,
    allowFormingCurrentBucket: false,
  });
  assert.equal(derived.state, "verified");
  assert.equal(derived.candles.length, 2);
  assert.deepEqual(derived.candles[0], {
    time: start,
    open: 10,
    high: 13,
    low: 9,
    close: 13,
    volume: 303,
    forming: false,
    source_bar_count: 3,
  });
  const incomplete = deriveCompleteCandleInterval(rows.filter((_, index) => index !== 1), {
    sourceInterval: "5m",
    targetInterval: "15m",
    maxItems: 20,
    windowEndSeconds: start + 3_600,
    allowFormingCurrentBucket: false,
  });
  assert.equal(incomplete.candles.length, 1);
  assert.equal(incomplete.dropped_incomplete_buckets, 1);
  assert.equal(incomplete.missing_buckets_filled, 0);
  assert.equal(incomplete.interpolation_used, false);
});

test("forming derived buckets require contiguous source bars from the bucket boundary", () => {
  const currentBucket = Math.floor(1_800_003_700 / 3_600) * 3_600;
  const contiguous = Array.from({ length: 2 }, (_, index) => ({
    time: currentBucket + index * 900,
    open: 20 + index,
    high: 21 + index,
    low: 19 + index,
    close: 20.5 + index,
    volume: 10,
  }));
  const accepted = deriveCompleteCandleInterval(contiguous, {
    sourceInterval: "15m",
    targetInterval: "1h",
    windowEndSeconds: currentBucket + 1_900,
  });
  assert.equal(accepted.forming_buckets, 1);
  assert.equal(accepted.candles[0].forming, true);
  const rejected = deriveCompleteCandleInterval(contiguous.slice(1), {
    sourceInterval: "15m",
    targetInterval: "1h",
    windowEndSeconds: currentBucket + 1_900,
  });
  assert.equal(rejected.candles.length, 0);
  assert.equal(rejected.dropped_incomplete_buckets, 1);
});

test("candle and exact-market continuity reject conflicting duplicates, orientation, decimals, and volume drift", () => {
  const candle = { time: 1_800_000_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 };
  const audit = auditCandleContinuity([candle, { ...candle, close: 1.6 }], { interval: "15m" });
  assert.equal(audit.state, "rejected");
  assert.equal(audit.conflicting_duplicates, 1);
  const expected = { chain: "base", pool_address: "0xPool", selected_token_address: "0xBase", quote_token_address: "0xQuote", orientation: "selected_token_usd", selected_token_decimals: 18, quote_token_decimals: 6 };
  assert.equal(validateExactCandleIdentity({ expected, actual: { ...expected } }).state, "verified");
  assert.equal(validateExactCandleIdentity({ expected, actual: { ...expected, orientation: "quote_token_usd" } }).state, "rejected");
  assert.equal(validateExactCandleIdentity({ expected, actual: { ...expected, selected_token_decimals: 8 } }).state, "identity_verified_decimals_unavailable");
  assert.equal(compareDirectAndDerivedCandles([candle], [{ ...candle }], { interval: "15m" }).state, "verified");
  assert.equal(compareDirectAndDerivedCandles([candle], [{ ...candle, volume: 20 }], { interval: "15m" }).state, "rejected");
});

test("release-enforced on-chain chart capacity forbids the keyless GeckoTerminal runtime", () => {
  const applicationBlocked = onchainProviderRuntime("coingecko_onchain", {});
  assert.equal(applicationBlocked.runtime_allowed, false);
  assert.equal(applicationBlocked.runtime_block_reason, "keyless_geckoterminal_application_fallback_forbidden");
  const diagnostic = onchainProviderRuntime("coingecko_onchain", { RAVENOS_ALLOW_KEYLESS_GECKOTERMINAL_DIAGNOSTIC: "1" });
  assert.equal(diagnostic.runtime_allowed, true);
  assert.equal(diagnostic.provider_tier, "geckoterminal_keyless_diagnostic");
  const blocked = onchainProviderRuntime("coingecko_onchain", {
    RAVENOS_RELEASE_ENFORCE: "1",
    RAVENOS_ALLOW_KEYLESS_GECKOTERMINAL_DIAGNOSTIC: "1",
  });
  assert.equal(blocked.runtime_allowed, false);
  assert.equal(blocked.runtime_block_reason, "keyless_geckoterminal_forbidden_in_release");
  assert.equal(blocked.base_url, "https://api.geckoterminal.com/api/v2");
  const demo = onchainProviderRuntime("coingecko_onchain", {
    RAVENOS_RELEASE_ENFORCE: "1",
    ONCHAIN_CHART_PROVIDER: "coingecko",
    ONCHAIN_CHART_PROVIDER_PLAN: "demo",
    ONCHAIN_CHART_PROVIDER_COMMERCIAL: "false",
    ONCHAIN_CHART_PROVIDER_SECRET: "server-only-demo-test-value",
  });
  assert.equal(demo.runtime_allowed, true);
  assert.equal(demo.provider_tier, "coingecko_demo");
  assert.equal(demo.base_url, "https://api.coingecko.com/api/v3/onchain");
  assert.equal(demo.request_headers["x-cg-demo-api-key"], "server-only-demo-test-value");
  assert.equal(demo.commercial_state, "noncommercial_evaluation");
  assert.equal(demo.attribution_label, "Data provided by CoinGecko");
  assert.equal(demo.attribution_url, "https://www.coingecko.com/");
  const qualified = onchainProviderRuntime("coingecko_onchain", {
    RAVENOS_RELEASE_ENFORCE: "1",
    ONCHAIN_CHART_PROVIDER: "coingecko",
    ONCHAIN_CHART_PROVIDER_PLAN: "basic",
    ONCHAIN_CHART_PROVIDER_COMMERCIAL: "true",
    ONCHAIN_CHART_PROVIDER_SECRET: "server-only-test-value",
  });
  assert.equal(qualified.runtime_allowed, true);
  assert.equal(qualified.provider_tier, "coingecko_basic");
  assert.equal(qualified.base_url, "https://pro-api.coingecko.com/api/v3/onchain");
  assert.equal(qualified.request_headers["x-cg-pro-api-key"], "server-only-test-value");
  assert.equal(qualified.commercial_configured, true);
});

test("DexPaprika normalizes exact EVM pool identity and emits bounded USD candles without raw payload leakage", async () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  const pairAddress = "0x4E962BB3889Bf030368F56810A9c96B83CB3E778";
  const normalizedPair = pairAddress.toLowerCase();
  const tokenAddress = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
  const quoteAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const latest = Math.floor(Date.now() / 900_000) * 900;
  const rows = Array.from({ length: 120 }, (_, index) => ({
    time_open: new Date((latest - ((119 - index) * 900)) * 1_000).toISOString(),
    time_close: new Date((latest - ((118 - index) * 900)) * 1_000).toISOString(),
    open: 60_000 + index,
    high: 60_020 + index,
    low: 59_980 + index,
    close: 60_010 + index,
    volume: 100 + index,
  }));
  try {
    globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input?.url || input));
      if (url.hostname === "api.dexpaprika.com" && url.pathname.endsWith("/ohlcv")) {
        assert.ok(url.pathname.includes(normalizedPair));
        assert.equal(url.searchParams.get("interval"), "15m");
        assert.equal(url.searchParams.get("inversed"), "false");
        return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.hostname === "api.dexpaprika.com") {
        assert.ok(url.pathname.endsWith(normalizedPair));
        return new Response(JSON.stringify({
          id: normalizedPair,
          chain: "base",
          dex_id: "aerodrome_v3",
          dex_name: "Aerodrome SlipStream",
          created_at: "2024-09-04T21:14:23Z",
          base_token_id: tokenAddress.toLowerCase(),
          quote_token_id: quoteAddress.toLowerCase(),
          liquidity_usd: 9_000_000,
          price_time: new Date().toISOString(),
          tokens: [
            { id: quoteAddress.toLowerCase(), symbol: "USDC", description: "must not leak" },
            { id: tokenAddress.toLowerCase(), symbol: "cbBTC", description: "must not leak" },
          ],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.hostname.includes("dexscreener.com")) return new Response(JSON.stringify({ pairs: [] }), { status: 200 });
      throw new Error(`Unexpected test request: ${url}`);
    };
    const response = await ravenosWorker.fetch(new Request(`https://ravenos.xyz/api/terminal/chart?market=crypto_spot&asset=cbBTC%2FUSDC&timeframe=15m&limit=120&chain=base&pair_address=${pairAddress}&token_address=${tokenAddress}&quote_address=${quoteAddress}`), {
      RAVENOS_ONCHAIN_CHART_PROVIDER_ORDER: "dexpaprika",
    });
    const responseText = await response.text();
    assert.equal(response.status, 200);
    assert.doesNotMatch(responseText, /must not leak/i);
    const body = JSON.parse(responseText);
    const payload = body.data || body;
    assert.equal(payload.ok, true);
    assert.equal(payload.source, "DexPaprika");
    assert.equal(payload.market_identity, `base:${normalizedPair}`);
    assert.equal(payload.pair_address, normalizedPair);
    assert.equal(payload.candles.length, 120);
    assert.equal(payload.candle_series.provider, "dexpaprika");
    assert.equal(payload.candle_series.price_currency, "USD");
    assert.equal(payload.candle_series.raven_observations_are_candles, false);
    assert.equal(payload.provider_selection.selected, "dexpaprika");
    assert.equal(payload.provider_selection.fallback, false);
    assert.equal(payload.commercial_state, "free_development_only");
    assert.equal(payload.attribution.label, "Powered by DexPaprika");
    assert.deepEqual(payload.provider_usage, {
      schema_version: "ravenos.provider_usage.v1",
      provider: "dexpaprika",
      pool: `base:${normalizedPair}`,
      interval: "15m",
      source_interval: "15m",
      cache_hit: false,
      cache_state: "miss",
      candle_mode: "direct",
      provider_request_count: 1,
      fallback_event: false,
      active_viewer_signal: 1,
      active_viewer_measurement: "request_signal_only",
      projected_cost_state: "unpriced_evaluation",
      projected_provider_requests_per_active_refresh: 1,
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
  }
});

test("DexPaprika derives a complete requested interval before attempting a secondary provider", async () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  const pairAddress = "0x1010101010101010101010101010101010101010";
  const tokenAddress = "0x2020202020202020202020202020202020202020";
  const quoteAddress = "0x3030303030303030303030303030303030303030";
  const latest = Math.floor(Date.now() / 900_000) * 900;
  const fiveMinuteStart = latest - 359 * 300;
  const sourceRows = Array.from({ length: 360 }, (_, index) => {
    const open = 1 + index / 10_000;
    const close = 1 + (index + 1) / 10_000;
    return {
      time_open: new Date((fiveMinuteStart + index * 300) * 1_000).toISOString(),
      time_close: new Date((fiveMinuteStart + (index + 1) * 300) * 1_000).toISOString(),
      open,
      high: close + 0.0001,
      low: open - 0.0001,
      close,
      volume: 10 + index,
    };
  });
  let secondaryRequests = 0;
  const requestedIntervals = [];
  try {
    globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };
    globalThis.fetch = async (input) => {
      const url = new URL(String(input?.url || input));
      if (url.hostname === "api.dexpaprika.com" && url.pathname.endsWith("/ohlcv")) {
        const interval = url.searchParams.get("interval");
        requestedIntervals.push(interval);
        return new Response(JSON.stringify(interval === "5m" ? sourceRows : sourceRows.slice(-20)), { status: 200 });
      }
      if (url.hostname === "api.dexpaprika.com") return new Response(JSON.stringify({
        id: pairAddress,
        chain: "base",
        created_at: "2024-01-01T00:00:00Z",
        base_token_id: tokenAddress,
        quote_token_id: quoteAddress,
        tokens: [
          { id: quoteAddress, symbol: "USDC", decimals: 6 },
          { id: tokenAddress, symbol: "TEST", decimals: 18 },
        ],
      }), { status: 200 });
      if (url.hostname.includes("gecko")) {
        secondaryRequests += 1;
        return new Response(JSON.stringify({ error: "must_not_be_called" }), { status: 503 });
      }
      if (url.hostname.includes("dexscreener.com")) return new Response(JSON.stringify({ pairs: [] }), { status: 200 });
      throw new Error(`Unexpected test request: ${url}`);
    };
    const response = await ravenosWorker.fetch(new Request(`https://ravenos.xyz/api/terminal/chart?market=crypto_spot&asset=TEST%2FUSDC&timeframe=15m&limit=120&chain=base&pair_address=${pairAddress}&token_address=${tokenAddress}&quote_address=${quoteAddress}`), {
      RAVENOS_ONCHAIN_CHART_PROVIDER_ORDER: "dexpaprika,coingecko_onchain",
    });
    const body = await response.json();
    const payload = body.data || body;
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.candle_series.provider, "dexpaprika");
    assert.equal(payload.derivation.state, "derived");
    assert.equal(payload.derivation.source_interval, "5m");
    assert.equal(payload.derivation.target_interval, "15m");
    assert.equal(payload.derivation.interpolation_used, false);
    assert.equal(payload.derivation.missing_buckets_filled, 0);
    assert.ok(payload.candles.length >= 100);
    assert.deepEqual(requestedIntervals, ["15m", "5m"]);
    assert.equal(secondaryRequests, 0);
    assert.equal(payload.provider_selection.fallback, false);
    assert.equal(payload.provider_usage.provider, "dexpaprika");
    assert.equal(payload.provider_usage.interval, "15m");
    assert.equal(payload.provider_usage.source_interval, "5m");
    assert.equal(payload.provider_usage.candle_mode, "derived");
    assert.equal(payload.provider_usage.provider_request_count, 2);
    assert.equal(payload.provider_usage.fallback_event, false);
    assert.equal(payload.provider_usage.active_viewer_measurement, "request_signal_only");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
  }
});

test("missing required provider volume is a candle-continuity failure, never an identity failure", async () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  const pairAddress = "0x4141414141414141414141414141414141414141";
  const tokenAddress = "0x4242424242424242424242424242424242424242";
  const quoteAddress = "0x4343434343434343434343434343434343434343";
  try {
    globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };
    globalThis.fetch = async (input) => {
      const url = new URL(String(input?.url || input));
      if (url.hostname === "api.dexpaprika.com" && url.pathname.endsWith("/ohlcv")) {
        return new Response(JSON.stringify([{
          time_open: new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString(),
          time_close: new Date((Math.floor(Date.now() / 60_000) + 1) * 60_000).toISOString(),
          open: 1,
          high: 1,
          low: 1,
          close: 1,
        }]), { status: 200 });
      }
      if (url.hostname === "api.dexpaprika.com") return new Response(JSON.stringify({
        id: pairAddress,
        chain: "base",
        base_token_id: tokenAddress,
        quote_token_id: quoteAddress,
        tokens: [
          { id: tokenAddress, symbol: "TEST", decimals: 18 },
          { id: quoteAddress, symbol: "USDC", decimals: 6 },
        ],
      }), { status: 200 });
      if (url.hostname.includes("dexscreener.com")) return new Response(JSON.stringify({ pairs: [] }), { status: 200 });
      throw new Error(`Unexpected test request: ${url}`);
    };
    const response = await ravenosWorker.fetch(new Request(`https://ravenos.xyz/api/terminal/chart?market=crypto_spot&asset=TEST%2FUSDC&timeframe=1m&limit=120&chain=base&pair_address=${pairAddress}&token_address=${tokenAddress}&quote_address=${quoteAddress}`), {
      RAVENOS_ONCHAIN_CHART_PROVIDER_ORDER: "dexpaprika",
    });
    const body = await response.json();
    const payload = body.data || body;
    assert.equal(payload.ok, false);
    assert.equal(payload.provider_state, "candle_continuity_rejected");
    assert.deepEqual(payload.provider_attempts, [{ provider: "dexpaprika", state: "candle_continuity_rejected" }]);
    assert.notEqual(payload.source_type, "identity_mismatch");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
  }
});

test("insufficient DexPaprika history falls through to the next exact-pool provider without changing identity", async () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  const pairAddress = "0x5555555555555555555555555555555555555555";
  const tokenAddress = "0x6666666666666666666666666666666666666666";
  const quoteAddress = "0x7777777777777777777777777777777777777777";
  const latest = Math.floor(Date.now() / 900_000) * 900;
  const paprikaRows = Array.from({ length: 20 }, (_, index) => ({
    time_open: new Date((latest - ((19 - index) * 900)) * 1_000).toISOString(),
    open: 1,
    high: 1.1,
    low: 0.9,
    close: 1,
    volume: 1,
  }));
  const geckoRows = Array.from({ length: 120 }, (_, index) => [latest - ((119 - index) * 900), 1, 1.1, 0.9, 1, 1]);
  try {
    globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input?.url || input);
      if (url.includes("api.dexpaprika.com") && url.includes("/ohlcv?")) return new Response(JSON.stringify(paprikaRows), { status: 200 });
      if (url.includes("api.dexpaprika.com")) return new Response(JSON.stringify({
        id: pairAddress,
        chain: "base",
        created_at: "2024-01-01T00:00:00Z",
        base_token_id: tokenAddress,
        quote_token_id: quoteAddress,
        tokens: [{ id: quoteAddress, symbol: "USDC" }, { id: tokenAddress, symbol: "TEST" }],
      }), { status: 200 });
      if (url.includes("api.coingecko.com/api/v3/onchain")) {
        assert.equal(init.headers?.["x-cg-demo-api-key"], "server-only-demo-test-value");
        if (url.includes("/ohlcv/")) return new Response(JSON.stringify({ data: { attributes: { ohlcv_list: geckoRows } } }), { status: 200 });
        return new Response(JSON.stringify(geckoPoolIdentity({ network: "base", pairAddress, baseAddress: tokenAddress, quoteAddress })), { status: 200 });
      }
      if (url.includes("dexscreener.com")) return new Response(JSON.stringify({ pairs: [] }), { status: 200 });
      throw new Error(`Unexpected test request: ${url}`);
    };
    const response = await ravenosWorker.fetch(new Request(`https://ravenos.xyz/api/terminal/chart?market=crypto_spot&asset=TEST%2FUSDC&timeframe=15m&limit=120&chain=base&pair_address=${pairAddress}&token_address=${tokenAddress}&quote_address=${quoteAddress}`), {
      ONCHAIN_CHART_PROVIDER_PLAN: "demo",
      ONCHAIN_CHART_PROVIDER_COMMERCIAL: "false",
      ONCHAIN_CHART_PROVIDER_SECRET: "server-only-demo-test-value",
    });
    const body = await response.json();
    const payload = body.data || body;
    assert.equal(payload.ok, true);
    assert.equal(payload.candle_series.provider, "coingecko_onchain");
    assert.equal(payload.pair_address, pairAddress);
    assert.equal(payload.provider_selection.fallback, true);
    assert.deepEqual(payload.provider_selection.attempted, [
      { provider: "dexpaprika", state: "insufficient_history" },
      { provider: "coingecko_onchain", state: "selected" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
  }
});

test("CoinGecko fallback verifies the selected token and quote before requesting exact-pool candles", async () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  const pairAddress = "0x1212121212121212121212121212121212121212";
  const baseAddress = "0x3434343434343434343434343434343434343434";
  const quoteAddress = "0x5656565656565656565656565656565656565656";
  let candleRequests = 0;
  try {
    globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };
    globalThis.fetch = async (input) => {
      const url = String(input?.url || input);
      if (url.includes("geckoterminal.com") && url.includes("/ohlcv/")) {
        candleRequests += 1;
        return new Response(JSON.stringify({ data: { attributes: { ohlcv_list: [] } } }), { status: 200 });
      }
      if (url.includes("geckoterminal.com")) {
        return new Response(JSON.stringify(geckoPoolIdentity({ network: "base", pairAddress, baseAddress, quoteAddress })), { status: 200 });
      }
      throw new Error(`Unexpected test request: ${url}`);
    };
    const response = await ravenosWorker.fetch(new Request(`https://ravenos.xyz/api/terminal/chart?market=crypto_spot&asset=WRONG%2FUSDC&timeframe=15m&limit=120&chain=base&pair_address=${pairAddress}&token_address=0x7878787878787878787878787878787878787878&quote_address=${quoteAddress}`), {
      RAVENOS_ONCHAIN_CHART_PROVIDER_ORDER: "coingecko_onchain",
      RAVENOS_ALLOW_KEYLESS_GECKOTERMINAL_DIAGNOSTIC: "1",
    });
    const body = await response.json();
    const payload = body.data || body;
    assert.equal(payload.ok, false);
    assert.equal(payload.source_type, "identity_mismatch");
    assert.equal(payload.provider_state, "identity_rejected");
    assert.equal(candleRequests, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
  }
});

test("DexPaprika discovery resolves the supplied Robinhood Chain contract when DexScreener has no result", async () => {
  const originalFetch = globalThis.fetch;
  const tokenAddress = "0x230442c8133a9efb4c278b3723043444749ca08b";
  const pairAddress = "0x602633428507bbaa848e6d0c3127cda15eeae6a9";
  try {
    globalThis.fetch = async (input) => {
      const url = String(input?.url || input);
      if (url.includes("api.dexpaprika.com/search")) return new Response(JSON.stringify({
        pools: [{
          id: pairAddress,
          chain: "robinhood",
          dex_id: "uniswap_v3",
          dex_name: "Uniswap V3",
          created_at: "2026-07-21T01:55:16Z",
          volume_usd: 135_000,
          transactions: 837,
          tokens: [
            { id: "0x0bd7d308f8e1639fab988df18a8011f41eacad73", name: "WETH", symbol: "WETH" },
            { id: tokenAddress, name: "The Runner", symbol: "RUNNER" },
          ],
        }],
      }), { status: 200 });
      if (url.includes("dexscreener.com")) return new Response(JSON.stringify(url.includes("/tokens/v1/") ? [] : { pairs: [] }), { status: 200 });
      throw new Error(`Unexpected test request: ${url}`);
    };
    const response = await ravenosWorker.fetch(new Request(`https://ravenos.xyz/api/dexscreener/search?q=${tokenAddress}`), {});
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].chainId, "robinhood");
    assert.equal(body.results[0].pairAddress, pairAddress);
    assert.equal(body.results[0].tokenAddress, tokenAddress);
    assert.equal(body.results[0].provider, "DexPaprika");
    assert.equal(body.results[0].chart_coverage.state, "probe_required");
    assert.equal(body.results[0].chart_coverage.request_supported, true);
    assert.equal(body.results[0].chart_coverage.exact_market_verified, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("BNB contract lookup preserves a searched quote-side token and exposes exact-pool chart capability", async () => {
  const originalFetch = globalThis.fetch;
  const tokenAddress = "0x6ff45323817d1d53bbb8a8dfba9245ae74057777";
  const counterAddress = "0x46ceefda28dd7207059ed19b0acdc026955bb15c";
  const pairAddress = "0x7bdc9582aca6ca25e5db1f2c8e59003b880672cb";
  const pair = {
    chainId: "bsc",
    dexId: "pancakeswap",
    pairAddress,
    baseToken: { address: counterAddress, name: "GameStop", symbol: "GMEB" },
    quoteToken: { address: tokenAddress, name: "memestock", symbol: "memestock" },
    liquidity: { usd: 232_265 },
    volume: { h24: 554_286 },
    txns: { h24: { buys: 1_836, sells: 1_872 } },
  };
  try {
    globalThis.fetch = async (input) => {
      const url = String(input?.url || input);
      if (url.includes("api.dexpaprika.com/search")) return new Response(JSON.stringify({
        tokens: [{ id: tokenAddress, name: "memestock", symbol: "memestock", chain: "bsc", price_usd: 0.0045, price_usd_change: 10.5 }],
        pools: [{
          id: pairAddress,
          chain: "bsc",
          dex_id: "pancakeswap_v2",
          dex_name: "PancakeSwap V2",
          created_at: "2026-08-12T13:45:20Z",
          volume_usd: 554_286,
          transactions: 3_708,
          tokens: [
            { id: counterAddress, name: "GameStop", symbol: "GMEB" },
            { id: tokenAddress, name: "memestock", symbol: "memestock" },
          ],
        }],
      }), { status: 200 });
      if (url.includes("/latest/dex/pairs/")) return new Response(JSON.stringify({ pairs: [pair] }), { status: 200 });
      if (url.includes("/latest/dex/search")) return new Response(JSON.stringify({ pairs: [pair] }), { status: 200 });
      if (url.includes("/tokens/v1/bsc/")) return new Response(JSON.stringify([pair]), { status: 200 });
      if (url.includes("/tokens/v1/")) return new Response(JSON.stringify([]), { status: 200 });
      throw new Error(`Unexpected test request: ${url}`);
    };
    const response = await ravenosWorker.fetch(new Request(`https://ravenos.xyz/api/dexscreener/search?q=${tokenAddress}`), {});
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].chainId, "bsc");
    assert.equal(body.results[0].pairAddress, pairAddress);
    assert.equal(body.results[0].tokenAddress, tokenAddress);
    assert.equal(body.results[0].quoteTokenAddress, counterAddress);
    assert.equal(body.results[0].symbol, "memestock");
    assert.equal(body.results[0].quoteSymbol, "GMEB");
    assert.equal(body.results[0].chart_coverage.state, "probe_required");
    assert.equal(body.results[0].chart_coverage.request_supported, true);
    assert.equal(RAVENOS_CHART_CAPABILITY_REGISTRY.onchain_networks.bsc.trading_state, "adapter_not_activated");

    const pairResponse = await ravenosWorker.fetch(new Request(`https://ravenos.xyz/api/dexscreener/pair?chainId=bsc&pairAddress=${pairAddress}&tokenAddress=${tokenAddress}`), {});
    const pairBody = await pairResponse.json();
    assert.equal(pairResponse.status, 200);
    assert.equal(pairBody.results.length, 1);
    assert.equal(pairBody.results[0].tokenAddress, tokenAddress);
    assert.equal(pairBody.results[0].quoteTokenAddress, counterAddress);
    assert.equal(pairBody.results[0].priceUsd, 0.0045);
    assert.equal(pairBody.results[0].volume24h, 554_286);
    assert.equal(pairBody.results[0].provider, "Dexscreener + DexPaprika");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pasted chat text extracts an exact BNB contract without treating surrounding words as selectors", async () => {
  const originalFetch = globalThis.fetch;
  const tokenAddress = "0x7ff45323817d1d53bbb8a8dfba9245ae74057777";
  const counterAddress = "0x46ceefda28dd7207059ed19b0acdc026955bb15c";
  const pairAddress = "0x8bdc9582aca6ca25e5db1f2c8e59003b880672cb";
  const searchedTerms = [];
  try {
    globalThis.fetch = async (input) => {
      const url = String(input?.url || input);
      if (url.includes("api.dexpaprika.com/search")) {
        searchedTerms.push(new URL(url).searchParams.get("query"));
        return new Response(JSON.stringify({
        pools: [{
          id: pairAddress,
          chain: "bsc",
          dex_id: "pancakeswap_v2",
          tokens: [
            { id: counterAddress, name: "GameStop", symbol: "GMEB" },
            { id: tokenAddress, name: "memestock", symbol: "memestock" },
          ],
        }],
        }), { status: 200 });
      }
      if (url.includes("/latest/dex/search")) {
        searchedTerms.push(new URL(url).searchParams.get("q"));
        return new Response(JSON.stringify({ pairs: [{
          chainId: "bsc",
          dexId: "pancakeswap",
          pairAddress,
          baseToken: { address: counterAddress, name: "GameStop", symbol: "GMEB" },
          quoteToken: { address: tokenAddress, name: "memestock", symbol: "memestock" },
          priceUsd: null,
          liquidity: null,
          volume: { h24: 0 },
          txns: { h24: { buys: 5, sells: 3 } },
        }] }), { status: 200 });
      }
      if (url.includes("dexscreener.com")) return new Response(JSON.stringify(url.includes("/tokens/v1/") ? [] : { pairs: [] }), { status: 200 });
      throw new Error(`Unexpected test request: ${url}`);
    };
    const pasted = `Telegram call: BNB token ${tokenAddress} — do your own research`;
    const response = await ravenosWorker.fetch(new Request(`https://ravenos.xyz/api/dexscreener/search?q=${encodeURIComponent(pasted)}`), {});
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].tokenAddress, tokenAddress);
    assert.equal(body.results[0].pairAddress, pairAddress);
    assert.equal(body.results[0].liquidityUsd, null);
    assert.equal(body.results[0].volume24h, null);
    assert.equal(body.results[0].txns24h, 8);
    assert.deepEqual([...new Set(searchedTerms)], [tokenAddress]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("token-tape metadata is batched, exact-address bound, and strips unsafe provider fields", async () => {
  const originalFetch = globalThis.fetch;
  const firstAddress = "4Nd1mYtH6cQqVaM4D6j6fLQ1xUeLLkL3ZnH8JY5FQ7pP";
  const secondAddress = "7YttLkHDoV4WL7Bq5JrM7hh7sQEJPAjW5DDr9gWjTnUQ";
  let providerCalls = 0;
  try {
    globalThis.fetch = async (input) => {
      const url = String(input?.url || input);
      assert.match(url, /token-pairs|tokens\/v1/);
      providerCalls += 1;
      return new Response(JSON.stringify([
        {
          chainId: "solana",
          dexId: "meteora",
          pairAddress: "7nZP2q2w6Kc3yYF4tQ8rR1vV5bD9mA2pE6uH3xJ8sL4N",
          baseToken: { address: firstAddress, name: "First Token", symbol: "FIRST" },
          quoteToken: { address: "So11111111111111111111111111111111111111112", name: "Wrapped SOL", symbol: "SOL" },
          liquidity: { usd: 82_000 },
          info: {
            imageUrl: "https://cdn.dexscreener.com/cms/images/first-token?width=200",
            websites: [{ url: "https://private-provider-payload.example" }],
            socials: [{ type: "twitter", url: "https://social.example/first" }],
          },
        },
        {
          chainId: "solana",
          dexId: "raydium",
          pairAddress: "8pM1yR7sW2uD5vF9bK3nT6cH4qJ8xL2eA7gZ1mV5oP9Q",
          baseToken: { address: secondAddress, name: "Second Token", symbol: "SECOND" },
          quoteToken: { address: "So11111111111111111111111111111111111111112", name: "Wrapped SOL", symbol: "SOL" },
          liquidity: { usd: 41_000 },
          info: { imageUrl: "https://tracking.example/token.png" },
        },
      ]), { status: 200, headers: { "content-type": "application/json" } });
    };
    const response = await ravenosWorker.fetch(new Request(`https://ravenos.xyz/api/onchain/token-metadata?chain=solana&addresses=${firstAddress},${secondAddress}`), {});
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.schema_version, "ravenos.onchain_token_metadata.v1");
    assert.equal(body.results.length, 2);
    assert.equal(body.results[0].token_address, firstAddress);
    assert.equal(body.results[0].image_url, "https://cdn.dexscreener.com/cms/images/first-token?width=200");
    assert.equal(body.results[1].token_address, secondAddress);
    assert.equal(body.results[1].image_url, null);
    assert.equal("websites" in body.results[0], false);
    assert.equal("socials" in body.results[0], false);
    assert.equal(providerCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("token-tape metadata rejects unsupported chains before provider access", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  try {
    globalThis.fetch = async () => {
      providerCalls += 1;
      throw new Error("provider must not be called");
    };
    const response = await ravenosWorker.fetch(new Request("https://ravenos.xyz/api/onchain/token-metadata?chain=ethereum&addresses=0x1111111111111111111111111111111111111111"), {});
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.error, "token_metadata_chain_unsupported");
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("one-minute and one-month intervals remain distinct", () => {
  assert.equal(timeframeSeconds("1m"), 60);
  assert.equal(timeframeSeconds("1M"), 2_592_000);
  assert.equal(hyperliquidInterval("1m"), "1m");
  assert.equal(hyperliquidInterval("1M"), "1M");
});

test("search reports per-provider exact-market coverage without silently switching providers", async () => {
  const originalFetch = globalThis.fetch;
  const tokenAddress = "0x230442c8133a9efb4c278b3723043444749ca08b";
  const pairAddress = "0x602633428507bbaa848e6d0c3127cda15eeae6a9";
  try {
    globalThis.fetch = async (input) => {
      const url = String(input?.url || input);
      if (url.includes("api.dexpaprika.com/search")) return new Response(JSON.stringify({
        pools: [{
          id: pairAddress,
          chain: "robinhood",
          dex_id: "uniswap_v3",
          volume_usd: 135_000,
          transactions: 837,
          tokens: [
            { id: "0x0bd7d308f8e1639fab988df18a8011f41eacad73", name: "WETH", symbol: "WETH" },
            { id: tokenAddress, name: "The Runner", symbol: "RUNNER" },
          ],
        }],
      }), { status: 200 });
      if (url.includes("dexscreener.com")) return new Response(JSON.stringify(url.includes("/tokens/v1/") ? [] : { pairs: [] }), { status: 200 });
      throw new Error(`Unexpected test request: ${url}`);
    };
    const response = await ravenosWorker.fetch(new Request(`https://ravenos.xyz/api/dexscreener/search?q=${tokenAddress}`), {
      ONCHAIN_CHART_PROVIDER: "coingecko",
      ONCHAIN_CHART_PROVIDER_PLAN: "demo",
      ONCHAIN_CHART_PROVIDER_COMMERCIAL: "false",
      ONCHAIN_CHART_PROVIDER_SECRET: "fixture-only",
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].chart_coverage.provider_id, "coingecko_onchain");
    assert.equal(body.results[0].chart_coverage.provider_plan, "demo");
    assert.equal(body.results[0].chart_coverage.state, "probe_required");
    assert.equal(body.results[0].chart_coverage.request_supported, true);
    assert.equal(body.results[0].chart_coverage.one_minute_request_supported, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exact EVM contract search discovers provider-listed chains without substituting another token", async () => {
  const originalFetch = globalThis.fetch;
  const tokenAddress = "0x730442c8133a9efb4c278b3723043444749ca08b";
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
    const responseText = await response.clone().text();
    assert.equal(response.status, 200, responseText);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].chainId, "robinhood");
    assert.equal(body.results[0].tokenAddress.toLowerCase(), tokenAddress);
    assert.equal(body.results[0].pairAddress.toLowerCase(), pair.pairAddress.toLowerCase());
    assert.equal(body.results[0].symbol, "RUNNER");
    assert.equal(body.results[0].buys24h, 120);
    assert.equal(body.results[0].sells24h, 121);
    assert.equal(body.results[0].txns24h, 241);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exact ETF identity survives while unqualified public chart data fails closed before provider access", async () => {
  const originalFetch = globalThis.fetch;
  const providerRequests = [];
  const origin = "https://origin.example/public/ravenos";
  const token = "server-only-chart-test-token";
  const env = { RAVENOS_PUBLIC_ORIGIN_URL: origin, RAVENOS_PUBLIC_ORIGIN_TOKEN: token };
  try {
    globalThis.fetch = async (input) => {
      const url = String(input?.url || input);
      providerRequests.push(url);
      throw new Error(`listed provider must not be called: ${url}`);
    };
    const response = await ravenosWorker.fetch(new Request("https://ravenos.xyz/api/terminal/chart?market=equities&asset=SPY&timeframe=1h&instrument_id=etf%3Anyse-arca%3Aspy"), env);
    assert.equal(response.status, 200);
    const body = await response.json();
    const payload = body.data || body;
    assert.equal(payload.ok, false);
    assert.equal(payload.source_type, "display_restricted");
    assert.equal(payload.provider_state, "display_restricted");
    assert.equal(payload.market_identity, "etf:nyse-arca:spy");
    assert.equal(payload.instrument.canonical_id, "etf:nyse-arca:spy");
    assert.equal(payload.instrument.instrument_type, CHART_INSTRUMENT_TYPES.ETF);
    assert.equal(payload.instrument.venue, "nyse-arca");
    assert.equal(payload.candles.length, 0);
    assert.match(payload.message, /commercially qualified data license/i);
    assert.equal(providerRequests.length, 0);

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

test("on-chain active-view polling fails degraded and returns to live without changing exact identity", async () => {
  const events = [];
  const statuses = [];
  let attempts = 0;
  const instrument = normalizeChartInstrument({
    instrumentType: "spot_pool",
    chain: "base",
    venue: "onchain_pool",
    symbol: "TEST",
    quoteAsset: "USDC",
    pairAddress: "0xExactPool",
  });
  const feed = new PollingChartFeed({
    intervalMs: 5_000,
    source: "Exact-pool provider polling",
    poll: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("provider_temporarily_unavailable");
      return {
        source_label: "Exact-pool OHLCV",
        freshness_state: "live",
        instrument,
        candles: [{ time: 1_800_000_000, open: 1, high: 2, low: 1, close: 2, volume: 3 }],
      };
    },
  });
  feed.start((event) => events.push(event), (status) => statuses.push(status));
  await feed.tick();
  await feed.tick();
  feed.stop();
  assert.equal(statuses.some((status) => status.state === "degraded"), true);
  assert.equal(statuses.some((status) => status.state === "live"), true);
  assert.equal(events.some((event) => event.type === "gap.detected"), true);
  const update = events.find((event) => event.type === "bar.upsert");
  assert.equal(update.instrument_id, instrument.canonical_id);
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
    const response = await ravenosWorker.fetch(new Request("https://ravenos.xyz/api/terminal/chart?market=crypto_spot&asset=RAVEN%2FSOL&timeframe=1h&limit=240&chain=solana&pair_address=ExactPool&token_address=ExactMint"), {
      RAVENOS_ONCHAIN_CHART_PROVIDER_ORDER: "coingecko_onchain",
      RAVENOS_ALLOW_KEYLESS_GECKOTERMINAL_DIAGNOSTIC: "1",
    });
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
      if (url.includes("geckoterminal.com") && url.includes("/ohlcv/")) {
        return new Response(JSON.stringify({ data: { attributes: { ohlcv_list: [[bucketSeconds, 1, 1.1, 0.9, 1.05, 10]] } } }), { status: 200 });
      }
      if (url.includes("geckoterminal.com")) return new Response(JSON.stringify(geckoPoolIdentity({ network: "solana", pairAddress: "FreshPool", baseAddress: "FreshMint", quoteAddress: "FreshQuote" })), { status: 200 });
      if (url.includes("dexscreener.com")) return new Response(JSON.stringify({ pairs: [] }), { status: 200 });
      throw new Error(`Unexpected test request: ${url}`);
    };
    const response = await ravenosWorker.fetch(new Request("https://ravenos.xyz/api/terminal/chart?market=crypto_spot&asset=FRESH%2FSOL&timeframe=1h&limit=240&chain=solana&pair_address=FreshPool&token_address=FreshMint"), {
      RAVENOS_ONCHAIN_CHART_PROVIDER_ORDER: "coingecko_onchain",
      RAVENOS_ALLOW_KEYLESS_GECKOTERMINAL_DIAGNOSTIC: "1",
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    const payload = body.data || body;
    assert.equal(payload.freshness_state, "live");
    assert.equal(payload.age_seconds, 0);
    assert.equal(payload.last_candle_at, new Date(bucketSeconds * 1000).toISOString());
    assert.ok(Date.now() - Date.parse(payload.observed_at) < 2_000);
    assert.equal(payload.lineage.last_candle_at, payload.last_candle_at);
    assert.equal(payload.candle_series.schema_version, RAVENOS_CHART_CANDLE_SERIES_SCHEMA);
    assert.equal(payload.candle_series.role, "base_ohlcv");
    assert.equal(payload.candle_series.provider, "coingecko_onchain");
    assert.equal(payload.candle_series.raven_observations_are_candles, false);
    assert.equal(cacheWrites.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
  }
});

test("server-only CoinGecko credential selects the paid exact-pool path without entering the response", async () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  const secret = "server-only-provider-secret";
  const pairAddress = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const tokenAddress = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const now = Math.floor(Date.now() / 60_000) * 60;
  try {
    globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input?.url || input);
      if (url.includes("pro-api.coingecko.com")) {
        assert.equal(init.headers["x-cg-pro-api-key"], secret);
        if (!url.includes("/ohlcv/")) return new Response(JSON.stringify(geckoPoolIdentity({ network: "eth", pairAddress, baseAddress: tokenAddress, quoteAddress: "0xcccccccccccccccccccccccccccccccccccccccc" })), { status: 200 });
        assert.equal(new URL(url).searchParams.get("include_empty_intervals"), "true");
        return new Response(JSON.stringify({ data: { attributes: { ohlcv_list: [
          [now, 2, 2.2, 1.9, 2.1, 12],
          [now - 60, 1.9, 2.1, 1.8, 2, 10],
          [now - 60, 99, 99, 99, 99, 1],
          [now - 120, 1.8, 2, 1.7, 1.9, 8],
        ] } } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("dexscreener.com")) return new Response(JSON.stringify({ pairs: [] }), { status: 200 });
      throw new Error(`Unexpected test request: ${url}`);
    };
    const response = await ravenosWorker.fetch(new Request(`https://ravenos.xyz/api/terminal/chart?market=crypto_spot&asset=TEST%2FUSDC&timeframe=1m&limit=240&chain=ethereum&pair_address=${pairAddress}&token_address=${tokenAddress}`), {
      ONCHAIN_CHART_PROVIDER: "coingecko",
      ONCHAIN_CHART_PROVIDER_PLAN: "basic",
      ONCHAIN_CHART_PROVIDER_COMMERCIAL: "true",
      ONCHAIN_CHART_PROVIDER_SECRET: secret,
    });
    const responseText = await response.text();
    assert.doesNotMatch(responseText, new RegExp(secret));
    const body = JSON.parse(responseText);
    const payload = body.data || body;
    assert.equal(payload.ok, true);
    assert.equal(payload.source, "CoinGecko Onchain");
    assert.equal(payload.lineage.provider_tier, "coingecko_basic");
    assert.equal(payload.lineage.provider_plan, "basic");
    assert.equal(payload.lineage.commercial_state, "commercial_configured_unverified");
    assert.equal(payload.lineage.empty_interval_policy, "provider_previous_close_zero_volume");
    assert.deepEqual(payload.attribution, {
      required: true,
      label: "Data provided by CoinGecko",
      url: "https://www.coingecko.com/",
    });
    assert.equal(payload.chart_readiness.state, "verified_current");
    assert.equal(payload.chart_readiness.one_minute_requirement, "insufficient_depth");
    assert.equal(payload.candles.length, 3);
    assert.deepEqual(payload.candles.map((candle) => candle.time), [now - 120, now - 60, now]);
    assert.equal(payload.candles.some((candle) => candle.close === 99), false);
    assert.equal(payload.market_anatomy.market_profile, null);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
  }
});

test("exact spot charts join current public token anatomy without changing candle authority", async () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  const providerSecret = "server-only-chart-secret";
  const originSecret = "server-only-origin-secret";
  const pairAddress = "AttentionPool1111111111111111111111111111";
  const tokenAddress = "AttentionToken111111111111111111111111111";
  const quoteAddress = "AttentionQuote111111111111111111111111111";
  const now = Math.floor(Date.now() / 60_000) * 60;
  const nowIso = new Date().toISOString();
  const observedAt = new Date(Date.now() - 45_000).toISOString();
  let profileCalls = 0;
  try {
    globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input?.url || input);
      if (url.includes("pro-api.coingecko.com")) {
        assert.equal(init.headers["x-cg-pro-api-key"], providerSecret);
        if (url.endsWith("/info")) {
          profileCalls += 1;
          return new Response(JSON.stringify(geckoPoolInfo({
            network: "solana",
            tokenAddress,
            quoteAddress,
            observedAt,
          })), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (!url.includes("/ohlcv/")) {
          return new Response(JSON.stringify(geckoPoolIdentity({
            network: "solana",
            pairAddress,
            baseAddress: tokenAddress,
            quoteAddress,
          })), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({ data: { attributes: { ohlcv_list: Array.from({ length: 180 }, (_, index) => {
          const close = 0.012 + (179 - index) * 0.000001;
          return [now - index * 60, close, close * 1.01, close * 0.99, close * 1.002, 1_000 + index];
        }) } } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (new URL(url).pathname.endsWith("/public/ravenos/opportunities.json")) {
        assert.equal(init.headers["x-ravenos-public-token"], originSecret);
        return new Response(JSON.stringify({
          ok: true,
          safe_public: true,
          key: "opportunities",
          schema_version: "ravenos_opportunity_census_public_origin_v1",
          generated_at: nowIso,
          updated_at: nowIso,
          freshness_target_seconds: 3_600,
          redaction_policy: "aggregate_public_market_context_only",
          source_artifact: "raven_opportunity_projection",
          data: {
            spot_attention: {
              schema_version: "ravenos.token_attention.v1",
              state: "current",
              generated_at: nowIso,
              rows: [{
                public_attention_id: "must-not-propagate",
                instrument_id: "must-not-propagate",
                market_type: "spot",
                chain: "Solana",
                venue: null,
                identity_scope: "exact_token",
                symbol: "ATTN",
                name: "Attention",
                token_address: tokenAddress,
                pool_address: null,
                observed_at: observedAt,
                movement_state: "Activity accelerating",
                what_changed: "Buyers and active traders expanded over the last five minutes.",
                risk: "Short-window movement still needs follow-through.",
                market: {
                  price_usd: 0.012,
                  market_cap_usd: 1_200_000,
                  liquidity_usd: 180_000,
                  market_age_seconds: 86_400,
                  holder_count: 1_240,
                  holder_change_5m_pct: 1.8,
                  holder_change_1h_pct: 6.4,
                  holder_change_24h_pct: 18.2,
                  volume_usd_5m: 140_000,
                  volume_usd_1h: 920_000,
                  volume_usd_24h: 5_100_000,
                  buys_5m: 64,
                  sells_5m: 26,
                  traders_5m: 72,
                  buys_1h: 320,
                  sells_1h: 130,
                  traders_1h: 240,
                },
                broader_attention: {
                  state: "raven_observed_first",
                  raven_observed_first: true,
                  lead_seconds: 1_200,
                  observed_at: observedAt,
                  summary: "Raven recorded this market 20m before broader attention appeared.",
                },
                research_only: true,
                actionable: false,
                execution_available: false,
              }],
              execution_boundary: {
                research_only: true,
                actionable: false,
                signing_available: false,
                submission_available: false,
              },
            },
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("dexscreener.com")) {
        return new Response(JSON.stringify({ pairs: [{
          chainId: "solana",
          dexId: "fixture-dex",
          pairAddress,
          baseToken: { address: tokenAddress, symbol: "ATTN", name: "Attention" },
          quoteToken: { address: quoteAddress, symbol: "USDC", name: "USD Coin" },
          priceUsd: "0.012",
          liquidity: { usd: 180_000 },
          volume: { h24: 5_100_000 },
          txns: { h24: { buys: 2_400, sells: 1_100 } },
          marketCap: 1_200_000,
          pairCreatedAt: Date.now() - 86_400_000,
        }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected test request: ${url}`);
    };
    const response = await ravenosWorker.fetch(new Request(`https://ravenos.xyz/api/terminal/chart?market=crypto_spot&asset=ATTN%2FUSDC&timeframe=1m&limit=180&chain=solana&pair_address=${pairAddress}&token_address=${tokenAddress}&quote_address=${quoteAddress}`), {
      ONCHAIN_CHART_PROVIDER: "coingecko",
      ONCHAIN_CHART_PROVIDER_PLAN: "basic",
      ONCHAIN_CHART_PROVIDER_COMMERCIAL: "true",
      ONCHAIN_CHART_PROVIDER_SECRET: providerSecret,
      RAVENOS_PUBLIC_ORIGIN_TOKEN: originSecret,
    });
    const responseText = await response.text();
    assert.equal(response.status, 200);
    assert.doesNotMatch(responseText, new RegExp(providerSecret));
    assert.doesNotMatch(responseText, new RegExp(originSecret));
    assert.doesNotMatch(responseText, /must-not-propagate/);
    assert.doesNotMatch(responseText, /private-provider-wallet/);
    assert.doesNotMatch(responseText, /private-provider-migration/);
    assert.doesNotMatch(responseText, /raw provider prose/);
    assert.doesNotMatch(responseText, /gt_score/);
    assert.doesNotMatch(responseText, /javascript:/);
    assert.doesNotMatch(responseText, /127\.0\.0\.1/);
    assert.doesNotMatch(responseText, /malicious\.example/);
    const body = JSON.parse(responseText);
    const payload = body.data || body;
    assert.equal(payload.ok, true);
    assert.equal(payload.candle_series.provider, "coingecko_onchain");
    assert.equal(payload.candle_series.raven_observations_are_candles, false);
    assert.equal(payload.market_anatomy.holder_distribution.state, "available");
    assert.equal(payload.market_anatomy.holder_distribution.holder_count, 4_852);
    assert.equal(payload.market_anatomy.holder_distribution.top_10_pct, 29.95);
    assert.equal(payload.market_anatomy.holder_distribution.next_10_pct, 12.4593);
    assert.equal(payload.market_anatomy.holder_distribution.next_20_pct, 15.1691);
    assert.equal(payload.market_anatomy.holder_distribution.rest_pct, 42.4216);
    assert.equal(payload.market_anatomy.holder_distribution.change_1h_pct, 6.4);
    assert.equal(payload.market_anatomy.market_profile.identity.state, "exact");
    assert.equal(payload.market_anatomy.market_profile.identity.pool_address, pairAddress);
    assert.equal(payload.market_anatomy.market_profile.identity.token_address, tokenAddress);
    assert.equal(payload.market_anatomy.market_profile.identity.quote_token_address, quoteAddress);
    assert.equal(payload.market_anatomy.market_profile.token_controls.mint_authority, "disabled");
    assert.equal(payload.market_anatomy.market_profile.token_controls.freeze_authority, "disabled");
    assert.equal(payload.market_anatomy.market_profile.token_controls.honeypot, "not_flagged");
    assert.equal(payload.market_anatomy.market_profile.token_controls.developer_holding_pct, 1.74);
    assert.equal(payload.market_anatomy.market_profile.launch.completed, true);
    assert.deepEqual(payload.market_anatomy.market_profile.links.map((link) => link.label), ["attention.example", "X"]);
    assert.equal(payload.market_anatomy.market_profile.attribution.label, "Data provided by CoinGecko");
    assert.equal(payload.provider_usage.provider_request_count, 3);
    assert.equal(payload.provider_usage.market_profile_cache_hit, false);
    assert.equal(payload.provider_usage.market_profile_request_count, 1);
    assert.equal(payload.market_anatomy.current_activity.traders_5m, 72);
    assert.equal(payload.market_anatomy.raven_context.evidence_scope, "exact_token");
    assert.equal(payload.market_anatomy.raven_context.scope_label, "Token-wide activity");
    assert.equal(payload.market_anatomy.raven_context.token_address, tokenAddress);
    assert.equal(payload.market_anatomy.raven_context.selected_pool_address, pairAddress);
    assert.equal(payload.market_anatomy.raven_context.evidence_pool_address, null);
    assert.equal(payload.market_anatomy.raven_context.signing_available, false);
    assert.equal(payload.market_anatomy.raven_context.submission_available, false);
    const cachedResponse = await ravenosWorker.fetch(new Request(`https://ravenos.xyz/api/terminal/chart?market=crypto_spot&asset=ATTN%2FUSDC&timeframe=1m&limit=180&chain=solana&pair_address=${pairAddress}&token_address=${tokenAddress}&quote_address=${quoteAddress}`), {
      ONCHAIN_CHART_PROVIDER: "coingecko",
      ONCHAIN_CHART_PROVIDER_PLAN: "basic",
      ONCHAIN_CHART_PROVIDER_COMMERCIAL: "true",
      ONCHAIN_CHART_PROVIDER_SECRET: providerSecret,
      RAVENOS_PUBLIC_ORIGIN_TOKEN: originSecret,
    });
    const cachedBody = await cachedResponse.json();
    const cachedPayload = cachedBody.data || cachedBody;
    assert.equal(cachedResponse.status, 200);
    assert.equal(profileCalls, 1);
    assert.equal(cachedPayload.provider_usage.market_profile_cache_hit, true);
    assert.equal(cachedPayload.provider_usage.market_profile_request_count, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
  }
});

test("a Jupiter Velocity row hands current token flow into its revalidated exact-pool chart", async () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  const providerSecret = "server-only-jupiter-chart-provider";
  const jupiterSecret = "server-only-jupiter-chart-key";
  const originSecret = "server-only-jupiter-origin-key";
  const pairAddress = "44444444444444444444444444444444";
  const tokenAddress = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
  const quoteAddress = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const now = Math.floor(Date.now() / 60_000) * 60;
  try {
    globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input?.url || input));
      if (url.hostname === "api.jup.ag") {
        assert.equal(init.headers["x-api-key"], jupiterSecret);
        assert.equal(url.pathname, "/tokens/v2/toptrending/5m");
        return new Response(JSON.stringify([{
          id: tokenAddress,
          name: "Jupiter Velocity",
          symbol: "JVEL",
          usdPrice: 0.012,
          mcap: 1_200_000,
          liquidity: 180_000,
          holderCount: 4_852,
          organicScore: 91,
          isVerified: true,
          firstPool: { createdAt: "2026-01-01T00:00:00Z" },
          stats5m: { priceChange: 8.4, volumeChange: 92, buyVolume: 140_000, sellVolume: 48_000, numBuys: 64, numSells: 26, numTraders: 72 },
          stats1h: { priceChange: 18.2, volumeChange: 110, buyVolume: 920_000, sellVolume: 340_000, numBuys: 320, numSells: 130, numTraders: 240 },
          stats24h: { priceChange: 31.5, volumeChange: 45, buyVolume: 5_100_000, sellVolume: 2_400_000, numBuys: 2_400, numSells: 1_100, numTraders: 1_480 },
        }]), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.hostname === "api.dexscreener.com" && url.pathname.startsWith("/tokens/v1/solana/")) {
        return new Response(JSON.stringify([{
          chainId: "solana",
          dexId: "meteora",
          pairAddress,
          pairCreatedAt: Date.now() - 30 * 86_400_000,
          baseToken: { address: tokenAddress, symbol: "JVEL", name: "Jupiter Velocity" },
          quoteToken: { address: quoteAddress, symbol: "USDC", name: "USD Coin" },
          priceUsd: "0.012",
          liquidity: { usd: 180_000 },
          volume: { h24: 5_100_000 },
          txns: { h24: { buys: 2_400, sells: 1_100 } },
          marketCap: 1_200_000,
        }]), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.hostname === "api.dexscreener.com") {
        return new Response(JSON.stringify({ pairs: [{
          chainId: "solana",
          dexId: "meteora",
          pairAddress,
          pairCreatedAt: Date.now() - 30 * 86_400_000,
          baseToken: { address: tokenAddress, symbol: "JVEL", name: "Jupiter Velocity" },
          quoteToken: { address: quoteAddress, symbol: "USDC", name: "USD Coin" },
          priceUsd: "0.012",
          liquidity: { usd: 180_000 },
          volume: { h24: 5_100_000 },
          txns: { h24: { buys: 2_400, sells: 1_100 } },
          marketCap: 1_200_000,
        }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.hostname === "pro-api.coingecko.com") {
        assert.equal(init.headers["x-cg-pro-api-key"], providerSecret);
        if (url.pathname.endsWith("/info")) {
          return new Response(JSON.stringify(geckoPoolInfo({
            network: "solana",
            tokenAddress,
            quoteAddress,
          })), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (!url.pathname.includes("/ohlcv/")) {
          return new Response(JSON.stringify(geckoPoolIdentity({
            network: "solana",
            pairAddress,
            baseAddress: tokenAddress,
            quoteAddress,
          })), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({ data: { attributes: { ohlcv_list: Array.from({ length: 180 }, (_, index) => {
          const close = 0.012 + (179 - index) * 0.000001;
          return [now - index * 60, close, close * 1.01, close * 0.99, close * 1.002, 1_000 + index];
        }) } } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.pathname.endsWith("/public/ravenos/opportunities.json")) {
        assert.equal(init.headers["x-ravenos-public-token"], originSecret);
        return new Response(JSON.stringify({ ok: false }), { status: 503, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected test request: ${url}`);
    };
    const response = await ravenosWorker.fetch(new Request(`https://ravenos.xyz/api/terminal/chart?market=crypto_spot&asset=JVEL%2FUSDC&timeframe=1m&limit=180&chain=solana&pair_address=${pairAddress}&token_address=${tokenAddress}&quote_address=${quoteAddress}`), {
      ONCHAIN_CHART_PROVIDER: "coingecko",
      ONCHAIN_CHART_PROVIDER_PLAN: "basic",
      ONCHAIN_CHART_PROVIDER_COMMERCIAL: "true",
      ONCHAIN_CHART_PROVIDER_SECRET: providerSecret,
      RAVENOS_PUBLIC_ORIGIN_TOKEN: originSecret,
      JUPITER_API_KEY: jupiterSecret,
    });
    const responseText = await response.text();
    assert.equal(response.status, 200);
    assert.doesNotMatch(responseText, new RegExp(providerSecret));
    assert.doesNotMatch(responseText, new RegExp(originSecret));
    assert.doesNotMatch(responseText, new RegExp(jupiterSecret));
    const envelope = JSON.parse(responseText);
    const payload = envelope.data || envelope;
    assert.equal(payload.ok, true);
    assert.equal(payload.instrument.pool_address, pairAddress);
    assert.equal(payload.instrument.token_address, tokenAddress);
    assert.equal(payload.market_anatomy.raven_context.schema_version, "ravenos.spot_market_context.v1");
    assert.equal(payload.market_anatomy.raven_context.evidence_scope, "exact_token");
    assert.equal(payload.market_anatomy.raven_context.scope_label, "Token-wide activity");
    assert.equal(payload.market_anatomy.raven_context.selected_pool_address, pairAddress);
    assert.equal(payload.market_anatomy.raven_context.evidence_pool_address, null);
    assert.match(payload.market_anatomy.raven_context.what_changed, /Price rose 8\.40% over 5m/);
    assert.equal(payload.market_anatomy.current_activity.buys_5m, 64);
    assert.equal(payload.market_anatomy.current_activity.sells_5m, 26);
    assert.equal(payload.market_anatomy.current_activity.traders_5m, 72);
    assert.equal(payload.market_anatomy.raven_context.signing_available, false);
    assert.equal(payload.market_anatomy.raven_context.submission_available, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
  }
});

test("current exact-pool delivery labels an unchanged quiet market separately from candle recency", async () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  const secret = "server-only-quiet-market-secret";
  const pairAddress = "0xdddddddddddddddddddddddddddddddddddddddd";
  const tokenAddress = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  const quoteAddress = "0xffffffffffffffffffffffffffffffffffffffff";
  const oldBucket = Math.floor(Date.now() / 60_000) * 60 - 1_800;
  try {
    globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };
    globalThis.fetch = async (input) => {
      const url = String(input?.url || input);
      if (url.includes("pro-api.coingecko.com")) {
        if (!url.includes("/ohlcv/")) {
          return new Response(JSON.stringify(geckoPoolIdentity({
            network: "base",
            pairAddress,
            baseAddress: tokenAddress,
            quoteAddress,
          })), { status: 200 });
        }
        return new Response(JSON.stringify({ data: { attributes: { ohlcv_list: [
          [oldBucket, 2, 2.2, 1.9, 2.1, 12],
          [oldBucket - 60, 1.9, 2.1, 1.8, 2, 10],
          [oldBucket - 120, 1.8, 2, 1.7, 1.9, 8],
        ] } } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("dexscreener.com")) {
        return new Response(JSON.stringify({ pairs: [{
          chainId: "base",
          dexId: "aerodrome",
          pairAddress,
          baseToken: { address: tokenAddress, symbol: "QUIET", name: "Quiet" },
          quoteToken: { address: quoteAddress, symbol: "USDC", name: "USD Coin" },
          priceUsd: "2.1",
          liquidity: { usd: 100_000 },
          volume: { h24: 4_000 },
          txns: { h24: { buys: 10, sells: 5 } },
          pairCreatedAt: Date.now() - 86_400_000,
        }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected test request: ${url}`);
    };
    const response = await ravenosWorker.fetch(new Request(`https://ravenos.xyz/api/terminal/chart?market=crypto_spot&asset=QUIET%2FUSDC&timeframe=1m&limit=240&chain=base&pair_address=${pairAddress}&token_address=${tokenAddress}&quote_address=${quoteAddress}`), {
      ONCHAIN_CHART_PROVIDER: "coingecko",
      ONCHAIN_CHART_PROVIDER_PLAN: "basic",
      ONCHAIN_CHART_PROVIDER_COMMERCIAL: "true",
      ONCHAIN_CHART_PROVIDER_SECRET: secret,
    });
    const body = await response.json();
    const payload = body.data || body;
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.provider_freshness_state, "current");
    assert.equal(payload.candle_freshness_state, "delayed");
    assert.equal(payload.market_activity_state, "no_recent_trades");
    assert.equal(payload.market_health.chart_state, "current_no_recent_trades");
    assert.equal(payload.market_health.operator_label, "No recent trades");
    assert.equal(payload.freshness_state, "live");
    assert.equal(payload.stale, false);
    assert.equal(payload.market_anatomy.provider_freshness_state, "current");
    assert.equal(payload.market_anatomy.candle_freshness_state, "delayed");
    assert.equal(payload.market_anatomy.buys_24h, 10);
    assert.equal(payload.market_anatomy.sells_24h, 5);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
  }
});

test("Robinhood exact pools use the qualified CoinGecko network without identity substitution", async () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  const secret = "server-only-robinhood-test-secret";
  const pairAddress = "0x602633428507bbaa848e6d0c3127cda15eeae6a9";
  const tokenAddress = "0x230442c8133a9efb4c278b3723043444749ca08b";
  const quoteAddress = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
  const now = Math.floor(Date.now() / 60_000) * 60;
  const providerRows = Array.from({ length: 180 }, (_, index) => {
    const close = 0.0003 + (179 - index) * 0.00000001;
    return [now - index * 60, close, close * 1.002, close * 0.998, close * 1.001, index % 5 ? 15 : 0];
  });
  try {
    globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input?.url || input);
      if (url.includes("pro-api.coingecko.com")) {
        assert.equal(init.headers["x-cg-pro-api-key"], secret);
        assert.match(url, new RegExp(`/networks/robinhood/pools/${pairAddress}`));
        if (!url.includes("/ohlcv/")) {
          return new Response(JSON.stringify(geckoPoolIdentity({
            network: "robinhood",
            pairAddress,
            baseAddress: tokenAddress,
            quoteAddress,
          })), { status: 200 });
        }
        const requestUrl = new URL(url);
        assert.equal(requestUrl.searchParams.get("include_empty_intervals"), "true");
        assert.equal(requestUrl.searchParams.get("token"), "base");
        return new Response(JSON.stringify({ data: { attributes: { ohlcv_list: providerRows } } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected test request: ${url}`);
    };
    const response = await ravenosWorker.fetch(new Request(`https://ravenos.xyz/api/terminal/chart?market=crypto_spot&asset=RUNNER%2FWETH&timeframe=1m&limit=180&chain=robinhood&pair_address=${pairAddress}&token_address=${tokenAddress}&quote_address=${quoteAddress}`), {
      ONCHAIN_CHART_PROVIDER: "coingecko",
      ONCHAIN_CHART_PROVIDER_PLAN: "basic",
      ONCHAIN_CHART_PROVIDER_COMMERCIAL: "true",
      ONCHAIN_CHART_PROVIDER_SECRET: secret,
    });
    const responseText = await response.text();
    assert.equal(response.status, 200, responseText);
    assert.doesNotMatch(responseText, new RegExp(secret));
    const body = JSON.parse(responseText);
    const payload = body.data || body;
    assert.equal(payload.ok, true);
    assert.equal(payload.chain, "robinhood");
    assert.equal(payload.pair_address, pairAddress);
    assert.equal(payload.token_address, tokenAddress);
    assert.equal(payload.quote_address, quoteAddress);
    assert.equal(payload.candle_series.provider, "coingecko_onchain");
    assert.equal(payload.candles.length, 180);
    assert.equal(payload.continuity.identity.exact_market_preserved, true);
    assert.equal(payload.lineage.empty_interval_policy, "provider_previous_close_zero_volume");
    assert.equal(payload.candle_series.raven_observations_are_candles, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
  }
});

test("an immutable release reports CoinGecko Basic as qualified only when the exact release gate agrees", () => {
  const base = {
    ONCHAIN_CHART_PROVIDER: "coingecko",
    ONCHAIN_CHART_PROVIDER_PLAN: "basic",
    ONCHAIN_CHART_PROVIDER_COMMERCIAL: "true",
    ONCHAIN_CHART_PROVIDER_SECRET: "server-only-provider-secret",
    RAVENOS_RELEASE_ENFORCE: "1",
    RAVENOS_ONCHAIN_CHART_PRODUCTION_PROVIDER: "coingecko",
    RAVENOS_ONCHAIN_CHART_PRODUCTION_QUALIFIED: "1",
  };
  const qualified = onchainProviderRuntime("coingecko_onchain", base);
  assert.equal(qualified.commercial_state, "commercial_qualified");
  assert.equal(qualified.production_qualified, true);
  assert.equal(qualified.production_state, "qualified_for_production");

  const wrongProvider = onchainProviderRuntime("coingecko_onchain", {
    ...base,
    RAVENOS_ONCHAIN_CHART_PRODUCTION_PROVIDER: "dexpaprika",
  });
  assert.equal(wrongProvider.commercial_state, "commercial_configured_unverified");
  assert.equal(wrongProvider.production_qualified, false);
  assert.equal(wrongProvider.production_state, "blocked_pending_plan_rights_and_binding_verification");
});

test("dense provider OHLCV remains the base series while Raven observations attach only as annotations", async () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  const pairAddress = "0x1111111111111111111111111111111111111111";
  const tokenAddress = "0x2222222222222222222222222222222222222222";
  const providerRows = Array.from({ length: 240 }, (_, index) => [
    1_800_000_000 + index * 900,
    10 + index / 100,
    10.2 + index / 100,
    9.8 + index / 100,
    10.1 + index / 100,
    100 + index,
  ]);
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
          pair_address: pairAddress,
          token_address: tokenAddress,
          quote_address: "0x3333333333333333333333333333333333333333",
          price_unit: "quote_per_token",
          source: "Raven EVM exact swap",
          freshness_state: "live",
          observed_at: new Date().toISOString(),
          available_scopes: { exact_pool: true, token_aggregate: false },
          lineage: {
            identity_scope: "exact_pool",
            price_unit: "quote_per_token",
            latest_source_event_id: "private:event:123",
            latest_source_name: "private-source.json",
            source_registry_paths: ["/srv/raven/app/data/runtime/private-registry.json"],
          },
          candles: [{ time: 1_900_000_000, open: 999, high: 999, low: 999, close: 999, volume: 1 }],
          recent_trades: [{ id: "raven-event", time: providerRows[120][0] + 100, price: 999, size: 1, side: "buy" }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("geckoterminal.com") && url.includes("/ohlcv/")) {
        return new Response(JSON.stringify({ data: { attributes: { ohlcv_list: providerRows } } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("geckoterminal.com")) return new Response(JSON.stringify(geckoPoolIdentity({ network: "base", pairAddress, baseAddress: tokenAddress, quoteAddress: "0x3333333333333333333333333333333333333333" })), { status: 200 });
      if (url.includes("dexscreener.com")) return new Response(JSON.stringify({ pairs: [] }), { status: 200 });
      throw new Error(`Unexpected test request: ${url}`);
    };
    const response = await ravenosWorker.fetch(new Request(`https://ravenos.xyz/api/terminal/chart?market=crypto_spot&asset=BASE%2FUSDC&timeframe=15m&limit=240&chain=base&pair_address=${pairAddress}&token_address=${tokenAddress}`), {
      RAVENOS_SPOT_CHART_ORIGIN_TOKEN: "secret",
      RAVENOS_ONCHAIN_CHART_PROVIDER_ORDER: "coingecko_onchain",
      RAVENOS_ALLOW_KEYLESS_GECKOTERMINAL_DIAGNOSTIC: "1",
    });
    const body = await response.json();
    const payload = body.data || body;
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.source_type, "provider");
    assert.equal(payload.candles.length, 240);
    assert.equal(payload.candles.some((candle) => candle.close === 999), false);
    assert.equal(payload.candle_series.role, "base_ohlcv");
    assert.equal(payload.candle_series.bar_count, 240);
    assert.equal(payload.raven_annotations.role, "annotation_only");
    assert.equal(payload.raven_annotations.candle_replacement_allowed, false);
    assert.equal(payload.raven_annotations.instrument_id, payload.instrument.canonical_id);
    assert.equal(payload.raven_annotations.market_identity, payload.market_identity);
    assert.equal(payload.raven_annotations.lineage.source, "Raven exact-pool observations");
    assert.equal(payload.raven_annotations.lineage.role, "annotation_only");
    assert.equal(payload.raven_annotations.price_axis_compatible, false);
    assert.equal(payload.raven_annotations.event_count, 1);
    assert.equal(payload.raven_annotations.events.length, 1);
    assert.equal(payload.raven_annotations.events[0].type, "raven-observation");
    assert.equal(payload.raven_annotations.events[0].time, providerRows[120][0]);
    assert.equal(payload.raven_annotations.events[0].instrument_id, payload.instrument.canonical_id);
    assert.equal(Object.hasOwn(payload.raven_annotations.events[0], "price"), false);
    assert.deepEqual(payload.recent_trades, []);
    assert.equal(payload.lineage.source_precedence, "provider_ohlcv_base_raven_annotations_only");
    assert.equal(payload.lineage.raven_projection.role, "annotation_only");
    assert.equal(Object.hasOwn(payload.raven_annotations.lineage, "source_registry_paths"), false);
    assert.equal(Object.hasOwn(payload.lineage.raven_projection, "source_registry_paths"), false);
    assert.equal(JSON.stringify(payload).includes("source_registry_paths"), false);
    assert.equal(JSON.stringify(payload).includes("/srv/raven/app"), false);
    assert.equal(JSON.stringify(payload).includes("private-source.json"), false);
    assert.equal(JSON.stringify(payload).includes("private:event:123"), false);
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
      RAVENOS_ONCHAIN_CHART_PROVIDER_ORDER: "coingecko_onchain",
      RAVENOS_ALLOW_KEYLESS_GECKOTERMINAL_DIAGNOSTIC: "1",
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

test("provider-history failure rejects Raven observations as substitute candles", async () => {
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
      RAVENOS_ONCHAIN_CHART_PROVIDER_ORDER: "coingecko_onchain",
      RAVENOS_ALLOW_KEYLESS_GECKOTERMINAL_DIAGNOSTIC: "1",
    });
    const body = await response.json();
    const payload = body.data || body;
    assert.equal(response.status, 200);
    assert.equal(payload.ok, false);
    assert.equal(payload.source_type, "provider_unavailable");
    assert.equal(payload.failed_layer, "historical_ohlcv");
    assert.equal(payload.raven_annotations_available, true);
    assert.deepEqual(payload.candles, []);
    assert.match(payload.message, /not substituted/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
  }
});
