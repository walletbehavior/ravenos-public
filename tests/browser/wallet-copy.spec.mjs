import { expect, test } from "@playwright/test";
import { join } from "node:path";

const WALLET = "7KxQmTi5W4rP8Y2hD9cV6nF3aS1uEoLzJbGkNqMpfHrt";
const TOKEN = "4M7YQqGfRWfBpcA7mN5uY3z8Jj6Hk2VtD9sLxEePoaBn";
const WATCH_ID = "wcw_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

async function captureVisual(page, name) {
  const directory = process.env.RAVENOS_VISUAL_ARTIFACT_DIR;
  if (directory) await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true });
}

function session(authenticated = true) {
  return authenticated
    ? { ok: true, authenticated: true, csrf_token: "csrf_wallet_copy", account: { email: "pro@example.com" } }
    : { ok: true, authenticated: false, account: null, session: null };
}

function event(kind = "SWAP_BUY") {
  return {
    schema_version: "ravenos.solana_wallet_event.v1",
    event_id: "swe_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    source_wallet: { chain: "solana", network: "mainnet", address: WALLET },
    chain_evidence: { signature: "5".repeat(88), block_time: "2026-08-29T11:59:58.000Z" },
    classification: { kind, confidence: "observed" },
    economic: { cost_basis_state: kind === "SWAP_BUY" ? "known_canonical_usdc" : "unresolved_non_usdc_basis" },
  };
}

function profile() {
  return {
    schema_version: "ravenos.solana_wallet_profile.v1",
    source_wallet: { chain: "solana", network: "mainnet", address: WALLET },
    coverage: { transactions_observed: 12, trade_events: 7, known_cost_basis_pct: 71.4 },
    source_performance: {
      realized_pnl_usdc: 428.12,
      roi_pct: 38.42,
      win_rate_pct: 62.5,
      closed_lots: 8,
      limitations: ["Some positions have unresolved cost basis and are excluded from realized performance."],
    },
    behavior: { median_hold_seconds: 1_860 },
  };
}

function policy() {
  return {
    schema_version: "ravenos.copy_policy.v1",
    policy_version: 1,
    policy_hash: "f".repeat(40),
    mode: "RAVEN_COPY",
    sizing: { kind: "FIXED_USDC", fixed_usdc: 100, implemented: true },
    execution_quality: { maximum_round_trip_friction_pct: 5 },
  };
}

function watch(backfillComplete = false) {
  return {
    watch_id: WATCH_ID,
    source_wallet: { chain: "solana", network: "mainnet", address: WALLET },
    label: "Momentum source",
    state: "active",
    copy_mode: "RAVEN_COPY",
    policy: policy(),
    backfill_complete: backfillComplete,
    cursor: { signature: backfillComplete ? "5".repeat(88) : null, slot: backfillComplete ? 123 : null },
    source_state: { state: backfillComplete ? "current" : "requested", last_observed_at: backfillComplete ? "2026-08-29T12:00:00.000Z" : null },
    revision: backfillComplete ? 2 : 1,
    created_at: "2026-08-29T11:50:00.000Z",
    updated_at: "2026-08-29T12:00:00.000Z",
  };
}

function decision(state = "EXIT_UNAVAILABLE") {
  return {
    schema_version: "ravenos.shadow_copy_decision.v1",
    decision_id: "scd_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    watch_id: WATCH_ID,
    source_wallet: { chain: "solana", network: "mainnet", address: WALLET },
    destination_asset: { mint: TOKEN },
    timing: { source_chain_event_at: "2026-08-29T12:00:01.000Z", detection_delay_ms: 1_270 },
    follower_reality: {
      follower_order_usdc: 100,
      entry_degradation_bps: 42,
      current_executable_exit_usdc: null,
      round_trip_friction_including_raven_pct: null,
    },
    hypothetical_raven_fee: { scenario_bps: 10 },
    decision: { state, reason_code: "reverse_exit_unavailable", refusal_is_zero_return: false },
    execution_boundary: { mode: "shadow", transaction_hash: null, signing_available: false, broadcasting_available: false },
  };
}

