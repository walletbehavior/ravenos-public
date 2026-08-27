import assert from "node:assert/strict";
import test from "node:test";

import worker from "../worker.mjs";
import { atlasUniverseTimeoutMs, loadPublicAtlasUniverse } from "../lib/ravenos_public_origin.mjs";

const ORIGIN = "https://origin.example/public/ravenos";
const TOKEN = "server-only-atlas-universe-token";
const REDACTION = "atlas_public_metadata_and_rights_admitted_observations_only";

function nowIso() {
  return new Date().toISOString();
}

function boundary(overrides = {}) {
  return {
    account_available: false,
    broker_connection_available: false,
    order_preview_available: false,
    position_available: false,
    signing_available: false,
    submission_available: false,
    execution_available: false,
    ...overrides,
  };
}

function base(schema, overrides = {}) {
  return {
    ok: true,
    safe_public: true,
    redaction_policy: REDACTION,
    schema_version: schema,
    generated_at: nowIso(),
    execution_boundary: boundary(),
    ...overrides,
  };
}

function row(overrides = {}) {
  return {
    schema_version: "atlas_search_result_v1",
    entity_id: "etf:us:SPY",
    name: "SPDR S&P 500 ETF Trust",
    symbol: "SPY",
    entity_kind: "etf",
    entity_class: "proxy",
    provider: "tradier",
    data_frequency: "market session",
    status: "LIVE",
    optionable: true,
    cached_snapshot_available: false,
    public_display_eligibility: "allowed",
    description: "SPDR S&P 500 ETF Trust",
    featured: true,
    selectable: true,
    refusal_reason: null,
    ...overrides,
  };
}

function policy(decision = "restricted") {
  return {
    decision,
    raw_redistribution_allowed: false,
    cache_allowed: true,
    max_cache_seconds: 60,
    delay_requirement_seconds: 0,
    attribution_required: true,
    attribution_text: "Market data provided by Tradier",
    decision_source: "verified fixture",
    last_reviewed: "2026-07-22",
    reason: decision === "allowed" ? "" : "public_redistribution_not_authorized",
  };
}

function eiaView(data) {
  return {
    state: "available",
    provider: "eia",
    provider_timestamp: nowIso(),
    fetched_at: nowIso(),
    delay_class: "periodic",
    delayed: true,
    degraded: false,
    stale: false,
    cache_hit: false,
    display_policy: {
      ...policy("allowed"),
      raw_redistribution_allowed: true,
      max_cache_seconds: 3600,
      attribution_text: "Source: U.S. Energy Information Administration (EIA)",
    },
    attribution: "Source: U.S. Energy Information Administration (EIA)",
    refusal_reasons: [],
    data,
  };
}

function lease(overrides = {}) {
  return {
    schema_version: "atlas_interest_lease_v1",
    lease_id: "a".repeat(40),
    entity_id: "etf:us:SPY",
    data_product: "snapshot",
    interest_source: "active_page",
    priority: 70,
    requested_cadence: 15,
    created_at: nowIso(),
    renewed_at: nowIso(),
    expires_at: nowIso(),
    persistent: false,
    reason: "entity_detail_open",
    ...overrides,
  };
}

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json", ...headers } });
}

function env() {
  return {
    RAVENOS_PUBLIC_ORIGIN_URL: ORIGIN,
    RAVENOS_PUBLIC_ORIGIN_TOKEN: TOKEN,
  };
}

test("Atlas on-demand hydration has a bounded budget distinct from search", () => {
  assert.equal(atlasUniverseTimeoutMs(env(), "search"), 3_000);
  assert.equal(atlasUniverseTimeoutMs(env(), "featured"), 3_000);
  assert.equal(atlasUniverseTimeoutMs(env(), "history"), 8_000);
  assert.equal(atlasUniverseTimeoutMs(env(), "options_chain"), 8_000);
  assert.equal(atlasUniverseTimeoutMs({ ...env(), RAVENOS_PUBLIC_ORIGIN_ATLAS_TIMEOUT_MS: "6500" }, "history"), 6_500);
});

