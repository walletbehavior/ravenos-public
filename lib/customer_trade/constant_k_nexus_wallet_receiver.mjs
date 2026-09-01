import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readSync, statSync } from "node:fs";

import {
  ConstantKNexusWalletLimits,
  runConstantKNexusWalletStreamBatch,
} from "./constant_k_nexus_wallet_transport.mjs";
import {
  SourceWalletTransportLimits,
  normalizeSourceWalletWatchUniverse,
} from "./source_wallet_transports.mjs";
import { normalizeSolanaWalletAddress } from "./solana_wallet_intelligence.mjs";

export const CONSTANT_K_NEXUS_RECEIVER_CHECKPOINT_SCHEMA = "ravenos.constant_k_nexus_receiver_checkpoint.v1";
export const CONSTANT_K_NEXUS_RECEIVER_RUN_SCHEMA = "ravenos.constant_k_nexus_receiver_run.v1";

export const ConstantKNexusReceiverLimits = Object.freeze({
  default_bytes_per_cycle: 4 * 1024 * 1024,
  maximum_bytes_per_cycle: 16 * 1024 * 1024,
  maximum_lines_per_cycle: 10_000,
  maximum_line_bytes: ConstantKNexusWalletLimits.maximum_event_bytes,
  maximum_watches: SourceWalletTransportLimits.maximum_stream_watches_per_run,
});

const INITIAL_POSITIONS = new Set(["tail", "beginning"]);
const CONTINUITY_STATES = new Set(["initial_tail", "initial_beginning", "continuous", "rotation_continuous"]);
const textDecoder = new TextDecoder();

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

function integer(value, field, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) fail(`${field}_invalid`);
  return parsed;
}

function timestamp(value, field) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) fail(`${field}_invalid`);
  return new Date(parsed).toISOString();
}

function nowIso(now) {
  const value = typeof now === "function" ? now() : now;
  if (value instanceof Date) return timestamp(value.toISOString(), "constant_k_receiver_clock");
  if (Number.isFinite(Number(value))) return timestamp(new Date(Number(value)).toISOString(), "constant_k_receiver_clock");
  return timestamp(value || new Date().toISOString(), "constant_k_receiver_clock");
}

function digest(value) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 24);
}

function cursorFromStat(row, offset) {
  return freeze({
    device: integer(row.dev, "constant_k_receiver_cursor_device"),
    inode: integer(row.ino, "constant_k_receiver_cursor_inode"),
    offset: integer(offset, "constant_k_receiver_cursor_offset"),
  });
}

function cursorMatches(cursor, row) {
  return cursor.device === Number(row.dev) && cursor.inode === Number(row.ino);
}

function sameCursor(left, right) {
  return Boolean(left && right)
    && left.device === right.device
    && left.inode === right.inode
    && left.offset === right.offset;
}

