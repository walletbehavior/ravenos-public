#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  normalizeSolanaWalletAddress,
  normalizeSolanaWalletTransaction,
} from "../lib/customer_trade/solana_wallet_intelligence.mjs";
import { runRpcPollSourceWalletAdapter } from "../lib/customer_trade/source_wallet_transports.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const MAX_RESPONSE_BYTES = 1_500 * 1024;
const MAX_PROBE_WALLETS = 25;
const MAX_HYDRATIONS = 32;

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

function parseArgs(argv) {
  const output = { wallets: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];
    if (!entry.startsWith("--")) throw new Error("wallet_observer_validation_argument_invalid");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error("wallet_observer_validation_argument_missing");
    const key = entry.slice(2).replaceAll("-", "_");
    if (key === "wallet") output.wallets.push(value);
    else output[key] = value;
    index += 1;
  }
  return output;
}

function selectedEnvironment(base = process.env) {
  const output = { ...base };
  const path = clean(base.RAVEN_APP_ENV_PATH || join(repoRoot, "..", ".env"), 1_000);
  if (!path || !existsSync(path)) return output;
  const allowed = new Set(["RAVENOS_SOLANA_RPC_URL", "SOLANA_ALCHEMY_RPC_URL"]);
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

export async function runWalletObserverLiveValidation(input = {}, {
  env = process.env,
  fetch_impl: fetchImpl = fetch,
} = {}) {
  const selected = selectedEnvironment(env);
  const rpcUrl = clean(selected.RAVENOS_SOLANA_RPC_URL || selected.SOLANA_ALCHEMY_RPC_URL, 2_000);
  if (!rpcUrl) throw new Error("wallet_observer_validation_provider_configuration_required");
  const requestedWallets = Array.isArray(input.wallets) ? input.wallets : input.wallet ? [input.wallet] : [];
  const wallets = [...new Set(requestedWallets.map(normalizeSolanaWalletAddress))];
  if (!wallets.length || wallets.length > MAX_PROBE_WALLETS) throw new Error("wallet_observer_validation_wallet_count_invalid");
  const limit = boundedInteger(input.limit, 12, 1, 32, "wallet_observer_validation_limit_invalid");
  const hydrateLimit = boundedInteger(input.hydrate, Math.min(limit * wallets.length, 12), 0, MAX_HYDRATIONS, "wallet_observer_validation_hydrate_invalid");
  const providerCalls = { solana_rpc: 0 };
  const rpc = createRpc(rpcUrl, providerCalls, fetchImpl);
  const deliveries = [];
  const startedAt = Date.now();
  const adapter = await runRpcPollSourceWalletAdapter({
    watches: wallets,
    provider: "configured_solana_rpc",
    page_size: limit,
    maximum_pages: 1,
    concurrency: Math.min(4, wallets.length),
    commitment: "confirmed",
    async fetch_signatures({ wallet_address: address, before, until, limit: pageLimit, commitment }) {
      const options = { limit: pageLimit, commitment };
      if (before) options.before = before;
      if (until) options.until = until;
      return rpc("getSignaturesForAddress", [address, options]);
    },
    async ingest_delivery(delivery) { deliveries.push(delivery); },
  });
  const selectedDeliveries = deliveries.slice(-hydrateLimit);
  const events = [];
  const hydrationErrors = {};
  const hydrationLatencies = [];
  await runPool(selectedDeliveries, 4, async (delivery) => {
    const hydrationStarted = Date.now();
    const decodeStartedAt = new Date().toISOString();
    try {
      const transaction = await rpc("getTransaction", [delivery.signature, {
        encoding: "jsonParsed",
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      }]);
      if (!transaction) throw new Error("wallet_transaction_unavailable");
      const decodedAt = new Date().toISOString();
      events.push(normalizeSolanaWalletTransaction({
        wallet_address: delivery.source_wallet.address,
        signature: delivery.signature,
        transaction,
        provider: delivery.provider,
        finality: delivery.finality,
        observation_mode: "historical_backfill",
        provider_observed_at: delivery.provider_observed_at,
        received_at: delivery.raven_received_at,
        decode_started_at: decodeStartedAt,
        decoded_at: decodedAt,
        observed_at: decodedAt,
      }));
      hydrationLatencies.push(Math.max(0, Date.now() - hydrationStarted));
    } catch (error) {
      const code = clean(error?.message || "wallet_transaction_unavailable", 80).replace(/[^a-zA-Z0-9_.:-]+/g, "_");
      hydrationErrors[code] = (hydrationErrors[code] || 0) + 1;
    }
  });
  events.sort((left, right) => Number(left.chain_evidence.slot) - Number(right.chain_evidence.slot));
  const walletReferences = wallets.map((wallet) => `public_wallet_${digest(wallet)}`).sort();
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
    schema_version: "ravenos.wallet_observer_live_validation.v1",
    generated_at: new Date().toISOString(),
    mode: "authorized_read_only_manual_probe",
    persistence: false,
    transport: "rpc_poll",
    public_wallet_references: walletReferences,
    observation: {
      wallet_count: wallets.length,
      signatures_requested_per_wallet: limit,
      references_received: adapter.health.counts.references_received,
      references_ingested_in_memory: adapter.health.counts.deliveries_ingested,
      transactions_hydrated: events.length,
      hydration_failures: Object.values(hydrationErrors).reduce((sum, value) => sum + value, 0),
      classifications: classificationCounts(events),
      eligible_buy_signals: signalRows.length,
      signal_evidence: signalRows,
      initial_history_truncated_wallets: adapter.health.counts.initial_history_truncated_wallets,
    },
    provider_health: adapter.health,
    hydration: {
      latency: metric(hydrationLatencies),
      errors: hydrationErrors,
    },
    provider_calls: providerCalls,
    total_probe_ms: Math.max(0, Date.now() - startedAt),
    interpretation: {
      prospective_detection_latency_measured: false,
      speed_claim_supported: false,
      reason: "This manual RPC catch-up probe measures provider access and decode viability, not continuous stream detection speed.",
      next_evidence: "Run the same adapter contract behind the private gRPC or shred receiver and retain at least 100 prospective observations before a speed claim.",
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
  for (const sensitive of [rpcUrl, ...wallets, ...deliveries.map((row) => row.signature)]) {
    if (sensitive && serialized.includes(sensitive)) throw new Error("wallet_observer_validation_sensitive_output");
  }
  if (serialized.includes('"transaction"') || serialized.includes('"provider_payload"')) throw new Error("wallet_observer_validation_transaction_output");
  return Object.freeze(report);
}

function usage() {
  return [
    "RavenOS source-wallet observer validation (read-only; no persistence)",
    "",
    "Required:",
    "  --wallet <public Solana source wallet> (repeat up to 25 times)",
    "",
    "Optional:",
    "  --limit <1-32> (default 12 signatures per wallet)",
    "  --hydrate <0-32> (default up to 12 transactions)",
    "",
    "This command validates bounded RPC catch-up and economic decoding in memory.",
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
    const report = await runWalletObserverLiveValidation(input);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    const allowed = new Set([
      "wallet_observer_validation_provider_configuration_required",
      "wallet_observer_validation_wallet_count_invalid",
      "wallet_observer_validation_limit_invalid",
      "wallet_observer_validation_hydrate_invalid",
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
    process.stderr.write(`${allowed.has(reason) ? reason : "wallet_observer_live_validation_failed"}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
