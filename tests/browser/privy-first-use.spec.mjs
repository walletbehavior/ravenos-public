import { expect, test } from "@playwright/test";

// Exercise the shipped, pinned Privy SDK, not Raven's factory mock. The old
// initialize -> user.get path fails here before custom-provider login can run.
test("a fresh browser authenticates with Raven before restoring or creating Privy wallets", async ({ page }) => {
  const calls = [];
  await page.route("https://auth.privy.io/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    calls.push({ path, method: request.method(), body: request.postDataJSON() });
    if (path.endsWith("/embedded-wallets")) return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Isolated test wallet frame</title>" });
    if (path.includes("/custom")) return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ user: { id: "did:privy:first-use-fixture", linked_accounts: [] }, token: null, refresh_token: null, identity_token: null }),
    });
    if (request.method() === "GET" && path.includes("/apps/")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "cmfirstusefixture123456", name: "Wallet regression fixture", embedded_wallet_config: { mode: "user-controlled" } }) });
    if (path.includes("analytics")) return route.fulfill({ contentType: "application/json", body: "{}" });
    return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "No existing Privy session in this test" }) });
  });
  await page.goto("/account/");
  const result = await page.evaluate(async () => {
    localStorage.clear();
    const { createRavenPrivyWalletClient } = await import("/ravenos-privy-wallet.js");
    const client = createRavenPrivyWalletClient({ appId: "cmfirstusefixture123456", clientId: "first-use-fixture" });
    const wallets = await client.sync("fixture.raven.signature");
    // An explicit, disabled provisioning request must also leave wallets absent.
    const unchanged = await client.provision({ evm: false, solana: false });
    return { wallets, unchanged };
  });
  expect(result).toEqual({ wallets: { evm: null, solana: null }, unchanged: { evm: null, solana: null } });
  const login = calls.filter((call) => call.path.includes("/custom"));
  expect(login).toHaveLength(1);
  expect(login[0].body.token).toBe("fixture.raven.signature");
  expect(calls.some((call) => /sessions|wallets\/create|wallets\/init/.test(call.path))).toBe(false);
});

test("the Account button loads the real SDK and links an existing provider wallet without a public manifest", async ({ page, baseURL }) => {
  const walletAddress = "0x1111111111111111111111111111111111111111";
  const token = [Buffer.from('{"alg":"ES256"}').toString('base64url'), Buffer.from(JSON.stringify({ sub: "did:privy:account-fixture", exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'), "fixture"].join(".");
  const calls = [];
  let manifestRequests = 0;
  await page.route("**/ravenos_asset_manifest.json", (route) => { manifestRequests++; return route.fulfill({ status: 404, body: "Not found" }); });
  await page.route("**/api/v1/auth/config", (route) => route.fulfill({ json: { ok: true, available: true, on_authenticated_origin: true, canonical_origin: baseURL, current_origin: baseURL, methods: { google: true, email: true } } }));
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({ json: { ok: true, authenticated: true, account: { username: "wallet_fixture", email: "wallet@example.test" }, session: { session_public_id: "sespub_fixture", current: true }, csrf_token: "csrf_fixture" } }));
  await page.route("**/api/v1/sessions", (route) => route.fulfill({ json: { ok: true, sessions: [], csrf_token: "csrf_fixture" } }));
  await page.route("**/api/v1/wallets/privy**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/session")) return route.fulfill({ json: { ok: true, token: "fixture.raven.signature", wallets: { evm: true, solana: false } } });
    if (path.endsWith("/link")) {
      calls.push("link");
      expect(route.request().headers()["privy-id-token"]).toBe(token);
      expect(route.request().headers()["x-ravenos-csrf"]).toBe("csrf_fixture");
      return route.fulfill({ json: { ok: true, linked: true, wallets: [{ ecosystem: "evm", address: walletAddress }] } });
    }
    return route.fulfill({ json: { ok: true, available: true, linked: false, app_id: "cmfirstusefixture123456", client_id: "first-use-fixture", capabilities: { evm: true, solana: false }, wallets: [] } });
  });
  await page.route("https://auth.privy.io/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/embedded-wallets")) return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Isolated wallet test</title>" });
    if (path.includes("/custom")) {
      calls.push("custom_login");
      return route.fulfill({ json: { user: { id: "did:privy:account-fixture", linked_accounts: [{ type: "wallet", chain_type: "ethereum", wallet_client_type: "privy", connector_type: "embedded", address: walletAddress, wallet_index: 0 }] }, token, identity_token: token } });
    }
    if (route.request().method() === "GET" && path.includes("/apps/")) return route.fulfill({ json: { id: "cmfirstusefixture123456", embedded_wallet_config: { mode: "user-controlled" } } });
    if (path.includes("analytics")) return route.fulfill({ json: {} });
    calls.push(`unexpected:${path}`);
    return route.fulfill({ status: 401, json: { error: "No previous session" } });
  });
  await page.goto("/account/");
  await expect(page.locator("#accountPrivyCreate")).toBeVisible();
  expect(await page.evaluate(() => Boolean(globalThis.__RAVENOS_PRIVY_WALLET_FACTORY__))).toBe(false);
  await page.locator("#accountPrivyCreate").click();
  await expect(page.locator("#accountPrivyState")).toHaveText("Ready");
  await expect(page.locator(".account-privy-wallet")).toContainText(walletAddress);
  expect(calls).toEqual(["custom_login", "link"]);
  expect(manifestRequests).toBe(0);
});

