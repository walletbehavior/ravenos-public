import { createHash } from "node:crypto";

export const RAVEN_READ_SCHEMA_VERSION = "1.0";

export const RAVEN_READ_MODES = ["structure", "pressure", "participation", "replay", "risk"];
export const RAVEN_READ_STATUSES = ["forming", "active", "tested", "confirmed", "failed", "stale", "unavailable"];
export const RAVEN_READ_CONFIDENCE = ["low", "medium", "high"];
export const RAVEN_READ_FRESHNESS = ["fresh", "recovering", "backfilling", "degraded", "stale", "unavailable", "unknown"];
export const EVIDENCE_ROLES = ["leading_read", "settled_validation", "historical_replay", "live_market_context", "risk_context"];

const BANNED_PUBLIC_LANGUAGE = [
  /\balpha\b/i,
  /\bbuy\b/i,
  /\bsell\b/i,
  /\blong\s+now\b/i,
  /\bshort\s+now\b/i,
  /\bguaranteed\b/i,
  /\bsafe\s+trade\b/i,
  /\bhigh\s+conviction\s+trade\b/i,
  /\bfinancial\s+advice\b/i,
  /\bentry\b/i,
  /\bexit\b/i,
];

const PRIMARY_LABEL_DRIFT = new Set([
  "Reward/Punish",
  "Expansion Path",
  "Participation Quality",
  "Outcome Memory",
  "Regime",
  "Volatility",
  "Breadth",
  "Liquidity",
]);

function fail(message) {
  throw new Error(message);
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasBannedLanguage(value) {
  return BANNED_PUBLIC_LANGUAGE.some((pattern) => pattern.test(String(value || "")));
}

function scanText(value, path = "read") {
  if (typeof value === "string") {
    if (hasBannedLanguage(value)) fail(`Banned public Raven Read language at ${path}: ${value}`);
    return;
  }
  if (Array.isArray(value)) value.forEach((item, index) => scanText(item, `${path}[${index}]`));
  else if (isPlainObject(value)) Object.entries(value).forEach(([key, item]) => scanText(item, `${path}.${key}`));
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]));
}

export function canonicalSerializeRavenRead(read) {
  return JSON.stringify(stableObject(read));
}

export function ravenReadHash(read) {
  return createHash("sha256").update(canonicalSerializeRavenRead(read)).digest("hex");
}

export function ravenReadId(seed) {
  return `rr_${createHash("sha256").update(canonicalSerializeRavenRead(seed)).digest("hex").slice(0, 20)}`;
}

export function confidenceFromScore(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return "low";
  if (n >= 76) return "high";
  if (n >= 58) return "medium";
  return "low";
}

