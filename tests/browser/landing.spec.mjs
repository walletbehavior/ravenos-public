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
  observed_direction: "long",
  raven_atoms: ["Pressure reversal"],
  market_context: { roundtrip_bps: 17.1 },
  path_review: { state: "forward path reviewing" },
  matured_comparables: { sample_size: 128 },
};

const ATTENTION_BENCHMARK = {
  schema_version: "ravenos_market_attention_benchmark_public_v1",
  generated_at: "2026-07-21T12:19:00Z",
  freshness: { state: "current", age_seconds: 60, target_seconds: 3600 },
  reference_scope: { label: "Third-party market-attention episodes", episode_count: 3795, distinct_markets: 3307 },
  raven_lead: {
    observation: { episodes: 1139, share_of_reference_episodes: 1139 / 3795, median_lead_seconds: 20557 },
    behavior: { episodes: 532, share_of_reference_episodes: 532 / 3795, median_lead_seconds: 9429 },
    exact_decision_context: { episodes: 277, share_of_reference_episodes: 277 / 3795, median_lead_seconds: 15290 },
  },
  interpretation: { profitability_claimed: false, tradeable_rule_claimed: false, selected_instrument_claimed: false },
  public_safety: { reference_source_identity_exposed: false },
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

const BTC_OPPORTUNITY = {
  ...OPPORTUNITY,
  public_opportunity_id: "rop_btc_landing",
  instrument_id: "hyperliquid:perp:BTC",
  instrument: "BTC-PERP",
  why_raven_noticed: "Participation expanded while the exact venue market remained liquid.",
};

const BTC_MARKET = {
  ...MARKET,
  asset: "BTC-PERP",
  symbol: "BTC",
  instrument_id: "hyperliquid:perp:BTC",
  last_price: 67_500,
  day_change_pct: -0.8,
  open_interest_usd: 820_000_000,
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

async function mockLanding(page, { current = true, chartIdentityMismatch = false, opportunities = [OPPORTUNITY], markets = [MARKET] } = {}) {
  await page.route("**/api/opportunity", (route) => route.fulfill({
    status: current ? 200 : 503,
    contentType: "application/json",
    body: JSON.stringify(current ? {
      census: { generated_at: "2026-07-21T12:20:00Z", source_state: "current", opportunities: { rows: opportunities }, attention_benchmark: ATTENTION_BENCHMARK },
      delivery: { source: "current_public_origin", fallback: false, freshness_state: "fresh" },
    } : { ok: false, error: "opportunity_census_projection_unavailable", census: null }),
  }));
  await page.route("**/api/hyperliquid/perps", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, results: markets }) }));
  await page.route("**/api/atlas", (route) => route.fulfill({ status: current ? 200 : 503, contentType: "application/json", body: JSON.stringify(current ? atlasPayload() : { ok: false, error: "atlas_projection_unavailable" }) }));
  await page.route("**/api/health", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ market_data_health: { state: "fresh" }, intelligence_freshness: { state: current ? "fresh" : "unavailable" } }) }));
  await page.route("**/api/terminal/chart**", (route) => {
    const requestedAsset = new URL(route.request().url()).searchParams.get("asset")?.replace(/-PERP$/i, "").toUpperCase() || "SOL";
    const asset = chartIdentityMismatch ? (requestedAsset === "BTC" ? "SOL" : "BTC") : requestedAsset;
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
      candles: providerCandles(`${asset}-PERP`, "1h"),
    }) });
  });
}

test("landing page demonstrates the current exact RavenOS product rather than a static dashboard", async ({ page }) => {
  await mockLanding(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /See the move.*Understand the behavior/i })).toBeVisible();
  await expect(page.locator("#landingOriginState")).toHaveText("Current opportunities");
  await expect(page.locator("#landingOpportunityCount")).toHaveText("1 current exact rows");
  await expect(page.locator("#landingInstrument")).toHaveText("SOL-PERP");
  await expect(page.locator("#landingInstrumentId")).toHaveText("hyperliquid:perp:SOL");
  await expect(page.locator("#landingWhy")).toContainText("Behavior changed");
  await expect(page.locator("#landingEvidence")).toHaveText("Pressure Reversal");
  await expect(page.locator("#landingEdge")).toBeVisible();
  await expect(page.locator("#landingEdgeObserved")).toHaveText("1,139");
  await expect(page.locator("#landingEdgeLead")).toHaveText("5h 43m");
  await expect(page.locator("#landingEdgeExact")).toHaveText("277");
  await expect(page.locator("body")).not.toContainText(/gmgn/i);
  await expect(page.locator("#landingChartWrap")).toHaveAttribute("data-state", "live");
  await expect(page.locator("#landingChart .rpw")).toHaveAttribute("data-price-workspace-state", "live");
  await expect.poll(() => page.locator("#landingChart .rpw-chart canvas").count()).toBeGreaterThan(1);
  await expect(page.locator("#landingChart [data-rpw-crosshair]")).toContainText("Base vol");
  await expect(page.locator("#landingChart [data-rpw-crosshair]")).toContainText("Quote vol");
  await expect(page.locator("#landingAtlasList .landing-atlas-row")).toContainText("SPY");
  await expect(page.locator("#landingAtlasList .landing-atlas-row")).toHaveAttribute("href", /instrument_id=etf%3Anyse-arca%3Aspy/);
  const product = await page.evaluate(() => window.__RAVENOS_LANDING__?.getState());
  expect(product.instrumentId).toBe("hyperliquid:perp:SOL");
  expect(product.candleCount).toBeGreaterThan(20);
  expect(product.chartType).toBe("candlestick");
  expect(product.chartInstrumentId).toBe("perpetual:hyperliquid:hyperliquid:SOL:USD:aggregate");
  expect(product.renderedCandles).toBeGreaterThan(20);
  expect(product.signingAvailable).toBe(false);
  expect(product.submissionAvailable).toBe(false);
  await expect(page.locator(".landing-nav nav a")).toHaveCount(4);
});

