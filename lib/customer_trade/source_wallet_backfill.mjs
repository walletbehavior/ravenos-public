import { createHash, randomUUID } from "node:crypto";
import { normalizeSourceWalletChainIdentity, isSourceWalletId } from "./source_wallet_chain_identity.mjs";
import { WalletHistoryPolicy } from './wallet_history_policy.mjs';
import { createWalletReferenceRetryStore } from './wallet_reference_retries.mjs';

import {
  SOLANA_WALLET_EVENT_SCHEMA,
  SOLANA_WALLET_PROFILE_VERSION,
  normalizeSolanaWalletAddress,
  normalizeSolanaWalletTransaction,
} from "./solana_wallet_intelligence.mjs";

export const SOURCE_WALLET_BACKFILL_JOB_SCHEMA = "ravenos.source_wallet_backfill_job.v1";
export const SOURCE_WALLET_BACKFILL_PAGE_SCHEMA = "ravenos.source_wallet_backfill_page.v1";
export const SOURCE_WALLET_BACKFILL_RUN_SCHEMA = "ravenos.source_wallet_backfill_run.v1";

export const SourceWalletBackfillLimits = Object.freeze({
  page_size: 100,
  maximum_pages_per_job_run: 4,
  maximum_jobs_per_run: 8,
  maximum_concurrency: 8,
  maximum_attempts: 8,
  maximum_signatures_per_wallet: 10_000,
  lease_seconds: 180,
  profile_chain_rotation_seconds: 300,
  retry_delays_seconds: Object.freeze([5, 15, 30, 60, 120, 300, 600, 1_200]),
});

export const SourceWalletBackfillDemandPriorities = Object.freeze({
  customer_watch: 500,
  saved_research: 400,
  interactive_lookup: 300,
  nexus_research: 200,
  indexed_research: 100,
});

const JOB_STATES = new Set(["queued", "leased", "retry_wait", "complete", "bounded_partial", "dead_letter"]);
const FINALITIES = new Set(["processed", "confirmed", "finalized"]);
const SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,100}$/;

function flag(value) {
  return String(value || "") === "1";
}

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
  if (value instanceof Date) return timestamp(value.toISOString(), "source_wallet_backfill_clock");
  if (Number.isFinite(Number(value))) return timestamp(new Date(Number(value)).toISOString(), "source_wallet_backfill_clock");
  return timestamp(value || new Date().toISOString(), "source_wallet_backfill_clock");
}

function digest(parts, length = 40) {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, length);
}

function sourceWalletId(address) {
  return `sw_sol_${digest(["solana", "mainnet", address])}`;
}

function signature(value, { optional = false } = {}) {
  const normalized = clean(value, "source_wallet_backfill_signature", 100, { optional });
  if (normalized && !SIGNATURE_RE.test(normalized)) fail("source_wallet_backfill_signature_invalid");
  return normalized;
}

function demandClass(value = "indexed_research") {
  const normalized = clean(value, "source_wallet_backfill_demand_class", 32).toLowerCase();
  if (!Object.hasOwn(SourceWalletBackfillDemandPriorities, normalized)) fail("source_wallet_backfill_demand_class_invalid");
  return normalized;
}

function evidencePriority(value = 0) {
  return integer(value, "source_wallet_backfill_evidence_priority", { maximum: 1_000 });
}

function normalizeProviderCursor(value) {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value) || JSON.stringify(value).length > 16384) fail("source_wallet_backfill_cursor_invalid");
  return JSON.parse(JSON.stringify(value));
}

function normalizeJob(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("source_wallet_backfill_job_invalid");
  if (input.schema_version !== SOURCE_WALLET_BACKFILL_JOB_SCHEMA) fail("source_wallet_backfill_job_invalid");
  const identity = normalizeSourceWalletChainIdentity({chain: input.source_wallet?.chain || "solana", network: "mainnet", address: input.source_wallet?.address || input.address});
  const address = identity.address;
  const expectedSourceId = identity.source_wallet_id;
  const sourceId = clean(input.source_wallet_id, "source_wallet_backfill_source_id", 100);
  if (sourceId !== expectedSourceId) fail("source_wallet_backfill_identity_mismatch");
  const state = clean(input.state, "source_wallet_backfill_state", 32).toLowerCase();
  if (!JOB_STATES.has(state)) fail("source_wallet_backfill_job_invalid");
  const normalizedDemandClass = demandClass(input.demand_class);
  const normalizedDemandPriority = integer(
    input.demand_priority ?? SourceWalletBackfillDemandPriorities[normalizedDemandClass],
    "source_wallet_backfill_demand_priority",
    { maximum: 1_000 },
  );
  if (normalizedDemandPriority !== SourceWalletBackfillDemandPriorities[normalizedDemandClass]) fail("source_wallet_backfill_demand_priority_invalid");
  return freeze({
    schema_version: SOURCE_WALLET_BACKFILL_JOB_SCHEMA,
    job_id: clean(input.job_id, "source_wallet_backfill_job_id", 100),
    source_wallet_id: sourceId,
    source_wallet: { chain: identity.chain, network: "mainnet", address },
    state,
    cursor_before: signature(input.cursor_before, { optional: true }),
    provider_cursor: normalizeProviderCursor(input.provider_cursor),
    page_count: integer(input.page_count ?? 0, "source_wallet_backfill_page_count"),
    signatures_seen: integer(input.signatures_seen ?? 0, "source_wallet_backfill_signatures_seen"),
    history_target: integer(input.history_target ?? SourceWalletBackfillLimits.maximum_signatures_per_wallet, "source_wallet_backfill_history_target", { minimum:100, maximum:identity.chain==='solana'?WalletHistoryPolicy.solana_deep_events:SourceWalletBackfillLimits.maximum_signatures_per_wallet }),
    transactions_decoded: integer(input.transactions_decoded ?? 0, "source_wallet_backfill_transactions_decoded"),
    decode_failures: integer(input.decode_failures ?? 0, "source_wallet_backfill_decode_failures"),
    attempt_count: integer(input.attempt_count ?? 0, "source_wallet_backfill_attempt_count", { maximum: 100 }),
    provider: clean(input.provider || "configured_solana_rpc", "source_wallet_backfill_provider", 80),
    demand_class: normalizedDemandClass,
    demand_priority: normalizedDemandPriority,
    evidence_priority: evidencePriority(input.evidence_priority),
    last_demand_at: timestamp(input.last_demand_at || input.created_at, "source_wallet_backfill_last_demand_at"),
    lease_token: clean(input.lease_token, "source_wallet_backfill_lease_token", 200, { optional: true }),
    history_exhausted: input.history_exhausted === true,
    created_at: timestamp(input.created_at, "source_wallet_backfill_created_at"),
    updated_at: timestamp(input.updated_at, "source_wallet_backfill_updated_at"),
  });
}

