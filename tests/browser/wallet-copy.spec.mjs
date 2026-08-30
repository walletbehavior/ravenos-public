import { expect, test } from "@playwright/test";
import { join } from "node:path";

const WALLET = "7KxQmTi5W4rP8Y2hD9cV6nF3aS1uEoLzJbGkNqMpfHrt";
const TOKEN = "4M7YQqGfRWfBpcA7mN5uY3z8Jj6Hk2VtD9sLxEePoaBn";
const WATCH_ID = "wcw_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SOURCE_ID = `sw_sol_${"a".repeat(40)}`;

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
    economic: {
      cost_basis_state: kind === "SWAP_BUY" ? "known_canonical_usdc" : "unresolved_non_usdc_basis",
      source_asset: kind === "SWAP_BUY" ? { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amount_base_units: "25000000", decimals: 6 } : null,
      destination_asset: kind === "SWAP_BUY" ? { mint: TOKEN, amount_base_units: "81000000", decimals: 6 } : null,
    },
  };
}

function profile() {
  return {
    schema_version: "ravenos.solana_wallet_profile.v1",
    source_wallet: { chain: "solana", network: "mainnet", address: WALLET },
    coverage: { transactions_observed: 12, trade_events: 7, known_cost_basis_pct: 71.4 },
    source_performance: {
      state: "partial",
      realized_pnl_usdc: 428.12,
      roi_pct: 38.42,
      win_rate_pct: 62.5,
      closed_lots: 8,
      limitations: ["Some positions have unresolved cost basis and are excluded from realized performance."],
    },
    behavior: { median_hold_seconds: 1_860, average_hold_seconds: 2_100, trade_count: 7, active_days: 4, tokens_traded: 3, first_trade_at: "2026-08-20T12:00:00.000Z", last_trade_at: "2026-08-29T11:59:58.000Z" },
  };
}

function screenedWallet() {
  return {
    source_wallet_id: SOURCE_ID,
    source_wallet: { chain: "solana", network: "mainnet", address: WALLET },
    profile: { snapshot_id: `swp_${"b".repeat(40)}`, version: 3, generated_at: "2026-08-29T12:00:00.000Z" },
    source_performance: { state: "partial", realized_pnl: { usdc: 428.12, sol: null, combined: null, bases_combined: false }, roi_pct: 38.42, win_rate_pct: 62.5, closed_lots: 8 },
    behavior: { first_trade_at: "2026-08-20T12:00:00.000Z", last_trade_at: "2026-08-29T11:59:58.000Z", trade_count: 7, active_days: 4, token_count: 3, median_hold_seconds: 1_860 },
    coverage: { known_cost_basis_pct: 71.4, source_history_complete: false, chain_wide_coverage_claimed: false },
    why_surfaced: [{ code: "normalized_trade_history", label: "7 normalized trades observed." }, { code: "closed_lot_evidence", label: "8 closed lots support source-performance calculations." }],
    follower_reality: { state: "not_sampled", prospective_sample_size: null },
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
          ? { ok: true, state: "available", activation: { wallet_intelligence: true, wallet_screener: true, shadow_copy: true, live_copy: false }, execution_boundary: { signing: false, broadcasting: false, custody: false, live_copy: false, fee_collection: false } }
          : { ok: false, state: "not_granted", error: "capability_not_authorized" }),
      });
    }
    if (url.pathname.endsWith("/screener") && request.method() === "POST") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        ok: true,
        state: "available",
        scope: { claim: "bounded_raven_index_only", comprehensive_chain_index: false },
        rows: [screenedWallet()],
        pagination: { page: 1, page_size: 12, total_matching_rows: 1, total_pages: 1, has_previous: false, has_next: false },
      }) });
    }
    if (url.pathname === `/api/v1/wallet-copy/wallets/${SOURCE_ID}` && request.method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: "available", source_wallet_id: SOURCE_ID, profile: profile(), recent_events: [event("SWAP_BUY")], provider_request_performed: false }) });
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
      const sampleCount = shared.decision ? 1 : 0;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: shared.decision ? "available" : "empty", decisions: shared.decision ? [shared.decision] : [], copyability: shared.watch ? [{ watch_id: WATCH_ID, snapshot: { state: "insufficient_evidence", score: null, prospective_sample_count: sampleCount, components: { policy_pass_pct: 0, entry_executable_pct: 100, exit_executable_pct: 0, median_entry_degradation_bps: 42 } }, by_size: [25, 100, 500, 1000, 5000].map((size) => ({ order_size_usdc: size, state: "insufficient_evidence", score: null, prospective_sample_count: size === 100 ? sampleCount : 0, components: {} })) }] : [] }) });
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
  await page.getByRole("button", { name: "Analyze wallet" }).click();
  await expect(page.getByText("Source performance", { exact: true })).toBeVisible();
  await expect(page.locator("#copyProfile").getByText("Follower reality", { exact: true })).toBeVisible();
  await expect(page.locator("#copySourcePnl")).toHaveText("+$428 realized");
  await expect(page.getByText("Transfer In")).toBeVisible();
  await page.getByRole("button", { name: "Shadow this wallet" }).click();
  await page.getByRole("button", { name: "Start shadowing" }).click();
  await expect(page.getByRole("heading", { name: "Wallets you are shadowing" })).toBeVisible();
  await expect(page.getByText("First check needed")).toBeVisible();
  await expect(page.locator(".copy-card img, .copy-card script")).toHaveCount(0);
  expect(await page.evaluate(() => window.__copyExecuted === true)).toBe(false);

  const create = shared.requests.find((row) => row.method === "POST" && row.path.endsWith("/watches"));
  expect(create.headers["x-ravenos-csrf"]).toBe("csrf_wallet_copy");
  const createdBody = JSON.parse(create.body);
  expect(createdBody.address).toBe(WALLET);
  expect(createdBody.policy.hypothetical_raven_fee_bps).toBe(10);
  expect(create.body).not.toMatch(/private.?key|seed.?phrase|sign(?:ed|ature)|transaction.?material/i);

  await page.getByRole("button", { name: "Build baseline" }).click();
  await expect(page.getByText("Ready for new trades")).toBeVisible();
  const refresh = shared.requests.find((row) => row.path.endsWith("/refresh"));
  expect(refresh.headers["x-ravenos-csrf"]).toBe("csrf_wallet_copy");
  expect(refresh.body).toBe("{}");
  expect(await page.evaluate(() => window.RavenOSWalletCopy)).toEqual({ schemaVersion: "ravenos.wallet_copy_surface.v1", liveCopy: false, signing: false, broadcasting: false, feeCollection: false });
  await captureVisual(page, "wallet-copy-desktop-1440");
});

