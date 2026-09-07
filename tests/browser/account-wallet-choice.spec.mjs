import { buildSync } from "esbuild";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const EVM = { ecosystem: "evm", address: "0x1111111111111111111111111111111111111111" };
const SOL = { ecosystem: "solana", address: "Stake11111111111111111111111111111111111111" };
async function accountFixture(page, baseURL, { wallets = [], capabilities = { evm: true, solana: true }, sessionCapabilities = capabilities, failure = null } = {}) {
  const calls = [];
  await page.addInitScript(({ evm, sol, failure }) => {
    globalThis.__PROVISION_CALLS__ = [];
    globalThis.__RAVENOS_PRIVY_WALLET_FACTORY__ = { create: () => ({
      sync: async () => ({}),
      provision: async (selection) => {
        globalThis.__PROVISION_CALLS__.push(selection);
        if (failure) throw new Error("sensitive_provider_detail");
        return { evm: selection.evm ? evm : null, solana: selection.solana ? sol : null };
      },
      identityToken: async () => "fixture.identity.token",
    }) };
  }, { evm: EVM, sol: SOL, failure });
  await page.route("**/api/v1/auth/config", (route) => route.fulfill({ json: { ok: true, available: true, on_authenticated_origin: true, canonical_origin: baseURL, current_origin: baseURL, methods: { google: true, email: true } } }));
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({ json: { ok: true, authenticated: true, account: { username: "wallet_test", email: "test@example.test" }, session: { current: true }, csrf_token: "csrf_test" } }));
  await page.route("**/api/v1/sessions", (route) => route.fulfill({ json: { ok: true, sessions: [], csrf_token: "csrf_test" } }));
  await page.route("**/api/v1/wallets/privy**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST") {
      expect(route.request().headers()["x-ravenos-csrf"]).toBe("csrf_test");
      calls.push(path);
    }
    if (path.endsWith("/session")) return route.fulfill({ json: { ok: true, token: "fixture.raven.token", wallets: sessionCapabilities } });
    if (path.endsWith("/link")) {
      expect(route.request().headers()["privy-id-token"]).toBe("fixture.identity.token");
      const selection = await page.evaluate(() => globalThis.__PROVISION_CALLS__.at(-1));
      const linked = [EVM, SOL].filter((wallet) => selection[wallet.ecosystem] || wallets.some((existing) => existing.ecosystem === wallet.ecosystem));
      return route.fulfill({ json: { ok: true, linked: true, wallets: linked } });
    }
    return route.fulfill({ json: { ok: true, available: true, linked: wallets.length > 0, wallets, capabilities, app_id: "cmfirstusefixture123456", client_id: "test" } });
  });
  return calls;
}

for (const [selection, expected] of [["both", { evm: true, solana: true }], ["solana", { evm: false, solana: true }], ["evm", { evm: true, solana: false }]]) {
  test(`wallet choice ${selection} provisions only the chosen ecosystems on explicit action`, async ({ page, baseURL }) => {
    const calls = await accountFixture(page, baseURL);
    await page.goto("/account/");
    await page.getByLabel("Wallet type", { exact: true }).selectOption(selection);
    expect(calls).toEqual([]);
    expect(await page.evaluate(() => globalThis.__PROVISION_CALLS__)).toEqual([]);
    await page.locator("#accountPrivyCreate").click();
    await expect(page.locator("#accountPrivyState")).toHaveText("Ready");
    expect(await page.evaluate(() => globalThis.__PROVISION_CALLS__)).toEqual([expected]);
    await expect(page.locator(".account-privy-wallet")).toHaveCount(selection === "both" ? 2 : 1);
    if (selection === "both") await expect(page.locator("#accountPrivyCreate")).toBeHidden();
    else await expect(page.locator("#accountPrivyCreate")).toHaveText(selection === "evm" ? "Add Solana wallet" : "Add EVM wallet");
  });
}

test("an existing EVM wallet can add Solana without replacing its address", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await accountFixture(page, baseURL, { wallets: [EVM] });
  await page.goto("/account/");
  await expect(page.locator("#accountPrivyEcosystem option")).toHaveCount(1);
  await expect(page.locator("#accountPrivyCreate")).toHaveText("Add Solana wallet");
  await page.locator("#accountPrivyPanel").screenshot({ path: test.info().outputPath("add-solana-mobile.png") });
  await page.locator("#accountPrivyCreate").click();
  await expect(page.locator(".account-privy-wallet")).toHaveCount(2);
  await expect(page.locator("#accountPrivyWallets")).toContainText(EVM.address);
  await expect(page.locator("#accountPrivyWallets")).toContainText(SOL.address);
  expect(await page.evaluate(() => globalThis.__PROVISION_CALLS__)).toEqual([{ evm: false, solana: true }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
});

test("creation rechecks server capabilities and fails closed when an ecosystem was disabled", async ({ page, baseURL }) => {
  await accountFixture(page, baseURL, { sessionCapabilities: { evm: true, solana: false } });
  await page.goto("/account/");
  await page.getByLabel("Wallet type", { exact: true }).selectOption("solana");
  await page.locator("#accountPrivyCreate").click();
  await expect(page.locator("#accountPrivyStatus")).toContainText("no longer available");
  expect(await page.evaluate(() => globalThis.__PROVISION_CALLS__)).toEqual([]);
});

test("failed provisioning offers recovery without exposing provider error details", async ({ page, baseURL }) => {
  await accountFixture(page, baseURL, { failure: "create" });
  await page.goto("/account/");
  await page.locator("#accountPrivyCreate").click();
  await expect(page.locator("#accountPrivyStatus")).toContainText("any wallet already created will be recovered");
  await expect(page.locator("#accountPrivyCreate")).toBeEnabled();
  await expect(page.locator("body")).not.toContainText("sensitive_provider_detail");
});

test("iPhone Chrome without injected wallets offers a safe app handoff without claiming connection", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.39 Mobile/15E148 Safari/604.1" });
  const page = await context.newPage();
  const calls = await accountFixture(page, baseURL);
  await page.goto(`${baseURL}/account/?code=private&privy=owner-canary#secret`);
  await page.locator("#accountConnectSolana").click();
  const dialog = page.getByRole("dialog", { name: "Connect a Solana wallet" });
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("wallet-handoff-iphone-chrome.png") });
  await expect(dialog).toContainText("does not connect the wallet to your Chrome or Safari tab");
  await expect(dialog.getByRole("link", { name: "Open Phantom" })).toHaveAttribute("href", `https://phantom.app/ul/browse/${encodeURIComponent("https://app.ravenos.xyz/account/")}?ref=${encodeURIComponent("https://app.ravenos.xyz")}`);
  await expect(dialog.getByRole("link", { name: "Open Solflare" })).toHaveAttribute("href", /solflare\.com\/ul\/v1\/browse/);
  await expect(page.locator("#accountWalletConnectionState")).toHaveText("Read only");
  expect(await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(2);
  await dialog.getByRole("button", { name: "Back to account" }).click();
  await expect(page.locator("#accountConnectSolana")).toBeFocused();
  await page.locator("#accountConnectEvm").click();
  await expect(page.getByRole("link", { name: "Open MetaMask" })).toHaveAttribute("href", "https://metamask.app.link/dapp/app.ravenos.xyz/account/");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(calls).toEqual([]);
  const stored = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));
  expect(stored.local.filter((key) => /auth|session|csrf|email|wallet/i.test(key))).toEqual([]);
  expect(stored.session).toEqual([]);
  await context.close();
});


