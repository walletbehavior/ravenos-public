import assert from "node:assert/strict";
import test from "node:test";

import worker from "../worker.mjs";
import {
  ATLAS_FREE_SOURCE_REGISTRY_SCHEMA,
  buildAtlasFreeSourceRegistry,
} from "../lib/atlas_free_sources.mjs";
import { atlasObservationDecision } from "../lib/atlas_display_rights.mjs";

test("free-source registry separates ready, agreement-required, and private-only lanes", () => {
  const registry = buildAtlasFreeSourceRegistry();
  assert.equal(registry.schema_version, ATLAS_FREE_SOURCE_REGISTRY_SCHEMA);
  assert.equal(registry.safe_public, true);

  const byId = Object.fromEntries(registry.sources.map((source) => [source.source_id, source]));
  assert.equal(byId.sec_edgar.activation_state, "connected_via_atlas_origin");
  assert.equal(byId.sec_edgar.data_fee_usd_monthly, 0);
  assert.equal(byId.openfigi_v3.public_display_posture, "figi_identifiers_public_domain_and_commercially_redistributable");
  assert.equal(byId.ecb_reference_fx.public_display_posture, "commercial_reuse_allowed_with_source_attribution");
  assert.equal(byId.iex_hist.activation_state, "ready_for_private_ingestion_pipeline");
  assert.match(byId.iex_hist.attribution, /Data provided for free by IEX/);
  assert.equal(byId.iex_tops_delayed.activation_state, "agreement_and_connectivity_required");
  assert.equal(byId.iex_tops_delayed.data_fee_usd_monthly, 0);
  assert.equal(byId.options_broker_overlay.activation_state, "authenticated_user_overlay_only");
  assert.equal(byId.options_broker_overlay.public_display_posture, "not_for_anonymous_public_redistribution");
  assert.equal(registry.blocked_products.some((row) => row.product_id === "anonymous_delayed_options_quotes"), true);
});

test("source registry returns independent public projections", () => {
  const first = buildAtlasFreeSourceRegistry();
  first.sources[0].products.push("mutation");
  const second = buildAtlasFreeSourceRegistry();
  assert.equal(second.sources[0].products.includes("mutation"), false);
});

test("FRED ICE BofA series stay blocked even with a mistaken allowed policy", () => {
  const decision = atlasObservationDecision("FRED", {
    decision: "allowed",
    raw_redistribution_allowed: true,
    decision_source: "mistaken blanket FRED policy",
    last_reviewed: "2026-08-26",
  }, { entityId: "fred:BAMLH0A0HYM2" });
  assert.equal(decision.decision, "internal_only");
  assert.equal(decision.reason, "ice_bofa_fred_series_preapproval_not_configured");
});

test("free-source registry is exposed as a cacheable public Atlas control-plane route", async () => {
  const response = await worker.fetch(new Request("https://ravenos.xyz/api/atlas/sources"), {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, max-age=3600, stale-while-revalidate=86400");
  const body = await response.json();
  assert.equal(body.schema_version, ATLAS_FREE_SOURCE_REGISTRY_SCHEMA);
  assert.equal(body.guardrails.anonymous_options_quotes_require_opra_vendor_rights, true);
  assert.equal(JSON.stringify(body).includes("api_key="), false);
});
