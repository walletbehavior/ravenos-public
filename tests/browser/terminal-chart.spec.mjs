import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";

import {
  mockTerminalLiveApis,
  openExactSpotSearch,
  selectUniversalInstrument,
  waitForTerminalLive,
} from "./terminal-live-fixtures.mjs";

async function chartHash(page) {
  const screenshot = await page.locator("#terminalChart").screenshot();
  return createHash("sha256").update(screenshot).digest("hex");
}

async function visibleBodyText(page) {
  return page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const chunks = [];
    let node = walker.nextNode();
    while (node) {
      const parent = node.parentElement;
      const value = node.nodeValue.trim();
      if (parent && value) {
        const style = getComputedStyle(parent);
        const bounds = parent.getBoundingClientRect();
        if (style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && bounds.width > 0 && bounds.height > 0) chunks.push(value);
      }
      node = walker.nextNode();
    }
    return chunks.join(" ");
  });
}

function boxesOverlap(left, right) {
  if (!left || !right) return true;
  return !(
    left.x + left.width <= right.x
    || right.x + right.width <= left.x
    || left.y + left.height <= right.y
    || right.y + right.height <= left.y
  );
}

test("Terminal loads exact Hyperliquid facts, a real chart, and joined Raven context", async ({ page }) => {
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { lane: "perps", instrument: "SOL-PERP", timeframe: "1h" });

  await expect(page.locator("#terminalInstrument")).toHaveText("SOL-PERP");
  await expect(page.locator("#terminalInstrumentMeta")).toContainText("hyperliquid:perp:SOL");
  await expect(page.locator("#terminalLast")).not.toHaveText("--");
  await expect(page.locator("#terminalMetric3Label")).toHaveText("Funding");
  await expect(page.locator("#terminalMetric4Label")).toHaveText("Open interest");
  await expect(page.locator("#terminalChart canvas").first()).toBeVisible();
  await expect(page.locator("#terminalReadHeadline")).toContainText("SOL-PERP · Behavioral setup");
  await expect(page.locator("#terminalWhy")).toContainText("Behavior changed");
  await expect(page.locator("#terminalComparableN")).toHaveText("128");
  await expect(page.locator("#terminalPlanSection")).toBeVisible();
  await expect(page.locator("#terminalPlanEntry")).toContainText("$148");
  await expect(page.locator("#terminalPlanTarget")).toContainText("+3.10%");
  await expect(page.locator("#terminalPlanRisk")).toContainText("-1.20%");
  await expect(page.locator("#terminalPlanToggle")).not.toBeChecked();
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_CHART_GEOMETRY__?.available_overlay_count)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_CHART_GEOMETRY__?.active_overlay_count)).toBe(0);
  await page.locator("#terminalPlanToggle").check();
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_CHART_GEOMETRY__?.available_overlay_count)).toBe(3);
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_CHART_GEOMETRY__?.active_overlay_count)).toBe(3);
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_CHART_GEOMETRY__?.active_overlay_types || [])).toEqual(["plan-entry", "plan-target", "plan-risk"]);
  await expect(page.locator("#terminalEvidenceState")).toContainText(/Current observation · current feed/i);
  await expect(page.locator("#terminalAnatomy1Label")).toHaveText("Open interest");
  await expect(page.locator("#terminalAnatomy1")).toContainText("192M");
  await expect(page.locator("#terminalAnatomy4")).toContainText("2.66 bps");
  await expect(page.locator("#terminalFingerprint")).toHaveText("hyperliquid:perp:SOL");
  await page.locator("#terminalSourceDetail > summary").click();
  await expect(page.locator("#terminalSourceProvider")).toHaveText("Hyperliquid");
  await expect(page.locator("#terminalSourceInterval")).toContainText("Direct 1h bars");
  await expect(page.getByRole("link", { name: /Lightweight Charts.*TradingView/i })).toBeVisible();
  await page.locator(".rpw-marker-index button", { hasText: "Behavioral setup" }).click();
  await expect(page.locator("#terminalMarkerDetail")).toBeVisible();
  await expect(page.locator("#terminalMarkerSource")).toContainText("Timestamped Raven observation");
  await expect(page.locator("#terminalMarkerMaturity")).toHaveText("Matured");
  await expect(page.locator("#terminalMarkerSupport")).toContainText("Pressure broadens");
  await page.locator("#terminalMarkerClose").click();
  await expect(page.locator("#terminalMarkerDetail")).toBeHidden();
  await expect(page.locator(".ros-capability-status, .terminal-continuity")).toHaveCount(0);
  await expect(page.locator("#terminalBoundary")).toContainText("No order can be signed or sent");
  await expect(page.locator("#assetSelect option")).toHaveCount(2);
  await expect(page.locator("#terminalModeSelect")).toBeHidden();
  await expect(page.locator("#terminalModeSelect option")).toHaveCount(3);
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_CHART_GEOMETRY__?.marker_count)).toBe(1);

  const state = await page.evaluate(() => window.__RAVENOS_TERMINAL__.getState());
  expect(state.instrumentId).toContain("hyperliquid");
  expect(state.candleCount).toBeGreaterThan(20);
  expect(state.signingAvailable).toBe(false);
  expect(state.submissionAvailable).toBe(false);
});

