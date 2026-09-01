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
  /Evidence version/i,
  /Public artifact verified/i,
  /Projection loading/i,
  /Required contract/i,
  /Activation gate/i,
  /Lineage unavailable/i,
  /current public lineage/i,
  /Aggregate, recurring, privacy-safe/i,
  /Freshness-gated/i,
  /public evidence contract/i,
  /Identity and evidence boundary/i,
  /Provider-listed pools can resolve/i,
  /Account activation status/i,
  /\b(?:migration|checkpoint|adapter|internal)\b/i,
];

for (const route of ["/opportunity/", "/memory/", "/behavior/", "/outcomes/", "/replay/"]) {
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

test("the retired Brief route preserves exact context and opens Terminal", async ({ page }) => {
  await page.goto("/brief/?asset=SV151%2FUSDC&instrument_id=solana%3Apool%3Aexample&timeframe=4h");
  await expect(page).toHaveURL(/\/terminal\/.*asset=SV151%2FUSDC.*instrument_id=solana%3Apool%3Aexample.*timeframe=4h/);
  await expect(page.locator("#terminalChart")).toBeVisible();
});

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
  await expect(page.locator("#terminalInstrumentTrigger")).toBeVisible();
  await expect(page.locator("#terminalModeSelect")).toBeHidden();
  await expect(page.locator("#terminalInstrument")).not.toHaveText("");
  await expect(page.locator("#terminalPlanDisclaimer")).toContainText("Not financial advice");
  const rendered = await visibleBodyText(page);
  for (const pattern of badPrimaryCopy) {
    expect(rendered).not.toMatch(pattern);
  }
});

for (const route of ["/docs/", "/faq/", "/research/"]) {
  test(`${route} renders public-safe primary copy`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator("h1").first()).toBeVisible();
    const rendered = await visibleBodyText(page);
    for (const pattern of badPrimaryCopy) {
      expect(rendered).not.toMatch(pattern);
    }
  });
}

test("the quick guide and FAQ explain the customer workflow without release or engineering markers", async ({ page }) => {
  await page.goto("/docs/");
  await expect(page.getByRole("heading", { name: "Find a market. Understand why it matters." })).toBeVisible();
  await expect(page.locator("body")).toContainText("Research only · Not financial advice");
  const guide = await visibleBodyText(page);
  expect(guide).toMatch(/Velocity.*Raven.*Activity/s);
  expect(guide).toMatch(/Chart.*Txns.*Holders.*Raven/s);
  expect(guide).not.toMatch(/Current intelligence connected|Exact identity enforced|Signing and submission off|Public artifact verified|Tradier, then future brokers|provider path|implementation|projection contract/i);

  await page.goto("/faq/");
  await expect(page.getByRole("heading", { name: "The basics, without the jargon." })).toBeVisible();
  await expect(page.locator("details").first()).toContainText(/No.*general market information and research tools/s);
  await expect(page.locator("body")).toContainText("Research only · Not financial advice");

  await page.goto("/");
  await expect(page.locator(".landing-footer")).toContainText("Not financial advice");
  await expect(page.locator('.landing-footer a[href="/docs/"]')).toHaveText("Guide");
});

test("/opportunity/ renders current exact markets without engineering inventory", async ({ page }) => {
  await page.goto("/opportunity/");
  await expect(page.locator("#routeHeadline")).toContainText(/^[A-Z0-9._-]+-PERP · /);
  await expect(page.locator("#routeHeroSummary")).not.toContainText(/Raven froze|Raven preserved/i);
  await expect(page.locator("#routeHeroSummary")).toContainText(/Independent evidence confirmed|appeared/i);
  const primary = await page.locator("#routeHeadline, #routeHeroSummary, #routeStateStrip, #routePrimaryPanel, #routeSecondaryPanel").evaluateAll((nodes) => nodes.map((node) => node.innerText).join(" "));
  expect(primary).toMatch(/Current exact markets/i);
  expect(primary).toMatch(/Exact, current, or unavailable/i);
  expect(primary).toMatch(/Exact market required/i);
  expect(primary).toMatch(/Older observations do not substitute/i);
  expect(primary).toMatch(/Research only/i);
  expect(primary).not.toMatch(/Census|admission joins|current cycle|market samples/i);
  expect(primary).not.toMatch(/buy now|sell now|guaranteed/i);
  expect(primary).not.toMatch(/\b0x[a-fA-F0-9]{40}\b|\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/);
  expect(await page.locator("#routePrimaryPanel tbody tr").count()).toBeGreaterThan(0);
  const terminalLink = page.locator('#routePrimaryPanel a[href^="/terminal/"]').first();
  await expect(terminalLink).toHaveAttribute("href", /asset=[A-Z0-9._-]+-PERP/);
  await expect(terminalLink).toHaveAttribute("href", /instrument_id=hyperliquid%3Aperp%3A[A-Z0-9._-]+/);
});

