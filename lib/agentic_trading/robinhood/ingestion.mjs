import { createHash } from "node:crypto";

import { robinhoodWebsocketEndpoint, verifyRobinhoodRpcChain } from "./runtime.mjs";
import {
  ROBINHOOD_WATCH_REGISTRY_SCHEMA,
  buildRobinhoodLogQueries,
  registryEntryForAddress,
} from "./registry.mjs";

export const ROBINHOOD_INGESTION_CURSOR_SCHEMA = "ravenos.agentic.robinhood_ingestion_cursor.v1";
export const ROBINHOOD_LOG_OBSERVATION_SCHEMA = "ravenos.agentic.robinhood_log_observation.v1";
export const ROBINHOOD_INGESTION_RUN_SCHEMA = "ravenos.agentic.robinhood_ingestion_run.v1";

export const RobinhoodIngestionLimits = Object.freeze({
  // D1 stores the normalized evidence as JSON. Hex encoding doubles the log
  // data length, so keep explicit headroom beneath the 128 KiB row limit.
  maximum_log_data_bytes: 60 * 1024,
  maximum_observation_json_characters: 128 * 1024,
  maximum_logs_per_cycle: 10_000,
  maximum_topics_per_log: 4,
  maximum_websocket_messages_per_batch: 1_000,
});

const HASH_RE = /^0x[a-fA-F0-9]{64}$/;
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const HEX_DATA_RE = /^0x(?:[a-fA-F0-9]{2})*$/;
const QUANTITY_RE = /^0x(?:0|[1-9a-fA-F0-9][a-fA-F0-9]*)$/;

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

function timestamp(value, field) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) fail(`${field}_invalid`);
  return new Date(parsed).toISOString();
}

function nowIso(now) {
  const value = typeof now === "function" ? now() : now;
  if (value instanceof Date) return timestamp(value.toISOString(), "robinhood_ingestion_clock");
  if (Number.isFinite(Number(value))) return timestamp(new Date(Number(value)).toISOString(), "robinhood_ingestion_clock");
  return timestamp(value || new Date().toISOString(), "robinhood_ingestion_clock");
}

function integer(value, field, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) fail(`${field}_invalid`);
  return parsed;
}

function hash(value, field) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!HASH_RE.test(normalized)) fail(`${field}_invalid`);
  return normalized;
}

function quantity(value, field) {
  const text = String(value || "").trim();
  if (!QUANTITY_RE.test(text)) fail(`${field}_invalid`);
  const parsed = BigInt(text);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) fail(`${field}_invalid`);
  return Number(parsed);
}

function hexQuantity(value) {
  return `0x${integer(value, "robinhood_block_number").toString(16)}`;
}

function digest(value, length = 40) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, length);
}

function rpcResult(response, field) {
  if (!response || typeof response !== "object" || !("result" in response) || !response.provider_id) {
    fail(`${field}_invalid`);
  }
  return response;
}

