import { expect, test } from "@playwright/test";

function configPayload(origin) {
  return {
    ok: true,
    schema_version: "ravenos.customer_auth.v1",
    available: true,
    state: "available",
    canonical_origin: origin,
    current_origin: origin,
    on_authenticated_origin: true,
    methods: { google: true, email: true, password: true, magic_auth: true, passkey: false },
    account_model: { principal: "ravenos_account", wallet_connection_is_sign_in: false, wallet_linking_available: false },
    execution_boundary: { wallet_signature_for_authentication: false, transaction_signing_available: false, submission_available: false },
  };
}

function sessionPayload(authenticated = true) {
  return authenticated
    ? {
        ok: true,
        authenticated: true,
        account: { display_name: "Raven Beta", email: "beta@example.com" },
        session: { session_public_id: "sespub_current", current: true, authentication_strength: "federated" },
        wallet_links: [],
        wallet_linking_available: false,
        execution_boundary: { signing_available: false, submission_available: false },
      }
    : { ok: true, authenticated: false, account: null, session: null };
}

function capability(key, state = "active", available = true) {
  return {
    capability: key,
    namespace: "intelligence",
    implementation_state: "implemented_dormant",
    available,
    state,
    revision: available ? 3 : null,
  };
}

function entitlementPayload(capabilities) {
  return {
    ok: true,
    schema_version: "ravenos.customer_entitlements.v1",
    state: capabilities.some((row) => row.available) ? "available" : "no_active_capabilities",
    capabilities,
    purchasable: false,
    checkout_available: false,
    customer_mutation_available: false,
    atlas_display_rights_override_available: false,
  };
}

function perpRow(coin, overrides = {}) {
  return {
    instrument_id: `hyperliquid:perp:${coin}`,
    symbol: `${coin}-PERP`,
    venue: "Hyperliquid",
    instrument_group: "Majors",
    funding_rate: 0.0000125,
    funding_regime: "Funding neutral",
    open_interest_usd: 900_000_000,
    day_volume_usd: 1_200_000_000,
    mark_price: 100,
    spread_bps: 0.14,
    depth_20_usd: 8_000_000,
    liquidity_quality: "deep",
    pressure_state: "Mixed pressure",
    pressure_direction: "two-sided pressure context",
    coverage: "active",
    ...overrides,
  };
}

function proPerpsPayload() {
  const generatedAt = new Date().toISOString();
  const sol = perpRow("SOL");
  const btc = perpRow("BTC", { funding_regime: 'Funding <img src=x onerror="window.__proExecuted=true">', instrument_group: "Majors" });
  return {
    ok: true,
    schema_version: "ravenos.customer_entitlements.v1",
    capability: "intelligence.perps_advanced",
    entitlement_revision: 3,
    projection: {
      ok: true,
      schema_version: "ravenos.customer_intelligence_projection.v1",
      intelligence_kind: "perps",
      access_scope: "pro",
      generated_at: generatedAt,
      provenance: { source_category: "current_public_safe_projection", freshness: { state: "fresh", generated_at: generatedAt } },
      overview: { state: "active", markets_observed: 176, books_observed: 176 },
      selected_market: { state: "available", instrument_id: sol.instrument_id, market: sol },
      market_overview: [sol, btc],
      limitations: { liquidation_data: "unavailable_no_qualified_stream", actor_leaderboards: "withheld_pending_separate_qualification" },
      advanced: {
        positioning: [sol, btc],
        pressure_and_crowding: [perpRow("HYPE", { pressure_state: "Long crowding watch", pressure_direction: "downside pressure context" })],
        liquidity: {
          tightest_books: [sol],
          wide_or_thin_books: [perpRow("DOGE", { liquidity_quality: "thin", spread_bps: 21.4, depth_20_usd: 72_000 })],
        },
        outcomes: {
          forward_observation: { observations: 18, matured_windows: { "15m": 18, "1h": 18, "4h": 16, "12h": 9 }, sample_caveat: "Forward sample is still forming." },
          attribution: {
            public_caveat: "Aggregate validation context only.",
            groups: {
              funding_regime: [{ label: "Funding posture", group: "Funding neutral", read: "Mixed followthrough", sample_size: 18, confidence: "developing", median_observed_change_pct: 0.4 }],
              pressure_bucket: [], instrument_group: [], liquidity_attraction: [], structure: [],
            },
          },
        },
        filters: {
          instrument_groups: ["Majors"],
          funding_regimes: ["Funding neutral"],
          pressure_states: ["Mixed pressure", "Long crowding watch"],
          liquidity_qualities: ["deep", "thin"],
        },
      },
    },
  };
}

