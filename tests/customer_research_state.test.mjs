import assert from "node:assert/strict";
import test from "node:test";

import {
  CUSTOMER_RESEARCH_STATE_ROUTE,
  CustomerResearchStateLimits,
  ResearchStateError,
  buildSavedMarketTerminalUrl,
  canonicalizeSavedMarket,
  normalizeSavedWorkspace,
  routeCustomerResearchState,
} from "../lib/customer_research_state.mjs";
import { sha256 } from "../lib/customer_identity.mjs";

const ORIGIN = "https://app.ravenos.xyz";
const NOW_MS = Date.parse("2026-08-26T18:00:00.000Z");
const NOW = Math.floor(NOW_MS / 1000);
const USER_A = `usr_${"a".repeat(32)}`;
const USER_B = `usr_${"b".repeat(32)}`;
const RAW_A = `ses_${"a".repeat(48)}`;
const RAW_A_DEVICE_2 = `ses_${"c".repeat(48)}`;
const RAW_B = `ses_${"b".repeat(48)}`;
const CSRF_A = `csrf_${"a".repeat(48)}`;
const CSRF_B = `csrf_${"b".repeat(48)}`;
const POOL_A = "11111111111111111111111111111111";
const POOL_B = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

function configuredEnv() {
  return {
    RAVENOS_CUSTOMER_ACCOUNTS_ENABLE: "1",
    RAVENOS_AUTH_ORIGIN: ORIGIN,
    RAVENOS_AUTH_REDIRECT_URI: `${ORIGIN}/api/v1/auth/callback`,
    WORKOS_CLIENT_ID: "client_test_ravenos",
    WORKOS_API_KEY: "sk_test_not_returned",
    RAVENOS_AUTH_HASH_PEPPER: "test-pepper-not-returned",
    RAVENOS_CUSTOMER_DB: { prepare() {}, batch() {} },
  };
}

class MemoryAuthStore {
  constructor() {
    this.sessions = new Map();
    this.events = [];
    this.rateRows = [];
    this.denyRates = false;
  }

  async seed() {
    const rows = [
      [RAW_A, CSRF_A, USER_A, "sespub_a"],
      [RAW_A_DEVICE_2, CSRF_A, USER_A, "sespub_a2"],
      [RAW_B, CSRF_B, USER_B, "sespub_b"],
    ];
    for (const [raw, csrf, userId, publicId] of rows) {
      this.sessions.set(await sha256(raw), {
        session_public_id: publicId,
        csrf_verifier: await sha256(csrf),
        user_id: userId,
        user_state: "active",
        authenticated_at: NOW - 60,
        created_at: NOW - 60,
        last_seen_at: NOW - 30,
        idle_expires_at: NOW + 1800,
        absolute_expires_at: NOW + 3600,
        revoked_at: null,
        primary_email: "research@example.com",
        display_name: "Research User",
        user_created_at: NOW - 1000,
      });
    }
    return this;
  }

  async findSession(hash) { return this.sessions.get(hash) ? { ...this.sessions.get(hash) } : null; }
  async touchSession() {}
  async recordEvent(event) { this.events.push({ ...event }); }
  async rateLimit(input) {
    this.rateRows.push({ ...input });
    return { allowed: !this.denyRates, retry_after_seconds: 900 };
  }
}

class MemoryResearchStore {
  constructor(maximum = CustomerResearchStateLimits.maximum_saved_markets) {
    this.maximum = maximum;
    this.rows = [];
    this.sequence = 0;
  }

  async getByInstrument(userId, instrumentId) {
    return this.rows.find((row) => row.user_id === userId && row.instrument_id === instrumentId) || null;
  }

  async list(userId) {
    return this.rows.filter((row) => row.user_id === userId).sort((a, b) => b.updated_at - a.updated_at).map((row) => ({ ...row }));
  }

