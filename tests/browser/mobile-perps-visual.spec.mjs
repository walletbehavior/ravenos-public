import { test, expect } from "@playwright/test";
import { mockTerminalLiveApis, waitForTerminalLive } from "./terminal-live-fixtures.mjs";

function intersects(left, right) {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

async function paintedChartPixels(page) {
  return page.evaluate(() => {
    let coloredPixels = 0;
    for (const canvas of document.querySelectorAll("#terminalChart [data-rpw-chart] canvas")) {
      const context = canvas.getContext("2d");
      if (!context || !canvas.width || !canvas.height) continue;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let index = 0; index < pixels.length; index += 64) {
        if (pixels[index + 3] > 0 && (pixels[index] > 15 || pixels[index + 1] > 15 || pixels[index + 2] > 15)) coloredPixels += 1;
      }
    }
    return coloredPixels;
  });
}

test("mobile Terminal chart has visible candles and bounded controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/?asset=SOL-PERP&timeframe=15m");
  await waitForTerminalLive(page, { instrument: "SOL-PERP", timeframe: "15m" });
  await expect.poll(() => paintedChartPixels(page), { timeout: 5_000 }).toBeGreaterThan(100);

  const result = await page.evaluate(() => {
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom };
    };
    const chart = document.querySelector("#terminalChart [data-rpw-chart]");
    const canvases = [...chart.querySelectorAll("canvas")];
    const activity = document.querySelector("#terminalChart .rpw-activity > div");
    return {
      viewport: { x: 0, y: 0, width: innerWidth, height: innerHeight },
      stage: box(chart),
      canvas: canvases.length ? box(canvases[0]) : null,
      canvasCount: canvases.length,
      diagnostics: window.__RAVENOS_CHART_GEOMETRY__,
      activityOverflow: activity.scrollWidth - activity.clientWidth,
      chartBottom: document.querySelector("#terminalChart .rpw").getBoundingClientRect().bottom,
      navTop: document.querySelector(".ros-mobile-nav").getBoundingClientRect().top,
    };
  });

  expect(result.stage.width).toBeGreaterThan(350);
  expect(result.stage.height).toBeGreaterThan(280);
  expect(result.canvasCount).toBeGreaterThan(1);
  expect(intersects(result.canvas, result.viewport)).toBe(true);
  expect(result.diagnostics.loaded_bars).toBeGreaterThanOrEqual(30);
  expect(result.diagnostics.visible_bars).toBeGreaterThan(20);
  expect(result.diagnostics.price_range.max).toBeGreaterThan(result.diagnostics.price_range.min);
  expect(result.diagnostics.price_axis).toMatchObject({
    side: "right",
    visible: true,
    auto_scale: "visible_range",
    quote_asset: "USD",
  });
  expect(result.diagnostics.price_axis.min_move).toBeGreaterThan(0);
  expect(result.activityOverflow).toBeLessThanOrEqual(1);
  expect(result.navTop).toBeGreaterThan(780);

  await page.locator("[data-rpw-focus]").click();
  await expect(page.locator("body")).toHaveClass(/raven-chart-focus/);
  await page.locator("[data-rpw-focus]").click();
  await expect(page.locator("body")).not.toHaveClass(/raven-chart-focus/);

  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const landscapeStage = await page.locator("#terminalChart [data-rpw-chart]").boundingBox();
  expect(landscapeStage.width).toBeGreaterThan(700);
  expect(landscapeStage.height).toBeGreaterThan(160);
  expect(landscapeStage.x + landscapeStage.width).toBeLessThanOrEqual(844);
});

test("dedicated perp mobile panes keep the chart primary and book accessible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/perps/?asset=SOL-PERP&timeframe=15m");
  await expect(page.locator("#perpsChart canvas").first()).toBeVisible();
  await expect(page.locator('[data-perps-mobile-pane="chart"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".perps-market-rail")).toBeHidden();
  await page.locator('[data-perps-mobile-pane="market"]').click();
  await expect(page.locator("#perpsBook")).toBeVisible();
  await expect(page.locator("#perpsChart")).toBeHidden();
  await page.locator('[data-perps-mobile-pane="chart"]').click();
  await expect(page.locator("#perpsChart canvas").first()).toBeVisible();
});
