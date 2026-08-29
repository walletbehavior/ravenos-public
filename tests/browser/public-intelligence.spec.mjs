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

function freePerpsProjection() {
  const generatedAt = new Date().toISOString();
  const rows = ["BTC", "SOL", "ETH", "HYPE", "XRP", "DOGE"].map((coin, index) => ({
    instrument_id: `hyperliquid:perp:${coin}`,
    symbol: `${coin}-PERP`,
    venue: "Hyperliquid",
    instrument_group: index < 3 ? "Majors" : "Liquid alts",
    funding_rate: 0.00001 * (index + 1),
    funding_regime: index % 2 ? "Positive funding" : "Funding neutral",
    open_interest_usd: 900_000_000 - index * 80_000_000,
    day_volume_usd: 1_200_000_000 - index * 90_000_000,
    mark_price: 100 - index,
    pressure_state: index % 2 ? "Long crowding watch" : "Mixed pressure",
    coverage: "active",
  }));
  return {
    ok: true,
    schema_version: "ravenos.customer_intelligence_projection.v1",
    intelligence_kind: "perps",
    access_scope: "free",
    generated_at: generatedAt,
    provenance: {
      source_category: "current_public_safe_projection",
      freshness: { state: "fresh", generated_at: generatedAt },
      raw_provider_payload_included: false,
      participant_identity_included: false,
      execution_data_included: false,
    },
    delivery: { source: "current_public_origin", fallback: false, freshness_state: "fresh" },
    overview: {
      state: "active",
      markets_observed: 176,
      books_observed: 176,
      public_read: "Funding is balanced while pressure remains selective.",
      pressure_buckets: [{ label: "Mixed pressure", count: 130 }, { label: "Long crowding watch", count: 10 }],
      liquidity_buckets: [{ label: "deep", count: 4 }, { label: "usable", count: 41 }, { label: "thin", count: 131 }],
      participant_context: { state: "actor_evidence_stale", freshness: "stale", observed_at: generatedAt, privacy: "aggregate_status_only" },
    },
    selected_market: { state: "not_selected", instrument_id: null, market: null },
    market_overview: rows,
    limitations: {
      liquidation_data: "unavailable_no_qualified_stream",
      actor_leaderboards: "withheld_pending_separate_qualification",
      wallet_identity: "not_included",
      execution: "not_included",
    },
    advanced: null,
  };
}

function freeParticipantProjection() {
  const generatedAt = new Date().toISOString();
  return {
    ok: true,
    schema_version: "ravenos.customer_intelligence_projection.v1",
    intelligence_kind: "participants",
    access_scope: "free",
    generated_at: generatedAt,
    provenance: {
      source_category: "current_public_safe_projection",
      freshness: { state: "fresh", generated_at: generatedAt },
      raw_provider_payload_included: false,
      participant_identity_included: false,
      execution_data_included: false,
    },
    delivery: { source: "current_public_origin", fallback: false, freshness_state: "fresh" },
    headline: { state: "available", public_read: "Participation is selective.", aggregate_evidence_freshness: "fresh", conditions_observed: 97 },
    participation_overview: ["solana", "base", "ethereum", "solana", "base", "ethereum"].map((chain, index) => ({
      chain,
      capitalization_band: index < 3 ? "micro" : "mid",
      window: index % 2 ? "1h" : "4h",
      participation_trend: index % 2 ? "expanding" : "selective",
      observed_sample: 40 + index,
      usable_sample: 30 + index,
      interpretation: `${chain} aggregate condition ${index + 1} remains evidence-bound.`,
    })),
    limitations: {
      aggregation: "aggregate_conditions_only",
      wallet_identity: "not_included",
      wallet_labels: "not_included",
      relationship_graphs: "not_included",
      smart_money_rankings: "not_included",
    },
    advanced: null,
  };
}

