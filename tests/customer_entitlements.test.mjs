import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CUSTOMER_ENTITLEMENT_ROUTE,
  CUSTOMER_PRO_PARTICIPANTS_ROUTE,
  CUSTOMER_PRO_PERPS_ROUTE,
  CustomerEntitlementContract,
  createD1CustomerEntitlementStore,
  resolveCapabilityAccess,
  resolveCoordinatedIntelligenceSplits,
  resolveEntitlementFeatureFlags,
  routeCustomerEntitlements,
} from "../lib/customer_entitlements.mjs";
import {
  CustomerIntelligenceProjectionContract,
  buildParticipantFreeProjection,
  buildParticipantProProjection,
  buildPerpsFreeProjection,
  buildPerpsProProjection,
} from "../lib/customer_intelligence_projections.mjs";
import worker from "../worker.mjs";

const APP_ORIGIN = "https://app.ravenos.xyz";
const NOW = Math.floor(Date.parse("2026-08-26T20:00:00.000Z") / 1000);
const USER_A = `usr_${"a".repeat(32)}`;
const USER_B = `usr_${"b".repeat(32)}`;
const PERPS_PAYLOAD = JSON.parse(readFileSync("ravenos/perps.json", "utf8"));
const PARTICIPANT_PAYLOAD = JSON.parse(readFileSync("ravenos/behavior.json", "utf8"));
const FRESH_DELIVERY = Object.freeze({
  freshness_state: "fresh",
  source_generated_at: "2026-08-26T19:59:30.000Z",
  age_seconds: 30,
});

function flagsEnv(overrides = {}) {
  return {
    RAVENOS_ENTITLEMENT_RESOLUTION_ENABLE: "1",
    RAVENOS_PRO_INTELLIGENCE_ROUTES_ENABLE: "1",
    RAVENOS_PUBLIC_PROJECTION_SPLIT_ENABLE: "1",
    RAVENOS_PRO_PERPS_ADVANCED_ENABLE: "1",
    RAVENOS_PRO_PARTICIPANT_ADVANCED_ENABLE: "1",
    ...overrides,
  };
}

function grant(capability = "intelligence.perps_advanced", overrides = {}) {
  return {
    grant_id: `ent_${"a".repeat(20)}`,
    user_id: USER_A,
    capability_key: capability,
    state: "active",
    activation_at: NOW - 60,
    expires_at: NOW + 3600,
    revision: 3,
    grant_source: "operator",
    source_reference: "must-not-be-returned",
    ...overrides,
  };
}

function request(path = CUSTOMER_ENTITLEMENT_ROUTE, {
  method = "GET",
  origin = APP_ORIGIN,
  suppliedOrigin = APP_ORIGIN,
  fetchSite = "same-origin",
  referer = `${APP_ORIGIN}/account/`,
  contentLength = null,
} = {}) {
  const headers = new Headers({ accept: "application/json" });
  if (suppliedOrigin !== null) headers.set("origin", suppliedOrigin);
  if (fetchSite !== null) headers.set("sec-fetch-site", fetchSite);
  if (referer !== null) headers.set("referer", referer);
  if (contentLength !== null) headers.set("content-length", String(contentLength));
  return new Request(`${origin}${path}`, { method, headers });
}

function authorized(userId = USER_A) {
  return async () => ({
    principal: Object.freeze({ user_id: userId, session_public_id: "sespub_test", authenticated_at: NOW - 120 }),
    store: Object.freeze({}),
    now: NOW,
    response_headers: new Headers({ "x-ravenos-session": "authenticated" }),
  });
}

function deniedAuthorization(status = 401, error = "authentication_required") {
  return async () => ({ response: new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { "content-type": "application/json" },
  }) });
}

function entitlementStore(rows = []) {
  return Object.freeze({ async listOwnedGrants() { return rows.map((row) => ({ ...row })); } });
}

function routeDeps(rows = [], overrides = {}) {
  return {
    authorizeRequest: authorized(),
    entitlementStore: entitlementStore(rows),
    consumeRateLimit: async () => ({ allowed: true, retry_after_seconds: 0 }),
    async loadProjection(key) {
      return {
        available: true,
        delivery: FRESH_DELIVERY,
        payload: key === "perps" ? PERPS_PAYLOAD : PARTICIPANT_PAYLOAD,
      };
    },
    ...overrides,
  };
}

async function body(response) {
  return JSON.parse(await response.text());
}

