import assert from "node:assert/strict";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import bs58 from "bs58";

import {
  fetchConstantKNexusWatchManifest,
  postConstantKNexusDeliveries,
} from "../lib/customer_trade/constant_k_nexus_wallet_ingress_client.mjs";
import {
  routeSourceWalletDiscoveryIngress,
} from "../lib/customer_trade/source_wallet_discovery_ingress.mjs";
import {
  sourceWalletDiscoveryReceipt,
} from "../lib/customer_trade/source_wallet_discovery_ingress_protocol.mjs";
import { createSourceWalletObserverDelivery } from "../lib/customer_trade/source_wallet_observer.mjs";
import {
  SOURCE_WALLET_WATCH_MANIFEST_ACK_SCHEMA,
  buildSourceWalletWatchManifest,
} from "../lib/customer_trade/source_wallet_watch_manifest.mjs";
import {
  routeSourceWalletIngress,
} from "../lib/customer_trade/source_wallet_ingress.mjs";
import {
  runConstantKWalletObserverReceiverCycle,
} from "../scripts/run-constant-k-wallet-observer-receiver.mjs";

const WALLET = bs58.encode(Buffer.alloc(32, 81));
const DISCOVERY_WALLET = bs58.encode(Buffer.alloc(32, 82));
const DISCOVERY_TOKEN = bs58.encode(Buffer.alloc(32, 83));
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SECRET = "fixture-nexus-client-secret-with-more-than-thirty-two-bytes";
const KEY_ID = "nexus-client-a";
const DISCOVERY_SECRET = "fixture-nexus-discovery-secret-with-more-than-thirty-two-bytes";
const DISCOVERY_KEY_ID = "nexus-discovery-a";
const NOW = "2026-09-01T14:00:00.000Z";

function signature(value) {
  return bs58.encode(Buffer.alloc(64, value));
}

function delivery(value = 1) {
  return createSourceWalletObserverDelivery({
    wallet_address: WALLET,
    signature: signature(value),
    slot: 443_600_000 + value,
    finality: "processed",
    provider: "constant_k_nexus",
    transport: "geyser_grpc",
    provider_observed_at: NOW,
    raven_received_at: NOW,
  }, { received_at: NOW });
}

function transaction(value = 1) {
  return {
    event: "solana_grpc_transaction",
    provider: "constant_k",
    ts: NOW,
    slot: String(443_600_000 + value),
    signature: signature(value),
    signer_accounts: [WALLET],
    matched_identity_signers: [WALLET],
    programs: ["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"],
    accounts: [WALLET],
    token_balance_deltas: [{ owner: WALLET, mint: WALLET, delta_raw: "1" }],
  };
}

function discoveryTransaction(value = 1) {
  return {
    event: "solana_grpc_transaction",
    provider: "constant_k",
    ts: NOW,
    slot: String(443_700_000 + value),
    signature: signature(20 + value),
    failed: false,
    is_vote: false,
    signer_accounts: [DISCOVERY_WALLET],
    programs: ["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"],
    joint_entity_required_signer_accounts_complete: true,
    joint_entity_token_balance_deltas_complete: true,
    joint_entity_token_balance_delta_economics_complete: true,
    joint_entity_token_balance_deltas: [
      { owner: DISCOVERY_WALLET, mint: USDC, delta_raw: "-25000000", token_balance_economics_complete: true },
      { owner: DISCOVERY_WALLET, mint: DISCOVERY_TOKEN, delta_raw: "10000000", token_balance_economics_complete: true },
    ],
  };
}

