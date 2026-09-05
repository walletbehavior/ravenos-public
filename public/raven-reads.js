(function () {
  const SCHEMA_VERSION = "1.0";
  const MODES = ["structure", "pressure", "participation", "replay", "risk"];
  const STATUS = ["forming", "active", "tested", "confirmed", "failed", "stale", "unavailable"];
  const FRESHNESS = ["fresh", "recovering", "backfilling", "degraded", "stale", "unavailable", "unknown"];
  const MODE_LABELS = {
    structure: "Structure",
    pressure: "Pressure",
    participation: "Participation",
    replay: "History",
    risk: "Risk",
  };
  const MODE_COLORS = {
    structure: "#8da6b8",
    pressure: "#c47a72",
    participation: "#68a585",
    replay: "#998bad",
    risk: "#c4a05c",
  };
  const BANNED = [/\balpha\b/i, /\bbuy\b/i, /\bsell\b/i, /\blong\s+now\b/i, /\bshort\s+now\b/i, /\bguaranteed\b/i, /\bsafe\s+trade\b/i, /\bfinancial\s+advice\b/i, /\bentry\b/i, /\bexit\b/i];

  function textHash(input) {
    let hash = 2166136261;
    const text = JSON.stringify(input, Object.keys(input || {}).sort());
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function confidenceFromScore(score) {
    const n = Number(score);
    if (!Number.isFinite(n)) return "low";
    if (n >= 76) return "high";
    if (n >= 58) return "medium";
    return "low";
  }

  function statusFromFreshness(freshnessState, fallback = "active") {
    if (freshnessState === "stale") return "stale";
    if (freshnessState === "unavailable") return "unavailable";
    if (["recovering", "backfilling", "degraded"].includes(freshnessState)) return "forming";
    return fallback;
  }

  function publicTextOk(value) {
    return !BANNED.some((pattern) => pattern.test(String(value || "")));
  }

  function zoneFromOverlay(overlay) {
    const zone = {};
    if (overlay.startTime) zone.start_time = String(overlay.startTime);
    if (overlay.endTime) zone.end_time = String(overlay.endTime);
    if (overlay.time) zone.start_time = String(overlay.time);
    if (overlay.priceMin !== undefined) zone.price_low = String(overlay.priceMin);
    if (overlay.priceMax !== undefined) zone.price_high = String(overlay.priceMax);
    if (overlay.price !== undefined) zone.anchor_price = String(overlay.price);
    if (zone.price_low && zone.price_high) zone.kind = "range";
    else if (zone.anchor_price) zone.kind = "level";
    else if (zone.start_time && zone.end_time) zone.kind = "window";
    else if (zone.start_time) zone.kind = "event";
    return Object.keys(zone).length ? zone : undefined;
  }

  function buildRead({ overlay, context, mode, title, shortLabel, plain, setup, edge, confirmation, failure, role, supporting, conflicting = [], warnings = [], freshnessState, confidence, confidenceScore, evidenceExtra = {} }) {
    const asset = context.asset || context.symbol || overlay.asset || "unknown";
    const market = context.market || overlay.market || overlay.metadata?.market || "unknown";
    const timeframe = context.timeframe || overlay.timeframe || "unknown";
    const score = confidenceScore !== undefined ? confidenceScore : Number.isFinite(Number(overlay.value)) ? Math.round(Number(overlay.value)) : undefined;
    const freshness = freshnessState || overlay.freshness_state || (/delayed/i.test(String(overlay.label || "")) ? "stale" : "fresh");
    const readConfidence = confidence || confidenceFromScore(score);
    const read = {
      schema_version: SCHEMA_VERSION,
      raven_read_id: `rr_${textHash({ asset, market, timeframe, id: overlay.id, mode, title })}`,
      source_overlay_id: overlay.id,
      asset: String(asset),
      market: String(market),
      venue: context.venue || overlay.venue,
      chain: context.chain || overlay.chain,
      timeframe: String(timeframe),
      mode,
      title,
      short_label: shortLabel,
      plain_english_read: plain,
      setup,
      edge,
      confirmation,
      failure,
      status: statusFromFreshness(freshness),
      confidence: readConfidence,
      confidence_score: score,
      freshness_state: freshness,
      observed_at: overlay.observed_at || overlay.observedAt,
      generated_at: overlay.generated_at || overlay.generatedAt || new Date(0).toISOString(),
      expires_at: overlay.expires_at || overlay.expiresAt,
      age_seconds: overlay.age_seconds,
      zone: zoneFromOverlay(overlay),
      evidence: [{
        source: String(overlay.source || "chart_overlay"),
        role,
        metric: overlay.metadata?.metric || overlay.type,
        value: score ?? overlay.value,
        unit: overlay.metadata?.unit || "score",
        sample_count: overlay.metadata?.sample_count,
        window: overlay.metadata?.window,
        freshness_state: freshness,
        confidence: readConfidence,
        evidence_id: overlay.metadata?.evidence_id,
        claim_id: overlay.metadata?.claim_id,
        public_safe: true,
        ...evidenceExtra,
      }],
      supporting_dimensions: supporting,
      conflicting_dimensions: conflicting,
      warnings,
      proof_refs: {
        evidence_id: overlay.metadata?.evidence_id,
        claim_id: overlay.metadata?.claim_id,
        outcome_id: overlay.metadata?.outcome_id,
        replay_id: overlay.metadata?.replay_id,
      },
      public_safe: true,
    };
    validateRavenRead(read);
    return read;
  }

  function finiteMeta(metadata, key) {
    return Number.isFinite(Number(metadata?.[key]));
  }

  function pressureBacking(metadata = {}, freshnessState = "unknown") {
    const hasProvider = metadata.pressure_score_source === "hyperliquid_perps" || /hyperliquid/i.test(String(metadata.provider || metadata.source || ""));
    const hasFunding = finiteMeta(metadata, "funding");
    const hasOpenInterest = finiteMeta(metadata, "open_interest") || finiteMeta(metadata, "oi_score");
    const hasBasis = finiteMeta(metadata, "basis") || finiteMeta(metadata, "premium");
    const hasMarkOracle = finiteMeta(metadata, "mark_px") && finiteMeta(metadata, "oracle_px");
    const hasSample = Number.isFinite(Number(metadata.sample_count)) && Number(metadata.sample_count) > 0;
    const stale = ["stale", "degraded", "unavailable", "unknown"].includes(freshnessState);
    const available = [hasProvider, hasFunding, hasOpenInterest, hasBasis, hasMarkOracle, hasSample].filter(Boolean).length;
    const score = Math.max(0, Math.min(100, available * 16 - (stale ? 18 : 0)));
    const confidence = stale || available < 3 ? "low" : available >= 5 ? "high" : "medium";
    return { hasProvider, hasFunding, hasOpenInterest, hasBasis, hasMarkOracle, hasSample, stale, available, score, confidence };
  }

  function pressureReadCopy(metadata = {}, freshnessState = "unknown", value = 0) {
    const backing = pressureBacking(metadata, freshnessState);
    const pressureScore = Number(value);
    const state = String(metadata.pressure_state || metadata.pressureContext || metadata.pressure_context || "").toLowerCase();
    const fresh = freshnessState === "fresh";
    let title = "Pressure context forming";
    if (backing.hasProvider && fresh && backing.hasFunding && backing.hasOpenInterest && pressureScore >= 78) title = "Squeeze watch";
    else if (backing.hasProvider && fresh && (state.includes("unstable") || state.includes("crowd") || (pressureScore >= 68 && backing.hasOpenInterest))) title = "Pressure conflict";

    const setupParts = ["Hyperliquid perps pressure is being read from current venue context"];
    if (backing.hasFunding) setupParts.push("funding is available");
    if (backing.hasOpenInterest) setupParts.push("open-interest context is available");
    if (backing.hasBasis || backing.hasMarkOracle) setupParts.push("mark/oracle relationship is available");

    const confirmation = ["Price holds the pressure zone", "Participation broadens before the read ages"];
    if (backing.hasOpenInterest) confirmation.unshift("Open-interest context continues to support the read");
    if (backing.hasFunding) confirmation.unshift("Funding context remains compatible with price behavior");

    const failure = ["Price loses the zone", "Participation narrows", "Pressure evidence becomes stale"];
    if (backing.hasOpenInterest) failure.unshift("Open-interest context stops supporting the read");
    if (backing.hasFunding) failure.unshift("Funding context normalizes without followthrough");

    const warnings = [];
    if (!backing.hasFunding || !backing.hasOpenInterest) warnings.push("One or more pressure components are unavailable; this read omits unsupported language.");
    if (!metadata.evidence_id && !metadata.public_artifact_ref) warnings.push("Evidence link not yet available.");
    if (backing.stale) warnings.push("Perps pressure source is not fresh.");

    return {
      title,
      shortLabel: title === "Pressure context forming" ? "Pressure forming" : title,
      plain: title === "Squeeze watch"
        ? "Hyperliquid pressure context is elevated while price is holding; Raven needs participation and survival confirmation before trusting followthrough."
        : title === "Pressure conflict"
          ? "Hyperliquid pressure context is active, but Raven is watching whether price behavior and participation confirm or reject the pressure."
          : "Pressure evidence is incomplete or still forming, so Raven is treating this as context rather than a strong read.",
      setup: `${setupParts.join(", ")}.`,
      edge: "Pressure context is useful only when it identifies what would confirm or weaken the read without turning it into an instruction.",
      confirmation,
      failure,
      warnings,
      confidence: backing.confidence,
      confidenceScore: backing.score,
      supporting: ["pressure", "hyperliquid_perps"].concat(backing.hasFunding ? ["funding_context"] : [], backing.hasOpenInterest ? ["open_interest_context"] : []),
      conflicting: backing.available < 4 ? ["partial pressure evidence"] : [],
    };
  }

  function sampleBacking(metadata = {}, freshnessState = "unknown") {
    const sample = Number(metadata.usable_sample ?? metadata.sample_count ?? metadata.observed_sample);
    const stale = ["stale", "degraded", "unavailable", "unknown"].includes(freshnessState);
    const hasSample = Number.isFinite(sample) && sample > 0;
    const sampleScore = hasSample ? Math.min(60, Math.log10(sample + 1) * 30) : 0;
    const availability = Object.values(metadata || {}).filter((value) => value !== undefined && value !== null && value !== "").length;
    const score = Math.round(Math.max(0, Math.min(100, sampleScore + Math.min(40, availability * 4) - (stale ? 25 : 0))));
    const confidence = stale || !hasSample ? "low" : sample >= 50 && availability >= 5 ? "high" : sample >= 8 ? "medium" : "low";
    return { sample, hasSample, stale, availability, score, confidence };
  }

  function participationReadCopy(metadata = {}, freshnessState = "unknown") {
    const backing = sampleBacking(metadata, freshnessState);
    const hasActorCount = finiteMeta(metadata, "actor_count") || finiteMeta(metadata, "wallet_count");
    const hasRepeatActors = finiteMeta(metadata, "repeat_actor_count");
    const hasConcentration = finiteMeta(metadata, "concentration_score") || finiteMeta(metadata, "outlier_dependency");
    const concentration = Number(metadata.concentration_score ?? metadata.outlier_dependency);
    const state = String(metadata.derived_state || metadata.avg_outcome || "").toLowerCase();
    const trend = String(metadata.trend || "").toLowerCase();
    let title = "Participation context forming";
    if (hasConcentration && concentration >= 70) title = "Outlier-dependent participation";
    else if (hasRepeatActors && Number(metadata.repeat_actor_count) > 0) title = "Repeat actors present";
    else if (backing.hasSample && /weak|punish|unclear|mixed/.test(state)) title = "Participation fragile";
    else if (backing.hasSample && /improv|broad|reward|stable/.test(`${trend} ${state}`)) title = "Participation broadening";
    const warnings = [];
    if (!hasActorCount) warnings.push("Actor count unavailable; this read does not claim actor breadth.");
    if (!hasRepeatActors) warnings.push("Repeat actor count unavailable; this read does not claim repeat actors.");
    if (!metadata.evidence_id && !metadata.claim_id && !metadata.public_artifact_ref) warnings.push("Evidence link not yet available.");
    if (backing.stale) warnings.push("Participation source is not fresh.");
    return {
      title,
      shortLabel: title === "Participation context forming" ? "Participation forming" : title,
      plain: title === "Outlier-dependent participation"
        ? "Participation evidence is concentrated, so Raven needs broader confirmation before treating the move as durable."
        : title === "Repeat actors present"
          ? "Repeat public participation is visible, but Raven still needs durability and outcome confirmation."
          : title === "Participation broadening"
            ? "Public participation evidence is broadening enough to monitor, but confirmation still depends on durability."
            : "Public participation evidence is partial or mixed, so Raven is treating the read as fragile context.",
      setup: "Public aggregate participation evidence is available.",
      edge: "Participation evidence helps separate durable attention from a thin or outlier-dependent move.",
      confirmation: ["Usable sample grows", "Public participation context remains compatible over the next window"],
      failure: ["Usable sample weakens", "Participation context becomes stale"],
      warnings,
      confidence: backing.confidence,
      confidenceScore: backing.score,
      supporting: ["participation", "public_behavior"].concat(hasActorCount ? ["actor_count"] : [], hasRepeatActors ? ["repeat_actors"] : [], hasConcentration ? ["concentration_context"] : []),
      conflicting: title.includes("fragile") || title.includes("Outlier") ? ["durability unproven"] : [],
    };
  }

  function replayReadCopy(metadata = {}, freshnessState = "unknown") {
    const backing = sampleBacking(metadata, freshnessState);
    const outcome = String(metadata.after_window_summary || metadata.outcome || "").toLowerCase();
    const hasOutcome = Boolean(outcome);
    const hasSimilarity = finiteMeta(metadata, "similarity_score");
    let title = "Historical memory unavailable";
    if (hasOutcome && /mixed/.test(outcome)) title = "Similar history is mixed";
    else if (hasOutcome && /favorable|reward/.test(outcome)) title = "Similar contexts rewarded continuation";
    else if (hasOutcome && /punish|unfavorable|failed|negative/.test(outcome)) title = "Similar contexts punished followthrough";
    else if (hasSimilarity || backing.hasSample) title = "Similar history is weak";
    const warnings = [];
    if (!hasOutcome) warnings.push("Historical outcome field unavailable; this read does not claim prior outcome.");
    if (!backing.hasSample) warnings.push("Comparable sample count unavailable; confidence remains low.");
    if (!metadata.evidence_id && !metadata.claim_id && !metadata.outcome_id && !metadata.replay_id && !metadata.public_artifact_ref) warnings.push("proof_ref unavailable");
    if (backing.stale) warnings.push("Historical source is not fresh.");
    return {
      title,
      shortLabel: title === "Historical memory unavailable" ? "History unavailable" : title === "Similar contexts rewarded continuation" ? "Favorable history" : title === "Similar contexts punished followthrough" ? "Unfavorable history" : title,
      plain: title === "Similar history is mixed"
        ? "Similar public contexts produced mixed followthrough, so current confirmation matters more than history alone."
        : title === "Similar contexts rewarded continuation"
          ? "Similar public contexts had favorable followthrough, but Raven still needs current confirmation."
          : title === "Similar contexts punished followthrough"
            ? "Similar public contexts weakened after the read, so Raven is treating followthrough as fragile."
            : "Historical evidence is incomplete or unavailable, so Raven is not treating it as confirmation.",
      setup: hasSimilarity ? "A measured historical comparable is linked to this context." : "Historical context is forming without a strong comparable.",
      edge: "Similar history helps identify what separated prior followthrough from failure without forecasting the current path.",
      confirmation: ["Current context keeps matching the comparable set", "Usable historical sample remains compatible"],
      failure: ["Current context diverges from the comparable set", "Historical sample remains weak or stale"],
      warnings,
      confidence: backing.confidence,
      confidenceScore: backing.score,
      supporting: ["replay", "public_memory"].concat(hasOutcome ? ["historical_outcome"] : [], hasSimilarity ? ["similarity"] : []),
      conflicting: title.includes("mixed") || title.includes("punished") ? ["historical followthrough not clean"] : [],
    };
  }

  function riskReadCopy(metadata = {}, freshnessState = "unknown") {
    const state = String(metadata.component_state || metadata.chart_freshness_state || freshnessState || "unknown").toLowerCase();
    const hasDepth = finiteMeta(metadata, "book_depth") || finiteMeta(metadata, "spread_bps");
    const hasDrag = finiteMeta(metadata, "execution_drag") || finiteMeta(metadata, "estimated_slippage");
    const sample = Number(metadata.usable_sample ?? metadata.sample_count);
    let title = "Confirmation missing";
    if (/stale/.test(state)) title = "Evidence stale";
    else if (/degraded|recovering|backfilling|unavailable|unknown/.test(state)) title = "Market data updating";
    else if (Number.isFinite(sample) && sample > 0 && sample < 8) title = "Weak sample";
    else if (hasDepth && (Number(metadata.spread_bps) > 50 || Number(metadata.book_depth) < 1)) title = "Thin book risk";
    else if (hasDrag && Number(metadata.execution_drag ?? metadata.estimated_slippage) > 0) title = "High execution drag";
    const warnings = [];
    if (!hasDepth) warnings.push("Live order-book depth is not available, so this read does not grade depth.");
    if (!hasDrag) warnings.push("Estimated trading cost is not available, so this read does not grade execution drag.");
    if (!metadata.evidence_id && !metadata.claim_id && !metadata.public_artifact_ref) warnings.push("Evidence link not yet available.");
    return {
      title,
      shortLabel: title,
      plain: title === "Evidence stale"
        ? "One or more public evidence sources are stale, so Raven is treating the current read as lower trust."
        : title === "Market data updating"
          ? "A market-data source is updating or unavailable; Raven needs fresh confirmation before strengthening the read."
          : title === "Weak sample"
            ? "The usable public sample is too small to support a stronger interpretation."
            : title === "Thin book risk"
              ? "Book or spread evidence indicates thinner conditions, so Raven is treating followthrough as fragile."
              : title === "High execution drag"
                ? "Available cost evidence indicates drag that could weaken practical followthrough."
                : "The chart has a visible context zone, but the required confirming evidence is not linked yet.",
      setup: metadata.component ? `Public risk context is linked to ${metadata.component}.` : "Risk context is based on public freshness, sample, and confirmation availability.",
      edge: "Risk reads are useful because they prevent Raven from overstating weak or stale evidence.",
      confirmation: ["Market data returns current", "Usable sample improves", "Missing confirmation evidence becomes available"],
      failure: ["Market data remains delayed", "Sample depth stays weak", "Risk evidence becomes more severe"],
      warnings,
      confidence: title === "Confirmation missing" ? "low" : "medium",
      confidenceScore: title === "Confirmation missing" ? 32 : 58,
      supporting: ["risk_context"].concat(metadata.component ? ["provider_health"] : [], hasDepth ? ["book_depth"] : [], hasDrag ? ["execution_drag"] : []),
      conflicting: ["confirmation incomplete"],
    };
  }

  function structureReadCopy(metadata = {}, freshnessState = "unknown", value = 0) {
    const candleCount = Number(metadata.candle_count);
    const hasCandles = Number.isFinite(candleCount) && candleCount > 0;
    const hasSurvival = finiteMeta(metadata, "survival_score") || Boolean(metadata.survival_context);
    const stale = ["stale", "degraded", "unavailable", "unknown"].includes(freshnessState);
    const compression = Number(value);
    const title = hasSurvival ? "Breakout survival unproven" : Number.isFinite(compression) && compression >= 70 ? "Compression forming" : "Reaction zone";
    const score = Math.max(0, Math.min(74, (hasCandles ? 38 : 18) + (hasSurvival ? 28 : 0) + (compression >= 70 ? 8 : 0) - (stale ? 18 : 0)));
    const confidence = stale || !hasCandles ? "low" : hasSurvival ? "medium" : "low";
    const warnings = [];
    if (!hasSurvival) warnings.push("Survival field unavailable; this read does not claim survival confirmation.");
    if (!metadata.liquidity_depth && !metadata.book_depth) warnings.push("Liquidity/depth field unavailable; this read is chart structure, not liquidity.");
    return {
      title,
      shortLabel: title === "Breakout survival unproven" ? "Survival unproven" : title,
      plain: hasSurvival
        ? "Structure is visible, but survival evidence still needs confirmation before Raven strengthens the read."
        : "The chart shows a structure zone from candles and range behavior; Raven needs non-price evidence before raising confidence.",
      setup: "Candle range and realized movement define the visible chart structure.",
      edge: "Structure helps focus attention on where confirmation or failure should appear next.",
      confirmation: hasSurvival ? ["Survival evidence improves", "Participation or pressure confirms the structure"] : ["Fresh non-price evidence confirms the zone", "The zone reacts without immediate failure"],
      failure: ["The zone fails without followthrough", "Chart evidence becomes stale", "Non-price evidence remains unavailable"],
      warnings,
      confidence,
      confidenceScore: Math.round(score),
      supporting: ["chart_structure"].concat(hasSurvival ? ["survival_context"] : []),
      conflicting: hasSurvival ? ["survival not yet confirmed"] : ["non-price evidence unavailable"],
    };
  }

  function technicalReadCopy(type, metadata = {}, freshnessState = "unknown") {
    const stale = ["stale", "degraded", "recovering", "backfilling", "unavailable", "unknown"].includes(freshnessState);
    const candleCount = Number(metadata.candle_count || metadata.sample_count || 0);
    const sampleReady = Number.isFinite(candleCount) && candleCount >= 24;
    if (type === "technical-macd-crossover") {
      const positive = metadata.direction === "positive";
      return {
        mode: "pressure",
        title: positive ? "Positive MACD cross" : "Negative MACD cross",
        shortLabel: positive ? "MACD +" : "MACD −",
        plain: `MACD crossed ${positive ? "above" : "below"} its signal line on a closed candle. This describes momentum, not direction certainty.`,
        setup: "The 12/26 MACD crossed its 9-period signal line using exact-market closed candles.",
        edge: "The timestamp marks where measured trend momentum changed direction.",
        confirmation: ["The histogram expands in the same direction on later closed candles", "Price structure remains aligned"],
        failure: ["MACD crosses back through its signal line", "Price structure diverges from momentum"],
        warnings: ["A MACD cross can reverse quickly in a range."],
        confidence: stale || !sampleReady ? "low" : "medium",
        confidenceScore: stale || !sampleReady ? 38 : 62,
        supporting: ["closed_candles", "macd_crossover"],
        conflicting: [],
        role: "live_market_context",
      };
    }
    if (type === "technical-accumulation-zone") {
      return {
        mode: "participation",
        title: "Accumulation-shaped range",
        shortLabel: "Accumulation watch",
        plain: "Price compressed while closed-candle volume and range position stayed constructive. This is not proof of wallet accumulation.",
        setup: "A bounded candle range, upper-range closes, and constructive volume overlap in the current window.",
        edge: "The zone makes a quiet build-up visible without treating it as confirmed participant intent.",
        confirmation: ["The range holds while participation persists", "Price leaves the range with stronger closed-candle volume"],
        failure: ["Price closes below the range", "Constructive volume fades", "The range expands without directional resolution"],
        warnings: ["Candle shape cannot identify who is accumulating."],
        confidence: stale || !sampleReady ? "low" : "medium",
        confidenceScore: stale || !sampleReady ? 36 : 64,
        supporting: ["closed_candles", "range_contraction", "volume_shape"],
        conflicting: ["participant identity unavailable"],
        role: "live_market_context",
      };
    }
    const ratio = Number(metadata.ratio);
    const ratioLabel = ratio === 0.5 ? "50%" : Number.isFinite(ratio) ? `${(ratio * 100).toFixed(1)}%` : "retracement";
    return {
      mode: "structure",
      title: "Fibonacci retracement reference",
      shortLabel: `Fib ${ratioLabel}`,
      plain: `The ${ratioLabel} level is measured between two confirmed swing pivots. It is a reference, not predicted support or resistance.`,
      setup: "Raven measured the latest qualified closed-candle swing and plotted its retracement levels.",
      edge: "The reference makes reactions around a widely watched part of the prior swing easier to inspect.",
      confirmation: ["Price reacts at the level on closed candles", "Participation or momentum independently confirms the reaction"],
      failure: ["Price passes through the level without a reaction", "A newer confirmed swing replaces the anchors"],
      warnings: ["Fibonacci levels are geometric references, not standalone evidence."],
      confidence: "low",
      confidenceScore: stale ? 28 : 44,
      supporting: ["closed_candles", "confirmed_swing_pivots"],
      conflicting: ["predictive evidence unavailable"],
      role: "live_market_context",
    };
  }

  function validateRavenRead(read) {
    if (!read || typeof read !== "object") throw new Error("Raven Read must be an object");
    if (read.schema_version !== SCHEMA_VERSION) throw new Error("Invalid Raven Read schema_version");
    if (!read.title || !read.short_label || !read.plain_english_read) throw new Error("Raven Read missing required user copy");
    if (!MODES.includes(read.mode)) throw new Error(`Invalid Raven Read mode: ${read.mode}`);
    if (!STATUS.includes(read.status)) throw new Error(`Invalid Raven Read status: ${read.status}`);
    if (!FRESHNESS.includes(read.freshness_state)) throw new Error(`Invalid Raven Read freshness: ${read.freshness_state}`);
    if (read.public_safe !== true) throw new Error("Raven Read must be public safe");
    if (!Array.isArray(read.confirmation) || !read.confirmation.length) throw new Error("Raven Read requires confirmation path");
    if (!Array.isArray(read.failure) || !read.failure.length) throw new Error("Raven Read requires failure path");
    if (!Array.isArray(read.evidence) || !read.evidence.every((item) => item.public_safe === true)) throw new Error("Raven Read evidence must be public safe");
    const text = JSON.stringify(read);
    if (!publicTextOk(text)) throw new Error("Raven Read contains banned public language");
    return read;
  }

  function translateOverlayToRavenRead(overlay, context = {}) {
    const type = String(overlay?.type || "").replace(/_/g, "-");
    const delayed = /delayed/i.test(String(overlay?.label || ""));
    const freshnessState = overlay.freshness_state || (delayed ? "stale" : "fresh");
    const value = Number(overlay?.value || 0);

    if (["technical-macd-crossover", "technical-accumulation-zone", "technical-fibonacci-level"].includes(type)) {
      const copy = technicalReadCopy(type, overlay.metadata || {}, freshnessState);
      return buildRead({
        overlay, context, mode: copy.mode, role: copy.role, freshnessState,
        title: copy.title,
        shortLabel: copy.shortLabel,
        plain: copy.plain,
        setup: copy.setup,
        edge: copy.edge,
        confirmation: copy.confirmation,
        failure: copy.failure,
        supporting: copy.supporting,
        conflicting: copy.conflicting,
        warnings: copy.warnings,
        confidence: copy.confidence,
        confidenceScore: copy.confidenceScore,
        evidenceExtra: {
          observed_at: overlay.observed_at || overlay.observedAt,
          evidence_scope: overlay.metadata?.evidence_scope,
          overlay_key: overlay.metadata?.overlay_key,
        },
      });
    }

    if (type === "pressure-zone") {
      const pressureCopy = pressureReadCopy(overlay.metadata || {}, freshnessState, overlay.value);
      return buildRead({
        overlay, context, mode: "pressure", role: "leading_read", freshnessState,
        title: pressureCopy.title,
        shortLabel: pressureCopy.shortLabel,
        plain: pressureCopy.plain,
        setup: pressureCopy.setup,
        edge: pressureCopy.edge,
        confirmation: pressureCopy.confirmation,
        failure: pressureCopy.failure,
        supporting: pressureCopy.supporting,
        conflicting: pressureCopy.conflicting,
        warnings: delayed ? ["Evidence is delayed; treat as stale context.", ...pressureCopy.warnings] : pressureCopy.warnings,
        confidence: pressureCopy.confidence,
        confidenceScore: pressureCopy.confidenceScore,
        evidenceExtra: {
          public_artifact_ref: overlay.metadata?.public_artifact_ref,
          observed_at: overlay.observed_at || overlay.observedAt,
        },
      });
    }

    if (type === "compression-band") {
      const structureCopy = structureReadCopy(overlay.metadata || {}, freshnessState, overlay.value);
      return buildRead({
        overlay, context, mode: "structure", role: "live_market_context", freshnessState,
        title: structureCopy.title,
        shortLabel: structureCopy.shortLabel,
        plain: structureCopy.plain,
        setup: structureCopy.setup,
        edge: structureCopy.edge,
        confirmation: structureCopy.confirmation,
        failure: structureCopy.failure,
        supporting: structureCopy.supporting,
        conflicting: structureCopy.conflicting,
        warnings: structureCopy.warnings,
        confidence: structureCopy.confidence,
        confidenceScore: structureCopy.confidenceScore,
        evidenceExtra: { public_artifact_ref: overlay.metadata?.public_artifact_ref },
      });
    }

    if (type === "breadth-line") {
      const participationCopy = participationReadCopy(overlay.metadata || {}, freshnessState);
      return buildRead({
        overlay, context, mode: "participation", role: "leading_read", freshnessState,
        title: participationCopy.title,
        shortLabel: participationCopy.shortLabel,
        plain: participationCopy.plain,
        setup: participationCopy.setup,
        edge: participationCopy.edge,
        confirmation: participationCopy.confirmation,
        failure: participationCopy.failure,
        supporting: participationCopy.supporting,
        conflicting: value < 55 ? ["sample breadth weak", ...participationCopy.conflicting] : participationCopy.conflicting,
        warnings: participationCopy.warnings,
        confidence: participationCopy.confidence,
        confidenceScore: participationCopy.confidenceScore,
        evidenceExtra: { public_artifact_ref: overlay.metadata?.public_artifact_ref },
      });
    }

    if (type === "history-window") {
      const replayCopy = replayReadCopy(overlay.metadata || {}, freshnessState);
      return buildRead({
        overlay, context, mode: "replay", role: "historical_replay", freshnessState,
        title: replayCopy.title,
        shortLabel: replayCopy.shortLabel,
        plain: replayCopy.plain,
        setup: replayCopy.setup,
        edge: replayCopy.edge,
        confirmation: replayCopy.confirmation,
        failure: replayCopy.failure,
        supporting: replayCopy.supporting,
        conflicting: replayCopy.conflicting,
        warnings: ["Similar history is context, not a forecast.", ...replayCopy.warnings],
        confidence: replayCopy.confidence,
        confidenceScore: replayCopy.confidenceScore,
        evidenceExtra: { public_artifact_ref: overlay.metadata?.public_artifact_ref },
      });
    }

    if (type === "liquidity-zone") {
      const riskCopy = riskReadCopy(overlay.metadata || {}, freshnessState);
      return buildRead({
        overlay, context, mode: "risk", role: "risk_context", freshnessState,
        title: riskCopy.title,
        shortLabel: riskCopy.shortLabel,
        plain: riskCopy.plain,
        setup: riskCopy.setup,
        edge: riskCopy.edge,
        confirmation: riskCopy.confirmation,
        failure: riskCopy.failure,
        supporting: riskCopy.supporting,
        conflicting: riskCopy.conflicting,
        warnings: riskCopy.warnings,
        confidence: riskCopy.confidence,
        confidenceScore: riskCopy.confidenceScore,
        evidenceExtra: { public_artifact_ref: overlay.metadata?.public_artifact_ref },
      });
    }

    if (type === "participant-shift") {
      const shift = String(overlay.metadata?.participantShiftType || overlay.label || "").toLowerCase();
      const concentrated = /distribution|concentration/.test(shift);
      return buildRead({
        overlay, context, mode: concentrated ? "risk" : "participation", role: "leading_read", freshnessState,
        title: concentrated ? "Outlier-dependent move" : "Participation broadening",
        shortLabel: concentrated ? "Top-heavy" : "Participation",
        plain: concentrated ? "Activity is becoming concentrated; confirmation needs broader participation." : "Participant behavior is improving, but durability still needs confirmation.",
        setup: "Raven sees a change in who is participating in the current chart window.",
        edge: "Actor composition helps distinguish durable attention from thin bursts.",
        confirmation: ["Repeat participants remain active", "Breadth improves", "Concentration stays controlled"],
        failure: ["Participation narrows", "Move depends on fewer actors", "Prior active participants fade"],
        supporting: ["participation", "actor_context"],
        conflicting: concentrated ? ["concentration risk"] : [],
      });
    }

    return buildRead({
      overlay: { ...overlay, value: overlay?.value ?? 0 }, context, mode: "risk", role: "risk_context", freshnessState: freshnessState === "fresh" ? "unknown" : freshnessState,
      title: "Confirmation missing",
      shortLabel: "Needs proof",
      plain: "Raven can display this context, but the evidence is not strong enough for a specific read.",
      setup: "A chart overlay exists without enough recognized evidence to classify it strongly.",
      edge: "Weak context is useful when it prevents overconfidence.",
      confirmation: ["Fresh compatible evidence appears", "Source context becomes identifiable"],
      failure: ["Evidence remains weak", "Provider context becomes stale"],
      supporting: ["unknown_overlay"],
      warnings: ["Weak Raven Read classification."],
    });
  }

  function translateOverlaysToRavenReads(overlays, context = {}) {
    return (Array.isArray(overlays) ? overlays : []).map((overlay) => translateOverlayToRavenRead(overlay, context));
  }

  window.RavenReads = { SCHEMA_VERSION, MODE_LABELS, MODE_COLORS, validateRavenRead, translateOverlayToRavenRead, translateOverlaysToRavenReads };
})();
