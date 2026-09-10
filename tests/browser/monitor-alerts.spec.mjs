import { expect, test } from "@playwright/test";

const INSTRUMENT_ID = "hyperliquid:perp:SOL";
const WATCH_ID = "wat_aaaaaaaaaaaaaaaaaa";
const RULE_ID = "mon_rrrrrrrrrrrrrrrrrr";
const NOTIFICATION_ID = "ntf_nnnnnnnnnnnnnnnnnn";

function item() {
  return {
    watch_id: WATCH_ID,
    schema_version: "ravenos.saved_exact_market.v1",
    market: { instrument_id: INSTRUMENT_ID, instrument_type: "perpetual", identity_scope: "exact_instrument", asset_class: "crypto", chain: "hyperliquid", venue: "hyperliquid", market: "perpetual", base_symbol: "SOL", quote_symbol: "USD", display_label: "SOL perpetual" },
    workspace: { schema_version: "ravenos.saved_workspace.v1", timeframe: "1h", indicators: [], raven_overlays: ["pressure"], density: "comfortable", selected_panel: "chart" },
    revision: 1,
    availability: { state: "available", reason: "exact_market_verified", checked_at: "2026-08-26T20:00:00.000Z" },
    terminal_url: "https://ravenos.xyz/terminal/?instrument_id=hyperliquid%3Aperp%3ASOL&instrument_type=perpetual&identity_scope=exact_instrument&asset_class=crypto&chain=hyperliquid&venue=hyperliquid&market=perpetual&asset=SOL&quote=USD&timeframe=1h&indicators=&raven_overlays=pressure&density=comfortable&panel=chart",
    created_at: "2026-08-26T19:00:00.000Z",
    updated_at: "2026-08-26T19:00:00.000Z",
  };
}

function rule(state = "active", revision = 1, eventTypes = ["pressure_regime_changed", "funding_regime_changed", "liquidity_quality_changed", "exact_market_availability_changed"]) {
  return {
    rule_id: RULE_ID,
    schema_version: "ravenos.monitor_rule.v1",
    watch_id: WATCH_ID,
    market: item().market,
    event_types: eventTypes,
    state,
    cadence: "standard",
    cooldown_seconds: 900,
    last_qualified_evaluation_at: "2026-08-26T20:00:00.000Z",
    last_observed_evidence: { classifications: { pressure_regime: "balanced", funding_regime: "neutral", liquidity_quality: "healthy", availability_state: "available" }, evidence_role: "raven_measurement", limitations: ["Research only."] },
    next_eligible_evaluation_at: "2026-08-26T20:05:00.000Z",
    revision,
    terminal_url: item().terminal_url,
    created_at: "2026-08-26T19:30:00.000Z",
    updated_at: "2026-08-26T20:00:00.000Z",
  };
}

function notification(readAt = null) {
  return {
    notification_id: NOTIFICATION_ID,
    schema_version: "ravenos.notification_event.v1",
    rule_id: RULE_ID,
    market: { ...item().market, display_label: '<img src=x onerror="window.__monitorAlertExecuted=true">SOL perpetual' },
    event_type: "pressure_regime_changed",
    before: { field: "pressure_regime", value: "balanced" },
    after: { field: "pressure_regime", value: "crowded long" },
    explanation: '<script>window.__monitorAlertExecuted=true</script>Pressure changed from balanced to crowded long.',
    evidence_role: "raven_measurement",
    limitations: ["This alert watches market evidence only. It does not track a position or place trades."],
    source_as_of: "2026-08-26T20:00:00.000Z",
    detected_at: "2026-08-26T20:00:10.000Z",
    read_at: readAt,
    retention_expires_at: "2026-11-24T20:00:10.000Z",
    terminal_url: item().terminal_url,
  };
}

