#!/usr/bin/env node

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import {
  fetchConstantKNexusWatchManifest,
  postConstantKNexusDeliveries,
} from "../lib/customer_trade/constant_k_nexus_wallet_ingress_client.mjs";
import {
  normalizeConstantKNexusReceiverCheckpoint,
  readConstantKNexusEventFileBatch,
} from "../lib/customer_trade/constant_k_nexus_wallet_receiver.mjs";
import { runConstantKNexusWalletPipelineCycle } from "../lib/customer_trade/constant_k_nexus_wallet_pipeline.mjs";
import {
  SOURCE_WALLET_WATCH_MANIFEST_ACK_SCHEMA,
  normalizeSourceWalletWatchManifestAck,
} from "../lib/customer_trade/source_wallet_watch_manifest.mjs";

const RECEIVER_DAEMON_SCHEMA = "ravenos.constant_k_nexus_wallet_receiver_daemon.v1";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function cleanError(error) {
  const value = String(error?.code || error?.message || "constant_k_receiver_daemon_failed")
    .replace(/[^a-zA-Z0-9_.:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
  return value || "constant_k_receiver_daemon_failed";
}

function boundedInteger(value, fallback, minimum, maximum, code) {
  const parsed = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) fail(code);
  return parsed;
}

function exactAbsolutePath(value, code) {
  const input = String(value || "").trim();
  if (!input || !isAbsolute(input) || input.includes("\u0000")) fail(code);
  return resolve(input);
}

function statePath(value, stateDirectory, code) {
  const path = exactAbsolutePath(value, code);
  const boundary = relative(stateDirectory, path);
  if (!boundary || boundary.startsWith("..") || isAbsolute(boundary)) fail(code);
  return path;
}

function parseJsonFile(path, code, { optional = false } = {}) {
  if (optional && !existsSync(path)) return null;
  let value;
  try { value = JSON.parse(readFileSync(path, "utf8")); } catch { fail(code); }
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value;
}

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp.${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "w" });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
}

function settings(env = process.env) {
  if (String(env.RAVENOS_WALLET_OBSERVER_RECEIVER_ENABLED || "") !== "1") fail("constant_k_receiver_daemon_disabled");
  const stateDirectory = exactAbsolutePath(env.RAVENOS_WALLET_OBSERVER_STATE_DIR || "/var/lib/ravenos-wallet-observer", "constant_k_receiver_state_directory_invalid");
  return Object.freeze({
    state_directory: stateDirectory,
    event_path: exactAbsolutePath(env.RAVENOS_CONSTANT_K_EVENT_PATH, "constant_k_receiver_event_path_invalid"),
    checkpoint_path: statePath(
      env.RAVENOS_CONSTANT_K_RECEIVER_CHECKPOINT_PATH || `${stateDirectory}/receiver-checkpoint.json`,
      stateDirectory,
      "constant_k_receiver_checkpoint_path_invalid",
    ),
    manifest_ack_path: statePath(
      env.RAVENOS_CONSTANT_K_MANIFEST_ACK_PATH || `${stateDirectory}/active-manifest-ack.json`,
      stateDirectory,
      "constant_k_receiver_manifest_ack_path_invalid",
    ),
    health_path: statePath(
      env.RAVENOS_CONSTANT_K_RECEIVER_HEALTH_PATH || `${stateDirectory}/receiver-health.json`,
      stateDirectory,
      "constant_k_receiver_health_path_invalid",
    ),
    ingress_origin: String(env.RAVENOS_WALLET_OBSERVER_INGRESS_ORIGIN || "").trim(),
    credentials: Object.freeze({
      key_id: String(env.RAVENOS_WALLET_OBSERVER_INGRESS_KEY_ID || "").trim(),
      secret: String(env.RAVENOS_WALLET_OBSERVER_INGRESS_HMAC_SECRET || ""),
      access_client_id: String(env.RAVENOS_WALLET_OBSERVER_INGRESS_ACCESS_CLIENT_ID || "").trim(),
      access_client_secret: String(env.RAVENOS_WALLET_OBSERVER_INGRESS_ACCESS_CLIENT_SECRET || "").trim(),
    }),
    poll_interval_ms: boundedInteger(env.RAVENOS_CONSTANT_K_RECEIVER_POLL_INTERVAL_MS, 500, 100, 30_000, "constant_k_receiver_poll_interval_invalid"),
    maximum_backoff_ms: boundedInteger(env.RAVENOS_CONSTANT_K_RECEIVER_MAXIMUM_BACKOFF_MS, 30_000, 1_000, 300_000, "constant_k_receiver_backoff_invalid"),
  });
}

function sanitizedRun(run, ingress) {
  return Object.freeze({
    schema_version: RECEIVER_DAEMON_SCHEMA,
    observed_at: new Date().toISOString(),
    state: run.state,
    continuity: run.receiver?.continuity || null,
    manifest: run.manifest,
    coverage: run.coverage,
    source: run.receiver?.source || null,
    transport: run.receiver?.transport || null,
    checkpoint: run.receiver?.checkpoint || null,
    ingress,
    execution_boundary: {
      signing: false,
      submission: false,
      broadcasting: false,
      custody: false,
      live_copy: false,
      fee_collection: false,
    },
  });
}

