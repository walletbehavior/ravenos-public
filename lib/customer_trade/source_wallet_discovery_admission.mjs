import { createHash, randomUUID } from "node:crypto";

import {
  normalizeConstantKNexusWalletCandidateObservation,
} from "./constant_k_nexus_wallet_discovery.mjs";
import {
  SOLANA_WALLET_EVENT_SCHEMA,
  normalizeSolanaWalletAddress,
} from "./solana_wallet_intelligence.mjs";
import {
  SOURCE_WALLET_DISCOVERY_RECEIPT_SCHEMA,
  SourceWalletDiscoveryIngressLimits,
  normalizeSourceWalletDiscoveryBatch,
  sourceWalletDiscoveryReceipt,
} from "./source_wallet_discovery_ingress_protocol.mjs";

export const SOURCE_WALLET_DISCOVERY_CANDIDATE_SCHEMA = "ravenos.source_wallet_discovery_candidate.v1";
export const SOURCE_WALLET_DISCOVERY_HYDRATION_SCHEMA = "ravenos.source_wallet_discovery_hydration.v1";
export const SOURCE_WALLET_DISCOVERY_RUN_SCHEMA = "ravenos.source_wallet_discovery_run.v1";

export const SourceWalletDiscoveryAdmissionLimits = Object.freeze({
  recurring_observations: 2,
  high_signal_observations: 5,
  maximum_jobs_per_run: 8,
  maximum_concurrency: 4,
  maximum_attempts: 8,
  lease_seconds: 180,
  observation_retention_seconds: 2 * 365 * 24 * 60 * 60,
  retry_delays_seconds: Object.freeze([5, 15, 30, 60, 120, 300, 600, 1_200]),
});

const CANDIDATE_STATES = new Set([
  "provider_candidate", "hydration_eligible", "leased", "retry_wait",
  "insufficient_evidence", "admitted", "dead_letter",
]);
const TRADE_KINDS = new Set(["SWAP_BUY", "SWAP_SELL", "MULTIHOP_SWAP", "SPLIT_ROUTE_SWAP"]);

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

function digest(parts, length = 40) {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, length);
}

function epoch(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1_000) : null;
}

function iso(value) {
  return Number.isSafeInteger(Number(value)) ? new Date(Number(value) * 1_000).toISOString() : null;
}

