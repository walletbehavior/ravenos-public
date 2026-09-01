import assert from "node:assert/strict";
import test from "node:test";

import bs58 from "bs58";

import {
  CONSTANT_K_NEXUS_WALLET_CANDIDATE_OBSERVATION_SCHEMA,
  CONSTANT_K_NEXUS_WALLET_DISCOVERY_SCHEMA,
  ConstantKNexusWalletDiscoveryLimits,
  discoverConstantKNexusWalletCandidates,
  summarizeConstantKNexusWalletDiscovery,
} from "../lib/customer_trade/constant_k_nexus_wallet_discovery.mjs";
import { SOLANA_PROGRAM_IDS } from "../lib/customer_trade/solana_program_registry.mjs";
import { runConstantKWalletDiscoveryLiveValidation } from "../scripts/validate-constant-k-wallet-discovery-live.mjs";

const WALLET = bs58.encode(Buffer.alloc(32, 41));
const SECOND = bs58.encode(Buffer.alloc(32, 42));
const WATCHED = bs58.encode(Buffer.alloc(32, 43));
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TOKEN = bs58.encode(Buffer.alloc(32, 44));
const TOKEN_TWO = bs58.encode(Buffer.alloc(32, 45));
const NOW = "2026-09-01T12:00:00.000Z";

function signature(value) {
  return bs58.encode(Buffer.alloc(64, value));
}

function delta(owner, mint, amount) {
  return {
    owner,
    mint,
    delta_raw: String(amount),
    token_balance_economics_complete: true,
  };
}

function event({
  wallet = WALLET,
  signers = [wallet],
  rowSignature = signature(1),
  slot = 500,
  ts = "2026-09-01T11:59:59.000Z",
  program = SOLANA_PROGRAM_IDS.jupiter_v6,
  token = TOKEN,
  extra = {},
} = {}) {
  return {
    event: "solana_grpc_transaction",
    provider: "constant_k",
    ts,
    slot: String(slot),
    signature: rowSignature,
    failed: false,
    is_vote: false,
    signer_accounts: signers,
    programs: [program],
    joint_entity_required_signer_accounts_complete: true,
    joint_entity_token_balance_deltas_complete: true,
    joint_entity_token_balance_delta_economics_complete: true,
    joint_entity_token_balance_deltas: [
      delta(wallet, USDC, "-25000000"),
      delta(wallet, token, "10000000"),
    ],
    raw_provider_payload: { never: "persist" },
    subscriber_id: "private",
    ...extra,
  };
}

test("Nexus discovery emits an exact off-universe signer candidate without calling it a trade", () => {
  const result = discoverConstantKNexusWalletCandidates({ events: [event()], now: () => NOW });
  assert.equal(result.schema_version, CONSTANT_K_NEXUS_WALLET_DISCOVERY_SCHEMA);
  assert.equal(result.state, "current");
  assert.equal(result.counts.unique_candidates, 1);
  assert.equal(result.candidates[0].source_wallet.address, WALLET);
  assert.equal(result.candidates[0].evidence_tier, "single_observation");
  assert.equal(result.candidates[0].admission.eligible_for_bounded_history_backfill, false);
  assert.equal(result.observations[0].schema_version, CONSTANT_K_NEXUS_WALLET_CANDIDATE_OBSERVATION_SCHEMA);
  assert.equal(result.observations[0].economic_evidence.opposing_nonzero_balance_deltas, true);
  assert.equal(result.observations[0].economic_evidence.evidence_kind, "exact_opposing_token_deltas");
  assert.equal(result.observations[0].economic_evidence.trade_direction_claimed, false);
  assert.equal(result.claim_boundary.provider_candidate_is_normalized_trade, false);
  assert.equal(result.execution_boundary.live_copy, false);
  assert.equal(JSON.stringify(result).includes("never"), false);
  assert.equal(JSON.stringify(result).includes('"subscriber_id"'), false);
});

