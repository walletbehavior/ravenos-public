import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createD1RobinhoodIngestionStore } from "../lib/agentic_trading/robinhood/d1_store.mjs";

function result(changes) {
  return { meta: { changes } };
}

function createFakeD1() {
  const state = {
    cursor: null,
    anchors: [],
    observations: [],
    canonicality: new Map(),
    audit: new Map(),
  };

  return {
    state,
    prepare(sql) {
      const query = sql.replace(/\s+/g, " ").trim();
      return {
        bind(...values) {
          return {
            async first() {
              if (query.includes("FROM ravenos_robinhood_ingestion_cursors")) {
                const [cursorId, chainId, network] = values;
                return state.cursor?.cursor_id === cursorId
                  && state.cursor.chain_id === chainId
                  && state.cursor.network === network
                  ? { cursor_json: state.cursor.cursor_json }
                  : null;
              }
              if (query.includes("FROM ravenos_robinhood_block_anchors")) {
                const [chainId, network, blockNumber] = values;
                return state.anchors
                  .filter((row) => row.chain_id === chainId && row.network === network && row.block_number === blockNumber)
                  .sort((left, right) => right.observed_at - left.observed_at || right.rowid - left.rowid)[0]
                  || null;
              }
              if (query.includes("FROM ravenos_robinhood_canonicality_events")) {
                const [chainId, blockFrom, blockTo, minimumObservedAt] = values;
                return [...state.canonicality.values()]
                  .filter((row) => row.chain_id === chainId
                    && row.state === "invalidated"
                    && row.from_block <= blockFrom
                    && row.to_block >= blockTo
                    && row.observed_at >= minimumObservedAt)
                  .sort((left, right) => right.observed_at - left.observed_at)[0]
                  || null;
              }
              if (query.includes("observation_id <> ?")) {
                const [chainId, network, eventPositionId, observationId] = values;
                return state.observations
                  .filter((row) => row.chain_id === chainId
                    && row.network === network
                    && row.event_position_id === eventPositionId
                    && row.observation_id !== observationId)
                  .sort((left, right) => right.observed_at - left.observed_at || right.observation_id.localeCompare(left.observation_id))[0]
                  || null;
              }
              if (query.includes("WHERE observation_id = ?")) {
                return state.observations.find((row) => row.observation_id === values[0]) || null;
              }
              throw new Error(`unexpected_first:${query}`);
            },
            async run() {
              if (query.startsWith("INSERT INTO ravenos_robinhood_ingestion_cursors")) {
                if (state.cursor) return result(0);
                const [cursorId, chainId, network, nextBlock, lastBlock, lastHash, revision, cursorJson, updatedAt] = values;
                state.cursor = {
                  cursor_id: cursorId,
                  chain_id: chainId,
                  network,
                  next_block: nextBlock,
                  last_canonical_block: lastBlock,
                  last_canonical_hash: lastHash,
                  state_version: revision,
                  cursor_json: cursorJson,
                  updated_at: updatedAt,
                };
                return result(1);
              }
              if (query.startsWith("UPDATE ravenos_robinhood_ingestion_cursors")) {
                const [nextBlock, lastBlock, lastHash, revision, cursorJson, updatedAt, cursorId, chainId, network, expectedRevision] = values;
                if (
                  !state.cursor
                  || state.cursor.cursor_id !== cursorId
                  || state.cursor.chain_id !== chainId
                  || state.cursor.network !== network
                  || state.cursor.state_version !== expectedRevision
                ) return result(0);
                Object.assign(state.cursor, {
                  next_block: nextBlock,
                  last_canonical_block: lastBlock,
                  last_canonical_hash: lastHash,
                  state_version: revision,
                  cursor_json: cursorJson,
                  updated_at: updatedAt,
                });
                return result(1);
              }
              if (query.startsWith("INSERT INTO ravenos_robinhood_block_anchors")) {
                const [anchorId, chainId, network, blockNumber, blockHash, parentHash, blockTime, providerId, anchorHash, anchorJson, observedAt] = values;
                if (state.anchors.some((row) => row.anchor_id === anchorId)) return result(0);
                state.anchors.push({
                  anchor_id: anchorId,
                  chain_id: chainId,
                  network,
                  block_number: blockNumber,
                  block_hash: blockHash,
                  parent_hash: parentHash,
                  block_time: blockTime,
                  provider_id: providerId,
                  anchor_hash: anchorHash,
                  anchor_json: anchorJson,
                  observed_at: observedAt,
                  rowid: state.anchors.length + 1,
                });
                return result(1);
              }
              if (query.startsWith("INSERT INTO ravenos_robinhood_log_observations")) {
                const [observationId, eventPositionId, chainId, network, blockNumber, blockHash] = values;
                const observationJson = values[14];
                const observedAt = values[15];
                if (state.observations.some((row) => row.observation_id === observationId)) return result(0);
                state.observations.push({
                  observation_id: observationId,
                  event_position_id: eventPositionId,
                  chain_id: chainId,
                  network,
                  block_number: blockNumber,
                  block_hash: blockHash,
                  observation_json: observationJson,
                  observed_at: observedAt,
                });
                return result(1);
              }
              if (query.startsWith("INSERT INTO ravenos_robinhood_canonicality_events")) {
                const eventId = values[0];
                if (state.canonicality.has(eventId)) return result(0);
                const invalidated = query.includes("'invalidated'");
                state.canonicality.set(eventId, {
                  event_id: eventId,
                  chain_id: values[1],
                  from_block: values[2],
                  to_block: values[3],
                  state: invalidated ? "invalidated" : "replacement_observed",
                  observed_at: values.at(-1),
                });
                return result(1);
              }
              if (query.startsWith("INSERT INTO ravenos_robinhood_ingestion_audit_events")) {
                const eventId = values[0];
                if (state.audit.has(eventId)) return result(0);
                state.audit.set(eventId, values);
                return result(1);
              }
              throw new Error(`unexpected_run:${query}`);
            },
          };
        },
      };
    },
  };
}

