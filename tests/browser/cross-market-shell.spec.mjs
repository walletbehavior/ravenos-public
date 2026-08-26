import { test, expect } from "@playwright/test";

import { mockTerminalLiveApis, ROBINHOOD_CONTRACT, waitForTerminalLive } from "./terminal-live-fixtures.mjs";

const markets = [
  {
    asset: "SOL-PERP",
    symbol: "SOL",
    instrument_id: "hyperliquid:perp:SOL",
    last_price: 102.4,
    funding_rate: -0.000012,
    day_change_pct: 2.4,
    day_notional_volume_usd: 480_000_000,
    open_interest_usd: 192_000_000,
  },
  {
    asset: "BTC-PERP",
    symbol: "BTC",
    instrument_id: "hyperliquid:perp:BTC",
    day_change_pct: -0.8,
    day_notional_volume_usd: 1_400_000_000,
    open_interest_usd: 820_000_000,
  },
];

const opportunityRows = [
  {
    public_opportunity_id: "rop_sol_fixture",
    instrument_id: "hyperliquid:perp:SOL",
    instrument: "SOL-PERP",
    market_type: "perpetual",
    identity_scope: "exact venue instrument",
    context_state: "fresh",
    why_raven_noticed: "Raven froze a behavioral setup observation while mixed pressure was present.",
    pressure_state: "Mixed pressure",
    observed_direction: "long",
    context_age_seconds: 300,
    path_review: { state: "forward path reviewing" },
    matured_comparables: {
      sample_size: 128,
      positive_followthrough_rate: 0.57,
      median_favorable_excursion_pct: 1.42,
      median_adverse_excursion_pct: -0.71,
    },
    market_context: { entry_reference_price: 100, roundtrip_bps: 8, funding_rate: -0.000012, open_interest: 192_000_000 },
    research_only: true,
    execution_available: false,
  },
];

const spotTokenAddress = "11111111111111111111111111111111";
const spotPoolAddress = "22222222222222222222222222222222";
const spotTokenOnlyAddress = "33333333333333333333333333333333";
const basePulsePool = "0x1111111111111111111111111111111111111111";
const basePulseToken = "0x2222222222222222222222222222222222222222";
const basePulseQuote = "0x3333333333333333333333333333333333333333";
const ethereumPulsePool = "0x4444444444444444444444444444444444444444";
const ethereumPulseToken = "0x5555555555555555555555555555555555555555";
const ethereumPulseQuote = "0x6666666666666666666666666666666666666666";

const spotAttentionRows = [
  {
    public_attention_id: "rta_retire_fixture",
    instrument_id: "spot_retire_fixture",
    market_type: "spot",
    chain: "Solana",
    venue: "Meteora",
    identity_scope: "exact_pool",
    symbol: "RETIRE",
    name: "Retire",
    token_address: spotTokenAddress,
    pool_address: spotPoolAddress,
    observed_at: "2026-07-21T12:20:00Z",
    age_seconds: 20,
    movement_state: "Activity accelerating",
    what_changed: "Price rose 8.50% in 5m. Volume expanded 42.0% · buys led 64 to 26 · 72 active traders.",
    risk: "Short-window movement can reverse before broader follow-through develops.",
    market: {
      price_usd: 0.0012,
      price_change_5m_pct: 8.5,
      price_change_1h_pct: 18,
      price_change_24h_pct: 31,
      buys_5m: 64,
      sells_5m: 26,
      traders_5m: 72,
      buys_1h: 320,
      sells_1h: 130,
      traders_1h: 240,
      buys_24h: 1_280,
      sells_24h: 520,
      traders_24h: 300,
      volume_usd_5m: 14_000,
      volume_usd_1h: 92_000,
      volume_usd_24h: 510_000,
      liquidity_usd: 82_000,
      holder_count: 1_240,
      market_age_seconds: 7_200,
    },
    broader_attention: {
      state: "raven_observed_first",
      raven_observed_first: true,
      lead_seconds: 1_200,
      observed_at: "2026-07-21T12:19:00Z",
      summary: "Raven recorded this market 20m before broader attention appeared.",
    },
    inspection: { state: "exact_pool_ready", silent_pool_selection: false },
    research_only: true,
    actionable: false,
    execution_available: false,
  },
  {
    public_attention_id: "rta_search_fixture",
    instrument_id: "spot_search_fixture",
    market_type: "spot",
    chain: "Solana",
    venue: null,
    identity_scope: "exact_token",
    symbol: "BIRD",
    name: "Bird",
    token_address: spotTokenOnlyAddress,
    pool_address: null,
    observed_at: "2026-07-21T12:20:00Z",
    age_seconds: 35,
    movement_state: "Fast expansion",
    what_changed: "Price rose 4.10% in 5m. Buys led 31 to 18 · 44 active traders.",
    risk: "Short-window movement can reverse before broader follow-through develops.",
    market: {
      price_usd: 0.0008,
      price_change_5m_pct: 4.1,
      price_change_1h_pct: 12,
      price_change_24h_pct: 88,
      buys_5m: 31,
      sells_5m: 18,
      traders_5m: 44,
      buys_1h: 190,
      sells_1h: 110,
      traders_1h: 180,
      buys_24h: 2_400,
      sells_24h: 1_100,
      traders_24h: 700,
      volume_usd_5m: 8_000,
      volume_usd_1h: 48_000,
      volume_usd_24h: 940_000,
      liquidity_usd: 41_000,
      holder_count: 620,
    },
    broader_attention: {
      state: "not_confirmed",
      raven_observed_first: false,
      lead_seconds: null,
      observed_at: null,
      summary: "Broader attention has not been confirmed in the retained comparison.",
    },
    inspection: { state: "exact_market_selection_required", silent_pool_selection: false },
    research_only: true,
    actionable: false,
    execution_available: false,
  },
];

function onchainPulsePayload(rows = []) {
  return {
    ok: true,
    safe_public: true,
    schema_version: "ravenos.onchain_market_pulse.v1",
    generated_at: "2026-07-21T12:20:00Z",
    state: "current",
    freshness: { state: "current", observed_at: "2026-07-21T12:20:00Z", expected_update_seconds: 30 },
    duration: "5m",
    chains: ["base", "ethereum"],
    rows,
    unavailable: [],
    provenance: {
      provider: "coingecko_onchain",
      role: "exact_pool_market_activity",
      raven_signal: false,
      attribution_required: true,
      attribution_label: "Data provided by CoinGecko",
      attribution_url: "https://www.coingecko.com/",
    },
    execution_boundary: { research_only: true, signing_available: false, submission_available: false },
  };
}

const evmPulseRows = [
  {
    public_attention_id: `market:base:${basePulsePool}`,
    instrument_id: `base:pool:${basePulsePool}`,
    source_type: "market_activity",
    market_type: "spot",
    chain: "Base",
    chain_id: "base",
    venue: "Aerodrome",
    identity_scope: "exact_pool",
    symbol: "AERO",
    name: "Aerodrome",
    token_address: basePulseToken,
    quote_token_address: basePulseQuote,
    quote_symbol: "USDC",
    pool_address: basePulsePool,
    observed_at: "2026-07-21T12:20:00Z",
    age_seconds: 0,
    context_state: "current",
    movement_state: "Rising activity",
    what_changed: "Price is up 6.20% over 5m · buy flow leads 62 to 21 · $184K volume.",
    risk: null,
    provider_rank: 1,
    ranking_duration: "5m",
    market: {
      price_usd: 0.84,
      price_change_5m_pct: 6.2,
      price_change_1h_pct: 12.4,
      price_change_24h_pct: 18.8,
      volume_usd_5m: 184_000,
      volume_usd_1h: 940_000,
      volume_usd_24h: 8_400_000,
      buys_5m: 62,
      sells_5m: 21,
      buys_1h: 241,
      sells_1h: 118,
      buys_24h: 1_200,
      sells_24h: 840,
      liquidity_usd: 3_200_000,
      market_cap_usd: 420_000_000,
    },
    inspection: { state: "exact_pool_ready", silent_pool_selection: false },
    research_only: true,
    actionable: false,
    execution_available: false,
  },
  {
    public_attention_id: `market:ethereum:${ethereumPulsePool}`,
    instrument_id: `ethereum:pool:${ethereumPulsePool}`,
    source_type: "market_activity",
    market_type: "spot",
    chain: "Ethereum",
    chain_id: "ethereum",
    venue: "Uniswap V3",
    identity_scope: "exact_pool",
    symbol: "WETH",
    name: "Wrapped Ether",
    token_address: ethereumPulseToken,
    quote_token_address: ethereumPulseQuote,
    quote_symbol: "USDC",
    pool_address: ethereumPulsePool,
    observed_at: "2026-07-21T12:20:00Z",
    age_seconds: 0,
    context_state: "current",
    movement_state: "Active and range-bound",
    what_changed: "Price is nearly flat over 5m · 184 trades are balanced · $2.4M volume.",
    risk: null,
    provider_rank: 1,
    ranking_duration: "5m",
    market: {
      price_usd: 3_850,
      price_change_5m_pct: 0.02,
      price_change_1h_pct: 0.8,
      price_change_24h_pct: 2.4,
      volume_usd_5m: 2_400_000,
      volume_usd_1h: 18_000_000,
      volume_usd_24h: 210_000_000,
      buys_5m: 94,
      sells_5m: 90,
      buys_1h: 520,
      sells_1h: 498,
      buys_24h: 6_200,
      sells_24h: 6_010,
      liquidity_usd: 86_000_000,
      market_cap_usd: 460_000_000_000,
    },
    inspection: { state: "exact_pool_ready", silent_pool_selection: false },
    research_only: true,
    actionable: false,
    execution_available: false,
  },
];