function participationPayoffProjection() {
  return {
    schema_version: "ravenos.participation_payoff.v1",
    generated_at: new Date().toISOString(),
    state: "current",
    public_safe: true,
    headline: "Participation payoff",
    summary: "Leadership: Robinhood fresh pairs. Weakest follow-through: Solana fresh pairs.",
    comparison: null,
    measurement: { display_window: "Latest samples", minimum_usable_sample: 20, causal_claim: false },
    insights: [{
      state: "rewarding",
      subject: "Robinhood fresh pairs",
      plain_read: "Robinhood fresh pairs are showing the cleanest follow-through.",
      operator_detail: "6h +0.00% · 24h +3.7%",
      usable_sample: 47,
    }, {
      state: "punishing",
      subject: "Solana fresh pairs",
      plain_read: "Solana fresh pairs are punishing recent participation.",
      operator_detail: "6h -14.8% · 24h -53.1%",
      usable_sample: 30,
    }],
  };
}

test("Raven Lab gives aggregate behavior a distinct job without preserving the old evidence directory", async ({ page }) => {
  await page.goto("/intelligence/?asset=SOL-PERP&instrument_id=hyperliquid%3Aperp%3ASOL&chain=hyperliquid&venue=hyperliquid&market=perp&timeframe=4h");
  await expect(page.getByRole("heading", { name: "Test the behavior behind a setup." })).toBeVisible();
  await expect(page.locator(".intelligence-hub")).toContainText(/Discover finds the market.*Terminal explains the exact setup.*Raven Lab lets you test/s);
  for (const [href, count] of [["/behavior/", 2], ["/perps/#perpsIntelligence", 1], ["/discover/", 1], ["/terminal/", 1]]) {
    await expect(page.locator(`.intelligence-hub a[data-ros-base-href="${href}"]`)).toHaveCount(count);
  }
  for (const href of ["/outcomes/", "/replay/", "/claims/", "/memory/", "/research/", "/chains/solana/", "/chains/base/", "/chains/ethereum/"]) {
    await expect(page.locator(`.intelligence-hub a[data-ros-base-href="${href}"]`)).toHaveCount(0);
  }
  await expect(page.locator('.ros-workspace-nav a[data-ros-nav="intelligence"]')).toHaveClass(/active/);
  const behaviorHref = await page.locator('.intelligence-hub a[data-ros-base-href="/behavior/"]').first().getAttribute("href");
  expect(behaviorHref).toMatch(/instrument_id=hyperliquid%3Aperp%3ASOL/);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".ros-mobile-nav > *")).toHaveCount(4);
  await expect(page.locator(".ros-mobile-nav a")).toHaveCount(3);
  await page.getByRole("button", { name: "More RavenOS destinations" }).click();
  await expect(page.locator('#rosUtilityContent a[href="/intelligence/"]')).toContainText("Raven Lab");
  await expect(page.locator('#rosUtilityContent a[href="/behavior/"]')).toHaveCount(0);
  await expect(page.locator('#rosUtilityContent a[href="/perps/#perpsIntelligence"]')).toHaveCount(0);
  await expect(page.locator("#rosUtilityContent")).toContainText("Behavior cohorts, perps, replay, and measured outcomes");
  await expect(page.locator('#rosUtilityDrawer > header a[href="/terms/"]')).toContainText("Not financial advice");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});

