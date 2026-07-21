import { test, expect } from "@playwright/test";

async function waitForPerpChart(page) {
  await page.waitForFunction(() => {
    const context = window.__RAVENOS_TERMINAL_LAST_CHART_CONTEXT__;
    const geometry = window.__RAVENOS_CHART_GEOMETRY__;
    return context?.phase === "ready" && context?.asset === "SOL-PERP" && context?.candleCount >= 100 && geometry?.loaded_bars >= 100;
  });
}

function intersects(left, right) {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

async function paintedChartPixels(page) {
  return page.evaluate(() => {
    let coloredPixels = 0;
    for (const canvas of document.querySelectorAll("#flowChart [data-rpw-chart] canvas")) {
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

test("mobile perpetual chart has visible candles and bounded controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/terminal/?asset=SOL-PERP&timeframe=15m");
  await page.selectOption("#timeframeSelect", "15m");
  await waitForPerpChart(page);
  await expect.poll(() => paintedChartPixels(page), { timeout: 5_000 }).toBeGreaterThan(100);

  const result = await page.evaluate(() => {
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom };
    };
    const chart = document.querySelector("#flowChart [data-rpw-chart]");
    const canvases = [...chart.querySelectorAll("canvas")];
    const activity = document.querySelector("#flowChart .rpw-activity > div");
    return {
      viewport: { x: 0, y: 0, width: innerWidth, height: innerHeight },
      stage: box(chart),
      canvas: canvases.length ? box(canvases[0]) : null,
      canvasCount: canvases.length,
      diagnostics: window.__RAVENOS_CHART_GEOMETRY__,
      activityOverflow: activity.scrollWidth - activity.clientWidth,
      indicatorToolbarDisplay: getComputedStyle(document.querySelector("#indicatorToolbar")).display,
      indicatorStateDisplay: getComputedStyle(document.querySelector("#indicatorStateLabel")).display,
      accountLabel: document.querySelector(".mobile-connect-button")?.textContent?.trim(),
      chartBottom: document.querySelector("#flowChart .rpw").getBoundingClientRect().bottom,
      navTop: document.querySelector(".mobile-bottom-nav").getBoundingClientRect().top,
    };
  });

  expect(result.stage.width).toBeGreaterThan(320);
  expect(result.stage.height).toBeGreaterThan(300);
  expect(result.canvasCount).toBeGreaterThan(1);
  expect(intersects(result.canvas, result.viewport)).toBe(true);
  expect(result.diagnostics.loaded_bars).toBeGreaterThanOrEqual(100);
  expect(result.diagnostics.visible_bars).toBeGreaterThan(20);
  expect(result.diagnostics.price_range.max).toBeGreaterThan(result.diagnostics.price_range.min);
  expect(result.activityOverflow).toBeLessThanOrEqual(1);
  expect(result.indicatorToolbarDisplay).toBe("none");
  expect(result.indicatorStateDisplay).toBe("none");
  expect(result.accountLabel).toMatch(/account/i);
  expect(result.navTop).toBeGreaterThanOrEqual(Math.min(result.chartBottom, 780));

  await page.locator("[data-rpw-focus]").click();
  await expect(page.locator("body")).toHaveClass(/raven-chart-focus/);
  await expect.poll(async () => page.locator("#flowChart [data-rpw-chart]").evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(600);
  await page.locator("[data-rpw-overlays]").click();
  await expect(page.locator("#flowChart .raven-overlay-library")).toBeVisible();
  await page.locator("[data-rpw-overlays]").click();
  await page.locator("[data-rpw-focus]").click();
  await expect(page.locator("body")).not.toHaveClass(/raven-chart-focus/);

  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const landscapeStage = await page.locator("#flowChart [data-rpw-chart]").boundingBox();
  const landscapeNav = await page.locator(".mobile-bottom-nav").boundingBox();
  expect(landscapeStage.width).toBeGreaterThan(700);
  expect(landscapeStage.height).toBeGreaterThan(160);
  expect(landscapeStage.x + landscapeStage.width).toBeLessThanOrEqual(844);
  expect(landscapeStage.y + landscapeStage.height).toBeLessThanOrEqual(landscapeNav.y);
  await expect(page.locator(".mobile-trade-actions")).toBeHidden();
  expect(Number(result.diagnostics.loaded_bars)).toBeGreaterThanOrEqual(100);
});

test("dedicated perp mobile panes keep the chart primary and book accessible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/perps/?asset=SOL-PERP&timeframe=15m");
  await expect(page.locator("#perpsChart canvas").first()).toBeVisible();
  await expect(page.locator('[data-perps-mobile-pane="chart"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".perps-market-rail")).toBeHidden();
  await page.locator('[data-perps-mobile-pane="book"]').click();
  await expect(page.locator("#perpsBook")).toBeVisible();
  await expect(page.locator("#perpsChart")).toBeHidden();
  await page.locator('[data-perps-mobile-pane="chart"]').click();
  await expect(page.locator("#perpsChart canvas").first()).toBeVisible();
});
