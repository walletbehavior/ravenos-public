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
    provider: "Hyperliquid",
    coverage: "Live",
    results: [{ asset: "SOL-PERP", symbol: "SOL", pressureState: "Elevated", participantActivity: "OI expansion", liquidityPosture: "Deep", risk: "Watch", lastPrice: 149.15, markPx: 149.16, oraclePx: 149.10, midPx: 149.14, funding: 0.00001, openInterest: 1_200_000, dayNtlVlm: 80_000_000, prevDayPx: 147, maxLeverage: 20 }],
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
  await page.route("**/api/perps", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ generated_at: new Date().toISOString(), data: { forward_observation: { observations: 38, matured_windows: { "1h": 30, "12h": 12 } } } }) }));
}

test("perps workspace forms a live candle and keeps market truth separate", async ({ page }) => {
  const chartRequests = [];
  await installPerpsMocks(page, { chartRequests });
  await page.goto("/perps/");
  await page.waitForFunction(() => window.__RAVENOS_PERPS_WORKSPACE__?.getState?.().tradeCount > 0 && window.__RAVENOS_PERPS_WORKSPACE__?.getState?.().hasOrderBook);
  const workspace = await page.evaluate(() => window.__RAVENOS_PERPS_WORKSPACE__.getState());
  expect(workspace.instrument).toBe("SOL-PERP");
  expect(workspace.candleCount).toBeGreaterThan(79);
  expect(workspace.connectionState).toBe("live");
  expect(workspace.tradeCount).toBe(1);
  expect(workspace.backfillCount).toBe(0);
  expect(chartRequests).toHaveLength(1);
  expect(chartRequests[0]).not.toContain("before=");
  expect(workspace.diagnostics.active_instruments).toBe(1);
  await expect(page.locator("#perpsChart canvas").first()).toBeVisible();
  await expect(page.locator("#perpsMark")).toContainText("150.13");
  await expect(page.locator("#perpsOracle")).toContainText("150.02");
  await expect(page.locator("#perpsFunding")).toContainText("0.0012%");
  await expect(page.locator("#perpsBookState")).toHaveText("Live venue snapshot");
  await expect(page.locator(".rpw-trade-buy")).toContainText("BUY");
  await expect(page.getByText("Read-only market terminal", { exact: false })).toBeVisible();
  await expect(page.locator("[data-ravenos-build-id]")).not.toHaveText("pending");
  await expect(page.getByRole("button", { name: "Models" })).toBeDisabled();
});

test("perps workspace remains usable on a narrow mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installPerpsMocks(page);
  await page.goto("/perps/");
  await page.waitForFunction(() => window.__RAVENOS_PERPS_WORKSPACE__?.getState?.().tradeCount > 0);
  await expect(page.locator("#perpsChart canvas").first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.locator("#perpsInstrument")).toBeVisible();
  await expect(page.locator("#perpsBook")).toBeHidden();
  await page.getByRole("button", { name: "Book", exact: true }).click();
  await expect(page.locator("#perpsBook")).toBeVisible();
});
