import { test, expect } from "@playwright/test";

const NOW = "2026-07-22T18:00:00Z";
const REDACTION = "atlas_public_metadata_and_rights_admitted_observations_only";

function boundary() {
  return {
    account_available: false,
    broker_connection_available: false,
    order_preview_available: false,
    position_available: false,
    signing_available: false,
    submission_available: false,
    execution_available: false,
  };
}

function base(schema, values = {}) {
  return { ok: true, safe_public: true, redaction_policy: REDACTION, schema_version: schema, generated_at: NOW, execution_boundary: boundary(), ...values };
}

function searchRow(values = {}) {
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
    ...values,
  };
}

function displayPolicy(decision = "restricted") {
  return {
    decision,
    raw_redistribution_allowed: decision === "allowed",
    cache_allowed: true,
    max_cache_seconds: 900,
    delay_requirement_seconds: 0,
    attribution_required: true,
    attribution_text: decision === "allowed" ? "Source: U.S. Securities and Exchange Commission EDGAR" : "Market data provided by Tradier",
    decision_source: "verified browser fixture",
    last_reviewed: "2026-07-22",
    reason: decision === "allowed" ? "" : "public_redistribution_not_authorized",
  };
}

function providerView({ provider = "tradier", decision = "restricted", data = null, delayClass = "current" } = {}) {
  return {
    state: decision === "allowed" ? "available" : "display_restricted",
    provider,
    provider_timestamp: NOW,
    fetched_at: NOW,
    delay_class: delayClass,
    delayed: delayClass !== "current" && delayClass !== "document",
    degraded: false,
    stale: false,
    cache_hit: false,
    display_policy: displayPolicy(decision),
    attribution: displayPolicy(decision).attribution_text,
    refusal_reasons: decision === "allowed" ? [] : ["public_redistribution_not_authorized"],
    data: decision === "allowed" ? data : null,
  };
}

function lease(product = "snapshot") {
  return {
    schema_version: "atlas_interest_lease_v1",
    lease_id: "a".repeat(40),
    entity_id: "etf:us:SPY",
    data_product: product,
    interest_source: "active_page",
    priority: 70,
    requested_cadence: 15,
    created_at: NOW,
    renewed_at: NOW,
    expires_at: "2026-07-22T18:01:30Z",
    persistent: false,
    reason: "entity_detail_open",
  };
}

function legacyAtlas() {
  return {
    ok: true,
    schema_version: "ravenos.atlas_projection.v1",
    generated_at: NOW,
    state: "available",
    freshness: { state: "fresh", age_seconds: 10, target_seconds: 1800 },
    posture: { state: "risk selective", confidence: "moderate", alignment: "mixed" },
    market_context: { risk_regime: "mixed", equity_regime: "constructive", sector_breadth: "broad", participation_quality: "healthy", rows: [] },
    capabilities: { market_map: true, options_summary: true },
    execution_boundary: { research_only: true, broker_connection_available: false, signing_available: false, submission_available: false },
    delivery: { source: "current_public_origin", freshness_state: "fresh", fallback: false },
  };
}

