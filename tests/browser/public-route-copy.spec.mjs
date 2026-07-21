import { test, expect } from "@playwright/test";

async function visibleBodyText(page) {
  return page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const chunks = [];
    let node = walker.nextNode();
    while (node) {
      const parent = node.parentElement;
      const value = node.nodeValue.trim();
      if (parent && value) {
        const closedDetails = parent.closest("details:not([open])");
        if (closedDetails && !parent.closest("summary")) {
          node = walker.nextNode();
          continue;
        }
        const style = getComputedStyle(parent);
        const box = parent.getBoundingClientRect();
        const visible = style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && box.width > 0 && box.height > 0;
        if (visible) chunks.push(value);
      }
      node = walker.nextNode();
    }
    return chunks.join(" ");
  });
}

const badPrimaryCopy = [
  /Evidence bridge/i,
  /Current Raven Read/i,
  /View claim details/i,
  /View settlement status/i,
  /Where should I investigate/i,
  /Conclusion first, evidence second, methodology expandable/i,
  /Outcomes Proof Rail/i,
  /Every material public read should link to later validation/i,
  /Next Step/i,
  /Open Opportunity as the next investigative surface/i,
  /Live Activity/i,
  /\bCurrent Surface\b/,
  /Where Raven Would Investigate/i,
  /Issue Sample/i,
  /market rows/i,
  /original public claim/i,
  /public evidence shell/i,
  /smart money says/i,
  /buy now/i,
  /sell now/i,
  /long-now/i,
  /short-now/i,
  /guaranteed/i,
  /artifact-backed totals below/i,
  /current public window/i,
  /Comparable rows/i,
  /Outcome rows/i,
  /Settled outcome rows/i,
  /Claim-To-Outcome Loop/i,
  /public proof rails?/i,
  /public-safe/i,
  /sample depth is public-safe/i,
  /current outcome set/i,
  /ravenos_participant_outcomes\.json/i,
  /ravenos_public_methodology_v2/i,
  /\bclaim_[0-9a-f]{8,}\b/i,
  /\b[A-Za-z0-9_-]+\.json\b/,
  /Evidence Role/i,
  /Usable Sample/i,
  /\bFreshness\b/i,
  /\bCurrent Synthesis\b/i,
  /\bSettled Validation\b/i,
  /\bOutcomes Unclear\b/i,
  /\bForward Observation\b/i,
  /\bGenerated\b/i,
  /\bAfter Window\b/i,
  /\bObserved surfaces\b/i,
];

for (const route of ["/brief/", "/opportunity/", "/memory/", "/behavior/", "/outcomes/", "/replay/"]) {
  test(`${route} renders trader-facing primary copy`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator("#routeHeadline")).toBeVisible();
    await expect.poll(async () => (await page.locator("#routeHeadline").textContent())?.trim()).not.toBe("");

    const rendered = await visibleBodyText(page);
    for (const pattern of badPrimaryCopy) {
      expect(rendered).not.toMatch(pattern);
    }
  });
}

test("/perps/ renders a trader-facing live market workspace", async ({ page }) => {
  await page.goto("/perps/");
  await expect(page.locator("#perpsInstrument")).toBeVisible();
  await expect(page.locator("#perpsChart")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Order book" })).toBeVisible();
  await expect(page.locator("#perpsReadHeadline")).toBeVisible();
  await expect(page.locator("#perpsWhy")).not.toHaveText("Current context unavailable until verified.");

  const rendered = await visibleBodyText(page);
  for (const pattern of badPrimaryCopy) {
    expect(rendered).not.toMatch(pattern);
  }
});

test("/terminal/ renders trader-facing primary copy", async ({ page }) => {
  await page.goto("/terminal/");
  await expect(page.locator("#terminalModeSelect")).toBeVisible();
  const rendered = await visibleBodyText(page);
  for (const pattern of badPrimaryCopy) {
    expect(rendered).not.toMatch(pattern);
  }
});

for (const route of ["/faq/", "/research/"]) {
  test(`${route} renders public-safe primary copy`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator("h1").first()).toBeVisible();
    const rendered = await visibleBodyText(page);
    for (const pattern of badPrimaryCopy) {
      expect(rendered).not.toMatch(pattern);
    }
  });
}

