import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createSourceWalletId,
  normalizeSourceWalletChainIdentity,
  normalizeSourceWalletTransactionReference,
} from "../lib/customer_trade/source_wallet_chain_identity.mjs";
import {
  SOURCE_WALLET_CHAIN_EVENT_SCHEMA,
  normalizeRobinhoodWalletEconomicEvent,
} from "../lib/customer_trade/robinhood_wallet_event_adapter.mjs";

const ACTOR = `0x${"11".repeat(20)}`;
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const TARGET = `0x${"33".repeat(20)}`;
const TX_HASH = `0x${"ab".repeat(32)}`;
const BLOCK_HASH = `0x${"cd".repeat(32)}`;
const SOLANA_WALLET = "8qbHbw2BbbTHBW1sbeqakYXVg96g6TosPzLJjTQ2pYvV";

function digest(parts) {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40);
}

function coreEvent({ providerState = "AGREED", providers = ["alchemy_wss", "quicknode_wss"] } = {}) {
  const confirmed = providerState === "AGREED";
  return {
    schema_version: "raven.robinhood.wallet-economic-event.v1",
    event_id: `rhre_${"e".repeat(40)}`,
    chain: "robinhood",
    network: "mainnet",
    chain_id: 4663,
    state: "ECONOMIC_ACTOR_OBSERVED",
    classification: "SWAP_BUY",
    transaction_hash: TX_HASH,
    block_number: 51_753_546,
    block_hash: BLOCK_HASH,
    observed_finality: "confirmed",
    detected_at: "2026-09-01T18:00:00.000Z",
    decoded_at: "2026-09-01T18:00:00.125Z",
    provider_state: providerState,
    providers,
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
        delta_raw: "-500000000",
        direction: "out",
        settlement_asset: true,
        settlement_kind: "stablecoin",
        symbol: "USDG",
        canonical_usdc: false,
      },
      {
        asset_id: `eip155:4663/erc20:${TARGET}`,
        contract: TARGET,
        token_standard: "erc20",
        delta_raw: "25000000000",
        direction: "in",
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
      reason: confirmed
        ? "economic_actor_and_swap_economics_observed"
        : "economic_actor_observed_independent_provider_confirmation_pending",
      independent_provider_confirmation_complete: confirmed,
      entry_quote_proved: false,
      reverse_exit_proved: false,
      canonical_usdc_settlement_proved: false,
      shadow_decision_created: false,
      required_next_evidence: [
        ...(!confirmed ? ["independent_provider_confirmation"] : []),
        "current_exact_entry_quote",
        "current_reverse_liquidation_quote",
        "policy_evaluation",
        "route_simulation_where_supported",
      ],
    },
    provenance: {
      observation: "receipt_and_optional_trace_reconstruction",
      expected_output_claimed_as_fill: false,
    },
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

test("chain identity preserves existing Solana IDs and gives Robinhood an explicit namespace", () => {
  const solana = normalizeSourceWalletChainIdentity({
    chain: "solana",
    network: "mainnet",
    address: SOLANA_WALLET,
  });
  assert.equal(solana.source_wallet_id, `sw_sol_${digest(["solana", "mainnet", SOLANA_WALLET])}`);
  assert.equal(solana.vm_family, "svm");

  const robinhood = normalizeSourceWalletChainIdentity({
    chain: "robinhood",
    network: "mainnet",
    chain_id: 4663,
    address: ACTOR.toUpperCase().replace("0X", "0x"),
  });
  assert.equal(robinhood.address, ACTOR);
  assert.equal(robinhood.source_wallet_id, `sw_rh_${digest(["robinhood", "mainnet", ACTOR])}`);
  assert.equal(robinhood.chain_id, 4663);
  assert.equal(robinhood.vm_family, "evm");
  assert.equal(robinhood.controller_identity_claimed, false);
});

test("identity and transaction references reject ticker-like, wrong-chain, and malformed values", () => {
  assert.throws(
    () => normalizeSourceWalletChainIdentity({ chain: "robinhood", network: "mainnet", chain_id: 1, address: ACTOR }),
    /source_wallet_chain_id_mismatch/,
  );
  assert.throws(
    () => normalizeSourceWalletChainIdentity({ chain: "robinhood", network: "testnet", address: ACTOR }),
    /source_wallet_network_unsupported/,
  );
  assert.throws(
    () => normalizeSourceWalletChainIdentity({ chain: "robinhood", network: "mainnet", address: "USDC" }),
    /source_wallet_address_invalid/,
  );
  assert.equal(
    normalizeSourceWalletTransactionReference({ chain: "robinhood", transaction_reference: TX_HASH.toUpperCase().replace("0X", "0x") }),
    TX_HASH,
  );
  assert.throws(
    () => normalizeSourceWalletTransactionReference({ chain: "robinhood", transaction_reference: "0x1" }),
    /source_wallet_transaction_reference_invalid/,
  );
});

test("independently confirmed Robinhood buy becomes a route-proof candidate, never an execution claim", () => {
  const event = normalizeRobinhoodWalletEconomicEvent(coreEvent());
  assert.equal(event.schema_version, SOURCE_WALLET_CHAIN_EVENT_SCHEMA);
  assert.equal(event.source_wallet_id, createSourceWalletId({ chain: "robinhood", network: "mainnet", address: ACTOR }));
  assert.equal(event.chain_evidence.transaction_reference, TX_HASH);
  assert.equal(event.chain_evidence.provider_state, "AGREED");
  assert.equal(event.chain_evidence.independent_provider_confirmation_complete, true);
  assert.equal(event.classification.kind, "SWAP_BUY");
  assert.equal(event.copy_signal.state, "ROUTE_PROOF_REQUIRED");
  assert.equal(event.copy_signal.source_signal_ready, true);
  assert.equal(event.copy_signal.eligible_buy_signal, true);
  assert.equal(event.copy_signal.entry_quote_proved, false);
  assert.equal(event.copy_signal.reverse_exit_proved, false);
  assert.equal(event.economic.canonical_usdc_observed, false);
  assert.equal(event.execution_boundary.live_copy, false);
  assert.equal(event.execution_boundary.signing, false);
  assert(Object.isFrozen(event));
});

test("single-provider Robinhood evidence remains research-only pending confirmation", () => {
  const event = normalizeRobinhoodWalletEconomicEvent(coreEvent({
    providerState: "SINGLE_PROVIDER",
    providers: ["alchemy_wss"],
  }));
  assert.equal(event.copy_signal.state, "PROVIDER_CONFIRMATION_REQUIRED");
  assert.equal(event.copy_signal.source_signal_ready, false);
  assert.equal(event.copy_signal.eligible_buy_signal, false);
  assert(event.copy_signal.required_next_evidence.includes("independent_provider_confirmation"));
});

test("adapter refuses fake canonical USDC, inconsistent asset identity, and live authority", () => {
  const fakeCanonical = structuredClone(coreEvent());
  fakeCanonical.asset_deltas[0].canonical_usdc = true;
  assert.throws(() => normalizeRobinhoodWalletEconomicEvent(fakeCanonical), /robinhood_wallet_asset_delta_invalid/);

  const wrongContract = structuredClone(coreEvent());
  wrongContract.asset_deltas[1].contract = ACTOR;
  assert.throws(() => normalizeRobinhoodWalletEconomicEvent(wrongContract), /robinhood_wallet_asset_delta_invalid/);

  const live = structuredClone(coreEvent());
  live.execution_boundary.live_copy = true;
  assert.throws(() => normalizeRobinhoodWalletEconomicEvent(live), /robinhood_wallet_execution_boundary_invalid/);
});

test("adapter refuses missing provider agreement, controller claims, and hidden material", () => {
  const mismatchedProviders = coreEvent({ providerState: "AGREED", providers: ["alchemy_wss"] });
  assert.throws(() => normalizeRobinhoodWalletEconomicEvent(mismatchedProviders), /robinhood_wallet_provider_evidence_invalid/);

  const controller = structuredClone(coreEvent());
  controller.wallet_controller_identity_claimed = true;
  assert.throws(() => normalizeRobinhoodWalletEconomicEvent(controller), /robinhood_wallet_event_invalid/);

  const hidden = structuredClone(coreEvent());
  hidden.provenance.private_key = "forbidden-even-as-a-fixture";
  assert.throws(() => normalizeRobinhoodWalletEconomicEvent(hidden), /robinhood_wallet_forbidden_material/);
});
