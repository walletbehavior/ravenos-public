import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";

async function waitForChart(page) {
  await page.waitForFunction(() => {
    const host = document.getElementById("flowChart");
    const ctx = window.__RAVENOS_TERMINAL_LAST_CHART_CONTEXT__;
    return Boolean(host && host.querySelector("canvas") && ctx && ctx.phase === "ready");
  });
}

async function waitForChartContext(page, expected = {}) {
  await page.waitForFunction((wanted) => {
    const host = document.getElementById("flowChart");
    const ctx = window.__RAVENOS_TERMINAL_LAST_CHART_CONTEXT__;
    if (!host || !ctx || ctx.phase !== "ready") return false;
    if (wanted.requireCanvas === true && !host.querySelector("canvas")) return false;
    if (wanted.asset && ctx.asset !== wanted.asset) return false;
    if (wanted.timeframe && ctx.timeframe !== wanted.timeframe) return false;
    return true;
  }, expected);
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
  await expect.poll(async () => {
    const text = (await page.locator("#reviewState").textContent()) || "";
    if (value === "ready") return /ready|blocked/i.test(text);
    return text.includes(value);
  }).toBe(true);
}

async function openQuoteReview(page) {
  const shell = page.locator(".trade-shell");
  await shell.evaluate((el) => {
    el.open = true;
  });
  await expect(page.locator("#getQuoteButton")).toBeVisible();
}

async function visibleBodyText(page) {
  return page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const chunks = [];
    let node = walker.nextNode();
    while (node) {
      const parent = node.parentElement;
      const text = node.nodeValue.trim();
      if (parent && text) {
        const closedDetails = parent.closest("details:not([open])");
        if (closedDetails && !parent.closest("summary")) {
          node = walker.nextNode();
          continue;
        }
        const style = getComputedStyle(parent);
        const box = parent.getBoundingClientRect();
        const visible = style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && box.width > 0 && box.height > 0;
        if (visible) chunks.push(text);
      }
      node = walker.nextNode();
    }
    return chunks.join(" ");
  });
}

async function mockHyperliquidPerps(page, row = {}) {
  await page.route("**/api/hyperliquid/perps", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        provider: "Hyperliquid",
        coverage: "Live",
        isLive: true,
        lastUpdated: new Date().toISOString(),
        count: 1,
        results: [{
          asset: "SOL-PERP",
          symbol: "SOL",
          provider: "Hyperliquid",
          coverage: "Live",
          isLive: true,
          lastUpdated: new Date().toISOString(),
          pressureScore: 82,
          pressureState: "Crowded",
          pressureContext: "Funding elevated",
          funding: -0.000012,
          openInterest: 1280000,
          oiScore: 72,
          markPx: 150.22,
          oraclePx: 150.18,
          premium: 0.0002,
          basis: 0.0002,
          volumeScore: 64,
          ...row,
        }],
      }),
    });
  });
}

async function mockRavenReadEvidence(page) {
  const now = new Date().toISOString();
  const artifacts = {
    "/ravenos/behavior.json": {
      safe_public: true,
      generated_at: now,
      freshness_state: "fresh",
      segments: [
        {
          label: "Participation fixture",
          sample_count: 96,
          observed: 96,
          usable: 64,
          settled: 20,
          trend: "broadening",
          derived_state: "quality improving",
          avg_outcome: "mixed",
          participant_success_rate: 0.58,
        },
      ],
    },
    "/ravenos/replay.json": {
      safe_public: true,
      generated_at: now,
      freshness_state: "fresh",
      comparable_contexts: [
        {
          id: "replay-fixture-1",
          similarity_score: 0.91,
          after_window_summary: "mixed",
          sample_count: 18,
          window: "24h",
        },
      ],
    },
    "/ravenos/memory.json": { safe_public: true, generated_at: now, freshness_state: "fresh" },
    "/ravenos/outcomes.json": { safe_public: true, generated_at: now, freshness_state: "fresh" },
    "/ravenos/research.json": {
      safe_public: true,
      generated_at: now,
      freshness_state: "fresh",
      data: {
        rows: [{
          status: "Observed Strength",
          confidence: "Medium",
          structure: "Solana Participant Cohorts",
          finding: "Aggregate participation remains visible.",
          sample_depth: 96,
        }],
      },
    },
    "/ravenos/status.json": {
      safe_public: true,
      generated_at: now,
      freshness_state: "degraded",
      stale_endpoints: ["replay"],
      validation_failures: [],
    },
    "/ravenos/terminal_health.json": {
      safe_public: true,
      generated_at: now,
      components: {
        base_rpc: {
          state: "recovering",
          observed_at: now,
          observation_age_seconds: 120,
          may_block_quote_review: false,
          degraded_reason: "recovery_epoch",
        },
      },
    },
  };
  await page.route("**/ravenos/*.json", async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(artifacts[path] || { safe_public: true, generated_at: now }),
    });
  });
}

function providerCandles(asset, timeframe) {
  const timeframeSpec = {
    "5m": { step: 5 * 60, count: 72, volatility: 0.005 },
    "15m": { step: 15 * 60, count: 60, volatility: 0.007 },
    "1h": { step: 60 * 60, count: 48, volatility: 0.009 },
    "4h": { step: 4 * 60 * 60, count: 36, volatility: 0.018 },
    "1d": { step: 24 * 60 * 60, count: 34, volatility: 0.026 },
    "1w": { step: 7 * 24 * 60 * 60, count: 30, volatility: 0.038 },
    "1m": { step: 30 * 24 * 60 * 60, count: 24, volatility: 0.055 },
  }[timeframe] || { step: 60 * 60, count: 48, volatility: 0.009 };
  const { step, count, volatility } = timeframeSpec;
  const seed = Array.from(`${asset}:${timeframe}`).reduce((sum, char) => sum + char.charCodeAt(0), 31);
  const end = 1_800_000_000;
  let close = asset.includes("BTC") ? 67500 : asset.includes("SOL") ? 148 : 2400;
  return Array.from({ length: count }, (_, index) => {
    const open = close;
    const wave = Math.sin(index * (timeframe === "4h" || timeframe === "1w" || timeframe === "1m" ? 0.53 : 0.31) + seed * 0.01) * volatility;
    const drift = (index - count / 2) * (timeframe === "1w" || timeframe === "1m" ? 0.00042 : timeframe === "4h" ? 0.00022 : 0.00008);
    close = Math.max(0.1, open * (1 + wave + drift));
    return {
      time: end - (count - 1 - index) * step,
      open: Number(open.toFixed(4)),
      high: Number((Math.max(open, close) * 1.006).toFixed(4)),
      low: Number((Math.min(open, close) * 0.994).toFixed(4)),
      close: Number(close.toFixed(4)),
      volume: Math.round(1000000 + seed * 1000 + index * 25000),
    };
  });
}

async function enableLightweightChartSpike(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("RAVENOS_LIGHTWEIGHT_CHART_SPIKE", "1");
  });
}

async function mockTerminalChartApi(page) {
  const calls = [];
  await page.route("**/api/terminal/chart**", async (route) => {
    const url = new URL(route.request().url());
    const asset = url.searchParams.get("asset") || "SOL-PERP";
    const timeframe = url.searchParams.get("timeframe") || "1h";
    calls.push({ asset, timeframe, market: url.searchParams.get("market") || "" });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        asset,
        source: asset.endsWith("-PERP") ? "Hyperliquid" : "Yahoo Finance",
        source_label: asset.endsWith("-PERP") ? "Live perps market price" : "Live spot proxy price",
        coverage: "Live",
        freshness_state: "fresh",
        timeframe,
        observed_at: "2026-06-29T00:00:00.000Z",
        candles: providerCandles(asset, timeframe),
      }),
    });
  });
  return calls;
}

async function selectAssetFromAnyGroup(page, asset) {
  const hasAsset = async () => page.locator("#assetSelect option").evaluateAll((nodes, wanted) => nodes.some((node) => node.value === wanted), asset);
  if (!(await hasAsset())) {
    const groups = await page.locator("#marketNav button").evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()));
    for (const group of groups) {
      await page.locator("#marketNav button", { hasText: group }).click();
      if (await hasAsset()) break;
    }
  }
  await page.selectOption("#assetSelect", asset);
  await waitForChartContext(page, { asset });
}

test("default chart loads with stamped build id and visible diagnostics", async ({ page }) => {
  await page.goto("/terminal/");
  await waitForChart(page);

  const context = await lastChartContext(page);
  expect(context.asset).toBe("SOL-PERP");
  expect(context.timeframe).toBe("1h");
  expect(context.candleCount).toBeGreaterThan(0);
  expect(context.formattedLastPrice).toMatch(/^\$\d+(?:\.\d{2,4})?$/);

  const buildId = await page.evaluate(() => window.__RAVENOS_BUILD_ID__);
  expect(typeof buildId).toBe("string");
  expect(buildId.length).toBeGreaterThan(6);
  const assetUrls = await page.locator("script[src*='lightweight-charts'], script[src*='raven-chart-overlays'], script[src*='raven-price-chart']").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("src")));
  expect(assetUrls.every((url) => url && url.includes(`v=${buildId}`))).toBe(true);
});

test("provider failure is explicit and never replaced with a local chart", async ({ page }) => {
  let chartApiCalls = 0;
  await page.route("**/api/terminal/chart**", async (route) => {
    chartApiCalls += 1;
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false }) });
  });

  await page.goto("/terminal/");
  await expect(page.locator("#flowChart .rpw")).toHaveAttribute("data-price-workspace-state", "error");

  const context = await lastChartContext(page);
  expect(chartApiCalls).toBeGreaterThan(0);
  expect(context.chartDataSource).toBe("data_unavailable");
  expect(context.fallbackReason).toBeTruthy();
  await expect(page.locator("#flowChart canvas")).toHaveCount(0);
  await expect(page.locator("#coverageBadge")).not.toContainText(/Live/i);
});

test("terminal timeframe selector includes weekly and monthly structure context", async ({ page }) => {
  await page.goto("/terminal/");
  await waitForChart(page);
  const options = await page.locator("#timeframeSelect option").evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()));
  expect(options).toEqual(["5m", "15m", "1h", "4h", "1d", "1w", "1m"]);
});

test("Lightweight Charts spike uses terminal chart API for SOL and BTC perps", async ({ page }) => {
  await enableLightweightChartSpike(page);
  const apiCalls = await mockTerminalChartApi(page);

  await page.goto("/terminal/");
  await waitForChartContext(page, { asset: "SOL-PERP", timeframe: "1h" });
  const sol1h = await lastChartContext(page);
  const sol1hHash = await chartHash(page);
  expect(sol1h.chartDataSource).toBe("terminal_chart_api");
  expect(sol1h.sourceLabel).toBe("Live perps market price");
  expect(sol1h.candleCount).toBeGreaterThan(20);

  await page.selectOption("#timeframeSelect", "4h");
  await waitForChartContext(page, { asset: "SOL-PERP", timeframe: "4h" });
  const sol4h = await lastChartContext(page);
  const sol4hHash = await chartHash(page);
  expect(sol4h.chartDataSource).toBe("terminal_chart_api");
  expect(sol4h.chartSignature).not.toBe(sol1h.chartSignature);
  expect(sol4hHash).not.toBe(sol1hHash);

  await page.selectOption("#assetSelect", "BTC-PERP");
  await waitForChartContext(page, { asset: "BTC-PERP", timeframe: "4h" });
  const btc = await lastChartContext(page);
  expect(btc.chartDataSource).toBe("terminal_chart_api");
  expect(btc.providerAsset).toBe("BTC-PERP");
  expect(apiCalls.some((call) => call.asset === "SOL-PERP" && call.timeframe === "1h")).toBe(true);
  expect(apiCalls.some((call) => call.asset === "SOL-PERP" && call.timeframe === "4h")).toBe(true);
  expect(apiCalls.some((call) => call.asset === "BTC-PERP")).toBe(true);
});

