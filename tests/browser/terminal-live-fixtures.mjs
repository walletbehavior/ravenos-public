export function providerCandles(asset, timeframe = "1h") {
  const spec = {
    "1m": [60, 80],
    "5m": [300, 72],
    "15m": [900, 64],
    "1h": [3600, 56],
    "4h": [14400, 48],
    "1d": [86400, 42],
    "1w": [604800, 36],
    "1M": [2592000, 30],
  }[timeframe] || [3600, 56];
  const [step, count] = spec;
  const seed = [...`${asset}:${timeframe}`].reduce((sum, character) => sum + character.charCodeAt(0), 17);
  const end = 1_784_592_000;
  let close = asset.includes("BTC") ? 67_500 : asset.includes("SPOT") || asset.includes("JUP") ? 1.12 : 148;
  return Array.from({ length: count }, (_, index) => {
    const open = close;
    close = Math.max(0.0001, open * (1 + Math.sin(index * 0.37 + seed) * 0.006 + (index - count / 2) * 0.00005));
    return {
      time: end - (count - 1 - index) * step,
      open: Number(open.toFixed(8)),
      high: Number((Math.max(open, close) * 1.004).toFixed(8)),
      low: Number((Math.min(open, close) * 0.996).toFixed(8)),
      close: Number(close.toFixed(8)),
      volume: 900_000 + seed * 100 + index * 11_000,
    };
  });
}

export const ROBINHOOD_CONTRACT = "0x230442c8133a9efb4c278b3723043444749ca08b";

function spotFixtureRows(query = "") {
  const normalized = String(query || "").trim().toLowerCase();
  if (normalized === ROBINHOOD_CONTRACT || normalized.includes("runner")) {
    return [{
      chainId: "robinhood",
      dexId: "uniswap",
      pairAddress: "0x602633428507BBAA848E6D0c3127cda15eEAE6a9",
      tokenAddress: ROBINHOOD_CONTRACT,
      quoteTokenAddress: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
      symbol: "RUNNER",
      name: "The Runner",
      quoteSymbol: "WETH",
      priceUsd: 0.0003219,
      liquidityUsd: 68_960.64,
      volume24h: 14_200,
      txns24h: 241,
      marketCap: 321_900,
      fdv: 321_900,
      priceChange24h: -1.8,
      coverage: "Public lookup snapshot",
      isSample: false,
      lastUpdated: "2026-07-21T12:20:00Z",
    }];
  }
  if (normalized && !normalized.includes("jup") && !normalized.includes("jupiter")) return [];
  return [{
    chainId: "solana",
    dexId: "fixture-dex",
    pairAddress: "fixture-pair-address",
    tokenAddress: "fixture-token-address",
    quoteTokenAddress: "fixture-quote-address",
    symbol: "JUP",
    name: "Jupiter",
    quoteSymbol: "USDC",
    priceUsd: 1.12,
    liquidityUsd: 4_200_000,
    volume24h: 16_500_000,
    txns24h: 12_400,
    marketCap: 3_100_000_000,
    fdv: 7_800_000_000,
    priceChange24h: 3.4,
    coverage: "Public lookup snapshot",
    isSample: false,
    lastUpdated: "2026-07-21T12:20:00Z",
  }];
}

export async function selectUniversalInstrument(page, label) {
  await page.locator("#terminalInstrumentTrigger, #rosCommandTrigger").first().click();
  const input = page.locator("#rosCommandInput");
  await input.fill(label);
  const result = page.locator(".ros-command-result.instrument").filter({ hasText: label }).first();
  await result.waitFor({ state: "visible" });
  await result.click();
  await page.waitForURL((url) => url.pathname === "/terminal/" && url.searchParams.get("asset") === label);
}

