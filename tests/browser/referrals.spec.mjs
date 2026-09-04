import { expect, test } from "@playwright/test";
import { join } from "node:path";

const CODE = "RVN23456789ABCD";
const OWN_CODE = "RVNABCDEFGHJKLM";

async function captureVisual(page, name) {
  const directory = process.env.RAVENOS_VISUAL_ARTIFACT_DIR;
  if (directory) await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true });
}

function referral(overrides = {}) {
  return {
    schema_version: "ravenos.customer_referrals.v1",
    state: "not_created",
    referral_code: null,
    referral_url: null,
    code_created_at: null,
    attribution: null,
    referred_accounts: 0,
    qualified_pro_subscriptions: 0,
    economics: { reward_policy_state: "not_configured", earnings: null, payout_state: "unavailable" },
    boundaries: {
      pro_subscription_evidence_required: true,
      customer_claim_can_create_entitlement: false,
      customer_claim_can_create_credit: false,
      trade_volume_affects_reward: false,
      trading_performance_affects_reward: false,
      referral_is_investment_endorsement: false,
      attribution_replaceable: false,
      billing_reconciliation_enabled: false,
      payouts_available: false,
    },
    ...overrides,
  };
}

async function installAccount(page, baseURL) {
  await page.route("**/api/v1/auth/config", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      available: true,
      canonical_origin: baseURL,
      current_origin: baseURL,
      on_authenticated_origin: true,
      methods: { google: true, email: true, password: true, magic_auth: true, passkey: false },
    }),
  }));
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      authenticated: true,
      account: { username: "chart_witch", email: "raven@example.test" },
      session: { session_public_id: "sespub_referral", current: true, authentication_strength: "managed" },
      csrf_token: "csrf_referral_fixture",
      wallet_links: [],
      wallet_linking_available: false,
      execution_boundary: { signing_available: false, submission_available: false },
    }),
  }));
  await page.route("**/api/v1/sessions", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, csrf_token: "csrf_referral_fixture", sessions: [] }),
  }));
  await page.route("**/api/v1/entitlements", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false }) }));
  await page.route("**/api/v1/portfolio/preview", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false }) }));
}

test("a referral link is carried through sign-in but requires an explicit authenticated claim", async ({ page, baseURL }) => {
  await installAccount(page, baseURL);
  const mutations = [];
  let current = referral();
  await page.route("**/api/v1/referrals/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, referral: current }) });
    mutations.push({
      pathname,
      csrf: request.headers()["x-ravenos-csrf"],
      body: request.postDataJSON(),
    });
    if (pathname.endsWith("/code")) {
      current = referral({
        state: "active",
        referral_code: OWN_CODE,
        referral_url: `${baseURL}/account/?ref=${OWN_CODE}`,
        code_created_at: "2026-09-04T13:00:00.000Z",
      });
    } else {
      current = referral({
        state: "active",
        referral_code: OWN_CODE,
        referral_url: `${baseURL}/account/?ref=${OWN_CODE}`,
        attribution: { state: "recorded", attributed_at: "2026-09-04T13:05:00.000Z" },
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, idempotent: false, referral: current }) });
  });

  await page.goto(`/account/?ref=${CODE}`);
  await expect(page).toHaveURL(/\/account\/$/);
  await expect(page.locator("#accountReferralControls")).toBeVisible();
  await expect(page.locator("#accountReferralClaimCode")).toHaveValue(CODE);
  expect(mutations).toEqual([]);

  await page.locator("#accountReferralCreate").click();
  await expect(page.locator("#accountReferralLink")).toHaveValue(`${baseURL}/account/?ref=${OWN_CODE}`);
  await expect(page.locator("#accountReferralCopy")).toBeVisible();
  await page.locator("#accountReferralClaim").click();
  await expect(page.locator("#accountReferralState")).toHaveText("Attributed");
  await expect(page.locator("#accountReferralClaimForm")).toBeHidden();
  await expect(page.locator("#accountReferralRewards")).toHaveText("Not configured");
  await captureVisual(page, "account-referrals-desktop-1440");
  expect(mutations).toEqual([
    { pathname: "/api/v1/referrals/code", csrf: "csrf_referral_fixture", body: {} },
    { pathname: "/api/v1/referrals/claim", csrf: "csrf_referral_fixture", body: { referral_code: CODE } },
  ]);
  expect(await page.evaluate(() => sessionStorage.getItem("ravenos_pending_referral_code"))).toBeNull();
  expect(await page.evaluate(() => window.__RAVENOS_ACCOUNT__)).toMatchObject({
    referralAttributionRequiresUserAction: true,
    referralClaimCreatesEntitlement: false,
    referralRewardsAvailable: false,
  });
});

test("the dormant account surface never invents referral access or earnings", async ({ page, baseURL }) => {
  await installAccount(page, baseURL);
  await page.route("**/api/v1/referrals/**", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ ok: false, state: "disabled", error: "referrals_disabled" }),
  }));
  await page.goto("/account/");
  await expect(page.locator("#accountReferralState")).toHaveText("Not available");
  await expect(page.locator("#accountReferralControls")).toBeHidden();
  await expect(page.locator("#accountReferralStatus")).toHaveText("Referrals are not open yet.");
  await expect(page.locator("body")).not.toContainText(/\$\d+ earned|payout ready/i);
});