test("Lightweight Charts spike handles weekly and monthly perps timeframes", async ({ page }) => {
  await enableLightweightChartSpike(page);
  const apiCalls = await mockTerminalChartApi(page);

  await page.goto("/terminal/");
  await waitForChartContext(page, { asset: "SOL-PERP", timeframe: "1h" });
  const oneHour = await lastChartContext(page);
  const initialCanvasCount = await page.locator("#flowChart canvas").count();

  await page.selectOption("#timeframeSelect", "1w");
  await waitForChartContext(page, { asset: "SOL-PERP", timeframe: "1w" });
  const weekly = await lastChartContext(page);
  const weeklyHash = await chartHash(page);
  expect(weekly.chartDataSource).toBe("terminal_chart_api");
  expect(weekly.candleCount).toBeGreaterThan(10);
  expect(weekly.chartSignature).not.toBe(oneHour.chartSignature);
  expect(apiCalls.some((call) => call.asset === "SOL-PERP" && call.timeframe === "1w")).toBe(true);

  await page.selectOption("#timeframeSelect", "1m");
  await waitForChartContext(page, { asset: "SOL-PERP", timeframe: "1m" });
  const monthly = await lastChartContext(page);
  const monthlyHash = await chartHash(page);
  expect(monthly.chartDataSource).toBe("terminal_chart_api");
  expect(monthly.candleCount).toBeGreaterThan(10);
  expect(monthly.chartSignature).not.toBe(weekly.chartSignature);
  expect(monthlyHash).not.toBe(weeklyHash);
  expect(apiCalls.some((call) => call.asset === "SOL-PERP" && call.timeframe === "1m")).toBe(true);
  expect(await page.locator("#flowChart canvas").count()).toBe(initialCanvasCount);

  await page.selectOption("#assetSelect", "BTC-PERP");
  await waitForChartContext(page, { asset: "BTC-PERP", timeframe: "1m" });
  const btcMonthly = await lastChartContext(page);
  expect(btcMonthly.chartDataSource).toBe("terminal_chart_api");
  expect(apiCalls.some((call) => call.asset === "BTC-PERP" && call.timeframe === "1m")).toBe(true);
});

test("weekly and monthly provider failures remain unavailable without generated candles", async ({ page }) => {
  let chartApiCalls = 0;
  await page.route("**/api/terminal/chart**", async (route) => {
    chartApiCalls += 1;
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false }) });
  });

  await page.goto("/terminal/");
  await expect(page.locator("#flowChart .rpw")).toHaveAttribute("data-price-workspace-state", "error");

  await page.selectOption("#timeframeSelect", "1w");
  await page.waitForFunction(() => window.__RAVENOS_TERMINAL_LAST_CHART_CONTEXT__?.timeframe === "1w");
  const weekly = await lastChartContext(page);
  expect(weekly.chartDataSource).toBe("data_unavailable");

  await page.selectOption("#timeframeSelect", "1m");
  await page.waitForFunction(() => window.__RAVENOS_TERMINAL_LAST_CHART_CONTEXT__?.timeframe === "1m");
  const monthly = await lastChartContext(page);
  expect(monthly.chartDataSource).toBe("data_unavailable");
  await expect(page.locator("#flowChart canvas")).toHaveCount(0);
  expect(chartApiCalls).toBeGreaterThanOrEqual(3);
});

test("Lightweight Charts spike maps supported spot assets to the chart API", async ({ page }) => {
  await enableLightweightChartSpike(page);
  const apiCalls = await mockTerminalChartApi(page);

  await page.goto("/terminal/");
  await waitForChart(page);
  await page.locator("#marketNav button", { hasText: "Large Caps" }).click();
  await page.selectOption("#assetSelect", "BTC");
  await waitForChartContext(page, { asset: "BTC", timeframe: "1h" });

  const context = await lastChartContext(page);
  expect(context.chartDataSource).toBe("terminal_chart_api");
  expect(context.providerAsset).toBe("BTC Spot");
  await expect(page.locator("#coverageBadge")).toContainText("Live");
  await expect(page.locator("#providerSource")).toContainText("Live spot proxy price");
  await expect(page.locator("#chartSubtitle")).not.toContainText("local structure fallback");
  expect(apiCalls.some((call) => call.asset === "BTC Spot" && call.market === "crypto_spot")).toBe(true);
});

test("unsupported spot coverage is explicit and never fabricates candles", async ({ page }) => {
  await enableLightweightChartSpike(page);
  await page.route("**/api/terminal/chart**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("asset") === "JUP") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          asset: "JUP",
          source: "Structure Proxy",
          source_label: "Coverage Developing",
          coverage: "Coverage Developing",
          freshness_state: "degraded",
          message: "JUP does not yet have a reliable public candle feed in Terminal.",
          candles: [],
        }),
      });
      return;
    }
    const asset = url.searchParams.get("asset") || "SOL-PERP";
    const timeframe = url.searchParams.get("timeframe") || "1h";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        asset,
        source: asset.endsWith("-PERP") ? "Hyperliquid" : "Yahoo Finance",
        source_label: asset.endsWith("-PERP") ? "Live perps market price" : "Live spot proxy price",
        coverage: "Live",
        freshness_state: "fresh",
        timeframe,
        observed_at: "2026-06-29T00:00:00.000Z",
        candles: providerCandles(asset, timeframe),
      }),
    });
  });

  await page.goto("/terminal/");
  await waitForChart(page);
  await page.locator("#marketNav button", { hasText: "Mid Caps" }).click();
  await page.selectOption("#assetSelect", "JUP");
  await page.waitForFunction(() => window.__RAVENOS_TERMINAL_LAST_CHART_CONTEXT__?.asset === "JUP");

  const context = await lastChartContext(page);
  expect(context.chartDataSource).toBe("data_unavailable");
  expect(context.fallbackReason).toMatch(/JUP does not yet have a reliable public candle feed/i);
  await expect(page.locator("#coverageBadge")).toContainText("Data unavailable");
  await expect(page.locator("#providerSource")).toContainText("Coverage Developing");
  await expect(page.locator("#staleTimestamp")).toContainText("Timestamp unavailable");
  await expect(page.locator("#chartSubtitle")).toContainText(/reliable public candle feed/i);
  await expect(page.locator("#coverageBadge")).not.toContainText(/Live/i);
  await expect(page.locator("#flowChart canvas")).toHaveCount(0);
  await expect(page.locator("#flowChart .rpw-state-panel")).toBeVisible();
});

test("empty provider response remains unavailable without a live badge", async ({ page }) => {
  await enableLightweightChartSpike(page);
  await page.route("**/api/terminal/chart**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("asset") === "BTC Spot") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          asset: "BTC Spot",
          source: "Structure Proxy",
          source_label: "Coverage Developing",
          coverage: "Coverage Developing",
          freshness_state: "degraded",
          message: "BTC Spot fixture provider candles unavailable.",
          candles: [],
        }),
      });
      return;
    }
    const asset = url.searchParams.get("asset") || "SOL-PERP";
    const timeframe = url.searchParams.get("timeframe") || "1h";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        asset,
        source: asset.endsWith("-PERP") ? "Hyperliquid" : "Yahoo Finance",
        source_label: asset.endsWith("-PERP") ? "Live perps market price" : "Live spot proxy price",
        coverage: "Live",
        freshness_state: "fresh",
        timeframe,
        observed_at: "2026-06-29T00:00:00.000Z",
        candles: providerCandles(asset, timeframe),
      }),
    });
  });

  await page.goto("/terminal/");
  await waitForChart(page);
  await page.locator("#marketNav button", { hasText: "Large Caps" }).click();
  await page.selectOption("#assetSelect", "BTC");
  await page.waitForFunction(() => window.__RAVENOS_TERMINAL_LAST_CHART_CONTEXT__?.asset === "BTC");

  const context = await lastChartContext(page);
  expect(context.chartDataSource).toBe("data_unavailable");
  await expect(page.locator("#coverageBadge")).toContainText("Data unavailable");
  await expect(page.locator("#providerSource")).toContainText("Coverage Developing");
  await expect(page.locator("#staleTimestamp")).toContainText("Timestamp unavailable");
  await expect(page.locator("#coverageBadge")).not.toContainText(/Live/i);
  await expect(page.locator("#flowChart canvas")).toHaveCount(0);
});

test("Lightweight Charts spike preserves overlay controls and clean chart text", async ({ page }) => {
  await enableLightweightChartSpike(page);
  await mockTerminalChartApi(page);

  await page.goto("/terminal/");
  await waitForChart(page);

  const groups = await page.locator("#flowChart .raven-overlay-categories button").evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()));
  expect(groups).toEqual(["Flow", "Structure", "Participation", "Replay", "Risk", "Manage"]);
  await expect(page.locator("#flowChart .raven-overlay-options")).toContainText("Pressure");
  await page.locator("#flowChart .raven-overlay-categories button", { hasText: "Structure" }).click();
  await expect(page.locator("#flowChart .raven-overlay-options")).toContainText("Reaction zone");
  const chartText = await page.locator("#flowChart").textContent();
  expect(chartText).not.toMatch(/Exit zone|Risk marker|Liquidity marker|Entry zone|participant cluster|clearest current surface/i);

  const initialCanvasCount = await page.locator("#flowChart canvas").count();
  await page.locator("#flowChart").evaluate((node) => {
    node.style.width = "720px";
    window.dispatchEvent(new Event("resize"));
  });
  await page.selectOption("#assetSelect", "BTC-PERP");
  await waitForChartContext(page, { asset: "BTC-PERP" });
  const canvasCount = await page.locator("#flowChart canvas").count();
  expect(initialCanvasCount).toBeGreaterThan(0);
  expect(canvasCount).toBe(initialCanvasCount);
});

test("root route serves the current Flow Terminal shell", async ({ page }) => {
  await page.goto("/");
  await waitForChart(page);
  await expect(page.locator("#marketNav")).toBeVisible();
  await expect(page.locator("#assetSelect")).toBeVisible();
  await expect(page.locator(".layout > .panel.nav")).toBeVisible();
  await expect(page.locator(".layout > .panel.chart-panel")).toBeVisible();
  await expect(page.locator(".layout > .panel.intel")).toBeVisible();
});

test("perpetuals dropdown expands beyond the static three-item fallback", async ({ page }) => {
  await page.route("**/api/hyperliquid/perps", async (route) => {
    const assets = [
      "BTC-PERP",
      "ETH-PERP",
      "SOL-PERP",
      "HYPE-PERP",
      "XRP-PERP",
      "DOGE-PERP",
      "BNB-PERP",
      "SUI-PERP",
      ...Array.from({ length: 76 }, (_, index) => `TEST${index + 1}-PERP`),
    ];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        results: assets.map((asset, index) => ({
          asset,
          provider: "Hyperliquid",
          coverage: "Live",
          isLive: true,
          lastUpdated: new Date().toISOString(),
          pressureScore: 60 + index,
          volumeScore: 50 + index,
          dayNtlVlm: 1000000 * (index + 1),
        })),
      }),
    });
  });
  await page.goto("/terminal/");
  await waitForChart(page);
  await expect.poll(async () => page.locator("#assetSelect option").count()).toBeGreaterThan(3);
  await expect(page.locator("#assetSelect option", { hasText: "ETH-PERP" })).toHaveCount(1);
  await expect(page.locator("#assetSelect option", { hasText: "HYPE-PERP" })).toHaveCount(1);
  await expect.poll(async () => page.locator("#assetSelect option").count()).toBeGreaterThan(70);
  await expect.poll(async () => page.locator("#flowRows tr").count()).toBeLessThanOrEqual(64);
  await expect(page.locator("#flowTableSummary")).toContainText(/Showing top 64 of/);

  const railBox = await page.locator(".layout > .panel.nav").boundingBox();
  const tableBox = await page.locator(".layout > .panel.table-panel").boundingBox();
  const viewport = page.viewportSize();
  expect(railBox).not.toBeNull();
  expect(tableBox).not.toBeNull();
});

test("terminal search and left rail groups drive the instrument dropdown", async ({ page }) => {
  await page.goto("/terminal/");
  await waitForChart(page);

  const searchBox = await page.locator("#dexSearchInputPanel").boundingBox();
  const chartPanelBox = await page.locator(".layout > .panel.chart-panel").boundingBox();
  expect(searchBox).not.toBeNull();
  expect(chartPanelBox).not.toBeNull();
  expect(searchBox.y).toBeGreaterThanOrEqual(chartPanelBox.y);

  await expect(page.locator("#marketNav button", { hasText: "Large Caps" })).toBeVisible();
  await page.locator("#marketNav button", { hasText: "Large Caps" }).click();
  const majorOptions = await page.locator("#assetSelect option").evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()));
  expect(majorOptions).toContain("BTC");
  expect(majorOptions).toContain("ETH");
  expect(majorOptions).not.toContain("DOGE-PERP");

  await page.locator("#marketNav button", { hasText: "Solana" }).click();
  const spotOptions = await page.locator("#assetSelect option").evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()));
  expect(spotOptions).toContain("SOL");
  expect(spotOptions).toContain("JUP");
  expect(spotOptions).not.toContain("SOL-PERP");
  await expect(page.locator("#flowTableSummary")).toContainText(/selected group/);
});