function searchPayload(overrides = {}) {
  return base("atlas_search_result_v1", {
    query: "spy",
    results: [row()],
    groups: { "Stocks & ETFs": [row()] },
    local_first: true,
    provider_assisted: false,
    assisted_provider: null,
    provider_refusal: null,
    quote_fetch_triggered: false,
    observer_created: false,
    elapsed_ms: 2,
    ...overrides,
  });
}

function entityPayload(overrides = {}) {
  return base("atlas_entity_detail_v1", {
    entity: row(),
    canonical_entity: { provider_ids: { tradier: "SPY" }, internal_field_removed_by_worker: true },
    snapshot: {
      state: "display_restricted",
      provider: "tradier",
      provider_timestamp: nowIso(),
      fetched_at: nowIso(),
      delay_class: "current",
      delayed: false,
      degraded: false,
      stale: false,
      cache_hit: false,
      display_policy: policy("restricted"),
      attribution: "Market data provided by Tradier",
      refusal_reasons: ["public_redistribution_not_authorized"],
      data: null,
    },
    lease: lease(),
    searchable: true,
    hydrated: true,
    featured: true,
    active: true,
    watched: false,
    alerted: false,
    deep_observed: false,
    ...overrides,
  });
}

test("Atlas search is fetched from protected origin without quote hydration", async () => {
  let observed;
  const result = await loadPublicAtlasUniverse({
    env: env(),
    endpoint: "search",
    query: "SPY",
    fetchImpl: async (url, init) => {
      observed = { url, init };
      return jsonResponse(searchPayload());
    },
  });
  assert.equal(observed.url, `${ORIGIN}/atlas/search.json?q=SPY&limit=20`);
  assert.equal(observed.init.headers["x-ravenos-public-token"], TOKEN);
  assert.equal(result.available, true);
  assert.equal(result.payload.results[0].entity_id, "etf:us:SPY");
  assert.equal(result.payload.quote_fetch_triggered, false);
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
});

test("Atlas search rejects a quote smuggled into autocomplete", async () => {
  const malformed = searchPayload({ results: [row({ price: 123.45 })] });
  const result = await loadPublicAtlasUniverse({ env: env(), endpoint: "search", query: "SPY", fetchImpl: async () => jsonResponse(malformed) });
  assert.equal(result.available, false);
  assert.equal(result.delivery.reason, "atlas_contract_rejected");
});

test("Atlas detail strips canonical provider internals and keeps restricted data null", async () => {
  const result = await loadPublicAtlasUniverse({
    env: env(), endpoint: "entity", entityId: "etf:us:SPY", viewerToken: "viewer-token-123456",
    fetchImpl: async (url, init) => {
      assert.equal(url, `${ORIGIN}/atlas/entity.json?entity_id=etf%3Aus%3ASPY`);
      assert.equal(init.headers["x-ravenos-atlas-viewer"], "viewer-token-123456");
      return jsonResponse(entityPayload());
    },
  });
  assert.equal(result.available, true);
  assert.equal(result.payload.snapshot.state, "display_restricted");
  assert.equal(result.payload.snapshot.data, null);
  assert.equal("canonical_entity" in result.payload, false);
  assert.equal("user_or_session_hash" in result.payload.lease, false);
});

test("Atlas detail fails closed if restricted provider values are present", async () => {
  const malformed = entityPayload();
  malformed.snapshot.data = { last: 123.45 };
  const result = await loadPublicAtlasUniverse({ env: env(), endpoint: "entity", entityId: "etf:us:SPY", fetchImpl: async () => jsonResponse(malformed) });
  assert.equal(result.available, false);
  assert.equal(result.payload, null);
});

test("Worker hard-blocks Tradier observations even if the origin marks them allowed", async () => {
  const mistaken = entityPayload();
  mistaken.snapshot.state = "available";
  mistaken.snapshot.display_policy = policy("allowed");
  mistaken.snapshot.data = { last: 123.45 };
  const result = await loadPublicAtlasUniverse({ env: env(), endpoint: "entity", entityId: "etf:us:SPY", fetchImpl: async () => jsonResponse(mistaken) });
  assert.equal(result.available, true);
  assert.equal(result.payload.snapshot.state, "display_restricted");
  assert.equal(result.payload.snapshot.display_policy.decision, "restricted");
  assert.equal(result.payload.snapshot.data, null);
  assert.ok(result.payload.snapshot.refusal_reasons.includes("tradier_partner_public_display_rights_not_configured"));
});