function participantRow(chain, cap, overrides = {}) {
  return {
    chain,
    capitalization_band: cap,
    window: "4h",
    participation_trend: "expanding",
    observed_sample: 52,
    usable_sample: 44,
    interpretation: "Aggregate participation is expanding.",
    participant_success_rate: 0.613,
    win_rate_band: "55-65%",
    confidence: "qualified",
    score_strength: "strong",
    outcome_strength: "constructive",
    average_outcome_classification: "positive",
    outcome_context: "Historical aggregate context only.",
    sample_integrity: { observed: 52, usable: 44, excluded_or_unusable: 8 },
    ...overrides,
  };
}

function proParticipantsPayload() {
  const generatedAt = new Date().toISOString();
  return {
    ok: true,
    schema_version: "ravenos.customer_entitlements.v1",
    capability: "intelligence.participant_advanced",
    entitlement_revision: 3,
    projection: {
      ok: true,
      schema_version: "ravenos.customer_intelligence_projection.v1",
      intelligence_kind: "participants",
      access_scope: "pro",
      generated_at: generatedAt,
      provenance: { source_category: "current_public_safe_projection", freshness: { state: "fresh", generated_at: generatedAt } },
      headline: { state: "available", aggregate_evidence_freshness: "fresh", conditions_observed: 97 },
      participation_overview: [],
      limitations: { aggregation: "aggregate_conditions_only", wallet_identity: "not_included" },
      advanced: {
        condition_matrix: [
          participantRow("solana", "micro"),
          participantRow('base<script>window.__proExecuted=true</script>', "mid", { participation_trend: "selective" }),
          participantRow("ethereum", "large", { window: "1h", outcome_strength: "mixed" }),
        ],
        filters: {
          chains: ["solana", "base", "ethereum"],
          capitalization_bands: ["micro", "mid", "large"],
          windows: ["1h", "4h"],
        },
      },
    },
  };
}

async function routeAuth(page, baseURL, { authenticated = true } = {}) {
  await page.route("**/api/v1/auth/config", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(configPayload(baseURL)) }));
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sessionPayload(authenticated)) }));
}

test("signed-out Pro workspace canonicalizes return context and never requests private projections", async ({ page, baseURL }) => {
  await routeAuth(page, baseURL, { authenticated: false });
  let entitlementRequests = 0;
  let projectionRequests = 0;
  await page.route("**/api/v1/entitlements", (route) => { entitlementRequests += 1; return route.fulfill({ status: 500, body: "must not request" }); });
  await page.route("**/api/v1/intelligence/**", (route) => { projectionRequests += 1; return route.fulfill({ status: 500, body: "must not request" }); });

  await page.goto("/account/intelligence/?view=participants&instrument_id=hyperliquid%3Aperp%3ASOL&owner=usr_forged&capability=atlas.options_intelligence&token=browser-secret");
  await expect(page.locator(".pro-intelligence-page")).toHaveAttribute("data-workspace-state", "signed_out");
  await expect(page.locator("#proWorkspaceSignIn")).toBeVisible();
  const current = new URL(page.url());
  expect([...current.searchParams.keys()].sort()).toEqual(["instrument_id", "view"]);
  expect(current.searchParams.get("view")).toBe("participants");
  expect(current.searchParams.get("instrument_id")).toBe("hyperliquid:perp:SOL");
  const returns = await page.locator("[data-pro-return-to]").evaluateAll((inputs) => inputs.map((input) => input.value));
  expect(new Set(returns)).toEqual(new Set(["/account/intelligence/?view=participants&instrument_id=hyperliquid%3Aperp%3ASOL"]));
  expect(entitlementRequests).toBe(0);
  expect(projectionRequests).toBe(0);
  await expect(page.locator('input[name="token"], input[name="owner"], input[name="capability"]')).toHaveCount(0);
});

test("active owner-resolved capabilities render bounded private Perps and Participant views", async ({ page, baseURL }) => {
  await routeAuth(page, baseURL);
  const requested = [];
  await page.route("**/api/v1/entitlements", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "cache-control": "private, no-store" },
    body: JSON.stringify(entitlementPayload([
      capability("intelligence.perps_advanced"),
      capability("intelligence.participant_advanced"),
    ])),
  }));
  await page.route("**/api/v1/intelligence/perps", (route) => {
    requested.push("perps");
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "private, no-store" }, body: JSON.stringify(proPerpsPayload()) });
  });
  await page.route("**/api/v1/intelligence/participants", (route) => {
    requested.push("participants");
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "private, no-store" }, body: JSON.stringify(proParticipantsPayload()) });
  });

  await page.goto("/account/intelligence/?view=perps&instrument_id=hyperliquid%3Aperp%3ASOL");
  await expect(page.locator("#proWorkspaceState")).toHaveText("2 Pro views ready");
  await expect(page.locator("#proPerpsProjection")).toBeVisible();
  await expect(page.locator('#proPerpsContent tr[data-selected-market="true"]')).toContainText("SOL-PERP");
  await expect(page.locator("#proPerpsContent")).toContainText("Funding neutral");
  await expect(page.locator("#proPerpsContent img, #proPerpsContent script")).toHaveCount(0);
  expect(await page.evaluate(() => window.__proExecuted === true)).toBe(false);

  const perpsSubtab = page.getByRole("tab", { name: "Positioning" });
  await perpsSubtab.focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Outcomes" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#proPerpsContent")).toContainText(/12h matured.*9.*18 observations/s);

  const mainTab = page.getByRole("tab", { name: "Perps Intelligence" });
  await mainTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Participant Intelligence" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#proParticipantsContent")).toContainText(/61\.3%.*55-65%.*44 usable \/ 52 observed \/ 8 excluded/s);
  await expect(page.locator("#proParticipantsContent img, #proParticipantsContent script")).toHaveCount(0);
  expect(await page.evaluate(() => window.__proExecuted === true)).toBe(false);

  await page.locator('#proParticipantFilters select[data-filter="chain"]').selectOption("solana");
  await expect(page.locator("#proParticipantsContent tbody tr")).toHaveCount(1);
  await expect(page.locator("#proParticipantsContent")).toContainText("Solana · Micro");
  expect(requested.sort()).toEqual(["participants", "perps"]);
  await expect(page.getByRole("button", { name: /upgrade|checkout|buy|subscribe/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /upgrade|checkout|buy|subscribe/i })).toHaveCount(0);
});

