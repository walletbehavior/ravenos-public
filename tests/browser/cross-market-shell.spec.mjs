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
  await expect(row).toContainText("Behavior changed");
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
  await expect(atlasRow).toContainText("behavior view unavailable");
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
  await page.goto("/atlas/");
  await expect(page.locator("#atlasProjectionState")).toHaveText("Available");
  await expect(page.locator(".atlas-market-table")).toContainText("SPY");
  await expect(page.locator(".atlas-market-table")).toContainText("NYSE Arca");
  await expect(page.locator(".atlas-market-table")).not.toContainText("etf:nyse-arca:spy");
  await expect(page.locator(".atlas-list-row")).toContainText("Tradier");
  await expect(page.locator("#atlasContent a[href*='terminal']")).toHaveCount(1);
  await expect(page.locator("#atlasContent a[href*='terminal']")).toHaveAttribute("href", /instrument_id=etf%3Anyse-arca%3Aspy/);
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
});

test("contract-address search resolves an exact Robinhood Chain pool without pretending chart or route support", async ({ page }) => {
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
  await expect(result).toContainText("chart unavailable");
  await result.click();

  await expect(page).toHaveURL(/instrument_id=robinhood%3Apool%3A0x602633/i);
  await expect(page.locator("#terminalInstrument")).toHaveText("RUNNER/WETH");
  await expect(page.locator("#terminalPickerMeta")).toContainText("robinhood:pool:0x602633");
  await expect(page.locator("#terminalSpotControl")).toBeHidden();
  await expect(page.locator("#terminalCapabilityLabel")).toContainText("chart unavailable");
  await expect(page.locator("#terminalChartStatus")).toContainText(/unavailable/i);
  await expect(page.locator("#terminalChart canvas")).toHaveCount(0);
  const state = await page.evaluate(() => window.__RAVENOS_TERMINAL__?.getState());
  expect(state.signingAvailable).toBe(false);
  expect(state.submissionAvailable).toBe(false);
});

test("Atlas outage is isolated and explicit", async ({ page }) => {
  await mockWorkspaceApis(page);
  await page.route("**/api/atlas", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "atlas_projection_unavailable" }) }));
  await page.goto("/atlas/");
  await expect(page.locator("#atlasProjectionState")).toHaveText("Unavailable");
  await expect(page.locator("#atlasContent")).toContainText("Raven opportunities, live perpetuals, and exact crypto charts remain available independently");
});
