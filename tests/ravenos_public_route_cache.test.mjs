import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  __testing,
  readPublicRouteResponseCache,
  resetPublicRouteResponseCacheForTests,
  storePublicRouteResponseCache,
} from "../lib/ravenos_public_route_cache.mjs";

const ENV = Object.freeze({
  RAVENOS_RELEASE_ID: "ravenos-a2e49c2-hotfix",
  RAVENOS_PUBLIC_ROUTE_RESPONSE_CACHE_ENABLED: "1",
});
const NOW = Date.parse("2026-09-01T02:30:00Z");

function memoryCache() {
  const rows = new Map();
  return {
    rows,
    async match(request) {
      return rows.get(request.url)?.clone() || null;
    },
    async put(request, response) {
      rows.set(request.url, response.clone());
    },
  };
}

function response(status = 200) {
  return new Response(JSON.stringify({ ok: status === 200, marker: "public-safe" }), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-ravenos-release-id": ENV.RAVENOS_RELEASE_ID,
      "x-content-type-options": "nosniff",
    },
  });
}

test("only anonymous queryless public GETs are cache eligible", () => {
  const eligible = new Request("https://ravenos.xyz/api/health");
  assert.ok(__testing.cacheDescriptor(eligible, ENV));
  assert.equal(__testing.cacheDescriptor(eligible, { RAVENOS_RELEASE_ID: ENV.RAVENOS_RELEASE_ID }), null);
  assert.equal(__testing.cacheDescriptor(new Request("https://ravenos.xyz/api/opportunity?instrument=SOL"), ENV), null);
  assert.equal(__testing.cacheDescriptor(new Request("https://ravenos.xyz/api/health", { method: "POST" }), ENV), null);
  assert.equal(__testing.cacheDescriptor(new Request("https://ravenos.xyz/api/status"), ENV), null);
  assert.equal(__testing.cacheDescriptor(new Request("https://ravenos.xyz/api/health", {
    headers: { authorization: "Bearer test" },
  }), ENV), null);
  assert.equal(__testing.cacheDescriptor(new Request("https://ravenos.xyz/api/health", {
    headers: { cookie: "session=test" },
  }), ENV), null);
});

test("a successful response is reused without parsing and keeps client headers", async () => {
  resetPublicRouteResponseCacheForTests();
  const cache = memoryCache();
  const waits = [];
  const request = new Request("https://ravenos.xyz/api/health");
  const original = response();
  const returned = storePublicRouteResponseCache({
    request,
    env: ENV,
    response: original,
    cache,
    nowMs: NOW,
    executionContext: { waitUntil: (work) => waits.push(work) },
  });
  assert.equal(returned, original);
  await Promise.all(waits);
  const hit = await readPublicRouteResponseCache({ request, env: ENV, cache, nowMs: NOW + 5_000 });
  assert.equal(hit.status, 200);
  assert.deepEqual(await hit.json(), { ok: true, marker: "public-safe" });
  assert.equal(hit.headers.get("cache-control"), "no-store");
  assert.equal(hit.headers.get("x-ravenos-release-id"), ENV.RAVENOS_RELEASE_ID);
  assert.equal(hit.headers.get("x-content-type-options"), "nosniff");
  assert.equal(hit.headers.get("x-ravenos-response-cache"), "isolate_hit");
  assert.equal(hit.headers.has("x-ravenos-response-cache-stored-at"), false);
});

test("another isolate can reuse the shared edge response", async () => {
  resetPublicRouteResponseCacheForTests();
  const cache = memoryCache();
  const waits = [];
  const request = new Request("https://ravenos.xyz/api/opportunity");
  storePublicRouteResponseCache({
    request,
    env: ENV,
    response: response(),
    cache,
    nowMs: NOW,
    executionContext: { waitUntil: (work) => waits.push(work) },
  });
  await Promise.all(waits);
  resetPublicRouteResponseCacheForTests();
  const hit = await readPublicRouteResponseCache({ request, env: ENV, cache, nowMs: NOW + 10_000 });
  assert.equal(hit.status, 200);
  assert.equal(hit.headers.get("x-ravenos-response-cache"), "edge_hit");
  assert.equal(hit.headers.get("cache-control"), "no-store");
});

test("expired and unsuccessful responses are never reused", async () => {
  resetPublicRouteResponseCacheForTests();
  const cache = memoryCache();
  const waits = [];
  const request = new Request("https://ravenos.xyz/api/health");
  storePublicRouteResponseCache({
    request,
    env: ENV,
    response: response(),
    cache,
    nowMs: NOW,
    executionContext: { waitUntil: (work) => waits.push(work) },
  });
  await Promise.all(waits);
  resetPublicRouteResponseCacheForTests();
  assert.equal(await readPublicRouteResponseCache({ request, env: ENV, cache, nowMs: NOW + 31_000 }), null);

  const failedCache = memoryCache();
  storePublicRouteResponseCache({ request, env: ENV, response: response(503), cache: failedCache, nowMs: NOW });
  assert.equal(failedCache.rows.size, 0);
  assert.equal(await readPublicRouteResponseCache({ request, env: ENV, cache: failedCache, nowMs: NOW }), null);
});

test("cache identity is scoped by hostname and immutable release", () => {
  const request = new Request("https://ravenos.xyz/api/health");
  const base = __testing.cacheDescriptor(request, ENV).key.url;
  const nextRelease = __testing.cacheDescriptor(request, {
    ...ENV,
    RAVENOS_RELEASE_ID: "next",
  }).key.url;
  const appHost = __testing.cacheDescriptor(new Request("https://app.ravenos.xyz/api/health"), ENV).key.url;
  assert.notEqual(base, nextRelease);
  assert.notEqual(base, appHost);
});

test("immutable release packaging carries the explicit activation flag", () => {
  const source = readFileSync(new URL("../scripts/package-release.mjs", import.meta.url), "utf8");
  assert.match(source, /RAVENOS_PUBLIC_ROUTE_RESPONSE_CACHE_ENABLED:\s*baseWrangler\.vars\?\.RAVENOS_PUBLIC_ROUTE_RESPONSE_CACHE_ENABLED/);
});