  async upsert({ user_id: userId, market, workspace, availability, content_hash: contentHash, now, expected_revision: expectedRevision }) {
    let row = await this.getByInstrument(userId, market.instrument_id);
    if (row && expectedRevision !== null && Number(row.revision) !== expectedRevision) {
      throw new ResearchStateError("saved_research_revision_conflict");
    }
    if (!row && this.rows.filter((item) => item.user_id === userId).length >= this.maximum) {
      throw new ResearchStateError("saved_research_quota_exceeded");
    }
    const values = {
      schema_version: "ravenos.saved_exact_market.v1",
      user_id: userId,
      ...market,
      chain_id: market.chain_id,
      venue_id: availability.venue_id || row?.venue_id || market.venue_id,
      base_symbol: availability.base_symbol || row?.base_symbol || market.base_symbol,
      quote_symbol: availability.quote_symbol || row?.quote_symbol || market.quote_symbol,
      display_label: availability.display_label || row?.display_label || market.display_label,
      workspace_schema_version: workspace.schema_version,
      timeframe: workspace.timeframe,
      indicators_json: JSON.stringify(workspace.indicators),
      raven_overlays_json: JSON.stringify(workspace.raven_overlays),
      density: workspace.density,
      selected_panel: workspace.selected_panel,
      content_hash: contentHash,
      availability_state: availability.availability_state,
      availability_reason: availability.availability_reason,
      availability_checked_at: availability.availability_checked_at,
    };
    if (row) {
      const unchanged = row.content_hash === contentHash
        && row.availability_state === availability.availability_state
        && row.availability_reason === availability.availability_reason
        && Number(row.availability_checked_at || 0) === Number(availability.availability_checked_at || 0);
      if (unchanged) return { ...row };
      Object.assign(row, values, { revision: row.content_hash === contentHash ? row.revision : row.revision + 1, updated_at: now });
      return { ...row };
    }
    row = { ...values, watch_id: `wat_${String(++this.sequence).padStart(20, "a")}`, revision: 1, created_at: now, updated_at: now };
    this.rows.push(row);
    return { ...row };
  }

  async getOwned(userId, watchId) { return this.rows.find((row) => row.user_id === userId && row.watch_id === watchId) || null; }
  async updateAvailability(userId, watchId, availability, now) {
    const row = await this.getOwned(userId, watchId);
    if (!row) return null;
    Object.assign(row, {
      display_label: availability.display_label || row.display_label,
      base_symbol: availability.base_symbol || row.base_symbol,
      quote_symbol: availability.quote_symbol || row.quote_symbol,
      venue_id: availability.venue_id || row.venue_id,
      availability_state: availability.availability_state,
      availability_reason: availability.availability_reason,
      availability_checked_at: availability.availability_checked_at,
      updated_at: now,
    });
    return { ...row };
  }
  async deleteOwned(userId, watchId) {
    const index = this.rows.findIndex((row) => row.user_id === userId && row.watch_id === watchId);
    if (index < 0) return 0;
    this.rows.splice(index, 1);
    return 1;
  }
  async deleteAllOwned(userId) {
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => row.user_id !== userId);
    return before - this.rows.length;
  }
}

function request(path = CUSTOMER_RESEARCH_STATE_ROUTE, {
  method = "GET",
  user = "a",
  csrf = true,
  origin = ORIGIN,
  requestOrigin = ORIGIN,
  body,
  contentType = "application/json",
  extraHeaders = {},
} = {}) {
  const raw = user === "b" ? RAW_B : user === "a2" ? RAW_A_DEVICE_2 : RAW_A;
  const csrfValue = user === "b" ? CSRF_B : CSRF_A;
  const headers = new Headers({ cookie: `__Host-ravenos_session=${raw}; __Host-ravenos_csrf=${csrfValue}`, ...extraHeaders });
  if (method !== "GET") {
    headers.set("origin", requestOrigin);
    headers.set("sec-fetch-site", requestOrigin === ORIGIN ? "same-origin" : "cross-site");
    headers.set("content-type", contentType);
    if (csrf) headers.set("x-ravenos-csrf", csrfValue);
  }
  return new Request(`${origin}${path}`, { method, headers, body: body === undefined ? (method === "GET" ? undefined : "{}") : body });
}

