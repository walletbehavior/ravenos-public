import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";

import {
  HYPERLIQUID_ACCOUNT_ADDRESS,
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
  await expect(page.locator("#terminalInstrumentMeta")).toContainText("Hyperliquid perpetual");
  await expect(page.locator("#terminalPickerMeta")).toHaveAttribute("title", "hyperliquid:perp:SOL");
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
  await expect(page.locator("#terminalAlphaSection")).toBeVisible();
  await expect(page.locator("#terminalAlphaSection")).toContainText("Chart and plan");
  await expect(page.locator("#terminalAlphaStack")).not.toContainText("Raven read");
  await expect(page.locator("#terminalAlphaStack")).toContainText("Trade path");
  await expect(page.locator("#terminalAlphaStack")).not.toContainText(/unknown|unavailable|missing/i);
  await expect(page.locator("#terminalPlanToggle")).not.toBeChecked();
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_CHART_GEOMETRY__?.available_overlay_count)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_CHART_GEOMETRY__?.active_overlay_count)).toBe(0);
  await page.locator("#terminalPlanToggle").check();
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_CHART_GEOMETRY__?.available_overlay_count)).toBe(3);
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_CHART_GEOMETRY__?.active_overlay_count)).toBe(3);
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_CHART_GEOMETRY__?.active_overlay_types || [])).toEqual(["plan-entry", "plan-target", "plan-risk"]);
  await expect(page.locator("#terminalEvidenceState")).toHaveText("Current observation");
  await expect(page.locator("#terminalAnatomy1Label")).toHaveText("Open interest");
  await expect(page.locator("#terminalAnatomy1")).toContainText("192M");
  await expect(page.locator("#terminalAnatomyEyebrow")).toHaveText("Market structure");
  await expect(page.locator("#terminalAnatomyTitle")).toHaveText("Depth, positioning, and venue conditions");
  await expect(page.locator("#terminalAnatomyState")).toContainText("current market");
  await expect(page.locator("#terminalAnatomy4")).toContainText("2.66 bps");
  await expect(page.locator("#terminalMarketRail")).toBeVisible();
  await expect(page.locator("#terminalBook .terminal-book-row")).toHaveCount(8);
  await expect(page.locator("#terminalBookState")).toContainText("4 × 4");
  await expect(page.locator("#terminalBookBidShare")).toContainText("Bid 56%");
  await expect(page.locator("#terminalTape .terminal-tape-row")).toHaveCount(4);
  await expect(page.locator("#terminalTapeState")).toHaveText("4 public trades");
  await expect(page.locator("#terminalMarketRail")).not.toContainText(/unknown|unavailable|missing/i);
  await expect(page.locator("#terminalTradeReviewSection")).toBeVisible();
  await expect.poll(() => page.locator("#terminalTradeReviewSection").evaluate((node) => getComputedStyle(node).order)).toBe("1");
  await expect(page.locator("#terminalFingerprint")).toHaveText("hyperliquid:perp:SOL");
  await page.locator("#terminalSourceDetail > summary").click();
  await expect(page.locator("#terminalSourceProvider")).toHaveText("Hyperliquid");
  await expect(page.locator("#terminalSourceInterval")).toContainText("Direct 1h bars");
  await expect(page.getByRole("link", { name: /Lightweight Charts.*TradingView/i })).toBeVisible();
  await page.getByRole("button", { name: "Inspect Behavioral setup" }).click();
  await expect(page.locator("#terminalChartMarkerInspector")).toBeVisible();
  await expect(page.locator("#terminalChartMarkerSource")).toContainText("Timestamped Raven observation");
  await expect(page.getByRole("button", { name: "Inspect Behavioral setup" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#terminalMarkerDetail")).toBeVisible();
  await expect(page.locator("#terminalMarkerSource")).toContainText("Timestamped Raven observation");
  await expect(page.locator("#terminalMarkerMaturity")).toHaveText("Matured");
  await expect(page.locator("#terminalMarkerSupport")).toContainText("Pressure broadens");
  await page.locator("#terminalMarkerClose").click();
  await expect(page.locator("#terminalMarkerDetail")).toBeHidden();
  await expect(page.locator("#terminalChartMarkerInspector")).toBeHidden();
  await expect(page.locator(".ros-capability-status, .terminal-continuity")).toHaveCount(0);
  await expect(page.locator("#terminalBoundary")).toContainText("No order can be signed or sent");
  await expect(page.locator("#assetSelect option")).toHaveCount(2);
  await expect(page.locator("#terminalModeSelect")).toBeHidden();
  await expect(page.locator("#terminalModeSelect option")).toHaveCount(3);
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_CHART_GEOMETRY__?.marker_count)).toBe(1);

  const state = await page.evaluate(() => window.__RAVENOS_TERMINAL__.getState());
  expect(state.instrumentId).toContain("hyperliquid");
  expect(state.candleCount).toBeGreaterThan(20);
  expect(state.bookLevels).toBe(4);
  expect(state.tapeCount).toBe(4);
  expect(state.signingAvailable).toBe(false);
  expect(state.submissionAvailable).toBe(false);
});

test("an exact Discover Raven observation survives a missing generic context join", async ({ page }) => {
  await mockTerminalLiveApis(page);
  await page.route("**/api/perps/instrument**", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ ok: false, error: "context_refreshing" }),
  }));
  await page.route("**/api/opportunity**", (route) => {
    const requested = new URL(route.request().url()).searchParams.get("instrument_id");
    const row = requested === "hyperliquid:perp:SOL" ? {
      public_opportunity_id: "rop-sol-exact-continuity",
      instrument_id: "hyperliquid:perp:SOL",
      instrument: "SOL-PERP",
      context_state: "fresh",
      why_raven_noticed: "Pressure reaccelerated while exact-market depth remained usable.",
      pressure_state: "Upside pressure",
      observed_direction: "long",
      context_age_seconds: 75,
      path_review: { state: "Await the next pressure checkpoint" },
      matured_comparables: { sample_size: 41, evidence_maturity: "developing", median_observed_change_pct: 1.2, median_favorable_excursion_pct: 2.4, median_adverse_excursion_pct: -0.8 },
      research_only: true,
      execution_available: false,
    } : null;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        schema_version: "ravenos.opportunity_workspace.v2",
        generated_at: new Date().toISOString(),
        selected_opportunity: row,
        selection: { requested: true, state: row ? "matched" : "not_present", silently_replaced: false },
        selected_discovery_market: null,
        discovery_selection: { requested: true, state: "not_present", silently_replaced: false },
        census: { discovery_radar: { rows: [] } },
        delivery: { source: "current_public_origin", freshness_state: "fresh", fallback: false },
      }),
    });
  });
  await page.goto("/terminal/?asset=SOL-PERP&instrument_id=hyperliquid%3Aperp%3ASOL&launch=raven");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  await expect(page.locator("#terminalContextSection")).toBeVisible();
  await expect(page.locator("#terminalWhy")).toContainText("Pressure reaccelerated");
  await expect(page.locator("#terminalReadSummary")).toBeHidden();
  await expect(page.locator("#terminalEvidenceMaturity")).toHaveText("Developing");
  await expect(page.locator("#terminalEvidenceState")).toHaveText("Updated 1m ago");
  await expect(page.locator("#terminalEvidenceDetails")).toBeVisible();
  await expect(page.locator("#terminalEvidenceDetails")).not.toHaveAttribute("open", "");
  await page.locator("#terminalEvidenceDetails > summary").click();
  await expect(page.locator("#terminalDecisionReference")).toHaveText("rop-sol-exact-continuity");
  await expect(page.locator("#terminalDecisionCheckpoint")).toContainText("next pressure checkpoint");
  await expect(page.locator("#terminalPlanSection")).toBeHidden();
  const terminal = await page.evaluate(() => window.__RAVENOS_TERMINAL__.getState());
  expect(terminal.contextState).toBe("fresh");
  expect(terminal.signingAvailable).toBe(false);
  expect(terminal.submissionAvailable).toBe(false);
});

