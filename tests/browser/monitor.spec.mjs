import { expect, test } from "@playwright/test";

const POOL_A = "11111111111111111111111111111111";

function authConfig(origin) {
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

function session() {
  return {
    ok: true,
    authenticated: true,
    account: { display_name: "Saved Monitor Tester", email: "monitor@example.com" },
    session: { session_public_id: "sespub_monitor", current: true },
    csrf_token: "csrf_monitor_fixture",
    wallet_links: [],
    wallet_linking_available: false,
    execution_boundary: { signing_available: false, submission_available: false },
  };
}

function savedItem(body, overrides = {}) {
  const instrumentId = body.market.instrument_id;
  const query = new URLSearchParams({
    instrument_id: instrumentId,
    instrument_type: "exact_pool",
    identity_scope: "exact_pool",
    asset_class: "crypto",
    chain: "solana",
    venue: "meteora",
    market: "spot",
    timeframe: body.workspace.timeframe,
    indicators: body.workspace.indicators.join(","),
    raven_overlays: body.workspace.raven_overlays.join(","),
    density: body.workspace.density,
    panel: body.workspace.selected_panel,
  });
  return {
    watch_id: "wat_aaaaaaaaaaaaaaaaaaaa",
    schema_version: "ravenos.saved_exact_market.v1",
    market: {
      instrument_id: instrumentId,
      instrument_type: "exact_pool",
      identity_scope: "exact_pool",
      asset_class: "crypto",
      chain: "solana",
      venue: "meteora",
      market: "spot",
      base_symbol: "TEST",
      quote_symbol: "USDC",
      display_label: "TEST/USDC",
    },
    workspace: body.workspace,
    revision: 1,
    availability: { state: "available", reason: "exact_market_verified", checked_at: "2026-08-26T18:00:00.000Z" },
    terminal_url: `https://ravenos.xyz/terminal/?${query}`,
    created_at: "2026-08-26T18:00:00.000Z",
    updated_at: "2026-08-26T18:00:00.000Z",
    ...overrides,
  };
}

async function installMonitorApi(page, baseURL, shared) {
  await page.route("**/api/v1/auth/config", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(authConfig(baseURL)) }));
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session()) }));
  await page.route("**/api/v1/research-state**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    shared.requests.push({ method: request.method(), path: url.pathname, headers: request.headers(), body: request.postData() });
    if (request.method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: shared.items.length ? "available" : "empty", items: shared.items, limits: { maximum_saved_markets: 100 } }) });
    }
    if (request.method() === "POST" && url.pathname.endsWith("/watch-items")) {
      const body = request.postDataJSON();
      const existing = shared.items.find((item) => item.market.instrument_id === body.market.instrument_id);
      const item = existing || savedItem(body);
      if (!existing) shared.items.push(item);
      return route.fulfill({ status: existing ? 200 : 201, contentType: "application/json", body: JSON.stringify({ ok: true, created: !existing, item }) });
    }
    if (request.method() === "POST" && url.pathname.endsWith("/refresh")) {
      const watchId = url.pathname.split("/").at(-2);
      const item = shared.items.find((candidate) => candidate.watch_id === watchId);
      if (item) item.availability = { state: "unavailable", reason: "exact_market_not_found", checked_at: "2026-08-26T18:15:00.000Z" };
      return route.fulfill({ status: item ? 200 : 404, contentType: "application/json", body: JSON.stringify(item ? { ok: true, item } : { ok: false, error: "saved_research_item_not_found" }) });
    }
    if (request.method() === "DELETE" && url.pathname === "/api/v1/research-state") {
      const deleted = shared.items.length;
      shared.items.splice(0);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, deleted_count: deleted, state: "empty" }) });
    }
    if (request.method() === "DELETE") {
      const watchId = url.pathname.split("/").at(-1);
      const index = shared.items.findIndex((item) => item.watch_id === watchId);
      if (index >= 0) shared.items.splice(index, 1);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, deleted: index >= 0 }) });
    }
    return route.fulfill({ status: 405, contentType: "application/json", body: JSON.stringify({ ok: false, error: "method_not_allowed" }) });
  });
}