function routeHarness({ failDelivery = false } = {}) {
  const receipts = new Map();
  const deliveries = new Map();
  const env = {
    RAVENOS_WALLET_OBSERVER_INGRESS_ENABLED: "1",
    RAVENOS_WALLET_INTELLIGENCE_ENABLED: "1",
    RAVENOS_WALLET_OBSERVER_ENABLED: "1",
    RAVENOS_WALLET_OBSERVER_INGRESS_HOST: "ingest.ravenos.xyz",
    RAVENOS_WALLET_OBSERVER_INGRESS_KEY_ID: KEY_ID,
    RAVENOS_WALLET_OBSERVER_INGRESS_HMAC_SECRET: SECRET,
  };
  const deps = {
    now: () => Date.parse(NOW),
    walletStore: { async listObserverWatchUniverse() { return [WALLET]; } },
    observerStore: {
      async ingestDelivery(row) {
        if (failDelivery) throw new Error("fixture_delivery_sink_unavailable");
        const inserted = !deliveries.has(row.delivery_id);
        deliveries.set(row.delivery_id, row);
        return { inserted };
      },
    },
    ingressStore: {
      async getReceipt(batchId) { return receipts.get(batchId) || null; },
      async recordReceipt(receipt) {
        if (!receipts.has(receipt.batch_id)) receipts.set(receipt.batch_id, receipt);
        return receipts.get(receipt.batch_id);
      },
    },
  };
  const fetchImpl = (url, init) => routeSourceWalletIngress(new Request(url, init), env, deps);
  return { fetchImpl, deliveries, receipts };
}

