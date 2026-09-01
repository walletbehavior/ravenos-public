import { createHash } from "node:crypto";

const CURSOR_SCHEMA = "ravenos.agentic.robinhood_ingestion_cursor.v1";
const HASH_RE = /^0x[a-f0-9]{64}$/;
const OBSERVATION_JSON_LIMIT = 128 * 1024;
const ANCHOR_JSON_LIMIT = 64 * 1024;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function seconds(value) {
  const parsed = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(parsed)) fail("robinhood_store_clock_invalid");
  return Math.floor(parsed > 10_000_000_000 ? parsed / 1_000 : parsed);
}

function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

function parseJson(value, code) {
  try {
    const parsed = JSON.parse(String(value || ""));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail(code);
    return parsed;
  } catch (error) {
    if (error?.code === code) throw error;
    fail(code);
  }
}

function serialized(value, maximum, code) {
  const output = JSON.stringify(value);
  if (output.length > maximum) fail(code);
  return output;
}

function providerId(value) {
  const output = String(value || "").trim();
  if (!/^[a-zA-Z0-9_.:-]{1,80}$/.test(output)) fail("robinhood_store_provider_invalid");
  return output;
}

function requireRuntime(runtime) {
  if (!runtime || ![4663, 46630].includes(Number(runtime.chain_id))) fail("robinhood_store_runtime_invalid");
  if (!["mainnet", "testnet"].includes(runtime.network)) fail("robinhood_store_runtime_invalid");
  return runtime;
}

/**
 * Durable D1 implementation for the bounded Robinhood Chain observer. Cursor
 * state is the only mutable record; observations, anchors, gaps, reorgs, and
 * audit events remain append-only evidence.
 */