test("live chart connection status reaches the visible Terminal instead of remaining on Connecting", async ({ page }) => {
  await page.addInitScript(() => {
    class TestWebSocket {
      constructor() {
        this.readyState = 0;
        this.listeners = new Map();
        setTimeout(() => {
          this.readyState = 1;
          for (const listener of this.listeners.get("open") || []) listener({ type: "open" });
        }, 15);
      }

      addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
      }

      send() {}

      close() {
        this.readyState = 3;
      }
    }
    window.WebSocket = TestWebSocket;
  });
  await mockTerminalLiveApis(page, { liveBars: true });
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_TERMINAL__?.getState?.().connectionState)).toBe("live");
  await expect(page.locator("#terminalChartStatus")).toContainText(/Live/i);
  await expect(page.locator("#terminalBoundary strong")).toHaveText("Live market feed");
});

test("hidden Terminal pauses its shared live feed and resumes the exact market without replacing the chart", async ({ page }) => {
  await page.addInitScript(() => {
    let hidden = false;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    window.__setRavenOSHidden = (value) => {
      hidden = Boolean(value);
      document.dispatchEvent(new Event("visibilitychange"));
    };
    window.__RAVENOS_TEST_SOCKET_COUNTS__ = { opened: 0, closed: 0 };
    class TestWebSocket {
      constructor() {
        window.__RAVENOS_TEST_SOCKET_COUNTS__.opened += 1;
        this.readyState = 0;
        this.listeners = new Map();
        setTimeout(() => {
          this.readyState = 1;
          for (const listener of this.listeners.get("open") || []) listener({ type: "open" });
        }, 15);
      }

      addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
      }

      send() {}

      close() {
        window.__RAVENOS_TEST_SOCKET_COUNTS__.closed += 1;
        this.readyState = 3;
      }
    }
    window.WebSocket = TestWebSocket;
  });
  await mockTerminalLiveApis(page, { liveBars: true });
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_TERMINAL__?.getState?.().connectionState)).toBe("live");
  const identity = await page.locator("#terminalInstrumentMeta").textContent();
  const candleCount = await page.evaluate(() => window.__RAVENOS_TERMINAL__.getState().candleCount);

  await page.evaluate(() => window.__setRavenOSHidden(true));
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_TERMINAL__?.getState?.().connectionState)).toBe("paused_hidden");
  await expect.poll(() => page.evaluate(() => window.RavenOSChartDataPlane.diagnostics().active_viewers)).toBe(0);
  await expect(page.locator("#terminalChart canvas").first()).toBeVisible();

  await page.waitForTimeout(1_700);
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_TEST_SOCKET_COUNTS__.closed)).toBeGreaterThan(0);
  await page.evaluate(() => window.__setRavenOSHidden(false));
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_TERMINAL__?.getState?.().connectionState)).toBe("live");
  await expect.poll(() => page.evaluate(() => window.RavenOSChartDataPlane.diagnostics().active_viewers)).toBe(1);
  await expect(page.locator("#terminalInstrumentMeta")).toHaveText(identity || "");
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_TERMINAL__.getState().candleCount)).toBeGreaterThanOrEqual(candleCount);
  await expect(page.locator("#terminalChart canvas").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_TEST_SOCKET_COUNTS__.opened)).toBeGreaterThanOrEqual(2);
});

