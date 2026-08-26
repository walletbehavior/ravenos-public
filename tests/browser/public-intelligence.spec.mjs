import { test, expect } from "@playwright/test";
import { mockTerminalLiveApis } from "./terminal-live-fixtures.mjs";

function perpsProjection() {
  const generatedAt = new Date().toISOString();
  const market = (symbol, overrides = {}) => ({
    symbol,
    venue: "Hyperliquid Perps",
    coverage: "active",
    mark_price: symbol === "BTC-PERP" ? 78_768 : 97.704,
    day_volume_usd: symbol === "BTC-PERP" ? 3_370_343_453 : 273_873_824,
    open_interest_usd: symbol === "BTC-PERP" ? 2_962_343_831 : 513_906_655,
    funding_rate: 0.0000125,
    funding_regime: "Funding neutral",
    spread_bps: 0.1269,
    depth_20_usd: 8_213_030,
    liquidity_quality: "deep",
    pressure_state: "Long crowding watch",
    pressure_direction: "downside pressure context",
    instrument_group: "Majors",
    ...overrides,
  });
  const outcome = {
    confidence: "developing",
    group: "Funding neutral",
    label: "Funding Posture",
    median_max_adverse_movement_pct: -1.24,
    median_max_favorable_movement_pct: 0.81,
    median_observed_change_pct: -0.3,
    mixed: 3,
    punishing: 7,
    read: "punishing in current forward observation",
    rewarding: 4,
    sample_caveat: "sample forming",
    sample_size: 14,
  };
  return {
    ok: true,
    safe_public: true,
    redaction_policy: "aggregate_public_market_context_only",
    schema_version: "ravenos_perps_public_origin_v1",
    generated_at: generatedAt,
    delivery: { source: "current_public_origin", fallback: false, freshness_state: "fresh" },
    data: {
      schema_version: "ravenos_perps_evidence_public_v2",
      safe_public: true,
      public_safe: true,
      generated_at: generatedAt,
      summary: {
        markets_observed: 176,
        books_observed: 176,
        forward_observations: 14,
        matured_12h_windows: 7,
        pressure_buckets: { "Mixed pressure": 130, "Long crowding watch": 10, "Bid-side pressure visible": 13 },
        liquidity_buckets: { deep: 4, usable: 41, thin: 131 },
      },
      actor_evidence: {
        public_safe: true,
        actor_evidence_freshness: "stale",
        observed_at: "2026-08-23T03:45:47Z",
      },
      tables: {
        top_volume: [market("BTC-PERP"), market("SOL-PERP")],
        top_pressure: [market("ACE-PERP", { funding_rate: -0.00057, funding_regime: "Negative funding elevated", pressure_state: "Short crowding watch", pressure_direction: "upside pressure context", open_interest_usd: 1_558_008 })],
        tightest_books: [market("SOL-PERP", { spread_bps: 0.1023, depth_20_usd: 832_435, liquidity_quality: "usable", pressure_state: "Bid-side pressure visible" })],
        wide_or_thin_books: [market("HMSTR-PERP", { spread_bps: 54.4959, depth_20_usd: 81_832, liquidity_quality: "thin", pressure_state: "Thin or wide books" })],
        actor_leaders: [{ wallet_label: "SENTINEL_PRIVATE_LEADER", rank: 1 }],
      },
      forward_observation: {
        observations: 14,
        matured_windows: { "15m": 14, "1h": 14, "4h": 14, "12h": 7 },
        median_observed_change_pct: { "15m": -0.15, "1h": -0.35, "4h": -0.43, "12h": 0.08 },
        median_max_favorable_movement_pct: { "15m": 0, "1h": 0.19, "4h": 0.81, "12h": 0.93 },
        sample_caveat: "Forward observation sample remains early; public output is validation context, not a trade recommendation.",
      },
      outcome_attribution: {
        public_caveat: "Outcome attribution is aggregate validation context. It is not a trading recommendation or execution model.",
        grouped: { funding_regime: [outcome], pressure_bucket: [{ ...outcome, label: "Pressure State", group: "Exhausted pressure" }], instrument_group: [] },
      },
      instrument_context: { rows: [{ instrument: "SOL-PERP", context_available: true, context_state: "fresh", context_age_seconds: 30, outcomes: { sample_size: 128 } }] },
    },
  };
}