test("Atlas detail fails closed if execution or signing becomes available", async () => {
  const malformed = entityPayload({ execution_boundary: boundary({ submission_available: true }) });
  const result = await loadPublicAtlasUniverse({ env: env(), endpoint: "entity", entityId: "etf:us:SPY", fetchImpl: async () => jsonResponse(malformed) });
  assert.equal(result.available, false);
});

test("Atlas detail rejects private paths, provider payloads, and oversized responses", async () => {
  for (const malformed of [
    entityPayload({ private_path: "/srv/raven/app/data/private.json" }),
    entityPayload({ provider_payload: { raw: true } }),
  ]) {
    const result = await loadPublicAtlasUniverse({ env: env(), endpoint: "entity", entityId: "etf:us:SPY", fetchImpl: async () => jsonResponse(malformed) });
    assert.equal(result.available, false);
  }
  const oversized = await loadPublicAtlasUniverse({
    env: env(), endpoint: "entity", entityId: "etf:us:SPY",
    fetchImpl: async () => jsonResponse(entityPayload(), 200, { "content-length": String(513 * 1024) }),
  });
  assert.equal(oversized.available, false);
  assert.equal(oversized.delivery.reason, "origin_payload_too_large");
});

test("Featured Atlas snapshots require the same canonical entity and an exact listing identity", async () => {
  const validSnapshot = {
    schema_version: "atlas_market_snapshot_v1",
    atlas_entity_id: "etf:us:SPY",
    instrument_id: "etf:nyse-arca:spy",
    identity_scope: "exact_instrument",
    symbol: "SPY",
    last: 640.25,
    change: null,
    change_percent: 1.2,
    market_state: "open",
    provider: "Tradier",
    provider_timestamp: nowIso(),
    delay_class: "current",
    stale: false,
  };
  const payload = base("atlas_featured_state_v1", {
    state: "available",
    sections: [{ section_id: "major_etfs", label: "Major ETFs", entities: [{ ...row(), snapshot: validSnapshot }] }],
    catalog_only_entities_do_not_refresh: true,
    featured_refresh: "bounded_existing_atlas_cycle",
    public_projection_generated_at: nowIso(),
  });
  const blocked = await loadPublicAtlasUniverse({ env: env(), endpoint: "featured", fetchImpl: async () => jsonResponse(payload) });
  assert.equal(blocked.available, true);
  assert.equal(blocked.payload.sections[0].entities[0].snapshot, null);
  assert.equal(blocked.payload.sections[0].entities[0].observation_display_eligibility, "restricted");

  const qualified = structuredClone(payload);
  qualified.sections[0].entities[0].provider = "Qualified Test Provider";
  qualified.sections[0].entities[0].snapshot.provider = "Qualified Test Provider";
  qualified.sections[0].entities[0].snapshot.display_policy = {
    ...policy("allowed"),
    raw_redistribution_allowed: true,
  };
  const admitted = await loadPublicAtlasUniverse({ env: env(), endpoint: "featured", fetchImpl: async () => jsonResponse(qualified) });
  assert.equal(admitted.available, true);
  assert.equal(admitted.payload.sections[0].entities[0].snapshot.last, 640.25);

  const restricted = structuredClone(payload);
  restricted.sections[0].entities[0].observation_display_eligibility = "restricted";
  restricted.sections[0].entities[0].refusal_reason = "public_redistribution_not_authorized";
  const redacted = await loadPublicAtlasUniverse({ env: env(), endpoint: "featured", fetchImpl: async () => jsonResponse(restricted) });
  assert.equal(redacted.available, true);
  assert.equal(redacted.payload.sections[0].entities[0].snapshot, null);

  const wrongProvider = structuredClone(payload);
  wrongProvider.sections[0].entities[0].snapshot.provider = "Massive";
  const providerRefused = await loadPublicAtlasUniverse({ env: env(), endpoint: "featured", fetchImpl: async () => jsonResponse(wrongProvider) });
  assert.equal(providerRefused.available, true);
  assert.equal(providerRefused.payload.sections[0].entities[0].snapshot, null);

  const mismatched = structuredClone(payload);
  mismatched.sections[0].entities[0].snapshot.atlas_entity_id = "equity:us:SPY";
  const rejected = await loadPublicAtlasUniverse({ env: env(), endpoint: "featured", fetchImpl: async () => jsonResponse(mismatched) });
  assert.equal(rejected.available, false);
});

