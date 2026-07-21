import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";

import { mockTerminalLiveApis, waitForTerminalLive } from "./terminal-live-fixtures.mjs";

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
  await expect(page.locator("#terminalEvidenceState")).toContainText(/Fresh/i);
  await expect(page.locator(".ros-capability-status")).toContainText("Sign off");
  await expect(page.locator("#assetSelect option")).toHaveCount(2);
  await expect(page.locator("#terminalModeSelect option")).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_CHART_GEOMETRY__?.marker_count)).toBe(1);

  const state = await page.evaluate(() => window.__RAVENOS_TERMINAL__.getState());
  expect(state.instrumentId).toContain("hyperliquid");
  expect(state.candleCount).toBeGreaterThan(20);
  expect(state.signingAvailable).toBe(false);
  expect(state.submissionAvailable).toBe(false);
});

test("instrument and timeframe changes repaint the chart and exact context", async ({ page }) => {
  const { calls } = await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { instrument: "SOL-PERP", timeframe: "1h" });
  const initialHash = await chartHash(page);

  await page.selectOption("#assetSelect", "BTC-PERP");
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

for (const timeframe of ["1w", "1m"]) {
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
  await page.selectOption("#terminalModeSelect", "spot");
  await expect(page.locator("#terminalSpotControl")).toBeVisible();
  await expect(page.locator("#terminalPerpControl")).toBeHidden();
  await page.locator("#terminalSpotSearch").fill("JUP");
  await expect(page.locator(".terminal-search-result")).toHaveCount(1);
  await page.locator(".terminal-search-result").click();
  await waitForTerminalLive(page, { lane: "spot", instrument: "JUP/USDC", timeframe: "1h" });

  await expect(page.locator("#terminalInstrumentScope")).toHaveText("Exact public pool");
  await expect(page.locator("#terminalInstrument")).toHaveText("JUP/USDC");
  await expect(page.locator("#terminalReadHeadline")).toContainText("Raven context unavailable");
  await expect(page.locator("#terminalWhy")).toContainText(/not substituted/i);
  await expect(page.locator("#terminalMetric3Label")).toHaveText("Liquidity");
  await expect(page.locator("#terminalMetric3")).not.toHaveText("--");
  expect(calls.some((call) => call.market === "crypto_spot" && call.pairAddress === "fixture-pair-address")).toBe(true);

  const initialHash = await chartHash(page);
  await page.selectOption("#timeframeSelect", "4h");
  await waitForTerminalLive(page, { lane: "spot", instrument: "JUP/USDC", timeframe: "4h" });
  expect(await chartHash(page)).not.toBe(initialHash);
  expect(calls.some((call) => call.market === "crypto_spot" && call.pairAddress === "fixture-pair-address" && call.timeframe === "4h")).toBe(true);
});

test("exact-pool search dismisses on Escape and outside interaction", async ({ page }) => {
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  await page.selectOption("#terminalModeSelect", "spot");
  const input = page.locator("#terminalSpotSearch");
  const results = page.locator("#terminalSpotResults");
  await input.fill("JUP");
  await expect(results).toBeVisible();
  await input.press("Escape");
  await expect(results).toBeHidden();
  await input.fill("JUP ");
  await expect(results).toBeVisible();
  await page.locator(".terminal-title").click();
  await expect(results).toBeHidden();
});

test("quote-preview capability stays non-signing even when the review flags are enabled", async ({ page }) => {
  await mockTerminalLiveApis(page, { flagsEnabled: true });
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  await expect(page.locator("#terminalQuoteState")).toHaveText("Preview contract enabled");
  await expect(page.locator("#terminalQuoteContract")).toHaveText("Read-only review only");
  await expect(page.locator("#terminalQuoteNote")).toContainText(/Signing and submission remain unavailable/i);
  await expect(page.getByRole("button", { name: /sign|submit|execute|buy|sell|long|short/i })).toHaveCount(0);
  await expect(page.locator('script[src*="ravenos-terminal-trade"], script[src*="ravenos-access"]')).toHaveCount(0);
});

test("Terminal ships no seeded market model or synthetic replay client", async ({ page }) => {
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  const source = await page.evaluate(() => fetch("/ravenos-terminal-live.js").then((response) => response.text()));
  expect(source).not.toMatch(/samplePrices|perpsInputVector|replayMatches|pressureComposition|Math\.random|May 2026 compression|Raven Paper Candidates|smart-wallet-distribution/i);
  const text = await visibleBodyText(page);
  expect(text).toMatch(/Synthetic fallback None/i);
  expect(text).not.toMatch(/Demo|sample price|similarity score|pressure engine|paper ready|upgrade to pro|token access/i);
});

test("rapid market switching leaves only the final exact selection visible", async ({ page }) => {
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  const initialCanvasCount = await page.locator("#terminalChart canvas").count();
  await page.selectOption("#assetSelect", "BTC-PERP");
  await page.selectOption("#assetSelect", "SOL-PERP");
  await page.selectOption("#assetSelect", "BTC-PERP");
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
  const chart = await page.locator("#terminalChart .rpw-stage").boundingBox();
  expect(chart.width).toBeGreaterThan(350);
  expect(chart.height).toBeGreaterThan(280);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  await page.locator("#rosContextTrigger").click();
  await expect(page.locator("#rosContextRail")).toContainText("SOL-PERP");
});

test("selected context survives navigation to Opportunities", async ({ page }) => {
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  await page.selectOption("#assetSelect", "BTC-PERP");
  await page.selectOption("#timeframeSelect", "4h");
  await waitForTerminalLive(page, { instrument: "BTC-PERP", timeframe: "4h" });
  await page.locator('.ros-left-nav a[href^="/opportunity/"]').click();
  await expect(page).toHaveURL(/\/opportunity\/.*asset=BTC-PERP.*timeframe=4h/);
  await expect(page.locator("#rosContextSubject")).toHaveText("BTC-PERP");
});

test("primary navigation is coherent across workspace and static support surfaces", async ({ page }) => {
  const shellExpected = ["Brief", "Opportunities", "Perps", "Terminal", "Behavior", "Outcomes", "Replay", "Markets", "Research"];
  const reportExpected = ["Brief", "Opportunity", "Terminal", "Atlas", "Replay", "Outcomes", "Memory", "Behavior", "Research", "Perps", "Docs", "FAQ", "Account"];
  const routes = ["/", "/terminal/", "/opportunity/", "/replay/", "/outcomes/", "/memory/", "/behavior/", "/research/", "/perps/", "/atlas/", "/docs/", "/faq/", "/account/"];
  const shellRoutes = new Set(["/", "/terminal/", "/opportunity/", "/replay/", "/outcomes/", "/memory/", "/behavior/", "/research/", "/perps/", "/account/"]);
  await mockTerminalLiveApis(page);

  for (const route of routes) {
    await page.goto(route);
    const selector = shellRoutes.has(route) ? ".ros-left-nav a" : "nav[aria-label='Primary navigation'] a";
    const labels = await page.locator(selector).evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()).filter(Boolean));
    expect(labels).toEqual(shellRoutes.has(route) ? shellExpected : reportExpected);
  }
});
