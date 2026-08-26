import { expect, test } from "@playwright/test";

function configPayload(origin, { authenticatedOrigin = true } = {}) {
  return {
    ok: true,
    schema_version: "ravenos.customer_auth.v1",
    available: true,
    state: "available",
    canonical_origin: origin,
    current_origin: origin,
    on_authenticated_origin: authenticatedOrigin,
    methods: { google: true, email: true, password: true, magic_auth: true, passkey: false },
    account_model: {
      principal: "ravenos_account",
      wallet_connection_is_sign_in: false,
      wallet_linking_available: false,
      wallet_linking_stage: "after_account_sign_in",
    },
    execution_boundary: {
      wallet_signature_for_authentication: false,
      transaction_signing_available: false,
      submission_available: false,
    },
  };
}

test("anonymous account desk offers Google and managed email paths", async ({ page, baseURL }) => {
  await page.route("**/api/v1/auth/config", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(configPayload(baseURL)) }));
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, authenticated: false }) }));
  await page.goto("/account/");

  await expect(page.locator(".account-page")).toHaveAttribute("data-account-state", "available");
  await expect(page.getByRole("button", { name: /Continue with Google/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Email, password, or code/ })).toBeVisible();
  await expect(page.getByText("Signing in is not trading.")).toBeVisible();
  await expect(page.locator("#accountActivation")).toBeHidden();

  await page.getByRole("tab", { name: "Sign in" }).click();
  await expect(page.locator('#accountGoogleForm input[name="intent"]')).toHaveValue("sign_in");
  await expect(page.locator('#accountManagedForm input[name="intent"]')).toHaveValue("sign_in");
  await expect(page.locator("#accountServiceState")).toHaveText("Sign in to your desk");

  const stored = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage), cookie: document.cookie }));
  expect(stored.local.filter((key) => /auth|session|csrf|email|wallet/i.test(key))).toEqual([]);
  expect(stored.session).toEqual([]);
  expect(stored.cookie).not.toMatch(/ravenos_(?:session|csrf)/i);
});

test("account actions create state on the authenticated origin before navigating to the managed provider", async ({ page, baseURL }) => {
  let startRequest = null;
  await page.route("**/api/v1/auth/config", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(configPayload(baseURL)) }));
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, authenticated: false }) }));
  await page.route("**/api/v1/auth/start", async (route) => {
    startRequest = {
      method: route.request().method(),
      contentType: route.request().headers()["content-type"],
      body: route.request().postDataJSON(),
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        authorization_url: "https://api.workos.com/user_management/authorize?state=ast_browser&provider=authkit&code_challenge=browser_test&code_challenge_method=S256",
      }),
    });
  });
  await page.route("https://api.workos.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Managed sign-in</title>" }));

  await page.goto("/account/");
  await page.getByRole("tab", { name: "Sign in" }).click();
  await page.getByRole("button", { name: /Email, password, or code/ }).click();
  await expect(page).toHaveURL(/^https:\/\/api\.workos\.com\/user_management\/authorize/);

  expect(startRequest).toEqual({
    method: "POST",
    contentType: "application/json",
    body: { intent: "sign_in", provider: "managed", return_to: "/account/" },
  });
  expect(page.url()).not.toContain("return_to");
  expect(page.url()).not.toContain("email");
});

