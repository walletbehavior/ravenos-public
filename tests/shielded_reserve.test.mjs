import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SHIELDED_FLAGS, SHIELDED_BOUNDARY, createShieldedIntent, shieldedCapabilities, decimalMicrosFloor, valueZec, usdToUsdcEquivalent, shieldedPrivacyEvidence, simulatePrivacyDelay, publicShieldedProjection, shadowExcessReturn, assertNoShieldedSecrets } from "../lib/customer_trade/shielded_reserve.mjs";
import { NearIntentsShieldedProvider, SHIELDED_ASSETS, SHIELDED_RESEARCH_ADDRESSES, resolveShieldedAsset, compareShieldedProviders } from "../lib/customer_trade/shielded_route_providers.mjs";
import { reserveObservation, appendShadowCapitalTransition, projectShadowCapitalTransitions, RESERVE_VENUE } from "../lib/customer_trade/shielded_portfolio.mjs";
import { evaluateShieldedCopyCapital } from "../lib/customer_trade/wallet_copy.mjs";
import { createUnifiedPortfolioSnapshot, inspectLocalCapital } from "../lib/agentic_trading/unified_portfolio.mjs";
import { normalizeAssetIdentity, normalizeVenueIdentity } from "../lib/agentic_trading/identity.mjs";
import { appendResearchRecord } from "../scripts/research-shielded-reserve.mjs";

const NOW = Date.parse("2026-09-07T04:00:00Z"), DATE = new Date(NOW).toISOString();
const env = Object.fromEntries(SHIELDED_FLAGS.map(k => [k, "1"]));
const catalog = Object.values(SHIELDED_ASSETS).map(a => ({ assetId: a.id, decimals: a.decimals, blockchain: a.chain, symbol: a.symbol, contractAddress: a.contract, price: a.symbol === "ZEC" ? "100" : "1", priceUpdatedAt: DATE }));
const intent = (extra = {}) => createShieldedIntent({ action: "SHIELDED_DEPLOY", source: "zec", destination: "solana_usdc", amount_atomic: "100000000", expires_at: new Date(NOW + 60000).toISOString(), ...extra }, { now: NOW });
const bodyFor = request => ({ quoteRequest: { ...request, appFees: [{ recipient: "provider", fee: 10 }] },
  quote: { amountIn: request.amount, amountOut: "99000000", minAmountOut: "98010000", amountInUsd: "100.000000000000", amountOutUsd: "99.000000000000", timeEstimate: 452, withdrawFee: "1000", refundFee: "32000" }, timestamp: DATE, signature: "fixture-not-real" });
const fake = (mutate = value => value, options = {}) => new NearIntentsShieldedProvider({ env, now: () => NOW, verifySignature: () => true, fetchImpl: async (url, init) => {
  assert.equal(url, "https://1click.chaindefuser.com/v0/quote");
  const req = JSON.parse(init.body); assert.equal(req.dry, true); assert.equal(init.redirect, "manual");
  assert.equal(req.refundTo, SHIELDED_RESEARCH_ADDRESSES[SHIELDED_ASSETS[req.originAsset === SHIELDED_ASSETS.zec.id ? "zec" : "solana_usdc"].chain]);
  return Response.json(mutate(bodyFor(req)), { status: 201 });
}, ...options });

