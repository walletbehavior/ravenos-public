import assert from "node:assert/strict";
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import bs58 from "bs58";

import { routeSourceWalletDiscoveryIngress } from "../lib/customer_trade/source_wallet_discovery_ingress.mjs";
import { sourceWalletDiscoveryReceipt } from "../lib/customer_trade/source_wallet_discovery_ingress_protocol.mjs";
import {
  constantKWalletDiscoveryReceiverSettings,
  runConstantKWalletDiscoveryReceiverCycle,
} from "../scripts/run-constant-k-wallet-discovery-receiver.mjs";

const WALLET = bs58.encode(Buffer.alloc(32, 91));
const TOKEN = bs58.encode(Buffer.alloc(32, 92));
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SECRET = "fixture-nexus-discovery-secret-with-more-than-thirty-two-bytes";
const KEY_ID = "nexus-discovery-a";
const NOW = "2026-09-01T15:00:00.000Z";

function signature(value) {
  return bs58.encode(Buffer.alloc(64, value));
}

function transaction(value = 1) {
  return {
    event: "solana_grpc_transaction",
    provider: "constant_k",
    ts: NOW,
    slot: String(443_800_000 + value),
    signature: signature(value),
    failed: false,
    is_vote: false,
    signer_accounts: [WALLET],
    programs: ["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"],
    joint_entity_required_signer_accounts_complete: true,
    joint_entity_token_balance_deltas_complete: true,
    joint_entity_token_balance_delta_economics_complete: true,
    joint_entity_token_balance_deltas: [
      { owner: WALLET, mint: USDC, delta_raw: "-25000000", token_balance_economics_complete: true },
      { owner: WALLET, mint: TOKEN, delta_raw: "10000000", token_balance_economics_complete: true },
    ],
  };
}

function tempState(t) {
  const directory = mkdtempSync(join(tmpdir(), "ravenos-nexus-discovery-receiver-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return {
    directory,
    event_path: join(directory, "events.jsonl"),
    checkpoint_path: join(directory, "receiver-checkpoint.json"),
    health_path: join(directory, "receiver-health.json"),
  };
}

function config(paths) {
  return {
    state_directory: paths.directory,
    event_path: paths.event_path,
    checkpoint_path: paths.checkpoint_path,
    health_path: paths.health_path,
    ingress_origin: "https://ingest.ravenos.xyz",
    credentials: { key_id: KEY_ID, secret: SECRET },
    maximum_bytes: 16 * 1024 * 1024,
    maximum_lines: 10_000,
    poll_interval_ms: 500,
    maximum_backoff_ms: 30_000,
  };
}

function authenticatedIngressHarness() {
  const receipts = new Map();
  const observations = new Map();
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
      let inserted = 0;
      for (const observation of batch.observations) {
        if (!observations.has(observation.observation_id)) inserted += 1;
        observations.set(observation.observation_id, observation);
      }
      const receipt = sourceWalletDiscoveryReceipt({
        schema_version: "ravenos.source_wallet_discovery_receipt.v1",
        batch_id: batch.batch_id,
        body_sha256: bodySha256,
        key_id: keyId,
        observation_count: batch.observations.length,
        inserted_count: inserted,
        duplicate_count: batch.observations.length - inserted,
        eligible_candidate_count: 0,
        sent_at: batch.sent_at,
        received_at: NOW,
        replayed: false,
      });
      receipts.set(batch.batch_id, receipt);
      return receipt;
    },
  };
  return {
    observations,
    fetchImpl(url, init) {
      return routeSourceWalletDiscoveryIngress(new Request(url, init), env, {
        store,
        now: () => Date.parse(NOW),
      });
    },
  };
}

function acceptedPost(calls) {
  return async (input) => {
    calls.push(input);
    return {
      batches: input.observations.length ? 1 : 0,
      observations: input.observations.length,
      inserted: input.observations.length,
      duplicates: 0,
      eligible_candidates: 0,
    };
  };
}

