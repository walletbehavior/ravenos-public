import { test, expect } from "@playwright/test";

import { providerCandles } from "./terminal-live-fixtures.mjs";

const OPPORTUNITY = {
  public_opportunity_id: "rop_sol_landing",
  instrument_id: "hyperliquid:perp:SOL",
  instrument: "SOL-PERP",
  market_type: "perpetual",
  identity_scope: "exact venue instrument",
  context_state: "fresh",
  why_raven_noticed: "Behavior changed while pressure remained observable.",
  pressure_state: "Mixed pressure",
  path_review: { state: "forward path reviewing" },
  matured_comparables: { sample_size: 128 },
};

const MARKET = {
  asset: "SOL-PERP",
  symbol: "SOL",
  instrument_id: "hyperliquid:perp:SOL",
  last_price: 148.25,
  day_change_pct: 2.4,
  funding_rate: -0.000012,
  open_interest_usd: 192_000_000,
};

function atlasPayload() {
  return {
    schema_version: "ravenos.atlas_projection.v1",
    generated_at: "2026-07-21T12:20:00Z",
    state: "available",
    freshness: { state: "fresh" },
    market_context: { rows: [{
      instrument_id: "etf:nyse-arca:spy",
      instrument: {
        instrument_id: "etf:nyse-arca:spy",
        symbol: "SPY",
        asset_class: "etf",
        instrument_type: "etf",
        identity_scope: "exact_instrument",
        venue: "nyse-arca",
        market_identity: { listing: "NYSE Arca" },
        quote_asset: { symbol: "USD" },
        settlement_asset: { symbol: "USD" },
        economic_numeraire: "USDC",
        capabilities: { execution: false },
      },
      symbol: "SPY",
      price: 640.25,
      change_21d: 0.031,
    }] },
    execution_boundary: { signing_available: false, submission_available: false },
    delivery: { source: "current_public_origin", fallback: false, freshness_state: "fresh" },
  };
}

async function mockLanding(page, { current = true, chartIdentityMismatch = false } = {}) {
  await page.route("**/api/opportunity", (route) => route.fulfill({
    status: current ? 200 : 503,
    contentType: "application/json",
    body: JSON.stringify(current ? {
      census: { generated_at: "2026-07-21T12:20:00Z", source_state: "current", opportunities: { rows: [OPPORTUNITY] } },
      delivery: { source: "current_public_origin", fallback: false, freshness_state: "fresh" },
    } : { ok: false, error: "opportunity_census_projection_unavailable", census: null }),
  }));
  await page.route("**/api/hyperliquid/perps", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, results: [MARKET] }) }));
  await page.route("**/api/atlas", (route) => route.fulfill({ status: current ? 200 : 503, contentType: "application/json", body: JSON.stringify(current ? atlasPayload() : { ok: false, error: "atlas_projection_unavailable" }) }));
  await page.route("**/api/health", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ market_data_health: { state: "fresh" }, intelligence_freshness: { state: current ? "fresh" : "unavailable" } }) }));
  await page.route("**/api/terminal/chart**", (route) => {
    const asset = chartIdentityMismatch ? "BTC" : "SOL";
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      ok: true,
      instrument_scope: "exact_instrument",
      freshness_state: "fresh",
      instrument: {
        schema_version: "ravenos.chart_instrument.v1",
        canonical_id: `perpetual:hyperliquid:hyperliquid:${asset}:USD:aggregate`,
        instrument_type: "perpetual",
        identity_scope: "venue_market",
        venue: "hyperliquid",
        chain: "hyperliquid",
        symbol: `${asset}-PERP`,
        base_asset: asset,
        quote_asset: "USD",
        aggregate_token: false,
        provider_routing: { history: "hyperliquid", live: "hyperliquid_websocket", provider_asset: asset, provider_network: "hyperliquid" },
      },
      candles: providerCandles("SOL-PERP", "1h"),
    }) });
  });
}

test("landing page demonstrates the current exact RavenOS product rather than a static dashboard", async ({ page }) => {
  await mockLanding(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /See the move.*Understand the behavior/i })).toBeVisible();
  await expect(page.locator("#landingOriginState")).toHaveText("Current public origin");
  await expect(page.locator("#landingOpportunityCount")).toHaveText("1 current exact rows");
  await expect(page.locator("#landingInstrument")).toHaveText("SOL-PERP");
  await expect(page.locator("#landingInstrumentId")).toHaveText("hyperliquid:perp:SOL");
  await expect(page.locator("#landingWhy")).toContainText("Behavior changed");
  await expect(page.locator("#landingChartWrap")).toHaveAttribute("data-state", "live");
  await expect(page.locator("#landingAtlasList .landing-atlas-row")).toContainText("SPY");
  await expect(page.locator("#landingAtlasList .landing-atlas-row")).toHaveAttribute("href", /instrument_id=etf%3Anyse-arca%3Aspy/);
  const product = await page.evaluate(() => window.__RAVENOS_LANDING__?.getState());
  expect(product.instrumentId).toBe("hyperliquid:perp:SOL");
  expect(product.candleCount).toBeGreaterThan(20);
  expect(product.signingAvailable).toBe(false);
  expect(product.submissionAvailable).toBe(false);
  await expect(page.locator(".landing-nav nav a")).toHaveCount(4);
});

test("landing page keeps current-origin failure explicit and generates no fallback chart", async ({ page }) => {
  await mockLanding(page, { current: false });
  await page.goto("/");
  await expect(page.locator("#landingOriginState")).toHaveText("Current origin unavailable");
  await expect(page.locator("#landingOpportunityList")).toContainText("Current Census unavailable");
  await expect(page.locator("#landingWhy")).toContainText("Current Raven opportunity evidence is unavailable");
  await expect(page.locator("#landingChartWrap")).toHaveAttribute("data-state", "unavailable");
  await expect(page.locator("#landingAtlasList")).toContainText("Atlas unavailable");
  const product = await page.evaluate(() => window.__RAVENOS_LANDING__?.getState());
  expect(product.candleCount).toBe(0);
  expect(product.instrumentId).toBeNull();
});

test("landing page rejects a chart whose normalized exact identity belongs to another market", async ({ page }) => {
  await mockLanding(page, { chartIdentityMismatch: true });
  await page.goto("/");
  await expect(page.locator("#landingInstrumentId")).toHaveText("hyperliquid:perp:SOL");
  await expect(page.locator("#landingChartWrap")).toHaveAttribute("data-state", "unavailable");
  await expect(page.locator("#landingChartState")).toContainText("No fallback series was generated");
  const product = await page.evaluate(() => window.__RAVENOS_LANDING__?.getState());
  expect(product.candleCount).toBe(0);
});

test("landing page is composed for a 390px mobile viewport without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLanding(page);
  await page.goto("/");
  await expect(page.locator(".landing-launch")).toBeVisible();
  await expect(page.locator("#landingChartWrap")).toHaveAttribute("data-state", "live");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});