test("Discover shows the complete current attention benchmark and hides a stale contract", async ({ page }) => {
  await page.goto("/discover/");
  const benchmark = page.locator("#discoverAttentionBenchmark");
  await expect(benchmark).toBeVisible();
  expect(await page.locator("#discoverSpotPulse").evaluate((spot) => Boolean(
    spot.compareDocumentPosition(document.querySelector("#discoverAttentionBenchmark")) & Node.DOCUMENT_POSITION_FOLLOWING,
  ))).toBe(true);
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

test("Perps positioning excludes stale wallet context and keeps outcome counts attached to maturity", async ({ page }) => {
  await mockTerminalLiveApis(page);
  await page.unroute("**/api/perps");
  await page.route("**/api/perps", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(perpsProjection()) }));
  await page.goto("/perps/#perpsIntelligence");
  await expect(page.locator("#perpsIntelligenceState")).toHaveText("Current");
  await expect(page.locator("#perpsIntelOverview")).toContainText(/176.*markets|Markets observed.*176/s);
  await expect(page.locator("#perpsIntelOverview")).toContainText(/Recurring-wallet context.*Excluded/s);
  await expect(page.locator("#perpsIntelOverview")).toContainText(/stale wallet evidence is hidden.*does not affect current conclusions/i);
  await expect(page.locator("#perpsIntelOverview")).toContainText(/Liquidation stream.*Unavailable/s);
  await expect(page.locator("body")).not.toContainText("SENTINEL_PRIVATE_LEADER");

  await page.getByRole("tab", { name: "Funding & OI" }).click();
  await expect(page.locator("#perpsIntelPositioning")).toContainText("Funding neutral");
  await expect(page.locator("#perpsIntelPositioning")).toContainText("Open interest");
  await expect(page.locator("#perpsIntelPositioning")).toContainText("Major perps");
  await page.getByRole("tab", { name: "Crowding" }).click();
  await expect(page.locator("#perpsIntelPressure")).toContainText(/Short crowding watch.*Negative funding elevated/s);
  await page.getByRole("tab", { name: "Tradeability" }).click();
  await expect(page.locator("#perpsIntelLiquidity")).toContainText(/Most tradeable books.*Friction watch/s);
  await expect(page.locator("#perpsIntelLiquidity")).toContainText("54.50 bps");

  const liquidityTab = page.getByRole("tab", { name: "Tradeability" });
  await liquidityTab.focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "What followed" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#perpsIntelOutcomes")).toContainText(/12h follow-through.*7 of 14 measured/s);
  await expect(page.locator("#perpsIntelOutcomes")).toContainText(/4 positive.*3 mixed.*7 negative.*N=14.*Too early/s);
  await expect(page.locator("#perpsIntelOutcomes")).toContainText(/No group conclusion/i);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "Tradeability" }).click();
  await page.locator("#perpsIntelligence").scrollIntoViewIfNeeded();
  const intelligenceTop = await page.locator("#perpsIntelligence").evaluate((element) => element.getBoundingClientRect().top);
  expect(intelligenceTop).toBeGreaterThanOrEqual(54);
  await expect(page.locator('#perpsIntelLiquidity [data-label="20-level depth"]').first()).toBeVisible();
  const mobileOverflow = await page.locator("#perpsIntelligence").evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(mobileOverflow).toBeLessThanOrEqual(2);
  const tabOverflow = await page.locator(".perps-intelligence-tabs").evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(tabOverflow).toBeLessThanOrEqual(2);
});

test("Free Perps Intelligence receives six current rows and a real server boundary instead of hidden advanced data", async ({ page }) => {
  await mockTerminalLiveApis(page);
  await page.unroute("**/api/perps");
  await page.route("**/api/perps", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(freePerpsProjection()) }));
  await page.goto("/perps/#perpsIntelligence");

  await expect(page.locator("#perpsIntelligenceState")).toHaveText("Current");
  await page.getByRole("tab", { name: "Funding & OI" }).click();
  await expect(page.locator("#perpsIntelPositioning tbody tr")).toHaveCount(6);
  await expect(page.locator("#perpsIntelPositioning")).toContainText("Current market positioning");
  await expect(page.locator("#perpsIntelPositioning")).toContainText(/Major perps.*Alt perps/s);
  await page.getByRole("tab", { name: "Tradeability" }).click();
  await expect(page.locator("#perpsIntelLiquidity")).toContainText("Cross-market tradeability comparisons");
  await expect(page.locator("#perpsIntelLiquidity tbody tr")).toHaveCount(0);
  await page.getByRole("tab", { name: "What followed" }).click();
  await expect(page.locator("#perpsIntelOutcomes")).toContainText("Cross-market follow-through");
  await expect(page.locator("#perpsProBoundary")).toBeVisible();
  await expect(page.locator("#perpsProBoundary")).toContainText(/More crowding comparisons.*Spread and depth across markets.*Counted follow-through by condition/s);
  await expect(page.locator("#perpsProWorkspaceLink")).toHaveAttribute("href", /view=perps&instrument_id=hyperliquid%3Aperp%3ASOL/);

  const publicDom = await page.locator("#perpsIntelligence").innerText();
  expect(publicDom).not.toContain("Most tradeable books");
  expect(publicDom).not.toContain("Friction watch");
  expect(publicDom).not.toContain("20-level depth");
  expect(publicDom).not.toMatch(/leaderboard|wallet label/i);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#perpsProBoundary").scrollIntoViewIfNeeded();
  const overflow = await page.locator("#perpsIntelligence").evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});

