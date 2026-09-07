import test from "node:test";
import assert from "node:assert/strict";
import { walletHandoffTarget, walletLaunchHref } from "../ravenos-wallet-connect.js";

test("wallet handoffs discard account credentials and private URL state", () => {
  const target = walletHandoffTarget("https://app.ravenos.xyz/account/?code=secret&email=private&privy=owner-canary#token");
  assert.equal(target.href, "https://app.ravenos.xyz/account/");
  const href = walletLaunchHref("Phantom", "solana", target.href);
  assert.equal(href, `https://phantom.app/ul/browse/${encodeURIComponent(target.href)}?ref=${encodeURIComponent(target.origin)}`);
});

test("Terminal handoffs retain only bounded public market navigation", () => {
  const target = walletHandoffTarget("https://ravenos.xyz/terminal/?chain=solana&asset=So11111111111111111111111111111111111111112&token=private&email=private&return_to=https://bad.test#private");
  assert.equal(target.searchParams.get("chain"), "solana");
  assert.equal(target.searchParams.has("asset"), true);
  assert.equal(target.searchParams.size, 2);
  assert.equal(target.hash, "");
});

test("untrusted origins and non-navigation routes cannot enter wallet browsers", () => {
  for (const input of ["https://ravenos.xyz.evil.test/terminal/", "javascript:alert(1)", "https://app.ravenos.xyz/api/v1/auth/callback?code=private", "https://user:password@evil.test/"]) {
    assert.equal(walletHandoffTarget(input).href, "https://app.ravenos.xyz/account/");
  }
});

test("supported mobile wallet links use official browse endpoints", () => {
  const account = "https://app.ravenos.xyz/account/";
  assert.equal(new URL(walletLaunchHref("Solflare", "solana", account)).origin, "https://solflare.com");
  assert.equal(walletLaunchHref("MetaMask", "evm", account), "https://metamask.app.link/dapp/app.ravenos.xyz/account/");
  assert.match(walletLaunchHref("Phantom", "evm", account), /phantom\.app\/ul\/browse/);
  assert.equal(walletLaunchHref("MetaMask", "solana", account), null);
  assert.equal(walletLaunchHref("Unknown", "evm", account), null);
});