const runtime = Object.freeze({ chain_id: 4663, network: "mainnet" });
const hash = (character) => `0x${character.repeat(64)}`;

function cursor(revision, block, blockHash) {
  return {
    schema_version: "ravenos.agentic.robinhood_ingestion_cursor.v1",
    chain_id: 4663,
    network: "mainnet",
    revision,
    state: "current",
    last_processed_block: block,
    last_processed_block_hash: blockHash,
    observed_head_block: block,
    backfill_required: false,
    updated_at: "2026-09-01T18:00:00.000Z",
  };
}

test("D1 ingestion store durably CASes cursors and keeps anchors append-only", async () => {
  const db = createFakeD1();
  const store = createD1RobinhoodIngestionStore(db, { runtime, now: () => Date.parse("2026-09-01T18:00:00.000Z") });
  assert.equal(await store.loadCursor(4663), null);
  await store.compareAndSetCursor(cursor(1, 100, hash("a")), { expected_revision: 0 });
  assert.equal((await store.loadCursor(4663)).last_processed_block, 100);
  await assert.rejects(
    store.compareAndSetCursor(cursor(1, 99, hash("b")), { expected_revision: 0 }),
    /robinhood_cursor_revision_conflict/,
  );
  await store.compareAndSetCursor(cursor(2, 101, hash("b")), { expected_revision: 1 });
  assert.equal((await store.loadCursor(4663)).revision, 2);

  const first = {
    block_number: 101,
    block_hash: hash("b"),
    parent_hash: hash("a"),
    block_time: "2026-09-01T17:59:58.000Z",
    provider_id: "alchemy_rpc",
    provider_attempts: [{ provider_id: "alchemy_rpc", state: "success" }],
  };
  assert.equal((await store.appendBlockAnchor(first)).state, "inserted");
  assert.equal((await store.appendBlockAnchor(first)).state, "duplicate");
  const replacement = { ...first, block_hash: hash("c") };
  assert.equal((await store.appendBlockAnchor(replacement)).state, "replaced");
  assert.equal((await store.getBlockAnchor(101)).block_hash, hash("c"));
});

test("D1 ingestion store preserves replacement observations and explicit reorg evidence", async () => {
  const db = createFakeD1();
  const store = createD1RobinhoodIngestionStore(db, { runtime, now: () => Date.parse("2026-09-01T18:00:00.000Z") });
  const base = {
    observation_id: "rhol_first",
    event_position_id: `eip155:4663:tx:${hash("d")}:log:0`,
    chain_id: 4663,
    network: "mainnet",
    block_number: 101,
    block_hash: hash("b"),
    transaction_hash: hash("d"),
    transaction_index: 0,
    log_index: 0,
    contract: `0x${"e".repeat(40)}`,
    registry_id: "verified_registry",
    category: "agent_identity_registry",
    provider_id: "alchemy_rpc",
    retrieved_at: "2026-09-01T18:00:00.000Z",
  };
  assert.equal((await store.appendObservation(base)).state, "inserted");
  assert.equal((await store.appendObservation(base)).state, "duplicate");
  const reorg = {
    reorg_id: "rhreorg_evidence",
    kind: "canonical_chain_replacement",
    replaced_from_block: 101,
    replaced_to_block: 101,
    observed_tip_provider_id: "official_public_rpc",
    detected_at: "2026-09-01T18:00:00.000Z",
  };
  assert.equal((await store.recordReorg(reorg)).state, "inserted");
  assert.equal((await store.recordReorg(reorg)).state, "duplicate");
  assert.equal((await store.invalidateCanonicalRange({ from_block: 101, to_block: 101, reorg_id: reorg.reorg_id })).state, "invalidated");
  const replacement = { ...base, observation_id: "rhol_replacement", block_hash: hash("c") };
  const replaced = await store.appendObservation(replacement);
  assert.deepEqual(replaced, { state: "replaced", supersedes: "rhol_first" });
  assert.equal(db.state.observations.length, 2);
  assert.equal((await store.recordGap({ kind: "provider_gap", detected_at: "2026-09-01T18:00:00.000Z" })).state, "inserted");
  assert.equal(db.state.canonicality.size, 2);
  assert.equal(db.state.audit.size, 1);
});