test("Behavior Lab suppresses unsupported rates and keeps stale wallet-pattern history out of the current result", async ({ page }) => {
  const currentResponse = await page.request.get("/api/behavior");
  const behavior = await currentResponse.json();
  behavior.participation_payoff = participationPayoffProjection();
  behavior.data.actor_evidence.actor_evidence_freshness = "stale";
  behavior.data.actor_evidence.actor_evidence_state = "actor_evidence_stale";
  behavior.data.actor_evidence.public_read_label = "Participant evidence is stale.";
  behavior.data.rows[0].cap_band = "jupiter_velocity";
  behavior.data.rows[0].plain_language_summary = "Jupiter Velocity participation on Solana is mixed or still unclear.";
  await page.route("**/api/behavior", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(behavior) }));
  await page.goto("/behavior/");
  await expect(page.locator("#routeHeadline")).toContainText("Robinhood fresh pairs are working; Solana fresh pairs are punishing recent participation.");
  await expect(page.locator(".behavior-payoff")).toContainText(/Where participation is working.*Robinhood fresh pairs.*6h \+0\.00%.*47 observations.*Solana fresh pairs.*6h -14\.8%.*30 observations/s);
  await expect(page.locator(".behavior-payoff-grid article")).toHaveCount(2);
  await expect(page.locator(".behavior-focus")).toContainText(/Strongest supported slice.*Directional edge.*No directional edge measured.*Coverage/s);
  const first = page.locator(".behavior-matrix article").first();
  await expect(first).toContainText(/Participation.*Directional edge.*Evidence quality.*Coverage/s);
  await expect(first).toContainText(/usable of .* observed.*Developing|Broader sample/s);
  await expect(first).toContainText("Aggregate market behavior");
  await expect(page.locator("#routeSecondaryPanel")).toContainText(/Wallet-pattern history.*Not used in today’s result/s);
  await expect(page.locator("#routeSecondaryPanel")).toContainText(/Older wallet-pattern counts are hidden.*do not affect the headline.*strongest market group.*weakest market group.*directional edge/s);
  await expect(page.locator(".participant-ledger")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/Jupiter velocity/i);
  await expect(page.locator("#routeSecondaryPanel")).toContainText(/No wallet names.*labels.*ownership claims.*coordination claims.*smart money/s);
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/\bParticipant success rate\b|\bSuccess rate\s+50(?:\.00)?%|\bWin-rate band\b/i);
  expect(body).not.toMatch(/\b50(?:\.00)?% success\b/i);
  expect(body).not.toMatch(/\b0x[a-fA-F0-9]{40}\b|\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/);
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.locator("main").evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});

