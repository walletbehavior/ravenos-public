import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";

async function waitForChart(page) {
  await page.waitForFunction(() => {
    const host = document.getElementById("flowChart");
    const ctx = window.__RAVENOS_TERMINAL_LAST_CHART_CONTEXT__;
    return Boolean(host && host.querySelector("canvas") && ctx && ctx.phase === "ready");
  });
}

async function chartHash(page) {
  const png = await page.locator("#flowChart").screenshot();
  return createHash("sha256").update(png).digest("hex");
}

async function lastChartContext(page) {
  return page.evaluate(() => window.__RAVENOS_TERMINAL_LAST_CHART_CONTEXT__);
}

async function waitForQuoteState(page, value) {
  await expect.poll(async () => page.locator("#tradeQuoteState").inputValue()).toBe(value);
}

async function waitForReviewState(page, value) {
  await expect.poll(async () => page.locator("#reviewState").textContent()).toContain(value);
}

async function openQuoteReview(page) {
  const shell = page.locator(".trade-shell");
  await shell.evaluate((el) => {
    el.open = true;
  });
  await expect(page.locator("#getQuoteButton")).toBeVisible();
}

test("default chart loads with stamped build id and visible diagnostics", async ({ page }) => {
  await page.goto("/terminal/");
  await waitForChart(page);

  const context = await lastChartContext(page);
  expect(context.asset).toBe("SOL-PERP");
  expect(context.timeframe).toBe("1h");
  expect(context.candleCount).toBeGreaterThan(0);

  await page.locator("#chartDiagnostics").click();
  await expect(page.locator("#chartDataInfo")).toContainText("Build:");
  await expect(page.locator("#chartDataInfo")).toContainText("Freshness:");

  const buildId = await page.evaluate(() => window.__RAVENOS_BUILD_ID__);
  expect(typeof buildId).toBe("string");
  expect(buildId.length).toBeGreaterThan(6);
  const assetUrls = await page.locator("script[src*='lightweight-charts'], script[src*='raven-chart-overlays'], script[src*='raven-price-chart']").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("src")));
  expect(assetUrls.every((url) => url && url.includes(`v=${buildId}`))).toBe(true);
});

