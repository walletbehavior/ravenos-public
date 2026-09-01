import { normalizeAtomic } from "./decimal.mjs";
import { agenticContractHash } from "./hashing.mjs";

export const CAPITAL_RESERVATION_SCHEMA = "ravenos.agentic.capital_reservation.v1";
const STATES = new Set(["reserved", "consumed", "released"]);

function clone(value) {
  return structuredClone(value);
}

function required(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${field}_required`);
  return normalized;
}

function scope(value, field) {
  return required(value, field).toLowerCase();
}

export function capitalLocationKey(input = {}) {
  return [
    scope(input.chain_id, "capital_chain_id"),
    scope(input.venue_id, "capital_venue_id"),
    required(input.asset_id, "capital_asset_id"),
  ].join("|");
}

function normalizeBalance(input = {}) {
  return {
    chain_id: scope(input.chain_id, "balance_chain_id"),
    venue_id: scope(input.venue_id, "balance_venue_id"),
    asset_id: required(input.asset_id, "balance_asset_id"),
    available_atomic: normalizeAtomic(input.available_atomic, "balance_available_atomic"),
  };
}

function normalizeReservation(input = {}, state = "reserved") {
  if (!STATES.has(state)) throw new Error("reservation_state_invalid");
  const core = {
    schema_version: CAPITAL_RESERVATION_SCHEMA,
    reservation_id: required(input.reservation_id, "reservation_id"),
    plan_id: required(input.plan_id, "reservation_plan_id"),
    leg_id: required(input.leg_id, "reservation_leg_id"),
    chain_id: scope(input.chain_id, "reservation_chain_id"),
    venue_id: scope(input.venue_id, "reservation_venue_id"),
    asset_id: required(input.asset_id, "reservation_asset_id"),
    amount_atomic: normalizeAtomic(input.amount_atomic, "reservation_amount_atomic", { allowZero: false }),
    gas_asset_id: input.gas_asset_id ? required(input.gas_asset_id, "reservation_gas_asset_id") : null,
    gas_amount_atomic: input.gas_amount_atomic === null || input.gas_amount_atomic === undefined
      ? "0"
      : normalizeAtomic(input.gas_amount_atomic, "reservation_gas_amount_atomic"),
    state,
    created_at: String(input.created_at || ""),
    updated_at: String(input.updated_at || input.created_at || ""),
  };
  if (!Number.isFinite(Date.parse(core.created_at))) throw new Error("reservation_created_at_invalid");
  if (!Number.isFinite(Date.parse(core.updated_at))) throw new Error("reservation_updated_at_invalid");
  return { ...core, reservation_hash: agenticContractHash(core) };
}

function normalizeSnapshot(snapshot = null, initialBalances = []) {
  if (!snapshot) return {
    balances: (Array.isArray(initialBalances) ? initialBalances : []).map(normalizeBalance),
    reservations: [],
  };
  if (snapshot.schema_version !== "ravenos.agentic.capital_reservation_book.v1") {
    throw new Error("reservation_snapshot_schema_invalid");
  }
  const { snapshot_hash: suppliedHash, ...snapshotCore } = snapshot;
  if (!suppliedHash || suppliedHash !== agenticContractHash(snapshotCore)) {
    throw new Error("reservation_snapshot_integrity_invalid");
  }
  return {
    balances: (Array.isArray(snapshot.balances) ? snapshot.balances : []).map(normalizeBalance),
    reservations: (Array.isArray(snapshot.reservations) ? snapshot.reservations : []).map((row) => {
      const normalized = normalizeReservation(row, row.state);
      if (normalized.reservation_hash !== row.reservation_hash) throw new Error("reservation_snapshot_integrity_invalid");
      return normalized;
    }),
  };
}

export function createCapitalReservationBook({ initial_balances = [], snapshot = null } = {}) {
  const normalized = normalizeSnapshot(snapshot, initial_balances);
  const balances = new Map();
  const reservations = new Map();
  for (const balance of normalized.balances) {
    const key = capitalLocationKey(balance);
    if (balances.has(key)) throw new Error(`duplicate_capital_balance:${key}`);
    balances.set(key, balance);
  }
  for (const reservation of normalized.reservations) {
    if (reservations.has(reservation.reservation_id)) throw new Error(`duplicate_reservation:${reservation.reservation_id}`);
    reservations.set(reservation.reservation_id, reservation);
  }

  function reservedAt(key, excludingId = null) {
    let total = 0n;
    for (const row of reservations.values()) {
      if (row.state === "released" || row.reservation_id === excludingId) continue;
      if (capitalLocationKey(row) === key) total += BigInt(row.amount_atomic);
      if (row.gas_asset_id) {
        const gasKey = capitalLocationKey({ chain_id: row.chain_id, venue_id: row.venue_id, asset_id: row.gas_asset_id });
        if (gasKey === key) total += BigInt(row.gas_amount_atomic);
      }
    }
    return total;
  }

  function availableAt(location) {
    const key = capitalLocationKey(location);
    const balance = balances.get(key);
    if (!balance) return null;
    const remaining = BigInt(balance.available_atomic) - reservedAt(key);
    return remaining < 0n ? "0" : remaining.toString();
  }

  return Object.freeze({
    balance(location) {
      const key = capitalLocationKey(location);
      const balance = balances.get(key);
      return balance ? { ...clone(balance), unreserved_atomic: availableAt(location) } : null;
    },
    reserve(input = {}) {
      const reservationId = required(input.reservation_id, "reservation_id");
      const existing = reservations.get(reservationId);
      if (existing) {
        const candidate = normalizeReservation({ ...input, created_at: existing.created_at, updated_at: existing.updated_at }, existing.state);
        if (candidate.reservation_hash !== existing.reservation_hash) throw new Error(`reservation_idempotency_conflict:${reservationId}`);
        return { ok: true, idempotent: true, reservation: clone(existing) };
      }
      const reservation = normalizeReservation(input, "reserved");
      const capitalKey = capitalLocationKey(reservation);
      const available = availableAt(reservation);
      if (available === null) return { ok: false, reason: "local_capital_unavailable", reservation: null };
      const gasLocation = reservation.gas_asset_id
        ? { chain_id: reservation.chain_id, venue_id: reservation.venue_id, asset_id: reservation.gas_asset_id }
        : null;
      const gasKey = gasLocation ? capitalLocationKey(gasLocation) : null;
      const sameAssetGas = gasKey === capitalKey ? BigInt(reservation.gas_amount_atomic) : 0n;
      const combinedCapitalDebit = BigInt(reservation.amount_atomic) + sameAssetGas;
      if (BigInt(available) < combinedCapitalDebit) {
        return { ok: false, reason: "insufficient_local_capital", reservation: null, available_atomic: available };
      }
      if (gasLocation && gasKey !== capitalKey && BigInt(reservation.gas_amount_atomic) > 0n) {
        const gasAvailable = availableAt(gasLocation);
        if (gasAvailable === null) return { ok: false, reason: "gas_balance_unavailable", reservation: null };
        if (BigInt(gasAvailable) < BigInt(reservation.gas_amount_atomic)) {
          return { ok: false, reason: "insufficient_native_gas", reservation: null, available_gas_atomic: gasAvailable };
        }
      }
      reservations.set(reservationId, reservation);
      return { ok: true, idempotent: false, reservation: clone(reservation) };
    },
    transition(reservationId, nextState, occurredAt) {
      const id = required(reservationId, "reservation_id");
      const current = reservations.get(id);
      if (!current) throw new Error(`reservation_not_found:${id}`);
      if (!new Set(["consumed", "released"]).has(nextState)) throw new Error("reservation_transition_invalid");
      if (current.state === nextState) return { reservation: clone(current), idempotent: true };
      if (current.state !== "reserved") throw new Error(`reservation_terminal:${current.state}`);
      const next = normalizeReservation({ ...current, updated_at: occurredAt }, nextState);
      reservations.set(id, next);
      return { reservation: clone(next), idempotent: false };
    },
    get(reservationId) {
      const row = reservations.get(String(reservationId || ""));
      return row ? clone(row) : null;
    },
    forPlan(planId) {
      const id = String(planId || "");
      return [...reservations.values()].filter((row) => row.plan_id === id).map(clone);
    },
    snapshot() {
      const payload = {
        schema_version: "ravenos.agentic.capital_reservation_book.v1",
        balances: [...balances.values()].map(clone),
        reservations: [...reservations.values()].map(clone),
      };
      return { ...payload, snapshot_hash: agenticContractHash(payload) };
    },
  });
}