test("authenticated account desk renders profile and revocable session inventory", async ({ page, baseURL }) => {
  await page.route("**/api/v1/auth/config", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(configPayload(baseURL)) }));
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      authenticated: true,
      account: { display_name: "Raven Trader", email: "raven@example.com", member_since: "2026-08-26T15:00:00.000Z" },
      session: { session_public_id: "sespub_current", current: true, authentication_strength: "phishing_resistant" },
      csrf_token: "csrf_browser_fixture",
      wallet_links: [],
      wallet_linking_available: false,
      execution_boundary: { signing_available: false, submission_available: false },
    }),
  }));
  await page.route("**/api/v1/sessions", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      csrf_token: "csrf_browser_fixture",
      sessions: [
        { session_public_id: "sespub_current", current: true, device_label: "Safari on macOS", authenticated_at: "2026-08-26T15:00:00.000Z", last_seen_at: "2026-08-26T15:02:00.000Z", expires_at: "2026-08-26T15:32:00.000Z", authentication_methods: ["Passkey"], authentication_strength: "phishing_resistant" },
        { session_public_id: "sespub_other", current: false, device_label: "Chrome on Windows", authenticated_at: "2026-08-26T14:00:00.000Z", last_seen_at: "2026-08-26T14:30:00.000Z", expires_at: "2026-08-26T15:10:00.000Z", authentication_methods: ["GoogleOAuth"], authentication_strength: "federated" },
      ],
    }),
  }));
  await page.goto("/account/");

  await expect(page.locator(".account-page")).toHaveAttribute("data-account-state", "authenticated");
  await expect(page.locator("#accountDisplayName")).toHaveText("Raven Trader");
  await expect(page.locator("#accountEmail")).toHaveText("raven@example.com");
  await expect(page.locator("#accountSessionCount")).toHaveText("2 sessions");
  await expect(page.locator(".account-session-row")).toHaveCount(2);
  await expect(page.getByText("Safari on macOS · This session")).toBeVisible();
  await expect(page.getByText("Chrome on Windows")).toBeVisible();
  await expect(page.getByText("No wallets linked yet")).toBeVisible();
  await expect(page.locator(".account-dashboard-rail")).toContainText(/Signing[\s\S]*Disabled/);
  await expect(page.locator("#rosProfileTrigger")).toHaveText("R");
  await expect(page.locator("#rosProfileTrigger")).toHaveAttribute("data-account-state", "authenticated");
});

test("account page has strict CSP and no cacheable authenticated HTML", async ({ page }) => {
  const response = await page.goto("/account/");
  expect(response?.status()).toBe(200);
  const headers = response?.headers() || {};
  expect(headers["cache-control"]).toContain("no-store");
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  expect(headers["content-security-policy"]).toContain("form-action 'self'");
  expect(headers["content-security-policy"]).not.toContain("unsafe-inline");
  expect(headers["content-security-policy"]).not.toContain("unsafe-eval");
  expect(headers["x-frame-options"]).toBe("DENY");
});

test("provider profile text cannot become executable account markup", async ({ page, baseURL }) => {
  const hostileName = '<img src=x onerror="window.__profileExecuted=true">Raven';
  await page.route("**/api/v1/auth/config", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(configPayload(baseURL)) }));
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      authenticated: true,
      account: { display_name: hostileName, email: "raven@example.com", member_since: "2026-08-26T15:00:00.000Z" },
      session: { session_public_id: "sespub_current", current: true, authentication_strength: "federated" },
      csrf_token: "csrf_browser_fixture",
      wallet_links: [],
      wallet_linking_available: false,
      execution_boundary: { signing_available: false, submission_available: false },
    }),
  }));
  await page.route("**/api/v1/sessions", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, csrf_token: "csrf_browser_fixture", sessions: [] }) }));
  await page.goto("/account/");

  await expect(page.locator("#accountDisplayName")).toHaveText(hostileName);
  await expect(page.locator("#accountDisplayName img")).toHaveCount(0);
  expect(await page.evaluate(() => window.__profileExecuted === true)).toBe(false);
});

test("an inactive authenticated origin never turns the global account link into a dead cross-origin route", async ({ page, baseURL }) => {
  await page.route("**/api/v1/auth/config", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ...configPayload(baseURL),
      available: false,
      state: "activation_pending",
      canonical_origin: "https://app.ravenos.xyz",
      on_authenticated_origin: false,
      methods: { google: false, email: false, password: false, magic_auth: false, passkey: false },
    }),
  }));
  await page.goto("/account/");
  await page.locator("#rosProfileTrigger").click();
  await expect(page.getByRole("link", { name: /Create account or sign in/ })).toHaveAttribute("href", "/account/");
});