test("Terminal adds a real public account ledger and selected-market position context", async ({ page }) => {
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { lane: "perps", instrument: "SOL-PERP" });

  await expect(page.locator("#terminalAccountDock")).toBeVisible();
  await page.locator("#terminalAccountAddress").fill(HYPERLIQUID_ACCOUNT_ADDRESS);
  await page.getByRole("button", { name: "Load account" }).click();
  await expect(page.locator("#terminalAccountSummary")).toBeVisible();
  await expect(page.locator("#terminalAccountEquity")).toContainText("$12,500");
  await expect(page.locator("#terminalAccountMaintenance")).toContainText("$405");
  await expect(page.locator("#terminalAccountLeverage")).toContainText("0.64799×");
  await expect(page.locator('#terminalAccountLedger .terminal-account-grid[data-view="positions"] .terminal-account-row')).toHaveCount(2);
  await expect(page.locator("#terminalTicketAccount")).toBeVisible();
  await expect(page.locator("#terminalTicketPosition")).toContainText("Long 42.5");
  await expect(page.locator("#terminalTicketWithdrawable")).toContainText("$2,780");
  await expect(page.locator("#terminalAccountSizePresets")).toBeVisible();
  await expect(page.locator("#terminalAccountScenarioResult")).toBeVisible();
  await expect(page.locator("#terminalScenarioFee")).toContainText("taker");
  await expect(page.locator("#terminalScenarioCheck")).toContainText("passes");

  await page.locator('[data-account-tab="balances"]').click();
  await expect(page.locator('#terminalAccountLedger .terminal-account-grid[data-view="balances"] .terminal-account-row')).toHaveCount(2);
  await expect(page.locator("#terminalAccountLedger")).toContainText("HYPE");

  await page.locator('[data-account-tab="orders"]').click();
  await expect(page.locator('#terminalAccountLedger .terminal-account-grid[data-view="orders"] .terminal-account-row')).toHaveCount(1);
  await expect(page.locator("#terminalAccountLedger")).toContainText("Reduce only");
  await page.locator('[data-account-tab="history"]').click();
  await expect(page.locator('#terminalAccountLedger .terminal-account-grid[data-view="history"] .terminal-account-row')).toHaveCount(2);
  await expect(page.locator("#terminalAccountHistoryCount")).toHaveText("2");
  await page.locator('[data-account-tab="fills"]').click();
  await expect(page.locator('#terminalAccountLedger .terminal-account-grid[data-view="fills"] .terminal-account-row')).toHaveCount(2);
  await page.locator('[data-account-tab="funding"]').click();
  await expect(page.locator('#terminalAccountLedger .terminal-account-grid[data-view="funding"] .terminal-account-row')).toHaveCount(2);
  await expect(page.locator("#terminalAccountDock")).not.toContainText(/unknown|unavailable|missing/i);

  await page.locator('[data-account-size-pct="25"]').click();
  await expect(page.locator("#terminalPreviewNotional")).toHaveValue("3475.31");
  await page.locator('[data-account-tab="positions"]').click();
  await page.locator('.terminal-account-row').filter({ hasText: "SOL" }).getByRole("button", { name: "Review close" }).click();
  await expect(page.locator("#terminalPreviewShort")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#terminalPreviewReduceOnly")).toBeChecked();
  await expect(page.locator("#terminalScenarioEffect")).toContainText(/Reduce|Close/);
  await expect(page.locator("#terminalScenarioMargin")).toContainText("$0.00");
  const state = await page.evaluate(() => window.__RAVENOS_TERMINAL__.getState());
  expect(state.publicAccountObserved).toBe(true);
  expect(state.publicAccountPositionCount).toBe(2);
  expect(state.publicAccountBalanceCount).toBe(2);
  expect(state.publicAccountOrderCount).toBe(1);
  expect(state.accountHistoryCount).toBe(2);
  expect(state.accountScenarioState).toMatch(/account_scenario_(available|blocked)/);
  expect(state.walletVerified).toBe(false);
  expect(state.walletLinked).toBe(false);
  expect(state.signingAvailable).toBe(false);
  expect(state.submissionAvailable).toBe(false);
  expect(new URL(page.url()).searchParams.has("address")).toBe(false);
  expect(await page.evaluate((address) => Object.values(localStorage).some((value) => String(value).toLowerCase().includes(address.toLowerCase())), HYPERLIQUID_ACCOUNT_ADDRESS)).toBe(false);
});

test("Terminal connects and locally disconnects a browser-wallet address without requesting a signature or enabling execution", async ({ page }) => {
  await page.addInitScript((address) => {
    const listeners = new Map();
    globalThis.__emitTestWalletEvent = (event, payload) => {
      for (const listener of listeners.get(event) || []) listener(payload);
    };
    globalThis.ethereum = {
      request: async ({ method }) => method === "eth_requestAccounts" ? [address] : [],
      on: (event, listener) => listeners.set(event, [...(listeners.get(event) || []), listener]),
    };
  }, HYPERLIQUID_ACCOUNT_ADDRESS);
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { lane: "perps", instrument: "SOL-PERP" });

  await expect(page.locator("#terminalWalletConnect")).toBeVisible();
  await expect(page.locator("#terminalWalletConnect")).toHaveText("Connect wallet");
  await page.evaluate((address) => globalThis.__emitTestWalletEvent("accountsChanged", [address]), HYPERLIQUID_ACCOUNT_ADDRESS);
  await expect(page.locator("#terminalAccountAddress")).toHaveValue("");
  await page.locator("#terminalWalletConnect").click();
  await expect(page.locator("#terminalAccountAddress")).toHaveValue(HYPERLIQUID_ACCOUNT_ADDRESS);
  await expect(page.locator("#terminalAccountStatus")).toContainText("wallet connected · public Hyperliquid account loaded · no signature requested");
  await expect(page.locator("#terminalWalletConnect")).toHaveText("Disconnect view");
  await expect(page.locator("#terminalUseWallet")).toHaveText("Disconnect view");
  const state = await page.evaluate(() => window.__RAVENOS_TERMINAL__.getState());
  expect(state.walletTransportConnected).toBe(true);
  expect(state.walletAddressConnected).toBe(true);
  expect(state.walletVerified).toBe(false);
  expect(state.walletLinked).toBe(false);
  expect(state.signingAvailable).toBe(false);
  expect(state.submissionAvailable).toBe(false);
  expect(new URL(page.url()).searchParams.has("address")).toBe(false);
  expect(await page.evaluate((address) => Object.values(localStorage).some((value) => String(value).toLowerCase().includes(address.toLowerCase())), HYPERLIQUID_ACCOUNT_ADDRESS)).toBe(false);

  await page.locator("#terminalWalletConnect").click();
  await expect(page.locator("#terminalAccountAddress")).toHaveValue("");
  await expect(page.locator("#terminalWalletConnect")).toHaveText("Connect wallet");
  await expect(page.locator("#terminalAccountStatus")).toContainText("no wallet permission was retained");
  await expect(page.locator("#terminalAccountLedger")).toContainText("No signature, approval, or order permission is requested");
  const disconnected = await page.evaluate(() => window.__RAVENOS_TERMINAL__.getState());
  expect(disconnected.walletTransportConnected).toBe(false);
  expect(disconnected.walletAddressConnected).toBe(false);
  expect(disconnected.publicAccountObserved).toBe(false);
});