test("default market favors the newest matching Raven observation before historical sample size", async ({ page }) => {
  await mockTerminalLiveApis(page);
  await page.unroute("**/api/perps");
  await page.route("**/api/perps", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      data: {
        instrument_context: {
          rows: [
            { instrument: "SOL-PERP", context_available: true, context_state: "delayed", context_age_seconds: 1_800, outcomes: { sample_size: 900 } },
            { instrument: "BTC-PERP", context_available: true, context_state: "delayed", context_age_seconds: 12, outcomes: { sample_size: 4 } },
          ],
        },
      },
    }),
  }));
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { instrument: "BTC-PERP" });
  await expect(page.locator("#terminalInstrument")).toHaveText("BTC-PERP");
});

test("chart basics expose intervals, verified indicators, readable crosshair data, and focus mode", async ({ page }) => {
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { lane: "perps", instrument: "SOL-PERP", timeframe: "1h" });

  const chart = page.locator("#terminalChart .rpw");
  await expect(chart.locator("[data-rpw-timeframes] button")).toHaveText(["1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M"]);
  await expect(chart.locator('[data-rpw-timeframes] button[data-timeframe="1h"]')).toHaveAttribute("aria-pressed", "true");
  await expect(chart.locator('[data-rpw-indicator="ema20"]')).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_LAST_INDICATOR_STATE__?.ema20?.points || 0)).toBeGreaterThan(20);
  const initialGeometry = await page.evaluate(() => window.__RAVENOS_CHART_GEOMETRY__);
  expect(initialGeometry.price_axis).toMatchObject({
    side: "right",
    visible: true,
    auto_scale: "visible_range",
    quote_asset: "USD",
  });
  expect(initialGeometry.price_axis.precision).toBeGreaterThanOrEqual(2);
  expect(initialGeometry.price_axis.min_move).toBeGreaterThan(0);

  const candleLegend = chart.locator("[data-rpw-crosshair]");
  await expect(candleLegend).toBeVisible();
  await expect(candleLegend).toHaveAttribute("data-mode", "latest");
  await expect(candleLegend).toContainText(/Latest.*UTC.*O.*H.*L.*C.*Change.*Base vol.*Quote vol/s);
  await expect(candleLegend).toContainText("--");

  await chart.locator('[data-rpw-indicator="ema50"]').click();
  await expect(chart.locator('[data-rpw-indicator="ema50"]')).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_LAST_INDICATOR_STATE__?.ema50?.points || 0)).toBeGreaterThan(0);

  const canvas = chart.locator(".rpw-stage canvas").first();
  const bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * 0.55, bounds.y + bounds.height * 0.45);
  await expect(candleLegend).toHaveAttribute("data-mode", "inspect");
  await expect(candleLegend).toContainText(/Inspect.*UTC.*O.*H.*L.*C.*Change.*Base vol.*Quote vol/s);
  for (let index = 0; index < 12; index += 1) await page.mouse.wheel(0, -500);
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_CHART_GEOMETRY__?.visible_bars || 0))
    .toBeLessThan(Math.floor(initialGeometry.visible_bars * 0.7));
  await expect.poll(() => page.evaluate(() => {
    const geometry = window.__RAVENOS_CHART_GEOMETRY__;
    return geometry?.price_range ? geometry.price_range.max - geometry.price_range.min : null;
  })).not.toBe(initialGeometry.price_range.max - initialGeometry.price_range.min);
  const zoomedGeometry = await page.evaluate(() => window.__RAVENOS_CHART_GEOMETRY__);
  expect(zoomedGeometry.price_axis.auto_scale).toBe("visible_range");
  await page.mouse.move(1, 1);
  await expect(candleLegend).toHaveAttribute("data-mode", "latest");

  await chart.locator("[data-rpw-focus]").click();
  await expect(chart).toHaveClass(/rpw-focus-mode/);
  await expect(page.locator("body")).toHaveClass(/raven-chart-focus/);
  await page.keyboard.press("Escape");
  await expect(chart).not.toHaveClass(/rpw-focus-mode/);
});