test("hover tooltip stays pinned to the chart upper-left without changing layout", async ({ page }) => {
  await page.goto("/terminal/");
  await waitForChart(page);

  const chartBoxBefore = await page.locator("#flowChart").boundingBox();
  const leftRail = page.locator(".main > .rail");
  const chartPanel = page.locator(".main > .panel.chart-panel");
  const rightRail = page.locator(".main > .panel.intel");
  const evidenceBand = page.locator(".main > .evidence-band");
  const flowTable = page.locator(".main > .panel.table-panel");
  const overlay = page.locator("#flowChart .raven-overlay-region").first();

  await expect(leftRail).toBeVisible();
  await expect(chartPanel).toBeVisible();
  await expect(rightRail).toBeVisible();
  await expect(evidenceBand).toBeVisible();
  await expect(flowTable).toBeVisible();
  expect(chartBoxBefore).not.toBeNull();
  expect(chartBoxBefore.width).toBeGreaterThan(0);
  const chartPanelBox = await chartPanel.boundingBox();
  const rightRailBox = await rightRail.boundingBox();
  const evidenceBandBox = await evidenceBand.boundingBox();
  const flowTableBox = await flowTable.boundingBox();
  expect(chartPanelBox).not.toBeNull();
  expect(rightRailBox).not.toBeNull();
  expect(evidenceBandBox).not.toBeNull();
  expect(flowTableBox).not.toBeNull();
  expect(evidenceBandBox.y).toBeGreaterThan(chartPanelBox.y + chartPanelBox.height - 2);
  expect(evidenceBandBox.x).toBeLessThan(rightRailBox.x);
  expect(evidenceBandBox.width).toBeGreaterThan(rightRailBox.width);
  expect(flowTableBox.y).toBeGreaterThan(evidenceBandBox.y + evidenceBandBox.height - 2);
  expect(flowTableBox.height).toBeGreaterThan(320);
  const viewport = page.viewportSize();
  expect(evidenceBandBox.y).toBeLessThan((viewport?.height || 900) - 80);
  await expect(page.locator(".trade-shell")).not.toHaveAttribute("open", "");
  await expect(overlay).toBeVisible();

  const tooltip = page.locator(".raven-overlay-tooltip");
  const overlayBox = await overlay.boundingBox();
  expect(overlayBox).not.toBeNull();
  await overlay.hover();
  await expect.poll(async () => tooltip.isVisible()).toBe(true);

  const tooltipBox = await tooltip.boundingBox();
  expect(tooltipBox).not.toBeNull();
  expect(tooltipBox.x).toBeGreaterThanOrEqual(chartBoxBefore.x + 6);
  expect(tooltipBox.y).toBeGreaterThanOrEqual(chartBoxBefore.y + 6);
  expect(await tooltip.evaluate((el) => getComputedStyle(el).left)).toBe("8px");
  expect(await tooltip.evaluate((el) => getComputedStyle(el).top)).toBe("8px");
  expect(await tooltip.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");

  const tooltipTextBefore = await tooltip.textContent();
  const nextOverlay = page.locator("#flowChart .raven-overlay-region").nth(1);
  await expect(nextOverlay).toBeVisible();
  await nextOverlay.hover();
  await expect.poll(async () => tooltip.isVisible()).toBe(true);
  const tooltipTextAfter = await tooltip.textContent();
  expect(await tooltip.evaluate((el) => getComputedStyle(el).left)).toBe("8px");
  expect(await tooltip.evaluate((el) => getComputedStyle(el).top)).toBe("8px");
  expect(tooltipTextAfter).not.toEqual(tooltipTextBefore);
});

test("changing SOL-PERP 1h to BTC-PERP 1h changes the rendered chart", async ({ page }) => {
  await page.goto("/terminal/");
  await waitForChart(page);
  const before = await chartHash(page);

  await page.selectOption("#assetSelect", "BTC-PERP");
  await waitForChart(page);
  const after = await chartHash(page);

  expect(after).not.toBe(before);
  const context = await lastChartContext(page);
  expect(context.asset).toBe("BTC-PERP");
  expect(context.timeframe).toBe("1h");
});

test("changing SOL-PERP 1h to SOL-PERP 4h changes candle structure", async ({ page }) => {
  await page.goto("/terminal/");
  await waitForChart(page);
  const before = await lastChartContext(page);

  await page.selectOption("#timeframeSelect", "4h");
  await waitForChart(page);
  const after = await lastChartContext(page);

  expect(before.asset).toBe("SOL-PERP");
  expect(after.asset).toBe("SOL-PERP");
  expect(after.candleCount).toBeLessThan(before.candleCount);
  expect(after.timeframe).toBe("4h");
});

test("rapid switching leaves the final selection visible", async ({ page }) => {
  await page.route("**/api/terminal/chart**", async (route) => {
    const url = new URL(route.request().url());
    const asset = url.searchParams.get("asset");
    const timeframe = url.searchParams.get("timeframe");
    const delay = asset === "BTC-PERP" ? 500 : asset === "OP-PERP" ? 250 : 25;
    await new Promise((resolve) => setTimeout(resolve, delay));
    await route.continue();
    if (timeframe === "4h") return;
  });

  await page.goto("/terminal/");
  await waitForChart(page);

  await page.selectOption("#assetSelect", "BTC-PERP");
  await page.selectOption("#assetSelect", "OP-PERP");
  await page.selectOption("#assetSelect", "SOL-PERP");
  await page.selectOption("#timeframeSelect", "4h");

  await page.waitForFunction(() => {
    const ctx = window.__RAVENOS_TERMINAL_LAST_CHART_CONTEXT__;
    return ctx?.phase === "ready" && ctx?.asset === "SOL-PERP" && ctx?.timeframe === "4h";
  });

  const context = await lastChartContext(page);
  expect(context.asset).toBe("SOL-PERP");
  expect(context.timeframe).toBe("4h");
});

test("stale and recovering responses are labeled explicitly", async ({ page }) => {
  await page.route("**/api/terminal/chart**", async (route) => {
    const url = new URL(route.request().url());
    const timeframe = url.searchParams.get("timeframe") || "1h";
    const stale = url.searchParams.get("asset") === "SOL-PERP";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        asset: url.searchParams.get("asset"),
        source: "Hyperliquid",
        source_type: "provider",
        source_label: stale ? "Live perps market price" : "Recovering perps market price",
        coverage: "Live",
        freshness_state: stale ? "stale" : "recovering",
        observed_at: stale ? "2026-06-24T19:00:00Z" : "2026-06-24T20:00:00Z",
        age_seconds: stale ? 4200 : 180,
        timeframe,
        candles: [
          { time: 1719259200, open: 100, high: 101, low: 99, close: 100.5, volume: 10 },
          { time: 1719262800, open: 100.5, high: 102, low: 100, close: 101.5, volume: 11 },
        ],
      }),
    });
  });

  await page.goto("/terminal/");
  await waitForChart(page);
  await expect(page.locator("#chartFreshnessPill")).toContainText("Stale");

  await page.selectOption("#assetSelect", "BTC-PERP");
  await waitForChart(page);
  await expect(page.locator("#chartFreshnessPill")).toContainText("Recovering");
});

test("unavailable provider does not display old data as live", async ({ page }) => {
  await page.route("**/api/terminal/chart**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        asset: url.searchParams.get("asset"),
        source: "Coverage Developing",
        source_type: "unavailable",
        source_label: "Coverage Developing",
        coverage: "Coverage Developing",
        freshness_state: "unavailable",
        message: "Current chart coverage is unavailable.",
        candles: [],
      }),
    });
  });

  await page.goto("/terminal/");
  await expect(page.locator("#chartFreshnessPill")).toContainText("Unavailable");
  await expect(page.locator("#flowChart")).toContainText("Current chart coverage is unavailable.");
  await expect(page.locator("#marketFeedState")).not.toContainText("Live Market Data");
});

