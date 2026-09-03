import assert from "node:assert/strict";
import test from "node:test";

import {
  DEXCH_DISCOVERY_SCHEMA,
  DEXCH_HOLDERS_SCHEMA,
  DexchDiscoveryProvider,
  dexchLifecycleEnrichment,
  dexchLifecycleTransitionEvents,
  dexchTokenSearchParams,
  dexchWalletEntryContext,
  normalizeDexchToken,
  resolveDexchDiscoveryRuntime,
} from "../lib/dexch_discovery_provider.mjs";

const NOW = Date.parse("2026-09-03T19:00:00.000Z");
const SOLANA_MINT = "25iEvsLv5LxkMHDSiha6Dmciytmzjek9ayQN5PtApump";
const RH_TOKEN = "0x2112a316a2e56d7300092e5a41d2a84dd11d3bd6";
const BSC_TOKEN = "0xf0de4c23e6b33f89a4ac150761da978c21607777";

function tokenFixture(overrides = {}) {
  return {
    chain: "robinhood",
    address: RH_TOKEN,
    name: "Dexchart",
    symbol: "CHART",
    launchpad: "ponsV2",
    kind: "POOL",
    tier: "ACTIVE",
    status: "BONDING",
    creator: "0x65050a9b7e5075a2ba5ced7b1b64ee66262c40dc",
    launchTime: "2026-09-03T18:00:00.000Z",
    lastActivityAt: "2026-09-03T18:59:00.000Z",
    migratedAt: null,
    progressBps: 1721,
    priceUsd: 0.000016,
    marketCapUsd: 6490,
    liquidityUsd: 3.58,
    volume24hUsd: 85_381,
    txns24h: 848,
    buys24h: 464,
    sells24h: 384,
    holderCount: 81,
    top10Pct: 72.25,
    risk: "unknown",
    riskWarnings: 0,
    dexPaid: false,
    hasSocials: true,
    quoteToken: "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
    quoteSymbol: "ETH",
    ...overrides,
  };
}

