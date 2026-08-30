import { createHash, randomUUID } from "node:crypto";

import {
  SOLANA_WALLET_DECODE_VERSION,
  SOLANA_WALLET_EVENT_SCHEMA,
  normalizeSolanaWalletAddress,
  normalizeSolanaWalletTransaction,
} from "./solana_wallet_intelligence.mjs";

export const SOURCE_WALLET_OBSERVER_DELIVERY_SCHEMA = "ravenos.source_wallet_observer_delivery.v1";
export const SOURCE_WALLET_OBSERVER_JOB_SCHEMA = "ravenos.source_wallet_observer_job.v1";
export const SOURCE_WALLET_OBSERVER_LATENCY_SCHEMA = "ravenos.source_wallet_observer_latency.v1";
export const SOURCE_WALLET_OBSERVER_RUN_SCHEMA = "ravenos.source_wallet_observer_run.v1";

export const SourceWalletObserverLimits = Object.freeze({
  maximum_delivery_bytes: 64 * 1024,
  maximum_batch_size: 100,
  maximum_concurrency: 8,
  maximum_attempts: 8,
  lease_seconds: 120,
  maximum_clock_skew_ms: 5 * 60 * 1_000,
  delivery_retention_seconds: 30 * 24 * 60 * 60,
  latency_retention_seconds: 90 * 24 * 60 * 60,
  retry_delays_seconds: Object.freeze([2, 5, 10, 30, 60, 120, 300, 600]),
});

export const SourceWalletObserverTransports = Object.freeze([
  "rpc_poll",
  "geyser_grpc",
  "shredstream",
  "replay",
]);

export const SourceWalletObserverJobStates = Object.freeze([
  "queued",
  "leased",
  "retry_wait",
  "processed",
  "dead_letter",
]);

const TRANSPORTS = new Set(SourceWalletObserverTransports);
const FINALITIES = new Set(["processed", "confirmed", "finalized"]);
const JOB_STATES = new Set(SourceWalletObserverJobStates);
const PERMANENT_ERROR_CODES = new Set([
  "observer_delivery_invalid",
  "observer_delivery_too_large",
  "observer_event_identity_mismatch",
  "observer_event_privacy_boundary_invalid",
  "observer_job_invalid",
  "transaction_material_forbidden",
  "wallet_address_invalid",
  "wallet_event_kind_invalid",
]);
const textEncoder = new TextEncoder();

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

function epoch(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1_000) : null;
}

function iso(seconds) {
  return Number.isSafeInteger(Number(seconds)) ? new Date(Number(seconds) * 1_000).toISOString() : null;
}

function digest(parts) {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40);
}

