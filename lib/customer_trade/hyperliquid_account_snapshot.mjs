export const HYPERLIQUID_ACCOUNT_SNAPSHOT_SCHEMA = "ravenos.hyperliquid_account_snapshot.v1";

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const MAX_POSITIONS = 100;
const MAX_OPEN_ORDERS = 100;
const MAX_FILLS = 100;
const MAX_BALANCES = 100;

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

export function normalizeHyperliquidAddress(value) {
  const address = String(value || "").trim();
  return EVM_ADDRESS_RE.test(address) ? address.toLowerCase() : null;
}

function normalizeBalance(balance = {}) {
  const asset = text(balance.coin, 32);
  const total = finite(balance.total);
  const hold = finite(balance.hold);
  if (!asset || total === null) return null;
  return {
    asset,
    total: rounded(total),
    on_hold: rounded(hold) ?? 0,
    available: rounded(Math.max(0, total - (hold ?? 0))),
    entry_notional_usdc: rounded(balance.entryNtl),
  };
}

function normalizeSummary(clearinghouse = {}, balances = []) {
  const margin = clearinghouse.marginSummary && typeof clearinghouse.marginSummary === "object"
    ? clearinghouse.marginSummary
    : {};
  const cross = clearinghouse.crossMarginSummary && typeof clearinghouse.crossMarginSummary === "object"
    ? clearinghouse.crossMarginSummary
    : {};
  const accountValue = finite(margin.accountValue);
  const positionNotional = finite(margin.totalNtlPos);
  const marginUsed = finite(margin.totalMarginUsed);
  const spotUsdc = balances.find((balance) => balance.asset === "USDC") || null;
  return {
    account_value_usdc: rounded(accountValue),
    withdrawable_usdc: rounded(clearinghouse.withdrawable),
    position_notional_usdc: rounded(positionNotional),
    margin_used_usdc: rounded(marginUsed),
    maintenance_margin_usdc: rounded(clearinghouse.crossMaintenanceMarginUsed),
    margin_utilization_ratio: accountValue > 0 && marginUsed !== null ? rounded(marginUsed / accountValue, 8) : null,
    account_leverage: accountValue > 0 && positionNotional !== null ? rounded(positionNotional / accountValue, 8) : null,
    cash_balance_usdc: rounded(margin.totalRawUsd),
    cross_account_value_usdc: rounded(cross.accountValue),
    cross_margin_used_usdc: rounded(cross.totalMarginUsed),
    cross_maintenance_margin_used_usdc: rounded(clearinghouse.crossMaintenanceMarginUsed),
    spot_usdc_total: spotUsdc?.total ?? null,
    spot_usdc_available: spotUsdc?.available ?? null,
  };
}

function normalizePosition(entry = {}) {
  const position = entry.position && typeof entry.position === "object" ? entry.position : entry;
  const signedSize = finite(position.szi);
  if (signedSize === null || signedSize === 0) return null;
  const leverage = position.leverage && typeof position.leverage === "object" ? position.leverage : {};
  const funding = position.cumFunding && typeof position.cumFunding === "object"
    ? position.cumFunding
    : position.cumulativeFunding && typeof position.cumulativeFunding === "object"
      ? position.cumulativeFunding
      : {};
  return {
    market: text(position.coin, 48),
    side: signedSize > 0 ? "long" : "short",
    size: rounded(Math.abs(signedSize)),
    signed_size: rounded(signedSize),
    entry_price: rounded(position.entryPx),
    mark_notional_usdc: rounded(position.positionValue),
    unrealized_pnl_usdc: rounded(position.unrealizedPnl),
    return_on_equity: rounded(position.returnOnEquity),
    liquidation_price: rounded(position.liquidationPx),
    margin_used_usdc: rounded(position.marginUsed),
    leverage: rounded(leverage.value, 4),
    leverage_mode: text(leverage.type, 20).toLowerCase() || null,
    maximum_leverage: rounded(position.maxLeverage, 4),
    funding: {
      since_open_usdc: rounded(funding.sinceOpen),
      since_change_usdc: rounded(funding.sinceChange),
      all_time_usdc: rounded(funding.allTime),
    },
  };
}

