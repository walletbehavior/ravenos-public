import { expect, test } from "@playwright/test";

const memberSince = "2026-06-01T00:00:00.000Z";

function profile(overrides = {}) {
  return {
    schema_version: "ravenos.community_profile.v1",
    username: "verified_edge",
    profile_url: "https://ravenos.xyz/@verified_edge",
    member_since: memberSince,
    public_disclosures: {
      performance: true,
      positions: false,
      trade_history: false,
      strategy_breakdown: true,
      wallet_addresses: false,
      followers: true,
    },
    availability: {
      following: true,
      shadowing: false,
      raven_copy: false,
      public_referral_link: false,
    },
    followers_count: 18,
    useful_count: 7,
    performance: [{
      period: "90d",
      classification: "raven_observed",
      evidence_state: "available",
      sample_count: 42,
      evidence_confidence_pct: 92,
      return_pct: 18.4,
      maximum_drawdown_pct: 7.1,
      profit_factor: 1.7,
      profitable_period_share_pct: 69.23,
      copyability_score: null,
      provenance: { source_contract_id: "ravenos.portfolio_outcome.v1" },
    }],
    boundaries: {
      account_balance_public: false,
      connected_account_identifiers_public: false,
      email_public: false,
      legal_name_public: false,
      wallet_addresses_default_public: false,
      popularity_affects_performance_rank: false,
    },
    ...overrides,
  };
}

function boardPayload() {
  return {
    ok: true,
    schema_version: "ravenos.community.v1",
    board: {
      id: "most_consistent",
      label: "Most consistent",
      period: "90d",
      minimum_sample_count: 20,
      minimum_confidence_pct: 80,
      ranking_basis: "profitable_period_share",
    },
    state: "available",
    rows: [{
      rank: 1,
      username: "verified_edge",
      profile_url: "https://ravenos.xyz/@verified_edge",
      member_since: memberSince,
      followers_count: 18,
      useful_count: 7,
      ranking_basis: "profitable_period_share",
      evidence: profile().performance[0],
    }],
    boundaries: {
      popularity_affects_performance_rank: false,
      user_reported_eligible: false,
      public_balance_used: false,
      deterministic_tie_breaker: "username_ascending",
    },
  };
}

test("Community renders an evidence-qualified board without return-only or balance claims", async ({ page }) => {
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, authenticated: false }),
  }));
  await page.route("**/api/v1/community/boards**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(boardPayload()),
  }));

  await page.goto("/community/");
  await expect(page.getByRole("heading", { name: "Good process travels." })).toBeVisible();
  await expect(page.getByText("@verified_edge", { exact: true })).toBeVisible();
  await expect(page.getByText("69.2%", { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Account balance");
  await expect(page.locator("body")).not.toContainText("Biggest gain");
  if (process.env.RAVENOS_CAPTURE_COMMUNITY_SCREENSHOTS === "1") {
    await page.screenshot({ path: "test-results/community-board.png", fullPage: true });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("authenticated profile controls start private and save an exact CSRF-bound opt-in", async ({ page }) => {
  let savedRequest = null;
  const privateSettings = {
    public_profile_enabled: false,
    performance_visible: false,
    positions_visible: false,
    trade_history_visible: false,
    strategy_breakdown_visible: false,
    wallet_addresses_visible: false,
    followers_visibility: "private",
    allow_following: false,
    allow_shadowing: false,
    allow_raven_copy: false,
    referral_link_public: false,
  };
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, authenticated: true, username: "chart_witch", csrf_token: "csrf_community_fixture" }),
  }));
  await page.route("**/api/v1/community/boards**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ...boardPayload(), state: "insufficient_evidence", rows: [] }),
  }));
  await page.route("**/api/v1/community/me", async (route) => {
    if (route.request().method() === "PUT") {
      savedRequest = route.request();
      const submitted = JSON.parse(route.request().postData() || "{}");
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, profile: { username: "chart_witch", profile_revision: 1, profile_url: "https://ravenos.xyz/@chart_witch", settings: submitted.settings } }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, profile: { username: "chart_witch", username_required: false, profile_revision: 0, profile_url: null, settings: privateSettings } }),
    });
  });

  await page.goto("/community/");
  await page.getByRole("button", { name: "Your profile" }).click();
  await expect(page.getByText("Email, legal name, balances, connected accounts, and copy allocations stay private.")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Public profile" })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Wallet addresses" })).not.toBeChecked();
  await page.getByRole("checkbox", { name: "Public profile" }).check();
  await page.getByRole("checkbox", { name: "Performance" }).check();
  await page.getByRole("checkbox", { name: "Following", exact: true }).check();
  await page.getByRole("button", { name: "Save controls" }).click();
  await expect(page.getByText("Profile public", { exact: true })).toBeVisible();
  expect(savedRequest).not.toBeNull();
  expect((await savedRequest.allHeaders())["x-ravenos-csrf"]).toBe("csrf_community_fixture");
  const submitted = JSON.parse(savedRequest.postData());
  expect(submitted.expected_revision).toBe(0);
  expect(submitted.settings.public_profile_enabled).toBe(true);
  expect(submitted.settings.performance_visible).toBe(true);
  expect(submitted.settings.wallet_addresses_visible).toBe(false);
});

test("public profile labels evidence and authenticated actions never expose private identity", async ({ page }) => {
  const actions = [];
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, authenticated: true, username: "observer", csrf_token: "csrf_profile_fixture" }),
  }));
  await page.route("**/api/v1/community/following", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, state: "empty", rows: [] }),
  }));
  await page.route("**/api/v1/community/profiles/verified_edge", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, profile: profile() }),
  }));
  await page.route("**/api/v1/community/profiles/verified_edge/**", async (route) => {
    actions.push({ path: new URL(route.request().url()).pathname, method: route.request().method(), headers: await route.request().allHeaders() });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.goto("/@verified_edge");
  await expect(page.getByRole("heading", { name: "@verified_edge" })).toBeVisible();
  await expect(page.getByText("Raven observed", { exact: true })).toBeVisible();
  await expect(page.getByText("+18.4%", { exact: true })).toBeVisible();
  await expect(page.getByText("Unavailable", { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("example.test");
  await expect(page.locator("body")).not.toContainText("Legal name");
  await page.getByRole("button", { name: "Follow" }).click();
  await page.getByRole("button", { name: "Useful" }).click();
  await expect(page.getByRole("button", { name: "Following" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Useful ✓" })).toBeVisible();
  expect(actions).toHaveLength(2);
  expect(actions.every((row) => row.method === "PUT" && row.headers["x-ravenos-csrf"] === "csrf_profile_fixture")).toBe(true);
  if (process.env.RAVENOS_CAPTURE_COMMUNITY_SCREENSHOTS === "1") {
    await page.screenshot({ path: "test-results/community-profile.png", fullPage: true });
  }
});