function parseJson(value, fallback = null) {
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function finalityRank(value) {
  return { processed: 1, confirmed: 2, finalized: 3 }[String(value || "").toLowerCase()] || 0;
}

function jobPriority(delivery) {
  const finality = finalityRank(delivery.finality) * 20;
  const transport = delivery.transport === "shredstream" ? 18
    : delivery.transport === "geyser_grpc" ? 15
      : delivery.transport === "rpc_poll" ? 8
        : 0;
  return Math.min(100, 20 + finality + transport);
}

function sourceWalletId(address) {
  return `sw_sol_${digest(["solana", "mainnet", address])}`;
}

function eventMatchesDelivery(event, delivery) {
  return event?.schema_version === SOLANA_WALLET_EVENT_SCHEMA
    && event?.source_wallet?.chain === "solana"
    && event?.source_wallet?.network === "mainnet"
    && event?.source_wallet?.address === delivery.source_wallet.address
    && event?.chain_evidence?.signature === delivery.signature
    && Number(event?.chain_evidence?.slot) === delivery.slot;
}

function assertEventPrivacy(event) {
  const privacy = event?.privacy || {};
  if (
    privacy.provider_payload_included !== false
    || privacy.signer_material_included !== false
    || privacy.transaction_material_included !== false
    || privacy.subscriber_identity_included !== false
  ) fail("observer_event_privacy_boundary_invalid");
}

function normalizeEventForDelivery(event, delivery) {
  if (!eventMatchesDelivery(event, delivery)) fail("observer_event_identity_mismatch");
  assertEventPrivacy(event);
  return event;
}

export function createSourceWalletObserverDelivery(input = {}, { received_at: receivedAt = new Date().toISOString() } = {}) {
  const address = normalizeSolanaWalletAddress(input?.source_wallet?.address || input.wallet_address);
  const sourceId = sourceWalletId(address);
  if (input.source_wallet_id && input.source_wallet_id !== sourceId) fail("observer_delivery_invalid");
  const signature = clean(input.signature, "observer_signature", 100);
  if (signature.length < 64) fail("observer_delivery_invalid");
  const slot = integer(input.slot, "observer_slot");
  const finality = clean(input.finality || "processed", "observer_finality", 20).toLowerCase();
  if (!FINALITIES.has(finality)) fail("observer_delivery_invalid");
  const provider = clean(input.provider, "observer_provider", 80);
  const transport = clean(input.transport, "observer_transport", 24).toLowerCase();
  if (!TRANSPORTS.has(transport)) fail("observer_delivery_invalid");
  const ravenReceivedAt = timestamp(input.raven_received_at || receivedAt, "observer_received_at");
  const providerObservedAt = timestamp(input.provider_observed_at, "observer_provider_observed_at", { optional: true });
  const chainEventAt = timestamp(input.chain_event_at, "observer_chain_event_at", { optional: true });
  const nowMs = Date.parse(ravenReceivedAt);
  if (providerObservedAt && Date.parse(providerObservedAt) > nowMs + SourceWalletObserverLimits.maximum_clock_skew_ms) fail("observer_delivery_invalid");
  if (chainEventAt && Date.parse(chainEventAt) > nowMs + SourceWalletObserverLimits.maximum_clock_skew_ms) fail("observer_delivery_invalid");
  const evidenceReference = clean(input.evidence_reference || `solana:signature:${signature}`, "observer_evidence_reference", 180);
  const delivery = {
    schema_version: SOURCE_WALLET_OBSERVER_DELIVERY_SCHEMA,
    delivery_id: "",
    source_wallet_id: sourceId,
    source_wallet: { chain: "solana", network: "mainnet", address },
    signature,
    slot,
    finality,
    provider,
    transport,
    chain_event_at: chainEventAt,
    provider_observed_at: providerObservedAt,
    raven_received_at: ravenReceivedAt,
    evidence_reference: evidenceReference,
    normalized_event: input.normalized_event || null,
    decode_required: !input.normalized_event,
    priority: 0,
    privacy: {
      public_source_wallet_only: true,
      raw_provider_payload_persisted: false,
      subscriber_identity_included: false,
      signer_material_included: false,
      transaction_material_included: false,
    },
  };
  if (delivery.normalized_event) normalizeEventForDelivery(delivery.normalized_event, delivery);
  delivery.priority = jobPriority(delivery);
  delivery.delivery_id = `swd_${digest([
    sourceId,
    signature,
    provider,
    transport,
    finality,
    ravenReceivedAt,
  ])}`;
  if (textEncoder.encode(JSON.stringify(delivery)).byteLength > SourceWalletObserverLimits.maximum_delivery_bytes) {
    fail("observer_delivery_too_large");
  }
  return freeze(delivery);
}

export function createSourceWalletObserverJob(delivery, { now = Date.now() } = {}) {
  if (delivery?.schema_version !== SOURCE_WALLET_OBSERVER_DELIVERY_SCHEMA) fail("observer_job_invalid");
  const createdAt = new Date(now).toISOString();
  return freeze({
    schema_version: SOURCE_WALLET_OBSERVER_JOB_SCHEMA,
    job_id: `swo_${digest([delivery.source_wallet_id, delivery.signature, String(SOLANA_WALLET_DECODE_VERSION)])}`,
    source_wallet_id: delivery.source_wallet_id,
    signature: delivery.signature,
    decode_version: SOLANA_WALLET_DECODE_VERSION,
    state: "queued",
    delivery_id: delivery.delivery_id,
    delivery,
    best_finality: delivery.finality,
    priority: delivery.priority,
    delivery_count: 1,
    attempt_count: 0,
    first_received_at: delivery.raven_received_at,
    last_received_at: delivery.raven_received_at,
    next_attempt_at: createdAt,
    lease_token: null,
    lease_expires_at: null,
    last_error_code: null,
    processed_event_id: null,
    processed_at: null,
    created_at: createdAt,
    updated_at: createdAt,
  });
}

export function observerRetryDelaySeconds(attemptCount) {
  const attempt = Math.max(1, Math.floor(Number(attemptCount) || 1));
  const values = SourceWalletObserverLimits.retry_delays_seconds;
  return values[Math.min(values.length - 1, attempt - 1)];
}

function percentile(values, value) {
  const rows = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!rows.length) return null;
  const index = Math.max(0, Math.ceil((value / 100) * rows.length) - 1);
  return rows[index];
}

