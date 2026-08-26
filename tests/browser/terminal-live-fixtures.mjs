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
      public_context_id: `context:${coin}:fixture`,
      instrument_id: `hyperliquid:perp:${coin}`,
      context_available: true,
      context_state: "fresh",
      observed_at: "2026-07-21T12:18:00Z",
      observed_side: "long",
      behavior_family: asset === "BTC-PERP" ? "Pressure reset" : "Behavioral setup",
      pressure_state: asset === "BTC-PERP" ? "Balanced pressure" : "Mixed pressure",
      current_path: asset === "BTC-PERP" ? "Reset forming" : "Followthrough forming",
      entry_reference: { price: 148, observed_at: "2026-07-21T12:18:00Z", source: "decision-time mark" },
      outcomes: { evidence_maturity: "matured", sample_size: asset === "BTC-PERP" ? 84 : 128 },
    },
    raven_read: {
      headline: `${asset} · ${asset === "BTC-PERP" ? "Pressure reset" : "Behavioral setup"}`,
      summary: "A timestamped market observation is joined to this exact venue instrument.",
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
    plan_preview: {
      schema_version: "ravenos.plan_preview.v1",
      plan_id: `context:${coin}:fixture:plan:v1`,
      state: "research_only",
      enabled_by_default: false,
      opt_in_required: true,
      instrument_id: `hyperliquid:perp:${coin}`,
      direction: "long",
      as_of: "2026-07-21T12:18:00Z",
      frozen_context_id: `context:${coin}:fixture`,
      sample_size: asset === "BTC-PERP" ? 84 : 128,
      evidence_maturity: "matured",
      levels: {
        entry_reference: { price: 148, observed_at: "2026-07-21T12:18:00Z", source: "decision-time mark" },
        target_reference: { price: 152.588, excursion_pct: 3.1, source: "median favorable excursion" },
        risk_reference: { price: 146.224, excursion_pct: -1.2, source: "median adverse excursion" },
      },
      production_qualified: false,
      personalized: false,
      executable: false,
      signing_available: false,
      submission_available: false,
    },
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
      book: {
        observed_at: "2026-07-21T12:20:00Z",
        summary: { best_bid: 148.23, best_ask: 148.27, spread_bps: 2.664, bid_notional_usd: 32_000, ask_notional_usd: 25_500, imbalance_pct: 11.3 },
        bids: [
          { price: 148.23, size: 80.96, order_count: 12, notional_usd: 12_000 },
          { price: 148.2, size: 53.98, order_count: 8, notional_usd: 8_000 },
          { price: 148.16, size: 47.25, order_count: 9, notional_usd: 7_000 },
          { price: 148.1, size: 33.76, order_count: 5, notional_usd: 5_000 },
        ],
        asks: [
          { price: 148.27, size: 67.44, order_count: 10, notional_usd: 10_000 },
          { price: 148.3, size: 47.2, order_count: 7, notional_usd: 7_000 },
          { price: 148.35, size: 37.75, order_count: 6, notional_usd: 5_600 },
          { price: 148.41, size: 19.54, order_count: 4, notional_usd: 2_900 },
        ],
      },
      tape: {
        trades: [
          { observed_at: "2026-07-21T12:20:00Z", book_side: "bid", price: 148.26, size: 8.4, notional_usd: 1_245.38 },
          { observed_at: "2026-07-21T12:19:58Z", book_side: "ask", price: 148.24, size: 3.1, notional_usd: 459.54 },
          { observed_at: "2026-07-21T12:19:55Z", book_side: "bid", price: 148.27, size: 12.7, notional_usd: 1_883.03 },
          { observed_at: "2026-07-21T12:19:51Z", book_side: "ask", price: 148.23, size: 5.8, notional_usd: 859.73 },
        ],
      },
      components: { market: "fresh", book: "fresh", tape: "fresh" },
    },
    chart_overlays: {
      schema_version: "ravenos.chart_overlays.v1",
      instrument_id: `hyperliquid:perp:${coin}`,
      role: "annotation_only",
      candle_replacement_allowed: false,
      overlays: [
        { id: `context:${coin}:fixture:plan:v1:plan-entry`, instrument_id: `hyperliquid:perp:${coin}`, type: "plan-entry", label: "Decision reference", summary: "decision-time mark", severity: "info", priceMin: 148, priceMax: 148, startTime: 1_784_592_000, observed_at: "2026-07-21T12:18:00Z", lineage: { public_context_id: `context:${coin}:fixture` } },
        { id: `context:${coin}:fixture:plan:v1:plan-target`, instrument_id: `hyperliquid:perp:${coin}`, type: "plan-target", label: "Historical favorable reference", summary: "median favorable excursion", severity: "success", priceMin: 152.588, priceMax: 152.588, startTime: 1_784_592_000, observed_at: "2026-07-21T12:18:00Z", lineage: { public_context_id: `context:${coin}:fixture` } },
        { id: `context:${coin}:fixture:plan:v1:plan-risk`, instrument_id: `hyperliquid:perp:${coin}`, type: "plan-risk", label: "Historical adverse reference", summary: "median adverse excursion", severity: "danger", priceMin: 146.224, priceMax: 146.224, startTime: 1_784_592_000, observed_at: "2026-07-21T12:18:00Z", lineage: { public_context_id: `context:${coin}:fixture` } },
      ],
    },
    delivery: { source: "current_public_origin", freshness_state: "fresh", fallback: false },
  };
}

