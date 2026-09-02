import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import worker from "../worker.mjs";
import { RAVENOS_CONTEXT_SCHEMA } from "../ravenos-context-store.js";
import {
  evaluateReleaseCohesion,
  expectedReleaseFromEnv,
} from "../lib/release_contract.mjs";
import { cloudflareReleaseEnv } from "../scripts/lib/cloudflare-release-env.mjs";
import { onchainChartProviderEnv } from "../scripts/lib/onchain-chart-provider-env.mjs";

const RELEASE_ID = "ravenos-abc123def456-0123456789abcdef";
const SOURCE_COMMIT = "abc123def456abc123def456abc123def456abcd";
const ASSET_DIGEST = "a".repeat(64);
const ORIGIN_CONTRACT = "ravenos_public_origin_manifest_v1";

function fixtures(overrides = {}) {
  const expected = {
    enforced: true,
    release_id: RELEASE_ID,
    source_commit: SOURCE_COMMIT,
    static_asset_manifest_sha256: ASSET_DIGEST,
    public_origin_contract_version: ORIGIN_CONTRACT,
  };
  return {
    expected,
    release: {
      schema_version: "ravenos.release.v1",
      release_id: RELEASE_ID,
      source_commit: SOURCE_COMMIT,
      public_build_id: "abc123def456",
      static_asset_manifest_sha256: ASSET_DIGEST,
      public_origin_contract_version: ORIGIN_CONTRACT,
    },
    build: {
      release_id: RELEASE_ID,
      source_commit: SOURCE_COMMIT,
      public_build_id: "abc123def456",
      static_asset_manifest_sha256: ASSET_DIGEST,
    },
    deploy: {
      schema_version: "ravenos.deploy.v2",
      release_id: RELEASE_ID,
      source_commit: SOURCE_COMMIT,
      static_asset_manifest_sha256: ASSET_DIGEST,
      artifact_content_sha256: "b".repeat(64),
      files: ["index.html"],
    },
    version: { id: "11111111-2222-3333-4444-555555555555", tag: RELEASE_ID, timestamp: "2026-07-21T20:00:00Z" },
    ...overrides,
  };
}

function releaseEnv() {
  return {
    RAVENOS_RELEASE_ENFORCE: "1",
    RAVENOS_RELEASE_ID: RELEASE_ID,
    RAVENOS_SOURCE_COMMIT: SOURCE_COMMIT,
    RAVENOS_STATIC_ASSET_MANIFEST_SHA256: ASSET_DIGEST,
    RAVENOS_PUBLIC_ORIGIN_CONTRACT_VERSION: ORIGIN_CONTRACT,
  };
}

function assetsBinding(payloads, fallback = new Response("not found", { status: 404 })) {
  return {
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (!(path in payloads)) return fallback;
      const value = payloads[path];
      if (value instanceof Response) return value.clone();
      return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
    },
  };
}

test("release cohesion accepts one exact Worker and asset tuple", () => {
  const result = evaluateReleaseCohesion(fixtures());
  assert.equal(result.ok, true);
  assert.equal(result.state, "coherent");
  assert.deepEqual(result.reasons, []);
});

test("release cohesion rejects mixed static assets", () => {
  const base = fixtures();
  const result = evaluateReleaseCohesion({
    ...base,
    deploy: { ...base.deploy, static_asset_manifest_sha256: "c".repeat(64) },
  });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("deploy_asset_manifest_mismatch"));
});

test("release cohesion rejects a Worker version carrying another release tag", () => {
  const result = evaluateReleaseCohesion(fixtures({
    version: { id: "11111111-2222-3333-4444-555555555555", tag: "another-release" },
  }));
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("worker_version_tag_mismatch"));
});

test("release cohesion accepts runtime metadata without a tag when the version ID is present", () => {
  const result = evaluateReleaseCohesion(fixtures({
    version: { id: "11111111-2222-3333-4444-555555555555", timestamp: "2026-07-21T20:00:00Z" },
  }));
  assert.equal(result.ok, true);
  assert.equal(result.worker_version_tag_visibility, "external_verification_required");
});

