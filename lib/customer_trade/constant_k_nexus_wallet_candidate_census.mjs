import { createHash } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  normalizeConstantKNexusWalletCandidateObservation,
} from "./constant_k_nexus_wallet_discovery.mjs";

export const CONSTANT_K_NEXUS_CANDIDATE_CENSUS_SCHEMA = "ravenos.constant_k_nexus_candidate_census.v1";

export const ConstantKNexusCandidateCensusLimits = Object.freeze({
  minimum_observations: 5,
  minimum_distinct_mints: 2,
  minimum_observation_span_seconds: 60,
  recurrence_window_seconds: 24 * 60 * 60,
  unpromoted_retention_seconds: 36 * 60 * 60,
  promoted_retention_seconds: 90 * 24 * 60 * 60,
  seen_observation_retention_seconds: 48 * 60 * 60,
  delivered_evidence_retention_seconds: 7 * 24 * 60 * 60,
  refresh_interval_seconds: 24 * 60 * 60,
  maximum_retained_evidence_per_candidate: 8,
  maximum_promotion_rounds_per_cycle: 8,
  maximum_promotion_rounds_per_hour: 100,
  maximum_promotion_rounds_per_day: 1_000,
  maximum_outbound_observations: 50,
  prune_interval_seconds: 60 * 60,
});

const CENSUS_STATES = new Set(["held", "queued", "delivered"]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function integer(value, field, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) fail(`${field}_invalid`);
  return parsed;
}

function seconds(value) {
  const milliseconds = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) fail("constant_k_candidate_census_clock_invalid");
  return Math.floor(milliseconds / 1_000);
}

function epoch(value) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) fail("constant_k_candidate_census_observed_at_invalid");
  return Math.floor(parsed / 1_000);
}

function digest(parts, length = 40) {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, length);
}

function exactDatabasePath(value) {
  const input = String(value || "").trim();
  if (!input || !isAbsolute(input) || input.includes("\u0000")) fail("constant_k_candidate_census_path_invalid");
  const path = resolve(input);
  const parent = dirname(path);
  const boundary = relative(parent, path);
  if (!boundary || boundary.startsWith("..") || isAbsolute(boundary)) fail("constant_k_candidate_census_path_invalid");
  return path;
}