test("unified terminal exposes Spot Perps and Watchlist Paper lanes", async ({ page }) => {
  await page.goto("/terminal/");
  await waitForChart(page);

  await expect(page.locator("#terminalModeSelect")).toBeVisible();
  await expect(page.locator("#venueSelect")).toBeVisible();
  const lanes = await page.locator("#terminalModeSelect option").evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()));
  expect(lanes).toEqual(expect.arrayContaining(["Spot / Memes", "Perps", "Watchlist / Paper"]));

  await page.selectOption("#terminalModeSelect", "perps");
  await expect(page.locator("#marketNav button", { hasText: "Hyperliquid" })).toBeVisible();
  await expect(page.locator("#marketNav button", { hasText: "Actor Reinforced" })).toBeVisible();
  await expect(page.locator("#terminalLane")).toContainText(/Perps/);
  await expect(page.locator("#actorEvidenceState")).toBeVisible();
  await expect(page.locator("#paperDecisionState")).toBeVisible();
  await expect(page.locator("body")).toContainText("Preview only");
  await expect(page.locator("#rosCapabilityStatus")).toContainText("Sign off");

  await page.selectOption("#terminalModeSelect", "spot");
  await expect(page.locator("#marketNav button", { hasText: "Solana" })).toBeVisible();
  await page.locator('#marketNav [data-category="base"]').click();
  const baseOptions = await page.locator("#assetSelect option").evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()));
  expect(baseOptions).toContain("AERO");
  expect(baseOptions).not.toContain("SOL-PERP");

  await page.selectOption("#terminalModeSelect", "paper");
  await expect(page.locator("#marketNav button", { hasText: "Paper Ready" })).toBeVisible();
  await expect(page.locator("#terminalModeSelect")).toHaveValue("paper");
});

test("perps trade panel is preview-only with builder fee and TP SL controls", async ({ page }) => {
  await page.goto("/terminal/");
  await waitForChart(page);
  await page.waitForFunction(() => Boolean(window.RavenTerminalReviewFoundation));

  await page.selectOption("#terminalModeSelect", "perps");
  await waitForChart(page);

  const panel = page.locator("#executionReviewTicket");
  const primaryRows = page.locator("#executionReviewTicket .ticket-kv");
  const disclosure = page.locator("#reviewPacketPreview");
  const panelBox = await panel.boundingBox();
  const scoreBox = await page.locator(".intel .score").boundingBox();
  expect(panelBox).not.toBeNull();
  expect(scoreBox).not.toBeNull();
  expect(panelBox.y).toBeGreaterThan(scoreBox.y);
  await expect(panel).toContainText("Perps preview");
  await expect(panel).toContainText("user-confirmed only");
  await expect(panel).toContainText("Hyperliquid → Hyperliquid");
  await expect(panel).toContainText("USDC-denominated review");
  await expect(panel).toContainText("preview available");
  await expect(panel).toContainText("Hyperliquid account");
  await expect(panel).toContainText("Bridge");
  await expect(panel).toContainText("not enabled");
  await expect(primaryRows).toContainText("Route + fees shown before confirmation");
  await expect(disclosure).toContainText("Builder fee");
  await expect(disclosure).toContainText("0.05%-0.1% target");
  await expect(disclosure).toContainText("not charged in preview");
  await expect(disclosure).toContainText("charged only if executed");
  await expect(panel).toContainText("Preview only");
  await expect(page.locator("#rosCapabilityStatus")).toContainText("Sign off");
  await expect(page.locator("#rosCapabilityStatus")).toContainText("Broadcast off");
  await expect(panel).toContainText("TP/SL");
  await expect(panel).toContainText("Off");
  await expect(panel).toContainText("Raven auto");
  await expect(panel).toContainText("Auto TP/SL");
  await expect(panel).toContainText("Custom TP/SL");
  await expect(panel).toContainText("Not applied automatically");
  await expect(panel).toContainText("User chooses");
  await expect(page.locator("#ticketPrimarySide")).toHaveText("Long");
  await expect(page.locator("#ticketSecondarySide")).toHaveText("Short");
  await expect(page.locator("#ticketPrimarySide")).toBeDisabled();
  await expect(page.locator("#ticketSecondarySide")).toBeDisabled();
  await expect(page.locator("#ticketPreviewAction")).toBeDisabled();

  const packet = await page.evaluate(() => window.__RAVENOS_REVIEW_PACKET_PREVIEW__);
  expect(packet.status).toBe("preview_only");
  expect(packet.no_order_submitted).toBe(true);
  expect(packet.chain_context).toMatchObject({
    source_chain: "hyperliquid",
    target_chain: "hyperliquid",
    required_wallet: "hyperliquid_account",
    route_kind: "perp_order_future",
    settlement_asset: "USDC",
  });
  expect(packet.funding_context).toMatchObject({
    gas_required: false,
    gas_sponsored: false,
    bridge_required: false,
  });
  expect(packet.execution_boundary).toMatchObject({
    signing_enabled: false,
    submission_enabled: false,
    broadcast_enabled: false,
    custody_enabled: false,
    no_order_submitted: true,
  });
  expect(packet.safety_fields).toMatchObject({
    quote_only: true,
    signing_enabled: false,
    submission_enabled: false,
    broadcast_enabled: false,
    custody_enabled: false,
    autonomous_enabled: false,
    user_confirmation_required: true,
  });

  const unsafeEnabled = await page.locator("button:not([disabled])").evaluateAll((nodes) =>
    nodes.map((node) => node.textContent.trim()).filter((label) => /execute now|submit order|place order|buy now|sell now|long now|short now/i.test(label))
  );
  expect(unsafeEnabled).toEqual([]);
  const visiblePanelText = await panel.innerText();
  expect(visiblePanelText).not.toMatch(/Quote \/ Review ticket|Quote \/ Review|order ticket|review ticket|\bticket\b|Review packet|review packet|execution foundation/i);
});

test("spot trade panel is preview-only with Raven fee and TP SL controls", async ({ page }) => {
  await page.goto("/terminal/");
  await waitForChart(page);
  await page.waitForFunction(() => Boolean(window.RavenTerminalReviewFoundation));

  await page.selectOption("#terminalModeSelect", "spot");
  await waitForChart(page);

  const panel = page.locator("#executionReviewTicket");
  const primaryRows = page.locator("#executionReviewTicket .ticket-kv");
  const disclosure = page.locator("#reviewPacketPreview");
  await expect(panel).toContainText(/spot preview/i);
  await expect(panel).toContainText(/routed swap/i);
  await expect(primaryRows).toContainText("Route + fees shown before confirmation");
  await expect(disclosure).toContainText("Raven routing fee");
  await expect(disclosure).toContainText("not charged in preview");
  await expect(disclosure).toContainText("charged only if executed");
  await expect(panel).toContainText("Solana wallet");
  await expect(panel).toContainText("USDC-denominated review");
  await expect(panel).toContainText("Bridge");
  await expect(panel).toContainText("Gasless / unified balance");
  await expect(panel).toContainText("not enabled");
  await expect(panel).toContainText("Amount");
  await expect(panel).toContainText("Slippage");
  await expect(panel).toContainText("Off");
  await expect(panel).toContainText("Raven auto");
  await expect(panel).toContainText("Auto TP/SL");
  await expect(panel).toContainText("Custom TP/SL");
  await expect(page.locator("#ticketPrimarySide")).toHaveText("Buy");
  await expect(page.locator("#ticketSecondarySide")).toHaveText("Sell");
  await expect(page.locator("#ticketPrimarySide")).toBeDisabled();
  await expect(page.locator("#ticketSecondarySide")).toBeDisabled();
  await expect(page.locator("#ticketMarketType")).toBeDisabled();
  await expect(page.locator("#ticketLimitType")).toBeDisabled();

  const adapterSafety = await page.evaluate(() => {
    const foundation = window.RavenTerminalReviewFoundation;
    return Object.fromEntries(Object.entries(foundation.adapters).map(([key, adapter]) => [
      key,
      {
        capabilities: adapter.getCapabilities(),
        forbidden: ["submitOrder", "signTransaction", "broadcastTransaction", "placeOrder", "executeSwap"].filter((method) => method in adapter),
      },
    ]));
  });
  for (const entry of Object.values(adapterSafety)) {
    expect(entry.capabilities.live_execution_available).toBe(false);
    expect(entry.capabilities.signing_available).toBe(false);
    expect(entry.capabilities.submission_available).toBe(false);
    expect(entry.capabilities.broadcast_available).toBe(false);
    expect(entry.capabilities.supports_live_execution).toBe(false);
    expect(entry.capabilities.supports_signing).toBe(false);
    expect(entry.capabilities.supports_broadcast).toBe(false);
    expect(entry.capabilities.supports_custody).toBe(false);
    expect(entry.capabilities.supports_review_packet).toBe(true);
    expect(entry.forbidden).toEqual([]);
  }
  const visiblePanelText = await panel.innerText();
  expect(visiblePanelText).not.toMatch(/Quote \/ Review ticket|Quote \/ Review|order ticket|review ticket|\bticket\b|Review packet|review packet|execution foundation/i);
});

test("terminal displays chain-aware route availability across spot perps and paper", async ({ page }) => {
  await page.goto("/terminal/");
  await waitForChart(page);
  await page.waitForFunction(() => Boolean(window.RavenTerminalReviewFoundation));

  await page.selectOption("#terminalModeSelect", "perps");
  await waitForChart(page);
  await expect(page.locator("#tickerFlow")).toContainText(/Hyperliquid/);
  await expect(page.locator("#tickerUpdated")).toContainText(/Perps · USDC/);
  await expect(page.locator("#executionReviewTicket")).toContainText("Required wallet");
  await expect(page.locator("#executionReviewTicket")).toContainText("Hyperliquid account");
  await expect(page.locator("#marketSurfaceRows")).toContainText(/SOL-PERP|BTC-PERP|Hyperliquid/);

  await page.selectOption("#terminalModeSelect", "spot");
  await waitForChart(page);
  await expect(page.locator("#executionReviewTicket")).toContainText("Solana wallet");
  await expect(page.locator("#executionReviewTicket")).toContainText(/routed swap/i);
  await expect(page.locator("#marketSurfaceRows")).toContainText(/Solana spot|Solana/);

  await page.selectOption("#venueSelect", "base");
  await waitForChart(page);
  await expect(page.locator("#executionReviewTicket")).toContainText("EVM wallet");
  await expect(page.locator("#executionReviewTicket")).toContainText("Base → Base");
  await expect(page.locator("#tickerFlow")).toContainText(/Base/);

  await page.selectOption("#venueSelect", "ethereum");
  await waitForChart(page);
  await expect(page.locator("#executionReviewTicket")).toContainText("EVM wallet");
  await expect(page.locator("#executionReviewTicket")).toContainText("Ethereum → Ethereum");

  await page.selectOption("#terminalModeSelect", "paper");
  await waitForChart(page);
  await expect(page.locator("#executionReviewTicket")).toContainText("Paper preview");
  await expect(page.locator("#executionReviewTicket")).toContainText("No wallet required");
  await expect(page.locator("#executionReviewTicket")).toContainText(/no execution/i);

  const resolved = await page.evaluate(() => {
    const foundation = window.RavenTerminalReviewFoundation;
    return {
      sol: foundation.resolveInstrumentCandidates("SOL-PERP", { lane: "perps" })[0],
      base: foundation.resolveInstrumentCandidates("AERO", { lane: "spot", chain: "base" })[0],
      unsupported: foundation.resolveInstrumentCandidates("monad:TEST", { lane: "spot", chain: "monad_future" })[0],
    };
  });
  expect(resolved.sol.required_wallet).toBe("hyperliquid_account");
  expect(resolved.base.required_wallet).toBe("evm_wallet");
  expect(["future", "coverage_developing", "unsupported"]).toContain(resolved.unsupported.route_status);
});