test("exact-market handoff saves allowlisted workspace state and restores it on another signed-in device", async ({ browser, baseURL }) => {
  const shared = { items: [], requests: [] };
  const firstContext = await browser.newContext({ baseURL });
  const first = await firstContext.newPage();
  await installMonitorApi(first, baseURL, shared);
  const query = new URLSearchParams({
    action: "save",
    instrument_id: `solana:pool:${POOL_A}`,
    instrument_type: "exact_pool",
    identity_scope: "exact_pool",
    asset_class: "crypto",
    chain: "solana",
    venue: "meteora",
    market: "spot",
    timeframe: "4h",
    indicators: "ema20,vwap,not-allowed",
    raven_overlays: "pressure-zone,liquidity-zone,plan-entry",
    density: "compact",
    panel: "raven",
    arbitrary_html: "<script>window.__monitorExecuted=true</script>",
    wallet: "must-not-store",
  });
  await first.goto(`/monitor/?${query}`);
  await expect(first.locator(".monitor-page")).toHaveAttribute("data-monitor-state", "authenticated");
  await expect(first.locator("#monitorPendingIdentity")).toHaveText(`solana:pool:${POOL_A}`);
  await first.getByRole("button", { name: "Save exact market" }).click();
  await expect(first.locator(".monitor-item")).toHaveCount(1);
  const saveRequest = shared.requests.find((entry) => entry.method === "POST" && entry.path.endsWith("/watch-items"));
  const stored = JSON.parse(saveRequest.body);
  expect(stored).toEqual({
    market: {
      instrument_id: `solana:pool:${POOL_A}`,
      instrument_type: "exact_pool",
      identity_scope: "exact_pool",
      asset_class: "crypto",
      chain: "solana",
      venue: "meteora",
      market: "spot",
    },
    workspace: {
      schema_version: "ravenos.saved_workspace.v1",
      timeframe: "4h",
      indicators: ["ema20", "vwap"],
      raven_overlays: ["pressure-zone", "liquidity-zone"],
      density: "compact",
      selected_panel: "raven",
    },
  });
  expect(saveRequest.headers["x-ravenos-csrf"]).toBe("csrf_monitor_fixture");
  expect(saveRequest.body).not.toContain("wallet");
  expect(saveRequest.body).not.toContain("arbitrary_html");

  const secondContext = await browser.newContext({ baseURL });
  const second = await secondContext.newPage();
  await installMonitorApi(second, baseURL, shared);
  await second.goto("/monitor/");
  await expect(second.locator(".monitor-item")).toHaveCount(1);
  await expect(second.locator(".monitor-identity")).toHaveText(`solana:pool:${POOL_A}`);
  const open = second.getByRole("link", { name: "Open exact market" });
  const openUrl = new URL(await open.getAttribute("href"));
  expect(openUrl.searchParams.get("instrument_id")).toBe(`solana:pool:${POOL_A}`);
  expect(openUrl.searchParams.get("timeframe")).toBe("4h");
  expect(openUrl.searchParams.get("panel")).toBe("raven");
  expect(await second.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });
  await firstContext.close();
  await secondContext.close();
});

test("anonymous sign-in return preserves only the allowlisted handoff", async ({ page, baseURL }) => {
  let authStart = null;
  await page.route("**/api/v1/auth/config", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(authConfig(baseURL)) }));
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, authenticated: false }) }));
  await page.route("**/api/v1/auth/start", async (route) => {
    authStart = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, authorization_url: "https://api.workos.com/user_management/authorize?state=test" }) });
  });
  await page.route("https://api.workos.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "Sign in fixture" }));
  const query = new URLSearchParams({
    instrument_id: `solana:pool:${POOL_A}`,
    instrument_type: "exact_pool",
    identity_scope: "exact_pool",
    asset_class: "crypto",
    chain: "solana",
    venue: "meteora",
    market: "spot",
    timeframe: "4h",
    indicators: "ema20,vwap,custom-script",
    raven_overlays: "pressure-zone,plan-entry",
    wallet: "must-not-survive",
    arbitrary_html: "<script>must-not-survive</script>",
  });
  await page.goto(`/monitor/?${query}`);
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect.poll(() => authStart).not.toBeNull();
  const returnTo = new URL(authStart.return_to, "https://app.ravenos.xyz");
  expect(returnTo.pathname).toBe("/monitor/");
  expect(returnTo.searchParams.get("instrument_id")).toBe(`solana:pool:${POOL_A}`);
  expect(returnTo.searchParams.get("indicators")).toBe("ema20,vwap");
  expect(returnTo.searchParams.get("raven_overlays")).toBe("pressure-zone");
  expect(returnTo.searchParams.has("wallet")).toBe(false);
  expect(returnTo.searchParams.has("arbitrary_html")).toBe(false);
});

test("hostile stored metadata stays text and unavailable markets remain reopenable", async ({ page, baseURL }) => {
  const body = {
    market: { instrument_id: `solana:pool:${POOL_A}` },
    workspace: { schema_version: "ravenos.saved_workspace.v1", timeframe: "1h", indicators: [], raven_overlays: [], density: "comfortable", selected_panel: "chart" },
  };
  const hostile = '<img src=x onerror="window.__monitorExecuted=true">TEST/USDC';
  const item = savedItem(body, {
    market: { ...savedItem(body).market, display_label: hostile },
    availability: { state: "unavailable", reason: "exact_market_not_found", checked_at: "2026-08-26T18:00:00.000Z" },
  });
  const shared = { items: [item], requests: [] };
  await installMonitorApi(page, baseURL, shared);
  await page.goto("/monitor/");
  await expect(page.locator(".monitor-item h3")).toHaveText(hostile);
  await expect(page.locator(".monitor-item img")).toHaveCount(0);
  expect(await page.evaluate(() => window.__monitorExecuted === true)).toBe(false);
  await expect(page.getByRole("link", { name: "Open unavailable market" })).toHaveAttribute("href", /instrument_id=solana%3Apool%3A111/);
});