export async function openExactSpotSearch(page, query) {
  await page.locator("#terminalInstrumentTrigger, #rosCommandTrigger").first().click();
  await page.locator("#rosCommandInput").fill(query);
  const result = page.locator(".ros-command-result.instrument").filter({ hasText: query }).filter({ hasText: "Exact pool" }).first();
  await result.waitFor({ state: "visible" });
  await result.click();
  await page.waitForURL((url) => url.pathname === "/terminal/" && String(url.searchParams.get("instrument_id") || "").includes(":pool:"));
}

function marketRow(asset, overrides = {}) {
  const coin = asset.replace(/-PERP$/, "");
  const mark = asset === "BTC-PERP" ? 67_500 : 148.25;
  return {
    asset,
    symbol: coin,
    instrument_id: `hyperliquid:perp:${coin}`,
    instrument_scope: "exact_instrument",
    market_type: "perpetual",
    venue: "hyperliquid",
    venue_label: "Hyperliquid",
    last_price: mark,
    mark_price: mark,
    oracle_price: mark - 0.05,
    funding_rate: -0.000012,
    open_interest_usd: asset === "BTC-PERP" ? 820_000_000 : 192_000_000,
    day_notional_volume_usd: asset === "BTC-PERP" ? 1_400_000_000 : 480_000_000,
    day_change_pct: asset === "BTC-PERP" ? -0.8 : 2.4,
    max_leverage: asset === "BTC-PERP" ? 40 : 20,
    observed_at: "2026-07-21T12:20:00Z",
    provider: "Hyperliquid public info endpoint",
    coverage: "live",
    freshness_state: "fresh",
    is_live: true,
    is_synthetic: false,
    ...overrides,
  };
}

function contextPayload(asset) {
  const coin = asset.replace(/-PERP$/, "");
  return {
    ok: true,
    schema_version: "ravenos.perp_terminal_context.v1",
    instrument: { instrument_id: `hyperliquid:perp:${coin}`, asset, symbol: coin },
    raven_context: {
      context_available: true,
      context_state: "fresh",
      observed_at: "2026-07-21T12:18:00Z",
      behavior_family: asset === "BTC-PERP" ? "Pressure reset" : "Behavioral setup",
      pressure_state: asset === "BTC-PERP" ? "Balanced pressure" : "Mixed pressure",
      current_path: asset === "BTC-PERP" ? "Reset forming" : "Followthrough forming",
      outcomes: { evidence_maturity: "matured", sample_size: asset === "BTC-PERP" ? 84 : 128 },
    },
    raven_read: {
      headline: `${asset} · ${asset === "BTC-PERP" ? "Pressure reset" : "Behavioral setup"}`,
      summary: "A frozen decision observation is joined to this exact venue instrument.",
      why_raven_noticed: "Behavior changed while provider-backed pressure remained observable.",
      what_would_strengthen: ["Pressure broadens without immediate fade."],
      what_would_weaken: ["The observed path loses confirmation."],
    },
    matured_comparables: {
      evidence_maturity: "matured",
      sample_size: asset === "BTC-PERP" ? 84 : 128,
      median_observed_change_pct: 1.4,
      median_favorable_excursion_pct: 3.1,
      median_adverse_excursion_pct: -1.2,
      matured_through: "2026-07-20T12:00:00Z",
    },
    plan_preview: { state: "research_only", executable: false },
    chart_event: {
      event_id: `event:${coin}:fixture`,
      instrument_id: `hyperliquid:perp:${coin}`,
      label: asset === "BTC-PERP" ? "Pressure reset" : "Behavioral setup",
      observed_at: "2026-07-20T12:00:00Z",
      lineage: { public_context_id: `context:${coin}:fixture` },
      inspection: {
        source_evidence: { label: "Timestamped Raven observation", observed_at: "2026-07-20T12:00:00Z", public_reference: `context:${coin}:fixture` },
        evidence_maturity: "matured",
        path_transition: { behavior: asset === "BTC-PERP" ? "Pressure reset" : "Behavioral setup", pressure: asset === "BTC-PERP" ? "Balanced pressure" : "Mixed pressure", observed_side: "long", state: "fresh" },
        historical_outcome: { sample_size: asset === "BTC-PERP" ? 84 : 128, median_change_pct: 1.4, matured_through: "2026-07-20T12:00:00Z" },
        support: ["Pressure broadens without immediate fade."],
        contradiction: ["The observed path loses confirmation."],
      },
    },
    market_data: {
      generated_at: "2026-07-21T12:20:00Z",
      book: { summary: { best_bid: 148.23, best_ask: 148.27, spread_bps: 2.664 } },
      components: { market: "fresh", book: "fresh", tape: "fresh" },
    },
    delivery: { source: "current_public_origin", freshness_state: "fresh", fallback: false },
  };
}

