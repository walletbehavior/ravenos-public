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
  /\bComparable\b/i,
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
  await expect(page.getByRole("heading", { name: "Market structure" })).toBeVisible();

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

test("/opportunity/ renders Solana opportunity language without source labels", async ({ page }) => {
  await page.goto("/opportunity/");
  await expect(page.locator("#routeHeadline")).toContainText(/clearest backed behavioral surface right now|chain-level leadership/i);
  await expect(page.locator("#routeHeroSummary")).toContainText(/narrows the broader Solana read|cap-band detail is coverage developing|Participation is expanding on Solana/i);
  const primary = await page.locator("#routeHeadline, #routeHeroSummary, #routeStateStrip, #routePrimaryPanel, #routeSecondaryPanel").evaluateAll((nodes) => nodes.map((node) => node.innerText).join(" "));
  expect(primary).toMatch(/Specific surface|Surface detail/i);
  expect(primary).toMatch(/fresh pairs|micro|mid|participant cohorts|perps/i);
  expect(primary).toMatch(/Behavioral Opportunity/i);
  expect(primary).not.toMatch(/cohorts is/i);
  expect(primary).not.toMatch(/Participant Cohorts participation/i);
  expect(primary).toMatch(/Solana participant cohorts are|surface detail is coverage developing|Participation is expanding on Solana/i);
  expect(primary).not.toMatch(/Surface-backed observation|Chain-level observation/);
  expect(primary).toMatch(/Missing evidence/i);
  expect(primary).toMatch(/Broader context/i);
  expect(primary).toMatch(/Evidence depth/i);
  expect(primary).toMatch(/Followthrough/i);
  expect(primary).toMatch(/Next inspection/i);
  expect(primary).toContain("View evidence");
  expect(primary).toContain("Open Behavior");
  expect(primary).toMatch(/observations|observed/);
  expect(primary).not.toMatch(/Solana Live Activity|Current Raven Read|View claim details|View settlement status|Where Raven Would Investigate|Where should I investigate|Issue Sample|market rows|original public claim/i);
  expect(primary).not.toMatch(/\bCurrent Surface\b/);
  const headline = ((await page.locator("#routeHeadline").textContent()) || "").trim();
  if (/clearest backed behavioral surface right now/i.test(headline)) {
    const primaryPanel = await page.locator("#routePrimaryPanel").innerText();
    expect((primaryPanel.match(new RegExp(headline.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length).toBe(0);
  }
});

test("/replay/ explains similarity score in trader-readable context", async ({ page }) => {
  await page.goto("/replay/");
  await expect(page.locator("#routePrimaryPanel")).toContainText(/What this means/i);
  await expect(page.locator("#routePrimaryPanel")).toContainText(/Replay supports context, not conviction/i);
  const primary = await page.locator("#routeHeadline, #routeHeroSummary, #routeStateStrip, #routePrimaryPanel, #routeSecondaryPanel").evaluateAll((nodes) => nodes.map((node) => node.innerText).join(" "));
  expect(primary).toMatch(/matched .* on|Similarity basis/i);
  expect(primary).toMatch(/Prior outcome|Prior followthrough/i);
  expect(primary).toMatch(/context, not conviction|context, not a forecast/i);
  expect(primary).toMatch(/Similarity does not validate outcome or management path|management path/i);
  expect(primary).not.toMatch(/97% similarity\s*$/i);
});

test("/replay/ wraps similarity context on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/replay/");
  await expect(page.locator("#routePrimaryPanel")).toContainText(/Similarity basis/i);
  await expect(page.locator("#routePrimaryPanel")).toContainText(/context, not a forecast/i);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  const basisItems = await page.locator("#routePrimaryPanel .route-compact-list li").count();
  expect(basisItems).toBeGreaterThan(0);
});

test("research narrator surfaces missing path evidence without readiness language", async ({ page }) => {
  await page.goto("/research/");
  await expect(page.locator("#researchNarratorPanel")).toContainText(/Research status|Public research observations|Research workspace/i);
  const primary = await page.locator("#researchNarratorPanel, h1, .lead").evaluateAll((nodes) => nodes.map((node) => node.innerText).join(" "));
  expect(primary).not.toMatch(/evidence forming ago/i);
  expect(primary).toMatch(/Research workspace forming|Public research observations are active|not yet deep enough/i);
  expect(primary).toMatch(/Missing path evidence|Path evidence|post-decision path/i);
  expect(primary).toMatch(/Management path\s+(Not Validated|Under Review)|Management path.*(not validated|under review)/i);
  expect(primary).toMatch(/Keep Researching|research observation/i);
  expect(primary).not.toMatch(/validated trade|ready to trade|internal PnL lift|expectancy lift|drawdown improvement|promotion gate/i);
});

test("/outcomes/ narrator explains validation counts", async ({ page }) => {
  await page.goto("/outcomes/");
  await expect(page.locator(".narrator-panel")).toContainText(/What outcomes show|Confirmed followthrough/i);
  const text = await page.locator(".narrator-panel, #routePrimaryPanel, #routeStateStrip").evaluateAll((nodes) => nodes.map((node) => node.innerText).join(" "));
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
  await page.getByRole("button", { name: "Book", exact: true }).click();
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

test("dynamic market labels are capitalized in primary UI", async ({ page }) => {
  await page.goto("/opportunity/");
  await expect(page.locator("#routeHeadline")).toContainText(/Solana/i);
  const primary = await page.locator("#routeHeadline, #routeHeroSummary, #routeStateStrip, #routePrimaryPanel, #routeSecondaryPanel").evaluateAll((nodes) => nodes.map((node) => node.innerText).join(" "));
  expect(primary).toMatch(/\bSolana\b/);
  expect(primary).not.toMatch(/\bsolana\b/);
});
