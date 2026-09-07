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
