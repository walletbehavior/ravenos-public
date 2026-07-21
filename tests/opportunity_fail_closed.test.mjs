import assert from "node:assert/strict";
import test from "node:test";

import worker from "../worker.mjs";

const ORIGIN = "https://origin.example/public/ravenos";
const TOKEN = "server-only-opportunity-test-token";

function isoAgo(seconds) {
  return new Date(Date.now() - seconds * 1_000).toISOString();
}

function opportunityRows() {
  return [
    {
      public_opportunity_id: "rop_sol",
      instrument_id: "hyperliquid:perp:SOL",
      instrument: "SOL-PERP",
      context_state: "fresh",
      research_only: true,
      execution_available: false,
    },
    {
      public_opportunity_id: "rop_btc",
      instrument_id: "hyperliquid:perp:BTC",
      instrument: "BTC-PERP",
      context_state: "fresh",
      research_only: true,
      execution_available: false,
    },
  ];
}

function opportunityEnvelope({
  generatedAt = isoAgo(10),
  rows = opportunityRows(),
  envelope = {},
  data = {},
} = {}) {
  return {
    ok: true,
    safe_public: true,
    key: "opportunities",
    schema_version: "ravenos_opportunity_census_public_origin_v1",
    generated_at: generatedAt,
    updated_at: isoAgo(2),
    freshness_target_seconds: 3_600,
    redaction_policy: "aggregate_public_market_context_only",
    source_artifact: "raven_opportunity_projection",
    data: {
      schema_version: "ravenos_opportunity_census_public_v1",
      generated_at: generatedAt,
      source_state: "current",
      population: { decision_observations: 2, matured_path_windows: 1 },
      opportunities: { rows },
      execution_boundary: {
        research_only: true,
        signing_available: false,
        submission_available: false,
        position_monitoring_available: false,
      },
      ...data,
    },
    ...envelope,
  };
}

function contextEnvelope(key) {
  const schemas = {
    claims: "ravenos_claim_lineage_public_origin_v2",
    outcomes: "ravenos_outcomes_public_origin_v1",
    behavior: "ravenos_behavior_public_origin_v1",
  };
  const data = key === "claims"
    ? { lineage_version: "2.0", current_claims: [], recent_raven_reads: [] }
    : key === "outcomes"
      ? { recent_raven_reads: [] }
      : { rows: [] };
  return {
    ok: true,
    safe_public: true,
    key,
    schema_version: schemas[key],
    generated_at: isoAgo(10),
    updated_at: isoAgo(2),
    freshness_target_seconds: 900,
    redaction_policy: "aggregate_public_market_context_only",
    data,
  };
}

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function assetBinding(assets = {}) {
  return {
    async fetch(request) {
      const path = new URL(request.url).pathname;
      return path in assets ? jsonResponse(assets[path]) : new Response("not found", { status: 404 });
    },
  };
}

function environment() {
  return {
    RAVENOS_PUBLIC_ORIGIN_URL: ORIGIN,
    RAVENOS_PUBLIC_ORIGIN_TOKEN: TOKEN,
    ASSETS: assetBinding({
      "/ravenos/opportunities.json": opportunityEnvelope({ generatedAt: isoAgo(600) }),
    }),
  };
}

function originKey(url) {
  return new URL(url).pathname.split("/").pop().replace(/\.json$/, "");
}

async function withOriginFetch(opportunityHandler, callback) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(init.headers?.["x-ravenos-public-token"], TOKEN);
    const key = originKey(url);
    if (key === "opportunities") return opportunityHandler(url, init);
    if (key in { claims: 1, outcomes: 1, behavior: 1 }) return jsonResponse(contextEnvelope(key));
    return jsonResponse({}, 404);
  };
  try {
    return await callback();
  } finally {
    globalThis.fetch = previousFetch;
  }
}

async function opportunityRequest(path = "/api/opportunity") {
  return worker.fetch(new Request(`https://ravenos.xyz${path}`), environment());
}

async function assertUnavailable(response, expectedReason = null) {
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("x-ravenos-data-source") === "current_public_origin" && response.headers.get("x-ravenos-freshness") === "fresh", false);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.status, "unavailable");
  assert.equal(body.error, "opportunity_census_projection_unavailable");
  assert.equal(body.census, null);
  assert.equal(body.current_opportunity, null);
  assert.equal(body.selected_opportunity, null);
  assert.equal(body.historical_context.current_data_substituted, false);
  assert.equal("legacy_context" in body, false);
  if (expectedReason) assert.equal(body.rejection_reason, expectedReason);
  return body;
}

