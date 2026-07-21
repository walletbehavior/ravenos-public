import { expect, test } from "@playwright/test";

const candles = Array.from({ length: 80 }, (_, index) => ({
  time: 1_800_000_000 + index * 3600,
  open: 145 + index * 0.05,
  high: 145.6 + index * 0.05,
  low: 144.6 + index * 0.05,
  close: 145.2 + index * 0.05,
  volume: 1000 + index * 20,
}));

async function installPerpsMocks(page, { chartRequests = [] } = {}) {
  await page.addInitScript(() => {
    class RavenMockWebSocket extends EventTarget {
      constructor() {
        super();
        this.readyState = 0;
        setTimeout(() => {
          this.readyState = 1;
          this.dispatchEvent(new Event("open"));
        }, 20);
      }
      send(raw) {
        const message = JSON.parse(raw);
        const subscription = message.subscription || {};
        if (message.method === "ping") {
          setTimeout(() => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ channel: "pong" }) })), 1);
          return;
        }
        if (message.method !== "subscribe") return;
        const emit = (channel, data) => setTimeout(() => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ channel, data }) })), 15);
        if (subscription.type === "candle") emit("candle", { t: 1_800_284_400_000, o: "149.1", h: "150.4", l: "148.9", c: "150.1", v: "1820", n: 44 });
        if (subscription.type === "trades") emit("trades", [{ coin: "SOL", side: "B", px: "150.12", sz: "4.2", hash: "0xtrade", time: 1_800_284_401_000, tid: 81 }]);
        if (subscription.type === "l2Book") emit("l2Book", { coin: "SOL", time: 1_800_284_401_500, levels: [[{ px: "150.10", sz: "18", n: 5 }, { px: "150.05", sz: "30", n: 8 }], [{ px: "150.14", sz: "12", n: 4 }, { px: "150.20", sz: "25", n: 7 }]] });
        if (subscription.type === "activeAssetCtx") emit("activeAssetCtx", { coin: "SOL", ctx: { markPx: "150.13", oraclePx: "150.02", midPx: "150.12", funding: "0.000012", openInterest: "1234567", dayNtlVlm: "88220000", prevDayPx: "147.8" } });
      }
      close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
    }
    Object.defineProperty(window, "WebSocket", { configurable: true, writable: true, value: RavenMockWebSocket });
  });
  await page.route("**/api/hyperliquid/perps", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    ok: true,
    schema_version: "ravenos.hyperliquid.markets.v2",
    provider: "Hyperliquid",
    coverage: "Live",
    results: [{ instrument_id: "hyperliquid:perp:SOL", asset: "SOL-PERP", symbol: "SOL", last_price: 149.15, mark_price: 149.16, oracle_price: 149.10, mid_price: 149.14, funding_rate: 0.00001, open_interest_base: 1_200_000, open_interest_usd: 179_000_000, day_notional_volume_usd: 80_000_000, previous_day_price: 147, max_leverage: 20 }],
  }) }));
  await page.route("**/api/terminal/chart**", (route) => {
    chartRequests.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    ok: true,
    asset: "SOL-PERP",
    source: "Hyperliquid",
    source_label: "Hyperliquid market history",
    freshness_state: "live",
    observed_at: new Date().toISOString(),
    instrument: {
      schema_version: "ravenos.chart_instrument.v1",
      canonical_id: "perpetual:hyperliquid:hyperliquid:SOL:USD:aggregate",
      instrument_type: "perpetual",
      chain: "hyperliquid",
      venue: "hyperliquid",
      symbol: "SOL-PERP",
      base_asset: "SOL",
      quote_asset: "USD",
      identity_scope: "venue_market",
      aggregate_token: false,
      provider_routing: { history: "hyperliquid", live: "hyperliquid_websocket", provider_asset: "SOL", provider_network: "hyperliquid" },
    },
    capabilities: { historical_bars: true, older_bar_backfill: true, live_bars: true, live_trades: true, order_book: true, funding: true, open_interest: true, raven_overlays: true },
    market_state: { last: 149.15, mark: 149.16, oracle: 149.10, funding: 0.00001, open_interest: 1_200_000, volume_24h: 80_000_000, previous_day_price: 147, max_leverage: 20 },
    lineage: { provider: "Hyperliquid", market: "SOL" },
      candles,
    }) });
  });
  await page.route("**/api/perps/instrument**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    ok: true,
    schema_version: "ravenos.perp_terminal_context.v1",
    instrument: { instrument_id: "hyperliquid:perp:SOL", instrument: "SOL-PERP", symbol: "SOL", venue: "hyperliquid", market_type: "perpetual", instrument_scope: "exact_instrument" },
    market_data: {
      ok: true,
      generated_at: new Date().toISOString(),
      market: { mark_price: 149.16, oracle_price: 149.10, funding_rate: 0.00001, open_interest_usd: 179_000_000, day_notional_volume_usd: 80_000_000, previous_day_price: 147 },
      book: { bids: [{ price: 150.10, size: 18, order_count: 5 }, { price: 150.05, size: 30, order_count: 8 }], asks: [{ price: 150.14, size: 12, order_count: 4 }, { price: 150.20, size: 25, order_count: 7 }], summary: { best_bid: 150.10, best_ask: 150.14, spread_bps: 2.664 } },
      tape: { trades: [{ observed_at: new Date().toISOString(), book_side: "bid", price: 150.12, size: 4.2, notional_usd: 630.5 }], privacy: { participant_addresses_removed: true, transaction_hashes_removed: true, provider_trade_ids_removed: true } },
      components: { market: "fresh", book: "fresh", tape: "fresh" },
    },
    raven_context: {
      public_context_id: "perpctx_public_fixture",
      instrument_id: "hyperliquid:perp:SOL",
      instrument: "SOL-PERP",
      context_available: true,
      context_state: "fresh",
      observed_at: new Date(1_800_100_000 * 1000).toISOString(),
      observed_side: "long",
      behavior_family: "Compression release",
      pressure_state: "Bid-side pressure visible",
      entry_reference: { price: 146.4, observed_at: new Date(1_800_100_000 * 1000).toISOString(), source: "decision-time mark" },
      friction_context: { state: "observed", roundtrip_bps: 7.2, measurement_only: true },
      why_raven_noticed: "Raven froze a compression release observation while bid-side pressure was present.",
      outcomes: { sample_size: 12, evidence_maturity: "forming", median_observed_change_pct: 1.1, median_favorable_excursion_pct: 2.4, median_adverse_excursion_pct: -0.9, positive_followthrough_rate: 0.5833, matured_through: new Date().toISOString() },
      plan_preview: { state: "research_only", directional_context: "long", reference_price: 146.4, review_horizon: "24h research window", sample_size: 12, evidence_maturity: "forming", production_qualified: false, personalized: false, executable: false, note: "Historical excursions are context, not target or stop instructions." },
    },
    raven_read: { state: "fresh", headline: "SOL-PERP · Compression release", summary: "Bid-side pressure accompanied a frozen upside research observation. 12 matured comparable paths are available.", why_raven_noticed: "Raven froze a compression release observation while bid-side pressure was present.", what_would_strengthen: ["Pressure persists while market depth remains usable."], what_would_weaken: ["The decision-time structure fades or reverses."] },
    matured_comparables: { sample_size: 12, evidence_maturity: "forming", median_observed_change_pct: 1.1, median_favorable_excursion_pct: 2.4, median_adverse_excursion_pct: -0.9, positive_followthrough_rate: 0.5833, matured_through: new Date().toISOString() },
    plan_preview: { state: "research_only", directional_context: "long", reference_price: 146.4, review_horizon: "24h research window", sample_size: 12, evidence_maturity: "forming", production_qualified: false, personalized: false, executable: false, execution_available: false, note: "Historical excursions are context, not target or stop instructions." },
    chart_event: { event_id: "perpctx_public_fixture", instrument_id: "hyperliquid:perp:SOL", observed_at: new Date(1_800_100_000 * 1000).toISOString(), lineage: { public_context_id: "perpctx_public_fixture" } },
    execution: { mode: "read_only", signing_available: false, submission_available: false, position_monitoring_available: false },
    delivery: { source: "current_public_origin", freshness_state: "fresh", fallback: false },
  }) }));
  await page.route("**/api/perps", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ generated_at: new Date().toISOString(), data: { instrument_context: { rows: [{ instrument: "SOL-PERP", context_available: true, context_state: "fresh", context_age_seconds: 120, outcomes: { sample_size: 12 } }] } } }) }));
}