function duration(left, right) {
  const start = Date.parse(String(left || ""));
  const end = Date.parse(String(right || ""));
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;
}

export function createSourceWalletObserverLatency({ delivery, event, phases = {}, recorded_at: recordedAt = new Date().toISOString() } = {}) {
  if (!eventMatchesDelivery(event, delivery)) fail("observer_event_identity_mismatch");
  const observation = {
    schema_version: SOURCE_WALLET_OBSERVER_LATENCY_SCHEMA,
    latency_id: `swl_${digest([delivery.delivery_id, event.event_id, recordedAt])}`,
    source_wallet_id: delivery.source_wallet_id,
    event_id: event.event_id,
    signature: delivery.signature,
    provider: delivery.provider,
    transport: delivery.transport,
    finality: delivery.finality,
    chain_event_at: delivery.chain_event_at,
    provider_observed_at: delivery.provider_observed_at,
    raven_received_at: delivery.raven_received_at,
    decode_completed_at: phases.decode_completed_at || event?.timing?.decode_completed_at || null,
    fanout_completed_at: phases.fanout_completed_at || null,
    decision_completed_at: phases.decision_completed_at || null,
    detection_delay_ms: duration(delivery.chain_event_at, delivery.raven_received_at),
    provider_delay_ms: duration(delivery.chain_event_at, delivery.provider_observed_at),
    ingress_delay_ms: duration(delivery.provider_observed_at, delivery.raven_received_at),
    decode_latency_ms: Number.isFinite(Number(event?.timing?.decode_latency_ms)) ? Number(event.timing.decode_latency_ms) : null,
    fanout_latency_ms: duration(delivery.raven_received_at, phases.fanout_completed_at),
    total_decision_latency_ms: duration(delivery.chain_event_at, phases.decision_completed_at),
    subscriber_policy_count: Math.max(0, Math.floor(Number(phases.subscriber_policy_count) || 0)),
    decision_count: Math.max(0, Math.floor(Number(phases.decision_count) || 0)),
    recorded_at: timestamp(recordedAt, "observer_latency_recorded_at"),
    source_performance_claimed: false,
    follower_performance_claimed: false,
  };
  return freeze(observation);
}