test("mobile long hold inspects exact OHLCV and returns to latest on release", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { lane: "perps", instrument: "SOL-PERP", timeframe: "1h" });

  const stage = page.locator("#terminalChart .rpw-stage");
  const legend = page.locator("#terminalChart [data-rpw-crosshair]");
  await expect(stage).toBeVisible();
  await expect(legend).toHaveAttribute("data-mode", "latest");

  const bounds = await stage.boundingBox();
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  const start = {
    x: Math.round(bounds.x + bounds.width * 0.58),
    y: Math.round(bounds.y + bounds.height * 0.5),
  };
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...start, radiusX: 2, radiusY: 2, force: 1 }],
  });
  await page.waitForTimeout(650);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: start.x - 24, y: start.y, radiusX: 2, radiusY: 2, force: 1 }],
  });

  await expect(legend).toHaveAttribute("data-mode", "inspect");
  await expect(legend).toContainText(/Inspect.*UTC.*O.*H.*L.*C.*Change.*Base vol.*Quote vol/s);

  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(legend).toHaveAttribute("data-mode", "latest");
});

test("instrument and timeframe changes repaint the chart and exact context", async ({ page }) => {
  const { calls } = await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { instrument: "SOL-PERP", timeframe: "1h" });
  const initialHash = await chartHash(page);

  await selectUniversalInstrument(page, "BTC-PERP");
  await waitForTerminalLive(page, { instrument: "BTC-PERP", timeframe: "1h" });
  await expect(page.locator("#terminalReadHeadline")).toContainText("BTC-PERP · Pressure reset");
  const instrumentHash = await chartHash(page);
  expect(instrumentHash).not.toBe(initialHash);

  await page.selectOption("#timeframeSelect", "4h");
  await waitForTerminalLive(page, { instrument: "BTC-PERP", timeframe: "4h" });
  const timeframeHash = await chartHash(page);
  expect(timeframeHash).not.toBe(instrumentHash);
  expect(calls.some((call) => call.asset === "BTC-PERP" && call.timeframe === "4h")).toBe(true);
  await expect(page).toHaveURL(/asset=BTC-PERP.*timeframe=4h/);
});

for (const timeframe of ["1m", "1w", "1M"]) {
  test(`${timeframe} Hyperliquid history remains provider-backed and exact`, async ({ page }) => {
    const { calls } = await mockTerminalLiveApis(page);
    await page.goto(`/terminal/?asset=SOL-PERP&timeframe=${timeframe}`);
    await waitForTerminalLive(page, { instrument: "SOL-PERP", timeframe });
    await expect(page.locator("#terminalInstrumentMeta")).toContainText("hyperliquid:perp:SOL");
    await expect(page.locator("#terminalChart canvas").first()).toBeVisible();
    await expect(page.locator("#terminalMarketFreshness")).toContainText(/Live|Fresh/i);
    expect(calls.some((call) => call.asset === "SOL-PERP" && call.timeframe === timeframe)).toBe(true);
  });
}

test("provider failure remains explicit and never creates substitute candles", async ({ page }) => {
  await mockTerminalLiveApis(page, { chartFailure: true });
  await page.goto("/terminal/?asset=SOL-PERP&timeframe=1w");
  await expect.poll(async () => page.evaluate(() => window.__RAVENOS_TERMINAL__?.getState?.().chartState)).toMatch(/error|data_unavailable/);
  await expect(page.locator("#terminalChart canvas")).toHaveCount(0);
  await expect(page.locator("#terminalChart")).toContainText(/Provider error|Data unavailable/i);
  await expect(page.locator("#terminalChartStatus")).toContainText(/provider_unavailable|unavailable/i);
  await expect(page.locator("#terminalMarketFreshness")).not.toHaveText("Live");
});