test("spot meme lookup switches the trade panel away from stale perps context", async ({ page }) => {
  await page.route("**/api/dexscreener/search**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [{
          symbol: "Theo",
          quoteSymbol: "SOL",
          name: "Theo",
          chainId: "solana",
          dexId: "raydium",
          liquidityUsd: 42000,
          volume24h: 18000,
          priceUsd: 0.000053,
          txns24h: 84,
          priceChange24h: 6.4,
          pairAddress: "theo-sol-pair",
          tokenAddress: "theo-token",
          marketCap: 53000,
          fdv: 53000,
          lastUpdated: new Date().toISOString(),
        }],
      }),
    });
  });

  await page.goto("/terminal/");
  await waitForChartContext(page, { asset: "SOL-PERP" });
  await page.selectOption("#terminalModeSelect", "perps");
  await waitForChartContext(page, { asset: "SOL-PERP" });
  await expect(page.locator("#executionReviewTicket")).toContainText("Long");
  await expect(page.locator("#executionReviewTicket")).toContainText("Hyperliquid account");

  const search = page.locator("#dexSearchInputPanel");
  const results = page.locator("#dexSearchResultsPanel");
  await search.fill("theo");
  await expect(results.locator("[data-dex-index='0']")).toBeVisible();
  await results.locator("[data-dex-index='0']").click();
  await waitForChartContext(page, { asset: "Theo/SOL" });

  const panel = page.locator("#executionReviewTicket");
  const primaryRows = page.locator("#executionReviewTicket .ticket-kv");
  const disclosure = page.locator("#reviewPacketPreview");
  await expect(page.locator("#chartTitle")).toContainText("Theo/SOL · Solana Spot");
  await expect(page.locator("#tickerFlow")).toContainText("Solana");
  await expect(page.locator("#tickerUpdated")).toContainText("Spot");
  await expect(page.locator("#tickerVolume")).toContainText("MCap $53.0K");
  await expect(page.locator("#tickerPrice")).toContainText("$0.000053");
  await expect(page.locator("#lastPrice")).toContainText("$0.000053");
  await expect(page.locator("#chartSubtitle")).toContainText("Price $0.000053");
  await expect(page.locator("#chartSubtitle")).toContainText("MCap $53.0K");
  await expect(page.locator("#chartSubtitle")).toContainText("Liq $42.0K");
  await expect(page.locator("#chartStatusLabel")).toContainText("Data unavailable");
  await expect(page.locator("#chartSubtitle")).toContainText("Current chart coverage is unavailable");
  expect((await lastChartContext(page)).formattedLastPrice).toBe("$0.000053");
  await expect(page.locator("#tickerOpenInterestLabel")).toHaveText("Liq");
  await expect(page.locator("#tickerOpenInterest")).toContainText("Liq $42.0K");
  await expect(page.locator("#tickerFundingLabel")).toHaveText("Risk");
  await expect(page.locator("#tickerFunding")).toContainText("Elevated");
  await expect(page.locator("#terminalModeSelect")).toHaveValue("spot");
  await expect(page.locator("#venueSelect")).toHaveValue("solana");
  await expect(page.locator("#spotMarketContextPanel")).toBeVisible();
  await expect(page.locator("#spotMarketContextPanel")).toContainText("Market cap");
  await expect(page.locator("#spotMarketContextPanel")).toContainText("$53.0K");
  await expect(page.locator("#spotMarketContextPanel")).toContainText("Liquidity");
  await expect(page.locator("#spotMarketContextPanel")).toContainText("$42.0K");
  await expect(page.locator("#spotMarketContextPanel")).toContainText("24h volume");
  await expect(page.locator("#spotMarketContextPanel")).toContainText("$18.0K");
  await expect(page.locator("#spotMarketContextPanel")).toContainText("Txns 24h");
  await expect(page.locator("#spotMarketContextPanel")).toContainText("84");
  await expect(page.locator("#spotMarketContextPanel")).toContainText("Chart coverage");
  await expect(page.locator("#marketNav .instrument-row", { hasText: "Theo/SOL" })).toContainText("$53.0K");
  await expect(page.locator("#ticketPrimarySide")).toHaveText("Buy");
  await expect(page.locator("#ticketSecondarySide")).toHaveText("Sell");
  await expect(panel).toContainText("Solana spot preview");
  await expect(panel).toContainText("Future Solana routed swap");
  await expect(panel).toContainText("Solana wallet");
  await expect(primaryRows).toContainText("Route + fees shown before confirmation");
  await expect(disclosure).toContainText("Raven routing fee");
  await expect(disclosure).toContainText("not charged in preview");
  await expect(page.locator("#ticketRouteStatus")).toContainText("preview not available yet");
  await expect(page.locator("#ticketRiskValue")).toContainText("swap routing not enabled");
  await expect(panel).toContainText("Bridge");
  await expect(panel).toContainText("not enabled");
  await expect(panel).toContainText("Gasless / unified balance");
  await expect(panel).not.toContainText("Long");
  await expect(panel).not.toContainText("Short");
  await expect(panel).not.toContainText("Future Hyperliquid order");
  await expect(panel).not.toContainText("Hyperliquid account");
  await expect(primaryRows).not.toContainText("Builder fee");
  await expect(panel).not.toContainText("Leverage / margin");
  await expect(panel).not.toContainText(/execute now|submit order|place order|buy now|sell now|long now|short now|guaranteed|autonomous trading/i);

  const packet = await page.evaluate(() => window.__RAVENOS_REVIEW_PACKET_PREVIEW__);
  expect(packet.instrument).toMatchObject({
    symbol: "Theo/SOL",
    chain: "solana",
    market_type: "spot",
    required_wallet: "solana_wallet",
    route_kind: "same_chain_swap_future",
  });
  expect(packet.adapter).toBe("solana_jupiter_future");
  expect(packet.execution_boundary).toMatchObject({
    signing_enabled: false,
    submission_enabled: false,
    broadcast_enabled: false,
    custody_enabled: false,
    no_order_submitted: true,
  });

  await page.selectOption("#terminalModeSelect", "perps");
  await waitForChartContext(page, { asset: "SOL-PERP" });
  await expect(page.locator("#ticketPrimarySide")).toHaveText("Long");
  await expect(page.locator("#ticketSecondarySide")).toHaveText("Short");
  await expect(page.locator("#tickerOpenInterestLabel")).toHaveText("OI");
  await expect(page.locator("#tickerFundingLabel")).toHaveText("Funding");
  await expect(page.locator("#spotMarketContextPanel")).toBeHidden();
  await expect(panel).toContainText("Hyperliquid account");
  await expect(disclosure).toContainText("Builder fee");
  await expect(panel).not.toContainText("Solana wallet");

  await search.fill("theo");
  await expect(results.locator("[data-dex-index='0']")).toBeVisible();
  await results.locator("[data-dex-index='0']").click();
  await waitForChartContext(page, { asset: "Theo/SOL" });
  await expect(page.locator("#ticketPrimarySide")).toHaveText("Buy");
  await expect(page.locator("#ticketSecondarySide")).toHaveText("Sell");
  await expect(panel).toContainText("Solana wallet");
  await expect(panel).not.toContainText("Hyperliquid account");
});

test("retire style Solana meme keeps small price chart labels and market context useful", async ({ page }) => {
  await page.route("**/api/dexscreener/search**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [{
          symbol: "retire",
          quoteSymbol: "SOL",
          name: "retire",
          chainId: "solana",
          dexId: "pumpswap",
          liquidityUsd: 446100,
          volume24h: 92000,
          priceUsd: 0.002662,
          txns24h: 312,
          priceChange24h: 2.8,
          pairAddress: "retire-sol-pair",
          tokenAddress: "retire-token",
          marketCap: 2660000,
          fdv: 2660000,
          lastUpdated: new Date().toISOString(),
        }],
      }),
    });
  });

  await page.goto("/terminal/");
  await waitForChart(page);
  const search = page.locator("#dexSearchInputPanel");
  const results = page.locator("#dexSearchResultsPanel");
  await search.fill("retire");
  await expect(results.locator("[data-dex-index='0']")).toBeVisible();
  await results.locator("[data-dex-index='0']").click();
  await waitForChartContext(page, { asset: "retire/SOL" });

  await expect(page.locator("#chartTitle")).toContainText("retire/SOL · Solana Spot");
  await expect(page.locator("#chartStatusLabel")).toContainText("Data unavailable");
  await expect(page.locator("#chartSubtitle")).toContainText("Price $0.002662");
  await expect(page.locator("#chartSubtitle")).toContainText("MCap $2.66M");
  await expect(page.locator("#chartSubtitle")).toContainText("Liq $446.1K");
  await expect(page.locator("#chartSubtitle")).toContainText("Vol $92.0K");
  await expect(page.locator("#tickerPrice")).toContainText("$0.002662");
  await expect(page.locator("#tickerVolume")).toContainText("MCap $2.66M");
  await expect(page.locator("#tickerOpenInterestLabel")).toHaveText("Liq");
  await expect(page.locator("#tickerOpenInterest")).toContainText("Liq $446.1K");
  await expect(page.locator("#tickerFundingLabel")).toHaveText("Risk");
  await expect(page.locator("#tickerFunding")).toContainText("Stable");
  await expect(page.locator("#spotMarketContextPanel")).toContainText("Market cap");
  await expect(page.locator("#spotMarketContextPanel")).toContainText("$2.66M");
  await expect(page.locator("#spotMarketContextPanel")).toContainText("Liquidity");
  await expect(page.locator("#spotMarketContextPanel")).toContainText("$446.1K");
  await expect(page.locator("#spotMarketContextPanel")).toContainText("24h volume");
  await expect(page.locator("#spotMarketContextPanel")).toContainText("$92.0K");
  await expect(page.locator("#spotMarketContextPanel")).toContainText("Txns 24h");
  await expect(page.locator("#spotMarketContextPanel")).toContainText("312");
  await expect(page.locator("#marketNav .instrument-row", { hasText: "retire/SOL" })).toContainText("$0.002662");
  await expect(page.locator("#marketNav .instrument-row", { hasText: "retire/SOL" })).toContainText("$2.66M");
  await expect(page.locator("#ticketPrimarySide")).toHaveText("Buy");
  await expect(page.locator("#ticketSecondarySide")).toHaveText("Sell");
  await expect(page.locator("#executionReviewTicket")).toContainText("Solana wallet");
  await expect(page.locator("#executionReviewTicket .ticket-kv")).toContainText("Route + fees shown before confirmation");
  await expect(page.locator("#reviewPacketPreview")).toContainText("Raven routing fee");
  await expect(page.locator("#executionReviewTicket")).not.toContainText("Hyperliquid account");
  await expect(page.locator("#executionReviewTicket .ticket-kv")).not.toContainText("Builder fee");
  await expect(page.locator("#executionReviewTicket")).not.toContainText("Leverage / margin");

  const context = await lastChartContext(page);
  expect(context.formattedLastPrice).toBe("$0.002662");
  expect(context.spotChartSummary).toContain("Price $0.002662");
  expect(context.spotChartSummary).toContain("MCap $2.66M");
  expect(context.chartStatusText).toBe("Data unavailable");
});

test("base and Solana spot selections keep Buy Sell route context while perps keeps Long Short", async ({ page }) => {
  await page.goto("/terminal/");
  await waitForChart(page);

  await page.selectOption("#terminalModeSelect", "spot");
  await page.selectOption("#venueSelect", "solana");
  await page.selectOption("#assetSelect", "SOL");
  await waitForChartContext(page, { asset: "SOL" });
  await expect(page.locator("#ticketPrimarySide")).toHaveText("Buy");
  await expect(page.locator("#ticketSecondarySide")).toHaveText("Sell");
  await expect(page.locator("#executionReviewTicket")).toContainText("Solana wallet");
  await expect(page.locator("#executionReviewTicket .ticket-kv")).toContainText("Route + fees shown before confirmation");
  await expect(page.locator("#reviewPacketPreview")).toContainText("Raven routing fee");
  await expect(page.locator("#executionReviewTicket")).not.toContainText("Hyperliquid account");
  await expect(page.locator("#executionReviewTicket .ticket-kv")).not.toContainText("Builder fee");
  await expect(page.locator("#spotMarketContextPanel")).toBeVisible();
  await expect(page.locator("#spotMarketContextPanel")).toContainText("Market cap");
  await expect(page.locator("#tickerOpenInterestLabel")).toHaveText("Liq");
  await expect(page.locator("#tickerFundingLabel")).toHaveText("Risk");

  await page.selectOption("#venueSelect", "base");
  await page.selectOption("#assetSelect", "AERO");
  await waitForChartContext(page, { asset: "AERO" });
  await expect(page.locator("#ticketPrimarySide")).toHaveText("Buy");
  await expect(page.locator("#ticketSecondarySide")).toHaveText("Sell");
  await expect(page.locator("#executionReviewTicket")).toContainText("EVM wallet");
  await expect(page.locator("#executionReviewTicket")).toContainText("Base → Base");
  await expect(page.locator("#executionReviewTicket")).not.toContainText("Hyperliquid account");
  await expect(page.locator("#executionReviewTicket .ticket-kv")).not.toContainText("Builder fee");
  await expect(page.locator("#spotMarketContextPanel")).toBeVisible();
  await expect(page.locator("#spotMarketContextPanel")).toContainText("coverage developing");

  await page.selectOption("#venueSelect", "ethereum");
  await page.selectOption("#assetSelect", "ETH");
  await waitForChartContext(page, { asset: "ETH" });
  await expect(page.locator("#chartTitle")).toContainText("ETH · Ethereum Spot");
  await expect(page.locator("#ticketPrimarySide")).toHaveText("Buy");
  await expect(page.locator("#ticketSecondarySide")).toHaveText("Sell");
  await expect(page.locator("#executionReviewTicket")).toContainText("EVM wallet");
  await expect(page.locator("#executionReviewTicket")).toContainText("Ethereum → Ethereum");
  await expect(page.locator("#executionReviewTicket")).not.toContainText("Hyperliquid account");
  await expect(page.locator("#executionReviewTicket .ticket-kv")).not.toContainText("Builder fee");
  await expect(page.locator("#spotMarketContextPanel")).toBeVisible();

  await page.selectOption("#terminalModeSelect", "perps");
  await page.selectOption("#assetSelect", "SOL-PERP");
  await waitForChartContext(page, { asset: "SOL-PERP" });
  await expect(page.locator("#ticketPrimarySide")).toHaveText("Long");
  await expect(page.locator("#ticketSecondarySide")).toHaveText("Short");
  await expect(page.locator("#executionReviewTicket")).toContainText("Hyperliquid account");
  await expect(page.locator("#reviewPacketPreview")).toContainText("Builder fee");
  await expect(page.locator("#executionReviewTicket")).toContainText("Leverage / margin");
  await expect(page.locator("#executionReviewTicket")).not.toContainText("Solana wallet");
  await expect(page.locator("#spotMarketContextPanel")).toBeHidden();
});