function saveBody(instrumentId = `solana:pool:${POOL_A}`, workspace = {}) {
  return JSON.stringify({
    market: { instrument_id: instrumentId },
    workspace: {
      schema_version: "ravenos.saved_workspace.v1",
      timeframe: "4h",
      indicators: ["ema20", "vwap"],
      raven_overlays: ["pressure-zone", "liquidity-zone"],
      density: "compact",
      selected_panel: "raven",
      ...workspace,
    },
  });
}

async function setup(options = {}) {
  const store = await new MemoryAuthStore().seed();
  const researchStore = new MemoryResearchStore(options.maximum);
  let availabilityCalls = 0;
  const deps = {
    store,
    researchStore,
    nowMs: NOW_MS,
    async resolveMarketAvailability(market) {
      availabilityCalls += 1;
      return options.resolveMarketAvailability
        ? options.resolveMarketAvailability(market)
        : {
            availability_state: "available",
            availability_reason: "exact_market_verified",
            availability_checked_at: NOW,
            display_label: "SAME/USDC",
            base_symbol: "SAME",
            quote_symbol: "USDC",
            venue_id: "meteora",
            raw_provider_payload: "must-not-persist",
          };
    },
  };
  return { store, researchStore, deps, availabilityCalls: () => availabilityCalls };
}

test("canonical exact identity rejects symbols, contradictions, and malformed pools", () => {
  assert.throws(() => canonicalizeSavedMarket({ instrument_id: "SOL" }), /exact_market_identity_required/);
  assert.throws(() => canonicalizeSavedMarket({ instrument_id: "solana:pool:not-a-pool" }), /exact_market_identity_invalid/);
  assert.throws(() => canonicalizeSavedMarket({ instrument_id: `solana:pool:${POOL_A}`, chain: "base" }), /exact_market_identity_mismatch/);
  assert.throws(() => canonicalizeSavedMarket({ instrument_id: "hyperliquid:perp:SOL", chain: "solana" }), /exact_market_identity_mismatch/);
  assert.equal(canonicalizeSavedMarket({ instrument_id: "hyperliquid:perp:sol", market: "perp" }).instrument_id, "hyperliquid:perp:SOL");
  const etf = canonicalizeSavedMarket({ instrument_id: "etf:nyse-arca:SPY", instrument_type: "etf", asset_class: "etf", market: "equities" });
  assert.equal(etf.instrument_id, "etf:nyse-arca:spy");
  assert.equal(etf.asset_class, "etf");
  assert.throws(() => canonicalizeSavedMarket({ instrument_id: "equity:nasdaq:AAPL", asset_class: "etf" }), /exact_market_identity_mismatch/);
  assert.throws(() => canonicalizeSavedMarket({ instrument_id: "equity:nasdaq:AAPL", chain: "solana" }), /exact_market_identity_mismatch/);
});

test("workspace persistence accepts only the six versioned allowlisted fields", () => {
  const workspace = normalizeSavedWorkspace(JSON.parse(saveBody()).workspace);
  assert.deepEqual(workspace.indicators, ["ema20", "vwap"]);
  assert.deepEqual(workspace.raven_overlays, ["pressure-zone", "liquidity-zone"]);
  assert.throws(() => normalizeSavedWorkspace({ indicators: ["custom-script"] }), /saved_workspace_indicators_invalid/);
  assert.throws(() => normalizeSavedWorkspace({ raven_overlays: ["plan-entry"] }), /saved_workspace_overlays_invalid/);
  assert.throws(() => normalizeSavedWorkspace({ arbitrary_html: "<script>" }), /saved_workspace_invalid/);
});

test("identically named pools remain separate exact saved markets", async () => {
  const harness = await setup();
  for (const pool of [POOL_A, POOL_B]) {
    const response = await routeCustomerResearchState(request(`${CUSTOMER_RESEARCH_STATE_ROUTE}/watch-items`, { method: "POST", body: saveBody(`solana:pool:${pool}`) }), configuredEnv(), harness.deps);
    assert.equal(response.status, 201);
  }
  const list = await routeCustomerResearchState(request(), configuredEnv(), harness.deps);
  const payload = await list.json();
  assert.equal(payload.items.length, 2);
  assert.equal(new Set(payload.items.map((item) => item.market.display_label)).size, 1);
  assert.equal(new Set(payload.items.map((item) => item.market.instrument_id)).size, 2);
  assert(payload.items.every((item) => new URL(item.terminal_url).searchParams.get("instrument_id") === item.market.instrument_id));
});