test("Free Behavior Lab shows six market slices with plain labels and benefit-led Pro copy", async ({ page }) => {
  await page.route("**/api/behavior", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(freeParticipantProjection()) }));
  await page.goto("/behavior/");

  await expect(page.locator(".behavior-matrix article")).toHaveCount(6);
  await expect(page.locator(".behavior-focus")).toContainText(/Strongest supported slice.*Directional edge.*No directional edge measured.*Coverage.*usable of .* observed/s);
  await expect(page.locator("#routeSecondaryPanel")).toContainText(/More market slices side by side.*Counted followthrough where available.*Challenge a setup, then return to its chart/s);
  const publicDom = await page.locator("main").innerText();
  expect(publicDom).toMatch(/Solana · Micro caps · 4h/i);
  expect(publicDom).not.toMatch(/\bSuccess rate\s+\d|\bWin-rate band\s+(?:high|low|mixed)|Score strength\s+(?:high|low|strong)/i);
  expect(publicDom).not.toMatch(/complete condition matrix|Free response|server sends/i);
  expect(publicDom).not.toMatch(/\b0x[a-fA-F0-9]{40}\b|\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/);

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.locator("main").evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});

test("Behavior Lab filters exact market slices and only labels counted followthrough as directional evidence", async ({ page }) => {
  const projection = freeParticipantProjection();
  projection.participation_overview[0] = {
    ...projection.participation_overview[0],
    age_cohort: "mature",
    positive_count: 9,
    mixed_count: 3,
    negative_count: 8,
    measured_count: 20,
  };
  projection.participation_overview[3] = {
    ...projection.participation_overview[3],
    age_cohort: "new",
  };
  await page.route("**/api/behavior", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(projection) }));
  await page.goto("/behavior/?chain=solana&cap_band=micro&age_cohort=mature&window=4h");

  await expect(page.locator("#behaviorExplorer")).toBeVisible();
  await expect(page.locator("#behaviorChainFilter")).toHaveValue("solana");
  await expect(page.locator("#behaviorCohortFilter")).toHaveValue("micro");
  await expect(page.locator("#behaviorAgeFilter")).toHaveValue("mature");
  await expect(page.locator("#behaviorWindowFilter")).toHaveValue("4h");
  await expect(page.locator("#behaviorAgeFilterField")).toBeVisible();
  await expect(page.locator(".behavior-matrix article")).toHaveCount(1);
  await expect(page.locator("#behaviorExplorerHighlights")).toContainText(/Best measured result.*9 of 20 \(45\.0%\) ended positive/s);
  await expect(page.locator(".behavior-matrix article")).toContainText(/Directional edge.*9 of 20 \(45\.0%\) ended positive.*Coverage/s);
  await expect(page.locator('.behavior-matrix a[href^="/replay/"]')).toHaveAttribute("href", /chain=solana.*cap_band=micro.*age_cohort=mature.*window=4h.*source=behavior/);
  await expect(page.locator('.behavior-matrix a[href^="/outcomes/"]')).toHaveAttribute("href", /chain=solana.*cap_band=micro.*age_cohort=mature.*window=4h.*source=behavior/);

  await page.locator("#behaviorChainFilter").selectOption("ethereum");
  await expect(page.locator(".behavior-matrix article")).toHaveCount(0);
  await expect(page.locator("#behaviorExplorerSummary")).toContainText(/no current slice matches.*Broader cohorts were not substituted/i);
  await expect(page.locator("#routeHeroSummary")).toContainText(/no completed directional comparison is attached/i);

  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.locator(".behavior-matrix article")).toHaveCount(6);
  const publicDom = await page.locator("main").innerText();
  expect(publicDom).not.toMatch(/Success rate\s+50(?:\.0+)?%|Win-rate band|wallet identity|0x[a-fA-F0-9]{40}/i);

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.locator("main").evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});

