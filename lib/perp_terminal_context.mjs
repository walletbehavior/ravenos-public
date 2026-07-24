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
  if (context?.context_available !== true || !context?.instrument_id) return [];
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
  const read = readText(context);
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
          support: read.what_would_strengthen,
          contradiction: read.what_would_weaken,
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
    raven_read: read,
    current_path: {
      behavior_family: context.behavior_family,
      pressure_state: context.pressure_state,
      observed_side: context.observed_side,
      context_state: context.context_state,
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