test("Avalanche spot search resolves to EVM wallet and AVAX gas preview only", async ({ page }) => {
  await page.route("**/api/dexscreener/search**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [{
          symbol: "COQ",
          quoteSymbol: "AVAX",
          name: "COQ/AVAX",
          chainId: "avalanche",
          dexId: "traderjoe",
          liquidityUsd: 0,
          volume24h: 0,
          priceUsd: null,
          txns24h: 0,
          priceChange24h: null,
          marketCap: null,
          fdv: null,
          lastUpdated: new Date().toISOString(),
        }],
      }),
    });
  });

  await page.goto("/terminal/");
  await waitForChart(page);
  await expect(page.locator("#venueSelect")).toContainText("Avalanche");

  const search = page.locator("#dexSearchInputPanel");
  const results = page.locator("#dexSearchResultsPanel");
  await search.fill("coq");
  await expect(results.locator("[data-dex-index='0']")).toBeVisible();
  await results.locator("[data-dex-index='0']").click();
  await waitForChartContext(page, { asset: "COQ/AVAX" });

  const panel = page.locator("#executionReviewTicket");
  const primaryRows = page.locator("#executionReviewTicket .ticket-kv");
  await expect(page.locator("#chartTitle")).toContainText("COQ/AVAX · Avalanche Spot");
  await expect(page.locator("#terminalModeSelect")).toHaveValue("spot");
  await expect(page.locator("#venueSelect")).toHaveValue("avalanche");
  await expect(page.locator("#tickerFlow")).toContainText("Avalanche");
  await expect(page.locator("#ticketPrimarySide")).toHaveText("Buy");
  await expect(page.locator("#ticketSecondarySide")).toHaveText("Sell");
  await expect(panel).toContainText("Avalanche spot preview");
  await expect(panel).toContainText("Future Avalanche routed swap");
  await expect(panel).toContainText("EVM wallet");
  await expect(panel).toContainText("AVAX required");
  await expect(panel).toContainText("Bridge");
  await expect(panel).toContainText("not enabled");
  await expect(panel).toContainText("Gasless / unified balance");
  await expect(primaryRows).toContainText("Route + fees shown before confirmation");
  await expect(page.locator("#reviewPacketPreview")).toContainText("Raven routing fee");
  await expect(page.locator("#reviewPacketPreview")).toContainText("AVAX gas");
  await expect(page.locator("#reviewPacketPreview")).toContainText("charged only if executed");
  await expect(panel).not.toContainText("Long");
  await expect(panel).not.toContainText("Short");
  await expect(panel).not.toContainText("Hyperliquid account");
  await expect(primaryRows).not.toContainText("Builder fee");
  await expect(panel).not.toContainText("Leverage / margin");

  const packet = await page.evaluate(() => window.__RAVENOS_REVIEW_PACKET_PREVIEW__);
  expect(packet.adapter).toBe("avalanche_evm_future");
  expect(packet.chain_context).toMatchObject({
    source_chain: "avalanche",
    target_chain: "avalanche",
    required_wallet: "evm_wallet",
    route_kind: "same_chain_swap_future",
    chain_id: 43114,
    gas_asset: "AVAX",
  });
  expect(packet.execution_boundary.signing_enabled).toBe(false);
  expect(packet.execution_boundary.broadcast_enabled).toBe(false);

  await page.selectOption("#terminalModeSelect", "perps");
  await page.selectOption("#assetSelect", "SOL-PERP");
  await waitForChartContext(page, { asset: "SOL-PERP" });
  await expect(page.locator("#ticketPrimarySide")).toHaveText("Long");
  await expect(page.locator("#ticketSecondarySide")).toHaveText("Short");
  await expect(panel).toContainText("Hyperliquid account");
  await expect(panel).not.toContainText("AVAX required");
});

test("terminal search dropdown closes on select outside click and escape", async ({ page }) => {
  await page.route("**/api/dexscreener/search**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [{
          symbol: "BONK",
          quoteSymbol: "USDC",
          name: "Bonk",
          chainId: "solana",
          dexId: "raydium",
          liquidityUsd: 1800000,
          volume24h: 420000,
          priceUsd: 0.000021,
          txns24h: 1600,
          priceChange24h: 4.2,
          pairAddress: "bonk-usdc-pair",
          tokenAddress: "bonk-token",
          marketCap: 1200000000,
          fdv: 1200000000,
          lastUpdated: new Date().toISOString(),
        }],
      }),
    });
  });
  await page.goto("/terminal/");
  await waitForChart(page);

  const search = page.locator("#dexSearchInputPanel");
  const results = page.locator("#dexSearchResultsPanel");
  await search.fill("bonk");
  await expect(results).toHaveClass(/active/);
  await expect(results.locator("[data-dex-index='0']")).toBeVisible();
  await results.locator("[data-dex-index='0']").click();
  await expect(results).not.toHaveClass(/active/);

  await search.fill("bonk");
  await expect(results).toHaveClass(/active/);
  await page.mouse.click(24, 24);
  await expect(results).not.toHaveClass(/active/);

  await search.fill("bonk");
  await expect(results).toHaveClass(/active/);
  await page.keyboard.press("Escape");
  await expect(results).not.toHaveClass(/active/);
});

test("terminal product layout keeps rails chart table overlay controls and top search visible", async ({ page }) => {
  await page.goto("/terminal/");
  await waitForChart(page);

  const leftRail = page.locator(".layout > .panel.nav");
  const chartPanel = page.locator(".layout > .panel.chart-panel");
  const chartHost = page.locator("#flowChart");
  const rightRail = page.locator(".layout > .panel.intel");
  const bottomTable = page.locator(".layout > .panel.table-panel");
  const overlayRow = page.locator("#flowChart .raven-overlay-library");
  const search = page.locator("#dexSearchInputPanel");
  const controls = page.locator(".selectors");

  await expect(leftRail).toBeVisible();
  await expect(chartPanel).toBeVisible();
  await expect(rightRail).toBeVisible();
  await expect(bottomTable).toBeVisible();
  await expect(overlayRow).toBeVisible();
  await expect(search).toBeVisible();
  await expect(page.locator("#behavioralDeckPanel")).toContainText("Behavioral Deck");
  await expect(page.locator("#behavioralDeckPanel")).toContainText("Raven's read");
  await expect(page.locator("#behavioralDeckPanel")).toContainText("Observation level");
  await expect(page.locator("#behavioralDeckPanel")).toContainText("Evidence completeness");
  await expect(page.locator("#behavioralDeckPanel")).toContainText("Authority state");
  await expect(page.locator("#behavioralDeckPanel")).toContainText("Path evidence");
  await expect(page.locator("#behavioralDeckPanel")).toContainText("Management path");
  await expect(page.locator("#deckPathEvidence")).toContainText(/path capture forming|path backed observations available/i);
  await expect(page.locator("#deckManagementValidation")).toContainText(/not validated|under review/i);
  await expect(page.locator("#behavioralDeckPanel")).toContainText(/Why Raven is watching/i);
  await expect(page.locator("#behavioralDeckPanel")).toContainText(/Supported by/i);
  await expect(page.locator("#behavioralDeckPanel")).toContainText(/Missing/i);
  await expect(page.locator("#behavioralDeckPanel")).toContainText(/What that means/i);
  const deckOrder = await page.locator("#behavioralDeckPanel").evaluate((node) => {
    const read = node.querySelector("#deckReadCard")?.getBoundingClientRect().top || 0;
    const fields = node.querySelector(".deck-grid")?.getBoundingClientRect().top || 0;
    return { read, fields };
  });
  expect(deckOrder.read).toBeLessThan(deckOrder.fields);
  await expect(page.locator("#ravenContextPanel")).toContainText("Evidence");
  await expect(page.locator("#ravenContextPanel")).toContainText("Why Raven believes");
  await expect(page.locator("#ravenContextPanel")).toContainText("Outcome");
  await expect(page.locator("#ravenContextPanel")).toContainText("Path evidence");
  await expect(page.locator("#ravenContextPanel")).toContainText("Management path");
  await expect(page.locator("#contextObservations")).toContainText(/aggregate actors|observations|metadata|context/i);
  await expect(page.locator("#contextOutcome")).toContainText(/validation|settled|unproven|forming|mixed/i);
  await expect(page.locator("#behaviorContextPanel")).toContainText("Behavior");
  await expect(page.locator("#behaviorContextPanel")).toContainText("Who is participating");
  await expect(page.locator("#behaviorContextPanel")).toContainText("Repeat cohorts");
  await expect(page.locator("#behaviorContextPanel")).not.toContainText(/Smart Money/i);
  await expect(page.locator(".tape-panel")).toContainText("Journal / Timeline");
  await expect(page.locator(".tape-panel")).toContainText("Market Timeline");
  await expect(page.locator(".tape-panel")).toContainText(/Raven Read updated|Timeline forming|Evidence updates will appear here/);
  await expect(page.locator(".tape-panel")).not.toContainText(/claim_|settlement_id|methodology_version|source_artifact/i);
  await expect(page.locator("#terminalModeSelect")).toBeVisible();
  await expect(page.locator("#venueSelect")).toBeVisible();
  await expect(page.locator("#tickerInstrument")).toBeVisible();
  await expect(page.locator("#tickerChange")).toBeVisible();
  await expect(page.locator("#tickerVolume")).toBeVisible();
  await expect(page.locator("#tickerOpenInterest")).toBeVisible();
  await expect(page.locator("#tickerFunding")).toBeVisible();
  await expect(page.locator("#tickerRoute")).toBeVisible();
  await expect(page.locator("#tickerFlow")).toContainText(/Hyperliquid|Solana|Base|Ethereum|Market/i);
  await expect(page.locator("#tickerUpdated")).toContainText(/Perps|Spot|Paper/i);
  await expect(page.locator("#walletState")).toBeVisible();
  await expect(page.locator(".market-tabs")).toContainText("Markets");
  await expect(page.locator(".market-tabs")).toContainText("Watchlist");
  await expect(page.locator(".market-tabs")).toContainText("Paper");
  await expect(page.locator(".market-tabs")).toContainText("Trending");
  await expect(page.locator("#marketNav .instrument-row").first()).toBeVisible();
  await expect(page.locator("#marketNav .instrument-row").first()).toContainText(/SOL-PERP|BTC-PERP|ETH-PERP|SOL|JUP/i);
  await expect(page.locator("#marketNav .instrument-row .venue-tag").first()).toBeVisible();
  await expect(page.locator(".workspace-tabs")).toBeVisible();
  for (const tab of ["Positions", "Open Orders", "Balances", "Trade History", "Paper Trades", "Raven Replay", "Outcomes"]) {
    await expect(page.locator(".workspace-tabs")).toContainText(tab);
  }
  await expect(page.locator(".workspace-empty")).toContainText("Connect wallet/account to view account activity");

  const chartBox = await chartHost.boundingBox();
  const searchBox = await search.boundingBox();
  const controlsBox = await controls.boundingBox();
  const chartPanelBox = await chartPanel.boundingBox();
  const leftRailBox = await leftRail.boundingBox();
  const rightRailBox = await rightRail.boundingBox();
  const bottomTableBox = await bottomTable.boundingBox();
  const navItemBox = await page.locator("#marketNav .nav-item").first().boundingBox();
  expect(chartBox).not.toBeNull();
  expect(searchBox).not.toBeNull();
  expect(controlsBox).not.toBeNull();
  expect(chartPanelBox).not.toBeNull();
  expect(leftRailBox).not.toBeNull();
  expect(rightRailBox).not.toBeNull();
  expect(bottomTableBox).not.toBeNull();
  expect(navItemBox).not.toBeNull();
  expect(chartBox.width).toBeGreaterThanOrEqual(700);
  expect(chartBox.height).toBeGreaterThanOrEqual(500);
  expect(chartBox.width).toBeGreaterThan(leftRailBox.width * 2);
  expect(chartBox.width).toBeGreaterThan(rightRailBox.width);
  expect(navItemBox.height).toBeLessThanOrEqual(44);
  expect(searchBox.y).toBeGreaterThanOrEqual(chartPanelBox.y);
  expect(searchBox.y).toBeGreaterThanOrEqual(controlsBox.y);
  expect(searchBox.y).toBeLessThan(chartBox.y);
  expect(bottomTableBox.y).toBeGreaterThan(chartPanelBox.y);
  await expect.poll(async () => page.locator("#flowRows tr").count()).toBeLessThanOrEqual(64);

  const groups = await page.locator("#flowChart .raven-overlay-categories button").evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()));
  expect(groups).toEqual(expect.arrayContaining(["Flow", "Structure", "Participation", "Replay", "Risk", "Manage"]));
  await expect(page.locator("#flowChart .raven-overlay-options")).toContainText("Pressure");
  await expect(page.locator("#flowChart .raven-overlay-region")).toHaveCount(0);

  const chartText = await chartHost.textContent();
  expect(chartText).not.toMatch(/Entry zone|Exit zone|Risk marker|Liquidity marker|participant cluster|Flow exhaustion|setup forming|Hyperliquid pressure context/i);
  const bodyText = await visibleBodyText(page);
  expect(bodyText).not.toMatch(/marketing hero|public evidence shell|generated route|debug|autonomous trading|buy now|sell now|long now|short now|one-click trade|guaranteed|execution foundation|Quote \/ Review Ticket|review ticket|order ticket|review packet/i);
});

