import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import { routeCustomerEntitlements } from "../../lib/customer_entitlements.mjs";

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

test("mobile no-referrer account requests reach the real entitlement boundary and open all released workspaces", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const user = `usr_${"a".repeat(32)}`;
  const now = Math.floor(Date.now() / 1000);
  let observedHeaders;
  // Read the headers at an actual HTTP server. Playwright interception runs
  // before Chromium attaches Sec-Fetch-Site, so a route mock cannot prove this.
  const server = createServer(async (request, reply) => {
    if (request.url !== "/api/v1/entitlements") {
      const upstream = await fetch(`${baseURL}${request.url}`);
      reply.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") || "text/plain", "referrer-policy": "no-referrer" });
      reply.end(Buffer.from(await upstream.arrayBuffer()));
      return;
    }
    observedHeaders = request.headers;
    const response = await routeCustomerEntitlements(new Request("https://app.ravenos.xyz/api/v1/entitlements", { headers: observedHeaders }), {
      RAVENOS_ENTITLEMENT_RESOLUTION_ENABLE: "1", RAVENOS_PRO_INTELLIGENCE_ROUTES_ENABLE: "1", RAVENOS_PUBLIC_PROJECTION_SPLIT_ENABLE: "1",
      RAVENOS_PRO_PERPS_ADVANCED_ENABLE: "1", RAVENOS_PRO_PARTICIPANT_ADVANCED_ENABLE: "1", RAVENOS_AGENTIC_PAPER_ENABLED: "1",
      RAVENOS_WALLET_INTELLIGENCE_ENABLED: "1", RAVENOS_WALLET_COPY_ROUTES_ENABLED: "1",
    }, {
      authorizeRequest: async () => ({ principal: { user_id: user }, now, response_headers: new Headers() }),
      consumeRateLimit: async () => ({ allowed: true }),
      entitlementStore: { listOwnedGrants: async () => ["intelligence.perps_advanced", "intelligence.participant_advanced", "wallet.copy", "agents.paper"].map((key) => ({
        grant_id: `ent_browser_fixture_${key.replaceAll(".", "_")}`, user_id: user, capability_key: key, state: "active", activation_at: now - 60, expires_at: now + 86400, revision: 1,
      })) },
    });
    const body = await response.text();
    reply.writeHead(response.status, Object.fromEntries(response.headers));
    reply.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    await authenticatedAccount(page, origin);
    for (const path of ["intelligence/perps", "intelligence/participants", "wallet-copy", "agents/workspace"]) {
      await page.route(`**/api/v1/${path}`, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, projection: { advanced: {} }, agents: [] }) }));
    }
    await page.goto(`${origin}/account/`);
    await expect(page.locator("#accountProState")).toHaveText("4 available");
    expect(observedHeaders["sec-fetch-site"]).toBe("same-origin");
    expect(observedHeaders.origin).toBeUndefined();
    expect(observedHeaders.referer).toBeUndefined();
    await expect(page.locator(".account-pro-capability[data-state=active]")).toHaveCount(4);
    await expect(page.locator("#accountProPanel")).not.toContainText("Server disabled");
    const dimensions = await page.locator("#accountProPanel").evaluate((node) => ({ client: node.clientWidth, scroll: node.scrollWidth }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

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
  await expect(page.locator("#accountProStatus")).toContainText("We couldn’t check your Pro features");
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
