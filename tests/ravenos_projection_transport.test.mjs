import assert from "node:assert/strict";
import test from "node:test";

import {
  loadResilientPublicProjection,
  resetPublicProjectionTransportForTests,
} from "../lib/ravenos_projection_transport.mjs";

const ENV = Object.freeze({
  RAVENOS_PUBLIC_ORIGIN_URL: "https://origin.example/public/ravenos",
  RAVENOS_PUBLIC_ORIGIN_TOKEN: "transport-test-token",
});

function envelope(generatedAt = "2026-08-27T20:00:00Z") {
  return {
    ok: true,
    safe_public: true,
    key: "brief",
    schema_version: "ravenos_brief_public_origin_v1",
    generated_at: generatedAt,
    updated_at: generatedAt,
    freshness_target_seconds: 900,
    redaction_policy: "aggregate_public_market_context_only",
    data: { one_sentence_read: "Current evidence remains constructive." },
  };
}

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function memoryCache() {
  const rows = new Map();
  return {
    rows,
    async match(request) {
      return rows.get(request.url)?.clone();
    },
    async put(request, value) {
      rows.set(request.url, value.clone());
    },
  };
}

test("validated public projections are reused briefly without another origin request", async () => {
  resetPublicProjectionTransportForTests();
  const cache = memoryCache();
  let calls = 0;
  const first = await loadResilientPublicProjection({
    env: ENV,
    key: "brief",
    cache,
    nowMs: Date.parse("2026-08-27T20:00:10Z"),
    fetchImpl: async () => {
      calls += 1;
      return response(envelope());
    },
  });
  const second = await loadResilientPublicProjection({
    env: ENV,
    key: "brief",
    cache,
    nowMs: Date.parse("2026-08-27T20:00:20Z"),
    fetchImpl: async () => {
      calls += 1;
      return response({}, 503);
    },
  });
  assert.equal(calls, 1);
  assert.equal(first.delivery.transport.state, "origin_current");
  assert.equal(second.delivery.transport.state, "edge_cache_fresh");
  assert.equal(second.delivery.source, "current_public_origin");
  assert.equal(second.delivery.fallback, false);
});

test("concurrent misses share one protected-origin request", async () => {
  resetPublicProjectionTransportForTests();
  const cache = memoryCache();
  let calls = 0;
  let releaseOrigin;
  const originReady = new Promise((resolve) => { releaseOrigin = resolve; });
  const fetchImpl = async () => {
    calls += 1;
    await originReady;
    return response(envelope());
  };
  const options = {
    env: ENV,
    key: "brief",
    cache,
    nowMs: Date.parse("2026-08-27T20:00:10Z"),
    fetchImpl,
  };
  const first = loadResilientPublicProjection(options);
  const second = loadResilientPublicProjection(options);
  await Promise.resolve();
  releaseOrigin();
  const results = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(results.every((result) => result.available === true), true);
  assert.equal(results.every((result) => result.delivery.transport.state === "origin_current"), true);
});

test("a current cached projection rescues a transient origin failure without promoting an embedded snapshot", async () => {
  resetPublicProjectionTransportForTests();
  const cache = memoryCache();
  await loadResilientPublicProjection({
    env: ENV,
    key: "brief",
    cache,
    nowMs: Date.parse("2026-08-27T20:00:10Z"),
    fetchImpl: async () => response(envelope()),
  });
  const result = await loadResilientPublicProjection({
    env: ENV,
    key: "brief",
    fallbackPayload: envelope("2026-08-27T19:30:00Z"),
    cache,
    nowMs: Date.parse("2026-08-27T20:00:50Z"),
    fetchImpl: async () => response({ ok: false }, 503),
  });
  assert.equal(result.available, true);
  assert.equal(result.delivery.source, "current_public_origin");
  assert.equal(result.delivery.fallback, false);
  assert.equal(result.delivery.transport.state, "edge_cache_rescue");
  assert.equal(result.delivery.transport.origin_failure_reason, "origin_http_503");
  assert.equal(result.delivery.transport.historical_snapshot_substituted, false);
});

test("expired cached projections remain unavailable when the origin fails", async () => {
  resetPublicProjectionTransportForTests();
  const cache = memoryCache();
  await loadResilientPublicProjection({
    env: ENV,
    key: "brief",
    cache,
    nowMs: Date.parse("2026-08-27T20:00:10Z"),
    fetchImpl: async () => response(envelope()),
  });
  const result = await loadResilientPublicProjection({
    env: ENV,
    key: "brief",
    cache,
    nowMs: Date.parse("2026-08-27T21:01:00Z"),
    fetchImpl: async () => response({ ok: false }, 503),
  });
  assert.equal(result.available, false);
  assert.equal(result.delivery.source, "unavailable");
  assert.equal(result.delivery.transport.state, "origin_unavailable");
});

test("malformed cache entries are ignored and never expose the protected origin token", async () => {
  resetPublicProjectionTransportForTests();
  const cache = memoryCache();
  const bad = response({ ...envelope(), safe_public: false });
  bad.headers.set("cache-control", "public, max-age=21600");
  bad.headers.set("x-ravenos-cache-stored-at", "2026-08-27T20:00:00Z");
  await cache.put(new Request("https://projection-cache.ravenos.invalid/1/brief.json"), bad);
  let calls = 0;
  const result = await loadResilientPublicProjection({
    env: ENV,
    key: "brief",
    cache,
    nowMs: Date.parse("2026-08-27T20:00:10Z"),
    fetchImpl: async () => {
      calls += 1;
      return response(envelope());
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.available, true);
  assert.equal(JSON.stringify([...cache.rows.values()]).includes("transport-test-token"), false);
});
