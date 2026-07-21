import { test, expect } from "@playwright/test";
import { mockTerminalLiveApis, waitForTerminalLive } from "./terminal-live-fixtures.mjs";

async function waitForTerminal(page) {
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
}

test("desktop shell wraps the Terminal without replacing the analytical workspace", async ({ page }) => {
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminal(page);

  await expect(page.locator(".ros-topbar")).toBeVisible();
  await expect(page.locator(".ros-left-nav")).toBeVisible();
  await expect(page.locator("#terminalChart canvas").first()).toBeVisible();
  await expect(page.locator(".terminal-live")).toBeVisible();
  await expect(page.locator("#terminalInstrument")).toHaveText("SOL-PERP");
  await expect(page.locator(".terminal-continuity")).toContainText("Customer session");
  await expect(page.locator(".terminal-continuity")).toContainText("Not configured");
  await expect(page.locator("#rosContextSubject")).toHaveText("SOL-PERP");
  const dataState = ((await page.locator("#rosFreshness strong").textContent()) || "").trim();
  expect(["Live", "Delayed", "Data unavailable"]).toContain(dataState);
  if (dataState === "Live") await expect(page.locator("#rosFreshness time")).toContainText("UTC");

  await page.keyboard.press("Control+K");
  await expect(page.locator("#rosCommandPalette")).toBeVisible();
  await page.locator("#rosCommandInput").fill("Replay");
  await expect(page.locator("#rosCommandResults")).toContainText("Open Replay");
  await page.keyboard.press("Escape");
});

test("selected market context survives navigation into an investigative route", async ({ page }) => {
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminal(page);
  await page.selectOption("#assetSelect", "BTC-PERP");
  await expect(page.locator("#rosContextSubject")).toHaveText("BTC-PERP");
  await page.selectOption("#timeframeSelect", "4h");
  await expect(page.locator("#rosTimeframe")).toHaveValue("4h");
  await page.locator('.ros-left-nav a[href^="/opportunity/"]').click();
  await expect(page).toHaveURL(/\/opportunity\/.*asset=BTC-PERP/);
  await expect(page.locator("#rosContextSubject")).toHaveText("BTC-PERP");
  await expect(page.locator("#rosTimeframe")).toHaveValue("4h");
});

test("old narrator timestamps are exposed as delayed rather than live", async ({ page }) => {
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
  await page.locator("#rosContextTrigger").click();
  await expect(page.locator("#rosContextRail")).toBeVisible();
  await expect(page.locator("#rosContextRail")).toContainText("SOL-PERP");
  await expect(page.locator("#rosContextRail")).toContainText("Confirmation");

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
  await expect(page.locator(".ros-mobile-nav")).toContainText("Brief");
  await expect(page.locator(".ros-mobile-nav")).toContainText("Opportunities");
  await expect(page.locator(".ros-mobile-nav")).toContainText("Perps");
  await expect(page.locator(".ros-mobile-nav")).toContainText("Terminal");
  await expect(page.locator(".ros-mobile-nav")).toContainText("Outcomes");
  await page.locator("#rosContextTrigger").click();
  await expect(page.locator("#rosContextRail")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});