test("/replay/ refuses to fabricate similarity without as-of comparable lineage", async ({ page }) => {
  await page.goto("/replay/");
  await expect(page.locator("#routeHeadline")).toContainText(/Similar history is unavailable/i);
  await expect(page.locator("#routePrimaryPanel")).toContainText(/No invented analogues/i);
  const primary = await page.locator("#routeHeadline, #routeHeroSummary, #routeStateStrip, #routePrimaryPanel, #routeSecondaryPanel").evaluateAll((nodes) => nodes.map((node) => node.innerText).join(" "));
  expect(primary).toMatch(/Invented matches[\s\S]*Never/i);
  expect(primary).toMatch(/Newer results reused[\s\S]*Never/i);
  expect(primary).toMatch(/The same market conditions/i);
  expect(primary).toMatch(/Only what was known then/i);
  expect(primary).not.toMatch(/historical comparable lineage|synthetic similarity|current outcomes substituted|as-of evidence reconstruction|future-only matured path/i);
  expect(primary).not.toMatch(/\b\d{1,3}% similarity\b|Closest analogue/i);
});

test("/replay/ explicit unavailable state stays contained on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/replay/");
  await expect(page.locator("#routePrimaryPanel")).toContainText(/No trustworthy match yet/i);
  await expect(page.locator("#routeSecondaryPanel")).toContainText(/What Raven needs before showing similar history/i);
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

test("account status exposes the real activation gate without synthetic identity or billing", async ({ page }) => {
  await page.goto("/account/");
  await expect(page.getByRole("heading", { name: "One account for your entire desk." })).toBeVisible();
  await expect(page.getByText("Account sign-up is temporarily unavailable.")).toBeVisible();
  await expect(page.locator("#accountAuthActions")).toBeHidden();
  await expect(page.locator(".ros-activity-strip")).toHaveCount(0);
  await expect(page.locator('script[src*="ravenos-access"]')).toHaveCount(0);
  await expect(page.locator("[data-stripe-checkout], [data-stripe-portal], [data-access-check]")).toHaveCount(0);
  const text = await visibleBodyText(page);
  expect(text).toMatch(/Public research remains available/i);
  expect(text).toMatch(/Signing in is not trading/i);
  expect(text).not.toMatch(/\$149|\$999|upgrade to pro|connect wallet to unlock|founder token balance/i);
});

test("plans page presents the published tiers without activating checkout", async ({ page }) => {
  await page.goto("/pricing/");
  await expect(page.getByRole("heading", { name: "Start free. Go deeper when Raven becomes part of your edge." })).toBeVisible();
  await expect(page.locator('[data-plan="free"]')).toContainText("$0");
  await expect(page.locator('[data-plan="pro"]')).toContainText("$149");
  await expect(page.locator('[data-plan="desk"]')).toContainText("$499");
  await expect(page.locator('[data-plan="enterprise"]')).toContainText("Custom");
  await expect(page.getByRole("link", { name: "Open Free" })).toHaveAttribute("href", "/discover/");
  await expect(page.getByRole("link", { name: "View Pro preview" })).toHaveAttribute("href", "https://app.ravenos.xyz/account/intelligence/");
  await expect(page.locator(".ros-activity-strip")).toHaveCount(0);
  await expect(page.locator("[data-stripe-checkout], [data-stripe-portal]")).toHaveCount(0);
  const text = await visibleBodyText(page);
  expect(text).toMatch(/Paid enrollment opens later/i);
  expect(text).toMatch(/Research only\. Not financial advice/i);
  expect(text).not.toMatch(/buy pro|start monthly|start annual|token threshold|activation gate|projection contract|operator grant/i);
});