export function summarizeSourceWalletObserverLatency(rows = [], { generated_at: generatedAt = new Date().toISOString() } = {}) {
  const samples = Array.isArray(rows) ? rows.filter((row) => row?.schema_version === SOURCE_WALLET_OBSERVER_LATENCY_SCHEMA).slice(-10_000) : [];
  const metricFor = (source, field) => {
    const values = source.map((row) => Number(row[field])).filter(Number.isFinite);
    return Object.freeze({
      available: values.length > 0,
      samples: values.length,
      p50_ms: percentile(values, 50),
      p90_ms: percentile(values, 90),
      p95_ms: percentile(values, 95),
      p99_ms: percentile(values, 99),
    });
  };
  const latencyFor = (source) => Object.freeze({
    detection: metricFor(source, "detection_delay_ms"),
    provider: metricFor(source, "provider_delay_ms"),
    ingress: metricFor(source, "ingress_delay_ms"),
    decode: metricFor(source, "decode_latency_ms"),
    fanout: metricFor(source, "fanout_latency_ms"),
    total_decision: metricFor(source, "total_decision_latency_ms"),
  });
  const byTransport = {};
  for (const transport of SourceWalletObserverTransports) {
    const subset = samples.filter((row) => row.transport === transport);
    if (subset.length) byTransport[transport] = latencyFor(subset);
  }
  return freeze({
    schema_version: "ravenos.source_wallet_observer_latency_summary.v1",
    generated_at: timestamp(generatedAt, "observer_latency_generated_at"),
    sample_count: samples.length,
    latency: latencyFor(samples),
    by_transport: byTransport,
    speed_claim_calibrated: samples.length >= 100,
  });
}

function errorCode(error) {
  const value = String(error?.code || error?.message || "observer_job_failed")
    .replace(/[^a-zA-Z0-9_.:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
  return value || "observer_job_failed";
}

function isPermanentError(code) {
  return PERMANENT_ERROR_CODES.has(code)
    || /(?:identity|privacy|malformed|forbidden|mismatch|invalid)$/.test(code);
}

function validateLeasedJob(job) {
  if (
    job?.schema_version !== SOURCE_WALLET_OBSERVER_JOB_SCHEMA
    || !JOB_STATES.has(job.state)
    || job.state !== "leased"
    || job?.delivery?.schema_version !== SOURCE_WALLET_OBSERVER_DELIVERY_SCHEMA
  ) fail("observer_job_invalid");
  return job;
}

async function runPool(rows, concurrency, fn) {
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, rows.length || 1)) }, async () => {
    while (cursor < rows.length) {
      const index = cursor;
      cursor += 1;
      await fn(rows[index]);
    }
  });
  await Promise.all(workers);
}

