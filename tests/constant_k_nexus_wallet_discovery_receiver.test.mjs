import assert from "node:assert/strict";
import {
  appendFileSync,
  existsSync,
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

import {
  createConstantKNexusDiscoveryCoverageAcknowledgement,
  createConstantKNexusDiscoveryCoverageManifest,
} from "../lib/customer_trade/constant_k_nexus_discovery_coverage.mjs";
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

function transaction(value = 1, { wallet = WALLET, token = TOKEN, observed_at: observedAt = NOW } = {}) {
  return {
    event: "solana_grpc_transaction",
    provider: "constant_k",
    ts: observedAt,
    slot: String(443_800_000 + value),
    signature: signature(value),
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

function tempState(t) {
  const directory = mkdtempSync(join(tmpdir(), "ravenos-nexus-discovery-receiver-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const paths = {
    directory,
    event_path: join(directory, "events.jsonl"),
    checkpoint_path: join(directory, "receiver-checkpoint.json"),
    health_path: join(directory, "receiver-health.json"),
    coverage_manifest_path: join(directory, "coverage-manifest.json"),
    provider_acknowledgement_path: join(directory, "provider-coverage-ack.json"),
  };
  writeCoverage(paths);
  return paths;
}

function writeCoverage(paths, {
  activated_at: activatedAt = "2026-09-01T14:59:00.000Z",
  verified_at: verifiedAt = NOW,
  expires_at: expiresAt = "2026-09-01T15:10:00.000Z",
  acknowledgement_overrides: acknowledgementOverrides = {},
} = {}) {
  const manifest = createConstantKNexusDiscoveryCoverageManifest({ generated_at: NOW });
  const acknowledgement = {
    ...createConstantKNexusDiscoveryCoverageAcknowledgement({
      manifest,
      activated_at: activatedAt,
      verified_at: verifiedAt,
      expires_at: expiresAt,
    }),
    ...acknowledgementOverrides,
  };
  writeFileSync(paths.coverage_manifest_path, `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
  writeFileSync(paths.provider_acknowledgement_path, `${JSON.stringify(acknowledgement)}\n`, { mode: 0o600 });
}

function config(paths) {
  return {
    state_directory: paths.directory,
    event_path: paths.event_path,
    checkpoint_path: paths.checkpoint_path,
    health_path: paths.health_path,
    coverage_manifest_path: paths.coverage_manifest_path,
    provider_acknowledgement_path: paths.provider_acknowledgement_path,
    candidate_census_path: join(paths.directory, "candidate-census.sqlite"),
    ingress_origin: "https://ingest.ravenos.xyz",
    credentials: { key_id: KEY_ID, secret: SECRET },
    maximum_bytes: 16 * 1024 * 1024,
    maximum_lines: 10_000,
    poll_interval_ms: 500,
    maximum_backoff_ms: 30_000,
  };
}

function passThroughCensus() {
  let observations = [];
  return {
    stageObservations(rows) {
      observations = [...rows];
      return { received: rows.length, unique: rows.length, duplicates: 0, evidence_retained: rows.length };
    },
    prepareOutbound() {
      return {
        observations,
        initial_rounds_created: observations.length ? 1 : 0,
        refresh_rounds_created: 0,
        queued_observation_count: observations.length,
        budget: { rounds_last_hour: 0, rounds_last_day: 0, remaining_this_hour: 1, remaining_this_day: 1 },
      };
    },
    markDelivered() { return observations.length; },
    health() {
      return {
        candidate_count: observations.length ? 1 : 0,
        unpromoted_candidate_count: 0,
        promoted_candidate_count: observations.length ? 1 : 0,
        eligible_candidate_backlog: 0,
        evidence: { held_count: 0, queued_count: 0, delivered_count: observations.length },
        budget: { rounds_last_hour: 0, rounds_last_day: 0, remaining_this_hour: 1, remaining_this_day: 1 },
        admission: {
          minimum_observations: 1,
          minimum_distinct_mints: 1,
          minimum_observation_span_seconds: 0,
          outcome_data_used: false,
          subscriber_data_used: false,
        },
      };
    },
  };
}

function runReceiver(configInput, dependencies = {}) {
  return runConstantKWalletDiscoveryReceiverCycle(configInput, {
    candidate_census: passThroughCensus(),
    ...dependencies,
  });
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
  assert.equal(settings.candidate_census_path, "/var/lib/ravenos-wallet-discovery/candidate-census.sqlite");
  assert.equal(settings.candidate_census_limits.minimum_observations, 5);
  assert.equal(settings.candidate_census_limits.minimum_distinct_mints, 2);
  assert.equal(settings.candidate_census_limits.minimum_observation_span_seconds, 60);
  assert.equal(settings.candidate_census_limits.maximum_promotion_rounds_per_day, 1_000);
  assert.equal(settings.coverage_manifest_path, "/var/lib/ravenos-wallet-discovery/coverage-manifest.json");
  assert.equal(settings.provider_acknowledgement_path, "/var/lib/ravenos-wallet-discovery/provider-coverage-ack.json");
  assert.equal(settings.maximum_bytes, 16 * 1024 * 1024);
  assert.throws(() => constantKWalletDiscoveryReceiverSettings({
    ...base,
    RAVENOS_WALLET_DISCOVERY_FIREHOSE_CHECKPOINT_PATH: "/tmp/escaped.json",
  }), /constant_k_discovery_receiver_checkpoint_path_invalid/);
});

test("receiver refuses missing, stale, or wrong-mode provider coverage before reading Nexus", async (t) => {
  const paths = tempState(t);
  writeFileSync(paths.event_path, `${JSON.stringify(transaction(1))}\n`, { mode: 0o600 });
  let reads = 0;
  const guardedRead = () => { reads += 1; return {}; };
  rmSync(paths.provider_acknowledgement_path);
  await assert.rejects(() => runReceiver(config(paths), {
    read_batch: guardedRead,
    post_observations: acceptedPost([]),
    now: () => new Date(NOW),
  }), /constant_k_discovery_receiver_provider_ack_unavailable/);
  assert.equal(reads, 0);
  assert.equal(existsSync(paths.checkpoint_path), false);

  writeCoverage(paths, {
    activated_at: "2026-09-01T14:39:00.000Z",
    verified_at: "2026-09-01T14:40:00.000Z",
    expires_at: "2026-09-01T14:50:00.000Z",
  });
  await assert.rejects(() => runReceiver(config(paths), {
    read_batch: guardedRead,
    post_observations: acceptedPost([]),
    now: () => new Date(NOW),
  }), /constant_k_discovery_coverage_ack_expired/);
  assert.equal(reads, 0);

  writeCoverage(paths, { acknowledgement_overrides: { active_filter_mode: "identity_backed" } });
  await assert.rejects(() => runReceiver(config(paths), {
    read_batch: guardedRead,
    post_observations: acceptedPost([]),
    now: () => new Date(NOW),
  }), /constant_k_discovery_coverage_not_active/);
  assert.equal(reads, 0);
});

test("discovery receiver tails first and admits only new prospective Nexus evidence", async (t) => {
  const paths = tempState(t);
  const calls = [];
  writeFileSync(paths.event_path, `${JSON.stringify(transaction(1))}\n`, { mode: 0o600 });

  const first = await runReceiver(config(paths), {
    post_observations: acceptedPost(calls),
    now: () => new Date(NOW),
  });
  assert.equal(first.state, "idle");
  assert.equal(first.coverage.state, "provider_acknowledged");
  assert.equal(first.coverage.filter_mode, "reviewed_swap_programs");
  assert.equal(first.coverage.program_count >= 8, true);
  assert.equal(first.coverage.chain_wide_coverage_claimed, false);
  assert.equal(first.source.initial_history_truncated, true);
  assert.equal(first.discovery.qualifying_observations, 0);
  assert.equal(calls[0].observations.length, 0);
  const firstCheckpoint = JSON.parse(readFileSync(paths.checkpoint_path, "utf8"));

  appendFileSync(paths.event_path, `${JSON.stringify(transaction(2))}\n`);
  const second = await runReceiver(config(paths), {
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
  await runReceiver(config(paths), {
    post_observations: acceptedPost([]),
    now: () => new Date(NOW),
  });
  const before = readFileSync(paths.checkpoint_path, "utf8");
  appendFileSync(paths.event_path, `${JSON.stringify(transaction(3))}\n`);

  await assert.rejects(() => runReceiver(config(paths), {
    async post_observations() { throw new Error("fixture_discovery_sink_unavailable"); },
    now: () => new Date(NOW),
  }), /fixture_discovery_sink_unavailable/);
  assert.equal(readFileSync(paths.checkpoint_path, "utf8"), before);

  const calls = [];
  const recovered = await runReceiver(config(paths), {
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
  await runReceiver(config(paths), {
    fetch_impl: harness.fetchImpl,
    now: () => new Date(NOW),
  });
  appendFileSync(paths.event_path, `${JSON.stringify(transaction(5))}\n`);

  const run = await runReceiver(config(paths), {
    fetch_impl: harness.fetchImpl,
    now: () => new Date(NOW),
  });
  assert.equal(run.ingress.batches, 1);
  assert.equal(run.ingress.observations, 1);
  assert.equal(run.ingress.inserted, 1);
  assert.equal(harness.observations.size, 1);
  assert.equal([...harness.observations.values()][0].source_wallet.address, WALLET);
});

test("production census keeps one-offs local and promotes only sustained mint-diverse wallets", async (t) => {
  const paths = tempState(t);
  const calls = [];
  writeFileSync(paths.event_path, "", { mode: 0o600 });
  await runConstantKWalletDiscoveryReceiverCycle(config(paths), {
    post_observations: acceptedPost(calls),
    now: () => new Date(NOW),
  });
  appendFileSync(paths.event_path, `${JSON.stringify(transaction(70, {
    observed_at: "2026-09-01T14:57:30.000Z",
  }))}\n`);
  const held = await runConstantKWalletDiscoveryReceiverCycle(config(paths), {
    post_observations: acceptedPost(calls),
    now: () => new Date(NOW),
  });
  assert.equal(held.discovery.qualifying_observations, 1);
  assert.equal(held.candidate_census.observations_staged, 1);
  assert.equal(held.candidate_census.outbound_observations, 0);
  assert.equal(held.ingress.observations, 0);

  const secondToken = bs58.encode(Buffer.alloc(32, 93));
  for (let index = 0; index < 4; index += 1) {
    appendFileSync(paths.event_path, `${JSON.stringify(transaction(71 + index, {
      token: index < 2 ? TOKEN : secondToken,
      observed_at: new Date(Date.parse("2026-09-01T14:58:00.000Z") + index * 30_000).toISOString(),
    }))}\n`);
  }
  const promoted = await runConstantKWalletDiscoveryReceiverCycle(config(paths), {
    post_observations: acceptedPost(calls),
    now: () => new Date(NOW),
  });
  assert.equal(promoted.candidate_census.initial_promotion_rounds, 1);
  assert.equal(promoted.candidate_census.outbound_observations, 5);
  assert.equal(promoted.ingress.observations, 5);
  assert.equal(promoted.candidate_census.promoted_candidate_count, 1);
  assert.equal(promoted.candidate_census.outcome_data_used, false);
  assert.equal(promoted.candidate_census.subscriber_data_used, false);

  const restarted = await runConstantKWalletDiscoveryReceiverCycle(config(paths), {
    post_observations: acceptedPost(calls),
    now: () => new Date(NOW),
  });
  assert.equal(restarted.candidate_census.outbound_observations, 0);
  assert.equal(restarted.ingress.observations, 0);
});

test("discovery cursor crosses the retained Nexus rotation without losing candidates", async (t) => {
  const paths = tempState(t);
  writeFileSync(paths.event_path, "", { mode: 0o600 });
  await runReceiver(config(paths), {
    post_observations: acceptedPost([]),
    now: () => new Date(NOW),
  });
  appendFileSync(paths.event_path, `${JSON.stringify(transaction(6))}\n`);
  renameSync(paths.event_path, `${paths.event_path}.1`);
  writeFileSync(paths.event_path, `${JSON.stringify(transaction(7))}\n`, { mode: 0o600 });

  const calls = [];
  const run = await runReceiver(config(paths), {
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
  await runReceiver(config(paths), {
    post_observations: acceptedPost([]),
    now: () => new Date(NOW),
  });
  appendFileSync(paths.event_path, "{not-json}\n");
  appendFileSync(paths.event_path, `${JSON.stringify({ event: "solana_grpc_slot", provider: "constant_k", slot: "443800010" })}\n`);

  const calls = [];
  const run = await runReceiver(config(paths), {
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
  await runReceiver(config(paths), {
    post_observations: acceptedPost([]),
    now: () => new Date(NOW),
  });
  appendFileSync(paths.event_path, `${JSON.stringify(transaction(4))}\n`);
  const output = await runReceiver(config(paths), {
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
  assert.equal(output.coverage.program_ids_included, false);
  assert.equal(output.coverage.wallet_addresses_included, false);
  assert.equal(output.coverage.execution_authority, false);
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
