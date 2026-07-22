import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import worker from "../worker.mjs";
import { RAVENOS_CONTEXT_SCHEMA } from "../ravenos-context-store.js";
import {
  evaluateReleaseCohesion,
  expectedReleaseFromEnv,
} from "../lib/release_contract.mjs";

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

test("coherent HTML revalidates while fingerprinted assets are immutable", async () => {
  const base = fixtures();
  const html = "<!doctype html><html><body>release</body></html>";
  const script = "export const release = true;";
  const binding = assetsBinding({
    "/ravenos_release.json": base.release,
    "/ravenos_build.json": base.build,
    "/ravenos_deploy_manifest.json": base.deploy,
    "/terminal/": new Response(html, { headers: { "content-type": "text/html" } }),
    "/assets/app.0123456789abcdef.js": new Response(script, { headers: { "content-type": "text/javascript" } }),
  });
  const env = { ...releaseEnv(), CF_VERSION_METADATA: base.version, ASSETS: binding };
  const page = await worker.fetch(new Request("https://preview.example/terminal/"), env);
  const asset = await worker.fetch(new Request("https://preview.example/assets/app.0123456789abcdef.js"), env);
  assert.equal(page.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  assert.equal(asset.headers.get("cache-control"), "public, max-age=31536000, immutable");
});

test("generated deploy surface contains no unhashed JavaScript or CSS", () => {
  const deploy = JSON.parse(readFileSync(".deploy-public/ravenos_deploy_manifest.json", "utf8"));
  const unhashed = (deploy.files || []).filter((file) => /\.(?:js|css)$/.test(file) && !/^assets\/.+\.[0-9a-f]{16}\.(?:js|css)$/.test(file));
  assert.deepEqual(unhashed, []);
});

test("origin connectivity preflight resolves its probes from the immutable asset manifest", () => {
  const source = readFileSync("scripts/run-origin-connectivity-preflight.mjs", "utf8");
  assert.match(source, /ravenos_asset_manifest\.json/);
  assert.match(source, /\.\.\.preflightAssetUrls/);
  assert.doesNotMatch(source, /["']\/ravenos-route-app\.js["']/);
  assert.doesNotMatch(source, /["']\/ravenos-shell\.css["']/);
});

test("generated build manifest advertises the browser context contract actually shipped", () => {
  const build = JSON.parse(readFileSync("public/ravenos_build.json", "utf8"));
  assert.equal(build.api_schema_versions?.selected_context, RAVENOS_CONTEXT_SCHEMA);
});
