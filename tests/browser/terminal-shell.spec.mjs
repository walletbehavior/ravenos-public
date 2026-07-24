import { test, expect } from "@playwright/test";
import { mockTerminalLiveApis, selectUniversalInstrument, waitForTerminalLive } from "./terminal-live-fixtures.mjs";

async function waitForTerminal(page) {
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
}

test("desktop shell wraps the Terminal without replacing the analytical workspace", async ({ page }) => {
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminal(page);

  await expect(page.locator(".ros-topbar")).toBeVisible();
  await expect(page.locator(".ros-workspace-nav")).toBeVisible();
  await expect(page.locator(".ros-left-nav, .ros-activity-strip, .ros-capability-status")).toHaveCount(0);
  await expect(page.locator("#terminalChart canvas").first()).toBeVisible();
  await expect(page.locator(".terminal-live")).toBeVisible();
  await expect(page.locator("#terminalInstrument")).toHaveText("SOL-PERP");
  await expect(page.locator(".terminal-state-pair")).toContainText(/Market.*Raven/s);
  await expect(page.locator(".terminal-continuity")).toHaveCount(0);
  await expect(page.locator("#rosContextSubject")).toHaveText("SOL-PERP");
  const dataState = ((await page.locator("#rosFreshness strong").textContent()) || "").trim();
  expect(["Live", "Delayed", "Data unavailable", "Raven read"]).toContain(dataState);
  if (dataState === "Live") await expect(page.locator("#rosFreshness time")).toContainText("UTC");

  await page.keyboard.press("Control+K");
  await expect(page.locator("#rosCommandPalette")).toBeVisible();
  await page.locator("#rosCommandInput").fill("Replay");
  await expect(page.locator(".ros-command-result.route")).toHaveCount(0);
  await expect(page.locator(".ros-command-result:not(.instrument)")).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("legacy Journal actions cannot escape the Terminal into old RavenOS pages", async ({ page }) => {
  await mockTerminalLiveApis(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/terminal/");
  await waitForTerminal(page);
  await expect(page.getByText("Journal", { exact: true })).toHaveCount(0);
  await expect(page.locator('.terminal-live a[href^="/replay"], .terminal-live a[href^="/outcomes"]')).toHaveCount(0);
  await expect(page.locator(".ros-mobile-nav a")).toHaveCount(4);
  await expect(page.locator(".ros-mobile-nav")).toContainText(/Discover.*Terminal.*Portfolio.*Atlas/s);
});

test("selected market context survives navigation into an investigative route", async ({ page }) => {
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminal(page);
  await selectUniversalInstrument(page, "BTC-PERP");
  await expect(page.locator("#rosContextSubject")).toHaveText("BTC-PERP");
  await page.selectOption("#timeframeSelect", "4h");
  await waitForTerminalLive(page, { instrument: "BTC-PERP", timeframe: "4h" });
  await expect.poll(() => page.evaluate(() => window.RavenOSContext.getState().timeframe)).toBe("4h");
  await page.locator('.ros-workspace-nav a[data-ros-nav="discover"]').click();
  await expect(page).toHaveURL(/\/discover\/.*asset=BTC-PERP.*timeframe=4h/);
  await expect(page.locator("#rosContextSubject")).toHaveText("BTC-PERP");
  await expect.poll(() => page.evaluate(() => window.RavenOSContext.getState().timeframe)).toBe("4h");
});

test("an old current-projection timestamp is exposed as delayed rather than live", async ({ page }) => {
  const generatedAt = "2026-07-20T00:00:00Z";
  await page.route("**/api/opportunity", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      schema_version: "ravenos.opportunity_workspace.v2",
      census: {
        schema_version: "ravenos_opportunity_census_public_v1",
        generated_at: generatedAt,
        source_state: "current",
        population: { decision_observations: 1, tracked_paths: 1, matured_path_windows: 0, paths_with_evidence: 0 },
        opportunities: { rows: [] },
        limitations: [],
      },
      current_opportunity: null,
      delivery: {
        source: "current_public_origin",
        source_generated_at: generatedAt,
        freshness_state: "fresh",
        fallback: false,
      },
    }),
  }));
  await page.goto("/opportunity/");
  await expect(page.locator(".ros-topbar")).toBeVisible();
  await expect.poll(async () => (await page.locator("#rosFreshness strong").textContent())?.trim()).toBe("Delayed");
  await expect(page.locator("#rosFreshness time")).toContainText("UTC");
});

test("mobile preserves terminal depth, context access, and narrow-screen containment", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminal(page);

  await expect(page.locator(".ros-topbar")).toBeVisible();
  await expect(page.locator(".ros-mobile-nav")).toBeVisible();
  await expect(page.locator("#terminalChart canvas").first()).toBeVisible();
  await expect(page.locator("body")).not.toHaveClass(/ros-context-open/);
  await expect(page.locator("#rosContextRail")).toBeHidden();
  await expect(page.locator("#rosUtilityDrawer")).toBeHidden();
  await expect(page.locator("#rosContextTrigger span")).toBeHidden();
  await page.locator("#rosContextTrigger").click();
  await expect(page.locator("#rosContextRail")).toBeVisible();
  await expect(page.locator("#rosContextRail")).toContainText("SOL-PERP");
  await expect(page.locator("#rosContextRail")).toContainText("Path");
  await expect(page.locator("#rosContextRail")).toContainText("Evidence");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  const topbar = await page.locator(".ros-topbar").boundingBox();
  const bottomNav = await page.locator(".ros-mobile-nav").boundingBox();
  expect(topbar.y).toBe(0);
  expect(bottomNav.y + bottomNav.height).toBeLessThanOrEqual(845);
});

test("generated routes use the mobile primary navigation and context sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/outcomes/");
  await expect(page.locator(".ros-mobile-nav")).toBeVisible();
  await expect(page.locator(".ros-mobile-nav > *")).toHaveText(["DDiscover", "TTerminal", "PPortfolio", "AAtlas"]);
  await expect(page.locator("#rosContextRail")).toBeHidden();
  await expect(page.locator("#rosUtilityDrawer")).toBeHidden();
  await expect(page.locator("#rosContextTrigger")).toBeHidden();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});