test("Raven-indexed screener exposes honest evidence and opens a retained profile without another live lookup", async ({ page }) => {
  const shared = { watch: null, decision: null, position: null, requests: [] };
  await install(page, shared);
  await page.goto("/account/copy/");
  await expect(page.getByRole("heading", { name: "Wallets Raven has actually seen." })).toBeVisible();
  await expect(page.getByText("7 normalized trades observed.")).toBeVisible();
  await expect(page.getByText("Follower", { exact: true })).toBeVisible();
  await expect(page.getByText("Not sampled", { exact: true }).first()).toBeVisible();
  await captureVisual(page, "wallet-copy-screener-desktop-1440");
  await page.getByRole("button", { name: "Open analysis" }).click();
  await expect(page.getByText("25 USDC", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /View transaction/ })).toHaveAttribute("href", /solscan\.io\/tx\//);
  const detailRequest = shared.requests.find((row) => row.path === `/api/v1/wallet-copy/wallets/${SOURCE_ID}`);
  expect(detailRequest.method).toBe("GET");
  expect(shared.requests.filter((row) => row.path.endsWith("/inspect"))).toHaveLength(0);
  const screenerRequest = shared.requests.find((row) => row.path.endsWith("/screener"));
  expect(screenerRequest.headers["x-ravenos-csrf"]).toBe("csrf_wallet_copy");
  expect(JSON.parse(screenerRequest.body).filters.min_known_cost_basis_pct).toBeNull();
});

test("mobile wallet screener keeps filters, source evidence, and analysis controls contained", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const shared = { watch: null, decision: null, position: null, requests: [] };
  await install(page, shared);
  await page.goto("/account/copy/");
  await expect(page.getByRole("heading", { name: "Wallets Raven has actually seen." })).toBeVisible();
  await page.getByLabel("Sort").selectOption("trade_count_desc");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("button", { name: "Open analysis" })).toBeVisible();
  const overflow = await page.evaluate(() => [...document.querySelectorAll("body *")]
    .filter((node) => node.getBoundingClientRect().right > innerWidth + 1)
    .map((node) => `${node.tagName.toLowerCase()}.${node.className || ""}`));
  expect(overflow).toEqual([]);
  const latest = [...shared.requests].reverse().find((row) => row.path.endsWith("/screener"));
  expect(JSON.parse(latest.body).sort).toBe("trade_count_desc");
  await captureVisual(page, "wallet-copy-screener-mobile-390");
});

test("wallet handoff pre-fills and inspects the exact public address after Pro authentication", async ({ page }) => {
  const shared = { watch: null, decision: null, position: null, requests: [] };
  await install(page, shared);
  await page.goto(`/account/copy/?wallet=${WALLET}`);
  await expect(page.getByLabel("Paste an address")).toHaveValue(WALLET);
  await expect(page.getByText("Analysis ready. Review the wallet’s results before starting a shadow test.")).toBeVisible();
  const inspectRequest = shared.requests.find((row) => row.path.endsWith("/inspect"));
  expect(JSON.parse(inspectRequest.body).address).toBe(WALLET);
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
