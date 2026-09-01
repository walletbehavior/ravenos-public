import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import bs58 from "bs58";

import {
  createSourceWalletObserverDelivery,
} from "../lib/customer_trade/source_wallet_observer.mjs";
import {
  buildSourceWalletWatchManifest,
} from "../lib/customer_trade/source_wallet_watch_manifest.mjs";
import {
  SOURCE_WALLET_INGRESS_BATCH_SCHEMA,
  createSourceWalletIngressBatch,
  signSourceWalletIngressRequest,
} from "../lib/customer_trade/source_wallet_ingress_protocol.mjs";
import {
  SOURCE_WALLET_INGRESS_DELIVERIES_ROUTE,
  SOURCE_WALLET_INGRESS_MANIFEST_ROUTE,
  resolveSourceWalletIngressActivation,
  routeSourceWalletIngress,
} from "../lib/customer_trade/source_wallet_ingress.mjs";

const WALLET = bs58.encode(Buffer.alloc(32, 71));
const OTHER_WALLET = bs58.encode(Buffer.alloc(32, 72));
const SECRET = "fixture-observer-ingress-secret-with-at-least-32-bytes";
const KEY_ID = "nexus-2026-09-a";
const NOW = "2026-09-01T12:00:00.000Z";

function signature(value) {
  return bs58.encode(Buffer.alloc(64, value));
}

function delivery({ wallet = WALLET, value = 1, receivedAt = NOW } = {}) {
  return createSourceWalletObserverDelivery({
    wallet_address: wallet,
    signature: signature(value),
    slot: 443_500_000 + value,
    finality: "processed",
    provider: "constant_k_nexus",
    transport: "geyser_grpc",
    provider_observed_at: receivedAt,
    raven_received_at: receivedAt,
    evidence_reference: `solana:signature:${signature(value)}`,
  }, { received_at: receivedAt });
}

function activeEnv(overrides = {}) {
  return {
    RAVENOS_WALLET_OBSERVER_INGRESS_ENABLED: "1",
    RAVENOS_WALLET_INTELLIGENCE_ENABLED: "1",
    RAVENOS_WALLET_OBSERVER_ENABLED: "1",
    RAVENOS_WALLET_OBSERVER_INGRESS_HOST: "ingest.ravenos.xyz",
    RAVENOS_WALLET_OBSERVER_INGRESS_KEY_ID: KEY_ID,
    RAVENOS_WALLET_OBSERVER_INGRESS_HMAC_SECRET: SECRET,
    ...overrides,
  };
}

