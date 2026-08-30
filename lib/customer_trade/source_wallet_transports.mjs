import {
  SourceWalletObserverTransports,
  createSourceWalletObserverDelivery,
} from "./source_wallet_observer.mjs";
import { normalizeSolanaWalletAddress } from "./solana_wallet_intelligence.mjs";

export const SOURCE_WALLET_TRANSPORT_HEALTH_SCHEMA = "ravenos.source_wallet_transport_health.v1";
export const SOURCE_WALLET_TRANSPORT_RUN_SCHEMA = "ravenos.source_wallet_transport_run.v1";

export const SourceWalletTransportLimits = Object.freeze({
  maximum_watches_per_run: 250,
  maximum_stream_references_per_run: 1_000,
  maximum_rpc_page_size: 100,
  maximum_rpc_pages_per_wallet: 4,
  maximum_rpc_concurrency: 8,
  maximum_provider_name_length: 80,
  maximum_signature_length: 100,
  reconnect_delays_ms: Object.freeze([1_000, 2_000, 5_000, 10_000, 20_000, 30_000, 60_000]),
});

const TRANSPORTS = new Set(SourceWalletObserverTransports);
const STREAM_TRANSPORTS = new Set(["geyser_grpc", "shredstream", "replay"]);
const FINALITIES = new Set(["processed", "confirmed", "finalized"]);
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

function integer(value, field, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER, optional = false } = {}) {
  if (optional && (value === null || value === undefined || value === "")) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) fail(`${field}_invalid`);
  return parsed;
}

function timestamp(value, field, { optional = false } = {}) {
  if (optional && (value === null || value === undefined || value === "")) return null;
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) fail(`${field}_invalid`);
  return new Date(parsed).toISOString();
}

function nowIso(now) {
  const value = typeof now === "function" ? now() : now;
  if (value instanceof Date) return timestamp(value.toISOString(), "observer_transport_clock");
  if (Number.isFinite(Number(value))) return timestamp(new Date(Number(value)).toISOString(), "observer_transport_clock");
  return timestamp(value || new Date().toISOString(), "observer_transport_clock");
}

function chainTime(value) {
  if (value === null || value === undefined || value === "") return null;
  if (Number.isSafeInteger(Number(value))) return new Date(Number(value) * 1_000).toISOString();
  return timestamp(value, "observer_transport_chain_time", { optional: true });
}

function signature(value, { optional = false } = {}) {
  const normalized = clean(value, "observer_transport_signature", SourceWalletTransportLimits.maximum_signature_length, { optional });
  if (normalized && !SOLANA_SIGNATURE_RE.test(normalized)) fail("observer_transport_signature_invalid");
  return normalized;
}

function finality(value, fallback = "processed") {
  const normalized = clean(value || fallback, "observer_transport_finality", 20).toLowerCase();
  if (!FINALITIES.has(normalized)) fail("observer_transport_finality_invalid");
  return normalized;
}

function transport(value, { streamOnly = false } = {}) {
  const normalized = clean(value, "observer_transport", 24).toLowerCase();
  if (!(streamOnly ? STREAM_TRANSPORTS : TRANSPORTS).has(normalized)) fail("observer_transport_invalid");
  return normalized;
}

function provider(value) {
  return clean(value, "observer_transport_provider", SourceWalletTransportLimits.maximum_provider_name_length);
}

function percentile(values, percentage) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const index = Math.max(0, Math.ceil((percentage / 100) * sorted.length) - 1);
  return sorted[index];
}

function metric(values) {
  const usable = values.filter(Number.isFinite);
  return freeze({
    available: usable.length > 0,
    samples: usable.length,
    p50_ms: percentile(usable, 50),
    p90_ms: percentile(usable, 90),
    p95_ms: percentile(usable, 95),
    p99_ms: percentile(usable, 99),
  });
}

function errorCode(error) {
  const source = `${error?.code || ""} ${error?.name || ""} ${error?.message || ""}`.toLowerCase();
  if (/abort|timeout|timed.?out|etimedout/.test(source)) return "provider_timeout";
  if (/429|rate.?limit/.test(source)) return "provider_rate_limited";
  if (/401|403|unauthor|forbidden/.test(source)) return "provider_authorization_failed";
  if (/too.?large|response_size/.test(source)) return "provider_response_too_large";
  if (/malformed|invalid|json|schema/.test(source)) return "provider_response_malformed";
  if (/sink|ingest|queue/.test(source)) return "observer_ingest_unavailable";
  return "provider_unavailable";
}