function normalizeOrder(order = {}) {
  const signedSize = finite(order.sz);
  const side = String(order.side || "").toUpperCase() === "B" ? "buy" : String(order.side || "").toUpperCase() === "A" ? "sell" : null;
  if (!text(order.coin, 48) || signedSize === null || !side) return null;
  return {
    market: text(order.coin, 48),
    side,
    size: rounded(Math.abs(signedSize)),
    original_size: rounded(Math.abs(finite(order.origSz) ?? signedSize)),
    limit_price: rounded(order.limitPx),
    trigger_price: rounded(order.triggerPx),
    order_type: text(order.orderType, 40) || (order.isTrigger ? "Trigger" : "Limit"),
    time_in_force: text(order.tif, 12).toLowerCase() || null,
    reduce_only: Boolean(order.reduceOnly),
    is_trigger: Boolean(order.isTrigger),
    placed_at: timestamp(order.timestamp),
  };
}

function normalizeFill(fill = {}) {
  const size = finite(fill.sz);
  const side = String(fill.side || "").toUpperCase() === "B" ? "buy" : String(fill.side || "").toUpperCase() === "A" ? "sell" : null;
  if (!text(fill.coin, 48) || size === null || !side) return null;
  return {
    market: text(fill.coin, 48),
    side,
    direction: text(fill.dir, 48) || null,
    size: rounded(Math.abs(size)),
    price: rounded(fill.px),
    closed_pnl_usdc: rounded(fill.closedPnl),
    fee_paid: rounded(fill.fee),
    fee_asset: text(fill.feeToken, 20) || null,
    liquidity: fill.crossed === true ? "taker" : fill.crossed === false ? "maker" : null,
    filled_at: timestamp(fill.time),
  };
}

function byNewest(left, right, key) {
  return Date.parse(right?.[key] || 0) - Date.parse(left?.[key] || 0);
}

export function createHyperliquidAccountSnapshot(input = {}, { observedAt = new Date().toISOString() } = {}) {
  const address = normalizeHyperliquidAddress(input.address);
  if (!address) throw new Error("invalid_hyperliquid_address");
  const clearinghouse = input.clearinghouse && typeof input.clearinghouse === "object" ? input.clearinghouse : {};
  const spotState = input.spotState && typeof input.spotState === "object" ? input.spotState : {};
  const balances = (Array.isArray(spotState.balances) ? spotState.balances : [])
    .map(normalizeBalance)
    .filter(Boolean)
    .slice(0, MAX_BALANCES);
  const positions = (Array.isArray(clearinghouse.assetPositions) ? clearinghouse.assetPositions : [])
    .map(normalizePosition)
    .filter(Boolean)
    .slice(0, MAX_POSITIONS);
  const openOrders = (Array.isArray(input.openOrders) ? input.openOrders : [])
    .map(normalizeOrder)
    .filter(Boolean)
    .sort((left, right) => byNewest(left, right, "placed_at"))
    .slice(0, MAX_OPEN_ORDERS);
  const fills = (Array.isArray(input.fills) ? input.fills : [])
    .map(normalizeFill)
    .filter(Boolean)
    .sort((left, right) => byNewest(left, right, "filled_at"))
    .slice(0, MAX_FILLS);
  const funding = positions
    .filter((position) => Object.values(position.funding).some((value) => value !== null))
    .map((position) => ({ market: position.market, side: position.side, ...position.funding }));
  const summary = normalizeSummary(clearinghouse, balances);
  const hasValue = Object.values(summary).some((value) => value !== null && value !== 0);

  return {
    ok: true,
    schema_version: HYPERLIQUID_ACCOUNT_SNAPSHOT_SCHEMA,
    state: hasValue || positions.length || openOrders.length || fills.length ? "observed" : "empty",
    observed_at: timestamp(observedAt) || new Date().toISOString(),
    venue: "hyperliquid",
    account: {
      address,
      address_source: "viewer_supplied_public_address",
      ownership_asserted: false,
      persisted: false,
    },
    summary: {
      ...summary,
      position_count: positions.length,
      open_order_count: openOrders.length,
      recent_fill_count: fills.length,
    },
    positions,
    balances,
    open_orders: openOrders,
    fills,
    funding,
    privacy: {
      address_persisted: false,
      transaction_hashes_exposed: false,
      provider_order_ids_exposed: false,
    },
    execution_boundary: {
      public_account_observation_only: true,
      wallet_connected: false,
      signing_available: false,
      submission_available: false,
    },
  };
}
