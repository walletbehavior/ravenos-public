import test from "node:test";
import assert from "node:assert/strict";
import { PREFERENCE_KEY, PREFERENCE_TTL_MS, readPreferences, getPreference, setPreference, resetPreferences, accountReturnPath } from "../ravenos-preferences.js";

function fixture() {
  const values = new Map();
  return { now: 1000, storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) } };
}
test("device preferences merge only explicit presentation choices and survive a new reader", () => {
  const f = fixture();
  for (const [key, value] of Object.entries({ returning: true, discoverChain: "base", discoverTimeframe: "1h", discoverSort: "activity", walletChain: "all", walletPeriod: "d7", balanceNetwork: "solana" })) assert.equal(setPreference(key, value, f), true);
  assert.equal(getPreference("discoverChain", "all", f), "base");
  assert.equal(getPreference("balanceNetwork", "base", f), "solana");
  for (const [key, value] of Object.entries({ wallet: "0x123", csrf: "secret", acceptedTerms: true, rememberDevice: true, balance: "10000", slippage: 10, autoApply: true, discoverChain: "evil", walletPeriod: "forever" })) assert.equal(setPreference(key, value, f), false);
  assert.equal(Object.keys(readPreferences(f)).length, 7);
  assert(!f.storage.getItem(PREFERENCE_KEY).includes("secret"));
});
test("corrupt, oversized, future-dated and expired preferences cannot become authority", () => {
  const f = fixture();
  for (const raw of ["null", "{broken", "a".repeat(2049), JSON.stringify({version:2,savedAt:1000,values:{returning:true}}), JSON.stringify({version:1,savedAt:1001,values:{returning:true}})]) {
    f.storage.setItem(PREFERENCE_KEY, raw); assert.deepEqual(readPreferences(f), {});
  }
  setPreference("returning", true, f);
  assert.deepEqual(readPreferences({ ...f, now: f.now + PREFERENCE_TTL_MS }), {});
  f.storage.setItem(PREFERENCE_KEY, JSON.stringify({version:1,savedAt:1000,values:{returning:true,acceptedTerms:true,wallet:"private",balanceNetwork:"USDC.e"}}));
  assert.deepEqual(readPreferences(f), { returning: true });
});
test("disabled storage falls back without breaking the application; reset is narrowly scoped", () => {
  const broken = { getItem(){throw Error("blocked");}, setItem(){throw Error("blocked");}, removeItem(){throw Error("blocked");} };
  assert.equal(getPreference("walletChain", "all", {storage:broken}), "all");
  assert.equal(setPreference("returning", true, {storage:broken}), false);
  assert.equal(resetPreferences({storage:broken}), false);
  const f=fixture(); f.storage.setItem("unrelated", "untouched"); setPreference("walletPeriod", "d7", f);
  assert.equal(resetPreferences(f), true); assert.deepEqual(readPreferences(f), {}); assert.equal(f.storage.getItem("unrelated"), "untouched");
});
test("sign-in resumes exact supported workspaces and anchors without external or API redirects", () => {
  assert.equal(accountReturnPath("/portfolio/?tab=capital#shielded-reserve"), "/portfolio/?tab=capital#shielded-reserve");
  assert.equal(accountReturnPath("/account/copy/?chain=robinhood#copyScreener"), "/account/copy/?chain=robinhood#copyScreener");
  assert.equal(accountReturnPath("/terminal/?auth=failed&chain=base"), "/terminal/?chain=base");
  for(const bad of ["https://evil.test", "//evil.test/path", "/\\evil.test", "/api/v1/auth/logout", "/account/\n", "/account/%2e%2e/api/v1/auth/session", "/unrecognized/", "/"+"a".repeat(1600)]) assert.equal(accountReturnPath(bad), "/account/");
});