async function mockAtlas(page, { restricted = true } = {}) {
  const calls = [];
  const spy = searchRow();
  const msft = searchRow({ entity_id: "equity:us:MSFT", name: "Microsoft Corporation", symbol: "MSFT", entity_kind: "equity", entity_class: "tradable_quote", featured: false });
  const fred = searchRow({ entity_id: "fred:DGS10", name: "Market Yield on U.S. Treasury Securities at 10-Year Constant Maturity", symbol: "DGS10", entity_kind: "rate_series", entity_class: "reference_series", provider: "fred", data_frequency: "Daily", status: "PERIODIC", optionable: false, public_display_eligibility: "allowed", featured: true });
  const eia = searchRow({ entity_id: "eia:petroleum.pri.spt", name: "Petroleum spot prices", symbol: "PETROLEUM/PRI/SPT", entity_kind: "energy_series", entity_class: "reference_series", provider: "eia", data_frequency: "Daily, weekly", status: "PERIODIC", optionable: false, public_display_eligibility: "allowed", featured: false });
  await page.route("**/api/atlas", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(legacyAtlas()) }));
  await page.route("**/api/atlas/**", async (route) => {
    const url = new URL(route.request().url());
    calls.push(url.pathname + url.search);
    let payload;
    if (url.pathname === "/api/atlas/featured") {
      payload = base("atlas_featured_state_v1", { state: "available", sections: [{ section_id: "major_etfs", label: "Major ETFs", entities: [{ ...spy, snapshot: null }] }, { section_id: "rates", label: "Rates", entities: [{ ...fred, snapshot: null }] }], catalog_only_entities_do_not_refresh: true, featured_refresh: "bounded_existing_atlas_cycle", public_projection_generated_at: NOW });
    } else if (url.pathname === "/api/atlas/search") {
      const q = url.searchParams.get("q")?.toLowerCase();
      const rows = q?.includes("dgs") || q?.includes("yield") ? [fred] : q?.includes("wti") || q?.includes("petroleum") ? [eia] : q?.includes("msft") || q?.includes("microsoft") ? [msft] : [spy];
      const group = rows[0].entity_kind === "rate_series" ? "Rates" : rows[0].entity_kind === "energy_series" ? "Energy" : "Stocks & ETFs";
      payload = base("atlas_search_result_v1", { query: q, results: rows, groups: { [group]: rows }, local_first: true, provider_assisted: false, assisted_provider: null, provider_refusal: null, quote_fetch_triggered: false, observer_created: false, elapsed_ms: 1 });
    } else if (url.pathname === "/api/atlas/entity") {
      const isFred = url.searchParams.get("entity_id") === fred.entity_id;
      const isEia = url.searchParams.get("entity_id") === eia.entity_id;
      const isMsft = url.searchParams.get("entity_id") === msft.entity_id;
      payload = base("atlas_entity_detail_v1", {
        entity: isFred ? fred : isEia ? eia : isMsft ? msft : spy,
        snapshot: isFred
          ? { ...providerView({ provider: "fred", decision: "allowed", delayClass: "periodic", data: { series_id: "DGS10", observations: [{ period: "2026-07-20", value: 4.31 }, { period: "2026-07-21", value: 4.28 }] } }), schema_version: "atlas_series_snapshot_v1", latest: { period: "2026-07-21", value: 4.28 }, previous: { period: "2026-07-20", value: 4.31 } }
          : isEia
            ? { ...providerView({ provider: "eia", decision: "allowed", delayClass: "periodic", data: { dataset: true, route: "petroleum/pri/spt", facets: [{ id: "series", name: "Published series" }, { id: "product", name: "Product" }], frequencies: [{ id: "daily", description: "Daily" }], data_fields: ["value"], requires_facet_selection: true, observations: [] } }), schema_version: "atlas_series_snapshot_v1", latest: null, previous: null }
          : providerView({ decision: restricted ? "restricted" : "allowed", data: { symbol: "SPY", last: 640.25, high: 642, low: 637, open: 638, volume: 71_000_000, change: 2.1, change_percent: .33 } }),
        lease: isFred || isEia ? { ...lease(), entity_id: isFred ? fred.entity_id : eia.entity_id, requested_cadence: 300 } : lease(),
        searchable: true,
        hydrated: true,
        featured: true,
        active: true,
        watched: false,
        alerted: false,
        deep_observed: false,
      });
    } else if (url.pathname === "/api/atlas/history") {
      if (url.searchParams.get("entity_id") === eia.entity_id) {
        payload = base("atlas_history_v1", { entity_id: eia.entity_id, entity_class: "reference_series", state: "facet_selection_required", observations: [], refusal_reasons: [], dataset: { facets: [{ id: "series", name: "Published series" }, { id: "product", name: "Product" }], frequencies: [{ id: "daily", description: "Daily" }], data_fields: ["value"] } });
      } else {
        payload = base("atlas_history_v1", { entity_id: fred.entity_id, entity_class: "reference_series", history: providerView({ provider: "fred", decision: "allowed", delayClass: "periodic", data: { series_id: "DGS10", observations: Array.from({ length: 40 }, (_, index) => ({ period: `2026-06-${String(index + 1).padStart(2, "0")}`.replace("2026-06-31", "2026-07-01").replace("2026-06-32", "2026-07-02").replace("2026-06-33", "2026-07-03").replace("2026-06-34", "2026-07-04").replace("2026-06-35", "2026-07-05").replace("2026-06-36", "2026-07-06").replace("2026-06-37", "2026-07-07").replace("2026-06-38", "2026-07-08").replace("2026-06-39", "2026-07-09").replace("2026-06-40", "2026-07-10"), value: 4 + index * .01 })) } }) });
      }
    } else if (url.pathname === "/api/atlas/eia/facets") {
      payload = base("atlas_eia_facets_v1", { entity_id: eia.entity_id, facet_id: "series", facets: providerView({ provider: "eia", decision: "allowed", delayClass: "periodic", data: { route: "petroleum/pri/spt", facet_id: "series", values: [{ id: "RWTC", name: "WTI spot price" }], total: 1, truncated: false } }), observations_fetched: false });
    } else if (url.pathname === "/api/atlas/eia/series") {
      payload = base("atlas_eia_materialized_series_v1", { entity_id: eia.entity_id, concrete_series_id: `${eia.entity_id}:1234567890abcdef`, selection: { frequency: "daily", data_field: "value", facets: { series: "RWTC" } }, selection_exact: true, series: providerView({ provider: "eia", decision: "allowed", delayClass: "periodic", data: { route: "petroleum/pri/spt", frequency: "daily", data_field: "value", facets: { series: "RWTC" }, observations: Array.from({ length: 40 }, (_, index) => ({ period: `2026-06-${String(index + 1).padStart(2, "0")}`.replace("2026-06-31", "2026-07-01").replace("2026-06-32", "2026-07-02").replace("2026-06-33", "2026-07-03").replace("2026-06-34", "2026-07-04").replace("2026-06-35", "2026-07-05").replace("2026-06-36", "2026-07-06").replace("2026-06-37", "2026-07-07").replace("2026-06-38", "2026-07-08").replace("2026-06-39", "2026-07-09").replace("2026-06-40", "2026-07-10"), value: 70 + index * .1, unit: "dollars per barrel" })), total: 40, selection_exact: true } }) });
    } else if (url.pathname === "/api/atlas/options/expirations") {
      payload = base("atlas_options_expirations_v1", { entity_id: spy.entity_id, options: providerView({ decision: restricted ? "restricted" : "allowed", data: { symbol: "SPY", expirations: ["2026-07-24", "2026-07-31"] } }), lease: lease("options_expirations"), full_chain_fetched: false });
    } else if (url.pathname === "/api/atlas/options/chain") {
      payload = base("atlas_options_chain_v1", { entity_id: spy.entity_id, expiration: url.searchParams.get("expiration"), chain: providerView({ decision: "allowed", data: { symbol: "SPY", expiration: url.searchParams.get("expiration"), contracts: [{ symbol: "SPY260724C00640000", expiration: "2026-07-24", strike: 640, right: "call", bid: 4.1, ask: 4.2, last: 4.15, volume: 1200, open_interest: 10000, iv: .21, delta: .52, quote_timestamp: NOW, greeks_clock: "hourly" }] } }), lease: lease("options_chain"), selected_expiration_only: true, coherence_observer_active: false });
    } else if (url.pathname === "/api/atlas/sec/filings") {
      payload = base("atlas_sec_filings_v1", { entity_id: spy.entity_id, filings: providerView({ provider: "sec", decision: "allowed", delayClass: "document", data: [{ event_id: "filing-1", issuer_name: "SPDR S&P 500 ETF Trust", form: "10-K", filed_at: NOW, reporting_period: "2025-12-31", amendment: false, filing_url: "https://www.sec.gov/Archives/edgar/data/1/fixture.htm" }] }), metadata_is_not_a_filing_summary: true });
    } else if (url.pathname === "/api/atlas/sec/insiders") {
      payload = base("atlas_sec_insiders_v1", { entity_id: spy.entity_id, events: [{
        schema_version: "atlas_insider_event_v1", event_id: "insider-1", issuer: "SPDR S&P 500 ETF Trust",
        issuer_cik: "CIK0000000001", ticker: "SPY", filing_accession: "0000000001-26-000001",
        filed_at: NOW, accepted_at: NOW, transaction_at: "2026-07-21", reporting_owner: "Example Reporting Owner",
        owner_cik: "CIK0000000002", relationship: { officer: true, director: false, ten_percent_owner: false, other: false, officer_title: "Chief Example Officer", other_text: null },
        table_kind: "non_derivative", security_title: "Units", transaction_code: "P", transaction_class: "open_market_purchase",
        acquired_or_disposed: "A", side: "buy", shares: 100, price: 500, gross_transaction_value: 50000,
        post_transaction_holdings: 1000, direct_or_indirect_ownership: "D", nature_of_indirect_ownership: null,
        rule_10b5_1: false, footnotes: [], amendment: false,
        original_document: "https://www.sec.gov/Archives/edgar/data/1/form4.xml", parser_confidence: "high",
        refusal_or_ambiguity_reasons: [], public_display_allowed: true, source: "SEC EDGAR ownership XML",
      }], filings_considered: 1, parse_failures: [], market_enrichment_active: false, options_enrichment_active: false, misconduct_inference_emitted: false });
    } else {
      return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  await page.route("**/api/instruments/search**", (route) => {
    const query = new URL(route.request().url()).searchParams.get("q")?.toUpperCase() || "SPY";
    const msftMatch = query === "MSFT";
    const row = msftMatch
      ? { schema_version: "ravenos.instrument.v1", instrument_id: "equity:nasdaq:msft", symbol: "MSFT", asset_class: "equity", instrument_type: "equity", identity_scope: "exact_instrument", venue: "nasdaq", chain: "none", market_identity: { market_id: "MSFT", listing: "Nasdaq" }, quote_asset: { symbol: "USD" }, settlement_asset: { symbol: "USD" }, capabilities: { execution: false, quote_preview: false } }
      : { schema_version: "ravenos.instrument.v1", instrument_id: "etf:nyse-arca:spy", symbol: "SPY", asset_class: "etf", instrument_type: "etf", identity_scope: "exact_instrument", venue: "nyse-arca", chain: "none", market_identity: { market_id: "SPY", listing: "NYSE Arca" }, quote_asset: { symbol: "USD" }, settlement_asset: { symbol: "USD" }, capabilities: { execution: false, quote_preview: false } };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, schema_version: "ravenos.instrument_lookup.v1", query, delivery: { source: "current_public_origin", freshness_state: "fresh", fallback: false }, execution_boundary: { broker_connection_available: false, quote_preview_available: false, signing_available: false, submission_available: false }, results: [row] }) });
  });
  return calls;
}

