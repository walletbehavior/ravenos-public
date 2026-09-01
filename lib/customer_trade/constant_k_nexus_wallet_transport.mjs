import { normalizeSolanaWalletAddress } from "./solana_wallet_intelligence.mjs";
import {
  SourceWalletTransportLimits,
  normalizeSourceWalletWatchUniverse,
  runSourceWalletStreamAdapterBatch,
} from "./source_wallet_transports.mjs";

export const CONSTANT_K_NEXUS_WALLET_BATCH_SCHEMA = "ravenos.constant_k_nexus_wallet_batch.v1";

export const ConstantKNexusWalletLimits = Object.freeze({
  maximum_event_rows_per_batch: 50_000,
  maximum_event_bytes: 64 * 1024,
  maximum_reference_rows_per_batch: SourceWalletTransportLimits.maximum_stream_references_per_run,
  maximum_provider_clock_skew_ms: 5 * 60 * 1_000,
});

const textEncoder = new TextEncoder();
const SOLANA_SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,100}$/;

function fail(code, details = null) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  throw error;
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function clean(value, field, maximum = 180, { optional = false } = {}) {
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if ((!optional && !text) || text.length > maximum) fail(`${field}_invalid`);
  return text || null;
}

function timestamp(value, field) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) fail(`${field}_invalid`);
  return new Date(parsed).toISOString();
}

function nowIso(now) {
  const value = typeof now === "function" ? now() : now;
  if (value instanceof Date) return timestamp(value.toISOString(), "constant_k_clock");
  if (Number.isFinite(Number(value))) return timestamp(new Date(Number(value)).toISOString(), "constant_k_clock");
  return timestamp(value || new Date().toISOString(), "constant_k_clock");
}

function slot(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail("constant_k_slot_invalid");
  return parsed;
}

function signature(value) {
  const normalized = clean(value, "constant_k_signature", 100);
  if (!SOLANA_SIGNATURE_RE.test(normalized)) fail("constant_k_signature_invalid");
  return normalized;
}

function eventBytes(row) {
  try {
    return textEncoder.encode(JSON.stringify(row)).byteLength;
  } catch {
    fail("constant_k_event_invalid");
  }
}

function metric(values) {
  const rows = values.filter(Number.isFinite).sort((left, right) => left - right);
  const percentile = (percentage) => rows.length
    ? rows[Math.max(0, Math.ceil((percentage / 100) * rows.length) - 1)]
    : null;
  return freeze({
    available: rows.length > 0,
    samples: rows.length,
    p50_ms: percentile(50),
    p90_ms: percentile(90),
    p95_ms: percentile(95),
    p99_ms: percentile(99),
  });
}

function cursorAfter(left, right) {
  if (!left) return right;
  if (right.slot !== left.slot) return right.slot > left.slot ? right : left;
  return right.sequence > left.sequence ? right : left;
}

function safeSigner(value) {
  try {
    return normalizeSolanaWalletAddress(value);
  } catch {
    return null;
  }
}

function classifyCaptureState(stats) {
  if (stats.transaction_rows === 0) return "idle";
  if (stats.valid_transaction_rows === 0) return "unavailable";
  if (stats.invalid_rows > 0 || stats.provider_mismatch_rows > 0 || stats.reference_overflow) return "degraded";
  return "current";
}