test("spot search loads only the selected exact pool and does not infer Raven context", async ({ page }) => {
  const { calls } = await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  await openExactSpotSearch(page, "JUP");
  await expect(page.locator("#terminalSpotControl")).toBeHidden();
  await expect(page.locator("#terminalPerpControl")).toBeHidden();
  await waitForTerminalLive(page, { lane: "spot", instrument: "JUP/USDC", timeframe: "1h" });

  await expect(page.locator("#terminalInstrumentScope")).toHaveText("Exact public pool");
  await expect(page.locator("#terminalInstrument")).toHaveText("JUP/USDC");
  await expect(page.locator("#terminalContextSection")).toBeHidden();
  await expect(page.locator("#terminalReadTrigger")).toBeHidden();
  await expect(page.locator("#terminalMetric3Label")).toHaveText("Liquidity");
  await expect(page.locator("#terminalMetric3")).not.toHaveText("--");
  await expect(page.locator("#terminalAnatomy1Label")).toHaveText("Liquidity");
  await expect(page.locator("#terminalAnatomy1")).toContainText("4.2M");
  await expect(page.locator("#terminalAnatomy2")).toContainText("16.5M");
  await expect(page.locator("#terminalAnatomy3")).toContainText("12.4K");
  await expect(page.locator("#terminalAnatomy5Label")).toHaveText("Market cap");
  await expect(page.locator("#terminalAnatomy5")).toContainText("3.1B");
  const anatomyFacts = await Promise.all(
    [1, 2, 3, 4, 5].map((index) => page.locator(`#terminalAnatomy${index}`).textContent()),
  );
  expect(anatomyFacts.join(" ")).not.toMatch(/Unavailable|Not projected/i);
  await expect(page.locator("#terminalAnatomy7")).toHaveText("Review unavailable");
  await expect(page.locator("#terminalFingerprint")).toHaveText("solana:fixture-pair-address:fixture-token-address:fixture-quote-address");
  await page.locator("#terminalSourceDetail > summary").click();
  await expect(page.locator("#terminalSourceProvider")).toHaveText("DexPaprika");
  await expect(page.locator("#terminalSourceInterval")).toContainText("Direct 1h bars");
  await expect(page.locator("#terminalSourceContinuity")).toContainText(/Verified/i);
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_CHART_GEOMETRY__?.marker_count)).toBe(1);
  const spotPriceScale = await page.evaluate(() => window.__RAVENOS_CHART_GEOMETRY__?.price_axis);
  expect(spotPriceScale).toMatchObject({
    side: "right",
    visible: true,
    auto_scale: "visible_range",
    quote_asset: "USDC",
  });
  expect(spotPriceScale.precision).toBeGreaterThanOrEqual(4);
  expect(spotPriceScale.min_move).toBeLessThanOrEqual(0.0001);
  expect(calls.some((call) => call.market === "crypto_spot" && call.pairAddress === "fixture-pair-address")).toBe(true);

  const initialHash = await chartHash(page);
  await page.selectOption("#timeframeSelect", "4h");
  await waitForTerminalLive(page, { lane: "spot", instrument: "JUP/USDC", timeframe: "4h" });
  expect(await chartHash(page)).not.toBe(initialHash);
  expect(calls.some((call) => call.market === "crypto_spot" && call.pairAddress === "fixture-pair-address" && call.timeframe === "4h")).toBe(true);
});

test("a quiet exact pool stays current without presenting an old candle as a site-wide delay", async ({ page }) => {
  await mockTerminalLiveApis(page, { quietSpot: true });
  await page.goto("/terminal/");
  await waitForTerminalLive(page);
  await openExactSpotSearch(page, "JUP");
  await waitForTerminalLive(page, { lane: "spot", instrument: "JUP/USDC", timeframe: "1h" });

  await expect(page.locator("#terminalMarketFreshness")).toHaveText("No recent trades");
  await expect(page.locator("#terminalSourceFreshness")).toContainText("Provider current");
  await expect(page.locator("#terminalSourceFreshness")).toContainText("Delayed candles");
  await expect(page.locator("#terminalSourceFreshness")).toContainText("no recent trades");
  await expect(page.locator("#rosFreshness strong")).toHaveText("No recent trades");
  await expect(page.locator("#terminalBoundary strong")).toHaveText("Market current · no recent trades");
});

test("spot scope controls never cover the OHLCV candle inspector", async ({ page }) => {
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  await openExactSpotSearch(page, "JUP");
  await waitForTerminalLive(page, { lane: "spot", instrument: "JUP/USDC", timeframe: "1h" });

  const scope = page.locator("#terminalChart [data-rpw-scopes]");
  const legend = page.locator("#terminalChart [data-rpw-crosshair]");
  await expect(scope).toBeVisible();
  await expect(legend).toBeVisible();
  expect(boxesOverlap(await scope.boundingBox(), await legend.boundingBox())).toBe(false);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(scope).toBeVisible();
  await expect(legend).toBeVisible();
  expect(boxesOverlap(await scope.boundingBox(), await legend.boundingBox())).toBe(false);
  await expect(legend).toContainText(/Latest.*UTC.*O.*H.*L.*C.*Change.*Base vol.*Quote vol/s);
});

