#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { postConstantKNexusWalletDiscoveryObservations } from "../lib/customer_trade/constant_k_nexus_wallet_ingress_client.mjs";
import {
  ConstantKNexusCandidateCensusLimits,
  createConstantKNexusCandidateCensus,
} from "../lib/customer_trade/constant_k_nexus_wallet_candidate_census.mjs";
import {
  normalizeConstantKNexusDiscoveryCoverageAcknowledgement,
  normalizeConstantKNexusDiscoveryCoverageManifest,
} from "../lib/customer_trade/constant_k_nexus_discovery_coverage.mjs";
import { discoverConstantKNexusWalletCandidates } from "../lib/customer_trade/constant_k_nexus_wallet_discovery.mjs";
import {
  CONSTANT_K_NEXUS_RECEIVER_CHECKPOINT_SCHEMA,
  ConstantKNexusReceiverLimits,
  normalizeConstantKNexusReceiverCheckpoint,
  readConstantKNexusEventFileBatch,
} from "../lib/customer_trade/constant_k_nexus_wallet_receiver.mjs";

export const CONSTANT_K_NEXUS_DISCOVERY_RECEIVER_DAEMON_SCHEMA = "ravenos.constant_k_nexus_wallet_discovery_receiver_daemon.v1";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function cleanError(error) {
  const value = String(error?.code || error?.message || "constant_k_discovery_receiver_failed")
    .replace(/[^a-zA-Z0-9_.:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
  return value || "constant_k_discovery_receiver_failed";
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

function digest(value) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 24);
}

function discoveryReaderScopeHash(coverageHash) {
  return createHash("sha256")
    .update(`ravenos:constant-k:wallet-discovery-firehose:v2:${coverageHash}`)
    .digest("hex")
    .slice(0, 24);
}

function sameCursor(left, right) {
  return Boolean(left && right)
    && left.device === right.device
    && left.inode === right.inode
    && left.offset === right.offset;
}

function sourceBacklogBytes(eventPath, cursor) {
  try {
    const current = statSync(eventPath);
    if (Number(current.dev) === cursor.device && Number(current.ino) === cursor.inode) {
      return Math.max(0, current.size - cursor.offset);
    }
    const rotated = statSync(`${eventPath}.1`);
    if (Number(rotated.dev) === cursor.device && Number(rotated.ino) === cursor.inode) {
      return Math.max(0, rotated.size - cursor.offset) + current.size;
    }
  } catch {
    // The next read owns continuity enforcement. Health reports unknown during
    // a concurrent rotation instead of guessing about backlog.
  }
  return null;
}

function latestObservationCursor(observations = [], prior = null) {
  let latest = null;
  for (const row of observations) {
    if (!latest || row.slot > latest.slot || (row.slot === latest.slot && row.signature.localeCompare(latest.signature) > 0)) {
      latest = row;
    }
  }
  return {
    slot: latest?.slot ?? prior?.last_provider_slot ?? null,
    signature_reference: latest?.signature
      ? `solana_signature_${digest(latest.signature)}`
      : prior?.last_signature_reference || null,
  };
}

function nextCheckpoint({ prior, batch, observations, observedAt, coverageScopeHash }) {
  const providerCursor = latestObservationCursor(observations, prior);
  const counters = prior?.counters || {};
  return normalizeConstantKNexusReceiverCheckpoint({
    schema_version: CONSTANT_K_NEXUS_RECEIVER_CHECKPOINT_SCHEMA,
    source_id: batch.source_id,
    cursor: batch.cursor,
    // The shared reader schema calls this a watch hash. Here it is a stable
    // scope discriminator for the independent discovery cursor; it does not
    // claim that Nexus is observing Raven's exact watch manifest.
    watch_universe_hash: coverageScopeHash,
    last_provider_slot: providerCursor.slot,
    last_signature_reference: providerCursor.signature_reference,
    initial_history_truncated: batch.initial_history_truncated === true || prior?.initial_history_truncated === true,
    counters: {
      cycles: Number(counters.cycles || 0) + 1,
      bytes_committed: Number(counters.bytes_committed || 0) + batch.bytes_committed,
      lines_committed: Number(counters.lines_committed || 0) + batch.lines_committed,
      references_ingested: Number(counters.references_ingested || 0) + observations.length,
      invalid_lines: Number(counters.invalid_lines || 0) + batch.parse_failures + batch.oversized_lines,
    },
    created_at: prior?.created_at || observedAt,
    updated_at: observedAt,
  });
}

export function constantKWalletDiscoveryReceiverSettings(env = process.env) {
  if (String(env.RAVENOS_WALLET_DISCOVERY_FIREHOSE_RECEIVER_ENABLED || "") !== "1") {
    fail("constant_k_discovery_firehose_receiver_disabled");
  }
  const stateDirectory = exactAbsolutePath(
    env.RAVENOS_WALLET_DISCOVERY_FIREHOSE_STATE_DIR || "/var/lib/ravenos-wallet-discovery",
    "constant_k_discovery_receiver_state_directory_invalid",
  );
  const ingressOrigin = String(env.RAVENOS_WALLET_DISCOVERY_INGRESS_ORIGIN || "").trim();
  const keyId = String(env.RAVENOS_WALLET_DISCOVERY_INGRESS_KEY_ID || "").trim();
  const secret = String(env.RAVENOS_WALLET_DISCOVERY_INGRESS_HMAC_SECRET || "");
  if (!ingressOrigin || !keyId || !secret) fail("constant_k_discovery_receiver_credentials_invalid");
  return Object.freeze({
    state_directory: stateDirectory,
    event_path: exactAbsolutePath(env.RAVENOS_CONSTANT_K_EVENT_PATH, "constant_k_discovery_receiver_event_path_invalid"),
    checkpoint_path: statePath(
      env.RAVENOS_WALLET_DISCOVERY_FIREHOSE_CHECKPOINT_PATH || `${stateDirectory}/receiver-checkpoint.json`,
      stateDirectory,
      "constant_k_discovery_receiver_checkpoint_path_invalid",
    ),
    health_path: statePath(
      env.RAVENOS_WALLET_DISCOVERY_FIREHOSE_HEALTH_PATH || `${stateDirectory}/receiver-health.json`,
      stateDirectory,
      "constant_k_discovery_receiver_health_path_invalid",
    ),
    coverage_manifest_path: statePath(
      env.RAVENOS_WALLET_DISCOVERY_FIREHOSE_COVERAGE_MANIFEST_PATH || `${stateDirectory}/coverage-manifest.json`,
      stateDirectory,
      "constant_k_discovery_receiver_coverage_manifest_path_invalid",
    ),
    provider_acknowledgement_path: statePath(
      env.RAVENOS_WALLET_DISCOVERY_FIREHOSE_PROVIDER_ACK_PATH || `${stateDirectory}/provider-coverage-ack.json`,
      stateDirectory,
      "constant_k_discovery_receiver_provider_ack_path_invalid",
    ),
    candidate_census_path: statePath(
      env.RAVENOS_WALLET_DISCOVERY_FIREHOSE_CENSUS_PATH || `${stateDirectory}/candidate-census.sqlite`,
      stateDirectory,
      "constant_k_discovery_receiver_census_path_invalid",
    ),
    candidate_census_limits: Object.freeze({
      minimum_observations: boundedInteger(
        env.RAVENOS_WALLET_DISCOVERY_FIREHOSE_MINIMUM_OBSERVATIONS,
        ConstantKNexusCandidateCensusLimits.minimum_observations,
        2,
        20,
        "constant_k_discovery_receiver_minimum_observations_invalid",
      ),
      minimum_distinct_mints: boundedInteger(
        env.RAVENOS_WALLET_DISCOVERY_FIREHOSE_MINIMUM_DISTINCT_MINTS,
        ConstantKNexusCandidateCensusLimits.minimum_distinct_mints,
        2,
        20,
        "constant_k_discovery_receiver_minimum_mints_invalid",
      ),
      minimum_observation_span_seconds: boundedInteger(
        env.RAVENOS_WALLET_DISCOVERY_FIREHOSE_MINIMUM_SPAN_SECONDS,
        ConstantKNexusCandidateCensusLimits.minimum_observation_span_seconds,
        0,
        24 * 60 * 60,
        "constant_k_discovery_receiver_minimum_span_invalid",
      ),
      maximum_promotion_rounds_per_hour: boundedInteger(
        env.RAVENOS_WALLET_DISCOVERY_FIREHOSE_MAXIMUM_PROMOTIONS_PER_HOUR,
        ConstantKNexusCandidateCensusLimits.maximum_promotion_rounds_per_hour,
        1,
        10_000,
        "constant_k_discovery_receiver_hour_budget_invalid",
      ),
      maximum_promotion_rounds_per_day: boundedInteger(
        env.RAVENOS_WALLET_DISCOVERY_FIREHOSE_MAXIMUM_PROMOTIONS_PER_DAY,
        ConstantKNexusCandidateCensusLimits.maximum_promotion_rounds_per_day,
        1,
        100_000,
        "constant_k_discovery_receiver_day_budget_invalid",
      ),
    }),
    ingress_origin: ingressOrigin,
    credentials: Object.freeze({
      key_id: keyId,
      secret,
      access_client_id: String(env.RAVENOS_WALLET_DISCOVERY_INGRESS_ACCESS_CLIENT_ID || "").trim(),
      access_client_secret: String(env.RAVENOS_WALLET_DISCOVERY_INGRESS_ACCESS_CLIENT_SECRET || "").trim(),
    }),
    maximum_bytes: boundedInteger(
      env.RAVENOS_WALLET_DISCOVERY_FIREHOSE_MAXIMUM_BYTES,
      ConstantKNexusReceiverLimits.maximum_bytes_per_cycle,
      ConstantKNexusReceiverLimits.maximum_line_bytes,
      ConstantKNexusReceiverLimits.maximum_bytes_per_cycle,
      "constant_k_discovery_receiver_maximum_bytes_invalid",
    ),
    maximum_lines: boundedInteger(
      env.RAVENOS_WALLET_DISCOVERY_FIREHOSE_MAXIMUM_LINES,
      ConstantKNexusReceiverLimits.maximum_lines_per_cycle,
      1,
      ConstantKNexusReceiverLimits.maximum_lines_per_cycle,
      "constant_k_discovery_receiver_maximum_lines_invalid",
    ),
    poll_interval_ms: boundedInteger(
      env.RAVENOS_WALLET_DISCOVERY_FIREHOSE_POLL_INTERVAL_MS,
      500,
      100,
      30_000,
      "constant_k_discovery_receiver_poll_interval_invalid",
    ),
    maximum_backoff_ms: boundedInteger(
      env.RAVENOS_WALLET_DISCOVERY_FIREHOSE_MAXIMUM_BACKOFF_MS,
      30_000,
      1_000,
      300_000,
      "constant_k_discovery_receiver_backoff_invalid",
    ),
  });
}

function sanitizedRun({
  batch,
  discovery,
  censusStage,
  censusOutbound,
  censusHealth,
  ingress,
  prior,
  checkpoint,
  observedAt,
  backlogBytes,
  coverage,
}) {
  const degraded = batch.parse_failures > 0 || batch.oversized_lines > 0 || discovery.state === "degraded";
  return Object.freeze({
    schema_version: CONSTANT_K_NEXUS_DISCOVERY_RECEIVER_DAEMON_SCHEMA,
    observed_at: observedAt,
    state: degraded ? "degraded" : batch.lines_committed > 0 ? "current" : "idle",
    continuity: batch.continuity,
    coverage,
    source: Object.freeze({
      event_rows: batch.event_rows,
      lines_committed: batch.lines_committed,
      bytes_committed: batch.bytes_committed,
      parse_failures: batch.parse_failures,
      oversized_lines: batch.oversized_lines,
      backlog_bytes: backlogBytes,
      at_live_tail: backlogBytes === null ? null : backlogBytes === 0,
      initial_history_truncated: checkpoint.initial_history_truncated,
      raw_lines_returned: false,
      raw_provider_payload_persisted: false,
    }),
    discovery: Object.freeze({
      transaction_rows: discovery.counts.transaction_rows,
      qualifying_observations: discovery.counts.candidate_observations,
      unique_candidates_seen: discovery.counts.unique_candidates,
      recurring_candidates_in_batch: discovery.counts.recurring_candidates,
      high_signal_candidates_in_batch: discovery.counts.high_signal_candidates,
      invalid_rows: discovery.counts.invalid_rows,
      exact_watch_coverage_claimed: false,
      chain_wide_coverage_claimed: false,
      normalized_trade_claimed: false,
      profitability_claim_supported: false,
      copyability_claim_supported: false,
    }),
    candidate_census: Object.freeze({
      observations_received: censusStage.received,
      observations_staged: censusStage.unique,
      replay_duplicates: censusStage.duplicates,
      evidence_retained: censusStage.evidence_retained,
      outbound_observations: censusOutbound.queued_observation_count,
      initial_promotion_rounds: censusOutbound.initial_rounds_created,
      refresh_rounds: censusOutbound.refresh_rounds_created,
      candidate_count: censusHealth.candidate_count,
      unpromoted_candidate_count: censusHealth.unpromoted_candidate_count,
      promoted_candidate_count: censusHealth.promoted_candidate_count,
      eligible_candidate_backlog: censusHealth.eligible_candidate_backlog,
      held_evidence_count: censusHealth.evidence.held_count,
      queued_evidence_count: censusHealth.evidence.queued_count,
      promotion_budget: censusHealth.budget,
      admission: censusHealth.admission,
      outcome_data_used: false,
      subscriber_data_used: false,
      addresses_included: false,
      signatures_included: false,
    }),
    ingress: Object.freeze({
      batches: ingress.batches,
      observations: ingress.observations,
      inserted: ingress.inserted,
      duplicates: ingress.duplicates,
      eligible_candidates: ingress.eligible_candidates,
      receipt_ids_included: false,
    }),
    checkpoint: Object.freeze({
      persisted: true,
      advanced: !prior || !sameCursor(prior.cursor, checkpoint.cursor),
      cycles: checkpoint.counters.cycles,
      last_provider_slot: checkpoint.last_provider_slot,
      signature_included: false,
    }),
    privacy: Object.freeze({
      addresses_included: false,
      signatures_included: false,
      raw_provider_payload_included: false,
      subscriber_identity_included: false,
      policy_included: false,
      follower_count_included: false,
      aggregate_capital_included: false,
    }),
    execution_boundary: Object.freeze({
      signing: false,
      submission: false,
      broadcasting: false,
      custody: false,
      live_copy: false,
      fee_collection: false,
    }),
  });
}

export async function runConstantKWalletDiscoveryReceiverCycle(config, {
  fetch_impl: fetchImpl = fetch,
  now = () => new Date(),
  read_batch: readBatch = readConstantKNexusEventFileBatch,
  post_observations: postObservations = postConstantKNexusWalletDiscoveryObservations,
  candidate_census: suppliedCensus = null,
} = {}) {
  const clockValue = typeof now === "function" ? now() : now;
  const cycleDate = clockValue instanceof Date ? clockValue : new Date(clockValue);
  if (!Number.isFinite(cycleDate.getTime())) fail("constant_k_discovery_receiver_clock_invalid");
  const observedAt = cycleDate.toISOString();
  const coverageManifest = normalizeConstantKNexusDiscoveryCoverageManifest(parseJsonFile(
    config.coverage_manifest_path,
    "constant_k_discovery_receiver_coverage_manifest_unavailable",
  ));
  const coverage = normalizeConstantKNexusDiscoveryCoverageAcknowledgement(parseJsonFile(
    config.provider_acknowledgement_path,
    "constant_k_discovery_receiver_provider_ack_unavailable",
  ), coverageManifest, { now: cycleDate });
  const coverageScopeHash = discoveryReaderScopeHash(coverage.coverage_hash);
  const rawPrior = parseJsonFile(config.checkpoint_path, "constant_k_discovery_receiver_checkpoint_invalid", { optional: true });
  const prior = rawPrior ? normalizeConstantKNexusReceiverCheckpoint(rawPrior) : null;
  if (prior && prior.watch_universe_hash !== coverageScopeHash) fail("constant_k_discovery_receiver_checkpoint_scope_invalid");
  const batch = readBatch({
    event_path: config.event_path,
    checkpoint: prior,
    initial_position: "tail",
    maximum_bytes: config.maximum_bytes,
    maximum_lines: config.maximum_lines,
  });
  const discovery = discoverConstantKNexusWalletCandidates({
    events: batch.events,
    watched_wallets: [],
    now: () => cycleDate,
  });
  const checkpoint = nextCheckpoint({
    prior,
    batch,
    observations: discovery.observations,
    observedAt,
    coverageScopeHash,
  });
  const ownsCensus = !suppliedCensus;
  const census = suppliedCensus || createConstantKNexusCandidateCensus({
    database_path: config.candidate_census_path || `${config.state_directory}/candidate-census.sqlite`,
    limits: config.candidate_census_limits,
  });
  try {
    // Raw candidate rows become durable locally before the source cursor can
    // move. One-off activity remains in this outcome-blind census. Only
    // recurring, mint-diverse evidence enters the bounded remote admission
    // frontier, preventing provider throughput from becoming unbounded D1
    // growth or hydration work.
    const censusStage = census.stageObservations(discovery.observations, { now: cycleDate });
    const censusOutbound = census.prepareOutbound({ now: cycleDate });
    const ingress = await postObservations({
      ingress_origin: config.ingress_origin,
      credentials: config.credentials,
      observations: censusOutbound.observations,
      receiver_checkpoint: checkpoint,
      fetch_impl: fetchImpl,
      sent_at: observedAt,
      now: cycleDate,
    });
    census.markDelivered(censusOutbound.observations.map((row) => row.observation_id), { now: cycleDate });
    atomicJson(config.checkpoint_path, checkpoint);
    const backlogBytes = sourceBacklogBytes(config.event_path, checkpoint.cursor);
    const censusHealth = census.health({ now: cycleDate });
    const output = sanitizedRun({
      batch,
      discovery,
      censusStage,
      censusOutbound,
      censusHealth,
      ingress,
      prior,
      checkpoint,
      observedAt,
      backlogBytes,
      coverage,
    });
    atomicJson(config.health_path, output);
    return output;
  } finally {
    if (ownsCensus) census.close();
  }
}

async function main() {
  const config = constantKWalletDiscoveryReceiverSettings(process.env);
  const argumentsList = process.argv.slice(2);
  const once = argumentsList.includes("--once");
  if (argumentsList.some((argument) => argument !== "--once")) fail("constant_k_discovery_receiver_argument_invalid");
  let stopped = false;
  let failures = 0;
  process.on("SIGTERM", () => { stopped = true; });
  process.on("SIGINT", () => { stopped = true; });
  do {
    try {
      const result = await runConstantKWalletDiscoveryReceiverCycle(config);
      failures = 0;
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
      failures += 1;
      const failure = {
        schema_version: CONSTANT_K_NEXUS_DISCOVERY_RECEIVER_DAEMON_SCHEMA,
        observed_at: new Date().toISOString(),
        state: "unavailable",
        error: cleanError(error),
        addresses_included: false,
        signatures_included: false,
        raw_provider_payload_included: false,
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
      const backoff = failures
        ? Math.min(config.maximum_backoff_ms, config.poll_interval_ms * (2 ** Math.min(8, failures)))
        : config.poll_interval_ms;
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