export async function runSourceWalletObserverBatch(store, deps = {}, {
  now = Date.now(),
  worker_id: workerId = `observer_${randomUUID()}`,
  batch_size: requestedBatchSize = SourceWalletObserverLimits.maximum_batch_size,
  concurrency: requestedConcurrency = SourceWalletObserverLimits.maximum_concurrency,
} = {}) {
  if (!store?.leaseBatch || !store?.completeJob || !store?.retryJob) fail("observer_store_unavailable");
  if (!deps?.recordSharedEvent || !deps?.fanOut) fail("observer_dependencies_unavailable");
  const batchSize = Math.max(1, Math.min(SourceWalletObserverLimits.maximum_batch_size, Math.floor(Number(requestedBatchSize) || 1)));
  const concurrency = Math.max(1, Math.min(SourceWalletObserverLimits.maximum_concurrency, Math.floor(Number(requestedConcurrency) || 1)));
  const leased = await store.leaseBatch({ worker_id: workerId, now, limit: batchSize, lease_seconds: SourceWalletObserverLimits.lease_seconds });
  const jobs = (Array.isArray(leased) ? leased : []).map(validateLeasedJob);
  const totals = {
    jobs_leased: jobs.length,
    jobs_processed: 0,
    jobs_retried: 0,
    jobs_dead_lettered: 0,
    provider_hydrations: 0,
    decode_count: 0,
    shared_events_inserted: 0,
    shared_event_duplicates: 0,
    subscriber_policies_evaluated: 0,
    decisions_recorded: 0,
    shared_quote_variants: 0,
    latency_observations: 0,
  };
  await runPool(jobs, concurrency, async (job) => {
    const delivery = job.delivery;
    try {
      let event = delivery.normalized_event;
      if (!event) {
        if (typeof deps.hydrateDelivery !== "function") fail("observer_hydrator_unavailable");
        totals.provider_hydrations += 1;
        const hydrated = await deps.hydrateDelivery(delivery);
        if (hydrated?.schema_version === SOLANA_WALLET_EVENT_SCHEMA) {
          event = hydrated;
        } else {
          totals.decode_count += 1;
          event = (deps.decode || normalizeSolanaWalletTransaction)(hydrated);
        }
      }
      normalizeEventForDelivery(event, delivery);
      const eventResult = await deps.recordSharedEvent({ event, delivery, job });
      if (eventResult?.inserted === false) totals.shared_event_duplicates += 1;
      else totals.shared_events_inserted += 1;
      const fanoutResult = await deps.fanOut({ event, delivery, job });
      const fanoutCompletedAt = new Date().toISOString();
      totals.subscriber_policies_evaluated += Math.max(0, Number(fanoutResult?.subscriber_policy_count) || 0);
      totals.decisions_recorded += Math.max(0, Number(fanoutResult?.decision_count) || 0);
      totals.shared_quote_variants += Math.max(0, Number(fanoutResult?.quote_variant_count) || 0);
      if (fanoutResult?.complete === false) {
        const incomplete = new Error("observer_fanout_incomplete");
        incomplete.code = "observer_fanout_incomplete";
        throw incomplete;
      }
      const latency = createSourceWalletObserverLatency({
        delivery,
        event,
        phases: {
          fanout_completed_at: fanoutCompletedAt,
          decision_completed_at: fanoutResult?.decision_completed_at || fanoutCompletedAt,
          subscriber_policy_count: fanoutResult?.subscriber_policy_count,
          decision_count: fanoutResult?.decision_count,
        },
        recorded_at: fanoutCompletedAt,
      });
      if (store.recordLatency) {
        await store.recordLatency(latency, { now });
        totals.latency_observations += 1;
      }
      await store.completeJob({ job_id: job.job_id, worker_id: workerId, lease_token: job.lease_token, event_id: event.event_id, finality: delivery.finality, now });
      totals.jobs_processed += 1;
    } catch (error) {
      const code = errorCode(error);
      const attemptCount = Math.max(1, Number(job.attempt_count) || 1);
      const deadLetter = isPermanentError(code) || attemptCount >= SourceWalletObserverLimits.maximum_attempts;
      const retryAt = now + observerRetryDelaySeconds(attemptCount) * 1_000;
      await store.retryJob({ job_id: job.job_id, worker_id: workerId, lease_token: job.lease_token, error_code: code, next_attempt_at: retryAt, dead_letter: deadLetter, now });
      if (deadLetter) totals.jobs_dead_lettered += 1;
      else totals.jobs_retried += 1;
    }
  });
  const run = freeze({
    schema_version: SOURCE_WALLET_OBSERVER_RUN_SCHEMA,
    run_id: `swr_${digest([workerId, String(now), JSON.stringify(totals)])}`,
    worker_id: clean(workerId, "observer_worker_id", 100),
    started_at: new Date(now).toISOString(),
    completed_at: new Date().toISOString(),
    limits: { batch_size: batchSize, concurrency, lease_seconds: SourceWalletObserverLimits.lease_seconds },
    totals,
    execution_boundary: { signing: false, broadcasting: false, custody: false, live_copy: false, fee_collection: false },
  });
  if (store.recordRun) await store.recordRun(run, { now });
  return run;
}

export function resolveSourceWalletObserverActivation(env = {}) {
  const enabled = String(env.RAVENOS_WALLET_OBSERVER_ENABLED || "") === "1";
  const evaluator = String(env.RAVENOS_WALLET_OBSERVER_EVALUATOR_ENABLED || "") === "1";
  const intelligence = String(env.RAVENOS_WALLET_INTELLIGENCE_ENABLED || "") === "1";
  const shadow = String(env.RAVENOS_SHADOW_COPY_ENABLED || "") === "1";
  return freeze({
    ingest: enabled && intelligence,
    evaluator: enabled && evaluator && intelligence && shadow,
    configured: enabled || evaluator,
    live_copy: false,
    signing: false,
    broadcasting: false,
  });
}

