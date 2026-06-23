import assert from "node:assert/strict";
import { coverageLabel, resolveProviderFallback } from "../lib/ravenos_fallbacks.mjs";

assert.equal(resolveProviderFallback({ domain: "crypto_spot", raven: { lastUpdated: "now" } }).coverage, "Live");
assert.equal(resolveProviderFallback({ domain: "crypto_spot", dexscreener: { lastUpdated: "public" } }).provider, "Dexscreener");
assert.equal(resolveProviderFallback({ domain: "crypto_spot", dexscreener: { lastUpdated: "public" } }).coverage, "Public fallback");
assert.equal(resolveProviderFallback({ domain: "crypto_spot", cache: { lastUpdated: "2026-06-22T00:00:00Z" } }).isCached, true);
assert.equal(resolveProviderFallback({ domain: "crypto_spot", sample: {} }).isSample, true);
assert.equal(resolveProviderFallback({ domain: "equities", sample: {} }).coverage, "Preview");
assert.equal(resolveProviderFallback({ domain: "equities" }).coverage, "Unavailable");
assert.match(coverageLabel({ coverage: "Public fallback", warning: "Limited public coverage" }), /Limited public coverage/);