test("all flags default off and cannot enable live execution", () => {
  assert.equal(shieldedCapabilities().enabled, false);
  assert.equal(shieldedCapabilities({ ...env, LIVE_SHIELDED_EXECUTION_ENABLED: "1" }).LIVE_SHIELDED_EXECUTION_ENABLED, false);
  assert.equal(SHIELDED_BOUNDARY.submission_enabled, false);
});
test("default transport preserves the native Workers fetch receiver for catalog and quotes", async (t) => {
  const methods = [];
  t.mock.method(globalThis, "fetch", async function (url, init) {
    assert.equal(this, globalThis, "Workers rejects fetch bound to the provider instance");
    assert.equal(init.redirect, "manual", "Workers does not support redirect: error");
    methods.push(init.method);
    if (url.endsWith("/tokens")) return Response.json(catalog);
    assert.equal(url, "https://1click.chaindefuser.com/v0/quote");
    const request = JSON.parse(init.body);
    assert.equal(request.dry, true);
    return Response.json(bodyFor(request), { status: 201 });
  });
  const provider = new NearIntentsShieldedProvider({ env, now: () => NOW, verifySignature: () => true });
  const tokens = await provider.tokens();
  assert.equal(tokens.length, catalog.length);
  assert.equal((await provider.quote(intent(), tokens)).available, true);
  assert.deepEqual(methods, ["GET", "POST"]);
});
test("provider redirects fail closed without following or parsing their bodies", async () => {
  const calls = [];
  const provider = new NearIntentsShieldedProvider({ env, now: () => NOW, fetchImpl: async (url, init) => {
    calls.push(url);
    assert.equal(init.redirect, "manual");
    return new Response("Redirecting", { status: 302, headers: { location: "https://untrusted.invalid/" } });
  } });
  await assert.rejects(provider.tokens(), /provider_catalog_unavailable/);
  const quote = await provider.quote(intent(), catalog);
  assert.equal(quote.available, false);
  assert.equal(quote.http_status, 302);
  assert.equal(calls.length, 2);
  assert(calls.every(url => url.startsWith("https://1click.chaindefuser.com/")));
});
test("every master or action flag fails closed before provider I/O", async () => {
  for (const key of ["ZCASH_ENABLED", "SHIELDED_RESERVE_ENABLED", "SHIELDED_ROUTE_QUOTES_ENABLED", "SHIELDED_DEPLOY_ENABLED"]) {
    let calls = 0; const p = fake(undefined, { env: { ...env, [key]: "0" }, fetchImpl: async () => { calls++; throw Error(); } });
    assert.equal((await p.quote(intent(), catalog)).available, false); assert.equal(calls, 0);
  }
});
test("precise ZEC valuation supports arbitrary integer magnitude", () => {
  assert.equal(valueZec("123456789", "123456789"), "152415787");
  assert.equal(valueZec("10000000000000000", "100000000"), "10000000000000000");
});
test("ZEC price movement changes reserve value, USDC FX is explicit", () => {
  assert.equal(valueZec("100000000", "120000000"), "120000000");
  assert.equal(usdToUsdcEquivalent("120000000", "960000"), "125000000");
});
test("USD truncation floors micros without floating arithmetic", () => {
  assert.equal(decimalMicrosFloor("0.000000999"), "0");
  assert.equal(decimalMicrosFloor("9007199254740993.123456789"), "9007199254740993123456");
  assert.throws(() => decimalMicrosFloor("1e6"));
});
test("intent rejects expired, wrong-direction, negative and excess-delay requests", () => {
  assert.throws(() => intent({ expires_at: DATE }));
  assert.throws(() => intent({ source: "solana_usdc" }));
  assert.throws(() => intent({ amount_atomic: "-1" }));
  assert.throws(() => intent({ maximum_delay_seconds: -1 }));
});
test("shielded-only address evidence comes from fixture, not prefix inference", () => {
  assert.match(SHIELDED_RESEARCH_ADDRESSES.zec, /^u1/);
  assert.equal(intent().destination_policy, "public_research_fixture_only");
  assert.equal("destination_wallet" in intent({ destination_wallet: "attacker" }), false);
});
test("forward quote normalizes confirmed read-only API response", async () => {
  const q = await fake().quote(intent(), catalog);
  assert.equal(q.available, true); assert.equal(q.minimum_output_atomic, "98010000");
  assert.equal(q.input_usd_micros, "100000000"); assert.equal(q.all_in_marked_friction_ppm, "10000");
  assert.equal(q.boundary.signing_enabled, false); assert.equal(q.fee_components.raven_fee_bps, 0);
});
test("Portfolio reserve movements never add a Raven fee, including caller overrides", async () => {
  for (const direction of [{}, { action: "SHIELDED_RETURN", source: "solana_usdc", destination: "zec" }]) {
    const q = await fake(undefined, { fetchImpl: async (url, init) => {
      const request = JSON.parse(init.body);
      assert.equal(Object.hasOwn(request, "appFees"), false);
      assert.equal(request.dry, true);
      return Response.json(bodyFor(request));
    } }).quote(intent({ ...direction, raven_fee_bps: 100, fee_recipient: "ignored.near" }), catalog);
    assert.equal(q.available, true);
    assert.equal(q.fee_components.raven_fee_bps, 0);
    assert.equal(q.fee_components.provider_injected_app_fee_bps, 10);
    assert.equal(q.boundary.native_execution_fee_applies, false);
    assert.equal(q.boundary.cashback_eligible, false);
  }
});
test("reverse quote keeps direct shielded destination unverified until settlement", async () => {
  const q = await fake().quote(intent({ action: "SHIELDED_RETURN", source: "solana_usdc", destination: "zec" }), catalog);
  assert.equal(q.available, true); assert.equal(q.privacy.quote_capability, "SHIELDED_DESTINATION_QUOTE_SUPPORTED");
  assert.equal(q.privacy.destination_shield_proven, false);
});
test("send uses exact output and source spend remains quoted", async () => {
  const q = await fake(body => { body.quote.amountIn = "110000000"; body.quote.amountOut = body.quoteRequest.amount; body.quote.minAmountOut = body.quoteRequest.amount; return body; }).quote(intent({ action: "SHIELDED_SEND" }), catalog);
  assert.equal(q.available, true); assert.equal(q.amount_in_atomic, "110000000");
});
for (const destination of ["robinhood_usdc", "solana_fakecoin"]) test(`unsupported route ${destination} is unavailable`, async () => {
  assert.equal((await fake().quote(intent({ destination }), catalog)).reason, "unsupported_chain_or_asset");
});
test("wrapped ZEC or bridged USDC cannot impersonate canonical assets", () => {
  assert.equal(resolveShieldedAsset(catalog.map(t => t.symbol === "ZEC" ? { ...t, blockchain: "sol" } : t), "zec"), null);
  assert.equal(resolveShieldedAsset(catalog.map(t => t.assetId === SHIELDED_ASSETS.solana_usdc.id ? { ...t, contractAddress: "USDC.e" } : t), "solana_usdc"), null);
});
test("provider failure never echoes sensitive provider text", async () => {
  const q = await fake(undefined, { fetchImpl: async () => { throw Error("privateKey=do-not-log"); } }).quote(intent(), catalog);
  assert.equal(q.available, false); assert.doesNotMatch(JSON.stringify(q), /do-not-log/);
});
test("quote mismatch or a deposit address fails closed", async () => {
  for (const mutate of [b => { b.quoteRequest.dry = false; }, b => { b.quote.depositAddress = "deposit"; }, b => { b.quote.amountIn = "1"; }]) {
    assert.equal((await fake(b => { mutate(b); return b; }).quote(intent(), catalog)).available, false);
  }
});
test("forged signature and old signed quote are unavailable", async () => {
  assert.equal((await fake(undefined, { verifySignature: () => false }).quote(intent(), catalog)).reason, "provider_signature_invalid");
  assert.equal((await fake(b => ({ ...b, timestamp: "2020-01-01" })).quote(intent(), catalog)).reason, "provider_quote_stale");
});
test("expired intent, stale prices, and unknown valuation are unavailable", async () => {
  assert.equal((await fake(undefined, { now: () => NOW + 60001 }).quote(intent(), catalog)).reason, "intent_expired");
  assert.equal((await fake().quote(intent(), catalog.map(t => ({ ...t, priceUpdatedAt: "2020-01-01" })))).reason, "price_stale_or_unavailable");
  assert.equal((await fake(b => { b.quote.amountInUsd = "unknown"; return b; }).quote(intent(), catalog)).available, false);
});
test("minimum receive, delay and friction limits block an otherwise valid quote", async () => {
  for (const extra of [{ minimum_receive_atomic: "99000000" }, { maximum_delay_seconds: 1 }, { maximum_friction_bps: 1 }]) assert.equal((await fake().quote(intent(extra), catalog)).available, false);
});
test("unknown solver and gross fee decomposition stay unknown", async () => {
  const q = await fake().quote(intent(), catalog);
  assert.equal(q.solver, null); assert.equal(q.fee_components.solver_fee, null); assert.equal(q.gross_output_before_fees, null);
  assert.equal(q.provider_quote_expiry, null); assert.equal(q.refund.guaranteed, false);
});
test("unknown evidence cannot become a shielded privacy promise", () => {
  const p = shieldedPrivacyEvidence("SHIELDED_DEPLOY");
  assert.equal(p.classification, "UNKNOWN"); assert.equal(p.source_shield_proven, false); assert.equal(p.provider_sees_destination, "unknown");
});
test("public destination, amount/timing risk and provider exposure are disclosed", async () => {
  const { privacy } = await fake().quote(intent(), catalog);
  assert.equal(privacy.destination_public, true); assert.equal(privacy.provider_sees_destination, true);
  assert.equal(privacy.final_tx_public, true); assert.equal(privacy.timing_correlation_risk, "high"); assert.equal(privacy.amount_correlation_risk, "high");
});
test("privacy delay simulation does not lower risk or schedule transactions", () => {
  assert.equal(simulatePrivacyDelay(300).privacy_improvement_proven, false);
  assert.equal(simulatePrivacyDelay(30).scheduling_enabled, false); assert.throws(() => simulatePrivacyDelay("random"));
});
test("provider-neutral comparison isolates unavailable alternatives", async () => {
  const routes = await compareShieldedProviders([fake(), { id: "zwap", quote: async () => { throw Error("no_api"); } }], intent(), catalog);
  assert.equal(routes[0].available, true); assert.equal(routes[1].available, false);
});
test("key material is rejected recursively rather than logged or forwarded", () => {
  for (const value of [{ viewing_key: "x" }, { nested: { seed: "x" } }, { note: "uview1-secret" }]) assert.throws(() => assertNoShieldedSecrets(value), /sensitive_wallet_material_rejected/);
});
test("Community projection never exports wallet, key, balance or reward details", () => {
  assert.deepEqual(publicShieldedProjection({ balance: "100", address: "u1" }), { total_capital: "private", shielded_balance: "private", performance_verification: "not_implemented" });
});
test("research journal appends history and detects tampering", () => {
  const dir = mkdtempSync(join(tmpdir(), "raven-shielded-"));
  try { const path = join(dir, "rows.jsonl"); const first = appendResearchRecord(path, { id: "a" }); const bytes = readFileSync(path, "utf8");
    const second = appendResearchRecord(path, { id: "b" }); assert.equal(second.previous_hash, first.record_hash); assert.ok(readFileSync(path, "utf8").startsWith(bytes));
    appendFileSync(path, '{"id":"tampered"}\n'); assert.throws(() => appendResearchRecord(path, { id: "c" }));
  } finally { rmSync(dir, { recursive: true }); }
});