test("mobile Terminal uses focused Chart, Trade, Book, Raven, and Account panes without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { lane: "perps", instrument: "SOL-PERP" });

  await expect(page.locator('[data-terminal-pane-button="chart"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#terminalChart")).toBeVisible();
  await expect(page.locator("#terminalMarketRail")).toBeHidden();
  await expect(page.locator(".terminal-intelligence")).toBeHidden();

  await page.locator('[data-terminal-pane-button="book"]').click();
  await expect(page.locator("#terminalMarketRail")).toBeVisible();
  await expect(page.locator("#terminalBook .terminal-book-row")).toHaveCount(8);
  await expect(page.locator("#terminalTape .terminal-tape-row")).toHaveCount(4);
  await expect(page.locator("#terminalChart")).toBeHidden();

  await page.locator('[data-terminal-pane-button="trade"]').click();
  await expect(page.locator("#terminalTradeReviewSection")).toBeVisible();
  await expect(page.locator("#terminalAlphaSection")).toBeHidden();
  await expect(page.locator("#terminalPreviewResult")).toBeVisible();

  await page.locator('[data-terminal-pane-button="raven"]').click();
  await expect(page.locator("#terminalAlphaSection")).toBeVisible();
  await expect(page.locator("#terminalTradeReviewSection")).toBeHidden();

  await page.locator('[data-terminal-pane-button="account"]').click();
  await expect(page.locator("#terminalAccountDock")).toBeVisible();
  await expect(page.locator("#terminalChart")).toBeHidden();
  await expect(page.locator("#terminalMarketRail")).toBeHidden();
  await expect(page.locator(".terminal-intelligence")).toBeHidden();
  await page.locator("#terminalAccountAddress").fill(HYPERLIQUID_ACCOUNT_ADDRESS);
  await page.getByRole("button", { name: "Load account" }).click();
  await expect(page.locator("#terminalAccountSummary")).toBeVisible();
  await page.locator('[data-account-tab="history"]').click();
  await expect(page.locator('#terminalAccountLedger .terminal-account-grid[data-view="history"] .terminal-account-row')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test("mobile Raven plan actions atomically reveal the exact chart, preserve its viewport, and stay synchronized", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockTerminalLiveApis(page, { includeContextPressureOverlay: true });
  await page.goto("/terminal/?raven_overlays=pressure");
  await waitForTerminalLive(page, { lane: "perps", instrument: "SOL-PERP", timeframe: "1h" });
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_CHART_GEOMETRY__?.active_overlay_types || [])).toEqual(["pressure"]);
  const before = await page.evaluate(() => window.__RAVENOS_CHART_GEOMETRY__?.time_range);

  await page.locator('[data-terminal-pane-button="raven"]').click();
  const alphaToggle = page.locator('#terminalAlphaStack [data-raven-action="toggle-plan"]');
  await expect(alphaToggle).toHaveText("Show on chart");
  await alphaToggle.focus();
  await page.keyboard.press("Enter");

  await expect(page.locator(".terminal-live")).toHaveAttribute("data-terminal-pane", "chart");
  await expect(page.locator("#terminalChart")).toBeVisible();
  await expect(page.locator(".terminal-intelligence")).toBeHidden();
  await expect(page.locator("#terminalChartPlanStrip")).toBeVisible();
  await expect(page.locator("#terminalChartPlanSummary")).toHaveText("Entry + TP + Risk");
  await expect(page.locator("#terminalChartRavenLayerCount")).toHaveText("4 Raven layers active");
  await expect(page.locator("#terminalPlanToggle")).toBeChecked();
  await expect(alphaToggle).toHaveText("Hide from chart");
  await expect(alphaToggle).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_CHART_GEOMETRY__?.active_overlay_types || [])).toEqual([
    "pressure",
    "plan-entry",
    "plan-target",
    "plan-risk",
  ]);
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_CHART_GEOMETRY__?.time_range)).toEqual(before);

  await page.evaluate(() => {
    const toggle = document.getElementById("terminalPlanToggle");
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_CHART_GEOMETRY__?.active_overlay_count)).toBe(4);
  await expect(page.locator("#terminalChartRavenLayerCount")).toHaveText("4 Raven layers active");

  const monitorHref = await page.locator("#terminalMonitorLink").getAttribute("href");
  const monitorState = new URL(monitorHref);
  expect(monitorState.searchParams.get("raven_overlays")).toBe("pressure");
  expect(monitorHref).not.toMatch(/plan-entry|plan-target|plan-risk|148|152\.588|146\.224/);
  expect(page.url()).not.toMatch(/plan-entry|plan-target|plan-risk|152\.588|146\.224/);

  await page.locator("#terminalChartPlanInspect").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".terminal-live")).toHaveAttribute("data-terminal-pane", "raven");
  await expect(page.locator("#terminalPlanSection")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("terminalPlanSection");
  await page.locator('[data-terminal-pane-button="chart"]').click();
  await expect(page.locator("#terminalChartPlanStrip")).toBeVisible();

  await page.locator("#terminalChartPlanHide").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#terminalChartPlanStrip")).toBeHidden();
  await expect(page.locator("#terminalPlanToggle")).not.toBeChecked();
  await expect(alphaToggle).toHaveText("Show on chart");
  await expect(alphaToggle).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_CHART_GEOMETRY__?.active_overlay_types || [])).toEqual(["pressure"]);
  await expect(page.locator("#terminalRavenActionStatus")).toContainText("Other Raven chart layers were preserved");
});

test("mobile marker inspection remains visible on Chart and Full evidence focuses the Raven detail", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { lane: "perps", instrument: "SOL-PERP" });

  await page.locator("#terminalReadTrigger").click();
  await expect(page.locator(".terminal-live")).toHaveAttribute("data-terminal-pane", "raven");
  await expect(page.locator("body")).not.toHaveClass(/ros-context-open/);
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("terminalContextSection");

  await page.locator('[data-terminal-pane-button="chart"]').click();
  const marker = page.getByRole("button", { name: "Inspect Behavioral setup" });
  await marker.click();
  await expect(page.locator("#terminalChartMarkerInspector")).toBeVisible();
  await expect(page.locator("#terminalChartMarkerTitle")).toHaveText("Behavioral setup");
  await expect(page.locator("#terminalChartMarkerSource")).toContainText("Timestamped Raven observation");
  await expect(page.locator("#terminalChartMarkerMaturity")).toHaveText("Matured");
  await expect(page.locator("#terminalChartMarkerSupport")).toContainText("Pressure broadens");
  await expect(page.locator("#terminalChartMarkerContradiction")).toContainText("loses confirmation");
  await expect(marker).toHaveAttribute("aria-pressed", "true");

  await page.locator("#terminalChartMarkerEvidence").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".terminal-live")).toHaveAttribute("data-terminal-pane", "raven");
  await expect(page.locator("#terminalMarkerDetail")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("terminalMarkerDetail");

  await page.locator('[data-terminal-pane-button="chart"]').click();
  await expect(page.locator("#terminalChartMarkerInspector")).toBeVisible();
  await expect(marker).toHaveAttribute("aria-pressed", "true");
  await page.locator("#terminalChartMarkerClose").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#terminalChartMarkerInspector")).toBeHidden();
  await expect(marker).toHaveAttribute("aria-pressed", "false");
});

test("an exact-instrument plan mismatch fails closed without chart overlays", async ({ page }) => {
  await mockTerminalLiveApis(page, { perpPlanIdentityMismatch: true });
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { lane: "perps", instrument: "SOL-PERP" });
  await expect(page.locator("#terminalPlanSection")).toBeHidden();
  await expect(page.locator("#terminalAlphaStack")).not.toContainText("Trade path");
  await expect(page.locator("#terminalPlanToggle")).toBeDisabled();
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_CHART_GEOMETRY__?.active_overlay_count)).toBe(0);
  const state = await page.evaluate(() => window.__RAVENOS_TERMINAL__.getState());
  expect(state.planPreviewAvailable).toBe(false);
  expect(state.planQualificationIssue).toBe("exact_instrument_mismatch");
  expect(state.planOverlayEnabled).toBe(false);
});

