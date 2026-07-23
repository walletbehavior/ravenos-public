import { test, expect } from "@playwright/test";

import { mockTerminalLiveApis, ROBINHOOD_CONTRACT } from "./terminal-live-fixtures.mjs";

const markets = [
  {
    asset: "SOL-PERP",
    symbol: "SOL",
    instrument_id: "hyperliquid:perp:SOL",
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
    why_raven_noticed: "Behavior changed while provider-backed pressure remained observable.",
    pressure_state: "Mixed pressure",
    path_review: { state: "forward path reviewing" },
    matured_comparables: { sample_size: 128 },
    market_context: { funding_rate: -0.000012, open_interest: 192_000_000 },
    research_only: true,
    execution_available: false,
  },
];

function opportunityPayload() {
  return {
    ok: true,
    schema_version: "ravenos.opportunity_workspace.v2",
    census: {
      schema_version: "ravenos_opportunity_census_public_v1",
      generated_at: "2026-07-21T12:20:00Z",
      source_state: "current",
      opportunities: { rows: opportunityRows },
    },
    current_opportunity: opportunityRows[0],
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

async function mockWorkspaceApis(page, { opportunityStatus = 200 } = {}) {
  await page.route("**/api/dexscreener/search**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, results: [] }),
  }));
  await page.route("**/api/hyperliquid/perps", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, results: markets }) }));
  await page.route("**/api/opportunity**", (route) => route.fulfill({
    status: opportunityStatus,
    contentType: "application/json",
    body: JSON.stringify(opportunityStatus === 200 ? opportunityPayload() : {
      ok: false,
      status: "unavailable",
      error: "opportunity_census_projection_unavailable",
      census: null,
      current_opportunity: null,
      historical_context: { current_data_substituted: false },
    }),
  }));
  await page.route("**/api/health", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(healthPayload()) }));
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
  await expect(row).toContainText("Outcome window still maturing");
  await expect(row.locator(".discover-thesis > span")).toHaveText("What changed");
  await expect(row).toHaveAttribute("href", /instrument_id=hyperliquid%3Aperp%3ASOL/);
  await expect(page.locator("#discoverCensusState")).toHaveText("Current");
  await expect(page.locator("#discoverMarketState")).toHaveText("Live provider");
  await expect(page.getByRole("button", { name: /buy|sell|long|short|sign|submit|execute/i })).toHaveCount(0);
});

test("Discover keeps live market pulse but refuses stale opportunity substitution", async ({ page }) => {
  await mockWorkspaceApis(page, { opportunityStatus: 503 });
  await page.goto("/discover/");
  await expect(page.locator("#discoverCensusState")).toHaveText("Unavailable");
  await expect(page.locator("#discoverStream")).toContainText("Older observations were not substituted");
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
  await expect(atlasRow).toContainText("Raven behavior unavailable");
  await expect(atlasRow).toHaveAttribute("href", /instrument_id=etf%3Anyse-arca%3Aspy/);
  await page.locator("[data-discover-filter='equity']").click();
  await expect(atlasRow).toBeVisible();
  await expect(page.locator(".discover-row[data-source-type='raven']")).toBeHidden();
});

test("Discover retains current Atlas rows when Raven Census is unavailable", async ({ page }) => {
  await mockWorkspaceApis(page, { opportunityStatus: 503 });
  await page.route("**/api/atlas", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(atlasPayload()) }));
  await page.goto("/discover/");
  await expect(page.locator("#discoverCensusState")).toHaveText("Unavailable");
  await expect(page.locator("#discoverAtlasState")).toHaveText("Fresh");
  await expect(page.locator(".discover-row[data-source-type='atlas']")).toHaveCount(1);
  await expect(page.locator(".discover-source-notice[data-discover-source-notice='raven']")).toContainText("Older observations were not substituted");
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
  expect(calls.some((call) => call.pairAddress === "fixture-pair-address")).toBe(true);
});

test("Portfolio is one truthful empty state and never a seeded customer account", async ({ page }) => {
  await mockWorkspaceApis(page);
  await page.goto("/portfolio/");
  await expect(page.locator(".portfolio-empty-workspace")).toContainText("There is nothing truthful to total yet");
  await expect(page.locator(".connection-row, .connection-list, .workspace-ledger")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connections unavailable" })).toBeDisabled();
  await expect(page.locator("body")).not.toContainText(/demo portfolio|sample holding|connected wallet/i);
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
  await expect(page.locator("#terminalWhyLabel")).toHaveText("What Atlas adds");
  await expect(page.locator("#terminalWhy")).toContainText("No Raven behavioral claim has been substituted");
  await expect(page.locator("#terminalEvidenceState")).toHaveText("Atlas context · Raven unavailable");
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
  await expect(page.locator("#terminalWhyLabel")).toHaveText("What Atlas adds");
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
  await expect(page.locator("#terminalWhyLabel")).toHaveText("Why this market");
  await expect(page.locator("#terminalWhy")).toContainText("market data only");
  await expect(page.locator("#terminalEvidenceState")).toHaveText("Intelligence unavailable");
  await expect(page.locator("#terminalDeepLink")).toHaveText("Atlas context unavailable");
  await expect(page.locator("#terminalBoundary")).toContainText("Provider snapshot available");
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
  await expect(page.locator("#terminalInstrumentScope")).toHaveText("Exact public pool");
  await expect(page.locator("#terminalWhy")).toContainText(/not substituted/i);
  await expect(page.locator("#terminalAnatomy6")).toHaveText("Review unavailable");
  await expect(page.locator("#terminalAnatomy6")).not.toContainText(/capability|check|required/i);
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
  await expect(page.locator("#terminalCapabilityLabel")).toContainText("exact chart verified");
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
  await expect(page.locator("#atlasContent")).toContainText("Search can still resolve supported entities");
  await expect(page.locator("#atlasContent")).toContainText("no old posture was substituted");
});