test("every selected landing opportunity redraws exact provider OHLC as candlesticks", async ({ page }) => {
  await mockLanding(page, { opportunities: [OPPORTUNITY, BTC_OPPORTUNITY], markets: [MARKET, BTC_MARKET] });
  await page.goto("/");
  await expect(page.locator("#landingChart .rpw")).toHaveAttribute("data-price-workspace-state", "live");
  await page.locator('.landing-opportunity[data-instrument-id="hyperliquid:perp:BTC"]').click();
  await expect(page.locator("#landingInstrumentId")).toHaveText("hyperliquid:perp:BTC");
  await expect(page.locator("#landingChartWrap")).toHaveAttribute("data-state", "live");
  await expect(page.locator("#landingChart .rpw")).toHaveAttribute("data-price-workspace-state", "live");
  const product = await page.evaluate(() => window.__RAVENOS_LANDING__?.getState());
  expect(product.instrumentId).toBe("hyperliquid:perp:BTC");
  expect(product.chartInstrumentId).toBe("perpetual:hyperliquid:hyperliquid:BTC:USD:aggregate");
  expect(product.candleCount).toBeGreaterThan(20);
  expect(product.renderedCandles).toBeGreaterThan(20);
});

test("landing chart uses the shared timeframe controls and keeps exact identity", async ({ page }) => {
  const requested = [];
  await mockLanding(page);
  page.on("request", (request) => {
    if (request.url().includes("/api/terminal/chart")) requested.push(new URL(request.url()).searchParams.get("timeframe"));
  });
  await page.goto("/");
  await expect(page.locator("#landingChartWrap")).toHaveAttribute("data-state", "live");
  await page.locator('#landingChart [data-timeframe="15m"]').click();
  await expect.poll(() => requested.at(-1)).toBe("15m");
  await expect(page.locator('#landingChart [data-timeframe="15m"]')).toHaveAttribute("aria-pressed", "true");
  const product = await page.evaluate(() => window.__RAVENOS_LANDING__?.getState());
  expect(product.timeframe).toBe("15m");
  expect(product.chartInstrumentId).toBe("perpetual:hyperliquid:hyperliquid:SOL:USD:aggregate");
});

test("landing page keeps current-origin failure explicit and generates no fallback chart", async ({ page }) => {
  await mockLanding(page, { current: false });
  await page.goto("/");
  await expect(page.locator("#landingOriginState")).toHaveText("Raven refreshing");
  await expect(page.locator("#landingOpportunityList")).toContainText("Raven is refreshing current attention");
  await expect(page.locator(".landing-read")).toBeHidden();
  await expect(page.locator(".landing-atlas-band")).toBeHidden();
  await expect(page.locator("#landingEdge")).toBeHidden();
  await expect(page.locator("#landingChartWrap")).toHaveAttribute("data-state", "unavailable");
  const product = await page.evaluate(() => window.__RAVENOS_LANDING__?.getState());
  expect(product.candleCount).toBe(0);
  expect(product.chartType).toBeNull();
  expect(product.instrumentId).toBeNull();
});

test("landing page rejects a chart whose normalized exact identity belongs to another market", async ({ page }) => {
  await mockLanding(page, { chartIdentityMismatch: true });
  await page.goto("/");
  await expect(page.locator("#landingInstrumentId")).toHaveText("hyperliquid:perp:SOL");
  await expect(page.locator("#landingChartWrap")).toHaveAttribute("data-state", "unavailable");
  await expect(page.locator("#landingChart [data-rpw-state-panel]")).toContainText("No other market was substituted");
  const product = await page.evaluate(() => window.__RAVENOS_LANDING__?.getState());
  expect(product.candleCount).toBe(0);
  expect(product.chartType).toBeNull();
});

test("landing page is composed for a 390px mobile viewport without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLanding(page);
  await page.goto("/");
  await expect(page.locator(".landing-launch")).toBeVisible();
  await expect(page.locator("#landingChartWrap")).toHaveAttribute("data-state", "live");
  await expect(page.locator("#landingChart .rpw")).toHaveAttribute("data-price-workspace-state", "live");
  await expect(page.locator("#landingChart [data-rpw-crosshair]")).toContainText("O");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});