test("Worker exposes Atlas local-first search and never returns the origin token", async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init = {}) => {
      assert.equal(String(url), `${ORIGIN}/atlas/search.json?q=SPY&limit=20`);
      assert.equal(init.headers["x-ravenos-public-token"], TOKEN);
      return jsonResponse(searchPayload());
    };
    const response = await worker.fetch(new Request("https://ravenos.xyz/api/atlas/search?q=SPY"), env());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-ravenos-data-source"), "current_public_origin");
    const body = await response.json();
    assert.equal(body.results[0].entity_id, "etf:us:SPY");
    assert.equal(body.delivery.fallback, false);
    assert.equal(JSON.stringify(body).includes(TOKEN), false);
  } finally {
    globalThis.fetch = previous;
  }
});

test("Worker resolves common rate-market aliases through one exact Atlas series", async () => {
  const previous = globalThis.fetch;
  const rate = row({ entity_id: "fred:DGS10", symbol: "DGS10", name: "10-Year Treasury Yield", entity_kind: "rate_series", entity_class: "reference_series", provider: "fred", optionable: false });
  try {
    globalThis.fetch = async (url, init = {}) => {
      assert.equal(String(url), `${ORIGIN}/atlas/search.json?q=DGS10&limit=20`);
      assert.equal(init.headers["x-ravenos-public-token"], TOKEN);
      return jsonResponse(searchPayload({ query: "DGS10", results: [rate], groups: { Rates: [rate] } }));
    };
    const response = await worker.fetch(new Request("https://ravenos.xyz/api/atlas/search?q=US10Y"), env());
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.query, "US10Y");
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].entity_id, "fred:DGS10");
    assert.equal(body.delivery.fallback, false);
  } finally {
    globalThis.fetch = previous;
  }
});

test("Worker returns 503 without stale or embedded Atlas substitution", async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async () => jsonResponse({ ok: false }, 503);
    const response = await worker.fetch(new Request("https://ravenos.xyz/api/atlas/search?q=SPY"), env());
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error, "atlas_universe_unavailable");
    assert.equal(body.data, null);
    assert.equal(body.historical_context_substituted, false);
  } finally {
    globalThis.fetch = previous;
  }
});

test("Options chain contract accepts only the selected expiration and no coherence observer", async () => {
  const payload = base("atlas_options_chain_v1", {
    entity_id: "etf:us:SPY",
    expiration: "2026-07-24",
    chain: {
      state: "display_restricted", provider: "tradier", provider_timestamp: nowIso(), fetched_at: nowIso(),
      delay_class: "current", delayed: false, degraded: false, stale: false, cache_hit: false,
      display_policy: policy("restricted"), attribution: "Market data provided by Tradier",
      refusal_reasons: ["public_redistribution_not_authorized"], data: null,
    },
    lease: lease({ data_product: "options_chain", data_variant: "2026-07-24" }),
    selected_expiration_only: true,
    coherence_observer_active: false,
  });
  const result = await loadPublicAtlasUniverse({ env: env(), endpoint: "options_chain", entityId: "etf:us:SPY", expiration: "2026-07-24", fetchImpl: async () => jsonResponse(payload) });
  assert.equal(result.available, true);
  assert.equal(result.payload.chain.data, null);
  assert.equal(result.payload.lease.data_variant, "2026-07-24");
  assert.equal(result.payload.selected_expiration_only, true);
});