test("save is idempotent, workspace changes revise once, and a second device restores state", async () => {
  const harness = await setup();
  const path = `${CUSTOMER_RESEARCH_STATE_ROUTE}/watch-items`;
  const first = await routeCustomerResearchState(request(path, { method: "POST", body: saveBody() }), configuredEnv(), harness.deps);
  const firstBody = await first.json();
  const repeated = await routeCustomerResearchState(request(path, { method: "POST", body: saveBody() }), configuredEnv(), harness.deps);
  const repeatedBody = await repeated.json();
  assert.equal(repeated.status, 200);
  assert.equal(repeatedBody.item.watch_id, firstBody.item.watch_id);
  assert.equal(repeatedBody.item.revision, 1);
  assert.equal(repeatedBody.item.updated_at, firstBody.item.updated_at);
  assert.equal(harness.availabilityCalls(), 1, "fresh availability must be reused on idempotent save");

  const changed = await routeCustomerResearchState(request(path, { method: "POST", body: saveBody(undefined, { timeframe: "1d" }) }), configuredEnv(), harness.deps);
  assert.equal((await changed.json()).item.revision, 2);
  const secondDevice = await routeCustomerResearchState(request(CUSTOMER_RESEARCH_STATE_ROUTE, { user: "a2" }), configuredEnv(), harness.deps);
  const restored = await secondDevice.json();
  assert.equal(restored.items[0].workspace.timeframe, "1d");
  assert.equal(restored.items[0].revision, 2);
});

test("a stale workspace revision cannot overwrite a newer saved workspace", async () => {
  const harness = await setup();
  const path = `${CUSTOMER_RESEARCH_STATE_ROUTE}/watch-items`;
  await routeCustomerResearchState(request(path, { method: "POST", body: saveBody() }), configuredEnv(), harness.deps);
  const changed = JSON.parse(saveBody(undefined, { timeframe: "1d" }));
  changed.expected_revision = 1;
  assert.equal((await routeCustomerResearchState(request(path, { method: "POST", body: JSON.stringify(changed) }), configuredEnv(), harness.deps)).status, 200);
  const stale = JSON.parse(saveBody(undefined, { timeframe: "15m" }));
  stale.expected_revision = 1;
  const rejected = await routeCustomerResearchState(request(path, { method: "POST", body: JSON.stringify(stale) }), configuredEnv(), harness.deps);
  assert.equal(rejected.status, 409);
  assert.equal((await rejected.json()).error, "saved_research_revision_conflict");
  assert.equal((await harness.researchStore.list(USER_A))[0].timeframe, "1d");
});