test("stale Raven plan evidence fails closed while current market facts remain available", async ({ page }) => {
  await mockTerminalLiveApis(page, { stalePerpPlan: true });
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { lane: "perps", instrument: "SOL-PERP" });
  await expect(page.locator("#terminalChart canvas").first()).toBeVisible();
  await expect(page.locator("#terminalPlanSection")).toBeHidden();
  await expect(page.locator("#terminalChartPlanStrip")).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_CHART_GEOMETRY__?.active_overlay_count)).toBe(0);
  const state = await page.evaluate(() => window.__RAVENOS_TERMINAL__.getState());
  expect(state.planPreviewAvailable).toBe(false);
  expect(state.planQualificationIssue).toBe("evidence_not_current");
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
  await expect(page.locator("#terminalBoundary strong")).toHaveText("Trade preview available");
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
  const { calls } = await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { lane: "perps", instrument: "SOL-PERP", timeframe: "1h" });

  const chart = page.locator("#terminalChart .rpw");
  const timeframe = chart.locator("[data-rpw-timeframe-select]");
  await expect(timeframe.locator("option")).toHaveText(["1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M"]);
  await expect(timeframe).toHaveValue("1h");
  await expect(page.locator("#terminalTimeframeControl")).toBeHidden();
  await expect(chart.locator('[data-rpw-indicator="ema20"]')).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_LAST_INDICATOR_STATE__?.ema20?.points || 0)).toBeGreaterThan(20);
  await expect(chart.locator("[data-rpw-read-cell]")).toBeHidden();
  await expect(chart.locator("[data-rpw-read-cell]")).not.toContainText(/unknown|unavailable|missing/i);
  await expect(chart.locator("[data-rpw-window]")).toContainText(/1h Change.*1h Volume.*1h Range.*candles/is);
  await expect(chart.locator("[data-rpw-ranges], [data-rpw-timeframes], [data-rpw-range]")).toHaveCount(0);
  expect(calls.some((call) => call.market === "perpetuals" && call.timeframe === "1h" && call.limit === 720 && !call.before)).toBe(true);
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
  await expect(candleLegend).toContainText(/Latest.*UTC.*O.*H.*L.*C.*Change.*Base vol/s);
  await expect(candleLegend).not.toContainText("Quote vol");
  await expect(candleLegend).not.toContainText(/--|—/);

  await chart.locator("[data-rpw-indicator-trigger]").click();
  await expect(chart.locator("[data-rpw-indicators]")).toBeVisible();
  await chart.locator('[data-rpw-indicator="ema50"]').click();
  await expect(chart.locator('[data-rpw-indicator="ema50"]')).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_LAST_INDICATOR_STATE__?.ema50?.points || 0)).toBeGreaterThan(0);
  await chart.locator('[data-rpw-indicator="rsi14"]').click();
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_LAST_INDICATOR_STATE__?.rsi14?.points || 0)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_CHART_GEOMETRY__?.indicator_pane_count || 0)).toBe(1);
  await chart.locator("[data-rpw-indicator-trigger]").click();
  await expect(chart.locator("[data-rpw-indicators]")).toBeHidden();

  const canvas = chart.locator(".rpw-stage canvas").first();
  const bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * 0.55, bounds.y + bounds.height * 0.45);
  await expect(candleLegend).toHaveAttribute("data-mode", "inspect");
  await expect(candleLegend).toContainText(/Inspect.*UTC.*O.*H.*L.*C.*Change.*Base vol/s);
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
  await stage.scrollIntoViewIfNeeded();

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
  await expect(legend).toContainText(/Inspect.*UTC.*O.*H.*L.*C.*Change.*Base vol/s);

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

  await page.selectOption("#terminalChart [data-rpw-timeframe-select]", "4h");
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
    await expect(page.locator("#terminalInstrumentMeta")).toContainText("Hyperliquid perpetual");
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

