import assert from "node:assert/strict";
import test from "node:test";

import {
  CanonicalUsdcRegistry,
  UniversalExecutionLifecycle,
  aggregateUniversalUsdcBuyingPower,
  canonicalUsdcForChain,
  classifyUsdcAsset,
  createRoundTripProof,
  createUniversalQuoteRequest,
  createUniversalShadowExecution,
  normalizeUniversalRouteCandidate,
  selectUniversalRouteCandidate,
} from "../lib/customer_trade/universal_shadow_execution.mjs";

const NOW = "2026-08-29T03:00:00.000Z";
const EXPIRY = "2026-08-29T03:00:20.000Z";
const TOKEN = "3w7NMJECsezNurAb3MbvTiEtVeayhqNXgXXcqiK5qwwj";
const SOURCE = `solana:mainnet:spl:${CanonicalUsdcRegistry.solana.address}`;
const DESTINATION = `solana:mainnet:spl:${TOKEN}`;

function request(amount = 500) {
  return createUniversalQuoteRequest({
    request_id: `request-${amount}`,
    requested_at: NOW,
    source_amount_usdc: amount,
    destination_asset: { chain: "solana", network: "mainnet", address: TOKEN, standard: "spl", exact_market_id: "solana:pool:exact-bitcat-pool", symbol: "BITCAT" },
    maximum_slippage_bps: 100,
  });
}

function route(overrides = {}) {
  return normalizeUniversalRouteCandidate({
    candidate_id: "jupiter-entry",
    provider: "jupiter",
    state: "route_available",
    source_chain: "solana",
    destination_chain: "solana",
    source_asset_id: SOURCE,
    destination_asset_id: DESTINATION,
    expected_output: 18_942,
    minimum_output: 18_800,
    costs_usdc: { network: 0.37, bridge: 0, provider: 0, raven: 0 },
    price_impact_bps: 32,
    estimated_settlement_ms: 800,
    transaction_count: 1,
    trust_dependencies: ["jupiter", "solana_rpc"],
    venues: ["Raydium"],
    intermediate_asset_ids: [],
    created_at: NOW,
    expires_at: EXPIRY,
    ...overrides,
  });
}

