import assert from "node:assert/strict";
import test from "node:test";

import {
  ROBINHOOD_TRADER_INTELLIGENCE_SCHEMA,
  buildRobinhoodClusteredActivity,
  buildRobinhoodLeadLagRelationships,
  buildRobinhoodTraderActivity,
  normalizeRobinhoodTraderIntelligenceQuery,
} from "../lib/customer_trade/robinhood_trader_intelligence.mjs";

const TOKEN_A = `0x${"aa".repeat(20)}`;
const TOKEN_B = `0x${"bb".repeat(20)}`;
const USDG = `0x${"cc".repeat(20)}`;

function sourceId(index) {
  return `sw_rh_${index.toString(16).padStart(40, "0")}`;
}

function event(index, {
  wallet = index,
  token = TOKEN_A,
  kind = "SWAP_BUY",
  at = `2026-09-04T12:${String(index).padStart(2, "0")}:00.000Z`,
  confirmed = true,
} = {}) {
  const buy = kind === "SWAP_BUY";
  const address = `0x${wallet.toString(16).padStart(40, "0")}`;
  const settlement = {
    asset_id: `eip155:4663/erc20:${USDG}`,
    contract: USDG,
    token_standard: "erc20",
    delta_base_units: buy ? "-1000000" : "900000",
    direction: buy ? "out" : "in",
    settlement_asset: true,
    settlement_kind: "stablecoin",
    symbol: "USDG",
    canonical_usdc: false,
  };
  const risk = {
    asset_id: `eip155:4663/erc20:${token}`,
    contract: token,
    token_standard: "erc20",
    delta_base_units: buy ? "1000000000000000000" : "-1000000000000000000",
    direction: buy ? "in" : "out",
    settlement_asset: false,
    settlement_kind: null,
    symbol: null,
    canonical_usdc: false,
  };
  return {
    schema_version: "ravenos.source_wallet_chain_event.v1",
    event_id: `swe_${index.toString(16).padStart(40, "0")}`,
    source_wallet_id: sourceId(wallet),
    source_wallet: { chain: "robinhood", network: "mainnet", chain_id: 4663, vm_family: "evm", address },
    classification: { kind, observed: true, confidence: confirmed ? "exact_net_deltas_independently_confirmed" : "exact_net_deltas_single_provider", ambiguous: false },
    timing: { detected_at: at, decoded_at: at, decode_latency_ms: 25 },
    economic: {
      source_assets: buy ? [settlement] : [risk],
      destination_assets: buy ? [risk] : [settlement],
      cost_basis_state: "prospective_source_event_only",
    },
    chain_evidence: {
      transaction_reference: `0x${index.toString(16).padStart(64, "0")}`,
      block_number: 52_000_000 + index,
      block_hash: `0x${(10_000 + index).toString(16).padStart(64, "0")}`,
      finality: "confirmed",
      providers: confirmed ? ["alchemy_wss", "quicknode_wss"] : ["alchemy_wss"],
      independent_provider_confirmation_complete: confirmed,
    },
    copy_signal: {
      state: confirmed ? "ROUTE_PROOF_REQUIRED" : "PROVIDER_CONFIRMATION_REQUIRED",
      source_signal_ready: confirmed,
      entry_quote_proved: false,
      reverse_exit_proved: false,
    },
    evidence_hash: index.toString(16).padStart(40, "f").slice(-40),
  };
}

test("Robinhood activity is bounded, exact-contract keyed, and never invents USD size", () => {
  const query = normalizeRobinhoodTraderIntelligenceQuery("hours=24&action=buy&limit=2&min_confidence=80", {
    now: "2026-09-04T13:00:00.000Z",
  });
  const duplicate = event(3, { wallet: 3 });
  const result = buildRobinhoodTraderActivity([
    { event: event(1, { wallet: 1 }), profile_reconstruction_confidence_pct: 95 },
    { event: event(2, { wallet: 2, kind: "SWAP_SELL" }), profile_reconstruction_confidence_pct: 99 },
    { event: duplicate, profile_reconstruction_confidence_pct: 90 },
    { event: duplicate, profile_reconstruction_confidence_pct: 90 },
    { event: event(4, { wallet: 4 }), profile_reconstruction_confidence_pct: 50 },
  ], query);
  assert.equal(result.schema_version, ROBINHOOD_TRADER_INTELLIGENCE_SCHEMA);
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].token.asset_id, `eip155:4663/erc20:${TOKEN_A}`);
  assert.equal(result.events[0].size.usd, null);
  assert.equal(result.events[0].size.state, "unavailable_without_verified_decimals_and_price_evidence");
  assert.equal(result.events[0].trader.controller_identity_claimed, false);
  assert.equal(result.events[0].execution_authorized, false);
  assert.equal(result.scope.global_chain_completeness_claimed, false);
  assert(Object.isFrozen(result));
});