test("mobile terminal uses shared app workspaces instead of stacked desktop panels", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/terminal/");
  await waitForChart(page);

  await expect(page.locator(".mobile-terminal-header")).toBeVisible();
  await expect(page.locator(".topbar")).toBeHidden();
  await expect(page.locator(".mobile-bottom-nav")).toBeVisible();
  for (const tab of ["Market", "Trade", "Behavior", "Account", "Evidence", "Journal"]) {
    await expect(page.locator(".mobile-bottom-nav")).toContainText(tab);
  }
  const bottomNavBox = await page.locator(".mobile-bottom-nav").boundingBox();
  expect(bottomNavBox.height).toBeLessThanOrEqual(50);
  await expect(page.locator('button[data-mobile-tab="trade"]')).toHaveClass(/active/);
  await expect(page.locator("#flowChart")).toBeVisible();
  await expect(page.locator("#marketNav")).toBeHidden();
  const chartBox = await page.locator("#flowChart").boundingBox();
  const largestCanvas = await page.locator("#flowChart canvas").evaluateAll((nodes) => {
    return nodes.reduce((max, node) => {
      const box = node.getBoundingClientRect();
      return box.width > max.width ? { width: box.width, height: box.height } : max;
    }, { width: 0, height: 0 });
  });
  expect(largestCanvas.width).toBeGreaterThan(chartBox.width * 0.72);
  await expect(page.locator("#flowChart")).not.toContainText(/Instrument\s+Market\s+Price/i);
  const mobileOverlay = page.locator("#flowChart .raven-overlay-library");
  await expect(mobileOverlay).toBeHidden();
  await page.locator("#flowChart [data-rpw-overlays]").click();
  const mobileOverlayBox = await mobileOverlay.boundingBox();
  expect(mobileOverlayBox.height).toBeLessThanOrEqual(190);
  await page.locator("#flowChart [data-rpw-overlays]").click();
  await expect(page.locator("#mobilePrimaryTradeButton")).toContainText(/Long|Buy/);
  await expect(page.locator("#mobileSecondaryTradeButton")).toContainText(/Short|Sell/);
  const actionBarBox = await page.locator(".mobile-trade-actions").boundingBox();
  expect(actionBarBox).not.toBeNull();
  expect(actionBarBox.y).toBeGreaterThanOrEqual(0);
  expect(actionBarBox.y + actionBarBox.height).toBeLessThanOrEqual(844);
  expect(actionBarBox.y).toBeLessThan(bottomNavBox.y);
  expect(actionBarBox.y + actionBarBox.height).toBeLessThanOrEqual(bottomNavBox.y + 1);
  await expect(page.locator("#indicatorToolbar")).toBeHidden();
  await expect(page.locator("#indicatorStateLabel")).toBeHidden();
  await page.locator("#indicatorMenuToggle").click();
  await expect(page.locator("#indicatorToolbar")).toBeVisible();
  await page.locator('[data-indicator="ema20"]').click();
  await expect(page.locator("#indicatorMenuToggle")).toContainText(/Indicators · 1/i);
  await expect(page.locator('[data-indicator="ema20"]')).toHaveAttribute("aria-pressed", "true");

  await page.locator("#mobileSymbolButton").click();
  await expect(page.locator("#mobileMarketSheet")).toHaveClass(/active/);
  await expect(page.locator("#mobileMarketSearch")).toBeVisible();
  await expect(page.locator(".mobile-market-row").first()).toBeVisible();
  await page.locator("#mobileMarketSearch").fill("SOL");
  await expect(page.locator('#mobileMarketSheet button[data-mobile-asset="SOL-PERP"]').first()).toBeVisible();
  await page.locator("#mobileMarketSearch").fill("unknown-does-not-exist");
  await expect(page.locator("#mobileMarketList")).toContainText("No matching market in current coverage");
  await page.locator("#mobileMarketSearch").fill("SOL-PERP");
  await page.locator('#mobileMarketSheet button[data-mobile-asset="SOL-PERP"]').first().click();
  await expect(page.locator("#mobileMarketSheet")).not.toHaveClass(/active/);
  await expect(page.locator("#chartTitle")).toContainText("SOL-PERP");
  await expect(page.locator("#mobilePrimaryTradeButton")).toContainText("Long");

  await page.locator("#mobileSymbolButton").click();
  await page.locator("#mobileMarketSearch").fill("");
  await page.evaluate(() => document.querySelector('[data-mobile-market-filter="spot"]')?.click());
  await expect(page.locator('#mobileMarketSheet button[data-mobile-asset="SOL"]').first()).toBeVisible();
  await page.locator('#mobileMarketSheet button[data-mobile-asset="SOL"]').first().click();
  await expect(page.locator("#mobileMarketSheet")).not.toHaveClass(/active/);
  await expect(page.locator("#chartTitle")).toContainText(/Spot/);
  await expect(page.locator("#mobilePrimaryTradeButton")).toContainText("Buy");
  await expect(page.locator("#ticketPrimarySide")).toHaveText("Buy");
  await expect(page.locator("#ticketRequiredWallet")).toContainText(/Solana wallet|EVM wallet/);

  await page.locator("#mobilePrimaryTradeButton").click();
  await expect(page.locator("body")).toHaveClass(/mobile-preview-open/);
  await expect(page.locator("#executionReviewTicket")).toBeVisible();
  await expect(page.locator("#reviewPacketPreview")).toBeHidden();
  await expect(page.locator("#ticketPreviewAction")).toContainText(/Preview|Review trade/);
  await expect(page.locator("#executionReviewTicket")).toContainText("Preview only");
  await expect(page.locator("#rosCapabilityStatus")).toContainText("Sign off");
  await expect(page.locator("#rosCapabilityStatus")).toContainText("Broadcast off");
  await page.keyboard.press("Escape");
  await expect(page.locator("body")).not.toHaveClass(/mobile-preview-open/);

  await page.evaluate(() => document.querySelector('button[data-mobile-tab="markets"]')?.click());
  await expect(page.locator("#marketNav")).toBeVisible();
  await expect(page.locator("#mobileMarketInlineSearch")).toBeVisible();
  await expect(page.locator("#marketNav .instrument-row").first()).toBeVisible();
  const firstMarketRow = await page.locator("#marketNav .instrument-row").first().boundingBox();
  expect(firstMarketRow.height).toBeLessThanOrEqual(42);

  await page.evaluate(() => document.querySelector('button[data-mobile-tab="book"]')?.click());
  await expect(page.locator(".mobile-book-panel")).toBeVisible();
  await expect(page.locator(".mobile-book-panel")).toContainText("Behavior");
  await expect(page.locator(".mobile-book-panel")).toContainText(/coverage developing|Actor cohorts|Participation/i);
  const bookBox = await page.locator(".mobile-book-panel").boundingBox();
  expect(bookBox.height).toBeLessThanOrEqual(260);

  await page.evaluate(() => document.querySelector('button[data-mobile-tab="positions"]')?.click());
  await expect(page.locator(".table-panel")).toBeVisible();
  await expect(page.locator(".workspace-empty")).toContainText("Connect wallet/account to view account activity");
  await expect(page.locator(".table-panel .table-wrap")).toBeHidden();
  const tableBox = await page.locator(".table-panel").boundingBox();
  expect(tableBox.width).toBeLessThanOrEqual(390);

  await page.evaluate(() => document.querySelector('button[data-mobile-tab="signals"]')?.click());
  await expect(page.locator("#behavioralDeckPanel")).toBeVisible();
  await expect(page.locator("#behavioralDeckPanel")).toContainText("Behavioral Deck");
  await expect(page.locator("#behavioralDeckPanel")).toContainText("Raven's read");
  await expect(page.locator("#behavioralDeckPanel")).toContainText(/Research status|Evidence completeness/);
  await expect(page.locator("#behavioralDeckPanel")).toContainText(/Path evidence|Management path/);
  await expect(page.locator("#behavioralDeckPanel")).toContainText(/descriptive only|followthrough still checked|deck remains observational/i);
  const deckValueStyle = await page.locator("#deckEvidenceCompleteness").evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      overflow: style.overflow,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
    };
  });
  expect(deckValueStyle.textOverflow).not.toBe("ellipsis");
  expect(deckValueStyle.whiteSpace).not.toBe("nowrap");
  await expect(page.locator("#ravenContextPanel")).toBeVisible();
  await expect(page.locator("#ravenContextPanel")).toContainText("Evidence");
  await expect(page.locator("#ravenContextPanel")).toContainText("Confirms");
  await expect(page.locator("#ravenContextPanel")).toContainText("Weakens");
  await expect(page.locator("#ravenContextPanel")).toContainText(/post-decision path evidence is missing|management path is not validated|path capture forming|path backed observations available|management path\s*under review/i);
  await expect(page.locator("#behaviorContextPanel")).toBeVisible();
  await expect(page.locator("#behaviorContextPanel")).toContainText("Behavior");
  await expect(page.locator(".intel > .score")).toBeHidden();
  await expect(page.locator(".intel > .intel-row").first()).toBeHidden();
  await expect(page.locator("#explanationPanel")).toBeHidden();

  await page.evaluate(() => document.querySelector('button[data-mobile-tab="news"]')?.click());
  await expect(page.locator(".mobile-news-panel")).toBeVisible();
  await expect(page.locator(".mobile-news-panel")).toContainText("Journal");
  await expect(page.locator(".mobile-news-panel")).toContainText(/Timeline forming|path observations|outcome events/i);
  await expect(page.locator(".mobile-news-panel")).toContainText(/Open Replay|Open Outcomes/);
  const newsBox = await page.locator(".mobile-news-panel").boundingBox();
  expect(newsBox.height).toBeLessThanOrEqual(220);

  const bodyText = await visibleBodyText(page);
  expect(bodyText).not.toMatch(/execute now|submit order|place order|buy now|sell now|long now|short now|one-click trade|guaranteed|autonomous trading/i);
});

test("mobile indicators are functional only on provider-backed candle sets", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enableLightweightChartSpike(page);
  await mockTerminalChartApi(page);

  await page.goto("/terminal/");
  await waitForChartContext(page, { asset: "SOL-PERP", timeframe: "1h" });
  await page.selectOption("#timeframeSelect", "15m");
  await waitForChartContext(page, { asset: "SOL-PERP", timeframe: "15m" });

  await page.locator("#indicatorMenuToggle").click();
  await expect(page.locator("#indicatorToolbar")).toBeVisible();
  await page.locator('[data-indicator="ema20"]').click();
  await expect(page.locator('[data-indicator="ema20"]')).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => page.evaluate(() => window.__RAVENOS_LAST_INDICATOR_STATE__?.ema20?.points || 0)).toBeGreaterThan(0);
  await expect(page.locator("#indicatorStateLabel")).toContainText("EMA 20");

  await page.locator('[data-indicator="ema50"]').click();
  await expect(page.locator('[data-indicator="ema50"]')).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => page.evaluate(() => window.__RAVENOS_LAST_INDICATOR_STATE__?.ema50?.points || 0)).toBeGreaterThan(0);

  await page.locator('[data-indicator="vwap"]').click();
  await expect(page.locator('[data-indicator="vwap"]')).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => page.evaluate(() => window.__RAVENOS_LAST_INDICATOR_STATE__?.vwap?.points || 0)).toBeGreaterThan(0);
  await expect(page.locator("#indicatorStateLabel")).toContainText("Provider-backed");

  await expect(page.locator(".indicator-toggle", { hasText: "RSI" })).toBeDisabled();
  await expect(page.locator(".indicator-toggle", { hasText: "MACD" })).toBeDisabled();
});