export async function mockTerminalLiveApis(page, { chartFailure = false, flagsEnabled = false, sparseTimeframe = null, liveBars = false, quietSpot = false, spotRavenContext = true } = {}) {
  const calls = [];
  const markets = [marketRow("SOL-PERP"), marketRow("BTC-PERP")];
  await page.route("https://assets.geckoterminal.com/token-fixture.png", (route) => route.fulfill({
    status: 200,
    contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  }));
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
    const limit = Number(url.searchParams.get("limit"));
    const before = url.searchParams.get("before");
    calls.push({ asset, timeframe, market, pairAddress, instrumentId, limit, before });
    if (chartFailure) return route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ ok: false, error: "provider_unavailable", freshness_state: "data_unavailable", candles: [] }) });
    const perp = asset.endsWith("-PERP");
    const traditional = market === "equities";
    const spotChain = chain || "solana";
    const quietExactPool = Boolean(pairAddress && quietSpot);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        asset,
        source: perp ? "Hyperliquid" : traditional ? "Yahoo Finance" : "DexPaprika",
        source_label: perp ? "Live perps market price" : traditional ? "Live market price" : "Exact public pool",
        freshness_state: "fresh",
        provider_freshness_state: pairAddress ? "current" : null,
        candle_freshness_state: pairAddress ? quietExactPool ? "delayed" : "current" : null,
        market_activity_state: pairAddress ? quietExactPool ? "no_recent_trades" : "active" : null,
        last_candle_at: pairAddress ? "2026-07-21T11:58:00Z" : null,
        last_candle_age_seconds: pairAddress ? quietExactPool ? 1_320 : 0 : null,
        market_health: pairAddress ? {
          schema_version: "ravenos.onchain_market_state.v1",
          provider_delivery_state: "current",
          market_snapshot_state: "current",
          candle_recency_state: quietExactPool ? "delayed" : "current",
          market_activity_state: quietExactPool ? "no_recent_trades" : "active",
          chart_state: quietExactPool ? "current_no_recent_trades" : "current",
          operator_label: quietExactPool ? "No recent trades" : "Current",
          last_candle_age_seconds: quietExactPool ? 1_320 : 0,
        } : null,
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
          buys_24h: 7_300,
          sells_24h: 5_100,
          market_cap_usd: 3_100_000_000,
          pool_age_ms: 180 * 86_400_000,
          holder_distribution: {
            state: "available",
            scope: "exact_token",
            observed_at: new Date().toISOString(),
            holder_count: 4_852,
            top_10_pct: 29.95,
            next_10_pct: 12.4593,
            next_20_pct: 15.1691,
            rest_pct: 42.4216,
            change_5m_pct: spotRavenContext && spotChain === "solana" ? 1.8 : null,
            change_1h_pct: spotRavenContext && spotChain === "solana" ? 6.4 : null,
            change_24h_pct: spotRavenContext && spotChain === "solana" ? 18.2 : null,
          },
          market_profile: {
            schema_version: "ravenos.onchain_market_profile.v1",
            identity: {
              state: "exact",
              chain: spotChain,
              pool_address: pairAddress,
              token_address: tokenAddress,
              quote_token_address: quoteAddress,
            },
            token: {
              name: asset.split("/")[0],
              symbol: asset.split("/")[0],
              decimals: 9,
              image_url: "https://assets.geckoterminal.com/token-fixture.png",
            },
            holder_distribution: {
              state: "available",
              holder_count: 4_852,
              observed_at: new Date().toISOString(),
              top_10_pct: 29.95,
              next_10_pct: 12.4593,
              next_20_pct: 15.1691,
              rest_pct: 42.4216,
            },
            token_controls: {
              mint_authority: "disabled",
              freeze_authority: "disabled",
              honeypot: "not_flagged",
              developer_holding_pct: 1.74,
            },
            launch: { completed: true, completed_at: new Date().toISOString() },
            links: [
              { kind: "website", label: "jup.ag", url: "https://jup.ag/" },
              { kind: "x", label: "X", url: "https://x.com/JupiterExchange" },
            ],
            attribution: {
              required: true,
              label: "Data provided by CoinGecko",
              url: "https://www.coingecko.com/",
            },
          },
          current_activity: spotRavenContext && spotChain === "solana" ? {
            observed_at: new Date().toISOString(),
            market_age_seconds: 180 * 86_400,
            volume_usd_5m: 140_000,
            volume_usd_1h: 2_100_000,
            volume_usd_24h: 16_500_000,
            buys_5m: 64,
            sells_5m: 26,
            traders_5m: 72,
            buys_1h: 320,
            sells_1h: 130,
            traders_1h: 240,
            buys_24h: 7_300,
            sells_24h: 5_100,
            traders_24h: 2_800,
          } : null,
          raven_context: spotRavenContext && spotChain === "solana" ? {
            schema_version: "ravenos.spot_market_context.v1",
            state: "current",
            evidence_scope: "exact_pool",
            scope_label: "This exact pool",
            chain: "solana",
            token_address: tokenAddress,
            selected_pool_address: pairAddress,
            evidence_pool_address: pairAddress,
            symbol: asset.split("/")[0],
            name: asset.split("/")[0],
            observed_at: new Date(Date.now() - 45_000).toISOString(),
            projection_generated_at: new Date().toISOString(),
            source_age_seconds: 5,
            movement_state: "Activity accelerating",
            what_changed: "Price rose while volume, buyers, and active traders expanded.",
            risk: "Short-window movement still needs follow-through.",
            market: {
              holder_count: 1_240,
              holder_change_1h_pct: 6.4,
              volume_usd_5m: 140_000,
              buys_5m: 64,
              sells_5m: 26,
              traders_5m: 72,
            },
            broader_attention: {
              state: "raven_observed_first",
              raven_observed_first: true,
              lead_seconds: 1_200,
              observed_at: new Date(Date.now() - 20 * 60_000).toISOString(),
              summary: "Raven recorded this market 20m before broader attention appeared.",
            },
            evidence_state: "observed",
            research_only: true,
            actionable: false,
            execution_available: false,
            signing_available: false,
            submission_available: false,
          } : null,
          route: { state: spotChain === "solana" ? "review_capability_check_required" : "unavailable", signing_available: false, submission_available: false },
          provider_freshness_state: "current",
          candle_freshness_state: quietExactPool ? "delayed" : "current",
          market_activity_state: quietExactPool ? "no_recent_trades" : "active",
          last_candle_at: "2026-07-21T11:58:00Z",
          last_candle_age_seconds: quietExactPool ? 1_320 : 0,
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
      order_plan_available: true,
      order_plan_markets: ["hyperliquid_perpetual"],
      order_plan_types: ["market", "limit", "trigger"],
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
  await page.route("**/api/trade/order-plan", async (route) => {
    const input = route.request().postDataJSON();
    const coin = String(input.instrument_id || "hyperliquid:perp:SOL").split(":").pop();
    const side = input.side === "short" ? "short" : "long";
    const orderType = ["market", "limit", "trigger"].includes(input.order_type) ? input.order_type : "market";
    const notional = Number(input.notional_usdc || 500);
    const leverage = Number(input.leverage || 3);
    const mid = coin === "BTC" ? 67_500 : 148.25;
    const bestBid = mid * 0.99995;
    const bestAsk = mid * 1.00005;
    const vwap = side === "long" ? mid * 1.00008 : mid * 0.99992;
    const limitPrice = orderType === "limit" ? Number(input.limit_price) : null;
    const triggerPrice = orderType === "trigger" ? Number(input.trigger_price) : null;
    const marketable = orderType === "market" || (orderType === "limit" && (side === "long" ? limitPrice >= bestAsk : limitPrice <= bestBid));
    const entryReference = orderType === "market" ? vwap : orderType === "limit" ? limitPrice : triggerPrice;
    const takeProfit = Number(input.take_profit_price) || null;
    const stopLoss = Number(input.stop_loss_price) || null;
    const rewardPct = takeProfit ? Math.abs(takeProfit - entryReference) / entryReference * 100 : null;
    const riskPct = stopLoss ? Math.abs(stopLoss - entryReference) / entryReference * 100 : null;
    const observedAt = new Date().toISOString();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        schema_version: "ravenos.hyperliquid_order_plan.v1",
        state: "order_plan_available",
        plan_id: `hlop_fixture_${coin}_${side}_${orderType}_${notional}_${leverage}`,
        generated_at: observedAt,
        expires_at: new Date(Date.now() + 30_000).toISOString(),
        instrument: { instrument_id: input.instrument_id, exact_market_id: coin, symbol: `${coin}-PERP`, venue: "hyperliquid", instrument_type: "perpetual", identity_scope: "exact_instrument", collateral_asset: "USDC" },
        intent: {
          side,
          order_type: orderType,
          time_in_force: orderType === "limit" ? input.time_in_force || "gtc" : null,
          requested_notional_usdc: notional,
          leverage,
          limit_price: limitPrice,
          trigger_price: triggerPrice,
          estimated_initial_margin_usdc: notional / leverage,
          planned_base_size: notional / entryReference,
          margin_estimate_excludes_existing_exposure: true,
        },
        entry_model: {
          state: orderType === "market" ? "current_book_fill_estimate" : orderType === "trigger" ? "conditional_stop_entry" : marketable ? "currently_marketable_limit" : "resting_limit",
          marketable,
          fill_guaranteed: false,
          reference_price: entryReference,
          reference_source: orderType === "market" || marketable ? "current_live_book_vwap" : orderType === "limit" ? "user_limit_price" : "user_trigger_price",
          distance_from_mid_bps: orderType === "market" ? null : ((entryReference - mid) / mid) * 10_000,
          future_fill_price_estimated: orderType === "trigger" ? false : undefined,
        },
        ...(marketable ? { fill_estimate: { base_size: notional / vwap, vwap_price: vwap, worst_price: side === "long" ? vwap * 1.00002 : vwap * 0.99998, mid_price: mid, best_bid: bestBid, best_ask: bestAsk, spread_bps: 1, price_impact_bps: 0.8, visible_levels_consumed: 2 } } : {}),
        ...(takeProfit || stopLoss ? { risk_bracket: { configured: true, take_profit_price: takeProfit, stop_loss_price: stopLoss, reward_pct: rewardPct, risk_pct: riskPct, reward_to_risk: rewardPct && riskPct ? rewardPct / riskPct : null, target_pnl_usdc: rewardPct ? notional * rewardPct / 100 : null, stop_pnl_usdc: riskPct ? -notional * riskPct / 100 : null, fees_and_slippage_included: false, orders_prepared: false } } : {}),
        market_reference: { mid_price: mid, best_bid: bestBid, best_ask: bestAsk, spread_bps: 1 },
        provenance: { provider: "Hyperliquid", source: "live_l2_book", observed_at: observedAt, age_ms: 0, freshness: "current", exact_identity: true },
        review: { state: "order_plan_only", prepared_payload_included: false, account_state_included: false, user_confirmation_recorded: false },
        execution_boundary: { order_plan_only: true, account_connected: false, prepared_order_available: false, signing_available: false, submission_available: false, position_monitoring_available: false },
      }),
    });
  });
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
