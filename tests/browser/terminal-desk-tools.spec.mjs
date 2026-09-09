import { test, expect } from "@playwright/test";
import {
  mockTerminalLiveApis,
  selectUniversalInstrument,
  waitForTerminalLive,
} from "./terminal-live-fixtures.mjs";
async function workspace(page) {
  if (!(await page.locator("#deskWorkspaceMenu").evaluate((n) => n.open)))
    await page.locator("#deskWorkspaceMenu > summary").click();
}
test("linked comparison follows selection and independent comparison cannot change the primary market", async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/?market_scope=perps");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  await workspace(page);
  await page.locator("#deskSplit").check();
  await expect(
    page.locator("#deskComparisonChart canvas").first(),
  ).toBeVisible();
  await page.locator("#deskFrame").selectOption("4h");
  await page.keyboard.press("Escape");
  await selectUniversalInstrument(page, "BTC-PERP");
  await waitForTerminalLive(page, { instrument: "BTC-PERP" });
  await expect(
    page.locator(".desk-comparison > header > strong"),
  ).toContainText("BTC-PERP");
  await workspace(page);
  await page.locator("#deskLinked").uncheck();
  await page
    .locator("#deskComparisonMarket")
    .selectOption("hyperliquid:perp:SOL-PERP");
  await page.keyboard.press("Escape");
  await expect(
    page.locator(".desk-comparison > header > strong"),
  ).toContainText("SOL-PERP");
  await expect(page.locator("#terminalPickerSymbol")).toHaveText("BTC-PERP");
  await expect(page.locator("#terminalChart canvas").first()).toBeVisible();
  await page.locator('[data-terminal-pane-button="raven"]').click();
  await expect(page.locator(".desk-research-brief")).toBeVisible();
  await page.locator(".desk-brief-disclosure > summary").click();
  await expect(page.locator(".desk-research-brief")).toContainText(
    "Checks and conflicts",
  );
  await page.screenshot({
    path: testInfo.outputPath("linked-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.locator("#deskComparisonChart canvas").first(),
  ).toBeVisible();
  await expect(
    page.locator(".desk-comparison > header > strong"),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("linked-mobile.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("named lists filter markets, quote rows populate, and saved workspaces restore without persisting account data", async ({
  page,
}) => {
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/?market_scope=perps");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  await selectUniversalInstrument(page, "BTC-PERP");
  await waitForTerminalLive(page, { instrument: "BTC-PERP" });
  await page.locator(".desk-list-controls summary").click();
  await page.locator("#deskListName").fill("Majors");
  await page.locator("#deskCreateList").click();
  await expect(page.locator(".desk-market-row")).toHaveCount(1);
  await page.locator("#deskList").getByRole("button", {name:"All markets",exact:true}).click();
  await expect(page.locator(".desk-market-row")).toHaveCount(2);
  await expect(page.locator(".desk-market-quote strong").first()).toBeVisible();
  await workspace(page);
  await page.locator("#deskSplit").check();
  await page.locator("#deskWorkspaceName").fill("Morning");
  await page.locator("#deskSaveWorkspace").click();
  await page.locator("#deskSplit").uncheck();
  await page.locator("#deskSavedWorkspace").selectOption("0");
  await expect(page.locator("#deskSplit")).toBeChecked();
  await page.reload();
  await waitForTerminalLive(page, { instrument: "BTC-PERP" });
  await workspace(page);
  await expect(page.locator("#deskSplit")).toBeChecked();
  await expect(page.locator("#deskSavedWorkspace option")).toHaveCount(2);
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("ravenos.terminal.tools.v1")),
  );
  expect(stored.lists[0].name).toBe("Majors");
  expect(JSON.stringify(stored)).not.toMatch(
    /"(?:wallet|account|order|balance|price|candles)"/i,
  );
});
test("comparison failure does not replace primary evidence and refresh recovers", async ({
  page,
}) => {
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/?market_scope=perps");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  await page.route("**/api/terminal/chart?**", (route) =>
    new URL(route.request().url()).searchParams.get("timeframe") === "4h"
      ? route.fulfill({
          status: 503,
          json: { ok: false, error: "provider_unavailable" },
        })
      : route.fallback(),
  );
  await workspace(page);
  await page.locator("#deskSplit").check();
  await page.keyboard.press("Escape");
  await expect(
    page.locator("#deskComparisonChart [data-rpw-state-panel]"),
  ).toBeVisible();
  await expect(page.locator("#terminalChart canvas").first()).toBeVisible();
  await expect(page.locator(".desk-feed-status")).toBeHidden();
  await page.unroute("**/api/terminal/chart?**");
  await mockTerminalLiveApis(page);
  await page.locator("#deskRetryComparison").click();
  await expect(
    page.locator("#deskComparisonChart canvas").first(),
  ).toBeVisible();
});
test("loading state never presents a provider failure before the initial response", async ({
  page,
}) => {
  await mockTerminalLiveApis(page);
  let resolve;
  const pending = new Promise((r) => (resolve = r));
  await page.route("**/api/trade/flags", async (route) => {
    await pending;
    await route.fallback();
  });
  await page.goto("/terminal/?market_scope=perps");
  await expect(page.locator("#terminalChart [data-rpw-state]")).toHaveText(
    "Loading",
  );
  await expect(page.locator(".desk-feed-status")).toContainText("Loading");
  resolve();
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  await expect(page.locator(".desk-feed-status")).toBeHidden();
});

test("market directory failure ends the loading state and provides recovery", async ({
  page,
}) => {
  await mockTerminalLiveApis(page);
  await page.route("**/api/hyperliquid/perps", (route) =>
    route.fulfill({ status: 503, json: { ok: false } }),
  );
  await page.goto("/terminal/?market_scope=perps");
  await expect(page.locator(".desk-feed-status")).toContainText(
    "Market connection failed",
  );
  await expect(page.locator(".desk-feed-status button")).toHaveText(
    "Reload desk",
  );
  await expect(page.locator("#terminalChart [data-rpw-state]")).not.toHaveText(
    "Loading",
  );
});

test('mobile market lists use visible buttons and omit the empty All markets menu', async ({page},testInfo) => {
  await page.setViewportSize({width:390,height:664});
  await mockTerminalLiveApis(page);
  await page.goto('/terminal/?market_scope=perps');
  await waitForTerminalLive(page,{instrument:'SOL-PERP'});
  await page.getByRole('button',{name:'☷ Markets',exact:true}).click();
  await expect(page.locator('#deskList button')).toHaveCount(0);
  await expect(page.locator('.desk-list-controls select')).toHaveCount(0);
  await page.locator('#deskSort').getByRole('button',{name:'Name',exact:true}).click();
  await expect(page.locator('[data-desk-sort="name"]')).toHaveAttribute('aria-pressed','true');
  await page.locator('.desk-list-controls summary').click();
  await page.locator('#deskListName').fill('My markets');
  await page.locator('#deskCreateList').click();
  await expect(page.locator('#deskList').getByRole('button',{name:'My markets',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.locator('#deskList').getByRole('button',{name:'All markets',exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('market-list-buttons.png')});
});