test("1. current origin available and fresh", async () => {
  await withOriginFetch(
    async () => jsonResponse(opportunityEnvelope()),
    async () => {
      const response = await opportunityRequest();
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-ravenos-data-source"), "current_public_origin");
      assert.equal(response.headers.get("x-ravenos-freshness"), "fresh");
      const body = await response.json();
      assert.equal(body.ok, true);
      assert.equal(body.source_artifact, "raven_opportunity_projection");
      assert.equal(body.delivery.source, "current_public_origin");
      assert.equal(body.delivery.fallback, false);
      assert.equal(body.census.source_state, "current");
      assert.equal(body.generated_at, body.census.generated_at);
    },
  );
});

test("2. origin unavailable", async () => {
  await withOriginFetch(
    async () => { throw new Error("origin unavailable"); },
    async () => assertUnavailable(await opportunityRequest()),
  );
});

test("3. origin returns 404", async () => {
  await withOriginFetch(
    async () => jsonResponse({ ok: false }, 404),
    async () => {
      const body = await assertUnavailable(await opportunityRequest());
      assert.equal(body.delivery.reason, "origin_http_404");
    },
  );
});

test("4. origin returns delayed or stale data", async () => {
  for (const ageSeconds of [3_700, 18_000]) {
    await withOriginFetch(
      async () => jsonResponse(opportunityEnvelope({ generatedAt: isoAgo(ageSeconds) })),
      async () => assertUnavailable(await opportunityRequest()),
    );
  }
});

test("5. origin marks fallback=true", async () => {
  await withOriginFetch(
    async () => jsonResponse(opportunityEnvelope({ envelope: { fallback: true } })),
    async () => assertUnavailable(await opportunityRequest(), "current_opportunity_fallback_rejected"),
  );
});

test("6. origin identifies an embedded snapshot source", async () => {
  await withOriginFetch(
    async () => jsonResponse(opportunityEnvelope({ envelope: { source: "embedded_snapshot" } })),
    async () => assertUnavailable(await opportunityRequest(), "current_opportunity_fallback_rejected"),
  );
});

test("7. malformed opportunity schema", async () => {
  await withOriginFetch(
    async () => jsonResponse(opportunityEnvelope({ envelope: { schema_version: "malformed" } })),
    async () => {
      const body = await assertUnavailable(await opportunityRequest());
      assert.equal(body.delivery.reason, "origin_contract_mismatch");
    },
  );
});

test("8. oversized opportunity response", async () => {
  await withOriginFetch(
    async () => jsonResponse({}, 200, { "content-length": String(2 * 1024 * 1024 + 1) }),
    async () => {
      const body = await assertUnavailable(await opportunityRequest());
      assert.equal(body.delivery.reason, "origin_payload_too_large");
    },
  );
});

test("9. explicitly selected instrument is matched exactly and never replaced", async () => {
  await withOriginFetch(
    async () => jsonResponse(opportunityEnvelope()),
    async () => {
      const selectedResponse = await opportunityRequest("/api/opportunity?instrument_id=hyperliquid%3Aperp%3ABTC&instrument=BTC-PERP");
      assert.equal(selectedResponse.status, 200);
      const selectedBody = await selectedResponse.json();
      assert.equal(selectedBody.selection.state, "matched");
      assert.equal(selectedBody.selection.silently_replaced, false);
      assert.equal(selectedBody.selected_opportunity.instrument_id, "hyperliquid:perp:BTC");
      assert.equal(selectedBody.current_opportunity.instrument_id, "hyperliquid:perp:BTC");

      const absentResponse = await opportunityRequest("/api/opportunity?instrument=ETH-PERP");
      assert.equal(absentResponse.status, 200);
      const absentBody = await absentResponse.json();
      assert.equal(absentBody.selection.state, "not_present");
      assert.equal(absentBody.selection.silently_replaced, false);
      assert.equal(absentBody.selected_opportunity, null);
      assert.equal(absentBody.current_opportunity, null);
    },
  );
});

test("10. origin recovers after failure", async () => {
  let opportunityCalls = 0;
  await withOriginFetch(
    async () => {
      opportunityCalls += 1;
      if (opportunityCalls === 1) throw new Error("transient origin failure");
      return jsonResponse(opportunityEnvelope());
    },
    async () => {
      await assertUnavailable(await opportunityRequest());
      const recovered = await opportunityRequest();
      assert.equal(recovered.status, 200);
      const body = await recovered.json();
      assert.equal(body.delivery.source, "current_public_origin");
      assert.equal(body.delivery.fallback, false);
      assert.equal(body.delivery.freshness_state, "fresh");
      assert.equal(opportunityCalls, 2);
    },
  );
});