export function createSourceWalletBackfillJob({
  address,
  chain = "solana",
  provider = "configured_solana_rpc",
  demand_class: requestedDemandClass = "indexed_research",
  evidence_priority: requestedEvidencePriority = 0,
  history_target: historyTarget,
  requested_at: requestedAt = new Date().toISOString(),
} = {}) {
  const identity = normalizeSourceWalletChainIdentity({chain, network: "mainnet", address});
  const normalizedAddress = identity.address;
  const createdAt = timestamp(requestedAt, "source_wallet_backfill_requested_at");
  const sourceId = identity.source_wallet_id;
  const normalizedDemandClass = demandClass(requestedDemandClass);
  return freeze({
    schema_version: SOURCE_WALLET_BACKFILL_JOB_SCHEMA,
    job_id: `swb_${digest([sourceId, "deep_history_v1"])}`,
    source_wallet_id: sourceId,
    source_wallet: { chain: identity.chain, network: "mainnet", address: normalizedAddress },
    state: "queued",
    cursor_before: null,
    provider_cursor: null,
    page_count: 0,
    signatures_seen: 0,
    history_target: integer(historyTarget ?? (identity.chain==='solana' && SourceWalletBackfillDemandPriorities[normalizedDemandClass]>=300 ? WalletHistoryPolicy.solana_deep_events : SourceWalletBackfillLimits.maximum_signatures_per_wallet), 'source_wallet_backfill_history_target', {minimum:100,maximum:identity.chain==='solana'?WalletHistoryPolicy.solana_deep_events:SourceWalletBackfillLimits.maximum_signatures_per_wallet}),
    transactions_decoded: 0,
    decode_failures: 0,
    attempt_count: 0,
    provider: clean(provider, "source_wallet_backfill_provider", 80),
    demand_class: normalizedDemandClass,
    demand_priority: SourceWalletBackfillDemandPriorities[normalizedDemandClass],
    evidence_priority: evidencePriority(requestedEvidencePriority),
    last_demand_at: createdAt,
    lease_token: null,
    history_exhausted: false,
    created_at: createdAt,
    updated_at: createdAt,
    execution_boundary: { signing: false, broadcasting: false, custody: false, live_copy: false },
  });
}

export function resolveSourceWalletBackfillActivation(env = {}) {
  const requested = flag(env.RAVENOS_WALLET_BACKFILL_ENABLED);
  const intelligence = flag(env.RAVENOS_WALLET_INTELLIGENCE_ENABLED);
  const routes = flag(env.RAVENOS_WALLET_COPY_ROUTES_ENABLED);
  return freeze({
    implemented: true,
    requested,
    evaluator: requested && intelligence && routes,
    signing: false,
    broadcasting: false,
    custody: false,
    live_copy: false,
  });
}

export function sourceWalletBackfillHistoryEvidence(jobInput) {
  const job = normalizeJob(jobInput);
  return freeze({
    provider: job.provider,
    history_limit: job.history_target,
    history_exhausted: job.source_wallet.chain === "solana" ? job.history_exhausted : job.provider_cursor?.provider_exhausted?.in === true && job.provider_cursor?.provider_exhausted?.out === true,
    provider_history_exhausted: job.source_wallet.chain === "solana" ? job.history_exhausted : job.provider_cursor?.provider_exhausted?.in === true && job.provider_cursor?.provider_exhausted?.out === true,
    source_history_verified_complete: false,
    signatures_requested: job.signatures_seen,
    transactions_decoded: job.transactions_decoded,
    decode_partial: job.source_wallet.chain === 'solana' ? job.decode_failures > 0 : Number(job.provider_cursor?.unresolved_references || 0) > 0,
    unresolved_references: Number(job.provider_cursor?.unresolved_references || 0),
    partial: job.state !== "complete",
    backfill_state: job.state,
    chain: job.source_wallet.chain,
    coverage_start_at: job.provider_cursor?.coverage_start_at || null,
    coverage_end_at: job.provider_cursor?.coverage_end_at || null,
    indexed_categories: job.source_wallet.chain === "solana" ? ["wallet_and_token_accounts"] : ["erc20", "external"],
    page_count: job.page_count,
    bounded_at_signature_limit: job.state === "bounded_partial",
    observation_mode: "historical_backfill",
  });
}

export function publicSourceWalletBackfillJob(jobInput) {
  if (!jobInput) return freeze({ state: "not_queued", signatures_indexed: 0, history_exhausted: false, history_complete_claimed: false });
  const job = normalizeJob(jobInput);
  return freeze({
    state: job.state,
    chain: job.source_wallet.chain,
    history_window_days: job.source_wallet.chain === "solana" ? null : 30,
    coverage_start_at: job.provider_cursor?.coverage_start_at || null,
    coverage_end_at: job.provider_cursor?.coverage_end_at || null,
    pages_indexed: job.page_count,
    signatures_indexed: job.signatures_seen,
    transactions_decoded: job.transactions_decoded,
    decode_failures: job.decode_failures,
    unresolved_references: Number(job.provider_cursor?.unresolved_references || 0),
    history_exhausted: job.source_wallet.chain === "solana" ? job.history_exhausted : job.provider_cursor?.provider_exhausted?.in === true && job.provider_cursor?.provider_exhausted?.out === true,
    history_complete_claimed: false,
    maximum_signatures: job.history_target,
    updated_at: job.updated_at,
  });
}

function normalizeSignaturePage(rows, { before, maximum = SourceWalletBackfillLimits.page_size }) {
  if (!Array.isArray(rows) || rows.length > maximum) fail("source_wallet_backfill_page_invalid");
  const seen = new Set();
  let previousSlot = Number.MAX_SAFE_INTEGER;
  const normalized = rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) fail("source_wallet_backfill_page_invalid");
    const rowSignature = signature(row.signature);
    if (rowSignature === before || seen.has(rowSignature)) fail("source_wallet_backfill_page_invalid");
    seen.add(rowSignature);
    const slot = integer(row.slot, "source_wallet_backfill_slot");
    if (slot > previousSlot) fail("source_wallet_backfill_page_order_invalid");
    previousSlot = slot;
    const finality = clean(row.confirmationStatus || row.finality || "confirmed", "source_wallet_backfill_finality", 20).toLowerCase();
    if (!FINALITIES.has(finality)) fail("source_wallet_backfill_page_invalid");
    return freeze({
      signature: rowSignature,
      slot,
      blockTime: row.blockTime === null || row.blockTime === undefined ? null : integer(row.blockTime, "source_wallet_backfill_block_time"),
      confirmationStatus: finality,
      err: row.err ?? null,
    });
  });
  return freeze(normalized);
}