test("spot search loads one exact pool and joins only its admitted current Raven context", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async writeText(value) {
          window.__RAVENOS_TEST_COPIED_CA__ = value;
        },
      },
    });
  });
  const { calls, holderCalls } = await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  await openExactSpotSearch(page, "JUP");
  await expect(page.locator("#terminalSpotControl")).toBeHidden();
  await expect(page.locator("#terminalPerpControl")).toBeHidden();
  await waitForTerminalLive(page, { lane: "spot", instrument: "JUP/USDC", timeframe: "1h" });

  await expect(page.locator("#terminalInstrumentScope")).toHaveText("Exact pool");
  await expect(page.locator("#terminalInstrument")).toHaveText("JUP/USDC");
  await expect(page.locator("#terminalInstrumentImage")).toBeVisible();
  await expect(page.locator("#terminalInstrumentImage")).toHaveAttribute("src", "https://assets.geckoterminal.com/token-fixture.png");
  await expect(page.locator("#terminalContextSection")).toBeVisible();
  await expect(page.locator("#terminalReadTrigger")).toBeVisible();
  await expect(page.locator("#terminalReadHeadline")).toHaveText("JUP · Reacceleration");
  await expect(page.locator("#terminalReadSummary")).toContainText("volume, buyers, and active traders expanded");
  await expect(page.locator("#terminalWhy")).toContainText("20m before broader attention");
  await expect(page.locator("#terminalWhyLabel")).toHaveText("Current read");
  await expect(page.locator("#terminalContextIdentity")).toHaveText("This exact pool");
  await expect(page.locator("#terminalEvidenceMaturity")).toHaveText("Developing");
  await expect(page.locator("#terminalDecisionSupport")).toBeVisible();
  await expect(page.locator("#terminalDecisionSupport")).toContainText("Confirms this read");
  await expect(page.locator("#terminalDecisionSupport")).toContainText("Breaks this read");
  await expect(page.locator("#terminalDecisionStrengthens")).toContainText("usable depth persist");
  await expect(page.locator("#terminalDecisionWeakens")).toContainText("Liquidity thins");
  await expect(page.locator("#terminalEvidenceDetails")).not.toHaveAttribute("open", "");
  await expect(page.locator("#terminalDecisionReference")).toBeHidden();
  await page.locator("#terminalEvidenceDetails > summary").click();
  await expect(page.locator("#terminalDecisionReference")).toHaveText("raven-spot-fixture");
  await expect(page.locator("#terminalDecisionReference")).toBeVisible();
  await expect(page.locator("#terminalMetric3Label")).toHaveText("Liquidity");
  await expect(page.locator("#terminalMetric3")).not.toHaveText("--");
  await expect(page.locator("#terminalAnatomy1Label")).toHaveText("Liquidity");
  await expect(page.locator("#terminalAnatomy1")).toContainText("4.2M");
  await expect(page.locator("#terminalAnatomy2Label")).toHaveText("Market cap");
  await expect(page.locator("#terminalAnatomy2")).toContainText("3.1B");
  await expect(page.locator("#terminalAnatomy3Label")).toHaveText("5m volume");
  await expect(page.locator("#terminalAnatomy3")).toContainText("140K");
  await expect(page.locator("#terminalAnatomy4Label")).toHaveText("5m flow");
  await expect(page.locator("#terminalAnatomy4")).toContainText("64 buy · 26 sell · 72 traders");
  await expect(page.locator("#terminalAnatomy5Label")).toHaveText("Holders");
  await expect(page.locator("#terminalAnatomy5")).toContainText("4.85K · 1h +6.40%");
  await expect.poll(() => holderCalls.length).toBe(1);
  await expect(page.locator("#terminalHolderMap")).toBeVisible();
  await expect(page.locator("#terminalHolderMapLabel")).toHaveText("Wallet concentration · pool excluded");
  await expect(page.locator("#terminalHolderMapState")).toContainText("Complete owner census");
  await expect(page.locator("#terminalHolderTop10")).toHaveText("26.2%");
  await expect(page.locator("#terminalHolderNext10Cell")).toBeHidden();
  await expect(page.locator("#terminalHolderNext20Cell")).toBeHidden();
  await expect(page.locator("#terminalHolderRest")).toHaveText("73.8%");
  await expect(page.locator("#terminalHolderBar > span")).toHaveCount(2);
  await expect(page.locator("#terminalRiskScreen")).toBeVisible();
  await expect(page.locator("#terminalRiskTitle")).toHaveText("Risk watch");
  await expect(page.locator("#terminalRiskSummary")).toContainText("excluding the exact pool");
  await expect(page.locator("#terminalRiskFactors")).toContainText("Holder concentration watch");
  await expect(page.locator("#terminalRiskChecks")).toContainText("Low listed-developer balance");
  await expect(page.locator("#terminalRiskChecks")).toContainText("independent on-chain balance check");
  await expect(page.locator("#terminalRiskScreen")).toContainText("not a scam verdict or rug probability");
  await page.locator("#terminalHolderList > summary").click();
  expect(holderCalls).toHaveLength(1);
  await expect(page.locator("#terminalHolderListState")).toContainText("2 of 4.85K owners");
  await expect(page.locator("#terminalHolderListNote")).toContainText("Complete current census");
  await expect(page.locator("#terminalHolderListNote")).toContainText("4.86K token accounts grouped into 4.85K owners");
  await expect(page.locator("#terminalHolderListRows .terminal-holder-row")).toHaveCount(2);
  await expect(page.locator("#terminalHolderListRows")).toContainText(/#1.*123\.457M.*12\.3%/s);
  await expect(page.locator('#terminalHolderListRows [data-classification="exact_pool_account"]')).toContainText("excluded from wallet concentration");
  await expect(page.locator("#terminalHolderListRows a").first()).toHaveAttribute("href", /solscan\.io\/account\/Stake/);
  expect(holderCalls[0]).toEqual({ poolAddress: "fixture-pair-address", tokenAddress: "fixture-token-address", quoteAddress: "fixture-quote-address" });
  await expect(page.locator("#terminalAlphaSection")).toBeVisible();
  await expect(page.locator("#terminalAlphaStack")).toContainText("Chart setup");
  await expect(page.locator("#terminalAlphaStack")).toContainText("Accumulation");
  await expect(page.locator("#terminalAlphaStack")).toContainText(/Buy count 2\.5× opposing flow · holders \+1\.80%/);
  await expect(page.locator("#terminalAlphaStack")).not.toContainText(/unknown|unavailable|missing/i);
  await expect(page.locator("#terminalProfileChips")).toContainText("Mint locked");
  await expect(page.locator("#terminalProfileChips")).toContainText("Freeze locked");
  await expect(page.locator("#terminalProfileChips")).not.toContainText("Developer holds");
  await expect(page.locator("#terminalProfileCredit")).toHaveText("Data provided by CoinGecko");
  await expect(page.locator(".terminal-pane-nav")).toBeVisible();
  await expect(page.locator("#terminalMarketTools")).toBeVisible();
  await expect(page.locator("#terminalQuickAddress")).toHaveText("fixtur…ddress");
  await expect(page.locator("#terminalQuickAddress")).toHaveAttribute("title", "fixture-token-address");
  await expect(page.locator("#terminalQuickLinks a")).toHaveCount(3);
  await expect(page.locator("#terminalQuickLinks")).toContainText("X ↗");
  await expect(page.locator("#terminalQuickLinks")).toContainText("TG ↗");
  await expect(page.locator("#terminalQuickLinks")).toContainText("Web ↗");
  await expect(page.locator('[data-terminal-pane-button="activity"]')).toHaveAttribute("data-status", "36 swaps");
  await expect(page.locator('[data-terminal-pane-button="holders"]')).toHaveAttribute("data-status", "Watch");
  await expect(page.locator('[data-terminal-pane-button="raven"]')).toHaveAttribute("data-status", "Current");
  await expect(page.locator('[data-terminal-pane-button="raven"]')).toBeEnabled();
  await page.locator('[data-terminal-pane-button="holders"]').click();
  await expect(page.locator("#terminalAnatomySection")).toBeFocused();
  const projectTrigger = page.locator("#terminalProjectLinksTrigger");
  await expect(projectTrigger).toBeVisible();
  await expect(projectTrigger).toHaveText("Links & CA");
  await expect(projectTrigger).toHaveAttribute("aria-expanded", "false");
  await projectTrigger.click();
  await expect(page.locator("#terminalProjectLinksPopover")).toBeVisible();
  await expect(projectTrigger).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#terminalProjectLinksTitle")).toHaveText("JUP/USDC · Solana");
  await expect(page.locator("#terminalProjectDescription")).toHaveText("Jupiter is a Solana liquidity platform and routing project.");
  await expect(page.locator("#terminalProfileLinks a")).toHaveCount(3);
  await expect(page.locator("#terminalProfileLinks")).toContainText("jup.ag");
  await expect(page.locator("#terminalProfileLinks")).toContainText("X ↗");
  await expect(page.locator("#terminalProfileLinks")).toContainText("Telegram ↗");
  await expect(page.locator("#terminalProjectSearchX")).toHaveAttribute("href", /x\.com\/search\?q=fixture-token-address.*f=live/);
  await expect(page.locator("#terminalProjectExplorer")).toHaveAttribute("href", "https://solscan.io/token/fixture-token-address");
  await expect(page.locator("#terminalProjectAddress")).toHaveText("fixture-token-address");
  await expect(page.locator("#terminalProjectCredit")).toHaveAttribute("href", "https://www.coingecko.com/en/api");
  await page.locator("#terminalProjectCopy").click();
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_TEST_COPIED_CA__)).toBe("fixture-token-address");
  await expect(page.locator("#terminalProjectCopy")).toHaveText("Copied");
  await expect(page.locator("#terminalQuickCopy")).toHaveText("Copied");
  await page.locator("#terminalProjectLinksClose").click();
  await expect(page.locator("#terminalProjectLinksPopover")).toBeHidden();
  await expect(projectTrigger).toBeFocused();
  await projectTrigger.click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#terminalProjectLinksPopover")).toBeHidden();
  await expect(projectTrigger).toBeFocused();
  const anatomyFacts = await Promise.all(
    [1, 2, 3, 4, 5].map((index) => page.locator(`#terminalAnatomy${index}`).textContent()),
  );
  expect(anatomyFacts.join(" ")).not.toMatch(/Unavailable|Not projected/i);
  await expect(page.locator("#terminalAnatomySection")).not.toContainText("Review unavailable");
  await expect(page.locator("#terminalFingerprint")).toHaveText("solana:fixture-pair-address:fixture-token-address:fixture-quote-address");
  await page.locator("#terminalSourceDetail > summary").click();
  await expect(page.locator("#terminalSourceProvider")).toHaveText("DexPaprika");
  await expect(page.locator("#terminalSourceInterval")).toContainText("Direct 1h bars");
  await expect(page.locator("#terminalSourceContinuity")).toContainText(/Verified/i);
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_CHART_GEOMETRY__?.marker_count)).toBe(1);
  const markerIndex = page.locator("#terminalChart [data-rpw-marker-index] button");
  await expect(markerIndex).toHaveCount(1);
  await expect(markerIndex).toHaveText("Raven marker 1");
  await expect(markerIndex).toHaveAttribute("aria-label", /Inspect /);
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
  await projectTrigger.click();
  await expect(page.locator("#terminalProjectLinksPopover")).toBeVisible();
  await page.selectOption("#terminalChart [data-rpw-timeframe-select]", "4h");
  await waitForTerminalLive(page, { lane: "spot", instrument: "JUP/USDC", timeframe: "4h" });
  await expect(page.locator("#terminalProjectLinksPopover")).toBeHidden();
  expect(await chartHash(page)).not.toBe(initialHash);
  expect(calls.some((call) => call.market === "crypto_spot" && call.pairAddress === "fixture-pair-address" && call.timeframe === "4h")).toBe(true);
});

test("project links fail closed on a mismatched profile while exact-CA actions remain bound to the selected token", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async writeText(value) {
          window.__RAVENOS_TEST_COPIED_CA__ = value;
        },
      },
    });
  });
  await mockTerminalLiveApis(page, { profileIdentityMismatch: true });
  await page.goto("/terminal/?instrument_id=solana%3Apool%3Afixture-pair-address&lane=spot&market=spot&instrument_type=exact_pool&token_address=fixture-token-address&quote_address=fixture-quote-address");
  await waitForTerminalLive(page, { lane: "spot", instrument: "JUP/USDC", timeframe: "1h" });
  await page.locator("#terminalProjectLinksTrigger").click();
  await expect(page.locator("#terminalProjectLinksPopover")).toBeVisible();
  await expect(page.locator("#terminalProfileLinks a")).toHaveCount(0);
  await expect(page.locator("#terminalProjectLinksEmpty")).toBeVisible();
  await expect(page.locator("#terminalProjectDescription")).toHaveText("No project description is listed for this exact token.");
  await expect(page.locator("#terminalProjectAddress")).toHaveText("fixture-token-address");
  await expect(page.locator("#terminalProjectSearchX")).toHaveAttribute("href", /q=fixture-token-address/);
  await expect(page.locator("#terminalProjectCredit")).toBeHidden();
  await expect(page.locator("#terminalMarketTools")).toBeVisible();
  await expect(page.locator("#terminalQuickLinks a")).toHaveCount(0);
  await expect(page.locator("#terminalQuickAddress")).toHaveText("fixtur…ddress");
  await page.locator("#terminalQuickCopy").click();
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_TEST_COPIED_CA__)).toBe("fixture-token-address");
});