test("perps workspace forms a live candle and keeps market truth separate", async ({ page }) => {
  const chartRequests = [];
  await installPerpsMocks(page, { chartRequests });
  await page.goto("/perps/");
  await page.waitForFunction(() => window.__RAVENOS_PERPS_WORKSPACE__?.getState?.().tapeCount > 0 && window.__RAVENOS_PERPS_WORKSPACE__?.getState?.().hasOrderBook);
  const workspace = await page.evaluate(() => window.__RAVENOS_PERPS_WORKSPACE__.getState());
  expect(workspace.instrument).toBe("SOL-PERP");
  expect(workspace.candleCount).toBeGreaterThan(79);
  expect(workspace.connectionState).toBe("live");
  expect(workspace.tapeCount).toBeGreaterThan(0);
  expect(workspace.contextState).toBe("fresh");
  expect(workspace.deliveryState).toBe("fresh");
  expect(workspace.comparableSample).toBe(12);
  expect(workspace.planExecutable).toBe(false);
  expect(workspace.backfillCount).toBe(0);
  expect(chartRequests).toHaveLength(1);
  expect(chartRequests[0]).not.toContain("before=");
  expect(workspace.diagnostics.active_instruments).toBe(1);
  await expect(page.locator("#perpsChart canvas").first()).toBeVisible();
  await expect(page.locator("#perpsMark")).toContainText("150.13");
  await expect(page.locator("#perpsOracle")).toContainText("150.02");
  await expect(page.locator("#perpsFunding")).toContainText("0.0012%");
  await expect(page.locator("#perpsBookState")).toHaveText("2 levels / side");
  await expect(page.locator(".rpw-trade-buy")).toContainText("BUY");
  await expect(page.locator("#perpsReadHeadline")).toHaveText("SOL-PERP · Compression release");
  await expect(page.locator("#perpsComparableN")).toHaveText("12");
  await expect(page.locator("#perpsPlanState")).toHaveText("Research only");
  await expect(page.getByText("Signing, submission, and position monitoring off", { exact: true })).toBeVisible();
  await expect(page.locator("[data-ravenos-build-id]")).not.toHaveText("pending");
  await expect(page.locator("#perpsRavenMarker")).toBeEnabled();
  await expect(page.locator("#perpsRavenMarker")).toHaveAttribute("aria-pressed", "true");
});

test("perps workspace remains usable on a narrow mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installPerpsMocks(page);
  await page.goto("/perps/");
  await page.waitForFunction(() => window.__RAVENOS_PERPS_WORKSPACE__?.getState?.().tapeCount > 0);
  await expect(page.locator("#perpsChart canvas").first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.locator("#perpsInstrument")).toBeVisible();
  await expect(page.locator("#perpsBook")).toBeHidden();
  await page.getByRole("button", { name: "Book + tape", exact: true }).click();
  await expect(page.locator("#perpsBook")).toBeVisible();
});