async function mapConcurrent(rows, concurrency, mapper) {
  const output = new Array(rows.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, rows.length || 1)) }, async () => {
    while (cursor < rows.length) {
      const index = cursor;
      cursor += 1;
      try {
        output[index] = { status: "fulfilled", value: await mapper(rows[index], index) };
      } catch (reason) {
        output[index] = { status: "rejected", reason };
      }
    }
  });
  await Promise.all(workers);
  return output;
}

function normalizeHydratedEvent(value, job, signatureRow, timing) {
  const event = value?.schema_version === SOLANA_WALLET_EVENT_SCHEMA
    ? value
    : normalizeSolanaWalletTransaction({
        wallet_address: job.source_wallet.address,
        signature_record: signatureRow,
        transaction: value?.meta ? value : value?.transaction || value,
        provider: job.provider,
        finality: signatureRow.confirmationStatus,
        observation_mode: "historical_backfill",
        received_at: timing.received_at,
        decode_started_at: timing.decode_started_at,
        decoded_at: timing.decoded_at,
        observed_at: timing.decoded_at,
      });
  if (
    event?.schema_version !== SOLANA_WALLET_EVENT_SCHEMA
    || event.source_wallet?.address !== job.source_wallet.address
    || event.chain_evidence?.signature !== signatureRow.signature
    || Number(event.chain_evidence?.slot) !== signatureRow.slot
    || event.timing?.observation_mode !== "historical_backfill"
  ) fail("source_wallet_backfill_event_identity_mismatch");
  return event;
}

function pageEvidence(job, rows, events, failures, { before, observedAt, exhausted }) {
  const nextBefore = rows.at(-1)?.signature || before || null;
  const pageHash = digest(rows.map((row) => `${row.signature}:${row.slot}`).concat(events.map((event) => event.evidence_hash)));
  return freeze({
    schema_version: SOURCE_WALLET_BACKFILL_PAGE_SCHEMA,
    page_id: `swbp_${digest([job.job_id, before || "head", pageHash, observedAt])}`,
    job_id: job.job_id,
    source_wallet_id: job.source_wallet_id,
    cursor_before_reference: before ? `solana_signature_${digest([before], 24)}` : "head",
    next_cursor_reference: nextBefore ? `solana_signature_${digest([nextBefore], 24)}` : null,
    state: failures ? "partial" : "complete",
    signature_count: rows.length,
    decoded_count: events.length,
    failure_count: failures,
    history_exhausted: exhausted,
    page_hash: pageHash,
    provider: job.provider,
    observed_at: observedAt,
    raw_provider_payload_persisted: false,
    transaction_material_persisted: false,
    subscriber_identity_included: false,
  });
}

function retryDelay(attemptCount) {
  const attempt = Math.max(1, Number(attemptCount) || 1);
  return SourceWalletBackfillLimits.retry_delays_seconds[Math.min(SourceWalletBackfillLimits.retry_delays_seconds.length - 1, attempt - 1)];
}

function safeErrorCode(error) {
  const candidate = String(error?.code || error?.message || "").trim().toLowerCase();
  return /^[a-z][a-z0-9_]{2,99}$/.test(candidate) ? candidate : "source_wallet_backfill_provider_failed";
}

function epoch(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1_000) : null;
}

function iso(seconds) {
  return Number.isSafeInteger(Number(seconds)) ? new Date(Number(seconds) * 1_000).toISOString() : null;
}