function memoryDeps(wallets = [WALLET], { failAt = null } = {}) {
  const receipts = new Map();
  const deliveries = new Map();
  let calls = 0;
  let manifestCalls = 0;
  return {
    state: { receipts, deliveries, get calls() { return calls; }, get manifestCalls() { return manifestCalls; } },
    now: () => Date.parse(NOW),
    walletStore: {
      async listObserverWatchUniverse() { manifestCalls += 1; return wallets; },
    },
    observerStore: {
      async ingestDelivery(row) {
        calls += 1;
        if (failAt === calls) throw new Error("fixture_ingress_sink_failed");
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
}

async function signedRequest(path, {
  method = "GET",
  body = "",
  requestId = `swim_${"a".repeat(24)}`,
  secret = SECRET,
  timestampSeconds = Math.floor(Date.parse(NOW) / 1_000),
  host = "ingest.ravenos.xyz",
  extraHeaders = {},
} = {}) {
  const signed = await signSourceWalletIngressRequest({
    method,
    path,
    body,
    key_id: KEY_ID,
    secret,
    request_id: requestId,
    timestamp_seconds: timestampSeconds,
  });
  return new Request(`https://${host}${path}`, {
    method,
    headers: {
      ...signed,
      ...(method === "POST" ? { "content-type": "application/json" } : {}),
      ...extraHeaders,
    },
    body: method === "POST" ? body : undefined,
  });
}

async function signedBatchRequest(batch, options = {}) {
  const body = options.body || JSON.stringify(batch);
  return signedRequest(SOURCE_WALLET_INGRESS_DELIVERIES_ROUTE, {
    method: "POST",
    body,
    requestId: batch.batch_id,
    ...options,
  });
}

async function batchFor(deliveries, { manifest = buildSourceWalletWatchManifest([WALLET], { generated_at: NOW }) } = {}) {
  return createSourceWalletIngressBatch({
    deliveries,
    watch_manifest_hash: manifest.manifest_hash,
    coverage_acknowledged_at: NOW,
    receiver_checkpoint_reference: `ckr_${"b".repeat(40)}`,
    sent_at: NOW,
  });
}

test("ingress activation remains dormant unless intelligence and observer gates agree", () => {
  assert.deepEqual(resolveSourceWalletIngressActivation({}), {
    configured: false,
    manifest: false,
    ingest: false,
    research_cohort_requested: false,
    research_cohort_manifest: false,
    signing: false,
    submission: false,
    broadcasting: false,
    custody: false,
    live_copy: false,
    fee_collection: false,
  });
  assert.equal(resolveSourceWalletIngressActivation(activeEnv()).ingest, true);
  assert.equal(resolveSourceWalletIngressActivation(activeEnv({ RAVENOS_WALLET_OBSERVER_ENABLED: "0" })).manifest, true);
  assert.equal(resolveSourceWalletIngressActivation(activeEnv({ RAVENOS_WALLET_OBSERVER_ENABLED: "0" })).ingest, false);
  assert.equal(resolveSourceWalletIngressActivation(activeEnv({ RAVENOS_WALLET_RESEARCH_COHORT_ENABLED: "1" })).research_cohort_manifest, true);
});

test("disabled and wrong-host ingress stays indistinguishable from a missing route", async () => {
  const deps = memoryDeps();
  const request = await signedRequest(SOURCE_WALLET_INGRESS_MANIFEST_ROUTE);
  assert.equal((await routeSourceWalletIngress(request, {}, deps)).status, 404);
  const wrongHost = await signedRequest(SOURCE_WALLET_INGRESS_MANIFEST_ROUTE, { host: "app.ravenos.xyz" });
  assert.equal((await routeSourceWalletIngress(wrongHost, activeEnv(), deps)).status, 404);
  assert.equal(deps.state.calls, 0);
});

test("authenticated manifest exposes only the exact public wallet universe", async () => {
  const deps = memoryDeps([WALLET, OTHER_WALLET]);
  const request = await signedRequest(SOURCE_WALLET_INGRESS_MANIFEST_ROUTE);
  const response = await routeSourceWalletIngress(request, activeEnv(), deps);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.wallet_count, 2);
  assert.deepEqual(payload.shards.flatMap((row) => row.addresses).sort(), [WALLET, OTHER_WALLET].sort());
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes("subscriber"), true);
  assert.equal(payload.privacy.subscriber_identity_included, false);
  assert.equal(serialized.includes("user_id"), false);
  assert.equal(serialized.includes("policy"), true);
  assert.equal(payload.privacy.policy_included, false);
});

test("valid signed Nexus batch reaches the durable observer sink once", async () => {
  const deps = memoryDeps();
  const batch = await batchFor([delivery()]);
  assert.equal(batch.schema_version, SOURCE_WALLET_INGRESS_BATCH_SCHEMA);
  const response = await routeSourceWalletIngress(await signedBatchRequest(batch), activeEnv(), deps);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.accepted, true);
  assert.equal(payload.receipt.inserted_count, 1);
  assert.equal(payload.receipt.duplicate_count, 0);
  assert.equal(payload.receipt.replayed, false);
  assert.equal(deps.state.calls, 1);
  assert.equal(payload.execution_boundary.broadcasting, false);
  assert.equal(JSON.stringify(payload).includes(WALLET), false);
  assert.equal(JSON.stringify(payload).includes(signature(1)), false);
});

test("same authenticated body replays from its receipt without touching the observer queue", async () => {
  const deps = memoryDeps();
  const batch = await batchFor([delivery()]);
  const first = await routeSourceWalletIngress(await signedBatchRequest(batch), activeEnv(), deps);
  assert.equal(first.status, 200);
  const replay = await routeSourceWalletIngress(await signedBatchRequest(batch), activeEnv(), deps);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).receipt.replayed, true);
  assert.equal(deps.state.calls, 1);
});

test("high-rate delivery batches reuse one short-lived exact watch manifest", async () => {
  const deps = memoryDeps();
  const first = await batchFor([delivery({ value: 11 })]);
  const second = await batchFor([delivery({ value: 12 })]);
  assert.equal((await routeSourceWalletIngress(await signedBatchRequest(first), activeEnv(), deps)).status, 200);
  assert.equal((await routeSourceWalletIngress(await signedBatchRequest(second), activeEnv(), deps)).status, 200);
  assert.equal(deps.state.calls, 2);
  assert.equal(deps.state.manifestCalls, 1);
});

test("same batch id with changed signed body is rejected as a replay mismatch", async () => {
  const deps = memoryDeps();
  const batch = await batchFor([delivery()]);
  await routeSourceWalletIngress(await signedBatchRequest(batch), activeEnv(), deps);
  const changed = { ...batch, sent_at: "2026-09-01T12:00:01.000Z" };
  const response = await routeSourceWalletIngress(await signedBatchRequest(changed), activeEnv(), deps);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "observer_ingress_batch_replay_mismatch");
  assert.equal(deps.state.calls, 1);
});