test("capability contract is stable, bounded, dormant, and has no commercial mutation surface", () => {
  assert.deepEqual(resolveEntitlementFeatureFlags({}), {
    entitlement_resolution: false,
    authenticated_pro_routes: false,
    public_pro_projection_split: false,
    capability_enablement: {
      "intelligence.perps_advanced": false,
      "intelligence.participant_advanced": false,
      "research.alerts": false,
    },
  });
  assert.deepEqual(resolveCoordinatedIntelligenceSplits({}), { perps: false, participants: false });
  assert.deepEqual(resolveCoordinatedIntelligenceSplits(flagsEnv()), { perps: true, participants: true });
  assert.deepEqual(CustomerEntitlementContract.routes, [
    CUSTOMER_ENTITLEMENT_ROUTE,
    CUSTOMER_PRO_PERPS_ROUTE,
    CUSTOMER_PRO_PARTICIPANTS_ROUTE,
  ]);
  assert.equal(CustomerEntitlementContract.customer_mutation_available, false);
  assert.equal(CustomerEntitlementContract.billing_available, false);
  assert.equal(CustomerEntitlementContract.checkout_available, false);
  assert.equal(CustomerEntitlementContract.entitlement_can_expand_atlas_display_rights, false);
  assert.equal(CustomerEntitlementContract.browser_bearer_tokens, false);
  assert.equal(CustomerEntitlementContract.capabilities["intelligence.perps_advanced"].implementation_state, "implemented_dormant");
  assert.equal(CustomerEntitlementContract.capabilities["intelligence.participant_advanced"].implementation_state, "implemented_dormant");
  assert.equal(CustomerEntitlementContract.capabilities["research.alerts"].implementation_state, "implemented_dormant");
  for (const key of [
    "intelligence.replay_advanced",
    "intelligence.export",
    "research.saved_state_extended",
    "research.saved_scans",
    "atlas.native_breadth",
    "atlas.filing_comparisons",
    "atlas.native_filing_marks",
    "atlas.portfolio_context",
    "atlas.options_intelligence",
    "atlas.authenticated_broker_overlay",
  ]) assert.equal(CustomerEntitlementContract.capabilities[key].implementation_state, "reserved_unavailable", key);
});

test("migration stores only server-owned bounded grants with owner cascade and no prohibited customer data", () => {
  const sql = readFileSync("customer-migrations/0003_customer_entitlements.sql", "utf8");
  assert.match(sql, /REFERENCES ravenos_users\(user_id\) ON DELETE CASCADE/i);
  assert.match(sql, /CHECK \(state IN \('active', 'expired', 'revoked', 'suspended'\)\)/i);
  assert.match(sql, /grant_source TEXT NOT NULL/i);
  assert.match(sql, /grant_source IN \('operator', 'test_fixture', 'migration'\)/i);
  assert(!sql.includes("future_billing"));
  assert.match(sql, /source_reference TEXT NOT NULL/i);
  assert.match(sql, /revision INTEGER NOT NULL DEFAULT 1/i);
  assert(!/payment_credential|provider_credential|private_key|wallet_address|raw_provider_payload|transaction_intent|execution_object|plan_name/i.test(sql));
  assert(!/CREATE\s+(?:TRIGGER|VIEW)/i.test(sql));
});

test("D1 grant reads are owner-scoped, bounded, and exclude private grant provenance", async () => {
  let query = "";
  let bound = [];
  const db = {
    prepare(sql) {
      query = sql;
      return {
        bind(...values) {
          bound = values;
          return { async all() { return { results: [] }; } };
        },
      };
    },
  };
  const rows = await createD1CustomerEntitlementStore(db).listOwnedGrants(USER_A);
  assert.deepEqual(rows, []);
  assert.match(query, /WHERE user_id = \?/i);
  assert.match(query, /LIMIT 64/i);
  assert(!/grant_source|source_reference/.test(query));
  assert.deepEqual(bound, [USER_A]);
  assert.throws(() => createD1CustomerEntitlementStore(null), /unavailable/);
});