test("repeated selection changes do not leave duplicate chart canvases", async ({ page }) => {
  await page.goto("/terminal/");
  await waitForChart(page);
  const initialCanvasCount = await page.locator("#flowChart canvas").count();

  for (const asset of ["BTC-PERP", "OP-PERP", "SOL-PERP", "BTC-PERP", "SOL-PERP"]) {
    await page.selectOption("#assetSelect", asset);
    await waitForChart(page);
    await expect
      .poll(async () => (await lastChartContext(page))?.asset)
      .toBe(asset);
  }

  const canvasCount = await page.locator("#flowChart canvas").count();
  expect(initialCanvasCount).toBeGreaterThan(0);
  expect(canvasCount).toBe(initialCanvasCount);
});

test("quote-only review works end to end without a wallet", async ({ page }) => {
  await page.goto("/terminal/");
  await waitForChart(page);
  await openQuoteReview(page);

  await page.click("#getQuoteButton");
  await waitForQuoteState(page, "Ready");
  await expect(page.locator("#quoteExpectedOutput")).toContainText("USDC");

  await page.click("#inspectRouteButton");
  await expect.poll(async () => page.locator("#inspectionState").textContent()).toContain("Ready");
  await expect(page.locator("#inspectionSummary")).toContainText("matches the reviewed quote");

  await page.click("#createReviewButton");
  await waitForReviewState(page, "ready");
  await expect(page.locator("#reviewEvidenceId")).toContainText("review_");

  await page.click("#viewEvidenceButton");
  await expect(page.locator("#reviewProofBox")).toContainText("\"evidence_id\"");
  await expect(page.locator("#reviewProofBox")).toContainText("\"quote_only\": true");
  await expect(page.locator("body")).toContainText("Signing disabled");
});

test("read-only Phantom capability flow never reaches signing methods", async ({ page }) => {
  await page.addInitScript(() => {
    window.__walletSignAttempts = 0;
    const listeners = new Map();
    const provider = {
      isPhantom: true,
      supportedTransactionVersions: new Set([0]),
      connect: async () => ({ publicKey: { toBase58: () => "4Nd1mY7drQZK4v5Q9vU5rPXN9kJ1s6H9mN3aU4mY9QpZ" } }),
      disconnect: async () => {},
      on(event, handler) {
        listeners.set(event, handler);
      },
      off(event) {
        listeners.delete(event);
      },
      signTransaction() {
        window.__walletSignAttempts += 1;
        throw new Error("signing_should_not_be_called");
      },
      signAndSendTransaction() {
        window.__walletSignAttempts += 1;
        throw new Error("submission_should_not_be_called");
      },
      signAllTransactions() {
        window.__walletSignAttempts += 1;
        throw new Error("signing_should_not_be_called");
      },
    };
    window.phantom = { solana: provider };
  });

  await page.goto("/terminal/");
  await waitForChart(page);
  await openQuoteReview(page);

  await page.click("#detectWalletButton");
  await expect(page.locator("#walletConnectionState")).toContainText("Wallet detected");

  await page.click("#connectPhantomButton");
  await expect(page.locator("#walletConnectionState")).toContainText("Connected for read-only review");
  await expect(page.locator("#walletPublicAddress")).toContainText("4Nd1...");

  await page.click("#getQuoteButton");
  await waitForQuoteState(page, "Ready");
  await page.click("#inspectRouteButton");
  await expect.poll(async () => page.locator("#inspectionState").textContent()).toContain("Ready");
  await page.click("#createReviewButton");
  await waitForReviewState(page, "ready");
  await page.click("#viewEvidenceButton");
  await expect(page.locator("#reviewProofBox")).not.toContainText("4Nd1mY7drQZK4v5Q9vU5rPXN9kJ1s6H9mN3aU4mY9QpZ");

  const signAttempts = await page.evaluate(() => window.__walletSignAttempts);
  expect(signAttempts).toBe(0);
});

test("read-only Solflare capability flow is wallet-optional and signing-free", async ({ page }) => {
  await page.addInitScript(() => {
    window.__walletSignAttempts = 0;
    const provider = {
      isSolflare: true,
      supportedTransactionVersions: new Set([0]),
      connect: async () => ({ publicKey: { toBase58: () => "8M7qQ6kYtD1Rr1hXw8y4kB8wM9n7m2K6Yp4tR5uV7wX2" } }),
      disconnect: async () => {},
      on() {},
      off() {},
      signTransaction() {
        window.__walletSignAttempts += 1;
        throw new Error("signing_should_not_be_called");
      },
      signAndSendTransaction() {
        window.__walletSignAttempts += 1;
        throw new Error("submission_should_not_be_called");
      },
    };
    window.solflare = provider;
  });

  await page.goto("/terminal/");
  await waitForChart(page);
  await openQuoteReview(page);
  await page.click("#detectWalletButton");
  await page.click("#connectSolflareButton");

  await expect(page.locator("#walletConnectionState")).toContainText("Connected for read-only review");
  await expect(page.locator("#walletReviewFamily")).toContainText("solflare");
  await expect(page.locator("#walletPublicAddress")).toContainText("8M7q...");

  const signAttempts = await page.evaluate(() => window.__walletSignAttempts);
  expect(signAttempts).toBe(0);
});
