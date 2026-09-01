import { assertNoSecretBearingFields } from "../customer_trade/contracts.mjs";
import { agenticContractHash } from "./hashing.mjs";

export const AGENTIC_AUDIT_EVENT_SCHEMA = "ravenos.agentic.audit_event.v1";
export const AGENTIC_AUDIT_GENESIS_HASH = "0".repeat(64);

function clone(value) {
  return structuredClone(value);
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
}

function required(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${field}_required`);
  return normalized;
}

function timestamp(value, field = "occurred_at") {
  const normalized = String(value ?? "").trim();
  const parsed = Date.parse(normalized);
  if (!normalized || !Number.isFinite(parsed)) throw new Error(`${field}_invalid`);
  return new Date(parsed).toISOString();
}

function eventCore(input, sequence, previousHash) {
  const payload = input.payload === undefined ? null : clone(input.payload);
  assertNoSecretBearingFields(payload);
  return {
    schema_version: AGENTIC_AUDIT_EVENT_SCHEMA,
    event_id: required(input.event_id, "audit_event_id"),
    sequence,
    aggregate_type: required(input.aggregate_type, "audit_aggregate_type"),
    aggregate_id: required(input.aggregate_id, "audit_aggregate_id"),
    event_type: required(input.event_type, "audit_event_type"),
    occurred_at: timestamp(input.occurred_at),
    actor: String(input.actor || "raven_deterministic_runtime"),
    environment: String(input.environment || "paper"),
    payload,
    previous_hash: previousHash,
  };
}

export function createAgenticAuditEvent(input = {}, { sequence = 0, previous_hash: previousHash = AGENTIC_AUDIT_GENESIS_HASH } = {}) {
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error("audit_sequence_invalid");
  const normalizedPreviousHash = sequence === 0 ? AGENTIC_AUDIT_GENESIS_HASH : required(previousHash, "audit_previous_hash");
  const core = eventCore(input, sequence, normalizedPreviousHash);
  return freeze({ ...core, event_hash: agenticContractHash(core) });
}

export function verifyAuditEvents(events = []) {
  let previousHash = AGENTIC_AUDIT_GENESIS_HASH;
  const ids = new Set();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!event || event.schema_version !== AGENTIC_AUDIT_EVENT_SCHEMA) {
      throw new Error(`audit_schema_invalid:${index}`);
    }
    if (event.sequence !== index) throw new Error(`audit_sequence_invalid:${index}`);
    if (event.previous_hash !== previousHash) throw new Error(`audit_previous_hash_invalid:${index}`);
    if (ids.has(event.event_id)) throw new Error(`audit_event_id_duplicate:${event.event_id}`);
    ids.add(event.event_id);
    const { event_hash: suppliedHash, ...core } = event;
    const expectedHash = agenticContractHash(core);
    if (!suppliedHash || suppliedHash !== expectedHash) throw new Error(`audit_event_hash_invalid:${index}`);
    assertNoSecretBearingFields(event.payload);
    previousHash = suppliedHash;
  }
  return {
    ok: true,
    event_count: events.length,
    head_hash: previousHash,
  };
}

export function createAppendOnlyAuditChain({ events = [] } = {}) {
  const rows = clone(Array.isArray(events) ? events : []);
  verifyAuditEvents(rows);
  const byId = new Map(rows.map((row) => [row.event_id, row]));

  return Object.freeze({
    append(input = {}) {
      const existing = byId.get(String(input.event_id || ""));
      if (existing) {
        const candidate = eventCore(input, existing.sequence, existing.previous_hash);
        if (agenticContractHash(candidate) !== existing.event_hash) {
          throw new Error(`audit_idempotency_conflict:${existing.event_id}`);
        }
        return { event: existing, idempotent: true };
      }
      const sequence = rows.length;
      const previousHash = sequence ? rows[sequence - 1].event_hash : AGENTIC_AUDIT_GENESIS_HASH;
      const event = createAgenticAuditEvent(input, { sequence, previous_hash: previousHash });
      rows.push(event);
      byId.set(event.event_id, event);
      return { event, idempotent: false };
    },
    all() {
      return freeze(clone(rows));
    },
    eventsFor(aggregateType, aggregateId) {
      return freeze(clone(rows.filter((event) => event.aggregate_type === aggregateType && event.aggregate_id === aggregateId)));
    },
    head() {
      return rows.length ? rows[rows.length - 1] : null;
    },
    verify() {
      return verifyAuditEvents(rows);
    },
    snapshot() {
      return freeze({
        schema_version: "ravenos.agentic.audit_snapshot.v1",
        events: clone(rows),
        event_count: rows.length,
        head_hash: rows.length ? rows[rows.length - 1].event_hash : AGENTIC_AUDIT_GENESIS_HASH,
      });
    },
  });
}