function opportunityPayload({ withSpot = false, rows = opportunityRows } = {}) {
  return {
    ok: true,
    schema_version: "ravenos.opportunity_workspace.v2",
    participation_payoff: {
      schema_version: "ravenos.participation_payoff.v1",
      generated_at: "2026-07-21T12:20:00Z",
      state: "current",
      public_safe: true,
      headline: "Participation payoff",
      summary: "Solana cohorts lead. Solana fresh pairs are split. Ethereum large caps are punishing.",
      comparison: "Solana cohorts have settled follow-through; Ethereum cohorts and Base cohorts remain mixed.",
      measurement: {
        display_window: "Latest samples",
        minimum_usable_sample: 20,
        population: "Sampled public markets; not a comprehensive market census.",
        causal_claim: false,
      },
      insights: [
        { insight_id: "participation:solana:participant_cohorts:rewarding", state: "rewarding", label: "Working", subject: "Solana cohorts", operator_detail: "88 settled observations", usable_sample: 88, observed_sample: 94, observation_window: "current", confidence: "medium" },
        { insight_id: "participation:solana:fresh_pairs:fragile", state: "fragile", label: "Fragile", subject: "Solana fresh pairs", operator_detail: "6h median +6.6% · 43% fell 10%+ over 24h", usable_sample: 31, observed_sample: 44, observation_window: "24h", confidence: "medium" },
        { insight_id: "participation:eth:large:punishing", state: "punishing", label: "Punishing", subject: "Ethereum large caps", operator_detail: "6h -1.3% · 24h -2.8%", usable_sample: 33, observed_sample: 39, observation_window: "24h", confidence: "medium" },
      ],
    },
    census: {
      schema_version: "ravenos_opportunity_census_public_v1",
      generated_at: "2026-07-21T12:20:00Z",
      source_state: "current",
      opportunities: { rows },
      ...(withSpot ? {
        spot_attention: {
          schema_version: "ravenos.token_attention.v1",
          generated_at: "2026-07-21T12:20:00Z",
          state: "current",
          age_seconds: 20,
          row_count: spotAttentionRows.length,
          rows: spotAttentionRows,
          selection: {
            ranked_trade_list: false,
            broader_attention_affects_ranking: false,
          },
          execution_boundary: {
            research_only: true,
            actionable: false,
            signing_available: false,
            submission_available: false,
            capital_assigned: 0,
          },
        },
      } : {}),
    },
    current_opportunity: rows[0] || null,
    delivery: { source: "current_public_origin", freshness_state: "fresh", fallback: false },
  };
}

function healthPayload() {
  return {
    ok: true,
    process_health: { state: "operational" },
    market_data_health: { state: "fresh" },
    intelligence_freshness: { state: "fresh", research: { state: "stale" } },
    narrator_freshness: { state: "stale" },
    projection_health: { state: "operational" },
    publisher_health: { state: "unknown" },
  };
}

function briefPayload() {
  return {
    ok: true,
    safe_public: true,
    schema_version: "ravenos_brief_public_origin_v1",
    generated_at: "2026-07-21T12:20:00Z",
    data: {
      schema_version: "ravenos_brief_synthesized_public_v1",
      generated_at: "2026-07-21T12:20:00Z",
      one_sentence_read: "Solana is leading current opportunity, but followthrough remains selective.",
      best_opportunity_surface: "Solana leading",
      participation_change: "Expanding selectively",
      pressure_change: "Pressure is still forming",
      reward_change: "Cleaner cohorts are following through",
    },
    delivery: { source: "current_public_origin", freshness_state: "fresh", fallback: false },
  };
}

function atlasPayload() {
  return {
    ok: true,
    schema_version: "ravenos.atlas_projection.v1",
    generated_at: "2026-07-21T12:20:00Z",
    state: "available",
    freshness: { state: "fresh", age_seconds: 20, target_seconds: 1800 },
    posture: { state: "risk selective", confidence: "moderate", alignment: "mixed" },
    market_context: {
      risk_regime: "mixed",
      equity_regime: "constructive",
      sector_breadth: "broad",
      participation_quality: "healthy",
      rows: [{
        instrument_id: "etf:nyse-arca:spy",
        instrument: {
          schema_version: "ravenos.instrument.v1",
          instrument_id: "etf:nyse-arca:spy",
          symbol: "SPY",
          display_name: "State Street SPDR S&P 500 ETF Trust",
          asset_class: "etf",
          instrument_type: "etf",
          identity_scope: "exact_instrument",
          venue: "nyse-arca",
          chain: "none",
          market_identity: { market_id: "SPY", listing: "NYSE Arca" },
          quote_asset: { symbol: "USD", asset_id: "USD" },
          settlement_asset: { symbol: "USD", asset_id: "USD" },
          economic_numeraire: "USDC",
          market_session: { state: "regular", observed_at: "2026-07-21T12:20:00Z" },
          capabilities: { chart: true, atlas_intelligence: true, options_summary: true, raven_intelligence: false, execution: false },
        },
        symbol: "SPY",
        price: 640.25,
        change_5d: 0.012,
        change_21d: 0.031,
        change_63d: 0.066,
        provider: "Massive",
        observed_at: "2026-07-21T12:20:00Z",
      }],
    },
    options_context: [{ underlying: "SPY", underlying_instrument_id: "etf:nyse-arca:spy", regime: "balanced", skew_state: "neutral", demand_state: "steady", quality: "current", provider: "Tradier", delayed: false }],
    rail_breadth: { equity: { trend: "positive", participation: "broad" } },
    provider_health: {},
    capabilities: { market_map: true, exact_instrument_context: true, options_summary: true, browser_provider_credentials: false },
    execution_boundary: { research_only: true, broker_connection_available: false, quote_preview_available: false, signing_available: false, submission_available: false, position_monitoring_available: false },
    public_safety: { aggregate_only: true, provider_payloads_removed: true, provider_urls_removed: true, credentials_removed: true, paper_engine_removed: true, proprietary_calibration_removed: true },
    unavailable: { company_context: "not_projected", full_options_chain: "not_projected", events: "not_projected", relationships: "not_projected" },
    delivery: { source: "current_public_origin", freshness_state: "fresh", fallback: false },
  };
}

async function mockWorkspaceApis(page, {
  opportunityStatus = 200,
  opportunityRowsOverride = null,
  withSpot = false,
  withEvmPulse = false,
  spotSearchResults = [],
} = {}) {
  await page.route("**/api/dexscreener/search**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, results: spotSearchResults }),
  }));
  await page.route("**/api/hyperliquid/perps", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, results: markets }) }));
  await page.route("**/api/onchain/trending**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(onchainPulsePayload(withEvmPulse ? evmPulseRows : [])),
  }));
  await page.route("**/api/opportunity**", (route) => route.fulfill({
    status: opportunityStatus,
    contentType: "application/json",
    body: JSON.stringify(opportunityStatus === 200 ? opportunityPayload({ withSpot, rows: opportunityRowsOverride || opportunityRows }) : {
      ok: false,
      status: "unavailable",
      error: "opportunity_census_projection_unavailable",
      census: null,
      current_opportunity: null,
      historical_context: { current_data_substituted: false },
    }),
  }));
  await page.route("**/api/health", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(healthPayload()) }));
  await page.route("**/api/brief", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(briefPayload()) }));
  await page.route("**/api/atlas", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ ok: false, error: "atlas_projection_unavailable" }),
  }));
}

