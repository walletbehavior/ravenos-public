import test from "node:test";
import assert from "node:assert/strict";
import { createEmbeddedWalletView } from "../ravenos-embedded-wallet-view.js";
const evm = { ecosystem: "evm", address: "0x1111111111111111111111111111111111111111" };
test("saved EVM address opens without SDK, signing session, or provisioning", async () => {
  const view = createEmbeddedWalletView(evm);
  assert.deepEqual(await view.request({ method: "eth_requestAccounts" }), [evm.address]);
  assert.deepEqual(await view.request({ method: "eth_accounts" }), [evm.address]);
  assert.equal(view.ravenWalletViewOnly, true);
});
test("saved Solana wallet implements the public-key connection interface", async () => {
  const view = createEmbeddedWalletView({ ecosystem: "solana", address: "Stake11111111111111111111111111111111111111" });
  assert.equal((await view.connect()).publicKey, view.publicKey.toString());
});
test("wallet view refuses every signing and transaction method", async () => {
  const view = createEmbeddedWalletView(evm);
  for (const method of ["eth_sign", "personal_sign", "eth_signTypedData_v4", "eth_sendTransaction", "eth_sendRawTransaction", "eth_signTransaction", "wallet_switchEthereumChain"]) await assert.rejects(view.request({ method }), { code: 4100 });
  for (const method of ["signMessage", "signTransaction", "signAllTransactions", "signAndSendTransaction"]) await assert.rejects(view[method](), { code: 4100 });
});
test("wallet view validates ecosystem and address", () => {
  for (const wallet of [{ ecosystem: "zec", address: "u1" }, { ecosystem: "evm", address: "javascript:alert(1)" }, { ecosystem: "solana", address: evm.address }]) assert.throws(() => createEmbeddedWalletView(wallet));
});
test("disconnect notifies only bound listeners", async () => {
  const view = createEmbeddedWalletView(evm); let count = 0; const fn = () => count++;
  view.on("disconnect", fn); await view.disconnect(); await view.disconnect(); assert.equal(count, 1);
});