test("authorization resolves only a valid owner grant and fails closed across lifecycle and malformed state", () => {
  const flags = resolveEntitlementFeatureFlags(flagsEnv());
  const active = resolveCapabilityAccess({ capability: "intelligence.perps_advanced", user_id: USER_A, grants: [grant()], now: NOW, flags });
  assert.deepEqual(active, { capability: "intelligence.perps_advanced", available: true, state: "active", revision: 3 });
  for (const [state, expected] of [["expired", "expired"], ["revoked", "revoked"], ["suspended", "suspended"]]) {
    const access = resolveCapabilityAccess({ capability: "intelligence.perps_advanced", user_id: USER_A, grants: [grant(undefined, { state })], now: NOW, flags });
    assert.equal(access.available, false);
    assert.equal(access.state, expected);
  }
  assert.equal(resolveCapabilityAccess({ capability: "intelligence.perps_advanced", user_id: USER_A, grants: [grant(undefined, { expires_at: NOW })], now: NOW, flags }).state, "expired");
  assert.equal(resolveCapabilityAccess({ capability: "intelligence.perps_advanced", user_id: USER_A, grants: [grant(undefined, { activation_at: NOW + 1 })], now: NOW, flags }).state, "not_yet_active");
  assert.equal(resolveCapabilityAccess({ capability: "intelligence.perps_advanced", user_id: USER_B, grants: [grant()], now: NOW, flags }).state, "not_granted");
  assert.equal(resolveCapabilityAccess({ capability: "intelligence.perps_advanced", user_id: USER_A, grants: [grant(undefined, { revision: 0 })], now: NOW, flags }).state, "not_granted");
  assert.equal(resolveCapabilityAccess({ capability: "intelligence.perps_advanced", user_id: USER_A, grants: [grant()], now: Number.NaN, flags }).state, "time_unavailable");
  assert.equal(resolveCapabilityAccess({ capability: "unknown.capability", user_id: USER_A, grants: [grant()], now: NOW, flags }).state, "unknown_capability");
});

test("an active customer grant cannot activate reserved Atlas capabilities or override display rights", () => {
  const flags = resolveEntitlementFeatureFlags(flagsEnv());
  for (const capability of Object.keys(CustomerEntitlementContract.capabilities).filter((key) => key.startsWith("atlas."))) {
    const access = resolveCapabilityAccess({ capability, user_id: USER_A, grants: [grant(capability)], now: NOW, flags, atlas_display_decision: { allowed: true } });
    assert.deepEqual(access, { capability, available: false, state: "reserved_unavailable", revision: null });
  }
  assert.equal(CustomerEntitlementContract.entitlement_can_expand_atlas_display_rights, false);
});

test("Perps free and Pro projections are deterministic, bounded, and exclude disallowed intelligence", () => {
  const selected = "hyperliquid:perp:BTC";
  const freeA = buildPerpsFreeProjection(PERPS_PAYLOAD, { delivery: FRESH_DELIVERY, selected_instrument_id: selected });
  const freeB = buildPerpsFreeProjection(PERPS_PAYLOAD, { delivery: FRESH_DELIVERY, selected_instrument_id: selected });
  const pro = buildPerpsProProjection(PERPS_PAYLOAD, { delivery: FRESH_DELIVERY, selected_instrument_id: selected });
  assert.deepEqual(freeA, freeB);
  assert.equal(freeA.access_scope, "free");
  assert.equal(freeA.advanced, null);
  assert(freeA.market_overview.length <= CustomerIntelligenceProjectionContract.free_limits.perps_markets);
  assert.equal(freeA.selected_market.instrument_id, selected);
  assert.equal(freeA.selected_market.market?.instrument_id, selected);
  const exactOutsideRanking = buildPerpsFreeProjection(PERPS_PAYLOAD, {
    delivery: FRESH_DELIVERY,
    selected_instrument_id: "hyperliquid:perp:ZZTEST",
    selected_market: { symbol: "ZZTEST-PERP", funding_rate: 0.0001, open_interest_usd: 12_000, mark_price: 4.2 },
  });
  assert.equal(exactOutsideRanking.selected_market.state, "available");
  assert.equal(exactOutsideRanking.selected_market.market.instrument_id, "hyperliquid:perp:ZZTEST");
  assert.equal(exactOutsideRanking.selected_market.market.funding_rate, 0.0001);
  const contradictorySelected = buildPerpsFreeProjection(PERPS_PAYLOAD, {
    delivery: FRESH_DELIVERY,
    selected_instrument_id: "hyperliquid:perp:OTHER",
    selected_market: { symbol: "ZZTEST-PERP", funding_rate: 0.0001, open_interest_usd: 12_000 },
  });
  assert.equal(contradictorySelected.selected_market.state, "unavailable");
  assert.equal(freeA.limitations.liquidation_data, "unavailable_no_qualified_stream");
  assert.deepEqual(Object.keys(freeA.market_overview[0]).sort(), [...CustomerIntelligenceProjectionContract.free_field_contracts.perps_market].sort());
  assert.equal(Object.hasOwn(freeA.market_overview[0], "spread_bps"), false);
  assert.equal(Object.hasOwn(freeA.market_overview[0], "depth_20_usd"), false);
  assert.equal(Object.hasOwn(freeA.market_overview[0], "pressure_direction"), false);
  assert.equal(pro.access_scope, "pro");
  assert(pro.advanced.positioning.length > 0);
  assert(pro.advanced.pressure_and_crowding.length > 0);
  assert(pro.advanced.liquidity.tightest_books.length > 0);
  assert(pro.advanced.liquidity.wide_or_thin_books.length > 0);
  assert(pro.advanced.positioning.length <= CustomerIntelligenceProjectionContract.pro_limits.perps_table_rows);
  assert.deepEqual(Object.keys(pro.advanced.positioning[0]).sort(), [...CustomerIntelligenceProjectionContract.pro_field_contracts.perps_market].sort());
  assert.equal(pro.provenance.raw_provider_payload_included, false);
  assert.equal(pro.provenance.participant_identity_included, false);
  assert.equal(pro.provenance.execution_data_included, false);
  assert(!Object.hasOwn(pro.advanced, "actor_leaders"));
  assert(!Object.hasOwn(pro.advanced, "liquidations"));
  assert(!Object.hasOwn(pro.advanced, "execution"));
});

