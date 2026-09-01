#!/usr/bin/env node

import { createHash } from "node:crypto";
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  normalizeSolanaWalletAddress,
  normalizeSolanaWalletTransaction,
} from "../lib/customer_trade/solana_wallet_intelligence.mjs";
import { runConstantKNexusWalletStreamBatch } from "../lib/customer_trade/constant_k_nexus_wallet_transport.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const MAX_RESPONSE_BYTES = 1_500 * 1024;
const MAX_TAIL_BYTES = 32 * 1024 * 1024;
const DEFAULT_TAIL_BYTES = 8 * 1024 * 1024;
const MAX_EVENTS = 50_000;
const MAX_WALLETS = 25;
const MAX_HYDRATIONS = 32;
const KNOWN_SWAP_PROGRAMS = new Set([
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB",
  "675kPX9MHTjS2zt1qfr1NYHuzeKDq1Z4mYqPJ1L5S9LC",
  "CPMMoo8L3F4NbTegBCKVNnYhW3T6HhK7V9rD7NmQ1Fj",
  "CAMMCzo5YL8w4VFF8KVHrK22GGUQpB4c4jUxQ3YMpiZ",
  "whirLbMiicVdio4qvUfM5KAg6CtR9bV11MZWdN5L8z1",
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
]);

function clean(value, maximum = 200) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function digest(value) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);
}

function boundedInteger(value, fallback, minimum, maximum, code) {
  const parsed = value === null || value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(code);
  return parsed;
}

function clockIso(now) {
  const value = typeof now === "function" ? now() : now;
  if (value instanceof Date) return value.toISOString();
  if (Number.isFinite(Number(value))) return new Date(Number(value)).toISOString();
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) throw new Error("constant_k_validation_clock_invalid");
  return new Date(parsed).toISOString();
}

function parseArgs(argv) {
  const output = { wallets: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];
    if (!entry.startsWith("--")) throw new Error("constant_k_validation_argument_invalid");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error("constant_k_validation_argument_missing");
    const key = entry.slice(2).replaceAll("-", "_");
    if (key === "wallet") output.wallets.push(value);
    else output[key] = value;
    index += 1;
  }
  return output;
}

function selectedEnvironment(base = process.env) {
  const output = {};
  for (const key of [
    "RAVEN_APP_ENV_PATH",
    "RAVENOS_CONSTANT_K_EVENT_PATH",
    "RAVENOS_SOLANA_RPC_URL",
    "SOLANA_ALCHEMY_RPC_URL",
  ]) {
    if (base[key] !== undefined) output[key] = base[key];
  }
  const path = clean(base.RAVEN_APP_ENV_PATH || join(repoRoot, "..", ".env"), 1_000);
  if (!path || !existsSync(path)) return output;
  const allowed = new Set([
    "RAVENOS_CONSTANT_K_EVENT_PATH",
    "RAVENOS_SOLANA_RPC_URL",
    "SOLANA_ALCHEMY_RPC_URL",
  ]);
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const boundary = trimmed.indexOf("=");
    const key = trimmed.slice(0, boundary).trim().replace(/^export\s+/, "");
    if (!allowed.has(key) || clean(output[key], 2_000)) continue;
    let value = trimmed.slice(boundary + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    output[key] = value;
  }
  return output;
}

function readTailEvents(path, maximumBytes) {
  const descriptor = openSync(path, "r");
  try {
    const size = fstatSync(descriptor).size;
    const length = Math.min(size, maximumBytes);
    const buffer = Buffer.alloc(length);
    readSync(descriptor, buffer, 0, length, Math.max(0, size - length));
    const text = buffer.toString("utf8");
    const complete = size > length ? text.slice(text.indexOf("\n") + 1) : text;
    const lines = complete.split(/\r?\n/).filter(Boolean).slice(-MAX_EVENTS);
    const events = [];
    let parseFailures = 0;
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("invalid");
        events.push(row);
      } catch {
        parseFailures += 1;
      }
    }
    return { events, lines_read: lines.length, parse_failures: parseFailures, bytes_read: length };
  } finally {
    closeSync(descriptor);
  }
}

function compactSwapEvidence(row) {
  return row?.event === "solana_grpc_transaction"
    && row?.provider === "constant_k"
    && Array.isArray(row.programs)
    && row.programs.some((program) => KNOWN_SWAP_PROGRAMS.has(String(program || "")))
    && Array.isArray(row.joint_entity_token_balance_deltas)
    && row.joint_entity_token_balance_deltas.length >= 2
    && row.joint_entity_token_balance_deltas_complete === true;
}