function dualRouteHarness({ failDiscovery = false } = {}) {
  const observer = routeHarness();
  const discoveryReceipts = new Map();
  const discoveryObservations = new Map();
  let discoveryFailure = failDiscovery;
  const env = {
    RAVENOS_WALLET_DISCOVERY_INGRESS_ENABLED: "1",
    RAVENOS_WALLET_INTELLIGENCE_ENABLED: "1",
    RAVENOS_WALLET_DISCOVERY_INGRESS_HOST: "ingest.ravenos.xyz",
    RAVENOS_WALLET_DISCOVERY_INGRESS_KEY_ID: DISCOVERY_KEY_ID,
    RAVENOS_WALLET_DISCOVERY_INGRESS_HMAC_SECRET: DISCOVERY_SECRET,
  };
  const store = {
    async getReceipt(batchId) { return discoveryReceipts.get(batchId) || null; },
    async ingestBatch(batch, { body_sha256: bodySha256, key_id: keyId }) {
      if (discoveryFailure) throw new Error("fixture_discovery_sink_unavailable");
      let inserted = 0;
      for (const observation of batch.observations) {
        if (!discoveryObservations.has(observation.observation_id)) inserted += 1;
        discoveryObservations.set(observation.observation_id, observation);
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
      discoveryReceipts.set(batch.batch_id, receipt);
      return receipt;
    },
  };
  const fetchImpl = (url, init) => {
    const request = new Request(url, init);
    if (new URL(url).pathname === "/api/internal/v1/wallet-discovery/candidates") {
      return routeSourceWalletDiscoveryIngress(request, env, { store, now: () => Date.parse(NOW) });
    }
    return observer.fetchImpl(url, init);
  };
  return {
    fetchImpl,
    observer,
    discoveryObservations,
    discoveryReceipts,
    setDiscoveryFailure(value) { discoveryFailure = value; },
  };
}

function credentials() {
  return { key_id: KEY_ID, secret: SECRET };
}

function tempState(t) {
  const directory = mkdtempSync(join(tmpdir(), "ravenos-nexus-ingress-client-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return {
    directory,
    event_path: join(directory, "events.jsonl"),
    checkpoint_path: join(directory, "receiver-checkpoint.json"),
    manifest_ack_path: join(directory, "active-manifest-ack.json"),
    health_path: join(directory, "receiver-health.json"),
  };
}

function daemonConfig(paths) {
  return {
    state_directory: paths.directory,
    event_path: paths.event_path,
    checkpoint_path: paths.checkpoint_path,
    manifest_ack_path: paths.manifest_ack_path,
    health_path: paths.health_path,
    ingress_origin: "https://ingest.ravenos.xyz",
    credentials: credentials(),
    poll_interval_ms: 500,
    maximum_backoff_ms: 30_000,
  };
}

function discoveryDaemonConfig(paths) {
  return {
    ...daemonConfig(paths),
    discovery: {
      enabled: true,
      ingress_origin: "https://ingest.ravenos.xyz",
      credentials: { key_id: DISCOVERY_KEY_ID, secret: DISCOVERY_SECRET },
    },
  };
}

test("Nexus client authenticates manifest retrieval and delivery batches end to end", async () => {
  const harness = routeHarness();
  const manifest = await fetchConstantKNexusWatchManifest({
    ingress_origin: "https://ingest.ravenos.xyz",
    credentials: credentials(),
    fetch_impl: harness.fetchImpl,
    now: new Date(NOW),
  });
  assert.equal(manifest.wallet_count, 1);
  const result = await postConstantKNexusDeliveries({
    ingress_origin: "https://ingest.ravenos.xyz",
    credentials: credentials(),
    deliveries: [delivery()],
    manifest,
    receiver_checkpoint: { cursor: { device: 1, inode: 2, offset: 3 } },
    fetch_impl: harness.fetchImpl,
    sent_at: NOW,
    now: new Date(NOW),
  });
  assert.equal(result.batches, 1);
  assert.equal(result.deliveries, 1);
  assert.equal(result.inserted, 1);
  assert.equal(harness.deliveries.size, 1);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(WALLET), false);
  assert.equal(serialized.includes(signature(1)), false);
  assert.equal(serialized.includes(SECRET), false);
});

test("receiver daemon tails first, then posts new Nexus rows before advancing its checkpoint", async (t) => {
  const paths = tempState(t);
  const harness = routeHarness();
  const manifest = buildSourceWalletWatchManifest([WALLET], { generated_at: NOW });
  writeFileSync(paths.event_path, `${JSON.stringify(transaction(1))}\n`, { mode: 0o600 });
  writeFileSync(paths.manifest_ack_path, JSON.stringify({
    schema_version: SOURCE_WALLET_WATCH_MANIFEST_ACK_SCHEMA,
    active_manifest_hash: manifest.manifest_hash,
    coverage_state: "current",
    wallet_count: manifest.wallet_count,
    shard_count: manifest.shard_count,
    activated_at: NOW,
  }), { mode: 0o600 });

  const first = await runConstantKWalletObserverReceiverCycle(daemonConfig(paths), {
    fetch_impl: harness.fetchImpl,
    now: () => new Date(NOW),
  });
  assert.equal(first.state, "idle");
  assert.equal(first.source.initial_history_truncated, true);
  assert.equal(harness.deliveries.size, 0);
  const initialCheckpoint = JSON.parse(readFileSync(paths.checkpoint_path, "utf8"));

  appendFileSync(paths.event_path, `${JSON.stringify(transaction(2))}\n`);
  const second = await runConstantKWalletObserverReceiverCycle(daemonConfig(paths), {
    fetch_impl: harness.fetchImpl,
    now: () => new Date(NOW),
  });
  assert.equal(second.state, "current");
  assert.equal(second.ingress.deliveries, 1);
  assert.equal(second.ingress.inserted, 1);
  assert.equal(harness.deliveries.size, 1);
  const nextCheckpoint = JSON.parse(readFileSync(paths.checkpoint_path, "utf8"));
  assert.ok(nextCheckpoint.cursor.offset > initialCheckpoint.cursor.offset);
  assert.equal(nextCheckpoint.counters.references_ingested, 1);
  assert.equal(JSON.stringify(second).includes(WALLET), false);
  assert.equal(JSON.stringify(second).includes(signature(2)), false);
});

test("receiver leaves the prior checkpoint intact when durable HTTP ingress refuses a batch", async (t) => {
  const paths = tempState(t);
  const goodHarness = routeHarness();
  const manifest = buildSourceWalletWatchManifest([WALLET], { generated_at: NOW });
  writeFileSync(paths.event_path, "", { mode: 0o600 });
  writeFileSync(paths.manifest_ack_path, JSON.stringify({
    schema_version: SOURCE_WALLET_WATCH_MANIFEST_ACK_SCHEMA,
    active_manifest_hash: manifest.manifest_hash,
    coverage_state: "current",
    wallet_count: manifest.wallet_count,
    shard_count: manifest.shard_count,
    activated_at: NOW,
  }), { mode: 0o600 });
  await runConstantKWalletObserverReceiverCycle(daemonConfig(paths), {
    fetch_impl: goodHarness.fetchImpl,
    now: () => new Date(NOW),
  });
  const before = readFileSync(paths.checkpoint_path, "utf8");
  appendFileSync(paths.event_path, `${JSON.stringify(transaction(3))}\n`);
  const failingHarness = routeHarness({ failDelivery: true });
  await assert.rejects(() => runConstantKWalletObserverReceiverCycle(daemonConfig(paths), {
    fetch_impl: failingHarness.fetchImpl,
    now: () => new Date(NOW),
  }), /observer_ingress_unavailable/);
  assert.equal(readFileSync(paths.checkpoint_path, "utf8"), before);
  assert.equal(failingHarness.receipts.size, 0);
});

test("one Nexus cursor advances only after watched deliveries and off-universe discovery are both durably receipted", async (t) => {
  const paths = tempState(t);
  const harness = dualRouteHarness({ failDiscovery: true });
  const manifest = buildSourceWalletWatchManifest([WALLET], { generated_at: NOW });
  writeFileSync(paths.event_path, "", { mode: 0o600 });
  writeFileSync(paths.manifest_ack_path, JSON.stringify({
    schema_version: SOURCE_WALLET_WATCH_MANIFEST_ACK_SCHEMA,
    active_manifest_hash: manifest.manifest_hash,
    coverage_state: "current",
    wallet_count: manifest.wallet_count,
    shard_count: manifest.shard_count,
    activated_at: NOW,
  }), { mode: 0o600 });
  await runConstantKWalletObserverReceiverCycle(discoveryDaemonConfig(paths), {
    fetch_impl: harness.fetchImpl,
    now: () => new Date(NOW),
  });
  const before = readFileSync(paths.checkpoint_path, "utf8");

  appendFileSync(paths.event_path, `${JSON.stringify(transaction(4))}\n${JSON.stringify(discoveryTransaction(4))}\n`);
  await assert.rejects(() => runConstantKWalletObserverReceiverCycle(discoveryDaemonConfig(paths), {
    fetch_impl: harness.fetchImpl,
    now: () => new Date(NOW),
  }), /wallet_discovery_unavailable/);
  assert.equal(readFileSync(paths.checkpoint_path, "utf8"), before);
  assert.equal(harness.observer.deliveries.size, 1);
  assert.equal(harness.discoveryObservations.size, 0);

  harness.setDiscoveryFailure(false);
  const recovered = await runConstantKWalletObserverReceiverCycle(discoveryDaemonConfig(paths), {
    fetch_impl: harness.fetchImpl,
    now: () => new Date(NOW),
  });
  assert.equal(recovered.ingress.duplicates, 1);
  assert.equal(recovered.discovery.inserted, 1);
  assert.equal(recovered.discovery.unique_candidates_seen, 1);
  assert.equal(harness.observer.deliveries.size, 1);
  assert.equal(harness.discoveryObservations.size, 1);
  assert.notEqual(readFileSync(paths.checkpoint_path, "utf8"), before);
  assert.equal(JSON.stringify(recovered).includes(DISCOVERY_WALLET), false);
  assert.equal(JSON.stringify(recovered).includes(signature(24)), false);
});

test("receiver refuses to read Nexus when the provider has not acknowledged the exact manifest", async (t) => {
  const paths = tempState(t);
  const harness = routeHarness();
  const manifest = buildSourceWalletWatchManifest([WALLET], { generated_at: NOW });
  writeFileSync(paths.event_path, `${JSON.stringify(transaction())}\n`, { mode: 0o600 });
  writeFileSync(paths.manifest_ack_path, JSON.stringify({
    schema_version: SOURCE_WALLET_WATCH_MANIFEST_ACK_SCHEMA,
    active_manifest_hash: "f".repeat(40),
    coverage_state: "current",
    wallet_count: manifest.wallet_count,
    shard_count: manifest.shard_count,
    activated_at: NOW,
  }), { mode: 0o600 });
  await assert.rejects(() => runConstantKWalletObserverReceiverCycle(daemonConfig(paths), {
    fetch_impl: harness.fetchImpl,
    now: () => new Date(NOW),
  }), /source_wallet_manifest_not_active/);
  assert.equal(harness.deliveries.size, 0);
  assert.equal(existsSync(paths.checkpoint_path), false);
});