test("Atlas search is the front door and selecting metadata hydrates only one exact entity", async ({ page }) => {
  const calls = await mockAtlas(page);
  await page.goto("/atlas/");
  await expect(page.locator(".atlas-pulse-row")).toHaveCount(1);
  await page.locator("#atlasSearchInput").fill("SPY");
  await expect(page.locator(".atlas-search-row")).toHaveCount(1);
  expect(calls.some((call) => call.startsWith("/api/atlas/entity"))).toBe(false);
  expect(calls.some((call) => call.includes("options"))).toBe(false);
  await page.locator(".atlas-search-row").click();
  await expect(page).toHaveURL(/entity_id=etf%3Aus%3ASPY/);
  await expect(page.locator(".atlas-detail-identity")).toContainText("SPDR S&P 500 ETF Trust");
  await expect(page.locator(".atlas-decision-note")).toContainText("Why values are not shown");
  const frame = page.locator(".atlas-tv-frame");
  await expect(frame).toHaveAttribute("src", /^https:\/\/www\.tradingview-widget\.com\/embed-widget\/advanced-chart\//);
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox");
  await expect(page.locator(".atlas-compute-state")).toHaveCount(0);
  await expect(page.locator("#atlasOpenTerminal")).toHaveAttribute("href", /instrument_id=etf%3Anyse-arca%3Aspy/);
  expect(calls.filter((call) => call.startsWith("/api/atlas/entity")).length).toBe(1);
  expect(calls.some((call) => call.includes("options"))).toBe(false);
});

test("Atlas gives an arbitrary equity a chart only after one exact listing resolves", async ({ page }) => {
  await mockAtlas(page);
  await page.goto("/atlas/");
  await page.locator("#atlasSearchInput").fill("MSFT");
  await expect(page.locator(".atlas-search-row")).toHaveCount(1);
  await page.locator(".atlas-search-row").click();
  await expect(page).toHaveURL(/entity_id=equity%3Aus%3AMSFT/);
  await expect(page.locator(".atlas-detail-identity")).toContainText("Microsoft Corporation");
  await expect(page.locator(".atlas-detail-identity")).toContainText("NASDAQ · MSFT");
  await expect(page.locator(".atlas-tv-frame")).toHaveAttribute("src", /NASDAQ%3AMSFT/);
});

test("Options remain lazy and a restricted expiration response never triggers a chain", async ({ page }) => {
  const calls = await mockAtlas(page, { restricted: true });
  await page.goto("/atlas/?entity_id=etf%3Aus%3ASPY");
  expect(calls.some((call) => call.includes("options"))).toBe(false);
  await page.getByRole("tab", { name: "Options" }).click();
  await expect(page.locator(".atlas-decision-note")).toContainText("provider permits RavenOS to resolve this market");
  expect(calls.filter((call) => call.startsWith("/api/atlas/options/expirations")).length).toBe(1);
  expect(calls.some((call) => call.startsWith("/api/atlas/options/chain"))).toBe(false);
});

test("When display is admitted, Options fetches only the selected expiration", async ({ page }) => {
  const calls = await mockAtlas(page, { restricted: false });
  await page.goto("/atlas/?entity_id=etf%3Aus%3ASPY");
  await page.getByRole("tab", { name: "Options" }).click();
  await expect(page.locator(".atlas-options-table tbody tr")).toHaveCount(1);
  expect(calls.filter((call) => call.startsWith("/api/atlas/options/chain")).length).toBe(1);
  expect(calls.find((call) => call.startsWith("/api/atlas/options/chain"))).toContain("expiration=2026-07-24");
  await expect(page.locator(".atlas-options-note")).toContainText("Greeks update hourly");
});

test("Periodic series history loads only on demand and renders a real chart", async ({ page }) => {
  const calls = await mockAtlas(page);
  await page.goto("/atlas/?entity_id=fred%3ADGS10");
  expect(calls.some((call) => call.startsWith("/api/atlas/history"))).toBe(false);
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.locator(".atlas-history-chart canvas").first()).toBeVisible();
  await expect(page.locator(".raven-series-chart-inspector")).toContainText("Latest");
  await expect(page.locator(".raven-series-chart-inspector")).toContainText("Value");
  await expect(page.locator(".raven-series-chart-inspector")).toContainText("Change");
  const chartBox = await page.locator(".raven-series-chart-stage").boundingBox();
  expect(chartBox).not.toBeNull();
  await page.mouse.move(chartBox.x + chartBox.width * .45, chartBox.y + chartBox.height * .5);
  await expect(page.locator(".raven-series-chart-inspector")).toHaveAttribute("data-mode", "inspect");
  expect(calls.filter((call) => call.startsWith("/api/atlas/history")).length).toBe(1);
  await expect(page.locator(".atlas-provider-state")).toContainText("FRED");
});

