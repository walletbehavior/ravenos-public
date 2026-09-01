import { createHash } from "node:crypto";

export const ROBINHOOD_WATCH_REGISTRY_SCHEMA = "ravenos.agentic.robinhood_watch_registry.v1";

export const RobinhoodWatchRegistryLimits = Object.freeze({
  maximum_entries: 256,
  maximum_addresses_per_query: 20,
  maximum_topics_per_entry: 4,
  maximum_topic_alternatives: 16,
});

export const ROBINHOOD_WATCH_CATEGORIES = Object.freeze([
  "agent_factory",
  "agent_identity_registry",
  "agent_token_launch",
  "approved_dex_factory",
  "approved_dex_router",
  "launchpad",
  "liquidity_pool",
  "token_contract",
  "virtuals_registry",
]);
const WATCH_CATEGORY_SET = new Set(ROBINHOOD_WATCH_CATEGORIES);

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const EVM_TOPIC_RE = /^0x[a-fA-F0-9]{64}$/;

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

function clean(value, maximum = 200) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > maximum) fail("robinhood_registry_text_invalid");
  return text;
}

function timestamp(value, field) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) fail(`${field}_invalid`);
  return new Date(parsed).toISOString();
}

function blockNumber(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail(`${field}_invalid`);
  return parsed;
}

function address(value) {
  const normalized = clean(value, 42).toLowerCase();
  if (!EVM_ADDRESS_RE.test(normalized) || /^0x0{40}$/.test(normalized)) fail("robinhood_registry_address_invalid");
  return normalized;
}

function topicValue(value) {
  if (value === null) return null;
  if (Array.isArray(value)) {
    if (!value.length || value.length > RobinhoodWatchRegistryLimits.maximum_topic_alternatives) {
      fail("robinhood_registry_topic_invalid");
    }
    const values = [...new Set(value.map((entry) => topicValue(entry)))].sort();
    if (values.some((entry) => entry === null || Array.isArray(entry))) fail("robinhood_registry_topic_invalid");
    return values;
  }
  const normalized = clean(value, 66).toLowerCase();
  if (!EVM_TOPIC_RE.test(normalized)) fail("robinhood_registry_topic_invalid");
  return normalized;
}

function topics(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > RobinhoodWatchRegistryLimits.maximum_topics_per_entry) {
    fail("robinhood_registry_topics_invalid");
  }
  return value.map(topicValue);
}

function provenance(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("robinhood_registry_provenance_invalid");
  const sourceType = clean(input.source_type, 40).toLowerCase();
  if (!["official_documentation", "protocol_registry", "operator_verified"].includes(sourceType)) {
    fail("robinhood_registry_provenance_invalid");
  }
  const reference = clean(input.reference, 500);
  if (!reference || !/^(?:https:\/\/|urn:sha256:)/.test(reference)) fail("robinhood_registry_provenance_invalid");
  const verificationMethod = clean(input.verification_method, 120);
  if (!verificationMethod) fail("robinhood_registry_provenance_invalid");
  return freeze({
    source_type: sourceType,
    reference,
    verification_method: verificationMethod,
    verified_at: timestamp(input.verified_at, "robinhood_registry_verified_at"),
  });
}

function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeEntry(input, chainId) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("robinhood_registry_entry_invalid");
  const allowed = new Set([
    "registry_id", "chain_id", "address", "category", "label", "start_block", "topics",
    "enabled", "provenance",
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) fail("robinhood_registry_entry_invalid");
  if (Number(input.chain_id) !== chainId) fail("robinhood_registry_chain_id_mismatch");
  const category = clean(input.category, 40).toLowerCase();
  if (!WATCH_CATEGORY_SET.has(category)) fail("robinhood_registry_category_invalid");
  const registryId = clean(input.registry_id, 100);
  if (!/^[a-z][a-z0-9_-]{2,99}$/.test(registryId)) fail("robinhood_registry_id_invalid");
  return freeze({
    registry_id: registryId,
    chain_id: chainId,
    address: address(input.address),
    category,
    label: clean(input.label, 100) || null,
    start_block: blockNumber(input.start_block, "robinhood_registry_start_block"),
    topics: topics(input.topics),
    // A reviewed registry document is not itself activation authority. Every
    // watched contract must be opted in explicitly so an omitted field cannot
    // start a production scan.
    enabled: input.enabled === true,
    provenance: provenance(input.provenance),
  });
}