function autoSelectWallets(events, maximum) {
  const selected = [];
  const seen = new Set();
  for (const requireSwapEvidence of [true, false]) {
    for (let index = events.length - 1; index >= 0 && selected.length < maximum; index -= 1) {
      const row = events[index];
      if (row?.event !== "solana_grpc_transaction" || row?.provider !== "constant_k") continue;
      if (requireSwapEvidence !== compactSwapEvidence(row)) continue;
      for (const value of Array.isArray(row.matched_identity_signers) ? row.matched_identity_signers : []) {
        try {
          const address = normalizeSolanaWalletAddress(value);
          if (seen.has(address)) continue;
          seen.add(address);
          selected.push(address);
          if (selected.length >= maximum) break;
        } catch {
          // A malformed candidate is excluded from the validation cohort.
        }
      }
    }
  }
  return selected;
}

async function boundedJson(url, init = {}, {
  fetch_impl: fetchImpl = fetch,
  timeout_ms: timeoutMs = 8_000,
  maximum_bytes: maximumBytes = MAX_RESPONSE_BYTES,
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("provider_timeout")), timeoutMs);
  try {
    const response = await fetchImpl(url, { redirect: "error", ...init, signal: controller.signal });
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > maximumBytes) throw new Error("provider_response_too_large");
    const body = await response.arrayBuffer();
    if (body.byteLength > maximumBytes) throw new Error("provider_response_too_large");
    let payload;
    try {
      payload = JSON.parse(new TextDecoder().decode(body));
    } catch {
      throw new Error("provider_response_malformed");
    }
    if (!response.ok) throw new Error(response.status === 429 ? "provider_rate_limited" : response.status === 401 || response.status === 403 ? "provider_authorization_failed" : "provider_unavailable");
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function createRpc(rpcUrl, providerCalls, fetchImpl) {
  return async (method, params) => {
    providerCalls.solana_rpc += 1;
    const payload = await boundedJson(rpcUrl, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: providerCalls.solana_rpc, method, params }),
    }, { fetch_impl: fetchImpl });
    if (payload?.error || !Object.hasOwn(payload || {}, "result")) throw new Error("solana_rpc_response_invalid");
    return payload.result;
  };
}

async function runPool(rows, concurrency, operation) {
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, rows.length || 1)) }, async () => {
    while (cursor < rows.length) {
      const index = cursor;
      cursor += 1;
      await operation(rows[index]);
    }
  });
  await Promise.all(workers);
}

function metric(values) {
  const rows = values.filter(Number.isFinite).sort((left, right) => left - right);
  const percentile = (value) => rows.length ? rows[Math.max(0, Math.ceil((value / 100) * rows.length) - 1)] : null;
  return {
    available: rows.length > 0,
    samples: rows.length,
    p50_ms: percentile(50),
    p90_ms: percentile(90),
    p95_ms: percentile(95),
    p99_ms: percentile(99),
  };
}