export function buildConstantKNexusWalletReferenceBatch({
  watches = [],
  events = [],
  now = () => new Date(),
} = {}) {
  if (!Array.isArray(events)) fail("constant_k_events_invalid");
  if (events.length > ConstantKNexusWalletLimits.maximum_event_rows_per_batch) fail("constant_k_event_batch_too_large");
  const universe = normalizeSourceWalletWatchUniverse(watches, {
    maximum_watches: SourceWalletTransportLimits.maximum_stream_watches_per_run,
  });
  const watched = new Set(universe.map((row) => row.source_wallet.address));
  const generatedAt = nowIso(now);
  const generatedAtMs = Date.parse(generatedAt);
  const references = [];
  const referenceKeys = new Set();
  const providerAges = [];
  let cursor = null;
  const stats = {
    event_rows: events.length,
    transaction_rows: 0,
    slot_rows: 0,
    ignored_rows: 0,
    valid_transaction_rows: 0,
    provider_mismatch_rows: 0,
    invalid_rows: 0,
    off_universe_transactions: 0,
    watched_transactions: 0,
    watched_signers: 0,
    duplicate_references: 0,
    emitted_references: 0,
    reference_overflow: false,
  };

  for (let sequence = 0; sequence < events.length; sequence += 1) {
    const row = events[sequence];
    try {
      if (!row || typeof row !== "object" || Array.isArray(row)) fail("constant_k_event_invalid");
      if (eventBytes(row) > ConstantKNexusWalletLimits.maximum_event_bytes) fail("constant_k_event_too_large");
      const eventKind = clean(row.event, "constant_k_event_kind", 64);
      if (eventKind === "solana_grpc_slot") {
        stats.slot_rows += 1;
        continue;
      }
      if (eventKind !== "solana_grpc_transaction") {
        stats.ignored_rows += 1;
        continue;
      }
      stats.transaction_rows += 1;
      if (clean(row.provider, "constant_k_provider", 32).toLowerCase() !== "constant_k") {
        stats.provider_mismatch_rows += 1;
        continue;
      }
      const rowSignature = signature(row.signature);
      const rowSlot = slot(row.slot);
      const observedAt = timestamp(row.ts, "constant_k_observed_at");
      const observedAtMs = Date.parse(observedAt);
      if (observedAtMs > generatedAtMs + ConstantKNexusWalletLimits.maximum_provider_clock_skew_ms) {
        fail("constant_k_observed_at_future");
      }
      providerAges.push(Math.max(0, generatedAtMs - observedAtMs));
      cursor = cursorAfter(cursor, { slot: rowSlot, signature: rowSignature, sequence });
      stats.valid_transaction_rows += 1;

      const signerRows = Array.isArray(row.signer_accounts) ? row.signer_accounts : [];
      const exactSigners = [...new Set(signerRows.map(safeSigner).filter(Boolean).filter((address) => watched.has(address)))];
      if (!exactSigners.length) {
        stats.off_universe_transactions += 1;
        continue;
      }
      stats.watched_transactions += 1;
      stats.watched_signers += exactSigners.length;
      for (const walletAddress of exactSigners) {
        const key = `${walletAddress}:${rowSignature}:processed`;
        if (referenceKeys.has(key)) {
          stats.duplicate_references += 1;
          continue;
        }
        if (references.length >= ConstantKNexusWalletLimits.maximum_reference_rows_per_batch) {
          stats.reference_overflow = true;
          fail("constant_k_reference_batch_too_large");
        }
        referenceKeys.add(key);
        references.push({
          wallet_address: walletAddress,
          signature: rowSignature,
          slot: rowSlot,
          finality: "processed",
          provider_observed_at: observedAt,
          raven_received_at: observedAt,
          evidence_reference: `solana:signature:${rowSignature}`,
        });
      }
    } catch (error) {
      if (error?.code === "constant_k_reference_batch_too_large") throw error;
      stats.invalid_rows += 1;
    }
  }
  stats.emitted_references = references.length;
  const capture = freeze({
    schema_version: CONSTANT_K_NEXUS_WALLET_BATCH_SCHEMA,
    generated_at: generatedAt,
    provider: "constant_k_nexus",
    transport: "geyser_grpc",
    state: classifyCaptureState(stats),
    counts: freeze({ ...stats }),
    provider_event_age: metric(providerAges),
    cursor: cursor ? freeze({ slot: cursor.slot, signature: cursor.signature }) : null,
    exact_watch_universe_size: universe.length,
    raw_provider_payload_persisted: false,
    subscriber_identity_included: false,
    signer_material_included: false,
    transaction_material_included: false,
    limitations: [
      "Constant-K receipt time is preserved, but chain-event time still requires confirmed transaction hydration.",
      "Processed stream delivery is not settlement finality and must be upgraded by confirmed or finalized evidence.",
      "A captured source transaction is not evidence of entry, exit, or copy-trade executability.",
    ],
    execution_boundary: { signing: false, broadcasting: false, custody: false, live_copy: false, fee_collection: false },
  });
  return freeze({ references, capture });
}

export async function runConstantKNexusWalletStreamBatch({
  watches = [],
  events = [],
  ingest_delivery: ingestDelivery,
  now = () => new Date(),
} = {}) {
  if (typeof ingestDelivery !== "function") fail("observer_transport_ingest_unavailable");
  const prepared = buildConstantKNexusWalletReferenceBatch({ watches, events, now });
  const transport = await runSourceWalletStreamAdapterBatch({
    watches,
    references: prepared.references,
    ingest_delivery: ingestDelivery,
    provider: "constant_k_nexus",
    transport: "geyser_grpc",
    preserve_reference_received_at: true,
    now,
  });
  return freeze({
    ...transport,
    schema_version: CONSTANT_K_NEXUS_WALLET_BATCH_SCHEMA,
    mode: "constant_k_nexus_private_stream_batch",
    capture: prepared.capture,
    state: transport.health.state === "unavailable" || prepared.capture.state === "unavailable"
      ? "unavailable"
      : transport.health.state === "degraded" || prepared.capture.state === "degraded"
        ? "degraded"
        : prepared.capture.state,
    persistence: false,
    execution_boundary: prepared.capture.execution_boundary,
  });
}
