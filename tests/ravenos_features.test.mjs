import assert from "node:assert/strict";
import {
  FEATURE_REGISTRY,
  canAccessFeature,
  lockedPreviewModel,
  resolveFeatureAccess,
  tierEntitlements,
} from "../lib/ravenos_features.mjs";

const required = [
  "free_token_lookup",
  "basic_chart",
  "basic_overlays",
  "market_cap_heatmap",
  "limited_structure_tape",
  "research_preview",
  "full_heatmaps",
  "full_structure_tape",
  "full_replay_engine",
  "full_research",
  "failure_analysis",
  "candidate_lanes",
  "attribution",
  "alerts",
  "watchlists",
  "perps_intelligence",
  "participant_intelligence",
  "founder_experiments",
  "atlas_context",
];

for (const key of required) {
  assert.ok(FEATURE_REGISTRY[key], `${key} should be registered`);
  assert.ok(FEATURE_REGISTRY[key].requiredTier, `${key} should define required tier`);
  assert.ok(FEATURE_REGISTRY[key].displayName, `${key} should define display name`);
  assert.ok(FEATURE_REGISTRY[key].description, `${key} should define description`);
  assert.ok(FEATURE_REGISTRY[key].previewBehavior, `${key} should define preview behavior`);
  assert.ok(FEATURE_REGISTRY[key].upgradeCta, `${key} should define upgrade CTA`);
}

assert.equal(canAccessFeature("free_token_lookup", { tier: "free" }), true);
assert.equal(canAccessFeature("basic_chart", { tier: "free" }), true);
assert.equal(canAccessFeature("research_preview", { tier: "free" }), true);
assert.equal(canAccessFeature("full_research", { tier: "free" }), false);
assert.equal(canAccessFeature("full_research", { tier: "pro" }), true);
assert.equal(canAccessFeature("perps_intelligence", { tier: "pro" }), true);
assert.equal(canAccessFeature("participant_intelligence", { tier: "free" }), false);
assert.equal(canAccessFeature("participant_intelligence", { tier: "pro" }), true);
assert.equal(canAccessFeature("founder_experiments", { tier: "pro" }), false);
assert.equal(canAccessFeature("founder_experiments", { tier: "founder" }), true);
assert.equal(canAccessFeature("atlas_context", { tier: "atlas" }), true);
assert.equal(canAccessFeature("full_research", { tier: "atlas" }), false);

assert.deepEqual(tierEntitlements({ tier: "free" }), ["free"]);
assert.deepEqual(tierEntitlements({ tier: "pro" }), ["free", "pro"]);
assert.deepEqual(tierEntitlements({ tier: "founder" }), ["free", "pro", "founder"]);
assert.deepEqual(tierEntitlements({ tier: "atlas" }), ["free", "atlas"]);
assert.deepEqual(tierEntitlements({ tier: "atlas", tokenTier: "founder" }), ["free", "pro", "founder", "atlas"]);

const locked = lockedPreviewModel("candidate_lanes", { tier: "free" });
assert.equal(locked.locked, true);
assert.equal(locked.requiredTier, "pro");
assert.match(locked.title, /Candidate/);
assert.match(locked.preview, /Locked|preview/i);

const allowed = resolveFeatureAccess("market_cap_heatmap", { tier: "free" });
assert.equal(allowed.allowed, true);
