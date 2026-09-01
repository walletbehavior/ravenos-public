import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import bs58 from "bs58";

import {
  discoverConstantKNexusWalletCandidates,
  normalizeConstantKNexusWalletCandidateObservation,
} from "../lib/customer_trade/constant_k_nexus_wallet_discovery.mjs";
import {
  SOURCE_WALLET_DISCOVERY_HYDRATION_SCHEMA,
  resolveSourceWalletDiscoveryAdmissionActivation,
  runSourceWalletDiscoveryAdmissionBatch,
} from "../lib/customer_trade/source_wallet_discovery_admission.mjs";
import {
  SOURCE_WALLET_DISCOVERY_INGRESS_ROUTE,
  routeSourceWalletDiscoveryIngress,
} from "../lib/customer_trade/source_wallet_discovery_ingress.mjs";
import {
  createSourceWalletDiscoveryBatch,
  sourceWalletDiscoveryReceipt,
} from "../lib/customer_trade/source_wallet_discovery_ingress_protocol.mjs";
import {
  postConstantKNexusWalletDiscoveryObservations,
} from "../lib/customer_trade/constant_k_nexus_wallet_ingress_client.mjs";
import { SOLANA_PROGRAM_IDS } from "../lib/customer_trade/solana_program_registry.mjs";
import { signSourceWalletIngressRequest } from "../lib/customer_trade/source_wallet_ingress_protocol.mjs";

const WALLET = bs58.encode(Buffer.alloc(32, 91));
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TOKEN = bs58.encode(Buffer.alloc(32, 92));
const TOKEN_TWO = bs58.encode(Buffer.alloc(32, 93));
const NOW = "2026-09-01T16:00:00.000Z";
const SECRET = "fixture-wallet-discovery-secret-with-at-least-thirty-two-bytes";
const KEY_ID = "nexus-discovery-a";

function signature(value) {
  return bs58.encode(Buffer.alloc(64, value));
}

function event(value, token = TOKEN) {
  return {
    event: "solana_grpc_transaction",
    provider: "constant_k",
    ts: new Date(Date.parse(NOW) - ((3 - value) * 1_000)).toISOString(),
    slot: String(500 + value),
    signature: signature(value),
    failed: false,
    is_vote: false,
    signer_accounts: [WALLET],
    programs: [SOLANA_PROGRAM_IDS.jupiter_v6],
    joint_entity_required_signer_accounts_complete: true,
    joint_entity_token_balance_deltas_complete: true,
    joint_entity_token_balance_delta_economics_complete: true,
    joint_entity_token_balance_deltas: [
      { owner: WALLET, mint: USDC, delta_raw: "-25000000", token_balance_economics_complete: true },
      { owner: WALLET, mint: token, delta_raw: "10000000", token_balance_economics_complete: true },
    ],
  };
}

function discovery() {
  return discoverConstantKNexusWalletCandidates({
    events: [event(1), event(2, TOKEN_TWO)],
    now: () => NOW,
  });
}

function candidateForRun() {
  const result = discovery();
  return {
    ...result.candidates[0],
    state: "leased",
    hydration_attempt_count: 1,
    lease_token: "fixture-worker:12345678901234567890",
  };
}

function hydratedEvent(observation, kind = "SWAP_BUY", route = true) {
  return {
    schema_version: "ravenos.solana_wallet_event.v1",
    event_id: `swe_${"a".repeat(40)}`,
    evidence_hash: "b".repeat(40),
    source_wallet: { chain: "solana", network: "mainnet", address: WALLET },
    chain_evidence: { signature: observation.signature, slot: observation.slot },
    classification: { kind },
    route_evidence: { swap_route_observed: route },
  };
}

function memoryAdmissionStore(candidate, observation, { remaining = false } = {}) {
  const rows = [];
  const completions = [];
  const retries = [];
  return {
    rows,
    completions,
    retries,
    async leaseCandidates() { return [candidate]; },
    async nextObservation() { return observation; },
    async recordHydration(row) { rows.push(row); },
    async hasUnhydratedObservations() { return remaining; },
    async completeCandidate(row) { completions.push(row); },
    async retryCandidate(row) { retries.push(row); },
  };
}

test("candidate observation normalization is exact, reviewed, and cannot smuggle provider or execution material", () => {
  const observation = discovery().observations[0];
  assert.deepEqual(normalizeConstantKNexusWalletCandidateObservation(observation), observation);
  assert.throws(() => normalizeConstantKNexusWalletCandidateObservation({ ...observation, raw_provider_payload: {} }), /constant_k_candidate_observation_invalid/);
  assert.throws(() => normalizeConstantKNexusWalletCandidateObservation({
    ...observation,
    route_programs: [{ ...observation.route_programs[0], program_id: "11111111111111111111111111111111" }],
  }), /constant_k_candidate_route_invalid/);
  assert.throws(() => normalizeConstantKNexusWalletCandidateObservation({
    ...observation,
    execution_boundary: { ...observation.execution_boundary, live_copy: true },
  }), /constant_k_candidate_execution_boundary_invalid/);
});