test("watched signers remain in the observer lane and are not rediscovered", () => {
  const result = discoverConstantKNexusWalletCandidates({
    events: [event({ wallet: WATCHED })],
    watched_wallets: [WATCHED],
    now: () => NOW,
  });
  assert.equal(result.candidates.length, 0);
  assert.equal(result.observations.length, 0);
  assert.equal(result.counts.watched_signer_observations, 1);
});

test("recurring and high-signal tiers are transparent deterministic evidence gates", () => {
  const rows = [];
  for (let index = 0; index < 5; index += 1) {
    rows.push(event({
      rowSignature: signature(index + 1),
      slot: 500 + index,
      ts: `2026-09-0${index < 2 ? 1 : 2}T11:59:${String(50 + index).padStart(2, "0")}.000Z`,
      token: index % 2 ? TOKEN_TWO : TOKEN,
      program: index % 2 ? SOLANA_PROGRAM_IDS.raydium_clmm : SOLANA_PROGRAM_IDS.pump_amm,
    }));
  }
  rows.push(event({ wallet: SECOND, rowSignature: signature(20), slot: 700 }));
  rows.push(event({ wallet: SECOND, rowSignature: signature(21), slot: 701 }));
  const result = discoverConstantKNexusWalletCandidates({ events: rows, now: () => "2026-09-03T00:00:00.000Z" });
  assert.equal(result.candidates[0].source_wallet.address, WALLET);
  assert.equal(result.candidates[0].evidence_tier, "high_signal");
  assert.equal(result.candidates[0].qualification_observation_count, 5);
  assert.equal(result.candidates[0].exact_swap_shape_observation_count, 5);
  assert.equal(result.candidates[0].reviewed_buy_instruction_observation_count, 0);
  assert.equal(result.candidates[0].active_day_count, 2);
  assert.equal(result.candidates[0].distinct_mint_count, 3);
  assert.equal(result.candidates[0].admission.eligible_for_bounded_history_backfill, true);
  assert.equal(result.candidates[1].evidence_tier, "recurring");
  assert.equal(result.candidates[1].admission.eligible_for_copyability_claim, false);
  assert.equal(result.candidates[0].ranking.opaque_score_used, false);
});

test("reviewed Pump buy instruction can seed discovery when native SOL is not represented as a token delta", () => {
  const pumpBuy = event({
    program: SOLANA_PROGRAM_IDS.pump_bonding_curve,
    extra: {
      pumpfun_buy_instruction: true,
      joint_entity_token_balance_deltas: [delta(WALLET, TOKEN, "10000000")],
    },
  });
  const result = discoverConstantKNexusWalletCandidates({ events: [pumpBuy], now: () => NOW });
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].economic_evidence.evidence_kind, "reviewed_pump_buy_instruction");
  assert.equal(result.observations[0].economic_evidence.opposing_nonzero_balance_deltas, false);
  assert.equal(result.observations[0].economic_evidence.reviewed_buy_instruction_observed, true);
  assert.equal(result.observations[0].economic_evidence.trade_direction_claimed, false);
  assert.equal(result.candidates[0].reviewed_buy_instruction_observation_count, 1);
  assert.equal(result.candidates[0].exact_swap_shape_observation_count, 0);
  assert.equal(result.candidates[0].admission.eligible_for_bounded_history_backfill, false);
});