test("Intelligence hub makes every existing evidence surface discoverable without expanding mobile primary navigation", async ({ page }) => {
  await page.goto("/intelligence/?asset=SOL-PERP&instrument_id=hyperliquid%3Aperp%3ASOL&chain=hyperliquid&venue=hyperliquid&market=perp&timeframe=4h");
  await expect(page.getByRole("heading", { name: "Follow the evidence behind the read." })).toBeVisible();
  for (const href of ["/behavior/", "/perps/#perpsIntelligence", "/outcomes/", "/replay/", "/claims/", "/memory/", "/research/", "/chains/solana/", "/chains/base/", "/chains/ethereum/"]) {
    await expect(page.locator(`.intelligence-hub a[data-ros-base-href="${href}"]`)).toHaveCount(1);
  }
  await expect(page.locator('.ros-workspace-nav a[data-ros-nav="intelligence"]')).toHaveClass(/active/);
  const behaviorHref = await page.locator('.intelligence-hub a[data-ros-base-href="/behavior/"]').getAttribute("href");
  expect(behaviorHref).toMatch(/instrument_id=hyperliquid%3Aperp%3ASOL/);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".ros-mobile-nav a")).toHaveCount(4);
  await page.locator("#rosProfileTrigger").click();
  await expect(page.locator('#rosUtilityContent a[href="/intelligence/"]')).toContainText("Intelligence");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});

test("Discover shows the complete current attention benchmark and hides a stale contract", async ({ page }) => {
  await page.goto("/discover/");
  const benchmark = page.locator("#discoverAttentionBenchmark");
  await expect(benchmark).toBeVisible();
  await expect(benchmark).toContainText("3,799");
  await expect(benchmark).toContainText("3,460");
  await expect(benchmark).toContainText("745");
  await expect(benchmark).toContainText("37m");
  await expect(benchmark).toContainText("555");
  await expect(benchmark).toContainText("109");
  await expect(benchmark).toContainText(/not profitability, a claim about the selected instrument, or a tradeable rule/i);

  const currentResponse = await page.request.get("/api/opportunity");
  const stalePayload = await currentResponse.json();
  stalePayload.census.attention_benchmark.freshness = { state: "stale", age_seconds: 7_200, target_seconds: 3_600 };
  await page.route("**/api/opportunity", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stalePayload) }));
  await page.reload();
  await expect(benchmark).toBeHidden();
});

test("Perps Intelligence renders positioning, pressure, liquidity, and outcome maturity while withholding stale leaderboards", async ({ page }) => {
  await mockTerminalLiveApis(page);
  await page.unroute("**/api/perps");
  await page.route("**/api/perps", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(perpsProjection()) }));
  await page.goto("/perps/#perpsIntelligence");
  await expect(page.locator("#perpsIntelligenceState")).toHaveText("Current");
  await expect(page.locator("#perpsIntelOverview")).toContainText(/176.*markets|Markets observed.*176/s);
  await expect(page.locator("#perpsIntelOverview")).toContainText(/Participant context.*Stale/s);
  await expect(page.locator("#perpsIntelOverview")).toContainText(/Liquidation stream.*Unavailable/s);
  await expect(page.locator("body")).not.toContainText("SENTINEL_PRIVATE_LEADER");

  await page.getByRole("tab", { name: "Positioning" }).click();
  await expect(page.locator("#perpsIntelPositioning")).toContainText("Funding neutral");
  await expect(page.locator("#perpsIntelPositioning")).toContainText("Open interest");
  await page.getByRole("tab", { name: "Pressure & crowding" }).click();
  await expect(page.locator("#perpsIntelPressure")).toContainText(/Short crowding watch.*Negative funding elevated/s);
  await page.getByRole("tab", { name: "Liquidity" }).click();
  await expect(page.locator("#perpsIntelLiquidity")).toContainText(/Tightest books.*Wide or thin books/s);
  await expect(page.locator("#perpsIntelLiquidity")).toContainText("54.50 bps");

  const liquidityTab = page.getByRole("tab", { name: "Liquidity" });
  await liquidityTab.focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Outcomes" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#perpsIntelOutcomes")).toContainText(/12h maturity.*7 \/ 14/s);
  await expect(page.locator("#perpsIntelOutcomes")).toContainText(/Aggregate outcome attribution/i);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "Liquidity" }).click();
  await page.locator("#perpsIntelligence").scrollIntoViewIfNeeded();
  const intelligenceTop = await page.locator("#perpsIntelligence").evaluate((element) => element.getBoundingClientRect().top);
  expect(intelligenceTop).toBeGreaterThanOrEqual(54);
  await expect(page.locator('#perpsIntelLiquidity [data-label="20-level depth"]').first()).toBeVisible();
  const mobileOverflow = await page.locator("#perpsIntelligence").evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(mobileOverflow).toBeLessThanOrEqual(2);
  const tabOverflow = await page.locator(".perps-intelligence-tabs").evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(tabOverflow).toBeLessThanOrEqual(2);
});