test("mobile market search finds known lookup rows and preserves spot routing", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/dexscreener/search**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [{
          symbol: "Theo",
          quoteSymbol: "SOL",
          name: "Theo",
          chainId: "solana",
          dexId: "raydium",
          liquidityUsd: 42000,
          volume24h: 18000,
          priceUsd: 0.000053,
          txns24h: 84,
          priceChange24h: 6.4,
          pairAddress: "theo-sol-pair",
          tokenAddress: "theo-token",
          marketCap: 53000,
          fdv: 53000,
          lastUpdated: new Date().toISOString(),
        }],
      }),
    });
  });

  await page.goto("/terminal/");
  await waitForChartContext(page, { asset: "SOL-PERP" });
  await page.evaluate(async () => {
    await window.runDexSearch("theo", "dexSearchResultsPanel");
    document.querySelector("#dexSearchResultsPanel [data-dex-index='0']")?.click();
  });
  await waitForChartContext(page, { asset: "Theo/SOL" });
  await page.locator("#mobileSymbolButton").click();
  await page.locator("#mobileMarketSearch").fill("Theo");
  await expect(page.locator('#mobileMarketSheet button[data-mobile-asset="Theo/SOL"]').first()).toBeVisible();
  await page.locator('#mobileMarketSheet button[data-mobile-asset="Theo/SOL"]').first().click();
  await expect(page.locator("#mobileMarketSheet")).not.toHaveClass(/active/);
  await waitForChartContext(page, { asset: "Theo/SOL" });
  await expect(page.locator("#chartTitle")).toContainText("Theo/SOL · Solana Spot");
  await expect(page.locator("#mobilePrimaryTradeButton")).toContainText("Buy");
  await expect(page.locator("#ticketPrimarySide")).toHaveText("Buy");
  await expect(page.locator("#executionReviewTicket")).toContainText("Solana wallet");
  await expect(page.locator("#executionReviewTicket")).not.toContainText("Hyperliquid account");
});

test("mobile market search resolves metadata-backed retire spot row from shared public lookup", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const retireResult = {
    symbol: "retire",
    quoteSymbol: "SOL",
    name: "retire",
    chainId: "solana",
    dexId: "raydium",
    liquidityUsd: 446100,
    volume24h: 118000,
    priceUsd: 0.002662,
    txns24h: 312,
    priceChange24h: 4.2,
    pairAddress: "retire-sol-pair",
    tokenAddress: "retire-token",
    marketCap: 2660000,
    fdv: 2660000,
    lastUpdated: new Date().toISOString(),
  };
  await page.route("**/api/dexscreener/search**", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q") || "";
    const normalized = query.toLowerCase().replace(/[^a-z0-9]+/g, "");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: normalized.includes("retire") ? [retireResult] : [],
      }),
    });
  });

  await page.goto("/terminal/");
  await waitForChartContext(page, { asset: "SOL-PERP" });
  await page.locator("#mobileSymbolButton").click();
  for (const query of ["retire", "RETIRE", "retire/SOL", "retire sol"]) {
    await page.locator("#mobileMarketSearch").fill(query);
    await expect(page.locator('#mobileMarketSheet button[data-mobile-asset="retire/SOL"]').first()).toBeVisible();
    await expect(page.locator('#mobileMarketSheet button[data-mobile-asset="retire/SOL"]').first()).toContainText("$2.66M");
  }

  await page.locator('#mobileMarketSheet button[data-mobile-asset="retire/SOL"]').first().click();
  await expect(page.locator("#mobileMarketSheet")).not.toHaveClass(/active/);
  await waitForChartContext(page, { asset: "retire/SOL" });
  await expect(page.locator("#chartTitle")).toContainText("retire/SOL · Solana Spot");
  await expect(page.locator("#mobilePrimaryTradeButton")).toContainText("Buy");
  await expect(page.locator("#mobileSecondaryTradeButton")).toContainText("Sell");
  await expect(page.locator("#ticketPrimarySide")).toHaveText("Buy");
  await expect(page.locator("#executionReviewTicket")).toContainText("Solana wallet");
  await expect(page.locator("#executionReviewTicket")).not.toContainText("Hyperliquid account");
  const visibleSpotText = await visibleBodyText(page);
  expect(visibleSpotText).not.toMatch(/Builder fee|Leverage|Margin|Long|Short/);

  await page.locator("#mobileSymbolButton").click();
  await page.locator("#mobileMarketSearch").fill("SOL-PERP");
  await page.locator('#mobileMarketSheet button[data-mobile-asset="SOL-PERP"]').first().click();
  await waitForChartContext(page, { asset: "SOL-PERP" });
  await expect(page.locator("#chartTitle")).toContainText("SOL-PERP · Hyperliquid Perp");
  await expect(page.locator("#mobilePrimaryTradeButton")).toContainText("Long");
  await expect(page.locator("#executionReviewTicket")).toContainText("Hyperliquid");
});

test("primary navigation remains coherent across terminal-shell and report surfaces", async ({ page }) => {
  const terminalExpected = ["Terminal", "Opportunities", "Markets", "Wallets", "Replay", "Outcomes", "Perps", "Research"];
  const reportExpected = ["Brief", "Opportunity", "Terminal", "Atlas", "Replay", "Outcomes", "Memory", "Behavior", "Research", "Perps", "Docs", "FAQ", "Account"];
  const routes = ["/", "/terminal/", "/opportunity/", "/replay/", "/outcomes/", "/memory/", "/behavior/", "/research/", "/perps/", "/atlas/", "/docs/", "/faq/", "/account/"];

  for (const route of routes) {
    await page.goto(route);
    const usesTerminalShell = ["/", "/terminal/", "/perps/"].includes(route);
    const navText = await page.locator(usesTerminalShell ? ".ros-left-nav a" : "nav[aria-label='Primary navigation'] a").evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()).filter(Boolean));
    expect(navText).toEqual(usesTerminalShell ? terminalExpected : reportExpected);
    expect(navText).not.toContain("Claims");
    expect(navText).not.toContain("Solana");
    expect(navText).not.toContain("Base");
    expect(navText).not.toContain("Ethereum");
  }
});

test("public product pages retain rich artifact-backed data instead of visible shell/debug copy", async ({ page }) => {
  await mockHyperliquidPerps(page);
  await mockTerminalChartApi(page);
  await page.goto("/perps/");
  await expect(page.locator("#perpsChart canvas").first()).toBeVisible();
  await expect(page.locator("#perpsInstrumentTitle")).toHaveText("SOL-PERP");
  await expect(page.locator("#perpsMark")).not.toHaveText("--");
  await expect(page.locator("#perpsOracle")).not.toHaveText("--");
  await expect(page.locator(".perps-rail-section").first()).toContainText("Order book");
  await expect(page.locator("#perpsRavenRead")).toContainText("market structure");
  await expect(page.locator(".perps-lower")).toContainText("Forward evidence");
  await expect(page.locator(".perps-lower")).toContainText("Model and position overlays");
  let text = await visibleBodyText(page);
  expect(text).not.toMatch(/public evidence shell|UI build|artifact \d{4}-\d{2}-\d{2}/i);

  await page.goto("/outcomes/");
  await expect(page.locator("#routeStateStrip")).toContainText("Evidence observed");
  await expect(page.locator("#routeStateStrip")).toContainText("Reads under validation");
  await expect(page.locator("#routeStateStrip")).toContainText("Confirmed followthrough");
  await expect(page.locator("#routePrimaryPanel")).toContainText("Recent reads");
  await expect(page.locator("#routePrimaryPanel")).toContainText(/outcome loop is active|Live observations are not outcomes/);
  text = await visibleBodyText(page);
  expect(text).toMatch(/\b[1-9][0-9]{0,2},[0-9]{3}(?:,[0-9]{3})?\b/);
  expect(text).not.toMatch(/Usable observations/i);
  expect(text).not.toMatch(/public evidence shell|UI build|artifact \d{4}-\d{2}-\d{2}/i);

  await page.goto("/behavior/");
  await expect(page.locator("#routeStateStrip")).toContainText("Observed sample");
  await expect(page.locator("#routePrimaryPanel")).toContainText("Observed markets");
  text = await visibleBodyText(page);
  expect(text).not.toMatch(/public evidence shell|UI build/i);

  await page.goto("/atlas/");
  text = await visibleBodyText(page);
  expect(text).toContain("Regime map for RavenOS context");
  expect(text).toContain("Use Atlas as a regime router");
  expect(text).toContain("Terminal remains the active behavioral intelligence workstation");
  expect(text).toContain("Cross-market confirmation Not inferred yet");
  expect(text).not.toMatch(/public evidence shell|UI build|artifact \d{4}-\d{2}-\d{2}|debug|route generation/i);
});

test("exact Raven markers preserve chart layout without synthetic chart regions", async ({ page }) => {
  await mockHyperliquidPerps(page);
  await mockTerminalChartApi(page);
  await page.goto("/terminal/");
  await waitForChart(page);
  await expect.poll(async () => page.evaluate(() => (
    window.__RAVENOS_LAST_RAVEN_READS__ || []
  ).some((read) => read.mode === "pressure"))).toBe(true);

  const chartBoxBefore = await page.locator("#flowChart").boundingBox();
  const leftRail = page.locator(".layout > .panel.nav");
  const chartPanel = page.locator(".layout > .panel.chart-panel");
  const rightRail = page.locator(".layout > .panel.intel");
  const tapePanel = page.locator(".layout > .panel.tape-panel");
  const flowTable = page.locator(".layout > .panel.table-panel");

  await expect(leftRail).toBeVisible();
  await expect(chartPanel).toBeVisible();
  await expect(rightRail).toBeVisible();
  await expect(tapePanel).toBeVisible();
  await expect(flowTable).toBeVisible();
  expect(chartBoxBefore).not.toBeNull();
  expect(chartBoxBefore.width).toBeGreaterThan(0);
  const chartPanelBox = await chartPanel.boundingBox();
  const rightRailBox = await rightRail.boundingBox();
  const tapePanelBox = await tapePanel.boundingBox();
  const flowTableBox = await flowTable.boundingBox();
  expect(chartPanelBox).not.toBeNull();
  expect(rightRailBox).not.toBeNull();
  expect(tapePanelBox).not.toBeNull();
  expect(flowTableBox).not.toBeNull();
  expect(chartBoxBefore.width).toBeGreaterThanOrEqual(700);
  expect(chartBoxBefore.height).toBeGreaterThanOrEqual(480);
  expect(flowTableBox.y).toBeGreaterThan(chartPanelBox.y + chartPanelBox.height - 2);
  expect(tapePanelBox.y).toBeGreaterThan(flowTableBox.y + flowTableBox.height - 2);
  expect(flowTableBox.height).toBeGreaterThan(240);
  await expect(page.locator(".trade-shell")).not.toHaveAttribute("open", "");

  await expect(page.locator("#flowChart .raven-overlay-region")).toHaveCount(0);
  await page.locator("#flowChart .raven-overlay-options button", { hasText: /^Pressure$/ }).click();
  await expect(page.locator("#flowChart [data-active-overlay='pressure']")).toBeVisible();
  await expect(page.locator("#flowChart .raven-overlay-region")).toHaveCount(0);
  await expect(page.locator("#ravenOverlayDetail")).toContainText("What Raven sees");
  await expect(page.locator("#ravenOverlayDetail")).toContainText("Confirms");
  await expect(page.locator("#ravenOverlayDetail")).toContainText("Weakens");
  await expect(page.locator("#ravenOverlayDetail")).toContainText("How to use it");
  await expect(page.locator("#ravenOverlayDetail")).toContainText(/pressure snapshot/i);

  const chartBoxAfter = await page.locator("#flowChart").boundingBox();
  expect(chartBoxAfter).not.toBeNull();
  expect(Math.round(chartBoxAfter.width)).toBe(Math.round(chartBoxBefore.width));
  expect(Math.round(chartBoxAfter.height)).toBe(Math.round(chartBoxBefore.height));

  await page.locator("#flowChart [data-clear-overlays='true']").click();
  await page.locator("#flowChart .raven-overlay-categories button", { hasText: "Structure" }).click();
  await expect(page.locator("#flowChart .raven-overlay-options button", { hasText: "Reaction zone" })).toBeDisabled();
});

