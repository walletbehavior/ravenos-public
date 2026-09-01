#!/usr/bin/env node

import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  discoverConstantKNexusWalletCandidates,
  summarizeConstantKNexusWalletDiscovery,
} from "../lib/customer_trade/constant_k_nexus_wallet_discovery.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_TAIL_BYTES = 64 * 1024 * 1024;
const MAXIMUM_TAIL_BYTES = 256 * 1024 * 1024;
const MAXIMUM_EVENTS = 50_000;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function clean(value, maximum = 2_000) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function boundedInteger(value, fallback, minimum, maximum, code) {
  const parsed = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) fail(code);
  return parsed;
}

function parseArgs(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) fail("constant_k_discovery_validation_argument_invalid");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail("constant_k_discovery_validation_argument_missing");
    output[argument.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  return output;
}

function selectedEnvironment(base = process.env) {
  const output = {};
  if (base.RAVENOS_CONSTANT_K_EVENT_PATH !== undefined) output.RAVENOS_CONSTANT_K_EVENT_PATH = base.RAVENOS_CONSTANT_K_EVENT_PATH;
  const path = clean(base.RAVEN_APP_ENV_PATH || join(repoRoot, "..", ".env"));
  if (!path || !existsSync(path)) return output;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const boundary = trimmed.indexOf("=");
    const key = trimmed.slice(0, boundary).trim().replace(/^export\s+/, "");
    if (key !== "RAVENOS_CONSTANT_K_EVENT_PATH" || clean(output[key])) continue;
    let value = trimmed.slice(boundary + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    output[key] = value;
  }
  return output;
}

function readTail(path, maximumBytes) {
  const descriptor = openSync(path, "r");
  try {
    const size = fstatSync(descriptor).size;
    const length = Math.min(size, maximumBytes);
    const buffer = Buffer.alloc(length);
    readSync(descriptor, buffer, 0, length, Math.max(0, size - length));
    const raw = buffer.toString("utf8");
    const complete = size > length ? raw.slice(raw.indexOf("\n") + 1) : raw;
    const lines = complete.split(/\r?\n/).filter(Boolean).slice(-MAXIMUM_EVENTS);
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
    return { events, bytes_read: length, lines_read: lines.length, parse_failures: parseFailures };
  } finally {
    closeSync(descriptor);
  }
}

function matchedWallets(events) {
  const rows = new Set();
  for (const event of events) {
    for (const field of ["matched_identity_signers", "matched_repeat_deployer_signers", "matched_velocity_actor_signers"]) {
      for (const address of Array.isArray(event?.[field]) ? event[field] : []) rows.add(address);
    }
  }
  return [...rows];
}

export function runConstantKWalletDiscoveryLiveValidation(input = {}, {
  env = process.env,
  now = () => new Date(),
} = {}) {
  const selected = selectedEnvironment(env);
  const tailBytes = boundedInteger(input.tail_bytes, DEFAULT_TAIL_BYTES, 64 * 1024, MAXIMUM_TAIL_BYTES, "constant_k_discovery_validation_tail_invalid");
  const suppliedEvents = Array.isArray(input.events) ? {
    events: input.events,
    bytes_read: null,
    lines_read: input.events.length,
    parse_failures: 0,
  } : null;
  const eventPath = clean(input.event_path || selected.RAVENOS_CONSTANT_K_EVENT_PATH);
  if (!suppliedEvents && (!eventPath || !existsSync(eventPath))) fail("constant_k_discovery_validation_event_path_required");
  const capture = suppliedEvents || readTail(eventPath, tailBytes);
  const watched = matchedWallets(capture.events);
  const discovery = discoverConstantKNexusWalletCandidates({ events: capture.events, watched_wallets: watched, now });
  const summary = summarizeConstantKNexusWalletDiscovery(discovery);
  const report = Object.freeze({
    schema_version: "ravenos.constant_k_nexus_wallet_discovery_live_validation.v1",
    generated_at: summary.generated_at,
    mode: "authorized_read_only_nexus_discovery_probe",
    persistence: false,
    source_capture: {
      bytes_read: capture.bytes_read,
      lines_read: capture.lines_read,
      parse_failures: capture.parse_failures,
      matched_wallet_count: watched.length,
      addresses_included: false,
      signatures_included: false,
    },
    discovery: summary,
    interpretation: {
      broader_wallet_universe_available: summary.counts.unique_candidates > 0,
      recurring_candidate_count: summary.counts.recurring_candidates,
      high_signal_candidate_count: summary.counts.high_signal_candidates,
      profitability_claim_supported: false,
      copyability_claim_supported: false,
      next_evidence: "Hydrate candidates independently through Raven RPC, normalize exact economic events, and reconstruct bounded history before admission to ranked research.",
    },
    execution_boundary: summary.execution_boundary,
  });
  const serialized = JSON.stringify(report);
  for (const candidate of discovery.candidates) {
    if (serialized.includes(candidate.source_wallet.address)) fail("constant_k_discovery_validation_address_leak");
  }
  for (const observation of discovery.observations) {
    if (serialized.includes(observation.signature)) fail("constant_k_discovery_validation_signature_leak");
  }
  if (serialized.includes('"raw_provider_payload"') || serialized.includes('"subscriber_id"')) fail("constant_k_discovery_validation_payload_leak");
  return report;
}

function usage() {
  return [
    "RavenOS Constant-K wallet discovery validation (read-only; no persistence)",
    "",
    "Optional:",
    "  --event-path <absolute compact Nexus journal path>",
    "  --tail-bytes <65536-268435456> (default 67108864)",
    "",
    "The output contains candidate hashes and aggregate evidence only.",
    "It cannot persist, watch, copy, construct, sign, broadcast, or collect a fee.",
  ].join("\n");
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const report = runConstantKWalletDiscoveryLiveValidation(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: clean(error?.code || error?.message || "constant_k_discovery_validation_failed", 100) })}\n`);
    process.exitCode = 1;
  });
}
