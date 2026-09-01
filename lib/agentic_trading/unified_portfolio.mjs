import { agenticContractHash } from "./hashing.mjs";
import { normalizeAtomic, sumAtomic } from "./decimal.mjs";
import { capitalLocationKey } from "./capital_reservations.mjs";
import {
  normalizeAssetIdentity,
  normalizeChainIdentity,
  normalizeInstrumentIdentity,
  normalizeVenueIdentity,
} from "./identity.mjs";

export const AGENTIC_UNIFIED_PORTFOLIO_SCHEMA = "ravenos.agentic.unified_portfolio.v1";

const AVAILABILITY_STATES = new Set(["available", "stale", "unrouteable", "unavailable", "unknown"]);
const VALUATION_STATES = new Set(["executable", "marked", "stale", "unrouteable", "unavailable", "unknown"]);
const POSITION_SIDES = new Set(["long", "short", "asset", "liability"]);
const PLAN_STATES_WITH_EXPOSURE = new Set([
  "approved",
  "previewing",
  "ready",
  "executing",
  "partially_executed",
  "reconciliation_required",
  "compensation_required",
  "compensating",
]);

function required(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${field}_required`);
  return normalized;
}

function optionalAtomic(value, field) {
  return value === null || value === undefined || value === "" ? null : normalizeAtomic(value, field);
}

function timestamp(value, field) {
  const normalized = String(value ?? "").trim();
  const parsed = Date.parse(normalized);
  if (!normalized || !Number.isFinite(parsed)) throw new Error(`${field}_invalid`);
  return new Date(parsed).toISOString();
}

function optionalTimestamp(value, field) {
  return value === null || value === undefined || value === "" ? null : timestamp(value, field);
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function enumValue(value, allowed, field, fallback) {
  const normalized = String(value ?? fallback ?? "").trim().toLowerCase();
  if (!allowed.has(normalized)) throw new Error(`${field}_invalid`);
  return normalized;
}

function subtractFloor(left, right) {
  const result = BigInt(left) - BigInt(right);
  return result > 0n ? result.toString() : "0";
}

function signedSubtract(left, right) {
  return (BigInt(left) - BigInt(right)).toString();
}

function sumKnown(values) {
  if (values.some((value) => value === null || value === undefined)) return null;
  return sumAtomic(values);
}

function assetFrom(input, field) {
  const asset = normalizeAssetIdentity(input);
  if (!asset.asset_id) throw new Error(`${field}_invalid`);
  return asset;
}

function normalizeAccount(input = {}, index) {
  const chain = normalizeChainIdentity(input.chain_id || input.chain);
  const venue = normalizeVenueIdentity(input.venue || input.venue_identity);
  if (venue.chain_id !== chain.chain_id) throw new Error(`account_${index}_venue_chain_mismatch`);
  const observedAt = timestamp(input.observed_at, `account_${index}_observed_at`);
  const expiresAt = optionalTimestamp(input.expires_at, `account_${index}_expires_at`);
  if (expiresAt && Date.parse(expiresAt) <= Date.parse(observedAt)) throw new Error(`account_${index}_expiry_invalid`);
  return {
    account_id: required(input.account_id, `account_${index}_id`),
    chain_id: chain.chain_id,
    venue_id: venue.venue_id,
    custody_type: required(input.custody_type || "user_controlled", `account_${index}_custody_type`).toLowerCase(),
    connection_state: required(input.connection_state || "observed", `account_${index}_connection_state`).toLowerCase(),
    observed_at: observedAt,
    expires_at: expiresAt,
    provider: required(input.provider, `account_${index}_provider`),
    provider_health: required(input.provider_health || "unknown", `account_${index}_provider_health`).toLowerCase(),
    finality: required(input.finality || "unknown", `account_${index}_finality`).toLowerCase(),
  };
}

function normalizeBalance(input = {}, index, accountById) {
  const accountId = required(input.account_id, `balance_${index}_account_id`);
  const account = accountById.get(accountId);
  if (!account) throw new Error(`balance_${index}_account_missing`);
  const asset = assetFrom(input.asset || input.asset_identity, `balance_${index}_asset`);
  const chainId = required(input.chain_id || asset.chain_id, `balance_${index}_chain_id`);
  const venueId = required(input.venue_id || account.venue_id, `balance_${index}_venue_id`);
  if (asset.chain_id !== chainId || account.chain_id !== chainId || account.venue_id !== venueId) {
    throw new Error(`balance_${index}_location_mismatch`);
  }
  const availability = enumValue(input.state || input.availability, AVAILABILITY_STATES, `balance_${index}_availability`, "unknown");
  const quantityAtomic = optionalAtomic(input.quantity_atomic ?? input.balance_atomic, `balance_${index}_quantity_atomic`);
  const availableAtomic = optionalAtomic(input.available_atomic, `balance_${index}_available_atomic`);
  if (availability === "available" && availableAtomic === null) throw new Error(`balance_${index}_available_amount_required`);
  if (quantityAtomic !== null && availableAtomic !== null && BigInt(availableAtomic) > BigInt(quantityAtomic)) {
    throw new Error(`balance_${index}_available_exceeds_quantity`);
  }
  const observedAt = timestamp(input.observed_at || account.observed_at, `balance_${index}_observed_at`);
  return {
    observation_id: required(input.observation_id, `balance_${index}_observation_id`),
    economic_lot_id: required(input.economic_lot_id, `balance_${index}_economic_lot_id`),
    account_id: accountId,
    chain_id: chainId,
    venue_id: venueId,
    asset,
    asset_id: asset.asset_id,
    quantity_atomic: quantityAtomic,
    available_atomic: availability === "available" ? availableAtomic : null,
    state: availability,
    marked_value_usdc_micros: optionalAtomic(input.marked_value_usdc_micros, `balance_${index}_marked_value`),
    executable_value_usdc_micros: optionalAtomic(input.executable_value_usdc_micros, `balance_${index}_executable_value`),
    valuation_state: enumValue(input.valuation_state, VALUATION_STATES, `balance_${index}_valuation_state`, "unknown"),
    observed_at: observedAt,
    expires_at: optionalTimestamp(input.expires_at || account.expires_at, `balance_${index}_expires_at`),
    provider: required(input.provider || account.provider, `balance_${index}_provider`),
    provider_health: required(input.provider_health || account.provider_health, `balance_${index}_provider_health`).toLowerCase(),
    native_gas: input.native_gas === true,
  };
}

function normalizePosition(input = {}, index, accountById) {
  const accountId = required(input.account_id, `position_${index}_account_id`);
  const account = accountById.get(accountId);
  if (!account) throw new Error(`position_${index}_account_missing`);
  const instrument = normalizeInstrumentIdentity(input.instrument || input.instrument_identity);
  if (instrument.chain_id !== account.chain_id || instrument.venue.venue_id !== account.venue_id) {
    throw new Error(`position_${index}_location_mismatch`);
  }
  const side = enumValue(input.side, POSITION_SIDES, `position_${index}_side`, "asset");
  const valuationState = enumValue(input.valuation_state, VALUATION_STATES, `position_${index}_valuation_state`, "unknown");
  return {
    position_id: required(input.position_id, `position_${index}_id`),
    economic_lot_id: required(input.economic_lot_id, `position_${index}_economic_lot_id`),
    account_id: accountId,
    chain_id: account.chain_id,
    venue_id: account.venue_id,
    instrument,
    instrument_id: instrument.instrument_id,
    underlying_asset_id: required(input.underlying_asset_id || instrument.underlying_asset_id || instrument.base_asset_id, `position_${index}_underlying_asset_id`),
    side,
    quantity_atomic: optionalAtomic(input.quantity_atomic, `position_${index}_quantity_atomic`),
    marked_value_usdc_micros: optionalAtomic(input.marked_value_usdc_micros, `position_${index}_marked_value`),
    executable_value_usdc_micros: optionalAtomic(input.executable_value_usdc_micros, `position_${index}_executable_value`),
    gross_exposure_usdc_micros: optionalAtomic(input.gross_exposure_usdc_micros, `position_${index}_gross_exposure`),
    valuation_state: valuationState,
    observed_at: timestamp(input.observed_at || account.observed_at, `position_${index}_observed_at`),
    provider: required(input.provider || account.provider, `position_${index}_provider`),
  };
}

function normalizeLiability(input = {}, index, accountById) {
  const accountId = required(input.account_id, `liability_${index}_account_id`);
  const account = accountById.get(accountId);
  if (!account) throw new Error(`liability_${index}_account_missing`);
  const asset = assetFrom(input.asset || input.asset_identity, `liability_${index}_asset`);
  if (asset.chain_id !== account.chain_id) throw new Error(`liability_${index}_location_mismatch`);
  return {
    liability_id: required(input.liability_id, `liability_${index}_id`),
    economic_lot_id: required(input.economic_lot_id, `liability_${index}_economic_lot_id`),
    account_id: accountId,
    chain_id: account.chain_id,
    venue_id: account.venue_id,
    asset,
    asset_id: asset.asset_id,
    amount_atomic: optionalAtomic(input.amount_atomic, `liability_${index}_amount_atomic`),
    marked_value_usdc_micros: optionalAtomic(input.marked_value_usdc_micros, `liability_${index}_marked_value`),
    executable_value_usdc_micros: optionalAtomic(input.executable_value_usdc_micros, `liability_${index}_executable_value`),
    valuation_state: enumValue(input.valuation_state, VALUATION_STATES, `liability_${index}_valuation_state`, "unknown"),
    observed_at: timestamp(input.observed_at || account.observed_at, `liability_${index}_observed_at`),
    provider: required(input.provider || account.provider, `liability_${index}_provider`),
  };
}

function deduplicateLatest(rows, keyName) {
  const selected = new Map();
  const removed = [];
  for (const row of rows) {
    const key = row.economic_lot_id;
    const existing = selected.get(key);
    if (!existing || Date.parse(row.observed_at) > Date.parse(existing.observed_at)) {
      if (existing) removed.push({ economic_lot_id: key, removed_id: existing[keyName] || existing.observation_id });
      selected.set(key, row);
    } else {
      removed.push({ economic_lot_id: key, removed_id: row[keyName] || row.observation_id });
    }
  }
  return { rows: [...selected.values()], removed };
}

function normalizeReservations(values = []) {
  return (Array.isArray(values) ? values : []).map((row, index) => ({
    reservation_id: required(row.reservation_id, `reservation_${index}_id`),
    plan_id: required(row.plan_id, `reservation_${index}_plan_id`),
    leg_id: required(row.leg_id, `reservation_${index}_leg_id`),
    chain_id: required(row.chain_id, `reservation_${index}_chain_id`),
    venue_id: required(row.venue_id, `reservation_${index}_venue_id`),
    asset_id: required(row.asset_id, `reservation_${index}_asset_id`),
    amount_atomic: normalizeAtomic(row.amount_atomic, `reservation_${index}_amount`, { allowZero: false }),
    state: required(row.state || "reserved", `reservation_${index}_state`).toLowerCase(),
  }));
}

function aggregateBalances(balances, reservations) {
  const rows = new Map();
  for (const balance of balances) {
    const key = capitalLocationKey(balance);
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(balance);
  }
  return [...rows.entries()].map(([key, components]) => {
    const availableComponents = components.filter((row) => row.state === "available" && row.available_atomic !== null);
    const observedAvailable = sumAtomic(availableComponents.map((row) => row.available_atomic));
    const reserved = sumAtomic(reservations
      .filter((row) => row.state === "reserved" && capitalLocationKey(row) === key)
      .map((row) => row.amount_atomic));
    const state = availableComponents.length ? "available" : components.some((row) => row.state === "stale") ? "stale" : components[0].state;
    return {
      chain_id: components[0].chain_id,
      venue_id: components[0].venue_id,
      asset_id: components[0].asset_id,
      state,
      available_atomic: state === "available" ? subtractFloor(observedAvailable, reserved) : null,
      observed_available_atomic: state === "available" ? observedAvailable : null,
      reserved_atomic: reserved,
      marked_value_usdc_micros: sumKnown(components.map((row) => row.marked_value_usdc_micros)),
      executable_value_usdc_micros: sumKnown(components.map((row) => row.executable_value_usdc_micros)),
      component_count: components.length,
      unresolved_component_count: components.filter((row) => row.state !== "available").length,
      latest_observed_at: [...components].sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))[0].observed_at,
    };
  }).sort((a, b) => capitalLocationKey(a).localeCompare(capitalLocationKey(b)));
}

function normalizePendingPlans(values = []) {
  return (Array.isArray(values) ? values : []).map((row, index) => {
    const state = required(row.state, `pending_plan_${index}_state`).toLowerCase();
    const legs = (Array.isArray(row.legs) ? row.legs : []).map((leg, legIndex) => ({
      leg_id: required(leg.leg_id, `pending_plan_${index}_leg_${legIndex}_id`),
      chain_id: required(leg.chain_id, `pending_plan_${index}_leg_${legIndex}_chain_id`),
      venue_id: required(leg.venue_id, `pending_plan_${index}_leg_${legIndex}_venue_id`),
      instrument_id: required(leg.instrument_id, `pending_plan_${index}_leg_${legIndex}_instrument_id`),
      status: required(leg.status, `pending_plan_${index}_leg_${legIndex}_status`).toLowerCase(),
      gross_exposure_usdc_micros: optionalAtomic(leg.gross_exposure_usdc_micros, `pending_plan_${index}_leg_${legIndex}_exposure`),
    }));
    return {
      plan_id: required(row.plan_id, `pending_plan_${index}_id`),
      state,
      legs,
      unresolved_required_legs: legs.filter((leg) => !new Set(["filled", "reconciled", "cancelled"]).has(leg.status)).map((leg) => leg.leg_id),
      partially_executed: state === "partially_executed" || (legs.some((leg) => leg.status === "filled") && legs.some((leg) => leg.status !== "filled")),
    };
  }).filter((row) => PLAN_STATES_WITH_EXPOSURE.has(row.state));
}

function sumExposure(rows, key, grouping) {
  const result = new Map();
  for (const row of rows) {
    const group = grouping(row);
    const value = row[key];
    const current = result.get(group);
    if (value === null || value === undefined || current === null) result.set(group, null);
    else result.set(group, (BigInt(current || "0") + BigInt(value)).toString());
  }
  return Object.fromEntries([...result.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export function createUnifiedPortfolioSnapshot(input = {}) {
  const observedAt = timestamp(input.observed_at, "portfolio_observed_at");
  const accounts = (Array.isArray(input.accounts) ? input.accounts : []).map(normalizeAccount);
  const accountById = new Map(accounts.map((row) => [row.account_id, row]));
  if (accountById.size !== accounts.length) throw new Error("portfolio_duplicate_account_id");
  const balanceDedupe = deduplicateLatest((Array.isArray(input.balances) ? input.balances : []).map((row, index) => normalizeBalance(row, index, accountById)), "observation_id");
  const positionDedupe = deduplicateLatest((Array.isArray(input.positions) ? input.positions : []).map((row, index) => normalizePosition(row, index, accountById)), "position_id");
  const liabilityDedupe = deduplicateLatest((Array.isArray(input.liabilities) ? input.liabilities : []).map((row, index) => normalizeLiability(row, index, accountById)), "liability_id");
  const reservations = normalizeReservations(input.reservations);
  const balances = aggregateBalances(balanceDedupe.rows, reservations);
  const pendingPlans = normalizePendingPlans(input.pending_plans);

  const assetMarked = sumKnown(balanceDedupe.rows.map((row) => row.marked_value_usdc_micros));
  const assetExecutable = sumKnown(balanceDedupe.rows.map((row) => row.executable_value_usdc_micros));
  const liabilityMarked = sumKnown(liabilityDedupe.rows.map((row) => row.marked_value_usdc_micros));
  const liabilityExecutable = sumKnown(liabilityDedupe.rows.map((row) => row.executable_value_usdc_micros));
  const grossExposure = sumKnown(positionDedupe.rows.map((row) => row.gross_exposure_usdc_micros));
  const pendingExposure = sumKnown(pendingPlans.flatMap((plan) => plan.legs.map((leg) => leg.gross_exposure_usdc_micros)));
  const materialUnknowns = [
    ...balanceDedupe.rows.filter((row) => row.valuation_state !== "executable").map((row) => `balance:${row.economic_lot_id}:${row.valuation_state}`),
    ...positionDedupe.rows.filter((row) => row.valuation_state !== "executable").map((row) => `position:${row.position_id}:${row.valuation_state}`),
    ...liabilityDedupe.rows.filter((row) => row.valuation_state !== "executable").map((row) => `liability:${row.liability_id}:${row.valuation_state}`),
  ];
  const core = {
    schema_version: AGENTIC_UNIFIED_PORTFOLIO_SCHEMA,
    snapshot_id: required(input.snapshot_id, "portfolio_snapshot_id"),
    owner_tenant_id: required(input.owner_tenant_id, "portfolio_owner_tenant_id"),
    observed_at: observedAt,
    accounting_currency: "USDC",
    accounts,
    balance_components: balanceDedupe.rows,
    balances,
    positions: positionDedupe.rows,
    liabilities: liabilityDedupe.rows,
    reservations,
    pending_plans: pendingPlans,
    valuation: {
      marked_assets_usdc_micros: assetMarked,
      executable_assets_usdc_micros: assetExecutable,
      marked_liabilities_usdc_micros: liabilityMarked,
      executable_liabilities_usdc_micros: liabilityExecutable,
      marked_net_equity_usdc_micros: assetMarked !== null && liabilityMarked !== null ? signedSubtract(assetMarked, liabilityMarked) : null,
      executable_net_equity_usdc_micros: assetExecutable !== null && liabilityExecutable !== null ? signedSubtract(assetExecutable, liabilityExecutable) : null,
      gross_exposure_usdc_micros: grossExposure,
      pending_plan_exposure_usdc_micros: pendingExposure,
      complete: materialUnknowns.length === 0,
    },
    exposure: {
      by_chain_usdc_micros: sumExposure(positionDedupe.rows, "gross_exposure_usdc_micros", (row) => row.chain_id),
      by_venue_usdc_micros: sumExposure(positionDedupe.rows, "gross_exposure_usdc_micros", (row) => row.venue_id),
      by_instrument_usdc_micros: sumExposure(positionDedupe.rows, "gross_exposure_usdc_micros", (row) => row.instrument_id),
      by_underlying_usdc_micros: sumExposure(positionDedupe.rows, "gross_exposure_usdc_micros", (row) => row.underlying_asset_id),
    },
    unresolved_conditions: materialUnknowns.sort(),
    deduplication: {
      balances_removed: balanceDedupe.removed,
      positions_removed: positionDedupe.removed,
      liabilities_removed: liabilityDedupe.removed,
      key: "economic_lot_id_latest_observation",
    },
    cross_chain_capital_immediately_transferable: false,
    autonomous_bridging_enabled: false,
    live_execution_enabled: false,
  };
  return freeze({ ...core, snapshot_hash: agenticContractHash(core) });
}

export function verifyUnifiedPortfolioSnapshot(snapshot) {
  if (!snapshot || snapshot.schema_version !== AGENTIC_UNIFIED_PORTFOLIO_SCHEMA) return { ok: false, error: "portfolio_schema_invalid" };
  const { snapshot_hash: hash, ...core } = snapshot;
  if (!hash || agenticContractHash(core) !== hash) return { ok: false, error: "portfolio_integrity_invalid" };
  return { ok: true, snapshot };
}

export function inspectLocalCapital(snapshot, input = {}) {
  const verified = verifyUnifiedPortfolioSnapshot(snapshot);
  if (!verified.ok) return freeze({ result: "indeterminate", reason: verified.error });
  const location = {
    chain_id: required(input.chain_id, "capital_chain_id"),
    venue_id: required(input.venue_id, "capital_venue_id"),
    asset_id: required(input.asset_id, "capital_asset_id"),
  };
  const requiredAtomic = normalizeAtomic(input.required_atomic, "capital_required_atomic");
  const row = snapshot.balances.find((balance) => capitalLocationKey(balance) === capitalLocationKey(location));
  if (!row || row.state !== "available" || row.available_atomic === null) {
    return freeze({ result: "indeterminate", reason: "local_capital_unavailable", location, required_atomic: requiredAtomic, available_atomic: null });
  }
  if (BigInt(row.available_atomic) < BigInt(requiredAtomic)) {
    return freeze({ result: "block", reason: "insufficient_local_capital", location, required_atomic: requiredAtomic, available_atomic: row.available_atomic });
  }
  if (input.gas) {
    const gas = inspectLocalCapital(snapshot, input.gas);
    if (gas.result !== "allow") return freeze({ ...gas, reason: gas.result === "block" ? "insufficient_native_gas" : "native_gas_unavailable", gas_location: gas.location });
  }
  return freeze({ result: "allow", reason: null, location, required_atomic: requiredAtomic, available_atomic: row.available_atomic });
}

export function projectPartialPlanExposure(snapshot, planId) {
  const verified = verifyUnifiedPortfolioSnapshot(snapshot);
  if (!verified.ok) throw new Error(verified.error);
  const plan = snapshot.pending_plans.find((row) => row.plan_id === String(planId || "").trim());
  if (!plan) return null;
  const filled = plan.legs.filter((row) => row.status === "filled");
  const unresolved = plan.legs.filter((row) => row.status !== "filled" && row.status !== "cancelled");
  return freeze({
    plan_id: plan.plan_id,
    state: plan.state,
    partially_executed: plan.partially_executed,
    filled_legs: filled.map((row) => row.leg_id),
    unresolved_legs: unresolved.map((row) => row.leg_id),
    resulting_gross_exposure_usdc_micros: sumKnown(filled.map((row) => row.gross_exposure_usdc_micros)),
    reconciliation_required: plan.state === "reconciliation_required" || plan.partially_executed,
    retry_or_unwind_requires_new_policy_decision: plan.partially_executed,
  });
}

export function cloneUnifiedPortfolioSnapshot(snapshot) {
  const verified = verifyUnifiedPortfolioSnapshot(snapshot);
  if (!verified.ok) throw new Error(verified.error);
  return clone(snapshot);
}