test("free top-holder rows have a dedicated, readable 390px Terminal pane", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { holderCalls, tradeCalls } = await mockTerminalLiveApis(page, { holderRowCount: 100 });
  await page.goto("/terminal/?instrument_id=solana%3Apool%3Afixture-pair-address&lane=spot&market=spot&instrument_type=exact_pool&token_address=fixture-token-address&quote_address=fixture-quote-address");
  await waitForTerminalLive(page, { lane: "spot", instrument: "JUP/USDC", timeframe: "1h" });
  await expect(page.locator("[data-terminal-pane-button]:visible")).toHaveText(["Chart", "Trades", "Holders", "Raven"]);
  await expect(page.locator("#terminalDeepLink")).toHaveText("Holders & safety");
  await page.locator("#terminalDeepLink").click();
  await expect(page.locator(".terminal-live")).toHaveAttribute("data-terminal-pane", "holders");
  await expect(page.locator("#terminalAnatomySection")).toBeVisible();
  await expect(page.locator("#terminalContextSection")).toBeHidden();
  await expect(page.locator("#terminalHolderList")).toHaveAttribute("open", "");
  await expect.poll(() => holderCalls.length).toBe(1);
  await expect.poll(() => tradeCalls.length).toBe(1);
  await expect(page.locator("#terminalHolderListRows .terminal-holder-row")).toHaveCount(100);
  await expect(page.locator("#terminalHolderListState")).toContainText("100 of 4.85K owners");
  await expect(page.locator("#terminalHolderCheck")).toBeVisible();
  await expect(page.locator("#terminalHolderCheck")).toContainText("Raven holder check");
  await expect(page.locator("#terminalHolderLargest")).toHaveText("12.3%");
  await expect(page.locator("#terminalHolderTop3")).toHaveText("18.5%");
  await expect(page.locator("#terminalHolderCheckTop10")).toHaveText("26.2%");
  await expect(page.locator("#terminalHolderOwnerCount")).toHaveText("4.85K");
  await expect(page.locator("#terminalHolderTrend")).toHaveText("+6.40%");
  await expect(page.locator("#terminalHolderTrendScope")).toContainText("holder count");
  await expect(page.locator("#terminalHolderActivity")).toBeVisible();
  await expect(page.locator("#terminalHolderActivityState")).toHaveText("2 seen");
  await expect(page.locator("#terminalHolderActivitySummary")).toContainText("2 listed non-pool holders appeared in 24 of 36 returned exact-pool swaps");
  await page.locator('[data-holder-filter="active"]').click();
  await expect(page.locator("#terminalHolderListState")).toContainText("active holders");
  await expect(page.locator("#terminalHolderListRows .terminal-holder-row").first()).toContainText("12 returned swaps");
  await page.locator('[data-holder-filter="large"]').click();
  await expect(page.locator("#terminalHolderListRows .terminal-holder-row")).toHaveCount(11);
  await expect(page.locator("#terminalHolderListState")).toHaveText("11 1%+ wallets");
  await page.locator('[data-holder-filter="pool"]').click();
  await expect(page.locator("#terminalHolderListRows .terminal-holder-row")).toHaveCount(1);
  await page.locator('[data-holder-filter="all"]').click();
  await expect(page.locator("#terminalHolderListRows .terminal-holder-row")).toHaveCount(100);
  await expect(page.locator("#terminalHolderCheck")).not.toContainText(/smart money|whale/i);
  await expect(page.locator("#terminalHolderCheck")).toContainText("bundle membership, and wallet-by-wallet balance changes are not inferred");
  await page.locator("#terminalProjectLinksTrigger").click();
  await expect(page.locator("#terminalProjectLinksPopover")).toBeVisible();
  const documentOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const holderOverflow = await page.locator("#terminalHolderList").evaluate((element) => element.scrollWidth - element.clientWidth);
  const projectOverflow = await page.locator("#terminalProjectLinksPopover").evaluate((element) => element.scrollWidth - element.clientWidth);
  const holderScroll = await page.locator("#terminalHolderListRows").evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }));
  expect(documentOverflow).toBeLessThanOrEqual(2);
  expect(holderOverflow).toBeLessThanOrEqual(2);
  expect(projectOverflow).toBeLessThanOrEqual(2);
  expect(holderScroll.scrollHeight).toBeGreaterThan(holderScroll.clientHeight);
  await page.locator("#terminalProjectLinksClose").click();
  await page.locator('[data-terminal-pane-button="raven"]').click();
  await expect(page.locator("#terminalContextSection")).toBeVisible();
  await expect(page.locator("#terminalAnatomySection")).toBeHidden();
});

test("recent exact-pool swaps and repeat activity have a dedicated honest mobile pane", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { tradeCalls } = await mockTerminalLiveApis(page);
  await page.goto("/terminal/?instrument_id=solana%3Apool%3Afixture-pair-address&lane=spot&market=spot&instrument_type=exact_pool&token_address=fixture-token-address&quote_address=fixture-quote-address");
  await waitForTerminalLive(page, { lane: "spot", instrument: "JUP/USDC", timeframe: "1h" });
  await expect(page.locator("[data-terminal-pane-button]:visible")).toHaveText(["Chart", "Trades", "Holders", "Raven"]);
  expect(tradeCalls).toHaveLength(0);
  await page.locator('[data-terminal-pane-button="activity"]').click();
  await expect(page.locator(".terminal-live")).toHaveAttribute("data-terminal-pane", "activity");
  await expect(page.locator("#terminalSpotActivitySection")).toBeVisible();
  await expect(page.locator("#terminalAnatomySection")).toBeHidden();
  await expect(page.locator("#terminalContextSection")).toBeHidden();
  await expect.poll(() => tradeCalls.length).toBe(1);
  await expect(page.locator("#terminalSpotFlow1")).toHaveText("16");
  await expect(page.locator("#terminalSpotFlow2")).toHaveText("73.6%");
  await expect(page.locator("#terminalSpotFlow3")).toHaveText("+$20K");
  await expect(page.locator("#terminalSpotFlow4")).toHaveText("3 · 100.0% flow");
  await expect(page.locator("#terminalSpotTradeRows .terminal-spot-trade-row")).toHaveCount(36);
  await page.locator('[data-spot-trade-filter="buy"]').click();
  await expect(page.locator("#terminalSpotTradeRows .terminal-spot-trade-row")).toHaveCount(24);
  await page.locator('[data-spot-trade-filter="large"]').click();
  await expect(page.locator("#terminalSpotTradeRows .terminal-spot-trade-row")).toHaveCount(4);
  await page.locator('[data-spot-trade-filter="repeat"]').click();
  await expect(page.locator("#terminalSpotTradeRows .terminal-spot-trade-row")).toHaveCount(36);
  await expect(page.locator("#terminalSpotTradeRows a").first()).toHaveAttribute("href", /solscan\.io\/account\//);
  await page.locator("#terminalActiveTraders > summary").click();
  await expect(page.locator("#terminalActiveTraderRows .terminal-active-trader-row")).toHaveCount(3);
  await expect(page.locator("#terminalActiveTraderNote")).toContainText("does not imply related ownership, skill, or profitability");
  await expect(page.locator("#terminalSpotActivitySection")).not.toContainText(/smart money/i);
  const overflow = await page.locator("#terminalSpotActivitySection").evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_TERMINAL__?.getState?.())).toMatchObject({
    activeTerminalPane: "activity",
    spotTradeCount: 36,
    spotRepeatTraderCount: 3,
    signingAvailable: false,
    submissionAvailable: false,
  });
  expect(tradeCalls[0]).toEqual({ chain: "solana", poolAddress: "fixture-pair-address", tokenAddress: "fixture-token-address", quoteAddress: "fixture-quote-address" });
});