test("Participant free and Pro projections retain aggregate denominators while withholding identities", () => {
  const free = buildParticipantFreeProjection(PARTICIPANT_PAYLOAD, { delivery: FRESH_DELIVERY });
  const proA = buildParticipantProProjection(PARTICIPANT_PAYLOAD, { delivery: FRESH_DELIVERY });
  const proB = buildParticipantProProjection(PARTICIPANT_PAYLOAD, { delivery: FRESH_DELIVERY });
  assert.deepEqual(proA, proB);
  assert.equal(free.access_scope, "free");
  assert.equal(free.advanced, null);
  assert(free.participation_overview.length <= CustomerIntelligenceProjectionContract.free_limits.participant_conditions);
  assert(free.participation_overview.every((row) => Number.isSafeInteger(row.observed_sample) && Number.isSafeInteger(row.usable_sample)));
  assert.deepEqual(Object.keys(free.participation_overview[0]).sort(), [...CustomerIntelligenceProjectionContract.free_field_contracts.participant_condition].sort());
  assert.equal(proA.access_scope, "pro");
  assert(proA.advanced.condition_matrix.length > free.participation_overview.length);
  assert(proA.advanced.condition_matrix.length <= CustomerIntelligenceProjectionContract.pro_limits.participant_conditions);
  assert.deepEqual(Object.keys(proA.advanced.condition_matrix[0]).sort(), [...CustomerIntelligenceProjectionContract.pro_field_contracts.participant_condition].sort());
  assert(proA.advanced.condition_matrix.every((row) => row.sample_integrity.observed >= row.sample_integrity.usable));
  assert.equal(proA.limitations.aggregation, "aggregate_conditions_only");
  assert.equal(proA.limitations.wallet_identity, "not_included");
  assert.equal(proA.limitations.smart_money_ranking, "not_included");
  assert.equal(proA.provenance.participant_identity_included, false);
  const participantCopy = JSON.stringify(proA);
  assert(!/jupiter[ _-]+velocity/i.test(participantCopy), "internal participant-lane labels must not reach customers");
  assert.match(participantCopy, /high-velocity token/i);
});

test("projection builders reject unsafe or malformed public inputs rather than widening them", () => {
  assert.throws(() => buildPerpsProProjection({ ...PERPS_PAYLOAD, safe_public: false }, { delivery: FRESH_DELIVERY }), /invalid/);
  assert.throws(() => buildParticipantProProjection({ ...PARTICIPANT_PAYLOAD, data: { ...PARTICIPANT_PAYLOAD.data, metadata: { public_safe: false } } }, { delivery: FRESH_DELIVERY }), /invalid/);
  const malformedNumbers = buildPerpsFreeProjection(PERPS_PAYLOAD, {
    delivery: FRESH_DELIVERY,
    selected_instrument_id: "hyperliquid:perp:POISON",
    selected_market: { symbol: "POISON-PERP", open_interest_usd: true, mark_price: "", spread_bps: -1, depth_20_usd: {} },
  });
  assert.deepEqual({
    open_interest_usd: malformedNumbers.selected_market.market.open_interest_usd,
    mark_price: malformedNumbers.selected_market.market.mark_price,
    spread_bps: malformedNumbers.selected_market.market.spread_bps,
    depth_20_usd: malformedNumbers.selected_market.market.depth_20_usd,
  }, { open_interest_usd: null, mark_price: null, spread_bps: undefined, depth_20_usd: undefined });
});

