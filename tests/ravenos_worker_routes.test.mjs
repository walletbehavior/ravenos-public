import assert from "node:assert/strict";
import worker from "../worker.mjs";

const assetResponse = new Response("asset", { status: 200 });
const env = {
  ASSETS: { fetch: async () => assetResponse },
  RAVENOS_MARKET_CAP_STAGE: "growth",
  RAVENOS_PRO_THRESHOLD_GROWTH: "500000",
  RAVENOS_FOUNDER_THRESHOLD: "10000000",
};

const noWallet = await worker.fetch(new Request("https://ravenos.xyz/api/access"), env);
assert.equal(noWallet.status, 200);
const noWalletPayload = await noWallet.json();
assert.equal(noWalletPayload.tier, "free");
assert.equal(noWalletPayload.status, "disconnected");
assert.equal(noWalletPayload.tokenAccessConfigured, false);
assert.equal(noWalletPayload.thresholds.pro, 500_000);

const wallet = await worker.fetch(new Request("https://ravenos.xyz/api/access?wallet=abc"), env);
assert.equal(wallet.status, 200);
const walletPayload = await wallet.json();
assert.equal(walletPayload.tier, "free");
assert.equal(walletPayload.wallet, "abc");
assert.equal(walletPayload.tokenAccessStatus, "not_configured");

const dotPath = await worker.fetch(new Request("https://ravenos.xyz/.git/HEAD"), env);
assert.equal(dotPath.status, 404);

const staticAsset = await worker.fetch(new Request("https://ravenos.xyz/terminal/"), env);
assert.equal(staticAsset.status, 200);
assert.equal(await staticAsset.text(), "asset");