test("four primary destinations replace chain and market mode navigation", async ({ page }) => {
  await mockWorkspaceApis(page);
  await page.goto("/discover/");
  await expect(page.locator(".ros-workspace-nav a > span:last-child")).toHaveText(["Discover", "Terminal", "Portfolio", "Atlas"]);
  await expect(page.locator(".ros-left-nav")).toHaveCount(0);
  await expect(page.locator(".ros-workspace-nav")).not.toContainText(/Solana|Base|Spot|Perps|Robinhood|Tradier/);
  await expect(page.locator("#discoverSearchTrigger")).toContainText("Search any supported instrument");

  await page.locator("#rosCommandTrigger").click();
  await page.locator("#rosCommandInput").fill("Replay");
  await expect(page.locator(".ros-command-result.route")).toHaveCount(0);
  await expect(page.locator(".ros-command-empty")).toContainText("No supported instrument matched");
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".ros-mobile-nav")).toBeVisible();
  await expect(page.locator(".ros-mobile-nav > *")).toHaveText(["DDiscover", "TTerminal", "PPortfolio", "AAtlas"]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});

test("each primary destination declares the operator question it must answer", async ({ page }) => {
  await mockWorkspaceApis(page);
  await mockTerminalLiveApis(page);
  const destinations = [
    ["/discover/", ".workspace-question", "What deserves my attention?"],
    ["/terminal/", ".terminal-question", "What is happening right now?"],
    ["/portfolio/", ".workspace-question", "What do I own, what changed, and where is my risk?"],
    ["/atlas/", ".workspace-question", "What does the broader market imply?"],
  ];
  for (const [route, selector, question] of destinations) {
    await page.goto(route);
    await expect(page.locator(selector)).toHaveText(question);
  }
});

test("Discover joins only current Census rows to exact live venue identities", async ({ page }) => {
  await mockWorkspaceApis(page);
  await page.goto("/discover/");
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_DISCOVER__?.getState().rowCount)).toBe(1);
  const row = page.locator(".discover-row").first();
  await expect(row).toContainText("SOL-PERP");
  await expect(row).toContainText("+2.40% over 24h");
  await expect(row).toContainText("128 similar periods · 57% finished higher");
  await expect(row).toContainText("Price is following through in Raven's observed direction.");
  await expect(row).toContainText("Choppy / mixed");
  await expect(row.locator(".discover-thesis > span")).toHaveText("What changed");
  await expect(row).toHaveAttribute("href", /instrument_id=hyperliquid%3Aperp%3ASOL/);
  await expect(page.locator("#discoverCensusState")).toHaveText("Current");
  await expect(page.locator("#discoverMarketState")).toHaveText("Current");
  await expect(page.locator("#discoverPayoff")).toBeVisible();
  await expect(page.locator("#discoverPayoffTitle")).toHaveText("Participation payoff");
  await expect(page.locator("#discoverPayoffSummary")).toContainText("Solana fresh pairs are split");
  await expect(page.locator("#discoverPayoffStrip article")).toHaveCount(3);
  await expect(page.locator("#discoverPayoffStrip")).toContainText("Solana cohorts");
  await expect(page.locator("#discoverPayoffStrip")).toContainText("6h median +6.6%");
  await expect(page.locator("#discoverPayoffStrip")).toContainText("Ethereum large caps");
  await expect(page.locator("#discoverPayoff")).not.toContainText(/solana live/i);
  await expect(page.locator("#discoverDesk")).toBeVisible();
  await expect(page.locator("#discoverDeskSummary")).toContainText("Solana is leading current opportunity");
  await expect(page.locator("#discoverDeskGrid")).toContainText("Setup lifecycle");
  await expect(row).toHaveAttribute("data-lifecycle", "confirmed");
  await expect(row.locator(".discover-opportunity-meta")).toContainText(/Confirmed.*High signal/s);
  await expect(page.getByRole("button", { name: /\b(?:buy|sell|long|short|sign|submit|execute)\b/i })).toHaveCount(0);
});

test("Discover holds directionless evidence below the setup queue without placeholder copy", async ({ page }) => {
  const watchOnly = structuredClone(opportunityRows[0]);
  watchOnly.observed_direction = "unavailable";
  watchOnly.raven_atoms = [];
  watchOnly.matured_comparables = {
    sample_size: 0,
    evidence_maturity: "unavailable",
    positive_followthrough_rate: null,
    median_favorable_excursion_pct: null,
    median_adverse_excursion_pct: null,
  };
  await mockWorkspaceApis(page, { opportunityRowsOverride: [watchOnly] });
  await page.goto("/discover/");
  const row = page.locator(".discover-row");
  await expect(row).toHaveAttribute("data-lifecycle", "watch");
  await expect(row).toBeHidden();
  await expect(page.locator(".discover-filter-empty")).toContainText("No active setups clear Raven's lifecycle gate");
  await page.getByRole("button", { name: "Review 1 lower-confidence or decayed read" }).click();
  await expect(row).toBeVisible();
  await expect(row.locator(".discover-opportunity-meta")).toContainText(/Watch.*Watch only/s);
  await expect(row).not.toContainText(/unknown|unavailable/i);
  await expect(row).toContainText("8.0 bps observed round trip");
});

test("Discover resolves an exact-token movement directly to its best chartable pool", async ({ page }) => {
  const resolvedPool = {
    chainId: "solana",
    dexId: "raydium",
    pairAddress: "44444444444444444444444444444444",
    tokenAddress: spotTokenOnlyAddress,
    quoteTokenAddress: "55555555555555555555555555555555",
    symbol: "BIRD",
    name: "Bird",
    quoteSymbol: "USDC",
    priceUsd: 0.0008,
    liquidityUsd: 0,
    volume24h: 920_000,
    txns24h: 1_260,
    marketCap: 480_000,
    priceChange24h: 18,
    lastUpdated: "2026-07-21T12:20:00Z",
    chart_coverage: {
      schema_version: "ravenos.search_chart_coverage.v1",
      state: "probe_required",
      one_minute_request_supported: true,
      one_hour_request_supported: true,
    },
  };
  await mockTerminalLiveApis(page);
  await mockWorkspaceApis(page, {
    withSpot: true,
    spotSearchResults: [{
      ...resolvedPool,
      pairAddress: "66666666666666666666666666666666",
      tokenAddress: "77777777777777777777777777777777",
      symbol: "BIRD",
      name: "Bird lookalike",
      liquidityUsd: 5_000_000,
    }, resolvedPool, {
      chainId: "solana",
      dexId: "meteora",
      pairAddress: "88888888888888888888888888888888",
      tokenAddress: spotTokenOnlyAddress,
      quoteTokenAddress: "99999999999999999999999999999999",
      symbol: "BIRD",
      name: "Bird",
      quoteSymbol: "USDC",
      priceUsd: 0.0008,
      liquidityUsd: 12_000,
      volume24h: 240_000,
      txns24h: 510,
      marketCap: 480_000,
      priceChange24h: 18,
      lastUpdated: "2026-07-21T12:20:00Z",
      chart_coverage: {
        schema_version: "ravenos.search_chart_coverage.v1",
        state: "unavailable",
        one_minute_request_supported: false,
        one_hour_request_supported: true,
      },
    }],
  });
  await page.unroute("**/api/dexscreener/pair**");
  await page.route("**/api/dexscreener/pair**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, results: [resolvedPool] }),
  }));
  await page.goto("/discover/");
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_DISCOVER__?.getState().rowCount)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_DISCOVER__?.getState().spotCount)).toBe(2);
  const spotFilter = page.locator("[data-discover-filter='spot']");
  await spotFilter.click();
  await expect(page.locator("#discoverSpotPulse")).toBeVisible();
  await expect(page.locator("#discoverSpotPulseTitle")).toHaveText("Token scanner");
  await expect(page.locator("[data-spot-chain]")).toHaveText(["All", "Solana", "Base", "Ethereum"]);
  await expect(page.locator("[data-spot-timeframe]")).toHaveText(["5m", "1h", "24h"]);
  await expect(page.locator("[data-spot-sort]")).toHaveText(["Raven", "Velocity", "Activity"]);
  await expect(page.locator(".discover-token-row").first()).toContainText("RETIRE");
  await expect(page.locator(".discover-token-row").first()).toContainText("+8.50%");
  await expect(page.locator(".discover-token-row").first()).toContainText("72");
  await expect(page.locator(".discover-token-row").first()).toContainText("1.24K");
  await expect(page.locator(".discover-token-row").first()).toContainText("2h old");
  await expect(page.locator(".discover-token-row").first().locator(".discover-token-raven")).toContainText("Buy-side pressure");
  await expect(page.locator(".discover-token-row").first()).toHaveAttribute("data-signal-score", /\d+/);
  await page.locator("[data-spot-timeframe='24h']").click();
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_DISCOVER__?.getState().spotTimeframe)).toBe("24h");
  await page.locator("[data-spot-sort='velocity']").click();
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_DISCOVER__?.getState().spotSort)).toBe("velocity");
  await expect(page.locator(".discover-token-row").first()).toContainText("BIRD");
  await expect(page.locator(".discover-token-row").first()).toContainText("+88.00%");
  await page.locator("[data-spot-sort='activity']").click();
  await expect(page.locator(".discover-token-row").first()).toContainText("BIRD");
  await expect(page.locator(".discover-token-row").first()).toContainText("700");
  await expect(page.locator("#discoverSpotPulse")).toContainText("ranked by Raven, velocity, or activity");
  await page.locator("[data-discover-filter='perpetual']").click();
  await expect(page.locator("#discoverSpotPulse")).toBeHidden();
  await expect(page.locator("#discoverPerpPulse")).toBeVisible();
  await expect(spotFilter).toBeEnabled();
  await spotFilter.click();
  await expect(page.locator("#discoverSpotPulse")).toBeVisible();
  await expect(page.locator("#discoverOpportunityLayout")).toBeHidden();
  await expect(page.locator("#discoverPerpPulse")).toBeHidden();
  const spotRows = page.locator(".discover-token-row");
  await expect(spotRows).toHaveCount(2);
  await expect(spotRows.filter({ hasText: "RETIRE" })).toContainText("Raven 20m earlier");
  await expect(spotRows.filter({ hasText: "RETIRE" })).toHaveAttribute("href", new RegExp(`instrument_id=solana%3Apool%3A${spotPoolAddress}`));
  const tokenOnly = spotRows.filter({ hasText: "BIRD" });
  await expect(tokenOnly).toContainText("Chart");
  await expect(tokenOnly).toContainText("Exact token");
  await expect(tokenOnly).toHaveAttribute("href", "#");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(spotRows.filter({ hasText: "RETIRE" }).locator(".discover-token-raven")).toBeVisible();
  await expect(spotRows.filter({ hasText: "RETIRE" }).locator(".discover-token-raven")).toContainText("Raven 20m earlier");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  await tokenOnly.click();
  await page.waitForURL((url) => url.pathname === "/terminal/"
    && url.searchParams.get("instrument_id") === `solana:pool:${resolvedPool.pairAddress}`
    && url.searchParams.get("timeframe") === "1m");
  await waitForTerminalLive(page, { lane: "spot", instrument: "BIRD/USDC", timeframe: "1m" });
  await expect(page.locator("#rosCommandPalette")).not.toBeVisible();
  expect(await page.locator("#terminalChart canvas").count()).toBeGreaterThan(0);
  await expect(page.locator("body")).not.toContainText(/comparison source|provider payload|wallet address/i);
  await expect(page.getByRole("button", { name: /buy|sell|long|short|sign|submit|execute/i })).toHaveCount(0);
});