function parseJson(value) {
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function candidateTier(observationCount, distinctMintCount) {
  if (observationCount >= SourceWalletDiscoveryAdmissionLimits.high_signal_observations && distinctMintCount >= 2) return "high_signal";
  if (observationCount >= SourceWalletDiscoveryAdmissionLimits.recurring_observations) return "recurring";
  return "single_observation";
}

function normalizeCandidateRow(row) {
  if (!row || typeof row !== "object") fail("wallet_discovery_candidate_invalid");
  const state = clean(row.state, "wallet_discovery_candidate_state", 40);
  if (!CANDIDATE_STATES.has(state)) fail("wallet_discovery_candidate_invalid");
  const address = normalizeSolanaWalletAddress(row.address);
  const expectedSourceId = `sw_sol_${digest(["solana", "mainnet", address])}`;
  const expectedCandidateId = `swc_${digest(["solana", "mainnet", address])}`;
  if (row.source_wallet_id !== expectedSourceId || row.candidate_id !== expectedCandidateId) fail("wallet_discovery_candidate_identity_mismatch");
  const observationCount = integer(row.observation_count, "wallet_discovery_candidate_observation_count");
  const distinctMintCount = integer(row.distinct_mint_count, "wallet_discovery_candidate_mint_count");
  const evidenceTier = candidateTier(observationCount, distinctMintCount);
  if (row.evidence_tier !== evidenceTier) fail("wallet_discovery_candidate_tier_mismatch");
  return freeze({
    schema_version: SOURCE_WALLET_DISCOVERY_CANDIDATE_SCHEMA,
    candidate_id: expectedCandidateId,
    source_wallet_id: expectedSourceId,
    source_wallet: { chain: "solana", network: "mainnet", address },
    state,
    evidence_tier: evidenceTier,
    observation_count: observationCount,
    exact_swap_shape_count: integer(row.exact_swap_shape_count, "wallet_discovery_candidate_exact_count"),
    reviewed_buy_instruction_count: integer(row.reviewed_buy_instruction_count, "wallet_discovery_candidate_buy_count"),
    distinct_mint_count: distinctMintCount,
    first_observed_at: iso(row.first_observed_at),
    last_observed_at: iso(row.last_observed_at),
    latest_observation_id: clean(row.latest_observation_id, "wallet_discovery_candidate_observation_id", 100, { optional: true }),
    latest_signature: clean(row.latest_signature, "wallet_discovery_candidate_signature", 100),
    latest_slot: integer(row.latest_slot, "wallet_discovery_candidate_slot"),
    hydration_attempt_count: integer(row.hydration_attempt_count, "wallet_discovery_candidate_attempt_count", { maximum: 100 }),
    lease_token: clean(row.lease_token, "wallet_discovery_candidate_lease", 200, { optional: true }),
    admitted_source_wallet_id: clean(row.admitted_source_wallet_id, "wallet_discovery_candidate_admitted_source", 100, { optional: true }),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    claim_boundary: {
      provider_candidate_is_normalized_trade: false,
      provider_candidate_is_profitable_wallet: false,
      provider_candidate_is_copyable_wallet: false,
    },
  });
}

function retryDelay(attempt) {
  const index = Math.max(0, Math.min(SourceWalletDiscoveryAdmissionLimits.retry_delays_seconds.length - 1, Number(attempt || 1) - 1));
  return SourceWalletDiscoveryAdmissionLimits.retry_delays_seconds[index];
}

function safeErrorCode(error) {
  const candidate = String(error?.code || error?.message || "").trim().toLowerCase();
  return /^[a-z][a-z0-9_]{2,99}$/.test(candidate) ? candidate : "wallet_discovery_hydration_failed";
}

function hydrationEvidence({ candidate, observation, state, reasonCode, event = null, startedAt, completedAt }) {
  const classification = event?.classification?.kind || null;
  return freeze({
    schema_version: SOURCE_WALLET_DISCOVERY_HYDRATION_SCHEMA,
    hydration_id: `swdh_${digest([
      candidate.candidate_id,
      observation.observation_id,
      String(candidate.hydration_attempt_count),
      state,
      reasonCode,
    ])}`,
    candidate_id: candidate.candidate_id,
    observation_id: observation.observation_id,
    state,
    reason_code: reasonCode,
    normalized_event_id: event?.event_id || null,
    normalized_event_evidence_hash: event?.evidence_hash || null,
    classification,
    provider: "configured_solana_rpc_hydration",
    started_at: timestamp(startedAt, "wallet_discovery_hydration_started_at"),
    completed_at: timestamp(completedAt, "wallet_discovery_hydration_completed_at"),
    raw_transaction_included: false,
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
  });
}

export function resolveSourceWalletDiscoveryAdmissionActivation(env = {}) {
  const flag = (value) => String(value || "") === "1";
  const ingressRequested = flag(env.RAVENOS_WALLET_DISCOVERY_INGRESS_ENABLED);
  const evaluatorRequested = flag(env.RAVENOS_WALLET_DISCOVERY_EVALUATOR_ENABLED);
  const intelligence = flag(env.RAVENOS_WALLET_INTELLIGENCE_ENABLED);
  const backfill = flag(env.RAVENOS_WALLET_BACKFILL_ENABLED);
  return freeze({
    implemented: true,
    ingress_requested: ingressRequested,
    evaluator_requested: evaluatorRequested,
    ingress: ingressRequested && intelligence,
    evaluator: ingressRequested && evaluatorRequested && intelligence && backfill,
    signing: false,
    submission: false,
    broadcasting: false,
    custody: false,
    live_copy: false,
    fee_collection: false,
  });
}

export function createD1SourceWalletDiscoveryStore(db) {
  if (!db?.prepare) fail("wallet_discovery_store_unavailable");
  const readCandidate = async (candidateId) => {
    const row = await db.prepare(`
      SELECT * FROM ravenos_source_wallet_discovery_candidates
      WHERE candidate_id = ? LIMIT 1
    `).bind(candidateId).first();
    return row ? normalizeCandidateRow(row) : null;
  };
  const readReceipt = async (batchId) => {
    const row = await db.prepare(`
      SELECT receipt_json FROM ravenos_source_wallet_discovery_batches
      WHERE batch_id = ? LIMIT 1
    `).bind(batchId).first();
    const parsed = parseJson(row?.receipt_json);
    return parsed ? sourceWalletDiscoveryReceipt(parsed) : null;
  };
  return freeze({
    getReceipt: readReceipt,
    async ingestBatch(batchInput, { body_sha256: bodySha256, key_id: keyId, now = Date.now() } = {}) {
      const batch = normalizeSourceWalletDiscoveryBatch(batchInput);
      const existing = await readReceipt(batch.batch_id);
      if (existing) {
        if (existing.body_sha256 !== bodySha256) fail("wallet_discovery_batch_replay_mismatch");
        return sourceWalletDiscoveryReceipt({ ...existing, replayed: true });
      }
      if (!/^[a-f0-9]{64}$/.test(String(bodySha256 || ""))) fail("wallet_discovery_body_hash_invalid");
      const receivedAt = new Date(Number(now)).toISOString();
      const seconds = Math.floor(Number(now) / 1_000);
      let insertedCount = 0;
      const affected = new Set();
      for (const inputObservation of batch.observations) {
        const observation = normalizeConstantKNexusWalletCandidateObservation(inputObservation);
        const observedAt = epoch(observation.provider_observed_at);
        await db.prepare(`
          INSERT INTO ravenos_source_wallet_discovery_candidates (
            candidate_id, source_wallet_id, chain, network, address, state, evidence_tier,
            observation_count, exact_swap_shape_count, reviewed_buy_instruction_count,
            distinct_mint_count, first_observed_at, last_observed_at, latest_observation_id,
            latest_signature, latest_slot, hydration_attempt_count, next_hydration_at,
            lease_token, lease_expires_at, last_error_code, admitted_source_wallet_id,
            admitted_at, created_at, updated_at
          ) VALUES (?, ?, 'solana', 'mainnet', ?, 'provider_candidate', 'single_observation',
            0, 0, 0, 0, ?, ?, ?, ?, ?, 0, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)
          ON CONFLICT(chain, network, address) DO UPDATE SET
            last_observed_at = MAX(last_observed_at, excluded.last_observed_at),
            latest_observation_id = CASE WHEN excluded.last_observed_at >= last_observed_at THEN excluded.latest_observation_id ELSE latest_observation_id END,
            latest_signature = CASE WHEN excluded.last_observed_at >= last_observed_at THEN excluded.latest_signature ELSE latest_signature END,
            latest_slot = CASE WHEN excluded.last_observed_at >= last_observed_at THEN excluded.latest_slot ELSE latest_slot END,
            updated_at = MAX(updated_at, excluded.updated_at)
        `).bind(
          observation.candidate_id,
          observation.source_wallet_id,
          observation.source_wallet.address,
          observedAt,
          observedAt,
          observation.observation_id,
          observation.signature,
          observation.slot,
          seconds,
          seconds,
          seconds,
        ).run();
        const inserted = await db.prepare(`
          INSERT OR IGNORE INTO ravenos_source_wallet_discovery_observations (
            observation_id, candidate_id, source_wallet_id, signature, slot, provider,
            transport, finality, evidence_kind, observation_hash, observation_json,
            provider_observed_at, received_at, retention_expires_at
          ) VALUES (?, ?, ?, ?, ?, 'constant_k_nexus', 'geyser_grpc', 'processed', ?, ?, ?, ?, ?, ?)
        `).bind(
          observation.observation_id,
          observation.candidate_id,
          observation.source_wallet_id,
          observation.signature,
          observation.slot,
          observation.economic_evidence.evidence_kind,
          digest([JSON.stringify(observation)]),
          JSON.stringify(observation),
          observedAt,
          seconds,
          seconds + SourceWalletDiscoveryAdmissionLimits.observation_retention_seconds,
        ).run();
        // Rebuild the candidate projection even when this observation already
        // exists. A prior attempt may have durably inserted the append-only
        // evidence and then stopped before updating the projection or receipt.
        // Exact replay must repair that partial state before it is receipted.
        affected.add(observation.candidate_id);
        if (Number(inserted?.meta?.changes || 0) < 1) continue;
        insertedCount += 1;
        for (const mint of observation.economic_evidence.mints) {
          await db.prepare(`
            INSERT INTO ravenos_source_wallet_discovery_candidate_mints (
              candidate_id, mint, first_observed_at, last_observed_at, observation_count
            ) VALUES (?, ?, ?, ?, 1)
            ON CONFLICT(candidate_id, mint) DO UPDATE SET
              first_observed_at = MIN(first_observed_at, excluded.first_observed_at),
              last_observed_at = MAX(last_observed_at, excluded.last_observed_at),
              observation_count = observation_count + 1
          `).bind(observation.candidate_id, mint, observedAt, observedAt).run();
        }
      }

      let eligibleCandidateCount = 0;
      for (const candidateId of affected) {
        const counts = await db.prepare(`
          SELECT
            COUNT(*) AS observation_count,
            SUM(CASE WHEN evidence_kind = 'exact_opposing_token_deltas' THEN 1 ELSE 0 END) AS exact_count,
            SUM(CASE WHEN evidence_kind = 'reviewed_pump_buy_instruction' THEN 1 ELSE 0 END) AS buy_count
          FROM ravenos_source_wallet_discovery_observations WHERE candidate_id = ?
        `).bind(candidateId).first();
        const mintCount = await db.prepare(`
          SELECT COUNT(*) AS count FROM ravenos_source_wallet_discovery_candidate_mints
          WHERE candidate_id = ?
        `).bind(candidateId).first();
        const observationCount = Number(counts?.observation_count || 0);
        const distinctMintCount = Number(mintCount?.count || 0);
        const tier = candidateTier(observationCount, distinctMintCount);
        const nextState = observationCount >= SourceWalletDiscoveryAdmissionLimits.recurring_observations
          ? "hydration_eligible"
          : "provider_candidate";
        await db.prepare(`
          UPDATE ravenos_source_wallet_discovery_candidates SET
            state = CASE WHEN state IN ('admitted', 'leased', 'dead_letter') THEN state ELSE ? END,
            evidence_tier = ?, observation_count = ?, exact_swap_shape_count = ?,
            reviewed_buy_instruction_count = ?, distinct_mint_count = ?,
            next_hydration_at = CASE WHEN state IN ('admitted', 'leased', 'dead_letter') THEN next_hydration_at ELSE ? END,
            last_error_code = CASE WHEN state IN ('admitted', 'leased', 'dead_letter') THEN last_error_code ELSE NULL END,
            updated_at = ?
          WHERE candidate_id = ?
        `).bind(
          nextState,
          tier,
          observationCount,
          Number(counts?.exact_count || 0),
          Number(counts?.buy_count || 0),
          distinctMintCount,
          seconds,
          seconds,
          candidateId,
        ).run();
        const current = await readCandidate(candidateId);
        if (current?.state === "hydration_eligible") eligibleCandidateCount += 1;
      }

      const receipt = sourceWalletDiscoveryReceipt({
        schema_version: SOURCE_WALLET_DISCOVERY_RECEIPT_SCHEMA,
        batch_id: batch.batch_id,
        body_sha256: bodySha256,
        key_id: clean(keyId, "wallet_discovery_key_id", 64),
        observation_count: batch.observations.length,
        inserted_count: insertedCount,
        duplicate_count: batch.observations.length - insertedCount,
        eligible_candidate_count: eligibleCandidateCount,
        sent_at: batch.sent_at,
        received_at: receivedAt,
        replayed: false,
      });
      await db.prepare(`
        INSERT OR IGNORE INTO ravenos_source_wallet_discovery_batches (
          batch_id, body_sha256, request_key_id, observation_count, inserted_count,
          duplicate_count, eligible_candidate_count, sent_at, received_at,
          receipt_json, retention_expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        receipt.batch_id,
        receipt.body_sha256,
        receipt.key_id,
        receipt.observation_count,
        receipt.inserted_count,
        receipt.duplicate_count,
        receipt.eligible_candidate_count,
        epoch(receipt.sent_at),
        epoch(receipt.received_at),
        JSON.stringify(receipt),
        seconds + SourceWalletDiscoveryIngressLimits.receipt_retention_seconds,
      ).run();
      const stored = await readReceipt(receipt.batch_id);
      if (!stored || stored.body_sha256 !== receipt.body_sha256) fail("wallet_discovery_batch_replay_mismatch");
      return stored;
    },
    async leaseCandidates({ worker_id: workerId, now = Date.now(), limit = SourceWalletDiscoveryAdmissionLimits.maximum_jobs_per_run } = {}) {
      const seconds = Math.floor(Number(now) / 1_000);
      const bounded = Math.max(1, Math.min(SourceWalletDiscoveryAdmissionLimits.maximum_jobs_per_run, Number(limit) || 1));
      const rows = await db.prepare(`
        SELECT candidate_id FROM ravenos_source_wallet_discovery_candidates
        WHERE (
          state IN ('hydration_eligible', 'retry_wait') AND next_hydration_at <= ?
        ) OR (
          state = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?
        )
        ORDER BY observation_count DESC, distinct_mint_count DESC, last_observed_at DESC, candidate_id ASC
        LIMIT ?
      `).bind(seconds, seconds, bounded).all();
      const output = [];
      for (const row of rows?.results || []) {
        const leaseToken = `${clean(workerId, "wallet_discovery_worker_id", 80)}:${randomUUID()}`;
        const result = await db.prepare(`
          UPDATE ravenos_source_wallet_discovery_candidates SET
            state = 'leased', lease_token = ?, lease_expires_at = ?,
            hydration_attempt_count = hydration_attempt_count + 1, updated_at = ?
          WHERE candidate_id = ? AND (
            (state IN ('hydration_eligible', 'retry_wait') AND next_hydration_at <= ?)
            OR (state = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?)
          )
        `).bind(
          leaseToken,
          seconds + SourceWalletDiscoveryAdmissionLimits.lease_seconds,
          seconds,
          row.candidate_id,
          seconds,
          seconds,
        ).run();
        if (Number(result?.meta?.changes || 0) > 0) {
          const candidate = await readCandidate(row.candidate_id);
          if (candidate) output.push(candidate);
        }
      }
      return output;
    },
    async nextObservation(candidateId) {
      const row = await db.prepare(`
        SELECT o.observation_json
        FROM ravenos_source_wallet_discovery_observations o
        WHERE o.candidate_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM ravenos_source_wallet_discovery_hydrations h
            WHERE h.observation_id = o.observation_id
              AND h.state IN ('verified_trade', 'verified_non_trade', 'dead_letter')
          )
        ORDER BY o.provider_observed_at DESC, o.observation_id DESC LIMIT 1
      `).bind(candidateId).first();
      const parsed = parseJson(row?.observation_json);
      return parsed ? normalizeConstantKNexusWalletCandidateObservation(parsed) : null;
    },
    async recordHydration(hydration) {
      if (hydration?.schema_version !== SOURCE_WALLET_DISCOVERY_HYDRATION_SCHEMA) fail("wallet_discovery_hydration_invalid");
      await db.prepare(`
        INSERT OR IGNORE INTO ravenos_source_wallet_discovery_hydrations (
          hydration_id, candidate_id, observation_id, state, reason_code,
          normalized_event_id, classification, hydration_json, started_at,
          completed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        hydration.hydration_id,
        hydration.candidate_id,
        hydration.observation_id,
        hydration.state,
        hydration.reason_code,
        hydration.normalized_event_id,
        hydration.classification,
        JSON.stringify(hydration),
        epoch(hydration.started_at),
        epoch(hydration.completed_at),
        epoch(hydration.completed_at),
      ).run();
    },
    async hasUnhydratedObservations(candidateId) {
      const row = await db.prepare(`
        SELECT 1 AS available
        FROM ravenos_source_wallet_discovery_observations o
        WHERE o.candidate_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM ravenos_source_wallet_discovery_hydrations h
            WHERE h.observation_id = o.observation_id
              AND h.state IN ('verified_trade', 'verified_non_trade', 'dead_letter')
          )
        LIMIT 1
      `).bind(candidateId).first();
      return Boolean(row?.available);
    },
    async completeCandidate({ candidate, state, admitted_source_wallet_id: admittedSourceId = null, now = Date.now() }) {
      if (!new Set(["hydration_eligible", "insufficient_evidence", "admitted", "dead_letter"]).has(state)) fail("wallet_discovery_completion_invalid");
      const seconds = Math.floor(Number(now) / 1_000);
      const result = await db.prepare(`
        UPDATE ravenos_source_wallet_discovery_candidates SET
          state = ?, lease_token = NULL, lease_expires_at = NULL,
          next_hydration_at = ?, last_error_code = NULL,
          admitted_source_wallet_id = ?, admitted_at = CASE WHEN ? = 'admitted' THEN ? ELSE NULL END,
          updated_at = ?
        WHERE candidate_id = ? AND state = 'leased' AND lease_token = ?
      `).bind(
        state,
        seconds,
        admittedSourceId,
        state,
        seconds,
        seconds,
        candidate.candidate_id,
        candidate.lease_token,
      ).run();
      if (Number(result?.meta?.changes || 0) < 1) fail("wallet_discovery_lease_lost");
    },
    async retryCandidate({ candidate, error_code: errorCode, dead_letter: deadLetter = false, now = Date.now() }) {
      const seconds = Math.floor(Number(now) / 1_000);
      const result = await db.prepare(`
        UPDATE ravenos_source_wallet_discovery_candidates SET
          state = ?, lease_token = NULL, lease_expires_at = NULL,
          next_hydration_at = ?, last_error_code = ?, updated_at = ?
        WHERE candidate_id = ? AND state = 'leased' AND lease_token = ?
      `).bind(
        deadLetter ? "dead_letter" : "retry_wait",
        seconds + retryDelay(candidate.hydration_attempt_count),
        clean(errorCode, "wallet_discovery_error_code", 100),
        seconds,
        candidate.candidate_id,
        candidate.lease_token,
      ).run();
      if (Number(result?.meta?.changes || 0) < 1) fail("wallet_discovery_lease_lost");
    },
    async health({ now = Date.now() } = {}) {
      const states = await db.prepare(`
        SELECT state, COUNT(*) AS count, MIN(updated_at) AS oldest_updated_at
        FROM ravenos_source_wallet_discovery_candidates GROUP BY state
      `).all();
      const totals = await db.prepare(`
        SELECT COUNT(*) AS candidate_count, COALESCE(SUM(observation_count), 0) AS observation_count,
          SUM(CASE WHEN evidence_tier = 'high_signal' THEN 1 ELSE 0 END) AS high_signal_count
        FROM ravenos_source_wallet_discovery_candidates
      `).first();
      return freeze({
        schema_version: "ravenos.source_wallet_discovery_health.v1",
        observed_at: new Date(Number(now)).toISOString(),
        candidate_count: Number(totals?.candidate_count || 0),
        observation_count: Number(totals?.observation_count || 0),
        high_signal_count: Number(totals?.high_signal_count || 0),
        states: (states?.results || []).map((row) => ({
          state: row.state,
          count: Number(row.count || 0),
          oldest_updated_at: iso(row.oldest_updated_at),
        })),
        profitability_claim_supported: false,
        copyability_claim_supported: false,
        live_copy: false,
      });
    },
  });
}

function validateHydratedEvent(event, candidate, observation) {
  if (
    event?.schema_version !== SOLANA_WALLET_EVENT_SCHEMA
    || event.source_wallet?.address !== candidate.source_wallet.address
    || event.chain_evidence?.signature !== observation.signature
    || Number(event.chain_evidence?.slot) !== observation.slot
  ) fail("wallet_discovery_hydration_identity_mismatch");
  return event;
}

export async function runSourceWalletDiscoveryAdmissionBatch(store, deps = {}, {
  now = Date.now(),
  worker_id: workerId = `wallet_discovery_${randomUUID()}`,
  maximum_jobs: maximumJobs = SourceWalletDiscoveryAdmissionLimits.maximum_jobs_per_run,
} = {}) {
  if (
    !store?.leaseCandidates || !store?.nextObservation || !store?.recordHydration
    || !store?.completeCandidate || !store?.retryCandidate || !store?.hasUnhydratedObservations
  ) fail("wallet_discovery_store_unavailable");
  if (typeof deps.hydrateCandidate !== "function" || typeof deps.admitCandidate !== "function") {
    fail("wallet_discovery_provider_unavailable");
  }
  const startedAt = new Date(Number(now)).toISOString();
  const candidates = await store.leaseCandidates({
    worker_id: workerId,
    now: Number(now),
    limit: Math.max(1, Math.min(SourceWalletDiscoveryAdmissionLimits.maximum_jobs_per_run, Number(maximumJobs) || 1)),
  });
  const totals = {
    candidates_leased: 0,
    candidates_admitted: 0,
    observations_verified_non_trade: 0,
    candidates_requeued_for_evidence: 0,
    candidates_retried: 0,
    candidates_dead_lettered: 0,
  };
  const results = [];
  for (const candidate of candidates) {
    totals.candidates_leased += 1;
    const observation = await store.nextObservation(candidate.candidate_id);
    if (!observation) {
      await store.completeCandidate({ candidate, state: "insufficient_evidence", now: Number(now) });
      results.push({ candidate_id: candidate.candidate_id, state: "insufficient_evidence", reason_code: "no_unhydrated_candidate_observation" });
      continue;
    }
    const hydrationStartedAt = new Date().toISOString();
    try {
      const event = validateHydratedEvent(await deps.hydrateCandidate({ candidate, observation }), candidate, observation);
      const tradeVerified = TRADE_KINDS.has(event.classification?.kind) && event.route_evidence?.swap_route_observed === true;
      const hydrationCompletedAt = new Date().toISOString();
      if (!tradeVerified) {
        const reasonCode = TRADE_KINDS.has(event.classification?.kind)
          ? "raven_swap_route_not_verified"
          : `raven_classified_${String(event.classification?.kind || "unavailable").toLowerCase()}`;
        const hydration = hydrationEvidence({
          candidate,
          observation,
          state: "verified_non_trade",
          reasonCode,
          event,
          startedAt: hydrationStartedAt,
          completedAt: hydrationCompletedAt,
        });
        await store.recordHydration({ ...hydration, normalized_event_id: null });
        const remaining = await store.hasUnhydratedObservations(candidate.candidate_id);
        await store.completeCandidate({ candidate, state: remaining ? "hydration_eligible" : "insufficient_evidence", now: Number(now) });
        totals.observations_verified_non_trade += 1;
        if (remaining) totals.candidates_requeued_for_evidence += 1;
        results.push({ candidate_id: candidate.candidate_id, state: remaining ? "hydration_eligible" : "insufficient_evidence", reason_code: reasonCode });
        continue;
      }
      const admission = await deps.admitCandidate({ candidate, observation, event, now: Number(now) });
      if (admission?.source_wallet_id !== candidate.source_wallet_id) fail("wallet_discovery_admission_identity_mismatch");
      const hydration = hydrationEvidence({
        candidate,
        observation,
        state: "verified_trade",
        reasonCode: "raven_trade_hydration_verified",
        event,
        startedAt: hydrationStartedAt,
        completedAt: hydrationCompletedAt,
      });
      await store.recordHydration(hydration);
      await store.completeCandidate({
        candidate,
        state: "admitted",
        admitted_source_wallet_id: candidate.source_wallet_id,
        now: Number(now),
      });
      totals.candidates_admitted += 1;
      results.push({
        candidate_id: candidate.candidate_id,
        state: "admitted",
        reason_code: "raven_trade_hydration_verified",
        backfill_state: admission.backfill?.state || "unknown",
      });
    } catch (error) {
      const reasonCode = safeErrorCode(error);
      const deadLetter = candidate.hydration_attempt_count >= SourceWalletDiscoveryAdmissionLimits.maximum_attempts
        || /(?:identity_mismatch|invalid)$/.test(reasonCode);
      const completedAt = new Date().toISOString();
      await store.recordHydration(hydrationEvidence({
        candidate,
        observation,
        state: deadLetter ? "dead_letter" : "retry",
        reasonCode,
        startedAt: hydrationStartedAt,
        completedAt,
      })).catch(() => null);
      await store.retryCandidate({ candidate, error_code: reasonCode, dead_letter: deadLetter, now: Number(now) });
      if (deadLetter) totals.candidates_dead_lettered += 1;
      else totals.candidates_retried += 1;
      results.push({ candidate_id: candidate.candidate_id, state: deadLetter ? "dead_letter" : "retry_wait", reason_code: reasonCode });
    }
  }
  return freeze({
    schema_version: SOURCE_WALLET_DISCOVERY_RUN_SCHEMA,
    worker_id: clean(workerId, "wallet_discovery_worker_id", 100),
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    totals: freeze(totals),
    candidates: freeze(results.map((row) => freeze(row))),
    claim_boundary: {
      admitted_means_profitable: false,
      admitted_means_copyable: false,
      source_performance_requires_backfill: true,
      follower_performance_requires_prospective_shadow: true,
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