function addError(counts, error) {
  const code = typeof error === "string" ? error : errorCode(error);
  counts[code] = (counts[code] || 0) + 1;
  return code;
}

function referenceKey(delivery) {
  return `${delivery.source_wallet.address}:${delivery.signature}:${delivery.finality}`;
}

function sourceKey(address) {
  return `solana:mainnet:${address}`;
}

function cursorFor(row = {}) {
  const cursor = row.cursor && typeof row.cursor === "object" ? row.cursor : row;
  const cursorSignature = signature(cursor.signature || cursor.cursor_signature, { optional: true });
  const cursorSlot = integer(cursor.slot ?? cursor.cursor_slot, "observer_transport_cursor_slot", { optional: true });
  if ((cursorSignature && cursorSlot === null) || (!cursorSignature && cursorSlot !== null)) fail("observer_transport_cursor_invalid");
  return cursorSignature ? { signature: cursorSignature, slot: cursorSlot } : null;
}

function betterCursor(left, right) {
  if (!left) return right;
  if (!right) return left;
  if (right.slot !== left.slot) return right.slot > left.slot ? right : left;
  return right.signature.localeCompare(left.signature) > 0 ? right : left;
}

export function normalizeSourceWalletWatchUniverse(rows = [], {
  maximum_watches: maximumWatches = SourceWalletTransportLimits.maximum_watches_per_run,
} = {}) {
  if (!Array.isArray(rows)) fail("observer_watch_universe_invalid");
  const maximum = Math.max(1, Math.min(SourceWalletTransportLimits.maximum_watches_per_run, Number(maximumWatches) || 1));
  const unique = new Map();
  for (const row of rows) {
    const value = typeof row === "string" ? { address: row } : row;
    if (!value || typeof value !== "object") fail("observer_watch_universe_invalid");
    const address = normalizeSolanaWalletAddress(value.address || value.wallet_address || value?.source_wallet?.address);
    const next = {
      source_wallet: { chain: "solana", network: "mainnet", address },
      cursor: cursorFor(value),
    };
    const key = sourceKey(address);
    const current = unique.get(key);
    unique.set(key, current ? { ...current, cursor: betterCursor(current.cursor, next.cursor) } : next);
    if (unique.size > maximum) fail("observer_watch_universe_too_large");
  }
  return freeze([...unique.values()].sort((left, right) => left.source_wallet.address.localeCompare(right.source_wallet.address)));
}

export function observerTransportReconnectDelayMs(attemptCount, { jitter_ratio: jitterRatio = 0, random = Math.random } = {}) {
  const attempt = Math.max(1, Math.floor(Number(attemptCount) || 1));
  const delays = SourceWalletTransportLimits.reconnect_delays_ms;
  const base = delays[Math.min(delays.length - 1, attempt - 1)];
  const ratio = Math.max(0, Math.min(0.25, Number(jitterRatio) || 0));
  if (!ratio) return base;
  const sample = Math.max(0, Math.min(1, Number(random()) || 0));
  return Math.round(base * (1 - ratio + (sample * ratio * 2)));
}

export function normalizeSourceWalletTransportReference(input = {}, {
  provider: providerName,
  transport: transportName,
  received_at: receivedAt = new Date().toISOString(),
  default_finality: defaultFinality = "processed",
} = {}) {
  const address = normalizeSolanaWalletAddress(input.wallet_address || input.address || input?.source_wallet?.address);
  const observedAt = timestamp(receivedAt, "observer_transport_received_at");
  const rowFinality = finality(input.finality || input.confirmation_status || input.confirmationStatus, defaultFinality);
  const rowProvider = provider(providerName || input.provider);
  const rowTransport = transport(transportName || input.transport);
  const rowSignature = signature(input.signature || input.transaction_signature);
  const rowSlot = integer(input.slot, "observer_transport_slot");
  const providerObservedAt = input.provider_observed_at
    ? timestamp(input.provider_observed_at, "observer_transport_provider_observed_at")
    : null;
  const chainEventAt = chainTime(input.chain_event_at ?? input.block_time ?? input.blockTime);
  return createSourceWalletObserverDelivery({
    source_wallet: { chain: "solana", network: "mainnet", address },
    signature: rowSignature,
    slot: rowSlot,
    finality: rowFinality,
    provider: rowProvider,
    transport: rowTransport,
    chain_event_at: chainEventAt,
    provider_observed_at: providerObservedAt,
    raven_received_at: observedAt,
    evidence_reference: `solana:signature:${rowSignature}`,
  }, { received_at: observedAt });
}