test("unwatch, individual deletion, and delete-all are explicit customer controls", async ({ page, baseURL }) => {
  const workspace = { schema_version: "ravenos.saved_workspace.v1", timeframe: "1h", indicators: [], raven_overlays: [], density: "comfortable", selected_panel: "chart" };
  const shared = {
    items: [
      savedItem({ market: { instrument_id: `solana:pool:${POOL_A}` }, workspace }),
      savedItem({ market: { instrument_id: "hyperliquid:perp:SOL" }, workspace }, { watch_id: "wat_bbbbbbbbbbbbbbbbbbbb", market: { instrument_id: "hyperliquid:perp:SOL", instrument_type: "perpetual", identity_scope: "exact_instrument", asset_class: "crypto", chain: "hyperliquid", venue: "hyperliquid", market: "perpetual", base_symbol: "SOL", quote_symbol: "USD", display_label: "SOL perpetual" } }),
    ],
    requests: [],
  };
  await installMonitorApi(page, baseURL, shared);
  await page.goto("/monitor/");
  await expect(page.locator(".monitor-item")).toHaveCount(2);
  await page.locator(".monitor-item").first().getByRole("button", { name: "Remove" }).click();
  await expect(page.locator(".monitor-item")).toHaveCount(1);
  await page.getByRole("button", { name: "Delete all saved markets" }).click();
  await expect(page.locator("#monitorDeleteDialog")).toBeVisible();
  await page.getByRole("button", { name: "Delete saved markets" }).click();
  await expect(page.locator(".monitor-item")).toHaveCount(0);
  const deleteAll = shared.requests.find((entry) => entry.method === "DELETE" && entry.path === "/api/v1/research-state");
  expect(JSON.parse(deleteAll.body)).toEqual({ confirm: "delete_all_saved_research_state" });
});

test("Terminal exposes an explicit exact-market Raven Monitor handoff", async ({ page }) => {
  await page.goto("/terminal/?asset=SOL-PERP&instrument_id=hyperliquid%3Aperp%3ASOL&instrument_type=perpetual&asset_class=crypto&identity_scope=exact_instrument&chain=hyperliquid&venue=hyperliquid&market=perp&timeframe=4h", { waitUntil: "domcontentloaded" });
  const link = page.locator("#terminalMonitorLink");
  await expect(link).toBeVisible({ timeout: 15_000 });
  const href = new URL(await link.getAttribute("href"));
  expect(href.origin).toBe("https://app.ravenos.xyz");
  expect(href.pathname).toBe("/monitor/");
  expect(href.searchParams.get("action")).toBe("monitor");
  expect(href.searchParams.get("instrument_id")).toBe("hyperliquid:perp:SOL");
  expect(href.searchParams.get("timeframe")).toBe("4h");
  expect(href.searchParams.has("wallet")).toBe(false);
  expect(href.searchParams.has("order")).toBe(false);
});

test("Terminal handoff and restore preserve an explicitly empty indicator set", async ({ page }) => {
  await page.goto("/terminal/?asset=SOL-PERP&instrument_id=hyperliquid%3Aperp%3ASOL&instrument_type=perpetual&asset_class=crypto&identity_scope=exact_instrument&chain=hyperliquid&venue=hyperliquid&market=perp&timeframe=4h&indicators=", { waitUntil: "domcontentloaded" });
  const link = page.locator("#terminalMonitorLink");
  await expect(link).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#terminalChart [data-rpw-indicator-count]")).toHaveText("0");
  const href = new URL(await link.getAttribute("href"));
  expect(href.searchParams.has("indicators")).toBe(true);
  expect(href.searchParams.get("indicators")).toBe("");
});

test("monitor HTML uses the authenticated CSP and has no executable-data sinks", async ({ page }) => {
  const response = await page.goto("/monitor/");
  expect(response?.status()).toBe(200);
  const headers = response?.headers() || {};
  expect(headers["cache-control"]).toContain("no-store");
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  expect(headers["content-security-policy"]).not.toContain("unsafe-inline");
  expect(headers["content-security-policy"]).not.toContain("unsafe-eval");
  expect(headers["x-frame-options"]).toBe("DENY");
});