test("Velocity launch opens the exact pool with an automatic Raven overlay and token-specific TP strategy", async ({ page }) => {
  await mockTerminalLiveApis(page, { bullishSpotPlan: true, spotControls: false, velocitySpotContext: true });
  await page.goto("/terminal/?asset=JUP%2FUSDC&instrument_id=solana%3Apool%3Afixture-pair-address&lane=spot&market=spot&instrument_type=exact_pool&timeframe=1m&launch=velocity&raven_overlays=auto");
  await waitForTerminalLive(page, { lane: "spot", instrument: "JUP/USDC", timeframe: "1m" });

  await expect(page.locator("#terminalLaunchBadge")).toBeVisible();
  await expect(page.locator("#terminalLaunchBadge")).toHaveText("Found in Velocity");
  await expect(page.locator("#terminalPlanSection")).toBeVisible();
  await expect(page.locator("#terminalPlanLabel")).toHaveText("Raven custom TP strategy");
  await expect(page.locator("#terminalPlanTitle")).toHaveText("Defensive de-risk");
  await expect(page.locator("#terminalPlanState")).toHaveText("Long · research only");
  await expect(page.locator("#terminalPlanLadder")).toContainText(/TP1.*trim 55%.*TP2.*trim 30%.*TP3 \/ runner.*trim 15%/s);
  await expect(page.locator("#terminalPlanWhy")).toContainText(/structure 5\/5.*71% buy-side.*liquidity \/ market cap/s);
  await expect(page.locator("#terminalPlanDisclaimer")).toContainText("not personalized orders");
  await expect(page.locator("#terminalPlanLoad")).toBeHidden();
  await expect(page.locator("#terminalPlanToggle")).toBeChecked();
  await expect(page.locator("#terminalChartPlanStrip")).toBeVisible();
  await expect(page.locator("#terminalChartPlanSummary")).toHaveText("Entry + 3 TP + Risk");
  await expect(page.locator("#terminalChartRavenLayerCount")).toHaveText("5 Raven layers active");
  await expect(page.locator("#terminalChart [data-rpw-read-cell]")).toBeVisible();
  await expect(page.locator("#terminalChart [data-rpw-read-cell]")).toContainText(/Raven Read.*Breakout.*RSI.*volume/s);
  await expect(page.locator("#terminalAlphaStack")).toContainText("TP strategy");
  await expect(page.locator("#terminalAlphaStack")).toContainText("Defensive de-risk");
  await expect(page.locator("#terminalAlphaStack")).toContainText("Token-wide activity · selected pool revalidated");
  await expect(page.locator("#terminalPlanSection")).not.toContainText(/unknown|unavailable|missing/i);
  await expect(page.locator("#terminalAlphaStack")).not.toContainText(/unknown|unavailable|missing/i);
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_CHART_GEOMETRY__?.available_overlay_count)).toBe(5);
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_CHART_GEOMETRY__?.active_overlay_count)).toBe(5);
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_CHART_GEOMETRY__?.active_overlay_types || [])).toEqual(["plan-entry", "plan-target", "plan-risk"]);

  const state = await page.evaluate(() => window.__RAVENOS_TERMINAL__.getState());
  expect(state).toMatchObject({
    lane: "spot",
    instrumentId: "spot_pool:solana:fixture-dex:JUP:USDC:fixture-pair-address",
    launchSource: "velocity",
    autoRavenOverlays: true,
    chartReadDirection: "long",
    chartReadSetup: "breakout_confirmed",
    chartReadScore: 5,
    planPreviewAvailable: true,
    planStrategyId: "defensive_de_risk",
    planTargetCount: 3,
    planOverlayEnabled: true,
    signingAvailable: false,
    submissionAvailable: false,
  });
});