test("release cohesion is explicitly non-enforcing outside a packaged release", () => {
  const expected = expectedReleaseFromEnv({});
  const result = evaluateReleaseCohesion({ expected });
  assert.equal(result.ok, true);
  assert.equal(result.state, "not_enforced");
  assert.equal(result.enforced, false);
});

test("/api/build reports the runtime Worker version and matching release tuple", async () => {
  const base = fixtures();
  const env = {
    ...releaseEnv(),
    CF_VERSION_METADATA: base.version,
    ASSETS: assetsBinding({
      "/ravenos_release.json": base.release,
      "/ravenos_build.json": base.build,
      "/ravenos_deploy_manifest.json": base.deploy,
    }),
  };
  const response = await worker.fetch(new Request("https://preview.example/api/build"), env);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-ravenos-release-id"), RELEASE_ID);
  assert.equal(payload.cohesion.state, "coherent");
  assert.equal(payload.worker.version_id, base.version.id);
  assert.equal(payload.worker.expected_version_tag, RELEASE_ID);
});

test("an incoherent release fails closed before intelligence routes execute", async () => {
  const base = fixtures();
  const env = {
    ...releaseEnv(),
    CF_VERSION_METADATA: { ...base.version, tag: "wrong-release" },
    ASSETS: assetsBinding({
      "/ravenos_release.json": base.release,
      "/ravenos_build.json": base.build,
      "/ravenos_deploy_manifest.json": base.deploy,
    }),
  };
  const response = await worker.fetch(new Request("https://preview.example/api/health"), env);
  const payload = await response.json();
  assert.equal(response.status, 503);
  assert.equal(payload.error, "release_incoherent");
  assert.equal(payload.fail_closed, true);
  assert.ok(payload.reasons.includes("worker_version_tag_mismatch"));
});

