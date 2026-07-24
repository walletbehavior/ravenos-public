import assert from "node:assert/strict";
import test from "node:test";

import worker from "../worker.mjs";

const ORIGIN = "https://origin.example/public/ravenos";
const NOW = Date.now();

function isoAgo(seconds) {
  return new Date(NOW - seconds * 1000).toISOString();
}

function projection(key, schema, data = {}, generatedAt = isoAgo(10), freshnessTargetSeconds = 900) {
  return {
    ok: true,
    safe_public: true,
    key,
    schema_version: schema,
    generated_at: generatedAt,
    updated_at: isoAgo(2),
    freshness_target_seconds: freshnessTargetSeconds,
    redaction_policy: "aggregate_public_market_context_only",
    ...(key === "opportunities" ? { source_artifact: "raven_opportunity_projection" } : {}),
    data: key === "opportunities" ? { generated_at: generatedAt, ...data } : data,
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
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

function environment(assets = {}) {
  return {
    RAVENOS_PUBLIC_ORIGIN_URL: ORIGIN,
    RAVENOS_PUBLIC_ORIGIN_TOKEN: "server-only-test-token",
    ASSETS: assetBinding(assets),
  };
}

test("Worker serves current origin intelligence with explicit delivery provenance", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(init.headers["x-ravenos-public-token"], "server-only-test-token");
    assert.equal(String(url), `${ORIGIN}/brief.json`);
    return jsonResponse(projection(
      "brief",
      "ravenos_brief_public_origin_v1",
      { one_sentence_read: "Current Raven evidence is connected." },
    ));
  };
  try {
    const response = await worker.fetch(new Request("https://ravenos.xyz/api/brief"), environment());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-ravenos-data-source"), "current_public_origin");
    assert.equal(response.headers.get("x-ravenos-freshness"), "fresh");
    assert.equal(response.headers.has("x-ravenos-public-token"), false);
    const body = await response.json();
    assert.equal(body.data.one_sentence_read, "Current Raven evidence is connected.");
    assert.equal(body.delivery.source, "current_public_origin");
    assert.equal(JSON.stringify(body).includes("server-only-test-token"), false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Worker opportunity route is backed by the current Census projection", async () => {
  const projections = {
    opportunities: projection(
      "opportunities",
      "ravenos_opportunity_census_public_origin_v1",
      {
        schema_version: "ravenos_opportunity_census_public_v1",
        source_state: "current",
        population: { decision_observations: 1200, matured_path_windows: 700 },
        opportunities: {
          rows: [{
            public_opportunity_id: "rop_fixture",
            instrument_id: "hyperliquid:perp:SOL",
            instrument: "SOL-PERP",
            context_state: "current",
            research_only: true,
            execution_available: false,
          }],
        },
        spot_attention: {
          schema_version: "ravenos.token_attention.v1",
          generated_at: isoAgo(10),
          state: "current",
          age_seconds: 10,
          row_count: 1,
          rows: [{
            public_attention_id: "rta_fixture",
            instrument_id: "spot_fixture",
            market_type: "spot",
            chain: "Solana",
            venue: "Meteora",
            identity_scope: "exact_pool",
            symbol: "RETIRE",
            name: "Retire",
            token_address: "11111111111111111111111111111111",
            pool_address: "22222222222222222222222222222222",
            observed_at: isoAgo(10),
            movement_state: "Activity accelerating",
            what_changed: "Price rose while volume and independent activity expanded.",
            risk: "Short-window movement still needs follow-through.",
            market: {
              liquidity_usd: 80_000,
              price_change_5m_pct: 8.5,
              price_change_1h_pct: 18,
              price_change_24h_pct: 31,
              buys_5m: 64,
              sells_5m: 26,
              traders_5m: 72,
              buys_1h: 320,
              sells_1h: 130,
              traders_1h: 240,
              buys_24h: 1_280,
              sells_24h: 520,
              traders_24h: 680,
              volume_usd_5m: 14_000,
              volume_usd_1h: 92_000,
              volume_usd_24h: 510_000,
            },
            broader_attention: {
              state: "raven_observed_first",
              raven_observed_first: true,
              lead_seconds: 1_200,
              summary: "Raven recorded this market 20m before broader attention appeared.",
            },
            research_only: true,
            actionable: false,
            execution_available: false,
          }],
          selection: {
            ranked_trade_list: false,
            broader_attention_affects_ranking: false,
          },
          execution_boundary: {
            research_only: true,
            actionable: false,
            signing_available: false,
            submission_available: false,
            capital_assigned: 0,
          },
        },
      },
      isoAgo(10),
      3600,
    ),
    claims: projection("claims", "ravenos_claim_lineage_public_origin_v2", {
      lineage_version: "2.0",
      current_claims: [{ surface: "opportunity", headline: "Older claim context" }],
      recent_raven_reads: [],
    }),
    outcomes: projection("outcomes", "ravenos_outcomes_public_origin_v1", { recent_raven_reads: [] }),
    behavior: projection("behavior", "ravenos_behavior_public_origin_v1", { rows: [] }),
  };
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const key = new URL(url).pathname.split("/").pop().replace(/\.json$/, "");
    return projections[key] ? jsonResponse(projections[key]) : jsonResponse({}, 404);
  };
  try {
    const response = await worker.fetch(new Request("https://ravenos.xyz/api/opportunity"), environment());
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.schema_version, "ravenos.opportunity_workspace.v2");
    assert.equal(body.census.population.decision_observations, 1200);
    assert.equal(body.census.opportunities.rows[0].instrument_id, "hyperliquid:perp:SOL");
    assert.equal(body.census.opportunities.rows[0].execution_available, false);
    assert.equal(body.census.spot_attention.schema_version, "ravenos.token_attention.v1");
    assert.equal(body.census.spot_attention.rows[0].identity_scope, "exact_pool");
    assert.equal(body.census.spot_attention.rows[0].market.traders_24h, 680);
    assert.equal(body.census.spot_attention.rows[0].market.volume_usd_1h, 92_000);
    assert.equal(body.census.spot_attention.rows[0].broader_attention.raven_observed_first, true);
    assert.equal(body.census.spot_attention.selection.broader_attention_affects_ranking, false);
    assert.equal(body.census.spot_attention.execution_boundary.signing_available, false);
    assert.equal(body.census.spot_attention.execution_boundary.submission_available, false);
    assert.equal(body.current_claim_context.headline, "Older claim context");
    assert.equal(body.current_opportunity.instrument_id, "hyperliquid:perp:SOL");
    assert.equal(body.selection.state, "default_current_row");
    assert.equal(body.delivery.source, "current_public_origin");
    assert.equal(body.delivery.fallback, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Worker does not relabel an older claim as a current opportunity when Census is unavailable", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const key = new URL(url).pathname.split("/").pop().replace(/\.json$/, "");
    if (key === "claims") return jsonResponse(projection("claims", "ravenos_claim_lineage_public_origin_v2", {
      current_claims: [{ surface: "opportunity", headline: "Older claim context" }],
    }));
    return jsonResponse({}, 503);
  };
  try {
    const response = await worker.fetch(new Request("https://ravenos.xyz/api/opportunity"), environment());
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error, "opportunity_census_projection_unavailable");
    assert.equal(body.census, null);
    assert.equal(body.current_opportunity, null);
    assert.equal(body.selected_opportunity, null);
    assert.equal("legacy_context" in body, false);
    assert.equal(body.historical_context.current_data_substituted, false);
    assert.equal(body.historical_context.replay_contract, "/api/replay");
    assert.match(body.message, /not substituted as current opportunities/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Worker health measures current product lanes without penalizing archival or retired services", async () => {
  const manifest = {
    schema_version: "ravenos_public_origin_manifest_v1",
    generated_at: isoAgo(2),
    safe_public: true,
    redaction_policy: "aggregate_public_market_context_only",
    endpoints: [
      ...["brief", "replay", "outcomes", "memory", "behavior", "perps", "opportunities", "claims"].map((key) => ({
        key,
        endpoint_path: `/public/ravenos/${key}.json`,
        payload_age_seconds: 10,
        freshness_target_seconds: key === "perps" ? 120 : 900,
      })),
      {
        key: "atlas",
        endpoint_path: "/public/ravenos/atlas.json",
        payload_age_seconds: 10,
        freshness_target_seconds: 900,
      },
      {
        key: "research",
        endpoint_path: "/public/ravenos/research.json",
        payload_age_seconds: 2_300_000,
        freshness_target_seconds: 900,
        source: "/srv/raven/app/private/research.json",
      },
    ],
    failed: [],
  };
  const status = {
    schema_version: "ravenos_public_publish_status_v1",
    generated_at: isoAgo(2),
    endpoints_published: 10,
    endpoints_failed: 0,
    private_leak_guard_passed: true,
    output_dir: "/srv/raven/app/private/path-that-must-not-leak",
    stale_endpoints: ["research"],
    validation_failures: [],
  };
  const terminalHealth = {
    schema_version: "customer_trade_terminal_health_snapshot.v1",
    generated_at: isoAgo(5),
    terminal_availability: "fresh",
    market_data_availability: "fresh",
    quote_availability: "unknown",
    review_availability: "unavailable",
    components: [
      { component: "market_chart_data", state: "fresh", private_path: "/srv/private" },
      { component: "perp_market_context", state: "fresh" },
    ],
    public_warnings: [],
    degraded_reasons: [],
  };
  const byPath = {
    "/public/ravenos/manifest.json": manifest,
    "/public/ravenos/status.json": status,
    "/public/ravenos/terminal_health.json": terminalHealth,
  };
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => jsonResponse(byPath[new URL(url).pathname] || {}, byPath[new URL(url).pathname] ? 200 : 404);
  try {
    const env = environment();
    const response = await worker.fetch(new Request("https://ravenos.xyz/api/health"), env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.status, "ok");
    assert.equal(body.process_health.state, "operational");
    assert.equal(body.process_health.checks.customerAccounts, "not_configured");
    assert.equal(body.process_health.checks.accessApi, "not_configured");
    assert.equal(body.market_data_health.state, "fresh");
    assert.equal(body.intelligence_freshness.state, "fresh");
    assert.equal(body.intelligence_freshness.research.state, "historical");
    assert.equal(body.intelligence_freshness.research.source_freshness_state, "stale");
    assert.equal(body.intelligence_freshness.research.blocking, false);
    assert.equal(body.atlas_health.state, "fresh");
    assert.equal(body.atlas_health.blocking, true);
    assert.equal(body.atlas_health.operational, true);
    assert.equal(body.raven_read_health.state, "fresh");
    assert.equal(body.raven_read_health.mode, "deterministic_structured_projection");
    assert.equal(body.narrator_freshness.state, "not_required");
    assert.equal(body.narrator_freshness.blocking, false);
    assert.equal(body.projection_health.state, "operational");
    assert.equal(body.publisher_health.state, "operational");
    assert.equal(body.publisher_health.blocking, true);
    assert.equal(body.execution_health.state, "disabled");
    assert.equal(body.execution_health.blocking, false);
    assert.equal(body.execution_health.signing_available, false);
    assert.equal(body.execution_health.submission_available, false);
    assert.equal(JSON.stringify(body).includes("/srv/"), false);

    manifest.endpoints.find((row) => row.key === "atlas").payload_age_seconds = 1_900;
    const delayedAtlasResponse = await worker.fetch(new Request("https://ravenos.xyz/api/health"), env);
    const delayedAtlas = await delayedAtlasResponse.json();
    assert.equal(delayedAtlas.status, "ok");
    assert.equal(delayedAtlas.atlas_health.state, "delayed");
    assert.equal(delayedAtlas.atlas_health.operational, true);

    manifest.endpoints.find((row) => row.key === "atlas").payload_age_seconds = 8_000;
    const staleAtlasResponse = await worker.fetch(new Request("https://ravenos.xyz/api/health"), env);
    const staleAtlas = await staleAtlasResponse.json();
    assert.equal(staleAtlas.status, "degraded");
    assert.equal(staleAtlas.atlas_health.state, "stale");
    assert.equal(staleAtlas.atlas_health.operational, false);

    manifest.endpoints.find((row) => row.key === "atlas").payload_age_seconds = 10;
    status.generated_at = isoAgo(5_000);
    const missedPublisherResponse = await worker.fetch(new Request("https://ravenos.xyz/api/health"), env);
    const missedPublisher = await missedPublisherResponse.json();
    assert.equal(missedPublisher.status, "degraded");
    assert.equal(missedPublisher.publisher_health.state, "degraded");
    assert.equal(missedPublisher.publisher_health.blocking, true);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("customer account and billing endpoints fail closed when no authenticated customer system exists", async () => {
  const env = environment();
  const access = await worker.fetch(new Request("https://ravenos.xyz/api/access?wallet=private-wallet-value"), env);
  assert.equal(access.status, 503);
  const accessBody = await access.json();
  assert.equal(accessBody.error, "legacy_customer_access_quarantined");
  assert.equal(accessBody.customer_system.wallet_role, "optional_market_context_only");
  assert.equal(JSON.stringify(accessBody).includes("private-wallet-value"), false);
  assert.equal(JSON.stringify(accessBody).includes("threshold"), false);

  for (const path of ["/api/stripe/checkout", "/api/stripe/portal", "/api/stripe/webhook"]) {
    const response = await worker.fetch(new Request(`https://ravenos.xyz${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }), env);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error, "legacy_billing_quarantined");
  }
});

test("legacy commercial and synthetic token surfaces redirect to truthful current routes", async () => {
  const env = environment();
  for (const [path, target] of [["/pro/", "/pricing/"], ["/upgrade/", "/pricing/"], ["/token/", "/terminal/"]]) {
    const response = await worker.fetch(new Request(`https://ravenos.xyz${path}`), env);
    assert.equal(response.status, 308);
    assert.equal(new URL(response.headers.get("location")).pathname, target);
  }
});