async function mapBounded(values, concurrency, mapper) {
  const rows = new Array(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      rows[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return rows;
}

function estimatedResponseBytes(response) {
  const reported = Number(response?.response_bytes);
  if (Number.isSafeInteger(reported) && reported >= 0) return reported;
  try {
    return new TextEncoder().encode(JSON.stringify(response?.result ?? null)).byteLength;
  } catch {
    fail("robinhood_response_size_unavailable");
  }
}

export function createRobinhoodIngestionBudget(runtime, budgetNow = () => performance.now()) {
  const startedAt = Number(budgetNow());
  if (!Number.isFinite(startedAt)) fail("robinhood_budget_clock_invalid");
  let rpcAttempts = 0;
  let logQueries = 0;
  let responseBytes = 0;
  const elapsed = () => {
    const current = Number(budgetNow());
    if (!Number.isFinite(current)) fail("robinhood_budget_clock_invalid");
    return Math.max(0, current - startedAt);
  };
  const assertTime = () => {
    if (elapsed() > runtime.limits.maximum_schedule_wall_time_ms) fail("robinhood_schedule_wall_time_exceeded");
  };
  return Object.freeze({
    beforeRequest() { assertTime(); },
    reserveLogQueries(count) {
      const increment = integer(count, "robinhood_log_query_budget_increment", { minimum: 0 });
      logQueries += increment;
      if (logQueries > runtime.limits.maximum_log_queries_per_schedule) fail("robinhood_log_query_budget_exceeded");
      assertTime();
    },
    observe(response) {
      rpcAttempts += Math.max(1, Array.isArray(response?.attempts) ? response.attempts.length : 0);
      responseBytes += estimatedResponseBytes(response);
      if (rpcAttempts > runtime.limits.maximum_rpc_attempts_per_schedule) fail("robinhood_rpc_attempt_budget_exceeded");
      if (responseBytes > runtime.limits.maximum_response_bytes_per_schedule) fail("robinhood_response_byte_budget_exceeded");
      assertTime();
      return response;
    },
    snapshot() {
      return Object.freeze({
        rpc_attempts: rpcAttempts,
        log_queries: logQueries,
        response_bytes: responseBytes,
        elapsed_ms: Math.round(elapsed()),
      });
    },
  });
}

function cycleBudgetFailure(error) {
  return new Set([
    "robinhood_schedule_wall_time_exceeded",
    "robinhood_rpc_attempt_budget_exceeded",
    "robinhood_log_query_budget_exceeded",
    "robinhood_response_byte_budget_exceeded",
    "robinhood_response_size_unavailable",
  ]).has(error?.code);
}

function defaultCursor(runtime) {
  const observation = {
    schema_version: ROBINHOOD_INGESTION_CURSOR_SCHEMA,
    chain_id: runtime.chain_id,
    network: runtime.network,
    revision: 0,
    state: "idle",
    last_processed_block: null,
    last_processed_block_hash: null,
    observed_head_block: null,
    backfill_required: false,
    updated_at: null,
  };
  if (JSON.stringify(observation).length > RobinhoodIngestionLimits.maximum_observation_json_characters) {
    fail("robinhood_log_observation_too_large");
  }
  return freeze(observation);
}

export function normalizeRobinhoodIngestionCursor(input, runtime) {
  if (!input) return defaultCursor(runtime);
  if (
    input.schema_version !== ROBINHOOD_INGESTION_CURSOR_SCHEMA
    || Number(input.chain_id) !== runtime.chain_id
    || input.network !== runtime.network
  ) fail("robinhood_ingestion_cursor_invalid");
  const lastBlock = input.last_processed_block === null ? null : integer(input.last_processed_block, "robinhood_cursor_last_block");
  const lastHash = input.last_processed_block_hash === null ? null : hash(input.last_processed_block_hash, "robinhood_cursor_last_hash");
  if ((lastBlock === null) !== (lastHash === null)) fail("robinhood_ingestion_cursor_invalid");
  return freeze({
    schema_version: ROBINHOOD_INGESTION_CURSOR_SCHEMA,
    chain_id: runtime.chain_id,
    network: runtime.network,
    revision: integer(input.revision, "robinhood_cursor_revision"),
    state: String(input.state || "idle").slice(0, 40),
    last_processed_block: lastBlock,
    last_processed_block_hash: lastHash,
    observed_head_block: input.observed_head_block === null ? null : integer(input.observed_head_block, "robinhood_cursor_observed_head"),
    backfill_required: input.backfill_required === true,
    updated_at: input.updated_at ? timestamp(input.updated_at, "robinhood_cursor_updated_at") : null,
  });
}

function normalizeBlock(input, expectedNumber = null) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("robinhood_block_response_invalid");
  const number = quantity(input.number, "robinhood_block_number");
  if (expectedNumber !== null && number !== expectedNumber) fail("robinhood_block_number_mismatch");
  return freeze({
    block_number: number,
    block_hash: hash(input.hash, "robinhood_block_hash"),
    parent_hash: hash(input.parentHash, "robinhood_block_parent_hash"),
    block_time: input.timestamp === undefined || input.timestamp === null
      ? null
      : new Date(quantity(input.timestamp, "robinhood_block_timestamp") * 1_000).toISOString(),
  });
}

function topicMatches(filter, observed) {
  if (filter === null) return true;
  if (Array.isArray(filter)) return filter.includes(observed);
  return filter === observed;
}

function topicsMatch(filters, observed) {
  return filters.every((filter, index) => topicMatches(filter, observed[index]));
}

export function normalizeRobinhoodLogObservation(input, {
  runtime,
  registry,
  retrieved_at: retrievedAt,
  provider_id: providerId,
} = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("robinhood_log_invalid");
  if (input.removed === true) fail("robinhood_removed_log_requires_reconciliation");
  const contract = String(input.address || "").trim().toLowerCase();
  if (!ADDRESS_RE.test(contract)) fail("robinhood_log_address_invalid");
  const registryEntry = registryEntryForAddress(registry, contract);
  if (!registryEntry) fail("robinhood_log_outside_registry");
  const blockNumber = quantity(input.blockNumber, "robinhood_log_block_number");
  if (blockNumber < registryEntry.start_block) fail("robinhood_log_before_registry_start");
  const blockHash = hash(input.blockHash, "robinhood_log_block_hash");
  const transactionHash = hash(input.transactionHash, "robinhood_log_transaction_hash");
  const transactionIndex = quantity(input.transactionIndex, "robinhood_log_transaction_index");
  const logIndex = quantity(input.logIndex, "robinhood_log_index");
  const logTopics = Array.isArray(input.topics)
    ? input.topics.map((value) => hash(value, "robinhood_log_topic")) : null;
  if (!logTopics || logTopics.length > RobinhoodIngestionLimits.maximum_topics_per_log) fail("robinhood_log_topics_invalid");
  if (!topicsMatch(registryEntry.topics, logTopics)) fail("robinhood_log_topic_outside_registry");
  const data = String(input.data || "").trim().toLowerCase();
  if (!HEX_DATA_RE.test(data) || (data.length - 2) / 2 > RobinhoodIngestionLimits.maximum_log_data_bytes) {
    fail("robinhood_log_data_invalid");
  }
  const eventPositionId = `eip155:${runtime.chain_id}:tx:${transactionHash}:log:${logIndex}`;
  const observationId = `rhol_${digest([eventPositionId, blockHash, contract, logTopics, data])}`;
  return freeze({
    schema_version: ROBINHOOD_LOG_OBSERVATION_SCHEMA,
    observation_id: observationId,
    event_position_id: eventPositionId,
    chain_id: runtime.chain_id,
    network: runtime.network,
    contract,
    registry_id: registryEntry.registry_id,
    category: registryEntry.category,
    block_number: blockNumber,
    block_hash: blockHash,
    transaction_hash: transactionHash,
    transaction_index: transactionIndex,
    log_index: logIndex,
    topics: logTopics,
    data,
    provider_id: String(providerId || "").slice(0, 80),
    retrieved_at: timestamp(retrievedAt, "robinhood_log_retrieved_at"),
    confirmation: {
      state: "soft_confirmation",
      posted_to_ethereum: null,
      ethereum_finalized: null,
    },
    decode_state: "pending",
    execution_boundary: {
      transaction_construction: false,
      signing: false,
      broadcasting: false,
      live_execution: false,
    },
  });
}

function storeContract(store) {
  const methods = [
    "loadCursor", "compareAndSetCursor", "getBlockAnchor", "appendBlockAnchor",
    "appendObservation", "recordGap", "recordReorg", "invalidateCanonicalRange", "appendAuditEvent",
  ];
  if (!store || methods.some((method) => typeof store[method] !== "function")) fail("robinhood_ingestion_store_invalid");
  return store;
}

function runResult({ runtime, registry, cursor, state, observedHead, range = null, counts = {}, providerHealth = null, evidence = {} }) {
  return freeze({
    schema_version: ROBINHOOD_INGESTION_RUN_SCHEMA,
    chain_id: runtime.chain_id,
    network: runtime.network,
    state,
    registry_hash: registry.registry_hash,
    cursor,
    observed_head_block: observedHead,
    range,
    counts: {
      queries: 0,
      logs_received: 0,
      observations_inserted: 0,
      observations_duplicate: 0,
      observations_replaced: 0,
      block_anchors: 0,
      ...counts,
    },
    evidence,
    provider_health: providerHealth,
    execution_boundary: runtime.execution_boundary,
  });
}

async function fetchBlock(client, number, budget) {
  budget?.beforeRequest();
  const response = rpcResult(await client.request("eth_getBlockByNumber", [hexQuantity(number), false]), "robinhood_block_rpc_response");
  budget?.observe(response);
  return {
    anchor: freeze({
      ...normalizeBlock(response.result, number),
      provider_id: response.provider_id,
      provider_attempts: Array.isArray(response.attempts) ? response.attempts : [],
    }),
    provider_id: response.provider_id,
    attempts: response.attempts,
    response_bytes: response.response_bytes,
  };
}

async function findCommonAncestor({ client, store, cursor, maximumDepth, budget }) {
  const floor = Math.max(0, cursor.last_processed_block - maximumDepth);
  for (let number = cursor.last_processed_block - 1; number >= floor; number -= 1) {
    const stored = await store.getBlockAnchor(number);
    if (!stored) continue;
    const current = await fetchBlock(client, number, budget);
    if (stored.block_hash === current.anchor.block_hash) return current.anchor;
  }
  return null;
}

async function saveCursor(store, current, values, now) {
  const next = freeze({
    schema_version: ROBINHOOD_INGESTION_CURSOR_SCHEMA,
    chain_id: current.chain_id,
    network: current.network,
    revision: current.revision + 1,
    state: values.state,
    last_processed_block: values.last_processed_block,
    last_processed_block_hash: values.last_processed_block_hash,
    observed_head_block: values.observed_head_block,
    backfill_required: values.backfill_required === true,
    updated_at: now,
  });
  await store.compareAndSetCursor(next, { expected_revision: current.revision });
  return next;
}

async function recordBlockedRun(store, payload) {
  await store.appendAuditEvent(freeze({
    schema_version: "ravenos.agentic.robinhood_ingestion_audit.v1",
    ...payload,
  }));
}

export async function runRobinhoodChainIngestionCycle({
  runtime,
  registry,
  client,
  store,
  now = () => Date.now(),
  budget_now: budgetNow = () => performance.now(),
  resource_budget: resourceBudget = null,
} = {}) {
  if (!runtime || runtime.execution_boundary?.live_execution !== false) fail("robinhood_runtime_invalid");
  if (registry?.schema_version !== ROBINHOOD_WATCH_REGISTRY_SCHEMA || registry.chain_id !== runtime.chain_id) {
    fail("robinhood_registry_invalid");
  }
  storeContract(store);
  const observedAt = nowIso(now);
  let cursor = normalizeRobinhoodIngestionCursor(await store.loadCursor(runtime.chain_id), runtime);
  if (!runtime.enabled) return runResult({ runtime, registry, cursor, state: "disabled", observedHead: null });
  if (!registry.enabled_entry_count) return runResult({ runtime, registry, cursor, state: "awaiting_verified_registry", observedHead: null });
  if (!client?.request || !client?.healthSnapshot) fail("robinhood_rpc_client_invalid");
  const budget = resourceBudget || createRobinhoodIngestionBudget(runtime, budgetNow);

  let headResponse;
  try {
    budget.beforeRequest();
    budget.observe(await verifyRobinhoodRpcChain(client, runtime));
    budget.beforeRequest();
    headResponse = rpcResult(await client.request("eth_blockNumber", []), "robinhood_head_rpc_response");
    budget.observe(headResponse);
  } catch (error) {
    if (!cycleBudgetFailure(error)) throw error;
    const gap = freeze({ kind: error.code, detected_at: observedAt });
    await store.recordGap(gap);
    await recordBlockedRun(store, { state: "resource_budget_exceeded", observed_at: observedAt, gap });
    return runResult({
      runtime, registry, cursor, state: "resource_budget_exceeded", observedHead: null,
      counts: budget.snapshot(), providerHealth: client.healthSnapshot(), evidence: { gap },
    });
  }
  const observedHead = quantity(headResponse.result, "robinhood_head_block");
  const target = Math.max(0, observedHead - runtime.limits.head_lag_blocks);
  const reorgEvidence = [];

  if (cursor.last_processed_block !== null && observedHead < cursor.last_processed_block) {
    const gap = freeze({
      kind: "provider_head_behind_cursor",
      from_block: observedHead,
      to_block: cursor.last_processed_block,
      detected_at: observedAt,
    });
    await store.recordGap(gap);
    await recordBlockedRun(store, { state: "provider_contradiction", observed_at: observedAt, gap });
    return runResult({
      runtime, registry, cursor, state: "provider_contradiction", observedHead,
      counts: budget.snapshot(), providerHealth: client.healthSnapshot(), evidence: { gap },
    });
  }

  if (cursor.last_processed_block !== null) {
    const priorTipAnchor = await store.getBlockAnchor(cursor.last_processed_block);
    const currentAnchor = await fetchBlock(client, cursor.last_processed_block, budget);
    if (currentAnchor.anchor.block_hash !== cursor.last_processed_block_hash) {
      const ancestor = await findCommonAncestor({
        client,
        store,
        cursor,
        maximumDepth: runtime.limits.maximum_reorg_depth,
        budget,
      });
      if (!ancestor) {
        const gap = freeze({
          kind: "reorg_ancestor_unresolved",
          from_block: Math.max(0, cursor.last_processed_block - runtime.limits.maximum_reorg_depth),
          to_block: cursor.last_processed_block,
          detected_at: observedAt,
          prior_block_hash: cursor.last_processed_block_hash,
          current_block_hash: currentAnchor.anchor.block_hash,
        });
        await store.recordGap(gap);
        await recordBlockedRun(store, { state: "reorg_unresolved", observed_at: observedAt, gap });
        return runResult({
          runtime, registry, cursor, state: "reorg_unresolved", observedHead,
          providerHealth: client.healthSnapshot(), evidence: { gap },
        });
      }
      const reorg = freeze({
        reorg_id: `rhreorg_${digest([
          runtime.chain_id,
          ancestor.block_number,
          cursor.last_processed_block,
          cursor.last_processed_block_hash,
          currentAnchor.anchor.block_hash,
        ])}`,
        kind: "canonical_chain_replacement",
        common_ancestor_block: ancestor.block_number,
        common_ancestor_hash: ancestor.block_hash,
        replaced_from_block: ancestor.block_number + 1,
        replaced_to_block: cursor.last_processed_block,
        prior_tip_hash: cursor.last_processed_block_hash,
        observed_tip_hash: currentAnchor.anchor.block_hash,
        prior_tip_provider_id: priorTipAnchor?.provider_id || null,
        observed_tip_provider_id: currentAnchor.anchor.provider_id,
        common_ancestor_provider_id: ancestor.provider_id,
        provider_attempts: currentAnchor.anchor.provider_attempts,
        detected_at: observedAt,
      });
      await store.recordReorg(reorg);
      await store.invalidateCanonicalRange({
        from_block: reorg.replaced_from_block,
        to_block: reorg.replaced_to_block,
        reorg_id: reorg.reorg_id,
      });
      reorgEvidence.push(reorg);
      cursor = await saveCursor(store, cursor, {
        state: "reorg_detected",
        last_processed_block: ancestor.block_number,
        last_processed_block_hash: ancestor.block_hash,
        observed_head_block: observedHead,
        backfill_required: true,
      }, observedAt);
    }
  }

  const fromBlock = cursor.last_processed_block === null
    ? registry.earliest_start_block
    : cursor.last_processed_block + 1;
  if (fromBlock === null || fromBlock > target) {
    const next = await saveCursor(store, cursor, {
      state: "current",
      last_processed_block: cursor.last_processed_block,
      last_processed_block_hash: cursor.last_processed_block_hash,
      observed_head_block: observedHead,
      backfill_required: false,
    }, observedAt);
    return runResult({
      runtime, registry, cursor: next, state: "current", observedHead,
      providerHealth: client.healthSnapshot(), evidence: { reorgs: reorgEvidence },
    });
  }

  const toBlock = Math.min(target, fromBlock + runtime.limits.maximum_blocks_per_cycle - 1);
  const backfillRequired = toBlock < target;
  const queries = buildRobinhoodLogQueries(registry, { from_block: fromBlock, to_block: toBlock });
  if (queries.length > runtime.limits.maximum_log_queries_per_cycle) {
    const blocked = freeze({
      kind: "registry_query_bound_exceeded",
      from_block: fromBlock,
      to_block: toBlock,
      query_count: queries.length,
      maximum_queries: runtime.limits.maximum_log_queries_per_cycle,
      detected_at: observedAt,
    });
    await store.recordGap(blocked);
    await recordBlockedRun(store, { state: "configuration_blocked", observed_at: observedAt, gap: blocked });
    return runResult({
      runtime, registry, cursor, state: "configuration_blocked", observedHead,
      providerHealth: client.healthSnapshot(), evidence: { gap: blocked },
    });
  }

  let logResponses;
  try {
    budget.reserveLogQueries(queries.length);
    logResponses = await mapBounded(queries, runtime.limits.maximum_concurrency, async (query) => {
      const filter = {
        fromBlock: hexQuantity(query.from_block),
        toBlock: hexQuantity(query.to_block),
        address: query.addresses,
        ...(query.topics.length ? { topics: query.topics } : {}),
      };
      budget.beforeRequest();
      const response = rpcResult(await client.request("eth_getLogs", [filter]), "robinhood_logs_rpc_response");
      budget.observe(response);
      if (!Array.isArray(response.result)) fail("robinhood_logs_response_invalid");
      return { query, rows: response.result, provider_id: response.provider_id, attempts: response.attempts };
    });
  } catch (error) {
    const state = cycleBudgetFailure(error) ? "resource_budget_exceeded" : "provider_unavailable";
    const gap = freeze({
      kind: cycleBudgetFailure(error) ? error.code : "provider_range_unavailable",
      from_block: fromBlock,
      to_block: toBlock,
      detected_at: observedAt,
    });
    await store.recordGap(gap);
    await recordBlockedRun(store, { state, observed_at: observedAt, gap, error: String(error?.code || error?.message || "unknown") });
    return runResult({
      runtime, registry, cursor, state, observedHead,
      counts: budget.snapshot(), providerHealth: client.healthSnapshot(), evidence: { gap },
    });
  }

  const rawLogCount = logResponses.reduce((sum, response) => sum + response.rows.length, 0);
  if (rawLogCount > RobinhoodIngestionLimits.maximum_logs_per_cycle) {
    const gap = freeze({
      kind: "provider_log_bound_exceeded", from_block: fromBlock, to_block: toBlock,
      observed_logs: rawLogCount, maximum_logs: RobinhoodIngestionLimits.maximum_logs_per_cycle,
      detected_at: observedAt,
    });
    await store.recordGap(gap);
    return runResult({
      runtime, registry, cursor, state: "log_volume_blocked", observedHead,
      providerHealth: client.healthSnapshot(), evidence: { gap },
    });
  }

  let observations;
  try {
    observations = logResponses.flatMap((response) => response.rows.flatMap((row) => {
      const contract = String(row?.address || "").trim().toLowerCase();
      const entry = ADDRESS_RE.test(contract) ? registryEntryForAddress(registry, contract) : null;
      const observedBlock = row?.blockNumber === undefined ? null : quantity(row.blockNumber, "robinhood_log_block_number");
      if (entry && observedBlock < entry.start_block) return [];
      return [normalizeRobinhoodLogObservation(row, {
        runtime,
        registry,
        retrieved_at: observedAt,
        provider_id: response.provider_id,
      })];
    }));
  } catch (error) {
    const gap = freeze({
      kind: String(error?.code || "provider_log_validation_failed"),
      from_block: fromBlock,
      to_block: toBlock,
      detected_at: observedAt,
    });
    await store.recordGap(gap);
    return runResult({
      runtime, registry, cursor, state: "evidence_rejected", observedHead,
      providerHealth: client.healthSnapshot(), evidence: { gap },
    });
  }
  const normalizedObservationCount = observations.length;
  const byObservation = new Map();
  const byPosition = new Map();
  for (const observation of observations) {
    byObservation.set(observation.observation_id, observation);
    const prior = byPosition.get(observation.event_position_id);
    if (prior && prior.observation_id !== observation.observation_id) {
      const gap = freeze({
        kind: "provider_log_position_conflict",
        from_block: observation.block_number,
        to_block: observation.block_number,
        detected_at: observedAt,
      });
      await store.recordGap(gap);
      return runResult({
        runtime, registry, cursor, state: "provider_contradiction", observedHead,
        providerHealth: client.healthSnapshot(), evidence: { gap },
      });
    }
    byPosition.set(observation.event_position_id, observation);
  }
  observations = [...byObservation.values()].sort((left, right) => (
    left.block_number - right.block_number
    || left.transaction_index - right.transaction_index
    || left.log_index - right.log_index
    || left.observation_id.localeCompare(right.observation_id)
  ));

  const blockNumbers = Array.from({ length: toBlock - fromBlock + 1 }, (_, index) => fromBlock + index);
  let blockResponses;
  try {
    blockResponses = await mapBounded(blockNumbers, runtime.limits.maximum_concurrency, (number) => fetchBlock(client, number, budget));
  } catch (error) {
    const state = cycleBudgetFailure(error) ? "resource_budget_exceeded" : "gap_detected";
    const gap = freeze({
      kind: cycleBudgetFailure(error) ? error.code : "block_anchor_unavailable",
      from_block: fromBlock,
      to_block: toBlock,
      detected_at: observedAt,
    });
    await store.recordGap(gap);
    return runResult({
      runtime, registry, cursor, state, observedHead,
      counts: budget.snapshot(), providerHealth: client.healthSnapshot(), evidence: { gap },
    });
  }
  const anchors = blockResponses.map((row) => row.anchor);
  const expectedParent = cursor.last_processed_block === null ? null : cursor.last_processed_block_hash;
  if (expectedParent && anchors[0].parent_hash !== expectedParent) {
    const gap = freeze({
      kind: "cursor_parent_mismatch", from_block: fromBlock, to_block: fromBlock,
      expected_parent_hash: expectedParent, observed_parent_hash: anchors[0].parent_hash,
      detected_at: observedAt,
    });
    await store.recordGap(gap);
    return runResult({
      runtime, registry, cursor, state: "gap_detected", observedHead,
      providerHealth: client.healthSnapshot(), evidence: { gap },
    });
  }
  for (let index = 1; index < anchors.length; index += 1) {
    if (anchors[index].parent_hash !== anchors[index - 1].block_hash) {
      const gap = freeze({
        kind: "block_parent_discontinuity",
        from_block: anchors[index].block_number,
        to_block: anchors[index].block_number,
        expected_parent_hash: anchors[index - 1].block_hash,
        observed_parent_hash: anchors[index].parent_hash,
        detected_at: observedAt,
      });
      await store.recordGap(gap);
      return runResult({
        runtime, registry, cursor, state: "gap_detected", observedHead,
        providerHealth: client.healthSnapshot(), evidence: { gap },
      });
    }
  }
  const anchorByNumber = new Map(anchors.map((anchor) => [anchor.block_number, anchor]));
  if (observations.some((row) => anchorByNumber.get(row.block_number)?.block_hash !== row.block_hash)) {
    const gap = freeze({ kind: "log_block_hash_mismatch", from_block: fromBlock, to_block: toBlock, detected_at: observedAt });
    await store.recordGap(gap);
    return runResult({
      runtime, registry, cursor, state: "provider_contradiction", observedHead,
      providerHealth: client.healthSnapshot(), evidence: { gap },
    });
  }

  const counts = {
    queries: queries.length,
    logs_received: rawLogCount,
    observations_inserted: 0,
    observations_duplicate: normalizedObservationCount - observations.length,
    observations_replaced: 0,
    block_anchors: anchors.length,
    ...budget.snapshot(),
  };
  try {
    for (const observation of observations) {
      const result = await store.appendObservation(observation);
      if (result?.state === "duplicate") counts.observations_duplicate += 1;
      else if (result?.state === "conflict") {
        const gap = freeze({
          kind: "provider_log_position_conflict_persisted",
          from_block: observation.block_number,
          to_block: observation.block_number,
          event_position_id: observation.event_position_id,
          conflicting_observation_ids: [result.conflicts_with, observation.observation_id].filter(Boolean),
          detected_at: observedAt,
        });
        await store.recordGap(gap);
        await recordBlockedRun(store, { state: "provider_contradiction", observed_at: observedAt, gap });
        return runResult({
          runtime, registry, cursor, state: "provider_contradiction", observedHead,
          range: { from_block: fromBlock, to_block: toBlock, target_block: target },
          counts, providerHealth: client.healthSnapshot(), evidence: { gap, cursor_advanced: false },
        });
      }
      else if (result?.state === "replaced") counts.observations_replaced += 1;
      else counts.observations_inserted += 1;
    }
    for (const anchor of anchors) await store.appendBlockAnchor(anchor);
    const finalAnchor = anchors.at(-1);
    const state = backfillRequired ? "backfill_pending" : "current";
    await recordBlockedRun(store, {
      state,
      observed_at: observedAt,
      from_block: fromBlock,
      to_block: toBlock,
      registry_hash: registry.registry_hash,
      counts,
    });
    const next = await saveCursor(store, cursor, {
      state,
      last_processed_block: finalAnchor.block_number,
      last_processed_block_hash: finalAnchor.block_hash,
      observed_head_block: observedHead,
      backfill_required: backfillRequired,
    }, observedAt);
    return runResult({
      runtime,
      registry,
      cursor: next,
      state,
      observedHead,
      range: { from_block: fromBlock, to_block: toBlock, target_block: target },
      counts,
      providerHealth: client.healthSnapshot(),
      evidence: { reorgs: reorgEvidence, l1_posting_state: "unresolved", ethereum_finality_state: "unresolved" },
    });
  } catch (error) {
    await recordBlockedRun(store, {
      state: "storage_degraded",
      observed_at: observedAt,
      from_block: fromBlock,
      to_block: toBlock,
      error: String(error?.code || error?.message || "unknown"),
    });
    return runResult({
      runtime, registry, cursor, state: "storage_degraded", observedHead,
      range: { from_block: fromBlock, to_block: toBlock, target_block: target },
      counts, providerHealth: client.healthSnapshot(), evidence: { cursor_advanced: false },
    });
  }
}

export function createMemoryRobinhoodIngestionStore({ cursor = null } = {}) {
  let storedCursor = cursor;
  const observations = new Map();
  const canonicalByPosition = new Map();
  const observationHistoryByPosition = new Map();
  const invalidatedObservationIds = new Set();
  const anchorHistory = [];
  const canonicalAnchors = new Map();
  const gaps = [];
  const reorgs = [];
  const audit = [];
  return {
    async loadCursor() { return storedCursor; },
    async compareAndSetCursor(next, { expected_revision: expectedRevision }) {
      const currentRevision = storedCursor?.revision || 0;
      if (currentRevision !== expectedRevision) fail("robinhood_cursor_revision_conflict");
      storedCursor = structuredClone(next);
      return structuredClone(storedCursor);
    },
    async getBlockAnchor(number) {
      const value = canonicalAnchors.get(Number(number));
      return value ? structuredClone(value) : null;
    },
    async appendBlockAnchor(anchor) {
      const normalized = freeze(structuredClone(anchor));
      const prior = canonicalAnchors.get(anchor.block_number);
      if (prior?.block_hash === anchor.block_hash) return { state: "duplicate" };
      anchorHistory.push(normalized);
      canonicalAnchors.set(anchor.block_number, normalized);
      return { state: prior ? "replaced" : "inserted" };
    },
    async appendObservation(observation) {
      const history = observationHistoryByPosition.get(observation.event_position_id) || [];
      const prior = [...history].reverse().find((observationId) => observationId !== observation.observation_id) || null;
      if (observations.has(observation.observation_id)) {
        if (prior && !invalidatedObservationIds.has(prior)) return { state: "conflict", conflicts_with: prior };
        return { state: "duplicate" };
      }
      observations.set(observation.observation_id, freeze(structuredClone(observation)));
      history.push(observation.observation_id);
      observationHistoryByPosition.set(observation.event_position_id, history);
      canonicalByPosition.set(observation.event_position_id, observation.observation_id);
      if (!prior) return { state: "inserted" };
      return invalidatedObservationIds.has(prior)
        ? { state: "replaced", supersedes: prior }
        : { state: "conflict", conflicts_with: prior };
    },
    async recordGap(gap) { gaps.push(freeze(structuredClone(gap))); },
    async recordReorg(reorg) {
      if (reorgs.some((row) => row.reorg_id === reorg.reorg_id)) return { state: "duplicate" };
      reorgs.push(freeze(structuredClone(reorg)));
      return { state: "inserted" };
    },
    async invalidateCanonicalRange({ from_block: fromBlock, to_block: toBlock }) {
      let observationsInvalidated = 0;
      for (const [position, observationId] of canonicalByPosition) {
        const observation = observations.get(observationId);
        if (observation && observation.block_number >= fromBlock && observation.block_number <= toBlock) {
          canonicalByPosition.delete(position);
          invalidatedObservationIds.add(observationId);
          observationsInvalidated += 1;
        }
      }
      let anchorsInvalidated = 0;
      for (const number of [...canonicalAnchors.keys()]) {
        if (number >= fromBlock && number <= toBlock) {
          canonicalAnchors.delete(number);
          anchorsInvalidated += 1;
        }
      }
      return { state: "invalidated", observations_invalidated: observationsInvalidated, anchors_invalidated: anchorsInvalidated };
    },
    async appendAuditEvent(event) { audit.push(freeze(structuredClone(event))); },
    snapshot() {
      return freeze({
        cursor: storedCursor ? structuredClone(storedCursor) : null,
        observations: [...observations.values()].map((row) => structuredClone(row)),
        canonical_observation_ids: [...canonicalByPosition.values()],
        anchor_history: anchorHistory.map((row) => structuredClone(row)),
        canonical_anchors: [...canonicalAnchors.values()].map((row) => structuredClone(row)),
        gaps: gaps.map((row) => structuredClone(row)),
        reorgs: reorgs.map((row) => structuredClone(row)),
        audit: audit.map((row) => structuredClone(row)),
      });
    },
  };
}

export function normalizeRobinhoodHeadNotification(input, runtime) {
  const result = input?.params?.result || input?.result || input;
  if (!result || typeof result !== "object") fail("robinhood_head_notification_invalid");
  const anchor = normalizeBlock(result);
  return freeze({
    schema_version: "ravenos.agentic.robinhood_head_signal.v1",
    chain_id: runtime.chain_id,
    network: runtime.network,
    ...anchor,
    finality: "soft_confirmation",
    triggers_bounded_rpc_catchup: true,
    raw_payload_retained: false,
  });
}

function websocketErrorCode(error) {
  const code = String(error?.code || "").toLowerCase();
  if (code.includes("timeout") || code.includes("timedout") || code.includes("abort")) return "websocket_timeout";
  if (code.includes("429") || code.includes("rate")) return "websocket_rate_limited";
  if (code.includes("401") || code.includes("403") || code.includes("author")) return "websocket_authorization_failed";
  if (code.includes("stream_invalid")) return "websocket_stream_invalid";
  if (code.includes("head_notification")) return "websocket_head_notification_invalid";
  return "websocket_unavailable";
}

export async function runRobinhoodHeadStreamSupervisor({
  runtime,
  open,
  on_head: onHead,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  reconnect_delay: reconnectDelay = (attempt) => Math.min(60_000, 1_000 * (2 ** Math.min(6, attempt - 1))),
  maximum_attempts: maximumAttempts = 7,
  maximum_messages: maximumMessages = RobinhoodIngestionLimits.maximum_websocket_messages_per_batch,
} = {}) {
  if (!runtime?.enabled || !runtime.websocket) return freeze({ state: "websocket_unconfigured", attempts: 0, signals: 0, errors: [] });
  if (typeof open !== "function" || typeof onHead !== "function") fail("robinhood_websocket_adapter_invalid");
  const attemptsBound = integer(maximumAttempts, "robinhood_websocket_maximum_attempts", { minimum: 1, maximum: 20 });
  const messagesBound = integer(maximumMessages, "robinhood_websocket_maximum_messages", {
    minimum: 1,
    maximum: RobinhoodIngestionLimits.maximum_websocket_messages_per_batch,
  });
  const errors = [];
  let signals = 0;
  for (let attempt = 1; attempt <= attemptsBound && signals < messagesBound; attempt += 1) {
    try {
      const stream = await open({
        provider: runtime.websocket,
        endpoint: robinhoodWebsocketEndpoint(runtime),
        subscription: { jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["newHeads"] },
      });
      if (!stream || typeof stream[Symbol.asyncIterator] !== "function") fail("robinhood_websocket_stream_invalid");
      for await (const message of stream) {
        const signal = normalizeRobinhoodHeadNotification(message, runtime);
        await onHead(signal);
        signals += 1;
        if (signals >= messagesBound) break;
      }
      if (signals >= messagesBound) break;
      errors.push({ attempt, code: "websocket_closed" });
    } catch (error) {
      errors.push({ attempt, code: websocketErrorCode(error) });
    }
    if (attempt < attemptsBound && signals < messagesBound) {
      const delay = integer(reconnectDelay(attempt), "robinhood_websocket_reconnect_delay", { minimum: 0, maximum: 60_000 });
      await sleep(delay);
    }
  }
  return freeze({
    state: signals > 0 ? errors.length ? "degraded" : "current" : "unavailable",
    attempts: Math.min(attemptsBound, errors.length + (signals > 0 ? 1 : 0)),
    signals,
    errors,
    raw_messages_retained: false,
    execution_authority: false,
  });
}