function normalizeLimits(input = {}) {
  const defaults = ConstantKNexusCandidateCensusLimits;
  const limits = {
    minimum_observations: integer(input.minimum_observations ?? defaults.minimum_observations, "constant_k_candidate_census_minimum_observations", 2, 20),
    minimum_distinct_mints: integer(input.minimum_distinct_mints ?? defaults.minimum_distinct_mints, "constant_k_candidate_census_minimum_mints", 2, 20),
    minimum_observation_span_seconds: integer(input.minimum_observation_span_seconds ?? defaults.minimum_observation_span_seconds, "constant_k_candidate_census_minimum_span", 0, 24 * 60 * 60),
    recurrence_window_seconds: integer(input.recurrence_window_seconds ?? defaults.recurrence_window_seconds, "constant_k_candidate_census_recurrence_window", 60, 30 * 24 * 60 * 60),
    unpromoted_retention_seconds: integer(input.unpromoted_retention_seconds ?? defaults.unpromoted_retention_seconds, "constant_k_candidate_census_unpromoted_retention", 60 * 60, 30 * 24 * 60 * 60),
    promoted_retention_seconds: integer(input.promoted_retention_seconds ?? defaults.promoted_retention_seconds, "constant_k_candidate_census_promoted_retention", 24 * 60 * 60, 365 * 24 * 60 * 60),
    seen_observation_retention_seconds: integer(input.seen_observation_retention_seconds ?? defaults.seen_observation_retention_seconds, "constant_k_candidate_census_seen_retention", 60 * 60, 30 * 24 * 60 * 60),
    delivered_evidence_retention_seconds: integer(input.delivered_evidence_retention_seconds ?? defaults.delivered_evidence_retention_seconds, "constant_k_candidate_census_delivered_retention", 60 * 60, 30 * 24 * 60 * 60),
    refresh_interval_seconds: integer(input.refresh_interval_seconds ?? defaults.refresh_interval_seconds, "constant_k_candidate_census_refresh_interval", 60 * 60, 30 * 24 * 60 * 60),
    maximum_retained_evidence_per_candidate: integer(input.maximum_retained_evidence_per_candidate ?? defaults.maximum_retained_evidence_per_candidate, "constant_k_candidate_census_retained_evidence", 5, 32),
    maximum_promotion_rounds_per_cycle: integer(input.maximum_promotion_rounds_per_cycle ?? defaults.maximum_promotion_rounds_per_cycle, "constant_k_candidate_census_cycle_budget", 1, 50),
    maximum_promotion_rounds_per_hour: integer(input.maximum_promotion_rounds_per_hour ?? defaults.maximum_promotion_rounds_per_hour, "constant_k_candidate_census_hour_budget", 1, 10_000),
    maximum_promotion_rounds_per_day: integer(input.maximum_promotion_rounds_per_day ?? defaults.maximum_promotion_rounds_per_day, "constant_k_candidate_census_day_budget", 1, 100_000),
    maximum_outbound_observations: integer(input.maximum_outbound_observations ?? defaults.maximum_outbound_observations, "constant_k_candidate_census_outbound_budget", 5, 50),
    prune_interval_seconds: integer(input.prune_interval_seconds ?? defaults.prune_interval_seconds, "constant_k_candidate_census_prune_interval", 60, 24 * 60 * 60),
  };
  if (
    limits.minimum_observations > limits.maximum_retained_evidence_per_candidate
    || limits.unpromoted_retention_seconds < limits.recurrence_window_seconds
    || limits.maximum_promotion_rounds_per_hour > limits.maximum_promotion_rounds_per_day
  ) fail("constant_k_candidate_census_limits_invalid");
  return freeze(limits);
}

function transaction(db, operation) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve the original failure */ }
    throw error;
  }
}