test("/opportunity/ renders the current Census with exact perp identity and aggregate-only spot coverage", async ({ page }) => {
  await page.goto("/opportunity/");
  await expect(page.locator("#routeHeadline")).toContainText(/^[A-Z0-9._-]+-PERP · /);
  await expect(page.locator("#routeHeroSummary")).toContainText(/Raven froze|Raven preserved/i);
  const primary = await page.locator("#routeHeadline, #routeHeroSummary, #routeStateStrip, #routePrimaryPanel, #routeSecondaryPanel").evaluateAll((nodes) => nodes.map((node) => node.innerText).join(" "));
  expect(primary).toMatch(/Current exact-instrument review queue/i);
  expect(primary).toMatch(/Decision → path → outcome continuity/i);
  expect(primary).toMatch(/Hyperliquid perpetuals/i);
  expect(primary).toMatch(/Solana spot[\s\S]*aggregate coverage only/i);
  expect(primary).toMatch(/EVM spot[\s\S]*aggregate coverage only/i);
  expect(primary).toMatch(/Research only · signing off · submission off · monitoring off/i);
  expect(primary).toMatch(/not ranked trades, orders, or personalized plans/i);
  expect(primary).not.toMatch(/buy now|sell now|guaranteed/i);
  expect(primary).not.toMatch(/\b0x[a-fA-F0-9]{40}\b|\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/);
  expect(await page.locator("#routePrimaryPanel tbody tr").count()).toBeGreaterThan(0);
});

test("/replay/ refuses to fabricate similarity without as-of comparable lineage", async ({ page }) => {
  await page.goto("/replay/");
  await expect(page.locator("#routeHeadline")).toContainText(/Historical comparable lineage is not yet projected/i);
  await expect(page.locator("#routePrimaryPanel")).toContainText(/No fabricated analogue rows/i);
  const primary = await page.locator("#routeHeadline, #routeHeroSummary, #routeStateStrip, #routePrimaryPanel, #routeSecondaryPanel").evaluateAll((nodes) => nodes.map((node) => node.innerText).join(" "));
  expect(primary).toMatch(/Synthetic similarity[\s\S]*None/i);
  expect(primary).toMatch(/Current outcomes substituted[\s\S]*No/i);
  expect(primary).toMatch(/Same market and decision boundary/i);
  expect(primary).toMatch(/As-of evidence reconstruction/i);
  expect(primary).not.toMatch(/\b\d{1,3}% similarity\b|Closest analogue/i);
});

test("/replay/ explicit unavailable state stays contained on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/replay/");
  await expect(page.locator("#routePrimaryPanel")).toContainText(/As-of comparable projection is still missing/i);
  await expect(page.locator("#routeSecondaryPanel")).toContainText(/What must exist before Replay turns on/i);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});

test("research surfaces its stale unavailable contract without a cached narrator", async ({ page }) => {
  await page.goto("/research/");
  await expect(page.locator("#routeHeadline")).toContainText(/Current research snapshot unavailable/i);
  await expect(page.locator("#routeStateStrip")).toContainText(/Research state[\s\S]*Unavailable/i);
  await expect(page.locator(".narrator-panel, #researchNarratorPanel")).toHaveCount(0);
  const primary = await page.locator("#routeHeadline, #routeHeroSummary, #routeStateStrip, #routePrimaryPanel, #routeSecondaryPanel").evaluateAll((nodes) => nodes.map((node) => node.innerText).join(" "));
  expect(primary).not.toMatch(/evidence forming ago/i);
  expect(primary).not.toMatch(/validated trade|ready to trade|internal PnL lift|expectancy lift|drawdown improvement|promotion gate/i);
});