const usdc = normalizeAssetIdentity({ chain_id: "solana", kind: "stablecoin", standard: "spl", reference: SHIELDED_ASSETS.solana_usdc.contract, symbol: "USDC", decimals: 6, representation: "canonical", issuer_id: "circle" });
const venue = normalizeVenueIdentity({ slug: "wallet-observer", chain_id: "solana", kind: "chain_observer", environment: "mainnet" });
const reserve = () => reserveObservation({ account_id: "reserve", observation_id: "s0", economic_lot_id: "reserve-lot", observed_at: DATE, quantity_zatoshis: "1000000000", zec_price_usd_micros: "100000000", usdc_price_usd_micros: "1000000" });
const portfolio = () => ({ snapshot_id: "portfolio", owner_tenant_id: "user-a", observed_at: DATE,
  accounts: [reserve().account, { account_id: "hot", chain_id: "solana", venue, provider: "fixture", observed_at: DATE }],
  balances: [reserve().balance, { account_id: "hot", observation_id: "h0", economic_lot_id: "hot-lot", asset: usdc, venue_id: venue.venue_id, observed_at: DATE,
    capital_compartment: "public", quantity_atomic: "200000000", available_atomic: "200000000", state: "available", marked_value_usdc_micros: "200000000", executable_value_usdc_micros: "200000000", valuation_state: "executable" }] });