test("public HTML revalidates, authenticated terminal HTML does not cache, and fingerprinted assets are immutable", async () => {
  const base = fixtures();
  const html = "<!doctype html><html><body>release</body></html>";
  const script = "export const release = true;";
  const binding = assetsBinding({
    "/ravenos_release.json": base.release,
    "/ravenos_build.json": base.build,
    "/ravenos_deploy_manifest.json": base.deploy,
    "/discover/": new Response(html, { headers: { "content-type": "text/html" } }),
    "/terminal/": new Response(html, { headers: { "content-type": "text/html" } }),
    "/assets/app.0123456789abcdef.js": new Response(script, { headers: { "content-type": "text/javascript" } }),
  });
  const env = { ...releaseEnv(), CF_VERSION_METADATA: base.version, ASSETS: binding };
  const page = await worker.fetch(new Request("https://preview.example/discover/"), env);
  const terminal = await worker.fetch(new Request("https://preview.example/terminal/"), env);
  const asset = await worker.fetch(new Request("https://preview.example/assets/app.0123456789abcdef.js"), env);
  assert.equal(page.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  assert.equal(terminal.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(asset.headers.get("cache-control"), "public, max-age=31536000, immutable");
});

test("generated deploy surface contains no unhashed JavaScript, CSS, or provider artwork", () => {
  const deploy = JSON.parse(readFileSync(".deploy-public/ravenos_deploy_manifest.json", "utf8"));
  const unhashed = (deploy.files || []).filter((file) => /\.(?:js|css|svg)$/.test(file) && !/^assets\/.+\.[0-9a-f]{16}\.(?:js|css|svg)$/.test(file));
  assert.deepEqual(unhashed, []);

  const assets = JSON.parse(readFileSync(".deploy-public/ravenos_asset_manifest.json", "utf8")).assets;
  const logo = assets["assets/providers/dexpaprika-symbol.svg"];
  const shell = assets["ravenos-shell.js"];
  assert.equal(logo.type, "image");
  assert.match(logo.path, /^assets\/.+\.[0-9a-f]{16}\.svg$/);
  assert.equal(shell.dependencies.includes("assets/providers/dexpaprika-symbol.svg"), true);
  assert.match(readFileSync(`.deploy-public/${shell.path}`, "utf8"), new RegExp(`/${logo.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("origin connectivity preflight resolves its probes from the immutable asset manifest", () => {
  const source = readFileSync("scripts/run-origin-connectivity-preflight.mjs", "utf8");
  assert.match(source, /ravenos_asset_manifest\.json/);
  assert.match(source, /\.\.\.preflightAssetUrls/);
  assert.match(source, /cloudflareReleaseEnv\(repoRoot\)/);
  assert.match(source, /attempts: 45/);
  assert.doesNotMatch(source, /["']\/ravenos-route-app\.js["']/);
  assert.doesNotMatch(source, /["']\/ravenos-shell\.css["']/);
});

test("release packaging carries the versioned on-chain provider gate without hard-wiring CoinGecko", () => {
  const source = readFileSync("scripts/package-release.mjs", "utf8");
  assert.match(source, /onchain_chart_provider: releaseConfig\.onchain_chart_provider/);
  assert.match(source, /RAVENOS_ONCHAIN_CHART_PROVIDER_ORDER/);
  assert.match(source, /RAVENOS_ONCHAIN_CHART_PRODUCTION_PROVIDER/);
  assert.match(source, /RAVENOS_ONCHAIN_CHART_PRODUCTION_QUALIFIED/);
  assert.match(source, /RAVENOS_SHADOW_LEDGER_ENABLED/);
  assert.match(source, /RAVENOS_CUSTOMER_TRADE_SOLANA_LIVE_ENABLE/);
  assert.match(source, /RAVENOS_SOLANA_FEE_COLLECTOR_ADDRESS/);
  assert.match(source, /RAVENOS_EVM_FEE_COLLECTOR_ADDRESS/);
  assert.match(source, /triggers: baseWrangler\.triggers/);
  assert.match(source, /cron_schedules/);
  assert.match(source, /ONCHAIN_CHART_PROVIDER_SECRET/);
  assert.doesNotMatch(source, /required_server_secret_bindings:[\s\S]{0,200}COINGECKO_PRO_API_KEY/);
  const releaseConfig = JSON.parse(readFileSync("config/release.json", "utf8"));
  assert.equal(releaseConfig.onchain_chart_provider.contract_version, "ravenos.onchain_chart_provider_registry.v1");
  assert.deepEqual(releaseConfig.onchain_chart_provider.evaluation_provider_order, ["dexpaprika", "coingecko_onchain"]);
  assert.equal(releaseConfig.onchain_chart_provider.preview_provider, "coingecko");
  assert.equal(releaseConfig.onchain_chart_provider.preview_provider_plan, "basic");
  assert.equal(releaseConfig.onchain_chart_provider.preview_provider_commercial, true);
  assert.equal(releaseConfig.onchain_chart_provider.provider_secret_binding, "ONCHAIN_CHART_PROVIDER_SECRET");
  assert.equal(releaseConfig.onchain_chart_provider.keyless_application_fallback_allowed, false);
  assert.equal(releaseConfig.onchain_chart_provider.production_provider, "coingecko");
  assert.equal(releaseConfig.onchain_chart_provider.production_provider_plan, "basic");
  assert.equal(releaseConfig.onchain_chart_provider.production_provider_commercial, true);
  assert.equal(releaseConfig.onchain_chart_provider.production_promotion_eligible, true);
  assert.deepEqual(releaseConfig.onchain_chart_provider.production_blockers, []);
  assert.equal(releaseConfig.onchain_chart_provider.production_qualification.pro_api_authentication_verified, true);
  assert.equal(releaseConfig.onchain_chart_provider.production_qualification.exact_pool_ohlcv_verified, true);
  assert.ok(releaseConfig.onchain_chart_provider.required_intervals.includes("1m"));
  assert.equal(releaseConfig.onchain_chart_provider.one_minute_minimum_useful_bars, 120);
  assert.equal(releaseConfig.onchain_chart_provider.subminute_candles_required, false);
  const promote = readFileSync("scripts/promote-release.mjs", "utf8");
  assert.match(promote, /Production promotion blocked by on-chain chart-provider gate/);
  assert.match(promote, /production_provider_plan === "demo"/);
  assert.doesNotMatch(promote, /PUBLIC_EVALUATION/);
  assert.match(promote, /"triggers", "deploy"/);
  assert.match(promote, /wrangler\.release\.jsonc/);
  const preview = readFileSync("scripts/verify-release-preview.mjs", "utf8");
  assert.match(preview, /chart_readiness\?\.one_minute_requirement !== "verified"/);
  assert.match(preview, /candle_series\?\.provider !== "coingecko_onchain"/);
  assert.match(preview, /commercial_state !== "commercial_qualified"/);
  assert.match(preview, /Server-only chart-provider secret entered the preview response/);
  assert.match(preview, /current_plus_retained_exact_pool_market_activity/);
  assert.match(preview, /discovery_lanes\?\.retained_exact_markets/);
  assert.match(preview, /captureQualifiedJson/);
  assert.match(preview, /qualifiedJupiterVelocityProjection/);
});

test("local provider validation inherits the qualified release contract without changing parent env", () => {
  const env = onchainChartProviderEnv(process.cwd(), {
    COINGECKO_API_KEY: "server-only-qualified-key",
    RAVEN_APP_ENV_PATH: "/does/not/exist",
  });
  assert.equal(env.ONCHAIN_CHART_PROVIDER, "coingecko");
  assert.equal(env.ONCHAIN_CHART_PROVIDER_PLAN, "basic");
  assert.equal(env.ONCHAIN_CHART_PROVIDER_COMMERCIAL, "true");
  assert.equal(env.ONCHAIN_CHART_PROVIDER_SECRET, "server-only-qualified-key");
  assert.equal(env.RAVENOS_ONCHAIN_CHART_PRODUCTION_PROVIDER, "coingecko");
  assert.equal(env.RAVENOS_ONCHAIN_CHART_PRODUCTION_QUALIFIED, "1");
});

test("release environment keeps Cloudflare aliases and the protected-origin token server-side", () => {
  const env = cloudflareReleaseEnv(process.cwd(), {
    RAVEN_APP_ENV_PATH: "/nonexistent/ravenos-release-test.env",
    CLOUDFLARE_API_TOKEN: "test-cloudflare-token",
    CLOUDFLARE_ACCOUNT_ID: "test-account-id",
    RAVENOS_PUBLIC_ORIGIN_TOKEN: "test-origin-token",
  });
  assert.equal(env.CLOUDFLARE_API_TOKEN, "test-cloudflare-token");
  assert.equal(env.CLOUDFLARE_ACCOUNT_ID, "test-account-id");
  assert.equal(env.CLOUDFLARE_API_ACCOUNT_ID, "test-account-id");
  assert.equal(env.RAVENOS_PUBLIC_ORIGIN_TOKEN, "test-origin-token");
});

test("staging can attach a newly required secret to an undeployed version without mutating production first", () => {
  const source = readFileSync("scripts/stage-release.mjs", "utf8");
  assert.match(source, /RAVENOS_RELEASE_SECRETS_FILE/);
  assert.match(source, /"versions", "upload"/);
  assert.match(source, /uploadArguments\.push\("--secrets-file", releaseSecretsFile\)/);
  assert.match(source, /!configuredSecrets\.has\(name\) && !suppliedSecrets\.has\(name\)/);
  assert.match(source, /bindings not declared by the package/);
  assert.doesNotMatch(source, /\bsecret\s+put\b/);
});

test("generated build manifest advertises the browser context contract actually shipped", () => {
  const build = JSON.parse(readFileSync("public/ravenos_build.json", "utf8"));
  assert.equal(build.api_schema_versions?.selected_context, RAVENOS_CONTEXT_SCHEMA);
  assert.equal(build.api_schema_versions?.chart_candle_series, "ravenos.chart_candle_series.v1");
  assert.equal(build.api_schema_versions?.chart_capability_registry, "ravenos.chart_capability_registry.v1");
  assert.equal(build.api_schema_versions?.onchain_chart_provider_registry, "ravenos.onchain_chart_provider_registry.v1");
});
