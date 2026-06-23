import assert from "node:assert/strict";
import {
  accessConfig,
  accessThresholds,
  resolveAccessFromSignals,
  resolveWalletAccess,
} from "../lib/ravenos_access.mjs";

const baseEnv = {
  RAVENOS_TOKEN_SUPPLY: "1000000000",
  RAVENOS_PRO_THRESHOLD_EARLY: "1000000",
  RAVENOS_PRO_THRESHOLD_GROWTH: "500000",
  RAVENOS_PRO_THRESHOLD_MATURE: "100000",
  RAVENOS_FOUNDER_THRESHOLD: "10000000",
};

assert.equal(accessThresholds({ ...baseEnv, RAVENOS_MARKET_CAP_STAGE: "early" }).pro, 1_000_000);
assert.equal(accessThresholds({ ...baseEnv, RAVENOS_MARKET_CAP_STAGE: "growth" }).pro, 500_000);
assert.equal(accessThresholds({ ...baseEnv, RAVENOS_MARKET_CAP_STAGE: "mature" }).pro, 100_000);
assert.equal(accessThresholds({ ...baseEnv, RAVENOS_MARKET_CAP_STAGE: "bad" }).pro, 1_000_000);
assert.equal(accessThresholds({ ...baseEnv, RAVENOS_MARKET_CAP_STAGE: "bad" }).stage, "early");

assert.deepEqual(
  resolveAccessFromSignals({ tokenBalance: 10_000_000, env: { ...baseEnv, RAVENOS_MARKET_CAP_STAGE: "mature" } }).tier,
  "founder",
);
assert.equal(
  resolveAccessFromSignals({ tokenBalance: 0, stripeStatus: "trialing", env: baseEnv }).tier,
  "pro",
);
assert.equal(
  resolveAccessFromSignals({ tokenBalance: 499_999, env: { ...baseEnv, RAVENOS_MARKET_CAP_STAGE: "growth" } }).tier,
  "free",
);
assert.equal(
  resolveAccessFromSignals({ tokenBalance: 500_000, env: { ...baseEnv, RAVENOS_MARKET_CAP_STAGE: "growth" } }).tier,
  "pro",
);

assert.equal(accessConfig(baseEnv).tokenAccessConfigured, false);
const dormant = await resolveWalletAccess({ owner: "wallet", env: baseEnv, fetchImpl: async () => { throw new Error("should_not_fetch"); } });
assert.equal(dormant.tier, "free");
assert.equal(dormant.tokenAccessConfigured, false);