export function createD1RobinhoodIngestionStore(db, { runtime, now = () => Date.now() } = {}) {
  if (!db?.prepare) fail("robinhood_store_unavailable");
  requireRuntime(runtime);
  const chainId = Number(runtime.chain_id);
  const network = runtime.network;
  const cursorId = `rhc_${chainId}_${network}`;
  const observedNow = () => seconds(typeof now === "function" ? now() : now);

  const store = {
    async loadCursor(requestedChainId) {
      if (Number(requestedChainId) !== chainId) fail("robinhood_store_chain_mismatch");
      const row = await db.prepare(`
        SELECT cursor_json FROM ravenos_robinhood_ingestion_cursors
        WHERE cursor_id = ? AND chain_id = ? AND network = ? LIMIT 1
      `).bind(cursorId, chainId, network).first();
      if (!row) return null;
      const cursor = parseJson(row.cursor_json, "robinhood_store_cursor_corrupt");
      if (cursor.schema_version !== CURSOR_SCHEMA || Number(cursor.chain_id) !== chainId || cursor.network !== network) {
        fail("robinhood_store_cursor_corrupt");
      }
      return cursor;
    },

    async compareAndSetCursor(next, { expected_revision: expectedRevision } = {}) {
      if (
        next?.schema_version !== CURSOR_SCHEMA
        || Number(next.chain_id) !== chainId
        || next.network !== network
        || !Number.isSafeInteger(Number(expectedRevision))
        || Number(next.revision) !== Number(expectedRevision) + 1
      ) fail("robinhood_store_cursor_invalid");
      const lastBlock = next.last_processed_block === null ? null : Number(next.last_processed_block);
      const nextBlock = lastBlock === null ? 0 : lastBlock + 1;
      const updatedAt = observedNow();
      let result;
      if (Number(expectedRevision) === 0) {
        result = await db.prepare(`
          INSERT INTO ravenos_robinhood_ingestion_cursors (
            cursor_id, chain_id, network, next_block, last_canonical_block,
            last_canonical_hash, state_version, cursor_json, updated_at
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE NOT EXISTS (
            SELECT 1 FROM ravenos_robinhood_ingestion_cursors
            WHERE cursor_id = ? OR (chain_id = ? AND network = ?)
          )
        `).bind(
          cursorId, chainId, network, nextBlock, lastBlock,
          next.last_processed_block_hash, next.revision, JSON.stringify(next), updatedAt,
          cursorId, chainId, network,
        ).run();
      } else {
        result = await db.prepare(`
          UPDATE ravenos_robinhood_ingestion_cursors
          SET next_block = ?, last_canonical_block = ?, last_canonical_hash = ?,
              state_version = ?, cursor_json = ?, updated_at = ?
          WHERE cursor_id = ? AND chain_id = ? AND network = ? AND state_version = ?
        `).bind(
          nextBlock, lastBlock, next.last_processed_block_hash,
          next.revision, JSON.stringify(next), updatedAt,
          cursorId, chainId, network, expectedRevision,
        ).run();
      }
      if (changes(result) !== 1) fail("robinhood_cursor_revision_conflict");
      return structuredClone(next);
    },

    async getBlockAnchor(blockNumber) {
      const number = Number(blockNumber);
      if (!Number.isSafeInteger(number) || number < 0) fail("robinhood_store_block_number_invalid");
      const row = await db.prepare(`
        SELECT anchor_json FROM ravenos_robinhood_block_anchors
        WHERE chain_id = ? AND network = ? AND block_number = ?
        ORDER BY observed_at DESC, rowid DESC LIMIT 1
      `).bind(chainId, network, number).first();
      return row ? parseJson(row.anchor_json, "robinhood_store_anchor_corrupt") : null;
    },

    async appendBlockAnchor(anchor) {
      const number = Number(anchor?.block_number);
      const blockHash = String(anchor?.block_hash || "").toLowerCase();
      const parentHash = String(anchor?.parent_hash || "").toLowerCase();
      if (!Number.isSafeInteger(number) || number < 0 || !HASH_RE.test(blockHash) || !HASH_RE.test(parentHash)) {
        fail("robinhood_store_anchor_invalid");
      }
      const observedProvider = providerId(anchor?.provider_id);
      const anchorJson = serialized(anchor, ANCHOR_JSON_LIMIT, "robinhood_store_anchor_too_large");
      const prior = await db.prepare(`
        SELECT block_hash FROM ravenos_robinhood_block_anchors
        WHERE chain_id = ? AND network = ? AND block_number = ?
        ORDER BY observed_at DESC, rowid DESC LIMIT 1
      `).bind(chainId, network, number).first();
      if (String(prior?.block_hash || "").toLowerCase() === blockHash) return { state: "duplicate" };
      const anchorId = `rhba_${digest([chainId, network, number, blockHash]).slice(0, 40)}`;
      const result = await db.prepare(`
        INSERT INTO ravenos_robinhood_block_anchors (
          anchor_id, chain_id, network, block_number, block_hash, parent_hash,
          block_time, provider_id, anchor_hash, anchor_json, observed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(anchor_id) DO NOTHING
      `).bind(
        anchorId, chainId, network, number, blockHash, parentHash,
        anchor.block_time || null, observedProvider, digest(anchor), anchorJson, observedNow(),
      ).run();
      if (changes(result) !== 1) return { state: "duplicate" };
      return { state: prior ? "replaced" : "inserted" };
    },

    async appendObservation(observation) {
      if (
        !observation?.observation_id
        || Number(observation.chain_id) !== chainId
        || observation.network !== network
        || !observation.event_position_id
      ) fail("robinhood_store_observation_invalid");
      const observationJson = serialized(observation, OBSERVATION_JSON_LIMIT, "robinhood_store_observation_too_large");
      const prior = await db.prepare(`
        SELECT observation_id, block_number, block_hash, observed_at
        FROM ravenos_robinhood_log_observations
        WHERE chain_id = ? AND network = ? AND event_position_id = ? AND observation_id <> ?
        ORDER BY observed_at DESC, observation_id DESC LIMIT 1
      `).bind(chainId, network, observation.event_position_id, observation.observation_id).first();
      const duplicate = await db.prepare(`
        SELECT observation_id FROM ravenos_robinhood_log_observations
        WHERE observation_id = ? LIMIT 1
      `).bind(observation.observation_id).first();
      let replacementAuthorized = false;
      if (prior && String(prior.block_hash || "").toLowerCase() !== String(observation.block_hash || "").toLowerCase()) {
        const invalidation = await db.prepare(`
          SELECT event_id FROM ravenos_robinhood_canonicality_events
          WHERE chain_id = ? AND state = 'invalidated'
            AND from_block <= ? AND to_block >= ? AND observed_at >= ?
          ORDER BY observed_at DESC, rowid DESC LIMIT 1
        `).bind(chainId, Number(prior.block_number), Number(prior.block_number), Number(prior.observed_at)).first();
        replacementAuthorized = Boolean(invalidation);
      }
      if (duplicate) {
        if (prior && !replacementAuthorized) return { state: "conflict", conflicts_with: prior.observation_id };
        return { state: "duplicate" };
      }
      const observedAt = Math.floor(Date.parse(observation.retrieved_at) / 1_000);
      if (!Number.isSafeInteger(observedAt)) fail("robinhood_store_observation_invalid");
      const result = await db.prepare(`
        INSERT INTO ravenos_robinhood_log_observations (
          observation_id, event_position_id, chain_id, network, block_number,
          block_hash, transaction_hash, transaction_index, log_index,
          contract_address, registry_id, registry_category, provider_id,
          observation_hash, observation_json, observed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(observation_id) DO NOTHING
      `).bind(
        observation.observation_id, observation.event_position_id, chainId, network,
        observation.block_number, observation.block_hash, observation.transaction_hash,
        observation.transaction_index, observation.log_index, observation.contract,
        observation.registry_id, observation.category, observation.provider_id,
        digest(observation), observationJson, observedAt,
      ).run();
      if (changes(result) !== 1) return { state: "duplicate" };
      if (!prior) return { state: "inserted" };
      return replacementAuthorized
        ? { state: "replaced", supersedes: prior.observation_id }
        : { state: "conflict", conflicts_with: prior.observation_id };
    },

    async recordGap(gap) {
      return store.appendAuditEvent({ event_type: "ingestion_gap", ...structuredClone(gap) });
    },

    async recordReorg(reorg) {
      const observedAt = Math.floor(Date.parse(reorg?.detected_at || "") / 1_000);
      const observedProvider = providerId(reorg?.observed_tip_provider_id);
      if (!reorg?.reorg_id || !Number.isSafeInteger(observedAt)) fail("robinhood_store_reorg_invalid");
      const result = await db.prepare(`
        INSERT INTO ravenos_robinhood_canonicality_events (
          event_id, chain_id, from_block, to_block, state, reason, provider_id,
          evidence_hash, event_json, observed_at
        ) VALUES (?, ?, ?, ?, 'replacement_observed', ?, ?, ?, ?, ?)
        ON CONFLICT(event_id) DO NOTHING
      `).bind(
        reorg.reorg_id, chainId, reorg.replaced_from_block, reorg.replaced_to_block,
        reorg.kind || "canonical_chain_replacement", observedProvider,
        digest(reorg), JSON.stringify(reorg), observedAt,
      ).run();
      return { state: changes(result) === 1 ? "inserted" : "duplicate" };
    },

    async invalidateCanonicalRange({ from_block: fromBlock, to_block: toBlock, reorg_id: reorgId } = {}) {
      const from = Number(fromBlock);
      const to = Number(toBlock);
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from || !reorgId) {
        fail("robinhood_store_invalidation_invalid");
      }
      const observedAt = observedNow();
      const payload = {
        schema_version: "ravenos.agentic.robinhood_canonicality.v1",
        reorg_id: reorgId,
        from_block: from,
        to_block: to,
        state: "invalidated",
        observed_at: new Date(observedAt * 1_000).toISOString(),
      };
      const eventId = `rhci_${digest([chainId, reorgId, from, to]).slice(0, 40)}`;
      const result = await db.prepare(`
        INSERT INTO ravenos_robinhood_canonicality_events (
          event_id, chain_id, from_block, to_block, state, reason, provider_id,
          evidence_hash, event_json, observed_at
        ) VALUES (?, ?, ?, ?, 'invalidated', 'reorg_replacement', NULL, ?, ?, ?)
        ON CONFLICT(event_id) DO NOTHING
      `).bind(eventId, chainId, from, to, digest(payload), JSON.stringify(payload), observedAt).run();
      return { state: changes(result) === 1 ? "invalidated" : "duplicate" };
    },

    async appendAuditEvent(event) {
      if (!event || typeof event !== "object" || Array.isArray(event)) fail("robinhood_store_audit_invalid");
      const observedAtText = event.observed_at || event.detected_at || new Date(observedNow() * 1_000).toISOString();
      const observedAt = Math.floor(Date.parse(observedAtText) / 1_000);
      if (!Number.isSafeInteger(observedAt)) fail("robinhood_store_audit_invalid");
      const eventHash = digest(event);
      const eventId = `rhia_${digest([chainId, network, eventHash]).slice(0, 40)}`;
      const result = await db.prepare(`
        INSERT INTO ravenos_robinhood_ingestion_audit_events (
          event_id, chain_id, network, event_type, event_hash, event_json, observed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(event_id) DO NOTHING
      `).bind(
        eventId, chainId, network, String(event.event_type || event.state || event.kind || "ingestion_event").slice(0, 80),
        eventHash, JSON.stringify(event), observedAt,
      ).run();
      return { state: changes(result) === 1 ? "inserted" : "duplicate" };
    },
  };
  return Object.freeze(store);
}