test("EIA observations wait for an exact facet selection", async ({ page }) => {
  const calls = await mockAtlas(page);
  await page.goto("/atlas/?entity_id=eia%3Apetroleum.pri.spt");
  expect(calls.some((call) => call.startsWith("/api/atlas/eia/"))).toBe(false);
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByLabel("Published series")).toBeEnabled();
  expect(calls.filter((call) => call.startsWith("/api/atlas/eia/facets")).length).toBe(1);
  expect(calls.some((call) => call.startsWith("/api/atlas/eia/series"))).toBe(false);
  await page.getByLabel("Published series").selectOption("RWTC");
  await page.getByRole("button", { name: "Load exact series" }).click();
  await expect(page.locator(".atlas-eia-output .atlas-history-chart canvas").first()).toBeVisible();
  await expect(page.locator(".atlas-eia-output")).toContainText("PERIODIC");
  expect(calls.filter((call) => call.startsWith("/api/atlas/eia/series")).length).toBe(1);
  expect(calls.find((call) => call.startsWith("/api/atlas/eia/series"))).toContain("facet_value=RWTC");
});

test("SEC filing drilldown preserves source links and never presents metadata as a summary", async ({ page }) => {
  await mockAtlas(page);
  await page.goto("/atlas/?entity_id=etf%3Aus%3ASPY");
  await page.getByRole("tab", { name: "Filings" }).click();
  await expect(page.locator(".atlas-options-note")).toContainText("has not generated a filing summary");
  await expect(page.getByRole("link", { name: /Open SEC filing/ })).toHaveAttribute("href", /^https:\/\/www\.sec\.gov\/Archives\//);
  await expect(page.getByRole("button", { name: /buy|sell|sign|submit|execute/i })).toHaveCount(0);
});

test("Form 4 drilldown consumes the normalized contract and keeps both clocks visible", async ({ page }) => {
  await mockAtlas(page);
  await page.goto("/atlas/?entity_id=etf%3Aus%3ASPY");
  await page.getByRole("tab", { name: "Insiders" }).click();
  const row = page.locator(".atlas-insider-row").first();
  await expect(row).toContainText("Chief Example Officer");
  await expect(row).toContainText("Open Market Purchase");
  await expect(row).toContainText("Transaction");
  await expect(row).toContainText("Filed");
  await expect(row).toContainText("10b5-1 not indicated");
  await expect(row.getByRole("link", { name: /Open original Form 4/ })).toHaveAttribute("href", /^https:\/\/www\.sec\.gov\/Archives\//);
});

test("Atlas remains contained and decision-readable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAtlas(page);
  await page.goto("/atlas/");
  await expect(page.locator("#atlasSearchInput")).toBeVisible();
  await page.locator(".atlas-pulse-row").first().click();
  await expect(page.locator(".atlas-detail-identity")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});