test("universal exact-market search dismisses on Escape and explicit close", async ({ page }) => {
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  await page.locator("#terminalInstrumentTrigger").click();
  const input = page.locator("#rosCommandInput");
  const palette = page.locator("#rosCommandPalette");
  await input.fill("JUP");
  await expect(page.locator(".ros-command-result.instrument").filter({ hasText: "JUP/USDC" })).toBeVisible();
  await input.press("Escape");
  await expect(palette).not.toBeVisible();
  await page.locator("#terminalInstrumentTrigger").click();
  await input.fill("JUP");
  await expect(page.locator(".ros-command-result.instrument").filter({ hasText: "JUP/USDC" })).toBeVisible();
  await page.locator("#rosCommandClose").click();
  await expect(palette).not.toBeVisible();
});

test("live-book market preview stays non-signing even when dormant route-review flags are enabled", async ({ page }) => {
  await mockTerminalLiveApis(page, { flagsEnabled: true });
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  await expect(page.locator("#terminalTradeReviewSection")).toBeVisible();
  await expect(page.locator("#terminalQuoteState")).toHaveText("Current book");
  await expect(page.locator("#terminalQuoteContract")).toHaveText("Live-book market preview");
  await expect(page.locator("#terminalQuoteNote")).toContainText(/Nothing is prepared, signed, or sent/i);
  await expect(page.locator("#terminalPreviewFill")).toContainText("SOL");
  await expect(page.getByRole("button", { name: /sign|submit|execute|buy|sell/i })).toHaveCount(0);
  await expect(page.locator('script[src*="ravenos-terminal-trade"], script[src*="ravenos-access"]')).toHaveCount(0);
});

test("Hyperliquid preview recomputes exact direction, size, and margin without creating an order", async ({ page }) => {
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  await expect(page.locator("#terminalPreviewResult")).toBeVisible();
  await page.locator("#terminalPreviewNotional").fill("900");
  await page.locator("#terminalPreviewShort").click();
  await expect(page.locator("#terminalPreviewShort")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#terminalPreviewAction")).toHaveText("Preview short");
  await expect(page.locator("#terminalPreviewMargin")).toContainText("$300");
  await expect(page.locator("#terminalPreviewMessage")).toContainText(/Account fees and liquidation are not included/i);
  const state = await page.evaluate(() => window.__RAVENOS_TERMINAL__.getState());
  expect(state.marketPreviewAvailable).toBe(true);
  expect(state.marketPreviewState).toBe("market_preview_available");
  expect(state.signingAvailable).toBe(false);
  expect(state.submissionAvailable).toBe(false);
});

test("Terminal ships no seeded market model or synthetic replay client", async ({ page }) => {
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  const source = await page.evaluate(() => fetch("/ravenos-terminal-live.js").then((response) => response.text()));
  expect(source).not.toMatch(/samplePrices|perpsInputVector|replayMatches|pressureComposition|Math\.random|May 2026 compression|Raven Paper Candidates|smart-wallet-distribution/i);
  const text = await visibleBodyText(page);
  expect(text).not.toMatch(/Synthetic fallback|seeded|generated market/i);
  expect(text).not.toMatch(/Demo|sample price|similarity score|pressure engine|paper ready|upgrade to pro|token access/i);
});

test("repeated universal market selection leaves only the final exact instrument visible", async ({ page }) => {
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  const initialCanvasCount = await page.locator("#terminalChart canvas").count();
  await selectUniversalInstrument(page, "BTC-PERP");
  await waitForTerminalLive(page, { instrument: "BTC-PERP" });
  await selectUniversalInstrument(page, "SOL-PERP");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  await selectUniversalInstrument(page, "BTC-PERP");
  await waitForTerminalLive(page, { instrument: "BTC-PERP" });
  await expect(page.locator("#terminalInstrument")).toHaveText("BTC-PERP");
  await expect(page.locator("#terminalReadHeadline")).toContainText("BTC-PERP");
  await expect(page.locator("#terminalChart canvas")).toHaveCount(initialCanvasCount);
});

test("mobile Terminal keeps chart, context, and navigation inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  await expect(page.locator(".ros-mobile-nav")).toBeVisible();
  await expect(page.locator("#terminalChart canvas").first()).toBeVisible();
  await expect(page.locator("#terminalChart .rpw-crosshair > span")).toHaveCount(9);
  const ohlcvLegend = await page.locator("#terminalChart .rpw-crosshair").boundingBox();
  expect(ohlcvLegend?.x).toBeGreaterThanOrEqual(0);
  expect((ohlcvLegend?.x || 0) + (ohlcvLegend?.width || 0)).toBeLessThanOrEqual(390);
  expect(ohlcvLegend?.height).toBeLessThanOrEqual(70);
  const chart = await page.locator("#terminalChart .rpw-stage").boundingBox();
  expect(chart.width).toBeGreaterThan(350);
  expect(chart.height).toBeGreaterThan(280);
  expect(chart.y).toBeLessThan(620);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  await page.locator("#rosContextTrigger").click();
  await expect(page.locator("#rosContextRail")).toContainText("SOL-PERP");
});