export function createD1SourceWalletObserverStore(db) {
  if (!db?.prepare) fail("observer_store_unavailable");
  const readJob = async (jobId) => {
    const row = await db.prepare(`
      SELECT j.*, d.delivery_json
      FROM ravenos_source_wallet_observer_jobs j
      JOIN ravenos_source_wallet_observer_deliveries d ON d.delivery_id = j.delivery_id
      WHERE j.job_id = ? LIMIT 1
    `).bind(jobId).first();
    if (!row) return null;
    return freeze({
      schema_version: SOURCE_WALLET_OBSERVER_JOB_SCHEMA,
      job_id: row.job_id,
      source_wallet_id: row.source_wallet_id,
      signature: row.signature,
      decode_version: Number(row.decode_version),
      state: row.state,
      delivery_id: row.delivery_id,
      delivery: parseJson(row.delivery_json),
      best_finality: row.best_finality,
      priority: Number(row.priority),
      delivery_count: Number(row.delivery_count),
      attempt_count: Number(row.attempt_count),
      first_received_at: iso(row.first_received_at),
      last_received_at: iso(row.last_received_at),
      next_attempt_at: iso(row.next_attempt_at),
      lease_token: row.lease_token,
      lease_expires_at: iso(row.lease_expires_at),
      last_error_code: row.last_error_code,
      processed_event_id: row.processed_event_id,
      processed_at: iso(row.processed_at),
      created_at: iso(row.created_at),
      updated_at: iso(row.updated_at),
    });
  };
  return freeze({
    async ingestDelivery(delivery, { now = Date.now() } = {}) {
      if (delivery?.schema_version !== SOURCE_WALLET_OBSERVER_DELIVERY_SCHEMA) fail("observer_delivery_invalid");
      const seconds = Math.floor(now / 1_000);
      await db.prepare(`
        INSERT INTO ravenos_source_wallets (
          source_wallet_id, chain, network, address, observation_state, provider_scope,
          first_requested_at, last_observed_at, last_signature, updated_at
        ) VALUES (?, 'solana', 'mainnet', ?, 'requested', ?, ?, NULL, NULL, ?)
        ON CONFLICT(chain, network, address) DO UPDATE SET
          provider_scope = excluded.provider_scope,
          updated_at = MAX(ravenos_source_wallets.updated_at, excluded.updated_at)
      `).bind(delivery.source_wallet_id, delivery.source_wallet.address, `shared_${delivery.transport}`, seconds, seconds).run();
      const inserted = await db.prepare(`
        INSERT OR IGNORE INTO ravenos_source_wallet_observer_deliveries (
          delivery_id, source_wallet_id, signature, slot, finality, provider, transport,
          chain_event_at, provider_observed_at, received_at, evidence_reference,
          normalized_event_json, delivery_json, retention_expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        delivery.delivery_id,
        delivery.source_wallet_id,
        delivery.signature,
        delivery.slot,
        delivery.finality,
        delivery.provider,
        delivery.transport,
        epoch(delivery.chain_event_at),
        epoch(delivery.provider_observed_at),
        epoch(delivery.raven_received_at),
        delivery.evidence_reference,
        delivery.normalized_event ? JSON.stringify(delivery.normalized_event) : null,
        JSON.stringify(delivery),
        seconds + SourceWalletObserverLimits.delivery_retention_seconds,
      ).run();
      const job = createSourceWalletObserverJob(delivery, { now });
      const current = await db.prepare("SELECT * FROM ravenos_source_wallet_observer_jobs WHERE job_id = ? LIMIT 1").bind(job.job_id).first();
      if (!current) {
        await db.prepare(`
          INSERT INTO ravenos_source_wallet_observer_jobs (
            job_id, source_wallet_id, signature, decode_version, state, delivery_id,
            best_finality, priority, delivery_count, attempt_count, first_received_at,
            last_received_at, next_attempt_at, lease_token, lease_expires_at,
            last_error_code, processed_event_id, processed_finality, processed_at,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, 1, 0, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)
        `).bind(
          job.job_id,
          job.source_wallet_id,
          job.signature,
          job.decode_version,
          job.delivery_id,
          job.best_finality,
          job.priority,
          epoch(job.first_received_at),
          epoch(job.last_received_at),
          seconds,
          seconds,
          seconds,
        ).run();
      } else if (Number(inserted?.meta?.changes || 0) > 0) {
        const improvedFinality = finalityRank(delivery.finality) > finalityRank(current.best_finality);
        const shouldQueue = current.state !== "processed" || improvedFinality;
        await db.prepare(`
          UPDATE ravenos_source_wallet_observer_jobs SET
            state = CASE WHEN ? = 1 THEN 'queued' ELSE state END,
            delivery_id = CASE WHEN ? = 1 OR state != 'processed' THEN ? ELSE delivery_id END,
            best_finality = CASE WHEN ? = 1 THEN ? ELSE best_finality END,
            priority = MAX(priority, ?),
            delivery_count = delivery_count + 1,
            last_received_at = MAX(last_received_at, ?),
            next_attempt_at = CASE WHEN ? = 1 THEN ? ELSE next_attempt_at END,
            lease_token = CASE WHEN ? = 1 THEN NULL ELSE lease_token END,
            lease_expires_at = CASE WHEN ? = 1 THEN NULL ELSE lease_expires_at END,
            updated_at = ?
          WHERE job_id = ?
        `).bind(
          shouldQueue ? 1 : 0,
          improvedFinality ? 1 : 0,
          delivery.delivery_id,
          improvedFinality ? 1 : 0,
          delivery.finality,
          delivery.priority,
          epoch(delivery.raven_received_at),
          shouldQueue ? 1 : 0,
          seconds,
          shouldQueue ? 1 : 0,
          shouldQueue ? 1 : 0,
          seconds,
          job.job_id,
        ).run();
      }
      return { inserted: Number(inserted?.meta?.changes || 0) > 0, job: await readJob(job.job_id) };
    },
    async leaseBatch({ worker_id: workerId, now, limit, lease_seconds: leaseSeconds }) {
      const seconds = Math.floor(now / 1_000);
      const bounded = Math.max(1, Math.min(SourceWalletObserverLimits.maximum_batch_size, Number(limit) || 1));
      const candidates = await db.prepare(`
        SELECT job_id FROM ravenos_source_wallet_observer_jobs
        WHERE (
          state IN ('queued', 'retry_wait') AND next_attempt_at <= ?
        ) OR (
          state = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?
        )
        ORDER BY priority DESC, first_received_at ASC, job_id ASC LIMIT ?
      `).bind(seconds, seconds, bounded).all();
      const output = [];
      for (const row of candidates?.results || []) {
        const token = `${clean(workerId, "observer_worker_id", 80)}:${randomUUID()}`;
        const result = await db.prepare(`
          UPDATE ravenos_source_wallet_observer_jobs SET
            state = 'leased', lease_token = ?, lease_expires_at = ?,
            attempt_count = attempt_count + 1, updated_at = ?
          WHERE job_id = ? AND (
            (state IN ('queued', 'retry_wait') AND next_attempt_at <= ?)
            OR (state = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?)
          )
        `).bind(token, seconds + leaseSeconds, seconds, row.job_id, seconds, seconds).run();
        if (Number(result?.meta?.changes || 0) > 0) {
          const job = await readJob(row.job_id);
          if (job) output.push({ ...job, lease_token: token, state: "leased" });
        }
      }
      return output;
    },
    async completeJob({ job_id: jobId, lease_token: leaseToken, event_id: eventId, finality, now }) {
      const seconds = Math.floor(now / 1_000);
      const result = await db.prepare(`
        UPDATE ravenos_source_wallet_observer_jobs SET
          state = 'processed', processed_event_id = ?, processed_finality = ?, processed_at = ?,
          lease_token = NULL, lease_expires_at = NULL, last_error_code = NULL, updated_at = ?
        WHERE job_id = ? AND state = 'leased' AND lease_token = ?
      `).bind(eventId, finality, seconds, seconds, jobId, clean(leaseToken, "observer_lease_token", 200)).run();
      if (Number(result?.meta?.changes || 0) < 1) fail("observer_job_lease_lost");
    },
    async retryJob({ job_id: jobId, lease_token: leaseToken, error_code: code, next_attempt_at: nextAttemptAt, dead_letter: deadLetter, now }) {
      const seconds = Math.floor(now / 1_000);
      const result = await db.prepare(`
        UPDATE ravenos_source_wallet_observer_jobs SET
          state = ?, next_attempt_at = ?, lease_token = NULL, lease_expires_at = NULL,
          last_error_code = ?, updated_at = ?
        WHERE job_id = ? AND state = 'leased' AND lease_token = ?
      `).bind(deadLetter ? "dead_letter" : "retry_wait", Math.floor(nextAttemptAt / 1_000), code, seconds, jobId, clean(leaseToken, "observer_lease_token", 200)).run();
      if (Number(result?.meta?.changes || 0) < 1) fail("observer_job_lease_lost");
    },
    async recordLatency(latency, { now = Date.now() } = {}) {
      const seconds = Math.floor(now / 1_000);
      await db.prepare(`
        INSERT OR IGNORE INTO ravenos_source_wallet_observer_latency (
          latency_id, source_wallet_id, event_id, signature, provider, transport, finality,
          chain_event_at, provider_observed_at, received_at, decode_completed_at,
          fanout_completed_at, decision_completed_at, detection_delay_ms, provider_delay_ms,
          ingress_delay_ms, decode_latency_ms, fanout_latency_ms, total_decision_latency_ms,
          subscriber_policy_count, decision_count, latency_json, recorded_at, retention_expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        latency.latency_id,
        latency.source_wallet_id,
        latency.event_id,
        latency.signature,
        latency.provider,
        latency.transport,
        latency.finality,
        epoch(latency.chain_event_at),
        epoch(latency.provider_observed_at),
        epoch(latency.raven_received_at),
        epoch(latency.decode_completed_at),
        epoch(latency.fanout_completed_at),
        epoch(latency.decision_completed_at),
        latency.detection_delay_ms,
        latency.provider_delay_ms,
        latency.ingress_delay_ms,
        latency.decode_latency_ms,
        latency.fanout_latency_ms,
        latency.total_decision_latency_ms,
        latency.subscriber_policy_count,
        latency.decision_count,
        JSON.stringify(latency),
        seconds,
        seconds + SourceWalletObserverLimits.latency_retention_seconds,
      ).run();
    },
    async recordRun(run, { now = Date.now() } = {}) {
      await db.prepare(`
        INSERT OR IGNORE INTO ravenos_source_wallet_observer_runs (
          run_id, worker_id, started_at, completed_at, run_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        run.run_id,
        run.worker_id,
        epoch(run.started_at),
        epoch(run.completed_at),
        JSON.stringify(run),
        Math.floor(now / 1_000),
      ).run();
    },
    async health({ now = Date.now() } = {}) {
      const seconds = Math.floor(now / 1_000);
      const queue = await db.prepare(`
        SELECT state, COUNT(*) AS count, MIN(first_received_at) AS oldest_received_at
        FROM ravenos_source_wallet_observer_jobs GROUP BY state
      `).all();
      const due = await db.prepare(`
        SELECT COUNT(*) AS count FROM ravenos_source_wallet_observer_jobs
        WHERE state IN ('queued', 'retry_wait') AND next_attempt_at <= ?
      `).bind(seconds).first();
      return freeze({
        schema_version: "ravenos.source_wallet_observer_health.v1",
        observed_at: new Date(now).toISOString(),
        due_jobs: Number(due?.count || 0),
        queue: (queue?.results || []).map((row) => ({ state: row.state, count: Number(row.count || 0), oldest_received_at: iso(row.oldest_received_at) })),
        live_copy: false,
      });
    },
  });
}
