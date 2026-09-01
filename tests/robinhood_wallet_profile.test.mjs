import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRobinhoodWalletEconomicEvent } from "../lib/customer_trade/robinhood_wallet_event_adapter.mjs";
import { buildRobinhoodWalletProfile } from "../lib/customer_trade/robinhood_wallet_profile.mjs";
import { createD1CustomerWalletCopyStore, ingestRobinhoodWalletEvents } from "../lib/customer_wallet_copy.mjs";

const ACTOR = `0x${"11".repeat(20)}`;
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const TARGET = `0x${"33".repeat(20)}`;

function coreEvent(index, { classification = "SWAP_BUY", providerState = "AGREED" } = {}) {
  const buy = classification === "SWAP_BUY";
  return {
    schema_version: "raven.robinhood.wallet-economic-event.v1",
    event_id: `rhre_${index.toString(16).padStart(40, "0")}`,
    chain: "robinhood",
    network: "mainnet",
    chain_id: 4663,
    state: "ECONOMIC_ACTOR_OBSERVED",
    classification,
    transaction_hash: `0x${index.toString(16).padStart(64, "0")}`,
    block_number: 51_753_546 + index,
    block_hash: `0x${(10_000 + index).toString(16).padStart(64, "0")}`,
    observed_finality: "confirmed",
    detected_at: new Date(Date.parse("2026-09-01T18:00:00.000Z") + index * 86_400_000).toISOString(),
    decoded_at: new Date(Date.parse("2026-09-01T18:00:00.125Z") + index * 86_400_000).toISOString(),
    provider_state: providerState,
    providers: providerState === "AGREED" ? ["alchemy_wss", "quicknode_wss"] : ["alchemy_wss"],
    economic_actor_identity: {
      wallet_id: `eip155:4663:${ACTOR}`,
      address: ACTOR,
      chain: "robinhood",
      network: "mainnet",
      basis: "transaction_submitter_with_opposing_net_asset_deltas",
      transaction_submitter_match: true,
      trace_participant: false,
      opposing_net_asset_deltas: true,
      protocol_event_role_used_as_identity: false,
    },
    wallet_controller_identity_claimed: false,
    asset_deltas: [
      {
        asset_id: `eip155:4663/erc20:${USDG}`,
        contract: USDG,
        token_standard: "erc20",
        delta_raw: buy ? "-500000000" : "487000000",
        direction: buy ? "out" : "in",
        settlement_asset: true,
        settlement_kind: "stablecoin",
        symbol: "USDG",
        canonical_usdc: false,
      },
      {
        asset_id: `eip155:4663/erc20:${TARGET}`,
        contract: TARGET,
        token_standard: "erc20",
        delta_raw: buy ? "25000000000" : "-25000000000",
        direction: buy ? "in" : "out",
        settlement_asset: false,
        settlement_kind: null,
        symbol: null,
        canonical_usdc: false,
      },
    ],
    transfer_log_count: 2,
    route_evidence: { reviewed_swap_log_count: 1, call_trace_available: false },
    settlement_truth: { canonical_usdc_observed: false, usdg_is_canonical_usdc: false },
    copy_signal: {
      state: "SOURCE_SIGNAL_READY_FOR_ROUTE_PROOF",
      independent_provider_confirmation_complete: providerState === "AGREED",
      entry_quote_proved: false,
      reverse_exit_proved: false,
      canonical_usdc_settlement_proved: false,
      shadow_decision_created: false,
      required_next_evidence: [
        ...(providerState === "AGREED" ? [] : ["independent_provider_confirmation"]),
        "current_exact_entry_quote",
        "current_reverse_liquidation_quote",
        "policy_evaluation",
        "route_simulation_where_supported",
      ],
    },
    provenance: {},
    execution_boundary: {
      live_copy: false,
      transaction_construction: false,
      signing: false,
      broadcasting: false,
      custody: false,
      fee_collection: false,
    },
  };
}

test("Robinhood profile exposes activity and confidence without fabricating P&L or cost basis", () => {
  const events = [
    normalizeRobinhoodWalletEconomicEvent(coreEvent(1)),
    normalizeRobinhoodWalletEconomicEvent(coreEvent(2, { classification: "SWAP_SELL" })),
    normalizeRobinhoodWalletEconomicEvent(coreEvent(3, { providerState: "SINGLE_PROVIDER" })),
  ];
  const profile = buildRobinhoodWalletProfile(events, { generated_at: "2026-09-05T00:00:00.000Z" });
  assert.equal(profile.source_wallet.chain, "robinhood");
  assert.equal(profile.behavior.trade_count, 3);
  assert.equal(profile.behavior.active_days, 3);
  assert.equal(profile.behavior.buy_count, 2);
  assert.equal(profile.behavior.sell_count, 1);
  assert.equal(profile.behavior.tokens_traded, 1);
  assert.equal(profile.coverage.known_cost_basis_pct, 0);
  assert.equal(profile.source_performance.state, "insufficient_evidence");
  assert.equal(profile.source_performance.realized_pnl_usdc, null);
  assert.equal(profile.source_performance.roi_pct, null);
  assert.equal(profile.copy_readiness.prospective_signals_observed, 2);
  assert.equal(profile.copy_readiness.independently_confirmed_signal_pct, 66.67);
  assert.equal(profile.copy_readiness.executable_copy_pct, null);
  assert.equal(profile.capital_observations.usdg.canonical_usdc, false);
  assert.equal(profile.evidence.unknown_cost_basis_is_zero, false);
  assert.equal(profile.evidence.live_execution_authorized, false);
  assert(Object.isFrozen(profile));
});