export function statusFromFreshness(freshnessState, fallback = "active") {
  if (freshnessState === "stale") return "stale";
  if (freshnessState === "unavailable") return "unavailable";
  if (freshnessState === "degraded" || freshnessState === "recovering" || freshnessState === "backfilling") return "forming";
  return fallback;
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
  if (!metadata.evidence_id && !metadata.public_artifact_ref) warnings.push("evidence_ref unavailable");
  if (backing.stale) warnings.push("Perps pressure source is not fresh.");

  return {
    title,
    shortLabel: title === "Pressure context forming" ? "Pressure forming" : title,
    plainEnglish: title === "Squeeze watch"
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
  const observed = Number(metadata.observed_sample ?? metadata.sample_count);
  const stale = ["stale", "degraded", "unavailable", "unknown"].includes(freshnessState);
  const hasSample = Number.isFinite(sample) && sample > 0;
  const sampleScore = hasSample ? Math.min(60, Math.log10(sample + 1) * 30) : 0;
  const availability = Object.values(metadata || {}).filter((value) => value !== undefined && value !== null && value !== "").length;
  const score = Math.round(Math.max(0, Math.min(100, sampleScore + Math.min(40, availability * 4) - (stale ? 25 : 0))));
  const confidence = stale || !hasSample ? "low" : sample >= 50 && availability >= 5 ? "high" : sample >= 8 ? "medium" : "low";
  return { sample, observed, hasSample, stale, availability, score, confidence };
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

  const setupParts = ["Public aggregate participation evidence is available"];
  if (hasActorCount) setupParts.push("actor count is linked");
  if (hasRepeatActors) setupParts.push("repeat actor count is linked");
  if (hasConcentration) setupParts.push("concentration context is linked");

  const confirmation = ["Usable sample grows", "Public participation context remains compatible over the next window"];
  if (hasActorCount) confirmation.unshift("Actor breadth improves");
  if (hasRepeatActors) confirmation.unshift("Repeat actors remain visible");

  const failure = ["Usable sample weakens", "Participation context becomes stale"];
  if (hasConcentration) failure.unshift("Concentration remains elevated");

  const warnings = [];
  if (!hasActorCount) warnings.push("Actor count unavailable; this read does not claim actor breadth.");
  if (!hasRepeatActors) warnings.push("Repeat actor count unavailable; this read does not claim repeat actors.");
  if (!metadata.evidence_id && !metadata.claim_id && !metadata.public_artifact_ref) warnings.push("evidence_ref unavailable");
  if (backing.stale) warnings.push("Participation source is not fresh.");

  return {
    title,
    shortLabel: title === "Participation context forming" ? "Participation forming" : title,
    plainEnglish: title === "Outlier-dependent participation"
      ? "Participation evidence is concentrated, so Raven needs broader confirmation before treating the move as durable."
      : title === "Repeat actors present"
        ? "Repeat public participation is visible, but Raven still needs durability and outcome confirmation."
        : title === "Participation broadening"
          ? "Public participation evidence is broadening enough to monitor, but confirmation still depends on durability."
          : "Public participation evidence is partial or mixed, so Raven is treating the read as fragile context.",
    setup: `${setupParts.join(", ")}.`,
    edge: "Participation evidence helps separate durable attention from a thin or outlier-dependent move.",
    confirmation,
    failure,
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
  if (hasOutcome && /mixed/.test(outcome)) title = "Replay mixed";
  else if (hasOutcome && /favorable|reward/.test(outcome)) title = "Similar contexts rewarded continuation";
  else if (hasOutcome && /punish|unfavorable|failed|negative/.test(outcome)) title = "Similar contexts punished followthrough";
  else if (hasSimilarity || backing.hasSample) title = "Replay context weak";

  const warnings = [];
  if (!hasOutcome) warnings.push("Historical outcome field unavailable; this read does not claim prior outcome.");
  if (!backing.hasSample) warnings.push("Replay sample count unavailable; confidence remains low.");
  if (!metadata.evidence_id && !metadata.claim_id && !metadata.outcome_id && !metadata.replay_id && !metadata.public_artifact_ref) warnings.push("proof_ref unavailable");
  if (backing.stale) warnings.push("Replay source is not fresh.");

  return {
    title,
    shortLabel: title === "Historical memory unavailable" ? "Replay unavailable" : title === "Similar contexts rewarded continuation" ? "Replay rewarded" : title === "Similar contexts punished followthrough" ? "Replay punished" : title,
    plainEnglish: title === "Replay mixed"
      ? "Similar public contexts produced mixed followthrough, so current confirmation matters more than the replay alone."
      : title === "Similar contexts rewarded continuation"
        ? "Similar public contexts had favorable followthrough, but Raven still needs current confirmation."
        : title === "Similar contexts punished followthrough"
          ? "Similar public contexts weakened after the read, so Raven is treating followthrough as fragile."
          : "Replay evidence is incomplete or unavailable, so Raven is not treating history as confirmation.",
    setup: hasSimilarity ? "A public replay comparable is linked with similarity context." : "Replay context is forming without a strong comparable.",
    edge: "Replay helps identify what separated prior followthrough from failure without forecasting the current path.",
    confirmation: ["Current context keeps matching the comparable set", "Usable replay sample remains compatible"],
    failure: ["Current context diverges from the comparable set", "Replay sample remains weak or stale"],
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
  else if (/degraded|recovering|backfilling|unavailable|unknown/.test(state)) title = "Provider degraded";
  else if (Number.isFinite(sample) && sample > 0 && sample < 8) title = "Weak sample";
  else if (hasDepth && (Number(metadata.spread_bps) > 50 || Number(metadata.book_depth) < 1)) title = "Thin book risk";
  else if (hasDrag && Number(metadata.execution_drag ?? metadata.estimated_slippage) > 0) title = "High execution drag";

  const warnings = [];
  if (!hasDepth) warnings.push("Depth/book field unavailable; this read does not claim book depth.");
  if (!hasDrag) warnings.push("Execution drag field unavailable; this read does not claim cost drag.");
  if (!metadata.evidence_id && !metadata.claim_id && !metadata.public_artifact_ref) warnings.push("evidence_ref unavailable");

  return {
    title,
    shortLabel: title,
    plainEnglish: title === "Evidence stale"
      ? "One or more public evidence sources are stale, so Raven is treating the current read as lower trust."
      : title === "Provider degraded"
        ? "A public provider or component is degraded, recovering, or unavailable; Raven needs fresh confirmation before strengthening the read."
        : title === "Weak sample"
          ? "The usable public sample is too small to support a stronger interpretation."
          : title === "Thin book risk"
            ? "Book or spread evidence indicates thinner conditions, so Raven is treating followthrough as fragile."
            : title === "High execution drag"
              ? "Available cost evidence indicates drag that could weaken practical followthrough."
              : "The chart has a visible context zone, but the required confirming evidence is not linked yet.",
    setup: metadata.component ? `Public risk context is linked to ${metadata.component}.` : "Risk context is based on public freshness, sample, and confirmation availability.",
    edge: "Risk reads are useful because they prevent Raven from overstating weak or stale evidence.",
    confirmation: ["Provider state returns fresh", "Usable sample improves", "Missing confirmation evidence becomes linked"],
    failure: ["Provider state remains degraded", "Sample depth stays weak", "Risk evidence becomes more severe"],
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
  const title = hasSurvival
    ? "Breakout survival unproven"
    : Number.isFinite(compression) && compression >= 70
      ? "Compression forming"
      : "Reaction zone";
  const score = Math.max(0, Math.min(74, (hasCandles ? 38 : 18) + (hasSurvival ? 28 : 0) + (compression >= 70 ? 8 : 0) - (stale ? 18 : 0)));
  const confidence = stale || !hasCandles ? "low" : hasSurvival ? "medium" : "low";
  const warnings = [];
  if (!hasSurvival) warnings.push("Survival field unavailable; this read does not claim survival confirmation.");
  if (!metadata.liquidity_depth && !metadata.book_depth) warnings.push("Liquidity/depth field unavailable; this read is chart structure, not liquidity.");
  return {
    title,
    shortLabel: title === "Breakout survival unproven" ? "Survival unproven" : title,
    plainEnglish: hasSurvival
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

export function validateRavenRead(read) {
  if (!isPlainObject(read)) fail("Raven Read must be an object");
  if (read.schema_version !== RAVEN_READ_SCHEMA_VERSION) fail("Invalid Raven Read schema_version");
  if (!read.raven_read_id) fail("Raven Read missing raven_read_id");
  if (!read.title) fail("Raven Read missing title");
  if (!read.short_label) fail("Raven Read missing short_label");
  if (PRIMARY_LABEL_DRIFT.has(read.title) || PRIMARY_LABEL_DRIFT.has(read.short_label)) fail("Raven Read uses internal dimension label as primary copy");
  if (!RAVEN_READ_MODES.includes(read.mode)) fail(`Invalid Raven Read mode: ${read.mode}`);
  if (!RAVEN_READ_STATUSES.includes(read.status)) fail(`Invalid Raven Read status: ${read.status}`);
  if (!RAVEN_READ_CONFIDENCE.includes(read.confidence)) fail(`Invalid Raven Read confidence: ${read.confidence}`);
  if (!RAVEN_READ_FRESHNESS.includes(read.freshness_state)) fail(`Invalid Raven Read freshness_state: ${read.freshness_state}`);
  if (read.public_safe !== true) fail("Raven Read must be public_safe");
  if (!read.plain_english_read) fail("Raven Read missing plain_english_read");
  if (!read.setup) fail("Raven Read missing setup");
  if (!read.edge) fail("Raven Read missing edge");
  if (["active", "tested", "confirmed"].includes(read.status)) {
    if (!Array.isArray(read.confirmation) || read.confirmation.length === 0) fail("Active Raven Reads require confirmation path");
    if (!Array.isArray(read.failure) || read.failure.length === 0) fail("Active Raven Reads require failure path");
  }
  if (!Array.isArray(read.evidence) || read.evidence.length === 0) fail("Raven Read requires evidence");
  for (const [index, evidence] of read.evidence.entries()) {
    if (!EVIDENCE_ROLES.includes(evidence.role)) fail(`Invalid evidence role at ${index}`);
    if (evidence.public_safe !== true) fail(`Evidence at ${index} is not public_safe`);
  }
  if (read.zone) {
    for (const field of ["price_low", "price_high", "anchor_price"]) {
      if (read.zone[field] !== undefined && typeof read.zone[field] !== "string") fail(`Zone ${field} must be a string`);
    }
  }
  scanText(read);
  return read;
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

function baseRead({ overlay, asset, market, venue, chain, timeframe, mode, title, shortLabel, plainEnglish, setup, edge, confirmation, failure, evidenceRole, supporting = [], conflicting = [], warnings = [], freshnessState = "fresh", confidence, confidenceScore, evidenceExtra = {} }) {
  const generatedAt = overlay.generated_at || overlay.generatedAt || new Date(0).toISOString();
  const derivedConfidenceScore = confidenceScore !== undefined
    ? confidenceScore
    : Number.isFinite(Number(overlay.value))
      ? Math.round(Number(overlay.value))
      : undefined;
  const derivedConfidence = confidence || confidenceFromScore(derivedConfidenceScore);
  const read = {
    schema_version: RAVEN_READ_SCHEMA_VERSION,
    raven_read_id: ravenReadId({ asset, market, timeframe, source_overlay_id: overlay.id, mode, title }),
    source_overlay_id: overlay.id,
    asset: String(asset || "unknown"),
    market: String(market || overlay.metadata?.market || "unknown"),
    venue,
    chain,
    timeframe: String(timeframe || "unknown"),
    mode,
    title,
    short_label: shortLabel,
    plain_english_read: plainEnglish,
    setup,
    edge,
    confirmation,
    failure,
    status: statusFromFreshness(freshnessState, "active"),
    confidence: derivedConfidence,
    confidence_score: derivedConfidenceScore,
    freshness_state: freshnessState,
    observed_at: overlay.observed_at || overlay.observedAt,
    generated_at: generatedAt,
    expires_at: overlay.expires_at || overlay.expiresAt,
    age_seconds: overlay.age_seconds,
    zone: zoneFromOverlay(overlay),
    evidence: [{
      source: String(overlay.source || "chart_overlay"),
      role: evidenceRole,
      metric: overlay.metadata?.metric || overlay.type,
      value: derivedConfidenceScore ?? overlay.value,
      unit: overlay.metadata?.unit || "score",
      sample_count: overlay.metadata?.sample_count,
      window: overlay.metadata?.window,
      freshness_state: freshnessState,
      confidence: derivedConfidence,
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
  return validateRavenRead(read);
}

export function translateOverlayToRavenRead(overlay, context = {}) {
  const type = String(overlay?.type || "").replace(/_/g, "-");
  const asset = context.asset || context.symbol || overlay.asset;
  const market = context.market || overlay.market || overlay.metadata?.market;
  const venue = context.venue || overlay.venue;
  const chain = context.chain || overlay.chain;
  const timeframe = context.timeframe || overlay.timeframe;
  const delayed = /delayed/i.test(String(overlay?.label || ""));
  const freshnessState = overlay.freshness_state || (delayed ? "stale" : "fresh");
  const weak = Number(overlay?.value) < 55;

  if (type === "pressure-zone") {
    const pressureCopy = pressureReadCopy(overlay.metadata || {}, freshnessState, overlay.value);
    return baseRead({
      overlay,
      asset,
      market,
      venue,
      chain,
      timeframe,
      mode: "pressure",
      title: pressureCopy.title,
      shortLabel: pressureCopy.shortLabel,
      plainEnglish: pressureCopy.plainEnglish,
      setup: pressureCopy.setup,
      edge: pressureCopy.edge,
      confirmation: pressureCopy.confirmation,
      failure: pressureCopy.failure,
      evidenceRole: "leading_read",
      supporting: pressureCopy.supporting,
      conflicting: pressureCopy.conflicting,
      warnings: delayed ? ["Evidence is delayed; treat as stale context.", ...pressureCopy.warnings] : pressureCopy.warnings,
      freshnessState,
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
    return baseRead({
      overlay,
      asset,
      market,
      venue,
      chain,
      timeframe,
      mode: "structure",
      title: structureCopy.title,
      shortLabel: structureCopy.shortLabel,
      plainEnglish: structureCopy.plainEnglish,
      setup: structureCopy.setup,
      edge: structureCopy.edge,
      confirmation: structureCopy.confirmation,
      failure: structureCopy.failure,
      evidenceRole: "live_market_context",
      supporting: structureCopy.supporting,
      conflicting: structureCopy.conflicting,
      warnings: weak ? ["Structure evidence is weak.", ...structureCopy.warnings] : structureCopy.warnings,
      freshnessState,
      confidence: structureCopy.confidence,
      confidenceScore: structureCopy.confidenceScore,
      evidenceExtra: { public_artifact_ref: overlay.metadata?.public_artifact_ref },
    });
  }

  if (type === "breadth-line") {
    const participationCopy = participationReadCopy(overlay.metadata || {}, freshnessState);
    return baseRead({
      overlay,
      asset,
      market,
      venue,
      chain,
      timeframe,
      mode: "participation",
      title: participationCopy.title,
      shortLabel: participationCopy.shortLabel,
      plainEnglish: participationCopy.plainEnglish,
      setup: participationCopy.setup,
      edge: participationCopy.edge,
      confirmation: participationCopy.confirmation,
      failure: participationCopy.failure,
      evidenceRole: "leading_read",
      supporting: participationCopy.supporting,
      conflicting: Number(overlay.value) < 55 ? ["sample breadth weak", ...participationCopy.conflicting] : participationCopy.conflicting,
      freshnessState,
      warnings: participationCopy.warnings,
      confidence: participationCopy.confidence,
      confidenceScore: participationCopy.confidenceScore,
      evidenceExtra: { public_artifact_ref: overlay.metadata?.public_artifact_ref },
    });
  }

  if (type === "history-window") {
    const replayCopy = replayReadCopy(overlay.metadata || {}, freshnessState);
    return baseRead({
      overlay,
      asset,
      market,
      venue,
      chain,
      timeframe,
      mode: "replay",
      title: replayCopy.title,
      shortLabel: replayCopy.shortLabel,
      plainEnglish: replayCopy.plainEnglish,
      setup: replayCopy.setup,
      edge: replayCopy.edge,
      confirmation: replayCopy.confirmation,
      failure: replayCopy.failure,
      evidenceRole: "historical_replay",
      supporting: replayCopy.supporting,
      conflicting: replayCopy.conflicting,
      warnings: ["Replay is context, not a forecast.", ...replayCopy.warnings],
      freshnessState,
      confidence: replayCopy.confidence,
      confidenceScore: replayCopy.confidenceScore,
      evidenceExtra: { public_artifact_ref: overlay.metadata?.public_artifact_ref },
    });
  }

  if (type === "liquidity-zone") {
    const riskCopy = riskReadCopy(overlay.metadata || {}, freshnessState);
    return baseRead({
      overlay,
      asset,
      market,
      venue,
      chain,
      timeframe,
      mode: "risk",
      title: riskCopy.title,
      shortLabel: riskCopy.shortLabel,
      plainEnglish: riskCopy.plainEnglish,
      setup: riskCopy.setup,
      edge: riskCopy.edge,
      confirmation: riskCopy.confirmation,
      failure: riskCopy.failure,
      evidenceRole: "risk_context",
      supporting: riskCopy.supporting,
      conflicting: riskCopy.conflicting,
      warnings: riskCopy.warnings,
      freshnessState,
      confidence: riskCopy.confidence,
      confidenceScore: riskCopy.confidenceScore,
      evidenceExtra: { public_artifact_ref: overlay.metadata?.public_artifact_ref },
    });
  }

  if (type === "participant-shift") {
    const shift = String(overlay.metadata?.participantShiftType || overlay.label || "").toLowerCase();
    const distribution = /distribution|concentration/.test(shift);
    return baseRead({
      overlay,
      asset,
      market,
      venue,
      chain,
      timeframe,
      mode: distribution ? "risk" : "participation",
      title: distribution ? "Outlier-dependent move" : "Participation broadening",
      shortLabel: distribution ? "Top-heavy" : "Participation",
      plainEnglish: distribution ? "Activity is becoming more concentrated; confirmation needs broader participation." : "More or higher-quality participants are appearing, but durability is not yet proven.",
      setup: "Participant behavior changed inside the current chart window.",
      edge: "Participant composition helps distinguish broadening moves from top-heavy moves.",
      confirmation: ["Repeat actors remain active", "Breadth improves", "Concentration stays controlled"],
      failure: ["Participation narrows", "Move depends on fewer actors", "Prior active participants fade"],
      evidenceRole: "leading_read",
      supporting: ["participation", "actor_behavior"],
      conflicting: distribution ? ["concentration risk"] : [],
      warnings: delayed ? ["Participant read is delayed."] : [],
      freshnessState,
    });
  }

  return baseRead({
    overlay: { ...overlay, value: overlay?.value ?? 0 },
    asset,
    market,
    venue,
    chain,
    timeframe,
    mode: "risk",
    title: "Confirmation missing",
    shortLabel: "Needs proof",
    plainEnglish: "Raven can display this context, but the evidence is not strong enough for a more specific read.",
    setup: "A chart overlay exists without enough recognized evidence to classify it strongly.",
    edge: "Weak or unknown context is still useful when it prevents overconfidence.",
    confirmation: ["Fresh compatible evidence appears", "Source context becomes identifiable"],
    failure: ["Evidence remains weak", "Provider context becomes stale"],
    evidenceRole: "risk_context",
    supporting: ["unknown_overlay"],
    warnings: ["Weak Raven Read classification."],
    freshnessState: freshnessState === "fresh" ? "unknown" : freshnessState,
  });
}

export function translateOverlaysToRavenReads(overlays, context = {}) {
  return (Array.isArray(overlays) ? overlays : []).map((overlay) => translateOverlayToRavenRead(overlay, context));
}

export function ravenReadSummary(reads) {
  const list = Array.isArray(reads) ? reads : [];
  const active = list.filter((read) => read.status === "active");
  const stale = list.filter((read) => ["stale", "unavailable"].includes(read.status));
  const strongest = [...list].sort((a, b) => Number(b.confidence_score || 0) - Number(a.confidence_score || 0))[0] || null;
  const weakest = [...list].sort((a, b) => Number(a.confidence_score || 0) - Number(b.confidence_score || 0))[0] || null;
  return {
    schema_version: RAVEN_READ_SCHEMA_VERSION,
    count: list.length,
    active_count: active.length,
    stale_count: stale.length,
    modes: [...new Set(list.map((read) => read.mode))],
    strongest_read: strongest ? { id: strongest.raven_read_id, title: strongest.title, confidence: strongest.confidence, score: strongest.confidence_score } : null,
    weakest_read: weakest ? { id: weakest.raven_read_id, title: weakest.title, confidence: weakest.confidence, score: weakest.confidence_score } : null,
    confirmation_needed: list.flatMap((read) => read.confirmation || []).slice(0, 5),
    provider_degraded_reads: list.filter((read) => ["recovering", "backfilling", "degraded", "stale", "unavailable"].includes(read.freshness_state)).map((read) => read.raven_read_id),
  };
}