function position() {
  return {
    schema_version: "ravenos.shadow_copy_position.v1",
    position_id: "scp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    watch_id: WATCH_ID,
    source_wallet: { chain: "solana", network: "mainnet", address: WALLET },
    destination_asset: { mint: TOKEN },
    expected_quantity: 81_250,
    entry_cost_usdc: 100,
    state: "SHADOW_OPEN",
    opened_at: "2026-08-29T12:00:03.000Z",
    live_assets_held: false,
    transaction_hash: null,
  };
}

async function install(page, shared, { authenticated = true, entitled = true } = {}) {
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(session(authenticated)),
  }));
  await page.route("**/api/v1/wallet-copy**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const record = { method: request.method(), path: url.pathname, body: request.postData(), headers: request.headers() };
    shared.requests.push(record);
    if (url.pathname === "/api/v1/wallet-copy" && request.method() === "GET") {
      return route.fulfill({
        status: entitled ? 200 : 403,
        contentType: "application/json",
        body: JSON.stringify(entitled
          ? { ok: true, state: "available", activation: { wallet_intelligence: true, shadow_copy: true, live_copy: false }, execution_boundary: { signing: false, broadcasting: false, custody: false, live_copy: false, fee_collection: false } }
          : { ok: false, state: "not_granted", error: "capability_not_authorized" }),
      });
    }
    if (url.pathname.endsWith("/inspect") && request.method() === "POST") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: "available", profile: profile(), recent_events: [event("SWAP_BUY"), event("TRANSFER_IN")] }) });
    }
    if (url.pathname.endsWith("/watches") && request.method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: shared.watch ? "available" : "empty", watches: shared.watch ? [shared.watch] : [] }) });
    }
    if (url.pathname.endsWith("/watches") && request.method() === "POST") {
      shared.watch = watch(false);
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, created: true, watch: shared.watch }) });
    }
    if (url.pathname === `/api/v1/wallet-copy/watches/${WATCH_ID}/refresh` && request.method() === "POST") {
      shared.watch = watch(true);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: "baseline_established", decisions: [], profile: profile() }) });
    }
    if (url.pathname === `/api/v1/wallet-copy/watches/${WATCH_ID}` && request.method() === "DELETE") {
      shared.watch = null;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, deleted: true }) });
    }
    if (url.pathname.endsWith("/decisions") && request.method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: shared.decision ? "available" : "empty", decisions: shared.decision ? [shared.decision] : [] }) });
    }
    if (url.pathname.endsWith("/positions") && request.method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: shared.position ? "available" : "empty", positions: shared.position ? [shared.position] : [] }) });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false, error: "not_found" }) });
  });
}

test("signed-out and unentitled visitors receive an honest private-workspace boundary", async ({ page }) => {
  const signedOut = { watch: null, decision: null, position: null, requests: [] };
  await install(page, signedOut, { authenticated: false });
  await page.goto("/account/copy/");
  await expect(page.locator(".copy-page")).toHaveAttribute("data-copy-state", "signed-out");
  await expect(page.getByRole("heading", { name: "Sign in to inspect and shadow wallets." })).toBeVisible();
  expect(signedOut.requests).toHaveLength(0);

  const privatePage = await page.context().newPage();
  const denied = { watch: null, decision: null, position: null, requests: [] };
  await install(privatePage, denied, { authenticated: true, entitled: false });
  await privatePage.goto("/account/copy/");
  await expect(privatePage.locator(".copy-page")).toHaveAttribute("data-copy-state", "unavailable");
  await expect(privatePage.getByRole("heading", { name: "Raven Copy is not open for this account yet." })).toBeVisible();
  await expect(privatePage.getByText("Raven Copy is part of RavenOS Pro and is not enabled for this account.")).toBeVisible();
});

