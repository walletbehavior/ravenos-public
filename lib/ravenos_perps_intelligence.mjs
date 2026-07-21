export function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function clamp(value, min = 0, max = 100) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function finiteOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function changePercent(current, previous) {
  const currentValue = num(current);
  const previousValue = num(previous);
  if (!currentValue || !previousValue) return null;
  return Number((((currentValue - previousValue) / previousValue) * 100).toFixed(4));
}

function fundingPosture(funding) {
  const value = num(funding);
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

export function canonicalHyperliquidInstrument(symbol) {
  const coin = String(symbol || "").trim().toUpperCase().replace(/-PERP$/, "");
  return {
    coin,
    symbol: coin,
    asset: `${coin}-PERP`,
    instrument_id: `hyperliquid:perp:${coin}`,
    instrument_scope: "exact_instrument",
    market_type: "perpetual",
    venue: "hyperliquid",
  };
}

export function normalizeHyperliquidPerps(payload, { now = new Date() } = {}) {
  const universe = Array.isArray(payload?.[0]?.universe) ? payload[0].universe : [];
  const contexts = Array.isArray(payload?.[1]) ? payload[1] : [];
  const observedAt = now instanceof Date ? now.toISOString() : String(now);

  return universe.map((meta, index) => {
    const ctx = contexts[index] || {};
    const identity = canonicalHyperliquidInstrument(meta.name);
    const markPx = num(ctx.markPx || ctx.midPx || ctx.oraclePx);
    const midPx = finiteOrNull(ctx.midPx);
    const oraclePx = finiteOrNull(ctx.oraclePx);
    const funding = finiteOrNull(ctx.funding);
    const openInterest = finiteOrNull(ctx.openInterest);
    const openInterestUsd = openInterest === null || !markPx ? null : Number((openInterest * markPx).toFixed(2));
    const dayNotionalVolumeUsd = finiteOrNull(ctx.dayNtlVlm);
    const premium = finiteOrNull(ctx.premium);
    const previousDayPrice = finiteOrNull(ctx.prevDayPx);

    return {
      ...identity,
      market: "Perpetual Futures",
      category: "perpetuals",
      venue_label: "Hyperliquid",
      last_price: markPx || null,
      mark_price: markPx || null,
      mid_price: midPx,
      oracle_price: oraclePx,
      previous_day_price: previousDayPrice,
      day_change_pct: changePercent(markPx, previousDayPrice),
      funding_rate: funding,
      funding_posture: fundingPosture(funding),
      open_interest_base: openInterest,
      open_interest_usd: openInterestUsd,
      day_notional_volume_usd: dayNotionalVolumeUsd,
      day_base_volume: finiteOrNull(ctx.dayBaseVlm),
      premium,
      max_leverage: finiteOrNull(meta.maxLeverage),
      observed_at: observedAt,
      provider: "Hyperliquid public info endpoint",
      coverage: "live",
      freshness_state: "fresh",
      is_live: true,
      is_synthetic: false,
      evidence_join: "separate_public_raven_projection",

      // Temporary compatibility aliases for the protected chart and old clients.
      asset: identity.asset,
      symbol: identity.symbol,
      venue: "Hyperliquid",
      chainVenue: "Hyperliquid",
      lastPrice: markPx || null,
      markPx: markPx || null,
      midPx,
      oraclePx,
      prevDayPx: previousDayPrice,
      funding,
      openInterest,
      dayNtlVlm: dayNotionalVolumeUsd,
      dayBaseVlm: finiteOrNull(ctx.dayBaseVlm),
      basis: premium,
      maxLeverage: finiteOrNull(meta.maxLeverage),
      lastUpdated: observedAt,
      isLive: true,
      isCached: false,
      isSample: false,
    };
  }).filter((row) => row.symbol && Number(row.mark_price) > 0);
}
