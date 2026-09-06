import { test, expect } from "@playwright/test";
import { mockTerminalLiveApis, openExactSpotSearch, selectUniversalInstrument, waitForTerminalLive } from "./terminal-live-fixtures.mjs";

test("desk keeps the chart central and persists public market and layout preferences", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await mockTerminalLiveApis(page, { spotChartCurrent: true, spotChartPrice: 0.0006438, spotTradePrice: 0.0006438 });
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  await openExactSpotSearch(page, "RUNNER");
  await waitForTerminalLive(page, { lane: "spot", instrument: "RUNNER/WETH" });
  await expect(page.locator(".desk-market-row")).toHaveCount(2);
  await page.getByRole("button", { name: "Pin RUNNER/WETH", exact: true }).click();
  await page.getByLabel("Workspace layout", { exact: true }).selectOption("analysis");
  await page.screenshot({ path: testInfo.outputPath("desk-desktop.png"), fullPage: true });
  expect(await page.locator(".rpw-stage").evaluate(el => el.getBoundingClientRect().top)).toBeLessThan(250);
  await page.locator('[data-terminal-pane-button="holders"]').click();
  await expect(page.locator("#terminalAnatomySection")).toBeVisible();
  await expect(page.locator(".terminal-chart-panel")).toBeVisible();
  const chart = await page.locator(".terminal-chart-panel").boundingBox();
  const holders = await page.locator("#terminalAnatomySection").boundingBox();
  expect(holders.y).toBeGreaterThan(chart.y + chart.height - 1);
  await page.getByRole("separator", { name: "Resize market data panel" }).press("ArrowUp");
  await expect(page.getByRole("separator", { name: "Resize market data panel" })).toHaveAttribute("aria-valuenow", "320");
  await page.reload();
  await waitForTerminalLive(page, { lane: "spot", instrument: "RUNNER/WETH" });
  await expect(page.getByLabel("Workspace layout", { exact: true })).toHaveValue("analysis");
  await expect(page.getByRole("button", { name: "Unpin RUNNER/WETH", exact: true })).toBeVisible();
  await page.locator(".desk-market-open").filter({ hasText: "SOL-PERP" }).click();
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  await expect(page.locator("#deskMarketMessage")).toHaveText("");
  expect(errors).toEqual([]);
});

test("mobile desk keeps the chart first and secondary tools dismissible", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockTerminalLiveApis(page, { spotChartCurrent: true, spotChartPrice: 0.0006438, spotTradePrice: 0.0006438 });
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  await openExactSpotSearch(page, "RUNNER");
  await waitForTerminalLive(page, { lane: "spot", instrument: "RUNNER/WETH" });
  expect(await page.locator(".rpw-stage").evaluate(el => el.getBoundingClientRect().top)).toBeLessThan(360);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const navigation = await page.locator(".terminal-pane-nav").boundingBox();
  expect(navigation.y + navigation.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: testInfo.outputPath("desk-mobile.png"), fullPage: true });
  await page.locator("#deskMarketInfo summary").first().click();
  await expect(page.locator("#terminalMarketEvidence")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#deskMarketInfo")).not.toHaveAttribute("open", "");
  await page.locator("#deskMarketsToggle").click();
  await expect(page.locator("#deskMarkets")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#deskMarkets")).toBeHidden();
});

test("desk handles responsive layouts, focus recovery and blocked browser storage", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException("Storage blocked", "SecurityError"); };
    Storage.prototype.getItem = () => { throw new DOMException("Storage blocked", "SecurityError"); };
  });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  for (const width of [360, 768, 1024, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator("#terminalChart canvas").first()).toBeVisible();
  }
  await page.getByLabel("Workspace layout", { exact: true }).selectOption("focus");
  await expect(page.locator(".terminal-intelligence")).toBeHidden();
  await page.locator('[data-terminal-pane-button="raven"]').click();
  await expect(page.locator(".terminal-intelligence")).toBeVisible();
  await expect(page.getByLabel("Workspace layout", { exact: true })).toHaveValue("balanced");
  expect(errors).toEqual([]);
});


test("a delayed saved-pool lookup cannot replace a newer market selection", async ({ page }) => {
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  await openExactSpotSearch(page, "RUNNER");
  await waitForTerminalLive(page, { instrument: "RUNNER/WETH" });
  await selectUniversalInstrument(page, "SOL-PERP");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  let finishLookup;
  const release = new Promise(resolve => { finishLookup = resolve; });
  let lookupStarted = false;
  await page.route("**/api/dexscreener/pair**", async route => {
    lookupStarted = true;
    await release;
    await route.fallback();
  });
  await page.locator(".desk-market-open").filter({ hasText: "RUNNER/WETH" }).click();
  await expect.poll(() => lookupStarted).toBe(true);
  await selectUniversalInstrument(page, "BTC-PERP");
  await waitForTerminalLive(page, { instrument: "BTC-PERP" });
  finishLookup();
  await expect(page.locator("#deskMarketMessage")).toHaveText("");
  await expect(page.locator("#terminalPickerSymbol")).toHaveText("BTC-PERP");
  await expect(page.locator(".desk-market-row[data-active='true']")).toContainText("BTC-PERP");
});