function createSchema(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = FULL;
    PRAGMA temp_store = MEMORY;

    CREATE TABLE IF NOT EXISTS census_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS census_candidates (
      candidate_id TEXT PRIMARY KEY,
      source_wallet_id TEXT NOT NULL,
      address TEXT NOT NULL,
      window_started_at INTEGER NOT NULL,
      first_observed_at INTEGER NOT NULL,
      last_observed_at INTEGER NOT NULL,
      observation_count INTEGER NOT NULL,
      exact_shape_count INTEGER NOT NULL,
      reviewed_buy_count INTEGER NOT NULL,
      distinct_mint_count INTEGER NOT NULL,
      promoted_at INTEGER,
      last_refresh_at INTEGER,
      last_delivered_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK (observation_count >= 0),
      CHECK (exact_shape_count >= 0 AND reviewed_buy_count >= 0),
      CHECK (distinct_mint_count >= 0)
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS census_candidates_eligible_idx
      ON census_candidates(promoted_at, observation_count DESC, distinct_mint_count DESC, last_observed_at DESC, candidate_id);
    CREATE INDEX IF NOT EXISTS census_candidates_retention_idx
      ON census_candidates(last_observed_at, promoted_at, candidate_id);

    CREATE TABLE IF NOT EXISTS census_candidate_mints (
      candidate_id TEXT NOT NULL REFERENCES census_candidates(candidate_id) ON DELETE CASCADE,
      mint TEXT NOT NULL,
      first_observed_at INTEGER NOT NULL,
      last_observed_at INTEGER NOT NULL,
      observation_count INTEGER NOT NULL,
      PRIMARY KEY (candidate_id, mint)
    ) WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS census_seen_observations (
      observation_id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      observed_at INTEGER NOT NULL,
      staged_at INTEGER NOT NULL
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS census_seen_retention_idx
      ON census_seen_observations(staged_at, observation_id);

    CREATE TABLE IF NOT EXISTS census_evidence (
      observation_id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES census_candidates(candidate_id) ON DELETE CASCADE,
      observed_at INTEGER NOT NULL,
      evidence_kind TEXT NOT NULL,
      observation_json TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('held', 'queued', 'delivered')),
      round_id TEXT,
      delivered_at INTEGER,
      created_at INTEGER NOT NULL
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS census_evidence_outbox_idx
      ON census_evidence(state, created_at, candidate_id, observed_at, observation_id);
    CREATE INDEX IF NOT EXISTS census_evidence_candidate_idx
      ON census_evidence(candidate_id, state, observed_at DESC, observation_id);

    CREATE TABLE IF NOT EXISTS census_promotion_rounds (
      round_id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES census_candidates(candidate_id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('initial', 'refresh')),
      observation_count INTEGER NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('queued', 'delivered')),
      created_at INTEGER NOT NULL,
      delivered_at INTEGER
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS census_round_budget_idx
      ON census_promotion_rounds(created_at, state, round_id);
  `);
  const version = db.prepare("SELECT value FROM census_meta WHERE key = 'schema_version'").get();
  if (version && version.value !== CONSTANT_K_NEXUS_CANDIDATE_CENSUS_SCHEMA) fail("constant_k_candidate_census_schema_mismatch");
  db.prepare("INSERT OR IGNORE INTO census_meta (key, value) VALUES ('schema_version', ?)")
    .run(CONSTANT_K_NEXUS_CANDIDATE_CENSUS_SCHEMA);
}

function parseObservation(value) {
  try {
    return normalizeConstantKNexusWalletCandidateObservation(JSON.parse(String(value || "")));
  } catch {
    fail("constant_k_candidate_census_evidence_corrupt");
  }
}

function candidateEvidenceRows(db, candidateId, state = "held") {
  if (!CENSUS_STATES.has(state)) fail("constant_k_candidate_census_state_invalid");
  return db.prepare(`
    SELECT observation_id, observed_at, evidence_kind, observation_json
    FROM census_evidence WHERE candidate_id = ? AND state = ?
    ORDER BY observed_at ASC, observation_id ASC
  `).all(candidateId, state);
}

function selectDiverseEvidence(rows, limit) {
  const candidates = rows.map((row) => ({ ...row, observation: parseObservation(row.observation_json) }));
  const selected = [];
  const used = new Set();
  const coveredMints = new Set();
  while (selected.length < limit && selected.length < candidates.length) {
    let best = null;
    for (const row of candidates) {
      if (used.has(row.observation_id)) continue;
      const novelMints = row.observation.economic_evidence.mints.filter((mint) => !coveredMints.has(mint)).length;
      const exactBonus = row.evidence_kind === "exact_opposing_token_deltas" ? 1 : 0;
      const score = novelMints * 10 + exactBonus;
      if (!best || score > best.score || (score === best.score && row.observed_at < best.row.observed_at)) {
        best = { row, score };
      }
    }
    if (!best) break;
    used.add(best.row.observation_id);
    selected.push(best.row);
    for (const mint of best.row.observation.economic_evidence.mints) coveredMints.add(mint);
  }
  return selected;
}

function queuedPayload(db, maximum) {
  const rows = db.prepare(`
    SELECT observation_json FROM census_evidence
    WHERE state = 'queued'
    ORDER BY created_at ASC, round_id ASC, observed_at ASC, observation_id ASC
    LIMIT ?
  `).all(maximum);
  return rows.map((row) => parseObservation(row.observation_json));
}

function budgetState(db, now, limits) {
  const hourStart = now - 60 * 60;
  const dayStart = now - 24 * 60 * 60;
  const hour = Number(db.prepare("SELECT COUNT(*) AS count FROM census_promotion_rounds WHERE created_at > ?").get(hourStart)?.count || 0);
  const day = Number(db.prepare("SELECT COUNT(*) AS count FROM census_promotion_rounds WHERE created_at > ?").get(dayStart)?.count || 0);
  return {
    rounds_last_hour: hour,
    rounds_last_day: day,
    remaining_this_hour: Math.max(0, limits.maximum_promotion_rounds_per_hour - hour),
    remaining_this_day: Math.max(0, limits.maximum_promotion_rounds_per_day - day),
  };
}

function queueRound(db, candidate, kind, evidenceRows, now) {
  const roundId = `ckcr_${digest([
    candidate.candidate_id,
    kind,
    String(now),
    ...evidenceRows.map((row) => row.observation_id),
  ])}`;
  db.prepare(`
    INSERT INTO census_promotion_rounds (
      round_id, candidate_id, kind, observation_count, state, created_at, delivered_at
    ) VALUES (?, ?, ?, ?, 'queued', ?, NULL)
  `).run(roundId, candidate.candidate_id, kind, evidenceRows.length, now);
  const queue = db.prepare(`
    UPDATE census_evidence SET state = 'queued', round_id = ?
    WHERE observation_id = ? AND candidate_id = ? AND state = 'held'
  `);
  for (const row of evidenceRows) {
    const result = queue.run(roundId, row.observation_id, candidate.candidate_id);
    if (Number(result.changes || 0) !== 1) fail("constant_k_candidate_census_outbox_conflict");
  }
  if (kind === "initial") {
    db.prepare(`
      UPDATE census_candidates SET promoted_at = ?, last_refresh_at = ?, updated_at = ?
      WHERE candidate_id = ? AND promoted_at IS NULL
    `).run(now, now, now, candidate.candidate_id);
  } else {
    db.prepare("UPDATE census_candidates SET last_refresh_at = ?, updated_at = ? WHERE candidate_id = ?")
      .run(now, now, candidate.candidate_id);
  }
  return roundId;
}

function pruneIfDue(db, now, limits) {
  const stored = db.prepare("SELECT value FROM census_meta WHERE key = 'last_pruned_at'").get();
  const lastPrunedAt = Number(stored?.value || 0);
  if (lastPrunedAt > 0 && now - lastPrunedAt < limits.prune_interval_seconds) return false;
  transaction(db, () => {
    db.prepare("DELETE FROM census_seen_observations WHERE staged_at <= ?")
      .run(now - limits.seen_observation_retention_seconds);
    db.prepare("DELETE FROM census_evidence WHERE state = 'delivered' AND delivered_at <= ?")
      .run(now - limits.delivered_evidence_retention_seconds);
    db.prepare("DELETE FROM census_promotion_rounds WHERE state = 'delivered' AND delivered_at <= ?")
      .run(now - limits.delivered_evidence_retention_seconds);
    db.prepare("DELETE FROM census_candidates WHERE promoted_at IS NULL AND last_observed_at <= ?")
      .run(now - limits.unpromoted_retention_seconds);
    db.prepare("DELETE FROM census_candidates WHERE promoted_at IS NOT NULL AND last_observed_at <= ?")
      .run(now - limits.promoted_retention_seconds);
    db.prepare(`
      INSERT INTO census_meta (key, value) VALUES ('last_pruned_at', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(now));
  });
  return true;
}