test("grouped Raven overlay library uses trader-readable categories and active chips", async ({ page }) => {
  await mockHyperliquidPerps(page);
  await mockTerminalChartApi(page);
  await page.goto("/terminal/");
  await waitForChart(page);
  await expect.poll(async () => page.evaluate(() => (
    window.__RAVENOS_LAST_RAVEN_READS__ || []
  ).some((read) => read.mode === "pressure"))).toBe(true);

  const groups = await page.locator("#flowChart .raven-overlay-categories button").evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()));
  expect(groups).toEqual(["Flow", "Structure", "Participation", "Replay", "Risk", "Manage"]);
  await expect(page.locator("#flowChart .raven-overlay-options")).toContainText("Pressure");
  await expect(page.locator("#flowChart .raven-overlay-options")).toContainText("Needs provider-backed candles");
  await page.locator("#flowChart .raven-overlay-categories button", { hasText: "Participation" }).click();
  await expect(page.locator("#flowChart .raven-overlay-options")).toContainText("Actor cohorts");
  await page.locator("#flowChart .raven-overlay-categories button", { hasText: "Replay" }).click();
  await expect(page.locator("#flowChart .raven-overlay-options")).toContainText("Similar setups");
  await page.locator("#flowChart .raven-overlay-categories button", { hasText: "Risk" }).click();
  await expect(page.locator("#flowChart .raven-overlay-options")).toContainText("Thin liquidity");
  await page.locator("#flowChart .raven-overlay-categories button", { hasText: "Manage" }).click();
  await expect(page.locator("#flowChart .raven-overlay-options")).toContainText("Auto TP/SL template");
  await expect(page.locator("#flowChart .raven-overlay-region")).toHaveCount(0);
  const chartText = await page.locator("#flowChart").textContent();
  expect(chartText).not.toMatch(/Entry zone|Exit zone|Risk marker|Liquidity marker|participant cluster|Flow exhaustion|setup forming/i);
  await page.locator("#flowChart .raven-overlay-categories button", { hasText: "Flow" }).click();
  await page.locator("#flowChart .raven-overlay-options button", { hasText: /^Pressure$/ }).click();
  await expect(page.locator("#flowChart [data-active-overlay='pressure']")).toBeVisible();
  await expect(page.locator("#flowChart .raven-overlay-region")).toHaveCount(0);
  await page.locator("#flowChart [data-clear-overlays='true']").click();
  await expect(page.locator("#flowChart [data-active-overlay]")).toHaveCount(0);
  await expect(page.locator("#flowChart .raven-overlay-region")).toHaveCount(0);
});

test("chart indicators are separate from Raven overlays and expose safe states", async ({ page }) => {
  await mockTerminalChartApi(page);
  await page.goto("/terminal/");
  await waitForChart(page);

  const toolbar = page.locator("#indicatorToolbar");
  await expect(toolbar).toBeVisible();
  await expect(toolbar).toContainText("Indicators");
  await expect(toolbar.locator("button", { hasText: "EMA 20" })).toBeVisible();
  await expect(toolbar.locator("button", { hasText: "EMA 50" })).toBeVisible();
  await expect(toolbar.locator("button", { hasText: "VWAP" })).toBeVisible();
  await expect(toolbar.locator("button", { hasText: "RSI" })).toBeDisabled();
  await expect(toolbar.locator("button", { hasText: "MACD" })).toBeDisabled();

  const groups = await page.locator("#flowChart .raven-overlay-categories button").evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()));
  expect(groups).toEqual(expect.arrayContaining(["Flow", "Structure", "Participation", "Replay", "Risk", "Manage"]));
  await expect(page.locator("#flowChart .raven-overlay-options")).toContainText("Pressure");
  const overlayText = await page.locator("#flowChart .raven-overlay-library").textContent();
  expect(overlayText).not.toMatch(/EMA 20|MACD/);

  await toolbar.locator("button", { hasText: "EMA 20" }).click();
  await expect(toolbar.locator("button", { hasText: "EMA 20" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#indicatorStateLabel")).toContainText(/EMA 20.*Provider-backed/i);
  const indicatorState = await page.evaluate(() => window.__RAVENOS_LAST_INDICATOR_STATE__);
  expect(indicatorState).toBeTruthy();
  expect(indicatorState.sourceState).toBe("provider_backed");
  expect(indicatorState.ema20.status).toBe("provider_backed");
  expect(indicatorState.ema20.points).toBeGreaterThan(0);
});

test("pressure chip exposes only the current provider-backed Hyperliquid marker", async ({ page }) => {
  await mockHyperliquidPerps(page);
  await mockTerminalChartApi(page);
  await page.goto("/terminal/");
  await waitForChart(page);
  await expect.poll(async () => page.evaluate(() => (
    window.__RAVENOS_LAST_RAVEN_READS__ || []
  ).some((read) => read.mode === "pressure"))).toBe(true);
  await page.locator("#flowChart .raven-overlay-options button", { hasText: /^Pressure$/ }).click();
  await expect(page.locator("#flowChart [data-active-overlay='pressure']")).toBeVisible();
  await expect(page.locator("#flowChart .raven-overlay-region")).toHaveCount(0);
  await expect(page.locator("#ravenOverlayDetail")).toContainText("What Raven sees");
  await expect(page.locator("#ravenOverlayDetail")).toContainText("Confirms");
  await expect(page.locator("#ravenOverlayDetail")).toContainText("Weakens");
  await expect(page.locator("#ravenOverlayDetail")).toContainText(/Crowded pressure snapshot/i);
  const reads = await page.evaluate(() => window.__RAVENOS_LAST_RAVEN_READS__ || []);
  const pressureRead = reads.find((read) => read.mode === "pressure");
  expect(pressureRead.evidence[0].source).toContain("Hyperliquid");
  expect(pressureRead.summary).toContain("decision-time snapshot");
});

test("partial pressure evidence remains an explicitly partial current snapshot", async ({ page }) => {
  await mockHyperliquidPerps(page, {
    pressureScore: 84,
    pressureState: "Unknown",
    pressureContext: "Partial",
    funding: undefined,
    openInterest: undefined,
    oiScore: undefined,
    premium: undefined,
    basis: undefined,
    markPx: 150.22,
    oraclePx: 150.18,
  });
  await mockTerminalChartApi(page);
  await page.goto("/terminal/");
  await waitForChart(page);
  await expect.poll(async () => page.evaluate(() => (
    window.__RAVENOS_LAST_RAVEN_READS__ || []
  ).some((read) => read.mode === "pressure"))).toBe(true);
  const pressureRead = await page.evaluate(() => (
    window.__RAVENOS_LAST_RAVEN_READS__ || []
  ).find((read) => read.mode === "pressure"));
  expect(pressureRead.title).toBe("Current pressure snapshot");
  expect(pressureRead.confidence).toBe("partial");
  expect(pressureRead.summary).toContain("markPx, oraclePx");
  expect(pressureRead.summary).not.toMatch(/funding|openInterest/);
});

test("aggregate evidence without exact market-time lineage is excluded from chart reads", async ({ page }) => {
  await mockHyperliquidPerps(page);
  await mockTerminalChartApi(page);
  await mockRavenReadEvidence(page);
  await page.goto("/terminal/");
  await waitForChart(page);
  await expect.poll(async () => page.evaluate(() => (
    window.__RAVENOS_LAST_RAVEN_READS__ || []
  ).some((read) => read.mode === "pressure"))).toBe(true);
  const reads = await page.evaluate(() => window.__RAVENOS_LAST_RAVEN_READS__ || []);
  const pressureRead = reads.find((read) => read.mode === "pressure" && read.evidence?.some((evidence) => String(evidence.source || "").toLowerCase().includes("hyperliquid")));
  expect(pressureRead?.evidence?.[0]?.source.toLowerCase()).toContain("hyperliquid");
  expect(reads.map((read) => read.mode)).toEqual(["pressure"]);
  expect(JSON.stringify(reads)).not.toMatch(/ravenos_behavior_public|ravenos_replay_public|chart_structure/);
  expect(JSON.stringify(reads)).not.toMatch(/\bbuy\b|\bsell\b|long now|short now|guaranteed/i);
});

test("mobile overlay controls open as a bounded chart control without side scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/terminal/");
  await waitForChart(page);

  const chartInner = page.locator("#flowChart .raven-chart-host-inner");
  const legend = page.locator("#flowChart .raven-overlay-library");
  const categoryButtons = page.locator("#flowChart .raven-overlay-categories button");
  const optionButtons = page.locator("#flowChart .raven-overlay-options button");

  await expect(chartInner).toBeVisible();
  await expect(legend).toBeHidden();
  await page.locator("#flowChart [data-rpw-overlays]").click();
  await expect(legend).toBeVisible();
  await expect(categoryButtons.first()).toBeVisible();
  await expect(optionButtons.first()).toBeVisible();

  const chartBox = await chartInner.boundingBox();
  const legendBox = await legend.boundingBox();
  const firstButton = await categoryButtons.first().boundingBox();
  const optionButton = await optionButtons.first().boundingBox();
  expect(chartBox).not.toBeNull();
  expect(legendBox).not.toBeNull();
  expect(firstButton).not.toBeNull();
  expect(optionButton).not.toBeNull();

  expect(legendBox.y).toBeGreaterThanOrEqual(chartBox.y);
  expect(legendBox.y + legendBox.height).toBeLessThanOrEqual(chartBox.y + chartBox.height + 2);
  expect(legendBox.height).toBeLessThanOrEqual(190);
  expect(optionButton.y).toBeGreaterThanOrEqual(firstButton.y);
  expect(legendBox.width).toBeLessThanOrEqual(chartBox.width + 2);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});

test("changing SOL-PERP 1h to BTC-PERP 1h changes the rendered chart", async ({ page }) => {
  await page.goto("/terminal/");
  await waitForChart(page);
  const before = await chartHash(page);

  await page.selectOption("#assetSelect", "BTC-PERP");
  await waitForChartContext(page, { asset: "BTC-PERP", timeframe: "1h" });
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
  await waitForChartContext(page, { asset: "SOL-PERP", timeframe: "4h" });
  const after = await lastChartContext(page);

  expect(before.asset).toBe("SOL-PERP");
  expect(after.asset).toBe("SOL-PERP");
  expect(after.candleCount).toBeLessThan(before.candleCount);
  expect(after.timeframe).toBe("4h");
});

test("changing spot 1h to 4h changes rendered candle structure", async ({ page }) => {
  await page.goto("/terminal/");
  await waitForChart(page);

  await page.selectOption("#terminalModeSelect", "spot");
  await page.locator("#marketNav button", { hasText: "Large Caps" }).click();
  await page.selectOption("#assetSelect", "BTC");
  await page.selectOption("#timeframeSelect", "1h");
  await waitForChartContext(page, { asset: "BTC", timeframe: "1h" });
  const before = await lastChartContext(page);
  const beforeHash = await chartHash(page);

  await page.selectOption("#timeframeSelect", "4h");
  await waitForChartContext(page, { asset: "BTC", timeframe: "4h" });
  const after = await lastChartContext(page);
  const afterHash = await chartHash(page);

  expect(before.asset).toBe("BTC");
  expect(after.asset).toBe("BTC");
  expect(before.timeframe).toBe("1h");
  expect(after.timeframe).toBe("4h");
  expect(after.candleCount).toBeLessThan(before.candleCount);
  expect(after.chartSignature).not.toBe(before.chartSignature);
  expect(afterHash).not.toBe(beforeHash);
});

test("changing perps lane selection changes rendered chart, not just surrounding text", async ({ page }) => {
  await page.goto("/terminal/");
  await waitForChart(page);

  await page.selectOption("#terminalModeSelect", "perps");
  await page.locator("#marketNav button", { hasText: "Hyperliquid" }).click();
  await page.selectOption("#assetSelect", "SOL-PERP");
  await waitForChartContext(page, { asset: "SOL-PERP", timeframe: "1h" });
  const before = await lastChartContext(page);
  const beforeHash = await chartHash(page);

  await page.selectOption("#assetSelect", "BTC-PERP");
  await waitForChartContext(page, { asset: "BTC-PERP", timeframe: "1h" });
  const after = await lastChartContext(page);
  const afterHash = await chartHash(page);

  expect(before.asset).toBe("SOL-PERP");
  expect(after.asset).toBe("BTC-PERP");
  expect(after.chartSignature).not.toBe(before.chartSignature);
  expect(afterHash).not.toBe(beforeHash);
});

test("changing token selection changes rendered chart, not just surrounding text", async ({ page }) => {
  await page.goto("/terminal/");
  await waitForChart(page);

  await page.locator("#marketNav button", { hasText: "Large Caps" }).click();
  await page.selectOption("#assetSelect", "BTC");
  await waitForChartContext(page, { asset: "BTC", timeframe: "1h" });
  const before = await lastChartContext(page);
  const beforeHash = await chartHash(page);

  await page.selectOption("#assetSelect", "ETH");
  await waitForChartContext(page, { asset: "ETH", timeframe: "1h" });
  const after = await lastChartContext(page);
  const afterHash = await chartHash(page);

  expect(before.asset).toBe("BTC");
  expect(after.asset).toBe("ETH");
  expect(after.chartSignature).not.toBe(before.chartSignature);
  expect(afterHash).not.toBe(beforeHash);
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

test("restored terminal exposes provider coverage and freshness context", async ({ page }) => {
  await page.goto("/terminal/");
  await waitForChart(page);
  await expect(page.locator("#coverageBadge")).toBeVisible();
  await expect(page.locator("#providerSource")).toBeVisible();
  await expect(page.locator("#staleTimestamp")).toBeVisible();
  const context = await lastChartContext(page);
  expect(context).toHaveProperty("freshnessState");
  expect(context).toHaveProperty("sourceLabel");
});

test("provider fallback is not mislabeled as live market data", async ({ page }) => {
  await page.goto("/terminal/");
  await waitForChart(page);
  await expect(page.locator("#coverageBadge")).not.toContainText("Live Market Data");
  await expect(page.locator("#providerSource")).not.toContainText("Alchemy");
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
  await expect(page.locator("#rosCapabilityStatus")).toContainText("Sign off");
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