test("wrong HMAC, expired request, and optional Access mismatch all fail closed", async () => {
  const deps = memoryDeps();
  const wrong = await signedRequest(SOURCE_WALLET_INGRESS_MANIFEST_ROUTE, { secret: `${SECRET}-wrong` });
  assert.equal((await routeSourceWalletIngress(wrong, activeEnv(), deps)).status, 401);
  const expired = await signedRequest(SOURCE_WALLET_INGRESS_MANIFEST_ROUTE, {
    timestampSeconds: Math.floor(Date.parse(NOW) / 1_000) - 100,
  });
  assert.equal((await routeSourceWalletIngress(expired, activeEnv(), deps)).status, 401);
  const access = await signedRequest(SOURCE_WALLET_INGRESS_MANIFEST_ROUTE, {
    extraHeaders: { "cf-access-client-id": "wrong-client" },
  });
  assert.equal((await routeSourceWalletIngress(access, activeEnv({ RAVENOS_WALLET_OBSERVER_INGRESS_ACCESS_CLIENT_ID: "expected-client" }), deps)).status, 401);
});

test("current server manifest is mandatory and off-universe deliveries cannot enter", async () => {
  const deps = memoryDeps();
  const wrongManifest = buildSourceWalletWatchManifest([OTHER_WALLET], { generated_at: NOW });
  const stale = await batchFor([delivery()], { manifest: wrongManifest });
  const mismatch = await routeSourceWalletIngress(await signedBatchRequest(stale), activeEnv(), deps);
  assert.equal(mismatch.status, 409);
  assert.equal((await mismatch.json()).error, "observer_ingress_manifest_mismatch");
  assert.equal(deps.state.calls, 0);

  const forged = await batchFor([delivery({ wallet: OTHER_WALLET })], {
    manifest: buildSourceWalletWatchManifest([WALLET], { generated_at: NOW }),
  });
  const outside = await routeSourceWalletIngress(await signedBatchRequest(forged), activeEnv(), deps);
  assert.equal(outside.status, 400);
  assert.equal((await outside.json()).error, "observer_ingress_delivery_outside_manifest");
  assert.equal(deps.state.calls, 0);
});

test("raw or normalized transaction material is refused at ingress", async () => {
  const deps = memoryDeps();
  const base = delivery();
  for (const changedDelivery of [
    { ...base, raw_provider_payload: { forbidden: true } },
    { ...base, normalized_event: { forbidden: true }, decode_required: false },
  ]) {
    const rawBatch = {
      ...(await batchFor([base])),
      deliveries: [changedDelivery],
    };
    const response = await routeSourceWalletIngress(await signedBatchRequest(rawBatch), activeEnv(), deps);
    assert.equal(response.status, 400);
  }
  assert.equal(deps.state.calls, 0);
});

test("partial sink failure records no receipt and leaves the batch replayable", async () => {
  const deps = memoryDeps([WALLET], { failAt: 2 });
  const batch = await batchFor([delivery({ value: 1 }), delivery({ value: 2 })]);
  const response = await routeSourceWalletIngress(await signedBatchRequest(batch), activeEnv(), deps);
  assert.equal(response.status, 503);
  assert.equal(deps.state.receipts.size, 0);
  assert.equal(deps.state.deliveries.size, 1);
});

test("oversized bodies are rejected before parsing or persistence", async () => {
  const deps = memoryDeps();
  const body = JSON.stringify({ padding: "x".repeat(400 * 1024) });
  const request = new Request(`https://ingest.ravenos.xyz${SOURCE_WALLET_INGRESS_DELIVERIES_ROUTE}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  const response = await routeSourceWalletIngress(request, activeEnv(), deps);
  assert.equal(response.status, 413);
  assert.equal(deps.state.calls, 0);
});

test("ingress migration preserves append-only replay receipts and hard execution fences", () => {
  const sql = readFileSync(new URL("../customer-migrations/0013_source_wallet_ingress.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE ravenos_source_wallet_ingress_batches/i);
  assert.match(sql, /body_sha256 TEXT NOT NULL/i);
  assert.match(sql, /duplicate_count INTEGER NOT NULL CHECK \(duplicate_count = delivery_count - inserted_count\)/i);
  assert.match(sql, /CREATE TRIGGER ravenos_source_wallet_ingress_batches_append_only/i);
  assert.match(sql, /json_extract\(receipt_json, '\$\.signing_authorized'\) = 0/i);
  assert.match(sql, /json_extract\(receipt_json, '\$\.broadcasting_authorized'\) = 0/i);
  assert.match(sql, /json_extract\(receipt_json, '\$\.live_copy_authorized'\) = 0/i);
});