test("Pro user inspects source evidence, saves a private policy, and establishes a non-executable baseline", async ({ page }) => {
  const shared = { watch: null, decision: null, position: null, requests: [] };
  await install(page, shared);
  await page.goto("/account/copy/");
  await expect(page.locator(".copy-page")).toHaveAttribute("data-copy-state", "active");
  await expect(page.getByText("Shadow workspace ready")).toBeVisible();
  await page.getByLabel("Paste an address").fill(WALLET);
  await page.getByRole("button", { name: "Inspect wallet" }).click();
  await expect(page.getByText("Source performance", { exact: true })).toBeVisible();
  await expect(page.locator("#copyProfile").getByText("Follower reality", { exact: true })).toBeVisible();
  await expect(page.getByText("+$428 realized")).toBeVisible();
  await expect(page.getByText("Transfer In")).toBeVisible();
  await page.getByRole("button", { name: "Shadow this wallet" }).click();
  await page.getByRole("button", { name: "Start shadowing" }).click();
  await expect(page.getByRole("heading", { name: "Wallets you are shadowing" })).toBeVisible();
  await expect(page.getByText("Baseline required")).toBeVisible();
  await expect(page.locator(".copy-card img, .copy-card script")).toHaveCount(0);
  expect(await page.evaluate(() => window.__copyExecuted === true)).toBe(false);

  const create = shared.requests.find((row) => row.method === "POST" && row.path.endsWith("/watches"));
  expect(create.headers["x-ravenos-csrf"]).toBe("csrf_wallet_copy");
  const createdBody = JSON.parse(create.body);
  expect(createdBody.address).toBe(WALLET);
  expect(createdBody.policy.hypothetical_raven_fee_bps).toBe(10);
  expect(create.body).not.toMatch(/private.?key|seed.?phrase|sign(?:ed|ature)|transaction.?material/i);

  await page.getByRole("button", { name: "Build baseline" }).click();
  await expect(page.getByText("Ready for prospective signals")).toBeVisible();
  const refresh = shared.requests.find((row) => row.path.endsWith("/refresh"));
  expect(refresh.headers["x-ravenos-csrf"]).toBe("csrf_wallet_copy");
  expect(refresh.body).toBe("{}");
  expect(await page.evaluate(() => window.RavenOSWalletCopy)).toEqual({ schemaVersion: "ravenos.wallet_copy_surface.v1", liveCopy: false, signing: false, broadcasting: false, feeCollection: false });
  await captureVisual(page, "wallet-copy-desktop-1440");
});

test("mobile shadow feed keeps refusals visible, separates positions, and never overflows", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const hostileWatch = watch(true);
  hostileWatch.label = '<img src=x onerror="window.__copyExecuted=true">Momentum source';
  const shared = { watch: hostileWatch, decision: decision(), position: position(), requests: [] };
  await install(page, shared);
  await page.goto("/account/copy/");
  await page.getByRole("tab", { name: /Shadow feed/ }).click();
  await expect(page.getByText("Exit Unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText("Reverse Exit Unavailable")).toBeVisible();
  await expect(page.getByText("Current exit")).toBeVisible();
  await expect(page.getByText("Unavailable", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("$0.00", { exact: true })).toHaveCount(0);
  await captureVisual(page, "wallet-copy-mobile-shadow-390");
  await page.getByRole("tab", { name: /Positions/ }).click();
  await expect(page.getByText("Shadow Open")).toBeVisible();
  await expect(page.getByText("No funds moved")).toBeVisible();
  const overflow = await page.evaluate(() => [...document.querySelectorAll("body *")]
    .filter((node) => node.getBoundingClientRect().right > innerWidth + 1)
    .map((node) => `${node.tagName.toLowerCase()}.${node.className || ""}`));
  expect(overflow).toEqual([]);
  expect(await page.evaluate(() => window.__copyExecuted === true)).toBe(false);
  await expect(page.locator(".copy-boundary").getByText("Not enabled", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /start live|copy now|execute/i })).toHaveCount(0);
});
