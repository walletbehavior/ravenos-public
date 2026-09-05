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
  let usernameRequest = null;
  await page.route("**/api/v1/auth/config", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(configPayload(baseURL)) }));
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      authenticated: true,
      account: { username: null, username_required: true, display_name: "Raven Trader", email: "raven@example.com", member_since: "2026-08-26T15:00:00.000Z" },
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
  await page.route("**/api/v1/account/username", async (route) => {
    usernameRequest = {
      method: route.request().method(),
      csrf: route.request().headers()["x-ravenos-csrf"],
      body: route.request().postDataJSON(),
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        account: { username: "chart_witch7", username_required: false, display_name: "@chart_witch7", email: "raven@example.com" },
      }),
    });
  });
  await page.goto("/account/");

  await expect(page.locator(".account-page")).toHaveAttribute("data-account-state", "authenticated");
  await expect(page.locator("#accountDisplayName")).toHaveText("Raven user");
  await expect(page.locator("#accountUsernameState")).toHaveText("Required");
  await expect(page.locator("body")).not.toContainText("Raven Trader");
  await expect(page.locator("#accountEmail")).toHaveText("raven@example.com");
  await expect(page.locator("#accountSessionCount")).toHaveText("2 sessions");
  await expect(page.locator(".account-session-row")).toHaveCount(2);
  await expect(page.getByText("Safari on macOS · This session")).toBeVisible();
  await expect(page.getByText("Chrome on Windows")).toBeVisible();
  await expect(page.getByText("No wallet connected")).toBeVisible();
  await expect(page.locator(".account-dashboard-rail")).toContainText(/Signing[\s\S]*Disabled/);
  await expect(page.locator("#rosProfileTrigger")).toHaveText("R");
  await expect(page.locator("#rosProfileTrigger")).toHaveAttribute("data-account-state", "authenticated");

  await page.locator("#accountUsername").fill("Chart_Witch7");
  await page.locator("#accountUsernameSave").click();
  await expect(page.locator("#accountDisplayName")).toHaveText("@chart_witch7");
  await expect(page.locator("#accountUsernameState")).toHaveText("Active");
  await expect(page.locator("#accountUsernameStatus")).toHaveText("Username saved.");
  await expect(page.locator("#rosProfileTrigger")).toHaveText("C");
  expect(usernameRequest).toEqual({ method: "PUT", csrf: "csrf_browser_fixture", body: { username: "chart_witch7" } });
});

test("optional Raven Wallet provisions Solana and EVM and clears Privy on Raven logout", async ({ page, baseURL }) => {
  const calls = [];
  let privyLogoutCalled = false;
  await page.exposeFunction("__recordPrivyLogout", () => { privyLogoutCalled = true; });
  await page.addInitScript(() => {
    globalThis.__RAVENOS_PRIVY_WALLET_FACTORY__ = {
      create() {
        return {
          sync: async () => { globalThis.__PRIVY_TEST_CALLS__.push("sync"); },
          provision: async () => { globalThis.__PRIVY_TEST_CALLS__.push("provision"); },
          identityToken: async () => "header.payload.signature",
          logout: async () => {
            globalThis.__PRIVY_TEST_CALLS__.push("logout");
            await globalThis.__recordPrivyLogout();
          },
        };
      },
    };
    globalThis.__PRIVY_TEST_CALLS__ = [];
  });
  await page.route("**/api/v1/auth/config", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(configPayload(baseURL)) }));
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true, authenticated: true,
      account: { username: "raven_test", email: "raven@example.com" },
      session: { session_public_id: "sespub_current", current: true },
      csrf_token: "csrf_browser_fixture",
    }),
  }));
  await page.route("**/api/v1/sessions", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, sessions: [], csrf_token: "csrf_browser_fixture" }) }));
  await page.route("**/api/v1/auth/logout", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }));
  await page.route("**/api/v1/wallets/privy**", async (route) => {
    const url = new URL(route.request().url());
    calls.push({ path: url.pathname, method: route.request().method(), csrf: route.request().headers()["x-ravenos-csrf"] || null });
    if (url.pathname.endsWith("/session")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, token: "raven.wallet.token", wallets: { solana: true, evm: true } }) });
    if (url.pathname.endsWith("/link")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      ok: true, linked: true, wallets: [
        { ecosystem: "evm", address: "0x1111111111111111111111111111111111111111" },
        { ecosystem: "solana", address: "Stake11111111111111111111111111111111111111" },
      ],
    }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      ok: true, available: true, linked: false, app_id: "cmtna91zp004m0cjss6lill1d", client_id: "client-test",
      capabilities: { evm: true, solana: true, manual_signing: false, delegated_signing: false }, wallets: [],
    }) });
  });

  await page.goto("/account/");
  await expect(page.locator("#accountPrivyPanel")).toBeVisible();
  await page.locator("#accountPrivyCreate").click();
  await expect(page.locator(".account-privy-wallet")).toHaveCount(2);
  await expect(page.locator("#accountPrivyState")).toHaveText("Ready");
  expect(await page.evaluate(() => globalThis.__PRIVY_TEST_CALLS__)).toEqual(["sync", "provision"]);
  expect(calls.filter((call) => call.method === "POST")).toEqual([
    { path: "/api/v1/wallets/privy/session", method: "POST", csrf: "csrf_browser_fixture" },
    { path: "/api/v1/wallets/privy/link", method: "POST", csrf: "csrf_browser_fixture" },
  ]);
  await expect(page.locator("#accountEmail")).toHaveText("raven@example.com");
  await page.locator("#accountLogout").click();
  await expect.poll(() => privyLogoutCalled).toBe(true);
});