test("discovery firehose receiver is explicitly gated and confines mutable state", () => {
  assert.throws(() => constantKWalletDiscoveryReceiverSettings({}), /constant_k_discovery_firehose_receiver_disabled/);
  const base = {
    RAVENOS_WALLET_DISCOVERY_FIREHOSE_RECEIVER_ENABLED: "1",
    RAVENOS_WALLET_DISCOVERY_FIREHOSE_STATE_DIR: "/var/lib/ravenos-wallet-discovery",
    RAVENOS_CONSTANT_K_EVENT_PATH: "/srv/raven/data/runtime/events.jsonl",
    RAVENOS_WALLET_DISCOVERY_INGRESS_ORIGIN: "https://ingest.ravenos.xyz",
    RAVENOS_WALLET_DISCOVERY_INGRESS_KEY_ID: "nexus-discovery-a",
    RAVENOS_WALLET_DISCOVERY_INGRESS_HMAC_SECRET: SECRET,
  };
  const settings = constantKWalletDiscoveryReceiverSettings(base);
  assert.equal(settings.checkpoint_path, "/var/lib/ravenos-wallet-discovery/receiver-checkpoint.json");
  assert.equal(settings.maximum_bytes, 16 * 1024 * 1024);
  assert.throws(() => constantKWalletDiscoveryReceiverSettings({
    ...base,
    RAVENOS_WALLET_DISCOVERY_FIREHOSE_CHECKPOINT_PATH: "/tmp/escaped.json",
  }), /constant_k_discovery_receiver_checkpoint_path_invalid/);
});

test("discovery receiver tails first and admits only new prospective Nexus evidence", async (t) => {
  const paths = tempState(t);
  const calls = [];
  writeFileSync(paths.event_path, `${JSON.stringify(transaction(1))}\n`, { mode: 0o600 });

  const first = await runConstantKWalletDiscoveryReceiverCycle(config(paths), {
    post_observations: acceptedPost(calls),
    now: () => new Date(NOW),
  });
  assert.equal(first.state, "idle");
  assert.equal(first.source.initial_history_truncated, true);
  assert.equal(first.discovery.qualifying_observations, 0);
  assert.equal(calls[0].observations.length, 0);
  const firstCheckpoint = JSON.parse(readFileSync(paths.checkpoint_path, "utf8"));

  appendFileSync(paths.event_path, `${JSON.stringify(transaction(2))}\n`);
  const second = await runConstantKWalletDiscoveryReceiverCycle(config(paths), {
    post_observations: acceptedPost(calls),
    now: () => new Date(NOW),
  });
  const secondCheckpoint = JSON.parse(readFileSync(paths.checkpoint_path, "utf8"));
  assert.equal(second.state, "current");
  assert.equal(second.discovery.qualifying_observations, 1);
  assert.equal(second.discovery.unique_candidates_seen, 1);
  assert.equal(second.ingress.inserted, 1);
  assert.equal(second.source.backlog_bytes, 0);
  assert.equal(second.source.at_live_tail, true);
  assert.ok(secondCheckpoint.cursor.offset > firstCheckpoint.cursor.offset);
  assert.equal(secondCheckpoint.counters.references_ingested, 1);
  assert.equal(calls[1].observations[0].source_wallet.address, WALLET);
  assert.equal(calls[1].observations[0].provenance.exact_wallet_trade_not_yet_claimed, true);
});

test("durable ingress failure preserves the old discovery cursor for exact replay", async (t) => {
  const paths = tempState(t);
  writeFileSync(paths.event_path, "", { mode: 0o600 });
  await runConstantKWalletDiscoveryReceiverCycle(config(paths), {
    post_observations: acceptedPost([]),
    now: () => new Date(NOW),
  });
  const before = readFileSync(paths.checkpoint_path, "utf8");
  appendFileSync(paths.event_path, `${JSON.stringify(transaction(3))}\n`);

  await assert.rejects(() => runConstantKWalletDiscoveryReceiverCycle(config(paths), {
    async post_observations() { throw new Error("fixture_discovery_sink_unavailable"); },
    now: () => new Date(NOW),
  }), /fixture_discovery_sink_unavailable/);
  assert.equal(readFileSync(paths.checkpoint_path, "utf8"), before);

  const calls = [];
  const recovered = await runConstantKWalletDiscoveryReceiverCycle(config(paths), {
    post_observations: acceptedPost(calls),
    now: () => new Date(NOW),
  });
  assert.equal(recovered.ingress.inserted, 1);
  assert.equal(calls[0].observations[0].signature, signature(3));
  assert.notEqual(readFileSync(paths.checkpoint_path, "utf8"), before);
});