test("discovery activation requires coordinated ingress, intelligence, evaluator, and backfill flags", () => {
  const inactive = resolveSourceWalletDiscoveryAdmissionActivation({ RAVENOS_WALLET_DISCOVERY_INGRESS_ENABLED: "1" });
  assert.equal(inactive.ingress, false);
  assert.equal(inactive.evaluator, false);
  const active = resolveSourceWalletDiscoveryAdmissionActivation({
    RAVENOS_WALLET_DISCOVERY_INGRESS_ENABLED: "1",
    RAVENOS_WALLET_DISCOVERY_EVALUATOR_ENABLED: "1",
    RAVENOS_WALLET_INTELLIGENCE_ENABLED: "1",
    RAVENOS_WALLET_BACKFILL_ENABLED: "1",
  });
  assert.equal(active.ingress, true);
  assert.equal(active.evaluator, true);
  assert.equal(active.live_copy, false);
  assert.equal(active.broadcasting, false);
});

test("independent Raven hydration admits only a verified economic trade and queues existing backfill", async () => {
  const candidate = candidateForRun();
  const observation = discovery().observations[1];
  const store = memoryAdmissionStore(candidate, observation);
  const admissions = [];
  const run = await runSourceWalletDiscoveryAdmissionBatch(store, {
    async hydrateCandidate() { return hydratedEvent(observation); },
    async admitCandidate(row) {
      admissions.push(row);
      return { source_wallet_id: candidate.source_wallet_id, backfill: { state: "queued" } };
    },
  }, { now: Date.parse(NOW), worker_id: "fixture-discovery-worker" });
  assert.equal(run.totals.candidates_admitted, 1);
  assert.equal(admissions.length, 1);
  assert.equal(store.rows[0].schema_version, SOURCE_WALLET_DISCOVERY_HYDRATION_SCHEMA);
  assert.equal(store.rows[0].state, "verified_trade");
  assert.equal(store.rows[0].raw_transaction_included, false);
  assert.equal(store.completions[0].state, "admitted");
  assert.equal(run.execution_boundary.live_copy, false);
});

test("a provider candidate that Raven classifies as a transfer is visible evidence, not a wallet admission", async () => {
  const candidate = candidateForRun();
  const observation = discovery().observations[1];
  const store = memoryAdmissionStore(candidate, observation, { remaining: true });
  let admissions = 0;
  const run = await runSourceWalletDiscoveryAdmissionBatch(store, {
    async hydrateCandidate() { return hydratedEvent(observation, "TRANSFER_IN", false); },
    async admitCandidate() { admissions += 1; },
  }, { now: Date.parse(NOW), worker_id: "fixture-discovery-worker" });
  assert.equal(admissions, 0);
  assert.equal(run.totals.observations_verified_non_trade, 1);
  assert.equal(run.totals.candidates_requeued_for_evidence, 1);
  assert.equal(store.rows[0].state, "verified_non_trade");
  assert.equal(store.completions[0].state, "hydration_eligible");
});

test("provider failure retries without inventing a profile or a zero-return observation", async () => {
  const candidate = candidateForRun();
  const observation = discovery().observations[1];
  const store = memoryAdmissionStore(candidate, observation);
  const run = await runSourceWalletDiscoveryAdmissionBatch(store, {
    async hydrateCandidate() { const error = new Error("rpc_timeout"); error.code = "wallet_discovery_rpc_timeout"; throw error; },
    async admitCandidate() { throw new Error("must_not_run"); },
  }, { now: Date.parse(NOW), worker_id: "fixture-discovery-worker" });
  assert.equal(run.totals.candidates_retried, 1);
  assert.equal(store.retries[0].dead_letter, false);
  assert.equal(store.rows[0].state, "retry");
  assert.equal(store.completions.length, 0);
});