async function install(page, baseURL, shared) {
  await page.route("**/api/v1/auth/config", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, available: true, on_authenticated_origin: true, canonical_origin: baseURL }) }));
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, authenticated: true, csrf_token: "csrf_monitor_alerts" }) }));
  await page.route("**/api/v1/entitlements", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: "available", capabilities: [{ capability: "research.alerts", implementation_state: "implemented_dormant", available: true, state: "active", route: "/api/v1/monitor-alerts" }] }) }));
  await page.route("**/api/v1/research-state**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: "available", items: [shared.item || item()], limits: { maximum_saved_markets: 100 } }) }));
  await page.route("**/api/v1/monitor-alerts**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    shared.requests.push({ method: request.method(), path: url.pathname, body: request.postData(), headers: request.headers() });
    if (url.pathname === `/api/v1/monitor-alerts/evidence/${WATCH_ID}` && request.method() === 'GET') {
      return route.fulfill({ status: shared.evidenceStatus || 200, contentType: 'application/json', body: JSON.stringify(shared.evidence || {
        ok: true, schema_version: 'ravenos.monitor_evidence.v1', state: 'available',
        instrument_id: shared.item?.market?.instrument_id || INSTRUMENT_ID,
        source_timestamp: new Date().toISOString(), supported_event_types: ['pressure_regime_changed', 'funding_regime_changed', 'exact_market_availability_changed'],
      }) });
    }
    if (url.pathname === "/api/v1/monitor-alerts" && request.method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: "available", capability: "research.alerts" }) });
    if (url.pathname.endsWith("/rules") && request.method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: shared.rule ? "available" : "empty", rules: shared.rule ? [shared.rule] : [] }) });
    if (url.pathname.endsWith("/rules") && request.method() === "POST") {
      const body = request.postDataJSON();
      shared.rule ||= rule("active", 1, body.event_types);
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, created: true, rule: shared.rule }) });
    }
    if (url.pathname === `/api/v1/monitor-alerts/rules/${RULE_ID}` && request.method() === "PATCH") {
      const body = request.postDataJSON();
      shared.rule = rule(body.state, (shared.rule?.revision || 1) + 1, body.event_types);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, rule: shared.rule }) });
    }
    if (url.pathname.endsWith("/notifications") && request.method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: shared.notification ? "available" : "empty", notifications: shared.notification ? [shared.notification] : [] }) });
    if (url.pathname.endsWith(`/${NOTIFICATION_ID}/read`) && request.method() === "POST") {
      shared.notification = notification("2026-08-26T20:01:00.000Z");
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, notification_id: NOTIFICATION_ID, read_at: shared.notification.read_at }) });
    }
    if (url.pathname.endsWith("/notifications") && request.method() === "DELETE") { shared.notification = null; return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, deleted_count: 1, state: "empty" }) }); }
    if (url.pathname === "/api/v1/monitor-alerts" && request.method() === "DELETE") { shared.rule = null; shared.notification = null; return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, deleted: { rules: 1, notifications: 1 }, state: "empty" }) }); }
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false, error: "not_found" }) });
  });
}

test("entitled user creates, pauses, and inspects an exact Raven Monitor without executable state", async ({ page, baseURL }) => {
  const shared = { rule: null, notification: notification(), requests: [] };
  await install(page, baseURL, shared);
  await page.goto("/monitor/?action=monitor&instrument_id=hyperliquid%3Aperp%3ASOL&instrument_type=perpetual&identity_scope=exact_instrument&asset_class=crypto&chain=hyperliquid&venue=hyperliquid&market=perp&timeframe=1h");
  await expect(page.getByRole("heading", { name: "Save this market and add alerts" })).toBeVisible();
  await expect(page.getByText("Alerts off")).toBeVisible();
  await page.getByText("Choose changes").click();
  await page.getByRole("button", { name: "Turn on Raven alerts" }).click();
  await expect(page.getByText("Raven alerts · active")).toBeVisible();
  const create = shared.requests.find((entry) => entry.method === "POST" && entry.path.endsWith("/rules"));
  expect(JSON.parse(create.body).watch_id).toBe(WATCH_ID);
  expect(create.headers["x-ravenos-csrf"]).toBe("csrf_monitor_alerts");
  expect(create.body).not.toMatch(/price|target|wallet|position|order|execution/i);
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByText("Raven alerts · paused")).toBeVisible();
  await expect(page.locator(".monitor-notification")).toHaveCount(1);
  await expect(page.locator(".monitor-notification img, .monitor-notification script")).toHaveCount(0);
  expect(await page.evaluate(() => window.__monitorAlertExecuted === true)).toBe(false);
  const open = new URL(await page.getByRole("link", { name: "Open exact chart" }).getAttribute("href"));
  expect(open.searchParams.get("instrument_id")).toBe(INSTRUMENT_ID);
  await page.getByRole("button", { name: "Mark read" }).click();
  await expect(page.locator(".monitor-notification")).toHaveAttribute("data-read", "true");
});