test("reserve is distinct from ready buying power in real Portfolio aggregation", () => {
  const p = createUnifiedPortfolioSnapshot(portfolio());
  assert.equal(p.valuation.marked_assets_usdc_micros, "1200000000");
  assert.equal(p.valuation.executable_assets_usdc_micros, "200000000");
  assert.equal(p.capital_compartments.shielded.marked_value_usdc_micros, "1000000000");
  assert.notEqual(inspectLocalCapital(p, { chain_id: "zcash:mainnet", venue_id: RESERVE_VENUE.venue_id, asset_id: reserve().balance.asset.asset_id, required_atomic: "1" }).result, "allow");
});
test("shielded compartment overrides falsely advertised available/executable amounts", () => {
  const input = portfolio(); input.balances[0].state = "available"; input.balances[0].available_atomic = "1000000000"; input.balances[0].executable_value_usdc_micros = "1000000000";
  assert.equal(createUnifiedPortfolioSnapshot(input).valuation.executable_assets_usdc_micros, "200000000");
});
test("unknown shielded balance remains unknown, never a fabricated zero", () => {
  const input = portfolio(); input.balances[0] = reserveObservation({ account_id: "reserve", observation_id: "s0", economic_lot_id: "reserve-lot", observed_at: DATE }).balance;
  assert.equal(createUnifiedPortfolioSnapshot(input).capital_compartments.shielded.marked_value_usdc_micros, null);
});
for (const from of ["public", "shielded"]) test(`no double counting during ${from === "public" ? "return" : "deployment"}`, () => {
  const input = portfolio(), lot = from === "public" ? "hot-lot" : "reserve-lot";
  const history = appendShadowCapitalTransition([], { id: "sent", economic_lot_id: lot, from, to: "in_transit", observed_at: new Date(NOW + 1000).toISOString() });
  const p = projectShadowCapitalTransitions(input, [history]);
  assert.equal(p.valuation.marked_assets_usdc_micros, "1200000000");
  assert.equal(p.balance_components.filter(b => b.economic_lot_id === lot).length, 1);
  assert.equal(p.balance_components.find(b => b.economic_lot_id === lot).capital_compartment, "in_transit");
});
test("unresolved destination cannot be restored to available capital by timeout", () => {
  const first = appendShadowCapitalTransition([], { id: "sent", economic_lot_id: "reserve-lot", from: "shielded", to: "in_transit", observed_at: new Date(NOW + 1000).toISOString() });
  const unresolved = appendShadowCapitalTransition(first, { id: "timeout", economic_lot_id: "reserve-lot", from: "in_transit", to: "unresolved", observed_at: new Date(NOW + 2000).toISOString() });
  const p = projectShadowCapitalTransitions(portfolio(), [unresolved]);
  assert.equal(p.capital_compartments.unresolved.marked_value_usdc_micros, "1000000000");
  assert.throws(() => appendShadowCapitalTransition(unresolved, { id: "fake", economic_lot_id: "reserve-lot", from: "unresolved", to: "public", observed_at: new Date(NOW + 3000).toISOString() }), /destination_observation_required/);
  assert.equal(first.length, 1);
});
test("Copy cannot treat a reserve as prepositioned capital", () => {
  const p = createUnifiedPortfolioSnapshot(portfolio());
  const result = evaluateShieldedCopyCapital(p, { location: { chain_id: usdc.chain_id, venue_id: venue.venue_id, asset_id: usdc.asset_id }, required_atomic: "500000000", maximum_latency_ms: 1000, deployment_estimate_seconds: 452 });
  assert.equal(result.ready, false); assert.equal(result.reason, "SHIELDED_DEPLOYMENT_TOO_SLOW_FOR_STRATEGY");
  assert.equal(result.shielded_satisfies_hot_reserve, false);
});
test("existing public working capital remains usable without reserve permission", () => {
  const result = evaluateShieldedCopyCapital(createUnifiedPortfolioSnapshot(portfolio()), { location: { chain_id: usdc.chain_id, venue_id: venue.venue_id, asset_id: usdc.asset_id }, required_atomic: "100000000", maximum_latency_ms: 1000 });
  assert.equal(result.ready, true);
});
test("shadow profit sweep cannot exceed working-capital excess", () => {
  assert.equal(shadowExcessReturn("13200000000", "10000000000").excess_atomic, "3200000000");
  assert.equal(shadowExcessReturn("1", "2").excess_atomic, "0"); assert.equal(shadowExcessReturn("1", "0").auto_execute, false);
});
test("research fees exclude native trading and cashback economics", async () => {
  const q = await fake().quote(intent(), catalog);
  assert.deepEqual(q.hypothetical_fees.map(s => s.raven_fee_bps), [0,10,25,50,100]);
  assert.equal(q.boundary.native_execution_fee_applies, false); assert.equal(q.boundary.cashback_eligible, false);
});