export async function runConstantKWalletObserverReceiverCycle(config, {
  fetch_impl: fetchImpl = fetch,
  now = () => new Date(),
} = {}) {
  const clockValue = typeof now === "function" ? now() : now;
  const cycleDate = clockValue instanceof Date ? clockValue : new Date(clockValue);
  if (!Number.isFinite(cycleDate.getTime())) fail("constant_k_receiver_clock_invalid");
  const currentManifest = await fetchConstantKNexusWatchManifest({
    ingress_origin: config.ingress_origin,
    credentials: config.credentials,
    fetch_impl: fetchImpl,
    now: cycleDate,
  });
  const watches = currentManifest.shards.flatMap((shard) => shard.addresses);
  let pendingDeliveries = [];
  let ingressSummary = Object.freeze({ batches: 0, deliveries: 0, inserted: 0, duplicates: 0 });
  let activeAck = null;
  const pipeline = await runConstantKNexusWalletPipelineCycle({
    async load_watch_universe() { return watches; },
    async sync_watch_manifest(manifest) {
      if (manifest.manifest_hash !== currentManifest.manifest_hash || manifest.wallet_count !== currentManifest.wallet_count) {
        fail("constant_k_receiver_remote_manifest_changed");
      }
      const rawAck = parseJsonFile(config.manifest_ack_path, "constant_k_receiver_manifest_ack_invalid");
      if (rawAck.schema_version !== SOURCE_WALLET_WATCH_MANIFEST_ACK_SCHEMA) fail("constant_k_receiver_manifest_ack_invalid");
      activeAck = normalizeSourceWalletWatchManifestAck(rawAck, manifest);
      return activeAck;
    },
    async load_checkpoint() {
      const raw = parseJsonFile(config.checkpoint_path, "constant_k_receiver_checkpoint_invalid", { optional: true });
      return raw ? normalizeConstantKNexusReceiverCheckpoint(raw) : null;
    },
    async read_batch({ checkpoint }) {
      return readConstantKNexusEventFileBatch({
        event_path: config.event_path,
        checkpoint,
        initial_position: "tail",
      });
    },
    async ingest_delivery(delivery) {
      pendingDeliveries.push(delivery);
    },
    async save_checkpoint(nextCheckpoint) {
      if (pendingDeliveries.length) {
        ingressSummary = await postConstantKNexusDeliveries({
          ingress_origin: config.ingress_origin,
          credentials: config.credentials,
          deliveries: pendingDeliveries,
          manifest: currentManifest,
          coverage_acknowledged_at: activeAck.activated_at,
          receiver_checkpoint: nextCheckpoint,
          fetch_impl: fetchImpl,
          sent_at: cycleDate.toISOString(),
          now: cycleDate,
        });
      }
      atomicJson(config.checkpoint_path, nextCheckpoint);
      pendingDeliveries = [];
    },
    now: () => cycleDate,
  });
  const output = sanitizedRun(pipeline, {
    batches: ingressSummary.batches,
    deliveries: ingressSummary.deliveries,
    inserted: ingressSummary.inserted,
    duplicates: ingressSummary.duplicates,
    receipt_ids_included: false,
  });
  atomicJson(config.health_path, output);
  return output;
}

async function main() {
  const config = settings(process.env);
  const once = process.argv.includes("--once");
  if (process.argv.some((argument) => argument !== "--once")) fail("constant_k_receiver_argument_invalid");
  let stopped = false;
  let failures = 0;
  process.on("SIGTERM", () => { stopped = true; });
  process.on("SIGINT", () => { stopped = true; });
  do {
    try {
      const result = await runConstantKWalletObserverReceiverCycle(config);
      failures = 0;
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
      failures += 1;
      const failure = {
        schema_version: RECEIVER_DAEMON_SCHEMA,
        observed_at: new Date().toISOString(),
        state: "unavailable",
        error: cleanError(error),
        addresses_included: false,
        signatures_included: false,
        provider_payload_included: false,
        subscriber_identity_included: false,
        execution_boundary: {
          signing: false,
          submission: false,
          broadcasting: false,
          custody: false,
          live_copy: false,
          fee_collection: false,
        },
      };
      atomicJson(config.health_path, failure);
      process.stderr.write(`${JSON.stringify(failure)}\n`);
      if (once) throw error;
    }
    if (!once && !stopped) {
      const backoff = failures ? Math.min(config.maximum_backoff_ms, config.poll_interval_ms * (2 ** Math.min(8, failures))) : config.poll_interval_ms;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, backoff));
    }
  } while (!once && !stopped);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: cleanError(error) })}\n`);
    process.exitCode = 1;
  });
}