export function createConstantKNexusCandidateCensus({ database_path: databasePath, limits: inputLimits = {} } = {}) {
  const path = exactDatabasePath(databasePath);
  const limits = normalizeLimits(inputLimits);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  chmodSync(path, 0o600);
  createSchema(db);

  return {
    schema_version: CONSTANT_K_NEXUS_CANDIDATE_CENSUS_SCHEMA,
    limits,
    stageObservations(inputs = [], { now = Date.now() } = {}) {
      const stagedAt = seconds(now);
      const observations = (Array.isArray(inputs) ? inputs : []).map(normalizeConstantKNexusWalletCandidateObservation);
      const totals = { received: observations.length, unique: 0, duplicates: 0, evidence_retained: 0 };
      transaction(db, () => {
        for (const observation of observations) {
          const observedAt = epoch(observation.provider_observed_at);
          const seen = db.prepare(`
            INSERT OR IGNORE INTO census_seen_observations (
              observation_id, candidate_id, observed_at, staged_at
            ) VALUES (?, ?, ?, ?)
          `).run(observation.observation_id, observation.candidate_id, observedAt, stagedAt);
          if (Number(seen.changes || 0) < 1) {
            totals.duplicates += 1;
            continue;
          }
          totals.unique += 1;
          let candidate = db.prepare("SELECT * FROM census_candidates WHERE candidate_id = ?").get(observation.candidate_id);
          const resetWindow = candidate && observedAt - Number(candidate.last_observed_at) > limits.recurrence_window_seconds;
          if (resetWindow) {
            db.prepare("DELETE FROM census_candidate_mints WHERE candidate_id = ?").run(observation.candidate_id);
            db.prepare("DELETE FROM census_evidence WHERE candidate_id = ? AND state = 'held'").run(observation.candidate_id);
            db.prepare(`
              UPDATE census_candidates SET window_started_at = ?, first_observed_at = ?, last_observed_at = ?,
                observation_count = 0, exact_shape_count = 0, reviewed_buy_count = 0,
                distinct_mint_count = 0, updated_at = ? WHERE candidate_id = ?
            `).run(observedAt, observedAt, observedAt, stagedAt, observation.candidate_id);
            candidate = db.prepare("SELECT * FROM census_candidates WHERE candidate_id = ?").get(observation.candidate_id);
          }
          if (!candidate) {
            db.prepare(`
              INSERT INTO census_candidates (
                candidate_id, source_wallet_id, address, window_started_at, first_observed_at,
                last_observed_at, observation_count, exact_shape_count, reviewed_buy_count,
                distinct_mint_count, promoted_at, last_refresh_at, last_delivered_at,
                created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, NULL, NULL, NULL, ?, ?)
            `).run(
              observation.candidate_id,
              observation.source_wallet_id,
              observation.source_wallet.address,
              observedAt,
              observedAt,
              observedAt,
              stagedAt,
              stagedAt,
            );
          } else if (
            candidate.source_wallet_id !== observation.source_wallet_id
            || candidate.address !== observation.source_wallet.address
          ) fail("constant_k_candidate_census_identity_mismatch");

          const mintStatement = db.prepare(`
            INSERT INTO census_candidate_mints (
              candidate_id, mint, first_observed_at, last_observed_at, observation_count
            ) VALUES (?, ?, ?, ?, 1)
            ON CONFLICT(candidate_id, mint) DO UPDATE SET
              first_observed_at = MIN(first_observed_at, excluded.first_observed_at),
              last_observed_at = MAX(last_observed_at, excluded.last_observed_at),
              observation_count = observation_count + 1
          `);
          for (const mint of observation.economic_evidence.mints) {
            mintStatement.run(observation.candidate_id, mint, observedAt, observedAt);
          }
          const mintCount = Number(db.prepare("SELECT COUNT(*) AS count FROM census_candidate_mints WHERE candidate_id = ?")
            .get(observation.candidate_id)?.count || 0);
          const exactIncrement = observation.economic_evidence.evidence_kind === "exact_opposing_token_deltas" ? 1 : 0;
          db.prepare(`
            UPDATE census_candidates SET
              first_observed_at = MIN(first_observed_at, ?),
              last_observed_at = MAX(last_observed_at, ?),
              observation_count = observation_count + 1,
              exact_shape_count = exact_shape_count + ?,
              reviewed_buy_count = reviewed_buy_count + ?,
              distinct_mint_count = ?, updated_at = ?
            WHERE candidate_id = ?
          `).run(
            observedAt,
            observedAt,
            exactIncrement,
            1 - exactIncrement,
            mintCount,
            stagedAt,
            observation.candidate_id,
          );
          const heldCount = Number(db.prepare("SELECT COUNT(*) AS count FROM census_evidence WHERE candidate_id = ? AND state = 'held'")
            .get(observation.candidate_id)?.count || 0);
          if (heldCount < limits.maximum_retained_evidence_per_candidate) {
            db.prepare(`
              INSERT INTO census_evidence (
                observation_id, candidate_id, observed_at, evidence_kind, observation_json,
                state, round_id, delivered_at, created_at
              ) VALUES (?, ?, ?, ?, ?, 'held', NULL, NULL, ?)
            `).run(
              observation.observation_id,
              observation.candidate_id,
              observedAt,
              observation.economic_evidence.evidence_kind,
              JSON.stringify(observation),
              stagedAt,
            );
            totals.evidence_retained += 1;
          }
        }
      });
      pruneIfDue(db, stagedAt, limits);
      return freeze(totals);
    },
    prepareOutbound({ now = Date.now(), maximum_observations: maximumObservations = limits.maximum_outbound_observations } = {}) {
      const preparedAt = seconds(now);
      const maximum = integer(maximumObservations, "constant_k_candidate_census_outbound_budget", 1, limits.maximum_outbound_observations);
      let outbound = queuedPayload(db, maximum);
      let initialRounds = 0;
      let refreshRounds = 0;
      if (!outbound.length) {
        transaction(db, () => {
          const budget = budgetState(db, preparedAt, limits);
          let availableRounds = Math.min(
            limits.maximum_promotion_rounds_per_cycle,
            budget.remaining_this_hour,
            budget.remaining_this_day,
            Math.floor(maximum / limits.minimum_observations),
          );
          if (availableRounds <= 0) return;
          const eligible = db.prepare(`
            SELECT * FROM census_candidates
            WHERE promoted_at IS NULL
              AND observation_count >= ?
              AND distinct_mint_count >= ?
              AND last_observed_at - first_observed_at >= ?
              AND EXISTS (
                SELECT 1 FROM census_evidence e
                WHERE e.candidate_id = census_candidates.candidate_id AND e.state = 'held'
              )
            ORDER BY distinct_mint_count DESC, exact_shape_count DESC,
              observation_count DESC, last_observed_at DESC, candidate_id ASC
            LIMIT ?
          `).all(
            limits.minimum_observations,
            limits.minimum_distinct_mints,
            limits.minimum_observation_span_seconds,
            availableRounds,
          );
          for (const candidate of eligible) {
            const evidence = selectDiverseEvidence(
              candidateEvidenceRows(db, candidate.candidate_id),
              limits.minimum_observations,
            );
            if (evidence.length < limits.minimum_observations) continue;
            queueRound(db, candidate, "initial", evidence, preparedAt);
            initialRounds += 1;
            availableRounds -= 1;
          }
          if (availableRounds <= 0) return;
          const refreshes = db.prepare(`
            SELECT * FROM census_candidates
            WHERE promoted_at IS NOT NULL AND last_refresh_at <= ?
              AND EXISTS (
                SELECT 1 FROM census_evidence e
                WHERE e.candidate_id = census_candidates.candidate_id AND e.state = 'held'
              )
            ORDER BY last_refresh_at ASC, distinct_mint_count DESC,
              observation_count DESC, last_observed_at DESC, candidate_id ASC
            LIMIT ?
          `).all(preparedAt - limits.refresh_interval_seconds, availableRounds);
          for (const candidate of refreshes) {
            const evidence = candidateEvidenceRows(db, candidate.candidate_id).slice(-1);
            if (!evidence.length) continue;
            queueRound(db, candidate, "refresh", evidence, preparedAt);
            db.prepare("DELETE FROM census_evidence WHERE candidate_id = ? AND state = 'held'")
              .run(candidate.candidate_id);
            refreshRounds += 1;
          }
        });
        outbound = queuedPayload(db, maximum);
      }
      const budget = budgetState(db, preparedAt, limits);
      return freeze({
        observations: outbound,
        initial_rounds_created: initialRounds,
        refresh_rounds_created: refreshRounds,
        queued_observation_count: outbound.length,
        budget,
      });
    },
    markDelivered(observationIds = [], { now = Date.now() } = {}) {
      const deliveredAt = seconds(now);
      const uniqueIds = [...new Set((Array.isArray(observationIds) ? observationIds : []).map(String))];
      let delivered = 0;
      transaction(db, () => {
        const update = db.prepare(`
          UPDATE census_evidence SET state = 'delivered', delivered_at = ?
          WHERE observation_id = ? AND state = 'queued'
        `);
        for (const observationId of uniqueIds) delivered += Number(update.run(deliveredAt, observationId).changes || 0);
        db.prepare(`
          UPDATE census_promotion_rounds SET state = 'delivered', delivered_at = ?
          WHERE state = 'queued' AND NOT EXISTS (
            SELECT 1 FROM census_evidence e
            WHERE e.round_id = census_promotion_rounds.round_id AND e.state = 'queued'
          )
        `).run(deliveredAt);
        db.prepare(`
          UPDATE census_candidates SET last_delivered_at = ?, updated_at = MAX(updated_at, ?)
          WHERE candidate_id IN (
            SELECT DISTINCT candidate_id FROM census_evidence
            WHERE delivered_at = ? AND state = 'delivered'
          )
        `).run(deliveredAt, deliveredAt, deliveredAt);
      });
      return delivered;
    },
    health({ now = Date.now() } = {}) {
      const observedAt = seconds(now);
      const candidates = db.prepare(`
        SELECT COUNT(*) AS total,
          SUM(CASE WHEN promoted_at IS NULL THEN 1 ELSE 0 END) AS unpromoted,
          SUM(CASE WHEN promoted_at IS NOT NULL THEN 1 ELSE 0 END) AS promoted,
          SUM(CASE WHEN promoted_at IS NULL AND observation_count >= ?
            AND distinct_mint_count >= ? AND last_observed_at - first_observed_at >= ? THEN 1 ELSE 0 END) AS eligible
        FROM census_candidates
      `).get(
        limits.minimum_observations,
        limits.minimum_distinct_mints,
        limits.minimum_observation_span_seconds,
      );
      const evidence = db.prepare(`
        SELECT COUNT(*) AS total,
          SUM(CASE WHEN state = 'held' THEN 1 ELSE 0 END) AS held,
          SUM(CASE WHEN state = 'queued' THEN 1 ELSE 0 END) AS queued,
          SUM(CASE WHEN state = 'delivered' THEN 1 ELSE 0 END) AS delivered
        FROM census_evidence
      `).get();
      return freeze({
        schema_version: CONSTANT_K_NEXUS_CANDIDATE_CENSUS_SCHEMA,
        observed_at: new Date(observedAt * 1_000).toISOString(),
        candidate_count: Number(candidates?.total || 0),
        unpromoted_candidate_count: Number(candidates?.unpromoted || 0),
        promoted_candidate_count: Number(candidates?.promoted || 0),
        eligible_candidate_backlog: Number(candidates?.eligible || 0),
        evidence: {
          retained_count: Number(evidence?.total || 0),
          held_count: Number(evidence?.held || 0),
          queued_count: Number(evidence?.queued || 0),
          delivered_count: Number(evidence?.delivered || 0),
        },
        budget: budgetState(db, observedAt, limits),
        admission: {
          minimum_observations: limits.minimum_observations,
          minimum_distinct_mints: limits.minimum_distinct_mints,
          minimum_observation_span_seconds: limits.minimum_observation_span_seconds,
          outcome_data_used: false,
          subscriber_data_used: false,
        },
        addresses_included: false,
        signatures_included: false,
        raw_provider_payload_included: false,
        execution_authority: false,
      });
    },
    close() { db.close(); },
  };
}