test("authenticated routes enforce app origin, Fetch Metadata, no parameters, GET-only, and request bounds before authorization", async () => {
  let authCalls = 0;
  const deps = routeDeps([], { authorizeRequest: async () => { authCalls += 1; return authorized()(); } });
  const cases = [
    [request(CUSTOMER_ENTITLEMENT_ROUTE, { origin: "https://ravenos.xyz" }), 404],
    [request(CUSTOMER_ENTITLEMENT_ROUTE, { suppliedOrigin: "https://evil.example", fetchSite: "cross-site" }), 403],
    [request(CUSTOMER_ENTITLEMENT_ROUTE, { suppliedOrigin: null, referer: null }), 403],
    [request(CUSTOMER_ENTITLEMENT_ROUTE, { fetchSite: null }), 403],
    [request(`${CUSTOMER_ENTITLEMENT_ROUTE}?plan=pro&user=${USER_B}&capability=intelligence.perps_advanced`), 400],
    [request(CUSTOMER_ENTITLEMENT_ROUTE, { method: "POST" }), 405],
    [request(CUSTOMER_ENTITLEMENT_ROUTE, { contentLength: 4096 }), 413],
    [request(CUSTOMER_ENTITLEMENT_ROUTE, { contentLength: "malformed" }), 400],
  ];
  for (const [input, expected] of cases) {
    const response = await routeCustomerEntitlements(input, flagsEnv(), deps);
    assert.equal(response.status, expected);
    assert.match(response.headers.get("cache-control") || "", /private.*no-store/i);
  }
  assert.equal(authCalls, 0);
  assert.equal(await routeCustomerEntitlements(request("/api/v1/not-entitlements"), flagsEnv(), deps), null);
});

test("anonymous and unavailable identity responses remain private and non-cacheable", async () => {
  const response = await routeCustomerEntitlements(request(), flagsEnv(), routeDeps([], { authorizeRequest: deniedAuthorization() }));
  assert.equal(response.status, 401);
  assert.match(response.headers.get("cache-control") || "", /private.*no-store/i);
  assert.match(response.headers.get("vary") || "", /Cookie/i);
  assert.match(response.headers.get("vary") || "", /Origin/i);
  assert.equal((await body(response)).error, "authentication_required");
});

test("separate dormant controls prevent a broad flag from enabling entitlement or Pro routes", async () => {
  const deps = routeDeps([grant()]);
  const environments = [
    {},
    { RAVENOS_ENTITLEMENT_RESOLUTION_ENABLE: "1" },
    { RAVENOS_ENTITLEMENT_RESOLUTION_ENABLE: "1", RAVENOS_PRO_INTELLIGENCE_ROUTES_ENABLE: "1" },
    { RAVENOS_ENTITLEMENT_RESOLUTION_ENABLE: "1", RAVENOS_PRO_INTELLIGENCE_ROUTES_ENABLE: "1", RAVENOS_PUBLIC_PROJECTION_SPLIT_ENABLE: "1" },
  ];
  for (const env of environments) {
    const response = await routeCustomerEntitlements(request(CUSTOMER_PRO_PERPS_ROUTE), env, deps);
    assert.equal(response.status, 503);
    assert.notEqual((await body(response)).state, "active");
  }
});