test("optional Raven Wallet describes an EVM-only rollout honestly", async ({ page, baseURL }) => {
  await page.route("**/api/v1/auth/config", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(configPayload(baseURL)) }));
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({
      ok: true, authenticated: true, account: { username: "raven_test", email: "raven@example.com" },
      session: { session_public_id: "sespub_current", current: true }, csrf_token: "csrf_browser_fixture",
    }),
  }));
  await page.route("**/api/v1/sessions", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, sessions: [], csrf_token: "csrf_browser_fixture" }) }));
  await page.route("**/api/v1/wallets/privy", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({
      ok: true, available: true, linked: false, app_id: "cmtna91zp004m0cjss6lill1d", client_id: "client-test",
      capabilities: { evm: true, solana: false, manual_signing: false, delegated_signing: false }, wallets: [],
    }),
  }));
  await page.goto("/account/");
  await expect(page.locator("#accountPrivyStatus")).toHaveText("Creates your EVM wallet without changing your login.");
  await expect(page.locator("#accountPrivyStatus")).not.toContainText("Solana");
});

test("portfolio holdings stay compact and preserve unavailable cost basis and supply data", async ({ page, baseURL }) => {
  await page.route("**/api/v1/auth/config", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(configPayload(baseURL)) }));
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      authenticated: true,
      account: { display_name: "Raven Trader", email: "raven@example.com" },
      session: { session_public_id: "sespub_current", current: true, authentication_strength: "managed" },
      csrf_token: "csrf_browser_fixture",
      wallet_links: [],
      wallet_linking_available: false,
      execution_boundary: { signing_available: false, submission_available: false },
    }),
  }));
  await page.route("**/api/v1/sessions", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, csrf_token: "csrf_browser_fixture", sessions: [] }) }));
  await page.route("**/api/v1/entitlements", (route) => route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ ok: false }) }));
  await page.route("**/api/v1/portfolio/preview", (route) => {
    if (route.request().method() === "GET") return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, wallets: [{ wallet_reference: "wallet_fixture", label: "Primary" }] }),
    });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        state: "partial",
        boundaries: { read_only: true, customer_assets_can_move: false, transaction_material_created: false, signing_requested: false },
        provenance: { raw_wallet_address_in_records: false },
        summary: {},
        holdings: {
          returned_position_count: 2,
          rows: [
            { instrument: { symbol: "USDC", label: "USD Coin", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" }, amount_base_units: "250000000", decimals: 6, supply_share_bps: null, marked_value_minor: "249500000", marked_value_state: "current", executable_value_minor: "248000000", executable_value_state: "current", resolution_state: "resolved", protocol: "wallet", evidence_state: ["current"] },
            { instrument: { symbol: "BONK", label: "Bonk", mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6TVCdYaB1pPB263" }, amount_base_units: "1000000000000", decimals: 5, marked_value_minor: "12340000", marked_value_state: "current", executable_value_minor: null, executable_value_state: "unavailable", resolution_state: "partial", protocol: "wallet", evidence_state: ["exit_unavailable"] },
          ],
        },
        economic_exposure: { assets: [] },
        protocol_exposure: [],
        stablecoin_exposure: { issuers: [], dependencies: [] },
        unresolved_and_unsupported: { positions: [], unsupported_capabilities: [] },
        policy: { state: "not_configured", findings: [] },
        freshness: {},
        diagnostics: { provider_call_counts: {}, exposure_rows: {}, conservation: { passed: true } },
      }),
    });
  });

  await page.goto("/account/");
  await page.locator("#accountGovernorAnalyze").click();
  await expect(page.locator(".account-holding-row")).toHaveCount(2);
  await expect(page.locator(".account-holding-columns")).toContainText("% supply");
  const usdc = page.locator(".account-holding-row").first();
  await expect(usdc).toContainText("USDC");
  await expect(usdc).toContainText("250");
  await expect(usdc).toContainText("$0.998");
  await expect(usdc).toContainText("executable $0.992");
  await expect(usdc.locator('[data-label="Supply"] strong')).toHaveText("Unavailable");
  await expect(usdc.locator('[data-label="Avg entry"] strong')).toHaveText("Unavailable");
  await expect(usdc.locator('[data-label="Current P&L"] strong')).toHaveText("Unavailable");

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
});