test("authenticated workspace shows a non-commercial unavailable state while server controls are off", async ({ page, baseURL }) => {
  await routeAuth(page, baseURL);
  let projectionRequests = 0;
  await page.route("**/api/v1/entitlements", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    headers: { "cache-control": "private, no-store" },
    body: JSON.stringify({ ok: false, state: "unavailable", error: "entitlement_resolution_unavailable", purchasable: false, checkout_available: false }),
  }));
  await page.route("**/api/v1/intelligence/**", (route) => { projectionRequests += 1; return route.fulfill({ status: 500, body: "must not request" }); });

  await page.goto("/account/intelligence/");
  await expect(page.locator("#proWorkspaceState")).toHaveText("Pro access unavailable");
  await expect(page.locator("#proPerpsMessage")).toContainText("Pro access unavailable");
  await expect(page.locator("#proParticipantsMessage")).toContainText("Pro access unavailable");
  await expect(page.getByRole("button", { name: /upgrade|checkout|buy|subscribe/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /upgrade|checkout|buy|subscribe/i })).toHaveCount(0);
  expect(projectionRequests).toBe(0);
});

test("denied grant lifecycle states stay explicit and never request private data", async ({ page, baseURL }) => {
  await routeAuth(page, baseURL);
  let grantState = "expired";
  let projectionRequests = 0;
  await page.route("**/api/v1/entitlements", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(entitlementPayload([
      capability("intelligence.perps_advanced", grantState, false),
      capability("intelligence.participant_advanced", grantState, false),
    ])),
  }));
  await page.route("**/api/v1/intelligence/**", (route) => { projectionRequests += 1; return route.fulfill({ status: 500, body: "must not request" }); });

  for (const [state, label] of [["expired", "Access expired"], ["suspended", "Access suspended"], ["revoked", "Access removed"], ["not_granted", "Pro access not available"]]) {
    grantState = state;
    await page.goto(`/account/intelligence/?view=${state === "suspended" ? "participants" : "perps"}`);
    await expect(page.locator(state === "suspended" ? "#proParticipantsMessage" : "#proPerpsMessage")).toContainText(label);
    await expect(page.locator("#proWorkspaceState")).toHaveText("Pro access not available");
  }
  expect(projectionRequests).toBe(0);
});

test("Pro workspace stays readable and contained at 390px without exposing execution or Atlas data", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await routeAuth(page, baseURL);
  await page.route("**/api/v1/entitlements", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(entitlementPayload([capability("intelligence.perps_advanced"), capability("intelligence.participant_advanced", "not_granted", false)])),
  }));
  await page.route("**/api/v1/intelligence/perps", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(proPerpsPayload()) }));
  await page.route("**/api/v1/intelligence/participants", (route) => route.fulfill({ status: 500, body: "must not request" }));

  await page.goto("/account/intelligence/?view=perps&instrument_id=hyperliquid%3Aperp%3ASOL");
  await page.getByRole("tab", { name: "Liquidity" }).click();
  await expect(page.locator("#proPerpsContent")).toContainText(/Tightest books.*Wide or thin books/s);
  const documentOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(documentOverflow).toBeLessThanOrEqual(2);
  const workspaceOverflow = await page.locator("#proWorkspace").evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(workspaceOverflow).toBeLessThanOrEqual(2);
  const text = await page.locator("body").innerText();
  expect(text).toContain("This workspace cannot connect a wallet, place an order, or manage a position.");
  expect(text).toContain("Atlas availability stays separate");
  expect(text).not.toMatch(/Tradier|Massive|Polygon|FRED|API key|provider payload/i);
});