test("Participant Intelligence keeps denominators, evidence strength, and privacy boundaries visible", async ({ page }) => {
  const currentResponse = await page.request.get("/api/behavior");
  const behavior = await currentResponse.json();
  behavior.data.actor_evidence.actor_evidence_freshness = "stale";
  behavior.data.actor_evidence.actor_evidence_state = "actor_evidence_stale";
  behavior.data.actor_evidence.public_read_label = "Participant evidence is stale.";
  await page.route("**/api/behavior", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(behavior) }));
  await page.goto("/behavior/");
  await expect(page.locator(".behavior-focus")).toContainText(/Participant success rate.*Win-rate band.*Outcome strength.*Average outcome.*Confidence \/ score.*Sample integrity.*Window/s);
  const first = page.locator(".behavior-matrix article").first();
  await expect(first).toContainText(/Trend.*Success rate.*Win-rate band.*Average outcome.*Confidence.*Score strength/s);
  await expect(first).toContainText(/usable.*observed.*excluded/s);
  await expect(first).toContainText("Aggregate · identities withheld");
  await expect(page.locator("#routeSecondaryPanel")).toContainText(/Participant context is stale.*not used as a live leaderboard/s);
  await expect(page.locator("#routeSecondaryPanel")).toContainText(/No raw wallet identity, wallet label, relationship graph, ownership claim, coordination claim, or smart-money ranking is exposed/i);
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/\b0x[a-fA-F0-9]{40}\b|\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/);
});

test("Participant Intelligence keeps an unavailable live feed explicit without stale substitution", async ({ page }) => {
  await page.route("**/api/behavior", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, state: "unavailable" }) }));
  await page.goto("/behavior/");
  await expect(page.locator("#routeHeadline")).toContainText("unavailable");
  await expect(page.locator("#routeHeroSummary")).toContainText(/older participant evidence is not substituted as current/i);
  await expect(page.locator("#routeHeroSummary")).not.toContainText(/using the last verified public artifact/i);
  await page.setViewportSize({ width: 390, height: 844 });
  const identityCard = page.locator("#routeStateStrip .route-state-card").last();
  await expect(identityCard).toContainText(/Participant identities.*Withheld/s);
  const stripOverflow = await page.locator("#routeStateStrip").evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(stripOverflow).toBeLessThanOrEqual(2);
});

test("Raven Read evidence navigation distinguishes broader context from exact attached lineage", async ({ page }) => {
  await mockTerminalLiveApis(page);
  await page.goto("/perps/?asset=SOL-PERP&instrument_id=hyperliquid%3Aperp%3ASOL&chain=hyperliquid&venue=hyperliquid&market=perp&timeframe=4h");
  await page.waitForFunction(() => window.__RAVENOS_PERPS_WORKSPACE__?.getState?.().instrument === "SOL-PERP");
  await expect(page.locator("#rosContextTrigger")).toBeVisible();
  await page.locator("#rosContextTrigger").click();
  const evidence = page.locator("#rosEvidenceNavigation");
  await expect(evidence).toContainText(/Participant Intelligence.*Broader aggregate context/s);
  await expect(evidence).toContainText(/Original claim.*Exact claim not attached/s);
  await expect(evidence).toContainText(/Similar History.*Exact context requested; match is verified there/s);
  await expect(evidence).toContainText(/Invalidation state.*Declared in this Raven Read/s);
  await expect(evidence.locator('a[data-ros-base-href="/replay/"]')).toHaveAttribute("href", /instrument_id=hyperliquid%3Aperp%3ASOL/);
});