test("signed-in users can connect Solana or EVM addresses read only without signatures or persistence", async ({ page, baseURL }) => {
  const solanaAddress = "Stake11111111111111111111111111111111111111";
  const evmAddress = "0x1111111111111111111111111111111111111111";
  await page.addInitScript(({ solanaAddress, evmAddress }) => {
    globalThis.__ACCOUNT_WALLET_CALLS__ = [];
    const publicKey = { toString: () => solanaAddress };
    globalThis.phantom = {
      solana: {
        publicKey,
        connect: async () => {
          globalThis.__ACCOUNT_WALLET_CALLS__.push("solana:connect");
          return { publicKey };
        },
        signMessage: async () => {
          globalThis.__ACCOUNT_WALLET_CALLS__.push("solana:signMessage");
          throw new Error("must_not_sign");
        },
      },
    };
    globalThis.ethereum = {
      request: async ({ method }) => {
        globalThis.__ACCOUNT_WALLET_CALLS__.push(`evm:${method}`);
        return method === "eth_requestAccounts" ? [evmAddress] : [];
      },
    };
  }, { solanaAddress, evmAddress });
  await page.route("**/api/v1/auth/config", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(configPayload(baseURL)) }));
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      authenticated: true,
      account: { display_name: "Raven Trader", email: "raven@example.com" },
      session: { session_public_id: "sespub_current", current: true, authentication_strength: "managed" },
      csrf_token: "csrf_browser_fixture",
      wallet_links: [],
      wallet_linking_available: false,
      execution_boundary: { signing_available: false, submission_available: false },
    }),
  }));
  await page.route("**/api/v1/sessions", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, csrf_token: "csrf_browser_fixture", sessions: [] }) }));
  await page.route("**/api/v1/entitlements", (route) => route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ ok: false }) }));
  await page.route("**/api/v1/portfolio/preview", (route) => route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ ok: false }) }));
  await page.goto("/account/");

  await page.getByRole("button", { name: "Solana", exact: true }).click();
  await expect(page.locator("#accountWalletConnectionState")).toHaveText("Connected");
  await expect(page.locator("#accountWalletConnectionTitle")).toHaveText("Stake11…11111");
  await expect(page.locator("#accountWalletConnectStatus")).toHaveText("Phantom connected · no signature");
  await expect(page.locator("#accountConnectSolana")).toHaveAttribute("data-connected", "true");

  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.locator("#accountWalletConnectionTitle")).toHaveText("No wallet connected");
  await page.getByRole("button", { name: "EVM", exact: true }).click();
  await expect(page.locator("#accountWalletConnectionTitle")).toHaveText("0x11111…11111");
  await expect(page.locator("#accountWalletConnectStatus")).toHaveText("EVM connected · no signature");

  expect(await page.evaluate(() => globalThis.__ACCOUNT_WALLET_CALLS__)).toEqual(["solana:connect", "evm:eth_requestAccounts"]);
  const persisted = await page.evaluate((addresses) => JSON.stringify({ ...localStorage, ...sessionStorage }).includes(addresses[0]) || JSON.stringify({ ...localStorage, ...sessionStorage }).includes(addresses[1]), [solanaAddress, evmAddress]);
  expect(persisted).toBe(false);
  expect(await page.evaluate(() => window.__RAVENOS_ACCOUNT__)).toMatchObject({
    browserWalletConnectionAvailable: true,
    walletConnectionScope: "public_address_observation_only",
    walletConnectionPersisted: false,
    signingAvailable: false,
    submissionAvailable: false,
  });
});

test("account page has strict CSP and no cacheable authenticated HTML", async ({ page }) => {
  const response = await page.goto("/account/");
  expect(response?.status()).toBe(200);
  const headers = response?.headers() || {};
  expect(headers["cache-control"]).toContain("no-store");
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  expect(headers["content-security-policy"]).toContain("frame-src https://auth.privy.io");
  expect(headers["content-security-policy"]).toContain("connect-src 'self' https://auth.privy.io");
  expect(headers["content-security-policy"]).toContain("form-action 'self'");
  expect(headers["content-security-policy"]).not.toContain("unsafe-inline");
  expect(headers["content-security-policy"]).not.toContain("unsafe-eval");
  expect(headers["x-frame-options"]).toBe("DENY");
});

test("provider profile names are ignored rather than becoming RavenOS identity", async ({ page, baseURL }) => {
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

  await expect(page.locator("#accountDisplayName")).toHaveText("Raven user");
  await expect(page.locator("body")).not.toContainText(hostileName);
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