test("Discover adds live Base and Ethereum exact pools without presenting them as Raven signals", async ({ page }) => {
  await mockTerminalLiveApis(page);
  await mockWorkspaceApis(page, { withSpot: true, withEvmPulse: true });
  await page.unroute("**/api/dexscreener/pair**");
  await page.route("**/api/dexscreener/pair**", (route) => {
    const url = new URL(route.request().url());
    const chain = url.searchParams.get("chainId");
    const pair = url.searchParams.get("pairAddress");
    const source = chain === "base"
      ? evmPulseRows[0]
      : chain === "ethereum" ? evmPulseRows[1] : null;
    return route.fulfill({
      status: source && source.pool_address === pair ? 200 : 404,
      contentType: "application/json",
      body: JSON.stringify({
        ok: Boolean(source && source.pool_address === pair),
        results: source ? [{
          chainId: source.chain_id,
          dexId: source.venue,
          pairAddress: source.pool_address,
          tokenAddress: source.token_address,
          quoteTokenAddress: source.quote_token_address,
          symbol: source.symbol,
          name: source.name,
          quoteSymbol: source.quote_symbol,
          priceUsd: source.market.price_usd,
          liquidityUsd: source.market.liquidity_usd,
          volume24h: source.market.volume_usd_24h,
          txns24h: source.market.buys_24h + source.market.sells_24h,
          marketCap: source.market.market_cap_usd,
          priceChange24h: source.market.price_change_24h_pct,
        }] : [],
      }),
    });
  });
  await page.goto("/discover/");
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_DISCOVER__?.getState().evmSpotCount)).toBe(2);
  await page.locator("[data-discover-filter='spot']").click();
  await expect(page.locator(".discover-token-row")).toHaveCount(4);

  await page.locator("[data-spot-chain='base']").click();
  await expect(page.locator(".discover-token-row")).toHaveCount(1);
  const base = page.locator(".discover-token-row").first();
  await expect(base).toContainText("AERO");
  await expect(base).toContainText("Base · Aerodrome");
  await expect(base).toContainText("Buy-side pressure");
  await expect(base).not.toContainText("Raven saw it earlier");
  await expect(base).toHaveAttribute("href", new RegExp(`instrument_id=base%3Apool%3A${basePulsePool}`));

  await page.locator("[data-spot-chain='ethereum']").click();
  await expect(page.locator(".discover-token-row")).toHaveCount(1);
  await expect(page.locator(".discover-token-row").first()).toContainText("WETH");
  await expect(page.locator(".discover-token-row").first()).toHaveAttribute("href", new RegExp(`instrument_id=ethereum%3Apool%3A${ethereumPulsePool}`));

  await page.locator("[data-spot-chain='base']").click();
  await page.locator(".discover-token-row").first().click();
  await page.waitForURL((url) => (
    url.pathname === "/terminal/"
    && url.searchParams.get("instrument_id") === `base:pool:${basePulsePool}`
  ));
  await waitForTerminalLive(page, { lane: "spot", instrument: "AERO/USDC", timeframe: "1m" });
  await expect(page.locator("#terminalInstrument")).toHaveText("AERO/USDC");
  expect(await page.locator("#terminalChart canvas").count()).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: /buy|sell|long|short|sign|submit|execute/i })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});

test("Discover omits zero-activity pools and lets available anatomy fill the row", async ({ page }) => {
  await mockTerminalLiveApis(page);
  await mockWorkspaceApis(page, { withSpot: true, withEvmPulse: true });
  const dormant = structuredClone(evmPulseRows[0]);
  dormant.public_attention_id = "market:base:0x000000000000000000000000000000000000d001";
  dormant.instrument_id = "base:pool:0x000000000000000000000000000000000000d001";
  dormant.pool_address = "0x000000000000000000000000000000000000d001";
  dormant.token_address = "0x000000000000000000000000000000000000d002";
  dormant.symbol = "DORMANT";
  dormant.name = "Dormant pool";
  dormant.what_changed = "No current movement.";
  dormant.market.price_change_5m_pct = 0;
  dormant.market.volume_usd_5m = 0;
  dormant.market.buys_5m = 0;
  dormant.market.sells_5m = 0;
  dormant.market.traders_5m = 0;
  await page.unroute("**/api/onchain/trending**");
  await page.route("**/api/onchain/trending**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(onchainPulsePayload([...evmPulseRows, dormant])),
  }));

  await page.goto("/discover/");
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_DISCOVER__?.getState().evmSpotCount)).toBe(3);
  await page.locator("[data-discover-filter='spot']").click();
  await expect(page.locator(".discover-token-row")).toHaveCount(4);
  await expect(page.locator("#discoverTokenTapeList")).not.toContainText("DORMANT");

  const base = page.locator(".discover-token-row").filter({ hasText: "AERO" });
  const fill = await base.locator(".discover-token-anatomy").evaluate((node) => {
    const cells = [...node.children].filter((child) => !child.hidden);
    const grid = node.getBoundingClientRect();
    const last = cells.at(-1)?.getBoundingClientRect();
    return last ? Math.abs(grid.right - last.right) : Number.POSITIVE_INFINITY;
  });
  expect(fill).toBeLessThanOrEqual(1);
});