test("SEC filing responses use an explicit metadata allowlist", async () => {
  const filing = {
    schema_version: "atlas_sec_filing_event_v1",
    event_id: "sec_filing:0000320193-26-000001",
    cik: "CIK0000320193",
    canonical_entity_id: "sec:CIK0000320193",
    issuer_name: "Apple Inc.",
    ticker: "AAPL",
    accession_number: "0000320193-26-000001",
    form: "4",
    filed_at: "2026-07-20",
    accepted_at: "2026-07-20T18:30:00Z",
    reporting_period: "2026-07-18",
    primary_document: "xslF345X06/form4.xml",
    primary_document_description: "FORM 4",
    amendment: false,
    amended_accession: null,
    filing_url: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/xslF345X06/form4.xml",
    ownership_xml_url: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/form4.xml",
    source: "SEC EDGAR",
    freshness: "document",
    parser_status: "metadata_only",
    public_display_allowed: true,
    refusal_reasons: [],
    future_internal_score: 999,
  };
  const payload = base("atlas_sec_filings_v1", {
    entity_id: "equity:us:AAPL",
    filings: { ...eiaView([filing]), provider: "sec", delay_class: "document", delayed: false },
    metadata_is_not_a_filing_summary: true,
  });
  const result = await loadPublicAtlasUniverse({ env: env(), endpoint: "sec_filings", entityId: "equity:us:AAPL", fetchImpl: async () => jsonResponse(payload) });
  assert.equal(result.available, true);
  assert.equal(result.payload.filings.data[0].accession_number, filing.accession_number);
  assert.equal("future_internal_score" in result.payload.filings.data[0], false);
  const wrongOrigin = structuredClone(payload);
  wrongOrigin.filings.data[0].filing_url = "https://example.com/form4.xml";
  const rejected = await loadPublicAtlasUniverse({ env: env(), endpoint: "sec_filings", entityId: "equity:us:AAPL", fetchImpl: async () => jsonResponse(wrongOrigin) });
  assert.equal(rejected.available, false);
});

test("Form 4 responses preserve the normalized decision fields and strip unknown parser output", async () => {
  const event = {
    schema_version: "atlas_insider_event_v1", event_id: "atlas_insider:abc123", issuer: "Apple Inc.",
    issuer_cik: "CIK0000320193", canonical_entity_id: "sec:CIK0000320193", ticker: "AAPL",
    filing_accession: "0000320193-26-000001", filed_at: "2026-07-20", accepted_at: "2026-07-20T18:30:00Z",
    transaction_at: "2026-07-18", reporting_owner: "Example Owner", owner_cik: "CIK0000000002",
    relationship: { officer: true, director: false, ten_percent_owner: false, other: false, officer_title: "Chief Example Officer", other_text: null },
    table_kind: "non_derivative", security_title: "Common Stock", underlying_security_title: null,
    transaction_code: "P", transaction_class: "open_market_purchase", acquired_or_disposed: "A", side: "buy",
    shares: 100, price: 200, gross_transaction_value: 20000, post_transaction_holdings: 1000,
    direct_or_indirect_ownership: "D", nature_of_indirect_ownership: null, conversion_or_exercise_price: null,
    derivative_expiration: null, rule_10b5_1: false, footnotes: [{ id: "F1", text: "Public filing footnote" }],
    amendment: false, original_document: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/form4.xml",
    parser_confidence: "high", refusal_or_ambiguity_reasons: [], public_display_allowed: true,
    source: "SEC EDGAR ownership XML", fetched_at: nowIso(), future_private_family: "do-not-ship",
  };
  const payload = base("atlas_sec_insiders_v1", { entity_id: "equity:us:AAPL", events: [event], filings_considered: 1, parse_failures: [], market_enrichment_active: false, options_enrichment_active: false, misconduct_inference_emitted: false });
  const result = await loadPublicAtlasUniverse({ env: env(), endpoint: "sec_insiders", entityId: "equity:us:AAPL", fetchImpl: async () => jsonResponse(payload) });
  assert.equal(result.available, true);
  assert.equal(result.payload.events[0].relationship.officer_title, "Chief Example Officer");
  assert.equal(result.payload.events[0].rule_10b5_1, false);
  assert.equal("future_private_family" in result.payload.events[0], false);
});