function response(payload, status = 200, headers = {}) {
  return new Response(typeof payload === "string" ? payload : JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("Dexch token normalization binds exact chain and address instead of ticker identity", () => {
  const robinhood = normalizeDexchToken(tokenFixture(), { nowMs: NOW, retrievedAt: new Date(NOW).toISOString() });
  const bsc = normalizeDexchToken(tokenFixture({ chain: "bsc", address: BSC_TOKEN }), { nowMs: NOW, retrievedAt: new Date(NOW).toISOString() });
  assert.equal(robinhood.chain_id, "eip155:4663");
  assert.equal(bsc.chain_id, "eip155:56");
  assert.equal(robinhood.symbol, bsc.symbol);
  assert.notEqual(robinhood.canonical_identity.asset_id, bsc.canonical_identity.asset_id);
  assert.equal(robinhood.canonical_identity.asset_id, `eip155:4663/erc20:${RH_TOKEN}`);
});

test("Solana Dexch identity does not guess SPL versus Token-2022", () => {
  const token = normalizeDexchToken(tokenFixture({
    chain: "solana",
    address: SOLANA_MINT,
    creator: "E4WuDtSt39GpUacPoFnaqU1jSni8LMG3nGt2mWL331NA",
    quoteToken: "So11111111111111111111111111111111111111112",
    quoteSymbol: "SOL",
  }), { nowMs: NOW, retrievedAt: new Date(NOW).toISOString() });
  assert.equal(token.canonical_identity.standard, "solana-mint");
  assert.equal(token.canonical_identity.verification_state, "provider_reported_token_program_unresolved");
  assert.match(token.canonical_identity.asset_id, /^solana:mainnet-beta\/solana-mint:/);
});

test("contradictory holder fields become unknown instead of safe-looking zeroes", () => {
  const token = normalizeDexchToken(tokenFixture({ holderCount: 0, top10Pct: 0 }), {
    nowMs: NOW,
    retrievedAt: new Date(NOW).toISOString(),
  });
  assert.equal(token.market.holder_count, null);
  assert.equal(token.market.top_10_supply_pct, null);
  assert.equal(token.quality.state, "contradictory");
  assert.ok(token.quality.contradictions.includes("provider_reported_zero_holders_with_trading_activity"));

  const impossible = normalizeDexchToken(tokenFixture({ top10Pct: 125.96 }), {
    nowMs: NOW,
    retrievedAt: new Date(NOW).toISOString(),
  });
  assert.equal(impossible.market.top_10_supply_pct, null);
  assert.ok(impossible.quality.contradictions.includes("provider_holder_percentage_out_of_range"));
});

test("creation and migration remain separate provider-qualified lifecycle facts", () => {
  const token = normalizeDexchToken(tokenFixture({
    status: "MIGRATED",
    tier: "GRADUATED",
    migratedAt: "2026-09-03T18:12:00.000Z",
  }), { nowMs: NOW, retrievedAt: new Date(NOW).toISOString() });
  const lifecycle = dexchLifecycleEnrichment(token, { nowMs: NOW });
  assert.equal(lifecycle.created_at, "2026-09-03T18:00:00.000Z");
  assert.equal(lifecycle.migrated_at, "2026-09-03T18:12:00.000Z");
  assert.equal(lifecycle.token_age_seconds, 3600);
  assert.equal(lifecycle.creation_time_semantics, "dexch_launch_time_undocumented");
  assert.equal(lifecycle.raven_verified, false);
  assert.equal(lifecycle.execution_authority, false);
});

test("wallet entry enrichment accepts only contemporaneous provider evidence", () => {
  const token = normalizeDexchToken(tokenFixture(), {
    nowMs: NOW,
    retrievedAt: new Date(NOW).toISOString(),
  });
  const current = dexchWalletEntryContext(token, {
    entryObservedAt: "2026-09-03T18:59:20.000Z",
    nowMs: NOW,
  });
  assert.equal(current.state, "provider_reported");
  assert.equal(current.observation_distance_seconds, 40);
  assert.equal(current.token_age_at_entry_seconds, 3_560);
  assert.equal(current.market_cap_at_entry_usd, 6_490);
  assert.equal(current.liquidity_at_entry_usd, 3.58);
  assert.equal(current.current_value_substituted_for_history, false);
  assert.equal(current.raven_verified, false);

  const historical = dexchWalletEntryContext(token, {
    entryObservedAt: "2026-08-01T00:00:00.000Z",
    nowMs: NOW,
  });
  assert.equal(historical.state, "unavailable");
  assert.equal(historical.reason, "no_contemporaneous_provider_observation");
  assert.equal(historical.market_cap_at_entry_usd, null);
  assert.equal(historical.liquidity_at_entry_usd, null);
  assert.equal(historical.historical_value_claimed, false);
});

test("lifecycle transition events preserve provider semantics and no authority", () => {
  const previous = normalizeDexchToken(tokenFixture({
    progressBps: 8_500,
    dexPaid: false,
  }), { nowMs: NOW, retrievedAt: "2026-09-03T18:58:00.000Z" });
  const current = normalizeDexchToken(tokenFixture({
    status: "MIGRATED",
    tier: "GRADUATED",
    progressBps: 9_400,
    migratedAt: "2026-09-03T18:59:00.000Z",
    dexPaid: true,
  }), { nowMs: NOW, retrievedAt: new Date(NOW).toISOString() });
  const events = dexchLifecycleTransitionEvents(previous, current);
  assert.deepEqual(events.map((event) => event.type), [
    "TOKEN_MIGRATED",
    "TOKEN_NEAR_GRADUATION",
    "DEX_PAID_REPORTED",
  ]);
  assert.equal(events.every((event) => event.raven_verified === false), true);
  assert.equal(events.every((event) => event.execution_authority === false), true);
  assert.equal(events[2].event_time_semantics, "first_raven_observation_not_payment_time");
});

test("screener filters are bounded and map only documented query names", () => {
  const params = dexchTokenSearchParams({
    chains: ["solana", "robinhood"],
    preset: "almost",
    sort: "marketCap",
    order: "asc",
    limit: 25,
    min_market_cap_usd: 5_000,
    max_market_cap_usd: 100_000,
    min_holders: 20,
    dex_paid: true,
  });
  assert.equal(params.get("chains"), "solana,robinhood");
  assert.equal(params.get("minMcap"), "5000");
  assert.equal(params.get("maxMcap"), "100000");
  assert.equal(params.get("minHolders"), "20");
  assert.equal(params.get("dexPaid"), "true");
  assert.throws(() => dexchTokenSearchParams({ chains: ["ethereum"] }), /dexch_chains_invalid/);
  assert.throws(() => dexchTokenSearchParams({ chains: ["solana"], limit: 101 }), /dexch_limit_invalid/);
  assert.throws(() => dexchTokenSearchParams({ chains: ["solana"], cursor: "bad cursor" }), /dexch_cursor_invalid/);
});

test("provider request is bounded, hashed, coalesced and returns no raw payload", async () => {
  let requests = 0;
  const provider = new DexchDiscoveryProvider({
    now: () => NOW,
    fetchFn: async (url) => {
      requests += 1;
      assert.match(url, /^https:\/\/api\.dexch\.art\/api\/v1\/tokens\?/);
      return response({ data: [tokenFixture()], nextCursor: "cursor_1" });
    },
  });
  const [first, second] = await Promise.all([
    provider.tokens({ chains: ["robinhood"], limit: 1 }),
    provider.tokens({ chains: ["robinhood"], limit: 1 }),
  ]);
  assert.equal(requests, 1);
  assert.equal(first.schema_version, DEXCH_DISCOVERY_SCHEMA);
  assert.equal(second.rows[0].address, RH_TOKEN);
  assert.equal(first.provenance.raw_response_sha256.length, 64);
  assert.equal(JSON.stringify(first).includes("raw_payload"), true);
  assert.equal(JSON.stringify(first).includes('"data"'), false);
  assert.equal(first.execution_boundary.signing, false);
  assert.equal(provider.healthSnapshot().state, "healthy");
});

test("provider malformed and oversized responses fail closed", async () => {
  const malformed = new DexchDiscoveryProvider({
    now: () => NOW,
    fetchFn: async () => response("not-json"),
  });
  await assert.rejects(() => malformed.tokens({ chains: ["solana"] }), /dexch_invalid_json/);

  const oversized = new DexchDiscoveryProvider({
    now: () => NOW,
    maximumResponseBytes: 1_024,
    fetchFn: async () => response({ data: [] }, 200, { "content-length": "5000" }),
  });
  await assert.rejects(() => oversized.tokens({ chains: ["solana"] }), /dexch_payload_too_large/);
});

test("holder percentages outside 0 to 100 remain explicit contradictions", async () => {
  const provider = new DexchDiscoveryProvider({
    now: () => NOW,
    fetchFn: async () => response({ data: [{
      address: "0x6a2878ddb92b1982f8a5e7326c486db73ba7c9dc",
      balance: 504_115_683,
      pct: 125.96,
      isCreator: false,
      isSniper: false,
    }] }),
  });
  const result = await provider.holders("robinhood", RH_TOKEN, { limit: 20 });
  assert.equal(result.schema_version, DEXCH_HOLDERS_SCHEMA);
  assert.equal(result.rows[0].supply_pct, null);
  assert.equal(result.coverage.complete_census, false);
  assert.equal(result.quality.state, "contradictory");
});

test("release runtime stays blocked until commercial-use rights are acknowledged", () => {
  assert.equal(resolveDexchDiscoveryRuntime({}).state, "disabled");
  assert.equal(resolveDexchDiscoveryRuntime({ RAVENOS_DEXCH_DISCOVERY_ENABLED: "1", RAVENOS_RELEASE_ENFORCE: "1" }).state, "blocked");
  const active = resolveDexchDiscoveryRuntime({
    RAVENOS_DEXCH_DISCOVERY_ENABLED: "1",
    RAVENOS_RELEASE_ENFORCE: "1",
    RAVENOS_DEXCH_COMMERCIAL_USE_ACKNOWLEDGED: "1",
  });
  assert.equal(active.runtime_allowed, true);
  assert.equal(active.execution_authority, false);
});