function healthFromStats(stats, {
  provider: providerName,
  transport: transportName,
  observed_at: observedAt,
} = {}) {
  const attempts = stats.requests_attempted + stats.references_received;
  const failures = Object.values(stats.errors).reduce((sum, value) => sum + value, 0);
  const state = attempts === 0
    ? "idle"
    : stats.provider_successes === 0 && stats.deliveries_ingested === 0
      ? "unavailable"
      : failures > 0 || stats.gap_wallets > 0 || stats.ingest_failures > 0
        ? "degraded"
        : "current";
  return freeze({
    schema_version: SOURCE_WALLET_TRANSPORT_HEALTH_SCHEMA,
    observed_at: timestamp(observedAt, "observer_transport_health_observed_at"),
    provider: provider(providerName),
    transport: transport(transportName),
    state,
    counts: {
      unique_wallets: stats.unique_wallets,
      requests_attempted: stats.requests_attempted,
      provider_successes: stats.provider_successes,
      references_received: stats.references_received,
      references_rejected: stats.references_rejected,
      duplicate_references: stats.duplicate_references,
      deliveries_ingested: stats.deliveries_ingested,
      ingest_failures: stats.ingest_failures,
      cursor_updates: stats.cursor_updates,
      gap_wallets: stats.gap_wallets,
      initial_history_truncated_wallets: stats.initial_history_truncated_wallets,
    },
    request_latency: metric(stats.request_latencies_ms),
    chain_to_receipt_age: metric(stats.chain_to_receipt_ms),
    errors: freeze({ ...stats.errors }),
    calibrated: stats.references_received >= 100,
    limitations: [
      "RPC catch-up age is not prospective stream-detection latency.",
      "Provider health does not imply entry, exit, or copy-trade executability.",
    ],
    execution_boundary: { signing: false, broadcasting: false, custody: false, live_copy: false, fee_collection: false },
  });
}

