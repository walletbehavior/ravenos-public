import { createEvidenceBoundPlanPreview } from "./customer_trade/suggested_plan.mjs";

function normalizeInstrument(value) {
  const coin = String(value || "").trim().toUpperCase().replace(/-PERP$/, "");
  return /^[A-Z0-9][A-Z0-9._:-]{0,31}$/.test(coin) ? `${coin}-PERP` : null;
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isoSeconds(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? Math.trunc(parsed / 1_000) : null;
}

function liquidityOverlay({ context, marketPayload, side }) {
  const levels = Array.isArray(marketPayload?.book?.[side]) ? marketPayload.book[side].slice(0, 5) : [];
  const prices = levels.map((row) => finite(row?.price)).filter((value) => value !== null && value > 0);
  if (!context?.instrument_id || !prices.length) return null;
  const notional = levels.reduce((total, row) => total + Math.max(0, finite(row?.notional_usd) || 0), 0);
  const observedAt = marketPayload?.book?.observed_at
    || marketPayload?.tape?.summary?.newest_trade_at
    || marketPayload?.generated_at
    || context.observed_at;
  const isBid = side === "bids";
  return {
    schema_version: "ravenos.chart_overlay.v1",
    id: `${context.instrument_id}:book:${isBid ? "bid" : "ask"}`,
    instrument_id: context.instrument_id,
    type: "liquidity-zone",
    label: `Visible ${isBid ? "bid" : "ask"} liquidity`,
    summary: `${notional.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} is visible across the nearest ${prices.length} ${isBid ? "bid" : "ask"} levels.`,
    severity: isBid ? "success" : "warning",
    priceMin: Math.min(...prices),
    priceMax: Math.max(...prices),
    observed_at: observedAt,
    freshness_state: "live",
    lineage: {
      source: "hyperliquid_live_book",
      instrument_id: context.instrument_id,
      public_context_id: context.public_context_id || null,
    },
    inspection: {
      source_evidence: {
        label: `Current visible Hyperliquid ${isBid ? "bid" : "ask"} book`,
        observed_at: observedAt,
      },
      support: [`${prices.length} exact price levels · ${notional.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} visible notional.`],
      contradiction: ["Visible book liquidity can move or be cancelled before an order reaches the venue."],
      path_transition: {
        behavior: "Visible liquidity",
        pressure: isBid ? "Bid support" : "Ask resistance",
        observed_side: isBid ? "long" : "short",
        state: "current_market_fact",
      },
      historical_outcome: { sample_size: 0 },
      evidence_maturity: "current_market_fact",
    },
  };
}

function planLevelOverlay({ plan, type, level, label, severity }) {
  const price = finite(level?.price);
  const startTime = isoSeconds(plan?.as_of);
  if (!plan?.plan_id || !(price > 0) || startTime === null) return null;
  return {
    schema_version: "ravenos.chart_overlay.v1",
    id: `${plan.plan_id}:${type}`,
    instrument_id: plan.instrument_id,
    type,
    label,
    summary: level.source,
    severity,
    priceMin: price,
    priceMax: price,
    startTime,
    observed_at: plan.as_of,
    freshness_state: "historical",
    lineage: {
      public_context_id: plan.frozen_context_id,
      plan_id: plan.plan_id,
      instrument_id: plan.instrument_id,
    },
    inspection: {
      source_evidence: {
        label,
        observed_at: plan.as_of,
        public_reference: plan.frozen_context_id,
      },
      support: [`${plan.sample_size} future-only same-instrument paths · ${String(plan.evidence_maturity || "forming").replaceAll("_", " ")} evidence.`],
      contradiction: ["Historical excursion references are not orders and may not describe the current path."],
      path_transition: {
        behavior: "Research plan reference",
        pressure: plan.direction,
        observed_side: plan.direction,
        state: "research_only",
      },
      historical_outcome: {
        sample_size: plan.sample_size,
        favorable_excursion_pct: plan.levels?.target_reference?.excursion_pct ?? null,
        adverse_excursion_pct: plan.levels?.risk_reference?.excursion_pct ?? null,
      },
      evidence_maturity: plan.evidence_maturity,
    },
  };
}

export function buildPerpChartOverlays({ context = {}, marketPayload = {}, planPreview = null } = {}) {
  if (!context?.instrument_id) return [];
  const overlays = [
    liquidityOverlay({ context, marketPayload, side: "bids" }),
    liquidityOverlay({ context, marketPayload, side: "asks" }),
  ].filter(Boolean);
  if (planPreview?.state === "research_only" && planPreview.levels) {
    overlays.push(
      planLevelOverlay({
        plan: planPreview,
        type: "plan-entry",
        level: planPreview.levels.entry_reference,
        label: "Decision reference",
        severity: "info",
      }),
      planLevelOverlay({
        plan: planPreview,
        type: "plan-target",
        level: planPreview.levels.target_reference,
        label: "Historical favorable reference",
        severity: "success",
      }),
      planLevelOverlay({
        plan: planPreview,
        type: "plan-risk",
        level: planPreview.levels.risk_reference,
        label: "Historical adverse reference",
        severity: "danger",
      }),
    );
  }
  return overlays.filter(Boolean);
}

function signedPercent(value, digits = 2) {
  const number = finite(value);
  if (number === null) return "";
  return `${number >= 0 ? "+" : ""}${number.toFixed(Math.abs(number) < 0.1 ? 3 : digits)}%`;
}

function compactUsd(value) {
  const number = finite(value);
  if (number === null || number < 0) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(number);
}

function levelNotional(level = {}) {
  const exact = finite(level.notional_usd);
  if (exact !== null && exact >= 0) return exact;
  const price = finite(level.price);
  const size = finite(level.size);
  return price !== null && size !== null && price > 0 && size >= 0 ? price * size : 0;
}

function sideNotional(rows = []) {
  return (Array.isArray(rows) ? rows : []).reduce((sum, row) => sum + levelNotional(row), 0);
}

function newestTimestamp(values = []) {
  return values
    .map((value) => ({ value, time: Date.parse(value || "") }))
    .filter((row) => Number.isFinite(row.time))
    .sort((left, right) => right.time - left.time)[0]?.value || null;
}

function signal(value, threshold) {
  const number = finite(value);
  if (number === null || Math.abs(number) < threshold) return 0;
  return number > 0 ? 1 : -1;
}

export function buildLivePerpRead({ marketPayload = {}, instrument = "" } = {}) {
  const exactInstrument = normalizeInstrument(instrument || marketPayload?.instrument?.asset || marketPayload?.instrument?.symbol);
  const market = marketPayload?.market || {};
  if (!exactInstrument || !market || typeof market !== "object") return null;

  const mark = finite(market.mark_price ?? market.markPx ?? market.last_price ?? market.lastPrice);
  const oracle = finite(market.oracle_price ?? market.oraclePx);
  const previous = finite(market.previous_day_price ?? market.prevDayPx);
  const change24h = finite(market.day_change_pct) ?? (
    mark !== null && mark > 0 && previous !== null && previous > 0
      ? ((mark / previous) - 1) * 100
      : null
  );
  const funding = finite(market.funding_rate ?? market.funding);
  const openInterestUsd = finite(market.open_interest_usd) ?? (
    finite(market.open_interest_base ?? market.openInterest) !== null && mark !== null
      ? finite(market.open_interest_base ?? market.openInterest) * mark
      : null
  );
  const volume24h = finite(market.day_notional_volume_usd ?? market.dayNtlVlm);
  const premiumBps = mark !== null && oracle !== null && oracle > 0
    ? ((mark - oracle) / oracle) * 10_000
    : finite(market.premium) !== null ? finite(market.premium) * 10_000 : null;

  const book = marketPayload?.book || {};
  const bookSummary = book.summary || {};
  const bidNotional = finite(bookSummary.bid_notional_usd) ?? sideNotional(book.bids);
  const askNotional = finite(bookSummary.ask_notional_usd) ?? sideNotional(book.asks);
  const visibleNotional = bidNotional + askNotional;
  const bookImbalance = finite(bookSummary.imbalance_pct) ?? (
    visibleNotional > 0 ? ((bidNotional - askNotional) / visibleNotional) * 100 : null
  );
  const bestBid = finite(bookSummary.best_bid ?? book.bids?.[0]?.price);
  const bestAsk = finite(bookSummary.best_ask ?? book.asks?.[0]?.price);
  const mid = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null;
  const spreadBps = finite(bookSummary.spread_bps) ?? (
    mid !== null && mid > 0 && bestAsk >= bestBid ? ((bestAsk - bestBid) / mid) * 10_000 : null
  );

  const tape = marketPayload?.tape || {};
  const trades = Array.isArray(tape.trades) ? tape.trades : [];
  const buyNotional = finite(tape.summary?.bid_side_notional_usd) ?? trades
    .filter((row) => row.book_side === "bid")
    .reduce((sum, row) => sum + Math.max(0, finite(row.notional_usd) || levelNotional(row)), 0);
  const sellNotional = finite(tape.summary?.ask_side_notional_usd) ?? trades
    .filter((row) => row.book_side === "ask")
    .reduce((sum, row) => sum + Math.max(0, finite(row.notional_usd) || levelNotional(row)), 0);
  const tapeNotional = buyNotional + sellNotional;
  const buyShare = tapeNotional > 0 ? buyNotional / tapeNotional : null;
  const tapeImbalance = buyShare === null ? null : (buyShare - 0.5) * 200;
  const tradeCount = Math.max(0, Math.trunc(finite(tape.summary?.trade_count) ?? trades.length));

  const inputs = {
    price: change24h !== null,
    funding: funding !== null,
    positioning: openInterestUsd !== null || volume24h !== null,
    book: visibleNotional > 0 && bookImbalance !== null,
    tape: tapeNotional > 0 && tradeCount > 0,
    basis: premiumBps !== null,
  };
  const inputCount = Object.values(inputs).filter(Boolean).length;
  if (!inputCount || mark === null || mark <= 0) return null;

  const priceSignal = signal(change24h, 0.35);
  const bookSignal = signal(bookImbalance, 8);
  const tapeSignal = signal(tapeImbalance, 10);
  const basisSignal = signal(premiumBps, 2);
  const primarySignals = [priceSignal, bookSignal, tapeSignal].filter(Boolean);
  const upSignals = primarySignals.filter((value) => value > 0).length;
  const downSignals = primarySignals.filter((value) => value < 0).length;
  const flowSignal = bookSignal + tapeSignal;
  const flowDivergence = priceSignal !== 0 && flowSignal !== 0 && Math.sign(priceSignal) !== Math.sign(flowSignal);
  const directionalScore = (priceSignal * 1.2) + bookSignal + (tapeSignal * 1.1) + (basisSignal * 0.35);
  const directionalBias = flowDivergence
    ? "neutral"
    : upSignals >= 2 && directionalScore > 0 ? "long"
      : downSignals >= 2 && directionalScore < 0 ? "short" : "neutral";
  const fundingCrowding = funding !== null && Math.abs(funding) >= 0.0001
    ? funding > 0 ? "longs_paying" : "shorts_paying"
    : "balanced";

  let signalState = "balanced";
  let setupLabel = "Two-sided / no clean edge";
  if (flowDivergence) {
    signalState = "flow_divergence";
    setupLabel = "Price / flow divergence";
  } else if (directionalBias === "long") {
    signalState = fundingCrowding === "shorts_paying" ? "upside_squeeze_pressure" : "upside_confirmed";
    setupLabel = fundingCrowding === "shorts_paying" ? "Upside squeeze pressure" : "Upside pressure confirmed";
  } else if (directionalBias === "short") {
    signalState = fundingCrowding === "longs_paying" ? "downside_flush_pressure" : "downside_confirmed";
    setupLabel = fundingCrowding === "longs_paying" ? "Downside flush pressure" : "Downside pressure confirmed";
  } else if (fundingCrowding !== "balanced") {
    signalState = "funding_crowding";
    setupLabel = fundingCrowding === "longs_paying" ? "Long crowding watch" : "Short crowding watch";
  }

  const flowLabel = bookSignal > 0 && tapeSignal > 0
    ? "Bid depth + buyer tape"
    : bookSignal < 0 && tapeSignal < 0 ? "Ask depth + seller tape"
      : bookSignal && tapeSignal ? "Book / tape split"
        : bookSignal > 0 ? "Bid depth leading"
          : bookSignal < 0 ? "Ask depth leading"
            : tapeSignal > 0 ? "Buyer tape leading"
              : tapeSignal < 0 ? "Seller tape leading" : "Two-sided flow";
  const alignedSignals = Math.max(upSignals, downSignals);
  const evidenceScore = Math.round(Math.min(99, 34 + inputCount * 7 + alignedSignals * 7 + (flowDivergence ? 3 : 0)));
  const evidenceGrade = evidenceScore >= 82 ? "A" : evidenceScore >= 68 ? "B" : evidenceScore >= 52 ? "C" : "D";
  const observedAt = newestTimestamp([
    tape.summary?.newest_trade_at,
    book.observed_at,
    marketPayload.generated_at,
    market.observed_at,
  ]) || new Date().toISOString();

  const factSummary = [
    change24h === null ? "" : `${signedPercent(change24h)} 24h`,
    bookImbalance === null ? "" : `${Math.abs(bookImbalance).toFixed(0)}% ${bookImbalance >= 0 ? "bid" : "ask"} depth skew`,
    buyShare === null ? "" : `${Math.round(buyShare * 100)}% buyer-initiated tape`,
    funding === null ? "" : `${signedPercent(funding * 100, 4)} funding`,
    openInterestUsd === null ? "" : `${compactUsd(openInterestUsd)} OI`,
  ].filter(Boolean);
  const why = flowDivergence
    ? "Price direction and current Hyperliquid flow disagree, so Raven is treating continuation as unconfirmed."
    : directionalBias === "long"
      ? `Current price, visible depth, and recent trade flow lean upward${fundingCrowding === "shorts_paying" ? " while shorts pay funding" : ""}.`
      : directionalBias === "short"
        ? `Current price, visible depth, and recent trade flow lean downward${fundingCrowding === "longs_paying" ? " while longs pay funding" : ""}.`
        : fundingCrowding !== "balanced"
          ? `${fundingCrowding === "longs_paying" ? "Longs" : "Shorts"} are paying elevated funding without enough aligned price and flow confirmation.`
          : "Current Hyperliquid price, visible depth, and recent trade flow do not yet align into a directional edge.";
  const strengthen = directionalBias === "long"
    ? ["Buyer-initiated tape remains above 55% while bid depth holds.", "Price extends without funding becoming one-sided."]
    : directionalBias === "short"
      ? ["Seller-initiated tape remains above 55% while ask depth holds.", "Price weakens without short funding becoming one-sided."]
      : ["Price, visible depth, and recent tape align in the same direction.", "Open interest expands with usable spread and persistent flow."];
  const weaken = directionalBias === "long"
    ? ["Buyer tape loses the majority or visible bids pull.", "Price rolls over while long funding becomes crowded."]
    : directionalBias === "short"
      ? ["Seller tape loses the majority or visible asks pull.", "Price recovers while short funding becomes crowded."]
      : ["Book and tape remain split after price expands.", "Spread widens or current flow thins out."];

  return {
    schema_version: "ravenos.perp_live_read.v1",
    role: "live_market_read",
    state: inputCount >= 4 ? "current" : "partial",
    source: "hyperliquid_public_api",
    instrument_id: `hyperliquid:perp:${exactInstrument.replace(/-PERP$/, "")}`,
    instrument: exactInstrument,
    observed_at: observedAt,
    signal_state: signalState,
    directional_bias: directionalBias,
    setup_label: setupLabel,
    flow_label: flowLabel,
    headline: `${exactInstrument} · ${setupLabel}`,
    summary: factSummary.join(" · "),
    why_raven_noticed: why,
    what_would_strengthen: strengthen,
    what_would_weaken: weaken,
    evidence_score: evidenceScore,
    evidence_grade: evidenceGrade,
    input_count: inputCount,
    input_total: Object.keys(inputs).length,
    inputs,
    market_facts: {
      price_change_24h_pct: change24h,
      funding_rate: funding,
      open_interest_usd: openInterestUsd,
      volume_24h_usd: volume24h,
      premium_bps: premiumBps,
      spread_bps: spreadBps,
      visible_book_imbalance_pct: bookImbalance,
      visible_book_notional_usd: visibleNotional > 0 ? visibleNotional : null,
      recent_buy_share: buyShare,
      recent_trade_count: tradeCount,
    },
    research_only: true,
    actionable: false,
    signing_available: false,
    submission_available: false,
  };
}

function matchingTableRows(tables, instrument) {
  if (!tables || typeof tables !== "object") return [];
  const rows = [];
  for (const [table, values] of Object.entries(tables)) {
    if (!Array.isArray(values)) continue;
    for (const row of values) {
      if (String(row?.symbol || "").toUpperCase() !== instrument) continue;
      rows.push({ table, ...row });
    }
  }
  return rows;
}

function availableContext(instrument) {
  return {
    instrument_id: `hyperliquid:perp:${instrument.replace(/-PERP$/, "")}`,
    instrument,
    context_available: false,
    context_state: "unavailable",
    context_age_seconds: null,
    observed_at: null,
    observed_side: "unavailable",
    behavior_family: null,
    pressure_state: null,
    entry_reference: { price: null, observed_at: null, source: "unavailable" },
    friction_context: { state: "unavailable", roundtrip_bps: null, measurement_only: true },
    why_raven_noticed: "No current decision-time Raven observation is available for this instrument.",
    outcomes: {
      sample_size: 0,
      evidence_maturity: "forming",
      median_observed_change_pct: null,
      median_favorable_excursion_pct: null,
      median_adverse_excursion_pct: null,
      positive_followthrough_rate: null,
      matured_through: null,
    },
    plan_preview: {
      state: "unavailable",
      production_qualified: false,
      personalized: false,
      executable: false,
      note: "No current Raven read is available for this instrument.",
    },
  };
}

function readText(context) {
  if (!context.context_available) {
    return {
      state: "unavailable",
      headline: `${context.instrument} · Raven context unavailable`,
      summary: "Live market data remains available, but Raven has no current observation for this instrument.",
      why_raven_noticed: context.why_raven_noticed,
      what_would_strengthen: ["A new decision-time observation with complete market and friction evidence."],
      what_would_weaken: [],
    };
  }
  const sample = Number(context.outcomes?.sample_size || 0);
  const direction = context.observed_side === "long" ? "upside" : context.observed_side === "short" ? "downside" : "directional";
  const sampleText = sample
    ? `${sample} matured comparable path${sample === 1 ? "" : "s"} are available.`
    : "Matured same-instrument comparables are not yet available.";
  return {
    state: context.context_state,
    headline: `${context.instrument} · ${context.behavior_family || "Raven observation"}`,
    summary: `${context.pressure_state || "Mixed pressure"} accompanied a timestamped ${direction} research observation. ${sampleText}`,
    why_raven_noticed: context.why_raven_noticed,
    what_would_strengthen: [
      "The observed pressure structure persists while market depth remains usable.",
      "More future-only paths mature without concentrating in one episode.",
    ],
    what_would_weaken: [
      "The decision-time structure fades or reverses.",
      "Book friction rises or outcome coverage remains thin.",
    ],
  };
}

export function buildPerpTerminalContext({ publicPerpsPayload, marketPayload, symbol } = {}) {
  const instrument = normalizeInstrument(symbol);
  if (!instrument) return { ok: false, error: "invalid_instrument" };
  const perpsData = publicPerpsPayload?.data && typeof publicPerpsPayload.data === "object"
    ? publicPerpsPayload.data
    : {};
  const contextRows = Array.isArray(perpsData.instrument_context?.rows)
    ? perpsData.instrument_context.rows
    : [];
  const context = contextRows.find((row) => String(row?.instrument || "").toUpperCase() === instrument)
    || availableContext(instrument);
  const tableContext = matchingTableRows(perpsData.tables, instrument);
  const historicalRead = readText(context);
  const liveRead = buildLivePerpRead({ marketPayload, instrument });
  const read = liveRead || historicalRead;
  const planPreview = createEvidenceBoundPlanPreview(context);
  const chartOverlays = buildPerpChartOverlays({ context, marketPayload, planPreview });
  const chartEvent = context.context_available && context.observed_at
    ? {
        schema_version: "ravenos.chart_event.v1",
        event_id: context.public_context_id,
        instrument_id: context.instrument_id,
        event_type: "raven_decision_context",
        observed_at: context.observed_at,
        label: context.behavior_family || "Raven observation",
        state: context.context_state,
        lineage: { public_context_id: context.public_context_id },
        inspection: {
          source_evidence: {
            label: context.behavior_family || "Timestamped Raven observation",
            observed_at: context.observed_at,
            public_reference: context.public_context_id,
          },
          support: historicalRead.what_would_strengthen,
          contradiction: historicalRead.what_would_weaken,
          path_transition: {
            behavior: context.behavior_family || null,
            pressure: context.pressure_state || null,
            observed_side: context.observed_side || "unavailable",
            state: context.context_state,
          },
          historical_outcome: {
            sample_size: Number(context.outcomes?.sample_size || 0),
            median_change_pct: context.outcomes?.median_observed_change_pct ?? null,
            favorable_excursion_pct: context.outcomes?.median_favorable_excursion_pct ?? null,
            adverse_excursion_pct: context.outcomes?.median_adverse_excursion_pct ?? null,
            matured_through: context.outcomes?.matured_through || null,
          },
          evidence_maturity: context.outcomes?.evidence_maturity || "forming",
        },
      }
    : null;
  return {
    ok: Boolean(marketPayload?.ok || publicPerpsPayload),
    schema_version: "ravenos.perp_terminal_context.v1",
    generated_at: new Date().toISOString(),
    instrument: {
      instrument_id: context.instrument_id,
      instrument,
      symbol: instrument.replace(/-PERP$/, ""),
      venue: "hyperliquid",
      market_type: "perpetual",
      instrument_scope: "exact_instrument",
    },
    market_data: marketPayload || {
      ok: false,
      components: { market: "unavailable", book: "unavailable", tape: "unavailable" },
    },
    raven_context: context,
    live_market_read: liveRead,
    raven_read: read,
    decision_history_read: context.context_available ? historicalRead : null,
    current_path: {
      behavior_family: liveRead?.setup_label || context.behavior_family,
      pressure_state: liveRead?.flow_label || context.pressure_state,
      observed_side: liveRead?.directional_bias || context.observed_side,
      context_state: liveRead?.state || context.context_state,
    },
    matured_comparables: context.outcomes,
    plan_preview: planPreview,
    chart_event: chartEvent,
    chart_overlays: {
      schema_version: "ravenos.chart_overlays.v1",
      instrument_id: context.instrument_id,
      role: "annotation_only",
      candle_replacement_allowed: false,
      overlays: chartOverlays,
    },
    public_market_rows: tableContext,
    execution: {
      mode: "read_only",
      quote_preview_available: false,
      signing_available: false,
      submission_available: false,
      position_monitoring_available: false,
    },
  };
}
