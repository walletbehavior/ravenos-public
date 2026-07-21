function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoFromMillis(value) {
  const millis = finite(value);
  if (millis === null) return null;
  const date = new Date(millis);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function normalizeHyperliquidCoin(value) {
  const coin = String(value || "").trim().toUpperCase().replace(/-PERP$/, "");
  return /^[A-Z0-9][A-Z0-9._:-]{0,31}$/.test(coin) ? coin : null;
}

function normalizeLevel(level) {
  const price = finite(level?.px);
  const size = finite(level?.sz);
  const orderCount = finite(level?.n);
  if (price === null || size === null || price <= 0 || size < 0) return null;
  return {
    price,
    size,
    order_count: orderCount === null ? null : Math.max(0, Math.trunc(orderCount)),
    notional_usd: Number((price * size).toFixed(2)),
  };
}

export function normalizeHyperliquidBook(payload, { maxLevels = 20 } = {}) {
  const coin = normalizeHyperliquidCoin(payload?.coin);
  const rawLevels = Array.isArray(payload?.levels) ? payload.levels : [];
  const bids = (Array.isArray(rawLevels[0]) ? rawLevels[0] : []).map(normalizeLevel).filter(Boolean).slice(0, maxLevels);
  const asks = (Array.isArray(rawLevels[1]) ? rawLevels[1] : []).map(normalizeLevel).filter(Boolean).slice(0, maxLevels);
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : null;
  const spreadBps = mid && bestAsk >= bestBid ? ((bestAsk - bestBid) / mid) * 10_000 : null;
  const bidNotional = bids.reduce((sum, level) => sum + level.notional_usd, 0);
  const askNotional = asks.reduce((sum, level) => sum + level.notional_usd, 0);
  const totalNotional = bidNotional + askNotional;
  return {
    coin,
    observed_at: isoFromMillis(payload?.time),
    bids,
    asks,
    summary: {
      best_bid: bestBid,
      best_ask: bestAsk,
      mid_price: mid === null ? null : Number(mid.toFixed(10)),
      spread_bps: spreadBps === null ? null : Number(spreadBps.toFixed(4)),
      bid_notional_usd: Number(bidNotional.toFixed(2)),
      ask_notional_usd: Number(askNotional.toFixed(2)),
      imbalance_pct: totalNotional
        ? Number((((bidNotional - askNotional) / totalNotional) * 100).toFixed(2))
        : null,
      levels_per_side: Math.max(bids.length, asks.length),
    },
  };
}

export function normalizeHyperliquidTrades(payload, { maxTrades = 40 } = {}) {
  const rows = (Array.isArray(payload) ? payload : []).slice(0, maxTrades).map((trade) => {
    const coin = normalizeHyperliquidCoin(trade?.coin);
    const price = finite(trade?.px);
    const size = finite(trade?.sz);
    if (!coin || price === null || size === null || price <= 0 || size < 0) return null;
    const sideCode = String(trade?.side || "").toUpperCase();
    return {
      coin,
      observed_at: isoFromMillis(trade?.time),
      side_code: sideCode === "A" || sideCode === "B" ? sideCode : null,
      book_side: sideCode === "A" ? "ask" : sideCode === "B" ? "bid" : "unknown",
      price,
      size,
      notional_usd: Number((price * size).toFixed(2)),
    };
  }).filter(Boolean);
  const askNotional = rows.filter((row) => row.book_side === "ask").reduce((sum, row) => sum + row.notional_usd, 0);
  const bidNotional = rows.filter((row) => row.book_side === "bid").reduce((sum, row) => sum + row.notional_usd, 0);
  return {
    trades: rows,
    summary: {
      trade_count: rows.length,
      bid_side_count: rows.filter((row) => row.book_side === "bid").length,
      ask_side_count: rows.filter((row) => row.book_side === "ask").length,
      bid_side_notional_usd: Number(bidNotional.toFixed(2)),
      ask_side_notional_usd: Number(askNotional.toFixed(2)),
      newest_trade_at: rows[0]?.observed_at || null,
    },
    privacy: {
      participant_addresses_removed: true,
      transaction_hashes_removed: true,
      provider_trade_ids_removed: true,
    },
  };
}