test("Discover updates token facts without reordering the tape under an active scroll", async ({ page }) => {
  await mockWorkspaceApis(page, { withSpot: true });
  await page.goto("/discover/");
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_DISCOVER__?.getState().spotCount)).toBe(2);
  await page.locator("[data-discover-filter='spot']").click();
  const rows = page.locator(".discover-token-row");
  await expect(rows.first()).toContainText("RETIRE");

  const refreshed = structuredClone(opportunityPayload({ withSpot: true }));
  const retire = refreshed.census.spot_attention.rows[0];
  const bird = refreshed.census.spot_attention.rows[1];
  retire.market.price_change_5m_pct = 9.25;
  retire.what_changed = "Price rose 9.25% in 5m. Buys led 70 to 29 · 78 active traders.";
  bird.market.volume_usd_5m = 500_000;
  bird.market.liquidity_usd = 2_000_000;
  bird.market.buys_5m = 400;
  bird.market.sells_5m = 50;
  bird.market.traders_5m = 300;
  refreshed.census.spot_attention.rows.reverse();
  await page.unroute("**/api/opportunity**");
  await page.route("**/api/opportunity**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(refreshed),
  }));

  await page.evaluate(async () => {
    window.dispatchEvent(new Event("scroll"));
    await window.__RAVENOS_DISCOVER__.refresh();
  });
  await expect(rows.first()).toContainText("RETIRE");
  await expect(rows.first()).toContainText("+9.25%");
  await expect(page.locator("#discoverTokenUpdates")).toBeVisible();
  await page.locator("#discoverTokenUpdates").click();
  await expect(rows.first()).toContainText("BIRD");
  await expect(page.locator("#discoverTokenUpdates")).toBeHidden();
});

test("Discover keeps live market pulse but refuses stale opportunity substitution", async ({ page }) => {
  await mockWorkspaceApis(page, { opportunityStatus: 503 });
  await page.goto("/discover/");
  await expect(page.locator("#discoverCensusState")).toHaveText("Unavailable");
  await expect(page.locator("#discoverStream")).toContainText("No current opportunities can be shown");
  await expect(page.locator("#discoverPulse .pulse-row")).toHaveCount(2);
  await expect(page.locator(".discover-row")).toHaveCount(0);
});

test("Discover combines Raven opportunities with exact Atlas rows without merging provenance", async ({ page }) => {
  await mockWorkspaceApis(page);
  await page.route("**/api/atlas", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(atlasPayload()) }));
  await page.goto("/discover/");
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_DISCOVER__?.getState().rowCount)).toBe(2);
  await expect(page.locator(".discover-row[data-source-type='raven']")).toHaveCount(1);
  const atlasRow = page.locator(".discover-row[data-source-type='atlas']");
  await expect(atlasRow).toHaveCount(1);
  await expect(atlasRow).toContainText("Etf · Atlas");
  await expect(atlasRow).toContainText("5d +1.20%");
  await expect(atlasRow).toContainText("Balanced options · current");
  await expect(atlasRow).not.toContainText("Raven behavior unavailable");
  await expect(atlasRow).toHaveAttribute("href", /instrument_id=etf%3Anyse-arca%3Aspy/);
  await page.locator("[data-discover-filter='equity']").click();
  await expect(atlasRow).toBeVisible();
  await expect(page.locator(".discover-row[data-source-type='raven']")).toBeHidden();
});

test("Discover exposes a bounded featured stock and ETF universe and opens one exact listing directly", async ({ page }) => {
  await mockTerminalLiveApis(page);
  await mockWorkspaceApis(page);
  const featuredRows = [
    { entity_id: "etf:us:SPY", entity_kind: "etf", symbol: "SPY", name: "SPDR S&P 500 ETF Trust", optionable: true },
    { entity_id: "etf:us:QQQ", entity_kind: "etf", symbol: "QQQ", name: "Invesco QQQ Trust", optionable: true },
    { entity_id: "equity:us:AAPL", entity_kind: "equity", symbol: "AAPL", name: "Apple Inc.", optionable: true },
    { entity_id: "equity:us:NVDA", entity_kind: "equity", symbol: "NVDA", name: "NVIDIA Corporation", optionable: true },
  ].map((row) => ({
    schema_version: "atlas_search_result_v1",
    entity_class: row.entity_kind === "etf" ? "proxy" : "tradable_quote",
    provider: "tradier",
    data_frequency: "market session",
    status: "SEARCHABLE",
    cached_snapshot_available: false,
    public_display_eligibility: "allowed",
    featured: true,
    selectable: true,
    refusal_reason: null,
    ...row,
  }));
  await page.route("**/api/atlas/featured**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      safe_public: true,
      schema_version: "atlas_featured_state_v1",
      generated_at: "2026-07-21T12:20:00Z",
      execution_boundary: { signing_available: false, submission_available: false },
      sections: [
        { section_id: "major_etfs", label: "Major ETFs", entities: featuredRows.filter((row) => row.entity_kind === "etf") },
        { section_id: "core_us_stocks", label: "Core U.S. Stocks", entities: featuredRows.filter((row) => row.entity_kind === "equity") },
      ],
    }),
  }));
  await page.route("**/api/instruments/search**", (route) => {
    const symbol = new URL(route.request().url()).searchParams.get("q")?.toUpperCase() || "";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        schema_version: "ravenos.instrument_lookup.v1",
        results: [{
          schema_version: "ravenos.instrument.v1",
          instrument_id: `equity:nasdaq:${symbol.toLowerCase()}`,
          symbol,
          display_name: symbol === "AAPL" ? "Apple Inc." : symbol,
          asset_class: "equity",
          instrument_type: "equity",
          identity_scope: "exact_instrument",
          venue: "nasdaq",
          chain: "none",
          market_identity: { market_id: symbol, listing: "Nasdaq" },
          quote_asset: { symbol: "USD" },
          settlement_asset: { symbol: "USD" },
          capabilities: { chart: false, execution: false },
        }],
      }),
    });
  });
  await page.goto("/discover/");
  const listed = page.locator("#discoverListedUniverse");
  await expect(listed).toBeHidden();
  await page.locator("[data-discover-filter='equity']").click();
  await expect(listed).toBeVisible();
  await expect(page.locator(".discover-listed-card")).toHaveCount(4);
  await expect(listed).toContainText("SPY");
  await expect(listed).toContainText("QQQ");
  await expect(listed).toContainText("AAPL");
  await expect(listed).toContainText("NVDA");
  await page.locator("[data-discover-filter='perpetual']").click();
  await expect(listed).toBeHidden();
  await page.locator("[data-discover-filter='equity']").click();
  await expect(listed).toBeVisible();
  await page.locator(".discover-listed-card").filter({ hasText: "AAPL" }).click();
  await page.waitForURL((url) => url.pathname === "/terminal/" && url.searchParams.get("instrument_id") === "equity:nasdaq:aapl");
  await expect(page.locator("#terminalInstrument")).toHaveText("AAPL");
  await expect(page.getByRole("button", { name: /buy|sell|long|short|sign|submit|execute/i })).toHaveCount(0);
});

test("Discover retains current Atlas rows when Raven Census is unavailable", async ({ page }) => {
  await mockWorkspaceApis(page, { opportunityStatus: 503 });
  await page.route("**/api/atlas", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(atlasPayload()) }));
  await page.goto("/discover/");
  await expect(page.locator("#discoverCensusState")).toHaveText("Unavailable");
  await expect(page.locator("#discoverAtlasState")).toHaveText("Fresh");
  await expect(page.locator(".discover-row[data-source-type='atlas']")).toHaveCount(1);
  await expect(page.locator(".discover-source-notice[data-discover-source-notice='raven']")).toContainText("Historical reads are not shown as current");
  await expect(page.locator(".discover-row[data-source-type='raven']")).toHaveCount(0);
});

test("Terminal rejects mismatched explicit symbol and instrument without provider fallback", async ({ page }) => {
  const { calls } = await mockTerminalLiveApis(page);
  await page.goto("/terminal/?asset=BTC-PERP&instrument_id=hyperliquid%3Aperp%3ASOL");
  await expect(page.locator("#terminalChartTitle")).toContainText("unavailable");
  await expect(page.locator("#terminalChartStatus")).toContainText("do not match");
  await expect(page.locator("#terminalChart canvas")).toHaveCount(0);
  expect(calls).toHaveLength(0);
  const state = await page.evaluate(() => window.__RAVENOS_TERMINAL__?.getState());
  expect(state.candleCount).toBe(0);
  expect(state.signingAvailable).toBe(false);
  expect(state.submissionAvailable).toBe(false);
});