test("sparse 15m coverage explains the gap without filling missing history", async ({ page }) => {
  await mockTerminalLiveApis(page, { sparseTimeframe: "15m" });
  await page.goto("/terminal/?asset=SOL-PERP&timeframe=15m");
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_TERMINAL__?.getState?.().candleCount)).toBe(12);
  await expect(page.locator("#terminalChart canvas").first()).toBeVisible();
  await expect(page.locator("[data-rpw-coverage-note]")).toBeVisible();
  await expect(page.locator("[data-rpw-coverage-note]")).toContainText("15m history currently contains 12 real candles");
  await expect(page.locator("[data-rpw-coverage-note]")).toContainText("No missing bars were invented");
});

test("mobile Raven overlay sheet closes after an available overlay is selected", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  await page.evaluate(() => {
    const host = document.createElement("div");
    host.id = "overlaySelectionFixture";
    host.style.height = "520px";
    document.querySelector(".terminal-live").append(host);
    const candles = Array.from({ length: 48 }, (_, index) => ({
      time: 1_784_000_000 + index * 3600,
      open: 100 + index * .1,
      high: 101 + index * .1,
      low: 99 + index * .1,
      close: 100.5 + index * .1,
      volume: 1000 + index,
    }));
    const workspace = window.RavenOSPriceWorkspace.create(host, { timeframe: "1h" });
    workspace.setState({ state: "live", source: "Verified test provider", marketIdentity: "test:exact", timeframe: "1h", candles, returnedBars: candles.length });
    workspace.render({ overlays: [{ type: "pressure-zone", label: "Pressure", start_time: candles[8].time, end_time: candles[20].time, low: 100, high: 104 }] });
    window.__RAVENOS_OVERLAY_SELECTION_TEST__ = workspace;
  });
  const root = page.locator("#overlaySelectionFixture .rpw");
  await root.locator("[data-rpw-overlays]").click();
  await expect(root).toHaveClass(/rpw-overlays-open/);
  await root.locator(".raven-overlay-options button", { hasText: "Pressure" }).click();
  await expect(root).not.toHaveClass(/rpw-overlays-open/);
  await expect(root.locator("[data-rpw-overlays]")).toHaveAttribute("aria-expanded", "false");
});

test("selected context survives navigation to Discover", async ({ page }) => {
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  await selectUniversalInstrument(page, "BTC-PERP");
  await page.selectOption("#timeframeSelect", "4h");
  await waitForTerminalLive(page, { instrument: "BTC-PERP", timeframe: "4h" });
  await page.locator('.ros-workspace-nav a[data-ros-nav="discover"]').click();
  await expect(page).toHaveURL(/\/discover\/.*asset=BTC-PERP.*timeframe=4h/);
  await expect(page.locator("#rosContextSubject")).toHaveText("BTC-PERP");
});

test("primary navigation is coherent across workspace and static support surfaces", async ({ page }) => {
  const expected = ["Discover", "Terminal", "Portfolio", "Atlas"];
  const shellRoutes = ["/discover/", "/terminal/", "/opportunity/", "/replay/", "/outcomes/", "/memory/", "/behavior/", "/research/", "/perps/", "/atlas/", "/account/"];
  await mockTerminalLiveApis(page);

  for (const route of shellRoutes) {
    await page.goto(route);
    const labels = await page.locator(".ros-workspace-nav a > span:last-child").allTextContents();
    expect(labels).toEqual(expected);
  }
  for (const route of ["/docs/", "/faq/"]) {
    await page.goto(route);
    const labels = await page.locator("nav[aria-label='Primary navigation'] a").allTextContents();
    expect(labels).toEqual(expected);
  }
  await page.goto("/");
  await expect(page.locator(".landing-nav")).toHaveText(/Product.*Method.*Docs.*Access/s);
});
