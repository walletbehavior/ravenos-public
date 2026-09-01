import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import bs58 from "bs58";

import {
  createConstantKNexusCandidateCensus,
} from "../lib/customer_trade/constant_k_nexus_wallet_candidate_census.mjs";
import {
  discoverConstantKNexusWalletCandidates,
} from "../lib/customer_trade/constant_k_nexus_wallet_discovery.mjs";

const NOW = Date.parse("2026-09-01T18:00:00.000Z");
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function address(value) {
  return bs58.encode(Buffer.alloc(32, value));
}

function signature(value) {
  return bs58.encode(Buffer.alloc(64, value));
}

function transaction({ wallet, token, sequence, seconds = 0 }) {
  return {
    event: "solana_grpc_transaction",
    provider: "constant_k",
    ts: new Date(NOW - (600 - seconds) * 1_000).toISOString(),
    slot: String(443_900_000 + sequence),
    signature: signature(sequence),
    failed: false,
    is_vote: false,
    signer_accounts: [wallet],
    programs: ["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"],
    joint_entity_required_signer_accounts_complete: true,
    joint_entity_token_balance_deltas_complete: true,
    joint_entity_token_balance_delta_economics_complete: true,
    joint_entity_token_balance_deltas: [
      { owner: wallet, mint: USDC, delta_raw: "-25000000", token_balance_economics_complete: true },
      { owner: wallet, mint: token, delta_raw: "10000000", token_balance_economics_complete: true },
    ],
  };
}

function observations(events) {
  return discoverConstantKNexusWalletCandidates({
    events,
    watched_wallets: [],
    now: () => new Date(NOW),
  }).observations;
}

function fixture(t, limits = {}) {
  const directory = mkdtempSync(join(tmpdir(), "ravenos-nexus-census-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const databasePath = join(directory, "candidate-census.sqlite");
  const create = () => createConstantKNexusCandidateCensus({
    database_path: databasePath,
    limits: {
      minimum_observations: 5,
      minimum_distinct_mints: 2,
      minimum_observation_span_seconds: 60,
      maximum_promotion_rounds_per_hour: 10,
      maximum_promotion_rounds_per_day: 20,
      ...limits,
    },
  });
  return { databasePath, create };
}

test("candidate census holds one-off activity locally and deduplicates raw replay", (t) => {
  const { databasePath, create } = fixture(t);
  const census = create();
  t.after(() => census.close());
  const wallet = address(31);
  const rows = observations([transaction({ wallet, token: address(41), sequence: 1 })]);

  assert.deepEqual(census.stageObservations(rows, { now: NOW }), {
    received: 1,
    unique: 1,
    duplicates: 0,
    evidence_retained: 1,
  });
  assert.equal(census.prepareOutbound({ now: NOW }).observations.length, 0);
  assert.deepEqual(census.stageObservations(rows, { now: NOW + 1_000 }), {
    received: 1,
    unique: 0,
    duplicates: 1,
    evidence_retained: 0,
  });
  const health = census.health({ now: NOW + 1_000 });
  assert.equal(health.candidate_count, 1);
  assert.equal(health.unpromoted_candidate_count, 1);
  assert.equal(health.eligible_candidate_backlog, 0);
  assert.equal(health.evidence.held_count, 1);
  assert.equal(health.addresses_included, false);
  assert.equal(health.signatures_included, false);
  assert.equal(statSync(databasePath).mode & 0o777, 0o600);
});

test("five sustained mint-diverse observations promote exact evidence and survive restart", (t) => {
  const { create } = fixture(t);
  const wallet = address(32);
  const events = Array.from({ length: 5 }, (_, index) => transaction({
    wallet,
    token: index < 3 ? address(42) : address(43),
    sequence: 10 + index,
    seconds: index * 30,
  }));
  const rows = observations(events);
  let census = create();
  const staged = census.stageObservations(rows, { now: NOW });
  assert.equal(staged.unique, 5);
  const outbound = census.prepareOutbound({ now: NOW });
  assert.equal(outbound.initial_rounds_created, 1);
  assert.equal(outbound.refresh_rounds_created, 0);
  assert.equal(outbound.observations.length, 5);
  assert.equal(new Set(outbound.observations.map((row) => row.source_wallet.address)).size, 1);
  assert.equal(new Set(outbound.observations.flatMap((row) => row.economic_evidence.mints)).size, 3);
  census.close();

  census = create();
  t.after(() => census.close());
  const replayedOutbox = census.prepareOutbound({ now: NOW + 1_000 });
  assert.deepEqual(
    replayedOutbox.observations.map((row) => row.observation_id),
    outbound.observations.map((row) => row.observation_id),
  );
  assert.equal(census.markDelivered(replayedOutbox.observations.map((row) => row.observation_id), { now: NOW + 1_000 }), 5);
  const health = census.health({ now: NOW + 1_000 });
  assert.equal(health.promoted_candidate_count, 1);
  assert.equal(health.evidence.queued_count, 0);
  assert.equal(health.evidence.delivered_count, 5);
  const serialized = JSON.stringify(health);
  assert.equal(serialized.includes(wallet), false);
  assert.equal(serialized.includes(signature(10)), false);
});

test("promotion budgets are durable and rank evidence without outcomes or subscribers", (t) => {
  const { create } = fixture(t, {
    maximum_promotion_rounds_per_cycle: 1,
    maximum_promotion_rounds_per_hour: 1,
    maximum_promotion_rounds_per_day: 1,
  });
  const broadWallet = address(33);
  const narrowWallet = address(34);
  const broad = Array.from({ length: 5 }, (_, index) => transaction({
    wallet: broadWallet,
    token: address(50 + index),
    sequence: 30 + index,
    seconds: index * 30,
  }));
  const narrow = Array.from({ length: 5 }, (_, index) => transaction({
    wallet: narrowWallet,
    token: address(60),
    sequence: 40 + index,
    seconds: index * 30,
  }));
  const census = create();
  t.after(() => census.close());
  census.stageObservations(observations([...narrow, ...broad]), { now: NOW });
  const outbound = census.prepareOutbound({ now: NOW });
  assert.equal(outbound.initial_rounds_created, 1);
  assert.equal(outbound.observations.length, 5);
  assert.equal(outbound.observations.every((row) => row.source_wallet.address === broadWallet), true);
  census.markDelivered(outbound.observations.map((row) => row.observation_id), { now: NOW });
  const blocked = census.prepareOutbound({ now: NOW + 1_000 });
  assert.equal(blocked.observations.length, 0);
  const health = census.health({ now: NOW + 1_000 });
  assert.equal(health.eligible_candidate_backlog, 1);
  assert.equal(health.budget.remaining_this_hour, 0);
  assert.equal(health.budget.remaining_this_day, 0);
  assert.equal(health.admission.outcome_data_used, false);
  assert.equal(health.admission.subscriber_data_used, false);
});

test("promotion requires activity spanning the configured window", (t) => {
  const { create } = fixture(t);
  const wallet = address(35);
  const events = Array.from({ length: 5 }, (_, index) => transaction({
    wallet,
    token: index % 2 ? address(70) : address(71),
    sequence: 50 + index,
    seconds: index * 5,
  }));
  const census = create();
  t.after(() => census.close());
  census.stageObservations(observations(events), { now: NOW });
  assert.equal(census.prepareOutbound({ now: NOW }).observations.length, 0);
  assert.equal(census.health({ now: NOW }).eligible_candidate_backlog, 0);
});