test("Behavior-scoped Similar History refuses to widen an unavailable slice", async ({ page }) => {
  const generatedAt = new Date().toISOString();
  await page.route("**/api/replay", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      generated_at: generatedAt,
      delivery: { source: "current_public_origin", fallback: false, freshness_state: "fresh" },
      data: {
        comparables: [{
          chain: "base",
          cap_band: "large",
          window: "24h",
          similarity_score: 0.76,
          after_window_summary: "positive",
          match_reasons: ["participation breadth"],
        }],
      },
    }),
  }));
  await page.goto("/replay/?chain=solana&cap_band=micro&window=4h&source=behavior");

  await expect(page.locator("#routeHeadline")).toContainText(/Similar history is unavailable for Solana · Micro caps · 4h/i);
  await expect(page.locator("#routeHeroSummary")).toContainText(/Broader history was not substituted/i);
  await expect(page.locator("#routePrimaryPanel")).toContainText(/did not widen the chain, market group, age, or window/i);
  await expect(page.locator("#routePrimaryPanel")).not.toContainText(/Base|76(?:\.0)?% similarity/i);
  await expect(page.locator('#routePrimaryPanel a[href^="/outcomes/"]')).toHaveAttribute("href", /chain=solana.*cap_band=micro.*window=4h.*source=behavior/);
  await expect(page.locator('#routePrimaryPanel a[href^="/behavior/"]')).toHaveAttribute("href", /chain=solana.*cap_band=micro.*window=4h.*source=behavior/);
});

test("Behavior-scoped Followthrough counts only the requested settled slice", async ({ page }) => {
  const generatedAt = new Date().toISOString();
  const outcome = (chain, capBand, window, overrides = {}) => ({
    chain,
    cap_band: capBand,
    window,
    validation_status: "confirmed",
    direction: "upside",
    observed_sample: 40,
    usable_sample: 30,
    sample_detail: { observed: 40, usable: 30, unit: "observations" },
    median_move_pct: 4.2,
    rewarding_pct: 60,
    punishing_pct: 20,
    total_liquidity_usd: 125_000,
    confidence: "developing",
    ...overrides,
  });
  await page.route("**/api/outcomes", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      generated_at: generatedAt,
      delivery: { source: "current_public_origin", fallback: false, freshness_state: "fresh" },
      data: {
        count: 2,
        aggregate_validation_state: "developing",
        recent_raven_reads: [],
        outcomes: [outcome("solana", "micro", "4h"), outcome("base", "large", "24h", { median_move_pct: 91 })],
      },
    }),
  }));
  await page.goto("/outcomes/?chain=solana&cap_band=micro&window=4h&source=behavior");

  await expect(page.locator("#routeHeadline")).toContainText(/Followthrough for Solana · Micro caps · 4h/i);
  await expect(page.locator("#routeHeroSummary")).toContainText(/Broader chains, cohorts, and windows are not substituted/i);
  await expect(page.locator(".route-settled-table tbody tr")).toHaveCount(1);
  await expect(page.locator("#routeSecondaryPanel")).toContainText(/Solana · Micro Caps.*4h.*30 \/ 40/is);
  await expect(page.locator("#routeSecondaryPanel")).not.toContainText(/Base|91\.0%/i);
  await expect(page.locator('#routeSecondaryPanel a[href^="/replay/"]')).toHaveAttribute("href", /chain=solana.*cap_band=micro.*window=4h.*source=behavior/);
  await expect(page.locator('#routeSecondaryPanel a[href^="/behavior/"]')).toHaveAttribute("href", /chain=solana.*cap_band=micro.*window=4h.*source=behavior/);
});

test("Behavior Lab keeps an unavailable live feed explicit without stale substitution", async ({ page }) => {
  await page.route("**/api/behavior", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, state: "unavailable" }) }));
  await page.goto("/behavior/");
  await expect(page.locator("#routeHeadline")).toContainText("unavailable");
  await expect(page.locator("#routeHeroSummary")).toContainText(/older (?:participant evidence is not substituted as current|behavior is not presented as a live read)/i);
  await expect(page.locator("#routeHeroSummary")).not.toContainText(/using the last verified public artifact/i);
  await page.setViewportSize({ width: 390, height: 844 });
  const identityCard = page.locator("#routeStateStrip .route-state-card").last();
  await expect(identityCard).toContainText(/Wallet identities.*Not shown/s);
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