test("EIA dataset history exposes bounded metadata without observations", async () => {
  const payload = base("atlas_history_v1", {
    entity_id: "eia:petroleum.pri.spt",
    entity_class: "reference_series",
    state: "facet_selection_required",
    observations: [],
    refusal_reasons: [],
    dataset: {
      facets: [{ id: "series", name: "Published series" }, { id: "product", name: "Product" }],
      frequencies: [{ id: "daily", description: "Daily" }],
      data_fields: ["value"],
    },
  });
  const result = await loadPublicAtlasUniverse({
    env: env(), endpoint: "history", entityId: "eia:petroleum.pri.spt",
    fetchImpl: async (url) => {
      assert.equal(String(url), `${ORIGIN}/atlas/history.json?entity_id=eia%3Apetroleum.pri.spt&limit=20`);
      return jsonResponse(payload);
    },
  });
  assert.equal(result.available, true);
  assert.equal(result.payload.state, "facet_selection_required");
  assert.deepEqual(result.payload.observations, []);
  assert.equal(result.payload.dataset.facets[0].id, "series");
});

test("EIA facet and exact-series contracts remain separate and periodic", async () => {
  const facetsPayload = base("atlas_eia_facets_v1", {
    entity_id: "eia:petroleum.pri.spt",
    facet_id: "series",
    facets: eiaView({ route: "petroleum/pri/spt", facet_id: "series", values: [{ id: "RWTC", name: "WTI spot price" }], total: 1, truncated: false }),
    observations_fetched: false,
  });
  const facets = await loadPublicAtlasUniverse({
    env: env(), endpoint: "eia_facets", entityId: "eia:petroleum.pri.spt", facetId: "series",
    fetchImpl: async (url) => {
      assert.equal(String(url), `${ORIGIN}/atlas/eia/facets.json?entity_id=eia%3Apetroleum.pri.spt&facet_id=series`);
      return jsonResponse(facetsPayload);
    },
  });
  assert.equal(facets.available, true);
  assert.equal(facets.payload.observations_fetched, false);
  assert.equal(facets.payload.facets.data.values[0].id, "RWTC");

  const seriesPayload = base("atlas_eia_materialized_series_v1", {
    entity_id: "eia:petroleum.pri.spt",
    concrete_series_id: "eia:petroleum.pri.spt:1234567890abcdef",
    selection: { frequency: "daily", data_field: "value", facets: { series: "RWTC" } },
    selection_exact: true,
    series: eiaView({
      route: "petroleum/pri/spt", frequency: "daily", data_field: "value", facets: { series: "RWTC" },
      observations: [{ period: "2026-07-20", value: 70, unit: "dollars per barrel" }, { period: "2026-07-21", value: 71, unit: "dollars per barrel" }],
      total: 2, selection_exact: true,
    }),
  });
  const series = await loadPublicAtlasUniverse({
    env: env(), endpoint: "eia_series", entityId: "eia:petroleum.pri.spt", facetId: "series", facetValue: "RWTC", frequency: "daily", dataField: "value",
    fetchImpl: async (url) => {
      assert.equal(String(url), `${ORIGIN}/atlas/eia/series.json?entity_id=eia%3Apetroleum.pri.spt&facet_id=series&facet_value=RWTC&frequency=daily&data_field=value`);
      return jsonResponse(seriesPayload);
    },
  });
  assert.equal(series.available, true);
  assert.equal(series.payload.selection_exact, true);
  assert.equal(series.payload.series.delay_class, "periodic");
  assert.equal(JSON.stringify(series).includes(TOKEN), false);
});

test("Worker rejects an altered EIA exact-series selection", async () => {
  const malformed = base("atlas_eia_materialized_series_v1", {
    entity_id: "eia:petroleum.pri.spt",
    concrete_series_id: "eia:petroleum.pri.spt:1234567890abcdef",
    selection: { frequency: "daily", data_field: "value", facets: { series: "RBRTE" } },
    selection_exact: true,
    series: eiaView({ route: "petroleum/pri/spt", frequency: "daily", data_field: "value", facets: { series: "RBRTE" }, observations: [], total: 0, selection_exact: true }),
  });
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async () => jsonResponse(malformed);
    const response = await worker.fetch(new Request("https://ravenos.xyz/api/atlas/eia/series?entity_id=eia%3Apetroleum.pri.spt&facet_id=series&facet_value=RWTC&frequency=daily&data_field=value"), env());
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error, "atlas_universe_unavailable");
    assert.equal(body.historical_context_substituted, false);
  } finally {
    globalThis.fetch = previous;
  }
});