test("capability summary is server-derived, bounded, excludes grant provenance, and keeps reserved products unavailable", async () => {
  const rows = [
    grant("intelligence.perps_advanced"),
    grant("intelligence.participant_advanced", { grant_id: `ent_${"b".repeat(20)}`, revision: 7 }),
    grant("atlas.options_intelligence", { grant_id: `ent_${"c".repeat(20)}` }),
  ];
  const response = await routeCustomerEntitlements(request(), flagsEnv(), routeDeps(rows));
  const payload = await body(response);
  assert.equal(response.status, 200);
  assert.equal(payload.state, "available");
  assert.equal(payload.purchasable, false);
  assert.equal(payload.checkout_available, false);
  assert.equal(payload.customer_mutation_available, false);
  assert.equal(payload.atlas_display_rights_override_available, false);
  assert.equal(payload.capabilities.find((row) => row.capability === "intelligence.perps_advanced").available, true);
  assert.equal(payload.capabilities.find((row) => row.capability === "intelligence.participant_advanced").revision, 7);
  assert.equal(payload.capabilities.find((row) => row.capability === "atlas.options_intelligence").state, "reserved_unavailable");
  const serialized = JSON.stringify(payload);
  assert(!serialized.includes("must-not-be-returned"));
  assert(!serialized.includes("grant_source"));
  assert(!serialized.includes("source_reference"));
  assert(!serialized.includes("ent_aaaaaaaa"));
  assert.match(response.headers.get("cache-control") || "", /private.*no-store/i);
  assert.match(response.headers.get("vary") || "", /Cookie/i);
});

test("authorized advanced routes are owner-bound, capability-first, private, bounded, and public-safe", async () => {
  let loads = 0;
  const deps = routeDeps([grant()], { async loadProjection(key) {
    loads += 1;
    return { available: true, delivery: FRESH_DELIVERY, payload: key === "perps" ? PERPS_PAYLOAD : PARTICIPANT_PAYLOAD };
  } });
  const response = await routeCustomerEntitlements(request(CUSTOMER_PRO_PERPS_ROUTE), flagsEnv(), deps);
  const payload = await body(response);
  assert.equal(response.status, 200);
  assert.equal(loads, 1);
  assert.equal(payload.capability, "intelligence.perps_advanced");
  assert.equal(payload.entitlement_revision, 3);
  assert.equal(payload.projection.access_scope, "pro");
  assert(payload.projection.advanced.positioning.length <= 40);
  assert.match(response.headers.get("cache-control") || "", /private.*no-store/i);
  assert.match(response.headers.get("vary") || "", /Cookie/i);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const serialized = JSON.stringify(payload);
  assert(!serialized.includes("actor_leaders"));
  assert(!serialized.includes("must-not-be-returned"));
  assert(!serialized.includes("STRIPE"));
  assert(!serialized.includes("private_key"));
});

test("cross-account, missing, expired, revoked, and suspended grants fail before projection construction", async () => {
  for (const [row, expected] of [
    [grant(undefined, { user_id: USER_B }), "not_granted"],
    [null, "not_granted"],
    [grant(undefined, { state: "expired" }), "expired"],
    [grant(undefined, { state: "revoked" }), "revoked"],
    [grant(undefined, { state: "suspended" }), "suspended"],
  ]) {
    let loads = 0;
    const deps = routeDeps(row ? [row] : [], { async loadProjection() { loads += 1; throw new Error("must not load"); } });
    const response = await routeCustomerEntitlements(request(CUSTOMER_PRO_PERPS_ROUTE), flagsEnv(), deps);
    const payload = await body(response);
    assert.equal(response.status, 403);
    assert.equal(payload.state, expected);
    assert.equal(loads, 0);
  }
});

test("database, limiter, and stale projection failures are explicit and fail closed", async () => {
  const database = await routeCustomerEntitlements(request(), flagsEnv(), routeDeps([], {
    entitlementStore: { async listOwnedGrants() { throw new Error("D1 down"); } },
  }));
  assert.equal(database.status, 503);
  assert.equal((await body(database)).error, "entitlement_store_unavailable");

  const limiter = await routeCustomerEntitlements(request(), flagsEnv(), routeDeps([], {
    consumeRateLimit: async () => { throw new Error("limiter down"); },
  }));
  assert.equal(limiter.status, 503);
  assert.equal((await body(limiter)).error, "entitlement_rate_limit_unavailable");

  const throttled = await routeCustomerEntitlements(request(), flagsEnv(), routeDeps([], {
    consumeRateLimit: async () => ({ allowed: false, retry_after_seconds: 17 }),
  }));
  assert.equal(throttled.status, 429);
  assert.equal(throttled.headers.get("retry-after"), "17");

  const stale = await routeCustomerEntitlements(request(CUSTOMER_PRO_PERPS_ROUTE), flagsEnv(), routeDeps([grant()], {
    async loadProjection() { return { available: true, delivery: { freshness_state: "stale" }, payload: PERPS_PAYLOAD }; },
  }));
  const stalePayload = await body(stale);
  assert.equal(stale.status, 503);
  assert.equal(stalePayload.error, "intelligence_projection_unavailable");
  assert.equal(stalePayload.freshness_state, "stale");
});