function ingressHarness() {
  const receipts = new Map();
  const accepted = [];
  const env = {
    RAVENOS_WALLET_DISCOVERY_INGRESS_ENABLED: "1",
    RAVENOS_WALLET_INTELLIGENCE_ENABLED: "1",
    RAVENOS_WALLET_DISCOVERY_INGRESS_HOST: "ingest.ravenos.xyz",
    RAVENOS_WALLET_DISCOVERY_INGRESS_KEY_ID: KEY_ID,
    RAVENOS_WALLET_DISCOVERY_INGRESS_HMAC_SECRET: SECRET,
  };
  const store = {
    async getReceipt(batchId) { return receipts.get(batchId) || null; },
    async ingestBatch(batch, { body_sha256: bodySha256, key_id: keyId }) {
      accepted.push(...batch.observations);
      const receipt = sourceWalletDiscoveryReceipt({
        schema_version: "ravenos.source_wallet_discovery_receipt.v1",
        batch_id: batch.batch_id,
        body_sha256: bodySha256,
        key_id: keyId,
        observation_count: batch.observations.length,
        inserted_count: batch.observations.length,
        duplicate_count: 0,
        eligible_candidate_count: 1,
        sent_at: batch.sent_at,
        received_at: NOW,
        replayed: false,
      });
      receipts.set(batch.batch_id, receipt);
      return receipt;
    },
  };
  const fetchImpl = (url, init) => routeSourceWalletDiscoveryIngress(new Request(url, init), env, { store, now: () => Date.parse(NOW) });
  return { env, store, receipts, accepted, fetchImpl };
}

test("authenticated discovery ingress accepts a replay-safe reduced candidate batch and exposes no identifiers", async () => {
  const harness = ingressHarness();
  const result = await postConstantKNexusWalletDiscoveryObservations({
    ingress_origin: "https://ingest.ravenos.xyz",
    credentials: { key_id: KEY_ID, secret: SECRET },
    observations: discovery().observations,
    receiver_checkpoint: { cursor: { device: 1, inode: 2, offset: 3 } },
    fetch_impl: harness.fetchImpl,
    sent_at: NOW,
    now: new Date(NOW),
  });
  assert.equal(result.observations, 2);
  assert.equal(result.inserted, 2);
  assert.equal(harness.accepted.length, 2);
  assert.equal(JSON.stringify(result).includes(WALLET), false);
  assert.equal(JSON.stringify(result).includes(signature(1)), false);
  assert.equal(result.eligible_candidates, 1);
});

test("discovery ingress stays missing when disabled and rejects wrong HMAC", async () => {
  const batch = createSourceWalletDiscoveryBatch({
    observations: discovery().observations,
    receiver_checkpoint_reference: `ckr_${"a".repeat(40)}`,
    sent_at: NOW,
  });
  const body = JSON.stringify(batch);
  const disabled = await routeSourceWalletDiscoveryIngress(new Request(`https://ingest.ravenos.xyz${SOURCE_WALLET_DISCOVERY_INGRESS_ROUTE}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  }), {}, {});
  assert.equal(disabled.status, 404);

  const harness = ingressHarness();
  const headers = await signSourceWalletIngressRequest({
    method: "POST",
    path: SOURCE_WALLET_DISCOVERY_INGRESS_ROUTE,
    body,
    key_id: KEY_ID,
    secret: "wrong-secret-that-is-still-more-than-thirty-two-bytes-long",
    timestamp_seconds: Math.floor(Date.parse(NOW) / 1_000),
    request_id: batch.batch_id,
  });
  const response = await routeSourceWalletDiscoveryIngress(new Request(`https://ingest.ravenos.xyz${SOURCE_WALLET_DISCOVERY_INGRESS_ROUTE}`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body,
  }), harness.env, { store: harness.store, now: () => Date.parse(NOW) });
  assert.equal(response.status, 401);
  assert.equal(harness.accepted.length, 0);
});

test("discovery migration is append-only, replay-safe, provider-only, and grants no execution authority", () => {
  const sql = readFileSync(new URL("../customer-migrations/0014_source_wallet_discovery.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE ravenos_source_wallet_discovery_candidates/i);
  assert.match(sql, /CREATE TABLE ravenos_source_wallet_discovery_observations/i);
  assert.match(sql, /CREATE TRIGGER ravenos_source_wallet_discovery_observations_append_only/i);
  assert.match(sql, /CREATE TABLE ravenos_source_wallet_discovery_hydrations/i);
  assert.match(sql, /CREATE TRIGGER ravenos_source_wallet_discovery_hydrations_append_only/i);
  assert.match(sql, /CREATE TABLE ravenos_source_wallet_discovery_batches/i);
  assert.match(sql, /transaction_material_included/i);
  assert.match(sql, /live_copy/i);
  assert.doesNotMatch(sql, /private_key|seed_phrase|signing_key|treasury_key/i);
  assert.doesNotMatch(sql, /\buser_id\s+TEXT|\bsubscriber_id\s+TEXT|\bpolicy_json\s+TEXT|\bfollower_count\s+INTEGER/i);
});