test("shared D1 event storage keeps Robinhood transaction and block identity out of Solana compatibility columns", async () => {
  const event = normalizeRobinhoodWalletEconomicEvent(coreEvent(7));
  const second = normalizeRobinhoodWalletEconomicEvent(coreEvent(8));
  const batches = [];
  const db = {
    prepare(sql) {
      return { bind(...bindings) { return { sql, bindings }; } };
    },
    async batch(statements) {
      batches.push(statements);
      return statements.map(() => ({ meta: { changes: 1 } }));
    },
  };
  const inserted = await createD1CustomerWalletCopyStore(db).recordEvents(event.source_wallet_id, [event, second], 1_788_739_200);
  assert.deepEqual(inserted, [event.event_id, second.event_id]);
  const stored = batches[0][0];
  assert.equal(stored.bindings[1], "ravenos.source_wallet_chain_event.v1");
  assert.equal(stored.bindings[3], "robinhood");
  assert.equal(stored.bindings[5], event.chain_evidence.transaction_reference);
  assert.equal(stored.bindings[6], null);
  assert.equal(stored.bindings[7], null);
  assert.equal(stored.bindings[9], event.chain_evidence.block_number);
  assert.equal(stored.bindings[10], event.chain_evidence.block_hash);
  assert.equal(batches[0][1].bindings[3], "alchemy_wss+quicknode_wss");
});

test("Robinhood profile rejects mixed wallets, duplicate observations, and unsupported events", () => {
  const event = normalizeRobinhoodWalletEconomicEvent(coreEvent(4));
  const other = structuredClone(event);
  other.source_wallet.address = `0x${"22".repeat(20)}`;
  assert.throws(() => buildRobinhoodWalletProfile([event, other]), /owner_mismatch/);
  assert.throws(() => buildRobinhoodWalletProfile([event, event]), /duplicate_event/);
  assert.throws(() => buildRobinhoodWalletProfile([{ schema_version: "other" }]), /events_invalid/);
});

test("Robinhood ingress reuses the shared wallet ledger and creates activity evidence, not a copy decision", async () => {
  const events = [
    normalizeRobinhoodWalletEconomicEvent(coreEvent(5)),
    normalizeRobinhoodWalletEconomicEvent(coreEvent(6, { classification: "SWAP_SELL" })),
  ];
  const retained = [];
  let source = null;
  let cursor = null;
  let profile = null;
  const store = {
    async upsertSourceWallet(input) { source = input; return input; },
    async recordEvents(sourceId, rows) {
      assert.equal(sourceId, rows[0].source_wallet_id);
      retained.push(...rows);
      return rows.map((row) => row.event_id);
    },
    async updateSourceCursor(_sourceId, input) { cursor = input; },
    async listSourceEvents() { return retained; },
    async latestProfile() { return profile; },
    async recordProfile(_sourceId, value) { profile = value; return `swp_${"f".repeat(40)}`; },
  };
  const result = await ingestRobinhoodWalletEvents({
    store,
    events,
    now: Math.floor(Date.parse("2026-09-08T00:00:00.000Z") / 1_000),
    history: { provider: "raven_core_robinhood", requested_transactions: 2 },
  });
  assert.equal(source.chain, "robinhood");
  assert.equal(source.chain_id, 4663);
  assert.equal(source.provider_scope, "bounded_robinhood_observer");
  assert.equal(cursor.last_signature, null);
  assert.equal(cursor.last_transaction_reference, events[1].chain_evidence.transaction_reference);
  assert.equal(cursor.last_block_number, events[1].chain_evidence.block_number);
  assert.equal(result.inserted_event_count, 2);
  assert.equal(result.profile.behavior.trade_count, 2);
  assert.equal(result.profile.source_performance.realized_pnl_usdc, null);
  assert.equal(result.shadow_decisions_created, 0);
  assert.equal(result.live_execution_authorized, false);
});

test("Robinhood ingress fails before persistence when chain evidence or the execution boundary is altered", async () => {
  const event = normalizeRobinhoodWalletEconomicEvent(coreEvent(9));
  const store = {
    async upsertSourceWallet() { throw new Error("must_not_persist"); },
    async recordEvents() { throw new Error("must_not_persist"); },
    async updateSourceCursor() { throw new Error("must_not_persist"); },
  };
  const malformedHash = structuredClone(event);
  malformedHash.chain_evidence.block_hash = `0x${"z".repeat(64)}`;
  await assert.rejects(
    ingestRobinhoodWalletEvents({ store, events: [malformedHash] }),
    /robinhood_wallet_ingress_identity_invalid/,
  );
  const signingEnabled = structuredClone(event);
  signingEnabled.execution_boundary.transaction_construction = true;
  await assert.rejects(
    ingestRobinhoodWalletEvents({ store, events: [signingEnabled] }),
    /robinhood_wallet_ingress_identity_invalid/,
  );
});