function classificationCounts(events) {
  const counts = {};
  for (const event of events) counts[event.classification.kind] = (counts[event.classification.kind] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

export async function runConstantKWalletObserverLiveValidation(input = {}, {
  env = process.env,
  fetch_impl: fetchImpl = fetch,
  now = () => new Date(),
} = {}) {
  const selected = selectedEnvironment(env);
  const maximumTailBytes = boundedInteger(input.tail_bytes, DEFAULT_TAIL_BYTES, 64 * 1024, MAX_TAIL_BYTES, "constant_k_validation_tail_bytes_invalid");
  const suppliedEvents = Array.isArray(input.events) ? { events: input.events, lines_read: input.events.length, parse_failures: 0, bytes_read: null } : null;
  const eventPath = clean(input.event_path || selected.RAVENOS_CONSTANT_K_EVENT_PATH, 1_000);
  if (!suppliedEvents && (!eventPath || !existsSync(eventPath))) throw new Error("constant_k_validation_event_path_required");
  const captureInput = suppliedEvents || readTailEvents(eventPath, maximumTailBytes);
  const requestedWallets = Array.isArray(input.wallets) ? input.wallets : input.wallet ? [input.wallet] : [];
  const autoWatches = boundedInteger(input.auto_watches, 5, 0, MAX_WALLETS, "constant_k_validation_auto_watches_invalid");
  const wallets = [...new Set((requestedWallets.length ? requestedWallets : autoSelectWallets(captureInput.events, autoWatches)).map(normalizeSolanaWalletAddress))];
  if (!wallets.length || wallets.length > MAX_WALLETS) throw new Error("constant_k_validation_wallet_count_invalid");
  const deliveries = [];
  const adapter = await runConstantKNexusWalletStreamBatch({
    watches: wallets,
    events: captureInput.events,
    now,
    async ingest_delivery(delivery) { deliveries.push(delivery); },
  });

  const hydrateLimit = boundedInteger(input.hydrate, Math.min(12, deliveries.length), 0, MAX_HYDRATIONS, "constant_k_validation_hydrate_invalid");
  const rpcUrl = clean(selected.RAVENOS_SOLANA_RPC_URL || selected.SOLANA_ALCHEMY_RPC_URL, 2_000);
  if (hydrateLimit > 0 && !rpcUrl) throw new Error("constant_k_validation_rpc_configuration_required");
  const providerCalls = { solana_rpc: 0 };
  const rpc = rpcUrl ? createRpc(rpcUrl, providerCalls, fetchImpl) : null;
  const swapLikeSignatures = new Set(captureInput.events.filter(compactSwapEvidence).map((row) => String(row.signature || "")));
  const preferredDeliveries = deliveries.filter((delivery) => swapLikeSignatures.has(delivery.signature));
  const preferredKeys = new Set(preferredDeliveries.map((delivery) => `${delivery.source_wallet.address}:${delivery.signature}`));
  const fallbackDeliveries = deliveries.filter((delivery) => !preferredKeys.has(`${delivery.source_wallet.address}:${delivery.signature}`));
  const selectedDeliveries = [
    ...preferredDeliveries.slice(-hydrateLimit),
    ...fallbackDeliveries.slice(-Math.max(0, hydrateLimit - preferredDeliveries.length)),
  ].slice(0, hydrateLimit);
  const events = [];
  const hydrationErrors = {};
  const hydrationLatencies = [];
  const normalizationLatencies = [];
  const queueToHydrationDelays = [];
  await runPool(selectedDeliveries, 4, async (delivery) => {
    const hydrationStarted = Date.now();
    const hydrationStartedAt = clockIso(now);
    queueToHydrationDelays.push(Math.max(0, Date.parse(hydrationStartedAt) - Date.parse(delivery.raven_received_at)));
    try {
      const transaction = await rpc("getTransaction", [delivery.signature, {
        encoding: "jsonParsed",
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      }]);
      if (!transaction) throw new Error("wallet_transaction_unavailable");
      hydrationLatencies.push(Math.max(0, Date.now() - hydrationStarted));
      const decodeStartedAt = clockIso(now);
      const normalizationStarted = Date.now();
      const normalized = normalizeSolanaWalletTransaction({
        wallet_address: delivery.source_wallet.address,
        signature: delivery.signature,
        transaction,
        provider: "constant_k_nexus+confirmed_rpc",
        finality: "confirmed",
        observation_mode: "prospective",
        provider_observed_at: delivery.provider_observed_at,
        received_at: delivery.raven_received_at,
        decode_started_at: decodeStartedAt,
        decoded_at: decodeStartedAt,
        observed_at: decodeStartedAt,
      });
      normalizationLatencies.push(Math.max(0, Date.now() - normalizationStarted));
      events.push(normalized);
    } catch (error) {
      const code = clean(error?.message || "wallet_transaction_unavailable", 80).replace(/[^a-zA-Z0-9_.:-]+/g, "_");
      hydrationErrors[code] = (hydrationErrors[code] || 0) + 1;
    }
  });
  events.sort((left, right) => Number(left.chain_evidence.slot) - Number(right.chain_evidence.slot));
  const detectionDelays = events.map((event) => event.timing.detection_delay_ms).filter(Number.isFinite);
  const signalRows = events.filter((event) => event.copy_signal.eligible_buy_signal).map((event) => ({
    evidence_reference: `solana_signature_${digest(event.chain_evidence.signature)}`,
    wallet_reference: `public_wallet_${digest(event.source_wallet.address)}`,
    classification: event.classification.kind,
    confidence: event.classification.confidence,
    slot: event.chain_evidence.slot,
    chain_event_at: event.chain_evidence.block_time,
    exact_destination_asset_reference: `solana_mint_${digest(event.copy_signal.exact_destination_asset?.mint)}`,
  }));
  const report = {
    schema_version: "ravenos.constant_k_wallet_observer_live_validation.v1",
    generated_at: clockIso(now),
    mode: "authorized_read_only_nexus_capture_probe",
    persistence: false,
    provider: "constant_k_nexus",
    transport: "geyser_grpc",
    public_wallet_references: wallets.map((wallet) => `public_wallet_${digest(wallet)}`).sort(),
    source_capture: {
      lines_read: captureInput.lines_read,
      parse_failures: captureInput.parse_failures,
      bytes_read: captureInput.bytes_read,
      state: adapter.capture.state,
      counts: adapter.capture.counts,
      provider_event_age: adapter.capture.provider_event_age,
      cursor: adapter.capture.cursor ? {
        slot: adapter.capture.cursor.slot,
        signature_reference: `solana_signature_${digest(adapter.capture.cursor.signature)}`,
      } : null,
      limitations: adapter.capture.limitations,
    },
    observer_transport_health: adapter.health,
    observation: {
      wallet_count: wallets.length,
      exact_references_received: deliveries.length,
      hydration_selection: "compact_swap_route_evidence_then_recent",
      transactions_hydrated: events.length,
      hydration_failures: Object.values(hydrationErrors).reduce((sum, value) => sum + value, 0),
      classifications: classificationCounts(events),
      eligible_buy_signals: signalRows.length,
      signal_evidence: signalRows,
    },
    latency: {
      provider_capture_to_validation: metric(queueToHydrationDelays),
      chain_to_raven_receipt_second_resolution: metric(detectionDelays),
      confirmed_rpc_hydration: metric(hydrationLatencies),
      economic_normalization: metric(normalizationLatencies),
    },
    hydration: { errors: hydrationErrors },
    provider_calls: providerCalls,
    interpretation: {
      prospective_stream_receipt_preserved: deliveries.length > 0,
      chain_time_precision: "solana_block_time_second_resolution",
      speed_claim_supported: false,
      copyability_claim_supported: false,
      reason: "This bounded operator probe proves Nexus capture and exact economic decoding, but does not yet provide the required mixed seven-day prospective cohort.",
      next_evidence: "Run the private receiver continuously, retain refusals and finality upgrades, and reach at least 100 prospective decisions across a deliberately mixed cohort.",
    },
    execution_boundary: {
      signing_available: false,
      submission_available: false,
      broadcasting_available: false,
      transaction_material_returned: false,
      custody_available: false,
      live_copy_available: false,
      fee_collection_available: false,
    },
  };
  const serialized = JSON.stringify(report);
  for (const sensitive of [rpcUrl, eventPath, ...wallets, ...deliveries.map((row) => row.signature)]) {
    if (sensitive && serialized.includes(sensitive)) throw new Error("constant_k_validation_sensitive_output");
  }
  if (serialized.includes('"transaction"') || serialized.includes('"provider_payload"')) throw new Error("constant_k_validation_transaction_output");
  return Object.freeze(report);
}

function usage() {
  return [
    "RavenOS Constant-K wallet-observer validation (read-only; no persistence)",
    "",
    "Required through argument or environment:",
    "  --event-path <private Constant-K compact JSONL path>",
    "",
    "Optional:",
    "  --wallet <public Solana source wallet> (repeat up to 25 times)",
    "  --auto-watches <0-25> (default 5 current matched identities)",
    "  --tail-bytes <65536-33554432> (default 8388608)",
    "  --hydrate <0-32> (default up to 12 captured references)",
    "",
    "The command returns only hashed public references and aggregate health evidence.",
    "It cannot persist a watch, construct a transaction, sign, broadcast, or collect a fee.",
  ].join("\n");
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  try {
    const input = parseArgs(process.argv.slice(2));
    const report = await runConstantKWalletObserverLiveValidation(input);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    const allowed = new Set([
      "constant_k_validation_argument_invalid",
      "constant_k_validation_argument_missing",
      "constant_k_validation_event_path_required",
      "constant_k_validation_tail_bytes_invalid",
      "constant_k_validation_auto_watches_invalid",
      "constant_k_validation_wallet_count_invalid",
      "constant_k_validation_hydrate_invalid",
      "constant_k_validation_rpc_configuration_required",
      "provider_timeout",
      "provider_rate_limited",
      "provider_authorization_failed",
      "provider_unavailable",
      "provider_response_too_large",
      "provider_response_malformed",
      "solana_rpc_response_invalid",
      "wallet_transaction_unavailable",
    ]);
    const reason = clean(error?.message, 120);
    process.stderr.write(`${allowed.has(reason) ? reason : "constant_k_wallet_observer_validation_failed"}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