test("plans remain legible and honest on a narrow mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/pricing/");
  await expect(page.locator(".pricing-plan-card")).toHaveCount(4);
  await expect(page.getByText("Desk enrollment opens later", { exact: true })).toBeVisible();
  await expect(page.getByText("Enterprise inquiries open later", { exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});

test("Terminal keeps wallet context separate from customer access", async ({ page }) => {
  await page.goto("/terminal/");
  await expect(page.locator(".terminal-continuity, .ros-capability-status")).toHaveCount(0);
  await expect(page.locator("#terminalBoundary")).toContainText(/No order can be signed or sent/i);
  await expect(page.locator(".terminal-intelligence")).toContainText(/Order plan/i);
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
  const funnel = page.locator(".outcome-funnel-compact");
  await expect(funnel).toBeVisible();
  const compactCards = await funnel.locator(".route-card").count();
  expect(compactCards).toBeGreaterThanOrEqual(6);
  const height = await funnel.evaluate((node) => node.getBoundingClientRect().height);
  expect(height).toBeLessThanOrEqual(520);
});

test("/behavior/ exposes aggregate participation with denominators and privacy boundaries", async ({ page }) => {
  await page.goto("/behavior/");
  await expect(page.locator(".behavior-focus")).toContainText(/Strongest supported slice/i);
  await expect(page.locator(".behavior-matrix article").first()).toContainText(/usable of .*observed.*(?:Developing|Broader sample)/i);
  await expect(page.locator(".behavior-matrix article").first()).toContainText(/No directional edge measured/i);
  await expect(page.locator("#routeSecondaryPanel")).toContainText(/Wallet-pattern history/i);
  await expect(page.locator("#routeSecondaryPanel")).toContainText(/No wallet names.*ownership claims.*coordination claims.*smart money/s);
  const body = await visibleBodyText(page);
  expect(body).not.toMatch(/\bParticipant success rate\b|\bSuccess rate\s+50(?:\.00)?%|\bWin-rate band\b/i);
  expect(body).not.toMatch(/\b0x[a-fA-F0-9]{40}\b|\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/);
});

test("/memory/ treats recurrence as context rather than fabricated Replay", async ({ page }) => {
  await page.goto("/memory/");
  await expect(page.locator("#routeHeroSummary")).toContainText(/recurrence and persistence/i);
  await expect(page.locator(".memory-family-row").first()).toContainText(/appearances/i);
  await expect(page.locator("#routeSecondaryPanel")).toContainText(/Recurrence is not similarity, causality, or a forecast/i);
  const body = await visibleBodyText(page);
  expect(body).not.toMatch(/closest analogue|\d{1,3}% similarity/i);
});

test("/outcomes/ keeps missing movement metrics unavailable instead of coercing null to zero", async ({ page }) => {
  await page.goto("/outcomes/");
  await expect(page.locator(".outcome-distribution")).toContainText(/Confirmed[\s\S]*Mixed[\s\S]*Insufficient/i);
  const rows = await page.locator(".route-settled-table tbody tr").allInnerTexts();
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.some((row) => /Unavailable/.test(row))).toBe(true);
  await expect(page.locator("#routeSecondaryPanel")).toContainText(/descriptive evidence, not capturable return/i);
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

test("/atlas/ explains an outage without inventing unsupported research", async ({ page }) => {
  await page.route("**/api/atlas", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ ok: false, error: "atlas_projection_unavailable" }),
  }));
  await page.goto("/atlas/");
  await expect(page.locator("h1")).toContainText(/one market, resolved in context/i);
  await expect(page.locator("main")).toContainText(/Issuer context/i);
  const body = await visibleBodyText(page);
  expect(body).not.toMatch(/Company events|Broker execution|Not projected/i);
  expect(body).not.toMatch(/bounded market frame|catalog-only|hydrates on selection/i);
  expect(body).toMatch(/Issuer context/i);
  expect(body).not.toMatch(/Market pulse unavailable/i);
  expect(body).not.toMatch(/Use Atlas as a regime router|placeholder company|sample options chain/i);
});

test("/outcomes/ frames observations and outcomes as a validation funnel", async ({ page }) => {
  await page.goto("/outcomes/");
  await expect(page.locator("#routeHeadline")).toContainText("Did earlier Raven reads follow through?");
  await expect(page.locator("#routeHeroSummary")).toContainText("Live observations remain open");
  const primary = await page.locator("#routeHeadline, #routeHeroSummary, #routeStateStrip, #routePrimaryPanel, #routeSecondaryPanel").evaluateAll((nodes) => nodes.map((node) => node.innerText).join(" "));
  expect(primary).toMatch(/Evidence observed/i);
  expect(primary).toMatch(/Reads under validation|Pending validation/i);
  expect(primary).toMatch(/Settled outcomes/i);
  expect(primary).toMatch(/Confirmed followthrough/i);
  expect(primary).toMatch(/Validation sample forming|Validation status/i);
  expect(primary).toContain("Open observations are never counted as followthrough");
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

test("opportunity identity stays exact and unsupported spot markets are not inferred", async ({ page }) => {
  await page.goto("/opportunity/");
  await expect(page.locator("#routeHeadline")).toContainText(/^[A-Z0-9._-]+-PERP · /);
  const primary = await page.locator("#routeHeadline, #routeHeroSummary, #routeStateStrip, #routePrimaryPanel, #routeSecondaryPanel").evaluateAll((nodes) => nodes.map((node) => node.innerText).join(" "));
  expect(primary).toMatch(/Exact market required/i);
  expect(primary).not.toMatch(/Solana spot|EVM spot|aggregate coverage only/i);
  expect(primary).not.toMatch(/\b0x[a-fA-F0-9]{40}\b|\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/);
});