test("the pinned SDK adds Solana to an existing EVM identity once in the configured server-wallet mode", async ({ page }) => {
  const userId = "did:privy:two-chain-fixture";
  const evmAddress = "0x1111111111111111111111111111111111111111";
  const solanaAddress = "Stake11111111111111111111111111111111111111";
  const token = [Buffer.from('{"alg":"ES256"}').toString('base64url'), Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'), "fixture"].join(".");
  const linked_accounts = [{ type: "wallet", chain_type: "ethereum", wallet_client_type: "privy", connector_type: "embedded", address: evmAddress, wallet_index: 0 }];
  const session = () => ({ user: { id: userId, linked_accounts }, token, refresh_token: token, identity_token: token, session_update_action: "set" });
  const creations = [];
  const unexpected = [];
  await page.route("https://auth.privy.io/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/embedded-wallets")) return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Isolated wallet test</title>" });
    if (path.includes("/custom") || path.endsWith("/sessions")) return route.fulfill({ json: session() });
    if (request.method() === "GET" && path.includes("/apps/")) return route.fulfill({ json: { id: "cmfirstusefixture123456", embedded_wallet_config: { mode: "user-controlled-server-wallets-only" } } });
    if (path.endsWith("/wallets") && request.method() === "POST") {
      creations.push({ body: request.postDataJSON(), key: request.headers()["privy-idempotency-key"] });
      linked_accounts.push({ type: "wallet", id: "wallet-sol-fixture", chain_type: "solana", wallet_client_type: "privy", connector_type: "embedded", address: solanaAddress, wallet_index: 0 });
      return route.fulfill({ json: { id: "wallet-sol-fixture", chain_type: "solana", address: solanaAddress } });
    }
    if (path.includes("analytics")) return route.fulfill({ json: {} });
    unexpected.push(path);
    return route.fulfill({ status: 401, json: { error: "Unexpected fixture request" } });
  });
  await page.goto("/account/");
  const result = await page.evaluate(async () => {
    localStorage.clear();
    const { createRavenPrivyWalletClient } = await import("/ravenos-privy-wallet.js");
    const client = createRavenPrivyWalletClient({ appId: "cmfirstusefixture123456", clientId: "first-use-fixture" });
    await client.sync("fixture.raven.signature");
    const first = await client.provision({ evm: false, solana: true });
    const retried = await client.provision({ evm: true, solana: true });
    return { first, retried };
  });
  expect(unexpected).toEqual([]);
  expect(creations).toEqual([{ body: { chain_type: "solana" }, key: `ravenos:${userId}:solana:v1` }]);
  expect(result.first.evm.address).toBe(evmAddress);
  expect(result.first.solana.address).toBe(solanaAddress);
  expect(result.retried).toEqual(result.first);
});