test("discovery receiver completes the authenticated candidate-ingress boundary end to end", async (t) => {
  const paths = tempState(t);
  const harness = authenticatedIngressHarness();
  writeFileSync(paths.event_path, "", { mode: 0o600 });
  await runConstantKWalletDiscoveryReceiverCycle(config(paths), {
    fetch_impl: harness.fetchImpl,
    now: () => new Date(NOW),
  });
  appendFileSync(paths.event_path, `${JSON.stringify(transaction(5))}\n`);

  const run = await runConstantKWalletDiscoveryReceiverCycle(config(paths), {
    fetch_impl: harness.fetchImpl,
    now: () => new Date(NOW),
  });
  assert.equal(run.ingress.batches, 1);
  assert.equal(run.ingress.observations, 1);
  assert.equal(run.ingress.inserted, 1);
  assert.equal(harness.observations.size, 1);
  assert.equal([...harness.observations.values()][0].source_wallet.address, WALLET);
});

test("discovery cursor crosses the retained Nexus rotation without losing candidates", async (t) => {
  const paths = tempState(t);
  writeFileSync(paths.event_path, "", { mode: 0o600 });
  await runConstantKWalletDiscoveryReceiverCycle(config(paths), {
    post_observations: acceptedPost([]),
    now: () => new Date(NOW),
  });
  appendFileSync(paths.event_path, `${JSON.stringify(transaction(6))}\n`);
  renameSync(paths.event_path, `${paths.event_path}.1`);
  writeFileSync(paths.event_path, `${JSON.stringify(transaction(7))}\n`, { mode: 0o600 });

  const calls = [];
  const run = await runConstantKWalletDiscoveryReceiverCycle(config(paths), {
    post_observations: acceptedPost(calls),
    now: () => new Date(NOW),
  });
  assert.equal(run.continuity, "rotation_continuous");
  assert.equal(run.discovery.qualifying_observations, 2);
  assert.equal(run.ingress.inserted, 2);
  assert.deepEqual(calls[0].observations.map((row) => row.signature).sort(), [signature(6), signature(7)].sort());
  assert.equal(run.source.at_live_tail, true);
});

test("malformed and irrelevant rows advance as degraded input without becoming wallets", async (t) => {
  const paths = tempState(t);
  writeFileSync(paths.event_path, "", { mode: 0o600 });
  await runConstantKWalletDiscoveryReceiverCycle(config(paths), {
    post_observations: acceptedPost([]),
    now: () => new Date(NOW),
  });
  appendFileSync(paths.event_path, "{not-json}\n");
  appendFileSync(paths.event_path, `${JSON.stringify({ event: "solana_grpc_slot", provider: "constant_k", slot: "443800010" })}\n`);

  const calls = [];
  const run = await runConstantKWalletDiscoveryReceiverCycle(config(paths), {
    post_observations: acceptedPost(calls),
    now: () => new Date(NOW),
  });
  const checkpoint = JSON.parse(readFileSync(paths.checkpoint_path, "utf8"));
  assert.equal(run.state, "degraded");
  assert.equal(run.source.parse_failures, 1);
  assert.equal(run.discovery.qualifying_observations, 0);
  assert.equal(calls[0].observations.length, 0);
  assert.equal(checkpoint.counters.invalid_lines, 1);
  assert.equal(checkpoint.counters.references_ingested, 0);
});

test("discovery health and checkpoint expose no wallet, signature, secret, or execution authority", async (t) => {
  const paths = tempState(t);
  writeFileSync(paths.event_path, "", { mode: 0o600 });
  await runConstantKWalletDiscoveryReceiverCycle(config(paths), {
    post_observations: acceptedPost([]),
    now: () => new Date(NOW),
  });
  appendFileSync(paths.event_path, `${JSON.stringify(transaction(4))}\n`);
  const output = await runConstantKWalletDiscoveryReceiverCycle(config(paths), {
    post_observations: acceptedPost([]),
    now: () => new Date(NOW),
  });
  const serialized = [
    JSON.stringify(output),
    readFileSync(paths.health_path, "utf8"),
    readFileSync(paths.checkpoint_path, "utf8"),
  ].join("\n");
  assert.equal(serialized.includes(WALLET), false);
  assert.equal(serialized.includes(TOKEN), false);
  assert.equal(serialized.includes(signature(4)), false);
  assert.equal(serialized.includes(SECRET), false);
  assert.equal(output.discovery.exact_watch_coverage_claimed, false);
  assert.equal(output.discovery.chain_wide_coverage_claimed, false);
  assert.deepEqual(output.execution_boundary, {
    signing: false,
    submission: false,
    broadcasting: false,
    custody: false,
    live_copy: false,
    fee_collection: false,
  });
});