test("mobile Raven Monitor remains readable and delete-all removes only alert research state", async ({ page, baseURL }) => {
  const shared = { rule: rule(), notification: notification(), requests: [] };
  await page.setViewportSize({ width: 390, height: 844 });
  await install(page, baseURL, shared);
  await page.goto("/monitor/");
  await expect(page.locator(".monitor-alerts")).toBeVisible();
  expect(await page.locator(".monitor-notification").evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length)).toBe(1);
  const overflowing = await page.evaluate(() => [...document.querySelectorAll("body *")]
    .filter((node) => node.getBoundingClientRect().right > innerWidth + 1)
    .map((node) => `${node.tagName.toLowerCase()}.${node.className || ""}`));
  expect(overflowing).toEqual([]);
  await page.getByRole("button", { name: "Delete all alerts" }).click();
  await expect(page.locator("#monitorAlertDeleteDialog")).toBeVisible();
  await page.getByRole("button", { name: "Delete alerts" }).click();
  await expect(page.getByText("Alerts off")).toBeVisible();
  await expect(page.locator(".monitor-notification")).toHaveCount(0);
  await expect(page.locator(".monitor-item")).toHaveCount(1);
  const deletion = shared.requests.find((entry) => entry.method === "DELETE" && entry.path === "/api/v1/monitor-alerts");
  expect(JSON.parse(deletion.body)).toEqual({ confirm: "delete_all_alert_research_state" });
});

test("unentitled and dormant states never render fake locked evidence", async ({ page, baseURL }) => {
  await page.route("**/api/v1/auth/config", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, available: true, on_authenticated_origin: true, canonical_origin: baseURL }) }));
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, authenticated: true, csrf_token: "csrf" }) }));
  await page.route("**/api/v1/research-state**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: "available", items: [item()] }) }));
  await page.route("**/api/v1/entitlements", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: "no_active_capabilities", capabilities: [{ capability: "research.alerts", implementation_state: "implemented_dormant", available: false, state: "not_granted" }] }) }));
  await page.goto("/monitor/");
  await expect(page.locator('#monitorAlertSummary')).toHaveText('Your account does not currently have alert access.');
  await expect(page.getByText('Your account does not currently have alert access. Your saved markets remain available.')).toBeVisible();
  await expect(page.locator(".monitor-notification")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Turn on Raven alerts" })).toHaveCount(0);
});

test('onchain alert editor offers only supported current market changes on mobile', async ({ page, baseURL }) => {
  const selected = item();
  selected.market = { ...selected.market, instrument_id: 'base:pool:0x' + '1'.repeat(40), instrument_type: 'exact_pool', identity_scope: 'exact_pool', chain: 'base', venue: 'onchain', market: 'spot', display_label: 'TEST / USDC', base_symbol: 'TEST', quote_symbol: 'USDC' };
  const shared = { item: selected, rule: null, notification: null, requests: [], evidence: {
    ok: true, schema_version: 'ravenos.monitor_evidence.v1', state: 'available', instrument_id: selected.market.instrument_id,
    source_timestamp: new Date().toISOString(), supported_event_types: ['pressure_regime_changed', 'exact_market_availability_changed'],
  } };
  await page.setViewportSize({ width: 390, height: 844 });
  await install(page, baseURL, shared); await page.goto('/monitor/');
  await page.getByText('Choose changes').click();
  await expect(page.getByRole('checkbox', { name: 'Buy / sell flow · 1h' })).toBeChecked();
  await expect(page.locator('.monitor-event-grid input')).toHaveCount(2);
  await expect(page.getByRole('checkbox', { name: 'Launch lifecycle' })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Funding regime' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Turn on Raven alerts' })).toBeEnabled();
  expect(shared.requests.filter(r => r.method === 'POST')).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.monitor-rule-editor').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `/tmp/raven-monitor-evidence-${test.info().project.name || 'chromium'}-390.png` });
});

test('unavailable or mismatched evidence keeps creation disabled and can recover', async ({ page, baseURL }) => {
  const shared = { rule: null, notification: null, requests: [], evidenceStatus: 503 };
  await install(page, baseURL, shared); await page.goto('/monitor/');
  await page.getByText('Choose changes').click();
  await expect(page.getByText('Current evidence for this exact market is unavailable. Reload to check again.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn on Raven alerts' })).toBeDisabled();
  shared.evidenceStatus = 200;
  shared.evidence = { ok: true, schema_version: 'ravenos.monitor_evidence.v1', state: 'available', instrument_id: 'hyperliquid:perp:BTC', supported_event_types: ['funding_regime_changed'] };
  await page.getByRole('button', { name: 'Reload available changes' }).click();
  await expect(page.getByRole('button', { name: 'Reload available changes' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Turn on Raven alerts' })).toBeDisabled();
  delete shared.evidence;
  await page.getByRole('button', { name: 'Reload available changes' }).click();
  await expect(page.getByRole('button', { name: 'Turn on Raven alerts' })).toBeEnabled();
  await expect(page.locator('.monitor-event-grid input')).toHaveCount(3);
  expect(shared.requests.filter(r => r.method === 'POST')).toHaveLength(0);
});