test("Terminal resolves an exact pool identity directly without a lane selector", async ({ page }) => {
  const { calls } = await mockTerminalLiveApis(page);
  await page.goto("/terminal/?instrument_id=solana%3Apool%3Afixture-pair-address&instrument_type=exact_pool&market=spot");
  await expect(page.locator("#terminalInstrument")).toHaveText("JUP/USDC");
  await expect(page.locator("#terminalPickerMeta")).toHaveText("solana:pool:fixture-pair-address");
  await expect(page.locator("#terminalModeSelect")).toBeHidden();
  await expect(page.locator("#terminalSpotControl")).toBeHidden();
  await expect(page.locator("#terminalChart canvas").first()).toBeVisible();
  await expect(page.locator("#terminalChart [data-rpw-activity]")).toBeHidden();
  expect(calls.some((call) => call.pairAddress === "fixture-pair-address")).toBe(true);
});

test("Portfolio is one truthful empty state and never a seeded customer account", async ({ page }) => {
  await mockWorkspaceApis(page);
  await page.goto("/portfolio/");
  await expect(page.locator(".portfolio-empty-workspace")).toContainText("Connections are not open yet");
  await expect(page.locator(".connection-row, .connection-list, .workspace-ledger")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Inspect a market" })).toBeEnabled();
  await expect(page.locator("body")).not.toContainText(/demo portfolio|sample holding|connected wallet/i);
  await expect(page.locator("#rosFreshness")).toBeHidden();
  await expect(page.locator("#rosContextTrigger")).toBeHidden();
  const contract = await page.evaluate(() => window.__RAVENOS_PORTFOLIO__);
  expect(contract.customerDataLoaded).toBe(false);
  expect(contract.connectorsAvailable).toBe(false);
  expect(contract.signingAvailable).toBe(false);
});

test("Atlas preserves verified exact ETF identity into the universal Terminal", async ({ page }) => {
  await mockWorkspaceApis(page);
  await page.route("**/api/atlas", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(atlasPayload()),
  }));
  await page.route("**/api/atlas/featured**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      safe_public: true,
      redaction_policy: "atlas_public_metadata_and_rights_admitted_observations_only",
      schema_version: "atlas_featured_state_v1",
      generated_at: "2026-07-21T12:20:00Z",
      execution_boundary: { account_available: false, broker_connection_available: false, order_preview_available: false, position_available: false, signing_available: false, submission_available: false, execution_available: false },
      state: "available",
      sections: [{
        section_id: "major_etfs",
        label: "Major ETFs",
        entities: [{
          schema_version: "atlas_search_result_v1",
          entity_id: "etf:us:SPY",
          name: "State Street SPDR S&P 500 ETF Trust",
          symbol: "SPY",
          entity_kind: "etf",
          entity_class: "proxy",
          provider: "tradier",
          data_frequency: "market session",
          status: "LIVE",
          optionable: true,
          cached_snapshot_available: false,
          public_display_eligibility: "allowed",
          description: "State Street SPDR S&P 500 ETF Trust",
          featured: true,
          selectable: true,
          refusal_reason: null,
          snapshot: { last: 640.25, change_percent: 1.2, delay_class: "periodic", stale: false },
        }],
      }],
      catalog_only_entities_do_not_refresh: true,
      featured_refresh: "bounded_existing_atlas_cycle",
      public_projection_generated_at: "2026-07-21T12:20:00Z",
    }),
  }));
  await page.route("**/api/atlas/entity**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      safe_public: true,
      redaction_policy: "atlas_public_metadata_and_rights_admitted_observations_only",
      schema_version: "atlas_entity_detail_v1",
      generated_at: "2026-07-21T12:20:00Z",
      execution_boundary: { account_available: false, broker_connection_available: false, order_preview_available: false, position_available: false, signing_available: false, submission_available: false, execution_available: false },
      entity: {
        schema_version: "atlas_search_result_v1",
        entity_id: "etf:us:SPY",
        name: "State Street SPDR S&P 500 ETF Trust",
        symbol: "SPY",
        entity_kind: "etf",
        entity_class: "proxy",
        provider: "tradier",
        data_frequency: "market session",
        status: "LIVE",
        optionable: true,
        cached_snapshot_available: false,
        public_display_eligibility: "allowed",
        description: "State Street SPDR S&P 500 ETF Trust",
        featured: true,
        selectable: true,
        refusal_reason: null,
      },
      snapshot: { state: "display_restricted", provider: "tradier", provider_timestamp: "2026-07-21T12:20:00Z", fetched_at: "2026-07-21T12:20:00Z", delay_class: "current", delayed: false, degraded: false, stale: false, cache_hit: false, display_policy: { decision: "restricted", raw_redistribution_allowed: false, cache_allowed: true, max_cache_seconds: 60, delay_requirement_seconds: 0, attribution_required: true, attribution_text: "Market data provided by Tradier", decision_source: "fixture", last_reviewed: "2026-07-22", reason: "public_redistribution_not_authorized" }, attribution: "Market data provided by Tradier", refusal_reasons: ["public_redistribution_not_authorized"], data: null },
      lease: null,
      searchable: true,
      hydrated: true,
      featured: true,
      active: false,
      watched: false,
      alerted: false,
      deep_observed: false,
    }),
  }));
  await page.goto("/atlas/");
  await expect(page.locator(".atlas-pulse-row")).toContainText("SPY");
  await expect(page.locator(".atlas-pulse-row")).toContainText("Tradier");
  await page.locator(".atlas-pulse-row").click();
  await expect(page.locator("#atlasOpenTerminal")).toHaveAttribute("href", /instrument_id=etf%3Anyse-arca%3Aspy/);
  await expect(page.getByRole("button", { name: /buy|sell|sign|submit|execute/i })).toHaveCount(0);
});

test("Terminal loads exact ETF candles and Atlas context without inventing Raven evidence", async ({ page }) => {
  const { calls } = await mockTerminalLiveApis(page);
  await page.route("**/api/atlas", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(atlasPayload()) }));
  await page.goto("/terminal/?asset=SPY&instrument_id=etf%3Anyse-arca%3Aspy&instrument_type=etf&asset_class=etf&market=equities");
  await expect(page.locator("#terminalInstrument")).toHaveText("SPY");
  await expect(page.locator("#terminalPickerMeta")).toHaveText("etf:nyse-arca:spy");
  await expect(page.locator("#terminalVenueLabel")).toHaveText("NYSE Arca");
  await expect(page.locator("#terminalWhyLabel")).toHaveText("Why it matters");
  await expect(page.locator("#terminalWhy")).toContainText("Options are balanced");
  await expect(page.locator("#terminalEvidenceState")).toContainText("Current");
  await expect(page.locator("#terminalChart canvas").first()).toBeVisible();
  expect(calls.some((call) => call.market === "equities" && call.instrumentId === "etf:nyse-arca:spy")).toBe(true);
  const terminal = await page.evaluate(() => window.__RAVENOS_TERMINAL__?.getState());
  expect(terminal.lane).toBe("equity");
  expect(terminal.instrumentId).toBe("etf:nyse-arca:spy");
  expect(terminal.contextState).toBe("atlas_context");
  expect(terminal.signingAvailable).toBe(false);
  expect(terminal.submissionAvailable).toBe(false);
});

test("company or fund name search resolves an Atlas ETF directly into its exact Terminal context", async ({ page }) => {
  await mockWorkspaceApis(page);
  await mockTerminalLiveApis(page);
  await page.route("**/api/atlas", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(atlasPayload()) }));
  await page.goto("/discover/");
  await page.locator("#rosCommandTrigger").click();
  await page.locator("#rosCommandInput").fill("SPDR");
  const result = page.locator(".ros-command-result.instrument").filter({ hasText: "SPY" }).first();
  await expect(result).toContainText("NYSE Arca");
  await result.click();
  await expect(page).toHaveURL(/\/terminal\/.*instrument_id=etf%3Anyse-arca%3Aspy/);
  await expect(page.locator("#terminalPickerMeta")).toHaveText("etf:nyse-arca:spy");
  await expect(page.locator("#terminalWhyLabel")).toHaveText("Why it matters");
});

test("exact listed symbols rank ahead of same-ticker token pools while preserving both choices", async ({ page }) => {
  await mockWorkspaceApis(page);
  await page.route("**/api/atlas", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(atlasPayload()) }));
  await page.route("**/api/dexscreener/search**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      results: [{
        chainId: "solana",
        dexId: "fixture-dex",
        pairAddress: "tokenized-spy-pool",
        tokenAddress: "tokenized-spy-mint",
        quoteTokenAddress: "fixture-usdc-mint",
        symbol: "SPY",
        name: "Tokenized SPY",
        quoteSymbol: "USDC",
        priceUsd: 640.2,
        liquidityUsd: 250_000,
        volume24h: 40_000,
        lastUpdated: "2026-07-21T12:20:00Z",
      }],
    }),
  }));
  await page.goto("/discover/");
  await page.locator("#rosCommandTrigger").click();
  await page.locator("#rosCommandInput").fill("SPY");
  const results = page.locator(".ros-command-result.instrument");
  await expect(results).toHaveCount(2);
  await expect(results.nth(0)).toContainText("Atlas markets");
  await expect(results.nth(0)).toContainText("NYSE Arca");
  await expect(results.nth(1)).toContainText("Spot · Solana");
  await expect(results.nth(1)).toContainText("Tokenized SPY");
});