test("canonical USDC is address-bound and fake or bridged lookalikes never aggregate", () => {
  assert.equal(canonicalUsdcForChain("base").address, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  assert.equal(classifyUsdcAsset({ chain: "solana", address: CanonicalUsdcRegistry.solana.address }).canonical, true);
  assert.equal(classifyUsdcAsset({ chain: "base", address: "0x1111111111111111111111111111111111111111" }).state, "unrecognized_usdc_representation");
});

test("a universal request uses exact destination identity and never a ticker as authority", () => {
  const value = request(500);
  assert.equal(value.source_economic_asset, "canonical_usdc");
  assert.equal(value.funding_selection, "aggregate_routable_usdc");
  assert.equal(value.destination_asset.address, TOKEN);
  assert.equal(value.destination_asset.symbol, "BITCAT");
  assert.equal(value.destination_asset.exact_market_id, "solana:pool:exact-bitcat-pool");
  assert.equal(value.signing_requested, false);
  assert.equal(value.submission_requested, false);
});

test("route selection is deterministic and provider ordering cannot choose the winner", () => {
  const expensive = route({ candidate_id: "aaa", minimum_output: 18_700, costs_usdc: { network: 1, bridge: 1, provider: 1, raven: 0 } });
  const efficient = route({ candidate_id: "zzz", minimum_output: 18_900, costs_usdc: { network: 0.2, bridge: 0, provider: 0, raven: 0 } });
  assert.equal(selectUniversalRouteCandidate([expensive, efficient]).selected_candidate_id, "zzz");
  assert.equal(selectUniversalRouteCandidate([efficient, expensive]).selected_candidate_id, "zzz");
  const tiedA = route({ candidate_id: "a" });
  const tiedB = route({ candidate_id: "b" });
  assert.equal(selectUniversalRouteCandidate([tiedB, tiedA], "maximum_minimum_output").selected_candidate_id, "a");
});

test("one candidate with incomplete network cost is inspectable but not called friction-complete", () => {
  const incomplete = route({ costs_usdc: { network: null, bridge: 0, provider: 0, raven: 0 } });
  const selection = selectUniversalRouteCandidate([incomplete]);
  assert.equal(selection.state, "selected_for_shadow_review");
  assert.equal(selection.comparison_complete, false);
});

test("entry availability never becomes normal trade availability without a reverse route", () => {
  const entry = route();
  const exit = route({ candidate_id: "exit", state: "unavailable", source_asset_id: DESTINATION, destination_asset_id: SOURCE, expected_output: undefined, minimum_output: undefined, refusal_reasons: ["reverse_quote_unavailable"] });
  const proof = createRoundTripProof({ spend_usdc: 500, entry, exit, observed_at: NOW });
  assert.equal(proof.state, "exit_unresolved");
  assert.equal(proof.entry_quote_available, true);
  assert.equal(proof.exit_verified, false);
  assert.equal(proof.trade_available, false);
});

test("round-trip proof uses executable reverse USDC, not marked price", () => {
  const entry = route();
  const exit = route({ candidate_id: "jupiter-exit", source_asset_id: DESTINATION, destination_asset_id: SOURCE, expected_output: 491.72, minimum_output: 488.2, costs_usdc: { network: 0.31, bridge: 0, provider: 0, raven: 0 } });
  const proof = createRoundTripProof({ spend_usdc: 500, entry, exit, observed_at: NOW });
  assert.equal(proof.state, "exit_verified");
  assert.equal(proof.exit_verified, true);
  assert.equal(proof.current_executable_liquidation_usdc, 491.41);
  assert.equal(proof.marked_value_used_as_liquidation_value, false);
  assert.ok(proof.round_trip_friction_pct > 1.7 && proof.round_trip_friction_pct < 1.9);
});

test("a verified exit with unpriced network cost remains non-executable shadow evidence", () => {
  const entry = route({ costs_usdc: { network: null, bridge: 0, provider: 0, raven: 0 } });
  const exit = route({ candidate_id: "exit", source_asset_id: DESTINATION, destination_asset_id: SOURCE, expected_output: 492, minimum_output: 489, costs_usdc: { network: null, bridge: 0, provider: 0, raven: 0 } });
  const proof = createRoundTripProof({ spend_usdc: 500, entry, exit, observed_at: NOW });
  assert.equal(proof.state, "friction_incomplete");
  assert.equal(proof.exit_verified, true);
  assert.equal(proof.trade_available, false);
  assert.equal(proof.current_executable_liquidation_usdc, 492);
});

test("stale, unsafe, and malformed routes cannot win selection", () => {
  const stale = route({ candidate_id: "stale", state: "stale", expected_output: undefined, minimum_output: undefined });
  const unsafe = route({ candidate_id: "unsafe", state: "unsafe", expected_output: undefined, minimum_output: undefined });
  assert.equal(selectUniversalRouteCandidate([stale, unsafe]).state, "unavailable");
  assert.throws(() => route({ minimum_output: 20_000 }), /route_minimum_output_invalid/);
  assert.throws(() => route({ expires_at: NOW }), /route_expiry_invalid/);
});

test("buying power separates total, available, routable, stale, unavailable, and fake USDC", () => {
  const value = aggregateUniversalUsdcBuyingPower([
    { asset: { chain: "solana", address: CanonicalUsdcRegistry.solana.address }, amount_usdc: 500, state: "routable" },
    { asset: { chain: "base", address: CanonicalUsdcRegistry.base.address }, amount_usdc: 1_000, state: "available" },
    { asset: { chain: "ethereum", address: CanonicalUsdcRegistry.ethereum.address }, amount_usdc: 250, state: "stale" },
    { asset: { chain: "arbitrum", address: CanonicalUsdcRegistry.arbitrum.address }, amount_usdc: 70, state: "unavailable" },
    { asset: { chain: "base", address: "0x1111111111111111111111111111111111111111" }, amount_usdc: 9_999, state: "routable" },
  ], { observed_at: NOW });
  assert.equal(value.total_usdc, 1_820);
  assert.equal(value.available_usdc, 1_500);
  assert.equal(value.routable_usdc, 500);
  assert.equal(value.stale_usdc, 250);
  assert.equal(value.unavailable_usdc, 70);
  assert.equal(value.unrecognized_usdc_like_usdc, 9_999);
});

test("$10, $500, and $10,000 shadow requests preserve exact economic amounts", () => {
  assert.deepEqual([10, 500, 10_000].map((amount) => request(amount).source_amount_usdc), [10, 500, 10_000]);
});

test("provider disagreement is retained as candidates and resolved by explicit policy", () => {
  const relay = route({ candidate_id: "relay", provider: "relay", source_chain: "base", destination_chain: "solana", expected_output: 19_000, minimum_output: 18_950, transaction_count: 2, trust_dependencies: ["relay_solver", "bridge"] });
  const direct = route({ candidate_id: "direct", minimum_output: 18_700, transaction_count: 1, trust_dependencies: ["jupiter", "solana_rpc"] });
  assert.equal(selectUniversalRouteCandidate([relay, direct], "maximum_minimum_output").selected_candidate_id, "relay");
  assert.equal(selectUniversalRouteCandidate([relay, direct], "minimum_transaction_count").selected_candidate_id, "direct");
});

test("shadow plans cannot contain authorization, transaction material, signing, or submission", () => {
  const universalRequest = request(500);
  const entry = route();
  const exit = route({ candidate_id: "exit", source_asset_id: DESTINATION, destination_asset_id: SOURCE, expected_output: 491.72, minimum_output: 488.2 });
  const proof = createRoundTripProof({ spend_usdc: 500, entry, exit, observed_at: NOW });
  const selected = selectUniversalRouteCandidate([entry]);
  const plan = createUniversalShadowExecution({ request: universalRequest, candidates: [entry], selected, entry, exit, proof, observed_at: NOW });
  assert.equal(plan.mode, "shadow");
  assert.equal(plan.execution.allowed, false);
  assert.equal(plan.execution.signing_available, false);
  assert.equal(plan.execution.submission_available, false);
  assert.equal(plan.execution.transaction_material_available, false);
  assert.equal(JSON.stringify(plan).includes("serializedTransaction"), false);
});

test("future cross-chain settlement lifecycle distinguishes source confirmation from destination settlement", () => {
  assert.ok(UniversalExecutionLifecycle.indexOf("source_confirmed") < UniversalExecutionLifecycle.indexOf("destination_pending"));
  assert.ok(UniversalExecutionLifecycle.indexOf("destination_filled") < UniversalExecutionLifecycle.indexOf("settled"));
  assert.ok(UniversalExecutionLifecycle.includes("refund_pending"));
  assert.ok(UniversalExecutionLifecycle.includes("indeterminate"));
});
