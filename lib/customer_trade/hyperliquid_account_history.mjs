import { normalizeHyperliquidAddress } from "./hyperliquid_account_snapshot.mjs";

export const HYPERLIQUID_ACCOUNT_HISTORY_SCHEMA = "ravenos.hyperliquid_account_history.v1";

const MAX_HISTORY_ROWS = 100;

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rounded(value, digits = 10) {
  const number = finite(value);
  return number === null ? null : Number(number.toFixed(digits));
}

function text(value, maxLength = 80) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function timestamp(value) {
  const milliseconds = finite(value);
  if (milliseconds !== null && milliseconds > 0) return new Date(milliseconds).toISOString();
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeHistoricalOrder(entry = {}) {
  const order = entry.order && typeof entry.order === "object" ? entry.order : entry;
  const market = text(order.coin, 48);
  const sideCode = String(order.side || "").toUpperCase();
  const side = sideCode === "B" ? "buy" : sideCode === "A" ? "sell" : null;
  const originalSize = finite(order.origSz ?? order.sz);
  const remainingSize = finite(order.sz);
  if (!market || !side || originalSize === null) return null;
  const status = text(entry.status || order.status, 40).toLowerCase().replace(/[^a-z0-9_-]+/g, "_") || "recorded";
  return {
    market,
    side,
    original_size: rounded(Math.abs(originalSize)),
    remaining_size: rounded(Math.abs(remainingSize ?? 0)),
    filled_size: rounded(Math.max(0, Math.abs(originalSize) - Math.abs(remainingSize ?? 0))),
    limit_price: rounded(order.limitPx),
    trigger_price: rounded(order.triggerPx),
    order_type: text(order.orderType, 40) || (order.isTrigger ? "Trigger" : "Limit"),
    time_in_force: text(order.tif, 12).toLowerCase() || null,
    reduce_only: Boolean(order.reduceOnly),
    is_trigger: Boolean(order.isTrigger),
    status,
    status_at: timestamp(entry.statusTimestamp ?? entry.timestamp ?? order.timestamp),
  };
}

export function createHyperliquidAccountHistory(input = {}, { observedAt = new Date().toISOString() } = {}) {
  const address = normalizeHyperliquidAddress(input.address);
  if (!address) throw new Error("invalid_hyperliquid_address");
  const orders = (Array.isArray(input.historicalOrders) ? input.historicalOrders : [])
    .map(normalizeHistoricalOrder)
    .filter(Boolean)
    .sort((left, right) => Date.parse(right.status_at || 0) - Date.parse(left.status_at || 0))
    .slice(0, MAX_HISTORY_ROWS);
  return {
    ok: true,
    schema_version: HYPERLIQUID_ACCOUNT_HISTORY_SCHEMA,
    state: orders.length ? "observed" : "empty",
    observed_at: timestamp(observedAt) || new Date().toISOString(),
    venue: "hyperliquid",
    account: {
      address,
      address_source: "viewer_supplied_public_address",
      ownership_asserted: false,
      persisted: false,
    },
    orders,
    privacy: {
      address_persisted: false,
      transaction_hashes_exposed: false,
      provider_order_ids_exposed: false,
    },
    execution_boundary: {
      public_account_observation_only: true,
      cancellation_available: false,
      signing_available: false,
      submission_available: false,
    },
  };
}