export async function mockTerminalLiveApis(page, { chartFailure = false, flagsEnabled = false, sparseTimeframe = null, liveBars = false } = {}) {
  const calls = [];
  const markets = [marketRow("SOL-PERP"), marketRow("BTC-PERP")];
  await page.route("**/api/hyperliquid/perps", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, schema_version: "ravenos.hyperliquid.markets.v2", provider: "Hyperliquid", coverage: "Live", count: markets.length, results: markets }),
  }));
  await page.route("**/api/perps", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, data: { instrument_context: { rows: [{ instrument: "SOL-PERP", context_available: true, context_state: "fresh", context_age_seconds: 30, outcomes: { sample_size: 128 } }] } } }),
  }));
  await page.route("**/api/perps/instrument**", (route) => {
    const symbol = new URL(route.request().url()).searchParams.get("symbol") || "SOL-PERP";
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(contextPayload(symbol)) });
  });
  await page.route("**/api/terminal/chart**", (route) => {
    const url = new URL(route.request().url());
    const asset = url.searchParams.get("asset") || "SOL-PERP";
    const timeframe = url.searchParams.get("timeframe") || "1h";
    const market = url.searchParams.get("market") || "perpetuals";
    const pairAddress = url.searchParams.get("pair_address");
    const tokenAddress = url.searchParams.get("token_address");
    const quoteAddress = url.searchParams.get("quote_address");
    const instrumentId = url.searchParams.get("instrument_id");
    const chain = url.searchParams.get("chain");
    calls.push({ asset, timeframe, market, pairAddress, instrumentId });
    if (chartFailure) return route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ ok: false, error: "provider_unavailable", freshness_state: "data_unavailable", candles: [] }) });
    const perp = asset.endsWith("-PERP");
    const traditional = market === "equities";
    const spotChain = chain || "solana";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        asset,
        source: perp ? "Hyperliquid" : traditional ? "Yahoo Finance" : "DexPaprika",
        source_label: perp ? "Live perps market price" : traditional ? "Live market price" : "Exact public pool",
        freshness_state: "fresh",
        timeframe,
        observed_at: "2026-07-21T12:20:00Z",
        market_identity: traditional ? instrumentId : pairAddress ? `${spotChain}:pool:${pairAddress}` : `hyperliquid:perp:${asset.replace(/-PERP$/, "")}`,
        instrument_scope: pairAddress ? "exact_pool" : "exact_instrument",
        available_scopes: pairAddress ? { exact_pool: true, token_aggregate: true } : {},
        instrument: traditional
          ? { canonical_id: instrumentId, instrument_type: String(instrumentId || "").startsWith("etf:") ? "etf" : "equity", identity_scope: "exact_instrument", chain: "none", venue: String(instrumentId || "").split(":")[1] || "traditional", symbol: asset, quote_asset: "USD" }
          : perp
          ? { instrument_type: "perpetual", chain: "hyperliquid", venue: "hyperliquid", symbol: asset }
          : { instrument_type: "spot_pool", chain: spotChain, venue: "fixture-dex", symbol: asset.split("/")[0], quote_asset: asset.split("/")[1] || "USDC", pair_address: pairAddress, token_address: tokenAddress },
        capabilities: { live_bars: liveBars, older_bar_backfill: false, live_trades: liveBars && perp },
        candle_series: {
          schema_version: "ravenos.chart_candle_series.v1",
          role: "base_ohlcv",
          provider: perp ? "hyperliquid_native" : traditional ? "atlas_listed_market" : "dexpaprika",
          provider_market_id: traditional ? instrumentId : pairAddress || `hyperliquid:${asset.replace(/-PERP$/, "")}`,
          timeframe,
          source_interval: timeframe,
          freshness_state: "fresh",
          derivation: { state: "direct", source_interval: timeframe, target_interval: timeframe, interpolation_used: false, missing_buckets_filled: 0 },
          raven_observations_are_candles: false,
        },
        continuity: pairAddress ? {
          schema_version: "ravenos.chart_continuity.v1",
          state: "verified",
          exact_pool_fingerprint: `${spotChain}:${pairAddress}:${tokenAddress}:${quoteAddress || "fixture-quote"}`,
          token_orientation: "selected_token_usd",
          selected_token_decimals: 9,
          quote_token_decimals: 6,
          candles: { state: "verified", missing_source_buckets: 0, conflicting_duplicates: 0, freshness_state: "fresh", age_seconds: 0 },
        } : null,
        derivation: { state: "direct", source_interval: timeframe, target_interval: timeframe, interpolation_used: false, missing_buckets_filled: 0 },
        provider_usage: { provider: perp ? "hyperliquid_native" : traditional ? "atlas_listed_market" : "dexpaprika", interval: timeframe, source_interval: timeframe, cache_hit: false, candle_mode: "direct", fallback_event: false },
        market_anatomy: pairAddress ? {
          schema_version: "ravenos.market_anatomy.v1",
          exact_identity: true,
          pool_fingerprint: `${spotChain}:${pairAddress}:${tokenAddress}:${quoteAddress || "fixture-quote"}`,
          liquidity_usd: 4_200_000,
          volume_24h_usd: 16_500_000,
          transactions_24h: 12_400,
          pool_age_ms: 180 * 86_400_000,
          holder_distribution: { state: "unavailable", reason: "Private enrichment is not projected." },
          route: { state: spotChain === "solana" ? "review_capability_check_required" : "unavailable", signing_available: false, submission_available: false },
        } : null,
        raven_annotations: pairAddress && spotChain === "solana" ? {
          schema_version: "ravenos.chart_annotations.v1",
          role: "annotation_only",
          identity_scope: "exact_pool",
          instrument_id: `spot_pool:solana:fixture-dex:JUP:USDC:${pairAddress}`,
          market_identity: `solana:pool:${pairAddress}`,
          price_unit: "usd_per_token",
          price_axis_compatible: true,
          candle_replacement_allowed: false,
          events: [{ type: "raven-observation", severity: "info", time: providerCandles(asset, timeframe)[10].time, exact_observed_at: "2026-07-21T12:00:00Z", event_id: "public-raven-event" }],
          overlays: [],
          lineage: { source: "Raven exact observations", observed_at: "2026-07-21T12:00:00Z" },
        } : null,
        candles: sparseTimeframe === timeframe ? providerCandles(asset, timeframe).slice(-12) : providerCandles(asset, timeframe),
      }),
    });
  });
  await page.route("**/api/dexscreener/search**", (route) => {
    const query = new URL(route.request().url()).searchParams.get("q") || "";
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, results: spotFixtureRows(query) }) });
  });
  await page.route("**/api/dexscreener/pair**", (route) => {
    const url = new URL(route.request().url());
    const rows = url.searchParams.get("chainId") === "robinhood" ? spotFixtureRows(ROBINHOOD_CONTRACT) : spotFixtureRows("JUP");
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, results: rows }) });
  });
  await page.route("**/api/trade/flags", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      quote_only: true,
      market_preview_available: true,
      market_preview_markets: ["hyperliquid_perpetual"],
      signing_available: false,
      submission_available: false,
      flags: {
        RAVENOS_CUSTOMER_TRADE_UI_ENABLE: flagsEnabled,
        RAVENOS_CUSTOMER_TRADE_QUOTE_ENABLE: flagsEnabled,
        RAVENOS_CUSTOMER_TRADE_SOLANA_ENABLE: flagsEnabled,
        RAVENOS_CUSTOMER_TRADE_SIGN_ENABLE: false,
        RAVENOS_CUSTOMER_TRADE_SUBMIT_ENABLE: false,
      },
    }),
  }));
  await page.route("**/api/trade/market-preview", async (route) => {
    const request = route.request();
    const input = request.postDataJSON();
    const coin = String(input.instrument_id || "hyperliquid:perp:SOL").split(":").pop();
    const side = input.side === "short" ? "short" : "long";
    const notional = Number(input.notional_usdc || 500);
    const leverage = Number(input.leverage || 3);
    const mid = coin === "BTC" ? 67_500 : 148.25;
    const vwap = side === "long" ? mid * 1.00008 : mid * 0.99992;
    const observedAt = new Date().toISOString();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        schema_version: "ravenos.hyperliquid_market_preview.v1",
        state: "market_preview_available",
        preview_id: `hlmp_fixture_${coin}_${side}_${notional}_${leverage}`,
        generated_at: observedAt,
        expires_at: new Date(Date.now() + 30_000).toISOString(),
        instrument: {
          instrument_id: input.instrument_id,
          exact_market_id: coin,
          symbol: `${coin}-PERP`,
          venue: "hyperliquid",
          instrument_type: "perpetual",
          identity_scope: "exact_instrument",
          collateral_asset: "USDC",
          price_denominator: "USD reference",
        },
        intent: {
          side,
          requested_notional_usdc: notional,
          leverage,
          estimated_initial_margin_usdc: notional / leverage,
          margin_estimate_excludes_existing_exposure: true,
        },
        fill_estimate: {
          base_size: notional / vwap,
          vwap_price: vwap,
          worst_price: side === "long" ? vwap * 1.00002 : vwap * 0.99998,
          mid_price: mid,
          best_bid: mid * 0.99995,
          best_ask: mid * 1.00005,
          spread_bps: 1,
          price_impact_bps: 0.8,
          visible_levels_consumed: 2,
          visible_side_notional_usdc: 500_000,
        },
        route: {
          venue: "hyperliquid",
          exact_market_id: coin,
          consumed_book_side: side === "long" ? "asks" : "bids",
          order_assumption: "immediate_or_cancel_market_equivalent",
          market_order_submitted: false,
        },
        provenance: {
          provider: "Hyperliquid",
          source: "live_l2_book",
          observed_at: observedAt,
          age_ms: 0,
          freshness: "current",
          exact_identity: true,
          levels_available: 20,
        },
        review: {
          state: "market_preview_only",
          review_ready: false,
          blockers: ["venue_account_required", "account_fee_tier_required"],
        },
        execution_boundary: {
          market_preview_only: true,
          account_connected: false,
          prepared_order_available: false,
          signing_available: false,
          submission_available: false,
          position_monitoring_available: false,
        },
      }),
    });
  });
  return { calls, markets };
}

export async function waitForTerminalLive(page, expected = {}) {
  await page.waitForFunction((wanted) => {
    const terminal = window.__RAVENOS_TERMINAL__?.getState?.();
    if (!terminal || terminal.candleCount < 20 || !document.querySelector("#terminalChart canvas")) return false;
    if (wanted.instrument && terminal.instrument !== wanted.instrument) return false;
    if (wanted.timeframe && terminal.timeframe !== wanted.timeframe) return false;
    if (wanted.lane && terminal.lane !== wanted.lane) return false;
    return true;
  }, expected);
}