function statIfAvailable(path) {
  try {
    const row = statSync(path);
    if (!row.isFile()) fail("constant_k_receiver_source_not_file");
    return row;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function normalizeCursor(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("constant_k_receiver_cursor_invalid");
  return freeze({
    device: integer(input.device, "constant_k_receiver_cursor_device"),
    inode: integer(input.inode, "constant_k_receiver_cursor_inode"),
    offset: integer(input.offset, "constant_k_receiver_cursor_offset"),
  });
}

export function normalizeConstantKNexusReceiverCheckpoint(input) {
  if (input === null || input === undefined) return null;
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("constant_k_receiver_checkpoint_invalid");
  if (input.schema_version !== CONSTANT_K_NEXUS_RECEIVER_CHECKPOINT_SCHEMA) fail("constant_k_receiver_checkpoint_invalid");
  const counters = input.counters && typeof input.counters === "object" && !Array.isArray(input.counters) ? input.counters : {};
  return freeze({
    schema_version: CONSTANT_K_NEXUS_RECEIVER_CHECKPOINT_SCHEMA,
    source_id: clean(input.source_id, "constant_k_receiver_source_id", 80),
    cursor: normalizeCursor(input.cursor),
    watch_universe_hash: clean(input.watch_universe_hash, "constant_k_receiver_watch_hash", 64),
    last_provider_slot: input.last_provider_slot === null || input.last_provider_slot === undefined
      ? null
      : integer(input.last_provider_slot, "constant_k_receiver_provider_slot"),
    last_signature_reference: clean(input.last_signature_reference, "constant_k_receiver_signature_reference", 80, { optional: true }),
    initial_history_truncated: input.initial_history_truncated === true,
    counters: freeze({
      cycles: integer(counters.cycles ?? 0, "constant_k_receiver_counter_cycles"),
      bytes_committed: integer(counters.bytes_committed ?? 0, "constant_k_receiver_counter_bytes"),
      lines_committed: integer(counters.lines_committed ?? 0, "constant_k_receiver_counter_lines"),
      references_ingested: integer(counters.references_ingested ?? 0, "constant_k_receiver_counter_references"),
      invalid_lines: integer(counters.invalid_lines ?? 0, "constant_k_receiver_counter_invalid"),
    }),
    created_at: timestamp(input.created_at, "constant_k_receiver_created_at"),
    updated_at: timestamp(input.updated_at, "constant_k_receiver_updated_at"),
  });
}

function readDescriptorSegment(descriptor, {
  offset,
  byte_budget: byteBudget,
  line_budget: lineBudget,
} = {}) {
  const metadata = fstatSync(descriptor);
  if (!metadata.isFile()) fail("constant_k_receiver_source_not_file");
  const start = integer(offset, "constant_k_receiver_read_offset");
  if (metadata.size < start) fail("constant_k_receiver_source_truncated");
  const available = Math.max(0, metadata.size - start);
  const requested = Math.min(available, integer(byteBudget, "constant_k_receiver_byte_budget", {
    minimum: 0,
    maximum: ConstantKNexusReceiverLimits.maximum_bytes_per_cycle,
  }));
  if (!requested || lineBudget <= 0) {
    return {
      events: [],
      parse_failures: 0,
      oversized_lines: 0,
      lines_committed: 0,
      bytes_read: 0,
      bytes_committed: 0,
      cursor: cursorFromStat(metadata, start),
      at_eof: start >= metadata.size,
    };
  }
  const buffer = Buffer.alloc(requested);
  const bytesRead = readSync(descriptor, buffer, 0, requested, start);
  const events = [];
  let parseFailures = 0;
  let oversizedLines = 0;
  let lineStart = 0;
  let bytesCommitted = 0;
  let linesCommitted = 0;
  while (lineStart < bytesRead && linesCommitted < lineBudget) {
    const newline = buffer.indexOf(0x0a, lineStart);
    if (newline < 0) break;
    const end = newline > lineStart && buffer[newline - 1] === 0x0d ? newline - 1 : newline;
    const line = buffer.subarray(lineStart, end);
    linesCommitted += 1;
    bytesCommitted = newline + 1;
    lineStart = newline + 1;
    if (!line.length) continue;
    if (line.length > ConstantKNexusReceiverLimits.maximum_line_bytes) {
      oversizedLines += 1;
      continue;
    }
    try {
      const parsed = JSON.parse(textDecoder.decode(line));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
      events.push(parsed);
    } catch {
      parseFailures += 1;
    }
  }
  if (bytesCommitted === 0 && bytesRead >= ConstantKNexusReceiverLimits.maximum_line_bytes) {
    fail("constant_k_receiver_unterminated_line_too_large");
  }
  const nextOffset = start + bytesCommitted;
  return {
    events,
    parse_failures: parseFailures,
    oversized_lines: oversizedLines,
    lines_committed: linesCommitted,
    bytes_read: bytesRead,
    bytes_committed: bytesCommitted,
    cursor: cursorFromStat(metadata, nextOffset),
    at_eof: nextOffset >= metadata.size,
  };
}

function readPathSegment(path, options) {
  const descriptor = openSync(path, "r");
  try {
    const metadata = fstatSync(descriptor);
    if (
      options.expected_device !== undefined
      && (Number(metadata.dev) !== Number(options.expected_device) || Number(metadata.ino) !== Number(options.expected_inode))
    ) fail("constant_k_receiver_source_rotated_during_read");
    return readDescriptorSegment(descriptor, options);
  } finally {
    closeSync(descriptor);
  }
}

export function readConstantKNexusEventFileBatch({
  event_path: eventPath,
  checkpoint = null,
  initial_position: initialPosition = "tail",
  maximum_bytes: requestedMaximumBytes = ConstantKNexusReceiverLimits.default_bytes_per_cycle,
  maximum_lines: requestedMaximumLines = ConstantKNexusReceiverLimits.maximum_lines_per_cycle,
} = {}) {
  const path = clean(eventPath, "constant_k_receiver_event_path", 1_000);
  const position = clean(initialPosition, "constant_k_receiver_initial_position", 16).toLowerCase();
  if (!INITIAL_POSITIONS.has(position)) fail("constant_k_receiver_initial_position_invalid");
  const maximumBytes = integer(requestedMaximumBytes, "constant_k_receiver_maximum_bytes", {
    minimum: ConstantKNexusReceiverLimits.maximum_line_bytes,
    maximum: ConstantKNexusReceiverLimits.maximum_bytes_per_cycle,
  });
  const maximumLines = integer(requestedMaximumLines, "constant_k_receiver_maximum_lines", {
    minimum: 1,
    maximum: ConstantKNexusReceiverLimits.maximum_lines_per_cycle,
  });
  const normalizedCheckpoint = normalizeConstantKNexusReceiverCheckpoint(checkpoint);
  const current = statIfAvailable(path);
  if (!current) fail("constant_k_receiver_source_unavailable");
  const sourceId = "constant_k_compact_transaction_log";
  if (normalizedCheckpoint && normalizedCheckpoint.source_id !== sourceId) fail("constant_k_receiver_checkpoint_source_mismatch");

  if (!normalizedCheckpoint && position === "tail") {
    return freeze({
      source_id: sourceId,
      events: [],
      cursor: cursorFromStat(current, current.size),
      continuity: "initial_tail",
      initial_history_truncated: current.size > 0,
      event_rows: 0,
      lines_committed: 0,
      bytes_read: 0,
      bytes_committed: 0,
      parse_failures: 0,
      oversized_lines: 0,
      raw_lines_returned: false,
      raw_provider_payload_persisted: false,
    });
  }

  const startingCursor = normalizedCheckpoint?.cursor || cursorFromStat(current, 0);
  const segments = [];
  if (cursorMatches(startingCursor, current)) {
    segments.push({ path, metadata: current, offset: startingCursor.offset, continuity: normalizedCheckpoint ? "continuous" : "initial_beginning" });
  } else {
    const rotatedPath = `${path}.1`;
    const rotated = statIfAvailable(rotatedPath);
    if (!rotated || !cursorMatches(startingCursor, rotated)) fail("constant_k_receiver_rotation_gap");
    segments.push({ path: rotatedPath, metadata: rotated, offset: startingCursor.offset, continuity: "rotation_continuous" });
    segments.push({ path, metadata: current, offset: 0, continuity: "rotation_continuous" });
  }

  const output = {
    source_id: sourceId,
    events: [],
    cursor: startingCursor,
    continuity: segments[0].continuity,
    initial_history_truncated: normalizedCheckpoint?.initial_history_truncated === true,
    event_rows: 0,
    lines_committed: 0,
    bytes_read: 0,
    bytes_committed: 0,
    parse_failures: 0,
    oversized_lines: 0,
    raw_lines_returned: false,
    raw_provider_payload_persisted: false,
  };
  for (const segment of segments) {
    if (output.bytes_committed >= maximumBytes || output.lines_committed >= maximumLines) break;
    if (segment.metadata.size < segment.offset) fail("constant_k_receiver_source_truncated");
    const read = readPathSegment(segment.path, {
      offset: segment.offset,
      byte_budget: maximumBytes - output.bytes_committed,
      line_budget: maximumLines - output.lines_committed,
      expected_device: segment.metadata.dev,
      expected_inode: segment.metadata.ino,
    });
    output.events.push(...read.events);
    output.event_rows += read.events.length;
    output.lines_committed += read.lines_committed;
    output.bytes_read += read.bytes_read;
    output.bytes_committed += read.bytes_committed;
    output.parse_failures += read.parse_failures;
    output.oversized_lines += read.oversized_lines;
    output.cursor = read.cursor;
    if (!read.at_eof) break;
    if (segment.path !== path) output.cursor = cursorFromStat(current, 0);
  }
  return freeze(output);
}

function watchUniverseHash(universe) {
  return digest(universe.map((row) => row.source_wallet.address).sort().join("|"));
}

function checkpointCounters(previous, batch, references) {
  const prior = previous?.counters || {};
  return freeze({
    cycles: Number(prior.cycles || 0) + 1,
    bytes_committed: Number(prior.bytes_committed || 0) + batch.bytes_committed,
    lines_committed: Number(prior.lines_committed || 0) + batch.lines_committed,
    references_ingested: Number(prior.references_ingested || 0) + references,
    invalid_lines: Number(prior.invalid_lines || 0) + batch.parse_failures + batch.oversized_lines,
  });
}

function normalizeReceiverBatch(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || !Array.isArray(input.events)) fail("constant_k_receiver_batch_invalid");
  if (input.source_id !== "constant_k_compact_transaction_log") fail("constant_k_receiver_batch_source_invalid");
  if (input.events.length > ConstantKNexusReceiverLimits.maximum_lines_per_cycle) fail("constant_k_receiver_batch_too_large");
  const eventRows = integer(input.event_rows, "constant_k_receiver_batch_event_rows", { maximum: ConstantKNexusReceiverLimits.maximum_lines_per_cycle });
  const linesCommitted = integer(input.lines_committed, "constant_k_receiver_batch_lines", { maximum: ConstantKNexusReceiverLimits.maximum_lines_per_cycle });
  const bytesRead = integer(input.bytes_read, "constant_k_receiver_batch_bytes_read", { maximum: ConstantKNexusReceiverLimits.maximum_bytes_per_cycle });
  const bytesCommitted = integer(input.bytes_committed, "constant_k_receiver_batch_bytes_committed", { maximum: ConstantKNexusReceiverLimits.maximum_bytes_per_cycle });
  const parseFailures = integer(input.parse_failures, "constant_k_receiver_batch_parse_failures", { maximum: ConstantKNexusReceiverLimits.maximum_lines_per_cycle });
  const oversizedLines = integer(input.oversized_lines, "constant_k_receiver_batch_oversized_lines", { maximum: ConstantKNexusReceiverLimits.maximum_lines_per_cycle });
  const continuity = clean(input.continuity, "constant_k_receiver_continuity", 40).toLowerCase();
  if (!CONTINUITY_STATES.has(continuity)) fail("constant_k_receiver_batch_continuity_invalid");
  if (
    eventRows !== input.events.length
    || linesCommitted < eventRows + parseFailures + oversizedLines
    || bytesCommitted > bytesRead
    || input.raw_lines_returned !== false
    || input.raw_provider_payload_persisted !== false
  ) fail("constant_k_receiver_batch_invalid");
  return {
    source_id: input.source_id,
    events: input.events,
    cursor: normalizeCursor(input.cursor),
    continuity,
    initial_history_truncated: input.initial_history_truncated === true,
    event_rows: eventRows,
    lines_committed: linesCommitted,
    bytes_read: bytesRead,
    bytes_committed: bytesCommitted,
    parse_failures: parseFailures,
    oversized_lines: oversizedLines,
  };
}

function combineState(left, right) {
  if (left === "unavailable" || right === "unavailable") return "unavailable";
  if (left === "degraded" || right === "degraded") return "degraded";
  if (left === "current" || right === "current") return "current";
  return "idle";
}

function laterProviderCursor(left, right) {
  if (!left) return right;
  if (!right) return left;
  if (Number(right.slot) !== Number(left.slot)) return Number(right.slot) > Number(left.slot) ? right : left;
  return String(right.signature || "").localeCompare(String(left.signature || "")) > 0 ? right : left;
}

function potentialReferenceCount(row, watched) {
  if (!row || typeof row !== "object" || Array.isArray(row) || row.event !== "solana_grpc_transaction") return 0;
  const signers = Array.isArray(row.signer_accounts) ? row.signer_accounts : [];
  const matched = new Set();
  for (const value of signers) {
    try {
      const address = normalizeSolanaWalletAddress(value);
      if (watched.has(address)) matched.add(address);
    } catch {
      // Malformed rows remain transport evidence; they cannot reserve a
      // reference or widen the exact watch universe.
    }
  }
  return matched.size;
}

function partitionEventsByReferenceBudget(events, universe) {
  if (!events.length) return [[]];
  const watched = new Set(universe.map((row) => row.source_wallet.address));
  const chunks = [];
  let rows = [];
  let potentialReferences = 0;
  for (const event of events) {
    const nextReferences = potentialReferenceCount(event, watched);
    if (nextReferences > SourceWalletTransportLimits.maximum_stream_references_per_run) {
      fail("constant_k_receiver_event_reference_overflow");
    }
    if (
      rows.length > 0
      && potentialReferences + nextReferences > SourceWalletTransportLimits.maximum_stream_references_per_run
    ) {
      chunks.push(rows);
      rows = [];
      potentialReferences = 0;
    }
    rows.push(event);
    potentialReferences += nextReferences;
  }
  if (rows.length) chunks.push(rows);
  return chunks;
}

async function runTransportChunks({ universe, events, ingestDelivery, generatedAt }) {
  const chunks = partitionEventsByReferenceBudget(events, universe);
  const maximumChunkSize = Math.max(0, ...chunks.map((chunk) => chunk.length));
  const counts = {
    references_received: 0,
    references_rejected: 0,
    duplicate_references: 0,
    deliveries_ingested: 0,
    ingest_failures: 0,
    transaction_rows: 0,
    slot_rows: 0,
    ignored_rows: 0,
    valid_transaction_rows: 0,
    provider_mismatch_rows: 0,
    invalid_rows: 0,
    off_universe_transactions: 0,
    watched_transactions: 0,
    watched_signers: 0,
  };
  let state = "idle";
  let providerCursor = null;
  let latestProviderEventAge = null;
  for (const chunk of chunks) {
    const transport = await runConstantKNexusWalletStreamBatch({
      watches: universe,
      events: chunk,
      ingest_delivery: ingestDelivery,
      now: () => generatedAt,
    });
    state = combineState(state, transport.state);
    providerCursor = laterProviderCursor(providerCursor, transport.capture.cursor);
    latestProviderEventAge = transport.capture.provider_event_age;
    for (const key of ["references_received", "references_rejected", "duplicate_references", "deliveries_ingested", "ingest_failures"]) {
      counts[key] += Number(transport.health.counts[key] || 0);
    }
    for (const key of [
      "transaction_rows", "slot_rows", "ignored_rows", "valid_transaction_rows", "provider_mismatch_rows",
      "invalid_rows", "off_universe_transactions", "watched_transactions", "watched_signers",
    ]) counts[key] += Number(transport.capture.counts[key] || 0);
    if (transport.health.counts.ingest_failures > 0 || transport.health.counts.references_rejected > 0) {
      fail("constant_k_receiver_ingest_incomplete", {
        ingest_failures: counts.ingest_failures,
        references_rejected: counts.references_rejected,
      });
    }
  }
  return freeze({
    state,
    chunks: chunks.length,
    maximum_chunk_size: maximumChunkSize,
    counts: freeze(counts),
    provider_cursor: providerCursor,
    latest_chunk_provider_event_age: latestProviderEventAge,
  });
}

export async function runConstantKNexusWalletReceiverCycle({
  watches = [],
  checkpoint = null,
  read_batch: readBatch,
  ingest_delivery: ingestDelivery,
  save_checkpoint: saveCheckpoint,
  now = () => new Date(),
} = {}) {
  if (typeof readBatch !== "function") fail("constant_k_receiver_reader_unavailable");
  if (typeof ingestDelivery !== "function") fail("constant_k_receiver_sink_unavailable");
  if (typeof saveCheckpoint !== "function") fail("constant_k_receiver_checkpoint_store_unavailable");
  const prior = normalizeConstantKNexusReceiverCheckpoint(checkpoint);
  const universe = normalizeSourceWalletWatchUniverse(watches, {
    maximum_watches: ConstantKNexusReceiverLimits.maximum_watches,
  });
  const generatedAt = nowIso(now);
  const batch = normalizeReceiverBatch(await readBatch({ checkpoint: prior }));
  const transport = await runTransportChunks({ universe, events: batch.events, ingestDelivery, generatedAt });
  const providerCursor = transport.provider_cursor;
  const nextCheckpoint = freeze({
    schema_version: CONSTANT_K_NEXUS_RECEIVER_CHECKPOINT_SCHEMA,
    source_id: clean(batch.source_id || prior?.source_id || "constant_k_compact_transaction_log", "constant_k_receiver_source_id", 80),
    cursor: normalizeCursor(batch.cursor),
    watch_universe_hash: watchUniverseHash(universe),
    last_provider_slot: providerCursor?.slot ?? prior?.last_provider_slot ?? null,
    last_signature_reference: providerCursor?.signature
      ? `solana_signature_${digest(providerCursor.signature)}`
      : prior?.last_signature_reference || null,
    initial_history_truncated: batch.initial_history_truncated === true || prior?.initial_history_truncated === true,
    counters: checkpointCounters(prior, batch, transport.counts.deliveries_ingested),
    created_at: prior?.created_at || generatedAt,
    updated_at: generatedAt,
  });
  await saveCheckpoint(nextCheckpoint);
  const degraded = batch.parse_failures > 0
    || batch.oversized_lines > 0
    || transport.state === "degraded"
    || transport.state === "unavailable";
  return freeze({
    schema_version: CONSTANT_K_NEXUS_RECEIVER_RUN_SCHEMA,
    generated_at: generatedAt,
    state: degraded ? "degraded" : batch.lines_committed === 0 ? "idle" : "current",
    continuity: clean(batch.continuity || "continuous", "constant_k_receiver_continuity", 40),
    watch_universe_size: universe.length,
    source: {
      event_rows: batch.event_rows,
      lines_committed: batch.lines_committed,
      bytes_committed: batch.bytes_committed,
      parse_failures: batch.parse_failures,
      oversized_lines: batch.oversized_lines,
      initial_history_truncated: nextCheckpoint.initial_history_truncated,
      raw_lines_returned: false,
      raw_provider_payload_persisted: false,
    },
    transport: {
      state: transport.state,
      chunks: transport.chunks,
      maximum_chunk_size: transport.maximum_chunk_size,
      counts: transport.counts,
      latest_chunk_provider_event_age: transport.latest_chunk_provider_event_age,
    },
    checkpoint: {
      persisted: true,
      advanced: !prior || !sameCursor(prior.cursor, nextCheckpoint.cursor),
      cycles: nextCheckpoint.counters.cycles,
      last_provider_slot: nextCheckpoint.last_provider_slot,
      last_signature_reference: nextCheckpoint.last_signature_reference,
    },
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