test("anonymous, public-origin, cross-origin, missing-CSRF, malformed, and oversized writes fail closed", async () => {
  const harness = await setup();
  const path = `${CUSTOMER_RESEARCH_STATE_ROUTE}/watch-items`;
  const anonymous = new Request(`${ORIGIN}${path}`, { method: "POST", headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json" }, body: saveBody() });
  assert.equal((await routeCustomerResearchState(anonymous, configuredEnv(), harness.deps)).status, 401);
  assert.equal((await routeCustomerResearchState(request(path, { method: "POST", origin: "https://ravenos.xyz", body: saveBody() }), configuredEnv(), harness.deps)).status, 409);
  assert.equal((await routeCustomerResearchState(request(path, { method: "POST", requestOrigin: "https://evil.example", body: saveBody() }), configuredEnv(), harness.deps)).status, 403);
  assert.equal((await routeCustomerResearchState(request(path, { method: "POST", csrf: false, body: saveBody() }), configuredEnv(), harness.deps)).status, 403);
  assert.equal((await routeCustomerResearchState(request(path, { method: "POST", body: "{" }), configuredEnv(), harness.deps)).status, 400);
  const oversized = "x".repeat(CustomerResearchStateLimits.maximum_request_bytes + 1);
  const oversizedResponse = await routeCustomerResearchState(request(path, { method: "POST", body: oversized, extraHeaders: { "content-length": String(oversized.length) } }), configuredEnv(), harness.deps);
  assert.equal(oversizedResponse.status, 413);
  assert.equal(harness.researchStore.rows.length, 0);
  assert.equal(harness.availabilityCalls(), 0);
});

test("cross-origin reads fail before customer research state is exposed", async () => {
  const harness = await setup();
  const response = await routeCustomerResearchState(request(CUSTOMER_RESEARCH_STATE_ROUTE, {
    extraHeaders: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
  }), configuredEnv(), harness.deps);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "request_not_allowed");
  assert.equal(harness.store.rateRows.length, 0);
});

test("ownership fails closed and individual delete is idempotent", async () => {
  const harness = await setup();
  const saved = await routeCustomerResearchState(request(`${CUSTOMER_RESEARCH_STATE_ROUTE}/watch-items`, { method: "POST", body: saveBody() }), configuredEnv(), harness.deps);
  const watchId = (await saved.json()).item.watch_id;
  const crossAccount = await routeCustomerResearchState(request(`${CUSTOMER_RESEARCH_STATE_ROUTE}/watch-items/${watchId}`, { method: "DELETE", user: "b" }), configuredEnv(), harness.deps);
  assert.equal(crossAccount.status, 200);
  assert.equal((await crossAccount.json()).deleted, false);
  assert.equal(harness.researchStore.rows.length, 1);
  const removed = await routeCustomerResearchState(request(`${CUSTOMER_RESEARCH_STATE_ROUTE}/watch-items/${watchId}`, { method: "DELETE" }), configuredEnv(), harness.deps);
  assert.equal((await removed.json()).deleted, true);
  const repeated = await routeCustomerResearchState(request(`${CUSTOMER_RESEARCH_STATE_ROUTE}/watch-items/${watchId}`, { method: "DELETE" }), configuredEnv(), harness.deps);
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).deleted, false);
});

test("unavailable and superseded exact markets remain saved without substitution", async () => {
  let stateName = "unavailable";
  const harness = await setup({
    resolveMarketAvailability: () => ({ availability_state: stateName, availability_reason: stateName === "superseded" ? "provider_reports_superseded" : "exact_market_not_found", availability_checked_at: NOW }),
  });
  const saved = await routeCustomerResearchState(request(`${CUSTOMER_RESEARCH_STATE_ROUTE}/watch-items`, { method: "POST", body: saveBody() }), configuredEnv(), harness.deps);
  const first = await saved.json();
  assert.equal(first.item.availability.state, "unavailable");
  assert.equal(new URL(first.item.terminal_url).searchParams.get("instrument_id"), `solana:pool:${POOL_A}`);
  stateName = "superseded";
  const refreshed = await routeCustomerResearchState(request(`${CUSTOMER_RESEARCH_STATE_ROUTE}/watch-items/${first.item.watch_id}/refresh`, { method: "POST" }), configuredEnv(), harness.deps);
  const second = await refreshed.json();
  assert.equal(second.item.availability.state, "superseded");
  assert.equal(second.item.market.instrument_id, `solana:pool:${POOL_A}`);
  assert.equal(new URL(second.item.terminal_url).searchParams.get("instrument_id"), `solana:pool:${POOL_A}`);
});

