const DEFAULT_MINIMUM_CANDLE_WINDOW_SECONDS = 600;
const DEFAULT_PRICE_CONTINUITY_TOLERANCE_BPS = 10;

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function onchainCandleFreshnessWindow(intervalSeconds) {
  const interval = finite(intervalSeconds);
  return Math.max(
    DEFAULT_MINIMUM_CANDLE_WINDOW_SECONDS,
    interval && interval > 0 ? interval * 2 : 0,
  );
}

export function classifyOnchainMarketState({
  providerRequestSucceeded = false,
  lastCandleAgeSeconds = null,
  intervalSeconds = null,
  lastCandleClose = null,
  snapshotPrice = null,
  transactions24h = null,
  priceContinuityToleranceBps = DEFAULT_PRICE_CONTINUITY_TOLERANCE_BPS,
} = {}) {
  const candleAge = finite(lastCandleAgeSeconds);
  const threshold = onchainCandleFreshnessWindow(intervalSeconds);
  const candleClose = finite(lastCandleClose);
  const currentPrice = finite(snapshotPrice);
  const transactions = finite(transactions24h);
  const tolerance = Math.max(0, finite(priceContinuityToleranceBps) ?? DEFAULT_PRICE_CONTINUITY_TOLERANCE_BPS);
  const priceDeltaBps = candleClose !== null && candleClose > 0 && currentPrice !== null && currentPrice > 0
    ? Math.abs((currentPrice / candleClose) - 1) * 10_000
    : null;
  const priceContinuityState = priceDeltaBps === null
    ? "unavailable"
    : priceDeltaBps <= tolerance
      ? "verified"
      : "changed_after_last_candle";
  const candleRecencyState = candleAge === null
    ? "unavailable"
    : candleAge <= threshold
      ? "current"
      : "delayed";
  const providerDeliveryState = providerRequestSucceeded ? "current" : "unavailable";
  const snapshotState = providerRequestSucceeded && currentPrice !== null && currentPrice > 0
    ? "current"
    : "unavailable";

  let marketActivityState = "unavailable";
  if (transactions === 0) {
    marketActivityState = "no_recent_trades";
  } else if (candleRecencyState === "current") {
    marketActivityState = "active";
  } else if (candleRecencyState === "delayed" && priceContinuityState === "verified") {
    marketActivityState = "no_recent_trades";
  } else if (transactions !== null && transactions > 0) {
    marketActivityState = "activity_reported_chart_lagging";
  }

  const chartState = candleRecencyState === "current"
    ? "current"
    : providerDeliveryState === "current"
      && candleRecencyState === "delayed"
      && priceContinuityState === "verified"
        ? "current_no_recent_trades"
        : candleRecencyState;
  const operatorLabel = chartState === "current"
    ? "Current"
    : chartState === "current_no_recent_trades"
      ? "No recent txns"
      : chartState === "delayed"
        ? "Chart delayed"
        : "Chart unavailable";

  return {
    schema_version: "ravenos.onchain_market_state.v1",
    provider_delivery_state: providerDeliveryState,
    market_snapshot_state: snapshotState,
    candle_recency_state: candleRecencyState,
    market_activity_state: marketActivityState,
    chart_state: chartState,
    operator_label: operatorLabel,
    last_candle_age_seconds: candleAge,
    candle_freshness_window_seconds: threshold,
    price_continuity_state: priceContinuityState,
    snapshot_to_candle_delta_bps: priceDeltaBps,
    transactions_24h: transactions,
  };
}
