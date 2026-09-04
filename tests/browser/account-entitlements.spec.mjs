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

async function authenticatedAccount(page, baseURL) {
  await page.route("**/api/v1/auth/config", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(configPayload(baseURL)) }));
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      authenticated: true,
      account: { display_name: "Raven Beta", email: "beta@example.com", member_since: "2026-08-26T15:00:00.000Z" },
      session: { session_public_id: "sespub_current", current: true, authentication_strength: "federated" },
      csrf_token: "csrf_browser_fixture",
      wallet_links: [],
      wallet_linking_available: false,
      execution_boundary: { signing_available: false, submission_available: false },
    }),
  }));
  await page.route("**/api/v1/sessions", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, csrf_token: "csrf_browser_fixture", sessions: [] }) }));
  await page.route("**/api/v1/portfolio/preview", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, state: "not_configured" }) }));
}

function capability(capabilityKey, state, available = false) {
  return { capability: capabilityKey, namespace: "intelligence", implementation_state: "implemented_dormant", available, state, revision: available ? 2 : null };
}

test("dormant Pro foundation is explicit, non-commercial, and does not request advanced projections", async ({ page, baseURL }) => {
  await authenticatedAccount(page, baseURL);
  let advancedRequests = 0;
  await page.route("**/api/v1/entitlements", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ ok: false, state: "unavailable", error: "entitlement_resolution_unavailable", purchasable: false, checkout_available: false }),
  }));
  await page.route("**/api/v1/intelligence/**", (route) => {
    advancedRequests += 1;
    return route.fulfill({ status: 500, body: "must not be requested" });
  });

  await page.goto("/account/");
  await expect(page.locator("#accountProPanel")).toHaveAttribute("data-pro-state", "unavailable");
  await expect(page.locator("#accountProState")).toHaveText("Unavailable");
  await expect(page.locator(".account-pro-capability")).toHaveCount(4);
  await expect(page.locator(".account-pro-capability").nth(2)).toContainText("Advanced Wallet Intelligence");
  await expect(page.locator(".account-pro-capability").nth(3)).toContainText("Agent Workspace");
  await expect(page.locator("#accountProStatus")).toContainText("Pro access isn’t available");
  await expect(page.getByText("Planned · not yet available.")).toBeVisible();
  await expect(page.getByRole("button", { name: /upgrade|checkout|buy|subscribe/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /upgrade|checkout|buy|subscribe/i })).toHaveCount(0);
  expect(advancedRequests).toBe(0);
});

test("authorized Pro projections include the paper Agent Workspace", async ({ page, baseURL }) => {
  await authenticatedAccount(page, baseURL);
  const requested = [];
  await page.route("**/api/v1/entitlements", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "cache-control": "private, no-store" },
    body: JSON.stringify({
      ok: true,
      state: "available",
      purchasable: false,
      checkout_available: false,
      capabilities: [
        capability("intelligence.perps_advanced", "active", true),
        capability("intelligence.participant_advanced", "active", true),
        capability("agents.paper", "active", true),
      ],
    }),
  }));
  await page.route("**/api/v1/intelligence/perps", (route) => {
    requested.push("perps");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "cache-control": "private, no-store" },
      body: JSON.stringify({
        ok: true,
        capability: "intelligence.perps_advanced",
        projection: {
          provenance: { freshness: { state: 'fresh<img src=x onerror="window.__entitlementExecuted=true">' } },
          advanced: { positioning: Array.from({ length: 12 }, () => ({})), pressure_and_crowding: Array.from({ length: 8 }, () => ({})) },
        },
      }),
    });
  });
  await page.route("**/api/v1/intelligence/participants", (route) => {
    requested.push("participants");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "cache-control": "private, no-store" },
      body: JSON.stringify({
        ok: true,
        capability: "intelligence.participant_advanced",
        projection: { provenance: { freshness: { state: "fresh" } }, advanced: { condition_matrix: Array.from({ length: 96 }, () => ({})) } },
      }),
    });
  });
  await page.route("**/api/v1/agents/workspace", (route) => {
    requested.push("agents");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "cache-control": "private, no-store" },
      body: JSON.stringify({
        ok: true,
        environment: "paper",
        live_execution_enabled: false,
        agents: [{ agent_id: "agent_fixture_1", lifecycle_state: "paper" }],
      }),
    });
  });

  await page.goto("/account/");
  await expect(page.locator("#accountProPanel")).toHaveAttribute("data-pro-state", "available");
  await expect(page.locator("#accountProState")).toHaveText("3 available");
  await expect(page.locator(".account-pro-capability[data-state=active]")).toHaveCount(3);
  await expect(page.locator(".account-pro-capability").nth(0)).toContainText("12 positioning markets · 8 pressure markets");
  await expect(page.locator(".account-pro-capability").nth(1)).toContainText("96 aggregate conditions");
  await expect(page.locator(".account-pro-capability").nth(3)).toContainText("1 paper agent · policy and reconciliation ready");
  await expect(page.locator(".account-pro-capability").nth(3)).toContainText("Paper only · live automation off");
  await expect(page.locator("#accountProStatus")).toContainText("read-only");
  await expect(page.locator("#accountProPanel img")).toHaveCount(0);
  expect(await page.evaluate(() => window.__entitlementExecuted === true)).toBe(false);
  expect(requested.sort()).toEqual(["agents", "participants", "perps"]);
});

test("expired and suspended capability states stay denied and usable on mobile", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await authenticatedAccount(page, baseURL);
  let advancedRequests = 0;
  await page.route("**/api/v1/entitlements", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      state: "no_active_capabilities",
      purchasable: false,
      checkout_available: false,
      capabilities: [
        capability("intelligence.perps_advanced", "expired"),
        capability("intelligence.participant_advanced", "suspended"),
      ],
    }),
  }));
  await page.route("**/api/v1/intelligence/**", (route) => {
    advancedRequests += 1;
    return route.fulfill({ status: 500, body: "must not be requested" });
  });

  await page.goto("/account/");
  await expect(page.locator("#accountProPanel")).toHaveAttribute("data-pro-state", "unavailable");
  await expect(page.locator(".account-pro-capability[data-state=expired]")).toContainText("Pro access expired");
  await expect(page.locator(".account-pro-capability[data-state=suspended]")).toContainText("Pro access paused");
  expect(advancedRequests).toBe(0);
  const dimensions = await page.locator("#accountProPanel").evaluate((node) => ({ client: node.clientWidth, scroll: node.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
});