export function createD1SourceWalletBackfillStore(db, { record_events: recordEvents } = {}) {
  if (!db?.prepare || typeof recordEvents !== "function") fail("source_wallet_backfill_store_unavailable");
  const readJob = async (jobId) => {
    const row = await db.prepare(`
      SELECT j.*, s.address, s.chain
      FROM ravenos_source_wallet_backfill_jobs j
      JOIN ravenos_source_wallets s ON s.source_wallet_id = j.source_wallet_id
      WHERE j.job_id = ? LIMIT 1
    `).bind(jobId).first();
    if (!row) return null;
    return freeze({
      schema_version: SOURCE_WALLET_BACKFILL_JOB_SCHEMA,
      job_id: row.job_id,
      source_wallet_id: row.source_wallet_id,
      source_wallet: { chain: row.chain, network: "mainnet", address: row.address },
      state: row.state,
      cursor_before: row.cursor_before || null,
      provider_cursor: row.provider_cursor_json ? normalizeProviderCursor(JSON.parse(row.provider_cursor_json)) : null,
      page_count: Number(row.page_count || 0),
      signatures_seen: Number(row.signatures_seen || 0),
      history_target: Number(row.history_target || SourceWalletBackfillLimits.maximum_signatures_per_wallet),
      transactions_decoded: Number(row.transactions_decoded || 0),
      decode_failures: Number(row.decode_failures || 0),
      attempt_count: Number(row.attempt_count || 0),
      provider: row.provider,
      demand_class: row.demand_class || "indexed_research",
      demand_priority: Number(row.demand_priority ?? SourceWalletBackfillDemandPriorities.indexed_research),
      evidence_priority: Number(row.evidence_priority || 0),
      last_demand_at: iso(row.last_demand_at || row.created_at),
      lease_token: row.lease_token || null,
      history_exhausted: Number(row.history_exhausted || 0) === 1,
      created_at: iso(row.created_at),
      updated_at: iso(row.updated_at),
    });
  };
  return freeze({
    ...createWalletReferenceRetryStore(db),
    async enqueueJob({
      address,
      chain = "solana",
      provider = "configured_solana_rpc",
      demand_class: requestedDemandClass = "indexed_research",
      evidence_priority: requestedEvidencePriority = 0,
      history_target: historyTarget,
      now = Date.now(),
    } = {}) {
      const job = createSourceWalletBackfillJob({
        address,
        chain,
        provider,
        demand_class: requestedDemandClass,
        evidence_priority: requestedEvidencePriority,
        history_target: historyTarget,
        requested_at: new Date(now).toISOString(),
      });
      const seconds = Math.floor(now / 1_000);
      await db.prepare(`
        INSERT OR IGNORE INTO ravenos_source_wallet_backfill_jobs (
          job_id, source_wallet_id, state, provider, cursor_before, page_count,
          signatures_seen, transactions_decoded, decode_failures, history_exhausted,
          attempt_count, demand_class, demand_priority, evidence_priority, last_demand_at,
          next_attempt_at, lease_token, lease_expires_at,
          last_error_code, created_at, updated_at, completed_at, history_target
        ) VALUES (?, ?, 'queued', ?, NULL, 0, 0, 0, 0, 0, 0, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL, ?)
      `).bind(
        job.job_id,
        job.source_wallet_id,
        job.provider,
        job.demand_class,
        job.demand_priority,
        job.evidence_priority,
        seconds,
        seconds,
        seconds,
        seconds,
        job.history_target,
      ).run();
      await db.prepare(`
        UPDATE ravenos_source_wallet_backfill_jobs SET
          demand_class = CASE WHEN demand_priority < ? THEN ? ELSE demand_class END,
          demand_priority = MAX(demand_priority, ?),
          evidence_priority = MAX(evidence_priority, ?),
          last_demand_at = MAX(last_demand_at, ?)
        WHERE job_id = ?
      `).bind(
        job.demand_priority,
        job.demand_class,
        job.demand_priority,
        job.evidence_priority,
        seconds,
        job.job_id,
      ).run();
      await db.prepare(`UPDATE ravenos_source_wallet_backfill_jobs SET history_target=MAX(history_target,?) WHERE job_id=?`)
        .bind(job.history_target,job.job_id).run();
      await db.prepare(`UPDATE ravenos_source_wallet_backfill_jobs SET state='queued',completed_at=NULL,next_attempt_at=?,attempt_count=0
        WHERE job_id=? AND state='bounded_partial' AND history_exhausted=0 AND signatures_seen<history_target`)
        .bind(seconds,job.job_id).run();
      const existing = await readJob(job.job_id);
      if(chain !== "solana" && existing?.state === "complete" && existing.provider_cursor && seconds-epoch(existing.provider_cursor.coverage_end_at)>300){
        const cursor={...existing.provider_cursor,advance_from_head:true};
        await db.prepare(`UPDATE ravenos_source_wallet_backfill_jobs SET state='queued', provider_cursor_json=?, history_exhausted=0, attempt_count=0, next_attempt_at=?, completed_at=NULL, updated_at=? WHERE job_id=? AND state='complete'`)
          .bind(JSON.stringify(cursor),seconds,seconds,job.job_id).run();
      }
      return readJob(job.job_id);
    },
    async jobForSource(sourceId) {
      const normalized = clean(sourceId, "source_wallet_backfill_source_id", 100);
      if (!isSourceWalletId(normalized)) fail("source_wallet_backfill_source_id_invalid");
      const row = await db.prepare("SELECT job_id FROM ravenos_source_wallet_backfill_jobs WHERE source_wallet_id = ? LIMIT 1").bind(normalized).first();
      return row?.job_id ? readJob(row.job_id) : null;
    },
    async listProfileRefreshCandidates(limit = SourceWalletBackfillLimits.maximum_jobs_per_run, { now = Date.now(), first_profile_slots: firstSlots=0 } = {}) {
      const bounded = Math.max(1, Math.min(SourceWalletBackfillLimits.maximum_jobs_per_run, Number(limit) || 1));
      const seconds = Math.floor(now / 1_000);
      const turn = Math.floor(seconds / SourceWalletBackfillLimits.profile_chain_rotation_seconds);
      // Rotate even when a profile fails to build, so unsuccessful refreshes
      // cannot monopolize subsequent cron cycles. Direct user demand stays first.
      const query = async (kind,count) => db.prepare(`
        WITH scheduling AS (
          SELECT j.job_id,s.chain,j.demand_priority,j.evidence_priority,j.updated_at,
            CASE WHEN j.demand_priority>=${SourceWalletBackfillDemandPriorities.interactive_lookup}
              THEN j.demand_priority ELSE 0 END AS demand_band
          FROM ravenos_source_wallet_backfill_jobs j
          JOIN ravenos_source_wallets s ON s.source_wallet_id=j.source_wallet_id
          LEFT JOIN ravenos_source_wallet_current_profiles c ON c.source_wallet_id=j.source_wallet_id
          LEFT JOIN ravenos_source_wallet_profiles p ON p.profile_snapshot_id=c.profile_snapshot_id
          WHERE j.signatures_seen>0 AND j.state IN ('queued','retry_wait','complete','bounded_partial')
            ${kind==='first' ? 'AND c.source_wallet_id IS NULL' : kind==='refresh' ? 'AND c.source_wallet_id IS NOT NULL' : ''}
            AND (c.generated_at IS NULL OR c.generated_at<=j.updated_at
              OR (s.chain='solana' AND c.profile_version<${SOLANA_WALLET_PROFILE_VERSION})
              OR (c.generated_at<?-900 AND json_extract(p.profile_json,'$.pricing_pending')=1))
        ), ranked AS (
          SELECT *,ROW_NUMBER() OVER (PARTITION BY chain,demand_band
            ORDER BY demand_priority DESC,evidence_priority DESC,updated_at,job_id) AS chain_rank
          FROM scheduling
        ), chains AS (
          SELECT chain,demand_band,ROW_NUMBER() OVER (PARTITION BY demand_band ORDER BY chain)-1 AS chain_position,
            COUNT(*) OVER (PARTITION BY demand_band) AS chain_count
          FROM scheduling GROUP BY chain,demand_band
        ) SELECT r.job_id FROM ranked r JOIN chains c ON c.chain=r.chain AND c.demand_band=r.demand_band
        ORDER BY r.demand_band DESC,r.chain_rank,(c.chain_position+?)%c.chain_count,
          r.demand_priority DESC,r.evidence_priority DESC,r.updated_at,r.job_id LIMIT ?
      `).bind(seconds,turn,count).all();
      const reserve=Math.max(0,Math.min(bounded-1,Number(firstSlots)||0));
      const first=reserve?await query('first',reserve):{results:[]};
      const normal=await query(reserve?'refresh':'all',bounded-(first.results||[]).length);
      const selected=[...(first.results||[]),...(normal.results||[])];
      if(reserve&&selected.length<bounded){
        const extra=await query('all',bounded);
        for(const row of extra.results||[])if(!selected.some(item=>item.job_id===row.job_id)&&selected.length<bounded)selected.push(row);
      }
      const rows={results:selected};
      const jobs = [];
      for (const row of rows?.results || []) {
        const job = await readJob(row.job_id);
        if (job) jobs.push(job);
      }
      return jobs;
    },
    async leaseJobs({ worker_id: workerId, now, limit, lease_seconds: leaseSeconds, breadth_slots: breadthSlots=0, depth_slots: depthSlots=0 }) {
      const seconds = Math.floor(now / 1_000);
      const bounded = Math.max(1, Math.min(SourceWalletBackfillLimits.maximum_jobs_per_run, Number(limit) || 1));
      // Fairness applies between chains; source quality still orders work within
      // each chain, and explicit user requests keep their higher demand bands.
      const candidates = await db.prepare(`
        WITH scheduling AS (
          SELECT j.*,s.chain,
            CASE WHEN demand_priority>=${SourceWalletBackfillDemandPriorities.interactive_lookup}
              THEN demand_priority ELSE 0 END AS demand_band,
            COALESCE((SELECT MAX(priority) FROM ravenos_wallet_discovery_sources d
              WHERE d.source_wallet_id=j.source_wallet_id AND d.expires_at>${seconds}),0) AS source_priority
          FROM ravenos_source_wallet_backfill_jobs j
          JOIN ravenos_source_wallets s ON s.source_wallet_id=j.source_wallet_id
        ), service AS (
          SELECT chain,demand_band,MAX(CASE WHEN page_count>0 OR attempt_count>0 OR state!='queued'
            THEN updated_at ELSE 0 END) AS last_served_at FROM scheduling GROUP BY chain,demand_band
        ), eligible AS (
          SELECT *,ROW_NUMBER() OVER (PARTITION BY chain,demand_band ORDER BY source_priority DESC,
            CASE WHEN signatures_seen<500 THEN 1 ELSE 0 END DESC,
            demand_priority DESC,evidence_priority DESC,next_attempt_at,created_at,job_id) AS chain_rank
          FROM scheduling
        WHERE (
          state IN ('queued', 'retry_wait') AND next_attempt_at <= ?
        ) OR (
          state = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?
        )
        ) SELECT e.job_id FROM eligible e JOIN service s ON s.chain=e.chain AND s.demand_band=e.demand_band
        ORDER BY e.demand_band DESC,e.chain_rank,s.last_served_at,e.source_priority DESC,
          e.demand_priority DESC,e.evidence_priority DESC,e.next_attempt_at,e.created_at,e.job_id LIMIT ?
      `).bind(seconds, seconds, bounded).all();
      const reserved=[];
      // Empty lanes lend capacity to normal demand; one slot always remains
      // for the highest-priority customer watch or interactive request.
      for (const [lane,slots] of [['breadth',breadthSlots],['depth',depthSlots]]) {
        const count=Math.max(0,Math.min(bounded-1,Number(slots)||0));
        if(!count)continue;
        const condition=lane==='breadth' ? 'c.source_wallet_id IS NULL'
          : 'c.source_wallet_id IS NOT NULL AND j.signatures_seen>0 AND j.demand_priority<300';
        const rows=await db.prepare(`WITH ranked AS (
          SELECT j.job_id,s.chain,j.next_attempt_at,j.evidence_priority,j.created_at,
            ROW_NUMBER() OVER (PARTITION BY s.chain ORDER BY j.next_attempt_at,j.evidence_priority DESC,j.created_at,j.job_id) AS chain_rank,
            COALESCE((SELECT MAX(q.updated_at) FROM ravenos_source_wallet_backfill_jobs q
              JOIN ravenos_source_wallets w ON w.source_wallet_id=q.source_wallet_id
              WHERE w.chain=s.chain AND (q.page_count>0 OR q.attempt_count>0)),0) AS last_served_at
          FROM ravenos_source_wallet_backfill_jobs j JOIN ravenos_source_wallets s ON s.source_wallet_id=j.source_wallet_id
          LEFT JOIN ravenos_source_wallet_current_profiles c ON c.source_wallet_id=j.source_wallet_id
          WHERE ${condition} AND ((j.state IN ('queued','retry_wait') AND j.next_attempt_at<=?)
            OR (j.state='leased' AND j.lease_expires_at<=?)))
          SELECT job_id FROM ranked ORDER BY chain_rank,last_served_at,next_attempt_at,evidence_priority DESC,created_at,job_id LIMIT ?`)
          .bind(seconds,seconds,count).all();
        reserved.push(...(rows.results||[]));
      }
      const selected=[...reserved.slice(0,bounded-1),...(candidates.results||[])].filter((row,index,all)=>all.findIndex(other=>other.job_id===row.job_id)===index).slice(0,bounded);
      const output = [];
      for (const row of selected) {
        const token = `${clean(workerId, "source_wallet_backfill_worker_id", 80)}:${randomUUID()}`;
        const result = await db.prepare(`
          UPDATE ravenos_source_wallet_backfill_jobs SET
            state = 'leased', lease_token = ?, lease_expires_at = ?,
            attempt_count = attempt_count + 1, updated_at = ?
          WHERE job_id = ? AND (
            (state IN ('queued', 'retry_wait') AND next_attempt_at <= ?)
            OR (state = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?)
          )
        `).bind(token, seconds + leaseSeconds, seconds, row.job_id, seconds, seconds).run();
        if (Number(result?.meta?.changes || 0) > 0) {
          const job = await readJob(row.job_id);
          if (job) output.push(job);
        }
      }
      return output;
    },
    async recordEvents(sourceId, events, now) {
      return recordEvents(sourceId, events, now);
    },
    async retainedEvmReferences(sourceId,cursor) {
      const row=await db.prepare(`SELECT COUNT(*) AS count FROM ravenos_wallet_latest_events
        WHERE source_wallet_id=? AND decode_version>=102 AND block_number>=? AND block_number<=?`)
        .bind(sourceId,Number(BigInt(cursor.from_block)),Number(BigInt(cursor.head))).first();
      return Number(row?.count||0);
    },
    async recordPage(page) {
      if (page?.schema_version !== SOURCE_WALLET_BACKFILL_PAGE_SCHEMA) fail("source_wallet_backfill_page_invalid");
      await db.prepare(`
        INSERT INTO ravenos_source_wallet_backfill_pages (
          page_id, job_id, source_wallet_id, cursor_before_reference,
          next_cursor_reference, state, signature_count, decoded_count,
          failure_count, history_exhausted, page_hash, provider,
          evidence_json, observed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(page_id) DO NOTHING
      `).bind(
        page.page_id,
        page.job_id,
        page.source_wallet_id,
        page.cursor_before_reference,
        page.next_cursor_reference,
        page.state,
        page.signature_count,
        page.decoded_count,
        page.failure_count,
        page.history_exhausted ? 1 : 0,
        page.page_hash,
        page.provider,
        JSON.stringify(page),
        epoch(page.observed_at),
      ).run();
    },
    async advanceJob({ job, state, provider_cursor: providerCursor, cursor_before: cursorBefore, page_count: pageCount, signatures_seen: signaturesSeen, transactions_decoded: transactionsDecoded, decode_failures: decodeFailures, history_exhausted: historyExhausted, attempt_count: attemptCount = 0, next_attempt_at: nextAttemptAt, now }) {
      const seconds = Math.floor(now / 1_000);
      const keepLease = state === "leased";
      const result = await db.prepare(`
        UPDATE ravenos_source_wallet_backfill_jobs SET
          state = ?, cursor_before = ?, provider_cursor_json = ?, page_count = ?, signatures_seen = ?,
          transactions_decoded = ?, decode_failures = ?, history_exhausted = ?, attempt_count = ?,
          next_attempt_at = ?, lease_token = CASE WHEN ? = 1 THEN lease_token ELSE NULL END,
          lease_expires_at = CASE WHEN ? = 1 THEN lease_expires_at ELSE NULL END,
          last_error_code = NULL, completed_at = CASE WHEN ? = 1 THEN ? ELSE NULL END,
          updated_at = ?
        WHERE job_id = ? AND state = 'leased' AND lease_token = ?
      `).bind(
        state,
        cursorBefore ?? job.cursor_before,
        JSON.stringify(normalizeProviderCursor(providerCursor === undefined ? job.provider_cursor : providerCursor)),
        pageCount ?? job.page_count,
        signaturesSeen ?? job.signatures_seen,
        transactionsDecoded ?? job.transactions_decoded,
        decodeFailures ?? job.decode_failures,
        historyExhausted === true || job.history_exhausted ? 1 : 0,
        integer(attemptCount, "source_wallet_backfill_attempt_count", { maximum: 100 }),
        nextAttemptAt === undefined ? seconds : Math.floor(nextAttemptAt/1000),
        keepLease ? 1 : 0,
        keepLease ? 1 : 0,
        new Set(["complete", "bounded_partial"]).has(state) ? 1 : 0,
        seconds,
        seconds,
        job.job_id,
        job.lease_token,
      ).run();
      if (Number(result?.meta?.changes || 0) < 1) fail("source_wallet_backfill_lease_lost");
      return readJob(job.job_id);
    },
    async retryJob({ job, error_code: errorCode, dead_letter: deadLetter, next_attempt_at: nextAttemptAt, now }) {
      const seconds = Math.floor(now / 1_000);
      const result = await db.prepare(`
        UPDATE ravenos_source_wallet_backfill_jobs SET
          state = ?, next_attempt_at = ?, lease_token = NULL, lease_expires_at = NULL,
          last_error_code = ?, updated_at = ?, completed_at = CASE WHEN ? = 1 THEN ? ELSE NULL END
        WHERE job_id = ? AND state = 'leased' AND lease_token = ?
      `).bind(
        deadLetter ? "dead_letter" : "retry_wait",
        Math.floor(nextAttemptAt / 1_000),
        clean(errorCode, "source_wallet_backfill_error", 100),
        seconds,
        deadLetter ? 1 : 0,
        seconds,
        job.job_id,
        job.lease_token,
      ).run();
      if (Number(result?.meta?.changes || 0) < 1) fail("source_wallet_backfill_lease_lost");
    },
    async deferJob({job, next_attempt_at:nextAttemptAt, error_code:errorCode='helius_history_budget_exhausted', now}) {
      const result=await db.prepare(`UPDATE ravenos_source_wallet_backfill_jobs SET state='retry_wait',
        attempt_count=MAX(0,attempt_count-1),next_attempt_at=?,lease_token=NULL,lease_expires_at=NULL,
        last_error_code=?,updated_at=?
        WHERE job_id=? AND state='leased' AND lease_token=?`)
        .bind(Math.floor(nextAttemptAt/1000),errorCode,Math.floor(now/1000),job.job_id,job.lease_token).run();
      if (!result.meta?.changes) fail('source_wallet_backfill_lease_lost');
    },
    async recordRun(run) {
      if (run?.schema_version !== SOURCE_WALLET_BACKFILL_RUN_SCHEMA) fail("source_wallet_backfill_run_invalid");
      await db.prepare(`
        INSERT OR IGNORE INTO ravenos_source_wallet_backfill_runs (
          run_id, worker_id, started_at, completed_at, run_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        `swbr_${digest([run.worker_id, run.started_at, JSON.stringify(run.totals)])}`,
        run.worker_id,
        epoch(run.started_at),
        epoch(run.completed_at),
        JSON.stringify(run),
        epoch(run.completed_at),
      ).run();
    },
    async health({ now = Date.now() } = {}) {
      const rows = await db.prepare(`
        SELECT
          state,
          demand_class,
          MAX(demand_priority) AS demand_priority,
          MAX(evidence_priority) AS highest_evidence_priority,
          COUNT(*) AS count,
          MIN(updated_at) AS oldest_updated_at,
          MIN(CASE WHEN state IN ('queued', 'retry_wait') THEN next_attempt_at ELSE NULL END) AS oldest_due_at
        FROM ravenos_source_wallet_backfill_jobs
        GROUP BY state, demand_class
        ORDER BY demand_priority DESC, state ASC, demand_class ASC
      `).all();
      return freeze({
        schema_version: "ravenos.source_wallet_backfill_health.v1",
        observed_at: new Date(now).toISOString(),
        queue: (rows?.results || []).map((row) => ({
          state: row.state,
          demand_class: row.demand_class,
          demand_priority: Number(row.demand_priority || 0),
          highest_evidence_priority: Number(row.highest_evidence_priority || 0),
          count: Number(row.count || 0),
          oldest_updated_at: iso(row.oldest_updated_at),
          oldest_due_at: iso(row.oldest_due_at),
        })),
        subscriber_identity_included: false,
        history_claim_requires_exhaustion: true,
        live_copy: false,
      });
    },
  });
}

export async function runSourceWalletBackfillBatch(store, deps = {}, {
  now = Date.now(),
  worker_id: workerId = `wallet_backfill_${randomUUID()}`,
  maximum_jobs: maximumJobs = SourceWalletBackfillLimits.maximum_jobs_per_run,
  maximum_pages_per_job: maximumPages = SourceWalletBackfillLimits.maximum_pages_per_job_run,
  breadth_slots: breadthSlots=0, depth_slots: depthSlots=0,
  solana_page_size: solanaPageSize = SourceWalletBackfillLimits.page_size,
  concurrency = SourceWalletBackfillLimits.maximum_concurrency,
} = {}) {
  if (!store?.leaseJobs || !store?.recordPage || !store?.recordEvents || !store?.advanceJob || !store?.retryJob) fail("source_wallet_backfill_store_unavailable");
  if (typeof deps.fetchSignatures !== "function" || typeof deps.hydrateTransaction !== "function") fail("source_wallet_backfill_provider_unavailable");
  // Storage failures must not be attributed to Helius/Alchemy. Cursor writes
  // happen after idempotent evidence writes; retries resume the old checkpoint.
  const persist = async (method, ...args) => {
    try { return await store[method](...args); }
    catch (error) {
      if (error?.code === 'source_wallet_backfill_lease_lost') throw error;
      fail('source_wallet_backfill_persistence_failed');
    }
  };
  const startedAt = nowIso(now);
  const jobs = await store.leaseJobs({
    worker_id: workerId,
    now: Date.parse(startedAt),
    limit: Math.max(1, Math.min(SourceWalletBackfillLimits.maximum_jobs_per_run, Number(maximumJobs) || 1)),
    lease_seconds: SourceWalletBackfillLimits.lease_seconds,
    breadth_slots: breadthSlots, depth_slots: depthSlots,
  });
  const totals = {
    jobs_leased: 0,
    jobs_completed: 0,
    jobs_bounded: 0,
    jobs_retried: 0,
    jobs_dead_lettered: 0,
    pages_completed: 0,
    pages_partial: 0,
    signatures_seen: 0,
    transactions_decoded: 0,
    decode_failures: 0,
    jobs_budget_deferred: 0,
  };
  const jobResults = [];
  for (const rawJob of Array.isArray(jobs) ? jobs : []) {
    const job = normalizeJob(rawJob);
    if (job.state !== "leased" || !job.lease_token) fail("source_wallet_backfill_job_invalid");
    totals.jobs_leased += 1;
    let current = job;
    try {
      const pageLimit = Math.max(1, Math.min(SourceWalletBackfillLimits.maximum_pages_per_job_run, Number(maximumPages) || 1));
      for (let pageIndex = 0; pageIndex < pageLimit; pageIndex += 1) {
        const remaining = current.history_target - current.signatures_seen;
        if (remaining <= 0 && !(current.source_wallet.chain!=='solana' && current.provider_cursor?.unresolved_references>0)) {
          current = await persist('advanceJob', { job: current, state: "bounded_partial", attempt_count: 0, now: Date.parse(startedAt) });
          jobResults.push({
            source_wallet_id: current.source_wallet_id,
            state: current.state,
            history: sourceWalletBackfillHistoryEvidence(current),
          });
          totals.jobs_bounded += 1;
          break;
        }
        const pageSize = current.source_wallet.chain === 'solana'
          ? integer(solanaPageSize,'source_wallet_backfill_page_size',{minimum:1,maximum:WalletHistoryPolicy.maximum_helius_page})
          : SourceWalletBackfillLimits.page_size;
        const requested = current.source_wallet.chain==='solana'?Math.min(pageSize,remaining):Math.min(pageSize,Math.max(remaining,0)+2);
        if (current.source_wallet.chain !== "solana") {
          if (typeof deps.fetchEvmPage !== "function") fail("evm_wallet_backfill_disabled");
          const page = await deps.fetchEvmPage(current);
          const events = page.events;
          if (!Array.isArray(events) || events.length > requested || !Number.isSafeInteger(page.reference_count) || page.reference_count < events.length || page.reference_count > requested || typeof page.exhausted !== "boolean") fail("evm_wallet_backfill_page_invalid");
          for (const event of events) {
            const id = normalizeSourceWalletChainIdentity({chain: event.source_wallet?.chain, network: "mainnet", address: event.source_wallet?.address});
            if (event.schema_version !== "ravenos.source_wallet_chain_event.v1" || event.source_wallet_id !== current.source_wallet_id || id.source_wallet_id !== current.source_wallet_id || event.copy_signal?.source_signal_ready !== false) fail("evm_wallet_backfill_event_invalid");
          }
          const cursor = normalizeProviderCursor(page.cursor);
          if (!page.exhausted && !page.reference_outcomes?.length && remaining>0 && JSON.stringify(cursor) === JSON.stringify(current.provider_cursor)) fail("evm_wallet_backfill_cursor_stalled");
          const received = nowIso(deps.now || now);
          const hash = digest([current.job_id, JSON.stringify(current.provider_cursor), JSON.stringify(cursor), ...events.map(e => e.evidence_hash),JSON.stringify(page.reference_outcomes?.map(row=>[row.reference.hash,row.error_code])||[]),received]);
          // Persist before advancing. A crash/retry can replay events safely.
          await persist('recordEvents', current.source_wallet_id, events, Math.floor(Date.parse(received)/1000));
          const decodedReferences=page.decoded_count ?? page.reference_count;
          const failures=page.reference_count-decodedReferences;
          const newlySeen=page.new_reference_count ?? page.reference_count;
          if(!Number.isSafeInteger(decodedReferences)||decodedReferences<events.length||decodedReferences>page.reference_count
            || !Number.isSafeInteger(newlySeen)||newlySeen<0||newlySeen>page.reference_count||newlySeen>Math.max(remaining,0))fail('evm_wallet_backfill_page_invalid');
          const retrySummary=store.recordReferenceOutcomes && Array.isArray(page.reference_outcomes)
            ? await persist('recordReferenceOutcomes', current,page.reference_outcomes,`swba_${hash}`,Date.parse(received))
            : {unresolved:0,pending:0,next_attempt_at:null};
          cursor.unresolved_references=retrySummary.unresolved;
          if(retrySummary.unresolved){delete cursor.verified_through_block;delete cursor.verified_through_at;}
          else if(page.exhausted){cursor.verified_through_block=cursor.head;cursor.verified_through_at=cursor.coverage_end_at;}
          await persist('recordPage', {schema_version: SOURCE_WALLET_BACKFILL_PAGE_SCHEMA, page_id: `swbp_${hash}`, job_id: current.job_id, source_wallet_id: current.source_wallet_id, cursor_before_reference: `evm_cursor_${digest([JSON.stringify(current.provider_cursor)])}`, next_cursor_reference: page.exhausted ? null : `evm_cursor_${digest([JSON.stringify(cursor)])}`, state: failures?'partial':'complete', signature_count: page.reference_count, decoded_count: decodedReferences, reused_reference_count: decodedReferences-events.length, failure_count: failures, history_exhausted: page.exhausted, page_hash: hash, provider: current.provider, observed_at: received, request_count: page.request_count,
            reference_results:(page.reference_outcomes||[]).map(row=>({transaction_reference:row.reference.hash,error_code:row.error_code})),
            raw_provider_payload_persisted: false, transaction_material_persisted: false, subscriber_identity_included: false});
          const seen=current.signatures_seen+newlySeen;
          // Recover counts from durable evidence after a crash between a retry
          // resolution and its parent cursor update. Never count a replay twice.
          const decodedTotal=page.reference_outcomes && store.retainedEvmReferences
            ? Math.min(seen,await persist('retainedEvmReferences', current.source_wallet_id,cursor))
            : current.transactions_decoded+decodedReferences;
          const nextState=page.exhausted
            ? retrySummary.pending?'retry_wait':retrySummary.unresolved?'bounded_partial':'complete'
            : seen>=current.history_target?(retrySummary.pending?'retry_wait':'bounded_partial'):'queued';
          current=await persist('advanceJob', {job:current,state:nextState,provider_cursor:cursor,
            page_count:current.page_count+1,signatures_seen:seen,
            transactions_decoded:decodedTotal,
            decode_failures:current.decode_failures+failures,history_exhausted:nextState==='complete',
            ...(nextState==='retry_wait'?{next_attempt_at:retrySummary.next_attempt_at*1000}:{}),now:Date.parse(received)});
          totals[failures?'pages_partial':'pages_completed']++;
          totals.signatures_seen+=newlySeen;totals.transactions_decoded+=decodedReferences;totals.decode_failures+=failures;
          if(nextState==='complete')totals.jobs_completed++;
          if(nextState==='bounded_partial')totals.jobs_bounded++;
          jobResults.push({source_wallet_id: current.source_wallet_id, state: current.state, history: sourceWalletBackfillHistoryEvidence(current)});
          break;
        }
        const providerPage = await deps.fetchSignatures({
          wallet_address: current.source_wallet.address,
          before: current.cursor_before,
          pagination_token: current.provider_cursor?.pagination_token || null,
          limit: requested,
          commitment: "confirmed",
        });
        const rows = normalizeSignaturePage(Array.isArray(providerPage) ? providerPage : providerPage.rows, { before: current.cursor_before, maximum:requested });
        // Full Helius pages already contain the transactions. Retain them for
        // this page only; an isolate cache eviction must not trigger N RPCs.
        const pageTransactions = new Map((Array.isArray(providerPage) ? [] : providerPage.rows)
          .filter(row=>row.transaction?.meta).map(row=>[row.signature,row.transaction]));
        const receivedAt = nowIso(deps.now || now);
        const settled = await mapConcurrent(rows, Math.max(1, Math.min(SourceWalletBackfillLimits.maximum_concurrency, Number(concurrency) || 1)), async (signatureRow) => {
          const decodeStartedAt = nowIso(deps.now || now);
          const hydrated = pageTransactions.get(signatureRow.signature) || await deps.hydrateTransaction({
            wallet_address: current.source_wallet.address,
            signature_record: signatureRow,
            commitment: signatureRow.confirmationStatus === "finalized" ? "finalized" : "confirmed",
          });
          const decodedAt = nowIso(deps.now || now);
          return normalizeHydratedEvent(hydrated, current, signatureRow, {
            received_at: receivedAt,
            decode_started_at: decodeStartedAt,
            decoded_at: decodedAt,
          });
        });
        const events = settled.filter((row) => row.status === "fulfilled").map((row) => row.value);
        const failures = settled.length - events.length;
        const exhausted = Array.isArray(providerPage) ? rows.length < requested : providerPage.history_exhausted === true;
        if (!Array.isArray(providerPage) && !exhausted && (!providerPage.pagination_token || providerPage.pagination_token === current.provider_cursor?.pagination_token)) fail("source_wallet_backfill_cursor_stalled");
        await persist('recordEvents', current.source_wallet_id, events, Math.floor(Date.parse(receivedAt) / 1_000));
        await persist('recordPage', pageEvidence(current, rows, events, failures, {
          before: current.cursor_before,
          observedAt: receivedAt,
          exhausted,
        }));
        totals.signatures_seen += rows.length;
        totals.transactions_decoded += events.length;
        totals.decode_failures += failures;
        if (failures > 0) {
          totals.pages_partial += 1;
          fail("source_wallet_backfill_page_incomplete");
        }
        totals.pages_completed += 1;
        const nextSeen = current.signatures_seen + rows.length;
        const nextState = exhausted ? "complete"
          : nextSeen >= current.history_target ? "bounded_partial"
            : pageIndex + 1 >= pageLimit ? "queued"
              : "leased";
        current = await persist('advanceJob', {
          job: current,
          state: nextState,
          cursor_before: rows.at(-1)?.signature || current.cursor_before,
          provider_cursor: Array.isArray(providerPage) ? null : {pagination_token: providerPage.pagination_token || null},
          page_count: current.page_count + 1,
          signatures_seen: nextSeen,
          transactions_decoded: current.transactions_decoded + events.length,
          decode_failures: current.decode_failures,
          history_exhausted: exhausted,
          attempt_count: 0,
          now: Date.parse(receivedAt),
        });
        if (nextState !== "leased") {
          jobResults.push({
            source_wallet_id: current.source_wallet_id,
            state: current.state,
            history: sourceWalletBackfillHistoryEvidence(current),
          });
        }
        if (nextState === "complete") {
          totals.jobs_completed += 1;
          break;
        }
        if (nextState === "bounded_partial") {
          totals.jobs_bounded += 1;
          break;
        }
        if (nextState === "queued") break;
      }
    } catch (error) {
      if (['helius_history_budget_exhausted','evm_history_budget_exhausted'].includes(error?.code) && store.deferJob && Number.isFinite(error.retry_at)) {
        await store.deferJob({job:current,next_attempt_at:error.retry_at,error_code:error.code,now:Date.parse(startedAt)});
        totals.jobs_budget_deferred++;
        continue;
      }
      const attempt = Math.max(1, current.attempt_count || 1);
      const errorCode = safeErrorCode(error);
      const deadLetter = attempt >= SourceWalletBackfillLimits.maximum_attempts
        || /(?:identity|invalid|order|mismatch)$/.test(errorCode);
      await store.retryJob({
        job: current,
        error_code: errorCode,
        dead_letter: deadLetter,
        next_attempt_at: Date.parse(startedAt) + retryDelay(attempt) * 1_000,
        now: Date.parse(startedAt),
      });
      if (deadLetter) totals.jobs_dead_lettered += 1;
      else totals.jobs_retried += 1;
    }
  }
  const run = freeze({
    schema_version: SOURCE_WALLET_BACKFILL_RUN_SCHEMA,
    worker_id: clean(workerId, "source_wallet_backfill_worker_id", 100),
    started_at: startedAt,
    completed_at: nowIso(deps.now || now),
    totals: freeze(totals),
    jobs: freeze(jobResults.map((row) => freeze(row))),
    limits: {
      page_size: SourceWalletBackfillLimits.page_size,
      solana_page_size: solanaPageSize,
      maximum_solana_requested_history: WalletHistoryPolicy.solana_deep_events,
      maximum_signatures_per_wallet: SourceWalletBackfillLimits.maximum_signatures_per_wallet,
      maximum_jobs_per_run: SourceWalletBackfillLimits.maximum_jobs_per_run,
      maximum_pages_per_job_run: SourceWalletBackfillLimits.maximum_pages_per_job_run,
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
  if (typeof store.recordRun === "function") await store.recordRun(run);
  return run;
}