function emptyStats(uniqueWallets = 0) {
  return {
    unique_wallets: uniqueWallets,
    requests_attempted: 0,
    provider_successes: 0,
    references_received: 0,
    references_rejected: 0,
    duplicate_references: 0,
    deliveries_ingested: 0,
    ingest_failures: 0,
    cursor_updates: 0,
    gap_wallets: 0,
    initial_history_truncated_wallets: 0,
    request_latencies_ms: [],
    chain_to_receipt_ms: [],
    errors: {},
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

function normalizeRpcRows(rows, watch, options) {
  if (!Array.isArray(rows)) fail("provider_response_malformed");
  return rows.map((row) => {
    if (!row || typeof row !== "object") fail("provider_response_malformed");
    const rowSignature = signature(row.signature);
    const rowSlot = integer(row.slot, "observer_transport_slot");
    if (watch.cursor && rowSignature !== watch.cursor.signature && rowSlot < watch.cursor.slot) fail("provider_cursor_regression");
    return normalizeSourceWalletTransportReference({
      wallet_address: watch.source_wallet.address,
      signature: rowSignature,
      slot: rowSlot,
      finality: row.confirmationStatus || row.confirmation_status || options.default_finality,
      block_time: row.blockTime ?? row.block_time,
      provider_observed_at: options.received_at,
    }, options);
  });
}

function orderedDeliveries(rows) {
  return [...rows].sort((left, right) => {
    if (left.slot !== right.slot) return left.slot - right.slot;
    const leftTime = Date.parse(left.chain_event_at || "") || 0;
    const rightTime = Date.parse(right.chain_event_at || "") || 0;
    return leftTime - rightTime || left.signature.localeCompare(right.signature);
  });
}

export async function runRpcPollSourceWalletAdapter({
  watches = [],
  fetch_signatures: fetchSignatures,
  ingest_delivery: ingestDelivery,
  provider: providerName = "configured_solana_rpc",
  now = () => new Date(),
  page_size: requestedPageSize = 32,
  maximum_pages: requestedMaximumPages = SourceWalletTransportLimits.maximum_rpc_pages_per_wallet,
  concurrency: requestedConcurrency = SourceWalletTransportLimits.maximum_rpc_concurrency,
  commitment = "confirmed",
} = {}) {
  if (typeof fetchSignatures !== "function") fail("observer_transport_fetcher_unavailable");
  if (typeof ingestDelivery !== "function") fail("observer_transport_ingest_unavailable");
  const normalizedProvider = provider(providerName);
  const universe = normalizeSourceWalletWatchUniverse(watches);
  const pageSize = Math.max(1, Math.min(SourceWalletTransportLimits.maximum_rpc_page_size, Math.floor(Number(requestedPageSize) || 1)));
  const maximumPages = Math.max(1, Math.min(SourceWalletTransportLimits.maximum_rpc_pages_per_wallet, Math.floor(Number(requestedMaximumPages) || 1)));
  const concurrency = Math.max(1, Math.min(SourceWalletTransportLimits.maximum_rpc_concurrency, Math.floor(Number(requestedConcurrency) || 1)));
  const startedAt = nowIso(now);
  const stats = emptyStats(universe.length);
  const cursorUpdates = [];
  const walletResults = [];
  await runPool(universe, concurrency, async (watch) => {
    const result = {
      source_wallet: watch.source_wallet,
      state: "current",
      references_received: 0,
      deliveries_ingested: 0,
      cursor: watch.cursor,
      cursor_update: null,
      catch_up_required: false,
      initial_history_truncated: false,
      error_code: null,
    };
    try {
      let before = null;
      const allRows = [];
      let lastPageFull = false;
      const pages = watch.cursor ? maximumPages : 1;
      for (let page = 0; page < pages; page += 1) {
        const requestStarted = Date.now();
        stats.requests_attempted += 1;
        const rows = await fetchSignatures({
          wallet_address: watch.source_wallet.address,
          before,
          until: watch.cursor?.signature || null,
          limit: pageSize,
          commitment,
        });
        stats.request_latencies_ms.push(Math.max(0, Date.now() - requestStarted));
        if (!Array.isArray(rows)) fail("provider_response_malformed");
        stats.provider_successes += 1;
        allRows.push(...rows);
        lastPageFull = rows.length === pageSize;
        if (rows.length < pageSize) break;
        before = signature(rows.at(-1)?.signature);
      }
      const overflow = Boolean(watch.cursor && lastPageFull && allRows.length >= pageSize * maximumPages);
      if (overflow) {
        result.state = "gap_detected";
        result.catch_up_required = true;
        result.error_code = "provider_catch_up_bound_exceeded";
        stats.gap_wallets += 1;
        addError(stats.errors, result.error_code);
        walletResults.push(result);
        return;
      }
      if (!watch.cursor && lastPageFull) {
        result.initial_history_truncated = true;
        stats.initial_history_truncated_wallets += 1;
      }
      const receivedAt = nowIso(now);
      const deliveries = normalizeRpcRows(allRows, watch, {
        provider: normalizedProvider,
        transport: "rpc_poll",
        received_at: receivedAt,
        default_finality: commitment === "finalized" ? "finalized" : "confirmed",
      });
      const seen = new Set();
      const unique = [];
      for (const delivery of deliveries) {
        const key = referenceKey(delivery);
        if (seen.has(key)) {
          stats.duplicate_references += 1;
          continue;
        }
        seen.add(key);
        unique.push(delivery);
      }
      result.references_received = unique.length;
      stats.references_received += unique.length;
      let ingested = 0;
      for (const delivery of orderedDeliveries(unique)) {
        if (delivery.chain_event_at) stats.chain_to_receipt_ms.push(Math.max(0, Date.parse(delivery.raven_received_at) - Date.parse(delivery.chain_event_at)));
        try {
          await ingestDelivery(delivery);
          ingested += 1;
          stats.deliveries_ingested += 1;
        } catch (error) {
          stats.ingest_failures += 1;
          addError(stats.errors, error);
          result.state = "ingest_degraded";
          result.error_code = errorCode(error);
          break;
        }
      }
      result.deliveries_ingested = ingested;
      if (ingested === unique.length && unique.length > 0) {
        // getSignaturesForAddress is newest-first. Preserve its exact first
        // signature as the resume cursor; signatures within one slot do not
        // have a lexical execution order.
        const newest = unique[0];
        result.cursor_update = { signature: newest.signature, slot: newest.slot };
        result.cursor = result.cursor_update;
        cursorUpdates.push({ source_wallet: watch.source_wallet, cursor: result.cursor_update });
        stats.cursor_updates += 1;
      }
      walletResults.push(result);
    } catch (error) {
      result.state = "unavailable";
      result.error_code = addError(stats.errors, error);
      walletResults.push(result);
    }
  });
  const completedAt = nowIso(now);
  const health = healthFromStats(stats, { provider: normalizedProvider, transport: "rpc_poll", observed_at: completedAt });
  return freeze({
    schema_version: SOURCE_WALLET_TRANSPORT_RUN_SCHEMA,
    mode: "rpc_poll_catch_up",
    provider: normalizedProvider,
    transport: "rpc_poll",
    started_at: startedAt,
    completed_at: completedAt,
    limits: { unique_wallets: universe.length, page_size: pageSize, maximum_pages: maximumPages, concurrency },
    wallet_results: walletResults.sort((left, right) => left.source_wallet.address.localeCompare(right.source_wallet.address)),
    cursor_updates: cursorUpdates.sort((left, right) => left.source_wallet.address.localeCompare(right.source_wallet.address)),
    health,
    persistence: false,
    execution_boundary: health.execution_boundary,
  });
}

export async function runSourceWalletStreamAdapterBatch({
  watches = [],
  references = [],
  ingest_delivery: ingestDelivery,
  provider: providerName,
  transport: transportName,
  now = () => new Date(),
} = {}) {
  if (typeof ingestDelivery !== "function") fail("observer_transport_ingest_unavailable");
  if (!Array.isArray(references)) fail("observer_transport_references_invalid");
  if (references.length > SourceWalletTransportLimits.maximum_stream_references_per_run) fail("observer_transport_batch_too_large");
  const normalizedProvider = provider(providerName);
  const normalizedTransport = transport(transportName, { streamOnly: true });
  const universe = normalizeSourceWalletWatchUniverse(watches);
  const allowed = new Set(universe.map((row) => row.source_wallet.address));
  const receivedAt = nowIso(now);
  const stats = emptyStats(universe.length);
  const seen = new Set();
  const deliveries = [];
  stats.references_received = references.length;
  for (const row of references) {
    try {
      const delivery = normalizeSourceWalletTransportReference(row, {
        provider: normalizedProvider,
        transport: normalizedTransport,
        received_at: receivedAt,
        default_finality: "processed",
      });
      if (!allowed.has(delivery.source_wallet.address)) {
        stats.references_rejected += 1;
        addError(stats.errors, "observer_reference_outside_watch_universe");
        continue;
      }
      const key = referenceKey(delivery);
      if (seen.has(key)) {
        stats.duplicate_references += 1;
        continue;
      }
      seen.add(key);
      deliveries.push(delivery);
    } catch (error) {
      stats.references_rejected += 1;
      addError(stats.errors, error);
    }
  }
  stats.provider_successes = 1;
  for (const delivery of orderedDeliveries(deliveries)) {
    if (delivery.chain_event_at) stats.chain_to_receipt_ms.push(Math.max(0, Date.parse(delivery.raven_received_at) - Date.parse(delivery.chain_event_at)));
    try {
      await ingestDelivery(delivery);
      stats.deliveries_ingested += 1;
    } catch (error) {
      stats.ingest_failures += 1;
      addError(stats.errors, error);
    }
  }
  const completedAt = nowIso(now);
  const health = healthFromStats(stats, { provider: normalizedProvider, transport: normalizedTransport, observed_at: completedAt });
  return freeze({
    schema_version: SOURCE_WALLET_TRANSPORT_RUN_SCHEMA,
    mode: "private_stream_batch",
    provider: normalizedProvider,
    transport: normalizedTransport,
    started_at: receivedAt,
    completed_at: completedAt,
    limits: { unique_wallets: universe.length, maximum_references: SourceWalletTransportLimits.maximum_stream_references_per_run },
    health,
    persistence: false,
    execution_boundary: health.execution_boundary,
  });
}