test("Phantom's namespaced EVM provider connects after a wallet-browser handoff", async ({ page, baseURL }) => {
  await accountFixture(page, baseURL);
  await page.addInitScript((address) => {
    globalThis.__EVM_METHODS__ = [];
    globalThis.phantom = { ethereum: { request: async ({ method }) => {
      globalThis.__EVM_METHODS__.push(method);
      return method === "eth_requestAccounts" ? [address] : [];
    } } };
  }, EVM.address);
  await page.goto("/account/");
  await page.locator("#accountConnectEvm").click();
  await expect(page.locator("#accountWalletConnectionState")).toHaveText("Connected");
  await expect(page.locator("#accountWalletConnectStatus")).toHaveText("Phantom connected · no signature");
  expect(await page.evaluate(() => globalThis.__EVM_METHODS__)).toEqual(["eth_requestAccounts"]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

const exportBundle = buildSync({ entryPoints: ["client/ravenos-privy-export-entry.jsx"], bundle: true, format: "esm", write: false,
  define: { "process.env.NODE_ENV": '"production"' },
  alias: { "@privy-io/react-auth": resolve("tests/fixtures/privy_export_react_sdk.jsx"), "@privy-io/react-auth/solana": resolve("tests/fixtures/privy_export_solana_sdk.mjs") },
}).outputFiles[0].text;

for (const wallet of [EVM, SOL]) test(`funding and secure ${wallet.ecosystem} export stay separate from wallet creation and trading`, async ({page,baseURL}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await accountFixture(page,baseURL,{wallets:[wallet]});
  await page.addInitScript(wallet=>{
    globalThis.__EXPORT_CALLS__=[];
    globalThis.__EXPORT_USER__={linkedAccounts:[{type:"wallet",walletClientType:"privy",chainType:wallet.ecosystem==="evm"?"ethereum":"solana",address:wallet.address}]};
  },wallet);
  await page.route("**/ravenos-privy-export.js",route=>route.fulfill({contentType:"application/javascript",body:exportBundle}));
  await page.goto("/account/");
  await page.getByText("Funding this wallet",{exact:true}).click();
  await expect(page.locator(".account-wallet-funding")).toContainText(wallet.ecosystem==="solana"?"canonical USDC on Solana":"Balances stay on that network");
  await expect(page.locator(".account-wallet-funding")).toContainText("small test transfer");
  expect(calls).toEqual([]);
  await page.getByRole("button",{name:"Secure export",exact:true}).click();
  await expect(page.getByRole("dialog")).toContainText("Raven cannot read it");
  await expect.poll(()=>page.evaluate(()=>globalThis.__EXPORT_SESSION_READY__)).toBe(true);
  expect(await page.evaluate(()=>globalThis.__EXPORT_CALLS__)).toEqual([]);
  await page.locator(".raven-wallet-export-dialog").screenshot({path:test.info().outputPath(`secure-export-${wallet.ecosystem}.png`)});
  await page.getByRole("button",{name:"Open secure export",exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(()=>globalThis.__EXPORT_CALLS__)).toEqual([wallet]);
  expect(calls).toEqual(["/api/v1/wallets/privy/session"]);
  expect(await page.evaluate(()=>globalThis.__PROVISION_CALLS__)).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(2);
});

test("an export identity mismatch never reaches the provider export method",async({page,baseURL})=>{
  await accountFixture(page,baseURL,{wallets:[EVM]});
  await page.addInitScript(()=>{globalThis.__EXPORT_CALLS__=[];globalThis.__EXPORT_USER__={linkedAccounts:[]};});
  await page.route("**/ravenos-privy-export.js",route=>route.fulfill({contentType:"application/javascript",body:exportBundle}));
  await page.goto("/account/");
  await page.getByRole("button",{name:"Secure export",exact:true}).click();
  await expect(page.getByRole("button",{name:"Open secure export",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"Close",exact:true}).click();
  expect(await page.evaluate(()=>globalThis.__EXPORT_CALLS__)).toEqual([]);
});