test("participant capability cannot be forged from a valid Perps grant", async () => {
  let loads = 0;
  const response = await routeCustomerEntitlements(request(CUSTOMER_PRO_PARTICIPANTS_ROUTE), flagsEnv(), routeDeps([grant()], {
    async loadProjection() { loads += 1; return { available: true, delivery: FRESH_DELIVERY, payload: PARTICIPANT_PAYLOAD }; },
  }));
  assert.equal(response.status, 403);
  assert.equal((await body(response)).state, "not_granted");
  assert.equal(loads, 0);
});

test("public routes are not claimed by the entitlement router and splitting defaults cannot change anonymous APIs", async () => {
  assert.equal(await routeCustomerEntitlements(request("/api/perps"), {}, routeDeps([grant()])), null);
  assert.equal(await routeCustomerEntitlements(request("/api/behavior"), flagsEnv(), routeDeps([grant()])), null);
  assert.equal(await routeCustomerEntitlements(request("/api/atlas"), flagsEnv(), routeDeps([grant("atlas.native_breadth")])), null);
  assert.equal(await routeCustomerEntitlements(request("/api/atlas/sources"), flagsEnv(), routeDeps([grant("atlas.native_breadth")])), null);
  assert.equal(CustomerIntelligenceProjectionContract.atlas_projection_splitting_included, false);
});

test("projection-split flag in isolation cannot remove fields or add Pro fields to public intelligence APIs", async () => {
  const assets = {
    async fetch(assetRequest) {
      const pathname = new URL(assetRequest.url).pathname;
      if (pathname === "/ravenos/perps.json") return new Response(JSON.stringify(PERPS_PAYLOAD), { headers: { "content-type": "application/json" } });
      if (pathname === "/ravenos/behavior.json") return new Response(JSON.stringify(PARTICIPANT_PAYLOAD), { headers: { "content-type": "application/json" } });
      return new Response("not found", { status: 404 });
    },
  };
  for (const path of ["/api/perps", "/api/behavior", "/ravenos/perps.json", "/ravenos/behavior.json"]) {
    const baseline = await worker.fetch(new Request(`https://ravenos.xyz${path}`), { ASSETS: assets });
    const isolatedFlag = await worker.fetch(new Request(`https://ravenos.xyz${path}`), {
      ASSETS: assets,
      RAVENOS_PUBLIC_PROJECTION_SPLIT_ENABLE: "1",
    });
    assert.equal(isolatedFlag.status, baseline.status, path);
    const isolatedPayload = await body(isolatedFlag);
    const baselinePayload = await body(baseline);
    delete isolatedPayload.delivery?.fetched_at;
    delete isolatedPayload.delivery?.age_seconds;
    delete baselinePayload.delivery?.fetched_at;
    delete baselinePayload.delivery?.age_seconds;
    assert.deepEqual(isolatedPayload, baselinePayload, path);
  }
});

function freshArtifact(payload) {
  const generatedAt = new Date().toISOString();
  return {
    ...structuredClone(payload),
    generated_at: generatedAt,
    updated_at: generatedAt,
    data: { ...structuredClone(payload.data), generated_at: generatedAt },
  };
}

function intelligenceAssets({ perps = freshArtifact(PERPS_PAYLOAD), behavior = freshArtifact(PARTICIPANT_PAYLOAD) } = {}) {
  return {
    async fetch(assetRequest) {
      const pathname = new URL(assetRequest.url).pathname;
      if (pathname === "/ravenos/perps.json") return new Response(JSON.stringify(perps), { headers: { "content-type": "application/json" } });
      if (pathname === "/ravenos/behavior.json") return new Response(JSON.stringify(behavior), { headers: { "content-type": "application/json" } });
      return new Response("not found", { status: 404 });
    },
  };
}