test("severe exact-market risk interrupts the chart and removes Raven action prompts", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockTerminalLiveApis(page, {
    bullishSpotPlan: true,
    spotControls: false,
    velocitySpotContext: true,
    holderRiskLevel: "severe",
  });
  await page.goto("/terminal/?asset=JUP%2FUSDC&instrument_id=solana%3Apool%3Afixture-pair-address&lane=spot&market=spot&instrument_type=exact_pool&timeframe=1m&launch=velocity&raven_overlays=auto");
  await waitForTerminalLive(page, { lane: "spot", instrument: "JUP/USDC", timeframe: "1m" });

  const interrupt = page.locator("#terminalRiskInterrupt");
  await expect(interrupt).toBeVisible();
  await expect(interrupt).toHaveAttribute("data-level", "severe");
  await expect(page.locator("#terminalRiskInterruptTitle")).toHaveText("Severe control risk");
  await expect(page.locator("#terminalRiskInterruptSummary")).toContainText("Usable liquidity has disappeared");
  await expect(page.locator("#terminalRiskInterruptFacts")).toContainText("Exact-pool liquidity effectively gone");
  await expect(page.locator("#terminalRiskInterruptFacts")).toContainText("Developer controls most supply");
  await expect(page.locator("#terminalRiskInterruptFacts")).toContainText("Top wallets dominate supply");
  await expect(page.locator("#terminalAlphaSection")).toBeHidden();
  await expect(page.locator("#terminalPlanSection")).toBeHidden();
  await expect(page.locator("#terminalChartPlanStrip")).toBeHidden();
  await expect(page.locator("#terminalChart [data-rpw-read-cell]")).toBeHidden();
  await expect(page.locator("#terminalChart [data-rpw-marker-index]")).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_CHART_GEOMETRY__?.active_overlay_count)).toBe(0);

  const positions = await page.evaluate(() => ({
    interrupt: document.getElementById("terminalRiskInterrupt")?.getBoundingClientRect().top,
    panes: document.querySelector(".terminal-pane-nav")?.getBoundingClientRect().top,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(positions.interrupt).toBeLessThan(positions.panes);
  expect(positions.overflow).toBeLessThanOrEqual(2);

  await page.locator("#terminalRiskInterruptReview").click();
  await expect(page.locator(".terminal-live")).toHaveAttribute("data-terminal-pane", "holders");
  await expect(page.locator("#terminalAnatomySection")).toBeVisible();
  await expect(page.locator("#terminalRiskScreen")).toContainText("not a scam verdict or rug probability");
  await page.locator('[data-terminal-pane-button="raven"]').click();
  await expect(page.locator("#terminalContextRiskGuard")).toBeVisible();
  await expect(page.locator("#terminalContextRiskGuard")).toContainText("Behavior observed; Raven plan paused");
  await page.locator("#terminalContextRiskReview").click();
  await expect(page.locator(".terminal-live")).toHaveAttribute("data-terminal-pane", "holders");
});

test("severe risk survives an early holder response and clears only for the next exact instrument", async ({ page }) => {
  await mockTerminalLiveApis(page, { spotRavenContext: false, holderRiskLevel: "severe" });
  await page.goto("/terminal/?instrument_id=solana%3Apool%3Afixture-pair-address&lane=spot&market=spot&instrument_type=exact_pool&token_address=fixture-token-address&quote_address=fixture-quote-address");
  await waitForTerminalLive(page, { lane: "spot", instrument: "JUP/USDC", timeframe: "1h" });

  await expect(page.locator("#terminalRiskInterrupt")).toBeVisible();
  await expect(page.locator("#terminalChart [data-rpw-read-cell]")).toBeHidden();
  await expect(page.locator("#terminalChart .rpw")).toHaveClass(/rpw-read-suppressed/);
  await expect(page.locator("#terminalChart [data-rpw-marker-index]")).toBeHidden();

  await selectUniversalInstrument(page, "SOL-PERP");
  await waitForTerminalLive(page, { lane: "perps", instrument: "SOL-PERP", timeframe: "1h" });
  await expect(page.locator("#terminalRiskInterrupt")).toBeHidden();
  await expect(page.locator("#terminalChart .rpw")).not.toHaveClass(/rpw-read-suppressed/);
  await expect(page.locator("#terminalChart [data-rpw-marker-index]")).toBeVisible();
});

test("spot markets without matching Raven evidence keep useful anatomy and omit empty intelligence", async ({ page }) => {
  await mockTerminalLiveApis(page, { spotRavenContext: false });
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  await openExactSpotSearch(page, "JUP");
  await waitForTerminalLive(page, { lane: "spot", instrument: "JUP/USDC", timeframe: "1h" });

  await expect(page.locator("#terminalChart canvas").first()).toBeVisible();
  await expect(page.locator("#terminalContextSection")).toBeHidden();
  await expect(page.locator("#terminalReadTrigger")).toBeHidden();
  await expect(page.locator('[data-terminal-pane-button="raven"]')).toBeDisabled();
  await expect(page.locator('[data-terminal-pane-button="raven"]')).toHaveAttribute("data-status", "No current read");
  await expect(page.locator(".terminal-live")).toHaveAttribute("data-terminal-pane", "chart");
  await expect(page.locator("#terminalAnatomy1")).toContainText("4.2M");
  await expect(page.locator("#terminalAnatomy5Label")).toHaveText("Holders");
  await expect(page.locator("#terminalAnatomy5")).toContainText("4.85K");
  await expect(page.locator("#terminalHolderMap")).toBeVisible();
  await expect(page.locator("#terminalAnatomySection")).not.toContainText(/unknown|not projected/i);
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
  await expect(page.locator("#terminalBoundary strong")).toHaveText("Trading coming later");
  await expect(page.locator("#terminalPlanSection")).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__RAVENOS_TERMINAL__.getState().planPreviewAvailable)).toBe(false);
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
  await expect(scope).toBeHidden();
  await expect(legend).toBeVisible();
  await expect(legend).toContainText(/Latest.*UTC.*O.*H.*L.*C.*Change.*Base vol/s);
  await expect(legend).not.toContainText("Quote vol");
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

test("exact-market order plan stays non-signing even when dormant route-review flags are enabled", async ({ page }) => {
  await mockTerminalLiveApis(page, { flagsEnabled: true });
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  await expect(page.locator("#terminalTradeReviewSection")).toBeVisible();
  await expect(page.locator("#terminalQuoteState")).toHaveText("Current book");
  await expect(page.locator("#terminalQuoteContract")).toHaveText("Exact-market trade plan");
  await expect(page.locator("#terminalQuoteNote")).toContainText(/Preview only.*Nothing can be signed or sent/i);
  await expect(page.locator("#terminalPreviewFill")).toContainText("SOL");
  await expect(page.getByRole("button", { name: /sign|submit|execute|buy|sell/i })).toHaveCount(0);
  await expect(page.locator('script[src*="ravenos-terminal-trade"], script[src*="ravenos-access"]')).toHaveCount(0);
});

test("Hyperliquid market plan recomputes exact direction, size, and margin without creating an order", async ({ page }) => {
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  await expect(page.locator("#terminalPreviewResult")).toBeVisible();
  await page.locator("#terminalPreviewNotional").fill("900");
  await page.locator("#terminalPreviewShort").click();
  await expect(page.locator("#terminalPreviewShort")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#terminalPreviewAction")).toHaveText("Review short market");
  await expect(page.locator("#terminalPreviewMargin")).toContainText("$300");
  await expect(page.locator("#terminalPreviewMessage")).toContainText(/Account-specific effects are not included/i);
  const state = await page.evaluate(() => window.__RAVENOS_TERMINAL__.getState());
  expect(state.marketPreviewAvailable).toBe(true);
  expect(state.orderPlanAvailable).toBe(true);
  expect(state.orderPlanState).toBe("order_plan_available");
  expect(state.orderPlanType).toBe("market");
  expect(state.signingAvailable).toBe(false);
  expect(state.submissionAvailable).toBe(false);
});

test("limit, trigger, and bracket plans expose execution semantics without implying a fill", async ({ page }) => {
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });

  await page.getByRole("button", { name: "Limit", exact: true }).click();
  await page.locator("#terminalPreviewPrice").fill("147");
  await page.locator("#terminalPreviewTif").selectOption("alo");
  await page.locator("#terminalBracket > summary").click();
  await page.locator("#terminalPreviewTakeProfit").fill("154");
  await page.locator("#terminalPreviewStopLoss").fill("144");
  await page.locator("#terminalPreviewAction").click();
  await expect(page.locator("#terminalQuoteState")).toHaveText("Resting limit");
  await expect(page.locator("#terminalPreviewEntryLabel")).toHaveText("Planned resting entry");
  await expect(page.locator("#terminalPreviewVwap")).toContainText("Post only");
  await expect(page.locator("#terminalPreviewSpreadLabel")).toHaveText("Stop risk");
  await expect(page.locator("#terminalPreviewDepthLabel")).toHaveText("Reward : risk");
  await expect(page.locator("#terminalPreviewMessage")).toContainText(/risk math are reviewed separately/i);

  await page.getByRole("button", { name: "Trigger", exact: true }).click();
  await expect(page.locator("#terminalPreviewPriceLabel")).toHaveText("Trigger price");
  await expect(page.locator("#terminalPreviewTifField")).toBeHidden();
  await expect(page.locator("#terminalQuoteState")).toHaveText("Conditional");
  await expect(page.locator("#terminalPreviewVwap")).toContainText("reprices when activated");
  const state = await page.evaluate(() => window.__RAVENOS_TERMINAL__.getState());
  expect(state.orderPlanType).toBe("trigger");
  expect(state.signingAvailable).toBe(false);
  expect(state.submissionAvailable).toBe(false);
});

test("Raven research levels load into the ticket only after an explicit user action", async ({ page }) => {
  await mockTerminalLiveApis(page);
  await page.goto("/terminal/");
  await waitForTerminalLive(page, { instrument: "SOL-PERP" });
  await expect(page.locator("#terminalPreviewPrice")).toHaveValue("");
  await page.locator("#terminalPlanLoad").click();
  await expect(page.getByRole("button", { name: "Limit", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#terminalPreviewPrice")).toHaveValue("148");
  await expect(page.locator("#terminalPreviewTakeProfit")).toHaveValue("152.588");
  await expect(page.locator("#terminalPreviewStopLoss")).toHaveValue("146.224");
  await expect(page.locator("#terminalBracket")).toHaveAttribute("open", "");
  await expect(page.locator("#terminalPreviewResult")).toBeVisible();
  await expect(page.locator("#terminalQuoteNote")).toContainText(/Preview only/i);
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
  await expect(page.locator("#terminalChart .rpw-crosshair > span")).toHaveCount(8);
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
  await expect(page.locator("[data-rpw-coverage-note]")).toContainText("Only 12 15m candles are available right now");
  await expect(page.locator("[data-rpw-coverage-note]")).toContainText("More will appear here as price history becomes available");
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
  await page.selectOption("#terminalChart [data-rpw-timeframe-select]", "4h");
  await waitForTerminalLive(page, { instrument: "BTC-PERP", timeframe: "4h" });
  await page.locator('.ros-workspace-nav a[data-ros-nav="discover"]').click();
  await expect(page).toHaveURL(/\/discover\/.*asset=BTC-PERP.*timeframe=4h/);
  await expect(page.locator("#rosContextSubject")).toHaveText("BTC-PERP");
});

test("primary navigation is coherent across workspace and static support surfaces", async ({ page }) => {
  const expected = ["Discover", "Terminal", "Intel", "Portfolio", "Atlas"];
  const shellRoutes = ["/discover/", "/terminal/", "/intelligence/", "/opportunity/", "/replay/", "/outcomes/", "/memory/", "/behavior/", "/research/", "/perps/", "/atlas/", "/account/"];
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