test("duplicates collapse and incomplete, failed, vote, unknown-route, and suspect program rows never become candidates", () => {
  const valid = event();
  const incomplete = event({ rowSignature: signature(2), extra: { joint_entity_token_balance_deltas_complete: false } });
  const failed = event({ rowSignature: signature(3), extra: { failed: true } });
  const vote = event({ rowSignature: signature(4), extra: { is_vote: true } });
  const unknown = event({ rowSignature: signature(5), program: "11111111111111111111111111111111" });
  const suspect = event({ rowSignature: signature(6), program: "CAMMCzo5YL8w4VFF8KVHrK22GGUQpB4c4jUxQ3YMpiZ" });
  const result = discoverConstantKNexusWalletCandidates({ events: [valid, valid, incomplete, failed, vote, unknown, suspect], now: () => NOW });
  assert.equal(result.observations.length, 1);
  assert.equal(result.counts.duplicate_observations, 1);
  assert.equal(result.counts.incomplete_economics_rows, 1);
  assert.equal(result.counts.failed_or_vote_rows, 2);
  assert.equal(result.counts.no_reviewed_route_rows, 2);
});

test("one signer must own at least two complete opposing mint deltas", () => {
  const noOwnerEvidence = event({
    extra: {
      joint_entity_token_balance_deltas: [
        delta(SECOND, USDC, "-25000000"),
        delta(SECOND, TOKEN, "10000000"),
      ],
    },
  });
  const oneDirection = event({
    rowSignature: signature(7),
    extra: {
      joint_entity_token_balance_deltas: [
        delta(WALLET, USDC, "25000000"),
        delta(WALLET, TOKEN, "10000000"),
      ],
    },
  });
  const result = discoverConstantKNexusWalletCandidates({ events: [noOwnerEvidence, oneDirection], now: () => NOW });
  assert.equal(result.observations.length, 0);
  assert.equal(result.counts.incomplete_economics_rows, 2);
});

test("sanitized discovery summary carries ranks and counts but no wallet or signature", () => {
  const result = discoverConstantKNexusWalletCandidates({ events: [event()], now: () => NOW });
  const summary = summarizeConstantKNexusWalletDiscovery(result);
  const serialized = JSON.stringify(summary);
  assert.equal(summary.leading_candidates.length, 1);
  assert.equal(summary.leading_candidates[0].address_included, false);
  assert.equal(serialized.includes(WALLET), false);
  assert.equal(serialized.includes(signature(1)), false);
  assert.equal(summary.privacy.raw_provider_payload_included, false);
});

test("read-only live harness excludes already matched identities and returns no raw identifiers", () => {
  const known = event({ wallet: WATCHED, extra: { matched_identity_signers: [WATCHED] } });
  const candidate = event({ wallet: WALLET, rowSignature: signature(10), slot: 510 });
  const report = runConstantKWalletDiscoveryLiveValidation({ events: [known, candidate] }, {
    env: {},
    now: () => NOW,
  });
  const serialized = JSON.stringify(report);
  assert.equal(report.persistence, false);
  assert.equal(report.source_capture.matched_wallet_count, 1);
  assert.equal(report.discovery.counts.unique_candidates, 1);
  assert.equal(report.interpretation.profitability_claim_supported, false);
  assert.equal(serialized.includes(WATCHED), false);
  assert.equal(serialized.includes(WALLET), false);
  assert.equal(serialized.includes(signature(10)), false);
  assert.equal(report.execution_boundary.broadcasting, false);
});

test("bounded event and signer inputs fail or degrade closed", () => {
  assert.throws(() => discoverConstantKNexusWalletCandidates({
    events: Array.from({ length: ConstantKNexusWalletDiscoveryLimits.maximum_event_rows + 1 }, () => ({})),
    now: () => NOW,
  }), /constant_k_discovery_events_invalid/);
  const oversized = event({ extra: { padding: "x".repeat(ConstantKNexusWalletDiscoveryLimits.maximum_event_bytes) } });
  const tooManySigners = event({ rowSignature: signature(8), signers: Array.from({ length: 65 }, (_, index) => bs58.encode(Buffer.alloc(32, index + 50))) });
  const result = discoverConstantKNexusWalletCandidates({ events: [oversized, tooManySigners, event({ rowSignature: signature(9) })], now: () => NOW });
  assert.equal(result.state, "degraded");
  assert.equal(result.counts.invalid_rows, 2);
  assert.equal(result.candidates.length, 1);
});