test("coordinated activation enforces Free projections on APIs and direct public artifact paths", async () => {
  const env = { ...flagsEnv(), ASSETS: intelligenceAssets() };
  for (const [path, kind, rowKey, limit] of [
    ["/api/perps", "perps", "market_overview", 6],
    ["/ravenos/perps.json", "perps", "market_overview", 6],
    ["/public/ravenos/perps.json", "perps", "market_overview", 6],
    ["/perps.json?scope=pro&capability=intelligence.perps_advanced", "perps", "market_overview", 6],
    ["/ravenos/%70erps.json", "perps", "market_overview", 6],
    ["/api/behavior", "participants", "participation_overview", 6],
    ["/ravenos/behavior.json", "participants", "participation_overview", 6],
    ["/public/ravenos/behavior.json", "participants", "participation_overview", 6],
    ["/behavior.json?scope=pro&capability=intelligence.participant_advanced", "participants", "participation_overview", 6],
    ["/ravenos/%62ehavior.json", "participants", "participation_overview", 6],
  ]) {
    const response = await worker.fetch(new Request(`https://ravenos.xyz${path}`), env);
    const payload = await body(response);
    assert.equal(response.status, 200, path);
    assert.equal(payload.schema_version, "ravenos.customer_intelligence_projection.v1", path);
    assert.equal(payload.intelligence_kind, kind, path);
    assert.equal(payload.access_scope, "free", path);
    assert.equal(payload.advanced, null, path);
    assert(Array.isArray(payload[rowKey]) && payload[rowKey].length <= limit, path);
    assert.equal(response.headers.get("x-ravenos-access-scope"), "free", path);
    const serialized = JSON.stringify(payload);
    for (const forbidden of ["actor_leaders", "top_pressure", "tightest_books", "wide_or_thin_books", "condition_matrix", "participant_success_rate", "win_rate_band", "score_strength", "sample_gap"]) {
      assert(!serialized.includes(forbidden), `${path} leaked ${forbidden}`);
    }
    assert.equal(payload.provenance?.raw_provider_payload_included, false, `${path} raw payload boundary`);
  }

  const head = await worker.fetch(new Request("https://ravenos.xyz/public/ravenos/perps.json", { method: "HEAD" }), env);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(head.headers.get("x-ravenos-access-scope"), "free");
});

test("partial activation cannot split either capability and stale or malformed coordinated inputs fail closed", async () => {
  const assets = intelligenceAssets();
  const partial = {
    ...flagsEnv({ RAVENOS_PRO_PERPS_ADVANCED_ENABLE: "0", RAVENOS_PRO_PARTICIPANT_ADVANCED_ENABLE: "0" }),
    ASSETS: assets,
  };
  const rawPerps = await body(await worker.fetch(new Request("https://ravenos.xyz/api/perps"), partial));
  const rawBehavior = await body(await worker.fetch(new Request("https://ravenos.xyz/api/behavior"), partial));
  assert.equal(rawPerps.schema_version, "ravenos_perps_public_origin_v1");
  assert.equal(rawBehavior.schema_version, "ravenos_behavior_public_origin_v1");

  const stale = await worker.fetch(new Request("https://ravenos.xyz/api/perps"), { ...flagsEnv(), ASSETS: intelligenceAssets({ perps: PERPS_PAYLOAD }) });
  assert.equal(stale.status, 503);
  assert.equal((await body(stale)).state, "unavailable");
  const unsafePayload = freshArtifact(PERPS_PAYLOAD);
  unsafePayload.safe_public = false;
  const unsafe = await worker.fetch(new Request("https://ravenos.xyz/ravenos/perps.json"), { ...flagsEnv(), ASSETS: intelligenceAssets({ perps: unsafePayload }) });
  assert.equal(unsafe.status, 503);
  assert.equal((await body(unsafe)).error, "intelligence_projection_contract_rejected");
});

test("coordinated Participant split also bounds chain-route behavior context", async () => {
  const response = await worker.fetch(new Request("https://ravenos.xyz/api/chains/solana"), {
    ...flagsEnv(),
    ASSETS: intelligenceAssets(),
  });
  const payload = await body(response);
  assert.equal(response.status, 200);
  assert(Array.isArray(payload.behavior_rows));
  assert(payload.behavior_rows.length <= 6);
  for (const row of payload.behavior_rows) {
    assert.deepEqual(Object.keys(row).sort(), [...CustomerIntelligenceProjectionContract.free_field_contracts.participant_condition].sort());
  }
  const serialized = JSON.stringify(payload.behavior_rows);
  assert(!serialized.includes("participant_success_rate"));
  assert(!serialized.includes("win_rate_band"));
  assert(!serialized.includes("score_strength"));
  assert(!serialized.includes("sample_gap"));
});