test("universal search treats an exact perpetual as BTC intent before a same-symbol listed product", async ({ page }) => {
  await mockWorkspaceApis(page);
  await page.route("**/api/instruments/search**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      schema_version: "ravenos.instrument_lookup.v1",
      query: "BTC",
      delivery: { source: "current_public_origin", freshness_state: "fresh", fallback: false },
      execution_boundary: { broker_connection_available: false, quote_preview_available: false, signing_available: false, submission_available: false },
      results: [{
        schema_version: "ravenos.instrument.v1",
        instrument_id: "etf:nyse-arca:btc",
        symbol: "BTC",
        display_name: "Grayscale Bitcoin Mini Trust ETF",
        asset_class: "etf",
        instrument_type: "etf",
        identity_scope: "exact_instrument",
        venue: "nyse-arca",
        chain: "none",
        market_identity: { market_id: "BTC", listing: "NYSE Arca" },
        quote_asset: { symbol: "USD" },
        settlement_asset: { symbol: "USD" },
        capabilities: { chart: true, execution: false },
      }],
    }),
  }));
  await page.route("**/api/atlas/search**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, schema_version: "atlas_search_result_v1", results: [], groups: {}, query: "BTC" }) }));
  await page.goto("/discover/");
  await page.locator("#rosCommandTrigger").click();
  await page.locator("#rosCommandInput").fill("BTC");
  await expect(page.locator(".ros-command-group > header strong")).toHaveText(["Perpetuals", "Stocks & ETFs"]);
  await expect(page.locator(".ros-command-result.instrument").first()).toContainText("BTC-PERP");
  await expect(page.locator(".ros-command-result.instrument").nth(1)).toContainText("Grayscale Bitcoin Mini Trust ETF");
});

test("universal search resolves a rate-market alias into exact Atlas context", async ({ page }) => {
  await mockWorkspaceApis(page);
  await page.route("**/api/instruments/search**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, schema_version: "ravenos.instrument_lookup.v1", results: [], query: "US10Y" }) }));
  await page.route("**/api/atlas/search**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      schema_version: "atlas_search_result_v1",
      query: "US10Y",
      results: [{
        schema_version: "atlas_search_result_v1",
        entity_id: "fred:DGS10",
        name: "10-Year Treasury Yield",
        symbol: "DGS10",
        entity_kind: "rate_series",
        entity_class: "reference_series",
        provider: "fred",
        data_frequency: "Daily",
        status: "PERIODIC",
        optionable: false,
        cached_snapshot_available: true,
        public_display_eligibility: "allowed",
        featured: true,
        selectable: true,
      }],
      groups: {},
    }),
  }));
  await page.goto("/discover/");
  await page.locator("#rosCommandTrigger").click();
  await page.locator("#rosCommandInput").fill("US10Y");
  await expect(page.locator(".ros-command-group > header strong")).toHaveText(["Rates & economy"]);
  const result = page.locator(".ros-command-result.instrument").first();
  await expect(result).toContainText("DGS10");
  await expect(result).toContainText("Periodic");
  await result.click();
  await expect(page).toHaveURL(/\/atlas\/\?entity_id=fred%3ADGS10/);
});

test("universal search resolves an arbitrary exact equity even when Atlas context is unavailable", async ({ page }) => {
  await mockWorkspaceApis(page);
  await mockTerminalLiveApis(page);
  await page.route("**/api/atlas", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ ok: false, error: "atlas_projection_unavailable" }),
  }));
  await page.goto("/discover/");
  await page.locator("#rosCommandTrigger").click();
  await page.locator("#rosCommandInput").fill("AAPL");
  const result = page.locator(".ros-command-result.instrument").filter({ hasText: "AAPL" }).first();
  await expect(result).toBeVisible();
  await expect(result).toContainText("Apple Inc.");
  await expect(result).toContainText("Listed markets");
  await expect(result).toContainText("Exact listing · chart available");
  await result.click();

  await expect(page).toHaveURL(/instrument_id=equity%3Anasdaq%3Aaapl/);
  await expect(page.locator("#terminalInstrument")).toHaveText("AAPL");
  await expect(page.locator("#terminalPickerMeta")).toHaveText("equity:nasdaq:aapl");
  await expect(page.locator("#terminalVenueLabel")).toHaveText("Nasdaq");
  await expect(page.locator("#terminalContextSection")).toBeHidden();
  await expect(page.locator("#terminalReadTrigger")).toBeHidden();
  await expect(page.locator("#terminalDeepLink")).toHaveText("Open in Atlas");
  await expect(page.locator("#terminalBoundary")).toContainText("Market snapshot current");
  await expect(page.locator("#terminalChart canvas").first()).toBeVisible();
  const terminal = await page.evaluate(() => window.__RAVENOS_TERMINAL__?.getState());
  expect(terminal.instrumentId).toBe("equity:nasdaq:aapl");
  expect(terminal.contextState).toBe("unavailable");
  expect(terminal.signingAvailable).toBe(false);
  expect(terminal.submissionAvailable).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#terminalChart canvas").first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});

test("an exact listed instrument uses TradingView visual context when native public candles are display-restricted", async ({ page }) => {
  const cspErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /tradingview-widget|frame-src/i.test(message.text())) cspErrors.push(message.text());
  });
  await mockWorkspaceApis(page);
  await mockTerminalLiveApis(page);
  await page.route("**/api/instruments/search**", (route) => {
    const query = new URL(route.request().url()).searchParams.get("q") || "";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        schema_version: "ravenos.instrument_lookup.v1",
        query,
        delivery: { source: "current_public_origin", freshness_state: "fresh", fallback: false },
        execution_boundary: { broker_connection_available: false, quote_preview_available: false, signing_available: false, submission_available: false },
        results: [{
          schema_version: "ravenos.instrument.v1",
          instrument_id: "equity:nasdaq:aapl",
          symbol: "AAPL",
          display_name: "Apple Inc.",
          asset_class: "equity",
          instrument_type: "equity",
          identity_scope: "exact_instrument",
          venue: "nasdaq",
          chain: "none",
          market_identity: { market_id: "AAPL", listing: "Nasdaq" },
          quote_asset: { symbol: "USD" },
          settlement_asset: { symbol: "USD" },
          capabilities: { chart: false, quote_preview: false, execution: false },
        }],
      }),
    });
  });
  await page.route("**/api/atlas/search**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, schema_version: "atlas_search_result_v1", query: "AAPL", results: [], groups: {} }),
  }));
  await page.route("**/api/atlas", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ ok: false, error: "atlas_projection_unavailable" }),
  }));
  await page.route("**/api/terminal/chart**", (route) => route.fulfill({
    status: 451,
    contentType: "application/json",
    body: JSON.stringify({
      ok: false,
      source_type: "display_restricted",
      freshness_state: "unavailable",
      message: "Public listed-market candles are display restricted.",
      candles: [],
    }),
  }));
  await page.goto("/discover/");
  await page.locator("#rosCommandTrigger").click();
  await page.locator("#rosCommandInput").fill("AAPL");
  const result = page.locator(".ros-command-result.instrument").filter({ hasText: "AAPL" }).first();
  await expect(result).toContainText("Exact listing · chart available");
  const navigation = page.waitForResponse((candidate) => (
    candidate.request().resourceType() === "document"
    && new URL(candidate.url()).pathname === "/terminal/"
  ));
  await result.click();
  const response = await navigation;
  expect(response?.headers()["content-security-policy"]).toContain("frame-src https://www.tradingview-widget.com https://s.tradingview.com");
  await expect(page.locator("#terminalInstrument")).toHaveText("AAPL");
  await expect(page.locator(".terminal-external-chart iframe")).toBeVisible();
  await expect(page.locator("#terminalChart > .rpw")).toBeHidden();
  await expect(page.locator("#terminalChart canvas")).toHaveCount(0);
  const chartComposition = await page.evaluate(() => {
    const host = document.getElementById("terminalChart")?.getBoundingClientRect();
    const panel = document.querySelector(".terminal-external-chart")?.getBoundingClientRect();
    const frame = document.querySelector(".terminal-external-chart iframe")?.getBoundingClientRect();
    return host && panel && frame ? {
      panelOffset: Math.abs(panel.top - host.top),
      frameHeight: frame.height,
      panelBottomOverflow: panel.bottom - host.bottom,
    } : null;
  });
  expect(chartComposition).not.toBeNull();
  expect(chartComposition.panelOffset).toBeLessThanOrEqual(1);
  expect(chartComposition.frameHeight).toBeGreaterThanOrEqual(328);
  expect(chartComposition.panelBottomOverflow).toBeLessThanOrEqual(1);
  await expect(page.locator("#terminalChartStatus")).toContainText("TradingView visual chart");
  await expect(page.locator("#terminalChartCredit")).toHaveText("Chart by TradingView");
  await expect(page.locator("#terminalContextSection")).toBeHidden();
  const source = await page.locator(".terminal-external-chart iframe").getAttribute("src");
  expect(decodeURIComponent(source || "")).toContain('"symbol":"NASDAQ:AAPL"');
  expect(cspErrors).toEqual([]);
});