test("D1 ingestion store never mistakes an oversized row or cross-run contradiction for a duplicate", async () => {
  const db = createFakeD1();
  const store = createD1RobinhoodIngestionStore(db, { runtime, now: () => Date.parse("2026-09-01T18:00:00.000Z") });
  const base = {
    observation_id: "rhol_provider_a",
    event_position_id: `eip155:4663:tx:${hash("d")}:log:0`,
    chain_id: 4663,
    network: "mainnet",
    block_number: 101,
    block_hash: hash("b"),
    transaction_hash: hash("d"),
    transaction_index: 0,
    log_index: 0,
    contract: `0x${"e".repeat(40)}`,
    registry_id: "verified_registry",
    category: "agent_identity_registry",
    provider_id: "alchemy_rpc",
    retrieved_at: "2026-09-01T18:00:00.000Z",
  };
  assert.equal((await store.appendObservation(base)).state, "inserted");
  const conflict = { ...base, observation_id: "rhol_provider_b", provider_id: "official_public_rpc", data: "0x12" };
  assert.deepEqual(await store.appendObservation(conflict), { state: "conflict", conflicts_with: "rhol_provider_a" });
  assert.deepEqual(await store.appendObservation(conflict), { state: "conflict", conflicts_with: "rhol_provider_a" });
  assert.equal(db.state.observations.length, 2);

  await assert.rejects(
    store.appendObservation({ ...base, observation_id: "rhol_oversized", evidence_padding: "x".repeat(128 * 1024) }),
    /robinhood_store_observation_too_large/,
  );
  assert.equal(db.state.observations.length, 2);
});

test("canonical observation view excludes immutable rows from a replaced block", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync("customer-migrations/0001_customer_identity.sql", "utf8"));
  db.exec(readFileSync("customer-migrations/0025_agentic_trading.sql", "utf8"));

  const oldBlockHash = hash("1");
  const newBlockHash = hash("2");
  const parentHash = hash("0");
  const contract = `0x${"a".repeat(40)}`;
  const anchorInsert = db.prepare(`
    INSERT INTO ravenos_robinhood_block_anchors (
      anchor_id, chain_id, network, block_number, block_hash, parent_hash,
      block_time, provider_id, anchor_hash, anchor_json, observed_at
    ) VALUES (?, 4663, 'mainnet', 101, ?, ?, NULL, ?, ?, '{}', ?)
  `);
  anchorInsert.run("anchor_old", oldBlockHash, parentHash, "alchemy_rpc", "a".repeat(64), 1);
  anchorInsert.run("anchor_new", newBlockHash, parentHash, "official_public_rpc", "b".repeat(64), 2);

  const observationInsert = db.prepare(`
    INSERT INTO ravenos_robinhood_log_observations (
      observation_id, event_position_id, chain_id, network, block_number,
      block_hash, transaction_hash, transaction_index, log_index,
      contract_address, registry_id, registry_category, provider_id,
      observation_hash, observation_json, observed_at
    ) VALUES (?, ?, 4663, 'mainnet', 101, ?, ?, 0, 0, ?,
      'verified_registry', 'agent_identity_registry', ?, ?, '{}', ?)
  `);
  observationInsert.run(
    "observation_old",
    `eip155:4663:tx:${hash("3")}:log:0`,
    oldBlockHash,
    hash("3"),
    contract,
    "alchemy_rpc",
    "c".repeat(64),
    1,
  );
  observationInsert.run(
    "observation_new",
    `eip155:4663:tx:${hash("4")}:log:0`,
    newBlockHash,
    hash("4"),
    contract,
    "official_public_rpc",
    "d".repeat(64),
    2,
  );

  const rows = db.prepare(`
    SELECT observation_id, block_hash
    FROM ravenos_robinhood_canonical_log_observations
    ORDER BY observation_id
  `).all().map((row) => ({ ...row }));
  assert.deepEqual(rows, [{ observation_id: "observation_new", block_hash: newBlockHash }]);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM ravenos_robinhood_log_observations").get().count, 2);
  db.close();
});