test("clustered activity requires distinct wallets and never implies coordination", () => {
  const query = normalizeRobinhoodTraderIntelligenceQuery("hours=24&limit=100&min_wallets=2", {
    now: "2026-09-04T13:00:00.000Z",
  });
  const activity = buildRobinhoodTraderActivity([
    { event: event(1, { wallet: 1 }), profile_reconstruction_confidence_pct: 95 },
    { event: event(2, { wallet: 2 }), profile_reconstruction_confidence_pct: 85 },
    { event: event(3, { wallet: 1 }), profile_reconstruction_confidence_pct: 95 },
    { event: event(4, { wallet: 4, token: TOKEN_B }), profile_reconstruction_confidence_pct: 90 },
  ], query);
  const clusters = buildRobinhoodClusteredActivity(activity, query);
  assert.equal(clusters.clusters.length, 1);
  assert.equal(clusters.clusters[0].qualifying_wallet_count, 2);
  assert.equal(clusters.clusters[0].observable_combined_notional_usd, null);
  assert.equal(clusters.clusters[0].coordination_claimed, false);
  assert.match(clusters.definition, /does not imply coordination/i);
});

test("lead/lag aggregates repeated token ordering without calling it copying", () => {
  const query = normalizeRobinhoodTraderIntelligenceQuery("hours=24&limit=100&min_shared_entries=2&maximum_lag_seconds=300", {
    now: "2026-09-04T13:00:00.000Z",
  });
  const activity = buildRobinhoodTraderActivity([
    { event: event(1, { wallet: 1, token: TOKEN_A, at: "2026-09-04T12:00:00.000Z" }), profile_reconstruction_confidence_pct: 95 },
    { event: event(2, { wallet: 2, token: TOKEN_A, at: "2026-09-04T12:00:20.000Z" }), profile_reconstruction_confidence_pct: 90 },
    { event: event(3, { wallet: 1, token: TOKEN_B, at: "2026-09-04T12:10:00.000Z" }), profile_reconstruction_confidence_pct: 95 },
    { event: event(4, { wallet: 2, token: TOKEN_B, at: "2026-09-04T12:10:40.000Z" }), profile_reconstruction_confidence_pct: 90 },
  ], query);
  const relationships = buildRobinhoodLeadLagRelationships(activity, query);
  assert.equal(relationships.relationships.length, 1);
  assert.equal(relationships.relationships[0].leading_wallet, `0x${"1".padStart(40, "0")}`);
  assert.equal(relationships.relationships[0].following_wallet, `0x${"2".padStart(40, "0")}`);
  assert.equal(relationships.relationships[0].shared_entry_count, 2);
  assert.equal(relationships.relationships[0].independent_token_sample, 2);
  assert.equal(relationships.relationships[0].lead_rate_pct, 100);
  assert.equal(relationships.relationships[0].median_lead_seconds, 30);
  assert.equal(relationships.relationships[0].copy_relationship_claimed, false);
});

test("query validation rejects unbounded and unknown controls", () => {
  assert.throws(() => normalizeRobinhoodTraderIntelligenceQuery("hours=999999"), /robinhood_trader_hours_invalid/);
  assert.throws(() => normalizeRobinhoodTraderIntelligenceQuery("action=copy"), /robinhood_trader_action_invalid/);
  assert.throws(() => normalizeRobinhoodTraderIntelligenceQuery("wallet=0x00"), /robinhood_trader_query_invalid/);
});