test("account status exposes no synthetic session, entitlement, or billing controls", async ({ page }) => {
  await page.goto("/account/");
  await expect(page.getByRole("heading", { name: "Customer accounts are not available yet." })).toBeVisible();
  await expect(page.locator("#rosActivityDetail")).toContainText(/Static account boundary/i);
  await expect(page.locator('script[src*="ravenos-access"]')).toHaveCount(0);
  await expect(page.locator("[data-stripe-checkout], [data-stripe-portal], [data-access-check]")).toHaveCount(0);
  const text = await visibleBodyText(page);
  expect(text).toMatch(/no production login, session, subscription, token gate/i);
  expect(text).not.toMatch(/\$149|\$999|upgrade to pro|connect wallet to unlock|founder token balance/i);
});

test("commercial status publishes no price, checkout, or invented tier", async ({ page }) => {
  await page.goto("/pricing/");
  await expect(page.getByRole("heading", { name: "Commercial access is not open yet." })).toBeVisible();
  await expect(page.locator("#rosActivityDetail")).toContainText(/Static commercial boundary/i);
  await expect(page.locator("[data-stripe-checkout], [data-stripe-portal]")).toHaveCount(0);
  const text = await visibleBodyText(page);
  expect(text).toMatch(/No prices · no checkout · no entitlement claims · no customer execution/i);
  expect(text).not.toMatch(/\$149|\$999|buy pro|start monthly|start annual|token threshold/i);
});

test("Terminal keeps wallet context separate from customer access", async ({ page }) => {
  await page.goto("/terminal/");
  await expect(page.locator(".terminal-continuity")).toContainText(/Customer session[\s\S]*Not configured/i);
  await expect(page.locator(".terminal-intelligence")).toContainText(/Wallet[\s\S]*Optional context only/i);
  await expect(page.locator('script[src*="ravenos-access"]')).toHaveCount(0);
  await expect(page.locator('script[src*="ravenos-terminal-trade"]')).toHaveCount(0);
  const text = await visibleBodyText(page);
  expect(text).not.toMatch(/upgrade to pro|token access|connect account/i);
});

test("/outcomes/ explains validation counts from structured evidence without a narrator dependency", async ({ page }) => {
  await page.goto("/outcomes/");
  await expect(page.locator(".narrator-panel")).toHaveCount(0);
  const text = await page.locator("#routePrimaryPanel, #routeStateStrip").evaluateAll((nodes) => nodes.map((node) => node.innerText).join(" "));
  expect(text).toMatch(/Confirmed followthrough/i);
  expect(text).toMatch(/Mixed \/ insufficient|Mixed or insufficient/i);
  expect(text).toMatch(/Reads under validation|Settled outcomes/i);
  expect(text).not.toMatch(/Raven sees behavior worth researching, but the post-decision path is not validated yet/i);
  await expect(page.locator("#routePrimaryPanel")).toContainText(/outcome loop is active|validation is still developing/i);
});

test("/outcomes/ mobile funnel stays compact and preserves the lesson", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/outcomes/");
  await expect(page.locator("#routePrimaryPanel")).toContainText(/Live observations are not outcomes/i);
  const compactCards = await page.locator(".outcome-funnel-compact .route-card").count();
  expect(compactCards).toBeGreaterThanOrEqual(6);
  const box = await page.locator(".outcome-funnel-compact").boundingBox();
  expect(box.height).toBeLessThanOrEqual(520);
});

test("/perps/ keeps live market context and chart controls contained on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/perps/");
  await expect(page.locator("#perpsInstrument")).toBeVisible();
  await expect(page.locator("#perpsChart")).toBeVisible();
  await expect(page.locator("#perpsTimeframes")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Order book" })).toBeHidden();
  await page.getByRole("button", { name: "Book + tape", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Order book" })).toBeVisible();
  await expect(page.locator(".route-perps-cards")).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});

test("mobile route metadata is secondary before the read", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/opportunity/");
  await expect(page.locator(".public-evidence-details summary")).toBeVisible();
  await expect(page.locator(".public-evidence-strip")).toBeHidden();
  const positions = await page.evaluate(() => ({
    hero: document.querySelector(".route-hero")?.getBoundingClientRect().top,
    evidence: document.querySelector(".public-evidence")?.getBoundingClientRect().top,
  }));
  expect(positions.evidence).toBeLessThan(positions.hero);
  const evidenceHeight = await page.locator(".public-evidence").evaluate((node) => node.getBoundingClientRect().height);
  expect(evidenceHeight).toBeLessThanOrEqual(56);
});