test("provider metadata is normalized as text and forbidden data never enters the DTO", async () => {
  const harness = await setup({
    resolveMarketAvailability: () => ({
      availability_state: "available",
      availability_reason: "<script>alert(1)</script>",
      availability_checked_at: NOW,
      display_label: "<img src=x onerror=alert(1)> EVIL/USDC",
      base_symbol: "<EVIL>",
      quote_symbol: "USDC",
      venue_id: "meteora",
      raw_provider_payload: { secret: "provider-secret" },
      wallet_address: "customer-wallet",
      cohort_identity: "private-cohort",
      execution_intent: "must-not-exist",
    }),
  });
  const response = await routeCustomerResearchState(request(`${CUSTOMER_RESEARCH_STATE_ROUTE}/watch-items`, { method: "POST", body: saveBody() }), configuredEnv(), harness.deps);
  const serialized = JSON.stringify(await response.json());
  for (const forbidden of ["<script", "<img", "onerror", "provider-secret", "customer-wallet", "private-cohort", "execution_intent"]) assert(!serialized.includes(forbidden), forbidden);
});

test("quota is owner-scoped and delete-all removes every owned record only", async () => {
  const harness = await setup({ maximum: 2 });
  const path = `${CUSTOMER_RESEARCH_STATE_ROUTE}/watch-items`;
  for (const pool of [POOL_A, POOL_B]) {
    assert.equal((await routeCustomerResearchState(request(path, { method: "POST", body: saveBody(`solana:pool:${pool}`) }), configuredEnv(), harness.deps)).status, 201);
  }
  const over = await routeCustomerResearchState(request(path, { method: "POST", body: saveBody("hyperliquid:perp:SOL") }), configuredEnv(), harness.deps);
  assert.equal(over.status, 409);
  assert.equal((await over.json()).error, "saved_research_quota_exceeded");
  await routeCustomerResearchState(request(path, { method: "POST", user: "b", body: saveBody("hyperliquid:perp:BTC") }), configuredEnv(), harness.deps);
  const missingConfirmation = await routeCustomerResearchState(request(CUSTOMER_RESEARCH_STATE_ROUTE, { method: "DELETE", body: JSON.stringify({ confirm: "yes" }) }), configuredEnv(), harness.deps);
  assert.equal(missingConfirmation.status, 400);
  const cleared = await routeCustomerResearchState(request(CUSTOMER_RESEARCH_STATE_ROUTE, { method: "DELETE", body: JSON.stringify({ confirm: "delete_all_saved_research_state" }) }), configuredEnv(), harness.deps);
  assert.equal((await cleared.json()).deleted_count, 2);
  assert.equal((await harness.researchStore.list(USER_A)).length, 0);
  assert.equal((await harness.researchStore.list(USER_B)).length, 1);
  const repeated = await routeCustomerResearchState(request(CUSTOMER_RESEARCH_STATE_ROUTE, { method: "DELETE", body: JSON.stringify({ confirm: "delete_all_saved_research_state" }) }), configuredEnv(), harness.deps);
  assert.equal((await repeated.json()).deleted_count, 0);
});

test("terminal URL restores only allowlisted workspace state", () => {
  const url = new URL(buildSavedMarketTerminalUrl({
    market: canonicalizeSavedMarket({ instrument_id: `solana:pool:${POOL_A}` }),
    workspace: normalizeSavedWorkspace(JSON.parse(saveBody()).workspace),
  }));
  assert.equal(url.origin, "https://ravenos.xyz");
  assert.equal(url.pathname, "/terminal/");
  assert.equal(url.searchParams.get("instrument_id"), `solana:pool:${POOL_A}`);
  assert.equal(url.searchParams.get("timeframe"), "4h");
  assert.equal(url.searchParams.get("indicators"), "ema20,vwap");
  assert.equal(url.searchParams.get("raven_overlays"), "pressure-zone,liquidity-zone");
  assert.equal(url.searchParams.get("density"), "compact");
  assert.equal(url.searchParams.get("panel"), "raven");
  for (const forbidden of ["wallet", "alert", "order", "quote", "html", "return_to"]) assert.equal(url.searchParams.has(forbidden), false);
});

test("terminal URL preserves an explicitly empty indicator set", () => {
  const url = new URL(buildSavedMarketTerminalUrl({
    market: canonicalizeSavedMarket({ instrument_id: `solana:pool:${POOL_A}` }),
    workspace: normalizeSavedWorkspace({ indicators: [] }),
  }));
  assert.equal(url.searchParams.has("indicators"), true);
  assert.equal(url.searchParams.get("indicators"), "");
});