test("universal search resolves an exact supported spot pool without a second mode search", async ({ page }) => {
  await mockWorkspaceApis(page);
  await mockTerminalLiveApis(page);
  await page.goto("/discover/");
  await page.locator("#rosCommandTrigger").click();
  await page.locator("#rosCommandInput").fill("JUP");
  const result = page.locator(".ros-command-result.instrument").filter({ hasText: "JUP/USDC" }).first();
  await expect(result).toContainText("Spot · Solana");
  await expect(result).toContainText("Exact pool");
  await expect(result).toContainText("pool fixture…dress");
  await result.click();
  await expect(page).toHaveURL(/\/terminal\/.*instrument_id=solana%3Apool%3Afixture-pair-address/);
  await expect(page.locator("#terminalPickerMeta")).toHaveText("solana:pool:fixture-pair-address");
  await expect(page.locator("#terminalInstrumentScope")).toHaveText("Exact pool");
  await expect(page.locator("#terminalContextSection")).toBeVisible();
  await expect(page.locator("#terminalReadHeadline")).toHaveText("JUP · Activity accelerating");
  await expect(page.locator("#terminalAnatomy5Label")).toHaveText("Holders");
  await expect(page.locator("#terminalAnatomySection")).not.toContainText(/Review unavailable|capability check|required/i);
});

test("token-name search ranks chartable active pools ahead of unsupported inactive listings", async ({ page }) => {
  await mockWorkspaceApis(page);
  await page.unroute("**/api/dexscreener/search**");
  await page.route("**/api/dexscreener/search**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      results: [
        {
          chainId: "abstract",
          dexId: "uniswap",
          pairAddress: "inactive-retire-pool",
          tokenAddress: "inactive-retire-token",
          quoteTokenAddress: "inactive-weth",
          symbol: "RETIRE",
          name: "Retire",
          quoteSymbol: "WETH",
          priceUsd: 0.000001,
          liquidityUsd: 0,
          volume24h: 0,
        },
        {
          chainId: "solana",
          dexId: "raydium",
          pairAddress: "active-retire-pool",
          tokenAddress: "active-retire-token",
          quoteTokenAddress: "solana-usdc",
          symbol: "RETIRE",
          name: "Retire",
          quoteSymbol: "USDC",
          priceUsd: 0.0042,
          liquidityUsd: 420_000,
          volume24h: 1_800_000,
        },
      ],
    }),
  }));
  await page.goto("/discover/");
  await page.locator("#rosCommandTrigger").click();
  await page.locator("#rosCommandInput").fill("RETIRE");
  const results = page.locator(".ros-command-result.instrument");
  await expect(results).toHaveCount(2);
  await expect(results.nth(0)).toContainText("Spot · Solana");
  await expect(results.nth(0)).toContainText("chart coverage checked on open");
  await expect(results.nth(1)).toContainText("Spot · Abstract");
  await expect(results.nth(1)).toContainText("chart unavailable");
});

test("exact contract search preserves the address match ahead of a more liquid different token", async ({ page }) => {
  await mockWorkspaceApis(page);
  await page.unroute("**/api/dexscreener/search**");
  await page.route("**/api/dexscreener/search**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      results: [
        {
          chainId: "solana",
          dexId: "raydium",
          pairAddress: "lookalike-runner-pool",
          tokenAddress: "lookalike-runner-token",
          quoteTokenAddress: "solana-usdc",
          symbol: "RUNNER",
          name: "Runner lookalike",
          quoteSymbol: "USDC",
          priceUsd: 0.42,
          liquidityUsd: 4_200_000,
          volume24h: 9_000_000,
        },
        {
          chainId: "robinhood",
          dexId: "uniswap",
          pairAddress: "0x602633428507BBAA848E6D0c3127cda15eEAE6a9",
          tokenAddress: ROBINHOOD_CONTRACT,
          quoteTokenAddress: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
          symbol: "RUNNER",
          name: "The Runner",
          quoteSymbol: "WETH",
          priceUsd: 0.0003219,
          liquidityUsd: 68_960,
          volume24h: 14_200,
        },
      ],
    }),
  }));
  await page.goto("/discover/");
  await page.locator("#rosCommandTrigger").click();
  await page.locator("#rosCommandInput").fill(ROBINHOOD_CONTRACT);
  const results = page.locator(".ros-command-result.instrument");
  await expect(results).toHaveCount(2);
  await expect(results.nth(0)).toContainText("Spot · Robinhood");
  await expect(results.nth(0)).toContainText("The Runner");
  await expect(results.nth(1)).toContainText("Spot · Solana");
});

test("contract-address search resolves a provider-backed Robinhood Chain chart without pretending route support", async ({ page }) => {
  await mockWorkspaceApis(page);
  await mockTerminalLiveApis(page);
  await page.goto("/discover/");
  await page.keyboard.press("Control+K");
  const input = page.locator("#rosCommandInput");
  await input.fill(ROBINHOOD_CONTRACT);
  const result = page.locator(".ros-command-result.instrument").filter({ hasText: "RUNNER/WETH" }).first();
  await expect(result).toBeVisible();
  await expect(result).toContainText("Spot · Robinhood");
  await expect(result).toContainText("The Runner");
  await expect(result).toContainText("chart coverage checked on open");
  await result.click();

  await expect(page).toHaveURL(/instrument_id=robinhood%3Apool%3A0x602633/i);
  await expect(page.locator("#terminalInstrument")).toHaveText("RUNNER/WETH");
  await expect(page.locator("#terminalPickerMeta")).toContainText("robinhood:pool:0x602633");
  await expect(page.locator("#terminalSpotControl")).toBeHidden();
  await expect(page.locator("#terminalCapabilityLabel")).toContainText(/Spot · WETH quote · \d+ candles/);
  await expect(page.locator("#terminalChartStatus")).not.toContainText(/unavailable/i);
  await expect(page.locator("#terminalChart canvas").first()).toBeVisible();
  const state = await page.evaluate(() => window.__RAVENOS_TERMINAL__?.getState());
  expect(state.signingAvailable).toBe(false);
  expect(state.submissionAvailable).toBe(false);
});

test("provider attribution stays visible and opens a bounded source ledger", async ({ page }) => {
  await mockWorkspaceApis(page);
  await page.goto("/discover/");
  await expect(page.locator(".ros-provider-credit")).toHaveCount(1);
  const credit = page.locator(".ros-provider-credit > summary");
  await expect(credit).toContainText("Data by DexPaprika + CoinGecko");
  const fontSize = await credit.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(10);
  await credit.click();
  const panel = page.locator(".ros-provider-panel");
  await expect(panel).toBeVisible();
  for (const provider of ["DexPaprika", "DexScreener", "CoinGecko", "Hyperliquid", "Tradier + Atlas", "Moralis", "Constant-K + Raven", "Cloudflare", "TradingView"]) {
    await expect(panel).toContainText(provider);
  }
  await expect(panel).toContainText(/not endorsement or partnership/i);
  await credit.click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => credit.evaluate((element) => element.getBoundingClientRect().width)).toBeLessThan(100);
  await expect(credit).toHaveAttribute("aria-label", "Data sources and attribution");
});

test("Atlas outage is isolated and explicit", async ({ page }) => {
  await mockWorkspaceApis(page);
  await page.route("**/api/atlas", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "atlas_projection_unavailable" }) }));
  await page.goto("/atlas/");
  await expect(page.locator(".atlas-pulse")).toHaveCount(0);
  await expect(page.locator("#atlasSearchInput")).toBeVisible();
  await expect(page.locator("#atlasContent")).toContainText("Follow the issuer behind the move");
});