export function normalizeRobinhoodWatchRegistry(input = {}, { chain_id: chainId = 4663 } = {}) {
  if (![4663, 46630].includes(Number(chainId))) fail("robinhood_registry_chain_id_unsupported");
  const entriesInput = Array.isArray(input) ? input : input?.entries;
  if (!Array.isArray(entriesInput) || entriesInput.length > RobinhoodWatchRegistryLimits.maximum_entries) {
    fail("robinhood_registry_entries_invalid");
  }
  const entries = entriesInput.map((entry) => normalizeEntry(entry, Number(chainId)));
  if (new Set(entries.map((entry) => entry.registry_id)).size !== entries.length) fail("robinhood_registry_id_duplicate");
  if (new Set(entries.map((entry) => entry.address)).size !== entries.length) fail("robinhood_registry_address_duplicate");
  entries.sort((left, right) => left.address.localeCompare(right.address));
  const enabled = entries.filter((entry) => entry.enabled);
  const body = {
    schema_version: ROBINHOOD_WATCH_REGISTRY_SCHEMA,
    chain_id: Number(chainId),
    entry_count: entries.length,
    enabled_entry_count: enabled.length,
    earliest_start_block: enabled.length ? Math.min(...enabled.map((entry) => entry.start_block)) : null,
    entries,
  };
  return freeze({ ...body, registry_hash: stableHash(body) });
}

export function robinhoodWatchRegistryFromEnvironment(env = {}, { chain_id: chainId = 4663 } = {}) {
  const raw = String(env.RAVENOS_ROBINHOOD_CHAIN_WATCH_REGISTRY_JSON || "").trim();
  if (!raw) return normalizeRobinhoodWatchRegistry([], { chain_id: chainId });
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("robinhood_registry_json_invalid");
  }
  return normalizeRobinhoodWatchRegistry(parsed, { chain_id: chainId });
}

function topicsKey(value) {
  return JSON.stringify(value || []);
}

export function buildRobinhoodLogQueries(registry, { from_block: fromBlock, to_block: toBlock } = {}) {
  if (registry?.schema_version !== ROBINHOOD_WATCH_REGISTRY_SCHEMA) fail("robinhood_registry_invalid");
  const from = blockNumber(fromBlock, "robinhood_log_query_from_block");
  const to = blockNumber(toBlock, "robinhood_log_query_to_block");
  if (to < from) fail("robinhood_log_query_range_invalid");
  const groups = new Map();
  for (const entry of registry.entries.filter((row) => row.enabled && row.start_block <= to)) {
    const key = topicsKey(entry.topics);
    const rows = groups.get(key) || [];
    rows.push(entry);
    groups.set(key, rows);
  }
  const queries = [];
  for (const [key, rows] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    for (let index = 0; index < rows.length; index += RobinhoodWatchRegistryLimits.maximum_addresses_per_query) {
      const batch = rows.slice(index, index + RobinhoodWatchRegistryLimits.maximum_addresses_per_query);
      queries.push(freeze({
        from_block: Math.max(from, Math.min(...batch.map((row) => row.start_block))),
        to_block: to,
        addresses: batch.map((row) => row.address),
        topics: JSON.parse(key),
        registry_ids: batch.map((row) => row.registry_id).sort(),
      }));
    }
  }
  return freeze(queries);
}

export function registryEntryForAddress(registry, value) {
  const normalized = address(value);
  return registry.entries.find((entry) => entry.enabled && entry.address === normalized) || null;
}
