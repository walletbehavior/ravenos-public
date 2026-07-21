import assert from "node:assert/strict";
import test from "node:test";

import {
  attachDelivery,
  loadOriginControlDocument,
  loadPublicProjection,
  projectionFreshness,
  projectionHeaders,
  sanitizeOriginControlDocument,
} from "../lib/ravenos_public_origin.mjs";

const NOW = Date.parse("2026-07-21T10:00:00Z");
const ENV = {
  RAVENOS_PUBLIC_ORIGIN_URL: "https://origin.example/public/ravenos",
  RAVENOS_PUBLIC_ORIGIN_TOKEN: "test-token",
};

function envelope(overrides = {}) {
  return {
    ok: true,
    safe_public: true,
    key: "brief",
    schema_version: "ravenos_brief_public_origin_v1",
    generated_at: "2026-07-21T09:59:30Z",
    updated_at: "2026-07-21T09:59:45Z",
    freshness_target_seconds: 900,
    redaction_policy: "aggregate_public_market_context_only",
    data: { one_sentence_read: "Current evidence remains constructive." },
    ...overrides,
  };
}

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status || 200,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  });
}

test("loads a valid current public projection through the protected origin", async () => {
  let observed;
  const result = await loadPublicProjection({
    env: ENV,
    key: "brief",
    nowMs: NOW,
    fetchImpl: async (url, init) => {
      observed = { url, init };
      return jsonResponse(envelope());
    },
  });
  assert.equal(observed.url, "https://origin.example/public/ravenos/brief.json");
  assert.equal(observed.init.headers["x-ravenos-public-token"], "test-token");
  assert.equal(result.available, true);
  assert.equal(result.delivery.source, "current_public_origin");
  assert.equal(result.delivery.freshness_state, "fresh");
  assert.equal(result.delivery.fallback, false);
  assert.deepEqual(projectionHeaders(result.delivery), {
    "x-ravenos-data-source": "current_public_origin",
    "x-ravenos-freshness": "fresh",
  });
  assert.equal(attachDelivery(result.payload, result.delivery).delivery.key, "brief");
});

test("preserves a stale origin payload and labels its source timestamp honestly", async () => {
  const result = await loadPublicProjection({
    env: ENV,
    key: "brief",
    nowMs: NOW,
    fetchImpl: async () => jsonResponse(envelope({ generated_at: "2026-06-24T10:00:00Z" })),
  });
  assert.equal(result.delivery.source, "current_public_origin");
  assert.equal(result.delivery.freshness_state, "stale");
  assert.equal(result.delivery.fallback, false);
});

test("fails closed to an explicitly labeled embedded snapshot on contract mismatch", async () => {
  const fallbackPayload = envelope({ generated_at: "2026-07-12T00:00:00Z" });
  const result = await loadPublicProjection({
    env: ENV,
    key: "brief",
    fallbackPayload,
    nowMs: NOW,
    fetchImpl: async () => jsonResponse(envelope({ safe_public: false })),
  });
  assert.equal(result.available, true);
  assert.equal(result.delivery.source, "embedded_snapshot");
  assert.equal(result.delivery.freshness_state, "stale");
  assert.equal(result.delivery.fallback, true);
  assert.equal(result.delivery.reason, "origin_public_safety_mismatch");
});

test("reports unavailable when neither the origin nor a fallback is usable", async () => {
  const result = await loadPublicProjection({
    env: {},
    key: "brief",
    nowMs: NOW,
    fetchImpl: async () => {
      throw new Error("should not be called");
    },
  });
  assert.equal(result.available, false);
  assert.equal(result.delivery.source, "unavailable");
  assert.equal(result.delivery.freshness_state, "unavailable");
  assert.equal(result.delivery.reason, "origin_token_not_configured");
});

test("rejects oversized origin responses before parsing", async () => {
  const fallbackPayload = envelope({ generated_at: "2026-07-12T00:00:00Z" });
  const result = await loadPublicProjection({
    env: ENV,
    key: "brief",
    fallbackPayload,
    nowMs: NOW,
    fetchImpl: async () => jsonResponse(envelope(), { headers: { "content-length": String(600 * 1024) } }),
  });
  assert.equal(result.delivery.source, "embedded_snapshot");
  assert.equal(result.delivery.reason, "origin_payload_too_large");
});

test("cancels an oversized streamed origin response", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(513 * 1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  const result = await loadPublicProjection({
    env: ENV,
    key: "brief",
    fallbackPayload: envelope({ generated_at: "2026-07-12T00:00:00Z" }),
    nowMs: NOW,
    fetchImpl: async () => new Response(body, {
      headers: { "content-type": "application/json" },
    }),
  });
  assert.equal(result.delivery.source, "embedded_snapshot");
  assert.equal(result.delivery.reason, "origin_payload_too_large");
  assert.equal(cancelled, true);
});

test("freshness is derived from source generation time, not republish time", () => {
  const freshness = projectionFreshness({
    generated_at: "2026-06-24T10:00:00Z",
    updated_at: "2026-07-21T09:59:59Z",
    freshness_target_seconds: 900,
  }, { nowMs: NOW });
  assert.equal(freshness.state, "stale");
  assert.ok(freshness.age_seconds > 2_000_000);
});

test("control documents are schema checked and stripped of filesystem paths", async () => {
  const manifest = {
    schema_version: "ravenos_public_origin_manifest_v1",
    generated_at: "2026-07-21T09:59:59Z",
    safe_public: true,
    redaction_policy: "aggregate_public_market_context_only",
    endpoints: [{
      key: "brief",
      endpoint: "/api/brief",
      schema_version: "ravenos_brief_public_origin_v1",
      generated_at: "2026-07-21T09:59:30Z",
      payload_age_seconds: 30,
      freshness_target_seconds: 900,
      status: "published",
      source: "/srv/raven/app/private/data.json",
      target: "/srv/raven/app/data/public/brief.json",
    }],
    failed: [],
  };
  const result = await loadOriginControlDocument({
    env: ENV,
    key: "manifest",
    fetchImpl: async () => jsonResponse(manifest),
  });
  assert.equal(result.ok, true);
  const sanitized = sanitizeOriginControlDocument("manifest", result.payload);
  assert.equal(sanitized.endpoints[0].key, "brief");
  assert.equal("source" in sanitized.endpoints[0], false);
  assert.equal(JSON.stringify(sanitized).includes("/srv/"), false);
});