test("/atlas/ routes to useful backed RavenOS context without pretending macro coverage", async ({ page }) => {
  await page.goto("/atlas/");
  await expect(page.locator("h1")).toContainText(/Regime map/i);
  const body = await visibleBodyText(page);
  expect(body).toMatch(/Use Atlas as a regime router/i);
  expect(body).toMatch(/Behavior.*Who is participating|Replay.*prior public structures|Perps.*Derivatives context|Outcomes.*earlier public reads/s);
  expect(body).toMatch(/Broad macro regime.*Coverage developing|Cross-market confirmation.*Not inferred yet/s);
  expect(body).not.toMatch(/internal product-boundary|placeholder/i);
});

test("/outcomes/ frames observations and outcomes as a validation funnel", async ({ page }) => {
  await page.goto("/outcomes/");
  await expect(page.locator("#routeHeadline")).toContainText("Did earlier Raven reads follow through?");
  await expect(page.locator("#routeHeroSummary")).toContainText("Live observations are not outcomes");
  const primary = await page.locator("#routeHeadline, #routeHeroSummary, #routeStateStrip, #routePrimaryPanel, #routeSecondaryPanel").evaluateAll((nodes) => nodes.map((node) => node.innerText).join(" "));
  expect(primary).toMatch(/Evidence observed/i);
  expect(primary).toMatch(/Reads under validation|Pending validation/i);
  expect(primary).toMatch(/Settled outcomes/i);
  expect(primary).toMatch(/Confirmed followthrough/i);
  expect(primary).toMatch(/Validation sample forming|Validation status/i);
  expect(primary).toContain("Observations are raw market evidence");
  expect(primary).not.toMatch(/Usable observations\s+\d+\s+Confirmed\s+\d+\s+Pending/i);
  expect(primary).not.toMatch(/claim details|settlement status|outcome rows|public proof rail|methodology IDs|source filenames/i);
});

test("primary evidence strip uses trader-facing totals and window labels", async ({ page }) => {
  await page.goto("/opportunity/");
  await expect.poll(async () => (await page.locator('[data-evidence-field="as_of"]').textContent())?.trim()).not.toBe("awaiting read");
  const strip = await page.locator(".public-evidence-strip").innerText();
  expect(strip).not.toMatch(/Evidence bridge|artifact-backed totals below|current public window|market rows|Settlement window|Artifact version/i);
  expect(strip).toMatch(/current window|observations|see totals below|live evidence totals below/i);
  await page.locator(".public-evidence-details").evaluate((node) => node.setAttribute("open", ""));
  const bridge = await page.locator(".public-evidence-details").innerText();
  expect(bridge).toMatch(/Why reads can differ/i);
  expect(bridge).not.toMatch(/Evidence bridge|Current reads, historical context, and settled validation use declared windows/i);
});

test("opportunity identity stays exact for perps while spot identities stay aggregate", async ({ page }) => {
  await page.goto("/opportunity/");
  await expect(page.locator("#routeHeadline")).toContainText(/^[A-Z0-9._-]+-PERP · /);
  const primary = await page.locator("#routeHeadline, #routeHeroSummary, #routeStateStrip, #routePrimaryPanel, #routeSecondaryPanel").evaluateAll((nodes) => nodes.map((node) => node.innerText).join(" "));
  expect(primary).toMatch(/Solana spot[\s\S]*aggregate coverage only/i);
  expect(primary).toMatch(/EVM spot[\s\S]*aggregate coverage only/i);
  expect(primary).not.toMatch(/\b0x[a-fA-F0-9]{40}\b|\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/);
});
